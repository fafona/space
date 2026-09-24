import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildMerchantOrderAttentionProjection } from "../src/lib/merchantOrderAttentionProjection";
import { parseMerchantOrderAttentionSummary } from "../src/lib/merchantOrderAttention";
import { readMerchantOrderAttentionSummary } from "../src/lib/merchantOrderAttention.server";
import { createServerSupabaseServiceClient } from "../src/lib/superAdminServer";

const SITE = "10000000";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Revision = { epoch: string; generation: string; enabled: boolean; payload?: unknown };
type Source = Revision & { state: "source"; rows: unknown[] };
type Query = (sql: string) => Promise<unknown>;
export type PilotAction = "prepare" | "enable" | "verify" | "disable";

const fail = (code: string): never => { throw new Error(`order_attention_${code}`); };
const literal = (value: unknown) => `'${String(value).replaceAll("'", "''")}'`;
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const sameRevision = (a: Revision, b: Revision) => a.epoch === b.epoch && a.generation === b.generation;

function revision(input: unknown): Revision {
  if (!input || typeof input !== "object" || Array.isArray(input)) return fail("invalid_revision");
  const value = input as Revision;
  if (typeof value.epoch !== "string" || !UUID.test(value.epoch) || typeof value.generation !== "string"
    || !/^(0|[1-9][0-9]{0,18})$/.test(value.generation) || BigInt(value.generation) > BigInt("9223372036854775807")
    || typeof value.enabled !== "boolean") return fail("invalid_revision");
  return value;
}

const SOURCE_SQL = `begin read only; set local role service_role;
select public.faolla_read_order_attention_v1('10000000',true); commit;`;
const STATE_SQL = `begin read only;
select jsonb_build_object('epoch',epoch::text,'generation',generation::text,'enabled',enabled,'payload',payload)
from public.faolla_order_attention_pilot where merchant_id='10000000' and schema_version=1; commit;`;

/** Fixed-merchant, bounded reconciliation. SQL/source contents never leave this process in reports. */
export async function reconcileOrderAttentionPilot(query: Query) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const raw = await query(SOURCE_SQL);
    const source = revision(raw) as Source;
    if (source.state !== "source" || !Array.isArray(source.rows)) return fail("source_unavailable");
    const projection = buildMerchantOrderAttentionProjection(source.rows, SITE);
    if (!projection.supported) return fail(`source_${projection.reason}`);
    const summaryHash = digest(projection.attention);
    const sourceHash = digest(source.rows);
    let state = revision(await query(STATE_SQL));
    if (!sameRevision(source, state) || source.enabled !== state.enabled) continue;
    if (state.payload === null) {
      const result = await query(`begin; set local role service_role;
select public.faolla_publish_order_attention_v1('10000000',${literal(source.epoch)}::uuid,
${literal(source.generation)},${literal(JSON.stringify(projection.attention))}::jsonb); commit;`) as { state?: string } | null;
      if (result?.state !== "published") continue;
    } else {
      const existing = parseMerchantOrderAttentionSummary(state.payload, SITE);
      if (!existing || digest(existing) !== summaryHash) return fail("reconciliation_mismatch");
    }
    // Independent second snapshot: a source mutation or late backfill cannot
    // pass just because a count happened to remain the same.
    const second = revision(await query(SOURCE_SQL)) as Source;
    if (second.state !== "source" || !Array.isArray(second.rows)) return fail("source_unavailable");
    if (!sameRevision(source, second) || second.enabled !== source.enabled) continue;
    if (digest(second.rows) !== sourceHash) return fail("capture_continuity_failed");
    state = revision(await query(STATE_SQL));
    if (!sameRevision(source, state) || state.enabled !== source.enabled) continue;
    const stored = parseMerchantOrderAttentionSummary(state.payload, SITE);
    if (!stored || digest(stored) !== summaryHash) return fail("reconciliation_mismatch");
    return { verified: true as const, siteId: SITE, epoch: state.epoch, generation: state.generation,
      enabled: state.enabled, sourceRows: source.rows.length,
      sourceBytes: Buffer.byteLength(JSON.stringify(source.rows)), attentionCount: stored.count,
      sourceSha256: sourceHash, summarySha256: summaryHash };
  }
  return fail("reconciliation_conflict");
}

function resetSql(enabled: boolean, expected?: Revision) {
  // Standalone transaction: never retain the summary lock while reading pages.
  return `begin;
update public.faolla_order_attention_pilot set enabled=${enabled ? "true" : "false"},
epoch=pg_catalog.gen_random_uuid(),generation=generation+1,payload=null,projected_at=null
where merchant_id='10000000' and schema_version=1${expected
    ? ` and epoch=${literal(expected.epoch)}::uuid and generation=${literal(expected.generation)}::bigint` : ""}
returning jsonb_build_object('epoch',epoch::text,'generation',generation::text,'enabled',enabled); commit;`;
}

