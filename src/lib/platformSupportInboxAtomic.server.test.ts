import assert from "node:assert/strict";
import test from "node:test";
import { loadPlatformSupportInboxAtomic, preparePlatformSupportInboxAtomic, savePlatformSupportInboxAtomic } from "./platformSupportInboxAtomic.server";
import { loadStoredPlatformSupportInbox, savePlatformSupportInbox, type PlatformSupportInboxStoreClient } from "./platformSupportInboxStore";
import { buildPlatformSupportInboxBlocks, type PlatformSupportInboxPayload } from "./platformSupportInbox";
import { PLATFORM_SNAPSHOT_ATOMIC_SCOPES, type PlatformSnapshotAtomicClient, type PlatformSnapshotAtomicView,
  type PlatformSnapshotAtomicExpected, type PlatformSnapshotAtomicWrite, type PlatformSnapshotJson } from "./platformSnapshotAtomic.server";

const at = "2026-09-08T12:00:00.000Z";
const version = "2026-09-08T12:00:00.123456+00:00";
const slugs = PLATFORM_SNAPSHOT_ATOMIC_SCOPES.support_messages;
function payload(id = "old", text = "original", stamp = at): PlatformSupportInboxPayload {
  return { threads: [{ merchantId: "10000000", siteId: "10000000", merchantName: "Synthetic", merchantEmail: "example@example.test",
    updatedAt: stamp, messages: [{ id, sender: "merchant", text, createdAt: stamp }] }] };
}
function historyEntry(id: string, stamp = "2026-01-01T12:00:00.000Z") {
  return { id, siteId: "platform-support-inbox", at: stamp, source: "old", before: payload(), after: payload("after") };
}
function fixture(): PlatformSnapshotAtomicView {
  const documents = [buildPlatformSupportInboxBlocks(payload()),
    { siteId: "platform-support-inbox", updatedAt: at, entries: [historyEntry("primary")] },
    { siteId: "platform-support-inbox", updatedAt: at, entries: [historyEntry("backup", "2026-01-02T12:00:00.000Z")] }];
  return { version: 1, scope: "support_messages", rows: slugs.map((slug, index) => ({ slug,
    row: { id: `00000000-0000-0000-0000-${String(index + 1).padStart(12, "0")}`, updatedAt: version,
      blocks: documents[index] as unknown as PlatformSnapshotJson } })) };
}
type Response = { data?: unknown; error?: unknown };
function clientFor(initial = fixture(), hook?: (name: string, args: Record<string, unknown>) => Promise<Response | undefined> | Response | undefined) {
  let stored = structuredClone(initial); let sequence = 0;
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const client: PlatformSnapshotAtomicClient = { rpc: async (name, args) => {
    calls.push({ name, args: structuredClone(args) }); const intercepted = await hook?.(name, args); if (intercepted) return intercepted;
    if (name === "faolla_read_platform_snapshot_rows_v1") return { data: structuredClone(stored), error: null };
    assert.equal(name, "faolla_commit_platform_snapshot_rows_v1");
    assert.deepEqual(args.p_expected, stored.rows, "must use untouched complete physical CAS rows");
    const writes = args.p_writes as PlatformSnapshotAtomicWrite[];
    const expected = args.p_expected as PlatformSnapshotAtomicExpected[];
    sequence++;
    stored = { version: 1, scope: "support_messages", rows: writes.map((item, index) => ({ slug: item.slug, row: {
      id: expected[index].row?.id ?? `00000000-0000-0000-0000-${String(index + 1).padStart(12, "0")}`,
      blocks: structuredClone(item.blocks), updatedAt: JSON.stringify(item.blocks) === JSON.stringify(expected[index].row?.blocks)
        ? expected[index].row!.updatedAt : `2026-09-08T12:00:${String(sequence).padStart(2, "0")}.999999+00:00`,
    } })) };
    return { data: structuredClone(stored), error: null };
  } };
  return { client, calls, state: () => structuredClone(stored), storeClient: { ...client, from() { assert.fail("atomic path must not query/write legacy pages"); } } as unknown as PlatformSupportInboxStoreClient };
}
function flags(t: { after(fn: () => void): void }, mode = "atomic", shadow = "off", sites = "10000000") {
  const values = { FAOLLA_PLATFORM_SNAPSHOT_WRITE_MODE: mode, MERCHANT_CONVERSATION_V1_DUAL_WRITE_MODE: shadow,
    MERCHANT_CONVERSATION_V1_DUAL_WRITE_SITE_IDS: sites };
  const prior = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]])); Object.assign(process.env, values);
  t.after(() => { for (const [key, value] of Object.entries(prior)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  } });
}
function historyIds(blocks: PlatformSnapshotJson) { return (blocks as { entries: Array<{ id: string }> }).entries.map((entry) => entry.id); }
function deferred() { let resolve!: () => void; const promise = new Promise<void>((done) => { resolve = done; }); return { promise, resolve }; }

