"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { showGlobalToast } from "@/lib/globalToast";
import {
  MERCHANT_RECEIPT_AUTO_LOCALE,
  applyMerchantReceiptLocaleDefaults,
  applyMerchantReceiptResolvedLocaleDefaults,
  createEmptyMerchantMembershipSettings,
  getMerchantReceiptSystemText,
  normalizeMerchantMembershipSettings,
  type MerchantMembershipSettings,
  type MerchantReceiptContentField,
  type MerchantReceiptFieldSection,
  type MerchantReceiptPrintSettings,
} from "@/lib/merchantMembershipSettings";
import {
  fetchPrintHelperUpdateManifest,
  getReceiptFieldValue,
  getReceiptFieldsBySection,
  getReceiptLineFieldValue,
  getVisibleReceiptFields,
  getPrintHelperManifestLatestVersion,
  getPrintHelperManifestMinimumVersion,
  inspectLocalPrintBridge,
  isPrintHelperVersionOutdated,
  isReceiptFieldVisible,
  inspectLocalPrintBridgeAutoStart,
  listLocalPrintBridgePrinters,
  normalizeReceiptPrintSettingsForClient,
  requestLocalPrintBridgeLaunch,
  requestLocalPrintBridgeUpdate,
  resolvePrintHelperInstallerUrl,
  resolvePrintHelperPackageUrl,
  sendRedemptionReceiptToLocalBridge,
  setLocalPrintBridgeAutoStart,
  type LocalPrintBridgeAutoStartState,
  type LocalPrintBridgeInspection,
  type LocalPrintBridgePrinter,
  type MerchantRedemptionReceiptLine,
  type MerchantRedemptionReceiptData,
  type PrintHelperUpdateManifest,
} from "@/lib/merchantReceiptPrint";
import { LANGUAGE_OPTIONS, resolveSupportedLocale } from "@/lib/i18n";
import { normalizePublicAssetUrl } from "@/lib/publicAssetUrl";
import { runWithMerchantOperationContext } from "@/lib/merchantOperationContext";
import {
  invalidateMerchantAdminDataCachePrefix,
  makeMerchantAdminDataCacheKey,
} from "@/lib/merchantAdminDataCache";

type MerchantPrintSettingsPanelProps = {
  siteId: string;
  siteName?: string;
  siteCountryCode?: string;
  siteCountry?: string;
  className?: string;
};

type MembershipSettingsPayload = {
  ok?: unknown;
  settings?: MerchantMembershipSettings;
  message?: unknown;
  error?: unknown;
};

type PrintSettingsPanelTab = "text" | "content" | "print";
type LocalPrintBridgePanelStatus = "unknown" | "online" | "offline" | "outdated" | "updating";
type ReceiptMarginSide = "top" | "right" | "bottom" | "left";

const RECEIPT_PREVIEW_MM_SCALE = 3.2;
const RECEIPT_MARGIN_MIN_MM = 0;
const RECEIPT_MARGIN_MAX_MM = 20;

const RECEIPT_FIELD_SECTIONS: Array<{ id: MerchantReceiptFieldSection; label: string; hint: string }> = [
  { id: "header", label: "页头", hint: "商户、站点等居中显示内容" },
  { id: "meta", label: "单据信息", hint: "小票号、时间、会员信息" },
  { id: "items", label: "项目明细", hint: "商品/项目行里的内容" },
  { id: "summary", label: "汇总", hint: "积分、抵扣和结算后余额" },
  { id: "footer", label: "页脚", hint: "备注和底部文字" },
];

const RECEIPT_FIELD_WIDTH_OPTIONS = [
  { value: "full", label: "整行" },
  { value: "half", label: "半行" },
  { value: "third", label: "三分之一" },
] as const;

const RECEIPT_PAPER_WIDTH_OPTIONS = [
  { value: 58, label: "58mm（常用小票，驱动常显示 57mm）" },
  { value: 80, label: "80mm（XP-80C / 餐饮常用）" },
  { value: 76, label: "76mm（旧款或厨房票据）" },
  { value: 110, label: "110mm（宽票据，少用）" },
] as const;

const RECEIPT_WATERMARK_MODE_OPTIONS = [
  { value: "text", label: "文字" },
  { value: "pattern", label: "图形符号" },
] as const;

const RECEIPT_WATERMARK_PATTERN_OPTIONS = [
  { value: "diamond", label: "菱形", glyph: "◆" },
  { value: "dot", label: "圆点", glyph: "•" },
  { value: "star", label: "星标", glyph: "✦" },
  { value: "slash", label: "斜线", glyph: "／" },
] as const;

const RECEIPT_WATERMARK_PREVIEW_ROWS = Array.from({ length: 18 }, (_, index) => index);
const RECEIPT_WATERMARK_PREVIEW_COLUMNS = Array.from({ length: 7 }, (_, index) => index);

const RECEIPT_COUNTRY_LOCALE_BY_NAME: Record<string, string> = {
  spain: "es-ES",
  espana: "es-ES",
  "españa": "es-ES",
  西班牙: "es-ES",
  china: "zh-CN",
  中国: "zh-CN",
  taiwan: "zh-TW",
  台湾: "zh-TW",
  japan: "ja-JP",
  日本: "ja-JP",
  korea: "ko-KR",
  韩国: "ko-KR",
};

const RECEIPT_SUPPORTED_LOCALE_CODES = ["zh-CN", "en-GB", "es-ES", "fr-FR", "de-DE", "it-IT", "pt-PT"] as const;
const RECEIPT_SUPPORTED_LOCALE_SET = new Set<string>(RECEIPT_SUPPORTED_LOCALE_CODES);
const RECEIPT_LANGUAGE_OPTIONS = RECEIPT_SUPPORTED_LOCALE_CODES.map(
  (code) => LANGUAGE_OPTIONS.find((item) => item.code === code) ?? { code, label: code, region: "europe", countryCode: "" },
);

function trimText(value: unknown, maxLength = 4096) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function normalizeCountryName(value: unknown) {
  return trimText(value, 120)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function resolveDefaultReceiptLocale(countryCode?: string, country?: string) {
  const code = trimText(countryCode, 8).toUpperCase();
  if (code === "ES") return "es-ES";
  if (code) {
    const matched = LANGUAGE_OPTIONS.find((item) => item.countryCode.toUpperCase() === code);
    if (matched) return resolveReceiptSupportedLocale(matched.code);
  }
  const countryKey = normalizeCountryName(country);
  if (countryKey && RECEIPT_COUNTRY_LOCALE_BY_NAME[countryKey]) {
    return resolveReceiptSupportedLocale(RECEIPT_COUNTRY_LOCALE_BY_NAME[countryKey]);
  }
  return "zh-CN";
}

function resolveReceiptSupportedLocale(locale: string) {
  const resolved = resolveSupportedLocale(locale);
  if (RECEIPT_SUPPORTED_LOCALE_SET.has(resolved)) return resolved;
  const language = resolved.split("-")[0]?.toLowerCase();
  const sameLanguage = RECEIPT_SUPPORTED_LOCALE_CODES.find((item) => item.toLowerCase().startsWith(`${language}-`));
  return sameLanguage ?? "en-GB";
}

function getLanguageOptionLabel(locale: string) {
  const resolved = resolveReceiptSupportedLocale(locale);
  const option = RECEIPT_LANGUAGE_OPTIONS.find((item) => item.code === resolved);
  return option ? option.label : resolved;
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(reader.error ?? new Error("file_read_failed"));
    reader.readAsDataURL(file);
  });
}

function loadImageElement(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("image_decode_failed"));
    image.src = src;
  });
}

async function compressReceiptLogoDataUrl(file: File, dataUrl: string) {
  if (typeof document === "undefined") return dataUrl;
  const mime = String(file.type ?? "").toLowerCase();
  if (mime === "image/svg+xml" || mime === "image/gif") return dataUrl;
  try {
    const image = await loadImageElement(dataUrl);
    const maxWidth = 480;
    const maxHeight = 240;
    const sourceWidth = image.naturalWidth || image.width || 1;
    const sourceHeight = image.naturalHeight || image.height || 1;
    const scale = Math.min(1, maxWidth / sourceWidth, maxHeight / sourceHeight);
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return dataUrl;
    context.clearRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    return canvas.toDataURL("image/png");
  } catch {
    return dataUrl;
  }
}

function dataUrlToBlob(dataUrl: string) {
  const matched = dataUrl.match(/^data:([^;]+);base64,(.*)$/i);
  if (!matched) return null;
  const mime = matched[1]?.toLowerCase() || "application/octet-stream";
  const binary = window.atob(matched[2] ?? "");
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: mime });
}

function getReceiptLogoUploadFileName(file: File, dataUrl: string) {
  const mime = dataUrl.match(/^data:([^;]+);base64,/i)?.[1]?.toLowerCase() || file.type.toLowerCase();
  const extension =
    mime === "image/png"
      ? "png"
      : mime === "image/jpeg"
        ? "jpg"
        : mime === "image/gif"
          ? "gif"
          : mime === "image/svg+xml"
            ? "svg"
            : "webp";
  const baseName = file.name.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9_-]+/g, "-") || "receipt-logo";
  return `${baseName}.${extension}`;
}

async function uploadReceiptLogoBlob(input: {
  blob: Blob;
  fileName: string;
  merchantHint: string;
  operationSummary: string;
}) {
  const formData = new FormData();
  formData.append("file", input.blob, input.fileName);
  formData.append("folder", "merchant-assets");
  formData.append("merchantHint", input.merchantHint);
  formData.append("usage", "generic-image");
  const response = await runWithMerchantOperationContext(
    {
      operationModule: "经营中心 > 打印机",
      operationAction: "上传小票Logo",
      operationSummary: input.operationSummary,
    },
    () =>
      fetch("/api/assets/upload", {
        method: "POST",
        credentials: "same-origin",
        body: formData,
      }),
  );
  const payload = (await response.json().catch(() => null)) as { url?: unknown; message?: unknown; error?: unknown } | null;
  const url = typeof payload?.url === "string" ? payload.url.trim() : "";
  if (!response.ok || !url) {
    const message = typeof payload?.message === "string" ? payload.message : typeof payload?.error === "string" ? payload.error : "";
    throw new Error(message || `Logo 上传失败（${response.status}），请重新选择图片。`);
  }
  return url;
}

