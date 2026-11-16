import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { ApiError } from '../services/auth.js';
import { one, preferences, publicFields } from '../repositories/accounts.js';
import { transaction } from '../config/database.js';
import { dayBoundary, localStamp } from '../../../shared/task-time.js';

const shift=(date,days)=>new Date(Date.parse(date+'T00:00Z')+days*86400000).toISOString().slice(0,10);
const localDate=(instant,zone)=>localStamp(instant,zone).slice(0,10);
const invalid=()=>new ApiError(400,'INVALID_ANALYTICS_FILTER','Choose a valid range up to 366 days, grouping and course.');
const missing=()=>new ApiError(404,'NOT_FOUND','The requested course was not found.');
const fields=[
  ['profile','users',publicFields,'id'],
  ['academicTerms','academic_terms','id,name,CAST(start_date AS CHAR) AS start_date,CAST(end_date AS CHAR) AS end_date,status'],
  ['courses','courses','id,term_id,title,code,instructor,location,description,color,status'],
  ['courseSchedules','course_schedules','id,course_id,weekday,start_time,end_time,location'],
  ['tasks','tasks','id,course_id,title,description,personal_notes,category,priority,status,due_at,CAST(due_date AS CHAR) AS due_date,target_at,CAST(target_date AS CHAR) AS target_date,estimate_minutes,completed_at,archived_at,created_at,updated_at'],
  ['subtasks','subtasks','id,task_id,title,status,position,created_at,updated_at'],
  ['studySessions','study_sessions','id,course_id,task_id,title,objective,start_at,end_at,actual_minutes,planned_minutes,status,recurrence,CAST(recurrence_end AS CHAR) AS recurrence_end,recurrence_count,series_id,CAST(occurrence_date AS CHAR) AS occurrence_date,is_exception,completed_at,cancelled_at,created_at,updated_at'],
  ['studySeries','study_series','id,rule'],
  ['availability','availability_rules','id,weekday,start_time,end_time,CAST(effective_from AS CHAR) AS effective_from,CAST(effective_until AS CHAR) AS effective_until,created_at,updated_at'],
  ['reminders','reminder_rules','id,task_id,session_id,channel,offset_minutes,enabled,created_at,updated_at,deleted_at'],
  ['notifications','notifications','id,reminder_id,source_id,source_type,channel,title,message,event_at,scheduled_at,status,read_at,delivered_at,deleted_at'],
  ['taskStatusHistory','task_status_history','id,task_id,status,occurred_at'],
];

