import { transaction } from '../config/database.js';
import { requireFields } from '../controllers/account.js';
import { one } from '../repositories/accounts.js';
import { ApiError } from '../services/auth.js';
import { dayBoundary, localStamp, nextDate } from '../../../shared/task-time.js';
import { expandSeries } from '../../../shared/study-recurrence.js';

const bad = message => new ApiError(400, 'VALIDATION_ERROR', message);
const missing = () => new ApiError(404, 'NOT_FOUND', 'The requested record was not found.');
const locked = () => new ApiError(409, 'SESSION_CLOSED', 'Completed and cancelled sessions are read-only.');
const positive = (value, max = 4294967295, min = 1) => {
  const number = Number(value);
  if (!['string','number'].includes(typeof value) || !/^\d+$/.test(String(value)) || !Number.isInteger(number) || number < min || number > max) throw bad('Enter a valid number.');
  return number;
};
function text(value, max, required = false) {
  if (!required && (value === null || value === '')) return null;
  if (typeof value !== 'string' || value.trim().length > max || (required && !value.trim())) throw bad('Check the required text fields and their lengths.');
  return value.trim() || null;
}
function date(value) {
  if (typeof value !== 'string' || !/^20\d\d-\d\d-\d\d$/.test(value)) throw bad('Enter a valid date from 2000 through 2099.');
  const time = new Date(value + 'T00:00Z');
  if (!Number.isFinite(+time) || time.toISOString().slice(0, 10) !== value) throw bad('Enter a valid date.');
  return value;
}
function instant(value) {
  if (typeof value !== 'string' || !/^20\d\d-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{3})?)?Z$/.test(value)) throw bad('Send a UTC date and time.');
  date(value.slice(0, 10));
  const result = new Date(value);
  if (!Number.isFinite(+result) || result.toISOString().slice(0, 16) !== value.slice(0, 16)) throw bad('Enter a valid time.');
  return result;
}
function clock(value) {
  if (typeof value !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) throw bad('Enter valid availability times.');
  return value;
}
const selected = `s.id,s.title,s.objective,s.course_id AS courseId,s.task_id AS taskId,s.status,
  s.start_at AS startAt,s.end_at AS endAt,s.actual_minutes AS actualMinutes,s.planned_minutes AS plannedMinutes,
  s.completed_at AS completedAt,s.cancelled_at AS cancelledAt,s.series_id AS seriesId,
  DATE_FORMAT(s.occurrence_date,'%Y-%m-%d') AS occurrenceDate,s.is_exception AS isException,
  c.title AS courseTitle,c.color AS courseColor,t.title AS taskTitle,r.rule AS recurrence`;
const source = ` FROM study_sessions s LEFT JOIN courses c ON c.user_id=s.user_id AND c.id=s.course_id
  LEFT JOIN tasks t ON t.user_id=s.user_id AND t.id=s.task_id
  LEFT JOIN study_series r ON r.user_id=s.user_id AND r.id=s.series_id`;
