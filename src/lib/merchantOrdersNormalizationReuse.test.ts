import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createContext, Script } from "node:vm";
import ts from "typescript";
import {
  LEGACY_MERCHANT_ORDERS_STORE_SHA256,
  MERCHANT_ORDERS_NORMALIZER_SHA256,
  restoreLegacyOrderMergeSource,
} from "../../scripts/fixtures/merchantOrdersMergeReference";
import type { MerchantOrdersStoreClient } from "@/lib/merchantOrdersStore";

// Actual complete old/new store, normalizer, transaction adapter and (where
// tested) V1 fallback run in isolated VMs. Only database replies/RPC and time are
// synthetic. This proves persisted-JSON behavior, not DB transactions or arbitrary
// proxy/accessor objects. No default client, network, provider or file writes.
const root = fileURLToPath(new URL("./", import.meta.url));
const read = (name: string) => readFileSync(path.join(root, name + ".ts"), "utf8").replaceAll("\r\n", "\n");
const storeSource = read("merchantOrdersStore");
const normalizerSource = read("merchantOrders");
const oldStoreSource = restoreLegacyOrderMergeSource(storeSource);
const siteId = "99990001";
const now = "2032-06-01T12:00:00.000Z";
const before = "2032-01-01T00:00:00.000Z";
const slug = "__merchant_orders__:" + siteId;
type Store = typeof import("@/lib/merchantOrdersStore");
type Domain = typeof import("@/lib/merchantOrders");
type V1 = typeof import("@/lib/merchantOrdersV1Read.server");
type Row = Parameters<Store["mergeStoredMerchantOrdersRows"]>[1][number];
type JsonObject = Record<string, unknown>;
type Reply = { data: unknown; error: { message: string } | null };
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function instrumentNormalizers() {
  const ast = ts.createSourceFile("merchantOrders.ts", normalizerSource, ts.ScriptTarget.Latest, true);
  let source = normalizerSource;
  for (const [name, counter] of [
    ["normalizeMerchantOrderRecord", "records"],
    ["normalizeMerchantOrderLineItems", "itemPasses"],
    ["summarizeMerchantOrderItems", "summaries"],
  ] as const) {
    const node = ast.statements.find((entry): entry is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(entry) && entry.name?.text === name);
    assert.ok(node?.body, name);
    const original = node.getText(ast);
    const start = node.body.getStart(ast) - node.getStart(ast) + 1;
    let modified = original.slice(0, start) + ` __counts.${counter}++;` + original.slice(start);
    if (name === "normalizeMerchantOrderLineItems") {
      const marker = ".map((item) => {";
      assert.equal(modified.split(marker).length, 2);
      modified = modified.replace(marker, marker + " __counts.itemVisits++;");
    }
    source = source.replace(original, modified);
  }
  return source;
}

