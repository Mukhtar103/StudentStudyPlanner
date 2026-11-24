import LanguageSwitcher from '../components/LanguageSwitcher';
import { t, useLanguage } from '../services/language';
import { api } from '../services/api';
import { useSession } from '../services/session';
import PasswordInput, { passwordHint, validPassword } from '../components/PasswordInput';
import { useState } from 'react';
import { ArrowRight, BookOpen, CalendarDays, Check, Clock3, GraduationCap } from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Alert, Button, Card, Input, PageHeader } from '../components/ui';
import { Brand } from '../layouts/AppLayout';

export function Landing() {
  useLanguage();
  return <div className="public landing">
    <header className="public-nav"><Brand /><LanguageSwitcher /><Button to="/login" variant="secondary">{t("Sign in ")}<ArrowRight size={16} /></Button></header>
    <main className="hero">
      <div className="hero-copy">
        <h1>{t("Make time for ")}<span>{t("better study.")}</span></h1>
        <p>{t("Bring your courses, deadlines, and study sessions into one planner. See what’s due and decide what to work on next.")}</p>
        <div className="hero-actions"><Button to="/register">{t("Get started ")}<ArrowRight size={18} /></Button><Button to="/preview" variant="secondary">{t("Explore preview")}</Button></div>
      </div>
      <section className="hero-visual" aria-label={t("Sample day in Study Planner")}>
        <div className="orbit orbit-one" /><div className="orbit orbit-two" />
        <div className="sample">
          <div className="sample-head"><span className="tile"><CalendarDays size={21} /></span><div><strong>{t("Today’s plan")}</strong><small>{t("Sample schedule")}</small></div></div>
          <div className="sample-row"><span className="tile violet"><BookOpen size={17} /></span><div><strong>{t("Calculus review")}</strong><small>{t("Study session · 45 min")}</small></div><time>14:00</time></div>
          <div className="sample-row"><span className="tile amber"><Clock3 size={17} /></span><div><strong>{t("Research outline")}</strong><small>{t("Assignment deadline")}</small></div><time>16:00</time></div>
          <div className="sample-row"><span className="tile green"><Check size={17} /></span><div><strong>{t("Design readings")}</strong><small>{t("Reading · Complete")}</small></div></div>
        </div>
      </section>
    </main>
  </div>;
}

const modes = {
  login: { title: 'Welcome back', description: 'Sign in to your study planner.', button: 'Sign in', endpoint: '/auth/login' },
  register: { title: 'Create your account', description: 'Set up your personal study workspace.', button: 'Create account', endpoint: '/auth/register' },
  forgot: { title: 'Reset your password', description: 'Enter the email address associated with your account.', button: 'Request reset', endpoint: '/auth/password/forgot' },
  reset: { title: 'Choose a new password', description: 'Set a new password for your Study Planner account.', button: 'Reset password', endpoint: '/auth/password/reset' },
};

function validate(values, mode) {
  const errors = {};
  if (mode === 'register' && !values.displayName.trim()) errors.displayName = 'Enter your display name.';
  if (mode !== 'reset' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email.trim())) errors.email = 'Enter a valid email address.';
  if (mode === 'login' && !values.password) errors.password = 'Enter your password.';
  if (mode === 'register' || mode === 'reset') {
    if (!validPassword(values.password)) errors.password = passwordHint;
    if (!values.confirm || values.confirm !== values.password) errors.confirm = 'Passwords must match.';
  }
  return errors;
}

