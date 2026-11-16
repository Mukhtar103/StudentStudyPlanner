import { ApiError } from '../services/auth.js';
import { dayBoundary, localInstant, localStamp, nextDate } from '../../../shared/task-time.js';
import { one } from '../repositories/accounts.js';

const types = ['course','task','study','term'];
const dayMs = 86400000;
const shift = (date, count) => new Date(Date.parse(date+'T00:00Z') + count*dayMs).toISOString().slice(0,10);
const invalid = () => new ApiError(400,'INVALID_RANGE','Choose a valid date range of up to 62 days and a supported event type.');
function valid(date) {
  return typeof date === 'string' && /^20\d\d-\d\d-\d\d$/.test(date) && Number.isFinite(Date.parse(date)) && shift(date,0) === date;
}
async function rows(db, sql, args) {
  return (await db.execute(sql,args))[0];
}
const connections = ' LEFT JOIN courses c ON c.user_id=x.user_id AND c.id=x.course_id ';
const taskFields = 'x.id,x.title,x.status,x.priority,x.course_id AS courseId,c.title AS courseTitle,c.color,x.due_at AS startAt,DATE_FORMAT(x.due_date,"%Y-%m-%d") AS date';
const studyFields = 'x.id,x.title,x.status,x.course_id AS courseId,c.title AS courseTitle,c.color,x.start_at AS startAt,x.end_at AS endAt,x.planned_minutes AS plannedMinutes,x.actual_minutes AS actualMinutes,x.series_id AS seriesId';
const openTask = "x.status IN ('not_started','in_progress')";
async function calendar(db,user,from,to,type) {
  const { id,timezone } = user;
  const start = dayBoundary(from,timezone);
  const end = dayBoundary(nextDate(to),timezone);
  const includes = value => !type || type === value;
  const [tasks,study,courses,terms] = await Promise.all([
    includes('task') ? rows(db,`SELECT ${taskFields} FROM tasks x ${connections}
      WHERE x.user_id=? AND x.status<>'archived' AND (x.due_date BETWEEN ? AND ? OR (x.due_at>=? AND x.due_at<?))`,[id,from,to,start,end]) : [],
    includes('study') ? rows(db,`SELECT ${studyFields} FROM study_sessions x ${connections}
      WHERE x.user_id=? AND x.status<>'cancelled' AND x.start_at<? AND x.end_at>?`,[id,end,start]) : [],
    includes('course') ? rows(db,`SELECT s.id,s.weekday,c.title,c.status,c.id AS courseId,c.title AS courseTitle,c.color,
      COALESCE(s.location,c.location) AS location,TIME_FORMAT(s.start_time,'%H:%i') AS begins,TIME_FORMAT(s.end_time,'%H:%i') AS ends,
      DATE_FORMAT(t.start_date,'%Y-%m-%d') AS termStart,DATE_FORMAT(t.end_date,'%Y-%m-%d') AS termEnd
      FROM course_schedules s JOIN courses c ON c.user_id=s.user_id AND c.id=s.course_id
      JOIN academic_terms t ON t.user_id=c.user_id AND t.id=c.term_id
      WHERE s.user_id=? AND c.status='active' AND t.status<>'archived' AND t.start_date<=? AND t.end_date>=?`,[id,to,from]) : [],
    includes('term') ? rows(db,`SELECT id,name,status,DATE_FORMAT(start_date,'%Y-%m-%d') AS begins,DATE_FORMAT(end_date,'%Y-%m-%d') AS ends
      FROM academic_terms WHERE user_id=? AND status<>'archived' AND (start_date BETWEEN ? AND ? OR end_date BETWEEN ? AND ?)`,[id,from,to,from,to]) : [],
  ]);
  const event = (type,row,sourceId = row.id,suffix = '') => ({ ...row,id:type+':'+row.id+suffix,type,sourceId,
    color:row.color || ({course:'#5942bd',task:'#9b5020',study:'#207560',term:'#30569d'})[type] });
  const events = [...tasks.map(row=>event('task',row)),...study.map(row=>event('study',row))];
  for (const row of terms) for (const [date,label] of [[row.begins,'starts'],[row.ends,'ends']]) {
    if (date>=from && date<=to) events.push(event('term',{id:row.id,title:row.name+' '+label,status:row.status,date},row.id,':'+label));
  }
  for (let date=from; date<=to; date=nextDate(date)) {
    const weekday = new Date(date+'T00:00Z').getUTCDay() || 7;
    for (const row of courses) {
      if (row.weekday!==weekday || date<row.termStart || date>row.termEnd) continue;
      let startAt = localInstant(date+'T'+row.begins,timezone);
      let endAt = localInstant(date+'T'+row.ends,timezone);
      if (!startAt || !endAt) {
        const boundary = dayBoundary(date,timezone);
        const minutes = value => Number(value.slice(0,2))*60+Number(value.slice(3));
        startAt ??= new Date(+boundary+minutes(row.begins)*60000);
        endAt ??= new Date(+startAt+(minutes(row.ends)-minutes(row.begins))*60000);
        if (endAt<=startAt) endAt = new Date(+startAt+(minutes(row.ends)-minutes(row.begins))*60000);
      }
      events.push(event('course',{id:row.id,title:row.title,status:row.status,courseId:row.courseId,courseTitle:row.courseTitle,color:row.color,location:row.location,startAt,endAt},row.courseId,':'+date));
    }
  }
  const key = item => item.date ? +dayBoundary(item.date,timezone) : +item.startAt;
  return events.map(item=>({item,key:key(item)})).sort((a,b)=>a.key-b.key || a.item.id.localeCompare(b.item.id)).map(row=>row.item);
}

