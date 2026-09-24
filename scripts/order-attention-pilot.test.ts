import assert from "node:assert/strict";
import test from "node:test";
import { chmodSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runOrderAttentionPilot, reconcileOrderAttentionPilot, validateOrderAttentionOperation } from "./order-attention-pilot";

function fixture(options: { enabled?: boolean; race?: boolean; mismatch?: boolean; failEnabledSource?: boolean } = {}) {
  let epoch = "11111111-1111-4111-8111-111111111111";
  let generation = "9007199254740993";
  let enabled = options.enabled ?? false;
  let payload: unknown = options.mismatch ? { count: 1, latest: null } : null;
  let epochCounter = 1;
  const calls: string[] = [];
  const query = async (sql: string): Promise<unknown> => {
    calls.push(sql);
    if (sql.includes("'matches',count(*)=1")) return { matches: true };
    if (sql.includes("faolla_read_order_attention_v1")) {
      if (options.race) generation = String(BigInt(generation) + BigInt(1));
      return { state: "source", epoch, generation, enabled,
        rows: options.failEnabledSource && enabled ? null : [] };
    }
    if (sql.includes("set enabled=")) {
      enabled = sql.includes("set enabled=true");
      epochCounter += 1;
      epoch = `${String(epochCounter).repeat(8)}-1111-4111-8111-111111111111`;
      generation = String(BigInt(generation) + BigInt(1)); payload = null;
      return sql.includes("'disabled',true") ? { disabled: true } : { epoch, generation, enabled };
    }
    if (sql.includes("faolla_publish_order_attention_v1")) {
      payload = { count: 0, latest: null };
      return { state: "published", epoch, generation };
    }
    if (sql.includes("'payload',payload")) return { epoch, generation, enabled, payload };
    throw new Error("unexpected fixture SQL");
  };
  return { query, calls, state: () => ({ epoch, generation, enabled, payload }) };
}

test("prepare populates only a disabled derived summary and compares independent source snapshots", async () => {
  const f = fixture();
  const result = await runOrderAttentionPilot("prepare", f.query);
  assert.equal(result.verified, true); assert.equal(result.enabled, false);
  assert.equal(f.state().enabled, false);
  assert.equal(f.calls.filter((sql) => sql.includes("faolla_read_order_attention_v1")).length, 2);
  assert.equal(f.calls.some((sql) => /(?:update|insert into|delete from)\s+public\.pages\b/i.test(sql)), false);
  assert.equal(JSON.stringify(result).includes('"payload"'), false);
  assert.equal(JSON.stringify(result).includes('"rows"'), false);
});

test("enable resets epoch before backfilling and requires enabled reconciliation", async () => {
  const f = fixture();
  const result = await runOrderAttentionPilot("enable", f.query);
  assert.equal(result.enabled, true); assert.equal(result.verified, true);
  assert.equal(f.calls.filter((sql) => sql.includes("set enabled=true")).length, 1);
  assert.equal(f.calls.filter((sql) => sql.includes("faolla_publish_order_attention_v1")).length, 2);
  assert.equal(f.state().generation, "9007199254740994");
  const reset = f.calls.find((sql) => sql.includes("set enabled=true"))!;
  assert.match(reset, /and epoch='11111111-1111-4111-8111-111111111111'::uuid and generation='9007199254740993'::bigint/);
  assert.doesNotMatch(reset, /public\.pages/);
});

test("verify refuses disabled pilot; repeated enabled invocation does not reset the epoch", async () => {
  await assert.rejects(runOrderAttentionPilot("verify", fixture().query), /pilot_disabled/);
  const f = fixture({ enabled: true });
  const first = await runOrderAttentionPilot("enable", f.query);
  const second = await runOrderAttentionPilot("verify", f.query);
  assert.equal(first.epoch, second.epoch);
  assert.equal(f.calls.some((sql) => sql.includes("set enabled=")), false);
});

test("late source changes are bounded to three attempts and do not report success", async () => {
  const f = fixture({ race: true });
  await assert.rejects(reconcileOrderAttentionPilot(f.query), /reconciliation_conflict/);
  assert.equal(f.calls.filter((sql) => sql.includes("faolla_read_order_attention_v1")).length, 6);
});

test("mismatched stored result stops rather than overwriting evidence", async () => {
  const f = fixture({ mismatch: true });
  await assert.rejects(runOrderAttentionPilot("prepare", f.query), /reconciliation_mismatch/);
  assert.equal(f.calls.some((sql) => sql.includes("faolla_publish_order_attention_v1")), false);
});

