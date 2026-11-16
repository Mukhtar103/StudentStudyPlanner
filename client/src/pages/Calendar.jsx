import { useEffect,useRef,useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { Alert,Button,Card,EmptyState,PageHeader } from '../components/ui';
import { useSession } from '../services/session';
import { api } from '../services/api';
import { localStamp } from '../../../shared/task-time.js';

export const eventNames = {course:'Class meeting',task:'Task deadline',study:'Study session',term:'Academic term'};
export const eventLink = event => ({course:'/courses/',task:'/tasks/',study:'/study-plan/',term:'/terms/'})[event.type]+event.sourceId;
export const shiftDay = (date,n) => new Date(Date.parse(date+'T00:00Z')+n*86400000).toISOString().slice(0,10);
const monday = date => shiftDay(date,1-(new Date(date+'T00:00Z').getUTCDay()||7));
const monthShift = (date,n) => {
  const given = new Date(date.slice(0,7)+'-01T00:00Z');
  given.setUTCMonth(given.getUTCMonth()+n);
  return given.toISOString().slice(0,10);
};
export function displayDate(date,user,options={dateStyle:'medium'}) {
  return new Intl.DateTimeFormat(user.locale,{...options,timeZone:'UTC'}).format(new Date(date+'T00:00Z'));
}
export function displayTime(instant,user,withDate=false) {
  return new Intl.DateTimeFormat(user.locale,{timeZone:user.timezone,timeStyle:'short',...(withDate ? {dateStyle:'medium'} : {})}).format(new Date(instant));
}
export function useOverview(path,revision) {
  const [state,setState] = useState({});
  const key=path+':'+revision;
  useEffect(()=>{
    const controller=new AbortController();
    api(path,{signal:controller.signal}).then(data=>{
      if(!controller.signal.aborted) setState({key,data});
    }).catch(error=>{
      if(!controller.signal.aborted) setState({key,error:error.message});
    });
    return ()=>controller.abort();
  },[key,path]);
  return state.key===key ? state : {};
}
export function OverviewSkeleton() {
  return <div className="overview-skeleton" role="status" aria-label="Loading planner"><Card/><Card/><Card/></div>;
}
function EventDetails({event,user,close}) {
  const dialog=useRef(null);
  useEffect(()=>{dialog.current.showModal();},[]);
  return <dialog ref={dialog} className="academic-dialog" aria-labelledby="event-title" onCancel={e=>{e.preventDefault();close();}}>
    <small>{eventNames[event.type]}</small><h2 id="event-title">{event.title}</h2>
    <p>{event.date ? displayDate(event.date,user)+' · All day' : displayTime(event.startAt,user,true)+(event.endAt ? ' – '+displayTime(event.endAt,user,true) : '')}</p>
    {event.courseTitle && event.courseTitle!==event.title && <p>{event.courseTitle}</p>}
    {event.location && <p>{event.location}</p>}
    <p>Status · {event.status.replaceAll('_',' ')}</p>
    <div className="editor-actions calendar-dialog-actions"><Button variant="secondary" onClick={close}>Close</Button><Button to={eventLink(event)}>Open source record</Button></div>
  </dialog>;
}
function group(events,date,user) {
  return events.filter(event=>{
    if(event.date) return event.date===date;
    const start=localStamp(new Date(event.startAt),user.timezone).slice(0,10);
    const end=event.endAt ? localStamp(new Date(+new Date(event.endAt)-1),user.timezone).slice(0,10) : start;
    return start<=date && end>=date;
  });
}
function EventButton({event,user,select,style}) {
  return <button type="button" className="calendar-event" style={{'--event-color':event.color,...style}} onClick={()=>select(event)}>
    <strong>{event.title}</strong><small>{event.date ? eventNames[event.type] : displayTime(event.startAt,user)}</small>
  </button>;
}
function timedLayout(events,date,user) {
  function minute(instant,edge) {
    const local=localStamp(new Date(instant),user.timezone);
    if(local.slice(0,10)<date) return 0;
    if(local.slice(0,10)>date) return 1440;
    const value=Number(local.slice(11,13))*60+Number(local.slice(14,16));
    return edge ? Math.min(1440,value) : Math.min(1410,value);
  }
  const slots=events.map(event=>{
    const start=minute(event.startAt,false);
    return {event,start,end:Math.max(start+30,event.endAt ? minute(event.endAt,true) : start)};
  }).sort((a,b)=>a.start-b.start);
  let group=[],end=0;
  const result=[];
  function flush() {
    const lanes=[];
    for(const slot of group) {
      let lane=lanes.findIndex(end=>end<=slot.start);
      if(lane<0) lane=lanes.length;
      lanes[lane]=slot.end;
      slot.lane=lane;
    }
    for(const slot of group) result.push({...slot,lanes:lanes.length});
  }
  for(const slot of slots) {
    if(slot.start>=end && group.length) {flush();group=[];end=0;}
    group.push(slot);
    end=Math.max(end,slot.end);
  }
  flush();
  return result;
}
export default function Calendar() {
  const {user}=useSession();
  const [params,setParams]=useSearchParams();
  const [revision,setRevision]=useState(0);
  const [selected,setSelected]=useState(null);
  const today=localStamp(new Date(),user.timezone).slice(0,10);
  const raw=params.get('date');
  const date=raw && /^20\d\d-\d\d-\d\d$/.test(raw) && Number.isFinite(Date.parse(raw)) && shiftDay(raw,0)===raw ? raw : today;
  const view=['day','week','month'].includes(params.get('view')) ? params.get('view') : 'month';
  const type=Object.hasOwn(eventNames,params.get('type')) ? params.get('type') : '';
  const first=view==='day' ? date : monday(view==='month' ? monthShift(date,0) : date);
  const last=shiftDay(first,view==='day' ? 0 : view==='week' ? 6 : 41);
  const dates=Array.from({length:view==='day' ? 1 : view==='week' ? 7 : 42},(_,i)=>shiftDay(first,i));
  const {data,error}=useOverview('/calendar/events?'+new URLSearchParams({from:first,to:last,...(type ? {type} : {})}),revision);
  const go=(date,viewMode=view,eventType=type)=>{setSelected(null);setParams({date,view:viewMode,...(eventType ? {type:eventType}:{})});};
  const move=step=>go(view==='month' ? monthShift(date,step) : shiftDay(date,step*(view==='week' ? 7 : 1)));
  const heading=view==='month' ? displayDate(date,user,{month:'long',year:'numeric'}) :
    displayDate(first,user)+(view==='week' ? ' – '+displayDate(last,user) : '');
  return <>
    <PageHeader title="Calendar" description={'Classes, deadlines, and study sessions in '+user.timezone+'.'} />
    <Card className="calendar-toolbar">
      <div className="editor-actions">
        <Button variant="secondary" aria-label={'Previous '+view} onClick={()=>move(-1)}><ChevronLeft size={17}/></Button>
        <Button variant="secondary" aria-label={'Next '+view} onClick={()=>move(1)}><ChevronRight size={17}/></Button>
        <Button variant="secondary" onClick={()=>go(today)}>Today</Button><h2 aria-live="polite">{heading}</h2>
      </div>
      <div className="editor-actions">
        {['day','week','month'].map(mode=><Button key={mode} aria-pressed={view===mode} variant={view===mode ? 'primary':'secondary'} onClick={()=>go(date,mode)}>{mode[0].toUpperCase()+mode.slice(1)}</Button>)}
        <div className="field"><label className="sr-only" htmlFor="event-filter">Event type</label><select id="event-filter" value={type} onChange={e=>go(date,view,e.target.value)}>
          <option value="">All events</option>{Object.entries(eventNames).map(([key,label])=><option key={key} value={key}>{label}</option>)}
        </select></div>
      </div>
    </Card>
    {error && <Card><Alert error>{error}</Alert><Button className="retry-session" onClick={()=>setRevision(n=>n+1)}>Retry</Button></Card>}
    {!data && !error && <OverviewSkeleton/>}
    {data && view==='month' && <div className="calendar-month">
      {dates.slice(0,7).map(day=><strong key={day} className="calendar-weekday">{displayDate(day,user,{weekday:'short'})}</strong>)}
      {dates.map(day=>{
        const events=group(data.items,day,user);
        return <div key={day} className={'calendar-cell'+(day===today?' calendar-today':'')+(day.slice(0,7)!==date.slice(0,7)?' calendar-adjacent':'')}>
          <button type="button" className="calendar-date" aria-label={'Open '+displayDate(day,user)} onClick={()=>go(day,'day')}>{Number(day.slice(8))}</button>
          {events.slice(0,3).map(event=><EventButton key={event.id} event={event} user={user} select={setSelected}/>)}
          {events.length>3 && <button type="button" className="calendar-date" onClick={()=>go(day,'day')}>+{events.length-3} more</button>}
        </div>;
      })}
    </div>}
    {data && view==='day' && (data.items.length ? <Card className="calendar-day-list">{group(data.items,date,user).map(event=><EventButton key={event.id} event={event} user={user} select={setSelected}/>)}</Card> :
      <EmptyState icon={CalendarDays} title="Nothing on this day" description="Change the event filter or choose another date." />)}
    {data && view==='week' && <>
      <div className="calendar-week-list">{dates.map(day=><Card key={day} className={day===today?'calendar-today':''}><h2>{displayDate(day,user,{weekday:'long',day:'numeric'})}</h2>
        {group(data.items,day,user).map(event=><EventButton key={event.id} event={event} user={user} select={setSelected}/>)}
        {!group(data.items,day,user).length && <small>No events</small>}
      </Card>)}</div>
      <div className="calendar-time-grid">
        <div className="calendar-hours"><strong>All day</strong><div className="calendar-clock">{Array.from({length:24},(_,hour)=><small key={hour}>{String(hour).padStart(2,'0')}:00</small>)}</div></div>
        {dates.map(day=>{
          const events=group(data.items,day,user);
          return <div key={day} className={'calendar-week-column'+(day===today?' calendar-today':'')}>
            <h2>{displayDate(day,user,{weekday:'short',day:'numeric'})}</h2>
            <div className="calendar-all-day">{events.filter(event=>event.date).map(event=><EventButton key={event.id} event={event} user={user} select={setSelected}/>)}</div>
            <div className="calendar-clock">{timedLayout(events.filter(event=>!event.date),day,user).map(({event,start,end,lane,lanes})=>
              <EventButton key={event.id} event={event} user={user} select={setSelected} style={{top:start/14.4+'%',height:(end-start)/14.4+'%',left:lane/lanes*100+'%',width:100/lanes+'%'}}/>)}</div>
          </div>;
        })}
      </div>
    </>}
    {selected && <EventDetails event={selected} user={user} close={()=>setSelected(null)}/>}
  </>;
}
