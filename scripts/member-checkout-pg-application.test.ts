import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { createPgRuntimeCore, queryText, type PgClient } from "./fixtures/merchant-checkout-pg-core";
import { pgRuntimeConfiguration, createServerMerchantCheckoutRuntimeClient } from "./fixtures/merchant-checkout-pg-entry";
import { isMemberCheckoutIntentPilotEnabled } from "../src/lib/merchantCheckoutCartPilot.server";
const name = "faolla_member_checkout_catalog_snapshot_v1", args = { p_site_id: "10909994" };
const env = () => ({ FAOLLA_CHECKOUT_TRANSPORT: "postgres", FAOLLA_CHECKOUT_PG_HOST: "127.0.0.1", FAOLLA_CHECKOUT_PG_PORT: "56463", FAOLLA_CHECKOUT_PG_DATABASE: "faolla_member_checkout_auth_test",
  FAOLLA_CHECKOUT_PG_USER: "faolla_checkout_runtime_login", FAOLLA_CHECKOUT_PG_PASSWORD: "synthetic-local-only-password-32-chars", FAOLLA_CHECKOUT_PG_TLS: "disabled-loopback" });

test("owned application fixture supplies every original nested pilot gate without enabling another site", async () => {
  const { ownedPgApplicationPilotEnvironment } = await import("./member-checkout-pg-application-candidate.mjs");
  const site = "10909994", pilots = ownedPgApplicationPilotEnvironment(site);
  assert.equal(isMemberCheckoutIntentPilotEnabled(site, pilots), true);
  assert.equal(isMemberCheckoutIntentPilotEnabled("10909995", pilots), false);
  for (const key of Object.keys(pilots)) {
    const incomplete = { ...pilots }; delete incomplete[key];
    assert.equal(isMemberCheckoutIntentPilotEnabled(site, incomplete), false);
  }
  assert.throws(() => ownedPgApplicationPilotEnvironment(""));
  assert.equal(Object.keys(pilots).some(key => /ON_SITE|STRIPE/.test(key)), false);
});
test("direct PG candidate requires explicit private identity and never inherits broad credential aliases", () => {
  assert.ok(pgRuntimeConfiguration(env(), 12000));
  for (const patch of [{ FAOLLA_CHECKOUT_PG_HOST: "8.8.8.8" }, { FAOLLA_CHECKOUT_PG_HOST: "db.example.invalid" }, { FAOLLA_CHECKOUT_PG_HOST: "127.0.0.1/path" }, { FAOLLA_CHECKOUT_PG_USER: "service_role" },
    { FAOLLA_CHECKOUT_PG_PORT: "0" }, { FAOLLA_CHECKOUT_PG_PORT: "65536" }, { FAOLLA_CHECKOUT_PG_DATABASE: "postgres;select 1" }, { FAOLLA_CHECKOUT_PG_PASSWORD: "" }, { FAOLLA_CHECKOUT_PG_TLS: "require" },
    { FAOLLA_CHECKOUT_PG_TLS: "disabled-loopback", FAOLLA_CHECKOUT_PG_HOST: "10.0.0.5" }, { FAOLLA_CHECKOUT_PG_TLS: "verify-full", FAOLLA_CHECKOUT_PG_CA_PEM: "invalid" }])
    assert.equal(pgRuntimeConfiguration({ ...env(), ...patch }, 12000), null);
  assert.equal(createServerMerchantCheckoutRuntimeClient({ environment: { FAOLLA_CHECKOUT_TRANSPORT: "postgres", PGHOST: "127.0.0.1", PGPASSWORD: "ignored", SUPABASE_SERVICE_ROLE_KEY: "ignored" } }), null);
  assert.equal(createServerMerchantCheckoutRuntimeClient({ environment: { ...env(), FAOLLA_CHECKOUT_TRANSPORT: "unknown" } }), null);
  assert.equal(pgRuntimeConfiguration(env(), 12001), null);
});
function fixture(overrides: Partial<PgClient> = {}, timeoutMs = 1000) {
  const counts = { connect: 0, query: 0, end: 0 }, queries: unknown[] = [], gate = { active: 0 }; let current = true;
  const client: PgClient = { connect: async () => { counts.connect++; }, query: async q => { counts.query++; queries.push(q); return { rows: [{ result: { ok: true } }] }; },
    end: async () => { counts.end++; }, on: () => {}, ...overrides };
  return { counts, queries, gate, invalidate: () => { current = false; }, client, core: createPgRuntimeCore({ clientFactory: () => client, current: () => current, gate, timeoutMs }) };
}
test("typed candidate uses immutable parameters and exactly one query across repeated awaits", async () => {
  const f = fixture(), input = { ...args }, call = f.core.rpc(name, input); input.p_site_id = "changed";
  assert.deepEqual(await call, { data: { ok: true }, error: null }); await call;
  assert.deepEqual(f.counts, { connect: 1, query: 1, end: 1 }); assert.equal(f.gate.active, 0);
  assert.deepEqual(f.queries, [{ text: queryText, values: [name, JSON.stringify(args)], queryMode: "extended" }]);
});
test("invalid method, malformed JSON and getters never open a connection", () => {
  const f = fixture(); let getter = 0;
  assert.throws(() => f.core.rpc("toString", args)); assert.throws(() => f.core.rpc(name, {}));
  assert.throws(() => f.core.rpc(name, { get p_site_id() { getter++; return "x"; } })); assert.throws(() => f.core.rpc(name, { p_site_id: undefined }));
  assert.equal(getter, 0); assert.equal(f.counts.connect, 0);
});
test("pre-cancelled calls and removed configuration cannot connect", async () => {
  const f = fixture(); await f.core.rpc(name, args).abortSignal(AbortSignal.abort()); f.invalidate(); await f.core.rpc(name, args);
  assert.equal(f.counts.connect, 0); assert.equal(f.gate.active, 0);
});
test("configuration revocation during a pending connect prevents a late financial query", async () => {
  let ready!: () => void; const f = fixture({ connect: () => new Promise<void>(resolve => { ready = resolve; }) });
  const response = Promise.resolve(f.core.rpc(name, args)); await delay(0); f.invalidate(); ready(); assert.equal((await response).error?.message, "checkout_runtime_unavailable");
  assert.equal(f.counts.query, 0); assert.equal(f.counts.end, 1); assert.equal(f.gate.active, 0);
});
test("query deadline discards connection and ignores late results without retry", async () => {
  let finish!: (value: { rows: Record<string, unknown>[] }) => void, count = 0;
  const f = fixture({ query: () => { count++; return new Promise(resolve => { finish = resolve; }); } }, 15), call = f.core.rpc(name, args);
  assert.equal((await call).error?.message, "checkout_runtime_unavailable"); finish({ rows: [{ result: { late: true } }] }); await call;
  assert.equal(count, 1); assert.equal(f.counts.end, 1); assert.equal(f.gate.active, 0);
});
test("separate factory instances share one supplied process admission limit", async () => {
  const gate = { active: 4 }; let opened = 0;
  const core = createPgRuntimeCore({ gate, current: () => true, timeoutMs: 10, clientFactory: () => { opened++; throw Error("must not open"); } });
  assert.equal((await core.rpc(name, args)).error?.message, "checkout_runtime_unavailable"); assert.equal(opened, 0);
});
test("only close acknowledgement recycles admission, including genuinely late close", async () => {
  let closed!: () => void; const f = fixture({ end: () => new Promise<void>(resolve => { closed = resolve; }) });
  await f.core.rpc(name, args); assert.equal(f.gate.active, 1); closed(); await delay(0); assert.equal(f.gate.active, 0);
  const failed = fixture({ end: async () => { throw Error("synthetic failure"); } }); await failed.core.rpc(name, args); assert.equal(failed.gate.active, 1);
});
test("database details remain private while approved business errors retain their meaning", async () => {
  for (const [code, message, expected] of [["P0001", "checkout_conflict", "checkout_conflict"], ["28P01", "synthetic-secret", "checkout_runtime_unavailable"], ["P0001", "unexpected SQL", "checkout_runtime_unavailable"]]) {
    const f = fixture({ query: async () => { throw Object.assign(Error(message), { code }); } }); assert.equal((await f.core.rpc(name, args)).error?.message, expected);
  }
});
