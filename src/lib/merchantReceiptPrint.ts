import type { MerchantReceiptPrintSettings } from "@/lib/merchantMembershipSettings";

export type MerchantRedemptionReceiptLine = {
  code: string;
  name: string;
  categoryName: string;
  quantity: number;
  unitPoints: number;
  subtotalPoints: number;
  couponDiscountLabel: string;
  couponPointDiscount: number;
};

export type MerchantRedemptionReceiptData = {
  receiptNo: string;
  siteId: string;
  siteName: string;
  memberName: string;
  memberNo: string;
  beforePointBalance: number;
  afterPointBalance: number;
  totalQuantity: number;
  grossPoints: number;
  couponPointDiscountTotal: number;
  totalPoints: number;
  note: string;
  createdAt: Date;
  lines: MerchantRedemptionReceiptLine[];
};

const FALLBACK_PRINT_SETTINGS: MerchantReceiptPrintSettings = {
  enabled: true,
  autoPrintRedemptionReceipt: true,
  title: "积分兑换小票",
  subtitle: "",
  footer: "谢谢惠顾",
  paperWidthMm: 58,
  fontSizePx: 12,
  copies: 1,
  showMerchantName: true,
  showSiteId: false,
  showMemberName: true,
  showMemberNo: true,
  showItemCode: true,
  showItemCategory: false,
  showUnitPoints: true,
  showCouponDiscount: true,
  showNote: true,
  showTimestamp: true,
};

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalizeFiniteNumber(value: unknown, fallback = 0) {
  const numberValue = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
}

function clampInteger(value: unknown, min: number, max: number, fallback: number) {
  const numberValue = normalizeFiniteNumber(value, fallback);
  return Math.min(max, Math.max(min, Math.round(numberValue)));
}

export function normalizeReceiptPrintSettingsForClient(settings: MerchantReceiptPrintSettings | null | undefined) {
  return {
    ...FALLBACK_PRINT_SETTINGS,
    ...(settings ?? {}),
    title: settings?.title?.trim() || FALLBACK_PRINT_SETTINGS.title,
    subtitle: settings?.subtitle?.trim() || "",
    footer: settings?.footer?.trim() || FALLBACK_PRINT_SETTINGS.footer,
    paperWidthMm: clampInteger(settings?.paperWidthMm, 40, 120, FALLBACK_PRINT_SETTINGS.paperWidthMm),
    fontSizePx: clampInteger(settings?.fontSizePx, 9, 18, FALLBACK_PRINT_SETTINGS.fontSizePx),
    copies: clampInteger(settings?.copies, 1, 3, FALLBACK_PRINT_SETTINGS.copies),
  };
}

