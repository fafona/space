import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { chromium } from "playwright";

// Real list component + generated Tailwind CSS; synthetic data only. Unexpected
// network requests fail the test; no real account, order or database is used.
const statuses = ["pending", "confirmed", "completed", "cancelled"];
const preferences = { selectedStatuses: statuses, sortMode: "created_desc", historyVisibility: "none" };
const fixtureOrders = () => statuses.flatMap((status, index) => [true, false].map((contact) => ({
  id: `synthetic-${status}-${contact ? "contact" : "empty"}`,
  siteId: "99999999", siteName: "Synthetic", blockId: "test",
  createdAt: `2026-11-0${3 - Math.floor(index / 2)}T10:0${index}:00Z`,
  updatedAt: "2026-11-03T10:00:00Z", merchantTouchedAt: "2026-11-03T10:00:00Z", status,
  customerAccountId: contact && index % 2 === 0 ? "99990001" : "",
  customerLoginEmail: contact ? "client@example.invalid" : "",
  customer: { name: `Synthetic ${status}`, email: contact ? `${"long-address-".repeat(index + 1)}@example.invalid` : "", phone: contact ? "123456789012345678" : "", note: "" },
  items: [{ productId: "one", code: "", name: "Synthetic item", description: "", imageUrl: "", tag: "", quantity: 1, unitPrice: 123.45, unitPriceText: "123.45", subtotal: 123.45 }],
  totalQuantity: 1, totalAmount: index === 1 ? 9999999.99 : 123.45, pricePrefix: "€",
  confirmedAt: null, completedAt: null, cancelledAt: null, printedAt: null, printCount: 0,
})));

async function assets() {
  const css = (await postcss([tailwind()]).process(
    '@import "tailwindcss" source(none); @source "../src/components/admin/MerchantOrderManagerDialog.tsx"; @source "../src/components/admin/OrderStatusFilterDropdown.tsx";',
    { from: path.resolve("scripts/order-layout-fixture.css") },
  )).css;
  const script = (await build({ stdin: { contents: `
    import React from 'react';import{createRoot}from'react-dom/client';
    import Orders from './src/components/admin/MerchantOrderManagerDialog';
    const props={open:true,mode:'inline',showCloseButton:false,siteId:'99999999',siteName:'Synthetic',onClose:()=>{},onOpenConversation:()=>{}};
    createRoot(document.getElementById('root')).render(<Orders {...props} permissions={window.__permissions} apiClient={window.__permissions ? (path,init)=>fetch(path,init) : undefined}/>);`,
    loader: "tsx", resolveDir: process.cwd() }, bundle: true, platform: "browser", format: "iife", write: false, logLevel: "silent",
    define: { "process.env": "{}" }, plugins: [{ name: "unrelated-io", setup(b) {
      b.onResolve({ filter: /^@\/components\/admin\/OrderWorkbenchPanel$/ }, args => ({ path: args.path, namespace: "fixture" }));
      b.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: "export default function Workbench(){return null}", loader: "js" }));
      b.onResolve({ filter: /^@\/lib\/performanceTelemetry$/ }, args => ({ path: args.path, namespace: "telemetry" }));
      b.onLoad({ filter: /.*/, namespace: "telemetry" }, () => ({ contents: "export const fetchWithAdminPerformance=(path,init)=>fetch(path,init)", loader: "js" }));
    } }],
  })).outputFiles[0].text;
  return { css, script };
}