test("enable failure disables only the epoch owned by that attempt", async () => {
  const f = fixture({ failEnabledSource: true });
  await assert.rejects(runOrderAttentionPilot("enable", f.query), /source_unavailable/);
  assert.equal(f.state().enabled, false);
  const reset = f.calls.find((sql) => sql.includes("'disabled',true"))!;
  assert.match(reset, /where merchant_id='10000000' and epoch='22222222-1111-4111-8111-111111111111'::uuid/);
  assert.doesNotMatch(reset, /public\.pages/);
});

test("disable changes only derived control, and identity mismatch prevents every mutation", async () => {
  const f = fixture({ enabled: true });
  assert.equal((await runOrderAttentionPilot("disable", f.query)).enabled, false);
  const calls: string[] = [];
  await assert.rejects(runOrderAttentionPilot("enable", async (sql) => { calls.push(sql); return { matches: false }; }), /merchant_identity_changed/);
  assert.equal(calls.length, 1);
  assert.doesNotMatch(calls[0], /update|insert|delete/i);
});

test("production operation requires exact root-owned candidate identity and one fixed action", () => {
  const target = "a".repeat(40);
  const input = { platform: "linux", uid: 0, target,
    cwd: `/www/wwwroot/merchant-space.web-releases/${target.slice(0, 12)}-online`, args: ["enable"] };
  assert.equal(validateOrderAttentionOperation(input), "enable");
  for (const change of [{ platform: "win32" }, { uid: 1000 }, { uid: undefined }, { target: "main" },
    { cwd: "/www/wwwroot/merchant-space" }, { args: [] }, { args: ["enable", "20000000"] }, { args: ["repair"] }]) {
    assert.throws(() => validateOrderAttentionOperation({ ...input, ...change }), /operation_not_owned/);
  }
  const source = readFileSync(new URL("./order-attention-pilot.ts", import.meta.url), "utf8");
  assert.match(source, /supabase\/postgres:15\.8\.1\.085/);
  assert.match(source, /PGOPTIONS='-c statement_timeout=5s -c lock_timeout=1s -c standard_conforming_strings=on'/);
  assert.match(source, /head\.stdout\.trim\(\) !== target/);
  assert.match(source, /test "\$POSTGRES_DB" = postgres/);
  assert.match(source, /unset PGHOST PGHOSTADDR PGPORT PGDATABASE PGUSER PGSERVICE PGSERVICEFILE PGPASSFILE PGOPTIONS PGPASSWORD/);
  assert.match(source, /--host=127\.0\.0\.1 --port=5432 --username=supabase_admin --dbname=postgres/);
  assert.doesNotMatch(source, /console\.(?:log|error)\([^\n]*(?:stdout|stderr|payload|rows|sql)/);
  const main = source.slice(source.indexOf("async function main()"));
  assert.ok(main.indexOf("candidate_identity_changed") < main.indexOf("loadOrderAttentionOperationEnvironment(cwd)"));
  assert.ok(main.indexOf("loadOrderAttentionOperationEnvironment(cwd)") < main.indexOf("!createServerSupabaseServiceClient()"));
  assert.ok(main.indexOf("!createServerSupabaseServiceClient()") < main.indexOf("await runOrderAttentionPilot(action, query)"));
});

function environmentFixture(options: { override?: boolean; unsafe?: "symlink" | "permissions"; missing?: boolean } = {}) {
  const directory = mkdtempSync(path.join(tmpdir(), "faolla-order-attention-env-"));
  const localKey = "synthetic-file-key-never-log";
  const processKey = "synthetic-process-key-never-log";
  try {
    const envFile = path.join(directory, ".env.local");
    const contents = `SUPABASE_INTERNAL_URL=https://order-attention-fixture.invalid\nSUPABASE_SERVICE_ROLE_KEY=${localKey}\n`;
    if (options.unsafe === "symlink") {
      const target = path.join(directory, "fixture-config");
      writeFileSync(target, contents, { mode: 0o600 });
      symlinkSync(target, envFile);
    } else if (!options.missing) {
      writeFileSync(envFile, contents, { mode: 0o600 });
      if (options.unsafe === "permissions") chmodSync(envFile, 0o644);
    }
    // Do not inherit real app credentials, NODE_OPTIONS or dotenv state. Retain
    // only OS executable/temp paths required to start Node and the TS loader.
    const env: NodeJS.ProcessEnv = { NODE_ENV: "production" };
    for (const key of ["PATH", "Path", "SystemRoot", "WINDIR", "COMSPEC", "TEMP", "TMP", "TMPDIR"]) {
      if (process.env[key] !== undefined) env[key] = process.env[key];
    }
    if (options.override) env.SUPABASE_SERVICE_ROLE_KEY = processKey;
    const expectedError = options.unsafe ? "order_attention_unsafe_environment_file"
      : options.missing ? "order_attention_environment_file_unavailable" : null;
    const code = `
      const assert = require('node:assert/strict');
      const { loadOrderAttentionOperationEnvironment } = require(${JSON.stringify(fileURLToPath(new URL("./order-attention-pilot.ts", import.meta.url)))});
      const { createServerSupabaseServiceClient } = require(${JSON.stringify(fileURLToPath(new URL("../src/lib/superAdminServer.ts", import.meta.url)))});
      const { readMerchantOrderAttentionSummary } = require(${JSON.stringify(fileURLToPath(new URL("../src/lib/merchantOrderAttention.server.ts", import.meta.url)))});
      (async () => {
        globalThis.fetch = async () => { throw new Error('real network is forbidden'); };
        assert(!process.env.SUPABASE_INTERNAL_URL, 'no inherited application URL');
        assert(process.env.SUPABASE_SERVICE_ROLE_KEY === ${JSON.stringify(options.override ? processKey : undefined)}, 'no inherited application key');
        if (${JSON.stringify(expectedError)}) {
          let error;
          try { loadOrderAttentionOperationEnvironment(${JSON.stringify(directory)}); } catch (caught) { error = caught; }
          assert(error && error.message === ${JSON.stringify(expectedError)}, 'unsafe or missing fixture must fail closed');
          console.log(JSON.stringify({ rejected: true }));
          return;
        }
        loadOrderAttentionOperationEnvironment(${JSON.stringify(directory)});
        let calls = 0;
        const client = createServerSupabaseServiceClient({ fetch: async (input, init) => {
          calls++;
          const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
          assert(url === 'https://order-attention-fixture.invalid/rest/v1/rpc/faolla_read_order_attention_v1', 'configured fixture URL must be used');
          const headers = new Headers(init.headers);
          assert(headers.get('apikey') === ${JSON.stringify(options.override ? processKey : localKey)}, 'correct credential precedence');
          assert(headers.get('authorization') === 'Bearer ' + ${JSON.stringify(options.override ? processKey : localKey)}, 'configured service authentication');
          assert(JSON.parse(init.body).p_site_id === '10000000', 'fixed pilot identity');
          return new Response(JSON.stringify({ state: 'ready', epoch: '11111111-1111-4111-8111-111111111111', generation: '1', payload: { count: 0, latest: null } }), { headers: { 'content-type': 'application/json' } });
        } });
        assert(client, 'service client must be available from fixture configuration');
        const attention = await readMerchantOrderAttentionSummary(client, '10000000');
        assert(attention && attention.count === 0 && attention.latest === null && calls === 1, 'real client must use mock transport once');
        console.log(JSON.stringify({ configured: true, transport: true }));
      })().catch(() => { console.error('synthetic_environment_test_failed'); process.exitCode = 1; });
    `;
    const result = spawnSync(process.execPath, ["--import", "tsx", "--input-type=commonjs", "-e", code], {
      cwd: fileURLToPath(new URL("..", import.meta.url)), env, encoding: "utf8", timeout: 20000,
    });
    assert.equal(result.stdout.includes(localKey) || result.stderr.includes(localKey)
      || result.stdout.includes(processKey) || result.stderr.includes(processKey), false, "no configuration secrets in output");
    assert.equal(result.status, 0, "synthetic configuration subprocess succeeds without real services");
    assert.equal(result.stderr, "", "loader and client remain silent");
    assert.deepEqual(JSON.parse(result.stdout), expectedError ? { rejected: true } : { configured: true, transport: true });
  } finally {
    const resolved = path.resolve(directory);
    assert.equal(path.dirname(resolved), path.resolve(tmpdir()));
    assert.ok(path.basename(resolved).startsWith("faolla-order-attention-env-"));
    rmSync(resolved, { recursive: true, force: true });
  }
}

test("standalone CLI loads only synthetic .env.local and the real service client uses mocked fetch", () => {
  environmentFixture();
});

test("candidate env loading preserves process environment precedence without exposing secrets", () => {
  environmentFixture({ override: true });
});

test("candidate env loader fails closed if the expected .env.local is missing", () => {
  environmentFixture({ missing: true });
});

test("candidate env loader rejects linked or non-private configuration", { skip: process.platform === "win32" }, () => {
  environmentFixture({ unsafe: "symlink" });
  environmentFixture({ unsafe: "permissions" });
});
