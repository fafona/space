// Actual AdminClient and stores, synthetic identity/content/HTTP only.
// This checks behavior and deterministic work counts, not production latency.
import assert from "node:assert/strict";
import path from "node:path";
import { after, test } from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright";

const origin = "https://admin-startup.example.invalid";
const entry = `
import React from 'react';
import {createRoot} from 'react-dom/client';
import AdminClient from './src/app/admin/AdminClient';
import {I18nProvider} from './src/components/I18nProvider';
import {createDefaultMerchantPermissionConfig,createDefaultMerchantSortConfig} from './src/data/platformControlStore';
window.__startupProfile={id:'99990001',name:'Synthetic business',merchantName:'Synthetic business',
 domainPrefix:'startup-fixture',domain:'startup-fixture.example.invalid',industry:'娱乐',category:'娱乐',
 location:{country:'ES',province:'Madrid',city:'Madrid'},permissionConfig:createDefaultMerchantPermissionConfig(),
 sortConfig:createDefaultMerchantSortConfig(),status:'active',serviceExpiresAt:null,createdAt:'2026-01-01T00:00:00Z'};
const platform=new URLSearchParams(location.search).get('platform')==='1';
createRoot(document.getElementById('root')).render(<I18nProvider initialLocale="zh-CN">
 <AdminClient editorMode={platform?'platform':'merchant'} forcedScope={platform?'platform-home':'site-99990001'} forceDesktopEditorSidebar startInLoadingState/>
</I18nProvider>);
window.__startupEntryMounted=true;
`;
const bundled = await build({
  stdin: { contents: entry, loader: "tsx", resolveDir: process.cwd() },
  bundle: true, write: false, metafile: true, splitting: true, format: "esm", platform: "browser",
  outdir: path.resolve(".admin-startup-in-memory"), entryNames: "entry", chunkNames: "chunk-[hash]",
  jsx: "automatic", tsconfig: path.resolve("tsconfig.json"), logLevel: "silent",
  define: {
    "process.env": "{}", "process.env.NODE_ENV": JSON.stringify("production"),
    "process.env.NEXT_PUBLIC_SUPABASE_URL": JSON.stringify(origin),
    "process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY": JSON.stringify("synthetic-anon-key"),
    "process.env.NEXT_PUBLIC_SUPABASE_DISABLE_AUTO_REFRESH": JSON.stringify("1"),
  },
});
const assets = new Map(bundled.outputFiles.map((file) => ["/" + path.basename(file.path), Buffer.from(file.contents)]));
const initialOutputs = new Set();
function collectInitialOutputs(name) {
  if (initialOutputs.has(name)) return;
  initialOutputs.add(name);
  for (const dependency of bundled.metafile.outputs[name]?.imports ?? []) {
    if (dependency.kind === "import-statement" && !dependency.external) collectInitialOutputs(dependency.path);
  }
}
collectInitialOutputs(Object.keys(bundled.metafile.outputs).find(name => name.endsWith("/entry.js")));
const initialInputs = new Set([...initialOutputs].flatMap(name => Object.entries(bundled.metafile.outputs[name]?.inputs ?? {})
  .filter(([, contribution]) => contribution.bytesInOutput > 0).map(([input]) => input)));
const editorProcessingAssets = new Set(Object.entries(bundled.metafile.outputs)
  .filter(([, output]) => ["src/lib/editorAssetProcessing.ts", "src/lib/editorThemeProcessing.ts", "src/components/admin/InlineEditorBlock.tsx"]
    .some(input => output.inputs[input]?.bytesInOutput > 0)).map(([name]) => "/" + path.basename(name)));
test("actual admin initial import graph excludes deferred QR artwork and rendering engines", () => {
  for (const renderer of ["merchantBusinessCardQrIndustry", "merchantBusinessCardQrCraftedFrames",
    "merchantBusinessCardQrExpandedFrames", "merchantBusinessCardQrStudioAssets", "merchantBusinessCardQrDecorations", "merchantBusinessCardQr"]) {
    const source = `src/lib/${renderer}.ts`;
    assert.ok(Object.hasOwn(bundled.metafile.inputs, source), `${source} must remain available to deferred editors`);
    assert.equal(initialInputs.has(source), false, `${source} must not be fetched/parsed with the admin bootstrap`);
  }
  assert.ok(initialInputs.has("src/lib/merchantBusinessCardQrSettings.ts"));
});
const block = (id) => ({ id, type: "common", props: {
  commonTextBoxes: [{ id: "text-" + id, text: "Synthetic authored copy " + ".".repeat(500), x: 0, y: 0, width: 250, height: 30 }],
  blockHeight: 80,
} });
const config = (viewport) => ({ activePlanId: "plan-1", plans: Array.from({ length: 3 }, (_, plan) => ({
  id: `plan-${plan + 1}`, name: `Plan ${plan + 1}`, activePageId: "page-1",
  blocks: Array.from({ length: 20 }, (_, index) => block(`${viewport}-${plan}-0-${index}`)),
  pages: Array.from({ length: 3 }, (_, page) => ({
    id: `page-${page + 1}`, name: `Page ${page + 1}`,
    blocks: Array.from({ length: 20 }, (_, index) => block(`${viewport}-${plan}-${page}-${index}`)),
  })),
})) });
const blocks = [{ id: "__plan_meta__", type: "common", props: {
  pagePlanConfig: config("pc"), pagePlanConfigMobile: config("mobile"),
} }, ...Array.from({ length: 20 }, (_, index) => block(`pc-0-0-${index}`))];
const originalBlocks = structuredClone(blocks);
let browser;
after(async () => { await browser?.close(); });
const gate = () => {
  let release;
  const promise = new Promise((resolve) => { release = resolve; });
  return { promise, release };
};