test("ordinary plan preserves union, first-seen duplicate message, latest profile and physical microseconds", () => {
  const view = fixture(); const before = structuredClone(view);
  const incoming = payload("new", "new message", "2026-09-08T12:00:01.000Z");
  incoming.threads[0].merchantName = "Latest name";
  incoming.threads[0].messages.unshift({ ...payload().threads[0].messages[0], text: "must not overwrite original" });
  const plan = preparePlatformSupportInboxAtomic(view, incoming, { at, historyId: "new-history" });
  assert.deepEqual(plan.payload.threads[0].messages.map((entry) => entry.text), ["original", "new message"]);
  assert.equal(plan.payload.threads[0].merchantName, "Latest name");
  assert.deepEqual(historyIds(plan.writes[1].blocks), ["new-history", "primary"]);
  assert.deepEqual(historyIds(plan.writes[2].blocks), ["new-history", "backup", "primary"]);
  assert.deepEqual(view, before); assert.equal(view.rows[0].row?.updatedAt, version);
});

test("strict atomic plan retains existing merged primary/backup history semantics", () => {
  const plan = preparePlatformSupportInboxAtomic(fixture(), payload("new"), { at, historyId: "new-history", requireAllWrites: true });
  assert.deepEqual(plan.writes[1].blocks, plan.writes[2].blocks);
  assert.deepEqual(historyIds(plan.writes[1].blocks), ["new-history", "backup", "primary"]);
});

for (const strict of [false, true]) {
  test(`history keeps exactly the latest 20 entries, strict=${strict}`, () => {
    const view = fixture();
    const history = { siteId: "platform-support-inbox", updatedAt: at, entries: Array.from({ length: 25 }, (_, index) =>
      historyEntry(`entry-${index}`, new Date(Date.UTC(2026, 0, index + 1, 12)).toISOString())) };
    view.rows[1].row!.blocks = history as unknown as PlatformSnapshotJson; view.rows[2].row!.blocks = structuredClone(history) as unknown as PlatformSnapshotJson;
    const plan = preparePlatformSupportInboxAtomic(view, payload("new"), { at, historyId: "new-history", requireAllWrites: strict });
    for (const write of plan.writes.slice(1)) {
      assert.equal(historyIds(write.blocks).length, 20); assert.equal(historyIds(write.blocks)[0], "new-history");
      assert.equal(historyIds(write.blocks).at(-1), "entry-6");
    }
  });
}

test("atomic service performs one raw read and one commit for all three rows", async (t) => {
  flags(t); const store = clientFor(); const expected = store.state().rows;
  const result = await savePlatformSupportInboxAtomic(store.client, payload("new"));
  assert.equal(result.error, null); assert.equal(result.payload?.threads[0].messages.length, 2);
  assert.deepEqual(store.calls.map((call) => call.name), ["faolla_read_platform_snapshot_rows_v1", "faolla_commit_platform_snapshot_rows_v1"]);
  assert.deepEqual(store.calls[1].args.p_expected, expected);
  assert.equal((store.calls[1].args.p_writes as unknown[]).length, 3);
});

test("confirmed absent rows produce main inbox and both histories in the same plan", async (t) => {
  flags(t); const view = fixture(); view.rows.forEach((entry) => { entry.row = null; }); const store = clientFor(view);
  assert.equal((await savePlatformSupportInboxAtomic(store.client, payload("new"))).error, null);
  assert.ok((store.calls[1].args.p_expected as PlatformSnapshotAtomicExpected[]).every((entry) => entry.row === null));
  assert.ok(store.state().rows.every((entry) => entry.row));
});

