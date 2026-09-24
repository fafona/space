import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { compile } from '@tailwindcss/node';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const entry = path.join(root, 'scripts/fixtures/performance-bounded-lists-browser.tsx');
const bundle = await build({ absWorkingDir: root, entryPoints: [entry], bundle: true, write: false,
  format: 'esm', platform: 'browser', target: ['es2020'], jsx: 'automatic', tsconfig: path.join(root, 'tsconfig.json'),
  define: { 'process.env.NODE_ENV': '"development"' }, logLevel: 'warning',
});
const candidates = new Set();
for (const file of [entry, 'src/components/admin/MerchantCatalogManagerPanel.tsx', 'src/components/admin/MerchantCatalogProductList.tsx', 'src/components/admin/MerchantCustomerManager.tsx']) {
  const ast = ts.createSourceFile(file, await readFile(path.resolve(root, file), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  function visit(node) {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) node.text.split(/\s+/).filter(Boolean).forEach(c => candidates.add(c));
    ts.forEachChild(node, visit);
  }
  visit(ast);
}
const css = (await compile('@import "tailwindcss";', { base: root, onDependency: () => {} })).build([...candidates]) + '\nbody{margin:0;background:#f1f5f9;color:#0f172a;font-family:Arial,sans-serif}.qa-toolbar{padding:16px;background:#fff7ed}.qa-toolbar button{border:1px solid #94a3b8;border-radius:6px;padding:6px;background:white}';
function catalog(site) {
  return { revision: 1, updatedAt: '2026-09-25T00:00:00Z', pricePrefix: '€',
    products: Array.from({ length: 1000 }, (_, i) => ({ id: `${site}-p${i+1}`, name: `模拟商品 ${i+1}`, code: `CODE-${i+1}`, tag: '', description: `商品 ${i+1} 的说明`, price: '12.50', imageUrl: '', thumbnailUrl: '', availability: 'available' })),
    categories: [{ id: 'category-a', name: '模拟分类', productIds: [`${site}-p1`, `${site}-p999`] }],
    collections: [{ id: 'collection-a', blockId: 'qa-block', viewport: 'shared', productIds: [`${site}-p1`, `${site}-p999`] }],
  };
}
function customers(siteId) {
  return Array.from({ length: 123 }, (_, i) => ({ id: `${siteId}-c${i+1}`, siteId, referenceCode: `QA-${i+1}`, memberNo: '', accountId: '', authUserId: '', guestHash: '',
    displayName: `模拟客户 ${i+1}`, phone: '+00 000 000 000', email: `synthetic-${i+1}@example.test`, birthday: '', gender: '',
    address: { country: 'QA', province: 'Synthetic', city: 'Test', postalCode: '', line1: '', line2: '' },
    tax: { name: '', number: '', country: '', province: '', city: '', address: '' }, allergens: [], tags: [], notes: '', customFields: {}, identityAliases: [],
    sources: i % 2 ? ['booking'] : ['order'], status: 'active', createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z',
    activity: { orderCount: i % 2 ? 0 : 1, bookingCount: i % 2, firstActivityAt: '', lastActivityAt: '', lastOrderAt: null, lastBookingAt: null, lastOrderNote: '', lastBookingNote: '', orderTotals: [] }, incomplete: false,
  }));
}
const port = 3120;
const server = createServer((request, response) => {
  if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(request.headers.host)) return response.writeHead(403).end();
  const url = new URL(request.url || '/', `http://127.0.0.1:${port}`);
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data: blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
  const send = (status, type, body) => response.writeHead(status, { 'Content-Type': type }).end(body);
  if (request.method !== 'GET') return send(403, 'application/json', JSON.stringify({ error: 'qa_read_only', message: '隔离测试禁止写入' }));
  if (url.pathname === '/') return send(200, 'text/html; charset=utf-8', '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Faolla bounded lists QA</title><link rel="stylesheet" href="/harness.css"><div id="qa-root"></div><script type="module" src="/harness.js"></script></html>');
  if (url.pathname === '/harness.css') return send(200, 'text/css', css);
  if (url.pathname === '/harness.js') return send(200, 'text/javascript', bundle.outputFiles[0].contents);
  const site = url.searchParams.get('siteId');
  if (!['qa-merchant-a', 'qa-merchant-b'].includes(site)) return send(400, 'application/json', '{}');
  if (url.pathname === '/api/orders/catalog') return send(200, 'application/json', JSON.stringify({ ok: true, catalog: catalog(site) }));
  if (url.pathname === '/api/merchant-customers') return send(200, 'application/json', JSON.stringify({ ok: true, customers: customers(site), version: 'qa-v1', warnings: [] }));
  return send(404, 'text/plain', 'Not found');
});
server.listen(port, '127.0.0.1', () => console.log(`Synthetic read-only QA http://127.0.0.1:${port}`));
