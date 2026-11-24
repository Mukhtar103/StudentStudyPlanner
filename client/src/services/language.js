import { useSyncExternalStore } from 'react';
import { dari } from './translations.js';

const key = 'ssp-language';
let language = 'en';
try { language = localStorage.getItem(key) === 'fa-AF' ? 'fa-AF' : 'en'; } catch { /* Storage can be unavailable in private browsers. */ }
const listeners = new Set();
export const isDari = locale => /^fa(?:-|$)/i.test(locale || '');
export const languageLocale = value => value === 'fa-AF' ? 'fa-AF-u-ca-gregory' : 'en-US';
function apply() {
  document.documentElement.lang = language === 'fa-AF' ? 'fa-AF' : 'en';
  document.documentElement.dir = language === 'fa-AF' ? 'rtl' : 'ltr';
  document.title = language === 'fa-AF' ? 'برنامه‌ریز درسی محصل' : 'Student Study Planner';
}
apply();
export function setLanguage(value) {
  language = value === 'fa-AF' ? 'fa-AF' : 'en';
  try { localStorage.setItem(key, language); } catch { /* Keep the current session usable. */ }
  apply();
  listeners.forEach(listener => listener());
}
function subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); }
export function useLanguage() {
  return useSyncExternalStore(subscribe, () => language);
}
export const dariDigits = value => String(value).replace(/[0-9٠-٩]/g,
  digit => '۰۱۲۳۴۵۶۷۸۹'['٠١٢٣٤٥٦٧٨٩'.includes(digit) ? '٠١٢٣٤٥٦٧٨٩'.indexOf(digit) : Number(digit)]);
export function translate(value, locale = language) {
  if (locale !== 'fa-AF') return value;
  if (typeof value === 'number') return dariDigits(value);
  if (typeof value !== 'string') return value;
  if (Object.hasOwn(dari, value)) return dariDigits(dari[value]);
  const trimmed = value.trim();
  if (Object.hasOwn(dari, trimmed)) return dariDigits(value.replace(trimmed, dari[trimmed]));
  const metric = trimmed.match(/^([\d۰-۹.,٬٫]+) (min|h|overdue|days with recorded study|open sessions|cancelled)$/);
  if (metric) return dariDigits(value.replace(trimmed, metric[1] + ' ' + (dari[metric[2]] || metric[2])));
  return dariDigits(value);
}
export const t = translate;
