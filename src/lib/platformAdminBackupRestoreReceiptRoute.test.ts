import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createPlatformAdminBackupRestoreReceiptGET } from "./platformAdminBackupRestoreReceiptRoute";
import { platformSnapshotRestoreReceiptActorKey } from "./platformSnapshotRestoreReceipt.server";

const binding = { operationId: "00000000-0000-4000-8000-000000000001", scope: "user_manage",
  backupId: "备份", confirmationToken: `v1.${"a".repeat(64)}` };
const url = `https://admin.faolla.com/api/super-admin/data-backups/restore-operations?${new URLSearchParams(binding)}`;
test("receipt route authenticates every request before mode, params or database", async () => {
  for (const throws of [true, false]) {
    let auth = 0; let io = 0;
    const get = createPlatformAdminBackupRestoreReceiptGET({ readAuthorizedSession: async () => { auth++; if (throws) throw new Error(); return null; },
      readMode: () => { io++; return "atomic"; }, createClient: () => { io++; } });
    for (let i = 0; i < 2; i++) {
      const response = await get(new Request(url)); assert.equal(response.status, 401);
      assert.match(response.headers.get("cache-control")!, /no-store/);
    }
    assert.equal(auth, 2); assert.equal(io, 0);
  }
});
test("off and invalid modes never create service client", async () => {
  for (const invalid of [false, true]) {
    let io = 0;
    const get = createPlatformAdminBackupRestoreReceiptGET({ readAuthorizedSession: async () => ({ deviceId: "verified" }),
      readMode: () => { if (invalid) throw new Error(); return "off"; }, createClient: () => { io++; } });
    assert.equal((await get(new Request(url))).status, 503); assert.equal(io, 0);
  }
});
test("query rejects duplicate/unknown fields and caller-provided identity before IO", async () => {
  for (const suffix of ["&actorKey=" + "a".repeat(64), "&scope=user_manage", "&extra=1"]) {
    let io = 0;
    const get = createPlatformAdminBackupRestoreReceiptGET({ readAuthorizedSession: async () => ({ deviceId: "verified" }),
      readMode: () => "atomic", createClient: () => { io++; } });
    assert.equal((await get(new Request(url + suffix))).status, 400); assert.equal(io, 0);
  }
});
test("lookup uses server verified device, hides actor, and does not expose business state", async () => {
  let auth = 0; let calls = 0;
  const get = createPlatformAdminBackupRestoreReceiptGET({ readAuthorizedSession: async () => { auth++; return { deviceId: "verified" }; },
    readMode: () => "atomic", createClient: () => ({ rpc: async (name: string, args: Record<string, unknown>) => {
      calls++; assert.equal(name, "faolla_read_platform_snapshot_restore_receipt_v1");
      assert.equal(args.p_actor_key, platformSnapshotRestoreReceiptActorKey({ deviceId: "verified" }));
      return { error: null, data: { version: 1, receipt: { version: 1, ...binding, actorKey: args.p_actor_key,
        planHash: "c".repeat(64), resultHash: "d".repeat(64), committedAt: "2026-09-09T12:00:00.123456+00:00" } } };
    } }) });
  const response = await get(new Request(url)); assert.equal(response.status, 200);
  const data = await response.json(); assert.equal(data.outcome, "committed");
  assert.deepEqual(Object.keys(data).sort(), ["ok", "outcome", "receipt"]);
  assert.equal(Object.hasOwn(data.receipt, "actorKey"), false); assert.equal(auth, 1); assert.equal(calls, 1);
  assert.match(response.headers.get("cache-control")!, /private, no-store/);
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
});
test("not found remains unknown, transport failure does not become not_started", async () => {
  for (const lost of [true, false]) {
    let calls = 0;
    const get = createPlatformAdminBackupRestoreReceiptGET({ readAuthorizedSession: async () => ({ deviceId: "verified" }),
      readMode: () => "atomic", createClient: () => ({ rpc: async () => {
        calls++; if (lost) throw new Error("private connection failure"); return { error: null, data: { version: 1, receipt: null } };
      } }) });
    const response = await get(new Request(url)); const data = await response.json();
    assert.equal(calls, 1);
    if (lost) { assert.equal(response.status, 503); assert.equal(Object.hasOwn(data, "outcome"), false); }
    else assert.deepEqual(data, { ok: true, outcome: "unknown", receipt: null });
    assert.doesNotMatch(JSON.stringify(data), /not_started|connection failure|retrySafe/);
  }
});
test("route wrapper uses revocation-checked session reader and only exports GET", () => {
  const source = readFileSync(new URL("../app/api/super-admin/data-backups/restore-operations/route.ts", import.meta.url), "utf8");
  assert.match(source, /readAuthorizedSession: readSuperAdminAuthorizedSession/);
  assert.match(source, /createClient: createServerSupabaseServiceClient/);
  assert.match(source, /export const GET/); assert.doesNotMatch(source, /export const (POST|PATCH|PUT|DELETE)/);
});