async function read(db, owner, id) {
  const row = await one(db, 'SELECT ' + selected + source + ' WHERE s.user_id=? AND s.id=?', [owner, id]);
  if (!row) throw missing();
  return row;
}
function paging(query) {
  return { page: positive(query.page ?? 1, 1000000), limit: positive(query.limit ?? 20, 100) };
}
async function list(db, user, query) {
  const { page, limit } = paging(query);
  const where = ['s.user_id=?'];
  const args = [user.id];
  for (const [key, column] of [['courseId','course_id'],['taskId','task_id']]) {
    if (query[key] !== undefined) { where.push('s.' + column + '=?'); args.push(positive(query[key])); }
  }
  if (query.from && query.to && date(query.from) > date(query.to)) throw bad('The end date must be on or after the start date.');
  if (query.from !== undefined) { where.push('s.end_at>?'); args.push(dayBoundary(date(query.from), user.timezone)); }
  if (query.to !== undefined) { where.push('s.start_at<?'); args.push(dayBoundary(nextDate(date(query.to)), user.timezone)); }
  const clause = ' WHERE ' + where.join(' AND ');
  const { total } = await one(db, 'SELECT COUNT(*) AS total FROM study_sessions s' + clause, args);
  const [items] = await db.query('SELECT ' + selected + source + clause + ' ORDER BY s.start_at,s.id LIMIT ? OFFSET ?', [...args, limit, (page - 1) * limit]);
  const now = new Date();
  const today = localStamp(now, user.timezone).slice(0, 10);
  const summary = await one(db, `SELECT COUNT(CASE WHEN status IN ('planned','in_progress') AND start_at>=? AND start_at<? THEN 1 END) AS today,
    COUNT(CASE WHEN status='planned' AND start_at>=? THEN 1 END) AS upcoming,
    COALESCE(SUM(CASE WHEN status='completed' THEN actual_minutes ELSE 0 END),0) AS actualMinutes
    FROM study_sessions WHERE user_id=?`, [dayBoundary(today,user.timezone),dayBoundary(nextDate(today),user.timezone),now,user.id]);
  return { items, total, page, limit, summary };
}
function normalRule(rule, start, timezone) {
  requireFields(rule, ['frequency','weekdays','until','count']);
  if (!['daily','weekly'].includes(rule.frequency) || Boolean(rule.until) === (rule.count !== undefined && rule.count !== null)) throw bad('Choose daily or weekly recurrence with one end date or occurrence limit.');
  const startDate = localStamp(start, timezone).slice(0, 10);
  const weekday = new Date(startDate + 'T00:00Z').getUTCDay() || 7;
  const weekdays = rule.frequency === 'daily' ? [] : rule.weekdays;
  if (!Array.isArray(weekdays) || weekdays.length > 7 || weekdays.some(value => !Number.isInteger(value) || value < 1 || value > 7) ||
    (rule.frequency === 'weekly' && !weekdays.includes(weekday))) throw bad('Select weekly days including the first session’s weekday.');
  const until = rule.until ? date(rule.until) : null;
  const count = until ? null : positive(rule.count, 52);
  if (until && (until < startDate || Date.parse(until) - Date.parse(startDate) >= 366 * 86400000)) throw bad('Choose an end date within one year of the first session.');
  return { frequency: rule.frequency, weekdays: [...new Set(weekdays)], until, count, timezone };
}
async function checkConflicts(db, owner, slots, excluded, override) {
  if (!slots.length) return;
  const start = new Date(Math.min(...slots.map(slot => +slot.start)));
  const end = new Date(Math.max(...slots.map(slot => +slot.end)));
  const [existing] = await db.execute("SELECT id,title,start_at AS startAt,end_at AS endAt FROM study_sessions WHERE user_id=? AND status<>'cancelled' AND start_at<? AND end_at>? ORDER BY start_at,id", [owner,end,start]);
  const conflicts = new Map();
  for (const [index, slot] of slots.entries()) {
    for (const row of existing) {
      if (!excluded.has(row.id) && row.startAt < slot.end && row.endAt > slot.start) conflicts.set(row.id, row);
    }
    for (const other of slots.slice(0,index)) {
      if (other.start < slot.end && other.end > slot.start) conflicts.set('series:' + other.date, { title: 'Another occurrence in this series', startAt: other.start, endAt: other.end });
    }
  }
  if (conflicts.size && override !== true) {
    const error = new ApiError(409, 'SESSION_CONFLICT', 'This schedule overlaps with an existing session.');
    error.details = [...conflicts.values()].slice(0, 12);
    throw error;
  }
}
const timeKeys = ['startAt','endAt','plannedMinutes','overrideConflict'];
const editKeys = ['title','objective','courseId','taskId','status','recurrence',...timeKeys];
async function save(db, user, old, patch, editSeries = false) {
  if (old && ['completed','cancelled'].includes(old.status) && !editSeries) throw locked();
  if (editSeries && !old?.seriesId) throw missing();
  if (old && !editSeries && 'recurrence' in patch) throw bad('Edit recurrence through the series endpoint.');
  if ('overrideConflict' in patch && typeof patch.overrideConflict !== 'boolean') throw bad('Choose a valid conflict override.');
  if ('status' in patch && !['planned','in_progress'].includes(patch.status)) throw bad('Use the completion or cancellation action to change that status.');
  const title = 'title' in patch ? text(patch.title,150,true) : old?.title;
  if (!title) throw bad('Enter a session title.');
  const objective = 'objective' in patch ? text(patch.objective,5000) : old?.objective ?? null;
  const linked = {};
  for (const [field, table] of [['courseId','courses'],['taskId','tasks']]) {
    const value = field in patch ? patch[field] : old?.[field] ?? null;
    linked[field] = value === null ? null : positive(value);
    if (linked[field] && !await one(db,'SELECT id FROM ' + table + ' WHERE user_id=? AND id=?',[user.id,linked[field]])) throw missing();
  }
  const start = 'startAt' in patch ? instant(patch.startAt) : old?.startAt;
  if ('endAt' in patch && 'plannedMinutes' in patch) throw bad('Choose an end time or planned minutes.');
  let end = 'endAt' in patch ? instant(patch.endAt) : old?.endAt;
  if (old && 'startAt' in patch && !('endAt' in patch) && !('plannedMinutes' in patch)) {
    end = new Date(+start + (old.endAt - old.startAt));
  }
  if ('plannedMinutes' in patch && start) end = new Date(+start + positive(patch.plannedMinutes, 10080) * 60000);
  if (!start || !end || end <= start || end - start > 7 * 86400000) throw bad('The end must be later than the start, with a duration of at most seven days.');
  const status = patch.status ?? old?.status ?? 'planned';
  const timezone = user.timezone;
  const recurrence = patch.recurrence === undefined && editSeries ? old.recurrence : patch.recurrence;
  if (editSeries && !('recurrence' in patch)) throw bad('Send the replacement recurrence or null to end the series.');
  const rule = recurrence == null ? null : normalRule(recurrence, start, timezone);
  let slots = rule ? expandSeries(start,end,timezone,rule) : [{ start,end,date: null }];
  if (rule?.count && slots.length < rule.count) throw bad('The occurrence limit must fit within one year.');
  const excluded = new Set(old && !editSeries ? [old.id] : []);
  const reusable = new Map();
  if (editSeries) {
    const [previous] = await db.execute(`SELECT id,status,is_exception AS exception,start_at AS startAt,
      DATE_FORMAT(occurrence_date,'%Y-%m-%d') AS date FROM study_sessions WHERE user_id=? AND series_id=?`, [user.id,old.seriesId]);
    const protectedDates = new Set();
    const now = new Date();
    for (const row of previous) {
      if (row.status === 'planned' && !row.exception && row.startAt >= now) { excluded.add(row.id); reusable.set(row.date,row.id); }
      else protectedDates.add(row.date);
    }
    slots = rule ? slots.filter(slot => slot.start >= now && !protectedDates.has(slot.date)) : [];
  }
  if (!editSeries && !old && !slots.length) throw bad('Choose a recurrence that produces sessions.');
  const datesChanged = !old || editSeries || +start !== +old.startAt || +end !== +old.endAt;
  if (datesChanged) await checkConflicts(db,user.id,slots,excluded,patch.overrideConflict);
  const values = [linked.courseId,linked.taskId,title,objective];
  let seriesId = old?.seriesId ?? null;
  if (!old && rule) {
    const [result] = await db.execute('INSERT INTO study_series (user_id,rule) VALUES (?,?)',[user.id,JSON.stringify(rule)]);
    seriesId = result.insertId;
  }
  if (editSeries) {
    await db.execute('UPDATE study_series SET rule=? WHERE user_id=? AND id=?',[JSON.stringify(rule ?? { ...old.recurrence, ended: true }),user.id,seriesId]);
    const retained = new Set(slots.map(slot => slot.date));
    for (const [date, id] of reusable) if (!retained.has(date)) {
      await db.execute("UPDATE study_sessions SET status='cancelled',cancelled_at=UTC_TIMESTAMP(3),occurrence_date=NULL WHERE user_id=? AND id=?",[user.id,id]);
    }
  }
  let firstId;
  for (const slot of slots) {
    const id = editSeries ? reusable.get(slot.date) : old?.id;
    const data = [...values,slot.start,slot.end,editSeries ? 'planned' : status];
    if (id) {
      await db.execute(`UPDATE study_sessions SET course_id=?,task_id=?,title=?,objective=?,start_at=?,end_at=?,status=?,
        is_exception=? WHERE user_id=? AND id=?`,[...data,Boolean(!editSeries && seriesId),user.id,id]);
      firstId ??= id;
    } else {
      const [result] = await db.execute(`INSERT INTO study_sessions (course_id,task_id,title,objective,start_at,end_at,status,user_id,series_id,occurrence_date)
        VALUES (?,?,?,?,?,?,?,?,?,?)`,[...data,user.id,seriesId,slot.date]);
      firstId ??= result.insertId;
    }
  }
  return read(db,user.id,firstId ?? old.id);
}
const availability = `id,weekday,TIME_FORMAT(start_time,'%H:%i') AS startTime,TIME_FORMAT(end_time,'%H:%i') AS endTime,
  DATE_FORMAT(effective_from,'%Y-%m-%d') AS effectiveFrom,DATE_FORMAT(effective_until,'%Y-%m-%d') AS effectiveUntil`;