async function* records(db,owner) {
  for(const [category,table,columns,ownerColumn='user_id'] of fields) {
    let after=0;
    for(;;) {
      const [rows]=await db.execute('SELECT '+columns+' FROM '+table+' WHERE '+ownerColumn+'=? AND id>? ORDER BY id LIMIT 200',[owner,after]);
      for(const row of rows) yield [category,row];
      if(rows.length<200) break;
      after=rows.at(-1).id;
    }
  }
  yield ['preferences',{id:owner,...await preferences(db,owner)}];
}
export function csvCell(value) {
  let text=value===null || value===undefined?'':String(value);
  if(/^[\t\r\n]|^[\s\uFEFF]*[=+@\-＝＋＠－]/u.test(text)) text="'"+text;
  return '"'+text.replaceAll('"','""')+'"';
}
async function* serialize(db,owner,format) {
  yield format==='json'?'{"version":1,"records":[':'\uFEFFcategory,record_id,field,value\r\n';
  let first=true;
  for await(const [category,record] of records(db,owner)) {
    if(format==='json') {
      yield (first?'':',')+JSON.stringify({category,record});
      first=false;
    } else for(const [key,value] of Object.entries(record)) {
      const cell=value instanceof Date?value.toISOString():value!==null && typeof value==='object'?JSON.stringify(value):value;
      yield [category,record.id,key,cell].map(csvCell).join(',')+'\r\n';
    }
  }
  if(format==='json') yield ']}';
}
async function filters(db,user,query) {
  const today=localDate(new Date(),user.timezone);
  const from=query.from??shift(today,-27);
  const to=query.to??today;
  const group=query.group??'week';
  const valid=date=>typeof date==='string' && /^20\d\d-\d\d-\d\d$/.test(date) && Number.isFinite(Date.parse(date)) && shift(date,0)===date;
  if(!valid(from)||!valid(to)||from>to||Date.parse(to)-Date.parse(from)>=366*86400000||!['day','week','month'].includes(group)) throw invalid();
  let courseId=null;
  if(query.courseId!==undefined) {
    if(typeof query.courseId!=='string'||!/^\d+$/.test(query.courseId)||Number(query.courseId)<1||Number(query.courseId)>4294967295) throw invalid();
    courseId=Number(query.courseId);
    if(!await one(db,'SELECT id FROM courses WHERE user_id=? AND id=?',[user.id,courseId])) throw missing();
  }
  return {from,to,group,courseId,today};
}
async function analytics(db,user,query) {
  const {from,to,group,courseId,today}=await filters(db,user,query);
  const now=new Date();
  const dates=[];
  for(let date=from;date<=to;date=shift(date,1)) dates.push(date);
  const bounds=[...dates,shift(to,1)].map(date=>dayBoundary(date,user.timezone));
  const start=bounds[0],end=bounds.at(-1);
  const condition=courseId===null?'':' AND x.course_id=?';
  const args=courseId===null?[]:[courseId];
  const [study]=await db.execute(`SELECT x.course_id AS courseId,x.start_at AS startAt,x.end_at AS endAt,x.status,x.actual_minutes AS actual
    FROM study_sessions x WHERE x.user_id=? AND x.start_at<? AND x.end_at>?${condition}`,[user.id,end,start,...args]);
  const [tasks]=await db.execute(`SELECT x.id,x.course_id AS courseId,x.status,x.priority,x.due_at AS dueAt,
    DATE_FORMAT(x.due_date,'%Y-%m-%d') AS dueDate,x.estimate_minutes AS estimate
    FROM tasks x WHERE x.user_id=? AND x.status<>'archived'${condition}
    AND ((x.created_at>=? AND x.created_at<?) OR (x.due_at>=? AND x.due_at<?) OR x.due_date BETWEEN ? AND ? OR (x.completed_at>=? AND x.completed_at<?)
      OR EXISTS (SELECT 1 FROM task_status_history h WHERE h.user_id=x.user_id AND h.task_id=x.id AND h.status='completed' AND h.occurred_at>=? AND h.occurred_at<?))`,
    [user.id,...args,start,end,start,end,from,to,start,end,start,end]);
  const [completions]=await db.execute(`SELECT x.id,h.occurred_at AS completedAt FROM task_status_history h
    JOIN tasks x ON x.user_id=h.user_id AND x.id=h.task_id WHERE h.user_id=? AND x.status<>'archived'
    AND h.status='completed' AND h.occurred_at>=? AND h.occurred_at<?${condition}
    UNION SELECT x.id,x.completed_at FROM tasks x WHERE x.user_id=? AND x.status='completed' AND x.completed_at>=? AND x.completed_at<?${condition}`,
    [user.id,start,end,...args,user.id,start,end,...args]);
  const [courseRows]=await db.execute('SELECT id,title,color FROM courses WHERE user_id=?',[user.id]);
  const daily=new Map(dates.map(date=>[date,{date,planned:0,actual:0,completed:0}]));
  const courses=new Map();
  const labels=new Map(courseRows.map(item=>[item.id,item]));
  function course(id) {
    if(!courses.has(id)) {
      const item=labels.get(id);
      courses.set(id,{id,title:item?.title??'Personal',color:item?.color??'#7253ce',planned:0,actual:0,tasks:0,completed:0});
    }
    return courses.get(id);
  }
  const studyTotal={planned:0,actual:0,plannedSessions:0,completedSessions:0,cancelledSessions:0,activeDays:0};
  for(const session of study) {
    if(session.status==='cancelled'){studyTotal.cancelledSessions++;continue;}
    const entry=course(session.courseId);
    if(session.status==='completed') studyTotal.completedSessions++;
    else studyTotal.plannedSessions++;
    for(const [index,date] of dates.entries()) {
      const planned=Math.max(0,Math.min(+session.endAt,+bounds[index+1])-Math.max(+session.startAt,+bounds[index]))/60000;
      if(!planned) continue;
      daily.get(date).planned+=planned;
      studyTotal.planned+=planned;
      entry.planned+=planned;
    }
    const actual= session.status==='completed' ? session.actual??0 : 0;
    const date=localDate(session.startAt,user.timezone);
    if(daily.has(date)) {
      daily.get(date).actual+=actual;
      studyTotal.actual+=actual;
      entry.actual+=actual;
    }
  }
  const taskTotal={total:tasks.length,completed:0,pending:0,overdue:0,completion:0,upcomingEstimateMinutes:0,priority:{low:0,medium:0,high:0}};
  for(const task of tasks) {
    const entry=course(task.courseId);
    entry.tasks++;
    taskTotal.priority[task.priority]++;
    if(task.status==='completed') {taskTotal.completed++;entry.completed++;continue;}
    taskTotal.pending++;
    if((task.dueAt && task.dueAt<now)||(task.dueDate && task.dueDate<today)) taskTotal.overdue++;
    else taskTotal.upcomingEstimateMinutes+=task.estimate??0;
  }
  taskTotal.completion=tasks.length?Math.round(taskTotal.completed/tasks.length*100):0;
  const unique=new Set();
  for(const row of completions) {
    const date=localDate(row.completedAt,user.timezone);
    const key=date+':'+row.id;
    if(!daily.has(date)||unique.has(key)) continue;
    unique.add(key);
    daily.get(date).completed++;
  }
  const buckets=new Map();
  const monthly=new Map();
  for(const item of daily.values()) {
    if(item.actual>0) studyTotal.activeDays++;
    const week=shift(item.date,1-(new Date(item.date+'T00:00Z').getUTCDay()||7));
    const month=item.date.slice(0,7)+'-01';
    for(const [target,key] of [[buckets,group==='day'?item.date:group==='week'?week:month],[monthly,month]]) {
      if(!target.has(key)) target.set(key,{date:key,planned:0,actual:0,completed:0});
      const slot=target.get(key);
      for(const metric of ['planned','actual','completed']) slot[metric]+=item[metric];
    }
  }
  return {from,to,group,courseId,study:studyTotal,tasks:taskTotal,series:[...buckets.values()],monthly:[...monthly.values()],
    courses:[...courses.values()].sort((a,b)=>a.title.localeCompare(b.title)),courseOptions:courseRows};
}

export function mountProgress(router,{pool,requireUser,respond}) {
  for(const name of ['overview','study-time','tasks','courses']) router.get('/analytics/'+name,requireUser,async(req,res)=>{
    const model=await analytics(pool,req.user,req.query);
    const {from,to,group,courseId,study,tasks,series,monthly,courses}=model;
    const output={overview:model,'study-time':{from,to,group,courseId,study,series,monthly},tasks:{from,to,group,courseId,tasks,series},courses:{from,to,courseId,courses}};
    return respond(req,res,output[name]);
  });
  for(const format of ['json','csv']) router.get('/export/'+format,requireUser,async(req,res)=>{
    await transaction(pool,async db=>{
      await db.query('SELECT 1');
      res.set('Content-Type',format==='json'?'application/json; charset=utf-8':'text/csv; charset=utf-8');
      res.attachment('study-planner-data.'+format);
      res.set('Content-Type',format==='json'?'application/json; charset=utf-8':'text/csv; charset=utf-8');
      await pipeline(Readable.from(serialize(db,req.user.id,format)),res);
    });
  });
}

