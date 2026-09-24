import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import {
  buildMerchantOrderAttentionNotification,
  canUseMerchantOrderAttentionSummaryForActor,
  compareMerchantOrderAttentionNotifications,
  normalizeDeterministicMerchantOrderAttentionTimestamp,
  normalizeMerchantOrderAttentionCandidate,
  parseMerchantOrderAttentionSummary,
  summarizeMerchantOrderAttentionRecords,
  type MerchantOrderAttentionNotification,
  type MerchantOrderAttentionSummary,
} from "@/lib/merchantOrderAttention";
import {
  formatMerchantOrderAmount,
  isMerchantOrderNewForMerchant,
  normalizeMerchantOrderRecord,
  type MerchantOrderRecord,
} from "@/lib/merchantOrders";
import { formatSupportConversationPreview } from "@/lib/supportMessageAttachments";

const SITE = "10000000";
const DATE = "2026-09-24T10:00:00.000Z";

function order(overrides: Partial<MerchantOrderRecord> = {}): MerchantOrderRecord {
  const normalized = normalizeMerchantOrderRecord({
    id: "one", siteId: SITE, createdAt: DATE, updatedAt: DATE, status: "pending",
    customer: { name: "Alice", phone: "600123456", email: "private@example.test", note: "private-note" },
    items: [{ name: "商品甲", code: "A", productId: "p", quantity: 2, unitPrice: 1.25 } as MerchantOrderRecord["items"][number]],
    pricePrefix: "€", ...overrides,
  });
  assert.ok(normalized);
  return normalized;
}

// Frozen AdminClient.tsx order-attention behavior from baseline 0106e465.
// Keep independent from the new reducer/comparator/notification implementations.
function legacySummary(records: MerchantOrderRecord[], merchantId: string): MerchantOrderAttentionSummary {
  const display = (value: unknown) => {
    const normalized = typeof value === "string" ? value.trim() : "";
    return normalized && normalized !== "-" ? normalized : "";
  };
  const timestamp = (value: unknown) => {
    const normalized = String(value ?? "").trim();
    if (!normalized) return "";
    const time = new Date(normalized).getTime();
    return Number.isFinite(time) ? new Date(time).toISOString() : "";
  };
  return records.reduce<MerchantOrderAttentionSummary>((summary, record) => {
    if (!isMerchantOrderNewForMerchant(record)) return summary;
    const itemSummary = record.items.slice(0, 2).map((item) => {
      const name = display(item.name) || display(item.code) || "商品";
      return item.quantity > 1 ? `${name}×${item.quantity}` : name;
    }).filter(Boolean).join("、") || `${Math.max(1, record.totalQuantity)}件商品`;
    const amount = formatMerchantOrderAmount(record.totalAmount, record.pricePrefix);
    const preview = formatSupportConversationPreview([itemSummary, amount].filter(Boolean).join(" · "));
    const notification = {
      key: `order:${record.id}`,
      title: `新订单 - ${display(record.customer?.name) || display(record.customer?.phone) || "客户"}`,
      body: !preview ? "你有一条新消息" : preview.length > 72 ? `${preview.slice(0, 69).trimEnd()}...` : preview,
      url: `/${display(merchantId) || "admin"}?mobileTab=business&businessSection=orders&appShell=faolla`,
      createdAt: timestamp(record.updatedAt) || timestamp(record.createdAt),
    };
    const left = summary.latest;
    let latest = notification;
    if (left) {
      const leftTime = new Date(left.createdAt).getTime();
      const rightTime = new Date(notification.createdAt).getTime();
      if (rightTime < leftTime) latest = left;
      else if (!(rightTime > leftTime)) latest = notification.key > left.key ? notification : left;
    }
    return { count: summary.count + 1, latest };
  }, { count: 0, latest: null });
}

test("empty and ordinary notifications retain the exact original payload with no order PII fields", () => {
  assert.deepEqual(summarizeMerchantOrderAttentionRecords([], SITE), { count: 0, latest: null });
  assert.deepEqual(summarizeMerchantOrderAttentionRecords([order()], SITE), {
    count: 1,
    latest: {
      key: "order:one", title: "新订单 - Alice", body: "商品甲×2 · €2.50",
      url: "/10000000?mobileTab=business&businessSection=orders&appShell=faolla", createdAt: DATE,
    },
  });
  assert.doesNotMatch(JSON.stringify(summarizeMerchantOrderAttentionRecords([order()], SITE)), /private|customer|items|600123456/);
});

