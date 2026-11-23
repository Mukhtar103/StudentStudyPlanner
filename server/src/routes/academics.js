import { transaction } from '../config/database.js';
import { requireFields } from '../controllers/account.js';
import { one } from '../repositories/accounts.js';
import { ApiError } from '../services/auth.js';

const bad = message => new ApiError(400, 'VALIDATION_ERROR', message);
const missing = () => new ApiError(404, 'NOT_FOUND', 'The requested record was not found.');
const conflict = message => new ApiError(409, 'ACADEMIC_CONFLICT', message);
function integer(value, max = 4294967295) {
  const n = Number(value);
  if (!/^\d+$/.test(String(value)) || !Number.isInteger(n) || n < 1 || n > max) throw bad('Enter a valid positive number.');
  return n;
}
function string(value, max, required = true) {
  if (!required && (value === null || value === '')) return null;
  if (typeof value !== 'string' || value.trim().length > max || (required && !value.trim())) throw bad('Check the required fields and their lengths.');
  return value.trim() || null;
}
function date(value) {
  if (typeof value !== 'string' || !/^[1-9]\d{3}-\d{2}-\d{2}$/.test(value)) throw bad('Enter valid dates.');
  const parsed = new Date(value);
  if (!Number.isFinite(+parsed) || parsed.toISOString().slice(0, 10) !== value) throw bad('Enter valid dates.');
  return value;
}
function time(value) {
  if (typeof value !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) throw bad('Enter valid meeting times.');
  return value;
}
function choice(value, choices) {
  if (!choices.includes(value)) throw bad('Choose a valid status.');
  return value;
}

