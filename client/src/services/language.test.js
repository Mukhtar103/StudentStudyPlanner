import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const originalDocument = globalThis.document;
const originalStorage = globalThis.localStorage;
const saved = new Map([['ssp-language', 'fa-AF']]);
globalThis.document = { documentElement: {}, title: '' };
globalThis.localStorage = { getItem: key => saved.get(key), setItem: (key, value) => saved.set(key, value) };
const { translate, setLanguage, isDari, languageLocale } = await import('./language.js');
after(() => {
  if (originalDocument === undefined) delete globalThis.document;
  else globalThis.document = originalDocument;
  if (originalStorage === undefined) delete globalThis.localStorage;
  else globalThis.localStorage = originalStorage;
});

test('Dari language selection restores storage and document direction', () => {
  assert.equal(document.documentElement.lang, 'fa-AF');
  assert.equal(document.documentElement.dir, 'rtl');
  assert.equal(translate('Courses'), 'کورس‌ها');
});
test('Translation preserves whitespace, unknown user text and non-text values', () => {
  assert.equal(translate(' Save profile '), ' ذخیرهٔ پروفایل ');
  assert.equal(translate('My own course title'), 'My own course title');
  const content = { type: 'span' };
  assert.equal(translate(content), content);
  assert.equal(translate(42), '۴۲');
  assert.equal(translate('Courses', 'en'), 'Courses');
  assert.equal(translate('45 min'), '۴۵ دقیقه');
  assert.equal(translate('0123456789'), '۰۱۲۳۴۵۶۷۸۹');
  assert.equal(translate('٠١٢٣٤٥٦٧٨٩'), '۰۱۲۳۴۵۶۷۸۹');
  assert.equal(translate('Page 12', 'en'), 'Page 12');
  assert.equal(translate(42, 'en'), 42);
});
test('English switching persists without changing stored API identifiers', () => {
  setLanguage('en');
  assert.equal(saved.get('ssp-language'), 'en');
  assert.equal(document.documentElement.dir, 'ltr');
  assert.equal(translate('Courses'), 'Courses');
  setLanguage('fa-AF');
  assert.equal(document.documentElement.dir, 'rtl');
  assert.equal(languageLocale('fa-AF'), 'fa-AF-u-ca-gregory');
  assert.equal(isDari('fa-AF-u-ca-gregory'), true);
  assert.equal(isDari('en-US'), false);
});
