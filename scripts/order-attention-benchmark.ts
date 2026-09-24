/**
 * OFFLINE synthetic acceptance only. No network, database, credentials or writes.
 * Run: node --expose-gc --import tsx scripts/order-attention-benchmark.ts
 * Optional: --samples=12 (1..20). p95/p99 with few samples are descriptive only.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { cpus, platform, release, totalmem } from "node:os";
import { performance } from "node:perf_hooks";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import {
  parseMerchantOrderAttentionSummary,
  type MerchantOrderAttentionSummary,
} from "../src/lib/merchantOrderAttention";
import {
  buildMerchantOrderAttentionProjection,
  MERCHANT_ORDER_ATTENTION_MAX_SOURCE_BYTES,
} from "../src/lib/merchantOrderAttentionProjection";
import { formatMerchantOrderAmount, isMerchantOrderNewForMerchant, type MerchantOrderRecord } from "../src/lib/merchantOrders";
import { mergeStoredMerchantOrdersRows } from "../src/lib/merchantOrdersStore";
import { formatSupportConversationPreview } from "../src/lib/supportMessageAttachments";

const SITE = "10000000";
const CHUNK_SIZE = 100;
const READY_BATCH_SIZE = 100;
const args = process.argv.slice(2);
if (args.length > 1 || (args.length === 1 && !/^--samples=(?:[1-9]|1\d|20)$/.test(args[0]))) {
  throw new Error("Usage: order-attention-benchmark.ts [--samples=1..20]");
}
const sampleCount = args.length ? Number(args[0].split("=")[1]) : 12;
const collectGarbage = (globalThis as typeof globalThis & { gc?: () => void }).gc;

function loadActualLegacyReducer() {
  // Extract only the actual current AdminClient functions, not the component or
  // a copied benchmark oracle. Keep independent of the new summary reducer.
  const path = resolve(process.cwd(), "src/app/admin/AdminClient.tsx");
  const source = readFileSync(path, "utf8");
  const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const names = [
    "normalizeSupportDetailText", "normalizeSupportDisplayValue", "normalizeSupportMessageTimestamp",
    "normalizeMerchantBusinessAttentionTimestamp", "buildSupportNativeNotificationBody",
    "buildMerchantBusinessNotificationUrl", "compareMerchantBusinessAttentionNotification",
    "summarizeMerchantOrderAttentionRecords",
  ];
  const functions = names.map((name) => {
    const node = ast.statements.find((statement) => ts.isFunctionDeclaration(statement) && statement.name?.text === name);
    if (!node) throw new Error(`Legacy oracle function missing: ${name}; update this offline benchmark explicitly.`);
    return node.getText(ast);
  }).join("\n");
  const javascript = ts.transpileModule(`${functions}\n;globalThis.summarize = summarizeMerchantOrderAttentionRecords;`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  const context: Record<string, unknown> = {
    formatMerchantOrderAmount, isMerchantOrderNewForMerchant, formatSupportConversationPreview,
  };
  runInNewContext(javascript, context, { timeout: 1000 });
  return {
    summarize: context.summarize as (records: MerchantOrderRecord[], siteId: string) => MerchantOrderAttentionSummary,
    sourceSha256: createHash("sha256").update(functions).digest("hex"),
  };
}

function makeRows(count: number) {
  const orders = Array.from({ length: count }, (_, index) => ({
    id: `synthetic-${String(index).padStart(6, "0")}`, siteId: SITE,
    status: index % 5 === 0 ? "completed" : "pending",
    merchantTouchedAt: index % 7 === 0 ? "2026-09-24T10:00:00.000Z" : "",
    createdAt: `2026-09-${String(1 + index % 23).padStart(2, "0")}T09:00:00.000Z`,
    updatedAt: `2026-09-${String(1 + (index * 7) % 23).padStart(2, "0")}T10:00:00.000Z`,
    customer: { name: `Synthetic ${index}` },
    items: [{ productId: `p${index % 20}`, name: `Product ${index % 20}`, quantity: index % 4 + 1, unitPrice: 1.239 }],
    pricePrefix: "€",
  }));
  return Array.from({ length: Math.ceil(count / CHUNK_SIZE) }, (_, index) => ({
    id: String(index), merchant_id: SITE, slug: `__merchant_orders__:${SITE}:chunk:${String(index).padStart(5, "0")}`,
    blocks: orders.slice(index * CHUNK_SIZE, (index + 1) * CHUNK_SIZE), updated_at: "2026-09-24T10:00:00.000Z",
  }));
}

function stats(values: number[]) {
  const sorted = [...values].sort((left, right) => left - right);
  const at = (percentile: number) => Number(sorted[Math.max(0, Math.ceil(sorted.length * percentile) - 1)].toFixed(6));
  return { samples: sorted.length, p50Ms: at(0.5), p95Ms: at(0.95), p99Ms: at(0.99) };
}

function timed<T>(run: () => T) {
  collectGarbage?.();
  const before = process.memoryUsage();
  const started = performance.now();
  const result = run();
  const elapsed = performance.now() - started;
  const after = process.memoryUsage();
  return { result, elapsed, heapDeltaAfterCall: after.heapUsed - before.heapUsed, rssAfterCall: after.rss };
}

const legacy = loadActualLegacyReducer();
const results = [];
for (const count of [100, 1000, 10000, 20000]) {
  const rows = makeRows(count);
  const sourceBytes = Buffer.byteLength(JSON.stringify(rows));
  assert.ok(sourceBytes <= MERCHANT_ORDER_ATTENTION_MAX_SOURCE_BYTES, "Synthetic fixture must fit pilot source bound");
  const full = () => {
    const records = mergeStoredMerchantOrdersRows(SITE, rows)?.orders ?? [];
    return legacy.summarize(records, SITE);
  };
  const project = () => {
    const projected = buildMerchantOrderAttentionProjection(rows, SITE);
    if (!projected.supported) throw new Error(`Unsupported synthetic projection: ${projected.reason}`);
    return projected.attention;
  };
  const expectedJson = JSON.stringify(full());
  const attention = project();
  assert.equal(JSON.stringify(attention), expectedJson, "Complete notification/count parity, not just badge counts");
  const serialized = JSON.stringify(attention);
  const legacyResponseBytes = Buffer.byteLength(JSON.stringify({ ok: true, orders: mergeStoredMerchantOrdersRows(SITE, rows)?.orders ?? [] }));
  for (let warm = 0; warm < 2; warm += 1) {
    assert.equal(JSON.stringify(full()), expectedJson);
    assert.equal(JSON.stringify(project()), expectedJson);
  }
  const projectionTimes: number[] = [];
  const legacyTimes: number[] = [];
  const readyTimes: number[] = [];
  let maxHeapDeltaAfterProjection = 0;
  let maxRssAfterProjection = 0;
  for (let sample = 0; sample < sampleCount; sample += 1) {
    // Alternating non-overlapping runs reduce ordering bias. GC is outside time.
    for (const kind of sample % 2 === 0 ? ["projection", "legacy"] : ["legacy", "projection"]) {
      const measured = timed(kind === "projection" ? project : full);
      assert.equal(JSON.stringify(measured.result), expectedJson);
      if (kind === "projection") {
        projectionTimes.push(measured.elapsed);
        maxHeapDeltaAfterProjection = Math.max(maxHeapDeltaAfterProjection, measured.heapDeltaAfterCall);
        maxRssAfterProjection = Math.max(maxRssAfterProjection, measured.rssAfterCall);
      } else legacyTimes.push(measured.elapsed);
    }
    const ready = timed(() => {
      let parsed: MerchantOrderAttentionSummary | null = null;
      for (let index = 0; index < READY_BATCH_SIZE; index += 1) {
        parsed = parseMerchantOrderAttentionSummary(JSON.parse(serialized), SITE);
      }
      return parsed;
    });
    assert.equal(JSON.stringify(ready.result), expectedJson);
    readyTimes.push(ready.elapsed / READY_BATCH_SIZE);
  }
  results.push({
    syntheticOrders: count, sourceRows: rows.length, sourceBytes, completeLegacyParity: true,
    legacyFullMergeAndActualUiReducer: stats(legacyTimes), dirtyProjection: stats(projectionTimes),
    readyJsonParseAndPayloadGuardPerOperation: stats(readyTimes),
    readyBatchSize: READY_BATCH_SIZE,
    memory: {
      maxHeapDeltaAfterProjectionBytes: maxHeapDeltaAfterProjection,
      maxProcessRssAfterProjectionBytes: maxRssAfterProjection,
      note: "After-call heap/RSS observations, not allocation counts, retained memory, or peak memory.",
    },
    responseBytes: { legacyOrders: legacyResponseBytes, attention: Buffer.byteLength(JSON.stringify({ ok: true, attention })) },
  });
}

console.log(JSON.stringify({
  scope: "OFFLINE_SYNTHETIC_PURE_FUNCTION_ONLY",
  excludes: ["Database ready read", "RPC", "HTTP/network", "auth", "browser", "concurrent load", "production capacity"],
  timingNotes: "2 warmups; sequential alternating runs; GC outside timer when exposed; <=20 samples. Ready stats are batch-mean per-op, not individual-request tails. p95/p99 are descriptive, not SLA estimates.",
  environment: { node: process.version, platform: platform(), osRelease: release(), cpu: cpus()[0]?.model, logicalCpus: cpus().length, ramBytes: totalmem(), forcedGc: Boolean(collectGarbage) },
  oracle: { source: "Actual AdminClient.tsx named functions + existing mergeStoredMerchantOrdersRows", sha256: legacy.sourceSha256 },
  results,
}, null, 2));
