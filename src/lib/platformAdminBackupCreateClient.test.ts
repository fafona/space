import assert from "node:assert/strict";
import test from "node:test";
import { parsePlatformAdminBackupCreateAck } from "./platformAdminBackupCreateClient";
import { createPlatformAdminBackupRestoreSyncGuard } from "./platformAdminBackupRestoreClient";

function item(id = "synthetic-backup") {
  return { id, at: "2026-09-09T11:30:00.000Z", operator: "测试管理员", source: "manual" as const,
    scheduleDateKey: null, summary: "合成快照", userManageCounts: { siteCount: 1, userCount: 2, roleCount: 3,
      merchantAccountCount: 4, merchantSnapshotCount: 5, merchantConfigBackupCount: 6 },
    supportCounts: { threadCount: 7, messageCount: 8 } };
}
function ack() { const backup = item(); return { ok: true, created: true, backup, backups: [backup] }; }

test("create ACK accepts both actual POST forms and returns only detached summary data", () => {
  const input = ack();
  const result = parsePlatformAdminBackupCreateAck(input);
  assert.deepEqual(result, { created: true, backups: [item()] });
  assert.deepEqual(parsePlatformAdminBackupCreateAck({ ok: true, created: false, backups: [] }), { created: false, backups: [] });
  assert.deepEqual(parsePlatformAdminBackupCreateAck({ ok: true, created: false, backups: [item()] }), { created: false, backups: [item()] });
  input.backups[0].userManageCounts.siteCount = 99;
  input.backups[0].summary = "changed";
  assert.deepEqual(result?.backups, [item()]);
});

test("create ACK accepts eight summaries and semantically identical reordered keys", () => {
  const backups = Array.from({ length: 8 }, (_, index) => item(`backup-${index}`));
  const backup: Record<string, unknown> = Object.fromEntries(Object.entries(backups[2]).reverse());
  backup.userManageCounts = Object.fromEntries(Object.entries(backups[2].userManageCounts).reverse());
  assert.deepEqual(parsePlatformAdminBackupCreateAck({ ok: true, created: true, backups, backup }), { created: true, backups });
});

test("missing, error, partial, legacy and contradictory envelopes never acknowledge a write", () => {
  for (const input of [null, undefined, [], {}, { backups: [] }, { ok: true, backups: [] },
    { ok: true, created: 1, backups: [] }, { ok: false, created: false, backups: [] },
    { ok: true, created: true, backups: [item()] }, { ...ack(), created: false },
    { ...ack(), error: "PRIVATE SQL failure" }, { ...ack(), message: "PRIVATE account" },
    { ...ack(), outcome: "partial_or_unknown" }, { ...ack(), retrySafe: false },
    { ...ack(), snapshot: { secret: "PRIVATE" } },
  ]) assert.equal(parsePlatformAdminBackupCreateAck(input), null);
});

test("created summary must match an entire listed entry, not merely its ID or counts", () => {
  for (const change of [{ id: "foreign" }, { summary: "different" }, { operator: "other" },
    { at: "2026-09-09T11:31:00.000Z" }, { source: "auto", scheduleDateKey: "2026-09-09" },
    { supportCounts: { threadCount: 7, messageCount: 9 } }]) {
    assert.equal(parsePlatformAdminBackupCreateAck({ ...ack(), backup: { ...item(), ...change } }), null);
  }
  assert.equal(parsePlatformAdminBackupCreateAck({ ...ack(), backups: [] }), null);
});

test("summary list rejects duplicate IDs, oversized, sparse and non-data arrays", () => {
  const sparse = new Array(1);
  const extra = [item()]; Object.assign(extra, { extra: true });
  let getters = 0;
  const accessor: unknown[] = []; Object.defineProperty(accessor, "0", { enumerable: true, get() { getters++; return item(); } });
  for (const backups of [null, {}, [item(), item()], Array.from({ length: 9 }, (_, index) => item(`${index}`)), sparse, extra, accessor]) {
    assert.equal(parsePlatformAdminBackupCreateAck({ ...ack(), backups }), null);
  }
  assert.equal(getters, 0);
});

test("every summary field and count is required; no full snapshot or unknown fields are allowed", () => {
  const original = item();
  for (const key of Object.keys(original)) {
    const missing: Record<string, unknown> = { ...original }; delete missing[key];
    assert.equal(parsePlatformAdminBackupCreateAck({ ok: true, created: false, backups: [missing] }), null);
  }
  for (const group of ["userManageCounts", "supportCounts"] as const) {
    for (const key of Object.keys(original[group])) {
      const missing: Record<string, unknown> = { ...original[group] }; delete missing[key];
      assert.equal(parsePlatformAdminBackupCreateAck({ ok: true, created: false, backups: [{ ...original, [group]: missing }] }), null);
    }
  }
  for (const entry of [{ ...item(), snapshot: {} }, { ...item(), actorKey: "PRIVATE" },
    { ...item(), supportCounts: { ...item().supportCounts, hidden: 1 } }]) {
    assert.equal(parsePlatformAdminBackupCreateAck({ ok: true, created: false, backups: [entry] }), null);
  }
});

