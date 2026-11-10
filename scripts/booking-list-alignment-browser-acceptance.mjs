import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { chromium } from "playwright";

// Real booking list and generated Tailwind CSS, synthetic records only. All
// network IO is intercepted before navigation; unexpected requests fail tests.
const statuses = ["active", "confirmed", "completed", "no_show", "cancelled"];
const preferences = { selectedStatuses: statuses, sortMode: "appointment_desc", historyVisibility: "none" };
const fixtureBookings = () => statuses.flatMap((status, index) => [true, false].map(contact => ({
  id: `synthetic-${status}-${contact ? "contact" : "empty"}`,
  siteId: "99999999", siteName: "Synthetic", bookingBlockId: "test", bookingViewport: "desktop", status,
  createdAt: "2026-11-04T10:00:00Z", updatedAt: "2026-11-04T10:00:00Z", merchantTouchedAt: "2026-11-04T10:00:00Z",
  appointmentAt: "2026-11-05T14:30", appointmentTimeZone: "Europe/Madrid",
  customerAccountId: contact && index % 2 === 0 ? "99990001" : "",
  customerLoginEmail: contact ? "client@example.invalid" : "", customerName: `Synthetic ${status}`, title: "Mx",
  email: contact ? `${"long-address-".repeat(index + 1)}@example.invalid` : "", phone: contact ? "123456789012345678" : "",
  store: "Synthetic Store", item: "60min", note: index === 2 ? "Synthetic multiline note\n第二行备注" : "",
  customerEmailLogs: contact && index % 2 === 0 ? [{ id: "synthetic-email", kind: "manual", delivery: "sent", createdAt: "2026-11-04T10:00:00Z", subject: "Synthetic" }] : [], timeline: [],
})));

let compiled;
async function assets() {
  if (!compiled) compiled = (async () => {
    const css = (await postcss([tailwind()]).process(
      '@import "tailwindcss" source(none); @source "../src/components/admin/MerchantBookingManagerDialog.tsx"; @source "../src/components/admin/BookingStatusFilterDropdown.tsx"; @source "../src/components/admin/BookingScheduleOverview.tsx";',
      { from: path.resolve("scripts/booking-layout-fixture.css") },
    )).css;
    const script = (await build({ stdin: { contents: `
      import React from 'react';import{createRoot}from'react-dom/client';
      import Bookings from './src/components/admin/MerchantBookingManagerDialog';
      const props={open:true,mode:'inline',showCloseButton:false,siteId:'99999999',siteName:'Synthetic',onClose:()=>{},onOpenConversation:()=>{}};
      createRoot(document.getElementById('root')).render(<Bookings {...props} permissions={window.__permissions} apiClient={window.__permissions ? (path,init)=>fetch(path,init) : undefined}/>);`,
      loader: "tsx", resolveDir: process.cwd() }, bundle: true, platform: "browser", format: "iife", write: false, logLevel: "silent",
      define: { "process.env": "{}" }, plugins: [{ name: "unrelated-io", setup(b) {
        b.onResolve({ filter: /^@\/components\/admin\/BookingWorkbenchDialog$/ }, args => ({ path: args.path, namespace: "workbench" }));
        b.onLoad({ filter: /.*/, namespace: "workbench" }, () => ({ contents: "export default function Workbench(){return null}", loader: "js" }));
        b.onResolve({ filter: /^@\/lib\/performanceTelemetry$/ }, args => ({ path: args.path, namespace: "telemetry" }));
        b.onLoad({ filter: /.*/, namespace: "telemetry" }, () => ({ contents: "export const fetchWithAdminPerformance=(path,init)=>fetch(path,init)", loader: "js" }));
        b.onResolve({ filter: /^@\/components\/I18nProvider$/ }, args => ({ path: args.path, namespace: "locale" }));
        b.onLoad({ filter: /.*/, namespace: "locale" }, () => ({ contents: "export const useI18n=()=>({locale:window.__locale});", loader: "js" }));
      } }],
    })).outputFiles[0].text;
    return { css, script };
  })();
  return compiled;
}

