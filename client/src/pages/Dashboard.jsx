import { useState } from 'react';
import { displayDate, displayTime, eventLink, eventNames, OverviewSkeleton, useOverview } from './Calendar';
import { useSession } from '../services/session';
import { ArrowDownRight, ArrowRight, BookOpen, CalendarDays, CheckCircle2, ClipboardList, Clock3, Plus, Timer } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { Alert, Button, Card, PageHeader, StatCard } from '../components/ui';

const deadlines = [
  ['Calculus problem set', 'MATH 201', 'Today', 'violet'],
  ['Research outline', 'PSYC 101', 'Tomorrow', 'amber'],
  ['Interface critique', 'DES 240', 'Friday', 'green'],
];

const sessions = [
  ['14:00', 'Calculus review', '45 min', 'violet'],
  ['16:30', 'Read for psychology', '30 min', 'green'],
];

const week = [['Mon', 45], ['Tue', 75], ['Wed', 60], ['Thu', 90], ['Fri', 0], ['Sat', 0], ['Sun', 0]];

function LiveDashboard() {
  const {user}=useSession();
  const {state}=useLocation();
  const [revision,setRevision]=useState(0);
  const {data,error}=useOverview('/dashboard/summary',revision);
  const actions=<div className="editor-actions">
    <Button to="/tasks?create=1"><Plus size={17}/> Create task</Button>
    <Button variant="secondary" to="/study-plan?create=1"><Timer size={17}/> New study session</Button>
    <Button variant="secondary" to="/courses?create=1"><BookOpen size={17}/> Add course</Button>
    <Button variant="secondary" to="/calendar"><CalendarDays size={17}/> Open calendar</Button>
  </div>;
  const next=data?.nextSession;
  const percent=data?.plannedMinutes ? Math.round(data.actualMinutes/data.plannedMinutes*100) : null;
  const max=Math.max(1,...(data?.weeklyProgress ?? []).flatMap(day=>[day.planned,day.actual]));
  return <>
    <div className="dashboard-welcome">
      <PageHeader title={'Welcome, '+user.displayName} description={data ? displayDate(data.today,user,{dateStyle:'full'})+' · '+(data.activeTerm?.name ?? 'No active term') : 'Your study overview'}/>
      {actions}
    </div>
    {state?.notice && <div className="dashboard-notice"><Alert>{state.notice}</Alert></div>}
    {error && <Card><Alert error>{error}</Alert><Button className="retry-session" onClick={()=>setRevision(n=>n+1)}>Retry</Button></Card>}
    {!data && !error && <OverviewSkeleton/>}
    {data && <>
      <div className="stats-grid">
        <StatCard icon={BookOpen} label="Active courses" value={data.activeCourses} detail={data.activeTerm?.name ?? 'No active term'} tone="violet"/>
        <StatCard icon={ClipboardList} label="Pending tasks" value={data.pending} detail={data.overdue+' overdue'} tone="amber"/>
        <StatCard icon={CalendarDays} label="Upcoming deadlines" value={data.upcoming} detail="Pending tasks with a deadline" tone="blue"/>
        <StatCard icon={Timer} label="Completed study time" value={data.actualMinutes+' min'} detail="Actual time this week" tone="green"/>
      </div>
      <div className="dashboard-grid live-dashboard">
        <Card><div className="card-head"><h2>Today’s study plan</h2><Link to="/study-plan">Study plan <ArrowRight size={15}/></Link></div>
          {data.todaySessions.length ? <ul className="rows">{data.todaySessions.map(item=><li key={item.id}>
            <span className="tile" style={{borderLeft:'4px solid '+(item.color || '#7253ce')}}><Clock3 size={17}/></span>
            <div><Link className="task-title" to={'/study-plan/'+item.id}>{item.title}</Link><small>{displayTime(item.startAt,user)} – {displayTime(item.endAt,user)} · {item.status.replaceAll('_',' ')}</small></div>
          </li>)}</ul> : <p>No study sessions today.</p>}
          {next && <p className="dashboard-next">Next session · <Link to={'/study-plan/'+next.id}>{next.title}</Link> · {displayTime(next.startAt,user,true)}</p>}
        </Card>
        <Card><div className="card-head"><h2>Deadlines</h2><Link to="/tasks">All tasks <ArrowRight size={15}/></Link></div>
          {data.deadlines.length ? <ul className="rows">{data.deadlines.map(item=><li key={item.id}>
            <span className="tile" style={{borderLeft:'4px solid '+(item.color || '#a26622')}}><ClipboardList size={17}/></span>
            <div><Link className="task-title" to={'/tasks/'+item.id}>{item.title}</Link><small>{item.courseTitle || 'Personal'} · {item.date ? displayDate(item.date,user) : displayTime(item.startAt,user,true)}</small></div>
            <span className={'academic-status priority-'+item.priority}>{item.overdue ? 'Overdue · ' : ''}{item.priority}</span>
          </li>)}</ul> : <p>No pending deadlines.</p>}
        </Card>
        <Card><div className="card-head"><h2>Weekly study progress</h2><Link to="/study-plan">Study plan <ArrowRight size={15}/></Link></div>
          <p>{data.plannedMinutes} min planned · {data.actualMinutes} min actual{percent===null ? ' · No planned time' : ' · '+percent+'% of plan'}</p>
          <div className="chart">{data.weeklyProgress.map(day=><div className="chart-day" key={day.date}>
            <div className="study-bars" role="img" aria-label={Math.round(day.planned)+' planned minutes, '+day.actual+' actual minutes'}>
              <i style={{height:day.planned/max*100+'%'}}/><i style={{height:day.actual/max*100+'%'}}/>
            </div><small>{displayDate(day.date,user,{weekday:'short'})}</small>
          </div>)}</div>
          <div className="dashboard-legend"><small>Planned</small><small>Actual</small></div>
        </Card>
        <Card><div className="card-head"><h2>Task completion</h2><Link to="/tasks">Tasks <ArrowRight size={15}/></Link></div>
          <strong className="dashboard-percent">{data.taskCompletion}%</strong>
          <div className="task-progress"><progress value={data.taskCompletion} max={100} aria-label="Task completion percentage"/></div>
          <p>{data.completed} completed · {data.pending} pending</p>
        </Card>
        <Card className="dashboard-events"><div className="card-head"><h2>Upcoming calendar events</h2><Link to="/calendar">Calendar <ArrowRight size={15}/></Link></div>
          {data.upcomingEvents.length ? <ul className="rows">{data.upcomingEvents.map(event=><li key={event.id}>
            <span className="tile" style={{borderLeft:'4px solid '+event.color}}><CalendarDays size={17}/></span>
            <div><Link className="task-title" to={eventLink(event)}>{event.title}</Link><small>{eventNames[event.type]} · {event.date ? displayDate(event.date,user) : displayTime(event.startAt,user,true)}</small></div>
          </li>)}</ul> : <p>No events in the next week.</p>}
        </Card>
      </div>
    </>}
  </>;
}

