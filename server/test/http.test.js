import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';

let server;
let base;
before(async () => {
  server = createApp({ origins: ['http://localhost:5173'] }).listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => server.once('listening', resolve).once('error', reject));
  base = 'http://127.0.0.1:' + server.address().port;
});
after(() => server?.close());

test('health includes a matching request ID and security headers', async () => {
  const res = await fetch(base + '/api/v1/health');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.success, true);
  assert.equal(body.data.status, 'ok');
  assert.equal(body.requestId, res.headers.get('x-request-id'));
  assert.match(body.requestId, /^[a-f0-9-]{36}$/);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
});

test('CORS only grants configured origins', async () => {
  for (const origin of ['http://localhost:5173', 'https://unlisted.example']) {
    const res = await fetch(base + '/api/v1/health', { headers: { origin } });
    assert.equal(res.headers.get('access-control-allow-origin'), origin.includes('localhost') ? origin : null);
  }
});

test('unknown routes and malformed JSON return safe errors', async () => {
  const missing = await fetch(base + '/api/v1/missing');
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).error.code, 'NOT_FOUND');
  const invalid = await fetch(base + '/api/v1/missing', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' });
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).error.code, 'INVALID_JSON');
});

test('oversized bodies return a safe 413 JSON response', async () => {
  const response = await fetch(base + '/api/v1/missing', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ value: 'x'.repeat(70 * 1024) }),
  });
  assert.equal(response.status, 413);
  const body = await response.json();
  assert.equal(body.error.code, 'BODY_TOO_LARGE');
  assert.equal(body.requestId, response.headers.get('x-request-id'));
});

test('temporary database access failures return a safe 503', async () => {
  const pool = { execute: async () => {
    throw Object.assign(new Error('private database diagnostics'), { code: 'ER_DBACCESS_DENIED_ERROR' });
  } };
  const isolated = createApp({ pool }).listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => isolated.once('listening', resolve).once('error', reject));
  try {
    const response = await fetch('http://127.0.0.1:' + isolated.address().port + '/api/v1/auth/session', {
      headers: { cookie: 'ssp_session=' + 'a'.repeat(64) },
    });
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.error.code, 'DATABASE_UNAVAILABLE');
    assert.doesNotMatch(JSON.stringify(body), /private database diagnostics/);
  } finally {
    await new Promise(resolve => isolated.close(resolve));
  }
});

test('production requires HTTPS origins, a local proxy, and database configuration', async () => {
  const { readConfig } = await import('../src/config/env.js');
  const env = {NODE_ENV:'production',APP_URL:'https://planner.example.test',DB_HOST:'127.0.0.1',DB_NAME:'test',DB_USER:'test',DB_PASSWORD:'test-placeholder',TRUST_PROXY_HOPS:'1'};
  assert.deepEqual(readConfig(env).origins,['https://planner.example.test']);
  assert.throws(()=>readConfig({...env,APP_URL:'http://planner.example.test'}),/HTTPS origins/);
  assert.throws(()=>readConfig({...env,DB_PASSWORD:''}),/DB_PASSWORD/);
  assert.throws(()=>readConfig({...env,DB_HOST:'mysql.example.test'}),/DB_TLS/);
  assert.throws(()=>readConfig({...env,API_HOST:'0.0.0.0'}),/loopback/);
});

test('production SPA routes refresh and API and asset misses stay 404', async () => {
  const { mkdtemp, mkdir, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const root = await mkdtemp(join(tmpdir(),'planner-web-'));
  await mkdir(join(root,'assets'));
  await writeFile(join(root,'index.html'),'<main>Production SPA</main>');
  await writeFile(join(root,'assets','fixture.js'),'export {};');
  const app = createApp({secure:true,trustProxy:1,webRoot:root}).listen(0,'127.0.0.1');
  await new Promise((resolve,reject)=>app.once('listening',resolve).once('error',reject));
  try {
    const url = 'http://127.0.0.1:'+app.address().port;
    const headers = {'x-forwarded-proto':'https',accept:'text/html'};
    assert.equal((await fetch(url+'/calendar')).status,426);
    const page = await fetch(url+'/calendar',{headers});
    assert.equal(page.status,200);
    assert.match(await page.text(),/Production SPA/);
    assert.match(page.headers.get('strict-transport-security'),/max-age=/);
    assert.match(page.headers.get('content-security-policy'),/script-src 'self'/);
    assert.equal(page.headers.get('cache-control'),'no-cache');
    const asset=await fetch(url+'/assets/fixture.js',{headers});
    assert.equal(asset.status,200);
    assert.match(asset.headers.get('cache-control'),/immutable/);
    assert.equal((await fetch(url+'/api/v1/missing',{headers})).status,404);
    assert.equal((await fetch(url+'/assets/removed.js',{headers})).status,404);
  } finally {
    await new Promise(resolve=>app.close(resolve));
    await rm(join(root,'assets','fixture.js'));
    await rm(join(root,'index.html'));
    const { rmdir } = await import('node:fs/promises');
    await rmdir(join(root,'assets'));
    await rmdir(root);
  }
});

test('reminder worker aborts promptly and releases its database connection', async () => {
  const { runReminderWorker } = await import('../src/services/reminders.js');
  const controller = new AbortController();
  let releases = 0;
  const pool = { getConnection: async () => ({
    query: async () => [[{acquired:0}]],
    release: () => { releases++; controller.abort(); },
  }) };
  await runReminderWorker(pool,null,controller.signal);
  assert.equal(releases,1);
});