async function dashboard(db,user) {
  const { id,timezone } = user;
  const now = new Date();
  const today = localStamp(now,timezone).slice(0,10);
  const week = shift(today,1-(new Date(today+'T00:00Z').getUTCDay() || 7));
  const days = Array.from({length:8},(_,index)=>shift(week,index));
  const bounds = days.map(date=>dayBoundary(date,timezone));
  const start = dayBoundary(today,timezone);
  const end = dayBoundary(nextDate(today),timezone);
  const due = '(x.due_at IS NOT NULL OR x.due_date IS NOT NULL)';
  const overdue = '(x.due_at<? OR x.due_date<?)';
  const upcoming = '(x.due_at>=? OR x.due_date>=?)';
  const [activeTerm,courseCount,taskCounts,deadlines,todaySessions,nextSession,weekly,events] = await Promise.all([
    one(db,`SELECT id,name FROM academic_terms WHERE user_id=? AND status<>'archived' AND ? BETWEEN start_date AND end_date
      ORDER BY start_date DESC,id DESC LIMIT 1`,[id,today]),
    one(db,`SELECT COUNT(*) AS total FROM courses c JOIN academic_terms t ON t.user_id=c.user_id AND t.id=c.term_id
      WHERE c.user_id=? AND c.status='active' AND t.status<>'archived' AND ? BETWEEN t.start_date AND t.end_date`,[id,today]),
    one(db,`SELECT COUNT(CASE WHEN ${openTask} THEN 1 END) AS pending,COUNT(CASE WHEN x.status='completed' THEN 1 END) AS completed,
      COUNT(CASE WHEN ${openTask} AND ${overdue} THEN 1 END) AS overdue,
      COUNT(CASE WHEN ${openTask} AND ${upcoming} THEN 1 END) AS upcoming FROM tasks x WHERE user_id=? AND status<>'archived'`,[now,today,now,today,id]),
    rows(db,`SELECT ${taskFields},CASE WHEN ${overdue} THEN 1 ELSE 0 END AS overdue FROM tasks x ${connections}
      WHERE x.user_id=? AND ${openTask} AND ${due} ORDER BY overdue DESC,COALESCE(x.due_date,DATE(x.due_at)),x.due_at,x.id LIMIT 8`,[now,today,id]),
    rows(db,`SELECT ${studyFields} FROM study_sessions x ${connections} WHERE x.user_id=? AND x.status<>'cancelled'
      AND x.start_at<? AND x.end_at>? ORDER BY x.start_at,x.id`,[id,end,start]),
    one(db,`SELECT ${studyFields} FROM study_sessions x ${connections} WHERE x.user_id=? AND x.status='planned' AND x.start_at>=?
      ORDER BY x.start_at,x.id LIMIT 1`,[id,now]),
    rows(db,`SELECT start_at AS startAt,end_at AS endAt,status,actual_minutes AS actualMinutes FROM study_sessions
      WHERE user_id=? AND status<>'cancelled' AND start_at<? AND end_at>?`,[id,bounds[7],bounds[0]]),
    calendar(db,user,today,shift(today,7)),
  ]);
  const weeklyProgress = days.slice(0,7).map((date,index)=>{
    let planned=0,actual=0;
    for (const item of weekly) {
      planned += Math.max(0,Math.min(+item.endAt,+bounds[index+1])-Math.max(+item.startAt,+bounds[index]))/60000;
      if (item.status==='completed' && item.startAt>=bounds[index] && item.startAt<bounds[index+1]) actual += item.actualMinutes || 0;
    }
    return {date,planned,actual};
  });
  const totals = weeklyProgress.reduce((acc,item)=>({planned:acc.planned+item.planned,actual:acc.actual+item.actual}),{planned:0,actual:0});
  const count = taskCounts.pending+taskCounts.completed;
  return {today,activeTerm:activeTerm ?? null,activeCourses:courseCount.total,...taskCounts,deadlines,todaySessions,nextSession:nextSession ?? null,
    weeklyProgress,plannedMinutes:Math.round(totals.planned),actualMinutes:totals.actual,taskCompletion:count ? Math.round(taskCounts.completed/count*100) : 0,
    upcomingEvents:events.filter(item=>item.date || (item.endAt ?? item.startAt)>=now).slice(0,5)};
}

export function mountCalendar(router,{pool,requireUser,respond}) {
  router.get('/calendar/events',requireUser,async(req,res)=>{
    const {from,to,type} = req.query;
    if (!valid(from) || !valid(to) || from>to || Date.parse(to)-Date.parse(from)>=62*dayMs || (type!==undefined && !types.includes(type))) throw invalid();
    return respond(req,res,{items:await calendar(pool,req.user,from,to,type),timezone:req.user.timezone});
  });
  router.get('/dashboard/summary',requireUser,async(req,res)=>respond(req,res,await dashboard(pool,req.user)));
}
