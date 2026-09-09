import assert from "node:assert/strict";
import test from "node:test";
import { isDeepStrictEqual } from "node:util";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createPlatformAdminDataBackupHandlers } from "./platformAdminDataBackupRoute";
import { createPlatformAdminDataBackupEntry, buildPlatformAdminDataBackupBlocks } from "./platformAdminDataBackup";
import { buildPlatformMerchantSnapshotBlocks, normalizePlatformMerchantSnapshotPayload } from "./platformMerchantSnapshot";
import { buildPlatformMerchantConfigArchiveBlocks } from "./platformMerchantConfigArchive";
import { buildPlatformSupportInboxBlocks, type PlatformSupportInboxPayload } from "./platformSupportInbox";
import { normalizePlatformState } from "@/data/platformControlStore";
import { PLATFORM_SNAPSHOT_ATOMIC_SCOPES, type PlatformSnapshotAtomicClient, type PlatformSnapshotAtomicView,
  type PlatformSnapshotAtomicScope, type PlatformSnapshotRestoreAtomicScope, type PlatformSnapshotAtomicWrite,
  type PlatformSnapshotRestoreAtomicView, type PlatformSnapshotJson } from "./platformSnapshotAtomic.server";
import { parsePlatformAdminBackupRestorePreview, parsePlatformAdminBackupRestoreResult,
  isPlatformAdminBackupRestoreRejectedBeforeWrite } from "./platformAdminBackupRestoreClient";
import type { PlatformAdminBackupRestorePreview } from "./platformAdminBackupRestorePreview";
import { handlePlatformAdminBackupRestoreAtomic } from "./platformAdminBackupRestoreAtomic.server";
import { platformSnapshotRestoreReceiptActorKey, type PlatformSnapshotRestoreReceipt } from "./platformSnapshotRestoreReceipt.server";

