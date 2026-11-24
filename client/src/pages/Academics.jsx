import { t, useLanguage } from '../services/language';
import { useEffect, useRef, useState } from 'react';
import { Archive, BookOpen, CalendarDays, Clock3, GraduationCap, Plus } from 'lucide-react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Alert, Button, Card, EmptyState, Input, LoadingState, PageHeader } from '../components/ui';
import { api } from '../services/api';
import { useSession } from '../services/session';
import { useDebouncedSearch } from '../services/useDebouncedSearch';

const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const termFields = [['name', 'Term name'], ['startDate', 'Start date', 'date'], ['endDate', 'End date', 'date']];
const courseFields = [['title', 'Course title'], ['code', 'Course code'], ['termId', 'Academic term', 'terms'], ['instructor', 'Instructor'], ['location', 'Location'], ['description', 'Description', 'textarea'], ['color', 'Course color', 'color']];
const meetingFields = [['weekday', 'Weekday', 'days'], ['startTime', 'Start time', 'time'], ['endTime', 'End time', 'time'], ['location', 'Location']];
const optional = ['instructor', 'location', 'description'];
const limits = { name: 100, title: 150, code: 40, instructor: 100, location: 150, description: 5000 };

async function all(path, signal) {
  const items = [];
  let page = 1;
  while (true) {
    const result = await api(path + (path.includes('?') ? '&' : '?') + 'limit=100&page=' + page, { signal });
    items.push(...result.items);
    if (items.length >= result.total || !result.items.length) return items;
    page += 1;
  }
}

function useData(path, revision, collection = false) {
  const [state, setState] = useState({});
  const key = path + ':' + revision;
  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    const load = collection ? all : (url, signal) => api(url, { signal });
    load(path, controller.signal).then(data => {
      if (!controller.signal.aborted) setState({ key, data });
    }).catch(error => {
      if (!controller.signal.aborted) setState({ key, error });
    });
    return () => controller.abort();
  }, [path, key, collection]);
  return state.key === key ? state : {};
}

function localDate(value, locale) {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(value + 'T00:00:00Z'));
}
function localTime(value, locale) {
  return new Intl.DateTimeFormat(locale, { timeStyle: 'short', timeZone: 'UTC' }).format(new Date('2000-01-01T' + value + ':00Z'));
}
function Status({ value }) {
  useLanguage();
  return <span className={'academic-status ' + value}>{t(value)}</span>;
}

function Editor({ edit, terms, onClose, onSave }) {
  useLanguage();
  const dialog = useRef(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { dialog.current.showModal(); }, []);
  return <dialog ref={dialog} className="academic-dialog" aria-labelledby="editor-title" onCancel={event => {
    event.preventDefault();
    if (!pending) onClose();
  }}>
    <h2 id="editor-title">{t(edit.title)}</h2>
    {edit.description && <p>{t(edit.description)}</p>}
    <form aria-busy={pending} onSubmit={async event => {
      event.preventDefault();
      if (pending) return;
      const data = Object.fromEntries(new FormData(event.currentTarget));
      for (const name of ['weekday', 'termId']) if (name in data) data[name] = Number(data[name]);
      setError('');
      setPending(true);
      try {
        await onSave(edit, data);
      } catch (error) {
        setError(error.message);
      } finally {
        setPending(false);
      }
    }}>
      {t(edit.fields?.map(([name, label, type = 'text']) => {
        const value = edit.values?.[name] ?? (name === 'color' ? '#7253ce' : '');
        if (type === 'terms' || type === 'days') {
          const options = type === 'terms' ? terms.map(term => [term.id, term.name]) : days.map((day, index) => [index + 1, day]);
          return <div className="field" key={name}><label htmlFor={name}>{t(label)}</label><select id={name} name={name} defaultValue={value} required>
            <option value="">{t("Select ")}{t(label.toLowerCase())}</option>{t(options.map(([id, text]) => <option key={id} value={id}>{t(text)}</option>))}
          </select></div>;
        }
        if (type === 'textarea') return <div className="field" key={name}><label htmlFor={name}>{t(label)}</label><textarea id={name} name={name} defaultValue={value} maxLength={limits[name]} rows={3} /></div>;
        return <Input key={name} name={name} label={t(label)} type={type} defaultValue={value} required={!optional.includes(name)} maxLength={limits[name]} />;
      }))}
      {error && <Alert error>{t(error)}</Alert>}
      <div className="editor-actions"><Button variant="secondary" onClick={onClose} disabled={pending}>{t("Cancel")}</Button><Button type="submit" disabled={pending}>{pending ? t('Saving…') : edit.action || t('Save changes')}</Button></div>
    </form>
  </dialog>;
}

