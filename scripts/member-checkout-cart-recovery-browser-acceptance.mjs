// Actual gated cart -> new-tab original page -> real read-only HTTP handlers.
// Sessions and private RPC data are synthetic; every network request is intercepted.
// No live Next/PostgREST, real users, production storage, Stripe or mail.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { chromium } from 'playwright';
import fixtures from './fixtures/member-checkout-history-recovery.ts';
import entryHttp from '../src/app/api/member-checkout/cart/entry/route-handler.ts';
import pendingHttp from '../src/lib/merchantCheckoutHistoryPending.server.ts';
import recoveryHttp from '../src/lib/merchantCheckoutHistoryRecovery.server.ts';

const origin = 'https://cart-recovery.synthetic.invalid';
const labels = {
  zh: { link: '只读核对本人原单', title: '我的结算原单', local: '本设备保留的原单', blocked: '原普通订单编号' },
  en: { link: 'View my original (read-only)', title: 'My original checkout', local: 'Original kept on this device', blocked: 'original regular-order ID' },
  es: { link: 'Consultar mi original (solo lectura)', title: 'Mi pago original', local: 'Original guardado en este dispositivo', blocked: 'identificador de un pedido normal' },
};
let cached;
function assets() {
  return cached ??= Promise.all([
    build({ stdin: { loader: 'tsx', resolveDir: process.cwd(), contents: `
      import React from 'react'; import {createRoot} from 'react-dom/client';
      import Products from './src/components/checkout/MemberProductCartBlock';
      import Resume from './src/app/member-checkout/[siteId]/resume/CheckoutResumeClient';
      import {SERVICE_IDENTITY_CHANGED} from './src/components/service-center/serviceCenterClient';
      window.__identity = () => window.dispatchEvent(new Event(SERVICE_IDENTITY_CHANGED));
      createRoot(document.getElementById('root')).render(location.pathname === '/'
        ? <Products products={window.__products} runtimeSiteId={window.__site} runtimeBlockId="products"
          runtimeCatalogViewport={innerWidth<600?'mobile':'desktop'} runtimeOrderManagementEnabled productPricePrefix="€"/>
        : <Resume siteId={window.__site} readOnly/>);` },
      bundle: true, platform: 'browser', format: 'iife', write: false, logLevel: 'silent', define: { 'process.env': '{}' },
      plugins: [{ name: 'synthetic-context-only', setup(b) {
        b.onResolve({ filter: /(?:^|\/)I18nProvider$/ }, () => ({ path: 'i18n', namespace: 'synthetic' }));
        b.onResolve({ filter: /PublicTrafficProvider$/ }, () => ({ path: 'traffic', namespace: 'synthetic' }));
        b.onResolve({ filter: /authSessionRecovery$/ }, () => ({ path: 'session', namespace: 'synthetic' }));
        b.onResolve({ filter: /^next\/(image|link)$/ }, a => ({ path: a.path, namespace: 'synthetic' }));
        b.onLoad({ filter: /.*/, namespace: 'synthetic' }, ({ path: p }) => ({ loader: 'jsx', resolveDir: process.cwd(), contents:
          p === 'i18n' ? 'export const useI18n=()=>({locale:window.__locale});'
          : p === 'traffic' ? 'export const usePublicTraffic=()=>null;export const usePublicTrafficExposure=()=>{};'
          : p === 'session' ? 'export const resolveFrontendAuthPayload=async()=>null;'
          : p === 'next/link' ? 'import React from "react";export default({prefetch,...props})=><a {...props}/>;'
          : 'export default function Image(){return null;}' }));
      } }],
    }),
    postcss([tailwind()]).process('@import "tailwindcss" source(none); @source "./src/components/checkout"; @source "./src/components/blocks/ProductBlock.tsx"; @source "./src/app/member-checkout";', { from: path.resolve('cart-recovery-browser.css') }),
  ]).then(([js, css]) => ({ js: js.outputFiles[0].text, css: css.css }));
}

