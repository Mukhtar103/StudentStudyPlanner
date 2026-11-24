import { t, useLanguage } from '../services/language';
import LanguageSwitcher from '../components/LanguageSwitcher';
import { useEffect, useState } from 'react';
import { Bell, Download, ShieldCheck, UserRound } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Alert, Button, Card, Input, LoadingState, PageHeader } from '../components/ui';
import PasswordInput, { passwordHint, validPassword } from '../components/PasswordInput';
import { api } from '../services/api';
import { initials, useSession } from '../services/session';

function AccountForm({ title, icon: Icon, description, label, onSave, children }) {
  useLanguage();
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState(null);

  async function submit(event) {
    event.preventDefault();
    if (pending) return;
    const form = event.currentTarget;
    setPending(true);
    setFeedback(null);
    try {
      const message = await onSave(Object.fromEntries(new FormData(form)), form);
      if (message) setFeedback({ message });
    } catch (error) {
      setFeedback({ message: error instanceof TypeError ? 'Unable to reach Study Planner. Try again.' : error.message, error: true });
    } finally {
      setPending(false);
    }
  }

  return <Card className="account-card">
    <div className="account-card-head"><span className="tile"><Icon size={20} /></span><div><h2>{t(title)}</h2><p>{t(description)}</p></div></div>
    <form className="account-form" onSubmit={submit} onChange={() => setFeedback(null)} aria-busy={pending}>
      <fieldset disabled={pending}>{t(children)}</fieldset>
      {feedback && <Alert error={feedback.error}>{t(feedback.message)}</Alert>}
      <Button type="submit" disabled={pending}>{pending ? t('Saving…') : t(label)}</Button>
    </form>
  </Card>;
}

export function Profile() {
  useLanguage();
  return <>
    <PageHeader title={t("Profile")} description={t("Manage your identity and regional settings.")}>
      <Button variant="secondary" to="/settings">{t("Account settings")}</Button>
    </PageHeader>
    <ProfileFields />
  </>;
}

function ProfileFields() {
  useLanguage();
  const { user, setUser } = useSession();
  const timezones = Intl.supportedValuesOf('timeZone');
  return <>
    <div id="profile-settings" className="account-stack">
      <div className="identity-strip"><span className="avatar">{t(initials(user.displayName))}</span><div><strong>{user.displayName}</strong><p>{user.email}</p></div></div>
      <AccountForm title={t("Personal information")} icon={UserRound} description={t("Choose how your name, dates, and times appear.")} label={t("Save profile")}
        onSave={async data => {
          setUser(await api('/me', { method: 'PATCH', data }));
          return 'Profile saved.';
        }}>
        <Input name="displayName" label={t("Display name")} defaultValue={user.displayName} required maxLength={100} autoComplete="name" />
        <Input name="emailDisplay" label={t("Email address")} value={user.email} type="email" readOnly disabled />
        <Input name="timezone" label={t("Time zone")} list="timezone-options" defaultValue={user.timezone} maxLength={80} required />
        <datalist id="timezone-options">{t(['UTC', ...timezones].map(zone => <option key={zone} value={zone} />))}</datalist>
        <div className="field"><span>{t('Interface language')}</span><LanguageSwitcher /></div>
      </AccountForm>
    </div>
  </>;
}