for (const strict of [false, true]) {
  test(`atomic central store uses only RPC for ordinary/strict save, strict=${strict}`, async (t) => {
    flags(t); const store = clientFor();
    assert.equal((await savePlatformSupportInbox(store.storeClient, payload("new"), { requireAllWrites: strict })).error, null);
    assert.equal(store.calls.length, 2);
  });
  test(`atomic replace is unavailable before any read/write, strict=${strict}`, async (t) => {
    flags(t); const store = clientFor();
    assert.deepEqual(await savePlatformSupportInbox(store.storeClient, payload("new"), { replace: true, requireAllWrites: strict }),
      { error: "platform_snapshot_atomic_restore_unavailable", payload: null });
    assert.equal(store.calls.length, 0);
  });
}

test("atomic reads bypass a success cache and use a fresh whole-scope RPC every time", async (t) => {
  flags(t); const store = clientFor(); await savePlatformSupportInbox(store.storeClient, payload("new"));
  await loadStoredPlatformSupportInbox(store.storeClient); await loadStoredPlatformSupportInbox(store.storeClient, { strict: true });
  assert.deepEqual(store.calls.map((call) => call.name), ["faolla_read_platform_snapshot_rows_v1", "faolla_commit_platform_snapshot_rows_v1",
    "faolla_read_platform_snapshot_rows_v1", "faolla_read_platform_snapshot_rows_v1"]);
});

test("atomic mode with configured V1 shadow refuses before any RPC", async (t) => {
  flags(t, "atomic", "shadow"); const store = clientFor();
  assert.deepEqual(await savePlatformSupportInbox(store.storeClient, payload("new")), { error: "platform_snapshot_atomic_shadow_unsupported", payload: null });
  assert.equal(store.calls.length, 0);
});

test("empty V1 scope does not start mirroring and permits one atomic commit", async (t) => {
  flags(t, "atomic", "shadow", ""); const store = clientFor();
  assert.equal((await savePlatformSupportInbox(store.storeClient, payload("new"))).error, null);
  assert.equal(store.calls.length, 2);
});

for (const code of ["platform_snapshot_atomic_conflict", "platform_snapshot_atomic_store_corrupt", "platform_snapshot_atomic_write_unconfirmed"]) {
  test(`atomic ${code} returns fixed failure without retry or fallback`, async (t) => {
    flags(t); const store = clientFor(fixture(), (name) => name.includes("commit") ? { data: null, error: { code: "P0001", message: code } } : undefined);
    assert.deepEqual(await savePlatformSupportInbox(store.storeClient, payload("new")), { error: code, payload: null });
    assert.equal(store.calls.length, 2);
  });
}

for (const fault of ["missing-rpc", "throw", "null-ack", "wrong-body-ack"] as const) {
  test(`atomic ${fault} does not downgrade to legacy writing`, async (t) => {
    flags(t); const store = clientFor(fixture(), (name) => {
      if (!name.includes("commit")) return;
      if (fault === "throw") throw new Error("private transport details");
      if (fault === "null-ack") return { data: null, error: null };
      if (fault === "wrong-body-ack") return { data: fixture(), error: null };
    });
    if (fault === "missing-rpc") delete (store.storeClient as { rpc?: unknown }).rpc;
    assert.deepEqual(await savePlatformSupportInbox(store.storeClient, payload("new")), { error: "platform_snapshot_atomic_write_unconfirmed", payload: null });
    assert.equal(store.calls.length, fault === "missing-rpc" ? 0 : 2);
  });
}

