import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { isMemberCheckoutSingleRetainedIntentEnabled } from "./merchantCheckoutSingleRetainedPilot.server";
import { buildCheckoutStartHref } from "./merchantCheckoutClient";
import { buildOnSiteCheckoutStartHref } from "./merchantCheckoutOnSiteClient";
import { parseCheckoutStartQuery } from "./merchantCheckoutClient";

const site = "10909994", env = Object.fromEntries(["PILOT", "CART_PILOT", "CART_UI_PILOT", "INTENT_PILOT", "ACCOUNT_DRAFT_PILOT", "RETAINED_INTENT", "SINGLE_RETAINED_UI"].map(k => [`MERCHANT_MEMBER_CHECKOUT_${k}_SITES`, site]));
test("single retained UI opt-in is strictly default-closed and cannot replace any existing registration or draft gate", () => {
  assert.equal(isMemberCheckoutSingleRetainedIntentEnabled(site, {}), false); assert.equal(isMemberCheckoutSingleRetainedIntentEnabled(site, env), true);
  for (const key of Object.keys(env)) assert.equal(isMemberCheckoutSingleRetainedIntentEnabled(site, { ...env, [key]: "" }), false, key);
  for (const value of ["*", site + ",", "invalid", new Array(51).fill(site).join(",")])
    assert.equal(isMemberCheckoutSingleRetainedIntentEnabled(site, { ...env, MERCHANT_MEMBER_CHECKOUT_SINGLE_RETAINED_UI_SITES: value }), false);
});
async function pageModule(method: "points" | "on_site", options: { enabled?: boolean; canonical?: boolean } = {}) {
  const file = path.resolve(`src/app/member-checkout/[siteId]/${method === "points" ? "" : "on-site/"}start/page.tsx`), source = await readFile(file, "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const requireRepo = createRequire(path.resolve("package.json")), calls: string[] = [], taskModule = { exports: {} as { default: (input: unknown) => Promise<{ props: Record<string, unknown> }> } };
  const deps: Record<string, unknown> = {
    "next/navigation": { notFound: () => { throw new Error("NOT_FOUND"); }, redirect: (href: string) => { calls.push(href); throw new Error("REDIRECT"); } },
    "next/headers": { headers: async () => new Headers() },
    "@/lib/canonicalPortalRequest": { isCanonicalPortalRequest: () => options.canonical !== false, resolveCanonicalPortalOrigin: () => new URL("https://portal.synthetic.invalid") },
    "@/lib/merchantCheckoutCartPilot.server": { isMemberCheckoutIntentPilotEnabled: () => true },
    "@/lib/merchantMemberCheckoutPilot.server": { isMemberCheckoutPilotEnabled: () => true },
    "@/lib/merchantCheckoutOnSitePilot.server": { isMemberCheckoutOnSitePilotEnabled: () => true },
    "@/lib/merchantCheckoutSingleRetainedPilot.server": { isMemberCheckoutSingleRetainedIntentEnabled: (id: string) => { calls.push(id); return isMemberCheckoutSingleRetainedIntentEnabled(id, options.enabled === false ? {} : env); } },
    "@/lib/merchantCheckoutClient": { parseCheckoutStartQuery, buildCheckoutStartHref },
    "@/lib/merchantCheckoutOnSiteClient": { buildOnSiteCheckoutStartHref },
    "./CheckoutStartClient": { __esModule: true, default: () => null }, "../../start/CheckoutStartClient": { __esModule: true, default: () => null },
  };
  runInNewContext(code, { module: taskModule, exports: taskModule.exports, Request, URL, require: (name: string) => Object.hasOwn(deps, name) ? deps[name] : requireRepo(name) }, { filename: file });
  return { run: taskModule.exports.default, calls };
}
test("both actual server pages pass only the explicit single capability and keep canonical redirects before rendering", async () => {
  const query = { offerId: "11111111-1111-4111-8111-111111111111", offerRevision: "22222222-2222-4222-8222-222222222222", quantity: "1", uiLocale: "es-ES" };
  for (const method of ["points", "on_site"] as const) {
    for (const enabled of [false, true]) { const x = await pageModule(method, { enabled }), result = await x.run({ params: Promise.resolve({ siteId: site }), searchParams: Promise.resolve(query) });
      assert.equal(result.props.retainedIntentEnabled, enabled); assert.equal(result.props.intentEnabled, true); assert.deepEqual(x.calls, [site]);
    }
    const x = await pageModule(method, { canonical: false }); await assert.rejects(x.run({ params: Promise.resolve({ siteId: site }), searchParams: Promise.resolve(query) }), /REDIRECT/);
    assert.equal(x.calls.length, 1); assert.match(x.calls[0], /^https:\/\/portal\.synthetic\.invalid\/member-checkout\/10909994\//);
  }
});
