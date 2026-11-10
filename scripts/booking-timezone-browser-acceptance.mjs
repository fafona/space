import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { chromium } from "playwright";

// Actual workbench + picker + generated CSS. Synthetic data only; every request
// is intercepted before navigation, unexpected IO fails the case.
let compiled;
async function assets() {
  if (!compiled) compiled = (async () => {
    const css = (await postcss([tailwind()]).process('@import "tailwindcss" source(none); @source "../src/components/admin/BookingWorkbenchDialog.tsx"; @source "../src/components/admin/BookingTimeZoneSelect.tsx";', { from: path.resolve("scripts/timezone-fixture.css") })).css;
    const script = (await build({ stdin: { contents: `
      import React from 'react';import{createRoot}from'react-dom/client';
      import Workbench from './src/components/admin/BookingWorkbenchDialog';
      import{getMerchantBookingFieldText}from'./src/lib/merchantBookingLocale';
      const root=createRoot(document.getElementById('root'));
      const api=(path,init)=>fetch(path,init);
      let props={open:true,mode:'inline',siteId:'99999999',siteName:'Synthetic',records:[],onClose:()=>{},onSettingsSaved:(settings)=>{window.__saved=settings}};
      window.__rulesLabel=getMerchantBookingFieldText('workbenchRules',window.__locale);
      window.__render=(patch={})=>{props={...props,...patch};root.render(<Workbench {...props} permissions={window.__permissions} apiClient={window.__permissions?api:undefined}/>)};
      window.__render();`, loader: "tsx", resolveDir: process.cwd() }, bundle: true, platform: "browser", format: "iife", write: false, logLevel: "silent", define: { "process.env": "{}" },
      plugins: [{ name: "synthetic-locale", setup(b) {
        b.onResolve({ filter: /^@\/components\/I18nProvider$/ }, args => ({ path: args.path, namespace: "locale" }));
        b.onLoad({ filter: /.*/, namespace: "locale" }, () => ({ contents: "export const useI18n=()=>({locale:window.__locale});", loader: "js" }));
      } }],
    })).outputFiles[0].text;
    return { css, script };
  })();
  return compiled;
}

async function mount(browser, { width = 1280, locale = "zh-CN", timeZone = "", defaultZone = "Europe/Madrid", browserZone = "America/Los_Angeles", permissions, delayFirst = false } = {}) {
  const context = await browser.newContext({ viewport: { width, height: 1000 }, timezoneId: browserZone });
  const page = await context.newPage(), errors = [], unexpected = [], writes = [], reads = [];
  let settings = { timeZone, minAdvanceMinutes: 45, bufferMinutes: 15 }, releaseFirst;
  let firstReadStarted;
  const firstRead = new Promise(resolve => { firstReadStarted = resolve; });
  page.setDefaultTimeout(10_000);
  page.on("pageerror", error => errors.push(error.message));
  await context.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin === "https://booking-timezone.invalid") {
      if (request.isNavigationRequest()) return route.fulfill({ contentType: "text/html", body: '<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div></body></html>' });
      if (url.pathname === "/api/bookings/workbench") {
        if (request.method() === "GET") {
          reads.push(url.searchParams.get("siteId"));
          firstReadStarted();
          const responseZone = delayFirst && url.searchParams.get("siteId") === "99999998" ? "Atlantic/Canary" : defaultZone;
          const json = { ok: true, settings, timeZoneDefault: { countryCode: "ES", timeZone: responseZone } };
          if (delayFirst && reads.length === 1) await new Promise(resolve => { releaseFirst = resolve; });
          return route.fulfill({ json }).catch(() => {}); // A cancelled old-scope request may be gone.
        }
        if (request.method() === "PATCH") {
          const body = request.postDataJSON(); writes.push(body);
          assert.equal(body.siteId, "99999999"); assert.equal(body.section, "settings");
          settings = body.settings;
          return route.fulfill({ json: { ok: true, settings } });
        }
      }
    }
    unexpected.push(`${request.method()} ${request.url()}`); return route.abort();
  });
  await page.goto("https://booking-timezone.invalid/admin");
  await page.evaluate(({ locale, permissions }) => { window.__locale = locale; window.__permissions = permissions; }, { locale, permissions });
  const { css, script } = await assets();
  await page.addStyleTag({ content: css }); await page.addScriptTag({ content: script });
  const rules = async () => page.getByRole("button").filter({ hasText: await page.evaluate(() => window.__rulesLabel) }).click();
  const select = page.getByRole("combobox", { name: /IANA/ });
  const search = page.getByRole("searchbox");
  return { context, page, errors, unexpected, writes, reads, rules, select, search, firstRead, release: () => releaseFirst?.(),
    async verify() { assert.deepEqual(errors, []); assert.deepEqual(unexpected, []); await context.close(); } };
}