const at = "2026-09-08T12:00:00.123456Z";
function inbox(text: string): PlatformSupportInboxPayload {
  return { threads: [{ merchantId: "10000000", siteId: "10000000", merchantName: "Synthetic", merchantEmail: "",
    updatedAt: "2026-09-08T12:00:00.000Z", messages: [{ id: text, text, sender: "merchant", createdAt: "2026-09-08T12:00:00.000Z" }] }] };
}
function fixture(t: { after(fn: () => void): void }, scope: PlatformSnapshotRestoreAtomicScope = "user_manage") {
  const keys = ["FAOLLA_PLATFORM_SNAPSHOT_WRITE_MODE", "MERCHANT_CONVERSATION_V1_DUAL_WRITE_MODE", "MERCHANT_CONVERSATION_V1_DUAL_WRITE_SITE_IDS"];
  const before = keys.map((key) => process.env[key]);
  t.after(() => keys.forEach((key, i) => { if (before[i] === undefined) delete process.env[key]; else process.env[key] = before[i]; }));
  process.env[keys[0]] = "atomic"; process.env[keys[1]] = "off"; process.env[keys[2]] = "";
  const snapshot = normalizePlatformMerchantSnapshotPayload({ revision: "current", snapshot: [
    { id: "10000000", merchantName: "Current A" }, { id: "10000001", merchantName: "Retained B" }],
    defaultSortRule: "created_desc", merchantConfigHistoryBySiteId: {} });
  const backup = createPlatformAdminDataBackupEntry({ source: "manual", operator: "PRIVATE-OPERATOR", snapshot: {
    platformState: normalizePlatformState({}), merchantSnapshot: { ...snapshot, revision: "backup", snapshot: [snapshot.snapshot[0]] },
    merchantConfigArchive: { audits: [], backups: [] }, supportInbox: inbox("restored"), merchantAccounts: [],
  } });
  backup.id = "synthetic-backup";
  const make = (kind: PlatformSnapshotAtomicScope, offset: number): PlatformSnapshotAtomicView => ({ version: 1, scope: kind,
    rows: PLATFORM_SNAPSHOT_ATOMIC_SCOPES[kind].map((slug, i) => ({ slug, row: {
      id: `00000000-0000-0000-0000-${String(offset + i).padStart(12, "0")}`, updatedAt: at,
      blocks: (kind === "backup_catalog" ? buildPlatformAdminDataBackupBlocks({ backups: [backup] })
        : slug.includes("config_archive") ? buildPlatformMerchantConfigArchiveBlocks({ audits: [], backups: [] })
          : kind === "user_manage" ? buildPlatformMerchantSnapshotBlocks(snapshot)
            : slug.includes("inbox_history") ? { siteId: "platform-support-inbox", updatedAt: null, entries: [] }
              : buildPlatformSupportInboxBlocks(inbox("current"))) as unknown as PlatformSnapshotJson,
    } })) });
  let state: PlatformSnapshotRestoreAtomicView = { version: 1, scope, catalog: make("backup_catalog", 1), target: make(scope, 3) };
  const calls: string[] = []; let authorized = true; let createCount = 0;
  let session: { deviceId: string } | null = { deviceId: "verified-synthetic-device" };
  const receipts = new Map<string, PlatformSnapshotRestoreReceipt>();
  let fault = ""; let race: (() => void) | null = null;
  const client: PlatformSnapshotAtomicClient & { from(): never } = {
    from() { assert.fail("atomic restore must never use legacy table I/O"); },
    rpc: async (name, args) => {
      calls.push(name);
      if (name === "faolla_read_platform_snapshot_restore_receipt_v1") {
        if (fault === "receipt-read") throw new Error("PRIVATE-RECEIPT-SECRET");
        const existing = receipts.get(String(args.p_operation_id));
        const matches = existing && existing.actorKey === args.p_actor_key && existing.scope === args.p_scope &&
          existing.backupId === args.p_backup_id && existing.confirmationToken === args.p_confirmation_token;
        return { error: null, data: { version: 1, receipt: matches ? existing : null } };
      }
      if (name === "faolla_read_platform_snapshot_restore_v1") {
        if (fault === "read") throw new Error("PRIVATE-DB-SECRET");
        return { error: null, data: structuredClone(state) };
      }
      assert.equal(name, "faolla_commit_platform_snapshot_restore_receipt_v1");
      race?.();
      if (!isDeepStrictEqual(args.p_catalog_expected, state.catalog.rows) ||
        !isDeepStrictEqual(args.p_target_expected, state.target.rows)) {
        return { data: null, error: { code: "P0001", message: "platform_snapshot_atomic_conflict" } };
      }
      if (fault === "commit") throw new Error("PRIVATE-CONNECTION-SECRET");
      if (fault === "operation-conflict") return { data: null, error: { code: "P0001", message: "platform_snapshot_atomic_conflict" } };
      const receipt: PlatformSnapshotRestoreReceipt = { version: 1, operationId: String(args.p_operation_id),
        actorKey: String(args.p_actor_key), scope, backupId: String(args.p_backup_id),
        confirmationToken: String(args.p_confirmation_token), planHash: "a".repeat(64), resultHash: "b".repeat(64), committedAt: at };
      if (fault === "commit-replay") return { error: null, data: { version: 1, receipt, result: null, replayed: true } };
      const writes = args.p_writes as PlatformSnapshotAtomicWrite[];
      state.target.rows.forEach((entry, index) => {
        assert.ok(entry.row); if (!isDeepStrictEqual(entry.row.blocks, writes[index].blocks)) {
          entry.row.blocks = structuredClone(writes[index].blocks); entry.row.updatedAt = "2026-09-08T12:00:01.000001Z";
        }
      });
      receipts.set(receipt.operationId, receipt);
      if (fault === "lost-ack") throw new Error("PRIVATE-LOST-ACK");
      const result = structuredClone(state);
      if (fault === "false-ack") result.catalog.rows[0].row!.blocks = [];
      return { error: null, data: { version: 1, receipt, result, replayed: false } };
    },
  };
  const handlers = createPlatformAdminDataBackupHandlers({ authorize: async () => authorized,
    readAuthorizedSession: async () => session,
    createClient: () => { createCount++; return client; } });
  const send = async (body: Record<string, unknown>, origin = "https://synthetic.invalid") => {
    const response = await handlers.PATCH(new Request("https://synthetic.invalid/api/super-admin/data-backups", {
      method: "PATCH", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ backupId: backup.id, scope, ...body }),
    }));
    // The shared origin guard is returned before this handler's JSON wrapper.
    if (response.status !== 403) assert.equal(response.headers.get("cache-control"), "no-store");
    return { status: response.status, body: await response.json() as Record<string, unknown> };
  };
  return { send, calls, backup, client, get state() { return state; }, set state(v) { state = v; },
    deny() { authorized = false; }, get createCount() { return createCount; },
    setSession(value: { deviceId: string } | null) { session = value; },
    fault(value: string) { fault = value; }, race(fn: () => void) { race = fn; },
    async preview() {
      const result = await send({ action: "preview" }); assert.equal(result.status, 200, JSON.stringify(result.body));
      const preview = parsePlatformAdminBackupRestorePreview(result.body, { backupId: backup.id, scope }); assert.ok(preview);
      return preview;
    },
    restore(preview: PlatformAdminBackupRestorePreview, confirmEmpty = true, operationId = randomUUID()) {
      return send({ action: "restore", confirmationToken: preview.confirmationToken, confirmEmpty, operationId });
    },
  };
}
for (const scope of ["user_manage", "support_messages"] as const) {
  test(`atomic ${scope}: authorized preview and restore remain compatible with UI result parsing`, async (t) => {
    const f = fixture(t, scope); const originalCatalog = structuredClone(f.state.catalog); const preview = await f.preview();
    assert.equal(f.calls.length, 1); assert.equal(JSON.stringify(preview).includes("PRIVATE-OPERATOR"), false);
    if (scope === "user_manage") assert.equal(preview.counts.find((item) => item.key === "merchant_directory")?.target, 2);
    const result = await f.restore(preview); assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(result.body.outcome, "committed"); assert.equal(result.body.replayed, false);
    assert.equal(Object.hasOwn(result.body.receipt as object, "actorKey"), false);
    assert.ok(parsePlatformAdminBackupRestoreResult(result.body, preview)); assert.deepEqual(f.state.catalog, originalCatalog);
    assert.equal(f.calls.filter((name) => name.includes("commit")).length, 1);
    if (scope === "support_messages") assert.deepEqual((result.body.threads as PlatformSupportInboxPayload["threads"])[0].messages.map((m) => m.text), ["restored"]);
    else assert.notEqual((result.body.merchantSnapshot as { revision: string }).revision, "backup");
    const stale = await f.restore(preview); assert.equal(stale.status, 409); assert.equal(f.calls.filter((name) => name.includes("commit")).length, 1);
    assert.equal(isPlatformAdminBackupRestoreRejectedBeforeWrite(stale.status, stale.body), true);
  });
}
test("atomic preview token is stable across newly generated plan revisions/history IDs", async (t) => {
  const f = fixture(t); assert.equal((await f.preview()).confirmationToken, (await f.preview()).confirmationToken);
});