const countedNormalizer = instrumentNormalizers();
const compiled = new Map<string, string>();
function runtime(legacy = false) {
  const counts = { records: 0, itemPasses: 0, summaries: 0, itemVisits: 0 };
  class FixedDate extends Date {
    constructor(value: string | number = now) { super(value); }
    static now() { return Date.parse(now); }
  }
  const forbidden = () => { throw new Error("forbidden_external_io"); };
  const context = createContext({ Date: FixedDate, __counts: counts, fetch: forbidden,
    process: { env: {} }, setTimeout, clearTimeout,
    console: { log: forbidden, warn: forbidden, error: forbidden } });
  const modules = new Map<string, { exports: Record<string, unknown> }>();
  function load(specifier: string): unknown {
    const name = specifier.replace(/^@\/lib\//, "");
    if (modules.has(name)) return modules.get(name)!.exports;
    assert.ok(["merchantOrdersStore", "merchantOrders", "merchantOrderMembershipTransaction.server",
      "merchantOrdersV1Read.server", "merchantOrdersV1", "merchantOrderV1ReadCircuitBreaker"].includes(name), name);
    const source = name === "merchantOrdersStore" ? (legacy ? oldStoreSource : storeSource)
      : name === "merchantOrders" ? countedNormalizer : read(name);
    const key = name + ":" + source;
    if (!compiled.has(key)) compiled.set(key, ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText);
    const moduleRecord = { exports: {} as Record<string, unknown> };
    modules.set(name, moduleRecord);
    const execute = new Script("(function(require,module,exports){" + compiled.get(key) + "\n})", { filename: name }).runInContext(context);
    execute(load, moduleRecord, moduleRecord.exports);
    return moduleRecord.exports;
  }
  return { store: load("merchantOrdersStore") as Store, domain: load("merchantOrders") as Domain,
    v1: () => load("merchantOrdersV1Read.server") as V1, counts };
}

function item(extra: JsonObject = {}): JsonObject {
  return { productId: "p", code: "CODE", name: "Synthetic product", description: "Synthetic description",
    imageUrl: "https://synthetic.invalid/image", tag: "tag", quantity: 2, unitPrice: 1.125,
    unitPriceText: " EUR 1.125 ", ...extra };
}
function order(id = "order-1", extra: JsonObject = {}): JsonObject {
  return { id, siteId, siteName: " Synthetic merchant ", blockId: "block", clientRequestId: "request-" + id,
    customerAccountId: "account-" + id, customerUserId: "user-" + id, customerGuestHash: "guest-" + id,
    customerLoginEmail: " SYNTHETIC@example.test ", createdAt: before, updatedAt: now,
    merchantTouchedAt: before, status: "completed", customer: { name: " Name ", phone: " 123 ",
      email: " PERSON@example.test ", note: " Note " }, items: [item()], pricePrefix: " EUR ",
    totalAmount: 999999, totalQuantity: 999999, confirmedAt: before, completedAt: now,
    cancelledAt: "", printedAt: before, printCount: 2.4, ...extra };
}
function row(blocks: unknown, extra: Partial<Row> = {}): Row {
  return { id: "page-1", slug, blocks, updated_at: now, ...extra };
}
function freezeDeep(value: unknown): void {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return;
  Object.values(value).forEach(freezeDeep);
  Object.freeze(value);
}
function outcome(task: () => unknown) {
  try { return { kind: "success", value: clone(task()) }; }
  catch (error) { return { kind: "error", name: (error as Error).name, message: (error as Error).message }; }
}
function compare(rows: Row[], requestedSite = siteId) {
  const original = runtime(true), current = runtime();
  const oldResult = outcome(() => original.store.mergeStoredMerchantOrdersRows(requestedSite, rows));
  const newResult = outcome(() => current.store.mergeStoredMerchantOrdersRows(requestedSite, rows));
  assert.deepEqual(newResult, oldResult);
  return { original, current, result: newResult };
}

function reader(replies: readonly (Reply | Error)[]) {
  const events: unknown[] = [], mutations: Array<{ name: string; args: Record<string, unknown> }> = [];
  let index = 0;
  const client: MerchantOrdersStoreClient = {
    from(table: string) {
      const event: unknown[] = [["from", table]];
      const query = {
        select(value: string) { event.push(["select", value]); return query; },
        eq(key: string, value: unknown) { event.push(["eq", key, value]); return query; },
        like(key: string, value: unknown) { event.push(["like", key, value]); return query; },
        order(key: string, value: unknown) { event.push(["order", key, value]); return query; },
        range(from: number, to: number) { event.push(["range", from, to]); return query; },
        update() { assert.fail("direct writes forbidden"); },
        insert() { assert.fail("direct writes forbidden"); },
        delete() { assert.fail("direct writes forbidden"); },
        then(resolve: (reply: Reply) => unknown, reject: (error: unknown) => unknown) {
          assert.ok(index < replies.length, "unexpected query");
          events.push(clone(event));
          const reply = replies[index++]!;
          return (reply instanceof Error ? Promise.reject(reply) : Promise.resolve(reply)).then(resolve, reject);
        },
      };
      return query;
    },
    async rpc(name, args) { mutations.push({ name, args }); return { data: { updatedAt: now }, error: null }; },
  };
  return { client, events, mutations };
}
async function asyncOutcome(task: () => Promise<unknown>) {
  try { return { kind: "success", value: clone(await task()) }; }
  catch (error) { return { kind: "error", name: (error as Error).name, message: (error as Error).message }; }
}

test("inverse pins the complete f547 store and unchanged normalizer, including guard assumptions", () => {
  assert.equal(createHash("sha256").update(oldStoreSource).digest("hex"), LEGACY_MERCHANT_ORDERS_STORE_SHA256);
  assert.equal(createHash("sha256").update(normalizerSource).digest("hex"), MERCHANT_ORDERS_NORMALIZER_SHA256);
  assert.equal(restoreLegacyOrderMergeSource(storeSource.replaceAll("\n", "\r\n")), oldStoreSource);
  assert.throws(() => restoreLegacyOrderMergeSource(storeSource.replace("const MERCHANT_ORDER_CHUNK_SIZE = 100;",
    "const MERCHANT_ORDER_CHUNK_SIZE = 99;")), /complete legacy store/);
});

test("empty, ignored and malformed shapes preserve nulls, filtering and original exceptions", () => {
  for (const rows of [[], [row([])], [row(null)], [row({ orders: [order()] })],
    [row([{}, [], false, 1, "bad", order("", { siteId })])],
    [row([order()], { slug: "unrelated" })], [row([null])]]) compare(rows);
  assert.deepEqual(compare([row([order()])], " ").result, { kind: "success", value: null });
  assert.equal(compare([row([null])]).result.kind, "error", "null records were not silently tolerated before");
});

test("chunk/base precedence, first duplicate winner and invalid timestamp ordering remain exact", () => {
  const rows = [row([null], { id: "base" }),
    row([order("same", { createdAt: now, customer: { name: "later chunk" } })], { id: "two", slug: slug + ":chunk:2" }),
    row([order("same", { customer: { name: "first chunk" } }), order("tie-a"), order("tie-b"),
      order("invalid", { createdAt: "not-a-date" }), order("missing", { createdAt: "", updatedAt: "" })],
    { id: "zero", slug: slug + ":chunk:0", updated_at: "invalid" }),
    row([order("same", { createdAt: now, customer: { name: "same-index later row" } })],
      { id: "zero-again", slug: slug + ":chunk:0", updated_at: before })];
  compare(rows);
  const merged = runtime().store.mergeStoredMerchantOrdersRows(siteId, rows)!;
  assert.equal(merged.orders.find((entry) => entry.id === "same")!.customer.name, "first chunk");
  assert.equal(merged.orders.find((entry) => entry.id === "missing")!.createdAt, now);
  assert.equal(merged.updatedAt, "invalid", "invalid first updatedAt retains the original reduction behavior");
  assert.ok(merged.orders.findIndex((entry) => entry.id === "tie-a") < merged.orders.findIndex((entry) => entry.id === "tie-b"));
});

test("duplicates inside a row still select its first sorted occurrence; foreign IDs are not prefiltered", () => {
  const rows = [row([order("same", { customer: { name: "older" } }),
    order("same", { createdAt: now, siteId: "99990002", customer: { name: "foreign winner" } }),
    order("same", { createdAt: now, customer: { name: "same-time later" } })])];
  compare(rows);
  const result = runtime().store.mergeStoredMerchantOrdersRows(siteId, rows)!;
  assert.equal(result.orders.length, 1);
  assert.equal(result.orders[0]!.siteId, "99990002");
  assert.equal(result.orders[0]!.customer.name, "foreign winner");
});

const slicedFields = [
  ["customer", "name", 160], ["customer", "phone", 80], ["customer", "email", 320], ["customer", "note", 2000],
  ["order", "clientRequestId", 160], ["item", "productId", 200], ["item", "code", 200],
  ["item", "name", 500], ["item", "description", 4000], ["item", "imageUrl", 4096],
  ["item", "tag", 200], ["item", "unitPriceText", 120],
] as const;
for (const [scope, field, limit] of slicedFields) {
  test(`trim-after-slice fallback retains the second pass for ${scope}.${field}`, () => {
    for (const whitespace of [" ", "\t", "\u00a0", "\ufeff", "\u2028"]) {
      const raw = order();
      const target = scope === "order" ? raw : scope === "customer" ? raw.customer as JsonObject : (raw.items as JsonObject[])[0]!;
      target[field] = "x".repeat(limit - 1) + whitespace + "z";
      const { original, current, result } = compare([row([raw])]);
      assert.equal(result.kind, "success");
      assert.equal(original.counts.itemPasses, 2);
      assert.equal(current.counts.itemPasses, 2, "changed record retains its complete second item/amount normalization");
      const normalized = current.store.mergeStoredMerchantOrdersRows(siteId, [row([raw])])!.orders[0]!;
      const selected = scope === "order" ? normalized[field as "clientRequestId"]
        : scope === "customer" ? normalized.customer[field as "name"] : normalized.items[0]![field as "name"];
      assert.equal(selected, "x".repeat(limit - 1));
    }
  });
}

test("generated price text also triggers fallback when a long prefix ends its slice on whitespace", () => {
  const raw = order("price", { pricePrefix: "x".repeat(119) + " z", items: [item({ unitPriceText: "" })] });
  const { current } = compare([row([raw])]);
  assert.equal(current.counts.itemPasses, 2);
  assert.equal(current.store.mergeStoredMerchantOrdersRows(siteId, [row([raw])])!.orders[0]!.items[0]!.unitPriceText,
    "x".repeat(119));
});

test("finite extremes, overflow, signed zero, rounding, price parsing and item filtering retain exact amounts", () => {
  const values = [0, -0, Number.MIN_VALUE, Number.MAX_VALUE, Number.MAX_SAFE_INTEGER, -Number.MAX_VALUE,
    0.005, 0.015, 1.005, 2.675, 999.995, 1e20, 1e21, 1e22];
  const records = values.flatMap((unitPrice, index) => [0, 1, 2, 999, 1000, -1, 0.49, 0.5].map((quantity) =>
    order("numeric-" + index + ":" + quantity, { printCount: quantity, items: [item({ unitPrice, quantity }),
      item({ unitPrice, quantity: 999 }), item({ productId: "", name: "", code: "", quantity: 4 })] })));
  records.push(...["1.234,56", "1,234.56", "-2", "1e308", "", "invalid"].map((unitPriceText, index) =>
    order("text-" + index, { items: [item({ unitPrice: null, unitPriceText })] })));
  compare([row(clone(records))]);
  // Preserve signed zero/non-finite numbers for this numerical assertion rather
  // than allowing JSON serialization to erase a possible discrepancy.
  assert.deepEqual(structuredClone(runtime().store.mergeStoredMerchantOrdersRows(siteId, [row(records)])),
    structuredClone(runtime(true).store.mergeStoredMerchantOrdersRows(siteId, [row(records)])));
  const normalized = runtime().store.mergeStoredMerchantOrdersRows(siteId, [row(records)])!.orders;
  assert.ok(normalized.every((entry) => Number.isFinite(entry.totalAmount) && entry.totalAmount >= 0));
  assert.ok(normalized.every((entry) => entry.totalAmount !== 999999), "raw aggregate amounts remain ignored");
  // These extra values are outside JSON persistence but also retain prior coercion.
  compare([row([order("nonfinite", { items: [item({ unitPrice: Infinity }), item({ unitPrice: NaN }),
    item({ quantity: -Infinity })] })])]);
});

test("seeded double bit patterns retain the second-pass numerical fixed point", () => {
  let seed = 0x6a09e667;
  const next = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed >>> 0; };
  const bytes = new DataView(new ArrayBuffer(8));
  const records: JsonObject[] = [];
  for (let index = 0; index < 1024; index++) {
    bytes.setUint32(0, next()); bytes.setUint32(4, next());
    const value = bytes.getFloat64(0);
    records.push(order("bits-" + index, { items: [item({ unitPrice: Number.isFinite(value) ? value : null,
      quantity: index % 999 + 1 })] }));
  }
  const result = compare([row(clone(records))]);
  assert.equal(result.current.counts.itemPasses, 1024);
  assert.equal(result.original.counts.itemPasses, 2048);
});

