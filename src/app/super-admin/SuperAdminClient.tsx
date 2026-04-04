"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ChangeEvent, type ReactNode, type TouchEvent } from "react";
import { createPortal } from "react-dom";
import { buildMerchantBusinessCardShareUrl, resolveMerchantBusinessCardShareOrigin } from "@/lib/merchantBusinessCardShare";
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
import type {
  Block,
  MerchantCardTextLayoutConfig,
  MerchantCardTextRole,
  MerchantListPublishedSite,
  TypographyEditableProps,
} from "@/data/homeBlocks";
import {
  FEATURE_CATALOG,
  MERCHANT_INDUSTRY_OPTIONS,
  MERCHANT_SORT_RULES,
  applyAlert,
  applyAudit,
  createAlertRecord,
  createApprovalRecord,
  createAuditRecord,
  createDefaultMerchantContactVisibility,
  createDefaultMerchantPermissionConfig,
  createDefaultMerchantSortConfig,
  createFeaturePackage,
  createHomeLayoutSection,
  createIndustryCategory,
  createPlanTemplate,
  createSite,
  loadPlatformState,
  nextIsoNow,
  PLAN_TEMPLATE_CATEGORY_OPTIONS,
  resolvePermissionsForUser,
  savePlatformState,
  subscribePlatformState,
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
import { readPageViewDailyStats, trackPublishEvent } from "@/lib/analytics";
import { parseMerchantIdRuleInput, sortMerchantIdRules, type MerchantIdRule } from "@/lib/merchantIdRules";
import {
  matchPlanTemplateCategory,
  PLAN_TEMPLATE_FILTER_OPTIONS,
  summarizePlanTemplateBlocks,
  type PlanTemplateFilterCategory,
} from "@/lib/planTemplates";
import { buildMerchantSiteLinker } from "@/lib/merchantSiteLinking";
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
import { buildPlatformMerchantSnapshotPayloadFromSites } from "@/lib/platformMerchantSnapshot";
import ChatBusinessCardDialog from "@/components/admin/ChatBusinessCardDialog";
import { resolveMerchantBusinessCardForChatDisplay, type MerchantBusinessCardAsset } from "@/lib/merchantBusinessCards";
import { type PlatformSupportMessage, type PlatformSupportThread } from "@/lib/platformSupportInbox";
import { getMerchantServiceState } from "@/lib/merchantServiceStatus";
import { getBackgroundStyle } from "@/components/blocks/backgroundStyle";
import { buildMerchantFrontendHref, buildPlatformHomeHref, buildSiteStoreScope, PLATFORM_EDITOR_SCOPE } from "@/lib/siteRouting";
import { getPagePlanConfigFromBlocks } from "@/lib/pagePlans";
import {
  buildSuperAdminLoginHref,
  clearSuperAdminAuthenticated,
  getOrCreateSuperAdminDeviceId,
  isSuperAdminAuthenticated,
  syncSuperAdminAuthenticatedCookie,
} from "@/lib/superAdminAuth";
import { type SuperAdminTrustedDeviceRecord } from "@/lib/superAdminTrustedDevices";
import { useHydrated } from "@/lib/useHydrated";
import { uploadImageDataUrlToPublicStorage } from "@/lib/publicAssetUpload";
import { useNotificationSound } from "@/lib/useNotificationSound";

const SUPPORT_THREADS_OPEN_POLL_INTERVAL_MS = 1200;
const SUPPORT_THREADS_IDLE_POLL_INTERVAL_MS = 5000;
const SUPER_ADMIN_SUPPORT_LAST_READ_STORAGE_KEY_PREFIX = "super-admin-support-last-read:";

function fmt(iso: string | null) {
  if (!iso) return "-";
  const date = new Date(iso);
  return Number.isFinite(date.getTime()) ? date.toLocaleString("zh-CN", { hour12: false }) : iso;
}

function formatSupportMessageTime(value: string | null | undefined) {
  const normalized = String(value ?? "").trim();
  if (!normalized) return "-";
  const timestamp = new Date(normalized).getTime();
  return Number.isFinite(timestamp)
    ? new Date(timestamp).toLocaleString("zh-CN", { hour12: false })
    : normalized;
}

function formatSupportClockTime(value: string | null | undefined) {
  const normalized = String(value ?? "").trim();
  if (!normalized) return "-";
  const timestamp = new Date(normalized).getTime();
  return Number.isFinite(timestamp)
    ? new Date(timestamp).toLocaleTimeString("zh-CN", {
        hour12: false,
        hour: "2-digit",
        minute: "2-digit",
      })
    : normalized;
}

function formatSupportConversationTime(value: string | null | undefined) {
  const normalized = String(value ?? "").trim();
  if (!normalized) return "-";
  const date = new Date(normalized);
  const timestamp = date.getTime();
  if (!Number.isFinite(timestamp)) return normalized;

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfTarget = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const dayDiff = Math.round((startOfToday - startOfTarget) / 86400000);

  if (dayDiff === 0) return formatSupportClockTime(normalized);
  if (dayDiff === 1) return "昨天";
  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString("zh-CN", {
      month: "numeric",
      day: "numeric",
    });
  }
  return date.toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
  });
}

function formatSupportThreadDateLabel(value: string | null | undefined) {
  const normalized = String(value ?? "").trim();
  if (!normalized) return "";
  const date = new Date(normalized);
  const timestamp = date.getTime();
  if (!Number.isFinite(timestamp)) return normalized;

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfTarget = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const dayDiff = Math.round((startOfToday - startOfTarget) / 86400000);

  if (dayDiff === 0) return "今天";
  if (dayDiff === 1) return "昨天";
  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString("zh-CN", {
      month: "long",
      day: "numeric",
    });
  }
  return date.toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function isSameSupportCalendarDay(left: string | null | undefined, right: string | null | undefined) {
  const leftDate = new Date(String(left ?? "").trim());
  const rightDate = new Date(String(right ?? "").trim());
  if (!Number.isFinite(leftDate.getTime()) || !Number.isFinite(rightDate.getTime())) return false;
  return (
    leftDate.getFullYear() === rightDate.getFullYear() &&
    leftDate.getMonth() === rightDate.getMonth() &&
    leftDate.getDate() === rightDate.getDate()
  );
}

function getSupportAvatarLabel(value: string | null | undefined, fallback = "商") {
  const normalized = String(value ?? "").trim();
  if (!normalized) return fallback;
  const compact = normalized.replace(/\s+/g, "");
  if (!compact) return fallback;
  return compact.slice(0, 2).toUpperCase();
}

function normalizeSupportDetailText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeSupportDisplayValue(value: unknown) {
  const normalized = normalizeSupportDetailText(value);
  return normalized && normalized !== "-" ? normalized : "";
}

function buildSupportMerchantCardLink(card: MerchantBusinessCardAsset | null) {
  if (!card || card.mode !== "link") return "";
  const targetUrl = normalizeSupportDetailText(card.targetUrl);
  if (!targetUrl) return "";
  return buildMerchantBusinessCardShareUrl({
    origin: resolveMerchantBusinessCardShareOrigin(undefined, targetUrl),
    shareKey: normalizeSupportDetailText(card.shareKey),
    name: normalizeSupportDetailText(card.name),
    imageUrl: normalizeSupportDetailText(card.shareImageUrl) || normalizeSupportDetailText(card.imageUrl),
    detailImageUrl:
      normalizeSupportDetailText(card.contactPagePublicImageUrl) || normalizeSupportDetailText(card.contactPageImageUrl),
    detailImageHeight: card.contactPageImageHeight,
    targetUrl,
    contact: {
      displayName: normalizeSupportDetailText(card.contacts.contactName) || normalizeSupportDetailText(card.name),
      organization: normalizeSupportDetailText(card.name),
      title: normalizeSupportDetailText(card.title),
      phone: normalizeSupportDetailText(card.contacts.phone),
      phones: Array.isArray(card.contacts.phones) ? card.contacts.phones.filter(Boolean) : [],
      contactFieldOrder: card.contactFieldOrder,
      contactOnlyFields: card.contactOnlyFields,
      email: normalizeSupportDetailText(card.contacts.email),
      address: normalizeSupportDetailText(card.contacts.address),
      wechat: normalizeSupportDetailText(card.contacts.wechat),
      whatsapp: normalizeSupportDetailText(card.contacts.whatsapp),
      twitter: normalizeSupportDetailText(card.contacts.twitter),
      weibo: normalizeSupportDetailText(card.contacts.weibo),
      telegram: normalizeSupportDetailText(card.contacts.telegram),
      linkedin: normalizeSupportDetailText(card.contacts.linkedin),
      discord: normalizeSupportDetailText(card.contacts.discord),
      facebook: normalizeSupportDetailText(card.contacts.facebook),
      instagram: normalizeSupportDetailText(card.contacts.instagram),
      tiktok: normalizeSupportDetailText(card.contacts.tiktok),
      douyin: normalizeSupportDetailText(card.contacts.douyin),
      xiaohongshu: normalizeSupportDetailText(card.contacts.xiaohongshu),
      websiteUrl: targetUrl,
    },
  });
}

function normalizeSupportExternalUrl(value: string | null | undefined, fallbackOrigin?: string | null) {
  const normalized = normalizeSupportDetailText(value);
  if (!normalized) return "";
  if (/^https?:\/\//i.test(normalized)) return normalized;
  if (normalized.startsWith("/")) {
    const baseOrigin =
      normalizeSupportDetailText(fallbackOrigin) ||
      (typeof window !== "undefined" ? normalizeSupportDetailText(window.location.origin) : "");
    if (!baseOrigin) return normalized;
    try {
      return new URL(normalized, baseOrigin).toString();
    } catch {
      return normalized;
    }
  }
  return `https://${normalized}`;
}

function formatSupportUrlLabel(value: string | null | undefined) {
  const normalized = normalizeSupportDetailText(value);
  if (!normalized) return "-";
  try {
    const url = new URL(normalizeSupportExternalUrl(normalized));
    return `${url.host}${url.pathname === "/" ? "" : url.pathname}`.replace(/\/+$/g, "") || normalized;
  } catch {
    return normalized.replace(/^https?:\/\//i, "").replace(/\/+$/g, "") || normalized;
  }
}

function isSupportIpOrLocalHost(value: string) {
  return (
    /^https?:\/\/(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?(?:\/|$)/i.test(value) ||
    /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/|$)/i.test(value)
  );
}

function hasSupportMerchantProfileCoverage(profile: MerchantListPublishedSite | null | undefined) {
  if (!profile) return false;
  const hasWebsite = Boolean(
    normalizeSupportDisplayValue(profile.domainPrefix) ||
      normalizeSupportDisplayValue(profile.domainSuffix) ||
      normalizeSupportDisplayValue(profile.domain),
  );
  return Boolean(
    normalizeSupportDisplayValue(profile.contactPhone) ||
      normalizeSupportDisplayValue(profile.contactEmail) ||
      normalizeSupportDisplayValue(profile.industry) ||
      normalizeSupportDisplayValue(profile.location?.city) ||
      hasWebsite ||
      profile.chatBusinessCard,
  );
}

function buildSupportThreadsDigest(threads: PlatformSupportThread[]) {
  return threads
    .map((thread) => {
      const lastMessage = thread.messages[thread.messages.length - 1];
      return [
        thread.merchantId,
        thread.siteId,
        thread.updatedAt,
        thread.messages.length,
        lastMessage?.id ?? "",
        lastMessage?.createdAt ?? "",
        lastMessage?.sender ?? "",
      ].join("|");
    })
    .join("||");
}

function normalizeSupportMessageTimestamp(value: string | null | undefined) {
  const normalized = String(value ?? "").trim();
  if (!normalized) return "";
  const timestamp = new Date(normalized).getTime();
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : "";
}

function buildSuperAdminSupportLastReadStorageKey(merchantId: string) {
  return `${SUPER_ADMIN_SUPPORT_LAST_READ_STORAGE_KEY_PREFIX}${merchantId.trim() || "default"}`;
}

function normalizeEmailValue(value: string | null | undefined) {
  return String(value ?? "").trim().toLowerCase();
}

function normalizeMerchantIdValue(value: string | null | undefined) {
  const normalized = String(value ?? "").trim();
  return /^\d+$/.test(normalized) ? normalized : "";
}

function buildSupportMerchantSelectionKey(merchantId: string | null | undefined, siteId: string | null | undefined) {
  return normalizeMerchantIdValue(merchantId) || String(siteId ?? "").trim();
}

function getMerchantProfileName(site: Pick<Site, "merchantName"> | null | undefined) {
  return (site?.merchantName ?? "").trim();
}

function pickPreferredText(...values: Array<string | null | undefined>) {
  for (const value of values) {
    const normalized = String(value ?? "").trim();
    if (normalized) return normalized;
  }
  return "";
}

function normalizeMerchantIndustryValue(value: string | null | undefined) {
  const normalized = String(value ?? "").trim();
  return MERCHANT_INDUSTRY_OPTIONS.find((item) => item === normalized) ?? "";
}

function normalizeUnitInterval(value: unknown, fallback = 1) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(1, value));
}

function mergeSnapshotLocation(
  siteLocation: Site["location"] | null | undefined,
  snapshotLocation: MerchantListPublishedSite["location"] | null | undefined,
): Site["location"] {
  return {
    countryCode: pickPreferredText(snapshotLocation?.countryCode, siteLocation?.countryCode),
    country: pickPreferredText(snapshotLocation?.country, siteLocation?.country),
    provinceCode: pickPreferredText(snapshotLocation?.provinceCode, siteLocation?.provinceCode),
    province: pickPreferredText(snapshotLocation?.province, siteLocation?.province),
    city: pickPreferredText(snapshotLocation?.city, siteLocation?.city),
  };
}

function applyBackendProfileSnapshot(
  site: Site,
  snapshot: MerchantListPublishedSite | null | undefined,
  fallbackEmail?: string,
): Site {
  if (!snapshot) return site;
  const mergedPrefix = pickPreferredText(snapshot.domainPrefix, snapshot.domainSuffix, site.domainPrefix, site.domainSuffix);
  return {
    ...site,
    merchantName: pickPreferredText(snapshot.merchantName, site.merchantName),
    domainPrefix: mergedPrefix || site.domainPrefix,
    domainSuffix: mergedPrefix || site.domainSuffix,
    domain: pickPreferredText(snapshot.domain, site.domain),
    industry: normalizeMerchantIndustryValue(pickPreferredText(snapshot.industry, site.industry)),
    location: mergeSnapshotLocation(site.location, snapshot.location),
    contactAddress: pickPreferredText(snapshot.contactAddress, site.contactAddress),
    contactName: pickPreferredText(snapshot.contactName, site.contactName),
    contactPhone: pickPreferredText(snapshot.contactPhone, site.contactPhone),
    contactEmail: pickPreferredText(snapshot.contactEmail, site.contactEmail, fallbackEmail),
    merchantCardImageUrl: pickPreferredText(snapshot.merchantCardImageUrl, site.merchantCardImageUrl),
    merchantCardImageOpacity: normalizeUnitInterval(snapshot.merchantCardImageOpacity, site.merchantCardImageOpacity ?? 1),
    name: pickPreferredText(snapshot.name, site.name, snapshot.merchantName, site.merchantName),
  };
}