test("atomic confirmation is bound to the verified device and the preview advertises receipt protocol", async (t) => {
  const f = fixture(t); const preview = await f.preview();
  assert.equal((preview as PlatformAdminBackupRestorePreview & { receiptProtocol: number }).receiptProtocol, 1);
  f.setSession({ deviceId: "different-verified-device" });
  const changed = await f.preview(); assert.notEqual(changed.confirmationToken, preview.confirmationToken);
  const result = await f.restore(preview); assert.equal(result.status, 409);
  assert.equal(result.body.outcome, "not_started"); assert.equal(f.calls.filter((name) => name.includes("commit")).length, 0);
  assert.doesNotMatch(JSON.stringify(result.body), /actorKey|verified-device/);
});

test("atomic PATCH needs a fresh verified session and cannot use boolean authorization alone", async (t) => {
  const f = fixture(t); f.setSession(null);
  assert.equal((await f.send({ action: "preview" })).status, 401);
  assert.equal(f.createCount, 0); assert.equal(f.calls.length, 0);
  const missing = createPlatformAdminDataBackupHandlers({ authorize: async () => true, createClient: () => assert.fail("no client") });
  const response = await missing.PATCH(new Request("https://synthetic.invalid/api/super-admin/data-backups", {
    method: "PATCH", headers: { origin: "https://synthetic.invalid", "content-type": "application/json" },
    body: JSON.stringify({ backupId: "synthetic", scope: "user_manage", action: "preview" }),
  }));
  assert.equal(response.status, 503);
  const direct = await handlePlatformAdminBackupRestoreAtomic(f.client, { backupId: "synthetic", scope: "user_manage", action: "preview" });
  assert.equal(direct.status, 503); assert.equal(f.calls.length, 0);
});

