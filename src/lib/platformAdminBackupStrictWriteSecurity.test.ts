import assert from "node:assert/strict";
import { setImmediate as nextTurn } from "node:timers/promises";
import test, { type TestContext } from "node:test";
import { createPlatformAdminDataBackupEntry, buildPlatformAdminDataBackupBlocks,
  PLATFORM_ADMIN_DATA_BACKUP_SLUG, PLATFORM_ADMIN_DATA_BACKUP_BACKUP_SLUG,
  type PlatformAdminDataBackupRestoreScope } from "./platformAdminDataBackup";
import { createPlatformAdminDataBackupHandlers } from "./platformAdminDataBackupRoute";
import { buildPlatformMerchantSnapshotBlocks, PLATFORM_MERCHANT_SNAPSHOT_SLUG,
  PLATFORM_MERCHANT_SNAPSHOT_BACKUP_SLUG, PLATFORM_MERCHANT_SNAPSHOT_HISTORY_SLUG,
  PLATFORM_MERCHANT_SNAPSHOT_HISTORY_BACKUP_SLUG } from "./platformMerchantSnapshot";
import { buildPlatformMerchantConfigArchiveBlocks, PLATFORM_MERCHANT_CONFIG_ARCHIVE_SLUG,
  PLATFORM_MERCHANT_CONFIG_ARCHIVE_BACKUP_SLUG } from "./platformMerchantConfigArchive";
import { buildPlatformSupportInboxBlocks, PLATFORM_SUPPORT_INBOX_SLUG } from "./platformSupportInbox";

const AT = "2026-09-08T12:00:00.000Z";
const PRIVATE = "SYNTHETIC-PRIVATE-DATABASE-ERROR private@example.invalid password=not-a-real-secret";
const SUPPORT_HISTORY = "__platform_support_inbox_history__";
const SUPPORT_HISTORY_BACKUP = "__platform_support_inbox_history_backup__";
const INCOMPLETE = { error: "super_admin_backup_restore_incomplete", outcome: "partial_or_unknown", retrySafe: false };

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((yes) => { resolve = yes; });
  return { promise, resolve };
}

type Failure = "error" | "throw";
type Row = { id: string; slug: string; merchant_id: null; blocks: unknown; updated_at: string };
type QueryResult = { data: unknown; error: { message: string } | null };

