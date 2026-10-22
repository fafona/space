import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { createClient } from "@supabase/supabase-js";
import { resolveGoogleOAuthRedirectOrigin } from "../../lib/googleOAuthCallback";

// Exercise the actual click handler, not a second implementation of its policy.
// All auth calls, navigation and storage writes are isolated in this VM.
const sourceText = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
const sourceFile = ts.createSourceFile("page.tsx", sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const handlers: ts.FunctionDeclaration[] = [];
function findHandler(node: ts.Node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === "signInWithGoogle") handlers.push(node);
  ts.forEachChild(node, findHandler);
}
findHandler(sourceFile);
assert.equal(handlers.length, 1, "The real Google sign-in handler must be unambiguous");
const handlerCode = ts.transpileModule(handlers[0].getText(sourceFile), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;

type OAuthRequest = {
  provider: "google";
  options: {
    redirectTo: string;
    queryParams: Record<string, string>;
    skipBrowserRedirect: boolean;
  };
};
type HarnessOptions = {
  standalone?: boolean;
  account?: string;
  entry?: "merchant" | "personal" | null;
  pendingAction?: string | null;
  providerEnabled?: boolean | null;
  settingsEnabled?: boolean;
  weChat?: boolean;
  sdkError?: string;
  sdkUrl?: string | null;
};

function createHarness(options: HarnessOptions = {}) {
  const requests: OAuthRequest[] = [];
  const redirects: string[] = [];
  const messages: string[] = [];
  const attempts: Array<{ accountType: string; stateRetryCount: number; redirectPath: string }> = [];
  const pending: Array<string | null> = [];
  const entries: string[] = [];
  let cleared = 0;
  let settingsRead = 0;
  const context = vm.createContext({
    URL,
    resolveGoogleOAuthRedirectOrigin,
    pendingAction: options.pendingAction ?? null,
    activeEntryAccountType: options.entry === undefined ? "merchant" : options.entry,
    isWeChatBrowser: options.weChat ?? false,
    googleWeChatBlockedMessage: "Open in an external browser",
    account: options.account ?? "",
    isStandaloneDisplayMode: () => options.standalone ?? false,
    googleProviderEnabled: options.providerEnabled === undefined ? true : options.providerEnabled,
    requestedRedirectPath: "/admin?section=bookings",
    loginFromUrl: "https://faolla.com/",
    writeStoredLoginEntryAccountType: (entry: string) => entries.push(entry),
    setMsg: (message: string) => messages.push(message),
    setNeedConfirmEmail: () => undefined,
    setPendingAction: (action: string | null) => pending.push(action),
    clearGoogleOAuthAttempt: () => { cleared += 1; },
    readSupabaseAuthSettings: async () => {
      settingsRead += 1;
      return { external: { google: options.settingsEnabled ?? true } };
    },
    readGoogleProviderEnabledFromSettings: (settings: { external: { google: boolean } }) => settings.external.google,
    setGoogleProviderEnabled: () => undefined,
    writeGoogleOAuthAttempt: (attempt: (typeof attempts)[number]) => attempts.push(attempt),
    window: {
      location: {
        origin: "https://launch.faolla.com",
        replace: (href: string) => redirects.push(href),
      },
    },
    supabase: {
      auth: {
        signInWithOAuth: async (request: OAuthRequest) => {
          requests.push(JSON.parse(JSON.stringify(request)) as OAuthRequest);
          return {
            data: { url: options.sdkUrl === undefined ? "https://auth.example.test/authorize" : options.sdkUrl },
            error: options.sdkError ? new Error(options.sdkError) : null,
          };
        },
      },
    },
    normalizeError: (message: string) => message,
    t: (key: string) => key,
  });
  const signIn = new vm.Script(`${handlerCode}\nsignInWithGoogle;`).runInContext(context) as
    (options?: { accountType?: "merchant" | "personal"; retryExpiredState?: boolean }) => Promise<void>;
  return { signIn, requests, redirects, messages, attempts, pending, entries,
    get cleared() { return cleared; }, get settingsRead() { return settingsRead; } };
}

for (const [name, standalone] of [["browser tab", false], ["installed standalone/PWA window", true]] as const) {
  for (const account of ["", "previous@example.test"]) {
    test(`Google login always requests account selection in ${name}, email ${account ? "prefilled" : "empty"}`, async () => {
      const h = createHarness({ standalone, account });
      await h.signIn();
      assert.equal(h.requests.length, 1);
      const request = h.requests[0];
      assert.equal(request.provider, "google");
      assert.deepEqual(request.options.queryParams, { prompt: "select_account" });
      assert.equal(request.options.skipBrowserRedirect, true);
      const callback = new URL(request.options.redirectTo);
      assert.equal(callback.origin, "https://faolla.com");
      assert.equal(callback.pathname, "/login");
      assert.equal(callback.searchParams.get("oauth"), "google");
      assert.equal(callback.searchParams.get("accountType"), "merchant");
      assert.equal(callback.searchParams.get("redirect"), "/admin?section=bookings");
      assert.equal(callback.searchParams.get("loginFrom"), "https://faolla.com/");
      assert.deepEqual(h.redirects, ["https://auth.example.test/authorize"]);
      assert.equal(h.attempts[0].accountType, "merchant");
      assert.equal(h.attempts[0].stateRetryCount, 0);
    });
  }
}

test("personal entry and expired-state retry still require account confirmation", async () => {
  const h = createHarness({ pendingAction: "google", standalone: true, account: "old@example.test" });
  await h.signIn({ accountType: "personal", retryExpiredState: true });
  assert.equal(h.requests.length, 1);
  assert.deepEqual(h.requests[0].options.queryParams, { prompt: "select_account" });
  assert.equal(new URL(h.requests[0].options.redirectTo).searchParams.get("accountType"), "personal");
  assert.equal(h.attempts[0].accountType, "personal");
  assert.equal(h.attempts[0].stateRetryCount, 1);
});

test("duplicate clicks do not start a second OAuth attempt", async () => {
  const h = createHarness({ pendingAction: "google" });
  await h.signIn();
  assert.equal(h.requests.length, 0);
  assert.equal(h.redirects.length, 0);
});

test("an unknown provider setting is checked before starting interactive Google login", async () => {
  const h = createHarness({ providerEnabled: null });
  await h.signIn();
  assert.equal(h.settingsRead, 1);
  assert.deepEqual(h.requests[0].options.queryParams, { prompt: "select_account" });
});

for (const setup of [{ providerEnabled: false }, { providerEnabled: null, settingsEnabled: false }]) {
  test(`disabled Google provider never redirects, even with an existing account hint (${JSON.stringify(setup)})`, async () => {
    const h = createHarness({ ...setup, account: "previous@example.test" });
    await h.signIn();
    assert.equal(h.requests.length, 0);
    assert.equal(h.redirects.length, 0);
    assert.equal(h.cleared, 1);
    assert.equal(h.pending.at(-1), null);
  });
}

test("WeChat remains blocked instead of attempting an unsupported embedded login", async () => {
  const h = createHarness({ weChat: true });
  await h.signIn();
  assert.equal(h.requests.length, 0);
  assert.equal(h.redirects.length, 0);
  assert.equal(h.messages.at(-1), "Open in an external browser");
});

test("missing entry never silently chooses a personal or merchant identity", async () => {
  const h = createHarness({ entry: null });
  await h.signIn();
  assert.equal(h.requests.length, 0);
  assert.equal(h.redirects.length, 0);
  assert.equal(h.entries.length, 0);
});

for (const setup of [{ sdkError: "access_denied" }, { sdkUrl: null }]) {
  test(`OAuth failure clears the attempt without entering an old account (${JSON.stringify(setup)})`, async () => {
    const h = createHarness(setup);
    await h.signIn();
    assert.equal(h.redirects.length, 0);
    assert.equal(h.cleared, 1);
    assert.equal(h.pending.at(-1), null);
    assert.ok(h.messages.at(-1));
  });
}

test("the installed Supabase SDK forwards the actual handler's account-selection request without network access", async () => {
  const h = createHarness({ standalone: true, account: "previous@example.test" });
  await h.signIn();
  let fetchCount = 0;
  const client = createClient("https://auth.example.test", "test-anon-key-not-a-real-credential", {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, flowType: "pkce" },
    global: { fetch: async () => { fetchCount += 1; throw new Error("No external requests allowed"); } },
  });
  try {
    const result = await client.auth.signInWithOAuth(h.requests[0]);
    assert.equal(result.error, null);
    assert.ok(result.data.url);
    const authorize = new URL(result.data.url);
    assert.equal(authorize.searchParams.get("provider"), "google");
    assert.equal(authorize.searchParams.get("prompt"), "select_account");
    assert.equal(authorize.searchParams.has("login_hint"), false);
    assert.equal(authorize.searchParams.get("redirect_to"), h.requests[0].options.redirectTo);
    assert.equal(authorize.searchParams.get("code_challenge_method"), "s256");
    assert.equal(fetchCount, 0);
  } finally {
    client.auth.stopAutoRefresh();
  }
});