export function formatReceiptDateTime(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(
    date.getMinutes(),
  )}:${pad(date.getSeconds())}`;
}

export function formatReceiptPoints(value: unknown) {
  return String(Math.round(normalizeFiniteNumber(value)));
}

function buildReceiptLinesHtml(settings: MerchantReceiptPrintSettings, receipt: MerchantRedemptionReceiptData) {
  return receipt.lines
    .map((line) => {
      const meta = [
        settings.showItemCode && line.code ? `编号 ${line.code}` : "",
        settings.showItemCategory && line.categoryName ? line.categoryName : "",
        line.couponDiscountLabel || "",
      ].filter(Boolean);
      const pointText =
        line.couponPointDiscount > 0
          ? `-${formatReceiptPoints(line.couponPointDiscount)}`
          : formatReceiptPoints(line.subtotalPoints);
      return `
        <tr>
          <td>
            <div class="item-name">${escapeHtml(line.name)}</div>
            ${meta.length ? `<div class="muted">${escapeHtml(meta.join(" / "))}</div>` : ""}
          </td>
          ${settings.showUnitPoints ? `<td class="num">${escapeHtml(formatReceiptPoints(line.unitPoints))}</td>` : ""}
          <td class="num">${escapeHtml(line.quantity)}</td>
          <td class="num strong">${escapeHtml(pointText)}</td>
        </tr>
      `;
    })
    .join("");
}

function buildReceiptPageHtml(settings: MerchantReceiptPrintSettings, receipt: MerchantRedemptionReceiptData) {
  const memberParts = [
    settings.showMemberName && receipt.memberName ? receipt.memberName : "",
    settings.showMemberNo && receipt.memberNo ? receipt.memberNo : "",
  ].filter(Boolean);
  return `
    <section class="receipt-page">
      <header class="receipt-header">
        <h1>${escapeHtml(settings.title)}</h1>
        ${settings.subtitle ? `<div class="subtitle">${escapeHtml(settings.subtitle)}</div>` : ""}
        ${settings.showMerchantName && receipt.siteName ? `<div>${escapeHtml(receipt.siteName)}</div>` : ""}
        ${settings.showSiteId && receipt.siteId ? `<div class="muted">site:${escapeHtml(receipt.siteId)}</div>` : ""}
      </header>
      <div class="receipt-meta">
        <div><span>小票号</span><strong>${escapeHtml(receipt.receiptNo)}</strong></div>
        ${settings.showTimestamp ? `<div><span>时间</span><strong>${escapeHtml(formatReceiptDateTime(receipt.createdAt))}</strong></div>` : ""}
        ${memberParts.length ? `<div><span>会员</span><strong>${escapeHtml(memberParts.join(" / "))}</strong></div>` : ""}
      </div>
      <table class="receipt-lines">
        <thead>
          <tr>
            <th>项目</th>
            ${settings.showUnitPoints ? "<th>单价</th>" : ""}
            <th>数量</th>
            <th>小计</th>
          </tr>
        </thead>
        <tbody>${buildReceiptLinesHtml(settings, receipt)}</tbody>
      </table>
      <div class="receipt-total">
        <div><span>项目数</span><strong>${escapeHtml(receipt.totalQuantity)}</strong></div>
        <div><span>原始积分</span><strong>${escapeHtml(formatReceiptPoints(receipt.grossPoints))}</strong></div>
        ${
          settings.showCouponDiscount && receipt.couponPointDiscountTotal > 0
            ? `<div><span>卡券抵扣</span><strong>-${escapeHtml(formatReceiptPoints(receipt.couponPointDiscountTotal))}</strong></div>`
            : ""
        }
        <div class="grand"><span>扣减积分</span><strong>${escapeHtml(formatReceiptPoints(receipt.totalPoints))}</strong></div>
        <div><span>结算前积分</span><strong>${escapeHtml(formatReceiptPoints(receipt.beforePointBalance))}</strong></div>
        <div><span>结算后积分</span><strong>${escapeHtml(formatReceiptPoints(receipt.afterPointBalance))}</strong></div>
      </div>
      ${settings.showNote && receipt.note ? `<div class="receipt-note">备注：${escapeHtml(receipt.note)}</div>` : ""}
      ${settings.footer ? `<footer>${escapeHtml(settings.footer)}</footer>` : ""}
    </section>
  `;
}

export function buildRedemptionReceiptHtml(
  inputSettings: MerchantReceiptPrintSettings | null | undefined,
  receipt: MerchantRedemptionReceiptData,
) {
  const settings = normalizeReceiptPrintSettingsForClient(inputSettings);
  const pages = Array.from({ length: settings.copies }, () => buildReceiptPageHtml(settings, receipt)).join("");
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(settings.title)}</title>
  <style>
    @page { size: ${settings.paperWidthMm}mm auto; margin: 0; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: #fff;
      color: #000;
      font-family: Arial, "Microsoft YaHei", sans-serif;
      font-size: ${settings.fontSizePx}px;
      line-height: 1.35;
    }
    .receipt-page {
      width: ${settings.paperWidthMm}mm;
      padding: 4mm 3.5mm 5mm;
      break-after: page;
    }
    .receipt-page:last-child { break-after: auto; }
    .receipt-header {
      text-align: center;
      border-bottom: 1px dashed #000;
      padding-bottom: 6px;
      margin-bottom: 6px;
    }
    h1 {
      margin: 0 0 4px;
      font-size: ${settings.fontSizePx + 4}px;
      line-height: 1.15;
    }
    .subtitle, .muted {
      color: #333;
      font-size: ${Math.max(9, settings.fontSizePx - 1)}px;
    }
    .receipt-meta, .receipt-total {
      display: grid;
      gap: 3px;
      padding: 4px 0;
      border-bottom: 1px dashed #000;
    }
    .receipt-meta div, .receipt-total div {
      display: flex;
      justify-content: space-between;
      gap: 8px;
    }
    .receipt-lines {
      width: 100%;
      border-collapse: collapse;
      margin: 6px 0;
    }
    th, td {
      padding: 3px 0;
      vertical-align: top;
      border-bottom: 1px dashed #999;
    }
    th {
      text-align: left;
      font-size: ${Math.max(9, settings.fontSizePx - 1)}px;
    }
    th:not(:first-child), td.num { text-align: right; white-space: nowrap; }
    .item-name { font-weight: 700; }
    .strong, .grand { font-weight: 800; }
    .grand {
      border-top: 1px solid #000;
      margin-top: 3px;
      padding-top: 4px;
      font-size: ${settings.fontSizePx + 1}px;
    }
    .receipt-note {
      margin-top: 6px;
      padding-top: 5px;
      border-top: 1px dashed #000;
      word-break: break-word;
    }
    footer {
      margin-top: 8px;
      text-align: center;
      font-weight: 700;
    }
  </style>
</head>
<body>${pages}</body>
</html>`;
}

export function printHtmlDocument(html: string) {
  if (typeof window === "undefined" || typeof document === "undefined") return false;
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  iframe.style.opacity = "0";
  document.body.appendChild(iframe);

  const iframeWindow = iframe.contentWindow;
  const iframeDocument = iframeWindow?.document;
  if (!iframeWindow || !iframeDocument) {
    iframe.remove();
    return false;
  }

  const cleanup = () => {
    window.setTimeout(() => iframe.remove(), 500);
  };
  iframeWindow.addEventListener("afterprint", cleanup, { once: true });
  iframeDocument.open();
  iframeDocument.write(html);
  iframeDocument.close();

  window.setTimeout(() => {
    try {
      iframeWindow.focus();
      iframeWindow.print();
    } catch {
      cleanup();
    }
  }, 80);
  window.setTimeout(cleanup, 8000);
  return true;
}

export function printRedemptionReceipt(
  settings: MerchantReceiptPrintSettings | null | undefined,
  receipt: MerchantRedemptionReceiptData,
) {
  const normalizedSettings = normalizeReceiptPrintSettingsForClient(settings);
  if (!normalizedSettings.enabled || !normalizedSettings.autoPrintRedemptionReceipt) return false;
  return printHtmlDocument(buildRedemptionReceiptHtml(normalizedSettings, receipt));
}