async function setup({ editorOnly = false, platform = false, holdSession = false, holdDraft = false } = {}) {
  browser ??= await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: "block" });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const state = { errors: [], unexpected: [], writes: [], requests: [], sourceWindowEditorAssets: [], session: gate(), draft: gate() };
  if (!holdSession) state.session.release();
  if (!holdDraft) state.draft.release();
  await context.addInitScript(() => {
    window.__startupClones = 0;
    const original = window.structuredClone;
    window.structuredClone = function (...args) { window.__startupClones += 1; return original.apply(this, args); };
  });
  page.on("pageerror", (error) => state.errors.push(error.message));
  context.on("page", opened => { if (opened !== page) opened.on("pageerror", error => state.errors.push(error.message)); });
  await context.route("**/*", async (route) => {
    const request = route.request(), url = new URL(request.url());
    state.requests.push(url.pathname);
    if (editorProcessingAssets.has(url.pathname) && request.frame().page() === page) state.sourceWindowEditorAssets.push(url.pathname);
    if (url.origin !== origin) { state.unexpected.push(request.method() + " " + url.href); return route.abort(); }
    if (request.isNavigationRequest()) return route.fulfill({ contentType: "text/html", body:
      '<!doctype html><meta charset="utf-8"><div id="root"></div><script type="module" src="/entry.js"></script>' });
    if (assets.has(url.pathname)) return route.fulfill({ contentType: url.pathname.endsWith(".css") ? "text/css" : "text/javascript", body: assets.get(url.pathname) });
    if (request.resourceType() === "image") return route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="60"/>' });
    if (request.method() !== "GET") {
      state.writes.push(url.pathname);
      return route.fulfill({ status: 403, json: { error: "synthetic_writes_disabled" } });
    }
    if (url.pathname === "/api/auth/merchant-session") {
      await state.session.promise;
      return route.fulfill({ json: { authenticated: true, merchantId: "99990001", merchantIds: ["99990001"], user: { id: "synthetic-owner", email: "owner@example.invalid" } } });
    }
    if (url.pathname === "/api/merchant-chat-business-card") return route.fulfill({ json: { profile: await page.evaluate(() => window.__startupProfile), chatBusinessCard: null } });
    if (url.pathname === "/api/merchant-draft") {
      await state.draft.promise;
      return route.fulfill({ json: { ok: true, siteId: "99990001", blocks, updatedAt: "2026-01-01T00:00:00Z" } });
    }
    if (url.pathname === "/api/site-published") return route.fulfill({ json: { siteId: "99990001", blocks, merchantName: "Synthetic business", slug: "startup-fixture" } });
    if (platform && url.pathname === "/api/platform-published") return route.fulfill({ json: { blocks: [], updatedAt: null } });
    if (platform && url.pathname === "/rest/v1/pages") return route.fulfill({ json: [] });
    if (url.pathname === "/api/app-web-version") return route.fulfill({ json: { ok: true, buildId: "synthetic-startup" } });
    if (url.pathname === "/downloads/faolla-android-version.json") return route.fulfill({ json: { enabled: false } });
    if (["/api/bookings", "/api/orders"].includes(url.pathname)) return route.fulfill({ json: { ok: true, bookings: [], orders: [] } });
    if (["/api/support-messages", "/api/merchant-peer-messages"].includes(url.pathname)) return route.fulfill({ json: { ok: true, messages: [], contacts: [], unreadCount: 0 } });
    if (["/auth/v1/settings", "/rest/v1/"].includes(url.pathname)) return route.fulfill({ json: {} });
    state.unexpected.push(request.method() + " " + url.pathname);
    return route.abort();
  });
  await page.goto(origin + "/99990001" + (platform ? "?platform=1" : editorOnly ? "?editorOnly=1" : ""), { waitUntil: "commit" });
  await page.waitForFunction(() => window.__startupEntryMounted === true);
  return { page, state, async close() {
    state.session.release(); state.draft.release();
    await context.close();
    assert.deepEqual(state.errors, []);
    assert.deepEqual(state.unexpected, []);
    assert.deepEqual(state.writes, [], "startup must not submit user changes");
    assert.deepEqual(blocks, originalBlocks, "fixture draft content must remain unchanged");
  } };
}

