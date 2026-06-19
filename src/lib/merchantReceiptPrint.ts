import {
  createDefaultMerchantReceiptFields,
  type MerchantReceiptContentField,
  type MerchantReceiptFieldSection,
  type MerchantReceiptPrintSettings,
} from "@/lib/merchantMembershipSettings";

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
  silentPrintEnabled: false,
  localPrintBridgeUrl: "http://127.0.0.1:17658",
  localPrinterName: "",
  fallbackToBrowserPrint: true,
  cutPaperAfterPrint: false,
  cutPaperMode: "partial",
  feedLinesBeforeCut: 4,
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
  receiptFields: createDefaultMerchantReceiptFields(),
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

function normalizeReceiptFieldsForClient(
  value: MerchantReceiptContentField[] | null | undefined,
  legacy: Partial<MerchantReceiptPrintSettings>,
) {
  const defaults = createDefaultMerchantReceiptFields(legacy);
  if (!Array.isArray(value)) return defaults;
  const defaultsByKey = new Map(defaults.map((field) => [field.key, field]));
  const seen = new Set<string>();
  const fields: MerchantReceiptContentField[] = [];
  value.forEach((field) => {
    const fallback = defaultsByKey.get(field?.key);
    if (!fallback || seen.has(field.key)) return;
    seen.add(field.key);
    fields.push({
      key: fallback.key,
      section: fallback.section,
      label: field.label?.trim() || fallback.label,
      visible: typeof field.visible === "boolean" ? field.visible : fallback.visible,
      width: field.width === "full" || field.width === "half" || field.width === "third" ? field.width : fallback.width,
    });
  });
  defaults.forEach((field) => {
    if (!seen.has(field.key)) fields.push(field);
  });
  return fields;
}

