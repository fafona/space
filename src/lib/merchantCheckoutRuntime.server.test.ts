import assert from "node:assert/strict";
import test from "node:test";
import http from "node:http";
import { createServerMerchantCheckoutRuntimeClient as create } from "./merchantCheckoutRuntime.server";

const at = 1_790_000_000_000, name = "faolla_member_checkout_catalog_snapshot_v1", args = { p_site_id: "10909992" };
const jwt = (role = "faolla_checkout_runtime", fields: Record<string, unknown> = {}, alg = "HS256") => [
  { alg, typ: "JWT" }, { role, exp: at / 1000 + 3600, ...fields },
].map(v => Buffer.from(JSON.stringify(v)).toString("base64url")).join(".") + ".c3ludGhldGljLXNpZ25hdHVyZQ";
const env = () => ({ SUPABASE_INTERNAL_URL: "https://runtime.synthetic.invalid", NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt("anon"), FAOLLA_CHECKOUT_RUNTIME_JWT: jwt() });
const unavailable = { data: null, error: { message: "checkout_runtime_unavailable" } };

test("runtime configuration is separate and never falls back to service credentials or a public runtime alias", () => {
  for (const environment of [{}, { ...env(), FAOLLA_CHECKOUT_RUNTIME_JWT: "", SUPABASE_SERVICE_ROLE_KEY: jwt("service_role"), NEXT_PUBLIC_FAOLLA_CHECKOUT_RUNTIME_JWT: jwt() },
    { ...env(), FAOLLA_CHECKOUT_RUNTIME_JWT: jwt("service_role") }, { ...env(), NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt("service_role") },
    { ...env(), NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_secret_synthetic-not-allowed" }]) assert.equal(create({ environment, now: () => at }), null);
});
test("wrong-role, expired, not-yet-active, unsigned and malformed credentials fail before IO", () => {
  for (const token of [jwt("authenticated"), jwt("faolla_checkout_runtime", { exp: at / 1000 }), jwt("faolla_checkout_runtime", { exp: at / 1000 + 5 }),
    jwt("faolla_checkout_runtime", { nbf: at / 1000 + 100 }), jwt("faolla_checkout_runtime", {}, "none"), "broken", jwt() + "\r\ninjected"]) {
    assert.equal(create({ environment: { ...env(), FAOLLA_CHECKOUT_RUNTIME_JWT: token }, now: () => at }), null);
  }
  assert.ok(create({ environment: { ...env(), NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_publishable_synthetic123456" }, now: () => at }));
});
test("only a configured HTTPS origin or literal loopback HTTP root is accepted", () => {
  for (const url of ["http://runtime.synthetic.invalid", "https://user:pass@runtime.synthetic.invalid", "https://runtime.synthetic.invalid/other", "https://runtime.synthetic.invalid/?token=x", "https://runtime.synthetic.invalid/#fragment", "file:///tmp/x"]) {
    assert.equal(create({ environment: { ...env(), SUPABASE_INTERNAL_URL: url }, now: () => at }), null);
  }
  for (const url of ["http://127.0.0.1:8000", "http://[::1]:8000", "http://localhost:8000"]) assert.ok(create({ environment: { ...env(), SUPABASE_INTERNAL_URL: url }, now: () => at }));
});
test("calls are lazy, snapshot arguments, send only the fixed POST capability and dispatch once", async () => {
  const sent: { input: RequestInfo | URL; init?: RequestInit }[] = [], environment = env();
  const client = create({ environment, now: () => at, fetch: async (input, init) => { sent.push({ input, init }); return Response.json({ version: null, offers: [] }); } })!;
  const original = { ...args }, call = client.rpc(name, original); original.p_site_id = "59999999";
  assert.equal(sent.length, 0);
  const [a, b] = await Promise.all([Promise.resolve(call), Promise.resolve(call)]); assert.deepEqual(a, b); assert.equal(sent.length, 1);
  const { input, init } = sent[0]; assert.equal(input, "https://runtime.synthetic.invalid/rest/v1/rpc/faolla_checkout_runtime_v1");
  assert.equal(init!.method, "POST"); assert.equal(init!.cache, "no-store"); assert.equal(init!.credentials, "omit"); assert.equal(init!.redirect, "error");
  const headers = new Headers(init!.headers); assert.equal(headers.get("authorization"), "Bearer " + environment.FAOLLA_CHECKOUT_RUNTIME_JWT);
  assert.equal(headers.get("apikey"), environment.NEXT_PUBLIC_SUPABASE_ANON_KEY); assert.equal(headers.get("cookie"), null);
  assert.deepEqual(JSON.parse(String(init!.body)), { p_function: name, p_arguments: args });
  assert.equal("from" in client, false); assert.equal("auth" in client, false); assert.equal(JSON.stringify(client), "{}");
});
test("unknown/prototype methods, missing/extra arguments and non-JSON plans cannot dispatch", () => {
  let sent = 0; const client = create({ environment: env(), now: () => at, fetch: async () => { sent++; return Response.json(null); } })!;
  for (const method of ["toString", "__proto__", "faolla_commit_redemption_v1", name + ";select 1"]) assert.throws(() => client.rpc(method, {}), /^Error: checkout_runtime_unavailable$/);
  for (const input of [{}, { ...args, extra: true }, { p_site_id: undefined }, { p_site_id: NaN }, { p_site_id: new Date() }, { p_site_id: BigInt(1) }, { p_site_id: new Array(2) }])
    assert.throws(() => client.rpc(name, input), /^Error: checkout_runtime_unavailable$/);
  const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic; assert.throws(() => client.rpc(name, { p_site_id: cyclic }), /checkout_runtime_unavailable/);
  let getter = 0; const input = Object.defineProperty({}, "p_site_id", { get() { getter++; return "10909992"; }, enumerable: true });
  assert.throws(() => client.rpc(name, input), /checkout_runtime_unavailable/); assert.equal(getter, 0); assert.equal(sent, 0);
});
test("credential removal or expiry after client creation prevents a queued call", async () => {
  for (const mode of ["remove", "expire"]) {
    let sent = 0, time = at; const environment = env(), client = create({ environment, now: () => time, fetch: async () => { sent++; return Response.json(null); } })!;
    const call = client.rpc(name, args); if (mode === "remove") environment.FAOLLA_CHECKOUT_RUNTIME_JWT = ""; else time += 3_600_000;
    assert.deepEqual(await call, unavailable); assert.deepEqual(await call, unavailable); assert.equal(sent, 0);
  }
});
test("pre-aborted calls never send; one ambiguous network failure is never retried", async () => {
  let sent = 0; const client = create({ environment: env(), now: () => at, fetch: async () => { sent++; throw Error("PRIVATE_CREDENTIAL_OR_SQL"); } })!;
  const pre = new AbortController(); pre.abort(); assert.deepEqual(await client.rpc(name, args).abortSignal(pre.signal), unavailable); assert.equal(sent, 0);
  const call = client.rpc(name, args); assert.deepEqual(await call, unavailable); assert.deepEqual(await call, unavailable); assert.equal(sent, 1);
});
test("timeout wins even if a transport ignores AbortSignal; late response cannot send again", async () => {
  let sent = 0, signal: AbortSignal | undefined, finish!: (response: Response) => void;
  const client = create({ environment: env(), now: () => at, timeoutMs: 25, fetch: async (_, init) => { sent++; signal = init!.signal as AbortSignal; return new Promise(resolve => { finish = resolve; }); } })!;
  const call = client.rpc(name, args); assert.deepEqual(await call, unavailable); assert.equal(signal!.aborted, true);
  finish(Response.json({ late: true })); assert.deepEqual(await call, unavailable); assert.equal(sent, 1);
});
test("only fixed SQL business error codes are returned, never gateway details or credentials", async () => {
  for (const [status, body, expected] of [[400, { code: "P0001", message: "checkout_conflict", details: "PRIVATE_SQL" }, "checkout_conflict"],
    [400, { code: "P0001", message: "order_update_conflict" }, "order_update_conflict"], [401, { code: "PGRST301", message: jwt() }, "checkout_runtime_unavailable"],
    [503, { code: "P0001", message: "SECRET exception full SQL" }, "checkout_runtime_unavailable"]] as const) {
    const client = create({ environment: env(), now: () => at, fetch: async () => Response.json(body, { status }) })!;
    assert.deepEqual(await client.rpc(name, args), { data: null, error: { message: expected } });
  }
});
test("malformed, redirected, non-JSON and oversized replies fail closed", async () => {
  const replies = [new Response("not json", { headers: { "content-type": "application/json" } }), new Response("{}"),
    new Response(new Uint8Array([255]), { headers: { "content-type": "application/json" } }),
    new Response("{}", { headers: { "content-type": "application/json", "content-length": "33554433" } }), new Response(null, { status: 204 })];
  const redirected = Response.json({}); Object.defineProperty(redirected, "redirected", { value: true }); replies.push(redirected);
  for (const response of replies) { const client = create({ environment: env(), now: () => at, fetch: async () => response })!; assert.deepEqual(await client.rpc(name, args), unavailable); }
});
test("a stalled response stream is bounded and cancelled", async () => {
  let cancelled = false; const stream = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode('{"partial":')); }, cancel() { cancelled = true; } });
  const client = create({ environment: env(), now: () => at, timeoutMs: 25, fetch: async () => new Response(stream, { headers: { "content-type": "application/json" } }) })!;
  assert.deepEqual(await client.rpc(name, args), unavailable); assert.equal(cancelled, true);
});

test("native HTTP transport does not follow a redirect or forward runtime authorization to another path", async () => {
  const paths: string[] = [];
  const server = http.createServer((request, response) => {
    paths.push(request.url!); response.writeHead(302, { location: "/unexpected-target" }); response.end();
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address(); assert.ok(address && typeof address === "object");
    const client = create({ environment: { ...env(), SUPABASE_INTERNAL_URL: `http://127.0.0.1:${address.port}` }, now: () => at })!;
    const call = client.rpc(name, args); assert.deepEqual(await call, unavailable); assert.deepEqual(await call, unavailable);
    assert.deepEqual(paths, ["/rest/v1/rpc/faolla_checkout_runtime_v1"]);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
