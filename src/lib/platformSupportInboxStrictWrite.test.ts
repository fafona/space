import assert from "node:assert/strict";
import test from "node:test";
import { saveMerchantSnapshotHistory } from "./merchantSnapshotHistoryStore";
import { loadStoredPlatformSupportInbox, savePlatformSupportInbox, type PlatformSupportInboxStoreClient } from "./platformSupportInboxStore";
import { buildPlatformSupportInboxBlocks, PLATFORM_SUPPORT_INBOX_SLUG, type PlatformSupportInboxPayload } from "./platformSupportInbox";
import { PLATFORM_ADMIN_BACKUP_WRITE_UNCONFIRMED } from "./platformAdminBackupStrictWrite";

const PRIMARY = "__platform_support_inbox_history__";
const BACKUP = "__platform_support_inbox_history_backup__";
const SITE = "platform-support-inbox";
const AT = "2026-09-08T12:00:00.000Z";
const error = PLATFORM_ADMIN_BACKUP_WRITE_UNCONFIRMED;
type Row = { id: string; slug: string; merchant_id: string | null; blocks: unknown; updated_at?: string };
type Result = { data?: unknown; error: unknown };
type Event = { kind: "read" | "write"; slug: string; scoped: boolean; columns: string };
type Fault = (event: Event) => Promise<Result | undefined> | Result | undefined;
function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
function emptyHistory() { return { siteId: SITE, updatedAt: AT, entries: [] }; }
function support(text = "original"): PlatformSupportInboxPayload {
  return { threads: [{ merchantId: "10000000", siteId: "10000000", merchantName: "Synthetic", merchantEmail: "example@example.test",
    updatedAt: AT, messages: [{ id: "message-one", sender: "merchant", text, createdAt: AT }] }] };
}
function historyInput() {
  return { siteId: SITE, slug: PRIMARY, backupSlug: BACKUP, source: "test", before: support(), after: support("restored"),
    at: AT, merchantId: null, requireAllWrites: true };
}
function memoryStore(initial?: Row[], fault?: Fault) {
  const rows: Row[] = clone(initial ?? [
    { id: "support", slug: PLATFORM_SUPPORT_INBOX_SLUG, merchant_id: null, blocks: buildPlatformSupportInboxBlocks(support()) },
    { id: "primary", slug: PRIMARY, merchant_id: null, blocks: emptyHistory() },
    { id: "backup", slug: BACKUP, merchant_id: null, blocks: emptyHistory() },
  ]);
  const events: Event[] = [];
  const client = { from() {
    const filters = new Map<string, unknown>(); let mode = "read"; let body: Record<string, unknown> = {}; let columns = ""; let limit = Infinity;
    const execute = async (single: boolean): Promise<Result> => {
      const matches = rows.filter((row) => [...filters].every(([field, value]) => row[field as keyof Row] === value));
      const slug = String(filters.get("slug") ?? body.slug ?? matches[0]?.slug ?? "");
      const event: Event = { kind: mode === "read" ? "read" : "write", slug, scoped: filters.has("merchant_id"), columns };
      events.push(event); const injected = await fault?.(event); if (injected) return injected;
      if (mode === "insert") {
        rows.push({ ...clone(body), id: `insert-${rows.length}` } as Row); return { data: null, error: null };
      }
      if (mode === "update") matches.forEach((row) => Object.assign(row, clone(body)));
      const result = matches.slice(0, limit);
      return single ? result.length > 1 ? { data: null, error: { message: "duplicate" } }
        : { data: result[0] ? structuredClone(result[0]) : null, error: null }
        : { data: structuredClone(result), error: null };
    };
    const query = {
      select(value: string) { columns = value; return query; },
      eq(key: string, value: unknown) { filters.set(key, value); return query; },
      is(key: string, value: unknown) { filters.set(key, value); return query; },
      limit(value: number) { limit = value; return query; },
      update(value: Record<string, unknown>) { mode = "update"; body = value; return query; },
      insert(value: Record<string, unknown>) { mode = "insert"; body = value; return execute(false); },
      maybeSingle() { return execute(true); },
      then<TResult1 = Result, TResult2 = never>(onfulfilled?: ((value: Result) => TResult1 | PromiseLike<TResult1>) | null,
        onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null) { return execute(false).then(onfulfilled, onrejected); },
    };
    return query;
  } } as PlatformSupportInboxStoreClient;
  return { client, rows, events };
}
function shadowFlags(t: { after(fn: () => void): void }, mode = "off", sites = "10000000") {
  const flags = { MERCHANT_CONVERSATION_V1_DUAL_WRITE_MODE: mode, MERCHANT_CONVERSATION_V1_DUAL_WRITE_SITE_IDS: sites,
    MERCHANT_CONVERSATION_V1_DUAL_WRITE_TIMEOUT_MS: "250" };
  const previous = Object.fromEntries(Object.keys(flags).map((key) => [key, process.env[key]]));
  Object.assign(process.env, flags);
  t.after(() => { for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  } });
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }

