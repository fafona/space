import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { build, stop } from 'esbuild';
import { chromium } from 'playwright';

// Runs in the existing Playwright CI job, not the browserless unit-test job.
// Actual Manager in Chromium; only HTTP/auth responses are synthetic. No DB,
// credentials, external requests, business writes or production navigation.
const owner = '10000000-0000-4000-8000-000000000001';
const other = '10000000-0000-4000-8000-000000000002';
const overview = {
  ok: true, currentAuthUserId: owner, needsBootstrap: false,
  actor: { type: 'owner', id: owner, siteId: '10000000', displayName: 'Synthetic owner',
    email: 'owner@example.test', permissions: [], accessScope: 'all', allowedBoardIds: [] },
  snapshot: { roles: [], employees: [], boards: [], columns: [], tasks: [] },
};

for (const width of [1440, 390]) test(`actual enterprise Manager renews expired cookie reads without losing verified identity (${width}px)`, { timeout: 90000 }, async () => {
  let server, browser, context, origin, bundle;
  let expired = true, sessionStatus = 200, sessionUser = owner, renewals = 0, overviews = 0;
  const requests = [], errors = [];
  try {
    const result = await build({ absWorkingDir: process.cwd(), stdin: {
      contents: `import {createRoot} from 'react-dom/client';
        import Manager from './src/components/admin/MerchantEnterpriseManager';
        createRoot(document.getElementById('root')).render(<Manager siteId="10000000" siteName="Synthetic enterprise" collaborationRefreshIntervalMs={240000}/>);`,
      resolveDir: process.cwd(), sourcefile: 'session-browser-entry.tsx', loader: 'tsx',
    }, bundle: true, write: false, outfile: 'app.js', platform: 'browser', format: 'esm', jsx: 'automatic',
      define: { 'process.env': '{}', 'process.env.NODE_ENV': '"test"' }, logLevel: 'silent' });
    bundle = result.outputFiles.find(file => file.path.endsWith('.js')).contents;
    server = createServer((req, res) => {
      const url = new URL(req.url, origin);
      res.setHeader('Cache-Control', 'no-store');
      if (url.pathname === '/') return res.writeHead(200, { 'Content-Type': 'text/html;charset=utf-8' })
        .end('<!doctype html><meta charset="utf-8"><div id="root"></div><script type="module" src="/app.js"></script>');
      if (url.pathname === '/app.js') return res.writeHead(200, { 'Content-Type': 'text/javascript' }).end(bundle);
      if (url.pathname === '/favicon.ico') return res.writeHead(204).end();
      requests.push({ path: url.pathname, method: req.method });
      assert.equal(req.method, 'GET', 'browser check must never write');
      res.setHeader('Content-Type', 'application/json');
      if (url.pathname === '/api/auth/merchant-session') {
        renewals++;
        if (sessionStatus === 200) expired = false;
        return res.writeHead(sessionStatus).end(JSON.stringify(sessionStatus === 200
          ? { authenticated: true, user: { id: sessionUser } } : { authenticated: false }));
      }
      if (url.pathname === '/api/merchant-enterprise/overview') {
        overviews++;
        const expected = req.headers['x-merchant-expected-auth-user-id'];
        if (expected && expected !== sessionUser) return res.writeHead(401).end('{"ok":false,"error":"unauthorized"}');
        return res.writeHead(expired ? 401 : 200).end(JSON.stringify(expired ? { ok: false, error: 'unauthorized' } : overview));
      }
      if (url.pathname === '/api/merchant-enterprise/current-operations') return res.writeHead(503).end('{"ok":false}');
      errors.push('unknown_local_path:' + url.pathname);
      return res.writeHead(404).end('{}');
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    origin = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ headless: true });
    context = await browser.newContext({ serviceWorkers: 'block', viewport: { width, height: 900 } });
    await context.route('**/*', route => {
      if (new URL(route.request().url()).origin !== origin) { errors.push('external_request'); return route.abort(); }
      return route.continue();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(8000);
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin);
    const refresh = page.getByRole('button', { name: '刷新数据', exact: true });
    await Promise.race([refresh.waitFor(), page.getByRole('region', { name: '企业身份需重新核验' }).waitFor()]);
    assert.deepEqual(errors, []);
    assert.equal(await page.getByText('登录状态已失效，请重新登录。', { exact: true }).count(), 0,
      'valid long-lived cookie session must not be rejected solely because its short-lived access token expired');
    await refresh.waitFor();
    assert.equal(renewals, 1, 'expired initial read must renew instead of displaying signed-out boundary');
    assert.equal(overviews, 2);
    assert.equal(await page.getByRole('region', { name: '企业身份需重新核验' }).count(), 0);

    // Same verified identity must not unmount the protected subtree.
    await refresh.evaluate(element => { element.dataset.syntheticIdentityMarker = 'retained'; });
    expired = true;
    await refresh.click();
    await page.waitForFunction(() => ![...document.querySelectorAll('button')].some(b => b.textContent === '刷新中…'));
    assert.equal(renewals, 2);
    assert.equal(overviews, 4);
    assert.equal(await refresh.getAttribute('data-synthetic-identity-marker'), 'retained');
    assert.equal(await page.getByRole('region', { name: '企业身份需重新核验' }).count(), 0);

    // Temporary refresh failure must not masquerade as a signed-out account.
    expired = true; sessionStatus = 503;
    await refresh.click();
    await page.getByText('登录服务暂时不可用，请稍后重试。', { exact: true }).waitFor();
    assert.equal(await page.getByText('登录状态已失效，请重新登录。', { exact: true }).count(), 0);
    assert.equal(await refresh.count(), 1);

    // A genuinely different account must never inherit the old protected tree.
    sessionStatus = 200; sessionUser = other;
    await refresh.click();
    await page.getByRole('region', { name: '企业身份需重新核验' }).waitFor();
    assert.equal(await refresh.count(), 0);
    assert.equal(overviews, 6, 'different-account renewal must not replay the old overview');

    // A genuinely revoked session remains denied after the real recheck
    // button. Wait on the handled status/UI, not an unconsumed 401 body.
    expired = true; sessionStatus = 401;
    const denied = page.waitForResponse(response => new URL(response.url()).pathname === '/api/auth/merchant-session', { timeout: 8000 });
    await page.getByRole('button', { name: '重新核验企业身份', exact: true }).click();
    assert.equal((await denied).status(), 401);
    await page.getByRole('region', { name: '企业身份需重新核验' }).waitFor();
    assert.equal(await refresh.count(), 0);
    assert.equal(renewals, 5);

    assert.deepEqual(errors, []);
    assert(requests.every(r => r.method === 'GET'));
  } finally {
    await Promise.allSettled([context?.close(), browser?.close()]);
    server?.closeAllConnections();
    if (server?.listening) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    stop();
  }
});