function readPayloadMessage(value: unknown, fallback: string) {
  return trimText(value, 1000) || fallback;
}

function isNetworkFetchError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /failed to fetch|fetch failed|networkerror|network request failed|load failed/i.test(message);
}

function readPrintSettingsSaveErrorMessage(error: unknown) {
  if (isNetworkFetchError(error)) return "保存请求没有成功发送，请检查网络后重试。";
  return error instanceof Error ? error.message : "打印配置保存失败，请稍后重试";
}

function readLocalPrintBridgePrintErrorMessage(message: string, bridgeOutdated: boolean) {
  const normalized = message.trim();
  if (bridgeOutdated) {
    return "本机打印助手版本偏旧，请先自动更新或下载安装最新版，再测试打印。";
  }
  if (/ENAMETOOLONG/i.test(normalized)) {
    return "本机打印助手执行小票图片打印时触发命令长度限制，请更新到 1.5.1 或以上版本。";
  }
  if (/default_printer_not_found/i.test(normalized)) {
    return "本机没有默认打印机，请读取本机打印机后选择 XP-80C，或在 Windows 中设置默认打印机。";
  }
  if (/OpenPrinter failed/i.test(normalized)) {
    return "打印机无法打开，请确认打印机名称正确、驱动已安装，并且打印机未离线。";
  }
  if (/StartDocPrinter failed|StartPagePrinter failed/i.test(normalized)) {
    return "打印任务无法进入 Windows 打印队列，请检查打印机驱动和队列状态。";
  }
  if (/WritePrinter failed/i.test(normalized)) {
    return "小票数据写入打印机失败，请检查 USB 连接、驱动端口和打印机状态。";
  }
  if (/timeout|timed out|local_print_bridge_timeout|print_timeout/i.test(normalized)) {
    return "本机打印助手处理超时，请确认打印机没有卡住，并稍后重试。";
  }
  if (/request_too_large/i.test(normalized)) {
    return "小票图片数据过大，请减小 Logo 或水印图片后重试。";
  }
  if (/Failed to fetch|fetch failed|local_print_bridge_unreachable/i.test(normalized)) {
    return "无法连接本机打印助手，请确认助手正在运行。";
  }
  return normalized ? `测试打印失败：${normalized}` : "测试打印失败，请确认打印机和本机助手状态。";
}

