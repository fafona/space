import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { chromium } from "playwright";

// Actual workbench and autosave, synthetic data only. All network requests are
// intercepted before navigation; unexpected destinations fail the acceptance.
test("recurring booking ranges support dropdowns, independent rows and reload on desktop and mobile", { timeout: 90000 }, async () => {
  const bundle = await build({ stdin: {
    contents: `import React from 'react';import{createRoot}from'react-dom/client';
      import Workbench from './src/components/admin/BookingWorkbenchDialog';
      createRoot(document.getElementById('root')).render(<React.StrictMode><Workbench open mode="inline" siteId="99999999" siteName="Synthetic" siteCountryCode="ES" records={[]} darkMode={window.__darkMode} onClose={()=>{}}/></React.StrictMode>);`,
    loader: "tsx", resolveDir: process.cwd(),
  }, bundle: true, platform: "browser", format: "iife", write: false, logLevel: "silent",
  define: { "process.env": "{}" }, plugins: [{ name: "synthetic-locale", setup(b) {
    b.onResolve({ filter: /^@\/components\/I18nProvider$/ }, () => ({ path: "locale", namespace: "synthetic" }));
    b.onLoad({ filter: /.*/, namespace: "synthetic" }, () => ({ contents: "export const useI18n=()=>({locale:'zh-CN'});", loader: "js" }));
  } }] });
  const css = (await postcss([tailwind()]).process(
    '@import "tailwindcss" source(none);\n@source "./src/components/admin/RecurringBookingTimeRanges.tsx";\n@source "./src/components/admin/BookingWorkbenchDialog.tsx";',
    { from: path.resolve("booking-recurring-acceptance.css") },
  )).css;
  const browser = await chromium.launch({ headless: true });
  try {
    for (const scenario of [
      { name: "desktop", width: 1280, height: 900, darkMode: false },
      { name: "mobile", width: 390, height: 844, darkMode: false },
      { name: "mobile-dark", width: 390, height: 844, darkMode: true },
    ]) {
      const context = await browser.newContext({ viewport: { width: scenario.width, height: scenario.height } });
      const page = await context.newPage(), errors = [], unexpected = [], patches = [];
      let saved = { recurringRules: [
        { id: "sunday", weekday: 0, allDay: true, timeRanges: [] },
        { id: "monday", weekday: 1, allDay: false, timeRanges: ["09:07-12:13", "19:30-21:00"] },
      ] };
      page.on("pageerror", (error) => errors.push(error.message));
      await context.route("**/*", async (route) => {
        const request = route.request(), url = new URL(request.url());
        if (url.origin !== "https://booking-audit.invalid") { unexpected.push(request.url()); return route.abort(); }
        if (request.isNavigationRequest()) return route.fulfill({ contentType: "text/html", body: '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div></body></html>' });
        if (url.pathname === "/api/bookings/workbench") {
          if (request.method() === "PATCH") {
            const body = request.postDataJSON();
            assert.equal(body.siteId, "99999999");
            assert.equal(body.section, "settings");
            saved = body.settings; patches.push(body);
          } else assert.equal(request.method(), "GET");
          return route.fulfill({ json: { ok: true, settings: saved } });
        }
        unexpected.push(request.url()); return route.abort();
      });
      const open = async () => {
        await page.goto("https://booking-audit.invalid/workbench");
        await page.addStyleTag({ content: css });
        await page.evaluate((dark) => { window.__darkMode = dark; }, scenario.darkMode);
        await page.addScriptTag({ content: bundle.outputFiles[0].text });
        await page.getByRole("button", { name: /^预约设置/ }).click();
        await page.getByLabel("周二 第1段开始时间", { exact: true }).waitFor();
      };
      const afterSave = async (action) => {
        const response = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/bookings/workbench" && r.request().method() === "PATCH");
        await action(); assert.equal((await response).status(), 200);
        await page.getByText("正在保存", { exact: true }).waitFor({ state: "hidden" });
      };
      const tuesday = () => saved.recurringRules.find((rule) => rule.weekday === 2);
      const dayCard = () => page.getByText("周二", { exact: true }).locator("..").locator("..");
      try {
        await open();
        assert.equal(await page.getByLabel("周一 第1段开始时间", { exact: true }).inputValue(), "09:07");
        assert.equal(await page.getByLabel("周一 第1段结束时间", { exact: true }).inputValue(), "12:13");
        await page.getByLabel("周二 第1段开始时间", { exact: true }).selectOption("13:00");
        await page.waitForTimeout(850); // Longer than the real 700ms autosave debounce.
        assert.equal(patches.length, 0, "a partial new row must not trigger a write");
        await afterSave(() => page.getByLabel("周二 第1段结束时间", { exact: true }).selectOption("18:00"));
        assert.deepEqual(tuesday().timeRanges, ["13:00-18:00"]);
        assert.equal(await page.getByLabel("周二 第1段开始时间", { exact: true }).inputValue(), "13:00");
        assert.equal(await page.getByLabel("周二 第1段结束时间", { exact: true }).inputValue(), "18:00");
        assert.equal(await page.getByLabel("周二 第1段结束时间", { exact: true }).locator('option[value="12:55"]').evaluate((option) => option.disabled), true);
        assert.equal(await page.getByLabel("周二 第1段开始时间", { exact: true }).locator('option[value="18:05"]').evaluate((option) => option.disabled), true);
        await page.getByRole("button", { name: "为周二添加时段", exact: true }).click();
        await page.getByLabel("周二 第2段开始时间", { exact: true }).selectOption("19:30");
        await afterSave(() => page.getByLabel("周二 第1段结束时间", { exact: true }).selectOption("17:00"));
        assert.deepEqual(tuesday().timeRanges, ["13:00-17:00"]);
        assert.equal(await page.getByLabel("周二 第2段开始时间", { exact: true }).inputValue(), "19:30", "another row's save echo must retain unfinished selections");
        await afterSave(() => page.getByLabel("周二 第2段结束时间", { exact: true }).selectOption("21:00"));
        assert.deepEqual(tuesday().timeRanges, ["13:00-17:00", "19:30-21:00"]);
        const card = await dayCard().boundingBox();
        for (const control of await dayCard().locator("select, button").all()) {
          const box = await control.boundingBox();
          assert.ok(box.x >= card.x && box.x + box.width <= card.x + card.width + 1, "controls must fit within the day card");
        }
        assert.ok(card.x >= 0 && card.x + card.width <= scenario.width + 1, "day card must fit the viewport");
        if (process.env.FAOLLA_BOOKING_SCREENSHOT_DIR) {
          await fs.mkdir(process.env.FAOLLA_BOOKING_SCREENSHOT_DIR, { recursive: true });
          await dayCard().screenshot({ path: path.join(process.env.FAOLLA_BOOKING_SCREENSHOT_DIR, `recurring-${scenario.name}.png`) });
        }
        await open();
        assert.equal(await page.getByLabel("周二 第2段开始时间", { exact: true }).inputValue(), "19:30");
        await afterSave(() => page.getByRole("button", { name: "删除周二第1段时段", exact: true }).click());
        assert.deepEqual(tuesday().timeRanges, ["19:30-21:00"]);
        await afterSave(() => page.getByRole("button", { name: "删除周二第1段时段", exact: true }).click());
        assert.equal(tuesday(), undefined);
        assert.equal(await page.getByLabel("周二 第1段开始时间", { exact: true }).inputValue(), "");
        await afterSave(() => dayCard().getByRole("checkbox").check());
        assert.equal(tuesday().allDay, true);
        assert.equal(await dayCard().locator("select").first().isDisabled(), true);
        assert.equal(await page.getByRole("button", { name: "为周二添加时段", exact: true }).isDisabled(), true);
        await afterSave(() => dayCard().getByRole("checkbox").uncheck());
        assert.equal(tuesday(), undefined);
        assert.equal(await dayCard().locator("select").first().isEnabled(), true);
        assert.deepEqual(saved.recurringRules.find((rule) => rule.weekday === 1).timeRanges, ["09:07-12:13", "19:30-21:00"]);
        assert.equal(saved.recurringRules.find((rule) => rule.weekday === 0).allDay, true);
        assert.deepEqual(errors, []); assert.deepEqual(unexpected, []);
      } finally { await context.close(); }
    }
  } finally { await browser.close(); }
});
