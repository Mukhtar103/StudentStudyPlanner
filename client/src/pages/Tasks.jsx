import { t, useLanguage } from '../services/language';
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
  useLanguage();
  return <div className="field task-select"><label htmlFor={name}>{t(label)}</label>
    <select id={name} name={name} {...props}>
      {empty && <option value="">{t(empty)}</option>}
      {t(choices.map(([value, text]) => <option key={value} value={value}>{['courseId','taskId','termId'].includes(name) && value !== '' ? text : t(text)}</option>))}
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
  useLanguage();
  const ref = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { ref.current.showModal(); }, []);
  return <dialog ref={ref} className="academic-dialog task-dialog" aria-labelledby="task-editor-title" onCancel={event => {
    event.preventDefault();
    if (!busy) close();
  }}>
    <h2 id="task-editor-title">{t(title)}</h2>
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
      {t(children)}
      {error && <Alert error>{t(error)}</Alert>}
      <div className="editor-actions"><Button variant="secondary" disabled={busy} onClick={close}>{t("Cancel")}</Button><Button type="submit" disabled={busy}>{busy ? t('Saving…') : t(action)}</Button></div>
    </form>
  </dialog>;
}

function TaskEditor({ task, courses, user, submit, close }) {
  useLanguage();
  const [deadline, setDeadline] = useState(task?.dueAt ? 'timed' : task?.dueDate ? 'day' : '');
  const [dateError, setDateError] = useState('');
  const courseOptions = courses.map(course => [course.id, course.title]);
  if (task?.courseId && !courses.some(course => course.id === task.courseId)) courseOptions.push([task.courseId, task.courseTitle || 'Linked course']);
  return <Dialog title={task ? t('Edit task') : t('New task')} action={task ? 'Save task' : 'Create task'} close={close}
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
    <Input name="title" label={t("Task title")} required maxLength={150} defaultValue={task?.title} />
    <div className="field"><label htmlFor="description">{t("Description")}</label><textarea id="description" name="description" rows={3} maxLength={10000} defaultValue={task?.description ?? ''} /></div>
    <div className="task-field-grid">
      <Select name="courseId" label={t("Course")} choices={courseOptions} empty={t("Personal task")} defaultValue={task?.courseId ?? ''} />
      <Select name="category" label={t("Category")} choices={options(categories)} defaultValue={task?.category ?? 'personal_study'} />
      <Select name="priority" label={t("Priority")} choices={options(priorities)} defaultValue={task?.priority ?? 'medium'} />
      <Select name="status" label={t("Status")} choices={options(statuses.slice(0, 3))} defaultValue={task?.status ?? 'not_started'} />
      <Select name="deadlineType" label={t("Deadline")} empty={t("No deadline")} choices={[[ 'day', 'All-day deadline' ], [ 'timed', 'Date and time' ]]} value={deadline} onChange={event => { setDateError(''); setDeadline(event.target.value); }} />
      {deadline === 'day' && <Input type="date" name="dueDate" label={t("Due date")} required defaultValue={task?.dueDate ?? ''} />}
      {deadline === 'timed' && <Input type="datetime-local" name="dueAt" label={t('Due in ') + t(user.timezone)} required error={dateError} onChange={() => setDateError('')} defaultValue={task?.dueAt ? localStamp(new Date(task.dueAt), user.timezone) : ''} />}
      <Input name="targetDate" type="date" label={t("Personal target date")} defaultValue={task?.targetDate || (task?.targetAt ? localStamp(new Date(task.targetAt), user.timezone).slice(0, 10) : '')} />
      <Input name="estimateMinutes" type="number" label={t("Estimated minutes")} min={0} max={100000} defaultValue={task?.estimateMinutes ?? ''} />
    </div>
  </Dialog>;
}

function Progress({ total, done }) {
  useLanguage();
  if (!total) return null;
  return <div className="task-progress"><progress value={done} max={total} aria-label={t("Subtask completion")} /><small>{t(done)}{t(" of ")}{t(total)}{t(" subtasks")}</small></div>;
}