function normalizePublishedSitePrefix(value: string | null | undefined) {
  const normalized = String(value ?? "").trim();
  if (!normalized) return "";
  if (normalized.toLowerCase() === "home") return "";
  return normalized;
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
  const normalizedMerchantId = normalizeMerchantIdValue(account.merchantId);
  const publishedPrefix = normalizePublishedSitePrefix(account.siteSlug || account.profileSnapshot?.domainPrefix || account.profileSnapshot?.domainSuffix);
  const merchantLabel =
    account.merchantName ||
    account.profileSnapshot?.merchantName ||
    account.username ||
    account.loginId ||
    account.email ||
    account.merchantId ||
    "";
  const baseSite: Site = {
    id: normalizedMerchantId || `backend-${account.merchantId || account.email || "merchant"}`,
    tenantId: "backend-only",
    merchantName: merchantLabel,
    domainPrefix: publishedPrefix,
    domainSuffix: publishedPrefix,
    contactAddress: "",
    contactName: "",
    contactPhone: "",
    contactEmail: account.email,
    name: merchantLabel,
    domain: buildMerchantFrontendHref(normalizedMerchantId || account.merchantId, publishedPrefix),
    categoryId: "unlinked",
    category: account.hasPublishedSite ? "已建站" : "未建站",
    industry: "",
    status: account.hasPublishedSite ? "online" : "offline",
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
    merchantCardImageOpacity: 1,
    sortConfig: createDefaultMerchantSortConfig(),
    configHistory: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  return applyBackendProfileSnapshot(baseSite, account.profileSnapshot, account.email);
}

function buildThreadOnlyMerchantRow(thread: PlatformSupportThread): MerchantUserRow {
  const normalizedMerchantId =
    normalizeMerchantIdValue(thread.merchantId) || normalizeMerchantIdValue(thread.siteId);
  const timestamp = thread.updatedAt || nextIsoNow();
  const merchantLabel =
    (thread.merchantName ?? "").trim() || normalizedMerchantId || (thread.siteId ?? "").trim() || "商户";
  const siteId = normalizedMerchantId || (thread.siteId ?? "").trim() || `support-${merchantLabel}`;
  const prefix = normalizePublishedSitePrefix(thread.siteId);
  const site: Site = {
    id: siteId,
    tenantId: "support-thread",
    merchantName: merchantLabel,
    domainPrefix: prefix,
    domainSuffix: prefix,
    contactAddress: "",
    contactName: "",
    contactPhone: "",
    contactEmail: (thread.merchantEmail ?? "").trim(),
    name: merchantLabel,
    domain: buildMerchantFrontendHref(normalizedMerchantId || siteId, prefix),
    categoryId: "support-thread",
    category: "商户",
    industry: "",
    status: "online",
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
    merchantCardImageOpacity: 1,
    sortConfig: createDefaultMerchantSortConfig(),
    configHistory: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  return {
    site,
    hasSite: Boolean(normalizedMerchantId),
    hasLocalSite: false,
    backendAccount: null,
    merchantId: normalizedMerchantId || (thread.merchantId ?? "").trim() || "-",
    loginAccount: (thread.merchantEmail ?? "").trim() || normalizedMerchantId || "-",
    userEmail: (thread.merchantEmail ?? "").trim() || "-",
    merchantName: merchantLabel,
    prefix: prefix || "-",
    industry: "-",
    city: "-",
    sizeBytes: 0,
    sizeKnown: false,
    visits: { today: 0, day7: 0, day30: 0, total: 0 },
    visitsKnown: false,
    registerAt: timestamp,
    expireAt: null,
    expired: false,
    statusLabel: "已建站",
    statusKey: "linked",
  };
}

function buildMerchantSiteContext(site: Site, owner: PlatformState["users"][number] | null, nowMs: number): MerchantSiteContext {
  const userEmail = (site.contactEmail ?? "").trim() || owner?.email || "";
  const prefix = (site.domainPrefix ?? site.domainSuffix ?? "").trim();
  const industry = (site.industry ?? "").trim() || "未设置";
  const city = (site.location?.city ?? "").trim() || "-";
  const sizeBytes = readMerchantPublishedBytes(site.id);
  const visits = readMerchantVisits(site.id, nowMs);
  const serviceState = getMerchantServiceState(site.status, site.serviceExpiresAt, nowMs);
  const expireAt = serviceState.serviceExpiresAt;
  const statusKey: "active" | "paused" = serviceState.maintenance ? "paused" : "active";
  return {
    site,
    userEmail,
    prefix,
    industry,
    city,
    sizeBytes,
    visits,
    expireAt,
    expired: serviceState.expired,
    statusKey,
    statusLabel: statusKey === "active" ? "正常" : "暂停",
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

async function saveMerchantDraftViaApi(siteId: string, blocks: Block[], updatedAt?: string) {
  const normalizedSiteId = String(siteId ?? "").trim();
  if (!normalizedSiteId) {
    return { ok: false as const, message: "缺少站点 ID，无法同步商户草稿" };
  }
  try {
    const response = await fetch("/api/merchant-draft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({
        siteId: normalizedSiteId,
        blocks,
        updatedAt: String(updatedAt ?? "").trim() || new Date().toISOString(),
      }),
    });
    const payload = (await response.json().catch(() => null)) as { message?: string } | null;
    if (!response.ok) {
      return {
        ok: false as const,
        message: payload?.message || "商户后台草稿同步失败，请稍后重试",
      };
    }
    return { ok: true as const };
  } catch (error) {
    return {
      ok: false as const,
      message: error instanceof Error ? error.message : "商户后台草稿同步失败，请稍后重试",
    };
  }
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

function siteStatusLabel(status: SiteStatus) {
  if (status === "online") return "在线";
  if (status === "maintenance") return "维护中";
  return "离线";
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${Math.round(bytes)} B`;
}

function formatOptionalBytes(bytes: number, known: boolean) {
  return known ? formatBytes(bytes) : "-";
}

function formatOptionalCount(value: number, known: boolean) {
  return known ? `${value}` : "-";
}

function estimateUtf8Size(text: string) {
  if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(text).length;
  return text.length;
}

function daysBetweenNow(isoDate: string, nowMs: number) {
  const at = new Date(isoDate).getTime();
  if (!Number.isFinite(at)) return Number.POSITIVE_INFINITY;
  return (nowMs - at) / 86400_000;
}

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

const MAX_MERCHANT_CARD_IMAGE_DATA_URL_BYTES = 900_000;
const MAX_PLATFORM_STATE_STORAGE_BYTES = 4_500_000;
const MERCHANT_CARD_IMAGE_MAX_SIDE = 1280;
const MERCHANT_CARD_IMAGE_MIN_SIDE = 160;
const MERCHANT_CARD_IMAGE_TARGET_BYTES = 80_000;
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
  const originalBytes = estimateUtf8Size(original);
  if (originalBytes <= MERCHANT_CARD_IMAGE_TARGET_BYTES && Math.max(width, height) <= MERCHANT_CARD_IMAGE_MAX_SIDE) {
    return original;
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
  let bestBytes = originalBytes;
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

async function uploadMerchantCardImageDataUrlToSupabase(dataUrl: string, siteHint = "merchant-card") {
  return uploadImageDataUrlToPublicStorage(dataUrl, siteHint);
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
    chatAvatarImageUrl: (site.chatAvatarImageUrl ?? "").trim(),
    contactVisibility: site.contactVisibility ?? createDefaultMerchantContactVisibility(),
    merchantCardImageOpacity: normalizeUnitInterval(site.merchantCardImageOpacity, 1),
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
    key === "allowBusinessCardLinkMode" ||
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
  if (normalizeUnitInterval(current.merchantCardImageOpacity, 1) !== normalizeUnitInterval(target.merchantCardImageOpacity, 1)) {
    lines.push(
      `商户卡图片透明度：${Math.round(normalizeUnitInterval(current.merchantCardImageOpacity, 1) * 100)}% -> ${Math.round(normalizeUnitInterval(target.merchantCardImageOpacity, 1) * 100)}%`,
    );
  }
  const permissionFields: Array<{
    key: keyof MerchantConfigSnapshot["permissionConfig"];
    label: string;
  }> = [
    { key: "planLimit", label: "方案上限" },
    { key: "pageLimit", label: "页面上限" },
    { key: "businessCardLimit", label: "名片夹上限" },
    { key: "allowBusinessCardLinkMode", label: "可链接模式名片" },
    { key: "businessCardBackgroundImageLimitKb", label: "名片背景图上限(KB)" },
    { key: "businessCardContactImageLimitKb", label: "联系卡展示图上限(KB)" },
    { key: "businessCardExportImageLimitKb", label: "导出名片图片上限(KB)" },
    { key: "commonBlockImageLimitKb", label: "通用区块图片上限(KB)" },
    { key: "galleryBlockImageLimitKb", label: "相册区块图片上限(KB)" },
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

type MerchantUserRow = {
  site: Site;
  hasSite: boolean;
  hasLocalSite: boolean;
  backendAccount: BackendMerchantAccount | null;
  merchantId: string;
  loginAccount: string;
  userEmail: string;
  merchantName: string;
  prefix: string;
  industry: string;
  city: string;
  sizeBytes: number;
  sizeKnown: boolean;
  visits: MerchantVisits;
  visitsKnown: boolean;
  registerAt: string;
  expireAt: string | null;
  expired: boolean;
  statusLabel: "正常" | "暂停" | "已建站" | "未建站";
  statusKey: "active" | "paused" | "linked" | "unlinked";
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
  hasPublishedSite: boolean;
  siteSlug: string;
  siteUpdatedAt: string | null;
  publishedBytes: number;
  publishedBytesKnown: boolean;
  visits: MerchantVisits;
  visitsKnown: boolean;
  profileSnapshot: MerchantListPublishedSite | null;
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
  const [activeMenu, setActiveMenu] = useState<"site_editor" | "user_manage" | "support_messages" | "merchant_id_rules" | "trusted_devices" | "stats" | "logs">("site_editor");
  const [isMobileSupportOnlyMode, setIsMobileSupportOnlyMode] = useState(false);
  const [supportMobileView, setSupportMobileView] = useState<"list" | "thread">("list");
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

  const [featureSiteId, setFeatureSiteId] = useState("");

  const [publishSiteId, setPublishSiteId] = useState("");
  const [publishNote, setPublishNote] = useState("");
  const [userKeyword, setUserKeyword] = useState("");
  const [merchantDetailSiteId, setMerchantDetailSiteId] = useState("");
  const [userPanelMode, setUserPanelMode] = useState<"detail" | "config" | "history">("detail");
  const [configExpireDate, setConfigExpireDate] = useState("");
  const [configPlanLimit, setConfigPlanLimit] = useState("1");
  const [configPageLimit, setConfigPageLimit] = useState("3");
  const [configBusinessCardLimit, setConfigBusinessCardLimit] = useState("1");
  const [configAllowBusinessCardLinkMode, setConfigAllowBusinessCardLinkMode] = useState(false);
  const [configBusinessCardBackgroundImageLimitKb, setConfigBusinessCardBackgroundImageLimitKb] = useState("200");
  const [configBusinessCardContactImageLimitKb, setConfigBusinessCardContactImageLimitKb] = useState("200");
  const [configBusinessCardExportImageLimitKb, setConfigBusinessCardExportImageLimitKb] = useState("400");
  const [configCommonBlockImageLimitKb, setConfigCommonBlockImageLimitKb] = useState("300");
  const [configGalleryBlockImageLimitKb, setConfigGalleryBlockImageLimitKb] = useState("300");
  const [configPublishLimitMb, setConfigPublishLimitMb] = useState("5");
  const [configAllowInsertBackground, setConfigAllowInsertBackground] = useState(false);
  const [configAllowThemeEffects, setConfigAllowThemeEffects] = useState(false);
  const [configAllowButtonBlock, setConfigAllowButtonBlock] = useState(false);
  const [configAllowGalleryBlock, setConfigAllowGalleryBlock] = useState(false);
  const [configAllowMusicBlock, setConfigAllowMusicBlock] = useState(false);
  const [configAllowProductBlock, setConfigAllowProductBlock] = useState(false);
  const [configAllowBookingBlock, setConfigAllowBookingBlock] = useState(false);
  const [configMerchantCardImage, setConfigMerchantCardImage] = useState("");
  const [configMerchantCardImageOpacity, setConfigMerchantCardImageOpacity] = useState(1);
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
  const [supportThreads, setSupportThreads] = useState<PlatformSupportThread[]>([]);
  const [supportThreadsLoading, setSupportThreadsLoading] = useState(false);
  const [supportThreadsError, setSupportThreadsError] = useState("");
  const [supportSelectedMerchantId, setSupportSelectedMerchantId] = useState("");
  const [supportMerchantKeyword, setSupportMerchantKeyword] = useState("");
  const [supportReplyDraft, setSupportReplyDraft] = useState("");
  const [supportSending, setSupportSending] = useState(false);
  const [supportBusinessCardDialogOpen, setSupportBusinessCardDialogOpen] = useState(false);
  const [supportMerchantInfoSheetOpen, setSupportMerchantInfoSheetOpen] = useState(false);
  const [supportMerchantProfilesByMerchantId, setSupportMerchantProfilesByMerchantId] = useState<
    Record<string, MerchantListPublishedSite | null>
  >({});
  const [supportLastReadMap, setSupportLastReadMap] = useState<Record<string, string>>({});
  const supportMessagesViewportRef = useRef<HTMLDivElement>(null);
  const supportReplyInputRef = useRef<HTMLTextAreaElement>(null);
  const supportLastMessageKeyRef = useRef("");
  const supportLastIncomingMerchantMessageKeyRef = useRef("");
  const supportMobileSwipeStartRef = useRef<{ x: number; y: number; fromEdge: boolean } | null>(null);
  const supportMerchantProfileLoadingIdsRef = useRef(new Set<string>());
  const supportThreadsRequestIdRef = useRef(0);
  const supportThreadsDigestRef = useRef("");
  const supportThreadsLoadTaskRef = useRef<Promise<void> | null>(null);
  const loadSupportThreadsActionRef = useRef<(options?: { silent?: boolean; suppressError?: boolean }) => Promise<void>>(async () => {});
  const applySupportThreadsState = useCallback((threads: PlatformSupportThread[]) => {
    const nextThreads = Array.isArray(threads) ? threads : [];
    const nextDigest = buildSupportThreadsDigest(nextThreads);
    if (nextDigest === supportThreadsDigestRef.current) {
      return false;
    }
    supportThreadsDigestRef.current = nextDigest;
    setSupportThreads(nextThreads);
    return true;
  }, []);
  const focusSupportReplyInput = useCallback(() => {
    if (typeof window === "undefined") return;
    window.requestAnimationFrame(() => {
      const input = supportReplyInputRef.current;
      if (!input || input.disabled) return;
      input.focus({ preventScroll: true });
      const caretPosition = input.value.length;
      try {
        input.setSelectionRange(caretPosition, caretPosition);
      } catch {
        // Ignore browsers that do not allow selection updates on this field.
      }
    });
  }, []);
  const closeMobileSupportThread = useCallback(() => {
    setSupportMerchantInfoSheetOpen(false);
    setSupportMobileView("list");
  }, []);
  const handleSupportMobileThreadTouchStart = useCallback((event: TouchEvent<HTMLDivElement>) => {
    const touch = event.touches[0];
    if (!touch) return;
    supportMobileSwipeStartRef.current = {
      x: touch.clientX,
      y: touch.clientY,
      fromEdge: touch.clientX <= 36,
    };
  }, []);
  const handleSupportMobileThreadTouchEnd = useCallback(
    (event: TouchEvent<HTMLDivElement>) => {
      const start = supportMobileSwipeStartRef.current;
      supportMobileSwipeStartRef.current = null;
      if (!start?.fromEdge) return;
      const touch = event.changedTouches[0];
      if (!touch) return;
      const deltaX = touch.clientX - start.x;
      const deltaY = touch.clientY - start.y;
      if (deltaX >= 72 && Math.abs(deltaY) <= 64 && deltaX > Math.abs(deltaY) * 1.2) {
        closeMobileSupportThread();
      }
    },
    [closeMobileSupportThread],
  );
  useEffect(() => {
    if (typeof window === "undefined") return;
    const media = window.matchMedia("(max-width: 1023px)");
    const updateMobileSupportOnlyMode = () => setIsMobileSupportOnlyMode(media.matches);
    updateMobileSupportOnlyMode();
    media.addEventListener("change", updateMobileSupportOnlyMode);
    return () => media.removeEventListener("change", updateMobileSupportOnlyMode);
  }, []);
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
  const [trustedDevices, setTrustedDevices] = useState<SuperAdminTrustedDeviceRecord[]>([]);
  const [trustedDevicesLoading, setTrustedDevicesLoading] = useState(false);
  const [trustedDevicesError, setTrustedDevicesError] = useState("");
  const [trustedDeviceDeletingId, setTrustedDeviceDeletingId] = useState("");
  const [trustedDeviceLimit, setTrustedDeviceLimit] = useState(3);
  const [trustedDeviceLimitInput, setTrustedDeviceLimitInput] = useState("3");
  const [trustedDeviceLimitSaving, setTrustedDeviceLimitSaving] = useState(false);
  const [currentSuperAdminDeviceId, setCurrentSuperAdminDeviceId] = useState("");
  const checklistStorageKeyRef = useRef(releaseChecklistStorageKeyForToday());
  const [releaseChecklistState, setReleaseChecklistState] = useState<Record<string, boolean>>(() =>
    loadReleaseChecklistStateFromStorage(),
  );
  const playNotificationSound = useNotificationSound();
  const platformMerchantSnapshotPayload = useMemo(
    () => buildPlatformMerchantSnapshotPayloadFromSites(state.sites, state.homeLayout.merchantDefaultSortRule),
    [state.sites, state.homeLayout.merchantDefaultSortRule],
  );
  const platformMerchantSnapshotPayloadKey = useMemo(
    () => JSON.stringify(platformMerchantSnapshotPayload),
    [platformMerchantSnapshotPayload],
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
    if (!hydrated || !authed) return;
    if (isMobileSupportOnlyMode) return;
    if (platformMerchantSnapshotPayload.snapshot.length === 0) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      fetch("/api/super-admin/platform-merchant-snapshot", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        cache: "no-store",
        signal: controller.signal,
        body: platformMerchantSnapshotPayloadKey,
      }).catch(() => {
        // Keep the super-admin screen responsive even if background sync fails.
      });
    }, 250);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [authed, hydrated, isMobileSupportOnlyMode, platformMerchantSnapshotPayload.snapshot.length, platformMerchantSnapshotPayloadKey]);

  useEffect(() => {
    if (!hydrated || !authed || typeof window === "undefined") return;
    void loadSupportThreadsActionRef.current({
      silent: activeMenu !== "support_messages",
      suppressError: activeMenu !== "support_messages",
    });
    const refreshSupportThreads = () => {
      void loadSupportThreadsActionRef.current({
        silent: true,
        suppressError: activeMenu !== "support_messages",
      });
    };
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      refreshSupportThreads();
    }, activeMenu === "support_messages" ? SUPPORT_THREADS_OPEN_POLL_INTERVAL_MS : SUPPORT_THREADS_IDLE_POLL_INTERVAL_MS);
    const handleFocus = () => refreshSupportThreads();
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        refreshSupportThreads();
      }
    };
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [activeMenu, authed, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    if (!authed) {
      const next = `${window.location.pathname}${window.location.search}`;
      window.location.href = buildSuperAdminLoginHref(next);
    }
  }, [authed, hydrated]);

  useEffect(() => {
    if (!hydrated || !authed) return;
    setCurrentSuperAdminDeviceId(getOrCreateSuperAdminDeviceId());
  }, [authed, hydrated]);

  useEffect(() => {
    if (!hydrated || !authed) return;
    let cancelled = false;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), isMobileSupportOnlyMode ? 6000 : 15_000);
    const loadAccounts = async () => {
      setBackendMerchantAccountsLoading(true);
      setBackendMerchantAccountsError("");
      try {
        const requestUrl = isMobileSupportOnlyMode
          ? "/api/super-admin/merchant-accounts?scope=support"
          : "/api/super-admin/merchant-accounts";
        const requestAccounts = async () =>
          fetch(requestUrl, {
            method: "GET",
            cache: "no-store",
            signal: controller.signal,
          });
        let response = await requestAccounts();
        if ((response.status === 401 || response.status === 403) && syncSuperAdminAuthenticatedCookie()) {
          response = await requestAccounts();
        }
        if (!response.ok) {
          throw new Error(`merchant_account_http_${response.status}`);
        }
        const payload = (await response.json()) as { items?: BackendMerchantAccount[] };
        if (cancelled) return;
        setBackendMerchantAccounts(Array.isArray(payload.items) ? payload.items : []);
      } catch (error) {
        if (cancelled) return;
        setBackendMerchantAccounts([]);
        if (error instanceof DOMException && error.name === "AbortError") {
          setBackendMerchantAccountsError("merchant_account_timeout");
          return;
        }
        setBackendMerchantAccountsError(error instanceof Error ? error.message : "merchant_account_load_failed");
      } finally {
        if (!cancelled) setBackendMerchantAccountsLoading(false);
      }
    };
    void loadAccounts();
    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [authed, hydrated, isMobileSupportOnlyMode]);

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
    if (!hydrated || !authed) return;
    let cancelled = false;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 8000);
    setTrustedDevicesLoading(true);
    setTrustedDevicesError("");
    fetch("/api/super-admin/trusted-devices", {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`trusted_devices_http_${response.status}`);
        }
        const payload = (await response.json()) as { items?: SuperAdminTrustedDeviceRecord[]; maxDevices?: number };
        if (cancelled) return;
        setTrustedDevices(Array.isArray(payload.items) ? payload.items : []);
        const nextMaxDevices =
          typeof payload.maxDevices === "number" && Number.isFinite(payload.maxDevices) ? payload.maxDevices : 3;
        setTrustedDeviceLimit(nextMaxDevices);
        setTrustedDeviceLimitInput(`${nextMaxDevices}`);
      })
      .catch((error) => {
        if (cancelled) return;
        setTrustedDevices([]);
        setTrustedDeviceLimit(3);
        setTrustedDeviceLimitInput("3");
        if (error instanceof DOMException && error.name === "AbortError") {
          setTrustedDevicesError("trusted_devices_timeout");
          return;
        }
        setTrustedDevicesError(error instanceof Error ? error.message : "trusted_devices_load_failed");
      })
      .finally(() => {
        if (!cancelled) setTrustedDevicesLoading(false);
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
  const activeFeatureSiteId = featureSiteId || state.sites[0]?.id || "";
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
    const matchMerchantSite = buildMerchantSiteLinker(state.sites, state.users);
    const legacySiteContextByEmail = new Map<string, MerchantSiteContext>();

    state.sites
      .filter((site) => site.id !== "site-main")
      .forEach((site) => {
        const siteContext = buildMerchantSiteContext(site, merchantOwnerBySiteId.get(site.id) ?? null, nowMs);
        const emailKey = normalizeEmailValue(siteContext.userEmail);
        if (!emailKey) return;
        const current = legacySiteContextByEmail.get(emailKey);
        if (!current) {
          legacySiteContextByEmail.set(emailKey, siteContext);
          return;
        }
        const currentTs = new Date(current.site.createdAt).getTime();
        const candidateTs = new Date(siteContext.site.createdAt).getTime();
        if (candidateTs > currentTs) {
          legacySiteContextByEmail.set(emailKey, siteContext);
        }
      });

    const sorted: MerchantUserRow[] = backendMerchantAccounts.map((account) => {
      const merchantId = normalizeMerchantIdValue(account.merchantId) || "-";
      const matchedSite =
        matchMerchantSite({
          merchantId: account.merchantId,
          email: account.email,
          siteSlug: account.siteSlug,
          merchantName: account.merchantName,
          username: account.username,
        }) ?? null;
      const legacySiteContext = legacySiteContextByEmail.get(normalizeEmailValue(account.email)) ?? null;
      const localSite = matchedSite ?? legacySiteContext?.site ?? null;
      const mergedSite = localSite ? applyBackendProfileSnapshot(localSite, account.profileSnapshot, account.email) : null;
      const localSiteContext = mergedSite
        ? buildMerchantSiteContext(mergedSite, merchantOwnerBySiteId.get(mergedSite.id) ?? null, nowMs)
        : legacySiteContext;
      const hasPublishedSite = account.hasPublishedSite === true;
      const hasSyncedProfile = Boolean(account.profileSnapshot);
      const canOperateAsSite = hasPublishedSite || hasSyncedProfile;
      const publishedPrefix = normalizePublishedSitePrefix(account.siteSlug);
      if (localSiteContext) {
        const merchantName = getMerchantProfileName(localSiteContext.site);
        const accountEmail = account.email || localSiteContext.userEmail || "-";
        return {
          site: localSiteContext.site,
          hasSite: true,
          hasLocalSite: true,
          backendAccount: account,
          merchantId,
          loginAccount: accountEmail,
          userEmail: accountEmail,
          merchantName,
          prefix: localSiteContext.prefix || publishedPrefix || "-",
          industry: localSiteContext.industry,
          city: localSiteContext.city,
          sizeBytes: account.publishedBytes,
          sizeKnown: account.publishedBytesKnown,
          visits: account.visits,
          visitsKnown: account.visitsKnown,
          registerAt: account.createdAt ?? localSiteContext.site.createdAt,
          expireAt: localSiteContext.expireAt,
          expired: localSiteContext.expired,
          statusLabel: localSiteContext.statusLabel,
          statusKey: localSiteContext.statusKey,
        };
      }
      const backendOnlySite = buildBackendOnlySite(account);
      return {
        site: backendOnlySite,
        hasSite: canOperateAsSite,
        hasLocalSite: false,
        backendAccount: account,
        merchantId,
        loginAccount: account.email || "-",
        userEmail: account.email || "-",
        merchantName: getMerchantProfileName(backendOnlySite),
        prefix: normalizePublishedSitePrefix(backendOnlySite.domainPrefix ?? backendOnlySite.domainSuffix) || publishedPrefix || "-",
        industry: (backendOnlySite.industry ?? "").trim() || "-",
        city: (backendOnlySite.location?.city ?? "").trim() || "-",
        sizeBytes: account.publishedBytes,
        sizeKnown: account.publishedBytesKnown,
        visits: account.visits,
        visitsKnown: account.visitsKnown,
        registerAt: account.createdAt ?? nextIsoNow(),
        expireAt: null,
        expired: false,
        statusLabel: canOperateAsSite ? "已建站" : "未建站",
        statusKey: canOperateAsSite ? "linked" : "unlinked",
      };
    });

    const sortRule = state.homeLayout.merchantDefaultSortRule;
    sorted.sort((a, b) => {
      if (sortRule === "name_asc") return a.merchantName.localeCompare(b.merchantName, "zh-CN");
      if (sortRule === "name_desc") return b.merchantName.localeCompare(a.merchantName, "zh-CN");
      if (sortRule === "created_asc") return new Date(a.registerAt).getTime() - new Date(b.registerAt).getTime();
      if (sortRule === "monthly_views_desc") return b.visits.day30 - a.visits.day30;
      return new Date(b.registerAt).getTime() - new Date(a.registerAt).getTime();
    });
    return sorted;
  }, [backendMerchantAccounts, merchantOwnerBySiteId, nowMs, state.homeLayout.merchantDefaultSortRule, state.sites, state.users]);
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
  const planTemplateTargetSite =
    merchantRows.find((row) => row.site.id === planTemplateTargetSiteId)?.site ??
    state.sites.find((site) => site.id === planTemplateTargetSiteId) ??
    null;
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
  const supportThreadBySelectionKey = useMemo(() => {
    const map = new Map<string, PlatformSupportThread>();
    supportThreads.forEach((thread) => {
      const key = buildSupportMerchantSelectionKey(thread.merchantId, thread.siteId);
      if (key && !map.has(key)) {
        map.set(key, thread);
      }
    });
    return map;
  }, [supportThreads]);
  const supportBaseRows = useMemo(() => {
    const merged = new Map<
      string,
      {
        row: MerchantUserRow;
        selectionKey: string;
        thread: PlatformSupportThread | null;
        lastMessage: PlatformSupportMessage | null;
      }
    >();

    merchantRows.forEach((row) => {
      const selectionKey = buildSupportMerchantSelectionKey(row.merchantId, row.site.id);
      if (!selectionKey) return;
      const thread = supportThreadBySelectionKey.get(selectionKey) ?? null;
      merged.set(selectionKey, {
        row,
        selectionKey,
        thread,
        lastMessage: thread?.messages[thread.messages.length - 1] ?? null,
      });
    });

    supportThreads.forEach((thread) => {
      const selectionKey = buildSupportMerchantSelectionKey(thread.merchantId, thread.siteId);
      if (!selectionKey || merged.has(selectionKey)) return;
      const row = buildThreadOnlyMerchantRow(thread);
      merged.set(selectionKey, {
        row,
        selectionKey,
        thread,
        lastMessage: thread.messages[thread.messages.length - 1] ?? null,
      });
    });

    return [...merged.values()];
  }, [merchantRows, supportThreadBySelectionKey, supportThreads]);
  const supportListRows = useMemo(() => {
    const q = supportMerchantKeyword.trim().toLowerCase();
    return supportBaseRows
      .filter((item) => {
        if (!q) return true;
        return [
          item.row.userEmail,
          item.row.loginAccount,
          item.row.merchantId,
          item.row.merchantName,
          item.row.backendAccount?.username,
          item.row.backendAccount?.loginId,
          item.thread?.merchantEmail,
          item.thread?.merchantName,
          item.thread?.merchantId,
        ]
          .join(" ")
          .toLowerCase()
          .includes(q);
      })
      .sort((left, right) => {
        const leftThreadTs = left.thread ? new Date(left.thread.updatedAt).getTime() : 0;
        const rightThreadTs = right.thread ? new Date(right.thread.updatedAt).getTime() : 0;
        if (leftThreadTs && !rightThreadTs) return -1;
        if (!leftThreadTs && rightThreadTs) return 1;
        if (leftThreadTs !== rightThreadTs) return rightThreadTs - leftThreadTs;
        const leftRegisterTs = new Date(left.row.registerAt).getTime();
        const rightRegisterTs = new Date(right.row.registerAt).getTime();
        if (leftRegisterTs !== rightRegisterTs) return rightRegisterTs - leftRegisterTs;
        return left.row.merchantName.localeCompare(right.row.merchantName, "zh-CN");
      });
  }, [supportBaseRows, supportMerchantKeyword]);
  const selectedSupportListRow =
    supportListRows.find((item) => item.selectionKey === supportSelectedMerchantId) ?? supportListRows[0] ?? null;
  const selectedSupportMerchantRow = selectedSupportListRow?.row ?? null;
  const selectedSupportThread = useMemo(
    () =>
      selectedSupportMerchantRow
        ? (selectedSupportListRow?.thread ?? {
            merchantId: buildSupportMerchantSelectionKey(selectedSupportMerchantRow.merchantId, selectedSupportMerchantRow.site.id),
            siteId: selectedSupportMerchantRow.site.id,
            merchantName: selectedSupportMerchantRow.merchantName,
            merchantEmail: selectedSupportMerchantRow.userEmail,
            updatedAt: selectedSupportMerchantRow.registerAt,
            messages: [],
          })
        : null,
    [selectedSupportListRow, selectedSupportMerchantRow],
  );
  const selectedSupportDisplayLabel =
    selectedSupportMerchantRow?.merchantName ||
    selectedSupportThread?.merchantName ||
    selectedSupportThread?.merchantId ||
    "-";
  const selectedSupportMerchantId =
    normalizeSupportDisplayValue(selectedSupportMerchantRow?.merchantId) ||
    normalizeSupportDisplayValue(selectedSupportThread?.merchantId) ||
    "-";
  const localSupportSnapshotByMerchantId = useMemo(
    () => new Map(platformMerchantSnapshotPayload.snapshot.map((site) => [site.id, site] as const)),
    [platformMerchantSnapshotPayload],
  );
  const selectedSupportFetchedProfile = useMemo(() => {
    if (!/^\d{8}$/.test(selectedSupportMerchantId)) return undefined;
    return Object.prototype.hasOwnProperty.call(supportMerchantProfilesByMerchantId, selectedSupportMerchantId)
      ? supportMerchantProfilesByMerchantId[selectedSupportMerchantId]
      : undefined;
  }, [selectedSupportMerchantId, supportMerchantProfilesByMerchantId]);
  const selectedSupportLocalProfile = useMemo(
    () => (/^\d{8}$/.test(selectedSupportMerchantId) ? localSupportSnapshotByMerchantId.get(selectedSupportMerchantId) ?? null : null),
    [localSupportSnapshotByMerchantId, selectedSupportMerchantId],
  );
  const selectedSupportProfile = selectedSupportFetchedProfile ?? selectedSupportLocalProfile ?? null;
  const selectedSupportMerchantEmail =
    normalizeSupportDisplayValue(selectedSupportProfile?.contactEmail) ||
    normalizeSupportDisplayValue(selectedSupportMerchantRow?.userEmail) ||
    normalizeSupportDisplayValue(selectedSupportThread?.merchantEmail) ||
    "-";
  const selectedSupportMerchantIndustry =
    normalizeSupportDisplayValue(selectedSupportProfile?.industry) ||
    normalizeSupportDisplayValue(selectedSupportMerchantRow?.industry) ||
    normalizeSupportDisplayValue(selectedSupportMerchantRow?.site.industry) ||
    "未设置行业";
  const selectedSupportMerchantCity =
    normalizeSupportDisplayValue(selectedSupportProfile?.location.city) ||
    normalizeSupportDisplayValue(selectedSupportMerchantRow?.city) ||
    normalizeSupportDisplayValue(selectedSupportMerchantRow?.site.location.city) ||
    "-";
  const selectedSupportMerchantPhone =
    normalizeSupportDisplayValue(selectedSupportProfile?.contactPhone) ||
    normalizeSupportDisplayValue(selectedSupportMerchantRow?.site.contactPhone) ||
    "-";
  const selectedSupportMerchantPrefix =
    normalizeSupportDisplayValue(selectedSupportProfile?.domainPrefix) ||
    normalizeSupportDisplayValue(selectedSupportProfile?.domainSuffix) ||
    normalizeSupportDisplayValue(selectedSupportMerchantRow?.site.domainPrefix) ||
    normalizeSupportDisplayValue(selectedSupportMerchantRow?.site.domainSuffix) ||
    normalizeSupportDisplayValue(selectedSupportMerchantRow?.prefix);
  const selectedSupportBusinessCard = resolveMerchantBusinessCardForChatDisplay(
    selectedSupportMerchantRow?.site.businessCards ?? [],
  );
  const selectedSupportResolvedBusinessCard = selectedSupportProfile?.chatBusinessCard ?? selectedSupportBusinessCard;
  const selectedSupportLatestMessage = selectedSupportThread?.messages[selectedSupportThread.messages.length - 1] ?? null;
  const selectedSupportThreadMerchantId = selectedSupportThread?.merchantId?.trim() ?? "";
  const selectedSupportLatestMessageKey =
    selectedSupportThread && selectedSupportLatestMessage
      ? `${selectedSupportThread.merchantId}:${selectedSupportLatestMessage.id}:${selectedSupportLatestMessage.createdAt}`
      : "";
  const latestIncomingMerchantMessageKey = useMemo(() => {
    let latestKey = "";
    let latestTimestamp = 0;

    supportThreads.forEach((thread) => {
      for (let index = thread.messages.length - 1; index >= 0; index -= 1) {
        const message = thread.messages[index];
        if (!message || message.sender !== "merchant") continue;
        const timestamp = new Date(message.createdAt).getTime();
        const normalizedTimestamp = Number.isFinite(timestamp) ? timestamp : 0;
        const key = `${thread.merchantId}:${message.id}:${message.createdAt}`;
        if (
          normalizedTimestamp > latestTimestamp ||
          (normalizedTimestamp === latestTimestamp && key > latestKey)
        ) {
          latestTimestamp = normalizedTimestamp;
          latestKey = key;
        }
        break;
      }
    });

    return latestKey;
  }, [supportThreads]);
  const selectedSupportLatestMerchantMessageAt =
    selectedSupportLatestMessage?.sender === "merchant"
      ? normalizeSupportMessageTimestamp(selectedSupportLatestMessage.createdAt)
      : "";
  const supportUnreadMerchantIds = useMemo(() => {
    const unreadMerchantIds = new Set<string>();
    supportThreads.forEach((thread) => {
      const lastMessage = thread.messages[thread.messages.length - 1];
      if (!lastMessage || lastMessage.sender !== "merchant") return;
      const lastMessageAt = normalizeSupportMessageTimestamp(lastMessage.createdAt);
      if (!lastMessageAt) return;
      const lastReadAt = normalizeSupportMessageTimestamp(supportLastReadMap[thread.merchantId]);
      if (new Date(lastMessageAt).getTime() > new Date(lastReadAt || 0).getTime()) {
        unreadMerchantIds.add(thread.merchantId);
      }
    });
    return unreadMerchantIds;
  }, [supportLastReadMap, supportThreads]);
  const supportHasUnreadThreads = supportUnreadMerchantIds.size > 0;
  const supportUnreadThreadCount = supportUnreadMerchantIds.size;
  const selectedSupportMerchantMeta =
    [
      selectedSupportMerchantId !== "-" ? `ID ${selectedSupportMerchantId}` : "",
      selectedSupportMerchantRow?.loginAccount ? `账号 ${selectedSupportMerchantRow.loginAccount}` : "",
      selectedSupportMerchantEmail !== "-" ? selectedSupportMerchantEmail : "",
    ]
      .filter(Boolean)
      .join(" · ") || "商户留言与回复";
  const selectedSupportMerchantHeaderIndustry =
    selectedSupportMerchantIndustry !== "-" ? selectedSupportMerchantIndustry : "未设置行业";
  const selectedSupportMerchantWebsiteHref = useMemo(() => {
    const publicBaseDomain = normalizeSupportDisplayValue(process.env.NEXT_PUBLIC_PORTAL_BASE_DOMAIN);
    const explicitDomain =
      normalizeSupportDisplayValue(selectedSupportProfile?.domain) ||
      normalizeSupportDisplayValue(selectedSupportMerchantRow?.site.domain);
    if (selectedSupportMerchantId !== "-" && selectedSupportMerchantPrefix) {
      const runtimeHref = normalizeSupportExternalUrl(
        buildMerchantFrontendHref(selectedSupportMerchantId, selectedSupportMerchantPrefix),
      );
      if (runtimeHref && !isSupportIpOrLocalHost(runtimeHref)) {
        return runtimeHref;
      }
      if (publicBaseDomain) {
        const publicHref = normalizeSupportExternalUrl(
          buildMerchantFrontendHref(selectedSupportMerchantId, selectedSupportMerchantPrefix, publicBaseDomain),
          `https://${publicBaseDomain.replace(/^https?:\/\//i, "")}`,
        );
        if (publicHref) {
          return publicHref;
        }
      }
    }
    if (explicitDomain && !isSupportIpOrLocalHost(normalizeSupportExternalUrl(explicitDomain))) {
      return normalizeSupportExternalUrl(
        explicitDomain,
        publicBaseDomain ? `https://${publicBaseDomain.replace(/^https?:\/\//i, "")}` : undefined,
      );
    }
    if (selectedSupportMerchantId === "-") return "";
    return normalizeSupportExternalUrl(explicitDomain);
  }, [
    selectedSupportMerchantId,
    selectedSupportMerchantPrefix,
    selectedSupportMerchantRow?.site.domain,
    selectedSupportProfile?.domain,
  ]);
  const selectedSupportMerchantWebsiteLabel =
    selectedSupportMerchantWebsiteHref ? formatSupportUrlLabel(selectedSupportMerchantWebsiteHref) : "-";
  const selectedSupportMerchantCardHref = useMemo(
    () => buildSupportMerchantCardLink(selectedSupportResolvedBusinessCard),
    [selectedSupportResolvedBusinessCard],
  );
  const selectedSupportMerchantCardLabel =
    selectedSupportMerchantCardHref ? formatSupportUrlLabel(selectedSupportMerchantCardHref) : "-";
  const selectedSupportMerchantInfoItems = useMemo(
    () => [
      { label: "ID", value: selectedSupportMerchantId },
      { label: "电话", value: selectedSupportMerchantPhone },
      { label: "邮箱", value: selectedSupportMerchantEmail },
      {
        label: "联系卡",
        value: selectedSupportMerchantCardLabel,
        href: selectedSupportMerchantCardHref,
        openInNewTab: false,
      },
      { label: "城市", value: selectedSupportMerchantCity },
      {
        label: "官网",
        value: selectedSupportMerchantWebsiteLabel,
        href: selectedSupportMerchantWebsiteHref,
        openInNewTab: true,
      },
    ],
    [
      selectedSupportMerchantCardHref,
      selectedSupportMerchantCardLabel,
      selectedSupportMerchantCity,
      selectedSupportMerchantEmail,
      selectedSupportMerchantId,
      selectedSupportMerchantPhone,
      selectedSupportMerchantWebsiteHref,
      selectedSupportMerchantWebsiteLabel,
    ],
  );
  const mobileSupportListSummary = supportThreadsLoading
    ? "正在同步商户留言..."
    : supportUnreadThreadCount > 0
      ? `${supportUnreadThreadCount} 个会话待处理`
      : `全部 ${supportListRows.length} 个会话已处理`;
  const selectedMerchantDisplaySite = selectedMerchantRow?.site ?? null;
  const selectedMerchantSite =
    selectedMerchantRow?.hasLocalSite
      ? state.sites.find((site) => site.id === selectedMerchantRow.site.id) ?? selectedMerchantRow.site
      : null;
  const ensureSelectedMerchantConfigSite = () => {
    if (selectedMerchantSite) return selectedMerchantSite;
    if (!selectedMerchantRow?.hasSite) return null;
    return ensureLocalMerchantSiteFromRow(selectedMerchantRow);
  };
  const selectedMerchantConfigHistory = selectedMerchantSite?.configHistory ?? [];
  const merchantConfigHistoryContent = (
    <div className="space-y-3 text-xs">
      <div className="rounded border bg-slate-50 px-3 py-2 text-slate-600">
        配置对象：{selectedMerchantRow?.loginAccount || "-"}
      </div>
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
  );
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
  useEffect(() => {
    setSupportSelectedMerchantId((current) =>
      supportListRows.some((item) => item.selectionKey === current) ? current : supportListRows[0]?.selectionKey ?? "",
    );
  }, [supportListRows]);
  useEffect(() => {
    if (!isMobileSupportOnlyMode) {
      setSupportMobileView("list");
      return;
    }
    if (activeMenu !== "support_messages") {
      setActiveMenu("support_messages");
    }
  }, [activeMenu, isMobileSupportOnlyMode]);
  useEffect(() => {
    if (!isMobileSupportOnlyMode || supportMobileView !== "thread") return;
    if (!selectedSupportMerchantRow) {
      setSupportMobileView("list");
    }
  }, [isMobileSupportOnlyMode, selectedSupportMerchantRow, supportMobileView]);
  useEffect(() => {
    if (activeMenu !== "support_messages" || !isMobileSupportOnlyMode || supportMobileView !== "thread" || !selectedSupportThread) {
      setSupportMerchantInfoSheetOpen(false);
    }
  }, [activeMenu, isMobileSupportOnlyMode, selectedSupportThread, supportMobileView]);
  useEffect(() => {
    if (!hydrated || typeof window === "undefined") return;
    const nextLastReadMap = supportThreads.reduce<Record<string, string>>((accumulator, thread) => {
      const merchantId = thread.merchantId.trim();
      if (!merchantId) return accumulator;
      const stored = normalizeSupportMessageTimestamp(
        window.localStorage.getItem(buildSuperAdminSupportLastReadStorageKey(merchantId)),
      );
      if (stored) {
        accumulator[merchantId] = stored;
      }
      return accumulator;
    }, {});
    setSupportLastReadMap((current) => {
      const currentKeys = Object.keys(current);
      const nextKeys = Object.keys(nextLastReadMap);
      if (
        currentKeys.length === nextKeys.length &&
        nextKeys.every((merchantId) => current[merchantId] === nextLastReadMap[merchantId])
      ) {
        return current;
      }
      return nextLastReadMap;
    });
  }, [hydrated, supportThreads]);
  useEffect(() => {
    setSupportReplyDraft("");
  }, [supportSelectedMerchantId]);
  useEffect(() => {
    if (!hydrated || !authed) {
      supportLastIncomingMerchantMessageKeyRef.current = "";
      return;
    }
    if (!latestIncomingMerchantMessageKey) return;
    const previousKey = supportLastIncomingMerchantMessageKeyRef.current;
    supportLastIncomingMerchantMessageKeyRef.current = latestIncomingMerchantMessageKey;
    if (!previousKey || previousKey === latestIncomingMerchantMessageKey) return;
    void playNotificationSound();
  }, [authed, hydrated, latestIncomingMerchantMessageKey, playNotificationSound]);
  useEffect(() => {
    if (!hydrated || !authed || activeMenu !== "support_messages" || typeof window === "undefined") return;
    const merchantId = selectedSupportThread?.merchantId?.trim();
    if (!merchantId || !selectedSupportLatestMerchantMessageAt) return;
    window.localStorage.setItem(
      buildSuperAdminSupportLastReadStorageKey(merchantId),
      selectedSupportLatestMerchantMessageAt,
    );
    setSupportLastReadMap((current) =>
      current[merchantId] === selectedSupportLatestMerchantMessageAt
        ? current
        : {
            ...current,
            [merchantId]: selectedSupportLatestMerchantMessageAt,
          },
    );
  }, [activeMenu, authed, hydrated, selectedSupportLatestMerchantMessageAt, selectedSupportThread]);
  useEffect(() => {
    if (activeMenu !== "support_messages") {
      supportLastMessageKeyRef.current = "";
      setSupportBusinessCardDialogOpen(false);
    }
  }, [activeMenu]);
  useEffect(() => {
    if (!hydrated || !authed || activeMenu !== "support_messages") return;
    if (!selectedSupportThread) return;
    if (!selectedSupportLatestMessageKey) {
      supportLastMessageKeyRef.current = "";
      return;
    }
    const viewport = supportMessagesViewportRef.current;
    if (!viewport) return;
    if (supportLastMessageKeyRef.current === selectedSupportLatestMessageKey) return;
    const previousKey = supportLastMessageKeyRef.current;
    const behavior: ScrollBehavior =
      previousKey && previousKey.startsWith(`${selectedSupportThread.merchantId}:`) ? "smooth" : "auto";
    supportLastMessageKeyRef.current = selectedSupportLatestMessageKey;
    const timer = window.setTimeout(() => {
      viewport.scrollTo({ top: viewport.scrollHeight, behavior });
    }, 0);
    return () => {
      window.clearTimeout(timer);
    };
  }, [activeMenu, authed, hydrated, selectedSupportLatestMessageKey, selectedSupportThread]);
  useEffect(() => {
    if (!hydrated || !authed || activeMenu !== "support_messages" || supportSending) return;
    if (!selectedSupportThreadMerchantId) return;
    focusSupportReplyInput();
  }, [
    activeMenu,
    authed,
    focusSupportReplyInput,
    hydrated,
    selectedSupportThreadMerchantId,
    supportSending,
  ]);
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
  const previewMerchantCardImageOpacity = normalizeUnitInterval(configMerchantCardImageOpacity, 1);
  const previewMerchantCardTextBoxClass =
    merchantListPreviewProps.merchantCardTextBoxVisible === true
      ? "inline-flex w-fit max-w-full rounded border border-slate-300 bg-white/90 px-1.5 py-0.5"
      : "inline-flex w-fit max-w-full";
  const merchantActiveCount = filteredMerchantRows.filter((item) => item.statusKey === "active" || item.statusKey === "linked").length;
  const merchantPausedCount = filteredMerchantRows.filter((item) => item.statusKey === "paused").length;
  const merchantUnlinkedCount = filteredMerchantRows.filter((item) => item.statusKey === "unlinked").length;
  const supportMerchantListCount = supportListRows.length;
  const supportMerchantTotalCount = supportBaseRows.length;
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
    setConfigBusinessCardLimit(`${permission.businessCardLimit}`);
    setConfigAllowBusinessCardLinkMode(permission.allowBusinessCardLinkMode);
    setConfigBusinessCardBackgroundImageLimitKb(`${permission.businessCardBackgroundImageLimitKb}`);
    setConfigBusinessCardContactImageLimitKb(`${permission.businessCardContactImageLimitKb}`);
    setConfigBusinessCardExportImageLimitKb(`${permission.businessCardExportImageLimitKb}`);
    setConfigCommonBlockImageLimitKb(`${permission.commonBlockImageLimitKb}`);
    setConfigGalleryBlockImageLimitKb(`${permission.galleryBlockImageLimitKb}`);
    setConfigPublishLimitMb(`${permission.publishSizeLimitMb}`);
    setConfigAllowInsertBackground(permission.allowInsertBackground);
    setConfigAllowThemeEffects(permission.allowThemeEffects);
    setConfigAllowButtonBlock(permission.allowButtonBlock);
    setConfigAllowGalleryBlock(permission.allowGalleryBlock);
    setConfigAllowMusicBlock(permission.allowMusicBlock);
    setConfigAllowProductBlock(permission.allowProductBlock);
    setConfigAllowBookingBlock(permission.allowBookingBlock);
    setConfigMerchantCardImage((site.merchantCardImageUrl ?? "").trim());
    setConfigMerchantCardImageOpacity(normalizeUnitInterval(site.merchantCardImageOpacity, 1));
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

  function openMerchantDetailPanelForRow(row: MerchantUserRow | null | undefined) {
    if (!row) return;
    const resolvedSite = row.hasSite ? ensureLocalMerchantSiteFromRow(row) ?? row.site : row.site;
    const resolvedSiteId = String(resolvedSite?.id ?? row.site.id ?? "").trim();
    if (!resolvedSiteId) {
      setTip("商户详情初始化失败，请稍后重试");
      return;
    }
    openMerchantDetailPanel(resolvedSiteId);
  }

  const requestSuperAdminWithSessionRecovery = useCallback(async (url: string, init: RequestInit) => {
    const sendRequest = () =>
      fetch(url, {
        credentials: "same-origin",
        ...init,
      });

    syncSuperAdminAuthenticatedCookie();
    let response = await sendRequest();
    if (response.status !== 401 && response.status !== 403) {
      return response;
    }

    const recovered = syncSuperAdminAuthenticatedCookie();
    if (!recovered) {
      return response;
    }
    response = await sendRequest();
    return response;
  }, []);

  const requestSupportThreadsWithSessionRecovery = useCallback(
    (init: RequestInit) => requestSuperAdminWithSessionRecovery("/api/super-admin/support-messages", init),
    [requestSuperAdminWithSessionRecovery],
  );
  useEffect(() => {
    if (!authed || !hydrated || activeMenu !== "support_messages") return;
    const merchantId = selectedSupportMerchantId.trim();
    if (!/^\d{8}$/.test(merchantId)) return;
    if (Object.prototype.hasOwnProperty.call(supportMerchantProfilesByMerchantId, merchantId)) return;
    const localProfile = localSupportSnapshotByMerchantId.get(merchantId) ?? null;
    const shouldWarmSupportMerchantProfile =
      supportMerchantInfoSheetOpen || (isMobileSupportOnlyMode && supportMobileView === "thread" && !!selectedSupportThread);
    if (!shouldWarmSupportMerchantProfile) return;
    if (!supportMerchantInfoSheetOpen && hasSupportMerchantProfileCoverage(localProfile)) return;
    if (supportMerchantProfileLoadingIdsRef.current.has(merchantId)) return;
    let cancelled = false;
    supportMerchantProfileLoadingIdsRef.current.add(merchantId);
    void (async () => {
      try {
        const response = await requestSuperAdminWithSessionRecovery(
          `/api/merchant-chat-business-card?merchantId=${encodeURIComponent(merchantId)}`,
          {
            method: "GET",
            cache: "no-store",
          },
        );
        const payload = (await response.json().catch(() => null)) as
          | {
              profile?: MerchantListPublishedSite | null;
            }
          | null;
        if (cancelled || !response.ok) return;
        setSupportMerchantProfilesByMerchantId((current) => ({
          ...current,
          [merchantId]: payload?.profile ?? null,
        }));
      } catch {
        if (cancelled) return;
      } finally {
        supportMerchantProfileLoadingIdsRef.current.delete(merchantId);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    activeMenu,
    authed,
    hydrated,
    localSupportSnapshotByMerchantId,
    requestSuperAdminWithSessionRecovery,
    selectedSupportMerchantId,
    selectedSupportThread,
    isMobileSupportOnlyMode,
    supportMobileView,
    supportMerchantInfoSheetOpen,
    supportMerchantProfilesByMerchantId,
  ]);

  async function loadSupportThreadsAction(options?: { silent?: boolean; suppressError?: boolean }) {
    if (supportThreadsLoadTaskRef.current) {
      return supportThreadsLoadTaskRef.current;
    }

    const silent = options?.silent === true;
    const suppressError = options?.suppressError === true;
    const task = (async () => {
      const requestId = ++supportThreadsRequestIdRef.current;
      if (!silent) {
        setSupportThreadsLoading(true);
      }
      if (!suppressError) {
        setSupportThreadsError("");
      }
      try {
        const response = await requestSupportThreadsWithSessionRecovery({
          method: "GET",
          cache: "no-store",
        });
        const payload = (await response.json().catch(() => null)) as
          | {
              threads?: PlatformSupportThread[];
              error?: string;
            }
          | null;
        if (requestId !== supportThreadsRequestIdRef.current) return;
        if (!response.ok) {
          if (!suppressError) {
            setSupportThreadsError(payload?.error === "unauthorized" ? "超级后台登录已失效，请重新登录" : "信息处理加载失败，请稍后重试");
          }
          return;
        }
        setSupportThreadsError("");
        applySupportThreadsState(Array.isArray(payload?.threads) ? payload.threads : []);
      } catch {
        if (requestId !== supportThreadsRequestIdRef.current) return;
        if (!suppressError) {
          setSupportThreadsError("信息处理加载失败，请稍后重试");
        }
      } finally {
        if (!silent && requestId === supportThreadsRequestIdRef.current) {
          setSupportThreadsLoading(false);
        }
      }
    })();
    supportThreadsLoadTaskRef.current = task;
    try {
      await task;
    } finally {
      if (supportThreadsLoadTaskRef.current === task) {
        supportThreadsLoadTaskRef.current = null;
      }
    }
  }
  loadSupportThreadsActionRef.current = loadSupportThreadsAction;

  async function sendSupportReplyAction() {
    if (!selectedSupportThread || supportSending) return;
    const text = supportReplyDraft.trim();
    if (!text) {
      setTip("请先填写回复内容");
      return;
    }
    setSupportSending(true);
    setSupportThreadsError("");
    try {
      const response = await requestSupportThreadsWithSessionRecovery({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          merchantId: selectedSupportThread.merchantId,
          siteId: selectedSupportThread.siteId,
          merchantName: selectedSupportMerchantRow?.merchantName || selectedSupportThread.merchantName,
          merchantEmail: selectedSupportMerchantRow?.userEmail || selectedSupportThread.merchantEmail,
          text,
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | {
            threads?: PlatformSupportThread[];
            error?: string;
            message?: string;
          }
        | null;
      if (!response.ok) {
        setSupportThreadsError(payload?.message || "回复发送失败，请稍后重试");
        return;
      }
      applySupportThreadsState(Array.isArray(payload?.threads) ? payload.threads : []);
      setSupportReplyDraft("");
      setTip("回复已发送");
    } catch {
      setSupportThreadsError("回复发送失败，请稍后重试");
    } finally {
      setSupportSending(false);
    }
  }

  function ensureLocalMerchantSiteFromRow(row: MerchantUserRow) {
    const localExisting = stateRef.current.sites.find((site) => site.id === row.site.id) ?? null;
    if (localExisting) return localExisting;
    if (!row.hasSite) return null;
    const merchantId = normalizeMerchantIdValue(row.merchantId);
    if (!merchantId) {
      setTip("缺少商户 ID，无法初始化本地配置");
      return null;
    }

    const existedByMerchantId = stateRef.current.sites.find((site) => site.id === merchantId) ?? null;
    if (existedByMerchantId) return existedByMerchantId;

    const mainSite = stateRef.current.sites.find((site) => site.id === "site-main") ?? stateRef.current.sites[0] ?? null;
    const prefix = normalizePublishedSitePrefix(row.prefix !== "-" ? row.prefix : row.backendAccount?.siteSlug);
    const timestamp = nextIsoNow();
    const nextSite: Site = {
      id: merchantId,
      tenantId: mainSite?.tenantId ?? stateRef.current.tenants[0]?.id ?? "tenant-demo",
      merchantName: (row.site.merchantName ?? "").trim() || row.merchantName || "",
      domainPrefix: prefix,
      domainSuffix: prefix,
      contactAddress: (row.site.contactAddress ?? "").trim(),
      contactName: (row.site.contactName ?? "").trim(),
      contactPhone: (row.site.contactPhone ?? "").trim(),
      contactEmail: (row.site.contactEmail ?? "").trim() || row.userEmail || "",
      name: (row.site.name ?? "").trim() || row.merchantName || `商户 ${merchantId}`,
      domain: (row.site.domain ?? "").trim() || buildMerchantFrontendHref(merchantId, prefix),
      categoryId: mainSite?.categoryId ?? "",
      category: mainSite?.category ?? "商户",
      industry: row.site.industry,
      status: row.statusKey === "paused" ? "maintenance" : "online",
      publishedVersion: row.hasSite ? 1 : 0,
      lastPublishedAt: null,
      features: row.site.features ?? mainSite?.features ?? createFeaturePackage("basic"),
      location: row.site.location,
      serviceExpiresAt: row.site.serviceExpiresAt ?? row.expireAt,
      permissionConfig: row.site.permissionConfig ?? createDefaultMerchantPermissionConfig(),
      merchantCardImageUrl: (row.site.merchantCardImageUrl ?? "").trim(),
      merchantCardImageOpacity: normalizeUnitInterval(row.site.merchantCardImageOpacity, 1),
      sortConfig: row.site.sortConfig ?? createDefaultMerchantSortConfig(),
      configHistory: row.site.configHistory ?? [],
      createdAt: row.site.createdAt ?? timestamp,
      updatedAt: timestamp,
    };

    const persisted = commit((prev) =>
      withAudit(
        {
          ...prev,
          sites: [...prev.sites, nextSite],
        },
        "merchant_local_site_init",
        "site",
        merchantId,
        row.loginAccount || merchantId,
      ),
    );
    if (!persisted) {
      setTip("本地站点配置初始化失败，请重试");
      return null;
    }
    return nextSite;
  }

  function ensureOperableMerchantSiteFromRow(row: MerchantUserRow) {
    if (!row.hasSite) return null;
    return ensureLocalMerchantSiteFromRow(row) ?? row.site;
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
        const draftSync = await saveMerchantDraftViaApi(siteId, blocks, publishedAt);
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
        if (!draftSync.ok) {
          setTip(`方案模板已写入草稿，但商户后台同步失败：${draftSync.message}`);
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

  async function deleteTrustedDeviceAction(device: SuperAdminTrustedDeviceRecord) {
    if (!guard("user.manage", "无用户管理权限")) return;

    setTrustedDeviceDeletingId(device.deviceId);
    setTrustedDevicesError("");
    try {
      const response = await fetch("/api/super-admin/trusted-devices", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ deviceId: device.deviceId }),
      });
      const payload = (await response.json().catch(() => null)) as { message?: string } | null;
      if (!response.ok) {
        setTrustedDevicesError(payload?.message || "白名单设备移除失败，请稍后重试");
        return;
      }
      setTrustedDevices((prev) => prev.filter((item) => item.deviceId !== device.deviceId));
      setTip(`已移出白名单设备：${device.deviceLabel}`);
    } catch (error) {
      setTrustedDevicesError(error instanceof Error ? error.message : "白名单设备移除失败，请稍后重试");
    } finally {
      setTrustedDeviceDeletingId("");
    }
  }

  async function saveTrustedDeviceLimitAction() {
    if (!guard("user.manage", "无用户管理权限")) return;

    const nextLimit = Number.parseInt(trustedDeviceLimitInput.trim(), 10);
    if (!Number.isFinite(nextLimit) || nextLimit < 1 || nextLimit > 20) {
      setTrustedDevicesError("白名单上限只能设置为 1 到 20 台。");
      return;
    }

    setTrustedDeviceLimitSaving(true);
    setTrustedDevicesError("");
    try {
      const response = await fetch("/api/super-admin/trusted-devices", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ maxDevices: nextLimit }),
      });
      const payload = (await response.json().catch(() => null)) as { maxDevices?: number; message?: string } | null;
      if (!response.ok) {
        setTrustedDevicesError(payload?.message || "白名单设备上限保存失败，请稍后重试");
        return;
      }
      const savedLimit = typeof payload?.maxDevices === "number" ? payload.maxDevices : nextLimit;
      setTrustedDeviceLimit(savedLimit);
      setTrustedDeviceLimitInput(`${savedLimit}`);
      setTip(`白名单设备上限已更新为 ${savedLimit} 台`);
    } catch (error) {
      setTrustedDevicesError(error instanceof Error ? error.message : "白名单设备上限保存失败，请稍后重试");
    } finally {
      setTrustedDeviceLimitSaving(false);
    }
  }

  function toggleMerchantServiceAction(siteId: string) {
    if (!guard("user.manage", "无用户管理权限")) return;
    const target = state.sites.find((item) => item.id === siteId);
    if (!target) return;
    const serviceState = getMerchantServiceState(target.status, target.serviceExpiresAt, nowMs);
    if (serviceState.maintenance) {
      if (serviceState.expired) {
        setTip("商户已到期或未设置到期时间，请先在配置中设置有效到期时间");
        return;
      }
    }
    const status: SiteStatus = serviceState.maintenance ? "online" : "maintenance";
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
        setTip("商户框图片上传失败，请稍后重试");
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
    const businessCardLimit = Math.max(1, Math.min(100, Math.round(Number(configBusinessCardLimit) || 1)));
    const businessCardBackgroundImageLimitKb = Math.max(
      50,
      Math.min(5000, Math.round(Number(configBusinessCardBackgroundImageLimitKb) || 200)),
    );
    const businessCardContactImageLimitKb = Math.max(
      50,
      Math.min(5000, Math.round(Number(configBusinessCardContactImageLimitKb) || 200)),
    );
    const businessCardExportImageLimitKb = Math.max(
      50,
      Math.min(5000, Math.round(Number(configBusinessCardExportImageLimitKb) || 400)),
    );
    const commonBlockImageLimitKb = Math.max(
      50,
      Math.min(5000, Math.round(Number(configCommonBlockImageLimitKb) || 300)),
    );
    const galleryBlockImageLimitKb = Math.max(
      50,
      Math.min(5000, Math.round(Number(configGalleryBlockImageLimitKb) || 300)),
    );
    const publishSizeLimitMb = Math.max(1, Math.min(100, Math.round(Number(configPublishLimitMb) || 1)));
    const serviceExpiresAt = parseDateInputToIso(configExpireDate);
    if (configExpireDate.trim() && !serviceExpiresAt) {
      setTip(SUPER_ADMIN_MESSAGES.expireDateInvalid);
      return;
    }
    const expired = getMerchantServiceState(selectedMerchantSite.status, serviceExpiresAt, nowMs).expired;
    const nextStatus: SiteStatus = expired ? "maintenance" : selectedMerchantSite.status;
    const sortConfig = {
      recommendedCountryRank: parseRankInput(configRecommendedCountryRank),
      recommendedProvinceRank: parseRankInput(configRecommendedProvinceRank),
      recommendedCityRank: parseRankInput(configRecommendedCityRank),
      industryCountryRank: parseRankInput(configIndustryCountryRank),
      industryProvinceRank: parseRankInput(configIndustryProvinceRank),
      industryCityRank: parseRankInput(configIndustryCityRank),
    };
    const merchantCardImageOpacity = normalizeUnitInterval(configMerchantCardImageOpacity, 1);
    let nextMerchantCardImage = configMerchantCardImage.trim();
    if (/^data:image\//i.test(nextMerchantCardImage)) {
      const uploadedUrl = await uploadMerchantCardImageDataUrlToSupabase(nextMerchantCardImage, selectedMerchantSite.id);
      if (!uploadedUrl) {
        setTip("商户框图片上传失败，请重新上传后再保存");
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
    if (prevPermission.businessCardLimit !== businessCardLimit) {
      pendingChanges.push(`名片夹数量上限：${prevPermission.businessCardLimit} -> ${businessCardLimit}`);
    }
    if (prevPermission.allowBusinessCardLinkMode !== configAllowBusinessCardLinkMode) {
      pendingChanges.push(
        `链接模式名片：${formatBool(prevPermission.allowBusinessCardLinkMode)} -> ${formatBool(configAllowBusinessCardLinkMode)}`,
      );
    }
    if (prevPermission.businessCardBackgroundImageLimitKb !== businessCardBackgroundImageLimitKb) {
      pendingChanges.push(
        `名片背景图上限：${prevPermission.businessCardBackgroundImageLimitKb}KB -> ${businessCardBackgroundImageLimitKb}KB`,
      );
    }
    if (prevPermission.businessCardContactImageLimitKb !== businessCardContactImageLimitKb) {
      pendingChanges.push(
        `联系卡展示图上限：${prevPermission.businessCardContactImageLimitKb}KB -> ${businessCardContactImageLimitKb}KB`,
      );
    }
    if (prevPermission.businessCardExportImageLimitKb !== businessCardExportImageLimitKb) {
      pendingChanges.push(
        `导出名片图片上限：${prevPermission.businessCardExportImageLimitKb}KB -> ${businessCardExportImageLimitKb}KB`,
      );
    }
    if (prevPermission.commonBlockImageLimitKb !== commonBlockImageLimitKb) {
      pendingChanges.push(`通用区块图片上限：${prevPermission.commonBlockImageLimitKb}KB -> ${commonBlockImageLimitKb}KB`);
    }
    if (prevPermission.galleryBlockImageLimitKb !== galleryBlockImageLimitKb) {
      pendingChanges.push(`相册区块图片上限：${prevPermission.galleryBlockImageLimitKb}KB -> ${galleryBlockImageLimitKb}KB`);
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
    if (normalizeUnitInterval(selectedMerchantSite.merchantCardImageOpacity, 1) !== merchantCardImageOpacity) {
      pendingChanges.push(
        `商户框图片透明度：${Math.round(normalizeUnitInterval(selectedMerchantSite.merchantCardImageOpacity, 1) * 100)}% -> ${Math.round(merchantCardImageOpacity * 100)}%`,
      );
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
        businessCardLimit,
        allowBusinessCardLinkMode: configAllowBusinessCardLinkMode,
        businessCardBackgroundImageLimitKb,
        businessCardContactImageLimitKb,
        businessCardExportImageLimitKb,
        commonBlockImageLimitKb,
        galleryBlockImageLimitKb,
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
      chatAvatarImageUrl: (selectedMerchantSite.chatAvatarImageUrl ?? "").trim(),
      contactVisibility: selectedMerchantSite.contactVisibility ?? createDefaultMerchantContactVisibility(),
      merchantCardImageOpacity,
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
            merchantCardImageOpacity: afterSnapshot.merchantCardImageOpacity,
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
      chatAvatarImageUrl: (selectedMerchantSite.chatAvatarImageUrl ?? "").trim(),
      contactVisibility: selectedMerchantSite.contactVisibility ?? createDefaultMerchantContactVisibility(),
      merchantCardImageOpacity: normalizeUnitInterval(rollbackTarget.merchantCardImageOpacity, 1),
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
    const rollbackExpired = getMerchantServiceState(
      selectedMerchantSite.status,
      rollbackAfterSnapshot.serviceExpiresAt,
      nowMs,
    ).expired;
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
            merchantCardImageOpacity: rollbackAfterSnapshot.merchantCardImageOpacity,
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

  const sidebarMenus: Array<{ key: "site_editor" | "user_manage" | "support_messages" | "merchant_id_rules" | "trusted_devices" | "stats" | "logs"; label: string; hint: string }> = [
    { key: "site_editor", label: "网站编辑", hint: "总站页面与站点配置" },
    { key: "user_manage", label: "用户管理", hint: "用户列表与权限服务" },
    { key: "support_messages", label: "信息处理", hint: "商户留言与回复" },
    { key: "merchant_id_rules", label: "禁用ID设置", hint: "注册跳号与规则管理" },
    { key: "trusted_devices", label: "白名单设备", hint: "超级后台登录设备管理" },
    { key: "stats", label: "数据统计", hint: "平台关键指标" },
    { key: "logs", label: "日志", hint: "审计与告警记录" },
  ];
  const showMobileSupportThread = isMobileSupportOnlyMode && supportMobileView === "thread" && !!selectedSupportThread;
  function logoutSuperAdmin() {
    clearSuperAdminAuthenticated();
    window.location.href = `${buildSuperAdminLoginHref("/super-admin")}&loggedOut=1`;
  }

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
    <main
      className={
        isMobileSupportOnlyMode
          ? "fixed inset-0 z-[120] h-[100dvh] overflow-hidden bg-slate-100 overscroll-none"
          : "min-h-screen bg-slate-100"
      }
    >
      <div className={isMobileSupportOnlyMode ? "flex h-full min-h-0 flex-col overflow-hidden" : "flex min-h-screen"}>
        {!isMobileSupportOnlyMode ? (
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
                <div className="flex items-center gap-2 font-medium">
                  <span>{menu.label}</span>
                  {menu.key === "support_messages" && supportHasUnreadThreads ? (
                    <span aria-label="有未读消息" className="inline-flex h-2.5 w-2.5 rounded-full bg-rose-500" />
                  ) : null}
                </div>
                <div className="text-xs text-slate-500">{menu.hint}</div>
              </button>
            ))}
          </nav>
        </aside>
        ) : null}

        <div className={isMobileSupportOnlyMode ? "flex min-h-0 flex-1 flex-col" : "flex-1 min-h-0"}>
          {!isMobileSupportOnlyMode ? (
          <header className="flex items-center justify-between border-b bg-white px-6 py-3">
            <div className="flex items-center gap-2 text-sm">
              <span className="text-slate-500">当前菜单</span>
              <span className="rounded border bg-slate-50 px-2 py-1 font-medium">{sidebarMenus.find((x) => x.key === activeMenu)?.label}</span>
            </div>
            <div className="flex items-center gap-3 text-sm">
              <span className="text-slate-600">欢迎您，{operatorName}</span>
              <button
                className="rounded border px-3 py-2"
                onClick={logoutSuperAdmin}
              >
                退出超级后台登录
              </button>
            </div>
          </header>
          ) : null}

          {tip ? (
            <div
              className={`pointer-events-none fixed left-4 right-4 z-[130] ${
                isMobileSupportOnlyMode
                  ? "top-[calc(env(safe-area-inset-top)+0.75rem)]"
                  : "top-20 md:left-72 md:right-auto md:w-[min(680px,calc(100vw-20rem))]"
              }`}
            >
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

          <div className={isMobileSupportOnlyMode ? "flex-1 min-h-0 overflow-hidden p-0" : "space-y-4 p-4"}>
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

            {activeMenu === "user_manage" || merchantPanelOpen ? (
              <>
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
                  <div className="mt-2 text-xs">
                    {backendMerchantAccountsLoading ? (
                      <span className="text-slate-500">正在同步后端用户数据…</span>
                    ) : backendMerchantAccountsError ? (
                      <span className="text-rose-600">后端用户数据加载失败：{describeBackendMerchantAccountsError(backendMerchantAccountsError)}</span>
                    ) : (
                      <span className="text-slate-500">账号使用后端邮箱；名称只取商户信息；体积和访问量只显示可从线上 `pages / page_events` 核实的值。</span>
                    )}
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
                                <td className="px-3 py-2 text-xs">{formatOptionalBytes(row.sizeBytes, row.sizeKnown)}</td>
                                <td className="px-3 py-2 text-xs">{formatOptionalCount(row.visits.day30, row.visitsKnown)}</td>
                                <td className="px-3 py-2 text-xs text-slate-500">{fmt(row.registerAt)}</td>
                                <td className="px-3 py-2 text-xs text-slate-500">{fmt(row.expireAt)}</td>
                                <td className="px-3 py-2">
                                  <span
                                    className={`rounded border px-2 py-0.5 text-xs ${badgeClass(
                                      row.statusKey === "paused"
                                        ? "maintenance"
                                        : row.statusKey === "unlinked"
                                          ? "offline"
                                          : "online",
                                    )}`}
                                  >
                                    {row.statusLabel}
                                  </span>
                                </td>
                                <td className="px-3 py-2 text-xs">
                                  <div className="flex flex-wrap gap-1">
                                    <button
                                      className="rounded border px-2 py-1"
                                      onClick={() => openMerchantDetailPanelForRow(row)}
                                    >
                                      详情
                                    </button>
                                    {row.hasSite ? (
                                      <>
                                        <Link
                                          href={buildMerchantFrontendHref(row.merchantId, row.site.domainPrefix ?? row.site.domainSuffix)}
                                          target="_blank"
                                          rel="noreferrer"
                                          className="rounded border px-2 py-1"
                                        >
                                          查看前台
                                        </Link>
                                        {row.hasLocalSite || !!normalizeMerchantIdValue(row.merchantId) ? (
                                          <>
                                            <button
                                              className="rounded border px-2 py-1"
                                              onClick={() => {
                                                const localSite = ensureOperableMerchantSiteFromRow(row);
                                                if (!localSite) return;
                                                toggleMerchantServiceAction(localSite.id);
                                              }}
                                            >
                                              {row.statusKey === "paused" ? "开启服务" : "暂停服务"}
                                            </button>
                                            <button
                                              className="rounded border bg-black px-2 py-1 text-white hover:bg-slate-800"
                                              onClick={() => {
                                                const localSite = ensureOperableMerchantSiteFromRow(row);
                                                if (!localSite) return;
                                                openMerchantConfigPanel(localSite);
                                              }}
                                            >
                                              配置
                                            </button>
                                          </>
                                        ) : null}
                                        <button
                                          className="rounded border px-2 py-1"
                                          onClick={() => {
                                            const targetSite = ensureOperableMerchantSiteFromRow(row) ?? row.site;
                                            openPlanTemplateDialogForSite(targetSite);
                                          }}
                                        >
                                          方案模板
                                        </button>
                                        <button
                                          className="rounded border px-2 py-1 disabled:opacity-50"
                                          onClick={() => {
                                            const targetSite = ensureOperableMerchantSiteFromRow(row) ?? row.site;
                                            void captureMerchantTemplate(targetSite);
                                          }}
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
                                          const { coverImageUrl, coverBackgroundStyle } =
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
                </div>
              </section>
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
                          className={`rounded border px-2 py-1 ${userPanelMode === "config" ? "bg-black text-white" : "bg-white"} ${selectedMerchantRow?.hasSite ? "" : "opacity-40"}`}
                          onClick={() => {
                            const localSite = ensureSelectedMerchantConfigSite();
                            if (!localSite) return;
                            hydrateMerchantConfigDraft(localSite);
                            setUserPanelMode("config");
                          }}
                          disabled={!selectedMerchantRow?.hasSite}
                        >
                          配置
                        </button>
                        <button
                          className={`rounded border px-2 py-1 ${userPanelMode === "history" ? "bg-black text-white" : "bg-white"} ${selectedMerchantRow?.hasSite ? "" : "opacity-40"}`}
                          onClick={() => {
                            const localSite = ensureSelectedMerchantConfigSite();
                            if (!localSite) return;
                            setUserPanelMode("history");
                          }}
                          disabled={!selectedMerchantRow?.hasSite}
                        >
                          配置历史
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
                            ) : !selectedMerchantRow.hasLocalSite ? (
                              <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-amber-800">
                                该商户资料已经同步到超级后台，但当前浏览器里还没有本地配置镜像；点击配置、配置历史、暂停/开启服务或方案模板时会自动补建本地配置。
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
                                <div className="truncate font-medium">{selectedMerchantDisplaySite?.domain || "-"}</div>
                              </div>
                              <div className="rounded border px-3 py-2">
                                <div className="text-slate-500">行业</div>
                                <div>{selectedMerchantRow.industry}</div>
                              </div>
                              <div className="rounded border px-3 py-2">
                                <div className="text-slate-500">国家 / 省 / 城市</div>
                                <div>
                                  {(selectedMerchantDisplaySite?.location.country || "-")} / {(selectedMerchantDisplaySite?.location.province || "-")} / {(selectedMerchantDisplaySite?.location.city || "-")}
                                </div>
                              </div>
                              <div className="rounded border px-3 py-2">
                                <div className="text-slate-500">地址</div>
                                <div>{selectedMerchantDisplaySite?.contactAddress || "-"}</div>
                              </div>
                              <div className="rounded border px-3 py-2">
                                <div className="text-slate-500">联系人</div>
                                <div>{selectedMerchantDisplaySite?.contactName || "-"}</div>
                              </div>
                              <div className="rounded border px-3 py-2">
                                <div className="text-slate-500">电话</div>
                                <div>{selectedMerchantDisplaySite?.contactPhone || "-"}</div>
                              </div>
                              <div className="rounded border px-3 py-2">
                                <div className="text-slate-500">邮箱</div>
                                <div>{selectedMerchantDisplaySite?.contactEmail || selectedMerchantRow.userEmail || "-"}</div>
                              </div>
                              <div className="rounded border px-3 py-2">
                                <div className="text-slate-500">体积</div>
                                <div>{formatOptionalBytes(selectedMerchantRow.sizeBytes, selectedMerchantRow.sizeKnown)}</div>
                              </div>
                              <div className="rounded border px-3 py-2">
                                <div className="text-slate-500">访问量</div>
                                <div>
                                  {selectedMerchantRow.visitsKnown
                                    ? `今日 ${selectedMerchantRow.visits.today} / 7日 ${selectedMerchantRow.visits.day7} / 30日 ${selectedMerchantRow.visits.day30} / 总 ${selectedMerchantRow.visits.total}`
                                    : "-"}
                                </div>
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
                        ) : !selectedMerchantSite ? (
                          <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                            {selectedMerchantRow.hasSite
                              ? "正在初始化该商户的本地配置，请稍后再试一次；如果这是新商户，系统会自动把超级后台资料补成本地可编辑站点。"
                              : "该账号尚未创建站点，当前没有可配置的站点参数。先为它建站后，才能配置前台、域名、服务状态和发布内容。"}
                          </div>
                        ) : userPanelMode === "history" ? (
                          merchantConfigHistoryContent
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
                            <div className="rounded-xl border border-slate-300 bg-slate-50 px-3 py-3">
                              <div className="mb-3 text-sm font-semibold text-slate-900">名片权限</div>
                              <div className="grid gap-3 md:grid-cols-2">
                                <label className="space-y-1">
                                  <div className="text-slate-500">名片夹数量上限</div>
                                  <input className="w-full rounded border bg-white px-2 py-1.5" value={configBusinessCardLimit} onChange={(e) => setConfigBusinessCardLimit(e.target.value)} />
                                </label>
                                <label className="flex items-center gap-2 rounded border bg-white px-3 py-2">
                                  <input
                                    type="checkbox"
                                    checked={configAllowBusinessCardLinkMode}
                                    onChange={(e) => setConfigAllowBusinessCardLinkMode(e.target.checked)}
                                  />
                                  链接模式名片
                                </label>
                                <label className="space-y-1">
                                  <div className="text-slate-500">名片背景图上限(KB)</div>
                                  <input
                                    className="w-full rounded border bg-white px-2 py-1.5"
                                    value={configBusinessCardBackgroundImageLimitKb}
                                    onChange={(e) => setConfigBusinessCardBackgroundImageLimitKb(e.target.value)}
                                  />
                                </label>
                                <label className="space-y-1">
                                  <div className="text-slate-500">联系卡展示图上限(KB)</div>
                                  <input
                                    className="w-full rounded border bg-white px-2 py-1.5"
                                    value={configBusinessCardContactImageLimitKb}
                                    onChange={(e) => setConfigBusinessCardContactImageLimitKb(e.target.value)}
                                  />
                                </label>
                                <label className="space-y-1">
                                  <div className="text-slate-500">导出名片图片上限(KB)</div>
                                  <input
                                    className="w-full rounded border bg-white px-2 py-1.5"
                                    value={configBusinessCardExportImageLimitKb}
                                    onChange={(e) => setConfigBusinessCardExportImageLimitKb(e.target.value)}
                                  />
                                </label>
                                <label className="space-y-1">
                                  <div className="text-slate-500">通用区块图片上限(KB)</div>
                                  <input
                                    className="w-full rounded border bg-white px-2 py-1.5"
                                    value={configCommonBlockImageLimitKb}
                                    onChange={(e) => setConfigCommonBlockImageLimitKb(e.target.value)}
                                  />
                                </label>
                                <label className="space-y-1">
                                  <div className="text-slate-500">相册区块图片上限(KB)</div>
                                  <input
                                    className="w-full rounded border bg-white px-2 py-1.5"
                                    value={configGalleryBlockImageLimitKb}
                                    onChange={(e) => setConfigGalleryBlockImageLimitKb(e.target.value)}
                                  />
                                </label>
                              </div>
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
                                    <label className="space-y-1 md:col-span-2">
                                      <div className="flex items-center justify-between text-slate-500">
                                        <span>图片透明度</span>
                                        <span>{Math.round(configMerchantCardImageOpacity * 100)}%</span>
                                      </div>
                                      <input
                                        className="w-full"
                                        type="range"
                                        min={0}
                                        max={100}
                                        step={1}
                                        value={Math.round(configMerchantCardImageOpacity * 100)}
                                        onChange={(e) => setConfigMerchantCardImageOpacity(Math.max(0, Math.min(1, Number(e.target.value) / 100)))}
                                      />
                                    </label>
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
                                      backgroundColor: "#f8fafc",
                                    }}
                                  >
                                    {configMerchantCardImage ? (
                                      <div
                                        className="absolute inset-0 bg-cover bg-center bg-no-repeat"
                                        style={{
                                          backgroundImage: `url(${configMerchantCardImage})`,
                                          opacity: previewMerchantCardImageOpacity,
                                        }}
                                      />
                                    ) : null}
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
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="text-sm text-slate-500">暂无用户</div>
                    )}
                    </div>
                        </div>
                      </div>
                    </>
                  ) : null}
              </>
            ) : null}

            {activeMenu === "support_messages" ? (
              isMobileSupportOnlyMode ? (
                <section className="relative flex h-full min-h-0 flex-col overflow-hidden bg-[linear-gradient(180deg,#f8fafc_0%,#eef2ff_48%,#f8fafc_100%)]">
                  {showMobileSupportThread ? (
                    <div
                      className="flex min-h-0 flex-1 flex-col overflow-hidden"
                      onTouchStart={handleSupportMobileThreadTouchStart}
                      onTouchEnd={handleSupportMobileThreadTouchEnd}
                      onTouchCancel={() => {
                        supportMobileSwipeStartRef.current = null;
                      }}
                    >
                      <div className="shrink-0 border-b border-slate-200/80 bg-white/90 px-3 pb-3 pt-[calc(env(safe-area-inset-top)+0.55rem)] shadow-[0_8px_30px_rgba(15,23,42,0.06)] backdrop-blur">
                        <div className="flex items-start gap-3">
                          <div className="flex min-w-0 items-center gap-3">
                            <button
                              type="button"
                              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-slate-900 hover:bg-slate-100"
                              onClick={closeMobileSupportThread}
                              aria-label="返回会话列表"
                            >
                              <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" aria-hidden="true">
                                <path
                                  d="M19 12H7M12 7l-5 5 5 5"
                                  stroke="currentColor"
                                  strokeWidth="2.2"
                                  strokeLinecap="square"
                                  strokeLinejoin="miter"
                                />
                              </svg>
                            </button>
                            <button
                              type="button"
                              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-slate-900 text-sm font-semibold text-white shadow-sm transition hover:scale-[1.02]"
                              onClick={() => setSupportMerchantInfoSheetOpen(true)}
                              aria-label="查看商户信息"
                            >
                              {getSupportAvatarLabel(selectedSupportDisplayLabel, "商")}
                            </button>
                            <div className="min-w-0">
                              <div className="truncate text-[15px] font-semibold text-slate-900">{selectedSupportDisplayLabel}</div>
                              <div className="mt-1 line-clamp-2 text-[11px] leading-5 text-slate-500">{selectedSupportMerchantMeta}</div>
                            </div>
                          </div>
                        </div>
                      </div>
                      {supportThreadsError ? (
                        <div className="border-b border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-600">{supportThreadsError}</div>
                      ) : null}
                      <div ref={supportMessagesViewportRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-4">
                        {selectedSupportThread && selectedSupportThread.messages.length > 0 ? (
                          <div className="space-y-3">
                            {selectedSupportThread.messages.map((message, index) => {
                              const previousMessage = index > 0 ? selectedSupportThread.messages[index - 1] : null;
                              const showDateDivider =
                                !previousMessage || !isSameSupportCalendarDay(previousMessage.createdAt, message.createdAt);
                              const isMerchantMessage = message.sender === "merchant";
                              return (
                                <div key={message.id} className="space-y-3">
                                  {showDateDivider ? (
                                    <div className="flex justify-center">
                                      <span className="rounded-full bg-white/90 px-3 py-1 text-[11px] text-slate-500 shadow-sm">
                                        {formatSupportThreadDateLabel(message.createdAt)}
                                      </span>
                                    </div>
                                  ) : null}
                                  <div className={`flex ${isMerchantMessage ? "justify-start" : "justify-end"}`}>
                                    <div
                                      className={`max-w-[84%] min-w-0 rounded-[24px] px-4 py-3 shadow-[0_10px_24px_rgba(15,23,42,0.08)] ${
                                        isMerchantMessage
                                          ? "border border-slate-200 bg-white text-slate-900"
                                          : "bg-slate-900 text-white"
                                      }`}
                                    >
                                      <div className="whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-[15px] leading-6">
                                        {message.text}
                                      </div>
                                      <div
                                        className={`mt-2 text-right text-[10px] ${
                                          isMerchantMessage ? "text-slate-400" : "text-white/70"
                                        }`}
                                      >
                                        {formatSupportClockTime(message.createdAt)}
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <div className="rounded-[28px] border border-dashed border-slate-300 bg-white/90 px-5 py-8 text-center shadow-sm">
                            <div className="text-sm font-medium text-slate-900">还没有留言记录</div>
                            <div className="mt-2 text-xs leading-6 text-slate-500">
                              你可以直接在下方发第一条消息，商户会在后台即时看到。
                            </div>
                          </div>
                        )}
                      </div>
                      <div className="border-t border-slate-200/80 bg-white/95 px-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-3 shadow-[0_-8px_30px_rgba(15,23,42,0.06)] backdrop-blur">
                        <div className="rounded-[28px] border border-slate-200 bg-white p-2 shadow-sm">
                          <textarea
                            ref={supportReplyInputRef}
                            className="h-24 w-full resize-none bg-transparent px-3 py-2 text-base outline-none transition placeholder:text-slate-400"
                            placeholder="输入回复内容，回车换行"
                            value={supportReplyDraft}
                            onChange={(event) => setSupportReplyDraft(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key !== "Enter" || !event.ctrlKey || event.nativeEvent.isComposing) return;
                              event.preventDefault();
                              void sendSupportReplyAction();
                            }}
                            disabled={supportSending}
                          />
                          <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-2 pb-1 pt-2">
                            <div className="text-[11px] leading-5 text-slate-500">消息会同步到商户后台的“联系我们”。</div>
                            <button
                              type="button"
                              className="shrink-0 rounded-full bg-slate-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                              onClick={() => void sendSupportReplyAction()}
                              disabled={supportSending || !supportReplyDraft.trim()}
                            >
                              {supportSending ? "发送中..." : "发送"}
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                      <div className="shrink-0 border-b border-slate-200/80 bg-white/90 px-4 pb-4 pt-[calc(env(safe-area-inset-top)+0.75rem)] shadow-[0_8px_30px_rgba(15,23,42,0.06)] backdrop-blur">
                        <div className="flex items-center gap-3">
                          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-slate-900 text-sm font-semibold text-white shadow-sm">
                            会话
                          </div>
                          <button
                            type="button"
                            className="shrink-0 rounded-full border border-slate-200 bg-white px-3 py-2 text-sm hover:bg-slate-50"
                            onClick={() => void loadSupportThreadsAction()}
                            disabled={supportThreadsLoading}
                          >
                            {supportThreadsLoading ? "刷新中" : "刷新"}
                          </button>
                          <div className="min-w-0 flex-1">
                            <div className="text-[15px] font-semibold text-slate-900">聊天列表</div>
                            <div className="mt-1 text-xs text-slate-500">{mobileSupportListSummary}</div>
                          </div>
                        </div>
                        <label className="mt-4 block">
                          <div className="flex items-center gap-3 rounded-[24px] border border-slate-200 bg-white px-4 py-3 shadow-sm">
                            <span className="shrink-0 text-sm text-slate-400">搜索</span>
                            <input
                              type="text"
                              className="min-w-0 flex-1 bg-transparent text-base text-slate-900 outline-none placeholder:text-slate-400"
                              placeholder="邮箱 / ID / 账号 / 名称"
                              value={supportMerchantKeyword}
                              onChange={(event) => setSupportMerchantKeyword(event.target.value)}
                            />
                          </div>
                        </label>
                        {supportThreadsError ? <div className="mt-3 text-sm text-rose-600">{supportThreadsError}</div> : null}
                        {backendMerchantAccountsError ? (
                          <div className="mt-3 text-sm text-amber-600">
                            商户列表加载失败，当前先展示已有会话。{describeBackendMerchantAccountsError(backendMerchantAccountsError)}
                          </div>
                        ) : null}
                      </div>
                      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-3">
                        {supportListRows.length > 0 ? (
                          <div className="space-y-2.5">
                            {supportListRows.map(({ row, selectionKey, thread, lastMessage }) => {
                              const displayLabel = row.merchantName || thread?.merchantName || row.merchantId || thread?.merchantId || selectionKey;
                              const subtitle = [
                                row.backendAccount?.loginId || row.backendAccount?.username || "",
                                row.userEmail || row.loginAccount || thread?.merchantEmail || "",
                              ]
                                .filter(Boolean)
                                .join(" | ") || "-";
                              const hasUnread = Boolean(thread && supportUnreadMerchantIds.has(thread.merchantId));
                              const active = selectedSupportListRow?.selectionKey === selectionKey;
                              return (
                                <button
                                  key={selectionKey}
                                  type="button"
                                  className={`w-full rounded-[26px] border px-3 py-3.5 text-left shadow-[0_10px_24px_rgba(15,23,42,0.06)] transition ${
                                    active
                                      ? "border-slate-900 bg-white"
                                      : "border-slate-200 bg-white/90 hover:bg-white"
                                  }`}
                                  onClick={() => {
                                    setSupportSelectedMerchantId(selectionKey);
                                    setSupportMobileView("thread");
                                  }}
                                >
                                  <div className="flex items-start gap-3">
                                    <div
                                      className={`mt-0.5 flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-sm font-semibold ${
                                        hasUnread ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700"
                                      }`}
                                    >
                                      {getSupportAvatarLabel(displayLabel || row.merchantId || selectionKey, "商")}
                                    </div>
                                    <div className="min-w-0 flex-1">
                                      <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                          <div className="flex items-center gap-2">
                                            <div className="truncate text-sm font-semibold text-slate-900">{displayLabel}</div>
                                            {hasUnread ? (
                                              <span className="rounded-full bg-rose-500 px-2 py-0.5 text-[10px] font-medium text-white">
                                                新消息
                                              </span>
                                            ) : null}
                                          </div>
                                          <div className="mt-1 truncate text-[11px] text-slate-500">{subtitle}</div>
                                        </div>
                                        <div className="shrink-0 text-[11px] text-slate-400">
                                          {thread ? formatSupportConversationTime(thread.updatedAt) : "未开始"}
                                        </div>
                                      </div>
                                      <div className="mt-2 line-clamp-2 text-[13px] leading-5 text-slate-600">
                                        {lastMessage?.text || "暂无留言记录，点进来可以直接开始回复。"}
                                      </div>
                                    </div>
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        ) : backendMerchantAccountsLoading ? (
                          <div className="rounded-[28px] border border-dashed border-slate-300 bg-white/90 px-4 py-8 text-center text-sm text-slate-500 shadow-sm">
                            正在加载商户列表…
                          </div>
                        ) : supportMerchantKeyword.trim() ? (
                          <div className="rounded-[28px] border border-dashed border-slate-300 bg-white/90 px-4 py-8 text-center text-sm text-slate-500 shadow-sm">
                            没有匹配的商户，请换个关键词试试。
                          </div>
                        ) : (
                          <div className="rounded-[28px] border border-dashed border-slate-300 bg-white/90 px-4 py-8 text-center text-sm text-slate-500 shadow-sm">
                            当前还没有已注册商户。
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </section>
              ) : (
              <section className="flex h-[calc(100svh-7rem)] min-h-0 flex-col gap-4 overflow-hidden">
                <div className="rounded-lg border bg-white p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1">
                      <div className="text-sm font-semibold text-slate-900">信息处理</div>
                      <div className="text-xs text-slate-500">商户留言会集中在这里处理，右侧可以直接回复并查看商户详情。</div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="rounded border bg-slate-50 px-3 py-2 text-sm">
                        商户数：
                        {supportMerchantKeyword.trim()
                          ? `${supportMerchantListCount}/${supportMerchantTotalCount}`
                          : supportMerchantTotalCount}
                      </div>
                      <button
                        type="button"
                        className="rounded border bg-white px-3 py-2 text-sm hover:bg-slate-50"
                        onClick={() => void loadSupportThreadsAction()}
                        disabled={supportThreadsLoading}
                      >
                        {supportThreadsLoading ? "刷新中..." : "刷新"}
                      </button>
                    </div>
                  </div>
                  {supportThreadsError ? <div className="mt-3 text-sm text-rose-600">{supportThreadsError}</div> : null}
                  {backendMerchantAccountsError ? (
                    <div className="mt-3 text-sm text-amber-600">
                      商户列表加载失败，当前先展示已有会话。{describeBackendMerchantAccountsError(backendMerchantAccountsError)}
                    </div>
                  ) : null}
                </div>

                <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
                  <div className="flex min-h-0 flex-col overflow-hidden rounded-lg border bg-white">
                    <div className="border-b px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="shrink-0 text-sm font-semibold text-slate-900">商户</div>
                        <input
                          type="text"
                          className="min-w-0 flex-1 rounded border px-3 py-2 text-sm outline-none transition focus:border-slate-400"
                          placeholder="搜索邮箱 / ID / 账号 / 名称"
                          value={supportMerchantKeyword}
                          onChange={(event) => setSupportMerchantKeyword(event.target.value)}
                        />
                      </div>
                    </div>
                    <div className="min-h-0 flex-1 overflow-y-auto p-3">
                      {supportListRows.length > 0 ? (
                        <div className="space-y-2">
                          {supportListRows.map(({ row, selectionKey, thread, lastMessage }) => {
                            const displayLabel = row.merchantName || thread?.merchantName || row.merchantId || thread?.merchantId || selectionKey;
                            const subtitle = [
                              row.backendAccount?.loginId || row.backendAccount?.username || "",
                              row.userEmail || row.loginAccount || thread?.merchantEmail || "",
                            ]
                              .filter(Boolean)
                              .join(" | ") || "-";
                            const active = selectedSupportListRow?.selectionKey === selectionKey;
                            const hasUnread = Boolean(thread && supportUnreadMerchantIds.has(thread.merchantId));
                            return (
                              <button
                                key={selectionKey}
                                type="button"
                                className={`w-full rounded-2xl border px-3 py-3 text-left transition ${
                                  active ? "border-blue-300 bg-blue-50" : "bg-white hover:bg-slate-50"
                                }`}
                                onClick={() => setSupportSelectedMerchantId(selectionKey)}
                              >
                                <div className="flex items-start justify-between gap-2">
                                  <div className="min-w-0">
                                    <div className="flex items-center gap-2">
                                      <div className="truncate text-sm font-medium text-slate-900">{displayLabel}</div>
                                      {hasUnread ? (
                                        <span aria-label="有未读消息" className="inline-flex h-2.5 w-2.5 shrink-0 rounded-full bg-rose-500" />
                                      ) : null}
                                    </div>
                                    <div className="truncate text-[11px] text-slate-500">{subtitle}</div>
                                  </div>
                                  <div className="shrink-0 text-[11px] text-slate-400">
                                    {thread ? formatSupportMessageTime(thread.updatedAt) : "未留言"}
                                  </div>
                                </div>
                                <div className="mt-2 line-clamp-2 text-xs leading-5 text-slate-600">
                                  {lastMessage?.text || "暂无留言记录"}
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      ) : backendMerchantAccountsLoading ? (
                        <div className="rounded border border-dashed px-3 py-4 text-xs text-slate-500">正在加载商户列表…</div>
                      ) : supportMerchantKeyword.trim() ? (
                        <div className="rounded border border-dashed px-3 py-4 text-xs text-slate-500">
                          没有匹配的商户，请换个关键词试试。
                        </div>
                      ) : (
                        <div className="rounded border border-dashed px-3 py-4 text-xs text-slate-500">
                          当前还没有已注册商户。
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="min-h-0 overflow-hidden rounded-lg border bg-white">
                    {selectedSupportThread ? (
                      <div className="flex h-full min-h-0 flex-col">
                        <div className="flex flex-wrap items-start justify-between gap-3 border-b px-5 py-4">
                          <div className="space-y-1">
                            <div className="text-base font-semibold text-slate-900">{selectedSupportDisplayLabel}</div>
                            <div className="text-xs text-slate-500">
                              ID：{selectedSupportThread.merchantId}
                              {selectedSupportMerchantRow?.loginAccount ? ` | 账号：${selectedSupportMerchantRow.loginAccount}` : ""}
                              {selectedSupportMerchantRow?.userEmail ? ` | 邮箱：${selectedSupportMerchantRow.userEmail}` : ""}
                            </div>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              className="rounded border bg-white px-3 py-2 text-sm hover:bg-slate-50"
                              onClick={() => setSupportBusinessCardDialogOpen(true)}
                            >
                              名片
                            </button>
                            <button
                              type="button"
                              className="rounded border bg-white px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-50"
                              onClick={() => openMerchantDetailPanelForRow(selectedSupportMerchantRow)}
                              disabled={!selectedSupportMerchantRow}
                            >
                              查看详情
                            </button>
                          </div>
                        </div>

                        <div ref={supportMessagesViewportRef} className="min-h-0 flex-1 overflow-y-auto bg-slate-50 px-5 py-5">
                          {selectedSupportThread.messages.length > 0 ? (
                            <div className="space-y-3">
                              {selectedSupportThread.messages.map((message) => {
                                const isMerchantMessage = message.sender === "merchant";
                                return (
                                  <div key={message.id} className={`flex ${isMerchantMessage ? "justify-start" : "justify-end"}`}>
                                    <div
                                      className={`max-w-[82%] rounded-2xl px-4 py-3 shadow-sm ${
                                        isMerchantMessage
                                          ? "border bg-white text-slate-900"
                                          : "bg-slate-900 text-white"
                                      }`}
                                    >
                                      <div className="text-[11px] opacity-70">
                                        {isMerchantMessage ? "商户" : "超级后台"} | {formatSupportMessageTime(message.createdAt)}
                                      </div>
                                      <div className="mt-1 whitespace-pre-wrap break-words text-sm leading-6">{message.text}</div>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          ) : (
                            <div className="rounded border border-dashed bg-white px-4 py-6 text-center text-sm text-slate-500">
                              当前还没有留言记录，你可以直接在下方发第一条消息。
                            </div>
                          )}
                        </div>

                        <div className="shrink-0 space-y-3 border-t px-5 py-4">
                          <textarea
                            ref={supportReplyInputRef}
                            className="h-32 w-full resize-none rounded-2xl border px-4 py-3 text-sm outline-none transition focus:border-slate-400"
                            placeholder="请输入要回复商户的内容"
                            value={supportReplyDraft}
                            onChange={(event) => setSupportReplyDraft(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key !== "Enter" || !event.ctrlKey || event.nativeEvent.isComposing) return;
                              event.preventDefault();
                              void sendSupportReplyAction();
                            }}
                            disabled={supportSending}
                          />
                          <div className="flex items-center justify-between gap-3">
                            <div className="text-xs text-slate-500">回复会直接出现在商户后台的“联系我们”窗口里。</div>
                            <button
                              type="button"
                              className="rounded bg-black px-4 py-2 text-sm text-white hover:bg-slate-800 disabled:opacity-50"
                              onClick={() => void sendSupportReplyAction()}
                              disabled={supportSending || !supportReplyDraft.trim()}
                            >
                              {supportSending ? "发送中..." : "发送回复"}
                            </button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="flex h-full min-h-0 items-center justify-center px-6 text-center text-sm text-slate-500">
                        {supportMerchantKeyword.trim() ? "暂无匹配商户，请调整搜索条件。" : "暂无可处理商户，请先确认注册用户数据是否已加载。"}
                      </div>
                    )}
                  </div>
                </div>
              </section>
              )
            ) : null}

            {supportMerchantInfoSheetOpen && activeMenu === "support_messages" && showMobileSupportThread
              ? renderTopMostOverlay(
                  <>
                    <button
                      type="button"
                      className="fixed inset-0 z-[2147483400] bg-slate-950/40 backdrop-blur-[1px]"
                      onClick={() => setSupportMerchantInfoSheetOpen(false)}
                      aria-label="关闭商户信息"
                    />
                    <div className="fixed inset-x-0 bottom-0 z-[2147483401] px-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)]">
                      <div className="mx-auto w-full max-w-md rounded-[30px] bg-white px-4 pb-4 pt-3 shadow-[0_24px_80px_rgba(15,23,42,0.2)]">
                        <div className="mx-auto h-1.5 w-12 rounded-full bg-slate-200" />
                        <div className="mt-4 flex items-start justify-between gap-3">
                          <div className="flex min-w-0 items-center gap-3">
                            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-slate-900 text-sm font-semibold text-white">
                              {getSupportAvatarLabel(selectedSupportDisplayLabel, "商")}
                            </div>
                            <div className="min-w-0">
                              <div className="truncate text-base font-semibold text-slate-900">{selectedSupportDisplayLabel}</div>
                              <div className="mt-1 text-xs text-slate-500">{selectedSupportMerchantHeaderIndustry}</div>
                            </div>
                          </div>
                          <button
                            type="button"
                            className="rounded-full border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
                            onClick={() => setSupportMerchantInfoSheetOpen(false)}
                          >
                            关闭
                          </button>
                        </div>
                        <div className="mt-4 divide-y divide-slate-100 overflow-hidden rounded-[24px] border border-slate-100 bg-slate-50/70">
                          {selectedSupportMerchantInfoItems.map((item) => (
                            <div key={item.label} className="px-4 py-3">
                              <div className="text-[11px] font-medium tracking-[0.08em] text-slate-400">{item.label}</div>
                              <div className="mt-1 text-sm leading-6 text-slate-900">
                                {item.href ? (
                                  <a
                                    href={item.href}
                                    target={item.openInNewTab ? "_blank" : undefined}
                                    rel={item.openInNewTab ? "noreferrer" : undefined}
                                    className="break-all text-slate-900 underline decoration-slate-300 underline-offset-4"
                                  >
                                    {item.value}
                                  </a>
                                ) : (
                                  <span>{item.value}</span>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </>,
                )
              : null}

            <ChatBusinessCardDialog
              open={supportBusinessCardDialogOpen && activeMenu === "support_messages"}
              merchantName={selectedSupportMerchantRow?.merchantName || selectedSupportDisplayLabel}
              subtitle={[
                selectedSupportMerchantRow?.merchantId || selectedSupportThread?.merchantId || "",
                selectedSupportMerchantRow?.userEmail || selectedSupportThread?.merchantEmail || "",
              ]
                .filter(Boolean)
                .join(" | ")}
              card={selectedSupportBusinessCard}
              onClose={() => setSupportBusinessCardDialogOpen(false)}
            />

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

            {activeMenu === "trusted_devices" ? (
              <section className="space-y-4">
                <div className="rounded-lg border bg-white p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-slate-900">白名单设备管理</div>
                      <div className="text-xs text-slate-500">
                        超级后台每次登录都需要邮箱验证。这里会记录设备名称、设备编号、登录 IP 和最近登录状态，并可限制白名单设备总数。
                      </div>
                    </div>
                    <div className="rounded border bg-slate-50 px-3 py-2 text-sm">{`当前设备数：${trustedDevices.length} / ${trustedDeviceLimit}`}</div>
                  </div>
                </div>

                <div className="rounded-lg border bg-white p-4">
                  <div className="grid gap-3 md:grid-cols-[minmax(0,220px)_auto_1fr] md:items-end">
                    <label className="block text-xs text-slate-600">
                      白名单设备上限
                      <input
                        className="mt-1 w-full rounded border px-3 py-2 text-sm"
                        value={trustedDeviceLimitInput}
                        onChange={(event) => setTrustedDeviceLimitInput(event.target.value)}
                        inputMode="numeric"
                      />
                    </label>
                    <button
                      type="button"
                      className="rounded bg-black px-4 py-2 text-sm text-white hover:bg-slate-800 disabled:opacity-50"
                      onClick={() => void saveTrustedDeviceLimitAction()}
                      disabled={trustedDeviceLimitSaving}
                    >
                      {trustedDeviceLimitSaving ? "保存中..." : "保存上限"}
                    </button>
                    <div className="rounded border bg-slate-50 px-3 py-3 text-xs text-slate-600">
                      新设备在完成 `caimin6669@qq.com` 邮箱验证后会自动加入白名单；当设备数达到上限后，新设备即使拿到验证码也不允许登录，必须先移除旧设备。
                    </div>
                  </div>

                  <div className="mt-3 rounded border bg-slate-50 px-3 py-3 text-xs text-slate-600">
                    当前设备会标记为“当前设备”；其他已登记设备会显示最近登录 IP 和最近状态，方便你排查异常登录来源。
                  </div>

                  {trustedDevicesError ? (
                    <div className="mt-3 text-sm text-rose-600">
                      {trustedDevicesError === "trusted_devices_timeout"
                        ? "白名单设备加载超时，请稍后重试"
                        : trustedDevicesError}
                    </div>
                  ) : null}

                  {trustedDevicesLoading ? (
                    <div className="mt-3 text-xs text-slate-500">正在加载白名单设备…</div>
                  ) : trustedDevices.length === 0 ? (
                    <div className="mt-3 rounded border border-dashed px-3 py-4 text-xs text-slate-500">
                      当前还没有白名单设备。下次完成超级后台邮箱验证后会自动出现。
                    </div>
                  ) : (
                    <div className="mt-4 grid gap-3">
                      {trustedDevices.map((device) => {
                        const isCurrent = currentSuperAdminDeviceId === device.deviceId;
                        return (
                          <div key={device.deviceId} className="rounded-xl border bg-slate-50/60 px-4 py-4">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div className="space-y-2">
                                <div className="flex flex-wrap items-center gap-2">
                                  <div className="text-sm font-medium text-slate-900">{device.deviceLabel}</div>
                                  {isCurrent ? (
                                    <span className="rounded-full bg-slate-900 px-2 py-0.5 text-[10px] text-white">当前设备</span>
                                  ) : (
                                    <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] text-slate-700">已登记</span>
                                  )}
                                  <span className={`rounded-full px-2 py-0.5 text-[10px] ${device.lastLoginStatus === "success" ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-700"}`}>
                                    {device.lastLoginStatus === "success" ? "最近登录成功" : device.lastLoginStatus}
                                  </span>
                                </div>
                                <div className="grid gap-2 text-xs text-slate-600 md:grid-cols-2">
                                  <div>{`设备编号：${device.deviceId}`}</div>
                                  <div>{`最近登录 IP：${device.lastLoginIp || "-"}`}</div>
                                  <div>{`首次记录 IP：${device.firstLoginIp || "-"}`}</div>
                                  <div>{`最近验证：${fmt(device.lastVerifiedAt)}`}</div>
                                  <div>{`首次登记：${fmt(device.addedAt)}`}</div>
                                  <div>{`登录状态：${isCurrent ? "当前设备" : "允许登录"}`}</div>
                                </div>
                              </div>
                              <button
                                type="button"
                                className="rounded border border-rose-200 bg-white px-3 py-2 text-sm text-rose-600 hover:bg-rose-50 disabled:opacity-50"
                                onClick={() => void deleteTrustedDeviceAction(device)}
                                disabled={trustedDeviceDeletingId === device.deviceId}
                              >
                                {trustedDeviceDeletingId === device.deviceId ? "移除中..." : "移出白名单"}
                              </button>
                            </div>
                          </div>
                        );
                      })}
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