export function Auth({ mode }) {
  useLanguage();
  const { title, description, button, endpoint } = modes[mode];
  const [errors, setErrors] = useState({});
  const [feedback, setFeedback] = useState(null);
  const [pending, setPending] = useState(false);
  const [token] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get('token'));
  const [invalidToken, setInvalidToken] = useState(mode === 'reset' && !/^[a-f0-9]{64}$/.test(token ?? ''));
  const location = useLocation();
  const navigate = useNavigate();
  const notice = location.state?.notice ?? (mode === 'login' && new URLSearchParams(location.search).get('password') === 'changed' ? 'Password changed. Sign in with your new password.' : null);
  const { setUser } = useSession();
  const needsConfirmation = mode === 'register' || mode === 'reset';

  async function submit(event) {
    event.preventDefault();
    if (pending) return;
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form));
    const nextErrors = validate(values, mode);
    const first = Object.keys(nextErrors)[0];
    setErrors(nextErrors);
    setFeedback(null);
    if (first) {
      form.elements.namedItem(first)?.focus();
      return;
    }
    const { email, password, displayName } = values;
    const payloads = { login: { email, password }, register: { displayName, email, password }, forgot: { email }, reset: { token, password } };
    setPending(true);
    try {
      const result = await api(endpoint, { method: 'POST', data: payloads[mode] });
      if (mode === 'forgot') {
        form.reset();
        setFeedback({ message: result.message });
      } else if (mode === 'reset') {
        setUser(null);
        navigate('/login', { replace: true, state: { notice: 'Password reset. Sign in with your new password.' } });
      } else {
        setUser(result);
        const from = location.state?.from;
        navigate(mode === 'login' && typeof from === 'string' && /^\/(?!\/)/.test(from) ? from : '/dashboard', { replace: true, state: mode === 'register' ? { notice: 'Your account is ready.' } : undefined });
      }
    } catch (error) {
      if (error.code === 'EMAIL_UNAVAILABLE') setErrors({ email: error.message });
      else if (error.code === 'INVALID_RESET_TOKEN') setInvalidToken(true);
      else setFeedback({ error: true, message: error instanceof TypeError ? 'Unable to reach Study Planner. Try again.' : error.message });
    } finally {
      setPending(false);
    }
  }

  return <div className="public auth">
    <header className="public-nav"><Brand /><LanguageSwitcher /><Button to="/preview" variant="secondary">{t("Explore preview ")}<ArrowRight size={16} /></Button></header>
    <main className="auth-shell">
      <div className="auth-panel"><span className="tile"><GraduationCap size={23} /></span><h1>{t(title)}</h1><p>{t(description)}</p>
        {notice && !feedback && <Alert>{t(notice)}</Alert>}
        {feedback && <Alert error={feedback.error}>{t(feedback.message)}</Alert>}
        {invalidToken ? <><Alert error>{t("This reset link is invalid, expired, or already used.")}</Alert><Button className="retry-session" variant="secondary" to="/forgot-password">{t("Request a new link")}</Button></> :
          <form noValidate onSubmit={submit} aria-busy={pending} onChange={event => {
            setFeedback(null);
            if (errors[event.target.name]) setErrors({ ...errors, [event.target.name]: undefined });
          }}>
            {mode === 'register' && <Input required name="displayName" label={t("Display name")} autoComplete="name" maxLength={100} error={errors.displayName} />}
            {mode !== 'reset' && <Input required name="email" label={t("Email address")} type="email" autoComplete={mode === 'forgot' ? 'email' : 'username'} maxLength={254} error={errors.email} />}
            {mode !== 'forgot' && <PasswordInput name="password" label={mode === 'reset' ? t('New password') : t('Password')} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} error={errors.password} aria-describedby={needsConfirmation ? 'password-hint' : undefined} />}
            {needsConfirmation && <><small id="password-hint">{t(passwordHint)}</small><PasswordInput name="confirm" label={t("Confirm password")} error={errors.confirm} /></>}
            {mode === 'login' && <Link className="forgot" to="/forgot-password">{t("Forgot password?")}</Link>}
            <Button type="submit" disabled={pending}>{pending ? t('Please wait…') : t(button)} <ArrowRight size={17} /></Button>
          </form>}
        <p className="auth-footer"><Link to="/privacy">{t("Privacy notice")}</Link></p>
        <p className="auth-footer">{mode === 'login' ? <>{t("New to Study Planner? ")}<Link to="/register">{t("Create an account")}</Link></> : <Link to="/login">{t("Back to sign in")}</Link>}</p>
      </div>
    </main>
  </div>;
}


export function Privacy() {
  useLanguage();
  return <div className="public">
    <header className="public-nav"><Brand /><LanguageSwitcher /><Button to="/login" variant="secondary">{t("Sign in")}</Button></header>
    <main className="workspace-main">
      <div className="account-stack">
        <PageHeader title={t("Privacy notice")} description={t("How Study Planner uses your account and planner data.")} />
        <Card className="academic-detail">
          <h2>{t("Account data")}</h2><p>{t("Your email and display name identify your account. Your locale and time zone determine how dates and times appear. Account security data supports sign-in and recovery.")}</p>
          <h2>{t("Planner data")}</h2><p>{t("Terms, classes, tasks, study sessions, and availability power your schedule and progress. Notification settings control reminder delivery. Email delivery uses the address on your account.")}</p>
          <h2>{t("Your data")}</h2><p>{t("Your planner belongs to your account. You can download your planner and preferences in JSON or CSV from account settings.")}</p>
          <Button to="/settings" variant="secondary">{t("Open account settings")}</Button>
        </Card>
      </div>
    </main>
  </div>;
}

