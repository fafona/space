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
  await page.locator(".checkout-button").waitFor();
  await page.getByRole("group", { name: "服务器保存的未结算购物车" }).waitFor();
  return { context, page, errors, unexpected };
}
const pendingCart = page => page.getByRole("group", { name: "服务器保存的未结算购物车" });
const continueButton = page => page.locator(".checkout-button");
const log = page => page.getByTestId("request-log").textContent();
const draftItem = page => page.locator(".cart-body .cart-name").filter({ hasText: "当前商品（80积分）" });
const terminalSynced = page => page.waitForFunction(() =>
  document.querySelector('[data-testid="request-log"]')?.textContent.includes(" ack") && document.querySelector(".checkout-button")?.textContent === "结算");

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
          assert.equal(await view.page.getByLabel("原结算恢复", { exact: true }).count(), 0, "a valid original cart has no recovery banner");
          assert.equal(await view.page.getByText("待结算原单", { exact: true }).count(), 0);
          await view.page.locator(".member-line").getByText("合成会员 A", { exact: true }).waitFor();
          await view.page.locator(".member-line").getByText("卡号: 10000000000001", { exact: true }).waitFor();
          await view.page.locator(".member-line").getByText("积分: 20", { exact: true }).waitFor();
          assert.equal(await view.page.locator(".member-line").evaluate(row => {
            const bounds = row.getBoundingClientRect();
            return [...row.children].every(child => { const rect = child.getBoundingClientRect(); return rect.left >= bounds.left && rect.right <= bounds.right + 1; });
          }), true, "the original member heading must not overlap its controls on mobile");
          assert.equal(await view.page.getByRole("button", { name: "清空", exact: true }).isVisible(), true);
          await view.page.getByText("合计积分", { exact: true }).waitFor();
          assert.equal(await continueButton(view.page).textContent(), "结算");
          assert.equal(await view.page.getByRole("button", { name: "清除会员", exact: true }).isDisabled(), true);
          assert.equal(await view.page.getByTestId("financial-writes").textContent(), "0");
          assert.doesNotMatch(await log(view.page), /POST|PATCH/);
          const storage = await view.page.evaluate(() => [...Object.values(localStorage), ...Object.values(sessionStorage)].join("\n"));
          assert.doesNotMatch(storage, /服务器原单商品|original-A|member-A|合成会员 A|10000000000001/, "do not persist the original cart or member preview to browser storage");
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
      await terminalSynced(view.page);
      assert.equal(await view.page.getByTestId("financial-writes").textContent(), "1");
      const calls = await log(view.page);
      assert.equal((calls.match(/POST \/api\/merchant-admin\/redemption-checkout retry/g) ?? []).length, 1);
      assert.doesNotMatch(calls, /PATCH \/api\/memberships|print/);
      assert.equal((calls.match(/POST \/api\/merchant-admin\/redemption-checkout ack/g) ?? []).length, 1);
      assert.equal(await view.page.getByRole("button", { name: "确认并开始下一单", exact: true }).count(), 0);
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
      await view.page.getByRole("button", { name: "刷新", exact: true }).click();
      await view.page.waitForFunction(() => document.querySelector(".checkout-button")?.disabled);
      assert.equal(await pendingCart(view.page).getByText("服务器原单商品", { exact: true }).count(), 1, "a pending GET must not clear the original goods");
      await view.page.getByRole("button", { name: "结束失败核对", exact: true }).click();
      await view.page.locator(".checkout-inline-status.is-error").waitFor();
      assert.equal(await pendingCart(view.page).getByText("服务器原单商品", { exact: true }).count(), 1);
      assert.equal(await continueButton(view.page).isDisabled(), true);
      await view.page.getByRole("button", { name: "原价已变化", exact: true }).click();
      await continueButton(view.page).click();
      await view.page.getByRole("alert").filter({ hasText: "原单价格或规则已变化" }).first().waitFor();
      assert.equal(await pendingCart(view.page).getByText("服务器原单商品", { exact: true }).count(), 1);
      assert.equal(await view.page.getByTestId("financial-writes").textContent(), "0");
      await view.page.getByRole("button", { name: "清空", exact: true }).click();
      await terminalSynced(view.page);
      await view.page.getByRole("button", { name: "结算", exact: true }).waitFor();
      assert.equal(await pendingCart(view.page).count(), 0);
      assert.equal(await view.page.locator(".member-line").getByText("合成会员 A", { exact: true }).count(), 0);
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
      assert.equal(await view.page.getByRole("button", { name: "核对/重试原结算", exact: true }).count(), 0);
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
      assert.equal(await view.page.locator(".member-line").getByText("合成会员 A", { exact: true }).count(), 0);
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
        else await view.page.getByRole("button", { name: "清空", exact: true }).click();
        await terminalSynced(view.page);
        await view.page.getByLabel("服务器确认的原单金额").getByText(/80/).first().waitFor();
        assert.equal(await view.page.getByTestId("financial-writes").textContent(), "1");
        assert.equal(await pendingCart(view.page).count(), 0);
        assert.doesNotMatch(await log(view.page), /PATCH \/api\/memberships|print/);
        assert.equal(((await log(view.page)).match(/ ack/g) ?? []).length, 1);
        assert.equal(await view.page.getByLabel("原结算恢复", { exact: true }).count(), 0);
        assert.deepEqual(view.errors, []); assert.deepEqual(view.unexpected, []);
      } finally { await view.context.close(); }
    }
  } finally { await browser.close(); }
});