test("desktop/mobile: saved-location default is read-only until confirmed; search and manual selection persist correctly", { timeout: 60000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const width of [1280, 390]) {
      const m = await mount(browser, { width });
      await m.rules(); await m.select.waitFor();
      assert.equal(await m.select.inputValue(), "Europe/Madrid");
      await m.search.fill("加那利");
      assert.ok(await m.select.locator('option[value="Atlantic/Canary"]').count());
      assert.equal(await m.select.inputValue(), "Europe/Madrid");
      await m.page.waitForTimeout(1000); assert.equal(m.writes.length, 0, "opening/searching must not auto-save a default");
      const shotDir = process.env.FAOLLA_TIMEZONE_SCREENSHOTS;
      if (shotDir) { await mkdir(shotDir, { recursive: true }); await m.search.fill(""); await m.page.screenshot({ path: path.join(shotDir, `timezone-${width}.png`), fullPage: true }); }
      await m.select.selectOption("Atlantic/Canary");
      await m.page.waitForFunction(() => window.__saved?.timeZone === "Atlantic/Canary");
      assert.equal(m.writes.length, 1); assert.equal(m.writes[0].settings.minAdvanceMinutes, 45);
      assert.equal(m.writes[0].settings.bufferMinutes, 15);
      await m.search.fill("no-such-zone-zz");
      assert.equal(await m.select.inputValue(), "Atlantic/Canary");
      assert.equal(await m.select.locator('option[value="Atlantic/Canary"]').count(), 1);
      await m.page.evaluate(() => window.__render({ open: false }));
      await m.select.waitFor({ state: "detached" });
      await m.page.evaluate(() => window.__render({ open: true }));
      await m.rules(); assert.equal(await m.select.inputValue(), "Atlantic/Canary");
      assert.equal(await m.page.getByRole("button", { name: "使用此时区", exact: true }).count(), 0);
      assert.equal(await m.page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
      await m.page.waitForTimeout(900); assert.equal(m.writes.length, 1);
      await m.verify();
    }
  } finally { await browser.close(); }
});

test("merchant defaults ignore visitor time zone across locales; explicit confirmation saves only the chosen zone", { timeout: 60000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const [locale, browserZone, button] of [["zh-CN", "Asia/Tokyo", "使用此时区"], ["es-ES", "America/New_York", "Usar esta zona horaria"], ["en-GB", "Pacific/Auckland", "Use this time zone"]]) {
      const m = await mount(browser, { width: 390, locale, browserZone, defaultZone: "Atlantic/Canary" });
      await m.rules(); assert.equal(await m.select.inputValue(), "Atlantic/Canary");
      await m.page.waitForTimeout(900); assert.equal(m.writes.length, 0);
      await m.page.getByRole("button", { name: button, exact: true }).click();
      await m.page.waitForFunction(() => window.__saved?.timeZone === "Atlantic/Canary");
      assert.equal(m.writes.length, 1);
      assert.equal(await m.page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
      await m.verify();
    }
  } finally { await browser.close(); }
});

test("saved aliases win over merchant suggestions; ambiguous location requires manual choice; opting out remains possible", { timeout: 60000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const saved = await mount(browser, { timeZone: "US/Eastern" });
    await saved.rules(); assert.equal(await saved.select.inputValue(), "US/Eastern");
    await saved.search.fill("unmatched"); assert.equal(await saved.select.inputValue(), "US/Eastern");
    await saved.page.waitForTimeout(900); assert.equal(saved.writes.length, 0); await saved.verify();
    const ambiguous = await mount(browser, { defaultZone: "" });
    await ambiguous.rules(); assert.equal(await ambiguous.select.inputValue(), "");
    await ambiguous.select.selectOption("Asia/Kolkata");
    await ambiguous.page.waitForFunction(() => window.__saved?.timeZone === "Asia/Kolkata");
    await ambiguous.select.selectOption("");
    await ambiguous.page.waitForFunction(() => window.__saved?.timeZone === "");
    assert.equal(ambiguous.writes.length, 2); await ambiguous.verify();
  } finally { await browser.close(); }
});

test("settings permissions and cancelled old-merchant reads cannot leak or persist a time-zone default", { timeout: 60000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const m = await mount(browser, { permissions: ["bookings.view", "bookings.settings.manage"], delayFirst: true });
    await m.firstRead;
    await m.page.evaluate(() => window.__render({ siteId: "99999998" }));
    await m.rules(); assert.equal(await m.select.inputValue(), "Atlantic/Canary");
    m.release(); await m.page.waitForTimeout(1000);
    assert.equal(await m.select.inputValue(), "Atlantic/Canary");
    assert.deepEqual(m.reads, ["99999999", "99999998"]); assert.equal(m.writes.length, 0);
    await m.page.evaluate(() => { window.__permissions = ["bookings.view", "bookings.automation.manage"]; window.__render(); });
    await m.select.waitFor({ state: "detached" });
    await m.rules(); assert.equal(await m.page.getByRole("searchbox").count(), 0);
    assert.equal(m.writes.length, 0); await m.verify();
  } finally { await browser.close(); }
});
