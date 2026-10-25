import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright";

// Synthetic-only browser verification of the real management page. Network is
// intercepted before navigation; unexpected destinations fail the test.
test("booking manager works across devices, protects locked records and retains failed drafts", { timeout: 90000 }, async () => {
  const bundle = await build({ stdin: {
    contents: "import React from 'react';import{createRoot}from'react-dom/client';import Page from './src/app/booking-manage/page';createRoot(document.getElementById('root')).render(<Page/>);",
    loader: "tsx", resolveDir: process.cwd(),
  }, bundle: true, platform: "browser", format: "iife", write: false, logLevel: "silent", define: { "process.env": "{}" } });
  const browser = await chromium.launch({ headless: true });
  try {
    for (const scenario of [
      { source: "desktop", target: "mobile", status: "active", touched: "" },
      { source: "mobile", target: "desktop", status: "active", touched: "" },
      { source: "desktop", target: "mobile", status: "completed", touched: "" },
      { source: "mobile", target: "desktop", status: "active", touched: "2026-10-25T00:00:00Z" },
      { source: "desktop", target: "mobile", status: "cancelled", touched: "" },
      { source: "desktop", target: "mobile", status: "invalid", touched: "" },
    ]) {
      const context = await browser.newContext({ viewport: scenario.target === "mobile" ? { width: 390, height: 844 } : { width: 1280, height: 900 } });
      const page = await context.newPage(), errors = [], unexpected = [], requests = [];
      let rejectUpdate = false;
      let booking = { id: "synthetic-ui-booking", siteId: "99999999", siteName: "Synthetic", bookingBlockId: "original-block", bookingViewport: scenario.source,
        status: scenario.status, merchantTouchedAt: scenario.touched, store: "Store", item: "Consultation", title: "Mx", customerName: "Synthetic",
        email: "synthetic@example.invalid", phone: "000", note: "", appointmentAt: "2030-02-01T10:00", appointmentTimeZone: "Europe/Madrid" };
      page.on("pageerror", (failure) => errors.push(failure.message));
      await context.route("**/*", async (route) => {
        const request = route.request(), url = new URL(request.url());
        if (url.origin !== "https://booking-audit.invalid") { unexpected.push(request.url()); return route.abort(); }
        if (request.isNavigationRequest()) return route.fulfill({ contentType: "text/html", body: '<!doctype html><html><head><meta name="referrer" content="no-referrer"></head><body><div id="root"></div></body></html>' });
        if (url.pathname === "/api/bookings/self-service") {
          assert.equal(url.search, "");
          assert.deepEqual(request.postDataJSON(), { bookingId: booking.id, editToken: "synthetic-token" });
          if (scenario.status === "invalid") return route.fulfill({ status: 400, json: { ok: false, message: "Invalid synthetic link" } });
          return route.fulfill({ json: { ok: true, booking, rule: { storeOptions: ["Store", "Branch"], itemOptions: ["Consultation"], titleOptions: ["Mx"] }, settings: { timeZone: "Europe/Madrid" } } });
        }
        if (url.pathname === "/api/bookings" && request.method() === "PATCH") {
          const body = request.postDataJSON(); requests.push(body);
          assert.equal(body.bookingId, booking.id); assert.equal(body.editToken, "synthetic-token");
          assert.equal(body.siteId, undefined); assert.equal(body.bookingViewport, undefined);
          if (rejectUpdate) return route.fulfill({ status: 400, json: { ok: false, message: "Synthetic capacity full" } });
          booking = { ...booking, ...(body.updates ?? {}), status: body.action === "cancel" ? "cancelled" : "active" };
          return route.fulfill({ json: { ok: true, booking } });
        }
        unexpected.push(request.url()); return route.abort();
      });
      await page.goto(`https://booking-audit.invalid/booking-manage#bookingId=${booking.id}&editToken=synthetic-token&bookingViewport=${scenario.source}`);
      await page.addScriptTag({ content: bundle.outputFiles[0].text });
      if (scenario.status === "invalid") {
        await page.getByRole("alert").filter({ hasText: "Invalid synthetic link" }).waitFor();
        assert.equal(await page.getByRole("button", { name: "修改预约", exact: true }).count(), 0);
      } else {
        await page.getByText(`预约编号：${booking.id}`, { exact: true }).waitFor();
        const editable = !scenario.touched && ["active", "cancelled"].includes(scenario.status);
        assert.equal(await page.getByRole("button", { name: "修改预约", exact: true }).isEnabled(), editable);
        assert.equal(await page.getByRole("button", { name: "取消预约", exact: true }).isEnabled(), !scenario.touched && scenario.status === "active");
        if (editable) {
          await page.getByRole("button", { name: "修改预约", exact: true }).click();
          await page.getByLabel("姓名").fill("Changed synthetic");
          rejectUpdate = true;
          await page.getByRole("button", { name: /保存修改|重新提交预约/ }).click();
          await page.getByRole("alert").filter({ hasText: "Synthetic capacity full" }).waitFor();
          assert.equal(await page.getByLabel("姓名").inputValue(), "Changed synthetic");
          rejectUpdate = false;
          await page.getByRole("button", { name: /保存修改|重新提交预约/ }).click();
          await page.getByRole("status").filter({ hasText: /预约已更新|预约已重新提交/ }).waitFor();
          page.once("dialog", (dialog) => dialog.accept());
          await page.getByRole("button", { name: "取消预约", exact: true }).click();
          await page.getByRole("status").filter({ hasText: "预约已取消" }).waitFor();
          assert.equal(requests.length, 3);
        }
      }
      assert.equal(new URL(page.url()).hash, "");
      assert.equal(new URL(page.url()).search, "");
      assert.deepEqual(errors, []); assert.deepEqual(unexpected, []);
      await context.close();
    }
  } finally { await browser.close(); }
});