for (const damage of ["history-shape", "duplicate-history", "conflicting-history", "unknown-history-field", "unknown-inbox-field", "malformed-message"] as const) {
  test(`atomic raw ${damage} rejects before commit and also fails fresh reading`, async (t) => {
    flags(t); const view = fixture();
    const old = view.rows[1].row!.blocks as { entries: PlatformSnapshotJson[]; [key: string]: PlatformSnapshotJson };
    if (damage === "history-shape") Reflect.deleteProperty(old, "entries");
    if (damage === "duplicate-history") old.entries.push(structuredClone(old.entries[0]));
    if (damage === "conflicting-history") view.rows[2].row!.blocks = { ...old, entries: [{ ...historyEntry("primary"), before: { tampered: true } }] } as unknown as PlatformSnapshotJson;
    if (damage === "unknown-history-field") old.mustNotDrop = true;
    const inbox = view.rows[0].row!.blocks as unknown as Array<{ props: { payload: { threads: Array<{ messages: unknown }> }; future?: unknown } }>;
    if (damage === "unknown-inbox-field") inbox[0].props.future = { mustNotDrop: true };
    if (damage === "malformed-message") inbox[0].props.payload.threads[0].messages = [null];
    const store = clientFor(view);
    assert.deepEqual(await savePlatformSupportInboxAtomic(store.client, payload("new")), { error: "platform_snapshot_atomic_store_corrupt", payload: null });
    assert.equal(store.calls.length, 1);
    await assert.rejects(loadPlatformSupportInboxAtomic(store.client), { message: "platform_snapshot_atomic_store_corrupt" });
  });
}

test("payload mutations during raw read cannot change the captured incoming message", { timeout: 5000 }, async (t) => {
  flags(t); const barrier = deferred(); const incoming = payload("captured", "original request");
  const store = clientFor(fixture(), async (name) => { if (name.includes("read")) await barrier.promise; return undefined; });
  const operation = savePlatformSupportInboxAtomic(store.client, incoming);
  incoming.threads[0].messages[0].text = "later mutation"; barrier.resolve();
  const result = await operation;
  assert.equal(result.payload?.threads[0].messages.find((entry) => entry.id === "captured")?.text, "original request");
});

test("options mutations during raw read cannot change the selected strict history plan", { timeout: 5000 }, async (t) => {
  flags(t); const barrier = deferred(); const options = { requireAllWrites: true, replace: false };
  const store = clientFor(fixture(), async (name) => { if (name.includes("read")) await barrier.promise; return undefined; });
  const operation = savePlatformSupportInboxAtomic(store.client, payload("captured"), options);
  options.requireAllWrites = false; options.replace = true; barrier.resolve();
  assert.equal((await operation).error, null);
  const writes = store.calls[1].args.p_writes as PlatformSnapshotAtomicWrite[];
  assert.deepEqual(writes[1].blocks, writes[2].blocks);
});

test("central support queue waits for first atomic completion before preparing the next request", { timeout: 5000 }, async (t) => {
  flags(t); const barrier = deferred(); const entered = deferred(); let commits = 0;
  const store = clientFor(fixture(), async (name) => { if (name.includes("commit") && ++commits === 1) { entered.resolve(); await barrier.promise; } return undefined; });
  const first = savePlatformSupportInbox(store.storeClient, payload("first")); await entered.promise;
  const second = savePlatformSupportInbox(store.storeClient, payload("second"));
  await new Promise((resolve) => setTimeout(resolve, 5)); assert.equal(store.calls.length, 2);
  barrier.resolve(); assert.equal((await first).error, null); assert.equal((await second).error, null);
  assert.equal(store.calls.length, 4); assert.equal((await loadPlatformSupportInboxAtomic(store.client)).threads[0].messages.length, 3);
});

test("invalid mode fails closed without calling old or atomic storage", async (t) => {
  flags(t, "typo"); const store = clientFor();
  assert.deepEqual(await savePlatformSupportInbox(store.storeClient, payload("new")), { error: "platform_snapshot_atomic_configuration_invalid", payload: null });
  await assert.rejects(loadStoredPlatformSupportInbox(store.storeClient), { message: "platform_snapshot_atomic_configuration_invalid" });
  assert.equal(store.calls.length, 0);
});

test("default-off still selects the existing ordinary writer", async (t) => {
  flags(t, "off"); let legacyCalls = 0; let rpcCalls = 0;
  const client = { from() { legacyCalls++; throw new Error("legacy-path"); }, rpc: async () => { rpcCalls++; return { error: null }; } } as unknown as PlatformSupportInboxStoreClient;
  await assert.rejects(savePlatformSupportInbox(client, payload("new")), { message: "legacy-path" });
  assert.equal(legacyCalls, 1); assert.equal(rpcCalls, 0);
});
