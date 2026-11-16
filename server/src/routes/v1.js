import { mountProgress } from './progress.js';
import { mountNotifications } from './notifications.js';
import { mountCalendar } from './calendar.js';
import { mountStudy } from './study.js';
import { mountTasks } from './tasks.js';
import { mountAcademics } from './academics.js';
import { Router } from 'express';
import { parseCookie } from 'cookie';
import { rateLimit } from 'express-rate-limit';
import { health } from '../controllers/health.js';
import { makeAccount, requireFields } from '../controllers/account.js';
import { ApiError, displayNameValue, emailValue, makeAuth, passwordValue, sessionAge, tokenPattern } from '../services/auth.js';
import { preferences } from '../repositories/accounts.js';

export function createV1({ pool, origins, secure, sendReset }) {
  const router = Router();
  const name = secure ? '__Host-ssp_session' : 'ssp_session';
  const cookie = { httpOnly: true, sameSite: 'lax', secure, path: '/' };
  const auth = makeAuth(pool, sendReset);
  const account = makeAccount(pool);

  const respond = (req, res, data, status = 200) => res.status(status).json({ success: true, data, requestId: req.id });
  const storeSession = (req, res, { token, user }, status) => {
    res.cookie(name, token, { ...cookie, maxAge: sessionAge });
    return respond(req, res, user, status);
  };
  const limiter = limit => rateLimit({
    windowMs: 15 * 60 * 1000, limit, standardHeaders: 'draft-8', legacyHeaders: false,
    handler: (req, res, next) => next(new ApiError(429, 'RATE_LIMITED', 'Too many attempts. Try again in 15 minutes.')),
  });
  const csrf = (req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    if (!origins.includes(req.get('origin')) || req.get('x-planner-request') !== '1' || !req.is('application/json')) {
      throw new ApiError(403, 'REQUEST_BLOCKED', 'This request could not be verified. Reload and try again.');
    }
    next();
  };
  const requireUser = async (req, res, next) => {
    const token = parseCookie(req.get('cookie') || '')[name];
    const user = tokenPattern.test(token || '') ? await auth.session(token) : null;
    if (!user) throw new ApiError(401, 'SESSION_REQUIRED', 'Sign in to continue.');
    req.user = user;
    req.sessionToken = token;
    next();
  };

  router.get('/health', health);
  router.use(['/auth', '/me', '/preferences', '/terms', '/courses', '/timetable', '/tasks', '/subtasks', '/study-sessions', '/availability', '/calendar', '/dashboard', '/reminders', '/notifications', '/analytics', '/export'], (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  }, csrf, (req, res, next) => {
    if (!pool) throw new ApiError(503, 'DATABASE_UNAVAILABLE', 'Account services are unavailable. Try again later.');
    next();
  });

  router.post('/auth/register', limiter(8), async (req, res) => {
    const body = requireFields(req.body, ['email', 'password', 'displayName']);
    const result = await auth.register({ email: emailValue(body.email), password: passwordValue(body.password), displayName: displayNameValue(body.displayName) });
    return storeSession(req, res, result, 201);
  });
  router.post('/auth/login', limiter(12), async (req, res) => {
    const { email, password } = requireFields(req.body, ['email', 'password']);
    return storeSession(req, res, await auth.login(emailValue(email), passwordValue(password, false)));
  });
  router.get('/auth/session', requireUser, (req, res) => respond(req, res, req.user));
  router.post('/auth/logout', requireUser, async (req, res) => {
    await auth.logout(req.user.id, req.sessionToken);
    res.clearCookie(name, cookie);
    return respond(req, res, {});
  });
  router.post('/auth/password/forgot', limiter(6), async (req, res) => {
    const { email } = requireFields(req.body, ['email']);
    await auth.forgot(emailValue(email));
    return respond(req, res, { message: 'If an account exists for this address, you’ll receive a password reset link.' }, 202);
  });
  router.post('/auth/password/reset', limiter(10), async (req, res) => {
    const { token, password } = requireFields(req.body, ['token', 'password']);
    await auth.reset(typeof token === 'string' ? token : '', passwordValue(password));
    res.clearCookie(name, cookie);
    return respond(req, res, {});
  });
  router.post('/auth/password/change', limiter(10), requireUser, async (req, res) => {
    const { currentPassword, password } = requireFields(req.body, ['currentPassword', 'password']);
    await auth.change(req.user.id, passwordValue(currentPassword, false), passwordValue(password), req.sessionToken);
    res.clearCookie(name, cookie);
    return respond(req, res, {});
  });
  router.get('/me', requireUser, (req, res) => respond(req, res, req.user));
  router.patch('/me', requireUser, async (req, res) => respond(req, res, await account.updateProfile(req.user.id, req.body)));
  router.get('/preferences', requireUser, async (req, res) => respond(req, res, await preferences(pool, req.user.id)));
  router.patch('/preferences', requireUser, async (req, res) => respond(req, res, await account.updatePreferences(req.user.id, req.body)));
  mountAcademics(router, { pool, requireUser, respond });
  mountTasks(router, { pool, requireUser, respond });
  mountStudy(router, { pool, requireUser, respond });
  mountCalendar(router, { pool, requireUser, respond });
  mountNotifications(router, { pool, requireUser, respond });
  mountProgress(router, { pool, requireUser, respond });
  return router;
}







