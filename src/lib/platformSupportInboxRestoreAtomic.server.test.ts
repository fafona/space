import assert from "node:assert/strict";
import test from "node:test";
import {
  assertPlatformSupportInboxAtomicRestoreAvailable,
  preparePlatformSupportInboxAtomic,
  preparePlatformSupportInboxRestoreAtomic,
  readPlatformSupportInboxAtomicView,
} from "./platformSupportInboxAtomic.server";
import { buildPlatformSupportInboxBlocks, readPlatformSupportInboxFromBlocks, type PlatformSupportInboxPayload } from "./platformSupportInbox";
import { PLATFORM_SNAPSHOT_ATOMIC_SCOPES, type PlatformSnapshotAtomicView, type PlatformSnapshotJson } from "./platformSnapshotAtomic.server";
import type { MerchantSnapshotHistoryPayload } from "./merchantSnapshotHistoryStore";

const at = "2026-09-08T12:00:00.000Z";
const timestamp = "2026-09-08T12:00:00.123456+00:00";
const siteId = "platform-support-inbox";
function inbox(id = "current", text = "current message"): PlatformSupportInboxPayload {
  return { threads: [{ merchantId: "10000000", siteId: "10000000", merchantName: "Synthetic",
    merchantEmail: "synthetic@example.test", updatedAt: at, messages: [{ id, text, sender: "merchant", createdAt: at }] }] };
}
function historyEntry(id: string, day = 1) {
  return { id, siteId, at: new Date(Date.UTC(2026, 0, day, 12)).toISOString(), source: "platform-support-inbox",
    before: { historical: ["raw opaque JSON"] }, after: { historical: id } };
}
function fixture(): PlatformSnapshotAtomicView {
  const values = [buildPlatformSupportInboxBlocks(inbox()),
    { siteId, updatedAt: at, entries: [historyEntry("primary")] },
    { siteId, updatedAt: at, entries: [historyEntry("backup", 2)] }];
  return { version: 1, scope: "support_messages", rows: PLATFORM_SNAPSHOT_ATOMIC_SCOPES.support_messages.map((slug, index) => ({
    slug, row: { id: `00000000-0000-0000-0000-${String(index + 1).padStart(12, "0")}`,
      blocks: values[index] as unknown as PlatformSnapshotJson, updatedAt: timestamp },
  })) };
}
function flags(t: { after(callback: () => void): void }, mode = "off", sites = "10000000") {
  const values = { MERCHANT_CONVERSATION_V1_DUAL_WRITE_MODE: mode, MERCHANT_CONVERSATION_V1_DUAL_WRITE_SITE_IDS: sites };
  const before = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  Object.assign(process.env, values);
  t.after(() => { for (const [key, value] of Object.entries(before)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  } });
}
function history(blocks: PlatformSnapshotJson) { return blocks as unknown as MerchantSnapshotHistoryPayload; }

test("restore replaces inbox exactly while preserving both current histories and adding before/after", (t) => {
  flags(t); const view = fixture(); const backup = inbox("restored", "backup message");
  const plan = preparePlatformSupportInboxRestoreAtomic(view, backup, { at, historyId: "restore-entry" });
  assert.deepEqual(plan.payload, backup);
  assert.deepEqual(readPlatformSupportInboxFromBlocks(plan.writes[0].blocks), backup);
  assert.equal(plan.payload.threads[0].messages.some((message) => message.id === "current"), false);
  const primary = history(plan.writes[1].blocks);
  assert.deepEqual(primary, history(plan.writes[2].blocks));
  assert.deepEqual(primary.entries.map((entry) => entry.id), ["restore-entry", "backup", "primary"]);
  assert.deepEqual(primary.entries[0].before, inbox());
  assert.deepEqual(primary.entries[0].after, backup);
  assert.equal(primary.entries[0].source, "platform-support-inbox");
  assert.deepEqual(primary.entries[1], historyEntry("backup", 2));
});

