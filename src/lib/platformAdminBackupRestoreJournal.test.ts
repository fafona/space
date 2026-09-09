import assert from "node:assert/strict";
import test from "node:test";
import { STORAGE_KEY, LOCK_NAME, readRestoreJournal, writeRestoreJournalAhead, clearRestoreJournalExact,
  withRestoreJournalExclusive, withRestoreJournalWriter, type RestoreJournalLockManager,
  type RestoreJournalStorage } from "./platformAdminBackupRestoreJournal";

function attempt() {
  return { binding: { operationId: "00000000-0000-4000-8000-000000000001", scope: "user_manage" as const,
    backupId: "synthetic-backup", confirmationToken: `v1.${"c".repeat(64)}` }, deviceId: "verified-synthetic-device" };
}
function storage(initial: string | null = null) {
  let value = initial; let sets = 0; let removes = 0;
  const api: RestoreJournalStorage = {
    getItem(key) { assert.equal(key, STORAGE_KEY); return value; },
    setItem(key, next) { assert.equal(key, STORAGE_KEY); sets++; value = next; },
    removeItem(key) { assert.equal(key, STORAGE_KEY); removes++; value = null; },
  };
  return { api, get value() { return value; }, set value(next: string | null) { value = next; },
    get sets() { return sets; }, get removes() { return removes; } };
}
const record = (value: unknown = attempt()) => JSON.stringify({ version: 1, attempt: value });
function deferred() { let resolve!: () => void; const promise = new Promise<void>((done) => { resolve = done; }); return { promise, resolve }; }
function locks() {
  let shared = 0; let exclusive = false;
  const requests: string[] = [];
  const api: RestoreJournalLockManager = { async request(name, options, callback) {
    assert.equal(name, LOCK_NAME); assert.equal(options.ifAvailable, true); requests.push(options.mode);
    if (exclusive || (options.mode === "exclusive" && shared > 0)) return callback(null);
    if (options.mode === "exclusive") exclusive = true; else shared++;
    try { return await callback({ name, mode: options.mode }); }
    finally { if (options.mode === "exclusive") exclusive = false; else shared--; }
  } };
  return { api, requests };
}

test("journal writes only version and immutable attempt, validates readback and clears that exact record", () => {
  const s = storage(); const original = attempt(); assert.deepEqual(readRestoreJournal(s.api), { status: "empty" });
  const captured = writeRestoreJournalAhead(s.api, original); original.deviceId = "changed"; original.binding.backupId = "changed";
  assert.deepEqual(JSON.parse(s.value!), { version: 1, attempt: captured });
  assert.ok(Object.isFrozen(captured)); assert.ok(Object.isFrozen(captured.binding));
  assert.deepEqual(readRestoreJournal(s.api), { status: "pending", attempt: captured });
  assert.equal(s.sets, 1); clearRestoreJournalExact(s.api, captured);
  assert.deepEqual(readRestoreJournal(s.api), { status: "empty" }); assert.equal(s.removes, 1);
});

test("journal accepts semantic readback with changed JSON whitespace and field order", () => {
  const s = storage();
  s.api.setItem = (_key, value) => {
    const parsed = JSON.parse(value); s.value = JSON.stringify({ attempt: { deviceId: parsed.attempt.deviceId,
      binding: Object.fromEntries(Object.entries(parsed.attempt.binding).reverse()) }, version: 1 }, null, 2);
  };
  assert.deepEqual(writeRestoreJournalAhead(s.api, attempt()), attempt());
  clearRestoreJournalExact(s.api, attempt()); assert.equal(s.value, null);
});

test("journal rejects malformed, overlong, duplicate-key and unknown state records without changing storage", () => {
  for (const value of ["", "null", "[]", "{}", "not-json", `${record()} trailing`, " ".repeat(8193),
    JSON.stringify({ version: 2, attempt: attempt() }), JSON.stringify({ version: 1, attempt: attempt(), status: "committed" }),
    record({ ...attempt(), receipt: {} }), record({ ...attempt(), deviceId: " trimmed " }),
    record({ ...attempt(), deviceId: "x".repeat(501) }), record({ ...attempt(), deviceId: "" }),
    record({ ...attempt(), binding: { ...attempt().binding, actorKey: "a".repeat(64) } }),
    record().replace('"version":1', '"version":0,"version":1'),
    record().replace('"deviceId":', '"deviceId":"wrong","deviceId":'),
    record().replace('"deviceId":', '"deviceId":"wrong","\\u0064eviceId":'),
  ]) {
    const s = storage(value); assert.deepEqual(readRestoreJournal(s.api), { status: "unavailable" });
    assert.throws(() => writeRestoreJournalAhead(s.api, attempt()), /restore_journal_unavailable/);
    assert.throws(() => clearRestoreJournalExact(s.api, attempt()), /restore_journal_clear_unconfirmed/);
    assert.equal(s.value, value); assert.equal(s.sets, 0); assert.equal(s.removes, 0);
  }
});

