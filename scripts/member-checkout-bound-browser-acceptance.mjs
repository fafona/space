// Actual Start client / ProductBlock + account cart host / panels / controllers,
// native storage and Web Locks. HTTP/identity/SQL IO is synthetic interception;
// not a running Next.js/PostgREST or physical-phone acceptance claim.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { chromium } from 'playwright';
import singleFixtures from './fixtures/member-checkout-single-intent.ts';
import cartFixtures from './fixtures/member-checkout-cart-review.ts';
import unusedHttp from '../src/lib/merchantCheckoutUnusedReference.server.ts';
import identity from '../src/lib/merchantCheckoutSubmissionPlan.server.ts';
const origin = 'https://bound-browser.synthetic.invalid';
const words = {
  zh: { name: '姓名', email: '联系邮箱', phone: '联系电话', title: '称呼', quote: '核对积分与券', cashQuote: '核对金额与优惠券', cartQuote: '核对整车与优惠券', submit: '确认兑换并提交', cashSubmit: '确认提交 · 到店付款', cartSubmit: '确认整车结算', begin: '核对会员积分与券', check: '检查这次提交', close: '关闭未成单编号并继续' },
  en: { name: 'Name', email: 'Contact email', phone: 'Phone', title: 'Title', quote: 'Review points & coupons', cashQuote: 'Review amount & coupons', cartQuote: 'Review cart & coupons', submit: 'Confirm redemption & submit', cashSubmit: 'Submit · Pay at venue', cartSubmit: 'Confirm cart checkout', begin: 'Review member points & coupons', check: 'Check this attempt', close: 'Close unused reference & continue' },
  es: { name: 'Nombre', email: 'Correo de contacto', phone: 'Teléfono', title: 'Tratamiento', quote: 'Revisar puntos y cupones', cashQuote: 'Revisar importe y cupones', cartQuote: 'Revisar carrito y cupones', submit: 'Confirmar canje y enviar', cashSubmit: 'Enviar · Pagar en el local', cartSubmit: 'Confirmar pedido completo', begin: 'Revisar puntos y cupones', check: 'Comprobar este intento', close: 'Cerrar referencia sin pedido y continuar' },
};
async function assets() {
  const [js, css] = await Promise.all([build({ stdin: { loader: 'tsx', resolveDir: process.cwd(), contents: `import React from'react';import{createRoot}from'react-dom/client';
    import Start from'./src/app/member-checkout/[siteId]/start/CheckoutStartClient';import Cart from'./src/components/checkout/MemberProductCartBlock';
    createRoot(document.getElementById('root')).render(window.__kind==='cart'?<Cart products={window.__products} runtimeSiteId={window.__site} runtimeBlockId="cart-products" runtimeCatalogViewport={innerWidth<600?'mobile':'desktop'} runtimeOrderManagementEnabled productPricePrefix="€"/>:
    <Start siteId={window.__site} initialSelection={window.__selection} onSite={window.__kind==='on-site'} intentEnabled unusedReferenceEnabled/>);` }, bundle: true, platform: 'browser', format: 'iife', write: false, logLevel: 'silent', define: { 'process.env': '{}' }, plugins: [{ name: 'synthetic-context', setup(b) {
      b.onResolve({ filter: /(?:^|\/)I18nProvider$/ }, () => ({ path: 'i18n', namespace: 'context' })); b.onResolve({ filter: /PublicTrafficProvider$/ }, () => ({ path: 'traffic', namespace: 'context' })); b.onResolve({ filter: /authSessionRecovery$/ }, () => ({ path: 'auth', namespace: 'context' }));
      b.onResolve({ filter: /^next\/(image|link)$/ }, a => ({ path: a.path, namespace: 'context' })); b.onLoad({ filter: /.*/, namespace: 'context' }, a => ({ loader: 'tsx', resolveDir: process.cwd(), contents: a.path === 'i18n' ? 'export const useI18n=()=>({locale:window.__locale});' : a.path === 'traffic' ? 'export const usePublicTraffic=()=>null;export const usePublicTrafficExposure=()=>{};' : a.path === 'auth' ? 'export const resolveFrontendAuthPayload=async()=>null;' : a.path === 'next/link' ? "import React from'react';export default({prefetch,...p})=><a {...p}/>;" : 'export default function Image(){return null;}' }));
    } }] }), postcss([tailwind()]).process('@import "tailwindcss" source(none); @source "./src/components/checkout"; @source "./src/components/booking"; @source "./src/components/blocks/ProductBlock.tsx"; @source "./src/app/member-checkout";', { from: path.resolve('bound-browser.css') })]);
  return { js: js.outputFiles[0].text, css: css.css };
}
async function scenario(browser, a, { kind = 'points', locale = 'zh', width = 390, mode = 'normal' } = {}) {
  const s = await singleFixtures.singleIntentFixture(kind === 'on-site' ? 'on_site' : 'points'), c = await cartFixtures.cartReviewFixture(), principal = kind === 'cart' ? c.f.principal : { accountId: s.accountId, userId: s.userId };
  const site = kind === 'cart' ? c.f.siteId : s.siteId, key = `faolla-member-checkout-v2:${site}:${principal.accountId}`, ownerKey = `faolla-checkout-reference-owner-v1:${site}:${principal.accountId}`;
  const owned = `merchant-space:product-cart:v2:${site}:cart-products:${principal.accountId}`, shared = `merchant-space:product-cart:v1:${site}:cart-products`;
  const customer = { name: 'Synthetic', email: 'synthetic@example.invalid', phone: '000000000', note: 'KEEP my note' };
  const products = c.f.catalog.products.map(p => Object.fromEntries(['id', 'code', 'name', 'description', 'imageUrl', 'thumbnailUrl', 'tag', 'price'].map(k => [k, p[k]])));
  const items = products.map(product => ({ productId: product.id, product, quantity: 1, checked: true, unitPrice: Number(product.price), unitPriceText: '€' + product.price }));
  const initial = { [owned]: JSON.stringify({ version: 1, scope: { siteId: site, blockId: 'cart-products', accountId: principal.accountId }, revision: 1, data: { items, customer, clientRequestId: '' } }), [shared]: JSON.stringify({ items, customer: { name: 'DO NOT IMPORT', email: 'private@synthetic.invalid' }, clientRequestId: '' }) };
  if (mode === 'legacy') initial[key] = JSON.stringify({ version: 1, nonce: s.nonce });
  const context = await browser.newContext({ viewport: { width, height: width < 600 ? 780 : 1050 } }), page = await context.newPage(), t = words[locale]; page.setDefaultTimeout(6500);
  await context.addInitScript(({ initial, site, products, selection, kind, locale, origin }) => { if (location.origin !== origin) return;
    Object.assign(window, { __site: site, __products: products, __selection: selection, __kind: kind, __locale: locale }); for (const [k, v] of Object.entries(initial)) localStorage.setItem(k, v);
  }, { initial, site, products: c.f.catalog.products, selection: s.selection, kind, locale, origin });
  const calls = [], unexpected = [], errors = [], closes = []; let closed = false;
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url());
    if (url.origin !== origin) { unexpected.push(url.href); return route.abort(); }
    if (req.isNavigationRequest()) return route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div>' });
    calls.push(url.pathname);
    if (url.pathname === '/api/personal-favorites') return route.fulfill({ json: { authenticated: true, accountId: principal.accountId } });
    if (url.pathname === '/api/orders/catalog/public') return route.fulfill({ json: { ok: true, catalog: c.f.catalog } });
    const body = req.postDataJSON();
    if (url.pathname.endsWith('/cart/entry')) return route.fulfill({ json: { ok: true, intent: true, ownedDraft: true, unusedReference: true, entry: { siteId: site, accountId: principal.accountId, query: body, offers: c.f.offers.map(o => ({ offerId: o.id, offerRevision: o.revision, title: o.title, maxQuantity: 999, source: { kind: 'order', productId: o.source.productId } })) } } });
    assert.equal(req.headers()['x-checkout-account-scope'], principal.accountId);
    if (url.pathname.endsWith('intent/pending')) return route.fulfill({ json: { ok: true, snapshot: { version: 1, siteId: site, pending: null } } });
    if (url.pathname.endsWith('cart/recover')) return route.fulfill({ json: { ok: true, state: 'unconfirmed' } });
    if (url.pathname.endsWith('preview')) return route.fulfill({ json: kind === 'cart' ? c.review : kind === 'on-site' ? s.cashPreview : s.pointsPreview });
    if (url.pathname.includes('bound-submit/')) { assert.match(req.headers()['x-checkout-operation-scope'], /^[a-f0-9]{64}$/); return route.fulfill({ status: 503, json: { error: 'checkout_unconfirmed' } }); }
    if (/intent\/(unused-review|close-unused)$/.test(url.pathname)) {
      const close = url.pathname.endsWith('close-unused'), id = identity.checkoutSubmissionRecoveryIdentity({ siteId: site, nonce: body.nonce }, principal);
      if (close && mode === 'draftChanged') await page.evaluate(k => localStorage.removeItem(k), owned);
      const r = await unusedHttp.handleUnusedCheckoutReference(close, new Request(req.url(), { method: 'POST', headers: { ...req.headers(), origin }, body: req.postData() }), { enabled: () => true,
        session: async () => ({ ...principal, servicePaused: false, user: { email_confirmed_at: '2026-01-01T00:00:00Z' } }), call: async (name, args) => {
          assert.equal(args.p_operation_key, id.operationKey); assert.equal(args.p_principal_key, id.principalKey);
          if (name.endsWith('review_v1')) return { data: { version: 1, siteId: site, operationKey: id.operationKey, state: closed ? 'closed' : 'unused', reviewHash: 'd'.repeat(64), closedAt: closed ? '2026-11-24T12:00:00Z' : null }, error: null };
          closes.push(args); const replayed = closed; closed = true; return { data: { version: 1, siteId: site, operationKey: id.operationKey, closed: true, replayed, reviewHash: 'd'.repeat(64), closedAt: '2026-11-24T12:00:00Z' }, error: null };
        } });
      if (close && mode === 'lostClose' && closes.length === 1) return route.fulfill({ status: 503, json: { error: 'checkout_unused_unconfirmed' } });
      return route.fulfill({ status: r.status, json: await r.json() });
    }
    unexpected.push(url.pathname); return route.abort();
  });
  await page.goto(origin); await page.addStyleTag({ content: a.css + 'body{margin:0;font-family:Arial,sans-serif;background:#f8fafc}' }); await page.addScriptTag({ content: a.js });
  if (kind === 'cart') { await page.getByRole('button', { name: '打开购物车', exact: true }).click(); await page.locator('[data-cart-member-entry]').getByRole('button', { name: t.begin, exact: true }).click(); }
  const panel = kind === 'cart' ? page.locator('[data-member-cart-checkout]') : page.locator('main section'); await panel.waitFor();
  if (mode !== 'legacy') {
    const fillContact = async () => { await panel.getByLabel(t.name, { exact: true }).fill(customer.name); await panel.getByLabel(t.email, { exact: true }).fill(customer.email); await panel.getByLabel(t.phone, { exact: true }).fill(customer.phone); };
    if (kind === 'on-site') { await fillContact(); await panel.locator('textarea').fill(customer.note); }
    await panel.getByRole('button', { name: kind === 'cart' ? t.cartQuote : kind === 'on-site' ? t.cashQuote : t.quote, exact: true }).click();
    if (kind === 'points') { await fillContact(); await panel.locator('textarea').fill(customer.note); }
    if (kind !== 'cart') await panel.getByRole('combobox', { name: t.title, exact: true }).selectOption('Mx');
    else await panel.getByRole('checkbox').last().check();
    await panel.getByRole('button', { name: kind === 'cart' ? t.cartSubmit : kind === 'on-site' ? t.cashSubmit : t.submit, exact: true }).click();
  }
  const box = panel.locator('[data-unused-reference]'); await box.getByRole('button', { name: t.check, exact: true }).waitFor();
  if (mode === 'badBinding') await page.evaluate(k => localStorage.setItem(k, localStorage.getItem(k) + ' '), ownerKey);
  const saved = await page.evaluate(keys => Object.fromEntries(keys.map(k => [k, localStorage.getItem(k)])), [key, ownerKey, owned, shared]);
  return { context, page, panel, box, t, key, ownerKey, owned, shared, saved, calls, unexpected, errors, closes };
}
test('bound unknown references close explicitly through actual checkout pages/cart in eighteen device-language journeys', { timeout: 180000 }, async t => {
  const a = await assets(), browser = await chromium.launch({ headless: true }), evidence = path.resolve('output', `bound-checkout-browser-${Date.now()}`); await mkdir(evidence, { recursive: true });
  try { for (const kind of ['points', 'on-site', 'cart']) for (const width of [390, 1280]) for (const locale of ['zh', 'en', 'es']) await t.test(`${kind}-${width}-${locale}`, async () => {
    const f = await scenario(browser, a, { kind, width, locale });
    try {
      await f.box.getByRole('button', { name: f.t.check, exact: true }).click(); const close = f.box.getByRole('button', { name: f.t.close, exact: true }); await close.waitFor(); assert.equal(await close.isEnabled(), false);
      await f.box.getByRole('checkbox').check();
      await f.box.getByRole('button', { name: f.t.check, exact: true }).click(); await close.waitFor();
      assert.equal(await f.box.getByRole('checkbox').isChecked(), false, 'rereading needs a fresh explicit confirmation'); assert.equal(await close.isEnabled(), false);
      await f.box.getByRole('checkbox').check(); await close.scrollIntoViewIfNeeded();
      const colors = await close.evaluate(el => ({ background: getComputedStyle(el).backgroundColor, text: getComputedStyle(el).color })); assert.notEqual(colors.background, colors.text, 'confirmation must be legible');
      await f.page.screenshot({ path: path.join(evidence, `${kind}-${width}-${locale}.png`), fullPage: true }); await close.click();
      await f.page.waitForFunction(k => localStorage.getItem(k) === null, f.key);
      if (kind === 'cart') { await f.page.locator('[data-cart-member-entry]').getByRole('button', { name: f.t.begin, exact: true }).waitFor(); assert.equal(await f.panel.count(), 0); }
      else {
        const quote = f.panel.getByRole('button', { name: kind === 'points' ? f.t.quote : f.t.cashQuote, exact: true }); await quote.waitFor(); assert.equal(await quote.isEnabled(), true);
        if (kind === 'points') await quote.click();
        assert.equal(await f.panel.getByLabel(f.t.name, { exact: true }).inputValue(), 'Synthetic');
        assert.equal(await f.panel.locator('textarea').inputValue(), 'KEEP my note');
      }
      const after = await f.page.evaluate(keys => Object.fromEntries(keys.map(k => [k, localStorage.getItem(k)])), [f.ownerKey, f.owned, f.shared]);
      for (const k of Object.keys(after)) assert.equal(after[k], f.saved[k], k);
      assert.equal(f.closes.length, 1); assert.equal(f.calls.filter(p => p.includes('bound-submit/')).length, 1); assert.deepEqual(f.unexpected, []); assert.deepEqual(f.errors, []);
      assert.equal(await f.page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    } catch (error) { await f.page.screenshot({ path: path.join(evidence, `failure-${kind}-${width}-${locale}.png`), fullPage: true }); throw error; }
    finally { await f.context.close(); }
  }); } finally { console.log(`BOUND_CHECKOUT_BROWSER_EVIDENCE=${evidence}`); await browser.close(); }
});
test('legacy references, changed bindings/drafts and lost close replies preserve safe UI boundaries', { timeout: 90000 }, async t => {
  const a = await assets(), browser = await chromium.launch({ headless: true });
  try { for (const mode of ['legacy', 'badBinding', 'draftChanged', 'lostClose']) await t.test(mode, async () => {
    const f = await scenario(browser, a, { kind: mode === 'draftChanged' ? 'cart' : 'points', mode });
    try {
      await f.box.getByRole('button', { name: f.t.check, exact: true }).click();
      if (mode === 'legacy' || mode === 'badBinding') { await f.box.getByRole('alert').waitFor(); assert.equal(f.closes.length, 0); assert.equal(await f.box.getByRole('checkbox').count(), 0); }
      else { await f.box.getByRole('checkbox').check(); await f.box.getByRole('button', { name: f.t.close, exact: true }).click(); await f.box.getByRole('alert').waitFor();
        if (mode === 'lostClose') { assert.notEqual(await f.page.evaluate(k => localStorage.getItem(k), f.key), null); await f.box.getByRole('button', { name: f.t.check, exact: true }).click(); await f.box.getByRole('checkbox').check(); await f.box.getByRole('button', { name: f.t.close, exact: true }).click(); await f.page.waitForFunction(k => localStorage.getItem(k) === null, f.key); assert.equal(f.closes.length, 2); }
      }
      if (mode !== 'lostClose') assert.notEqual(await f.page.evaluate(k => localStorage.getItem(k), f.key), null);
      assert.equal(f.calls.filter(p => p.includes('bound-submit/')).length, mode === 'legacy' ? 0 : 1); assert.deepEqual(f.unexpected, []); assert.deepEqual(f.errors, []);
    } finally { await f.context.close(); }
  }); } finally { await browser.close(); }
});