test("seeded mixed JSON rows preserve full records, winners, item order and metadata", () => {
  let seed = 0x13579bdf;
  const next = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; };
  const pick = <T,>(values: readonly T[]): T => values[next() % values.length]!;
  for (let batch = 0; batch < 12; batch++) {
    const rows = Array.from({ length: 5 }, (_, rowIndex) => row(Array.from({ length: 30 }, (_, index) =>
      order("id-" + next() % 75, { siteId: pick([siteId, "99990002", " " + siteId + " "]),
        createdAt: pick([now, before, "invalid", "", " 2031-02-01 "]), updatedAt: pick([now, "", "bad"]),
        status: pick(["pending", "completed", "wrong", null]), printCount: pick([2.6, "9", {}, null]),
        clientRequestId: index % 13 ? " r " : "x".repeat(159) + " z",
        customer: { name: " Person " + index, phone: pick(["1", false, null]), note: index % 11 ? " note " : "x".repeat(1999) + " z" },
        items: Array.from({ length: next() % 5 }, () => item({ productId: pick(["p", "", null]),
          name: pick([" product ", "", "x".repeat(499) + " z"]), quantity: pick([1, 2.5, "4", -1, null, []]),
          unitPrice: pick([1.125, 0, 1e21, null, "4"]), unitPriceText: pick(["1,25", "", "x".repeat(119) + " z"]) })) })),
    { id: "row-" + rowIndex, slug: rowIndex ? slug + ":chunk:" + (rowIndex % 3) : slug,
      updated_at: pick([now, before, "invalid", ""]) }));
    const persisted = clone(rows), snapshot = JSON.stringify(persisted);
    freezeDeep(persisted);
    assert.equal(compare(persisted).result.kind, "success", "mixed JSON exercises successful records, not merely matching failures");
    assert.equal(JSON.stringify(persisted), snapshot);
  }
});