test("legacy booking block links redirect across viewports without losing credentials", { timeout: 90000 }, async () => {
  const mocks = {
    "next/navigation": "export const useSearchParams=()=>window.__stableSearch;",
    "@/components/I18nProvider": "export const useI18n=()=>({locale:'zh-CN'});",
    "@/components/PublicTrafficProvider": "export const usePublicTraffic=()=>null;export const usePublicTrafficExposure=()=>{};",
    "@/lib/authSessionRecovery": "export const resolveFrontendAuthPayload=async()=>({authenticated:false});",
    "@/lib/personalConsumptionBridge": "export const notifyPersonalConsumptionChanged=()=>{};",
    "@/lib/personalGuestSession": "export const readPersonalGuestMergeToken=()=>'';export const upsertPersonalGuestBooking=()=>{};",
  };
  const mockPlugin = { name: "synthetic-booking-io", setup(b) {
    b.onResolve({ filter: /^(next\/navigation|@\/components\/(I18nProvider|PublicTrafficProvider)|@\/lib\/(authSessionRecovery|personalConsumptionBridge|personalGuestSession))$/ }, (args) => ({ path: args.path, namespace: "synthetic" }));
    b.onLoad({ filter: /.*/, namespace: "synthetic" }, (args) => ({ contents: mocks[args.path], loader: "js" }));
  } };
  const bundle = await build({ stdin: { contents:
    "import React from 'react';import{createRoot}from'react-dom/client';import Block from './src/components/blocks/BookingBlock';window.__stableSearch=new URLSearchParams(location.search);createRoot(document.getElementById('root')).render(<Block runtimeSiteId='99999999' runtimeBlockId='same-block' runtimeViewport={window.__target} interactive={true} bookingStoreOptions={['Store']} bookingItemOptions={['Consultation']} bookingTitleOptions={['Mx']}/>);",
    loader: "tsx", resolveDir: process.cwd() }, bundle: true, platform: "browser", format: "iife", write: false, define: { "process.env": "{}" }, plugins: [mockPlugin], logLevel: "silent" });
  const browser = await chromium.launch({ headless: true });
  try {
    for (const [source, target] of [["desktop", "mobile"], ["mobile", "desktop"]]) {
      const context = await browser.newContext(), page = await context.newPage(), unexpected = [], errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await context.route("**/*", async (route) => {
        const request = route.request(), url = new URL(request.url());
        if (url.origin !== "https://booking-audit.invalid") { unexpected.push(request.url()); return route.abort(); }
        if (request.isNavigationRequest()) return route.fulfill({ contentType: "text/html", body: '<!doctype html><html><body><div id="root"></div></body></html>' });
        if (url.pathname === "/api/bookings/workbench/public") return route.fulfill({ json: { ok: true, settings: {} } });
        unexpected.push(request.url()); return route.abort();
      });
      await page.goto(`https://booking-audit.invalid/site/99999999#bookingId=test-1&editToken=synthetic-token&bookingBlockId=same-block&bookingViewport=${source}`);
      await page.evaluate((value) => { window.__target = value; }, target);
      await page.addScriptTag({ content: bundle.outputFiles[0].text });
      await page.waitForURL(/\/booking-manage#/);
      const result = new URL(page.url());
      assert.equal(result.pathname, "/booking-manage"); assert.equal(result.search, "");
      const params = new URLSearchParams(result.hash.slice(1));
      assert.equal(params.get("bookingId"), "test-1"); assert.equal(params.get("editToken"), "synthetic-token");
      assert.deepEqual(unexpected, []); assert.deepEqual(errors, []);
      await context.close();
    }
  } finally { await browser.close(); }
});