test("journal raw input refuses getters, symbols, nonplain prototypes and state or credentials at every level", () => {
  let getters = 0;
  for (const value of [
    { ...attempt(), status: "pending" }, { ...attempt(), token: "PRIVATE" },
    { ...attempt(), binding: { ...attempt().binding, membership: { name: "PRIVATE" } } },
    Object.assign(Object.create({ extra: true }), attempt()),
    { ...attempt(), [Symbol("extra")]: true },
    Object.defineProperty({ ...attempt() }, "deviceId", { enumerable: true, get() { getters++; return "PRIVATE"; } }),
  ]) {
    const s = storage(); assert.throws(() => writeRestoreJournalAhead(s.api, value), /^Error: restore_journal_unavailable$/);
    assert.equal(s.sets, 0); assert.equal(s.value, null);
  }
  assert.equal(getters, 0);
});

test("journal read failures and unavailable storage never become an empty record", () => {
  const s = storage(); s.api.getItem = () => { throw new Error("PRIVATE storage error"); };
  for (const value of [s.api, undefined, null]) {
    assert.deepEqual(readRestoreJournal(value), { status: "unavailable" });
    assert.throws(() => writeRestoreJournalAhead(value, attempt()), /^Error: restore_journal_unavailable$/);
  }
  assert.equal(s.sets, 0);
});

test("journal quota, silent set failures, corrupt and foreign readbacks fail without compensating deletion", () => {
  for (const mode of ["quota", "ignored", "corrupt", "foreign", "throw-readback"]) {
    const s = storage();
    s.api.setItem = () => {
      if (mode === "quota") throw new Error("PRIVATE quota");
      if (mode === "corrupt") s.value = "bad";
      if (mode === "foreign") s.value = record({ ...attempt(), deviceId: "another-device" });
      if (mode === "throw-readback") s.api.getItem = () => { throw new Error("PRIVATE readback"); };
    };
    assert.throws(() => writeRestoreJournalAhead(s.api, attempt()), /^Error: restore_journal_write_unconfirmed$/);
    assert.equal(s.removes, 0);
  }
});

test("existing same or foreign pending operations are never overwritten", () => {
  for (const value of [attempt(), { ...attempt(), deviceId: "another-device" }]) {
    const s = storage(record(value)); const before = s.value;
    assert.throws(() => writeRestoreJournalAhead(s.api, attempt()), /restore_journal_pending/);
    assert.equal(s.value, before); assert.equal(s.sets, 0); assert.equal(s.removes, 0);
  }
});

test("clear only deletes a validated exact matching operation and verifies actual removal", () => {
  const foreign = { ...attempt(), binding: { ...attempt().binding, operationId: "00000000-0000-4000-8000-000000000002" } };
  for (const value of [null, "bad", record(foreign), record({ ...attempt(), deviceId: "foreign" })]) {
    const s = storage(value); assert.throws(() => clearRestoreJournalExact(s.api, attempt()), /restore_journal_clear_unconfirmed/);
    assert.equal(s.removes, 0); assert.equal(s.value, value);
  }
  for (const mode of ["throw", "ignored", "foreign", "corrupt", "readback-throws"]) {
    const s = storage(record()); s.api.removeItem = () => {
      if (mode === "throw") throw new Error("PRIVATE remove");
      if (mode === "foreign") s.value = record(foreign);
      if (mode === "corrupt") s.value = "bad";
      if (mode === "readback-throws") s.api.getItem = () => { throw new Error("PRIVATE readback"); };
    };
    assert.throws(() => clearRestoreJournalExact(s.api, attempt()), /^Error: restore_journal_clear_unconfirmed$/);
  }
});

test("exclusive journal lock requires Web Locks and does not retry an unavailable lock", async () => {
  let callbacks = 0; let requests = 0;
  const held: RestoreJournalLockManager = { async request(_name, options, callback) {
    requests++; assert.deepEqual(options, { mode: "exclusive", ifAvailable: true }); return callback(null);
  } };
  for (const value of [null, undefined, held, { request: async () => { throw new Error("PRIVATE lock error"); } }]) {
    await assert.rejects(withRestoreJournalExclusive(value, () => { callbacks++; }), /^Error: restore_journal_lock_unavailable$/);
  }
  assert.equal(callbacks, 0); assert.equal(requests, 1);
});

