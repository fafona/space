import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import {
  MEMBERSHIP_PROFILE_PROJECTION_RPC,
  MEMBERSHIP_PROFILE_PROJECTION_TIMEOUT_MS,
  decodeMembershipProfileProjection,
  isMembershipProfileProjectionEnabled,
  tryLoadMembershipProfileProjection,
} from "@/lib/merchantMembershipProfileProjection.server";
import type { MerchantMembershipsStoreClient } from "@/lib/merchantMembershipsStore";

// Actual adapter imports only erased types. No configured client, environment
// files, credentials, network or database are read by these tests. The two
// public rollout switches are temporarily assigned and always restored.
const SITE = "99990001";
const OTHER_SITE = "99990002";
const SLUG = "__merchant_memberships__:" + SITE;
const ENABLE = "MERCHANT_CUSTOMER_MEMBERSHIP_PROJECTION_ENABLED";
const SITES = "MERCHANT_CUSTOMER_MEMBERSHIP_PROJECTION_SITE_IDS";
type RpcReply = { data?: unknown; error?: unknown };
type Rpc = NonNullable<MerchantMembershipsStoreClient["rpc"]>;

function projected() {
  return {
    version: 1, status: "projected", siteId: SITE,
    rows: [{ id: "row-1", slug: SLUG, updated_at: "2032-01-01T00:00:00.000Z",
      blocks: [{ id: "member-1", siteId: SITE, transactions: [], displayName: "Synthetic member" }] }],
  };
}

function client(rpc?: Rpc): MerchantMembershipsStoreClient {
  return { from: () => { throw new Error("test_forbids_table_access"); }, ...(rpc ? { rpc } : {}) };
}

async function withSwitches<T>(enabled: string | undefined, sites: string | undefined, run: () => Promise<T>) {
  const prior = [process.env[ENABLE], process.env[SITES]];
  try {
    if (enabled === undefined) delete process.env[ENABLE]; else process.env[ENABLE] = enabled;
    if (sites === undefined) delete process.env[SITES]; else process.env[SITES] = sites;
    return await run();
  } finally {
    for (const [index, name] of [ENABLE, SITES].entries()) {
      if (prior[index] === undefined) delete process.env[name]; else process.env[name] = prior[index];
    }
  }
}

const withEnabled = <T,>(run: () => Promise<T>) => withSwitches("1", SITE, run);
const nextTurn = () => new Promise<void>((resolve) => setImmediate(resolve));
const env = (enabled?: string, sites?: string) => ({ [ENABLE]: enabled, [SITES]: sites });

