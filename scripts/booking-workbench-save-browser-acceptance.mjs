import assert from "node:assert/strict";
import test from "node:test";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { chromium } from "playwright";

// Actual workbench, synthetic settings only. All IO is intercepted before the
// first navigation; no environment files, production endpoint or real account.
let compiled;
let css;
async function styles() {
  return css ??= (await postcss([tailwind()]).process('@import "tailwindcss" source(none); @source "../src/components/admin/BookingWorkbenchDialog.tsx";', { from: path.resolve("scripts/workbench-save-fixture.css") })).css;
}
async function bundle() {
  return compiled ??= (await build({ stdin: { contents: `
    import React from 'react';import{createRoot}from'react-dom/client';
    import Workbench from './src/components/admin/BookingWorkbenchDialog';
    const root=createRoot(document.getElementById('root')),api=(p,i)=>fetch(p,i);
    let props={open:true,mode:'inline',siteId:'99999999',siteName:'Synthetic',records:[],itemOptions:['150min'],onClose:()=>{},onSettingsSaved:s=>window.__saved=s};
    window.__render=(patch={})=>{props={...props,...patch};root.render(<Workbench {...props} permissions={window.__permissions} apiClient={window.__permissions?api:undefined}/>)};
    window.__render();`, loader: "tsx", resolveDir: process.cwd() }, bundle: true, platform: "browser", format: "iife", write: false, logLevel: "silent", define: { "process.env": "{}" },
    plugins: [{ name: "synthetic-locale", setup(b) {
      b.onResolve({ filter: /^@\/components\/I18nProvider$/ }, args => ({ path: args.path, namespace: "locale" }));
      b.onLoad({ filter: /.*/, namespace: "locale" }, () => ({ contents: "export const useI18n=()=>({locale:'zh-CN'});", loader: "js" }));
    } }],
  })).outputFiles[0].text;
}

async function mount(browser, { width = 1280, holdFailure = false, employee = false, networkFailure = false } = {}) {
  const context = await browser.newContext({ viewport: { width, height: 900 } });
  const page = await context.newPage(), errors = [], unexpected = [], writes = [];
  const settings = new Map(); let release;
  page.setDefaultTimeout(10000); page.on("pageerror", error => errors.push(error.message));
  await context.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin === "https://workbench-save.invalid") {
      if (request.isNavigationRequest()) return route.fulfill({ contentType: "text/html", body: '<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div></body></html>' });
      if (url.pathname === "/api/bookings/workbench") {
        if (request.method() === "GET") return route.fulfill({ json: { ok: true, settings: settings.get(url.searchParams.get("siteId")) ?? { minAdvanceMinutes: 45 } } });
        if (request.method() === "PATCH") {
          const body = request.postDataJSON(); writes.push(body); assert.equal(body.section, "settings");
          if (writes.length === 1) {
            if (holdFailure) await new Promise(resolve => { release = resolve; });
            if (networkFailure) return route.abort("failed");
            return route.fulfill({ status: 503, json: { error: "booking_workbench_failed", reason: "booking_atomic_storage_unconfirmed", reference: "0123456789abcdef" } });
          }
          settings.set(body.siteId, body.settings);
          return route.fulfill({ json: { ok: true, settings: body.settings } });
        }
      }
    }
    unexpected.push(`${request.method()} ${request.url()}`); return route.abort();
  });
  await page.goto("https://workbench-save.invalid/admin");
  await page.addStyleTag({ content: await styles() });
  if (employee) await page.evaluate(() => { window.__permissions = ["bookings.view", "bookings.settings.manage"]; });
  await page.addScriptTag({ content: await bundle() });
  const rules = () => page.getByRole("button").filter({ hasText: "预约设置" }).click();
  const colour = page.locator('select:has(option[value="teal"])');
  return { context, page, errors, unexpected, writes, rules, colour, release: () => release?.(),
    async verify() { assert.deepEqual(errors, []); assert.deepEqual(unexpected, []); await context.close(); } };
}