export default function Academics({ view }) {
  useLanguage();
  const { user } = useSession();
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const [revision, setRevision] = useState(0);
  const [edit, setEdit] = useState(() => view === 'courses' && !id && params.has('create') ? { title: 'Create course', path: '/courses', fields: courseFields, action: 'Create course', method: 'POST' } : null);
  const [notice, setNotice] = useState('');
  const isTerm = view === 'terms';
  const isWeek = view === 'timetable';
  const resource = isTerm ? '/terms' : '/courses';
  const status = params.get('status') || (isTerm ? 'current' : 'active');
  const term = params.get('termId') || '';
  const search = params.get('search') || '';
  const [searchDraft, setSearchDraft] = useDebouncedSearch(search, value => filter('search', value), view === 'courses' && !id);
  const page = Number(params.get('page') || 1);
  const filters = new URLSearchParams({ page, limit: 9 });
  if (status !== 'all') filters.set('status', status);
  if (!isTerm && term) filters.set('termId', term);
  if (!isTerm && search.trim()) filters.set('search', search.trim());
  const path = isWeek ? '/timetable' : resource + (id ? '/' + id : '?' + filters);
  const main = useData(path, revision);
  const termData = useData(view === 'courses' ? '/terms?status=current' : null, revision, true);
  const meetingPath = id && view === 'courses' ? '/courses/' + id + '/schedules' : null;
  const meetingData = useData(meetingPath, revision, true);
  const terms = termData.data ?? [];
  const item = main.data;
  const archived = item?.status === 'archived';
  const courseEditable = item?.termStatus !== 'archived';
  const label = isTerm ? 'term' : 'course';
  const entityFields = isTerm ? termFields : courseFields;
  const refresh = () => setRevision(value => value + 1);

  function filter(name, value) {
    const next = new URLSearchParams(params);
    if (value) next.set(name, value);
    else next.delete(name);
    if (name !== 'page') next.delete('page');
    setParams(next, { replace: true });
  }
  function open(title, path, fields, values, action, method = 'POST', description) {
    setNotice('');
    setEdit({ title, path, fields, values, action, method, description });
  }
  function archive() {
    open('Archive ' + label + '?', path, null, null, 'Archive ' + label, 'DELETE',
      isTerm ? 'The term and its courses remain in your history. Its meetings are hidden from the timetable.' : 'The course and its meetings remain in your history.');
  }

  return <>
    <PageHeader title={isWeek ? t('Weekly timetable') : id ? item?.name || item?.title || (isTerm ? t('Term details') : t('Course details')) : isTerm ? t('Academic terms') : t('Courses')}
      description={isWeek ? t('Recurring class meetings in ') + t(user.timezone) + t('.') : isTerm ? t('Organize courses around your academic terms.') : t('Manage your classes and their weekly meetings.')}>
      {isWeek ? <Button to="/courses" variant="secondary"><BookOpen size={17} />{t(" Manage courses")}</Button> : id ?
        <Button to={resource} variant="secondary">{t("Back to ")}{isTerm ? t('terms') : t('courses')}</Button> :
        <Button disabled={!isTerm && !terms.length} onClick={() => open('Create ' + label, resource, entityFields, { termId: term }, 'Create ' + label)}><Plus size={17} />{t('New ' + label)}</Button>}
    </PageHeader>
    {!isWeek && <nav className="academic-tabs" aria-label={t("Academics")}>
      <Link to="/terms" aria-current={isTerm ? 'page' : undefined}>{t("Academic terms")}</Link>
      <Link to="/courses" aria-current={view === 'courses' ? 'page' : undefined}>{t("Courses")}</Link>
      <Link to="/timetable">{t("Weekly timetable")}</Link>
    </nav>}
    {notice && <div className="dashboard-notice"><Alert>{t(notice)}</Alert></div>}
    {!id && !isWeek && <div className="academic-filters">
      {!isTerm && <div className="field"><label htmlFor="course-search">{t("Search courses")}</label><input id="course-search" type="search" placeholder={t("Title or code")} maxLength={150} value={searchDraft} onChange={event => setSearchDraft(event.target.value)} /></div>}
      {!isTerm && <div className="field"><label htmlFor="term-filter">{t("Academic term")}</label><select id="term-filter" value={term} onChange={event => filter('termId', event.target.value)}>
        <option value="">{t("All terms")}</option>{term && !terms.some(termOption => String(termOption.id) === term) && <option value={term}>{t("Selected term")}</option>}{t(terms.map(option => <option key={option.id} value={option.id}>{option.name}</option>))}
      </select></div>}
      <div className="field"><label htmlFor="status-filter">{t("Status")}</label><select id="status-filter" value={status} onChange={event => filter('status', event.target.value)}>
        {t((isTerm ? [['current', 'Current terms'], ['active', 'Active'], ['upcoming', 'Upcoming'], ['completed', 'Completed']] : [['active', 'Active']]).concat([['archived', 'Archived'], ['all', 'All statuses']]).map(([value, text]) => <option key={value} value={value}>{t(text)}</option>))}
      </select></div>
    </div>}
    {(main.error || termData.error || meetingData.error) && <Card><Alert error>{t((main.error || termData.error || meetingData.error).message)}</Alert><Button className="retry-session" onClick={refresh}>{t("Retry")}</Button></Card>}
    {!item && !main.error && <Card><LoadingState label={t("Loading academic records")} /></Card>}
    {item && isWeek && (item.items.length ? <div className="week-grid">
      {t(days.map((day, index) => <Card className="week-day" key={day}><h2>{t(day)}</h2>
        {t(item.items.filter(meeting => meeting.weekday === index + 1).map(meeting => <Link className="week-meeting" style={{ '--course-color': meeting.color || '#7253ce' }} to={'/courses/' + meeting.courseId} key={meeting.id}>
          <strong>{meeting.title}</strong><span>{t(localTime(meeting.startTime, user.locale))}–{t(localTime(meeting.endTime, user.locale))}</span>
          {(meeting.location || meeting.courseLocation) && <small>{meeting.location || t(meeting.courseLocation)}</small>}
        </Link>))}
        {!item.items.some(meeting => meeting.weekday === index + 1) && <small>{t("No classes")}</small>}
      </Card>))}
    </div> : <EmptyState icon={CalendarDays} title={t("No weekly meetings yet")} description={t("Open a course to add recurring meeting times.")}><Button to="/courses">{t("Browse courses")}</Button></EmptyState>)}
    {item && !id && !isWeek && <>
      {item.items.length ? <div className="academic-grid">{t(item.items.map(record => <Card className={isTerm ? 'academic-card' : 'academic-card course-card'} key={record.id}>
        <div className="academic-card-top"><span className="tile" style={record.color ? { borderLeft: '4px solid ' + record.color } : undefined}>{isTerm ? <GraduationCap size={20} /> : <BookOpen size={20} />}</span><Status value={record.status} /></div>
        <h2><Link to={resource + '/' + record.id}>{record.name || record.title}</Link></h2>
        <p>{isTerm ? t(localDate(record.startDate, user.locale)) + t(' – ') + t(localDate(record.endDate, user.locale)) : record.code + t(' · ') + record.termName}</p>
        {isTerm ? <small>{t(record.courseCount)} {record.courseCount === 1 ? t('course') : t('courses')}</small> : <small>{t([record.instructor, record.location].filter(Boolean).join(' · '))}</small>}
      </Card>))}</div> : <EmptyState icon={isTerm ? GraduationCap : BookOpen} title={t(isTerm ? 'No terms found' : 'No courses found')}
        description={!isTerm && termData.data && !terms.length ? t('Create an academic term before adding a course.') : t('Try different filters or add a new record.')}>
        {!isTerm && termData.data && !terms.length && <Button to="/terms">{t("Go to academic terms")}</Button>}
      </EmptyState>}
      {item.total > item.limit && <div className="academic-pagination"><Button variant="secondary" disabled={page <= 1} onClick={() => filter('page', page - 1)}>{t("Previous")}</Button>
        <span>{t("Page ")}{t(page)}{t(" of ")}{t(Math.ceil(item.total / item.limit))}</span><Button variant="secondary" disabled={page * item.limit >= item.total} onClick={() => filter('page', page + 1)}>{t("Next")}</Button>
      </div>}
    </>}
    {item && id && <>
      <Card className="academic-detail">
        <Status value={item.status} />
        {isTerm ? <><p>{t(localDate(item.startDate, user.locale))} – {t(localDate(item.endDate, user.locale))}</p><Button to={'/courses?termId=' + id + '&status=all'} variant="secondary">{t("View courses (")}{t(item.courseCount)})</Button></> :
          <><p>{item.code} · <Link to={'/terms/' + item.termId}>{item.termName}</Link></p>{item.instructor && <p>{t("Instructor · ")}{item.instructor}</p>}{item.location && <p>{t("Location · ")}{item.location}</p>}{item.description && <p>{item.description}</p>}</>}
        {!archived && <div className="editor-actions">
          <Button variant="secondary" onClick={() => open('Edit ' + label, path, entityFields, item, 'Save changes', 'PATCH')} disabled={!isTerm && !terms.length}>{t('Edit ' + label)}</Button>
          <Button variant="secondary" onClick={archive}><Archive size={16} />{t('Archive ' + label)}</Button>
        </div>}
      </Card>
      {meetingPath && <Card className="academic-detail">
        <div className="academic-card-top"><h2>{t("Weekly meeting times")}</h2>{!archived && courseEditable && <Button onClick={() => open('Add meeting time', meetingPath, meetingFields, null, 'Add meeting')}><Plus size={16} />{t(" Add meeting")}</Button>}</div>
        <p>{t("Local class times in ")}{t(user.timezone)}</p>
        {!meetingData.data && !meetingData.error && <LoadingState label={t("Loading meetings")} />}
        {meetingData.data?.length === 0 && <p>{t("No meetings yet. Add a weekday and time to begin.")}</p>}
        {t(meetingData.data?.map(meeting => <div className="academic-meeting" key={meeting.id}><Clock3 size={18} /><div><strong>{t(days[meeting.weekday - 1])}</strong>
          <p>{t(localTime(meeting.startTime, user.locale))}–{t(localTime(meeting.endTime, user.locale))}{meeting.location ? t(' · ') + meeting.location : t('')}</p></div>
          {!archived && courseEditable && <div className="editor-actions">
            <Button variant="secondary" onClick={() => open('Edit meeting time', meetingPath + '/' + meeting.id, meetingFields, meeting, 'Save changes', 'PATCH')}>{t("Edit")}</Button>
            <Button variant="secondary" onClick={() => open('Delete meeting time?', meetingPath + '/' + meeting.id, null, null, 'Delete meeting', 'DELETE', 'This removes the recurring meeting from your timetable.')}>{t("Delete")}</Button>
          </div>}
        </div>))}
      </Card>}
    </>}
    {edit && !isTerm && !termData.data && !termData.error && <Card><LoadingState label={t("Loading academic terms")} /></Card>}
    {edit && !isTerm && termData.data && !terms.length && <EmptyState icon={GraduationCap} title={t("Create an academic term first")} description={t("Each course belongs to a term.")}><Button to="/terms">{t("Go to academic terms")}</Button></EmptyState>}
    {edit && (isTerm || terms.length > 0) && <Editor edit={edit} terms={terms} onClose={() => setEdit(null)} onSave={async (edit, data) => {
      await api(edit.path, { method: edit.method, data });
      setNotice(edit.method === 'DELETE' ? (edit.fields || edit.path.includes('/schedules/') ? 'Meeting deleted.' : 'Record archived.') : 'Changes saved.');
      setEdit(null);
      refresh();
    }} />}
  </>;
}

