// Actual browser protocol diagnostic, owned loopback only. No app/auth override.
import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import { chromium } from 'playwright';

test('document no-referrer hides Referer but retains actual same-origin POST Origin', { timeout: 30000 }, async () => {
  let origin;
  const observed = [];
  const server = http.createServer((req, res) => {
    if (req.url === '/capture' && req.method === 'POST') {
      observed.push({ origin: req.headers.origin, referer: req.headers.referer });
      req.resume(); res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}'); return;
    }
    const policy = req.url === '/private' ? 'no-referrer' : 'same-origin';
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'referrer-policy': policy });
    res.end('<!doctype html><meta name="referrer" content="' + policy + '"><p>Owned diagnostic</p>');
  });
  let browser;
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    origin = 'http://127.0.0.1:' + server.address().port;
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ serviceWorkers: 'block' });
    await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    const page = await context.newPage();
    for (const path of ['/private', '/same-origin']) {
      await page.goto(origin + path);
      assert.equal(await page.evaluate(async () => (await fetch('/capture', { method: 'POST', credentials: 'same-origin', cache: 'no-store',
        headers: { 'content-type': 'application/json', 'x-checkout-account-scope': '59000001' }, body: '{"owned":true}' })).status), 200);
    }
    assert.deepEqual(observed, [{ origin, referer: undefined }, { origin, referer: origin + '/same-origin' }]);
  } finally {
    await browser?.close(); server.closeAllConnections(); if (server.listening) await new Promise(resolve => server.close(resolve));
  }
});
