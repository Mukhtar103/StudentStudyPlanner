import { useOutletContext } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { Alert, Button, Card, EmptyState, LoadingState, PageHeader } from '../components/ui';
import { getHealth } from '../services/api';

function ServiceStatus() {
  const [result, setResult] = useState('loading');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    getHealth(controller.signal).then(() => {
      if (!controller.signal.aborted) setResult('ready');
    }).catch(() => {
      if (!controller.signal.aborted) setResult('error');
    });
    return () => controller.abort();
  }, [attempt]);
  return <Card className="service"><h2>Service status</h2>
    {result === 'loading' && <LoadingState label="Checking API" />}
    {result === 'ready' && <span className="status healthy" role="status">API operational</span>}
    {result === 'error' && <><Alert error>Couldn’t reach the API.</Alert><Button variant="secondary" onClick={() => {
      setResult('loading');
      setAttempt(value => value + 1);
    }}><RefreshCw size={16} /> Retry</Button></>}
  </Card>;
}

export default function Module({ page }) {
  const { preview } = useOutletContext();
  const descriptions = {
    calendar: 'Scheduled classes, deadlines, and sessions will appear here when calendar features are available.',
    courses: 'Courses and their class schedules will appear here once course management is available.',
    tasks: 'Assignments, exams, and personal tasks will appear here once task management is available.',
    'study-plan': 'Your planned study sessions will appear here once scheduling is available.',
    progress: 'Task completion and study time will appear here when activity tracking is available.',
    notifications: 'Deadline and session reminders will appear here once notifications are available.',
    settings: 'Profile and preference controls will appear here when accounts are available.',
  };
  return <>
    <PageHeader title={page.label} description={page.description} />
    <EmptyState icon={page.icon} title={page.empty} description={descriptions[page.path]}>
      <Button variant="secondary" to={preview ? "/preview" : "/dashboard"}><ArrowLeft size={16} /> Back to overview</Button>
    </EmptyState>
    {page.path === 'settings' && <ServiceStatus />}
  </>;
}