function deferred() {
  let resolve!: (value: RpcReply) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<RpcReply>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function abortableQuery(pending: Promise<RpcReply>) {
  let signal: AbortSignal | undefined;
  let attached = 0;
  const query = Object.assign(pending, {
    abortSignal(value: AbortSignal) {
      assert.equal(this, query, "SDK builder method must retain its receiver");
      signal = value; attached += 1; return query;
    },
  });
  return { query, signal: () => signal, attached: () => attached };
}

test("projection module has only erased type imports and a fixed RPC/deadline", () => {
  const source = readFileSync(new URL("./merchantMembershipProfileProjection.server.ts", import.meta.url), "utf8");
  const ast = ts.createSourceFile("projection.ts", source, ts.ScriptTarget.Latest, true);
  const imports = ast.statements.filter(ts.isImportDeclaration);
  assert.equal(imports.length, 1);
  assert.equal(imports[0]!.importClause?.isTypeOnly, true);
  assert.equal((imports[0]!.moduleSpecifier as ts.StringLiteral).text, "@/lib/merchantMembershipsStore");
  assert.doesNotMatch(source, /\b(?:fetch|require)\s*\(|\bimport\s*\(|process\.env\.[A-Z_]*(?:KEY|SECRET|PASSWORD)/);
  assert.equal(MEMBERSHIP_PROFILE_PROJECTION_RPC, "faolla_customer_membership_profiles_v1");
  assert.equal(MEMBERSHIP_PROFILE_PROJECTION_TIMEOUT_MS, 1500);
});

test("rollout requires the exact enable value, exact numeric site, and an entirely valid CSV", () => {
  for (const enabled of [undefined, "", "0", "true", "yes", "01", " 1", "1 "]) {
    assert.equal(isMembershipProfileProjectionEnabled(SITE, env(enabled, SITE)), false, String(enabled));
  }
  for (const sites of [undefined, "", " ", "*", OTHER_SITE, `${SITE},`, `,${SITE}`,
    `${SITE},,${OTHER_SITE}`, `${SITE},*`, `${SITE},bad`, `${SITE};${OTHER_SITE}`,
    `${SITE}\n${OTHER_SITE}`, `${SITE},9999000`, `${SITE},999900000`, `${SITE},９９９９０００２`]) {
    assert.equal(isMembershipProfileProjectionEnabled(SITE, env("1", sites)), false, String(sites));
  }
  for (const site of ["", "site-main", ` ${SITE}`, `${SITE} `, "9999000", "999900001", "９９９９０００１"]) {
    assert.equal(isMembershipProfileProjectionEnabled(site, env("1", SITE)), false, site);
  }
  for (const sites of [SITE, `${SITE},${OTHER_SITE}`, ` ${OTHER_SITE} , ${SITE} `, `${SITE},${SITE}`]) {
    assert.equal(isMembershipProfileProjectionEnabled(SITE, env("1", sites)), true, sites);
  }
});

test("off, absent allowlist, foreign site and invalid CSV do not invoke RPC or tables", async () => {
  const forbidden = client(() => { assert.fail("RPC must not run"); });
  for (const [enabled, sites] of [[undefined, undefined], ["0", SITE], ["1", undefined],
    ["1", OTHER_SITE], ["1", `${SITE},invalid`]] as const) {
    await withSwitches(enabled, sites, async () => assert.equal(await tryLoadMembershipProfileProjection(forbidden, SITE), null));
  }
  await withEnabled(async () => {
    for (const site of ["", "site-main", `${SITE} `]) {
      assert.equal(await tryLoadMembershipProfileProjection(forbidden, site), null);
    }
  });
});

test("an allowed client without RPC falls back without reading tables", async () => {
  await withEnabled(async () => assert.equal(await tryLoadMembershipProfileProjection(client(), SITE), null));
});

test("successful RPC uses the same client receiver, exact function and one exact site argument", async () => {
  await withEnabled(async () => {
    const reply = projected();
    const original = structuredClone(reply);
    let calls = 0;
    const port = client(function (this: MerchantMembershipsStoreClient, name, args) {
      assert.equal(this, port);
      assert.equal(name, MEMBERSHIP_PROFILE_PROJECTION_RPC);
      assert.deepEqual(args, { p_site_id: SITE });
      calls += 1;
      return Promise.resolve({ data: reply, error: null });
    });
    assert.deepEqual(await tryLoadMembershipProfileProjection(port, SITE), reply.rows);
    assert.equal(calls, 1);
    assert.deepEqual(reply, original);
  });
});

test("decoder preserves complete profiles, array order and invalid non-object members", () => {
  const blocks: unknown[] = [null, false, 42, "invalid", [], ["nested"],
    { id: "duplicate", transactions: [], extra: { untouched: [1, 2] } },
    { id: "duplicate", siteId: OTHER_SITE, transactions: [], updatedAt: "invalid date" }];
  const value = { ...projected(), ignoredEnvelope: true,
    rows: [{ ...projected().rows[0], ignoredRow: true, blocks }] };
  const before = structuredClone(value);
  const result = decodeMembershipProfileProjection(value, SITE);
  assert.deepEqual(result, [{ id: "row-1", slug: SLUG, updated_at: "2032-01-01T00:00:00.000Z", blocks }]);
  assert.deepEqual(value, before);
  assert.deepEqual(decodeMembershipProfileProjection({ ...projected(), rows: [{ ...projected().rows[0], blocks: [] }] }, SITE),
    [{ ...projected().rows[0], blocks: [] }]);
});

test("decoder leaves timestamp interpretation to the unchanged original merger", () => {
  for (const updated_at of [null, "", "invalid date", " 2032-01-01 "]) {
    const row = { ...projected().rows[0], updated_at };
    assert.deepEqual(decodeMembershipProfileProjection({ ...projected(), rows: [row] }, SITE), [row]);
  }
  const numericId = { ...projected().rows[0], id: 123 };
  assert.deepEqual(decodeMembershipProfileProjection({ ...projected(), rows: [numericId] }, SITE), [numericId]);
});

test("decoder refuses wrong envelope, version, status, scope or row count", () => {
  const good = projected();
  for (const value of [null, undefined, false, 1, "projected", [], {},
    { ...good, version: undefined }, { ...good, version: "1" }, { ...good, version: 2 },
    { ...good, status: undefined }, { ...good, status: "fallback" }, { ...good, status: "PROJECTED" },
    { ...good, siteId: OTHER_SITE }, { ...good, siteId: Number(SITE) }, { ...good, siteId: `${SITE} ` },
    { ...good, rows: undefined }, { ...good, rows: {} }, { ...good, rows: [] },
    { ...good, rows: [...good.rows, ...good.rows] }, { ...good, rows: [null] }, { ...good, rows: [[]] }]) {
    assert.equal(decodeMembershipProfileProjection(value, SITE), null, JSON.stringify(value));
  }
});

test("decoder refuses malformed row identity, slug, timestamp and blocks", () => {
  const good = projected();
  const row = good.rows[0]!;
  const patches = [
    ...[undefined, null, "", false, {}, [], NaN, Infinity, -Infinity].map((id) => ({ id })),
    ...[undefined, null, "", `${SLUG} `, "__merchant_memberships__:" + OTHER_SITE].map((slug) => ({ slug })),
    ...[undefined, 0, false, {}, []].map((updated_at) => ({ updated_at })),
    ...[undefined, null, false, "[]", {}].map((blocks) => ({ blocks })),
  ];
  for (const patch of patches) {
    assert.equal(decodeMembershipProfileProjection({ ...good, rows: [{ ...row, ...patch }] }, SITE), null, JSON.stringify(patch));
  }
});

test("every object membership must contain an exactly empty transaction array", () => {
  const good = projected();
  for (const transactions of [undefined, null, false, "", "[]", {}, 0, [{}], [null]]) {
    const rows = [{ ...good.rows[0], blocks: [{ transactions: [] }, { id: "invalid-or-foreign", transactions }] }];
    assert.equal(decodeMembershipProfileProjection({ ...good, rows }, SITE), null, JSON.stringify(transactions));
  }
  assert.equal(decodeMembershipProfileProjection({ ...good, rows: [{ ...good.rows[0], blocks: [{}] }] }, SITE), null);
});

test("service errors, missing RPC and malformed responses always return fallback, not empty success", async () => {
  await withEnabled(async () => {
    const good = projected();
    const replies: unknown[] = [null, undefined, false, {}, { data: null }, { data: [] },
      { data: good, error: { code: "PGRST202", message: "missing function" } },
      { data: good, error: { code: "42501", message: "permission denied" } },
      { data: good, error: "transport error" },
      { data: { version: 1, status: "unsupported", siteId: SITE } },
      { data: { ...good, rows: [] } }, { data: { ...good, siteId: OTHER_SITE } },
      { data: { ...good, rows: [{ ...good.rows[0], blocks: [{ transactions: [{}] }] }] } }];
    for (const reply of replies) {
      let calls = 0;
      const port = client(() => { calls += 1; return Promise.resolve(reply as RpcReply); });
      assert.equal(await tryLoadMembershipProfileProjection(port, SITE), null);
      assert.equal(calls, 1, "there is no retry or alternate RPC");
    }
  });
});

test("synchronous RPC throw and asynchronous rejection return fallback", async () => {
  await withEnabled(async () => {
    assert.equal(await tryLoadMembershipProfileProjection(client(() => { throw new Error("synthetic sync failure"); }), SITE), null);
    assert.equal(await tryLoadMembershipProfileProjection(client(() => Promise.reject(new Error("synthetic async failure"))), SITE), null);
  });
});

test("the exact deadline aborts a hung SDK query once and clears its timer after fallback", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  await withEnabled(async () => {
    const task = deferred();
    const builder = abortableQuery(task.promise);
    let aborts = 0;
    let finished = false;
    const loading = tryLoadMembershipProfileProjection(client(() => builder.query), SITE);
    void loading.then(() => { finished = true; });
    assert.equal(builder.attached(), 1);
    const signal = builder.signal();
    assert.ok(signal);
    signal.addEventListener("abort", () => { aborts += 1; task.reject(new Error("synthetic abort")); }, { once: true });
    t.mock.timers.tick(1499);
    await nextTurn();
    assert.equal(finished, false);
    assert.equal(signal.aborted, false);
    t.mock.timers.tick(1);
    assert.equal(await loading, null);
    assert.equal(signal.aborted, true);
    assert.equal(aborts, 1);
    t.mock.timers.tick(3000);
    await nextTurn();
    assert.equal(aborts, 1);
  });
});

test("SDK abortSignal may return a separate thenable; that returned query is awaited", async () => {
  await withEnabled(async () => {
    let called = 0;
    const query = {
      then() { assert.fail("unconfigured builder should not execute"); },
      abortSignal(signal: AbortSignal) {
        assert.equal(this, query);
        assert.equal(signal.aborted, false);
        called += 1;
        return Promise.resolve({ data: projected(), error: null });
      },
    };
    assert.deepEqual(await tryLoadMembershipProfileProjection(client(() => query), SITE), projected().rows);
    assert.equal(called, 1);
  });
});

test("a non-abortable thenable remains bounded and its late rejection is observed", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  await withEnabled(async () => {
    const task = deferred();
    const unhandled: unknown[] = [];
    const observe = (reason: unknown) => { unhandled.push(reason); };
    process.on("unhandledRejection", observe);
    try {
      const loading = tryLoadMembershipProfileProjection(client(() => task.promise), SITE);
      t.mock.timers.tick(1500);
      assert.equal(await loading, null);
      task.reject(new Error("late synthetic rejection after timeout"));
      await nextTurn();
      assert.deepEqual(unhandled, []);
    } finally { process.off("unhandledRejection", observe); }
  });
});

test("a valid late success cannot replace the timeout fallback", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  await withEnabled(async () => {
    const task = deferred();
    const builder = abortableQuery(task.promise);
    const loading = tryLoadMembershipProfileProjection(client(() => builder.query), SITE);
    t.mock.timers.tick(1500);
    assert.equal(await loading, null);
    task.resolve({ data: projected() });
    await nextTurn();
    assert.equal(await loading, null);
    assert.equal(builder.signal()?.aborted, true);
  });
});