test("atomic missing or invalid operation IDs and caller identity/extra fields fail before any receipt RPC", async (t) => {
  const f = fixture(t); const preview = await f.preview(); const count = f.calls.length;
  const request = { action: "restore", confirmationToken: preview.confirmationToken, confirmEmpty: true, operationId: randomUUID() };
  for (const body of [
    { ...request, operationId: undefined }, { ...request, operationId: "invalid" },
    { ...request, operationId: randomUUID().toUpperCase() }, { ...request, confirmEmpty: "true" },
    { ...request, actorKey: "a".repeat(64) }, { ...request, deviceId: "forged-device" },
    { ...request, writes: [] }, { action: "preview", actorKey: "a".repeat(64) },
  ]) { assert.equal((await f.send(body)).status, 400); assert.equal(f.calls.length, count); }
});

for (const scope of ["user_manage", "support_messages"] as const) {
  test(`atomic ${scope}: historical receipt returns metadata before damaged current sources or shadow config`, async (t) => {
    const f = fixture(t, scope); const preview = await f.preview(); const operationId = randomUUID();
    const committed = await f.restore(preview, true, operationId); assert.equal(committed.status, 200);
    f.state.catalog.rows[0].row!.blocks = [{ privateBrokenContent: true }];
    f.state.target.rows[0].row!.blocks = [];
    process.env.MERCHANT_CONVERSATION_V1_DUAL_WRITE_MODE = "shadow";
    process.env.MERCHANT_CONVERSATION_V1_DUAL_WRITE_SITE_IDS = "10000000";
    const before = structuredClone(f.state); const count = f.calls.length;
    const replay = await f.restore(preview, true, operationId); assert.equal(replay.status, 200);
    assert.deepEqual(f.calls.slice(count), ["faolla_read_platform_snapshot_restore_receipt_v1"]);
    assert.equal(replay.body.outcome, "committed"); assert.equal(replay.body.replayed, true);
    assert.deepEqual(replay.body.receipt, committed.body.receipt);
    for (const key of ["backup", "platformState", "merchantAccounts", "merchantSnapshot", "merchantConfigArchive", "threads", "actorKey"]) {
      assert.equal(Object.hasOwn(replay.body, key), false);
    }
    assert.deepEqual(f.state, before);
  });
}

test("atomic receipt RPC replay never exposes a freshly constructed business payload", async (t) => {
  const f = fixture(t); const preview = await f.preview(); f.fault("commit-replay");
  const before = structuredClone(f.state); const result = await f.restore(preview);
  assert.equal(result.status, 200); assert.equal(result.body.replayed, true); assert.equal(result.body.outcome, "committed");
  assert.equal(Object.hasOwn(result.body, "platformState"), false); assert.equal(Object.hasOwn(result.body, "backup"), false);
  assert.deepEqual(f.state, before);
});

