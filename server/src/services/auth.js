import { randomBytes, createHash } from 'node:crypto';
import bcrypt from 'bcryptjs';
import nodemailer from 'nodemailer';
import { transaction } from '../config/database.js';
import { audit, one, profile, publicFields } from '../repositories/accounts.js';

export const sessionAge = 7 * 24 * 60 * 60 * 1000;
const resetAge = 30 * 60 * 1000;
const bcryptCost = Number(process.env.BCRYPT_COST || 12);
if (!Number.isInteger(bcryptCost) || bcryptCost < 12 || bcryptCost > 15) throw new Error('BCRYPT_COST must be between 12 and 15');
const dummyHash = bcrypt.hash(randomBytes(32).toString('hex'), bcryptCost);
export const tokenPattern = /^[a-f0-9]{64}$/;
const newToken = () => randomBytes(32).toString('hex');
export const digest = token => createHash('sha256').update(token).digest();

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function emailValue(value) {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (email.length > 254 || !/^[\w.!#$%&'*+/=?^\x60{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(email) || email.split('@')[0].length > 64) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Enter a valid email address.');
  }
  return email;
}

export function passwordValue(value, isNew = true) {
  if (typeof value !== 'string' || Buffer.byteLength(value) > 72 || [...value].length < (isNew ? 12 : 1)) {
    throw new ApiError(400, 'VALIDATION_ERROR', isNew ? 'Use at least 12 characters and at most 72 UTF-8 bytes.' : 'Enter your password.');
  }
  return value;
}

export function displayNameValue(value) {
  const name = typeof value === 'string' ? value.trim() : '';
  if (!name || [...name].length > 100) throw new ApiError(400, 'VALIDATION_ERROR', 'Enter a display name of up to 100 characters.');
  return name;
}

function invalidToken() {
  return new ApiError(400, 'INVALID_RESET_TOKEN', 'This reset link is invalid, expired, or already used. Request a new link.');
}

async function createSession(db, id) {
  const token = newToken();
  await db.execute('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)', [digest(token), id, new Date(Date.now() + sessionAge)]);
  return { token, user: await profile(db, id) };
}

export function makeAuth(pool, sendReset) {
  return {
    async register({ email, password, displayName }) {
      const hash = await bcrypt.hash(password, bcryptCost);
      try {
        return await transaction(pool, async db => {
          const [result] = await db.execute('INSERT INTO users (email, password_hash, display_name) VALUES (?, ?, ?)', [email, hash, displayName]);
          const id = result.insertId;
          await db.execute('INSERT INTO user_preferences (user_id) VALUES (?)', [id]);
          await audit(db, id, 'register');
          return createSession(db, id);
        });
      } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') throw new ApiError(409, 'EMAIL_UNAVAILABLE', 'This email address is already in use.');
        throw error;
      }
    },
    async login(email, password) {
      const user = await one(pool, "SELECT id, password_hash FROM users WHERE email = ? AND status = 'active'", [email]);
      const valid = await bcrypt.compare(password, user?.password_hash ?? await dummyHash);
      if (!valid || !user) {
        await audit(pool, user?.id ?? null, 'login', 'failure');
        throw new ApiError(401, 'INVALID_CREDENTIALS', 'The email or password is incorrect.');
      }
      return transaction(pool, async db => {
        const current = await one(db, "SELECT password_hash FROM users WHERE id = ? AND status = 'active' FOR UPDATE", [user.id]);
        if (current?.password_hash !== user.password_hash) throw new ApiError(401, 'INVALID_CREDENTIALS', 'The email or password is incorrect.');
        await db.execute('DELETE FROM sessions WHERE user_id = ? AND expires_at <= UTC_TIMESTAMP(3)', [user.id]);
        await audit(db, user.id, 'login');
        return createSession(db, user.id);
      });
    },
    session(token) {
      return one(pool, 'SELECT ' + publicFields + " FROM users WHERE status = 'active' AND id = (SELECT user_id FROM sessions WHERE token_hash = ? AND expires_at > UTC_TIMESTAMP(3))", [digest(token)]);
    },
    logout(id, token) {
      return transaction(pool, async db => {
        await db.execute('DELETE FROM sessions WHERE token_hash = ? AND user_id = ?', [digest(token), id]);
        await audit(db, id, 'logout');
      });
    },
    async forgot(email) {
      if (!sendReset) throw new ApiError(503, 'RECOVERY_UNAVAILABLE', 'Password recovery email is currently unavailable.');
      const user = await one(pool, "SELECT id FROM users WHERE email = ? AND status = 'active'", [email]);
      if (!user) return;
      const token = newToken();
      await transaction(pool, async db => {
        await one(db, 'SELECT id FROM users WHERE id = ? FOR UPDATE', [user.id]);
        await db.execute('DELETE FROM password_reset_tokens WHERE user_id = ? AND expires_at <= UTC_TIMESTAMP(3)', [user.id]);
        await db.execute('INSERT INTO password_reset_tokens (token_hash, user_id, expires_at) VALUES (?, ?, ?)', [digest(token), user.id, new Date(Date.now() + resetAge)]);
        await audit(db, user.id, 'password_reset_requested');
      });
      void sendReset(email, token).catch(async () => {
        try {
          await pool.execute('DELETE FROM password_reset_tokens WHERE token_hash = ?', [digest(token)]);
          await audit(pool, user.id, 'password_reset_delivery', 'failure');
        } catch {
          console.error(JSON.stringify({ event: 'password_reset_cleanup_failed' }));
        }
        console.error(JSON.stringify({ event: 'password_reset_delivery_failed' }));
      });
    },
    async reset(token, password) {
      if (!tokenPattern.test(token)) throw invalidToken();
      const hash = digest(token);
      const reset = await one(pool, 'SELECT user_id FROM password_reset_tokens WHERE token_hash = ? AND expires_at > UTC_TIMESTAMP(3)', [hash]);
      if (!reset) throw invalidToken();
      const passwordHash = await bcrypt.hash(password, bcryptCost);
      await transaction(pool, async db => {
        const user = await one(db, "SELECT id FROM users WHERE id = ? AND status = 'active' FOR UPDATE", [reset.user_id]);
        if (!user) throw invalidToken();
        const [result] = await db.execute('DELETE FROM password_reset_tokens WHERE token_hash = ? AND expires_at > UTC_TIMESTAMP(3)', [hash]);
        if (!result.affectedRows) throw invalidToken();
        await replacePassword(db, user.id, passwordHash, 'password_reset');
      });
    },
    async change(id, currentPassword, nextPassword, token) {
      const user = await one(pool, 'SELECT password_hash FROM users WHERE id = ?', [id]);
      if (!user || !await bcrypt.compare(currentPassword, user.password_hash)) {
        await audit(pool, id, 'password_change', 'failure');
        throw new ApiError(400, 'INVALID_PASSWORD', 'The current password is incorrect.');
      }
      const hash = await bcrypt.hash(nextPassword, bcryptCost);
      await transaction(pool, async db => {
        const current = await one(db, "SELECT password_hash FROM users WHERE id = ? AND status = 'active' FOR UPDATE", [id]);
        const session = await one(db, 'SELECT user_id FROM sessions WHERE token_hash = ? AND user_id = ? AND expires_at > UTC_TIMESTAMP(3)', [digest(token), id]);
        if (current?.password_hash !== user.password_hash || !session) throw new ApiError(401, 'SESSION_REQUIRED', 'Sign in to continue.');
        await replacePassword(db, id, hash, 'password_change');
      });
    },
  };
}