test("exclusive lock stays held for its callback, rejects writers/restores and releases on completion", async () => {
  const l = locks(); const s = storage(); const entered = deferred(); const finish = deferred();
  const active = withRestoreJournalExclusive(l.api, async () => { entered.resolve(); await finish.promise; return 42; });
  await entered.promise;
  try {
    await assert.rejects(withRestoreJournalExclusive(l.api, () => assert.fail("second restore")), /restore_journal_lock_unavailable/);
    await assert.rejects(withRestoreJournalWriter(s.api, l.api, () => assert.fail("writer during restore")), /restore_journal_lock_unavailable/);
  } finally { finish.resolve(); }
  assert.equal(await active, 42);
  assert.equal(await withRestoreJournalWriter(s.api, l.api, () => 7), 7);
});

test("shared writers may coexist but a pending writer blocks exclusive restore until all settle", async () => {
  const l = locks(); const s = storage(); const entered = deferred(); const finish = deferred();
  const first = withRestoreJournalWriter(s.api, l.api, async () => { entered.resolve(); await finish.promise; return 1; });
  await entered.promise;
  try {
    assert.equal(await withRestoreJournalWriter(s.api, l.api, () => 2), 2);
    await assert.rejects(withRestoreJournalExclusive(l.api, () => assert.fail("restore during writer")), /restore_journal_lock_unavailable/);
  } finally { finish.resolve(); }
  assert.equal(await first, 1); assert.equal(await withRestoreJournalExclusive(l.api, () => 3), 3);
});

test("shared writer checks the journal inside the lock and pending/corrupt/unavailable records block callbacks", async () => {
  let callbacks = 0;
  for (const value of [record(), "bad"]) {
    const s = storage(value); const l = locks();
    await assert.rejects(withRestoreJournalWriter(s.api, l.api, () => { callbacks++; }), /restore_journal_(pending|unavailable)/);
    assert.deepEqual(l.requests, ["shared"]);
  }
  const s = storage(); const l = locks();
  const race: RestoreJournalLockManager = { request(name, options, callback) {
    s.value = record(); return l.api.request(name, options, callback);
  } };
  await assert.rejects(withRestoreJournalWriter(s.api, race, () => { callbacks++; }), /restore_journal_pending/);
  await assert.rejects(withRestoreJournalWriter(undefined, l.api, () => { callbacks++; }), /restore_journal_unavailable/);
  assert.equal(callbacks, 0);
});

test("without Web Locks only an empty journal permits ordinary writes; atomic restore remains unavailable", async () => {
  const s = storage(); assert.equal(await withRestoreJournalWriter(s.api, undefined, () => "ordinary"), "ordinary");
  s.value = record(); await assert.rejects(withRestoreJournalWriter(s.api, undefined, () => assert.fail("pending")), /restore_journal_pending/);
  s.value = "bad"; await assert.rejects(withRestoreJournalWriter(s.api, null, () => assert.fail("corrupt")), /restore_journal_unavailable/);
  await assert.rejects(withRestoreJournalWriter(null, null, () => assert.fail("no storage")), /restore_journal_unavailable/);
  await assert.rejects(withRestoreJournalExclusive(undefined, () => assert.fail("no lock restore")), /restore_journal_lock_unavailable/);
});

test("callback failures preserve their meaning and release locks rather than pretending acquisition failed", async () => {
  const l = locks(); const failure = new Error("synthetic write outcome unknown");
  await assert.rejects(withRestoreJournalExclusive(l.api, async () => { throw failure; }), (error) => error === failure);
  await assert.rejects(withRestoreJournalWriter(storage().api, l.api, async () => { throw failure; }), (error) => error === failure);
  assert.equal(await withRestoreJournalExclusive(l.api, () => true), true);
});

test("journal capture precedes storage callbacks that can mutate caller-owned input", () => {
  const original = attempt(); const s = storage(); const read = s.api.getItem;
  s.api.getItem = (key) => { original.deviceId = "changed-by-storage"; return read(key); };
  const captured = writeRestoreJournalAhead(s.api, original);
  assert.equal(captured.deviceId, "verified-synthetic-device");
  assert.equal(JSON.parse(s.value!).attempt.deviceId, "verified-synthetic-device");
});
