import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import path from "node:path";
import ts from "typescript";
import { isMemberCheckoutPilotEnabled } from "./merchantMemberCheckoutPilot.server";
import { isMemberCheckoutOnSitePilotEnabled } from "./merchantCheckoutOnSitePilot.server";
import { isMemberCheckoutIntentPilotEnabled } from "./merchantCheckoutCartPilot.server";
import { parseCheckoutStartQuery, buildCheckoutStartHref } from "./merchantCheckoutClient";
import { buildOnSiteCheckoutStartHref } from "./merchantCheckoutOnSiteClient";
const siteId = "10909994", requireRepo = createRequire(path.resolve("package.json")), missing = new Error("synthetic-not-found");
test("both actual single pages keep legacy gates but only select the new coordinator under the full server intent gate, with fixed canonical navigation", async () => {
  for (const cash of [false, true]) {
    const env = Object.fromEntries(["MERCHANT_MEMBER_CHECKOUT_PILOT_SITES", "MERCHANT_MEMBER_CHECKOUT_ON_SITE_PILOT_SITES", "MERCHANT_MEMBER_CHECKOUT_CART_PILOT_SITES", "MERCHANT_MEMBER_CHECKOUT_CART_UI_PILOT_SITES", "MERCHANT_MEMBER_CHECKOUT_INTENT_PILOT_SITES"].map(k => [k, siteId]));
    let canonical = true, headerReads = 0; const redirected: string[] = [], sandboxModule = { exports: {} as { default: (p: unknown) => Promise<{ props: { intentEnabled: boolean } }> } };
    const query = { offerId: "11111111-1111-4111-8111-111111111111", offerRevision: "22222222-2222-4222-8222-222222222222", quantity: "1", uiLocale: "es-ES" };
    const mocks: Record<string, unknown> = { "next/navigation": { notFound: () => { throw missing; }, redirect: (url: string) => { redirected.push(url); throw Error("synthetic-redirect"); } },
      "next/headers": { headers: async () => { headerReads++; return new Headers(); } }, "@/lib/canonicalPortalRequest": { isCanonicalPortalRequest: () => canonical, resolveCanonicalPortalOrigin: () => "https://portal.synthetic.invalid" },
      "@/lib/merchantMemberCheckoutPilot.server": { isMemberCheckoutPilotEnabled: (s: string) => isMemberCheckoutPilotEnabled(s, env) },
      "@/lib/merchantCheckoutOnSitePilot.server": { isMemberCheckoutOnSitePilotEnabled: (s: string) => isMemberCheckoutOnSitePilotEnabled(s, env) },
      "@/lib/merchantCheckoutCartPilot.server": { isMemberCheckoutIntentPilotEnabled: (s: string) => isMemberCheckoutIntentPilotEnabled(s, env) },
      "@/lib/merchantCheckoutClient": { parseCheckoutStartQuery, buildCheckoutStartHref }, "@/lib/merchantCheckoutOnSiteClient": { buildOnSiteCheckoutStartHref }, "./CheckoutStartClient": () => null, "../../start/CheckoutStartClient": () => null };
    const file = path.resolve(`src/app/member-checkout/[siteId]/${cash ? "on-site/" : ""}start/page.tsx`), compiled = ts.transpileModule(await readFile(file, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    runInNewContext(compiled, { module: sandboxModule, exports: sandboxModule.exports, require: (name: string) => Object.hasOwn(mocks, name) ? mocks[name] : requireRepo(name), Request, URL }, { filename: file });
    const run = (q: Record<string, unknown> = query) => sandboxModule.exports.default({ params: Promise.resolve({ siteId }), searchParams: Promise.resolve(q) });
    assert.equal((await run()).props.intentEnabled, true); canonical = false; await assert.rejects(run(), /synthetic-redirect/);
    assert.equal(redirected[0], `https://portal.synthetic.invalid${cash ? buildOnSiteCheckoutStartHref(parseCheckoutStartQuery(siteId, query), "es-ES") : buildCheckoutStartHref(parseCheckoutStartQuery(siteId, query), "es-ES")}`);
    for (const patch of [{ accountId: "50010105" }, { returnTo: "https://foreign.invalid" }, { paid: "true" }]) await assert.rejects(run({ ...query, ...patch }), e => e === missing);
    const reads = headerReads; env.MERCHANT_MEMBER_CHECKOUT_INTENT_PILOT_SITES = ""; assert.equal((await run()).props.intentEnabled, false); assert.equal(headerReads, reads);
    env.MERCHANT_MEMBER_CHECKOUT_PILOT_SITES = ""; await assert.rejects(run(), e => e === missing);
  }
});