export function normalizeReceiptPrintSettingsForClient(settings: MerchantReceiptPrintSettings | null | undefined) {
  const normalized = {
    ...FALLBACK_PRINT_SETTINGS,
    ...(settings ?? {}),
    title: settings?.title?.trim() || FALLBACK_PRINT_SETTINGS.title,
    subtitle: settings?.subtitle?.trim() || "",
    footer: settings?.footer?.trim() || FALLBACK_PRINT_SETTINGS.footer,
    localPrintBridgeUrl:
      settings?.localPrintBridgeUrl?.trim().replace(/\/+$/, "") || FALLBACK_PRINT_SETTINGS.localPrintBridgeUrl,
    localPrinterName: settings?.localPrinterName?.trim() || "",
    paperWidthMm: clampInteger(settings?.paperWidthMm, 40, 120, FALLBACK_PRINT_SETTINGS.paperWidthMm),
    fontSizePx: clampInteger(settings?.fontSizePx, 9, 18, FALLBACK_PRINT_SETTINGS.fontSizePx),
    copies: clampInteger(settings?.copies, 1, 3, FALLBACK_PRINT_SETTINGS.copies),
    cutPaperAfterPrint: Boolean(settings?.cutPaperAfterPrint ?? FALLBACK_PRINT_SETTINGS.cutPaperAfterPrint),
    cutPaperMode: settings?.cutPaperMode === "full" ? "full" : FALLBACK_PRINT_SETTINGS.cutPaperMode,
    feedLinesBeforeCut: clampInteger(
      settings?.feedLinesBeforeCut,
      0,
      10,
      FALLBACK_PRINT_SETTINGS.feedLinesBeforeCut,
    ),
  };
  return {
    ...normalized,
    receiptFields: normalizeReceiptFieldsForClient(settings?.receiptFields, normalized),
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

export function getReceiptFieldsBySection(
  settings: MerchantReceiptPrintSettings,
  section: MerchantReceiptFieldSection,
) {
  return settings.receiptFields.filter((field) => field.section === section);
}

export function getVisibleReceiptFields(
  settings: MerchantReceiptPrintSettings,
  section: MerchantReceiptFieldSection,
) {
  return getReceiptFieldsBySection(settings, section).filter((field) => field.visible);
}

function getReceiptField(settings: MerchantReceiptPrintSettings, key: string) {
  return settings.receiptFields.find((field) => field.key === key);
}

export function isReceiptFieldVisible(settings: MerchantReceiptPrintSettings, key: string) {
  return getReceiptField(settings, key)?.visible !== false;
}

export function getReceiptFieldLabel(settings: MerchantReceiptPrintSettings, key: string, fallback: string) {
  return getReceiptField(settings, key)?.label || fallback;
}

export function getReceiptFieldValue(key: string, receipt: MerchantRedemptionReceiptData) {
  if (key === "merchantName") return receipt.siteName;
  if (key === "siteId") return receipt.siteId ? `site:${receipt.siteId}` : "";
  if (key === "receiptNo") return receipt.receiptNo;
  if (key === "timestamp") return formatReceiptDateTime(receipt.createdAt);
  if (key === "memberName") return receipt.memberName;
  if (key === "memberNo") return receipt.memberNo;
  if (key === "totalQuantity") return receipt.totalQuantity;
  if (key === "grossPoints") return formatReceiptPoints(receipt.grossPoints);
  if (key === "couponDiscountTotal") {
    return receipt.couponPointDiscountTotal > 0 ? `-${formatReceiptPoints(receipt.couponPointDiscountTotal)}` : "";
  }
  if (key === "totalPoints") return formatReceiptPoints(receipt.totalPoints);
  if (key === "beforePointBalance") return formatReceiptPoints(receipt.beforePointBalance);
  if (key === "afterPointBalance") return formatReceiptPoints(receipt.afterPointBalance);
  if (key === "note") return receipt.note;
  return "";
}

export function getReceiptLineFieldValue(key: string, line: MerchantRedemptionReceiptLine) {
  if (key === "itemName") return line.name;
  if (key === "itemCode") return line.code;
  if (key === "itemCategory") return line.categoryName;
  if (key === "unitPoints") return formatReceiptPoints(line.unitPoints);
  if (key === "itemQuantity") return line.quantity;
  if (key === "itemSubtotal") {
    return line.couponPointDiscount > 0 ? `-${formatReceiptPoints(line.couponPointDiscount)}` : formatReceiptPoints(line.subtotalPoints);
  }
  if (key === "couponLineDiscount") return line.couponDiscountLabel;
  return "";
}

function getReceiptFieldWidthClass(field: MerchantReceiptContentField) {
  if (field.width === "half") return "half";
  if (field.width === "third") return "third";
  return "full";
}

function renderReceiptKeyValue(field: MerchantReceiptContentField, value: unknown, className = "") {
  const text = String(value ?? "");
  if (!text) return "";
  return `<div class="receipt-field ${getReceiptFieldWidthClass(field)} ${className}"><span>${escapeHtml(field.label)}</span><strong>${escapeHtml(text)}</strong></div>`;
}

function buildReceiptLinesHtml(settings: MerchantReceiptPrintSettings, receipt: MerchantRedemptionReceiptData) {
  const itemNameLabel = getReceiptFieldLabel(settings, "itemName", "项目");
  const showUnitPoints = isReceiptFieldVisible(settings, "unitPoints");
  const showQuantity = isReceiptFieldVisible(settings, "itemQuantity");
  const showSubtotal = isReceiptFieldVisible(settings, "itemSubtotal");
  const metaFields = getVisibleReceiptFields(settings, "items").filter(
    (field) => !["itemName", "unitPoints", "itemQuantity", "itemSubtotal"].includes(field.key),
  );
  return receipt.lines
    .map((line) => {
      const pointText =
        line.couponPointDiscount > 0
          ? `-${formatReceiptPoints(line.couponPointDiscount)}`
          : formatReceiptPoints(line.subtotalPoints);
      const meta = metaFields
        .map((field) => {
          const value = getReceiptLineFieldValue(field.key, line);
          return value ? `${field.label} ${value}` : "";
        })
        .filter(Boolean);
      return `
        <tr>
          <td>
            <div class="item-name">${escapeHtml(getReceiptLineFieldValue("itemName", line) || itemNameLabel)}</div>
            ${meta.length ? `<div class="muted">${escapeHtml(meta.join(" / "))}</div>` : ""}
          </td>
          ${showUnitPoints ? `<td class="num">${escapeHtml(getReceiptLineFieldValue("unitPoints", line))}</td>` : ""}
          ${showQuantity ? `<td class="num">${escapeHtml(getReceiptLineFieldValue("itemQuantity", line))}</td>` : ""}
          ${showSubtotal ? `<td class="num strong">${escapeHtml(getReceiptLineFieldValue("itemSubtotal", line) || pointText)}</td>` : ""}
        </tr>
      `;
    })
    .join("");
}

function buildReceiptPageHtml(settings: MerchantReceiptPrintSettings, receipt: MerchantRedemptionReceiptData) {
  const headerFieldsHtml = getVisibleReceiptFields(settings, "header")
    .map((field) => {
      const value = getReceiptFieldValue(field.key, receipt);
      return value ? `<div class="${field.key === "siteId" ? "muted" : ""}">${escapeHtml(value)}</div>` : "";
    })
    .join("");
  const metaFieldsHtml = getVisibleReceiptFields(settings, "meta")
    .map((field) => renderReceiptKeyValue(field, getReceiptFieldValue(field.key, receipt)))
    .join("");
  const summaryFieldsHtml = getVisibleReceiptFields(settings, "summary")
    .map((field) => {
      const value = getReceiptFieldValue(field.key, receipt);
      const isGrand = field.key === "totalPoints";
      return renderReceiptKeyValue(field, value, isGrand ? "grand" : "");
    })
    .join("");
  const footerFields = getVisibleReceiptFields(settings, "footer");
  const noteField = footerFields.find((field) => field.key === "note");
  const footerTextField = footerFields.find((field) => field.key === "footerText");
  const itemNameLabel = getReceiptFieldLabel(settings, "itemName", "项目");
  const showUnitPoints = isReceiptFieldVisible(settings, "unitPoints");
  const showQuantity = isReceiptFieldVisible(settings, "itemQuantity");
  const showSubtotal = isReceiptFieldVisible(settings, "itemSubtotal");
  return `
    <section class="receipt-page">
      <header class="receipt-header">
        <h1>${escapeHtml(settings.title)}</h1>
        ${settings.subtitle ? `<div class="subtitle">${escapeHtml(settings.subtitle)}</div>` : ""}
        ${headerFieldsHtml}
      </header>
      ${metaFieldsHtml ? `<div class="receipt-meta">${metaFieldsHtml}</div>` : ""}
      <table class="receipt-lines">
        <thead>
          <tr>
            <th>${escapeHtml(itemNameLabel)}</th>
            ${showUnitPoints ? `<th>${escapeHtml(getReceiptFieldLabel(settings, "unitPoints", "单价"))}</th>` : ""}
            ${showQuantity ? `<th>${escapeHtml(getReceiptFieldLabel(settings, "itemQuantity", "数量"))}</th>` : ""}
            ${showSubtotal ? `<th>${escapeHtml(getReceiptFieldLabel(settings, "itemSubtotal", "小计"))}</th>` : ""}
          </tr>
        </thead>
        <tbody>${buildReceiptLinesHtml(settings, receipt)}</tbody>
      </table>
      ${summaryFieldsHtml ? `<div class="receipt-total">${summaryFieldsHtml}</div>` : ""}
      ${noteField && receipt.note ? `<div class="receipt-note">${escapeHtml(noteField.label)}：${escapeHtml(receipt.note)}</div>` : ""}
      ${footerTextField && settings.footer ? `<footer>${escapeHtml(settings.footer)}</footer>` : ""}
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
      grid-template-columns: repeat(6, minmax(0, 1fr));
      gap: 3px;
      padding: 4px 0;
      border-bottom: 1px dashed #000;
    }
    .receipt-field {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      min-width: 0;
    }
    .receipt-field.full { grid-column: 1 / -1; }
    .receipt-field.half { grid-column: span 3; }
    .receipt-field.third { grid-column: span 2; }
    .receipt-field strong {
      text-align: right;
      word-break: break-word;
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

function textWidth(value: string) {
  let width = 0;
  for (const char of value) {
    width += char.charCodeAt(0) > 255 ? 2 : 1;
  }
  return width;
}

function clipText(value: unknown, maxWidth: number) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  let result = "";
  let width = 0;
  for (const char of text) {
    const charWidth = char.charCodeAt(0) > 255 ? 2 : 1;
    if (width + charWidth > maxWidth) break;
    result += char;
    width += charWidth;
  }
  return result;
}

function padRightByWidth(value: string, width: number) {
  const currentWidth = textWidth(value);
  return `${value}${" ".repeat(Math.max(0, width - currentWidth))}`;
}

function centerByWidth(value: unknown, width: number) {
  const text = clipText(value, width);
  const padding = Math.max(0, width - textWidth(text));
  return `${" ".repeat(Math.floor(padding / 2))}${text}${" ".repeat(Math.ceil(padding / 2))}`;
}

function splitReceiptLine(left: unknown, right: unknown, width: number) {
  const rightText = clipText(right, Math.max(8, Math.floor(width * 0.45)));
  const leftWidth = Math.max(4, width - textWidth(rightText) - 1);
  const leftText = clipText(left, leftWidth);
  return `${padRightByWidth(leftText, leftWidth)} ${rightText}`;
}

function receiptDivider(width: number, char = "-") {
  return char.repeat(width);
}

export function buildRedemptionReceiptText(
  inputSettings: MerchantReceiptPrintSettings | null | undefined,
  receipt: MerchantRedemptionReceiptData,
) {
  const settings = normalizeReceiptPrintSettingsForClient(inputSettings);
  const width = settings.paperWidthMm >= 76 ? 48 : 32;
  const itemFields = getVisibleReceiptFields(settings, "items");
  const itemMetaFields = itemFields.filter(
    (field) => !["itemName", "unitPoints", "itemQuantity", "itemSubtotal"].includes(field.key),
  );
  const showUnitPoints = isReceiptFieldVisible(settings, "unitPoints");
  const showQuantity = isReceiptFieldVisible(settings, "itemQuantity");
  const showSubtotal = isReceiptFieldVisible(settings, "itemSubtotal");
  const buildOneCopy = () => {
    const lines: string[] = [];
    lines.push(centerByWidth(settings.title, width));
    if (settings.subtitle) lines.push(centerByWidth(settings.subtitle, width));
    getVisibleReceiptFields(settings, "header").forEach((field) => {
      const value = getReceiptFieldValue(field.key, receipt);
      if (value) lines.push(centerByWidth(value, width));
    });
    lines.push(receiptDivider(width));
    getVisibleReceiptFields(settings, "meta").forEach((field) => {
      const value = getReceiptFieldValue(field.key, receipt);
      if (value) lines.push(splitReceiptLine(field.label, value, width));
    });
    lines.push(receiptDivider(width));
    receipt.lines.forEach((line) => {
      const itemName = getReceiptLineFieldValue("itemName", line);
      if (itemName) lines.push(clipText(itemName, width));
      const meta = itemMetaFields
        .map((field) => {
          const value = getReceiptLineFieldValue(field.key, line);
          return value ? `${field.label} ${value}` : "";
        })
        .filter(Boolean);
      if (meta.length) lines.push(`  ${clipText(meta.join(" / "), Math.max(0, width - 2))}`);
      const unitParts = [
        showUnitPoints ? `${getReceiptFieldLabel(settings, "unitPoints", "单价")} ${getReceiptLineFieldValue("unitPoints", line)}` : "",
        showQuantity ? `${getReceiptFieldLabel(settings, "itemQuantity", "数量")} ${getReceiptLineFieldValue("itemQuantity", line)}` : "",
      ].filter(Boolean);
      if (showSubtotal) {
        lines.push(splitReceiptLine(unitParts.join(" / "), getReceiptLineFieldValue("itemSubtotal", line), width));
      } else if (unitParts.length) {
        lines.push(clipText(unitParts.join(" / "), width));
      }
    });
    lines.push(receiptDivider(width));
    getVisibleReceiptFields(settings, "summary").forEach((field) => {
      const value = getReceiptFieldValue(field.key, receipt);
      if (value) lines.push(splitReceiptLine(field.label, value, width));
    });
    const footerFields = getVisibleReceiptFields(settings, "footer");
    const noteField = footerFields.find((field) => field.key === "note");
    const footerTextField = footerFields.find((field) => field.key === "footerText");
    if (noteField && receipt.note) {
      lines.push(receiptDivider(width));
      lines.push(`${noteField.label}：${clipText(receipt.note, Math.max(0, width - textWidth(noteField.label) - 2))}`);
    }
    if (footerTextField && settings.footer) {
      lines.push(receiptDivider(width));
      lines.push(centerByWidth(settings.footer, width));
    }
    return lines.join("\n");
  };
  return Array.from({ length: settings.copies }, () => buildOneCopy()).join("\n\n\n");
}

export async function printRedemptionReceiptWithLocalBridge(
  settings: MerchantReceiptPrintSettings,
  receipt: MerchantRedemptionReceiptData,
  timeoutMs = 2500,
) {
  if (typeof window === "undefined") return false;
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${settings.localPrintBridgeUrl}/print`, {
      method: "POST",
      mode: "cors",
      cache: "no-store",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        source: "faolla-web",
        jobType: "redemption-receipt",
        jobName: `FAOLLA-${receipt.receiptNo}`,
        printerName: settings.localPrinterName,
        paperWidthMm: settings.paperWidthMm,
        printMode: settings.cutPaperAfterPrint ? "escpos" : "text",
        cutPaperAfterPrint: settings.cutPaperAfterPrint,
        cutPaperMode: settings.cutPaperMode,
        feedLinesBeforeCut: settings.feedLinesBeforeCut,
        content: buildRedemptionReceiptText(settings, receipt),
      }),
      signal: controller.signal,
    });
    const payload = (await response.json().catch(() => null)) as { ok?: unknown } | null;
    return response.ok && payload?.ok === true;
  } catch {
    return false;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export async function checkLocalPrintBridge(inputSettings: MerchantReceiptPrintSettings | null | undefined) {
  if (typeof window === "undefined") return false;
  const settings = normalizeReceiptPrintSettingsForClient(inputSettings);
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 2000);
  try {
    const response = await fetch(`${settings.localPrintBridgeUrl}/health`, {
      method: "GET",
      mode: "cors",
      cache: "no-store",
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    const payload = (await response.json().catch(() => null)) as { ok?: unknown } | null;
    return response.ok && payload?.ok === true;
  } catch {
    return false;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export type LocalPrintBridgePrinter = {
  name: string;
  driverName: string;
  portName: string;
  isDefault: boolean;
  status: string;
};

export async function listLocalPrintBridgePrinters(inputSettings: MerchantReceiptPrintSettings | null | undefined) {
  if (typeof window === "undefined") return [] as LocalPrintBridgePrinter[];
  const settings = normalizeReceiptPrintSettingsForClient(inputSettings);
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 3000);
  try {
    const response = await fetch(`${settings.localPrintBridgeUrl}/printers`, {
      method: "GET",
      mode: "cors",
      cache: "no-store",
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    const payload = (await response.json().catch(() => null)) as
      | { ok?: unknown; printers?: LocalPrintBridgePrinter[] }
      | null;
    return response.ok && payload?.ok === true && Array.isArray(payload.printers) ? payload.printers : [];
  } catch {
    return [] as LocalPrintBridgePrinter[];
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export function printRedemptionReceipt(
  settings: MerchantReceiptPrintSettings | null | undefined,
  receipt: MerchantRedemptionReceiptData,
) {
  const normalizedSettings = normalizeReceiptPrintSettingsForClient(settings);
  if (!normalizedSettings.enabled || !normalizedSettings.autoPrintRedemptionReceipt) return false;
  if (normalizedSettings.silentPrintEnabled) {
    void printRedemptionReceiptWithLocalBridge(normalizedSettings, receipt).then((printed) => {
      if (!printed && normalizedSettings.fallbackToBrowserPrint) {
        printHtmlDocument(buildRedemptionReceiptHtml(normalizedSettings, receipt));
      }
    });
    return true;
  }
  return printHtmlDocument(buildRedemptionReceiptHtml(normalizedSettings, receipt));
}