async function fixture(browser, a, { kind = 'cart_points', width = 390, locale = 'zh', mode = 'legacy' } = {}) {
  const x = await fixtures.historyRecoveryFixture(kind);
  const context = await browser.newContext({ viewport: { width, height: 900 } });
  const page = await context.newPage(), nonceKey = `faolla-member-checkout-v2:${x.siteId}:${x.accountId}`;
  const ownedKey = `merchant-space:product-cart:v2:${x.siteId}:products:${x.accountId}`;
  const legacyKey = `merchant-space:product-cart:v1:${x.siteId}:products`;
  const product = { id: 'kept', code: 'KEPT', name: 'Kept account product', description: '', price: '5', imageUrl: '', thumbnailUrl: '', tag: '' };
  const item = { productId: product.id, product, quantity: 2, checked: true, unitPrice: 5, unitPriceText: '€5' };
  const owned = mode === 'corruptOwned' ? 'broken-owned-draft' : JSON.stringify({ version: 1, scope: { siteId: x.siteId, accountId: x.accountId, blockId: 'products' }, revision: 4,
    data: { items: [item], customer: { name: 'Owned contact', email: 'owned@synthetic.invalid', phone: '123', note: 'Keep owned note' }, clientRequestId: '' } });
  const legacy = mode === 'corruptLegacy' ? 'broken-shared-draft' : JSON.stringify({ items: [item], customer: { name: 'Private prior contact', email: 'private@synthetic.invalid', phone: '999', note: 'Private prior note' }, clientRequestId: 'unconfirmed-ordinary-request' });
  const nonce = JSON.stringify({ version: 1, nonce: x.nonce });
  const initial = { [legacyKey]: legacy, [ownedKey]: owned, [nonceKey]: nonce };
  await context.addInitScript(({ site, locale, products, initial, expectedOrigin }) => {
    if (location.origin !== expectedOrigin) return;
    window.__site = site; window.__locale = locale; window.__products = products;
    if (!localStorage.getItem('synthetic-cart-recovery-seeded')) {
      for (const [key, value] of Object.entries(initial)) localStorage.setItem(key, value);
      localStorage.setItem('synthetic-cart-recovery-seeded', '1');
    }
  }, { site: x.siteId, locale, products: [product], initial, expectedOrigin: origin });
  const errors = [], unexpected = [], calls = [], privateCalls = [];
  let authenticated = !['guest', 'forgedGuestCapabilities'].includes(mode), historyEnabled = true;
  const session = () => authenticated ? { accountId: x.accountId, userId: x.userId, servicePaused: false, user: { email_confirmed_at: '2026-11-24T00:00:00Z' } } : null;
  context.on('page', p => p.on('pageerror', e => errors.push(e.message)));
  page.on('pageerror', e => errors.push(e.message));
  const reply = async (route, response) => route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: await response.text() });
  await context.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url()); calls.push(`${req.method()} ${url.pathname}`);
    assert.ok(!(req.postData() ?? '').includes('unconfirmed-ordinary-request'), 'an unowned ordinary reference is not a financial lookup or ownership hint');
    if (url.origin !== origin) { unexpected.push(req.url()); return route.abort(); }
    if (url.pathname === '/' || url.pathname === `/member-checkout/${x.siteId}/resume`) return route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/synthetic.css"><div id="root"></div><script src="/synthetic.js"></script>' });
    if (url.pathname === '/synthetic.js') return route.fulfill({ contentType: 'text/javascript', body: a.js });
    if (url.pathname === '/synthetic.css') return route.fulfill({ contentType: 'text/css', body: a.css });
    const request = () => new Request(url.href, { method: req.method(), headers: { ...req.headers(), origin }, ...(req.method() === 'POST' ? { body: req.postData() } : {}) });
    if (url.pathname === '/api/member-checkout/cart/entry') {
      const response = await entryHttp.handleCartCheckoutEntry(request(), { enabled: () => mode !== 'closed', recoveryEnabled: () => mode !== 'noHint', intentEnabled: () => true, draftEnabled: () => true, session: async () => session(), read: async () => { if (mode === 'discoveryFailure') throw Error('PRIVATE'); return []; } });
      if (mode === 'foreignHint' || mode === 'badHint') {
        assert.equal(response.status, 200); const value = await response.json();
        value.recovery = mode === 'foreignHint' ? { siteId: '19999999' } : { siteId: x.siteId, nonce: x.nonce };
        return route.fulfill({ status: 200, json: value });
      }
      if (mode === 'forgedGuestCapabilities' || mode === 'privateHintOnly') {
        assert.equal(response.status, 200); const value = await response.json();
        if (mode === 'forgedGuestCapabilities') { assert.equal(value.entry, null); value.intent = true; value.ownedDraft = true; }
        else { assert.equal(value.entry.recoveryEnabled, true); delete value.recovery; }
        return route.fulfill({ status: 200, json: value });
      }
      return reply(route, response);
    }
    if (url.pathname === '/api/personal-favorites') return route.fulfill({ json: { authenticated, accountId: authenticated ? x.accountId : '' } });
    if (url.pathname === '/api/member-checkout/history/pending') return reply(route, await pendingHttp.handleCheckoutHistoryPending(request(), {
      enabled: () => historyEnabled, session: async () => session(), call: async (name, args) => {
        privateCalls.push(name); assert.equal(name, 'faolla_member_checkout_pending_intent_v1');
        assert.deepEqual(args, { p_site_id: x.siteId, p_principal_key: `account:${x.accountId}:${x.userId}` });
        if (mode === 'readFailure') throw Error('PRIVATE');
        return { data: mode === 'noOriginal' ? { version: 1, siteId: x.siteId, pending: null } : x.snapshot, error: null };
      },
    }));
    if (url.pathname === '/api/member-checkout/history/recover') return reply(route, await recoveryHttp.handleCheckoutHistoryRecovery(request(), {
      enabled: () => historyEnabled, session: async () => session(), call: async (name, args) => {
        privateCalls.push(name); assert.equal(name, 'faolla_member_checkout_history_original_v1');
        assert.deepEqual(args, { p_site_id: x.siteId, p_principal_key: x.identity.principalKey, p_operation_key: x.identity.operationKey });
        if (mode === 'readFailure') throw Error('PRIVATE');
        return { data: mode === 'noOriginal' ? { ...x.recovery, original: null, reviewRequired: null } : x.recovery, error: null };
      },
    }));
    unexpected.push(`${req.method()} ${url.pathname}`); return route.abort();
  });
  return { x, context, page, errors, calls, privateCalls, unexpected, initial, legacyKey, ownedKey, nonceKey,
    signOut() { authenticated = false; }, revokeHistory() { historyEnabled = false; }, async checkStorage() {
      assert.deepEqual(await page.evaluate(keys => Object.fromEntries(keys.map(k => [k, localStorage.getItem(k)])), Object.keys(initial)), initial);
    } };
}