test("empty restore is an exact empty target with current messages retained only in new history", (t) => {
  flags(t); const plan = preparePlatformSupportInboxRestoreAtomic(fixture(), { threads: [] }, { at, historyId: "empty-restore" });
  assert.deepEqual(plan.payload, { threads: [] });
  assert.deepEqual(readPlatformSupportInboxFromBlocks(plan.writes[0].blocks), { threads: [] });
  assert.deepEqual(history(plan.writes[1].blocks).entries[0].before, inbox());
  assert.deepEqual(history(plan.writes[1].blocks).entries[0].after, { threads: [] });
  // User confirmation belongs to the authorized coordinator, not this I/O-free plan.
});

test("restore reconciles identical history IDs and retains the latest 20 entries only", (t) => {
  flags(t); const view = fixture();
  const primary = { siteId, updatedAt: at, entries: Array.from({ length: 15 }, (_, index) => historyEntry(`entry-${index}`, index + 1)) };
  const backup = { siteId, updatedAt: at, entries: Array.from({ length: 15 }, (_, index) => historyEntry(`entry-${index + 10}`, index + 11)) };
  view.rows[1].row!.blocks = primary as unknown as PlatformSnapshotJson;
  view.rows[2].row!.blocks = backup as unknown as PlatformSnapshotJson;
  const plan = preparePlatformSupportInboxRestoreAtomic(view, inbox("restored"), { at, historyId: "restore-entry" });
  assert.deepEqual(plan.writes[1].blocks, plan.writes[2].blocks);
  assert.deepEqual(history(plan.writes[1].blocks).entries.map((entry) => entry.id),
    ["restore-entry", ...Array.from({ length: 19 }, (_, index) => `entry-${24 - index}`)]);
});

test("pure reader and restore leave original physical rows, timestamps and input data unchanged", (t) => {
  flags(t); const view = fixture(); const original = structuredClone(view); const backup = inbox("restored"); const originalBackup = structuredClone(backup);
  const current = readPlatformSupportInboxAtomicView(view);
  const plan = preparePlatformSupportInboxRestoreAtomic(view, backup, { at, historyId: "restore-entry" });
  assert.deepEqual(view, original); assert.deepEqual(backup, originalBackup);
  current.threads[0].messages[0].text = "caller mutation";
  backup.threads[0].messages[0].text = "changed after planning";
  assert.deepEqual(view, original); assert.deepEqual(plan.payload, originalBackup);
  plan.payload.threads[0].messages[0].text = "separate output mutation";
  assert.deepEqual(history(plan.writes[1].blocks).entries[0].after, originalBackup);
  assert.deepEqual(readPlatformSupportInboxFromBlocks(plan.writes[0].blocks), originalBackup);
  assert.ok(view.rows.every((item) => item.row?.updatedAt === timestamp));
});

test("confirmed absence permits complete target and two identical histories", (t) => {
  flags(t); const view = fixture(); view.rows.forEach((item) => { item.row = null; });
  assert.deepEqual(readPlatformSupportInboxAtomicView(view), { threads: [] });
  const plan = preparePlatformSupportInboxRestoreAtomic(view, inbox("restored"), { at, historyId: "restore-entry" });
  assert.equal(plan.writes.length, 3); assert.deepEqual(plan.writes[1].blocks, plan.writes[2].blocks);
  assert.deepEqual(history(plan.writes[1].blocks).entries[0].before, { threads: [] });
  assert.deepEqual(view.rows.map((item) => item.row), [null, null, null]);
});

test("history-only rows remain part of restore even when inbox is absent", (t) => {
  flags(t); const view = fixture(); view.rows[0].row = null;
  const plan = preparePlatformSupportInboxRestoreAtomic(view, inbox("restored"), { at, historyId: "restore-entry" });
  assert.deepEqual(history(plan.writes[1].blocks).entries.map((entry) => entry.id), ["restore-entry", "backup", "primary"]);
});