export default function Tasks() {
  useLanguage();
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
    <PageHeader title={id ? data?.title || t('Task details') : t('Tasks')} description={id ? t('Manage the deadline, progress, and checklist.') : t('Track coursework and personal study in one place.')}>
      {id ? <Button to="/tasks" variant="secondary">{t("Back to tasks")}</Button> : <Button disabled={!courses.data} onClick={() => setEditor({ kind: 'task' })}><Plus size={18} />{t(" New task")}</Button>}
    </PageHeader>
    {feedback && <div className="dashboard-notice"><Alert error={feedback.error}>{t(feedback.message)}</Alert></div>}
    {!id && data && <div className="stats-grid">
      <StatCard icon={ClipboardList} label={t("Total tasks")} value={data.summary.total} tone="violet" />
      <StatCard icon={Clock3} label={t("Pending")} value={data.summary.pending} tone="blue" />
      <StatCard icon={CheckCircle2} label={t("Completed")} value={data.summary.completed} tone="green" />
      <StatCard icon={TriangleAlert} label={t("Overdue")} value={data.summary.overdue} tone="amber" />
    </div>}
    {!id && <Card className="task-filters">
      <div className="field task-search"><label htmlFor="task-search">{t("Search tasks")}</label><input id="task-search" type="search" maxLength={150} placeholder={t("Title or description")} value={searchDraft} onChange={event => setSearchDraft(event.target.value)} /></div>
      <Select name="filter-course" label={t("Course")} empty={t("All courses")} choices={[[ 'personal', 'Personal tasks' ], ...courseOptions]} value={params.get('courseId') ?? ''} onChange={event => filter('courseId', event.target.value)} />
      {t([['category', 'Category', categories], ['priority', 'Priority', priorities], ['status', 'Status', statuses], ['deadline', 'Deadline status', ['upcoming', 'overdue']], ['sort', 'Sort by', ['recent', 'due', 'title']]].map(([key, label, values]) =>
        <Select key={key} name={'filter-' + key} label={t(label)} empty={key === 'status' ? t('All unarchived') : key === 'sort' ? t('Newest first') : t('Any')} choices={options(values.filter(value => value !== 'recent'))} value={params.get(key) ?? ''} onChange={event => filter(key, event.target.value)} />))}
      <Input name="filter-from" label={t("Due from")} type="date" value={params.get('from') ?? ''} onChange={event => filter('from', event.target.value)} />
      <Input name="filter-to" label={t("Due through")} type="date" value={params.get('to') ?? ''} onChange={event => filter('to', event.target.value)} />
      <Button variant="secondary" onClick={() => setParams({})}>{t("Clear filters")}</Button>
    </Card>}
    {(result.error || courses.error || subs.error) && <Card><Alert error>{result.error || courses.error || t(subs.error)}</Alert><Button className="retry-session" onClick={() => window.location.reload()}>{t("Retry")}</Button></Card>}
    {!data && !result.error && <Card><LoadingState label={t("Loading tasks")} /></Card>}
    {!id && data && <>
      {data.items.length ? <Card className="task-list" aria-label={t("Task results")}>
        {t(data.items.map(task => {
          const Icon = categoryIcons[categories.indexOf(task.category)] ?? ClipboardList;
          return <article className="task-row" key={task.id}>
            <span className="tile" style={{ borderLeft: '4px solid ' + (task.courseColor || '#7253ce') }}><Icon size={18} /></span>
            <div><Link className="task-title" to={'/tasks/' + task.id}>{task.title}</Link><small>{task.courseTitle || t('Personal')} · {t(pretty(task.category))}</small></div>
            <div className="task-badges"><span className={'academic-status priority-' + task.priority}>{t(task.priority)}</span><span className="academic-status">{t(pretty(task.status))}</span></div>
            <div><small>{t(formatDate(task.dueDate, task.dueAt, user))}</small>{task.deadlineState && <span className={'deadline-state ' + task.deadlineState}>{t(task.deadlineState)}</span>}</div>
            <Progress total={task.subtaskCount} done={task.subtaskCompleted} />
          </article>;
        }))}
      </Card> : <EmptyState icon={ClipboardList} title={t("No matching tasks")} description={t("Change your filters or create a task to get started.")} />}
      {(data.total > data.limit || data.page > 1) && <div className="academic-pagination">
        <Button variant="secondary" disabled={data.page <= 1} onClick={() => filter('page', data.page - 1)}>{t("Previous")}</Button>
        <span>{t("Page ")}{t(data.page)}{t(" of ")}{t(Math.max(1, Math.ceil(data.total / data.limit)))}</span>
        <Button variant="secondary" disabled={data.page * data.limit >= data.total} onClick={() => filter('page', data.page + 1)}>{t("Next")}</Button>
      </div>}
    </>}
    {id && data && <>
      <Card className="academic-detail task-detail">
        <div className="task-badges"><span className={'academic-status priority-' + data.priority}>{t(data.priority)}{t(" priority")}</span><span className="academic-status">{t(pretty(data.status))}</span>
          {data.deadlineState && <span className={'deadline-state ' + data.deadlineState}>{t(data.deadlineState)}</span>}</div>
        <p>{data.courseId ? <Link to={'/courses/' + data.courseId}>{data.courseTitle}</Link> : t('Personal task')} · {t(pretty(data.category))}</p>
        {data.description && <p>{data.description}</p>}
        <dl className="task-facts">
          <div><dt>{t("Deadline")}</dt><dd>{t(formatDate(data.dueDate, data.dueAt, user))}{data.dueDate && t(' · All day')}</dd></div>
          <div><dt>{t("Personal target")}</dt><dd>{t(formatDate(data.targetDate, data.targetAt, user))}</dd></div>
          <div><dt>{t("Estimated effort")}</dt><dd>{data.estimateMinutes === null ? t('—') : t(data.estimateMinutes) + t(' min')}</dd></div>
          {data.completedAt && <div><dt>{t("Completed")}</dt><dd>{t(formatDate(null, data.completedAt, user))}</dd></div>}
        </dl>
        {!archived && <div className="editor-actions">
          <Button variant="secondary" disabled={busy || !courses.data} onClick={() => setEditor({ kind: 'task', task: data })}>{t("Edit task")}</Button>
          <Button disabled={busy} onClick={() => quick(path, 'PATCH', { status: data.status === 'completed' ? 'not_started' : 'completed' }, data.status === 'completed' ? 'Task reopened.' : 'Task completed.')}>{data.status === 'completed' ? t('Reopen task') : t('Complete task')}</Button>
          <Button variant="secondary" disabled={busy} onClick={() => setEditor({ kind: 'archive' })}><Archive size={16} />{t(" Archive task")}</Button>
        </div>}
      </Card>
      <Card className="academic-detail task-detail">
        <div className="academic-card-top"><div><h2>{t("Subtasks")}</h2><Progress total={data.subtaskCount} done={data.subtaskCompleted} /></div>{!archived && <Button disabled={busy} onClick={() => setEditor({ kind: 'sub' })}><Plus size={16} />{t(" Add subtask")}</Button>}</div>
        {!subs.data && !subs.error && <LoadingState label={t("Loading subtasks")} />}
        {subs.data?.length === 0 && <p>{t("No subtasks yet.")}</p>}
        {t(subtasks.map((item, index) => <div key={item.id} className="subtask-row">
          <label><input type="checkbox" checked={item.status === 'completed'} disabled={archived || busy} onChange={event => quick('/subtasks/' + item.id, 'PATCH', { status: event.target.checked ? 'completed' : 'not_started' }, 'Subtask updated.')} />{item.title}</label>
          {!archived && <div className="editor-actions">
            <button type="button" className="icon-button" aria-label={t('Move ') + item.title + t(' up')} disabled={busy || index === 0} onClick={() => move(index, -1)}><ArrowUp size={16} /></button>
            <button type="button" className="icon-button" aria-label={t('Move ') + item.title + t(' down')} disabled={busy || index === subtasks.length - 1} onClick={() => move(index, 1)}><ArrowDown size={16} /></button>
            <Button variant="secondary" disabled={busy} onClick={() => setEditor({ kind: 'sub', item })}>{t("Edit")}</Button>
            <Button variant="secondary" disabled={busy} onClick={() => setEditor({ kind: 'remove', item })}>{t("Delete")}</Button>
          </div>}
        </div>))}
      </Card>
    </>}
    {editor?.kind === 'task' && <TaskEditor task={editor.task} courses={courses.data ?? []} user={user} close={() => setEditor(null)} submit={payload => change(editor.task ? path : '/tasks', editor.task ? 'PATCH' : 'POST', payload, editor.task ? 'Task saved.' : 'Task created.')} />}
    {editor?.kind === 'archive' && <Dialog title={t("Archive task?")} action="Archive task" close={() => setEditor(null)} submit={() => change(path, 'DELETE', {}, 'Task archived.')}>
      <p>{t("The task and its checklist will remain available in your archived tasks.")}</p>
    </Dialog>}
    {editor?.kind === 'sub' && <Dialog title={editor.item ? t('Edit subtask') : t('Add subtask')} action={editor.item ? 'Save subtask' : 'Add subtask'} close={() => setEditor(null)}
      submit={payload => change(editor.item ? '/subtasks/' + editor.item.id : subPath, editor.item ? 'PATCH' : 'POST', payload, 'Subtask saved.')}>
      <Input name="title" label={t("Subtask title")} maxLength={150} required defaultValue={editor.item?.title} />
    </Dialog>}
    {editor?.kind === 'remove' && <Dialog title={t("Delete subtask?")} action="Delete subtask" close={() => setEditor(null)} submit={() => change('/subtasks/' + editor.item.id, 'DELETE', {}, 'Subtask deleted.')}>
      <p>{t("This removes ")}{editor.item.title}{t(" from the checklist.")}</p>
    </Dialog>}
  </>;
}


