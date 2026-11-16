import { transaction } from '../config/database.js';
import { requireFields } from '../controllers/account.js';
import { one } from '../repositories/accounts.js';
import { ApiError } from '../services/auth.js';
import { dayBoundary, localStamp, nextDate } from '../../../shared/task-time.js';

const categories = ['assignment', 'exam', 'quiz', 'reading', 'project', 'presentation', 'personal_study'];
const priorities = ['low', 'medium', 'high'];
const statuses = ['not_started', 'in_progress', 'completed', 'archived'];
const invalid = message => new ApiError(400, 'VALIDATION_ERROR', message);
const missing = () => new ApiError(404, 'NOT_FOUND', 'The requested record was not found.');
const immutable = () => new ApiError(409, 'TASK_ARCHIVED', 'Archived tasks are read-only.');
const integer = (value, max = 4294967295, min = 1) => {
  const n = Number(value);
  if (!['number', 'string'].includes(typeof value) || !/^\d+$/.test(String(value)) || !Number.isInteger(n) || n < min || n > max) throw invalid('Enter a valid number.');
  return n;
};
function text(value, max, optional = false) {
  if (optional && (value === '' || value === null)) return null;
  if (typeof value !== 'string' || value.trim().length > max || (!optional && !value.trim())) throw invalid('Check the required text fields and their lengths.');
  return value.trim() || null;
}
function choice(value, values) {
  if (!values.includes(value)) throw invalid('Choose a valid filter or task option.');
  return value;
}
function date(value) {
  if (typeof value !== 'string' || !/^[1-9]\d{3}-\d\d-\d\d$/.test(value)) throw invalid('Enter a valid date.');
  const parsed = new Date(value + 'T00:00Z');
  if (!Number.isFinite(+parsed) || parsed.toISOString().slice(0, 10) !== value || value > '9999-12-30') throw invalid('Enter a valid date.');
  return value;
}
function instant(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{3})?)?Z$/.test(value)) throw invalid('Send a UTC deadline.');
  date(value.slice(0, 10));
  const parsed = new Date(value);
  if (!Number.isFinite(+parsed) || parsed.toISOString().slice(0, 16) !== value.slice(0, 16)) throw invalid('Enter a valid deadline.');
  return parsed;
}
const fields = {
  title: ['title', value => text(value, 150)],
  description: ['description', value => text(value, 10000, true)],
  courseId: ['course_id', value => value === null ? null : integer(value)],
  category: ['category', value => choice(value, categories)],
  priority: ['priority', value => choice(value, priorities)],
  status: ['status', value => choice(value, statuses.slice(0, 3))],
  dueAt: ['due_at', value => value === null ? null : instant(value)],
  dueDate: ['due_date', value => value === null ? null : date(value)],
  targetDate: ['target_date', value => value === null ? null : date(value)],
  targetAt: ['target_at', value => value === null ? null : instant(value)],
  estimateMinutes: ['estimate_minutes', value => value === null ? null : integer(value, 100000, 0)],
};
const pending = "t.status IN ('not_started','in_progress')";
const late = "((t.due_at IS NOT NULL AND t.due_at < ?) OR (t.due_date IS NOT NULL AND t.due_date < ?))";
const selection = `t.id,t.title,t.description,t.course_id AS courseId,t.category,t.priority,t.status,
  t.due_at AS dueAt, DATE_FORMAT(t.due_date,'%Y-%m-%d') AS dueDate, t.target_at AS targetAt,
  DATE_FORMAT(t.target_date,'%Y-%m-%d') AS targetDate,t.estimate_minutes AS estimateMinutes,
  t.completed_at AS completedAt,t.archived_at AS archivedAt,t.created_at AS createdAt,t.updated_at AS updatedAt,
  c.title AS courseTitle,c.color AS courseColor,
  (SELECT COUNT(*) FROM subtasks s WHERE s.user_id=t.user_id AND s.task_id=t.id) AS subtaskCount,
  (SELECT COUNT(*) FROM subtasks s WHERE s.user_id=t.user_id AND s.task_id=t.id AND s.status='completed') AS subtaskCompleted,
  CASE WHEN ${pending} AND ${late} THEN 'overdue' WHEN ${pending} AND (t.due_at IS NOT NULL OR t.due_date IS NOT NULL) THEN 'upcoming' END AS deadlineState`;
