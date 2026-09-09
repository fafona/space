import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createPlatformAdminBackupRestoreInspectionGET } from "./platformAdminBackupRestoreInspectionRoute";
import { platformSnapshotRestoreReceiptActorKey } from "./platformSnapshotRestoreReceipt.server";

const binding = { operationId: "00000000-0000-4000-8000-000000000001", scope: "user_manage",
  backupId: "synthetic-backup", confirmationToken: `v1.${"b".repeat(64)}` };
const url = `https://synthetic.invalid/api/super-admin/data-backups/restore-inspection?${new URLSearchParams(binding)}`;
function data(actorKey: string, differs = false) {
  return { version: 1, receipt: { version: 1, ...binding, actorKey, planHash: "c".repeat(64), resultHash: "d".repeat(64),
    committedAt: "2026-09-09T11:12:13.123456Z" }, inspection: { version: 1, observedAt: "2026-09-09T11:13:14.654321+00:00",
    targetState: differs ? "differs_from_commit" : "matches_commit", targetHash: (differs ? "e" : "d").repeat(64) } };
}
function headers(response: Response) {
  assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
}

test("inspection GET authenticates every request before mode, params and service-client creation", async () => {
  for (const throws of [true, false]) {
    let auth = 0; let io = 0;
    const get = createPlatformAdminBackupRestoreInspectionGET({ readAuthorizedSession: async () => { auth++; if (throws) throw new Error("PRIVATE auth"); return null; },
      readMode: () => { io++; return "atomic"; }, createClient: () => { io++; } });
    for (let index = 0; index < 2; index++) { const response = await get(new Request(url)); assert.equal(response.status, 401); headers(response); }
    assert.equal(auth, 2); assert.equal(io, 0);
  }
});

test("inspection GET off or invalid mode refuses before a service client is created", async () => {
  for (const throws of [true, false]) {
    let io = 0;
    const get = createPlatformAdminBackupRestoreInspectionGET({ readAuthorizedSession: async () => ({ deviceId: "verified" }),
      readMode: () => { if (throws) throw new Error("PRIVATE mode"); return "off"; }, createClient: () => { io++; } });
    const response = await get(new Request(url)); assert.equal(response.status, 503); headers(response); assert.equal(io, 0);
    assert.deepEqual(await response.json(), { error: "super_admin_backup_restore_inspection_unavailable" });
  }
});

test("inspection GET requires exact four valid query fields and rejects supplied actor or device identity before IO", async () => {
  for (const query of [`${url}&actorKey=${"a".repeat(64)}`, `${url}&deviceId=forged`, `${url}&scope=user_manage`,
    `${url}&extra=1`, url.replace("operationId=", "unused="), url.replace(binding.operationId, "invalid"),
    url.replace("scope=user_manage", "scope=backup_catalog"), url.replace("synthetic-backup", "%20trim%20")]) {
    let io = 0;
    const get = createPlatformAdminBackupRestoreInspectionGET({ readAuthorizedSession: async () => ({ deviceId: "verified" }),
      readMode: () => "atomic", createClient: () => { io++; } });
    const response = await get(new Request(query)); assert.equal(response.status, 400); assert.equal(io, 0); headers(response);
    assert.deepEqual(await response.json(), { error: "super_admin_backup_restore_inspection_invalid_request" });
  }
});

test("inspection GET uses current verified actor, exposes only bound receipt/current hash and refreshes identity per call", async () => {
  let deviceId = "verified-a"; let auth = 0; let calls = 0;
  const get = createPlatformAdminBackupRestoreInspectionGET({ readAuthorizedSession: async () => { auth++; return { deviceId }; },
    readMode: () => "atomic", createClient: () => ({ rpc: async (name: string, args: Record<string, unknown>) => {
      calls++; assert.equal(name, "faolla_inspect_platform_snapshot_restore_receipt_v1");
      assert.equal(args.p_actor_key, platformSnapshotRestoreReceiptActorKey({ deviceId }));
      return { error: null, data: deviceId === "verified-a" ? data(String(args.p_actor_key), true) : { version: 1, receipt: null, inspection: null } };
    } }) });
  const response = await get(new Request(url)); assert.equal(response.status, 200); headers(response);
  const value = await response.json(); assert.deepEqual(Object.keys(value).sort(), ["inspection", "ok", "outcome", "receipt"]);
  assert.equal(value.outcome, "committed"); assert.equal(value.inspection.targetState, "differs_from_commit");
  assert.deepEqual(Object.keys(value.inspection).sort(), ["observedAt", "targetHash", "targetState", "version"]);
  assert.doesNotMatch(JSON.stringify(value), /actorKey|actor_key|deviceId|verified-a|rows|blocks|retrySafe|not_started/);
  deviceId = "verified-b";
  assert.deepEqual(await (await get(new Request(url))).json(), { ok: true, outcome: "unknown", receipt: null, inspection: null });
  assert.equal(auth, 2); assert.equal(calls, 2);
});

test("inspection GET rejects wrong actor, inconsistent result metadata and SQL errors without leaking details", async () => {
  const actorKey = platformSnapshotRestoreReceiptActorKey({ deviceId: "verified" });
  const valid = data(actorKey);
  for (const result of [
    { error: null, data: data("e".repeat(64)) },
    { error: null, data: { ...valid, inspection: { ...valid.inspection, targetState: "differs_from_commit" } } },
    { error: null, data: { ...valid, inspection: { ...valid.inspection, rawBusiness: "PRIVATE" } } },
    { error: null, data: { version: 1, receipt: null, inspection: valid.inspection } },
    { error: { code: "P0001", message: "PRIVATE table secret" }, data: null },
  ]) {
    let calls = 0;
    const get = createPlatformAdminBackupRestoreInspectionGET({ readAuthorizedSession: async () => ({ deviceId: "verified" }),
      readMode: () => "atomic", createClient: () => ({ rpc: async () => { calls++; return result; } }) });
    const response = await get(new Request(url)); assert.equal(response.status, 503); headers(response);
    assert.deepEqual(await response.json(), { error: "super_admin_backup_restore_inspection_unconfirmed" }); assert.equal(calls, 1);
  }
});

test("inspection GET missing service client and transport throw are fixed unavailable/unconfirmed errors", async () => {
  for (const transport of [false, true]) {
    const get = createPlatformAdminBackupRestoreInspectionGET({ readAuthorizedSession: async () => ({ deviceId: "verified" }),
      readMode: () => "atomic", createClient: () => transport ? { rpc: async () => { throw new Error("PRIVATE transport"); } } : null });
    const response = await get(new Request(url)); assert.equal(response.status, 503); headers(response);
    assert.deepEqual(await response.json(), { error: `super_admin_backup_restore_inspection_${transport ? "unconfirmed" : "unavailable"}` });
  }
});

test("inspection route wrapper only exports GET and uses revocation-checked session authorization", () => {
  const source = readFileSync(new URL("../app/api/super-admin/data-backups/restore-inspection/route.ts", import.meta.url), "utf8");
  assert.match(source, /readAuthorizedSession: readSuperAdminAuthorizedSession/);
  assert.match(source, /createClient: createServerSupabaseServiceClient/);
  assert.match(source, /export const GET/); assert.match(source, /export const dynamic = "force-dynamic"/);
  assert.doesNotMatch(source, /export (?:const|function) (?:POST|PATCH|PUT|DELETE)/);
});