test("cancelled and committed originals finish in the background without a banner, confirmation click or financial replay", { timeout: 90_000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const width of [1600, 390]) {
      for (const scenario of ["已放弃未确认", "已完成未确认"]) {
        const view = await mount(browser, width);
        try {
          await view.page.getByRole("button", { name: scenario, exact: true }).click();
          await terminalSynced(view.page);
          assert.equal(await view.page.getByLabel("原结算恢复", { exact: true }).count(), 0);
          assert.equal(await view.page.getByRole("button", { name: "确认并开始下一单", exact: true }).count(), 0);
          assert.equal(await pendingCart(view.page).count(), 0);
          assert.equal(await view.page.getByTestId("financial-writes").textContent(), scenario === "已完成未确认" ? "1" : "0");
          assert.doesNotMatch(await log(view.page), / retry| cancel|PATCH|print/);
          assert.equal(((await log(view.page)).match(/ ack/g) ?? []).length, 1);
          if (process.env.FAOLLA_REDEMPTION_PENDING_SCREENSHOTS) {
            const directory = path.resolve(process.env.FAOLLA_REDEMPTION_PENDING_SCREENSHOTS);
            await mkdir(directory, { recursive: true });
            await view.page.screenshot({ path: path.join(directory, `terminal-cart-${scenario === "已完成未确认" ? "committed" : "cancelled"}-${width}.png`), fullPage: true });
          }
          if (scenario === "已放弃未确认") {
            await view.page.getByText("当前商品（80积分）", { exact: true }).click();
            await draftItem(view.page).waitFor();
            await view.page.locator(".member-search input").fill("合成");
            await view.page.locator(".member-suggestion").first().click();
            assert.equal(await continueButton(view.page).isEnabled(), true, "a cancelled historical operation must not keep the new checkout locked");
          } else {
            await view.page.getByLabel("服务器确认的原单金额").getByText(/80/).waitFor();
          }
          assert.deepEqual(view.errors, []); assert.deepEqual(view.unexpected, []);
        } finally { await view.context.close(); }
      }
    }
  } finally { await browser.close(); }
});

test("failed or invalid terminal sync stays closed with an inline retry, without looping or changing the cart", { timeout: 90_000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const scenario of ["同步首次失败", "同步结果无效", "同步响应丢失"]) {
      const view = await mount(browser);
      try {
        await view.page.getByRole("button", { name: scenario, exact: true }).click();
        await view.page.locator(".checkout-inline-status.is-error").waitFor();
        assert.equal(((await log(view.page)).match(/ ack/g) ?? []).length, 1);
        assert.equal(await view.page.getByLabel("原结算恢复", { exact: true }).count(), 0);
        await view.page.getByText("当前商品（80积分）", { exact: true }).click();
        await view.page.locator(".member-search input").fill("合成");
        await view.page.locator(".member-suggestion").first().click();
        await view.page.locator(".checkout-note input").fill("保留新的购物车备注");
        assert.equal(await continueButton(view.page).isDisabled(), true);
        await view.page.getByRole("button", { name: "重试", exact: true }).click();
        if (scenario === "同步结果无效") {
          await view.page.locator(".checkout-inline-status.is-error").waitFor();
          assert.equal(await continueButton(view.page).isDisabled(), true);
        } else {
          await view.page.waitForFunction(() => !document.querySelector(".checkout-button")?.disabled);
          assert.equal(await view.page.locator(".checkout-inline-status.is-error").count(), 0);
        }
        assert.equal(await draftItem(view.page).count(), 1);
        assert.equal(await view.page.locator(".checkout-note input").inputValue(), "保留新的购物车备注");
        assert.equal(await view.page.getByTestId("financial-writes").textContent(), "0");
        assert.doesNotMatch(await log(view.page), / retry| cancel|PATCH|print/);
        assert.deepEqual(view.errors, []); assert.deepEqual(view.unexpected, []);
      } finally { await view.context.close(); }
    }
  } finally { await browser.close(); }
});