test("all statuses and merchant touch values preserve pending-untouched semantics, not updated-after-touch", () => {
  for (const status of ["pending", "confirmed", "completed", "cancelled"] as const) {
    for (const touched of [undefined, "", "  \n\t", DATE, "not-a-date", "-"]) {
      const record = order({ status, merchantTouchedAt: touched, updatedAt: "2026-09-25T10:00:00Z" });
      const expected = status === "pending" && !String(touched ?? "").trim() ? 1 : 0;
      const actual = summarizeMerchantOrderAttentionRecords([record], SITE);
      assert.equal(actual.count, expected, `${status}/${JSON.stringify(touched)}`);
      assert.deepEqual(actual, legacySummary([record], SITE));
    }
  }
});

test("candidate normalization retains invalid-status fallback, item filtering, rounding, caps and ALL-item totals", () => {
  const raw = {
    ...order(), id: "  dirty  ", siteId: ` ${SITE} `, status: "unknown", merchantTouchedAt: " \t",
    customer: { name: "N".repeat(170), phone: "9".repeat(90), email: "do-not-send@example.test", note: "secret" },
    items: [
      { name: "discard zero", quantity: 0, unitPrice: 999 },
      { name: "  ", quantity: 2, unitPrice: 999 },
      { name: " 第一 ", quantity: "2.9", unitPriceText: "€1,255" },
      { code: " 第二 ", quantity: 1.6, unitPrice: 0.333 },
      { productId: "third", name: "ignored display", quantity: 1000, unitPrice: 0.01 },
    ],
    totalAmount: 999999, totalQuantity: 999999,
  };
  const result = normalizeMerchantOrderAttentionCandidate(raw, SITE);
  assert.equal(result.supported, true);
  if (!result.supported) return;
  assert.deepEqual(result.order, normalizeMerchantOrderRecord(raw as unknown as Partial<MerchantOrderRecord>));
  assert.equal(result.order.status, "pending");
  assert.equal(result.order.customer.name.length, 160);
  assert.equal(result.order.customer.phone.length, 80);
  assert.equal(result.order.totalQuantity, 1003);
  assert.equal(result.order.totalAmount, 13.15);
  assert.equal(buildMerchantOrderAttentionNotification(result.order, SITE).body, "第一×2、第二×2 · €13.15");
});

test("display fallbacks retain dash handling, item codes, empty orders, quantity and amount formatting", () => {
  const missingCustomer = { name: " - ", phone: " - ", email: "", note: "" };
  assert.equal(buildMerchantOrderAttentionNotification(order({ customer: missingCustomer, items: [] }), SITE).title, "新订单 - 客户");
  assert.equal(buildMerchantOrderAttentionNotification(order({ customer: { ...missingCustomer, phone: " 600000001 " } }), SITE).title, "新订单 - 600000001");
  assert.equal(buildMerchantOrderAttentionNotification(order({ items: [] }), SITE).body, "1件商品 · €0.00");
  const record = order({ items: [
    { productId: "1", name: " - ", code: " code ", quantity: 1, unitPrice: 1.2 } as MerchantOrderRecord["items"][number],
    { productId: "2", name: "-", code: "-", quantity: 3, unitPrice: 0 } as MerchantOrderRecord["items"][number],
  ], pricePrefix: "  USD  " });
  assert.equal(buildMerchantOrderAttentionNotification(record, SITE).body, "code、商品×3 · USD1.20");
  assert.equal(buildMerchantOrderAttentionNotification(record, " - ").url, "/admin?mobileTab=business&businessSection=orders&appShell=faolla");
});

test("native body preserves first-line/attachment preview and UTF-16 72-character truncation", () => {
  const body = (name: string) => buildMerchantOrderAttentionNotification(order({
    items: [{ name, productId: "p", quantity: 1, unitPrice: 0 } as MerchantOrderRecord["items"][number]],
  }), SITE).body;
  assert.equal(body("第一行\n第二行"), "第一行");
  assert.equal(body("图片：https://example.test/a.png\nother"), "图片");
  assert.equal(body("图片：https://example.test/a.png\n联系卡：https://example.test/card/test-card\nother"), "名片");
  assert.equal(body("x".repeat(64)), `${"x".repeat(64)} · €0.00`);
  assert.equal(body("x".repeat(65)), `${"x".repeat(65)} · €...`);
  assert.equal(body("x".repeat(68) + "  suffix"), `${"x".repeat(68)}...`);
  assert.equal(body("😀".repeat(40)), `${"😀".repeat(34)}\ud83d...`);
});

