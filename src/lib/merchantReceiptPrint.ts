import {
  createDefaultMerchantReceiptFields,
  type MerchantReceiptContentField,
  type MerchantReceiptFieldSection,
  type MerchantReceiptPrintSettings,
} from "@/lib/merchantMembershipSettings";
import { normalizePublicAssetUrl } from "@/lib/publicAssetUrl";

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
  receiptLocale: "auto",
  headerLogoUrl: "",
  headerLogoWidthPercent: 42,
  title: "积分兑换小票",
  subtitle: "",
  footer: "谢谢惠顾",
  paperWidthMm: 58,
  contentMarginTopMm: 4,
  contentMarginRightMm: 3.5,
  contentMarginBottomMm: 5,
  contentMarginLeftMm: 3.5,
  watermarkEnabled: false,
  watermarkMode: "text",
  watermarkText: "FAOLLA",
  watermarkPattern: "diamond",
  watermarkOpacity: 0.08,
  watermarkFontSizePx: 18,
  watermarkGapMm: 28,
  watermarkRotateDeg: -35,
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

function clampNumber(value: unknown, min: number, max: number, fallback: number, precision = 1) {
  const numberValue = normalizeFiniteNumber(value, fallback);
  const clamped = Math.min(max, Math.max(min, numberValue));
  return Number(clamped.toFixed(precision));
}

function normalizeReceiptFieldLabel(value: unknown, fallback: string) {
  return value === null || value === undefined ? fallback : String(value).trim().slice(0, 80);
}