test("atomic lost ACK remains unknown and subsequent same-operation confirmation performs only receipt lookup", async (t) => {
  const f = fixture(t); const preview = await f.preview(); const operationId = randomUUID(); f.fault("lost-ack");
  const unknown = await f.restore(preview, true, operationId); assert.equal(unknown.status, 500);
  assert.equal(unknown.body.outcome, "partial_or_unknown"); const count = f.calls.length;
  const result = await f.restore(preview, true, operationId);
  assert.equal(result.status, 200); assert.equal(result.body.replayed, true);
  assert.deepEqual(f.calls.slice(count), ["faolla_read_platform_snapshot_restore_receipt_v1"]);
  assert.equal(f.calls.filter((name) => name.includes("commit")).length, 1);
});

test("atomic receipt lookup failures and operation-binding conflicts never become safe-to-repeat errors", async (t) => {
  const f = fixture(t); const preview = await f.preview();
  for (const fault of ["receipt-read", "operation-conflict"]) {
    f.fault(fault); const result = await f.restore(preview);
    assert.equal(result.body.outcome, "partial_or_unknown"); assert.equal(result.body.retrySafe, false);
    assert.equal(isPlatformAdminBackupRestoreRejectedBeforeWrite(result.status, result.body), false);
    assert.doesNotMatch(JSON.stringify(result.body), /PRIVATE|actorKey/);
  }
});

test("production backup PATCH obtains device identity only from the revocation-checked session reader", () => {
  const source = readFileSync(new URL("../app/api/super-admin/data-backups/route.ts", import.meta.url), "utf8");
  assert.match(source, /readAuthorizedSession: readSuperAdminAuthorizedSession/);
  const actor = platformSnapshotRestoreReceiptActorKey({ deviceId: "verified-synthetic-device" });
  assert.match(actor, /^[0-9a-f]{64}$/);
});

