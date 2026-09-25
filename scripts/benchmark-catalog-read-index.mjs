// Offline synthetic CPU/operation-count comparison. No network or saved data.
// Run: node --import tsx scripts/benchmark-catalog-read-index.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';

// The application TS modules are CommonJS under its package configuration.
const require = createRequire(import.meta.url);
const pagePlans = require('../src/lib/pagePlans.ts');
const productBlock = require('../src/lib/productBlock.ts');
const merchantCatalog = require('../src/lib/merchantCatalog.ts');
const merchantPolls = require('../src/lib/merchantPolls.ts');
const { resolveTrafficResources } = require('../src/lib/accountTrafficResources.server.ts');

if (process.argv.length !== 2) throw Error('usage: node --import tsx scripts/benchmark-catalog-read-index.mjs');
const baseline = '85f8e402677c1038d918bcc81c3f4373c79d53a5';
const root = fileURLToPath(new URL('..', import.meta.url));
const source = execFileSync('git', ['show', `${baseline}:src/lib/accountTrafficResources.server.ts`], {
  cwd: root, encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024,
});
const dependencies = {
  '@/lib/pagePlans': pagePlans,
  '@/lib/productBlock': productBlock,
  '@/lib/merchantCatalog': merchantCatalog,
  '@/lib/merchantPolls': merchantPolls,
};
const baselineModule = { exports: {} };
vm.runInNewContext(ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, {
  module: baselineModule, exports: baselineModule.exports,
  require(name) {
    if (!Object.hasOwn(dependencies, name)) throw Error(`unexpected_baseline_import:${name}`);
    return dependencies[name];
  },
}, { filename: 'frozen-baseline-resource-resolver.cjs', timeout: 1000 });
const legacyResolve = baselineModule.exports.resolveTrafficResources;

function fixture(productCount, blockCount) {
  const products = Array.from({ length: productCount }, (_, i) => ({
    id: `p${i}`, name: `Synthetic product ${i}`, price: '1.25',
    availability: i % 11 === 0 ? 'hidden' : 'available',
  }));
  const blocks = Array.from({ length: blockCount }, (_, i) => ({
    id: `block${i}`, type: 'product', props: { heading: `Synthetic block ${i}`, products: [] },
  }));
  const catalog = merchantCatalog.normalizeMerchantCatalog({
    revision: 1, updatedAt: '2026-09-25T00:00:00.000Z', pricePrefix: 'EUR', products,
    collections: blocks.map(block => ({
      id: `collection-${block.id}`, blockId: block.id, viewport: 'shared',
      // Reversed membership order checks that output retains catalog order.
      productIds: products.map(product => product.id).reverse(),
    })),
  });
  assert.equal(merchantCatalog.getMerchantCatalogValidationError(catalog), null);
  assert.ok(merchantCatalog.parseStrictMerchantCatalog(catalog));
  const bytes = Buffer.byteLength(JSON.stringify(catalog));
  const input = {
    siteId: '10000000', pageId: 'page-1', viewport: 'desktop', catalog,
    blocks: [{ ...blocks[0], props: { ...blocks[0].props, pagePlanConfig: {
      activePlanId: 'plan-1', plans: [{
        id: 'plan-1', name: 'Synthetic plan', activePageId: 'page-1', blocks,
        pages: [{ id: 'page-1', name: 'Synthetic page', blocks }],
      }],
    } } }],
  };
  return { input, bytes };
}

function countedRun(resolve, input) {
  let priceReads = 0;
  const counted = {
    ...input,
    catalog: { ...input.catalog, products: input.catalog.products.map(product => ({
      ...product, get price() { priceReads += 1; return product.price; },
    })) },
  };
  const result = resolve(counted);
  return { result, priceReads };
}

function elapsed(resolve, input) {
  const start = performance.now();
  resolve(input);
  return performance.now() - start;
}
function median(samples) {
  return Number([...samples].sort((a, b) => a - b)[Math.floor(samples.length / 2)].toFixed(3));
}

const results = [];
for (const [productCount, blockCount] of [[100, 1], [1000, 5], [1000, 20]]) {
  const { input, bytes } = fixture(productCount, blockCount);
  const original = JSON.stringify(input);
  const before = countedRun(legacyResolve, input);
  const after = countedRun(resolveTrafficResources, input);
  assert.equal(JSON.stringify(after.result), JSON.stringify(before.result), 'ordered resource output changed');
  assert.equal(before.priceReads, productCount * blockCount, 'baseline no longer demonstrates repeated normalization');
  assert.equal(after.priceReads, productCount, 'prepared resolver must normalize once per call');
  const oldTimes = [], newTimes = [];
  // Warm both paths; alternate measurement order to reduce systematic JIT/GC bias.
  for (let i = 0; i < 2; i++) { legacyResolve(input); resolveTrafficResources(input); }
  for (let i = 0; i < 7; i++) {
    if (i % 2 === 0) { oldTimes.push(elapsed(legacyResolve, input)); newTimes.push(elapsed(resolveTrafficResources, input)); }
    else { newTimes.push(elapsed(resolveTrafficResources, input)); oldTimes.push(elapsed(legacyResolve, input)); }
  }
  assert.equal(JSON.stringify(input), original, 'source mutated');
  results.push({
    productCount, blockCount, serializedCatalogBytes: bytes, resourceCount: after.result.length,
    sameOrderedOutput: true, sourceUnchanged: true,
    normalizedProductReads: { before: before.priceReads, after: after.priceReads },
    cpuMillisecondsMedian: { before: median(oldTimes), after: median(newTimes) }, samplesPerPath: 7,
  });
}
console.log(JSON.stringify({
  baseline, baselineSourceSha256: createHash('sha256').update(source).digest('hex'),
  measurement: 'offline synthetic resource-resolution CPU only; not database, network or page-load latency',
  noNetworkOrSavedData: true, node: process.version, results,
}, null, 2));
