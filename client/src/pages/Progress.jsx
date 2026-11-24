import { t, useLanguage } from '../services/language';
import { useState } from 'react';
import { BarChart3, CheckCircle2, Clock3, Timer } from 'lucide-react';
import { Alert,Button,Card,EmptyState,Input,PageHeader,StatCard } from '../components/ui';
import { useSession } from '../services/session';
import { displayDate,OverviewSkeleton,shiftDay,useOverview } from './Calendar';
import { localStamp } from '../../../shared/task-time.js';

function Trend({rows,metrics,user,month=false}) {
  useLanguage();
  const peak=Math.max(1,...rows.flatMap(item=>metrics.map(([key])=>item[key])));
  const [page,setPage]=useState(0);
  const size=12;
  const start=Math.min(page,Math.max(0,Math.ceil(rows.length/size)-1));
  const visible=rows.slice(start*size,(start+1)*size);
  return <>
    <div className="dashboard-legend">{t(metrics.map(([key,label])=><small key={key}>{t(label)}</small>))}</div>
    <div className="progress-chart" style={{'--chart-count':visible.length}}>
      {t(visible.map(item=>{
        const label=displayDate(item.date,user,month?{month:'short',year:'2-digit'}:{month:'short',day:'numeric'});
        const details=metrics.map(([key,name])=>name+' '+Math.round(item[key]*10)/10).join(', ');
        return <div key={item.date} className="progress-column" title={t(label)+t(' · ')+t(details)}>
          <div className="study-bars" role="img" aria-label={t(label)+t(' · ')+t(details)}>
            {t(metrics.map(([key])=><i key={key} style={{height:item[key]/peak*100+'%'}}/>))}
          </div><small>{t(label)}</small>
        </div>;
      }))}
    </div>
    {rows.length>size&&<div className="editor-actions">
      <Button variant="secondary" disabled={!start} onClick={()=>setPage(start-1)}>{t("Earlier")}</Button>
      <small>{t("Group ")}{t(start + 1)}{t(" of ")}{t(Math.ceil(rows.length/size))}</small>
      <Button variant="secondary" disabled={(start+1)*size>=rows.length} onClick={()=>setPage(start+1)}>{t("Later")}</Button>
    </div>}
  </>;
}
const studyMetrics=[['planned','Planned minutes'],['actual','Actual minutes']];
const taskMetrics=[['completed','Tasks completed']];
export default function Progress() {
  useLanguage();
  const {user}=useSession();
  const today=localStamp(new Date(),user.timezone).slice(0,10);
  const [applied,setApplied]=useState({from:shiftDay(today,-27),to:today,group:'week',courseId:''});
  const [revision,retry]=useState(0);
  const [validation,setValidation]=useState('');
  const query=new URLSearchParams(Object.entries(applied).filter(([,value])=>value));
  const {data,error}=useOverview('/analytics/overview?'+query,revision);
  const termOptions=useOverview('/courses?limit=100',revision);
  const [knownCourses,setKnownCourses]=useState(null);
  if(data && knownCourses!==data.courseOptions) setKnownCourses(data.courseOptions);
  const courses=knownCourses??termOptions.data?.items??[];
  const hours=minutes=>new Intl.NumberFormat(user.locale,{maximumFractionDigits:1}).format(minutes/60)+' h';
  return <>
    <PageHeader title={t("Progress")} description={t('Review study time, task completion, and coursework in ')+t(user.timezone)+t('.')} />
    <Card className="progress-filters">
      <form className="task-field-grid" onSubmit={event=>{
        event.preventDefault();
        const next=Object.fromEntries(new FormData(event.currentTarget));
        if(next.from>next.to||Date.parse(next.to)-Date.parse(next.from)>=366*86400000) {
          setValidation('Choose an end date on or after the start date, within 366 days.');
          return;
        }
        setValidation('');setApplied(next);
      }}>
        <Input name="from" type="date" label={t("From")} defaultValue={applied.from} required/>
        <Input name="to" type="date" label={t("Through")} defaultValue={applied.to} required/>
        <div className="field"><label htmlFor="analytics-course">{t("Course")}</label><select id="analytics-course" name="courseId" defaultValue={applied.courseId}>
          <option value="">{t("All courses")}</option>{t(courses.map(item=><option key={item.id} value={item.id}>{item.title}</option>))}
        </select></div>
        <div className="field"><label htmlFor="analytics-group">{t("Group by")}</label><select id="analytics-group" name="group" defaultValue={applied.group}>
          <option value="day">{t("Day")}</option><option value="week">{t("Week")}</option><option value="month">{t("Month")}</option>
        </select></div>
        <Button type="submit">{t("Apply filters")}</Button>
      </form>
      {validation&&<Alert error>{t(validation)}</Alert>}
    </Card>
    {error&&<Card><Alert error>{t(error)}</Alert><Button className="retry-session" onClick={()=>retry(n=>n+1)}>{t("Retry")}</Button></Card>}
    {!data&&!error&&<OverviewSkeleton/>}
    {data&&<>
      <div className="stats-grid">
        <StatCard icon={Clock3} label={t("Actual study time")} value={hours(data.study.actual)} detail={data.study.activeDays+' days with recorded study'} tone="green"/>
        <StatCard icon={Timer} label={t("Planned study time")} value={hours(data.study.planned)} detail={data.study.plannedSessions+' open sessions'} tone="violet"/>
        <StatCard icon={CheckCircle2} label={t("Task completion")} value={data.tasks.completion+'%'} detail={data.tasks.completed+' completed · '+data.tasks.pending+' pending'} tone="blue"/>
        <StatCard icon={BarChart3} label={t("Completed sessions")} value={data.study.completedSessions} detail={data.study.cancelledSessions+' cancelled'} tone="amber"/>
      </div>
      {!data.courses.length?<EmptyState icon={BarChart3} title={t("No activity in this range")} description={t("Choose a wider date range or another course to see study and task progress.")}/>:
      <div className="dashboard-grid progress-grid">
        <Card><h2>{t("Study time")}</h2><p>{t("Planned time follows the scheduled dates. Actual time is recorded on the session’s start date.")}</p>
          <Trend key={query.toString()} rows={data.series} metrics={studyMetrics} user={user}/>
        </Card>
        <Card><h2>{t("Monthly study trend")}</h2><p>{t("Compare scheduled minutes with recorded study time.")}</p><Trend rows={data.monthly} metrics={studyMetrics} user={user} month/></Card>
        <Card><h2>{t("Tasks completed over time")}</h2><p>{t("Counts unique tasks completed each day. A reopened task can be completed again on another day.")}</p>
          <Trend key={query.toString()} rows={data.series} metrics={taskMetrics} user={user}/>
        </Card>
        <Card><h2>{t("Task workload")}</h2><p>{t(data.tasks.pending)}{t(" pending · ")}{t(data.tasks.overdue)}{t(" overdue · ")}{t(data.tasks.upcomingEstimateMinutes)}{t(" min of upcoming estimated work")}</p>
          <div className="task-progress"><progress aria-label={t("Task completion percentage")} value={data.tasks.completion} max={100}/><small>{t(data.tasks.completion)}{t("% completed")}</small></div>
          <dl className="task-facts">{t(Object.entries(data.tasks.priority).map(([label,value])=><div key={label}><dt>{t(label)}{t(" priority")}</dt><dd>{t(value)}</dd></div>))}</dl>
          <small>{t("Includes unarchived tasks created, due, or completed in the selected range. Status reflects the current task.")}</small>
        </Card>
        <Card className="dashboard-events"><h2>{t("Course progress")}</h2>
          <div className="progress-courses">{t(data.courses.map(item=><div key={item.id??'personal'} className="progress-course">
            <strong style={{borderLeftColor:item.color}}>{item.title}</strong>
            <small>{t(hours(item.actual))}{t(" actual · ")}{t(hours(item.planned))}{t(" planned")}</small>
            <progress value={item.completed} max={Math.max(item.tasks,1)} aria-label={item.title+t(' task completion')}/>
            <small>{t(item.completed)}{t(" of ")}{t(item.tasks)}{t(" tasks completed")}</small>
          </div>))}</div>
        </Card>
      </div>}
    </>}
  </>;
}
