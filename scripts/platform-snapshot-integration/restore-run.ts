import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile, realpath } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { normalizePlatformState } from "../../src/data/platformControlStore";
import { createPlatformAdminDataBackupEntry } from "../../src/lib/platformAdminDataBackup";
import { savePlatformAdminDataBackups, type PlatformAdminDataBackupStoreClient } from "../../src/lib/platformAdminDataBackupStore";
import { normalizePlatformMerchantSnapshotPayload } from "../../src/lib/platformMerchantSnapshot";
import { buildPlatformMerchantSnapshotBlocks } from "../../src/lib/platformMerchantSnapshot";
import { buildPlatformMerchantConfigArchiveBlocks } from "../../src/lib/platformMerchantConfigArchive";
import { buildPlatformSupportInboxBlocks, type PlatformSupportInboxPayload } from "../../src/lib/platformSupportInbox";
import { handlePlatformAdminBackupRestoreAtomic } from "../../src/lib/platformAdminBackupRestoreAtomic.server";
import { parsePlatformAdminBackupRestorePreview, parsePlatformAdminBackupRestoreResult } from "../../src/lib/platformAdminBackupRestoreClient";
import { parsePlatformAdminBackupRestoreReceiptLookup } from "../../src/lib/platformAdminBackupRestoreReceiptClient";
import { platformSnapshotRestoreReceiptActorKey } from "../../src/lib/platformSnapshotRestoreReceipt.server";
import {
  PLATFORM_SNAPSHOT_ATOMIC_SCOPES, readPlatformSnapshotAtomic, commitPlatformSnapshotAtomic,
  readPlatformSnapshotRestoreAtomic, commitPlatformSnapshotRestoreAtomic,
  type PlatformSnapshotAtomicClient, type PlatformSnapshotAtomicScope,
  type PlatformSnapshotRestoreAtomicView, type PlatformSnapshotAtomicWrite, type PlatformSnapshotJson,
} from "../../src/lib/platformSnapshotAtomic.server";