const terms = {
  table: 'academic_terms',
  fields: { name: v => string(v, 100), startDate: date, endDate: date },
  columns: { name: 'name', startDate: 'start_date', endDate: 'end_date' },
  select: `a.id, a.name, DATE_FORMAT(a.start_date,'%Y-%m-%d') AS startDate,
    DATE_FORMAT(a.end_date,'%Y-%m-%d') AS endDate,
    CASE WHEN a.status = 'archived' THEN 'archived' WHEN CURRENT_DATE < a.start_date THEN 'upcoming'
    WHEN CURRENT_DATE > a.end_date THEN 'completed' ELSE 'active' END AS status,
    (SELECT COUNT(*) FROM courses c WHERE c.user_id=a.user_id AND c.term_id=a.id) AS courseCount`,
  order: 'a.start_date DESC, a.id DESC',
  statuses: ['active', 'upcoming', 'completed', 'archived', 'current'],
};
const courses = {
  table: 'courses',
  fields: { termId: integer, title: v => string(v, 150), code: v => string(v, 40),
    instructor: v => string(v, 100, false), location: v => string(v, 150, false),
    description: v => string(v, 5000, false), color: v => {
      if (typeof v !== 'string' || !/^#[a-f\d]{6}$/i.test(v)) throw bad('Choose a valid course color.');
      return v;
    } },
  columns: { termId: 'term_id', title: 'title', code: 'code', instructor: 'instructor', location: 'location', description: 'description', color: 'color' },
  select: `a.id, a.term_id AS termId, a.title, a.code, a.instructor, a.location, a.description,
    a.color, a.status, t.name AS termName, t.status AS termStatus`,
  join: ' JOIN academic_terms t ON t.user_id=a.user_id AND t.id=a.term_id',
  order: 'a.title, a.id',
  statuses: ['active', 'archived'],
};
const meetings = {
  table: 'course_schedules',
  fields: { weekday: v => integer(v, 7), startTime: time, endTime: time, location: v => string(v, 150, false) },
  columns: { weekday: 'weekday', startTime: 'start_time', endTime: 'end_time', location: 'location' },
  select: `a.id, a.course_id AS courseId, a.weekday, TIME_FORMAT(a.start_time,'%H:%i') AS startTime,
    TIME_FORMAT(a.end_time,'%H:%i') AS endTime, a.location`,
  order: 'a.weekday, a.start_time, a.id',
};
function source(spec) { return spec.table + ' a' + (spec.join || ''); }
async function read(db, spec, owner, id, courseId) {
  const row = await one(db, 'SELECT ' + spec.select + ' FROM ' + source(spec) +
    ' WHERE a.user_id=? AND a.id=?' + (courseId ? ' AND a.course_id=?' : ''), courseId ? [owner, id, courseId] : [owner, id]);
  if (!row) throw missing();
  return row;
}
async function list(db, spec, owner, query, courseId) {
  const page = query.page === undefined ? 1 : integer(query.page, 1000000);
  const limit = query.limit === undefined ? 20 : integer(query.limit, 100);
  const filters = ['a.user_id=?'];
  const values = [owner];
  if (courseId) { filters.push('a.course_id=?'); values.push(courseId); }
  if (query.status !== undefined) {
    const status = choice(query.status, spec.statuses || []);
    const statusColumn = spec === terms ? "CASE WHEN a.status='archived' THEN 'archived' WHEN CURRENT_DATE<a.start_date THEN 'upcoming' WHEN CURRENT_DATE>a.end_date THEN 'completed' ELSE 'active' END" : 'a.status';
    filters.push(status === 'current' ? "a.status <> 'archived'" : statusColumn + '=?');
    if (status !== 'current') values.push(status);
  }
  if (spec === courses && query.termId !== undefined) { filters.push('a.term_id=?'); values.push(integer(query.termId)); }
  if (spec === courses && query.search !== undefined) {
    const search = string(query.search, 150);
    filters.push('(LOCATE(?, a.title)>0 OR LOCATE(?, a.code)>0)');
    values.push(search, search);
  }
  const from = ' FROM ' + source(spec) + ' WHERE ' + filters.join(' AND ');
  const [{ total }] = await db.execute('SELECT COUNT(*) AS total' + from, values).then(([rows]) => rows);
  const [items] = await db.query('SELECT ' + spec.select + from + ' ORDER BY ' + spec.order + ' LIMIT ? OFFSET ?', [...values, limit, (page - 1) * limit]);
  return { items, page, limit, total };
}
async function save(db, spec, owner, id, body, courseId) {
  const previous = id ? await read(db, spec, owner, id, courseId) : null;
  if (previous?.status === 'archived') throw conflict('Archived records are read-only.');
  requireFields(body, Object.keys(spec.fields));
  const updates = Object.fromEntries(Object.entries(body).map(([key, value]) => [key, spec.fields[key](value)]));
  const next = { ...previous, ...updates };
  if (spec === terms && (!next.name || !next.startDate || !next.endDate || next.endDate < next.startDate)) throw bad('Enter a term name and an end date on or after the start date.');
  if (spec === courses) {
    if (!next.title || !next.code || !next.termId) throw bad('Enter a title and code and select a term.');
    const term = await read(db, terms, owner, next.termId);
    if (term.status === 'archived') throw conflict('Choose a term that is not archived.');
  }
  if (spec === meetings) {
    if (!next.weekday || !next.startTime || !next.endTime || next.endTime <= next.startTime) throw bad('Choose a weekday and an end time later than the start time.');
    const duplicate = await one(db, 'SELECT id FROM course_schedules WHERE user_id=? AND course_id=? AND weekday=? AND start_time=? AND end_time=? AND id<>?', [owner, courseId, next.weekday, next.startTime, next.endTime, id || 0]);
    if (duplicate) throw conflict('This meeting time already exists.');
  }
  const columns = Object.keys(updates).map(key => spec.columns[key]);
  const args = Object.values(updates);
  if (id) {
    await db.execute('UPDATE ' + spec.table + ' SET ' + columns.map(column => column + '=?').join(',') + ' WHERE user_id=? AND id=?' + (courseId ? ' AND course_id=?' : ''),
      [...args, owner, id, ...(courseId ? [courseId] : [])]);
  } else {
    columns.push('user_id');
    args.push(owner);
    if (courseId) { columns.push('course_id'); args.push(courseId); }
    const [result] = await db.execute('INSERT INTO ' + spec.table + ' (' + columns.join(',') + ') VALUES (' + args.map(() => '?').join(',') + ')', args);
    id = result.insertId;
  }
  return read(db, spec, owner, id, courseId);
}

export function mountAcademics(router, { pool, requireUser, respond }) {
  const write = (req, run) => transaction(pool, async db => {
    await one(db, 'SELECT id FROM users WHERE id=? FOR UPDATE', [req.user.id]);
    return run(db, req.user.id);
  });
  for (const [path, spec] of [['/terms', terms], ['/courses', courses]]) {
    router.get(path, requireUser, async (req, res) => respond(req, res, await list(pool, spec, req.user.id, req.query)));
    router.post(path, requireUser, async (req, res) => respond(req, res, await write(req, (db, owner) => save(db, spec, owner, null, req.body)), 201));
    router.get(path + '/:id', requireUser, async (req, res) => respond(req, res, await read(pool, spec, req.user.id, integer(req.params.id))));
    router.patch(path + '/:id', requireUser, async (req, res) => respond(req, res, await write(req, (db, owner) => save(db, spec, owner, integer(req.params.id), req.body))));
    router.delete(path + '/:id', requireUser, async (req, res) => respond(req, res, await write(req, async (db, owner) => {
      const id = integer(req.params.id);
      await read(db, spec, owner, id);
      await db.execute("UPDATE " + spec.table + " SET status='archived' WHERE user_id=? AND id=?", [owner, id]);
      return read(db, spec, owner, id);
    })));
  }
  router.get('/timetable', requireUser, async (req, res) => {
    const [items] = await pool.execute(`SELECT ${meetings.select}, c.title, c.code, c.color, c.location AS courseLocation
      FROM course_schedules a JOIN courses c ON c.user_id=a.user_id AND c.id=a.course_id
      JOIN academic_terms t ON t.user_id=c.user_id AND t.id=c.term_id
      WHERE a.user_id=? AND c.status='active' AND t.status<>'archived' ORDER BY ${meetings.order}`, [req.user.id]);
    return respond(req, res, { items, timezone: req.user.timezone, locale: req.user.locale });
  });
  const path = '/courses/:id/schedules';
  router.get(path, requireUser, async (req, res) => {
    const id = integer(req.params.id);
    await read(pool, courses, req.user.id, id);
    return respond(req, res, await list(pool, meetings, req.user.id, req.query, id));
  });
  for (const [method, suffix] of [['post', ''], ['patch', '/:scheduleId'], ['delete', '/:scheduleId']]) {
    router[method](path + suffix, requireUser, async (req, res) => respond(req, res, await write(req, async (db, owner) => {
      const courseId = integer(req.params.id);
      const course = await read(db, courses, owner, courseId);
      if (course.status === 'archived' || course.termStatus === 'archived') throw conflict('Meetings in archived records are read-only.');
      const id = req.params.scheduleId ? integer(req.params.scheduleId) : null;
      if (method !== 'delete') return save(db, meetings, owner, id, req.body, courseId);
      await read(db, meetings, owner, id, courseId);
      await db.execute('DELETE FROM course_schedules WHERE user_id=? AND course_id=? AND id=?', [owner, courseId, id]);
      return {};
    }), method === 'post' ? 201 : 200));
  }
}
