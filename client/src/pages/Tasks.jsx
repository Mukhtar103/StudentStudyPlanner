import { useEffect, useRef, useState } from 'react';
import { Archive, ArrowDown, ArrowUp, BookOpen, CalendarDays, CheckCircle2, ClipboardList, Clock3, FileText, Flag, Plus, TriangleAlert } from 'lucide-react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Alert, Button, Card, EmptyState, Input, LoadingState, PageHeader, StatCard } from '../components/ui';
import { api } from '../services/api';
import { useSession } from '../services/session';
import { useDebouncedSearch } from '../services/useDebouncedSearch';
import { localInstant, localStamp } from '../../../shared/task-time.js';

const categories = ['assignment', 'exam', 'quiz', 'reading', 'project', 'presentation', 'personal_study'];
const priorities = ['low', 'medium', 'high'];
const statuses = ['not_started', 'in_progress', 'completed', 'archived'];
const categoryIcons = [FileText, Flag, CheckCircle2, BookOpen, ClipboardList, CalendarDays, Clock3];
const pretty = value => value.replaceAll('_', ' ');
const options = values => values.map(value => [value, pretty(value)]);

function Select({ name, label, choices, empty, ...props }) {
  return <div className="field task-select"><label htmlFor={name}>{label}</label>
    <select id={name} name={name} {...props}>
      {empty && <option value="">{empty}</option>}
      {choices.map(([value, text]) => <option key={value} value={value}>{text}</option>)}
    </select>
  </div>;
}

function useData(path, version, collect = false) {
  const [state, setState] = useState({});
  const key = path + ':' + version;
  useEffect(() => {
    if (!path) return;
    const abort = new AbortController();
    async function load() {
      if (!collect) return api(path, { signal: abort.signal });
      const items = [];
      for (let page = 1; ; page++) {
        const data = await api(path + '?limit=100&page=' + page, { signal: abort.signal });
        items.push(...data.items);
        if (items.length >= data.total || !data.items.length) return items;
      }
    }
    load().then(data => {
      if (!abort.signal.aborted) setState({ key, data });
    }).catch(error => {
      if (!abort.signal.aborted) setState({ key, error: error.message });
    });
    return () => abort.abort();
  }, [key, path, collect]);
  return state.key === key ? state : {};
}

function formatDate(date, timestamp, user) {
  if (date) return new Intl.DateTimeFormat(user.locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(date + 'T00:00Z'));
  if (timestamp) return new Intl.DateTimeFormat(user.locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: user.timezone }).format(new Date(timestamp));
  return '—';
}

function Dialog({ title, children, close, submit, action }) {
  const ref = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { ref.current.showModal(); }, []);
  return <dialog ref={ref} className="academic-dialog task-dialog" aria-labelledby="task-editor-title" onCancel={event => {
    event.preventDefault();
    if (!busy) close();
  }}>
    <h2 id="task-editor-title">{title}</h2>
    <form aria-busy={busy} onSubmit={async event => {
      event.preventDefault();
      if (busy) return;
      const data = Object.fromEntries(new FormData(event.currentTarget));
      setBusy(true);
      setError('');
      try { await submit(data); close(); }
      catch (error) { setError(error.message); }
      finally { setBusy(false); }
    }}>
      {children}
      {error && <Alert error>{error}</Alert>}
      <div className="editor-actions"><Button variant="secondary" disabled={busy} onClick={close}>Cancel</Button><Button type="submit" disabled={busy}>{busy ? 'Saving…' : action}</Button></div>
    </form>
  </dialog>;
}