// Explicitly disposable, synthetic and standalone. Never loads .env, resets a
// database, installs a registered migration or runs automatically in npm test.
async function main() {
  assert.equal(process.env.PLATFORM_SNAPSHOT_RESTORE_ALLOW_DISPOSABLE_DATABASE, "1", "Explicit synthetic DB opt-in required");
  const db = "faolla_platform_snapshot_restore_test";
  const args = ["-X", "-w", "-q", "-A", "-t", "-h", "127.0.0.1", "-p", "56491", "-U", "postgres", "-d", db, "-v", "ON_ERROR_STOP=1"];
  const childEnv: NodeJS.ProcessEnv = { NODE_ENV: "test", ...Object.fromEntries(["PATH", "Path", "SystemRoot", "WINDIR", "TEMP", "TMP", "COMSPEC"]
    .filter((key) => process.env[key] !== undefined).map((key) => [key, process.env[key]])) };
  Object.assign(childEnv, { PGHOSTADDR: "127.0.0.1", PGCONNECT_TIMEOUT: "5", PGSSLMODE: "disable", PGCLIENTENCODING: "UTF8",
    PGPASSFILE: process.platform === "win32" ? "NUL" : "/dev/null", PGOPTIONS: "-c lc_messages=C -c statement_timeout=20000 -c lock_timeout=12000" });
  const psql = process.platform === "win32" ? "C:\\upos-runtime\\pgsql\\bin\\psql.exe" : "psql";
  const execute = (sql: string): Promise<{ code: number | null; out: string; err: string }> => new Promise((resolve, reject) => {
    const child = spawn(psql, args, { env: childEnv, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let out = ""; let err = "";
    child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
    const timer = setTimeout(() => child.kill(), 30000);
    child.stdout.on("data", (part) => { out += part.toString(); }); child.stderr.on("data", (part) => { err += part.toString(); });
    child.stdin.on("error", (error: NodeJS.ErrnoException) => { if (error.code !== "EPIPE") reject(error); });
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ code, out: out.trim(), err }); }); child.stdin.end(sql);
  });
  const query = async (sql: string) => { const result = await execute(sql); assert.equal(result.code, 0, result.err); return result.out; };
  const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;
  const json = (value: unknown) => `${literal(JSON.stringify(value))}::jsonb`;
  assert.equal(await query("select current_database();"), db);
  assert.equal(await query("select host(inet_server_addr());"), "127.0.0.1");
  assert.equal(await query("select inet_server_port();"), "56491");
  const expectedDirectory = await realpath(fileURLToPath(new URL("../../.runtime/platform-snapshot-restore-test-pg", import.meta.url)));
  const actualDirectory = await realpath(await query("show data_directory;"));
  assert.equal(actualDirectory.toLowerCase().replaceAll("\\", "/"), expectedDirectory.toLowerCase().replaceAll("\\", "/"));
  assert.equal(await query("select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname not in ('pg_catalog','information_schema') and n.nspname !~ '^pg_toast' and c.relkind in ('r','p','v','m','S','f');"), "0", "Refusing nonempty database");
  assert.equal(await query("select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public';"), "0", "Refusing existing public functions");
  const init = await readFile(new URL("../supabase-init.sql", import.meta.url), "utf8");
  const ddl = (pattern: RegExp) => { const match = init.match(pattern)?.[0]; assert.ok(match); return match; };
  const candidate = await readFile(new URL("./platform_snapshot_atomic_v1.candidate.sql", import.meta.url), "utf8");
  const restoreCandidate = await readFile(new URL("./platform_snapshot_restore_v1.candidate.sql", import.meta.url), "utf8");
  const receiptCandidate = await readFile(new URL("./platform_snapshot_restore_receipts_v1.candidate.sql", import.meta.url), "utf8");
  assert.equal(createHash("sha256").update(candidate).digest("hex"), "838b642731bfceec9fb66d8da9e1debe7cdacff713670c102172b38457ac7d93");
  assert.equal(createHash("sha256").update(receiptCandidate).digest("hex"), "886754062ec8bb9558f87582180a6b548fdda87b7dd5fc4610a2aeb0bfe189b2");
  await query(`create extension pgcrypto;
    do $$ begin
      if exists(select 1 from pg_roles where rolname in ('anon','authenticated','service_role') and (rolsuper or rolcanlogin or rolcreaterole or rolcreatedb)) then
        raise exception 'unsafe_synthetic_role'; end if;
      if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
      if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
      if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin; end if;
    end $$;
    ${ddl(/create table if not exists public\.pages \([\s\S]*?\n\);/i)}
    ${ddl(/create or replace function public\.set_current_timestamp_updated_at\(\)[\s\S]*?\n\$\$;/i)}
    ${ddl(/create trigger set_pages_updated_at[\s\S]*?public\.set_current_timestamp_updated_at\(\);/i)}
    alter table public.pages enable row level security; grant usage on schema public to anon,authenticated,service_role;
    insert into public.pages(merchant_id,slug,blocks) values(null,'home','[{"synthetic":"public"}]'),('10000000','home','[{"synthetic":"merchant"}]');`);
  await query(candidate); await query(restoreCandidate); await query(receiptCandidate);
  const pages = async () => JSON.parse(await query("select jsonb_agg(to_jsonb(p) order by id) from public.pages p;")) as Array<{ id: string; slug: string }>;
  const unrelated = await pages();
  let groups = 0; const pass = (label: string) => { groups++; console.log(`[platform-snapshot-restore] passed ${label}`); };
  const rpcSql = (name: string, input: Record<string, unknown>) => {
    const parameters = name === "faolla_read_platform_snapshot_rows_v1" || name === "faolla_read_platform_snapshot_restore_v1" ? literal(String(input.p_scope))
      : name === "faolla_commit_platform_snapshot_rows_v1" ? `${literal(String(input.p_scope))},${json(input.p_expected)},${json(input.p_writes)}`
        : name === "faolla_commit_platform_snapshot_restore_v1" ? `${literal(String(input.p_scope))},${json(input.p_catalog_expected)},${json(input.p_target_expected)},${json(input.p_writes)}`
          : name === "faolla_read_platform_snapshot_restore_receipt_v1" || name === "faolla_commit_platform_snapshot_restore_receipt_v1"
            ? ["p_operation_id", "p_actor_key", "p_scope", "p_backup_id", "p_confirmation_token"].map((key) => literal(String(input[key]))).join(",")
              + (name === "faolla_commit_platform_snapshot_restore_receipt_v1" ? `,${json(input.p_catalog_expected)},${json(input.p_target_expected)},${json(input.p_writes)}` : "")
            : assert.fail("No unrelated RPC, legacy write or shadow operation is permitted");
    return `set application_name='synthetic-restore-rpc'; set role service_role; select public.${name}(${parameters});`;
  };
  const live: PlatformSnapshotAtomicClient = { rpc: async (name, input) => {
    const result = await execute(rpcSql(name, input));
    if (result.code !== 0) {
      const safe = /^ERROR:\s+(platform_snapshot_atomic_(?:invalid_request|conflict|store_corrupt|write_unconfirmed))\s*$/m.exec(result.err)?.[1];
      return { data: null, error: { code: safe ? "P0001" : "TEST_SQL_ERROR", message: safe ?? "synthetic_sql_failure" } };
    }
    return { data: JSON.parse(result.out), error: null };
  } };
  const rawWrites = (scope: PlatformSnapshotAtomicScope, label: string): PlatformSnapshotAtomicWrite[] =>
    PLATFORM_SNAPSHOT_ATOMIC_SCOPES[scope].map((slug) => ({ slug,
      blocks: slug.includes("support_inbox_history") ? { entries: [], unknown: { label, multilingual: "中文 ñ €" } }
        : [{ unknown: { label, future: [null, false, 17, "中文 ñ €"] } }],
    }));
  const commitArgs = (view: PlatformSnapshotRestoreAtomicView, writes: PlatformSnapshotAtomicWrite[]) => ({
    p_scope: view.scope, p_catalog_expected: view.catalog.rows, p_target_expected: view.target.rows, p_writes: writes,
  });
  const rejectSql = async (sql: string, message: string) => {
    const before = await pages(); const result = await execute(sql);
    assert.notEqual(result.code, 0); assert.match(result.err, new RegExp(`^ERROR:\\s+${message}\\s*$`, "m"));
    assert.deepEqual(await pages(), before); return result;
  };

  for (const role of ["anon", "authenticated"]) {
    for (const signature of ["public.faolla_read_platform_snapshot_restore_v1(text)", "public.faolla_commit_platform_snapshot_restore_v1(text,jsonb,jsonb,jsonb)"]) {
      assert.equal(await query(`select has_function_privilege(${literal(role)},${literal(signature)},'execute');`), "f");
      assert.equal(await query(`select has_function_privilege('service_role',${literal(signature)},'execute');`), "t");
    }
    const result = await execute(`set role ${role}; select public.faolla_read_platform_snapshot_restore_v1('user_manage');`);
    assert.notEqual(result.code, 0); assert.match(result.err, /permission denied for function/);
    const commit = await execute(`set role ${role}; select public.faolla_commit_platform_snapshot_restore_v1('user_manage','[]','[]','[]');`);
    assert.notEqual(commit.code, 0); assert.match(commit.err, /permission denied for function/);
  }
  await query("grant execute on function public.faolla_read_platform_snapshot_restore_v1(text) to public; grant execute on function public.faolla_commit_platform_snapshot_restore_v1(text,jsonb,jsonb,jsonb) to authenticated;");
  await query(restoreCandidate);
  assert.equal(await query("select has_function_privilege('anon','public.faolla_read_platform_snapshot_restore_v1(text)','execute') or has_function_privilege('authenticated','public.faolla_commit_platform_snapshot_restore_v1(text,jsonb,jsonb,jsonb)','execute');"), "f");
  pass("service-only ACL and reapplication repair grant drift on supplemental functions");

  const missing = await readPlatformSnapshotRestoreAtomic(live, "user_manage");
  assert.ok(missing.catalog.rows.every((entry) => entry.row === null));
  await rejectSql(rpcSql("faolla_commit_platform_snapshot_restore_v1", commitArgs(missing, rawWrites("user_manage", "invalid"))), "platform_snapshot_atomic_invalid_request");
  await query(`insert into public.pages(merchant_id,slug,blocks) values(null,'__platform_admin_data_backup__',${json([{ unknownCatalog: "one physical copy" }])});`);
  for (const scope of ["user_manage", "support_messages"] as const) {
    const before = await readPlatformSnapshotRestoreAtomic(live, scope); const writes = rawWrites(scope, `initial-${scope}`);
    const result = await commitPlatformSnapshotRestoreAtomic(live, before, writes);
    assert.deepEqual(result.catalog, before.catalog); assert.equal(result.catalog.rows[1].row, null);
    assert.deepEqual(result.target.rows.map((entry) => ({ slug: entry.slug, blocks: entry.row!.blocks })), writes);
    const noOp = await commitPlatformSnapshotRestoreAtomic(live, result, writes); assert.deepEqual(noOp, result);
  }
  pass("both scopes restore exact raw JSON; source missing copy stays absent; no-op keeps timestamps");

  const valid = await readPlatformSnapshotRestoreAtomic(live, "user_manage");
  const argumentsList: Array<Record<string, unknown>> = [];
  for (const change of [
    (v: ReturnType<typeof commitArgs>) => { v.p_catalog_expected.reverse(); },
    (v: ReturnType<typeof commitArgs>) => { v.p_catalog_expected.pop(); },
    (v: ReturnType<typeof commitArgs>) => { v.p_catalog_expected.push(v.p_catalog_expected[0]); },
    (v: ReturnType<typeof commitArgs>) => { v.p_catalog_expected[0].row!.updatedAt = "infinity"; },
    (v: ReturnType<typeof commitArgs>) => { v.p_catalog_expected[0].row!.blocks = {}; },
    (v: ReturnType<typeof commitArgs>) => { v.p_catalog_expected[1].row = structuredClone(v.p_catalog_expected[0].row); },
  ]) { const input = commitArgs(structuredClone(valid), rawWrites("user_manage", "malformed")); change(input); argumentsList.push(input); }
  argumentsList.push({ ...commitArgs(valid, rawWrites("user_manage", "malformed")), p_scope: "backup_catalog" });
  for (const input of argumentsList) await rejectSql(rpcSql("faolla_commit_platform_snapshot_restore_v1", input), "platform_snapshot_atomic_invalid_request");
  await rejectSql(`set role service_role; select public.faolla_commit_platform_snapshot_restore_v1('user_manage',
    ${json(valid.catalog.rows)},${json(valid.target.rows)},jsonb_build_array(jsonb_build_object('oversize',repeat('x',67108865))));`, "platform_snapshot_atomic_invalid_request");
  pass("malformed source vectors, timestamps, duplicates, scopes and oversized requests never write");

  for (const part of ["catalog", "target"] as const) {
    const before = await readPlatformSnapshotRestoreAtomic(live, "user_manage");
    const entry = before[part].rows.find((item) => item.row !== null)!;
    await query(`update public.pages set blocks=blocks||${json([{ race: part }])} where merchant_id is null and slug=${literal(entry.slug)};`);
    const actual = await pages();
    await assert.rejects(commitPlatformSnapshotRestoreAtomic(live, before, rawWrites("user_manage", `stale-${part}`)), /platform_snapshot_atomic_conflict/);
    assert.deepEqual(await pages(), actual);
  }
  pass("source and target changes after the captured read reject with exact zero-write CAS conflicts");

  const raceView = await readPlatformSnapshotRestoreAtomic(live, "support_messages");
  const raced = await Promise.allSettled([
    commitPlatformSnapshotRestoreAtomic(live, raceView, rawWrites("support_messages", "winner-A")),
    commitPlatformSnapshotRestoreAtomic(live, raceView, rawWrites("support_messages", "winner-B")),
  ]);
  assert.equal(raced.filter((r) => r.status === "fulfilled").length, 1);
  const rejected = raced.find((r) => r.status === "rejected"); assert.ok(rejected?.status === "rejected");
  assert.equal(rejected.reason.message, "platform_snapshot_atomic_conflict");
  pass("two restores sharing a physical baseline have exactly one winner and no automatic replay");

  const waitUntil = async (sql: string) => {
    const deadline = Date.now() + 4000;
    while (Date.now() < deadline) { if (await query(sql) === "t") return; await new Promise((resolve) => setTimeout(resolve, 20)); }
    assert.fail("Expected real PostgreSQL lock state was not observed");
  };
  for (const part of ["catalog", "target"] as const) {
    const before = await readPlatformSnapshotRestoreAtomic(live, "user_manage"); const entry = before[part].rows.find((item) => item.row !== null)!;
    const holder = execute(`set application_name='synthetic-restore-holder'; begin;
      select pg_advisory_xact_lock(hashtextextended('faolla-platform-snapshot-atomic-v1',0));
      update public.pages set blocks=blocks||${json([{ lockedRace: part }])} where merchant_id is null and slug=${literal(entry.slug)};
      select pg_sleep(1.5); commit;`);
    await waitUntil("select exists(select 1 from pg_stat_activity where application_name='synthetic-restore-holder' and wait_event='PgSleep');");
    let settled = false;
    const waiting = commitPlatformSnapshotRestoreAtomic(live, before, rawWrites("user_manage", `waiting-${part}`))
      .then(() => ({ error: null as Error | null }), (error: Error) => ({ error })).finally(() => { settled = true; });
    await waitUntil("select exists(select 1 from pg_locks l join pg_stat_activity a on a.pid=l.pid where a.application_name='synthetic-restore-rpc' and l.locktype='advisory' and not l.granted);");
    assert.equal(settled, false); assert.equal((await holder).code, 0);
    const expected = await pages(); const result = await waiting;
    assert.equal(result.error?.message, "platform_snapshot_atomic_conflict"); assert.deepEqual(await pages(), expected);
  }
  pass("real two-connection source/target writer lock waits end in CAS rejection, never stale overwrite");

  for (const scope of ["user_manage", "support_messages"] as const) {
    const before = await readPlatformSnapshotRestoreAtomic(live, scope); const last = PLATFORM_SNAPSHOT_ATOMIC_SCOPES[scope].at(-1)!;
    const allRows = await pages();
    await query(`create function public.synthetic_restore_failure() returns trigger language plpgsql as $$ begin
      if new.slug=${literal(last)} then raise exception 'PRIVATE synthetic last target failure'; end if; return new; end $$;
      create trigger synthetic_restore_failure after update on public.pages for each row execute function public.synthetic_restore_failure();`);
    try {
      await assert.rejects(commitPlatformSnapshotRestoreAtomic(live, before, rawWrites(scope, "late-trigger-fault")), /platform_snapshot_atomic_write_unconfirmed/);
      assert.deepEqual(await pages(), allRows);
    } finally { await query("drop trigger synthetic_restore_failure on public.pages; drop function public.synthetic_restore_failure();"); }
  }
  pass("last target AFTER-trigger failures roll all selected rows and timestamps back in both scopes");

  for (const effect of ["edit", "insert-missing"] as const) {
    const before = await readPlatformSnapshotRestoreAtomic(live, "user_manage"); const allRows = await pages();
    const effectSql = effect === "edit"
      ? `update public.pages set blocks='[{"forgedSource":true}]' where merchant_id is null and slug='__platform_admin_data_backup__';`
      : `insert into public.pages(merchant_id,slug,blocks) values(null,'__platform_admin_data_backup_backup__','[{"forgedSource":true}]');`;
    await query(`create function public.synthetic_restore_source_drift() returns trigger language plpgsql as $$ begin
      if new.slug='__platform_merchant_snapshot_history_backup__' then ${effectSql} end if; return new; end $$;
      create trigger synthetic_restore_source_drift after update on public.pages for each row execute function public.synthetic_restore_source_drift();`);
    try {
      await assert.rejects(commitPlatformSnapshotRestoreAtomic(live, before, rawWrites("user_manage", `trigger-source-${effect}`)), /platform_snapshot_atomic_write_unconfirmed/);
      assert.deepEqual(await pages(), allRows);
    } finally { await query("drop trigger synthetic_restore_source_drift on public.pages; drop function public.synthetic_restore_source_drift();"); }
  }
  pass("a target trigger editing the source or creating its missing copy rolls the nested commit back");

  const lostView = await readPlatformSnapshotRestoreAtomic(live, "support_messages"); const lostWrites = rawWrites("support_messages", "committed-but-ack-lost");
  let attempts = 0;
  const lostAck: PlatformSnapshotAtomicClient = { rpc: async (name, input) => {
    attempts++; const result = await live.rpc(name, input); assert.equal(result.error, null); throw new Error("PRIVATE connection lost after database commit");
  } };
  await assert.rejects(commitPlatformSnapshotRestoreAtomic(lostAck, lostView, lostWrites), /platform_snapshot_atomic_write_unconfirmed/);
  assert.equal(attempts, 1);
  const committed = await readPlatformSnapshotRestoreAtomic(live, "support_messages");
  assert.deepEqual(committed.target.rows.map((entry) => ({ slug: entry.slug, blocks: entry.row!.blocks })), lostWrites);
  assert.deepEqual(committed.catalog, lostView.catalog);
  pass("transport ACK loss reports unknown once while preserving the actual successful DB commit");

  // Replace our synthetic physical fixtures with real application serializers;
  // this validates the new handler/plan/adapter/SQL contract, not just SQL JSON.
  process.env.FAOLLA_PLATFORM_SNAPSHOT_WRITE_MODE = "atomic";
  process.env.MERCHANT_CONVERSATION_V1_DUAL_WRITE_MODE = "off";
  process.env.MERCHANT_CONVERSATION_V1_DUAL_WRITE_SITE_IDS = "";
  const snapshot = normalizePlatformMerchantSnapshotPayload({ revision: "synthetic-current", snapshot: [
    { id: "10000000", merchantName: "Synthetic current" }, { id: "10000001", merchantName: "Retained synthetic" }],
    defaultSortRule: "created_desc", merchantConfigHistoryBySiteId: {} });
  const inbox = (text: string): PlatformSupportInboxPayload => ({ threads: [{ merchantId: "10000000", siteId: "10000000", merchantName: "Synthetic", merchantEmail: "",
    updatedAt: "2026-09-08T12:00:00.000Z", messages: [{ id: text, text, sender: "merchant", createdAt: "2026-09-08T12:00:00.000Z" }] }] });
  for (const scope of ["user_manage", "support_messages"] as const) {
    const before = await readPlatformSnapshotAtomic(live, scope);
    await commitPlatformSnapshotAtomic(live, scope, before.rows, PLATFORM_SNAPSHOT_ATOMIC_SCOPES[scope].map((slug) => ({ slug,
      blocks: (scope === "user_manage" ? slug.includes("config_archive") ? buildPlatformMerchantConfigArchiveBlocks({ audits: [], backups: [] })
        : buildPlatformMerchantSnapshotBlocks(snapshot) : slug.includes("inbox_history") ? { siteId: "platform-support-inbox", updatedAt: null, entries: [] }
          : buildPlatformSupportInboxBlocks(inbox("current"))) as unknown as PlatformSnapshotJson,
    })));
  }
  const backup = createPlatformAdminDataBackupEntry({ source: "manual", operator: "synthetic", snapshot: {
    platformState: normalizePlatformState({}), merchantSnapshot: { ...snapshot, revision: "backup", snapshot: [{ ...snapshot.snapshot[0], merchantName: "Restored 中文 ñ" }] },
    merchantConfigArchive: { audits: [], backups: [] }, supportInbox: inbox("restored 中文 ñ"), merchantAccounts: [],
  } });
  // The prior opaque source was intentional; initialize the business catalog
  // through a physical commit, then append via the real catalog writer.
  const catalog = await readPlatformSnapshotAtomic(live, "backup_catalog");
  const { buildPlatformAdminDataBackupBlocks } = await import("../../src/lib/platformAdminDataBackup");
  await commitPlatformSnapshotAtomic(live, "backup_catalog", catalog.rows, PLATFORM_SNAPSHOT_ATOMIC_SCOPES.backup_catalog.map((slug) => ({ slug,
    blocks: buildPlatformAdminDataBackupBlocks({ backups: [] }) as unknown as PlatformSnapshotJson })));
  const realClient = { ...live, from(): never { assert.fail("Legacy I/O is forbidden in candidate atomic flow"); } };
  assert.equal((await savePlatformAdminDataBackups(realClient as unknown as PlatformAdminDataBackupStoreClient,
    { backups: [backup] }, { expectedPayload: { backups: [] } })).error, null);
  // Trusted synthetic server context, never body-supplied identity. This does
  // not stand in for HTTP authentication/revocation checks in the real route.
  const context = { actorKey: platformSnapshotRestoreReceiptActorKey({ deviceId: "synthetic-restore-run-session" }) };
  for (const scope of ["user_manage", "support_messages"] as const) {
    const before = await readPlatformSnapshotRestoreAtomic(live, scope);
    const previewResult = await handlePlatformAdminBackupRestoreAtomic(realClient, { action: "preview", scope, backupId: backup.id }, context);
    assert.equal(previewResult.status, 200, JSON.stringify(previewResult.body));
    const preview = parsePlatformAdminBackupRestorePreview(previewResult.body, { scope, backupId: backup.id }); assert.ok(preview);
    assert.equal(preview.receiptProtocol, 1);
    assert.deepEqual(await readPlatformSnapshotRestoreAtomic(live, scope), before);
    const operationId = randomUUID();
    const result = await handlePlatformAdminBackupRestoreAtomic(realClient, { action: "restore", scope, backupId: backup.id,
      confirmationToken: preview.confirmationToken, confirmEmpty: true, operationId }, context);
    assert.equal(result.status, 200, JSON.stringify(result.body)); assert.ok(parsePlatformAdminBackupRestoreResult(result.body, preview));
    assert.equal(result.body.replayed, false);
    const receipt = parsePlatformAdminBackupRestoreReceiptLookup({ ok: result.body.ok, outcome: result.body.outcome, receipt: result.body.receipt },
      { operationId, scope, backupId: backup.id, confirmationToken: preview.confirmationToken });
    assert.equal(receipt?.outcome, "committed");
    assert.equal(await query(`select actor_key from public.faolla_platform_snapshot_restore_receipts where operation_id=${literal(operationId)}::uuid;`), context.actorKey);
    assert.deepEqual((await readPlatformSnapshotRestoreAtomic(live, scope)).catalog, before.catalog);
    // A new ID checks stale preview rejection rather than the old operation's
    // intentionally successful historical-receipt early lookup.
    const stale = await handlePlatformAdminBackupRestoreAtomic(realClient, { action: "restore", scope, backupId: backup.id,
      confirmationToken: preview.confirmationToken, confirmEmpty: true, operationId: randomUUID() }, context);
    assert.equal(stale.status, 409); assert.equal(stale.body.outcome, "not_started");
    if (scope === "user_manage") assert.equal((result.body.merchantSnapshot as { snapshot: unknown[] }).snapshot.length, 2);
    else assert.equal((result.body.threads as PlatformSupportInboxPayload["threads"])[0].messages[0].text, "restored 中文 ñ");
  }
  pass("real preview/restore handler + serializers + UI receipt parser work for both scopes against PG");
  const finalPages = await pages(); for (const row of unrelated) assert.deepEqual(finalPages.find((item) => item.id === row.id), row);
  pass("unrelated public and merchant pages remain byte-equivalent including timestamps");
  console.log(JSON.stringify({ groups, postgres: await query("show server_version;"),
    candidateSha256: createHash("sha256").update(candidate).digest("hex"), restoreCandidateSha256: createHash("sha256").update(restoreCandidate).digest("hex"),
    receiptCandidateSha256: createHash("sha256").update(receiptCandidate).digest("hex"),
    boundary: "synthetic handler + TS adapter + psql RPC bridge; not HTTP/PostgREST/Auth, ABA safety, old-writer cutover, browser-local state or production rollout" }));
}
const watchdog = setTimeout(() => { throw new Error("synthetic_restore_acceptance_timeout"); }, 120000);
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => clearTimeout(watchdog));
