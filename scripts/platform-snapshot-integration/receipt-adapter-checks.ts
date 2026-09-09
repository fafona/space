import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readPlatformSnapshotRestoreAtomic, type PlatformSnapshotAtomicClient,
  type PlatformSnapshotAtomicWrite } from "../../src/lib/platformSnapshotAtomic.server";
import { commitPlatformSnapshotRestoreReceipt, readPlatformSnapshotRestoreReceipt,
  platformSnapshotRestoreReceiptActorKey, publicPlatformSnapshotRestoreReceipt,
  type PlatformSnapshotRestoreReceiptBinding } from "../../src/lib/platformSnapshotRestoreReceipt.server";
import { createPlatformAdminBackupRestoreReceiptGET } from "../../src/lib/platformAdminBackupRestoreReceiptRoute";
import { lookupPlatformAdminBackupRestoreReceiptOnce, type PlatformAdminBackupRestoreReceiptBinding,
  type PlatformAdminBackupRestoreReceipt } from "../../src/lib/platformAdminBackupRestoreReceiptClient";
import { createPlatformAdminBackupRestoreSyncGuard } from "../../src/lib/platformAdminBackupRestoreClient";

/** Invoked only by the dedicated synthetic runner after its database guards.
 * No connection, process, environment, business normalizer or UI side effect.
 * HTTP is an in-process Request/Response bridge, not real Auth/PostgREST evidence.
 */