for (const damage of ["unknown-history-field", "duplicate-history", "conflicting-copies", "wrong-history-site", "unknown-message-field", "bad-history-json"] as const) {
  test(`restore and reader reject ${damage} rather than silently discarding data`, (t) => {
    flags(t); const view = fixture(); const old = history(view.rows[1].row!.blocks);
    if (damage === "unknown-history-field") Object.assign(old, { unexpected: true });
    if (damage === "duplicate-history") old.entries.push(structuredClone(old.entries[0]));
    if (damage === "conflicting-copies") view.rows[2].row!.blocks = { ...old, entries: [{ ...old.entries[0], before: "changed" }] } as unknown as PlatformSnapshotJson;
    if (damage === "wrong-history-site") old.siteId = "another-owner";
    if (damage === "unknown-message-field") {
      const blocks = view.rows[0].row!.blocks as unknown as ReturnType<typeof buildPlatformSupportInboxBlocks>;
      Object.assign(blocks[0].props.payload.threads[0].messages[0], { mustNotDrop: true });
    }
    if (damage === "bad-history-json") old.entries[0].before = { invalid: undefined };
    const before = structuredClone(view);
    assert.throws(() => readPlatformSupportInboxAtomicView(view));
    assert.throws(() => preparePlatformSupportInboxRestoreAtomic(view, inbox("restored")));
    assert.deepEqual(view, before);
  });
}

for (const damage of ["missing-row", "wrong-scope", "duplicate-row-id", "unknown-row-key", "bad-timestamp", "null-history-blocks"] as const) {
  test(`public pure boundaries validate physical ${damage}`, (t) => {
    flags(t); const view = fixture();
    if (damage === "missing-row") view.rows.pop();
    if (damage === "wrong-scope") view.scope = "user_manage";
    if (damage === "duplicate-row-id") view.rows[1].row!.id = view.rows[0].row!.id;
    if (damage === "unknown-row-key") Object.assign(view.rows[0].row!, { merchant_id: "foreign" });
    if (damage === "bad-timestamp") view.rows[0].row!.updatedAt = "not-a-date";
    if (damage === "null-history-blocks") view.rows[1].row!.blocks = null;
    assert.throws(() => readPlatformSupportInboxAtomicView(view));
    assert.throws(() => preparePlatformSupportInboxRestoreAtomic(view, inbox("restored")));
  });
}

test("malformed backup inbox and colliding new history ID are refused", (t) => {
  flags(t); const malformed = inbox(); Object.assign(malformed.threads[0], { future: "must not drop" });
  assert.throws(() => preparePlatformSupportInboxRestoreAtomic(fixture(), malformed), { message: "platform_snapshot_atomic_store_corrupt" });
  assert.throws(() => preparePlatformSupportInboxRestoreAtomic(fixture(), inbox(), { historyId: "primary" }), { message: "platform_snapshot_atomic_invalid_request" });
});

test("scoped shadow is refused before reading target structures, while off and empty scope are available", (t) => {
  flags(t, "shadow");
  assert.throws(assertPlatformSupportInboxAtomicRestoreAvailable, { message: "platform_snapshot_atomic_shadow_unsupported" });
  assert.throws(() => preparePlatformSupportInboxRestoreAtomic(null as unknown as PlatformSnapshotAtomicView, inbox()),
    { message: "platform_snapshot_atomic_shadow_unsupported" });
  process.env.MERCHANT_CONVERSATION_V1_DUAL_WRITE_SITE_IDS = "";
  assert.doesNotThrow(assertPlatformSupportInboxAtomicRestoreAvailable);
  assert.doesNotThrow(() => preparePlatformSupportInboxRestoreAtomic(fixture(), inbox()));
  process.env.MERCHANT_CONVERSATION_V1_DUAL_WRITE_MODE = "off";
  process.env.MERCHANT_CONVERSATION_V1_DUAL_WRITE_SITE_IDS = "10000000";
  assert.doesNotThrow(assertPlatformSupportInboxAtomicRestoreAvailable);
});

test("new restore constructor does not enable replacement through ordinary atomic prepare", (t) => {
  flags(t);
  assert.throws(() => preparePlatformSupportInboxAtomic(fixture(), inbox(), { replace: true, requireAllWrites: true }),
    { message: "platform_snapshot_atomic_restore_unavailable" });
});