test("required support restore confirms both histories before the main write", async (t) => {
  shadowFlags(t); const store = memoryStore();
  const result = await savePlatformSupportInbox(store.client, support("restored"), { replace: true, requireAllWrites: true });
  assert.equal(result.error, null);
  assert.deepEqual(store.events.filter((event) => event.kind === "write").map((event) => event.slug), [PRIMARY, BACKUP, PLATFORM_SUPPORT_INBOX_SLUG]);
  assert.deepEqual(result.payload, support("restored"));
  assert.ok(store.events.filter((event) => event.kind === "write").every((event) => event.scoped));
});

for (const slug of [PRIMARY, BACKUP]) for (const kind of ["error", "throw"] as const) {
  test(`required support history ${slug} ${kind} is fixed failure and blocks main write`, async (t) => {
    shadowFlags(t); const store = memoryStore(undefined, (event) => {
      if (event.kind === "write" && event.slug === slug) {
        if (kind === "throw") throw new Error("private history details");
        return { data: null, error: { message: "private history details" } };
      }
    });
    const result = await savePlatformSupportInbox(store.client, support("restored"), { replace: true, requireAllWrites: true });
    assert.deepEqual(result, { error, payload: null });
    assert.equal(store.events.some((event) => event.kind === "write" && event.slug === PLATFORM_SUPPORT_INBOX_SLUG), false);
    assert.deepEqual(store.rows.find((row) => row.slug === PLATFORM_SUPPORT_INBOX_SLUG)?.blocks, buildPlatformSupportInboxBlocks(support()));
  });
}

for (const slug of [PRIMARY, BACKUP]) {
  test(`strict history ${slug} read failure is not empty and writes nothing`, async () => {
    const store = memoryStore(undefined, (event) => event.kind === "read" && event.slug === slug
      ? { data: null, error: { message: "column pages.merchant_id does not exist" } } : undefined);
    assert.deepEqual(await saveMerchantSnapshotHistory(store.client, historyInput()), { error });
    assert.equal(store.events.filter((event) => event.kind === "write").length, 0);
  });
}

test("history waits for every started read even when the first read rejects", async () => {
  const pending = deferred<Result>(); const began = deferred<void>(); let finished = false;
  const store = memoryStore(undefined, (event) => {
    if (event.slug === PRIMARY) throw new Error("read failed");
    if (event.slug === BACKUP) { began.resolve(); return pending.promise; }
  });
  const operation = saveMerchantSnapshotHistory(store.client, historyInput()).then((value) => { finished = true; return value; });
  await began.promise; await new Promise((resolve) => setTimeout(resolve, 5)); assert.equal(finished, false);
  pending.resolve({ data: null, error: { message: "second read settled" } });
  assert.deepEqual(await operation, { error });
  assert.equal(store.events.filter((event) => event.kind === "write").length, 0);
});

for (const damage of ["duplicate-row", "foreign-owner", "missing-entries", "wrong-site", "duplicate-entry", "unknown-field", "invalid-json", "conflicting-copies"] as const) {
  test(`required history rejects ${damage} before writing`, async () => {
    const store = memoryStore(); const row = store.rows.find((item) => item.slug === BACKUP)!;
    const entry = { id: "old-one", siteId: SITE, at: AT, source: "old", before: {}, after: {} };
    if (damage === "duplicate-row") store.rows.push({ ...row, id: "duplicate" });
    if (damage === "foreign-owner") row.merchant_id = "10000001";
    if (damage === "missing-entries") row.blocks = { siteId: SITE, updatedAt: AT };
    if (damage === "wrong-site") row.blocks = { ...emptyHistory(), siteId: "foreign" };
    if (damage === "duplicate-entry") row.blocks = { ...emptyHistory(), entries: [entry, entry] };
    if (damage === "unknown-field") row.blocks = { ...emptyHistory(), lost: [1] };
    if (damage === "invalid-json") row.blocks = { ...emptyHistory(), entries: [{ ...entry, before: Number.NaN }] };
    if (damage === "conflicting-copies") {
      row.blocks = { ...emptyHistory(), entries: [entry] };
      store.rows.find((item) => item.slug === PRIMARY)!.blocks = { ...emptyHistory(), entries: [{ ...entry, after: { changed: true } }] };
    }
    assert.deepEqual(await saveMerchantSnapshotHistory(store.client, historyInput()), { error });
    assert.equal(store.events.filter((event) => event.kind === "write").length, 0);
  });
}

test("required support pre-read is strict and cannot overwrite malformed messages", async (t) => {
  shadowFlags(t); const store = memoryStore();
  const blocks = buildPlatformSupportInboxBlocks(support()) as unknown as Array<{ props: { payload: { threads: unknown } } }>;
  blocks[0].props.payload.threads = "bad"; store.rows[0].blocks = blocks;
  assert.deepEqual(await savePlatformSupportInbox(store.client, support("restored"), { replace: true, requireAllWrites: true }), { error, payload: null });
  assert.equal(store.events.filter((event) => event.kind === "write").length, 0);
});

