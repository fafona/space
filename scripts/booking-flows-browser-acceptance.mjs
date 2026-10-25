import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright";

// Actual components, synthetic data only. Every network request is intercepted
// BEFORE navigation; any unexpected origin/path is rejected and fails the case.
async function bundle() {
  const mocks = {
    "next/navigation": "export const useSearchParams=()=>window.__stableSearch;",
    "@/components/I18nProvider": "export const useI18n=()=>({locale:'zh-CN'});",
    "@/components/PublicTrafficProvider": "export const usePublicTraffic=()=>null;export const usePublicTrafficExposure=()=>{};",
    "@/lib/authSessionRecovery": "export const resolveFrontendAuthPayload=async()=>({authenticated:false});",
    "@/lib/personalConsumptionBridge": "export const notifyPersonalConsumptionChanged=()=>{};",
    "@/lib/personalGuestSession": "export const readPersonalGuestMergeToken=()=>'';export const upsertPersonalGuestBooking=(booking)=>{window.__recoveredGuestBooking=booking;};",
    "@/lib/performanceTelemetry": "export const fetchWithAdminPerformance=(path,init)=>fetch(path,init);",
  };
  const plugin = { name: "booking-acceptance-io", setup(b) {
    b.onResolve({ filter: /^(next\/navigation|@\/components\/(I18nProvider|PublicTrafficProvider)|@\/lib\/(authSessionRecovery|personalConsumptionBridge|personalGuestSession|performanceTelemetry))$/ }, (args) => ({ path: args.path, namespace: "synthetic" }));
    b.onLoad({ filter: /.*/, namespace: "synthetic" }, (args) => ({ contents: mocks[args.path], loader: "js" }));
  } };
  return (await build({ stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';
    import Public from './src/components/blocks/BookingBlock';
    import Desktop from './src/components/admin/MerchantBookingManagerDialog';
    import Mobile from './src/components/admin/MerchantBookingMobilePanel';
    window.__stableSearch=new URLSearchParams(location.search);
    const props={siteId:'99999999',siteName:'Synthetic',siteCountryCode:'ES',storeOptions:['Store'],itemOptions:['Consultation'],titleOptions:['Mx'],onClose:()=>{}};
    createRoot(document.getElementById('root')).render(window.__view==='public'?<Public runtimeSiteId='99999999' runtimeBlockId='one' runtimeViewport='desktop' interactive bookingStoreOptions={['Store']} bookingItemOptions={['Consultation']} bookingTitleOptions={['Mx']}/>:window.__view==='mobile'?<Mobile {...props}/>:<Desktop {...props} open mode='inline' showCloseButton={false}/>);`,
    loader: "tsx", resolveDir: process.cwd() }, bundle: true, platform: "browser", format: "iife", write: false, logLevel: "silent",
    define: { "process.env": "{}" }, plugins: [plugin] })).outputFiles[0].text;
}
const html = '<!doctype html><html><head><meta charset="utf-8"><style>body{font-family:Arial,sans-serif}button{padding:6px;margin:4px}input,textarea{border:1px solid #bbb}textarea{min-height:80px}</style></head><body><div id="root"></div></body></html>';
const fixture = (id, name) => ({ id, siteId: "99999999", siteName: "Synthetic", bookingBlockId: "one", bookingViewport: "desktop", status: "active",
  customerName: name, email: "customer@example.invalid", phone: "000", store: "Store", item: "Consultation", title: "Mx", note: "saved note",
  appointmentAt: "2030-02-01T10:00", appointmentTimeZone: "Europe/Madrid", createdAt: "2026-10-25T00:00:00Z", updatedAt: "2026-10-25T00:00:00Z", merchantTouchedAt: "2026-10-25T00:00:00Z", customerEmailLogs: [], timeline: [] });

test("public reservation recovers an uncertain submission on retry and reload without creating another booking", { timeout: 90000 }, async () => {
  const script = await bundle(), browser = await chromium.launch({ headless: true });
  try {
    for (const recovery of ["retry", "reload"]) {
      const context = await browser.newContext(), page = await context.newPage(), errors = [], unexpected = [], creates = [], lookups = [];
      let booking = null;
      page.on("pageerror", (error) => errors.push(error.message));
      await context.route("**/*", async (route) => {
        const request = route.request(), url = new URL(request.url());
        if (url.origin !== "https://booking-audit.invalid") { unexpected.push(request.url()); return route.abort(); }
        if (request.isNavigationRequest()) return route.fulfill({ contentType: "text/html", body: html });
        if (url.pathname === "/api/bookings/workbench/public") return route.fulfill({ json: { ok: true, settings: { timeZone: "Europe/Madrid" } } });
        if (url.pathname === "/api/bookings" && request.method() === "POST") {
          const body = request.postDataJSON();
          if (body.lookupRequest) { lookups.push(body); assert.equal(body.requestNonce, creates[0].requestNonce); return route.fulfill({ json: { ok: true, found: Boolean(booking), booking, editToken: "synthetic-private-token" } }); }
          creates.push(body); booking = { ...fixture("recovered", "Synthetic Customer"), ...body };
          return route.abort("failed"); // Simulate commit succeeded but the response was lost.
        }
        unexpected.push(request.url()); return route.abort();
      });
      await page.goto("https://booking-audit.invalid/site/99999999");
      await page.evaluate(() => { window.__view = "public"; });
      await page.addScriptTag({ content: script });
      await page.getByLabel("姓名", { exact: true }).fill("Synthetic Customer");
      await page.getByLabel("邮箱", { exact: true }).fill("customer@example.invalid");
      await page.getByLabel("电话", { exact: true }).fill("000");
      await page.getByPlaceholder("YYYY-MM-DD").fill("2030-02-01");
      await page.getByPlaceholder("HH:MM").fill("10:00");
      await page.getByRole("button", { name: "提交预约", exact: true }).click();
      await page.getByText(/Failed to fetch|预约提交失败/).waitFor();
      assert.equal(creates.length, 1);
      assert.match(creates[0].requestNonce, /^[0-9a-f-]{36}$/i);
      const metadata = await page.evaluate(() => Object.entries(sessionStorage).filter(([key]) => key.startsWith("faolla-booking-submit-v1:")).map(([, value]) => value).join(""));
      assert.equal(metadata.includes("Synthetic Customer"), false); assert.equal(metadata.includes("customer@example.invalid"), false);
      if (recovery === "reload") {
        await page.reload(); await page.evaluate(() => { window.__view = "public"; }); await page.addScriptTag({ content: script });
      } else await page.getByRole("button", { name: "提交预约", exact: true }).click();
      await page.getByText("预约提交成功", { exact: true }).waitFor();
      assert.equal(creates.length, 1); assert.ok(lookups.length >= 1);
      assert.equal(await page.evaluate(() => window.__recoveredGuestBooking?.id), "recovered");
      assert.equal(new URL(page.url()).hash, ""); assert.deepEqual(errors, []); assert.deepEqual(unexpected, []);
      await context.close();
    }
  } finally { await browser.close(); }
});

test("desktop and mobile pagination retain edited drafts and show persistent stale-cache warnings", { timeout: 90000 }, async () => {
  const script = await bundle(), browser = await chromium.launch({ headless: true });
  try {
    for (const view of ["desktop", "mobile"]) {
      const context = await browser.newContext({ viewport: view === "mobile" ? { width: 390, height: 844 } : { width: 1280, height: 900 } });
      const page = await context.newPage(), unexpected = [], errors = [], offsets = [];
      const first = fixture("one", "Synthetic One"), second = fixture("two", "Synthetic Two");
      let offline = false;
      page.on("pageerror", (error) => errors.push(error.message));
      await context.route("**/*", async (route) => {
        const request = route.request(), url = new URL(request.url());
        if (url.origin !== "https://booking-audit.invalid") { unexpected.push(request.url()); return route.abort(); }
        if (request.isNavigationRequest()) return route.fulfill({ contentType: "text/html", body: html });
        if (url.pathname === "/api/bookings/workbench") return route.fulfill({ json: { ok: true, settings: {} } });
        if (url.pathname === "/api/merchant-admin/manager-preferences") return route.fulfill({ json: { ok: true, preferences: {} } });
        if (url.pathname === "/api/bookings" && request.method() === "GET") {
          if (offline) return route.fulfill({ status: 503, json: { message: "synthetic-offline" } });
          const offset = Number(url.searchParams.get("offset")); offsets.push(offset);
          return route.fulfill({ json: { ok: true, bookings: offset === 0 ? [first] : [second], offset, hasMore: offset === 0 } });
        }
        unexpected.push(`${request.method()} ${request.url()}`); return route.abort();
      });
      await page.goto("https://booking-audit.invalid/admin");
      await page.evaluate((value) => { window.__view = value; }, view); await page.addScriptTag({ content: script });
      const card = (name) => page.locator("article").filter({ hasText: name });
      await card("Synthetic One").getByRole("button", { name: "详情", exact: true }).click();
      await page.locator("textarea").fill("UNSAVED draft");
      await page.getByRole("button", { name: "关闭", exact: true }).click();
      await page.getByRole("button", { name: "显示更多", exact: true }).click();
      await card("Synthetic Two").waitFor();
      await card("Synthetic One").getByRole("button", { name: "详情", exact: true }).click();
      assert.equal(await page.locator("textarea").inputValue(), "UNSAVED draft");
      await page.getByRole("button", { name: "关闭", exact: true }).click();
      assert.deepEqual(offsets, [0, 1]);
      const schedule = page.locator("details").filter({ hasText: "日／周排期概览" });
      await schedule.locator("summary").click();
      await page.getByLabel("排期日期", { exact: true }).fill("2030-02-01");
      await page.getByLabel("排期视图", { exact: true }).selectOption("day");
      await schedule.getByText("2 条预约", { exact: true }).waitFor();
      await schedule.getByRole("button", { name: /10:00.*Consultation/ }).first().click();
      assert.equal(await page.locator("textarea").inputValue(), "UNSAVED draft");
      await page.getByRole("button", { name: "关闭", exact: true }).click();
      await page.getByLabel("排期视图", { exact: true }).selectOption("week");
      assert.equal(await schedule.locator("section").count(), 7);
      await schedule.locator("summary").click();
      if (view === "desktop") {
        await card("Synthetic Two").getByRole("button", { name: "详情", exact: true }).click();
        await page.locator("textarea").fill("OFF-PAGE draft"); await page.getByRole("button", { name: "关闭", exact: true }).click();
        await page.getByRole("button", { name: "重新同步", exact: true }).click();
        await page.getByText("已保留不在当前页中的未保存草稿，保存前请核对。", { exact: true }).waitFor();
        await card("Synthetic Two").getByRole("button", { name: "详情", exact: true }).click();
        assert.equal(await page.locator("textarea").inputValue(), "OFF-PAGE draft"); await page.getByRole("button", { name: "关闭", exact: true }).click();
        await page.getByRole("button", { name: "显示更多", exact: true }).click();
        await page.waitForFunction(() => !document.body.innerText.includes("加载中"));
        assert.deepEqual(offsets, [0, 1, 0, 1]);
      }
      offline = true;
      await page.reload(); await page.evaluate((value) => { window.__view = value; }, view); await page.addScriptTag({ content: script });
      await page.getByRole("status").filter({ hasText: "同步失败" }).waitFor();
      await card("Synthetic One").waitFor();
      assert.deepEqual(errors, []); assert.deepEqual(unexpected, []);
      await context.close();
    }
  } finally { await browser.close(); }
});
