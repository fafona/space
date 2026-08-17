"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import {
  createMerchantCatalogCollectionId,
  MERCHANT_CATALOG_CHANGED_EVENT,
  MERCHANT_CATALOG_MAX_SEARCH_PLACEHOLDER_LENGTH,
  parseMerchantCatalogChangedEventDetail,
  parseMerchantCatalogUnitPrice,
  planMerchantCatalogProductImageMatches,
  planMerchantCatalogProductImport,
  resolveMerchantCatalogCollection,
  type MerchantCatalog,
  type MerchantCatalogAvailability,
  type MerchantCatalogBootstrapResolutionPlan,
  type MerchantCatalogBootstrapResolutionResult,
  type MerchantCatalogBootstrapResolutionSelection,
  type MerchantCatalogBootstrapResolutionTarget,
  type MerchantCatalogBootstrapResult,
  type MerchantCatalogBrowsingRules,
  type MerchantCatalogCategory,
  type MerchantCatalogCollection,
  type MerchantCatalogConflict,
  type MerchantCatalogProduct,
  type MerchantCatalogProductImageMatchPlan,
  type MerchantCatalogTarget,
} from "@/lib/merchantCatalog";
import type { ProductItemInput } from "@/lib/productBlock";
import { normalizePublicAssetUrl } from "@/lib/publicAssetUrl";

export type MerchantCatalogLeaveState = "clean" | "draft" | "busy" | "uploaded_uncommitted";

export type MerchantCatalogManagerPanelProps = {
  siteId: string;
  darkMode?: boolean;
  catalogTarget?: MerchantCatalogTarget | null;
  onChanged?: () => void | Promise<void>;
  onLeaveStateChange?: (state: MerchantCatalogLeaveState) => void;
};

type CatalogApiPayload = {
  ok?: boolean;
  catalog?: MerchantCatalog | null;
  bootstrap?: MerchantCatalogBootstrapResult;
  bootstrapFingerprint?: string;
  preview?: MerchantCatalogBootstrapResolutionResult;
  resolutionFingerprint?: string;
  error?: string;
  message?: string;
  currentRevision?: number;
  warning?: string | null;
};

type CatalogMutation =
  | {
      action: "bootstrap";
      sourceFingerprint: string;
      resolutionPlan?: MerchantCatalogBootstrapResolutionPlan;
      resolutionFingerprint?: string;
    }
  | {
      action: "upsert_product";
      product: MerchantCatalogProduct;
      productId?: string;
      collectionIds: string[];
    }
  | { action: "delete_product"; productId: string }
  | { action: "set_availability"; productId: string; availability: MerchantCatalogAvailability }
  | { action: "upsert_category"; category: MerchantCatalogCategory }
  | { action: "delete_category"; categoryId: string }
  | { action: "upsert_collection"; collection: MerchantCatalogCollection }
  | { action: "delete_collection"; collectionId: string }
  | { action: "set_price_prefix"; pricePrefix: string }
  | { action: "bulk_import_products"; items: ProductItemInput[] }
  | {
      action: "bulk_set_product_images";
      items: Array<{ fileName: string; imageUrl: string; thumbnailUrl?: string }>;
    };

type MerchantCatalogProductImportPlan = Extract<
  ReturnType<typeof planMerchantCatalogProductImport>,
  { ok: true }
>;

type MerchantCatalogProductImportDraft = {
  siteId: string;
  fileName: string;
  rowCount: number;
  items: ProductItemInput[];
  baseRevision: number;
  plan: MerchantCatalogProductImportPlan;
};

const MERCHANT_CATALOG_IMPORT_MAX_FILE_BYTES = 10 * 1024 * 1024;
const MERCHANT_CATALOG_IMAGE_IMPORT_MAX_FILES = 100;
const MERCHANT_CATALOG_IMAGE_IMPORT_MAX_FILE_BYTES = 10 * 1024 * 1024;
const MERCHANT_CATALOG_IMAGE_IMPORT_MAX_TOTAL_BYTES = 100 * 1024 * 1024;
const MERCHANT_CATALOG_IMAGE_IMPORT_CONCURRENCY = 2;
const MERCHANT_CATALOG_IMAGE_IMPORT_ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const DEFAULT_MERCHANT_CATALOG_BROWSING_RULES: MerchantCatalogBrowsingRules = {
  searchEnabled: true,
  searchPlaceholder: "",
  hideUnselectedCategory: true,
  groupByCategory: false,
};

function copyMerchantCatalogBrowsingRules(
  value: MerchantCatalogBrowsingRules | null | undefined,
): MerchantCatalogBrowsingRules | undefined {
  if (!value) return undefined;
  return {
    searchEnabled: value.searchEnabled,
    searchPlaceholder: value.searchPlaceholder,
    hideUnselectedCategory: value.hideUnselectedCategory,
    groupByCategory: value.groupByCategory,
  };
}

type MerchantCatalogProductImageUploadEntry = {
  fileName: string;
  imageUrl: string;
  thumbnailUrl?: string;
};

type MerchantCatalogProductImageUploadFailure = {
  fileName: string;
  message: string;
};

type MerchantCatalogProductImageUploadProgress = {
  processed: number;
  total: number;
  uploaded: number;
  failed: number;
};

type MerchantCatalogProductImageImportDraft = {
  siteId: string;
  siteVersion: number;
  selectionId: number;
  baseRevision: number;
  files: File[];
  plan: Extract<MerchantCatalogProductImageMatchPlan, { ok: true }>;
  uploadedEntries: MerchantCatalogProductImageUploadEntry[];
  uploadFailures: MerchantCatalogProductImageUploadFailure[];
};

type MerchantCatalogSingleProductImageUpload = {
  siteId: string;
  siteVersion: number;
  baseRevision: number;
  productId: string;
  draftGeneration: number;
  imageUrl: string;
  thumbnailUrl: string;
};

const AVAILABILITY_OPTIONS: Array<{
  value: MerchantCatalogAvailability;
  label: string;
  description: string;
}> = [
  { value: "available", label: "可售", description: "正常展示并允许选购" },
  { value: "sold_out", label: "售罄", description: "展示但暂不可选购" },
  { value: "hidden", label: "隐藏", description: "不在经营目录展示" },
];

function getProductImageFileSelectionError(files: File[]) {
  if (files.length === 0) return "请选择至少一张商品图片。";
  if (files.length > MERCHANT_CATALOG_IMAGE_IMPORT_MAX_FILES) {
    return `每次最多选择 ${MERCHANT_CATALOG_IMAGE_IMPORT_MAX_FILES} 张图片，请拆分后重试。`;
  }
  let totalBytes = 0;
  for (const file of files) {
    const mime = String(file.type ?? "").trim().toLowerCase();
    if (!/\.(?:jpe?g|png|webp)$/i.test(file.name) || !MERCHANT_CATALOG_IMAGE_IMPORT_ALLOWED_MIME_TYPES.has(mime)) {
      return `“${file.name || "未命名文件"}”不是受支持的 JPEG、PNG 或 WebP 图片；SVG 等其他格式不会上传。`;
    }
    if (file.size <= 0) return `“${file.name}”是空文件，请重新导出图片后再试。`;
    if (file.size > MERCHANT_CATALOG_IMAGE_IMPORT_MAX_FILE_BYTES) {
      return `“${file.name}”超过 10 MB 单文件上限，请压缩后重试。`;
    }
    totalBytes += file.size;
    if (totalBytes > MERCHANT_CATALOG_IMAGE_IMPORT_MAX_TOTAL_BYTES) {
      return "所选图片总大小超过 100 MB，请拆分成多批导入。";
    }
  }
  return "";
}

function getProductImageUploadFailureMessage(error: unknown) {
  const message = error instanceof Error ? error.message.trim() : "";
  if (!message) return "图片处理或上传失败，请重试。";
  if (/10\s*mb|文件过大|size[_ ]limit/i.test(message)) return "图片超过处理或上传上限，请压缩后重试。";
  if (/登录|unauthorized|401/i.test(message)) return "登录状态可能已失效，请刷新后台后重试。";
  return message;
}

function RefreshIcon({ spinning = false }: { spinning?: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
      className={`h-4 w-4 ${spinning ? "animate-spin" : ""}`}
    >
      <path
        d="M16 7a6.5 6.5 0 1 0 .2 5.4M16 3v4h-4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-4 w-4">
      <path d="M10 4v12M4 10h12" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-4 w-4">
      <path d="m12.8 4.2 3 3L7.5 15.5 4 16l.5-3.5 8.3-8.3Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-4 w-4">
      <path d="M4 6h12M8 3.5h4M6 6l.6 10h6.8L14 6M8.5 9v4.5M11.5 9v4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-4 w-4">
      <path d="m4.5 10 3.5 3.5 7.5-8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function WarningIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-5 w-5">
      <path d="M10 3 18 17H2L10 3Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M10 7.5v4M10 14.5v.1" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-4 w-4">
      <path d="M10 13V3m0 0L6.5 6.5M10 3l3.5 3.5M4 11.5V16h12v-4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function createStableClientId(prefix: "product" | "category") {
  const randomId = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}-${randomId.toLowerCase()}`;
}

function createProductDraft(): MerchantCatalogProduct {
  return {
    id: createStableClientId("product"),
    code: "",
    name: "",
    description: "",
    price: "",
    imageUrl: "",
    thumbnailUrl: "",
    tag: "",
    availability: "available",
  };
}

function createCategoryDraft(): MerchantCatalogCategory {
  return {
    id: createStableClientId("category"),
    name: "",
    productIds: [],
  };
}

function formatDateTime(value: string) {
  const stamp = Date.parse(value);
  if (!Number.isFinite(stamp)) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(stamp));
}

function getViewportLabel(viewport: MerchantCatalogCollection["viewport"]) {
  if (viewport === "desktop") return "电脑端";
  if (viewport === "mobile") return "手机端";
  return "电脑端与手机端共享";
}

function getBrowsingRulesSummary(rules: MerchantCatalogBrowsingRules | undefined) {
  if (!rules) return "浏览规则仍沿用网站设置";
  return [
    rules.searchEnabled ? "搜索开启" : "搜索关闭",
    rules.hideUnselectedCategory ? "分类单选展示" : "分类可同时展示",
    rules.groupByCategory ? "按分类排列" : "保持投放顺序",
  ].join(" · ");
}

function getAvailabilityLabel(value: MerchantCatalogAvailability) {
  return AVAILABILITY_OPTIONS.find((option) => option.value === value)?.label ?? "可售";
}

function getSafeMerchantCatalogProductImageUrl(imageUrl: string, thumbnailUrl: string) {
  for (const candidate of [thumbnailUrl, imageUrl]) {
    const normalized = normalizePublicAssetUrl(candidate.trim());
    if (!normalized || normalized.startsWith("//")) continue;
    if (normalized.startsWith("/")) return normalized;
    try {
      const parsed = new URL(normalized);
      if (parsed.protocol === "https:" || parsed.protocol === "http:") return normalized;
    } catch {
      // Try the full-size image when a malformed thumbnail URL is present.
    }
  }
  return "";
}

function MerchantCatalogProductThumbnail({
  imageUrl,
  thumbnailUrl,
  name,
  darkMode,
  className = "h-16 w-16",
}: {
  imageUrl: string;
  thumbnailUrl: string;
  name: string;
  darkMode: boolean;
  className?: string;
}) {
  const safeImageUrl = getSafeMerchantCatalogProductImageUrl(imageUrl, thumbnailUrl);
  const [failedImageUrl, setFailedImageUrl] = useState("");
  const failed = Boolean(safeImageUrl) && failedImageUrl === safeImageUrl;

  if (!safeImageUrl || failed) {
    return (
      <div
        role="img"
        aria-label={`${name || "商品"}暂无图片`}
        className={`${className} flex shrink-0 items-center justify-center rounded-xl border border-dashed text-[11px] ${
          darkMode ? "border-slate-700 bg-slate-900 text-slate-500" : "border-slate-200 bg-white text-slate-400"
        }`}
      >
        无图
      </div>
    );
  }

  return (
    // The workbench must render arbitrary validated catalog hosts without a Next.js remote-domain allowlist.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={safeImageUrl}
      alt={`${name || "商品"}缩略图`}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailedImageUrl(safeImageUrl)}
      className={`${className} shrink-0 rounded-xl border object-cover ${darkMode ? "border-slate-700 bg-slate-900" : "border-slate-200 bg-white"}`}
    />
  );
}

function getAvailabilityClass(value: MerchantCatalogAvailability, darkMode: boolean) {
  if (value === "available") {
    return darkMode
      ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200"
      : "border-emerald-200 bg-emerald-50 text-emerald-700";
  }
  if (value === "sold_out") {
    return darkMode
      ? "border-amber-400/30 bg-amber-400/10 text-amber-200"
      : "border-amber-200 bg-amber-50 text-amber-700";
  }
  return darkMode
    ? "border-slate-500/40 bg-slate-500/10 text-slate-300"
    : "border-slate-200 bg-slate-100 text-slate-600";
}

function getCatalogError(payload: CatalogApiPayload | null, fallback: string) {
  const code = String(payload?.error ?? "").trim();
  const message = String(payload?.message ?? "").trim();
  if (code === "merchant_catalog_not_found" || code === "catalog_not_found") return "商品目录尚未建立，请先从已发布商品初始化。";
  if (code === "merchant_catalog_product_not_found" || code === "catalog_product_not_found") return "商品不存在，可能已在其他页面删除。";
  if (code === "merchant_catalog_category_not_found" || code === "catalog_category_not_found") return "分类不存在，可能已在其他页面删除。";
  if (code === "merchant_catalog_category_name_conflict") return "分类名称已存在，请使用不同名称。";
  if (code === "merchant_catalog_collection_scope_conflict") return "该网站区块和终端已经存在投放配置，请刷新后再编辑。";
  if (code === "merchant_catalog_collection_not_found") return "商品投放配置不存在，可能已在其他页面更新。";
  if (code === "merchant_catalog_product_not_placed") return "可售或售罄商品至少要投放到一个网站商品区块；如需暂存，请先设为隐藏。";
  if (code === "merchant_catalog_product_id_immutable") return "商品稳定编号不能修改；如需更换编号，请新建商品。";
  if (code === "merchant_catalog_limit_exceeded") return "商品目录已达到容量上限，请精简商品、分类、图片地址或说明后重试。";
  if (code === "invalid_merchant_catalog_product_image_asset") return "上传后的商品图片不属于当前商户资源，目录未写入。";
  if (code === "invalid_merchant_catalog_product_thumbnail_asset") return "上传后的商品缩略图与原图不匹配，目录未写入。";
  if (code === "merchant_catalog_image_import_duplicate_code") return "所选图片中存在重复商品编码，请每个商品只保留一张图片。";
  if (code === "merchant_catalog_existing_duplicate_code") return "当前经营目录中存在重复商品编码，请先修复后再导入图片。";
  if (code === "merchant_catalog_image_import_no_changes") return "这些图片与当前目录一致，无需重复写入。";
  if (code === "merchant_catalog_image_import_limit_exceeded") return "每次最多导入 100 张商品图片，请拆分后重试。";
  if (code === "invalid_merchant_catalog_browsing_rules") return "商品浏览规则无效，请检查搜索提示词和分类设置后重试。";
  if (code === "invalid_merchant_catalog_product_price") return "商品价格必须是非负数字，最多保留两位小数；免费商品请明确填写 0。";
  if (code === "merchant_catalog_bootstrap_conflict" || code === "catalog_bootstrap_conflict") return "已发布商品存在冲突，解决冲突后才能初始化目录。";
  if (code === "merchant_catalog_bootstrap_empty") return "没有找到已发布商品。请先发布至少一个商品区块，再建立经营目录。";
  if (code === "merchant_catalog_bootstrap_unavailable") return "暂时无法读取已发布网站商品，请确认网站已发布后重试。";
  if (code === "merchant_catalog_already_initialized") return "商品目录已在其他页面建立，正在重新加载最新目录。";
  if (code === "merchant_catalog_bootstrap_source_changed") return "已发布网站商品在确认期间发生变化，已刷新预览；请重新核对后再建立目录。";
  if (code === "merchant_catalog_bootstrap_resolution_invalid") return "冲突解决内容无效，请重新选择来源值或检查手填内容。";
  if (code === "merchant_catalog_bootstrap_resolution_incomplete") return "仍有商品冲突尚未处理，请完成全部选择后再生成预览。";
  if (code === "merchant_catalog_bootstrap_unresolved_conflict") return "仍有无法在工作台安全处理的发布数据冲突，请刷新后核对。";
  if (code === "merchant_catalog_bootstrap_validation_failed") return "解决后的商品目录未通过安全校验，请检查必填名称、价格和商品投放范围。";
  if (code === "merchant_catalog_bootstrap_resolution_changed") return "冲突解决预览已经变化，请重新生成预览后再确认。";
  if (
    code === "catalog_storage_unavailable" ||
    code === "merchant_catalog_load_failed" ||
    code === "merchant_catalog_update_failed"
  ) return "商品目录存储暂时不可用，请稍后重试。";
  if (code === "unauthorized") return "登录状态已失效，请重新登录后再操作。";
  if (code === "order_management_disabled") return "当前商户尚未启用订单管理。";
  if (code === "forbidden_origin") return "请求来源验证失败，请刷新页面后重试。";
  if (code === "invalid_catalog_action") return "目录操作无效，请刷新后重试。";
  if (code.startsWith("invalid_")) return "目录数据不符合要求，请检查填写内容后重试。";
  return message || code || fallback;
}

function getProductImportPlanError(result: { error: string; rowIndex?: number }) {
  const entryPrefix = typeof result.rowIndex === "number" ? `第 ${result.rowIndex + 1} 条导入记录：` : "";
  switch (result.error) {
    case "invalid_merchant_catalog_import_items":
      return "表格中没有可导入的商品，请检查首个工作表和表头。";
    case "invalid_merchant_catalog_import_row":
      return `${entryPrefix}记录格式无效，请检查这一条商品数据后重试。`;
    case "invalid_merchant_catalog_import_code":
      return `${entryPrefix}商品编码不能为空；批量导入使用商品编码识别新建或更新。`;
    case "merchant_catalog_import_duplicate_code":
      return `${entryPrefix}商品编码与本次文件中的其他导入记录重复，请保留一条后重新选择文件。`;
    case "merchant_catalog_existing_duplicate_code":
      return "当前经营目录中已有重复商品编码，无法安全判断应更新哪一个商品；请先在工作台修复重复编码。";
    case "invalid_merchant_catalog_import_product_name":
      return `${entryPrefix}新商品必须填写商品名称。`;
    case "invalid_merchant_catalog_import_product_price":
      return `${entryPrefix}价格必须是非负数字，最多保留两位小数；新商品和免费商品都要明确填写价格（免费填 0）。`;
    case "merchant_catalog_limit_exceeded":
      return `${entryPrefix}导入后商品目录将超过容量上限，请减少行数或精简商品内容后重试。`;
    default:
      return `${entryPrefix}表格内容不符合商品目录规则，请检查商品编码、名称、价格和分类后重试。`;
  }
}

function getProductImageMatchPlanError(result: { error: string; rowIndex?: number }) {
  const filePrefix = typeof result.rowIndex === "number" ? `第 ${result.rowIndex + 1} 个文件：` : "";
  switch (result.error) {
    case "invalid_merchant_catalog_image_import_items":
      return "请选择至少一张商品图片。";
    case "invalid_merchant_catalog_image_file_name":
      return `${filePrefix}文件名无法安全识别商品编码，请按“商品编码.jpg”格式重命名。`;
    case "merchant_catalog_image_import_limit_exceeded":
      return `每次最多导入 ${MERCHANT_CATALOG_IMAGE_IMPORT_MAX_FILES} 张图片，请拆分后重试。`;
    case "merchant_catalog_image_import_duplicate_code":
      return `${filePrefix}所选文件中存在相同商品编码；每个商品每批只能选择一张图片，请删除重复文件后重选。`;
    case "merchant_catalog_existing_duplicate_code":
      return `${filePrefix}当前经营目录中存在重复商品编码，无法安全判断图片应写入哪个商品；请先修复重复编码。`;
    default:
      return `${filePrefix}无法按文件名安全匹配商品，请检查文件名和商品编码后重试。`;
  }
}

function getProductImportActionLabel(action: MerchantCatalogProductImportPlan["rows"][number]["action"]) {
  if (action === "create") return "新建";
  if (action === "update") return "更新";
  return "不变";
}

function isRevisionConflict(payload: CatalogApiPayload | null) {
  return payload?.error === "merchant_catalog_revision_conflict";
}

function conflictCodeLabel(conflict: MerchantCatalogConflict) {
  if (conflict.code === "product_field_conflict") return "商品字段冲突";
  if (conflict.code === "collection_conflict") return "商品集合冲突";
  if (conflict.code === "catalog_field_conflict") return "目录设置冲突";
  return "已发布数据无效";
}

function conflictFieldLabel(field: string) {
  const labels: Record<string, string> = {
    price_prefix: "价格前缀",
    category_options: "分类选项",
    browsing_rules: "商品浏览规则",
    search_placeholder_too_long: "搜索框提示词",
    product_ids: "商品顺序/集合",
    code: "商品编码",
    name: "商品名称",
    name_required: "商品名称不能为空",
    description: "商品描述",
    price: "价格",
    price_invalid: "价格必须是非负数字（最多两位小数）",
    image_url: "图片",
    thumbnail_url: "缩略图",
    tag: "分类标签",
    availability: "可售状态",
    blocks: "已发布商品块",
    desktopBlocks: "桌面端商品块",
    mobileBlocks: "移动端商品块",
  };
  return labels[field] ?? field;
}

function formatConflictValue(value: string | string[]) {
  if (Array.isArray(value)) return value.length > 0 ? value.join("、") : "（空列表）";
  return value || "（空值）";
}

type MerchantCatalogBootstrapResolutionDraft = Record<
  string,
  MerchantCatalogBootstrapResolutionSelection
>;

function targetNeedsNonEmptyName(target: MerchantCatalogBootstrapResolutionTarget) {
  return target.field === "name" || target.field === "name_required" || target.reasons.includes("name_required");
}

function targetNeedsValidPrice(target: MerchantCatalogBootstrapResolutionTarget) {
  return target.field === "price" || target.field === "price_invalid" || target.reasons.includes("price_invalid");
}

function targetNeedsValidSearchPlaceholder(target: MerchantCatalogBootstrapResolutionTarget) {
  return target.field === "search_placeholder_too_long" || target.reasons.includes("search_placeholder_too_long");
}

function hasIndependentSearchPlaceholderResolutionTarget(
  target: MerchantCatalogBootstrapResolutionTarget,
  targets: MerchantCatalogBootstrapResolutionTarget[],
) {
  if (target.scope !== "collection" || target.field !== "browsing_rules" || !target.collectionId) {
    return false;
  }
  return targets.some((candidate) =>
    candidate.scope === "collection" &&
    candidate.collectionId === target.collectionId &&
    candidate.field === "search_placeholder_too_long"
  );
}

function parseBootstrapBrowsingRules(
  value: unknown,
  allowOversizedSearchPlaceholder = false,
): MerchantCatalogBrowsingRules | null {
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value) as Partial<MerchantCatalogBrowsingRules> | null;
    if (
      !parsed ||
      typeof parsed.searchEnabled !== "boolean" ||
      typeof parsed.searchPlaceholder !== "string" ||
      typeof parsed.hideUnselectedCategory !== "boolean" ||
      typeof parsed.groupByCategory !== "boolean" ||
      (
        !allowOversizedSearchPlaceholder &&
        parsed.searchPlaceholder.trim().length > MERCHANT_CATALOG_MAX_SEARCH_PLACEHOLDER_LENGTH
      )
    ) {
      return null;
    }
    return {
      searchEnabled: parsed.searchEnabled,
      searchPlaceholder: parsed.searchPlaceholder.trim(),
      hideUnselectedCategory: parsed.hideUnselectedCategory,
      groupByCategory: parsed.groupByCategory,
    };
  } catch {
    return null;
  }
}

function isBootstrapResolutionValueLocallyValid(
  target: MerchantCatalogBootstrapResolutionTarget,
  value: string | string[],
  targets: MerchantCatalogBootstrapResolutionTarget[] = [],
) {
  if (target.field === "product_ids" || target.field === "category_options") {
    return Array.isArray(value);
  }
  if (Array.isArray(value)) return false;
  if (targetNeedsNonEmptyName(target)) return Boolean(value.trim());
  if (targetNeedsValidPrice(target)) return parseMerchantCatalogUnitPrice(value) !== null;
  if (target.field === "availability") {
    return value === "available" || value === "sold_out" || value === "hidden";
  }
  if (target.field === "browsing_rules") {
    return Boolean(parseBootstrapBrowsingRules(
      value,
      hasIndependentSearchPlaceholderResolutionTarget(target, targets),
    ));
  }
  if (targetNeedsValidSearchPlaceholder(target)) {
    return value.trim().length <= MERCHANT_CATALOG_MAX_SEARCH_PLACEHOLDER_LENGTH;
  }
  return true;
}

export function isMerchantCatalogBootstrapResolutionSelectionComplete(
  target: MerchantCatalogBootstrapResolutionTarget,
  selection: MerchantCatalogBootstrapResolutionSelection | undefined,
  targets: MerchantCatalogBootstrapResolutionTarget[] = [],
) {
  if (!selection || selection.targetKey !== target.targetKey) return false;
  if ("choiceId" in selection) {
    const choice = target.choices.find((item) => item.choiceId === selection.choiceId);
    return Boolean(choice && isBootstrapResolutionValueLocallyValid(target, choice.value, targets));
  }
  return target.allowCustom && isBootstrapResolutionValueLocallyValid(target, selection.customValue, targets);
}

export function getMerchantCatalogBootstrapResolutionProgress(
  targets: MerchantCatalogBootstrapResolutionTarget[],
  draft: MerchantCatalogBootstrapResolutionDraft,
  excludedProductIds: string[],
) {
  const excluded = new Set(excludedProductIds);
  const processed = targets.filter((target) =>
    Boolean(target.productId && excluded.has(target.productId)) ||
    isMerchantCatalogBootstrapResolutionSelectionComplete(target, draft[target.targetKey], targets)
  ).length;
  return { processed, total: targets.length };
}

export function getMerchantCatalogBootstrapRelatedProductsWithoutProductTargets(
  targets: MerchantCatalogBootstrapResolutionTarget[],
) {
  const productTargetIds = new Set(
    targets.map((target) => target.productId?.trim() ?? "").filter(Boolean),
  );
  const relatedProducts = new Map<string, { productId: string; entityLabel: string }>();
  targets.forEach((target) => {
    target.relatedProducts?.forEach((relatedProduct) => {
      const productId = relatedProduct.productId.trim();
      if (!productId || productTargetIds.has(productId)) return;
      const entityLabel = relatedProduct.entityLabel.trim() || productId;
      const existing = relatedProducts.get(productId);
      if (!existing || (existing.entityLabel === productId && entityLabel !== productId)) {
        relatedProducts.set(productId, { productId, entityLabel });
      }
    });
  });
  return [...relatedProducts.values()];
}

export function buildMerchantCatalogBootstrapResolutionPlan(
  targets: MerchantCatalogBootstrapResolutionTarget[],
  draft: MerchantCatalogBootstrapResolutionDraft,
  excludedProductIds: string[],
): MerchantCatalogBootstrapResolutionPlan {
  const excluded = [...new Set(excludedProductIds.map((productId) => productId.trim()).filter(Boolean))].sort();
  const excludedSet = new Set(excluded);
  const selections = targets.flatMap((target) => {
    if (target.productId && excludedSet.has(target.productId)) return [];
    const selection = draft[target.targetKey];
    return selection ? [selection] : [];
  });
  return { version: 1, selections, excludedProductIds: excluded };
}

export function isMerchantCatalogBootstrapPreviewCurrent(
  preview: MerchantCatalogBootstrapResolutionResult | null,
  resolutionFingerprint: string,
  previewPlanSignature: string,
  currentPlanSignature: string,
) {
  return Boolean(
    preview?.ok &&
    preview.catalog &&
    resolutionFingerprint &&
    previewPlanSignature &&
    previewPlanSignature === currentPlanSignature,
  );
}

export function hasMerchantCatalogBootstrapResolutionWork(
  draft: MerchantCatalogBootstrapResolutionDraft,
  excludedProductIds: string[],
  preview: MerchantCatalogBootstrapResolutionResult | null,
) {
  return Object.keys(draft).length > 0 || excludedProductIds.length > 0 || preview !== null;
}

function isBootstrapConflictCoveredByTarget(
  conflict: MerchantCatalogConflict,
  target: MerchantCatalogBootstrapResolutionTarget,
) {
  if (!target.reasons.includes(conflict.field)) return false;
  if (conflict.productId) return target.scope === "product" && target.productId === conflict.productId;
  if (conflict.collectionId) return target.scope === "collection" && target.collectionId === conflict.collectionId;
  return target.scope === "catalog";
}

function isSupportedBootstrapResolutionTargetForUi(target: MerchantCatalogBootstrapResolutionTarget) {
  if (target.scope === "catalog") {
    return target.field === "price_prefix" || target.field === "category_options";
  }
  if (target.scope === "product") {
    return [
      "code",
      "name",
      "description",
      "price",
      "image_url",
      "thumbnail_url",
      "tag",
      "availability",
    ].includes(target.field);
  }
  return target.field === "product_ids" ||
    target.field === "browsing_rules" ||
    target.field === "search_placeholder_too_long";
}

export function getUnresolvableBootstrapConflicts(
  conflicts: MerchantCatalogConflict[],
  targets: MerchantCatalogBootstrapResolutionTarget[],
) {
  const uncovered = conflicts.filter(
    (conflict) => !targets.some((target) => isBootstrapConflictCoveredByTarget(conflict, target)),
  );
  const blockedTargets = targets.filter((target) => {
    if (!isSupportedBootstrapResolutionTargetForUi(target)) return true;
    const hasLocallyValidChoice = target.choices.some((choice) =>
      isBootstrapResolutionValueLocallyValid(target, choice.value, targets)
    );
    return !hasLocallyValidChoice && !target.allowCustom;
  });
  return { uncovered, blockedTargets };
}

function getBootstrapTargetCustomMaxLength(target: MerchantCatalogBootstrapResolutionTarget) {
  if (targetNeedsNonEmptyName(target)) return 160;
  if (targetNeedsValidPrice(target)) return 18;
  if (target.field === "code") return 80;
  if (target.field === "tag") return 100;
  if (target.field === "description") return 2_000;
  if (target.field === "image_url" || target.field === "thumbnail_url") return 2_048;
  if (target.field === "price_prefix") return 16;
  if (targetNeedsValidSearchPlaceholder(target)) return MERCHANT_CATALOG_MAX_SEARCH_PLACEHOLDER_LENGTH;
  return 4_000;
}

function getEmptyBootstrapCustomValue() {
  return "";
}

function getBootstrapTargetSummary(target: MerchantCatalogBootstrapResolutionTarget) {
  const reasons = target.reasons.map(conflictFieldLabel).filter((value, index, list) => list.indexOf(value) === index);
  return reasons.length > 0 ? reasons.join("、") : conflictFieldLabel(target.field);
}

function getBootstrapSourceLabel(source: MerchantCatalogBootstrapResolutionTarget["choices"][number]["sources"][number]) {
  return `${source.viewport === "desktop" ? "电脑端" : source.viewport === "mobile" ? "手机端" : "双端共享"} · 区块 ${source.blockId} · 来源 ${source.occurrence + 1}`;
}

function BootstrapConflicts({
  conflicts,
  darkMode,
}: {
  conflicts: MerchantCatalogConflict[];
  darkMode: boolean;
}) {
  if (conflicts.length === 0) return null;
  return (
    <div className="space-y-3">
      {conflicts.map((conflict, conflictIndex) => (
        <article
          key={`${conflict.code}:${conflict.field}:${conflict.productId ?? conflict.collectionId ?? conflictIndex}`}
          className={`rounded-2xl border p-4 ${
            darkMode ? "border-rose-400/25 bg-rose-400/5" : "border-rose-200 bg-rose-50/60"
          }`}
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className={`text-sm font-bold ${darkMode ? "text-rose-100" : "text-rose-800"}`}>
              {conflictCodeLabel(conflict)}
            </span>
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${darkMode ? "bg-rose-400/10 text-rose-200" : "bg-white text-rose-700"}`}>
              {conflictFieldLabel(conflict.field)}
            </span>
            {conflict.productId ? <code className="text-[11px] opacity-70">商品 {conflict.productId}</code> : null}
            {conflict.collectionId ? <code className="text-[11px] opacity-70">集合 {conflict.collectionId}</code> : null}
          </div>
          <div className="mt-3 space-y-2">
            {conflict.values.map((entry, valueIndex) => (
              <div
                key={`${formatConflictValue(entry.value)}:${valueIndex}`}
                className={`rounded-xl border px-3 py-2 text-xs ${
                  darkMode ? "border-slate-700 bg-slate-950/60 text-slate-300" : "border-rose-100 bg-white text-slate-600"
                }`}
              >
                <p className="break-words font-semibold">{formatConflictValue(entry.value)}</p>
                <p className="mt-1 opacity-70">
                  {entry.sources.length > 0
                    ? entry.sources.map((source) => `${source.viewport} · 区块 ${source.blockId}`).join("；")
                    : "来源数据无法识别"}
                </p>
              </div>
            ))}
          </div>
        </article>
      ))}
    </div>
  );
}