async function availabilityRow(db, owner, id) {
  const row = await one(db,'SELECT ' + availability + ' FROM availability_rules WHERE user_id=? AND id=?',[owner,id]);
  if (!row) throw missing();
  return row;
}

export function mountStudy(router, { pool, requireUser, respond }) {
  const write = (req, run) => transaction(pool, async db => {
    await one(db,'SELECT id FROM users WHERE id=? FOR UPDATE',[req.user.id]);
    return run(db,req.user.id);
  });
  router.get('/study-sessions',requireUser,async (req,res) => respond(req,res,await list(pool,req.user,req.query)));
  router.get('/study-sessions/:id',requireUser,async (req,res) => respond(req,res,await read(pool,req.user.id,positive(req.params.id))));
  router.post('/study-sessions',requireUser,async (req,res) => respond(req,res,await write(req,db =>
    save(db,req.user,null,requireFields(req.body,editKeys))),201));
  for (const [suffix,keys,series] of [['',editKeys,false],['/reschedule',timeKeys,false],['/series',editKeys,true]]) {
    router.patch('/study-sessions/:id' + suffix,requireUser,async (req,res) => respond(req,res,await write(req,async (db,owner) =>
      save(db,req.user,await read(db,owner,positive(req.params.id)),requireFields(req.body,keys),series))));
  }
  router.patch('/study-sessions/:id/complete',requireUser,async (req,res) => respond(req,res,await write(req,async (db,owner) => {
    const id = positive(req.params.id);
    const current = await read(db,owner,id);
    if (!['planned','in_progress'].includes(current.status)) throw locked();
    const minutes = positive(requireFields(req.body,['actualMinutes']).actualMinutes,10080,0);
    await db.execute("UPDATE study_sessions SET status='completed',completed_at=UTC_TIMESTAMP(3),actual_minutes=? WHERE user_id=? AND id=?",[minutes,owner,id]);
    return read(db,owner,id);
  })));
  router.delete('/study-sessions/:id',requireUser,async (req,res) => respond(req,res,await write(req,async (db,owner) => {
    const id = positive(req.params.id);
    const current = await read(db,owner,id);
    if (current.status === 'completed') throw locked();
    if (current.status !== 'cancelled') await db.execute("UPDATE study_sessions SET status='cancelled',cancelled_at=UTC_TIMESTAMP(3),is_exception=(series_id IS NOT NULL) WHERE user_id=? AND id=?",[owner,id]);
    return read(db,owner,id);
  })));
  router.get('/availability',requireUser,async (req,res) => {
    const { page,limit } = paging(req.query);
    const { total } = await one(pool,'SELECT COUNT(*) AS total FROM availability_rules WHERE user_id=?',[req.user.id]);
    const [items] = await pool.query('SELECT ' + availability + ' FROM availability_rules WHERE user_id=? ORDER BY weekday,start_time,id LIMIT ? OFFSET ?',[req.user.id,limit,(page-1)*limit]);
    return respond(req,res,{ items,total,page,limit });
  });
  for (const method of ['post','patch','delete']) {
    router[method]('/availability' + (method === 'post' ? '' : '/:id'),requireUser,async (req,res) => respond(req,res,await write(req,async (db,owner) => {
      let id = req.params.id ? positive(req.params.id) : null;
      const prior = id ? await availabilityRow(db,owner,id) : null;
      if (method === 'delete') {
        await db.execute('DELETE FROM availability_rules WHERE user_id=? AND id=?',[owner,id]);
        return {};
      }
      const next = { ...prior,...requireFields(req.body,['weekday','startTime','endTime','effectiveFrom','effectiveUntil']) };
      const weekday = positive(next.weekday,7);
      const start = clock(next.startTime);
      const end = clock(next.endTime);
      const from = next.effectiveFrom == null ? null : date(next.effectiveFrom);
      const until = next.effectiveUntil == null ? null : date(next.effectiveUntil);
      if (start >= end || (from && until && from > until)) throw bad('The end must be later than the start.');
      const args = [weekday,start,end,from,until,owner];
      if (id) await db.execute('UPDATE availability_rules SET weekday=?,start_time=?,end_time=?,effective_from=?,effective_until=? WHERE user_id=? AND id=?',[...args,id]);
      else {
        const [result] = await db.execute('INSERT INTO availability_rules (weekday,start_time,end_time,effective_from,effective_until,user_id) VALUES (?,?,?,?,?,?)',args);
        id = result.insertId;
      }
      return availabilityRow(db,owner,id);
    }),method === 'post' ? 201 : 200));
  }
}