function normalizeReceiptFieldsForClient(
  value: MerchantReceiptContentField[] | null | undefined,
  legacy: Partial<MerchantReceiptPrintSettings>,
) {
  const defaults = createDefaultMerchantReceiptFields(legacy, legacy.receiptLocale);
  if (!Array.isArray(value)) return defaults;
  const defaultsByKey = new Map(defaults.map((field) => [field.key, field]));
  const seen = new Set<string>();
  const fields: MerchantReceiptContentField[] = [];
  value.forEach((field) => {
    const fallback = defaultsByKey.get(field?.key);
    if (!fallback || seen.has(field.key)) return;
    const fieldRecord = field as MerchantReceiptContentField & { fontSize?: unknown; letterSpacing?: unknown };
    seen.add(field.key);
    fields.push({
      key: fallback.key,
      section: fallback.section,
      label: normalizeReceiptFieldLabel(field.label, fallback.label),
      visible: typeof field.visible === "boolean" ? field.visible : fallback.visible,
      width: field.width === "full" || field.width === "half" || field.width === "third" ? field.width : fallback.width,
      fontSizePx: clampInteger(fieldRecord.fontSizePx ?? fieldRecord.fontSize, 8, 28, fallback.fontSizePx),
      letterSpacingPx: clampNumber(fieldRecord.letterSpacingPx ?? fieldRecord.letterSpacing, 0, 8, fallback.letterSpacingPx),
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
    contentMarginTopMm: clampNumber(
      settings?.contentMarginTopMm,
      0,
      20,
      FALLBACK_PRINT_SETTINGS.contentMarginTopMm,
    ),
    contentMarginRightMm: clampNumber(
      settings?.contentMarginRightMm,
      0,
      20,
      FALLBACK_PRINT_SETTINGS.contentMarginRightMm,
    ),
    contentMarginBottomMm: clampNumber(
      settings?.contentMarginBottomMm,
      0,
      20,
      FALLBACK_PRINT_SETTINGS.contentMarginBottomMm,
    ),
    contentMarginLeftMm: clampNumber(
      settings?.contentMarginLeftMm,
      0,
      20,
      FALLBACK_PRINT_SETTINGS.contentMarginLeftMm,
    ),
    watermarkEnabled: Boolean(settings?.watermarkEnabled ?? FALLBACK_PRINT_SETTINGS.watermarkEnabled),
    watermarkMode: settings?.watermarkMode === "pattern" ? "pattern" : FALLBACK_PRINT_SETTINGS.watermarkMode,
    watermarkText: settings?.watermarkText?.trim().slice(0, 80) || FALLBACK_PRINT_SETTINGS.watermarkText,
    watermarkPattern:
      settings?.watermarkPattern === "dot" ||
      settings?.watermarkPattern === "star" ||
      settings?.watermarkPattern === "slash" ||
      settings?.watermarkPattern === "diamond"
        ? settings.watermarkPattern
        : FALLBACK_PRINT_SETTINGS.watermarkPattern,
    watermarkOpacity: clampNumber(settings?.watermarkOpacity, 0.02, 0.35, FALLBACK_PRINT_SETTINGS.watermarkOpacity, 2),
    watermarkFontSizePx: clampInteger(
      settings?.watermarkFontSizePx,
      10,
      36,
      FALLBACK_PRINT_SETTINGS.watermarkFontSizePx,
    ),
    watermarkGapMm: clampInteger(settings?.watermarkGapMm, 12, 60, FALLBACK_PRINT_SETTINGS.watermarkGapMm),
    watermarkRotateDeg: clampInteger(
      settings?.watermarkRotateDeg,
      -60,
      60,
      FALLBACK_PRINT_SETTINGS.watermarkRotateDeg,
    ),
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
    receiptLocale: settings?.receiptLocale?.trim() || FALLBACK_PRINT_SETTINGS.receiptLocale,
    headerLogoUrl: normalizePublicAssetUrl(settings?.headerLogoUrl?.trim() || ""),
    headerLogoWidthPercent: clampInteger(
      settings?.headerLogoWidthPercent,
      20,
      80,
      FALLBACK_PRINT_SETTINGS.headerLogoWidthPercent,
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
  const field = getReceiptField(settings, key);
  return field ? field.label : fallback;
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

function getReceiptFieldStyleAttribute(field: MerchantReceiptContentField) {
  const fontSizePx = clampInteger(field.fontSizePx, 8, 28, 12);
  const letterSpacingPx = clampNumber(field.letterSpacingPx, 0, 8, 0);
  return ` style="font-size: ${fontSizePx}px; letter-spacing: ${letterSpacingPx}px;"`;
}

function formatReceiptLabelValue(label: string, value: unknown, separator = " ") {
  const text = String(value ?? "");
  if (!text) return "";
  const normalizedLabel = String(label ?? "").trim();
  return normalizedLabel ? `${normalizedLabel}${separator}${text}` : text;
}

function renderReceiptKeyValue(field: MerchantReceiptContentField, value: unknown, className = "") {
  const text = String(value ?? "");
  if (!text) return "";
  const labelHtml = field.label ? `<span>${escapeHtml(field.label)}</span>` : "";
  return `<div class="receipt-field ${getReceiptFieldWidthClass(field)} ${className}"${getReceiptFieldStyleAttribute(field)}>${labelHtml}<strong>${escapeHtml(text)}</strong></div>`;
}

function buildReceiptLinesHtml(settings: MerchantReceiptPrintSettings, receipt: MerchantRedemptionReceiptData) {
  const itemNameField = getReceiptField(settings, "itemName") ?? createDefaultMerchantReceiptFields(settings).find((field) => field.key === "itemName");
  const unitPointsField = getReceiptField(settings, "unitPoints");
  const itemQuantityField = getReceiptField(settings, "itemQuantity");
  const itemSubtotalField = getReceiptField(settings, "itemSubtotal");
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
          return value
            ? `<span${getReceiptFieldStyleAttribute(field)}>${escapeHtml(formatReceiptLabelValue(field.label, value))}</span>`
            : "";
        })
        .filter(Boolean);
      return `
        <tr>
          <td>
            <div class="item-name"${itemNameField ? getReceiptFieldStyleAttribute(itemNameField) : ""}>${escapeHtml(getReceiptLineFieldValue("itemName", line) || itemNameLabel)}</div>
            ${meta.length ? `<div class="muted">${meta.join('<span class="receipt-meta-separator"> / </span>')}</div>` : ""}
          </td>
          ${showUnitPoints ? `<td class="num"${unitPointsField ? getReceiptFieldStyleAttribute(unitPointsField) : ""}>${escapeHtml(getReceiptLineFieldValue("unitPoints", line))}</td>` : ""}
          ${showQuantity ? `<td class="num"${itemQuantityField ? getReceiptFieldStyleAttribute(itemQuantityField) : ""}>${escapeHtml(getReceiptLineFieldValue("itemQuantity", line))}</td>` : ""}
          ${showSubtotal ? `<td class="num strong"${itemSubtotalField ? getReceiptFieldStyleAttribute(itemSubtotalField) : ""}>${escapeHtml(getReceiptLineFieldValue("itemSubtotal", line) || pointText)}</td>` : ""}
        </tr>
      `;
    })
    .join("");
}

function getReceiptWatermarkText(settings: MerchantReceiptPrintSettings) {
  if (!settings.watermarkEnabled) return "";
  if (settings.watermarkMode === "pattern") {
    if (settings.watermarkPattern === "dot") return "•";
    if (settings.watermarkPattern === "star") return "✦";
    if (settings.watermarkPattern === "slash") return "／";
    return "◆";
  }
  return settings.watermarkText.trim();
}

function buildReceiptWatermarkHtml(settings: MerchantReceiptPrintSettings) {
  const text = getReceiptWatermarkText(settings);
  if (!text) return "";
  return `<div class="receipt-watermark" aria-hidden="true">${Array.from(
    { length: 120 },
    () => `<span>${escapeHtml(text)}</span>`,
  ).join("")}</div>`;
}

function buildReceiptPageHtml(settings: MerchantReceiptPrintSettings, receipt: MerchantRedemptionReceiptData) {
  const headerLogoUrl = normalizePublicAssetUrl(settings.headerLogoUrl);
  const headerLogoHtml = headerLogoUrl
    ? `<img class="receipt-logo" src="${escapeHtml(headerLogoUrl)}" alt="" />`
    : "";
  const headerFieldsHtml = getVisibleReceiptFields(settings, "header")
    .map((field) => {
      const value = getReceiptFieldValue(field.key, receipt);
      return value
        ? `<div class="${field.key === "siteId" ? "muted" : ""}"${getReceiptFieldStyleAttribute(field)}>${escapeHtml(value)}</div>`
        : "";
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
  const itemNameField = getReceiptField(settings, "itemName");
  const unitPointsField = getReceiptField(settings, "unitPoints");
  const itemQuantityField = getReceiptField(settings, "itemQuantity");
  const itemSubtotalField = getReceiptField(settings, "itemSubtotal");
  const showUnitPoints = isReceiptFieldVisible(settings, "unitPoints");
  const showQuantity = isReceiptFieldVisible(settings, "itemQuantity");
  const showSubtotal = isReceiptFieldVisible(settings, "itemSubtotal");
  return `
    <section class="receipt-page">
      ${buildReceiptWatermarkHtml(settings)}
      <div class="receipt-content">
        <header class="receipt-header">
          ${headerLogoHtml}
          <h1>${escapeHtml(settings.title)}</h1>
          ${settings.subtitle ? `<div class="subtitle">${escapeHtml(settings.subtitle)}</div>` : ""}
          ${headerFieldsHtml}
        </header>
        ${metaFieldsHtml ? `<div class="receipt-meta">${metaFieldsHtml}</div>` : ""}
        <table class="receipt-lines">
          <thead>
            <tr>
              <th${itemNameField ? getReceiptFieldStyleAttribute(itemNameField) : ""}>${escapeHtml(itemNameLabel)}</th>
              ${showUnitPoints ? `<th${unitPointsField ? getReceiptFieldStyleAttribute(unitPointsField) : ""}>${escapeHtml(getReceiptFieldLabel(settings, "unitPoints", "单价"))}</th>` : ""}
              ${showQuantity ? `<th${itemQuantityField ? getReceiptFieldStyleAttribute(itemQuantityField) : ""}>${escapeHtml(getReceiptFieldLabel(settings, "itemQuantity", "数量"))}</th>` : ""}
              ${showSubtotal ? `<th${itemSubtotalField ? getReceiptFieldStyleAttribute(itemSubtotalField) : ""}>${escapeHtml(getReceiptFieldLabel(settings, "itemSubtotal", "小计"))}</th>` : ""}
            </tr>
          </thead>
          <tbody>${buildReceiptLinesHtml(settings, receipt)}</tbody>
        </table>
        ${summaryFieldsHtml ? `<div class="receipt-total">${summaryFieldsHtml}</div>` : ""}
        ${noteField && receipt.note ? `<div class="receipt-note"${getReceiptFieldStyleAttribute(noteField)}>${escapeHtml(formatReceiptLabelValue(noteField.label, receipt.note, "："))}</div>` : ""}
        ${footerTextField && settings.footer ? `<footer${getReceiptFieldStyleAttribute(footerTextField)}>${escapeHtml(settings.footer)}</footer>` : ""}
      </div>
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
      position: relative;
      overflow: hidden;
      width: ${settings.paperWidthMm}mm;
      padding: ${settings.contentMarginTopMm}mm ${settings.contentMarginRightMm}mm ${settings.contentMarginBottomMm}mm ${settings.contentMarginLeftMm}mm;
      break-after: page;
    }
    .receipt-page:last-child { break-after: auto; }
    .receipt-content {
      position: relative;
      z-index: 1;
    }
    .receipt-watermark {
      position: absolute;
      inset: 0;
      z-index: 0;
      pointer-events: none;
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(${settings.watermarkGapMm}mm, 1fr));
      grid-auto-rows: ${settings.watermarkGapMm}mm;
      align-items: center;
      justify-items: center;
      overflow: hidden;
      color: #000;
      opacity: ${settings.watermarkOpacity};
      font-size: ${settings.watermarkFontSizePx}px;
      font-weight: 800;
      line-height: 1;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .receipt-watermark span {
      transform: rotate(${settings.watermarkRotateDeg}deg);
      white-space: nowrap;
    }
    .receipt-header {
      text-align: center;
      border-bottom: 1px dashed #000;
      padding-bottom: 6px;
      margin-bottom: 6px;
    }
    .receipt-logo {
      display: block;
      width: ${settings.headerLogoWidthPercent}%;
      height: auto;
      object-fit: contain;
      margin: 0 auto 5px;
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
  if (!String(left ?? "").trim()) return clipText(right, width);
  const rightText = clipText(right, Math.max(8, Math.floor(width * 0.45)));
  const leftWidth = Math.max(4, width - textWidth(rightText) - 1);
  const leftText = clipText(left, leftWidth);
  return `${padRightByWidth(leftText, leftWidth)} ${rightText}`;
}

function receiptDivider(width: number, char = "-") {
  return char.repeat(width);
}

function getReceiptTextBaseColumns(paperWidthMm: number) {
  return paperWidthMm >= 76 ? 48 : 32;
}

function getReceiptTextColumns(settings: MerchantReceiptPrintSettings) {
  const baseWidth = getReceiptTextBaseColumns(settings.paperWidthMm);
  const leftColumns = Math.round((settings.contentMarginLeftMm / settings.paperWidthMm) * baseWidth);
  const rightColumns = Math.round((settings.contentMarginRightMm / settings.paperWidthMm) * baseWidth);
  return Math.max(18, baseWidth - Math.max(0, leftColumns) - Math.max(0, rightColumns));
}

export function buildRedemptionReceiptText(
  inputSettings: MerchantReceiptPrintSettings | null | undefined,
  receipt: MerchantRedemptionReceiptData,
) {
  const settings = normalizeReceiptPrintSettingsForClient(inputSettings);
  const width = getReceiptTextColumns(settings);
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
          return formatReceiptLabelValue(field.label, value);
        })
        .filter(Boolean);
      if (meta.length) lines.push(`  ${clipText(meta.join(" / "), Math.max(0, width - 2))}`);
      const unitParts = [
        showUnitPoints
          ? formatReceiptLabelValue(getReceiptFieldLabel(settings, "unitPoints", "单价"), getReceiptLineFieldValue("unitPoints", line))
          : "",
        showQuantity
          ? formatReceiptLabelValue(getReceiptFieldLabel(settings, "itemQuantity", "数量"), getReceiptLineFieldValue("itemQuantity", line))
          : "",
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
      lines.push(clipText(formatReceiptLabelValue(noteField.label, receipt.note, "："), width));
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
        printMode: settings.cutPaperAfterPrint || settings.headerLogoUrl ? "escpos" : "text",
        cutPaperAfterPrint: settings.cutPaperAfterPrint,
        cutPaperMode: settings.cutPaperMode,
        feedLinesBeforeCut: settings.feedLinesBeforeCut,
        contentMarginTopMm: settings.contentMarginTopMm,
        contentMarginRightMm: settings.contentMarginRightMm,
        contentMarginBottomMm: settings.contentMarginBottomMm,
        contentMarginLeftMm: settings.contentMarginLeftMm,
        headerLogoUrl: settings.headerLogoUrl,
        headerLogoWidthPercent: settings.headerLogoWidthPercent,
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
  if (
    !normalizedSettings.enabled ||
    !normalizedSettings.autoPrintRedemptionReceipt ||
    !normalizedSettings.silentPrintEnabled
  ) {
    return false;
  }
  void printRedemptionReceiptWithLocalBridge(normalizedSettings, receipt);
  return true;
}