function wait(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function inputClassName(extra = "") {
  return `h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-slate-900 ${extra}`;
}

function Field({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={`block text-sm font-medium text-slate-700 ${className}`}>
      <span>{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

function SwitchField({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex min-h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      {label}
    </label>
  );
}

function parseInteger(value: string, min: number, max: number, fallback: number) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

function parseNumberRange(value: string, min: number, max: number, fallback: number, precision = 1) {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Number(Math.min(max, Math.max(min, parsed)).toFixed(precision));
}

function clampReceiptMarginMm(value: number) {
  return Number(Math.min(RECEIPT_MARGIN_MAX_MM, Math.max(RECEIPT_MARGIN_MIN_MM, value)).toFixed(1));
}

function readReceiptMarginValue(settings: MerchantReceiptPrintSettings, side: ReceiptMarginSide) {
  if (side === "top") return settings.contentMarginTopMm;
  if (side === "right") return settings.contentMarginRightMm;
  if (side === "bottom") return settings.contentMarginBottomMm;
  return settings.contentMarginLeftMm;
}

function buildReceiptMarginPatch(side: ReceiptMarginSide, value: number): Partial<MerchantReceiptPrintSettings> {
  const margin = clampReceiptMarginMm(value);
  if (side === "top") return { contentMarginTopMm: margin };
  if (side === "right") return { contentMarginRightMm: margin };
  if (side === "bottom") return { contentMarginBottomMm: margin };
  return { contentMarginLeftMm: margin };
}

function receiptPreviewWidthClass(field: MerchantReceiptContentField) {
  if (field.width === "half") return "col-span-3";
  if (field.width === "third") return "col-span-2";
  return "col-span-6";
}

function receiptFieldPreviewStyle(field: MerchantReceiptContentField) {
  return {
    fontSize: `${field.fontSizePx}px`,
    letterSpacing: `${field.letterSpacingPx}px`,
  };
}

function getReceiptWatermarkText(settings: MerchantReceiptPrintSettings) {
  if (!settings.watermarkEnabled) return "";
  if (settings.watermarkMode === "pattern") {
    return RECEIPT_WATERMARK_PATTERN_OPTIONS.find((option) => option.value === settings.watermarkPattern)?.glyph ?? "◆";
  }
  return settings.watermarkText.trim();
}

function getReceiptWatermarkPreviewRowOffsetPx(rowIndex: number, gapPx: number) {
  const offsets = [-0.22, 0.34, 0.08, 0.52];
  return offsets[rowIndex % offsets.length] * gapPx;
}

function formatPreviewLabelValue(label: string, value: unknown, separator = " ") {
  const text = String(value ?? "");
  if (!text) return "";
  const normalizedLabel = label.trim();
  return normalizedLabel ? `${normalizedLabel}${separator}${text}` : text;
}

function buildPreviewReceipt(siteId: string, siteName: string, receiptLocale: string): MerchantRedemptionReceiptData {
  return {
    receiptNo: "PREVIEW",
    siteId,
    siteName: siteName || "商户名称",
    memberName: "Felix",
    memberNo: "M000001",
    beforePointBalance: 1280,
    afterPointBalance: 1080,
    totalQuantity: 2,
    grossPoints: 260,
    couponPointDiscountTotal: 60,
    totalPoints: 200,
    note: getMerchantReceiptSystemText(receiptLocale, "previewNote"),
    createdAt: new Date(),
    lines: [
      {
        code: "A001",
        name: getMerchantReceiptSystemText(receiptLocale, "previewItemName"),
        categoryName: getMerchantReceiptSystemText(receiptLocale, "previewItemCategory"),
        quantity: 1,
        unitPoints: 160,
        subtotalPoints: 160,
        couponDiscountLabel: "",
        couponPointDiscount: 0,
      },
      {
        code: "COUPON",
        name: getMerchantReceiptSystemText(receiptLocale, "previewCouponName"),
        categoryName: getMerchantReceiptSystemText(receiptLocale, "previewCouponCategory"),
        quantity: 1,
        unitPoints: 100,
        subtotalPoints: 100,
        couponDiscountLabel: getMerchantReceiptSystemText(receiptLocale, "previewCouponDiscountLabel"),
        couponPointDiscount: 60,
      },
    ],
  };
}

export default function MerchantPrintSettingsPanel({
  siteId,
  siteName = "",
  siteCountryCode = "",
  siteCountry = "",
  className = "",
}: MerchantPrintSettingsPanelProps) {
  const normalizedSiteId = siteId.trim();
  const [settings, setSettings] = useState<MerchantMembershipSettings>(() =>
    createEmptyMerchantMembershipSettings(normalizedSiteId),
  );
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [bridgeChecking, setBridgeChecking] = useState(false);
  const [bridgeUpdating, setBridgeUpdating] = useState(false);
  const [bridgeStatus, setBridgeStatus] = useState<LocalPrintBridgePanelStatus>("unknown");
  const [bridgeInspection, setBridgeInspection] = useState<LocalPrintBridgeInspection | null>(null);
  const [bridgeAutoStart, setBridgeAutoStart] = useState<LocalPrintBridgeAutoStartState | null>(null);
  const [bridgeAutoStartChanging, setBridgeAutoStartChanging] = useState(false);
  const [printHelperManifest, setPrintHelperManifest] = useState<PrintHelperUpdateManifest | null>(null);
  const [bridgePrinters, setBridgePrinters] = useState<LocalPrintBridgePrinter[]>([]);
  const [logoUploading, setLogoUploading] = useState(false);
  const [logoPreviewUrl, setLogoPreviewUrl] = useState("");
  const [activeSettingsPanel, setActiveSettingsPanel] = useState<PrintSettingsPanelTab>("text");
  const [activeReceiptSection, setActiveReceiptSection] = useState<MerchantReceiptFieldSection>("meta");
  const [draggingReceiptMargin, setDraggingReceiptMargin] = useState<ReceiptMarginSide | null>(null);
  const [receiptMarginInputDraft, setReceiptMarginInputDraft] = useState<Partial<Record<ReceiptMarginSide, string>>>({});
  const receiptMarginDragRef = useRef<{
    side: ReceiptMarginSide;
    startX: number;
    startY: number;
    startValue: number;
  } | null>(null);

  const activeSettings = useMemo(
    () => normalizeMerchantMembershipSettings(normalizedSiteId, settings),
    [normalizedSiteId, settings],
  );
  const printSettings = useMemo(
    () => normalizeReceiptPrintSettingsForClient(activeSettings.printSettings),
    [activeSettings.printSettings],
  );
  const defaultReceiptLocale = useMemo(
    () => resolveDefaultReceiptLocale(siteCountryCode, siteCountry),
    [siteCountry, siteCountryCode],
  );
  const selectedReceiptLocale =
    printSettings.receiptLocale === MERCHANT_RECEIPT_AUTO_LOCALE
      ? MERCHANT_RECEIPT_AUTO_LOCALE
      : resolveReceiptSupportedLocale(printSettings.receiptLocale);
  const effectiveReceiptLocale =
    selectedReceiptLocale === MERCHANT_RECEIPT_AUTO_LOCALE ? defaultReceiptLocale : selectedReceiptLocale;
  const autoReceiptLocaleLabel = `自动（按所在国家：${getLanguageOptionLabel(defaultReceiptLocale)}）`;
  const previewReceipt = useMemo(
    () => buildPreviewReceipt(normalizedSiteId, siteName, effectiveReceiptLocale),
    [effectiveReceiptLocale, normalizedSiteId, siteName],
  );
  const headerLogoDisplayUrl = logoPreviewUrl || normalizePublicAssetUrl(printSettings.headerLogoUrl);
  const activeReceiptSectionInfo =
    RECEIPT_FIELD_SECTIONS.find((section) => section.id === activeReceiptSection) ?? RECEIPT_FIELD_SECTIONS[0];
  const activeReceiptFields = useMemo(
    () => getReceiptFieldsBySection(printSettings, activeReceiptSectionInfo.id),
    [activeReceiptSectionInfo.id, printSettings],
  );
  const receiptFieldByKey = useMemo(
    () => new Map(printSettings.receiptFields.map((field) => [field.key, field])),
    [printSettings.receiptFields],
  );
  const watermarkPreviewText = useMemo(() => getReceiptWatermarkText(printSettings), [printSettings]);
  const settingsPanelTabClassName = (tab: PrintSettingsPanelTab) =>
    `rounded-2xl border px-4 py-3 text-left text-sm transition ${
      activeSettingsPanel === tab
        ? "border-slate-950 bg-slate-950 text-white shadow-sm"
        : "border-slate-200 bg-slate-50 text-slate-700 hover:border-slate-300 hover:bg-white"
    }`;
  const printHelperLatestVersion = getPrintHelperManifestLatestVersion(printHelperManifest);
  const printHelperMinimumVersion = getPrintHelperManifestMinimumVersion(printHelperManifest);
  const printHelperPackageUrl = resolvePrintHelperPackageUrl(printHelperManifest);
  const printHelperInstallerUrl = resolvePrintHelperInstallerUrl(printHelperManifest);
  const bridgeCurrentVersion = bridgeInspection?.version || "";
  const receiptPreviewPaperWidthPx = Math.min(320, Math.max(220, printSettings.paperWidthMm * RECEIPT_PREVIEW_MM_SCALE));
  const receiptPreviewMarginPx = {
    top: printSettings.contentMarginTopMm * RECEIPT_PREVIEW_MM_SCALE,
    right: printSettings.contentMarginRightMm * RECEIPT_PREVIEW_MM_SCALE,
    bottom: printSettings.contentMarginBottomMm * RECEIPT_PREVIEW_MM_SCALE,
    left: printSettings.contentMarginLeftMm * RECEIPT_PREVIEW_MM_SCALE,
  };
  const bridgeOutdated =
    Boolean(bridgeInspection?.online) && isPrintHelperVersionOutdated(bridgeCurrentVersion, printHelperManifest);
  const bridgeCanSelfUpdate = Boolean(bridgeInspection?.online && bridgeInspection.updateSupported);
  const bridgeStatusLabel =
    bridgeStatus === "online"
      ? "已连接"
      : bridgeStatus === "outdated"
        ? "版本旧"
        : bridgeStatus === "updating"
          ? "更新中"
          : bridgeStatus === "offline"
            ? "未连接"
            : "未检测";
  const bridgeStatusClassName =
    bridgeStatus === "online"
      ? "bg-emerald-50 text-emerald-700"
      : bridgeStatus === "outdated"
        ? "bg-amber-50 text-amber-700"
        : bridgeStatus === "updating"
          ? "bg-blue-50 text-blue-700"
          : bridgeStatus === "offline"
            ? "bg-rose-50 text-rose-700"
            : "bg-slate-100 text-slate-600";

  const renderPreviewItemMeta = useCallback(
    (line: MerchantRedemptionReceiptLine) => {
      const nodes: ReactNode[] = [];
      getVisibleReceiptFields(printSettings, "items")
        .filter((field) => field.key !== "itemName" && field.key !== "itemSubtotal")
        .forEach((field) => {
          const value = getReceiptLineFieldValue(field.key, line);
          if (!value) return;
          if (nodes.length) {
            nodes.push(
              <span key={`${field.key}-separator`} className="text-slate-400">
                {" / "}
              </span>,
            );
          }
          nodes.push(
            <span key={field.key} style={receiptFieldPreviewStyle(field)}>
              {formatPreviewLabelValue(field.label, value)}
            </span>,
          );
        });
      return nodes;
    },
    [printSettings],
  );

  const patchPrintSettings = useCallback((patch: Partial<MerchantReceiptPrintSettings>) => {
    setSettings((current) => ({
      ...current,
      printSettings: normalizeReceiptPrintSettingsForClient({
        ...current.printSettings,
        ...patch,
      }),
    }));
    setNotice("");
    setError("");
  }, []);

  const patchReceiptMargin = useCallback(
    (side: ReceiptMarginSide, value: number) => {
      patchPrintSettings(buildReceiptMarginPatch(side, value));
    },
    [patchPrintSettings],
  );

  const clearReceiptMarginInputDraft = useCallback((side: ReceiptMarginSide) => {
    setReceiptMarginInputDraft((current) => {
      if (!(side in current)) return current;
      const next = { ...current };
      delete next[side];
      return next;
    });
  }, []);

  const getReceiptMarginInputValue = useCallback(
    (side: ReceiptMarginSide) => receiptMarginInputDraft[side] ?? String(readReceiptMarginValue(printSettings, side)),
    [printSettings, receiptMarginInputDraft],
  );

  const handleReceiptMarginInputChange = useCallback(
    (side: ReceiptMarginSide, value: string) => {
      setReceiptMarginInputDraft((current) => ({ ...current, [side]: value }));
      const normalizedValue = value.trim();
      if (!normalizedValue) {
        patchReceiptMargin(side, 0);
        return;
      }
      const parsed = Number.parseFloat(normalizedValue);
      if (!Number.isFinite(parsed)) return;
      patchReceiptMargin(side, parsed);
    },
    [patchReceiptMargin],
  );

  const startReceiptMarginDrag = useCallback(
    (side: ReceiptMarginSide, event: ReactPointerEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      clearReceiptMarginInputDraft(side);
      receiptMarginDragRef.current = {
        side,
        startX: event.clientX,
        startY: event.clientY,
        startValue: readReceiptMarginValue(printSettings, side),
      };
      setDraggingReceiptMargin(side);
    },
    [clearReceiptMarginInputDraft, printSettings],
  );

  useEffect(() => {
    if (!draggingReceiptMargin) return;
    function handlePointerMove(event: PointerEvent) {
      const drag = receiptMarginDragRef.current;
      if (!drag) return;
      const deltaX = (event.clientX - drag.startX) / RECEIPT_PREVIEW_MM_SCALE;
      const deltaY = (event.clientY - drag.startY) / RECEIPT_PREVIEW_MM_SCALE;
      const nextValue =
        drag.side === "top"
          ? drag.startValue + deltaY
          : drag.side === "bottom"
            ? drag.startValue - deltaY
            : drag.side === "left"
              ? drag.startValue + deltaX
              : drag.startValue - deltaX;
      patchReceiptMargin(drag.side, nextValue);
    }
    function stopDragging() {
      receiptMarginDragRef.current = null;
      setDraggingReceiptMargin(null);
    }
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopDragging);
    window.addEventListener("pointercancel", stopDragging);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopDragging);
      window.removeEventListener("pointercancel", stopDragging);
    };
  }, [draggingReceiptMargin, patchReceiptMargin]);

  const applyReceiptLocale = useCallback(
    (nextLocale: string) => {
      const shouldUseAuto = nextLocale === MERCHANT_RECEIPT_AUTO_LOCALE;
      const effectiveLocale = shouldUseAuto ? defaultReceiptLocale : resolveReceiptSupportedLocale(nextLocale);
      const localized = applyMerchantReceiptLocaleDefaults(
        {
          ...printSettings,
          receiptLocale: shouldUseAuto ? MERCHANT_RECEIPT_AUTO_LOCALE : effectiveLocale,
        },
        effectiveLocale,
      );
      patchPrintSettings({
        ...localized,
        receiptLocale: shouldUseAuto ? MERCHANT_RECEIPT_AUTO_LOCALE : effectiveLocale,
      });
    },
    [defaultReceiptLocale, patchPrintSettings, printSettings],
  );

  const patchReceiptField = useCallback(
    (key: string, patch: Partial<MerchantReceiptContentField>) => {
      patchPrintSettings({
        receiptFields: printSettings.receiptFields.map((field) =>
          field.key === key
            ? {
                ...field,
                ...patch,
              }
            : field,
        ),
      });
    },
    [patchPrintSettings, printSettings.receiptFields],
  );

  const patchReceiptSectionVisible = useCallback(
    (section: MerchantReceiptFieldSection, visible: boolean) => {
      patchPrintSettings({
        receiptFields: printSettings.receiptFields.map((field) =>
          field.section === section
            ? {
                ...field,
                visible,
              }
            : field,
        ),
      });
    },
    [patchPrintSettings, printSettings.receiptFields],
  );

  const readBridgePanelStatus = useCallback(
    (inspection: LocalPrintBridgeInspection, manifest: PrintHelperUpdateManifest | null) => {
      if (!inspection.online) return "offline" as const;
      return isPrintHelperVersionOutdated(inspection.version, manifest) ? ("outdated" as const) : ("online" as const);
    },
    [],
  );

  const refreshPrintHelperManifest = useCallback(async () => {
    const manifest = await fetchPrintHelperUpdateManifest();
    setPrintHelperManifest(manifest);
    return manifest;
  }, []);

  const downloadPrintHelperInstaller = useCallback(
    (url: string) => {
      if (typeof document === "undefined") return false;
      const link = document.createElement("a");
      link.href = url;
      let pathname = url;
      try {
        pathname = new URL(url, window.location.href).pathname;
      } catch {}
      link.download = pathname.toLowerCase().endsWith(".cmd") ? "install-faolla-print-helper.cmd" : "";
      link.rel = "noreferrer";
      document.body.appendChild(link);
      link.click();
      link.remove();
      return true;
    },
    [],
  );

  const confirmPrintHelperInstallerDownload = useCallback(async () => {
    const manifest = printHelperManifest ?? (await refreshPrintHelperManifest());
    const installerUrl = resolvePrintHelperInstallerUrl(manifest);
    const packageUrl = resolvePrintHelperPackageUrl(manifest);
    const downloadUrl = installerUrl || packageUrl;
    if (!downloadUrl) {
      setError("没有读取到打印助手下载地址，请稍后重试。");
      return false;
    }
    const confirmed = window.confirm(
      "没有连接到本机打印助手。网页不能直接读取或执行 C:\\FAOLLA\\打印助手 中的文件。\n\n是否下载 FAOLLA 打印助手一键安装器？下载后请运行它，安装器会自动安装到固定位置、注册启动协议并启动助手。",
    );
    if (!confirmed) return false;
    downloadPrintHelperInstaller(downloadUrl);
    setNotice("已开始下载打印助手安装器。下载完成后请运行它，安装器会自动安装到 C:\\FAOLLA\\打印助手 并启动助手。");
    showGlobalToast("已开始下载打印助手安装器。下载完成后请运行它完成安装。");
    return true;
  }, [downloadPrintHelperInstaller, printHelperManifest, refreshPrintHelperManifest]);

  const loadSettings = useCallback(async () => {
    if (!/^\d{8}$/.test(normalizedSiteId)) {
      const emptySettings = createEmptyMerchantMembershipSettings(normalizedSiteId);
      setSettings({
        ...emptySettings,
        printSettings: applyMerchantReceiptLocaleDefaults(emptySettings.printSettings, defaultReceiptLocale),
      });
      setError("当前商户资料还没准备好，请稍后重试。");
      return;
    }
    setLoading(true);
    setError("");
    setNotice("");
    try {
      const params = new URLSearchParams({ siteId: normalizedSiteId });
      const response = await fetch(`/api/membership-settings?${params.toString()}`, {
        method: "GET",
        cache: "no-store",
        credentials: "same-origin",
        headers: { accept: "application/json" },
      });
      const payload = (await response.json().catch(() => null)) as MembershipSettingsPayload | null;
      if (!response.ok || payload?.ok !== true || !payload.settings) {
        throw new Error(readPayloadMessage(payload?.message, "打印配置加载失败，请稍后重试"));
      }
      const normalized = normalizeMerchantMembershipSettings(normalizedSiteId, payload.settings);
      setSettings(
        normalized.printSettings.receiptLocale === MERCHANT_RECEIPT_AUTO_LOCALE
          ? {
              ...normalized,
              printSettings: applyMerchantReceiptResolvedLocaleDefaults(normalized.printSettings, defaultReceiptLocale),
            }
          : normalized,
      );
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "打印配置加载失败，请稍后重试");
    } finally {
      setLoading(false);
    }
  }, [defaultReceiptLocale, normalizedSiteId]);

  async function saveSettings() {
    if (saving) return;
    if (logoUploading) {
      setError("Logo 正在上传，请等上传完成后再保存配置。");
      return;
    }
    if (!/^\d{8}$/.test(normalizedSiteId)) {
      setError("当前商户资料还没准备好，请稍后重试。");
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const normalized = normalizeMerchantMembershipSettings(normalizedSiteId, activeSettings);
      let response: Response | null = null;
      let lastNetworkError: unknown = null;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          response = await runWithMerchantOperationContext(
            {
              operationModule: "经营中心 > 打印机",
              operationAction: "保存打印样式",
              operationSummary: "在经营中心 > 打印机保存小票打印样式",
            },
            () =>
              fetch("/api/membership-settings", {
                method: "PATCH",
                cache: "no-store",
                credentials: "same-origin",
                headers: {
                  "Content-Type": "application/json",
                  accept: "application/json",
                },
                body: JSON.stringify({ siteId: normalizedSiteId, printSettings: normalized.printSettings }),
              }),
          );
          lastNetworkError = null;
          break;
        } catch (fetchError) {
          lastNetworkError = fetchError;
          if (!isNetworkFetchError(fetchError) || attempt > 0) break;
          await wait(500);
        }
      }
      if (!response) throw lastNetworkError;
      const payload = (await response.json().catch(() => null)) as MembershipSettingsPayload | null;
      if (!response.ok || payload?.ok !== true || !payload.settings) {
        throw new Error(readPayloadMessage(payload?.message ?? payload?.error, `打印配置保存失败（${response.status}），请稍后重试`));
      }
      setSettings(normalizeMerchantMembershipSettings(normalizedSiteId, payload.settings));
      invalidateMerchantAdminDataCachePrefix(makeMerchantAdminDataCacheKey("merchant-membership-settings", normalizedSiteId));
      setNotice("打印配置已保存");
    } catch (saveError) {
      setError(readPrintSettingsSaveErrorMessage(saveError));
    } finally {
      setSaving(false);
    }
  }

  async function checkBridge() {
    setBridgeChecking(true);
    setError("");
    setNotice("");
    try {
      const [inspection, manifest] = await Promise.all([
        inspectLocalPrintBridge(printSettings),
        refreshPrintHelperManifest(),
      ]);
      const nextStatus = readBridgePanelStatus(inspection, manifest);
      setBridgeInspection(inspection);
      setBridgeStatus(nextStatus);
      if (!inspection.online) {
        setBridgeAutoStart(null);
        setNotice("没有连接到本机打印助手，请先在收银电脑安装并运行 FAOLLA 打印助手。");
      } else if (nextStatus === "outdated") {
        setBridgeAutoStart(null);
        setNotice(`本机打印助手版本 ${inspection.version || "未知"} 偏旧，请更新到 ${getPrintHelperManifestLatestVersion(manifest)}。`);
      } else {
        const autostart = await inspectLocalPrintBridgeAutoStart(printSettings);
        setBridgeAutoStart(autostart);
        setNotice(`本机打印助手已连接，版本 ${inspection.version || "未知"}。`);
      }
    } finally {
      setBridgeChecking(false);
    }
  }

  async function startBridgeHelper() {
    setError("");
    setNotice("");
    const launched = requestLocalPrintBridgeLaunch(printSettings, { direct: true });
    if (!launched) {
      setError("无法请求打开打印助手。请先点击“安装/修复助手”安装或修复启动协议。");
      return;
    }
    setNotice("已请求打开打印助手。若浏览器弹出提示，请允许打开 FAOLLA 打印助手；几秒后会自动重新检测。");
    window.setTimeout(() => {
      void checkBridge();
    }, 3500);
  }

  async function refreshBridgePrinters() {
    setBridgeChecking(true);
    setError("");
    setNotice("");
    try {
      const [inspection, manifest] = await Promise.all([
        inspectLocalPrintBridge(printSettings),
        refreshPrintHelperManifest(),
      ]);
      const nextStatus = readBridgePanelStatus(inspection, manifest);
      setBridgeInspection(inspection);
      setBridgeStatus(nextStatus);
      if (!inspection.online) {
        setBridgePrinters([]);
        setNotice("没有连接到本机打印助手，请先运行助手后再读取打印机。");
        return;
      }
      const printers = await listLocalPrintBridgePrinters(printSettings);
      setBridgePrinters(printers);
      setNotice(printers.length ? `已读取 ${printers.length} 台本机打印机。` : "未读取到打印机，请确认 Windows 已安装打印机驱动。");
    } finally {
      setBridgeChecking(false);
    }
  }

  async function updateBridgeHelper() {
    if (bridgeUpdating) return;
    setBridgeUpdating(true);
    setBridgeChecking(true);
    setBridgeStatus("updating");
    setError("");
    setNotice("");
    try {
      const manifest = printHelperManifest ?? (await refreshPrintHelperManifest());
      if (!manifest) {
        setError("没有读取到打印助手更新清单，请稍后重试。");
        setBridgeStatus(bridgeInspection?.online ? (bridgeOutdated ? "outdated" : "online") : "offline");
        return;
      }
      const inspection = bridgeInspection?.online ? bridgeInspection : await inspectLocalPrintBridge(printSettings);
      setBridgeInspection(inspection);
      if (!inspection.online) {
        setError("没有连接到本机打印助手，无法自动更新。请先下载安装最新版。");
        setBridgeStatus("offline");
        return;
      }
      if (!inspection.updateSupported) {
        setError("当前打印助手版本太旧，不支持自动更新。请下载最新版安装一次，之后即可自动更新。");
        setBridgeStatus("outdated");
        return;
      }
      const started = await requestLocalPrintBridgeUpdate(printSettings);
      if (!started) {
        setError("打印助手自动更新未启动，请下载安装最新版。");
        setBridgeStatus("outdated");
        return;
      }
      setNotice("打印助手正在自动更新并重启，请等待 10 秒后重新检测。");
      window.setTimeout(() => {
        void checkBridge();
      }, 10_000);
    } finally {
      setBridgeUpdating(false);
      setBridgeChecking(false);
    }
  }

  async function updateBridgeAutoStart(enabled: boolean) {
    if (bridgeAutoStartChanging) return;
    setBridgeAutoStartChanging(true);
    setError("");
    setNotice("");
    try {
      const inspection = bridgeInspection?.online ? bridgeInspection : await inspectLocalPrintBridge(printSettings);
      setBridgeInspection(inspection);
      if (!inspection.online) {
        setBridgeStatus("offline");
        setBridgeAutoStart(null);
        setError("没有连接到本机打印助手，无法设置开机自启动。");
        return;
      }
      const nextAutoStart = await setLocalPrintBridgeAutoStart(printSettings, enabled);
      setBridgeAutoStart(nextAutoStart);
      if (!nextAutoStart.supported) {
        setError("当前打印助手版本不支持网页设置开机自启动，请下载最新版或使用安装包里的自启动脚本。");
        return;
      }
      setNotice(nextAutoStart.enabled ? "已启用当前 Windows 用户开机自启动。" : "已取消当前 Windows 用户开机自启动。");
    } finally {
      setBridgeAutoStartChanging(false);
    }
  }

  async function testPrint() {
    setError("");
    setNotice("");
    if (!printSettings.silentPrintEnabled) {
      setError("请先启用本机打印助手静默打印，再测试打印。");
      return;
    }
    setBridgeChecking(true);
    try {
      const [inspection, manifest] = await Promise.all([
        inspectLocalPrintBridge(printSettings),
        refreshPrintHelperManifest(),
      ]);
      const nextStatus = readBridgePanelStatus(inspection, manifest);
      setBridgeInspection(inspection);
      setBridgeStatus(nextStatus);
      if (!inspection.online) {
        setError("无法连接本机打印助手，请确认助手已运行。");
        return;
      }
      if (nextStatus === "outdated") {
        setError(readLocalPrintBridgePrintErrorMessage("", true));
        return;
      }
      const result = await sendRedemptionReceiptToLocalBridge(printSettings, previewReceipt);
      setBridgeStatus(nextStatus);
      if (result.ok) {
        setNotice("测试小票已发送到本机打印助手。");
      } else {
        setError(readLocalPrintBridgePrintErrorMessage(result.message, false));
      }
    } finally {
      setBridgeChecking(false);
    }
  }

  async function handleReceiptLogoUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || logoUploading) return;
    if (!file.type.toLowerCase().startsWith("image/")) {
      setError("仅支持上传图片文件。");
      return;
    }
    setLogoUploading(true);
    setError("");
    setNotice("");
    try {
      const localPreviewUrl = await readFileAsDataUrl(file);
      if (localPreviewUrl) {
        setLogoPreviewUrl(localPreviewUrl);
      }
      const uploadDataUrl = await compressReceiptLogoDataUrl(file, localPreviewUrl);
      const uploadBlob = dataUrlToBlob(uploadDataUrl);
      if (!uploadBlob) {
        throw new Error("Logo 文件解析失败，请重新选择图片。");
      }
      const uploadedUrl = await uploadReceiptLogoBlob({
        blob: uploadBlob,
        fileName: getReceiptLogoUploadFileName(file, uploadDataUrl),
        merchantHint: normalizedSiteId || "receipt-logo",
        operationSummary: "在打印机设置中上传页头Logo",
      });
      if (!uploadedUrl) {
        throw new Error("Logo 上传失败，请重新选择图片。");
      }
      const normalizedUrl = normalizePublicAssetUrl(uploadedUrl);
      patchPrintSettings({ headerLogoUrl: normalizedUrl });
      setLogoPreviewUrl("");
      setNotice("页头 Logo 已上传，请保存配置。");
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Logo 上传失败，请重新选择图片。");
    } finally {
      setLogoUploading(false);
    }
  }

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  useEffect(() => {
    void refreshPrintHelperManifest();
  }, [refreshPrintHelperManifest]);

  useEffect(() => {
    setLogoPreviewUrl("");
  }, [printSettings.headerLogoUrl]);

  useEffect(() => {
    if (!error && !notice) return;
    showGlobalToast(error || notice);
    const timer = window.setTimeout(() => {
      setError("");
      setNotice("");
    }, 3000);
    return () => window.clearTimeout(timer);
  }, [error, notice]);

  return (
    <section className={`space-y-4 py-6 ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold text-slate-950">打印机</h2>
          <p className="mt-1 text-sm text-slate-500">编辑积分兑换小票样式；结算成功后会按这里的配置自动打印。</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            onClick={() => void loadSettings()}
            disabled={loading || saving || logoUploading}
          >
            {loading ? "刷新中..." : "刷新"}
          </button>
          <button
            type="button"
            className="rounded-xl border border-slate-900 bg-white px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-slate-50 disabled:opacity-60"
            onClick={testPrint}
            disabled={saving || logoUploading}
          >
            测试打印
          </button>
          <button
            type="button"
            className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:bg-slate-400"
            onClick={() => void saveSettings()}
            disabled={saving || logoUploading}
          >
            {saving ? "保存中..." : logoUploading ? "Logo 上传中..." : "保存配置"}
          </button>
        </div>
      </div>

      {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}
      {notice ? <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{notice}</div> : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_480px]">
        <div className="flex flex-col gap-4">
          <div className="rounded-[20px] border border-slate-200 bg-white p-2 shadow-[0_10px_28px_rgba(15,23,42,0.04)]">
            <div className="grid gap-2 md:grid-cols-3">
              <button
                type="button"
                className={settingsPanelTabClassName("text")}
                onClick={() => setActiveSettingsPanel("text")}
                aria-pressed={activeSettingsPanel === "text"}
              >
                <span className="block font-semibold">票面文字</span>
                <span className={activeSettingsPanel === "text" ? "mt-1 block text-xs text-slate-200" : "mt-1 block text-xs text-slate-500"}>
                  标题、Logo、水印
                </span>
              </button>
              <button
                type="button"
                className={settingsPanelTabClassName("content")}
                onClick={() => setActiveSettingsPanel("content")}
                aria-pressed={activeSettingsPanel === "content"}
              >
                <span className="block font-semibold">小票内容</span>
                <span
                  className={activeSettingsPanel === "content" ? "mt-1 block text-xs text-slate-200" : "mt-1 block text-xs text-slate-500"}
                >
                  字段、字号、宽度
                </span>
              </button>
              <button
                type="button"
                className={settingsPanelTabClassName("print")}
                onClick={() => setActiveSettingsPanel("print")}
                aria-pressed={activeSettingsPanel === "print"}
              >
                <span className="block font-semibold">打印设置</span>
                <span className={activeSettingsPanel === "print" ? "mt-1 block text-xs text-slate-200" : "mt-1 block text-xs text-slate-500"}>
                  纸宽、边距、助手
                </span>
              </button>
            </div>
          </div>
          {activeSettingsPanel === "print" ? (
            <>
          <section className="order-3 rounded-[20px] border border-slate-200 bg-white p-4 shadow-[0_10px_28px_rgba(15,23,42,0.04)]">
            <h3 className="text-base font-semibold text-slate-950">打印行为</h3>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <SwitchField
                label="启用小票打印"
                checked={printSettings.enabled}
                onChange={(checked) => patchPrintSettings({ enabled: checked })}
              />
              <SwitchField
                label="积分兑换结算后自动打印"
                checked={printSettings.autoPrintRedemptionReceipt}
                onChange={(checked) => patchPrintSettings({ autoPrintRedemptionReceipt: checked })}
              />
              <Field label="小票语言">
                <select
                  className={inputClassName()}
                  value={selectedReceiptLocale}
                  onChange={(event) => applyReceiptLocale(event.target.value)}
                >
                  <option value={MERCHANT_RECEIPT_AUTO_LOCALE}>{autoReceiptLocaleLabel}</option>
                  {RECEIPT_LANGUAGE_OPTIONS.map((option) => (
                    <option key={option.code} value={option.code}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="纸宽(mm)">
                <select
                  className={inputClassName()}
                  value={printSettings.paperWidthMm}
                  onChange={(event) =>
                    patchPrintSettings({ paperWidthMm: parseInteger(event.target.value, 40, 120, printSettings.paperWidthMm) })
                  }
                >
                  {!RECEIPT_PAPER_WIDTH_OPTIONS.some((option) => option.value === printSettings.paperWidthMm) ? (
                    <option value={printSettings.paperWidthMm}>{printSettings.paperWidthMm}mm（当前自定义值）</option>
                  ) : null}
                  {RECEIPT_PAPER_WIDTH_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="字体(px)">
                <input
                  type="number"
                  min={9}
                  max={18}
                  step={1}
                  className={inputClassName()}
                  value={printSettings.fontSizePx}
                  onChange={(event) =>
                    patchPrintSettings({ fontSizePx: parseInteger(event.target.value, 9, 18, printSettings.fontSizePx) })
                  }
                />
              </Field>
              <Field label="打印份数">
                <input
                  type="number"
                  min={1}
                  max={3}
                  step={1}
                  className={inputClassName()}
                  value={printSettings.copies}
                  onChange={(event) =>
                    patchPrintSettings({ copies: parseInteger(event.target.value, 1, 3, printSettings.copies) })
                  }
                />
              </Field>
            </div>
          </section>

          <section className="order-4 rounded-[20px] border border-slate-200 bg-white p-4 shadow-[0_10px_28px_rgba(15,23,42,0.04)]">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-slate-950">本机静默打印助手</h3>
                <p className="mt-1 text-sm text-slate-500">
                  收银电脑运行本地助手后，小票会直接发给指定打印机；测试打印和结算打印都按这里的助手配置执行。
                </p>
              </div>
              <span
                className={`rounded-full px-3 py-1 text-xs font-semibold ${bridgeStatusClassName}`}
              >
                {bridgeStatusLabel}
              </span>
            </div>
            <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-600">
              <div className="font-semibold text-slate-800">
                {bridgeInspection?.online
                  ? `当前助手版本：${bridgeCurrentVersion || "未知"}`
                  : "当前未检测到本机助手"}
                <span className="ml-3 text-xs font-medium text-slate-500">
                  最新版本：{printHelperLatestVersion} / 最低要求：{printHelperMinimumVersion}
                </span>
              </div>
              <div className="mt-1">
                {!bridgeInspection?.online
                  ? "如果收银电脑还没有安装打印助手，请先下载最新版并安装；安装后点击“检测助手”。"
                  : bridgeOutdated
                    ? bridgeCanSelfUpdate
                      ? "当前助手版本偏旧，可以直接自动更新。更新时助手会短暂断开并自动重启。"
                      : "当前助手版本偏旧且不支持自动更新，请下载最新版手动安装一次；之后即可自动更新。"
                    : "助手版本满足当前打印要求，可以读取打印机并静默打印。"}
              </div>
              {bridgeInspection?.online ? (
                <div className="mt-1 text-xs text-slate-500">
                  开机自启动：
                  {bridgeAutoStart
                    ? bridgeAutoStart.supported
                      ? bridgeAutoStart.enabled
                        ? "已启用"
                        : "未启用"
                      : "当前助手不支持网页设置"
                    : "未检测"}
                </div>
              ) : null}
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <SwitchField
                label="启用本机助手静默打印"
                checked={printSettings.silentPrintEnabled}
                onChange={(checked) => patchPrintSettings({ silentPrintEnabled: checked })}
              />
              <SwitchField
                label="结尾自动切纸（需要 ESC/POS 热敏打印机）"
                checked={printSettings.cutPaperAfterPrint}
                onChange={(checked) => patchPrintSettings({ cutPaperAfterPrint: checked })}
              />
              <Field label="助手地址">
                <input
                  className={inputClassName()}
                  value={printSettings.localPrintBridgeUrl}
                  onChange={(event) => {
                    setBridgeStatus("unknown");
                    setBridgeInspection(null);
                    setBridgeAutoStart(null);
                    setBridgePrinters([]);
                    patchPrintSettings({ localPrintBridgeUrl: event.target.value });
                  }}
                  placeholder="http://127.0.0.1:17658"
                />
              </Field>
              <Field label="打印机名称">
                <input
                  list="faolla-local-printers"
                  className={inputClassName()}
                  value={printSettings.localPrinterName}
                  onChange={(event) => patchPrintSettings({ localPrinterName: event.target.value })}
                  placeholder="留空使用系统默认打印机"
                />
                <datalist id="faolla-local-printers">
                  {bridgePrinters.map((printer) => (
                    <option key={printer.name} value={printer.name}>
                      {printer.isDefault ? `${printer.name}（默认）` : printer.name}
                    </option>
                  ))}
                </datalist>
              </Field>
              <Field label="切纸前走纸行数">
                <input
                  type="number"
                  min={0}
                  max={10}
                  step={1}
                  className={inputClassName()}
                  value={printSettings.feedLinesBeforeCut}
                  onChange={(event) =>
                    patchPrintSettings({
                      feedLinesBeforeCut: parseInteger(event.target.value, 0, 10, printSettings.feedLinesBeforeCut),
                    })
                  }
                />
              </Field>
              <Field label="切纸方式">
                <select
                  className={inputClassName()}
                  value={printSettings.cutPaperMode}
                  onChange={(event) =>
                    patchPrintSettings({ cutPaperMode: event.target.value === "full" ? "full" : "partial" })
                  }
                >
                  <option value="partial">半切（推荐）</option>
                  <option value="full">全切</option>
                </select>
              </Field>
              <p className="text-xs leading-5 text-slate-500 md:col-span-2">
                切纸只在本机助手 1.1.0 及以上、并且打印机支持 ESC/POS RAW 指令时生效。
              </p>
              <div className="flex flex-wrap gap-2 md:col-span-2">
                <button
                  type="button"
                  className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                  onClick={() => void checkBridge()}
                  disabled={bridgeChecking || bridgeUpdating}
                >
                  {bridgeChecking ? "检测中..." : "检测助手"}
                </button>
                <button
                  type="button"
                  className="rounded-xl border border-emerald-200 bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
                  onClick={() => void startBridgeHelper()}
                  disabled={bridgeChecking || bridgeUpdating}
                >
                  启动助手
                </button>
                <button
                  type="button"
                  className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                  onClick={() => void refreshBridgePrinters()}
                  disabled={bridgeChecking || bridgeUpdating}
                >
                  读取本机打印机
                </button>
                {bridgeOutdated && bridgeCanSelfUpdate ? (
                  <button
                    type="button"
                    className="rounded-xl border border-blue-200 bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
                    onClick={() => void updateBridgeHelper()}
                    disabled={bridgeChecking || bridgeUpdating}
                  >
                    {bridgeUpdating ? "更新中..." : "自动更新助手"}
                  </button>
                ) : null}
                {bridgeInspection?.online && !bridgeOutdated ? (
                  <button
                    type="button"
                    className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                    onClick={() => void updateBridgeAutoStart(!(bridgeAutoStart?.supported && bridgeAutoStart.enabled))}
                    disabled={bridgeChecking || bridgeUpdating || bridgeAutoStartChanging}
                  >
                    {bridgeAutoStartChanging
                      ? "设置中..."
                      : bridgeAutoStart?.supported && bridgeAutoStart.enabled
                        ? "取消开机自启动"
                        : "启用开机自启动"}
                  </button>
                ) : null}
                {printHelperPackageUrl ? (
                  <a
                    className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                    href={printHelperPackageUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    下载最新版
                  </a>
                ) : null}
                {printHelperInstallerUrl ? (
                  <button
                    type="button"
                    className="rounded-xl border border-amber-200 bg-amber-500 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-60"
                    onClick={() => void confirmPrintHelperInstallerDownload()}
                    disabled={bridgeChecking || bridgeUpdating}
                  >
                    安装/修复助手
                  </button>
                ) : null}
              </div>
            </div>
          </section>
            </>
          ) : null}

          {activeSettingsPanel === "text" ? (
          <section className="order-1 rounded-[20px] border border-slate-200 bg-white p-4 shadow-[0_10px_28px_rgba(15,23,42,0.04)]">
            <h3 className="text-base font-semibold text-slate-950">票面文字</h3>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 md:col-span-2">
                <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_180px]">
                  <div>
                    <div className="text-sm font-semibold text-slate-800">页头 Logo</div>
                    <p className="mt-1 text-xs leading-5 text-slate-500">
                      建议使用横向透明 PNG 或清晰黑白图，静默打印会自动转换为热敏打印机可识别的单色位图。
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <label className="inline-flex h-10 cursor-pointer items-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                        <span>{logoUploading ? "上传中..." : headerLogoDisplayUrl ? "重新上传" : "上传 Logo"}</span>
                        <input
                          type="file"
                          accept="image/*"
                          className="sr-only"
                          onChange={(event) => void handleReceiptLogoUpload(event)}
                          disabled={logoUploading || saving}
                        />
                      </label>
                      {headerLogoDisplayUrl ? (
                        <button
                          type="button"
                          className="h-10 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                          onClick={() => {
                            setLogoPreviewUrl("");
                            patchPrintSettings({ headerLogoUrl: "" });
                          }}
                          disabled={logoUploading || saving}
                        >
                          清除 Logo
                        </button>
                      ) : null}
                    </div>
                    <Field label={`Logo 宽度：${printSettings.headerLogoWidthPercent}%`} className="mt-3">
                      <input
                        type="range"
                        min={20}
                        max={80}
                        step={1}
                        className="w-full accent-slate-900"
                        value={printSettings.headerLogoWidthPercent}
                        onChange={(event) =>
                          patchPrintSettings({
                            headerLogoWidthPercent: parseInteger(event.target.value, 20, 80, printSettings.headerLogoWidthPercent),
                          })
                        }
                      />
                    </Field>
                  </div>
                  <div className="grid min-h-28 place-items-center rounded-2xl border border-dashed border-slate-300 bg-white p-3">
                    {headerLogoDisplayUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={headerLogoDisplayUrl}
                        alt="小票页头 Logo"
                        className="h-auto max-w-full object-contain"
                        style={{ width: `${printSettings.headerLogoWidthPercent}%` }}
                      />
                    ) : (
                      <span className="text-center text-xs text-slate-400">未设置 Logo</span>
                    )}
                  </div>
                </div>
              </div>
              <Field label="标题">
                <input
                  className={inputClassName()}
                  value={printSettings.title}
                  onChange={(event) => patchPrintSettings({ title: event.target.value })}
                />
              </Field>
              <Field label="副标题">
                <input
                  className={inputClassName()}
                  value={printSettings.subtitle}
                  onChange={(event) => patchPrintSettings({ subtitle: event.target.value })}
                />
              </Field>
              <Field label="底部文字" className="md:col-span-2">
                <input
                  className={inputClassName()}
                  value={printSettings.footer}
                  onChange={(event) => patchPrintSettings({ footer: event.target.value })}
                />
              </Field>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 md:col-span-2">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-800">小票水印</div>
                    <p className="mt-1 text-xs leading-5 text-slate-500">
                      以浅色斜向重复出现在票面下层，适合品牌名、门店名或简单符号。
                    </p>
                  </div>
                  <SwitchField
                    label="启用水印"
                    checked={printSettings.watermarkEnabled}
                    onChange={(checked) => patchPrintSettings({ watermarkEnabled: checked })}
                  />
                </div>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <Field label="水印形式">
                    <select
                      className={inputClassName()}
                      value={printSettings.watermarkMode}
                      onChange={(event) =>
                        patchPrintSettings({
                          watermarkMode: event.target.value === "pattern" ? "pattern" : "text",
                        })
                      }
                    >
                      {RECEIPT_WATERMARK_MODE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </Field>
                  {printSettings.watermarkMode === "pattern" ? (
                    <Field label="图形符号">
                      <select
                        className={inputClassName()}
                        value={printSettings.watermarkPattern}
                        onChange={(event) =>
                          patchPrintSettings({
                            watermarkPattern:
                              event.target.value === "dot" ||
                              event.target.value === "star" ||
                              event.target.value === "slash"
                                ? event.target.value
                                : "diamond",
                          })
                        }
                      >
                        {RECEIPT_WATERMARK_PATTERN_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.glyph} {option.label}
                          </option>
                        ))}
                      </select>
                    </Field>
                  ) : (
                    <Field label="水印文字">
                      <input
                        className={inputClassName()}
                        value={printSettings.watermarkText}
                        onChange={(event) => patchPrintSettings({ watermarkText: event.target.value })}
                        placeholder="例如：fafona"
                      />
                    </Field>
                  )}
                  <Field label={`透明度：${Math.round(printSettings.watermarkOpacity * 100)}%`}>
                    <input
                      type="range"
                      min={2}
                      max={35}
                      step={1}
                      className="w-full accent-slate-900"
                      value={Math.round(printSettings.watermarkOpacity * 100)}
                      onChange={(event) =>
                        patchPrintSettings({
                          watermarkOpacity:
                            parseNumberRange(
                              event.target.value,
                              2,
                              35,
                              Math.round(printSettings.watermarkOpacity * 100),
                              0,
                            ) / 100,
                        })
                      }
                    />
                  </Field>
                  <Field label="字号(px)">
                    <input
                      type="number"
                      min={10}
                      max={36}
                      step={1}
                      className={inputClassName()}
                      value={printSettings.watermarkFontSizePx}
                      onChange={(event) =>
                        patchPrintSettings({
                          watermarkFontSizePx: parseInteger(
                            event.target.value,
                            10,
                            36,
                            printSettings.watermarkFontSizePx,
                          ),
                        })
                      }
                    />
                  </Field>
                  <Field label="重复间距(mm)">
                    <input
                      type="number"
                      min={12}
                      max={60}
                      step={1}
                      className={inputClassName()}
                      value={printSettings.watermarkGapMm}
                      onChange={(event) =>
                        patchPrintSettings({
                          watermarkGapMm: parseInteger(event.target.value, 12, 60, printSettings.watermarkGapMm),
                        })
                      }
                    />
                  </Field>
                  <Field label="倾斜角度">
                    <input
                      type="number"
                      min={-60}
                      max={60}
                      step={1}
                      className={inputClassName()}
                      value={printSettings.watermarkRotateDeg}
                      onChange={(event) =>
                        patchPrintSettings({
                          watermarkRotateDeg: parseInteger(
                            event.target.value,
                            -60,
                            60,
                            printSettings.watermarkRotateDeg,
                          ),
                        })
                      }
                    />
                  </Field>
                </div>
              </div>
            </div>
          </section>
          ) : null}

          {activeSettingsPanel === "content" ? (
          <section className="order-2 rounded-[20px] border border-slate-200 bg-white p-4 shadow-[0_10px_28px_rgba(15,23,42,0.04)]">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-slate-950">小票内容</h3>
                <p className="mt-1 text-sm text-slate-500">按旧版分段方式编辑，切换分区后在表格里批量设置打印项。</p>
              </div>
            </div>
            <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
              {RECEIPT_FIELD_SECTIONS.map((section) => {
                const fields = getReceiptFieldsBySection(printSettings, section.id);
                const visibleCount = fields.filter((field) => field.visible).length;
                return (
                  <button
                    key={section.id}
                    type="button"
                    className={`h-11 shrink-0 rounded-xl border px-3 text-left text-sm transition ${
                      activeReceiptSectionInfo.id === section.id
                        ? "border-slate-950 bg-slate-950 text-white"
                        : "border-slate-200 bg-slate-50 text-slate-700 hover:border-slate-300 hover:bg-white"
                    }`}
                    onClick={() => setActiveReceiptSection(section.id)}
                    aria-pressed={activeReceiptSectionInfo.id === section.id}
                  >
                    <span className="block font-semibold leading-4">{section.label}</span>
                    <span className={activeReceiptSectionInfo.id === section.id ? "text-xs text-slate-200" : "text-xs text-slate-500"}>
                      {visibleCount}/{fields.length}
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="mt-3 overflow-hidden rounded-2xl border border-slate-200">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2">
                <div>
                  <h4 className="text-sm font-semibold text-slate-900">{activeReceiptSectionInfo.label}</h4>
                  <p className="mt-0.5 text-xs text-slate-500">{activeReceiptSectionInfo.hint}</p>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                    onClick={() => patchReceiptSectionVisible(activeReceiptSectionInfo.id, true)}
                  >
                    全部打印
                  </button>
                  <button
                    type="button"
                    className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                    onClick={() => patchReceiptSectionVisible(activeReceiptSectionInfo.id, false)}
                  >
                    全部隐藏
                  </button>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[860px] border-collapse text-sm">
                  <thead className="bg-white text-xs text-slate-500">
                    <tr>
                      <th className="w-16 border-b border-slate-200 px-3 py-2 text-left font-semibold">打印</th>
                      <th className="border-b border-slate-200 px-3 py-2 text-left font-semibold">显示名称</th>
                      <th className="w-28 border-b border-slate-200 px-3 py-2 text-left font-semibold">字体(px)</th>
                      <th className="w-32 border-b border-slate-200 px-3 py-2 text-left font-semibold">字间距(px)</th>
                      <th className="w-40 border-b border-slate-200 px-3 py-2 text-left font-semibold">宽度</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeReceiptFields.map((field) => (
                      <tr key={field.key} className="border-b border-slate-100 last:border-b-0">
                        <td className="px-3 py-2 align-middle">
                          <input
                            type="checkbox"
                            checked={field.visible}
                            onChange={(event) => patchReceiptField(field.key, { visible: event.target.checked })}
                            aria-label={`${field.label || field.key} 是否打印`}
                          />
                        </td>
                        <td className="px-3 py-2 align-middle">
                          <input
                            className={inputClassName("h-8 rounded-lg text-xs")}
                            value={field.label}
                            onChange={(event) => patchReceiptField(field.key, { label: event.target.value })}
                            placeholder="显示名称"
                          />
                          <div className="mt-0.5 text-[11px] text-slate-400">{field.key}</div>
                        </td>
                        <td className="px-3 py-2 align-middle">
                          <input
                            type="number"
                            min={8}
                            max={28}
                            step={1}
                            className={inputClassName("h-8 rounded-lg text-xs")}
                            value={field.fontSizePx}
                            onChange={(event) =>
                              patchReceiptField(field.key, {
                                fontSizePx: parseInteger(event.target.value, 8, 28, field.fontSizePx),
                              })
                            }
                          />
                        </td>
                        <td className="px-3 py-2 align-middle">
                          <input
                            type="number"
                            min={0}
                            max={8}
                            step={0.5}
                            className={inputClassName("h-8 rounded-lg text-xs")}
                            value={field.letterSpacingPx}
                            onChange={(event) =>
                              patchReceiptField(field.key, {
                                letterSpacingPx: parseNumberRange(event.target.value, 0, 8, field.letterSpacingPx),
                              })
                            }
                          />
                        </td>
                        <td className="px-3 py-2 align-middle">
                          <select
                            className={inputClassName("h-8 rounded-lg text-xs")}
                            value={field.width}
                            onChange={(event) =>
                              patchReceiptField(field.key, {
                                width: event.target.value as MerchantReceiptContentField["width"],
                              })
                            }
                          >
                            {RECEIPT_FIELD_WIDTH_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
          ) : null}
        </div>

        <aside className="rounded-[20px] border border-slate-200 bg-white p-4 shadow-[0_10px_28px_rgba(15,23,42,0.04)] xl:sticky xl:top-4 xl:max-h-[calc(100vh-2rem)] xl:self-start xl:overflow-hidden">
          <h3 className="text-base font-semibold text-slate-950">小票预览</h3>
          <div className="mt-4 overflow-x-hidden overflow-y-auto rounded-2xl border border-slate-200 bg-slate-50 p-4 xl:max-h-[calc(100vh-6rem)]">
            <div className="relative mx-auto w-fit px-10 py-9">
              <label
                className="absolute left-1/2 top-1 z-50 flex h-6 -translate-x-1/2 items-center rounded-md bg-slate-950 px-2 text-[11px] font-semibold text-white shadow-lg"
                onPointerDown={(event) => event.stopPropagation()}
              >
                <span className="sr-only">上边距</span>
                <input
                  type="number"
                  min={RECEIPT_MARGIN_MIN_MM}
                  max={RECEIPT_MARGIN_MAX_MM}
                  step={0.5}
                  className="w-9 bg-transparent text-center text-white outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                  value={getReceiptMarginInputValue("top")}
                  onChange={(event) => handleReceiptMarginInputChange("top", event.target.value)}
                  onBlur={() => clearReceiptMarginInputDraft("top")}
                />
              </label>
              <label
                className="absolute right-1 top-1/2 z-50 flex h-6 -translate-y-1/2 items-center rounded-md bg-slate-950 px-2 text-[11px] font-semibold text-white shadow-lg"
                onPointerDown={(event) => event.stopPropagation()}
              >
                <span className="sr-only">右边距</span>
                <input
                  type="number"
                  min={RECEIPT_MARGIN_MIN_MM}
                  max={RECEIPT_MARGIN_MAX_MM}
                  step={0.5}
                  className="w-9 bg-transparent text-center text-white outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                  value={getReceiptMarginInputValue("right")}
                  onChange={(event) => handleReceiptMarginInputChange("right", event.target.value)}
                  onBlur={() => clearReceiptMarginInputDraft("right")}
                />
              </label>
              <label
                className="absolute bottom-1 left-1/2 z-50 flex h-6 -translate-x-1/2 items-center rounded-md bg-slate-950 px-2 text-[11px] font-semibold text-white shadow-lg"
                onPointerDown={(event) => event.stopPropagation()}
              >
                <span className="sr-only">下边距</span>
                <input
                  type="number"
                  min={RECEIPT_MARGIN_MIN_MM}
                  max={RECEIPT_MARGIN_MAX_MM}
                  step={0.5}
                  className="w-9 bg-transparent text-center text-white outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                  value={getReceiptMarginInputValue("bottom")}
                  onChange={(event) => handleReceiptMarginInputChange("bottom", event.target.value)}
                  onBlur={() => clearReceiptMarginInputDraft("bottom")}
                />
              </label>
              <label
                className="absolute left-1 top-1/2 z-50 flex h-6 -translate-y-1/2 items-center rounded-md bg-slate-950 px-2 text-[11px] font-semibold text-white shadow-lg"
                onPointerDown={(event) => event.stopPropagation()}
              >
                <span className="sr-only">左边距</span>
                <input
                  type="number"
                  min={RECEIPT_MARGIN_MIN_MM}
                  max={RECEIPT_MARGIN_MAX_MM}
                  step={0.5}
                  className="w-9 bg-transparent text-center text-white outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                  value={getReceiptMarginInputValue("left")}
                  onChange={(event) => handleReceiptMarginInputChange("left", event.target.value)}
                  onBlur={() => clearReceiptMarginInputDraft("left")}
                />
              </label>
            <div
              className="relative mx-auto overflow-hidden bg-white text-black shadow-sm"
              style={{
                width: `${receiptPreviewPaperWidthPx}px`,
                padding: `${receiptPreviewMarginPx.top}px ${receiptPreviewMarginPx.right}px ${receiptPreviewMarginPx.bottom}px ${receiptPreviewMarginPx.left}px`,
                fontSize: `${printSettings.fontSizePx}px`,
                lineHeight: 1.35,
              }}
            >
              <button
                type="button"
                aria-label="拖动调整上边距"
                title="拖动调整上边距"
                className={`absolute left-0 right-0 z-20 h-3 -translate-y-1/2 cursor-row-resize border-t border-dashed ${
                  draggingReceiptMargin === "top" ? "border-sky-500 bg-sky-500/15" : "border-sky-400 bg-transparent hover:bg-sky-500/10"
                }`}
                style={{ top: `${receiptPreviewMarginPx.top}px`, touchAction: "none" }}
                onPointerDown={(event) => startReceiptMarginDrag("top", event)}
              />
              <button
                type="button"
                aria-label="拖动调整下边距"
                title="拖动调整下边距"
                className={`absolute left-0 right-0 z-20 h-3 translate-y-1/2 cursor-row-resize border-b border-dashed ${
                  draggingReceiptMargin === "bottom" ? "border-sky-500 bg-sky-500/15" : "border-sky-400 bg-transparent hover:bg-sky-500/10"
                }`}
                style={{ bottom: `${receiptPreviewMarginPx.bottom}px`, touchAction: "none" }}
                onPointerDown={(event) => startReceiptMarginDrag("bottom", event)}
              />
              <button
                type="button"
                aria-label="拖动调整左边距"
                title="拖动调整左边距"
                className={`absolute bottom-0 top-0 z-20 w-3 -translate-x-1/2 cursor-col-resize border-l border-dashed ${
                  draggingReceiptMargin === "left" ? "border-sky-500 bg-sky-500/15" : "border-sky-400 bg-transparent hover:bg-sky-500/10"
                }`}
                style={{ left: `${receiptPreviewMarginPx.left}px`, touchAction: "none" }}
                onPointerDown={(event) => startReceiptMarginDrag("left", event)}
              />
              <button
                type="button"
                aria-label="拖动调整右边距"
                title="拖动调整右边距"
                className={`absolute bottom-0 top-0 z-20 w-3 translate-x-1/2 cursor-col-resize border-r border-dashed ${
                  draggingReceiptMargin === "right" ? "border-sky-500 bg-sky-500/15" : "border-sky-400 bg-transparent hover:bg-sky-500/10"
                }`}
                style={{ right: `${receiptPreviewMarginPx.right}px`, touchAction: "none" }}
                onPointerDown={(event) => startReceiptMarginDrag("right", event)}
              />
              {watermarkPreviewText ? (
                <div
                  className="pointer-events-none absolute inset-0 z-0 flex flex-col overflow-hidden font-extrabold leading-none text-black"
                  style={{
                    opacity: printSettings.watermarkOpacity,
                    fontSize: `${printSettings.watermarkFontSizePx}px`,
                  }}
                  aria-hidden="true"
                >
                  {RECEIPT_WATERMARK_PREVIEW_ROWS.map((rowIndex) => (
                    <div
                      key={rowIndex}
                      className="flex shrink-0 items-center"
                      style={{
                        height: `${printSettings.watermarkGapMm * RECEIPT_PREVIEW_MM_SCALE}px`,
                        transform: `translateX(${getReceiptWatermarkPreviewRowOffsetPx(
                          rowIndex,
                          printSettings.watermarkGapMm * RECEIPT_PREVIEW_MM_SCALE,
                        )}px)`,
                      }}
                    >
                      {RECEIPT_WATERMARK_PREVIEW_COLUMNS.map((columnIndex) => (
                        <span
                          key={`${rowIndex}-${columnIndex}`}
                          className="shrink-0 whitespace-nowrap text-center"
                          style={{
                            minWidth: `${printSettings.watermarkGapMm * RECEIPT_PREVIEW_MM_SCALE}px`,
                            transform: `rotate(${printSettings.watermarkRotateDeg}deg)`,
                          }}
                        >
                          {watermarkPreviewText}
                        </span>
                      ))}
                    </div>
                  ))}
                </div>
              ) : null}
              <div className="relative z-10">
              <div className="border-b border-dashed border-black pb-2 text-center">
                {headerLogoDisplayUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={headerLogoDisplayUrl}
                    alt="小票页头 Logo"
                    className="mx-auto mb-2 h-auto object-contain"
                    style={{ width: `${printSettings.headerLogoWidthPercent}%` }}
                  />
                ) : null}
                <div className="text-lg font-bold">{printSettings.title}</div>
                {printSettings.subtitle ? <div className="text-xs text-slate-700">{printSettings.subtitle}</div> : null}
                {getVisibleReceiptFields(printSettings, "header").map((field) => {
                  const value = getReceiptFieldValue(field.key, previewReceipt);
                  return value ? (
                    <div
                      key={field.key}
                      className={field.key === "siteId" ? "text-xs text-slate-700" : ""}
                      style={receiptFieldPreviewStyle(field)}
                    >
                      {value}
                    </div>
                  ) : null;
                })}
              </div>
              <div className="grid grid-cols-6 gap-x-2 gap-y-1 border-b border-dashed border-black py-2">
                {getVisibleReceiptFields(printSettings, "meta").map((field) => {
                  const value = getReceiptFieldValue(field.key, previewReceipt);
                  return value ? (
                    <div
                      key={field.key}
                      className={`flex justify-between gap-3 ${receiptPreviewWidthClass(field)}`}
                      style={receiptFieldPreviewStyle(field)}
                    >
                      {field.label ? <span>{field.label}</span> : null}
                      <strong className="text-right">{value}</strong>
                    </div>
                  ) : null;
                })}
              </div>
              <div className="py-2">
                {previewReceipt.lines.map((line) => {
                  const itemNameField = receiptFieldByKey.get("itemName");
                  const itemSubtotalField = receiptFieldByKey.get("itemSubtotal");
                  return (
                    <div key={line.code} className="border-b border-dashed border-slate-300 py-1">
                      <div className="flex justify-between gap-2">
                        <strong style={itemNameField ? receiptFieldPreviewStyle(itemNameField) : undefined}>
                          {getReceiptLineFieldValue("itemName", line)}
                        </strong>
                        {isReceiptFieldVisible(printSettings, "itemSubtotal") ? (
                          <span style={itemSubtotalField ? receiptFieldPreviewStyle(itemSubtotalField) : undefined}>
                            {getReceiptLineFieldValue("itemSubtotal", line)}
                          </span>
                        ) : null}
                      </div>
                      <div className="text-xs text-slate-700">{renderPreviewItemMeta(line)}</div>
                    </div>
                  );
                })}
              </div>
              <div className="grid grid-cols-6 gap-x-2 gap-y-1 border-t border-dashed border-black pt-2">
                {getVisibleReceiptFields(printSettings, "summary").map((field) => {
                  const value = getReceiptFieldValue(field.key, previewReceipt);
                  return value ? (
                    <div
                      key={field.key}
                      className={`flex justify-between gap-3 ${receiptPreviewWidthClass(field)} ${
                        field.key === "totalPoints" ? "border-t border-black pt-1 text-base font-bold" : ""
                      }`}
                      style={receiptFieldPreviewStyle(field)}
                    >
                      {field.label ? <span>{field.label}</span> : null}
                      <strong>{value}</strong>
                    </div>
                  ) : null;
                })}
              </div>
              {getVisibleReceiptFields(printSettings, "footer").map((field) => {
                if (field.key === "note" && previewReceipt.note) {
                  return (
                    <div
                      key={field.key}
                      className="mt-2 border-t border-dashed border-black pt-2"
                      style={receiptFieldPreviewStyle(field)}
                    >
                      {formatPreviewLabelValue(field.label, previewReceipt.note, "：")}
                    </div>
                  );
                }
                if (field.key === "footerText" && printSettings.footer) {
                  return (
                    <div key={field.key} className="mt-3 text-center font-bold" style={receiptFieldPreviewStyle(field)}>
                      {printSettings.footer}
                    </div>
                  );
                }
                return null;
              })}
              </div>
            </div>
            </div>
          </div>
        </aside>
      </div>
    </section>
  );
}
