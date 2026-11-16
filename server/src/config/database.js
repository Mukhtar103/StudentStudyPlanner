import mysql from 'mysql2/promise';

export function createDatabase(env = process.env) {
  if (!env.DB_NAME || !env.DB_USER) return null;
  return mysql.createPool({
    host: env.DB_HOST || '127.0.0.1',
    port: Number(env.DB_PORT || 3306),
    database: env.DB_NAME,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    timezone: 'Z',
    charset: 'utf8mb4',
    connectionLimit: 10,
    queueLimit: 50,
    connectTimeout: 5000,
    ssl: env.DB_TLS === 'true' ? { rejectUnauthorized: true } : undefined,
  });
}

export async function transaction(pool, run) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await run(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
