import { transaction } from '../config/database.js';
import { audit, preferences, profile } from '../repositories/accounts.js';
import { ApiError, displayNameValue } from '../services/auth.js';

const invalid = message => new ApiError(400, 'VALIDATION_ERROR', message);
const time = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export function requireFields(body, allowed) {
  if (!body || Array.isArray(body) || typeof body !== 'object' ||
      !Object.keys(body).length || Object.keys(body).some(key => !allowed.includes(key))) {
    throw invalid('Check the submitted fields.');
  }
  return body;
}

export function makeAccount(pool) {
  return {
    async updateProfile(id, patch) {
      requireFields(patch, ['displayName', 'timezone', 'locale']);
      const displayName = 'displayName' in patch ? displayNameValue(patch.displayName) : null;
      let { timezone = null, locale = null } = patch;
      if ('timezone' in patch) {
        if (typeof timezone !== 'string' || timezone.length > 80 || !/^[a-z][a-z0-9_+/-]*$/i.test(timezone)) throw invalid('Enter an IANA time zone, such as Asia/Kabul.');
        try { timezone = Intl.DateTimeFormat('en', { timeZone: timezone }).resolvedOptions().timeZone; }
        catch { throw invalid('Enter an IANA time zone, such as Asia/Kabul.'); }
      }
      if ('locale' in patch) {
        if (typeof locale !== 'string' || !locale || locale.length > 40) throw invalid('Enter a locale, such as en-US.');
        try { [locale] = Intl.getCanonicalLocales(locale); }
        catch { throw invalid('Enter a locale, such as en-US.'); }
      }
      return transaction(pool, async db => {
        await db.execute('UPDATE users SET display_name = COALESCE(?, display_name), timezone = COALESCE(?, timezone), locale = COALESCE(?, locale) WHERE id = ?', [displayName, timezone, locale, id]);
        await audit(db, id, 'profile_updated');
        return profile(db, id);
      });
    },
    async updatePreferences(id, patch) {
      requireFields(patch, ['reminderMinutes', 'emailNotifications', 'inAppNotifications', 'quietStart', 'quietEnd']);
      return transaction(pool, async db => {
        await db.execute('SELECT user_id FROM user_preferences WHERE user_id = ? FOR UPDATE', [id]);
        const next = { ...await preferences(db, id), ...patch };
        const { reminderMinutes, emailNotifications, inAppNotifications, quietStart, quietEnd } = next;
        if (!Number.isInteger(reminderMinutes) || reminderMinutes < 0 || reminderMinutes > 10080) throw invalid('Enter a reminder offset from 0 to 10,080 minutes.');
        if (typeof emailNotifications !== 'boolean' || typeof inAppNotifications !== 'boolean') throw invalid('Choose valid notification preferences.');
        if (!(quietStart === null && quietEnd === null) &&
            !(typeof quietStart === 'string' && typeof quietEnd === 'string' && time.test(quietStart) && time.test(quietEnd) && quietStart !== quietEnd)) {
          throw invalid('Enter two different quiet hours, or leave both blank.');
        }
        await db.execute('UPDATE user_preferences SET reminder_minutes=?, email_notifications=?, in_app_notifications=?, quiet_start=?, quiet_end=? WHERE user_id=?', [reminderMinutes, emailNotifications, inAppNotifications, quietStart, quietEnd, id]);
        await audit(db, id, 'preferences_updated');
        return preferences(db, id);
      });
    },
  };
}