test("count values are nonnegative safe integers without coercion", () => {
  for (const count of [-1, 0.5, Number.NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "1", null, false]) {
    for (const group of ["userManageCounts", "supportCounts"] as const) {
      const key = Object.keys(item()[group])[0];
      const entry = { ...item(), [group]: { ...item()[group], [key]: count } };
      assert.equal(parsePlatformAdminBackupCreateAck({ ok: true, created: false, backups: [entry] }), null);
    }
  }
  const entry = { ...item(), supportCounts: { threadCount: 0, messageCount: Number.MAX_SAFE_INTEGER } };
  assert.ok(parsePlatformAdminBackupCreateAck({ ok: true, created: false, backups: [entry] }));
});

test("summary identity, source and dates are checked without silent normalization", () => {
  for (const change of [{ id: "" }, { operator: " " }, { summary: null }, { id: " padded " },
    { source: "scheduled" }, { scheduleDateKey: "2026-02-30" }, { scheduleDateKey: "today" },
    { at: "2026-02-30T11:30:00.000Z" }, { at: "2026-09-09T24:00:00Z" }, { at: "2026-09-09" },
    { at: "not a date" }, { at: "2026-09-09T11:30:00+99:00" }]) {
    assert.equal(parsePlatformAdminBackupCreateAck({ ok: true, created: false, backups: [{ ...item(), ...change }] }), null);
  }
  assert.ok(parsePlatformAdminBackupCreateAck({ ok: true, created: false, backups: [{ ...item(), source: "auto", scheduleDateKey: "2028-02-29" }] }));
});

test("hostile prototypes, getters and symbols cannot run or leak errors from the parser", () => {
  let getters = 0;
  const getter = Object.defineProperty({ ...ack() }, "created", { enumerable: true, get() { getters++; throw new Error("PRIVATE"); } });
  const nested = Object.defineProperty({ ...item() }, "operator", { enumerable: true, get() { getters++; return "PRIVATE"; } });
  for (const input of [getter, { ...ack(), [Symbol("secret")]: true }, Object.assign(Object.create({ inherited: true }), ack()),
    { ...ack(), backups: [nested] }]) assert.equal(parsePlatformAdminBackupCreateAck(input), null);
  assert.equal(getters, 0);
});

/** Mirrors the startup gate: only an idle paused guard may resume for an empty
 * journal. Repeated identity/pageshow checks must not invalidate an active GET.
 */
function observeEmptyJournal(guard: ReturnType<typeof createPlatformAdminBackupRestoreSyncGuard>, active = false) {
  if (!active && guard.isPaused()) return guard.resume();
  return false;
}

test("initial pause prevents writes until empty journal verification and repeated boot checks preserve an active GET", async () => {
  const guard = createPlatformAdminBackupRestoreSyncGuard({ initiallyPaused: true });
  const before = guard.captureCurrent();
  await assert.rejects(guard.runWrite(async () => assert.fail("before journal read")), /sync_paused/);
  assert.equal(before(), false);
  assert.equal(observeEmptyJournal(guard), true);
  const currentGet = guard.captureCurrent();
  assert.equal(currentGet(), true);
  assert.equal(observeEmptyJournal(guard), false); // authed changed after the GET effect ran
  assert.equal(observeEmptyJournal(guard), false); // local device/pageshow changed
  assert.equal(currentGet(), true);
  assert.equal(await guard.runWrite(async (isCurrent) => isCurrent()), true);
});

test("empty journal observation does not release active preview or sticky unknown writes", async () => {
  const guard = createPlatformAdminBackupRestoreSyncGuard();
  const previousGet = guard.captureCurrent();
  assert.equal(await guard.pause(), true);
  assert.equal(observeEmptyJournal(guard, true), false);
  assert.equal(guard.isPaused(), true); assert.equal(previousGet(), false);
  guard.block();
  assert.equal(observeEmptyJournal(guard), false);
  assert.equal(guard.isPaused(), true);
  await assert.rejects(guard.runWrite(async () => assert.fail("unknown write")), /sync_paused/);
});

test("malformed create acknowledgement propagates unknown through the existing writer guard", async () => {
  const guard = createPlatformAdminBackupRestoreSyncGuard();
  await assert.rejects(guard.runWrite(async () => {
    if (!parsePlatformAdminBackupCreateAck({ ok: true, created: true, backups: [] })) throw new Error("create_unconfirmed");
  }), /create_unconfirmed/);
  assert.equal(await guard.pause(), false);
  assert.equal(observeEmptyJournal(guard), false);
});
