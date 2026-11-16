const formatters = new Map();

export function localStamp(instant, timezone) {
  let formatter = formatters.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    });
    if (formatters.size >= 64) formatters.delete(formatters.keys().next().value);
    formatters.set(timezone, formatter);
  }
  const parts = formatter.formatToParts(instant);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return values.year + '-' + values.month + '-' + values.day + 'T' + values.hour + ':' + values.minute;
}

export function localInstant(value, timezone) {
  const nominal = Date.parse(value + 'Z');
  if (!Number.isFinite(nominal)) return null;
  const candidates = new Set();
  for (const hours of [-36, 0, 36]) {
    const sample = nominal + hours * 3600000;
    const offset = Date.parse(localStamp(new Date(sample), timezone) + 'Z') - sample;
    const candidate = nominal - offset;
    if (localStamp(new Date(candidate), timezone) === value) candidates.add(candidate);
  }
  return candidates.size ? new Date(Math.min(...candidates)) : null;
}

export function nextDate(value) {
  return new Date(Date.parse(value + 'T00:00Z') + 86400000).toISOString().slice(0, 10);
}

export function dayBoundary(value, timezone) {
  const start = Date.parse(value + 'T00:00Z');
  let low = start - 48 * 3600000;
  let high = start + 48 * 3600000;
  while (high - low > 1) {
    const mid = Math.floor((low + high) / 2);
    if (localStamp(new Date(mid), timezone).slice(0, 10) < value) low = mid;
    else high = mid;
  }
  return new Date(high);
}