async function mount(browser, width, { locale = "zh-CN", permissions } = {}) {
  const context = await browser.newContext({ viewport: { width, height: 1200 } });
  const page = await context.newPage(), errors = [], unexpected = [], mutations = [];
  let bookings = fixtureBookings(), pendingMutation = null;
  page.setDefaultTimeout(10_000);
  page.on("pageerror", error => errors.push(error.message));
  await context.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin === "https://booking-layout.invalid") {
      if (request.isNavigationRequest()) return route.fulfill({ contentType: "text/html", body: '<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root" style="margin-left:var(--sidebar,0px)"></div></body></html>' });
      if (url.pathname === "/api/merchant-admin/manager-preferences") {
        assert.equal(request.method(), "GET", "reading stored preferences must not write");
        return route.fulfill({ json: { preferences: { booking: preferences }, stored: { booking: true } } });
      }
      if (url.pathname === "/api/bookings/workbench") return route.fulfill({ json: { ok: true, settings: {} } });
      if (url.pathname === "/api/bookings" && request.method() === "GET") return route.fulfill({ json: { ok: true, bookings, hasMore: false, offset: 0 } });
      if (url.pathname === "/api/bookings" && request.method() === "PATCH") {
        const body = request.postDataJSON(); mutations.push(body);
        const booking = bookings.find(item => item.id === body.bookingId);
        assert.ok(booking);
        await new Promise(resolve => { pendingMutation = resolve; });
        const updated = { ...booking, status: body.status, updatedAt: "2026-11-04T10:01:00Z" };
        bookings = bookings.map(item => item.id === updated.id ? updated : item);
        return route.fulfill({ json: { ok: true, booking: updated } });
      }
    }
    unexpected.push(`${request.method()} ${request.url()}`); return route.abort();
  });
  await page.goto("https://booking-layout.invalid/admin");
  const compiled = await assets();
  await page.addStyleTag({ content: compiled.css });
  if (width >= 1024) await page.addStyleTag({ content: ":root{--sidebar:228px}" });
  await page.evaluate(value => { window.__permissions = value.permissions; window.__locale = value.locale; }, { permissions, locale });
  await page.addScriptTag({ content: compiled.script });
  await page.waitForFunction(() => document.querySelectorAll("article").length === 10);
  return { page, context, errors, unexpected, mutations, release: () => { assert.ok(pendingMutation); pendingMutation(); } };
}