function TaskEditor({ task, courses, user, submit, close }) {
  const [deadline, setDeadline] = useState(task?.dueAt ? 'timed' : task?.dueDate ? 'day' : '');
  const [dateError, setDateError] = useState('');
  const courseOptions = courses.map(course => [course.id, course.title]);
  if (task?.courseId && !courses.some(course => course.id === task.courseId)) courseOptions.push([task.courseId, task.courseTitle || 'Linked course']);
  return <Dialog title={task ? 'Edit task' : 'New task'} action={task ? 'Save task' : 'Create task'} close={close}
    submit={async data => {
      let dueAt = null;
      if (deadline === 'timed') {
        const entered = data.dueAt;
        const original = task?.dueAt && localStamp(new Date(task.dueAt), user.timezone);
        const instant = original === entered ? new Date(task.dueAt) : localInstant(entered, user.timezone);
        if (!instant) {
          setDateError('This time does not exist in ' + user.timezone + '. Choose another time.');
          throw new Error('Check the deadline.');
        }
        dueAt = instant.toISOString();
      }
      const originalTarget = task?.targetAt && localStamp(new Date(task.targetAt), user.timezone).slice(0, 10);
      await submit({
        title: data.title, description: data.description, courseId: data.courseId ? Number(data.courseId) : null,
        category: data.category, priority: data.priority, status: data.status, dueAt,
        dueDate: deadline === 'day' ? data.dueDate : null,
        targetDate: originalTarget && originalTarget === data.targetDate ? null : data.targetDate || null,
        targetAt: originalTarget && originalTarget === data.targetDate ? task.targetAt : null,
        estimateMinutes: data.estimateMinutes === '' ? null : Number(data.estimateMinutes),
      });
    }}>
    <Input name="title" label="Task title" required maxLength={150} defaultValue={task?.title} />
    <div className="field"><label htmlFor="description">Description</label><textarea id="description" name="description" rows={3} maxLength={10000} defaultValue={task?.description ?? ''} /></div>
    <div className="task-field-grid">
      <Select name="courseId" label="Course" choices={courseOptions} empty="Personal task" defaultValue={task?.courseId ?? ''} />
      <Select name="category" label="Category" choices={options(categories)} defaultValue={task?.category ?? 'personal_study'} />
      <Select name="priority" label="Priority" choices={options(priorities)} defaultValue={task?.priority ?? 'medium'} />
      <Select name="status" label="Status" choices={options(statuses.slice(0, 3))} defaultValue={task?.status ?? 'not_started'} />
      <Select name="deadlineType" label="Deadline" empty="No deadline" choices={[[ 'day', 'All-day deadline' ], [ 'timed', 'Date and time' ]]} value={deadline} onChange={event => { setDateError(''); setDeadline(event.target.value); }} />
      {deadline === 'day' && <Input type="date" name="dueDate" label="Due date" required defaultValue={task?.dueDate ?? ''} />}
      {deadline === 'timed' && <Input type="datetime-local" name="dueAt" label={'Due in ' + user.timezone} required error={dateError} onChange={() => setDateError('')} defaultValue={task?.dueAt ? localStamp(new Date(task.dueAt), user.timezone) : ''} />}
      <Input name="targetDate" type="date" label="Personal target date" defaultValue={task?.targetDate || (task?.targetAt ? localStamp(new Date(task.targetAt), user.timezone).slice(0, 10) : '')} />
      <Input name="estimateMinutes" type="number" label="Estimated minutes" min={0} max={100000} defaultValue={task?.estimateMinutes ?? ''} />
    </div>
  </Dialog>;
}

function Progress({ total, done }) {
  if (!total) return null;
  return <div className="task-progress"><progress value={done} max={total} aria-label="Subtask completion" /><small>{done} of {total} subtasks</small></div>;
}

