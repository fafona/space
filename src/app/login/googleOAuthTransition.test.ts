import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Script } from "node:vm";
import ts from "typescript";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import LoadingProgressScreen from "../../components/LoadingProgressScreen";
import * as callback from "../../lib/googleOAuthCallback";
import * as credentialValidation from "../../lib/authCredentialValidation";

// Execute the complete, real login component with deterministic React hooks.
// Only browser IO, imported descendants and auth transports are substituted.
// No real account, credential, storage, network or production write is used.
const code = ts.transpileModule(
  readFileSync(new URL("./page.tsx", import.meta.url), "utf8") + "\nexport { LoginPageInner as TestLoginPage };",
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } },
).outputText;
type Element = { type: string; props: Record<string, unknown> };
type Effect = { setup: () => void | (() => void); deps: unknown[] };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
const merchant = { accountType: "merchant", requestedAccountType: "merchant", merchantId: "99990001", merchantIds: ["99990001"], user: { id: "synthetic-user" } };
function harness(options: { search?: string; hash?: string; locale?: string; ssr?: boolean; actualSsr?: boolean; retryCount?: number; sdkError?: string; providerEnabled?: boolean; weChat?: boolean } = {}) {
  let url = new URL(`https://synthetic.invalid/login${options.search ?? "?oauth=google&accountType=merchant&code=synthetic-code"}${options.hash ?? ""}`);
  let params = new URLSearchParams(url.search);
  const slots: unknown[] = [], effects: Effect[] = [];
  let cursor = 0, hookCount: number | undefined;
  let clock = Date.now();
  class FixtureDate extends Date { static now() { return clock; } }
  const timers: Array<{ callback: () => void; delay: number }> = [];
  const requests: Array<{ url: string; body?: Record<string, unknown> }> = [], redirects: string[] = [], oauth: Array<{ provider: string; options: { queryParams: Record<string, string> } }> = [];
  const response = deferred<Response>(), browserSession = deferred<{ access_token: string; refresh_token: string }>();
  const storage = new Map<string, string>();
  if (options.retryCount !== undefined) storage.set("faolla.googleOAuthAttempt", JSON.stringify({ accountType: "merchant", startedAt: Date.now(), stateRetryCount: options.retryCount, redirectPath: "", loginFromUrl: "" }));
  const store = { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key), length: 0 };
  const memo = (compute: () => unknown, deps: unknown[]) => {
    const i = cursor++, old = slots[i] as { deps: unknown[]; value: unknown } | undefined;
    if (!old || deps.some((v, j) => !Object.is(v, old.deps[j]))) slots[i] = { deps: [...deps], value: compute() };
    return (slots[i] as { value: unknown }).value;
  };
  const react = {
    Suspense: "Suspense", useMemo: memo, useCallback: (fn: () => unknown, deps: unknown[]) => memo(() => fn, deps),
    useRef: (value: unknown) => { const i = cursor++; if (!(i in slots)) slots[i] = { current: value }; return slots[i]; },
    useState: (initial: unknown) => {
      const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === "function" ? initial() : initial;
      const set = (value: unknown) => { slots[i] = typeof value === "function" ? value(slots[i]) : value; };
      return [slots[i], set];
    },
    useEffect: (setup: Effect["setup"], deps: unknown[]) => { cursor++; effects.push({ setup, deps }); },
  };
  const jsx = (type: string, props: Record<string, unknown>) => ({ type, props });
  const imports: Record<string, unknown> = {
    react: options.actualSsr ? React : react, "react/jsx-runtime": options.actualSsr ? jsxRuntime : { jsx, jsxs: jsx },
    "next/navigation": { useSearchParams: () => params },
    "@/components/I18nProvider": { useI18n: () => ({ locale: options.locale ?? "zh-CN", t: (key: string) => key }) },
    "@/components/PasswordField": { default: "PasswordField", getPasswordToggleLabels: () => ({ show: "show", hide: "hide" }) },
    "@/components/LoadingProgressScreen": { default: options.actualSsr ? LoadingProgressScreen : "LoadingProgressScreen" },
    "@/lib/authCredentialValidation": credentialValidation,
    "@/lib/googleOAuthCallback": callback,
    "@/lib/merchantIdentity": { isMerchantNumericId: (id: string) => /^\d{8}$/.test(id) },
    "@/lib/authSessionRecovery": {
      readMerchantSessionMerchantIds: (payload: typeof merchant | null) => payload?.merchantIds ?? [],
      establishBrowserSupabaseSession: () => browserSession.promise,
    },
    "@/lib/faollaEntry": { normalizeFaollaEntryUrl: () => "", isFaollaAppShellSearch: () => false },
    "@/lib/accountWorkspaceNavigation": { buildAccountWorkspaceHref: ({ merchantId }: { merchantId: string }) => `/${merchantId}` },
    "@/lib/merchantLaunchState": { persistRecentMerchantLaunchState: () => undefined },
    "@/lib/merchantSignInBridge": { clearMerchantSignInBridge: () => undefined },
    "@/lib/resetPasswordEmailRequest": {}, "@/lib/resetPasswordRecoveryPayload": {}, "@/lib/siteRouting": {},
    "@/lib/supabase": { legacySupabaseAuthStorageKey: "synthetic-session", getResolvedSupabaseUrl: () => "https://auth.invalid", resolvedSupabaseAnonKey: "synthetic", supabase: { auth: {
      signInWithOAuth: async (request: (typeof oauth)[number]) => { oauth.push(request); return { data: { url: "https://auth.invalid/authorize" }, error: options.sdkError ? new Error(options.sdkError) : null }; },
      getSession: async () => ({ data: { session: null } }), initialize: async () => undefined,
    } } },
  };
  const location = { get href() { return url.href; }, set href(value: string) { redirects.push(value); }, get origin() { return url.origin; }, replace: (href: string) => redirects.push(href) };
  const sandboxModule = { exports: {} as { TestLoginPage: () => Element } };
  new Script(code).runInNewContext({ module: sandboxModule, exports: sandboxModule.exports,
    require: (name: string) => { if (!(name in imports)) throw Error(`unexpected_import:${name}`); return imports[name]; },
    process: { env: { NODE_ENV: "test" } }, URL, URLSearchParams, AbortController, Date: FixtureDate,
    ...(options.ssr ? {} : { window: { location, sessionStorage: store, localStorage: store,
      history: { state: null, replaceState: (_state: unknown, _title: string, href: string) => { url = new URL(href, url); params = new URLSearchParams(url.search); } },
      setTimeout: (fn: () => void, delay: number) => { timers.push({ callback: fn, delay }); return timers.length; }, clearTimeout: () => undefined,
    }, document: { cookie: "", documentElement: { dataset: {} } }, navigator: { userAgent: options.weChat ? "MicroMessenger" : "Synthetic browser" } }),
    setTimeout: (fn: () => void, delay: number) => { timers.push({ callback: fn, delay }); return timers.length; }, clearTimeout: () => undefined,
    fetch: (href: string, init?: RequestInit) => {
      requests.push({ url: href, ...(init?.body ? { body: JSON.parse(String(init.body)) as Record<string, unknown> } : {}) });
      if (href === "https://auth.invalid/auth/v1/settings") return Promise.resolve(Response.json({ external: { google: options.providerEnabled ?? true } }));
      assert.equal(href, "/api/auth/merchant-session"); return response.promise;
    },
  });
  const render = () => { cursor = 0; effects.length = 0; const tree = sandboxModule.exports.TestLoginPage(); if (hookCount !== undefined) assert.equal(cursor, hookCount, "all renders preserve the hook order"); hookCount = cursor; return tree; };
  const renderHtml = () => renderToStaticMarkup(React.createElement(sandboxModule.exports.TestLoginPage as unknown as React.ComponentType));
  const runEffect = (marker: string) => { render(); const matching = effects.filter(e => e.setup.toString().includes(marker)); assert.equal(matching.length, 1); return matching[0].setup(); };
  const pending = () => render().type === "LoadingProgressScreen";
  const advance = (delay: number) => { const i = timers.findIndex(t => t.delay === delay); assert.notEqual(i, -1); clock += delay; timers.splice(i, 1)[0].callback(); };
  return { render, renderHtml, pending, requests, redirects, oauth, timers, response, browserSession, storage, runEffect, advance, get url() { return url; } };
}
async function flush() { for (let i = 0; i < 16; i++) await Promise.resolve(); }
function text(tree: unknown): string {
  if (typeof tree === "string") return tree;
  if (!tree || typeof tree !== "object") return "";
  if (Array.isArray(tree)) return tree.map(text).join(" ");
  return text((tree as Element).props?.children);
}
const callbackEffect = "if (!isGoogleOAuthReturn || loggedOut || googleOAuthStateExpired)";
const expiredEffect = "if (!googleOAuthStateExpired)";