const source = ' FROM tasks t LEFT JOIN courses c ON c.user_id=t.user_id AND c.id=t.course_id';
const subFields = 'id,task_id AS taskId,title,status,position,created_at AS createdAt,updated_at AS updatedAt';
const context = user => {
  const now = new Date();
  return { now, today: localStamp(now, user.timezone).slice(0, 10), timezone: user.timezone, owner: user.id };
};
async function task(db, ctx, id) {
  const row = await one(db, 'SELECT ' + selection + source + ' WHERE t.user_id=? AND t.id=?', [ctx.now, ctx.today, ctx.owner, id]);
  if (!row) throw missing();
  return row;
}
async function subtask(db, owner, id) {
  const row = await one(db, 'SELECT ' + subFields + ' FROM subtasks WHERE user_id=? AND id=?', [owner, id]);
  if (!row) throw missing();
  return row;
}
function pagination(query) {
  return { page: query.page === undefined ? 1 : integer(query.page, 1000000), limit: query.limit === undefined ? 20 : integer(query.limit, 100) };
}
async function list(db, ctx, query) {
  const { owner, now, today, timezone } = ctx;
  const { page, limit } = pagination(query);
  const where = ['t.user_id=?'];
  const args = [owner];
  for (const [name, allowed] of [['category', categories], ['priority', priorities], ['status', statuses]]) {
    if (query[name] !== undefined) {
      where.push('t.' + name + '=?');
      args.push(choice(query[name], allowed));
    }
  }
  if (query.status === undefined) where.push("t.status <> 'archived'");
  if (query.courseId === 'personal') where.push('t.course_id IS NULL');
  else if (query.courseId !== undefined) {
    where.push('t.course_id=?');
    args.push(integer(query.courseId));
  }
  if (query.search !== undefined) {
    const search = text(query.search, 150);
    where.push('(LOCATE(?,t.title)>0 OR LOCATE(?,t.description)>0)');
    args.push(search, search);
  }
  if (query.deadline !== undefined) {
    const deadline = choice(query.deadline, ['upcoming', 'overdue']);
    where.push(pending, '(t.due_at IS NOT NULL OR t.due_date IS NOT NULL)');
    where.push(deadline === 'overdue' ? late : '((t.due_at IS NOT NULL AND t.due_at >= ?) OR (t.due_date IS NOT NULL AND t.due_date >= ?))');
    args.push(now, today);
  }
  const from = query.from === undefined ? null : date(query.from);
  const to = query.to === undefined ? null : date(query.to);
  if (from && to && from > to) throw invalid('The end date must be on or after the start date.');
  if (from) {
    where.push('(t.due_date>=? OR t.due_at>=?)');
    args.push(from, dayBoundary(from, timezone));
  }
  if (to) {
    where.push('(t.due_date<=? OR t.due_at<?)');
    args.push(to, dayBoundary(nextDate(to), timezone));
  }
  const sort = query.sort === undefined ? 'recent' : choice(query.sort, ['recent', 'due', 'title']);
  const orders = { recent: 't.created_at DESC,t.id DESC', due: 'COALESCE(t.due_date,DATE(t.due_at)) IS NULL,COALESCE(t.due_date,DATE(t.due_at)),t.due_at,t.id', title: 't.title,t.id' };
  const clause = ' WHERE ' + where.join(' AND ');
  const { total } = await one(db, 'SELECT COUNT(*) AS total FROM tasks t' + clause, args);
  const [items] = await db.execute('SELECT ' + selection + source + clause + ' ORDER BY ' + orders[sort] + ' LIMIT ? OFFSET ?', [now, today, ...args, limit, (page - 1) * limit]);
  const summary = await one(db, `SELECT COUNT(*) AS total, COUNT(CASE WHEN ${pending} THEN 1 END) AS pending,
    COUNT(CASE WHEN t.status='completed' THEN 1 END) AS completed, COUNT(CASE WHEN ${pending} AND ${late} THEN 1 END) AS overdue
    FROM tasks t WHERE t.user_id=? AND t.status<>'archived'`, [now, today, owner]);
  return { items, total, page, limit, summary };
}
async function save(db, ctx, id, body, archive = false) {
  const previous = id ? await task(db, ctx, id) : null;
  if (previous?.status === 'archived') {
    if (archive) return previous;
    throw immutable();
  }
  if (!archive) requireFields(body, Object.keys(fields));
  const updates = archive ? { status: 'archived' } : Object.fromEntries(Object.entries(body).map(([key, value]) => [key, fields[key][1](value)]));
  const next = { status: 'not_started', ...previous, ...updates };
  if (!next.title || !next.category) throw invalid('Enter a title and category.');
  if (next.dueAt && next.dueDate) throw invalid('Choose a timed or all-day deadline.');
  if (next.targetAt && next.targetDate) throw invalid('Choose a timed or date-only target.');
  if (next.courseId && 'courseId' in updates && !await one(db, 'SELECT id FROM courses WHERE user_id=? AND id=?', [ctx.owner, next.courseId])) throw missing();
  const columns = Object.keys(updates).map(key => fields[key][0]);
  const args = Object.values(updates);
  const changed = next.status !== previous?.status;
  if (changed && next.status !== 'archived') {
    columns.push('completed_at');
    args.push(next.status === 'completed' ? ctx.now : null);
  }
  if (archive) {
    columns.push('archived_at');
    args.push(ctx.now);
  }
  if (id) await db.execute('UPDATE tasks SET ' + columns.map(column => column + '=?').join(',') + ' WHERE user_id=? AND id=?', [...args, ctx.owner, id]);
  else {
    const [result] = await db.execute('INSERT INTO tasks (user_id,' + columns.join(',') + ') VALUES (?,' + args.map(() => '?').join(',') + ')', [ctx.owner, ...args]);
    id = result.insertId;
  }
  if (changed) {
    if (previous?.status === 'completed') {
      await db.execute(`INSERT INTO task_status_history (user_id,task_id,status,occurred_at)
        SELECT ?,?,'completed',? WHERE NOT EXISTS (SELECT 1 FROM task_status_history WHERE user_id=? AND task_id=? AND status='completed')`,
      [ctx.owner, id, previous.completedAt, ctx.owner, id]);
    }
    await db.execute('INSERT INTO task_status_history (user_id,task_id,status,occurred_at) VALUES (?,?,?,?)', [ctx.owner, id, next.status, ctx.now]);
  }
  return task(db, ctx, id);
}
async function getSubtasks(db, owner, id, query) {
  const { page, limit } = pagination(query);
  const { total } = await one(db, 'SELECT COUNT(*) AS total FROM subtasks WHERE user_id=? AND task_id=?', [owner, id]);
  const [items] = await db.execute('SELECT ' + subFields + ' FROM subtasks WHERE user_id=? AND task_id=? ORDER BY position,id LIMIT ? OFFSET ?', [owner, id, limit, (page - 1) * limit]);
  return { items, total, limit, page };
}
export function mountTasks(router, { pool, requireUser, respond }) {
  const write = (req, run) => transaction(pool, async db => {
    await one(db, 'SELECT id FROM users WHERE id=? FOR UPDATE', [req.user.id]);
    return run(db, context(req.user));
  });
  async function editable(db, ctx, id) {
    const current = await task(db, ctx, id);
    if (current.status === 'archived') throw immutable();
  }
  router.get('/tasks', requireUser, async (req, res) => respond(req, res, await list(pool, context(req.user), req.query)));
  router.get('/tasks/:id', requireUser, async (req, res) => respond(req, res, await task(pool, context(req.user), integer(req.params.id))));
  router.post('/tasks', requireUser, async (req, res) => respond(req, res, await write(req, (db, ctx) => save(db, ctx, null, req.body)), 201));
  for (const method of ['patch', 'delete']) {
    router[method]('/tasks/:id', requireUser, async (req, res) => respond(req, res, await write(req, (db, ctx) => save(db, ctx, integer(req.params.id), req.body, method === 'delete'))));
  }
  router.get('/tasks/:id/subtasks', requireUser, async (req, res) => {
    const id = integer(req.params.id);
    await task(pool, context(req.user), id);
    return respond(req, res, await getSubtasks(pool, req.user.id, id, req.query));
  });
  router.post('/tasks/:id/subtasks', requireUser, async (req, res) => respond(req, res, await write(req, async (db, ctx) => {
    const id = integer(req.params.id);
    await editable(db, ctx, id);
    const { title } = requireFields(req.body, ['title']);
    const { position } = await one(db, 'SELECT COALESCE(MAX(position),0)+1 AS position FROM subtasks WHERE user_id=? AND task_id=?', [ctx.owner, id]);
    const [result] = await db.execute('INSERT INTO subtasks (user_id,task_id,title,position) VALUES (?,?,?,?)', [ctx.owner, id, text(title, 150), position]);
    return subtask(db, ctx.owner, result.insertId);
  }), 201));
  router.patch('/tasks/:id/subtasks/reorder', requireUser, async (req, res) => respond(req, res, await write(req, async (db, ctx) => {
    const id = integer(req.params.id);
    await editable(db, ctx, id);
    const { ids } = requireFields(req.body, ['ids']);
    if (!Array.isArray(ids)) throw invalid('Send the ordered list of subtask IDs.');
    const order = ids.map(value => integer(value));
    const [rows] = await db.execute('SELECT id FROM subtasks WHERE user_id=? AND task_id=?', [ctx.owner, id]);
    const allowed = new Set(rows.map(row => row.id));
    if (order.length !== allowed.size || new Set(order).size !== allowed.size || order.some(value => !allowed.has(value))) throw invalid('Send each subtask ID exactly once.');
    for (const [position, subId] of order.entries()) await db.execute('UPDATE subtasks SET position=? WHERE user_id=? AND task_id=? AND id=?', [position + 1, ctx.owner, id, subId]);
    return {};
  })));
  for (const method of ['patch', 'delete']) {
    router[method]('/subtasks/:id', requireUser, async (req, res) => respond(req, res, await write(req, async (db, ctx) => {
      const id = integer(req.params.id);
      const current = await subtask(db, ctx.owner, id);
      await editable(db, ctx, current.taskId);
      if (method === 'delete') {
        await db.execute('DELETE FROM subtasks WHERE user_id=? AND id=?', [ctx.owner, id]);
        return {};
      }
      const patch = requireFields(req.body, ['title', 'status']);
      const title = 'title' in patch ? text(patch.title, 150) : current.title;
      const status = 'status' in patch ? choice(patch.status, ['not_started', 'completed']) : current.status;
      await db.execute('UPDATE subtasks SET title=?,status=? WHERE user_id=? AND id=?', [title, status, ctx.owner, id]);
      return subtask(db, ctx.owner, id);
    })));
  }
}