export function Settings() {
  useLanguage();
  const { user } = useSession();
  const [state, setState] = useState({ loading: true });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    api('/preferences', { signal: controller.signal }).then(data => {
      if (!controller.signal.aborted) setState({ data });
    }).catch(() => {
      if (!controller.signal.aborted) setState({ error: true });
    });
    return () => controller.abort();
  }, [attempt]);

  const preferences = state.data;

  return <>
    <PageHeader title={t("Account settings")} description={t("Manage account security and how reminders reach you.")}>
      <Button variant="secondary" to="/profile">{t("Edit profile")}</Button>
    </PageHeader>
    <nav className="academic-tabs" aria-label={t("Settings sections")}>
      <a href="#profile-settings">{t("Profile & region")}</a><a href="#notification-settings">{t("Notifications")}</a><a href="#security-settings">{t("Security")}</a><a href="#personal-export">{t("Data & privacy")}</a>
    </nav>
    <div className="account-stack">
      <ProfileFields />
      <div id="notification-settings" />
      {state.loading && <Card><LoadingState label={t("Loading preferences")} /></Card>}
      {state.error && <Card><Alert error>{t("Couldn’t load your notification preferences.")}</Alert><Button className="retry-session" onClick={() => {
        setState({ loading: true });
        setAttempt(value => value + 1);
      }}>{t("Retry")}</Button></Card>}
      {preferences && <AccountForm title={t("Notification preferences")} icon={Bell} description={t('Quiet hours use ') + t(user.timezone) + t('. Leave both times empty to disable them.')}
        label={t("Save preferences")} onSave={async data => {
          await api('/preferences', { method: 'PATCH', data: {
            reminderMinutes: Number(data.reminderMinutes),
            emailNotifications: data.emailNotifications === 'on',
            inAppNotifications: data.inAppNotifications === 'on',
            quietStart: data.quietStart || null,
            quietEnd: data.quietEnd || null,
          } });
          return 'Preferences saved.';
        }}>
        <Input name="reminderMinutes" type="number" label={t("Default reminder lead time (minutes)")} defaultValue={preferences.reminderMinutes} min={0} max={10080} required />
        <div className="check-list">
          <label><input name="emailNotifications" type="checkbox" defaultChecked={preferences.emailNotifications} />{t(" Email notifications")}</label>
          <label><input name="inAppNotifications" type="checkbox" defaultChecked={preferences.inAppNotifications} />{t(" In-app notifications")}</label>
        </div>
        <Input name="quietStart" type="time" label={t("Quiet hours start")} defaultValue={preferences.quietStart ?? ''} />
        <Input name="quietEnd" type="time" label={t("Quiet hours end")} defaultValue={preferences.quietEnd ?? ''} />
      </AccountForm>}
      <div id="security-settings" />
      <AccountForm title={t("Change password")} icon={ShieldCheck} description={t("Changing your password signs out all active sessions.")} label={t("Change password")}
        onSave={async ({ currentPassword, password, confirm }) => {
          if (!validPassword(password)) throw new Error(passwordHint);
          if (password !== confirm) throw new Error('Passwords must match.');
          await api('/auth/password/change', { method: 'POST', data: { currentPassword, password } });
          window.location.replace('/login?password=changed');
        }}>
        <PasswordInput name="currentPassword" label={t("Current password")} autoComplete="current-password" />
        <PasswordInput name="password" label={t("New password")} aria-describedby="change-password-hint" />
        <small id="change-password-hint" className="full-width">{t(passwordHint)}</small>
        <PasswordInput name="confirm" label={t("Confirm new password")} />
      </AccountForm>
      <PersonalExport />
      <Link to="/dashboard">{t("Back to dashboard")}</Link>
    </div>
  </>;
}


function PersonalExport() {
  useLanguage();
  const [busy,setBusy]=useState(null);
  const [feedback,setFeedback]=useState(null);
  async function download(format) {
    setBusy(format);
    setFeedback(null);
    try {
      const response=await fetch('/api/v1/export/'+format,{credentials:'same-origin'});
      if(!response.ok) {
        const body=await response.json().catch(()=>null);
        if(body?.error?.code==='SESSION_REQUIRED') window.dispatchEvent(new Event('planner-session-expired'));
        throw new Error(body?.error?.message??'The export could not be downloaded.');
      }
      const url=URL.createObjectURL(await response.blob());
      const link=document.createElement('a');
      link.href=url;
      link.download='study-planner-data.'+format;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(()=>URL.revokeObjectURL(url),10000);
      setFeedback({message:format.toUpperCase()+' download started.'});
    } catch(error) {
      setFeedback({message:error.message,error:true});
    } finally {
      setBusy(null);
    }
  }
  return <div id="personal-export"><Card className="account-card">
    <div className="account-card-head"><span className="tile"><Download size={20}/></span><div><h2>{t("Data & privacy")}</h2><p>{t("Download a copy of your personal planner data.")}</p></div></div>
    <p className="export-copy">{t("Includes your profile, preferences, academic records, tasks, study sessions, availability, reminders, and notification history. Keep the downloaded file private.")}</p>
    <p className="export-copy"><Link to="/privacy">{t("Privacy notice")}</Link></p>
    <p className="export-copy"><strong>{t("JSON")}</strong>{t(" preserves the record structure. ")}<strong>{t("CSV")}</strong>{t(" lists each record’s fields in a spreadsheet-friendly format.")}</p>
    <div className="editor-actions">{t(['json','csv'].map(format=><Button key={format} disabled={Boolean(busy)} variant={format==='json'?'primary':'secondary'} onClick={()=>download(format)}>
      <Download size={17}/> {busy===format?t('Preparing…'):t('Export ')+t(format.toUpperCase())}
    </Button>))}</div>
    {feedback&&<div className="export-feedback"><Alert error={feedback.error}>{t(feedback.message)}</Alert></div>}
  </Card></div>;
}


