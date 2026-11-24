import LanguageSwitcher from '../components/LanguageSwitcher';
import { t, useLanguage } from '../services/language';
import { NotificationBell } from '../pages/Notifications';
import { Alert } from '../components/ui';
import { api } from '../services/api';
import { initials, useSession } from '../services/session';
import { useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { ArrowUpRight, LogOut, Bell, BookOpen, CalendarDays, ChartNoAxesColumn, CheckSquare, CalendarRange, GraduationCap, LayoutGrid, Menu, Settings, Timer, X } from 'lucide-react';

export const pages = [
  { path: 'dashboard', label: 'Dashboard', icon: LayoutGrid },
  { path: 'calendar', label: 'Calendar', icon: CalendarDays, description: 'See deadlines, classes, and study sessions together.', empty: 'Your calendar is clear' },
  { path: 'terms', label: 'Academic Terms', icon: GraduationCap },
  { path: 'timetable', label: 'Weekly Timetable', icon: CalendarRange },
  { path: 'courses', label: 'Courses', icon: BookOpen, description: 'Organize your courses and weekly class schedule.', empty: 'No courses yet' },
  { path: 'tasks', label: 'Tasks', icon: CheckSquare, description: 'Keep track of assignments, exams, and personal to-dos.', empty: 'No tasks yet' },
  { path: 'study-plan', label: 'Study Plan', icon: Timer, description: 'Set aside time to focus on your academic work.', empty: 'No sessions planned' },
  { path: 'progress', label: 'Progress', icon: ChartNoAxesColumn, description: 'Review completed tasks and time spent studying.', empty: 'No activity to summarize' },
  { path: 'notifications', label: 'Notifications', icon: Bell, description: 'Find reminders for deadlines and study sessions.', empty: 'You’re all caught up' },
  { path: 'settings', label: 'Settings', icon: Settings, description: 'Manage your profile, time zone, and planner preferences.', empty: 'No profile settings yet' },
];

export function Brand() {
  useLanguage();
  return <Link to="/" className="brand"><span className="brand-mark"><GraduationCap size={23} /></span><span>{t("Study Planner")}</span></Link>;
}

export function Sidebar({ open, onNavigate, preview }) {
  useLanguage();
  return <aside className={'sidebar ' + (open ? 'open' : '')} id="sidebar">
    <Brand />
    <nav aria-label={t("Workspace")} className="side-links">
      {t(pages.filter(page => !preview || !['terms', 'timetable'].includes(page.path)).map(({ path, label, icon: Icon }) => <NavLink key={path} to={preview ? '/preview' + (path === 'dashboard' ? '' : '/' + path) : '/' + path} end={path === 'dashboard'} onClick={onNavigate}><Icon size={18} />{t(label)}</NavLink>))}
    </nav>
    {preview ? <Link className="exit-preview" to="/login">{t("Sign in ")}<ArrowUpRight size={16} /></Link> : <SignOut />}
  </aside>;
}

export function Header({ title, open, onToggle, preview }) {
  useLanguage();
  const { user } = useSession();
  return <header className="topbar">
    <div className="top-left">
      <button type="button" className="icon-button menu" aria-label={open ? t('Close navigation') : t('Open navigation')} aria-controls="sidebar" aria-expanded={open} onClick={onToggle}>{open ? <X size={21} /> : <Menu size={21} />}</button>
      <span className="crumb">{t("Workspace")}</span><span className="crumb">/</span><strong>{t(title)}</strong>
    </div>
    <div className="top-right"><LanguageSwitcher />{preview ? <span className="badge">{t("Sample workspace")}</span> : <Link className="account-name" to="/profile" title={user.displayName}>{user.displayName}</Link>}{preview ? <Link className="icon-button" aria-label={t("Notifications")} to="/preview/notifications"><Bell size={19} /></Link> : <NotificationBell />}{!preview && <Link className="avatar" to="/profile" aria-label={t("Profile")}>{t(initials(user.displayName))}</Link>}</div>
  </header>;
}

export default function AppLayout({ preview = false }) {
  useLanguage();
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  const title = pathname === '/profile' ? 'Profile' : pages.find(page => (preview ? '/preview' + (page.path === 'dashboard' ? '' : '/' + page.path) : '/' + page.path) === pathname)?.label ?? 'Workspace';
  return <div className="workspace" onKeyDown={event => {
    if (event.key === 'Escape' && open) {
      setOpen(false);
      document.querySelector('.menu')?.focus();
    }
  }}>
    <a className="skip" href="#workspace-main">{t("Skip to content")}</a>
    <Sidebar preview={preview} open={open} onNavigate={() => {
      if (open) document.getElementById('workspace-main')?.focus();
      setOpen(false);
    }} />
    <div className="workspace-body"><Header preview={preview} title={t(title)} open={open} onToggle={() => { setOpen(!open); if (!open) requestAnimationFrame(() => document.querySelector('#sidebar nav a.active, #sidebar nav a')?.focus()); }} />
      <main id="workspace-main" className="workspace-main" tabIndex={-1}><Outlet context={{ preview }} /></main>
    </div>
  </div>;
}


function SignOut() {
  useLanguage();
  const { setUser } = useSession();
  const navigate = useNavigate();
  const [error, setError] = useState(false);
  const [pending, setPending] = useState(false);
  return <div className="sidebar-footer">
    {error && <Alert error>{t("Sign-out failed. Try again.")}</Alert>}
    <button className="exit-preview" type="button" disabled={pending} onClick={async () => {
      setPending(true);
      setError(false);
      try {
        await api('/auth/logout', { method: 'POST' });
        setUser(null);
        navigate('/login', { replace: true });
      } catch {
        setError(true);
      } finally {
        setPending(false);
      }
    }}>{pending ? t('Signing out…') : t('Sign out')} <LogOut size={16} /></button>
  </div>;
}


