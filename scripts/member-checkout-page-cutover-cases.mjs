// Real production HTML + hydration + existing controls through the owned proxy.
// No route fulfillment, injected auth/controller, rendered markup or UI patch.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { canonicalStaticPath } from './member-checkout-static-versions.mjs';
import { ownedPageRequest } from './member-checkout-browser-policy.mjs';

export async function createOwnedPageChecks({ context, origin, servicePath, assets, evidence, extraContexts, ownedViews }) {
  const guest = await context.browser().newContext({ ignoreHTTPSErrors: true, serviceWorkers: 'block', locale: 'zh-CN', viewport: { width: 1280, height: 1000 } });
  extraContexts.push(guest);
  const unexpected = [], errors = [], responses = [], blockedTranslations = [];
  // Keep safe request identity on failure too, never headers, query or body.
  evidence.browserPolicy = { unexpectedRequests: unexpected, pageErrors: errors, blockedTranslations };
  const track = async page => {
    ownedViews.push(page);
    await page.route('**/*', route => {
      const record = ownedPageRequest(route.request().url(), origin, route.request().method());
      if (record.kind === 'owned') return route.continue();
      if (record.kind === 'translation-refused') blockedTranslations.push(record);
      else unexpected.push(record);
      return route.abort(); // No external connection or synthetic translation.
    });
    page.on('pageerror', error => errors.push({ name: error.name }));
    page.on('response', response => {
      const url = new URL(response.url()); if (url.pathname.startsWith('/_next/static/')) responses.push({ path: canonicalStaticPath(url.pathname), status: response.status() });
    });
    page.on('requestfailed', request => { if (new URL(request.url()).pathname.startsWith('/_next/static/')) errors.push({ name: 'StaticRequestFailed' }); });
    return page;
  };
  const oldTab = await track(await guest.newPage()); let serviceView;
  const assertHealthy = () => {
    assert.deepEqual(errors, [], 'production_page_errors'); assert.deepEqual(unexpected, [], 'production_page_external_requests');
    assert.ok(responses.length > 0); assert.ok(responses.every(v => v.path && v.status === 200), 'production_asset_response_failed');
  };
  const readAsset = async url => {
    const response = await oldTab.evaluate(async path => {
      const r = await fetch(path, { cache: 'no-store' }); return { status: r.status, bytes: [...new Uint8Array(await r.arrayBuffer())], cache: r.headers.get('cache-control') };
    }, url);
    const expected = assets.material.find(v => v.url === url); assert.ok(expected);
    assert.equal(response.status, 200); assert.equal(createHash('sha256').update(Buffer.from(response.bytes)).digest('hex'), expected.sha256);
    assert.match(response.cache, /immutable/);
  };
  const login = async (version, width = 1280, keep = false) => {
    const page = keep ? oldTab : await track(await guest.newPage()); await page.setViewportSize({ width, height: 1000 }); await page.bringToFront();
    const response = await page.goto(origin + '/login?accountType=personal&loggedOut=1&uiLocale=zh-CN', { timeout: 90000, waitUntil: 'domcontentloaded' });
    assert.equal(response.status(), 200); assert.equal(response.headers()['x-owned-source-version'], version);
    const input = page.locator('input[autocomplete="username"]'); await input.waitFor({ state: 'visible', timeout: 20000 });
    await input.fill('owned-draft@example.invalid'); assert.equal(await input.inputValue(), 'owned-draft@example.invalid');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assertHealthy(); if (!keep) await page.close(); return page;
  };
  const original = async (version, width = 390, closed = false) => {
    if (serviceView && !serviceView.isClosed()) await serviceView.close();
    serviceView = await track(await context.newPage()); await serviceView.setViewportSize({ width, height: 1000 }); await serviceView.bringToFront();
    const response = await serviceView.goto(origin + servicePath + '?uiLocale=zh-CN', { timeout: 90000, waitUntil: 'domcontentloaded' });
    assert.equal(response.status(), 200); assert.equal(response.headers()['x-owned-source-version'], version);
    const panel = serviceView.locator('[data-original-service]'); await panel.locator('article').waitFor({ state: 'visible', timeout: 20000 });
    if (closed) await panel.getByRole('status').filter({ hasText: '原单已取消' }).waitFor({ timeout: 15000 });
    else {
      const button = panel.getByRole('button', { name: '按原规则取消原单', exact: true }); assert.equal(await button.isEnabled(), false);
      await panel.getByRole('checkbox').check(); assert.equal(await button.isEnabled(), true); await panel.getByRole('checkbox').uncheck();
    }
    assert.equal(await serviceView.evaluate(() => document.documentElement.scrollWidth > innerWidth), false); assertHealthy(); return panel;
  };
  return {
    login, original,
    async oldBeforeCutover(version) { await login(version, 1280, true); evidence.productionPages = { oldLoginInteractive: true, serviceWorkerCacheTested: false }; },
    async candidateEntered(version) {
      await login(version, 390); await original(version, 1280);
      assert.equal(await oldTab.locator('input[autocomplete="username"]').inputValue(), 'owned-draft@example.invalid');
      const oldAsset = assets.material.find(v => v.owners.length === 1 && v.owners[0] === 'old' && v.url.endsWith('.js'));
      assert.ok(oldAsset); await readAsset(oldAsset.url); evidence.productionPages.oldAssetsAfterCandidate = true;
    },
    async retained(version, oldVersion) {
      await login(oldVersion, 390); await original(version, 390);
      const candidateAsset = assets.material.find(v => v.owners.length === 1 && v.owners[0] === 'candidate' && v.url.endsWith('.js'));
      assert.ok(candidateAsset); await readAsset(candidateAsset.url); evidence.productionPages.candidateAssetsAfterRollback = true;
    },
    async loseCancellation() {
      assert.ok(serviceView && !serviceView.isClosed()); await serviceView.bringToFront();
      const panel = serviceView.locator('[data-original-service]'); await panel.getByRole('checkbox').check();
      await panel.getByRole('button', { name: '按原规则取消原单', exact: true }).click();
      await panel.getByRole('alert').filter({ hasText: '取消结果尚未确认' }).waitFor({ timeout: 20000 });
      assert.equal(await panel.getByRole('button', { name: '按原规则取消原单', exact: true }).isEnabled(), false);
      await panel.getByRole('button', { name: '重新读取原单', exact: true }).click();
      await panel.getByRole('status').filter({ hasText: '原单已取消' }).waitFor({ timeout: 20000 }); assertHealthy();
      evidence.productionPages.actualUiLostReplyRecovered = true;
    },
    async resumed(version) {
      await original(version, 1280, true); await original(version, 390, true); assertHealthy();
      evidence.productionPages.checkedAssetResponses = responses.length; evidence.productionPages.browserErrors = errors.length;
      evidence.productionPages.unexpectedRequests = unexpected.length; evidence.productionPages.passed = true;
    },
  };
}