test("success, service error and early rejection all cancel their deadline timer", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  await withEnabled(async () => {
    for (const outcome of ["success", "error", "reject"] as const) {
      const task = deferred();
      const builder = abortableQuery(task.promise);
      const loading = tryLoadMembershipProfileProjection(client(() => builder.query), SITE);
      if (outcome === "reject") task.reject(new Error("early synthetic rejection"));
      else task.resolve(outcome === "success" ? { data: projected() } : { error: { code: "42501" } });
      assert.deepEqual(await loading, outcome === "success" ? projected().rows : null);
      t.mock.timers.tick(3000);
      await nextTurn();
      assert.equal(builder.signal()?.aborted, false, outcome);
    }
  });
});

test("a thrown abortSignal configuration returns fallback and cancels the timer", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  await withEnabled(async () => {
    let signal: AbortSignal | undefined;
    const query = Object.assign(new Promise<RpcReply>(() => {}), {
      abortSignal(value: AbortSignal) { signal = value; throw new Error("synthetic builder setup failure"); },
    });
    assert.equal(await tryLoadMembershipProfileProjection(client(() => query), SITE), null);
    t.mock.timers.tick(3000);
    await nextTurn();
    assert.equal(signal?.aborted, false);
  });
});

test("each call re-evaluates rollout settings without cross-request caching", async () => {
  let calls = 0;
  const port = client(() => { calls += 1; return Promise.resolve({ data: projected() }); });
  await withEnabled(async () => assert.deepEqual(await tryLoadMembershipProfileProjection(port, SITE), projected().rows));
  await withSwitches("0", SITE, async () => assert.equal(await tryLoadMembershipProfileProjection(port, SITE), null));
  await withSwitches("1", OTHER_SITE, async () => assert.equal(await tryLoadMembershipProfileProjection(port, SITE), null));
  await withEnabled(async () => assert.deepEqual(await tryLoadMembershipProfileProjection(port, SITE), projected().rows));
  assert.equal(calls, 2);
});