test("required history accepts confirmed absence and writes both scoped rows", async () => {
  const store = memoryStore([]);
  assert.deepEqual(await saveMerchantSnapshotHistory(store.client, historyInput()), { error: null });
  assert.equal(store.rows.length, 2); assert.ok(store.rows.every((row) => row.merchant_id === null));
});

test("ordinary history keeps its best-effort backup-error behavior", async (t) => {
  t.mock.method(console, "error", () => undefined);
  const store = memoryStore(undefined, (event) => event.kind === "write" && event.slug === BACKUP
    ? { data: null, error: { message: "ordinary backup unavailable" } } : undefined);
  assert.deepEqual(await saveMerchantSnapshotHistory(store.client, { ...historyInput(), requireAllWrites: false }), { error: null });
});

for (const status of ["error", "throw", "missing-rpc"] as const) {
  test(`required enabled support shadow ${status} cannot be reported as success`, async (t) => {
    shadowFlags(t, "shadow"); const store = memoryStore();
    if (status !== "missing-rpc") store.client.rpc = async () => {
      if (status === "throw") throw new Error("private shadow details"); return { error: { message: "private shadow details" } };
    };
    assert.deepEqual(await savePlatformSupportInbox(store.client, support("restored"), { replace: true, requireAllWrites: true }), { error, payload: null });
    // The main row already changed: failure is partial/unknown, not zero-write.
    assert.ok(store.events.some((event) => event.kind === "write" && event.slug === PLATFORM_SUPPORT_INBOX_SLUG));
    const reads = store.events.length; await loadStoredPlatformSupportInbox(store.client);
    assert.ok(store.events.length > reads, "failed restore must not leave a success cache");
  });
}

test("required empty shadow scope is a legitimate no-op", async (t) => {
  shadowFlags(t, "shadow", ""); const store = memoryStore();
  store.client.rpc = async () => assert.fail("empty scope cannot call RPC");
  assert.equal((await savePlatformSupportInbox(store.client, support("restored"), { replace: true, requireAllWrites: true })).error, null);
});

test("required shadow timeout waits for late RPC settlement and does not retry", async (t) => {
  shadowFlags(t, "shadow"); const store = memoryStore(); const rpc = deferred<{ data: number }>(); const began = deferred<void>();
  let calls = 0; let finished = false;
  store.client.rpc = () => { calls++; began.resolve(); return rpc.promise; };
  const operation = savePlatformSupportInbox(store.client, support("restored"), { replace: true, requireAllWrites: true })
    .then((value) => { finished = true; return value; });
  await began.promise; await new Promise((resolve) => setTimeout(resolve, 280));
  assert.equal(finished, false);
  rpc.resolve({ data: 1 }); assert.deepEqual(await operation, { error, payload: null }); assert.equal(calls, 1);
});

test("required timeout holds the support queue until the original shadow write settles", async (t) => {
  shadowFlags(t, "shadow"); const store = memoryStore(); const rpc = deferred<{ data: number }>(); const began = deferred<void>();
  let calls = 0;
  store.client.rpc = () => { calls++; if (calls === 1) { began.resolve(); return rpc.promise; } return Promise.resolve({ data: 1, error: null }); };
  const first = savePlatformSupportInbox(store.client, support("first"), { replace: true, requireAllWrites: true });
  await began.promise;
  const second = savePlatformSupportInbox(store.client, support("second"), { replace: true, requireAllWrites: true });
  await new Promise((resolve) => setTimeout(resolve, 280));
  assert.equal(store.events.filter((event) => event.kind === "write").length, 3); assert.equal(calls, 1);
  rpc.resolve({ data: 1 });
  assert.deepEqual(await first, { error, payload: null });
  assert.equal((await second).error, null); assert.equal(calls, 2);
  assert.equal(store.events.filter((event) => event.kind === "write").length, 6);
});

for (const data of [null, {}, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
  test(`required shadow rejects non-integer acknowledgement ${JSON.stringify(data)}`, async (t) => {
    shadowFlags(t, "shadow"); const store = memoryStore(); store.client.rpc = async () => ({ data, error: null });
    assert.deepEqual(await savePlatformSupportInbox(store.client, support("restored"), { replace: true, requireAllWrites: true }), { error, payload: null });
  });
}

test("required shadow accepts a legitimate zero count acknowledgement", async (t) => {
  shadowFlags(t, "shadow"); const store = memoryStore(); store.client.rpc = async () => ({ data: 0, error: null });
  assert.equal((await savePlatformSupportInbox(store.client, support("restored"), { replace: true, requireAllWrites: true })).error, null);
});

test("ordinary support saves retain best-effort shadow compatibility", async (t) => {
  shadowFlags(t, "shadow"); t.mock.method(console, "error", () => undefined);
  const store = memoryStore(); store.client.rpc = async () => ({ error: { message: "ordinary shadow failed" } });
  assert.equal((await savePlatformSupportInbox(store.client, support("ordinary"), { replace: true })).error, null);
});