export async function runReceiptAdapterChecks(input: {
  rpcClient: PlatformSnapshotAtomicClient;
  query: (sql: string) => Promise<string>;
}): Promise<number> {
  const { rpcClient, query } = input;
  const snapshot = () => query(`select jsonb_build_object(
    'pages',(select coalesce(jsonb_agg(to_jsonb(p) order by id),'[]') from public.pages p),
    'receipts',(select coalesce(jsonb_agg(to_jsonb(r) order by operation_id),'[]')
      from public.faolla_platform_snapshot_restore_receipts r));`);
  const verifiedSession = { deviceId: "synthetic-verified-adapter-device-a" };
  const otherSession = { deviceId: "synthetic-verified-adapter-device-b" };
  const binding = (scope: PlatformSnapshotRestoreReceiptBinding["scope"]): PlatformSnapshotRestoreReceiptBinding => ({
    operationId: randomUUID(), scope, actorKey: platformSnapshotRestoreReceiptActorKey(verifiedSession),
    backupId: "synthetic-adapter-backup", confirmationToken: `v1.${"e".repeat(64)}`,
  });
  const publicBinding = (value: PlatformSnapshotRestoreReceiptBinding): PlatformAdminBackupRestoreReceiptBinding => ({
    operationId: value.operationId, scope: value.scope, backupId: value.backupId, confirmationToken: value.confirmationToken,
  });
  const plan = async (scope: PlatformSnapshotRestoreReceiptBinding["scope"], marker: string) => {
    const expected = await readPlatformSnapshotRestoreAtomic(rpcClient, scope);
    const writes: PlatformSnapshotAtomicWrite[] = expected.target.rows.map(({ slug }) => ({ slug,
      blocks: slug.includes("support_inbox_history") ? { entries: [], syntheticAdapterMarker: marker }
        : [{ syntheticAdapterMarker: marker }],
    }));
    return { expected, writes };
  };
  let groups = 0;
  const pass = (label: string) => { groups++; console.log(`[platform-snapshot-receipts-adapter] passed ${label}`); };
  const recorded: Array<{ binding: PlatformSnapshotRestoreReceiptBinding; receipt: PlatformAdminBackupRestoreReceipt }> = [];
  for (const scope of ["user_manage", "support_messages"] as const) {
    const operation = binding(scope); const { expected, writes } = await plan(scope, operation.operationId);
    const result = await commitPlatformSnapshotRestoreReceipt(rpcClient, operation, expected, writes);
    assert.equal(result.replayed, false); assert.ok(result.result);
    assert.deepEqual(result.result.catalog, expected.catalog);
    assert.deepEqual(result.result.target.rows.map(({ slug, row }) => ({ slug, blocks: row!.blocks })), writes);
    const committed = await snapshot();
    assert.deepEqual(await readPlatformSnapshotRestoreReceipt(rpcClient, operation), result.receipt);
    assert.equal(await snapshot(), committed);
    recorded.push({ binding: operation, receipt: publicPlatformSnapshotRestoreReceipt(result.receipt) });
  }
  pass("both scopes: actual physical adapter commit and read-only receipt lookup");

  const lostBinding = binding("support_messages"); const lostPlan = await plan(lostBinding.scope, "actual-commit-ACK-lost");
  let sends = 0;
  const lostAckClient: PlatformSnapshotAtomicClient = { rpc: async (name, args) => {
    assert.equal(name, "faolla_commit_platform_snapshot_restore_receipt_v1"); sends++;
    const result = await rpcClient.rpc(name, args);
    assert.equal(result.error, null, "The simulated lost ACK must follow a real successful commit");
    throw new Error("synthetic_response_lost_after_commit");
  } };
  await assert.rejects(commitPlatformSnapshotRestoreReceipt(lostAckClient, lostBinding, lostPlan.expected, lostPlan.writes),
    /platform_snapshot_atomic_write_unconfirmed/);
  const lostCommitted = await snapshot();
  assert.ok(await readPlatformSnapshotRestoreReceipt(rpcClient, lostBinding));
  assert.equal(sends, 1); assert.equal(await snapshot(), lostCommitted);
  pass("actual committed ACK loss is resolved by lookup only, without resending the restore");

  const item = recorded[0]; const expected = publicBinding(item.binding);
  let currentSession: { deviceId: string } | null = verifiedSession;
  let authReads = 0; let rpcReads = 0;
  const get = createPlatformAdminBackupRestoreReceiptGET({
    readAuthorizedSession: async () => { authReads++; return currentSession; }, readMode: () => "atomic",
    createClient: () => ({ rpc: async (name: string, args: Record<string, unknown>) => {
      rpcReads++; assert.equal(name, "faolla_read_platform_snapshot_restore_receipt_v1");
      assert.ok(currentSession); assert.equal(args.p_actor_key, platformSnapshotRestoreReceiptActorKey(currentSession));
      return rpcClient.rpc(name, args);
    } }),
  });
  const url = `https://synthetic.invalid/api/super-admin/data-backups/restore-operations?${new URLSearchParams(expected)}`;
  const beforeQueries = await snapshot();
  const matched = await get(new Request(url)); assert.equal(matched.status, 200);
  assert.match(matched.headers.get("cache-control")!, /private, no-store/);
  const publicResult = await matched.json();
  assert.deepEqual(publicResult, { ok: true, outcome: "committed", receipt: item.receipt });
  assert.doesNotMatch(JSON.stringify(publicResult), /actorKey|actor_key|deviceId|syntheticAdapterMarker/);
  currentSession = otherSession;
  assert.deepEqual(await (await get(new Request(url))).json(), { ok: true, outcome: "unknown", receipt: null });
  currentSession = null; assert.equal((await get(new Request(url))).status, 401);
  assert.equal(authReads, 3); assert.equal(rpcReads, 2); assert.equal(await snapshot(), beforeQueries);
  pass("GET factory freshly authorizes each request, binds the server actor and exposes metadata only");

  const guard = createPlatformAdminBackupRestoreSyncGuard(); guard.block();
  let requests = 0;
  const fetcher = async (path: string, init: RequestInit) => {
    requests++; assert.equal(init.method, "GET"); assert.equal(init.cache, "no-store");
    assert.equal(init.credentials, "same-origin"); assert.equal(init.body, undefined);
    return get(new Request(new URL(path, "https://synthetic.invalid"), init));
  };
  currentSession = verifiedSession;
  assert.deepEqual(await lookupPlatformAdminBackupRestoreReceiptOnce(fetcher, expected), publicResult);
  assert.equal(requests, 1); assert.equal(guard.isPaused(), true); assert.equal(guard.resume(), false);
  currentSession = otherSession;
  assert.deepEqual(await lookupPlatformAdminBackupRestoreReceiptOnce(fetcher, expected), { ok: true, outcome: "unknown", receipt: null });
  assert.equal(requests, 2); assert.equal(guard.isPaused(), true); assert.equal(guard.resume(), false);
  currentSession = verifiedSession;
  await assert.rejects(lookupPlatformAdminBackupRestoreReceiptOnce(async (path, init) => {
    const result = await (await fetcher(path, init)).json();
    result.receipt.operationId = randomUUID(); return Response.json(result);
  }, expected), /super_admin_backup_restore_receipt_lookup_unconfirmed/);
  assert.equal(requests, 3); assert.equal(guard.isPaused(), true); assert.equal(guard.resume(), false);
  assert.equal(await snapshot(), beforeQueries);
  pass("one-GET client bridge validates receipt binding; committed, unknown and invalid responses never unlock writes");
  return groups;
}