export default function Tasks() {
  const { user } = useSession();
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const [searchDraft, setSearchDraft] = useDebouncedSearch(params.get('search') ?? '', value => filter('search', value.trimStart()), !id);
  const [version, setVersion] = useState(0);
  const [editor, setEditor] = useState(() => !id && params.has('create') ? { kind: 'task' } : null);
  const [feedback, setFeedback] = useState(null);
  const [busy, setBusy] = useState(false);
  const refresh = () => setVersion(value => value + 1);
  const query = new URLSearchParams(params);
  const search = query.get('search')?.trim();
  if (search) query.set('search', search);
  else query.delete('search');
  query.set('limit', '10');
  const path = '/tasks' + (id ? '/' + id : '?' + query);
  const result = useData(path, version);
  const courses = useData('/courses', 0, true);
  const subPath = id ? path + '/subtasks' : null;
  const subs = useData(subPath, version, true);
  const data = result.data;
  const subtasks = subs.data ?? [];
  const archived = data?.status === 'archived';
  const courseOptions = (courses.data ?? []).map(course => [course.id, course.title]);

  function filter(key, value) {
    const next = new URLSearchParams(params);
    if (key !== 'page') next.delete('page');
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  }
  async function change(path, method, data, message) {
    await api(path, { method, data });
    setFeedback({ message });
    refresh();
  }
  async function quick(path, method, data, message) {
    if (busy) return;
    setBusy(true);
    setFeedback(null);
    try { await change(path, method, data, message); }
    catch (error) { setFeedback({ error: true, message: error.message }); }
    finally { setBusy(false); }
  }
  function move(index, delta) {
    const ids = subtasks.map(item => item.id);
    [ids[index], ids[index + delta]] = [ids[index + delta], ids[index]];
    return quick(subPath + '/reorder', 'PATCH', { ids }, 'Subtask order saved.');
  }

  return <>
    <PageHeader title={id ? data?.title || 'Task details' : 'Tasks'} description={id ? 'Manage the deadline, progress, and checklist.' : 'Track coursework and personal study in one place.'}>
      {id ? <Button to="/tasks" variant="secondary">Back to tasks</Button> : <Button disabled={!courses.data} onClick={() => setEditor({ kind: 'task' })}><Plus size={18} /> New task</Button>}
    </PageHeader>
    {feedback && <div className="dashboard-notice"><Alert error={feedback.error}>{feedback.message}</Alert></div>}
    {!id && data && <div className="stats-grid">
      <StatCard icon={ClipboardList} label="Total tasks" value={data.summary.total} tone="violet" />
      <StatCard icon={Clock3} label="Pending" value={data.summary.pending} tone="blue" />
      <StatCard icon={CheckCircle2} label="Completed" value={data.summary.completed} tone="green" />
      <StatCard icon={TriangleAlert} label="Overdue" value={data.summary.overdue} tone="amber" />
    </div>}
    {!id && <Card className="task-filters">
      <div className="field task-search"><label htmlFor="task-search">Search tasks</label><input id="task-search" type="search" maxLength={150} placeholder="Title or description" value={searchDraft} onChange={event => setSearchDraft(event.target.value)} /></div>
      <Select name="filter-course" label="Course" empty="All courses" choices={[[ 'personal', 'Personal tasks' ], ...courseOptions]} value={params.get('courseId') ?? ''} onChange={event => filter('courseId', event.target.value)} />
      {[['category', 'Category', categories], ['priority', 'Priority', priorities], ['status', 'Status', statuses], ['deadline', 'Deadline status', ['upcoming', 'overdue']], ['sort', 'Sort by', ['recent', 'due', 'title']]].map(([key, label, values]) =>
        <Select key={key} name={'filter-' + key} label={label} empty={key === 'status' ? 'All unarchived' : key === 'sort' ? 'Newest first' : 'Any'} choices={options(values.filter(value => value !== 'recent'))} value={params.get(key) ?? ''} onChange={event => filter(key, event.target.value)} />)}
      <Input name="filter-from" label="Due from" type="date" value={params.get('from') ?? ''} onChange={event => filter('from', event.target.value)} />
      <Input name="filter-to" label="Due through" type="date" value={params.get('to') ?? ''} onChange={event => filter('to', event.target.value)} />
      <Button variant="secondary" onClick={() => setParams({})}>Clear filters</Button>
    </Card>}
    {(result.error || courses.error || subs.error) && <Card><Alert error>{result.error || courses.error || subs.error}</Alert><Button className="retry-session" onClick={() => window.location.reload()}>Retry</Button></Card>}
    {!data && !result.error && <Card><LoadingState label="Loading tasks" /></Card>}
    {!id && data && <>
      {data.items.length ? <Card className="task-list" aria-label="Task results">
        {data.items.map(task => {
          const Icon = categoryIcons[categories.indexOf(task.category)] ?? ClipboardList;
          return <article className="task-row" key={task.id}>
            <span className="tile" style={{ borderLeft: '4px solid ' + (task.courseColor || '#7253ce') }}><Icon size={18} /></span>
            <div><Link className="task-title" to={'/tasks/' + task.id}>{task.title}</Link><small>{task.courseTitle || 'Personal'} · {pretty(task.category)}</small></div>
            <div className="task-badges"><span className={'academic-status priority-' + task.priority}>{task.priority}</span><span className="academic-status">{pretty(task.status)}</span></div>
            <div><small>{formatDate(task.dueDate, task.dueAt, user)}</small>{task.deadlineState && <span className={'deadline-state ' + task.deadlineState}>{task.deadlineState}</span>}</div>
            <Progress total={task.subtaskCount} done={task.subtaskCompleted} />
          </article>;
        })}
      </Card> : <EmptyState icon={ClipboardList} title="No matching tasks" description="Change your filters or create a task to get started." />}
      {(data.total > data.limit || data.page > 1) && <div className="academic-pagination">
        <Button variant="secondary" disabled={data.page <= 1} onClick={() => filter('page', data.page - 1)}>Previous</Button>
        <span>Page {data.page} of {Math.max(1, Math.ceil(data.total / data.limit))}</span>
        <Button variant="secondary" disabled={data.page * data.limit >= data.total} onClick={() => filter('page', data.page + 1)}>Next</Button>
      </div>}
    </>}
    {id && data && <>
      <Card className="academic-detail task-detail">
        <div className="task-badges"><span className={'academic-status priority-' + data.priority}>{data.priority} priority</span><span className="academic-status">{pretty(data.status)}</span>
          {data.deadlineState && <span className={'deadline-state ' + data.deadlineState}>{data.deadlineState}</span>}</div>
        <p>{data.courseId ? <Link to={'/courses/' + data.courseId}>{data.courseTitle}</Link> : 'Personal task'} · {pretty(data.category)}</p>
        {data.description && <p>{data.description}</p>}
        <dl className="task-facts">
          <div><dt>Deadline</dt><dd>{formatDate(data.dueDate, data.dueAt, user)}{data.dueDate && ' · All day'}</dd></div>
          <div><dt>Personal target</dt><dd>{formatDate(data.targetDate, data.targetAt, user)}</dd></div>
          <div><dt>Estimated effort</dt><dd>{data.estimateMinutes === null ? '—' : data.estimateMinutes + ' min'}</dd></div>
          {data.completedAt && <div><dt>Completed</dt><dd>{formatDate(null, data.completedAt, user)}</dd></div>}
        </dl>
        {!archived && <div className="editor-actions">
          <Button variant="secondary" disabled={busy || !courses.data} onClick={() => setEditor({ kind: 'task', task: data })}>Edit task</Button>
          <Button disabled={busy} onClick={() => quick(path, 'PATCH', { status: data.status === 'completed' ? 'not_started' : 'completed' }, data.status === 'completed' ? 'Task reopened.' : 'Task completed.')}>{data.status === 'completed' ? 'Reopen task' : 'Complete task'}</Button>
          <Button variant="secondary" disabled={busy} onClick={() => setEditor({ kind: 'archive' })}><Archive size={16} /> Archive task</Button>
        </div>}
      </Card>
      <Card className="academic-detail task-detail">
        <div className="academic-card-top"><div><h2>Subtasks</h2><Progress total={data.subtaskCount} done={data.subtaskCompleted} /></div>{!archived && <Button disabled={busy} onClick={() => setEditor({ kind: 'sub' })}><Plus size={16} /> Add subtask</Button>}</div>
        {!subs.data && !subs.error && <LoadingState label="Loading subtasks" />}
        {subs.data?.length === 0 && <p>No subtasks yet.</p>}
        {subtasks.map((item, index) => <div key={item.id} className="subtask-row">
          <label><input type="checkbox" checked={item.status === 'completed'} disabled={archived || busy} onChange={event => quick('/subtasks/' + item.id, 'PATCH', { status: event.target.checked ? 'completed' : 'not_started' }, 'Subtask updated.')} />{item.title}</label>
          {!archived && <div className="editor-actions">
            <button type="button" className="icon-button" aria-label={'Move ' + item.title + ' up'} disabled={busy || index === 0} onClick={() => move(index, -1)}><ArrowUp size={16} /></button>
            <button type="button" className="icon-button" aria-label={'Move ' + item.title + ' down'} disabled={busy || index === subtasks.length - 1} onClick={() => move(index, 1)}><ArrowDown size={16} /></button>
            <Button variant="secondary" disabled={busy} onClick={() => setEditor({ kind: 'sub', item })}>Edit</Button>
            <Button variant="secondary" disabled={busy} onClick={() => setEditor({ kind: 'remove', item })}>Delete</Button>
          </div>}
        </div>)}
      </Card>
    </>}
    {editor?.kind === 'task' && <TaskEditor task={editor.task} courses={courses.data ?? []} user={user} close={() => setEditor(null)} submit={payload => change(editor.task ? path : '/tasks', editor.task ? 'PATCH' : 'POST', payload, editor.task ? 'Task saved.' : 'Task created.')} />}
    {editor?.kind === 'archive' && <Dialog title="Archive task?" action="Archive task" close={() => setEditor(null)} submit={() => change(path, 'DELETE', {}, 'Task archived.')}>
      <p>The task and its checklist will remain available in your archived tasks.</p>
    </Dialog>}
    {editor?.kind === 'sub' && <Dialog title={editor.item ? 'Edit subtask' : 'Add subtask'} action={editor.item ? 'Save subtask' : 'Add subtask'} close={() => setEditor(null)}
      submit={payload => change(editor.item ? '/subtasks/' + editor.item.id : subPath, editor.item ? 'PATCH' : 'POST', payload, 'Subtask saved.')}>
      <Input name="title" label="Subtask title" maxLength={150} required defaultValue={editor.item?.title} />
    </Dialog>}
    {editor?.kind === 'remove' && <Dialog title="Delete subtask?" action="Delete subtask" close={() => setEditor(null)} submit={() => change('/subtasks/' + editor.item.id, 'DELETE', {}, 'Subtask deleted.')}>
      <p>This removes {editor.item.title} from the checklist.</p>
    </Dialog>}
  </>;
}


