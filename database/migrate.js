import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createDatabase } from '../server/src/config/database.js';

export async function migrate(pool) {
  const db = await pool.getConnection();
  try {
    const [[row]] = await db.query("SELECT GET_LOCK(SHA2(CONCAT(DATABASE(), ':study-planner:migrations'), 256), 30) AS acquired");
    if (row.acquired !== 1) throw new Error('Migration lock unavailable');
    const [[server]] = await db.query('SELECT VERSION() AS version');
    const tidb = /tidb/i.test(server.version);
    await db.query('CREATE TABLE IF NOT EXISTS schema_migrations (version VARCHAR(150) PRIMARY KEY, checksum CHAR(64) NOT NULL, applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB');
    const folder = new URL('./migrations/', import.meta.url);
    const names = (await readdir(folder)).filter(name => /^\d+_[a-z_]+\.sql$/.test(name)).sort();
    if (!names.length) throw new Error('Migration SQL files missing from deployment');
    for (const name of names) {
      const sql = await readFile(new URL(name, folder), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const [[existing]] = await db.execute('SELECT checksum FROM schema_migrations WHERE version = ?', [name]);
      if (existing) {
        if (existing.checksum !== checksum) throw new Error('Applied migration has changed: ' + name);
        continue;
      }
      // TiDB cannot ADD a STORED generated column. Keep source checksums and
      // the calculation intact; use its supported virtual storage only there.
      const executable = tidb && name === '004_study_sessions.sql'
        ? sql.replace('ADD COLUMN planned_minutes INT UNSIGNED GENERATED ALWAYS AS (CEIL(TIMESTAMPDIFF(MICROSECOND,start_at,end_at)/60000000)) STORED',
          'ADD COLUMN planned_minutes INT UNSIGNED GENERATED ALWAYS AS (CEIL(TIMESTAMPDIFF(MICROSECOND,start_at,end_at)/60000000)) VIRTUAL')
        : sql;
      for (const statement of executable.split(/;\s*/).map(part => part.trim()).filter(Boolean)) await db.query(statement);
      await db.execute('INSERT INTO schema_migrations (version, checksum) VALUES (?, ?)', [name, checksum]);
    }
  } finally {
    try {
      await db.query("DO RELEASE_LOCK(SHA2(CONCAT(DATABASE(), ':study-planner:migrations'), 256))");
    } finally {
      db.release();
    }
  }
}


export async function verifyMigrations(pool) {
  const [rows] = await pool.query('SELECT version, checksum FROM schema_migrations');
  const installed = new Map(rows.map(row => [row.version, row.checksum]));
  const folder = new URL('./migrations/', import.meta.url);
  const names = (await readdir(folder)).filter(name => /^\d+_[a-z_]+\.sql$/.test(name));
  if (!names.length) throw new Error('Migration SQL files missing from deployment');
  for (const name of names) {
    const checksum = createHash('sha256').update(await readFile(new URL(name, folder), 'utf8')).digest('hex');
    if (installed.get(name) !== checksum) throw new Error('Migration missing or changed: ' + name);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const pool = createDatabase();
  try {
    if (!pool) throw new Error('Set DB_NAME and DB_USER in .env');
    await migrate(pool);
    console.info('Database migrations applied.');
  } catch (error) {
    console.error('Migration failed: ' + (error.code || error.message));
    process.exitCode = 1;
  } finally {
    await pool?.end();
  }
}

