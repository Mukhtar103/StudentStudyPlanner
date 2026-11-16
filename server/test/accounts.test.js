import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import bcrypt from 'bcryptjs';
import { createApp } from '../src/app.js';
import { createDatabase } from '../src/config/database.js';
import { createResetMailer, digest } from '../src/services/auth.js';
import { migrate } from '../../database/migrate.js';

const origin = 'http://localhost:5173';
const first = 'Original test password';
const changed = 'Updated test password';
const recovered = 'Recovered test password';
const email = randomUUID() + '@example.test';
const secondEmail = randomUUID() + '@example.test';
const pool = process.env.TEST_DB_NAME ? createDatabase({ ...process.env, DB_NAME: process.env.TEST_DB_NAME }) : null;
if (process.env.TEST_DB_NAME && (!pool || process.env.TEST_DB_NAME === process.env.DB_NAME || !/_test$/.test(process.env.TEST_DB_NAME))) {
  throw new Error('Use a separate TEST_DB_NAME ending in _test and configure DB_USER');
}

const servers = [];
const mail = new Map();
let base;
let user;
let cookie;
let secondCookie;
let token;
const headers = { origin, 'content-type': 'application/json', 'x-planner-request': '1' };

async function start(options) {
  const server = createApp({ origins: [origin], ...options }).listen(0, '127.0.0.1');
  servers.push(server);
  await new Promise((resolve, reject) => server.once('listening', resolve).once('error', reject));
  return 'http://127.0.0.1:' + server.address().port;
}

