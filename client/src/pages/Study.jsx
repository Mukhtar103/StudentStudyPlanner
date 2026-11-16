import { useEffect, useRef, useState } from 'react';
import { CalendarDays, CheckCircle2, Plus, Timer } from 'lucide-react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Alert, Button, Card, EmptyState, Input, LoadingState, PageHeader, StatCard } from '../components/ui';
import { api } from '../services/api';
import { useSession } from '../services/session';
import { localInstant, localStamp } from '../../../shared/task-time.js';

const weekdays = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
const shift = (date, days) => new Date(Date.parse(date + 'T00:00Z') + days * 86400000).toISOString().slice(0,10);
const weekday = date => new Date(date + 'T00:00Z').getUTCDay() || 7;
const sessionPath = '/study-sessions';
const studyPath = '/study-plan';

function useData(path, version, all = false) {
  const [state,setState] = useState({});
  const key = path + ':' + version;
  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    async function load() {
      if (!all) return api(path,{ signal: controller.signal });
      const items = [];
      for (let page = 1; ; page++) {
        const data = await api(path + (path.includes('?') ? '&' : '?') + 'page=' + page + '&limit=100',{ signal: controller.signal });
        items.push(...data.items);
        if (items.length >= data.total || !data.items.length) return { ...data,items };
      }
    }
    load().then(data => {
      if (!controller.signal.aborted) setState({ key,data });
    }).catch(error => {
      if (!controller.signal.aborted) setState({ key,error: error.message });
    });
    return () => controller.abort();
  },[path,key,all]);
  return state.key === key ? state : {};
}

function Select({ name,label,items, ...props }) {
  return <div className="field"><label htmlFor={name}>{label}</label><select id={name} name={name} {...props}>
    {items.map(([value,label]) => <option key={value} value={value}>{label}</option>)}
  </select></div>;
}
function format(value,user,style = 'short') {
  return new Intl.DateTimeFormat(user.locale,{ timeZone: user.timezone,timeStyle: 'short', ...(style === 'short' ? {} : { dateStyle: 'medium' }) }).format(new Date(value));
}
function dateLabel(date,user) {
  return new Intl.DateTimeFormat(user.locale,{ timeZone:'UTC',month:'short', day:'numeric' }).format(new Date(date+'T00:00Z'));
}
function wallTime(value,user) {
  return new Intl.DateTimeFormat(user.locale,{ timeZone:'UTC',timeStyle:'short' }).format(new Date('2000-01-01T'+value+':00Z'));
}
function Dialog({ title,action,close,submit,children,user }) {
  const ref = useRef(null);
  const [pending,setPending] = useState(false);
  const [error,setError] = useState(null);
  const [conflict,setConflict] = useState(null);

  useEffect(() => { ref.current.showModal(); },[]);
  async function save(data,override) {
    setPending(true);
    setError(null);
    try { await submit(data,override); close(); }
    catch (error) {
      if (error.code === 'SESSION_CONFLICT') setConflict({ data,details:error.details ?? [] });
      else { setConflict(null); setError(error.message); }
    } finally { setPending(false); }
  }
  return <dialog ref={ref} className="academic-dialog task-dialog" aria-labelledby="study-dialog-title" onCancel={event => {
    event.preventDefault();
    if (!pending) close();
  }}>
    <h2 id="study-dialog-title">{title}</h2>
    <form onSubmit={event => {
      event.preventDefault();
      if (!pending) void save(new FormData(event.currentTarget),false);
    }} aria-busy={pending} onChange={() => { setError(null); setConflict(null); }}>
      <fieldset className="study-fields" disabled={pending}>{children}</fieldset>
      {error && <Alert error>{error}</Alert>}
      {conflict && <div className="study-conflicts"><Alert error>This schedule overlaps with other study time. Revise the times or confirm the overlap below.</Alert>
        <ul>{conflict.details.map((item,index) => <li key={item.id ?? index}><strong>{item.title}</strong><br />{format(item.startAt,user,'full')} – {format(item.endAt,user,'full')}</li>)}</ul>
      </div>}
      <div className="editor-actions"><Button variant="secondary" onClick={close} disabled={pending}>Cancel</Button>
        {conflict ? <Button onClick={() => save(conflict.data,true)} disabled={pending}>Save despite overlap</Button> :
          <Button type="submit" disabled={pending}>{pending ? 'Saving…' : action}</Button>}
      </div>
    </form>
  </dialog>;
}

