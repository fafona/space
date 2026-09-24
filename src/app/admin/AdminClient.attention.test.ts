import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("./AdminClient.tsx", import.meta.url), "utf8");
const parsed = ts.createSourceFile("AdminClient.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

function attentionEffect(kind: "booking" | "order") {
  let callback: ts.ArrowFunction | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && node.expression.getText(parsed) === "useEffect") {
      const candidate = node.arguments[0];
      if (candidate && ts.isArrowFunction(candidate) && candidate.body.getText(parsed).includes(`const ${kind}CacheKey =`)) {
        callback = candidate;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  assert.ok(callback, `${kind} attention effect exists`);
  return ts.transpileModule(`globalThis.effect = ${callback.getText(parsed)};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
  }).outputText;
}

type PollingOptions = {
  intervalMs: number;
  initialDelayMs: number;
  timeoutMs: number;
  scheduleInitial?: (callback: () => void) => () => void;
  refresh: (signal: AbortSignal) => Promise<void>;
};

function mount(kind: "booking" | "order", options: {
  fetch?: (input: string, init: RequestInit) => Promise<unknown>;
  cached?: { data: unknown[]; fresh: boolean };
  overrides?: Record<string, unknown>;
} = {}) {
  const writes: unknown[] = [];
  const summaries: unknown[] = [];
  const idleOptions: unknown[] = [];
  let polling: PollingOptions | undefined;
  const context = {
    checkingAuth: false, isPlatformEditor: false, explicitFaollaSectionEntry: false,
    editingSiteId: "10000000",
    isMerchantNumericId: (value: string) => /^\d{8}$/.test(value),
    buildMerchantAdminDataCacheKey: (type: string, siteId: string) => `${type}:${siteId}`,
    readMerchantAdminDataCacheSnapshot: () => options.cached ?? null,
    writeMerchantAdminDataCache: (key: string, value: unknown) => { writes.push({ key, value }); },
    setMerchantBookingAttentionSummary: (value: unknown) => { summaries.push(value); },
    setMerchantOrderAttentionSummary: (value: unknown) => { summaries.push(value); },
    summarizeMerchantBookingAttention: (rows: unknown[]) => ({ count: rows.length, latest: null }),
    summarizeMerchantOrderAttention: (rows: unknown[]) => ({ count: rows.length, latest: null }),
    setMerchantBusinessAttentionHydrationState: () => {},
    startVisiblePolling: (config: PollingOptions) => { polling = config; return () => {}; },
    scheduleAdminIdleTask: (_callback: () => void, config: unknown) => { idleOptions.push(config); return () => {}; },
    fetch: options.fetch ?? (async () => { throw new Error("unexpected fetch"); }),
    ...options.overrides,
    effect: undefined as (() => void) | undefined,
  };
  runInNewContext(attentionEffect(kind), context);
  context.effect!();
  return { writes, summaries, polling, idleOptions };
}

for (const kind of ["booking", "order"] as const) {
  const field = kind === "booking" ? "bookings" : "orders";

  test(`${kind} attention preserves authorized request and updates cache/summary on success`, async () => {
    let request: { input: string; init: RequestInit } | undefined;
    const rows = [{ id: "synthetic-record" }];
    const mounted = mount(kind, { fetch: async (input, init) => {
      request = { input, init };
      return { ok: true, status: 200, json: async () => ({ ok: true, [field]: rows }) };
    } });
    const controller = new AbortController();
    await mounted.polling!.refresh(controller.signal);
    assert.equal(request?.input, `/api/${field}?siteId=10000000`);
    assert.equal(request?.init.signal, controller.signal);
    assert.equal(request?.init.cache, "no-store");
    if (kind === "order") assert.equal(request?.init.credentials, "same-origin");
    assert.deepEqual(mounted.writes, [{ key: `${field}:10000000`, value: rows }]);
    assert.equal((mounted.summaries[0] as { count: number }).count, 1);
    assert.equal(mounted.polling!.intervalMs, 60000);
    assert.equal(mounted.polling!.initialDelayMs, 0);
    assert.equal(mounted.polling!.timeoutMs, 20000);
    mounted.polling!.scheduleInitial!(() => {});
    assert.equal((mounted.idleOptions[0] as { timeoutMs: number }).timeoutMs, 2400);
    assert.equal((mounted.idleOptions[0] as { fallbackDelayMs: number }).fallbackDelayMs, 1000);
  });

  test(`${kind} attention ignores cancelled body results before cache or UI writes`, async () => {
    let resolveBody!: (value: unknown) => void;
    const body = new Promise((resolve) => { resolveBody = resolve; });
    const mounted = mount(kind, { fetch: async () => ({ ok: true, status: 200, json: () => body }) });
    const controller = new AbortController();
    const refresh = mounted.polling!.refresh(controller.signal);
    await Promise.resolve();
    controller.abort();
    resolveBody({ ok: true, [field]: [{ id: "old-workspace" }] });
    await refresh;
    assert.deepEqual(mounted.writes, []);
    assert.deepEqual(mounted.summaries, []);
  });

  test(`${kind} attention reports failures to backoff without replacing cached data`, async () => {
    const mounted = mount(kind, { fetch: async () => ({ ok: false, status: 500, json: async () => ({ ok: false }) }) });
    await assert.rejects(mounted.polling!.refresh(new AbortController().signal), new RegExp(`${kind}_attention_failed`));
    assert.deepEqual(mounted.writes, []);
    assert.deepEqual(mounted.summaries, []);
  });

  test(`${kind} attention respects fresh cache and existing auth/platform/entry guards`, () => {
    const cached = mount(kind, { cached: { data: [{ id: "cached" }], fresh: true } });
    assert.equal(cached.polling!.initialDelayMs, 60000);
    assert.equal(cached.polling!.scheduleInitial, undefined);
    assert.equal((cached.summaries[0] as { count: number }).count, 1);
    for (const overrides of [
      { checkingAuth: true }, { isPlatformEditor: true },
      { explicitFaollaSectionEntry: true }, { editingSiteId: "site-main" },
    ]) {
      assert.equal(mount(kind, { overrides }).polling, undefined);
    }
  });
}

test("order attention still clears its badge on forbidden responses without caching them", async () => {
  const mounted = mount("order", { fetch: async () => ({ ok: false, status: 403, json: async () => ({ ok: false }) }) });
  await assert.rejects(mounted.polling!.refresh(new AbortController().signal), /order_attention_failed/);
  assert.equal((mounted.summaries[0] as { count: number }).count, 0);
  assert.deepEqual(mounted.writes, []);
});

test("idle admin effects do not download unused card editors or printer settings", () => {
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && node.expression.getText(parsed) === "useEffect") {
      const callback = node.arguments[0];
      if (callback && ts.isArrowFunction(callback)) {
        assert.doesNotMatch(callback.body.getText(parsed), /loadMerchant(?:BusinessCardManager|PrintSettingsPanel)\(/);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(parsed);
});

test("explicit card and printer navigation still loads each requested panel", async () => {
  for (const [name, loader, section] of [
    ["openMerchantCardsPanel", "loadMerchantBusinessCardManager", "cards"],
    ["openMerchantPrintPanel", "loadMerchantPrintSettingsPanel", "printer"],
  ]) {
    let declaration: ts.FunctionDeclaration | undefined;
    function visit(node: ts.Node) {
      if (ts.isFunctionDeclaration(node) && node.name?.text === name) declaration = node;
      ts.forEachChild(node, visit);
    }
    visit(parsed);
    assert.ok(declaration);
    const events: string[] = [];
    runInNewContext(`${declaration.getText(parsed)}; ${name}();`, {
      [loader]: () => { events.push("load"); return Promise.resolve(); },
      setMerchantDesktopSection: (value: string) => { events.push(value); },
    });
    assert.deepEqual(events, ["load", section]);
    assert.match(source, new RegExp(`onPointerEnter=\\{\\(\\) => \\{\\s*void ${loader}\\(\\)`));
    assert.match(source, new RegExp(`onFocus=\\{\\(\\) => \\{\\s*void ${loader}\\(\\)`));
  }
});
