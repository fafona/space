"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ChangeEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  getBlocksSnapshot,
  getPublishedBlocksSnapshot,
  loadBlocksFromStorage,
  loadPublishedBlocksFromStorage,
  recordPublishedVersion,
  saveBlocksToStorage,
  savePublishedBlocksToStorage,
  subscribeBlocksStore,
  subscribePublishedBlocksStore,
} from "@/data/blockStore";
import type { Block, MerchantCardTextLayoutConfig, MerchantCardTextRole, TypographyEditableProps } from "@/data/homeBlocks";
import {
  FEATURE_CATALOG,
  MERCHANT_SORT_RULES,
  PERMISSION_CATALOG,
  applyAlert,
  applyAudit,
  createAlertRecord,
  createApprovalRecord,
  createAuditRecord,
  createDefaultMerchantPermissionConfig,
  createDefaultMerchantSortConfig,
  createFeaturePackage,
  createHomeLayoutSection,
  createIndustryCategory,
  createPlanTemplate,
  createPageAsset,
  createPlatformUser,
  createRole,
  createSite,
  createTenant,
  loadPlatformState,
  nextIsoNow,
  PLAN_TEMPLATE_CATEGORY_OPTIONS,
  resolvePermissionsForUser,
  savePlatformState,
  subscribePlatformState,
  type ApprovalStatus,
  type ApprovalType,
  type FeatureKey,
  type HomeLayoutSection,
  type IndustryCategoryStatus,
  type MerchantConfigHistoryEntry,
  type MerchantConfigSnapshot,
  type PermissionKey,
  type PlanTemplate,
  type PlanTemplateCategory,
  type PlatformState,
  type PublishStatus,
  type Site,
  type MerchantSortConfig,
  type MerchantSortRule,
  type SiteStatus,
} from "@/data/platformControlStore";
import { SUPER_ADMIN_MESSAGES } from "@/constants/messages";
import { readPageViewDailyStats, readPublishEvents, readRemoteAnalyticsSummary, trackPublishEvent } from "@/lib/analytics";
import { parseMerchantIdRuleInput, sortMerchantIdRules, type MerchantIdRule } from "@/lib/merchantIdRules";
import {
  matchPlanTemplateCategory,
  PLAN_TEMPLATE_FILTER_OPTIONS,
  summarizePlanTemplateBlocks,
  type PlanTemplateFilterCategory,
} from "@/lib/planTemplates";
import {
  DEFAULT_PLAN_TEMPLATE_REPLACE_OPTIONS,
  applyPlanTemplateToBlocks,
  createDefaultPlanTemplateApplyScope,
  extractPlanTemplateCoverBackground,
  getPlanTemplateViewportOptions,
  hasPlanTemplateApplySelection,
  type PlanTemplateApplyScope,
  type PlanTemplateReplaceOptions,
} from "@/lib/planTemplateRuntime";
import {
  capturePlanTemplatePreviewAssets,
  PLAN_TEMPLATE_PREVIEW_VARIANT,
} from "@/lib/planTemplatePreviewCapture";
import { getBackgroundStyle } from "@/components/blocks/backgroundStyle";
import { buildMerchantFrontendHref, buildPlatformHomeHref, buildSiteStoreScope, PLATFORM_EDITOR_SCOPE } from "@/lib/siteRouting";
import { getPagePlanConfigFromBlocks } from "@/lib/pagePlans";
import {
  buildSuperAdminLoginHref,
  clearSuperAdminAuthenticated,
  isSuperAdminAuthenticated,
  syncSuperAdminAuthenticatedCookie,
} from "@/lib/superAdminAuth";
import { supabase } from "@/lib/supabase";
import { useHydrated } from "@/lib/useHydrated";

function fmt(iso: string | null) {
  if (!iso) return "-";
  const date = new Date(iso);
  return Number.isFinite(date.getTime()) ? date.toLocaleString("zh-CN", { hour12: false }) : iso;
}

function normalizeEmailValue(value: string | null | undefined) {
  return String(value ?? "").trim().toLowerCase();
}

function normalizeMerchantIdValue(value: string | null | undefined) {
  const normalized = String(value ?? "").trim();
  return /^\d+$/.test(normalized) ? normalized : "";
}

function getMerchantProfileName(site: Pick<Site, "merchantName"> | null | undefined) {
  return (site?.merchantName ?? "").trim();
}

type PlanTemplatePreviewOption = {
  planId: string;
  planName: string;
};

function getPlanTemplatePreviewOptions(rawBlocks: unknown): PlanTemplatePreviewOption[] {
  if (!Array.isArray(rawBlocks) || rawBlocks.length === 0) return [];
  try {
    return getPagePlanConfigFromBlocks(rawBlocks as Block[]).plans
      .map((plan, index) => {
        const planId = String(plan.id ?? "").trim();
        if (!planId) return null;
        const planName = String(plan.name ?? "").trim() || `方案${index + 1}`;
        return {
          planId,
          planName,
        };
      })
      .filter((item): item is PlanTemplatePreviewOption => !!item);
  } catch {
    return [];
  }
}