test("bad JSON coercions still fail before winner selection, including foreign and overwritten records", () => {
  const broken = [null, order("bad", { printCount: { toString: null } }),
    order("bad", { items: [item({ quantity: { toString: null } })] }),
    order("same", { siteId: "99990002", items: [item({ quantity: { toString: {} } })] })];
  for (const record of broken) {
    const rows = [row([order("same"), record])];
    assert.equal(compare(rows).result.kind, "error");
  }
  const ignored = [row([null]), row([order()], { id: "chunk", slug: slug + ":chunk:0" })];
  assert.equal(compare(ignored).result.kind, "success", "ignored base payload is not newly visited");
});

test("fresh normalized records do not alias frozen raw data, other orders or later reads", () => {
  const sharedItem = item(), sharedCustomer = { name: " Shared ", note: " note " };
  const rows = [row([order("one", { items: [sharedItem], customer: sharedCustomer }),
    order("two", { items: [sharedItem], customer: sharedCustomer })])];
  const snapshot = JSON.stringify(rows);
  freezeDeep(rows);
  compare(rows);
  const current = runtime();
  const first = current.store.mergeStoredMerchantOrdersRows(siteId, rows)!.orders;
  assert.notEqual(first[0]!.customer, sharedCustomer);
  assert.notEqual(first[0]!.items[0], sharedItem);
  assert.notEqual(first[0]!.customer, first[1]!.customer);
  assert.notEqual(first[0]!.items[0], first[1]!.items[0]);
  first[0]!.customer.name = "changed";
  first[0]!.items[0]!.description = "changed";
  assert.equal(first[1]!.customer.name, "Shared");
  assert.equal(JSON.stringify(rows), snapshot);
  assert.equal(current.store.mergeStoredMerchantOrdersRows(siteId, rows)!.orders[0]!.customer.name, "Shared");
});