test("latest uses updated timestamp then created fallback; equal-time keys use JS UTF-16 not natural/locale order", () => {
  const fixture = [
    order({ id: "9", updatedAt: "2026-09-24T12:00:00+02:00" }),
    order({ id: "10", updatedAt: DATE }),
    order({ id: "older", updatedAt: "2026-09-23T10:00:00Z" }),
  ];
  assert.equal(summarizeMerchantOrderAttentionRecords(fixture, SITE).latest?.key, "order:9");
  for (const ids of [["Z", "a"], ["é", "z"], ["😀", "\ue000"]]) {
    const records = ids.map((id) => order({ id }));
    assert.equal(summarizeMerchantOrderAttentionRecords(records, SITE).latest?.key, `order:${ids[0] > ids[1] ? ids[0] : ids[1]}`);
  }
  const fallback = order({ id: "fallback", updatedAt: "invalid", createdAt: "2026-09-25T10:00:00Z" });
  assert.equal(buildMerchantOrderAttentionNotification(fallback, SITE).createdAt, "2026-09-25T10:00:00.000Z");
  const first = order();
  const second = order({ customer: { ...first.customer, name: "Second" } });
  assert.equal(summarizeMerchantOrderAttentionRecords([first, second], SITE).latest?.title, "新订单 - Alice");
});

test("exact reducer also retains legacy invalid timestamp tie behavior without silently fixing the full route", () => {
  const records = [order({ id: "z", createdAt: "bad", updatedAt: "bad" }), order({ id: "a" })];
  assert.deepEqual(summarizeMerchantOrderAttentionRecords(records, SITE), legacySummary(records, SITE));
  assert.equal(summarizeMerchantOrderAttentionRecords(records, SITE).latest?.createdAt, "");
  const notification = buildMerchantOrderAttentionNotification(order(), SITE);
  assert.equal(compareMerchantOrderAttentionNotifications(notification, null), notification);
  assert.equal(compareMerchantOrderAttentionNotifications(null, notification), notification);
  assert.equal(compareMerchantOrderAttentionNotifications(null, null), null);
});

test("deterministic timestamps accept explicit timezones, leap years and Date millisecond precision", () => {
  for (const [input, expected] of [
    [DATE, DATE], [" 2026-09-24T12:00:00+02:00 ", DATE],
    ["2026-09-24T07:30:00-02:30", DATE],
    ["2024-02-29T00:00:00Z", "2024-02-29T00:00:00.000Z"],
    ["2000-02-29T00:00:00.123456Z", "2000-02-29T00:00:00.123Z"],
    ["2026-09-24T10:00:00.1Z", "2026-09-24T10:00:00.100Z"],
  ]) assert.equal(normalizeDeterministicMerchantOrderAttentionTimestamp(input), expected);
});

test("ambiguous, absent and repaired timestamps explicitly reject rather than substituting now", () => {
  for (const input of [null, undefined, 0, new Date(DATE), "", "bad", "2026-09-24", "2026-09-24T10:00:00",
    "09/24/2026", "2026-09-24 10:00:00Z", "2026-02-29T00:00:00Z", "1900-02-29T00:00:00Z",
    "2026-04-31T00:00:00Z", "2026-00-01T00:00:00Z", "2026-01-00T00:00:00Z", "2026-13-01T00:00:00Z",
    "2026-09-24T24:00:00Z", "2026-09-24T00:60:00Z", "2026-09-24T00:00:60Z",
    "2026-09-24T10:00:00+24:00", "2026-09-24T10:00:00+00:60", "2026-09-24T10:00:00+0200"]) {
    assert.equal(normalizeDeterministicMerchantOrderAttentionTimestamp(input), null, String(input));
  }
  for (const createdAt of [undefined, "", "invalid", "2026-09-24T10:00:00"]) {
    assert.deepEqual(normalizeMerchantOrderAttentionCandidate({ ...order(), createdAt }, SITE), { supported: false, reason: "unsupported_timestamp" });
  }
  assert.deepEqual(normalizeMerchantOrderAttentionCandidate({ ...order(), updatedAt: "bad" }, SITE), { supported: false, reason: "unsupported_timestamp" });
});

test("candidate guards cannot merge merchants, but preserve nonpending records needed for first-ID-wins", () => {
  assert.equal(normalizeMerchantOrderAttentionCandidate(order({ status: "completed" }), SITE).supported, true);
  assert.equal(normalizeMerchantOrderAttentionCandidate(order({ merchantTouchedAt: DATE }), SITE).supported, true);
  for (const input of [null, [], 42, {}, { ...order(), id: " " }]) {
    assert.deepEqual(normalizeMerchantOrderAttentionCandidate(input, SITE), { supported: false, reason: "invalid_record" });
  }
  assert.deepEqual(normalizeMerchantOrderAttentionCandidate(order({ siteId: "20000000" }), SITE), { supported: false, reason: "site_mismatch" });
});