test("failed colours stay editable with a persistent explicit retry; success clears the owner's failed fingerprint", { timeout: 60000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const width of [1280, 390]) {
      const m = await mount(browser, { width }); await m.rules();
      await m.colour.selectOption("teal");
      const failure = m.page.getByRole("alert");
      await failure.getByText("工作台设置尚未确认保存").waitFor();
      assert.equal(await m.colour.inputValue(), "teal");
      await m.page.waitForTimeout(3300);
      assert.equal(await failure.isVisible(), true, "the warning must outlive the short toast");
      assert.equal(m.writes.length, 1, "uncertain writes must never retry automatically");
      assert.equal(await m.page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
      if (process.env.FAOLLA_WORKBENCH_SAVE_SCREENSHOTS) {
        await mkdir(process.env.FAOLLA_WORKBENCH_SAVE_SCREENSHOTS, { recursive: true });
        await m.page.screenshot({ path: path.join(process.env.FAOLLA_WORKBENCH_SAVE_SCREENSHOTS, `workbench-save-${width}.png`), fullPage: true });
      }
      await failure.getByRole("button", { name: "重试保存", exact: true }).click();
      await m.page.waitForFunction(() => window.__saved?.itemColorStyles?.['150min']?.textColor === '#0F766E');
      await failure.waitFor({ state: "detached" }); assert.equal(m.writes.length, 2);
      assert.deepEqual(m.writes[1].settings, m.writes[0].settings);
      await m.colour.selectOption("blue");
      await m.page.waitForFunction(() => window.__saved?.itemColorStyles?.['150min']?.textColor === '#1D4ED8');
      await m.colour.selectOption("teal");
      await m.page.waitForFunction(() => window.__saved?.itemColorStyles?.['150min']?.textColor === '#0F766E');
      assert.equal(m.writes.length, 4, "returning to a previously failed colour must still save");
      await m.page.evaluate(() => window.__render({ open: false }));
      await m.colour.waitFor({ state: "detached" });
      await m.page.evaluate(() => window.__render({ open: true }));
      await m.rules(); assert.equal(await m.colour.inputValue(), "teal");
      await m.verify();
    }
  } finally { await browser.close(); }
});

test("an old merchant's delayed failure cannot leak into the next merchant or block its autosave", { timeout: 30000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const m = await mount(browser, { holdFailure: true }); await m.rules(); await m.colour.selectOption("teal");
    while (!m.writes.length) await m.page.waitForTimeout(20);
    await m.page.evaluate(() => window.__render({ siteId: "99999998" }));
    await m.page.waitForFunction(() => document.querySelector('select:has(option[value="teal"])')?.value === '');
    m.release(); await m.page.waitForTimeout(150);
    assert.equal(await m.page.getByRole("alert").count(), 0);
    await m.colour.selectOption("blue");
    await m.page.waitForFunction(() => window.__saved?.itemColorStyles?.['150min']?.textColor === '#1D4ED8');
    assert.equal(m.writes.length, 2); assert.equal(m.writes[1].siteId, "99999998"); await m.verify();
  } finally { await browser.close(); }
});

test("network failure retains the same colour and retries only after an explicit click", { timeout: 30000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const m = await mount(browser, { width: 390, networkFailure: true }); await m.rules(); await m.colour.selectOption("black");
    const failure = m.page.getByRole("alert"); await failure.waitFor();
    assert.ok((await failure.innerText()).includes("保存结果暂未确认"));
    assert.equal(await m.colour.inputValue(), "black");
    await m.page.waitForTimeout(1000); assert.equal(m.writes.length, 1);
    await failure.getByRole("button", { name: "重试保存", exact: true }).click();
    await m.page.waitForFunction(() => window.__saved?.itemColorStyles?.['150min']?.textColor === '#111827');
    assert.equal(m.writes.length, 2); assert.deepEqual(m.writes[0], m.writes[1]); await m.verify();
  } finally { await browser.close(); }
});

test("a fresh open clears old failed fingerprints so selecting the same failed colour can save", { timeout: 30000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const m = await mount(browser, { width: 390 }); await m.rules(); await m.colour.selectOption("teal");
    await m.page.getByRole("alert").waitFor(); assert.equal(m.writes.length, 1);
    await m.page.evaluate(() => window.__render({ open: false })); await m.colour.waitFor({ state: "detached" });
    await m.page.evaluate(() => window.__render({ open: true })); await m.rules();
    assert.equal(await m.colour.inputValue(), ""); await m.colour.selectOption("teal");
    await m.page.waitForFunction(() => window.__saved?.itemColorStyles?.['150min']?.textColor === '#0F766E');
    assert.equal(m.writes.length, 2); await m.verify();
  } finally { await browser.close(); }
});

test("revoked employee settings permission removes the failure/retry UI and cannot send another save", { timeout: 30000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const m = await mount(browser, { employee: true }); await m.rules(); await m.colour.selectOption("teal");
    await m.page.getByRole("button", { name: "重试保存", exact: true }).waitFor();
    await m.page.evaluate(() => { window.__permissions = ["bookings.view", "bookings.automation.manage"]; window.__render(); });
    await m.page.getByRole("alert").waitFor({ state: "detached" });
    await m.rules(); assert.equal(await m.colour.count(), 0);
    await m.page.waitForTimeout(1000); assert.equal(m.writes.length, 1); await m.verify();
  } finally { await browser.close(); }
});
