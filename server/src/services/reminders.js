import { setTimeout as pause } from 'node:timers/promises';
import nodemailer from 'nodemailer';
import { dayBoundary, localInstant, localStamp, nextDate } from '../../../shared/task-time.js';

const candidates = `SELECT r.id AS reminderId,r.user_id AS userId,r.channel,r.offset_minutes AS offsetMinutes,
  u.email,u.timezone,u.locale,p.email_notifications AS emailOn,p.in_app_notifications AS appOn,
  TIME_FORMAT(p.quiet_start,'%H:%i') AS quietStart,TIME_FORMAT(p.quiet_end,'%H:%i') AS quietEnd,
  IF(t.id IS NULL,'study','task') AS sourceType, COALESCE(t.id,s.id) AS sourceId,
  COALESCE(t.title,s.title) AS title, COALESCE(t.due_at,s.start_at) AS eventAt,
  DATE_FORMAT(t.due_date,'%Y-%m-%d') AS eventDate
  FROM reminder_rules r JOIN users u ON u.id=r.user_id AND u.status='active'
  JOIN user_preferences p ON p.user_id=r.user_id
  LEFT JOIN tasks t ON t.user_id=r.user_id AND t.id=r.task_id AND t.status IN ('not_started','in_progress')
  LEFT JOIN study_sessions anchor ON anchor.user_id=r.user_id AND anchor.id=r.session_id
  LEFT JOIN study_sessions s ON s.user_id=r.user_id AND (s.id=anchor.id OR s.series_id=anchor.series_id) AND s.status IN ('planned','in_progress')
  WHERE r.enabled=1 AND r.deleted_at IS NULL AND (t.due_at IS NOT NULL OR t.due_date IS NOT NULL OR s.id IS NOT NULL)`;