async function call(path, { at = base, session, body, method = body === undefined ? 'GET' : 'POST', extra } = {}) {
  const response = await fetch(at + '/api/v1' + path, {
    method, headers: { ...headers, ...(session ? { cookie: session } : {}), ...extra },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await response.json();
  const setCookie = response.headers.get('set-cookie');
  return { status: response.status, ...json, cookie: setCookie?.split(';')[0], setCookie };
}

before(async () => {
  if (!pool) return;
  await pool.query('SELECT 1');
  await migrate(pool);
  await migrate(pool);
  base = await start({ pool, sendReset: async (address, value) => { mail.set(address, value); } });
});
after(async () => {
  for (const server of servers) await new Promise(resolve => server.close(resolve));
  if (!pool) return;
  try {
    await pool.execute('DELETE FROM study_sessions WHERE user_id IN (SELECT id FROM users WHERE email IN (?, ?))', [email, secondEmail]);
    await pool.execute('DELETE FROM tasks WHERE user_id IN (SELECT id FROM users WHERE email IN (?, ?))', [email, secondEmail]);
    await pool.execute('DELETE FROM courses WHERE user_id IN (SELECT id FROM users WHERE email IN (?, ?))', [email, secondEmail]);
    await pool.execute('DELETE FROM audit_logs WHERE user_id IN (SELECT id FROM users WHERE email IN (?, ?))', [email, secondEmail]);
    await pool.execute('DELETE FROM users WHERE email IN (?, ?)', [email, secondEmail]);
  } finally { await pool.end(); }
});

test('account routes safely report missing database and reject unverified writes', async () => {
  const at = await start({});
  assert.equal((await call('/auth/session', { at })).status, 503);
  assert.equal((await call('/auth/register', { at, body: {}, extra: { origin: 'https://other.example' } })).status, 403);
  assert.equal((await call('/auth/register', { at, body: {}, extra: { 'x-planner-request': '' } })).status, 403);
});

test('MySQL migrations are repeatable and create all foundation tables', { skip: !pool }, async () => {
  const [rows] = await pool.query('SHOW TABLES');
  assert.equal(rows.length, 17);
  const [[result]] = await pool.query('SELECT COUNT(*) AS total FROM schema_migrations');
  assert.equal(result.total, 5);
});

test('registration validates input, rejects duplicate email, stores bcrypt and issues secure cookies', { skip: !pool }, async () => {
  assert.equal((await call('/auth/register', { body: { email: 'invalid', password: first, displayName: 'First' } })).status, 400);
  assert.equal((await call('/auth/register', { body: { email, password: 'short', displayName: 'First' } })).status, 400);
  const at = await start({ pool, secure: true });
  const result = await call('/auth/register', { at, body: { email, password: first, displayName: 'First' } });
  assert.equal(result.status, 201);
  assert.match(result.setCookie, /^__Host-ssp_session=/);
  assert.match(result.setCookie, /; Secure/);
  assert.match(result.setCookie, /; HttpOnly/);
  assert.match(result.setCookie, /; SameSite=Lax/);
  assert.equal(result.data.password_hash, undefined);
  user = result.data;
  const [[row]] = await pool.execute('SELECT password_hash FROM users WHERE id = ?', [user.id]);
  assert.equal(bcrypt.getRounds(row.password_hash), Number(process.env.BCRYPT_COST || 12));
  assert(await bcrypt.compare(first, row.password_hash));
  assert.equal((await call('/auth/register', { body: { email: email.toUpperCase(), password: first, displayName: 'Duplicate' } })).status, 409);
  const login = await call('/auth/login', { body: { email, password: first } });
  assert.equal(login.status, 200);
  cookie = login.cookie;
});

test('login rejects invalid credentials and sessions restore and expire', { skip: !pool }, async () => {
  assert.equal((await call('/auth/login', { body: { email, password: 'incorrect' } })).status, 401);
  assert.equal((await call('/me')).status, 401);
  assert.equal((await call('/auth/session', { session: cookie })).data.id, user.id);
  const extra = await call('/auth/login', { body: { email, password: first } });
  await pool.execute('UPDATE sessions SET expires_at = UTC_TIMESTAMP(3) WHERE token_hash = ?', [digest(extra.cookie.split('=')[1])]);
  assert.equal((await call('/auth/session', { session: extra.cookie })).status, 401);
});

test('profile and preferences persist and are scoped to the authenticated account', { skip: !pool }, async () => {
  const second = await call('/auth/register', { body: { email: secondEmail, password: first, displayName: 'Other student' } });
  assert.equal(second.status, 201);
  secondCookie = second.cookie;
  assert.equal((await call('/me', { method: 'PATCH', session: secondCookie, body: { userId: user.id, displayName: 'Other' } })).status, 400);
  assert.equal((await call('/me', { method: 'PATCH', session: cookie, extra: { origin: 'https://other.example' }, body: { displayName: 'Blocked' } })).status, 403);
  const profile = { displayName: 'Updated student', timezone: 'Asia/Kabul', locale: 'en-GB' };
  assert.equal((await call('/me', { method: 'PATCH', session: cookie, body: profile })).status, 200);
  assert.deepEqual((await call('/me', { session: cookie })).data, { ...profile, email, id: user.id });
  const preferences = { reminderMinutes: 45, emailNotifications: true, inAppNotifications: false, quietStart: '22:00', quietEnd: '06:30' };
  assert.equal((await call('/preferences', { method: 'PATCH', session: cookie, body: preferences })).status, 200);
  assert.deepEqual((await call('/preferences', { session: cookie })).data, preferences);
  assert.equal((await call('/preferences', { session: secondCookie })).data.reminderMinutes, 30);
  assert.equal((await call('/me?userId=' + user.id, { session: secondCookie })).data.id, second.data.id);
});

test('password change verifies current password, revokes sessions, and supports secure logout', { skip: !pool }, async () => {
  assert.equal((await call('/auth/password/change', { session: cookie, body: { currentPassword: 'incorrect', password: changed } })).status, 400);
  assert.equal((await call('/auth/password/change', { session: cookie, body: { currentPassword: first, password: changed } })).status, 200);
  assert.equal((await call('/auth/session', { session: cookie })).status, 401);
  assert.equal((await call('/auth/login', { body: { email, password: first } })).status, 401);
  const result = await call('/auth/login', { body: { email, password: changed } });
  assert.equal(result.status, 200);
  assert.equal((await call('/auth/logout', { session: result.cookie, body: {} })).status, 200);
  assert.equal((await call('/me', { session: result.cookie })).status, 401);
});

test('reset uses generic responses, hashed tokens, expiry, and single-use consumption', { skip: !pool }, async () => {
  const at = await start({ pool });
  const unavailable = await call('/auth/password/forgot', { at, body: { email } });
  assert.equal(unavailable.status, 503);
  const known = await call('/auth/password/forgot', { body: { email } });
  const unknown = await call('/auth/password/forgot', { body: { email: 'unknown@example.test' } });
  assert.equal(known.status, 202);
  assert.deepEqual(known.data, unknown.data);
  token = mail.get(email);
  assert.match(token, /^[a-f0-9]{64}$/);
  const [[row]] = await pool.execute('SELECT token_hash FROM password_reset_tokens WHERE user_id = ?', [user.id]);
  assert.deepEqual(row.token_hash, digest(token));
  await pool.execute('UPDATE password_reset_tokens SET expires_at = UTC_TIMESTAMP(3) WHERE user_id = ?', [user.id]);
  const expired = await call('/auth/password/reset', { body: { token, password: recovered } });
  assert.equal(expired.error.code, 'INVALID_RESET_TOKEN');
  await call('/auth/password/forgot', { body: { email } });
  token = mail.get(email);
  const attempts = await Promise.all([1, 2].map(() => call('/auth/password/reset', { body: { token, password: recovered } })));
  assert.deepEqual(attempts.map(result => result.status).sort(), [200, 400]);
  assert.equal((await call('/auth/login', { body: { email, password: recovered } })).status, 200);
});

test('authentication routes rate limit requests', { skip: !pool }, async () => {
  const at = await start({ pool });
  for (let i = 0; i < 8; i++) assert.equal((await call('/auth/register', { at, body: {} })).status, 400);
  assert.equal((await call('/auth/register', { at, body: {} })).status, 429);
});


test('SMTP adapter delivers a reset link to a local SMTP receiver', async () => {
  let message = '';
  const receiver = createServer(socket => {
    socket.setEncoding('utf8');
    socket.write('220 local.test ESMTP\r\n');
    let buffer = '';
    let receiving = false;
    socket.on('data', chunk => {
      buffer += chunk;
      while (buffer.includes('\r\n')) {
        const end = buffer.indexOf('\r\n');
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (receiving && line !== '.') message += line + '\n';
        else if (line === '.') {
          receiving = false;
          socket.write('250 accepted\r\n');
        } else if (line === 'DATA') {
          receiving = true;
          socket.write('354 continue\r\n');
        } else if (line === 'QUIT') socket.end('221 goodbye\r\n');
        else socket.write('250 local.test\r\n');
      }
    });
  });
  await new Promise(resolve => receiver.listen(0, '127.0.0.1', resolve));
  try {
    const send = createResetMailer({
      SMTP_URL: 'smtp://127.0.0.1:' + receiver.address().port,
      SMTP_FROM: 'planner@example.test',
      APP_URL: origin,
    });
    await send(email, 'a'.repeat(64));
    assert.match(message, /Subject: Reset your Study Planner password/);
    assert.match(message, /\/reset-password#token/);
  } finally {
    await new Promise(resolve => receiver.close(resolve));
  }
});

test('academic records persist with filtering, ownership, and archive history', { skip: !pool }, async () => {
  const login = await call('/auth/login', { body: { email, password: recovered } });
  assert.equal(login.status, 200);
  const session = login.cookie;
  const post = (path, body, owner = session) => call(path, { body, session: owner });
  const patch = (path, body) => call(path, { body, session, method: 'PATCH' });
  const get = (path, owner = session) => call(path, { session: owner });
  const remove = path => call(path, { body: {}, session, method: 'DELETE' });
  const dates = { startDate: '2026-01-01', endDate: '2027-12-31' };
  assert.equal((await post('/terms', { name: 'Invalid', startDate: '2026-02-31', endDate: dates.endDate })).status, 400);
  assert.equal((await post('/terms', { name: 'Invalid', startDate: dates.endDate, endDate: dates.startDate })).status, 400);
  const created = await post('/terms', { name: 'Term A', ...dates });
  assert.equal(created.status, 201);
  const termId = created.data.id;
  const termPath = '/terms/' + termId;
  assert.equal((await patch(termPath, { name: 'Term B' })).data.name, 'Term B');
  assert.equal((await get(termPath, secondCookie)).status, 404);
  assert.equal((await post('/courses', { termId, title: 'Calculus', code: 'MAT-10' }, secondCookie)).status, 404);
  const course = await post('/courses', { termId, title: 'Calculus', code: 'MAT-10' });
  assert.equal(course.status, 201);
  assert.equal((await post('/courses', { termId, title: 'Biology', code: 'BIO-20' })).status, 201);
  const coursePath = '/courses/' + course.data.id;
  assert.equal((await get(coursePath, secondCookie)).status, 404);
  assert.equal((await patch(coursePath, { title: 'Advanced Calculus', location: 'Room 4', color: '#6644cc' })).data.location, 'Room 4');
  const entries = await get('/courses?status=active&termId=' + termId + '&search=MAT-10&limit=1');
  assert.equal(entries.data.total, 1);
  assert.equal(entries.data.items[0].id, course.data.id);
  const nextPage = await get('/courses?termId=' + termId + '&limit=1&page=2');
  assert.equal(nextPage.data.total, 2);
  assert.equal(nextPage.data.items.length, 1);
  assert.equal((await get(termPath)).data.courseCount, 2);
  const schedules = coursePath + '/schedules';
  const monday = { weekday: 1, startTime: '09:00', endTime: '10:00', location: 'Room 7' };
  assert.equal((await post(schedules, { ...monday, endTime: '08:00' })).status, 400);
  const meeting = await post(schedules, monday);
  assert.equal(meeting.status, 201);
  assert.equal((await post(schedules, monday)).status, 409);
  const second = await post(schedules, { ...monday, weekday: 4 });
  assert.equal(second.status, 201);
  assert.equal((await get(schedules, secondCookie)).status, 404);
  assert.equal((await patch(schedules + '/' + meeting.data.id, { endTime: '11:00' })).data.endTime, '11:00');
  assert.equal((await get('/timetable')).data.items.length, 2);
  assert.equal((await remove(schedules + '/' + second.data.id)).status, 200);
  assert.equal((await call('/auth/logout', { session, body: {} })).status, 200);
  assert.equal((await get(coursePath)).status, 401);
  const restored = await call('/auth/login', { body: { email, password: recovered } });
  const nextSession = restored.cookie;
  assert.equal((await get(coursePath, nextSession)).data.title, 'Advanced Calculus');
  assert.equal((await get(schedules, nextSession)).data.items[0].endTime, '11:00');
  assert.equal((await call(coursePath, { session: nextSession, method: 'DELETE', body: {} })).data.status, 'archived');
  assert.equal((await get('/courses?status=archived', nextSession)).data.items[0].id, course.data.id);
  assert.equal((await call(termPath, { session: nextSession, method: 'DELETE', body: {} })).data.status, 'archived');
  assert.equal((await get('/terms?status=archived', nextSession)).data.items[0].id, termId);
  assert.equal((await get(schedules, nextSession)).data.total, 1);
  assert.equal((await get('/timetable', nextSession)).data.items.length, 0);
});




test('task lifecycle, deadline boundaries, filters, and subtask mutations are owner scoped', { skip: !pool }, async () => {
  const { cookie: session } = await call('/auth/login', { body: { email, password: recovered } });
  const request = (path, body, method, owner = session) => call(path, { session: owner, body, method });
  const create = body => request('/tasks', { category: 'reading', ...body });
  const otherTerm = await request('/terms', { name: 'Other term', startDate: '2026-01-01', endDate: '2028-01-01' }, 'POST', secondCookie);
  const otherCourse = await request('/courses', { title: 'Other course', code: 'OTH', termId: otherTerm.data.id }, 'POST', secondCookie);
  const ownTerm = await request('/terms', { name: 'Task test term', startDate: '2026-01-01', endDate: '2028-01-01' });
  const ownCourse = await request('/courses', { title: 'Task test course', code: 'OWN', termId: ownTerm.data.id });
  assert.equal((await create({ title: 'Denied', courseId: otherCourse.data.id })).status, 404);
  for (const invalid of [{ priority: 'critical' }, { status: 'archived' }, { category: 'wrong' }, { dueDate: '2025-02-29' }]) {
    assert.equal((await create({ title: 'Invalid', ...invalid })).status, 400);
  }
  const personal = await create({ title: 'Read the notes', description: 'Unique search phrase', priority: 'high', dueDate: '2020-10-20', targetDate: '2030-01-02' });
  assert.equal(personal.status, 201);
  assert.equal(personal.data.courseId, null);
  assert.equal(personal.data.deadlineState, 'overdue');
  const path = '/tasks/' + personal.data.id;
  const courseTask = await create({ title: 'Upcoming course reading', courseId: ownCourse.data.id, dueAt: new Date(Date.now() + 60000).toISOString() });
  assert.equal(courseTask.status, 201);
  assert.equal(courseTask.data.deadlineState, 'upcoming');
  assert.equal((await create({ title: 'Past timed', dueAt: new Date(Date.now() - 10000).toISOString() })).data.deadlineState, 'overdue');
  assert.equal((await request(path, undefined, 'GET', secondCookie)).status, 404);
  assert.equal((await request(path, { title: 'Private' }, 'PATCH', secondCookie)).status, 404);
  const filters = await request('/tasks?courseId=personal&priority=high&category=reading&status=not_started&from=2020-10-20&to=2020-10-20&search=Unique&deadline=overdue&sort=due&limit=1');
  assert.equal(filters.data.total, 1);
  assert.equal(filters.data.items[0].id, personal.data.id);
  assert.equal((await request('/tasks?sort=title&page=2&limit=1')).data.items.length, 1);
  const edited = await request(path, { title: 'Read chapter 3', targetDate: '2031-01-02' }, 'PATCH');
  assert.equal(edited.data.dueDate, '2020-10-20');
  assert.equal(edited.data.targetDate, '2031-01-02');
  const [a, b] = await Promise.all(['Open book', 'Read chapter'].map(title => request(path + '/subtasks', { title })));
  assert.equal(a.status, 201);
  assert.equal(b.status, 201);
  assert.equal((await request('/subtasks/' + a.data.id, { title: 'Find book', status: 'completed' }, 'PATCH')).data.status, 'completed');
  assert.equal((await request('/subtasks/' + a.data.id, { status: 'not_started' }, 'PATCH', secondCookie)).status, 404);
  assert.equal((await request(path + '/subtasks/reorder', { ids: [b.data.id, a.data.id] }, 'PATCH')).status, 200);
  assert.deepEqual((await request(path + '/subtasks')).data.items.map(item => item.id), [b.data.id, a.data.id]);
  const completed = await request(path, { status: 'completed' }, 'PATCH');
  assert(completed.data.completedAt);
  assert.equal(completed.data.deadlineState, null);
  const reopened = await request(path, { status: 'not_started' }, 'PATCH');
  assert.equal(reopened.data.completedAt, null);
  const [history] = await pool.execute('SELECT status,occurred_at FROM task_status_history WHERE user_id=? AND task_id=? ORDER BY id', [user.id, personal.data.id]);
  assert.deepEqual(history.map(row => row.status), ['not_started', 'completed', 'not_started']);
  assert.equal(history[1].occurred_at.toISOString(), completed.data.completedAt);
  await request('/me', { timezone: 'America/Los_Angeles' }, 'PATCH');
  assert.equal((await request(path)).data.dueDate, '2020-10-20');
  const dateToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  assert.equal((await create({ title: 'Due all day today', dueDate: dateToday })).data.deadlineState, 'upcoming');
  await request('/auth/logout', {});
  assert.equal((await request(path)).status, 401);
  const restored = await call('/auth/login', { body: { email, password: recovered } });
  assert.equal((await request(path, undefined, 'GET', restored.cookie)).data.title, 'Read chapter 3');
  assert.equal((await request('/subtasks/' + b.data.id, {}, 'DELETE', restored.cookie)).status, 200);
  const archived = await request(path, {}, 'DELETE', restored.cookie);
  assert(archived.data.archivedAt);
  assert.equal(archived.data.deadlineState, null);
  assert.equal((await request('/tasks?status=archived', undefined, 'GET', restored.cookie)).data.total, 1);
  assert.equal((await request(path + '/subtasks', undefined, 'GET', restored.cookie)).data.total, 1);
});

test('local deadline conversion handles DST transitions and local date boundaries', async () => {
  const { dayBoundary, localInstant, nextDate } = await import('../../shared/task-time.js');
  assert.equal(localInstant('2026-03-08T02:30', 'America/New_York'), null);
  assert.equal(localInstant('2026-11-01T01:30', 'America/New_York').toISOString(), '2026-11-01T05:30:00.000Z');
  assert.equal(localInstant('2026-04-01T00:15', 'Asia/Kabul').toISOString(), '2026-03-31T19:45:00.000Z');
  const date = '2026-03-08';
  assert.equal(dayBoundary(nextDate(date), 'America/New_York') - dayBoundary(date, 'America/New_York'), 23 * 3600000);
});



test('study sessions detect conflicts, keep recurrence exceptions, and record actual time', { skip: !pool }, async () => {
  const { cookie: session } = await call('/auth/login', { body: { email, password: recovered } });
  const request = (path, body, method, owner = session) => call(path, { session: owner, body, method });
  const base = '/study-sessions';
  const input = { title: 'Study calculus', startAt: '2030-03-05T17:00:00Z', plannedMinutes: 60 };
  const course = (await request('/courses?status=active')).data.items[0];
  const task = (await request('/tasks')).data.items[0];
  const otherCourse = (await request('/courses', undefined, 'GET', secondCookie)).data.items[0];
  const otherTask = await request('/tasks', { title: 'Other owner', category: 'reading' }, 'POST', secondCookie);
  assert.equal((await request(base,{ ...input,courseId:otherCourse.id })).status,404);
  assert.equal((await request(base,{ ...input,taskId:otherTask.data.id })).status,404);
  assert.equal((await request(base,{ ...input,plannedMinutes:0 })).status,400);
  assert.equal((await request(base,{ title:'Invalid end',startAt:input.startAt,endAt:'2030-03-05T16:00:00Z' })).status,400);
  const first = await request(base,input);
  assert.equal(first.status,201);
  const path = base + '/' + first.data.id;
  assert.equal((await request(path,undefined,'GET',secondCookie)).status,404);
  const overlap = await request(base,{ ...input,title:'Overlapping plan' });
  assert.equal(overlap.status,409);
  assert.equal(overlap.error.details[0].title,input.title);
  assert.equal((await request(base,{ ...input,title:'Overlapping plan',overrideConflict:true })).status,201);
  assert.equal((await request(base,{ ...input,startAt:'2030-03-05T18:00:00Z',courseId:course.id })).status,201);
  assert.equal((await request(path,{ objective:'Review derivatives' },'PATCH')).data.objective,'Review derivatives');
  assert.equal((await request(path+'/reschedule',{ startAt:'2030-03-06T17:00:00Z',plannedMinutes:75 },'PATCH')).data.plannedMinutes,75);
  assert.equal((await request(path+'/reschedule',{ startAt:'2030-03-06T18:00:00Z' },'PATCH')).data.plannedMinutes,75);
  const completed = await request(path+'/complete',{ actualMinutes:42 },'PATCH');
  assert.equal(completed.data.actualMinutes,42);
  assert.equal(completed.data.plannedMinutes,75);
  assert(completed.data.completedAt);
  const recurring = await request(base,{ ...input,title:'Daily reading',startAt:'2030-03-10T17:00:00Z',taskId:task.id,recurrence:{frequency:'daily',count:3} });
  assert.equal(recurring.status,201);
  const related = await request(base+'?taskId='+task.id+'&from=2030-03-10&to=2030-03-15&limit=2');
  assert.equal(related.data.total,3);
  assert.equal(related.data.items.length,2);
  const moved = await request(base+'/'+related.data.items[1].id+'/reschedule',{startAt:'2030-03-11T20:00:00Z',plannedMinutes:30},'PATCH');
  assert.equal(moved.data.isException,1);
  const weekly = await request(base,{ ...input,title:'Weekly reading',startAt:'2030-03-18T17:00:00Z',recurrence:{frequency:'weekly',weekdays:[1,3],until:'2030-03-25'} });
  assert.equal(weekly.status,201);
  assert.equal((await request(base+'?from=2030-03-18&to=2030-03-25')).data.total,3);
  const recurrenceConflict = await request(base,{ ...input,startAt:'2030-03-17T17:00:00Z',recurrence:{frequency:'daily',count:2} });
  assert.equal(recurrenceConflict.status,409);
  const editedSeries = await request(base+'/'+recurring.data.id+'/series',{title:'Updated series',recurrence:{frequency:'daily',count:4}},'PATCH');
  assert.equal(editedSeries.status,200);
  assert.equal((await request(base+'/'+moved.data.id)).data.plannedMinutes,30);
  assert.equal((await request(base+'/'+weekly.data.id,{},'DELETE')).data.status,'cancelled');
  assert.equal((await request(base+'/'+weekly.data.id+'/series',{recurrence:null},'PATCH')).status,200);
  const availability = await request('/availability',{weekday:1,startTime:'08:00',endTime:'10:00'});
  assert.equal(availability.status,201);
  const ap = '/availability/'+availability.data.id;
  assert.equal((await request(ap,{endTime:'07:00'},'PATCH')).status,400);
  assert.equal((await request(ap,{endTime:'11:00'},'PATCH',secondCookie)).status,404);
  assert.equal((await request(ap,{endTime:'11:00'},'PATCH')).data.endTime,'11:00');
  assert.equal((await request('/availability')).data.total,1);
  await request('/auth/logout',{});
  assert.equal((await request(path)).status,401);
  const restored = await call('/auth/login',{body:{email,password:recovered}});
  assert.equal((await request(path,undefined,'GET',restored.cookie)).data.actualMinutes,42);
  assert.equal((await request(ap,{},'DELETE',restored.cookie)).status,200);
});

test('recurrence keeps local wall time through DST and handles spring-forward gaps', async () => {
  const { expandSeries } = await import('../../shared/study-recurrence.js');
  const start = new Date('2026-03-07T14:00:00Z');
  const end = new Date('2026-03-07T15:00:00Z');
  const slots = expandSeries(start,end,'America/New_York',{frequency:'daily',count:3});
  assert.deepEqual(slots.map(slot => slot.start.toISOString()),['2026-03-07T14:00:00.000Z','2026-03-08T13:00:00.000Z','2026-03-09T13:00:00.000Z']);
  const gap = expandSeries(new Date('2026-03-07T07:30:00Z'),new Date('2026-03-07T08:00:00Z'),'America/New_York',{frequency:'daily',count:2});
  assert.equal(gap[1].start.toISOString(),'2026-03-08T07:00:00.000Z');
});


test('calendar and dashboard aggregate owned records across local boundaries', { skip: !pool }, async () => {
  const { localStamp } = await import('../../shared/task-time.js');
  const calendarServer = await start({ pool });
  const { cookie: session } = await call('/auth/login', { at: calendarServer, body: { email, password: recovered } });
  const request = (path, body, method, owner = session) => call(path, { at: calendarServer, session: owner, body, method });
  assert.equal((await call('/calendar/events?from=2030-03-05&to=2030-03-05')).status, 401);
  assert.equal((await request('/calendar/events?from=2030-02-30&to=2030-03-05')).status, 400);
  assert.equal((await request('/calendar/events?from=2030-01-01&to=2030-06-05')).status, 400);
  const calendar = (await request('/calendar/events?from=2030-03-10&to=2030-03-13&type=study')).data.items;
  assert.equal(calendar.length, 4);
  assert.equal(new Set(calendar.map(item => item.id)).size, 4);
  assert(calendar.some(item => item.startAt === '2030-03-11T20:00:00.000Z'));
  assert.equal((await request('/calendar/events?from=2030-03-18&to=2030-03-25&type=study')).data.items.length, 0);
  assert.equal((await request('/calendar/events?from=2030-03-10&to=2030-03-13', undefined, 'GET', secondCookie)).data.items.length, 0);
  await request('/me', { timezone: 'Asia/Kabul' }, 'PATCH');
  const today = localStamp(new Date(), 'Asia/Kabul').slice(0, 10);
  const term = await request('/terms', { name: 'Calendar term', startDate: today, endDate: today });
  const course = await request('/courses', { title: 'Calendar course', code: 'CAL', termId: term.data.id });
  const weekday = new Date(today + 'T00:00Z').getUTCDay() || 7;
  await request('/courses/' + course.data.id + '/schedules', { weekday, startTime: '01:00', endTime: '02:00' });
  await request('/tasks', { title: 'All day boundary', category: 'exam', dueDate: today });
  const completed = await request('/tasks', { title: 'Done', category: 'exam', status: 'completed' });
  assert.equal(completed.status, 201);
  const events = (await request('/calendar/events?from=' + today + '&to=' + today)).data.items;
  assert.equal(events.find(item => item.type === 'course').startAt, new Date(Date.parse(today + 'T01:00Z') - 270 * 60000).toISOString());
  assert.equal(events.find(item => item.title === 'All day boundary').date, today);
  assert(events.some(item => item.type === 'term'));
  const sessionRow = await request('/study-sessions', { title: 'Today study', startAt: new Date(Date.parse(today + 'T14:00Z') - 270 * 60000).toISOString(), plannedMinutes: 60 });
  const studyId = sessionRow.data.id;
  await request('/study-sessions/' + studyId + '/complete', { actualMinutes: 37 }, 'PATCH');
  const { data: summary } = await request('/dashboard/summary');
  assert.equal(summary.activeTerm.id, term.data.id);
  assert(summary.activeCourses >= 1);
  assert.equal(summary.today, today);
  assert(summary.pending >= 1 && summary.overdue >= 1 && summary.upcoming >= 1);
  assert.equal(summary.taskCompletion, Math.round(summary.completed / (summary.completed + summary.pending) * 100));
  assert(summary.todaySessions.some(item => item.id === studyId));
  assert.equal(summary.actualMinutes, 37);
  assert.equal(summary.plannedMinutes, 60);
  assert.equal(summary.weeklyProgress.length, 7);
  assert.equal((await request('/dashboard/summary', undefined, 'GET', secondCookie)).data.actualMinutes, 0);
});



test('reminders deliver once, defer quiet hours, retry SMTP and protect the inbox', { skip: !pool }, async () => {
  const { processReminders, createReminderMailer, quietUntil } = await import('../src/services/reminders.js');
  const at = await start({ pool });
  const { cookie: session } = await call('/auth/login', { at, body: { email, password: recovered } });
  const request = (path, body, method, owner = session) => call(path, { at, session: owner, body, method });
  const now = new Date('2031-03-17T18:00:00Z');
  assert.equal(quietUntil(now,{ timezone:'Asia/Kabul',quietStart:'22:00',quietEnd:'06:00' }).toISOString(),'2031-03-18T01:30:00.000Z');
  await request('/preferences',{quietStart:'22:00',quietEnd:'06:00',emailNotifications:true,inAppNotifications:true},'PATCH');
  const task = await request('/tasks',{title:'<Read notes>',category:'reading',dueAt:'2031-03-17T18:30:00Z'});
  const rule = await request('/reminders',{taskId:task.data.id,channel:'in_app',offsetMinutes:30});
  assert.equal(rule.status,201);
  assert.equal((await request('/reminders',{taskId:task.data.id,channel:'email',offsetMinutes:-1})).status,400);
  assert.equal((await request('/reminders',{taskId:task.data.id,channel:'email',offsetMinutes:30},'POST',secondCookie)).status,404);
  const mail = await request('/reminders',{taskId:task.data.id,channel:'email',offsetMinutes:30});
  assert.equal(mail.status,201);
  let attempts=0;
  let message;
  const send=createReminderMailer({SMTP_URL:'smtp://localhost',SMTP_FROM:'study@example.test'},{
    async sendMail(payload) {
      attempts++;
      if(attempts===1) throw Object.assign(new Error('temporary error'),{responseCode:451});
      message=payload;
      return {accepted:[payload.to]};
    },
  });
  await processReminders(pool,send,{now});
  assert.equal((await request('/notifications/unread-count')).data.count,0);
  const resume = new Date('2031-03-18T01:30:00Z');
  await Promise.all([processReminders(pool,send,{now:resume}),processReminders(pool,send,{now:resume})]);
  assert.equal(attempts,1);
  await processReminders(pool,send,{now:new Date(+resume+60000)});
  await processReminders(pool,send,{now:new Date(+resume+120000)});
  assert.equal(attempts,2);
  assert.match(message.html,/&lt;Read notes&gt;/);
  assert.match(message.text, /<Read notes>/);
  // A previous worker may have stopped after handing the email to SMTP.
  await pool.execute("UPDATE notifications SET status='queued' WHERE user_id=? AND reminder_id=? AND channel='email'",[user.id,mail.data.id]);
  await processReminders(pool,send,{now:new Date(+resume+180000)});
  const [[recoveredDelivery]]=await pool.execute('SELECT status,error_code FROM notifications WHERE user_id=? AND reminder_id=?',[user.id,mail.data.id]);
  assert.equal(recoveredDelivery.status,'failed');
  assert.equal(recoveredDelivery.error_code,'delivery_unknown');
  assert.equal(attempts,2);
  const inbox=await request('/notifications?read=unread');
  assert.equal(inbox.data.total,1);
  const item='/notifications/'+inbox.data.items[0].id;
  assert.equal((await request(item+'/read',{},'PATCH',secondCookie)).status,404);
  assert.equal((await request(item+'/read',{},'PATCH')).status,200);
  assert.equal((await request('/notifications/unread-count')).data.count,0);
  const future=await request('/study-sessions',{title:'Recurring reminder',startAt:'2031-03-18T03:00:00Z',plannedMinutes:30,recurrence:{frequency:'daily',count:2}});
  const reminder=await request('/reminders',{sessionId:future.data.id,channel:'in_app',offsetMinutes:15});
  assert.equal(reminder.status,201);
  assert.equal((await request('/reminders/'+reminder.data.id,{offsetMinutes:30},'PATCH')).data.offsetMinutes,30);
  const occurrences=(await request('/study-sessions?from=2031-03-18&to=2031-03-19')).data.items;
  await request('/study-sessions/'+occurrences[0].id+'/reschedule',{startAt:'2031-03-18T04:00:00Z',plannedMinutes:30},'PATCH');
  await request('/study-sessions/'+occurrences[1].id,{},'DELETE');
  await processReminders(pool,send,{now:new Date('2031-03-18T03:00:00Z')});
  assert.equal((await request('/notifications/unread-count')).data.count,0);
  await processReminders(pool,send,{now:new Date('2031-03-18T03:30:00Z')});
  await processReminders(pool,send,{now:new Date('2031-03-19T03:30:00Z')});
  assert.equal((await request('/notifications/unread-count')).data.count,1);
  await request('/notifications/read-all',{},'PATCH');
  assert.equal((await request('/notifications/unread-count')).data.count,0);
  assert.equal((await request('/reminders/'+rule.data.id,{},'DELETE')).status,200);
  assert.equal((await request('/notifications')).data.total,2);
  assert.equal((await request(item,{},'DELETE')).status,200);
  assert.equal((await request('/notifications')).data.total,1);
});

test('analytics and exports use owned MySQL data and preserve local dates and CSV safety', { skip: !pool }, async () => {
  const at=await start({pool});
  const emailA=randomUUID()+'@example.test';
  const emailB=randomUUID()+'@example.test';
  const password='Export test password';
  const make=email=>call('/auth/register',{at,body:{email,password,displayName:'Progress student'}});
  const student=await make(emailA);
  const other=await make(emailB);
  const action=(path,body,method,session=student.cookie)=>call(path,{at,body,method,session});
  try {
    assert.equal((await call('/analytics/overview',{at})).status,401);
    assert.equal((await fetch(at+'/api/v1/export/json')).status,401);
    const empty=await action('/analytics/overview');
    assert.equal(empty.data.study.planned,0);
    assert.equal(empty.data.tasks.completion,0);
    await action('/me',{timezone:'Asia/Kabul'},'PATCH');
    const term=await action('/terms',{name:'Analytics term',startDate:'2030-01-01',endDate:'2031-01-01'});
    const course=await action('/courses',{title:'Analytics course',code:'ANA',termId:term.data.id});
    assert.equal((await action('/analytics/overview?courseId='+course.data.id,undefined,'GET',other.cookie)).status,404);
    const session=await action('/study-sessions',{title:'Progress session',courseId:course.data.id,startAt:'2030-01-31T20:00:00Z',plannedMinutes:60,recurrence:{frequency:'daily',count:3}});
    assert.equal(session.status,201);
    await action('/study-sessions/'+session.data.id+'/complete',{actualMinutes:40},'PATCH');
    const third=(await action('/study-sessions?from=2030-02-03&to=2030-02-03')).data.items[0];
    await action('/study-sessions/'+third.id,{},'DELETE');
    const task=await action('/tasks',{title:'=HYPERLINK("example")',description:'Quoted "text", with\nline break',category:'reading',dueDate:'2030-02-01',courseId:course.data.id});
    await action('/tasks',{title:'Done in range',category:'reading',dueDate:'2030-02-02',courseId:course.data.id,status:'completed'});
    await action('/tasks',{title:'Private other student',category:'reading',dueDate:'2030-02-02'},'POST',other.cookie);
    const range='from=2030-02-01&to=2030-02-03&courseId='+course.data.id;
    const result=(await action('/analytics/overview?group=day&'+range)).data;
    assert.deepEqual(result.series.map(row=>[row.planned,row.actual]),[[60,40],[60,0],[0,0]]);
    assert.equal(result.study.cancelledSessions,1);
    assert.equal(result.tasks.completion,50);
    assert.equal(result.tasks.pending,1);
    assert.equal(result.tasks.overdue,0);
    assert.equal((await action('/analytics/study-time?group=week&'+range)).data.series[0].planned,120);
    assert.equal((await action('/analytics/tasks?group=month&'+range)).data.series[0].date,'2030-02-01');
    assert.equal((await action('/analytics/courses?'+range)).data.courses[0].tasks,2);
    assert.equal((await action('/analytics/overview?from=2030-02-30')).status,400);
    await action('/tasks',{title:'Past deadline',category:'reading',dueDate:'2020-01-01'});
    assert.equal((await action('/analytics/tasks?from=2020-01-01&to=2020-01-01')).data.tasks.overdue,1);
    const download=format=>fetch(at+'/api/v1/export/'+format,{headers:{cookie:student.cookie}});
    const json=await download('json');
    assert.match(json.headers.get('content-disposition'),/study-planner-data.json/);
    const document=await json.json();
    assert.equal(document.version,1);
    assert.equal(document.records.find(row=>row.category==='tasks'&&row.record.id===task.data.id).record.due_date,'2030-02-01');
    assert(document.records.some(row=>row.category==='preferences'));
    assert.doesNotMatch(JSON.stringify(document),/password_hash|token_hash|Private other student/);
    const csv=await download('csv');
    assert.match(csv.headers.get('content-type'),/text\/csv/);
    const content=await csv.text();
    assert.match(content,/category,record_id,field,value/);
    assert.match(content,/"'=HYPERLINK\(""example""\)"/);
    assert.match(content,/"Quoted ""text"", with\nline break"/);
    assert.doesNotMatch(content,/password_hash|Private other student/);
  } finally {
    const ids=[student.data.id,other.data.id];
    for(const table of ['study_sessions','tasks','courses','audit_logs']) await pool.execute('DELETE FROM '+table+' WHERE user_id IN (?,?)',ids);
    await pool.execute('DELETE FROM users WHERE id IN (?,?)',ids);
  }
});