export default function Dashboard({ preview = false }) {
  if (!preview) return <LiveDashboard/>;
  return <>
    <PageHeader title="Your study overview" description="A sample week of courses, deadlines, and study sessions.">
      <Button to="/preview/study-plan"><CalendarDays size={17} /> View study plan</Button>
    </PageHeader>
    <div className="stats-grid">
      <StatCard icon={BookOpen} label="Active courses" value="3" detail="Across the current term" tone="violet" />
      <StatCard icon={ClipboardList} label="Open tasks" value="3" detail="1 due today" tone="amber" />
      <StatCard icon={Timer} label="Study time" value="4h 30m" detail="Logged this week" tone="green" />
      <StatCard icon={CheckCircle2} label="Tasks complete" value="70%" detail="7 of 10 this week" tone="blue" />
    </div>
    <div className="dashboard-grid">
      <Card><div className="card-head"><h2>Upcoming deadlines</h2><Link to="/preview/tasks">All tasks <ArrowRight size={15} /></Link></div>
        <ul className="rows">{deadlines.map(([name, course, date, tone]) => <li key={name}><span className={'tile ' + tone}><ClipboardList size={17} /></span><div><strong>{name}</strong><small>{course}</small></div><span className={'date ' + tone}>{date}</span></li>)}</ul>
      </Card>
      <Card><div className="card-head"><h2>Today’s study sessions</h2><Link to="/preview/calendar">Calendar <ArrowRight size={15} /></Link></div>
        <ul className="rows">{sessions.map(([time, name, duration, tone]) => <li key={time}><span className={'tile ' + tone}><Clock3 size={17} /></span><div><strong>{name}</strong><small>{time}</small></div><span className="duration">{duration}</span></li>)}</ul>
      </Card>
      <Card><div className="card-head"><h2>Weekly study time</h2><Link to="/preview/progress">Progress <ArrowRight size={15} /></Link></div>
        <div className="chart" aria-label="Study minutes by day">{week.map(([day, minutes]) => <div className="chart-day" key={day}><div className="bar-track"><div className="bar" style={{ height: Math.max(4, minutes) + '%' }} title={minutes + ' minutes'} /></div><small>{day}<span className="sr-only">{' ' + minutes + ' minutes'}</span></small></div>)}</div>
      </Card>
      <Card><div className="card-head"><h2>Quick actions</h2><ArrowDownRight size={18} /></div>
        <div className="quick-links"><Button to="/preview/tasks" variant="secondary"><Plus size={17} /> Explore tasks</Button><Button to="/preview/courses" variant="secondary"><BookOpen size={17} /> Explore courses</Button><Button to="/preview/calendar" variant="secondary"><CalendarDays size={17} /> Open calendar</Button></div>
      </Card>
    </div>
  </>;
}



