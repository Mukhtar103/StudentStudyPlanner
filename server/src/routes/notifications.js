import { ApiError } from '../services/auth.js';
import { requireFields } from '../controllers/account.js';
import { one } from '../repositories/accounts.js';
import { transaction } from '../config/database.js';

const missing=()=>new ApiError(404,'NOT_FOUND','The requested record was not found.');
const invalid=()=>new ApiError(400,'INVALID_REMINDER','Choose a valid source, channel, and offset from 0 to 10,080 minutes.');
function int(value,min=1,max=4294967295) {
  if(!['number','string'].includes(typeof value) || !/^\d+$/.test(String(value)) || Number(value)<min || Number(value)>max) throw invalid();
  return Number(value);
}
const fields='id,task_id AS taskId,session_id AS sessionId,channel,enabled,offset_minutes AS offsetMinutes';
const inbox="user_id=? AND channel='in_app' AND status='sent' AND deleted_at IS NULL";
const pagination=query=>({page:int(query.page??1,1,1000000),limit:int(query.limit??20,1,100)});
export function mountNotifications(router,{pool,requireUser,respond}) {
  async function rule(db,owner,id) {
    const item=await one(db,'SELECT '+fields+' FROM reminder_rules WHERE user_id=? AND id=? AND deleted_at IS NULL',[owner,id]);
    if(!item) throw missing();
    return item;
  }
  router.get('/reminders',requireUser,async(req,res)=>{
    const {page,limit}=pagination(req.query);
    const args=[req.user.id];
    let where='user_id=? AND deleted_at IS NULL';
    if(req.query.channel!==undefined) {
      if(!['email','in_app'].includes(req.query.channel)) throw invalid();
      where+=' AND channel=?';args.push(req.query.channel);
    }
    const {total}=await one(pool,'SELECT COUNT(*) AS total FROM reminder_rules WHERE '+where,args);
    const [items]=await pool.query('SELECT '+fields+',COALESCE((SELECT title FROM tasks t WHERE t.user_id=r.user_id AND t.id=r.task_id),(SELECT title FROM study_sessions s WHERE s.user_id=r.user_id AND s.id=r.session_id)) AS title FROM reminder_rules r WHERE '+where+' ORDER BY id DESC LIMIT ? OFFSET ?',[...args,limit,(page-1)*limit]);
    return respond(req,res,{items,total,page,limit});
  });
  for(const method of ['post','patch','delete']) {
    router[method]('/reminders'+(method==='post'?'':'/:id'),requireUser,async(req,res)=>{
      const owner=req.user.id;
      try {
        const data=await transaction(pool,async db=>{
          await one(db,'SELECT id FROM users WHERE id=? FOR UPDATE',[owner]);
          let id=req.params.id ? int(req.params.id):null;
          const old=id ? await rule(db,owner,id):null;
          if(method==='delete') {
            await db.execute('UPDATE reminder_rules SET deleted_at=UTC_TIMESTAMP(3),enabled=0 WHERE user_id=? AND id=?',[owner,id]);
            return {};
          }
          const next={enabled:1,...old,...requireFields(req.body,['taskId','sessionId','channel','offsetMinutes','enabled'])};
          const task=next.taskId==null?null:int(next.taskId);
          let session=next.sessionId==null?null:int(next.sessionId);
          if(Boolean(task)===Boolean(session) || !['in_app','email'].includes(next.channel) ||
            ![true,false,0,1].includes(next.enabled)) throw invalid();
          const offset=int(next.offsetMinutes,0,10080);
          if(task && !await one(db,'SELECT id FROM tasks WHERE user_id=? AND id=?',[owner,task])) throw missing();
          if(session) {
            const anchor=await one(db,'SELECT id,series_id FROM study_sessions WHERE user_id=? AND id=?',[owner,session]);
            if(!anchor) throw missing();
            if(anchor.series_id) session=(await one(db,'SELECT MIN(id) AS id FROM study_sessions WHERE user_id=? AND series_id=?',[owner,anchor.series_id])).id;
          }
          const args=[task,session,next.channel,offset,Boolean(next.enabled),owner];
          if(id) await db.execute('UPDATE reminder_rules SET task_id=?,session_id=?,channel=?,offset_minutes=?,enabled=? WHERE user_id=? AND id=?',[...args,id]);
          else {
            const prior=await one(db,'SELECT id,deleted_at FROM reminder_rules WHERE user_id=? AND task_id<=>? AND session_id<=>? AND channel=? AND offset_minutes=?',[owner,task,session,next.channel,offset]);
            if(prior?.deleted_at) {
              id=prior.id;
              await db.execute('UPDATE reminder_rules SET deleted_at=NULL,enabled=? WHERE user_id=? AND id=?',[Boolean(next.enabled),owner,id]);
            } else {
              const [result]=await db.execute('INSERT INTO reminder_rules (task_id,session_id,channel,offset_minutes,enabled,user_id) VALUES (?,?,?,?,?,?)',args);
              id=result.insertId;
            }
          }
          return rule(db,owner,id);
        });
        return respond(req,res,data,method==='post'?201:200);
      } catch(error) {
        if(error.code==='ER_DUP_ENTRY') throw new ApiError(409,'DUPLICATE_REMINDER','A reminder already uses this source, offset, and channel.');
        throw error;
      }
    });
  }
  router.get('/notifications',requireUser,async(req,res)=>{
    const {page,limit}=pagination(req.query);
    const read=req.query.read;
    if(read!==undefined && !['read','unread'].includes(read)) throw invalid();
    const where=inbox+(read==='unread'?' AND read_at IS NULL':read==='read'?' AND read_at IS NOT NULL':'');
    const {total}=await one(pool,'SELECT COUNT(*) AS total FROM notifications WHERE '+where,[req.user.id]);
    const [items]=await pool.query('SELECT id,title,message,source_id AS sourceId,source_type AS sourceType,scheduled_at AS scheduledAt,delivered_at AS deliveredAt,read_at AS readAt FROM notifications WHERE '+where+' ORDER BY delivered_at DESC,id DESC LIMIT ? OFFSET ?',[req.user.id,limit,(page-1)*limit]);
    return respond(req,res,{items,total,page,limit});
  });
  router.get('/notifications/unread-count',requireUser,async(req,res)=>respond(req,res,await one(pool,'SELECT COUNT(*) AS count FROM notifications WHERE '+inbox+' AND read_at IS NULL',[req.user.id])));
  router.patch('/notifications/read-all',requireUser,async(req,res)=>{
    await pool.execute('UPDATE notifications SET read_at=UTC_TIMESTAMP(3) WHERE '+inbox+' AND read_at IS NULL',[req.user.id]);
    return respond(req,res,{});
  });
  for(const [method,path,update] of [['patch','/:id/read','read_at=COALESCE(read_at,UTC_TIMESTAMP(3))'],['delete','/:id','deleted_at=UTC_TIMESTAMP(3)']]) {
    router[method]('/notifications'+path,requireUser,async(req,res)=>{
      const [result]=await pool.execute('UPDATE notifications SET '+update+' WHERE '+inbox+' AND id=?',[req.user.id,int(req.params.id)]);
      if(!result.affectedRows) throw missing();
      return respond(req,res,{});
    });
  }
}