test("relative attachment previews fall back because their existing output depends on browser origin", () => {
  const record = order({ items: [{ name: "图片：/x.png\n联系卡：https://faolla.com/x.png\nOther", productId: "p", quantity: 1, unitPrice: 0 } as MerchantOrderRecord["items"][number]] });
  const source = readFileSync(new URL("./supportMessageAttachments.ts", import.meta.url), "utf8");
  const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const actualPreviewAt = (origin: string) => {
    const context = { exports: {} as { formatSupportConversationPreview?: (value: string) => string }, URL, window: { location: { origin } } };
    runInNewContext(javascript, context, { timeout: 1000 });
    return context.exports.formatSupportConversationPreview?.(`${record.items[0].name} · €0.00`);
  };
  assert.equal(actualPreviewAt("https://faolla.com"), "图片");
  assert.equal(actualPreviewAt("https://fafona.faolla.com"), "名片");
  assert.deepEqual(normalizeMerchantOrderAttentionCandidate(record, SITE), { supported: false, reason: "unsupported_preview" });
  // Explicit absolute URLs have no browser-origin dependency.
  record.items[0].name = "图片：https://faolla.com/x.png\n联系卡：https://faolla.com/x.png\nOther";
  assert.equal(normalizeMerchantOrderAttentionCandidate(record, SITE).supported, true);
});

test("employee is never eligible for owner summaries even with order/customer-data permissions", () => {
  assert.equal(canUseMerchantOrderAttentionSummaryForActor({ type: "owner", siteId: SITE }, SITE), true);
  assert.equal(canUseMerchantOrderAttentionSummaryForActor({ type: "owner", siteId: "20000000" }, SITE), false);
  assert.equal(canUseMerchantOrderAttentionSummaryForActor({ type: "employee", siteId: SITE }, SITE), false);
  assert.equal(canUseMerchantOrderAttentionSummaryForActor({ type: "super_admin", siteId: SITE }, SITE), false);
  assert.equal(canUseMerchantOrderAttentionSummaryForActor(null, SITE), false);
  assert.equal(canUseMerchantOrderAttentionSummaryForActor({ type: "owner", siteId: "" }, ""), false);
});

test("summary wire guard accepts only exact compact outputs and rejects inconsistent counts, fields and origins", () => {
  const summary = summarizeMerchantOrderAttentionRecords([order()], SITE);
  assert.deepEqual(parseMerchantOrderAttentionSummary(summary, SITE), summary);
  assert.deepEqual(parseMerchantOrderAttentionSummary({ count: 0, latest: null }, SITE), { count: 0, latest: null });
  const notification = summary.latest as MerchantOrderAttentionNotification;
  for (const input of [null, [], {}, { count: 1 }, { count: 0, latest: notification }, { count: 1, latest: null },
    { ...summary, count: -1 }, { ...summary, count: 1.1 }, { ...summary, count: "1" }, { ...summary, count: Infinity },
    { ...summary, count: Number.MAX_SAFE_INTEGER + 1 }, { ...summary, orders: [order()] },
    ...[
      { key: "booking:one" }, { key: "order: " }, { key: "order: padded " }, { title: "wrong" }, { title: "新订单 - " },
      { title: "新订单 - " + "x".repeat(161) }, { body: "" }, { body: "x".repeat(73) },
      { url: "https://evil.test" }, { url: "/20000000?mobileTab=business&businessSection=orders&appShell=faolla" },
      { createdAt: "invalid" }, { createdAt: "2026-09-24T10:00:00Z" }, { customer: order().customer },
    ].map((change) => ({ count: 1, latest: { ...notification, ...change } })),
  ]) assert.equal(parseMerchantOrderAttentionSummary(input, SITE), null, JSON.stringify(input));
});

test("full output parity across mixed statuses, unusual display strings and ordered/tied records without mutation", () => {
  const names = ["A", "-", "", "😀".repeat(40), "第一行\n第二行", "图片：https://example.test/a.png\nnext", "x".repeat(100)];
  const records = Array.from({ length: 120 }, (_, index) => order({
    id: ["9", "10", "é", "z", "😀", "\ue000", String(index)][index % 7],
    status: ["pending", "pending", "confirmed", "cancelled", "completed"][index % 5] as MerchantOrderRecord["status"],
    merchantTouchedAt: index % 4 === 0 ? DATE : " ",
    updatedAt: index % 3 === 0 ? "2026-09-24T12:00:00+02:00" : index % 3 === 1 ? DATE : "2026-09-23T10:00:00Z",
    customer: { name: names[index % names.length], phone: "600000001", email: "secret", note: "secret" },
    items: [{ name: names[(index + 1) % names.length], productId: "p", code: "fallback", quantity: index % 3 + 1, unitPrice: 1.239 } as MerchantOrderRecord["items"][number]],
  }));
  const before = JSON.stringify(records);
  for (const merchantId of [SITE, " ", "-"]) {
    assert.deepEqual(summarizeMerchantOrderAttentionRecords(records, merchantId), legacySummary(records, merchantId));
    assert.deepEqual(summarizeMerchantOrderAttentionRecords([...records].reverse(), merchantId), legacySummary([...records].reverse(), merchantId));
  }
  assert.equal(JSON.stringify(records), before);
});
