export const publicFields = 'id, email, display_name AS displayName, timezone, locale';

export async function one(db, sql, args) {
  const [rows] = await db.execute(sql, args);
  return rows[0];
}

export function profile(db, id) {
  return one(db, 'SELECT ' + publicFields + ' FROM users WHERE id = ?', [id]);
}

export function audit(db, id, action, outcome = 'success') {
  return db.execute('INSERT INTO audit_logs (user_id, entity_id, action, outcome) VALUES (?, ?, ?, ?)', [id, id, action, outcome]);
}

export async function preferences(db, id) {
  const row = await one(db, `SELECT reminder_minutes AS reminderMinutes, email_notifications AS emailNotifications,
    in_app_notifications AS inAppNotifications, TIME_FORMAT(quiet_start, '%H:%i') AS quietStart,
    TIME_FORMAT(quiet_end, '%H:%i') AS quietEnd FROM user_preferences WHERE user_id = ?`, [id]);
  return { ...row, emailNotifications: Boolean(row.emailNotifications), inAppNotifications: Boolean(row.inAppNotifications) };
}
