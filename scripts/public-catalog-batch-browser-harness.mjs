import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { compile } from '@tailwindcss/node';
import { require as tsxRequire } from 'tsx/cjs/api';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = 3123;
const origin = `http://127.0.0.1:${port}`;
const entry = path.join(root, 'scripts/fixtures/public-catalog-batch-browser.tsx');
// Route dependencies are entirely synthetic. An accidental network dependency fails closed.
globalThis.fetch = async () => { throw new Error('Synthetic catalog harness prohibits outbound requests'); };
const { handleMerchantCatalogPublicGet } = tsxRequire('../src/app/api/orders/catalog/public/route-handler.ts', import.meta.url);
const { handleMerchantCatalogPublicPost } = tsxRequire('../src/app/api/orders/catalog/public/batch-route-handler.ts', import.meta.url);
const nonTargetBlocks = /^(\.\/)(HeroBlock|TextBlock|ListBlock|SearchBarBlock|MerchantListBlock|CommonBlock|NavBlock|GalleryBlock|ChartBlock|MusicBlock|ContactBlock|CouponBlock|GoogleReviewsBlock|BookingBlock|PollBlock)$/;
const bundle = await build({
  absWorkingDir: root, entryPoints: [entry], bundle: true, write: false, format: 'esm', platform: 'browser',
  target: ['es2020'], jsx: 'automatic', tsconfig: path.join(root, 'tsconfig.json'),
  define: { 'process.env.NODE_ENV': '"development"' }, logLevel: 'warning',
  plugins: [{ name: 'isolated-next-adapters', setup(buildApi) {
    buildApi.onResolve({ filter: /^next\/(dynamic|image)$/ }, (args) => ({ path: args.path, namespace: 'qa-next' }));
    buildApi.onLoad({ filter: /.*/, namespace: 'qa-next' }, (args) => ({
      loader: 'js', resolveDir: root,
      contents: args.path === 'next/dynamic'
        ? 'import {lazy,Suspense,createElement} from "react"; export default function dynamic(load,opts){const View=lazy(load);return function Dynamic(props){return createElement(Suspense,{fallback:opts?.loading?createElement(opts.loading):null},createElement(View,props));}}'
        : 'import {createElement} from "react";export default function Image({fill,priority,unoptimized,loader,quality,...props}){return createElement("img",props);}',
    }));
    buildApi.onResolve({ filter: nonTargetBlocks }, (args) => args.importer.endsWith('BlockRenderer.tsx')
      ? { path: args.path, namespace: 'qa-unused-block' } : null);
    buildApi.onLoad({ filter: /.*/, namespace: 'qa-unused-block' }, () => ({ contents: 'export default function UnusedBlock(){return null;}', loader: 'js' }));
  } }],
});
const candidates = new Set();
for (const file of [entry, 'src/components/blocks/BlockRenderer.tsx', 'src/components/blocks/ProductBlock.tsx', 'src/components/blocks/ButtonBlock.tsx', 'src/lib/productBlock.ts']) {
  const source = ts.createSourceFile(file, await readFile(path.resolve(root, file), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  function visit(node) {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      node.text.split(/\s+/).filter(Boolean).forEach((candidate) => candidates.add(candidate));
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
}
const css = (await compile('@import "tailwindcss";', { base: root, onDependency: () => {} })).build([...candidates]) + `
body{margin:0;background:#f1f5f9;color:#0f172a;font-family:Arial,sans-serif}.qa-toolbar{position:sticky;top:0;z-index:100000;background:#fff7ed;padding:12px;border-bottom:2px solid #fb923c}.qa-toolbar button{background:white;border:1px solid #94a3b8;border-radius:6px;padding:5px 10px}.qa-controls{display:flex;gap:6px;flex-wrap:wrap;margin:8px 0}.qa-metrics{font:12px monospace;max-height:140px;overflow:auto;white-space:pre-wrap}.qa-main{max-width:1050px;margin:auto;padding:12px}.qa-main [data-block-id]{margin:12px 0}.qa-main section{background:white;min-height:180px}.qa-toolbar button[aria-pressed=true]{background:#bfdbfe}.qa-status{font-size:13px;margin-top:6px}
`;
const storageBootstrap = `for(const name of ['localStorage','sessionStorage']){const values=new Map();Object.defineProperty(window,name,{configurable:true,value:{get length(){return values.size},clear(){values.clear()},getItem(key){return values.get(String(key))??null},setItem(key,value){values.set(String(key),String(value))},removeItem(key){values.delete(String(key))},key(index){return [...values.keys()][index]??null}}});}`;
const metrics = { post: 0, get: 0, bytes: 0, rejectedWrites: 0, snapshot: 0, catalog: 0, published: 0, requests: [] };
let forceError = false;
function catalog(siteId, snapshot) {
  const products = Array.from({ length: 5 }, (_, index) => ({
    id: `p${index + 1}`, code: `QA-${index + 1}`, name: `${siteId === '99990001' ? '商户甲' : '商户乙'} 模拟商品 ${index + 1} · 快照 ${snapshot}`,
    description: '仅隔离浏览器测试；价格与数据均为合成。', price: index === 0 ? '12.50' : '8.00',
    imageUrl: '', thumbnailUrl: '', tag: '', availability: 'available',
  }));
  return { revision: snapshot, updatedAt: '2026-09-25T12:00:00Z', pricePrefix: '€', products,
    categories: [{ id: 'group', name: '模拟分类', productIds: products.map((product) => product.id) }],
    collections: ['inline-a', 'inline-b', 'inline-c', 'modal-products'].flatMap((blockId, index) => ['desktop', 'mobile'].map((viewport) => ({
      id: `${blockId}-${viewport}`, blockId, viewport, productIds: viewport === 'mobile' ? ['p3', 'p4'] : [`p${index % 3 + 1}`, 'p2'],
      browsingRules: { searchEnabled: true, searchPlaceholder: `${viewport} 搜索`, hideUnselectedCategory: false, groupByCategory: false },
    }))),
  };
}
const allowedSites = new Set(['99990001', '99990002']);
const dependencies = {
  loadSnapshotSite: async (siteId) => { if (!allowedSites.has(siteId)) throw new Error('synthetic_site_only'); metrics.snapshot++; return { permissionConfig: { allowProductBlock: true, allowOrderManagement: true } }; },
  loadCatalog: async (siteId) => { if (!allowedSites.has(siteId)) throw new Error('synthetic_site_only'); metrics.catalog++; return catalog(siteId, metrics.catalog); },
  fetchPublishedBlocks: async (siteId) => {
    if (!allowedSites.has(siteId)) throw new Error('synthetic_site_only');
    metrics.published++;
    return { blocks: ['inline-a', 'inline-b', 'inline-c', 'modal-products'].map((id) => ({ id, type: 'product', props: {} })) };
  },
};
const server = createServer(async (request, response) => {
  if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(request.headers.host)) return response.writeHead(403).end();
  const url = new URL(request.url || '/', origin);
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data: blob:; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
  const send = (status, type, body) => response.writeHead(status, { 'Content-Type': type }).end(body);
  if ((url.pathname === '/api/orders/catalog/public' && request.method === 'GET') ||
      (url.pathname === '/api/orders/catalog/public/batch' && request.method === 'POST')) {
    try {
      const chunks = []; let bytes = 0;
      for await (const chunk of request) { bytes += chunk.length; if (bytes > 65536) return send(413, 'application/json', '{"error":"qa_body_limit"}'); chunks.push(chunk); }
      const body = request.method === 'POST' ? Buffer.concat(chunks).toString('utf8') : undefined;
      metrics[request.method === 'POST' ? 'post' : 'get']++;
      metrics.requests.push({ method: request.method, scope: body ? JSON.parse(body) : Object.fromEntries(url.searchParams) });
      if (forceError) return send(503, 'application/json', '{"error":"qa_deliberate_catalog_error"}');
      const fixtureRequest = new Request(url, { method: request.method, headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body }) });
      const result = request.method === 'POST' ? await handleMerchantCatalogPublicPost(fixtureRequest, dependencies) : await handleMerchantCatalogPublicGet(fixtureRequest, dependencies);
      const text = await result.text(); metrics.bytes += Buffer.byteLength(text);
      return send(result.status, 'application/json; charset=utf-8', text);
    } catch { return send(500, 'application/json', '{"error":"qa_catalog_handler_failed"}'); }
  }
  if (request.method !== 'GET') { metrics.rejectedWrites++; return send(403, 'application/json', '{"error":"qa_writes_forbidden"}'); }
  if (url.pathname === '/') return send(200, 'text/html; charset=utf-8', '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Faolla public catalog isolated QA</title><link rel="stylesheet" href="/harness.css"><script src="/storage.js"></script><div id="qa-root"></div><script type="module" src="/harness.js"></script></html>');
  if (url.pathname === '/harness.js') return send(200, 'text/javascript', bundle.outputFiles[0].contents);
  if (url.pathname === '/harness.css') return send(200, 'text/css', css);
  if (url.pathname === '/storage.js') return send(200, 'text/javascript', storageBootstrap);
  if (url.pathname === '/qa/metrics') return send(200, 'application/json', JSON.stringify({ ...metrics, forceError }));
  if (url.pathname === '/qa/control') { forceError = url.searchParams.get('error') === '1'; return send(200, 'application/json', JSON.stringify({ forceError })); }
  return send(403, 'application/json', '{"error":"qa_unknown_route_forbidden"}');
});
server.listen(port, '127.0.0.1', () => console.log(`Synthetic real-component catalog QA ${origin}; production network and all writes forbidden`));