/** Exercises the real handler and stores using only deterministic in-memory rows and RPCs. */
function fixture() {
  const entry = createPlatformAdminDataBackupEntry({ source: "manual", operator: "Synthetic", snapshot: {
    platformState: { version: 1, tenants: [], sites: [], planTemplates: [], industryCategories: [],
      homeLayout: { heroTitle: "Synthetic", heroSubtitle: "", featuredCategoryIds: [],
        merchantDefaultSortRule: "created_desc", sections: [] },
      roles: [], users: [], pageAssets: [], publishRecords: [], approvals: [], alerts: [], audits: [] },
    merchantSnapshot: { revision: "target-snapshot", snapshot: [], defaultSortRule: "created_desc", merchantConfigHistoryBySiteId: {} },
    merchantConfigArchive: { audits: [], backups: [] },
    supportInbox: { threads: [{ merchantId: "10000000", siteId: "10000000", merchantName: "Synthetic",
      merchantEmail: "synthetic@example.invalid", updatedAt: AT,
      messages: [{ id: "message-1", sender: "merchant", text: "Synthetic only", createdAt: AT }],
    }] }, merchantAccounts: [],
  } });
  entry.id = "synthetic-strict-write-backup"; entry.at = AT;
  const rows = new Map<string, Row>();
  const seed = (slug: string, blocks: unknown) => rows.set(slug, {
    id: slug, slug, merchant_id: null, blocks: structuredClone(blocks), updated_at: AT,
  });
  for (const slug of [PLATFORM_ADMIN_DATA_BACKUP_SLUG, PLATFORM_ADMIN_DATA_BACKUP_BACKUP_SLUG]) {
    seed(slug, buildPlatformAdminDataBackupBlocks({ backups: [entry] }));
  }
  for (const slug of [PLATFORM_MERCHANT_SNAPSHOT_SLUG, PLATFORM_MERCHANT_SNAPSHOT_BACKUP_SLUG,
    PLATFORM_MERCHANT_SNAPSHOT_HISTORY_SLUG, PLATFORM_MERCHANT_SNAPSHOT_HISTORY_BACKUP_SLUG]) {
    seed(slug, buildPlatformMerchantSnapshotBlocks({ ...entry.snapshot.merchantSnapshot!, revision: "current-snapshot" }));
  }
  for (const slug of [PLATFORM_MERCHANT_CONFIG_ARCHIVE_SLUG, PLATFORM_MERCHANT_CONFIG_ARCHIVE_BACKUP_SLUG]) {
    seed(slug, buildPlatformMerchantConfigArchiveBlocks({ audits: [], backups: [] }));
  }
  const currentInbox = structuredClone(entry.snapshot.supportInbox);
  currentInbox.threads[0].messages[0].text = "Current content differs from the restore target";
  seed(PLATFORM_SUPPORT_INBOX_SLUG, buildPlatformSupportInboxBlocks(currentInbox));
  const attempts: string[] = []; const writes: string[] = [];
  const failures = new Map<string, Failure>();
  const gates = new Map<string, { entered: ReturnType<typeof deferred>; release: ReturnType<typeof deferred> }>();
  let rpcFailure: Failure | undefined; let rpcGate: ReturnType<typeof deferred> | undefined;
  let rpcData: unknown = 1;
  let rpcAckError: unknown = null;
  const rpcEntered = deferred(); let rpcCalls = 0;
  const client = {
    from(table: string) {
      assert.equal(table, "pages", "never access real tables or a service client");
      const filters = new Map<string, unknown>();
      let body: Record<string, unknown> | null = null; let inserting = false; let limit = 100;
      const execute = async (single: boolean): Promise<QueryResult> => {
        const matching = [...rows.values()].filter((row) => [...filters].every(([key, value]) => row[key as keyof Row] === value));
        if (body) {
          const slug = inserting ? String(body.slug) : String(filters.get("slug") ?? matching[0]?.slug ?? filters.get("id"));
          attempts.push(slug);
          const gate = gates.get(slug);
          if (gate) { gate.entered.resolve(); await gate.release.promise; }
          const failure = failures.get(slug);
          if (failure === "throw") throw new Error(PRIVATE);
          if (failure === "error") return { data: null, error: { message: PRIVATE } };
          if (!inserting && matching.length !== 1) return { data: single ? null : [], error: null };
          const row: Row = { ...(matching[0] ?? { id: slug, slug, merchant_id: null, updated_at: AT }),
            ...body, blocks: structuredClone(body.blocks) } as Row;
          writes.push(slug); rows.set(slug, row);
          return { data: single ? structuredClone(row) : [structuredClone(row)], error: null };
        }
        const result = matching.slice(0, limit).map((row) => structuredClone(row));
        if (single && result.length > 1) return { data: null, error: { message: "synthetic duplicate" } };
        return { data: single ? result[0] ?? null : result, error: null };
      };
      const builder = {
        select(columns: string) { assert.ok(columns.length > 0); return builder; },
        is(column: string, value: unknown) { assert.equal(column, "merchant_id"); assert.equal(value, null); filters.set(column, value); return builder; },
        eq(column: string, value: unknown) { assert.ok(["id", "slug", "merchant_id", "updated_at"].includes(column)); filters.set(column, value); return builder; },
        limit(count: number) { limit = count; return builder; },
        maybeSingle() { return execute(true); },
        update(value: Record<string, unknown>) { body = value; return builder; },
        insert(value: Record<string, unknown>) { body = value; inserting = true; return builder; },
        then(resolve: (value: QueryResult) => unknown, reject?: (reason: unknown) => unknown) { return execute(false).then(resolve, reject); },
      };
      return builder;
    },
    async rpc(name: string) {
      assert.equal(name, "faolla_upsert_merchant_conversations_v1");
      rpcCalls += 1; rpcEntered.resolve();
      if (rpcGate) await rpcGate.promise;
      if (rpcFailure === "throw") throw new Error(PRIVATE);
      if (rpcFailure === "error") return { data: null, error: { message: PRIVATE } };
      return rpcAckError === undefined ? { data: rpcData } : { data: rpcData, error: rpcAckError };
    },
  };
  return { entry, rows, writes, attempts,
    handlers: createPlatformAdminDataBackupHandlers({ authorize: async () => true, createClient: () => client }),
    fail(slug: string, mode: Failure) { failures.set(slug, mode); },
    delay(slug: string) {
      const gate = { entered: deferred(), release: deferred() }; gates.set(slug, gate); return gate;
    },
    failRpc(mode: Failure) { rpcFailure = mode; },
    replyRpc(value: unknown) { rpcData = value; },
    replyRpcError(value: unknown) { rpcAckError = value; },
    delayRpc() { rpcGate = deferred(); return { entered: rpcEntered, release: rpcGate }; },
    get rpcCalls() { return rpcCalls; },
  };
}

function request(body: unknown, method = "PATCH") {
  return new Request("https://launch.faolla.com/api/super-admin/data-backups", { method,
    headers: { "content-type": "application/json", origin: "https://launch.faolla.com", "sec-fetch-site": "same-origin" },
    body: JSON.stringify(body) });
}

