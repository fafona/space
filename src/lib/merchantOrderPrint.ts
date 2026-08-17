import {
  formatMerchantOrderAmount,
  getMerchantOrderStatusLabel,
  type MerchantOrderRecord,
} from "@/lib/merchantOrders";

export const MERCHANT_ORDER_PRINT_STARTED_TEXT = "打印已发起";
export const MERCHANT_ORDER_PRINT_ATTEMPT_TEXT = "打印尝试";

export type MerchantOrderPrintHtmlOptions = {
  formatDateTime?: (value: string) => string;
};

const HTML_ESCAPE_PATTERN = /[&<>"']/g;
const HTML_ESCAPE_REPLACEMENTS: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(value: unknown) {
  return String(value ?? "").replace(
    HTML_ESCAPE_PATTERN,
    (character) => HTML_ESCAPE_REPLACEMENTS[character] ?? character,
  );
}

function formatPrintDateTime(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { hour12: false });
}

function printText(value: unknown, fallback = "-") {
  const normalized = typeof value === "string" ? value.trim() : String(value ?? "").trim();
  return escapeHtml(normalized || fallback);
}

export function getMerchantOrderPrintAttemptText(printCount: number) {
  const normalizedCount = Number.isFinite(printCount) ? Math.max(0, Math.trunc(printCount)) : 0;
  return normalizedCount > 0
    ? `${MERCHANT_ORDER_PRINT_ATTEMPT_TEXT} (${normalizedCount})`
    : MERCHANT_ORDER_PRINT_ATTEMPT_TEXT;
}

export function buildMerchantOrderPrintHtml(
  order: MerchantOrderRecord,
  options: MerchantOrderPrintHtmlOptions = {},
) {
  const formatDateTime = options.formatDateTime ?? formatPrintDateTime;
  const createdAtText = printText(formatDateTime(order.createdAt));
  const orderIdText = printText(order.id);
  const siteText = printText(order.siteName || order.siteId);
  const customer = order.customer ?? { name: "", phone: "", email: "", note: "" };
  const items = Array.isArray(order.items) ? order.items : [];
  const itemRows = items.length
    ? items
        .map(
          (item) => `
        <tr>
          <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;">${printText(item.name, "未命名产品")}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;">${printText(item.code)}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;text-align:center;">${printText(item.quantity, "0")}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;text-align:right;">${printText(item.unitPriceText)}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;text-align:right;">${printText(formatMerchantOrderAmount(item.subtotal, order.pricePrefix))}</td>
        </tr>`,
        )
        .join("")
    : `
        <tr>
          <td colspan="5" style="padding:16px 10px;text-align:center;color:#64748b;">暂无商品</td>
        </tr>`;
  const note = typeof customer.note === "string" ? customer.note.trim() : "";

  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'" />
    <meta name="referrer" content="no-referrer" />
    <title>订单 ${orderIdText}</title>
  </head>
  <body style="font-family:Segoe UI,Microsoft YaHei,sans-serif;padding:24px;color:#0f172a;">
    <h1 style="margin:0 0 8px;font-size:28px;">订单 ${orderIdText}</h1>
    <div style="margin-bottom:18px;color:#475569;">${siteText} · ${createdAtText}</div>
    <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-bottom:20px;">
      <div><strong>姓名：</strong>${printText(customer.name)}</div>
      <div><strong>电话：</strong>${printText(customer.phone)}</div>
      <div><strong>邮箱：</strong>${printText(customer.email)}</div>
      <div><strong>状态：</strong>${printText(getMerchantOrderStatusLabel(order.status))}</div>
    </div>
    ${note ? `<div style="margin-bottom:20px;white-space:pre-wrap;"><strong>备注：</strong>${escapeHtml(note)}</div>` : ""}
    <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
      <thead>
        <tr>
          <th style="padding:8px 10px;border-bottom:2px solid #cbd5e1;text-align:left;">产品</th>
          <th style="padding:8px 10px;border-bottom:2px solid #cbd5e1;text-align:left;">编号</th>
          <th style="padding:8px 10px;border-bottom:2px solid #cbd5e1;text-align:center;">数量</th>
          <th style="padding:8px 10px;border-bottom:2px solid #cbd5e1;text-align:right;">单价</th>
          <th style="padding:8px 10px;border-bottom:2px solid #cbd5e1;text-align:right;">小计</th>
        </tr>
      </thead>
      <tbody>${itemRows}</tbody>
    </table>
    <div style="text-align:right;font-size:20px;font-weight:700;">合计：${printText(formatMerchantOrderAmount(order.totalAmount, order.pricePrefix))}</div>
  </body>
</html>`;
}

export function prepareMerchantOrderPrintWindow() {
  if (typeof window === "undefined") return null;
  const popup = window.open("", "_blank", "width=920,height=760");
  if (!popup) return null;
  try {
    popup.opener = null;
    popup.document.open();
    popup.document.write(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8" /><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'" /><meta name="referrer" content="no-referrer" /><title>正在核对订单</title></head><body style="font-family:Segoe UI,Microsoft YaHei,sans-serif;padding:24px;color:#475569;">正在核对最新订单内容…</body></html>`);
    popup.document.close();
    return popup;
  } catch {
    popup.close();
    return null;
  }
}

export function startMerchantOrderPrint(
  order: MerchantOrderRecord,
  options: MerchantOrderPrintHtmlOptions = {},
  preparedWindow?: Window | null,
) {
  if (typeof window === "undefined" && preparedWindow === undefined) return false;
  const popup = preparedWindow === undefined ? window.open("", "_blank", "width=920,height=760") : preparedWindow;
  if (!popup) return false;
  try {
    popup.opener = null;
    popup.document.open();
    popup.document.write(buildMerchantOrderPrintHtml(order, options));
    popup.document.close();
    popup.focus();
    popup.print();
    return true;
  } catch {
    popup.close();
    return false;
  }
}
