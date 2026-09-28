import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createContext, Script } from "node:vm";
import ts from "typescript";
import type { MerchantMembershipRecord } from "@/lib/merchantMemberships";
import type {
  MerchantMembershipProfileRecord,
  MerchantMembershipsStoreClient,
  StoredMerchantMembershipProfiles,
  StoredMerchantMemberships,
} from "@/lib/merchantMembershipsStore";

// Actual store + full normalizers execute with a fixed clock. Only query replies
// and the write-commit/mirror ports are synthetic; no configured clients, DB,
// provider, network or filesystem writes are used. Persisted-JSON parity is the
// contract, not arbitrary accessor/proxy-bearing JavaScript object equivalence.
const root = fileURLToPath(new URL("./", import.meta.url));
const read = (file: string) => readFileSync(path.join(root, file), "utf8").replaceAll("\r\n", "\n");
const storeSource = read("merchantMembershipsStore.ts");
const normalizerSource = read("merchantMemberships.ts");
const siteId = "99990001";
const now = "2032-06-01T12:00:00.000Z";
const older = "2032-01-01T00:00:00.000Z";
const slug = "__merchant_memberships__:" + siteId;
const jsonClone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
type StoreModule = typeof import("@/lib/merchantMembershipsStore");
type DomainModule = typeof import("@/lib/merchantMemberships");
type Row = { id?: unknown; slug?: unknown; blocks?: unknown; updated_at?: unknown };
type Reply = { data: unknown; error: { message: string } | null };

function restoreOriginalStore() {
  const addedNames = new Set(["MerchantMembershipProfileRecord", "StoredMerchantMembershipProfiles",
    "isSkippableMembershipMoney", "stripCustomerUnusedTransactions", "loadStoredMerchantMembershipProfiles"]);
  const ast = ts.createSourceFile("store.ts", storeSource, ts.ScriptTarget.Latest, true);
  const added = ast.statements.filter((node) =>
    (ts.isTypeAliasDeclaration(node) || ts.isFunctionDeclaration(node)) && node.name && addedNames.has(node.name.text));
  assert.equal(added.length, addedNames.size, "only the five additive declarations are removed");
  let restored = storeSource;
  for (const node of [...added].reverse()) restored = restored.slice(0, node.getFullStart()) + restored.slice(node.end);
  assert.equal(createHash("sha256").update(restored).digest("hex"),
    "39b076bfcfc4605961bf6c32170a3df9730b7aef4d292550845f697058cc4c74",
    "complete 1ede92a3 store: full query/merge/load/save/mirroring and imports are unchanged");
  return restored;
}

function instrumentNormalizers() {
  const ast = ts.createSourceFile("normalizer.ts", normalizerSource, ts.ScriptTarget.Latest, true);
  let source = normalizerSource;
  for (const [name, marker, inserted] of [
    ["normalizeMerchantMemberAccountTransactions", ".map((item) => {", ".map((item) => { __counts.transactionEntries++;"],
    ["normalizeMerchantMembershipRecord", "  const record = readRecord(value);", "  __counts.membershipRecords++;\n  const record = readRecord(value);"],
  ]) {
    const node = ast.statements.find((item): item is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(item) && item.name?.text === name);
    assert.ok(node);
    const original = node.getText(ast);
    assert.equal(original.split(marker!).length, 2, "unique actual function-body counter marker");
    source = source.replace(original, original.replace(marker!, inserted!));
  }
  return source;
}

