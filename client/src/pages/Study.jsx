import { t, useLanguage } from '../services/language';
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
  useLanguage();
  return <div className="field"><label htmlFor={name}>{t(label)}</label><select id={name} name={name} {...props}>
    {t(items.map(([value,label]) => <option key={value} value={value}>{['courseId','taskId','termId'].includes(name) && value !== '' ? label : t(label)}</option>))}
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
  useLanguage();
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
    <h2 id="study-dialog-title">{t(title)}</h2>
    <form onSubmit={event => {
      event.preventDefault();
      if (!pending) void save(new FormData(event.currentTarget),false);
    }} aria-busy={pending} onChange={() => { setError(null); setConflict(null); }}>
      <fieldset className="study-fields" disabled={pending}>{t(children)}</fieldset>
      {error && <Alert error>{t(error)}</Alert>}
      {conflict && <div className="study-conflicts"><Alert error>{t("This schedule overlaps with other study time. Revise the times or confirm the overlap below.")}</Alert>
        <ul>{t(conflict.details.map((item,index) => <li key={item.id ?? index}><strong>{item.title}</strong><br />{t(format(item.startAt,user,'full'))} – {t(format(item.endAt,user,'full'))}</li>))}</ul>
      </div>}
      <div className="editor-actions"><Button variant="secondary" onClick={close} disabled={pending}>{t("Cancel")}</Button>
        {conflict ? <Button onClick={() => save(conflict.data,true)} disabled={pending}>{t("Save despite overlap")}</Button> :
          <Button type="submit" disabled={pending}>{pending ? t('Saving…') : t(action)}</Button>}
      </div>
    </form>
  </dialog>;
}

function SessionEditor({ item,mode,user,day,courses,tasks,close,commit }) {
  useLanguage();
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
  const startField = <Input name="startAt" label={t("Start")} type="datetime-local" required value={startValue} onChange={e => setStartValue(e.target.value)} />;
  const modeField = <Select name="lengthMode" label={t("Set duration by")} items={[[ 'end','End time' ],[ 'minutes','Planned minutes' ]]} onChange={e => setDuration(e.target.value === 'minutes')} />;
  const endField = <Input name="endAt" label={t("End")} type="datetime-local" required value={endValue} onChange={e => setEndValue(e.target.value)} />;
  const minutesField = <Input name="minutes" label={t("Planned minutes")} type="number" required min={1} max={10080} value={minutes} onChange={e => setMinutes(e.target.value)} />;
  return <Dialog title={t({new:'New study session',edit:'Edit occurrence',reschedule:'Reschedule occurrence',series:'Edit series'}[mode])}
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
      <Input name="title" label={t("Session title")} required maxLength={150} defaultValue={item?.title} />
      <div className="field"><label htmlFor="objective">{t("Study objective")}</label><textarea name="objective" id="objective" rows={2} maxLength={5000} defaultValue={item?.objective ?? ''} /></div>
      <div className="task-field-grid">
        <Select name="courseId" label={t("Linked course")} items={[[ '', 'No course' ],...courses.map(course => [course.id,course.title])]} defaultValue={item?.courseId ?? ''} />
        <Select name="taskId" label={t("Linked task")} items={[[ '', 'No task' ],...tasks.map(task => [task.id,task.title])]} defaultValue={item?.taskId ?? ''} />
        <Select name="status" label={t("Status")} items={[[ 'planned','Planned' ],[ 'in_progress','In progress' ]]} defaultValue={item?.status === 'in_progress' ? 'in_progress' : 'planned'} />
      </div>
    </>}
    <p className="study-muted">{t("Times use ")}{t(user.timezone)}.</p>
    {mode === 'series' ? <div className="study-series-timing">
      {t(startField)}
      {duration ? <Input name="seriesEndPreview" label={t("End")} type="datetime-local" readOnly
        value={startInstant && planned >= 1 && planned <= 10080 ? localStamp(new Date(+startInstant + planned * 60000),user.timezone) : ''} /> : t(endField)}
      {t(modeField)}
      {duration ? t(minutesField) : <Input name="seriesDurationPreview" label={t("Duration")} readOnly value={planned > 0 ? planned + ' min planned' : ''} />}
    </div> : <>
      <div className={mode === 'new' ? "study-new-timing" : "task-field-grid"}>{t(startField)}{t(modeField)}{duration ? t(minutesField) : t(endField)}</div>
      {planned > 0 && <small>{t(planned)}{t(" min planned")}</small>}
    </>}
    {recurring && <div className="study-fields">
      <Select name="frequency" label={t("Repeat")} items={[[ '',mode === 'series' ? 'End series' : 'Does not repeat' ],[ 'daily','Daily' ],[ 'weekly','Weekly' ]]} value={frequency} onChange={e => setFrequency(e.target.value)} />
      {frequency === 'weekly' && <fieldset className="study-weekdays"><legend>{t("Repeat on")}</legend>{t(weekdays.map((name,index) => <label key={name}><input type="checkbox" name="weekdays" value={index+1} defaultChecked={item?.recurrence?.weekdays?.includes(index+1) ?? weekday(start.slice(0,10)) === index+1} />{t(name.slice(0,3))}</label>))}</fieldset>}
      {frequency && <div className="task-field-grid">
        <Select name="ending" label={t("Series ends by")} items={[[ 'count','Occurrence limit' ],[ 'date','End date' ]]} value={ending} onChange={e => setEnding(e.target.value)} />
        {ending === 'date' ? <Input name="until" label={t("Final date")} type="date" required defaultValue={item?.recurrence?.until ?? ''} /> :
          <Input name="count" label={t("Number of sessions")} type="number" required min={1} max={52} defaultValue={item?.recurrence?.count ?? 4} />}
      </div>}
      {mode === 'series' && <p className="study-muted">{t("Changes apply to future planned occurrences. Completed, cancelled, and individually edited occurrences stay in your history.")}</p>}
    </div>}
  </Dialog>;
}

