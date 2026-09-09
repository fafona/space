import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile, realpath } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { normalizePlatformState } from "../../src/data/platformControlStore";
import { normalizePlatformMerchantSnapshotPayload } from "../../src/lib/platformMerchantSnapshot";
import { loadStoredPlatformMerchantSnapshot, savePlatformMerchantSnapshot,
  type PlatformMerchantSnapshotStoreClient } from "../../src/lib/platformMerchantSnapshotStore";
import { loadStoredPlatformMerchantConfigArchive, savePlatformMerchantConfigArchive,
  type PlatformMerchantConfigArchiveStoreClient } from "../../src/lib/platformMerchantConfigArchiveStore";
import { loadStoredPlatformSupportInbox, savePlatformSupportInbox,
  type PlatformSupportInboxStoreClient } from "../../src/lib/platformSupportInboxStore";
import { createPlatformSupportMessage, upsertPlatformSupportThread } from "../../src/lib/platformSupportInbox";
import { createPlatformAdminDataBackupEntry } from "../../src/lib/platformAdminDataBackup";
import { loadStoredPlatformAdminDataBackups, savePlatformAdminDataBackups,
  type PlatformAdminDataBackupStoreClient } from "../../src/lib/platformAdminDataBackupStore";
import type { PlatformSnapshotAtomicClient } from "../../src/lib/platformSnapshotAtomic.server";