test("OAuth first paint, including SSR and hash returns, renders the shared branded loader before any effect or IO", () => {
  for (const options of [{}, { ssr: true }, { locale: "en-GB" }, { search: "?oauth=google&accountType=personal", hash: "#access_token=synthetic&refresh_token=synthetic" }]) {
    const h = harness(options), tree = h.render();
    assert.equal(tree.type, "LoadingProgressScreen");
    assert.match(String(tree.props.statusTitle), /欢迎使用 FAOLLA|Welcome to FAOLLA/);
    assert.equal(h.requests.length, 0); assert.equal(h.redirects.length, 0); assert.equal(h.storage.size, 0);
  }
});
test("ordinary password login, registration, entry selection and explicit logout do not become Google loading screens", () => {
  for (const search of ["", "?accountType=merchant", "?accountType=personal", "?accountType=merchant&authView=signup_merchant", "?oauth=google&accountType=merchant&loggedOut=1"]) {
    const h = harness({ search }); assert.equal(h.render().type, "main"); assert.equal(h.requests.length, 0);
  }
});
test("actual React SSR emits the branded loading screen, never hidden login inputs or buttons, on callback first paint", () => {
  const h = harness({ ssr: true, actualSsr: true }), html = h.renderHtml();
  assert.match(html, /faolla-loading-progress-screen/); assert.match(html, /faolla-launch-solar-loader/);
  assert.match(html, /欢迎使用 FAOLLA 愿您生意兴隆/); assert.doesNotMatch(html, /<input|<button|merchant-login-password|Faolla Account/);
  assert.equal(h.requests.length, 0); assert.deepEqual(h.redirects, []);
});
test("slow code exchange holds the loader until the existing server validation and redirect finish", async () => {
  const h = harness(); h.runEffect(callbackEffect); await flush();
  assert.equal(h.pending(), true); assert.equal(h.requests.length, 1); assert.equal(h.redirects.length, 0);
  assert.deepEqual(h.requests[0].body, { authCode: "synthetic-code", authProvider: "google", preferredAccountType: "merchant" });
  h.response.resolve(Response.json(merchant)); await flush();
  assert.deepEqual(h.redirects, ["/99990001"]); assert.equal(h.pending(), true); assert.equal(h.url.searchParams.has("oauth"), false);
});
test("URL cleanup and account-entry-switch notice cannot reveal the form before navigation", async () => {
  const h = harness(); h.runEffect(callbackEffect);
  h.response.resolve(Response.json({ ...merchant, accountType: "personal", entrySwitched: true })); await flush();
  assert.equal(h.url.searchParams.has("oauth"), false); assert.equal(h.pending(), true); assert.deepEqual(h.redirects, []);
  assert.match(String(h.render().props.statusDescription), /个人用户/);
  const timer = h.timers.find(t => t.delay === 900); assert.ok(timer); timer.callback(); await flush();
  assert.deepEqual(h.redirects, ["/me"]); assert.equal(h.pending(), true);
});
test("implicit-token callbacks keep the same loader while browser session establishment is pending", async () => {
  const h = harness({ search: "?oauth=google&accountType=merchant", hash: "#access_token=synthetic-access&refresh_token=synthetic-refresh" });
  h.runEffect(callbackEffect); await flush(); assert.equal(h.pending(), true); assert.equal(h.requests.length, 0);
  h.browserSession.resolve({ access_token: "synthetic-access", refresh_token: "synthetic-refresh" }); await flush();
  assert.equal(h.pending(), true); assert.equal(h.url.hash, "");
  assert.equal(h.requests[0].body?.authProvider, "google"); assert.equal(h.requests[0].body?.accessToken, "synthetic-access");
  h.response.resolve(Response.json(merchant)); await flush(); assert.deepEqual(h.redirects, ["/99990001"]);
});
test("denied authorization restores the usable form and error instead of an indefinite loading screen", async () => {
  const h = harness({ search: "?oauth=google&accountType=merchant&error=access_denied&error_description=Cancelled" });
  assert.equal(h.pending(), true); h.runEffect(callbackEffect); await flush();
  const tree = h.render(); assert.equal(tree.type, "main"); assert.match(text(tree), /Cancelled/); assert.deepEqual(h.redirects, []);
});
test("a callback URL without credentials releases the loader without reusing an old session", () => {
  const h = harness({ search: "?oauth=google&accountType=merchant" });
  assert.equal(h.pending(), true); h.runEffect(callbackEffect);
  assert.equal(h.pending(), false); assert.equal(h.requests.length, 0); assert.deepEqual(h.redirects, []);
});
test("expired-state retry keeps loading during the timer and still requests Google account selection", async () => {
  const h = harness({ search: "?oauth=google&accountType=merchant&oauth_error=bad_oauth_state", retryCount: 0 });
  h.runEffect(expiredEffect); assert.equal(h.pending(), true);
  const timer = h.timers.find(t => t.delay === 420); assert.ok(timer); timer.callback(); await flush();
  assert.equal(h.pending(), true); assert.equal(h.oauth.length, 1); assert.equal(h.oauth[0].options.queryParams.prompt, "select_account");
  assert.deepEqual(h.redirects, ["https://auth.invalid/authorize"]);
});
for (const options of [{ retryCount: 1 }, { retryCount: 0, sdkError: "access_denied" }, { retryCount: 0, providerEnabled: false }, { retryCount: 0, weChat: true }]) {
  test(`terminal retry failure releases the form with no false login: ${JSON.stringify(options)}`, async () => {
    const h = harness({ search: "?oauth=google&accountType=merchant&oauth_error=bad_oauth_state", ...options });
    h.runEffect(expiredEffect); h.timers.find(t => t.delay === 420)?.callback(); await flush();
    assert.equal(h.pending(), false); assert.deepEqual(h.redirects, []); assert.ok(text(h.render()));
  });
}
test("missing-session timeout after an exhausted retry returns to the form rather than spinning forever", async () => {
  const h = harness({ search: "?oauth=google&accountType=merchant&state=synthetic", retryCount: 1 });
  h.runEffect(callbackEffect); await flush();
  for (let i = 0; i < 50 && h.timers.some(t => t.delay === 180); i++) { h.advance(180); await flush(); }
  assert.equal(h.pending(), false); assert.match(text(h.render()), /Google 登录未完成/);
  assert.equal(h.requests.length, 0); assert.deepEqual(h.redirects, []);
});
