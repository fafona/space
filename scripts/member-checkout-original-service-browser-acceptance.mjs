// Actual identity wrapper/history panels/original-service controller and HTTP.
// Intercepted synthetic auth/RPC IO; not a live Next/PostgREST or phone claim.
import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { chromium } from 'playwright';
import fixtures from './fixtures/member-checkout-original-service.ts';
import http from '../src/lib/merchantCheckoutOriginalService.server.ts';
import recovery from '../src/lib/merchantCheckoutHistoryRecovery.ts';
const origin = 'https://original-service-browser.synthetic.invalid';
const copy = { zh: { cancel: '按原规则取消原单', read: '重新读取原单', done: '原单已取消', inventory: '查阅／重读首页' }, en: { cancel: 'Cancel under original policy', read: 'Read original again', done: 'Original cancelled', inventory: 'Read / reload first page' }, es: { cancel: 'Cancelar según política original', read: 'Consultar original de nuevo', done: 'Original cancelado', inventory: 'Consultar / recargar primera página' } };
async function assets() {
  const js = await build({ stdin: { loader: 'tsx', resolveDir: process.cwd(), contents: `import React from'react';import{createRoot}from'react-dom/client';import Client from'./src/app/member-checkout/[siteId]/resume/CheckoutResumeClient';import{SERVICE_IDENTITY_CHANGED}from'./src/components/service-center/serviceCenterClient';window.__identity=()=>window.dispatchEvent(new Event(SERVICE_IDENTITY_CHANGED));createRoot(document.getElementById('root')).render(<Client siteId={window.__site} serviceOperationKey={location.pathname.includes('/service/')?window.__op:undefined} readOnly originalServiceEnabled={window.__enabled}/>);` }, bundle: true, platform: 'browser', format: 'iife', write: false, logLevel: 'silent', define: { 'process.env': '{}' }, plugins: [{ name: 'synthetic-ports', setup(b) {
    b.onResolve({ filter: /(?:^|\/)I18nProvider$/ }, () => ({ path: 'i18n', namespace: 'synthetic' })); b.onResolve({ filter: /authSessionRecovery$/ }, () => ({ path: 'auth', namespace: 'synthetic' })); b.onResolve({ filter: /^next\/link$/ }, () => ({ path: 'link', namespace: 'synthetic' }));
    b.onLoad({ filter: /.*/, namespace: 'synthetic' }, a => ({ loader: 'tsx', resolveDir: process.cwd(), contents: a.path === 'i18n' ? 'export const useI18n=()=>({locale:window.__locale});' : a.path === 'auth' ? 'export const resolveFrontendAuthPayload=async()=>null;' : "import React from'react';export default({prefetch,...p})=><a {...p}/>;" }));
  } }] });
  const css = await postcss([tailwind()]).process('@import "tailwindcss" source(none); @source "./src/components/checkout"; @source "./src/app/member-checkout";', { from: path.resolve('original-service-browser.css') }); return { js: js.outputFiles[0].text, css: css.css };
}
async function open(browser, a, { width = 390, locale = 'zh', kind = 'single_points', mode = 'normal', history = false, enabled = true } = {}) {
  const f = await fixtures.originalServiceFixture(kind), context = await browser.newContext({ viewport: { width, height: 1000 } }), page = await context.newPage(), errors = [], calls = [];
  let closed = false, account = f.accountId, cancels = 0;
  const key = `faolla-member-checkout-v2:${f.siteId}:${f.accountId}`, initial = { [key]: JSON.stringify({ version: 1, nonce: '12345678-1234-4234-8234-123456789abc' }), 'host-cart': 'KEEP PRODUCTS AND MEMBER', 'host-form': 'KEEP CONTACT AND NOTE' };
  if (mode === 'review') f.review.reviewRequired = true;
  if (mode === 'collected') { const r = f.review.original.original.result; r.collection = { amountMinor: r.terms.dueMinor, currency: 'eur', recordedAt: '2026-11-24T12:00:00Z' }; r.cancellationAvailable = false; }
  await context.addInitScript(({ initial, siteId, op, locale, enabled, origin }) => { if (location.origin !== origin) return; Object.assign(window, { __site: siteId, __op: op, __locale: locale, __enabled: enabled });
    if (!localStorage.getItem('__synthetic_original_service_seeded')) { for (const [k, v] of Object.entries(initial)) localStorage.setItem(k, v); localStorage.setItem('__synthetic_original_service_seeded', '1'); }
  }, { initial, siteId: f.siteId, op: f.review.operationKey, locale, enabled, origin });
  page.setDefaultTimeout(6500); context.on('page', p => p.on('pageerror', e => errors.push(e.message))); page.on('pageerror', e => errors.push(e.message));
  await context.route('**/*', async route => {
    const request = route.request(), u = new URL(request.url()); assert.equal(u.origin, origin); if (u.pathname === '/_synthetic/app.js') return route.fulfill({ contentType: 'text/javascript', body: a.js });
    if (request.isNavigationRequest()) return route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>' + a.css + 'body{margin:0;background:#f8fafc;font-family:Arial,sans-serif}</style><div id="root"></div><script src="/_synthetic/app.js"></script>' });
    calls.push(u.pathname);
    if (u.pathname === '/api/personal-favorites') return route.fulfill({ json: { authenticated: true, accountId: account } });
    const body = request.postDataJSON();
    if (u.pathname.includes('/original-service/')) {
      const cancel = u.pathname.endsWith('/cancel'), response = await http.handleCheckoutOriginalService(cancel, new Request(request.url(), { method: 'POST', headers: { ...request.headers(), origin }, body: request.postData() }), {
        enabled: () => true, session: async () => ({ accountId: account, userId: account === f.accountId ? f.userId : 'other-synthetic-user', servicePaused: false, user: { email_confirmed_at: '2026-01-01T00:00:00Z' } }),
        call: async (name, args) => { if (args.p_principal_key !== `account:${f.accountId}:${f.userId}`) return { data: null, error: { message: 'checkout_not_found' } };
          if (name.endsWith('review_v1')) return { data: closed ? f.closed : f.review, error: null };
          cancels++; closed = true; return { data: f.cancellation, error: null };
        },
      });
      if (cancel && mode === 'lost') return route.fulfill({ status: 503, json: { error: 'checkout_service_unconfirmed' } }); return route.fulfill({ status: response.status, json: await response.json() });
    }
    if (u.pathname.endsWith('/history/pending')) return route.fulfill({ json: { ok: true, readOnly: true, snapshot: { ...f.snapshot, pending: { ...f.snapshot.pending, original: f.review.original } } } });
    if (u.pathname.endsWith('/history/recover')) return route.fulfill({ json: { ok: true, readOnly: true, reference: await recovery.checkoutHistoryRecoveryReference(f.siteId, f.accountId, body.nonce), recovery: { version: 1, siteId: f.siteId, operationKey: f.review.operationKey, original: f.review.original, reviewRequired: false } } });
    if (u.pathname.endsWith('/history/retained')) return route.fulfill({ json: { ok: true, readOnly: true, inventory: { version: 1, siteId: f.siteId, after: body.after, items: [{ operationKey: f.review.operationKey, original: f.review.original, reviewRequired: false }], nextCursor: null } } });
    assert.fail('unexpected route ' + u.pathname);
  });
  await page.goto(origin + `/member-checkout/${f.siteId}/${history ? 'resume' : 'service/' + f.review.operationKey}`);
  return { f, context, page, calls, errors, initial, key, cancels: () => cancels, switchIdentity: () => { account = '59999999'; return page.evaluate(() => window.__identity()); } };
}
test('original-only servicing across four originals, two sizes and three languages keeps drafts and sends one explicit cancellation', { timeout: 120000 }, async t => {
  const a = await assets(), browser = await chromium.launch({ headless: true }), evidence = path.resolve('output', `original-service-browser-${Date.now()}`); await mkdir(evidence, { recursive: true });
  try { for (const kind of ['single_points', 'single_on_site', 'cart_points', 'cart_on_site']) for (const width of [390, 1280]) for (const locale of ['zh', 'en', 'es']) await t.test(`${kind}-${width}-${locale}`, async () => {
    const x = await open(browser, a, { kind, width, locale }), p = x.page.locator('[data-original-service]'), t = copy[locale];
    try { const cancel = p.getByRole('button', { name: t.cancel, exact: true }); await cancel.waitFor(); assert.equal(await cancel.isEnabled(), false); await p.getByRole('checkbox').check(); await cancel.scrollIntoViewIfNeeded();
      if (kind === 'single_points') await x.page.screenshot({ path: path.join(evidence, `${width}-${locale}.png`), fullPage: true }); await cancel.click(); await p.getByRole('status').filter({ hasText: t.done }).waitFor();
      assert.equal(x.cancels(), 1); const saved = await x.page.evaluate(keys => Object.fromEntries(keys.map(k => [k, localStorage.getItem(k)])), Object.keys(x.initial)); assert.deepEqual(saved, x.initial);
      assert.equal(await x.page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false); assert.deepEqual(x.errors, []);
      assert.ok(x.calls.every(p => p === '/api/personal-favorites' || p.startsWith('/api/member-checkout/original-service/')));
    } finally { await x.context.close(); }
  }); } finally { console.log('ORIGINAL_SERVICE_BROWSER_EVIDENCE=' + evidence); await browser.close(); }
});
test('lost reply, paid/manual originals, changed identity and three history links retain safe servicing boundaries', { timeout: 90000 }, async t => {
  const a = await assets(), browser = await chromium.launch({ headless: true });
  try { for (const mode of ['lost', 'review', 'collected', 'identity', 'history', 'historyOff']) await t.test(mode, async () => {
    const x = await open(browser, a, { kind: mode === 'collected' ? 'single_on_site' : 'single_points', mode, history: mode.startsWith('history'), enabled: mode !== 'historyOff' }), p = x.page.locator('[data-original-service]'), t = copy.zh;
    try { if (mode.startsWith('history')) {
      await x.page.locator('[data-checkout-history-inventory]').getByRole('button', { name: t.inventory, exact: true }).click(); await x.page.locator('[data-history-original]').waitFor();
      const links = x.page.locator('[data-original-service-link]'); assert.equal(await links.count(), mode === 'historyOff' ? 0 : 3); assert.equal(x.cancels(), 0);
      if (mode === 'history') { const href = await links.first().getAttribute('href'); assert.match(href, /\/service\/[a-f0-9]{64}\?uiLocale=zh$/); const popup = x.page.waitForEvent('popup'); await links.first().click(); const opened = await popup; await opened.locator('[data-original-service]').getByRole('button', { name: t.cancel, exact: true }).waitFor(); assert.equal(x.cancels(), 0); }
    } else if (mode === 'review' || mode === 'collected') { await p.getByRole('button', { name: t.read, exact: true }).waitFor(); await x.page.waitForFunction(() => !!document.querySelector('[data-original-service] article')); assert.equal(await p.getByRole('checkbox').count(), 0); assert.equal(x.cancels(), 0);
    } else { const cancel = p.getByRole('button', { name: t.cancel, exact: true }); await cancel.waitFor();
      if (mode === 'identity') { await x.switchIdentity(); await p.getByRole('alert').waitFor(); assert.equal(await p.locator('article').count(), 0); assert.equal(x.cancels(), 0); }
      else { await p.getByRole('checkbox').check(); await cancel.click(); await p.getByRole('alert').waitFor(); assert.equal(await cancel.isEnabled(), false); assert.equal(x.cancels(), 1); await p.getByRole('button', { name: t.read, exact: true }).click(); await p.getByRole('status').filter({ hasText: t.done }).waitFor(); assert.equal(x.cancels(), 1); }
    }
    assert.deepEqual(x.errors, []); assert.deepEqual(await x.page.evaluate(keys => Object.fromEntries(keys.map(k => [k, localStorage.getItem(k)])), Object.keys(x.initial)), x.initial);
    } finally { await x.context.close(); }
  }); } finally { await browser.close(); }
});
