import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
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
});