test("actual function-body counters prove stable items take one pass and fallback only affects its own record", () => {
  const rows = [row(Array.from({ length: 80 }, (_, index) => order("order-" + index, {
    items: Array.from({ length: 3 }, (_, itemIndex) => item({ productId: String(itemIndex) })),
  })))];
  const stable = compare(rows);
  assert.deepEqual(stable.original.counts, { records: 160, itemPasses: 160, summaries: 160, itemVisits: 480 });
  assert.deepEqual(stable.current.counts, { records: 80, itemPasses: 80, summaries: 80, itemVisits: 240 });
  const mixed = compare([row([order("one"), order("two", { customer: { name: "x".repeat(159) + " z" } }), order("three")])]);
  assert.equal(mixed.original.counts.itemPasses, 6);
  assert.equal(mixed.current.counts.itemPasses, 4);
});

test("full loader keeps original raw CAS references and writer still passes them to the real transaction adapter", async () => {
  const rows = [row([order("legacy")], { id: "base" }), row([order("winner", { clientRequestId: "x".repeat(159) + " z" })],
    { id: "chunk", slug: slug + ":chunk:0" })];
  const snapshot = JSON.stringify(rows);
  freezeDeep(rows);
  const results: unknown[] = [];
  for (const legacy of [true, false]) {
    const actual = runtime(legacy), io = reader([{ data: rows, error: null }, { data: [], error: null }]);
    const stored = await actual.store.loadStoredMerchantOrders(io.client, siteId);
    assert.ok(stored?.storageRows);
    assert.equal(stored.storageRows[0]!.blocks, rows[0]!.blocks);
    assert.equal(stored.storageRows[1]!.blocks, rows[1]!.blocks);
    const saved = await actual.store.saveStoredMerchantOrders(io.client, {
      siteId, orders: stored.orders, expectedRows: stored.storageRows,
    });
    assert.deepEqual(clone(saved), { error: null });
    assert.equal(io.events.length, 2, "saving did not reread the CAS snapshot");
    assert.equal(io.mutations.length, 1);
    assert.equal(io.mutations[0]!.name, "faolla_commit_order_membership_v1");
    const mutation = io.mutations[0]!.args.p_mutation as { orders: { expectedRows: unknown } };
    assert.equal(mutation.orders.expectedRows, stored.storageRows);
    results.push(clone({ stored, events: io.events, mutations: io.mutations }));
  }
  assert.deepEqual(results[1], results[0]);
  assert.equal(JSON.stringify(rows), snapshot);
});

