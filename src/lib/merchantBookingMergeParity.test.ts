import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { isDeepStrictEqual } from "node:util";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { mergeMerchantBookingPersistenceRecords } from "./merchantBookingPersistenceStore";

// Frozen from 473f1869; the four function hashes below also match the deployed
// 0004c202 source. This is not a second implementation of the optimization.
// The exercised merge functions do no IO; original record references are compared.
const legacyTimestamp = `function persistedRecordTimestamp(record: { updatedAt?: unknown; createdAt?: unknown }) {
  const timestamp = Date.parse(normalizeText(record.updatedAt) || normalizeText(record.createdAt));
  return Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY;
}`;
const legacyMerge = `export function mergeMerchantBookingPersistenceRecords<
  T extends { id?: unknown; updatedAt?: unknown; createdAt?: unknown },
>(localRecords: T[], remoteRecords: T[]) {
  const merged = new Map<string, T>();
  const recordsWithoutId: T[] = [];
  const mergeRecord = (record: T) => {
    const id = normalizeText(record?.id);
    if (!id) {
      if (!recordsWithoutId.some((current) => merchantBookingPersistenceValuesEqual(current, record))) {
        recordsWithoutId.push(record);
      }
      return;
    }
    const current = merged.get(id);
    if (!current || persistedRecordTimestamp(record) >= persistedRecordTimestamp(current)) {
      merged.set(id, record);
    }
  };
  localRecords.forEach(mergeRecord);
  remoteRecords.forEach(mergeRecord);
  return [...merged.values(), ...recordsWithoutId].sort(
    (left, right) => persistedRecordTimestamp(right) - persistedRecordTimestamp(left),
  );
}`;
const source = readFileSync(new URL("./merchantBookingPersistenceStore.ts", import.meta.url), "utf8").replaceAll("\r\n", "\n");
const ast = ts.createSourceFile("store.ts", source, ts.ScriptTarget.Latest, true);
function declaration(name: string) {
  const node = ast.statements.find((item): item is ts.FunctionDeclaration =>
    ts.isFunctionDeclaration(item) && item.name?.text === name);
  assert.ok(node, name);
  return node.getText(ast);
}
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const normalizeText = declaration("normalizeText");
const equality = declaration("merchantBookingPersistenceValuesEqual");
assert.equal(digest(normalizeText), "96556b47336eb94e355b8f1f69dc45dac42395a432f8420a9d2f617fa389ab66");
assert.equal(digest(equality), "2280de6ffedae35279db09dae4e43bc966fac4b8f264d641151e5c9e06533599");
assert.equal(digest(legacyTimestamp), "34ae73a057d68f6020d418d8e38a1b7df07430c4ed24dcea476ad078824f501c");
assert.equal(digest(legacyMerge), "4922ae23e11602b0e155183076e7771b00e7b63cdc630ab97950db56dd8d68e8");
type Merge = (local: unknown[], remote: unknown[]) => unknown[];
const current: Merge = mergeMerchantBookingPersistenceRecords as Merge;
function harness(legacy: boolean) {
  const calls: string[] = [];
  let cachedKeys = 0;
  let cachedCharacters = 0;
  class CountedMap extends Map<unknown, unknown> {
    set(key: unknown, value: unknown) {
      if (typeof key === "string" && typeof value === "number" && !this.has(key)) {
        cachedKeys++; cachedCharacters += key.length;
      }
      return super.set(key, value);
    }
  }
  class CountedDate extends Date {
    static parse(text: string) { calls.push(text); return Date.parse(text); }
  }
  const exports: { mergeMerchantBookingPersistenceRecords?: Merge } = {};
  const cacheConstants = ast.statements.filter((node) => ts.isVariableStatement(node) &&
    node.declarationList.declarations.some((item) =>
      ["MAX_MERGE_TIMESTAMP_CACHE_ENTRIES", "MAX_CACHED_MERGE_TIMESTAMP_LENGTH"].includes(item.name.getText(ast))))
    .map((node) => node.getText(ast)).join("\n");
  const text = [cacheConstants, normalizeText, equality,
    legacy ? legacyTimestamp : declaration("persistedRecordTimestamp"),
    legacy ? legacyMerge : declaration("mergeMerchantBookingPersistenceRecords")].join("\n");
  runInNewContext(ts.transpileModule(text, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, { exports, isDeepStrictEqual, Date: CountedDate, Map: CountedMap });
  assert.ok(exports.mergeMerchantBookingPersistenceRecords);
  return { merge: exports.mergeMerchantBookingPersistenceRecords, calls,
    cacheStats: () => ({ cachedKeys, cachedCharacters }) };
}
const previous = harness(true).merge;
function sameReferences(actual: unknown[], expected: unknown[]) {
  assert.equal(actual.length, expected.length);
  actual.forEach((record, index) => assert.equal(record, expected[index], `winner/reference ${index}`));
}
function parity(local: unknown[], remote: unknown[]) {
  const a = [...local]; const b = [...remote];
  const expected = previous(local, remote);
  const actual = current(local, remote);
  sameReferences(actual, expected);
  sameReferences(local, a); sameReferences(remote, b);
  return actual;
}

test("merge matches the frozen global-ID winner and stable tie order, including cross-merchant collisions", () => {
  const local = [
    { id: " shared ", siteId: "A", updatedAt: "2032-01-01T00:00:00Z", value: "old" },
    { id: "local", siteId: "A", updatedAt: "2032-01-01T00:00:00Z" },
    { id: "shared", siteId: "A", updatedAt: "2032-01-01T00:00:00Z", value: "last-local" },
  ];
  const remote = [
    { id: "remote", siteId: "B", updatedAt: "2032-01-01T00:00:00Z" },
    { id: "shared", siteId: "B", updatedAt: "2032-01-01T00:00:00Z", value: "last-remote" },
  ];
  sameReferences(parity(local, remote), [remote[1], local[1], remote[0]]);
});

test("newer local/remote winners and invalid dates preserve trim/OR/-Infinity semantics", () => {
  const local = [
    { id: "newest", updatedAt: "2032-04-01T00:00:00Z" },
    { id: "empty", updatedAt: " ", createdAt: "2032-03-01T00:00:00Z" },
    { id: "number", updatedAt: 123, createdAt: "2032-02-01T00:00:00Z" },
    { id: "invalid", updatedAt: "bad", createdAt: "2099-01-01T00:00:00Z" },
    { id: "missing" },
  ];
  const remote = [
    { id: "newest", updatedAt: "2032-01-01T00:00:00Z" },
    { id: "invalid", updatedAt: "different-bad" },
  ];
  sameReferences(parity(local, remote), [local[0], local[1], local[2], remote[1], local[4]]);
});

test("no-ID deduplication keeps deep equality, numeric IDs, arrays and original references", () => {
  const noId = { payload: { x: [1, null, "value"], y: false }, updatedAt: "bad" };
  const reverseKeys = { updatedAt: "bad", payload: { y: false, x: [1, null, "value"] } };
  const local = [noId, { id: 3, payload: "numeric id" }, [], { id: "named" }, { id: "   ", payload: "blank" }];
  const remote = [reverseKeys, { id: 3, payload: "numeric id" }, [], { id: 4, payload: "another" }];
  const output = parity(local, remote);
  assert.equal(output.filter((value) => value === noId).length, 1);
  assert.ok(!output.includes(reverseKeys));
  assert.equal(output.length, 6);
});

test("invalid singleton and sparse arrays retain lazy parsing and original throws", () => {
  for (const record of [null, undefined, false, 42, "raw", [], { updatedAt: {} }]) {
    sameReferences(parity([record], []), [record]);
  }
  const sparse = new Array(5); sparse[2] = { id: "present" };
  sameReferences(parity(sparse, []), [sparse[2]]);
  assert.throws(() => previous([null, { id: "other" }], []), { name: "TypeError" });
  assert.throws(() => current([null, { id: "other" }], []), { name: "TypeError" });
  // Array.sort moves undefined to the end without calling the comparator.
  const other = { id: "other" };
  sameReferences(parity([undefined, other], []), [other, undefined]);
  const fresh = harness(false);
  fresh.merge([null], []);
  assert.equal(fresh.calls.length, 0);
});

test("all invalid timestamps remain stable but duplicate IDs still select the later record", () => {
  const local = [
    { id: "a", updatedAt: "bad" }, { id: "b", updatedAt: "" },
    { payload: "no-id", updatedAt: null }, { id: "a", updatedAt: [] },
  ];
  const remote = [{ id: "b", updatedAt: "no-date" }, { id: "c", createdAt: {} }];
  sameReferences(parity(local, remote), [local[3], remote[0], remote[1], local[2]]);
});

test("frozen inputs stay unchanged and a new merge sees edited timestamps", () => {
  const original = { id: "x", updatedAt: "2032-01-01T00:00:00Z" };
  const remote = Object.freeze({ id: "x", updatedAt: "2032-02-01T00:00:00Z" });
  sameReferences(parity(Object.freeze([original]) as unknown as unknown[], [remote]), [remote]);
  original.updatedAt = "2032-03-01T00:00:00Z";
  sameReferences(parity([original], Object.freeze([remote]) as unknown as unknown[]), [original]);
});

test("string-key caching still reads fields in the old order even if getters change", () => {
  function inputs() {
    const trace: string[] = []; let counter = 0;
    const a = { id: "x", get updatedAt() {
      trace.push("x.updatedAt"); return ++counter % 2 ? "2032-01-01T00:00:00Z" : "2032-03-01T00:00:00Z";
    }, get createdAt() { trace.push("x.createdAt"); return ""; } };
    const b = { id: "y", get updatedAt() { trace.push("y.updatedAt"); return ""; },
      get createdAt() { trace.push("y.createdAt"); return "2032-02-01T00:00:00Z"; } };
    return { trace, records: [a, b, a] };
  }
  const old = inputs(); const next = inputs();
  const expected = previous(old.records, []).map((record) => (record as { id: string }).id);
  const actual = current(next.records, []).map((record) => (record as { id: string }).id);
  assert.deepEqual(Array.from(actual), Array.from(expected));
  assert.deepEqual(next.trace, old.trace);
});

test("generated ordinary JSON cases retain winner identity and source arrays", () => {
  let seed = 0x274aa319;
  const random = (max: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % max; };
  const dates: unknown[] = [undefined, null, "", " ", "invalid", false, 3, {}, [],
    "2032-01-01T00:00:00Z", " 2032-01-01T00:00:00Z ", "2032-01-01T02:00:00+02:00", "2032-02-01T00:00:00Z"];
  for (let iteration = 0; iteration < 2500; iteration++) {
    const records = Array.from({ length: random(70) }, () => ({
      id: [undefined, "", " ", 3, `id-${random(12)}`][random(5)],
      siteId: `site-${random(4)}`, updatedAt: dates[random(dates.length)], createdAt: dates[random(dates.length)],
      payload: { n: random(3), text: ["same", "distinct"][random(2)] },
    }));
    const cut = random(records.length + 1);
    const before = structuredClone(records);
    parity(records.slice(0, cut), records.slice(cut));
    assert.deepEqual(records, before);
  }
});

test("merge timestamp cache is local, caches invalid strings and uses exact normalized keys", () => {
  const next = harness(false);
  const local = [{ id: "a", updatedAt: " bad " }, { id: "b", updatedAt: "bad" },
    { id: "c", updatedAt: "2032-01-01T00:00:00Z" }, { id: "d", updatedAt: "2032-01-01T02:00:00+02:00" }];
  next.merge(local, structuredClone(local));
  assert.equal(next.calls.length, 3);
  assert.deepEqual([...next.calls].sort(), ["bad", "2032-01-01T00:00:00Z", "2032-01-01T02:00:00+02:00"].sort());
  next.merge(local, structuredClone(local));
  assert.equal(next.calls.length, 6);
});

test("10k-record merge parses each shared date once without changing winners (synthetic work count)", (context) => {
  const local = Array.from({ length: 10000 }, (_, index) => ({
    id: `id-${index}`, updatedAt: new Date(Date.UTC(2032, 0, 1) + (index * 73 % 250) * 60000).toISOString(),
  }));
  const remote = structuredClone(local);
  const old = harness(true); const next = harness(false);
  sameReferences(next.merge(local, remote), old.merge(local, remote));
  assert.equal(next.calls.length, 250);
  assert.ok(old.calls.length > next.calls.length * 10);
  context.diagnostic(`synthetic 10000 local + 10000 remote: Date.parse ${old.calls.length} -> ${next.calls.length}; no IO or production latency claim`);
});

test("10k distinct timestamps are bounded by compared keys, not sort comparisons", () => {
  const records = Array.from({ length: 10000 }, (_, index) => ({
    id: `id-${index}`, updatedAt: new Date(Date.UTC(2032, 0, 1) + (index * 73 % 10000) * 60000).toISOString(),
  }));
  const old = harness(true); const next = harness(false);
  sameReferences(next.merge(records, []), old.merge(records, []));
  assert.equal(next.calls.length, 10000);
  assert.ok(old.calls.length > 10000 * 5);
});

test("large stores cap extra cached keys and still merge uncached dates identically", () => {
  const records = Array.from({ length: 18000 }, (_, index) => ({
    id: `id-${index}`, updatedAt: new Date(Date.UTC(2032, 0, 1) + (index * 73 % 18000) * 60000).toISOString(),
  }));
  const next = harness(false);
  sameReferences(next.merge(records, records), previous(records, records));
  assert.equal(next.cacheStats().cachedKeys, 16_384);
  assert.equal(next.cacheStats().cachedCharacters, 16_384 * 24);
  const counts = new Map<string, number>();
  for (const text of next.calls) counts.set(text, (counts.get(text) ?? 0) + 1);
  assert.equal([...counts.values()].filter((count) => count === 1).length, 16_384);
  assert.ok([...counts.values()].some((count) => count > 1));
});

test("long historical date strings bypass caching, not parsing or winner selection", () => {
  const longDate = "2032-01-01T00:00:00Z" + "x".repeat(4096);
  const records = [{ id: "a", updatedAt: longDate }, { id: "b", updatedAt: longDate },
    { id: "c", updatedAt: "2032-02-01T00:00:00Z" }];
  const next = harness(false);
  sameReferences(next.merge(records, records), previous(records, records));
  assert.ok(next.calls.filter((text) => text === longDate).length > 1);
  assert.equal(next.cacheStats().cachedKeys, 1);
});