const instrumentedSource = instrumentNormalizers();
const compiled = new Map<string, string>();
function runtime(legacy = false) {
  const counts = { transactionEntries: 0, membershipRecords: 0 };
  const mutations: unknown[] = [];
  const forbidden = (name: string) => () => { throw new Error("forbidden_test_dependency:" + name); };
  class FixedDate extends Date {
    constructor(value: string | number = now) { super(value); }
    static now() { return Date.parse(now); }
  }
  const context = createContext({ Date: FixedDate, __counts: counts, fetch: forbidden("network"),
    console: { log: forbidden("log"), error: forbidden("log"), warn: forbidden("log") } });
  const modules = new Map<string, { exports: Record<string, unknown> }>();
  const injected: Record<string, unknown> = {
    "merchantMembershipLedgerDualWrite.server": { resolveMerchantMembershipLedgerDualWriteConfig: () => ({ mode: "off" }),
      mirrorMerchantMembershipLedgerChanges: forbidden("ledger-mirror") },
    "merchantOrderMembershipTransaction.server": { commitMerchantOrderMembershipTransaction: async (
      _client: unknown, requestedSite: string, mutation: unknown,
    ) => { mutations.push(jsonClone({ siteId: requestedSite, mutation })); return { error: null }; } },
  };
  function load(specifier: string): unknown {
    const name = specifier.replace(/^@\/lib\//, "");
    if (Object.hasOwn(injected, name)) return injected[name];
    if (modules.has(name)) return modules.get(name)!.exports;
    assert.ok(["merchantMembershipsStore", "merchantMemberships", "mutationOperationId"].includes(name), name);
    const source = name === "merchantMembershipsStore" ? (legacy ? restoreOriginalStore() : storeSource)
      : name === "merchantMemberships" ? instrumentedSource : read(name + ".ts");
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
  return { store: load("merchantMembershipsStore") as StoreModule, domain: load("merchantMemberships") as DomainModule, counts, mutations };
}

function reader(replies: readonly (Reply | Error)[]) {
  const events: Array<{ table: string; fields: string; filters: Array<[string, unknown]> }> = [];
  let index = 0;
  const client: MerchantMembershipsStoreClient = {
    from(table: string) {
      const event = { table, fields: "", filters: [] as Array<[string, unknown]> };
      const query = {
        select(fields: string) { event.fields = fields; return query; },
        eq(key: string, value: unknown) { event.filters.push([key, value]); return query; },
        update() { throw new Error("write_forbidden"); },
        insert() { throw new Error("write_forbidden"); },
        delete() { throw new Error("write_forbidden"); },
        then(onFulfilled: (reply: Reply) => unknown, onRejected: (error: unknown) => unknown) {
          assert.ok(index < replies.length, "unexpected extra query");
          events.push(event);
          const reply = replies[index++]!;
          return (reply instanceof Error ? Promise.reject(reply) : Promise.resolve(reply)).then(onFulfilled, onRejected);
        },
      };
      return query;
    },
    async rpc() { throw new Error("rpc_forbidden"); },
  };
  return { client, events, get queries() { return index; } };
}

function transaction(index = 0, extra: Record<string, unknown> = {}) {
  return { id: "transaction-" + index, at: older, type: "recharge", pointDelta: index,
    balanceDelta: 1.25, growthDelta: 2, note: "Synthetic transaction " + index, ...extra };
}

function member(id = "member-1", extra: Record<string, unknown> = {}) {
  return { id, siteId, accountId: "account-" + id, userId: "user-" + id, joinedAt: older, updatedAt: now,
    serial: 4, memberNo: "MEM-" + id, email: "  SYNTHETIC@example.test  ", name: " Synthetic name ", nickname: "",
    phone: " 123456 ", avatarUrl: "https://synthetic.invalid/avatar", birthday: "2000-01-02", birthday_month_day_only: "yes",
    country: "ES", province: "Madrid", city: "Madrid", address: " Synthetic address ",
    tax_name: " Legacy tax name ", tax_number: " TAX-1 ", tax_country: "ES", tax_province: "Madrid",
    tax_city: "Madrid", tax_address: "Synthetic tax address", allergens: ["芝麻", "芝麻", "invalid"],
    pointBalance: "12.6", balanceAmount: "3.145", growthValue: "4.125", status: "left",
    transactions: [transaction()], ...extra };
}

function row(blocks: unknown, extra: Partial<Row> = {}): Row {
  return { id: "row-1", slug, blocks, updated_at: now, ...extra };
}

function omitTransactions(full: StoredMerchantMemberships | null): StoredMerchantMembershipProfiles | null {
  if (!full) return null;
  const result = jsonClone(full) as StoredMerchantMemberships;
  for (const membership of result.memberships) Reflect.deleteProperty(membership, "transactions");
  return result;
}

async function outcome(task: () => Promise<unknown>) {
  try { return { kind: "success", value: jsonClone(await task()) }; }
  catch (error) { return { kind: "error", name: (error as Error).name, message: (error as Error).message }; }
}

async function compare(replies: readonly (Reply | Error)[], requestedSite = siteId) {
  const oldRuntime = runtime(true), newRuntime = runtime();
  const oldReader = reader(replies), newReader = reader(replies);
  const full = await outcome(async () => omitTransactions(await oldRuntime.store.loadStoredMerchantMemberships(oldReader.client, requestedSite)));
  const profile = await outcome(() => newRuntime.store.loadStoredMerchantMembershipProfiles(newReader.client, requestedSite));
  assert.deepEqual(profile, full);
  assert.deepEqual(newReader.events, oldReader.events);
  assert.deepEqual(newRuntime.mutations, []);
  assert.equal(newRuntime.counts.membershipRecords, oldRuntime.counts.membershipRecords, "both profile-normalization passes remain");
  if (profile.kind === "success" && profile.value) {
    const stored = profile.value as StoredMerchantMembershipProfiles;
    stored.memberships.forEach((membership) => assert.equal(Object.hasOwn(membership, "transactions"), false));
  }
  return { full, profile, oldRuntime, newRuntime, oldReader, newReader };
}

function freezeDeep(value: unknown): void {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return;
  Object.values(value).forEach(freezeDeep);
  Object.freeze(value);
}

test("legacy full store and normalizer source remain pinned, including the money-coercion guard assumptions", () => {
  restoreOriginalStore();
  assert.equal(createHash("sha256").update(normalizerSource).digest("hex"),
    "651a498af8f73179e3339833b848556bb7b552a12d94f101c03afceddbc878ca");
});

test("customer profile types are not assignable to full membership readers/writers", () => {
  const isFullRecord: MerchantMembershipProfileRecord extends MerchantMembershipRecord ? true : false = false;
  const isWritable: MerchantMembershipProfileRecord extends Parameters<StoreModule["saveStoredMerchantMemberships"]>[1]["memberships"][number]
    ? true : false = false;
  assert.equal(isFullRecord, false);
  assert.equal(isWritable, false);
});

test("profiles retain full scalar normalization and two passes while omitting transaction properties", async () => {
  const result = await compare([{ data: [row([member()])], error: null }]);
  assert.equal(result.profile.kind, "success");
  const stored = result.profile.value as StoredMerchantMembershipProfiles;
  assert.equal(stored.memberships[0]!.email, "synthetic@example.test");
  assert.equal(stored.memberships[0]!.taxName, "Legacy tax name");
  assert.equal(stored.memberships[0]!.pointBalance, 13);
  assert.equal(stored.memberships[0]!.balanceAmount, 3.15);
  assert.equal(stored.memberships[0]!.leftAt, now);
  assert.equal(stored.memberships[0]!.birthdayMonthDayOnly, true);
  assert.equal(result.oldRuntime.counts.membershipRecords, 2);
  assert.equal(result.newRuntime.counts.transactionEntries, 0);
});

test("invalid site, empty rows, null/wrong-shaped blocks and missing records keep full-reader results", async () => {
  const blank = await compare([], "   ");
  assert.deepEqual(blank.profile, { kind: "success", value: null });
  for (const replies of [
    [{ data: [], error: null }, { data: [], error: null }],
    [{ data: null, error: null }, { data: null, error: null }],
    [{ data: {}, error: null }],
    [{ data: [row(null), row({ memberships: [member()] }), row([null, [], false, "x", {}, member("bad", { joinedAt: "bad" })])], error: null }],
  ]) await compare(replies);
});

test("schema fallback queries and errors match the old loader exactly", async () => {
  const success = { data: [row([member()])], error: null };
  const fail = (message: string): Reply => ({ data: null, error: { message } });
  for (const replies of [
    [success],
    [fail("column pages.merchant_id does not exist"), success],
    [fail("column pages.updated_at does not exist"), success],
    [fail("column pages.slug does not exist")],
    [fail("Could not find the 'slug' column of 'pages' in the schema cache")],
    [{ data: [], error: null }, success],
    [{ data: [], error: null }, fail("column pages.updated_at does not exist"), success],
    [{ data: [], error: null }, fail("column pages.slug does not exist")],
    [fail("column pages.merchant_id does not exist"), fail("column pages.updated_at does not exist")],
    [fail("column pages.updated_at does not exist"), fail("column pages.merchant_id does not exist")],
    [fail("upstream timeout")],
    [fail("permission denied")],
    [new Error("synthetic transport failure")],
  ]) await compare(replies, " " + siteId + " ");
});

test("same-ID ties, row ordering and foreign winners retain legacy dedup-before-site-filter precedence", async () => {
  const target = member("shared", { name: "target" });
  const foreign = member("shared", { name: "foreign", siteId: "99990002" });
  for (const blocks of [[target, foreign], [foreign, target]]) {
    const result = await compare([{ data: [row(blocks)], error: null }]);
    const profiles = (result.profile.value as StoredMerchantMembershipProfiles).memberships;
    assert.equal(profiles.length, blocks[1] === foreign ? 0 : 1);
  }
  const first = row([member("a", { name: "a first" }), member("b")]);
  const second = row([member("a", { name: "a last" })], { id: "row-2", slug: "", updated_at: older });
  for (const rows of [[first, second], [second, first]]) {
    const result = await compare([{ data: rows, error: null }]);
    const profiles = (result.profile.value as StoredMerchantMembershipProfiles).memberships;
    assert.deepEqual(profiles.map((item) => item.id), ["a", "b"]);
    assert.equal(profiles[0]!.name, rows[1] === second ? "a last" : "a first");
  }
  await compare([{ data: [row([target, member("shared", { updatedAt: older })]), row([foreign], { slug: "other" })], error: null }]);
});

test("row version reduction preserves invalid timestamps, whitespace and blank-slug matching", async () => {
  for (const versions of [["invalid", now], [now, "invalid"], [older, now], ["", " "]]) {
    await compare([{ data: versions.map((updated_at, index) => row([member("member-" + index)], {
      id: index, slug: index ? "   " : " " + slug + " ", updated_at,
    })), error: null }]);
  }
});

test("safe scalar histories skip actual deep transaction processing without truncating full histories", async () => {
  const transactions = Array.from({ length: 620 }, (_, index) => transaction(index, {
    at: `2032-01-${String(index % 28 + 1).padStart(2, "0")}T00:00:00.000Z`,
    balanceDelta: [undefined, null, "1.25", 2, true, false][index % 6],
    growthDelta: [undefined, null, "invalid", 3, true, false][index % 6],
  }));
  const rows = [row([member("one", { transactions }), member("two", { transactions })])];
  const result = await compare([{ data: rows, error: null }]);
  assert.equal(result.oldRuntime.counts.transactionEntries, 2 * 2 * 620);
  assert.equal(result.newRuntime.counts.transactionEntries, 0);
  assert.equal(result.newRuntime.counts.membershipRecords, 4);
  const untouched = runtime();
  const full = await untouched.store.loadStoredMerchantMemberships(reader([{ data: rows, error: null }]).client, siteId);
  assert.equal(full!.memberships[0]!.transactions.length, 620);
  assert.equal(full!.memberships[1]!.transactions.length, 620);
});

test("non-array histories and ignored transaction elements keep original profile success", async () => {
  for (const transactions of [undefined, null, false, 3, "legacy", {}, [null, false, 1, "text", [], [ { balanceDelta: { toString: null } } ]]]) {
    await compare([{ data: [row([member("one", { transactions })])], error: null }]);
  }
});

test("complex and non-JSON-scalar money falls back to complete legacy history normalization", async () => {
  for (const money of [{}, [], ["1.2"], { toString: null }, { toString: "not-callable" }, Symbol("synthetic"), BigInt(2), () => "3"]) {
    for (const field of ["balanceDelta", "growthDelta"]) {
      const result = await compare([{ data: [row([member("one", { transactions: [transaction(0, { [field]: money })] })])], error: null }]);
      assert.ok(result.newRuntime.counts.transactionEntries > 0);
      assert.equal(result.newRuntime.counts.transactionEntries, result.oldRuntime.counts.transactionEntries);
    }
  }
});

test("bad persisted JSON history still fails even in overwritten or foreign membership records", async () => {
  const bad = member("same", { transactions: [transaction(0, { balanceDelta: { toString: null } })] });
  for (const rows of [
    [row([bad])],
    [row([bad, member("same")])],
    [row([{ ...bad, siteId: "99990002" }, member("same")])],
    [row([bad]), row([member("same")], { id: "row-2" })],
  ]) {
    const result = await compare([{ data: jsonClone(rows), error: null }]);
    assert.deepEqual(result.profile, { kind: "error", name: "TypeError", message: "Cannot convert object to primitive value" });
  }
});

test("guard does not invent failures for invalid memberships or skipped invalid-date transactions", async () => {
  const bad = [transaction(0, { balanceDelta: { toString: null }, growthDelta: { toString: null } })];
  for (const overrides of [{ joinedAt: "" }, { joinedAt: "bad" }, { siteId: "" }, { accountId: "", userId: "" }]) {
    const result = await compare([{ data: [row([member("bad", { transactions: bad, ...overrides })])], error: null }]);
    assert.equal(result.profile.kind, "success");
  }
  for (const at of [undefined, null, "", "not-a-date"]) {
    const result = await compare([{ data: [row([member("skipped", { transactions: [transaction(0, { at, balanceDelta: { toString: null } })] })])], error: null }]);
    assert.equal(result.profile.kind, "success");
  }
  const ignoredRow = row([member("bad", { transactions: bad })], { slug: "unrelated" });
  await compare([{ data: [ignoredRow, row([member("good")])], error: null }]);
});

test("profile money failures still propagate instead of being hidden by safe-history stripping", async () => {
  for (const field of ["balanceAmount", "growthValue"]) {
    const result = await compare([{ data: [row([member("bad-profile", { [field]: { toString: null } })])], error: null }]);
    assert.equal(result.profile.kind, "error");
    assert.equal(result.profile.name, "TypeError");
  }
});

test("customer reads cannot mutate frozen rows/history and later full reads retain all original transactions", async () => {
  const rows = [row([member("safe"), member("fallback", { transactions: [transaction(0, { balanceDelta: [] })] })])];
  const before = JSON.stringify(rows);
  freezeDeep(rows);
  const run = runtime();
  const profile = await run.store.loadStoredMerchantMembershipProfiles(reader([{ data: rows, error: null }]).client, siteId);
  assert.ok(profile);
  profile.memberships[0]!.name = "mutated returned profile";
  profile.memberships[0]!.allergens.push("mutated returned allergens");
  assert.equal(JSON.stringify(rows), before);
  const after = await run.store.loadStoredMerchantMemberships(reader([{ data: rows, error: null }]).client, siteId);
  assert.equal(after!.memberships.length, 2);
  after!.memberships.forEach((item) => assert.equal(item.transactions.length, 1));
  assert.equal(JSON.stringify(rows), before);
});

test("unchanged full save still submits complete history to the existing atomic commit port", async () => {
  const raw = member("complete", { transactions: Array.from({ length: 620 }, (_, index) => transaction(index)) });
  const run = runtime();
  const membership = run.domain.normalizeMerchantMembershipRecord(raw);
  assert.ok(membership);
  const result = await run.store.saveStoredMerchantMemberships(reader([{ data: [row([raw])], error: null }]).client, {
    siteId, memberships: [membership], expectedUpdatedAt: now,
  });
  assert.deepEqual(jsonClone(result), { error: null });
  const commits = run.mutations as Array<{ siteId: string; mutation: { memberships: { next: MerchantMembershipRecord[]; expectedUpdatedAt: string } } }>;
  assert.equal(commits.length, 1);
  assert.equal(commits[0]!.mutation.memberships.next[0]!.transactions.length, 620);
  assert.equal(commits[0]!.mutation.memberships.expectedUpdatedAt, now);
});
