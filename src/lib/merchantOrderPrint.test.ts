import assert from "node:assert/strict";
import test from "node:test";
import type { MerchantOrderRecord } from "@/lib/merchantOrders";
import {
  MERCHANT_ORDER_PRINT_ATTEMPT_TEXT,
  MERCHANT_ORDER_PRINT_STARTED_TEXT,
  buildMerchantOrderPrintHtml,
  escapeHtml,
  getMerchantOrderPrintAttemptText,
  prepareMerchantOrderPrintWindow,
  startMerchantOrderPrint,
} from "@/lib/merchantOrderPrint";

function orderFixture(overrides: Partial<MerchantOrderRecord> = {}): MerchantOrderRecord {
  return {
    id: "O10000000202608170001",
    siteId: "10000000",
    siteName: "FAOLLA 商户",
    blockId: "products",
    createdAt: "2026-08-17T12:00:00.000Z",
    updatedAt: "2026-08-17T12:00:00.000Z",
    status: "pending",
    customer: {
      name: "测试客户",
      phone: "+34 600 000 000",
      email: "customer@example.com",
      note: "请尽快处理",
    },
    items: [
      {
        productId: "product-a",
        code: "SKU-001",
        name: "咖啡",
        description: "",
        imageUrl: "",
        tag: "",
        quantity: 2,
        unitPrice: 3.5,
        unitPriceText: "€3.50",
        subtotal: 7,
      },
    ],
    totalQuantity: 2,
    totalAmount: 7,
    pricePrefix: "€",
    confirmedAt: null,
    completedAt: null,
    cancelledAt: null,
    printedAt: null,
    printCount: 0,
    ...overrides,
  };
}

test("escapeHtml escapes all HTML-significant characters", () => {
  assert.equal(
    escapeHtml(`<script data-value="Tom & Jerry's">`),
    "&lt;script data-value=&quot;Tom &amp; Jerry&#39;s&quot;&gt;",
  );
  assert.equal(escapeHtml(null), "");
});

test("print HTML escapes every interpolated order, customer, item, and formatter value", () => {
  const html = buildMerchantOrderPrintHtml(
    orderFixture({
      id: `O<&"'>`,
      siteName: `<img src=x onerror="site"> & Shop`,
      customer: {
        name: `<script>customerName()</script>`,
        phone: `<svg onload="phone">`,
        email: `mail&<b>@example.com`,
        note: `line 1\n</div><script>note()</script>`,
      },
      pricePrefix: `</td><script>currency()</script>`,
      items: [
        {
          ...orderFixture().items[0]!,
          name: `<img src=x onerror="item">`,
          code: `SKU<&"'>`,
          unitPriceText: `<script>unitPrice()</script>`,
        },
      ],
    }),
    { formatDateTime: () => `</div><script>date()</script>` },
  );

  assert.equal(html.includes("<script>customerName()"), false);
  assert.equal(html.includes("<script>note()"), false);
  assert.equal(html.includes("<script>currency()"), false);
  assert.equal(html.includes("<script>unitPrice()"), false);
  assert.equal(html.includes("<script>date()"), false);
  assert.equal(html.includes("<img src=x"), false);
  assert.equal(html.includes("<svg onload"), false);
  assert.match(html, /O&lt;&amp;&quot;&#39;&gt;/);
  assert.match(html, /&lt;script&gt;customerName\(\)&lt;\/script&gt;/);
  assert.match(html, /line 1\n&lt;\/div&gt;&lt;script&gt;note\(\)&lt;\/script&gt;/);
  assert.match(html, /SKU&lt;&amp;&quot;&#39;&gt;/);
  assert.match(html, /&lt;\/div&gt;&lt;script&gt;date\(\)&lt;\/script&gt;/);
  assert.match(html, /Content-Security-Policy/);
});

test("print HTML renders safe fallbacks and an empty item row", () => {
  const html = buildMerchantOrderPrintHtml(
    orderFixture({
      siteName: "",
      customer: { name: "", phone: "", email: "", note: "" },
      items: [],
    }),
    { formatDateTime: () => "2026/8/17 14:00:00" },
  );

  assert.match(html, /10000000 · 2026\/8\/17 14:00:00/);
  assert.match(html, /暂无商品/);
  assert.equal((html.match(/<strong>[^<]+：<\/strong>-/g) ?? []).length, 3);
});

test("print wording records attempts without claiming successful output", () => {
  assert.equal(MERCHANT_ORDER_PRINT_STARTED_TEXT, "打印已发起");
  assert.equal(MERCHANT_ORDER_PRINT_ATTEMPT_TEXT, "打印尝试");
  assert.equal(getMerchantOrderPrintAttemptText(0), "打印尝试");
  assert.equal(getMerchantOrderPrintAttemptText(3.9), "打印尝试 (3)");
  assert.equal(getMerchantOrderPrintAttemptText(Number.NaN), "打印尝试");
  assert.equal(getMerchantOrderPrintAttemptText(2).includes("成功"), false);
  assert.equal(getMerchantOrderPrintAttemptText(2).includes("已打印"), false);
});

test("print launcher fails closed outside a browser", () => {
  assert.equal(prepareMerchantOrderPrintWindow(), null);
  assert.equal(startMerchantOrderPrint(orderFixture()), false);
});