export async function runOrderAttentionPilot(action: PilotAction, query: Query) {
  // Fixed approved identity, never auto-detect or enroll a different merchant.
  const identity = await query(`begin read only;
select jsonb_build_object('matches',count(*)=1) from public.merchants where id='10000000' and name='fafona'; commit;`) as { matches?: boolean } | null;
  if (identity?.matches !== true) return fail("merchant_identity_changed");
  if (action === "disable") {
    const state = revision(await query(resetSql(false)));
    if (state.enabled) return fail("disable_failed");
    return { action, verified: true, siteId: SITE, ...state };
  }
  const before = await reconcileOrderAttentionPilot(query);
  if (action === "prepare") return { action, ...before };
  if (action === "verify") {
    if (!before.enabled) return fail("pilot_disabled");
    return { action, ...before };
  }
  if (before.enabled) return { action, ...before };
  const owned = revision(await query(resetSql(true, before)));
  if (!owned.enabled) return fail("enable_failed");
  try {
    const after = await reconcileOrderAttentionPilot(query);
    if (!after.enabled || after.epoch !== owned.epoch) return fail("enable_ownership_changed");
    return { action, ...after };
  } catch (error) {
    // Only disable the epoch this invocation enabled. Do not overwrite a later
    // operator's enable/reset, and never roll back source business data.
    await query(`begin; update public.faolla_order_attention_pilot
set enabled=false,epoch=pg_catalog.gen_random_uuid(),generation=generation+1,payload=null,projected_at=null
where merchant_id='10000000' and epoch=${literal(owned.epoch)}::uuid
returning jsonb_build_object('disabled',true); commit;`).catch(() => undefined);
    throw error;
  }
}

export function validateOrderAttentionOperation(input: { platform: string; uid: number | undefined; target: string; cwd: string; args: string[] }) {
  if (input.platform !== "linux" || input.uid !== 0 || !/^[a-f0-9]{40}$/.test(input.target)
    || input.cwd !== `/www/wwwroot/merchant-space.web-releases/${input.target.slice(0, 12)}-online`
    || input.args.length !== 1 || !["prepare", "enable", "verify", "disable"].includes(input.args[0])) {
    return fail("operation_not_owned");
  }
  return input.args[0] as PilotAction;
}

async function main() {
  const cwd = process.cwd();
  const target = process.env.FAOLLA_ORDER_ATTENTION_OPERATION_TARGET ?? "";
  const action = validateOrderAttentionOperation({ platform: process.platform, uid: process.getuid?.(), target, cwd, args: process.argv.slice(2) });
  const stat = lstatSync(cwd);
  if (realpathSync(cwd) !== cwd || stat.isSymbolicLink() || stat.uid !== 0 || (stat.mode & 0o022)) return fail("unsafe_candidate_directory");
  const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8", timeout: 5000 });
  if (head.status !== 0 || head.stdout.trim() !== target) return fail("candidate_identity_changed");
  const inspect = spawnSync("docker", ["inspect", "--format", "{{json .}}", "supabase-db"], { encoding: "utf8", timeout: 5000 });
  if (inspect.status !== 0) return fail("database_identity_unavailable");
  const container = JSON.parse(inspect.stdout);
  if (container.Name !== "/supabase-db" || container.Config?.Image !== "supabase/postgres:15.8.1.085"
    || container.State?.Running !== true || !/^[a-f0-9]{64}$/.test(container.Id)) return fail("database_identity_changed");
  const psql = `set -eu
test "$POSTGRES_DB" = postgres
unset PGHOST PGHOSTADDR PGPORT PGDATABASE PGUSER PGSERVICE PGSERVICEFILE PGPASSFILE PGOPTIONS PGPASSWORD
export PGPASSWORD="$POSTGRES_PASSWORD"
export PGCONNECT_TIMEOUT=3
export PGPASSFILE=/dev/null
export PGSSLMODE=disable
export PGOPTIONS='-c statement_timeout=5s -c lock_timeout=1s'
exec psql --host=127.0.0.1 --port=5432 --username=supabase_admin --dbname=postgres --no-password --no-psqlrc --set=ON_ERROR_STOP=1 --set=VERBOSITY=sqlstate --quiet --tuples-only --no-align`;
  const deadline = Date.now() + 60000;
  const query: Query = async (sql) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return fail("operation_deadline");
    const result = spawnSync("docker", ["exec", "-i", container.Id, "sh", "-c", psql], {
      input: sql, encoding: "utf8", timeout: Math.min(10000, remaining), maxBuffer: 10 * 1024 * 1024,
    });
    if (result.status !== 0 || result.error || result.signal) return fail("database_query_failed");
    const lines = result.stdout.trim().split(/\r?\n/).filter(Boolean);
    if (lines.length !== 1 || !lines[0].startsWith("{")) return fail("database_result_invalid");
    try { return JSON.parse(lines[0]); } catch { return fail("database_result_invalid"); }
  };
  const proof = await runOrderAttentionPilot(action, query);
  if ((action === "enable" || action === "verify") && "summarySha256" in proof) {
    // Verify the real configured PostgREST/service-role transport too, not only
    // direct SQL. This also exercises the application's actual payload parser.
    const signal = AbortSignal.timeout(6000);
    const client = createServerSupabaseServiceClient({ fetch: (input, init) => fetch(input, { ...init, signal }) });
    if (!client) return fail("service_transport_unavailable");
    const attention = await readMerchantOrderAttentionSummary(client, SITE, signal);
    if (!attention || digest(attention) !== proof.summarySha256) return fail("service_transport_mismatch");
  }
  console.log(JSON.stringify(proof));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    const code = error instanceof Error && /^order_attention_[a-z_]+$/.test(error.message)
      ? error.message : "order_attention_operation_failed";
    console.error(JSON.stringify({ verified: false, code }));
    process.exitCode = 1;
  });
}