function SessionEditor({ item,mode,user,day,courses,tasks,close,commit }) {
  const recurring = mode === 'new' || mode === 'series';
  const [frequency,setFrequency] = useState(mode === 'series' ? item.recurrence.frequency : '');
  const [ending,setEnding] = useState(mode === 'series' && item.recurrence.until ? 'date' : 'count');
  const start = item ? localStamp(new Date(item.startAt),user.timezone) : day + 'T16:00';
  const end = item ? localStamp(new Date(item.endAt),user.timezone) : day + 'T17:00';
  const [duration,setDuration] = useState(false);
  const [startValue,setStartValue] = useState(start);
  const [endValue,setEndValue] = useState(end);
  const [minutes,setMinutes] = useState(item?.plannedMinutes ?? 60);
  function convert(value, original) {
    if (original && value === localStamp(new Date(original),user.timezone)) return original;
    const instant = localInstant(value,user.timezone);
    if (!instant) throw new Error('Choose a time that exists in ' + user.timezone + '.');
    return instant.toISOString();
  }
  const startInstant = startValue ? localInstant(startValue,user.timezone) : null;
  const endInstant = endValue ? localInstant(endValue,user.timezone) : null;
  const planned = duration ? Number(minutes) : (endInstant && startInstant ? Math.ceil((endInstant-startInstant)/60000) : 0);
  const startField = <Input name="startAt" label="Start" type="datetime-local" required value={startValue} onChange={e => setStartValue(e.target.value)} />;
  const modeField = <Select name="lengthMode" label="Set duration by" items={[[ 'end','End time' ],[ 'minutes','Planned minutes' ]]} onChange={e => setDuration(e.target.value === 'minutes')} />;
  const endField = <Input name="endAt" label="End" type="datetime-local" required value={endValue} onChange={e => setEndValue(e.target.value)} />;
  const minutesField = <Input name="minutes" label="Planned minutes" type="number" required min={1} max={10080} value={minutes} onChange={e => setMinutes(e.target.value)} />;
  return <Dialog title={{new:'New study session',edit:'Edit occurrence',reschedule:'Reschedule occurrence',series:'Edit series'}[mode]}
    action={mode === 'new' ? 'Create session' : 'Save changes'} close={close} user={user} submit={async (form,overrideConflict) => {
      const data = Object.fromEntries(form);
      const payload = { startAt: convert(data.startAt,item?.startAt),overrideConflict };
      if (duration) payload.plannedMinutes = Number(data.minutes);
      else payload.endAt = convert(data.endAt,item?.endAt);
      if (mode !== 'reschedule') Object.assign(payload,{ title:data.title,objective:data.objective,courseId:data.courseId ? Number(data.courseId) : null,taskId:data.taskId ? Number(data.taskId) : null, status: data.status });
      if (recurring) payload.recurrence = frequency ? { frequency,weekdays:form.getAll('weekdays').map(Number),
        ...(ending === 'date' ? { until:data.until } : { count:Number(data.count) }) } : null;
      await commit(payload);
    }}>
    {mode !== 'reschedule' && <>
      <Input name="title" label="Session title" required maxLength={150} defaultValue={item?.title} />
      <div className="field"><label htmlFor="objective">Study objective</label><textarea name="objective" id="objective" rows={2} maxLength={5000} defaultValue={item?.objective ?? ''} /></div>
      <div className="task-field-grid">
        <Select name="courseId" label="Linked course" items={[[ '', 'No course' ],...courses.map(course => [course.id,course.title])]} defaultValue={item?.courseId ?? ''} />
        <Select name="taskId" label="Linked task" items={[[ '', 'No task' ],...tasks.map(task => [task.id,task.title])]} defaultValue={item?.taskId ?? ''} />
        <Select name="status" label="Status" items={[[ 'planned','Planned' ],[ 'in_progress','In progress' ]]} defaultValue={item?.status === 'in_progress' ? 'in_progress' : 'planned'} />
      </div>
    </>}
    <p className="study-muted">Times use {user.timezone}.</p>
    {mode === 'series' ? <div className="study-series-timing">
      {startField}
      {duration ? <Input name="seriesEndPreview" label="End" type="datetime-local" readOnly
        value={startInstant && planned >= 1 && planned <= 10080 ? localStamp(new Date(+startInstant + planned * 60000),user.timezone) : ''} /> : endField}
      {modeField}
      {duration ? minutesField : <Input name="seriesDurationPreview" label="Duration" readOnly value={planned > 0 ? planned + ' min planned' : ''} />}
    </div> : <>
      <div className={mode === 'new' ? "study-new-timing" : "task-field-grid"}>{startField}{modeField}{duration ? minutesField : endField}</div>
      {planned > 0 && <small>{planned} min planned</small>}
    </>}
    {recurring && <div className="study-fields">
      <Select name="frequency" label="Repeat" items={[[ '',mode === 'series' ? 'End series' : 'Does not repeat' ],[ 'daily','Daily' ],[ 'weekly','Weekly' ]]} value={frequency} onChange={e => setFrequency(e.target.value)} />
      {frequency === 'weekly' && <fieldset className="study-weekdays"><legend>Repeat on</legend>{weekdays.map((name,index) => <label key={name}><input type="checkbox" name="weekdays" value={index+1} defaultChecked={item?.recurrence?.weekdays?.includes(index+1) ?? weekday(start.slice(0,10)) === index+1} />{name.slice(0,3)}</label>)}</fieldset>}
      {frequency && <div className="task-field-grid">
        <Select name="ending" label="Series ends by" items={[[ 'count','Occurrence limit' ],[ 'date','End date' ]]} value={ending} onChange={e => setEnding(e.target.value)} />
        {ending === 'date' ? <Input name="until" label="Final date" type="date" required defaultValue={item?.recurrence?.until ?? ''} /> :
          <Input name="count" label="Number of sessions" type="number" required min={1} max={52} defaultValue={item?.recurrence?.count ?? 4} />}
      </div>}
      {mode === 'series' && <p className="study-muted">Changes apply to future planned occurrences. Completed, cancelled, and individually edited occurrences stay in your history.</p>}
    </div>}
  </Dialog>;
}

