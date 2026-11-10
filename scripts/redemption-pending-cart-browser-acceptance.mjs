import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright";

// Actual cashier and opt-in synthetic harness. No real business API, cookies or
// account is used. All browser network IO is intercepted before navigation.
let bundled;
async function bundle() {
  if (!bundled) bundled = build({ stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';
    import Harness from './src/app/test-harness/redemption-checkout/RedemptionCheckoutHarness';
    createRoot(document.getElementById('root')).render(<Harness/>);`, loader: "tsx", resolveDir: process.cwd() },
    bundle: true, platform: "browser", format: "iife", write: false, logLevel: "silent", define: { "process.env": "{}" },
    plugins: [{ name: "synthetic-locale", setup(b) {
      b.onResolve({ filter: /^@\/components\/I18nProvider$/ }, args => ({ path: args.path, namespace: "fixture" }));
      b.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: "export const useI18n=()=>({locale:'zh-CN',setLocale:()=>{},t:key=>key});", loader: "js" }));
    } }],
  }).then(result => result.outputFiles[0].text);
  return bundled;
}

async function mount(browser, width = 1600) {
  const context = await browser.newContext({ viewport: { width, height: 1100 } });
  const page = await context.newPage(), errors = [], unexpected = [];
  page.setDefaultTimeout(10_000);
  page.on("pageerror", error => errors.push(error.message));
  await context.route("**/*", route => {
    const request = route.request(), url = new URL(request.url());
    if (request.isNavigationRequest() && url.origin === "https://redemption-audit.invalid") {
      return route.fulfill({ contentType: "text/html", body: '<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0"><div id="root"></div></body></html>' });
    }
    if (request.resourceType() === "image" && /flagcdn\.com$/.test(url.hostname)) {
      return route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="16"><rect width="24" height="16" fill="red"/></svg>' });
    }
    unexpected.push(`${request.method()} ${request.url()}`); return route.abort();
  });
  await page.goto("https://redemption-audit.invalid/local-test");
  await page.addScriptTag({ content: await bundle() });
  await page.getByRole("button", { name: "继续原单结算", exact: true }).waitFor();
  return { context, page, errors, unexpected };
}
const pendingCart = page => page.getByRole("group", { name: "服务器保存的未结算购物车" });
const continueButton = page => page.getByRole("button", { name: "继续原单结算", exact: true });
const log = page => page.getByTestId("request-log").textContent();

test("pending server cart survives reload even when the catalog stock is zero and the current balance is lower", { timeout: 90_000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const width of [1600, 390]) {
      const view = await mount(browser, width);
      try {
        for (const round of [0, 1]) {
          if (round) { await view.page.reload(); await view.page.addScriptTag({ content: await bundle() }); }
          await pendingCart(view.page).getByText("服务器原单商品", { exact: true }).waitFor();
          assert.equal(await continueButton(view.page).isEnabled(), true);
          assert.equal(await pendingCart(view.page).locator("input,button").count(), 0, "original quantities are immutable, not rebuilt from current catalog");
          assert.equal(await pendingCart(view.page).locator(".pending-cart-row").count(), 1);
          assert.equal(await pendingCart(view.page).locator(".pending-cart-row > span").evaluateAll(spans => spans.every(span => {
            const bounds = span.getBoundingClientRect(), table = span.closest(".cart-table").getBoundingClientRect();
            return bounds.width > 0 && bounds.left >= table.left && bounds.right <= table.right;
          })), true, "original item codes, quantities and points must be visible even on narrow screens");
          await view.page.getByText("原单待扣积分", { exact: true }).waitFor();
          assert.equal(await view.page.getByTestId("financial-writes").textContent(), "0");
          assert.doesNotMatch(await log(view.page), /POST|PATCH/);
          const storage = await view.page.evaluate(() => [...Object.values(localStorage), ...Object.values(sessionStorage)].join("\n"));
          assert.doesNotMatch(storage, /服务器原单商品|original-A|member-A/, "do not persist the server financial preview to browser storage");
        }
        if (process.env.FAOLLA_REDEMPTION_PENDING_SCREENSHOTS) {
          const directory = path.resolve(process.env.FAOLLA_REDEMPTION_PENDING_SCREENSHOTS);
          await mkdir(directory, { recursive: true });
          await view.page.screenshot({ path: path.join(directory, `pending-cart-${width}.png`), fullPage: true });
        }
        assert.deepEqual(view.errors, []); assert.deepEqual(view.unexpected, []);
      } finally { await view.context.close(); }
    }
  } finally { await browser.close(); }
});

test("footer resumes only the original operation and repeated clicks cannot create a new sale", { timeout: 60_000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const view = await mount(browser);
    try {
      await view.page.getByRole("button", { name: "慢速原单结算", exact: true }).click();
      await continueButton(view.page).waitFor();
      await continueButton(view.page).evaluate(button => { button.click(); button.click(); button.click(); });
      await view.page.getByRole("button", { name: "确认并开始下一单", exact: true }).waitFor();
      assert.equal(await view.page.getByTestId("financial-writes").textContent(), "1");
      const calls = await log(view.page);
      assert.equal((calls.match(/POST \/api\/merchant-admin\/redemption-checkout retry/g) ?? []).length, 1);
      assert.doesNotMatch(calls, /PATCH \/api\/memberships|ack|print/);
      await view.page.getByRole("button", { name: "确认并开始下一单", exact: true }).click();
      await view.page.getByRole("button", { name: "结算", exact: true }).waitFor();
      assert.equal(await pendingCart(view.page).count(), 0);
      assert.equal(await view.page.getByTestId("financial-writes").textContent(), "1");
      assert.deepEqual(view.errors, []); assert.deepEqual(view.unexpected, []);
    } finally { await view.context.close(); }
  } finally { await browser.close(); }
});

test("failed recheck and rejected retry keep the original goods visible without silently changing their price", { timeout: 60_000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const view = await mount(browser);
    try {
      await view.page.getByRole("button", { name: "再次核对失败", exact: true }).click();
      await pendingCart(view.page).getByText("服务器原单商品", { exact: true }).waitFor();
      await view.page.getByRole("button", { name: "重新读取结算状态", exact: true }).click();
      await view.page.getByRole("button", { name: "核对原单中", exact: true }).waitFor();
      assert.equal(await pendingCart(view.page).getByText("服务器原单商品", { exact: true }).count(), 1, "a pending GET must not clear the original goods");
      await view.page.getByRole("button", { name: "结束失败核对", exact: true }).click();
      await view.page.getByRole("heading", { name: "新结算已暂停", exact: true }).waitFor();
      assert.equal(await pendingCart(view.page).getByText("服务器原单商品", { exact: true }).count(), 1);
      assert.equal(await view.page.getByRole("button", { name: "核对原单中", exact: true }).isDisabled(), true);
      await view.page.getByRole("button", { name: "原价已变化", exact: true }).click();
      await continueButton(view.page).click();
      await view.page.getByRole("alert").filter({ hasText: "原单价格或规则已变化" }).first().waitFor();
      assert.equal(await pendingCart(view.page).getByText("服务器原单商品", { exact: true }).count(), 1);
      assert.equal(await view.page.getByTestId("financial-writes").textContent(), "0");
      await view.page.getByRole("button", { name: "放弃尚未完成的原结算", exact: true }).click();
      await view.page.getByRole("button", { name: "确认并开始下一单", exact: true }).click();
      await view.page.getByRole("button", { name: "结算", exact: true }).waitFor();
      assert.equal(await pendingCart(view.page).count(), 0);
      assert.deepEqual(view.errors, []); assert.deepEqual(view.unexpected, []);
    } finally { await view.context.close(); }
  } finally { await browser.close(); }
});

test("missing old preview fails closed; delayed responses never restore another employee's cart", { timeout: 60_000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const view = await mount(browser);
    try {
      await view.page.getByRole("button", { name: "旧接口缺少明细", exact: true }).click();
      await view.page.getByText("检测到未结算原单，商品明细暂未读取成功。", { exact: true }).waitFor();
      assert.equal(await continueButton(view.page).isDisabled(), true);
      assert.equal(await view.page.getByRole("button", { name: "核对/重试原结算", exact: true }).isDisabled(), true);
      assert.equal(await view.page.getByTestId("financial-writes").textContent(), "0");
      await view.page.evaluate(() => {
        window.__delayedReadComplete = false;
        document.addEventListener("faolla:synthetic-checkout-delayed-read-complete", () => { window.__delayedReadComplete = true; }, { once: true });
      });
      await view.page.getByRole("button", { name: "旧身份延迟响应", exact: true }).click();
      await view.page.getByRole("button", { name: "切换员工身份", exact: true }).click();
      await view.page.getByRole("button", { name: "结算", exact: true }).waitFor();
      // Observe completion explicitly; elapsed time is not evidence of completion.
      await view.page.waitForFunction(() => window.__delayedReadComplete);
      assert.equal(await pendingCart(view.page).count(), 0);
      assert.equal(await view.page.getByText("服务器原单商品", { exact: true }).count(), 0);
      assert.equal(await view.page.getByTestId("financial-writes").textContent(), "0");
      assert.deepEqual(view.errors, []); assert.deepEqual(view.unexpected, []);
    } finally { await view.context.close(); }
  } finally { await browser.close(); }
});

test("lost retry response and cancel/commit races expose the original paid result without a second deduction", { timeout: 60_000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const scenario of ["重试响应丢失", "取消时已完成"]) {
      const view = await mount(browser);
      try {
        await view.page.getByRole("button", { name: scenario, exact: true }).click();
        await pendingCart(view.page).getByText("服务器原单商品", { exact: true }).waitFor();
        if (scenario === "重试响应丢失") await continueButton(view.page).click();
        else await view.page.getByRole("button", { name: "放弃尚未完成的原结算", exact: true }).click();
        await view.page.getByRole("heading", { name: "原结算已完成，等待确认", exact: true }).waitFor();
        await view.page.getByLabel("服务器确认的原单金额").getByText(/80/).first().waitFor();
        assert.equal(await view.page.getByTestId("financial-writes").textContent(), "1");
        assert.equal(await pendingCart(view.page).count(), 0);
        assert.doesNotMatch(await log(view.page), /PATCH \/api\/memberships| ack|print/);
        assert.deepEqual(view.errors, []); assert.deepEqual(view.unexpected, []);
      } finally { await view.context.close(); }
    }
  } finally { await browser.close(); }
});