async function mount(browser, assets, width, permissions) {
  const context = await browser.newContext({ viewport: { width, height: 1200 } });
  const page = await context.newPage(), errors = [], unexpected = [], mutations = [];
  let orders = fixtureOrders(), pendingMutation = null;
  page.setDefaultTimeout(10_000);
  page.on("pageerror", error => errors.push(error.message));
  await context.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin === "https://order-layout.invalid") {
      if (request.isNavigationRequest()) return route.fulfill({ contentType: "text/html", body: '<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root" style="margin-left:var(--sidebar,0px)"></div></body></html>' });
      if (url.pathname === "/api/merchant-admin/manager-preferences") {
        assert.equal(request.method(), "GET", "loading a stored preference must not write");
        return route.fulfill({ json: { preferences: { order: preferences }, stored: { order: true } } });
      }
      if (url.pathname === "/api/orders" && request.method() === "GET") return route.fulfill({ json: { orders, hasMore: false, offset: 0 } });
      if (url.pathname === "/api/orders" && request.method() === "PATCH") {
        const body = request.postDataJSON(); mutations.push(body);
        const order = orders.find(item => item.id === body.orderId);
        assert.ok(order);
        assert.equal(body.expectedUpdatedAt, order.updatedAt);
        await new Promise(resolve => { pendingMutation = resolve; });
        const updated = { ...order, status: body.status, updatedAt: "2026-11-03T10:01:00Z" };
        orders = orders.map(item => item.id === updated.id ? updated : item);
        return route.fulfill({ json: { order: updated } });
      }
    }
    unexpected.push(`${request.method()} ${request.url()}`); return route.abort();
  });
  await page.goto("https://order-layout.invalid/admin");
  await page.addStyleTag({ content: assets.css });
  if (width >= 1024) await page.addStyleTag({ content: ":root{--sidebar:228px}" });
  await page.evaluate(value => { window.__permissions = value; }, permissions);
  await page.addScriptTag({ content: assets.script });
  await page.waitForFunction(() => document.querySelectorAll("article").length === 8);
  return { page, context, errors, unexpected, mutations, release: () => { assert.ok(pendingMutation); pendingMutation(); } };
}