test("merchant workspace startup remains interactive without hidden template-preview work", async () => {
  const fixture = await setup();
  try {
    await fixture.page.getByRole("button", { name: "商户信息", exact: true }).waitFor();
    await fixture.page.waitForTimeout(500);
    assert.ok(await fixture.page.getByRole("button", { name: "商户信息", exact: true }).isEnabled());
    const clones = await fixture.page.evaluate(() => window.__startupClones);
    assert.ok(clones > 0 && clones < 1000, `unexpected startup deep-copy work: ${clones}`);
    assert.equal(await fixture.page.locator('[data-block-id^="pc-"]').count(), 0, "business landing must not mount the editor");
  } finally { await fixture.close(); }
});

test("editor waits for identity and cloud draft, then restores separate PC/mobile pages", async () => {
  const fixture = await setup({ editorOnly: true, holdSession: true, holdDraft: true });
  const { page, state } = fixture;
  try {
    await page.waitForTimeout(300);
    assert.ok(state.requests.includes("/api/auth/merchant-session"));
    assert.equal(await page.locator("[data-editor-toolbar]").count(), 0, "unverified identity must not expose editor controls");
    state.session.release();
    await page.waitForFunction(() => document.body.innerText.includes("FAOLLA"));
    await page.waitForTimeout(300);
    assert.equal(await page.locator("[data-editor-toolbar]").count(), 0, "cloud draft must still gate the editor");
    state.draft.release();
    await page.locator('[data-block-id="pc-0-0-0"]').first().waitFor();
    await page.waitForTimeout(500);
    const clones = await page.evaluate(() => window.__startupClones);
    assert.ok(clones > 0 && clones < 1000, `unexpected editor startup deep-copy work: ${clones}`);
    await page.getByRole("button", { name: "手机", exact: true }).click();
    await page.locator('[data-block-id="mobile-0-0-0"]').first().waitFor();
    await page.locator('select:has(option[value="page-3"])').selectOption("page-3");
    await page.locator('[data-block-id="mobile-0-2-0"]').first().waitFor();
    await page.getByRole("button", { name: "PC", exact: true }).click();
    await page.locator('[data-block-id="pc-0-0-0"]').first().waitFor();
    await page.locator('select:has(option[value="page-2"])').selectOption("page-2");
    await page.locator('[data-block-id="pc-0-1-0"]').first().waitFor();
  } finally { await fixture.close(); }
});

test("opening a separate website editor does not also initialize editor engines in the old workspace", async () => {
  const fixture = await setup();
  try {
    await fixture.page.getByRole("button", { name: "网站编辑", exact: true }).waitFor();
    const popupPromise = fixture.page.waitForEvent("popup");
    await fixture.page.getByRole("button", { name: "网站编辑", exact: true }).click();
    const popup = await popupPromise;
    assert.equal(new URL(popup.url()).searchParams.get("editorOnly"), "1");
    await popup.locator('[data-block-id="pc-0-0-0"]').first().waitFor();
    await popup.getByRole("button", { name: "手机", exact: true }).click();
    await popup.locator('[data-block-id="mobile-0-0-0"]').first().waitFor();
    assert.ok(editorProcessingAssets.size > 0);
    assert.deepEqual(fixture.state.sourceWindowEditorAssets, [], "editor-only modules must execute in their destination, not both windows");
  } finally { await fixture.close(); }
});

test("platform template dialog still computes and displays built-ins when opened", async () => {
  const fixture = await setup({ platform: true });
  try {
    await fixture.page.getByRole("button", { name: "方案模板", exact: true }).click();
    await fixture.page.getByPlaceholder("搜索方案名称 / 来源网站 / 域名前缀 / 分类").waitFor();
    assert.equal(await fixture.page.locator("[data-editor-overlay] article").count(), 3);
    assert.match(await fixture.page.locator("[data-editor-overlay]").innerText(), /共 3 个方案/);
    await fixture.page.getByPlaceholder("搜索方案名称 / 来源网站 / 域名前缀 / 分类").fill("no-matching-template-83921");
    assert.equal(await fixture.page.locator("[data-editor-overlay] article").count(), 0);
    await fixture.page.getByPlaceholder("搜索方案名称 / 来源网站 / 域名前缀 / 分类").fill("");
    assert.equal(await fixture.page.locator("[data-editor-overlay] article").count(), 3);
    await fixture.page.locator("[data-editor-overlay]").getByRole("button", { name: "关闭", exact: true }).click();
    assert.equal(await fixture.page.locator("[data-editor-overlay]").count(), 0);
  } finally { await fixture.close(); }
});