async function prepareRestore(f: ReturnType<typeof fixture>, scope: PlatformAdminDataBackupRestoreScope) {
  const response = await f.handlers.PATCH(request({ backupId: f.entry.id, scope, action: "preview" }));
  assert.equal(response.status, 200, await response.clone().text());
  const { preview } = await response.json();
  assert.deepEqual(f.attempts, []);
  return () => f.handlers.PATCH(request({ backupId: f.entry.id, scope, action: "restore",
    confirmationToken: preview.confirmationToken, confirmEmpty: true }));
}

async function assertIncomplete(response: Response) {
  assert.equal(response.status, 500);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const payload = await response.json();
  assert.deepEqual(payload, INCOMPLETE);
  assert.doesNotMatch(JSON.stringify(payload), /SYNTHETIC-PRIVATE|private@example|password=/);
}

for (const slug of [PLATFORM_MERCHANT_SNAPSHOT_BACKUP_SLUG, PLATFORM_MERCHANT_SNAPSHOT_HISTORY_BACKUP_SLUG,
  PLATFORM_MERCHANT_CONFIG_ARCHIVE_BACKUP_SLUG, SUPPORT_HISTORY_BACKUP]) {
  for (const failure of ["error", "throw"] as const) {
    test(`strict restore route: ${slug} ${failure} is incomplete, never best-effort success`, async () => {
      const f = fixture(); const scope = slug === SUPPORT_HISTORY_BACKUP ? "support_messages" : "user_manage";
      const restore = await prepareRestore(f, scope); f.fail(slug, failure);
      await assertIncomplete(await restore());
      assert.equal(f.attempts.filter((attempt) => attempt === slug).length, 1);
      assert.ok(!f.writes.includes(slug));
      if (slug === SUPPORT_HISTORY_BACKUP) {
        assert.ok(f.writes.includes(SUPPORT_HISTORY));
        assert.ok(!f.attempts.includes(PLATFORM_SUPPORT_INBOX_SLUG), "failed required history must stop the primary replacement");
      } else {
        assert.ok(f.writes.includes(PLATFORM_MERCHANT_SNAPSHOT_SLUG));
        assert.equal(f.writes.filter((write) => write === PLATFORM_MERCHANT_SNAPSHOT_SLUG).length, 1, "no compensating rewrite");
        if (slug !== PLATFORM_MERCHANT_CONFIG_ARCHIVE_BACKUP_SLUG) {
          assert.ok(!f.attempts.includes(PLATFORM_MERCHANT_CONFIG_ARCHIVE_SLUG), "target archive starts only after all snapshot writes succeed");
        }
      }
    });
  }
}

test("strict restore route waits past the old auxiliary deadline before target archive can start", { timeout: 5000 }, async (t) => {
  const f = fixture(); const restore = await prepareRestore(f, "user_manage");
  const gate = f.delay(PLATFORM_MERCHANT_SNAPSHOT_BACKUP_SLUG);
  t.after(() => gate.release.resolve());
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let settled = false;
  const operation = restore().finally(() => { settled = true; });
  try {
    await Promise.race([gate.entered.promise, operation.then(() => { throw new Error("required auxiliary was not started"); })]);
    t.mock.timers.tick(4000); await nextTurn();
    assert.equal(settled, false, "the old 3.5s timeout cannot report completion");
    assert.ok(!f.attempts.includes(PLATFORM_MERCHANT_CONFIG_ARCHIVE_SLUG));
  } finally { gate.release.resolve(); }
  const response = await operation;
  assert.equal(response.status, 200, await response.clone().text());
  assert.ok(f.writes.indexOf(PLATFORM_MERCHANT_SNAPSHOT_BACKUP_SLUG) < f.writes.indexOf(PLATFORM_MERCHANT_CONFIG_ARCHIVE_SLUG));
});

test("strict restore route does not fail fast while a started sibling write remains pending", { timeout: 5000 }, async (t) => {
  const f = fixture(); const restore = await prepareRestore(f, "user_manage");
  f.fail(PLATFORM_MERCHANT_SNAPSHOT_SLUG, "throw");
  const gate = f.delay(PLATFORM_MERCHANT_SNAPSHOT_HISTORY_SLUG);
  t.after(() => gate.release.resolve());
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let settled = false; const operation = restore().finally(() => { settled = true; });
  try {
    await Promise.race([gate.entered.promise, operation.then(() => { throw new Error("required sibling was not started"); })]);
    t.mock.timers.tick(4000); await nextTurn();
    assert.equal(settled, false, "a thrown sibling does not detach the outstanding primary/history write");
    assert.ok(!f.attempts.includes(PLATFORM_MERCHANT_CONFIG_ARCHIVE_SLUG));
  } finally { gate.release.resolve(); }
  await assertIncomplete(await operation);
  assert.ok(f.writes.includes(PLATFORM_MERCHANT_SNAPSHOT_HISTORY_SLUG));
});

