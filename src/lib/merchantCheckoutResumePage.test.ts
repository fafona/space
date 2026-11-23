import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import path from "node:path";
import ts from "typescript";
import { isMemberCheckoutIntentPilotEnabled } from "./merchantCheckoutCartPilot.server";
import { isCanonicalPortalRequest } from "./canonicalPortalRequest";
import { buildCheckoutResumeHref } from "./merchantCheckoutResumeClient";
const siteId = "10909994", notFound = new Error("synthetic-not-found"), requireRepo = createRequire(path.resolve("package.json"));
async function fixture() {
  const file = path.resolve("src/app/member-checkout/[siteId]/resume/page.tsx"), env: Record<string, string> = Object.fromEntries(["MERCHANT_MEMBER_CHECKOUT_PILOT_SITES", "MERCHANT_MEMBER_CHECKOUT_CART_PILOT_SITES", "MERCHANT_MEMBER_CHECKOUT_CART_UI_PILOT_SITES", "MERCHANT_MEMBER_CHECKOUT_INTENT_PILOT_SITES"].map(k => [k, siteId]));
  let canonical = true; const redirects: string[] = [], sandboxModule = { exports: {} as { default: (props: unknown) => Promise<{ props: unknown }>; metadata: { robots: unknown; referrer: string }; dynamic: string; revalidate: number } };
  const mocks: Record<string, unknown> = { "next/navigation": { notFound: () => { throw notFound; }, redirect: (url: string) => { redirects.push(url); throw new Error("synthetic-redirect"); } },
    "next/headers": { headers: async () => new Headers({ host: canonical ? "www.faolla.com" : "merchant.faolla.com" }) },
    "@/lib/merchantCheckoutCartPilot.server": { isMemberCheckoutIntentPilotEnabled: (site: string) => isMemberCheckoutIntentPilotEnabled(site, env) },
    "@/lib/canonicalPortalRequest": { isCanonicalPortalRequest: (request: Request) => isCanonicalPortalRequest(request), resolveCanonicalPortalOrigin: () => "https://www.faolla.com" },
    "@/lib/merchantCheckoutResumeClient": { buildCheckoutResumeHref }, "./CheckoutResumeClient": () => null };
  const compiled = ts.transpileModule(await readFile(file, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  runInNewContext(compiled, { module: sandboxModule, exports: sandboxModule.exports, require: (name: string) => Object.hasOwn(mocks, name) ? mocks[name] : requireRepo(name), Request, URL }, { filename: file });
  return { env, page: sandboxModule.exports, redirects, merchant: () => { canonical = false; }, run: (query: unknown = { uiLocale: "es-ES" }, id = siteId) => sandboxModule.exports.default({ params: Promise.resolve({ siteId: id }), searchParams: Promise.resolve(query) }) };
}
test("actual resume page requires the existing full gate and accepts only a site/optional language, never browser authority", async () => {
  const x = await fixture(); assert.deepEqual(JSON.parse(JSON.stringify((await x.run()).props)), { siteId }); assert.equal(x.page.dynamic, "force-dynamic"); assert.equal(x.page.revalidate, 0); assert.equal(x.page.metadata.referrer, "no-referrer");
  for (const query of [{ accountId: "50010105" }, { nonce: "private" }, { returnTo: "https://foreign.invalid" }, { uiLocale: ["es-ES"] }, { uiLocale: "es_ES" }, { uiLocale: "a".repeat(41) }]) await assert.rejects(x.run(query), e => e === notFound);
  await assert.rejects(x.run({}, "bad"), e => e === notFound); assert.deepEqual(x.redirects, []);
  for (const key of Object.keys(x.env)) { const old = x.env[key]; x.env[key] = ""; await assert.rejects(x.run(), e => e === notFound); x.env[key] = old; }
});
test("merchant-host page redirects only to configured platform origin without passing account/nonce or forcing an absent language", async () => {
  const x = await fixture(); x.merchant(); await assert.rejects(x.run(), /synthetic-redirect/); assert.equal(x.redirects[0], `https://www.faolla.com/member-checkout/${siteId}/resume?uiLocale=es-ES`);
  await assert.rejects(x.run({}), /synthetic-redirect/); assert.equal(x.redirects[1], `https://www.faolla.com/member-checkout/${siteId}/resume`);
  await assert.rejects(x.run({ uiLocale: "es-ES", origin: "https://foreign.invalid" }), e => e === notFound); assert.equal(x.redirects.length, 2);
});
