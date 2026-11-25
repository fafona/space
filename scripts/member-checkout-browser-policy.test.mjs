import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { ownedPageRequest } from './member-checkout-browser-policy.mjs';
const origin = 'https://portal.checkout-auth.test:12345';
const translation = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=zh-CN&dt=t&q=ACCOUNT';
test('browser classification permits only exact owned origin, not its port or credential variants', () => {
  assert.deepEqual(ownedPageRequest(origin + '/login?uiLocale=zh-CN', origin), { kind: 'owned' });
  for (const url of ['https://portal.checkout-auth.test/login', 'https://portal.checkout-auth.test:12346/login',
    'https://user:secret@portal.checkout-auth.test:12345/login']) assert.equal(ownedPageRequest(url, origin).kind, 'external-refused');
});
test('only the authored optional translation shape is classified as refused, never allowed or fulfilled', () => {
  assert.deepEqual(ownedPageRequest(translation, origin), { kind: 'translation-refused', origin: 'https://translate.googleapis.com', pathname: '/translate_a/single' });
  for (const url of [translation.replace('https:', 'http:'), translation.replace('googleapis.com', 'googleapis.com.invalid'),
    translation.replace('/translate_a/single', '/another-path'), translation + '&token=secret', translation + '&q=duplicate', translation + '#fragment',
    translation.replace('tl=zh-CN', 'tl=unknown-locale'), translation.replace('q=ACCOUNT', 'q=' + 'a'.repeat(321))]) assert.equal(ownedPageRequest(url, origin).kind, 'external-refused');
  assert.equal(ownedPageRequest(translation, origin, 'POST').kind, 'external-refused');
});
test('browser evidence excludes credentials, query, translation text and fragments', () => {
  const record = JSON.stringify(ownedPageRequest('https://user:secret@other.invalid/path?token=hidden#private', origin));
  assert.doesNotMatch(record, /user|secret|hidden|token|private/);
  assert.doesNotMatch(JSON.stringify(ownedPageRequest(translation, origin)), /ACCOUNT|client|gtx|sl=/);
});
test('actual page harness aborts all non-owned requests and preserves fatal errors without fulfillment or UI injection', async () => {
  const source = await readFile(new URL('./member-checkout-page-cutover-cases.mjs', import.meta.url), 'utf8');
  assert.match(source, /if \(record\.kind === 'owned'\) return route\.continue\(\)/);
  assert.match(source, /if \(record\.kind === 'translation-refused'\) blockedTranslations\.push\(record\);\s+else unexpected\.push\(record\);\s+return route\.abort\(\)/);
  assert.match(source, /assert\.deepEqual\(unexpected, \[\], 'production_page_external_requests'\)/);
  assert.match(source, /assert\.deepEqual\(errors, \[\], 'production_page_errors'\)/);
  assert.doesNotMatch(source, /\.fulfill\(|addInitScript|window\.fetch\s*=|innerHTML\s*=/);
  assert.match(source, /\/login\?accountType=personal&uiLocale=zh-CN/);
  assert.doesNotMatch(source, /\/login\?[^']*loggedOut=/);
  assert.match(source, /getByRole\('button', \{ name: '显示密码', exact: true \}\)\.click\(\)/);
  assert.match(source, /getByRole\('button', \{ name: '隐藏密码', exact: true \}\)\.click\(\)/);
});