function enableSyntheticShadow(t: TestContext) {
  const config = { MERCHANT_CONVERSATION_V1_DUAL_WRITE_MODE: "shadow", MERCHANT_CONVERSATION_V1_DUAL_WRITE_SITE_IDS: "10000000",
    MERCHANT_CONVERSATION_V1_DUAL_WRITE_TIMEOUT_MS: "250" };
  for (const [name, value] of Object.entries(config)) {
    const previous = process.env[name]; process.env[name] = value;
    t.after(() => { if (previous === undefined) delete process.env[name]; else process.env[name] = previous; });
  }
}

for (const failure of ["error", "throw"] as const) {
  test(`strict restore route: enabled support shadow ${failure} cannot be swallowed`, async (t) => {
    enableSyntheticShadow(t);
    const f = fixture(); const restore = await prepareRestore(f, "support_messages"); f.failRpc(failure);
    await assertIncomplete(await restore());
    assert.equal(f.rpcCalls, 1, "no replay of an unknown RPC");
    assert.ok(f.writes.includes(PLATFORM_SUPPORT_INBOX_SLUG), "the response must acknowledge possible earlier writes");
  });
}

test("strict restore route rejects malformed shadow acknowledgements instead of claiming success", async (t) => {
  enableSyntheticShadow(t);
  for (const data of [null, {}, [], "1", -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    const f = fixture(); const restore = await prepareRestore(f, "support_messages"); f.replyRpc(data);
    await assertIncomplete(await restore());
    assert.equal(f.rpcCalls, 1);
    assert.ok(f.writes.includes(PLATFORM_SUPPORT_INBOX_SLUG));
  }
});

test("strict restore route accepts the real nonnegative integer shadow acknowledgement including zero", async (t) => {
  enableSyntheticShadow(t);
  for (const data of [0, 1]) {
    const f = fixture(); const restore = await prepareRestore(f, "support_messages"); f.replyRpc(data);
    const response = await restore();
    assert.equal(response.status, 200, await response.clone().text());
    const payload = await response.json();
    assert.equal(payload.ok, true); assert.equal(f.rpcCalls, 1);
  }
});

test("strict restore route requires explicit null RPC error even when the acknowledgement count is valid", async (t) => {
  enableSyntheticShadow(t);
  for (const error of [undefined, false]) {
    const f = fixture(); const restore = await prepareRestore(f, "support_messages"); f.replyRpcError(error);
    await assertIncomplete(await restore());
    assert.equal(f.rpcCalls, 1);
  }
});

test("strict restore route keeps a timed-out shadow RPC attached until settlement, then reports unknown", { timeout: 5000 }, async (t) => {
  enableSyntheticShadow(t);
  const f = fixture(); const restore = await prepareRestore(f, "support_messages"); const gate = f.delayRpc();
  t.after(() => gate.release.resolve());
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let settled = false; const operation = restore().finally(() => { settled = true; });
  try {
    await Promise.race([gate.entered.promise, operation.then(() => { throw new Error("enabled shadow RPC was not started"); })]);
    t.mock.timers.tick(300); await nextTurn();
    assert.equal(settled, false, "timeout cannot detach a pending shadow mutation");
  } finally { gate.release.resolve(); }
  await assertIncomplete(await operation);
  assert.equal(f.rpcCalls, 1);
});

for (const failure of ["error", "throw"] as const) {
  test(`strict backup POST: copy ${failure} never claims success or exposes database detail`, async () => {
    const f = fixture(); f.fail(PLATFORM_ADMIN_DATA_BACKUP_BACKUP_SLUG, failure);
    const response = await f.handlers.POST(request({ source: "manual", operator: "Synthetic",
      platformState: f.entry.snapshot.platformState, merchantAccounts: [] }, "POST"));
    assert.equal(response.status, 500); assert.equal(response.headers.get("cache-control"), "no-store");
    const payload = await response.json();
    assert.deepEqual(payload, { error: "super_admin_backup_save_failed", outcome: "partial_or_unknown", retrySafe: false });
    assert.doesNotMatch(JSON.stringify(payload), /SYNTHETIC-PRIVATE|private@example|password=/);
    assert.ok(f.writes.includes(PLATFORM_ADMIN_DATA_BACKUP_SLUG), "primary may already be durable");
    assert.equal(f.attempts.filter((slug) => slug === PLATFORM_ADMIN_DATA_BACKUP_BACKUP_SLUG).length, 1);
  });
}
