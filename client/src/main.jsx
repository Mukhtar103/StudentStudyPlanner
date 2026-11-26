import { lazy, Suspense } from 'react';
import Notifications from './pages/Notifications';
import Calendar from './pages/Calendar';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Compass } from 'lucide-react';
import '@fontsource-variable/inter';
import './styles/main.css';
import './styles/redesign.css';
import AppLayout, { pages } from './layouts/AppLayout';
import Dashboard from './pages/Dashboard';
import Module from './pages/Module';
import { Auth, Landing, Privacy } from './pages/Public';
import { Profile, Settings } from './pages/Account';
import { Button, EmptyState, LoadingState } from './components/ui';
import { RequireSession, SessionProvider } from './services/session';

const Progress = lazy(() => import('./pages/Progress'));
const Study = lazy(() => import('./pages/Study'));
const Tasks = lazy(() => import('./pages/Tasks'));
const Academics = lazy(() => import('./pages/Academics'));

const plannerModules = pages.filter(page => !['dashboard', 'settings', 'terms', 'timetable'].includes(page.path));
const moduleRoutes = plannerModules.map(page => <Route key={page.path} path={page.path} element={<Module page={page} />} />);

createRoot(document.getElementById('root')).render(
  <BrowserRouter>
    <SessionProvider>
      <Suspense fallback={<main className="workspace-main"><LoadingState label="Loading planner" /></main>}>
      <Routes>
        <Route index element={<Landing />} />
        <Route path="privacy" element={<Privacy />} />
        <Route path="login" element={<Auth key="login" mode="login" />} />
        <Route path="register" element={<Auth key="register" mode="register" />} />
        <Route path="forgot-password" element={<Auth key="forgot" mode="forgot" />} />
        <Route path="reset-password" element={<Auth key="reset" mode="reset" />} />
        <Route path="preview" element={<AppLayout preview />}>
          <Route index element={<Dashboard preview />} />
          {moduleRoutes}
          <Route path="settings" element={<Module page={pages.at(-1)} />} />
        </Route>
        <Route element={<RequireSession />}>
          <Route element={<AppLayout />}>
            <Route path="calendar" element={<Calendar />} />
            <Route path="notifications" element={<Notifications />} />
            <Route path="progress" element={<Progress />} />
            <Route path="dashboard" element={<Dashboard />} />
            {moduleRoutes.filter(route => !['courses', 'tasks', 'study-plan', 'calendar', 'notifications', 'progress'].includes(route.key))}
            <Route path="terms" element={<Academics key="terms" view="terms" />} />
            <Route path="terms/:id" element={<Academics key="term-detail" view="terms" />} />
            <Route path="courses" element={<Academics key="courses" view="courses" />} />
            <Route path="courses/:id" element={<Academics key="course-detail" view="courses" />} />
            <Route path="tasks" element={<Tasks key="tasks" />} />
            <Route path="tasks/:id" element={<Tasks key="task-detail" />} />
            <Route path="study-plan" element={<Study key="study" />} />
            <Route path="study-plan/availability" element={<Study key="availability" availability />} />
            <Route path="study-plan/:id" element={<Study key="session" />} />
            <Route path="timetable" element={<Academics key="timetable" view="timetable" />} />
            <Route path="profile" element={<Profile />} />
            <Route path="settings" element={<Settings />} />
          </Route>
        </Route>
        <Route path="*" element={<main className="workspace-main"><EmptyState icon={Compass} title="Page not found" description="Check the address or return to Study Planner."><Button to="/">Back to home</Button></EmptyState></main>} />
      </Routes>
      </Suspense>
    </SessionProvider>
  </BrowserRouter>
);








