import { access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createReminderMailer, runReminderWorker } from './services/reminders.js';
import { createApp } from './app.js';
import { readConfig } from './config/env.js';
import { createDatabase } from './config/database.js';
import { createResetMailer } from './services/auth.js';
import { verifyMigrations } from '../../database/migrate.js';

let pool;
try {
  const config = readConfig();
  pool = createDatabase();
  const webRoot = config.secure ? fileURLToPath(new URL('../../client/dist/',import.meta.url)) : null;
  if (webRoot) {
    try { await access(join(webRoot,'index.html')); }
    catch { throw new Error('Frontend build missing. Run npm run build first.'); }
    try { await verifyMigrations(pool); }
    catch(error) { throw new Error('Database readiness check failed ('+(error.code || error.message)+'). Verify the target and run npm run db:migrate.'); }
  }
  const sendReset = createResetMailer();
  const sendReminder = createReminderMailer();
  const server = createApp({...config,pool,webRoot,sendReset}).listen(config.port,config.host);
  server.requestTimeout = 30000;
  server.headersTimeout = 15000;
  await new Promise((resolve,reject)=>server.once('listening',resolve).once('error',reject));
  console.info(JSON.stringify({event:'server_ready',host:config.host,port:config.port,production:config.secure,databaseConfigured:Boolean(pool),emailConfigured:Boolean(sendReminder)}));
  const controller = new AbortController();
  const worker = pool ? runReminderWorker(pool,sendReminder,controller.signal) : Promise.resolve();
  let stopping = false;
  async function stop() {
    if (stopping) return;
    stopping = true;
    controller.abort();
    const deadline = setTimeout(()=>process.exit(1),35000).unref();
    try {
      await Promise.all([worker,new Promise(resolve=>server.close(resolve))]);
      await pool?.end();
      console.info(JSON.stringify({event:'server_stopped'}));
    } finally { clearTimeout(deadline); }
  }
  for (const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>{void stop().catch(()=>{process.exitCode=1;});});
} catch(error) {
  console.error(JSON.stringify({event:'startup_failed',message:error.code || error.message}));
  await pool?.end();
  process.exitCode=1;
}