async function geometry(page, cards = page.locator("article")) {
  return cards.evaluateAll(cards => cards.map(card => {
    const box = element => { const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
    const grid = card.querySelector("[data-booking-action-grid]"), contacts = card.querySelector("[data-booking-contact-columns]");
    const detailRow = card.querySelector("[data-booking-detail-row]");
    const buttons = [...grid.querySelectorAll("button"), card.querySelector('[data-booking-action-slot="details"]')];
    return { card: box(card), grid: box(grid), detailRow: box(detailRow),
      slots: Object.fromEntries(buttons.map(button => [button.dataset.bookingActionSlot, box(button)])),
      contacts: contacts ? box(contacts) : null,
      contactColumns: contacts ? [...contacts.children].map(box) : [],
      clippedButtons: buttons.filter(button => button.scrollWidth > button.clientWidth + 1 || button.scrollHeight > button.clientHeight + 1).map(button => button.textContent),
    };
  }));
}
function close(a, b, message) { assert.ok(Math.abs(a - b) < 1, `${message}: ${a} != ${b}`); }

test("all five booking states keep status/contact/detail columns aligned without clipping", { timeout: 90_000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const locale of ["zh-CN", "es-ES", "en-GB"]) for (const width of [1920, 1440, 1024, 768, 390]) {
      const view = await mount(browser, width, { locale });
      try {
        const rows = await geometry(view.page);
        for (const row of rows) {
          close(row.grid.x, rows[0].grid.x, `${locale}/${width}: fixed action column`);
          close(row.grid.width, rows[0].grid.width, `${locale}/${width}: action width must not depend on status`);
          close(row.grid.height, rows[0].grid.height, `${locale}/${width}: reserved rows must not collapse`);
          assert.ok(row.grid.right <= row.card.right + 1, `${locale}/${width}: action grid inside card`);
          close(row.slots.details.right, rows[0].slots.details.right, `${locale}/${width}: detail button right edge`);
          assert.ok(row.detailRow.right <= row.card.right + 1, `${locale}/${width}: ID/detail row inside card`);
          assert.deepEqual(row.clippedButtons, [], `${locale}/${width}: localized button labels must fit`);
          for (const [slot, button] of Object.entries(row.slots)) {
            const reference = rows.find(other => other.slots[slot]);
            close(button.x, reference.slots[slot].x, `${locale}/${width}: ${slot} column`);
            if (slot !== "details") close(button.y - row.grid.y, reference.slots[slot].y - reference.grid.y, `${locale}/${width}: ${slot} row`);
          }
          if (row.contacts) {
            close(row.contacts.x, rows[0].contacts.x, `${locale}/${width}: contact start`);
            close(row.contacts.width, rows[0].contacts.width, `${locale}/${width}: contact width`);
            assert.ok(row.contacts.right <= row.card.right + 1, `${locale}/${width}: contacts inside card`);
            for (const index of [1, 3, 5]) close(row.contactColumns[index].x, rows[0].contactColumns[index].x, `${locale}/${width}: contact icon ${index}`);
          }
        }
        assert.equal(await view.page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${locale}/${width}: no horizontal page overflow`);
        assert.deepEqual(view.errors, []); assert.deepEqual(view.unexpected, []); assert.deepEqual(view.mutations, []);
        if (process.env.FAOLLA_BOOKING_ALIGNMENT_SCREENSHOTS && locale === "zh-CN") {
          const directory = path.resolve(process.env.FAOLLA_BOOKING_ALIGNMENT_SCREENSHOTS);
          await mkdir(directory, { recursive: true });
          await view.page.screenshot({ path: path.join(directory, `bookings-${width}.png`), fullPage: true });
        }
      } finally { await view.context.close(); }
    }
  } finally { await browser.close(); }
});

test("busy label and a booking status transition keep semantic slots and the existing PATCH contract", { timeout: 60_000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const view = await mount(browser, 1920);
    try {
      const card = view.page.locator("article").filter({ hasText: "synthetic-active-contact" });
      const before = (await geometry(view.page, card))[0];
      await card.locator('[data-booking-action-slot="status"]').click();
      await card.getByRole("button", { name: "处理中...", exact: true }).waitFor();
      assert.equal(await card.locator('[data-booking-action-slot="status"]').isDisabled(), true);
      const busy = (await geometry(view.page, card))[0];
      close(before.slots.status.x, busy.slots.status.x, "busy button position");
      close(before.slots.status.width, busy.slots.status.width, "busy button width");
      assert.deepEqual(view.mutations, [{ siteId: "99999999", bookingId: "synthetic-active-contact", status: "confirmed" }]);
      view.release();
      await card.getByRole("button", { name: "取消确认", exact: true }).waitFor();
      const after = (await geometry(view.page, card))[0];
      for (const slot of ["status", "attendance", "completion", "cancel", "details"]) close(before.slots[slot].x, after.slots[slot].x, `transition ${slot}`);
      assert.deepEqual(view.errors, []); assert.deepEqual(view.unexpected, []);
    } finally { await view.context.close(); }
  } finally { await browser.close(); }
});

test("view-only roles keep reserved positions without exposing status or customer-data actions", { timeout: 60_000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const view = await mount(browser, 1440, { permissions: ["bookings.view"] });
    try {
      const rows = await geometry(view.page);
      for (const row of rows) {
        assert.deepEqual(Object.keys(row.slots), ["details"]);
        assert.equal(row.contacts, null);
        close(row.grid.width, 370, "view-only grid width");
        close(row.grid.height, 34, "view-only grid height");
        close(row.slots.details.x, rows[0].slots.details.x, "view-only detail alignment");
      }
      assert.deepEqual(view.errors, []); assert.deepEqual(view.unexpected, []); assert.deepEqual(view.mutations, []);
    } finally { await view.context.close(); }
  } finally { await browser.close(); }
});