test("loader schema fallback, pagination and source failures preserve query/effect traces", async () => {
  const ok = { data: [row([order()])], error: null }, end = { data: [], error: null };
  const fail = (message: string): Reply => ({ data: null, error: { message } });
  for (const replies of [[ok, end], [fail("column pages.merchant_id does not exist"), ok, end],
    [fail("column pages.updated_at does not exist"), ok, end],
    [fail("column pages.merchant_id does not exist"), fail("column pages.updated_at does not exist"), ok, end],
    [fail("column pages.slug does not exist")], [fail("access denied")], [{ data: {}, error: null }],
    [ok, ok], [new Error("offline")], [end], [{ data: [row([null])], error: null }, end]]) {
    const oldRuntime = runtime(true), newRuntime = runtime(), oldIo = reader(replies), newIo = reader(replies);
    const original = await asyncOutcome(() => oldRuntime.store.loadStoredMerchantOrders(oldIo.client, siteId));
    const current = await asyncOutcome(() => newRuntime.store.loadStoredMerchantOrders(newIo.client, siteId));
    assert.deepEqual(current, original);
    assert.deepEqual(newIo.events, oldIo.events);
    assert.deepEqual(newIo.mutations, []);
  }
});

test("actual V1 off/verify/primary comparison and mismatch/failure fallbacks remain unchanged", async () => {
  const rows = [row([order("one"), order("two", { customer: { note: "x".repeat(1999) + " z" } })])];
  for (const mode of ["off", "verify", "primary"] as const) {
    for (const scenario of ["match", "mismatch", "failed", "missing"] as const) {
      const results: unknown[] = [];
      for (const legacy of [true, false]) {
        const actual = runtime(legacy), logs: unknown[] = [];
        let v1Calls = 0;
        const reference = clone(runtime(true).store.mergeStoredMerchantOrdersRows(siteId, rows)!);
        if (scenario === "mismatch") reference.orders[0]!.items[0]!.description = "different image metadata";
        const value = await actual.v1().readMerchantOrdersWithV1Fallback({
          siteId, config: { mode, siteIds: [siteId], timeoutMs: 1000 },
          loadLegacy: async () => actual.store.mergeStoredMerchantOrdersRows(siteId, rows),
          loadV1: async () => { v1Calls++; if (scenario === "failed") throw new Error("synthetic_v1_failure");
            return scenario === "missing" ? null : reference; },
          logger: (event) => { logs.push(clone(event)); },
        });
        results.push(clone({ value, logs, v1Calls }));
      }
      assert.deepEqual(results[1], results[0]);
    }
  }
});