async function replacePassword(db, id, hash, action) {
  await db.execute('UPDATE users SET password_hash = ? WHERE id = ?', [hash, id]);
  await db.execute('DELETE FROM sessions WHERE user_id = ?', [id]);
  await db.execute('DELETE FROM password_reset_tokens WHERE user_id = ?', [id]);
  await audit(db, id, action);
}

export function createResetMailer(env = process.env) {
  if (!env.SMTP_URL || !env.SMTP_FROM || !env.APP_URL) return null;
  const base = new URL(env.APP_URL);
  if (env.NODE_ENV === 'production' && base.protocol !== 'https:') throw new Error('APP_URL must use HTTPS in production');
  const smtp = new URL(env.SMTP_URL);
  if (!['smtp:', 'smtps:'].includes(smtp.protocol)) throw new Error('SMTP_URL must use smtp or smtps');
  const transport = nodemailer.createTransport({
    host: smtp.hostname, port: Number(smtp.port || (smtp.protocol === 'smtps:' ? 465 : 587)),
    secure: smtp.protocol === 'smtps:',
    auth: smtp.username ? { user: decodeURIComponent(smtp.username), pass: decodeURIComponent(smtp.password) } : undefined,
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 20000,
    requireTLS: env.NODE_ENV === 'production',
  });
  return async (to, token) => {
    const link = new URL('/reset-password', base);
    link.hash = new URLSearchParams({ token });
    const result = await transport.sendMail({
      from: env.SMTP_FROM, to, subject: 'Reset your Study Planner password',
      text: 'Use this link within 30 minutes to reset your password: ' + link.href + '\nIf you did not request this, you can ignore this email.',
    });
    if (!result.accepted.length) throw new Error('SMTP recipient was not accepted');
  };
}

