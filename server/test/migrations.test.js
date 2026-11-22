import { test } from 'node:test';
import assert from 'node:assert/strict';
import { migrate, verifyMigrations } from '../../database/migrate.js';

for (const version of ['8.4.0', '8.0.11-TiDB-v8.5.3']) {
  test('migration storage compatibility and checksum verification on ' + version, async () => {
    const installed = new Map();
    const statements = [];
    let releases = 0;
    const db = {
      async query(sql) {
        if (version.includes('TiDB') && /^ALTER TABLE (study_sessions|notifications)\s/.test(sql) && sql.includes('ADD COLUMN') && /ADD (UNIQUE|FOREIGN KEY|INDEX)/.test(sql)) {
          throw Object.assign(new Error('Keys cannot refer to columns added in the same statement'), {code:'ER_KEY_COLUMN_DOES_NOT_EXITS'});
        }
        statements.push(sql);
        if (sql.includes('GET_LOCK')) return [[{acquired: 1}]];
        if (sql === 'SELECT VERSION() AS version') return [[{version}]];
        return [[]];
      },
      async execute(sql, params) {
        const [name, checksum] = params;
        if (sql.startsWith('SELECT')) return [[...(installed.has(name) ? [{checksum: installed.get(name)}] : [])]];
        installed.set(name, checksum);
        return [[]];
      },
      release() { releases++; },
    };
    const pool = {
      async getConnection() { return db; },
      async query() { return [[...installed].map(([version, checksum]) => ({version, checksum}))]; },
    };
    await migrate(pool);
    const timing = statements.find(sql => sql.startsWith('ALTER TABLE study_sessions'));
    assert.ok(timing.includes('CEIL(TIMESTAMPDIFF(MICROSECOND,start_at,end_at)/60000000)'));
    assert.ok(timing.includes(version.includes('TiDB') ? ') VIRTUAL,' : ') STORED,'));
    if (version.includes('TiDB')) {
      for (const [table, column, key] of [
        ['study_sessions','series_id','ADD UNIQUE'],
        ['notifications','channel','ADD INDEX notification_inbox'],
      ]) {
        const columnsAt = statements.findIndex(sql => sql.startsWith('ALTER TABLE ' + table) && sql.includes('ADD COLUMN ' + column));
        const keysAt = statements.findIndex(sql => sql.startsWith('ALTER TABLE ' + table) && sql.includes(key));
        assert.ok(columnsAt >= 0 && keysAt > columnsAt);
      }
    }
    assert.equal(installed.size, 5);
    await verifyMigrations(pool);
    statements.length = 0;
    await migrate(pool);
    assert.equal(statements.some(sql => sql.startsWith('ALTER TABLE')), false);
    installed.set('004_study_sessions.sql', 'changed');
    await assert.rejects(migrate(pool), /Applied migration has changed/);
    assert.equal(releases, 3);
  });
}