async function geometry(page, cards = page.locator("article")) {
  return cards.evaluateAll(cards => cards.map(card => {
    const box = element => { const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
    const column = card.querySelector("[data-order-action-column]");
    const grid = card.querySelector("[data-order-action-grid]");
    const contacts = card.querySelector("[data-order-contact-columns]");
    return {
      card: box(card), column: box(column), grid: box(grid), amount: box(column.firstElementChild),
      slots: Object.fromEntries([...grid.querySelectorAll("button")].map(button => [button.dataset.orderActionSlot, box(button)])),
      contacts: contacts ? box(contacts) : null,
      contactButtons: contacts ? [...contacts.querySelectorAll("a,button")].map(box) : [],
      clippedButtons: [...grid.querySelectorAll("button")].filter(button => button.scrollWidth > button.clientWidth + 1).map(button => button.textContent),
    };
  }));
}
function close(a, b, message) { assert.ok(Math.abs(a - b) < 1, `${message}: ${a} != ${b}`); }

test("all order states use aligned contact, amount and action columns with actual Tailwind CSS", { timeout: 90_000 }, async () => {
  const compiled = await assets(), browser = await chromium.launch({ headless: true });
  try {
    for (const width of [1920, 1440, 1024, 768, 390]) {
      const view = await mount(browser, compiled, width);
      try {
        const rows = await geometry(view.page);
        for (const row of rows) {
          close(row.column.x, rows[0].column.x, `${width}: action column must not depend on status/contact availability`);
          close(row.column.width, rows[0].column.width, `${width}: fixed action column width`);
          close(row.amount.right, rows[0].amount.right, `${width}: amount right alignment`);
          if (width >= 1440) close(row.grid.y - row.card.y, rows[0].grid.y - rows[0].card.y, `${width}: action row vertical alignment`);
          assert.ok(row.grid.right <= row.card.right + 1, `${width}: action grid must remain inside the card`);
          assert.deepEqual(row.clippedButtons, [], `${width}: button labels must fit`);
          for (const [slot, button] of Object.entries(row.slots)) {
            const reference = rows.find(other => other.slots[slot]).slots[slot];
            close(button.x, reference.x, `${width}: ${slot} slot alignment`);
            close(button.y - row.grid.y, reference.y - rows.find(other => other.slots[slot]).grid.y, `${width}: ${slot} row alignment`);
            close(button.height, 34, `${width}: fixed action button height`);
          }
          if (row.contacts) {
            const reference = rows.find(other => other.contacts).contacts;
            close(row.contacts.x, reference.x, `${width}: contact column must not shift with order status`);
            assert.ok(row.contacts.right <= row.card.right + 1, `${width}: contacts must stay inside card`);
            row.contactButtons.forEach((button, i) => close(button.x, rows.find(other => other.contacts).contactButtons[i].x, `${width}: contact button ${i} alignment`));
          }
        }
        assert.equal(await view.page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${width}: no horizontal page overflow`);
        assert.deepEqual(view.errors, []); assert.deepEqual(view.unexpected, []); assert.deepEqual(view.mutations, []);
        if (process.env.FAOLLA_ORDER_ALIGNMENT_SCREENSHOTS) {
          const directory = path.resolve(process.env.FAOLLA_ORDER_ALIGNMENT_SCREENSHOTS);
          await mkdir(directory, { recursive: true });
          await view.page.screenshot({ path: path.join(directory, `orders-${width}.png`), fullPage: true });
        }
      } finally { await view.context.close(); }
    }
  } finally { await browser.close(); }
});

test("busy text and status transitions preserve slots and the original status mutation contract", { timeout: 60_000 }, async () => {
  const compiled = await assets(), browser = await chromium.launch({ headless: true });
  try {
    const view = await mount(browser, compiled, 1920);
    try {
      const card = view.page.locator("article").filter({ hasText: "synthetic-pending-contact" });
      const before = (await geometry(view.page, card))[0];
      await card.locator('[data-order-action-slot="status"]').click();
      await card.getByRole("button", { name: "处理中", exact: true }).waitFor();
      const busy = (await geometry(view.page, card))[0];
      close(before.slots.status.x, busy.slots.status.x, "busy status button position");
      close(before.slots.status.width, busy.slots.status.width, "busy status button width");
      assert.equal(await card.locator('[data-order-action-slot="status"]').isDisabled(), true);
      assert.equal(view.mutations.length, 1);
      assert.deepEqual(view.mutations[0], { siteId: "99999999", orderId: "synthetic-pending-contact", status: "confirmed", expectedUpdatedAt: "2026-11-03T10:00:00Z" });
      view.release();
      await card.getByRole("button", { name: "取消确认", exact: true }).waitFor();
      const after = (await geometry(view.page, card))[0];
      close(before.column.x, after.column.x, "transition action column position");
      close(before.slots.cancel.x, after.slots.cancel.x, "transition cancel button position");
      close(before.slots.details.x, after.slots.details.x, "transition detail button position");
      assert.deepEqual(view.errors, []); assert.deepEqual(view.unexpected, []);
    } finally { await view.context.close(); }
  } finally { await browser.close(); }
});

test("missing role permissions leave reserved slots without exposing forbidden actions", { timeout: 60_000 }, async () => {
  const compiled = await assets(), browser = await chromium.launch({ headless: true });
  try {
    for (const permissions of [["orders.view"], ["orders.view", "orders.customer_data.view", "orders.status.manage"]]) {
      const view = await mount(browser, compiled, 1440, permissions);
      try {
        const rows = await geometry(view.page);
        for (const row of rows) {
          close(row.column.width, 306, "restricted role must keep the same action column width");
          close(row.slots.details.x, rows[0].slots.details.x, "restricted role detail slot alignment");
          assert.equal(row.slots.completion, undefined, "completion permission remains enforced");
          if (permissions.length === 1) assert.deepEqual(Object.keys(row.slots), ["details"]);
        }
        assert.deepEqual(view.errors, []); assert.deepEqual(view.unexpected, []); assert.deepEqual(view.mutations, []);
      } finally { await view.context.close(); }
    }
  } finally { await browser.close(); }
});