function buildBackendOnlySite(account: BackendMerchantAccount): Site {
  const timestamp = account.createdAt ?? nextIsoNow();
  return {
    id: `backend-${account.merchantId || account.email || "merchant"}`,
    tenantId: "backend-only",
    merchantName: "",
    domainPrefix: "",
    domainSuffix: "",
    contactAddress: "",
    contactName: "",
    contactPhone: "",
    contactEmail: account.email,
    name: "",
    domain: "",
    categoryId: "unlinked",
    category: "未建站",
    industry: "",
    status: "offline",
    publishedVersion: 0,
    lastPublishedAt: null,
    features: createFeaturePackage("basic"),
    location: {
      countryCode: "",
      country: "",
      provinceCode: "",
      province: "",
      city: "",
    },
    serviceExpiresAt: null,
    permissionConfig: createDefaultMerchantPermissionConfig(),
    merchantCardImageUrl: "",
    sortConfig: createDefaultMerchantSortConfig(),
    configHistory: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

async function fetchPublishedBlocksForTemplateCapture(siteId: string) {
  const normalizedSiteId = String(siteId ?? "").trim();
  if (!normalizedSiteId) return [] as Block[];
  try {
    const response = await fetch(`/api/site-published?siteId=${encodeURIComponent(normalizedSiteId)}`, {
      method: "GET",
      cache: "no-store",
    });
    if (response.ok) {
      const json = (await response.json().catch(() => null)) as { blocks?: unknown } | null;
      if (Array.isArray(json?.blocks) && json.blocks.length > 0) {
        return json.blocks as Block[];
      }
    }
  } catch {
    // Fallback to local published cache below.
  }
  const scoped = loadPublishedBlocksFromStorage([], buildSiteStoreScope(normalizedSiteId));
  if (scoped.length > 0) return scoped;
  return loadPublishedBlocksFromStorage([], normalizedSiteId);
}

function badgeClass(value: string) {
  if (["active", "online", "success", "approved"].includes(value)) {
    return "border-emerald-300 bg-emerald-50 text-emerald-700";
  }
  if (["pending", "maintenance", "warning"].includes(value)) {
    return "border-amber-300 bg-amber-50 text-amber-700";
  }
  if (["failed", "offline", "disabled", "suspended", "rejected", "critical"].includes(value)) {
    return "border-rose-300 bg-rose-50 text-rose-700";
  }
  return "border-slate-300 bg-slate-50 text-slate-700";
}

function describeBackendMerchantAccountsError(message: string) {
  if (!message) return "";
  if (message === "merchant_account_timeout") {
    return "后端注册账号接口超时，当前先显示本地站点用户。";
  }
  if (message === "merchant_account_load_failed") {
    return "后端注册账号接口暂时不可用，当前先显示本地站点用户。";
  }
  if (/merchant_account_http_401/i.test(message)) {
    return "后端注册账号接口未授权，请重新登录超级后台。";
  }
  if (/merchant_account_http_5\d{2}/i.test(message)) {
    return "后端注册账号接口暂时不可用，当前先显示本地站点用户。";
  }
  return message;
}

function merchantIdRuleTypeLabel(type: MerchantIdRule["type"]) {
  if (type === "exact") return "单个号码";
  if (type === "range") return "号段范围";
  return "通配规则";
}

function describeMerchantIdRuleExpression(rule: MerchantIdRule) {
  if (rule.type !== "pattern") return rule.expression;
  return `${rule.expression}（* 表示任意单个数字）`;
}

function publishStatusLabel(status: PublishStatus) {
  if (status === "success") return "发布成功";
  if (status === "failed") return "发布失败";
  return "回滚";
}

function approvalStatusLabel(status: ApprovalStatus) {
  if (status === "pending") return "待处理";
  if (status === "approved") return "已通过";
  return "已驳回";
}

function siteStatusLabel(status: SiteStatus) {
  if (status === "online") return "在线";
  if (status === "maintenance") return "维护中";
  return "离线";
}

function userStatusLabel(status: PlatformState["users"][number]["status"]) {
  if (status === "active") return "正常";
  return "已禁用";
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${Math.round(bytes)} B`;
}

function estimateUtf8Size(text: string) {
  if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(text).length;
  return text.length;
}

const MAX_MERCHANT_CARD_IMAGE_DATA_URL_BYTES = 900_000;
const MAX_PLATFORM_STATE_STORAGE_BYTES = 4_500_000;
const MERCHANT_CARD_IMAGE_MAX_SIDE = 1280;
const MERCHANT_CARD_IMAGE_MIN_SIDE = 160;
const MERCHANT_CARD_IMAGE_TARGET_BYTES = 240_000;
const TIP_AUTO_DISMISS_MS = 4200;
const STORAGE_SAFE_AUDIT_RECORDS = 500;
const STORAGE_SAFE_ALERT_RECORDS = 240;
const STORAGE_SAFE_APPROVAL_RECORDS = 300;
const STORAGE_SAFE_PUBLISH_RECORDS = 360;

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      if (!result) {
        reject(new Error("读取图片失败，请重试"));
        return;
      }
      resolve(result);
    };
    reader.onerror = () => reject(new Error("读取图片失败，请重试"));
    reader.readAsDataURL(file);
  });
}

function loadImageElement(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new window.Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("解析图片失败，请更换图片"));
    image.src = src;
  });
}

async function optimizeMerchantCardImage(file: File) {
  const original = await readFileAsDataUrl(file);
  if (!file.type.startsWith("image/")) {
    throw new Error("仅支持上传图片文件");
  }
  if (file.type === "image/svg+xml") {
    return original;
  }
  const image = await loadImageElement(original);
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error("图片尺寸异常，请更换图片");
  }
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("图片处理失败，请重试");

  const maxSide = Math.max(width, height);
  const initialSide = Math.min(MERCHANT_CARD_IMAGE_MAX_SIDE, Math.max(MERCHANT_CARD_IMAGE_MIN_SIDE, Math.round(maxSide)));
  const sideCandidates: number[] = [];
  let side = initialSide;
  while (side >= MERCHANT_CARD_IMAGE_MIN_SIDE) {
    if (!sideCandidates.includes(side)) sideCandidates.push(side);
    if (side === MERCHANT_CARD_IMAGE_MIN_SIDE) break;
    const next = Math.max(MERCHANT_CARD_IMAGE_MIN_SIDE, Math.round(side * 0.82));
    if (next === side) break;
    side = next;
  }
  if (!sideCandidates.includes(MERCHANT_CARD_IMAGE_MIN_SIDE)) sideCandidates.push(MERCHANT_CARD_IMAGE_MIN_SIDE);

  const outputCandidates: Array<{ type: "image/webp" | "image/jpeg"; quality: number[] }> = [
    { type: "image/webp", quality: [0.88, 0.8, 0.72, 0.64, 0.56, 0.48, 0.4, 0.32, 0.24, 0.18] },
    { type: "image/jpeg", quality: [0.86, 0.78, 0.7, 0.62, 0.54, 0.46, 0.38, 0.3, 0.22, 0.16] },
  ];

  let best = original;
  let bestBytes = estimateUtf8Size(original);
  let reachedTarget = bestBytes <= MERCHANT_CARD_IMAGE_TARGET_BYTES;

  for (const candidateSide of sideCandidates) {
    const scale = Math.min(1, candidateSide / maxSide);
    const targetWidth = Math.max(1, Math.round(width * scale));
    const targetHeight = Math.max(1, Math.round(height * scale));
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    ctx.clearRect(0, 0, targetWidth, targetHeight);
    ctx.drawImage(image, 0, 0, targetWidth, targetHeight);

    for (const format of outputCandidates) {
      for (const quality of format.quality) {
        const next = canvas.toDataURL(format.type, quality);
        if (!next || !next.startsWith("data:image/")) continue;
        const nextBytes = estimateUtf8Size(next);
        if (nextBytes < bestBytes) {
          best = next;
          bestBytes = nextBytes;
          reachedTarget = bestBytes <= MERCHANT_CARD_IMAGE_TARGET_BYTES;
        }
      }
    }

    if (reachedTarget && bestBytes <= MAX_MERCHANT_CARD_IMAGE_DATA_URL_BYTES) {
      break;
    }
  }

  return best;
}

function parseMerchantCardImageDataUrlMeta(dataUrl: string) {
  const matched = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,/i);
  if (!matched) return null;
  const mime = matched[1].toLowerCase();
  const extension = (() => {
    if (mime === "image/jpeg") return "jpg";
    if (mime === "image/png") return "png";
    if (mime === "image/webp") return "webp";
    if (mime === "image/gif") return "gif";
    if (mime === "image/bmp") return "bmp";
    if (mime === "image/svg+xml") return "svg";
    return "img";
  })();
  return { mime, extension };
}

function dataUrlToBlob(dataUrl: string, mime: string) {
  const base64 = dataUrl.split(",")[1] ?? "";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mime });
}

async function uploadMerchantCardImageDataUrlToSupabase(dataUrl: string, siteHint = "merchant-card") {
  const meta = parseMerchantCardImageDataUrlMeta(dataUrl);
  if (!meta) return null;
  const blob = dataUrlToBlob(dataUrl, meta.mime);
  const now = new Date();
  const yyyy = `${now.getFullYear()}`;
  const mm = `${now.getMonth() + 1}`.padStart(2, "0");
  const bucketCandidates = ["page-assets", "assets", "uploads", "public"];

  for (const bucket of bucketCandidates) {
    const objectPath = `merchant-cards/${siteHint}/${yyyy}/${mm}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${meta.extension}`;
    const uploaded = await supabase.storage.from(bucket).upload(objectPath, blob, {
      contentType: meta.mime,
      upsert: false,
    });
    if (uploaded.error) continue;
    const { data } = supabase.storage.from(bucket).getPublicUrl(objectPath);
    if (data?.publicUrl) return data.publicUrl;
  }
  return null;
}

function daysBetweenNow(isoDate: string, nowMs: number) {
  const at = new Date(isoDate).getTime();
  if (!Number.isFinite(at)) return Number.POSITIVE_INFINITY;
  return (nowMs - at) / 86400_000;
}

function parseDateInputToIso(value: string) {
  const raw = value.trim();
  if (!raw) return null;
  const at = new Date(`${raw}T00:00:00`).getTime();
  if (!Number.isFinite(at)) return null;
  return new Date(at).toISOString();
}

function isoToDateInput(iso: string | null | undefined) {
  if (!iso) return "";
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "";
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, "0");
  const d = `${date.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function rankInput(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? `${Math.max(1, Math.round(value))}` : "";
}

function parseRankInput(value: string) {
  const raw = value.trim();
  if (!raw) return null;
  const num = Number(raw);
  if (!Number.isFinite(num)) return null;
  return Math.max(1, Math.round(num));
}

function isGradientToken(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return false;
  return /^(linear-gradient|radial-gradient|conic-gradient)\(/i.test(trimmed);
}

function buildTypographyInlineStyle(style: TypographyEditableProps | undefined): Record<string, string | number> {
  const result: Record<string, string | number> = {};
  const fontFamily = (style?.fontFamily ?? "").trim();
  const fontColor = (style?.fontColor ?? "").trim();
  if (fontFamily) result.fontFamily = fontFamily;
  if (typeof style?.fontSize === "number" && Number.isFinite(style.fontSize) && style.fontSize > 0) {
    result.fontSize = Math.max(8, Math.min(120, style.fontSize));
  }
  if (style?.fontWeight) result.fontWeight = style.fontWeight;
  if (style?.fontStyle) result.fontStyle = style.fontStyle;
  if (style?.textDecoration) result.textDecoration = style.textDecoration;
  if (fontColor) {
    if (isGradientToken(fontColor)) {
      result.backgroundImage = fontColor;
      result.backgroundClip = "text";
      result.WebkitBackgroundClip = "text";
      result.color = "transparent";
    } else {
      result.color = fontColor;
    }
  }
  return result;
}

const DEFAULT_MERCHANT_CARD_TEXT_LAYOUT: Record<MerchantCardTextRole, { x: number; y: number }> = {
  name: { x: 0, y: 0 },
  industry: { x: 0, y: 30 },
  domain: { x: 0, y: 52 },
};

function resolveMerchantCardTextPosition(layout: MerchantCardTextLayoutConfig | undefined, role: MerchantCardTextRole) {
  const fallback = DEFAULT_MERCHANT_CARD_TEXT_LAYOUT[role];
  const current = layout?.[role] ?? {};
  const x = typeof current.x === "number" && Number.isFinite(current.x) ? Math.max(0, Math.round(current.x)) : fallback.x;
  const y = typeof current.y === "number" && Number.isFinite(current.y) ? Math.max(0, Math.round(current.y)) : fallback.y;
  return { x, y };
}

type MerchantListPreviewProps = {
  merchantCardTypography?: Partial<Record<MerchantCardTextRole, TypographyEditableProps>>;
  merchantCardTextLayout?: MerchantCardTextLayoutConfig;
  merchantCardTextBoxVisible?: boolean;
};

function pickMerchantListBlock(blocks: Block[]) {
  if (!Array.isArray(blocks) || blocks.length === 0) return null;
  const planConfig = getPagePlanConfigFromBlocks(blocks);
  const activePlan = planConfig.plans.find((plan) => plan.id === planConfig.activePlanId) ?? planConfig.plans[0];
  const activePage =
    activePlan?.pages?.find((page) => page.id === activePlan.activePageId) ?? activePlan?.pages?.[0];
  const pageBlocks = activePage?.blocks ?? activePlan?.blocks ?? blocks;
  const fromActivePage = pageBlocks.find((item) => item.type === "merchant-list");
  if (fromActivePage) return fromActivePage;
  for (const plan of planConfig.plans) {
    const direct = plan.blocks.find((item) => item.type === "merchant-list");
    if (direct) return direct;
    for (const page of plan.pages) {
      const found = page.blocks.find((item) => item.type === "merchant-list");
      if (found) return found;
    }
  }
  return blocks.find((item) => item.type === "merchant-list") ?? null;
}

type MerchantVisits = { today: number; day7: number; day30: number; total: number };

function readMerchantPublishedBytes(siteId: string) {
  if (typeof window === "undefined") return 0;
  const scopedKey = `merchant-space:homeBlocks:published:v1:${buildSiteStoreScope(siteId)}`;
  const fallbackKey = "merchant-space:homeBlocks:published:v1";
  const raw = localStorage.getItem(scopedKey) ?? (siteId === "site-main" ? localStorage.getItem(fallbackKey) : null);
  if (!raw) return 0;
  return estimateUtf8Size(raw);
}

function readMerchantVisits(siteId: string, nowMs: number): MerchantVisits {
  const all = readPageViewDailyStats();
  const prefix = `site:${siteId}:`;
  let today = 0;
  let day7 = 0;
  let day30 = 0;
  let total = 0;

  Object.entries(all).forEach(([bucket, stats]) => {
    if (!bucket.startsWith(prefix)) return;
    Object.entries(stats).forEach(([day, value]) => {
      const count = typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
      if (count <= 0) return;
      total += count;
      const diff = daysBetweenNow(day, nowMs);
      if (diff < 1) today += count;
      if (diff < 7) day7 += count;
      if (diff < 30) day30 += count;
    });
  });

  return { today, day7, day30, total };
}

const splitTags = (raw: string) =>
  raw
    .split(/[,\s，]+/)
    .map((item) => item.trim())
    .filter(Boolean);
const EMPTY_BLOCKS: Block[] = [];
const RELEASE_REGRESSION_CHECKLIST = [
  { id: "new-user-nav-tip", label: "新用户后台默认仅导航区块，并展示“在此处增加区块”引导" },
  { id: "merchant-info-guard", label: "未填商户信息时不能去前台，商户信息按钮有高亮/抖动提示" },
  { id: "merchant-card-preview-sync", label: "配置中的商户框预览文字样式/排布与超级后台对应区块一致" },
  { id: "contact-font-sync", label: "联系方式区块字体样式前后台一致（含固定前缀）" },
  { id: "manual-rank-fallback", label: "排序数字生效；同排名时按默认排序规则决定先后" },
] as const;
const MAX_MERCHANT_CONFIG_HISTORY = 30;
const INLINE_IMAGE_HISTORY_PLACEHOLDER = "__inline_image_omitted__";
const SORT_PREVIEW_FILTER_LABELS = {
  all: "全部",
  country: "同国家",
  province: "同省",
  city: "同城",
} as const;
const RELEASE_CHECKLIST_STORAGE_KEY_PREFIX = "merchant-space:release-checklist:v1";
const MERCHANT_USER_PAGE_SIZE_DEFAULT = 20;
type SortPreviewScope = "recommended" | "industry";
type SortPreviewLevel = "country" | "province" | "city" | null;
type SortPreviewFilter = "all" | "country" | "province" | "city";

function createEmptyReleaseChecklistState() {
  return RELEASE_REGRESSION_CHECKLIST.reduce<Record<string, boolean>>((acc, item) => {
    acc[item.id] = false;
    return acc;
  }, {});
}

function normalizeReleaseChecklistState(value: unknown) {
  const base = createEmptyReleaseChecklistState();
  if (!value || typeof value !== "object") return base;
  const record = value as Record<string, unknown>;
  RELEASE_REGRESSION_CHECKLIST.forEach((item) => {
    base[item.id] = record[item.id] === true;
  });
  return base;
}

function releaseChecklistStorageKeyForToday(date = new Date()) {
  const yyyy = String(date.getFullYear());
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${RELEASE_CHECKLIST_STORAGE_KEY_PREFIX}:${yyyy}-${mm}-${dd}`;
}

function loadReleaseChecklistStateFromStorage() {
  if (typeof window === "undefined") return createEmptyReleaseChecklistState();
  try {
    const raw = window.localStorage.getItem(releaseChecklistStorageKeyForToday());
    if (!raw) return createEmptyReleaseChecklistState();
    return normalizeReleaseChecklistState(JSON.parse(raw));
  } catch {
    return createEmptyReleaseChecklistState();
  }
}

function createMerchantConfigSnapshot(site: Site): MerchantConfigSnapshot {
  return {
    serviceExpiresAt: site.serviceExpiresAt ?? null,
    permissionConfig: site.permissionConfig ?? createDefaultMerchantPermissionConfig(),
    merchantCardImageUrl: (site.merchantCardImageUrl ?? "").trim(),
    sortConfig: site.sortConfig ?? createDefaultMerchantSortConfig(),
  };
}

function compactSnapshotForHistory(snapshot: MerchantConfigSnapshot): MerchantConfigSnapshot {
  const image = (snapshot.merchantCardImageUrl ?? "").trim();
  const compactImage = /^data:image\//i.test(image) ? INLINE_IMAGE_HISTORY_PLACEHOLDER : image;
  return {
    ...snapshot,
    merchantCardImageUrl: compactImage,
  };
}

function compactMerchantConfigHistory(history: MerchantConfigHistoryEntry[] | undefined): MerchantConfigHistoryEntry[] {
  if (!Array.isArray(history) || history.length === 0) return [];
  return history
    .map((item) => ({
      ...item,
      before: compactSnapshotForHistory(item.before),
      after: compactSnapshotForHistory(item.after),
    }))
    .slice(0, MAX_MERCHANT_CONFIG_HISTORY);
}

function compactSitesForStorage(sites: Site[]): Site[] {
  return sites.map((site) => ({
    ...site,
    merchantCardImageUrl: compactMerchantCardImageForStorage(site.merchantCardImageUrl),
    configHistory: compactMerchantConfigHistory(site.configHistory),
  }));
}

function isInlineImageHistoryPlaceholder(value: string | null | undefined) {
  return (value ?? "").trim() === INLINE_IMAGE_HISTORY_PLACEHOLDER;
}

function compactMerchantCardImageForStorage(value: string | null | undefined) {
  const image = (value ?? "").trim();
  if (!image) return "";
  if (!/^data:image\//i.test(image)) return image;
  return estimateUtf8Size(image) <= MAX_MERCHANT_CARD_IMAGE_DATA_URL_BYTES ? image : "";
}

function compactPlatformStateForStorage(state: PlatformState): PlatformState {
  return {
    ...state,
    sites: compactSitesForStorage(state.sites),
    audits: state.audits.slice(0, STORAGE_SAFE_AUDIT_RECORDS),
    alerts: state.alerts.slice(0, STORAGE_SAFE_ALERT_RECORDS),
    approvals: state.approvals.slice(0, STORAGE_SAFE_APPROVAL_RECORDS),
    publishRecords: state.publishRecords.slice(0, STORAGE_SAFE_PUBLISH_RECORDS),
  };
}

function appendMerchantConfigHistory(
  history: MerchantConfigHistoryEntry[] | undefined,
  entry: MerchantConfigHistoryEntry,
) {
  return [entry, ...compactMerchantConfigHistory(history)].slice(0, MAX_MERCHANT_CONFIG_HISTORY);
}

function resolveSortPreviewLevel(site: Site): SortPreviewLevel {
  if ((site.location?.city ?? "").trim()) return "city";
  if ((site.location?.provinceCode ?? "").trim() || (site.location?.province ?? "").trim()) return "province";
  if ((site.location?.countryCode ?? "").trim() || (site.location?.country ?? "").trim()) return "country";
  return null;
}

function getManualRankValue(
  sortConfig: MerchantSortConfig,
  scope: SortPreviewScope,
  level: SortPreviewLevel,
) {
  if (!level) return null;
  const value =
    scope === "recommended"
      ? level === "country"
        ? sortConfig.recommendedCountryRank
        : level === "province"
          ? sortConfig.recommendedProvinceRank
          : sortConfig.recommendedCityRank
      : level === "country"
        ? sortConfig.industryCountryRank
        : level === "province"
          ? sortConfig.industryProvinceRank
          : sortConfig.industryCityRank;
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.max(1, Math.round(value));
}

function compareByMerchantDefaultRule(
  left: Site,
  right: Site,
  sortRule: MerchantSortRule,
  visit30BySiteId: Map<string, number>,
) {
  const leftName = ((left.merchantName ?? "").trim() || left.name).trim();
  const rightName = ((right.merchantName ?? "").trim() || right.name).trim();
  if (sortRule === "name_asc") {
    const byName = leftName.localeCompare(rightName, "zh-CN");
    if (byName !== 0) return byName;
  } else if (sortRule === "name_desc") {
    const byName = rightName.localeCompare(leftName, "zh-CN");
    if (byName !== 0) return byName;
  } else if (sortRule === "created_asc") {
    const byCreated = new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
    if (byCreated !== 0) return byCreated;
  } else if (sortRule === "monthly_views_desc") {
    const byViews = (visit30BySiteId.get(right.id) ?? 0) - (visit30BySiteId.get(left.id) ?? 0);
    if (byViews !== 0) return byViews;
  } else {
    const byCreated = new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
    if (byCreated !== 0) return byCreated;
  }
  const fallbackCreated = new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
  if (fallbackCreated !== 0) return fallbackCreated;
  return leftName.localeCompare(rightName, "zh-CN");
}

function getSiteDisplayName(site: Site) {
  return ((site.merchantName ?? "").trim() || site.name || "").trim();
}

function normalizeSortPreviewLocationKey(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase();
}

function matchSortPreviewFilter(site: Site, selectedSite: Site, filter: SortPreviewFilter) {
  if (filter === "all") return true;
  const selectedCountry = normalizeSortPreviewLocationKey(
    selectedSite.location.countryCode || selectedSite.location.country,
  );
  const selectedProvince = normalizeSortPreviewLocationKey(
    selectedSite.location.provinceCode || selectedSite.location.province,
  );
  const selectedCity = normalizeSortPreviewLocationKey(selectedSite.location.city);
  const siteCountry = normalizeSortPreviewLocationKey(site.location.countryCode || site.location.country);
  const siteProvince = normalizeSortPreviewLocationKey(site.location.provinceCode || site.location.province);
  const siteCity = normalizeSortPreviewLocationKey(site.location.city);
  if (filter === "country") return !!selectedCountry && selectedCountry === siteCountry;
  if (filter === "province") return !!selectedProvince && selectedProvince === siteProvince;
  return !!selectedCity && selectedCity === siteCity;
}

function describePermissionValue(
  key: keyof MerchantConfigSnapshot["permissionConfig"],
  value: MerchantConfigSnapshot["permissionConfig"][keyof MerchantConfigSnapshot["permissionConfig"]],
) {
  if (
    key === "allowInsertBackground" ||
    key === "allowThemeEffects" ||
    key === "allowButtonBlock" ||
    key === "allowGalleryBlock" ||
    key === "allowMusicBlock" ||
    key === "allowProductBlock" ||
    key === "allowBookingBlock"
  ) {
    return value === true ? "是" : "否";
  }
  return `${value ?? "-"}`;
}

function describeSortRankValue(value: number | null) {
  return typeof value === "number" && Number.isFinite(value) ? `${Math.max(1, Math.round(value))}` : "默认规则";
}

function buildMerchantConfigDiffLines(current: MerchantConfigSnapshot, target: MerchantConfigSnapshot) {
  const lines: string[] = [];
  if ((current.serviceExpiresAt ?? null) !== (target.serviceExpiresAt ?? null)) {
    lines.push(`到期时间：${fmt(current.serviceExpiresAt)} -> ${fmt(target.serviceExpiresAt)}`);
  }
  if ((current.merchantCardImageUrl ?? "").trim() !== (target.merchantCardImageUrl ?? "").trim()) {
    const fromLabel = (current.merchantCardImageUrl ?? "").trim() ? "已配置" : "未配置";
    const toLabel = (target.merchantCardImageUrl ?? "").trim() ? "已配置" : "未配置";
    lines.push(`商户卡图片：${fromLabel} -> ${toLabel}`);
  }
  const permissionFields: Array<{
    key: keyof MerchantConfigSnapshot["permissionConfig"];
    label: string;
  }> = [
    { key: "planLimit", label: "方案上限" },
    { key: "pageLimit", label: "页面上限" },
    { key: "publishSizeLimitMb", label: "发布体积上限(MB)" },
    { key: "allowInsertBackground", label: "可插入背景" },
    { key: "allowThemeEffects", label: "可主题效果" },
    { key: "allowButtonBlock", label: "可按钮区块" },
    { key: "allowGalleryBlock", label: "可相册区块" },
    { key: "allowMusicBlock", label: "可音乐区块" },
    { key: "allowProductBlock", label: "可产品区块" },
    { key: "allowBookingBlock", label: "可预约区块" },
  ];
  permissionFields.forEach(({ key, label }) => {
    const fromValue = current.permissionConfig[key];
    const toValue = target.permissionConfig[key];
    if (fromValue === toValue) return;
    lines.push(`权限-${label}：${describePermissionValue(key, fromValue)} -> ${describePermissionValue(key, toValue)}`);
  });
  const sortFields: Array<{ key: keyof MerchantSortConfig; label: string }> = [
    { key: "recommendedCountryRank", label: "推荐-国家排序" },
    { key: "recommendedProvinceRank", label: "推荐-省排序" },
    { key: "recommendedCityRank", label: "推荐-城市排序" },
    { key: "industryCountryRank", label: "行业-国家排序" },
    { key: "industryProvinceRank", label: "行业-省排序" },
    { key: "industryCityRank", label: "行业-城市排序" },
  ];
  sortFields.forEach(({ key, label }) => {
    const fromValue = current.sortConfig[key];
    const toValue = target.sortConfig[key];
    if (fromValue === toValue) return;
    lines.push(`排序-${label}：${describeSortRankValue(fromValue)} -> ${describeSortRankValue(toValue)}`);
  });
  return lines;
}

function buildMerchantConfigHistoryEntry(input: {
  operator: string;
  summary: string;
  before: MerchantConfigSnapshot;
  after: MerchantConfigSnapshot;
}): MerchantConfigHistoryEntry {
  return {
    id: `merchant-config-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    at: nextIsoNow(),
    operator: input.operator,
    summary: input.summary.trim() || "配置更新",
    before: compactSnapshotForHistory(input.before),
    after: compactSnapshotForHistory(input.after),
  };
}

type PortalDraft = {
  heroTitle: string;
  heroSubtitle: string;
  sections: HomeLayoutSection[];
};

type MerchantUserRow = {
  site: Site;
  hasSite: boolean;
  backendAccount: BackendMerchantAccount | null;
  merchantId: string;
  loginAccount: string;
  userEmail: string;
  merchantName: string;
  prefix: string;
  industry: string;
  city: string;
  sizeBytes: number;
  visits: MerchantVisits;
  registerAt: string;
  expireAt: string | null;
  expired: boolean;
  statusLabel: "正常" | "暂停" | "未建站";
  statusKey: "active" | "paused" | "unlinked";
};

type MerchantSiteContext = {
  site: Site;
  userEmail: string;
  prefix: string;
  industry: string;
  city: string;
  sizeBytes: number;
  visits: MerchantVisits;
  expireAt: string | null;
  expired: boolean;
  statusKey: "active" | "paused";
  statusLabel: "正常" | "暂停";
};

type BackendMerchantAccount = {
  merchantId: string;
  merchantName: string;
  email: string;
  username: string;
  loginId: string;
  createdAt: string | null;
  authUserId: string | null;
  emailConfirmed: boolean;
  emailConfirmedAt: string | null;
  lastSignInAt: string | null;
  manualCreated: boolean;
};

type MerchantTableSortField =
  | "seq"
  | "user"
  | "id"
  | "name"
  | "prefix"
  | "industry"
  | "city"
  | "size"
  | "monthlyViews"
  | "registerAt"
  | "expireAt"
  | "status";

function sortPlanTemplatesByUpdatedAt(planTemplates: PlanTemplate[]) {
  return [...planTemplates].sort((left, right) => {
    const leftTime = new Date(left.updatedAt).getTime();
    const rightTime = new Date(right.updatedAt).getTime();
    return (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0);
  });
}

function buildPortalDraft(state: PlatformState): PortalDraft {
  return {
    heroTitle: state.homeLayout.heroTitle,
    heroSubtitle: state.homeLayout.heroSubtitle,
    sections: [...state.homeLayout.sections].sort((a, b) => a.sortOrder - b.sortOrder),
  };
}

export default function SuperAdminClient() {
  const hydrated = useHydrated();
  useEffect(() => {
    if (!hydrated) return;
    syncSuperAdminAuthenticatedCookie();
  }, [hydrated]);
  const authed = hydrated && isSuperAdminAuthenticated();
  const [activeMenu, setActiveMenu] = useState<"site_editor" | "user_manage" | "merchant_id_rules" | "stats" | "logs">("site_editor");
  const [state, setState] = useState<PlatformState>(() => loadPlatformState());
  const stateRef = useRef<PlatformState>(state);
  const [tip, setTip] = useState("");
  const [capturingTemplateSiteId, setCapturingTemplateSiteId] = useState("");
  const [planTemplateDialogOpen, setPlanTemplateDialogOpen] = useState(false);
  const [planTemplateTargetSiteId, setPlanTemplateTargetSiteId] = useState("");
  const [planTemplateSearch, setPlanTemplateSearch] = useState("");
  const [planTemplateFilter, setPlanTemplateFilter] = useState<PlanTemplateFilterCategory>("全部");
  const [planTemplateNameDrafts, setPlanTemplateNameDrafts] = useState<Record<string, string>>({});
  const [planTemplateCoverPreview, setPlanTemplateCoverPreview] = useState<{ url: string; name: string } | null>(null);
  const [planTemplateCoverPreviewScale, setPlanTemplateCoverPreviewScale] = useState(1);
  const [planTemplateApplyDialog, setPlanTemplateApplyDialog] = useState<{ templateId: string } | null>(null);
  const [planTemplateApplyScope, setPlanTemplateApplyScope] = useState<PlanTemplateApplyScope>(() =>
    createDefaultPlanTemplateApplyScope([]),
  );
  const [planTemplateReplaceOptions, setPlanTemplateReplaceOptions] = useState<PlanTemplateReplaceOptions>(
    DEFAULT_PLAN_TEMPLATE_REPLACE_OPTIONS,
  );
  const [applyingPlanTemplateKey, setApplyingPlanTemplateKey] = useState("");
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [remotePv30, setRemotePv30] = useState<number | null>(null);

  const [tenantName, setTenantName] = useState("");
  const [tenantOwner, setTenantOwner] = useState("");
  const [siteTenantId, setSiteTenantId] = useState("");
  const [siteName, setSiteName] = useState("");
  const [siteDomain, setSiteDomain] = useState("");
  const [siteCategoryId, setSiteCategoryId] = useState("");

  const [categoryName, setCategoryName] = useState("");
  const [categorySlug, setCategorySlug] = useState("");
  const [categoryDescription, setCategoryDescription] = useState("");
  const [portalDraft, setPortalDraft] = useState<PortalDraft>(() => buildPortalDraft(loadPlatformState()));
  const [selectedPortalSectionId, setSelectedPortalSectionId] = useState("");
  const [portalDirty, setPortalDirty] = useState(false);
  const portalDirtyRef = useRef(false);

  const [userName, setUserName] = useState("");
  const [userEmail, setUserEmail] = useState("");
  const [userRoleId, setUserRoleId] = useState("");
  const [roleName, setRoleName] = useState("");
  const [rolePermissions, setRolePermissions] = useState<PermissionKey[]>(["dashboard.view"]);

  const [featureSiteId, setFeatureSiteId] = useState("");
  const [assetSiteId, setAssetSiteId] = useState("");
  const [assetPath, setAssetPath] = useState("");
  const [assetGroup, setAssetGroup] = useState("");
  const [assetTags, setAssetTags] = useState("");

  const [publishSiteId, setPublishSiteId] = useState("");
  const [publishNote, setPublishNote] = useState("");
  const [approvalFilter, setApprovalFilter] = useState<ApprovalStatus | "all">("pending");
  const [userKeyword, setUserKeyword] = useState("");
  const [merchantDetailSiteId, setMerchantDetailSiteId] = useState("");
  const [userPanelMode, setUserPanelMode] = useState<"detail" | "config">("detail");
  const [configExpireDate, setConfigExpireDate] = useState("");
  const [configPlanLimit, setConfigPlanLimit] = useState("1");
  const [configPageLimit, setConfigPageLimit] = useState("3");
  const [configPublishLimitMb, setConfigPublishLimitMb] = useState("5");
  const [configAllowInsertBackground, setConfigAllowInsertBackground] = useState(false);
  const [configAllowThemeEffects, setConfigAllowThemeEffects] = useState(false);
  const [configAllowButtonBlock, setConfigAllowButtonBlock] = useState(false);
  const [configAllowGalleryBlock, setConfigAllowGalleryBlock] = useState(false);
  const [configAllowMusicBlock, setConfigAllowMusicBlock] = useState(false);
  const [configAllowProductBlock, setConfigAllowProductBlock] = useState(false);
  const [configAllowBookingBlock, setConfigAllowBookingBlock] = useState(false);
  const [configMerchantCardImage, setConfigMerchantCardImage] = useState("");
  const [configRecommendedCountryRank, setConfigRecommendedCountryRank] = useState("");
  const [configRecommendedProvinceRank, setConfigRecommendedProvinceRank] = useState("");
  const [configRecommendedCityRank, setConfigRecommendedCityRank] = useState("");
  const [configIndustryCountryRank, setConfigIndustryCountryRank] = useState("");
  const [configIndustryProvinceRank, setConfigIndustryProvinceRank] = useState("");
  const [configIndustryCityRank, setConfigIndustryCityRank] = useState("");
  const [configCardPreviewWidth, setConfigCardPreviewWidth] = useState("280");
  const [configCardPreviewHeight, setConfigCardPreviewHeight] = useState("150");
  const [sortPreviewFilter, setSortPreviewFilter] = useState<SortPreviewFilter>("all");
  const [merchantTableSortField, setMerchantTableSortField] = useState<MerchantTableSortField>("seq");
  const [merchantTableSortOrder, setMerchantTableSortOrder] = useState<"asc" | "desc">("asc");
  const [merchantTablePage, setMerchantTablePage] = useState(1);
  const [merchantPanelOpen, setMerchantPanelOpen] = useState(false);
  const [backendMerchantAccounts, setBackendMerchantAccounts] = useState<BackendMerchantAccount[]>([]);
  const [backendMerchantAccountsLoading, setBackendMerchantAccountsLoading] = useState(false);
  const [backendMerchantAccountsError, setBackendMerchantAccountsError] = useState("");
  const [manualUserDialogOpen, setManualUserDialogOpen] = useState(false);
  const [manualUserId, setManualUserId] = useState("");
  const [manualUserName, setManualUserName] = useState("");
  const [manualUserPassword, setManualUserPassword] = useState("");
  const [manualUserSubmitting, setManualUserSubmitting] = useState(false);
  const [manualUserError, setManualUserError] = useState("");
  const [merchantIdRules, setMerchantIdRules] = useState<MerchantIdRule[]>([]);
  const [merchantIdRulesLoading, setMerchantIdRulesLoading] = useState(false);
  const [merchantIdRulesError, setMerchantIdRulesError] = useState("");
  const [merchantIdRuleInput, setMerchantIdRuleInput] = useState("");
  const [merchantIdRuleNote, setMerchantIdRuleNote] = useState("");
  const [merchantIdRuleSubmitting, setMerchantIdRuleSubmitting] = useState(false);
  const [merchantIdRuleDeletingId, setMerchantIdRuleDeletingId] = useState("");
  const checklistStorageKeyRef = useRef(releaseChecklistStorageKeyForToday());
  const [releaseChecklistState, setReleaseChecklistState] = useState<Record<string, boolean>>(() =>
    loadReleaseChecklistStateFromStorage(),
  );

  useEffect(() => {
    setPlanTemplateCoverPreviewScale(1);
  }, [planTemplateCoverPreview?.url]);

  function renderTopMostOverlay(content: ReactNode) {
    if (typeof document === "undefined") return null;
    return createPortal(content, document.body);
  }
  const portalDraftBlocks = useSyncExternalStore(
    (onChange) => subscribeBlocksStore(onChange, PLATFORM_EDITOR_SCOPE),
    () => getBlocksSnapshot(EMPTY_BLOCKS, PLATFORM_EDITOR_SCOPE),
    () => EMPTY_BLOCKS,
  );
  const portalPublishedBlocks = useSyncExternalStore(
    (onChange) => subscribePublishedBlocksStore(onChange, PLATFORM_EDITOR_SCOPE),
    () => getPublishedBlocksSnapshot(EMPTY_BLOCKS, PLATFORM_EDITOR_SCOPE),
    () => EMPTY_BLOCKS,
  );

  useEffect(
    () =>
      subscribePlatformState(() => {
        const next = loadPlatformState();
        stateRef.current = next;
        setState(next);
        if (!portalDirtyRef.current) {
          setPortalDraft(buildPortalDraft(next));
        }
        setNowMs(Date.now());
      }),
    [],
  );

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    if (!hydrated) return;
    if (!authed) {
      const next = `${window.location.pathname}${window.location.search}`;
      window.location.href = buildSuperAdminLoginHref(next);
    }
  }, [authed, hydrated]);

  useEffect(() => {
    if (!hydrated || !authed) return;
    let cancelled = false;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 8000);
    setBackendMerchantAccountsLoading(true);
    setBackendMerchantAccountsError("");
    fetch("/api/super-admin/merchant-accounts", {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`merchant_account_http_${response.status}`);
        }
        const payload = (await response.json()) as { items?: BackendMerchantAccount[] };
        if (cancelled) return;
        setBackendMerchantAccounts(Array.isArray(payload.items) ? payload.items : []);
      })
      .catch((error) => {
        if (cancelled) return;
        setBackendMerchantAccounts([]);
        if (error instanceof DOMException && error.name === "AbortError") {
          setBackendMerchantAccountsError("merchant_account_timeout");
          return;
        }
        setBackendMerchantAccountsError(error instanceof Error ? error.message : "merchant_account_load_failed");
      })
      .finally(() => {
        if (!cancelled) setBackendMerchantAccountsLoading(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [authed, hydrated]);

  useEffect(() => {
    if (!hydrated || !authed) return;
    let cancelled = false;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 8000);
    setMerchantIdRulesLoading(true);
    setMerchantIdRulesError("");
    fetch("/api/super-admin/merchant-id-rules", {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`merchant_id_rule_http_${response.status}`);
        }
        const payload = (await response.json()) as { rules?: MerchantIdRule[] };
        if (cancelled) return;
        setMerchantIdRules(Array.isArray(payload.rules) ? sortMerchantIdRules(payload.rules) : []);
      })
      .catch((error) => {
        if (cancelled) return;
        setMerchantIdRules([]);
        if (error instanceof DOMException && error.name === "AbortError") {
          setMerchantIdRulesError("merchant_id_rule_timeout");
          return;
        }
        setMerchantIdRulesError(error instanceof Error ? error.message : "merchant_id_rule_load_failed");
      })
      .finally(() => {
        if (!cancelled) setMerchantIdRulesLoading(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [authed, hydrated]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(checklistStorageKeyRef.current, JSON.stringify(releaseChecklistState));
    } catch {
      // Ignore quota/private mode failures.
    }
  }, [releaseChecklistState]);

  useEffect(() => {
    portalDirtyRef.current = portalDirty;
  }, [portalDirty]);

  useEffect(() => {
    void readRemoteAnalyticsSummary(30)
      .then((summary) => setRemotePv30(summary?.pageView30d ?? null))
      .catch(() => setRemotePv30(null));
  }, []);

  useEffect(() => {
    if (!tip) return;
    const timer = window.setTimeout(() => setTip(""), TIP_AUTO_DISMISS_MS);
    return () => window.clearTimeout(timer);
  }, [tip]);

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const activeOperatorId = state.users[0]?.id || "";
  const activeSiteTenantId = siteTenantId || state.tenants[0]?.id || "";
  const activeSiteCategoryId =
    siteCategoryId || state.industryCategories.find((item) => item.status === "active")?.id || "";
  const activeUserRoleId = userRoleId || state.roles[0]?.id || "";
  const activeFeatureSiteId = featureSiteId || state.sites[0]?.id || "";
  const activeAssetSiteId = assetSiteId || state.sites[0]?.id || "";
  const activePublishSiteId = publishSiteId || state.sites[0]?.id || "";

  const operator = state.users.find((item) => item.id === activeOperatorId) ?? null;
  const operatorName = operator?.name ?? "未知操作人";
  const permissions = useMemo(
    () => new Set(resolvePermissionsForUser(state, activeOperatorId)),
    [activeOperatorId, state],
  );
  const hasPermission = (permission: PermissionKey) => permissions.has(permission);

  const tenantMap = useMemo(
    () => new Map(state.tenants.map((item) => [item.id, item.name])),
    [state.tenants],
  );
  const categoryMap = useMemo(
    () => new Map(state.industryCategories.map((item) => [item.id, item.name])),
    [state.industryCategories],
  );
  const sortedCategories = useMemo(
    () => [...state.industryCategories].sort((a, b) => a.sortOrder - b.sortOrder),
    [state.industryCategories],
  );
  const siteMap = useMemo(
    () => new Map(state.sites.map((item) => [item.id, item.name])),
    [state.sites],
  );
  const selectedPublishSite =
    state.sites.find((item) => item.id === activePublishSiteId) ?? null;
  const selectedFeatureSite =
    state.sites.find((item) => item.id === activeFeatureSiteId) ?? null;
  const merchantOwnerBySiteId = useMemo(() => {
    const map = new Map<string, PlatformState["users"][number]>();
    state.users.forEach((user) => {
      user.siteIds.forEach((siteId) => {
        if (!map.has(siteId)) map.set(siteId, user);
      });
    });
    return map;
  }, [state.users]);
  const merchantRows = useMemo(() => {
    const siteContextByEmail = new Map<string, MerchantSiteContext>();
    state.sites
      .filter((site) => site.id !== "site-main")
      .forEach((site) => {
        const owner = merchantOwnerBySiteId.get(site.id);
        const userEmail = (site.contactEmail ?? "").trim() || owner?.email || "";
        const emailKey = normalizeEmailValue(userEmail);
        if (!emailKey) return;
        const prefix = (site.domainPrefix ?? site.domainSuffix ?? "").trim();
        const industry = (site.industry ?? "").trim() || "未设置";
        const city = (site.location?.city ?? "").trim() || "-";
        const sizeBytes = readMerchantPublishedBytes(site.id);
        const visits = readMerchantVisits(site.id, nowMs);
        const expireAt = site.serviceExpiresAt ?? null;
        const expired = !!expireAt && Number.isFinite(new Date(expireAt).getTime()) && new Date(expireAt).getTime() <= nowMs;
        const manuallyPaused = site.status !== "online";
        const statusKey: "active" | "paused" = expired || manuallyPaused ? "paused" : "active";
        const candidate: MerchantSiteContext = {
          site,
          userEmail,
          prefix,
          industry,
          city,
          sizeBytes,
          visits,
          expireAt,
          expired,
          statusKey,
          statusLabel: statusKey === "active" ? "正常" : "暂停",
        };
        const current = siteContextByEmail.get(emailKey);
        if (!current) {
          siteContextByEmail.set(emailKey, candidate);
          return;
        }
        const currentTs = new Date(current.site.createdAt).getTime();
        const candidateTs = new Date(candidate.site.createdAt).getTime();
        if (candidateTs > currentTs) {
          siteContextByEmail.set(emailKey, candidate);
        }
      });

    const rowsByKey = new Map<string, MerchantUserRow>();
    siteContextByEmail.forEach((siteContext, emailKey) => {
      rowsByKey.set(emailKey, {
        site: siteContext.site,
        hasSite: true,
        backendAccount: null,
        merchantId: normalizeMerchantIdValue(siteContext.site.id) || "-",
        loginAccount: siteContext.userEmail || "-",
        userEmail: siteContext.userEmail || "-",
        merchantName: getMerchantProfileName(siteContext.site),
        prefix: siteContext.prefix,
        industry: siteContext.industry,
        city: siteContext.city,
        sizeBytes: siteContext.sizeBytes,
        visits: siteContext.visits,
        registerAt: siteContext.site.createdAt,
        expireAt: siteContext.expireAt,
        expired: siteContext.expired,
        statusLabel: siteContext.statusLabel,
        statusKey: siteContext.statusKey,
      });
    });

    backendMerchantAccounts.forEach((account) => {
      const siteContext = siteContextByEmail.get(normalizeEmailValue(account.email)) ?? null;
      if (!siteContext) {
        const backendOnlyRow: MerchantUserRow = {
          site: buildBackendOnlySite(account),
          hasSite: false,
          backendAccount: account,
          merchantId: normalizeMerchantIdValue(account.merchantId) || "-",
          loginAccount: account.username || account.loginId || account.email || "-",
          userEmail: account.email || "-",
          merchantName: account.merchantName || account.username || "",
          prefix: "-",
          industry: "未建站",
          city: "-",
          sizeBytes: 0,
          visits: { today: 0, day7: 0, day30: 0, total: 0 },
          registerAt: account.createdAt ?? nextIsoNow(),
          expireAt: null,
          expired: false,
          statusLabel: "未建站",
          statusKey: "unlinked",
        };
        rowsByKey.set(normalizeEmailValue(account.email) || `backend:${account.authUserId || account.merchantId}`, backendOnlyRow);
        return;
      }
      rowsByKey.set(normalizeEmailValue(account.email) || siteContext.userEmail, {
        site: siteContext.site,
        hasSite: true,
        backendAccount: account,
        merchantId: normalizeMerchantIdValue(account.merchantId) || "-",
        loginAccount: account.username || account.loginId || account.email || siteContext.userEmail || "-",
        userEmail: account.email || siteContext.userEmail || "-",
        merchantName: getMerchantProfileName(siteContext.site),
        prefix: siteContext.prefix,
        industry: siteContext.industry,
        city: siteContext.city,
        sizeBytes: siteContext.sizeBytes,
        visits: siteContext.visits,
        registerAt: account.createdAt ?? siteContext.site.createdAt,
        expireAt: siteContext.expireAt,
        expired: siteContext.expired,
        statusLabel: siteContext.statusLabel,
        statusKey: siteContext.statusKey,
      });
    });

    const sorted: MerchantUserRow[] = [...rowsByKey.values()];

    const sortRule = state.homeLayout.merchantDefaultSortRule;
    sorted.sort((a, b) => {
      if (sortRule === "name_asc") return a.merchantName.localeCompare(b.merchantName, "zh-CN");
      if (sortRule === "name_desc") return b.merchantName.localeCompare(a.merchantName, "zh-CN");
      if (sortRule === "created_asc") return new Date(a.registerAt).getTime() - new Date(b.registerAt).getTime();
      if (sortRule === "monthly_views_desc") return b.visits.day30 - a.visits.day30;
      return new Date(b.registerAt).getTime() - new Date(a.registerAt).getTime();
    });
    return sorted;
  }, [backendMerchantAccounts, merchantOwnerBySiteId, nowMs, state.homeLayout.merchantDefaultSortRule, state.sites]);
  const filteredMerchantRows = useMemo(
    () =>
      merchantRows.filter((row) => {
        const q = userKeyword.trim().toLowerCase();
        if (!q) return true;
        return [row.loginAccount, row.userEmail, row.merchantId, row.merchantName, row.prefix, row.industry, row.city, row.site.domain]
          .join(" ")
          .toLowerCase()
          .includes(q);
      }),
    [merchantRows, userKeyword],
  );
  const backendAccountsWithoutSite = useMemo(() => {
    const siteEmails = new Set(
      merchantRows
        .filter((row) => row.hasSite)
        .map((row) => normalizeEmailValue(row.userEmail))
        .filter(Boolean),
    );
    return backendMerchantAccounts.filter((account) => !siteEmails.has(normalizeEmailValue(account.email)));
  }, [backendMerchantAccounts, merchantRows]);
  const planTemplateTargetSite =
    state.sites.find((site) => site.id === planTemplateTargetSiteId) ?? null;
  const planTemplateApplyTemplate = planTemplateApplyDialog
    ? state.planTemplates.find((template) => template.id === planTemplateApplyDialog.templateId) ?? null
    : null;
  const planTemplateKeyword = planTemplateSearch.trim().toLowerCase();
  const filteredPlanTemplates = useMemo(
    () =>
      (state.planTemplates ?? []).filter((template) => {
        if (!matchPlanTemplateCategory(template, planTemplateFilter)) return false;
        if (!planTemplateKeyword) return true;
        const haystack = [
          template.name,
          template.sourceSiteName,
          template.sourceSiteDomain,
          template.sourceSiteId,
          template.category,
          template.sourceIndustry,
        ]
          .join("\n")
          .toLowerCase();
        return haystack.includes(planTemplateKeyword);
      }),
    [planTemplateFilter, planTemplateKeyword, state.planTemplates],
  );
  const planTemplateCards = useMemo(
    () =>
      filteredPlanTemplates.map((template) => ({
        template,
        summary: summarizePlanTemplateBlocks(template.blocks),
        previewPlans: getPlanTemplatePreviewOptions(template.blocks),
      })),
    [filteredPlanTemplates],
  );
  const planTemplateViewportOptions = useMemo(
    () => (planTemplateApplyTemplate ? getPlanTemplateViewportOptions(planTemplateApplyTemplate.blocks) : []),
    [planTemplateApplyTemplate],
  );
  const displayMerchantRows = useMemo(() => {
    const rows = filteredMerchantRows.map((row, idx) => ({ row, seq: idx + 1 }));
    const text = (value: string) => value.trim().toLowerCase();
    const merchantIdRank = (value: string) => {
      const normalized = value.trim();
      if (!normalized || normalized === "-") {
        return merchantTableSortOrder === "asc" ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
      }
      if (/^\d+$/.test(normalized)) return Number(normalized);
      return merchantTableSortOrder === "asc" ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
    };
    const expireTs = (iso: string | null) => {
      if (!iso) return merchantTableSortOrder === "asc" ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
      const ts = new Date(iso).getTime();
      if (!Number.isFinite(ts)) return merchantTableSortOrder === "asc" ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
      return ts;
    };
    rows.sort((a, b) => {
      const left = a.row;
      const right = b.row;
      let delta = 0;
      switch (merchantTableSortField) {
        case "user":
          delta = text(left.loginAccount).localeCompare(text(right.loginAccount), "zh-CN");
          break;
        case "id":
          delta = merchantIdRank(left.merchantId) - merchantIdRank(right.merchantId);
          if (delta === 0) {
            delta = text(left.merchantId).localeCompare(text(right.merchantId), "zh-CN");
          }
          break;
        case "name":
          delta = text(left.merchantName).localeCompare(text(right.merchantName), "zh-CN");
          break;
        case "prefix":
          delta = text(left.prefix).localeCompare(text(right.prefix), "zh-CN");
          break;
        case "industry":
          delta = text(left.industry).localeCompare(text(right.industry), "zh-CN");
          break;
        case "city":
          delta = text(left.city).localeCompare(text(right.city), "zh-CN");
          break;
        case "size":
          delta = left.sizeBytes - right.sizeBytes;
          break;
        case "monthlyViews":
          delta = left.visits.day30 - right.visits.day30;
          break;
        case "registerAt":
          delta = new Date(left.registerAt).getTime() - new Date(right.registerAt).getTime();
          break;
        case "expireAt":
          delta = expireTs(left.expireAt) - expireTs(right.expireAt);
          break;
        case "status":
          delta = left.statusKey.localeCompare(right.statusKey);
          break;
        case "seq":
        default:
          delta = a.seq - b.seq;
          break;
      }
      if (delta === 0) delta = a.seq - b.seq;
      return merchantTableSortOrder === "asc" ? delta : -delta;
    });
    return rows;
  }, [filteredMerchantRows, merchantTableSortField, merchantTableSortOrder]);
  const merchantTableTotalPages = Math.max(
    1,
    Math.ceil(displayMerchantRows.length / MERCHANT_USER_PAGE_SIZE_DEFAULT),
  );
  const clampedMerchantTablePage = Math.min(
    Math.max(1, merchantTablePage),
    merchantTableTotalPages,
  );
  const pagedMerchantRows = useMemo(() => {
    const start = (clampedMerchantTablePage - 1) * MERCHANT_USER_PAGE_SIZE_DEFAULT;
    return displayMerchantRows.slice(start, start + MERCHANT_USER_PAGE_SIZE_DEFAULT);
  }, [clampedMerchantTablePage, displayMerchantRows]);
  const selectedMerchantRow =
    merchantRows.find((item) => item.site.id === merchantDetailSiteId) ?? filteredMerchantRows[0] ?? merchantRows[0] ?? null;
  const selectedMerchantSite = selectedMerchantRow?.hasSite ? selectedMerchantRow.site : null;
  const selectedMerchantConfigHistory = selectedMerchantSite?.configHistory ?? [];
  const merchantDefaultSortRule = state.homeLayout.merchantDefaultSortRule;
  const merchantVisit30BySiteId = useMemo(
    () =>
      new Map(
        merchantRows.map((row) => [row.site.id, row.visits.day30] as const),
      ),
    [merchantRows],
  );
  const selectedSortPreviewLevel = selectedMerchantSite ? resolveSortPreviewLevel(selectedMerchantSite) : null;
  const selectedSortPreviewLevelLabel =
    selectedSortPreviewLevel === "city"
      ? "城市"
      : selectedSortPreviewLevel === "province"
        ? "省"
        : selectedSortPreviewLevel === "country"
          ? "国家"
          : "无地域";
  const selectedSortPreviewLocation = useMemo(
    () => ({
      country: (selectedMerchantSite?.location.country || "").trim() || "-",
      province: (selectedMerchantSite?.location.province || "").trim() || "-",
      city: (selectedMerchantSite?.location.city || "").trim() || "-",
    }),
    [selectedMerchantSite],
  );
  const selectedSortPreviewLocationKeys = useMemo(
    () => ({
      country: normalizeSortPreviewLocationKey(
        selectedMerchantSite?.location.countryCode || selectedMerchantSite?.location.country,
      ),
      province: normalizeSortPreviewLocationKey(
        selectedMerchantSite?.location.provinceCode || selectedMerchantSite?.location.province,
      ),
      city: normalizeSortPreviewLocationKey(selectedMerchantSite?.location.city),
    }),
    [selectedMerchantSite],
  );
  const canFilterByCountry = !!selectedSortPreviewLocationKeys.country;
  const canFilterByProvince = !!selectedSortPreviewLocationKeys.province;
  const canFilterByCity = !!selectedSortPreviewLocationKeys.city;
  const activeSortPreviewFilterLabel = SORT_PREVIEW_FILTER_LABELS[sortPreviewFilter];
  const filterSortPreviewCandidates = useMemo(
    () => (site: Site) =>
      selectedMerchantSite ? matchSortPreviewFilter(site, selectedMerchantSite, sortPreviewFilter) : true,
    [selectedMerchantSite, sortPreviewFilter],
  );
  useEffect(() => {
    if (sortPreviewFilter === "country" && !canFilterByCountry) {
      setSortPreviewFilter("all");
      return;
    }
    if (sortPreviewFilter === "province" && !canFilterByProvince) {
      setSortPreviewFilter("all");
      return;
    }
    if (sortPreviewFilter === "city" && !canFilterByCity) {
      setSortPreviewFilter("all");
    }
  }, [canFilterByCity, canFilterByCountry, canFilterByProvince, sortPreviewFilter]);
  const selectedDraftSortConfig = useMemo<MerchantSortConfig>(
    () => ({
      recommendedCountryRank: parseRankInput(configRecommendedCountryRank),
      recommendedProvinceRank: parseRankInput(configRecommendedProvinceRank),
      recommendedCityRank: parseRankInput(configRecommendedCityRank),
      industryCountryRank: parseRankInput(configIndustryCountryRank),
      industryProvinceRank: parseRankInput(configIndustryProvinceRank),
      industryCityRank: parseRankInput(configIndustryCityRank),
    }),
    [
      configIndustryCityRank,
      configIndustryCountryRank,
      configIndustryProvinceRank,
      configRecommendedCityRank,
      configRecommendedCountryRank,
      configRecommendedProvinceRank,
    ],
  );
  const previewSortConfigBySiteId = useMemo(() => {
    const map = new Map<string, MerchantSortConfig>();
    state.sites.forEach((site) => {
      map.set(
        site.id,
        selectedMerchantSite && site.id === selectedMerchantSite.id
          ? selectedDraftSortConfig
          : site.sortConfig ?? createDefaultMerchantSortConfig(),
      );
    });
    return map;
  }, [selectedDraftSortConfig, selectedMerchantSite, state.sites]);
  const recommendedSortPreview = useMemo(() => {
    if (!selectedMerchantSite) return { top10: [] as Site[], selectedRank: -1, totalCount: 0 };
    const all = state.sites
      .filter((site) => site.id !== "site-main")
      .filter((site) => filterSortPreviewCandidates(site));
    const sorted = [...all].sort((left, right) => {
      const leftRank = getManualRankValue(
        previewSortConfigBySiteId.get(left.id) ?? createDefaultMerchantSortConfig(),
        "recommended",
        selectedSortPreviewLevel,
      );
      const rightRank = getManualRankValue(
        previewSortConfigBySiteId.get(right.id) ?? createDefaultMerchantSortConfig(),
        "recommended",
        selectedSortPreviewLevel,
      );
      if (leftRank !== null || rightRank !== null) {
        if (leftRank !== null && rightRank !== null && leftRank !== rightRank) return leftRank - rightRank;
        if (leftRank !== null && rightRank === null) return -1;
        if (leftRank === null && rightRank !== null) return 1;
      }
      return compareByMerchantDefaultRule(left, right, merchantDefaultSortRule, merchantVisit30BySiteId);
    });
    return {
      top10: sorted.slice(0, 10),
      selectedRank: sorted.findIndex((site) => site.id === selectedMerchantSite.id) + 1,
      totalCount: sorted.length,
    };
  }, [
    filterSortPreviewCandidates,
    merchantDefaultSortRule,
    merchantVisit30BySiteId,
    previewSortConfigBySiteId,
    selectedMerchantSite,
    selectedSortPreviewLevel,
    state.sites,
  ]);
  const industrySortPreview = useMemo(() => {
    if (!selectedMerchantSite) return { top10: [] as Site[], selectedRank: -1, industryLabel: "-", totalCount: 0 };
    const selectedIndustry = (selectedMerchantSite.industry ?? "").trim();
    const all = state.sites
      .filter((site) => site.id !== "site-main")
      .filter((site) => filterSortPreviewCandidates(site))
      .filter((site) => (selectedIndustry ? (site.industry ?? "").trim() === selectedIndustry : true));
    const sorted = [...all].sort((left, right) => {
      const leftRank = getManualRankValue(
        previewSortConfigBySiteId.get(left.id) ?? createDefaultMerchantSortConfig(),
        "industry",
        selectedSortPreviewLevel,
      );
      const rightRank = getManualRankValue(
        previewSortConfigBySiteId.get(right.id) ?? createDefaultMerchantSortConfig(),
        "industry",
        selectedSortPreviewLevel,
      );
      if (leftRank !== null || rightRank !== null) {
        if (leftRank !== null && rightRank !== null && leftRank !== rightRank) return leftRank - rightRank;
        if (leftRank !== null && rightRank === null) return -1;
        if (leftRank === null && rightRank !== null) return 1;
      }
      return compareByMerchantDefaultRule(left, right, merchantDefaultSortRule, merchantVisit30BySiteId);
    });
    return {
      top10: sorted.slice(0, 10),
      selectedRank: sorted.findIndex((site) => site.id === selectedMerchantSite.id) + 1,
      industryLabel: selectedIndustry || "未设置行业",
      totalCount: sorted.length,
    };
  }, [
    filterSortPreviewCandidates,
    merchantDefaultSortRule,
    merchantVisit30BySiteId,
    previewSortConfigBySiteId,
    selectedMerchantSite,
    selectedSortPreviewLevel,
    state.sites,
  ]);
  const previewCardWidth = Math.max(160, Math.min(640, Math.round(Number(configCardPreviewWidth) || 280)));
  const previewCardHeight = Math.max(30, Math.min(420, Math.round(Number(configCardPreviewHeight) || 150)));
  const portalBlocksForMerchantPreview = portalDraftBlocks.length > 0 ? portalDraftBlocks : portalPublishedBlocks;
  const portalMerchantListBlock = useMemo(
    () => pickMerchantListBlock(portalBlocksForMerchantPreview),
    [portalBlocksForMerchantPreview],
  );
  const merchantListPreviewProps = useMemo<MerchantListPreviewProps>(() => {
    const props = portalMerchantListBlock?.type === "merchant-list" ? portalMerchantListBlock.props : undefined;
    return {
      merchantCardTypography: props?.merchantCardTypography,
      merchantCardTextLayout: props?.merchantCardTextLayout,
      merchantCardTextBoxVisible: props?.merchantCardTextBoxVisible,
    };
  }, [portalMerchantListBlock]);
  const previewMerchantCardTypographyMap = (merchantListPreviewProps.merchantCardTypography ??
    {}) as Partial<Record<MerchantCardTextRole, TypographyEditableProps>>;
  const previewMerchantNameTextStyle = buildTypographyInlineStyle(previewMerchantCardTypographyMap.name);
  const previewMerchantIndustryTextStyle = buildTypographyInlineStyle(previewMerchantCardTypographyMap.industry);
  const previewMerchantDomainTextStyle = buildTypographyInlineStyle(previewMerchantCardTypographyMap.domain);
  const previewMerchantCardTextLayout = (merchantListPreviewProps.merchantCardTextLayout ?? {}) as MerchantCardTextLayoutConfig;
  const previewMerchantNameTextPosition = resolveMerchantCardTextPosition(previewMerchantCardTextLayout, "name");
  const previewMerchantIndustryTextPosition = resolveMerchantCardTextPosition(previewMerchantCardTextLayout, "industry");
  const previewMerchantDomainTextPosition = resolveMerchantCardTextPosition(previewMerchantCardTextLayout, "domain");
  const previewMerchantCardTextBoxClass =
    merchantListPreviewProps.merchantCardTextBoxVisible === true
      ? "inline-flex w-fit max-w-full rounded border border-slate-300 bg-white/90 px-1.5 py-0.5"
      : "inline-flex w-fit max-w-full";
  const merchantActiveCount = filteredMerchantRows.filter((item) => item.statusKey === "active").length;
  const merchantPausedCount = filteredMerchantRows.filter((item) => item.statusKey === "paused").length;
  const merchantUnlinkedCount = filteredMerchantRows.filter((item) => item.statusKey === "unlinked").length;
  const releaseChecklistCheckedCount = RELEASE_REGRESSION_CHECKLIST.filter((item) => releaseChecklistState[item.id]).length;
  const portalSitesByCategory = useMemo(() => {
    const map = new Map<string, PlatformState["sites"]>();
    state.sites.forEach((site) => {
      const current = map.get(site.categoryId) ?? [];
      current.push(site);
      map.set(site.categoryId, current);
    });
    return map;
  }, [state.sites]);
  const portalNewestSites = useMemo(
    () =>
      [...state.sites]
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, 6),
    [state.sites],
  );
  const activePortalCategoryId =
    state.industryCategories.find((item) => item.status === "active")?.id || state.industryCategories[0]?.id || "";
  const selectedPortalSection =
    portalDraft.sections.find((item) => item.id === selectedPortalSectionId) ?? portalDraft.sections[0] ?? null;
  const selectedPortalSectionIndex = selectedPortalSection
    ? portalDraft.sections.findIndex((item) => item.id === selectedPortalSection.id)
    : -1;
  const previewVisibleSections = useMemo(
    () =>
      [...portalDraft.sections]
        .filter((section) => section.visible)
        .sort((a, b) => a.sortOrder - b.sortOrder),
    [portalDraft.sections],
  );

  const localPublishEvents = readPublishEvents();

  const publish30d = state.publishRecords.filter(
    (item) => nowMs - new Date(item.at).getTime() <= 30 * 86400_000,
  );

  const publishSuccessRate = publish30d.length
    ? `${Math.round(
        (publish30d.filter((item) => item.status === "success").length /
          publish30d.length) *
          100,
      )}%`
    : "-";

  const guard = (permission: PermissionKey, message: string) => {
    if (hasPermission(permission)) return true;
    setTip(message);
    return false;
  };

  const commit = (updater: (prev: PlatformState) => PlatformState) => {
    const prev = stateRef.current;
    const next = updater(prev);
    const persisted = savePlatformState(next);
    if (!persisted) return false;
    stateRef.current = next;
    setState(next);
    setNowMs(Date.now());
    return persisted;
  };

  const withAudit = (
    base: PlatformState,
    action: string,
    targetType: string,
    targetId: string,
    detail: string,
  ) =>
    applyAudit(
      base,
      createAuditRecord({ operator: operatorName, action, targetType, targetId, detail }),
    );

  function confirmPublishChecklistAction(actionLabel: string) {
    const missing = RELEASE_REGRESSION_CHECKLIST.filter((item) => !releaseChecklistState[item.id]);
    if (missing.length === 0) return true;
    if (typeof window === "undefined") return true;
    const message = [
      `${SUPER_ADMIN_MESSAGES.checklistPublishConfirmTitle}（${missing.length}/${RELEASE_REGRESSION_CHECKLIST.length} 未完成）`,
      ...missing.map((item, index) => `${index + 1}. ${item.label}`),
      "",
      `动作：${actionLabel}`,
      SUPER_ADMIN_MESSAGES.checklistPublishConfirmQuestion,
    ].join("\n");
    return window.confirm(message);
  }

  function hydrateMerchantConfigDraft(site: Site) {
    const permission = site.permissionConfig ?? createDefaultMerchantPermissionConfig();
    const sortConfig = site.sortConfig ?? createDefaultMerchantSortConfig();
    setConfigExpireDate(isoToDateInput(site.serviceExpiresAt ?? null));
    setConfigPlanLimit(`${permission.planLimit}`);
    setConfigPageLimit(`${permission.pageLimit}`);
    setConfigPublishLimitMb(`${permission.publishSizeLimitMb}`);
    setConfigAllowInsertBackground(permission.allowInsertBackground);
    setConfigAllowThemeEffects(permission.allowThemeEffects);
    setConfigAllowButtonBlock(permission.allowButtonBlock);
    setConfigAllowGalleryBlock(permission.allowGalleryBlock);
    setConfigAllowMusicBlock(permission.allowMusicBlock);
    setConfigAllowProductBlock(permission.allowProductBlock);
    setConfigAllowBookingBlock(permission.allowBookingBlock);
    setConfigMerchantCardImage((site.merchantCardImageUrl ?? "").trim());
    setConfigRecommendedCountryRank(rankInput(sortConfig.recommendedCountryRank));
    setConfigRecommendedProvinceRank(rankInput(sortConfig.recommendedProvinceRank));
    setConfigRecommendedCityRank(rankInput(sortConfig.recommendedCityRank));
    setConfigIndustryCountryRank(rankInput(sortConfig.industryCountryRank));
    setConfigIndustryProvinceRank(rankInput(sortConfig.industryProvinceRank));
    setConfigIndustryCityRank(rankInput(sortConfig.industryCityRank));
  }

  function openMerchantDetailPanel(siteId: string) {
    setMerchantDetailSiteId(siteId);
    setUserPanelMode("detail");
    setMerchantPanelOpen(true);
  }

  function openMerchantConfigPanel(site: Site) {
    setMerchantDetailSiteId(site.id);
    hydrateMerchantConfigDraft(site);
    setUserPanelMode("config");
    setMerchantPanelOpen(true);
  }

  function closePlanTemplateDialog() {
    setPlanTemplateDialogOpen(false);
    setPlanTemplateApplyDialog(null);
    setPlanTemplateCoverPreview(null);
    setPlanTemplateNameDrafts({});
  }

  function openPlanTemplateDialogForSite(site: Site) {
    setPlanTemplateTargetSiteId(site.id);
    setPlanTemplateSearch("");
    setPlanTemplateFilter("全部");
    setPlanTemplateNameDrafts({});
    setPlanTemplateApplyDialog(null);
    setPlanTemplateCoverPreview(null);
    setPlanTemplateDialogOpen(true);
  }

  function needsPlanTemplatePreviewRefresh(template: PlanTemplate) {
    if ((template.previewVariant ?? "").trim() !== PLAN_TEMPLATE_PREVIEW_VARIANT) return true;
    const planPreviewKeys = Object.keys(template.planPreviewImageUrls ?? {}).filter((key) => key.trim());
    return planPreviewKeys.length === 0;
  }

  async function ensurePlanTemplatePreviewAssets(template: PlanTemplate) {
    if (!needsPlanTemplatePreviewRefresh(template)) return template;
    const blocks = Array.isArray(template.blocks) ? (template.blocks as Block[]) : [];
    if (blocks.length === 0) return template;
    const previewAssets = await capturePlanTemplatePreviewAssets(blocks).catch(() => null);
    if (!previewAssets) return template;
    const nextTemplate: PlanTemplate = {
      ...template,
      previewImageUrl: previewAssets.previewImageUrl,
      planPreviewImageUrls: previewAssets.planPreviewImageUrls,
      previewVariant: previewAssets.previewVariant,
      updatedAt: nextIsoNow(),
    };
    commit((prev) => ({
      ...prev,
      planTemplates: sortPlanTemplatesByUpdatedAt(
        prev.planTemplates.map((item) => (item.id === template.id ? nextTemplate : item)),
      ),
    }));
    return nextTemplate;
  }

  async function openPlanTemplatePreview(template: PlanTemplate, planId?: string, planName?: string) {
    const refreshedTemplate = await ensurePlanTemplatePreviewAssets(template);
    const previewUrl = planId
      ? String((refreshedTemplate.planPreviewImageUrls ?? {})[planId] ?? "").trim()
      : (refreshedTemplate.previewImageUrl ?? "").trim();
    if (!previewUrl) return;
    setPlanTemplateCoverPreview({
      url: previewUrl,
      name: planId
        ? `${refreshedTemplate.name} · ${planName || "方案"} 整套页面预览`
        : `${refreshedTemplate.name} · 方案预览`,
    });
  }

  function getPlanTemplateCoverSurface(template: PlanTemplate) {
    const coverImageUrl = (template.coverImageUrl ?? "").trim();
    const coverBackground = extractPlanTemplateCoverBackground(template.blocks);
    return {
      coverImageUrl,
      coverBackgroundStyle: !coverImageUrl && coverBackground ? getBackgroundStyle(coverBackground) : null,
      hasCustomCoverBackground: !coverImageUrl && !!coverBackground,
    };
  }

  function openPlanTemplateApplyDialog(template: PlanTemplate) {
    setPlanTemplateApplyDialog({ templateId: template.id });
    setPlanTemplateApplyScope(createDefaultPlanTemplateApplyScope(template.blocks));
    setPlanTemplateReplaceOptions({ ...DEFAULT_PLAN_TEMPLATE_REPLACE_OPTIONS });
    void ensurePlanTemplatePreviewAssets(template);
  }

  function updatePlanTemplateViewportEnabled(viewport: "desktop" | "mobile", enabled: boolean) {
    setPlanTemplateApplyScope((prev) => ({
      ...prev,
      [viewport]: {
        ...prev[viewport],
        enabled,
      },
    }));
  }

  function updatePlanTemplateViewportBackground(viewport: "desktop" | "mobile", applyBackground: boolean) {
    setPlanTemplateApplyScope((prev) => ({
      ...prev,
      [viewport]: {
        ...prev[viewport],
        applyBackground,
      },
    }));
  }

  function togglePlanTemplatePageSelection(viewport: "desktop" | "mobile", pageKey: string) {
    setPlanTemplateApplyScope((prev) => {
      const current = prev[viewport];
      const selectedPageKeys = current.selectedPageKeys.includes(pageKey)
        ? current.selectedPageKeys.filter((item) => item !== pageKey)
        : [...current.selectedPageKeys, pageKey];
      return {
        ...prev,
        [viewport]: {
          ...current,
          selectedPageKeys,
        },
      };
    });
  }

  function updatePlanTemplateReplaceOption<K extends keyof PlanTemplateReplaceOptions>(key: K, value: boolean) {
    setPlanTemplateReplaceOptions((prev) => ({
      ...prev,
      [key]: value,
    }));
  }

  async function captureMerchantTemplate(site: Site) {
    const siteId = (site.id ?? "").trim();
    if (!siteId) {
      setTip("缺少站点 ID，无法收录方案");
      return;
    }
    setCapturingTemplateSiteId(siteId);
    try {
      const blocks = await fetchPublishedBlocksForTemplateCapture(siteId);
      if (!Array.isArray(blocks) || blocks.length === 0) {
        setTip("该站点暂无可收录的已发布方案，请先发布前台");
        return;
      }
      const previewAssets =
        (await capturePlanTemplatePreviewAssets(blocks).catch(() => ({
          previewVariant: "",
          previewImageUrl: "",
          planPreviewImageUrls: {} as Record<string, string>,
        }))) ?? { previewVariant: "", previewImageUrl: "", planPreviewImageUrls: {} as Record<string, string> };
      const template = createPlanTemplate({
        name: (site.merchantName ?? "").trim() || (site.name ?? "").trim() || "未命名方案",
        sourceSiteId: siteId,
        sourceSiteName: (site.merchantName ?? "").trim() || (site.name ?? "").trim(),
        sourceSiteDomain: (site.domain ?? "").trim(),
        sourceIndustry: site.industry,
        previewImageUrl: previewAssets.previewImageUrl,
        planPreviewImageUrls: previewAssets.planPreviewImageUrls,
        previewVariant: previewAssets.previewVariant,
        blocks,
      });
      const saved = commit((prev) =>
        withAudit(
          {
            ...prev,
            planTemplates: [template, ...(prev.planTemplates ?? [])],
          },
          "plan_template_capture",
          "plan_template",
          template.id,
          `${template.name}${template.sourceSiteName ? ` <- ${template.sourceSiteName}` : ""}`,
        ),
      );
      if (!saved) {
        setTip("方案模板保存失败，请重试");
        return;
      }
      setTip(`已收录方案：${template.name}`);
    } catch (error) {
      setTip(error instanceof Error ? error.message : "方案收录失败，请重试");
    } finally {
      setCapturingTemplateSiteId("");
    }
  }

  function updatePlanTemplateNameDraft(templateId: string, value: string) {
    setPlanTemplateNameDrafts((prev) => ({
      ...prev,
      [templateId]: value,
    }));
  }

  function clearPlanTemplateNameDraft(templateId: string) {
    setPlanTemplateNameDrafts((prev) => {
      if (!(templateId in prev)) return prev;
      const next = { ...prev };
      delete next[templateId];
      return next;
    });
  }

  function persistPlanTemplateName(templateId: string) {
    const template = state.planTemplates.find((item) => item.id === templateId);
    if (!template) {
      clearPlanTemplateNameDraft(templateId);
      return;
    }
    const draft = planTemplateNameDrafts[templateId];
    if (draft === undefined) return;
    const nextName = draft.trim() || "未命名方案";
    if (nextName === template.name) {
      clearPlanTemplateNameDraft(templateId);
      return;
    }
    const updatedAt = nextIsoNow();
    const saved = commit((prev) =>
      withAudit(
        {
          ...prev,
          planTemplates: sortPlanTemplatesByUpdatedAt(
            prev.planTemplates.map((item) =>
              item.id === templateId ? { ...item, name: nextName, updatedAt } : item,
            ),
          ),
        },
        "plan_template_update",
        "plan_template",
        templateId,
        `名称：${template.name} -> ${nextName}`,
      ),
    );
    if (!saved) {
      setTip("方案模板名称保存失败，请重试");
      return;
    }
    clearPlanTemplateNameDraft(templateId);
  }

  function updatePlanTemplateCategory(templateId: string, category: PlanTemplateCategory) {
    const template = state.planTemplates.find((item) => item.id === templateId);
    if (!template || template.category === category) return;
    const updatedAt = nextIsoNow();
    const saved = commit((prev) =>
      withAudit(
        {
          ...prev,
          planTemplates: sortPlanTemplatesByUpdatedAt(
            prev.planTemplates.map((item) =>
              item.id === templateId ? { ...item, category, updatedAt } : item,
            ),
          ),
        },
        "plan_template_update",
        "plan_template",
        templateId,
        `分类：${template.category} -> ${category}`,
      ),
    );
    if (!saved) {
      setTip("方案模板分类保存失败，请重试");
    }
  }

  function deletePlanTemplateFromDialog(template: PlanTemplate) {
    if (typeof window !== "undefined") {
      const confirmed = window.confirm(`确定删除方案模板「${template.name}」吗？`);
      if (!confirmed) return;
    }
    const saved = commit((prev) =>
      withAudit(
        {
          ...prev,
          planTemplates: prev.planTemplates.filter((item) => item.id !== template.id),
        },
        "plan_template_delete",
        "plan_template",
        template.id,
        template.name,
      ),
    );
    if (!saved) {
      setTip("删除方案模板失败，请重试");
      return;
    }
    clearPlanTemplateNameDraft(template.id);
    setTip(`已删除方案模板：${template.name}`);
  }

  async function applyPlanTemplateToSite(
    template: PlanTemplate,
    site: Site,
    mode: "draft" | "publish",
    scope: PlanTemplateApplyScope,
    replaceOptions: PlanTemplateReplaceOptions,
  ) {
    if (!guard("publish.trigger", SUPER_ADMIN_MESSAGES.noPublishPermission)) return;
    const siteId = (site.id ?? "").trim();
    if (!siteId) {
      setTip("缺少站点 ID，无法应用方案模板");
      return;
    }
    if (!hasPlanTemplateApplySelection(scope)) {
      setTip("请至少选择一个端口，并勾选背景或页面范围");
      return;
    }
    const templateBlocks = Array.isArray(template.blocks) ? (JSON.parse(JSON.stringify(template.blocks)) as Block[]) : [];
    if (templateBlocks.length === 0) {
      setTip("该方案模板没有可发布的页面内容");
      return;
    }
    const siteLabel = getSiteDisplayName(site) || site.domain || siteId;
    const scopeKey = buildSiteStoreScope(siteId);
    const remotePublishedBlocks = await fetchPublishedBlocksForTemplateCapture(siteId);
    const localPublishedBlocks = loadPublishedBlocksFromStorage([], scopeKey);
    const publishedBaseline = remotePublishedBlocks.length > 0 ? remotePublishedBlocks : localPublishedBlocks;
    const draftBaseline = loadBlocksFromStorage(publishedBaseline, scopeKey);
    const baseBlocks = mode === "draft" ? draftBaseline : publishedBaseline.length > 0 ? publishedBaseline : draftBaseline;
    const blocks = applyPlanTemplateToBlocks(templateBlocks, baseBlocks, scope, replaceOptions);
    const actionLabel = mode === "draft" ? "应用到草稿" : "直接发布";
    if (mode === "publish" && typeof window !== "undefined") {
      const confirmed = window.confirm(`确定将方案「${template.name}」${actionLabel}到 ${siteLabel} 的前台吗？这会覆盖当前已发布内容。`);
      if (!confirmed) return;
    }

    const actionKey = `${template.id}:${mode}`;
    const requestId = `super-admin-plan-template-${siteId}-${mode}-${Date.now()}`;
    const publishedAt = nextIsoNow();
    const note = `应用方案模板：${template.name}`;
    const publishStatus: PublishStatus = "success";
    setApplyingPlanTemplateKey(actionKey);
    try {
      if (mode === "draft") {
        saveBlocksToStorage(blocks, scopeKey);
        const saved = commit((prev) =>
          withAudit(
            { ...prev },
            "plan_template_apply_draft",
            "site",
            siteId,
            `${template.name} -> ${siteLabel}`,
          ),
        );
        if (!saved) {
          setTip("方案模板已写入草稿，但审计记录更新失败，请刷新后确认");
          return;
        }
        setPlanTemplateApplyDialog(null);
        setPlanTemplateDialogOpen(false);
        setTip(`已将方案「${template.name}」应用到 ${siteLabel} 的草稿`);
        return;
      }

      const response = await fetch("/api/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestId,
          payload: {
            blocks,
            updated_at: publishedAt,
          },
          merchantIds: [siteId],
          merchantSlug: (site.domainPrefix ?? site.domainSuffix ?? "").trim(),
          isPlatformEditor: false,
        }),
      });
      const payload = (await response.json().catch(() => null)) as { message?: string } | null;
      if (!response.ok) {
        setTip(payload?.message || "方案模板应用失败，请稍后重试");
        return;
      }

      saveBlocksToStorage(blocks, scopeKey);
      savePublishedBlocksToStorage(blocks, scopeKey);
      recordPublishedVersion(blocks, scopeKey);

      const saved = commit((prev) => {
        const target = prev.sites.find((item) => item.id === siteId);
        if (!target) return prev;
        const version = target.publishedVersion + 1;
        return withAudit(
          {
            ...prev,
            sites: prev.sites.map((item) =>
              item.id === siteId
                ? {
                    ...item,
                    publishedVersion: version,
                    lastPublishedAt: publishedAt,
                    updatedAt: publishedAt,
                  }
                : item,
            ),
            publishRecords: [
              {
                id: `publish-template-${Date.now()}`,
                tenantId: target.tenantId,
                siteId,
                version,
                status: publishStatus,
                operator: operatorName,
                notes: note,
                at: publishedAt,
              },
              ...prev.publishRecords,
            ].slice(0, 600),
          },
          "plan_template_apply_publish",
          "site",
          siteId,
          `${template.name} -> ${siteLabel}`,
        );
      });
      if (!saved) {
        setTip("方案模板已发布，但本地状态更新失败，请刷新后确认");
        return;
      }
      setPlanTemplateApplyDialog(null);
      setPlanTemplateDialogOpen(false);
      setTip(`已将方案「${template.name}」应用到 ${siteLabel}`);
    } catch (error) {
      setTip(error instanceof Error ? error.message : "方案模板应用失败，请稍后重试");
    } finally {
      setApplyingPlanTemplateKey("");
    }
  }

  function createTenantAction() {
    if (!guard("tenant.manage", "无租户管理权限")) return;
    if (!tenantName.trim() || !tenantOwner.trim()) {
      setTip("请填写租户名称和负责人");
      return;
    }

    const tenant = createTenant({ name: tenantName, owner: tenantOwner });
    commit((prev) =>
      withAudit(
        { ...prev, tenants: [tenant, ...prev.tenants] },
        "tenant_create",
        "tenant",
        tenant.id,
        tenant.name,
      ),
    );

    setTenantName("");
    setTenantOwner("");
  }

  function createSiteAction() {
    if (!guard("site.manage", "无站点管理权限")) return;
    if (!activeSiteTenantId || !siteName.trim() || !siteDomain.trim() || !activeSiteCategoryId) {
      setTip("请完整填写站点信息");
      return;
    }
    const categoryName = categoryMap.get(activeSiteCategoryId);
    if (!categoryName) {
      setTip("请选择有效行业分类");
      return;
    }

    const site = createSite({
      tenantId: activeSiteTenantId,
      name: siteName,
      domain: siteDomain,
      categoryId: activeSiteCategoryId,
      categoryName,
      featurePackage: "standard",
    });

    commit((prev) =>
      withAudit(
        { ...prev, sites: [site, ...prev.sites] },
        "site_create",
        "site",
        site.id,
        site.name,
      ),
    );

    setSiteName("");
    setSiteDomain("");
    setSiteCategoryId("");
  }

  function createCategoryAction() {
    if (!guard("site.manage", "无行业分类管理权限")) return;
    if (!categoryName.trim() || !categorySlug.trim()) {
      setTip("请填写分类名称和 slug");
      return;
    }
    const slug = categorySlug.trim().toLowerCase();
    if (!/^[a-z0-9-]+$/.test(slug)) {
      setTip("slug 仅支持小写字母、数字和连字符");
      return;
    }
    if (state.industryCategories.some((item) => item.slug === slug)) {
      setTip("slug 已存在");
      return;
    }
    const category = createIndustryCategory({
      name: categoryName,
      slug,
      description: categoryDescription,
      sortOrder: state.industryCategories.length * 10 + 10,
    });
    commit((prev) =>
      withAudit(
        {
          ...prev,
          industryCategories: [...prev.industryCategories, category].sort((a, b) => a.sortOrder - b.sortOrder),
        },
        "industry_category_create",
        "industry_category",
        category.id,
        category.name,
      ),
    );
    setCategoryName("");
    setCategorySlug("");
    setCategoryDescription("");
  }

  function toggleCategoryStatusAction(categoryId: string, status: IndustryCategoryStatus) {
    if (!guard("site.manage", "无行业分类管理权限")) return;
    const target = state.industryCategories.find((item) => item.id === categoryId);
    if (!target) return;
    const nextStatus: IndustryCategoryStatus = status === "active" ? "inactive" : "active";
    commit((prev) =>
      withAudit(
        {
          ...prev,
          industryCategories: prev.industryCategories.map((item) =>
            item.id === categoryId ? { ...item, status: nextStatus, updatedAt: nextIsoNow() } : item,
          ),
        },
        "industry_category_status",
        "industry_category",
        categoryId,
        nextStatus,
      ),
    );
  }

  function updatePortalDraft(updater: (prev: PortalDraft) => PortalDraft) {
    setPortalDraft((prev) => updater(prev));
    setPortalDirty(true);
  }

  function addPortalSectionAction() {
    if (!activePortalCategoryId) {
      setTip("请先创建并启用行业分类");
      return;
    }
    const nextSection = createHomeLayoutSection({
      title: `新分区 ${portalDraft.sections.length + 1}`,
      description: "",
      categoryId: activePortalCategoryId,
      sortOrder: (portalDraft.sections.length + 1) * 10,
    });
    updatePortalDraft((prev) => ({
      ...prev,
      sections: [...prev.sections, nextSection],
    }));
    setSelectedPortalSectionId(nextSection.id);
  }

  function updatePortalSectionField<K extends keyof HomeLayoutSection>(
    sectionId: string,
    key: K,
    value: HomeLayoutSection[K],
  ) {
    updatePortalDraft((prev) => ({
      ...prev,
      sections: prev.sections.map((item) =>
        item.id === sectionId ? { ...item, [key]: value } : item,
      ),
    }));
  }

  function removePortalSectionAction(sectionId: string) {
    updatePortalDraft((prev) => ({
      ...prev,
      sections: prev.sections.filter((item) => item.id !== sectionId),
    }));
    if (selectedPortalSectionId === sectionId) {
      setSelectedPortalSectionId("");
    }
  }

  function movePortalSectionAction(sectionId: string, direction: -1 | 1) {
    updatePortalDraft((prev) => {
      const items = [...prev.sections];
      const from = items.findIndex((item) => item.id === sectionId);
      if (from < 0) return prev;
      const to = from + direction;
      if (to < 0 || to >= items.length) return prev;
      const [picked] = items.splice(from, 1);
      items.splice(to, 0, picked);
      return {
        ...prev,
        sections: items.map((item, idx) => ({ ...item, sortOrder: (idx + 1) * 10 })),
      };
    });
  }

  function resetPortalDraftAction() {
    setPortalDraft(buildPortalDraft(state));
    setSelectedPortalSectionId("");
    setPortalDirty(false);
  }

  function savePortalDraftAction() {
    if (!guard("site.manage", "无总站规划权限")) return;
    const heroTitle = portalDraft.heroTitle.trim();
    if (!heroTitle) {
      setTip("请填写总站首页主标题");
      return;
    }

    const validCategoryIds = new Set(state.industryCategories.map((item) => item.id));
    const fallbackCategoryId =
      state.industryCategories.find((item) => item.status === "active")?.id ||
      state.industryCategories[0]?.id ||
      "";

    if (!fallbackCategoryId && portalDraft.sections.length > 0) {
      setTip("请先创建行业分类后再保存总站分区");
      return;
    }

    const normalizedSections: HomeLayoutSection[] = portalDraft.sections.map((section, idx) => {
      const categoryId = validCategoryIds.has(section.categoryId) ? section.categoryId : fallbackCategoryId;
      return {
        ...section,
        title: section.title.trim() || `分区 ${idx + 1}`,
        description: section.description.trim(),
        categoryId,
        sortOrder: (idx + 1) * 10,
        visible: section.visible,
      };
    });

    commit((prev) =>
      withAudit(
        {
          ...prev,
          homeLayout: {
            ...prev.homeLayout,
            heroTitle,
            heroSubtitle: portalDraft.heroSubtitle.trim(),
            sections: normalizedSections,
          },
        },
        "home_layout_visual_update",
        "home_layout",
        "portal",
        `hero:${heroTitle};sections:${normalizedSections.length}`,
      ),
    );
    setPortalDirty(false);
    setTip("总站页面已保存");
  }

  function createUserAction() {
    if (!guard("user.manage", "无用户管理权限")) return;
    if (!userName.trim() || !userEmail.trim() || !activeUserRoleId) {
      setTip("请完整填写用户信息");
      return;
    }

    const user = createPlatformUser({
      name: userName,
      email: userEmail,
      department: "平台",
      tenantIds: [],
      siteIds: [],
      roleIds: [activeUserRoleId],
    });

    commit((prev) =>
      withAudit(
        { ...prev, users: [user, ...prev.users] },
        "user_create",
        "user",
        user.id,
        user.name,
      ),
    );

    setUserName("");
    setUserEmail("");
  }

  function resetManualUserDialog() {
    setManualUserId("");
    setManualUserName("");
    setManualUserPassword("");
    setManualUserError("");
  }

  function openManualUserDialog() {
    if (!guard("user.manage", "无用户管理权限")) return;
    resetManualUserDialog();
    setManualUserDialogOpen(true);
  }

  function closeManualUserDialog() {
    if (manualUserSubmitting) return;
    setManualUserDialogOpen(false);
    resetManualUserDialog();
  }

  async function createManualUserAction() {
    if (!guard("user.manage", "无用户管理权限")) return;

    const merchantId = manualUserId.trim();
    const username = manualUserName.trim();
    const passwordValue = manualUserPassword;

    if (!/^\d{8}$/.test(merchantId)) {
      setManualUserError("ID 必须是 8 位数字");
      return;
    }
    if (!username) {
      setManualUserError("请输入用户名");
      return;
    }
    if (passwordValue.length < 6) {
      setManualUserError("密码至少 6 位");
      return;
    }

    setManualUserSubmitting(true);
    setManualUserError("");

    try {
      const response = await fetch("/api/super-admin/merchant-accounts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          merchantId,
          username,
          password: passwordValue,
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { item?: BackendMerchantAccount; message?: string }
        | null;

      if (!response.ok) {
        setManualUserError(payload?.message || "新增用户失败，请稍后重试");
        return;
      }

      const createdItem = payload?.item;
      if (createdItem) {
        setBackendMerchantAccounts((prev) => {
          const next = prev.filter((item) => item.merchantId !== createdItem.merchantId);
          return [createdItem, ...next];
        });
        setMerchantDetailSiteId(`backend-${createdItem.merchantId || createdItem.email || "merchant"}`);
      } else {
        setMerchantDetailSiteId(`backend-${merchantId}`);
      }

      setUserPanelMode("detail");
      setMerchantPanelOpen(true);
      setManualUserDialogOpen(false);
      resetManualUserDialog();
      setTip(`已创建用户：${username}（ID ${merchantId}）`);
    } catch (error) {
      setManualUserError(error instanceof Error ? error.message : "新增用户失败，请稍后重试");
    } finally {
      setManualUserSubmitting(false);
    }
  }

  async function createMerchantIdRuleAction() {
    if (!guard("user.manage", "无用户管理权限")) return;

    const parsed = parseMerchantIdRuleInput(merchantIdRuleInput);
    if (!parsed.ok) {
      setMerchantIdRulesError(parsed.message);
      return;
    }

    setMerchantIdRuleSubmitting(true);
    setMerchantIdRulesError("");
    try {
      const response = await fetch("/api/super-admin/merchant-id-rules", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          expression: merchantIdRuleInput,
          note: merchantIdRuleNote,
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { rule?: MerchantIdRule; message?: string }
        | null;

      if (!response.ok) {
        setMerchantIdRulesError(payload?.message || "禁用 ID 规则保存失败，请稍后重试");
        return;
      }

      const createdRule = payload?.rule;
      if (createdRule) {
        setMerchantIdRules((prev) => sortMerchantIdRules([createdRule, ...prev.filter((item) => item.id !== createdRule.id)]));
      }
      setMerchantIdRuleInput("");
      setMerchantIdRuleNote("");
      setTip(`已添加禁用 ID 规则：${parsed.rule.expression}`);
    } catch (error) {
      setMerchantIdRulesError(error instanceof Error ? error.message : "禁用 ID 规则保存失败，请稍后重试");
    } finally {
      setMerchantIdRuleSubmitting(false);
    }
  }

  async function deleteMerchantIdRuleAction(rule: MerchantIdRule) {
    if (!guard("user.manage", "无用户管理权限")) return;

    setMerchantIdRuleDeletingId(rule.id);
    setMerchantIdRulesError("");
    try {
      const response = await fetch("/api/super-admin/merchant-id-rules", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ id: rule.id }),
      });
      const payload = (await response.json().catch(() => null)) as { message?: string } | null;
      if (!response.ok) {
        setMerchantIdRulesError(payload?.message || "禁用 ID 规则删除失败，请稍后重试");
        return;
      }
      setMerchantIdRules((prev) => prev.filter((item) => item.id !== rule.id));
      setTip(`已移除禁用 ID 规则：${rule.expression}`);
    } catch (error) {
      setMerchantIdRulesError(error instanceof Error ? error.message : "禁用 ID 规则删除失败，请稍后重试");
    } finally {
      setMerchantIdRuleDeletingId("");
    }
  }

  function toggleMerchantServiceAction(siteId: string) {
    if (!guard("user.manage", "无用户管理权限")) return;
    const target = state.sites.find((item) => item.id === siteId);
    if (!target) return;
    if (target.status !== "online" && target.serviceExpiresAt) {
      const expireAt = new Date(target.serviceExpiresAt).getTime();
      if (Number.isFinite(expireAt) && expireAt <= nowMs) {
        setTip("商户已到期，请先在配置中延后到期时间");
        return;
      }
    }
    const status: SiteStatus = target.status === "online" ? "maintenance" : "online";
    commit((prev) =>
      withAudit(
        {
          ...prev,
          sites: prev.sites.map((item) =>
            item.id === siteId ? { ...item, status, updatedAt: nextIsoNow() } : item,
          ),
        },
        "merchant_service_toggle",
        "site",
        siteId,
        status,
      ),
    );
  }

  function updateMerchantDefaultSortRuleAction(rule: MerchantSortRule) {
    if (!guard("site.manage", "无总站配置权限")) return;
    commit((prev) =>
      withAudit(
        {
          ...prev,
          homeLayout: {
            ...prev.homeLayout,
            merchantDefaultSortRule: rule,
          },
        },
        "merchant_sort_rule_update",
        "home_layout",
        "portal",
        rule,
      ),
    );
    setTip("默认商户排序规则已更新");
  }

  async function handleMerchantCardImageUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setTip("仅支持上传图片文件");
      return;
    }
    try {
      const optimized = await optimizeMerchantCardImage(file);
      const bytes = estimateUtf8Size(optimized);
      if (bytes > MAX_MERCHANT_CARD_IMAGE_DATA_URL_BYTES) {
        setTip(`图片体积过大（${formatBytes(bytes)}），请使用更小图片`);
        return;
      }
      const uploadedUrl = await uploadMerchantCardImageDataUrlToSupabase(
        optimized,
        selectedMerchantSite?.id ?? "merchant-card",
      );
      if (!uploadedUrl) {
        setTip("图片上传到存储失败，请检查存储配置后重试");
        return;
      }
      setConfigMerchantCardImage(uploadedUrl);
      setTip(`图片已压缩并上传：${formatBytes(file.size)} -> ${formatBytes(bytes)}`);
    } catch (error) {
      setTip(error instanceof Error ? error.message : "读取图片失败，请重试");
    } finally {
      event.target.value = "";
    }
  }

  async function saveMerchantConfigAction() {
    if (!guard("user.manage", SUPER_ADMIN_MESSAGES.noUserPermission)) return;
    if (!selectedMerchantSite) {
      setTip(SUPER_ADMIN_MESSAGES.selectMerchantFirst);
      return;
    }
    const planLimit = Math.max(1, Math.min(200, Math.round(Number(configPlanLimit) || 1)));
    const pageLimit = Math.max(1, Math.min(500, Math.round(Number(configPageLimit) || 1)));
    const publishSizeLimitMb = Math.max(1, Math.min(100, Math.round(Number(configPublishLimitMb) || 1)));
    const serviceExpiresAt = parseDateInputToIso(configExpireDate);
    if (configExpireDate.trim() && !serviceExpiresAt) {
      setTip(SUPER_ADMIN_MESSAGES.expireDateInvalid);
      return;
    }
    const expired =
      !!serviceExpiresAt &&
      Number.isFinite(new Date(serviceExpiresAt).getTime()) &&
      new Date(serviceExpiresAt).getTime() <= nowMs;
    const nextStatus: SiteStatus = expired ? "maintenance" : selectedMerchantSite.status;
    const sortConfig = {
      recommendedCountryRank: parseRankInput(configRecommendedCountryRank),
      recommendedProvinceRank: parseRankInput(configRecommendedProvinceRank),
      recommendedCityRank: parseRankInput(configRecommendedCityRank),
      industryCountryRank: parseRankInput(configIndustryCountryRank),
      industryProvinceRank: parseRankInput(configIndustryProvinceRank),
      industryCityRank: parseRankInput(configIndustryCityRank),
    };
    let nextMerchantCardImage = configMerchantCardImage.trim();
    if (/^data:image\//i.test(nextMerchantCardImage)) {
      const uploadedUrl = await uploadMerchantCardImageDataUrlToSupabase(nextMerchantCardImage, selectedMerchantSite.id);
      if (!uploadedUrl) {
        setTip("商户框图片仍是内嵌图片，且上传到存储失败，请重新上传后再保存");
        return;
      }
      nextMerchantCardImage = uploadedUrl;
      setConfigMerchantCardImage(uploadedUrl);
    }
    const prevPermission = selectedMerchantSite.permissionConfig ?? createDefaultMerchantPermissionConfig();
    const prevSortConfig = selectedMerchantSite.sortConfig ?? createDefaultMerchantSortConfig();
    const prevMerchantCardImage = (selectedMerchantSite.merchantCardImageUrl ?? "").trim();
    const formatDateValue = (iso: string | null | undefined) => isoToDateInput(iso) || "未设置";
    const formatBool = (value: boolean) => (value ? "开启" : "关闭");
    const formatRank = (value: number | null | undefined) => (typeof value === "number" ? `${value}` : "留空");
    const pendingChanges: string[] = [];
    if ((selectedMerchantSite.serviceExpiresAt ?? null) !== serviceExpiresAt) {
      pendingChanges.push(`到期时间：${formatDateValue(selectedMerchantSite.serviceExpiresAt)} -> ${formatDateValue(serviceExpiresAt)}`);
    }
    if (prevPermission.planLimit !== planLimit) {
      pendingChanges.push(`方案数量上限：${prevPermission.planLimit} -> ${planLimit}`);
    }
    if (prevPermission.pageLimit !== pageLimit) {
      pendingChanges.push(`页面上限数量：${prevPermission.pageLimit} -> ${pageLimit}`);
    }
    if (prevPermission.publishSizeLimitMb !== publishSizeLimitMb) {
      pendingChanges.push(`发布体积限制：${prevPermission.publishSizeLimitMb}MB -> ${publishSizeLimitMb}MB`);
    }
    if (prevPermission.allowInsertBackground !== configAllowInsertBackground) {
      pendingChanges.push(`插入背景：${formatBool(prevPermission.allowInsertBackground)} -> ${formatBool(configAllowInsertBackground)}`);
    }
    if (prevPermission.allowThemeEffects !== configAllowThemeEffects) {
      pendingChanges.push(`主题效果：${formatBool(prevPermission.allowThemeEffects)} -> ${formatBool(configAllowThemeEffects)}`);
    }
    if (prevPermission.allowButtonBlock !== configAllowButtonBlock) {
      pendingChanges.push(`按钮区块：${formatBool(prevPermission.allowButtonBlock)} -> ${formatBool(configAllowButtonBlock)}`);
    }
    if (prevPermission.allowGalleryBlock !== configAllowGalleryBlock) {
      pendingChanges.push(`相册区块：${formatBool(prevPermission.allowGalleryBlock)} -> ${formatBool(configAllowGalleryBlock)}`);
    }
    if (prevPermission.allowMusicBlock !== configAllowMusicBlock) {
      pendingChanges.push(`音乐区块：${formatBool(prevPermission.allowMusicBlock)} -> ${formatBool(configAllowMusicBlock)}`);
    }
    if (prevPermission.allowProductBlock !== configAllowProductBlock) {
      pendingChanges.push(`产品区块：${formatBool(prevPermission.allowProductBlock)} -> ${formatBool(configAllowProductBlock)}`);
    }
    if (prevPermission.allowBookingBlock !== configAllowBookingBlock) {
      pendingChanges.push(`预约区块：${formatBool(prevPermission.allowBookingBlock)} -> ${formatBool(configAllowBookingBlock)}`);
    }
    if (prevMerchantCardImage !== nextMerchantCardImage) {
      pendingChanges.push(`商户框图片：${prevMerchantCardImage ? "已上传" : "默认样式"} -> ${nextMerchantCardImage ? "已上传" : "默认样式"}`);
    }
    if (prevSortConfig.recommendedCountryRank !== sortConfig.recommendedCountryRank) {
      pendingChanges.push(`推荐-国家排序：${formatRank(prevSortConfig.recommendedCountryRank)} -> ${formatRank(sortConfig.recommendedCountryRank)}`);
    }
    if (prevSortConfig.recommendedProvinceRank !== sortConfig.recommendedProvinceRank) {
      pendingChanges.push(`推荐-省排序：${formatRank(prevSortConfig.recommendedProvinceRank)} -> ${formatRank(sortConfig.recommendedProvinceRank)}`);
    }
    if (prevSortConfig.recommendedCityRank !== sortConfig.recommendedCityRank) {
      pendingChanges.push(`推荐-城市排序：${formatRank(prevSortConfig.recommendedCityRank)} -> ${formatRank(sortConfig.recommendedCityRank)}`);
    }
    if (prevSortConfig.industryCountryRank !== sortConfig.industryCountryRank) {
      pendingChanges.push(`行业-国家排序：${formatRank(prevSortConfig.industryCountryRank)} -> ${formatRank(sortConfig.industryCountryRank)}`);
    }
    if (prevSortConfig.industryProvinceRank !== sortConfig.industryProvinceRank) {
      pendingChanges.push(`行业-省排序：${formatRank(prevSortConfig.industryProvinceRank)} -> ${formatRank(sortConfig.industryProvinceRank)}`);
    }
    if (prevSortConfig.industryCityRank !== sortConfig.industryCityRank) {
      pendingChanges.push(`行业-城市排序：${formatRank(prevSortConfig.industryCityRank)} -> ${formatRank(sortConfig.industryCityRank)}`);
    }
    if (pendingChanges.length === 0) {
      setTip(SUPER_ADMIN_MESSAGES.configNoChanges);
      return;
    }
    const confirmMessage = [
      `即将保存 ${pendingChanges.length} 项变更：`,
      ...pendingChanges.map((item, index) => `${index + 1}. ${item}`),
      "",
      "确认保存吗？",
    ].join("\n");
    if (typeof window !== "undefined" && !window.confirm(confirmMessage)) {
      return;
    }
    const beforeSnapshot = createMerchantConfigSnapshot(selectedMerchantSite);
    const afterSnapshot: MerchantConfigSnapshot = {
      serviceExpiresAt,
      permissionConfig: {
        planLimit,
        pageLimit,
        publishSizeLimitMb,
        allowInsertBackground: configAllowInsertBackground,
        allowThemeEffects: configAllowThemeEffects,
        allowButtonBlock: configAllowButtonBlock,
        allowGalleryBlock: configAllowGalleryBlock,
        allowMusicBlock: configAllowMusicBlock,
        allowProductBlock: configAllowProductBlock,
        allowBookingBlock: configAllowBookingBlock,
      },
      merchantCardImageUrl: nextMerchantCardImage,
      sortConfig,
    };
    const historySummary =
      pendingChanges.length <= 3
        ? pendingChanges.join("；")
        : `${pendingChanges.slice(0, 3).join("；")}；共 ${pendingChanges.length} 项`;
    const historyEntry = buildMerchantConfigHistoryEntry({
      operator: operatorName,
      summary: historySummary,
      before: beforeSnapshot,
      after: afterSnapshot,
    });
    const nextSites = stateRef.current.sites.map((item) =>
      item.id === selectedMerchantSite.id
        ? {
            ...item,
            status: nextStatus,
            serviceExpiresAt: afterSnapshot.serviceExpiresAt,
            permissionConfig: afterSnapshot.permissionConfig,
            merchantCardImageUrl: afterSnapshot.merchantCardImageUrl,
            sortConfig: afterSnapshot.sortConfig,
            configHistory: appendMerchantConfigHistory(item.configHistory, historyEntry),
            updatedAt: nextIsoNow(),
          }
        : item,
    );
    const nextStatePreviewRaw: PlatformState = {
      ...stateRef.current,
      sites: nextSites,
    };
    const nextStatePreview = compactPlatformStateForStorage(nextStatePreviewRaw);
    const nextStateBytes = estimateUtf8Size(JSON.stringify(nextStatePreview));
    if (nextStateBytes > MAX_PLATFORM_STATE_STORAGE_BYTES) {
      setTip(`${SUPER_ADMIN_MESSAGES.configTooLargePrefix}（${formatBytes(nextStateBytes)}），请压缩图片或清理历史后重试`);
      return;
    }

    const persisted = commit(() =>
      withAudit(
        {
          ...nextStatePreview,
        },
        "merchant_config_update",
        "site",
        selectedMerchantSite.id,
        "配置已更新",
      ),
    );
    if (!persisted) {
      setTip(SUPER_ADMIN_MESSAGES.configSaveFailedStorage);
      return;
    }
    setTip(SUPER_ADMIN_MESSAGES.configSaved);
  }

  function rollbackMerchantConfigByHistoryAction(historyId: string) {
    if (!guard("user.manage", SUPER_ADMIN_MESSAGES.noUserPermission)) return;
    if (!selectedMerchantSite) {
      setTip(SUPER_ADMIN_MESSAGES.selectMerchantFirst);
      return;
    }
    const targetHistory = (selectedMerchantSite.configHistory ?? []).find((item) => item.id === historyId);
    if (!targetHistory) {
      setTip(SUPER_ADMIN_MESSAGES.configRollbackMissing);
      return;
    }
    const rollbackTarget = targetHistory.before;
    const rollbackImageUnavailableInHistory = isInlineImageHistoryPlaceholder(rollbackTarget.merchantCardImageUrl);
    const fallbackMerchantCardImage = (selectedMerchantSite.merchantCardImageUrl ?? "").trim();
    const rollbackMerchantCardImage = rollbackImageUnavailableInHistory
      ? fallbackMerchantCardImage
      : (rollbackTarget.merchantCardImageUrl ?? "").trim();
    const rollbackBeforeSnapshot = createMerchantConfigSnapshot(selectedMerchantSite);
    const rollbackAfterSnapshot: MerchantConfigSnapshot = {
      serviceExpiresAt: rollbackTarget.serviceExpiresAt ?? null,
      permissionConfig: rollbackTarget.permissionConfig ?? createDefaultMerchantPermissionConfig(),
      merchantCardImageUrl: rollbackMerchantCardImage,
      sortConfig: rollbackTarget.sortConfig ?? createDefaultMerchantSortConfig(),
    };
    const rollbackDiffLines = buildMerchantConfigDiffLines(rollbackBeforeSnapshot, rollbackAfterSnapshot);
    if (rollbackDiffLines.length === 0) {
      setTip(SUPER_ADMIN_MESSAGES.configNoChanges);
      return;
    }
    if (typeof window !== "undefined") {
      const previewLines = rollbackDiffLines.slice(0, 12);
      const ok = window.confirm(
        [
          `将回滚到 ${fmt(targetHistory.at)} 的配置版本：`,
          targetHistory.summary || "-",
          "",
          "以下内容将会变更：",
          ...previewLines.map((line, index) => `${index + 1}. ${line}`),
          rollbackDiffLines.length > previewLines.length
            ? `... 其余 ${rollbackDiffLines.length - previewLines.length} 项变更请在保存后查看历史`
            : "",
          "",
          "确认继续吗？",
        ]
          .filter(Boolean)
          .join("\n"),
      );
      if (!ok) {
        setTip(SUPER_ADMIN_MESSAGES.configRollbackCanceled);
        return;
      }
    }
    const rollbackExpired =
      !!rollbackAfterSnapshot.serviceExpiresAt &&
      Number.isFinite(new Date(rollbackAfterSnapshot.serviceExpiresAt).getTime()) &&
      new Date(rollbackAfterSnapshot.serviceExpiresAt).getTime() <= nowMs;
    const rollbackHistoryEntry = buildMerchantConfigHistoryEntry({
      operator: operatorName,
      summary: `回滚到 ${fmt(targetHistory.at)} 配置`,
      before: rollbackBeforeSnapshot,
      after: rollbackAfterSnapshot,
    });
    const nextSites = stateRef.current.sites.map((site) =>
      site.id === selectedMerchantSite.id
        ? {
            ...site,
            status: rollbackExpired ? "maintenance" : site.status,
            serviceExpiresAt: rollbackAfterSnapshot.serviceExpiresAt,
            permissionConfig: rollbackAfterSnapshot.permissionConfig,
            merchantCardImageUrl: rollbackAfterSnapshot.merchantCardImageUrl,
            sortConfig: rollbackAfterSnapshot.sortConfig,
            configHistory: appendMerchantConfigHistory(site.configHistory, rollbackHistoryEntry),
            updatedAt: nextIsoNow(),
          }
        : site,
    );
    const nextStatePreviewRaw: PlatformState = {
      ...stateRef.current,
      sites: nextSites,
    };
    const nextStatePreview = compactPlatformStateForStorage(nextStatePreviewRaw);
    const nextStateBytes = estimateUtf8Size(JSON.stringify(nextStatePreview));
    if (nextStateBytes > MAX_PLATFORM_STATE_STORAGE_BYTES) {
      setTip(`${SUPER_ADMIN_MESSAGES.configRollbackFailedStorage}（${formatBytes(nextStateBytes)}）`);
      return;
    }
    const persisted = commit(() =>
      withAudit(
        {
          ...nextStatePreview,
        },
        "merchant_config_rollback",
        "site",
        selectedMerchantSite.id,
        `rollback:${targetHistory.id}`,
      ),
    );
    if (!persisted) {
      setTip(SUPER_ADMIN_MESSAGES.configRollbackFailedStorage);
      return;
    }
    const latestSite = nextStatePreview.sites.find((site) => site.id === selectedMerchantSite.id);
    if (latestSite) hydrateMerchantConfigDraft(latestSite);
    setTip(
      rollbackImageUnavailableInHistory
        ? `${SUPER_ADMIN_MESSAGES.configRollbackSaved}（历史图片已精简，本次保留当前商户图）`
        : SUPER_ADMIN_MESSAGES.configRollbackSaved,
    );
  }

  function createRoleAction() {
    if (!guard("role.manage", "无角色管理权限")) return;
    if (!roleName.trim() || rolePermissions.length === 0) {
      setTip("请填写角色并勾选权限");
      return;
    }

    const role = createRole({
      name: roleName,
      description: "自定义角色",
      permissions: rolePermissions,
    });

    commit((prev) =>
      withAudit(
        { ...prev, roles: [role, ...prev.roles] },
        "role_create",
        "role",
        role.id,
        role.name,
      ),
    );

    setRoleName("");
    setRolePermissions(["dashboard.view"]);
  }

  function toggleFeatureAction(siteId: string, key: FeatureKey) {
    if (!guard("feature.manage", "无功能开通权限")) return;
    commit((prev) =>
      withAudit(
        {
          ...prev,
          sites: prev.sites.map((item) =>
            item.id === siteId
              ? {
                  ...item,
                  features: { ...item.features, [key]: !item.features[key] },
                  updatedAt: nextIsoNow(),
                }
              : item,
          ),
        },
        "feature_toggle",
        "site",
        siteId,
        key,
      ),
    );
  }

  function createAssetAction() {
    if (!guard("page_asset.manage", "无页面资产管理权限")) return;
    if (!activeAssetSiteId || !assetPath.trim() || !assetGroup.trim()) {
      setTip("请完整填写页面资产信息");
      return;
    }
    if (!assetPath.startsWith("/")) {
      setTip("页面路径必须以 / 开头");
      return;
    }

    const asset = createPageAsset({
      siteId: activeAssetSiteId,
      pagePath: assetPath,
      group: assetGroup,
      tags: splitTags(assetTags),
      status: "draft",
      updatedBy: operatorName,
    });

    commit((prev) =>
      withAudit(
        { ...prev, pageAssets: [asset, ...prev.pageAssets] },
        "asset_create",
        "asset",
        asset.id,
        asset.pagePath,
      ),
    );

    setAssetPath("");
    setAssetGroup("");
    setAssetTags("");
  }

  function requestApprovalAction(type: ApprovalType) {
    const permission = type === "rollback" ? "rollback.trigger" : "publish.trigger";
    if (!guard(permission, SUPER_ADMIN_MESSAGES.noPublishPermission)) return;
    if (!selectedPublishSite) {
      setTip("请先选择站点");
      return;
    }
    if (type === "publish" && !confirmPublishChecklistAction("发起发布审批")) return;

    const approval = createApprovalRecord({
      type,
      tenantId: selectedPublishSite.tenantId,
      siteId: selectedPublishSite.id,
      summary: publishNote.trim() || `${selectedPublishSite.name} ${type}`,
      requestedBy: operatorName,
    });

    commit((prev) =>
      withAudit(
        { ...prev, approvals: [approval, ...prev.approvals].slice(0, 500) },
        "approval_create",
        "approval",
        approval.id,
        approval.summary,
      ),
    );

    setPublishNote("");
  }

  function directPublishAction(failed: boolean) {
    if (!guard("publish.trigger", SUPER_ADMIN_MESSAGES.noPublishPermission)) return;
    if (!selectedPublishSite) {
      setTip("请先选择站点");
      return;
    }
    if (!failed && !confirmPublishChecklistAction("直接发布")) return;

    const status: PublishStatus = failed ? "failed" : "success";
    const note =
      publishNote.trim() ||
      (failed ? SUPER_ADMIN_MESSAGES.directPublishNoteFailed : SUPER_ADMIN_MESSAGES.directPublishNoteSuccess);

    commit((prev) => {
      const site = prev.sites.find((item) => item.id === selectedPublishSite.id);
      if (!site) return prev;

      const version = status === "success" ? site.publishedVersion + 1 : site.publishedVersion;

      let next: PlatformState = {
        ...prev,
        sites: prev.sites.map((item) =>
          item.id === site.id
            ? {
                ...item,
                publishedVersion: version,
                lastPublishedAt: status === "success" ? nextIsoNow() : item.lastPublishedAt,
                updatedAt: nextIsoNow(),
              }
            : item,
        ),
        publishRecords: [
          {
            id: `publish-${Date.now()}`,
            tenantId: site.tenantId,
            siteId: site.id,
            version,
            status,
            operator: operatorName,
            notes: note,
            at: nextIsoNow(),
          },
          ...prev.publishRecords,
        ].slice(0, 600),
      };

      if (failed) {
        next = applyAlert(
          next,
          createAlertRecord({
            level: "critical",
            title: "发布失败",
            message: `${site.name}: ${note}`,
          }),
        );
      }

      return withAudit(next, "publish_direct", "site", site.id, `${status}:${note}`);
    });

    trackPublishEvent({ success: !failed, bytes: note.length, changedBlocks: 0, reason: note });
    setPublishNote("");
  }

  function applyMerchantTableSort(field: MerchantTableSortField, order: "asc" | "desc") {
    setMerchantTableSortField(field);
    setMerchantTableSortOrder(order);
    setMerchantTablePage(1);
  }

  function toggleMerchantTableSort(field: MerchantTableSortField) {
    if (merchantTableSortField !== field) {
      applyMerchantTableSort(field, "asc");
      return;
    }
    applyMerchantTableSort(field, merchantTableSortOrder === "asc" ? "desc" : "asc");
  }

  function merchantSortIconClass(field: MerchantTableSortField, order: "asc" | "desc") {
    const active = merchantTableSortField === field && merchantTableSortOrder === order;
    return active ? "text-black" : "text-slate-300";
  }

  function renderMerchantSortToggle(field: MerchantTableSortField) {
    const nextOrder = merchantTableSortField === field && merchantTableSortOrder === "asc" ? "desc" : "asc";
    return (
      <button
        type="button"
        className="inline-flex h-4 select-none flex-col items-center justify-between leading-none hover:text-slate-700"
        onClick={() => toggleMerchantTableSort(field)}
        title={`点击切换为${nextOrder === "asc" ? "正序" : "倒序"}`}
        aria-label={`切换排序：${nextOrder === "asc" ? "正序" : "倒序"}`}
      >
        <span className={`text-[9px] leading-[8px] ${merchantSortIconClass(field, "asc")}`}>▲</span>
        <span className={`text-[9px] leading-[8px] ${merchantSortIconClass(field, "desc")}`}>▼</span>
      </button>
    );
  }

  const sidebarMenus: Array<{ key: "site_editor" | "user_manage" | "merchant_id_rules" | "stats" | "logs"; label: string; hint: string }> = [
    { key: "site_editor", label: "网站编辑", hint: "总站页面与站点配置" },
    { key: "user_manage", label: "用户管理", hint: "用户列表与权限服务" },
    { key: "merchant_id_rules", label: "禁用ID设置", hint: "注册跳号与规则管理" },
    { key: "stats", label: "数据统计", hint: "平台关键指标" },
    { key: "logs", label: "日志", hint: "审计与告警记录" },
  ];

  if (!hydrated || !authed) {
    return (
      <main className="min-h-screen bg-slate-100 p-6">
        <div className="mx-auto max-w-6xl rounded-lg border bg-white p-4 text-sm text-slate-600">
          正在验证总后台登录...
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-100">
      <div className="flex min-h-screen">
        <aside className="w-64 border-r bg-white">
          <div className="border-b px-5 py-4">
            <h1 className="text-lg font-bold">Merchant 超级后台</h1>
          </div>
          <nav className="space-y-1 p-3">
            {sidebarMenus.map((menu) => (
              <button
                key={menu.key}
                className={`w-full rounded-md px-3 py-2 text-left text-sm ${
                  activeMenu === menu.key ? "bg-blue-50 text-blue-700" : "text-slate-700 hover:bg-slate-100"
                }`}
                onClick={() => setActiveMenu(menu.key)}
              >
                <div className="font-medium">{menu.label}</div>
                <div className="text-xs text-slate-500">{menu.hint}</div>
              </button>
            ))}
          </nav>
        </aside>

        <div className="flex-1">
          <header className="flex items-center justify-between border-b bg-white px-6 py-3">
            <div className="flex items-center gap-2 text-sm">
              <span className="text-slate-500">当前菜单</span>
              <span className="rounded border bg-slate-50 px-2 py-1 font-medium">{sidebarMenus.find((x) => x.key === activeMenu)?.label}</span>
            </div>
            <div className="flex items-center gap-3 text-sm">
              <span className="text-slate-600">欢迎您，{operatorName}</span>
              <button
                className="rounded border px-3 py-2"
                onClick={() => {
                  clearSuperAdminAuthenticated();
                  window.location.href = buildSuperAdminLoginHref("/super-admin");
                }}
              >
                退出超级后台登录
              </button>
            </div>
          </header>

          {tip ? (
            <div className="pointer-events-none fixed left-4 right-4 top-20 z-[130] md:left-72 md:right-auto md:w-[min(680px,calc(100vw-20rem))]">
              <div
                className="pointer-events-auto rounded border border-amber-300 bg-amber-50/95 px-3 py-2 text-sm text-amber-700 shadow-lg backdrop-blur"
                role="status"
                aria-live="polite"
                onClick={() => setTip("")}
              >
                {tip}
              </div>
            </div>
          ) : null}

          <div className="space-y-4 p-4">
            {activeMenu === "site_editor" ? (
              <>
                <section className="rounded-lg border bg-white p-4">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <Link
                      href="/super-admin/editor/latest"
                      target="_blank"
                      rel="noreferrer"
                      className="rounded border bg-black px-3 py-2 text-white"
                    >
                      新窗口打开编辑器
                    </Link>
                    <Link
                      href={buildPlatformHomeHref()}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded border px-3 py-2"
                    >
                      查看总站首页
                    </Link>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
                    <span className="text-slate-600">商户默认排序规则</span>
                    <select
                      className="rounded border px-3 py-2"
                      value={merchantDefaultSortRule}
                      onChange={(event) => updateMerchantDefaultSortRuleAction(event.target.value as MerchantSortRule)}
                    >
                      {MERCHANT_SORT_RULES.map((rule) => (
                        <option key={rule} value={rule}>
                          {rule === "created_desc"
                            ? "默认：最新注册优先"
                            : rule === "created_asc"
                              ? "最早注册优先"
                              : rule === "name_asc"
                                ? "名称升序"
                                : rule === "name_desc"
                                  ? "名称降序"
                                  : "30日访问量优先"}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="mt-3 rounded border bg-slate-50 p-3 text-xs">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="font-medium text-slate-700">发布前回归清单</span>
                      <span className="text-slate-500">
                        {releaseChecklistCheckedCount}/{RELEASE_REGRESSION_CHECKLIST.length}
                      </span>
                    </div>
                    <div className="grid gap-2 md:grid-cols-2">
                      {RELEASE_REGRESSION_CHECKLIST.map((item) => (
                        <label key={item.id} className="flex items-start gap-2 rounded border bg-white px-2 py-1.5">
                          <input
                            type="checkbox"
                            className="mt-0.5"
                            checked={releaseChecklistState[item.id] === true}
                            onChange={(e) =>
                              setReleaseChecklistState((prev) => ({
                                ...prev,
                                [item.id]: e.target.checked,
                              }))
                            }
                          />
                          <span className="text-slate-700">{item.label}</span>
                        </label>
                      ))}
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <button
                        type="button"
                        className="rounded border px-2 py-1"
                        onClick={() =>
                          setReleaseChecklistState(
                            RELEASE_REGRESSION_CHECKLIST.reduce<Record<string, boolean>>((acc, item) => {
                              acc[item.id] = true;
                              return acc;
                            }, {}),
                          )
                        }
                      >
                        全部勾选
                      </button>
                      <button
                        type="button"
                        className="rounded border px-2 py-1"
                        onClick={() =>
                          setReleaseChecklistState(
                            RELEASE_REGRESSION_CHECKLIST.reduce<Record<string, boolean>>((acc, item) => {
                              acc[item.id] = false;
                              return acc;
                            }, {}),
                          )
                        }
                      >
                        清空
                      </button>
                    </div>
                  </div>
                </section>

                {false ? (
                  <>
                <section className="hidden">
                  <div className="rounded-lg border bg-white p-4 space-y-2">
                    <h2 className="font-semibold">总站规划与行业分类</h2>
                    <div className="grid gap-2 md:grid-cols-2">
                      <input className="rounded border px-3 py-2 text-sm" placeholder="分类名称" value={categoryName} onChange={(e) => setCategoryName(e.target.value)} />
                      <input className="rounded border px-3 py-2 text-sm" placeholder="slug（brand-site）" value={categorySlug} onChange={(e) => setCategorySlug(e.target.value)} />
                      <input className="rounded border px-3 py-2 text-sm md:col-span-2" placeholder="分类说明" value={categoryDescription} onChange={(e) => setCategoryDescription(e.target.value)} />
                    </div>
                    <button className="rounded border bg-black px-3 py-2 text-sm text-white" onClick={createCategoryAction}>新增行业分类</button>
                    <div className="space-y-1 border-t pt-2">
                      {sortedCategories.slice(0, 10).map((item) => (
                        <div key={item.id} className="flex items-center justify-between rounded border px-2 py-1 text-xs">
                          <span>{item.name} ({item.slug})</span>
                          <button className={`rounded border px-2 py-1 ${badgeClass(item.status)}`} onClick={() => toggleCategoryStatusAction(item.id, item.status)}>
                            {item.status === "active" ? "启用中" : "已停用"}
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-lg border bg-white p-4 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <h2 className="font-semibold">总站导航配置（数据面板）</h2>
                      <span
                        className={`rounded border px-2 py-1 text-xs ${
                          portalDirty
                            ? "border-amber-300 bg-amber-50 text-amber-700"
                            : "border-emerald-300 bg-emerald-50 text-emerald-700"
                        }`}
                      >
                        {portalDirty ? "草稿未保存" : "已与总站同步"}
                      </span>
                    </div>

                    <div className="grid gap-4 2xl:grid-cols-[1.15fr_1fr]">
                      <div className="space-y-3">
                        <div className="rounded-lg border p-3">
                          <div className="mb-2 text-xs font-medium text-slate-500">Hero 区域</div>
                          <div className="grid gap-2">
                            <input
                              className="rounded border px-3 py-2 text-sm"
                              placeholder="总站主标题"
                              value={portalDraft.heroTitle}
                              onChange={(e) =>
                                updatePortalDraft((prev) => ({ ...prev, heroTitle: e.target.value }))
                              }
                            />
                            <textarea
                              className="min-h-[72px] rounded border px-3 py-2 text-sm"
                              placeholder="总站副标题"
                              value={portalDraft.heroSubtitle}
                              onChange={(e) =>
                                updatePortalDraft((prev) => ({ ...prev, heroSubtitle: e.target.value }))
                              }
                            />
                          </div>
                        </div>

                        <div className="rounded-lg border p-3">
                          <div className="mb-2 flex items-center justify-between">
                            <div className="text-xs font-medium text-slate-500">首页分区</div>
                            <button
                              className="rounded border px-2 py-1 text-xs"
                              onClick={addPortalSectionAction}
                              type="button"
                            >
                              新增分区
                            </button>
                          </div>

                          <div className="space-y-2">
                            {portalDraft.sections.length > 0 ? (
                              portalDraft.sections.map((section, idx) => {
                                const active = selectedPortalSection?.id === section.id;
                                return (
                                  <button
                                    key={section.id}
                                    type="button"
                                    className={`w-full rounded border px-3 py-2 text-left text-xs ${
                                      active ? "border-blue-300 bg-blue-50" : "hover:bg-slate-50"
                                    }`}
                                    onClick={() => setSelectedPortalSectionId(section.id)}
                                  >
                                    <div className="flex items-center justify-between gap-2">
                                      <span className="truncate">
                                        #{idx + 1} {section.title || "未命名分区"}
                                      </span>
                                      <span className={`rounded border px-2 py-0.5 ${badgeClass(section.visible ? "active" : "disabled")}`}>
                                        {section.visible ? "显示" : "隐藏"}
                                      </span>
                                    </div>
                                    <div className="mt-1 truncate text-slate-500">
                                      {categoryMap.get(section.categoryId) ?? "未分类"} | {section.description || "暂无描述"}
                                    </div>
                                  </button>
                                );
                              })
                            ) : (
                              <div className="rounded border border-dashed px-3 py-4 text-xs text-slate-500">
                                暂无首页分区，点击“新增分区”开始编辑。
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="rounded-lg border p-3">
                          <div className="mb-2 text-xs font-medium text-slate-500">当前分区属性</div>
                          {selectedPortalSection ? (
                            <div className="space-y-2">
                              <input
                                className="w-full rounded border px-3 py-2 text-sm"
                                placeholder="分区标题"
                                value={selectedPortalSection.title}
                                onChange={(e) =>
                                  updatePortalSectionField(selectedPortalSection.id, "title", e.target.value)
                                }
                              />
                              <textarea
                                className="min-h-[72px] w-full rounded border px-3 py-2 text-sm"
                                placeholder="分区说明"
                                value={selectedPortalSection.description}
                                onChange={(e) =>
                                  updatePortalSectionField(selectedPortalSection.id, "description", e.target.value)
                                }
                              />
                              <select
                                className="w-full rounded border px-3 py-2 text-sm"
                                value={selectedPortalSection.categoryId}
                                onChange={(e) =>
                                  updatePortalSectionField(selectedPortalSection.id, "categoryId", e.target.value)
                                }
                              >
                                {sortedCategories.map((item) => (
                                  <option key={item.id} value={item.id}>
                                    {item.name} ({item.status === "active" ? "启用" : "停用"})
                                  </option>
                                ))}
                              </select>
                              <div className="flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  className="rounded border px-3 py-2 text-xs"
                                  onClick={() =>
                                    updatePortalSectionField(
                                      selectedPortalSection.id,
                                      "visible",
                                      !selectedPortalSection.visible,
                                    )
                                  }
                                >
                                  {selectedPortalSection.visible ? "设为隐藏" : "设为显示"}
                                </button>
                                <button
                                  type="button"
                                  className="rounded border px-3 py-2 text-xs"
                                  onClick={() => movePortalSectionAction(selectedPortalSection.id, -1)}
                                  disabled={selectedPortalSectionIndex <= 0}
                                >
                                  上移
                                </button>
                                <button
                                  type="button"
                                  className="rounded border px-3 py-2 text-xs"
                                  onClick={() => movePortalSectionAction(selectedPortalSection.id, 1)}
                                  disabled={
                                    selectedPortalSectionIndex < 0 ||
                                    selectedPortalSectionIndex >= portalDraft.sections.length - 1
                                  }
                                >
                                  下移
                                </button>
                                <button
                                  type="button"
                                  className="rounded border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-700"
                                  onClick={() => removePortalSectionAction(selectedPortalSection.id)}
                                >
                                  删除分区
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="rounded border border-dashed px-3 py-4 text-xs text-slate-500">
                              请选择一个分区后可编辑属性。
                            </div>
                          )}
                        </div>

                        <div className="flex flex-wrap gap-2">
                          <button
                            className="rounded border bg-black px-3 py-2 text-sm text-white"
                            onClick={savePortalDraftAction}
                            type="button"
                          >
                            保存总站页面
                          </button>
                          <button className="rounded border px-3 py-2 text-sm" onClick={resetPortalDraftAction} type="button">
                            重置为当前线上配置
                          </button>
                        </div>
                      </div>

                      <div className="rounded-xl border bg-slate-50 p-3">
                        <div className="mb-2 flex items-center justify-between">
                          <h3 className="text-sm font-semibold">实时预览（导航数据）</h3>
                          <span className="text-xs text-slate-500">对应 /</span>
                        </div>

                        <div className="space-y-3">
                          <div className="rounded-lg border bg-white p-4">
                            <div className="text-[11px] uppercase tracking-wide text-slate-500">总站 Hero</div>
                            <div className="mt-1 text-lg font-semibold text-slate-900">
                              {portalDraft.heroTitle || "请填写总站主标题"}
                            </div>
                            <p className="mt-1 text-sm text-slate-600">
                              {portalDraft.heroSubtitle || "请填写总站副标题"}
                            </p>
                          </div>

                          <div className="rounded-lg border bg-white p-4">
                            <div className="mb-2 flex items-center justify-between">
                              <div className="text-sm font-semibold text-slate-900">首页分区</div>
                              <div className="text-xs text-slate-500">{previewVisibleSections.length} 个显示中</div>
                            </div>
                            {previewVisibleSections.length > 0 ? (
                              <div className="space-y-2">
                                {previewVisibleSections.map((section) => {
                                  const sites = portalSitesByCategory.get(section.categoryId) ?? [];
                                  return (
                                    <div key={section.id} className="rounded border bg-slate-50 px-3 py-2">
                                      <div className="text-sm font-medium text-slate-900">{section.title || "未命名分区"}</div>
                                      <div className="text-xs text-slate-500">
                                        {categoryMap.get(section.categoryId) ?? "未分类"} | 站点 {sites.length}
                                      </div>
                                      <div className="mt-1 text-xs text-slate-600">{section.description || "暂无说明"}</div>
                                    </div>
                                  );
                                })}
                              </div>
                            ) : (
                              <div className="rounded border border-dashed px-3 py-4 text-xs text-slate-500">
                                当前没有显示中的分区。
                              </div>
                            )}
                          </div>

                          <div className="rounded-lg border bg-white p-4">
                            <div className="mb-2 text-sm font-semibold text-slate-900">最近入驻商家（示例）</div>
                            {portalNewestSites.length > 0 ? (
                              <div className="space-y-1">
                                {portalNewestSites.map((site) => (
                                  <div key={site.id} className="flex items-center justify-between rounded border bg-slate-50 px-2 py-1 text-xs">
                                    <span className="truncate">{site.name}</span>
                                    <span className="text-slate-500">v{site.publishedVersion}</span>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className="rounded border border-dashed px-3 py-4 text-xs text-slate-500">
                                暂无商家站点。
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </section>
                  </>
                ) : null}

                <section className="grid gap-4 xl:grid-cols-2">
                  <div className="rounded-lg border bg-white p-4 space-y-2">
                    <h2 className="font-semibold">站点列表与开通</h2>
                    <div className="grid gap-2 md:grid-cols-2">
                      <select className="rounded border px-3 py-2 text-sm" value={activeSiteTenantId} onChange={(e) => setSiteTenantId(e.target.value)}>
                        {state.tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                      </select>
                      <input className="rounded border px-3 py-2 text-sm" placeholder="站点名称" value={siteName} onChange={(e) => setSiteName(e.target.value)} />
                      <input className="rounded border px-3 py-2 text-sm" placeholder="域名" value={siteDomain} onChange={(e) => setSiteDomain(e.target.value)} />
                      <select className="rounded border px-3 py-2 text-sm" value={activeSiteCategoryId} onChange={(e) => setSiteCategoryId(e.target.value)}>
                        {sortedCategories.filter((item) => item.status === "active").map((item) => (
                          <option key={item.id} value={item.id}>{item.name}</option>
                        ))}
                      </select>
                    </div>
                    <button className="rounded border bg-black px-3 py-2 text-sm text-white" onClick={createSiteAction}>新建站点</button>
                    <div className="space-y-1 border-t pt-2">
                      {state.sites.slice(0, 10).map((site) => (
                        <div key={site.id} className="rounded border p-2 text-xs">
                          <div className="flex justify-between">
                            <span>{site.name} ({tenantMap.get(site.tenantId)})</span>
                            <span className={`rounded border px-2 py-0.5 ${badgeClass(site.status)}`}>{siteStatusLabel(site.status)}</span>
                          </div>
                          <div className="mt-1 text-slate-500">{site.domain} | {site.category} | v{site.publishedVersion} | {fmt(site.lastPublishedAt)}</div>
                          <div className="mt-2">
                            <span className="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-slate-500">
                              站点页面由商户后台维护
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-lg border bg-white p-4 space-y-2">
                    <h2 className="font-semibold">发布与功能</h2>
                    <select className="w-full rounded border px-3 py-2 text-sm" value={activePublishSiteId} onChange={(e) => setPublishSiteId(e.target.value)}>
                      {state.sites.map((site) => <option key={site.id} value={site.id}>{site.name} (v{site.publishedVersion})</option>)}
                    </select>
                    <input
                      className="w-full rounded border px-3 py-2 text-sm"
                      placeholder={SUPER_ADMIN_MESSAGES.publishNotePlaceholder}
                      value={publishNote}
                      onChange={(e) => setPublishNote(e.target.value)}
                    />
                    <div className="flex flex-wrap gap-2">
                      <button className="rounded border px-3 py-2 text-sm" onClick={() => requestApprovalAction("publish" as ApprovalType)}>发起发布审批</button>
                      <button className="rounded border px-3 py-2 text-sm" onClick={() => requestApprovalAction("rollback" as ApprovalType)}>发起回滚审批</button>
                      <button className="rounded border bg-black px-3 py-2 text-sm text-white" onClick={() => directPublishAction(false)}>直接发布</button>
                    </div>
                    <div className="flex gap-2 border-t pt-2">
                      <select className="rounded border px-3 py-2 text-sm" value={activeFeatureSiteId} onChange={(e) => setFeatureSiteId(e.target.value)}>
                        {state.sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}
                      </select>
                      <button
                        className="rounded border px-3 py-2 text-sm"
                        onClick={() => {
                          if (!guard("feature.manage", "无功能开通权限")) return;
                          commit((prev) =>
                            withAudit(
                              {
                                ...prev,
                                sites: prev.sites.map((item) =>
                                  item.id === activeFeatureSiteId
                                    ? { ...item, features: createFeaturePackage("enterprise"), updatedAt: nextIsoNow() }
                                    : item,
                                ),
                              },
                              "feature_pack",
                              "site",
                              activeFeatureSiteId,
                              "enterprise",
                            ),
                          );
                        }}
                      >
                        应用企业套餐
                      </button>
                    </div>
                    <div className="space-y-1">
                      {FEATURE_CATALOG.slice(0, 4).map((f) => (
                        <div key={f.key} className="flex items-center justify-between rounded border px-2 py-1 text-xs">
                          <span>{f.label}</span>
                          <button className="rounded border px-2 py-1" onClick={() => toggleFeatureAction(activeFeatureSiteId, f.key as FeatureKey)}>
                            {selectedFeatureSite?.features[f.key] ? "已开通" : "未开通"}
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                </section>
              </>
            ) : null}

            {activeMenu === "user_manage" ? (
              <section className="space-y-4">
                <div className="rounded-lg border bg-white p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="grid min-w-0 flex-1 gap-2 md:grid-cols-5">
                      <input
                        className="rounded border px-3 py-2 text-sm md:col-span-2"
                        placeholder="搜索账号/邮箱/ID/名称/前缀/行业/城市/域名"
                        value={userKeyword}
                        onChange={(e) => {
                          setUserKeyword(e.target.value);
                          setMerchantTablePage(1);
                        }}
                      />
                      <div className="rounded border bg-slate-50 px-3 py-2 text-sm">注册用户：{filteredMerchantRows.length}</div>
                      <div className="rounded border bg-slate-50 px-3 py-2 text-sm">正常用户：{merchantActiveCount}</div>
                      <div className="rounded border bg-slate-50 px-3 py-2 text-sm">暂停用户：{merchantPausedCount}</div>
                      <div className="rounded border bg-slate-50 px-3 py-2 text-sm">未建站：{merchantUnlinkedCount}</div>
                    </div>
                    <button
                      type="button"
                      className="rounded bg-black px-4 py-2 text-sm text-white hover:bg-slate-800"
                      onClick={openManualUserDialog}
                    >
                      新增用户
                    </button>
                  </div>
                </div>

                {manualUserDialogOpen
                  ? renderTopMostOverlay(
                      <>
                        <button
                          type="button"
                          className="fixed inset-0 z-[2147483400] bg-black/45"
                          onClick={closeManualUserDialog}
                          aria-label="关闭新增用户弹窗"
                        />
                        <div className="fixed inset-0 z-[2147483401] flex items-center justify-center p-4">
                          <div className="w-full max-w-md rounded-2xl border bg-white shadow-2xl">
                            <div className="flex items-start justify-between gap-3 border-b px-5 py-4">
                              <div>
                                <div className="text-base font-semibold text-slate-900">新增用户</div>
                                <div className="mt-1 text-xs text-slate-500">
                                  直接创建可登录账号，跳过注册。登录时支持用户名或 8 位 ID。
                                </div>
                              </div>
                              <button
                                type="button"
                                className="rounded border bg-white px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-50"
                                onClick={closeManualUserDialog}
                                disabled={manualUserSubmitting}
                              >
                                关闭
                              </button>
                            </div>
                            <div className="space-y-3 px-5 py-4">
                              <label className="space-y-1">
                                <div className="text-sm text-slate-600">ID</div>
                                <input
                                  className="w-full rounded border px-3 py-2 text-sm"
                                  inputMode="numeric"
                                  maxLength={8}
                                  placeholder="8位数字，例如 10000001"
                                  value={manualUserId}
                                  onChange={(event) => setManualUserId(event.target.value.replace(/\D+/g, "").slice(0, 8))}
                                />
                              </label>
                              <label className="space-y-1">
                                <div className="text-sm text-slate-600">用户名</div>
                                <input
                                  className="w-full rounded border px-3 py-2 text-sm"
                                  placeholder="用于登录展示与用户名登录"
                                  value={manualUserName}
                                  onChange={(event) => setManualUserName(event.target.value)}
                                />
                              </label>
                              <label className="space-y-1">
                                <div className="text-sm text-slate-600">密码</div>
                                <input
                                  className="w-full rounded border px-3 py-2 text-sm"
                                  type="password"
                                  placeholder="至少 6 位"
                                  value={manualUserPassword}
                                  onChange={(event) => setManualUserPassword(event.target.value)}
                                />
                              </label>
                              <div className="rounded border border-dashed bg-slate-50 px-3 py-2 text-xs text-slate-500">
                                系统会自动生成内部邮箱并直接完成验证，创建后可按普通注册用户一样登录后台。
                              </div>
                              {manualUserError ? <div className="text-sm text-rose-600">{manualUserError}</div> : null}
                            </div>
                            <div className="flex justify-end gap-2 border-t px-5 py-4">
                              <button
                                type="button"
                                className="rounded border bg-white px-4 py-2 text-sm hover:bg-slate-50 disabled:opacity-50"
                                onClick={closeManualUserDialog}
                                disabled={manualUserSubmitting}
                              >
                                取消
                              </button>
                              <button
                                type="button"
                                className="rounded bg-black px-4 py-2 text-sm text-white hover:bg-slate-800 disabled:opacity-50"
                                onClick={() => void createManualUserAction()}
                                disabled={manualUserSubmitting}
                              >
                                {manualUserSubmitting ? "创建中..." : "确认创建"}
                              </button>
                            </div>
                          </div>
                        </div>
                      </>,
                    )
                  : null}

                <div className="space-y-4">
                  <div className="rounded-lg border bg-white p-4">
                    <div className="overflow-x-auto">
                      <table className="min-w-full text-left text-sm">
                        <thead className="bg-slate-50 text-xs text-slate-600">
                          <tr>
                            <th className="px-3 py-2">
                              <div className="flex items-center justify-between gap-2">
                                <span>序号</span>
                                {renderMerchantSortToggle("seq")}
                              </div>
                            </th>
                            <th className="px-3 py-2">
                              <div className="flex items-center justify-between gap-2">
                                <span>账号</span>
                                {renderMerchantSortToggle("user")}
                              </div>
                            </th>
                            <th className="px-3 py-2">
                              <div className="flex items-center justify-between gap-2">
                                <span>ID</span>
                                {renderMerchantSortToggle("id")}
                              </div>
                            </th>
                            <th className="px-3 py-2">
                              <div className="flex items-center justify-between gap-2">
                                <span>名称</span>
                                {renderMerchantSortToggle("name")}
                              </div>
                            </th>
                            <th className="px-3 py-2">
                              <div className="flex items-center justify-between gap-2">
                                <span>前缀</span>
                                {renderMerchantSortToggle("prefix")}
                              </div>
                            </th>
                            <th className="px-3 py-2">
                              <div className="flex items-center justify-between gap-2">
                                <span>行业</span>
                                {renderMerchantSortToggle("industry")}
                              </div>
                            </th>
                            <th className="px-3 py-2">
                              <div className="flex items-center justify-between gap-2">
                                <span>城市</span>
                                {renderMerchantSortToggle("city")}
                              </div>
                            </th>
                            <th className="px-3 py-2">
                              <div className="flex items-center justify-between gap-2">
                                <span>体积</span>
                                {renderMerchantSortToggle("size")}
                              </div>
                            </th>
                            <th className="px-3 py-2">
                              <div className="flex items-center justify-between gap-2">
                                <span>月访量</span>
                                {renderMerchantSortToggle("monthlyViews")}
                              </div>
                            </th>
                            <th className="px-3 py-2">
                              <div className="flex items-center justify-between gap-2">
                                <span>注册时间</span>
                                {renderMerchantSortToggle("registerAt")}
                              </div>
                            </th>
                            <th className="px-3 py-2">
                              <div className="flex items-center justify-between gap-2">
                                <span>到期时间</span>
                                {renderMerchantSortToggle("expireAt")}
                              </div>
                            </th>
                            <th className="px-3 py-2">
                              <div className="flex items-center justify-between gap-2">
                                <span>状态</span>
                                {renderMerchantSortToggle("status")}
                              </div>
                            </th>
                            <th className="px-3 py-2">操作</th>
                          </tr>
                        </thead>
                        <tbody>
                          {pagedMerchantRows.map(({ row, seq }) => {
                            return (
                              <tr key={row.site.id} className={`border-t ${selectedMerchantRow?.site.id === row.site.id ? "bg-blue-50/30" : ""}`}>
                                <td className="px-3 py-2 text-xs text-slate-500">{seq}</td>
                                <td className="px-3 py-2 text-xs">
                                  <div className="font-medium text-slate-900">{row.loginAccount || "-"}</div>
                                  {row.userEmail && row.userEmail !== row.loginAccount ? (
                                    <div className="text-[11px] text-slate-400">{row.userEmail}</div>
                                  ) : null}
                                </td>
                                <td className="px-3 py-2 text-xs">{row.merchantId || "-"}</td>
                                <td className="px-3 py-2 text-xs">{row.merchantName}</td>
                                <td className="px-3 py-2 text-xs">{row.prefix || "-"}</td>
                                <td className="px-3 py-2 text-xs">{row.industry || "-"}</td>
                                <td className="px-3 py-2 text-xs">{row.city || "-"}</td>
                                <td className="px-3 py-2 text-xs">{formatBytes(row.sizeBytes)}</td>
                                <td className="px-3 py-2 text-xs">{row.visits.day30}</td>
                                <td className="px-3 py-2 text-xs text-slate-500">{fmt(row.registerAt)}</td>
                                <td className="px-3 py-2 text-xs text-slate-500">{fmt(row.expireAt)}</td>
                                <td className="px-3 py-2">
                                  <span className={`rounded border px-2 py-0.5 text-xs ${badgeClass(row.statusKey === "active" ? "online" : "maintenance")}`}>
                                    {row.statusLabel}
                                  </span>
                                </td>
                                <td className="px-3 py-2 text-xs">
                                  <div className="flex flex-wrap gap-1">
                                    <button
                                      className="rounded border px-2 py-1"
                                      onClick={() => openMerchantDetailPanel(row.site.id)}
                                    >
                                      详情
                                    </button>
                                    {row.hasSite ? (
                                      <>
                                        <Link
                                          href={buildMerchantFrontendHref(row.site.id, row.site.domainPrefix ?? row.site.domainSuffix)}
                                          target="_blank"
                                          rel="noreferrer"
                                          className="rounded border px-2 py-1"
                                        >
                                          查看前台
                                        </Link>
                                        <button className="rounded border px-2 py-1" onClick={() => toggleMerchantServiceAction(row.site.id)}>
                                          {row.statusKey === "active" ? "暂停服务" : "开启服务"}
                                        </button>
                                        <button
                                          className="rounded border px-2 py-1"
                                          onClick={() => openMerchantConfigPanel(row.site)}
                                        >
                                          配置
                                        </button>
                                        <button
                                          className="rounded border px-2 py-1"
                                          onClick={() => openPlanTemplateDialogForSite(row.site)}
                                        >
                                          方案模板
                                        </button>
                                        <button
                                          className="rounded border px-2 py-1 disabled:opacity-50"
                                          onClick={() => void captureMerchantTemplate(row.site)}
                                          disabled={capturingTemplateSiteId === row.site.id}
                                        >
                                          {capturingTemplateSiteId === row.site.id ? "收录中.." : "收录方案"}
                                        </button>
                                      </>
                                    ) : (
                                      <span className="rounded border border-dashed px-2 py-1 text-slate-400">待建站</span>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                          {filteredMerchantRows.length === 0 ? (
                            <tr>
                              <td colSpan={13} className="px-3 py-6 text-center text-xs text-slate-500">
                                暂无注册商户用户
                              </td>
                            </tr>
                          ) : null}
                        </tbody>
                      </table>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-600">
                      <span>每页 {MERCHANT_USER_PAGE_SIZE_DEFAULT} 条，共 {displayMerchantRows.length} 条</span>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          className="rounded border px-2 py-1 disabled:opacity-40"
                          disabled={clampedMerchantTablePage <= 1}
                          onClick={() => setMerchantTablePage(Math.max(1, clampedMerchantTablePage - 1))}
                        >
                          上一页
                        </button>
                        <span>
                          第 {clampedMerchantTablePage} / {merchantTableTotalPages} 页
                        </span>
                        <button
                          type="button"
                          className="rounded border px-2 py-1 disabled:opacity-40"
                          disabled={clampedMerchantTablePage >= merchantTableTotalPages}
                          onClick={() => setMerchantTablePage(Math.min(merchantTableTotalPages, clampedMerchantTablePage + 1))}
                        >
                          下一页
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-lg border bg-white p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-slate-900">后端已注册但未进入站点列表的账号</div>
                        <div className="text-xs text-slate-500">
                          这部分来自线上真实 `auth + merchants` 数据，不依赖当前浏览器本地的超级后台站点配置。
                        </div>
                      </div>
                      <div className="rounded border bg-slate-50 px-3 py-2 text-sm">
                        未入列账号：{backendAccountsWithoutSite.length}
                      </div>
                    </div>
                    {backendMerchantAccountsLoading ? (
                      <div className="mt-3 text-xs text-slate-500">正在加载后端注册账号…</div>
                    ) : backendMerchantAccountsError ? (
                      <div className="mt-3 text-xs text-rose-600">
                        后端注册账号加载失败：{describeBackendMerchantAccountsError(backendMerchantAccountsError)}
                      </div>
                    ) : backendAccountsWithoutSite.length === 0 ? (
                      <div className="mt-3 text-xs text-slate-500">当前没有“已注册但未进入站点列表”的账号。</div>
                    ) : (
                      <div className="mt-3 overflow-x-auto">
                        <table className="min-w-full text-left text-sm">
                          <thead className="bg-slate-50 text-xs text-slate-600">
                            <tr>
                              <th className="px-3 py-2">账号</th>
                              <th className="px-3 py-2">邮箱</th>
                              <th className="px-3 py-2">商户ID</th>
                              <th className="px-3 py-2">名称</th>
                              <th className="px-3 py-2">注册时间</th>
                              <th className="px-3 py-2">邮箱验证</th>
                              <th className="px-3 py-2">最近登录</th>
                            </tr>
                          </thead>
                          <tbody>
                            {backendAccountsWithoutSite.map((account) => (
                              <tr key={`${account.merchantId}-${account.email}`} className="border-t">
                                <td className="px-3 py-2 text-xs">{account.username || account.loginId || account.email || "-"}</td>
                                <td className="px-3 py-2 text-xs">{account.email || "-"}</td>
                                <td className="px-3 py-2 text-xs">{account.merchantId || "-"}</td>
                                <td className="px-3 py-2 text-xs">{account.merchantName || account.username || "-"}</td>
                                <td className="px-3 py-2 text-xs text-slate-500">{fmt(account.createdAt)}</td>
                                <td className="px-3 py-2 text-xs">
                                  <span className={`rounded border px-2 py-0.5 ${badgeClass(account.emailConfirmed ? "approved" : "pending")}`}>
                                    {account.emailConfirmed ? "已验证" : "未验证"}
                                  </span>
                                </td>
                                <td className="px-3 py-2 text-xs text-slate-500">{fmt(account.lastSignInAt)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>

                  {planTemplateDialogOpen ? (
                    <>
                      <button
                        type="button"
                        className="fixed inset-0 z-[122] bg-black/45"
                        onClick={closePlanTemplateDialog}
                        aria-label="关闭方案模板弹窗"
                      />
                      <div className="fixed inset-0 z-[123] flex items-center justify-center p-4">
                        <div className="flex h-full max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border bg-white shadow-2xl">
                          <div className="flex flex-wrap items-start justify-between gap-3 border-b px-5 py-4">
                            <div className="space-y-1">
                              <div className="text-lg font-semibold text-slate-900">方案模板</div>
                              <div className="text-sm text-slate-500">
                                选择整套已收录方案，先配置应用范围，再应用到 {planTemplateTargetSite ? (getSiteDisplayName(planTemplateTargetSite) || planTemplateTargetSite.domain || planTemplateTargetSite.id) : "目标商户"} 的草稿或前台。
                              </div>
                            </div>
                            <button
                              type="button"
                              className="rounded border bg-white px-3 py-2 text-sm hover:bg-gray-50"
                              onClick={closePlanTemplateDialog}
                            >
                              关闭
                            </button>
                          </div>

                          <div className="space-y-3 border-b px-5 py-4">
                            <div className="flex flex-wrap items-center gap-3">
                              <input
                                className="min-w-[220px] flex-1 rounded border px-3 py-2 text-sm"
                                value={planTemplateSearch}
                                onChange={(event) => setPlanTemplateSearch(event.target.value)}
                                placeholder="搜索方案名称 / 来源网站 / 域名前缀 / 分类"
                              />
                              <div className="text-sm text-slate-500">共 {filteredPlanTemplates.length} 个方案</div>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {PLAN_TEMPLATE_FILTER_OPTIONS.map((option) => (
                                <button
                                  key={option}
                                  type="button"
                                  className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
                                    planTemplateFilter === option
                                      ? "border-black bg-black text-white"
                                      : "bg-white text-slate-700 hover:bg-slate-50"
                                  }`}
                                  onClick={() => setPlanTemplateFilter(option)}
                                >
                                  {option}
                                </button>
                              ))}
                            </div>
                          </div>

                          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
                            {planTemplateCards.length > 0 ? (
                              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                                {planTemplateCards.map(({ template, summary, previewPlans }) => {
                                  const siteLabel =
                                    planTemplateTargetSite
                                      ? getSiteDisplayName(planTemplateTargetSite) || planTemplateTargetSite.domain || planTemplateTargetSite.id
                                      : "目标商户";
                                  const sourceLabel =
                                    template.sourceSiteName || template.sourceSiteDomain || template.sourceSiteId || "未记录来源网站";
                                  const blockLabels = summary.labels.length > 0 ? summary.labels : ["未识别区块"];
                                  const nameDraft = planTemplateNameDrafts[template.id] ?? template.name;
                                  const { coverImageUrl, coverBackgroundStyle, hasCustomCoverBackground } =
                                    getPlanTemplateCoverSurface(template);
                                  const previewImageUrl = (template.previewImageUrl ?? "").trim();
                                  const canPreviewTemplate = !!previewImageUrl || needsPlanTemplatePreviewRefresh(template);
                                  return (
                                    <article key={template.id} className="overflow-hidden rounded-2xl border bg-slate-50 shadow-sm">
                                      <div className="space-y-4 p-4">
                                        <button
                                          type="button"
                                          className="group relative block aspect-[16/10] w-full overflow-hidden rounded-2xl border bg-gradient-to-br from-slate-950 via-slate-800 to-slate-600 text-left text-white"
                                          onClick={() => void openPlanTemplatePreview(template)}
                                          disabled={!canPreviewTemplate}
                                          style={coverBackgroundStyle ?? undefined}
                                        >
                                          {coverImageUrl ? (
                                            // eslint-disable-next-line @next/next/no-img-element
                                            <img
                                              src={coverImageUrl}
                                              alt={template.name}
                                              className="absolute inset-0 h-full w-full object-cover transition duration-200 group-hover:scale-[1.02]"
                                            />
                                          ) : null}
                                          <div
                                            className={`absolute inset-0 ${
                                              coverImageUrl
                                                ? "bg-slate-950/45"
                                                : hasCustomCoverBackground
                                                  ? "bg-slate-950/16"
                                                  : "bg-gradient-to-br from-slate-950 via-slate-800 to-slate-600"
                                            }`}
                                          />
                                          <div className="relative flex h-full flex-col justify-between p-4">
                                            <div className="flex flex-wrap items-start justify-between gap-3">
                                              <div className="min-w-0 flex-1 space-y-1">
                                                <div className="text-xs uppercase tracking-[0.22em] text-white/70">模板封面</div>
                                                <div className="truncate text-base font-semibold" title={summary.previewTitle || template.name}>
                                                  {summary.previewTitle || template.name}
                                                </div>
                                              </div>
                                              <div className="flex items-center gap-2">
                                                <span className="rounded-full border border-white/20 bg-white/10 px-2 py-1 text-xs">
                                                  {summary.hasMobile ? "PC + 手机" : "仅 PC"}
                                                </span>
                                                {canPreviewTemplate ? (
                                                  <span className="rounded-full border border-white/20 bg-white/10 px-2 py-1 text-xs">点击预览方案</span>
                                                ) : coverImageUrl ? (
                                                  <span className="rounded-full border border-white/20 bg-white/10 px-2 py-1 text-xs">仅封面</span>
                                                ) : (
                                                  <span className="rounded-full border border-white/20 bg-white/10 px-2 py-1 text-xs">暂无封面</span>
                                                )}
                                              </div>
                                            </div>
                                            <div className="space-y-3">
                                              <div className="grid grid-cols-3 gap-2 text-xs">
                                                <div className="rounded-xl bg-white/10 px-3 py-2">
                                                  <div className="text-white/60">方案</div>
                                                  <div className="mt-1 text-sm font-semibold">{summary.planCount}</div>
                                                </div>
                                                <div className="rounded-xl bg-white/10 px-3 py-2">
                                                  <div className="text-white/60">页面</div>
                                                  <div className="mt-1 text-sm font-semibold">{summary.pageCount}</div>
                                                </div>
                                                <div className="rounded-xl bg-white/10 px-3 py-2">
                                                  <div className="text-white/60">区块</div>
                                                  <div className="mt-1 text-sm font-semibold">{summary.blockCount}</div>
                                                </div>
                                              </div>
                                              <div className="flex flex-wrap gap-2">
                                                {blockLabels.map((label) => (
                                                  <span key={`${template.id}-${label}`} className="rounded-full bg-white/10 px-2 py-1 text-xs">
                                                    {label}
                                                  </span>
                                                ))}
                                              </div>
                                            </div>
                                          </div>
                                        </button>

                                        <div className="space-y-3">
                                          <div className="flex items-start gap-3">
                                            <label className="min-w-0 flex-1 space-y-1">
                                              <div className="text-xs font-medium text-slate-500">方案名称</div>
                                              <input
                                                className="w-full rounded border bg-white px-3 py-2 text-sm"
                                                value={nameDraft}
                                                onChange={(event) => updatePlanTemplateNameDraft(template.id, event.target.value)}
                                                onBlur={() => persistPlanTemplateName(template.id)}
                                                onKeyDown={(event) => {
                                                  if (event.key === "Enter") {
                                                    event.preventDefault();
                                                    (event.currentTarget as HTMLInputElement).blur();
                                                  }
                                                }}
                                                placeholder="请输入方案名称"
                                              />
                                            </label>
                                            <button
                                              type="button"
                                              className="mt-6 rounded border border-rose-200 bg-white px-3 py-2 text-sm text-rose-600 hover:bg-rose-50"
                                              onClick={() => deletePlanTemplateFromDialog(template)}
                                            >
                                              删除
                                            </button>
                                          </div>

                                          <div className="grid gap-3 md:grid-cols-[150px_minmax(0,1fr)]">
                                            <label className="space-y-1">
                                              <div className="text-xs font-medium text-slate-500">方案分类</div>
                                              <select
                                                className="w-full rounded border bg-white px-3 py-2 text-sm"
                                                value={template.category}
                                                onChange={(event) => updatePlanTemplateCategory(template.id, event.target.value as PlanTemplateCategory)}
                                              >
                                                {PLAN_TEMPLATE_CATEGORY_OPTIONS.map((option) => (
                                                  <option key={option} value={option}>
                                                    {option}
                                                  </option>
                                                ))}
                                              </select>
                                            </label>
                                            <div className="space-y-1">
                                              <div className="text-xs font-medium text-slate-500">来源网站</div>
                                              <div className="rounded border bg-white px-3 py-2 text-sm text-slate-700" title={sourceLabel}>
                                                {sourceLabel}
                                              </div>
                                            </div>
                                          </div>

                                          {previewPlans.length > 0 ? (
                                            <div className="space-y-2 rounded-xl border bg-white px-3 py-3">
                                              <div className="text-xs font-medium text-slate-500">方案预览</div>
                                              <div className="flex flex-wrap gap-2">
                                                {previewPlans.map((plan) => (
                                                  <button
                                                    key={`${template.id}-${plan.planId}`}
                                                    type="button"
                                                    className="rounded border bg-white px-3 py-2 text-sm hover:bg-slate-50"
                                                    onClick={() => void openPlanTemplatePreview(template, plan.planId, plan.planName)}
                                                  >
                                                    {plan.planName}
                                                  </button>
                                                ))}
                                              </div>
                                            </div>
                                          ) : null}

                                          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-white px-3 py-3">
                                            <div className="space-y-1 text-xs text-slate-500">
                                              <div>创建于 {new Date(template.createdAt).toLocaleString("zh-CN", { hour12: false })}</div>
                                              <div>应用对象：{siteLabel}</div>
                                            </div>
                                            <div className="flex flex-wrap gap-2">
                                              {canPreviewTemplate ? (
                                                <button
                                                  type="button"
                                                  className="rounded border bg-white px-3 py-2 text-sm hover:bg-slate-50"
                                                  onClick={() => void openPlanTemplatePreview(template)}
                                                >
                                                  预览方案
                                                </button>
                                              ) : null}
                                              <button
                                                type="button"
                                                className="rounded bg-black px-4 py-2 text-sm text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                                                onClick={() => openPlanTemplateApplyDialog(template)}
                                                disabled={!planTemplateTargetSite}
                                              >
                                                配置应用
                                              </button>
                                            </div>
                                          </div>
                                        </div>
                                      </div>
                                    </article>
                                  );
                                })}
                              </div>
                            ) : (
                              <div className="flex h-full min-h-[260px] items-center justify-center rounded-2xl border border-dashed bg-slate-50 px-6 text-center text-sm text-slate-500">
                                当前没有匹配的方案模板。你可以先在用户列表点击“收录方案”。
                              </div>
                            )}
                          </div>
                        </div>
                      </div>

                      {planTemplateApplyDialog && planTemplateApplyTemplate ? (
                        <>
                          <button
                            type="button"
                            className="fixed inset-0 z-[124] bg-black/35"
                            onClick={() => setPlanTemplateApplyDialog(null)}
                            aria-label="关闭应用设置弹窗"
                          />
                          <div className="fixed inset-0 z-[125] flex items-center justify-center p-4">
                            <div className="flex h-full max-h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border bg-white shadow-2xl">
                              <div className="flex flex-wrap items-start justify-between gap-3 border-b px-5 py-4">
                                <div className="space-y-1">
                                  <div className="text-lg font-semibold text-slate-900">应用方案模板</div>
                                  <div className="text-sm text-slate-500">
                                    {planTemplateApplyTemplate.name} 将应用到 {planTemplateTargetSite ? (getSiteDisplayName(planTemplateTargetSite) || planTemplateTargetSite.domain || planTemplateTargetSite.id) : "目标商户"}。
                                  </div>
                                </div>
                                <button
                                  type="button"
                                  className="rounded border bg-white px-3 py-2 text-sm hover:bg-gray-50"
                                  onClick={() => setPlanTemplateApplyDialog(null)}
                                >
                                  关闭
                                </button>
                              </div>

                              <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
                                <div className="grid gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
                                  <div className="space-y-4">
                                    <div className="overflow-hidden rounded-2xl border bg-slate-50">
                                      <div className="relative aspect-[4/3] w-full bg-slate-900">
                                        {(() => {
                                          const { coverImageUrl, coverBackgroundStyle, hasCustomCoverBackground } =
                                            getPlanTemplateCoverSurface(planTemplateApplyTemplate);
                                          if (coverImageUrl) {
                                            return (
                                              // eslint-disable-next-line @next/next/no-img-element
                                              <img
                                                src={coverImageUrl}
                                                alt={planTemplateApplyTemplate.name}
                                                className="h-full w-full object-cover"
                                              />
                                            );
                                          }
                                          if (coverBackgroundStyle) {
                                            return <div className="h-full w-full" style={coverBackgroundStyle} />;
                                          }
                                          return (
                                            <div className="flex h-full items-center justify-center bg-gradient-to-br from-slate-900 via-slate-700 to-slate-500 text-sm text-white/80">
                                              暂无封面
                                            </div>
                                          );
                                        })()}
                                        {((planTemplateApplyTemplate.previewImageUrl ?? "").trim() ||
                                        (planTemplateApplyTemplate.coverImageUrl ?? "").trim() ||
                                        needsPlanTemplatePreviewRefresh(planTemplateApplyTemplate)) ? (
                                          <button
                                            type="button"
                                            className="absolute right-3 top-3 rounded-full bg-black/55 px-3 py-1 text-xs text-white hover:bg-black/70"
                                            onClick={() => void openPlanTemplatePreview(planTemplateApplyTemplate)}
                                            disabled={false}
                                          >
                                            预览
                                          </button>
                                        ) : null}
                                      </div>
                                      <div className="space-y-2 p-4 text-sm text-slate-600">
                                        <div className="text-base font-semibold text-slate-900">{planTemplateApplyTemplate.name}</div>
                                        <div>来源：{planTemplateApplyTemplate.sourceSiteName || planTemplateApplyTemplate.sourceSiteDomain || planTemplateApplyTemplate.sourceSiteId || "未记录来源网站"}</div>
                                        <div>分类：{planTemplateApplyTemplate.category}</div>
                                      </div>
                                    </div>

                                    {getPlanTemplatePreviewOptions(planTemplateApplyTemplate.blocks).length > 0 ? (
                                      <div className="rounded-2xl border bg-slate-50 p-4">
                                        <div className="text-sm font-semibold text-slate-900">方案预览</div>
                                        <div className="mt-3 flex flex-wrap gap-2">
                                          {getPlanTemplatePreviewOptions(planTemplateApplyTemplate.blocks).map((plan) => (
                                            <button
                                              key={`${planTemplateApplyTemplate.id}-${plan.planId}`}
                                              type="button"
                                              className="rounded border bg-white px-3 py-2 text-sm hover:bg-slate-50"
                                              onClick={() => void openPlanTemplatePreview(planTemplateApplyTemplate, plan.planId, plan.planName)}
                                            >
                                              {plan.planName}
                                            </button>
                                          ))}
                                        </div>
                                      </div>
                                    ) : null}

                                    <div className="rounded-2xl border bg-slate-50 p-4">
                                      <div className="text-sm font-semibold text-slate-900">替换选项</div>
                                      <div className="mt-3 grid gap-2 text-sm text-slate-700">
                                        {[
                                          ["typography", "替换字体样式"],
                                          ["buttonStyles", "替换按钮样式"],
                                          ["galleryImages", "替换相册图片"],
                                          ["productData", "替换产品数据"],
                                          ["contactInfo", "替换联系方式"],
                                        ].map(([key, label]) => (
                                          <label key={key} className="flex items-center gap-2 rounded-lg border bg-white px-3 py-2">
                                            <input
                                              type="checkbox"
                                              checked={planTemplateReplaceOptions[key as keyof PlanTemplateReplaceOptions]}
                                              onChange={(event) =>
                                                updatePlanTemplateReplaceOption(
                                                  key as keyof PlanTemplateReplaceOptions,
                                                  event.target.checked,
                                                )
                                              }
                                            />
                                            <span>{label}</span>
                                          </label>
                                        ))}
                                      </div>
                                      <div className="mt-3 text-xs text-slate-500">商户信息不会因为应用模板而改变。</div>
                                    </div>
                                  </div>

                                  <div className="space-y-4">
                                    <div className="rounded-2xl border bg-slate-50 p-4">
                                      <div className="text-sm font-semibold text-slate-900">应用范围</div>
                                      <div className="mt-4 space-y-4">
                                        {planTemplateViewportOptions.map((viewportOption) => {
                                          const viewScope = planTemplateApplyScope[viewportOption.viewport];
                                          return (
                                            <div key={viewportOption.viewport} className="rounded-2xl border bg-white p-4">
                                              <div className="flex flex-wrap items-center justify-between gap-3">
                                                <label className="flex items-center gap-2 text-sm font-medium text-slate-900">
                                                  <input
                                                    type="checkbox"
                                                    checked={viewScope.enabled}
                                                    onChange={(event) =>
                                                      updatePlanTemplateViewportEnabled(viewportOption.viewport, event.target.checked)
                                                    }
                                                  />
                                                  <span>{viewportOption.label}</span>
                                                </label>
                                                <label className="flex items-center gap-2 text-sm text-slate-700">
                                                  <input
                                                    type="checkbox"
                                                    checked={viewScope.applyBackground}
                                                    disabled={!viewScope.enabled}
                                                    onChange={(event) =>
                                                      updatePlanTemplateViewportBackground(viewportOption.viewport, event.target.checked)
                                                    }
                                                  />
                                                  <span>背景</span>
                                                </label>
                                              </div>

                                              <div className="mt-4 space-y-4">
                                                {viewportOption.plans.map((plan) => (
                                                  <div key={`${viewportOption.viewport}-${plan.planId}`} className="space-y-2">
                                                    <div className="flex items-center justify-between gap-3">
                                                      <div className="text-xs font-medium text-slate-500">{plan.planName}</div>
                                                      {((planTemplateApplyTemplate.planPreviewImageUrls ?? {})[plan.planId] ?? "").trim() ||
                                                      needsPlanTemplatePreviewRefresh(planTemplateApplyTemplate) ? (
                                                        <button
                                                          type="button"
                                                          className="rounded border bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
                                                          onClick={() => void openPlanTemplatePreview(planTemplateApplyTemplate, plan.planId, plan.planName)}
                                                        >
                                                          预览方案
                                                        </button>
                                                      ) : null}
                                                    </div>
                                                    <div className="flex flex-wrap gap-2">
                                                      {plan.pages.map((page) => {
                                                        const selected = viewScope.selectedPageKeys.includes(page.key);
                                                        return (
                                                          <button
                                                            key={page.key}
                                                            type="button"
                                                            className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
                                                              selected
                                                                ? "border-black bg-black text-white"
                                                                : "bg-white text-slate-700 hover:bg-slate-50"
                                                            } ${viewScope.enabled ? "" : "cursor-not-allowed opacity-50"}`}
                                                            onClick={() =>
                                                              viewScope.enabled && togglePlanTemplatePageSelection(viewportOption.viewport, page.key)
                                                            }
                                                            disabled={!viewScope.enabled}
                                                          >
                                                            {page.pageName}
                                                          </button>
                                                        );
                                                      })}
                                                    </div>
                                                  </div>
                                                ))}
                                              </div>
                                            </div>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              </div>

                              <div className="flex flex-wrap items-center justify-between gap-3 border-t px-5 py-4">
                                <div className="text-xs text-slate-500">可按端口、页面范围和替换项控制模板应用，不会改动商户信息。</div>
                                <div className="flex flex-wrap gap-2">
                                  <button
                                    type="button"
                                    className="rounded border bg-white px-4 py-2 text-sm hover:bg-slate-50"
                                    onClick={() => setPlanTemplateApplyDialog(null)}
                                  >
                                    取消
                                  </button>
                                  <button
                                    type="button"
                                    className="rounded border border-slate-300 bg-white px-4 py-2 text-sm text-slate-900 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                                    onClick={() =>
                                      planTemplateTargetSite &&
                                      void applyPlanTemplateToSite(
                                        planTemplateApplyTemplate,
                                        planTemplateTargetSite,
                                        "draft",
                                        planTemplateApplyScope,
                                        planTemplateReplaceOptions,
                                      )
                                    }
                                    disabled={!planTemplateTargetSite || !hasPlanTemplateApplySelection(planTemplateApplyScope) || applyingPlanTemplateKey === `${planTemplateApplyTemplate.id}:draft`}
                                  >
                                    {applyingPlanTemplateKey === `${planTemplateApplyTemplate.id}:draft` ? "应用中..." : "应用到草稿"}
                                  </button>
                                  <button
                                    type="button"
                                    className="rounded bg-black px-4 py-2 text-sm text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                                    onClick={() =>
                                      planTemplateTargetSite &&
                                      void applyPlanTemplateToSite(
                                        planTemplateApplyTemplate,
                                        planTemplateTargetSite,
                                        "publish",
                                        planTemplateApplyScope,
                                        planTemplateReplaceOptions,
                                      )
                                    }
                                    disabled={!planTemplateTargetSite || !hasPlanTemplateApplySelection(planTemplateApplyScope) || applyingPlanTemplateKey === `${planTemplateApplyTemplate.id}:publish`}
                                  >
                                    {applyingPlanTemplateKey === `${planTemplateApplyTemplate.id}:publish` ? "发布中..." : "直接发布"}
                                  </button>
                                </div>
                              </div>
                            </div>
                          </div>
                        </>
                      ) : null}

                      {planTemplateCoverPreview
                        ? renderTopMostOverlay(
                            <>
                              <button
                                type="button"
                                className="fixed inset-0 z-[2147483600] bg-black/65"
                                onClick={() => setPlanTemplateCoverPreview(null)}
                                aria-label="关闭模板封面预览"
                              />
                              <div className="fixed inset-0 z-[2147483601] flex items-center justify-center p-4">
                                <div className="max-h-[92vh] w-full max-w-5xl overflow-hidden rounded-2xl border bg-white shadow-2xl">
                                  <div className="flex items-center justify-between border-b px-5 py-4">
                                    <div className="text-base font-semibold text-slate-900">{planTemplateCoverPreview.name}</div>
                                    <div className="flex flex-wrap items-center gap-2">
                                      <button
                                        type="button"
                                        className="rounded border bg-white px-3 py-2 text-sm hover:bg-slate-50"
                                        onClick={() =>
                                          setPlanTemplateCoverPreviewScale((current) => Math.max(0.5, Number((current - 0.25).toFixed(2))))
                                        }
                                      >
                                        缩小
                                      </button>
                                      <button
                                        type="button"
                                        className="min-w-[72px] rounded border bg-white px-3 py-2 text-sm hover:bg-slate-50"
                                        onClick={() => setPlanTemplateCoverPreviewScale(1)}
                                      >
                                        {Math.round(planTemplateCoverPreviewScale * 100)}%
                                      </button>
                                      <button
                                        type="button"
                                        className="rounded border bg-white px-3 py-2 text-sm hover:bg-slate-50"
                                        onClick={() =>
                                          setPlanTemplateCoverPreviewScale((current) => Math.min(3, Number((current + 0.25).toFixed(2))))
                                        }
                                      >
                                        放大
                                      </button>
                                      <button
                                        type="button"
                                        className="rounded border bg-white px-3 py-2 text-sm hover:bg-slate-50"
                                        onClick={() => setPlanTemplateCoverPreview(null)}
                                      >
                                        关闭
                                      </button>
                                    </div>
                                  </div>
                                  <div className="max-h-[78vh] overflow-auto bg-black p-4">
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img
                                      src={planTemplateCoverPreview.url}
                                      alt={planTemplateCoverPreview.name}
                                      className="mx-auto h-auto max-w-none rounded-xl object-contain"
                                      style={{ width: `${Math.round(planTemplateCoverPreviewScale * 100)}%` }}
                                    />
                                  </div>
                                </div>
                              </div>
                            </>,
                          )
                        : null}
                    </>
                  ) : null}

                  {merchantPanelOpen ? (
                    <>
                      <button
                        type="button"
                        className="fixed inset-0 z-[120] bg-black/40"
                        onClick={() => setMerchantPanelOpen(false)}
                        aria-label="关闭弹窗"
                      />
                      <div className="fixed inset-0 z-[121] flex items-center justify-center p-4">
                        <div className="max-h-[92vh] w-full max-w-5xl overflow-hidden rounded-lg border bg-white p-4 shadow-2xl">
                    <div className="flex items-center justify-between">
                      <h2 className="font-semibold">用户详情 / 配置</h2>
                      <div className="flex items-center gap-2 text-xs">
                        <button
                          className={`rounded border px-2 py-1 ${userPanelMode === "detail" ? "bg-black text-white" : "bg-white"}`}
                          onClick={() => setUserPanelMode("detail")}
                        >
                          详情
                        </button>
                        <button
                          className={`rounded border px-2 py-1 ${userPanelMode === "config" ? "bg-black text-white" : "bg-white"} ${selectedMerchantSite ? "" : "opacity-40"}`}
                          onClick={() => {
                            if (selectedMerchantSite) hydrateMerchantConfigDraft(selectedMerchantSite);
                            setUserPanelMode("config");
                          }}
                          disabled={!selectedMerchantSite}
                        >
                          配置
                        </button>
                        <button
                          className="rounded border px-2 py-1"
                          onClick={() => setMerchantPanelOpen(false)}
                        >
                          关闭
                        </button>
                      </div>
                    </div>
                    <div className="mt-3 max-h-[calc(92vh-80px)] overflow-y-auto pr-1">
                    {selectedMerchantRow ? (
                      <>
                        {userPanelMode === "detail" ? (
                          <div className="space-y-2 text-xs">
                            <div className="rounded border bg-slate-50 px-3 py-2">
                              <div className="text-slate-500">账号</div>
                              <div className="font-medium text-slate-900">{selectedMerchantRow.loginAccount || "-"}</div>
                              {selectedMerchantRow.userEmail && selectedMerchantRow.userEmail !== selectedMerchantRow.loginAccount ? (
                                <div className="mt-1 text-[11px] text-slate-400">{selectedMerchantRow.userEmail}</div>
                              ) : null}
                            </div>
                            {!selectedMerchantRow.hasSite ? (
                              <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-amber-800">
                                该账号已注册并已进入后端商户数据，但还没有创建站点，所以不会出现在原有站点列表逻辑里。
                              </div>
                            ) : null}
                            <div className="grid grid-cols-2 gap-2">
                              <div className="rounded border px-3 py-2">
                                <div className="text-slate-500">ID</div>
                                <div className="font-medium">{selectedMerchantRow.merchantId || "-"}</div>
                              </div>
                              <div className="rounded border px-3 py-2">
                                <div className="text-slate-500">名称</div>
                                <div className="font-medium">{selectedMerchantRow.merchantName}</div>
                              </div>
                              <div className="rounded border px-3 py-2">
                                <div className="text-slate-500">域名</div>
                                <div className="truncate font-medium">{selectedMerchantSite?.domain || "-"}</div>
                              </div>
                              <div className="rounded border px-3 py-2">
                                <div className="text-slate-500">行业</div>
                                <div>{selectedMerchantRow.industry}</div>
                              </div>
                              <div className="rounded border px-3 py-2">
                                <div className="text-slate-500">国家 / 省 / 城市</div>
                                <div>
                                  {(selectedMerchantSite?.location.country || "-")} / {(selectedMerchantSite?.location.province || "-")} / {(selectedMerchantSite?.location.city || "-")}
                                </div>
                              </div>
                              <div className="rounded border px-3 py-2">
                                <div className="text-slate-500">地址</div>
                                <div>{selectedMerchantSite?.contactAddress || "-"}</div>
                              </div>
                              <div className="rounded border px-3 py-2">
                                <div className="text-slate-500">联系人</div>
                                <div>{selectedMerchantSite?.contactName || "-"}</div>
                              </div>
                              <div className="rounded border px-3 py-2">
                                <div className="text-slate-500">电话</div>
                                <div>{selectedMerchantSite?.contactPhone || "-"}</div>
                              </div>
                              <div className="rounded border px-3 py-2">
                                <div className="text-slate-500">邮箱</div>
                                <div>{selectedMerchantSite?.contactEmail || selectedMerchantRow.userEmail || "-"}</div>
                              </div>
                              <div className="rounded border px-3 py-2">
                                <div className="text-slate-500">体积</div>
                                <div>{formatBytes(selectedMerchantRow.sizeBytes)}</div>
                              </div>
                              <div className="rounded border px-3 py-2">
                                <div className="text-slate-500">访问量</div>
                                <div>今日 {selectedMerchantRow.visits.today} / 7日 {selectedMerchantRow.visits.day7} / 30日 {selectedMerchantRow.visits.day30} / 总 {selectedMerchantRow.visits.total}</div>
                              </div>
                              <div className="rounded border px-3 py-2">
                                <div className="text-slate-500">注册时间</div>
                                <div>{fmt(selectedMerchantRow.registerAt)}</div>
                              </div>
                              <div className="rounded border px-3 py-2">
                                <div className="text-slate-500">到期时间</div>
                                <div>{fmt(selectedMerchantRow.expireAt)}</div>
                              </div>
                            </div>
                          </div>
                        ) : (
                          !selectedMerchantSite ? (
                            <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                              该账号尚未创建站点，当前没有可配置的站点参数。先为它建站后，才能配置前台、域名、服务状态和发布内容。
                            </div>
                          ) : (
                            <div className="space-y-3 text-xs">
                              <div className="rounded border bg-slate-50 px-3 py-2 text-slate-600">
                                配置对象：{selectedMerchantRow.loginAccount || "-"}
                              </div>
                              <div className="grid gap-2 md:grid-cols-2">
                              <label className="space-y-1">
                                <div className="text-slate-500">到期时间</div>
                                <input
                                  className="w-full rounded border px-2 py-1.5"
                                  type="text"
                                  inputMode="numeric"
                                  autoComplete="off"
                                  placeholder="YYYY-MM-DD"
                                  value={configExpireDate}
                                  onChange={(e) => setConfigExpireDate(e.target.value)}
                                />
                              </label>
                              <label className="space-y-1">
                                <div className="text-slate-500">发布体积限制(MB)</div>
                                <input className="w-full rounded border px-2 py-1.5" value={configPublishLimitMb} onChange={(e) => setConfigPublishLimitMb(e.target.value)} />
                              </label>
                              <label className="space-y-1">
                                <div className="text-slate-500">方案数量上限</div>
                                <input className="w-full rounded border px-2 py-1.5" value={configPlanLimit} onChange={(e) => setConfigPlanLimit(e.target.value)} />
                              </label>
                              <label className="space-y-1">
                                <div className="text-slate-500">页面上限数量</div>
                                <input className="w-full rounded border px-2 py-1.5" value={configPageLimit} onChange={(e) => setConfigPageLimit(e.target.value)} />
                              </label>
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                              <label className="flex items-center gap-2 rounded border px-2 py-1.5">
                                <input type="checkbox" checked={configAllowInsertBackground} onChange={(e) => setConfigAllowInsertBackground(e.target.checked)} />
                                插入背景
                              </label>
                              <label className="flex items-center gap-2 rounded border px-2 py-1.5">
                                <input type="checkbox" checked={configAllowThemeEffects} onChange={(e) => setConfigAllowThemeEffects(e.target.checked)} />
                                主题效果
                              </label>
                              <label className="flex items-center gap-2 rounded border px-2 py-1.5">
                                <input type="checkbox" checked={configAllowButtonBlock} onChange={(e) => setConfigAllowButtonBlock(e.target.checked)} />
                                按钮区块
                              </label>
                              <label className="flex items-center gap-2 rounded border px-2 py-1.5">
                                <input type="checkbox" checked={configAllowGalleryBlock} onChange={(e) => setConfigAllowGalleryBlock(e.target.checked)} />
                                相册区块
                              </label>
                              <label className="flex items-center gap-2 rounded border px-2 py-1.5">
                                <input type="checkbox" checked={configAllowMusicBlock} onChange={(e) => setConfigAllowMusicBlock(e.target.checked)} />
                                音乐区块
                              </label>
                              <label className="flex items-center gap-2 rounded border px-2 py-1.5">
                                <input type="checkbox" checked={configAllowProductBlock} onChange={(e) => setConfigAllowProductBlock(e.target.checked)} />
                                产品区块
                              </label>
                              <label className="flex items-center gap-2 rounded border px-2 py-1.5">
                                <input type="checkbox" checked={configAllowBookingBlock} onChange={(e) => setConfigAllowBookingBlock(e.target.checked)} />
                                预约区块
                              </label>
                            </div>
                            <div className="rounded border p-2">
                              <div className="mb-2 text-slate-500">商户框图片上传</div>
                              <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
                                <div className="space-y-2">
                                  <input type="file" accept="image/*" onChange={handleMerchantCardImageUpload} />
                                  <div className="grid gap-2 md:grid-cols-2">
                                    <label className="space-y-1">
                                      <div className="text-slate-500">预览宽度</div>
                                      <input
                                        className="w-full rounded border px-2 py-1.5"
                                        value={configCardPreviewWidth}
                                        onChange={(e) => setConfigCardPreviewWidth(e.target.value)}
                                      />
                                    </label>
                                    <label className="space-y-1">
                                      <div className="text-slate-500">预览高度</div>
                                      <input
                                        className="w-full rounded border px-2 py-1.5"
                                        value={configCardPreviewHeight}
                                        onChange={(e) => setConfigCardPreviewHeight(e.target.value)}
                                      />
                                    </label>
                                  </div>
                                  <div className="text-[11px] text-slate-400">宽度范围 160-640，高度范围 30-420。</div>
                                  {configMerchantCardImage ? (
                                    <button className="rounded border px-2 py-1" onClick={() => setConfigMerchantCardImage("")}>
                                      恢复默认样式
                                    </button>
                                  ) : (
                                    <div className="text-slate-400">未上传时使用超级后台默认商户框样式</div>
                                  )}
                                </div>
                                <div className="space-y-1">
                                  <div className="text-xs text-slate-500">右侧预览</div>
                                  <div
                                    className="relative overflow-hidden rounded-lg border p-3"
                                    style={{
                                      width: `${previewCardWidth}px`,
                                      height: `${previewCardHeight}px`,
                                      color: "#0f172a",
                                      borderColor: "#334155",
                                      backgroundColor: configMerchantCardImage ? undefined : "#f8fafc",
                                      backgroundImage: configMerchantCardImage ? `url(${configMerchantCardImage})` : undefined,
                                      backgroundSize: "cover",
                                      backgroundPosition: "center",
                                    }}
                                  >
                                    <div className="relative h-full min-w-0">
                                      <div
                                        className={`${previewMerchantCardTextBoxClass} text-base font-semibold text-slate-900`}
                                        style={{
                                          left: `${previewMerchantNameTextPosition.x}px`,
                                          top: `${previewMerchantNameTextPosition.y}px`,
                                          position: "absolute",
                                          ...previewMerchantNameTextStyle,
                                        }}
                                      >
                                        <span className="truncate">{selectedMerchantRow.merchantName}</span>
                                      </div>
                                      <div
                                        className={`${previewMerchantCardTextBoxClass} text-xs text-slate-500`}
                                        style={{
                                          left: `${previewMerchantIndustryTextPosition.x}px`,
                                          top: `${previewMerchantIndustryTextPosition.y}px`,
                                          position: "absolute",
                                          ...previewMerchantIndustryTextStyle,
                                        }}
                                      >
                                        <span className="truncate">{selectedMerchantRow.industry || "行业"}</span>
                                      </div>
                                      <div
                                        className={`${previewMerchantCardTextBoxClass} text-xs text-slate-500`}
                                        style={{
                                          left: `${previewMerchantDomainTextPosition.x}px`,
                                          top: `${previewMerchantDomainTextPosition.y}px`,
                                          position: "absolute",
                                          ...previewMerchantDomainTextStyle,
                                        }}
                                      >
                                        <span className="truncate">{selectedMerchantSite?.domain || "域名"}</span>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </div>
                            <div className="space-y-2 rounded border p-2">
                              <div className="text-slate-500">排序（留空即使用默认规则）</div>
                              <div className="grid gap-2 md:grid-cols-2">
                                <label className="space-y-1">
                                  <div>推荐-国家</div>
                                  <input
                                    className="w-full rounded border px-2 py-1.5"
                                    type="number"
                                    min={1}
                                    step={1}
                                    inputMode="numeric"
                                    autoComplete="new-password"
                                    autoCorrect="off"
                                    autoCapitalize="off"
                                    spellCheck={false}
                                    value={configRecommendedCountryRank}
                                    onChange={(e) => setConfigRecommendedCountryRank(e.target.value)}
                                  />
                                </label>
                                <label className="space-y-1">
                                  <div>推荐-省</div>
                                  <input
                                    className="w-full rounded border px-2 py-1.5"
                                    type="number"
                                    min={1}
                                    step={1}
                                    inputMode="numeric"
                                    autoComplete="new-password"
                                    autoCorrect="off"
                                    autoCapitalize="off"
                                    spellCheck={false}
                                    value={configRecommendedProvinceRank}
                                    onChange={(e) => setConfigRecommendedProvinceRank(e.target.value)}
                                  />
                                </label>
                                <label className="space-y-1">
                                  <div>推荐-城市</div>
                                  <input
                                    className="w-full rounded border px-2 py-1.5"
                                    type="number"
                                    min={1}
                                    step={1}
                                    inputMode="numeric"
                                    autoComplete="new-password"
                                    autoCorrect="off"
                                    autoCapitalize="off"
                                    spellCheck={false}
                                    value={configRecommendedCityRank}
                                    onChange={(e) => setConfigRecommendedCityRank(e.target.value)}
                                  />
                                </label>
                                <label className="space-y-1">
                                  <div>行业-国家</div>
                                  <input
                                    className="w-full rounded border px-2 py-1.5"
                                    type="number"
                                    min={1}
                                    step={1}
                                    inputMode="numeric"
                                    autoComplete="new-password"
                                    autoCorrect="off"
                                    autoCapitalize="off"
                                    spellCheck={false}
                                    value={configIndustryCountryRank}
                                    onChange={(e) => setConfigIndustryCountryRank(e.target.value)}
                                  />
                                </label>
                                <label className="space-y-1">
                                  <div>行业-省</div>
                                  <input
                                    className="w-full rounded border px-2 py-1.5"
                                    type="number"
                                    min={1}
                                    step={1}
                                    inputMode="numeric"
                                    autoComplete="new-password"
                                    autoCorrect="off"
                                    autoCapitalize="off"
                                    spellCheck={false}
                                    value={configIndustryProvinceRank}
                                    onChange={(e) => setConfigIndustryProvinceRank(e.target.value)}
                                  />
                                </label>
                                <label className="space-y-1">
                                  <div>行业-城市</div>
                                  <input
                                    className="w-full rounded border px-2 py-1.5"
                                    type="number"
                                    min={1}
                                    step={1}
                                    inputMode="numeric"
                                    autoComplete="new-password"
                                    autoCorrect="off"
                                    autoCapitalize="off"
                                    spellCheck={false}
                                    value={configIndustryCityRank}
                                    onChange={(e) => setConfigIndustryCityRank(e.target.value)}
                                  />
                                </label>
                              </div>
                              <div className="rounded border bg-slate-50 p-2 text-[11px] text-slate-600">
                                <div className="font-medium text-slate-700">
                                  排序预览（前10）
                                </div>
                                <div className="mt-1">
                                  当前按 <span className="font-medium">{selectedSortPreviewLevelLabel}</span> 层级生效，
                                  同排名回退到默认规则（{merchantDefaultSortRule}）。
                                </div>
                                <div className="mt-2 flex flex-wrap items-center gap-2">
                                  <span className="text-[11px] text-slate-500">筛选范围</span>
                                  {(["all", "country", "province", "city"] as const).map((filter) => {
                                    const disabled =
                                      (filter === "country" && !canFilterByCountry) ||
                                      (filter === "province" && !canFilterByProvince) ||
                                      (filter === "city" && !canFilterByCity);
                                    const active = sortPreviewFilter === filter;
                                    return (
                                      <button
                                        key={`sort-filter-${filter}`}
                                        type="button"
                                        className={`rounded border px-2 py-0.5 text-[11px] transition ${
                                          active
                                            ? "border-slate-900 bg-slate-900 text-white"
                                            : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                                        } disabled:cursor-not-allowed disabled:opacity-40`}
                                        disabled={disabled}
                                        onClick={() => setSortPreviewFilter(filter)}
                                      >
                                        {SORT_PREVIEW_FILTER_LABELS[filter]}
                                      </button>
                                    );
                                  })}
                                </div>
                                <div className="mt-1 text-[11px] text-slate-500">
                                  当前筛选：<span className="font-medium">{activeSortPreviewFilterLabel}</span> |
                                  商户位置：{selectedSortPreviewLocation.country}/{selectedSortPreviewLocation.province}/{selectedSortPreviewLocation.city}
                                </div>
                                <div className="mt-2 grid gap-2 md:grid-cols-2">
                                  <div className="rounded border bg-white p-2">
                                    <div className="mb-1 font-medium text-slate-700">
                                      推荐排序（当前商户名次：{recommendedSortPreview.selectedRank > 0 ? `#${recommendedSortPreview.selectedRank}` : "-"}）
                                    </div>
                                    <div className="mb-1 text-[11px] text-slate-500">候选商户：{recommendedSortPreview.totalCount}</div>
                                    <div className="space-y-1">
                                      {recommendedSortPreview.top10.map((site, idx) => {
                                        const selected = selectedMerchantSite?.id === site.id;
                                        return (
                                          <div key={`recommended-${site.id}`} className={`flex items-center justify-between rounded border px-2 py-1 ${selected ? "border-blue-300 bg-blue-50" : "border-slate-200"}`}>
                                            <span className="truncate">
                                              #{idx + 1} {getSiteDisplayName(site)}
                                            </span>
                                            {selected ? <span className="text-[10px] text-blue-600">当前商户</span> : null}
                                          </div>
                                        );
                                      })}
                                      {recommendedSortPreview.top10.length === 0 ? (
                                        <div className="text-slate-400">暂无可预览商户</div>
                                      ) : null}
                                    </div>
                                  </div>
                                  <div className="rounded border bg-white p-2">
                                    <div className="mb-1 font-medium text-slate-700">
                                      行业排序（{industrySortPreview.industryLabel}，当前商户名次：{industrySortPreview.selectedRank > 0 ? `#${industrySortPreview.selectedRank}` : "-"}）
                                    </div>
                                    <div className="mb-1 text-[11px] text-slate-500">候选商户：{industrySortPreview.totalCount}</div>
                                    <div className="space-y-1">
                                      {industrySortPreview.top10.map((site, idx) => {
                                        const selected = selectedMerchantSite?.id === site.id;
                                        return (
                                          <div key={`industry-${site.id}`} className={`flex items-center justify-between rounded border px-2 py-1 ${selected ? "border-blue-300 bg-blue-50" : "border-slate-200"}`}>
                                            <span className="truncate">
                                              #{idx + 1} {getSiteDisplayName(site)}
                                            </span>
                                            {selected ? <span className="text-[10px] text-blue-600">当前商户</span> : null}
                                          </div>
                                        );
                                      })}
                                      {industrySortPreview.top10.length === 0 ? (
                                        <div className="text-slate-400">暂无可预览商户</div>
                                      ) : null}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </div>
                            <button className="w-full rounded border bg-black px-3 py-2 text-sm text-white" onClick={saveMerchantConfigAction}>
                              保存配置
                            </button>
                            <div className="rounded border p-2">
                              <div className="mb-2 flex items-center justify-between text-slate-600">
                                <span className="font-medium">配置变更历史</span>
                                <span className="text-[11px]">{selectedMerchantConfigHistory.length} 条</span>
                              </div>
                              <div className="space-y-1">
                                {selectedMerchantConfigHistory.length > 0 ? (
                                  selectedMerchantConfigHistory.slice(0, 12).map((history) => (
                                    <div key={history.id} className="rounded border px-2 py-1.5">
                                      <div className="flex items-center justify-between gap-2">
                                        <span className="truncate text-slate-700">{history.summary || "配置更新"}</span>
                                        <button
                                          type="button"
                                          className="rounded border px-2 py-0.5 text-[11px] hover:bg-slate-50"
                                          onClick={() => rollbackMerchantConfigByHistoryAction(history.id)}
                                        >
                                          回滚到此版本
                                        </button>
                                      </div>
                                      <div className="mt-1 text-[11px] text-slate-500">
                                        {fmt(history.at)} | {history.operator || "-"}
                                      </div>
                                    </div>
                                  ))
                                ) : (
                                  <div className="rounded border border-dashed px-2 py-2 text-[11px] text-slate-400">
                                    暂无配置变更历史
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        ))}
                      </>
                    ) : (
                      <div className="text-sm text-slate-500">暂无用户</div>
                    )}
                    </div>
                        </div>
                      </div>
                    </>
                  ) : null}
                </div>
              </section>
            ) : null}

            {activeMenu === "merchant_id_rules" ? (
              <section className="space-y-4">
                <div className="rounded-lg border bg-white p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-slate-900">禁用 ID 设置</div>
                      <div className="text-xs text-slate-500">
                        加入这里的号码不会再被自动注册分配。支持单个 ID、号段范围和任意位置通配。
                      </div>
                    </div>
                    <div className="rounded border bg-slate-50 px-3 py-2 text-sm">当前规则：{merchantIdRules.length}</div>
                  </div>
                </div>

                <div className="rounded-lg border bg-white p-4">
                  <div className="grid gap-3 md:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)_auto]">
                    <input
                      className="rounded border px-3 py-2 text-sm"
                      placeholder="10000010 / 10000020-10000050 / ****1111 / 10**0010"
                      value={merchantIdRuleInput}
                      onChange={(event) => setMerchantIdRuleInput(event.target.value)}
                    />
                    <input
                      className="rounded border px-3 py-2 text-sm"
                      placeholder="备注（可选）"
                      value={merchantIdRuleNote}
                      onChange={(event) => setMerchantIdRuleNote(event.target.value)}
                    />
                    <button
                      type="button"
                      className="rounded bg-black px-4 py-2 text-sm text-white hover:bg-slate-800 disabled:opacity-50"
                      onClick={() => void createMerchantIdRuleAction()}
                      disabled={merchantIdRuleSubmitting}
                    >
                      {merchantIdRuleSubmitting ? "添加中..." : "添加规则"}
                    </button>
                  </div>

                  <div className="mt-2 text-xs text-slate-500">
                    示例：`10000010` 表示禁用单个号码；`10000020-10000050` 表示禁用整个号段；`100000**`、`10**0010`、`****1111` 都表示 8 位中任意位置可用 `*` 通配。
                  </div>

                  {merchantIdRulesError ? (
                    <div className="mt-3 text-sm text-rose-600">
                      {merchantIdRulesError === "merchant_id_rule_timeout"
                        ? "禁用 ID 规则加载超时，请稍后重试"
                        : merchantIdRulesError}
                    </div>
                  ) : null}

                  {merchantIdRulesLoading ? (
                    <div className="mt-3 text-xs text-slate-500">正在加载禁用 ID 规则…</div>
                  ) : merchantIdRules.length === 0 ? (
                    <div className="mt-3 rounded border border-dashed px-3 py-4 text-xs text-slate-500">
                      当前还没有禁用 ID 规则。
                    </div>
                  ) : (
                    <div className="mt-4 overflow-x-auto">
                      <table className="min-w-full text-left text-sm">
                        <thead className="bg-slate-50 text-xs text-slate-600">
                          <tr>
                            <th className="px-3 py-2">类型</th>
                            <th className="px-3 py-2">规则</th>
                            <th className="px-3 py-2">备注</th>
                            <th className="px-3 py-2">创建时间</th>
                            <th className="px-3 py-2">操作</th>
                          </tr>
                        </thead>
                        <tbody>
                          {merchantIdRules.map((rule) => (
                            <tr key={rule.id} className="border-t">
                              <td className="px-3 py-2 text-xs">
                                <span className={`rounded border px-2 py-0.5 ${badgeClass(rule.type === "exact" ? "warning" : rule.type === "range" ? "maintenance" : "disabled")}`}>
                                  {merchantIdRuleTypeLabel(rule.type)}
                                </span>
                              </td>
                              <td className="px-3 py-2 text-xs">{describeMerchantIdRuleExpression(rule)}</td>
                              <td className="px-3 py-2 text-xs text-slate-500">{rule.note || "-"}</td>
                              <td className="px-3 py-2 text-xs text-slate-500">{fmt(rule.createdAt)}</td>
                              <td className="px-3 py-2 text-xs">
                                <button
                                  type="button"
                                  className="rounded border px-2 py-1 disabled:opacity-50"
                                  onClick={() => void deleteMerchantIdRuleAction(rule)}
                                  disabled={merchantIdRuleDeletingId === rule.id}
                                >
                                  {merchantIdRuleDeletingId === rule.id ? "删除中..." : "删除"}
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </section>
            ) : null}

            {activeMenu === "stats" ? (
              <section className="space-y-4">
                <div className="grid gap-3 md:grid-cols-4">
                  <div className="rounded-lg border bg-white p-4 text-sm">租户数：{state.tenants.length}</div>
                  <div className="rounded-lg border bg-white p-4 text-sm">站点数：{state.sites.length}</div>
                  <div className="rounded-lg border bg-white p-4 text-sm">活跃用户：{state.users.filter((x) => x.status === "active").length}</div>
                  <div className="rounded-lg border bg-white p-4 text-sm">30天发布成功率：{publishSuccessRate}</div>
                </div>
                <div className="rounded-lg border bg-white p-4">
                  <h2 className="mb-2 font-semibold">最近发布记录</h2>
                  <div className="space-y-1">
                    {state.publishRecords.slice(0, 12).map((record) => (
                      <div key={record.id} className="flex items-center justify-between rounded border px-3 py-2 text-xs">
                        <span>{siteMap.get(record.siteId)} v{record.version}</span>
                        <span>{publishStatusLabel(record.status)}</span>
                        <span>{fmt(record.at)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </section>
            ) : null}

            {activeMenu === "logs" ? (
              <section className="space-y-4">
                <div className="rounded-lg border bg-white p-4">
                  <h2 className="mb-2 font-semibold">审计日志</h2>
                  <div className="space-y-1">
                    {state.audits.slice(0, 20).map((item) => (
                      <div key={item.id} className="rounded border px-3 py-2 text-xs">
                        <div className="font-medium">{item.action}</div>
                        <div className="text-slate-500">{fmt(item.at)} | {item.operator} | {item.targetType}:{item.targetId}</div>
                        <div className="text-slate-500">{item.detail}</div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-lg border bg-white p-4">
                  <h2 className="mb-2 font-semibold">系统告警</h2>
                  <div className="space-y-1">
                    {state.alerts.slice(0, 12).map((alert) => (
                      <div key={alert.id} className="rounded border px-3 py-2 text-xs">
                        <div className="flex items-center justify-between">
                          <span>{alert.title}</span>
                          <span className={`rounded border px-2 py-0.5 ${badgeClass(alert.level)}`}>{alert.level}</span>
                        </div>
                        <div className="text-slate-500">{alert.message}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </section>
            ) : null}
          </div>
        </div>
      </div>
    </main>
  );
}