const retainedResult = async (popup, f, locale) => {
  await popup.getByRole('heading', { name: labels[locale].title, exact: true }).waitFor();
  const retained = popup.locator('[data-checkout-local-recovery]');
  await retained.getByRole('heading', { name: labels[locale].local, exact: true }).waitFor();
  const r = f.x.recovery.original;
  if (r.kind === 'cart') await retained.locator('[data-cart-settlement-status]').waitFor();
  else if (r.original.method === 'on_site') await retained.locator('[data-on-site-summary]').waitFor();
  else await retained.getByText(r.original.result.resourceId, { exact: true }).waitFor();
  return retained;
};
const openOriginal = async (f, locale) => {
  const link = f.page.getByRole('link', { name: labels[locale].link, exact: true }); await link.waitFor({ timeout: 3000 });
  assert.equal(await link.getAttribute('href'), `/member-checkout/${f.x.siteId}/resume?uiLocale=${locale}`);
  assert.equal(await link.getAttribute('target'), '_blank'); assert.match(await link.getAttribute('rel'), /noopener/); assert.match(await link.getAttribute('rel'), /noreferrer/);
  const next = f.context.waitForEvent('page'); await link.click(); return next;
};
const openCart = async f => { await f.page.goto(origin); await f.page.getByRole('button', { name: '打开购物车', exact: true }).click(); };