test("a delayed acknowledgement preserves a new draft and cannot leak into a switched identity", { timeout: 60_000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const switchIdentity of [false, true]) {
      const view = await mount(browser);
      try {
        await view.page.evaluate(() => {
          window.__ackStarted = false; window.__ackComplete = false;
          document.addEventListener("faolla:synthetic-checkout-ack-started", () => { window.__ackStarted = true; }, { once: true });
          document.addEventListener("faolla:synthetic-checkout-ack-complete", () => { window.__ackComplete = true; }, { once: true });
        });
        await view.page.getByRole("button", { name: "慢速状态同步", exact: true }).click();
        await view.page.waitForFunction(() => window.__ackStarted);
        await view.page.getByText("当前商品（80积分）", { exact: true }).click();
        await view.page.locator(".checkout-note input").fill("同步时编写的新单");
        if (switchIdentity) await view.page.getByRole("button", { name: "切换员工身份", exact: true }).click();
        await view.page.getByRole("button", { name: "结束状态同步", exact: true }).click();
        await view.page.waitForFunction(() => window.__ackComplete);
        if (switchIdentity) {
          assert.equal(await view.page.locator(".cart-row").count(), 0);
          assert.equal(await view.page.locator(".checkout-note input").inputValue(), "");
        } else {
          await terminalSynced(view.page);
          assert.equal(await draftItem(view.page).count(), 1);
          assert.equal(await view.page.locator(".checkout-note input").inputValue(), "同步时编写的新单");
        }
        assert.equal(await view.page.getByTestId("financial-writes").textContent(), "0");
        assert.deepEqual(view.errors, []); assert.deepEqual(view.unexpected, []);
      } finally { await view.context.close(); }
    }
  } finally { await browser.close(); }
});

test("normal and lost-response new checkouts clear only their submitted draft; a terminal found at preflight cannot deadlock the next sale", { timeout: 90_000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const scenario of ["正常新单结算", "新单响应丢失", "结算前出现旧终态"]) {
      const view = await mount(browser);
      try {
        await view.page.getByRole("button", { name: scenario, exact: true }).click();
        await view.page.locator(".product-tile").filter({ hasText: "当前商品（80积分）" }).click();
        await view.page.locator(".member-search input").fill("合成");
        await view.page.locator(".member-suggestion").first().click();
        await view.page.locator(".checkout-note input").fill("新单备注");
        await view.page.waitForFunction(() => !document.querySelector(".checkout-button")?.disabled);
        await continueButton(view.page).click();
        if (scenario === "结算前出现旧终态") {
          await terminalSynced(view.page);
          await view.page.waitForFunction(() => !document.querySelector(".checkout-button")?.disabled);
          assert.equal(await draftItem(view.page).count(), 1, "the other terminal operation must not clear this unsent draft");
          assert.equal(await view.page.locator(".checkout-note input").inputValue(), "新单备注");
          assert.equal(await view.page.getByTestId("financial-writes").textContent(), "0");
          await continueButton(view.page).click();
        }
        const expectedAcks = scenario === "结算前出现旧终态" ? 2 : 1;
        await view.page.waitForFunction(count =>
          document.querySelector('[data-testid="financial-writes"]')?.textContent === "1" &&
          (document.querySelector('[data-testid="request-log"]')?.textContent.match(/ ack/g) ?? []).length === count &&
          document.querySelector(".checkout-button")?.textContent === "结算", expectedAcks);
        assert.equal(await view.page.locator(".cart-row").count(), 0);
        assert.equal(await view.page.locator(".checkout-note input").inputValue(), "");
        await view.page.getByLabel("服务器确认的原单金额").getByText(/80/).waitFor();
        assert.equal(((await log(view.page)).match(/PATCH \/api\/memberships/g) ?? []).length, 1);
        assert.doesNotMatch(await log(view.page), / retry| cancel|print/);
        assert.equal(await view.page.getByLabel("原结算恢复", { exact: true }).count(), 0);
        assert.deepEqual(view.errors, []); assert.deepEqual(view.unexpected, []);
      } finally { await view.context.close(); }
    }
  } finally { await browser.close(); }
});