test("default-off PATCH retains the legacy store path without requiring receipt identity or calling receipt RPCs", async (t) => {
  fixture(t);
  for (const mode of [undefined, "off"]) {
    if (mode === undefined) delete process.env.FAOLLA_PLATFORM_SNAPSHOT_WRITE_MODE;
    else process.env.FAOLLA_PLATFORM_SNAPSHOT_WRITE_MODE = mode;
    let legacyReads = 0;
    const handlers = createPlatformAdminDataBackupHandlers({ authorize: async () => true,
      readAuthorizedSession: async () => assert.fail("off must not enable receipt identity protocol"),
      createClient: () => ({ rpc: async () => assert.fail("off must not call atomic RPC"),
        from: () => { legacyReads++; throw new Error("synthetic-legacy-read-unavailable"); } }),
    });
    const response = await handlers.PATCH(new Request("https://synthetic.invalid/api/super-admin/data-backups", {
      method: "PATCH", headers: { origin: "https://synthetic.invalid", "content-type": "application/json" },
      body: JSON.stringify({ backupId: "synthetic", scope: "user_manage", action: "preview" }),
    }));
    assert.equal(response.status, 503); assert.equal(legacyReads > 0, true);
    assert.equal((await response.json()).error, "super_admin_backup_read_unavailable");
  }
});
test("atomic unknown or cross-origin actors never create a client or read the source", async (t) => {
  const f = fixture(t); f.deny(); assert.equal((await f.send({ action: "preview" })).status, 401);
  assert.equal((await f.send({ action: "restore" }, "https://attacker.invalid")).status, 403);
  assert.equal(f.createCount, 0); assert.equal(f.calls.length, 0);
});
test("atomic missing action, missing confirmation and empty restore consent are never inferred", async (t) => {
  const f = fixture(t); assert.equal((await f.send({})).status, 400); assert.equal(f.calls.length, 0);
  const preview = await f.preview(); assert.equal(preview.requiresEmptyConfirmation, true);
  const missing = await f.send({ action: "restore" }); assert.equal(missing.status, 400);
  const empty = await f.restore(preview, false); assert.equal(empty.status, 400);
  assert.equal(isPlatformAdminBackupRestoreRejectedBeforeWrite(empty.status, empty.body), true);
  assert.equal(f.calls.filter((name) => name.includes("commit")).length, 0);
});
for (const part of ["catalog", "target"] as const) {
  test(`atomic preview binds ${part} raw microseconds even when business content and counts are unchanged`, async (t) => {
    const f = fixture(t); const preview = await f.preview(); f.state[part].rows[0].row!.updatedAt = "2026-09-08T12:00:00.123457Z";
    assert.equal((await f.restore(preview)).status, 409); assert.equal(f.calls.filter((name) => name.includes("commit")).length, 0);
    assert.notEqual((await f.preview()).confirmationToken, preview.confirmationToken);
  });
  test(`atomic ${part} conflict after entering receipt commit stays unknown, never authorizes a new restore`, async (t) => {
    const f = fixture(t); const preview = await f.preview(); const before = structuredClone(f.state.target);
    f.race(() => { f.state[part].rows[0].row!.updatedAt = "2026-09-08T12:00:00.123457Z"; });
    const result = await f.restore(preview); assert.equal(result.status, 500);
    assert.equal(result.body.outcome, "partial_or_unknown"); assert.equal(isPlatformAdminBackupRestoreRejectedBeforeWrite(result.status, result.body), false);
    assert.equal(f.calls.filter((name) => name.includes("commit")).length, 1);
    assert.deepEqual(f.state.target.rows.map((r) => r.row!.blocks), before.rows.map((r) => r.row!.blocks));
  });
}
test("atomic damaged source or target is not repaired or silently normalized into a restore", async (t) => {
  const f = fixture(t); f.state.catalog.rows[0].row!.blocks = [{ secret: "PRIVATE-DAMAGE" }];
  const result = await f.send({ action: "preview" }); assert.equal(result.status, 503);
  assert.equal(JSON.stringify(result.body).includes("PRIVATE"), false); assert.equal(f.calls.length, 1);
  assert.equal(isPlatformAdminBackupRestoreRejectedBeforeWrite(result.status, result.body), true);
});
for (const fault of ["commit", "lost-ack", "false-ack"] as const) {
  test(`atomic ${fault}: no fallback, automatic replay or false success; UI stays paused`, async (t) => {
    const f = fixture(t); const preview = await f.preview(); f.fault(fault);
    const result = await f.restore(preview); assert.equal(result.status, 500);
    assert.equal(result.body.outcome, "partial_or_unknown"); assert.equal(result.body.retrySafe, false);
    assert.equal(isPlatformAdminBackupRestoreRejectedBeforeWrite(result.status, result.body), false);
    assert.equal(JSON.stringify(result.body).includes("PRIVATE"), false); assert.equal(f.calls.filter((name) => name.includes("commit")).length, 1);
  });
}
test("atomic source not-found, scoped shadow and typo modes refuse without unsafe fallback", async (t) => {
  const f = fixture(t, "support_messages");
  assert.equal((await f.send({ action: "preview", backupId: "not-found" })).status, 404);
  const count = f.calls.length;
  process.env.MERCHANT_CONVERSATION_V1_DUAL_WRITE_MODE = "shadow"; process.env.MERCHANT_CONVERSATION_V1_DUAL_WRITE_SITE_IDS = "10000000";
  const shadow = await f.send({ action: "preview" }); assert.equal(shadow.status, 503); assert.equal(shadow.body.error, "platform_snapshot_atomic_shadow_unsupported");
  assert.equal(f.calls.length, count);
  process.env.FAOLLA_PLATFORM_SNAPSHOT_WRITE_MODE = "ATOMIC";
  assert.equal((await f.send({ action: "restore" })).body.error, "platform_snapshot_atomic_configuration_invalid"); assert.equal(f.calls.length, count);
});