function times(row) {
  const event = row.eventAt ?? dayBoundary(nextDate(row.eventDate),row.timezone);
  const due = new Date(+event-row.offsetMinutes*60000);
  return {event,due};
}
export function quietUntil(now,row) {
  const {quietStart:start,quietEnd:end,timezone}=row;
  if(!start || !end) return null;
  const local=localStamp(now,timezone);
  const time=local.slice(11);
  if(!(start<end ? time>=start && time<end : time>=start || time<end)) return null;
  const date=start>end && time>=start ? nextDate(local.slice(0,10)) : local.slice(0,10);
  const nominal=Date.parse(date+'T'+end+'Z');
  for(let minute=0;minute<=180;minute++) {
    const instant=localInstant(new Date(nominal+minute*60000).toISOString().slice(0,16),timezone);
    if(instant && instant>now) return instant;
  }
  return new Date(+now+3600000);
}
const escape = value => String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[char]);
export function createReminderMailer(env=process.env,transport) {
  if(!env.SMTP_URL || !env.SMTP_FROM) return null;
  const uri=new URL(env.SMTP_URL);
  if(!['smtp:','smtps:'].includes(uri.protocol)) throw new Error('Invalid reminder SMTP protocol');
  const smtp=transport ?? nodemailer.createTransport({
    host:uri.hostname,port:Number(uri.port || (uri.protocol==='smtps:'?465:587)),secure:uri.protocol==='smtps:',
    auth:uri.username ? {user:decodeURIComponent(uri.username),pass:decodeURIComponent(uri.password)}:undefined,
    requireTLS:env.NODE_ENV==='production',connectionTimeout:8000,greetingTimeout:8000,socketTimeout:12000,
  });
  return async (row,id)=>{
    const when=row.eventDate ? new Intl.DateTimeFormat(row.locale,{dateStyle:'long',timeZone:'UTC'}).format(new Date(row.eventDate+'T00:00Z'))+' (all day)' :
      new Intl.DateTimeFormat(row.locale,{dateStyle:'long',timeStyle:'short',timeZone:row.timezone}).format(row.eventAt);
    const label=row.sourceType==='task'?'Task deadline':'Study session';
    const result=await smtp.sendMail({from:env.SMTP_FROM,to:row.email,messageId:'<planner-reminder-'+id+'@'+(env.APP_URL?new URL(env.APP_URL).hostname:'study-planner.local')+'>',
      subject:label+': '+row.title.replace(/[\r\n]/g,' '),text:label+'\n'+row.title+'\n'+when,
      html:'<main style="font-family:Arial;padding:24px;color:#202032"><p style="color:#593cc9">Study Planner</p><h1>'+escape(label)+'</h1><p>'+escape(row.title)+'</p><p>'+escape(when)+'</p></main>'});
    if(!result.accepted?.length) throw Object.assign(new Error('SMTP recipient not accepted'),{responseCode:550});
  };
}
export async function processReminders(pool,send,{now=new Date(),signal}={}) {
  const db=await pool.getConnection();
  let acquired=false;
  try {
    const [[lock]]=await db.query("SELECT GET_LOCK(SHA2(CONCAT(DATABASE(), ':planner:reminders'),256),0) AS acquired");
    acquired=lock.acquired===1;
    if(!acquired) return;
    // A queued SMTP send left by an interrupted worker is indeterminate. Never send it twice.
    await db.query("UPDATE notifications SET status='failed',retry_at=NULL,error_code='delivery_unknown' WHERE status='queued'");
    const query=candidates+` AND (COALESCE(t.due_at,s.start_at) BETWEEN ? AND ? OR t.due_date BETWEEN ? AND ?)
      AND NOT EXISTS (SELECT 1 FROM notifications n WHERE n.user_id=r.user_id AND n.reminder_id=r.id AND n.source_id=COALESCE(t.id,s.id)
      AND n.scheduled_at=TIMESTAMPADD(MINUTE,-r.offset_minutes,COALESCE(t.due_at,s.start_at))) AND (r.id>? OR (r.id=? AND COALESCE(t.id,s.id)>?))
      AND ((r.channel='in_app' AND p.in_app_notifications=1) OR (r.channel='email' AND p.email_notifications=1 AND ?))
      ORDER BY r.id,COALESCE(t.id,s.id) LIMIT 100`;
    const range=[new Date(+now-86400000),new Date(+now+7*86400000),
      new Date(+now-2*86400000).toISOString().slice(0,10),new Date(+now+8*86400000).toISOString().slice(0,10)];
    let ruleCursor=0;
    let sourceCursor=0;
    let queued=0;
    while(queued<100 && !signal?.aborted) {
      const [due]=await db.execute(query,[...range,ruleCursor,ruleCursor,sourceCursor,Boolean(send)]);
      if(!due.length) break;
      for(const row of due) {
        ruleCursor=row.reminderId;
        sourceCursor=row.sourceId;
        const {event,due}=times(row);
        if(due>now || due<new Date(+now-86400000)) continue;
        const existing=await db.execute('SELECT id FROM notifications WHERE user_id=? AND reminder_id=? AND source_id=? AND scheduled_at=?',
          [row.userId,row.reminderId,row.sourceId,due]);
        if(existing[0].length) continue;
        await db.execute(`INSERT INTO notifications (user_id,reminder_id,source_id,source_type,channel,title,message,event_at,scheduled_at,retry_at)
          VALUES (?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE id=id`,
        [row.userId,row.reminderId,row.sourceId,row.sourceType,row.channel,row.title,row.sourceType==='task'?'Task deadline':'Study session',event,due,quietUntil(now,row) ?? now]);
        if(++queued>=100) break;
      }
    }
    const [jobs]=await db.execute("SELECT * FROM notifications WHERE status='scheduled' AND retry_at<=? ORDER BY retry_at,id LIMIT 100",[now]);
    for(const job of jobs) {
      if(signal?.aborted) break;
      const [matches]=await db.execute(candidates+' AND r.id=? AND COALESCE(t.id,s.id)=?',[job.reminder_id,job.source_id]);
      const row=matches[0];
      if(!row || row.channel!==job.channel || +times(row).due!==+job.scheduled_at || (job.channel==='email'?!row.emailOn || !send:!row.appOn)) {
        await db.execute("UPDATE notifications SET status='failed',retry_at=NULL,error_code='obsolete' WHERE id=?",[job.id]);
        continue;
      }
      const quiet=quietUntil(now,row);
      if(quiet) {
        await db.execute('UPDATE notifications SET retry_at=? WHERE id=?',[quiet,job.id]);
        continue;
      }
      if(job.channel==='email') {
        await db.execute("UPDATE notifications SET status='queued',attempts=attempts+1 WHERE id=?",[job.id]);
        try { await send(row,job.id); }
        catch(error) {
          const attempt=job.attempts+1;
          const retry=attempt<3 && error.responseCode>=400 && error.responseCode<500;
          await db.execute('UPDATE notifications SET status=?,retry_at=?,error_code=? WHERE id=?',
            [retry?'scheduled':'failed',retry?new Date(+now+attempt*60000):null,'smtp_rejected',job.id]);
          console.warn(JSON.stringify({event:'reminder_email_failed',id:job.id,retry}));
          continue;
        }
      }
      await db.execute("UPDATE notifications SET status='sent',delivered_at=?,retry_at=NULL,error_code=NULL WHERE id=?",[now,job.id]);
    }
  } finally {
    try { if(acquired) await db.query("DO RELEASE_LOCK(SHA2(CONCAT(DATABASE(), ':planner:reminders'),256))"); }
    finally { db.release(); }
  }
}
export async function runReminderWorker(pool,send,signal) {
  while(!signal?.aborted) {
    try { await processReminders(pool,send,{signal}); }
    catch(error) { console.error(JSON.stringify({event:'reminder_worker_failed',code:error.code ?? 'UNKNOWN'})); }
    try { await pause(15000,undefined,{signal}); }
    catch(error) { if(error.name!=='AbortError') throw error; }
  }
}




