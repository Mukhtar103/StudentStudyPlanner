import { localInstant, localStamp, nextDate } from './task-time.js';

export function expandSeries(startAt, endAt, timezone, rule) {
  const local = localStamp(startAt, timezone);
  const startDate = local.slice(0, 10);
  const duration = endAt - startAt;
  const dates = [];
  let count = 0;
  for (let date = startDate, day = 0; day < 366; date = nextDate(date), day++) {
    if (rule.until && date > rule.until) break;
    if (rule.frequency === 'weekly' && !rule.weekdays.includes((new Date(date + 'T00:00Z').getUTCDay() || 7))) continue;
    let start = day === 0 ? startAt : localInstant(date + local.slice(10), timezone);
    // Move nonexistent local times forward to the first valid minute on the same date.
    if (!start) {
      const nominal = Date.parse(date + local.slice(10) + 'Z');
      for (let minute = 1; minute <= 180 && !start; minute++) {
        const shifted = new Date(nominal + minute * 60000).toISOString().slice(0, 16);
        if (shifted.slice(0, 10) !== date) break;
        start = localInstant(shifted, timezone);
      }
      if (!start) continue;
    }
    dates.push({ date, start, end: new Date(+start + duration) });
    count++;
    if (count === rule.count) break;
  }
  return dates;
}