export default function Study({ availability = false }) {
  const { user } = useSession();
  const { id } = useParams();
  const [params,setParams] = useSearchParams();
  const [version,setVersion] = useState(0);
  const [editor,setEditor] = useState(() => !id && !availability && params.has('create') ? { mode: 'new' } : null);
  const [notice,setNotice] = useState('');
  const today = localStamp(new Date(),user.timezone).slice(0,10);
  const rawDate = params.get('date');
  const day = rawDate && /^20\d\d-\d\d-\d\d$/.test(rawDate) && Number.isFinite(Date.parse(rawDate)) && shift(rawDate,0) === rawDate ? rawDate : today;
  const daily = params.get('view') === 'day';
  const first = daily ? day : shift(day,1-weekday(day));
  const last = daily ? day : shift(first,6);
  const path = availability ? '/availability' : id ? sessionPath + '/' + id : sessionPath + '?from=' + first + '&to=' + last;
  const result = useData(path,version,!id);
  const choices = ['new','edit','series'].includes(editor?.mode);
  const courses = useData(choices ? '/courses' : null,version,true);
  const tasks = useData(choices ? '/tasks' : null,version,true);
  const data = result.data;
  const close = () => setEditor(null);
  function open(mode,item) { setNotice(''); setEditor({ mode,item }); }
  async function commit(path,method,data,message) {
    await api(path,{ method,data });
    setNotice(message);
    setVersion(value => value+1);
  }
  function go(date,mode = daily ? 'day' : 'week') { setParams({ date,view:mode }); }
  const active = data && ['planned','in_progress'].includes(data.status);
  const closed = data && ['completed','cancelled'].includes(data.status);
  return <>
    <PageHeader title={availability ? 'Weekly availability' : id ? data?.title || 'Study session' : 'Study plan'}
      description={availability ? 'Set recurring windows for focused study in ' + user.timezone + '.' : 'Plan focused study time in ' + user.timezone + '.'}>
      {availability || id ? <Button to={studyPath} variant="secondary">Back to study plan</Button> : <Button onClick={() => open('new')}><Plus size={17} /> New session</Button>}
    </PageHeader>
    {notice && <div className="dashboard-notice"><Alert>{notice}</Alert></div>}
    {result.error && <Card><Alert error>{result.error}</Alert><Button className="retry-session" onClick={() => setVersion(value => value+1)}>Retry</Button></Card>}
    {!data && !result.error && <Card><LoadingState label="Loading study plan" /></Card>}
    {data && !id && !availability && <>
      <div className="stats-grid study-stats"><StatCard label="Planned today" value={data.summary.today} icon={CalendarDays} tone="violet" />
        <StatCard label="Upcoming sessions" value={data.summary.upcoming} icon={Timer} tone="blue" />
        <StatCard label="Completed study time" value={data.summary.actualMinutes + ' min'} icon={CheckCircle2} tone="green" /></div>
      <Card className="study-toolbar"><div className="editor-actions">
        <Button aria-pressed={daily} variant={daily ? 'primary':'secondary'} onClick={() => go(day,'day')}>Day</Button>
        <Button aria-pressed={!daily} variant={!daily ? 'primary':'secondary'} onClick={() => go(day,'week')}>Week</Button>
        <Button to={studyPath + '/availability'} variant="secondary">Availability</Button>
      </div><div className="editor-actions">
        <Button variant="secondary" onClick={() => go(shift(day,daily ? -1:-7))} aria-label={daily ? 'Previous day':'Previous week'}>‹</Button>
        <strong>{dateLabel(first,user)}{!daily && ' – ' + dateLabel(last,user)}</strong>
        <Button variant="secondary" onClick={() => go(shift(day,daily ? 1:7))} aria-label={daily ? 'Next day':'Next week'}>›</Button>
        <Button variant="secondary" onClick={() => go(today)}>Today</Button>
      </div></Card>
      {!data.items.length && <EmptyState icon={CalendarDays} title="No sessions in this view" description="Schedule a study session or browse another date." />}
      <div className={daily ? 'study-day-view' : 'week-grid'}>{Array.from({ length:daily ? 1:7 },(_,index) => shift(first,index)).map(date => {
        const sessions = data.items.filter(item => localStamp(new Date(item.startAt),user.timezone).slice(0,10) <= date &&
          localStamp(new Date(+new Date(item.endAt)-1),user.timezone).slice(0,10) >= date);
        return <Card key={date} className={'week-day study-day' + (date === today ? ' study-today':'')}>
          <h2>{weekdays[weekday(date)-1]} <small>{dateLabel(date,user)}</small></h2>
          {!sessions.length && <small>No sessions</small>}
          {sessions.map(item => <Link className={'week-meeting study-block ' + item.status} key={item.id} to={studyPath+'/'+item.id}
            style={{ '--course-color':item.courseColor || '#7253ce' }}>
            <strong>{item.title}</strong><span>{format(item.startAt,user)} – {format(item.endAt,user)}</span>
            <small>{[item.courseTitle || item.taskTitle,item.status.replace('_',' ')].filter(Boolean).join(' · ')}</small>
          </Link>)}
        </Card>;
      })}</div>
    </>}
    {data && availability && <>
      <div className="study-toolbar"><Button onClick={() => open('availability')}><Plus size={17} /> Add availability</Button></div>
      <div className="academic-grid">{weekdays.map((label,index) => <Card key={label} className="academic-detail">
        <h2>{label}</h2>
        {!data.items.some(item => item.weekday === index+1) && <small>No availability set</small>}
        {data.items.filter(item => item.weekday === index+1).map(item => <div key={item.id} className="study-slot">
          <strong>{wallTime(item.startTime,user)} – {wallTime(item.endTime,user)}</strong>
          {(item.effectiveFrom || item.effectiveUntil) && <small>{item.effectiveFrom || 'Any start date'} – {item.effectiveUntil || 'No end date'}</small>}
          <div className="editor-actions"><Button variant="secondary" onClick={() => open('availability',item)}>Edit</Button><Button variant="secondary" onClick={() => open('remove',item)}>Remove</Button></div>
        </div>)}
      </Card>)}</div>
    </>}
    {data && id && <Card className="academic-detail task-detail">
      <span className={'academic-status ' + data.status}>{data.status.replace('_',' ')}</span>
      <p>{format(data.startAt,user,'full')} – {format(data.endAt,user,'full')}</p>
      {data.objective && <p>{data.objective}</p>}
      <p>{data.courseId && <Link to={'/courses/'+data.courseId}>{data.courseTitle}</Link>}{data.courseId && data.taskId && ' · '}{data.taskId && <Link to={'/tasks/'+data.taskId}>{data.taskTitle}</Link>}{!data.courseId && !data.taskId && 'Personal study'}</p>
      <dl className="task-facts">
        <div><dt>Planned duration</dt><dd>{data.plannedMinutes} min</dd></div>
        <div><dt>Actual study time</dt><dd>{data.actualMinutes == null ? '—' : data.actualMinutes + ' min'}</dd></div>
        {data.completedAt && <div><dt>Completed</dt><dd>{format(data.completedAt,user,'full')}</dd></div>}
        {data.recurrence && <div><dt>Recurrence</dt><dd>{data.recurrence.ended ? 'Series ended' : data.recurrence.frequency + (data.recurrence.until ? ' through ' + data.recurrence.until : ' · ' + data.recurrence.count + ' sessions')}{data.isException ? ' · Edited occurrence' : ''}</dd></div>}
      </dl>
      <div className="editor-actions">
        {active && <><Button variant="secondary" onClick={() => open('edit',data)}>Edit session</Button><Button variant="secondary" onClick={() => open('reschedule',data)}>Reschedule</Button>
          <Button onClick={() => open('complete',data)}>Complete session</Button><Button variant="secondary" onClick={() => open('cancel',data)}>Cancel session</Button></>}
        {(active || closed) && data.seriesId && !data.recurrence?.ended && <Button variant="secondary" onClick={() => open('series',data)}>Edit series</Button>}
      </div>
    </Card>}
    {choices && (!courses.data || !tasks.data) && <Dialog title="Session details" action="Close" close={close} user={user} submit={async () => {}}>
      {courses.error || tasks.error ? <Alert error>{courses.error || tasks.error}</Alert> : <LoadingState label="Loading courses and tasks" />}
    </Dialog>}
    {(choices && courses.data && tasks.data || editor?.mode === 'reschedule') && <SessionEditor key={editor.mode}
      item={editor.item} mode={editor.mode} user={user} day={day} courses={courses.data?.items ?? []}
      tasks={[...(tasks.data?.items ?? []),...(editor.item?.taskId && !tasks.data?.items.some(task => task.id === editor.item.taskId) ? [{id:editor.item.taskId,title:editor.item.taskTitle}] : [])]} close={close}
      commit={payload => commit(editor.mode === 'new' ? sessionPath : path + ({series:'/series',reschedule:'/reschedule'}[editor.mode] || ''),
        editor.mode === 'new' ? 'POST' : 'PATCH',payload,editor.mode === 'new' ? 'Study session created.' : 'Study session updated.')} />}
    {editor?.mode === 'complete' && <Dialog title="Complete study session" action="Save completion" close={close} user={user}
      submit={form => commit(path+'/complete','PATCH',{ actualMinutes:Number(form.get('actualMinutes')) },'Study time recorded.')}>
      <p>{data.plannedMinutes} minutes planned</p><Input name="actualMinutes" label="Actual study minutes" type="number" min={0} max={10080} required defaultValue={data.plannedMinutes} />
    </Dialog>}
    {editor?.mode === 'cancel' && <Dialog title="Cancel this session?" action="Cancel session" close={close} user={user}
      submit={() => commit(path,'DELETE',{},'Session cancelled.')}>
      <p>This cancels the selected occurrence and retains it in your study history.</p>
    </Dialog>}
    {editor?.mode === 'availability' && <Dialog title={editor.item ? 'Edit availability':'Add availability'} action="Save availability" close={close} user={user}
      submit={form => commit('/availability' + (editor.item ? '/'+editor.item.id : ''),editor.item ? 'PATCH':'POST',{
        weekday:Number(form.get('weekday')),startTime:form.get('startTime'),endTime:form.get('endTime'),
        effectiveFrom:form.get('effectiveFrom') || null,effectiveUntil:form.get('effectiveUntil') || null,
      },'Availability saved.')}>
      <Select name="weekday" label="Weekday" defaultValue={editor.item?.weekday ?? 1} items={weekdays.map((label,index) => [index+1,label])} />
      <div className="task-field-grid"><Input name="startTime" label="Available from" type="time" required defaultValue={editor.item?.startTime ?? '16:00'} />
        <Input name="endTime" label="Available until" type="time" required defaultValue={editor.item?.endTime ?? '18:00'} />
        <Input name="effectiveFrom" label="First date (optional)" type="date" defaultValue={editor.item?.effectiveFrom ?? ''} />
        <Input name="effectiveUntil" label="Last date (optional)" type="date" defaultValue={editor.item?.effectiveUntil ?? ''} /></div>
    </Dialog>}
    {editor?.mode === 'remove' && <Dialog title="Remove availability?" action="Remove availability" close={close} user={user}
      submit={() => commit('/availability/'+editor.item.id,'DELETE',{},'Availability removed.')}><p>This removes the weekly time window.</p></Dialog>}
  </>;
}