function BootstrapResolutionTargetEditor({
  target,
  resolutionTargets,
  selection,
  darkMode,
  disabled,
  onChange,
}: {
  target: MerchantCatalogBootstrapResolutionTarget;
  resolutionTargets: MerchantCatalogBootstrapResolutionTarget[];
  selection: MerchantCatalogBootstrapResolutionSelection | undefined;
  darkMode: boolean;
  disabled: boolean;
  onChange: (selection: MerchantCatalogBootstrapResolutionSelection) => void;
}) {
  const selectedChoiceId = selection && "choiceId" in selection ? selection.choiceId : "";
  const customSelected = Boolean(selection && "customValue" in selection);
  const customValue = selection && "customValue" in selection
    ? selection.customValue
    : getEmptyBootstrapCustomValue();
  const targetName = `bootstrap-resolution:${target.targetKey}`;
  const optionSurfaceClassName = darkMode
    ? "border-slate-700 bg-slate-950/55 text-slate-200"
    : "border-slate-200 bg-white text-slate-700";
  const selectedSurfaceClassName = darkMode
    ? "border-sky-400/60 bg-sky-400/10"
    : "border-sky-300 bg-sky-50";
  const inputClassName = darkMode
    ? "border-slate-600 bg-slate-950 text-slate-100 placeholder:text-slate-600 focus:border-sky-400 focus:ring-sky-400/20"
    : "border-slate-300 bg-white text-slate-900 placeholder:text-slate-400 focus:border-sky-500 focus:ring-sky-500/15";

  return (
    <fieldset className={`rounded-xl border p-3 ${darkMode ? "border-slate-700 bg-slate-900/50" : "border-slate-200 bg-slate-50/70"}`}>
      <legend className="px-1 text-xs font-bold">{getBootstrapTargetSummary(target)}</legend>
      <p className={`mb-2 text-[11px] leading-5 ${darkMode ? "text-slate-400" : "text-slate-500"}`}>
        明确选择一个已发布来源，或手动填写最终经营值；系统不会默认采用电脑端或手机端。
      </p>
      <div className="space-y-2">
        {target.choices.map((choice) => {
          const choiceIsValid = isBootstrapResolutionValueLocallyValid(
            target,
            choice.value,
            resolutionTargets,
          );
          const selected = selectedChoiceId === choice.choiceId;
          return (
            <label
              key={choice.choiceId}
              className={`flex items-start gap-2 rounded-xl border px-3 py-2.5 text-xs transition ${selected ? selectedSurfaceClassName : optionSurfaceClassName} ${choiceIsValid && !disabled ? "cursor-pointer" : "cursor-not-allowed opacity-65"}`}
            >
              <input
                type="radio"
                name={targetName}
                checked={selected}
                disabled={disabled || !choiceIsValid}
                onChange={() => onChange({ targetKey: target.targetKey, choiceId: choice.choiceId })}
                className="mt-0.5 h-4 w-4 shrink-0 border-slate-300 text-sky-600 focus:ring-sky-500"
              />
              <span className="min-w-0 flex-1">
                <span className="block max-h-28 overflow-y-auto whitespace-pre-wrap break-words font-semibold leading-5">
                  {formatConflictValue(choice.value)}
                </span>
                <span className="mt-1 block text-[11px] font-normal leading-5 opacity-70">
                  {choice.sources.length > 0
                    ? choice.sources.map(getBootstrapSourceLabel).join("；")
                    : "来源数据无法识别"}
                </span>
                {!choiceIsValid ? (
                  <span className="mt-1 block font-semibold text-rose-600">该来源值本身无效，请使用手动填写。</span>
                ) : null}
              </span>
            </label>
          );
        })}
        {target.allowCustom ? (
          <div className={`rounded-xl border px-3 py-2.5 text-xs ${customSelected ? selectedSurfaceClassName : optionSurfaceClassName}`}>
            <label className={`flex items-center gap-2 font-semibold ${disabled ? "cursor-not-allowed opacity-65" : "cursor-pointer"}`}>
              <input
                type="radio"
                name={targetName}
                checked={customSelected}
                disabled={disabled}
                onChange={() => onChange({ targetKey: target.targetKey, customValue: getEmptyBootstrapCustomValue() })}
                className="h-4 w-4 border-slate-300 text-sky-600 focus:ring-sky-500"
              />
              手动填写最终值
            </label>
            {customSelected ? (
              <div className="mt-2">
                {target.field === "description" || target.field === "browsing_rules" ? (
                  <textarea
                    value={customValue}
                    onChange={(event) => onChange({ targetKey: target.targetKey, customValue: event.target.value })}
                    disabled={disabled}
                    maxLength={getBootstrapTargetCustomMaxLength(target)}
                    rows={target.field === "browsing_rules" ? 5 : 4}
                    placeholder={target.field === "browsing_rules"
                      ? '{"searchEnabled":true,"searchPlaceholder":"","hideUnselectedCategory":true,"groupByCategory":false}'
                      : "填写最终商品描述"}
                    className={`w-full resize-y rounded-lg border px-3 py-2 text-xs outline-none ring-2 ring-transparent disabled:opacity-60 ${inputClassName}`}
                  />
                ) : (
                  <input
                    value={customValue}
                    onChange={(event) => onChange({ targetKey: target.targetKey, customValue: event.target.value })}
                    disabled={disabled}
                    maxLength={getBootstrapTargetCustomMaxLength(target)}
                    inputMode={targetNeedsValidPrice(target) ? "decimal" : undefined}
                    placeholder={targetNeedsNonEmptyName(target)
                      ? "请输入商品名称"
                      : targetNeedsValidPrice(target)
                        ? "例如 19.90；免费请填 0"
                        : targetNeedsValidSearchPlaceholder(target)
                          ? "请输入不超过 160 个字符的搜索提示词"
                          : "输入最终值；如需明确留空，可保持为空"}
                    className={`w-full rounded-lg border px-3 py-2 text-xs outline-none ring-2 ring-transparent disabled:opacity-60 ${inputClassName}`}
                  />
                )}
                {!isBootstrapResolutionValueLocallyValid(target, customValue, resolutionTargets) ? (
                  <p className="mt-1.5 font-semibold text-rose-600">
                    {targetNeedsNonEmptyName(target)
                      ? "商品名称不能为空。"
                      : targetNeedsValidPrice(target)
                        ? "价格必须是非负数字，最多两位小数；免费请填 0。"
                        : targetNeedsValidSearchPlaceholder(target)
                          ? `搜索提示词不能超过 ${MERCHANT_CATALOG_MAX_SEARCH_PLACEHOLDER_LENGTH} 个字符。`
                          : "填写内容尚未通过校验。"}
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </fieldset>
  );
}

function LoadingSkeleton({ darkMode }: { darkMode: boolean }) {
  const blockClassName = darkMode ? "bg-slate-800" : "bg-slate-200";
  return (
    <div className="animate-pulse space-y-4" aria-label="正在加载商品目录">
      <div className={`h-24 rounded-2xl ${blockClassName}`} />
      <div className={`h-44 rounded-2xl ${blockClassName}`} />
      <div className="grid gap-3 sm:grid-cols-2">
        <div className={`h-36 rounded-2xl ${blockClassName}`} />
        <div className={`h-36 rounded-2xl ${blockClassName}`} />
      </div>
    </div>
  );
}

export default function MerchantCatalogManagerPanel({
  siteId,
  darkMode = false,
  catalogTarget = null,
  onChanged,
  onLeaveStateChange,
}: MerchantCatalogManagerPanelProps) {
  const categoryListId = useId();
  const productImportPreviewTitleId = useId();
  const productImageImportPreviewTitleId = useId();
  const [catalog, setCatalog] = useState<MerchantCatalog | null>(null);
  const [bootstrap, setBootstrap] = useState<MerchantCatalogBootstrapResult | null>(null);
  const [bootstrapFingerprint, setBootstrapFingerprint] = useState("");
  const bootstrapFingerprintRef = useRef("");
  bootstrapFingerprintRef.current = bootstrapFingerprint;
  const [bootstrapResolutionDraft, setBootstrapResolutionDraft] = useState<MerchantCatalogBootstrapResolutionDraft>({});
  const [bootstrapExcludedProductIds, setBootstrapExcludedProductIds] = useState<string[]>([]);
  const [bootstrapPreview, setBootstrapPreview] = useState<MerchantCatalogBootstrapResolutionResult | null>(null);
  const [bootstrapResolutionFingerprint, setBootstrapResolutionFingerprint] = useState("");
  const [bootstrapPreviewPlanSignature, setBootstrapPreviewPlanSignature] = useState("");
  const [bootstrapPreviewing, setBootstrapPreviewing] = useState(false);
  const bootstrapPreviewingRef = useRef(false);
  bootstrapPreviewingRef.current = bootstrapPreviewing;
  const bootstrapResolutionRequestSequenceRef = useRef(0);
  const bootstrapPlanIdentityRef = useRef("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [revisionConflict, setRevisionConflict] = useState("");
  const [notice, setNotice] = useState("");
  const [actingKey, setActingKey] = useState("");
  const actingKeyRef = useRef("");
  actingKeyRef.current = actingKey;
  const [pricePrefixDraft, setPricePrefixDraft] = useState("");
  const [productDraft, setProductDraft] = useState<MerchantCatalogProduct | null>(null);
  const [productDraftIsNew, setProductDraftIsNew] = useState(false);
  const [productDraftRevision, setProductDraftRevision] = useState<number | null>(null);
  const [productDraftCollectionIds, setProductDraftCollectionIds] = useState<string[]>([]);
  const [productImageUploading, setProductImageUploading] = useState(false);
  const [productImageUpload, setProductImageUpload] = useState<MerchantCatalogSingleProductImageUpload | null>(null);
  const [productImageUploadError, setProductImageUploadError] = useState("");
  const [categoryDraft, setCategoryDraft] = useState<MerchantCatalogCategory | null>(null);
  const [categoryDraftIsNew, setCategoryDraftIsNew] = useState(false);
  const [categoryDraftRevision, setCategoryDraftRevision] = useState<number | null>(null);
  const [collectionDraft, setCollectionDraft] = useState<MerchantCatalogCollection | null>(null);
  const [collectionDraftIsNew, setCollectionDraftIsNew] = useState(false);
  const [collectionDraftRevision, setCollectionDraftRevision] = useState<number | null>(null);
  const [productSearch, setProductSearch] = useState("");
  const [productImportDraft, setProductImportDraft] = useState<MerchantCatalogProductImportDraft | null>(null);
  const [productImportReading, setProductImportReading] = useState(false);
  const [productImportError, setProductImportError] = useState("");
  const [productImageImportDraft, setProductImageImportDraft] = useState<MerchantCatalogProductImageImportDraft | null>(null);
  const [productImageImportUploading, setProductImageImportUploading] = useState(false);
  const [productImageImportProgress, setProductImageImportProgress] = useState<MerchantCatalogProductImageUploadProgress | null>(null);
  const [productImageImportError, setProductImageImportError] = useState("");
  const mountedRef = useRef(true);
  const activeSiteIdRef = useRef(siteId.trim());
  const activeSiteVersionRef = useRef(0);
  const renderedSiteId = siteId.trim();
  if (activeSiteIdRef.current !== renderedSiteId) {
    activeSiteIdRef.current = renderedSiteId;
    activeSiteVersionRef.current += 1;
  }
  const catalogRef = useRef<MerchantCatalog | null>(null);
  const catalogSiteIdRef = useRef("");
  const bootstrapRef = useRef<MerchantCatalogBootstrapResult | null>(null);
  const productDraftRef = useRef<MerchantCatalogProduct | null>(productDraft);
  productDraftRef.current = productDraft;
  const productDraftRevisionRef = useRef<number | null>(productDraftRevision);
  productDraftRevisionRef.current = productDraftRevision;
  const productDraftGenerationRef = useRef(0);
  const productImageInputRef = useRef<HTMLInputElement | null>(null);
  const productImageUploadSequenceRef = useRef(0);
  const productImageUploadingRef = useRef(productImageUploading);
  productImageUploadingRef.current = productImageUploading;
  const productImageUploadRef = useRef<MerchantCatalogSingleProductImageUpload | null>(productImageUpload);
  productImageUploadRef.current = productImageUpload;
  const productImportInputRef = useRef<HTMLInputElement | null>(null);
  const productImportReadSequenceRef = useRef(0);
  const productImageImportInputRef = useRef<HTMLInputElement | null>(null);
  const productImageImportSequenceRef = useRef(0);
  const productImageImportInFlightRef = useRef(false);
  const requestSequenceRef = useRef(0);
  const initializedTargetDraftKeyRef = useRef("");
  const normalizedCatalogTarget = useMemo<MerchantCatalogTarget | null>(() => {
    const blockId = catalogTarget?.blockId.trim() ?? "";
    if (!blockId || (catalogTarget?.viewport !== "desktop" && catalogTarget?.viewport !== "mobile")) {
      return null;
    }
    return {
      blockId,
      viewport: catalogTarget.viewport,
      productIds: Array.isArray(catalogTarget.productIds)
        ? [...new Set(catalogTarget.productIds.map((productId) => productId.trim()).filter(Boolean))]
        : undefined,
      browsingRules: copyMerchantCatalogBrowsingRules(catalogTarget.browsingRules),
    };
  }, [catalogTarget]);

  const clearBootstrapPreview = useCallback(() => {
    bootstrapResolutionRequestSequenceRef.current += 1;
    bootstrapPreviewingRef.current = false;
    setBootstrapPreviewing(false);
    setBootstrapPreview(null);
    setBootstrapResolutionFingerprint("");
    setBootstrapPreviewPlanSignature("");
  }, []);

  const clearBootstrapResolutionState = useCallback(() => {
    clearBootstrapPreview();
    setBootstrapResolutionDraft({});
    setBootstrapExcludedProductIds([]);
  }, [clearBootstrapPreview]);

  const bootstrapResolutionTargets = useMemo(
    () => bootstrap?.resolutionTargets ?? [],
    [bootstrap?.resolutionTargets],
  );
  const bootstrapPlanIdentity = useMemo(
    () => bootstrapFingerprint
      ? JSON.stringify({
          bootstrapFingerprint,
          targets: bootstrapResolutionTargets.map((target) => ({
            targetKey: target.targetKey,
            choices: target.choices.map((choice) => choice.choiceId),
          })),
        })
      : "",
    [bootstrapFingerprint, bootstrapResolutionTargets],
  );

  useEffect(() => {
    const previousIdentity = bootstrapPlanIdentityRef.current;
    bootstrapPlanIdentityRef.current = bootstrapPlanIdentity;
    if (previousIdentity && previousIdentity !== bootstrapPlanIdentity) {
      clearBootstrapResolutionState();
    }
  }, [bootstrapPlanIdentity, clearBootstrapResolutionState]);

  const setBootstrapResolutionSelection = useCallback(
    (selection: MerchantCatalogBootstrapResolutionSelection) => {
      clearBootstrapPreview();
      setBootstrapResolutionDraft((current) => ({
        ...current,
        [selection.targetKey]: selection,
      }));
    },
    [clearBootstrapPreview],
  );

  const toggleBootstrapProductExclusion = useCallback(
    (productId: string) => {
      clearBootstrapPreview();
      setBootstrapExcludedProductIds((current) =>
        current.includes(productId)
          ? current.filter((item) => item !== productId)
          : [...current, productId],
      );
    },
    [clearBootstrapPreview],
  );

  const leaveState = useMemo<MerchantCatalogLeaveState>(() => {
    if (Boolean(actingKey) || bootstrapPreviewing || productImportReading || productImageImportUploading || productImageUploading) return "busy";
    if (productImageUpload || (productImageImportDraft?.uploadedEntries.length ?? 0) > 0) {
      return "uploaded_uncommitted";
    }
    if (
      productDraft ||
      categoryDraft ||
      collectionDraft ||
      productImportDraft ||
      productImageImportDraft ||
      Object.keys(bootstrapResolutionDraft).length > 0 ||
      bootstrapExcludedProductIds.length > 0 ||
      bootstrapPreview !== null ||
      (catalog !== null && pricePrefixDraft !== catalog.pricePrefix)
    ) {
      return "draft";
    }
    return "clean";
  }, [
    actingKey,
    bootstrapExcludedProductIds,
    bootstrapPreview,
    bootstrapPreviewing,
    bootstrapResolutionDraft,
    catalog,
    categoryDraft,
    collectionDraft,
    pricePrefixDraft,
    productDraft,
    productImageUpload,
    productImageUploading,
    productImageImportDraft,
    productImageImportUploading,
    productImportDraft,
    productImportReading,
  ]);

  useEffect(() => {
    onLeaveStateChange?.(leaveState);
  }, [leaveState, onLeaveStateChange]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const clearProductImportDraft = useCallback(() => {
    productImportReadSequenceRef.current += 1;
    setProductImportDraft(null);
    setProductImportError("");
    setProductImportReading(false);
    if (productImportInputRef.current) productImportInputRef.current.value = "";
  }, []);

  const clearProductImageImportDraft = useCallback(() => {
    productImageImportSequenceRef.current += 1;
    setProductImageImportDraft(null);
    setProductImageImportUploading(false);
    setProductImageImportProgress(null);
    setProductImageImportError("");
    if (productImageImportInputRef.current) productImageImportInputRef.current.value = "";
  }, []);

  const clearSingleProductImageUpload = useCallback(() => {
    productImageUploadSequenceRef.current += 1;
    productImageUploadingRef.current = false;
    productImageUploadRef.current = null;
    setProductImageUploading(false);
    setProductImageUpload(null);
    setProductImageUploadError("");
    if (productImageInputRef.current) productImageInputRef.current.value = "";
  }, []);

  const loadCatalog = useCallback(async (signal?: AbortSignal) => {
    const normalizedSiteId = siteId.trim();
    if (activeSiteIdRef.current !== normalizedSiteId) return;
    clearBootstrapResolutionState();
    const siteVersion = activeSiteVersionRef.current;
    const sequence = requestSequenceRef.current + 1;
    requestSequenceRef.current = sequence;
    const hasCatalogState = catalogRef.current !== null || bootstrapRef.current !== null;
    if (!normalizedSiteId) {
      catalogRef.current = null;
      catalogSiteIdRef.current = "";
      bootstrapRef.current = null;
      setCatalog(null);
      setBootstrap(null);
      setBootstrapFingerprint("");
      setError("缺少商户编号，暂时无法加载商品目录。");
      setLoading(false);
      setRefreshing(false);
      return;
    }

    setError("");
    setLoading(!hasCatalogState);
    setRefreshing(hasCatalogState);
    try {
      const query = new URLSearchParams({ siteId: normalizedSiteId });
      const response = await fetch(`/api/orders/catalog?${query.toString()}`, {
        method: "GET",
        cache: "no-store",
        signal,
      });
      const payload = (await response.json().catch(() => null)) as CatalogApiPayload | null;
      if (!response.ok || !payload?.ok) {
        throw new Error(getCatalogError(payload, "商品目录加载失败，请稍后重试。"));
      }
      if (
        !mountedRef.current ||
        requestSequenceRef.current !== sequence ||
        activeSiteIdRef.current !== normalizedSiteId ||
        activeSiteVersionRef.current !== siteVersion
      ) return;
      catalogRef.current = payload.catalog ?? null;
      catalogSiteIdRef.current = normalizedSiteId;
      bootstrapRef.current = payload.bootstrap ?? null;
      setCatalog(payload.catalog ?? null);
      setBootstrap(payload.bootstrap ?? null);
      setBootstrapFingerprint(String(payload.bootstrapFingerprint ?? ""));
    } catch (requestError) {
      if (requestError instanceof DOMException && requestError.name === "AbortError") return;
      if (
        !mountedRef.current ||
        requestSequenceRef.current !== sequence ||
        activeSiteIdRef.current !== normalizedSiteId ||
        activeSiteVersionRef.current !== siteVersion
      ) return;
      setError(requestError instanceof Error ? requestError.message : "商品目录加载失败，请稍后重试。");
    } finally {
      if (
        mountedRef.current &&
        requestSequenceRef.current === sequence &&
        activeSiteIdRef.current === normalizedSiteId &&
        activeSiteVersionRef.current === siteVersion
      ) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [clearBootstrapResolutionState, siteId]);

  useEffect(() => {
    catalogRef.current = null;
    catalogSiteIdRef.current = "";
    bootstrapRef.current = null;
    clearBootstrapResolutionState();
    setCatalog(null);
    setBootstrap(null);
    setBootstrapFingerprint("");
    setProductDraft(null);
    productDraftGenerationRef.current += 1;
    setProductDraftRevision(null);
    setProductDraftCollectionIds([]);
    clearSingleProductImageUpload();
    setCategoryDraft(null);
    setCategoryDraftRevision(null);
    setCollectionDraft(null);
    setCollectionDraftRevision(null);
    clearProductImportDraft();
    clearProductImageImportDraft();
    setProductImportReading(false);
    setActionError("");
    setRevisionConflict("");
    setNotice("");
    setActingKey("");
    actingKeyRef.current = "";
    initializedTargetDraftKeyRef.current = "";
    const controller = new AbortController();
    void loadCatalog(controller.signal);
    return () => {
      controller.abort();
      requestSequenceRef.current += 1;
    };
  }, [clearBootstrapResolutionState, clearProductImageImportDraft, clearProductImportDraft, clearSingleProductImageUpload, loadCatalog]);

  useEffect(() => {
    setPricePrefixDraft(catalog?.pricePrefix ?? "");
  }, [catalog?.pricePrefix, catalog?.revision]);

  const resolvedTargetCollection = useMemo(
    () =>
      catalog && normalizedCatalogTarget
        ? resolveMerchantCatalogCollection(
            catalog,
            normalizedCatalogTarget.blockId,
            normalizedCatalogTarget.viewport,
          )
        : null,
    [catalog, normalizedCatalogTarget],
  );

  const missingTargetProductIds = useMemo(() => {
    if (!catalog || !normalizedCatalogTarget?.productIds) return [];
    const knownProductIds = new Set(catalog.products.map((product) => product.id));
    return normalizedCatalogTarget.productIds.filter((productId) => !knownProductIds.has(productId));
  }, [catalog, normalizedCatalogTarget]);

  useEffect(() => {
    if (!catalog || !normalizedCatalogTarget || resolvedTargetCollection) return;
    const targetDraftKey = `${siteId.trim()}\u0001${normalizedCatalogTarget.blockId}\u0001${normalizedCatalogTarget.viewport}`;
    if (initializedTargetDraftKeyRef.current === targetDraftKey) return;
    initializedTargetDraftKeyRef.current = targetDraftKey;
    const knownProductIds = new Set(catalog.products.map((product) => product.id));
    const targetProductIds = normalizedCatalogTarget.productIds;
    const initialProductIds = targetProductIds
      ? targetProductIds.filter((productId) => knownProductIds.has(productId))
      : catalog.products.map((product) => product.id);
    setCollectionDraft({
      id: createMerchantCatalogCollectionId(
        normalizedCatalogTarget.blockId,
        "shared",
      ),
      blockId: normalizedCatalogTarget.blockId,
      viewport: "shared",
      productIds: initialProductIds,
    });
    setCollectionDraftIsNew(true);
    setCollectionDraftRevision(catalog.revision);
  }, [catalog, normalizedCatalogTarget, resolvedTargetCollection, siteId]);

  const runMutation = useCallback(
    async (key: string, mutation: CatalogMutation, successMessage: string, baseRevision?: number) => {
      if (actingKeyRef.current || productImageUploadingRef.current) return false;
      const uncommittedProductImage = productImageUploadRef.current;
      if (
        uncommittedProductImage &&
        key !== `product:${uncommittedProductImage.productId}`
      ) {
        setActionError("请先保存当前商品，把已上传图片写入目录；否则该图片可能成为未引用资源。");
        return false;
      }
      const mutationSiteId = siteId.trim();
      const mutationSiteVersion = activeSiteVersionRef.current;
      if (!mutationSiteId || activeSiteIdRef.current !== mutationSiteId) return false;
      const mutationContextIsActive = () =>
        mountedRef.current &&
        activeSiteIdRef.current === mutationSiteId &&
        activeSiteVersionRef.current === mutationSiteVersion;
      const expectedRevision = baseRevision ?? catalogRef.current?.revision ?? 0;
      actingKeyRef.current = key;
      setActingKey(key);
      setActionError("");
      setRevisionConflict("");
      setNotice("");
      try {
        const response = await fetch("/api/orders/catalog", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            siteId: mutationSiteId,
            expectedRevision,
            ...mutation,
          }),
        });
        const payload = (await response.json().catch(() => null)) as CatalogApiPayload | null;
        if (!mutationContextIsActive()) return false;
        if (payload?.error === "merchant_catalog_already_initialized") {
          setRevisionConflict("商品目录已在其他页面建立。已重新加载最新目录，请核对后继续操作。");
          await loadCatalog();
          return false;
        }
        if (payload?.error === "merchant_catalog_bootstrap_source_changed") {
          clearBootstrapResolutionState();
          setRevisionConflict("已发布网站商品在确认期间发生变化。旧选择和安全预览已清空，请重新核对最新商品、价格和区块。");
          await loadCatalog();
          return false;
        }
        if (payload?.error === "merchant_catalog_bootstrap_resolution_changed") {
          clearBootstrapPreview();
          setRevisionConflict("安全预览已失效，目录尚未写入。请重新生成并核对最新预览后再确认。");
          return false;
        }
        if (isRevisionConflict(payload)) {
          const currentRevision = payload?.currentRevision;
          setRevisionConflict(
            `目录已被其他页面更新${typeof currentRevision === "number" ? `（当前修订版 ${currentRevision}）` : ""}。已重新加载最新数据，请核对后再保存。${productImageUploadRef.current ? " 已上传的单商品图片尚未写入目录，离开前请留意未引用资源风险。" : ""}`,
          );
          productDraftGenerationRef.current += 1;
          productImageUploadSequenceRef.current += 1;
          setProductDraft(null);
          setProductDraftRevision(null);
          setProductDraftCollectionIds([]);
          setCategoryDraft(null);
          setCategoryDraftRevision(null);
          setCollectionDraft(null);
          setCollectionDraftRevision(null);
          clearProductImportDraft();
          await loadCatalog();
          return false;
        }
        if (!response.ok || !payload?.ok) {
          throw new Error(getCatalogError(payload, "商品目录保存失败，请稍后重试。"));
        }
        const changedDetail = parseMerchantCatalogChangedEventDetail({
          siteId: mutationSiteId,
          revision: payload.catalog?.revision,
        });
        if (changedDetail && mutationContextIsActive() && typeof window !== "undefined") {
          window.dispatchEvent(
            new CustomEvent(MERCHANT_CATALOG_CHANGED_EVENT, { detail: changedDetail }),
          );
        }
        setNotice(
          payload.warning
            ? `${successMessage} 目录已保存，但本次历史备份写入失败；请稍后再次修改或联系支持。`
            : successMessage,
        );
        await Promise.allSettled([
          loadCatalog(),
          Promise.resolve().then(() => mutationContextIsActive() ? onChanged?.() : undefined),
        ]);
        return mutationContextIsActive();
      } catch (requestError) {
        if (!mutationContextIsActive()) return false;
        setActionError(requestError instanceof Error ? requestError.message : "商品目录保存失败，请稍后重试。");
        return false;
      } finally {
        if (mutationContextIsActive()) {
          actingKeyRef.current = "";
          setActingKey("");
        }
      }
    },
    [clearBootstrapPreview, clearBootstrapResolutionState, clearProductImportDraft, loadCatalog, onChanged, siteId],
  );

  const readProductImportFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    const importReadSequence = productImportReadSequenceRef.current + 1;
    productImportReadSequenceRef.current = importReadSequence;
    const currentCatalog = catalogRef.current;
    if (!currentCatalog) {
      setProductImportError("商品目录尚未加载完成，请刷新目录后再选择文件。");
      setProductImportReading(false);
      input.value = "";
      return;
    }
    if (!/\.(xlsx|xls)$/i.test(file.name)) {
      setProductImportDraft(null);
      setProductImportError("请选择 .xlsx 或 .xls 格式的 Excel 文件。");
      setProductImportReading(false);
      input.value = "";
      return;
    }
    if (file.size > MERCHANT_CATALOG_IMPORT_MAX_FILE_BYTES) {
      setProductImportDraft(null);
      setProductImportError("Excel 文件不能超过 10 MB，请删除无关工作表、图片或格式后重试。");
      setProductImportReading(false);
      input.value = "";
      return;
    }

    const importSiteId = activeSiteIdRef.current;
    const importRequestSequence = requestSequenceRef.current;
    const baseRevision = currentCatalog.revision;
    setProductImportReading(true);
    setProductImportDraft(null);
    setProductImportError("");
    try {
      const { parseProductWorkbook } = await import("@/lib/productImport");
      const parsed = parseProductWorkbook(await file.arrayBuffer());
      if (!mountedRef.current) return;
      if (
        productImportReadSequenceRef.current !== importReadSequence ||
        activeSiteIdRef.current !== importSiteId ||
        requestSequenceRef.current !== importRequestSequence ||
        catalogRef.current !== currentCatalog ||
        catalogRef.current?.revision !== baseRevision
      ) {
        if (
          productImportReadSequenceRef.current === importReadSequence &&
          activeSiteIdRef.current === importSiteId
        ) {
          setProductImportError("读取文件期间商品目录已刷新。请基于最新目录重新选择文件并核对预览。");
        }
        return;
      }
      if (parsed.truncated) {
        setProductImportError("首个工作表超过安全读取范围。每次最多导入 1000 条商品记录；请拆分文件，或删除工作表末尾多余的空白行后重试。");
        return;
      }
      if (parsed.rowCount === 0 || parsed.items.length === 0) {
        setProductImportError("首个工作表中没有可导入的商品记录，请确认第一行是表头，后续记录已填写商品数据。");
        return;
      }
      const plan = planMerchantCatalogProductImport(currentCatalog, parsed.items);
      if (!plan.ok) {
        setProductImportError(getProductImportPlanError(plan));
        return;
      }
      setProductImportDraft({
        siteId: importSiteId,
        fileName: file.name,
        rowCount: parsed.rowCount,
        items: parsed.items,
        baseRevision,
        plan,
      });
    } catch (readError) {
      if (
        !mountedRef.current ||
        productImportReadSequenceRef.current !== importReadSequence ||
        activeSiteIdRef.current !== importSiteId ||
        requestSequenceRef.current !== importRequestSequence ||
        catalogRef.current !== currentCatalog
      ) return;
      const reason = readError instanceof Error ? readError.message.toLocaleLowerCase() : "";
      setProductImportError(
        reason.includes("password") || reason.includes("encrypt")
          ? "无法读取受密码保护的 Excel 文件，请解除密码后重新选择。"
          : "无法解析这个 Excel 文件，请确认文件未损坏，并使用 .xlsx 或 .xls 格式重试。",
      );
    } finally {
      if (mountedRef.current && productImportReadSequenceRef.current === importReadSequence) {
        setProductImportReading(false);
        input.value = "";
      }
    }
  };

  const confirmProductImport = async () => {
    const draft = productImportDraft;
    if (!draft || draft.plan.summary.created + draft.plan.summary.updated === 0) return;
    const siteChanged = activeSiteIdRef.current !== draft.siteId;
    if (siteChanged || catalogRef.current?.revision !== draft.baseRevision) {
      clearProductImportDraft();
      setRevisionConflict("商户或目录在导入预览打开后发生了变化。已重新加载最新数据，请重新选择 Excel 文件并核对预览。");
      if (!siteChanged) await loadCatalog();
      return;
    }
    const saved = await runMutation(
      "bulk-import-products",
      { action: "bulk_import_products", items: draft.items },
      `Excel 导入完成：新建 ${draft.plan.summary.created} 个，更新 ${draft.plan.summary.updated} 个，${draft.plan.summary.unchanged} 个无需变更。`,
      draft.baseRevision,
    );
    if (saved) clearProductImportDraft();
  };

  const readProductImageImportFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const files = Array.from(input.files ?? []);
    input.value = "";
    const selectionId = productImageImportSequenceRef.current + 1;
    productImageImportSequenceRef.current = selectionId;
    setProductImageImportError("");
    setProductImageImportProgress(null);

    const selectionError = getProductImageFileSelectionError(files);
    if (selectionError) {
      setProductImageImportDraft(null);
      setProductImageImportError(selectionError);
      return;
    }

    const importSiteId = activeSiteIdRef.current;
    const currentCatalog = catalogRef.current;
    if (!currentCatalog || !importSiteId || catalogSiteIdRef.current !== importSiteId) {
      setProductImageImportDraft(null);
      setProductImageImportError("商品目录尚未加载完成，请刷新目录后再选择图片。");
      return;
    }

    const plan = planMerchantCatalogProductImageMatches(
      currentCatalog,
      files.map((file) => file.name),
    );
    if (!plan.ok) {
      setProductImageImportDraft(null);
      setProductImageImportError(getProductImageMatchPlanError(plan));
      return;
    }

    clearProductImportDraft();
    setActionError("");
    setRevisionConflict("");
    setNotice("");
    setProductImageImportDraft({
      siteId: importSiteId,
      siteVersion: activeSiteVersionRef.current,
      selectionId,
      baseRevision: currentCatalog.revision,
      files,
      plan,
      uploadedEntries: [],
      uploadFailures: [],
    });
  };

  const requestClearProductImageImportDraft = () => {
    if (productImageImportUploading) return;
    const uploadedCount = productImageImportDraft?.uploadedEntries.length ?? 0;
    if (
      uploadedCount > 0 &&
      !window.confirm(
        `当前有 ${uploadedCount} 张图片已经上传但尚未写入商品目录。关闭预览后，这些图片可能成为未引用资源。仍要关闭吗？`,
      )
    ) return;
    clearProductImageImportDraft();
  };

  const openProductImageImportPicker = () => {
    if (productImageImportUploading || actingKey) return;
    const uploadedCount = productImageImportDraft?.uploadedEntries.length ?? 0;
    if (
      uploadedCount > 0 &&
      !window.confirm(
        `重新选择会放弃当前批次；已有 ${uploadedCount} 张图片上传但尚未写入目录，可能成为未引用资源。仍要重新选择吗？`,
      )
    ) return;
    if (uploadedCount > 0) clearProductImageImportDraft();
    productImageImportInputRef.current?.click();
  };

  const rebaseProductImageImportDraft = () => {
    const draft = productImageImportDraft;
    const currentCatalog = catalogRef.current;
    const currentSiteId = activeSiteIdRef.current;
    if (
      !draft ||
      !currentCatalog ||
      !currentSiteId ||
      currentSiteId !== draft.siteId ||
      catalogSiteIdRef.current !== draft.siteId ||
      productImageImportUploading ||
      actingKey
    ) return;
    const plan = planMerchantCatalogProductImageMatches(
      currentCatalog,
      draft.files.map((file) => file.name),
    );
    if (!plan.ok) {
      setProductImageImportError(getProductImageMatchPlanError(plan));
      return;
    }
    const selectionId = productImageImportSequenceRef.current + 1;
    productImageImportSequenceRef.current = selectionId;
    setRevisionConflict("");
    setProductImageImportError("");
    setProductImageImportProgress(null);
    setProductImageImportDraft({
      ...draft,
      siteVersion: activeSiteVersionRef.current,
      selectionId,
      baseRevision: currentCatalog.revision,
      plan,
      uploadFailures: [],
    });
  };

  const confirmProductImageImport = async () => {
    const draft = productImageImportDraft;
    if (
      !draft ||
      draft.plan.summary.matched === 0 ||
      productImageImportUploading ||
      productImageImportInFlightRef.current ||
      Boolean(actingKey)
    ) return;

    const contextIsActive = () =>
      mountedRef.current &&
      productImageImportSequenceRef.current === draft.selectionId &&
      activeSiteIdRef.current === draft.siteId &&
      activeSiteVersionRef.current === draft.siteVersion &&
      catalogSiteIdRef.current === draft.siteId;
    const currentCatalog = catalogRef.current;
    if (!contextIsActive() || !currentCatalog || currentCatalog.revision !== draft.baseRevision) {
      setProductImageImportError(
        `目录已不再是预览时的修订版 ${draft.baseRevision}。请先加载最新版并重新匹配；系统不会把旧预览静默写入新版目录。`,
      );
      if (activeSiteIdRef.current === draft.siteId) await loadCatalog();
      return;
    }

    const fileByName = new Map(draft.files.map((file) => [file.name.trim(), file]));
    const matchedRows = draft.plan.rows.filter(
      (row): row is typeof row & { productId: string } => row.status === "matched" && typeof row.productId === "string",
    );
    const uploadedByFileName = new Map(
      draft.uploadedEntries.map((entry) => [entry.fileName, entry] as const),
    );
    const failuresByFileName = new Map(
      draft.uploadFailures.map((failure) => [failure.fileName, failure] as const),
    );
    const pendingRows = matchedRows.filter((row) => !uploadedByFileName.has(row.fileName));
    const orderedUploadedEntries = () =>
      draft.plan.rows.flatMap((row) => {
        const entry = uploadedByFileName.get(row.fileName);
        return entry ? [entry] : [];
      });
    const orderedFailures = () =>
      matchedRows.flatMap((row) => {
        const failure = failuresByFileName.get(row.fileName);
        return failure ? [failure] : [];
      });
    let processed = matchedRows.length - pendingRows.length;
    let nextPendingIndex = 0;

    productImageImportInFlightRef.current = true;
    setProductImageImportUploading(true);
    setProductImageImportError("");
    setRevisionConflict("");
    setActionError("");
    setNotice("");
    setProductImageImportProgress({
      processed,
      total: matchedRows.length,
      uploaded: matchedRows.filter((row) => uploadedByFileName.has(row.fileName)).length,
      failed: 0,
    });

    try {
      const {
        fileToOptimizedImageDataUrl,
        uploadImageDataUrlToSupabaseWithMetadata,
      } = await import("@/lib/editorAssetProcessing");
      if (!contextIsActive()) return;

      const syncDraftProgress = () => {
        if (!contextIsActive()) return;
        const uploaded = matchedRows.filter((row) => uploadedByFileName.has(row.fileName)).length;
        const failures = orderedFailures();
        setProductImageImportDraft((current) =>
          current?.selectionId === draft.selectionId
            ? {
                ...current,
                uploadedEntries: orderedUploadedEntries(),
                uploadFailures: failures,
              }
            : current,
        );
        setProductImageImportProgress({
          processed,
          total: matchedRows.length,
          uploaded,
          failed: failures.length,
        });
      };

      const uploadWorker = async () => {
        while (contextIsActive()) {
          const pendingIndex = nextPendingIndex;
          nextPendingIndex += 1;
          const row = pendingRows[pendingIndex];
          if (!row) return;
          const file = fileByName.get(row.fileName);
          failuresByFileName.delete(row.fileName);
          try {
            if (!file) throw new Error("所选图片已不可用，请重新选择文件。");
            const dataUrl = await fileToOptimizedImageDataUrl(file, { maxSide: 1600, quality: 0.82 });
            if (!contextIsActive()) return;
            const uploaded = await uploadImageDataUrlToSupabaseWithMetadata(
              dataUrl,
              draft.siteId,
              "product-image",
              {
                operationModule: "订单工作台 > 商品目录",
                operationAction: "批量上传商品图片",
                operationSummary: `在订单工作台按商品编码上传图片 ${row.fileName}`,
              },
            );
            if (!uploaded?.url) throw new Error("图片上传失败，请稍后重试。");
            uploadedByFileName.set(row.fileName, {
              fileName: row.fileName,
              imageUrl: uploaded.url,
              ...(uploaded.thumbnailUrl ? { thumbnailUrl: uploaded.thumbnailUrl } : {}),
            });
          } catch (uploadError) {
            failuresByFileName.set(row.fileName, {
              fileName: row.fileName,
              message: getProductImageUploadFailureMessage(uploadError),
            });
          } finally {
            processed += 1;
            syncDraftProgress();
          }
        }
      };

      await Promise.all(
        Array.from(
          { length: Math.min(MERCHANT_CATALOG_IMAGE_IMPORT_CONCURRENCY, pendingRows.length) },
          () => uploadWorker(),
        ),
      );
      if (!contextIsActive()) return;

      const uploadFailures = orderedFailures();
      if (uploadFailures.length > 0) {
        setProductImageImportError(
          `${uploadFailures.length} 张图片处理或上传失败，商品目录尚未修改。已成功上传的图片会在本页重试时复用；若关闭或离开当前批次，它们可能成为未引用资源。`,
        );
        return;
      }

      const mutationItems = matchedRows.flatMap((row) => {
        const entry = uploadedByFileName.get(row.fileName);
        return entry ? [entry] : [];
      });
      if (mutationItems.length !== matchedRows.length) {
        setProductImageImportError("部分匹配图片尚未上传完成，商品目录未修改；请重试当前批次。");
        return;
      }
      if (!contextIsActive()) return;
      if (catalogRef.current?.revision !== draft.baseRevision || actingKeyRef.current) {
        setProductImageImportError(
          "图片上传期间目录发生了其他操作，系统没有写入旧预览。已上传图片会保留在当前批次；请加载最新版并重新匹配。",
        );
        if (!actingKeyRef.current) await loadCatalog();
        return;
      }

      const saved = await runMutation(
        "bulk-set-product-images",
        { action: "bulk_set_product_images", items: mutationItems },
        `商品图片导入完成：已按编码更新 ${mutationItems.length} 个商品，${draft.plan.summary.unmatched} 个未匹配文件未上传。`,
        draft.baseRevision,
      );
      if (saved) {
        clearProductImageImportDraft();
      } else if (contextIsActive()) {
        setProductImageImportError(
          `目录尚未写入。已有 ${mutationItems.length} 张图片上传成功；请保留当前预览，加载最新版后重新匹配并重试。若关闭或离开，它们可能成为未引用资源。`,
        );
      }
    } catch (uploadError) {
      if (contextIsActive()) {
        setProductImageImportError(
          `${getProductImageUploadFailureMessage(uploadError)} 商品目录尚未修改；已上传成功的图片会在本页重试时复用。`,
        );
      }
    } finally {
      productImageImportInFlightRef.current = false;
      if (contextIsActive()) setProductImageImportUploading(false);
    }
  };

  const filteredProducts = useMemo(() => {
    if (!catalog) return [];
    const query = productSearch.trim().toLocaleLowerCase();
    if (!query) return catalog.products;
    return catalog.products.filter((product) =>
      [product.name, product.code, product.id, product.tag, product.description].some((value) =>
        value.toLocaleLowerCase().includes(query),
      ),
    );
  }, [catalog, productSearch]);

  const productImageImportMatchedRows = productImageImportDraft?.plan.rows.filter(
    (row) => row.status === "matched" && typeof row.productId === "string",
  ) ?? [];
  const productImageImportUploadedFileNames = new Set(
    productImageImportDraft?.uploadedEntries.map((entry) => entry.fileName) ?? [],
  );
  const productImageImportFailureByFileName = new Map(
    productImageImportDraft?.uploadFailures.map((failure) => [failure.fileName, failure] as const) ?? [],
  );
  const productImageImportMatchedUploadedCount = productImageImportMatchedRows.filter((row) =>
    productImageImportUploadedFileNames.has(row.fileName)
  ).length;
  const productImageImportUnreferencedUploadCount = Math.max(
    0,
    (productImageImportDraft?.uploadedEntries.length ?? 0) - productImageImportMatchedUploadedCount,
  );
  const productImageImportIsStale = Boolean(
    productImageImportDraft &&
    (
      productImageImportDraft.siteId !== siteId.trim() ||
      productImageImportDraft.siteVersion !== activeSiteVersionRef.current ||
      !catalog ||
      productImageImportDraft.baseRevision !== catalog.revision
    ),
  );
  const matchingTargetBrowsingRules =
    collectionDraft &&
    collectionDraft.viewport !== "shared" &&
    normalizedCatalogTarget?.blockId === collectionDraft.blockId &&
    normalizedCatalogTarget.viewport === collectionDraft.viewport
      ? normalizedCatalogTarget.browsingRules
      : undefined;
  const collectionDraftBrowsingRulesMigrationSeed =
    copyMerchantCatalogBrowsingRules(matchingTargetBrowsingRules) ?? {
      ...DEFAULT_MERCHANT_CATALOG_BROWSING_RULES,
    };
  const bootstrapProductResolutionGroups = useMemo(() => {
    const groups = new Map<string, MerchantCatalogBootstrapResolutionTarget[]>();
    bootstrapResolutionTargets.forEach((target) => {
      if (target.scope !== "product" || !target.productId) return;
      const current = groups.get(target.productId) ?? [];
      current.push(target);
      groups.set(target.productId, current);
    });
    return [...groups.entries()].map(([productId, targets]) => ({ productId, targets }));
  }, [bootstrapResolutionTargets]);
  const bootstrapCollectionRelatedProducts = useMemo(
    () => getMerchantCatalogBootstrapRelatedProductsWithoutProductTargets(bootstrapResolutionTargets),
    [bootstrapResolutionTargets],
  );
  const bootstrapCatalogResolutionTargets = useMemo(
    () => bootstrapResolutionTargets.filter((target) => target.scope === "catalog"),
    [bootstrapResolutionTargets],
  );
  const bootstrapCollectionResolutionTargets = useMemo(
    () => bootstrapResolutionTargets.filter((target) => target.scope === "collection"),
    [bootstrapResolutionTargets],
  );
  const bootstrapCollectionResolutionGroups = useMemo(() => {
    const groups = new Map<string, MerchantCatalogBootstrapResolutionTarget[]>();
    bootstrapCollectionResolutionTargets.forEach((target) => {
      const collectionId = target.collectionId ?? target.targetKey;
      const current = groups.get(collectionId) ?? [];
      current.push(target);
      groups.set(collectionId, current);
    });
    return [...groups.entries()].map(([collectionId, targets]) => ({ collectionId, targets }));
  }, [bootstrapCollectionResolutionTargets]);
  const bootstrapResolutionProgress = getMerchantCatalogBootstrapResolutionProgress(
    bootstrapResolutionTargets,
    bootstrapResolutionDraft,
    bootstrapExcludedProductIds,
  );
  const bootstrapUnresolvable = getUnresolvableBootstrapConflicts(
    bootstrap?.conflicts ?? [],
    bootstrapResolutionTargets,
  );
  const bootstrapHasUnresolvableConflict =
    bootstrapUnresolvable.uncovered.length > 0 || bootstrapUnresolvable.blockedTargets.length > 0;
  const currentBootstrapResolutionPlan = buildMerchantCatalogBootstrapResolutionPlan(
    bootstrapResolutionTargets,
    bootstrapResolutionDraft,
    bootstrapExcludedProductIds,
  );
  const currentBootstrapResolutionPlanSignature = JSON.stringify(currentBootstrapResolutionPlan);
  const bootstrapPreviewIsCurrent = isMerchantCatalogBootstrapPreviewCurrent(
    bootstrapPreview,
    bootstrapResolutionFingerprint,
    bootstrapPreviewPlanSignature,
    currentBootstrapResolutionPlanSignature,
  );
  const hasBootstrapResolutionWork = hasMerchantCatalogBootstrapResolutionWork(
    bootstrapResolutionDraft,
    bootstrapExcludedProductIds,
    bootstrapPreview,
  );

  const requestCatalogRefresh = () => {
    if (bootstrapPreviewingRef.current || actingKeyRef.current) return;
    if (
      hasBootstrapResolutionWork &&
      !window.confirm("刷新目录会重新读取已发布商品，并清空当前冲突选择、排除项和安全预览。确定刷新吗？")
    ) {
      return;
    }
    void loadCatalog();
  };

  const confirmDiscardSingleProductImageUpload = () => {
    if (!productImageUploadRef.current) return true;
    return window.confirm(
      "当前商品图片已经上传但尚未保存到目录。继续会放弃这次引用，已上传文件可能成为未引用资源。仍要继续吗？",
    );
  };

  const discardProductDraft = () => {
    if (productImageUploadingRef.current || actingKeyRef.current) return;
    if (!confirmDiscardSingleProductImageUpload()) return;
    productDraftGenerationRef.current += 1;
    clearSingleProductImageUpload();
    setProductDraft(null);
    setProductDraftRevision(null);
    setProductDraftCollectionIds([]);
  };

  const beginNewProduct = () => {
    if (productImageUploadingRef.current || actingKeyRef.current) return;
    if (!confirmDiscardSingleProductImageUpload()) return;
    productDraftGenerationRef.current += 1;
    clearSingleProductImageUpload();
    setProductDraft(createProductDraft());
    setProductDraftIsNew(true);
    setProductDraftRevision(catalog?.revision ?? null);
    setProductDraftCollectionIds(resolvedTargetCollection ? [resolvedTargetCollection.id] : []);
  };

  const beginTargetSharedCollection = () => {
    if (!catalog || !normalizedCatalogTarget) return;
    const knownProductIds = new Set(catalog.products.map((product) => product.id));
    const productIds = normalizedCatalogTarget.productIds
      ? normalizedCatalogTarget.productIds.filter((productId) => knownProductIds.has(productId))
      : catalog.products.map((product) => product.id);
    initializedTargetDraftKeyRef.current = `${siteId.trim()}\u0001${normalizedCatalogTarget.blockId}\u0001${normalizedCatalogTarget.viewport}`;
    setCollectionDraft({
      id: createMerchantCatalogCollectionId(normalizedCatalogTarget.blockId, "shared"),
      blockId: normalizedCatalogTarget.blockId,
      viewport: "shared",
      productIds,
    });
    setCollectionDraftIsNew(true);
    setCollectionDraftRevision(catalog.revision);
  };

  const beginTargetSpecificCollection = () => {
    if (!catalog || !normalizedCatalogTarget) return;
    const knownProductIds = new Set(catalog.products.map((product) => product.id));
    const productIds = resolvedTargetCollection
      ? [...resolvedTargetCollection.productIds]
      : normalizedCatalogTarget.productIds
        ? normalizedCatalogTarget.productIds.filter((productId) => knownProductIds.has(productId))
        : [];
    setCollectionDraft({
      id: createMerchantCatalogCollectionId(
        normalizedCatalogTarget.blockId,
        normalizedCatalogTarget.viewport,
      ),
      blockId: normalizedCatalogTarget.blockId,
      viewport: normalizedCatalogTarget.viewport,
      productIds,
      browsingRules: copyMerchantCatalogBrowsingRules(normalizedCatalogTarget.browsingRules),
    });
    setCollectionDraftIsNew(true);
    setCollectionDraftRevision(catalog.revision);
  };

  const beginEditProduct = (product: MerchantCatalogProduct) => {
    if (productImageUploadingRef.current || actingKeyRef.current) return;
    if (!confirmDiscardSingleProductImageUpload()) return;
    productDraftGenerationRef.current += 1;
    clearSingleProductImageUpload();
    setProductDraft({ ...product });
    setProductDraftIsNew(false);
    setProductDraftRevision(catalog?.revision ?? null);
    setProductDraftCollectionIds(
      catalog?.collections
        .filter((collection) => collection.productIds.includes(product.id))
        .map((collection) => collection.id) ?? [],
    );
  };

  const openSingleProductImagePicker = () => {
    if (!productDraftRef.current || productImageUploadingRef.current || actingKeyRef.current) return;
    if (!confirmDiscardSingleProductImageUpload()) return;
    if (productImageUploadRef.current) clearSingleProductImageUpload();
    productImageInputRef.current?.click();
  };

  const uploadSingleProductImage = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;

    const selectionError = getProductImageFileSelectionError([file]);
    if (selectionError) {
      setProductImageUploadError(selectionError);
      return;
    }

    const draft = productDraftRef.current;
    const currentCatalog = catalogRef.current;
    const baseRevision = productDraftRevisionRef.current;
    const uploadSiteId = activeSiteIdRef.current;
    if (
      !draft ||
      !currentCatalog ||
      baseRevision === null ||
      currentCatalog.revision !== baseRevision ||
      catalogSiteIdRef.current !== uploadSiteId
    ) {
      setProductImageUploadError("商品草稿已不是当前目录修订版，请加载最新版并重新打开商品后再上传。");
      return;
    }

    const uploadSiteVersion = activeSiteVersionRef.current;
    const catalogRequestSequence = requestSequenceRef.current;
    const draftGeneration = productDraftGenerationRef.current;
    const productId = draft.id;
    const uploadSequence = productImageUploadSequenceRef.current + 1;
    productImageUploadSequenceRef.current = uploadSequence;
    const uploadIdentityIsActive = () =>
      mountedRef.current &&
      productImageUploadSequenceRef.current === uploadSequence &&
      activeSiteIdRef.current === uploadSiteId &&
      activeSiteVersionRef.current === uploadSiteVersion &&
      productDraftGenerationRef.current === draftGeneration &&
      productDraftRef.current?.id === productId;
    const uploadContextIsActive = () =>
      uploadIdentityIsActive() &&
      requestSequenceRef.current === catalogRequestSequence &&
      catalogSiteIdRef.current === uploadSiteId &&
      catalogRef.current?.revision === baseRevision &&
      productDraftRevisionRef.current === baseRevision;

    productImageUploadingRef.current = true;
    setProductImageUploading(true);
    setProductImageUploadError("");
    setActionError("");
    setRevisionConflict("");
    setNotice("");

    try {
      const {
        fileToOptimizedImageDataUrl,
        uploadImageDataUrlToSupabaseWithMetadata,
      } = await import("@/lib/editorAssetProcessing");
      if (!uploadContextIsActive()) return;
      const dataUrl = await fileToOptimizedImageDataUrl(file, { maxSide: 1600, quality: 0.82 });
      if (!uploadContextIsActive()) return;
      const uploaded = await uploadImageDataUrlToSupabaseWithMetadata(
        dataUrl,
        uploadSiteId,
        "product-image",
        {
          operationModule: "订单工作台 > 商品目录",
          operationAction: "上传单商品图片",
          operationSummary: `在订单工作台上传商品图片 ${file.name}`,
        },
      );
      if (!uploaded?.url) throw new Error("图片上传失败，请稍后重试。");
      if (!uploadIdentityIsActive()) return;

      const uploadRecord: MerchantCatalogSingleProductImageUpload = {
        siteId: uploadSiteId,
        siteVersion: uploadSiteVersion,
        baseRevision,
        productId,
        draftGeneration,
        imageUrl: uploaded.url,
        thumbnailUrl: uploaded.thumbnailUrl ?? "",
      };
      productImageUploadRef.current = uploadRecord;
      setProductImageUpload(uploadRecord);

      if (!uploadContextIsActive()) {
        setProductImageUploadError(
          "图片已上传，但目录或请求上下文已变化，因此没有写入当前草稿。该文件尚未被目录引用；请取消草稿并确认风险后，基于最新版重试。",
        );
        return;
      }

      const nextDraft = {
        ...productDraftRef.current!,
        imageUrl: uploadRecord.imageUrl,
        thumbnailUrl: uploadRecord.thumbnailUrl,
      };
      productDraftRef.current = nextDraft;
      setProductDraft(nextDraft);
      setNotice("商品图片已上传并写入草稿；请保存商品后才会应用到目录和网站预览。");
    } catch (uploadError) {
      if (uploadIdentityIsActive()) {
        setProductImageUploadError(getProductImageUploadFailureMessage(uploadError));
      }
    } finally {
      if (uploadIdentityIsActive()) {
        productImageUploadingRef.current = false;
        setProductImageUploading(false);
      }
    }
  };

  const submitProduct = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!productDraft) return;
    const pendingImageUpload = productImageUploadRef.current;
    if (
      pendingImageUpload &&
      (
        pendingImageUpload.siteId !== activeSiteIdRef.current ||
        pendingImageUpload.siteVersion !== activeSiteVersionRef.current ||
        pendingImageUpload.baseRevision !== productDraftRevisionRef.current ||
        pendingImageUpload.baseRevision !== catalogRef.current?.revision ||
        pendingImageUpload.productId !== productDraft.id ||
        pendingImageUpload.draftGeneration !== productDraftGenerationRef.current ||
        pendingImageUpload.imageUrl !== productDraft.imageUrl.trim() ||
        pendingImageUpload.thumbnailUrl !== productDraft.thumbnailUrl.trim()
      )
    ) {
      setProductImageUploadError(
        "已上传图片不再属于当前商品草稿或目录修订版，系统不会写入。请取消草稿并确认未引用资源风险后，基于最新版重试。",
      );
      return;
    }
    const normalizedProduct: MerchantCatalogProduct = {
      ...productDraft,
      id: productDraft.id.trim(),
      code: productDraft.code.trim(),
      name: productDraft.name.trim(),
      description: productDraft.description.trim(),
      price: productDraft.price.trim(),
      imageUrl: productDraft.imageUrl.trim(),
      thumbnailUrl: productDraft.thumbnailUrl.trim(),
      tag: productDraft.tag.trim(),
    };
    if (!normalizedProduct.id || !normalizedProduct.name) {
      setActionError("商品名称不能为空。");
      return;
    }
    if (parseMerchantCatalogUnitPrice(normalizedProduct.price) === null) {
      setActionError("商品价格必须是非负数字，最多保留两位小数；免费商品请明确填写 0。");
      return;
    }
    if (
      normalizedProduct.availability !== "hidden" &&
      (catalog?.collections.length ?? 0) > 0 &&
      productDraftCollectionIds.length === 0
    ) {
      setActionError("可售或售罄商品至少要投放到一个已绑定商品区块；如需暂存，请先设为隐藏。");
      return;
    }
    const saved = await runMutation(
      `product:${normalizedProduct.id}`,
      {
        action: "upsert_product",
        product: normalizedProduct,
        productId: productDraftIsNew ? undefined : normalizedProduct.id,
        collectionIds: productDraftCollectionIds,
      },
      productDraftIsNew ? "商品已添加到经营目录。" : "商品信息已更新。",
      productDraftRevision ?? undefined,
    );
    if (saved) {
      productDraftGenerationRef.current += 1;
      clearSingleProductImageUpload();
      setProductDraft(null);
      setProductDraftRevision(null);
      setProductDraftCollectionIds([]);
    }
  };

  const submitCategory = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!categoryDraft) return;
    const normalizedCategory: MerchantCatalogCategory = {
      ...categoryDraft,
      id: categoryDraft.id.trim(),
      name: categoryDraft.name.trim(),
      productIds: [...new Set(categoryDraft.productIds.map((productId) => productId.trim()).filter(Boolean))],
    };
    if (!normalizedCategory.id || !normalizedCategory.name) {
      setActionError("分类名称不能为空。");
      return;
    }
    const saved = await runMutation(
      `category:${normalizedCategory.id}`,
      { action: "upsert_category", category: normalizedCategory },
      categoryDraftIsNew ? "分类已创建。" : "分类已更新。",
      categoryDraftRevision ?? undefined,
    );
    if (saved) {
      setCategoryDraft(null);
      setCategoryDraftRevision(null);
    }
  };

  const submitCollection = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!collectionDraft) return;
    const normalizedCollection: MerchantCatalogCollection = {
      ...collectionDraft,
      id: collectionDraft.id.trim(),
      blockId: collectionDraft.blockId.trim(),
      productIds: [...new Set(collectionDraft.productIds.map((productId) => productId.trim()).filter(Boolean))],
      browsingRules: collectionDraft.browsingRules
        ? {
            ...collectionDraft.browsingRules,
            searchPlaceholder: collectionDraft.browsingRules.searchPlaceholder.trim(),
          }
        : undefined,
    };
    if (!normalizedCollection.id || !normalizedCollection.blockId) {
      setActionError("网站区块信息不完整，请返回网站编辑器重新打开商品目录。");
      return;
    }
    const isCurrentTarget =
      normalizedCatalogTarget?.blockId === normalizedCollection.blockId &&
      (normalizedCatalogTarget.viewport === normalizedCollection.viewport || normalizedCollection.viewport === "shared");
    if (collectionDraftIsNew && isCurrentTarget && missingTargetProductIds.length > 0) {
      const confirmed = window.confirm(
        `当前网站区块还有 ${missingTargetProductIds.length} 个商品尚未进入工作台目录。继续绑定后，这些商品不会在线上显示；可先取消并在工作台补齐商品。仍要继续吗？`,
      );
      if (!confirmed) return;
    }
    const saved = await runMutation(
      `collection:${normalizedCollection.id}`,
      { action: "upsert_collection", collection: normalizedCollection },
      collectionDraftIsNew
        ? "网站商品区块已绑定到工作台目录。"
        : "网站商品区块的投放商品已更新。",
      collectionDraftRevision ?? undefined,
    );
    if (saved) {
      setCollectionDraft(null);
      setCollectionDraftRevision(null);
    }
  };

  const generateBootstrapResolutionPreview = async () => {
    if (
      actingKeyRef.current ||
      bootstrapPreviewingRef.current ||
      !bootstrap ||
      bootstrap.resolutionTargets.length === 0 ||
      bootstrapResolutionProgress.processed !== bootstrapResolutionProgress.total ||
      bootstrapHasUnresolvableConflict
    ) return;
    const previewSiteId = siteId.trim();
    const previewSiteVersion = activeSiteVersionRef.current;
    const sourceFingerprint = bootstrapFingerprintRef.current;
    if (!previewSiteId || !sourceFingerprint || activeSiteIdRef.current !== previewSiteId) return;
    const resolutionPlan = buildMerchantCatalogBootstrapResolutionPlan(
      bootstrap.resolutionTargets,
      bootstrapResolutionDraft,
      bootstrapExcludedProductIds,
    );
    const planSignature = JSON.stringify(resolutionPlan);
    const sequence = bootstrapResolutionRequestSequenceRef.current + 1;
    bootstrapResolutionRequestSequenceRef.current = sequence;
    bootstrapPreviewingRef.current = true;
    setBootstrapPreviewing(true);
    setActionError("");
    setRevisionConflict("");
    setNotice("");
    setBootstrapPreview(null);
    setBootstrapResolutionFingerprint("");
    setBootstrapPreviewPlanSignature("");
    const previewContextIsActive = () =>
      mountedRef.current &&
      bootstrapResolutionRequestSequenceRef.current === sequence &&
      activeSiteIdRef.current === previewSiteId &&
      activeSiteVersionRef.current === previewSiteVersion &&
      bootstrapFingerprintRef.current === sourceFingerprint;
    try {
      const response = await fetch("/api/orders/catalog", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          siteId: previewSiteId,
          action: "preview_bootstrap",
          expectedRevision: 0,
          sourceFingerprint,
          resolutionPlan,
        }),
      });
      const payload = (await response.json().catch(() => null)) as CatalogApiPayload | null;
      if (!previewContextIsActive()) return;
      if (payload?.error === "merchant_catalog_bootstrap_source_changed") {
        clearBootstrapResolutionState();
        setRevisionConflict("已发布网站商品在解决冲突期间发生变化。旧选择和预览已清空，请重新核对最新来源。");
        await loadCatalog();
        return;
      }
      if (
        !response.ok ||
        !payload?.ok ||
        !payload.preview?.ok ||
        !payload.preview.catalog ||
        !payload.resolutionFingerprint
      ) {
        throw new Error(getCatalogError(payload, "无法生成安全初始化预览，请检查冲突处理后重试。"));
      }
      setBootstrapPreview(payload.preview);
      setBootstrapResolutionFingerprint(payload.resolutionFingerprint);
      setBootstrapPreviewPlanSignature(planSignature);
      setNotice("安全初始化预览已生成。请核对最终商品、分类、集合和价格前缀，再确认建立目录。");
    } catch (requestError) {
      if (!previewContextIsActive()) return;
      setActionError(requestError instanceof Error ? requestError.message : "无法生成安全初始化预览，请稍后重试。");
    } finally {
      if (previewContextIsActive()) {
        bootstrapPreviewingRef.current = false;
        setBootstrapPreviewing(false);
      }
    }
  };

  const confirmResolvedBootstrap = async () => {
    if (
      !bootstrapPreviewIsCurrent ||
      !bootstrapPreview?.catalog ||
      !bootstrapResolutionFingerprint ||
      actingKeyRef.current ||
      bootstrapPreviewingRef.current
    ) return;
    const resolutionPlan = buildMerchantCatalogBootstrapResolutionPlan(
      bootstrapResolutionTargets,
      bootstrapResolutionDraft,
      bootstrapExcludedProductIds,
    );
    const excludedWarning = bootstrapExcludedProductIds.length > 0
      ? `\n\n你已明确排除 ${bootstrapExcludedProductIds.length} 个冲突商品；它们会从所有初始化集合中移除，不会进入工作台目录。`
      : "";
    const confirmed = window.confirm(
      `将按当前安全预览建立经营目录：${bootstrapPreview.catalog.products.length} 个商品、${bootstrapPreview.catalog.categories.length} 个分类、${bootstrapPreview.catalog.collections.length} 个页面集合。建立后，相关商品区块会立即使用工作台目录公开展示并由服务端报价。${excludedWarning}\n\n确定继续吗？`,
    );
    if (!confirmed) return;
    await runMutation(
      "bootstrap",
      {
        action: "bootstrap",
        sourceFingerprint: bootstrapFingerprint,
        resolutionPlan,
        resolutionFingerprint: bootstrapResolutionFingerprint,
      },
      "商品目录已建立。已绑定商品区块已切换到工作台目录，请核验商品、价格和可售状态。",
      0,
    );
  };

  const confirmBootstrap = async () => {
    if (!bootstrap?.ok || !bootstrap.catalog) return;
    const confirmed = window.confirm(
      `将把当前已发布网站中的 ${bootstrap.catalog.products.length} 个商品复制到独立经营目录。建立后，已绑定的商品区块会立即使用工作台目录进行公开展示和服务端报价；请先核验商品、价格和可售状态。确定继续吗？`,
    );
    if (!confirmed) return;
    await runMutation(
      "bootstrap",
      { action: "bootstrap", sourceFingerprint: bootstrapFingerprint },
      "商品目录已建立。已绑定商品区块已切换到工作台目录，请核验商品、价格和可售状态。",
    );
  };

  const confirmDeleteProduct = async (product: MerchantCatalogProduct) => {
    const confirmed = window.confirm(
      `确定从经营目录删除“${product.name || product.id}”吗？目录分类和集合中的关联将一并清理，已绑定商品区块的公开展示和服务端报价会立即受到影响。`,
    );
    if (!confirmed) return;
    await runMutation(`delete-product:${product.id}`, { action: "delete_product", productId: product.id }, "商品已从经营目录删除。");
  };

  const confirmDeleteCategory = async (category: MerchantCatalogCategory) => {
    const confirmed = window.confirm(`确定删除分类“${category.name}”吗？分类内的商品不会被删除。`);
    if (!confirmed) return;
    await runMutation(
      `delete-category:${category.id}`,
      { action: "delete_category", categoryId: category.id },
      "分类已删除，商品本身未删除；相关商品已变为未分类。",
    );
  };

  const confirmDeleteCollection = async (collection: MerchantCatalogCollection) => {
    if (!catalog) return;
    const remainingCatalog = {
      ...catalog,
      collections: catalog.collections.filter((candidate) => candidate.id !== collection.id),
    };
    const remainingForBlock = remainingCatalog.collections.filter(
      (candidate) => candidate.blockId === collection.blockId,
    );
    const affectedViewports: Array<"desktop" | "mobile"> =
      collection.viewport === "shared" || remainingForBlock.length === 0
        ? ["desktop", "mobile"]
        : [collection.viewport];
    const impact = affectedViewports.map((viewport) => {
      const fallback = resolveMerchantCatalogCollection(remainingCatalog, collection.blockId, viewport);
      if (fallback) return `${getViewportLabel(viewport)}将改用${getViewportLabel(fallback.viewport)}投放配置`;
      if (remainingForBlock.length > 0) return `${getViewportLabel(viewport)}将停止展示和接单，直到重新绑定`;
      return `${getViewportLabel(viewport)}刷新后将退出工作台目录并使用已发布网站旧数据`;
    });
    const confirmed = window.confirm(
      `确定删除“${collection.blockId} · ${getViewportLabel(collection.viewport)}”的投放配置吗？\n\n${impact.join("；")}。已打开页面中的旧目录报价会被拒绝，客户需刷新页面。若删除会让可售商品失去全部投放，系统将阻止本次操作。`,
    );
    if (!confirmed) return;
    const saved = await runMutation(
      `delete-collection:${collection.id}`,
      { action: "delete_collection", collectionId: collection.id },
      `投放配置已删除。${impact.join("；")}。`,
    );
    if (saved && collectionDraft?.id === collection.id) setCollectionDraft(null);
  };

  const shellClassName = darkMode ? "text-slate-100" : "text-slate-900";
  const surfaceClassName = darkMode
    ? "border-slate-700/80 bg-slate-900/80"
    : "border-slate-200 bg-white";
  const mutedTextClassName = darkMode ? "text-slate-400" : "text-slate-500";
  const secondaryButtonClassName = darkMode
    ? "border-slate-600 bg-slate-900 text-slate-100 hover:border-slate-500 hover:bg-slate-800"
    : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50";
  const inputClassName = darkMode
    ? "border-slate-600 bg-slate-950 text-slate-100 placeholder:text-slate-600 focus:border-sky-400 focus:ring-sky-400/20"
    : "border-slate-300 bg-white text-slate-900 placeholder:text-slate-400 focus:border-sky-500 focus:ring-sky-500/15";

  return (
    <div className={`space-y-5 ${shellClassName}`} aria-busy={loading || refreshing}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-bold sm:text-lg">商品目录</h3>
          <p className={`mt-1 text-xs leading-5 sm:text-sm ${mutedTextClassName}`}>
            在订单工作台维护商品经营数据；网站编辑继续负责布局、颜色和页面展示。
          </p>
        </div>
        <button
          type="button"
          onClick={requestCatalogRefresh}
          disabled={loading || refreshing || bootstrapPreviewing || Boolean(actingKey)}
          className={`inline-flex h-10 items-center gap-2 rounded-xl border px-3 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${secondaryButtonClassName}`}
        >
          <RefreshIcon spinning={refreshing} />
          {refreshing ? "同步中" : "刷新目录"}
        </button>
      </div>

      <div
        className={`rounded-2xl border px-4 py-3 text-sm leading-6 ${
          darkMode
            ? "border-amber-400/25 bg-amber-400/10 text-amber-100"
            : "border-amber-200 bg-amber-50 text-amber-800"
        }`}
      >
        <div className="flex items-start gap-3">
          <span className="mt-0.5 shrink-0"><WarningIcon /></span>
          <div>
            <p className="font-bold">商品目录已接入安全双读</p>
            <p className="mt-1 text-xs leading-5 opacity-85">
              建立目录后，已绑定商品区块的公开展示和服务端报价会立即使用工作台目录；尚未迁移的区块继续沿用已发布网站数据。网站编辑器只保留布局草稿，请在保存前核验商品、价格和可售状态。
            </p>
          </div>
        </div>
      </div>

      {loading && !catalog && !bootstrap ? <LoadingSkeleton darkMode={darkMode} /> : null}

      {error ? (
        <div
          role="alert"
          className={`flex flex-col gap-3 rounded-2xl border px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between ${
            darkMode ? "border-rose-400/30 bg-rose-400/10 text-rose-100" : "border-rose-200 bg-rose-50 text-rose-700"
          }`}
        >
          <span>{error}</span>
          <button type="button" onClick={() => void loadCatalog()} className="shrink-0 rounded-xl border border-current/30 px-3 py-2 font-semibold hover:bg-current/10">
            重试
          </button>
        </div>
      ) : null}

      {revisionConflict ? (
        <div role="alert" className={`rounded-2xl border px-4 py-3 text-sm ${darkMode ? "border-violet-400/30 bg-violet-400/10 text-violet-100" : "border-violet-200 bg-violet-50 text-violet-800"}`}>
          <strong>检测到并发修改：</strong>{revisionConflict}
        </div>
      ) : null}

      {actionError ? (
        <div role="alert" className={`rounded-2xl border px-4 py-3 text-sm ${darkMode ? "border-rose-400/30 bg-rose-400/10 text-rose-100" : "border-rose-200 bg-rose-50 text-rose-700"}`}>
          {actionError}
        </div>
      ) : null}

      <div aria-live="polite">
        {notice ? (
          <div className={`flex items-center gap-2 rounded-2xl border px-4 py-3 text-sm ${darkMode ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-100" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}>
            <CheckIcon /> {notice}
          </div>
        ) : null}
      </div>

      {!loading && !catalog ? (
        <section className={`rounded-2xl border p-4 sm:p-6 ${surfaceClassName}`} aria-labelledby="catalog-bootstrap-title">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h4 id="catalog-bootstrap-title" className="text-base font-bold">从已发布商品建立经营目录</h4>
              <p className={`mt-1 max-w-3xl text-sm leading-6 ${mutedTextClassName}`}>
                初始化会复制已发布商品、价格前缀、分类和商品块集合。建立后，已绑定商品区块会立即改用工作台目录；网站编辑器继续负责布局草稿。
              </p>
            </div>
            <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${darkMode ? "bg-slate-800 text-slate-300" : "bg-slate-100 text-slate-600"}`}>
              {bootstrap?.sourceBlockCount ?? 0} 个已发布商品块
            </span>
          </div>

          {bootstrap?.conflicts && bootstrap.conflicts.length > 0 ? (
            <div className="mt-5 space-y-5">
              <div className={`rounded-xl border px-3 py-3 text-sm ${darkMode ? "border-amber-400/25 bg-amber-400/10 text-amber-100" : "border-amber-200 bg-amber-50 text-amber-900"}`}>
                <p className="font-bold">已发布商品存在冲突，需要在工作台明确处理</p>
                <p className="mt-1 text-xs leading-5 opacity-90">
                  相同商品在电脑端、手机端或多个区块中的经营字段不一致。请选择每个字段的最终值，或明确排除不再导入的商品；系统不会默认采用任意终端。
                </p>
              </div>

              <div className={`sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 shadow-sm ${darkMode ? "border-slate-700 bg-slate-900/95" : "border-slate-200 bg-white/95"}`}>
                <div>
                  <p className="text-sm font-bold">冲突处理进度</p>
                  <p className={`mt-0.5 text-xs ${mutedTextClassName}`}>
                    已处理 {bootstrapResolutionProgress.processed} / {bootstrapResolutionProgress.total}
                    {bootstrapExcludedProductIds.length > 0 ? ` · 已排除 ${bootstrapExcludedProductIds.length} 个商品` : ""}
                  </p>
                </div>
                <div className={`h-2 w-40 max-w-full overflow-hidden rounded-full ${darkMode ? "bg-slate-700" : "bg-slate-200"}`} aria-hidden="true">
                  <div
                    className="h-full rounded-full bg-sky-500 transition-[width]"
                    style={{
                      width: `${bootstrapResolutionProgress.total > 0
                        ? Math.round((bootstrapResolutionProgress.processed / bootstrapResolutionProgress.total) * 100)
                        : 0}%`,
                    }}
                  />
                </div>
              </div>

              {bootstrapHasUnresolvableConflict ? (
                <div className={`rounded-xl border p-3 ${darkMode ? "border-rose-400/30 bg-rose-400/10 text-rose-100" : "border-rose-200 bg-rose-50 text-rose-800"}`} role="alert">
                  <p className="text-sm font-bold">存在无法在工作台安全解决的数据</p>
                  <p className="mt-1 text-xs leading-5">
                    初始化已暂停，不能生成预览。请刷新确认；如果仍然出现，请联系支持核查已发布数据结构。
                  </p>
                  {bootstrapUnresolvable.uncovered.length > 0 ? (
                    <div className="mt-3">
                      <BootstrapConflicts conflicts={bootstrapUnresolvable.uncovered} darkMode={darkMode} />
                    </div>
                  ) : null}
                  {bootstrapUnresolvable.blockedTargets.length > 0 ? (
                    <ul className="mt-3 list-disc space-y-1 pl-5 text-xs">
                      {bootstrapUnresolvable.blockedTargets.map((target) => (
                        <li key={target.targetKey}>{getBootstrapTargetSummary(target)}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}

              {bootstrapCatalogResolutionTargets.length > 0 ? (
                <section aria-labelledby="bootstrap-catalog-conflicts-title">
                  <div className="mb-3">
                    <h5 id="bootstrap-catalog-conflicts-title" className="text-sm font-bold">目录统一设置</h5>
                    <p className={`mt-1 text-xs ${mutedTextClassName}`}>价格前缀和分类等目录级数据会应用到全部工作台商品。</p>
                  </div>
                  <div className="space-y-3">
                    {bootstrapCatalogResolutionTargets.map((target) => (
                      <BootstrapResolutionTargetEditor
                        key={target.targetKey}
                        target={target}
                        resolutionTargets={bootstrapResolutionTargets}
                        selection={bootstrapResolutionDraft[target.targetKey]}
                        darkMode={darkMode}
                        disabled={Boolean(actingKey) || bootstrapPreviewing}
                        onChange={setBootstrapResolutionSelection}
                      />
                    ))}
                  </div>
                </section>
              ) : null}

              {bootstrapProductResolutionGroups.length > 0 ? (
                <section aria-labelledby="bootstrap-product-conflicts-title">
                  <div className="mb-3">
                    <h5 id="bootstrap-product-conflicts-title" className="text-sm font-bold">冲突商品</h5>
                    <p className={`mt-1 text-xs leading-5 ${mutedTextClassName}`}>
                      商品字段是全目录统一经营数据。排除商品会把它从本次目录及所有初始化集合中移除，但不会修改网站中的旧草稿。
                    </p>
                  </div>
                  <div className="space-y-4">
                    {bootstrapProductResolutionGroups.map(({ productId, targets }) => {
                      const excluded = bootstrapExcludedProductIds.includes(productId);
                      const entityLabel = targets.find((target) => target.entityLabel?.trim())?.entityLabel?.trim() || productId;
                      return (
                        <article key={productId} className={`rounded-2xl border p-4 ${excluded ? darkMode ? "border-rose-400/30 bg-rose-400/5" : "border-rose-200 bg-rose-50/50" : darkMode ? "border-slate-700 bg-slate-900/40" : "border-slate-200 bg-white"}`}>
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-bold" title={entityLabel}>{entityLabel}</p>
                              <code className={`mt-1 block break-all text-[11px] ${mutedTextClassName}`}>{productId}</code>
                            </div>
                            <label className={`flex shrink-0 items-start gap-2 rounded-xl border px-3 py-2 text-xs font-semibold ${excluded ? darkMode ? "border-rose-400/40 bg-rose-400/10 text-rose-100" : "border-rose-300 bg-rose-100 text-rose-800" : darkMode ? "border-slate-700 text-slate-300" : "border-slate-200 text-slate-700"} ${Boolean(actingKey) || bootstrapPreviewing ? "cursor-not-allowed opacity-65" : "cursor-pointer"}`}>
                              <input
                                type="checkbox"
                                checked={excluded}
                                disabled={Boolean(actingKey) || bootstrapPreviewing}
                                onChange={() => toggleBootstrapProductExclusion(productId)}
                                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-rose-600 focus:ring-rose-500"
                              />
                              本次不导入
                            </label>
                          </div>
                          {excluded ? (
                            <div className={`mt-3 rounded-xl border px-3 py-2 text-xs font-semibold leading-5 ${darkMode ? "border-rose-400/25 bg-rose-400/10 text-rose-100" : "border-rose-200 bg-rose-50 text-rose-700"}`}>
                              已明确排除：该商品不会进入经营目录，并会从所有初始化页面集合中移除。
                            </div>
                          ) : (
                            <div className="mt-3 space-y-3">
                              {targets.map((target) => (
                                <BootstrapResolutionTargetEditor
                                  key={target.targetKey}
                                  target={target}
                                  resolutionTargets={bootstrapResolutionTargets}
                                  selection={bootstrapResolutionDraft[target.targetKey]}
                                  darkMode={darkMode}
                                  disabled={Boolean(actingKey) || bootstrapPreviewing}
                                  onChange={setBootstrapResolutionSelection}
                                />
                              ))}
                            </div>
                          )}
                        </article>
                      );
                    })}
                  </div>
                </section>
              ) : null}

              {bootstrapCollectionRelatedProducts.length > 0 ? (
                <section aria-labelledby="bootstrap-related-products-title">
                  <div className="mb-3">
                    <h5 id="bootstrap-related-products-title" className="text-sm font-bold">集合候选商品</h5>
                    <p className={`mt-1 text-xs leading-5 ${mutedTextClassName}`}>
                      这些商品自身没有字段冲突，但出现在不同的集合候选范围中。若不希望它们进入本次经营目录，可在这里明确排除。
                    </p>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {bootstrapCollectionRelatedProducts.map(({ productId, entityLabel }) => {
                      const excluded = bootstrapExcludedProductIds.includes(productId);
                      return (
                        <article
                          key={productId}
                          className={`rounded-xl border p-3 ${excluded
                            ? darkMode
                              ? "border-rose-400/30 bg-rose-400/5"
                              : "border-rose-200 bg-rose-50/50"
                            : darkMode
                              ? "border-slate-700 bg-slate-900/40"
                              : "border-slate-200 bg-white"}`}
                        >
                          <p className="truncate text-sm font-bold" title={entityLabel}>{entityLabel}</p>
                          <code className={`mt-1 block truncate text-[11px] ${mutedTextClassName}`} title={productId}>{productId}</code>
                          <label className={`mt-3 flex items-start gap-2 rounded-lg border px-3 py-2 text-xs font-semibold ${excluded
                            ? darkMode
                              ? "border-rose-400/40 bg-rose-400/10 text-rose-100"
                              : "border-rose-300 bg-rose-100 text-rose-800"
                            : darkMode
                              ? "border-slate-700 text-slate-300"
                              : "border-slate-200 text-slate-700"} ${Boolean(actingKey) || bootstrapPreviewing ? "cursor-not-allowed opacity-65" : "cursor-pointer"}`}>
                            <input
                              type="checkbox"
                              checked={excluded}
                              disabled={Boolean(actingKey) || bootstrapPreviewing}
                              onChange={() => toggleBootstrapProductExclusion(productId)}
                              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-rose-600 focus:ring-rose-500"
                            />
                            本次不导入
                          </label>
                          {excluded ? (
                            <p className="mt-2 text-[11px] font-semibold leading-5 text-rose-600">
                              将从所有初始化集合中移除。
                            </p>
                          ) : null}
                        </article>
                      );
                    })}
                  </div>
                </section>
              ) : null}

              {bootstrapCollectionResolutionGroups.length > 0 ? (
                <section aria-labelledby="bootstrap-collection-conflicts-title">
                  <div className="mb-3">
                    <h5 id="bootstrap-collection-conflicts-title" className="text-sm font-bold">页面集合与终端范围</h5>
                    <p className={`mt-1 text-xs leading-5 ${mutedTextClassName}`}>
                      每个集合继续保留发布来源确定的区块和电脑端/手机端范围；这里只选择商品顺序或浏览规则，不会静默合并终端。
                    </p>
                  </div>
                  <div className="space-y-4">
                    {bootstrapCollectionResolutionGroups.map(({ collectionId, targets }) => (
                      <article key={collectionId} className={`rounded-2xl border p-4 ${darkMode ? "border-slate-700 bg-slate-900/40" : "border-slate-200 bg-white"}`}>
                        <p className="text-sm font-bold">页面集合</p>
                        <code className={`mt-1 block break-all text-[11px] ${mutedTextClassName}`}>{collectionId}</code>
                        <div className="mt-3 space-y-3">
                          {targets.map((target) => (
                            <BootstrapResolutionTargetEditor
                              key={target.targetKey}
                              target={target}
                              resolutionTargets={bootstrapResolutionTargets}
                              selection={bootstrapResolutionDraft[target.targetKey]}
                              darkMode={darkMode}
                              disabled={Boolean(actingKey) || bootstrapPreviewing}
                              onChange={setBootstrapResolutionSelection}
                            />
                          ))}
                        </div>
                      </article>
                    ))}
                  </div>
                </section>
              ) : null}

              <div className={`flex flex-col gap-3 rounded-2xl border p-4 sm:flex-row sm:items-center sm:justify-between ${darkMode ? "border-sky-400/25 bg-sky-400/5" : "border-sky-200 bg-sky-50/50"}`}>
                <div>
                  <p className="text-sm font-bold">先生成安全预览，再确认建立</p>
                  <p className={`mt-1 text-xs leading-5 ${mutedTextClassName}`}>
                    预览不会写入目录；服务端会重新读取已发布商品并验证全部选择。
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void generateBootstrapResolutionPreview()}
                  disabled={
                    Boolean(actingKey) ||
                    bootstrapPreviewing ||
                    bootstrapHasUnresolvableConflict ||
                    bootstrapResolutionProgress.total === 0 ||
                    bootstrapResolutionProgress.processed !== bootstrapResolutionProgress.total
                  }
                  className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-sky-600 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {bootstrapPreviewing ? <RefreshIcon spinning /> : <CheckIcon />}
                  {bootstrapPreviewing
                    ? "正在生成安全预览"
                    : bootstrapResolutionProgress.processed !== bootstrapResolutionProgress.total
                      ? `还需处理 ${bootstrapResolutionProgress.total - bootstrapResolutionProgress.processed} 项`
                      : "生成安全预览"}
                </button>
              </div>

              {bootstrapPreviewIsCurrent && bootstrapPreview?.catalog ? (
                <section className={`rounded-2xl border p-4 sm:p-5 ${darkMode ? "border-emerald-400/30 bg-emerald-400/5" : "border-emerald-200 bg-emerald-50/50"}`} aria-labelledby="bootstrap-resolution-preview-title">
                  <div>
                    <h5 id="bootstrap-resolution-preview-title" className="text-sm font-bold">最终初始化预览</h5>
                    <p className={`mt-1 text-xs leading-5 ${mutedTextClassName}`}>以下结果已通过服务端解析，但尚未写入经营目录。</p>
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {[
                      ["商品", bootstrapPreview.catalog.products.length],
                      ["分类", bootstrapPreview.catalog.categories.length],
                      ["页面集合", bootstrapPreview.catalog.collections.length],
                      ["价格前缀", bootstrapPreview.catalog.pricePrefix || "未设置"],
                    ].map(([label, value]) => (
                      <div key={String(label)} className={`rounded-xl border px-3 py-3 ${darkMode ? "border-slate-700 bg-slate-950/60" : "border-emerald-100 bg-white"}`}>
                        <p className={`text-xs ${mutedTextClassName}`}>{label}</p>
                        <p className="mt-1 truncate text-lg font-black" title={String(value)}>{value}</p>
                      </div>
                    ))}
                  </div>
                  {bootstrapExcludedProductIds.length > 0 ? (
                    <p className={`mt-4 rounded-xl border px-3 py-2 text-xs font-semibold leading-5 ${darkMode ? "border-rose-400/25 bg-rose-400/10 text-rose-100" : "border-rose-200 bg-rose-50 text-rose-700"}`}>
                      本预览已排除 {bootstrapExcludedProductIds.length} 个冲突商品；它们已从所有集合中移除。
                    </p>
                  ) : null}
                  {bootstrapPreview.catalog.products.length > 0 ? (
                    <div className="mt-4">
                      <p className={`mb-2 text-xs font-semibold ${mutedTextClassName}`}>即将进入工作台的商品（最多显示 12 个）</p>
                      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                        {bootstrapPreview.catalog.products.slice(0, 12).map((product) => (
                          <div key={product.id} className={`rounded-xl border px-3 py-2 ${darkMode ? "border-slate-700 bg-slate-950/50" : "border-emerald-100 bg-white"}`}>
                            <p className="truncate text-sm font-semibold">{product.name}</p>
                            <p className={`mt-0.5 truncate text-xs ${mutedTextClassName}`}>{product.code || product.id} · {bootstrapPreview.catalog?.pricePrefix}{product.price}</p>
                          </div>
                        ))}
                      </div>
                      {bootstrapPreview.catalog.products.length > 12 ? (
                        <p className={`mt-2 text-xs ${mutedTextClassName}`}>另有 {bootstrapPreview.catalog.products.length - 12} 个商品会一并建立。</p>
                      ) : null}
                    </div>
                  ) : (
                    <p className={`mt-4 rounded-xl border border-dashed px-4 py-5 text-center text-sm ${darkMode ? "border-slate-700" : "border-emerald-200"} ${mutedTextClassName}`}>
                      最终预览不包含商品；建立后可直接在工作台新增商品并配置页面投放。
                    </p>
                  )}
                  <div className="mt-5 flex justify-end">
                    <button
                      type="button"
                      onClick={() => void confirmResolvedBootstrap()}
                      disabled={Boolean(actingKey) || bootstrapPreviewing || !bootstrapPreviewIsCurrent}
                      className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {actingKey === "bootstrap" ? <RefreshIcon spinning /> : <PlusIcon />}
                      {actingKey === "bootstrap" ? "正在建立目录" : "确认并建立商品目录"}
                    </button>
                  </div>
                </section>
              ) : null}
            </div>
          ) : null}

          {bootstrap?.ok && bootstrap.catalog ? (
            <div className="mt-5 space-y-4">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  ["商品", bootstrap.catalog.products.length],
                  ["分类", bootstrap.catalog.categories.length],
                  ["页面集合", bootstrap.catalog.collections.length],
                  ["价格前缀", bootstrap.catalog.pricePrefix || "未设置"],
                ].map(([label, value]) => (
                  <div key={String(label)} className={`rounded-xl border px-3 py-3 ${darkMode ? "border-slate-700 bg-slate-950/60" : "border-slate-100 bg-slate-50"}`}>
                    <p className={`text-xs ${mutedTextClassName}`}>{label}</p>
                    <p className="mt-1 truncate text-lg font-black" title={String(value)}>{value}</p>
                  </div>
                ))}
              </div>

              {bootstrap.catalog.products.length > 0 ? (
                <div>
                  <p className={`mb-2 text-xs font-semibold ${mutedTextClassName}`}>即将导入的已发布商品</p>
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {bootstrap.catalog.products.slice(0, 12).map((product) => (
                      <div key={product.id} className={`rounded-xl border px-3 py-2 ${darkMode ? "border-slate-700 bg-slate-950/50" : "border-slate-100 bg-white"}`}>
                        <p className="truncate text-sm font-semibold">{product.name || "未命名商品"}</p>
                        <p className={`mt-0.5 truncate text-xs ${mutedTextClassName}`}>{product.code || product.id} · {bootstrap.catalog?.pricePrefix}{product.price || "—"}</p>
                      </div>
                    ))}
                  </div>
                  {bootstrap.catalog.products.length > 12 ? <p className={`mt-2 text-xs ${mutedTextClassName}`}>另有 {bootstrap.catalog.products.length - 12} 个商品将在初始化时一并导入</p> : null}
                </div>
              ) : (
                <p className={`rounded-xl border border-dashed px-4 py-6 text-center text-sm ${darkMode ? "border-slate-700" : "border-slate-200"} ${mutedTextClassName}`}>
                  {bootstrap.sourceBlockCount > 0
                    ? "已找到商品区块但尚无商品，将建立空的经营目录，之后可直接在工作台新增。"
                    : "未找到已发布商品区块。请先在网站中添加并发布商品区块，再回来建立经营目录。"}
                </p>
              )}

              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => void confirmBootstrap()}
                  disabled={Boolean(actingKey) || bootstrap.sourceBlockCount === 0}
                  className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-sky-600 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {actingKey === "bootstrap" ? <RefreshIcon spinning /> : <PlusIcon />}
                  {actingKey === "bootstrap"
                    ? "正在建立目录"
                    : bootstrap.sourceBlockCount === 0
                      ? "请先发布商品区块"
                      : "确认并建立商品目录"}
                </button>
              </div>
            </div>
          ) : null}

          {!bootstrap ? (
            <p className={`mt-5 rounded-xl border border-dashed px-4 py-8 text-center text-sm ${darkMode ? "border-slate-700" : "border-slate-200"} ${mutedTextClassName}`}>
              暂无可用的已发布商品预览，请刷新后重试。
            </p>
          ) : null}
        </section>
      ) : null}

      {catalog ? (
        <div className="space-y-5">
          <div className={`flex flex-wrap items-center justify-between gap-2 rounded-2xl border px-4 py-3 text-xs ${surfaceClassName}`}>
            <span>目录修订版 <strong className="text-sm">{catalog.revision}</strong></span>
            <span className={mutedTextClassName}>最近更新 {formatDateTime(catalog.updatedAt)}</span>
          </div>

          <section className={`rounded-2xl border p-4 sm:p-5 ${surfaceClassName}`} aria-labelledby="catalog-prefix-title">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div className="max-w-2xl">
                <h4 id="catalog-prefix-title" className="text-sm font-bold sm:text-base">统一价格前缀</h4>
                <p className={`mt-1 text-xs leading-5 ${mutedTextClassName}`}>
                  例如 ¥、€ 或 $。保存后，已绑定商品区块的公开展示和服务端报价会立即使用新的价格前缀。
                </p>
              </div>
              <div className="flex w-full gap-2 lg:w-auto">
                <input
                  value={pricePrefixDraft}
                  onChange={(event) => setPricePrefixDraft(event.target.value)}
                  maxLength={16}
                  placeholder="例如 €"
                  className={`min-w-0 flex-1 rounded-xl border px-3 py-2.5 text-sm outline-none ring-2 ring-transparent transition lg:w-44 ${inputClassName}`}
                  aria-label="商品目录价格前缀"
                />
                <button
                  type="button"
                  onClick={() => void runMutation("price-prefix", { action: "set_price_prefix", pricePrefix: pricePrefixDraft.trim() }, "价格前缀已更新。")}
                  disabled={Boolean(actingKey) || pricePrefixDraft === catalog.pricePrefix}
                  className="shrink-0 rounded-xl bg-sky-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {actingKey === "price-prefix" ? "保存中" : "保存"}
                </button>
              </div>
            </div>
          </section>

          <section className={`rounded-2xl border p-4 sm:p-5 ${surfaceClassName}`} aria-labelledby="catalog-placement-title">
            <div>
              <h4 id="catalog-placement-title" className="text-sm font-bold sm:text-base">页面投放与区块绑定</h4>
              <p className={`mt-1 text-xs leading-5 ${mutedTextClassName}`}>
                决定每个网站商品区块实际展示哪些工作台商品。商品、价格和可售状态在这里更新后立即生效；网站编辑器继续负责布局与样式。
              </p>
            </div>

            {normalizedCatalogTarget ? (
              <div
                className={`mt-4 rounded-xl border px-4 py-3 text-sm ${
                  resolvedTargetCollection
                    ? darkMode
                      ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-100"
                      : "border-emerald-200 bg-emerald-50 text-emerald-800"
                    : darkMode
                      ? "border-amber-400/30 bg-amber-400/10 text-amber-100"
                      : "border-amber-200 bg-amber-50 text-amber-800"
                }`}
              >
                <p className="font-bold">
                  从网站编辑器打开的区块：{getViewportLabel(normalizedCatalogTarget.viewport)} · {normalizedCatalogTarget.blockId}
                </p>
                <p className="mt-1 text-xs leading-5 opacity-85">
                  {resolvedTargetCollection
                    ? `已绑定工作台目录，共投放 ${resolvedTargetCollection.productIds.length} 个商品。`
                    : "尚未绑定工作台目录。请在下方确认商品范围并保存；网站发布后会直接使用这份运营配置。"}
                </p>
                {!resolvedTargetCollection && missingTargetProductIds.length > 0 ? (
                  <p className="mt-2 text-xs font-semibold leading-5">
                    该区块有 {missingTargetProductIds.length} 个商品尚未进入工作台目录；请先新增这些商品，或确认它们不再展示。
                  </p>
                ) : null}
                {resolvedTargetCollection?.viewport === "shared" ? (
                  <button
                    type="button"
                    onClick={beginTargetSpecificCollection}
                    disabled={Boolean(actingKey)}
                    className="mt-3 rounded-lg border border-current/30 px-3 py-2 text-xs font-bold transition hover:bg-current/10 disabled:opacity-50"
                  >
                    为当前{getViewportLabel(normalizedCatalogTarget.viewport)}单独配置
                  </button>
                ) : null}
                {!resolvedTargetCollection && !collectionDraft ? (
                  <button
                    type="button"
                    onClick={beginTargetSharedCollection}
                    disabled={Boolean(actingKey)}
                    className="mt-3 rounded-lg border border-current/30 px-3 py-2 text-xs font-bold transition hover:bg-current/10 disabled:opacity-50"
                  >
                    创建电脑端与手机端共享绑定
                  </button>
                ) : null}
              </div>
            ) : null}

            {collectionDraft ? (
              <form
                onSubmit={(event) => void submitCollection(event)}
                className={`mt-4 rounded-2xl border p-4 ${darkMode ? "border-sky-400/25 bg-sky-400/5" : "border-sky-200 bg-sky-50/50"}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h5 className="text-sm font-bold">
                      {collectionDraftIsNew ? "绑定当前网站商品区块" : "编辑区块投放商品"}
                    </h5>
                    <p className={`mt-1 text-xs leading-5 ${mutedTextClassName}`}>
                      保存后公开页面和服务端订单报价会使用相同商品范围。
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setCollectionDraft(null)}
                    className={`rounded-xl border px-3 py-2 text-xs font-semibold ${secondaryButtonClassName}`}
                  >
                    取消
                  </button>
                </div>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <label className="text-xs font-semibold">
                    网站区块 ID
                    <input
                      value={collectionDraft.blockId}
                      readOnly
                      disabled
                      className={`mt-1.5 w-full rounded-xl border px-3 py-2.5 text-sm opacity-70 ${inputClassName}`}
                    />
                  </label>
                  <label className="text-xs font-semibold">
                    展示终端
                    <input
                      value={getViewportLabel(collectionDraft.viewport)}
                      readOnly
                      disabled
                      className={`mt-1.5 w-full rounded-xl border px-3 py-2.5 text-sm opacity-70 ${inputClassName}`}
                    />
                  </label>
                </div>
                <div
                  className={`mt-4 rounded-xl border p-3 sm:p-4 ${
                    darkMode ? "border-slate-700 bg-slate-950/50" : "border-slate-200 bg-white"
                  }`}
                >
                  <div>
                    <p className="text-xs font-bold">商品浏览规则</p>
                    <p className={`mt-1 text-xs leading-5 ${mutedTextClassName}`}>
                      {collectionDraft.viewport === "shared"
                        ? "这是电脑端与手机端的默认绑定；没有单端绑定的终端会使用这些规则，单端绑定始终优先覆盖。布局和样式仍由网站编辑器管理。"
                        : `控制该区块${getViewportLabel(collectionDraft.viewport)}的搜索和分类行为。布局和样式仍由网站编辑器管理。`}
                    </p>
                  </div>
                  {collectionDraft.browsingRules ? (
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-current/10 px-3 py-2.5 text-xs">
                        <input
                          type="checkbox"
                          checked={collectionDraft.browsingRules.searchEnabled}
                          onChange={(event) =>
                            setCollectionDraft({
                              ...collectionDraft,
                              browsingRules: {
                                ...collectionDraft.browsingRules!,
                                searchEnabled: event.target.checked,
                              },
                            })
                          }
                          className="mt-0.5 h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                        />
                        <span>
                          <span className="block font-semibold">启用商品搜索</span>
                          <span className={`mt-0.5 block font-normal leading-5 ${mutedTextClassName}`}>
                            让客户可按名称、编号和介绍查找商品。
                          </span>
                        </span>
                      </label>
                      <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-current/10 px-3 py-2.5 text-xs">
                        <input
                          type="checkbox"
                          checked={collectionDraft.browsingRules.hideUnselectedCategory}
                          onChange={(event) =>
                            setCollectionDraft({
                              ...collectionDraft,
                              browsingRules: {
                                ...collectionDraft.browsingRules!,
                                hideUnselectedCategory: event.target.checked,
                              },
                            })
                          }
                          className="mt-0.5 h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                        />
                        <span>
                          <span className="block font-semibold">分类选中后隐藏其他分类</span>
                          <span className={`mt-0.5 block font-normal leading-5 ${mutedTextClassName}`}>
                            选中某个分类后只显示该分类商品。
                          </span>
                        </span>
                      </label>
                      <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-current/10 px-3 py-2.5 text-xs">
                        <input
                          type="checkbox"
                          checked={collectionDraft.browsingRules.groupByCategory}
                          onChange={(event) =>
                            setCollectionDraft({
                              ...collectionDraft,
                              browsingRules: {
                                ...collectionDraft.browsingRules!,
                                groupByCategory: event.target.checked,
                              },
                            })
                          }
                          className="mt-0.5 h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                        />
                        <span>
                          <span className="block font-semibold">按分类排列商品</span>
                          <span className={`mt-0.5 block font-normal leading-5 ${mutedTextClassName}`}>
                            按目录分类分组排列，未分类商品排在最后。
                          </span>
                        </span>
                      </label>
                      <label className="text-xs font-semibold sm:col-span-2">
                        搜索框提示词
                        <input
                          value={collectionDraft.browsingRules.searchPlaceholder}
                          onChange={(event) =>
                            setCollectionDraft({
                              ...collectionDraft,
                              browsingRules: {
                                ...collectionDraft.browsingRules!,
                                searchPlaceholder: event.target.value,
                              },
                            })
                          }
                          disabled={!collectionDraft.browsingRules.searchEnabled}
                          maxLength={MERCHANT_CATALOG_MAX_SEARCH_PLACEHOLDER_LENGTH}
                          placeholder="留空时使用网站默认提示词"
                          className={`mt-1.5 w-full rounded-xl border px-3 py-2.5 text-sm outline-none ring-2 ring-transparent disabled:cursor-not-allowed disabled:opacity-55 ${inputClassName}`}
                        />
                      </label>
                    </div>
                  ) : (
                    <div
                      className={`mt-3 rounded-xl border px-3 py-3 text-xs leading-5 ${
                        darkMode
                          ? "border-amber-400/30 bg-amber-400/10 text-amber-100"
                          : "border-amber-200 bg-amber-50 text-amber-800"
                      }`}
                    >
                      <p className="font-bold">浏览规则仍沿用网站设置</p>
                      <p className="mt-1">
                        {collectionDraft.viewport === "shared"
                          ? "当前电脑端与手机端继续分别沿用各自已发布的网站设置。保存商品投放范围不会把某一个终端的规则静默复制给另一个终端。"
                          : "保存商品投放范围不会静默接管搜索和分类行为。需要以后直接在工作台维护时，请显式迁入。"}
                      </p>
                      <button
                        type="button"
                        onClick={() =>
                          setCollectionDraft({
                            ...collectionDraft,
                            browsingRules: { ...collectionDraftBrowsingRulesMigrationSeed },
                          })
                        }
                        className="mt-2 rounded-lg border border-current/30 px-3 py-2 font-bold transition hover:bg-current/10"
                      >
                        将浏览规则迁入工作台
                      </button>
                      <p className="mt-2 opacity-85">
                        {collectionDraft.viewport === "shared"
                          ? "迁入后这组规则会作为双端默认；已有单端绑定的终端仍以单端配置为准。初始值为：启用搜索、提示词留空、选中分类后隐藏其他分类、不按分类分组排列。"
                          : matchingTargetBrowsingRules
                            ? `将以当前${getViewportLabel(collectionDraft.viewport)}网站设置作为初始值，保存前仍可调整。`
                            : "迁入初始值：启用搜索、提示词留空、选中分类后隐藏其他分类、不按分类分组排列。保存前仍可调整。"}
                      </p>
                    </div>
                  )}
                </div>
                <fieldset className="mt-4">
                  <legend className="text-xs font-semibold">该区块展示的商品</legend>
                  {catalog.products.length > 0 ? (
                    <div className={`mt-2 grid max-h-56 gap-2 overflow-y-auto rounded-xl border p-3 sm:grid-cols-2 ${darkMode ? "border-slate-700 bg-slate-950/50" : "border-slate-200 bg-white"}`}>
                      {catalog.products.map((product) => {
                        const checked = collectionDraft.productIds.includes(product.id);
                        return (
                          <label key={product.id} className="flex cursor-pointer items-center gap-2 text-xs">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(event) =>
                                setCollectionDraft({
                                  ...collectionDraft,
                                  productIds: event.target.checked
                                    ? [...new Set([...collectionDraft.productIds, product.id])]
                                    : collectionDraft.productIds.filter((productId) => productId !== product.id),
                                })
                              }
                              className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                            />
                            <span className="min-w-0 truncate">
                              {product.name || product.id}
                              {product.availability === "hidden" ? "（隐藏）" : ""}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  ) : (
                    <p className={`mt-2 rounded-xl border border-dashed px-3 py-3 text-xs ${mutedTextClassName}`}>
                      目录中还没有商品。可以先保存空绑定，再到“商品”区域新增并选择投放范围。
                    </p>
                  )}
                </fieldset>
                <div className="mt-4 flex justify-end">
                  <button
                    type="submit"
                    disabled={Boolean(actingKey)}
                    className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-sky-600 px-5 py-2 text-sm font-bold text-white transition hover:bg-sky-700 disabled:opacity-50"
                  >
                    {actingKey.startsWith("collection:") ? <RefreshIcon spinning /> : <CheckIcon />}
                    {actingKey.startsWith("collection:") ? "保存中" : "保存区块投放"}
                  </button>
                </div>
              </form>
            ) : null}

            {catalog.collections.length > 0 ? (
              <div className="mt-4 grid gap-3 lg:grid-cols-2">
                {catalog.collections.map((collection) => (
                  <article
                    key={collection.id}
                    className={`rounded-xl border p-3 ${darkMode ? "border-slate-700 bg-slate-950/50" : "border-slate-100 bg-slate-50/70"}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold" title={collection.blockId}>{collection.blockId}</p>
                        <p className={`mt-1 text-[11px] ${mutedTextClassName}`}>{getViewportLabel(collection.viewport)}</p>
                        <p className={`mt-1 text-[11px] leading-5 ${mutedTextClassName}`}>
                          {getBrowsingRulesSummary(collection.browsingRules)}
                        </p>
                      </div>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${darkMode ? "bg-slate-800 text-slate-300" : "bg-white text-slate-600"}`}>
                        {collection.productIds.length} 个商品
                      </span>
                    </div>
                    <div className="mt-3 flex gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setCollectionDraft({
                            ...collection,
                            productIds: [...collection.productIds],
                            browsingRules: copyMerchantCatalogBrowsingRules(collection.browsingRules),
                          });
                          setCollectionDraftIsNew(false);
                          setCollectionDraftRevision(catalog.revision);
                        }}
                        disabled={Boolean(actingKey)}
                        className={`inline-flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold ${secondaryButtonClassName}`}
                      >
                        <EditIcon /> 编辑投放
                      </button>
                      <button
                        type="button"
                        onClick={() => void confirmDeleteCollection(collection)}
                        disabled={Boolean(actingKey)}
                        className={`inline-flex min-h-9 items-center justify-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold ${darkMode ? "border-rose-400/30 text-rose-200 hover:bg-rose-400/10" : "border-rose-200 bg-white text-rose-700 hover:bg-rose-50"}`}
                      >
                        <TrashIcon /> 解除
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <p className={`mt-4 rounded-xl border border-dashed px-4 py-8 text-center text-sm ${darkMode ? "border-slate-700" : "border-slate-200"} ${mutedTextClassName}`}>
                尚未绑定任何网站商品区块。请在网站编辑器中打开目标商品区块，再点击“打开订单工作台商品目录”。
              </p>
            )}
          </section>

          <section className={`rounded-2xl border p-4 sm:p-5 ${surfaceClassName}`} aria-labelledby="catalog-products-title">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h4 id="catalog-products-title" className="text-sm font-bold sm:text-base">商品</h4>
                <p className={`mt-1 text-xs leading-5 ${mutedTextClassName}`}>
                  管理名称、编码、图片、价格和可售状态。批量图片按文件名中的商品编码匹配，未匹配文件不会上传。
                </p>
              </div>
              <div className="grid shrink-0 grid-cols-1 gap-2 sm:flex">
                <input
                  ref={productImportInputRef}
                  type="file"
                  accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                  className="sr-only"
                  onChange={(event) => void readProductImportFile(event)}
                  disabled={Boolean(actingKey) || productImportReading || productImageImportUploading || productImageUploading || Boolean(productImageUpload)}
                  aria-label="选择商品 Excel 文件"
                />
                <input
                  ref={productImageImportInputRef}
                  type="file"
                  accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
                  multiple
                  className="sr-only"
                  onChange={readProductImageImportFiles}
                  disabled={Boolean(actingKey) || productImportReading || productImageImportUploading || productImageUploading || Boolean(productImageUpload)}
                  aria-label="选择按商品编码命名的商品图片"
                />
                <button
                  type="button"
                  onClick={() => productImportInputRef.current?.click()}
                  disabled={Boolean(actingKey) || productImportReading || productImageImportUploading || productImageUploading || Boolean(productImageUpload)}
                  className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border px-4 py-2 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-50 ${secondaryButtonClassName}`}
                >
                  {productImportReading ? <RefreshIcon spinning /> : <UploadIcon />}
                  {productImportReading ? "读取中" : productImportDraft ? "重新选 Excel" : "Excel 导入"}
                </button>
                <button
                  type="button"
                  onClick={openProductImageImportPicker}
                  disabled={Boolean(actingKey) || productImportReading || productImageImportUploading || productImageUploading || Boolean(productImageUpload)}
                  className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border px-4 py-2 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-50 ${secondaryButtonClassName}`}
                >
                  {productImageImportUploading ? <RefreshIcon spinning /> : <UploadIcon />}
                  {productImageImportUploading
                    ? "上传图片中"
                    : productImageImportDraft
                      ? "重新选图片"
                      : "图片批量导入"}
                </button>
                <button
                  type="button"
                  onClick={beginNewProduct}
                  disabled={Boolean(actingKey) || productImportReading || productImageImportUploading || productImageUploading}
                  className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-sky-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-sky-700 disabled:opacity-50"
                >
                  <PlusIcon /> 新增商品
                </button>
              </div>
            </div>

            <div aria-live="polite">
              {productImportReading ? (
                <div className={`mt-4 flex items-center gap-2 rounded-xl border px-4 py-3 text-sm ${darkMode ? "border-sky-400/25 bg-sky-400/10 text-sky-100" : "border-sky-200 bg-sky-50 text-sky-800"}`}>
                  <RefreshIcon spinning /> 正在读取 Excel 并按当前目录生成导入预览……
                </div>
              ) : null}
              {productImportError ? (
                <div role="alert" className={`mt-4 rounded-xl border px-4 py-3 text-sm leading-6 ${darkMode ? "border-rose-400/30 bg-rose-400/10 text-rose-100" : "border-rose-200 bg-rose-50 text-rose-700"}`}>
                  <p className="font-bold">Excel 导入预览生成失败</p>
                  <p className="mt-1 text-xs leading-5 opacity-90">{productImportError}</p>
                  <button type="button" onClick={() => productImportInputRef.current?.click()} className="mt-2 rounded-lg border border-current/30 px-3 py-1.5 text-xs font-bold hover:bg-current/10">
                    重新选择文件
                  </button>
                </div>
              ) : null}
              {productImageImportUploading && productImageImportProgress ? (
                <div
                  role="status"
                  className={`mt-4 rounded-xl border px-4 py-3 text-sm ${darkMode ? "border-sky-400/25 bg-sky-400/10 text-sky-100" : "border-sky-200 bg-sky-50 text-sky-800"}`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="inline-flex items-center gap-2 font-bold">
                      <RefreshIcon spinning /> 正在处理并上传匹配图片
                    </span>
                    <span className="shrink-0 text-xs tabular-nums">
                      {productImageImportProgress.processed}/{productImageImportProgress.total}
                    </span>
                  </div>
                  <progress
                    className="mt-2 h-2 w-full overflow-hidden rounded-full"
                    value={productImageImportProgress.processed}
                    max={Math.max(1, productImageImportProgress.total)}
                    aria-label="商品图片上传进度"
                  />
                  <p className="mt-1 text-xs leading-5 opacity-90">
                    已上传 {productImageImportProgress.uploaded} 张
                    {productImageImportProgress.failed > 0 ? `，失败 ${productImageImportProgress.failed} 张` : ""}。未匹配文件不会上传。
                  </p>
                </div>
              ) : null}
              {productImageImportError ? (
                <div role="alert" className={`mt-4 rounded-xl border px-4 py-3 text-sm leading-6 ${darkMode ? "border-rose-400/30 bg-rose-400/10 text-rose-100" : "border-rose-200 bg-rose-50 text-rose-700"}`}>
                  <p className="font-bold">商品图片导入尚未完成</p>
                  <p className="mt-1 text-xs leading-5 opacity-90">{productImageImportError}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {productImageImportDraft && productImageImportIsStale ? (
                      <button
                        type="button"
                        onClick={rebaseProductImageImportDraft}
                        disabled={Boolean(actingKey) || productImageImportUploading || !catalog}
                        className="rounded-lg border border-current/30 px-3 py-1.5 text-xs font-bold hover:bg-current/10 disabled:opacity-50"
                      >
                        基于最新版重新匹配
                      </button>
                    ) : productImageImportDraft && productImageImportDraft.plan.summary.matched > 0 ? (
                      <button
                        type="button"
                        onClick={() => void confirmProductImageImport()}
                        disabled={Boolean(actingKey) || productImageImportUploading}
                        className="rounded-lg border border-current/30 px-3 py-1.5 text-xs font-bold hover:bg-current/10 disabled:opacity-50"
                      >
                        重试当前批次
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={openProductImageImportPicker}
                      disabled={Boolean(actingKey) || productImageImportUploading}
                      className="rounded-lg border border-current/30 px-3 py-1.5 text-xs font-bold hover:bg-current/10 disabled:opacity-50"
                    >
                      重新选择图片
                    </button>
                  </div>
                </div>
              ) : null}
            </div>

            {productImportDraft ? (
              <section
                className={`mt-5 rounded-2xl border p-4 sm:p-5 ${darkMode ? "border-violet-400/30 bg-violet-400/5" : "border-violet-200 bg-violet-50/50"}`}
                aria-labelledby={productImportPreviewTitleId}
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <h5 id={productImportPreviewTitleId} className="text-sm font-bold">核对 Excel 导入预览</h5>
                    <p className={`mt-1 break-all text-xs leading-5 ${mutedTextClassName}`} title={productImportDraft.fileName}>
                      {productImportDraft.fileName} · 共读取 {productImportDraft.rowCount} 条商品记录 · 基于目录修订版 {productImportDraft.baseRevision}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button type="button" onClick={clearProductImportDraft} disabled={Boolean(actingKey)} className={`rounded-xl border px-3 py-2 text-xs font-semibold disabled:opacity-50 ${secondaryButtonClassName}`}>
                      取消
                    </button>
                    <button type="button" onClick={() => productImportInputRef.current?.click()} disabled={Boolean(actingKey)} className={`rounded-xl border px-3 py-2 text-xs font-semibold disabled:opacity-50 ${secondaryButtonClassName}`}>
                      重新选择
                    </button>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {[
                    ["有效记录", productImportDraft.plan.summary.total],
                    ["新建", productImportDraft.plan.summary.created],
                    ["更新", productImportDraft.plan.summary.updated],
                    ["不变", productImportDraft.plan.summary.unchanged],
                  ].map(([label, value]) => (
                    <div key={String(label)} className={`rounded-xl border px-3 py-2.5 ${darkMode ? "border-slate-700 bg-slate-950/60" : "border-white bg-white"}`}>
                      <p className={`text-[11px] ${mutedTextClassName}`}>{label}</p>
                      <p className="mt-0.5 text-lg font-black">{value}</p>
                    </div>
                  ))}
                </div>

                <div className={`mt-4 rounded-xl border px-3 py-3 text-xs leading-5 ${darkMode ? "border-slate-700 bg-slate-950/50 text-slate-300" : "border-violet-100 bg-white text-slate-600"}`}>
                  <p className="font-bold text-inherit">导入规则</p>
                  <ul className="mt-1 list-disc space-y-1 pl-5">
                    <li>按商品编码匹配现有商品；编码为必填项，其他空单元格不会清空已有字段。</li>
                    <li>更新商品时保留现有图片、可售状态和页面投放；Excel 只更新已填写的名称、介绍、价格和分类。</li>
                    <li>新商品会以“隐藏且未投放”状态进入目录，核对图片和投放范围后再手动上架。</li>
                    <li>确认时必须仍是修订版 {productImportDraft.baseRevision}；若目录已变化，系统会冲突重载，不会把草稿静默套用到新版目录。</li>
                  </ul>
                </div>

                <div className="mt-4 overflow-x-auto rounded-xl border border-current/10">
                  <table className="min-w-full text-left text-xs">
                    <thead className={darkMode ? "bg-slate-950/70 text-slate-400" : "bg-white text-slate-500"}>
                      <tr>
                        <th className="whitespace-nowrap px-3 py-2 font-semibold">导入序号</th>
                        <th className="min-w-40 px-3 py-2 font-semibold">商品编码</th>
                        <th className="whitespace-nowrap px-3 py-2 font-semibold">操作</th>
                        <th className="min-w-52 px-3 py-2 font-semibold">目录商品 ID</th>
                      </tr>
                    </thead>
                    <tbody className={darkMode ? "divide-y divide-slate-800 bg-slate-950/30" : "divide-y divide-slate-100 bg-white/70"}>
                      {productImportDraft.plan.rows.slice(0, 12).map((row) => (
                        <tr key={`${row.rowIndex}:${row.normalizedCode}`}>
                          <td className="whitespace-nowrap px-3 py-2.5">第 {row.rowIndex + 1} 条</td>
                          <td className="px-3 py-2.5 font-semibold">{row.code}</td>
                          <td className="whitespace-nowrap px-3 py-2.5">
                            <span className={`rounded-full px-2 py-1 font-bold ${
                              row.action === "create"
                                ? darkMode ? "bg-emerald-400/10 text-emerald-200" : "bg-emerald-50 text-emerald-700"
                                : row.action === "update"
                                  ? darkMode ? "bg-sky-400/10 text-sky-200" : "bg-sky-50 text-sky-700"
                                  : darkMode ? "bg-slate-800 text-slate-300" : "bg-slate-100 text-slate-600"
                            }`}>{getProductImportActionLabel(row.action)}</span>
                          </td>
                          <td className={`px-3 py-2.5 font-mono text-[11px] ${mutedTextClassName}`}>{row.productId}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {productImportDraft.plan.rows.length > 12 ? (
                  <p className={`mt-2 text-xs ${mutedTextClassName}`}>这里只预览前 12 行；另有 {productImportDraft.plan.rows.length - 12} 行会按同一规则处理。</p>
                ) : null}

                <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <p className={`text-xs leading-5 ${mutedTextClassName}`}>
                    {productImportDraft.plan.summary.created + productImportDraft.plan.summary.updated === 0
                      ? "文件内容与当前目录一致，无需提交。"
                      : "确认后将立即写入经营目录；新商品不会自动公开展示。"}
                  </p>
                  <button
                    type="button"
                    onClick={() => void confirmProductImport()}
                    disabled={Boolean(actingKey) || productImportDraft.plan.summary.created + productImportDraft.plan.summary.updated === 0}
                    className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {actingKey === "bulk-import-products" ? <RefreshIcon spinning /> : <CheckIcon />}
                    {actingKey === "bulk-import-products" ? "正在导入" : "确认批量导入"}
                  </button>
                </div>
              </section>
            ) : null}

            {productImageImportDraft ? (
              <section
                className={`mt-5 rounded-2xl border p-4 sm:p-5 ${darkMode ? "border-cyan-400/30 bg-cyan-400/5" : "border-cyan-200 bg-cyan-50/50"}`}
                aria-labelledby={productImageImportPreviewTitleId}
                aria-busy={productImageImportUploading}
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <h5 id={productImageImportPreviewTitleId} className="text-sm font-bold">核对商品图片匹配预览</h5>
                    <p className={`mt-1 text-xs leading-5 ${mutedTextClassName}`}>
                      共选择 {productImageImportDraft.plan.summary.total} 张 · 基于目录修订版 {productImageImportDraft.baseRevision}
                    </p>
                  </div>
                  <div className="grid shrink-0 grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={requestClearProductImageImportDraft}
                      disabled={Boolean(actingKey) || productImageImportUploading}
                      className={`rounded-xl border px-3 py-2 text-xs font-semibold disabled:opacity-50 ${secondaryButtonClassName}`}
                    >
                      关闭
                    </button>
                    <button
                      type="button"
                      onClick={openProductImageImportPicker}
                      disabled={Boolean(actingKey) || productImageImportUploading}
                      className={`rounded-xl border px-3 py-2 text-xs font-semibold disabled:opacity-50 ${secondaryButtonClassName}`}
                    >
                      重新选择
                    </button>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {[
                    ["所选图片", productImageImportDraft.plan.summary.total],
                    ["匹配商品", productImageImportDraft.plan.summary.matched],
                    ["未匹配", productImageImportDraft.plan.summary.unmatched],
                    ["已上传缓存", productImageImportMatchedUploadedCount],
                  ].map(([label, value]) => (
                    <div key={String(label)} className={`rounded-xl border px-3 py-2.5 ${darkMode ? "border-slate-700 bg-slate-950/60" : "border-white bg-white"}`}>
                      <p className={`text-[11px] ${mutedTextClassName}`}>{label}</p>
                      <p className="mt-0.5 text-lg font-black">{value}</p>
                    </div>
                  ))}
                </div>

                <div className={`mt-4 rounded-xl border px-3 py-3 text-xs leading-5 ${darkMode ? "border-slate-700 bg-slate-950/50 text-slate-300" : "border-cyan-100 bg-white text-slate-600"}`}>
                  <p className="font-bold text-inherit">安全导入规则</p>
                  <ul className="mt-1 list-disc space-y-1 pl-5">
                    <li>文件名去掉扩展名后按商品编码匹配，例如 SKU-001.jpg → SKU-001；未匹配文件不会上传。</li>
                    <li>只接受 JPEG、PNG、WebP；每张不超过 10 MB，每批最多 100 张且总大小不超过 100 MB。</li>
                    <li>点击确认后才开始压缩和上传；全部匹配图片上传成功后，才会一次性写入目录。</li>
                    <li>只替换商品原图和缩略图，名称、价格、分类、可售状态及页面投放保持不变。</li>
                    <li>写入必须仍基于修订版 {productImageImportDraft.baseRevision}；目录变化后需要重新匹配并再次确认。</li>
                  </ul>
                </div>

                {productImageImportIsStale ? (
                  <div className={`mt-4 rounded-xl border px-3 py-3 text-xs leading-5 ${darkMode ? "border-amber-400/30 bg-amber-400/10 text-amber-100" : "border-amber-200 bg-amber-50 text-amber-800"}`}>
                    <p className="font-bold">该预览已经过期，系统不会继续写入。</p>
                    <p className="mt-1">请基于当前目录修订版 {catalog?.revision ?? "—"} 重新匹配；已上传成功且仍匹配的图片会复用。</p>
                    <button
                      type="button"
                      onClick={rebaseProductImageImportDraft}
                      disabled={Boolean(actingKey) || productImageImportUploading || !catalog}
                      className="mt-2 rounded-lg border border-current/30 px-3 py-1.5 font-bold hover:bg-current/10 disabled:opacity-50"
                    >
                      基于最新版重新匹配
                    </button>
                  </div>
                ) : null}

                {productImageImportUnreferencedUploadCount > 0 ? (
                  <div className={`mt-4 rounded-xl border px-3 py-3 text-xs leading-5 ${darkMode ? "border-amber-400/30 bg-amber-400/10 text-amber-100" : "border-amber-200 bg-amber-50 text-amber-800"}`}>
                    有 {productImageImportUnreferencedUploadCount} 张已上传图片在最新版目录中不再匹配，本次确认不会引用；若关闭批次，它们可能成为未引用资源。
                  </div>
                ) : null}

                <div className="mt-4 grid gap-2 md:grid-cols-2">
                  {productImageImportDraft.plan.rows.slice(0, 20).map((row) => {
                    const product = row.productId
                      ? catalog?.products.find((item) => item.id === row.productId)
                      : null;
                    const uploaded = productImageImportUploadedFileNames.has(row.fileName);
                    const failure = productImageImportFailureByFileName.get(row.fileName);
                    const statusLabel = row.status === "matched" ? "已匹配" : row.status === "duplicate" ? "编码重复" : "未匹配";
                    const statusClassName = row.status === "matched"
                      ? darkMode ? "bg-emerald-400/10 text-emerald-200" : "bg-emerald-50 text-emerald-700"
                      : row.status === "duplicate"
                        ? darkMode ? "bg-rose-400/10 text-rose-200" : "bg-rose-50 text-rose-700"
                        : darkMode ? "bg-slate-800 text-slate-300" : "bg-slate-100 text-slate-600";
                    return (
                      <article
                        key={`${row.rowIndex}:${row.fileName}`}
                        className={`min-w-0 rounded-xl border p-3 ${darkMode ? "border-slate-700 bg-slate-950/40" : "border-cyan-100 bg-white"}`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="break-all text-xs font-bold" title={row.fileName}>{row.fileName}</p>
                            <p className={`mt-1 break-all font-mono text-[11px] ${mutedTextClassName}`}>编码 {row.code}</p>
                          </div>
                          <span className={`shrink-0 rounded-full px-2 py-1 text-[11px] font-bold ${statusClassName}`}>{statusLabel}</span>
                        </div>
                        <p className={`mt-2 break-words text-xs leading-5 ${mutedTextClassName}`}>
                          {row.status === "matched"
                            ? `${product?.name || "目录商品"} · ${row.productId}`
                            : row.status === "unmatched"
                              ? "目录中没有相同编码的商品，不会上传"
                              : "同一编码对应多张文件或多个商品，整批已阻止"}
                        </p>
                        {uploaded ? (
                          <p className={`mt-2 text-[11px] font-bold ${darkMode ? "text-sky-200" : "text-sky-700"}`}>已上传，写入失败时可直接复用</p>
                        ) : failure ? (
                          <p className={`mt-2 text-[11px] font-bold ${darkMode ? "text-rose-200" : "text-rose-700"}`}>上传失败：{failure.message}</p>
                        ) : null}
                      </article>
                    );
                  })}
                </div>
                {productImageImportDraft.plan.rows.length > 20 ? (
                  <p className={`mt-2 text-xs ${mutedTextClassName}`}>
                    这里只预览前 20 个文件；另有 {productImageImportDraft.plan.rows.length - 20} 个文件按同一规则处理。
                  </p>
                ) : null}

                <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <p className={`text-xs leading-5 ${mutedTextClassName}`}>
                    {productImageImportDraft.plan.summary.matched === 0
                      ? "没有匹配商品，不会上传任何文件；请检查文件名或先补充商品编码。"
                      : productImageImportDraft.uploadFailures.length > 0
                        ? "重试只处理失败图片，已经上传成功的图片不会重复上传。"
                        : productImageImportMatchedUploadedCount === productImageImportDraft.plan.summary.matched
                          ? "匹配图片均已上传；确认会重试写入原子目录变更。"
                          : `确认后上传 ${productImageImportDraft.plan.summary.matched} 张匹配图片；${productImageImportDraft.plan.summary.unmatched} 张未匹配图片保持在本机。`}
                  </p>
                  <button
                    type="button"
                    onClick={() => void confirmProductImageImport()}
                    disabled={
                      Boolean(actingKey) ||
                      productImageImportUploading ||
                      productImageImportIsStale ||
                      productImageImportDraft.plan.summary.matched === 0
                    }
                    className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-cyan-600 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-cyan-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {productImageImportUploading || actingKey === "bulk-set-product-images" ? <RefreshIcon spinning /> : <CheckIcon />}
                    {productImageImportUploading
                      ? `正在上传 ${productImageImportProgress?.processed ?? 0}/${productImageImportProgress?.total ?? productImageImportDraft.plan.summary.matched}`
                      : actingKey === "bulk-set-product-images"
                        ? "正在写入目录"
                        : productImageImportDraft.uploadFailures.length > 0
                          ? "重试并写入目录"
                          : productImageImportMatchedUploadedCount === productImageImportDraft.plan.summary.matched
                            ? "重试写入目录"
                            : "确认上传并写入"}
                  </button>
                </div>
              </section>
            ) : null}

            {productDraft ? (
              <form onSubmit={(event) => void submitProduct(event)} className={`mt-5 rounded-2xl border p-4 ${darkMode ? "border-sky-400/25 bg-sky-400/5" : "border-sky-200 bg-sky-50/50"}`}>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h5 className="text-sm font-bold">{productDraftIsNew ? "新增商品" : `编辑：${productDraft.name || productDraft.id}`}</h5>
                    <p className={`mt-1 text-xs ${mutedTextClassName}`}>商品 ID 由系统稳定生成，创建后不可修改。</p>
                  </div>
                  <button
                    type="button"
                    onClick={discardProductDraft}
                    disabled={productImageUploading || Boolean(actingKey)}
                    className={`rounded-xl border px-3 py-2 text-xs font-semibold ${secondaryButtonClassName}`}
                  >
                    取消
                  </button>
                </div>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <label className="text-xs font-semibold">
                    商品 ID
                    <input value={productDraft.id} readOnly disabled className={`mt-1.5 w-full rounded-xl border px-3 py-2.5 text-sm opacity-70 ${inputClassName}`} />
                  </label>
                  <label className="text-xs font-semibold">
                    商品编码
                    <input value={productDraft.code} onChange={(event) => setProductDraft({ ...productDraft, code: event.target.value })} maxLength={80} className={`mt-1.5 w-full rounded-xl border px-3 py-2.5 text-sm outline-none ring-2 ring-transparent ${inputClassName}`} placeholder="例如 SKU-001" />
                  </label>
                  <label className="text-xs font-semibold">
                    商品名称 <span className="text-rose-500">*</span>
                    <input required value={productDraft.name} onChange={(event) => setProductDraft({ ...productDraft, name: event.target.value })} maxLength={160} className={`mt-1.5 w-full rounded-xl border px-3 py-2.5 text-sm outline-none ring-2 ring-transparent ${inputClassName}`} />
                  </label>
                  <label className="text-xs font-semibold">
                    价格文本
                    <input required value={productDraft.price} onChange={(event) => setProductDraft({ ...productDraft, price: event.target.value })} maxLength={18} pattern="(?:0|[1-9][0-9]*)(?:[.,][0-9]{1,2})?" className={`mt-1.5 w-full rounded-xl border px-3 py-2.5 text-sm outline-none ring-2 ring-transparent ${inputClassName}`} placeholder="例如 19.90；免费请填 0" inputMode="decimal" />
                  </label>
                  <label className="text-xs font-semibold">
                    分类标签
                    <input list={categoryListId} value={productDraft.tag} onChange={(event) => setProductDraft({ ...productDraft, tag: event.target.value })} maxLength={100} className={`mt-1.5 w-full rounded-xl border px-3 py-2.5 text-sm outline-none ring-2 ring-transparent ${inputClassName}`} />
                    <datalist id={categoryListId}>{catalog.categories.map((category) => <option key={category.id} value={category.name} />)}</datalist>
                  </label>
                  <label className="text-xs font-semibold">
                    可售状态
                    <select value={productDraft.availability} onChange={(event) => setProductDraft({ ...productDraft, availability: event.target.value as MerchantCatalogAvailability })} className={`mt-1.5 w-full rounded-xl border px-3 py-2.5 text-sm outline-none ring-2 ring-transparent ${inputClassName}`}>
                      {AVAILABILITY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label} — {option.description}</option>)}
                    </select>
                  </label>
                  <fieldset className="text-xs font-semibold sm:col-span-2">
                    <legend>投放到商品区块</legend>
                    <p className={`mt-1 font-normal leading-5 ${mutedTextClassName}`}>
                      保存后会立即影响所选区块的公开展示与服务端报价。新商品默认选中全部区块，请按实际投放范围调整。
                    </p>
                    {catalog.collections.length > 0 ? (
                      <div className={`mt-2 grid gap-2 rounded-xl border p-3 sm:grid-cols-2 ${darkMode ? "border-slate-700 bg-slate-950/50" : "border-slate-200 bg-white"}`}>
                        {catalog.collections.map((collection) => {
                          const checked = productDraftCollectionIds.includes(collection.id);
                          return (
                            <label key={collection.id} className="flex cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5 text-xs">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(event) => setProductDraftCollectionIds((current) =>
                                  event.target.checked
                                    ? [...new Set([...current, collection.id])]
                                    : current.filter((collectionId) => collectionId !== collection.id),
                                )}
                                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                              />
                              <span className="min-w-0">
                                <span className="block truncate font-semibold">{collection.blockId}</span>
                                <span className={`block font-normal ${mutedTextClassName}`}>
                                  {collection.viewport === "desktop" ? "电脑端" : collection.viewport === "mobile" ? "手机端" : "桌面与手机共享"}
                                </span>
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    ) : (
                      <p className={`mt-2 rounded-xl border border-dashed px-3 py-3 font-normal ${mutedTextClassName}`}>
                        当前目录没有已绑定商品区块，商品会先保存在目录中但不会公开展示。
                      </p>
                    )}
                  </fieldset>
                  <label className="text-xs font-semibold sm:col-span-2">
                    商品描述
                    <textarea value={productDraft.description} onChange={(event) => setProductDraft({ ...productDraft, description: event.target.value })} maxLength={2000} rows={3} className={`mt-1.5 w-full resize-y rounded-xl border px-3 py-2.5 text-sm outline-none ring-2 ring-transparent ${inputClassName}`} />
                  </label>
                  <div className={`sm:col-span-2 rounded-2xl border p-3 ${darkMode ? "border-slate-700 bg-slate-950/50" : "border-slate-200 bg-white"}`}>
                    <input
                      ref={productImageInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
                      className="sr-only"
                      onChange={(event) => void uploadSingleProductImage(event)}
                    />
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                      <MerchantCatalogProductThumbnail
                        imageUrl={productDraft.imageUrl}
                        thumbnailUrl={productDraft.thumbnailUrl}
                        name={productDraft.name}
                        darkMode={darkMode}
                        className="h-24 w-24"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-bold">商品图片</p>
                        <p className={`mt-1 text-xs leading-5 ${mutedTextClassName}`}>
                          单选 JPEG、PNG 或 WebP，源文件不超过 10 MiB。上传时会自动优化，并生成可用的缩略图。
                        </p>
                        <button
                          type="button"
                          onClick={openSingleProductImagePicker}
                          disabled={productImageUploading || Boolean(actingKey)}
                          className={`mt-2 inline-flex min-h-9 items-center gap-2 rounded-xl border px-3 py-1.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${secondaryButtonClassName}`}
                        >
                          {productImageUploading ? <RefreshIcon spinning /> : <PlusIcon />}
                          {productImageUploading ? "正在处理并上传" : productImageUpload ? "重新上传图片" : "选择并上传图片"}
                        </button>
                      </div>
                    </div>
                    {productImageUpload ? (
                      <p className={`mt-3 rounded-xl border px-3 py-2 text-xs leading-5 ${darkMode ? "border-amber-300/30 bg-amber-300/10 text-amber-100" : "border-amber-200 bg-amber-50 text-amber-800"}`}>
                        图片已上传但尚未写入目录。请保存商品；取消或换商品前会再次确认未引用资源风险。
                      </p>
                    ) : null}
                    {productImageUploadError ? (
                      <p role="alert" className={`mt-3 rounded-xl border px-3 py-2 text-xs leading-5 ${darkMode ? "border-rose-400/30 bg-rose-400/10 text-rose-100" : "border-rose-200 bg-rose-50 text-rose-700"}`}>
                        {productImageUploadError}
                      </p>
                    ) : null}
                  </div>
                  <label className="text-xs font-semibold">
                    商品图片 URL
                    <input value={productDraft.imageUrl} onChange={(event) => setProductDraft({ ...productDraft, imageUrl: event.target.value })} readOnly={Boolean(productImageUpload)} maxLength={2000} type="url" className={`mt-1.5 w-full rounded-xl border px-3 py-2.5 text-sm outline-none ring-2 ring-transparent ${inputClassName} ${productImageUpload ? "opacity-70" : ""}`} />
                  </label>
                  <label className="text-xs font-semibold">
                    缩略图 URL
                    <input value={productDraft.thumbnailUrl} onChange={(event) => setProductDraft({ ...productDraft, thumbnailUrl: event.target.value })} readOnly={Boolean(productImageUpload)} maxLength={2000} type="url" className={`mt-1.5 w-full rounded-xl border px-3 py-2.5 text-sm outline-none ring-2 ring-transparent ${inputClassName} ${productImageUpload ? "opacity-70" : ""}`} />
                  </label>
                </div>
                <div className="mt-4 flex justify-end">
                  <button type="submit" disabled={Boolean(actingKey) || productImageUploading} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-sky-600 px-5 py-2 text-sm font-bold text-white transition hover:bg-sky-700 disabled:opacity-50">
                    {actingKey.startsWith("product:") ? <RefreshIcon spinning /> : <CheckIcon />}
                    {actingKey.startsWith("product:") ? "保存中" : "保存商品"}
                  </button>
                </div>
              </form>
            ) : null}

            <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <input value={productSearch} onChange={(event) => setProductSearch(event.target.value)} placeholder="搜索名称、编码、ID 或分类" className={`w-full rounded-xl border px-3 py-2.5 text-sm outline-none ring-2 ring-transparent sm:max-w-sm ${inputClassName}`} />
              <span className={`text-xs ${mutedTextClassName}`}>显示 {filteredProducts.length} / {catalog.products.length} 个商品</span>
            </div>

            {filteredProducts.length > 0 ? (
              <div className="mt-4 grid gap-3 lg:grid-cols-2">
                {filteredProducts.map((product) => {
                  const isProductActing = actingKey.includes(product.id);
                  const placementCount = catalog.collections.filter((collection) =>
                    collection.productIds.includes(product.id),
                  ).length;
                  return (
                    <article key={product.id} className={`rounded-2xl border p-4 ${darkMode ? "border-slate-700 bg-slate-950/50" : "border-slate-100 bg-slate-50/70"}`}>
                      <div className="flex items-start justify-between gap-3">
                        <MerchantCatalogProductThumbnail
                          imageUrl={product.imageUrl}
                          thumbnailUrl={product.thumbnailUrl}
                          name={product.name}
                          darkMode={darkMode}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <h5 className="truncate text-sm font-bold">{product.name || "未命名商品"}</h5>
                            <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${getAvailabilityClass(product.availability, darkMode)}`}>{getAvailabilityLabel(product.availability)}</span>
                          </div>
                          <p className={`mt-1 truncate text-xs ${mutedTextClassName}`} title={product.id}>
                            {product.code || "无商品编码"} · {placementCount} 个投放区块 · {product.id}
                          </p>
                        </div>
                        <p className="shrink-0 text-base font-black">{catalog.pricePrefix}{product.price || "—"}</p>
                      </div>
                      {product.description ? <p className={`mt-3 line-clamp-2 text-xs leading-5 ${mutedTextClassName}`}>{product.description}</p> : null}
                      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <select
                          value={product.availability}
                          onChange={(event) => void runMutation(`availability:${product.id}`, { action: "set_availability", productId: product.id, availability: event.target.value as MerchantCatalogAvailability }, `“${product.name || product.id}”已设为${getAvailabilityLabel(event.target.value as MerchantCatalogAvailability)}。`)}
                          disabled={Boolean(actingKey) || productImageUploading}
                          className={`rounded-xl border px-3 py-2 text-xs font-semibold outline-none ${inputClassName}`}
                          aria-label={`${product.name || product.id}的可售状态`}
                        >
                          {AVAILABILITY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                        </select>
                        <div className="flex gap-2">
                          <button type="button" onClick={() => beginEditProduct(product)} disabled={Boolean(actingKey) || productImageUploading} className={`inline-flex min-h-9 items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold transition disabled:opacity-50 ${secondaryButtonClassName}`}><EditIcon /> 编辑</button>
                          <button type="button" onClick={() => void confirmDeleteProduct(product)} disabled={Boolean(actingKey) || productImageUploading} className={`inline-flex min-h-9 items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold transition disabled:opacity-50 ${darkMode ? "border-rose-400/30 text-rose-200 hover:bg-rose-400/10" : "border-rose-200 bg-white text-rose-700 hover:bg-rose-50"}`}>
                            {isProductActing ? <RefreshIcon spinning /> : <TrashIcon />} 删除
                          </button>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <p className={`mt-4 rounded-xl border border-dashed px-4 py-10 text-center text-sm ${darkMode ? "border-slate-700" : "border-slate-200"} ${mutedTextClassName}`}>
                {catalog.products.length > 0 ? "没有匹配的商品" : "目录中还没有商品，可以直接在工作台新增"}
              </p>
            )}
          </section>

          <section className={`rounded-2xl border p-4 sm:p-5 ${surfaceClassName}`} aria-labelledby="catalog-categories-title">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h4 id="catalog-categories-title" className="text-sm font-bold sm:text-base">分类</h4>
                <p className={`mt-1 text-xs leading-5 ${mutedTextClassName}`}>分类属于经营数据；删除分类不会删除商品。可在编辑分类时选择包含的商品。</p>
              </div>
              <button type="button" onClick={() => { setCategoryDraft(createCategoryDraft()); setCategoryDraftIsNew(true); setCategoryDraftRevision(catalog.revision); }} disabled={Boolean(actingKey)} className={`inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-xl border px-4 py-2 text-sm font-bold transition disabled:opacity-50 ${secondaryButtonClassName}`}><PlusIcon /> 新增分类</button>
            </div>

            {categoryDraft ? (
              <form onSubmit={(event) => void submitCategory(event)} className={`mt-5 rounded-2xl border p-4 ${darkMode ? "border-sky-400/25 bg-sky-400/5" : "border-sky-200 bg-sky-50/50"}`}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h5 className="text-sm font-bold">{categoryDraftIsNew ? "新增分类" : `编辑：${categoryDraft.name}`}</h5>
                    <p className={`mt-1 text-xs ${mutedTextClassName}`}>分类 ID 创建后不可修改。</p>
                  </div>
                  <button type="button" onClick={() => setCategoryDraft(null)} className={`rounded-xl border px-3 py-2 text-xs font-semibold ${secondaryButtonClassName}`}>取消</button>
                </div>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <label className="text-xs font-semibold">分类 ID<input value={categoryDraft.id} readOnly disabled className={`mt-1.5 w-full rounded-xl border px-3 py-2.5 text-sm opacity-70 ${inputClassName}`} /></label>
                  <label className="text-xs font-semibold">分类名称 <span className="text-rose-500">*</span><input required value={categoryDraft.name} onChange={(event) => setCategoryDraft({ ...categoryDraft, name: event.target.value })} maxLength={100} className={`mt-1.5 w-full rounded-xl border px-3 py-2.5 text-sm outline-none ring-2 ring-transparent ${inputClassName}`} /></label>
                </div>
                <fieldset className="mt-4">
                  <legend className="text-xs font-semibold">包含的商品</legend>
                  {catalog.products.length > 0 ? (
                    <div className={`mt-2 grid max-h-48 gap-2 overflow-y-auto rounded-xl border p-3 sm:grid-cols-2 ${darkMode ? "border-slate-700 bg-slate-950/50" : "border-slate-200 bg-white"}`}>
                      {catalog.products.map((product) => {
                        const checked = categoryDraft.productIds.includes(product.id);
                        return (
                          <label key={product.id} className="flex cursor-pointer items-center gap-2 text-xs">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(event) => setCategoryDraft({
                                ...categoryDraft,
                                productIds: event.target.checked
                                  ? [...categoryDraft.productIds, product.id]
                                  : categoryDraft.productIds.filter((productId) => productId !== product.id),
                              })}
                              className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                            />
                            <span className="truncate">{product.name || product.id}</span>
                          </label>
                        );
                      })}
                    </div>
                  ) : <p className={`mt-2 text-xs ${mutedTextClassName}`}>暂无商品，可先创建空分类。</p>}
                </fieldset>
                <div className="mt-4 flex justify-end"><button type="submit" disabled={Boolean(actingKey)} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-sky-600 px-5 py-2 text-sm font-bold text-white transition hover:bg-sky-700 disabled:opacity-50">{actingKey.startsWith("category:") ? <RefreshIcon spinning /> : <CheckIcon />}{actingKey.startsWith("category:") ? "保存中" : "保存分类"}</button></div>
              </form>
            ) : null}

            {catalog.categories.length > 0 ? (
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {catalog.categories.map((category) => (
                  <article key={category.id} className={`rounded-xl border p-3 ${darkMode ? "border-slate-700 bg-slate-950/50" : "border-slate-100 bg-slate-50/70"}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0"><p className="truncate text-sm font-bold">{category.name}</p><p className={`mt-1 truncate text-[11px] ${mutedTextClassName}`} title={category.id}>{category.id}</p></div>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${darkMode ? "bg-slate-800 text-slate-300" : "bg-white text-slate-600"}`}>{category.productIds.length} 个商品</span>
                    </div>
                    <div className="mt-3 flex gap-2">
                      <button type="button" onClick={() => { setCategoryDraft({ ...category, productIds: [...category.productIds] }); setCategoryDraftIsNew(false); setCategoryDraftRevision(catalog.revision); }} disabled={Boolean(actingKey)} className={`inline-flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold ${secondaryButtonClassName}`}><EditIcon /> 编辑</button>
                      <button type="button" onClick={() => void confirmDeleteCategory(category)} disabled={Boolean(actingKey)} className={`inline-flex min-h-9 items-center justify-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold ${darkMode ? "border-rose-400/30 text-rose-200 hover:bg-rose-400/10" : "border-rose-200 bg-white text-rose-700 hover:bg-rose-50"}`}><TrashIcon /> 删除</button>
                    </div>
                  </article>
                ))}
              </div>
            ) : <p className={`mt-4 rounded-xl border border-dashed px-4 py-8 text-center text-sm ${darkMode ? "border-slate-700" : "border-slate-200"} ${mutedTextClassName}`}>还没有分类</p>}
          </section>
        </div>
      ) : null}
    </div>
  );
}
