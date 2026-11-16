import { useEffect, useState } from 'react';
import { Bell, Download, ShieldCheck, UserRound } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Alert, Button, Card, Input, LoadingState, PageHeader } from '../components/ui';
import PasswordInput, { passwordHint, validPassword } from '../components/PasswordInput';
import { api } from '../services/api';
import { initials, useSession } from '../services/session';

function AccountForm({ title, icon: Icon, description, label, onSave, children }) {
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
    <div className="account-card-head"><span className="tile"><Icon size={20} /></span><div><h2>{title}</h2><p>{description}</p></div></div>
    <form className="account-form" onSubmit={submit} onChange={() => setFeedback(null)} aria-busy={pending}>
      <fieldset disabled={pending}>{children}</fieldset>
      {feedback && <Alert error={feedback.error}>{feedback.message}</Alert>}
      <Button type="submit" disabled={pending}>{pending ? 'Saving…' : label}</Button>
    </form>
  </Card>;
}

export function Profile() {
  return <>
    <PageHeader title="Profile" description="Manage your identity and regional settings.">
      <Button variant="secondary" to="/settings">Account settings</Button>
    </PageHeader>
    <ProfileFields />
  </>;
}

function ProfileFields() {
  const { user, setUser } = useSession();
  const timezones = Intl.supportedValuesOf('timeZone');
  return <>
    <div id="profile-settings" className="account-stack">
      <div className="identity-strip"><span className="avatar">{initials(user.displayName)}</span><div><strong>{user.displayName}</strong><p>{user.email}</p></div></div>
      <AccountForm title="Personal information" icon={UserRound} description="Choose how your name, dates, and times appear." label="Save profile"
        onSave={async data => {
          setUser(await api('/me', { method: 'PATCH', data }));
          return 'Profile saved.';
        }}>
        <Input name="displayName" label="Display name" defaultValue={user.displayName} required maxLength={100} autoComplete="name" />
        <Input name="emailDisplay" label="Email address" value={user.email} type="email" readOnly disabled />
        <Input name="timezone" label="Time zone" list="timezone-options" defaultValue={user.timezone} maxLength={80} required />
        <datalist id="timezone-options">{['UTC', ...timezones].map(zone => <option key={zone} value={zone} />)}</datalist>
        <Input name="locale" label="Locale" defaultValue={user.locale} maxLength={40} placeholder="en-US" required />
      </AccountForm>
    </div>
  </>;
}

export function Settings() {
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
    <PageHeader title="Account settings" description="Manage account security and how reminders reach you.">
      <Button variant="secondary" to="/profile">Edit profile</Button>
    </PageHeader>
    <nav className="academic-tabs" aria-label="Settings sections">
      <a href="#profile-settings">Profile &amp; region</a><a href="#notification-settings">Notifications</a><a href="#security-settings">Security</a><a href="#personal-export">Data &amp; privacy</a>
    </nav>
    <div className="account-stack">
      <ProfileFields />
      <div id="notification-settings" />
      {state.loading && <Card><LoadingState label="Loading preferences" /></Card>}
      {state.error && <Card><Alert error>Couldn’t load your notification preferences.</Alert><Button className="retry-session" onClick={() => {
        setState({ loading: true });
        setAttempt(value => value + 1);
      }}>Retry</Button></Card>}
      {preferences && <AccountForm title="Notification preferences" icon={Bell} description={'Quiet hours use ' + user.timezone + '. Leave both times empty to disable them.'}
        label="Save preferences" onSave={async data => {
          await api('/preferences', { method: 'PATCH', data: {
            reminderMinutes: Number(data.reminderMinutes),
            emailNotifications: data.emailNotifications === 'on',
            inAppNotifications: data.inAppNotifications === 'on',
            quietStart: data.quietStart || null,
            quietEnd: data.quietEnd || null,
          } });
          return 'Preferences saved.';
        }}>
        <Input name="reminderMinutes" type="number" label="Default reminder lead time (minutes)" defaultValue={preferences.reminderMinutes} min={0} max={10080} required />
        <div className="check-list">
          <label><input name="emailNotifications" type="checkbox" defaultChecked={preferences.emailNotifications} /> Email notifications</label>
          <label><input name="inAppNotifications" type="checkbox" defaultChecked={preferences.inAppNotifications} /> In-app notifications</label>
        </div>
        <Input name="quietStart" type="time" label="Quiet hours start" defaultValue={preferences.quietStart ?? ''} />
        <Input name="quietEnd" type="time" label="Quiet hours end" defaultValue={preferences.quietEnd ?? ''} />
      </AccountForm>}
      <div id="security-settings" />
      <AccountForm title="Change password" icon={ShieldCheck} description="Changing your password signs out all active sessions." label="Change password"
        onSave={async ({ currentPassword, password, confirm }) => {
          if (!validPassword(password)) throw new Error(passwordHint);
          if (password !== confirm) throw new Error('Passwords must match.');
          await api('/auth/password/change', { method: 'POST', data: { currentPassword, password } });
          window.location.replace('/login?password=changed');
        }}>
        <PasswordInput name="currentPassword" label="Current password" autoComplete="current-password" />
        <PasswordInput name="password" label="New password" aria-describedby="change-password-hint" />
        <small id="change-password-hint" className="full-width">{passwordHint}</small>
        <PasswordInput name="confirm" label="Confirm new password" />
      </AccountForm>
      <PersonalExport />
      <Link to="/dashboard">Back to dashboard</Link>
    </div>
  </>;
}


function PersonalExport() {
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
    <div className="account-card-head"><span className="tile"><Download size={20}/></span><div><h2>Data &amp; privacy</h2><p>Download a copy of your personal planner data.</p></div></div>
    <p className="export-copy">Includes your profile, preferences, academic records, tasks, study sessions, availability, reminders, and notification history. Keep the downloaded file private.</p>
    <p className="export-copy"><Link to="/privacy">Privacy notice</Link></p>
    <p className="export-copy"><strong>JSON</strong> preserves the record structure. <strong>CSV</strong> lists each record’s fields in a spreadsheet-friendly format.</p>
    <div className="editor-actions">{['json','csv'].map(format=><Button key={format} disabled={Boolean(busy)} variant={format==='json'?'primary':'secondary'} onClick={()=>download(format)}>
      <Download size={17}/> {busy===format?'Preparing…':'Export '+format.toUpperCase()}
    </Button>)}</div>
    {feedback&&<div className="export-feedback"><Alert error={feedback.error}>{feedback.message}</Alert></div>}
  </Card></div>;
}