test('protected legacy carts reach all four self-original types in a read-only new tab without adopting shared data', { timeout: 120_000 }, async t => {
  const a = await assets(), browser = await chromium.launch({ headless: true });
  const evidence = path.resolve('output', `cart-recovery-browser-${Date.now()}`); await mkdir(evidence, { recursive: true });
  try { for (const kind of ['cart_points', 'cart_on_site', 'single_points', 'single_on_site']) for (const width of [390, 1280]) for (const locale of ['zh', 'en', 'es']) await t.test(`${kind} ${width} ${locale}`, async () => {
    const f = await fixture(browser, a, { kind, width, locale });
    try {
      await openCart(f); await f.page.getByRole('alert').filter({ hasText: labels[locale].blocked }).waitFor();
      assert.equal(await f.page.getByText('Private prior contact', { exact: true }).count(), 0); await f.checkStorage();
      const popup = await openOriginal(f, locale), retained = await retainedResult(popup, f, locale);
      assert.equal(await popup.locator('[data-member-cart-checkout]').count(), 0);
      assert.equal(await retained.locator('a,input,select,textarea').count(), 0);
      assert.equal(f.privateCalls.length, 2); await f.checkStorage();
      assert.deepEqual(f.errors, []); assert.deepEqual(f.unexpected, []);
      assert.equal(await f.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
      assert.equal(await popup.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
      await popup.close(); await f.checkStorage();
      if (kind === 'cart_on_site' && locale === 'es') await f.page.screenshot({ path: path.join(evidence, `${width}-${locale}-cart.png`), fullPage: true });
    } catch (error) { await f.page.screenshot({ path: path.join(evidence, `failure-${kind}-${width}-${locale}.png`), fullPage: true }); throw error; }
    finally { await f.context.close(); }
  }); } finally { console.log(`CART_RECOVERY_BROWSER_EVIDENCE=${evidence}`); await browser.close(); }
});

test('cart recovery hints never enable purchases, bypass old-draft barriers or expose a revoked identity', { timeout: 120_000 }, async t => {
  const a = await assets(), browser = await chromium.launch({ headless: true });
  const evidence = path.resolve('output', `cart-recovery-boundary-browser-${Date.now()}`); await mkdir(evidence, { recursive: true });
  try { for (const mode of ['noHint', 'closed', 'foreignHint', 'badHint', 'discoveryFailure', 'corruptOwned', 'corruptLegacy', 'privateHintOnly', 'noOriginal', 'readFailure', 'revoked', 'signedOut', 'guest', 'forgedGuestCapabilities']) await t.test(mode, async () => {
    const f = await fixture(browser, a, { mode });
    try {
      await openCart(f);
      if (['noHint', 'closed', 'foreignHint', 'badHint', 'discoveryFailure'].includes(mode)) {
        if (mode === 'noHint') await f.page.getByRole('alert').filter({ hasText: labels.zh.blocked }).waitFor();
        else await f.page.getByRole('status').filter({ hasText: '暂时无法核验结算入口' }).waitFor();
        assert.equal(await f.page.locator('[data-cart-recovery-entry]').count(), 0); await f.checkStorage(); assert.equal(f.privateCalls.length, 0); return;
      }
      if (mode === 'revoked') f.revokeHistory();
      if (mode === 'signedOut') f.signOut();
      const popup = await openOriginal(f, 'zh');
      if (['guest', 'signedOut', 'forgedGuestCapabilities'].includes(mode)) {
        await popup.getByText('请先登录本人账号查看结算原单。', { exact: true }).waitFor(); assert.equal(f.privateCalls.length, 0);
        assert.equal(await popup.locator('[data-checkout-local-recovery],[data-checkout-resume]').count(), 0);
        if (mode === 'signedOut') await f.checkStorage();
        else { // The unchanged old guest cart may normalize its own v1 draft.
          assert.equal(await f.page.evaluate(k => localStorage.getItem(k), f.ownedKey), f.initial[f.ownedKey]);
          assert.equal(await f.page.evaluate(k => localStorage.getItem(k), f.nonceKey), f.initial[f.nonceKey]);
          assert.equal(await f.page.locator('[data-cart-member-entry]').count(), 0);
        }
      } else if (['noOriginal', 'readFailure', 'revoked'].includes(mode)) {
        const local = popup.locator('[data-checkout-local-recovery]');
        await local.getByText(mode === 'noOriginal' ? '原结果尚未确认，原编号已保留。不要重复提交或扣减，可稍后再次核对。' : '暂时无法核对或原编号已变化。不会据此判定未付款；请保留原结算页与购物车。', { exact: true }).waitFor();
        assert.equal(await popup.locator('[data-cart-settlement-status],[data-on-site-summary]').count(), 0);
        assert.equal(f.privateCalls.length, mode === 'revoked' ? 0 : 2); await f.checkStorage();
        assert.ok(!(await popup.locator('body').textContent()).includes('PRIVATE'));
      } else {
        const local = await retainedResult(popup, f, 'zh'); assert.equal(await local.locator('a,input,select,textarea').count(), 0); await f.checkStorage();
        f.signOut(); await popup.evaluate(() => window.__identity()); await popup.getByText('请先登录本人账号查看结算原单。', { exact: true }).waitFor();
        assert.equal(await popup.locator('[data-cart-settlement-status],[data-on-site-summary]').count(), 0); await f.checkStorage();
      }
    } catch (error) { await f.page.screenshot({ path: path.join(evidence, `failure-${mode}.png`), fullPage: true }); throw error; }
    finally { try { assert.deepEqual(f.errors, []); assert.deepEqual(f.unexpected, []); } finally { await f.context.close(); } }
  }); } finally { console.log(`CART_RECOVERY_BOUNDARY_BROWSER_EVIDENCE=${evidence}`); await browser.close(); }
});