export default function Study({ availability = false }) {
  useLanguage();
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
    <PageHeader title={availability ? t('Weekly availability') : id ? data?.title || t('Study session') : t('Study plan')}
      description={availability ? t('Set recurring windows for focused study in ') + t(user.timezone) + t('.') : t('Plan focused study time in ') + t(user.timezone) + t('.')}>
      {availability || id ? <Button to={studyPath} variant="secondary">{t("Back to study plan")}</Button> : <Button onClick={() => open('new')}><Plus size={17} />{t(" New session")}</Button>}
    </PageHeader>
    {notice && <div className="dashboard-notice"><Alert>{t(notice)}</Alert></div>}
    {result.error && <Card><Alert error>{t(result.error)}</Alert><Button className="retry-session" onClick={() => setVersion(value => value+1)}>{t("Retry")}</Button></Card>}
    {!data && !result.error && <Card><LoadingState label={t("Loading study plan")} /></Card>}
    {data && !id && !availability && <>
      <div className="stats-grid study-stats"><StatCard label={t("Planned today")} value={data.summary.today} icon={CalendarDays} tone="violet" />
        <StatCard label={t("Upcoming sessions")} value={data.summary.upcoming} icon={Timer} tone="blue" />
        <StatCard label={t("Completed study time")} value={data.summary.actualMinutes + ' min'} icon={CheckCircle2} tone="green" /></div>
      <Card className="study-toolbar"><div className="editor-actions">
        <Button aria-pressed={daily} variant={daily ? 'primary':'secondary'} onClick={() => go(day,'day')}>{t("Day")}</Button>
        <Button aria-pressed={!daily} variant={!daily ? 'primary':'secondary'} onClick={() => go(day,'week')}>{t("Week")}</Button>
        <Button to={studyPath + '/availability'} variant="secondary">{t("Availability")}</Button>
      </div><div className="editor-actions">
        <Button variant="secondary" onClick={() => go(shift(day,daily ? -1:-7))} aria-label={daily ? t('Previous day'):t('Previous week')}>‹</Button>
        <strong>{t(dateLabel(first,user))}{!daily && t(' – ') + t(dateLabel(last,user))}</strong>
        <Button variant="secondary" onClick={() => go(shift(day,daily ? 1:7))} aria-label={daily ? t('Next day'):t('Next week')}>›</Button>
        <Button variant="secondary" onClick={() => go(today)}>{t("Today")}</Button>
      </div></Card>
      {!data.items.length && <EmptyState icon={CalendarDays} title={t("No sessions in this view")} description={t("Schedule a study session or browse another date.")} />}
      <div className={daily ? 'study-day-view' : 'week-grid'}>{t(Array.from({ length:daily ? 1:7 },(_,index) => shift(first,index)).map(date => {
        const sessions = data.items.filter(item => localStamp(new Date(item.startAt),user.timezone).slice(0,10) <= date &&
          localStamp(new Date(+new Date(item.endAt)-1),user.timezone).slice(0,10) >= date);
        return <Card key={date} className={'week-day study-day' + (date === today ? ' study-today':'')}>
          <h2>{t(weekdays[weekday(date)-1])} <small>{t(dateLabel(date,user))}</small></h2>
          {!sessions.length && <small>{t("No sessions")}</small>}
          {t(sessions.map(item => <Link className={'week-meeting study-block ' + item.status} key={item.id} to={studyPath+'/'+item.id}
            style={{ '--course-color':item.courseColor || '#7253ce' }}>
            <strong>{item.title}</strong><span>{t(format(item.startAt,user))} – {t(format(item.endAt,user))}</span>
            <small>{t([item.courseTitle || item.taskTitle,item.status.replace('_',' ')].filter(Boolean).join(' · '))}</small>
          </Link>))}
        </Card>;
      }))}</div>
    </>}
    {data && availability && <>
      <div className="study-toolbar"><Button onClick={() => open('availability')}><Plus size={17} />{t(" Add availability")}</Button></div>
      <div className="academic-grid">{t(weekdays.map((label,index) => <Card key={label} className="academic-detail">
        <h2>{t(label)}</h2>
        {!data.items.some(item => item.weekday === index+1) && <small>{t("No availability set")}</small>}
        {t(data.items.filter(item => item.weekday === index+1).map(item => <div key={item.id} className="study-slot">
          <strong>{t(wallTime(item.startTime,user))} – {t(wallTime(item.endTime,user))}</strong>
          {(item.effectiveFrom || item.effectiveUntil) && <small>{item.effectiveFrom || t('Any start date')} – {item.effectiveUntil || t('No end date')}</small>}
          <div className="editor-actions"><Button variant="secondary" onClick={() => open('availability',item)}>{t("Edit")}</Button><Button variant="secondary" onClick={() => open('remove',item)}>{t("Remove")}</Button></div>
        </div>))}
      </Card>))}</div>
    </>}
    {data && id && <Card className="academic-detail task-detail">
      <span className={'academic-status ' + data.status}>{t(data.status.replace('_',' '))}</span>
      <p>{t(format(data.startAt,user,'full'))} – {t(format(data.endAt,user,'full'))}</p>
      {data.objective && <p>{data.objective}</p>}
      <p>{data.courseId && <Link to={'/courses/'+data.courseId}>{data.courseTitle}</Link>}{data.courseId && data.taskId && t(' · ')}{data.taskId && <Link to={'/tasks/'+data.taskId}>{data.taskTitle}</Link>}{!data.courseId && !data.taskId && t('Personal study')}</p>
      <dl className="task-facts">
        <div><dt>{t("Planned duration")}</dt><dd>{t(data.plannedMinutes)}{t(" min")}</dd></div>
        <div><dt>{t("Actual study time")}</dt><dd>{data.actualMinutes == null ? t('—') : t(data.actualMinutes) + t(' min')}</dd></div>
        {data.completedAt && <div><dt>{t("Completed")}</dt><dd>{t(format(data.completedAt,user,'full'))}</dd></div>}
        {data.recurrence && <div><dt>{t("Recurrence")}</dt><dd>{data.recurrence.ended ? t('Series ended') : t(data.recurrence.frequency) + (data.recurrence.until ? t(' through ') + t(data.recurrence.until) : t(' · ') + t(data.recurrence.count) + t(' sessions'))}{data.isException ? t(' · Edited occurrence') : t('')}</dd></div>}
      </dl>
      <div className="editor-actions">
        {active && <><Button variant="secondary" onClick={() => open('edit',data)}>{t("Edit session")}</Button><Button variant="secondary" onClick={() => open('reschedule',data)}>{t("Reschedule")}</Button>
          <Button onClick={() => open('complete',data)}>{t("Complete session")}</Button><Button variant="secondary" onClick={() => open('cancel',data)}>{t("Cancel session")}</Button></>}
        {(active || closed) && data.seriesId && !data.recurrence?.ended && <Button variant="secondary" onClick={() => open('series',data)}>{t("Edit series")}</Button>}
      </div>
    </Card>}
    {choices && (!courses.data || !tasks.data) && <Dialog title={t("Session details")} action="Close" close={close} user={user} submit={async () => {}}>
      {courses.error || tasks.error ? <Alert error>{courses.error || t(tasks.error)}</Alert> : <LoadingState label={t("Loading courses and tasks")} />}
    </Dialog>}
    {(choices && courses.data && tasks.data || editor?.mode === 'reschedule') && <SessionEditor key={editor.mode}
      item={editor.item} mode={editor.mode} user={user} day={day} courses={courses.data?.items ?? []}
      tasks={[...(tasks.data?.items ?? []),...(editor.item?.taskId && !tasks.data?.items.some(task => task.id === editor.item.taskId) ? [{id:editor.item.taskId,title:editor.item.taskTitle}] : [])]} close={close}
      commit={payload => commit(editor.mode === 'new' ? sessionPath : path + ({series:'/series',reschedule:'/reschedule'}[editor.mode] || ''),
        editor.mode === 'new' ? 'POST' : 'PATCH',payload,editor.mode === 'new' ? 'Study session created.' : 'Study session updated.')} />}
    {editor?.mode === 'complete' && <Dialog title={t("Complete study session")} action="Save completion" close={close} user={user}
      submit={form => commit(path+'/complete','PATCH',{ actualMinutes:Number(form.get('actualMinutes')) },'Study time recorded.')}>
      <p>{t(data.plannedMinutes)}{t(" minutes planned")}</p><Input name="actualMinutes" label={t("Actual study minutes")} type="number" min={0} max={10080} required defaultValue={data.plannedMinutes} />
    </Dialog>}
    {editor?.mode === 'cancel' && <Dialog title={t("Cancel this session?")} action="Cancel session" close={close} user={user}
      submit={() => commit(path,'DELETE',{},'Session cancelled.')}>
      <p>{t("This cancels the selected occurrence and retains it in your study history.")}</p>
    </Dialog>}
    {editor?.mode === 'availability' && <Dialog title={editor.item ? t('Edit availability'):t('Add availability')} action="Save availability" close={close} user={user}
      submit={form => commit('/availability' + (editor.item ? '/'+editor.item.id : ''),editor.item ? 'PATCH':'POST',{
        weekday:Number(form.get('weekday')),startTime:form.get('startTime'),endTime:form.get('endTime'),
        effectiveFrom:form.get('effectiveFrom') || null,effectiveUntil:form.get('effectiveUntil') || null,
      },'Availability saved.')}>
      <Select name="weekday" label={t("Weekday")} defaultValue={editor.item?.weekday ?? 1} items={weekdays.map((label,index) => [index+1,label])} />
      <div className="task-field-grid"><Input name="startTime" label={t("Available from")} type="time" required defaultValue={editor.item?.startTime ?? '16:00'} />
        <Input name="endTime" label={t("Available until")} type="time" required defaultValue={editor.item?.endTime ?? '18:00'} />
        <Input name="effectiveFrom" label={t("First date (optional)")} type="date" defaultValue={editor.item?.effectiveFrom ?? ''} />
        <Input name="effectiveUntil" label={t("Last date (optional)")} type="date" defaultValue={editor.item?.effectiveUntil ?? ''} /></div>
    </Dialog>}
    {editor?.mode === 'remove' && <Dialog title={t("Remove availability?")} action="Remove availability" close={close} user={user}
      submit={() => commit('/availability/'+editor.item.id,'DELETE',{},'Availability removed.')}><p>{t("This removes the weekly time window.")}</p></Dialog>}
  </>;
}