// Standalone, opt-in, synthetic only. Never auto-run this from npm test/CI.
async function main() {
  assert.equal(process.env.PLATFORM_SNAPSHOT_BUSINESS_ALLOW_DISPOSABLE_DATABASE, "1", "Explicit synthetic DB opt-in required");
  const db = "faolla_platform_snapshot_business_test";
  const args = ["-X", "-w", "-q", "-A", "-t", "-h", "127.0.0.1", "-p", "56481", "-U", "postgres", "-d", db, "-v", "ON_ERROR_STOP=1"];
  const childEnv: NodeJS.ProcessEnv = { NODE_ENV: "test", ...Object.fromEntries(["PATH", "Path", "SystemRoot", "WINDIR", "TEMP", "TMP", "COMSPEC"]
    .filter((key) => process.env[key] !== undefined).map((key) => [key, process.env[key]])) };
  Object.assign(childEnv, { PGHOSTADDR: "127.0.0.1", PGCONNECT_TIMEOUT: "5", PGSSLMODE: "disable", PGCLIENTENCODING: "UTF8",
    PGPASSFILE: process.platform === "win32" ? "NUL" : "/dev/null", PGOPTIONS: "-c lc_messages=C -c statement_timeout=20000 -c lock_timeout=12000" });
  const psql = process.platform === "win32" ? "C:\\upos-runtime\\pgsql\\bin\\psql.exe" : "psql";
  const execute = (sql: string): Promise<{ code: number | null; out: string; err: string }> => new Promise((resolve, reject) => {
    const child = spawn(psql, args, { env: childEnv, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let out = ""; let err = "";
    // Preserve a multibyte character even when a pipe splits its bytes across chunks.
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
  assert.equal(await query("select inet_server_port();"), "56481");
  const expectedDirectory = await realpath(fileURLToPath(new URL("../../.runtime/platform-snapshot-business-test-pg", import.meta.url)));
  const actualDirectory = await realpath(await query("show data_directory;"));
  assert.equal(actualDirectory.toLowerCase().replaceAll("\\", "/"), expectedDirectory.toLowerCase().replaceAll("\\", "/"));
  assert.equal(await query("select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname not in ('pg_catalog','information_schema') and n.nspname !~ '^pg_toast' and c.relkind in ('r','p','v','m','S','f');"), "0", "Refusing nonempty database");
  assert.equal(await query("select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public';"), "0");
  const init = await readFile(new URL("../supabase-init.sql", import.meta.url), "utf8");
  const ddl = (pattern: RegExp) => { const match = init.match(pattern)?.[0]; assert.ok(match); return match; };
  const candidate = await readFile(new URL("./platform_snapshot_atomic_v1.candidate.sql", import.meta.url), "utf8");
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
    insert into public.pages(merchant_id,slug,blocks) values(null,'home','[]'),('10000000','home','[]');`);
  await query(candidate);
  const pages = async () => JSON.parse(await query("select jsonb_agg(to_jsonb(p) order by id) from public.pages p;"));
  const originalPages = await pages();
  let groups = 0; const pass = (label: string) => { groups++; console.log(`[platform-snapshot-business] passed ${label}`); };
  const live: PlatformSnapshotAtomicClient = { rpc: async (name, input) => {
    const parameters = name === "faolla_read_platform_snapshot_rows_v1" ? literal(String(input.p_scope))
      : name === "faolla_commit_platform_snapshot_rows_v1" ? `${literal(String(input.p_scope))},${json(input.p_expected)},${json(input.p_writes)}`
        : assert.fail("No other RPC or shadow operation is permitted");
    const result = await execute(`set role service_role; select public.${name}(${parameters});`);
    if (result.code !== 0) {
      const safe = /^ERROR:\s+(platform_snapshot_atomic_(?:invalid_request|conflict|store_corrupt|write_unconfirmed))\s*$/m.exec(result.err)?.[1];
      return { data: null, error: { code: safe ? "P0001" : "TEST_SQL_ERROR", message: safe ?? "synthetic_sql_failure" } };
    }
    return { data: JSON.parse(result.out), error: null };
  } };
  const client = { ...live, from() { assert.fail("Central store attempted a legacy table query/write"); } };
  const snapshots = client as unknown as PlatformMerchantSnapshotStoreClient;
  const archives = client as unknown as PlatformMerchantConfigArchiveStoreClient;
  const support = client as unknown as PlatformSupportInboxStoreClient;
  const backups = client as unknown as PlatformAdminDataBackupStoreClient;
  process.env.FAOLLA_PLATFORM_SNAPSHOT_WRITE_MODE = "atomic";
  process.env.MERCHANT_CONVERSATION_V1_DUAL_WRITE_MODE = "off";
  process.env.MERCHANT_CONVERSATION_V1_DUAL_WRITE_SITE_IDS = "";
  const initial = normalizePlatformMerchantSnapshotPayload({ revision: "", snapshot: [{ id: "10000000", merchantName: "Synthetic only" }],
    defaultSortRule: "created_desc", merchantConfigHistoryBySiteId: {} });
  const saved = await savePlatformMerchantSnapshot(snapshots, initial, { expectedRevision: "" });
  assert.equal(saved.error, null); assert.ok(saved.payload?.revision);
  assert.equal((await loadStoredPlatformMerchantSnapshot(snapshots))?.revision, saved.payload.revision);
  assert.deepEqual(await loadStoredPlatformMerchantConfigArchive(archives), { audits: [], backups: [] });
  pass("central configuration save initializes and reads all six rows via service RPCs only");

  let reads = 0; let release!: () => void; const barrier = new Promise<void>((resolve) => { release = resolve; });
  const paired = { ...client, rpc: async (name: string, input: Record<string, unknown>) => {
    const result = await live.rpc(name, input);
    if (name === "faolla_read_platform_snapshot_rows_v1") { reads++; if (reads === 2) release(); await barrier; }
    return result;
  } } as unknown as PlatformMerchantSnapshotStoreClient;
  const nextA = structuredClone(saved.payload); nextA.snapshot[0].merchantName = "Synthetic A";
  const nextB = structuredClone(saved.payload); nextB.snapshot[0].merchantName = "Synthetic B";
  const raced = await Promise.all([savePlatformMerchantSnapshot(paired, nextA, { expectedRevision: saved.payload.revision }),
    savePlatformMerchantSnapshot(paired, nextB, { expectedRevision: saved.payload.revision })]);
  assert.equal(raced.filter((result) => result.error === null).length, 1); assert.equal(reads, 2);
  pass("two central writers with identical physical baselines cannot both commit");

  const inbox = upsertPlatformSupportThread({ threads: [] }, { merchantId: "10000000", merchantName: "Synthetic",
    message: createPlatformSupportMessage({ id: "message-1", text: "Synthetic only", sender: "merchant" }) });
  assert.equal((await savePlatformSupportInbox(support, inbox)).error, null);
  assert.equal((await loadStoredPlatformSupportInbox(support)).threads[0].messages.length, 1);
  const beforeFault = await pages();
  await query("create function public.synthetic_support_failure() returns trigger language plpgsql as $$ begin if new.slug='__platform_support_inbox_history_backup__' then raise exception 'synthetic private failure'; end if; return new; end $$; create trigger synthetic_support_failure before update on public.pages for each row execute function public.synthetic_support_failure();");
  const nextInbox = upsertPlatformSupportThread(inbox, { merchantId: "10000000",
    message: createPlatformSupportMessage({ id: "message-2", text: "Must roll back", sender: "super_admin" }) });
  assert.ok((await savePlatformSupportInbox(support, nextInbox)).error);
  assert.deepEqual(await pages(), beforeFault);
  await query("drop trigger synthetic_support_failure on public.pages; drop function public.synthetic_support_failure();");
  assert.equal((await savePlatformSupportInbox(support, nextInbox, { requireAllWrites: true })).error, null);
  assert.equal((await loadStoredPlatformSupportInbox(support)).threads[0].messages.length, 2);
  pass("central support merge/history commit rolls all three rows back on a late trigger failure");

  const baseline = await loadStoredPlatformAdminDataBackups(backups);
  const makeBackup = () => createPlatformAdminDataBackupEntry({ source: "manual", operator: "synthetic",
    snapshot: { platformState: normalizePlatformState({}), merchantSnapshot: null,
      merchantConfigArchive: { audits: [], backups: [] }, supportInbox: { threads: [] }, merchantAccounts: [] } });
  const catalog = await savePlatformAdminDataBackups(backups, { backups: [makeBackup()] }, { requireAllWrites: true, expectedPayload: baseline });
  assert.equal(catalog.error, null);
  const beforeStale = await pages();
  assert.ok((await savePlatformAdminDataBackups(backups, { backups: [makeBackup()] }, { expectedPayload: baseline })).error);
  assert.deepEqual(await pages(), beforeStale);
  pass("central backup catalog rejects a stale append without dropping a newer backup");
  assert.ok((await savePlatformMerchantConfigArchive(archives, { audits: [], backups: [] }, { requireAllWrites: true })).error);
  assert.ok((await savePlatformSupportInbox(support, { threads: [] }, { replace: true, requireAllWrites: true })).error);
  assert.deepEqual(await pages(), beforeStale);
  process.env.MERCHANT_CONVERSATION_V1_DUAL_WRITE_MODE = "shadow";
  process.env.MERCHANT_CONVERSATION_V1_DUAL_WRITE_SITE_IDS = "10000000";
  assert.ok((await savePlatformSupportInbox(support, nextInbox)).error);
  assert.deepEqual(await pages(), beforeStale);
  pass("standalone restore and incompatible shadow mode are refused before mutation");
  const finalPages = await pages();
  for (const row of originalPages) assert.deepEqual(finalPages.find((item: { id: string }) => item.id === row.id), row);
  pass("unrelated public and merchant pages retain all contents and timestamps");
  console.log(JSON.stringify({ groups, postgres: await query("show server_version;"), candidateSha256: createHash("sha256").update(candidate).digest("hex"),
    boundary: "synthetic central stores + psql RPC bridge; not HTTP/PostgREST/Auth, full restore or production rollout" }));
}
// An unfinished barrier must not let Node exit 0 merely because no pipe remains.
const watchdog = setTimeout(() => { throw new Error("synthetic_business_acceptance_timeout"); }, 60000);
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => clearTimeout(watchdog));
