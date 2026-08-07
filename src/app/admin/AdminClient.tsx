"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type CSSProperties,
  type ChangeEvent,
  type ClipboardEvent as ReactClipboardEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type TouchEvent,
} from "react";
import { createPortal } from "react-dom";
import {
  AccountSwitcherDialog,
  BlockRenderer,
  ChatBusinessCardDialog,
  ColorOrGradientPicker,
  FaollaMobileSettingsContent,
  FaollaQrPanel,
  MemoizedInlineEditorBlock,
  MerchantBookingManagerDialog,
  MerchantBookingMobilePanel,
  MerchantBusinessCardManager,
  MerchantCustomerManager,
  MerchantPollStatsPanel,
  MerchantEnterpriseManager,
  MerchantCouponManager,
  MerchantMemberManager,
  MerchantMembershipSettingsPanel,
  MerchantOrderManagerDialog,
  MerchantOrderMobilePanel,
  MerchantPointRedemptionCashier,
  MerchantPrintSettingsPanel,
  MerchantProfileDialog,
  MerchantRedemptionSettingsPanel,
  RecentColorBar,
  SupportMessageContent,
  SupportMessageImagePreviewOverlay,
  loadAccountSwitcherDialog,
  loadEditorAssetProcessing,
  loadEditorThemeProcessing,
  loadFaollaQrPanel,
  loadMerchantBookingManagerDialog,
  loadMerchantBusinessCardManager,
  loadMerchantCustomerManager,
  loadMerchantPollStatsPanel,
  loadMerchantEnterpriseManager,
  loadMerchantCouponManager,
  loadMerchantMemberManager,
  loadMerchantMembershipSettingsPanel,
  loadMerchantOrderManagerDialog,
  loadMerchantPointRedemptionCashier,
  loadMerchantPrintSettingsPanel,
  loadMerchantProfileDialog,
  loadSupportMessageContent,
  preloadEditorPreviewComponents,
} from "@/components/admin/AdminDeferredComponents";
import type { MerchantEnterpriseView } from "@/components/admin/MerchantEnterpriseManager";
import {
  homeBlocks,
  type BackgroundEditableProps,
  type Block,
  type ImageFillMode,
  type MerchantListPublishedSite,
} from "@/data/homeBlocks";
import { createDefaultPollQuestions, createPollEntityId } from "@/lib/merchantPolls";
import {
  MERCHANT_INDUSTRY_OPTIONS,
  PLAN_TEMPLATE_CATEGORY_OPTIONS,
  createDefaultMerchantContactVisibility,
  createDefaultMerchantSortConfig,
  createFeaturePackage,
  createDefaultMerchantPermissionConfig,
  loadPlatformState,
  savePlatformState,
  subscribePlatformState,
  type MerchantIndustry,
  type MerchantContactVisibility,
  type MerchantSortRule,
  type PlanTemplate,
  type PlanTemplateCategory,
  type Site,
  type SiteLocation,
} from "@/data/platformControlStore";
import {
  loadBlocksFromStorage,
  loadPublishedBlocksFromStorage,
  rollbackToPreviousPublishedVersion,
  recordPublishedVersion,
  readLatestDraftSnapshot,
  flushScheduledBlocksToStorage,
  scheduleBlocksToStorage,
  saveLatestDraftSnapshot,
  saveBlocksToStorage,
  savePublishedBlocksToStorage,
  savePublishFailureSnapshot,
  readPublishFailureSnapshots,
} from "@/data/blockStore";
import {
  BACKEND_UNAVAILABLE_NOTICE,
  canReachSupabaseGateway,
  getResolvedSupabaseUrl,
  isSupabaseEnabled,
  isSupabaseFallbackMode,
  resolvedSupabaseAnonKey,
  supabase,
  supabaseMissingEnvNotice,
} from "@/lib/supabase";
import {
  clearStoredBrowserSupabaseSessionTokens,
  isTransientAuthValidationError,
  readMerchantSessionMerchantIds,
  readMerchantSessionPayload,
  recoverBrowserSupabaseSessionViaMerchantCookies,
  recoverBrowserSupabaseSessionWithRefresh,
  startMerchantSessionKeepAlive,
  syncMerchantSessionCookies,
} from "@/lib/authSessionRecovery";
import { installFrontendAuthBridgeResponder, isTrustedFrontendAuthBridgeOrigin } from "@/lib/frontendAuthBridge";
import { flushBufferedEditorTextCommits } from "@/lib/editorTextCommitBuffer";
import {
  clearRecentMerchantLaunchState,
  persistRecentMerchantLaunchState,
  readRecentMerchantLaunchMerchantId,
} from "@/lib/merchantLaunchState";
import { clearMerchantSignInBridge } from "@/lib/merchantSignInBridge";
import {
  claimAdminAutoReload,
  clearAdminAutoReload,
  type AdminAutoReloadStorage,
} from "@/lib/adminAutoReload";
import {
  buildMerchantAdminDataCacheKey,
  fetchMerchantAdminDataWithCache,
  makeMerchantAdminDataCacheKey,
  readMerchantAdminDataCache,
  readMerchantAdminDataCacheSnapshot,
  writeMerchantAdminDataCache,
} from "@/lib/merchantAdminDataCache";
import { buildPublishedMerchantProfilePatch } from "@/lib/merchantProfileBinding";
import { buildMerchantBusinessCardShareUrl, resolveMerchantBusinessCardShareOrigin } from "@/lib/merchantBusinessCardShare";
import { getBackgroundStyle } from "@/components/blocks/backgroundStyle";
import type { SupportMessageImageActivatePayload } from "@/components/support/SupportMessageContent";
import {
  normalizeMerchantBusinessCards,
  normalizeMerchantBusinessCardChatDisplaySelection,
  mergeMerchantBusinessCardAssets,
  resolveMerchantBusinessCardForChatDisplay,
  type MerchantBusinessCardAsset,
  type MerchantBusinessCardProfileInput,
} from "@/lib/merchantBusinessCards";
import { type PlatformSupportMessage, type PlatformSupportThread } from "@/lib/platformSupportInbox";
import {
  findMerchantPeerThreadForMerchants,
  type MerchantPeerContactSummary,
  type MerchantPeerMessage,
  type MerchantPeerThread,
} from "@/lib/merchantPeerInbox";
import {
  findFirstNewIncomingSupportMessageKey,
  type SupportConversationScrollMessage,
} from "@/lib/supportConversationScroll";
import {
  formatSupportConversationPreview,
  isSupportShortMerchantCardLink,
  parseSupportMessageAttachmentPreview,
} from "@/lib/supportMessageAttachments";
import {
  buildPersistedBlocksFromPlanConfig,
  buildSinglePlanPublishConfig,
  cloneBlocks,
  getBlocksForPage,
  getPagePlanConfigFromBlocks,
  setBlocksForPage,
  type PagePlanConfig,
  type PlanId,
} from "@/lib/pagePlans";
import {
  buildMerchantBookingRulesSnapshotFromPlanConfigs,
  type MerchantBookingRulesSnapshot,
} from "@/lib/merchantBookingRules";
import { buildPublicBlockId } from "@/lib/blockPublicId";
import { countInlineAssets } from "@/lib/inlineAssetStats";
import { showGlobalToast } from "@/lib/globalToast";
import { useNotificationSound } from "@/lib/useNotificationSound";
import {
  canUseFaollaNativeNotifications,
  readFaollaNativeNotificationPermission,
  requestFaollaNativeNotificationPermission,
  showFaollaNativeMessageNotification,
  syncFaollaNativeUnreadBadge,
  configureFaollaNativeNotificationSync,
  type FaollaNativeNotificationPermission,
} from "@/lib/faollaNativeNotifications";
import usePullToRefresh from "@/lib/usePullToRefresh";
import {
  PLAN_TEMPLATE_FILTER_OPTIONS,
  type PlanTemplateFilterCategory,
  matchPlanTemplateCategory,
  summarizePlanTemplateBlocks,
} from "@/lib/planTemplates";
import { extractPlanTemplateCoverBackground, rebuildSinglePlanPublishBlocks } from "@/lib/planTemplateRuntime";
import { PLAN_TEMPLATE_PREVIEW_VARIANT } from "@/lib/planTemplatePreviewConstants";
import { sanitizeBlocksForRuntime } from "@/lib/blocksSanitizer";
import { shouldOfferCompressionPresetForPublishError } from "@/lib/publishErrorGuidance";
import {
  filterMerchantOperationLogs,
  MERCHANT_OPERATION_LOG_EVENT,
  readMerchantOperationLogs,
  recordMerchantOperationLog,
  type MerchantOperationLogEntry,
  type MerchantOperationLogStatus,
} from "@/lib/merchantOperationLogs";
import {
  readCurrentMerchantOperationContext,
  runWithMerchantOperationContext,
  type MerchantOperationContext,
} from "@/lib/merchantOperationContext";
import { uploadFileToPublicStorageWithMetadata } from "@/lib/publicAssetUpload";
import { loadEuropeLocationOptionsApi, type EuropeLocationOptionsApi } from "@/lib/europeLocationOptionsLoader";
import { getBlockRenderStackOrder } from "@/lib/blockStacking";
import {
  createDefaultMerchantIndustryTabs,
} from "@/lib/merchantIndustryTabs";
import { buildPlatformMerchantSnapshotPayloadFromState } from "@/lib/platformMerchantSnapshot";
import {
  createProductItemId,
} from "@/lib/productBlock";
import { normalizePublicAssetUrl } from "@/lib/publicAssetUrl";
import {
  buildDefaultBookingItemOptions,
  buildDefaultBookingStoreOptions,
  buildDefaultBookingTitleOptions,
  isMerchantBookingNewForMerchant,
  normalizeBookingOptionList,
  type MerchantBookingRecord,
} from "@/lib/merchantBookings";
import {
  formatMerchantOrderAmount,
  isMerchantOrderNewForMerchant,
  type MerchantOrderRecord,
} from "@/lib/merchantOrders";
import {
  buildMerchantOrderTaskDraft,
  getMerchantOrderSourceErrorMessage,
  type MerchantOrderSourceDetailIntent,
  type MerchantOrderTaskDraftIntent,
} from "@/lib/merchantOrderEnterprise";
import { createClientMutationOperationId } from "@/lib/mutationOperationId";
import {
  getVisibleMerchantCoupons,
  normalizeMerchantCouponRecords,
  type MerchantCouponRecord,
} from "@/lib/merchantCoupons";
import type { MerchantMemberSettingsView } from "@/lib/merchantMembershipSettings";
import { broadcastPublishSync } from "@/lib/publishSync";
import {
  type ButtonJumpBlock,
} from "@/lib/buttonBlock";
import { isMerchantNumericId } from "@/lib/merchantIdentity";
import {
  buildMerchantBackendHref,
  buildMerchantDomain,
  buildMerchantFrontendHref,
  buildSiteStoreScope,
  resolveRuntimePortalBaseDomain,
} from "@/lib/siteRouting";
import { buildMerchantSiteLinker } from "@/lib/merchantSiteLinking";
import {
  getAccountSwitchEntryKey,
  getAccountSwitchHomeHref,
  readAccountSwitchEntries,
  recordCurrentAccountSwitchSession,
  removeAccountSwitchEntry,
  restoreAccountSwitchEntry,
  type AccountSwitchEntry,
} from "@/lib/accountSwitching";
import { useI18n } from "@/components/I18nProvider";
import LoadingProgressScreen from "@/components/LoadingProgressScreen";
import NoMercyFlagIcon from "@/components/NoMercyFlagIcon";
import ShuangkouToolIcon from "@/components/ShuangkouToolIcon";
import TankBattleIcon from "@/components/TankBattleIcon";
import ToolboxIcon from "@/components/ToolboxIcon";
import {
  getFaollaMobileSettingsBackView,
  getFaollaMobileSettingsSubtitle,
  getFaollaMobileSettingsTitle,
  isFaollaMobileSettingsView,
  type FaollaMobileSettingsView,
} from "@/components/FaollaMobileSettingsViews";
import {
  FAOLLA_APP_SHELL_LOCATION_MESSAGE,
  buildFaollaShellHref,
  isFaollaBackendShellUrl,
  isFaollaAppShellSearch,
  isFaollaSectionSearch,
  normalizeFaollaEntryUrl,
  readStoredFaollaEntryUrl,
  resolveFaollaEntryUrlFromBrowser,
  writeStoredFaollaEntryUrl,
} from "@/lib/faollaEntry";
import {
  buildFaollaQrConnectUrl,
  fetchFaollaQrToken,
  openScannedQrValue,
  resetFaollaQrToken,
} from "@/lib/faollaQrClient";
import { LANGUAGE_OPTIONS, resolveSupportedLocale } from "@/lib/i18n";
import { normalizeRecentColorToken } from "@/lib/editorColors";
import { buildFaollaServiceWorkerPath } from "@/lib/faollaServiceWorker";
import { getMerchantServiceState } from "@/lib/merchantServiceStatus";
import { MOBILE_SWIPE_BACK_EVENT } from "@/lib/mobileSwipeBack";
import { clearTankBattleLobbyReturnTarget, readTankBattleLobbyReturnTarget } from "@/lib/tankBattleLobbyReturn";
import { useFaollaAndroidAppUpdate } from "@/lib/useFaollaAndroidAppUpdate";
import { useMobilePortraitOrientationLock } from "@/lib/useMobilePortraitOrientationLock";

function readSameOriginFrameHref(frame: HTMLIFrameElement | null) {
  try {
    return frame?.contentWindow?.location.href ?? "";
  } catch {
    return "";
  }
}

function scheduleAdminIdleTask(
  task: () => void,
  options: { timeoutMs?: number; fallbackDelayMs?: number } = {},
) {
  if (typeof window === "undefined") return () => {};
  const idleWindow = window as Window & {
    requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => number;
    cancelIdleCallback?: (handle: number) => void;
  };
  let cancelled = false;
  let idleCallbackId: number | null = null;
  let timeoutId: number | null = null;
  const run = () => {
    if (!cancelled) task();
  };

  if (typeof idleWindow.requestIdleCallback === "function") {
    idleCallbackId = idleWindow.requestIdleCallback(run, { timeout: options.timeoutMs ?? 1400 });
  } else {
    timeoutId = window.setTimeout(run, options.fallbackDelayMs ?? 320);
  }

  return () => {
    cancelled = true;
    if (idleCallbackId !== null && typeof idleWindow.cancelIdleCallback === "function") {
      idleWindow.cancelIdleCallback(idleCallbackId);
    }
    if (timeoutId !== null) {
      window.clearTimeout(timeoutId);
    }
  };
}

const IMAGE_FILL_VALUES: ImageFillMode[] = [
  "cover",
  "contain",
  "fill",
  "repeat",
  "repeat-x",
  "repeat-y",
];

function FaollaHomeButton({
  className,
  onClick,
}: {
  className?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center rounded-full border border-slate-200/90 bg-white/95 text-slate-700 shadow-[0_10px_24px_rgba(15,23,42,0.14)] backdrop-blur transition hover:-translate-y-[1px] hover:bg-white hover:text-slate-950 ${className ?? ""}`}
      onClick={onClick}
      title="返回 Faolla 总站"
      aria-label="返回 Faolla 总站"
    >
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
        <path
          d="M4.75 10.5 12 4.75l7.25 5.75V18a1.25 1.25 0 0 1-1.25 1.25H6A1.25 1.25 0 0 1 4.75 18V10.5Z"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
        <path d="M9.25 19.25v-5h5.5v5" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      </svg>
    </button>
  );
}
const BACKGROUND_POSITION_OPTIONS = [
  "center",
  "top",
  "bottom",
  "left",
  "right",
  "left top",
  "left center",
  "left bottom",
  "right top",
  "right center",
  "right bottom",
];

function languageFlagImageUrl(countryCode: string) {
  return `https://flagcdn.com/${countryCode.toLowerCase()}.svg`;
}

const BLOCK_TYPE_LABELS: Record<Block["type"], string> = {
  common: "通用",
  button: "按钮",
  gallery: "相册",
  chart: "图表",
  nav: "导航",
  music: "音乐",
  hero: "通用",
  text: "通用",
  list: "通用",
  "search-bar": "搜索",
  "merchant-list": "商户列表",
  product: "产品",
  coupon: "优惠券",
  "google-reviews": "Google 评论",
  booking: "预约",
  poll: "投票",
  contact: "联系方式",
};

type PlanTemplatePreviewOption = {
  planId: string;
  planName: string;
};

type BookingManagerOptionSet = {
  storeOptions: string[];
  itemOptions: string[];
  titleOptions: string[];
};

function getPlanTemplatePreviewOptions(rawBlocks: unknown): PlanTemplatePreviewOption[] {
  if (!Array.isArray(rawBlocks) || rawBlocks.length === 0) return [];
  try {
    return getPagePlanConfigFromBlocks(rawBlocks as Block[]).plans
      .map((plan, index) => {
        const planId = String(plan.id ?? "").trim();
        if (!planId) return null;
        return {
          planId,
          planName: String(plan.name ?? "").trim() || `方案${index + 1}`,
        };
      })
      .filter((item): item is PlanTemplatePreviewOption => !!item);
  } catch {
    return [];
  }
}

function collectBookingOptionsFromPlanConfig(config: PagePlanConfig | null | undefined): BookingManagerOptionSet {
  const collected: BookingManagerOptionSet = {
    storeOptions: [],
    itemOptions: [],
    titleOptions: [],
  };
  if (!config) return collected;

  for (const plan of config.plans ?? []) {
    const pages =
      Array.isArray(plan.pages) && plan.pages.length > 0
        ? plan.pages
        : [{ id: plan.activePageId, name: "", blocks: getBlocksForPage(plan, plan.activePageId) }];

    for (const page of pages) {
      for (const block of page.blocks ?? []) {
        if (block.type !== "booking") continue;
        collected.storeOptions.push(...normalizeBookingOptionList(block.props.bookingStoreOptions));
        collected.itemOptions.push(...normalizeBookingOptionList(block.props.bookingItemOptions));
        collected.titleOptions.push(...normalizeBookingOptionList(block.props.bookingTitleOptions));
      }
    }
  }

  return collected;
}

function countBlocksByTypeInPlanConfig(config: PagePlanConfig | null | undefined, type: Block["type"]) {
  if (!config) return 0;
  let count = 0;
  for (const plan of config.plans ?? []) {
    const pages =
      Array.isArray(plan.pages) && plan.pages.length > 0
        ? plan.pages
        : [{ id: plan.activePageId, name: "", blocks: getBlocksForPage(plan, plan.activePageId) }];
    for (const page of pages) {
      for (const block of page.blocks ?? []) {
        if (block.type === type) count += 1;
      }
    }
  }
  return count;
}

function countBlocksByTypeInSinglePlanConfig(
  config: PagePlanConfig | null | undefined,
  type: Block["type"],
  planId?: PlanId,
) {
  if (!config) return 0;
  const plan =
    (planId ? config.plans.find((item) => item.id === planId) : null) ??
    config.plans.find((item) => item.id === config.activePlanId) ??
    config.plans[0] ??
    null;
  if (!plan) return 0;
  let count = 0;
  const pages =
    Array.isArray(plan.pages) && plan.pages.length > 0
      ? plan.pages
      : [{ id: plan.activePageId, name: "", blocks: getBlocksForPage(plan, plan.activePageId) }];
  for (const page of pages) {
    for (const block of page.blocks ?? []) {
      if (block.type === type) count += 1;
    }
  }
  return count;
}

function countBookingBlocksInPlanConfig(config: PagePlanConfig | null | undefined) {
  return countBlocksByTypeInPlanConfig(config, "booking");
}

function countBookingBlocksInSinglePlanConfig(config: PagePlanConfig | null | undefined, planId?: PlanId) {
  return countBlocksByTypeInSinglePlanConfig(config, "booking", planId);
}
const NUDGE_STEP = 4;
const HISTORY_LIMIT = 120;
const AUTH_CHECK_TIMEOUT_MS = 6000;
const ADMIN_PAGE_LOAD_TIMEOUT_MS = 35000;
const SUPPORT_THREAD_OPEN_POLL_INTERVAL_MS = 1200;
const SUPPORT_THREAD_POLL_INTERVAL_MS = 5000;
const SUPPORT_LAST_READ_STORAGE_KEY_PREFIX = "merchant-space:admin:support-last-read:";
const SUPPORT_NOTIFIED_EVENT_STORAGE_KEY_PREFIX = "merchant-space:admin:support-notified-events:v1:";
const SUPPORT_NOTIFIED_EVENT_LIMIT = 240;
const SUPPORT_OFFICIAL_CONTACT_KEY = "official";
const MERCHANT_IDS_CACHE_KEY = "merchant-space:admin:merchant-ids:v2";
const MERCHANT_IDS_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

function readMerchantLogDatePartsValue(value: string) {
  const normalized = value
    .trim()
    .replace(/[年月]/g, "-")
    .replace(/日/g, "")
    .replace(/[./]/g, "-")
    .replace(/\s+/g, "");
  if (!normalized) return null;
  const match = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  const probe = new Date(year, month - 1, day);
  if (
    probe.getFullYear() !== year ||
    probe.getMonth() !== month - 1 ||
    probe.getDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

function formatMerchantLogDateValue(value: string) {
  const parts = readMerchantLogDatePartsValue(value);
  if (!parts) return "";
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function formatMerchantLogDateBoundaryIso(value: string, boundary: "start" | "end") {
  const parts = readMerchantLogDatePartsValue(value);
  if (!parts) return "";
  const date =
    boundary === "start"
      ? new Date(parts.year, parts.month - 1, parts.day, 0, 0, 0, 0)
      : new Date(parts.year, parts.month - 1, parts.day, 23, 59, 59, 999);
  return date.toISOString();
}

function isSameBlocksSnapshot(a: Block[], b: Block[]) {
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

function isIgnorableAbortReason(reason: unknown) {
  if (!reason || typeof reason !== "object") return false;
  const record = reason as { name?: unknown; message?: unknown; __isAuthError?: unknown; status?: unknown };
  const name = typeof record.name === "string" ? record.name : "";
  const message = typeof record.message === "string" ? record.message : "";
  if (name === "AbortError") return true;
  if (message.includes("signal is aborted without reason")) return true;
  if (/invalid refresh token|already used/i.test(message)) return true;
  if (name === "AuthRetryableFetchError") return true;
  if (Number(record.status) === 0) return true;
  if (record.__isAuthError === true && name === "AuthRetryableFetchError") return true;
  if (record.__isAuthError === true && record.status === 0) return true;
  return false;
}

const MAX_ORIGINAL_IMAGE_DATA_URL_LENGTH = 6_000_000;
const MAX_PUBLISH_PAYLOAD_BYTES = 30_000_000;
type UploadCompressionPreset = "high" | "balanced" | "compact";
type ImageCompressionOption = { label: string; maxSide: number; quality: number };
type EditorImageUploadPurpose = "common" | "gallery" | "page-background";
type EditorImageUploadUsage = "common-block-image" | "gallery-block-image" | "product-image" | "generic-image";
type PersistedEditorAssetResult = {
  value: string;
  thumbnailUrl?: string;
  externalized: boolean;
};
const IMAGE_COMPRESSION_OPTIONS: Record<UploadCompressionPreset, ImageCompressionOption> = {
  high: { label: "高质量", maxSide: 3200, quality: 0.92 },
  balanced: { label: "平衡", maxSide: 2600, quality: 0.88 },
  compact: { label: "压缩优先", maxSide: 2000, quality: 0.8 },
};
const PRODUCT_IMAGE_UPLOAD_OPTIONS = { maxSide: 1600, quality: 0.82 } as const;
const PAGE_BACKGROUND_IMAGE_COMPRESSION_OPTIONS = {
  desktop: { label: "PC背景", maxSide: 2200, quality: 0.8 },
  mobile: { label: "手机背景", maxSide: 1400, quality: 0.76 },
} as const;
const PAGE_BACKGROUND_IMAGE_LIMIT_BYTES = {
  desktop: 480 * 1024,
  mobile: 220 * 1024,
} as const;
type ThemePresetKey = "none" | "cartoon" | "retro" | "minimal" | "future" | "luxury" | "magazine" | "commerce" | "cinema";
const THEME_PRESET_OPTIONS: Array<{ value: ThemePresetKey; label: string }> = [
  { value: "none", label: "无效果" },
  { value: "cartoon", label: "卡通活动" },
  { value: "retro", label: "经典" },
  { value: "minimal", label: "极简风格" },
  { value: "future", label: "未来科技" },
  { value: "luxury", label: "高端奢华" },
  { value: "magazine", label: "杂志风格" },
  { value: "commerce", label: "电商风格" },
  { value: "cinema", label: "电影感" },
];
const RECENT_COLORS_KEY = "merchant-space:recent-colors:v1";
const MAX_RECENT_COLORS = 10;
const MERCHANT_MEMBER_CONTEXT_MENU_ITEMS: Array<{ label: string; view: Exclude<MerchantMemberSettingsView, "list"> }> = [
  { label: "充值方案", view: "rechargePlans" },
  { label: "等级&权益", view: "levels" },
  { label: "积分规则", view: "pointsRules" },
];
const MERCHANT_ENTERPRISE_CONTEXT_MENU_ITEMS: Array<{
  label: string;
  view: Exclude<MerchantEnterpriseView, "overview">;
}> = [
  { label: "待办中心", view: "todos" },
  { label: "任务看板", view: "tasks" },
  { label: "工作流程", view: "workflows" },
  { label: "流程自动化", view: "automations" },
  { label: "员工账号", view: "employees" },
  { label: "角色权限", view: "roles" },
  { label: "操作记录", view: "audit" },
];
type ViewportKey = "desktop" | "mobile";
type MerchantDesktopSection =
  | "editor"
  | "profile"
  | "cards"
  | "customers"
  | "pollStats"
  | "coupons"
  | "couponRedeemWorkbench"
  | "couponClaims"
  | "couponRedemptions"
  | "couponDailyStats"
  | "pointRedemption"
  | "redemptionRecords"
  | "rechargeRecords"
  | "redemptionCategories"
  | "redemptionItems"
  | "booking"
  | "orders"
  | "enterprise"
  | "logs"
  | "printer"
  | "business"
  | "members"
  | "support"
  | "faolla";
const MOBILE_SIZE_SCALE = 0.82;
const MOBILE_CONTENT_MAX_WIDTH = 340;
const MOBILE_SAFE_PADDING = 12;
const STYLE_SYNC_KEYS = [
  "fontFamily",
  "fontColor",
  "fontSize",
  "fontWeight",
  "fontStyle",
  "textDecoration",
  "bgImageUrl",
  "bgFillMode",
  "bgPosition",
  "bgColor",
  "bgOpacity",
  "bgImageOpacity",
  "bgColorOpacity",
  "blockWidth",
  "blockHeight",
  "blockOffsetX",
  "blockOffsetY",
  "blockLayer",
  "blockOpenMode",
  "blockBorderStyle",
  "blockBorderColor",
  "galleryFrameWidth",
  "galleryFrameHeight",
  "contactLayout",
  "mapZoom",
  "mapType",
  "mapShowMarker",
] as const;
const PAGE_BACKGROUND_PROP_KEYS = [
  "pageBgImageUrl",
  "pageBgFillMode",
  "pageBgPosition",
  "pageBgColor",
  "pageBgOpacity",
  "pageBgImageOpacity",
  "pageBgColorOpacity",
] as const;
const GENERIC_THEME_COPY_KEYS = [
  "fontFamily",
  "fontColor",
  "bgColor",
  "bgOpacity",
  "bgImageOpacity",
  "bgColorOpacity",
  "blockBorderStyle",
  "blockBorderColor",
] as const;
const PRODUCT_THEME_COPY_KEYS = [
  "productCardBgColor",
  "productCardBgOpacity",
  "productCardBorderStyle",
  "productCardBorderColor",
  "productTagBgColor",
  "productTagBgOpacity",
  "productTagActiveBgColor",
  "productTagActiveBgOpacity",
  "productTagBorderStyle",
  "productTagTextAlign",
  "productTagFontSize",
  "productTagWidth",
  "productTagRowGap",
  "productCardHeight",
  "productItemGap",
  "productCartQuantityMode",
  "productCartButtonPosition",
  "productHideScrollbar",
  "productCodeTypography",
  "productNameTypography",
  "productDescriptionTypography",
  "productPriceTypography",
] as const;
const MERCHANT_LIST_THEME_COPY_KEYS = [
  "merchantCardBgColor",
  "merchantCardBgOpacity",
  "merchantCardBorderStyle",
  "merchantCardBorderColor",
  "merchantTabButtonBgColor",
  "merchantTabButtonBgOpacity",
  "merchantTabButtonBorderStyle",
  "merchantTabButtonBorderColor",
  "merchantTabButtonActiveBgColor",
  "merchantTabButtonActiveBgOpacity",
  "merchantTabButtonActiveBorderStyle",
  "merchantTabButtonActiveBorderColor",
  "merchantPagerButtonBgColor",
  "merchantPagerButtonBgOpacity",
  "merchantPagerButtonBorderStyle",
  "merchantPagerButtonBorderColor",
  "merchantPagerButtonDisabledBgColor",
  "merchantPagerButtonDisabledBgOpacity",
  "merchantPagerButtonDisabledBorderStyle",
  "merchantPagerButtonDisabledBorderColor",
  "merchantCardTypography",
  "merchantCardIndustryStyles",
] as const;
const PAGE_COPY_BACKGROUND_ITEM_ID = "background";
const PAGE_COPY_THEME_ITEM_ID = "theme";

type PageCopySelectionState = Record<string, boolean>;
type PageCopyBlockEntry = {
  block: Block;
  index: number;
  occurrenceIndex: number;
};

function getEmbeddedMobilePlanConfig(sourceBlocks: Block[]): PagePlanConfig | null {
  const carrier = sourceBlocks.find((block) => !!(block?.props as { pagePlanConfigMobile?: unknown } | undefined)?.pagePlanConfigMobile);
  const rawMobile = (carrier?.props as { pagePlanConfigMobile?: unknown } | undefined)?.pagePlanConfigMobile;
  if (!rawMobile) return null;
  const cloned = cloneBlocks(sourceBlocks);
  const carrierIndex = cloned.findIndex((block) => !!(block?.props as { pagePlanConfigMobile?: unknown } | undefined)?.pagePlanConfigMobile);
  if (carrierIndex >= 0) {
    cloned[carrierIndex] = {
      ...cloned[carrierIndex],
      props: {
        ...cloned[carrierIndex].props,
        pagePlanConfig: rawMobile as never,
      } as never,
    } as Block;
    delete (cloned[carrierIndex].props as { pagePlanConfigMobile?: unknown }).pagePlanConfigMobile;
  }
  return getPagePlanConfigFromBlocks(cloned);
}

function scaleValue(value: unknown, min?: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return value;
  const scaled = Math.round(value * MOBILE_SIZE_SCALE);
  return typeof min === "number" ? Math.max(min, scaled) : scaled;
}

function adaptBlockForMobile(block: Block): Block {
  const next = cloneBlocks([block])[0];
  const props = { ...(next.props as Record<string, unknown>) };
  const originalWidth =
    typeof props.blockWidth === "number" && Number.isFinite(props.blockWidth) ? Math.max(1, Math.round(props.blockWidth)) : undefined;
  const scaledWidth = typeof originalWidth === "number" ? Math.round(originalWidth * MOBILE_SIZE_SCALE) : undefined;
  const fittedWidth =
    typeof scaledWidth === "number"
      ? Math.max(120, Math.min(MOBILE_CONTENT_MAX_WIDTH, scaledWidth))
      : undefined;
  props.blockWidth = fittedWidth;
  props.blockHeight = scaleValue(props.blockHeight, 80);
  const scaledOffsetX = scaleValue(props.blockOffsetX);
  if (typeof scaledOffsetX === "number") {
    const maxX = Math.max(0, MOBILE_CONTENT_MAX_WIDTH - (typeof fittedWidth === "number" ? fittedWidth : MOBILE_CONTENT_MAX_WIDTH)) + MOBILE_SAFE_PADDING;
    const minX = -MOBILE_SAFE_PADDING;
    props.blockOffsetX = Math.max(minX, Math.min(maxX, scaledOffsetX));
  } else {
    props.blockOffsetX = scaledOffsetX;
  }
  props.blockOffsetY = scaleValue(props.blockOffsetY);
  props.fontSize = scaleValue(props.fontSize, 10);
  const galleryFrameWidth = scaleValue(props.galleryFrameWidth, 120);
  props.galleryFrameWidth =
    typeof galleryFrameWidth === "number" ? Math.min(MOBILE_CONTENT_MAX_WIDTH, galleryFrameWidth) : galleryFrameWidth;
  props.galleryFrameHeight = scaleValue(props.galleryFrameHeight, 80);
  if (Array.isArray(props.commonTextBoxes)) {
    props.commonTextBoxes = props.commonTextBoxes.map((item) => {
      const box = { ...(item as Record<string, unknown>) };
      box.x = scaleValue(box.x);
      box.y = scaleValue(box.y);
      box.width = scaleValue(box.width, 60);
      box.height = scaleValue(box.height, 40);
      return box;
    });
  }
  next.props = props as never;
  return next;
}

function fitBlocksIntoMobileWidth(blocks: Block[]): Block[] {
  if (blocks.length === 0) return blocks;
  const adapted = cloneBlocks(blocks);
  const metrics = adapted.map((block) => {
    const props = block.props as Record<string, unknown>;
    const x =
      typeof props.blockOffsetX === "number" && Number.isFinite(props.blockOffsetX)
        ? Math.round(props.blockOffsetX)
        : 0;
    const width =
      typeof props.blockWidth === "number" && Number.isFinite(props.blockWidth)
        ? Math.max(120, Math.round(props.blockWidth))
        : MOBILE_CONTENT_MAX_WIDTH;
    return { x, width, right: x + width };
  });
  const minLeft = Math.min(...metrics.map((item) => item.x));
  const maxRight = Math.max(...metrics.map((item) => item.right));
  const contentWidth = Math.max(1, maxRight - minLeft);
  const availableWidth = MOBILE_CONTENT_MAX_WIDTH;
  const scale = contentWidth > availableWidth ? availableWidth / contentWidth : 1;

  return adapted.map((block, idx) => {
    const props = { ...(block.props as Record<string, unknown>) };
    const originalX = metrics[idx].x;
    const originalWidth = metrics[idx].width;
    const normalizedX = Math.round((originalX - minLeft) * scale);
    const normalizedWidth = Math.max(120, Math.min(availableWidth, Math.round(originalWidth * scale)));
    props.blockOffsetX = normalizedX;
    props.blockWidth = normalizedWidth;
    if (typeof props.fontSize === "number" && Number.isFinite(props.fontSize)) {
      props.fontSize = Math.max(10, Math.round(Number(props.fontSize) * scale));
    }
    if (typeof props.galleryFrameWidth === "number" && Number.isFinite(props.galleryFrameWidth)) {
      props.galleryFrameWidth = Math.max(120, Math.min(availableWidth, Math.round(Number(props.galleryFrameWidth) * scale)));
    }
    if (Array.isArray(props.commonTextBoxes)) {
      props.commonTextBoxes = props.commonTextBoxes.map((item) => {
        const box = { ...(item as Record<string, unknown>) };
        if (typeof box.x === "number" && Number.isFinite(box.x)) box.x = Math.round(Number(box.x) * scale);
        if (typeof box.width === "number" && Number.isFinite(box.width)) {
          box.width = Math.max(60, Math.round(Number(box.width) * scale));
        }
        if (typeof box.height === "number" && Number.isFinite(box.height)) {
          box.height = Math.max(40, Math.round(Number(box.height) * scale));
        }
        return box;
      });
    }
    return {
      ...block,
      props: props as never,
    } as Block;
  });
}

function adaptPlanConfigForMobile(config: PagePlanConfig): PagePlanConfig {
  return {
    ...config,
    plans: config.plans.map((plan) => ({
      ...plan,
      blocks: fitBlocksIntoMobileWidth(plan.blocks.map(adaptBlockForMobile)),
      pages: plan.pages.map((page) => ({
        ...page,
        blocks: fitBlocksIntoMobileWidth(page.blocks.map(adaptBlockForMobile)),
      })),
    })),
  };
}

function getFirstNavBlock(blocks: Block[]) {
  return blocks.find((item) => item.type === "nav") ?? null;
}

function stripNavBlocks(blocks: Block[]) {
  return blocks.filter((item) => item.type !== "nav");
}

function hasNavBlock(blocks: Block[]) {
  return blocks.some((item) => item.type === "nav");
}

function getDefaultSelectedBlockIdForPage(blocks: Block[]) {
  return blocks.find((item) => item.type !== "nav")?.id ?? "";
}

function getNavSyncKey(blocks: Block[]) {
  const nav = getFirstNavBlock(blocks);
  if (!nav || nav.type !== "nav") return "";
  const items = Array.isArray(nav.props.navItems)
    ? nav.props.navItems.map((item) => ({
        pageId: typeof item?.pageId === "string" ? item.pageId : "",
        label: typeof item?.label === "string" ? item.label : "",
      }))
    : [];
  return JSON.stringify(items);
}

const MERCHANT_ONBOARDING_BLOCKS: Block[] = (() => {
  const navBlock = homeBlocks.find((item) => item.type === "nav");
  if (navBlock) return cloneBlocks([navBlock]);
  return [
    {
      id: "b-nav",
      type: "nav",
      props: {
        heading: "页面导航",
        navOrientation: "horizontal",
        navItems: [{ id: "b-nav-item-1", label: "页面1", pageId: "page-1" }],
      },
    },
  ];
})();

function getBlockTypeLabel(type: string) {
  return (BLOCK_TYPE_LABELS as Record<string, string>)[type] ?? type;
}

function toPlainText(value: string | undefined, fallback = "") {
  const source = (value ?? "").trim();
  if (!source) return fallback;
  const noTags = source
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
  return noTags.trim() || fallback;
}

function getThemeCopyKeysForBlockType(type: Block["type"]) {
  if (type === "product") return PRODUCT_THEME_COPY_KEYS;
  if (type === "merchant-list") return MERCHANT_LIST_THEME_COPY_KEYS;
  return [] as const;
}

function pickDefinedProps(
  source: Record<string, unknown> | undefined,
  keys: readonly string[],
): Record<string, unknown> {
  const next: Record<string, unknown> = {};
  if (!source) return next;
  keys.forEach((key) => {
    if (typeof source[key] !== "undefined") {
      next[key] = source[key];
    }
  });
  return next;
}

function buildPageCopyItemIdForBlock(blockId: string): `block:${string}` {
  return `block:${blockId}`;
}

function buildPageCopyBlockLabel(block: Block, index: number) {
  const props = block.props as Record<string, unknown>;
  const summary = [
    toPlainText(typeof props.heading === "string" ? props.heading : "", ""),
    toPlainText(typeof props.title === "string" ? props.title : "", ""),
    toPlainText(typeof props.buttonLabel === "string" ? props.buttonLabel : "", ""),
    toPlainText(typeof props.phone === "string" ? props.phone : "", ""),
    toPlainText(typeof props.address === "string" ? props.address : "", ""),
    toPlainText(typeof props.text === "string" ? props.text : "", ""),
  ]
    .map((item) => item.trim())
    .find(Boolean);
  const clippedSummary =
    summary && summary.length > 22
      ? `${summary.slice(0, 22).trimEnd()}...`
      : summary;
  return `${index + 1}. ${getBlockTypeLabel(block.type)}${clippedSummary ? ` · ${clippedSummary}` : ""}`;
}

function isEditorTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target.closest('[contenteditable="true"]')) return true;
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}

function isEditorToolbarInteractionTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.closest("[data-editor-overlay]")) return true;
  return false;
}

function loadRecentColors(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(RECENT_COLORS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => (typeof item === "string" ? normalizeRecentColorToken(item) : null))
      .filter((item): item is string => !!item)
      .slice(0, MAX_RECENT_COLORS);
  } catch {
    return [];
  }
}

function isInlineDataImageUrl(value: string) {
  return /^data:image\//i.test(value);
}

function ensureSafeImageUrlSize(value: string | undefined) {
  if (!value) return value;
  if (isInlineDataImageUrl(value) && value.length > MAX_ORIGINAL_IMAGE_DATA_URL_LENGTH) {
    throw new Error("图片数据过大，上传较小图片或使用URL");
  }
  return value;
}

function estimateDataUrlBytes(dataUrl: string) {
  const base64 = dataUrl.split(",")[1] ?? "";
  if (!base64) {
    return typeof TextEncoder !== "undefined" ? new TextEncoder().encode(dataUrl).length : dataUrl.length;
  }
  return Math.max(0, Math.floor((base64.length * 3) / 4));
}

async function waitForMs(ms: number) {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, Math.max(0, ms));
  });
}

function formatSupportAttachmentFileSize(bytes: number) {
  const normalized = Number.isFinite(bytes) ? Math.max(0, bytes) : 0;
  if (normalized >= 1024 * 1024) {
    return `${(normalized / (1024 * 1024)).toFixed(normalized >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
  }
  if (normalized >= 1024) {
    return `${Math.max(1, Math.round(normalized / 1024))} KB`;
  }
  return `${normalized} B`;
}

type PageBackgroundPatch = Pick<
  BackgroundEditableProps,
  | "pageBgImageUrl"
  | "pageBgFillMode"
  | "pageBgPosition"
  | "pageBgColor"
  | "pageBgOpacity"
  | "pageBgImageOpacity"
  | "pageBgColorOpacity"
>;
type SaveErrorLike = { message: string; code?: string } | null;
type CenterDialog =
  | {
      type: "alert";
      title: string;
      message: string;
      resolve: () => void;
    }
  | {
      type: "confirm";
      title: string;
      message: string;
      resolve: (confirmed: boolean) => void;
    }
  | {
      type: "compression-preset";
      title: string;
      message: string;
      currentPreset: UploadCompressionPreset;
      resolve: (preset: UploadCompressionPreset | null) => void;
    };
type EditorSnapshot = {
  previewViewport: ViewportKey;
  viewportStates: Record<ViewportKey, ViewportEditorState>;
};
type ViewportEditorState = {
  planConfig: PagePlanConfig;
  editingPlanId: PlanId;
  editingPageId: string;
  blocks: Block[];
  selectedId: string;
};

type GlobalPageRecord = {
  id?: string | number | null;
  blocks?: unknown;
} | null;

let pagesSlugColumnSupported: boolean | null = null;
let pagesMerchantIdColumnSupported: boolean | null = null;
let pagesUpdatedAtColumnSupported: boolean | null = null;

function isMissingSlugColumn(message: string) {
  return (
    /column\s+pages\.slug\s+does\s+not\s+exist/i.test(message) ||
    /could not find the ['"]slug['"] column of ['"]pages['"] in the schema cache/i.test(message)
  );
}

function isMissingUpdatedAtColumn(message: string) {
  return (
    /column\s+pages\.updated_at\s+does\s+not\s+exist/i.test(message) ||
    /could not find the ['"]updated_at['"] column of ['"]pages['"] in the schema cache/i.test(message)
  );
}

function isMissingMerchantIdColumn(message: string) {
  return (
    /column\s+pages\.merchant_id\s+does\s+not\s+exist/i.test(message) ||
    /could not find the ['"]merchant_id['"] column of ['"]pages['"] in the schema cache/i.test(message)
  );
}

function normalizeSaveErrorMessage(message: string) {
  const normalized = message.replace(/^保存失败[:：]\s*/u, "").trim();
  if (/^\?+$/.test(normalized)) {
    return "发布接口返回了不可读错误，请刷新页面后重试；若继续失败，请重新登录后台";
  }
  if (normalized === "publish_backend_request_timeout") {
    return "发布服务连接后端超时，请重试；若连续失败，请检查存储桶和服务端配置";
  }
  if (normalized === "publish_request_deadline_exceeded") {
    return "发布处理超过安全时间，请重试；系统已避免网关超时";
  }
  if (normalized === "publish_request_failed") {
    return "发布服务异常，请稍后重试";
  }
  return normalized;
}

function normalizePublishApiErrorMessage(code: string, message: string, status: number) {
  const normalized = String(message ?? "").trim();
  const hasReadableMessage = normalized.length > 0 && !/^\?+$/.test(normalized);
  if (code === "unauthorized") {
    return hasReadableMessage ? normalized : "发布未授权，请重新登录后台后再发布";
  }
  if (code === "invalid_merchant_scope") {
    return hasReadableMessage ? normalized : "发布缺少有效商户站点，请重新进入后台后再发布";
  }
  if (hasReadableMessage) return normalized;
  if (code) return `发布接口错误（${code}）`;
  return `发布接口错误（HTTP ${status}）`;
}

async function queryGlobalPageRecord(columns: string): Promise<{ record: GlobalPageRecord; error: SaveErrorLike }> {
  if (pagesSlugColumnSupported !== false && pagesMerchantIdColumnSupported !== false) {
    const scopedBySlug = await supabase
      .from("pages")
      .select(columns)
      .is("merchant_id", null)
      .eq("slug", "home")
      .limit(1)
      .maybeSingle();
    if (!scopedBySlug.error) {
      pagesSlugColumnSupported = true;
      pagesMerchantIdColumnSupported = true;
      return {
        record: (scopedBySlug.data ?? null) as GlobalPageRecord,
        error: null,
      };
    }
    if (isMissingMerchantIdColumn(scopedBySlug.error.message)) {
      pagesMerchantIdColumnSupported = false;
    } else if (isMissingSlugColumn(scopedBySlug.error.message)) {
      pagesSlugColumnSupported = false;
    } else {
      return { record: null, error: scopedBySlug.error };
    }
  }

  if (pagesSlugColumnSupported !== false) {
    const bySlug = await supabase.from("pages").select(columns).eq("slug", "home").limit(1).maybeSingle();
    if (!bySlug.error) {
      pagesSlugColumnSupported = true;
      return {
        record: (bySlug.data ?? null) as GlobalPageRecord,
        error: null,
      };
    }
    if (isMissingSlugColumn(bySlug.error.message)) {
      pagesSlugColumnSupported = false;
    } else {
      return { record: null, error: bySlug.error };
    }
  }

  if (pagesMerchantIdColumnSupported !== false) {
    const byMerchantId = await supabase.from("pages").select(columns).is("merchant_id", null).limit(1).maybeSingle();
    if (!byMerchantId.error) {
      pagesMerchantIdColumnSupported = true;
      return {
        record: (byMerchantId.data ?? null) as GlobalPageRecord,
        error: null,
      };
    }
    if (isMissingMerchantIdColumn(byMerchantId.error.message)) {
      pagesMerchantIdColumnSupported = false;
    } else {
      return { record: null, error: byMerchantId.error };
    }
  }

  const fallback = await supabase.from("pages").select(columns).limit(1).maybeSingle();
  if (fallback.error) {
    return { record: null, error: fallback.error };
  }
  return {
    record: (fallback.data ?? null) as GlobalPageRecord,
    error: null,
  };
}

function readBlocksStoreScopeFromLocation(forcedScope?: string) {
  const trimmedForced = (forcedScope ?? "").trim();
  if (trimmedForced) return trimmedForced;
  return "default";
}

function getSiteIdFromStoreScope(scope: string) {
  const normalized = (scope ?? "").trim();
  if (!normalized.startsWith("site-")) return "";
  return normalized.slice("site-".length).trim();
}

function mergePreferredMerchantIds(primaryIds: string[], ...otherIdGroups: Array<string[] | undefined>) {
  const next: string[] = [];
  const push = (value: string) => {
    const trimmed = (value ?? "").trim();
    if (!trimmed) return;
    if (!next.includes(trimmed)) next.push(trimmed);
  };
  primaryIds.forEach(push);
  otherIdGroups.forEach((group) => (group ?? []).forEach(push));
  return next;
}

function normalizeDomainPrefixForMerchant(value: string) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/^\/+|\/+$/g, "")
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9_-]/g, "");
}

function normalizeBaseDomainForMerchant(value: string) {
  const normalized = String(value ?? "")
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/g, "");
  return (normalized.split("/")[0] ?? "").trim();
}

function buildMerchantDomainFromBase(baseDomain: string, prefix: string) {
  const normalizedBase = normalizeBaseDomainForMerchant(baseDomain);
  const normalizedPrefix = normalizeDomainPrefixForMerchant(prefix);
  if (!normalizedPrefix) return normalizedBase;
  const subdomainDomain = buildMerchantDomain(baseDomain, normalizedPrefix)?.replace(/^https?:\/\//i, "") ?? "";
  if (subdomainDomain) return subdomainDomain;
  if (!normalizedBase) return normalizedPrefix;
  return `${normalizedBase}/${normalizedPrefix}`;
}

type ScopedMerchantSitePatch = {
  merchantName?: string | null;
  signature?: string | null;
  domainPrefix?: string | null;
  contactEmail?: string | null;
  name?: string | null;
  status?: Site["status"] | null;
  serviceExpiresAt?: string | null;
};

function ensureScopedMerchantSite(siteId: string, userEmail?: string | null, patch?: ScopedMerchantSitePatch) {
  const normalizedSiteId = String(siteId ?? "").trim();
  if (!normalizedSiteId) return null;
  const state = loadPlatformState();
  const current = new Date().toISOString();
  const mainSite = state.sites.find((item) => item.id === "site-main") ?? state.sites[0] ?? null;
  const tenantId = mainSite?.tenantId ?? state.tenants[0]?.id ?? "tenant-demo";
  const baseDomain =
    normalizeBaseDomainForMerchant(resolveRuntimePortalBaseDomain(process.env.NEXT_PUBLIC_PORTAL_BASE_DOMAIN ?? "")) ||
    normalizeBaseDomainForMerchant(mainSite?.domain ?? "") ||
    "localhost:3000";
  const normalizedMerchantName = String(patch?.merchantName ?? "").trim();
  const hasSignaturePatch = Boolean(patch && Object.prototype.hasOwnProperty.call(patch, "signature"));
  const normalizedSignature = String(patch?.signature ?? "").trim();
  const normalizedDomainPrefix = normalizeDomainPrefixForMerchant(patch?.domainPrefix ?? "");
  const normalizedContactEmail =
    String(patch?.contactEmail ?? userEmail ?? "")
      .trim()
      .toLowerCase();
  const normalizedName = String(patch?.name ?? "").trim();
  const normalizedStatus =
    patch && Object.prototype.hasOwnProperty.call(patch, "status") && typeof patch.status === "string"
      ? patch.status
      : null;
  const hasServiceExpiresAtPatch = Boolean(patch && Object.prototype.hasOwnProperty.call(patch, "serviceExpiresAt"));
  const nextPatchedServiceExpiresAt = hasServiceExpiresAtPatch ? patch?.serviceExpiresAt ?? null : undefined;
  const applyPatch = (site: Site): Site => {
    const nextMerchantName = normalizedMerchantName || String(site.merchantName ?? "").trim();
    const nextSignature = hasSignaturePatch ? normalizedSignature : String(site.signature ?? "").trim();
    const nextDomainPrefix = normalizedDomainPrefix || normalizeDomainPrefixForMerchant(site.domainPrefix ?? site.domainSuffix ?? "");
    const nextContactEmail = normalizedContactEmail || String(site.contactEmail ?? "").trim().toLowerCase();
    const nextName = normalizedName || nextMerchantName || String(site.name ?? "").trim() || `商户 ${normalizedSiteId}`;
    const nextStatus = normalizedStatus ?? site.status;
    const nextDomain =
      nextDomainPrefix
        ? buildMerchantDomainFromBase(baseDomain, nextDomainPrefix)
        : String(site.domain ?? "").trim() || buildMerchantDomainFromBase(baseDomain, normalizedSiteId);
    const nextServiceExpiresAt = hasServiceExpiresAtPatch ? nextPatchedServiceExpiresAt ?? null : site.serviceExpiresAt;
    const changed =
      nextMerchantName !== String(site.merchantName ?? "").trim() ||
      nextSignature !== String(site.signature ?? "").trim() ||
      nextDomainPrefix !== normalizeDomainPrefixForMerchant(site.domainPrefix ?? site.domainSuffix ?? "") ||
      nextContactEmail !== String(site.contactEmail ?? "").trim().toLowerCase() ||
      nextName !== String(site.name ?? "").trim() ||
      nextDomain !== String(site.domain ?? "").trim() ||
      nextStatus !== site.status ||
      nextServiceExpiresAt !== site.serviceExpiresAt;
    return {
      ...site,
      merchantName: nextMerchantName,
      signature: nextSignature,
      domainPrefix: nextDomainPrefix,
      domainSuffix: nextDomainPrefix,
      contactEmail: nextContactEmail,
      name: nextName,
      domain: nextDomain,
      status: nextStatus,
      serviceExpiresAt: nextServiceExpiresAt,
      updatedAt: changed ? current : site.updatedAt,
    };
  };
  const exactIndex = state.sites.findIndex((item) => item.id === normalizedSiteId);
  if (exactIndex >= 0) {
    const existed = state.sites[exactIndex];
    const nextSite = applyPatch(existed);
    if (JSON.stringify(nextSite) !== JSON.stringify(existed)) {
      const nextSites = [...state.sites];
      nextSites[exactIndex] = nextSite;
      savePlatformState({
        ...state,
        sites: nextSites,
      });
    }
    return nextSite;
  }
  const matchedSite = buildMerchantSiteLinker(state.sites, state.users)({
    merchantId: normalizedSiteId,
    email: userEmail,
  });
  if (matchedSite && matchedSite.id === normalizedSiteId) {
    return applyPatch(matchedSite);
  }
  const nextSite: Site = {
    id: normalizedSiteId,
    tenantId,
    merchantName: normalizedMerchantName,
    signature: hasSignaturePatch ? normalizedSignature : "",
    domainPrefix: normalizedDomainPrefix,
    domainSuffix: normalizedDomainPrefix,
    contactAddress: "",
    contactName: "",
    contactPhone: "",
    contactEmail: normalizedContactEmail,
    name: normalizedName || normalizedMerchantName || `商户 ${normalizedSiteId}`,
    domain: buildMerchantDomainFromBase(baseDomain, normalizedDomainPrefix || normalizedSiteId),
    categoryId: mainSite?.categoryId ?? "",
    category: mainSite?.category ?? "商户",
    industry: "",
    status: "online" as const,
    publishedVersion: 1,
    lastPublishedAt: null,
    features: mainSite?.features ?? createFeaturePackage("basic"),
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
    createdAt: current,
    updatedAt: current,
  };

  savePlatformState({
    ...state,
    sites: [...state.sites, nextSite],
  });

  return nextSite;
}

function discoverSiteScopesFromLocalStorage() {
  if (typeof window === "undefined") return [] as string[];
  const prefixes = [
    "merchant-space:homeBlocks:draft:v2:",
    "merchant-space:homeBlocks:published:v1:",
    "merchant-space:homeBlocks:published-history:v1:",
  ];
  const scopes = new Set<string>();
  for (let i = 0; i < window.localStorage.length; i += 1) {
    const key = window.localStorage.key(i) ?? "";
    const prefix = prefixes.find((item) => key.startsWith(item));
    if (!prefix) continue;
    const scope = key.slice(prefix.length).trim();
    if (!scope || scope === "default") continue;
    if (!scope.startsWith("site-")) continue;
    scopes.add(scope);
  }
  return Array.from(scopes);
}

type MerchantProfileLike = {
  merchantName?: string;
  domainPrefix?: string;
  domainSuffix?: string;
  contactAddress?: string;
  contactName?: string;
  contactPhone?: string;
  contactEmail?: string;
  industry?: string;
  location?: {
    countryCode?: string;
    country?: string;
    province?: string;
    city?: string;
  };
};

function getMissingMerchantProfileFields(site: MerchantProfileLike | null | undefined) {
  const missing: string[] = [];
  if (!site) return ["商户站点"];
  const merchantName = (site.merchantName ?? "").trim();
  const domainPrefix = (site.domainPrefix ?? site.domainSuffix ?? "").trim();
  const countryCode = (site.location?.countryCode ?? "").trim();
  const country = (site.location?.country ?? "").trim();
  const province = (site.location?.province ?? "").trim();
  const city = (site.location?.city ?? "").trim();
  const industry = (site.industry ?? "").trim();

  if (!merchantName) missing.push("商户名称");
  if (!domainPrefix) missing.push("域名前缀");
  if (!countryCode || !country) missing.push("国家");
  if (!province) missing.push("省份");
  if (!city) missing.push("城市");
  if (!MERCHANT_INDUSTRY_OPTIONS.some((item) => item === industry)) {
    missing.push("行业");
  }
  return missing;
}

export type AdminClientProps = {
  forcedScope?: string;
  editorTitle?: string;
  frontendHref?: string;
  editorMode?: "merchant" | "platform";
  forceDesktopEditorSidebar?: boolean;
  showPublishActions?: boolean;
  initialPublishedBlocks?: Block[];
  initialJustSignedIn?: boolean;
  startInLoadingState?: boolean;
};

function estimateUtf8Size(value: string) {
  return new TextEncoder().encode(value).length;
}

function formatBytes(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)}MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${bytes}B`;
}

function getMerchantDesktopMenuButtonClassName(active: boolean, tone: "default" | "alert" = "default") {
  if (active) {
    return tone === "alert"
      ? "relative flex h-10 items-center justify-between gap-2 rounded-lg border-0 bg-[#1f2f55] px-3 text-sm font-semibold text-white shadow-[inset_3px_0_0_#93c5fd,0_1px_0_rgba(255,255,255,0.04)]"
      : "relative flex h-10 items-center justify-between gap-2 rounded-lg border-0 bg-[#1f2f55] px-3 text-sm font-semibold text-white shadow-[inset_3px_0_0_#93c5fd,0_1px_0_rgba(255,255,255,0.04)]";
  }
  return tone === "alert"
    ? "relative flex h-10 items-center justify-between gap-2 rounded-lg border-0 bg-transparent px-3 text-sm font-semibold text-[#dbeafe] transition hover:bg-[#17233f] hover:text-white"
    : "relative flex h-10 items-center justify-between gap-2 rounded-lg border-0 bg-transparent px-3 text-sm font-semibold text-[#dbeafe] transition hover:bg-[#17233f] hover:text-white";
}

function getMerchantDesktopSubmenuButtonClassName(active: boolean, tone: "default" | "cyan" | "rose" | "emerald" | "amber" = "default") {
  if (active) return "flex h-10 w-full items-center justify-between gap-2 rounded-lg border-0 bg-[#1f2f55] px-3 text-left text-sm font-semibold text-white shadow-[inset_3px_0_0_#93c5fd,0_1px_0_rgba(255,255,255,0.04)] transition";
  const toneClassName =
    tone === "cyan"
      ? "hover:bg-[#17233f] hover:text-cyan-50"
      : tone === "rose"
        ? "hover:bg-[#17233f] hover:text-rose-50"
        : tone === "emerald"
          ? "hover:bg-[#17233f] hover:text-emerald-50"
          : tone === "amber"
            ? "hover:bg-[#17233f] hover:text-amber-50"
            : "hover:bg-[#17233f] hover:text-white";
  return `flex h-10 w-full items-center justify-between gap-2 rounded-lg border-0 bg-transparent px-3 text-left text-sm font-semibold text-[#dbeafe] transition ${toneClassName}`;
}

function MerchantDesktopMenuIcon({ name }: { name: "points" | "booking" | "orders" | "enterprise" | "support" | "members" | "coupons" | "business" }) {
  const commonProps = {
    className: "h-[18px] w-[18px] shrink-0",
    fill: "none",
    stroke: "currentColor",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeWidth: 2,
    viewBox: "0 0 24 24",
    "aria-hidden": true,
  };

  if (name === "points") {
    return (
      <svg {...commonProps}>
        <path d="M12 3 4 7l8 4 8-4-8-4Z" />
        <path d="M4 12l8 4 8-4" />
        <path d="M4 17l8 4 8-4" />
      </svg>
    );
  }
  if (name === "booking") {
    return (
      <svg {...commonProps}>
        <path d="M8 2v4M16 2v4M4 9h16" />
        <path d="M5 5h14a1 1 0 0 1 1 1v16H4V6a1 1 0 0 1 1-1Z" />
      </svg>
    );
  }
  if (name === "orders") {
    return (
      <svg {...commonProps}>
        <path d="M7 3h10l2 3v18l-2-1-2 1-2-1-2 1-2-1-2 1V3Z" />
        <path d="M9 9h6M9 13h6M9 17h4" />
      </svg>
    );
  }
  if (name === "enterprise") {
    return (
      <svg {...commonProps}>
        <path d="M4 21V8l8-4 8 4v13" />
        <path d="M8 21v-5h8v5M8 10h.01M12 10h.01M16 10h.01M8 13h.01M12 13h.01M16 13h.01" />
      </svg>
    );
  }
  if (name === "support") {
    return (
      <svg {...commonProps}>
        <path d="M21 15a4 4 0 0 1-4 4H9l-5 3v-7a4 4 0 0 1 4-4h9a4 4 0 0 1 4 4Z" />
        <path d="M8 7a4 4 0 0 1 4-4h1a4 4 0 0 1 4 4" />
      </svg>
    );
  }
  if (name === "members") {
    return (
      <svg {...commonProps}>
        <path d="M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2" />
        <path d="M9.5 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" />
        <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    );
  }
  if (name === "coupons") {
    return (
      <svg {...commonProps}>
        <path d="M4 8.5V6a2 2 0 0 1 2-2h16v5a3 3 0 0 0 0 6v5H6a2 2 0 0 1-2-2v-2.5a3 3 0 0 0 0-7Z" />
        <path d="M9 8h6M9 12h4M17 7v10" />
      </svg>
    );
  }
  return (
    <svg {...commonProps}>
      <path d="M3 21h18" />
      <path d="M5 21V7l8-4v18" />
      <path d="M19 21V11l-6-4" />
      <path d="M9 9h1M9 13h1M9 17h1M15 13h1M15 17h1" />
    </svg>
  );
}

type PublishEventInput = {
  success: boolean;
  bytes: number;
  changedBlocks: number;
  reason?: string;
};

function recordPublishEvent(input: PublishEventInput) {
  void import("@/lib/analytics")
    .then(({ trackPublishEvent }) => {
      trackPublishEvent(input);
    })
    .catch(() => {
      // Analytics must never block publishing.
    });
}

type MerchantOperationFetchInfo = {
  siteId: string;
  method: string;
  endpoint: string;
  module: string;
  action: string;
  summary: string;
};

type MerchantAssetUploadOperationContext = MerchantOperationContext;

function normalizeOperationField(value: unknown, maxLength = 120) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function readMerchantOperationBody(init?: RequestInit): Record<string, unknown> | null {
  const body = init?.body;
  if (!body) return null;
  if (typeof body === "string") {
    const trimmed = body.trim();
    if (!trimmed || (!trimmed.startsWith("{") && !trimmed.startsWith("["))) return null;
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
  if (typeof URLSearchParams !== "undefined" && body instanceof URLSearchParams) {
    return Object.fromEntries(body.entries());
  }
  if (typeof FormData !== "undefined" && body instanceof FormData) {
    const record: Record<string, unknown> = {};
    body.forEach((value, key) => {
      if (typeof value === "string") record[key] = value;
    });
    return record;
  }
  return null;
}

function getMerchantOperationUrl(input: RequestInfo | URL) {
  if (typeof window === "undefined") return null;
  try {
    const rawUrl = input instanceof Request ? input.url : input instanceof URL ? input.toString() : String(input);
    return new URL(rawUrl, window.location.origin);
  } catch {
    return null;
  }
}

function getMerchantOperationMethod(input: RequestInfo | URL, init?: RequestInit) {
  const method = normalizeOperationField(init?.method || (input instanceof Request ? input.method : "GET"), 16).toUpperCase();
  return method || "GET";
}

function getMerchantOperationBodyText(body: Record<string, unknown> | null, keys: string[]) {
  if (!body) return "";
  for (const key of keys) {
    const value = body[key];
    const text = normalizeOperationField(value, 80);
    if (text) return text;
  }
  return "";
}

function resolveMerchantOperationSiteId(url: URL, body: Record<string, unknown> | null, fallbackSiteId: string) {
  const direct = getMerchantOperationBodyText(body, ["siteId", "merchantId"]);
  if (direct) return direct;
  const querySiteId = normalizeOperationField(url.searchParams.get("siteId"), 80);
  if (querySiteId) return querySiteId;
  const merchantIds = body?.merchantIds;
  if (Array.isArray(merchantIds)) {
    const first = merchantIds.map((item) => normalizeOperationField(item, 80)).find(Boolean);
    if (first) return first;
  }
  return normalizeOperationField(fallbackSiteId, 80);
}

function formatMerchantOperationTarget(body: Record<string, unknown> | null) {
  const target = getMerchantOperationBodyText(body, [
    "title",
    "name",
    "couponTitle",
    "couponId",
    "orderId",
    "bookingId",
    "membershipId",
    "memberId",
    "rechargePlanId",
    "redemptionItemId",
    "itemId",
    "categoryId",
    "cardId",
    "id",
  ]);
  return target ? `：${target}` : "";
}

function readExplicitMerchantOperationContext(
  body: Record<string, unknown> | null,
) {
  const currentContext = readCurrentMerchantOperationContext();
  const moduleName =
    normalizeOperationField(currentContext?.operationModule, 120) ||
    getMerchantOperationBodyText(body, ["operationModule", "operationMenu"]);
  const action =
    normalizeOperationField(currentContext?.operationAction, 120) ||
    getMerchantOperationBodyText(body, ["operationAction"]);
  const summary =
    normalizeOperationField(currentContext?.operationSummary, 240) ||
    normalizeOperationField(body?.operationSummary, 240) ||
    normalizeOperationField(body?.operationDescription, 240);
  if (!moduleName && !action && !summary) return null;
  return {
    module: moduleName || "后台",
    action: action || "操作",
    summary: summary || `${action || "操作"}${moduleName ? `（${moduleName}）` : ""}`,
  };
}

function resolveAssetUploadOperationContext(body: Record<string, unknown> | null) {
  const usage = getMerchantOperationBodyText(body, ["usage"]);
  const folder = getMerchantOperationBodyText(body, ["folder"]);
  if (usage === "common-block-image") {
    return {
      module: "网站编辑 > 区块编辑",
      action: "上传通用区块图片",
      summary: "在网站编辑 > 区块编辑上传通用区块图片",
    };
  }
  if (usage === "gallery-block-image") {
    return {
      module: "网站编辑 > 相册区块",
      action: "上传相册图片",
      summary: "在网站编辑 > 相册区块上传图片",
    };
  }
  if (usage === "business-card-background") {
    return {
      module: "经营中心 > 名片夹",
      action: "上传名片底图",
      summary: "在经营中心 > 名片夹上传名片底图",
    };
  }
  if (usage === "business-card-contact") {
    return {
      module: "经营中心 > 名片夹",
      action: "上传联系卡图片",
      summary: "在经营中心 > 名片夹上传联系卡图片",
    };
  }
  if (usage === "business-card-export") {
    return null;
  }
  if (usage === "business-card-intro-video") {
    return {
      module: "经营中心 > 名片夹",
      action: "上传联系卡开场视频",
      summary: "在经营中心 > 名片夹上传联系卡开场视频",
    };
  }
  if (usage === "support-image") {
    return {
      module: "会话",
      action: "上传会话图片",
      summary: "在会话中上传图片附件",
    };
  }
  if (usage === "support-file" || folder === "merchant-files") {
    return {
      module: "会话",
      action: "上传会话文件",
      summary: "在会话中上传文件附件",
    };
  }
  if (usage === "audio" || folder === "merchant-audio") {
    return {
      module: "网站编辑 > 音频素材",
      action: "上传音频",
      summary: "在网站编辑上传音频素材",
    };
  }
  return {
    module: "网站编辑 > 素材",
    action: folder === "merchant-files" ? "上传文件" : "上传图片",
    summary: folder === "merchant-files" ? "在网站编辑上传文件素材" : "在网站编辑上传图片素材",
  };
}

function resolveMerchantOrderActionLabel(action: string, status: string) {
  if (status) return `更新订单状态为 ${status}`;
  if (action === "confirm") return "确认订单";
  if (action === "cancel") return "取消订单";
  if (action === "complete") return "完成订单";
  if (action === "unconfirm") return "取消确认订单";
  return "更新订单";
}

function resolveMerchantBookingActionLabel(action: string, status: string) {
  if (status) return `更新预约状态为 ${status}`;
  if (action === "confirm") return "确认预约";
  if (action === "cancel") return "取消预约";
  if (action === "complete") return "完成预约";
  if (action === "hide") return "隐藏预约";
  if (action === "unhide") return "取消隐藏预约";
  return "更新预约";
}

function isMerchantChatOperationEndpoint(endpoint: string) {
  return (
    endpoint === "/api/merchant-chat-business-card" ||
    endpoint === "/api/merchant-peer-messages" ||
    endpoint === "/api/support-messages"
  );
}

function resolveGenericMerchantOperationModule(endpoint: string) {
  if (endpoint.includes("booking")) return "预约管理";
  if (endpoint.includes("order")) return "订单管理";
  if (endpoint.includes("membership") || endpoint.includes("member")) return "会员管理";
  if (endpoint.includes("coupon")) return "优惠券";
  if (endpoint.includes("business-card")) return "经营中心";
  if (endpoint.includes("merchant-draft") || endpoint.includes("publish") || endpoint.includes("site-published")) return "网站编辑";
  if (endpoint.includes("domain") || endpoint.includes("profile")) return "商户信息";
  if (endpoint.includes("assets") || endpoint.includes("upload")) return "素材";
  return "后台";
}

function resolveGenericMerchantOperationAction(method: string, actionText: string) {
  if (actionText) return actionText;
  if (method === "POST") return "提交";
  if (method === "PATCH" || method === "PUT") return "更新";
  if (method === "DELETE") return "删除";
  return "操作";
}

function buildMerchantOperationFetchInfo(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  fallbackSiteId: string,
): MerchantOperationFetchInfo | null {
  const method = getMerchantOperationMethod(input, init);
  if (!["POST", "PATCH", "PUT", "DELETE"].includes(method)) return null;
  const url = getMerchantOperationUrl(input);
  if (!url) return null;
  const endpoint = url.pathname;
  if (!endpoint.startsWith("/api/") || endpoint.startsWith("/api/auth/") || endpoint.startsWith("/api/supabase-proxy/")) {
    return null;
  }
  if (endpoint === "/api/merchant-operation-logs") return null;
  if (isMerchantChatOperationEndpoint(endpoint)) return null;
  if (readCurrentMerchantOperationContext()?.skipOperationLog === true) return null;
  const body = readMerchantOperationBody(init);
  const siteId = resolveMerchantOperationSiteId(url, body, fallbackSiteId);
  if (!siteId) return null;
  const target = formatMerchantOperationTarget(body);
  const actionText = normalizeOperationField(body?.action, 80);
  const statusText = normalizeOperationField(body?.status, 80);
  const typeText = normalizeOperationField(body?.type, 80);
  const explicitContext = readExplicitMerchantOperationContext(body);
  if (explicitContext) {
    return {
      siteId,
      method,
      endpoint,
      module: explicitContext.module,
      action: explicitContext.action,
      summary: explicitContext.summary,
    };
  }

  if (endpoint === "/api/publish") {
    return { siteId, method, endpoint, module: "网站编辑", action: "发布", summary: "发布网站" };
  }
  if (endpoint === "/api/merchant-draft") {
    return { siteId, method, endpoint, module: "网站编辑", action: "保存草稿", summary: "保存网站草稿" };
  }
  if (endpoint === "/api/merchant-domain-binding") {
    return { siteId, method, endpoint, module: "商户信息", action: "域名绑定", summary: "更新域名绑定" };
  }
  if (endpoint === "/api/membership-settings") {
    return { siteId, method, endpoint, module: "会员管理", action: "保存配置", summary: "保存会员配置" };
  }
  if (endpoint === "/api/memberships") {
    if (actionText === "member_redemption_checkout") {
      return { siteId, method, endpoint, module: "积分兑换", action: "结算", summary: `积分兑换结算${target}` };
    }
    if (actionText === "member_operation") {
      const action = typeText === "recharge" ? "充值" : "积分调整";
      return { siteId, method, endpoint, module: "会员管理", action, summary: `会员${action}${target}` };
    }
    if (actionText === "update_allergens") {
      return { siteId, method, endpoint, module: "会员管理", action: "更新过敏信息", summary: `更新会员过敏信息${target}` };
    }
    if (actionText === "checkin") {
      return { siteId, method, endpoint, module: "会员管理", action: "签到", summary: `会员签到${target}` };
    }
    return { siteId, method, endpoint, module: "会员管理", action: method === "POST" ? "新增会员" : "更新会员", summary: `${method === "POST" ? "新增" : "更新"}会员${target}` };
  }
  if (endpoint === "/api/coupons") {
    const action = method === "POST" ? "新建优惠券" : method === "DELETE" ? "归档优惠券" : statusText ? "更新优惠券状态" : "更新优惠券";
    return { siteId, method, endpoint, module: "优惠券", action, summary: `${action}${target}` };
  }
  if (endpoint === "/api/orders") {
    const action = method === "POST" ? "创建订单" : resolveMerchantOrderActionLabel(actionText, statusText);
    return { siteId, method, endpoint, module: "订单管理", action, summary: `${action}${target}` };
  }
  if (endpoint === "/api/bookings") {
    const action = method === "POST" ? "创建预约" : resolveMerchantBookingActionLabel(actionText, statusText);
    return { siteId, method, endpoint, module: "预约管理", action, summary: `${action}${target}` };
  }
  if (endpoint === "/api/bookings/workbench") {
    return { siteId, method, endpoint, module: "预约管理", action: "更新工作台", summary: "更新预约工作台" };
  }
  if (endpoint === "/api/business-card-share") return null;
  if (endpoint === "/api/assets/upload") {
    const assetContext = resolveAssetUploadOperationContext(body);
    return assetContext ? { siteId, method, endpoint, ...assetContext } : null;
  }
  const genericModule = resolveGenericMerchantOperationModule(endpoint);
  const genericAction = resolveGenericMerchantOperationAction(method, actionText);
  return {
    siteId,
    method,
    endpoint,
    module: genericModule,
    action: genericAction,
    summary: `${genericAction}${target || `：${endpoint}`}`,
  };
}

function readMerchantOperationResponseMessage(payload: unknown) {
  if (!payload || typeof payload !== "object") return "";
  const record = payload as Record<string, unknown>;
  return (
    normalizeOperationField(record.message, 160) ||
    normalizeOperationField(record.error, 160) ||
    normalizeOperationField(record.code, 160)
  );
}

function recordMerchantOperationFetchResult(info: MerchantOperationFetchInfo, status: MerchantOperationLogStatus, detail?: string) {
  recordMerchantOperationLog({
    siteId: info.siteId,
    module: info.module,
    action: info.action,
    summary: info.summary,
    status,
    method: info.method,
    endpoint: info.endpoint,
    detail,
  });
}

function buildMerchantIdsCacheIdentity(sessionUserId?: string, email?: string) {
  return `${(sessionUserId ?? "").trim()}::${(email ?? "").trim().toLowerCase()}`;
}

function readCachedMerchantIds(sessionUserId?: string, email?: string) {
  if (typeof window === "undefined") return [];
  const identity = buildMerchantIdsCacheIdentity(sessionUserId, email);
  if (!identity.replaceAll(":", "").trim()) return [];
  try {
    const raw = sessionStorage.getItem(MERCHANT_IDS_CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return [];
    const record = parsed as { identity?: unknown; ids?: unknown; at?: unknown };
    if (record.identity !== identity) return [];
    if (typeof record.at !== "number" || !Number.isFinite(record.at)) return [];
    if (Date.now() - record.at > MERCHANT_IDS_CACHE_TTL_MS) return [];
    if (!Array.isArray(record.ids)) return [];
    return record.ids
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function writeCachedMerchantIds(sessionUserId: string | undefined, email: string | undefined, ids: string[]) {
  if (typeof window === "undefined") return;
  const identity = buildMerchantIdsCacheIdentity(sessionUserId, email);
  if (!identity.replaceAll(":", "").trim()) return;
  const normalized = [...new Set(ids.map((item) => item.trim()).filter(Boolean))];
  if (normalized.length === 0) return;
  try {
    sessionStorage.setItem(
      MERCHANT_IDS_CACHE_KEY,
      JSON.stringify({
        identity,
        ids: normalized,
        at: Date.now(),
      }),
    );
  } catch {
    // ignore cache write failures
  }
}

function readMerchantIdsFromMetadata(...records: Array<Record<string, unknown> | null | undefined>) {
  const ids: string[] = [];
  const pushId = (value: unknown) => {
    if (typeof value !== "string") return;
    const trimmed = value.trim();
    if (!trimmed || ids.includes(trimmed)) return;
    ids.push(trimmed);
  };

  records.forEach((record) => {
    if (!record || typeof record !== "object") return;
    pushId(record.merchant_id);
    pushId(record.merchantId);
    pushId(record.merchantID);
    pushId(record.store_id);
    pushId(record.storeId);
    pushId(record.shop_id);
    pushId(record.shopId);
  });

  return ids;
}

async function resolveMerchantIds(sessionUserId?: string, email?: string, metadata?: Record<string, unknown>): Promise<string[]> {
  const ids: string[] = [];
  const cachedIds = readCachedMerchantIds(sessionUserId, email);
  const pushId = (value: unknown) => {
    if (typeof value !== "string") return;
    const trimmed = value.trim();
    if (!trimmed) return;
    if (!ids.includes(trimmed)) ids.push(trimmed);
  };

  const metadataRecord = metadata ?? {};
  readMerchantIdsFromMetadata(metadataRecord).forEach(pushId);
  cachedIds.forEach(pushId);

  try {
    const payload = await readMerchantSessionPayload(2600).catch(() => null);
    const expectedUserId = String(sessionUserId ?? "").trim();
    const expectedEmail = String(email ?? "").trim().toLowerCase();
    const payloadUserId = typeof payload?.user?.id === "string" ? payload.user.id.trim() : "";
    const payloadEmail = typeof payload?.user?.email === "string" ? payload.user.email.trim().toLowerCase() : "";
    const payloadMatchesCurrentUser =
      payload?.authenticated === true &&
      (!expectedUserId || !payloadUserId || payloadUserId === expectedUserId) &&
      (!expectedEmail || !payloadEmail || payloadEmail === expectedEmail);
    if (payloadMatchesCurrentUser) {
      readMerchantSessionMerchantIds(payload).forEach(pushId);
    }
  } catch {
    // Keep cached + metadata ids when server-backed identity read fails.
  }

  if (!sessionUserId) {
    return ids;
  }

  const numericIds = ids.filter((item) => isMerchantNumericId(item)).sort((a, b) => Number(a) - Number(b));
  const legacyIds = ids.filter((item) => !isMerchantNumericId(item));
  const merged = [...numericIds, ...legacyIds];
  writeCachedMerchantIds(sessionUserId, email, merged);
  return merged;
}

async function loadBlocksFromSupabaseFallback(merchantIds: string[]) {
  const queryOneMerchant = async (merchantId: string) => {
    const byMerchantWithSlug = await supabase
      .from("pages")
      .select("blocks")
      .eq("merchant_id", merchantId)
      .eq("slug", "home")
      .limit(1)
      .maybeSingle();
    if (!byMerchantWithSlug.error && Array.isArray(byMerchantWithSlug.data?.blocks)) {
      const sanitized = sanitizeBlocksForRuntime(byMerchantWithSlug.data.blocks as Block[]).blocks;
      if (sanitized.length > 0) return sanitized;
    }

    const byMerchant = await supabase.from("pages").select("blocks").eq("merchant_id", merchantId).limit(1).maybeSingle();
    if (!byMerchant.error && Array.isArray(byMerchant.data?.blocks)) {
      const sanitized = sanitizeBlocksForRuntime(byMerchant.data.blocks as Block[]).blocks;
      if (sanitized.length > 0) return sanitized;
      return null;
    }
    if (!byMerchantWithSlug.error || !isMissingSlugColumn(byMerchantWithSlug.error.message)) return null;
    return null;
  };

  const uniqueMerchantIds = [...new Set(merchantIds.map((item) => item.trim()).filter(Boolean))].slice(0, 8);
  if (uniqueMerchantIds.length > 0) {
    const settled = await Promise.allSettled(uniqueMerchantIds.map((merchantId) => queryOneMerchant(merchantId)));
    for (const result of settled) {
      if (result.status === "fulfilled" && Array.isArray(result.value) && result.value.length > 0) {
        return result.value;
      }
    }
  }

  return null;
}

async function loadBlocksViaRestFallback(merchantIds: string[], accessToken?: string | null) {
  if (!accessToken) return null;
  const baseUrl = getResolvedSupabaseUrl().trim().replace(/\/+$/, "");
  if (!baseUrl) return null;
  const uniqueMerchantIds = [...new Set(merchantIds.map((item) => item.trim()).filter(Boolean))].slice(0, 8);
  if (uniqueMerchantIds.length > 0) {
    const tasks = uniqueMerchantIds.map(async (merchantId) => {
      const queryOne = async (slug?: string) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 12000);
        try {
          const query = new URLSearchParams({
            select: "blocks",
            merchant_id: `eq.${merchantId}`,
            limit: "1",
          });
          if (slug) query.set("slug", `eq.${slug}`);
          const response = await fetch(`${baseUrl}/rest/v1/pages?${query.toString()}`, {
            method: "GET",
            headers: {
              apikey: resolvedSupabaseAnonKey,
              Authorization: `Bearer ${accessToken}`,
            },
            cache: "no-store",
            signal: controller.signal,
          });
          if (!response.ok) return null;
          const json = (await response.json()) as unknown;
          if (!Array.isArray(json)) return null;
          const first = json[0] as { blocks?: unknown } | undefined;
          if (!first || !Array.isArray(first.blocks)) return null;
          const sanitized = sanitizeBlocksForRuntime(first.blocks as Block[]).blocks;
          return sanitized.length > 0 ? sanitized : null;
        } catch {
          return null;
        } finally {
          clearTimeout(timer);
        }
      };

      const byHome = await queryOne("home");
      if (byHome) return byHome;
      return queryOne();
    });
    const settled = await Promise.allSettled(tasks);
    for (const result of settled) {
      if (result.status === "fulfilled" && Array.isArray(result.value) && result.value.length > 0) {
        return result.value;
      }
    }
  }

  return null;
}

async function loadPlatformBlocksFromSupabaseFallback() {
  const result = await queryGlobalPageRecord("blocks");
  if (result.error || !Array.isArray(result.record?.blocks)) return null;
  const sanitized = sanitizeBlocksForRuntime(result.record.blocks as Block[]).blocks;
  if (sanitized.length > 0) return sanitized;
  return null;
}

async function loadPlatformBlocksViaApiFallback() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch("/api/platform-published", {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const json = (await response.json().catch(() => null)) as { blocks?: unknown } | null;
    if (!Array.isArray(json?.blocks)) return null;
    const sanitized = sanitizeBlocksForRuntime(json.blocks as Block[]).blocks;
    return sanitized.length > 0 ? sanitized : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

type PublishedSiteSnapshot = {
  siteId: string;
  blocks: Block[];
  slug: string;
  merchantName: string;
  serviceState: {
    status: Site["status"];
    serviceExpiresAt: string | null;
    maintenance: boolean;
  } | null;
};

type MerchantDraftSnapshot = {
  siteId: string;
  blocks: Block[];
  updatedAt: string | null;
};

const REMOTE_MERCHANT_DRAFT_SYNC_KEY = "merchant-space:merchant-draft-remote-sync:v1";
const REMOTE_CONTENT_VERIFIED_KEY = "merchant-space:remote-content-verified:v1";

function merchantDraftSyncScopeToken(scope?: string) {
  const normalized = String(scope ?? "").trim();
  if (!normalized) return "default";
  return normalized.replace(/[^a-zA-Z0-9:_-]/g, "_");
}

function buildRemoteMerchantDraftSyncStorageKey(scope?: string) {
  const token = merchantDraftSyncScopeToken(scope);
  return token === "default" ? REMOTE_MERCHANT_DRAFT_SYNC_KEY : `${REMOTE_MERCHANT_DRAFT_SYNC_KEY}:${token}`;
}

function buildRemoteContentVerifiedStorageKey(scope?: string) {
  const token = merchantDraftSyncScopeToken(scope);
  return token === "default" ? REMOTE_CONTENT_VERIFIED_KEY : `${REMOTE_CONTENT_VERIFIED_KEY}:${token}`;
}

function readRemoteMerchantDraftSyncTimestamp(scope?: string) {
  if (typeof window === "undefined") return "";
  try {
    return String(localStorage.getItem(buildRemoteMerchantDraftSyncStorageKey(scope)) ?? "").trim();
  } catch {
    return "";
  }
}

function recordRemoteMerchantDraftSyncTimestamp(updatedAt: string | null | undefined, scope?: string) {
  const normalizedUpdatedAt = String(updatedAt ?? "").trim();
  if (!normalizedUpdatedAt || typeof window === "undefined") return;
  try {
    localStorage.setItem(buildRemoteMerchantDraftSyncStorageKey(scope), normalizedUpdatedAt);
  } catch {
    // ignore sync stamp write failures
  }
}

function parseIsoTimestampMs(value: string | null | undefined) {
  const normalized = String(value ?? "").trim();
  if (!normalized) return 0;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function loadPublishedSiteSnapshotViaApi(siteId: string): Promise<PublishedSiteSnapshot | null> {
  const normalizedSiteId = String(siteId ?? "").trim();
  if (!normalizedSiteId) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(`/api/site-published?siteId=${encodeURIComponent(normalizedSiteId)}`, {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const json = (await response.json().catch(() => null)) as
      | {
          blocks?: unknown;
          slug?: unknown;
          merchantName?: unknown;
          serviceState?:
            | {
                status?: unknown;
                serviceExpiresAt?: unknown;
                maintenance?: unknown;
              }
            | null;
        }
      | null;
    if (!Array.isArray(json?.blocks)) return null;
    const sanitized = sanitizeBlocksForRuntime(json.blocks as Block[]).blocks;
    if (sanitized.length === 0) return null;
    const normalizedServiceState =
      json?.serviceState && typeof json.serviceState === "object"
        ? getMerchantServiceState(
            typeof json.serviceState.status === "string" ? json.serviceState.status : null,
            typeof json.serviceState.serviceExpiresAt === "string" ? json.serviceState.serviceExpiresAt : null,
          )
        : null;
    return {
      siteId: normalizedSiteId,
      blocks: sanitized,
      slug: typeof json?.slug === "string" ? json.slug.trim() : "",
      merchantName: typeof json?.merchantName === "string" ? json.merchantName.trim() : "",
      serviceState: normalizedServiceState
        ? {
            status: normalizedServiceState.status,
            serviceExpiresAt: normalizedServiceState.serviceExpiresAt,
            maintenance: normalizedServiceState.maintenance,
          }
        : null,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function applyPublishedSiteSnapshotToScopedMerchantSite(
  siteId: string,
  snapshot: PublishedSiteSnapshot | null | undefined,
  userEmail?: string | null,
) {
  const normalizedSiteId = String(siteId ?? "").trim();
  if (!normalizedSiteId || !snapshot) return null;
  const localSite = loadPlatformState().sites.find((item) => item.id === normalizedSiteId) ?? null;
  return ensureScopedMerchantSite(
    normalizedSiteId,
    userEmail ?? null,
    {
      ...buildPublishedMerchantProfilePatch(
        {
          merchantName: localSite?.merchantName,
          domainPrefix: localSite?.domainPrefix ?? localSite?.domainSuffix,
        },
        snapshot,
      ),
      ...(snapshot.serviceState
        ? {
            status: snapshot.serviceState.status,
            serviceExpiresAt: snapshot.serviceState.serviceExpiresAt,
          }
        : {}),
    },
  );
}

async function syncScopedMerchantSiteFromPublishedSnapshot(siteId: string, userEmail?: string | null) {
  const normalizedSiteId = String(siteId ?? "").trim();
  if (!normalizedSiteId) return null;
  const snapshot = await loadPublishedSiteSnapshotViaApi(normalizedSiteId);
  if (!snapshot) return null;
  return applyPublishedSiteSnapshotToScopedMerchantSite(normalizedSiteId, snapshot, userEmail);
}

async function loadPublishedSiteSnapshotForMerchantIds(merchantIds: string[]) {
  const uniqueMerchantIds = [...new Set(merchantIds.map((item) => String(item ?? "").trim()).filter(isMerchantNumericId))].slice(0, 8);
  for (const merchantId of uniqueMerchantIds) {
    const snapshot = await loadPublishedSiteSnapshotViaApi(merchantId);
    if (snapshot && snapshot.blocks.length > 0) {
      return snapshot;
    }
  }
  return null;
}

async function loadMerchantDraftSnapshotViaApi(merchantIds: string[]): Promise<MerchantDraftSnapshot | null> {
  const uniqueMerchantIds = [...new Set(merchantIds.map((item) => String(item ?? "").trim()).filter(Boolean))].slice(0, 8);
  for (const merchantId of uniqueMerchantIds) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(`/api/merchant-draft?siteId=${encodeURIComponent(merchantId)}`, {
        method: "GET",
        cache: "no-store",
        credentials: "same-origin",
        signal: controller.signal,
      });
      if (!response.ok) continue;
      const json = (await response.json().catch(() => null)) as
        | {
            siteId?: unknown;
            updatedAt?: unknown;
            blocks?: unknown;
          }
        | null;
      if (!Array.isArray(json?.blocks)) continue;
      const sanitized = sanitizeBlocksForRuntime(json.blocks as Block[]).blocks;
      if (sanitized.length === 0) continue;
      return {
        siteId: typeof json?.siteId === "string" ? json.siteId.trim() : merchantId,
        updatedAt: typeof json?.updatedAt === "string" ? json.updatedAt.trim() : null,
        blocks: sanitized,
      };
    } catch {
      // ignore per-site draft fetch failures and try the next candidate
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

async function loadPlatformBlocksViaRestFallback(accessToken?: string | null) {
  if (!accessToken) return null;
  const baseUrl = getResolvedSupabaseUrl().trim().replace(/\/+$/, "");
  if (!baseUrl) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const query = new URLSearchParams({
      select: "blocks",
      slug: "eq.home",
      limit: "1",
    });
    query.set("merchant_id", "is.null");
    const response = await fetch(`${baseUrl}/rest/v1/pages?${query.toString()}`, {
      method: "GET",
      headers: {
        apikey: resolvedSupabaseAnonKey,
        Authorization: `Bearer ${accessToken}`,
      },
      cache: "no-store",
      signal: controller.signal,
    });
  if (!response.ok) return null;
  const json = (await response.json()) as unknown;
  if (!Array.isArray(json)) return null;
  const first = json[0] as { blocks?: unknown } | undefined;
  if (!first || !Array.isArray(first.blocks)) return null;
  const sanitized = sanitizeBlocksForRuntime(first.blocks as Block[]).blocks;
  if (sanitized.length > 0) return sanitized;
  return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function getMerchantIdentityNotice(merchantIds: string[]) {
  if (merchantIds.length > 0) return null;
  return "未匹配到你的商户站点，当前仅展示本地草稿。请先在“商户信息”完善绑定。";
}

  async function saveBlocksToSupabaseFallback(
    payload: { blocks: Block[]; updated_at: string },
    merchantIds: string[],
    merchantSlug = "",
  ): Promise<SaveErrorLike> {
  const sanitizedBlocks = sanitizeBlocksForRuntime(payload.blocks).blocks;
  const normalizedMerchantSlug = normalizeDomainPrefixForMerchant(merchantSlug) || "home";

  async function trySaveWithPayload(sanitizedPayload: { blocks: Block[]; updated_at?: string }): Promise<SaveErrorLike> {
    // Public homepage publish: only touch the global row (merchant_id is null).
    if (merchantIds.length === 0) {
      const existingGlobal = await queryGlobalPageRecord("id");
      if (existingGlobal.error) return existingGlobal.error;

      const globalRowId = existingGlobal.record?.id;
      if (globalRowId !== undefined && globalRowId !== null) {
        const byId = await supabase.from("pages").update(sanitizedPayload).eq("id", globalRowId);
        if (!byId.error) return null;
        return byId.error;
      }

      if (pagesSlugColumnSupported !== false) {
        const initHome = await supabase.from("pages").insert({
          ...sanitizedPayload,
          slug: "home",
        });
        if (!initHome.error) {
          pagesSlugColumnSupported = true;
          return null;
        }
        if (isMissingSlugColumn(initHome.error.message)) {
          pagesSlugColumnSupported = false;
        } else {
          return initHome.error;
        }
      }

      const initWithoutSlug = await supabase.from("pages").insert(sanitizedPayload);
      if (!initWithoutSlug.error) return null;
      return initWithoutSlug.error;
    }

    for (const merchantId of merchantIds) {
      const byMerchant = await supabase
        .from("pages")
        .select("id")
        .eq("merchant_id", merchantId)
        .limit(1)
        .maybeSingle();
      if (byMerchant.error) continue;

      if (byMerchant.data?.id !== undefined && byMerchant.data?.id !== null) {
        if (pagesSlugColumnSupported !== false) {
          const byIdWithSlug = await supabase
            .from("pages")
            .update({ ...sanitizedPayload, slug: normalizedMerchantSlug })
            .eq("id", byMerchant.data.id);
          if (!byIdWithSlug.error) {
            pagesSlugColumnSupported = true;
            return null;
          }
          if (!isMissingSlugColumn(byIdWithSlug.error.message)) {
            return byIdWithSlug.error;
          }
          pagesSlugColumnSupported = false;
        }

        const byId = await supabase.from("pages").update(sanitizedPayload).eq("id", byMerchant.data.id);
        if (!byId.error) return null;
        return byId.error;
      }
    }

    const initErrors: string[] = [];

    for (const merchantId of merchantIds) {
      const withSlug = await supabase.from("pages").insert({
        ...sanitizedPayload,
        merchant_id: merchantId,
        slug: normalizedMerchantSlug,
      });
      if (!withSlug.error) return null;
      initErrors.push(`pages 初始插入（含 slug）失败(${merchantId}): ${withSlug.error.message}`);

      if (isMissingSlugColumn(withSlug.error.message)) {
        const withoutSlug = await supabase.from("pages").insert({
          ...sanitizedPayload,
          merchant_id: merchantId,
        });
        if (!withoutSlug.error) return null;
        initErrors.push(`pages 初始插入（不含 slug）失败(${merchantId}): ${withoutSlug.error.message}`);
      }

      // Fallback: let DB default/trigger populate merchant_id when explicit id is invalid.
      const autoMerchantWithSlug = await supabase.from("pages").insert({
        ...sanitizedPayload,
        slug: normalizedMerchantSlug,
      });
      if (!autoMerchantWithSlug.error) return null;
      initErrors.push(`pages 初始插入（自动 merchant_id，含 slug）失败(${merchantId}): ${autoMerchantWithSlug.error.message}`);

      if (isMissingSlugColumn(autoMerchantWithSlug.error.message)) {
        const autoMerchantWithoutSlug = await supabase.from("pages").insert(sanitizedPayload);
        if (!autoMerchantWithoutSlug.error) return null;
        initErrors.push(
          `pages 初始插入（自动 merchant_id，不含 slug）失败(${merchantId}): ${autoMerchantWithoutSlug.error.message}`,
        );
      }
    }

    return {
      message:
        initErrors.length > 0
          ? `存在可更新 pages 记录，但自动初始化失败：${initErrors.join("；")}`
          : "存在可更新 pages 记录，但初始化失败",
    };
  }

  const withUpdatedAt = { blocks: sanitizedBlocks, updated_at: payload.updated_at };
  if (pagesUpdatedAtColumnSupported !== false) {
    const first = await trySaveWithPayload(withUpdatedAt);
    if (!first) {
      pagesUpdatedAtColumnSupported = true;
      return null;
    }
    if (!isMissingUpdatedAtColumn(first.message)) return first;
    pagesUpdatedAtColumnSupported = false;
  }

  return trySaveWithPayload({ blocks: sanitizedBlocks });
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

function getSupportContactAvatarLabel(value: string | null | undefined, fallback = "商") {
  const normalized = String(value ?? "").trim();
  if (!normalized) return fallback;
  const compact = normalized.replace(/\s+/g, "");
  if (!compact) return fallback;
  return compact.slice(0, 2).toUpperCase();
}

const SUPPORT_PHOTO_PICKER_ACCEPT =
  "image/png,image/jpeg,image/webp,image/heic,image/heif,image/gif";
const SUPPORT_FILE_IMAGE_ACCEPTS = [
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".heic",
  ".heif",
  ".gif",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/heic",
  "image/heif",
  "image/gif",
];
const SUPPORT_FILE_PICKER_ACCEPT = [
  ...SUPPORT_FILE_IMAGE_ACCEPTS,
  ".pdf",
  ".txt",
  ".csv",
  ".json",
  ".zip",
  ".rar",
  ".7z",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".ppt",
  ".pptx",
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/json",
  "application/zip",
  "application/x-7z-compressed",
  "application/x-rar-compressed",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
].join(",");

const SUPPORT_REPLY_MESSAGE_PREFIX = "[faolla-reply]";

function isSupportImageFile(file: File) {
  const type = String(file.type ?? "").toLowerCase();
  const name = String(file.name ?? "").toLowerCase();
  return type.startsWith("image/") || /\.(?:png|jpe?g|webp|gif|heic|heif|bmp|svg)$/i.test(name);
}

function normalizeSupportReplyText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function buildSupportReplyMessageText(reply: SupportReplyDraft, body: string) {
  const replyText = normalizeSupportReplyText(reply.text);
  const senderLabel = normalizeSupportReplyText(reply.senderLabel) || "消息";
  return [
    SUPPORT_REPLY_MESSAGE_PREFIX,
    `from:${senderLabel}`,
    `text:${replyText}`,
    "",
    body.trim(),
  ].join("\n");
}

function parseSupportReplyMessageText(value: string) {
  const text = String(value ?? "");
  if (!text.startsWith(`${SUPPORT_REPLY_MESSAGE_PREFIX}\n`)) return null;
  const lines = text.split(/\r?\n/);
  const emptyLineIndex = lines.findIndex((line, index) => index > 0 && !line.trim());
  if (emptyLineIndex < 0) return null;
  const senderLine = lines.find((line) => line.startsWith("from:")) ?? "";
  const replyLine = lines.find((line) => line.startsWith("text:")) ?? "";
  const senderLabel = senderLine.slice("from:".length).trim() || "消息";
  const replyText = replyLine.slice("text:".length).trim();
  const body = lines.slice(emptyLineIndex + 1).join("\n").trim();
  if (!replyText || !body) return null;
  return {
    senderLabel,
    text: replyText,
    body,
  };
}

function getSupportDisplayMessageText(value: string) {
  return parseSupportReplyMessageText(value)?.body ?? value;
}

function normalizeSupportDetailText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeSupportDisplayValue(value: unknown) {
  const normalized = normalizeSupportDetailText(value);
  return normalized && normalized !== "-" ? normalized : "";
}

function isSupportImageAssetUrl(value: string) {
  const normalized = normalizeSupportDisplayValue(value);
  if (!normalized || isInlineDataImageUrl(normalized)) return false;
  return (
    /\.(?:png|jpe?g|gif|webp|bmp|svg)(?:$|[?#])/i.test(normalized) ||
    /^https?:\/\/[^?#]+\/storage\/v1\/object\/public\//i.test(normalized) ||
    /^\/storage\/v1\/object\/public\//i.test(normalized)
  );
}

function buildSupportMerchantCardShareContact(card: MerchantBusinessCardAsset) {
  return {
    displayName: normalizeSupportDetailText(card.contacts.contactName) || normalizeSupportDetailText(card.name),
    organization: normalizeSupportDetailText(card.name),
    title: normalizeSupportDetailText(card.title),
    phone: normalizeSupportDetailText(card.contacts.phone),
    phones: Array.isArray(card.contacts.phones) ? card.contacts.phones.filter(Boolean) : [],
    contactFieldOrder: card.contactFieldOrder,
    contactOnlyFields: card.contactOnlyFields,
    contactDisplayFields: card.contactDisplayFields,
    email: normalizeSupportDetailText(card.contacts.email),
    address: normalizeSupportDetailText(card.contacts.address),
    invoiceName: normalizeSupportDetailText(card.invoice?.name),
    invoiceTaxNumber: normalizeSupportDetailText(card.invoice?.taxNumber),
    invoiceAddress: normalizeSupportDetailText(card.invoice?.address),
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
    googleReview: normalizeSupportDetailText(card.contacts.googleReview),
    websiteUrl: normalizeSupportDetailText(card.targetUrl),
  };
}

function buildSupportMerchantCardShareInput(card: MerchantBusinessCardAsset | null) {
  if (!card) return null;
  const targetUrl = normalizeSupportDetailText(card.targetUrl);
  if (!targetUrl) return null;
  return {
    origin: resolveMerchantBusinessCardShareOrigin(undefined, targetUrl),
    shareKey: normalizeSupportDetailText(card.shareKey),
    name: normalizeSupportDetailText(card.name),
    imageUrl: normalizeSupportDetailText(card.shareImageUrl) || normalizeSupportDetailText(card.imageUrl),
    detailImageUrl:
      normalizeSupportDetailText(card.contactPagePublicImageUrl) || normalizeSupportDetailText(card.contactPageImageUrl),
    detailImageHeight: card.contactPageImageHeight,
    introVideoUrl: normalizeSupportDetailText(card.contactIntroVideoUrl),
    introPosterUrl: normalizeSupportDetailText(card.contactIntroVideoPosterUrl),
    introVideoMuted: card.contactIntroVideoMuted,
    targetUrl,
    contact: buildSupportMerchantCardShareContact(card),
  };
}

function isSupportSnapshotFallbackBusinessCard(card: MerchantBusinessCardAsset | null | undefined) {
  return normalizeSupportDetailText(card?.id).startsWith("snapshot-fallback-");
}

function escapeSupportSvgText(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildSupportFallbackBusinessCardPreviewDataUrl(card: MerchantBusinessCardAsset | null | undefined) {
  if (!card) return "";
  const displayName = normalizeSupportDetailText(card.name) || "商户名片";
  const title = normalizeSupportDetailText(card.title);
  const websiteUrl = normalizeSupportDetailText(card.targetUrl);
  const websiteLabel = websiteUrl ? formatSupportUrlLabel(websiteUrl) : "";
  const lineItems = [
    normalizeSupportDetailText(card.contacts.contactName)
      ? `联系人  ${normalizeSupportDetailText(card.contacts.contactName)}`
      : "",
    normalizeSupportDetailText(card.contacts.phone) ? `电话  ${normalizeSupportDetailText(card.contacts.phone)}` : "",
    normalizeSupportDetailText(card.contacts.email) ? `邮箱  ${normalizeSupportDetailText(card.contacts.email)}` : "",
    websiteLabel ? `官网  ${websiteLabel}` : "",
  ].filter(Boolean);
  const visibleLines = lineItems.slice(0, 3);
  const initials = escapeSupportSvgText(getSupportContactAvatarLabel(displayName, "名").slice(0, 2));
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="720" height="432" viewBox="0 0 720 432">
      <defs>
        <linearGradient id="support-card-bg" x1="0%" x2="100%" y1="0%" y2="100%">
          <stop offset="0%" stop-color="#f8fbff" />
          <stop offset="100%" stop-color="#e9eefc" />
        </linearGradient>
      </defs>
      <rect width="720" height="432" rx="36" fill="url(#support-card-bg)" />
      <rect x="28" y="28" width="664" height="376" rx="30" fill="#ffffff" stroke="#dbe4f0" stroke-width="2" />
      <rect x="48" y="48" width="624" height="104" rx="26" fill="#0f172a" />
      <circle cx="112" cy="100" r="36" fill="#ffffff" fill-opacity="0.14" />
      <text x="112" y="111" fill="#ffffff" font-family="Arial, sans-serif" font-size="28" font-weight="700" text-anchor="middle">${initials}</text>
      <text x="168" y="98" fill="#ffffff" font-family="Arial, sans-serif" font-size="34" font-weight="700">${escapeSupportSvgText(displayName)}</text>
      <text x="168" y="132" fill="#cbd5e1" font-family="Arial, sans-serif" font-size="22">${escapeSupportSvgText(title || "联系卡")}</text>
      <text x="54" y="204" fill="#0f172a" font-family="Arial, sans-serif" font-size="24" font-weight="700">Faolla Contact</text>
      ${visibleLines
        .map(
          (line, index) =>
            `<text x="54" y="${252 + index * 46}" fill="#334155" font-family="Arial, sans-serif" font-size="24">${escapeSupportSvgText(line)}</text>`,
        )
        .join("")}
      <rect x="48" y="340" width="624" height="44" rx="16" fill="#ecfdf5" />
      <text x="68" y="369" fill="#059669" font-family="Arial, sans-serif" font-size="22">${escapeSupportSvgText(
        websiteLabel || "点击查看联系卡",
      )}</text>
    </svg>
  `.trim();
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function getSupportPreferredBusinessCardPreviewUrl(card: MerchantBusinessCardAsset | null | undefined) {
  if (!card) return "";
  const shareImageUrl = normalizeSupportDetailText(card.shareImageUrl);
  const imageUrl = normalizeSupportDetailText(card.imageUrl);
  const detailImageUrl =
    normalizeSupportDetailText(card.contactPagePublicImageUrl) || normalizeSupportDetailText(card.contactPageImageUrl);
  if (card.mode === "link") {
    if (!isSupportSnapshotFallbackBusinessCard(card) && imageUrl && imageUrl !== detailImageUrl) {
      return imageUrl;
    }
    if (shareImageUrl) return shareImageUrl;
    return buildSupportFallbackBusinessCardPreviewDataUrl(card);
  }
  if (imageUrl && !isSupportSnapshotFallbackBusinessCard(card)) {
    return imageUrl;
  }
  return buildSupportFallbackBusinessCardPreviewDataUrl(card);
}

function normalizeSupportBusinessCardComparableUrl(value: string) {
  const normalized = normalizeSupportDetailText(value);
  if (!normalized) return "";
  try {
    const url = new URL(normalized);
    url.hash = "";
    if (url.pathname !== "/") {
      url.pathname = url.pathname.replace(/\/+$/, "");
    }
    return url.toString();
  } catch {
    return normalized.replace(/\/+$/, "");
  }
}

function readRemoteContentVerifiedTimestamp(scope?: string) {
  if (typeof window === "undefined") return "";
  try {
    return String(localStorage.getItem(buildRemoteContentVerifiedStorageKey(scope)) ?? "").trim();
  } catch {
    return "";
  }
}

function hasRemoteContentVerifiedStamp(scopes: string[]) {
  return scopes.some((scope) => Boolean(readRemoteContentVerifiedTimestamp(scope)));
}

function recordRemoteContentVerifiedTimestamp(scope?: string, recordedAt?: string | null | undefined) {
  if (typeof window === "undefined") return;
  const normalizedScope = String(scope ?? "").trim();
  if (!normalizedScope) return;
  const normalizedRecordedAt = String(recordedAt ?? "").trim() || new Date().toISOString();
  try {
    localStorage.setItem(buildRemoteContentVerifiedStorageKey(normalizedScope), normalizedRecordedAt);
  } catch {
    // ignore verification stamp write failures
  }
}

function buildSupportBusinessCardIdentityKeys(card: MerchantBusinessCardAsset | null | undefined) {
  if (!card) return [];
  const keys = new Set<string>();
  const id = normalizeSupportDetailText(card.id);
  const shareKey = normalizeSupportDetailText(card.shareKey);
  const previewUrl = normalizeSupportBusinessCardComparableUrl(
    normalizeSupportDetailText(card.shareImageUrl) || normalizeSupportDetailText(card.imageUrl),
  );
  const detailUrl = normalizeSupportBusinessCardComparableUrl(
    normalizeSupportDetailText(card.contactPagePublicImageUrl) || normalizeSupportDetailText(card.contactPageImageUrl),
  );
  if (shareKey) keys.add(`share:${shareKey}`);
  if (id) keys.add(`id:${id}`);
  if (previewUrl || detailUrl) {
    keys.add(`asset:${card.mode}|${previewUrl}|${detailUrl}`);
  }
  return [...keys];
}

function mergeSupportBusinessCardCandidates(
  primary: MerchantBusinessCardAsset,
  secondary: MerchantBusinessCardAsset,
  options?: { prefer?: "primary" | "secondary" | "richer" },
): MerchantBusinessCardAsset {
  return mergeMerchantBusinessCardAssets(primary, secondary, options);
}

function dedupeSupportBusinessCards(cards: MerchantBusinessCardAsset[]) {
  return cards.reduce<MerchantBusinessCardAsset[]>((accumulator, card) => {
    const cardKeys = buildSupportBusinessCardIdentityKeys(card);
    const duplicateIndex = accumulator.findIndex((item) => {
      const itemKeys = buildSupportBusinessCardIdentityKeys(item);
      return cardKeys.some((key) => itemKeys.includes(key));
    });
    if (duplicateIndex >= 0) {
      accumulator[duplicateIndex] = mergeSupportBusinessCardCandidates(accumulator[duplicateIndex], card, {
        prefer: "richer",
      });
    } else {
      accumulator.push(card);
    }
    return accumulator;
  }, []);
}

function sortSupportBusinessCardsForDisplay(cards: MerchantBusinessCardAsset[]) {
  return [...cards].sort((left, right) => {
    const leftChat = left.showInChat !== false;
    const rightChat = right.showInChat !== false;
    if (leftChat !== rightChat) return leftChat ? -1 : 1;
    return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
  });
}

function mergeSupportBusinessCardLists(
  localCardsInput: unknown,
  remoteCardsInput: unknown,
) {
  const localCards = normalizeMerchantBusinessCards(localCardsInput);
  const remoteCards = dedupeSupportBusinessCards(normalizeMerchantBusinessCards(remoteCardsInput));
  if (remoteCards.length === 0) {
    return sortSupportBusinessCardsForDisplay(localCards.filter((card) => !isSupportSnapshotFallbackBusinessCard(card)));
  }
  if (localCards.length === 0) {
    return sortSupportBusinessCardsForDisplay(remoteCards.filter((card) => !isSupportSnapshotFallbackBusinessCard(card)));
  }
  const mergedCards = [...remoteCards];
  localCards.forEach((card) => {
    if (isSupportSnapshotFallbackBusinessCard(card)) return;
    const matchIndex = mergedCards.findIndex((item) => {
      const itemKeys = buildSupportBusinessCardIdentityKeys(item);
      const cardKeys = buildSupportBusinessCardIdentityKeys(card);
      return cardKeys.some((key) => itemKeys.includes(key));
    });
    if (matchIndex >= 0) {
      mergedCards[matchIndex] = mergeSupportBusinessCardCandidates(card, mergedCards[matchIndex], {
        prefer: "primary",
      });
    } else {
      mergedCards.push(card);
    }
  });
  return sortSupportBusinessCardsForDisplay(
    dedupeSupportBusinessCards(mergedCards).filter((card) => !isSupportSnapshotFallbackBusinessCard(card)),
  );
}

function buildSupportMerchantCardLink(card: MerchantBusinessCardAsset | null) {
  if (!card || card.mode !== "link") return "";
  const input = buildSupportMerchantCardShareInput(card);
  if (!input) return "";
  return buildMerchantBusinessCardShareUrl(input);
}

async function verifySupportShortMerchantCardLink(value: string, timeoutMs = 8_000) {
  const normalized = normalizeSupportDetailText(value);
  if (!isSupportShortMerchantCardLink(normalized)) return false;
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), Math.max(500, timeoutMs));
  try {
    const response = await fetch(normalized, {
      method: "GET",
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    window.clearTimeout(timer);
  }
}

function buildSupportFallbackMerchantCardHref(input: {
  merchantId?: string | null;
  merchantName?: string | null;
  imageUrl?: string | null;
  websiteHref?: string | null;
  industry?: string | null;
  contactName?: string | null;
  phone?: string | null;
  email?: string | null;
  contactAddress?: string | null;
  location?: Partial<SiteLocation> | null;
}) {
  const targetUrl = normalizeSupportExternalUrl(input.websiteHref);
  if (!targetUrl) return "";

  const merchantName =
    normalizeSupportDetailText(input.merchantName) ||
    normalizeSupportDetailText(input.merchantId) ||
    "商户";
  const imageUrl = normalizeSupportDetailText(input.imageUrl);
  const phone = normalizeSupportDetailText(input.phone);
  const email = normalizeSupportDetailText(input.email);
  const address = [
    normalizeSupportDetailText(input.contactAddress),
    normalizeSupportDetailText(input.location?.city),
    normalizeSupportDetailText(input.location?.province),
    normalizeSupportDetailText(input.location?.country),
  ]
    .filter(Boolean)
    .join(" / ");

  return buildMerchantBusinessCardShareUrl({
    origin: resolveMerchantBusinessCardShareOrigin(undefined, targetUrl),
    name: merchantName,
    imageUrl: imageUrl || undefined,
    detailImageUrl: imageUrl || undefined,
    targetUrl,
    contact: {
      displayName: normalizeSupportDetailText(input.contactName) || merchantName,
      organization: merchantName,
      title: normalizeSupportDetailText(input.industry),
      phone,
      phones: phone ? [phone] : [],
      email,
      address,
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

function findFirstCouponPageIdInPlanConfig(planConfig: PagePlanConfig | null | undefined) {
  const activePlan = planConfig?.plans.find((plan) => plan.id === planConfig.activePlanId) ?? planConfig?.plans[0];
  const pages = activePlan?.pages?.length
    ? activePlan.pages
    : activePlan
      ? [{ id: activePlan.activePageId, blocks: getBlocksForPage(activePlan, activePlan.activePageId) }]
      : [];
  return pages.find((page) => page.blocks.some((block) => block.type === "coupon"))?.id ?? "";
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

function hasSupportMerchantAvatarCoverage(profile: MerchantListPublishedSite | null | undefined) {
  if (!profile) return false;
  return Boolean(
    normalizeSupportDisplayValue(profile.chatAvatarImageUrl) ||
      normalizeSupportDisplayValue(profile.merchantCardImageUrl),
  );
}

const SUPPORT_MERCHANT_PROFILE_REFRESH_TTL_MS = 1_000;

function readMobileVisualViewportLayoutHeightCandidate() {
  if (typeof window === "undefined") {
    return 0;
  }
  const visualViewport = window.visualViewport;
  const topRaw = visualViewport && Number.isFinite(visualViewport.offsetTop) ? visualViewport.offsetTop : 0;
  const visualViewportExtent = visualViewport ? visualViewport.height + topRaw : 0;
  const documentElementHeight =
    typeof document !== "undefined" ? Number.parseInt(String(document.documentElement?.clientHeight ?? 0), 10) : 0;
  return Math.max(
    0,
    Math.round(
      Math.max(
        Number.isFinite(window.innerHeight) ? window.innerHeight : 0,
        Number.isFinite(documentElementHeight) ? documentElementHeight : 0,
        Number.isFinite(visualViewportExtent) ? visualViewportExtent : 0,
      ),
    ),
  );
}

function readMobileVisualViewportOrientation() {
  if (typeof window === "undefined") {
    return "portrait";
  }
  return window.innerWidth > window.innerHeight ? "landscape" : "portrait";
}

function shouldUseMerchantDesktopSidebarViewport() {
  if (typeof window === "undefined") return false;
  const desktopWidth = typeof window.matchMedia === "function" ? window.matchMedia("(min-width: 1024px)").matches : window.innerWidth >= 1024;
  const coarseMobileViewport =
    typeof window.matchMedia === "function"
      ? window.matchMedia("(pointer: coarse) and (max-width: 1024px)").matches
      : false;
  return desktopWidth && !coarseMobileViewport;
}

function readMobileVisualViewportMetrics(layoutViewportHeight?: number) {
  if (typeof window === "undefined") {
    return { top: 0, bottom: 0, height: 0 };
  }
  const visualViewport = window.visualViewport;
  if (!visualViewport) {
    const fallbackHeight = readMobileVisualViewportLayoutHeightCandidate();
    return { top: 0, bottom: 0, height: fallbackHeight };
  }
  const topRaw = Number.isFinite(visualViewport.offsetTop) ? visualViewport.offsetTop : 0;
  const top = Math.max(0, Math.round(topRaw));
  const heightRaw = Number.isFinite(visualViewport.height) ? visualViewport.height : 0;
  const height = Math.max(0, Math.round(heightRaw));
  const layoutHeight =
    typeof layoutViewportHeight === "number" && Number.isFinite(layoutViewportHeight) && layoutViewportHeight > 0
      ? layoutViewportHeight
      : readMobileVisualViewportLayoutHeightCandidate();
  const bottomRaw = layoutHeight - (heightRaw + topRaw);
  const bottom = Number.isFinite(bottomRaw) ? Math.max(0, Math.round(bottomRaw)) : 0;
  return { top, bottom, height };
}

function normalizeSupportMessageTimestamp(value: string | null | undefined) {
  const normalized = String(value ?? "").trim();
  if (!normalized) return "";
  const timestamp = new Date(normalized).getTime();
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : "";
}

function selectLatestSupportReadTimestamp(left: string | null | undefined, right: string | null | undefined) {
  const leftNormalized = normalizeSupportMessageTimestamp(left);
  const rightNormalized = normalizeSupportMessageTimestamp(right);
  if (!leftNormalized) return rightNormalized;
  if (!rightNormalized) return leftNormalized;
  return new Date(rightNormalized).getTime() > new Date(leftNormalized).getTime() ? rightNormalized : leftNormalized;
}

function isSupportReadTimestampNewer(left: string | null | undefined, right: string | null | undefined) {
  const leftNormalized = normalizeSupportMessageTimestamp(left);
  const rightNormalized = normalizeSupportMessageTimestamp(right);
  if (!leftNormalized) return false;
  if (!rightNormalized) return true;
  return new Date(leftNormalized).getTime() > new Date(rightNormalized).getTime();
}

function normalizeSupportPeerLastReadRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {} as Record<string, string>;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .map(([merchantId, timestamp]) => {
        const normalizedMerchantId = merchantId.trim();
        const normalizedTimestamp = normalizeSupportMessageTimestamp(String(timestamp ?? ""));
        return [normalizedMerchantId, normalizedTimestamp] as const;
      })
      .filter(([merchantId, timestamp]) => /^\d{8}$/.test(merchantId) && timestamp),
  );
}

function mergeSupportPeerLastReadMaps(...maps: Array<Record<string, unknown> | null | undefined>) {
  const merged: Record<string, string> = {};
  maps.forEach((map) => {
    Object.entries(normalizeSupportPeerLastReadRecord(map)).forEach(([merchantId, timestamp]) => {
      merged[merchantId] = selectLatestSupportReadTimestamp(merged[merchantId], timestamp);
    });
  });
  return merged;
}

function areSupportPeerLastReadMapsEqual(left: Record<string, string>, right: Record<string, string>) {
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return leftKeys.length === rightKeys.length && leftKeys.every((key, index) => key === rightKeys[index] && left[key] === right[key]);
}

function buildSupportLastReadStorageKey(merchantId: string) {
  return `${SUPPORT_LAST_READ_STORAGE_KEY_PREFIX}${merchantId.trim() || "default"}`;
}

function buildSupportPeerLastReadStorageKey(ownerMerchantId: string, contactMerchantId: string) {
  const owner = ownerMerchantId.trim() || "default";
  const contact = contactMerchantId.trim() || "default";
  return `${SUPPORT_LAST_READ_STORAGE_KEY_PREFIX}peer:${owner}:${contact}`;
}

function readLocalSupportLastReadAt(merchantId: string) {
  if (typeof window === "undefined") return "";
  try {
    return normalizeSupportMessageTimestamp(localStorage.getItem(buildSupportLastReadStorageKey(merchantId)));
  } catch {
    return "";
  }
}

function writeLocalSupportLastReadAt(merchantId: string, timestamp: string) {
  if (typeof window === "undefined") return;
  const normalizedTimestamp = normalizeSupportMessageTimestamp(timestamp);
  if (!merchantId.trim() || !normalizedTimestamp) return;
  try {
    localStorage.setItem(buildSupportLastReadStorageKey(merchantId), normalizedTimestamp);
  } catch {
    // Local storage is only a fallback cache; server state is authoritative.
  }
}

function readLocalSupportPeerLastReadMap(ownerMerchantId: string, contacts: MerchantPeerContactSummary[]) {
  if (typeof window === "undefined") return {} as Record<string, string>;
  const owner = ownerMerchantId.trim();
  if (!owner) return {};
  try {
    return contacts.reduce<Record<string, string>>((accumulator, contact) => {
      const merchantId = contact.merchantId.trim();
      if (!merchantId) return accumulator;
      const stored = normalizeSupportMessageTimestamp(
        localStorage.getItem(buildSupportPeerLastReadStorageKey(owner, merchantId)),
      );
      if (stored) {
        accumulator[merchantId] = stored;
      }
      return accumulator;
    }, {});
  } catch {
    return {};
  }
}

function writeLocalSupportPeerLastReadAt(ownerMerchantId: string, contactMerchantId: string, timestamp: string) {
  if (typeof window === "undefined") return;
  const owner = ownerMerchantId.trim();
  const contact = contactMerchantId.trim();
  const normalizedTimestamp = normalizeSupportMessageTimestamp(timestamp);
  if (!owner || !contact || !normalizedTimestamp) return;
  try {
    localStorage.setItem(buildSupportPeerLastReadStorageKey(owner, contact), normalizedTimestamp);
  } catch {
    // Local storage is only a fallback cache; server state is authoritative.
  }
}

function buildSupportNotifiedEventStorageKey(merchantId: string) {
  return `${SUPPORT_NOTIFIED_EVENT_STORAGE_KEY_PREFIX}${merchantId.trim() || "default"}`;
}

function readSupportNotifiedEventKeys(merchantId: string) {
  if (typeof window === "undefined") return [] as string[];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(buildSupportNotifiedEventStorageKey(merchantId)) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter(Boolean)
      .slice(-SUPPORT_NOTIFIED_EVENT_LIMIT);
  } catch {
    return [];
  }
}

function writeSupportNotifiedEventKeys(merchantId: string, keys: string[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      buildSupportNotifiedEventStorageKey(merchantId),
      JSON.stringify(keys.map((key) => key.trim()).filter(Boolean).slice(-SUPPORT_NOTIFIED_EVENT_LIMIT)),
    );
  } catch {
    // Ignore storage failures; in-memory de-dupe still applies.
  }
}

function findLatestIncomingPeerMessage(thread: MerchantPeerThread | null | undefined, currentMerchantId: string) {
  const normalizedCurrentMerchantId = currentMerchantId.trim();
  if (!thread || !normalizedCurrentMerchantId) return null;
  for (let index = thread.messages.length - 1; index >= 0; index -= 1) {
    const message = thread.messages[index];
    if (!message || message.senderMerchantId === normalizedCurrentMerchantId) continue;
    return message;
  }
  return null;
}

type LocalSupportMessageStatus = "pending" | "failed";

type LocalSupportMessage = PlatformSupportMessage & {
  merchantId: string;
  status: LocalSupportMessageStatus;
};

type LocalPeerSupportMessage = MerchantPeerMessage & {
  contactMerchantId: string;
  status: LocalSupportMessageStatus;
};

type SupportMessageContextMenuState = {
  key: string;
  text: string;
  isSelf: boolean;
  localStatus: LocalSupportMessageStatus | null;
  x: number;
  y: number;
};

type SupportReplyDraft = {
  key: string;
  senderLabel: string;
  text: string;
};

type SupportPendingImageDraft = {
  id: string;
  source: "file" | "message";
  previewUrl: string;
  fileName: string;
  label: "照片" | "拍照";
  file?: File;
  messageText?: string;
};

const SUPPORT_SYSTEM_EMOJIS = [
  "😀",
  "😃",
  "😄",
  "😁",
  "😆",
  "😊",
  "🙂",
  "😉",
  "😍",
  "😘",
  "😋",
  "😎",
  "🤔",
  "😮",
  "😅",
  "😭",
  "😡",
  "👍",
  "👎",
  "👏",
  "🙏",
  "💪",
  "👌",
  "🤝",
  "❤️",
  "💛",
  "💙",
  "💚",
  "⭐",
  "🔥",
  "🎉",
  "✅",
  "❌",
  "📌",
  "📎",
  "📍",
  "💬",
  "📷",
  "📄",
  "🪪",
];

type SupportContactRow = {
  key: string;
  name: string;
  badge?: string;
  unreadCount: number;
  subtitle: string;
  preview: string;
  updatedAt: string;
  unread: boolean;
  avatarLabel: string;
  avatarImageUrl?: string;
  accountType?: "merchant" | "personal";
  isOfficial: boolean;
};

type SupportMobileHomeTab = "conversations" | "business" | "enterprise" | "faolla" | "self";
type SupportSelfSectionView = "home" | "profile" | "cards" | "coupons" | "tools" | "games" | "qr" | FaollaMobileSettingsView;
type SupportNotificationPreferences = {
  systemNotificationsEnabled: boolean;
  messageSoundEnabled: boolean;
  vibrationEnabled: boolean;
};

function readInitialSupportFaollaEmbedHref() {
  if (typeof window === "undefined") return "/";
  const storedHref = readStoredFaollaEntryUrl(window.location.origin) || "/";
  if (!isFaollaSectionSearch(window.location.search)) return storedHref;
  return resolveFaollaEntryUrlFromBrowser(window.location.search, window.location.origin) || storedHref;
}

const SUPPORT_EMPTY_SIGNATURE_TEXT = "这家伙很懒，什么都没有留下。";
const SUPPORT_PUSH_SERVICE_WORKER_PATH = buildFaollaServiceWorkerPath();
const DEFAULT_SUPPORT_NOTIFICATION_PREFERENCES: SupportNotificationPreferences = {
  systemNotificationsEnabled: true,
  messageSoundEnabled: true,
  vibrationEnabled: true,
};

function buildSupportNotificationPreferencesStorageKey(siteId?: string | null) {
  const normalizedSiteId = String(siteId ?? "").trim() || "default";
  return `merchant-space:support-notification-preferences:v1:${normalizedSiteId}`;
}

function sanitizeSupportNotificationPreferences(value: unknown): SupportNotificationPreferences {
  if (!value || typeof value !== "object") {
    return DEFAULT_SUPPORT_NOTIFICATION_PREFERENCES;
  }
  const source = value as Partial<SupportNotificationPreferences>;
  return {
    systemNotificationsEnabled:
      typeof source.systemNotificationsEnabled === "boolean"
        ? source.systemNotificationsEnabled
        : DEFAULT_SUPPORT_NOTIFICATION_PREFERENCES.systemNotificationsEnabled,
    messageSoundEnabled:
      typeof source.messageSoundEnabled === "boolean"
        ? source.messageSoundEnabled
        : DEFAULT_SUPPORT_NOTIFICATION_PREFERENCES.messageSoundEnabled,
    vibrationEnabled:
      typeof source.vibrationEnabled === "boolean"
        ? source.vibrationEnabled
        : DEFAULT_SUPPORT_NOTIFICATION_PREFERENCES.vibrationEnabled,
  };
}

function readSupportNotificationPreferences(siteId?: string | null) {
  if (typeof window === "undefined") {
    return DEFAULT_SUPPORT_NOTIFICATION_PREFERENCES;
  }
  try {
    const raw = window.localStorage.getItem(buildSupportNotificationPreferencesStorageKey(siteId));
    if (!raw) return DEFAULT_SUPPORT_NOTIFICATION_PREFERENCES;
    return sanitizeSupportNotificationPreferences(JSON.parse(raw));
  } catch {
    return DEFAULT_SUPPORT_NOTIFICATION_PREFERENCES;
  }
}

function writeSupportNotificationPreferences(siteId: string | null | undefined, value: SupportNotificationPreferences) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      buildSupportNotificationPreferencesStorageKey(siteId),
      JSON.stringify(sanitizeSupportNotificationPreferences(value)),
    );
  } catch {
    // Ignore storage failures.
  }
}

function resolveSupportSignatureText(value: unknown) {
  return normalizeSupportDisplayValue(value) || SUPPORT_EMPTY_SIGNATURE_TEXT;
}

function normalizeSupportConversationDeepLink(value: unknown) {
  const normalized = normalizeSupportDisplayValue(value);
  if (!normalized) return "";
  if (normalized === "official") return "official";
  const merchantMatch = normalized.match(/^merchant:(\d{8})$/);
  return merchantMatch ? `merchant:${merchantMatch[1]}` : "";
}

type SupportBadgingNavigator = Navigator & {
  setAppBadge?: (contents?: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
};

type SupportPushSubscriptionSnapshot = {
  endpoint: string;
  badgeCount: number;
};

async function syncSupportAppBadge(unreadCount: number) {
  syncFaollaNativeUnreadBadge(unreadCount);
  if (typeof navigator === "undefined") return;
  const badgingNavigator = navigator as SupportBadgingNavigator;
  try {
    if (unreadCount > 0) {
      if (typeof badgingNavigator.setAppBadge === "function") {
        await badgingNavigator.setAppBadge(unreadCount);
      }
      return;
    }
    if (typeof badgingNavigator.clearAppBadge === "function") {
      await badgingNavigator.clearAppBadge();
      return;
    }
    if (typeof badgingNavigator.setAppBadge === "function") {
      await badgingNavigator.setAppBadge(0);
    }
  } catch {
    // Ignore unsupported browsers or temporarily blocked badge updates.
  }
}

function canUseSupportSystemNotifications() {
  return canUseSupportPushInBrowser() || canUseFaollaNativeNotifications();
}

function readSupportNativeNotificationPermission(): FaollaNativeNotificationPermission {
  return canUseFaollaNativeNotifications() ? readFaollaNativeNotificationPermission() : "unsupported";
}

function buildSupportNativeNotificationBody(text: unknown) {
  const preview = formatSupportConversationPreview(String(text ?? ""));
  if (!preview) return "你有一条新消息";
  return preview.length > 72 ? `${preview.slice(0, 69).trimEnd()}...` : preview;
}

function buildSupportNativeNotificationUrl(merchantId: string, supportTarget: string) {
  const normalizedMerchantId = normalizeSupportDisplayValue(merchantId);
  const path = normalizedMerchantId || "admin";
  return `/${path}?support=${encodeURIComponent(supportTarget)}&appShell=faolla`;
}

type MerchantBusinessAttentionNotification = {
  key: string;
  title: string;
  body: string;
  url: string;
  createdAt: string;
};

type MerchantBusinessAttentionSummary = {
  count: number;
  latest: MerchantBusinessAttentionNotification | null;
};

function normalizeMerchantBusinessAttentionTimestamp(value: unknown, fallback: unknown = "") {
  return normalizeSupportMessageTimestamp(String(value ?? "")) || normalizeSupportMessageTimestamp(String(fallback ?? ""));
}

function formatMerchantBusinessAttentionDateTime(value: unknown) {
  const normalized = normalizeMerchantBusinessAttentionTimestamp(value);
  if (!normalized) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(normalized));
}

function buildMerchantBusinessNotificationUrl(merchantId: string, section: "booking" | "orders") {
  const path = normalizeSupportDisplayValue(merchantId) || "admin";
  return `/${path}?mobileTab=business&businessSection=${section}&appShell=faolla`;
}

function compareMerchantBusinessAttentionNotification(
  left: MerchantBusinessAttentionNotification | null,
  right: MerchantBusinessAttentionNotification | null,
) {
  if (!left) return right;
  if (!right) return left;
  const leftTime = new Date(left.createdAt).getTime();
  const rightTime = new Date(right.createdAt).getTime();
  if (rightTime > leftTime) return right;
  if (rightTime < leftTime) return left;
  return right.key > left.key ? right : left;
}

function summarizeMerchantBookingAttentionRecords(
  records: MerchantBookingRecord[],
  merchantId: string,
): MerchantBusinessAttentionSummary {
  return records.reduce<MerchantBusinessAttentionSummary>(
    (summary, booking) => {
      if (!isMerchantBookingNewForMerchant(booking)) return summary;
      const createdAt = normalizeMerchantBusinessAttentionTimestamp(booking.updatedAt, booking.createdAt);
      const customerName = normalizeSupportDisplayValue(booking.customerName) || "客户";
      const serviceParts = [
        normalizeSupportDisplayValue(booking.store),
        normalizeSupportDisplayValue(booking.item) || normalizeSupportDisplayValue(booking.title),
      ].filter(Boolean);
      const appointmentText = formatMerchantBusinessAttentionDateTime(booking.appointmentAt);
      const body = buildSupportNativeNotificationBody(
        [serviceParts.join(" · "), appointmentText].filter(Boolean).join(" · ") || "有新的预约需要处理",
      );
      return {
        count: summary.count + 1,
        latest: compareMerchantBusinessAttentionNotification(summary.latest, {
          key: `booking:${booking.id}`,
          title: `新预约 - ${customerName}`,
          body,
          url: buildMerchantBusinessNotificationUrl(merchantId, "booking"),
          createdAt,
        }),
      };
    },
    { count: 0, latest: null },
  );
}

function summarizeMerchantOrderAttentionRecords(
  records: MerchantOrderRecord[],
  merchantId: string,
): MerchantBusinessAttentionSummary {
  return records.reduce<MerchantBusinessAttentionSummary>(
    (summary, order) => {
      if (!isMerchantOrderNewForMerchant(order)) return summary;
      const createdAt = normalizeMerchantBusinessAttentionTimestamp(order.updatedAt, order.createdAt);
      const customerName =
        normalizeSupportDisplayValue(order.customer?.name) ||
        normalizeSupportDisplayValue(order.customer?.phone) ||
        "客户";
      const itemSummary =
        order.items
          .slice(0, 2)
          .map((item) => {
            const name = normalizeSupportDisplayValue(item.name) || normalizeSupportDisplayValue(item.code) || "商品";
            return item.quantity > 1 ? `${name}×${item.quantity}` : name;
          })
          .filter(Boolean)
          .join("、") || `${Math.max(1, order.totalQuantity)}件商品`;
      const amount = formatMerchantOrderAmount(order.totalAmount, order.pricePrefix);
      return {
        count: summary.count + 1,
        latest: compareMerchantBusinessAttentionNotification(summary.latest, {
          key: `order:${order.id}`,
          title: `新订单 - ${customerName}`,
          body: buildSupportNativeNotificationBody([itemSummary, amount].filter(Boolean).join(" · ")),
          url: buildMerchantBusinessNotificationUrl(merchantId, "orders"),
          createdAt,
        }),
      };
    },
    { count: 0, latest: null },
  );
}

function readSupportPushPublicKey() {
  return String(process.env.NEXT_PUBLIC_WEB_PUSH_PUBLIC_KEY ?? "").trim();
}

function canUseSupportPushInBrowser() {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  return Boolean(
    readSupportPushPublicKey() &&
      "serviceWorker" in navigator &&
      "PushManager" in window &&
      "Notification" in window,
  );
}

function isSupportStandaloneDisplayMode() {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  const navigatorWithStandalone = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia?.("(display-mode: standalone)").matches || navigatorWithStandalone.standalone === true;
}

function decodeSupportPushBase64(base64Value: string) {
  const normalized = base64Value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = "=".repeat((4 - (normalized.length % 4 || 4)) % 4);
  const binary = atob(`${normalized}${padding}`);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function syncSupportServiceWorkerBadge(unreadCount: number) {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  const registration = await navigator.serviceWorker.getRegistration().catch(() => null);
  const target = registration?.active ?? registration?.waiting ?? registration?.installing ?? navigator.serviceWorker.controller;
  if (!target) return;
  target.postMessage({
    type: "SYNC_BADGE",
    unreadCount,
  });
}

async function syncSupportServiceWorkerVisibility(visible: boolean) {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  const registration = await navigator.serviceWorker.getRegistration().catch(() => null);
  const target = registration?.active ?? registration?.waiting ?? registration?.installing ?? navigator.serviceWorker.controller;
  if (!target) return;
  target.postMessage({
    type: "SYNC_VISIBILITY",
    visible,
  });
}

function normalizeSupportPushSubscriptionSnapshotList(
  value: unknown,
): SupportPushSubscriptionSnapshot[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const source = item as { endpoint?: unknown; badgeCount?: unknown };
      const endpoint = typeof source.endpoint === "string" ? source.endpoint.trim() : "";
      if (!endpoint) return null;
      const badgeCount =
        typeof source.badgeCount === "number" && Number.isFinite(source.badgeCount)
          ? Math.max(0, Math.min(999, Math.round(source.badgeCount)))
          : Number.parseInt(String(source.badgeCount ?? "").trim(), 10);
      return {
        endpoint,
        badgeCount: Number.isFinite(badgeCount) ? Math.max(0, Math.min(999, badgeCount)) : 0,
      } satisfies SupportPushSubscriptionSnapshot;
    })
    .filter((item): item is SupportPushSubscriptionSnapshot => Boolean(item));
}

type SupportAvatarBadgeProps = {
  label: string;
  imageUrl?: string | null;
  className?: string;
  labelClassName?: string;
  imageAlt?: string;
  showMerchantBadge?: boolean;
};

function buildSupportPublishedProfileFromSite(site: Site): MerchantListPublishedSite {
  return {
    id: site.id,
    merchantName: site.merchantName,
    signature: site.signature,
    domainPrefix: site.domainPrefix,
    domainSuffix: site.domainSuffix,
    name: site.name,
    domain: site.domain,
    category: site.category,
    industry: site.industry,
    location: site.location,
    contactAddress: site.contactAddress,
    contactName: site.contactName,
    contactPhone: site.contactPhone,
    contactEmail: site.contactEmail,
    merchantCardImageUrl: site.merchantCardImageUrl,
    chatAvatarImageUrl: site.chatAvatarImageUrl,
    contactVisibility: site.contactVisibility ?? createDefaultMerchantContactVisibility(),
    permissionConfig: site.permissionConfig ?? createDefaultMerchantPermissionConfig(),
    merchantCardImageOpacity: site.merchantCardImageOpacity,
    businessCards: normalizeMerchantBusinessCards(site.businessCards ?? []),
    chatBusinessCard: resolveMerchantBusinessCardForChatDisplay(site.businessCards ?? []),
    status: site.status,
    serviceExpiresAt: site.serviceExpiresAt ?? null,
    sortConfig: site.sortConfig ?? createDefaultMerchantSortConfig(),
    createdAt: site.createdAt,
  };
}

function mergeSupportPublishedProfileIntoSite(
  site: Site,
  profile: MerchantListPublishedSite | null | undefined,
): Site {
  if (!profile) return site;

  const nextIndustry = normalizeSupportDisplayValue(profile.industry);
  const nextCategory = normalizeSupportDisplayValue(profile.category);
  const nextLocation = profile.location;
  const hasNextLocation =
    !!nextLocation &&
    [
      nextLocation.countryCode,
      nextLocation.country,
      nextLocation.provinceCode,
      nextLocation.province,
      nextLocation.city,
    ].some((value) => normalizeSupportDisplayValue(value));

  return {
    ...site,
    merchantName: normalizeSupportDisplayValue(profile.merchantName) || site.merchantName,
    signature:
      normalizeSupportDisplayValue(profile.signature) ||
      normalizeSupportDisplayValue(site.signature),
    domainPrefix: normalizeSupportDisplayValue(profile.domainPrefix) || site.domainPrefix,
    domainSuffix: normalizeSupportDisplayValue(profile.domainSuffix) || site.domainSuffix,
    name: normalizeSupportDisplayValue(profile.name) || site.name,
    domain: normalizeSupportDisplayValue(profile.domain) || site.domain,
    category: nextCategory || site.category,
    industry: (nextIndustry || site.industry) as Site["industry"],
    location: hasNextLocation ? nextLocation : site.location,
    contactAddress: normalizeSupportDisplayValue(profile.contactAddress) || site.contactAddress,
    contactName: normalizeSupportDisplayValue(profile.contactName) || site.contactName,
    contactPhone: normalizeSupportDisplayValue(profile.contactPhone) || site.contactPhone,
    contactEmail: normalizeSupportDisplayValue(profile.contactEmail) || site.contactEmail,
    merchantCardImageUrl: normalizeSupportDisplayValue(profile.merchantCardImageUrl) || site.merchantCardImageUrl,
    chatAvatarImageUrl: normalizeSupportDisplayValue(profile.chatAvatarImageUrl) || site.chatAvatarImageUrl,
    contactVisibility: profile.contactVisibility ?? site.contactVisibility ?? createDefaultMerchantContactVisibility(),
    permissionConfig: profile.permissionConfig ?? site.permissionConfig ?? createDefaultMerchantPermissionConfig(),
    merchantCardImageOpacity:
      typeof profile.merchantCardImageOpacity === "number"
        ? profile.merchantCardImageOpacity
        : site.merchantCardImageOpacity,
    businessCards: Array.isArray(profile.businessCards)
      ? mergeSupportBusinessCardLists(site.businessCards ?? [], profile.businessCards)
      : site.businessCards,
    serviceExpiresAt: profile.serviceExpiresAt ?? site.serviceExpiresAt ?? null,
    sortConfig: profile.sortConfig ?? site.sortConfig ?? createDefaultMerchantSortConfig(),
    createdAt: normalizeSupportDisplayValue(profile.createdAt) || site.createdAt,
  };
}

function SupportAvatarBadge({
  label,
  imageUrl,
  className = "",
  labelClassName = "",
  imageAlt = "",
  showMerchantBadge = false,
}: SupportAvatarBadgeProps) {
  const normalizedImageUrl = normalizePublicAssetUrl(imageUrl ?? "");
  return (
    <div className={`faolla-support-avatar relative rounded-full ${className}`.trim()}>
      <div className="flex h-full w-full items-center justify-center overflow-hidden rounded-full">
        {normalizedImageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={normalizedImageUrl} alt={imageAlt || label} className="h-full w-full object-cover" />
        ) : (
          <span className={labelClassName}>{label}</span>
        )}
      </div>
      {showMerchantBadge ? <MerchantAvatarBadge /> : null}
    </div>
  );
}

function MerchantAvatarBadge() {
  return (
    <span className="pointer-events-none absolute -right-1.5 -top-1.5 z-10 inline-flex h-5 w-5 items-center justify-center rounded-[9px] border-2 border-white bg-[linear-gradient(135deg,#020617_0%,#1e293b_62%,#f59e0b_180%)] text-[10px] font-black leading-none tracking-[-0.08em] text-amber-200 shadow-[0_7px_16px_rgba(15,23,42,0.28)] ring-1 ring-slate-950/10">
      M
    </span>
  );
}

async function copySupportTextToClipboard(value: string) {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  if (typeof document === "undefined") {
    throw new Error("clipboard_unavailable");
  }
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.left = "-99999px";
  textarea.style.top = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) {
    throw new Error("clipboard_unavailable");
  }
}

function compareSupportMessages(left: Pick<PlatformSupportMessage, "createdAt" | "id">, right: Pick<PlatformSupportMessage, "createdAt" | "id">) {
  const leftTs = new Date(left.createdAt).getTime();
  const rightTs = new Date(right.createdAt).getTime();
  if (leftTs !== rightTs) return leftTs - rightTs;
  return left.id.localeCompare(right.id, "en");
}

function buildVisibleSupportMessageKey(message: {
  id: string;
  createdAt: string;
  localStatus?: LocalSupportMessageStatus | null;
}) {
  return `${message.id}:${normalizeSupportMessageTimestamp(message.createdAt) || message.createdAt}:${message.localStatus ?? "server"}`;
}

export default function AdminClient({
  forcedScope,
  editorTitle = "页面编辑",
  frontendHref = "/site/site-main",
  editorMode = "merchant",
  forceDesktopEditorSidebar = false,
  showPublishActions,
  initialPublishedBlocks,
  initialJustSignedIn = false,
  startInLoadingState = false,
}: AdminClientProps = {}) {
  const [storeScope] = useState<string>(() => readBlocksStoreScopeFromLocation(forcedScope));
  const { locale, setLocale, t } = useI18n();
  const [justSignedIn] = useState<boolean>(() => {
    if (typeof window === "undefined") return initialJustSignedIn;
    try {
      return new URLSearchParams(window.location.search).get("justSignedIn") === "1" || initialJustSignedIn;
    } catch {
      return initialJustSignedIn;
    }
  });
  const [explicitFaollaSectionEntry] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return isFaollaSectionSearch(window.location.search);
  });
  const [merchantEditorOnly] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      return new URLSearchParams(window.location.search).get("editorOnly") === "1";
    } catch {
      return false;
    }
  });
  const isPlatformEditor = editorMode === "platform";
  const [initialPlatformState] = useState(() => loadPlatformState());
  useMobilePortraitOrientationLock(!isPlatformEditor);
  const [platformSeedBlocks] = useState<Block[]>(() =>
    isPlatformEditor && Array.isArray(initialPublishedBlocks)
      ? sanitizeBlocksForRuntime(initialPublishedBlocks).blocks
      : [],
  );
  const defaultEditorBlocks =
    isPlatformEditor
      ? (platformSeedBlocks.length > 0 ? platformSeedBlocks : homeBlocks)
      : MERCHANT_ONBOARDING_BLOCKS;
  const initialPlanConfig = getPagePlanConfigFromBlocks(defaultEditorBlocks);
  const initialMobilePlanConfig =
    getEmbeddedMobilePlanConfig(defaultEditorBlocks) ?? adaptPlanConfigForMobile(JSON.parse(JSON.stringify(initialPlanConfig)) as PagePlanConfig);
  const initialEditingPlanId = initialPlanConfig.activePlanId;
  const initialEditingPageId =
    initialPlanConfig.plans.find((plan) => plan.id === initialEditingPlanId)?.activePageId ?? "page-1";
  const initialBlocks = cloneBlocks(
    getBlocksForPage(
      initialPlanConfig.plans.find((plan) => plan.id === initialEditingPlanId) ?? initialPlanConfig.plans[0],
      initialEditingPageId,
    ),
  );
  const [planConfig, setPlanConfig] = useState<PagePlanConfig>(initialPlanConfig);
  const [editingPlanId, setEditingPlanId] = useState<PlanId>(initialEditingPlanId);
  const [editingPageId, setEditingPageId] = useState<string>(initialEditingPageId);
  const [blocks, setBlocks] = useState<Block[]>(initialBlocks);
  const [hasAddedExtraBlock, setHasAddedExtraBlock] = useState(
    () => initialBlocks.length > 1 || initialBlocks.some((item) => item.type !== "nav"),
  );
  const [selectedId, setSelectedId] = useState<string>("");
  const [draggingBlockId, setDraggingBlockId] = useState<string | null>(null);
  const dragStartRef = useRef<{
    blockId: string;
    blockIds: string[];
    pointerX: number;
    pointerY: number;
    startOffsets: Record<string, { x: number; y: number }>;
    historyRecorded: boolean;
  } | null>(null);
  const dragMoveRafRef = useRef<number | null>(null);
  const dragPendingPointerRef = useRef<{ x: number; y: number } | null>(null);
  const blocksRef = useRef<Block[]>(initialBlocks);
  const pendingBlockPatchesRef = useRef<Record<string, Partial<Block["props"]>>>({});
  const pendingBlockPatchRafRef = useRef<number | null>(null);
  const blockPatchHistoryBurstRef = useRef(false);
  const blockPatchHistoryResetTimeoutRef = useRef<number | null>(null);
  const pendingBlockNudgesRef = useRef<Record<string, { deltaX: number; deltaY: number }>>({});
  const pendingBlockNudgeRafRef = useRef<number | null>(null);
  const blockNudgeHistoryBurstRef = useRef(false);
  const blockNudgeHistoryResetTimeoutRef = useRef<number | null>(null);
  const pendingPlanSyncBlocksRef = useRef<Block[] | null>(null);
  const pendingPlanSyncSyncNavPagesRef = useRef(false);
  const pendingPlanSyncTimeoutRef = useRef<number | null>(null);
  const flushPendingEditorChangesRef = useRef<() => void>(() => {});
  const editorAvailablePagesRef = useRef<Array<{ id: string; name: string }>>([]);
  const editorAvailablePagesKeyRef = useRef("");
  const [newBlockType, setNewBlockType] = useState<Block["type"]>("common");
  const [previewViewport, setPreviewViewport] = useState<"desktop" | "mobile">("desktop");
  const [tip, setTip] = useState<string>("");
  const [merchantPlatformState, setMerchantPlatformState] = useState(() =>
    isPlatformEditor ? null : initialPlatformState,
  );
  const [backendNotice, setBackendNotice] = useState<string | null>(supabaseMissingEnvNotice);
  const [dialog, setDialog] = useState<CenterDialog | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(startInLoadingState);
  const checkingAuthRef = useRef(startInLoadingState);
  const [hasEditorContent, setHasEditorContent] = useState(true);
  const [remoteContentVerified, setRemoteContentVerified] = useState<boolean>(
    () => !isSupabaseEnabled || isSupabaseFallbackMode || hasRemoteContentVerifiedStamp([storeScope]),
  );
  const [publishing, setPublishing] = useState(false);
  const publishingRef = useRef(false);
  const [editorUploadBusy, setEditorUploadBusy] = useState(false);
  const [editorUploadMessage, setEditorUploadMessage] = useState("");
  const editorUploadBusyCountRef = useRef(0);
  const [loggingOut, setLoggingOut] = useState(false);
  const [accountSwitcherOpen, setAccountSwitcherOpen] = useState(false);
  const [accountSwitchEntries, setAccountSwitchEntries] = useState<AccountSwitchEntry[]>(() => readAccountSwitchEntries());
  const [accountSwitchBusyKey, setAccountSwitchBusyKey] = useState("");
  const [accountSwitchError, setAccountSwitchError] = useState("");
  const [merchantDesktopSection, setMerchantDesktopSectionState] = useState<MerchantDesktopSection>("editor");
  const merchantDesktopSectionRef = useRef<MerchantDesktopSection>("editor");
  merchantDesktopSectionRef.current = merchantDesktopSection;
  const [merchantMemberSettingsView, setMerchantMemberSettingsView] = useState<MerchantMemberSettingsView>("list");
  const [merchantEnterpriseView, setMerchantEnterpriseView] = useState<MerchantEnterpriseView>("overview");
  const merchantEnterpriseViewChangeGuardRef = useRef<
    ((view: MerchantEnterpriseView | null) => boolean) | null
  >(null);
  const merchantEnterpriseLeaveGuardRef = useRef<(() => boolean) | null>(null);
  const supportMobileEnterpriseLeaveGuardRef = useRef<(() => boolean) | null>(null);
  const setMerchantDesktopSection = useCallback(
    (section: MerchantDesktopSection) => {
      if (
        merchantDesktopSectionRef.current === "enterprise" &&
        section !== "enterprise" &&
        merchantEnterpriseLeaveGuardRef.current &&
        !merchantEnterpriseLeaveGuardRef.current()
      ) {
        return false;
      }
      merchantDesktopSectionRef.current = section;
      setMerchantDesktopSectionState(section);
      return true;
    },
    [],
  );
  const [merchantEnterpriseTaskIntent, setMerchantEnterpriseTaskIntent] =
    useState<MerchantOrderTaskDraftIntent | null>(null);
  const [merchantOrderSourceIntent, setMerchantOrderSourceIntent] =
    useState<MerchantOrderSourceDetailIntent | null>(null);
  const [merchantEnterpriseAvailableViews, setMerchantEnterpriseAvailableViews] = useState<
    readonly MerchantEnterpriseView[]
  >([]);
  const [merchantEnterpriseTodoCount, setMerchantEnterpriseTodoCount] = useState(0);
  const merchantDesktopDefaultSectionSiteRef = useRef("");
  const [merchantLogFailureSnapshots, setMerchantLogFailureSnapshots] = useState<
    ReturnType<typeof readPublishFailureSnapshots>
  >([]);
  const [merchantOperationLogs, setMerchantOperationLogs] = useState<MerchantOperationLogEntry[]>([]);
  const [merchantOperationLogModuleFilter, setMerchantOperationLogModuleFilter] = useState("all");
  const [merchantOperationLogStatusFilter, setMerchantOperationLogStatusFilter] = useState<"all" | MerchantOperationLogStatus>("all");
  const [merchantOperationLogStartDate, setMerchantOperationLogStartDate] = useState("");
  const [merchantOperationLogEndDate, setMerchantOperationLogEndDate] = useState("");
  const [merchantOperationLogTotal, setMerchantOperationLogTotal] = useState(0);
  const [merchantOperationLogAllTotal, setMerchantOperationLogAllTotal] = useState(0);
  const [merchantOperationLogSuccessTotal, setMerchantOperationLogSuccessTotal] = useState(0);
  const [merchantOperationLogFailedTotal, setMerchantOperationLogFailedTotal] = useState(0);
  const [merchantOperationLogModules, setMerchantOperationLogModules] = useState<string[]>([]);
  const [merchantOperationLogHasMore, setMerchantOperationLogHasMore] = useState(false);
  const [merchantOperationLogsLoading, setMerchantOperationLogsLoading] = useState(false);
  const [merchantOperationLogsError, setMerchantOperationLogsError] = useState("");
  const merchantOperationLogsCountRef = useRef(0);
  const merchantOperationLogsRequestIdRef = useRef(0);
  const merchantOperationLogStartPickerRef = useRef<HTMLInputElement>(null);
  const merchantOperationLogEndPickerRef = useRef<HTMLInputElement>(null);
  const [europeLocationOptionsApi, setEuropeLocationOptionsApi] = useState<EuropeLocationOptionsApi | null>(null);
  const [merchantProfileDialogOpen, setMerchantProfileDialogOpen] = useState(false);
  const [merchantProfileDialogShowBusinessCards, setMerchantProfileDialogShowBusinessCards] = useState(true);
  const [merchantSiteIdOverride, setMerchantSiteIdOverride] = useState("");
  const [merchantBookingManagerOpen, setMerchantBookingManagerOpen] = useState(false);
  const [merchantOrderManagerOpen, setMerchantOrderManagerOpen] = useState(false);
  const [merchantCouponRecords, setMerchantCouponRecords] = useState<MerchantCouponRecord[]>([]);
  const [merchantBookingWorkbenchOpen, setMerchantBookingWorkbenchOpen] = useState(false);
  const [merchantOrderWorkbenchOpen, setMerchantOrderWorkbenchOpen] = useState(false);
  const [merchantBookingAttentionSummary, setMerchantBookingAttentionSummary] = useState<MerchantBusinessAttentionSummary>({
    count: 0,
    latest: null,
  });
  const [merchantOrderAttentionSummary, setMerchantOrderAttentionSummary] = useState<MerchantBusinessAttentionSummary>({
    count: 0,
    latest: null,
  });
  const [merchantBusinessAttentionHydrationState, setMerchantBusinessAttentionHydrationState] = useState({
    booking: false,
    orders: false,
  });
  const [supportDialogOpen, setSupportDialogOpen] = useState(false);
  const [supportDataActivated, setSupportDataActivated] = useState(false);
  const [supportThread, setSupportThread] = useState<PlatformSupportThread | null>(null);
  const [supportLoading, setSupportLoading] = useState(false);
  const [supportSending, setSupportSending] = useState(false);
  const [supportError, setSupportError] = useState("");
  const [supportDraft, setSupportDraft] = useState("");
  const [supportAttachmentBusy, setSupportAttachmentBusy] = useState(false);
  const [supportAttachmentMenuOpen, setSupportAttachmentMenuOpen] = useState(false);
  const [supportEmojiMenuOpen, setSupportEmojiMenuOpen] = useState(false);
  const [supportSelfCardPickerOpen, setSupportSelfCardPickerOpen] = useState(false);
  const [supportSelfCardPickerCards, setSupportSelfCardPickerCards] = useState<MerchantBusinessCardAsset[] | null>(null);
  const [supportMessageContextMenu, setSupportMessageContextMenu] = useState<SupportMessageContextMenuState | null>(null);
  const [supportPinnedMessage, setSupportPinnedMessage] = useState<{ key: string; text: string } | null>(null);
  const [supportReplyDraft, setSupportReplyDraft] = useState<SupportReplyDraft | null>(null);
  const [supportPendingImageDrafts, setSupportPendingImageDrafts] = useState<SupportPendingImageDraft[]>([]);
  const [supportStarredMessageKeys, setSupportStarredMessageKeys] = useState<string[]>([]);
  const [supportSelectedMessageKeys, setSupportSelectedMessageKeys] = useState<string[]>([]);
  const [supportHiddenMessageKeys, setSupportHiddenMessageKeys] = useState<string[]>([]);
  const [supportContactKeyword, setSupportContactKeyword] = useState("");
  const [supportLastReadAt, setSupportLastReadAt] = useState("");
  const [supportPeerLastReadMap, setSupportPeerLastReadMap] = useState<Record<string, string>>({});
  const [supportLocalMessages, setSupportLocalMessages] = useState<LocalSupportMessage[]>([]);
  const [supportPeerContacts, setSupportPeerContacts] = useState<MerchantPeerContactSummary[]>([]);
  const [supportPeerThreads, setSupportPeerThreads] = useState<MerchantPeerThread[]>([]);
  const supportPeerThreadsRef = useRef<MerchantPeerThread[]>([]);
  const [supportPeerLoading, setSupportPeerLoading] = useState(false);
  const [supportPeerHistoryLoading, setSupportPeerHistoryLoading] = useState(false);
  const [supportPeerMessagePageByMerchantId, setSupportPeerMessagePageByMerchantId] = useState<
    Record<string, { total: number; offset: number; limit: number; hasMore: boolean }>
  >({});
  const [supportPeerError, setSupportPeerError] = useState("");
  const [supportSearchLoading, setSupportSearchLoading] = useState(false);
  const [supportSearchError, setSupportSearchError] = useState("");
  const [supportSelectedContactKey, setSupportSelectedContactKey] = useState(SUPPORT_OFFICIAL_CONTACT_KEY);
  const [supportMobileView, setSupportMobileView] = useState<"list" | "thread">("list");
  const [supportMobileHomeTab, setSupportMobileHomeTab] = useState<SupportMobileHomeTab>("conversations");
  const supportMobileHomeTabRef = useRef<SupportMobileHomeTab>("conversations");
  useEffect(() => {
    checkingAuthRef.current = checkingAuth;
  }, [checkingAuth]);
  useEffect(() => {
    if (checkingAuth || !hasEditorContent || typeof window === "undefined") return;
    let storage: AdminAutoReloadStorage | null = null;
    try {
      storage = window.sessionStorage;
    } catch {
      storage = null;
    }
    clearAdminAutoReload(storage, window.location.pathname);
  }, [checkingAuth, hasEditorContent]);
  useEffect(() => {
    if (checkingAuth || hasEditorContent || !backendNotice || typeof window === "undefined") return;
    let storage: AdminAutoReloadStorage | null = null;
    try {
      storage = window.sessionStorage;
    } catch {
      storage = null;
    }
    if (claimAdminAutoReload(storage, window.location.pathname)) {
      window.location.reload();
    }
  }, [backendNotice, checkingAuth, hasEditorContent]);
  useEffect(() => {
    supportMobileHomeTabRef.current = supportMobileHomeTab;
  }, [supportMobileHomeTab]);
  const [supportFaollaEmbedHref, setSupportFaollaEmbedHref] = useState(readInitialSupportFaollaEmbedHref);
  const [supportFaollaFrameHref, setSupportFaollaFrameHref] = useState(() => supportFaollaEmbedHref);
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!explicitFaollaSectionEntry) return;
    const storedHref = readStoredFaollaEntryUrl(window.location.origin) || "/";
    const nextHref = resolveFaollaEntryUrlFromBrowser(window.location.search, window.location.origin) || storedHref;
    setSupportFaollaEmbedHref(nextHref);
    setSupportFaollaFrameHref(nextHref);
    setMerchantDesktopSection("faolla");
    setSupportMobileHomeTab("faolla");
  }, [explicitFaollaSectionEntry, setMerchantDesktopSection]);
  const [supportMobileBusinessSection, setSupportMobileBusinessSection] = useState<"booking" | "orders">("booking");
  const [supportSelfSectionView, setSupportSelfSectionView] = useState<SupportSelfSectionView>("home");
  const faollaAndroidAppUpdate = useFaollaAndroidAppUpdate({ enabled: !explicitFaollaSectionEntry });
  const supportSelfSectionResetReadyRef = useRef(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const targetTab = params.get("mobileTab");
    const targetSection = params.get("selfSection");
    const targetBusinessSection = params.get("businessSection");
    const tankBattleReturnTarget = readTankBattleLobbyReturnTarget("merchant");
    if (targetTab === "business") {
      const nextBusinessSection = targetBusinessSection === "orders" ? "orders" : "booking";
      setSupportMobileHomeTab("business");
      setSupportMobileBusinessSection(nextBusinessSection);
      setMerchantDesktopSection(nextBusinessSection === "orders" ? "orders" : "booking");
      return;
    }
    if (targetTab !== "self" && !targetSection && !tankBattleReturnTarget) return;
    setSupportMobileHomeTab("self");
    let clearReturnTargetTimer: number | null = null;
    if (
      targetSection === "home" ||
      targetSection === "profile" ||
      targetSection === "cards" ||
      targetSection === "coupons" ||
      targetSection === "tools" ||
      targetSection === "games" ||
      targetSection === "qr"
    ) {
      setSupportSelfSectionView(targetSection);
    } else if (isFaollaMobileSettingsView(targetSection)) {
      setSupportSelfSectionView(targetSection);
    } else if (targetSection === "notifications") {
      setSupportSelfSectionView("settings-notifications");
    } else if (tankBattleReturnTarget) {
      setSupportSelfSectionView("games");
    }
    if (tankBattleReturnTarget && window.location.pathname !== "/admin") {
      clearReturnTargetTimer = window.setTimeout(() => clearTankBattleLobbyReturnTarget("merchant"), 2500);
    }
    return () => {
      if (clearReturnTargetTimer !== null) window.clearTimeout(clearReturnTargetTimer);
    };
  }, [setMerchantDesktopSection]);
  const [supportPeerLocalMessages, setSupportPeerLocalMessages] = useState<LocalPeerSupportMessage[]>([]);
  const [supportBusinessCardDialogOpen, setSupportBusinessCardDialogOpen] = useState(false);
  const [supportMerchantInfoSheetOpen, setSupportMerchantInfoSheetOpen] = useState(false);
  const [supportBusinessCardLoading, setSupportBusinessCardLoading] = useState(false);
  const [supportBusinessCardError, setSupportBusinessCardError] = useState("");
  const [supportImagePreview, setSupportImagePreview] = useState<{
    rawText: string;
    imageUrl: string;
    linkUrl: string;
    title: string;
  } | null>(null);
  const [supportSelfProfileSaving, setSupportSelfProfileSaving] = useState(false);
  const [supportSelfAvatarUploading, setSupportSelfAvatarUploading] = useState(false);
  const [supportSelfSignatureDraft, setSupportSelfSignatureDraft] = useState("");
  const [supportSelfSignatureDirty, setSupportSelfSignatureDirty] = useState(false);
  const [supportPushPermission, setSupportPushPermission] = useState<NotificationPermission | "unsupported">(() =>
    canUseSupportPushInBrowser() ? Notification.permission : "unsupported",
  );
  const [supportPushSubscribed, setSupportPushSubscribed] = useState(false);
  const [supportPushEndpoint, setSupportPushEndpoint] = useState("");
  const [supportPushBusy, setSupportPushBusy] = useState(false);
  const [supportPushError, setSupportPushError] = useState("");
  const [supportRemoteBadgeCount, setSupportRemoteBadgeCount] = useState(0);
  const [supportPushBadgeHydrated, setSupportPushBadgeHydrated] = useState(false);
  const [supportNativeAccessToken, setSupportNativeAccessToken] = useState("");
  const [supportNativeRefreshToken, setSupportNativeRefreshToken] = useState("");
  const [supportFailedMessageActionKey, setSupportFailedMessageActionKey] = useState("");
  const [supportUnreadHydrationState, setSupportUnreadHydrationState] = useState({
    official: false,
    peer: false,
  });
  const [supportReadStateHydrated, setSupportReadStateHydrated] = useState({
    official: false,
    peer: false,
  });
  const [supportPushStandalone, setSupportPushStandalone] = useState(() => isSupportStandaloneDisplayMode());
  const [supportSystemNotificationsEnabled, setSupportSystemNotificationsEnabled] = useState(
    DEFAULT_SUPPORT_NOTIFICATION_PREFERENCES.systemNotificationsEnabled,
  );
  const [supportMessageSoundEnabled, setSupportMessageSoundEnabled] = useState(
    DEFAULT_SUPPORT_NOTIFICATION_PREFERENCES.messageSoundEnabled,
  );
  const [supportVibrationEnabled, setSupportVibrationEnabled] = useState(
    DEFAULT_SUPPORT_NOTIFICATION_PREFERENCES.vibrationEnabled,
  );
  const [supportPendingDeepLink, setSupportPendingDeepLink] = useState(() =>
    typeof window === "undefined"
      ? ""
      : normalizeSupportConversationDeepLink(new URLSearchParams(window.location.search).get("support")),
  );
  const [supportPeerBusinessCardByMerchantId, setSupportPeerBusinessCardByMerchantId] = useState<
    Record<string, MerchantBusinessCardAsset | null>
  >({});
  const [supportPeerProfilesByMerchantId, setSupportPeerProfilesByMerchantId] = useState<
    Record<string, MerchantListPublishedSite | null>
  >({});
  const [mobileVisualViewportMetrics, setMobileVisualViewportMetrics] = useState(() => readMobileVisualViewportMetrics());
  const supportRequestIdRef = useRef(0);
  const supportPeerRequestIdRef = useRef(0);
  const supportSendingRef = useRef(false);
  const supportSendPointerHandledRef = useRef(false);
  const supportMessagesViewportRef = useRef<HTMLDivElement>(null);
  const supportMessageElementByKeyRef = useRef<Record<string, HTMLDivElement | null>>({});
  const supportMobileConversationsViewportRef = useRef<HTMLDivElement>(null);
  const supportDesktopFaollaFrameRef = useRef<HTMLIFrameElement>(null);
  const supportMobileFaollaFrameRef = useRef<HTMLIFrameElement>(null);
  const supportFaollaBackendResetAtRef = useRef(0);
  const supportInputRef = useRef<HTMLTextAreaElement>(null);
  const supportComposerRef = useRef<HTMLDivElement>(null);
  const supportSelfLanguageRootRef = useRef<HTMLDivElement>(null);
  const supportSelfLanguageMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isPlatformEditor || typeof window === "undefined") return;
    let cancelled = false;
    const applySessionTokens = (session: { access_token?: string | null; refresh_token?: string | null } | null | undefined) => {
      if (cancelled) return;
      setSupportNativeAccessToken(String(session?.access_token ?? "").trim());
      setSupportNativeRefreshToken(String(session?.refresh_token ?? "").trim());
    };
    void supabase.auth
      .getSession()
      .then(({ data }) => applySessionTokens(data.session))
      .catch(() => applySessionTokens(null));
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      applySessionTokens(session);
    });
    return () => {
      cancelled = true;
      data.subscription.unsubscribe();
    };
  }, [isPlatformEditor]);
  const supportSelfAvatarInputRef = useRef<HTMLInputElement>(null);
  const [supportSelfResolvedCardHref, setSupportSelfResolvedCardHref] = useState("");
  const [supportSelfResolvedCardId, setSupportSelfResolvedCardId] = useState("");
  const supportSelfCardShareBundleRef = useRef<Record<string, { shareUrl: string; shareKey: string; imageUrl: string }>>(
    {},
  );
  const supportLastIncomingAdminMessageKeyRef = useRef("");
  const supportLastIncomingPeerMessageKeyRef = useRef("");
  const supportLastIncomingBusinessAttentionKeyRef = useRef("");
  const supportNotifiedEventStorageKeyRef = useRef("");
  const supportNotifiedEventKeysRef = useRef<Set<string>>(new Set());
  const supportLastVisibleMessageKeyRef = useRef("");
  const supportVisibleMessageKeysRef = useRef<string[]>([]);
  const supportInitialScrollConversationKeyRef = useRef("");
  const supportScrollStabilizationTargetKeyRef = useRef("");
  const supportScrollStabilizationUntilRef = useRef(0);
  const supportScrollToLatestPendingRef = useRef(false);
  const supportMobileSwipeStartRef = useRef<{ x: number; y: number; fromEdge: boolean } | null>(null);
  const supportSelfSwipeStartRef = useRef<{ x: number; y: number; fromEdge: boolean } | null>(null);
  const supportSelfScrollContainerRef = useRef<HTMLDivElement>(null);
  const merchantChatBusinessCardSyncTimerRef = useRef<number | null>(null);
  const merchantChatBusinessCardSyncPayloadRef = useRef("");
  const merchantChatBusinessCardSyncQueueRef = useRef<Promise<void>>(Promise.resolve());
  const hydrateSupportMerchantProfileRef = useRef<
    (
      merchantId: string,
      options?: { persistToLocalSite?: boolean },
    ) => Promise<{ profile: MerchantListPublishedSite | null; chatBusinessCard: MerchantBusinessCardAsset | null } | null>
  >(async () => null);
  const supportPeerProfileLoadingIdsRef = useRef(new Set<string>());
  const supportPeerProfileTaskByMerchantIdRef = useRef<
    Record<string, Promise<{ profile: MerchantListPublishedSite | null; chatBusinessCard: MerchantBusinessCardAsset | null } | null>>
  >({});
  const supportPeerProfileFetchedAtRef = useRef<Record<string, number>>({});
  const supportPeerProfileLocalMutationAtRef = useRef<Record<string, number>>({});
  const supportNotificationPreferencesKeyRef = useRef("");
  const merchantOperationLogSiteIdRef = useRef("");
  const mobileVisualViewportLayoutHeightRef = useRef(readMobileVisualViewportLayoutHeightCandidate());
  const mobileVisualViewportOrientationRef = useRef(readMobileVisualViewportOrientation());
  const [supportSelfLanguageMenuOpen, setSupportSelfLanguageMenuOpen] = useState(false);

  useEffect(() => {
    if (typeof document === "undefined" || typeof window === "undefined") return;
    const visible = merchantDesktopSection === "support" || merchantDesktopSection === "faolla";
    document.documentElement.setAttribute("data-desktop-language-switcher", visible ? "show" : "hide");
    window.dispatchEvent(new CustomEvent("merchant-desktop-language-switcher-change", { detail: { visible } }));
    return () => {
      document.documentElement.removeAttribute("data-desktop-language-switcher");
      window.dispatchEvent(new CustomEvent("merchant-desktop-language-switcher-change", { detail: { visible: false } }));
    };
  }, [merchantDesktopSection]);

  useEffect(() => {
    return installFrontendAuthBridgeResponder(() => readMerchantSessionPayload(3200).catch(() => null));
  }, []);

  const resizeSupportComposerInput = useCallback((target?: HTMLTextAreaElement | null) => {
    const input = target ?? supportInputRef.current;
    if (!input) return;
    const mode = input.dataset.supportAutoResize;
    if (mode !== "mobile" && mode !== "desktop") return;
    const minHeight = mode === "desktop" ? 36 : 24;
    const lineHeight = mode === "desktop" ? 20 : 24;
    const verticalPadding = mode === "desktop" ? 16 : 0;
    const maxHeight = lineHeight * 3 + verticalPadding;
    input.style.height = `${minHeight}px`;
    const nextHeight = Math.min(maxHeight, Math.max(minHeight, input.scrollHeight));
    input.style.height = `${nextHeight}px`;
    input.style.overflowY = input.scrollHeight > maxHeight ? "auto" : "hidden";
  }, []);
  const keepSupportComposerCaretVisible = useCallback((target?: HTMLTextAreaElement | null) => {
    const input = target ?? supportInputRef.current;
    if (!input || typeof window === "undefined") return;
    const selectionStart =
      typeof input.selectionStart === "number" ? Math.max(0, Math.min(input.selectionStart, input.value.length)) : input.value.length;
    const textBeforeCaret = input.value.slice(0, selectionStart);
    const caretLineIndex = Math.max(0, textBeforeCaret.split("\n").length - 1);
    const style = window.getComputedStyle(input);
    const parsedLineHeight = Number.parseFloat(style.lineHeight);
    const lineHeight = Number.isFinite(parsedLineHeight)
      ? parsedLineHeight
      : input.dataset.supportAutoResize === "mobile"
        ? 24
        : 20;
    const paddingTop = Number.parseFloat(style.paddingTop) || 0;
    const paddingBottom = Number.parseFloat(style.paddingBottom) || 0;
    const caretTop = paddingTop + caretLineIndex * lineHeight;
    const caretBottom = caretTop + lineHeight + paddingBottom;
    const visibleTop = input.scrollTop;
    const visibleBottom = visibleTop + input.clientHeight;
    if (caretBottom > visibleBottom) {
      input.scrollTop = Math.max(0, caretBottom - input.clientHeight);
    } else if (caretTop < visibleTop) {
      input.scrollTop = Math.max(0, caretTop - paddingTop);
    }
  }, []);
  const focusSupportInput = useCallback(() => {
    if (typeof window === "undefined") return;
    setSupportAttachmentMenuOpen(false);
    setSupportEmojiMenuOpen(false);
    setSupportSelfCardPickerOpen(false);
    setSupportMessageContextMenu(null);
    window.requestAnimationFrame(() => {
      const input = supportInputRef.current;
      if (!input || input.disabled) return;
      input.focus({ preventScroll: true });
      resizeSupportComposerInput(input);
      const caretPosition = input.value.length;
      try {
        input.setSelectionRange(caretPosition, caretPosition);
      } catch {
        // Ignore browsers that do not allow setting selection on this element state.
      }
      keepSupportComposerCaretVisible(input);
    });
  }, [keepSupportComposerCaretVisible, resizeSupportComposerInput]);
  const focusSupportInputImmediately = useCallback(() => {
    if (typeof document === "undefined") return;
    setSupportAttachmentMenuOpen(false);
    setSupportEmojiMenuOpen(false);
    setSupportSelfCardPickerOpen(false);
    setSupportMessageContextMenu(null);
    const input = supportInputRef.current;
    if (!input || input.disabled) return;
    input.focus({ preventScroll: true });
    resizeSupportComposerInput(input);
    const caretPosition = input.value.length;
    try {
      input.setSelectionRange(caretPosition, caretPosition);
    } catch {
      // Ignore browsers that do not allow setting selection on this element state.
    }
    keepSupportComposerCaretVisible(input);
  }, [keepSupportComposerCaretVisible, resizeSupportComposerInput]);
  const closeMobileSupportThread = useCallback(() => {
    setSupportBusinessCardDialogOpen(false);
    setSupportMerchantInfoSheetOpen(false);
    setSupportAttachmentMenuOpen(false);
    setSupportEmojiMenuOpen(false);
    setSupportMessageContextMenu(null);
    setSupportSelfCardPickerOpen(false);
    setSupportMobileView("list");
  }, []);
  const openSupportContactThread = useCallback((contactKey: string) => {
    setSupportAttachmentMenuOpen(false);
    setSupportEmojiMenuOpen(false);
    setSupportMessageContextMenu(null);
    setSupportSelfCardPickerOpen(false);
    setSupportSelectedContactKey(contactKey);
    setSupportMobileView("thread");
  }, []);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const syncMobileVisualViewportInsets = () => {
      const nextOrientation = readMobileVisualViewportOrientation();
      const nextLayoutHeightCandidate = readMobileVisualViewportLayoutHeightCandidate();
      if (mobileVisualViewportOrientationRef.current !== nextOrientation) {
        mobileVisualViewportOrientationRef.current = nextOrientation;
        mobileVisualViewportLayoutHeightRef.current = nextLayoutHeightCandidate;
      } else {
        const estimatedMetrics = readMobileVisualViewportMetrics(mobileVisualViewportLayoutHeightRef.current);
        const keyboardLikelyVisible = estimatedMetrics.bottom > 96;
        if (!keyboardLikelyVisible || nextLayoutHeightCandidate > mobileVisualViewportLayoutHeightRef.current) {
          mobileVisualViewportLayoutHeightRef.current = nextLayoutHeightCandidate;
        }
      }
      const nextMetrics = readMobileVisualViewportMetrics(mobileVisualViewportLayoutHeightRef.current);
      setMobileVisualViewportMetrics((current) =>
        current.top === nextMetrics.top &&
        current.bottom === nextMetrics.bottom &&
        current.height === nextMetrics.height
          ? current
          : nextMetrics,
      );
    };
    syncMobileVisualViewportInsets();
    window.addEventListener("resize", syncMobileVisualViewportInsets);
    window.addEventListener("orientationchange", syncMobileVisualViewportInsets);
    window.visualViewport?.addEventListener("resize", syncMobileVisualViewportInsets);
    window.visualViewport?.addEventListener("scroll", syncMobileVisualViewportInsets);
    return () => {
      window.removeEventListener("resize", syncMobileVisualViewportInsets);
      window.removeEventListener("orientationchange", syncMobileVisualViewportInsets);
      window.visualViewport?.removeEventListener("resize", syncMobileVisualViewportInsets);
      window.visualViewport?.removeEventListener("scroll", syncMobileVisualViewportInsets);
    };
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
  const handleSupportSelfSectionTouchStart = useCallback(
    (event: TouchEvent<HTMLDivElement>) => {
      if (supportSelfSectionView === "home") return;
      const touch = event.touches[0];
      if (!touch) return;
      supportSelfSwipeStartRef.current = {
        x: touch.clientX,
        y: touch.clientY,
        fromEdge: touch.clientX <= 36,
      };
    },
    [supportSelfSectionView],
  );
  const handleSupportSelfSectionTouchEnd = useCallback(
    (event: TouchEvent<HTMLDivElement>) => {
      const start = supportSelfSwipeStartRef.current;
      supportSelfSwipeStartRef.current = null;
      if (!start?.fromEdge || supportSelfSectionView === "home") return;
      const touch = event.changedTouches[0];
      if (!touch) return;
      const deltaX = touch.clientX - start.x;
      const deltaY = touch.clientY - start.y;
      if (deltaX >= 72 && Math.abs(deltaY) <= 64 && deltaX > Math.abs(deltaY) * 1.2) {
        if (isFaollaMobileSettingsView(supportSelfSectionView)) {
          setSupportSelfSectionView(getFaollaMobileSettingsBackView(supportSelfSectionView));
        } else {
          setSupportSelfSectionView("home");
        }
      }
    },
    [supportSelfSectionView],
  );
  const [merchantProfileAttention, setMerchantProfileAttention] = useState(false);
  const merchantProfileButtonRef = useRef<HTMLButtonElement>(null);
  const [topBarCollapsed, setTopBarCollapsed] = useState(false);
  const topBarRef = useRef<HTMLDivElement>(null);
  const [topBarHeight, setTopBarHeight] = useState(0);
  const [isDesktopEditorSidebar, setIsDesktopEditorSidebar] = useState(false);
  const isMobileMerchantSupportOnlyMode = !isPlatformEditor && !forceDesktopEditorSidebar && !isDesktopEditorSidebar;
  const [uploadCompressionPreset] = useState<UploadCompressionPreset>("high");
  const [themePreset, setThemePreset] = useState<ThemePresetKey>("none");
  const [planTemplateDialogOpen, setPlanTemplateDialogOpen] = useState(false);
  const [planTemplateSearch, setPlanTemplateSearch] = useState("");
  const [planTemplateFilter, setPlanTemplateFilter] = useState<PlanTemplateFilterCategory>("全部");
  const [planTemplates, setPlanTemplates] = useState<PlanTemplate[]>(() => initialPlatformState.planTemplates ?? []);
  const [planTemplateCoverPreview, setPlanTemplateCoverPreview] = useState<{ url: string; name: string } | null>(null);
  const [planTemplateCoverPreviewScale, setPlanTemplateCoverPreviewScale] = useState(1);
  const pageImageInputRef = useRef<HTMLInputElement>(null);
  const [pageImageDialogOpen, setPageImageDialogOpen] = useState(false);
  const [pageImageUrlInput, setPageImageUrlInput] = useState("");
  const [pageImageSettingsOpen, setPageImageSettingsOpen] = useState(false);
  const [pageCopyDialogOpen, setPageCopyDialogOpen] = useState(false);
  const [pageCopyTargetPageId, setPageCopyTargetPageId] = useState("");
  const [pageCopySelections, setPageCopySelections] = useState<PageCopySelectionState>(() => buildPageCopySelectionDefaults(initialBlocks));
  const [pageSettingsFillMode, setPageSettingsFillMode] = useState<ImageFillMode>("cover");
  const [pageSettingsPosition, setPageSettingsPosition] = useState("center");
  const [pageSettingsColor, setPageSettingsColor] = useState("");
  const [pageSettingsImageOpacity, setPageSettingsImageOpacity] = useState(1);
  const [pageSettingsColorOpacity, setPageSettingsColorOpacity] = useState(1);
  const [recentColors, setRecentColors] = useState<string[]>([]);
  const [resizePreview, setResizePreview] = useState<{ blockId: string; heightDelta: number } | null>(null);
  const selectedIdRef = useRef(selectedId);
  const europeLocationOptionsApiTaskRef = useRef<Promise<EuropeLocationOptionsApi> | null>(null);
  const planConfigRef = useRef(planConfig);

  useEffect(() => {
    setPlanTemplateCoverPreviewScale(1);
  }, [planTemplateCoverPreview?.url]);
  const editingPlanIdRef = useRef(editingPlanId);
  const editingPageIdRef = useRef(editingPageId);
  const undoStackRef = useRef<EditorSnapshot[]>([]);
  const redoStackRef = useRef<EditorSnapshot[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const merchantIdsRef = useRef<string[]>([]);
  const merchantSessionIdentityRef = useRef<{ merchantId: string; email: string | null }>({
    merchantId: "",
    email: null,
  });
  const lastMerchantBackgroundedAtRef = useRef(0);
  const lastMerchantResumeAtRef = useRef(0);
  const playNotificationSound = useNotificationSound();
  const merchantSessionIdentityTaskRef = useRef<Promise<{ merchantId: string; email: string | null } | null> | null>(null);
  const themeBaseBlocksByPageRef = useRef<Map<string, Block[]>>(new Map());
  const themePresetApplyRequestRef = useRef(0);
  const backgroundLayerRef = useRef<HTMLDivElement>(null);
  const [backgroundLayerMinHeight, setBackgroundLayerMinHeight] = useState(0);
  const applyPersistedBlocksToEditorRef = useRef<(loaded: Block[], options?: { resetHistory?: boolean }) => void>(() => {});
  const recordDragHistoryRef = useRef<() => void>(() => {});
  const persistDraggingDraftRef = useRef<() => void>(() => {});
  const nudgeBlockRef = useRef<(blockId: string, deltaX: number, deltaY: number) => void>(() => {});
  const viewportStatesRef = useRef<Record<ViewportKey, ViewportEditorState>>({
    desktop: {
      planConfig: JSON.parse(JSON.stringify(initialPlanConfig)) as PagePlanConfig,
      editingPlanId: initialEditingPlanId,
      editingPageId: initialEditingPageId,
      blocks: cloneBlocks(initialBlocks),
      selectedId: "",
    },
    mobile: {
      planConfig: JSON.parse(JSON.stringify(initialMobilePlanConfig)) as PagePlanConfig,
      editingPlanId: initialMobilePlanConfig.activePlanId,
      editingPageId:
        initialMobilePlanConfig.plans.find((plan) => plan.id === initialMobilePlanConfig.activePlanId)?.activePageId ?? "page-1",
      blocks: cloneBlocks(
        getBlocksForPage(
          initialMobilePlanConfig.plans.find((plan) => plan.id === initialMobilePlanConfig.activePlanId) ??
            initialMobilePlanConfig.plans[0],
          initialMobilePlanConfig.plans.find((plan) => plan.id === initialMobilePlanConfig.activePlanId)?.activePageId ?? "page-1",
        ),
      ),
      selectedId: "",
    },
  });
  const syncPlatformMerchantSnapshotToServerRef = useRef<() => Promise<boolean>>(async () => false);

  const prefetchMerchantSessionIdentity = useCallback(
    async (timeoutMs = Math.max(1400, Math.min(2600, AUTH_CHECK_TIMEOUT_MS))) => {
      if (isPlatformEditor || typeof window === "undefined") return null;

      const cachedMerchantId = merchantSessionIdentityRef.current.merchantId.trim();
      const cachedEmail = String(merchantSessionIdentityRef.current.email ?? "").trim();
      if (cachedMerchantId || cachedEmail) {
        return merchantSessionIdentityRef.current;
      }

      if (merchantSessionIdentityTaskRef.current) {
        return merchantSessionIdentityTaskRef.current;
      }

      let task: Promise<{ merchantId: string; email: string | null } | null> | null = null;
      task = (async () => {
        try {
          const payload = await withTimeout(readMerchantSessionPayload(timeoutMs), timeoutMs, "商户身份识别超时，请稍后重试");
          if (!payload || payload.authenticated !== true) return null;
          const merchantIds = readMerchantSessionMerchantIds(payload);
          const merchantId =
            (typeof payload?.merchantId === "string" ? payload.merchantId.trim() : "") ||
            merchantIds.find((item) => isMerchantNumericId(item)) ||
            merchantIds[0] ||
            "";
          const email = typeof payload?.user?.email === "string" ? payload.user.email.trim() : "";
          if (!merchantId && !email) return null;
          merchantSessionIdentityRef.current = {
            merchantId,
            email: email || null,
          };
          if (merchantIds.length > 0 || merchantId) {
            merchantIdsRef.current = mergePreferredMerchantIds(
              merchantIds.length > 0 ? merchantIds : [merchantId],
              merchantIdsRef.current,
            );
          }
          if (merchantId) {
            setMerchantSiteIdOverride((current) => current || merchantId);
          }
          return merchantSessionIdentityRef.current;
        } catch {
          return null;
        } finally {
          if (task && merchantSessionIdentityTaskRef.current === task) {
            merchantSessionIdentityTaskRef.current = null;
          }
        }
      })();

      merchantSessionIdentityTaskRef.current = task;
      return task;
    },
    [isPlatformEditor],
  );

  const readFreshMerchantSessionIdentity = useCallback(
    async (timeoutMs = Math.max(1800, Math.min(4200, AUTH_CHECK_TIMEOUT_MS))) => {
      if (isPlatformEditor || typeof window === "undefined") return null;

      try {
        const payload = await withTimeout(readMerchantSessionPayload(timeoutMs), timeoutMs, "商户身份识别超时，请稍后重试");
        if (!payload || payload.authenticated !== true) {
          return null;
        }
        const merchantIds = readMerchantSessionMerchantIds(payload);
        const merchantId =
          (typeof payload?.merchantId === "string" ? payload.merchantId.trim() : "") ||
          merchantIds.find((item) => isMerchantNumericId(item)) ||
          merchantIds[0] ||
          "";
        const email = typeof payload?.user?.email === "string" ? payload.user.email.trim() : "";
        if (!merchantId && !email) return null;
        merchantSessionIdentityRef.current = {
          merchantId,
          email: email || null,
        };
        if (merchantIds.length > 0 || merchantId) {
          merchantIdsRef.current = mergePreferredMerchantIds(
            merchantIds.length > 0 ? merchantIds : [merchantId],
            merchantIdsRef.current,
          );
        }
        if (merchantId) {
          setMerchantSiteIdOverride((current) => current || merchantId);
        }
        return merchantSessionIdentityRef.current;
      } catch {
        return null;
      }
    },
    [isPlatformEditor],
  );

  const ensureEditableMerchantSiteId = useCallback(async () => {
    if (isPlatformEditor) return "";

    let sessionUserEmail = String(merchantSessionIdentityRef.current.email ?? "").trim() || null;
    let targetSiteId =
      getSiteIdFromStoreScope(storeScope).trim() ||
      merchantSiteIdOverride ||
      merchantIdsRef.current.find((item) => isMerchantNumericId(item)) ||
      merchantIdsRef.current[0] ||
      merchantSessionIdentityRef.current.merchantId.trim() ||
      "";

    if (!targetSiteId || !sessionUserEmail) {
      const prefetchedIdentity = await prefetchMerchantSessionIdentity().catch(() => null);
      const prefetchedMerchantId = prefetchedIdentity?.merchantId?.trim() ?? "";
      const prefetchedEmail = typeof prefetchedIdentity?.email === "string" ? prefetchedIdentity.email.trim() : "";
      if (!sessionUserEmail && prefetchedEmail) {
        sessionUserEmail = prefetchedEmail;
      }
      if (!targetSiteId && prefetchedMerchantId) {
        targetSiteId = prefetchedMerchantId;
      }
    }

    if (!targetSiteId) {
      try {
        const freshIdentity = await readFreshMerchantSessionIdentity(Math.max(2600, AUTH_CHECK_TIMEOUT_MS));
        const recoveredSessionEmail = typeof freshIdentity?.email === "string" ? freshIdentity.email.trim() : "";
        if (recoveredSessionEmail) {
          sessionUserEmail = recoveredSessionEmail;
          merchantSessionIdentityRef.current = {
            merchantId: merchantSessionIdentityRef.current.merchantId,
            email: recoveredSessionEmail,
          };
        }
        if (!targetSiteId) {
          const resolvedMerchantIds = mergePreferredMerchantIds(merchantIdsRef.current);
          if (resolvedMerchantIds.length > 0) {
            merchantIdsRef.current = mergePreferredMerchantIds(resolvedMerchantIds, merchantIdsRef.current);
            targetSiteId = resolvedMerchantIds.find((item) => isMerchantNumericId(item)) ?? resolvedMerchantIds[0] ?? "";
            if (targetSiteId) {
              merchantSessionIdentityRef.current = {
                merchantId: targetSiteId,
                email: sessionUserEmail,
              };
            }
          }
        }
      } catch {
        // Fall back to cookie-backed identity when auth refresh is temporarily unavailable.
      }
    }

    if (!targetSiteId) {
      const cookieIdentity = await prefetchMerchantSessionIdentity(Math.max(2200, AUTH_CHECK_TIMEOUT_MS)).catch(() => null);
      const cookieMerchantId = cookieIdentity?.merchantId?.trim() ?? "";
      const cookieSessionEmail = typeof cookieIdentity?.email === "string" ? cookieIdentity.email.trim() : "";
      if (cookieSessionEmail) {
        sessionUserEmail = cookieSessionEmail;
      }
      if (cookieMerchantId) {
        targetSiteId = cookieMerchantId;
      }
    }

    if (!targetSiteId) return "";
    const ensuredSite = ensureScopedMerchantSite(targetSiteId, sessionUserEmail);
    const ensuredSiteId = String(ensuredSite?.id ?? targetSiteId).trim();
    if (!ensuredSiteId) return "";
    merchantIdsRef.current = mergePreferredMerchantIds([ensuredSiteId], merchantIdsRef.current);
    merchantSessionIdentityRef.current = {
      merchantId: ensuredSiteId,
      email: sessionUserEmail,
    };
    setMerchantSiteIdOverride(ensuredSiteId);
    return ensuredSiteId;
  }, [isPlatformEditor, merchantSiteIdOverride, prefetchMerchantSessionIdentity, readFreshMerchantSessionIdentity, storeScope]);

  useEffect(() => {
    if (isPlatformEditor || explicitFaollaSectionEntry || typeof window === "undefined") return;
    const timer = window.setTimeout(() => {
      void prefetchMerchantSessionIdentity();
    }, 120);
    return () => {
      window.clearTimeout(timer);
    };
  }, [explicitFaollaSectionEntry, isPlatformEditor, prefetchMerchantSessionIdentity]);

  useEffect(() => {
    if (hasAddedExtraBlock) return;
    if (blocks.length > 1 || blocks.some((item) => item.type !== "nav")) {
      setHasAddedExtraBlock(true);
    }
  }, [blocks, hasAddedExtraBlock]);

  useEffect(
    () =>
      subscribePlatformState(() => {
        const nextPlatformState = loadPlatformState();
        setPlanTemplates(nextPlatformState.planTemplates ?? []);
        if (!isPlatformEditor) {
          setMerchantPlatformState(nextPlatformState);
        }
      }),
    [isPlatformEditor],
  );

  useEffect(() => {
    if (!isPlatformEditor) return;
    const timer = window.setTimeout(() => {
      void syncPlatformMerchantSnapshotToServerRef.current();
    }, 250);
    return () => {
      window.clearTimeout(timer);
    };
  }, [isPlatformEditor]);

  useEffect(() => {
    if ((!planTemplateDialogOpen && !pageCopyDialogOpen) || typeof document === "undefined") return () => {};
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [pageCopyDialogOpen, planTemplateDialogOpen]);

  function recordRecentColor(value: string) {
    const normalized = normalizeRecentColorToken(value);
    if (!normalized) return;
    setRecentColors((prev) => {
      const next = [normalized, ...prev.filter((item) => item !== normalized)].slice(0, MAX_RECENT_COLORS);
      if (typeof window !== "undefined") {
        try {
          localStorage.setItem(RECENT_COLORS_KEY, JSON.stringify(next));
        } catch {
          // ignore storage write failures
        }
      }
      return next;
    });
  }

  function showTip(message: string, options?: { durationMs?: number | null; dismissOnPointer?: boolean }) {
    void options;
    setTip(message);
  }

  function isPublishTerminalTip(message: string) {
    const normalized = message.trim();
    return (
      normalized.startsWith("已发布") ||
      normalized.startsWith("发布失败") ||
      normalized.startsWith("发布超时") ||
      normalized.startsWith("发布没有完成") ||
      normalized.startsWith("草稿已保存，发布失败") ||
      normalized.startsWith("无变更")
    );
  }

  function showSavePublishTip(message: string) {
    if (publishingRef.current && !isPublishTerminalTip(message)) {
      showTip("发布中，请稍候...");
      return;
    }
    showTip(message);
  }

  function showPublishFailedTip(message: string) {
    showTip(message);
  }

  function beginEditorUpload(message = "正在上传图片，请稍候...") {
    editorUploadBusyCountRef.current += 1;
    setEditorUploadMessage(message);
    setEditorUploadBusy(true);
    let completed = false;
    return () => {
      if (completed) return;
      completed = true;
      editorUploadBusyCountRef.current = Math.max(0, editorUploadBusyCountRef.current - 1);
      if (editorUploadBusyCountRef.current === 0) {
        setEditorUploadBusy(false);
        setEditorUploadMessage("");
      }
    };
  }

  function applyMerchantSessionIdentityPayload(payload: Awaited<ReturnType<typeof readMerchantSessionPayload>> | null) {
    if (!payload || payload.authenticated !== true) return false;
    const merchantIds = readMerchantSessionMerchantIds(payload);
    const merchantId =
      (typeof payload.merchantId === "string" ? payload.merchantId.trim() : "") ||
      merchantIds.find((item) => isMerchantNumericId(item)) ||
      merchantIds[0] ||
      "";
    const email = typeof payload.user?.email === "string" ? payload.user.email.trim() : "";
    if (!merchantId && !email) return false;
    if (merchantIds.length > 0 || merchantId) {
      merchantIdsRef.current = mergePreferredMerchantIds(
        merchantIds.length > 0 ? merchantIds : [merchantId],
        merchantIdsRef.current,
      );
    }
    merchantSessionIdentityRef.current = {
      merchantId,
      email: email || null,
    };
    if (merchantId) {
      setMerchantSiteIdOverride((current) => current || merchantId);
    }
    return true;
  }

  async function ensureMerchantSessionRecoveredBeforePublish() {
    if (isPlatformEditor || !isSupabaseEnabled || isSupabaseFallbackMode) return true;

    if (checkingAuthRef.current) {
      showSavePublishTip("正在自动恢复登录...");
      const deadline = Date.now() + Math.max(6000, Math.min(12_000, AUTH_CHECK_TIMEOUT_MS + 5000));
      while (checkingAuthRef.current && Date.now() < deadline) {
        await waitForMs(200);
      }
    }

    const acceptRecoveredIdentity = () => {
      setBackendNotice(null);
      setCheckingAuth(false);
      checkingAuthRef.current = false;
      return true;
    };

    const currentPayload = await readMerchantSessionPayload(Math.max(2200, Math.min(6200, AUTH_CHECK_TIMEOUT_MS))).catch(
      () => null,
    );
    if (applyMerchantSessionIdentityPayload(currentPayload)) return acceptRecoveredIdentity();

    const recoveredSession = await recoverBrowserSupabaseSessionWithRefresh(
      Math.max(3200, Math.min(9000, AUTH_CHECK_TIMEOUT_MS + 1800)),
    ).catch(() => null);
    if (recoveredSession) {
      const syncedPayload = await syncMerchantSessionCookies(
        recoveredSession,
        Math.max(2600, Math.min(7000, AUTH_CHECK_TIMEOUT_MS)),
      ).catch(() => null);
      if (applyMerchantSessionIdentityPayload(syncedPayload)) return acceptRecoveredIdentity();
    }

    const cookieSession = await recoverBrowserSupabaseSessionViaMerchantCookies(
      Math.max(2600, Math.min(7600, AUTH_CHECK_TIMEOUT_MS)),
    ).catch(() => null);
    if (cookieSession) {
      const syncedPayload = await syncMerchantSessionCookies(
        cookieSession,
        Math.max(2600, Math.min(7000, AUTH_CHECK_TIMEOUT_MS)),
      ).catch(() => null);
      if (applyMerchantSessionIdentityPayload(syncedPayload)) return acceptRecoveredIdentity();
    }

    const retryPayload = await readMerchantSessionPayload(Math.max(2200, Math.min(6200, AUTH_CHECK_TIMEOUT_MS))).catch(
      () => null,
    );
    if (applyMerchantSessionIdentityPayload(retryPayload)) return acceptRecoveredIdentity();

    const freshIdentity = await readFreshMerchantSessionIdentity(Math.max(2600, AUTH_CHECK_TIMEOUT_MS)).catch(() => null);
    const freshMerchantId = freshIdentity?.merchantId?.trim() ?? "";
    const freshEmail = typeof freshIdentity?.email === "string" ? freshIdentity.email.trim() : "";
    if (freshMerchantId || freshEmail) return acceptRecoveredIdentity();

    showTip("登录状态恢复失败，请稍后再试");
    return false;
  }

  function getMerchantRemoteVerificationScopes(merchantIds: string[]) {
    return [...new Set([storeScope, ...merchantIds.map((siteId) => buildSiteStoreScope(siteId))].filter(Boolean))];
  }

  function markMerchantRemoteContentVerified(merchantIds: string[], recordedAt?: string | null | undefined) {
    getMerchantRemoteVerificationScopes(merchantIds).forEach((scope) => {
      recordRemoteContentVerifiedTimestamp(scope, recordedAt);
    });
    setRemoteContentVerified(true);
  }

  async function ensureRemoteContentVerifiedBeforePublish(targetSiteId = "") {
    if (isPlatformEditor || remoteContentVerified) return true;
    const scopedSiteId = getSiteIdFromStoreScope(storeScope).trim();
    const preferredIds = [targetSiteId, scopedSiteId, editingSiteId].filter(Boolean);
    const candidateMerchantIds = mergePreferredMerchantIds(preferredIds, merchantIdsRef.current);
    if (candidateMerchantIds.length === 0) return false;

    const candidateScopes = getMerchantRemoteVerificationScopes(candidateMerchantIds);
    if (hasRemoteContentVerifiedStamp(candidateScopes)) {
      setRemoteContentVerified(true);
      return true;
    }

    showSavePublishTip("正在验证远端内容...");
    await readFreshMerchantSessionIdentity(Math.min(3000, AUTH_CHECK_TIMEOUT_MS)).catch(() => null);
    const resolvedMerchantIds = mergePreferredMerchantIds(preferredIds, merchantIdsRef.current, candidateMerchantIds);
    const gatewayReady = await canReachSupabaseGateway(Math.min(3000, AUTH_CHECK_TIMEOUT_MS));
    if (!gatewayReady) return false;

    const remoteDraft = await loadMerchantDraftSnapshotViaApi(resolvedMerchantIds);
    if (remoteDraft) {
      markMerchantRemoteContentVerified(resolvedMerchantIds, remoteDraft.updatedAt);
      return true;
    }

    const publishedSnapshot = await loadPublishedSiteSnapshotForMerchantIds(resolvedMerchantIds);
    if (publishedSnapshot) {
      markMerchantRemoteContentVerified([publishedSnapshot.siteId, ...resolvedMerchantIds]);
      return true;
    }

    // If the gateway is reachable but this merchant has no remote draft/published record yet,
    // the publish target is still safely verified for first publish.
    markMerchantRemoteContentVerified(resolvedMerchantIds);
    return true;
  }

  function triggerMerchantProfileAttention() {
    setMerchantProfileAttention(true);
    const button = merchantProfileButtonRef.current;
    if (!button || typeof button.animate !== "function") return;
    button.animate(
      [
        { transform: "translateX(0)" },
        { transform: "translateX(-5px)" },
        { transform: "translateX(5px)" },
        { transform: "translateX(-4px)" },
        { transform: "translateX(4px)" },
        { transform: "translateX(0)" },
      ],
      { duration: 380, iterations: 2, easing: "ease-in-out" },
    );
  }

  function getCurrentImageCompressionOptions() {
    return IMAGE_COMPRESSION_OPTIONS[uploadCompressionPreset] ?? IMAGE_COMPRESSION_OPTIONS.high;
  }

  function clearRecentColors() {
    setRecentColors([]);
    if (typeof window !== "undefined") {
      try {
        localStorage.removeItem(RECENT_COLORS_KEY);
      } catch {
        // ignore storage write failures
      }
    }
  }

  function clonePlanConfig(source: PagePlanConfig): PagePlanConfig {
    if (typeof structuredClone === "function") {
      return structuredClone(source) as PagePlanConfig;
    }
    return JSON.parse(JSON.stringify(source)) as PagePlanConfig;
  }

  function buildCombinedPersistedBlocks(desktopConfig: PagePlanConfig, mobileConfig: PagePlanConfig) {
    const desktopBlocks = buildPersistedBlocksFromPlanConfig(desktopConfig);
    const mobileBlocks = buildPersistedBlocksFromPlanConfig(mobileConfig);
    const mobileRaw = (mobileBlocks[0]?.props as { pagePlanConfig?: unknown } | undefined)?.pagePlanConfig;
    if (desktopBlocks[0] && mobileRaw) {
      desktopBlocks[0] = {
        ...desktopBlocks[0],
        props: {
          ...desktopBlocks[0].props,
          pagePlanConfigMobile: mobileRaw as never,
        } as never,
      } as Block;
    }
    return desktopBlocks;
  }

  function getViewportEditingPlanId(viewport: ViewportKey) {
    return previewViewport === viewport ? editingPlanIdRef.current : viewportStatesRef.current[viewport].editingPlanId;
  }

  function buildMerchantSinglePlanPublishBlocks(desktopConfig: PagePlanConfig, mobileConfig: PagePlanConfig) {
    const desktopPlanId = getViewportEditingPlanId("desktop");
    const mobilePlanId = getViewportEditingPlanId("mobile");
    return buildCombinedPersistedBlocks(
      buildSinglePlanPublishConfig(desktopConfig, desktopPlanId),
      buildSinglePlanPublishConfig(mobileConfig, mobilePlanId),
    );
  }

  function buildPublishedMerchantSnapshot(): {
    sites: MerchantListPublishedSite[];
    defaultSortRule: MerchantSortRule;
  } {
    const payload = buildPlatformMerchantSnapshotPayloadFromState(loadPlatformState());
    return {
      sites: payload.snapshot.map((site) => ({
        ...site,
        businessCards: undefined,
        permissionConfig: undefined,
      })),
      defaultSortRule: payload.defaultSortRule,
    };
  }

  syncPlatformMerchantSnapshotToServerRef.current = async () => {
    if (!isPlatformEditor) return false;
    const payload = buildPlatformMerchantSnapshotPayloadFromState(loadPlatformState());
    if (payload.snapshot.length === 0) return false;
    try {
      const response = await fetch("/api/super-admin/platform-merchant-snapshot", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        cache: "no-store",
        body: JSON.stringify(payload),
      });
      return response.ok;
    } catch {
      return false;
    }
  };

  function injectPublishedMerchantSnapshot(sourceBlocks: Block[]): Block[] {
    const { sites, defaultSortRule } = buildPublishedMerchantSnapshot();

    const patchPlanConfig = (input: unknown) => {
      if (!input || typeof input !== "object") return input;
      const planConfig = input as {
        activePlanId?: unknown;
        plans?: Array<{
          id?: unknown;
          name?: unknown;
          blocks?: Block[];
          pages?: Array<{ id?: unknown; name?: unknown; blocks?: Block[] }>;
          activePageId?: unknown;
        }>;
      };
      if (!Array.isArray(planConfig.plans)) return input;
      return {
        ...planConfig,
        plans: planConfig.plans.map((plan) => ({
          ...plan,
          blocks: Array.isArray(plan.blocks) ? patchBlocks(plan.blocks) : plan.blocks,
          pages: Array.isArray(plan.pages)
            ? plan.pages.map((page) => ({
                ...page,
                blocks: Array.isArray(page.blocks) ? patchBlocks(page.blocks) : page.blocks,
              }))
            : plan.pages,
        })),
      };
    };

    const patchBlock = (block: Block): Block => {
      const nextProps = { ...block.props } as Record<string, unknown>;
      if (block.type === "merchant-list") {
        nextProps.publishedMerchantSnapshot = sites;
        nextProps.publishedMerchantDefaultSortRule = defaultSortRule;
      }
      if ("pagePlanConfig" in nextProps) {
        nextProps.pagePlanConfig = patchPlanConfig(nextProps.pagePlanConfig);
      }
      if ("pagePlanConfigMobile" in nextProps) {
        nextProps.pagePlanConfigMobile = patchPlanConfig(nextProps.pagePlanConfigMobile);
      }
      return {
        ...block,
        props: nextProps as never,
      } as Block;
    };

    const patchBlocks = (blocks: Block[]) => blocks.map((block) => patchBlock(block));
    return patchBlocks(sourceBlocks);
  }

  function isBlockLocked(block: Block | undefined) {
    return block?.props?.blockLocked === true;
  }

  function applyPersistedBlocksToEditor(loaded: Block[], options?: { resetHistory?: boolean }) {
    const loadedPlanConfig = getPagePlanConfigFromBlocks(loaded);
    const loadedMobilePlanConfig = getEmbeddedMobilePlanConfig(loaded) ?? adaptPlanConfigForMobile(clonePlanConfig(loadedPlanConfig));

    const loadedEditingPlanId = loadedPlanConfig.activePlanId;
    const loadedEditingPageId = loadedPlanConfig.plans.find((plan) => plan.id === loadedEditingPlanId)?.activePageId ?? "page-1";
    const desktopBlocks = cloneBlocks(
      getBlocksForPage(loadedPlanConfig.plans.find((plan) => plan.id === loadedEditingPlanId) ?? loadedPlanConfig.plans[0], loadedEditingPageId),
    );

    const mobilePlanId = loadedMobilePlanConfig.activePlanId;
    const mobilePageId = loadedMobilePlanConfig.plans.find((plan) => plan.id === mobilePlanId)?.activePageId ?? "page-1";
    const mobileBlocks = cloneBlocks(
      getBlocksForPage(loadedMobilePlanConfig.plans.find((plan) => plan.id === mobilePlanId) ?? loadedMobilePlanConfig.plans[0], mobilePageId),
    );

    viewportStatesRef.current.desktop = {
      planConfig: clonePlanConfig(loadedPlanConfig),
      editingPlanId: loadedEditingPlanId,
      editingPageId: loadedEditingPageId,
      blocks: cloneBlocks(desktopBlocks),
      selectedId: "",
    };
    viewportStatesRef.current.mobile = {
      planConfig: clonePlanConfig(loadedMobilePlanConfig),
      editingPlanId: mobilePlanId,
      editingPageId: mobilePageId,
      blocks: cloneBlocks(mobileBlocks),
      selectedId: "",
    };

    const target = previewViewport === "desktop" ? viewportStatesRef.current.desktop : viewportStatesRef.current.mobile;
    const nextPlanConfig = clonePlanConfig(target.planConfig);
    const nextBlocks = cloneBlocks(target.blocks);
    const nextSelectedId = target.selectedId || "";
    planConfigRef.current = nextPlanConfig;
    editingPlanIdRef.current = target.editingPlanId;
    editingPageIdRef.current = target.editingPageId;
    blocksRef.current = nextBlocks;
    selectedIdRef.current = nextSelectedId;
    setPlanConfig(nextPlanConfig);
    setEditingPlanId(target.editingPlanId);
    setEditingPageId(target.editingPageId);
    setBlocks(nextBlocks);
    setSelectedId(nextSelectedId);

    const combinedLoaded = buildCombinedPersistedBlocks(loadedPlanConfig, loadedMobilePlanConfig);
    saveBlocksToStorage(combinedLoaded, storeScope);
    themeBaseBlocksByPageRef.current.clear();
    if (options?.resetHistory !== false) {
      undoStackRef.current = [];
      redoStackRef.current = [];
      syncHistoryFlags();
    }
  }

  function copySelectedBlockStyleToViewport(targetViewport: ViewportKey) {
    const id = selectedIdRef.current;
    if (!id) {
      showTip("请先选中一个区块");
      return;
    }
    const sourceBlock = blocksRef.current.find((item) => item.id === id);
    if (!sourceBlock) return;
    const targetState = viewportStatesRef.current[targetViewport];
    const targetIndex = targetState.blocks.findIndex((item) => item.id === id);
    if (targetIndex < 0) {
      showTip("目标端未找到同名区块");
      return;
    }
    pushUndoSnapshot(createSnapshot());
    const stylePatch: Record<string, unknown> = {};
    STYLE_SYNC_KEYS.forEach((key) => {
      const value = (sourceBlock.props as Record<string, unknown>)[key];
      if (typeof value !== "undefined") stylePatch[key] = value;
    });
    const nextBlocks = cloneBlocks(targetState.blocks);
    nextBlocks[targetIndex] = {
      ...nextBlocks[targetIndex],
      props: {
        ...nextBlocks[targetIndex].props,
        ...stylePatch,
      } as never,
    } as Block;
    const targetPlan = targetState.planConfig.plans.find((plan) => plan.id === targetState.editingPlanId) ?? targetState.planConfig.plans[0];
    const nextPlan = setBlocksForPage(
      { ...targetPlan, activePageId: targetState.editingPageId },
      targetState.editingPageId,
      nextBlocks,
    );
    const nextPlanConfig: PagePlanConfig = {
      ...targetState.planConfig,
      plans: targetState.planConfig.plans.map((plan) => (plan.id === targetState.editingPlanId ? nextPlan : plan)),
    };
    viewportStatesRef.current[targetViewport] = {
      ...targetState,
      planConfig: nextPlanConfig,
      blocks: nextBlocks,
      selectedId: id,
    };
    if (previewViewport === targetViewport) {
      setPlanConfig(clonePlanConfig(nextPlanConfig));
      setEditingPlanId(targetState.editingPlanId);
      setEditingPageId(targetState.editingPageId);
      setBlocks(cloneBlocks(nextBlocks));
      setSelectedId(id);
    }
    persistDraftForConfigs(previewViewport === targetViewport ? nextPlanConfig : planConfigRef.current);
    showTip(targetViewport === "mobile" ? "已复制样式到手机端" : "已复制样式到PC端");
  }

  function rollbackToLastSuccessfulPublished() {
    const previousPublished = rollbackToPreviousPublishedVersion(storeScope);
    if (!previousPublished || previousPublished.length === 0) {
      showTip("暂无可回滚的更早成功发布版本，请先完成至少一次成功发布");
      return;
    }
    flushPendingEditorChanges();
    pushUndoSnapshot(createSnapshot());
    applyPersistedBlocksToEditor(previousPublished, { resetHistory: false });
    showSavePublishTip("已切回上次成功发布版本");
  }

  function restoreLatestSavedDraft() {
    const latestDraftSnapshot = readLatestDraftSnapshot(storeScope);
    if (!latestDraftSnapshot || latestDraftSnapshot.blocks.length === 0) {
      showTip("暂无可恢复的草稿");
      return;
    }
    flushPendingEditorChanges();
    pushUndoSnapshot(createSnapshot());
    applyPersistedBlocksToEditor(latestDraftSnapshot.blocks, { resetHistory: false });
    showSavePublishTip("已恢复上次保存的草稿");
  }

  async function resolveFirstMerchantHint() {
    let merchantIds = merchantIdsRef.current;
    if (merchantIds.length === 0) {
      try {
        const gatewayReady = await canReachSupabaseGateway(Math.min(2500, AUTH_CHECK_TIMEOUT_MS));
        if (!gatewayReady) return merchantIds[0] ?? "public";
        await readFreshMerchantSessionIdentity(Math.min(3200, AUTH_CHECK_TIMEOUT_MS)).catch(() => null);
        merchantIds = mergePreferredMerchantIds(merchantIdsRef.current);
        merchantIdsRef.current = merchantIds;
      } catch {
        merchantIds = merchantIdsRef.current;
      }
    }
    return merchantIds[0] ?? "public";
  }

  async function persistInlineImageForEditor(
    dataUrl: string,
    usage: EditorImageUploadUsage = "generic-image",
    operation?: MerchantAssetUploadOperationContext,
  ): Promise<PersistedEditorAssetResult> {
    const safeValue = ensureSafeImageUrlSize(dataUrl);
    if (!safeValue || !isInlineDataImageUrl(safeValue)) {
      return { value: safeValue ?? "", externalized: false };
    }
    const merchantHint = ((isPlatformEditor ? "platform" : await resolveFirstMerchantHint()) || "public").trim() || "public";
    const { uploadImageDataUrlToSupabaseWithMetadata } = await loadEditorAssetProcessing();
    const uploadedAsset = await uploadImageDataUrlToSupabaseWithMetadata(safeValue, merchantHint, usage, operation);
    if (uploadedAsset?.url) {
      return { value: uploadedAsset.url, thumbnailUrl: uploadedAsset.thumbnailUrl, externalized: true };
    }
    return { value: safeValue, externalized: false };
  }

  async function persistPageBackgroundImageFileForEditor(
    file: File,
    viewport: ViewportKey,
  ): Promise<PersistedEditorAssetResult> {
    const endUpload = beginEditorUpload("正在处理并上传背景图片，请稍候...");
    const operation = {
      operationModule: "网站编辑 > 背景设置",
      operationAction: "上传页面背景图",
      operationSummary: "在网站编辑 > 背景设置上传页面背景图",
    };
    try {
      const assetProcessingPromise = loadEditorAssetProcessing();
      const merchantHintPromise = isPlatformEditor ? Promise.resolve("platform") : resolveFirstMerchantHint();
      const backgroundOptions =
        viewport === "mobile" ? PAGE_BACKGROUND_IMAGE_COMPRESSION_OPTIONS.mobile : PAGE_BACKGROUND_IMAGE_COMPRESSION_OPTIONS.desktop;
      const {
        blobToDataUrl,
        compressPageBackgroundImageFile,
        createPageBackgroundUploadFile,
      } = await assetProcessingPromise;
      const compressed = await compressPageBackgroundImageFile(
        file,
        backgroundOptions,
        PAGE_BACKGROUND_IMAGE_LIMIT_BYTES[viewport],
      );
      const merchantHint = ((await merchantHintPromise) || "public").trim() || "public";
      const uploadFile = createPageBackgroundUploadFile(compressed.blob, file.name);
      const uploadedAsset = await uploadFileToPublicStorageWithMetadata(uploadFile, {
        merchantHint,
        folder: "merchant-assets",
        usage: "page-background",
        operation,
      });
      if (uploadedAsset?.url) {
        return {
          value: uploadedAsset.url,
          thumbnailUrl: uploadedAsset.thumbnailUrl,
          externalized: true,
        };
      }

      const safeValue = ensureSafeImageUrlSize(await blobToDataUrl(compressed.blob));
      if (!safeValue) throw new Error("背景图片处理失败，请重试");
      return { value: safeValue, externalized: false };
    } finally {
      endUpload();
    }
  }

  async function persistImageFileForEditor(
    file: File,
    options?: { purpose?: EditorImageUploadPurpose; viewport?: ViewportKey },
  ): Promise<PersistedEditorAssetResult> {
    if (options?.purpose === "page-background") {
      return persistPageBackgroundImageFileForEditor(file, options.viewport === "mobile" ? "mobile" : "desktop");
    }

    const endUpload = beginEditorUpload("正在上传图片，请稍候...");
    try {
      const {
        compressImageFileWithinLimit,
        fileToOriginalImageDataUrl,
      } = await loadEditorAssetProcessing();
      let dataUrl: string;
      const limitKb =
        !isPlatformEditor && options?.purpose === "common"
          ? Math.max(50, Math.round(merchantPermissionConfig?.commonBlockImageLimitKb ?? 300))
          : !isPlatformEditor && options?.purpose === "gallery"
            ? Math.max(50, Math.round(merchantPermissionConfig?.galleryBlockImageLimitKb ?? 300))
            : null;
      if (limitKb) {
        const limitBytes = limitKb * 1024;
        const compressed = await compressImageFileWithinLimit(file, limitBytes, imageCompressionOptions);
        if (compressed.bytes > limitBytes) {
          throw new Error(`图片已自动压缩，但仍超过当前上传上限 ${limitKb}KB`);
        }
        dataUrl = compressed.dataUrl;
      } else {
        dataUrl = await fileToOriginalImageDataUrl(file, imageCompressionOptions);
      }
      const usage =
        options?.purpose === "gallery" ? "gallery-block-image" : options?.purpose === "common" ? "common-block-image" : "generic-image";
      const operation =
        options?.purpose === "gallery"
          ? {
              operationModule: "网站编辑 > 相册区块",
              operationAction: "上传相册图片",
              operationSummary: "在网站编辑 > 相册区块上传图片",
            }
          : options?.purpose === "common"
            ? {
                operationModule: "网站编辑 > 区块编辑",
                operationAction: "上传通用区块图片",
                operationSummary: "在网站编辑 > 区块编辑上传通用区块图片",
              }
            : {
                operationModule: "网站编辑 > 图片素材",
                operationAction: "上传图片",
                operationSummary: "在网站编辑上传图片素材",
              };
      return persistInlineImageForEditor(dataUrl, usage, operation);
    } finally {
      endUpload();
    }
  }

  async function persistProductImageFileForEditor(file: File): Promise<PersistedEditorAssetResult> {
    const endUpload = beginEditorUpload("正在上传产品图片，请稍候...");
    try {
      const { fileToOptimizedImageDataUrl } = await loadEditorAssetProcessing();
      const dataUrl = await fileToOptimizedImageDataUrl(file, PRODUCT_IMAGE_UPLOAD_OPTIONS);
      return persistInlineImageForEditor(dataUrl, "product-image", {
        operationModule: "网站编辑 > 产品/预约",
        operationAction: "上传产品图片",
        operationSummary: "在网站编辑 > 产品/预约上传产品或项目图片",
      });
    } finally {
      endUpload();
    }
  }

  async function persistInlineAudioForEditor(dataUrl: string, operation?: MerchantAssetUploadOperationContext) {
    if (!/^data:audio\//i.test(dataUrl)) {
      return { value: dataUrl, externalized: false };
    }
    const merchantHint = ((isPlatformEditor ? "platform" : await resolveFirstMerchantHint()) || "public").trim() || "public";
    const { uploadAudioDataUrlToSupabase } = await loadEditorAssetProcessing();
    const uploadedUrl = await uploadAudioDataUrlToSupabase(dataUrl, merchantHint, operation);
    if (uploadedUrl) {
      return { value: uploadedUrl, externalized: true };
    }
    return { value: dataUrl, externalized: false };
  }

  async function persistAudioFileForEditor(file: File) {
    const { fileToAudioDataUrl } = await loadEditorAssetProcessing();
    const dataUrl = await fileToAudioDataUrl(file);
    return persistInlineAudioForEditor(dataUrl, {
      operationModule: "网站编辑 > 音频素材",
      operationAction: "上传音频",
      operationSummary: "在网站编辑上传音频素材",
    });
  }

  function getThemeSnapshotKey() {
    return `${previewViewport}:${editingPlanIdRef.current}:${editingPageIdRef.current}`;
  }

  async function applyThemePresetToCurrentPage(
    presetKey: ThemePresetKey,
    previousPreset: ThemePresetKey,
  ) {
    const snapshotKey = getThemeSnapshotKey();
    const requestId = themePresetApplyRequestRef.current + 1;
    themePresetApplyRequestRef.current = requestId;
    if (presetKey === "none") {
      const snapshot = themeBaseBlocksByPageRef.current.get(snapshotKey);
      if (!snapshot) {
        showSavePublishTip("当前页面未应用主题，无需还原");
        return;
      }
      const restored = cloneBlocks(snapshot);
      applyBlocks(restored, { selectedId: selectedIdRef.current || restored[0]?.id || "" });
      themeBaseBlocksByPageRef.current.delete(snapshotKey);
      showSavePublishTip("已清除主题效果，恢复到应用前状态");
      return;
    }

    let applyEditorThemePresetToBlocks: Awaited<
      ReturnType<typeof loadEditorThemeProcessing>
    >["applyEditorThemePresetToBlocks"];
    try {
      ({ applyEditorThemePresetToBlocks } = await loadEditorThemeProcessing());
    } catch {
      if (requestId === themePresetApplyRequestRef.current) {
        setThemePreset(previousPreset);
        showSavePublishTip("主题资源加载失败，已保留当前样式，请重试");
      }
      return;
    }
    if (requestId !== themePresetApplyRequestRef.current) return;
    if (!themeBaseBlocksByPageRef.current.has(snapshotKey)) {
      themeBaseBlocksByPageRef.current.set(snapshotKey, cloneBlocks(blocksRef.current));
    }
    const result = applyEditorThemePresetToBlocks(blocksRef.current, presetKey);
    applyBlocks(result.blocks, {
      selectedId: selectedIdRef.current || result.blocks[0]?.id || "",
    });
    showSavePublishTip(`已应用：${result.label}`);
  }

  function persistDraftForConfigs(activeConfig: PagePlanConfig, options?: { immediate?: boolean }) {
    const desktopConfig = previewViewport === "desktop" ? activeConfig : viewportStatesRef.current.desktop.planConfig;
    const mobileConfig = previewViewport === "mobile" ? activeConfig : viewportStatesRef.current.mobile.planConfig;
    const combinedBlocks = buildCombinedPersistedBlocks(desktopConfig, mobileConfig);
    if (options?.immediate) {
      saveBlocksToStorage(combinedBlocks, storeScope);
      return;
    }
    scheduleBlocksToStorage(combinedBlocks, storeScope);
  }

  useEffect(() => {
    if (typeof window === "undefined") return;
    const flushScheduledDraftSave = () => {
      flushPendingEditorChangesRef.current();
      flushScheduledBlocksToStorage(storeScope);
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        flushScheduledDraftSave();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pagehide", flushScheduledDraftSave);
    window.addEventListener("beforeunload", flushScheduledDraftSave);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pagehide", flushScheduledDraftSave);
      window.removeEventListener("beforeunload", flushScheduledDraftSave);
      flushScheduledDraftSave();
    };
  }, [storeScope]);

  function switchPreviewViewport(nextViewport: ViewportKey) {
    if (nextViewport === previewViewport) return;
    flushPendingEditorChanges();
    viewportStatesRef.current[previewViewport] = {
      planConfig: clonePlanConfig(planConfigRef.current),
      editingPlanId: editingPlanIdRef.current,
      editingPageId: editingPageIdRef.current,
      blocks: cloneBlocks(blocksRef.current),
      selectedId: selectedIdRef.current,
    };
    const target = viewportStatesRef.current[nextViewport];
    setPreviewViewport(nextViewport);
    setPlanConfig(clonePlanConfig(target.planConfig));
    setEditingPlanId(target.editingPlanId);
    setEditingPageId(target.editingPageId);
    setBlocks(cloneBlocks(target.blocks));
    setSelectedId(target.selectedId || "");
  }

  async function readDesktopIntoMobile() {
    flushPendingEditorChanges();
    const confirmed = await openConfirm("读取 PC 配置将覆盖当前手机配置，是否继续？", "读取PC");
    if (!confirmed) return;
    const desktopConfig = clonePlanConfig(viewportStatesRef.current.desktop.planConfig);
    const mobileConfig = adaptPlanConfigForMobile(desktopConfig);
    const mobilePlanId = mobileConfig.activePlanId;
    const mobilePageId = mobileConfig.plans.find((plan) => plan.id === mobilePlanId)?.activePageId ?? "page-1";
    const mobileBlocks = cloneBlocks(
      getBlocksForPage(
        mobileConfig.plans.find((plan) => plan.id === mobilePlanId) ?? mobileConfig.plans[0],
        mobilePageId,
      ),
    );
    pushUndoSnapshot(createSnapshot());
    viewportStatesRef.current.mobile = {
      planConfig: clonePlanConfig(mobileConfig),
      editingPlanId: mobilePlanId,
      editingPageId: mobilePageId,
      blocks: cloneBlocks(mobileBlocks),
      selectedId: mobileBlocks[0]?.id ?? "",
    };
    if (previewViewport === "mobile") {
      setPlanConfig(clonePlanConfig(mobileConfig));
      setEditingPlanId(mobilePlanId);
      setEditingPageId(mobilePageId);
      setBlocks(cloneBlocks(mobileBlocks));
      setSelectedId(mobileBlocks[0]?.id ?? "");
    }
    persistDraftForConfigs(mobileConfig);
    setTip("已读取PC配置到手机端");
  }

  function mergePlanConfigWithEditingBlocks(
    baseConfig: PagePlanConfig,
    currentEditingPlanId: PlanId,
    currentEditingPageId: string,
    currentBlocks: Block[],
    options?: { syncNavPages?: boolean },
  ): PagePlanConfig {
    const syncNavPages = options?.syncNavPages ?? true;
    const canonicalNavBlock = getFirstNavBlock(currentBlocks);
    const cleanedCurrentBlocks = (() => {
      const withoutNav = stripNavBlocks(currentBlocks);
      return canonicalNavBlock ? [canonicalNavBlock, ...withoutNav] : withoutNav;
    })();

    return {
      ...baseConfig,
      plans: baseConfig.plans.map((plan) => {
        if (plan.id !== currentEditingPlanId) return plan;
        const withCurrentPage = setBlocksForPage(
          {
            ...plan,
            activePageId: currentEditingPageId,
          },
          currentEditingPageId,
          cleanedCurrentBlocks,
        );
        if (!syncNavPages) {
          const activePage =
            withCurrentPage.pages.find((page) => page.id === withCurrentPage.activePageId) ?? withCurrentPage.pages[0];
          return {
            ...withCurrentPage,
            blocks: cloneBlocks(activePage?.blocks ?? withCurrentPage.blocks),
          };
        }

        let syncedPages = withCurrentPage.pages.map((page) => {
          const pageBackgroundPatch = getPageBackgroundPatch(page.blocks[0]);
          const base = stripNavBlocks(page.blocks);
          const navClone = canonicalNavBlock ? cloneBlocks([canonicalNavBlock])[0] : null;
          const rebuiltBlocks = navClone ? [navClone, ...base] : base;
          if (rebuiltBlocks[0]) {
            rebuiltBlocks[0] = {
              ...rebuiltBlocks[0],
              props: { ...rebuiltBlocks[0].props, ...pageBackgroundPatch } as never,
            } as Block;
          }
          return {
            ...page,
            blocks: rebuiltBlocks,
          };
        });
        if (canonicalNavBlock?.type === "nav") {
          const navItems = Array.isArray(canonicalNavBlock.props.navItems) ? canonicalNavBlock.props.navItems : [];
          const desiredPages = navItems
            .map((item, idx) => ({
              pageId: typeof item?.pageId === "string" ? item.pageId.trim() : "",
              label: typeof item?.label === "string" ? toPlainText(item.label, `页面${idx + 1}`) : `页面${idx + 1}`,
            }))
            .filter((item) => !!item.pageId);
          if (desiredPages.length > 0) {
            const pageMap = new Map(syncedPages.map((page) => [page.id, page] as const));
            syncedPages = desiredPages.map((desired, idx) => {
              const existing = pageMap.get(desired.pageId) ?? syncedPages[idx];
              const pageBackgroundPatch = getPageBackgroundPatch(existing?.blocks?.[0]);
              const base = existing ? stripNavBlocks(existing.blocks) : [];
              const navClone = cloneBlocks([canonicalNavBlock])[0];
              const rebuiltBlocks = [navClone, ...base];
              if (rebuiltBlocks[0]) {
                rebuiltBlocks[0] = {
                  ...rebuiltBlocks[0],
                  props: { ...rebuiltBlocks[0].props, ...pageBackgroundPatch } as never,
                } as Block;
              }
              return {
                id: desired.pageId,
                name: desired.label || toPlainText(existing?.name, `页面${idx + 1}`),
                blocks: rebuiltBlocks,
              };
            });
          }
        }
        const activePageId =
          syncedPages.find((page) => page.id === currentEditingPageId)?.id ??
          syncedPages.find((page) => page.id === withCurrentPage.activePageId)?.id ??
          syncedPages[0]?.id ??
          withCurrentPage.activePageId;
        const activePage = syncedPages.find((page) => page.id === activePageId) ?? syncedPages[0];
        return {
          ...withCurrentPage,
          pages: syncedPages,
          activePageId,
          blocks: cloneBlocks(activePage?.blocks ?? withCurrentPage.blocks),
        };
      }),
    };
  }

  function syncHistoryFlags() {
    setCanUndo(undoStackRef.current.length > 0);
    setCanRedo(redoStackRef.current.length > 0);
  }

  function cloneViewportEditorState(state: ViewportEditorState): ViewportEditorState {
    return {
      planConfig: clonePlanConfig(state.planConfig),
      editingPlanId: state.editingPlanId,
      editingPageId: state.editingPageId,
      blocks: cloneBlocks(state.blocks),
      selectedId: state.selectedId,
    };
  }

  function cloneViewportStates(states: Record<ViewportKey, ViewportEditorState>): Record<ViewportKey, ViewportEditorState> {
    return {
      desktop: cloneViewportEditorState(states.desktop),
      mobile: cloneViewportEditorState(states.mobile),
    };
  }

  function pushUndoSnapshot(snapshot: EditorSnapshot) {
    undoStackRef.current.push(snapshot);
    if (undoStackRef.current.length > HISTORY_LIMIT) {
      undoStackRef.current.shift();
    }
    redoStackRef.current = [];
    syncHistoryFlags();
  }

  function createSnapshot(): EditorSnapshot {
    const mergedPlanConfig = mergePlanConfigWithEditingBlocks(
      planConfigRef.current,
      editingPlanIdRef.current,
      editingPageIdRef.current,
      blocksRef.current,
      { syncNavPages: false },
    );
    const previewState: ViewportEditorState = {
      planConfig: clonePlanConfig(mergedPlanConfig),
      editingPlanId: editingPlanIdRef.current,
      editingPageId: editingPageIdRef.current,
      blocks: cloneBlocks(blocksRef.current),
      selectedId: selectedIdRef.current,
    };
    const otherViewport: ViewportKey = previewViewport === "desktop" ? "mobile" : "desktop";
    const otherState = cloneViewportEditorState(viewportStatesRef.current[otherViewport]);
    return {
      previewViewport,
      viewportStates:
        previewViewport === "desktop"
          ? { desktop: previewState, mobile: otherState }
          : { desktop: otherState, mobile: previewState },
    };
  }

  function applySnapshot(snapshot: EditorSnapshot) {
    pendingBlockPatchesRef.current = {};
    pendingBlockNudgesRef.current = {};
    pendingPlanSyncBlocksRef.current = null;
    pendingPlanSyncSyncNavPagesRef.current = false;
    if (pendingBlockPatchRafRef.current !== null) {
      window.cancelAnimationFrame(pendingBlockPatchRafRef.current);
      pendingBlockPatchRafRef.current = null;
    }
    if (pendingBlockNudgeRafRef.current !== null) {
      window.cancelAnimationFrame(pendingBlockNudgeRafRef.current);
      pendingBlockNudgeRafRef.current = null;
    }
    if (pendingPlanSyncTimeoutRef.current !== null) {
      window.clearTimeout(pendingPlanSyncTimeoutRef.current);
      pendingPlanSyncTimeoutRef.current = null;
    }
    if (blockPatchHistoryResetTimeoutRef.current !== null) {
      window.clearTimeout(blockPatchHistoryResetTimeoutRef.current);
      blockPatchHistoryResetTimeoutRef.current = null;
    }
    if (blockNudgeHistoryResetTimeoutRef.current !== null) {
      window.clearTimeout(blockNudgeHistoryResetTimeoutRef.current);
      blockNudgeHistoryResetTimeoutRef.current = null;
    }
    blockPatchHistoryBurstRef.current = false;
    blockNudgeHistoryBurstRef.current = false;
    const clonedStates = cloneViewportStates(snapshot.viewportStates);
    viewportStatesRef.current = clonedStates;
    const target = clonedStates[snapshot.previewViewport];
    setPreviewViewport(snapshot.previewViewport);
    const nextPlanConfig = clonePlanConfig(target.planConfig);
    const nextBlocks = cloneBlocks(target.blocks);
    planConfigRef.current = nextPlanConfig;
    blocksRef.current = nextBlocks;
    selectedIdRef.current = target.selectedId || "";
    setPlanConfig(nextPlanConfig);
    setEditingPlanId(target.editingPlanId);
    setEditingPageId(target.editingPageId);
    setBlocks(nextBlocks);
    setSelectedId(target.selectedId || "");
    saveBlocksToStorage(buildCombinedPersistedBlocks(clonedStates.desktop.planConfig, clonedStates.mobile.planConfig), storeScope);
  }

  function commitPlanConfigForBlocks(next: Block[], options?: { syncNavPages?: boolean }) {
    const navSyncKeyBefore = getNavSyncKey(blocksRef.current);
    const navSyncKeyAfter = getNavSyncKey(next);
    const shouldSyncNavPages = options?.syncNavPages ?? (navSyncKeyBefore !== navSyncKeyAfter);
    const nextPlanConfig = mergePlanConfigWithEditingBlocks(
      planConfigRef.current,
      editingPlanIdRef.current,
      editingPageIdRef.current,
      next,
      { syncNavPages: shouldSyncNavPages },
    );
    planConfigRef.current = nextPlanConfig;
    setPlanConfig(nextPlanConfig);
    persistDraftForConfigs(nextPlanConfig);
  }

  function flushPendingPlanSync() {
    if (pendingPlanSyncTimeoutRef.current !== null) {
      window.clearTimeout(pendingPlanSyncTimeoutRef.current);
      pendingPlanSyncTimeoutRef.current = null;
    }
    const nextBlocks = pendingPlanSyncBlocksRef.current;
    if (!nextBlocks) return;
    const syncNavPages = pendingPlanSyncSyncNavPagesRef.current;
    pendingPlanSyncBlocksRef.current = null;
    pendingPlanSyncSyncNavPagesRef.current = false;
    commitPlanConfigForBlocks(nextBlocks, { syncNavPages });
  }

  function schedulePlanSync(next: Block[], options?: { syncNavPages?: boolean }) {
    pendingPlanSyncBlocksRef.current = next;
    pendingPlanSyncSyncNavPagesRef.current =
      pendingPlanSyncSyncNavPagesRef.current || options?.syncNavPages === true;
    if (pendingPlanSyncTimeoutRef.current !== null) {
      window.clearTimeout(pendingPlanSyncTimeoutRef.current);
    }
    pendingPlanSyncTimeoutRef.current = window.setTimeout(() => {
      flushPendingPlanSync();
    }, 160);
  }

  function applyBlocks(
    next: Block[],
    options?: { selectedId?: string; recordHistory?: boolean; syncNavPages?: boolean; deferPlanSync?: boolean },
  ) {
    if (options?.recordHistory !== false) {
      pushUndoSnapshot(createSnapshot());
    }
    blocksRef.current = next;
    setBlocks(next);
    if (typeof options?.selectedId === "string") {
      selectedIdRef.current = options.selectedId;
      setSelectedId(options.selectedId);
    }
    if (options?.deferPlanSync) {
      schedulePlanSync(next, { syncNavPages: options.syncNavPages });
      return;
    }
    flushPendingPlanSync();
    commitPlanConfigForBlocks(next, { syncNavPages: options?.syncNavPages });
  }

  function scheduleBlockPatchHistoryReset() {
    if (blockPatchHistoryResetTimeoutRef.current !== null) {
      window.clearTimeout(blockPatchHistoryResetTimeoutRef.current);
    }
    blockPatchHistoryResetTimeoutRef.current = window.setTimeout(() => {
      blockPatchHistoryBurstRef.current = false;
      blockPatchHistoryResetTimeoutRef.current = null;
    }, 420);
  }

  function flushPendingBlockPatches() {
    if (pendingBlockPatchRafRef.current !== null) {
      window.cancelAnimationFrame(pendingBlockPatchRafRef.current);
      pendingBlockPatchRafRef.current = null;
    }
    const pendingEntries = Object.entries(pendingBlockPatchesRef.current);
    if (pendingEntries.length === 0) return;
    pendingBlockPatchesRef.current = {};
    const currentBlocks = blocksRef.current;
    const next = [...currentBlocks];
    let changed = false;
    let shouldSyncNavPages = false;
    pendingEntries.forEach(([blockId, patch]) => {
      const index = next.findIndex((item) => item.id === blockId);
      if (index < 0) return;
      const current = next[index];
      const nextProps = { ...current.props, ...patch } as Block["props"];
      let hasPatchChange = false;
      for (const [key, value] of Object.entries(patch)) {
        if ((current.props as Record<string, unknown>)[key] !== value) {
          hasPatchChange = true;
          break;
        }
      }
      if (!hasPatchChange) return;
      next[index] = {
        ...current,
        props: nextProps as never,
      } as Block;
      changed = true;
      if (current.type === "nav") {
        shouldSyncNavPages = true;
      }
    });
    if (!changed) return;
    applyBlocks(next, {
      recordHistory: !blockPatchHistoryBurstRef.current,
      syncNavPages: shouldSyncNavPages,
      deferPlanSync: true,
    });
    blockPatchHistoryBurstRef.current = true;
    scheduleBlockPatchHistoryReset();
  }

  function schedulePendingBlockPatchFlush() {
    if (pendingBlockPatchRafRef.current !== null) return;
    pendingBlockPatchRafRef.current = window.requestAnimationFrame(() => {
      flushPendingBlockPatches();
    });
  }

  function scheduleBlockNudgeHistoryReset() {
    if (blockNudgeHistoryResetTimeoutRef.current !== null) {
      window.clearTimeout(blockNudgeHistoryResetTimeoutRef.current);
    }
    blockNudgeHistoryResetTimeoutRef.current = window.setTimeout(() => {
      blockNudgeHistoryBurstRef.current = false;
      blockNudgeHistoryResetTimeoutRef.current = null;
    }, 420);
  }

  function flushPendingBlockNudges() {
    if (pendingBlockNudgeRafRef.current !== null) {
      window.cancelAnimationFrame(pendingBlockNudgeRafRef.current);
      pendingBlockNudgeRafRef.current = null;
    }
    const pendingEntries = Object.entries(pendingBlockNudgesRef.current);
    if (pendingEntries.length === 0) return;
    flushPendingBlockPatches();
    pendingBlockNudgesRef.current = {};
    const currentBlocks = blocksRef.current;
    const next = [...currentBlocks];
    let changed = false;
    pendingEntries.forEach(([blockId, pendingDelta]) => {
      const index = next.findIndex((item) => item.id === blockId);
      if (index < 0) return;
      const current = next[index];
      if (isBlockLocked(current)) return;
      const currentX =
        typeof current.props.blockOffsetX === "number" && Number.isFinite(current.props.blockOffsetX)
          ? Math.round(current.props.blockOffsetX)
          : 0;
      const currentY =
        typeof current.props.blockOffsetY === "number" && Number.isFinite(current.props.blockOffsetY)
          ? Math.round(current.props.blockOffsetY)
          : 0;
      const horizontalDelta = current.props.mobileFitScreenWidth === true ? 0 : pendingDelta.deltaX;
      if (!horizontalDelta && !pendingDelta.deltaY) return;
      const currentBaseX = current.props.mobileFitScreenWidth === true ? 0 : currentX;
      const clampedOffset = clampBlockOffsetToViewport(
        blockId,
        currentBaseX,
        currentY,
        currentBaseX + horizontalDelta,
        currentY + pendingDelta.deltaY,
      );
      if (clampedOffset.x === currentX && clampedOffset.y === currentY) return;
      next[index] = {
        ...current,
        props: {
          ...current.props,
          blockOffsetX: current.props.mobileFitScreenWidth === true ? 0 : clampedOffset.x,
          blockOffsetY: clampedOffset.y,
        } as never,
      } as Block;
      changed = true;
    });
    if (!changed) return;
    applyBlocks(next, {
      recordHistory: !blockNudgeHistoryBurstRef.current,
      syncNavPages: false,
      deferPlanSync: true,
    });
    blockNudgeHistoryBurstRef.current = true;
    scheduleBlockNudgeHistoryReset();
  }

  function schedulePendingBlockNudgeFlush() {
    if (pendingBlockNudgeRafRef.current !== null) return;
    pendingBlockNudgeRafRef.current = window.requestAnimationFrame(() => {
      flushPendingBlockNudges();
    });
  }

  function flushPendingEditorChanges() {
    flushBufferedEditorTextCommits();
    flushPendingBlockPatches();
    flushPendingBlockNudges();
    flushPendingPlanSync();
  }
  flushPendingEditorChangesRef.current = flushPendingEditorChanges;

  function undoEdit() {
    flushPendingEditorChanges();
    const previous = undoStackRef.current.pop();
    if (!previous) return;
    const current = createSnapshot();
    redoStackRef.current.push(current);
    if (redoStackRef.current.length > HISTORY_LIMIT) {
      redoStackRef.current.shift();
    }
    applySnapshot(previous);
    syncHistoryFlags();
  }

  function redoEdit() {
    flushPendingEditorChanges();
    const next = redoStackRef.current.pop();
    if (!next) return;
    const current = createSnapshot();
    undoStackRef.current.push(current);
    if (undoStackRef.current.length > HISTORY_LIMIT) {
      undoStackRef.current.shift();
    }
    applySnapshot(next);
    syncHistoryFlags();
  }

  async function trySaveWithResolvedMerchantIds(
    payload: { blocks: Block[]; updated_at: string },
    preferredMerchantIds: string[] = [],
    merchantSlug = "",
    timeoutMs = 45000,
  ) {
    if (isPlatformEditor) {
      merchantIdsRef.current = [];
      return withTimeout(saveBlocksToSupabaseFallback(payload, []), timeoutMs);
    }
    const strictPreferred = [...new Set(preferredMerchantIds.map((item) => item.trim()).filter(Boolean))];
    if (strictPreferred.length > 0) {
      merchantIdsRef.current = strictPreferred;
      return withTimeout(saveBlocksToSupabaseFallback(payload, strictPreferred, merchantSlug), timeoutMs);
    }
    let merchantIds = mergePreferredMerchantIds(merchantIdsRef.current);
    try {
      const gatewayReady = await canReachSupabaseGateway(Math.min(2500, AUTH_CHECK_TIMEOUT_MS));
      if (!gatewayReady) return withTimeout(saveBlocksToSupabaseFallback(payload, merchantIds, merchantSlug), timeoutMs);
      await readFreshMerchantSessionIdentity(Math.min(3600, AUTH_CHECK_TIMEOUT_MS)).catch(() => null);
      const resolvedMerchantIds = mergePreferredMerchantIds(merchantIdsRef.current);
      // Always prefer freshly resolved ids to avoid stale in-memory/session cache blocking publish.
      if (resolvedMerchantIds.length > 0) {
        merchantIds = mergePreferredMerchantIds(preferredMerchantIds, resolvedMerchantIds);
        merchantIdsRef.current = merchantIds;
      }
    } catch {
      merchantIds = merchantIdsRef.current;
    }
    merchantIds = mergePreferredMerchantIds(preferredMerchantIds, merchantIds);
    return withTimeout(saveBlocksToSupabaseFallback(payload, merchantIds, merchantSlug), timeoutMs);
  }

  async function trySaveViaServerPublishApi(
    payload: { blocks: Block[]; updated_at: string },
    preferredMerchantIds: string[] = [],
    merchantSlug = "",
    timeoutMs = 65000,
  ): Promise<{ handled: boolean; error: SaveErrorLike }> {
    const requestId = `publish-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const merchantIds = isPlatformEditor
      ? []
      : mergePreferredMerchantIds(preferredMerchantIds, merchantIdsRef.current);
    const requestBody = JSON.stringify({
      requestId,
      payload,
      merchantIds,
      merchantSlug,
      isPlatformEditor,
    });
    const waitBeforeRetry = () => new Promise<void>((resolve) => window.setTimeout(resolve, 1200));
    const isRetriablePublishFailure = (status: number, code: string) =>
      status === 502 ||
      status === 503 ||
      status === 504 ||
      code === "publish_backend_request_timeout" ||
      code === "publish_request_deadline_exceeded" ||
      code === "publish_request_failed";
    const sendRequest = async () => {
      const controller = new AbortController();
      const timer = window.setTimeout(() => {
        controller.abort();
      }, Math.max(3000, timeoutMs));
      try {
        const response = await fetch("/api/publish", {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          signal: controller.signal,
          body: requestBody,
        });
        const data = (await response.json().catch(() => null)) as
          | { ok?: boolean; code?: string; message?: string }
          | null;
        return { response, data };
      } finally {
        window.clearTimeout(timer);
      }
    };

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const { response, data } = await sendRequest();
        if (!response.ok) {
          const code = typeof data?.code === "string" ? data.code : "";
          const message = typeof data?.message === "string" ? data.message : `发布接口错误（HTTP ${response.status}）`;
          if (attempt === 0 && isRetriablePublishFailure(response.status, code)) {
            showSavePublishTip("发布接口响应超时，正在自动确认结果...");
            await waitBeforeRetry();
            continue;
          }
          if (!isPlatformEditor && isRetriablePublishFailure(response.status, code)) {
            showSavePublishTip("发布接口仍超时，正在切换备用发布通道...");
            return { handled: false, error: null };
          }
          if (code === "publish_service_unavailable") {
            return { handled: false, error: null };
          }
          return {
            handled: true,
            error: {
              code,
              message: normalizePublishApiErrorMessage(code, message, response.status),
            },
          };
        }
        return { handled: true, error: null };
      } catch {
        if (attempt === 0) {
          showSavePublishTip("发布接口连接中断，正在自动确认结果...");
          await waitBeforeRetry();
          continue;
        }
        if (!isPlatformEditor) showSavePublishTip("发布接口仍中断，正在切换备用发布通道...");
        return { handled: false, error: null };
      }
    }
    return { handled: false, error: null };
  }

  function openAlert(message: string, title = "提示"): Promise<void> {
    return new Promise((resolve) => {
      setDialog({ type: "alert", title, message, resolve });
    });
  }

  function openConfirm(message: string, title = "确认"): Promise<boolean> {
    return new Promise((resolve) => {
      setDialog({ type: "confirm", title, message, resolve });
    });
  }

  function persistPlanTemplates(nextTemplates: PlanTemplate[]) {
    const platformState = loadPlatformState();
    const saved = savePlatformState({
      ...platformState,
      planTemplates: nextTemplates,
    });
    if (!saved) {
      showTip("方案模板保存失败，请重试");
      return false;
    }
    setPlanTemplates(nextTemplates);
    return true;
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
    const { capturePlanTemplatePreviewAssets } = await import("@/lib/planTemplatePreviewCapture");
    const previewAssets = await capturePlanTemplatePreviewAssets(blocks).catch(() => null);
    if (!previewAssets) return template;
    const nextTemplate: PlanTemplate = {
      ...template,
      previewImageUrl: previewAssets.previewImageUrl,
      planPreviewImageUrls: previewAssets.planPreviewImageUrls,
      previewVariant: previewAssets.previewVariant,
      updatedAt: new Date().toISOString(),
    };
    const nextTemplates = planTemplates.map((item) => (item.id === template.id ? nextTemplate : item));
    if (!persistPlanTemplates(nextTemplates)) return template;
    return nextTemplate;
  }

  async function openPlanTemplatePreview(template: PlanTemplate, planId?: string, planName?: string) {
    const refreshedTemplate = await ensurePlanTemplatePreviewAssets(template);
    const previewUrl = planId
      ? String((refreshedTemplate.planPreviewImageUrls ?? {})[planId] ?? "").trim()
      : (refreshedTemplate.previewImageUrl ?? "").trim();
    if (!previewUrl) {
      showTip("该方案预览生成失败，请稍后重试");
      return;
    }
    setPlanTemplateCoverPreview({
      url: previewUrl,
      name: planId ? `${refreshedTemplate.name} · ${planName || "方案"} 整套页面预览` : `${refreshedTemplate.name} · 方案预览`,
    });
  }

  function updatePlanTemplateDraft(
    templateId: string,
    patch: Partial<Pick<PlanTemplate, "name" | "category">>,
    options?: { persist?: boolean },
  ) {
    const nextTemplates = planTemplates.map((template) =>
      template.id === templateId
        ? {
            ...template,
            name: typeof patch.name === "string" ? patch.name : template.name,
            category: (patch.category as PlanTemplateCategory | undefined) ?? template.category,
            updatedAt: new Date().toISOString(),
          }
        : template,
    );
    setPlanTemplates(nextTemplates);
    if (options?.persist) {
      return persistPlanTemplates(
        nextTemplates.map((template) =>
          template.id === templateId
            ? {
                ...template,
                name: template.name.trim() || "未命名方案",
              }
            : template,
        ),
      );
    }
    return true;
  }

  async function deletePlanTemplate(template: PlanTemplate) {
    const confirmed = await openConfirm(`删除方案模板「${template.name}」后不可恢复，是否继续？`, "删除方案模板");
    if (!confirmed) return;
    const currentTemplates = loadPlatformState().planTemplates ?? [];
    const nextTemplates = currentTemplates.filter((item) => item.id !== template.id);
    if (!persistPlanTemplates(nextTemplates)) return;
    showTip(`已删除方案：${template.name}`);
  }

  async function applyPlanTemplate(template: PlanTemplate) {
    const loadedBlocks = Array.isArray(template.blocks) ? (template.blocks as Block[]) : [];
    if (loadedBlocks.length === 0) {
      showTip("该方案没有可应用的页面内容");
      return;
    }
    const templateDesktopConfig = getPagePlanConfigFromBlocks(loadedBlocks);
    const templateMobileConfig = getEmbeddedMobilePlanConfig(loadedBlocks);
    if (
      countBookingBlocksInPlanConfig(templateDesktopConfig) > 1 ||
      countBookingBlocksInPlanConfig(templateMobileConfig) > 1
    ) {
      showTip("预约区块只能有一个");
      return;
    }
    const confirmed = await openConfirm(
      `应用方案「${template.name}」会覆盖当前编辑中的整套 PC 和手机方案，是否继续？`,
      "应用方案模板",
    );
    if (!confirmed) return;
    pushUndoSnapshot(createSnapshot());
    applyPersistedBlocksToEditorRef.current(loadedBlocks, { resetHistory: false });
    setPlanTemplateDialogOpen(false);
    showTip(`已应用方案：${template.name}`);
  }

  applyPersistedBlocksToEditorRef.current = applyPersistedBlocksToEditor;
  recordDragHistoryRef.current = () => {
    pushUndoSnapshot(createSnapshot());
  };
  persistDraggingDraftRef.current = () => {
    persistDraftForConfigs(
      mergePlanConfigWithEditingBlocks(
        planConfigRef.current,
        editingPlanIdRef.current,
        editingPageIdRef.current,
        blocksRef.current,
        { syncNavPages: false },
      ),
    );
  };

  useEffect(() => {
    if (typeof window === "undefined") return () => {};
    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      if (!isIgnorableAbortReason(event.reason)) return;
      event.preventDefault();
    };
    window.addEventListener("unhandledrejection", onUnhandledRejection);
    return () => {
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    let uiReleased = false;
    const clearJustSignedInFlagFromUrl = () => {
      if (typeof window === "undefined") return;
      try {
        const url = new URL(window.location.href);
        if (!url.searchParams.has("justSignedIn")) return;
        url.searchParams.delete("justSignedIn");
        window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
      } catch {
        // ignore URL cleanup failure
      }
    };
    const releaseCheckingScreen = (options?: { notice?: string | null }) => {
      if (!mounted) return;
      if (Object.prototype.hasOwnProperty.call(options ?? {}, "notice")) {
        setBackendNotice(options?.notice ?? null);
      }
      if (!uiReleased) {
        uiReleased = true;
        setCheckingAuth(false);
      }
    };
    const isNativeMerchantShellRuntime = () => {
      if (isPlatformEditor || typeof window === "undefined" || typeof document === "undefined") return false;
      return (
        document.documentElement.dataset.capacitor === "true" ||
        Boolean((window as Window & { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.())
      );
    };
    const isNativeNotificationLaunch = () => {
      if (typeof window === "undefined") return false;
      return new URLSearchParams(window.location.search).get("nativeNotification") === "1";
    };
    const isExplicitFaollaSectionLaunch = () =>
      typeof window !== "undefined" && isFaollaSectionSearch(window.location.search);
    const preserveNativeFaollaShell = () => {
      const faollaAppShellActive =
        typeof window !== "undefined" && isFaollaAppShellSearch(window.location.search);
      if (!isNativeMerchantShellRuntime() && !faollaAppShellActive) return false;
      const faollaSectionActive =
        supportMobileHomeTabRef.current === "faolla" ||
        (typeof window !== "undefined" && isFaollaSectionSearch(window.location.search)) ||
        faollaAppShellActive;
      if (!faollaSectionActive) return false;
      const recentMerchantId = readRecentMerchantLaunchMerchantId();
      if (isMerchantNumericId(recentMerchantId)) {
        merchantIdsRef.current = mergePreferredMerchantIds([recentMerchantId], merchantIdsRef.current);
        setMerchantSiteIdOverride((current) => current || recentMerchantId);
      }
      setRemoteContentVerified(false);
      setHasEditorContent(true);
      setSelectedId("");
      setBackendNotice(null);
      setMerchantDesktopSection("faolla");
      setSupportMobileHomeTab("faolla");
      releaseCheckingScreen({ notice: null });
      return true;
    };
    const redirectNativeMerchantShellToLaunch = () => {
      if (!isNativeMerchantShellRuntime()) return false;
      const recentMerchantId = readRecentMerchantLaunchMerchantId();
      if (!isMerchantNumericId(recentMerchantId)) return false;

      const retryStorageKey = "faolla:native-merchant-auth-retry";
      let retryCount = 0;
      try {
        const raw = window.sessionStorage.getItem(retryStorageKey);
        const parsed = raw ? (JSON.parse(raw) as { count?: unknown; at?: unknown }) : null;
        const timestamp = typeof parsed?.at === "number" && Number.isFinite(parsed.at) ? parsed.at : 0;
        if (Date.now() - timestamp <= 60_000) {
          retryCount = Math.max(0, Math.min(3, Number(parsed?.count) || 0));
        }
      } catch {
        retryCount = 0;
      }
      if (retryCount >= 2) return false;
      try {
        window.sessionStorage.setItem(
          retryStorageKey,
          JSON.stringify({
            count: retryCount + 1,
            at: Date.now(),
          }),
        );
      } catch {
        // Best effort only; the redirect itself is what matters.
      }
      window.location.replace(`/launch?nativeAuthRetry=${retryCount + 1}`);
      return true;
    };
    const releaseMerchantUnauthenticatedState = () => {
      if (!mounted) return;
      if (preserveNativeFaollaShell()) return;
      if (shouldPreserveMerchantSessionDuringResume()) {
        setRemoteContentVerified(false);
        setHasEditorContent(true);
        releaseCheckingScreen({ notice: null });
        return;
      }
      if (redirectNativeMerchantShellToLaunch()) return;
      let reloadStorage: AdminAutoReloadStorage | null = null;
      try {
        reloadStorage = window.sessionStorage;
      } catch {
        reloadStorage = null;
      }
      if (claimAdminAutoReload(reloadStorage, window.location.pathname)) {
        window.location.reload();
        return;
      }
      const currentHref = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      window.location.replace(`/login?redirect=${encodeURIComponent(currentHref)}`);
    };
    const shouldPreserveMerchantSessionDuringResume = () => {
      if (isPlatformEditor || typeof document === "undefined") return false;
      if (document.visibilityState !== "visible") return true;
      if (Date.now() - lastMerchantResumeAtRef.current <= 45_000) return true;
      if (!isNativeMerchantShellRuntime()) return false;
      if (isNativeNotificationLaunch()) return true;
      const recentMerchantId = readRecentMerchantLaunchMerchantId();
      if (!isMerchantNumericId(recentMerchantId)) return false;
      const backgroundedAt = lastMerchantBackgroundedAtRef.current;
      if (backgroundedAt <= 0) return true;
      return Date.now() - backgroundedAt <= 12 * 60 * 60 * 1000;
    };
    const releaseExplicitFaollaSectionShell = () => {
      if (!explicitFaollaSectionEntry) return false;
      const scopedSiteId = getSiteIdFromStoreScope(storeScope).trim();
      if (scopedSiteId) {
        merchantIdsRef.current = mergePreferredMerchantIds([scopedSiteId], merchantIdsRef.current);
        setMerchantSiteIdOverride((current) => current || scopedSiteId);
      }
      setRemoteContentVerified(false);
      setHasEditorContent(true);
      setSelectedId("");
      setBackendNotice(null);
      setMerchantDesktopSection("faolla");
      setSupportMobileHomeTab("faolla");
      releaseCheckingScreen({ notice: null });
      return true;
    };
    const getCandidateStoreScopes = () =>
      storeScope !== "default"
        ? [storeScope]
        : (() => {
            const siteScopes = loadPlatformState()
              .sites.map((item) => buildSiteStoreScope(item.id))
              .filter((item) => item && item !== "default");
            const discoveredScopes = discoverSiteScopesFromLocalStorage();
            return [...new Set([...siteScopes, ...discoveredScopes, "default"])];
          })();
    const isMeaningfulCachedSnapshot = (candidate: Block[]) =>
      candidate.length > 0 &&
      !isSameBlocksSnapshot(candidate, defaultEditorBlocks) &&
      !isSameBlocksSnapshot(candidate, homeBlocks);
    const hasMeaningfulCachedDraft = (candidateScopes = getCandidateStoreScopes()) => {
      for (const candidateScope of candidateScopes) {
        const cachedDraft = loadBlocksFromStorage([], candidateScope);
        if (isMeaningfulCachedSnapshot(cachedDraft)) {
          return true;
        }
      }
      return false;
    };
    const getRemoteDraftSyncScopes = (merchantIds: string[]) =>
      [...new Set([storeScope, ...merchantIds.map((siteId) => buildSiteStoreScope(siteId))].filter(Boolean))];
    const getRemoteVerificationScopes = (merchantIds: string[]) => getRemoteDraftSyncScopes(merchantIds);
    const resolveCachedRemoteVerification = (candidateScopes = getCandidateStoreScopes()) =>
      hasRemoteContentVerifiedStamp(candidateScopes);
    const markRemoteContentVerified = (candidateScopes: string[], recordedAt?: string | null | undefined) => {
      candidateScopes.forEach((candidateScope) => {
        recordRemoteContentVerifiedTimestamp(candidateScope, recordedAt);
      });
      setRemoteContentVerified(true);
    };
    const hasAppliedRemoteDraftAtOrAfter = (updatedAt: string | null | undefined, candidateScopes: string[]) => {
      const remoteUpdatedAtMs = parseIsoTimestampMs(updatedAt);
      if (remoteUpdatedAtMs <= 0) return false;
      const latestAppliedMs = candidateScopes.reduce((max, candidateScope) => {
        return Math.max(max, parseIsoTimestampMs(readRemoteMerchantDraftSyncTimestamp(candidateScope)));
      }, 0);
      return latestAppliedMs >= remoteUpdatedAtMs;
    };
    const shouldApplyRemoteDraft = (draft: MerchantDraftSnapshot | null, candidateScopes: string[]) => {
      if (!draft || draft.blocks.length === 0) return false;
      if (!hasMeaningfulCachedDraft(candidateScopes)) return true;
      return !hasAppliedRemoteDraftAtOrAfter(draft.updatedAt, candidateScopes);
    };
    const markRemoteDraftApplied = (updatedAt: string | null | undefined, candidateScopes: string[]) => {
      candidateScopes.forEach((candidateScope) => {
        recordRemoteMerchantDraftSyncTimestamp(updatedAt, candidateScope);
      });
    };
    const applyCachedEditorBlocks = () => {
      if (isPlatformEditor && platformSeedBlocks.length > 0) {
        savePublishedBlocksToStorage(platformSeedBlocks, storeScope);
      }
      const candidateScopes = getCandidateStoreScopes();
      for (const candidateScope of candidateScopes) {
        const cachedDraft = loadBlocksFromStorage([], candidateScope);
        if (isMeaningfulCachedSnapshot(cachedDraft)) {
          applyPersistedBlocksToEditorRef.current(cachedDraft, { resetHistory: true });
          return cachedDraft;
        }
        const cachedPublished = loadPublishedBlocksFromStorage([], candidateScope);
        if (isMeaningfulCachedSnapshot(cachedPublished)) {
          applyPersistedBlocksToEditorRef.current(cachedPublished, { resetHistory: true });
          return cachedPublished;
        }
      }
      return [];
    };
    const tryLoadJustSignedInPublishedContent = async () => {
      if (isPlatformEditor || !justSignedIn) return false;
      const scopedSiteId = getSiteIdFromStoreScope(storeScope).trim();
      if (!scopedSiteId) return false;
      const publishedSnapshot = await loadPublishedSiteSnapshotViaApi(scopedSiteId);
      if (!mounted || !publishedSnapshot) return false;
      merchantIdsRef.current = [scopedSiteId];
      applyPublishedSiteSnapshotToScopedMerchantSite(scopedSiteId, publishedSnapshot, null);
      setHasEditorContent(true);
      markRemoteContentVerified([storeScope, buildSiteStoreScope(scopedSiteId)]);
      applyPersistedBlocksToEditorRef.current(publishedSnapshot.blocks);
      const desktopLoaded = viewportStatesRef.current.desktop.planConfig;
      const mobileLoaded = viewportStatesRef.current.mobile.planConfig;
      const combinedLoaded = buildCombinedPersistedBlocks(desktopLoaded, mobileLoaded);
      savePublishedBlocksToStorage(combinedLoaded, storeScope);
      savePublishedBlocksToStorage(combinedLoaded, buildSiteStoreScope(scopedSiteId));
      await hydrateSupportMerchantProfileRef.current(scopedSiteId, {
        persistToLocalSite: true,
      }).catch(() => null);
      if (!mounted) return false;
      releaseCheckingScreen({ notice: null });
      return true;
    };
    if (releaseExplicitFaollaSectionShell()) {
      return () => {
        mounted = false;
        merchantIdsRef.current = [];
      };
    }
    if (!isSupabaseEnabled || isSupabaseFallbackMode) {
      applyCachedEditorBlocks();
      setHasEditorContent(true);
      setRemoteContentVerified(true);
      releaseCheckingScreen({
        notice:
          supabaseMissingEnvNotice ??
          (isSupabaseFallbackMode
            ? "开发环境离线模式：已跳过远程登录检查，使用本地缓存。"
            : BACKEND_UNAVAILABLE_NOTICE),
      });
      return () => {
        mounted = false;
        merchantIdsRef.current = [];
      };
    }

    setRemoteContentVerified(resolveCachedRemoteVerification(getCandidateStoreScopes()));
    const initialCached = applyCachedEditorBlocks();
    if (initialCached.length === 0) {
      setHasEditorContent(true);
    }

    const safetyTimeoutId = setTimeout(() => {
      applyCachedEditorBlocks();
      setHasEditorContent(true);
      releaseCheckingScreen({ notice: null });
    }, AUTH_CHECK_TIMEOUT_MS);
    let authSubscription: { unsubscribe: () => void } | null = null;
    let detachKeepAlive: (() => void) | null = null;
    let recoverSessionInFlight: Promise<Awaited<ReturnType<typeof recoverBrowserSupabaseSessionWithRefresh>>> | null = null;
    const recoverCookieBackedMerchantAccess = async (timeoutMs: number) => {
      if (isPlatformEditor) return null;
      const [cookieSession, freshIdentity] = await Promise.all([
        recoverBrowserSupabaseSessionViaMerchantCookies(Math.max(2200, Math.min(7000, timeoutMs))).catch(() => null),
        readFreshMerchantSessionIdentity(Math.max(2200, Math.min(7000, timeoutMs))).catch(() => null),
      ]);
      const merchantId = freshIdentity?.merchantId?.trim() ?? "";
      const email =
        (typeof freshIdentity?.email === "string" ? freshIdentity.email.trim() : "") ||
        (typeof cookieSession?.user?.email === "string" ? cookieSession.user.email.trim() : "");
      if (!cookieSession && !merchantId && !email) return null;
      if (merchantId) {
        merchantIdsRef.current = mergePreferredMerchantIds([merchantId], merchantIdsRef.current);
        setMerchantSiteIdOverride((current) => current || merchantId);
      }
      merchantSessionIdentityRef.current = {
        merchantId,
        email: email || null,
      };
      return {
        session: cookieSession,
        merchantId,
        email: email || null,
      };
    };
    const recoverSession = async (timeoutMs: number) => {
      if (recoverSessionInFlight) return recoverSessionInFlight;
      const task = recoverBrowserSupabaseSessionWithRefresh(Math.max(2200, Math.min(9000, timeoutMs + 1200)));
      recoverSessionInFlight = task;
      try {
        return await task;
      } finally {
        if (recoverSessionInFlight === task) {
          recoverSessionInFlight = null;
        }
      }
    };
    const attachAuthListener = () => {
      if (isPlatformEditor) return;
      if (authSubscription || !mounted) return;
      const { data } = supabase.auth.onAuthStateChange((_event, session) => {
        if (session) {
          void syncMerchantSessionCookies(session, Math.max(2200, Math.min(6000, AUTH_CHECK_TIMEOUT_MS)));
          return;
        }
        if (!mounted) return;
        void (async () => {
          const gatewayReady = await canReachSupabaseGateway(Math.min(2000, AUTH_CHECK_TIMEOUT_MS));
          if (!mounted || !gatewayReady) return;
          const confirmedSession = await recoverSession(justSignedIn ? 6000 : 4500);
          if (!mounted || confirmedSession) return;
          const cookieBackedAccess = await recoverCookieBackedMerchantAccess(justSignedIn ? 6000 : 4500);
          if (!mounted) return;
          if (cookieBackedAccess?.session || cookieBackedAccess?.merchantId || cookieBackedAccess?.email) {
            setRemoteContentVerified(resolveCachedRemoteVerification());
            setHasEditorContent(true);
            setBackendNotice(null);
            releaseCheckingScreen({ notice: null });
            return;
          }
          if (shouldPreserveMerchantSessionDuringResume()) {
            return;
          }
          if (justSignedIn) {
            releaseMerchantUnauthenticatedState();
            return;
          }
          releaseMerchantUnauthenticatedState();
        })().catch(() => {
          // Ignore listener network failures; keep current editor session.
        });
      });
      authSubscription = data.subscription;
    };

    const gatewayReadyTask = canReachSupabaseGateway(Math.min(3000, AUTH_CHECK_TIMEOUT_MS)).catch(() => false);
    const initialMerchantPayloadTask = !isPlatformEditor
      ? withTimeout(
          readMerchantSessionPayload(Math.max(2200, Math.min(7000, AUTH_CHECK_TIMEOUT_MS))),
          AUTH_CHECK_TIMEOUT_MS,
          "登录检查超时，已使用本地缓存继续编辑",
        ).catch(() => null)
      : null;

    (async () => {
      try {
        let gatewayReady: boolean | null = null;
        const readGatewayReady = async () => {
          if (gatewayReady !== null) return gatewayReady;
          gatewayReady = await gatewayReadyTask;
          return gatewayReady;
        };

        if (!isPlatformEditor) {
          let merchantPayload = initialMerchantPayloadTask ? await initialMerchantPayloadTask : null;
          let merchantIds = merchantPayload?.authenticated === true ? readMerchantSessionMerchantIds(merchantPayload) : [];
          let merchantId = merchantIds.find((item) => isMerchantNumericId(item)) ?? merchantIds[0] ?? "";
          let merchantEmail =
            typeof merchantPayload?.user?.email === "string" ? merchantPayload.user.email.trim() : "";

          if (!mounted) return;
          clearTimeout(safetyTimeoutId);

          if (!merchantId && !merchantEmail) {
            const recoveredSession = await recoverSession(justSignedIn ? 7000 : 5200);
            if (!mounted) return;
            if (recoveredSession?.user) {
              await syncMerchantSessionCookies(
                recoveredSession,
                Math.max(2400, Math.min(6500, AUTH_CHECK_TIMEOUT_MS)),
              ).catch(() => null);
              merchantPayload = await withTimeout(
                readMerchantSessionPayload(Math.max(2200, Math.min(7000, AUTH_CHECK_TIMEOUT_MS))),
                AUTH_CHECK_TIMEOUT_MS,
                "登录检查超时，已使用本地缓存继续编辑",
              ).catch(() => null);
              merchantIds = merchantPayload?.authenticated === true ? readMerchantSessionMerchantIds(merchantPayload) : [];
              merchantId = merchantIds.find((item) => isMerchantNumericId(item)) ?? merchantIds[0] ?? "";
              merchantEmail =
                typeof merchantPayload?.user?.email === "string" ? merchantPayload.user.email.trim() : "";
            }
          }

          if (merchantIds.length > 0) {
            merchantIdsRef.current = mergePreferredMerchantIds(merchantIds, merchantIdsRef.current);
          }
          if (merchantId || merchantEmail) {
            merchantSessionIdentityRef.current = {
              merchantId,
              email: merchantEmail || null,
            };
            if (merchantId) {
              setMerchantSiteIdOverride((current) => current || merchantId);
            }
            if (!detachKeepAlive) {
              detachKeepAlive = startMerchantSessionKeepAlive({
                intervalMs: 2 * 60_000,
                timeoutMs: Math.max(2200, Math.min(6000, AUTH_CHECK_TIMEOUT_MS)),
              });
            }
          }

          if (!merchantId && !merchantEmail) {
            const merchantGatewayReady = await readGatewayReady();
            if (!mounted) return;
            if (!merchantGatewayReady) {
              releaseCheckingScreen({ notice: BACKEND_UNAVAILABLE_NOTICE });
              return;
            }
            if (justSignedIn) {
              const restored = await tryLoadJustSignedInPublishedContent();
              if (!mounted) return;
              if (restored) return;
              releaseMerchantUnauthenticatedState();
              return;
            }
            releaseMerchantUnauthenticatedState();
            return;
          }

          if (justSignedIn && typeof window !== "undefined") {
            const scopedMerchantId = getSiteIdFromStoreScope(storeScope).trim();
            if (scopedMerchantId) {
              clearMerchantSignInBridge(scopedMerchantId);
            }
            clearJustSignedInFlagFromUrl();
          }
          setBackendNotice(null);
          if (initialCached.length > 0) {
            releaseCheckingScreen();
          }

          const preferredByScope = getSiteIdFromStoreScope(storeScope);
          const resolvedMerchantIds = preferredByScope ? [preferredByScope] : mergePreferredMerchantIds(merchantIdsRef.current);
          merchantIdsRef.current = resolvedMerchantIds;
          const scopedSiteId = getSiteIdFromStoreScope(storeScope).trim();
          const preferredNumericId = resolvedMerchantIds.find((item) => isMerchantNumericId(item)) ?? "";
          const currentMerchantSiteId = scopedSiteId || preferredNumericId || resolvedMerchantIds[0] || "";
          if (!scopedSiteId && preferredNumericId) {
            window.location.replace(`/${encodeURIComponent(preferredNumericId)}`);
            return;
          }
          if (currentMerchantSiteId) {
            ensureScopedMerchantSite(currentMerchantSiteId, merchantEmail || null);
            void syncScopedMerchantSiteFromPublishedSnapshot(currentMerchantSiteId, merchantEmail || null);
          }
          if (isExplicitFaollaSectionLaunch()) {
            setHasEditorContent(true);
            setBackendNotice(null);
            setMerchantDesktopSection("faolla");
            setSupportMobileHomeTab("faolla");
            releaseCheckingScreen({ notice: null });
          }
          const currentMerchantProfileTask = isMerchantNumericId(currentMerchantSiteId)
            ? hydrateSupportMerchantProfileRef.current(currentMerchantSiteId, {
                persistToLocalSite: true,
              })
            : Promise.resolve(null);
          if (initialCached.length > 0) {
            void currentMerchantProfileTask.catch(() => null);
            releaseCheckingScreen();
          }
          const identityNotice = getMerchantIdentityNotice(resolvedMerchantIds);
          if (identityNotice) {
            setHasEditorContent(true);
            void currentMerchantProfileTask.catch(() => null);
            releaseCheckingScreen({ notice: identityNotice });
            return;
          }

          const remoteDraft = await loadMerchantDraftSnapshotViaApi(resolvedMerchantIds);
          if (!mounted) return;
          if (remoteDraft) {
            const remoteDraftScopes = getRemoteDraftSyncScopes([remoteDraft.siteId, ...resolvedMerchantIds]);
            applyPersistedBlocksToEditorRef.current(remoteDraft.blocks);
            const desktopLoaded = viewportStatesRef.current.desktop.planConfig;
            const mobileLoaded = viewportStatesRef.current.mobile.planConfig;
            const combinedLoaded = buildCombinedPersistedBlocks(desktopLoaded, mobileLoaded);
            saveLatestDraftSnapshot(combinedLoaded, storeScope, {
              source: "remote",
              sourceUpdatedAt: remoteDraft.updatedAt,
            });
            remoteDraftScopes.forEach((scope) => {
              if (scope !== storeScope) {
                saveLatestDraftSnapshot(combinedLoaded, scope, {
                  source: "remote",
                  sourceUpdatedAt: remoteDraft.updatedAt,
                });
              }
            });
            markRemoteDraftApplied(remoteDraft.updatedAt, remoteDraftScopes);
            void currentMerchantProfileTask.catch(() => null);
            releaseCheckingScreen({ notice: null });
            return;
          }

          const publishedSnapshot = await loadPublishedSiteSnapshotForMerchantIds(resolvedMerchantIds);
          if (!mounted) return;
          if (publishedSnapshot) {
            const verificationScopes = getRemoteVerificationScopes([publishedSnapshot.siteId, ...resolvedMerchantIds]);
            markRemoteContentVerified(verificationScopes);
            applyPublishedSiteSnapshotToScopedMerchantSite(
              publishedSnapshot.siteId,
              publishedSnapshot,
              merchantEmail || null,
            );
            applyPersistedBlocksToEditorRef.current(publishedSnapshot.blocks);
            const desktopLoaded = viewportStatesRef.current.desktop.planConfig;
            const mobileLoaded = viewportStatesRef.current.mobile.planConfig;
            const combinedLoaded = buildCombinedPersistedBlocks(desktopLoaded, mobileLoaded);
            savePublishedBlocksToStorage(combinedLoaded, storeScope);
            verificationScopes.forEach((scope) => {
              if (scope !== storeScope) {
                savePublishedBlocksToStorage(combinedLoaded, scope);
              }
            });
            void currentMerchantProfileTask.catch(() => null);
            releaseCheckingScreen({ notice: null });
            return;
          }

          setHasEditorContent(true);
          setRemoteContentVerified(resolveCachedRemoteVerification(getRemoteVerificationScopes(resolvedMerchantIds)));
          void currentMerchantProfileTask.catch(() => null);
          const merchantGatewayReady = await readGatewayReady();
          if (!mounted) return;
          releaseCheckingScreen({
            notice: merchantGatewayReady ? null : "当前内容加载不完整，请刷新页面或重新登录后重试。",
          });
          return;
        }

        gatewayReady = await readGatewayReady();
        if (!mounted) return;
        if (!gatewayReady) {
          setBackendNotice("后端连接不稳定，正在尝试直接获取远端内容...");
        }

        const {
          data: { session: rawSession },
          error: sessionError,
        } = await withTimeout(
          supabase.auth.getSession(),
          AUTH_CHECK_TIMEOUT_MS,
          "登录检查超时，已使用本地缓存继续编辑",
        );
        let session = rawSession;
        let sessionRecoveredFromFallback = false;
        let cookieBackedMerchantIdentity: { merchantId: string; email: string | null } | null = null;

        if (!mounted) return;
        clearTimeout(safetyTimeoutId);
        if (sessionError && !session) {
          session = await recoverSession(justSignedIn ? 6000 : 4500);
          sessionRecoveredFromFallback = Boolean(session);
          if (!mounted) return;
        }
        if (!session) {
          session = await recoverSession(justSignedIn ? 6000 : 4500);
          sessionRecoveredFromFallback = Boolean(session);
          if (!mounted) return;
        }
        if (!session && !isPlatformEditor) {
          const cookieBackedAccess = await recoverCookieBackedMerchantAccess(justSignedIn ? 6000 : 4500);
          if (!mounted) return;
          if (cookieBackedAccess?.session) {
            session = cookieBackedAccess.session;
            sessionRecoveredFromFallback = true;
          }
          if (cookieBackedAccess?.merchantId || cookieBackedAccess?.email) {
            cookieBackedMerchantIdentity = {
              merchantId: cookieBackedAccess.merchantId,
              email: cookieBackedAccess.email,
            };
          }
        }
        if (sessionError && !session && !isPlatformEditor && !gatewayReady) {
          releaseCheckingScreen({ notice: BACKEND_UNAVAILABLE_NOTICE });
          return;
        }
        if (sessionRecoveredFromFallback && session && !isPlatformEditor) {
          void syncMerchantSessionCookies(session, Math.max(2200, Math.min(6000, AUTH_CHECK_TIMEOUT_MS)));
        }
        if (session && !isPlatformEditor && !detachKeepAlive) {
          detachKeepAlive = startMerchantSessionKeepAlive({
            intervalMs: 2 * 60_000,
            timeoutMs: Math.max(2200, Math.min(6000, AUTH_CHECK_TIMEOUT_MS)),
          });
        }
        if (session) {
          try {
            const { data, error } = await withTimeout(
              supabase.auth.getUser(),
              Math.max(2500, Math.min(6000, AUTH_CHECK_TIMEOUT_MS)),
              "登录校验超时，已回退到重新登录",
            );
            const transientValidationFailure = Boolean(error) && (isTransientAuthValidationError(error) || !gatewayReady);
            if (transientValidationFailure) {
              // Keep the current browser session on transient validation failures.
            } else if (error || !data.user) {
              const recoveredSession = await recoverSession(Math.max(2200, Math.min(6000, AUTH_CHECK_TIMEOUT_MS)));
              if (!mounted) return;
              if (!recoveredSession?.user) {
                const cookieBackedAccess = await recoverCookieBackedMerchantAccess(Math.max(2600, Math.min(7000, AUTH_CHECK_TIMEOUT_MS)));
                if (!mounted) return;
                if (cookieBackedAccess?.session?.user) {
                  session = cookieBackedAccess.session;
                  cookieBackedMerchantIdentity = {
                    merchantId: cookieBackedAccess.merchantId,
                    email: cookieBackedAccess.email,
                  };
                } else {
                  await supabase.auth.signOut({ scope: "local" }).catch(() => {
                    // ignore local session cleanup failure
                  });
                  session = null;
                }
              } else {
                session = recoveredSession;
              }
            } else {
              session = { ...session, user: data.user };
            }
          } catch {
            // Keep current session on transient validation failure.
          }
        }
        if (!session) {
          if (isPlatformEditor) {
            setBackendNotice(null);
            if (initialCached.length > 0) {
              releaseCheckingScreen({ notice: null });
            } else {
              setHasEditorContent(true);
              releaseCheckingScreen({ notice: null });
            }
          } else {
            if (justSignedIn) {
              const restored = await tryLoadJustSignedInPublishedContent();
              if (!mounted) return;
              if (restored) return;
              releaseMerchantUnauthenticatedState();
              return;
            }
            if (cookieBackedMerchantIdentity) {
              setBackendNotice(null);
              setRemoteContentVerified(resolveCachedRemoteVerification());
              setHasEditorContent(true);
              releaseCheckingScreen({ notice: null });
            } else {
              releaseMerchantUnauthenticatedState();
              return;
            }
          }
        }
        if (session) {
          attachAuthListener();
        }
        if (session && justSignedIn && typeof window !== "undefined") {
          const scopedMerchantId = getSiteIdFromStoreScope(storeScope).trim();
          if (scopedMerchantId) {
            clearMerchantSignInBridge(scopedMerchantId);
          }
          clearJustSignedInFlagFromUrl();
        }
        if (!isPlatformEditor || session || cookieBackedMerchantIdentity) {
          setBackendNotice(null);
        }
        if (initialCached.length > 0) {
          releaseCheckingScreen();
        }

        let resolvedMerchantIds: string[] = [];
          if (!isPlatformEditor) {
            const activeSession = session;
            if (!activeSession && !cookieBackedMerchantIdentity) {
              releaseCheckingScreen({ notice: BACKEND_UNAVAILABLE_NOTICE });
              return;
            }
            const merchantIds = activeSession
              ? await withTimeout(
                  (() => {
                    const scopedSiteId = getSiteIdFromStoreScope(storeScope).trim();
                    if (scopedSiteId) return Promise.resolve([scopedSiteId]);
                    const hintedMerchantIds = mergePreferredMerchantIds([
                      ...readMerchantIdsFromMetadata(
                        activeSession.user.user_metadata as Record<string, unknown> | null | undefined,
                        activeSession.user.app_metadata as Record<string, unknown> | null | undefined,
                      ),
                      cookieBackedMerchantIdentity?.merchantId ?? "",
                      merchantSessionIdentityRef.current.merchantId,
                      ...merchantIdsRef.current,
                    ]);
                    if (hintedMerchantIds.length > 0) {
                      writeCachedMerchantIds(activeSession.user.id, activeSession.user.email ?? undefined, hintedMerchantIds);
                      return Promise.resolve(hintedMerchantIds);
                    }
                    return resolveMerchantIds(activeSession.user.id, activeSession.user.email, {
                      ...(activeSession.user.user_metadata ?? {}),
                      ...(activeSession.user.app_metadata ?? {}),
                    });
                  })(),
                  AUTH_CHECK_TIMEOUT_MS,
                  "商户识别超时，已使用本地缓存继续编辑",
                )
              : mergePreferredMerchantIds(
                  [
                    cookieBackedMerchantIdentity?.merchantId ?? "",
                    ...(merchantIdsRef.current ?? []),
                  ].filter(Boolean),
                );
            if (!mounted) return;
            const preferredByScope = getSiteIdFromStoreScope(storeScope);
            resolvedMerchantIds = preferredByScope ? [preferredByScope] : mergePreferredMerchantIds(merchantIds);
            merchantIdsRef.current = resolvedMerchantIds;
            const scopedSiteId = getSiteIdFromStoreScope(storeScope).trim();
            const preferredNumericId = resolvedMerchantIds.find((item) => isMerchantNumericId(item)) ?? "";
            const currentMerchantSiteId = scopedSiteId || preferredNumericId || resolvedMerchantIds[0] || "";
            if (!scopedSiteId && preferredNumericId) {
              window.location.replace(`/${encodeURIComponent(preferredNumericId)}`);
              return;
            }
            if (currentMerchantSiteId) {
              const merchantEmail =
                activeSession?.user?.email ??
                (typeof cookieBackedMerchantIdentity?.email === "string" ? cookieBackedMerchantIdentity.email : null);
              ensureScopedMerchantSite(currentMerchantSiteId, merchantEmail);
              void syncScopedMerchantSiteFromPublishedSnapshot(currentMerchantSiteId, merchantEmail);
            }
            const identityNotice = getMerchantIdentityNotice(resolvedMerchantIds);
            if (identityNotice) {
              setHasEditorContent(true);
              releaseCheckingScreen({ notice: identityNotice });
              return;
          }
        } else {
          merchantIdsRef.current = [];
        }
        setHasEditorContent(true);
        releaseCheckingScreen({ notice: null });
        if (isMobileMerchantSupportOnlyMode) {
          setRemoteContentVerified(false);
          return;
        }
        if (!isPlatformEditor) {
          const remoteDraft = await loadMerchantDraftSnapshotViaApi(resolvedMerchantIds);
          if (!mounted) return;
          const remoteDraftScopes = getRemoteDraftSyncScopes(resolvedMerchantIds);
          if (remoteDraft) {
            markRemoteContentVerified(remoteDraftScopes, remoteDraft.updatedAt);
          }
          if (remoteDraft && shouldApplyRemoteDraft(remoteDraft, remoteDraftScopes)) {
            applyPersistedBlocksToEditorRef.current(remoteDraft.blocks);
            saveBlocksToStorage(remoteDraft.blocks, storeScope);
            resolvedMerchantIds.forEach((siteId) => {
              if ((siteId ?? "").trim()) {
                saveBlocksToStorage(remoteDraft.blocks, buildSiteStoreScope(siteId));
              }
            });
            markRemoteDraftApplied(remoteDraft.updatedAt, remoteDraftScopes);
            releaseCheckingScreen({ notice: null });
            return;
          }
          const publishedSnapshot = await loadPublishedSiteSnapshotForMerchantIds(resolvedMerchantIds);
          if (!mounted) return;
          if (publishedSnapshot) {
            const verificationScopes = getRemoteVerificationScopes([publishedSnapshot.siteId, ...resolvedMerchantIds]);
            markRemoteContentVerified(verificationScopes);
            applyPublishedSiteSnapshotToScopedMerchantSite(
              publishedSnapshot.siteId,
              publishedSnapshot,
              session?.user?.email ??
                (typeof cookieBackedMerchantIdentity?.email === "string" ? cookieBackedMerchantIdentity.email : null),
            );
            applyPersistedBlocksToEditorRef.current(publishedSnapshot.blocks);
            const desktopLoaded = viewportStatesRef.current.desktop.planConfig;
            const mobileLoaded = viewportStatesRef.current.mobile.planConfig;
            const combinedLoaded = buildCombinedPersistedBlocks(desktopLoaded, mobileLoaded);
            savePublishedBlocksToStorage(combinedLoaded, storeScope);
            verificationScopes.forEach((scope) => {
              if (scope !== storeScope) {
                savePublishedBlocksToStorage(combinedLoaded, scope);
              }
            });
            releaseCheckingScreen({ notice: null });
            return;
          }
        }
        const accessToken = session?.access_token ?? null;
        const restLoaded = await withTimeout(
          isPlatformEditor
            ? (async () => {
                const fromApi = await loadPlatformBlocksViaApiFallback();
                if (fromApi && fromApi.length > 0) return fromApi;
                return loadPlatformBlocksViaRestFallback(accessToken);
              })()
            : loadBlocksViaRestFallback(resolvedMerchantIds, accessToken),
          ADMIN_PAGE_LOAD_TIMEOUT_MS,
          "页面内加载超时，已使用本地缓存继续编辑",
        );
        if (!mounted) return;
        if (restLoaded && Array.isArray(restLoaded) && restLoaded.length > 0) {
          setHasEditorContent(true);
          markRemoteContentVerified(getRemoteVerificationScopes(resolvedMerchantIds));
          applyPersistedBlocksToEditorRef.current(restLoaded);
          const desktopLoaded = viewportStatesRef.current.desktop.planConfig;
          const mobileLoaded = viewportStatesRef.current.mobile.planConfig;
          const combinedLoaded = buildCombinedPersistedBlocks(desktopLoaded, mobileLoaded);
          savePublishedBlocksToStorage(combinedLoaded, storeScope);
          if (!isPlatformEditor) {
            resolvedMerchantIds.forEach((siteId) => {
              if ((siteId ?? "").trim()) savePublishedBlocksToStorage(combinedLoaded, buildSiteStoreScope(siteId));
            });
          }
          releaseCheckingScreen({ notice: null });
          return;
        }
        const loaded = await withTimeout(
          isPlatformEditor ? loadPlatformBlocksFromSupabaseFallback() : loadBlocksFromSupabaseFallback(resolvedMerchantIds),
          ADMIN_PAGE_LOAD_TIMEOUT_MS,
          "页面内加载超时，已使用本地缓存继续编辑",
        );
        if (!mounted) return;
        if (loaded && Array.isArray(loaded) && loaded.length > 0) {
          setHasEditorContent(true);
          markRemoteContentVerified(getRemoteVerificationScopes(resolvedMerchantIds));
          applyPersistedBlocksToEditorRef.current(loaded);
          const desktopLoaded = viewportStatesRef.current.desktop.planConfig;
          const mobileLoaded = viewportStatesRef.current.mobile.planConfig;
          const combinedLoaded = buildCombinedPersistedBlocks(desktopLoaded, mobileLoaded);
          savePublishedBlocksToStorage(combinedLoaded, storeScope);
          if (!isPlatformEditor) {
            resolvedMerchantIds.forEach((siteId) => {
              if ((siteId ?? "").trim()) savePublishedBlocksToStorage(combinedLoaded, buildSiteStoreScope(siteId));
            });
          }
          releaseCheckingScreen({ notice: null });
          return;
        }
        setHasEditorContent(true);
        setRemoteContentVerified(gatewayReady || resolveCachedRemoteVerification(getRemoteVerificationScopes(resolvedMerchantIds)));
        releaseCheckingScreen({
          notice: gatewayReady
            ? null
            : (isPlatformEditor
                ? "远端连接不稳定，当前仅展示本地缓存。超级后台发布将走服务端通道。"
                : "当前内容加载不完整，请刷新页面或重新登录后重试。"),
        });
      } catch (error) {
        if (!mounted) return;
        clearTimeout(safetyTimeoutId);
        const message = error instanceof Error ? error.message : "";
        if (message.includes("超时")) {
          applyCachedEditorBlocks();
          setHasEditorContent(true);
          setRemoteContentVerified(resolveCachedRemoteVerification());
          releaseCheckingScreen({
            notice: isPlatformEditor
              ? "远端加载超时，当前仅展示本地缓存。超级后台发布将走服务端通道。"
              : "当前内容加载超时，请刷新页面或重新登录后重试。",
          });
          return;
        }
        applyCachedEditorBlocks();
        setHasEditorContent(true);
        setRemoteContentVerified(resolveCachedRemoteVerification());
        releaseCheckingScreen({
          notice: isPlatformEditor ? BACKEND_UNAVAILABLE_NOTICE : "当前内容加载失败，请重新登录后重试。",
        });
      }
    })();

    return () => {
      mounted = false;
      clearTimeout(safetyTimeoutId);
      if (authSubscription) authSubscription.unsubscribe();
      if (detachKeepAlive) detachKeepAlive();
      merchantIdsRef.current = [];
    };
  }, [
    defaultEditorBlocks,
    explicitFaollaSectionEntry,
    isMobileMerchantSupportOnlyMode,
    isPlatformEditor,
    justSignedIn,
    platformSeedBlocks,
    readFreshMerchantSessionIdentity,
    setMerchantDesktopSection,
    storeScope,
  ]);

  function updateBlockProps(blockId: string, patch: Partial<Block["props"]>) {
    const currentBlocks = blocksRef.current;
    const block = currentBlocks.find((item) => item.id === blockId);
    if (!block) return;
    const nextPatch = {
      ...(pendingBlockPatchesRef.current[blockId] ?? {}),
      ...patch,
    } as Partial<Block["props"]>;
    let hasPatchChange = false;
    for (const [key, value] of Object.entries(nextPatch)) {
      if ((block.props as Record<string, unknown>)[key] !== value) {
        hasPatchChange = true;
        break;
      }
    }
    if (!hasPatchChange) return;
    pendingBlockPatchesRef.current[blockId] = nextPatch;
    schedulePendingBlockPatchFlush();
  }

  function applyNavSettingsToOtherPages(blockId: string) {
    if (editingPages.length <= 1) {
      showTip("当前只有一个页面，无需导航栏对齐");
      return;
    }
    const currentBlocks = blocksRef.current;
    const target = currentBlocks.find((item) => item.id === blockId);
    if (!target || target.type !== "nav") return;
    const canonicalNav = cloneBlocks([target])[0];
    const buildViewportBlocksWithCanonicalNav = (sourceBlocks: Block[]) => {
      const pageBackgroundPatch = getPageBackgroundPatch(sourceBlocks[0]);
      const base = stripNavBlocks(sourceBlocks);
      const rebuiltBlocks = [cloneBlocks([canonicalNav])[0], ...base];
      if (rebuiltBlocks[0]) {
        rebuiltBlocks[0] = {
          ...rebuiltBlocks[0],
          props: { ...rebuiltBlocks[0].props, ...pageBackgroundPatch } as never,
        } as Block;
      }
      return rebuiltBlocks;
    };
    const syncViewportState = (state: ViewportEditorState): ViewportEditorState => {
      const planIndex = state.planConfig.plans.findIndex((plan) => plan.id === state.editingPlanId);
      const safePlanIndex = planIndex >= 0 ? planIndex : 0;
      const sourcePlan = state.planConfig.plans[safePlanIndex] ?? null;
      if (!sourcePlan) return state;
      const sourcePages = sourcePlan.pages.length > 0 ? sourcePlan.pages : [{ id: state.editingPageId, name: "页面1", blocks: state.blocks }];
      const syncedPages = sourcePages.map((page) => ({
        ...page,
        blocks: buildViewportBlocksWithCanonicalNav(page.blocks),
      }));
      const nextActivePageId =
        syncedPages.find((page) => page.id === state.editingPageId)?.id ??
        syncedPages.find((page) => page.id === sourcePlan.activePageId)?.id ??
        syncedPages[0]?.id ??
        state.editingPageId;
      const activePage = syncedPages.find((page) => page.id === nextActivePageId) ?? syncedPages[0];
      const syncedPlan = {
        ...sourcePlan,
        pages: syncedPages,
        activePageId: nextActivePageId,
        blocks: cloneBlocks(activePage?.blocks ?? sourcePlan.blocks),
      };
      const syncedPlanConfig = {
        ...state.planConfig,
        plans: state.planConfig.plans.map((plan, idx) => (idx === safePlanIndex ? syncedPlan : plan)),
      };
      const nextBlocks = cloneBlocks(activePage?.blocks ?? state.blocks);
      const nextSelectedId =
        nextBlocks.some((item) => item.id === state.selectedId)
          ? state.selectedId
          : nextBlocks.some((item) => item.id === blockId)
            ? blockId
            : (nextBlocks[0]?.id ?? "");
      return {
        ...state,
        planConfig: syncedPlanConfig,
        editingPageId: nextActivePageId,
        blocks: nextBlocks,
        selectedId: nextSelectedId,
      };
    };

    pushUndoSnapshot(createSnapshot());
    const targetViewport = previewViewport;
    const nextViewportStates = cloneViewportStates(viewportStatesRef.current);
    nextViewportStates[targetViewport] = syncViewportState(nextViewportStates[targetViewport]);
    viewportStatesRef.current = nextViewportStates;

    const activeState = nextViewportStates[targetViewport];
    planConfigRef.current = clonePlanConfig(activeState.planConfig);
    editingPlanIdRef.current = activeState.editingPlanId;
    editingPageIdRef.current = activeState.editingPageId;
    blocksRef.current = cloneBlocks(activeState.blocks);
    selectedIdRef.current = activeState.selectedId || blockId;
    setPlanConfig(clonePlanConfig(activeState.planConfig));
    setEditingPlanId(activeState.editingPlanId);
    setEditingPageId(activeState.editingPageId);
    setBlocks(cloneBlocks(activeState.blocks));
    setSelectedId(activeState.selectedId || blockId);
    persistDraftForConfigs(activeState.planConfig);
    syncHistoryFlags();
    showTip(targetViewport === "mobile" ? "已将当前页导航设置应用到其他页面（手机）" : "已将当前页导航设置应用到其他页面（PC）");
  }

  function resizeBlockWithoutAffectingOthers(
    blockId: string,
    patch: Partial<Block["props"]>,
    heightDelta: number,
  ) {
    const currentBlocks = blocksRef.current;
    const index = currentBlocks.findIndex((b) => b.id === blockId);
    if (index < 0) return;

    const next = [...currentBlocks];
    next[index] = {
      ...next[index],
      props: { ...next[index].props, ...patch } as never,
    } as Block;

    if (heightDelta !== 0) {
      for (let i = index + 1; i < next.length; i += 1) {
        const rawOffsetY = next[i].props.blockOffsetY;
        const currentOffsetY =
          typeof rawOffsetY === "number" && Number.isFinite(rawOffsetY)
            ? Math.round(rawOffsetY)
            : 0;
        next[i] = {
          ...next[i],
          props: {
            ...next[i].props,
            blockOffsetY: Math.round(currentOffsetY - heightDelta),
          } as never,
        } as Block;
      }
    }

    applyBlocks(next);
  }

  function previewResizeWithoutAffectingOthers(blockId: string, heightDelta: number) {
    if (!heightDelta) {
      setResizePreview((prev) => (prev?.blockId === blockId ? null : prev));
      return;
    }
    setResizePreview({ blockId, heightDelta });
  }

  useEffect(() => {
    blocksRef.current = blocks;
  }, [blocks]);

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  useEffect(() => {
    if (europeLocationOptionsApi) return;
    const selectedBlock = blocks.find((item) => item.id === selectedId);
    if (selectedBlock?.type !== "search-bar") return;

    let active = true;
    if (!europeLocationOptionsApiTaskRef.current) {
      europeLocationOptionsApiTaskRef.current = loadEuropeLocationOptionsApi().finally(() => {
        europeLocationOptionsApiTaskRef.current = null;
      });
    }
    europeLocationOptionsApiTaskRef.current
      .then((api) => {
        if (active) setEuropeLocationOptionsApi(api);
      })
      .catch(() => {});

    return () => {
      active = false;
    };
  }, [blocks, europeLocationOptionsApi, selectedId]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (publishingRef.current) return;
      if (event.defaultPrevented) return;
      if (!selectedIdRef.current) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) return;
      if (isEditorTypingTarget(event.target)) return;
      if (isEditorToolbarInteractionTarget(event.target)) return;
      event.preventDefault();
      const deltaX = event.key === "ArrowLeft" ? -NUDGE_STEP : event.key === "ArrowRight" ? NUDGE_STEP : 0;
      const deltaY = event.key === "ArrowUp" ? -NUDGE_STEP : event.key === "ArrowDown" ? NUDGE_STEP : 0;
      nudgeBlockRef.current(selectedIdRef.current, deltaX, deltaY);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, []);

  useEffect(() => {
    publishingRef.current = publishing;
  }, [publishing]);

  useEffect(() => {
    setRecentColors(loadRecentColors());
  }, []);

  useEffect(() => {
    if (!tip) return;
    showGlobalToast(tip);
    setTip("");
  }, [tip]);

  useEffect(() => {
    planConfigRef.current = planConfig;
  }, [planConfig]);

  useEffect(() => {
    editingPlanIdRef.current = editingPlanId;
  }, [editingPlanId]);

  useEffect(() => {
    editingPageIdRef.current = editingPageId;
  }, [editingPageId]);

  useEffect(() => {
    viewportStatesRef.current[previewViewport] = {
      planConfig: clonePlanConfig(planConfig),
      editingPlanId,
      editingPageId,
      blocks: cloneBlocks(blocks),
      selectedId,
    };
  }, [blocks, editingPageId, editingPlanId, planConfig, previewViewport, selectedId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const media = window.matchMedia("(min-width: 1024px)");
    const coarseMobileMedia = window.matchMedia("(pointer: coarse) and (max-width: 1024px)");
    const updateLayoutMode = () => setIsDesktopEditorSidebar(shouldUseMerchantDesktopSidebarViewport());
    updateLayoutMode();
    media.addEventListener("change", updateLayoutMode);
    coarseMobileMedia.addEventListener("change", updateLayoutMode);
    window.addEventListener("resize", updateLayoutMode);
    window.addEventListener("orientationchange", updateLayoutMode);
    return () => {
      media.removeEventListener("change", updateLayoutMode);
      coarseMobileMedia.removeEventListener("change", updateLayoutMode);
      window.removeEventListener("resize", updateLayoutMode);
      window.removeEventListener("orientationchange", updateLayoutMode);
    };
  }, []);

  useEffect(() => {
    if (checkingAuth) return;
    const topBarNode = topBarRef.current;
    if (!topBarNode) return;
    const updateTopBarHeight = () => {
      const nextHeight = (isPlatformEditor || isDesktopEditorSidebar) ? 0 : Math.ceil(topBarNode.getBoundingClientRect().height);
      setTopBarHeight((prev) => (prev === nextHeight ? prev : nextHeight));
    };
    updateTopBarHeight();
    const rafId = window.requestAnimationFrame(updateTopBarHeight);
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(updateTopBarHeight) : null;
    if (observer) observer.observe(topBarNode);
    window.addEventListener("resize", updateTopBarHeight);
    return () => {
      window.cancelAnimationFrame(rafId);
      if (observer) observer.disconnect();
      window.removeEventListener("resize", updateTopBarHeight);
    };
  }, [checkingAuth, isDesktopEditorSidebar, isPlatformEditor, previewViewport, topBarCollapsed]);

  useEffect(() => {
    const measureBackgroundHeight = () => {
      const layer = backgroundLayerRef.current;
      if (!layer) return;
      const layerRect = layer.getBoundingClientRect();
      const viewportMinHeight = Math.max(0, Math.ceil(window.innerHeight - layerRect.top));
      const measuredNodes = layer.querySelectorAll<HTMLElement>("[data-block-id], [data-block-id] *");
      let visualBottom = 0;
      measuredNodes.forEach((node) => {
        const rect = node.getBoundingClientRect();
        if (rect.width <= 0 && rect.height <= 0) return;
        visualBottom = Math.max(visualBottom, rect.bottom - layerRect.top);
      });
      const nextMinHeight = Math.max(viewportMinHeight, Math.ceil(visualBottom + 160));
      setBackgroundLayerMinHeight((prev) => (prev === nextMinHeight ? prev : nextMinHeight));
    };

    const rafId = window.requestAnimationFrame(measureBackgroundHeight);
    window.addEventListener("resize", measureBackgroundHeight);
    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener("resize", measureBackgroundHeight);
    };
  }, [blocks, resizePreview, selectedId, draggingBlockId]);

function getPageBackgroundPatch(source: Block | undefined): PageBackgroundPatch {
    return {
      pageBgImageUrl: source?.props.pageBgImageUrl ?? "",
      pageBgFillMode: source?.props.pageBgFillMode ?? "cover",
      pageBgPosition: source?.props.pageBgPosition ?? "center",
      pageBgColor: source?.props.pageBgColor ?? "",
      pageBgOpacity: source?.props.pageBgOpacity ?? 1,
      pageBgImageOpacity: source?.props.pageBgImageOpacity ?? source?.props.pageBgOpacity ?? 1,
      pageBgColorOpacity: source?.props.pageBgColorOpacity ?? source?.props.pageBgOpacity ?? 1,
    };
  }

  function stripPageBackgroundPropsFromBlock(block: Block) {
    const cloned = cloneBlocks([block])[0];
    const nextProps = { ...cloned.props } as Record<string, unknown>;
    PAGE_BACKGROUND_PROP_KEYS.forEach((key) => {
      delete nextProps[key];
    });
    return {
      ...cloned,
      props: nextProps as never,
    } as Block;
  }

  function buildPageCopySelectionDefaults(sourceBlocks: Block[]): PageCopySelectionState {
    const next: PageCopySelectionState = {
      [PAGE_COPY_BACKGROUND_ITEM_ID]: false,
      [PAGE_COPY_THEME_ITEM_ID]: false,
    };
    sourceBlocks.forEach((block) => {
      next[buildPageCopyItemIdForBlock(block.id)] = false;
    });
    return next;
  }

  function createCopiedBlock(block: Block, options?: { keepId?: string }) {
    const cloned = stripPageBackgroundPropsFromBlock(block);
    return {
      ...cloned,
      id: options?.keepId || `${cloned.type}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    } as Block;
  }

  function buildThemeCopyTemplate(sourceBlocks: Block[]) {
    const genericSource =
      sourceBlocks.find((block) => {
        const props = block.props as Record<string, unknown>;
        return GENERIC_THEME_COPY_KEYS.some((key) => typeof props[key] !== "undefined");
      }) ??
      sourceBlocks.find((block) => block.type !== "nav") ??
      sourceBlocks[0] ??
      null;
    const genericPatch = genericSource
      ? pickDefinedProps(genericSource.props as Record<string, unknown>, GENERIC_THEME_COPY_KEYS)
      : {};
    const perTypePatch = new Map<Block["type"], Record<string, unknown>>();
    sourceBlocks.forEach((block) => {
      if (perTypePatch.has(block.type)) return;
      perTypePatch.set(block.type, {
        ...pickDefinedProps(block.props as Record<string, unknown>, GENERIC_THEME_COPY_KEYS),
        ...pickDefinedProps(block.props as Record<string, unknown>, getThemeCopyKeysForBlockType(block.type)),
      });
    });
    return {
      genericPatch,
      perTypePatch,
    };
  }

  function applyThemeCopyFromSourceBlocks(sourceBlocks: Block[], targetBlocks: Block[]) {
    const template = buildThemeCopyTemplate(sourceBlocks);
    const hasGenericPatch = Object.keys(template.genericPatch).length > 0;
    const hasPerTypePatch = [...template.perTypePatch.values()].some((patch) => Object.keys(patch).length > 0);
    if (!hasGenericPatch && !hasPerTypePatch) {
      return cloneBlocks(targetBlocks);
    }
    return targetBlocks.map((block) => {
      const patch = {
        ...template.genericPatch,
        ...(template.perTypePatch.get(block.type) ?? {}),
      };
      if (Object.keys(patch).length === 0) return block;
      return {
        ...block,
        props: {
          ...block.props,
          ...patch,
        } as never,
      } as Block;
    });
  }

  function buildPageCopyBlockEntries(sourceBlocks: Block[]): PageCopyBlockEntry[] {
    const typeCounts = new Map<Block["type"], number>();
    return sourceBlocks.map((block, index) => {
      const currentOccurrence = typeCounts.get(block.type) ?? 0;
      typeCounts.set(block.type, currentOccurrence + 1);
      return {
        block,
        index,
        occurrenceIndex: currentOccurrence,
      };
    });
  }

  function findBlockIndexByTypeOccurrence(targetBlocks: Block[], type: Block["type"], occurrenceIndex: number) {
    let currentOccurrence = 0;
    for (let index = 0; index < targetBlocks.length; index += 1) {
      if (targetBlocks[index]?.type !== type) continue;
      if (currentOccurrence === occurrenceIndex) return index;
      currentOccurrence += 1;
    }
    return -1;
  }

  function copySelectedBlocksToPage(sourceBlocks: Block[], selectedBlockIds: string[], targetBlocks: Block[]) {
    if (selectedBlockIds.length === 0) return cloneBlocks(targetBlocks);
    const selectedBlockIdSet = new Set(selectedBlockIds);
    const selectedEntries = buildPageCopyBlockEntries(sourceBlocks).filter((entry) => selectedBlockIdSet.has(entry.block.id));
    const nextBlocks = cloneBlocks(targetBlocks);
    selectedEntries.forEach((entry) => {
      const targetIndex = findBlockIndexByTypeOccurrence(nextBlocks, entry.block.type, entry.occurrenceIndex);
      if (targetIndex >= 0) {
        const existingTargetBlock = nextBlocks[targetIndex];
        const preservedPageBackground = targetIndex === 0 ? getPageBackgroundPatch(existingTargetBlock) : null;
        const copiedBlock = createCopiedBlock(entry.block, { keepId: existingTargetBlock.id });
        nextBlocks[targetIndex] = {
          ...copiedBlock,
          props: {
            ...copiedBlock.props,
            ...(preservedPageBackground ?? {}),
          } as never,
        } as Block;
        return;
      }
      nextBlocks.push(createCopiedBlock(entry.block));
    });
    return normalizeBlockLayers(nextBlocks);
  }

  function updatePageBackground(patch: Partial<PageBackgroundPatch>) {
    if (blocks.length === 0) return;
    flushPendingEditorChanges();

    const next = [...blocks];
    next[0] = {
      ...next[0],
      props: { ...next[0].props, ...patch } as never,
    } as Block;

    applyBlocks(next);
  }

  function startDraggingBlock(blockId: string, point: { x: number; y: number }) {
    flushPendingEditorChanges();
    const block = blocksRef.current.find((b) => b.id === blockId);
    if (!block || isBlockLocked(block)) return;
    const blockIds = [blockId];
    const startOffsets: Record<string, { x: number; y: number }> = {};
    blockIds.forEach((id) => {
      const item = blocksRef.current.find((candidate) => candidate.id === id);
      const startOffsetX =
        item && typeof item.props.blockOffsetX === "number" && Number.isFinite(item.props.blockOffsetX)
          ? Math.round(item.props.blockOffsetX)
          : 0;
      const startOffsetY =
        item && typeof item.props.blockOffsetY === "number" && Number.isFinite(item.props.blockOffsetY)
          ? Math.round(item.props.blockOffsetY)
          : 0;
      startOffsets[id] = {
        x: item?.props.mobileFitScreenWidth === true ? 0 : startOffsetX,
        y: startOffsetY,
      };
    });

    setSelectedId(blockId);
    dragStartRef.current = {
      blockId,
      blockIds,
      pointerX: point.x,
      pointerY: point.y,
      startOffsets,
      historyRecorded: false,
    };
    setDraggingBlockId(blockId);
  }

  function clampBlockOffsetToViewport(
    blockId: string,
    currentOffsetX: number,
    currentOffsetY: number,
    nextOffsetX: number,
    nextOffsetY: number,
    options?: { allowDragDownOverflow?: boolean },
  ) {
    const blockRoot =
      Array.from(document.querySelectorAll<HTMLElement>(`[data-block-id="${blockId}"]`))
        .reverse()
        .find((candidate) => candidate.querySelector("[data-editor-toolbar]")) ??
      document.querySelector<HTMLElement>(`[data-block-id="${blockId}"]`);
    const element = blockRoot?.querySelector<HTMLElement>("[data-block-visual-boundary]") ?? blockRoot;
    if (!element) {
      return {
        x: nextOffsetX,
        y: nextOffsetY,
      };
    }

    const rect = element.getBoundingClientRect();
    const viewportBoundary = blockRoot?.closest<HTMLElement>("[data-editor-viewport-boundary]");
    const viewportRect = viewportBoundary?.getBoundingClientRect();
    const desiredDeltaX = nextOffsetX - currentOffsetX;
    const desiredDeltaY = nextOffsetY - currentOffsetY;
    const minDeltaX = viewportRect ? viewportRect.left - rect.left : -rect.left;
    const maxDeltaX = viewportRect ? viewportRect.right - rect.right : window.innerWidth - rect.right;
    const minDeltaY = viewportRect ? viewportRect.top - rect.top : -rect.top;
    const maxDeltaY = options?.allowDragDownOverflow
      ? Number.POSITIVE_INFINITY
      : viewportRect
        ? viewportRect.bottom - rect.bottom
        : window.innerHeight - rect.bottom;
    const clampedDeltaX =
      minDeltaX > maxDeltaX ? 0 : Math.min(Math.max(desiredDeltaX, minDeltaX), maxDeltaX);
    const clampedDeltaY =
      minDeltaY > maxDeltaY ? 0 : Math.min(Math.max(desiredDeltaY, minDeltaY), maxDeltaY);

    return {
      x: Math.round(currentOffsetX + clampedDeltaX),
      y: Math.round(currentOffsetY + clampedDeltaY),
    };
  }

  function nudgeBlock(blockId: string, deltaX: number, deltaY: number) {
    if (!deltaX && !deltaY) return;
    const targetBlock = blocksRef.current.find((item) => item.id === blockId);
    if (!targetBlock || isBlockLocked(targetBlock)) return;
    const horizontalDelta = targetBlock.props.mobileFitScreenWidth === true ? 0 : deltaX;
    if (!horizontalDelta && !deltaY) return;
    const currentPending = pendingBlockNudgesRef.current[blockId];
    pendingBlockNudgesRef.current[blockId] = {
      deltaX: (currentPending?.deltaX ?? 0) + horizontalDelta,
      deltaY: (currentPending?.deltaY ?? 0) + deltaY,
    };
    schedulePendingBlockNudgeFlush();
  }
  nudgeBlockRef.current = nudgeBlock;

  function handleEditorMouseDownCapture(event: ReactMouseEvent<HTMLElement>) {
    const target = event.target as HTMLElement | null;
    if (!target) return;
    if (
      target.isContentEditable ||
      target.closest('[contenteditable="true"]') ||
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement
    ) {
      return;
    }
    if (target.closest("[data-editor-toolbar]")) return;
    if (target.closest("[data-editor-overlay]")) return;
    if (target.closest("[data-block-id]")) return;
    if (selectedIdRef.current) {
      setSelectedId("");
    }
  }

  function getBlockLayer(block: Block) {
    return typeof block.props.blockLayer === "number" && Number.isFinite(block.props.blockLayer)
      ? Math.max(1, Math.round(block.props.blockLayer))
      : 1;
  }

  function normalizeBlockLayers(input: Block[]) {
    const ranked = input
      .map((block, index) => ({ block, index, layer: getBlockLayer(block) }))
      .sort((a, b) => (a.layer === b.layer ? a.index - b.index : a.layer - b.layer));
    const assigned = new Map<string, number>();
    ranked.forEach((item, idx) => {
      assigned.set(item.block.id, idx + 1);
    });

    return input.map((block) => ({
      ...block,
      props: {
        ...block.props,
        blockLayer: assigned.get(block.id) ?? 1,
      } as never,
    })) as Block[];
  }

  function moveBlockToLayerEdge(blockId: string, edge: "front" | "back") {
    const index = blocks.findIndex((b) => b.id === blockId);
    if (index < 0) return;
    const current = blocks[index];
    const layers = blocks.map(getBlockLayer);
    const targetLayer = edge === "front" ? Math.max(...layers) + 1 : Math.min(...layers) - 1;
    if (getBlockLayer(current) === targetLayer) return;
    const next = [...blocks];
    next[index] = {
      ...current,
      props: { ...current.props, blockLayer: targetLayer } as never,
    } as Block;
    applyBlocks(normalizeBlockLayers(next));
  }

  function moveBlockLayerByOne(blockId: string, direction: "up" | "down") {
    const index = blocks.findIndex((b) => b.id === blockId);
    if (index < 0) return;
    const current = blocks[index];
    const currentLayer = getBlockLayer(current);
    const otherLayers = blocks
      .filter((b) => b.id !== blockId)
      .map(getBlockLayer)
      .sort((a, b) => a - b);
    const targetLayer =
      direction === "up"
        ? otherLayers.find((layer) => layer > currentLayer)
        : [...otherLayers].reverse().find((layer) => layer < currentLayer);
    if (typeof targetLayer !== "number") return;

    const swapIndex = blocks.findIndex((b) => b.id !== blockId && getBlockLayer(b) === targetLayer);
    const next = [...blocks];
    next[index] = {
      ...current,
      props: { ...current.props, blockLayer: targetLayer } as never,
    } as Block;
    if (swapIndex >= 0) {
      const swap = blocks[swapIndex];
      next[swapIndex] = {
        ...swap,
        props: { ...swap.props, blockLayer: currentLayer } as never,
      } as Block;
    }
    applyBlocks(normalizeBlockLayers(next));
  }

  useEffect(() => {
    if (!draggingBlockId) return;

    const flushPendingDragMove = () => {
      dragMoveRafRef.current = null;
      const pendingPointer = dragPendingPointerRef.current;
      const start = dragStartRef.current;
      if (!pendingPointer || !start || start.blockId !== draggingBlockId) return;
      dragPendingPointerRef.current = null;
      const deltaX = pendingPointer.x - start.pointerX;
      const deltaY = pendingPointer.y - start.pointerY;
      if (!start.historyRecorded && (deltaX !== 0 || deltaY !== 0)) {
        recordDragHistoryRef.current();
        start.historyRecorded = true;
      }
      setBlocks((prev) => {
        const next = [...prev];
        start.blockIds.forEach((id) => {
          const index = next.findIndex((b) => b.id === id);
          if (index < 0) return;
          const origin = start.startOffsets[id];
          if (!origin) return;
          const current = next[index];
          const currentOffsetX =
            typeof current.props.blockOffsetX === "number" && Number.isFinite(current.props.blockOffsetX)
              ? Math.round(current.props.blockOffsetX)
              : 0;
          const currentOffsetY =
            typeof current.props.blockOffsetY === "number" && Number.isFinite(current.props.blockOffsetY)
              ? Math.round(current.props.blockOffsetY)
              : 0;
          const currentBaseX = current.props.mobileFitScreenWidth === true ? 0 : currentOffsetX;
          const clampedOffset = clampBlockOffsetToViewport(
            id,
            currentBaseX,
            currentOffsetY,
            current.props.mobileFitScreenWidth === true ? currentBaseX : Math.round(origin.x + deltaX),
            Math.round(origin.y + deltaY),
            { allowDragDownOverflow: true },
          );
          next[index] = {
            ...current,
            props: {
              ...current.props,
              blockOffsetX: current.props.mobileFitScreenWidth === true ? 0 : clampedOffset.x,
              blockOffsetY: clampedOffset.y,
            } as never,
          } as Block;
        });
        return next;
      });
    };

    const scheduleDragMoveFlush = () => {
      if (dragMoveRafRef.current !== null) return;
      dragMoveRafRef.current = window.requestAnimationFrame(flushPendingDragMove);
    };

    const clearPendingDragMove = () => {
      if (dragMoveRafRef.current !== null) {
        window.cancelAnimationFrame(dragMoveRafRef.current);
        dragMoveRafRef.current = null;
      }
      dragPendingPointerRef.current = null;
    };

    const onPointerMove = (event: MouseEvent) => {
      const start = dragStartRef.current;
      if (!start || start.blockId !== draggingBlockId) return;
      dragPendingPointerRef.current = { x: event.clientX, y: event.clientY };
      scheduleDragMoveFlush();
    };

    const finishDragging = () => {
      flushPendingDragMove();
      clearPendingDragMove();
      dragStartRef.current = null;
      setDraggingBlockId(null);
      persistDraggingDraftRef.current();
    };

    const onPointerUp = () => finishDragging();
    const onBlur = () => finishDragging();
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", onPointerMove);
    window.addEventListener("mouseup", onPointerUp);
    window.addEventListener("blur", onBlur);

    return () => {
      clearPendingDragMove();
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener("mousemove", onPointerMove);
      window.removeEventListener("mouseup", onPointerUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [draggingBlockId]);

  function makeDefaultBlock(type: Block["type"]): Block {
    const id = `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    if (type === "common") {
      return {
        id,
        type,
        props: { commonTextBoxes: [] },
      };
    }

    if (type === "button") {
      return {
        id,
        type,
        props: {
          blockWidth: 160,
          blockHeight: 56,
          buttonLabel: "",
          buttonJumpTarget: "",
          buttonHoverAnimation: "none",
        },
      };
    }

    if (type === "gallery") {
      return {
        id,
        type,
        props: { heading: "新的画廊区块", images: [], autoplayMs: 3000, galleryFrameHeight: 260, galleryLayoutPreset: "three-wide" },
      };
    }

    if (type === "chart") {
      return {
        id,
        type,
        props: {
          heading: "新的图表区块",
          text: "图表说明文本",
          chartType: "bar",
          labels: ["A", "B", "C"],
          values: [10, 20, 15],
        },
      };
    }

    if (type === "nav") {
      return {
        id,
        type,
        props: {
          heading: "页面导航",
          navOrientation: "horizontal",
          navItems: [
            { id: `nav-item-${Date.now()}-1`, label: "页面1", pageId: "page-1" },
          ],
        },
      };
    }

    if (type === "music") {
      return {
        id,
        type,
        props: {
          heading: "新的音乐区块",
          audioUrl: "",
          musicPlayerStyle: "classic",
        },
      };
    }

    if (type === "hero") {
      return {
        id,
        type,
        props: { title: "新的视觉横幅", subtitle: "在这里编写副标题说明文案" },
      };
    }

    if (type === "text") {
      return {
        id,
        type,
        props: { heading: "新的文本区块", text: "在这里输入文本内容。" },
      };
    }

    if (type === "list") {
      return {
        id,
        type,
        props: { heading: "新的列表区块", items: ["列表1", "列表2"] },
      };
    }

    if (type === "search-bar") {
      return {
        id,
        type,
        props: {
          heading: "搜索",
          text: "城市定位与内容搜索",
          cityPlaceholder: "选择城市",
          searchPlaceholder: "请输入商户名称关键词",
          locateLabel: "定位",
          actionLabel: "搜索",
          defaultCountryCode: "",
          defaultProvinceCode: "",
          defaultCity: "",
          searchLayout: {
            locate: { x: 0, y: 0, width: 72, height: 40 },
            country: { x: 82, y: 0, width: 190, height: 40 },
            province: { x: 282, y: 0, width: 190, height: 40 },
            city: { x: 482, y: 0, width: 190, height: 40 },
            keyword: { x: 0, y: 52, width: 670, height: 40 },
            action: { x: 680, y: 52, width: 72, height: 40 },
          },
        },
      };
    }

    if (type === "merchant-list") {
      return {
        id,
        type,
        props: {
          heading: "商户列表",
          text: "臊展示平台注册商户的前台入口",
          maxItems: 6,
          emptyText: "暂无商户",
          merchantTabButtonBgColor: "#ffffff",
          merchantTabButtonBgOpacity: 1,
          merchantTabButtonBorderStyle: "solid",
          merchantTabButtonBorderColor: "#cbd5e1",
          merchantTabButtonActiveBgColor: "#000000",
          merchantTabButtonActiveBgOpacity: 1,
          merchantTabButtonActiveBorderStyle: "solid",
          merchantTabButtonActiveBorderColor: "#111827",
          merchantPagerButtonBgColor: "#ffffff",
          merchantPagerButtonBgOpacity: 1,
          merchantPagerButtonBorderStyle: "solid",
          merchantPagerButtonBorderColor: "#cbd5e1",
          merchantPagerButtonDisabledBgColor: "#e5e7eb",
          merchantPagerButtonDisabledBgOpacity: 1,
          merchantPagerButtonDisabledBorderStyle: "solid",
          merchantPagerButtonDisabledBorderColor: "#cbd5e1",
          merchantCardBgColor: "#f8fafc",
          merchantCardBgOpacity: 1,
          merchantCardBorderStyle: "solid",
          merchantCardBorderColor: "#cbd5e1",
          merchantCardTypography: {
            name: { fontSize: 16, fontWeight: "bold", fontColor: "#0f172a" },
            industry: { fontSize: 12, fontColor: "#64748b" },
            domain: { fontSize: 12, fontColor: "#64748b" },
          },
          merchantCardTextLayout: {
            name: { x: 0, y: 0 },
            industry: { x: 0, y: 30 },
            domain: { x: 0, y: 52 },
          },
          merchantCardTextBoxVisible: false,
          merchantCardIndustryStyles: {
            all: {
              bgColor: "#f8fafc",
              bgOpacity: 1,
              borderStyle: "solid",
              borderColor: "#cbd5e1",
            },
          },
          industryTabs: createDefaultMerchantIndustryTabs(),
          merchantCardLayout: {
            tabs: { x: 0, y: 0, width: 520, height: 38 },
            prev: { x: 0, y: 256, width: 92, height: 34 },
            next: { x: 104, y: 256, width: 92, height: 34 },
            card1: { x: 0, y: 52, width: 320, height: 190 },
            card2: { x: 334, y: 52, width: 320, height: 190 },
            card3: { x: 668, y: 52, width: 320, height: 190 },
          },
        },
      };
    }

    if (type === "product") {
      return {
        id,
        type,
        props: {
          heading: "产品展示",
          text: "支持产品图片、编号、名称、介绍和价格展示。",
          productSearchEnabled: true,
          productSearchPlaceholder: "搜索产品名称/编号/介绍",
          productLayoutPreset: "list",
          productImageAspectRatio: "square",
          productImageSize: 220,
          productCardHeight: 252,
          productPricePrefix: "€",
          productShowCode: true,
          productShowDescription: true,
          productPriceAlign: "left",
          productTagOptions: ["推荐"],
          productTagPosition: "top",
          productTagBorderStyle: "glass",
          productTagTextAlign: "center",
          productTagFontSize: 12,
          productTagWidth: 92,
          productTagRowGap: 8,
          productTagHideUnselected: true,
          productGroupByTag: false,
          productTagBgColor: "#0f172a",
          productTagBgOpacity: 0.82,
          productTagActiveBgColor: "#1d4ed8",
          productTagActiveBgOpacity: 0.94,
          productItemGap: 16,
          productCartQuantityMode: "stepper",
          productCartButtonPosition: "top",
          productContainerMode: "auto",
          productHideScrollbar: false,
          productItemsPerPage: 3,
          productDetailImageSize: 420,
          productDetailShowCode: true,
          productDetailShowName: true,
          productDetailShowDescription: true,
          productDetailShowPrice: true,
          productDetailFullImage: false,
          productCardBgColor: "#ffffff",
          productCardBgOpacity: 0.9,
          productCardBorderStyle: "solid",
          productCardBorderColor: "#e2e8f0",
          productCodeTypography: {},
          productNameTypography: {},
          productDescriptionTypography: {},
          productPriceTypography: {},
          products: [
            {
              id: createProductItemId(),
              code: "SKU-001",
              name: "示例产品",
              description: "在这里填写产品卖点、规格或简短介绍。",
              price: "39.90",
              tag: "推荐",
              imageUrl: "",
            },
          ],
        },
      };
    }

    if (type === "coupon") {
      return {
        id,
        type,
        props: {
          heading: "优惠券",
          text: "展示当前可领取优惠券，引导客户复制优惠码或下单使用。",
          couponDisplayMode: "cards",
          couponActionMode: "copy",
          couponShowRemaining: true,
          couponShowExpiresAt: true,
          couponSelectedIds: [],
          couponEmptyText: "暂无可领取优惠券",
        },
      };
    }

    if (type === "google-reviews") {
      return {
        id,
        type,
        props: {
          heading: "Google 评论",
          text: "展示客户在 Google 上留下的真实评价。",
          googleReviewItems: [],
          googleReviewAverageRating: 0,
          googleReviewTotalCount: 0,
          googleReviewUrl: "",
          googleReviewWriteUrl: "",
          googleReviewSourceLabel: "Google",
          googleReviewDisplayMode: "cards",
          googleReviewMaxItems: 6,
          googleReviewShowAuthorPhoto: true,
          googleReviewShowDates: true,
          googleReviewShowReplies: true,
          googleReviewEmptyText: "暂无可展示的 Google 评论",
          googleReviewAutoSync: false,
          googleReviewAccountName: "",
          googleReviewLocationName: "",
          googleReviewLocationTitle: "",
        },
      };
    }

    if (type === "booking") {
      return {
        id,
        type,
        props: {
          heading: "在线预约",
          text: "客户可选择店铺、项目、日期时间并填写预约信息。",
          bookingStoreLabel: "预约店铺",
          bookingItemLabel: "项目或类型",
          bookingStoreOptions: buildDefaultBookingStoreOptions(
            editingSite?.merchantName ?? editingSite?.name ?? merchantDisplayName,
          ),
          bookingItemOptions: buildDefaultBookingItemOptions(),
          bookingAvailableTimeRanges: [],
          bookingTimeSlotRules: [],
          bookingBlockedDates: [],
          bookingHolidayDates: [],
          bookingTitleOptions: buildDefaultBookingTitleOptions(),
          bookingSubmitLabel: "提交预约",
          bookingUpdateLabel: "修改预约",
          bookingCancelLabel: "取消预约",
          bookingSuccessTitle: "预约提交成功",
          bookingSuccessText: "我们已收到您的预约，可在此继续修改或取消。",
          bookingNamePlaceholder: "请输入称谓或姓名",
          bookingNotePlaceholder: "可填写备注或需求",
        },
      };
    }

    if (type === "poll") {
      return {
        id,
        type,
        props: {
          heading: "在线投票",
          text: "请选择选项并提交您的意见。",
          pollId: createPollEntityId("poll"),
          pollStatus: "open",
          pollQuestions: createDefaultPollQuestions(),
          pollAllowAnonymous: true,
          pollShowResultsAfterSubmit: false,
          pollSubmitLabel: "提交投票",
          pollSuccessTitle: "投票已提交",
          pollSuccessText: "感谢您的参与。",
          pollNameLabel: "您的名称",
          pollNamePlaceholder: "请输入您的名称",
          pollContentBackgroundOpacity: 0.72,
        },
      };
    }

    return {
      id,
      type,
      props: {
        heading: "联系方式",
        phone: "",
        phones: [],
        address: "",
        addresses: [],
        mapZoom: 5,
        mapType: "roadmap",
        mapShowMarker: true,
        email: "",
        whatsapp: "",
        wechat: "",
        twitter: "",
        weibo: "",
        telegram: "",
        linkedin: "",
        discord: "",
        tiktok: "",
        xiaohongshu: "",
        facebook: "",
        instagram: "",
        contactLayout: {},
      },
    };
  }

  function addBlock() {
    if (!isPlatformEditor && newBlockType === "button" && !canUseButtonBlock) {
      showTip("当前权限未开通按钮区块");
      return;
    }
    if (!isPlatformEditor && newBlockType === "gallery" && !canUseGalleryBlock) {
      showTip("当前权限未开通相册区块");
      return;
    }
    if (!isPlatformEditor && newBlockType === "music" && !canUseMusicBlock) {
      showTip("当前权限未开通音乐区块");
      return;
    }
    if (!isPlatformEditor && newBlockType === "product" && !canUseProductBlock) {
      showTip("当前权限未开通产品区块");
      return;
    }
    if (!isPlatformEditor && newBlockType === "coupon" && !canUseCouponBlock) {
      showTip("当前权限未开通优惠券区块");
      return;
    }
    if (!isPlatformEditor && newBlockType === "booking" && !canUseBookingBlock) {
      showTip("当前权限未开通预约区块");
      return;
    }
    if (newBlockType === "nav") {
      const mergedConfig = mergePlanConfigWithEditingBlocks(
        planConfigRef.current,
        editingPlanIdRef.current,
        editingPageIdRef.current,
        blocksRef.current,
        { syncNavPages: false },
      );
      const currentPlan = mergedConfig.plans.find((plan) => plan.id === editingPlanIdRef.current) ?? mergedConfig.plans[0];
      const exists = currentPlan?.pages?.some((page) => hasNavBlock(page.blocks));
      if (exists) {
        setTip("导航区块只能有一个");
        setTimeout(() => setTip(""), 1200);
        return;
      }
    }
    if (newBlockType === "booking") {
      const mergedConfig = mergePlanConfigWithEditingBlocks(
        planConfigRef.current,
        editingPlanIdRef.current,
        editingPageIdRef.current,
        blocksRef.current,
        { syncNavPages: false },
      );
      if (countBookingBlocksInSinglePlanConfig(mergedConfig, editingPlanIdRef.current) > 0) {
        setTip("预约区块只能有一个");
        setTimeout(() => setTip(""), 1200);
        return;
      }
    }
    const nextBlock = makeDefaultBlock(newBlockType);
    const next = [...blocks, nextBlock];
    applyBlocks(next, { selectedId: nextBlock.id });
    setTip("已新增区块");
    setTimeout(() => setTip(""), 1200);
  }

  function switchEditingPlan(planId: PlanId) {
    if (planId === editingPlanIdRef.current) return;
    flushPendingEditorChanges();
    const mergedConfig = mergePlanConfigWithEditingBlocks(
      planConfigRef.current,
      editingPlanIdRef.current,
      editingPageIdRef.current,
      blocksRef.current,
      { syncNavPages: false },
    );
    const targetPlanIndex = mergedConfig.plans.findIndex((plan) => plan.id === planId);
    if (!isPlatformEditor && targetPlanIndex >= merchantPlanLimit) {
      showTip(`当前权限仅允许使用前 ${merchantPlanLimit} 个方案`);
      return;
    }
    const targetPlan = mergedConfig.plans.find((plan) => plan.id === planId) ?? mergedConfig.plans[0];
    const targetPageId = targetPlan?.activePageId ?? "page-1";
    const targetBlocks = cloneBlocks(getBlocksForPage(targetPlan, targetPageId));
    const nextConfig = clonePlanConfig(mergedConfig);
    pushUndoSnapshot(createSnapshot());
    setPlanConfig(nextConfig);
    setEditingPlanId(planId);
    setEditingPageId(targetPageId);
    setBlocks(targetBlocks);
    setSelectedId(targetBlocks[0]?.id ?? "");
    persistDraftForConfigs(nextConfig);
  }

  function switchEditingPage(pageId: string) {
    if (pageId === editingPageIdRef.current) return;
    flushPendingEditorChanges();
    const mergedConfig = mergePlanConfigWithEditingBlocks(
      planConfigRef.current,
      editingPlanIdRef.current,
      editingPageIdRef.current,
      blocksRef.current,
      { syncNavPages: false },
    );
    const currentPlan = mergedConfig.plans.find((plan) => plan.id === editingPlanIdRef.current) ?? mergedConfig.plans[0];
    const canonicalNav =
      currentPlan.pages.map((page) => getFirstNavBlock(page.blocks)).find((item) => !!item) ??
      getFirstNavBlock(currentPlan.blocks) ??
      null;
    const rawTargetBlocks = cloneBlocks(getBlocksForPage(currentPlan, pageId));
    const targetBlocks =
      canonicalNav && !hasNavBlock(rawTargetBlocks)
        ? [cloneBlocks([canonicalNav])[0], ...stripNavBlocks(rawTargetBlocks)]
        : rawTargetBlocks;
    const patchedPlan =
      canonicalNav && !hasNavBlock(rawTargetBlocks)
        ? setBlocksForPage({ ...currentPlan, activePageId: pageId }, pageId, targetBlocks)
        : { ...currentPlan, activePageId: pageId };
    const nextConfig: PagePlanConfig = {
      ...mergedConfig,
      plans: mergedConfig.plans.map((plan) => (plan.id === editingPlanIdRef.current ? patchedPlan : plan)),
    };
    pushUndoSnapshot(createSnapshot());
    setPlanConfig(nextConfig);
    setEditingPageId(pageId);
    setBlocks(targetBlocks);
    setSelectedId(getDefaultSelectedBlockIdForPage(targetBlocks));
    persistDraftForConfigs(nextConfig);
  }

  function openPageCopyDialog() {
    const targetPages = editingPages.filter((page) => page.id !== editingPageIdRef.current);
    if (targetPages.length === 0) {
      showTip("当前只有一个页面，暂无可复制的目标页面");
      return;
    }
    setPageCopySelections(buildPageCopySelectionDefaults(blocksRef.current));
    setPageCopyTargetPageId(targetPages[0]?.id ?? "");
    setPageCopyDialogOpen(true);
  }

  function applySelectedItemsToTargetPage() {
    const targetPageId = pageCopyTargetPageId.trim();
    const includeBackground = pageCopySelections[PAGE_COPY_BACKGROUND_ITEM_ID] === true;
    const includeTheme = pageCopySelections[PAGE_COPY_THEME_ITEM_ID] === true;
    const selectedBlockIds = blocksRef.current
      .filter((block) => pageCopySelections[buildPageCopyItemIdForBlock(block.id)] === true)
      .map((block) => block.id);
    if (!targetPageId) {
      showTip("请选择目标页面");
      return;
    }
    if (targetPageId === editingPageIdRef.current) {
      showTip("目标页面不能是当前页面");
      return;
    }
    if (!includeBackground && !includeTheme && selectedBlockIds.length === 0) {
      showTip("请先选择需要复制的项目");
      return;
    }

    const mergedConfig = mergePlanConfigWithEditingBlocks(
      planConfigRef.current,
      editingPlanIdRef.current,
      editingPageIdRef.current,
      blocksRef.current,
      { syncNavPages: false },
    );
    const planIndex = mergedConfig.plans.findIndex((plan) => plan.id === editingPlanIdRef.current);
    const safePlanIndex = planIndex >= 0 ? planIndex : 0;
    const currentPlan = mergedConfig.plans[safePlanIndex] ?? null;
    if (!currentPlan) return;
    const targetPage = currentPlan.pages.find((page) => page.id === targetPageId) ?? null;
    if (!targetPage) {
      showTip("未找到目标页面，请重新选择");
      return;
    }

    const sourceBlocks = cloneBlocks(blocksRef.current);
    let nextTargetBlocks = cloneBlocks(getBlocksForPage(currentPlan, targetPageId));
    if (selectedBlockIds.length > 0) {
      nextTargetBlocks = copySelectedBlocksToPage(sourceBlocks, selectedBlockIds, nextTargetBlocks);
    }
    if (includeTheme) {
      nextTargetBlocks = applyThemeCopyFromSourceBlocks(sourceBlocks, nextTargetBlocks);
    }
    if (includeBackground) {
      const pageBackgroundPatch = getPageBackgroundPatch(sourceBlocks[0]);
      if (nextTargetBlocks[0]) {
        nextTargetBlocks[0] = {
          ...nextTargetBlocks[0],
          props: {
            ...nextTargetBlocks[0].props,
            ...pageBackgroundPatch,
          } as never,
        } as Block;
      } else if (sourceBlocks[0]) {
        const copiedFirstBlock = createCopiedBlock(sourceBlocks[0]);
        nextTargetBlocks = [
          {
            ...copiedFirstBlock,
            props: {
              ...copiedFirstBlock.props,
              ...pageBackgroundPatch,
            } as never,
          } as Block,
        ];
      }
    }

    const nextPlan = setBlocksForPage(
      {
        ...currentPlan,
        activePageId: editingPageIdRef.current,
      },
      targetPageId,
      nextTargetBlocks,
    );
    const nextPlanConfig: PagePlanConfig = {
      ...mergedConfig,
      plans: mergedConfig.plans.map((plan, index) => (index === safePlanIndex ? nextPlan : plan)),
    };
    const previousBookingBlockCount = countBookingBlocksInSinglePlanConfig(mergedConfig, editingPlanIdRef.current);
    const nextBookingBlockCount = countBookingBlocksInSinglePlanConfig(nextPlanConfig, editingPlanIdRef.current);
    if (nextBookingBlockCount > previousBookingBlockCount && nextBookingBlockCount > 1) {
      showTip("预约区块只能有一个");
      return;
    }
    const targetPageLabel = toPlainText(targetPage.name, targetPage.id);
    pushUndoSnapshot(createSnapshot());
    setPlanConfig(nextPlanConfig);
    persistDraftForConfigs(nextPlanConfig);
    setPageCopyDialogOpen(false);
    showTip(`已复制到页面：${targetPageLabel}`);
  }

  async function deleteBlock(blockId: string) {
    const currentIndex = blocks.findIndex((b) => b.id === blockId);
    if (currentIndex < 0) return;
    const target = blocks[currentIndex];
    const confirmed = await openConfirm(
      "确认删除区块 " + (currentIndex + 1) + ": " + getBlockTypeLabel(target.type) + "?",
      "删除确认",
    );
    if (!confirmed) return;

    const pageBackgroundPatch = getPageBackgroundPatch(blocks[0]);
    const next = blocks.filter((b) => b.id !== blockId);

    if (currentIndex === 0 && next[0]) {
      next[0] = {
        ...next[0],
        props: { ...next[0].props, ...pageBackgroundPatch } as never,
      } as Block;
    }

    const nextSelected = next[Math.min(currentIndex, next.length - 1)];
    if (target.type === "nav") {
      const mergedConfig = mergePlanConfigWithEditingBlocks(
        planConfigRef.current,
        editingPlanIdRef.current,
        editingPageIdRef.current,
        blocksRef.current,
        { syncNavPages: false },
      );
      const currentPlan = mergedConfig.plans.find((plan) => plan.id === editingPlanIdRef.current) ?? mergedConfig.plans[0];
      const nextPlan = {
        ...currentPlan,
        pages: currentPlan.pages.map((page) => ({
          ...page,
          blocks: stripNavBlocks(page.blocks),
        })),
      };
      const activeBlocks = getBlocksForPage(nextPlan, editingPageIdRef.current);
      const nextConfig: PagePlanConfig = {
        ...mergedConfig,
        plans: mergedConfig.plans.map((plan) => (plan.id === editingPlanIdRef.current ? nextPlan : plan)),
      };
      pushUndoSnapshot(createSnapshot());
      setPlanConfig(nextConfig);
      setBlocks(activeBlocks);
      setSelectedId(nextSelected?.id ?? activeBlocks[0]?.id ?? "");
      persistDraftForConfigs(nextConfig);
    } else {
      applyBlocks(next, { selectedId: nextSelected?.id ?? "" });
    }
    setTip("已删除区");
    setTimeout(() => setTip(""), 1200);
  }

  function insertPageImage() {
    const currentBackgroundUrl = blocks[0]?.props.pageBgImageUrl ?? "";
    setPageImageUrlInput(isInlineDataImageUrl(currentBackgroundUrl) ? "" : currentBackgroundUrl);
    setPageImageDialogOpen(true);
  }

  function applyPageImageFromInput() {
    const trimmed = pageImageUrlInput.trim();
    try {
      const currentBackgroundUrl = blocksRef.current[0]?.props.pageBgImageUrl ?? "";
      if (!trimmed && isInlineDataImageUrl(currentBackgroundUrl)) {
        setPageImageDialogOpen(false);
        return;
      }
      const nextUrl = ensureSafeImageUrlSize(trimmed || undefined);
      updatePageBackground({ pageBgImageUrl: nextUrl });
      setPageImageDialogOpen(false);
    } catch (error) {
      setTip(error instanceof Error ? error.message : "图片设置失败，请重试");
      setTimeout(() => setTip(""), 1600);
    }
  }

  function clearPageImage() {
    updatePageBackground({ pageBgImageUrl: undefined });
    setPageImageDialogOpen(false);
  }

  async function handlePageImageUpload(event: ChangeEvent<HTMLInputElement>) {
    const inputEl = event.currentTarget;
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const result = await persistImageFileForEditor(file, { purpose: "page-background", viewport: previewViewport });
      updatePageBackground({ pageBgImageUrl: result.value });
      setPageImageDialogOpen(false);
      setTip(result.externalized ? "页面背景图片已上传" : "页面背景图片已更新");
      setTimeout(() => setTip(""), 1200);
    } catch (error) {
      setTip(error instanceof Error ? error.message : "上传失败，请重试");
      setTimeout(() => setTip(""), 1600);
    } finally {
      inputEl.value = "";
    }
  }

  function editPageImageSettings() {
    setPageSettingsFillMode(blocks[0]?.props.pageBgFillMode ?? "cover");
    setPageSettingsPosition(blocks[0]?.props.pageBgPosition ?? "center");
    setPageSettingsColor(blocks[0]?.props.pageBgColor ?? "");
    setPageSettingsImageOpacity(
      typeof blocks[0]?.props.pageBgImageOpacity === "number" && Number.isFinite(blocks[0]?.props.pageBgImageOpacity)
        ? Math.max(0, Math.min(1, blocks[0]?.props.pageBgImageOpacity ?? 1))
        : typeof blocks[0]?.props.pageBgOpacity === "number" && Number.isFinite(blocks[0]?.props.pageBgOpacity)
          ? Math.max(0, Math.min(1, blocks[0]?.props.pageBgOpacity ?? 1))
          : 1,
    );
    setPageSettingsColorOpacity(
      typeof blocks[0]?.props.pageBgColorOpacity === "number" && Number.isFinite(blocks[0]?.props.pageBgColorOpacity)
        ? Math.max(0, Math.min(1, blocks[0]?.props.pageBgColorOpacity ?? 1))
        : typeof blocks[0]?.props.pageBgOpacity === "number" && Number.isFinite(blocks[0]?.props.pageBgOpacity)
          ? Math.max(0, Math.min(1, blocks[0]?.props.pageBgOpacity ?? 1))
        : 1,
    );
    setPageImageSettingsOpen(true);
  }

  function applyPageImageSettings() {
    updatePageBackground({
      pageBgFillMode: pageSettingsFillMode,
      pageBgPosition: pageSettingsPosition.trim() || "center",
      pageBgColor: pageSettingsColor.trim() || undefined,
      pageBgImageOpacity: pageSettingsImageOpacity,
      pageBgColorOpacity: pageSettingsColorOpacity,
      pageBgOpacity: undefined,
    });
    recordRecentColor(pageSettingsColor);
    setPageImageSettingsOpen(false);
  }

  async function withTimeout<T>(
    task: PromiseLike<T>,
    timeoutMs = 45000,
    timeoutMessage = "保存超时，请稍后重试",
  ): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let timedOut = false;
    const safeTask = Promise.resolve(task).catch((error) => {
      if (timedOut) {
        return new Promise<T>(() => {});
      }
      throw error;
    });
    const timeoutTask = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        reject(new Error(timeoutMessage));
      }, timeoutMs);
    });

    try {
      return await Promise.race([safeTask, timeoutTask]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async function syncMerchantProfileBinding(
    merchantId: string,
    domainPrefix: string,
    merchantName: string,
    profile?: {
      domain?: string;
      signature?: string;
      contactAddress?: string;
      contactName?: string;
      contactPhone?: string;
      contactEmail?: string;
      industry?: string;
      location?: SiteLocation | null;
      chatAvatarImageUrl?: string;
      contactVisibility?: MerchantContactVisibility | null;
      businessCards?: MerchantBusinessCardAsset[];
    },
  ) {
    const normalizedMerchantId = String(merchantId ?? "").trim();
    const normalizedPrefix = normalizeDomainPrefixForMerchant(domainPrefix);
    const normalizedMerchantName = String(merchantName ?? "").trim();
    if (!normalizedMerchantId || !normalizedPrefix || !isSupabaseEnabled) {
      return { ok: false as const, updated: false };
    }

    const headers: Record<string, string> = {
      "content-type": "application/json",
    };

    const response = await fetch("/api/merchant-domain-binding", {
      method: "POST",
      headers,
      credentials: "same-origin",
      body: JSON.stringify({
        merchantId: normalizedMerchantId,
        domainPrefix: normalizedPrefix,
        merchantName: normalizedMerchantName,
        ...(typeof profile?.signature === "string" ? { signature: String(profile.signature).trim() } : {}),
        domain: String(profile?.domain ?? "").trim(),
        contactAddress: String(profile?.contactAddress ?? "").trim(),
        contactName: String(profile?.contactName ?? "").trim(),
        contactPhone: String(profile?.contactPhone ?? "").trim(),
        contactEmail: String(profile?.contactEmail ?? "").trim(),
        industry: String(profile?.industry ?? "").trim(),
        location: profile?.location ?? null,
        ...(typeof profile?.chatAvatarImageUrl === "string"
          ? { chatAvatarImageUrl: String(profile.chatAvatarImageUrl).trim() }
          : {}),
        ...(profile?.contactVisibility
          ? { contactVisibility: profile.contactVisibility }
          : {}),
        ...(Array.isArray(profile?.businessCards)
          ? { businessCards: normalizeMerchantBusinessCardChatDisplaySelection(profile.businessCards) }
          : {}),
      }),
    });

    const data = (await response.json().catch(() => null)) as {
      updated?: unknown;
      slugUpdated?: unknown;
      merchantNameUpdated?: unknown;
      message?: unknown;
    } | null;
    if (!response.ok) {
      return {
        ok: false as const,
        updated: false,
        message: typeof data?.message === "string" ? data.message : `HTTP ${response.status}`,
      };
    }

    return {
      ok: true as const,
      updated: data?.updated === true,
      slugUpdated: data?.slugUpdated === true,
      merchantNameUpdated: data?.merchantNameUpdated === true,
    };
  }

  function saveDraft() {
    flushPendingEditorChanges();
    const mergedConfig = mergePlanConfigWithEditingBlocks(
      planConfigRef.current,
      editingPlanIdRef.current,
      editingPageIdRef.current,
      blocksRef.current,
    );
    const desktopConfig = previewViewport === "desktop" ? mergedConfig : viewportStatesRef.current.desktop.planConfig;
    const mobileConfig = previewViewport === "mobile" ? mergedConfig : viewportStatesRef.current.mobile.planConfig;
    const combinedDraft = buildCombinedPersistedBlocks(desktopConfig, mobileConfig);
    setPlanConfig(mergedConfig);
    const draftSaved = saveBlocksToStorage(combinedDraft, storeScope);
    const recoveryPointSaved = saveLatestDraftSnapshot(combinedDraft, storeScope);
    if (!draftSaved || !recoveryPointSaved) {
      showSavePublishTip("草稿未完整保存：浏览器存储不可用或空间不足，请释放空间后重试");
      return;
    }
    showSavePublishTip("草稿已保存");
  }

  async function runPublishPreflightDialog(blocks: Block[], payloadBytes: number) {
    const { runPublishPreflight } = await loadEditorAssetProcessing();
    const result = runPublishPreflight(blocks, payloadBytes, MAX_PUBLISH_PAYLOAD_BYTES);
    if (result.errors.length > 0) {
      await openAlert(
        [
          "发布体检未通过",
          ...result.errors.map((item) => `- ${item}`),
          "",
          "请先处理后再发布",
        ].join("\n"),
        "发布体检",
      );
      return false;
    }
    if (result.warnings.length > 0) {
      const confirmed = await openConfirm(
        [
          "发布体检发现风险",
          ...result.warnings.map((item) => `- ${item}`),
          "",
          "是否仍继续发布？",
        ].join("\n"),
        "发布体检",
      );
      return confirmed;
    }
    return true;
  }

  async function publishToFrontend() {
    if (publishing || publishingRef.current) return;
    publishingRef.current = true;
    setPublishing(true);
    showSavePublishTip("发布中，请稍候...");
    let editorAssetProcessing: Awaited<ReturnType<typeof loadEditorAssetProcessing>> | null = null;
    try {
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    flushPendingEditorChanges();
    const scopedSiteIdForGuard = getSiteIdFromStoreScope(storeScope).trim();
    if (!isPlatformEditor && !scopedSiteIdForGuard) {
      showTip("当前不是商户站点作用域（缺少 site-xxx），已止发布以防写错", {
        durationMs: 4200,
        dismissOnPointer: true,
      });
      return;
    }
    if (!isPlatformEditor) {
      const sessionReady = await ensureMerchantSessionRecoveredBeforePublish();
      if (!sessionReady) return;
    }
    if (!isPlatformEditor && !remoteContentVerified) {
      const verified = await ensureRemoteContentVerifiedBeforePublish(scopedSiteIdForGuard);
      if (!verified) {
        showTip("远端内容未验证，已阻止发布（防止覆盖线上内容）。请检查后端连接后重试。", {
          durationMs: 4200,
          dismissOnPointer: true,
        });
        return;
      }
    }
    let publishTargetSiteId = "";
    let publishTargetDomainPrefix = "";
    if (!isPlatformEditor) {
      const scopedId = getSiteIdFromStoreScope(storeScope);
      const targetSiteId =
        scopedId ||
        editingSiteId ||
        merchantIdsRef.current.find((item) => isMerchantNumericId(item)) ||
        merchantIdsRef.current[0] ||
        "";
      if (targetSiteId) {
        ensureScopedMerchantSite(targetSiteId, null);
      }
      const latestState = loadPlatformState();
      publishTargetSiteId = targetSiteId;
      let targetSite = targetSiteId ? latestState.sites.find((item) => item.id === targetSiteId) ?? null : null;
      publishTargetDomainPrefix = normalizeDomainPrefixForMerchant(targetSite?.domainPrefix ?? targetSite?.domainSuffix ?? "");
      let serviceState = getMerchantServiceState(targetSite?.status, targetSite?.serviceExpiresAt);
      if (serviceState.maintenance && targetSiteId) {
        const refreshedSite = await syncScopedMerchantSiteFromPublishedSnapshot(targetSiteId);
        if (refreshedSite) {
          targetSite = refreshedSite;
          publishTargetDomainPrefix = normalizeDomainPrefixForMerchant(
            refreshedSite.domainPrefix ?? refreshedSite.domainSuffix ?? "",
          );
          serviceState = getMerchantServiceState(refreshedSite.status, refreshedSite.serviceExpiresAt);
        }
      }
      if (serviceState.maintenance) {
        showTip("服务到期，详询官方客服", {
          durationMs: 4200,
          dismissOnPointer: true,
        });
        return;
      }
      const missingFields = getMissingMerchantProfileFields(targetSite);
      if (missingFields.length > 0) {
        setTopBarCollapsed(false);
        triggerMerchantProfileAttention();
        showTip(`请先完善商户信息后再去前台（缺少：${missingFields.join("、")}）`);
        return;
      }
    }
    const mergedConfig = mergePlanConfigWithEditingBlocks(
      planConfigRef.current,
      editingPlanIdRef.current,
      editingPageIdRef.current,
      blocksRef.current,
    );
    const desktopConfig = previewViewport === "desktop" ? mergedConfig : viewportStatesRef.current.desktop.planConfig;
    const mobileConfig = previewViewport === "mobile" ? mergedConfig : viewportStatesRef.current.mobile.planConfig;
    const desktopPublishPlanId = getViewportEditingPlanId("desktop");
    const mobilePublishPlanId = getViewportEditingPlanId("mobile");
    const desktopBookingBlockCount = isPlatformEditor
      ? countBookingBlocksInPlanConfig(desktopConfig)
      : countBookingBlocksInSinglePlanConfig(desktopConfig, desktopPublishPlanId);
    const mobileBookingBlockCount = isPlatformEditor
      ? countBookingBlocksInPlanConfig(mobileConfig)
      : countBookingBlocksInSinglePlanConfig(mobileConfig, mobilePublishPlanId);
    if (desktopBookingBlockCount > 1 || mobileBookingBlockCount > 1) {
      showTip("预约区块只能有一个，请先删除重复的预约区块后再发布", {
        durationMs: 4200,
        dismissOnPointer: true,
      });
      return;
    }
    let draftBlocks = injectPublishedMerchantSnapshot(buildCombinedPersistedBlocks(desktopConfig, mobileConfig));
    let combinedBlocks = isPlatformEditor
      ? draftBlocks
      : injectPublishedMerchantSnapshot(buildMerchantSinglePlanPublishBlocks(desktopConfig, mobileConfig));
    if (isPlatformEditor) {
      await syncPlatformMerchantSnapshotToServerRef.current();
    }

    if (isSupabaseFallbackMode) {
      const notice =
        supabaseMissingEnvNotice ??
        "Publish requires backend configuration. Please set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.";
      setBackendNotice(notice);
      showPublishFailedTip(notice);
      return;
    }
    if (!isSupabaseEnabled) {
      const notice = supabaseMissingEnvNotice ?? BACKEND_UNAVAILABLE_NOTICE;
      setBackendNotice(notice);
      showPublishFailedTip(notice);
      return;
    }
    const gatewayReady = await canReachSupabaseGateway(Math.min(3000, AUTH_CHECK_TIMEOUT_MS));
    if (!gatewayReady) {
      setBackendNotice("后端连接不稳定，正在尝试发布...");
    }

    try {
      const scopedSiteId = getSiteIdFromStoreScope(storeScope).trim();
      const preferredMerchantIds = isPlatformEditor
        ? []
        : scopedSiteId
          ? [scopedSiteId]
          : mergePreferredMerchantIds([publishTargetSiteId, editingSiteId].filter(Boolean), merchantIdsRef.current);
      const merchantHint =
        (isPlatformEditor
          ? "platform"
          : (publishTargetSiteId ||
              scopedSiteId ||
              editingSiteId ||
              preferredMerchantIds[0] ||
              "public")
        ).trim() || "public";
      const publishPayloadLimitBytes =
        !isPlatformEditor && merchantPublishSizeLimitBytes
          ? Math.min(MAX_PUBLISH_PAYLOAD_BYTES, merchantPublishSizeLimitBytes)
          : MAX_PUBLISH_PAYLOAD_BYTES;
      editorAssetProcessing = await loadEditorAssetProcessing();
      const {
        backfillProductThumbnailsInBlocks,
        buildInlineAssetsRecoveryMessage,
        computePublishDiffSummary,
        formatInlineAssetStatsText,
        getPublishSizeBreakdown,
        optimizeBlocksForPublishIfNeeded,
      } = editorAssetProcessing;
      const optimization = await optimizeBlocksForPublishIfNeeded(combinedBlocks, {
        merchantHint,
        uploadCompressionPreset,
        targetPayloadBytes: publishPayloadLimitBytes,
      });
      if (optimization.optimized) {
        combinedBlocks = optimization.blocks;
        if (isPlatformEditor) {
          draftBlocks = combinedBlocks;
          applyPersistedBlocksToEditorRef.current(combinedBlocks, { resetHistory: false });
        }
        if (optimization.summary) showSavePublishTip(optimization.summary);
      }
      const productThumbnailCache = new Map<string, string | null>();
      const productThumbnailBackfill = await backfillProductThumbnailsInBlocks(
        combinedBlocks,
        merchantHint,
        productThumbnailCache,
      );
      if (productThumbnailBackfill.changed) {
        combinedBlocks = productThumbnailBackfill.blocks;
        if (isPlatformEditor) {
          draftBlocks = combinedBlocks;
          applyPersistedBlocksToEditorRef.current(combinedBlocks, { resetHistory: false });
        }
      }
      if (!isPlatformEditor) {
        const draftThumbnailBackfill = await backfillProductThumbnailsInBlocks(
          draftBlocks,
          merchantHint,
          productThumbnailCache,
        );
        if (draftThumbnailBackfill.changed) {
          draftBlocks = draftThumbnailBackfill.blocks;
        }
        combinedBlocks = rebuildSinglePlanPublishBlocks(combinedBlocks);
      }
      if (productThumbnailBackfill.stats.generated > 0) {
        const limitedText = productThumbnailBackfill.stats.limited > 0 ? "，剩余旧图下次发布继续处理" : "";
        showSavePublishTip(`已补齐产品缩略图 ${productThumbnailBackfill.stats.generated} 张${limitedText}`);
      }
      const payload = {
        blocks: combinedBlocks,
        updated_at: new Date().toISOString(),
      };
      const remainingInlineAssets = countInlineAssets(payload.blocks);
      if (remainingInlineAssets.totalCount > 0) {
        const message = `发布没有完成：自动外链化后仍有资源未上传成功（${formatInlineAssetStatsText(remainingInlineAssets)}）`;
        showPublishFailedTip(message);
        savePublishFailureSnapshot(
          {
            reason: "inline-assets-blocked",
            bytes: estimateUtf8Size(JSON.stringify(payload.blocks)),
            blocks: combinedBlocks,
          },
          storeScope,
        );
        recordPublishEvent({
          success: false,
          bytes: estimateUtf8Size(JSON.stringify(payload.blocks)),
          changedBlocks: 1,
          reason: "inline-assets-blocked",
        });
        await openAlert(buildInlineAssetsRecoveryMessage(remainingInlineAssets), "发布资源处理失败");
        return;
      }
      const payloadBytes = estimateUtf8Size(JSON.stringify(payload.blocks));
      if (!isPlatformEditor && merchantPublishSizeLimitBytes && payloadBytes > merchantPublishSizeLimitBytes) {
        const message = `发布没有完成：系统已自动压缩资源，但发布体积仍超出当前权限上限（当前 ${formatBytes(payloadBytes)}，上限 ${formatBytes(merchantPublishSizeLimitBytes)}）`;
        showPublishFailedTip(message);
        savePublishFailureSnapshot(
          {
            reason: "merchant-permission-size-limit",
            bytes: payloadBytes,
            blocks: combinedBlocks,
          },
          storeScope,
        );
        recordPublishEvent({
          success: false,
          bytes: payloadBytes,
          changedBlocks: 1,
          reason: "merchant-permission-size-limit",
        });
        return;
      }
      const publishedBlocks = loadPublishedBlocksFromStorage(defaultEditorBlocks, storeScope);
      const diffSummary = computePublishDiffSummary(combinedBlocks, publishedBlocks);
      const totalChanges = diffSummary.changedCount + diffSummary.addedCount + diffSummary.removedCount;
      if (totalChanges === 0) {
        showSavePublishTip("无变更，已跳过发布");
        recordPublishEvent({
          success: true,
          bytes: payloadBytes,
          changedBlocks: 0,
          reason: "skip-no-change",
        });
        return;
      }

      const preflightPassed = await runPublishPreflightDialog(payload.blocks, payloadBytes);
      if (!preflightPassed) {
        showPublishFailedTip("发布没有完成：发布体检未通过或已取消");
        recordPublishEvent({
          success: false,
          bytes: payloadBytes,
          changedBlocks: totalChanges,
          reason: "preflight-blocked",
        });
        return;
      }

      saveBlocksToStorage(isPlatformEditor ? combinedBlocks : draftBlocks, storeScope);
      recordPublishedVersion(combinedBlocks, storeScope);
      savePublishedBlocksToStorage(combinedBlocks, storeScope);

      if (payloadBytes > MAX_PUBLISH_PAYLOAD_BYTES) {
        const breakdown = getPublishSizeBreakdown(payload.blocks);
        showPublishFailedTip(
          `发布没有完成：系统已自动压缩资源，但发布体积仍超过系统上限（${(payloadBytes / 1024 / 1024).toFixed(2)}MB）`,
        );
        savePublishFailureSnapshot({
          reason: "体积超限",
          bytes: payloadBytes,
          blocks: combinedBlocks,
        }, storeScope);
        recordPublishEvent({
          success: false,
          bytes: payloadBytes,
          changedBlocks: totalChanges,
          reason: "size-limit",
        });
        const lines: string[] = [
          `当前发布体积：${formatBytes(payloadBytes)}（上限：${formatBytes(MAX_PUBLISH_PAYLOAD_BYTES)}）`,
          "",
          "占用大的区块",
          ...(breakdown.blockTotals.length > 0
            ? breakdown.blockTotals.map((item) => `- ${item.path}: ${formatBytes(item.bytes)}`)
            : ["- 暂无"]),
        ];
        await openAlert(lines.join("\n"), "发布体积明细");
        return;
      }
      let error: SaveErrorLike = null;
      const serverPublishResult = await trySaveViaServerPublishApi(payload, preferredMerchantIds, publishTargetDomainPrefix, 70000);
      if (serverPublishResult.handled) {
        error = serverPublishResult.error;
      } else {
        try {
          error = await trySaveWithResolvedMerchantIds(payload, preferredMerchantIds, publishTargetDomainPrefix, 45000);
        } catch (firstError) {
          if (!(firstError instanceof Error) || !firstError.message.includes("保存超时")) {
            throw firstError;
          }
          showSavePublishTip("首次发布超时，正在自动重试...");
          error = await trySaveWithResolvedMerchantIds(payload, preferredMerchantIds, publishTargetDomainPrefix, 60000);
        }
      }

      if (error) {
        const normalizedReason = normalizeSaveErrorMessage(error.message);
        showPublishFailedTip(`草稿已保存，发布失败：${normalizedReason}`);
        savePublishFailureSnapshot({
          reason: normalizedReason,
          bytes: payloadBytes,
          blocks: combinedBlocks,
        }, storeScope);
        recordPublishEvent({
          success: false,
          bytes: payloadBytes,
          changedBlocks: totalChanges,
          reason: normalizedReason,
        });
        if (shouldOfferCompressionPresetForPublishError(normalizedReason, error.code)) {
          await openAlert(
            `真实错误：${normalizedReason}\n\n系统发布前已自动尝试压缩和外链化。请先重试发布；若仍失败，请检查上传接口、存储桶和服务端密钥配置。`,
            "发布失败",
          );
        }
        return;
      }

      recordPublishedVersion(publishedBlocks, storeScope);
      recordPublishedVersion(combinedBlocks, storeScope);
      savePublishedBlocksToStorage(combinedBlocks, storeScope);
      recordRemoteContentVerifiedTimestamp(storeScope);
      if (!isPlatformEditor) {
        const mirrorSiteIds = Array.from(
          new Set(
            [publishTargetSiteId, editingSiteId, getSiteIdFromStoreScope(storeScope), ...merchantIdsRef.current]
              .map((item) => (item ?? "").trim())
              .filter((item) => item.length > 0),
          ),
        );
        mirrorSiteIds.forEach((siteId) => {
          savePublishedBlocksToStorage(combinedBlocks, buildSiteStoreScope(siteId));
          recordRemoteContentVerifiedTimestamp(buildSiteStoreScope(siteId));
        });
        broadcastPublishSync(mirrorSiteIds);
      }
      setRemoteContentVerified(true);
      recordPublishEvent({
        success: true,
        bytes: payloadBytes,
        changedBlocks: totalChanges,
      });
      showSavePublishTip("已发布到前台");
    } catch (error) {
      const mergedConfig = mergePlanConfigWithEditingBlocks(
        planConfigRef.current,
        editingPlanIdRef.current,
        editingPageIdRef.current,
        blocksRef.current,
      );
      const desktopConfig = previewViewport === "desktop" ? mergedConfig : viewportStatesRef.current.desktop.planConfig;
      const mobileConfig = previewViewport === "mobile" ? mergedConfig : viewportStatesRef.current.mobile.planConfig;
      const combinedBlocks = isPlatformEditor
        ? buildCombinedPersistedBlocks(desktopConfig, mobileConfig)
        : buildMerchantSinglePlanPublishBlocks(desktopConfig, mobileConfig);
      const payloadBytes = estimateUtf8Size(JSON.stringify(combinedBlocks));
      const message = error instanceof Error ? error.message : "发布失败，请检查网络后重试";
      savePublishFailureSnapshot({
        reason: message,
        bytes: payloadBytes,
        blocks: combinedBlocks,
      }, storeScope);
      recordPublishEvent({
        success: false,
        bytes: payloadBytes,
        changedBlocks: Math.max(
          1,
          (() => {
            const diff = editorAssetProcessing?.computePublishDiffSummary(
              combinedBlocks,
              loadPublishedBlocksFromStorage(defaultEditorBlocks, storeScope),
            );
            return diff ? diff.changedCount + diff.addedCount + diff.removedCount : 1;
          })(),
        ),
        reason: message,
      });
      if (error instanceof Error && error.message.includes("保存超时")) {
        showPublishFailedTip("发布超时：系统已自动尝试压缩资源，请稍后重试");
      } else {
        showPublishFailedTip(error instanceof Error ? error.message : "发布失败，请检查网络后重试");
      }
      const caughtReason = error instanceof Error ? error.message : "发布失败，请检查网络后重试";
      if (shouldOfferCompressionPresetForPublishError(caughtReason)) {
        await openAlert(
          `真实错误：${caughtReason}\n\n系统发布前已自动尝试压缩和外链化。请先重试发布；若仍失败，请检查上传接口、存储桶和服务端密钥配置。`,
          "发布失败",
        );
      }
    } finally {
      publishingRef.current = false;
      setPublishing(false);
    }
    } finally {
      publishingRef.current = false;
      setPublishing(false);
    }
  }

  async function logout() {
    if (loggingOut) return;
    if (!isSupabaseEnabled) {
      clearStoredBrowserSupabaseSessionTokens();
      clearMerchantSignInBridge();
      clearRecentMerchantLaunchState();
      window.location.href = "/login?loggedOut=1";
      return;
    }
    setLoggingOut(true);
    try {
      await fetch("/api/auth/merchant-logout", {
        method: "POST",
        credentials: "same-origin",
      }).catch(() => null);
      const { error } = await withTimeout(
        supabase.auth.signOut(),
        AUTH_CHECK_TIMEOUT_MS,
        "退出登录超时，请稍后重试",
      );
      if (error) {
        setTip(`退出失败：${error.message}`);
        return;
      }
      clearStoredBrowserSupabaseSessionTokens();
      clearMerchantSignInBridge();
      clearRecentMerchantLaunchState();
      window.location.href = "/login?loggedOut=1";
    } catch (error) {
      setTip(error instanceof Error ? error.message : "退出失败，请稍后重试");
    } finally {
      setLoggingOut(false);
    }
  }

  async function requestLogout() {
    if (loggingOut) return;
    const confirmed = await openConfirm("确认退出当前商户后台吗？", "退出登录");
    if (!confirmed) return;
    await logout();
  }

  async function openAccountSwitcher() {
    void loadAccountSwitcherDialog().catch(() => undefined);
    setAccountSwitchError("");
    const entries = await recordCurrentAccountSwitchSession({
      displayName: supportSelfDisplayName,
      avatarUrl: supportSelfAvatarImageUrl,
    });
    setAccountSwitchEntries(entries);
    setAccountSwitcherOpen(true);
  }

  async function handleAccountSwitch(entry: AccountSwitchEntry) {
    if (accountSwitchBusyKey || entry.key === merchantAccountSwitchCurrentKey) return;
    setAccountSwitchBusyKey(entry.key);
    setAccountSwitchError("");
    try {
      await recordCurrentAccountSwitchSession({
        displayName: supportSelfDisplayName,
        avatarUrl: supportSelfAvatarImageUrl,
      }).then(setAccountSwitchEntries);
      const nextPayload = await restoreAccountSwitchEntry(entry);
      window.location.href = getAccountSwitchHomeHref(nextPayload);
    } catch (error) {
      removeAccountSwitchEntry(entry.key);
      setAccountSwitchEntries(readAccountSwitchEntries());
      setAccountSwitchError(error instanceof Error ? error.message : "账号切换失败，请重新登录。");
      setAccountSwitchBusyKey("");
    }
  }

  async function addAccountFromSwitcher() {
    if (accountSwitchBusyKey) return;
    setAccountSwitchBusyKey("__add__");
    setAccountSwitchError("");
    await recordCurrentAccountSwitchSession({
      displayName: supportSelfDisplayName,
      avatarUrl: supportSelfAvatarImageUrl,
    }).catch(() => null);
    await fetch("/api/auth/merchant-logout", {
      method: "POST",
      credentials: "same-origin",
    }).catch(() => null);
    if (isSupabaseEnabled) {
      await supabase.auth.signOut().catch(() => null);
    }
    clearStoredBrowserSupabaseSessionTokens();
    clearMerchantSignInBridge();
    clearRecentMerchantLaunchState();
    window.location.href = "/login?loggedOut=1&redirect=/admin";
  }

  const scopedSiteId = !isPlatformEditor ? getSiteIdFromStoreScope(storeScope) : "";
  const fallbackMerchantSiteId =
    !isPlatformEditor
      ? merchantIdsRef.current.find((item) => isMerchantNumericId(item)) ?? merchantIdsRef.current[0] ?? ""
      : "";
  const editingSiteId =
    !isPlatformEditor && merchantPlatformState
      ? merchantSiteIdOverride || scopedSiteId || fallbackMerchantSiteId
      : "";
  const editingSite =
    editingSiteId && merchantPlatformState
      ? merchantPlatformState.sites.find((item) => item.id === editingSiteId) ?? null
      : null;
  const summarizeMerchantBookingAttention = useCallback((records: MerchantBookingRecord[]) => {
    return summarizeMerchantBookingAttentionRecords(records, editingSiteId);
  }, [editingSiteId]);
  const handleMerchantBookingRecordsChange = useCallback((records: MerchantBookingRecord[]) => {
    setMerchantBookingAttentionSummary(summarizeMerchantBookingAttention(records));
    setMerchantBusinessAttentionHydrationState((current) => (current.booking ? current : { ...current, booking: true }));
  }, [summarizeMerchantBookingAttention]);
  const summarizeMerchantOrderAttention = useCallback(
    (records: MerchantOrderRecord[]) => summarizeMerchantOrderAttentionRecords(records, editingSiteId),
    [editingSiteId],
  );
  const handleMerchantOrderRecordsChange = useCallback((records: MerchantOrderRecord[]) => {
    setMerchantOrderAttentionSummary(summarizeMerchantOrderAttention(records));
    setMerchantBusinessAttentionHydrationState((current) => (current.orders ? current : { ...current, orders: true }));
  }, [summarizeMerchantOrderAttention]);

  useEffect(() => {
    if (isPlatformEditor || typeof window === "undefined") return;
    if (!isMerchantNumericId(editingSiteId)) return;
    persistRecentMerchantLaunchState(editingSiteId);
  }, [editingSiteId, isPlatformEditor]);

  useEffect(() => {
    merchantOperationLogSiteIdRef.current = !isPlatformEditor && isMerchantNumericId(editingSiteId) ? editingSiteId : "";
  }, [editingSiteId, isPlatformEditor]);

  useEffect(() => {
    merchantOperationLogsRequestIdRef.current += 1;
    setMerchantOperationLogs([]);
    setMerchantOperationLogTotal(0);
    setMerchantOperationLogAllTotal(0);
    setMerchantOperationLogSuccessTotal(0);
    setMerchantOperationLogFailedTotal(0);
    setMerchantOperationLogModules([]);
    setMerchantOperationLogHasMore(false);
    setMerchantOperationLogsError("");
    setMerchantOperationLogModuleFilter("all");
    setMerchantOperationLogStatusFilter("all");
    setMerchantOperationLogStartDate("");
    setMerchantOperationLogEndDate("");
  }, [editingSiteId, isPlatformEditor]);

  useEffect(() => {
    merchantOperationLogsCountRef.current = merchantOperationLogs.length;
  }, [merchantOperationLogs.length]);

  const loadMerchantOperationLogs = useCallback(
    async (mode: "reset" | "append" = "reset") => {
      const requestId = ++merchantOperationLogsRequestIdRef.current;
      if (isPlatformEditor || typeof window === "undefined" || !isMerchantNumericId(editingSiteId)) {
        setMerchantOperationLogs([]);
        setMerchantOperationLogTotal(0);
        setMerchantOperationLogAllTotal(0);
        setMerchantOperationLogSuccessTotal(0);
        setMerchantOperationLogFailedTotal(0);
        setMerchantOperationLogModules([]);
        setMerchantOperationLogHasMore(false);
        setMerchantOperationLogsError("");
        return;
      }
      const normalizedStartDate = formatMerchantLogDateValue(merchantOperationLogStartDate);
      const normalizedEndDate = formatMerchantLogDateValue(merchantOperationLogEndDate);
      if (merchantOperationLogStartDate.trim() && !normalizedStartDate) {
        setMerchantOperationLogsError("开始日期无效，请输入真实日期，例如 2026-07-21。");
        setMerchantOperationLogsLoading(false);
        return;
      }
      if (merchantOperationLogEndDate.trim() && !normalizedEndDate) {
        setMerchantOperationLogsError("结束日期无效，请输入真实日期，例如 2026-07-21。");
        setMerchantOperationLogsLoading(false);
        return;
      }
      const startAt = normalizedStartDate ? formatMerchantLogDateBoundaryIso(normalizedStartDate, "start") : "";
      const endAt = normalizedEndDate ? formatMerchantLogDateBoundaryIso(normalizedEndDate, "end") : "";
      if (startAt && endAt && Date.parse(startAt) > Date.parse(endAt)) {
        setMerchantOperationLogsError("开始日期不能晚于结束日期。");
        setMerchantOperationLogsLoading(false);
        return;
      }
      const offset = mode === "append" ? merchantOperationLogsCountRef.current : 0;
      setMerchantOperationLogsLoading(true);
      setMerchantOperationLogsError("");
      try {
        const params = new URLSearchParams({
          siteId: editingSiteId,
          offset: String(offset),
          limit: "120",
        });
        if (merchantOperationLogModuleFilter !== "all") params.set("module", merchantOperationLogModuleFilter);
        if (merchantOperationLogStatusFilter !== "all") params.set("status", merchantOperationLogStatusFilter);
        if (startAt) params.set("startAt", startAt);
        if (endAt) params.set("endAt", endAt);
        const response = await fetch(`/api/merchant-operation-logs?${params.toString()}`, {
          method: "GET",
          cache: "no-store",
          credentials: "same-origin",
          headers: {
            accept: "application/json",
          },
        });
        const payload = (await response.json().catch(() => null)) as
          | {
              ok?: unknown;
              logs?: MerchantOperationLogEntry[];
              total?: unknown;
              allTotal?: unknown;
              successCount?: unknown;
              failedCount?: unknown;
              modules?: unknown;
              hasMore?: unknown;
            }
          | null;
        if (!response.ok || payload?.ok !== true || !Array.isArray(payload.logs)) {
          throw new Error("merchant_operation_logs_load_failed");
        }
        if (requestId !== merchantOperationLogsRequestIdRef.current) return;
        setMerchantOperationLogs((current) =>
          mode === "append" ? filterMerchantOperationLogs([...current, ...payload.logs!]) : payload.logs!,
        );
        setMerchantOperationLogTotal(Number(payload.total) || 0);
        setMerchantOperationLogAllTotal(Number(payload.allTotal) || 0);
        setMerchantOperationLogSuccessTotal(Number(payload.successCount) || 0);
        setMerchantOperationLogFailedTotal(Number(payload.failedCount) || 0);
        setMerchantOperationLogModules(Array.isArray(payload.modules) ? payload.modules.filter((item): item is string => typeof item === "string") : []);
        setMerchantOperationLogHasMore(payload.hasMore === true);
      } catch {
        if (requestId !== merchantOperationLogsRequestIdRef.current) return;
        setMerchantOperationLogsError(
          mode === "reset"
            ? "服务器日志暂时不可用，当前显示此设备的本机缓存。"
            : "加载更多日志失败，请稍后重试。",
        );
        if (mode === "reset") {
          const localLogs = readMerchantOperationLogs(editingSiteId);
          const filteredLocalLogs = filterMerchantOperationLogs(localLogs, {
            module: merchantOperationLogModuleFilter,
            status: merchantOperationLogStatusFilter,
            startAt: startAt ? Date.parse(startAt) : null,
            endAt: endAt ? Date.parse(endAt) : null,
          });
          setMerchantOperationLogs(filteredLocalLogs);
          setMerchantOperationLogTotal(filteredLocalLogs.length);
          setMerchantOperationLogAllTotal(localLogs.length);
          setMerchantOperationLogSuccessTotal(filteredLocalLogs.filter((item) => item.status === "success").length);
          setMerchantOperationLogFailedTotal(filteredLocalLogs.filter((item) => item.status === "failed").length);
          setMerchantOperationLogModules(Array.from(new Set(localLogs.map((item) => item.module).filter(Boolean))));
          setMerchantOperationLogHasMore(false);
        }
      } finally {
        if (requestId === merchantOperationLogsRequestIdRef.current) setMerchantOperationLogsLoading(false);
      }
    },
    [
      editingSiteId,
      isPlatformEditor,
      merchantOperationLogEndDate,
      merchantOperationLogModuleFilter,
      merchantOperationLogStartDate,
      merchantOperationLogStatusFilter,
    ],
  );

  useEffect(() => {
    if (merchantDesktopSection !== "logs") return;
    void loadMerchantOperationLogs("reset");
  }, [loadMerchantOperationLogs, merchantDesktopSection]);

  useEffect(() => {
    if (
      isPlatformEditor ||
      merchantDesktopSection !== "logs" ||
      typeof window === "undefined" ||
      !isMerchantNumericId(editingSiteId)
    ) {
      return;
    }
    const refreshLogs = () => {
      void loadMerchantOperationLogs("reset");
    };
    window.addEventListener(MERCHANT_OPERATION_LOG_EVENT, refreshLogs);
    return () => {
      window.removeEventListener(MERCHANT_OPERATION_LOG_EVENT, refreshLogs);
    };
  }, [editingSiteId, isPlatformEditor, loadMerchantOperationLogs, merchantDesktopSection]);

  useEffect(() => {
    if (isPlatformEditor || typeof window === "undefined") return;
    const originalFetch = window.fetch.bind(window);
    window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const info = buildMerchantOperationFetchInfo(input, init, merchantOperationLogSiteIdRef.current);
      if (!info || !isMerchantNumericId(info.siteId)) {
        return originalFetch(input, init);
      }
      return originalFetch(input, init)
        .then((response) => {
          void response
            .clone()
            .json()
            .catch(() => null)
            .then((payload) => {
              const payloadRecord = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : null;
              const payloadOk = payloadRecord ? payloadRecord.ok !== false && !payloadRecord.error : true;
              const status: MerchantOperationLogStatus = response.ok && payloadOk ? "success" : "failed";
              recordMerchantOperationFetchResult(info, status, status === "failed" ? readMerchantOperationResponseMessage(payload) : undefined);
            });
          return response;
        })
        .catch((error) => {
          recordMerchantOperationFetchResult(
            info,
            "failed",
            error instanceof Error ? error.message : "request_failed",
          );
          throw error;
        });
    }) as typeof window.fetch;
    return () => {
      window.fetch = originalFetch;
    };
  }, [isPlatformEditor]);

  useEffect(() => {
    if (checkingAuth) return;
    if (isPlatformEditor || explicitFaollaSectionEntry || !isMerchantNumericId(editingSiteId)) {
      setMerchantBookingAttentionSummary({ count: 0, latest: null });
      setMerchantBusinessAttentionHydrationState((current) => (current.booking ? current : { ...current, booking: true }));
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    const bookingCacheKey = buildMerchantAdminDataCacheKey("bookings", editingSiteId);
    const cachedBookings = readMerchantAdminDataCacheSnapshot<MerchantBookingRecord[]>(bookingCacheKey);
    if (Array.isArray(cachedBookings?.data)) {
      setMerchantBookingAttentionSummary(summarizeMerchantBookingAttention(cachedBookings.data));
      setMerchantBusinessAttentionHydrationState((current) => (current.booking ? current : { ...current, booking: true }));
    }
    const loadMerchantBookingAttention = async () => {
      try {
        const response = await fetch(`/api/bookings?siteId=${encodeURIComponent(editingSiteId)}`, {
          cache: "no-store",
        });
        const json = (await response.json().catch(() => null)) as
          | { ok?: boolean; bookings?: MerchantBookingRecord[] }
          | null;
        if (!response.ok || !json?.ok || !Array.isArray(json.bookings)) {
          throw new Error("booking_attention_failed");
        }
        writeMerchantAdminDataCache(bookingCacheKey, json.bookings);
        if (!cancelled) {
          setMerchantBookingAttentionSummary(summarizeMerchantBookingAttention(json.bookings));
          setMerchantBusinessAttentionHydrationState((current) => (current.booking ? current : { ...current, booking: true }));
        }
      } catch {
        // Keep the last known badge count when the lightweight refresh fails.
      }
    };
    const cancelInitialRefresh = cachedBookings?.fresh
      ? () => {}
      : scheduleAdminIdleTask(() => {
          void loadMerchantBookingAttention();
        }, { timeoutMs: 2400, fallbackDelayMs: 1000 });
    timer = setInterval(() => {
      void loadMerchantBookingAttention();
    }, 60000);
    return () => {
      cancelled = true;
      cancelInitialRefresh();
      if (timer) clearInterval(timer);
    };
  }, [checkingAuth, editingSiteId, explicitFaollaSectionEntry, isPlatformEditor, summarizeMerchantBookingAttention]);

  useEffect(() => {
    if (checkingAuth) return;
    if (isPlatformEditor || explicitFaollaSectionEntry || !isMerchantNumericId(editingSiteId)) {
      setMerchantOrderAttentionSummary({ count: 0, latest: null });
      setMerchantBusinessAttentionHydrationState((current) => (current.orders ? current : { ...current, orders: true }));
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    const orderCacheKey = buildMerchantAdminDataCacheKey("orders", editingSiteId);
    const cachedOrders = readMerchantAdminDataCacheSnapshot<MerchantOrderRecord[]>(orderCacheKey);
    if (Array.isArray(cachedOrders?.data)) {
      setMerchantOrderAttentionSummary(summarizeMerchantOrderAttention(cachedOrders.data));
      setMerchantBusinessAttentionHydrationState((current) => (current.orders ? current : { ...current, orders: true }));
    }
    const loadMerchantOrderAttention = async () => {
      try {
        const response = await fetch(`/api/orders?siteId=${encodeURIComponent(editingSiteId)}`, {
          cache: "no-store",
          credentials: "same-origin",
        });
        const json = (await response.json().catch(() => null)) as
          | { ok?: boolean; orders?: MerchantOrderRecord[] }
          | null;
        if (!response.ok || !json?.ok || !Array.isArray(json.orders)) {
          if (response.status === 403 && !cancelled) {
            setMerchantOrderAttentionSummary({ count: 0, latest: null });
            setMerchantBusinessAttentionHydrationState((current) => (current.orders ? current : { ...current, orders: true }));
          }
          throw new Error("order_attention_failed");
        }
        writeMerchantAdminDataCache(orderCacheKey, json.orders);
        if (!cancelled) {
          setMerchantOrderAttentionSummary(summarizeMerchantOrderAttention(json.orders));
          setMerchantBusinessAttentionHydrationState((current) => (current.orders ? current : { ...current, orders: true }));
        }
      } catch {
        // Keep the last known badge count when the lightweight refresh fails.
      }
    };
    const cancelInitialRefresh = cachedOrders?.fresh
      ? () => {}
      : scheduleAdminIdleTask(() => {
          void loadMerchantOrderAttention();
        }, { timeoutMs: 2400, fallbackDelayMs: 1000 });
    timer = setInterval(() => {
      void loadMerchantOrderAttention();
    }, 60000);
    return () => {
      cancelled = true;
      cancelInitialRefresh();
      if (timer) clearInterval(timer);
    };
  }, [checkingAuth, editingSiteId, explicitFaollaSectionEntry, isPlatformEditor, summarizeMerchantOrderAttention]);

  useEffect(() => {
    if (isPlatformEditor || typeof window === "undefined" || typeof document === "undefined") return;
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        lastMerchantBackgroundedAtRef.current = Date.now();
        return;
      }
      if (document.visibilityState === "visible" && lastMerchantBackgroundedAtRef.current > 0) {
        lastMerchantResumeAtRef.current = Date.now();
      }
    };
    const handleForeground = () => {
      if (lastMerchantBackgroundedAtRef.current > 0) {
        lastMerchantResumeAtRef.current = Date.now();
      }
    };
    window.addEventListener("focus", handleForeground);
    window.addEventListener("pageshow", handleForeground);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("focus", handleForeground);
      window.removeEventListener("pageshow", handleForeground);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [isPlatformEditor]);
  const merchantDisplayName = !isPlatformEditor
    ? ((editingSite?.merchantName ?? "").trim() || "未设置商户名称")
    : "";
  const currentMerchantChatBusinessCardSyncPayload =
    !isPlatformEditor && editingSiteId && Array.isArray(editingSite?.businessCards) && editingSite.businessCards.length > 0
      ? JSON.stringify({
          merchantId: editingSiteId,
          businessCards: normalizeMerchantBusinessCards(editingSite?.businessCards ?? []),
          chatBusinessCard: resolveMerchantBusinessCardForChatDisplay(editingSite?.businessCards ?? []),
        })
      : "";
  const currentSupportMerchantId = (
    editingSiteId ||
    merchantSessionIdentityRef.current.merchantId ||
    supportThread?.merchantId ||
    ""
  ).trim();
  const latestSupportAdminMessage = [...(supportThread?.messages ?? [])]
    .reverse()
    .find((message) => message.sender === "super_admin") ?? null;
  const latestSupportAdminMessageKey = latestSupportAdminMessage
    ? `${latestSupportAdminMessage.id}:${latestSupportAdminMessage.createdAt}`
    : "";
  const supportReadMerchantId = (supportThread?.merchantId || editingSiteId || "").trim();
  const rememberSupportNotificationEvent = useCallback((eventKey: string) => {
    const normalizedEventKey = eventKey.trim();
    if (!normalizedEventKey || typeof window === "undefined") return true;
    const merchantId = (currentSupportMerchantId || supportReadMerchantId || editingSiteId || "").trim();
    const storageKey = buildSupportNotifiedEventStorageKey(merchantId);
    if (supportNotifiedEventStorageKeyRef.current !== storageKey) {
      supportNotifiedEventStorageKeyRef.current = storageKey;
      supportNotifiedEventKeysRef.current = new Set(readSupportNotifiedEventKeys(merchantId));
    }
    if (supportNotifiedEventKeysRef.current.has(normalizedEventKey)) {
      return true;
    }
    const nextKeys = [...supportNotifiedEventKeysRef.current, normalizedEventKey].slice(-SUPPORT_NOTIFIED_EVENT_LIMIT);
    supportNotifiedEventKeysRef.current = new Set(nextKeys);
    writeSupportNotifiedEventKeys(merchantId, nextKeys);
    return false;
  }, [currentSupportMerchantId, editingSiteId, supportReadMerchantId]);
  const latestSupportAdminMessageAt = normalizeSupportMessageTimestamp(
    latestSupportAdminMessage?.createdAt,
  );
  const officialVisibleSupportMessages = useMemo(
    () =>
      [
        ...(supportThread?.messages ?? []).map((message) => ({
          ...message,
          localStatus: null as LocalSupportMessageStatus | null,
          isSelf: message.sender === "merchant",
          senderLabel: message.sender === "merchant" ? "我" : "Faolla",
        })),
        ...supportLocalMessages
          .filter((message) => message.merchantId === supportReadMerchantId)
          .map((message) => ({
            ...message,
            localStatus: message.status,
            isSelf: true,
            senderLabel: "我",
          })),
      ].sort(compareSupportMessages),
    [supportLocalMessages, supportReadMerchantId, supportThread?.messages],
  );
  const supportOfficialName = "Faolla";
  const supportOfficialSiteLabel = "www.faolla.com";
  const supportOfficialBadgeLabel = "官方";
  const selectedSupportPeerMerchantId = supportSelectedContactKey.startsWith("merchant:")
    ? supportSelectedContactKey.slice("merchant:".length).trim()
    : "";
  const supportPeerThreadByContactMerchantId = useMemo(() => {
    const map = new Map<string, MerchantPeerThread>();
    if (!currentSupportMerchantId) return map;
    supportPeerThreads.forEach((thread) => {
      let contactMerchantId = "";
      if (thread.merchantAId === currentSupportMerchantId) {
        contactMerchantId = thread.merchantBId;
      } else if (thread.merchantBId === currentSupportMerchantId) {
        contactMerchantId = thread.merchantAId;
      }
      if (contactMerchantId && !map.has(contactMerchantId)) {
        map.set(contactMerchantId, thread);
      }
    });
    return map;
  }, [currentSupportMerchantId, supportPeerThreads]);
  const supportPeerSiteByMerchantId = useMemo(() => {
    const map = new Map<string, Site>();
    if (!merchantPlatformState?.sites?.length) return map;
    merchantPlatformState.sites.forEach((site) => {
      const merchantId = String(site.id ?? "").trim();
      if (/^\d{8}$/.test(merchantId)) {
        map.set(merchantId, site);
      }
    });
    return map;
  }, [merchantPlatformState?.sites]);
  const selectedSupportPeerContact =
    supportPeerContacts.find((contact) => contact.merchantId === selectedSupportPeerMerchantId) ?? null;
  const selectedSupportPeerSite = supportPeerSiteByMerchantId.get(selectedSupportPeerMerchantId) ?? null;
  const selectedSupportFallbackBusinessCard =
    selectedSupportPeerContact?.chatBusinessCard ??
    resolveMerchantBusinessCardForChatDisplay(selectedSupportPeerSite?.businessCards ?? []);
  const selectedSupportFetchedProfile = useMemo(() => {
    if (!/^\d{8}$/.test(selectedSupportPeerMerchantId)) return undefined;
    return Object.prototype.hasOwnProperty.call(supportPeerProfilesByMerchantId, selectedSupportPeerMerchantId)
      ? supportPeerProfilesByMerchantId[selectedSupportPeerMerchantId]
      : undefined;
  }, [selectedSupportPeerMerchantId, supportPeerProfilesByMerchantId]);
  const selectedSupportLocalProfile = useMemo(() => {
    if (!/^\d{8}$/.test(selectedSupportPeerMerchantId) || !selectedSupportPeerSite) return null;
    return buildSupportPublishedProfileFromSite(selectedSupportPeerSite);
  }, [selectedSupportPeerMerchantId, selectedSupportPeerSite]);
  const selectedSupportProfile = selectedSupportFetchedProfile ?? selectedSupportLocalProfile ?? null;
  const selectedSupportBusinessCard =
    supportSelectedContactKey === SUPPORT_OFFICIAL_CONTACT_KEY
      ? null
      : (supportPeerBusinessCardByMerchantId[selectedSupportPeerMerchantId] ?? selectedSupportFallbackBusinessCard);
  const selectedSupportPeerThread =
    currentSupportMerchantId && selectedSupportPeerMerchantId
      ? findMerchantPeerThreadForMerchants(
          {
            contacts: [],
            threads: supportPeerThreads,
          },
          currentSupportMerchantId,
          selectedSupportPeerMerchantId,
        )
      : null;
  const latestSelectedSupportPeerIncomingMessage = useMemo(
    () => findLatestIncomingPeerMessage(selectedSupportPeerThread, currentSupportMerchantId),
    [currentSupportMerchantId, selectedSupportPeerThread],
  );
  const peerVisibleSupportMessages = useMemo(
    () =>
      selectedSupportPeerMerchantId
        ? [
            ...(selectedSupportPeerThread?.messages ?? []).map((message) => ({
              ...message,
              localStatus: null as LocalSupportMessageStatus | null,
              isSelf: message.senderMerchantId === currentSupportMerchantId,
              senderLabel:
                message.senderMerchantId === currentSupportMerchantId
                  ? "我"
                  : selectedSupportPeerContact?.merchantName || selectedSupportPeerMerchantId,
            })),
            ...supportPeerLocalMessages
              .filter((message) => message.contactMerchantId === selectedSupportPeerMerchantId)
              .map((message) => ({
                ...message,
                localStatus: message.status,
                isSelf: true,
                senderLabel: "我",
              })),
          ].sort(compareSupportMessages)
        : [],
    [
      currentSupportMerchantId,
      selectedSupportPeerContact?.merchantName,
      selectedSupportPeerMerchantId,
      selectedSupportPeerThread?.messages,
      supportPeerLocalMessages,
    ],
  );
  const visibleSupportMessages =
    supportSelectedContactKey === SUPPORT_OFFICIAL_CONTACT_KEY ? officialVisibleSupportMessages : peerVisibleSupportMessages;
  const visibleSupportScrollMessages = useMemo<SupportConversationScrollMessage[]>(() => {
    const hiddenMessageKeys = new Set(supportHiddenMessageKeys);
    return visibleSupportMessages
      .map((message) => ({
        key: buildVisibleSupportMessageKey(message),
        createdAt: message.createdAt,
        isSelf: message.isSelf,
      }))
      .filter((message) => !hiddenMessageKeys.has(message.key));
  }, [supportHiddenMessageKeys, visibleSupportMessages]);
  const selectedSupportMessages = visibleSupportMessages.filter((message) => {
    const key = buildVisibleSupportMessageKey(message);
    return supportSelectedMessageKeys.includes(key) && !supportHiddenMessageKeys.includes(key);
  });
  const supportSelectionActive = selectedSupportMessages.length > 0;
  const latestOfficialVisibleSupportMessage =
    officialVisibleSupportMessages[officialVisibleSupportMessages.length - 1] ?? null;
  const latestVisibleSupportMessageKey = visibleSupportScrollMessages[visibleSupportScrollMessages.length - 1]?.key ?? "";
  const selectedSupportDisplayName =
    supportSelectedContactKey === SUPPORT_OFFICIAL_CONTACT_KEY
      ? supportOfficialName
      : selectedSupportPeerContact?.merchantName || selectedSupportPeerMerchantId || "未选择联系人";
  const selectedSupportContactVisibility =
    selectedSupportProfile?.contactVisibility ?? createDefaultMerchantContactVisibility();
  const selectedSupportMerchantEmailRaw =
    normalizeSupportDisplayValue(selectedSupportProfile?.contactEmail) ||
    normalizeSupportDisplayValue(selectedSupportPeerContact?.merchantEmail);
  const selectedSupportMerchantEmail = selectedSupportContactVisibility.emailHidden
    ? "已隐藏"
    : selectedSupportMerchantEmailRaw || "-";
  const selectedSupportMerchantIndustry =
    normalizeSupportDisplayValue(selectedSupportProfile?.industry) || "未设置行业";
  const selectedSupportMerchantCity =
    normalizeSupportDisplayValue(selectedSupportProfile?.location.city) || "-";
  const selectedSupportMerchantPhoneRaw = normalizeSupportDisplayValue(selectedSupportProfile?.contactPhone);
  const selectedSupportMerchantPhone = selectedSupportContactVisibility.phoneHidden
    ? "已隐藏"
    : selectedSupportMerchantPhoneRaw || "-";
  const selectedSupportMerchantPrefix =
    normalizeSupportDisplayValue(selectedSupportProfile?.domainPrefix) ||
    normalizeSupportDisplayValue(selectedSupportProfile?.domainSuffix);
  const selectedSupportAvatarImageUrl =
    supportSelectedContactKey === SUPPORT_OFFICIAL_CONTACT_KEY
      ? ""
      : normalizeSupportDisplayValue(selectedSupportProfile?.chatAvatarImageUrl) ||
        normalizeSupportDisplayValue(selectedSupportPeerContact?.avatarImageUrl) ||
        normalizeSupportDisplayValue(selectedSupportPeerContact?.chatAvatarImageUrl) ||
        normalizeSupportDisplayValue(selectedSupportProfile?.merchantCardImageUrl) ||
        normalizeSupportDisplayValue(selectedSupportPeerSite?.chatAvatarImageUrl) ||
        normalizeSupportDisplayValue(selectedSupportPeerSite?.merchantCardImageUrl);
  const selectedSupportResolvedBusinessCard = selectedSupportProfile?.chatBusinessCard ?? selectedSupportBusinessCard;
  const selectedSupportIsOfficial = supportSelectedContactKey === SUPPORT_OFFICIAL_CONTACT_KEY;
  const selectedSupportPeerIsMerchant =
    !selectedSupportIsOfficial && (selectedSupportPeerContact?.accountType ?? "merchant") === "merchant";
  const selectedSupportSignature =
    selectedSupportIsOfficial
      ? supportOfficialSiteLabel
      : resolveSupportSignatureText(selectedSupportProfile?.signature);
  const selectedSupportSubtitle =
    supportSelectedContactKey === SUPPORT_OFFICIAL_CONTACT_KEY
      ? supportOfficialSiteLabel
      : [selectedSupportPeerMerchantId, selectedSupportMerchantEmail !== "-" ? selectedSupportMerchantEmail : ""]
          .filter(Boolean)
          .join(" | ") || "-";
  const selectedSupportMerchantHeaderIndustry =
    selectedSupportMerchantIndustry !== "-" ? selectedSupportMerchantIndustry : "未设置行业";
  const selectedSupportMerchantWebsiteHref = useMemo(() => {
    const publicBaseDomain = normalizeSupportDisplayValue(process.env.NEXT_PUBLIC_PORTAL_BASE_DOMAIN);
    const explicitDomain =
      normalizeSupportDisplayValue(selectedSupportProfile?.domain) ||
      normalizeSupportDisplayValue(selectedSupportPeerSite?.domain);
    if (selectedSupportPeerMerchantId && selectedSupportMerchantPrefix) {
      const runtimeHref = normalizeSupportExternalUrl(
        buildMerchantFrontendHref(selectedSupportPeerMerchantId, selectedSupportMerchantPrefix),
      );
      if (runtimeHref && !isSupportIpOrLocalHost(runtimeHref)) {
        return runtimeHref;
      }
      if (publicBaseDomain) {
        const publicHref = normalizeSupportExternalUrl(
          buildMerchantFrontendHref(selectedSupportPeerMerchantId, selectedSupportMerchantPrefix, publicBaseDomain),
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
    if (!selectedSupportPeerMerchantId) return "";
    return normalizeSupportExternalUrl(explicitDomain);
  }, [
    selectedSupportMerchantPrefix,
    selectedSupportPeerMerchantId,
    selectedSupportPeerSite?.domain,
    selectedSupportProfile?.domain,
  ]);
  const selectedSupportMerchantWebsiteLabel =
    selectedSupportMerchantWebsiteHref ? formatSupportUrlLabel(selectedSupportMerchantWebsiteHref) : "-";
  const selectedSupportFallbackCardHref = useMemo(
    () =>
      buildSupportFallbackMerchantCardHref({
        merchantId: selectedSupportPeerMerchantId,
        merchantName: selectedSupportDisplayName,
        imageUrl: selectedSupportAvatarImageUrl,
        websiteHref: selectedSupportMerchantWebsiteHref,
        industry: selectedSupportMerchantIndustry,
        contactName:
          normalizeSupportDisplayValue(selectedSupportProfile?.contactName) ||
          normalizeSupportDisplayValue(selectedSupportPeerSite?.contactName) ||
          selectedSupportDisplayName,
        phone:
          normalizeSupportDisplayValue(selectedSupportProfile?.contactPhone) ||
          normalizeSupportDisplayValue(selectedSupportPeerSite?.contactPhone),
        email:
          normalizeSupportDisplayValue(selectedSupportProfile?.contactEmail) ||
          normalizeSupportDisplayValue(selectedSupportPeerContact?.merchantEmail),
        contactAddress:
          normalizeSupportDisplayValue(selectedSupportProfile?.contactAddress) ||
          normalizeSupportDisplayValue(selectedSupportPeerSite?.contactAddress),
        location: selectedSupportProfile?.location ?? selectedSupportPeerSite?.location,
      }),
    [
      selectedSupportAvatarImageUrl,
      selectedSupportDisplayName,
      selectedSupportMerchantIndustry,
      selectedSupportMerchantWebsiteHref,
      selectedSupportPeerContact?.merchantEmail,
      selectedSupportPeerMerchantId,
      selectedSupportPeerSite?.contactAddress,
      selectedSupportPeerSite?.contactName,
      selectedSupportPeerSite?.contactPhone,
      selectedSupportPeerSite?.location,
      selectedSupportProfile?.contactAddress,
      selectedSupportProfile?.contactName,
      selectedSupportProfile?.contactPhone,
      selectedSupportProfile?.contactEmail,
      selectedSupportProfile?.location,
    ],
  );
  const selectedSupportMerchantCardHref = useMemo(
    () =>
      selectedSupportContactVisibility.businessCardHidden
        ? ""
        : buildSupportMerchantCardLink(selectedSupportResolvedBusinessCard) || selectedSupportFallbackCardHref,
    [selectedSupportContactVisibility.businessCardHidden, selectedSupportFallbackCardHref, selectedSupportResolvedBusinessCard],
  );
  const selectedSupportMerchantCardLabel = selectedSupportContactVisibility.businessCardHidden
    ? "已隐藏"
    : selectedSupportMerchantCardHref
      ? formatSupportUrlLabel(selectedSupportMerchantCardHref)
      : "-";
  const selectedSupportMerchantInfoItems = useMemo(() => {
    if (selectedSupportIsOfficial) {
      const officialWebsiteHref = normalizeSupportExternalUrl(supportOfficialSiteLabel, "https://www.faolla.com") || "https://www.faolla.com";
      return [
        { label: "身份", value: supportOfficialBadgeLabel },
        { label: "名称", value: selectedSupportDisplayName },
        {
          label: "官网",
          value: supportOfficialSiteLabel,
          href: officialWebsiteHref,
          openInNewTab: true,
        },
      ];
    }
    return [
      { label: "ID", value: selectedSupportPeerMerchantId || "-" },
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
    ];
  }, [
    selectedSupportDisplayName,
    selectedSupportIsOfficial,
    selectedSupportMerchantCardHref,
    selectedSupportMerchantCardLabel,
    selectedSupportMerchantCity,
    selectedSupportMerchantEmail,
    selectedSupportMerchantPhone,
    selectedSupportMerchantWebsiteHref,
    selectedSupportMerchantWebsiteLabel,
    selectedSupportPeerMerchantId,
    supportOfficialBadgeLabel,
    supportOfficialSiteLabel,
  ]);
  const supportSelfFetchedProfile = useMemo(() => {
    if (!/^\d{8}$/.test(editingSiteId)) return undefined;
    return Object.prototype.hasOwnProperty.call(supportPeerProfilesByMerchantId, editingSiteId)
      ? supportPeerProfilesByMerchantId[editingSiteId]
      : undefined;
  }, [editingSiteId, supportPeerProfilesByMerchantId]);
  const supportSelfFetchedBusinessCard = useMemo(() => {
    if (!/^\d{8}$/.test(editingSiteId)) return undefined;
    return Object.prototype.hasOwnProperty.call(supportPeerBusinessCardByMerchantId, editingSiteId)
      ? supportPeerBusinessCardByMerchantId[editingSiteId]
      : undefined;
  }, [editingSiteId, supportPeerBusinessCardByMerchantId]);
  const supportSelfLocalProfile = useMemo(
    () => (editingSite ? buildSupportPublishedProfileFromSite(editingSite) : null),
    [editingSite],
  );
  const supportSelfProfile = supportSelfFetchedProfile ?? supportSelfLocalProfile ?? null;
  const shouldWarmCurrentMerchantProfile =
    supportSelfFetchedProfile === undefined ||
    merchantProfileDialogOpen ||
    merchantBookingManagerOpen ||
    !hasSupportMerchantProfileCoverage(supportSelfLocalProfile) ||
    !Array.isArray(editingSite?.businessCards) ||
    editingSite.businessCards.length === 0;
  const supportSelfBusinessCards = useMemo(() => {
    return mergeSupportBusinessCardLists(editingSite?.businessCards ?? [], [
      ...(Array.isArray(supportSelfFetchedProfile?.businessCards) ? supportSelfFetchedProfile.businessCards : []),
      ...(supportSelfFetchedBusinessCard ? [supportSelfFetchedBusinessCard] : []),
      ...(supportSelfProfile?.chatBusinessCard ? [supportSelfProfile.chatBusinessCard] : []),
    ]);
  }, [
    editingSite?.businessCards,
    supportSelfFetchedBusinessCard,
    supportSelfFetchedProfile?.businessCards,
    supportSelfProfile?.chatBusinessCard,
  ]);
  const supportSelfCardPickerChoices = supportSelfCardPickerCards ?? supportSelfBusinessCards;
  useEffect(() => {
    setSupportSelfCardPickerCards(null);
  }, [editingSiteId]);
  const supportSelfContactVisibility =
    supportSelfProfile?.contactVisibility ??
    editingSite?.contactVisibility ??
    createDefaultMerchantContactVisibility();
  const supportSelfDisplayName =
    normalizeSupportDisplayValue(supportSelfProfile?.merchantName) ||
    normalizeSupportDisplayValue(supportSelfProfile?.name) ||
    normalizeSupportDisplayValue(editingSite?.merchantName) ||
    normalizeSupportDisplayValue(editingSite?.name) ||
    merchantDisplayName ||
    editingSiteId ||
    "我的资料";
  const supportSelfAvatarLabel = getSupportContactAvatarLabel(supportSelfDisplayName, "我");
  const supportSelfBusinessCardAvatarUrl =
    supportSelfBusinessCards
      .map((card) =>
        normalizeSupportDisplayValue(card.contactPagePublicImageUrl) ||
        normalizeSupportDisplayValue(card.shareImageUrl) ||
        normalizeSupportDisplayValue(card.imageUrl),
      )
      .find(Boolean) ?? "";
  const supportSelfAvatarImageUrl =
    normalizeSupportDisplayValue(supportSelfProfile?.chatAvatarImageUrl) ||
    normalizeSupportDisplayValue(supportSelfProfile?.merchantCardImageUrl) ||
    normalizeSupportDisplayValue(editingSite?.chatAvatarImageUrl) ||
    normalizeSupportDisplayValue(editingSite?.merchantCardImageUrl) ||
    supportSelfBusinessCardAvatarUrl;
  const merchantAccountSwitchCurrentKey = getAccountSwitchEntryKey("merchant", currentSupportMerchantId, currentSupportMerchantId);
  useEffect(() => {
    if (isPlatformEditor || explicitFaollaSectionEntry) return;
    let cancelled = false;
    void recordCurrentAccountSwitchSession({
      displayName: supportSelfDisplayName,
      avatarUrl: supportSelfAvatarImageUrl,
    }).then((entries) => {
      if (!cancelled) setAccountSwitchEntries(entries);
    });
    return () => {
      cancelled = true;
    };
  }, [explicitFaollaSectionEntry, isPlatformEditor, supportSelfAvatarImageUrl, supportSelfDisplayName]);
  const supportSelfWebsiteHref = useMemo(() => {
    const publicBaseDomain = normalizeSupportDisplayValue(process.env.NEXT_PUBLIC_PORTAL_BASE_DOMAIN);
    const merchantId = normalizeSupportDisplayValue(editingSiteId);
    const domainPrefix =
      normalizeSupportDisplayValue(supportSelfProfile?.domainPrefix) ||
      normalizeSupportDisplayValue(supportSelfProfile?.domainSuffix) ||
      normalizeSupportDisplayValue(editingSite?.domainPrefix) ||
      normalizeSupportDisplayValue(editingSite?.domainSuffix);
    const explicitDomain =
      normalizeSupportDisplayValue(supportSelfProfile?.domain) ||
      normalizeSupportDisplayValue(editingSite?.domain);
    if (merchantId && domainPrefix) {
      const runtimeHref = normalizeSupportExternalUrl(buildMerchantFrontendHref(merchantId, domainPrefix));
      if (runtimeHref && !isSupportIpOrLocalHost(runtimeHref)) {
        return runtimeHref;
      }
      if (publicBaseDomain) {
        const publicHref = normalizeSupportExternalUrl(
          buildMerchantFrontendHref(merchantId, domainPrefix, publicBaseDomain),
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
    return normalizeSupportExternalUrl(explicitDomain);
  }, [
    editingSite?.domain,
    editingSite?.domainPrefix,
    editingSite?.domainSuffix,
    editingSiteId,
    supportSelfProfile?.domain,
    supportSelfProfile?.domainPrefix,
    supportSelfProfile?.domainSuffix,
  ]);
  const supportSelfWebsiteLabel =
    supportSelfWebsiteHref ? formatSupportUrlLabel(supportSelfWebsiteHref) : "-";
  const supportSelfQrMerchantId =
    normalizeSupportDisplayValue(editingSiteId) ||
    normalizeSupportDisplayValue(merchantSessionIdentityRef.current.merchantId);
  const [supportSelfQrToken, setSupportSelfQrToken] = useState("");
  useEffect(() => {
    if (supportSelfSectionView !== "qr" || !supportSelfQrMerchantId) {
      setSupportSelfQrToken("");
      return;
    }
    let cancelled = false;
    void fetchFaollaQrToken("merchant", supportSelfQrMerchantId)
      .then((token) => {
        if (!cancelled) setSupportSelfQrToken(token);
      })
      .catch((error) => {
        if (!cancelled) {
          setSupportSelfQrToken("");
          setSupportPeerError(error instanceof Error ? error.message : "二维码令牌获取失败，请稍后重试");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [supportSelfQrMerchantId, supportSelfSectionView]);
  const supportSelfQrUrl = useMemo(() => {
    if (!supportSelfQrMerchantId || !supportSelfQrToken || typeof window === "undefined") return "";
    return buildFaollaQrConnectUrl({
      origin: window.location.origin,
      type: "merchant",
      id: supportSelfQrMerchantId,
      name: supportSelfDisplayName,
      token: supportSelfQrToken,
      url: supportSelfWebsiteHref || new URL(`/site/${supportSelfQrMerchantId}`, window.location.origin).toString(),
    });
  }, [supportSelfDisplayName, supportSelfQrMerchantId, supportSelfQrToken, supportSelfWebsiteHref]);
  const resetSupportSelfQrCode = useCallback(async () => {
    if (!supportSelfQrMerchantId) throw new Error("二维码暂不可用");
    const token = await resetFaollaQrToken("merchant", supportSelfQrMerchantId);
    setSupportSelfQrToken(token);
  }, [supportSelfQrMerchantId]);
  const handleSupportQrScanResult = useCallback((value: string) => {
    void openScannedQrValue(value, window.location.origin, setSupportPeerError);
  }, []);
  const supportMobileBookingSiteId = (
    editingSiteId ||
    merchantSessionIdentityRef.current.merchantId ||
    getSiteIdFromStoreScope(storeScope) ||
    ""
  ).trim();
  useEffect(() => {
    setMerchantEnterpriseTodoCount(0);
  }, [supportMobileBookingSiteId]);
  const supportFaollaFrameSourceHref = supportFaollaFrameHref.trim() || "/";
  const supportFaollaFrameTargetHref = useMemo(
    () =>
      buildFaollaShellHref(
        supportFaollaFrameSourceHref,
        locale,
        typeof window !== "undefined" ? window.location.origin : "https://faolla.com",
      ),
    [locale, supportFaollaFrameSourceHref],
  );
  const supportFaollaRestoreHref = supportFaollaEmbedHref.trim() || "/";
  const supportFaollaRestoreTargetHref = useMemo(
    () =>
      buildFaollaShellHref(
        supportFaollaRestoreHref,
        locale,
        typeof window !== "undefined" ? window.location.origin : "https://faolla.com",
      ),
    [locale, supportFaollaRestoreHref],
  );
  const supportFaollaHomeTargetHref = useMemo(
    () =>
      buildFaollaShellHref(
        "/",
        locale,
        typeof window !== "undefined" ? window.location.origin : "https://faolla.com",
      ),
    [locale],
  );
  const supportMobileFaollaActive = supportMobileHomeTab === "faolla";
  const supportDesktopFaollaActive = merchantDesktopSection === "faolla";
  const supportFaollaActive = supportMobileFaollaActive || supportDesktopFaollaActive;
  const navigateSupportFaollaHome = useCallback(() => {
    setSupportFaollaEmbedHref("/");
    setSupportFaollaFrameHref("/");
    if (typeof window !== "undefined") {
      writeStoredFaollaEntryUrl(supportFaollaHomeTargetHref, window.location.origin);
    }
    if (supportDesktopFaollaFrameRef.current) {
      supportDesktopFaollaFrameRef.current.src = supportFaollaHomeTargetHref;
    }
    if (supportMobileFaollaFrameRef.current) {
      supportMobileFaollaFrameRef.current.src = supportFaollaHomeTargetHref;
    }
  }, [supportFaollaHomeTargetHref]);
  const resetSupportFaollaBackendFrame = useCallback(
    (frame: HTMLIFrameElement | null) => {
      if (typeof window === "undefined") return false;
      const href = readSameOriginFrameHref(frame);
      const normalized = normalizeFaollaEntryUrl(href, window.location.origin, { allowFaollaCrossOrigin: true });
      if (!normalized || !isFaollaBackendShellUrl(normalized, window.location.origin)) return false;

      const now = Date.now();
      if (now - supportFaollaBackendResetAtRef.current < 1200) return true;
      supportFaollaBackendResetAtRef.current = now;
      setSupportFaollaFrameHref(supportFaollaRestoreHref);
      if (frame && frame.src !== supportFaollaRestoreTargetHref) {
        frame.src = supportFaollaRestoreTargetHref;
      }
      return true;
    },
    [supportFaollaRestoreHref, supportFaollaRestoreTargetHref],
  );
  const handleSupportFaollaFrameLoad = useCallback(
    (frame: HTMLIFrameElement | null) => {
      resetSupportFaollaBackendFrame(frame);
    },
    [resetSupportFaollaBackendFrame],
  );
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleSupportFaollaMessage = (event: MessageEvent) => {
      if (!isTrustedFrontendAuthBridgeOrigin(event.origin, window.location.origin)) return;
      const message =
        event.data && typeof event.data === "object" && !Array.isArray(event.data)
          ? (event.data as Record<string, unknown>)
          : null;
      if (message?.type !== FAOLLA_APP_SHELL_LOCATION_MESSAGE) return;
      const href = typeof message.href === "string" ? message.href.trim() : "";
      const normalized = normalizeFaollaEntryUrl(href, window.location.origin, { allowFaollaCrossOrigin: true });
      if (!normalized) return;
      if (isFaollaBackendShellUrl(normalized, window.location.origin)) {
        resetSupportFaollaBackendFrame(supportDesktopFaollaFrameRef.current);
        resetSupportFaollaBackendFrame(supportMobileFaollaFrameRef.current);
        return;
      }
      setSupportFaollaEmbedHref((current) => (current === normalized ? current : normalized));
      writeStoredFaollaEntryUrl(normalized, window.location.origin);
    };
    window.addEventListener("message", handleSupportFaollaMessage);
    return () => {
      window.removeEventListener("message", handleSupportFaollaMessage);
    };
  }, [resetSupportFaollaBackendFrame]);
  const openSupportMobileHomeTab = useCallback((tab: SupportMobileHomeTab) => {
    if (
      supportMobileHomeTabRef.current === "enterprise" &&
      tab !== "enterprise" &&
      supportMobileEnterpriseLeaveGuardRef.current &&
      !supportMobileEnterpriseLeaveGuardRef.current()
    ) {
      return false;
    }
    if (tab === "enterprise") {
      void loadMerchantEnterpriseManager().catch(() => undefined);
      setSupportMobileView("list");
    }
    supportMobileHomeTabRef.current = tab;
    setSupportMobileHomeTab(tab);
    return true;
  }, []);
  const openSupportShuangkouScoreTool = useCallback(() => {
    if (typeof window === "undefined") return;
    const targetUrl = new URL("/admin/tools/shuangkoujifen", window.location.origin).toString();
    const openedWindow = window.open(targetUrl, "_blank");
    if (openedWindow) {
      try {
        openedWindow.opener = null;
        openedWindow.focus();
      } catch {
        // Some mobile browsers restrict access to the opened window.
      }
      return;
    }
    window.location.assign(targetUrl);
  }, []);
  const openSupportTankBattleGame = useCallback(() => {
    if (typeof window === "undefined") return;
    const targetUrl = new URL("/admin/games/tank-battle", window.location.origin).toString();
    const openedWindow = window.open(targetUrl, "_blank");
    if (openedWindow) {
      try {
        openedWindow.opener = null;
        openedWindow.focus();
      } catch {
        // Some mobile browsers restrict access to the opened window.
      }
      return;
    }
    window.location.assign(targetUrl);
  }, []);
  const openSupportNoMercyFlagGame = useCallback(() => {
    if (typeof window === "undefined") return;
    const targetUrl = new URL("/admin/games/bufuzai", window.location.origin).toString();
    const openedWindow = window.open(targetUrl, "_blank");
    if (openedWindow) {
      try {
        openedWindow.opener = null;
        openedWindow.focus();
      } catch {
        // Some mobile browsers restrict access to the opened window.
      }
      return;
    }
    window.location.assign(targetUrl);
  }, []);
  const supportMobileFaollaContent = (
    <div className="support-preserve-light-surface relative min-h-0 flex-1 overflow-hidden bg-white">
      <div className="pointer-events-none absolute left-4 top-[calc(var(--faolla-mobile-safe-top)+0.75rem)] z-10">
        <FaollaHomeButton className="pointer-events-auto h-11 w-11" onClick={navigateSupportFaollaHome} />
      </div>
      <iframe
        ref={supportMobileFaollaFrameRef}
        title="Faolla.com"
        src={supportFaollaFrameTargetHref}
        onLoad={(event) => handleSupportFaollaFrameLoad(event.currentTarget)}
        className="absolute inset-0 h-full w-full border-0 bg-white"
      />
    </div>
  );
  const supportSelfSignature = normalizeSupportDisplayValue(supportSelfProfile?.signature);
  const supportSelfChatBusinessCard =
    resolveMerchantBusinessCardForChatDisplay(supportSelfBusinessCards) ??
    supportSelfFetchedBusinessCard ??
    supportSelfProfile?.chatBusinessCard ??
    null;
  const supportSelfCardHref = useMemo(() => {
    const activeCardId = normalizeSupportDisplayValue(supportSelfChatBusinessCard?.id);
    const resolvedCardHref =
      activeCardId && activeCardId === normalizeSupportDisplayValue(supportSelfResolvedCardId)
        ? normalizeSupportDisplayValue(supportSelfResolvedCardHref)
        : "";
    return resolvedCardHref || buildSupportMerchantCardLink(supportSelfChatBusinessCard);
  }, [supportSelfChatBusinessCard, supportSelfResolvedCardHref, supportSelfResolvedCardId]);
  const supportSelfCardLabel = supportSelfCardHref ? formatSupportUrlLabel(supportSelfCardHref) : "-";
  const effectiveEditingSite = useMemo(() => {
    if (!editingSite) return null;
    const mergedSite = mergeSupportPublishedProfileIntoSite(editingSite, supportSelfFetchedProfile ?? supportSelfProfile);
    return {
      ...mergedSite,
      businessCards:
        supportSelfBusinessCards.length > 0
          ? supportSelfBusinessCards
          : normalizeMerchantBusinessCards(mergedSite.businessCards ?? []),
    };
  }, [editingSite, supportSelfBusinessCards, supportSelfFetchedProfile, supportSelfProfile]);
  const effectiveMerchantDisplayName = !isPlatformEditor
    ? ((effectiveEditingSite?.merchantName ?? "").trim() || merchantDisplayName)
    : "";
  const selectedSupportLoading =
    supportSelectedContactKey === SUPPORT_OFFICIAL_CONTACT_KEY ? supportLoading : supportPeerLoading;
  const selectedSupportEmptyStateText =
    supportSelectedContactKey === SUPPORT_OFFICIAL_CONTACT_KEY
      ? "还没有留言记录，可以直接在下方给 Faolla 留言。"
      : "还没有聊天记录，可以直接在下方发送第一条消息。";
  const selectedSupportInputPlaceholder = "";
  const selectedSupportSendButtonLabel =
    supportSelectedContactKey === SUPPORT_OFFICIAL_CONTACT_KEY ? "发送留言" : "发送消息";
  const supportComposerAvailable =
    supportSelectedContactKey === SUPPORT_OFFICIAL_CONTACT_KEY || !!selectedSupportPeerContact;
  const supportComposerBusy = supportSending || supportAttachmentBusy;
  const supportCanSend = (!!supportDraft.trim() || supportPendingImageDrafts.length > 0) && supportComposerAvailable;
  const supportDesktopPanelOpen =
    !isPlatformEditor && (forceDesktopEditorSidebar || isDesktopEditorSidebar) && merchantDesktopSection === "support";
  const supportInterfaceOpen = supportDialogOpen || isMobileMerchantSupportOnlyMode || supportDesktopPanelOpen;
  const isMobileSupportDialog = supportInterfaceOpen && !supportDesktopPanelOpen && !isPlatformEditor && !isDesktopEditorSidebar;
  const isIosSupportBrowser =
    typeof navigator !== "undefined" && /iPhone|iPad|iPod/i.test(String(navigator.userAgent ?? ""));
  const selectedSupportConversationVisible = !isMobileSupportDialog || supportMobileView === "thread";
  const selectedSupportReadStateHydrated = selectedSupportIsOfficial
    ? supportReadStateHydrated.official
    : supportReadStateHydrated.peer;
  const selectedSupportConversationKey = selectedSupportIsOfficial
    ? (supportReadMerchantId || currentSupportMerchantId || editingSiteId).trim()
      ? `official:${(supportReadMerchantId || currentSupportMerchantId || editingSiteId).trim()}`
      : ""
    : currentSupportMerchantId && selectedSupportPeerMerchantId
      ? `peer:${currentSupportMerchantId}:${selectedSupportPeerMerchantId}`
      : "";
  const selectedSupportAvatarLabel = getSupportContactAvatarLabel(
    selectedSupportDisplayName,
    selectedSupportIsOfficial ? "FA" : "商",
  );
  const selectedSupportHeaderMeta = selectedSupportSignature;
  useEffect(() => {
    if (supportInterfaceOpen) return;
    setSupportImagePreview(null);
    setSupportPendingImageDrafts([]);
  }, [supportInterfaceOpen]);

  useEffect(() => {
    if (!isMobileSupportDialog || typeof document === "undefined") return () => {};
    const html = document.documentElement;
    const body = document.body;
    const userAgent = typeof navigator !== "undefined" ? String(navigator.userAgent ?? "") : "";
    const applyFixedBodyLock = /Android/i.test(userAgent);
    const scrollY = typeof window !== "undefined" ? window.scrollY : 0;
    const previousHtmlOverflow = html.style.overflow;
    const previousHtmlOverscrollBehavior = html.style.overscrollBehavior;
    const previousBodyOverflow = body.style.overflow;
    const previousBodyOverscrollBehavior = body.style.overscrollBehavior;
    const previousBodyPosition = body.style.position;
    const previousBodyTop = body.style.top;
    const previousBodyLeft = body.style.left;
    const previousBodyRight = body.style.right;
    const previousBodyWidth = body.style.width;
    html.style.overflow = "hidden";
    html.style.overscrollBehavior = "none";
    body.style.overflow = "hidden";
    body.style.overscrollBehavior = "none";
    if (applyFixedBodyLock) {
      body.style.position = "fixed";
      body.style.top = `${-scrollY}px`;
      body.style.left = "0";
      body.style.right = "0";
      body.style.width = "100%";
    }
    return () => {
      html.style.overflow = previousHtmlOverflow;
      html.style.overscrollBehavior = previousHtmlOverscrollBehavior;
      body.style.overflow = previousBodyOverflow;
      body.style.overscrollBehavior = previousBodyOverscrollBehavior;
      body.style.position = previousBodyPosition;
      body.style.top = previousBodyTop;
      body.style.left = previousBodyLeft;
      body.style.right = previousBodyRight;
      body.style.width = previousBodyWidth;
      if (applyFixedBodyLock && typeof window !== "undefined") {
        window.scrollTo({ top: scrollY, left: 0, behavior: "auto" });
      }
    };
  }, [isMobileSupportDialog]);

  const supportPeerUnreadMessageCountByContactId = useMemo(() => {
    const unreadCountByContactId = new Map<string, number>();
    if (!currentSupportMerchantId || !supportReadStateHydrated.peer) return unreadCountByContactId;
    supportPeerContacts.forEach((contact) => {
      const thread = supportPeerThreadByContactMerchantId.get(contact.merchantId);
      if (!thread) return;
      const lastReadAt = normalizeSupportMessageTimestamp(supportPeerLastReadMap[contact.merchantId]);
      const lastReadTimestamp = new Date(lastReadAt || 0).getTime();
      const unreadCount = thread.messages.reduce((count, message) => {
        if (message.senderMerchantId === currentSupportMerchantId) return count;
        const createdAt = new Date(normalizeSupportMessageTimestamp(message.createdAt) || 0).getTime();
        return createdAt > lastReadTimestamp ? count + 1 : count;
      }, 0);
      if (unreadCount > 0) {
        unreadCountByContactId.set(contact.merchantId, unreadCount);
      }
    });
    return unreadCountByContactId;
  }, [currentSupportMerchantId, supportPeerContacts, supportPeerLastReadMap, supportPeerThreadByContactMerchantId, supportReadStateHydrated.peer]);
  const supportPeerUnreadContactIds = useMemo(
    () => new Set(supportPeerUnreadMessageCountByContactId.keys()),
    [supportPeerUnreadMessageCountByContactId],
  );
  const supportUnreadOfficialMessageCount = useMemo(() => {
    if (!supportReadMerchantId || !supportReadStateHydrated.official) return 0;
    const lastReadTimestamp = new Date(supportLastReadAt || 0).getTime();
    return (supportThread?.messages ?? []).reduce((count, message) => {
      if (message.sender !== "super_admin") return count;
      const createdAt = new Date(normalizeSupportMessageTimestamp(message.createdAt) || 0).getTime();
      return createdAt > lastReadTimestamp ? count + 1 : count;
    }, 0);
  }, [supportLastReadAt, supportReadMerchantId, supportThread?.messages, supportReadStateHydrated.official]);
  const supportHasUnreadOfficialMessages = supportUnreadOfficialMessageCount > 0;
  const supportUnreadPeerMessageCount = useMemo(() => {
    if (!currentSupportMerchantId || !supportReadStateHydrated.peer) return 0;
    return [...supportPeerUnreadMessageCountByContactId.values()].reduce((sum, count) => sum + count, 0);
  }, [currentSupportMerchantId, supportPeerUnreadMessageCountByContactId, supportReadStateHydrated.peer]);
  const merchantBusinessAttentionCount = merchantBookingAttentionSummary.count + merchantOrderAttentionSummary.count;
  const merchantBusinessAttentionHydrated =
    merchantBusinessAttentionHydrationState.booking && merchantBusinessAttentionHydrationState.orders;
  const supportUnreadBadgeCount = supportUnreadOfficialMessageCount + supportUnreadPeerMessageCount;
  const supportTotalBadgeCount = supportUnreadBadgeCount + merchantBusinessAttentionCount;
  const supportUnreadStateHydrated =
    supportUnreadHydrationState.official &&
    supportUnreadHydrationState.peer &&
    supportReadStateHydrated.official &&
    supportReadStateHydrated.peer &&
    merchantBusinessAttentionHydrated;
  const supportEffectiveBadgeCount =
    supportUnreadStateHydrated
      ? supportTotalBadgeCount
      : Math.max(supportTotalBadgeCount, supportPushBadgeHydrated ? supportRemoteBadgeCount : 0);
  const latestSupportAdminNotificationPayload = useMemo(
    () =>
      latestSupportAdminMessage
        ? {
            title: "Faolla 官方回复",
            body: buildSupportNativeNotificationBody(latestSupportAdminMessage.text),
            url: buildSupportNativeNotificationUrl(supportReadMerchantId || currentSupportMerchantId, "official"),
            badgeCount: supportEffectiveBadgeCount,
          }
        : null,
    [currentSupportMerchantId, latestSupportAdminMessage, supportEffectiveBadgeCount, supportReadMerchantId],
  );
  const latestIncomingPeerNotificationPayload = useMemo(() => {
    let latestPayload: { title: string; body: string; url: string; badgeCount: number } | null = null;
    let latestTimestamp = 0;
    if (!currentSupportMerchantId) return latestPayload;
    supportPeerThreads.forEach((thread) => {
      const latestIncomingMessage = findLatestIncomingPeerMessage(thread, currentSupportMerchantId);
      if (!latestIncomingMessage) return;
      const contactMerchantId =
        thread.merchantAId === currentSupportMerchantId
          ? thread.merchantBId
          : thread.merchantBId === currentSupportMerchantId
            ? thread.merchantAId
            : "";
      if (!contactMerchantId) return;
      const timestamp = new Date(latestIncomingMessage.createdAt).getTime();
      const normalizedTimestamp = Number.isFinite(timestamp) ? timestamp : 0;
      if (normalizedTimestamp < latestTimestamp) return;
      const contactName =
        supportPeerContacts.find((contact) => contact.merchantId === contactMerchantId)?.merchantName ||
        contactMerchantId;
      latestTimestamp = normalizedTimestamp;
      latestPayload = {
        title: `新消息 - ${contactName}`,
        body: buildSupportNativeNotificationBody(latestIncomingMessage.text),
        url: buildSupportNativeNotificationUrl(currentSupportMerchantId, `merchant:${contactMerchantId}`),
        badgeCount: supportEffectiveBadgeCount,
      };
    });
    return latestPayload;
  }, [currentSupportMerchantId, supportEffectiveBadgeCount, supportPeerContacts, supportPeerThreads]);
  const latestMerchantBusinessAttention = useMemo(
    () =>
      compareMerchantBusinessAttentionNotification(
        merchantBookingAttentionSummary.latest,
        merchantOrderAttentionSummary.latest,
      ),
    [merchantBookingAttentionSummary.latest, merchantOrderAttentionSummary.latest],
  );
  const latestMerchantBusinessNotificationPayload = useMemo(
    () =>
      latestMerchantBusinessAttention
        ? {
            title: latestMerchantBusinessAttention.title,
            body: latestMerchantBusinessAttention.body,
            url: latestMerchantBusinessAttention.url,
            badgeCount: supportEffectiveBadgeCount,
          }
        : null,
    [latestMerchantBusinessAttention, supportEffectiveBadgeCount],
  );
  const supportLatestNativeNotificationKey = useMemo(() => {
    let latestKey = "";
    let latestTimestamp = 0;
    if (latestSupportAdminMessage) {
      const timestamp = new Date(latestSupportAdminMessage.createdAt).getTime();
      if (Number.isFinite(timestamp)) {
        latestTimestamp = timestamp;
        latestKey = `official:${latestSupportAdminMessage.id}:${latestSupportAdminMessage.createdAt}`;
      }
    }
    if (!currentSupportMerchantId) return latestKey;
    supportPeerThreads.forEach((thread) => {
      const latestIncomingMessage = findLatestIncomingPeerMessage(thread, currentSupportMerchantId);
      if (!latestIncomingMessage) return;
      const contactMerchantId =
        thread.merchantAId === currentSupportMerchantId
          ? thread.merchantBId
          : thread.merchantBId === currentSupportMerchantId
            ? thread.merchantAId
            : "";
      if (!contactMerchantId) return;
      const timestamp = new Date(latestIncomingMessage.createdAt).getTime();
      if (!Number.isFinite(timestamp)) return;
      const nextKey = `peer:${contactMerchantId}:${latestIncomingMessage.id}:${latestIncomingMessage.createdAt}`;
      if (timestamp > latestTimestamp || (timestamp === latestTimestamp && nextKey > latestKey)) {
        latestTimestamp = timestamp;
        latestKey = nextKey;
      }
    });
    if (latestMerchantBusinessAttention) {
      const timestamp = new Date(latestMerchantBusinessAttention.createdAt).getTime();
      if (Number.isFinite(timestamp)) {
        const nextKey = latestMerchantBusinessAttention.key;
        if (timestamp > latestTimestamp || (timestamp === latestTimestamp && nextKey > latestKey)) {
          latestTimestamp = timestamp;
          latestKey = nextKey;
        }
      }
    }
    return latestKey;
  }, [currentSupportMerchantId, latestMerchantBusinessAttention, latestSupportAdminMessage, supportPeerThreads]);
  const supportHasUnreadMessages = supportUnreadBadgeCount > 0;
  const supportContactRows: SupportContactRow[] = [
    {
      key: SUPPORT_OFFICIAL_CONTACT_KEY,
      name: supportOfficialName,
      badge: supportOfficialBadgeLabel,
      unreadCount: supportUnreadOfficialMessageCount,
      subtitle: supportOfficialSiteLabel,
      preview:
        formatSupportConversationPreview(latestOfficialVisibleSupportMessage?.text) ||
        "还没有留言记录，可以直接在右侧给 Faolla 留言。",
      updatedAt: latestOfficialVisibleSupportMessage?.createdAt || "",
      unread: supportHasUnreadOfficialMessages,
      avatarLabel: getSupportContactAvatarLabel(supportOfficialName, "FA"),
      avatarImageUrl: "",
      isOfficial: true,
    },
    ...supportPeerContacts.map((contact): SupportContactRow => {
      const localSite = supportPeerSiteByMerchantId.get(contact.merchantId) ?? null;
      const localProfile = localSite ? buildSupportPublishedProfileFromSite(localSite) : null;
      const fetchedProfile = Object.prototype.hasOwnProperty.call(supportPeerProfilesByMerchantId, contact.merchantId)
        ? supportPeerProfilesByMerchantId[contact.merchantId]
        : undefined;
      const mergedProfile = fetchedProfile ?? localProfile ?? null;
      return {
        key: `merchant:${contact.merchantId}`,
        name: contact.merchantName || contact.merchantId,
        badge: undefined as string | undefined,
        unreadCount: supportPeerUnreadMessageCountByContactId.get(contact.merchantId) ?? 0,
        subtitle: contact.merchantId,
        preview: formatSupportConversationPreview(contact.lastMessage?.text) || "还没有聊天记录，可以直接开始对话。",
        updatedAt: contact.updatedAt || contact.savedAt,
        unread: supportPeerUnreadContactIds.has(contact.merchantId),
        avatarLabel: getSupportContactAvatarLabel(contact.merchantName || contact.merchantId, "商"),
        avatarImageUrl:
          normalizeSupportDisplayValue(contact.avatarImageUrl) ||
          normalizeSupportDisplayValue(contact.chatAvatarImageUrl) ||
          normalizeSupportDisplayValue(mergedProfile?.chatAvatarImageUrl) ||
          normalizeSupportDisplayValue(mergedProfile?.merchantCardImageUrl),
        accountType: contact.accountType ?? "merchant",
        isOfficial: false,
      };
    }),
  ];
  const supportUnreadConversationCount =
    (supportHasUnreadOfficialMessages ? 1 : 0) + supportPeerUnreadContactIds.size;
  const supportUnreadBadgeLabel = supportUnreadBadgeCount > 99 ? "99+" : String(supportUnreadBadgeCount);
  const mobileSupportContactListSummary =
    supportUnreadConversationCount > 0
      ? `${supportUnreadConversationCount} 个会话有新消息`
      : `全部 ${supportContactRows.length} 个会话已读`;
  const merchantTabBaseTitle =
    `${normalizeSupportDisplayValue(effectiveMerchantDisplayName || merchantDisplayName) || normalizeSupportDisplayValue(editingSiteId) || "FAOLLA"} · FAOLLA`;
  const showMobileSupportThread =
    isMobileSupportDialog &&
    supportMobileView === "thread" &&
    (supportSelectedContactKey === SUPPORT_OFFICIAL_CONTACT_KEY || !!selectedSupportPeerContact);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleMobileSwipeBack = (event: Event) => {
      if (!supportInterfaceOpen || !isMobileSupportDialog) return;
      if (supportMerchantInfoSheetOpen) {
        event.preventDefault();
        setSupportMerchantInfoSheetOpen(false);
        return;
      }
      if (supportMobileView === "thread") {
        event.preventDefault();
        closeMobileSupportThread();
        return;
      }
      if (supportMobileHomeTab === "enterprise") {
        event.preventDefault();
        openSupportMobileHomeTab("conversations");
        return;
      }
      if (supportMobileHomeTab === "self" && supportSelfSectionView !== "home") {
        event.preventDefault();
        if (isFaollaMobileSettingsView(supportSelfSectionView)) {
          setSupportSelfSectionView(getFaollaMobileSettingsBackView(supportSelfSectionView));
        } else {
          setSupportSelfSectionView("home");
        }
        return;
      }
    };
    window.addEventListener(MOBILE_SWIPE_BACK_EVENT, handleMobileSwipeBack);
    return () => {
      window.removeEventListener(MOBILE_SWIPE_BACK_EVENT, handleMobileSwipeBack);
    };
  }, [
    closeMobileSupportThread,
    isMobileSupportDialog,
    openSupportMobileHomeTab,
    supportInterfaceOpen,
    supportMerchantInfoSheetOpen,
    supportMobileHomeTab,
    supportMobileView,
    supportSelfSectionView,
  ]);
  useEffect(() => {
    if (typeof document === "undefined") return;
    const active =
      supportInterfaceOpen &&
      isMobileSupportDialog &&
      (supportMerchantInfoSheetOpen ||
        supportMobileView === "thread" ||
        supportMobileHomeTab === "enterprise" ||
        (supportMobileHomeTab === "self" && supportSelfSectionView !== "home"));
    if (active) {
      document.documentElement.dataset.faollaMobileSwipeBackActive = "true";
      return () => {
        delete document.documentElement.dataset.faollaMobileSwipeBackActive;
      };
    }
    if (document.documentElement.dataset.faollaMobileSwipeBackActive === "true") {
      delete document.documentElement.dataset.faollaMobileSwipeBackActive;
    }
    return undefined;
  }, [
    isMobileSupportDialog,
    supportInterfaceOpen,
    supportMerchantInfoSheetOpen,
    supportMobileHomeTab,
    supportMobileView,
    supportSelfSectionView,
  ]);
  useEffect(() => {
    supportMessageElementByKeyRef.current = {};
  }, [supportSelectedContactKey]);
  const resolvedAdminLocale = useMemo(() => resolveSupportedLocale(locale), [locale]);
  const supportSelfSelectedLanguage = useMemo(
    () => LANGUAGE_OPTIONS.find((item) => item.code === resolvedAdminLocale) ?? LANGUAGE_OPTIONS[0],
    [resolvedAdminLocale],
  );
  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") return;
    const visible = isMobileSupportDialog && (supportMobileHomeTab === "self" || supportMobileHomeTab === "faolla");
    document.documentElement.setAttribute("data-mobile-language-switcher", visible ? "show" : "hide");
    window.dispatchEvent(
      new CustomEvent("merchant-mobile-language-switcher-change", {
        detail: { visible },
      }),
    );
  }, [isMobileSupportDialog, supportMobileHomeTab]);
  useEffect(() => {
    return () => {
      if (typeof window === "undefined" || typeof document === "undefined") return;
      document.documentElement.removeAttribute("data-mobile-language-switcher");
      window.dispatchEvent(
        new CustomEvent("merchant-mobile-language-switcher-change", {
          detail: { visible: false },
        }),
      );
    };
  }, []);
  useEffect(() => {
    if (!isMobileSupportDialog || supportMobileHomeTab !== "self") {
      setSupportSelfLanguageMenuOpen(false);
    }
  }, [isMobileSupportDialog, supportMobileHomeTab]);
  useEffect(() => {
    if (!supportSelfLanguageMenuOpen) return;
    const handlePointerDown = (event: globalThis.MouseEvent | globalThis.TouchEvent) => {
      const target = event.target as Node | null;
      if (
        target &&
        (supportSelfLanguageRootRef.current?.contains(target) || supportSelfLanguageMenuRef.current?.contains(target))
      ) {
        return;
      }
      setSupportSelfLanguageMenuOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSupportSelfLanguageMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown, { passive: true });
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [supportSelfLanguageMenuOpen]);
  useEffect(() => {
    if (!showMobileSupportThread) return;
    const rafId = window.requestAnimationFrame(() => {
      resizeSupportComposerInput();
    });
    return () => {
      window.cancelAnimationFrame(rafId);
    };
  }, [resizeSupportComposerInput, showMobileSupportThread, supportDraft]);
  useEffect(() => {
    if (typeof document === "undefined" || isPlatformEditor) return;
    const nextTitle =
      supportUnreadConversationCount > 0
        ? `(${supportUnreadConversationCount}) ${merchantTabBaseTitle}`
        : merchantTabBaseTitle;
    if (document.title !== nextTitle) {
      document.title = nextTitle;
    }
  }, [isPlatformEditor, merchantTabBaseTitle, supportUnreadConversationCount]);
  const latestIncomingPeerMessageKey = useMemo(() => {
    let latestKey = "";
    let latestTimestamp = 0;
    if (!currentSupportMerchantId) return latestKey;
    supportPeerThreads.forEach((thread) => {
      const latestIncomingMessage = findLatestIncomingPeerMessage(thread, currentSupportMerchantId);
      if (!latestIncomingMessage) return;
      const contactMerchantId =
        thread.merchantAId === currentSupportMerchantId
          ? thread.merchantBId
          : thread.merchantBId === currentSupportMerchantId
            ? thread.merchantAId
            : "";
      if (!contactMerchantId) return;
      const timestamp = new Date(latestIncomingMessage.createdAt).getTime();
      const normalizedTimestamp = Number.isFinite(timestamp) ? timestamp : 0;
      const nextKey = `${contactMerchantId}:${latestIncomingMessage.id}:${latestIncomingMessage.createdAt}`;
      if (
        normalizedTimestamp > latestTimestamp ||
        (normalizedTimestamp === latestTimestamp && nextKey > latestKey)
      ) {
        latestTimestamp = normalizedTimestamp;
        latestKey = nextKey;
      }
    });
    return latestKey;
  }, [currentSupportMerchantId, supportPeerThreads]);
  const latestSelectedSupportPeerIncomingMessageAt = normalizeSupportMessageTimestamp(
    latestSelectedSupportPeerIncomingMessage?.createdAt,
  );

  const ensureMerchantChatSessionReady = useCallback(async () => {
    const applyPayloadIdentity = (payload: Awaited<ReturnType<typeof readMerchantSessionPayload>> | null) => {
      if (!payload || payload.authenticated !== true) return null;
      const merchantIds = readMerchantSessionMerchantIds(payload);
      const merchantId = merchantIds.find((item) => isMerchantNumericId(item)) ?? merchantIds[0] ?? "";
      const email = typeof payload.user?.email === "string" ? payload.user.email.trim() : "";
      if (merchantIds.length > 0) {
        merchantIdsRef.current = mergePreferredMerchantIds(merchantIds, merchantIdsRef.current);
      }
      if (merchantId || email) {
        merchantSessionIdentityRef.current = {
          merchantId,
          email: email || null,
        };
        if (merchantId) {
          setMerchantSiteIdOverride((current) => current || merchantId);
        }
      }
      return payload;
    };

    const cookiePayload = await readMerchantSessionPayload(Math.max(1800, Math.min(5200, AUTH_CHECK_TIMEOUT_MS))).catch(
      () => null,
    );
    const acceptedCookiePayload = applyPayloadIdentity(cookiePayload);
    if (acceptedCookiePayload) return acceptedCookiePayload;

    const recoveredSession = await recoverBrowserSupabaseSessionWithRefresh(
      Math.max(2600, Math.min(8200, AUTH_CHECK_TIMEOUT_MS + 1600)),
    ).catch(() => null);
    if (recoveredSession) {
      const syncedPayload = await syncMerchantSessionCookies(
        recoveredSession,
        Math.max(2200, Math.min(6200, AUTH_CHECK_TIMEOUT_MS)),
      ).catch(() => null);
      const acceptedSyncedPayload = applyPayloadIdentity(syncedPayload);
      if (acceptedSyncedPayload) return acceptedSyncedPayload;
    }

    const retryPayload = await readMerchantSessionPayload(Math.max(1800, Math.min(5200, AUTH_CHECK_TIMEOUT_MS))).catch(
      () => null,
    );
    return applyPayloadIdentity(retryPayload);
  }, []);

  const requestMerchantChatWithSessionRecovery = useCallback(async (path: string, init: RequestInit) => {
    const buildSupportRequestInit = async (allowRecovery: boolean) => {
      const headers = new Headers(init.headers ?? undefined);
      headers.set("accept", "application/json");

      const cachedMerchantId = merchantSessionIdentityRef.current.merchantId.trim();
      const cachedEmail = String(merchantSessionIdentityRef.current.email ?? "").trim();
      const knownSiteId = (
        editingSiteId ||
        getSiteIdFromStoreScope(storeScope) ||
        merchantIdsRef.current.find((item) => isMerchantNumericId(item)) ||
        merchantIdsRef.current[0] ||
        cachedMerchantId ||
        ""
      ).trim();
      const knownEmail = ((editingSite?.contactEmail ?? "").trim() || cachedEmail) ?? "";
      const prefetchedIdentity =
        knownSiteId || knownEmail
          ? null
          : await prefetchMerchantSessionIdentity(Math.max(1600, Math.min(3200, AUTH_CHECK_TIMEOUT_MS))).catch(() => null);
      const siteId =
        (knownSiteId || prefetchedIdentity?.merchantId || "").trim();
      const merchantEmail =
        (knownEmail || String(prefetchedIdentity?.email ?? "").trim()) ?? "";
      if (siteId) {
        headers.set("x-merchant-site-id", siteId);
      }
      if (merchantEmail) {
        headers.set("x-merchant-email", merchantEmail);
      }
      if (merchantDisplayName) {
        headers.set("x-merchant-name", merchantDisplayName);
      }

      if (allowRecovery) {
        await ensureMerchantChatSessionReady();
      }
      const {
        data: { session },
      } = await supabase.auth.getSession().catch(() => ({ data: { session: null } }));
      const accessToken = String(session?.access_token ?? "").trim();
      const refreshToken = String(session?.refresh_token ?? "").trim();
      if (accessToken) {
        headers.set("x-merchant-access-token", accessToken);
      }
      if (refreshToken) {
        headers.set("x-merchant-refresh-token", refreshToken);
      }

      return {
        credentials: "same-origin" as const,
        cache: "no-store" as const,
        ...init,
        headers,
      };
    };

    const sendRequest = async (allowRecovery: boolean) =>
      fetch(path, await buildSupportRequestInit(allowRecovery));

    let response = await sendRequest(false);
    if (response.status !== 401 && response.status !== 403) {
      return response;
    }
    await ensureMerchantChatSessionReady();
    try {
      response = await sendRequest(true);
    } catch {
      return response;
    }
    return response;
  }, [
    editingSite?.contactEmail,
    editingSiteId,
    ensureMerchantChatSessionReady,
    merchantDisplayName,
    prefetchMerchantSessionIdentity,
    storeScope,
  ]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const updateSupportPushState = () => {
      setSupportPushStandalone(isSupportStandaloneDisplayMode());
      setSupportPushPermission(canUseSupportPushInBrowser() ? Notification.permission : "unsupported");
    };
    updateSupportPushState();
    const displayModeQuery = window.matchMedia?.("(display-mode: standalone)");
    const handleVisibilityChange = () => updateSupportPushState();
    displayModeQuery?.addEventListener?.("change", updateSupportPushState);
    window.addEventListener("focus", updateSupportPushState);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      displayModeQuery?.removeEventListener?.("change", updateSupportPushState);
      window.removeEventListener("focus", updateSupportPushState);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || isPlatformEditor || !canUseSupportPushInBrowser()) return;

    let heartbeatTimer: number | null = null;

    const syncVisibility = () => {
      const visible = document.visibilityState === "visible";
      void syncSupportServiceWorkerVisibility(visible);
      if (heartbeatTimer) {
        window.clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
      if (visible) {
        heartbeatTimer = window.setInterval(() => {
          void syncSupportServiceWorkerVisibility(document.visibilityState === "visible");
        }, 10_000);
      }
    };

    syncVisibility();
    const handleVisibilityChange = () => syncVisibility();
    const handlePageHide = () => {
      void syncSupportServiceWorkerVisibility(false);
      if (heartbeatTimer) {
        window.clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleVisibilityChange);
    window.addEventListener("blur", handleVisibilityChange);
    window.addEventListener("pagehide", handlePageHide);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleVisibilityChange);
      window.removeEventListener("blur", handleVisibilityChange);
      window.removeEventListener("pagehide", handlePageHide);
      if (heartbeatTimer) {
        window.clearInterval(heartbeatTimer);
      }
      void syncSupportServiceWorkerVisibility(false);
    };
  }, [isPlatformEditor]);

  useEffect(() => {
    const preferences = readSupportNotificationPreferences(editingSiteId);
    supportNotificationPreferencesKeyRef.current = buildSupportNotificationPreferencesStorageKey(editingSiteId);
    setSupportSystemNotificationsEnabled(preferences.systemNotificationsEnabled);
    setSupportMessageSoundEnabled(preferences.messageSoundEnabled);
    setSupportVibrationEnabled(preferences.vibrationEnabled);
  }, [editingSiteId]);

  useEffect(() => {
    if (supportNotificationPreferencesKeyRef.current !== buildSupportNotificationPreferencesStorageKey(editingSiteId)) return;
    writeSupportNotificationPreferences(editingSiteId, {
      systemNotificationsEnabled: supportSystemNotificationsEnabled,
      messageSoundEnabled: supportMessageSoundEnabled,
      vibrationEnabled: supportVibrationEnabled,
    });
  }, [
    editingSiteId,
    supportMessageSoundEnabled,
    supportSystemNotificationsEnabled,
    supportVibrationEnabled,
  ]);

  useEffect(() => {
    if (!supportSelfSectionResetReadyRef.current) {
      supportSelfSectionResetReadyRef.current = true;
      return;
    }
    if (supportMobileHomeTab !== "self") {
      setSupportSelfSectionView("home");
    }
  }, [supportMobileHomeTab]);

  useEffect(() => {
    if (isPlatformEditor) return;
    supportLastIncomingBusinessAttentionKeyRef.current = "";
    setMerchantBookingAttentionSummary({ count: 0, latest: null });
    setMerchantOrderAttentionSummary({ count: 0, latest: null });
    setMerchantBusinessAttentionHydrationState({
      booking: false,
      orders: false,
    });
    setSupportUnreadHydrationState({
      official: false,
      peer: false,
    });
    setSupportReadStateHydrated({
      official: false,
      peer: false,
    });
  }, [editingSiteId, isPlatformEditor]);

  useEffect(() => {
    const container = supportSelfScrollContainerRef.current;
    if (!container) return;
    const frame = window.requestAnimationFrame(() => {
      container.scrollTop = 0;
    });
    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [supportSelfSectionView]);

  const requestMerchantPushWithSessionRecovery = useCallback(
    (init: RequestInit) => {
      const params = new URLSearchParams();
      const pushSiteId = (
        editingSiteId ||
        getSiteIdFromStoreScope(storeScope) ||
        merchantSessionIdentityRef.current.merchantId ||
        merchantIdsRef.current.find((item) => isMerchantNumericId(item)) ||
        merchantIdsRef.current[0] ||
        ""
      ).trim();
      const pushEmail =
        ((editingSite?.contactEmail ?? "").trim() || String(merchantSessionIdentityRef.current.email ?? "").trim()) ??
        "";
      if (pushSiteId) {
        params.set("siteId", pushSiteId);
      }
      if (pushEmail) {
        params.set("merchantEmail", pushEmail);
      }
      if (merchantDisplayName) {
        params.set("merchantName", merchantDisplayName);
      }
      const path = params.size > 0 ? `/api/merchant-push-subscriptions?${params.toString()}` : "/api/merchant-push-subscriptions";
      let nextInit = init;
      const method = String(init.method ?? "GET").trim().toUpperCase();
      const contentType = new Headers(init.headers ?? undefined).get("content-type") ?? "";
      if (method !== "GET" && typeof init.body === "string" && contentType.toLowerCase().includes("application/json")) {
        try {
          const parsed = JSON.parse(init.body) as Record<string, unknown>;
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            nextInit = {
              ...init,
              body: JSON.stringify({
                ...parsed,
                ...(pushSiteId ? { siteId: pushSiteId } : {}),
                ...(pushEmail ? { merchantEmail: pushEmail } : {}),
                ...(merchantDisplayName ? { merchantName: merchantDisplayName } : {}),
              }),
            };
          }
        } catch {
          nextInit = init;
        }
      }
      const sendDirectPushRequest = () => {
        const headers = new Headers(nextInit.headers ?? undefined);
        headers.set("accept", "application/json");
        headers.delete("x-merchant-site-id");
        headers.delete("x-merchant-email");
        headers.delete("x-merchant-name");
        headers.delete("x-merchant-access-token");
        headers.delete("x-merchant-refresh-token");
        headers.delete("x-merchant-expires-in");
        return fetch(path, {
          credentials: "same-origin" as const,
          cache: "no-store" as const,
          ...nextInit,
          headers,
        });
      };
      return requestMerchantChatWithSessionRecovery(path, nextInit)
        .then((response) => {
          if (response.ok) return response;
          if (![401, 403, 503].includes(response.status)) return response;
          return sendDirectPushRequest().catch(() => response);
        })
        .catch(() => sendDirectPushRequest());
    },
    [editingSite?.contactEmail, editingSiteId, merchantDisplayName, requestMerchantChatWithSessionRecovery, storeScope],
  );

  const sendSupportPushAction = useCallback(
    async (payload: Record<string, unknown>) => {
      const response = await requestMerchantPushWithSessionRecovery({
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      const body = (await response.json().catch(() => null)) as
        | { message?: string; error?: string; endpoint?: string }
        | null;
      if (!response.ok) {
        throw new Error(body?.message || body?.error || "merchant_push_request_failed");
      }
      return body;
    },
    [requestMerchantPushWithSessionRecovery],
  );

  const readSupportPushBadgeSnapshot = useCallback(async () => {
    const response = await requestMerchantPushWithSessionRecovery({
      method: "GET",
      headers: {
        accept: "application/json",
      },
    });
    const body = (await response.json().catch(() => null)) as
      | { subscriptions?: unknown; message?: string; error?: string }
      | null;
    if (!response.ok) {
      throw new Error(body?.message || body?.error || "merchant_push_state_request_failed");
    }
    return normalizeSupportPushSubscriptionSnapshotList(body?.subscriptions);
  }, [requestMerchantPushWithSessionRecovery]);

  const registerSupportPushServiceWorker = useCallback(async () => {
    if (!canUseSupportPushInBrowser()) return null;
    const registration = await navigator.serviceWorker.register(SUPPORT_PUSH_SERVICE_WORKER_PATH, {
      scope: "/",
      updateViaCache: "none",
    });
    return navigator.serviceWorker.ready.catch(() => registration);
  }, []);

  const syncCurrentSupportPushSubscriptionState = useCallback(async () => {
    if (!canUseSupportPushInBrowser()) {
      const nativePermission = readSupportNativeNotificationPermission();
      setSupportPushPermission(nativePermission);
      setSupportPushSubscribed(nativePermission !== "unsupported" && nativePermission !== "denied");
      setSupportPushEndpoint("");
      setSupportRemoteBadgeCount(0);
      setSupportPushBadgeHydrated(true);
      return null;
    }
    const registration = await registerSupportPushServiceWorker();
    if (!registration) {
      setSupportPushBadgeHydrated(true);
      return null;
    }
    const permissionState = Notification.permission;
    const existingSubscription = await registration.pushManager.getSubscription().catch(() => null);
    setSupportPushPermission(permissionState);
    setSupportPushEndpoint(existingSubscription?.endpoint ?? "");
    setSupportPushSubscribed(permissionState === "granted" && Boolean(existingSubscription?.endpoint));
    try {
      const snapshots = await readSupportPushBadgeSnapshot();
      const matchedSnapshot =
        (existingSubscription?.endpoint
          ? snapshots.find((item) => item.endpoint === existingSubscription.endpoint)
          : null) ??
        snapshots[0] ??
        null;
      setSupportRemoteBadgeCount(matchedSnapshot?.badgeCount ?? 0);
    } catch {
      setSupportRemoteBadgeCount(0);
    } finally {
      setSupportPushBadgeHydrated(true);
    }
    return existingSubscription;
  }, [readSupportPushBadgeSnapshot, registerSupportPushServiceWorker]);

  const ensureSupportPushSubscription = useCallback(
    async (options?: { requestPermission?: boolean }) => {
      if (!canUseSupportPushInBrowser()) {
        setSupportPushPermission("unsupported");
        setSupportPushSubscribed(false);
        setSupportPushEndpoint("");
        return null;
      }
      const registration = await registerSupportPushServiceWorker();
      if (!registration) return null;
      let permissionState = Notification.permission;
      if (options?.requestPermission && permissionState !== "granted") {
        permissionState = await Notification.requestPermission();
      }
      setSupportPushPermission(permissionState);
      if (permissionState !== "granted") {
        const existingSubscription = await registration.pushManager.getSubscription().catch(() => null);
        if (existingSubscription?.endpoint) {
          setSupportPushEndpoint(existingSubscription.endpoint);
        }
        setSupportPushSubscribed(false);
        return null;
      }

      const existingSubscription = await registration.pushManager.getSubscription().catch(() => null);
      const subscription =
        existingSubscription ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: decodeSupportPushBase64(readSupportPushPublicKey()),
        }));
      await sendSupportPushAction({
        action: "subscribe",
        permission: permissionState,
        subscription: subscription.toJSON(),
        userAgent: navigator.userAgent,
      });
      setSupportPushSubscribed(true);
      setSupportPushEndpoint(subscription.endpoint);
      setSupportPushError("");
      return subscription;
    },
    [registerSupportPushServiceWorker, sendSupportPushAction],
  );

  const disableSupportPushNotifications = useCallback(async () => {
    if (!canUseSupportPushInBrowser()) {
      setSupportPushSubscribed(false);
      setSupportPushEndpoint("");
      setSupportRemoteBadgeCount(0);
      setSupportPushBadgeHydrated(true);
      return;
    }
    const registration = await registerSupportPushServiceWorker().catch(() => null);
    const existingSubscription = await registration?.pushManager.getSubscription().catch(() => null);
    const endpoint = existingSubscription?.endpoint || supportPushEndpoint;
    if (endpoint) {
      await sendSupportPushAction({
        action: "unsubscribe",
        endpoint,
        permission: supportPushPermission === "unsupported" ? "default" : supportPushPermission,
      }).catch(() => null);
    }
    if (existingSubscription) {
      await existingSubscription.unsubscribe().catch(() => null);
    }
    setSupportPushSubscribed(false);
    setSupportPushEndpoint("");
    setSupportRemoteBadgeCount(0);
    setSupportPushBadgeHydrated(true);
    setSupportPushError("");
  }, [registerSupportPushServiceWorker, sendSupportPushAction, supportPushEndpoint, supportPushPermission]);

  const handleSupportSystemNotificationsToggle = useCallback(
    async (nextEnabled: boolean) => {
      if (supportPushBusy) return;
      setSupportSystemNotificationsEnabled(nextEnabled);
      setSupportPushError("");
      if (!nextEnabled) {
        setSupportPushBusy(true);
        try {
          await disableSupportPushNotifications();
          if (canUseFaollaNativeNotifications()) {
            syncFaollaNativeUnreadBadge(supportEffectiveBadgeCount);
            setSupportPushPermission(readSupportNativeNotificationPermission());
            setSupportPushSubscribed(false);
          }
          showTip("已关闭系统消息通知");
        } catch (error) {
          setSupportSystemNotificationsEnabled(true);
          setSupportPushError(error instanceof Error ? error.message : "关闭系统消息通知失败");
        } finally {
          setSupportPushBusy(false);
        }
        return;
      }
      if (canUseFaollaNativeNotifications()) {
        setSupportPushBusy(true);
        try {
          const nativePermission = requestFaollaNativeNotificationPermission();
          const nextPermission = nativePermission === "unsupported" ? readSupportNativeNotificationPermission() : nativePermission;
          setSupportPushPermission(nextPermission === "unsupported" ? "default" : nextPermission);
          setSupportPushSubscribed(nextPermission !== "denied");
          setSupportPushEndpoint("");
          setSupportPushError(
            nextPermission === "denied" ? "通知已被系统拦截，请在系统设置里允许 Faolla 通知。" : "",
          );
          showTip(nextPermission === "denied" ? "通知未开启" : "已开启系统消息通知");
        } finally {
          setSupportPushBusy(false);
        }
        return;
      }
      if (!canUseSupportPushInBrowser()) {
        setSupportSystemNotificationsEnabled(false);
        setSupportPushError("当前环境暂不支持系统通知。");
        return;
      }
      setSupportPushBusy(true);
      try {
        const subscription = await ensureSupportPushSubscription({ requestPermission: true });
        if (!subscription) {
          setSupportSystemNotificationsEnabled(false);
          if (Notification.permission === "denied") {
            setSupportPushError("系统通知未开启，请在浏览器或系统设置里允许通知。");
          }
          return;
        }
        showTip("已开启系统消息通知");
      } catch (error) {
        setSupportSystemNotificationsEnabled(false);
        setSupportPushError(error instanceof Error ? error.message : "系统消息通知开启失败，请稍后重试");
      } finally {
        setSupportPushBusy(false);
      }
    },
    [
      disableSupportPushNotifications,
      ensureSupportPushSubscription,
      supportEffectiveBadgeCount,
      supportPushBusy,
    ],
  );

  const triggerSupportNotificationFeedback = useCallback(async (notification?: {
    title: string;
    body: string;
    url: string;
    badgeCount: number;
  }) => {
    if (typeof document !== "undefined") {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastMerchantResumeAtRef.current <= 60_000) return;
    }
    const nativeNotificationShown =
      supportSystemNotificationsEnabled &&
      notification &&
      canUseFaollaNativeNotifications() &&
      showFaollaNativeMessageNotification({
        ...notification,
        sound: supportMessageSoundEnabled,
        vibrate: supportVibrationEnabled,
      });
    if (nativeNotificationShown) {
      return;
    }
    if (supportMessageSoundEnabled) {
      await playNotificationSound();
    }
    if (
      supportVibrationEnabled &&
      typeof navigator !== "undefined" &&
      typeof navigator.vibrate === "function"
    ) {
      navigator.vibrate(35);
    }
  }, [
    playNotificationSound,
    supportMessageSoundEnabled,
    supportSystemNotificationsEnabled,
    supportVibrationEnabled,
  ]);

  const requestSupportWithSessionRecovery = useCallback(
    (init: RequestInit) => {
      const params = new URLSearchParams();
      const supportSiteId = (
        editingSiteId ||
        getSiteIdFromStoreScope(storeScope) ||
        merchantSessionIdentityRef.current.merchantId ||
        merchantIdsRef.current.find((item) => isMerchantNumericId(item)) ||
        merchantIdsRef.current[0] ||
        ""
      ).trim();
      const supportEmail =
        ((editingSite?.contactEmail ?? "").trim() || String(merchantSessionIdentityRef.current.email ?? "").trim()) ??
        "";
      if (supportSiteId) {
        params.set("siteId", supportSiteId);
      }
      if (supportEmail) {
        params.set("merchantEmail", supportEmail);
      }
      if (merchantDisplayName) {
        params.set("merchantName", merchantDisplayName);
      }
      const path = params.size > 0 ? `/api/support-messages?${params.toString()}` : "/api/support-messages";
      const sendDirectSupportRequest = () => {
        const headers = new Headers(init.headers ?? undefined);
        headers.set("accept", "application/json");
        headers.delete("x-merchant-site-id");
        headers.delete("x-merchant-email");
        headers.delete("x-merchant-name");
        headers.delete("x-merchant-access-token");
        headers.delete("x-merchant-refresh-token");
        headers.delete("x-merchant-expires-in");
        return fetch(path, {
          credentials: "same-origin" as const,
          cache: "no-store" as const,
          ...init,
          headers,
        });
      };
      return requestMerchantChatWithSessionRecovery(path, init)
        .then((response) => {
          if (response.ok) return response;
          if (![401, 403, 503].includes(response.status)) return response;
          return sendDirectSupportRequest().catch(() => response);
        })
        .catch(() => sendDirectSupportRequest());
    },
    [editingSite?.contactEmail, editingSiteId, merchantDisplayName, requestMerchantChatWithSessionRecovery, storeScope],
  );

  const requestMerchantPeerWithSessionRecovery = useCallback(
    (init: RequestInit, extraParams?: Record<string, string>) => {
      const params = new URLSearchParams();
      const peerSiteId = (
        editingSiteId ||
        getSiteIdFromStoreScope(storeScope) ||
        merchantSessionIdentityRef.current.merchantId ||
        merchantIdsRef.current.find((item) => isMerchantNumericId(item)) ||
        merchantIdsRef.current[0] ||
        ""
      ).trim();
      const peerEmail =
        ((editingSite?.contactEmail ?? "").trim() || String(merchantSessionIdentityRef.current.email ?? "").trim()) ??
        "";
      if (peerSiteId) {
        params.set("siteId", peerSiteId);
      }
      if (peerEmail) {
        params.set("merchantEmail", peerEmail);
      }
      if (merchantDisplayName) {
        params.set("merchantName", merchantDisplayName);
      }
      if (extraParams) {
        Object.entries(extraParams).forEach(([key, value]) => {
          if (value) params.set(key, value);
        });
      }
      const path = params.size > 0 ? `/api/merchant-peer-messages?${params.toString()}` : "/api/merchant-peer-messages";
      let nextInit = init;
      const method = String(init.method ?? "GET").trim().toUpperCase();
      const contentType = new Headers(init.headers ?? undefined).get("content-type") ?? "";
      if (method !== "GET" && typeof init.body === "string" && contentType.toLowerCase().includes("application/json")) {
        try {
          const parsed = JSON.parse(init.body) as Record<string, unknown>;
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            nextInit = {
              ...init,
              body: JSON.stringify({
                ...parsed,
                ...(peerSiteId ? { siteId: peerSiteId } : {}),
                ...(peerEmail ? { merchantEmail: peerEmail } : {}),
                ...(merchantDisplayName ? { merchantName: merchantDisplayName } : {}),
              }),
            };
          }
        } catch {
          nextInit = init;
        }
      }
      const sendDirectPeerRequest = () => {
        const headers = new Headers(nextInit.headers ?? undefined);
        headers.set("accept", "application/json");
        headers.delete("x-merchant-site-id");
        headers.delete("x-merchant-email");
        headers.delete("x-merchant-name");
        headers.delete("x-merchant-access-token");
        headers.delete("x-merchant-refresh-token");
        headers.delete("x-merchant-expires-in");
        return fetch(path, {
          credentials: "same-origin" as const,
          cache: "no-store" as const,
          ...nextInit,
          headers,
        });
      };
      return requestMerchantChatWithSessionRecovery(path, nextInit)
        .then((response) => {
          if (response.ok) return response;
          if (![401, 403, 503].includes(response.status)) return response;
          return sendDirectPeerRequest().catch(() => response);
        })
        .catch(() => sendDirectPeerRequest());
    },
    [editingSite?.contactEmail, editingSiteId, merchantDisplayName, requestMerchantChatWithSessionRecovery, storeScope],
  );

  const requestMerchantChatBusinessCardSync = useCallback(
    (init: RequestInit) => requestMerchantChatWithSessionRecovery("/api/merchant-chat-business-card", init),
    [requestMerchantChatWithSessionRecovery],
  );

  const enqueueMerchantChatBusinessCardSync = useCallback(
    (body: string) => {
      const task = merchantChatBusinessCardSyncQueueRef.current
        .catch(() => undefined)
        .then(async () => {
          let response: Response | null = null;
          for (let attempt = 0; attempt < 2; attempt += 1) {
            response = await requestMerchantChatBusinessCardSync({
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body,
            }).catch(() => null);
            if (response?.ok) return response;
            const shouldRetry =
              attempt === 0 &&
              (!response || response.status === 409 || response.status >= 500);
            if (!shouldRetry) return response;
            await new Promise<void>((resolve) => {
              window.setTimeout(resolve, 250);
            });
          }
          return response;
        });
      merchantChatBusinessCardSyncQueueRef.current = task.then(
        () => undefined,
        () => undefined,
      );
      return task;
    },
    [requestMerchantChatBusinessCardSync],
  );

  const handleSupportMessageImageActivate = useCallback((payload: SupportMessageImageActivatePayload) => {
    setSupportImagePreview({
      rawText: payload.rawText,
      imageUrl: payload.imageUrl,
      linkUrl: payload.linkUrl,
      title: payload.linkUrl ? "名片预览" : "图片预览",
    });
  }, []);

  async function sendSupportAttachmentToPeerRecipient(
    recipientMerchantId: string,
    rawText: string,
    recipientLabel?: string,
  ) {
    if (isPlatformEditor) {
      throw new Error("当前模式暂不支持转发");
    }
    if (supportSendingRef.current) {
      throw new Error("当前正在发送消息，请稍后重试");
    }
    const text = rawText.trim();
    if (!recipientMerchantId || !text) {
      throw new Error("当前图片消息内容不完整，暂时无法转发");
    }

    const response = await requestMerchantPeerWithSessionRecovery({
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action: "send",
        recipientMerchantId,
        text,
        merchantName: merchantDisplayName,
        merchantEmail:
          (editingSite?.contactEmail ?? "").trim() ||
          merchantSessionIdentityRef.current.email ||
          "",
      }),
    });
    const payload = (await response.json().catch(() => null)) as
      | {
          contacts?: MerchantPeerContactSummary[];
          threads?: MerchantPeerThread[];
          message?: string;
        }
      | null;
    if (!response.ok) {
      throw new Error(payload?.message || "转发失败，请稍后重试");
    }

    setSupportPeerContacts(Array.isArray(payload?.contacts) ? payload.contacts : []);
    setSupportPeerThreads(Array.isArray(payload?.threads) ? payload.threads : []);
    setSupportError("");
    showTip(`已转发给 ${recipientLabel || recipientMerchantId}`);
  }

  async function forwardSupportAttachmentToSpecifiedMerchant(query: string, rawText: string) {
    if (isPlatformEditor) {
      throw new Error("当前模式暂不支持转发");
    }
    const normalizedQuery = query.trim();
    if (!normalizedQuery) {
      throw new Error("请输入完整的商户ID或邮箱");
    }

    const searchResponse = await requestMerchantPeerWithSessionRecovery({
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action: "search",
        query: normalizedQuery,
      }),
    });
    const searchPayload = (await searchResponse.json().catch(() => null)) as
      | {
          contacts?: MerchantPeerContactSummary[];
          threads?: MerchantPeerThread[];
          contact?: { merchantId?: string; merchantName?: string } | null;
          message?: string;
        }
      | null;
    if (!searchResponse.ok) {
      throw new Error(searchPayload?.message || "没有找到匹配的商户");
    }

    setSupportPeerContacts(Array.isArray(searchPayload?.contacts) ? searchPayload.contacts : []);
    setSupportPeerThreads(Array.isArray(searchPayload?.threads) ? searchPayload.threads : []);
    const recipientMerchantId = String(searchPayload?.contact?.merchantId ?? "").trim();
    if (!recipientMerchantId) {
      throw new Error("没有找到匹配的商户");
    }
    const recipientLabel = String(searchPayload?.contact?.merchantName ?? "").trim() || recipientMerchantId;
    await sendSupportAttachmentToPeerRecipient(recipientMerchantId, rawText, recipientLabel);
  }

  const requestMerchantChatBusinessCardById = useCallback(
    (merchantId: string, init?: RequestInit) => {
      const params = new URLSearchParams();
      params.set("merchantId", merchantId);
      const cardSiteId = (
        editingSiteId ||
        getSiteIdFromStoreScope(storeScope) ||
        merchantSessionIdentityRef.current.merchantId ||
        merchantIdsRef.current.find((item) => isMerchantNumericId(item)) ||
        merchantIdsRef.current[0] ||
        ""
      ).trim();
      if (cardSiteId) {
        params.set("siteId", cardSiteId);
      }
      const path = `/api/merchant-chat-business-card?${params.toString()}`;
      const sendDirectBusinessCardRequest = () => {
        const headers = new Headers(init?.headers ?? undefined);
        headers.set("accept", "application/json");
        headers.delete("x-merchant-site-id");
        headers.delete("x-merchant-email");
        headers.delete("x-merchant-name");
        headers.delete("x-merchant-access-token");
        headers.delete("x-merchant-refresh-token");
        headers.delete("x-merchant-expires-in");
        return fetch(path, {
          credentials: "same-origin" as const,
          cache: "no-store" as const,
          method: "GET",
          ...init,
          headers,
        });
      };
      return requestMerchantChatWithSessionRecovery(path, {
        method: "GET",
        ...init,
      })
        .then((response) => {
          if (response.ok) return response;
          if (![401, 403, 503].includes(response.status)) return response;
          return sendDirectBusinessCardRequest().catch(() => response);
        })
        .catch(() => sendDirectBusinessCardRequest());
    },
    [editingSiteId, requestMerchantChatWithSessionRecovery, storeScope],
  );

  const persistFetchedMerchantProfileToLocalSite = useCallback(
    (merchantId: string, profile: MerchantListPublishedSite | null | undefined) => {
      if (!profile) return;
      const platformState = loadPlatformState();
      const siteIndex = platformState.sites.findIndex((item) => item.id === merchantId);
      if (siteIndex < 0) return;
      const currentSite = platformState.sites[siteIndex];
      const nextSite = mergeSupportPublishedProfileIntoSite(currentSite, profile);
      if (JSON.stringify(nextSite) === JSON.stringify(currentSite)) return;
      const nextSites = [...platformState.sites];
      nextSites[siteIndex] = nextSite;
      savePlatformState({
        ...platformState,
        sites: nextSites,
      });
    },
    [],
  );

  const hydrateSupportMerchantProfile = useCallback(
    async (
      merchantId: string,
      options?: {
        persistToLocalSite?: boolean;
      },
    ) => {
      const normalizedMerchantId = merchantId.trim();
      if (!/^\d{8}$/.test(normalizedMerchantId)) return null;
      const existingTask = supportPeerProfileTaskByMerchantIdRef.current[normalizedMerchantId];
      if (existingTask) return existingTask;
      const requestStartedAt = Date.now();
      supportPeerProfileLoadingIdsRef.current.add(normalizedMerchantId);
      const task = (async () => {
        try {
          const response = await requestMerchantChatBusinessCardById(normalizedMerchantId, {
            cache: "no-store",
          });
          const payload = (await response.json().catch(() => null)) as
            | {
                profile?: MerchantListPublishedSite | null;
                chatBusinessCard?: MerchantBusinessCardAsset | null;
              }
            | null;
          if (!response.ok) return null;
          if ((supportPeerProfileLocalMutationAtRef.current[normalizedMerchantId] ?? 0) > requestStartedAt) {
            return null;
          }
          const nextProfile = payload?.profile ?? null;
          const nextChatBusinessCard = payload?.chatBusinessCard ?? payload?.profile?.chatBusinessCard ?? null;
          supportPeerProfileFetchedAtRef.current[normalizedMerchantId] = Date.now();
          setSupportPeerProfilesByMerchantId((current) => ({
            ...current,
            [normalizedMerchantId]: nextProfile,
          }));
          setSupportPeerBusinessCardByMerchantId((current) => ({
            ...current,
            [normalizedMerchantId]: nextChatBusinessCard,
          }));
          if (options?.persistToLocalSite) {
            persistFetchedMerchantProfileToLocalSite(normalizedMerchantId, nextProfile);
          }
          return {
            profile: nextProfile,
            chatBusinessCard: nextChatBusinessCard,
          };
        } catch {
          return null;
        } finally {
          supportPeerProfileLoadingIdsRef.current.delete(normalizedMerchantId);
          delete supportPeerProfileTaskByMerchantIdRef.current[normalizedMerchantId];
        }
      })();
      supportPeerProfileTaskByMerchantIdRef.current[normalizedMerchantId] = task;
      return task;
    },
    [persistFetchedMerchantProfileToLocalSite, requestMerchantChatBusinessCardById],
  );
  hydrateSupportMerchantProfileRef.current = hydrateSupportMerchantProfile;

  useEffect(() => {
    if (isPlatformEditor || explicitFaollaSectionEntry || !shouldWarmCurrentMerchantProfile) return;
    const merchantId = editingSiteId.trim();
    if (!/^\d{8}$/.test(merchantId)) return;
    const lastFetchedAt = supportPeerProfileFetchedAtRef.current[merchantId] ?? 0;
    if (Date.now() - lastFetchedAt < SUPPORT_MERCHANT_PROFILE_REFRESH_TTL_MS) return;
    if (supportPeerProfileLoadingIdsRef.current.has(merchantId)) return;
    void hydrateSupportMerchantProfile(merchantId, {
      persistToLocalSite: true,
    });
  }, [
    editingSite?.businessCards,
    editingSiteId,
    hydrateSupportMerchantProfile,
    explicitFaollaSectionEntry,
    isPlatformEditor,
    merchantBookingManagerOpen,
    merchantProfileDialogOpen,
    shouldWarmCurrentMerchantProfile,
    supportSelfLocalProfile,
  ]);

  const ensureSupportBusinessCardShareBundle = useCallback(
    async (card: MerchantBusinessCardAsset) => {
      const shareInput = buildSupportMerchantCardShareInput(card);
      const cachedBundle = supportSelfCardShareBundleRef.current[card.id];
      const cachedShareUrl = normalizeSupportDetailText(cachedBundle?.shareUrl);
      if (
        normalizeSupportDetailText(cachedBundle?.imageUrl) &&
        (card.mode !== "link" || (cachedShareUrl && (await verifySupportShortMerchantCardLink(cachedShareUrl))))
      ) {
        return cachedBundle;
      }

      let imageUrl = normalizeSupportDetailText(cachedBundle?.imageUrl);
      if (!imageUrl) {
        const preferredPreviewUrl = getSupportPreferredBusinessCardPreviewUrl(card);
        if (preferredPreviewUrl && isSupportImageAssetUrl(preferredPreviewUrl)) {
          imageUrl = preferredPreviewUrl;
        } else if (preferredPreviewUrl && isInlineDataImageUrl(preferredPreviewUrl)) {
          const { uploadImageDataUrlToSupabase } = await loadEditorAssetProcessing();
          imageUrl =
            (await uploadImageDataUrlToSupabase(
              preferredPreviewUrl,
              (
                editingSiteId ||
                merchantSessionIdentityRef.current.merchantId ||
                supportReadMerchantId ||
                merchantDisplayName ||
                "public"
              ).trim(),
              "business-card-export",
              {
                skipOperationLog: true,
              },
            )) ?? "";
        }
      }
      if (!imageUrl) {
        imageUrl = normalizeSupportDetailText(shareInput?.imageUrl) || normalizeSupportDetailText(card.imageUrl);
      }

      if (card.mode !== "link") {
        const nextBundle = {
          shareUrl: "",
          shareKey: normalizeSupportDetailText(card.shareKey),
          imageUrl,
        };
        if (imageUrl) {
          supportSelfCardShareBundleRef.current[card.id] = nextBundle;
        }
        return nextBundle;
      }

      if (!shareInput?.targetUrl || !imageUrl) {
        const nextBundle = {
          shareUrl: "",
          shareKey: "",
          imageUrl,
        };
        if (imageUrl) {
          supportSelfCardShareBundleRef.current[card.id] = nextBundle;
        }
        return nextBundle;
      }

      try {
        const response = await requestMerchantChatWithSessionRecovery("/api/business-card-share", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            merchantId: (
              editingSiteId ||
              merchantSessionIdentityRef.current.merchantId ||
              supportReadMerchantId ||
              ""
            ).trim(),
            key: shareInput.shareKey,
            name: shareInput.name,
            imageUrl,
            detailImageUrl: shareInput.detailImageUrl,
            detailImageHeight:
              typeof shareInput.detailImageHeight === "number"
                ? Math.round(shareInput.detailImageHeight)
                : undefined,
            introVideoUrl: shareInput.introVideoUrl || undefined,
            introPosterUrl: shareInput.introPosterUrl || undefined,
            introVideoMuted: shareInput.introVideoMuted,
            targetUrl: shareInput.targetUrl,
            contact: shareInput.contact,
          }),
        });
        const payload = (await response.json().catch(() => null)) as
          | {
              shareKey?: unknown;
              shareUrl?: unknown;
            }
          | null;
        const shareUrlRaw = typeof payload?.shareUrl === "string" ? payload.shareUrl.trim() : "";
        const shareUrl =
          isSupportShortMerchantCardLink(shareUrlRaw) && (await verifySupportShortMerchantCardLink(shareUrlRaw))
            ? shareUrlRaw
            : "";
        const shareKey = typeof payload?.shareKey === "string" ? payload.shareKey.trim() : "";
        const nextBundle = {
          shareUrl,
          shareKey,
          imageUrl,
        };
        if (imageUrl || shareUrl) {
          supportSelfCardShareBundleRef.current[card.id] = nextBundle;
        }
        return nextBundle;
      } catch {
        const nextBundle = {
          shareUrl: "",
          shareKey: "",
          imageUrl,
        };
        if (imageUrl) {
          supportSelfCardShareBundleRef.current[card.id] = nextBundle;
        }
        return nextBundle;
      }
    },
    [editingSiteId, merchantDisplayName, requestMerchantChatWithSessionRecovery, supportReadMerchantId],
  );

  useEffect(() => {
    const activeCard = supportSelfChatBusinessCard;
    if (!activeCard || activeCard.mode !== "link") {
      setSupportSelfResolvedCardHref("");
      setSupportSelfResolvedCardId("");
      return;
    }
    let cancelled = false;
    void (async () => {
      const builtHref = buildSupportMerchantCardLink(activeCard);
      const fallbackHref =
        isSupportShortMerchantCardLink(builtHref) && (await verifySupportShortMerchantCardLink(builtHref))
          ? normalizeSupportDisplayValue(builtHref)
          : "";
      if (!cancelled && fallbackHref) {
        setSupportSelfResolvedCardHref(fallbackHref);
        setSupportSelfResolvedCardId(activeCard.id);
      }
      const shareBundle = await ensureSupportBusinessCardShareBundle(activeCard).catch(() => null);
      if (cancelled) return;
      const nextHref = normalizeSupportDisplayValue(shareBundle?.shareUrl) || fallbackHref;
      setSupportSelfResolvedCardHref(nextHref);
      setSupportSelfResolvedCardId(nextHref ? activeCard.id : "");
    })();
    return () => {
      cancelled = true;
    };
  }, [ensureSupportBusinessCardShareBundle, supportSelfChatBusinessCard]);

  const scheduleMerchantChatBusinessCardSync = useCallback(
    (merchantId: string, cards: MerchantBusinessCardAsset[]) => {
      if (typeof window === "undefined") return;
      const normalizedMerchantId = String(merchantId ?? "").trim();
      if (!normalizedMerchantId) return;
      const normalizedCards = normalizeMerchantBusinessCards(cards);
      const body = JSON.stringify({
        merchantId: normalizedMerchantId,
        businessCards: normalizedCards,
        chatBusinessCard: resolveMerchantBusinessCardForChatDisplay(normalizedCards),
      });
      if (merchantChatBusinessCardSyncTimerRef.current) {
        clearTimeout(merchantChatBusinessCardSyncTimerRef.current);
        merchantChatBusinessCardSyncTimerRef.current = null;
      }
      merchantChatBusinessCardSyncTimerRef.current = window.setTimeout(() => {
        void (async () => {
          const response = await enqueueMerchantChatBusinessCardSync(body);
          if (response?.ok) {
            merchantChatBusinessCardSyncPayloadRef.current = body;
          }
        })();
      }, 500);
    },
    [enqueueMerchantChatBusinessCardSync],
  );

  useEffect(() => {
    if (merchantChatBusinessCardSyncTimerRef.current) {
      clearTimeout(merchantChatBusinessCardSyncTimerRef.current);
      merchantChatBusinessCardSyncTimerRef.current = null;
    }
    if (
      isPlatformEditor ||
      explicitFaollaSectionEntry ||
      typeof window === "undefined" ||
      !currentMerchantChatBusinessCardSyncPayload ||
      !editingSiteId
    ) {
      return;
    }
    if (merchantChatBusinessCardSyncPayloadRef.current === currentMerchantChatBusinessCardSyncPayload) return;
    const body = currentMerchantChatBusinessCardSyncPayload;
    merchantChatBusinessCardSyncTimerRef.current = window.setTimeout(() => {
      void (async () => {
        const response = await enqueueMerchantChatBusinessCardSync(body);
        if (response?.ok) {
          merchantChatBusinessCardSyncPayloadRef.current = body;
        }
      })();
    }, 500);
    return () => {
      if (merchantChatBusinessCardSyncTimerRef.current) {
        clearTimeout(merchantChatBusinessCardSyncTimerRef.current);
        merchantChatBusinessCardSyncTimerRef.current = null;
      }
    };
  }, [
    currentMerchantChatBusinessCardSyncPayload,
    editingSiteId,
    explicitFaollaSectionEntry,
    isPlatformEditor,
    enqueueMerchantChatBusinessCardSync,
  ]);

  const loadSupportThread = useCallback(async (options?: { silent?: boolean; suppressError?: boolean }) => {
    if (isPlatformEditor) return;
    const silent = options?.silent === true;
    const suppressError = options?.suppressError === true;
    const supportThreadCacheKey = buildMerchantAdminDataCacheKey("support-thread", editingSiteId);
    let usedCachedSupportThread = false;
    if (!silent && editingSiteId) {
      const cachedThread = readMerchantAdminDataCache<PlatformSupportThread | null>(supportThreadCacheKey);
      if (cachedThread !== null) {
        setSupportThread(cachedThread);
        setSupportUnreadHydrationState((current) => (current.official ? current : { ...current, official: true }));
        usedCachedSupportThread = true;
      }
    }
    if (silent && supportSendingRef.current) return;
    const requestId = ++supportRequestIdRef.current;
    if (!silent) {
      setSupportLoading(!usedCachedSupportThread);
      setSupportError("");
    }
    try {
      const response = await requestSupportWithSessionRecovery({
        method: "GET",
      });
      const payload = (await response.json().catch(() => null)) as
        | {
            thread?: PlatformSupportThread | null;
            readState?: {
              officialLastReadAt?: string | null;
            } | null;
            error?: string;
          }
        | null;
      if (requestId !== supportRequestIdRef.current) return;
      if (!response.ok) {
        if (!suppressError) {
          setSupportError(payload?.error === "unauthorized" ? "当前未登录，请重新登录后再联系我们" : "留言记录加载失败，请稍后重试");
        }
        return;
      }
      if (!suppressError) {
        setSupportError("");
      }
      const nextThread = payload?.thread ?? null;
      const readStateMerchantId = (nextThread?.merchantId || supportReadMerchantId || editingSiteId || "").trim();
      const remoteLastReadAt = normalizeSupportMessageTimestamp(payload?.readState?.officialLastReadAt ?? "");
      const localLastReadAt = readStateMerchantId ? readLocalSupportLastReadAt(readStateMerchantId) : "";
      const nextLastReadAt = selectLatestSupportReadTimestamp(remoteLastReadAt, localLastReadAt);
      if (readStateMerchantId && nextLastReadAt) {
        writeLocalSupportLastReadAt(readStateMerchantId, nextLastReadAt);
      }
      writeMerchantAdminDataCache(supportThreadCacheKey, nextThread);
      setSupportThread(nextThread);
      setSupportLastReadAt((current) => (current === nextLastReadAt ? current : nextLastReadAt));
      setSupportReadStateHydrated((current) => (current.official ? current : { ...current, official: true }));
      setSupportUnreadHydrationState((current) => (current.official ? current : { ...current, official: true }));
      if (isSupportReadTimestampNewer(localLastReadAt, remoteLastReadAt)) {
        void requestSupportWithSessionRecovery({
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            action: "mark_read",
            lastReadAt: localLastReadAt,
          }),
        }).catch(() => null);
      }
    } catch {
      if (requestId !== supportRequestIdRef.current) return;
      if (!suppressError) {
        setSupportError("留言记录加载失败，请稍后重试");
      }
    } finally {
      if (!silent) {
        setSupportLoading(false);
      }
    }
  }, [editingSiteId, isPlatformEditor, requestSupportWithSessionRecovery, supportReadMerchantId]);

  const loadSupportPeerInbox = useCallback(async (options?: { silent?: boolean; suppressError?: boolean }) => {
    if (isPlatformEditor) return;
    const silent = options?.silent === true;
    const suppressError = options?.suppressError === true;
    const peerInboxCacheKey = buildMerchantAdminDataCacheKey("peer-inbox", editingSiteId);
    let usedCachedPeerInbox = false;
    if (!silent && editingSiteId) {
      const cachedInbox = readMerchantAdminDataCache<{
        contacts?: MerchantPeerContactSummary[];
        threads?: MerchantPeerThread[];
      }>(peerInboxCacheKey);
      if (cachedInbox) {
        setSupportPeerContacts(Array.isArray(cachedInbox.contacts) ? cachedInbox.contacts : []);
        setSupportPeerThreads(Array.isArray(cachedInbox.threads) ? cachedInbox.threads : []);
        setSupportUnreadHydrationState((current) => (current.peer ? current : { ...current, peer: true }));
        usedCachedPeerInbox = true;
      }
    }
    const requestId = ++supportPeerRequestIdRef.current;
    if (!silent) {
      setSupportPeerLoading(!usedCachedPeerInbox);
      setSupportPeerError("");
    }
    try {
      const response = await requestMerchantPeerWithSessionRecovery({
        method: "GET",
      });
      const payload = (await response.json().catch(() => null)) as
        | {
            contacts?: MerchantPeerContactSummary[];
            threads?: MerchantPeerThread[];
            readState?: {
              peerLastRead?: Record<string, unknown> | null;
            } | null;
            currentMerchantId?: string | null;
            error?: string;
          }
        | null;
      if (requestId !== supportPeerRequestIdRef.current) return;
      if (!response.ok) {
        if (!suppressError) {
          setSupportPeerError(payload?.error === "unauthorized" ? "当前未登录，请重新登录后再聊天" : "商户联系人加载失败，请稍后重试");
        }
        return;
      }
      setSupportPeerError("");
      const nextContacts = Array.isArray(payload?.contacts) ? payload.contacts : [];
      const nextThreads = Array.isArray(payload?.threads) ? payload.threads : [];
      const responseMerchantId = String(payload?.currentMerchantId ?? "").trim();
      const readStateMerchantId = (
        responseMerchantId ||
        currentSupportMerchantId ||
        editingSiteId ||
        merchantSessionIdentityRef.current.merchantId ||
        ""
      ).trim();
      const remoteLastReadMap = normalizeSupportPeerLastReadRecord(payload?.readState?.peerLastRead);
      const localLastReadMap = readStateMerchantId ? readLocalSupportPeerLastReadMap(readStateMerchantId, nextContacts) : {};
      const nextLastReadMap = mergeSupportPeerLastReadMaps(remoteLastReadMap, localLastReadMap);
      if (readStateMerchantId) {
        Object.entries(nextLastReadMap).forEach(([contactMerchantId, timestamp]) => {
          writeLocalSupportPeerLastReadAt(readStateMerchantId, contactMerchantId, timestamp);
        });
      }
      writeMerchantAdminDataCache(peerInboxCacheKey, {
        contacts: nextContacts,
        threads: nextThreads,
      });
      setSupportPeerContacts(nextContacts);
      setSupportPeerThreads(nextThreads);
      setSupportPeerLastReadMap((current) => (areSupportPeerLastReadMapsEqual(current, nextLastReadMap) ? current : nextLastReadMap));
      setSupportReadStateHydrated((current) => (current.peer ? current : { ...current, peer: true }));
      setSupportUnreadHydrationState((current) => (current.peer ? current : { ...current, peer: true }));
      if (readStateMerchantId) {
        Object.entries(localLastReadMap)
          .filter(([contactMerchantId, timestamp]) =>
            isSupportReadTimestampNewer(timestamp, remoteLastReadMap[contactMerchantId]),
          )
          .forEach(([contactMerchantId, timestamp]) => {
            void requestMerchantPeerWithSessionRecovery({
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                action: "mark_read",
                contactMerchantId,
                lastReadAt: timestamp,
              }),
            }).catch(() => null);
          });
      }
    } catch {
      if (requestId !== supportPeerRequestIdRef.current) return;
      if (!suppressError) {
        setSupportPeerError("商户联系人加载失败，请稍后重试");
      }
    } finally {
      if (!silent) {
        setSupportPeerLoading(false);
      }
    }
  }, [currentSupportMerchantId, editingSiteId, isPlatformEditor, requestMerchantPeerWithSessionRecovery]);

  useEffect(() => {
    supportPeerThreadsRef.current = supportPeerThreads;
  }, [supportPeerThreads]);

  const loadSupportPeerThreadMessages = useCallback(
    async (contactMerchantId: string, mode: "reset" | "prepend" = "reset") => {
      const normalizedContactId = contactMerchantId.trim();
      if (isPlatformEditor || !/^\d{8}$/.test(normalizedContactId)) return;
      const existingThread = supportPeerThreadsRef.current.find((thread) => {
        return (
          (thread.merchantAId === currentSupportMerchantId && thread.merchantBId === normalizedContactId) ||
          (thread.merchantBId === currentSupportMerchantId && thread.merchantAId === normalizedContactId)
        );
      });
      const offset = mode === "prepend" ? existingThread?.messages.length ?? 0 : 0;
      setSupportPeerHistoryLoading(true);
      try {
        const response = await requestMerchantPeerWithSessionRecovery(
          {
            method: "GET",
          },
          {
            contactMerchantId: normalizedContactId,
            offset: String(offset),
            limit: "120",
          },
        );
        const payload = (await response.json().catch(() => null)) as
          | {
              ok?: unknown;
              thread?: MerchantPeerThread | null;
              messagePage?: {
                total?: unknown;
                offset?: unknown;
                limit?: unknown;
                hasMore?: unknown;
              } | null;
            }
          | null;
        if (!response.ok || payload?.ok !== true || !payload.thread) return;
        const incomingThread = payload.thread;
        setSupportPeerThreads((current) => {
          const existingIndex = current.findIndex((thread) => thread.threadKey === incomingThread.threadKey);
          const mergeMessages = (existing: MerchantPeerThread | null) => {
            const messageMap = new Map<string, MerchantPeerThread["messages"][number]>();
            const existingMessages = mode === "prepend" ? existing?.messages ?? [] : [];
            [...incomingThread.messages, ...existingMessages].forEach((message) => {
              messageMap.set(message.id, message);
            });
            return Array.from(messageMap.values()).sort((left, right) => {
              const leftTime = Date.parse(left.createdAt);
              const rightTime = Date.parse(right.createdAt);
              if (leftTime !== rightTime) return leftTime - rightTime;
              return left.id.localeCompare(right.id, "en");
            });
          };
          if (existingIndex < 0) {
            return [...current, incomingThread];
          }
          const next = [...current];
          next[existingIndex] = {
            ...next[existingIndex],
            ...incomingThread,
            messages: mergeMessages(next[existingIndex]),
          };
          return next;
        });
        setSupportPeerMessagePageByMerchantId((current) => ({
          ...current,
          [normalizedContactId]: {
            total: Number(payload.messagePage?.total) || incomingThread.messages.length,
            offset: Number(payload.messagePage?.offset) || 0,
            limit: Number(payload.messagePage?.limit) || incomingThread.messages.length,
            hasMore: payload.messagePage?.hasMore === true,
          },
        }));
      } finally {
        setSupportPeerHistoryLoading(false);
      }
    },
    [
      currentSupportMerchantId,
      isPlatformEditor,
      requestMerchantPeerWithSessionRecovery,
    ],
  );

  const refreshSupportMobileConversations = useCallback(async () => {
    await Promise.all([
      loadSupportThread({ silent: false, suppressError: false }),
      loadSupportPeerInbox({ silent: false, suppressError: false }),
    ]);
  }, [loadSupportPeerInbox, loadSupportThread]);

  useEffect(() => {
    if (!selectedSupportPeerContact?.merchantId) return;
    void loadSupportPeerThreadMessages(selectedSupportPeerContact.merchantId, "reset");
  }, [loadSupportPeerThreadMessages, selectedSupportPeerContact?.merchantId]);

  const {
    pullDistance: supportMobileConversationPullDistance,
    readyToRefresh: supportMobileConversationReadyToRefresh,
    refreshing: supportMobileConversationRefreshing,
    bind: supportMobileConversationPullBind,
  } = usePullToRefresh({
    disabled: supportLoading || supportPeerLoading || supportSearchLoading,
    getScrollElement: () => supportMobileConversationsViewportRef.current,
    onRefresh: refreshSupportMobileConversations,
  });

  async function searchSupportPeerMerchant() {
    if (isPlatformEditor || supportSearchLoading) return;
    const query = supportContactKeyword.trim();
    if (!query) {
      showTip("请输入完整的商户ID或邮箱");
      return;
    }
    setSupportSearchLoading(true);
    setSupportSearchError("");
    try {
      const response = await requestMerchantPeerWithSessionRecovery({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "search",
          query,
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | {
            contacts?: MerchantPeerContactSummary[];
            threads?: MerchantPeerThread[];
            contact?: { merchantId?: string; merchantName?: string; merchantEmail?: string } | null;
            message?: string;
          }
        | null;
      if (!response.ok) {
        setSupportSearchError(payload?.message || "没有找到匹配的商户");
        return;
      }
      setSupportPeerContacts(Array.isArray(payload?.contacts) ? payload.contacts : []);
      setSupportPeerThreads(Array.isArray(payload?.threads) ? payload.threads : []);
      setSupportSearchError("");
      const foundMerchantId = String(payload?.contact?.merchantId ?? "").trim();
      if (foundMerchantId) {
        setSupportSelectedContactKey(`merchant:${foundMerchantId}`);
        if (!isDesktopEditorSidebar) {
          setSupportMobileView("thread");
        }
        setSupportContactKeyword("");
      }
    } catch {
      setSupportSearchError("商户搜索失败，请稍后重试");
    } finally {
      setSupportSearchLoading(false);
    }
  }

  async function openMerchantProfilePanel() {
    void loadMerchantProfileDialog().catch(() => undefined);
    const resolvedSiteId = await ensureEditableMerchantSiteId();
    if (!resolvedSiteId) {
      showTip("正在初始化商户资料，请稍后重试");
      return;
    }
    setMerchantSiteIdOverride(resolvedSiteId);
    setMerchantProfileDialogShowBusinessCards(false);
    setMerchantDesktopSection("profile");
    if (/^\d{8}$/.test(resolvedSiteId)) {
      void (async () => {
        try {
          const requestStartedAt = Date.now();
          const response = await requestMerchantChatBusinessCardById(resolvedSiteId, {
            cache: "no-store",
          });
          const payload = (await response.json().catch(() => null)) as
            | {
                profile?: MerchantListPublishedSite | null;
                chatBusinessCard?: MerchantBusinessCardAsset | null;
              }
            | null;
          if (response.ok) {
            if ((supportPeerProfileLocalMutationAtRef.current[resolvedSiteId] ?? 0) > requestStartedAt) {
              return;
            }
            supportPeerProfileFetchedAtRef.current[resolvedSiteId] = Date.now();
            setSupportPeerProfilesByMerchantId((current) => ({
              ...current,
              [resolvedSiteId]: payload?.profile ?? null,
            }));
            setSupportPeerBusinessCardByMerchantId((current) => ({
              ...current,
              [resolvedSiteId]: payload?.chatBusinessCard ?? payload?.profile?.chatBusinessCard ?? null,
            }));
          }
        } catch {
          // Ignore and let the panel fall back to local cached data.
        }
      })();
    }
  }

  function openMerchantCardsPanel() {
    void loadMerchantBusinessCardManager().catch(() => undefined);
    setMerchantDesktopSection("cards");
  }

  async function openMerchantCustomersPanel() {
    void loadMerchantCustomerManager().catch(() => undefined);
    const resolvedSiteId = editingSiteId || (await ensureEditableMerchantSiteId());
    if (!resolvedSiteId) {
      showTip("当前商户还没准备好客户资料，请稍后重试");
      return;
    }
    setMerchantSiteIdOverride(resolvedSiteId);
    setMerchantDesktopSection("customers");
  }

  async function openMerchantPollStatsPanel() {
    void loadMerchantPollStatsPanel().catch(() => undefined);
    const resolvedSiteId = editingSiteId || (await ensureEditableMerchantSiteId());
    if (!resolvedSiteId) {
      showTip("当前商户还没准备好投票统计，请稍后重试");
      return;
    }
    setMerchantSiteIdOverride(resolvedSiteId);
    setMerchantDesktopSection("pollStats");
  }

  function openMerchantCouponsPanel(
    section: "coupons" | "couponRedeemWorkbench" | "couponClaims" | "couponRedemptions" | "couponDailyStats" = "coupons",
  ) {
    if (!canUseCouponModule) {
      showTip("当前商户未开通优惠券模块");
      return;
    }
    void loadMerchantCouponManager().catch(() => undefined);
    setMerchantDesktopSection(section);
  }

  async function openMerchantMembersPanel() {
    void loadMerchantMemberManager().catch(() => undefined);
    if (!canUseMembershipManagement) {
      showTip("当前商户未开通会员管理");
      return;
    }
    const resolvedSiteId = editingSiteId || (await ensureEditableMerchantSiteId());
    if (!resolvedSiteId) {
      showTip("当前商户还没准备好会员资料，请稍后重试");
      return;
    }
    setMerchantSiteIdOverride(resolvedSiteId);
    setMerchantMemberSettingsView("list");
    setMerchantDesktopSection("members");
  }

  async function openMerchantMemberSettingsPanel(view: Exclude<MerchantMemberSettingsView, "list">) {
    void loadMerchantMembershipSettingsPanel().catch(() => undefined);
    if (!canUseMembershipManagement) {
      showTip("当前商户未开通会员管理");
      return;
    }
    const resolvedSiteId = editingSiteId || (await ensureEditableMerchantSiteId());
    if (!resolvedSiteId) {
      showTip("当前商户还没准备好会员资料，请稍后重试");
      return;
    }
    setMerchantSiteIdOverride(resolvedSiteId);
    setMerchantMemberSettingsView(view);
    setMerchantDesktopSection("members");
  }

  async function openMerchantPointRedemptionPanel() {
    void loadMerchantPointRedemptionCashier().catch(() => undefined);
    if (!canUsePointsRedemption) {
      showTip(canUseMembershipManagement ? "当前商户未开通积分兑换" : "请先开通会员管理");
      return;
    }
    const resolvedSiteId = editingSiteId || (await ensureEditableMerchantSiteId());
    if (!resolvedSiteId) {
      showTip("当前商户还没准备好会员资料，请稍后重试");
      return;
    }
    setMerchantSiteIdOverride(resolvedSiteId);
    setMerchantDesktopSection("pointRedemption");
  }

  async function openMerchantRedemptionRecordsPanel() {
    if (!canUsePointsRedemption) {
      showTip(canUseMembershipManagement ? "当前商户未开通积分兑换" : "请先开通会员管理");
      return;
    }
    const resolvedSiteId = editingSiteId || (await ensureEditableMerchantSiteId());
    if (!resolvedSiteId) {
      showTip("当前商户还没准备好会员资料，请稍后重试");
      return;
    }
    setMerchantSiteIdOverride(resolvedSiteId);
    setMerchantDesktopSection("redemptionRecords");
  }

  async function openMerchantRechargeRecordsPanel() {
    if (!canUsePointsRedemption) {
      showTip(canUseMembershipManagement ? "当前商户未开通积分兑换" : "请先开通会员管理");
      return;
    }
    const resolvedSiteId = editingSiteId || (await ensureEditableMerchantSiteId());
    if (!resolvedSiteId) {
      showTip("当前商户还没准备好会员资料，请稍后重试");
      return;
    }
    setMerchantSiteIdOverride(resolvedSiteId);
    setMerchantDesktopSection("rechargeRecords");
  }

  async function openMerchantPointRedemptionSettingsPanel(view: "redemptionCategories" | "redemptionItems") {
    void loadMerchantMembershipSettingsPanel().catch(() => undefined);
    if (!canUsePointsRedemption) {
      showTip(canUseMembershipManagement ? "当前商户未开通积分兑换" : "请先开通会员管理");
      return;
    }
    const resolvedSiteId = editingSiteId || (await ensureEditableMerchantSiteId());
    if (!resolvedSiteId) {
      showTip("当前商户还没准备好会员资料，请稍后重试");
      return;
    }
    setMerchantSiteIdOverride(resolvedSiteId);
    setMerchantDesktopSection(view);
  }

  async function openMerchantBookingPanel() {
    void loadMerchantBookingManagerDialog().catch(() => undefined);
    const resolvedSiteId = editingSiteId || (await ensureEditableMerchantSiteId());
    if (!resolvedSiteId) {
      showTip("当前商户还没准备好预约资料，请稍后重试");
      return;
    }
    setMerchantSiteIdOverride(resolvedSiteId);
    setMerchantBookingWorkbenchOpen(false);
    setMerchantDesktopSection("booking");
  }

  async function openMerchantOrderPanel() {
    void loadMerchantOrderManagerDialog().catch(() => undefined);
    const resolvedSiteId = editingSiteId || (await ensureEditableMerchantSiteId());
    if (!resolvedSiteId) {
      showTip("当前商户还没准备好订单资料，请稍后重试");
      return;
    }
    setMerchantSiteIdOverride(resolvedSiteId);
    setMerchantOrderWorkbenchOpen(false);
    setMerchantDesktopSection("orders");
  }

  async function openMerchantEnterprisePanel(view: MerchantEnterpriseView = "overview") {
    if (!canUseEnterpriseManagement) {
      showTip("当前商户未开通企业管理");
      return;
    }
    if (
      merchantDesktopSection === "enterprise" &&
      view !== merchantEnterpriseView &&
      merchantEnterpriseViewChangeGuardRef.current &&
      !merchantEnterpriseViewChangeGuardRef.current(view)
    ) {
      return;
    }
    void loadMerchantEnterpriseManager().catch(() => undefined);
    const resolvedSiteId = editingSiteId || (await ensureEditableMerchantSiteId());
    if (!resolvedSiteId) {
      showTip("当前商户还没准备好企业管理资料，请稍后重试");
      return;
    }
    setMerchantSiteIdOverride(resolvedSiteId);
    setMerchantEnterpriseView(view);
    setMerchantDesktopSection("enterprise");
  }

  function openMerchantLogsPanel() {
    setMerchantDesktopSection("logs");
  }

  function openMerchantBusinessCenterPanel() {
    setMerchantDesktopSection("business");
  }

  function openMerchantPrintPanel() {
    void loadMerchantPrintSettingsPanel().catch(() => undefined);
    setMerchantDesktopSection("printer");
  }

  async function openMerchantEditorInNewWindow() {
    const resolvedSiteId = editingSiteId || (await ensureEditableMerchantSiteId());
    if (!resolvedSiteId) {
      showTip("当前商户还没准备好网站编辑资料，请稍后重试");
      return;
    }
    preloadEditorPreviewComponents();
    const editorHref = new URL(buildMerchantBackendHref(resolvedSiteId), window.location.origin);
    editorHref.searchParams.set("editorOnly", "1");
    const opened = window.open(editorHref.toString(), "_blank", "noopener,noreferrer");
    if (!opened) {
      showTip("浏览器拦截了新窗口，请允许弹窗后重试");
    }
  }

  function openMerchantSupportPanel() {
    void loadSupportMessageContent().catch(() => undefined);
    setMerchantDesktopSection("support");
    openSupportDialog();
  }

  function openSupportDialog() {
    if (isPlatformEditor) return;
    supportScrollToLatestPendingRef.current = true;
    setSupportDataActivated(true);
    setSupportLoading(true);
    if (!isDesktopEditorSidebar) {
      setSupportMobileView("list");
    }
    setSupportDialogOpen(true);
  }

  async function openSupportConversationFromBusinessRecord(target: {
    accountId?: string;
    email?: string;
    name?: string;
  }) {
    if (isPlatformEditor) return;
    const targetAccountId = String(target.accountId ?? "").trim();
    const targetEmail = String(target.email ?? "").trim().toLowerCase();
    const targetName = String(target.name ?? "").trim();
    if (!targetAccountId && !targetEmail) {
      showTip("当前用户没有可聊天的账号信息");
      return;
    }

    setSupportPeerError("");
    setSupportSearchError("");
    setSupportContactKeyword("");
    setSupportMerchantInfoSheetOpen(false);
    if (isDesktopEditorSidebar) {
      setMerchantDesktopSection("support");
    } else {
      setSupportMobileHomeTab("conversations");
    }
    openSupportDialog();

    const existingContact = supportPeerContacts.find((contact) => {
      const contactId = String(contact.merchantId ?? "").trim();
      const contactEmail = String(contact.merchantEmail ?? "").trim().toLowerCase();
      return (targetAccountId && contactId === targetAccountId) || (targetEmail && contactEmail === targetEmail);
    });
    if (existingContact) {
      setSupportSelectedContactKey(`merchant:${String(existingContact.merchantId ?? "").trim()}`);
      if (!isDesktopEditorSidebar) {
        setSupportMobileView("thread");
      }
      return;
    }

    setSupportPeerLoading(true);
    try {
      const response = await requestMerchantPeerWithSessionRecovery({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "ensure_contact",
          contactAccountId: targetAccountId || undefined,
          contactEmail: targetEmail || undefined,
          contactName: targetName || undefined,
          contactAccountType: "personal",
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | {
            contacts?: MerchantPeerContactSummary[];
            threads?: MerchantPeerThread[];
            contact?: MerchantPeerContactSummary | null;
            message?: string;
            error?: string;
          }
        | null;
      if (!response.ok) {
        throw new Error(payload?.message || "打开会话失败，请稍后重试");
      }
      setSupportPeerContacts(Array.isArray(payload?.contacts) ? payload.contacts : []);
      setSupportPeerThreads(Array.isArray(payload?.threads) ? payload.threads : []);
      const contactId =
        String(payload?.contact?.merchantId ?? "").trim() ||
        String(
          (Array.isArray(payload?.contacts) ? payload.contacts : []).find((contact) => {
            const contactMerchantId = String(contact.merchantId ?? "").trim();
            const contactEmail = String(contact.merchantEmail ?? "").trim().toLowerCase();
            return (targetAccountId && contactMerchantId === targetAccountId) || (targetEmail && contactEmail === targetEmail);
          })?.merchantId ?? "",
        ).trim();
      if (!contactId) {
        throw new Error("打开会话失败，请稍后重试");
      }
      setSupportSelectedContactKey(`merchant:${contactId}`);
      if (!isDesktopEditorSidebar) {
        setSupportMobileView("thread");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "打开会话失败，请稍后重试";
      setSupportPeerError(message);
      showTip(message);
    } finally {
      setSupportPeerLoading(false);
    }
  }

  const desktopMerchantWorkspaceActive = !isPlatformEditor && (forceDesktopEditorSidebar || isDesktopEditorSidebar);

  useEffect(() => {
    if (!desktopMerchantWorkspaceActive) {
      if (typeof window !== "undefined" && isFaollaSectionSearch(window.location.search)) return;
      setMerchantDesktopSection("editor");
      return;
    }
    if (merchantDesktopSection !== "support" && supportDialogOpen) {
      setSupportDialogOpen(false);
    }
  }, [desktopMerchantWorkspaceActive, merchantDesktopSection, setMerchantDesktopSection, supportDialogOpen]);

  useEffect(() => {
    if (!desktopMerchantWorkspaceActive || merchantDesktopSection !== "logs") return;
    let cancelled = false;
    const timeout = window.setTimeout(() => {
      if (cancelled) return;
      setMerchantLogFailureSnapshots(readPublishFailureSnapshots(storeScope).slice(0, 12));
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [desktopMerchantWorkspaceActive, merchantDesktopSection, storeScope]);

  useEffect(() => {
    if (isPlatformEditor || supportDataActivated) return;
    if (supportFaollaActive) return;
    if (checkingAuth) return;
    setSupportDataActivated(true);
  }, [checkingAuth, isPlatformEditor, supportDataActivated, supportFaollaActive]);

  useEffect(() => {
    if (isPlatformEditor || !isMobileMerchantSupportOnlyMode) return;
    supportScrollToLatestPendingRef.current = true;
    setSupportDataActivated(true);
    setSupportLoading(true);
    setSupportSelectedContactKey(SUPPORT_OFFICIAL_CONTACT_KEY);
    setSupportMobileView("list");
  }, [isMobileMerchantSupportOnlyMode, isPlatformEditor]);

  useEffect(() => {
    if (isPlatformEditor || typeof window === "undefined" || !supportDataActivated) return;
    if (supportFaollaActive) return;

    const loadInitialSupportData = () => {
      void loadSupportThread({ silent: !supportInterfaceOpen, suppressError: !supportInterfaceOpen });
      void loadSupportPeerInbox({
        silent: !supportInterfaceOpen,
        suppressError: isMobileMerchantSupportOnlyMode || !supportInterfaceOpen,
      });
    };
    const refreshSupportThread = () => {
      void loadSupportThread({ silent: true, suppressError: !supportInterfaceOpen });
      void loadSupportPeerInbox({
        silent: true,
        suppressError: isMobileMerchantSupportOnlyMode || !supportInterfaceOpen,
      });
    };
    let cancelInitialRefresh = () => {};
    if (supportInterfaceOpen || isMobileMerchantSupportOnlyMode) {
      loadInitialSupportData();
    } else {
      cancelInitialRefresh = scheduleAdminIdleTask(loadInitialSupportData);
    }

    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      refreshSupportThread();
    }, supportInterfaceOpen ? SUPPORT_THREAD_OPEN_POLL_INTERVAL_MS : SUPPORT_THREAD_POLL_INTERVAL_MS);
    const handleFocus = () => refreshSupportThread();
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        refreshSupportThread();
      }
    };

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      cancelInitialRefresh();
      window.clearInterval(timer);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [
    isDesktopEditorSidebar,
    isMobileMerchantSupportOnlyMode,
    isPlatformEditor,
    loadSupportPeerInbox,
    loadSupportThread,
    supportDataActivated,
    supportFaollaActive,
    supportInterfaceOpen,
  ]);

  useEffect(() => {
    if (isPlatformEditor || typeof window === "undefined") return;
    if (!supportReadMerchantId) {
      setSupportLastReadAt("");
      setSupportReadStateHydrated((current) => (current.official ? { ...current, official: false } : current));
      supportLastIncomingAdminMessageKeyRef.current = "";
    }
  }, [isPlatformEditor, supportReadMerchantId]);

  useEffect(() => {
    if (isPlatformEditor || typeof window === "undefined") return;
    if (!currentSupportMerchantId) {
      setSupportPeerLastReadMap({});
      setSupportReadStateHydrated((current) => (current.peer ? { ...current, peer: false } : current));
      supportLastIncomingPeerMessageKeyRef.current = "";
    }
  }, [currentSupportMerchantId, isPlatformEditor]);

  useEffect(() => {
    if (supportSelectedContactKey === SUPPORT_OFFICIAL_CONTACT_KEY) return;
    if (selectedSupportPeerContact) return;
    setSupportSelectedContactKey(SUPPORT_OFFICIAL_CONTACT_KEY);
  }, [selectedSupportPeerContact, supportSelectedContactKey]);

  useEffect(() => {
    if (!supportPendingDeepLink || typeof window === "undefined") return;
    const clearSupportDeepLink = () => {
      try {
        const url = new URL(window.location.href);
        if (!url.searchParams.has("support")) return;
        url.searchParams.delete("support");
        window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
      } catch {
        // Ignore URL cleanup failures.
      }
      setSupportPendingDeepLink("");
    };

    setSupportDataActivated(true);
    setSupportLoading(true);
    setSupportMobileHomeTab("conversations");

    if (supportPendingDeepLink === "official") {
      setSupportSelectedContactKey(SUPPORT_OFFICIAL_CONTACT_KEY);
      if (isMobileSupportDialog) {
        setSupportMobileView("thread");
      }
      clearSupportDeepLink();
      return;
    }

    const targetMerchantId = supportPendingDeepLink.replace(/^merchant:/, "");
    if (!/^\d{8}$/.test(targetMerchantId)) {
      clearSupportDeepLink();
      return;
    }
    if (!supportUnreadHydrationState.peer || supportPeerLoading) return;
    if (!supportPeerContacts.some((item) => item.merchantId === targetMerchantId)) {
      clearSupportDeepLink();
      return;
    }
    setSupportSelectedContactKey(`merchant:${targetMerchantId}`);
    if (isMobileSupportDialog) {
      setSupportMobileView("thread");
    }
    clearSupportDeepLink();
  }, [
    isMobileSupportDialog,
    supportPeerContacts,
    supportPeerLoading,
    supportPendingDeepLink,
    supportUnreadHydrationState.peer,
  ]);

  useEffect(() => {
    if (!supportMerchantInfoSheetOpen) return;
    if (!supportInterfaceOpen || selectedSupportIsOfficial || !selectedSupportPeerMerchantId) {
      setSupportMerchantInfoSheetOpen(false);
    }
  }, [
    selectedSupportIsOfficial,
    selectedSupportPeerMerchantId,
    supportInterfaceOpen,
    supportMerchantInfoSheetOpen,
  ]);

  useEffect(() => {
    if (supportInterfaceOpen) {
      if (!isDesktopEditorSidebar) {
        setSupportMobileView("list");
      }
      return;
    }
    supportMobileSwipeStartRef.current = null;
    setSupportMerchantInfoSheetOpen(false);
    setSupportMobileView("list");
  }, [isDesktopEditorSidebar, isMobileMerchantSupportOnlyMode, supportInterfaceOpen]);

  useEffect(() => {
    if (isPlatformEditor || !supportInterfaceOpen || supportPeerContacts.length === 0) return;
    const merchantIdsToWarm = Array.from(
      new Set(
        supportPeerContacts
          .map((contact) => contact.merchantId.trim())
          .filter((merchantId) => /^\d{8}$/.test(merchantId)),
      ),
    ).filter((merchantId) => {
      const localSite = supportPeerSiteByMerchantId.get(merchantId) ?? null;
      const localProfile = localSite ? buildSupportPublishedProfileFromSite(localSite) : null;
      const fetchedProfile = Object.prototype.hasOwnProperty.call(supportPeerProfilesByMerchantId, merchantId)
        ? supportPeerProfilesByMerchantId[merchantId]
        : undefined;
      const mergedProfile = fetchedProfile ?? localProfile ?? null;
      if (hasSupportMerchantAvatarCoverage(mergedProfile)) return false;
      const lastFetchedAt = supportPeerProfileFetchedAtRef.current[merchantId] ?? 0;
      if (Date.now() - lastFetchedAt < SUPPORT_MERCHANT_PROFILE_REFRESH_TTL_MS) return false;
      if (supportPeerProfileLoadingIdsRef.current.has(merchantId)) return false;
      return true;
    });
    if (merchantIdsToWarm.length === 0) return;

    let cancelled = false;
    merchantIdsToWarm.forEach((merchantId) => {
      const requestStartedAt = Date.now();
      supportPeerProfileLoadingIdsRef.current.add(merchantId);
      void (async () => {
        try {
          const response = await requestMerchantChatBusinessCardById(merchantId, {
            cache: "no-store",
          });
          const payload = (await response.json().catch(() => null)) as
            | {
                profile?: MerchantListPublishedSite | null;
                chatBusinessCard?: MerchantBusinessCardAsset | null;
              }
            | null;
          if (cancelled || !response.ok) return;
          if ((supportPeerProfileLocalMutationAtRef.current[merchantId] ?? 0) > requestStartedAt) return;
          supportPeerProfileFetchedAtRef.current[merchantId] = Date.now();
          setSupportPeerProfilesByMerchantId((current) => ({
            ...current,
            [merchantId]: payload?.profile ?? null,
          }));
          setSupportPeerBusinessCardByMerchantId((current) => ({
            ...current,
            [merchantId]: payload?.chatBusinessCard ?? payload?.profile?.chatBusinessCard ?? null,
          }));
        } catch {
          if (cancelled) return;
        } finally {
          supportPeerProfileLoadingIdsRef.current.delete(merchantId);
        }
      })();
    });

    return () => {
      cancelled = true;
    };
  }, [
    isPlatformEditor,
    requestMerchantChatBusinessCardById,
    supportInterfaceOpen,
    supportPeerContacts,
    supportPeerProfilesByMerchantId,
    supportPeerSiteByMerchantId,
  ]);

  useEffect(() => {
    if (isPlatformEditor || !supportInterfaceOpen || !isMobileSupportDialog || supportMobileHomeTab !== "self") return;
    const merchantId = editingSiteId.trim();
    if (!/^\d{8}$/.test(merchantId)) return;
    const lastFetchedAt = supportPeerProfileFetchedAtRef.current[merchantId] ?? 0;
    if (Date.now() - lastFetchedAt < SUPPORT_MERCHANT_PROFILE_REFRESH_TTL_MS) return;
    if (supportPeerProfileLoadingIdsRef.current.has(merchantId)) return;
    let cancelled = false;
    const requestStartedAt = Date.now();
    supportPeerProfileLoadingIdsRef.current.add(merchantId);
    void (async () => {
      try {
        const response = await requestMerchantChatBusinessCardById(merchantId, {
          cache: "no-store",
        });
        const payload = (await response.json().catch(() => null)) as
          | {
              profile?: MerchantListPublishedSite | null;
              chatBusinessCard?: MerchantBusinessCardAsset | null;
            }
          | null;
        if (cancelled || !response.ok) return;
        if ((supportPeerProfileLocalMutationAtRef.current[merchantId] ?? 0) > requestStartedAt) return;
        supportPeerProfileFetchedAtRef.current[merchantId] = Date.now();
        setSupportPeerProfilesByMerchantId((current) => ({
          ...current,
          [merchantId]: payload?.profile ?? null,
        }));
        setSupportPeerBusinessCardByMerchantId((current) => ({
          ...current,
          [merchantId]: payload?.chatBusinessCard ?? payload?.profile?.chatBusinessCard ?? null,
        }));
      } catch {
        if (cancelled) return;
      } finally {
        supportPeerProfileLoadingIdsRef.current.delete(merchantId);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    editingSiteId,
    isMobileSupportDialog,
    isPlatformEditor,
    requestMerchantChatBusinessCardById,
    supportInterfaceOpen,
    supportMobileHomeTab,
  ]);

  useEffect(() => {
    setSupportSelfSignatureDraft(supportSelfSignature);
    setSupportSelfSignatureDirty(false);
  }, [editingSiteId, supportSelfSignature]);

  useEffect(() => {
    if (isPlatformEditor || !supportInterfaceOpen || selectedSupportIsOfficial) return;
    const merchantId = selectedSupportPeerMerchantId.trim();
    if (!/^\d{8}$/.test(merchantId)) return;
    const shouldWarmSupportMerchantProfile =
      supportMerchantInfoSheetOpen ||
      supportBusinessCardDialogOpen ||
      (isMobileSupportDialog && supportMobileView === "thread" && !!selectedSupportPeerContact);
    if (!shouldWarmSupportMerchantProfile) return;
    if (!supportMerchantInfoSheetOpen && hasSupportMerchantProfileCoverage(selectedSupportLocalProfile)) {
      const lastFetchedAt = supportPeerProfileFetchedAtRef.current[merchantId] ?? 0;
      if (Date.now() - lastFetchedAt < SUPPORT_MERCHANT_PROFILE_REFRESH_TTL_MS) return;
    }
    if (supportPeerProfileLoadingIdsRef.current.has(merchantId)) return;
    let cancelled = false;
    const requestStartedAt = Date.now();
    supportPeerProfileLoadingIdsRef.current.add(merchantId);
    void (async () => {
      try {
        const response = await requestMerchantChatBusinessCardById(merchantId, {
          cache: "no-store",
        });
        const payload = (await response.json().catch(() => null)) as
          | {
              profile?: MerchantListPublishedSite | null;
              chatBusinessCard?: MerchantBusinessCardAsset | null;
            }
          | null;
        if (cancelled || !response.ok) return;
        if ((supportPeerProfileLocalMutationAtRef.current[merchantId] ?? 0) > requestStartedAt) return;
        supportPeerProfileFetchedAtRef.current[merchantId] = Date.now();
        setSupportPeerProfilesByMerchantId((current) => ({
          ...current,
          [merchantId]: payload?.profile ?? null,
        }));
        setSupportPeerBusinessCardByMerchantId((current) => ({
          ...current,
          [merchantId]: payload?.chatBusinessCard ?? payload?.profile?.chatBusinessCard ?? null,
        }));
      } catch {
        if (cancelled) return;
      } finally {
        supportPeerProfileLoadingIdsRef.current.delete(merchantId);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    isMobileSupportDialog,
    isPlatformEditor,
    requestMerchantChatBusinessCardById,
    selectedSupportIsOfficial,
    selectedSupportLocalProfile,
    selectedSupportPeerContact,
    selectedSupportPeerMerchantId,
    supportBusinessCardDialogOpen,
    supportInterfaceOpen,
    supportMerchantInfoSheetOpen,
    supportMobileView,
  ]);

  useEffect(() => {
    if (isPlatformEditor || !supportInterfaceOpen || !supportBusinessCardDialogOpen) return;
    if (supportSelectedContactKey === SUPPORT_OFFICIAL_CONTACT_KEY) {
      setSupportBusinessCardLoading(false);
      setSupportBusinessCardError("");
      return;
    }
    if (!selectedSupportPeerMerchantId) return;
    if (selectedSupportFallbackBusinessCard) {
      setSupportBusinessCardLoading(false);
      setSupportBusinessCardError("");
      return;
    }
    if (Object.prototype.hasOwnProperty.call(supportPeerBusinessCardByMerchantId, selectedSupportPeerMerchantId)) {
      setSupportBusinessCardLoading(false);
      setSupportBusinessCardError("");
      return;
    }

    let cancelled = false;
    setSupportBusinessCardLoading(true);
    setSupportBusinessCardError("");
    void (async () => {
      try {
        const response = await requestMerchantChatBusinessCardById(selectedSupportPeerMerchantId);
        const payload = (await response.json().catch(() => null)) as
          | {
              chatBusinessCard?: MerchantBusinessCardAsset | null;
              message?: string;
            }
          | null;
        if (cancelled) return;
        if (!response.ok) {
          setSupportBusinessCardError(payload?.message || "聊天名片加载失败，请稍后重试");
          return;
        }
        setSupportPeerBusinessCardByMerchantId((current) =>
          Object.prototype.hasOwnProperty.call(current, selectedSupportPeerMerchantId)
            ? current
            : {
                ...current,
                [selectedSupportPeerMerchantId]: payload?.chatBusinessCard ?? null,
              },
        );
      } catch {
        if (cancelled) return;
        setSupportBusinessCardError("聊天名片加载失败，请稍后重试");
      } finally {
        if (!cancelled) {
          setSupportBusinessCardLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    isPlatformEditor,
    requestMerchantChatBusinessCardById,
    selectedSupportFallbackBusinessCard,
    selectedSupportPeerMerchantId,
    supportBusinessCardDialogOpen,
    supportInterfaceOpen,
    supportPeerBusinessCardByMerchantId,
    supportSelectedContactKey,
  ]);

  useEffect(() => {
    if (isPlatformEditor || !latestSupportAdminMessageKey) return;
    const eventKey = `official:${supportReadMerchantId || currentSupportMerchantId}:${latestSupportAdminMessageKey}`;
    const alreadyNotified = rememberSupportNotificationEvent(eventKey);
    const previousKey = supportLastIncomingAdminMessageKeyRef.current;
    supportLastIncomingAdminMessageKeyRef.current = latestSupportAdminMessageKey;
    const officialConversationVisible =
      supportInterfaceOpen &&
      selectedSupportConversationVisible &&
      supportSelectedContactKey === SUPPORT_OFFICIAL_CONTACT_KEY;
    if (!previousKey || previousKey === latestSupportAdminMessageKey || alreadyNotified || officialConversationVisible) return;
    void triggerSupportNotificationFeedback(latestSupportAdminNotificationPayload ?? undefined);
  }, [
    currentSupportMerchantId,
    isPlatformEditor,
    latestSupportAdminMessageKey,
    latestSupportAdminNotificationPayload,
    rememberSupportNotificationEvent,
    selectedSupportConversationVisible,
    supportInterfaceOpen,
    supportReadMerchantId,
    supportSelectedContactKey,
    triggerSupportNotificationFeedback,
  ]);

  useEffect(() => {
    if (isPlatformEditor || !latestIncomingPeerMessageKey) return;
    const eventKey = `peer:${currentSupportMerchantId}:${latestIncomingPeerMessageKey}`;
    const alreadyNotified = rememberSupportNotificationEvent(eventKey);
    const previousKey = supportLastIncomingPeerMessageKeyRef.current;
    supportLastIncomingPeerMessageKeyRef.current = latestIncomingPeerMessageKey;
    const peerConversationVisible =
      supportInterfaceOpen &&
      selectedSupportConversationVisible &&
      !!selectedSupportPeerMerchantId &&
      latestIncomingPeerMessageKey.startsWith(`${selectedSupportPeerMerchantId}:`);
    if (!previousKey || previousKey === latestIncomingPeerMessageKey || alreadyNotified || peerConversationVisible) return;
    void triggerSupportNotificationFeedback(latestIncomingPeerNotificationPayload ?? undefined);
  }, [
    currentSupportMerchantId,
    isPlatformEditor,
    latestIncomingPeerMessageKey,
    latestIncomingPeerNotificationPayload,
    rememberSupportNotificationEvent,
    selectedSupportConversationVisible,
    selectedSupportPeerMerchantId,
    supportInterfaceOpen,
    triggerSupportNotificationFeedback,
  ]);

  useEffect(() => {
    if (isPlatformEditor || !latestMerchantBusinessAttention?.key) return;
    const eventKey = `business:${currentSupportMerchantId}:${latestMerchantBusinessAttention.key}`;
    const alreadyNotified = rememberSupportNotificationEvent(eventKey);
    const previousKey = supportLastIncomingBusinessAttentionKeyRef.current;
    supportLastIncomingBusinessAttentionKeyRef.current = latestMerchantBusinessAttention.key;
    const businessVisible =
      (supportInterfaceOpen && isMobileSupportDialog && supportMobileHomeTab === "business") ||
      merchantDesktopSection === "business" ||
      merchantDesktopSection === "booking" ||
      merchantDesktopSection === "orders";
    if (!previousKey || previousKey === latestMerchantBusinessAttention.key || alreadyNotified || businessVisible) return;
    void triggerSupportNotificationFeedback(latestMerchantBusinessNotificationPayload ?? undefined);
  }, [
    currentSupportMerchantId,
    isMobileSupportDialog,
    isPlatformEditor,
    latestMerchantBusinessAttention,
    latestMerchantBusinessNotificationPayload,
    merchantDesktopSection,
    rememberSupportNotificationEvent,
    supportInterfaceOpen,
    supportMobileHomeTab,
    triggerSupportNotificationFeedback,
  ]);

  useEffect(() => {
    if (
      isPlatformEditor ||
      !supportInterfaceOpen ||
      !selectedSupportConversationVisible
    ) {
      supportInitialScrollConversationKeyRef.current = "";
      supportLastVisibleMessageKeyRef.current = "";
      supportVisibleMessageKeysRef.current = [];
      supportScrollStabilizationTargetKeyRef.current = "";
      supportScrollStabilizationUntilRef.current = 0;
      return;
    }
    if (
      selectedSupportLoading ||
      !selectedSupportReadStateHydrated ||
      !selectedSupportConversationKey ||
      supportInitialScrollConversationKeyRef.current === selectedSupportConversationKey
    ) {
      return;
    }

    supportInitialScrollConversationKeyRef.current = selectedSupportConversationKey;
    supportLastVisibleMessageKeyRef.current = "";
    supportVisibleMessageKeysRef.current = [];
    supportScrollStabilizationTargetKeyRef.current = "";
    supportScrollStabilizationUntilRef.current = 0;
    supportScrollToLatestPendingRef.current = true;
  }, [
    isPlatformEditor,
    selectedSupportConversationKey,
    selectedSupportConversationVisible,
    selectedSupportLoading,
    selectedSupportReadStateHydrated,
    supportInterfaceOpen,
  ]);

  useEffect(() => {
    if (isPlatformEditor || !supportInterfaceOpen || !selectedSupportConversationVisible || typeof window === "undefined") return;
    if (supportSelectedContactKey !== SUPPORT_OFFICIAL_CONTACT_KEY) return;
    if (!supportReadStateHydrated.official) return;
    if (supportInitialScrollConversationKeyRef.current !== selectedSupportConversationKey) return;
    if (!supportReadMerchantId || !latestSupportAdminMessageAt) return;
    if (!isSupportReadTimestampNewer(latestSupportAdminMessageAt, supportLastReadAt)) return;
    setSupportLastReadAt(latestSupportAdminMessageAt);
    writeLocalSupportLastReadAt(supportReadMerchantId, latestSupportAdminMessageAt);
    void requestSupportWithSessionRecovery({
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action: "mark_read",
        lastReadAt: latestSupportAdminMessageAt,
      }),
    }).catch(() => null);
  }, [
    isPlatformEditor,
    latestSupportAdminMessageAt,
    requestSupportWithSessionRecovery,
    selectedSupportConversationVisible,
    supportInterfaceOpen,
    supportLastReadAt,
    supportReadMerchantId,
    supportReadStateHydrated.official,
    selectedSupportConversationKey,
    supportSelectedContactKey,
  ]);

  useEffect(() => {
    if (isPlatformEditor || !supportInterfaceOpen || !selectedSupportConversationVisible || typeof window === "undefined") return;
    if (supportSelectedContactKey === SUPPORT_OFFICIAL_CONTACT_KEY) return;
    if (!supportReadStateHydrated.peer) return;
    if (supportInitialScrollConversationKeyRef.current !== selectedSupportConversationKey) return;
    if (!currentSupportMerchantId || !selectedSupportPeerMerchantId || !latestSelectedSupportPeerIncomingMessageAt) return;
    const currentLastReadAt = normalizeSupportMessageTimestamp(supportPeerLastReadMap[selectedSupportPeerMerchantId]);
    if (!isSupportReadTimestampNewer(latestSelectedSupportPeerIncomingMessageAt, currentLastReadAt)) return;
    setSupportPeerLastReadMap((current) =>
      current[selectedSupportPeerMerchantId] === latestSelectedSupportPeerIncomingMessageAt
        ? current
        : {
            ...current,
            [selectedSupportPeerMerchantId]: latestSelectedSupportPeerIncomingMessageAt,
          },
    );
    writeLocalSupportPeerLastReadAt(
      currentSupportMerchantId,
      selectedSupportPeerMerchantId,
      latestSelectedSupportPeerIncomingMessageAt,
    );
    void requestMerchantPeerWithSessionRecovery({
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action: "mark_read",
        contactMerchantId: selectedSupportPeerMerchantId,
        lastReadAt: latestSelectedSupportPeerIncomingMessageAt,
      }),
    }).catch(() => null);
  }, [
    currentSupportMerchantId,
    isPlatformEditor,
    latestSelectedSupportPeerIncomingMessageAt,
    requestMerchantPeerWithSessionRecovery,
    selectedSupportConversationVisible,
    selectedSupportPeerMerchantId,
    selectedSupportConversationKey,
    supportInterfaceOpen,
    supportPeerLastReadMap,
    supportReadStateHydrated.peer,
    supportSelectedContactKey,
  ]);

  useEffect(() => {
    if (!supportInterfaceOpen) {
      supportLastVisibleMessageKeyRef.current = "";
      supportScrollToLatestPendingRef.current = false;
      setSupportBusinessCardDialogOpen(false);
      setSupportAttachmentMenuOpen(false);
      setSupportEmojiMenuOpen(false);
      setSupportSelfCardPickerOpen(false);
      setSupportMessageContextMenu(null);
      setSupportPinnedMessage(null);
      setSupportReplyDraft(null);
      setSupportPendingImageDrafts([]);
      setSupportStarredMessageKeys([]);
      setSupportSelectedMessageKeys([]);
      setSupportHiddenMessageKeys([]);
      return;
    }
    supportScrollToLatestPendingRef.current = true;
  }, [supportInterfaceOpen]);

  useEffect(() => {
    if (!supportInterfaceOpen) return;
    supportScrollToLatestPendingRef.current = true;
    setSupportAttachmentMenuOpen(false);
    setSupportEmojiMenuOpen(false);
    setSupportSelfCardPickerOpen(false);
    setSupportMessageContextMenu(null);
    setSupportPinnedMessage(null);
    setSupportReplyDraft(null);
    setSupportStarredMessageKeys([]);
    setSupportSelectedMessageKeys([]);
    setSupportHiddenMessageKeys([]);
    setSupportFailedMessageActionKey("");
  }, [supportInterfaceOpen, supportSelectedContactKey, supportMobileView]);

  useEffect(() => {
    if (isPlatformEditor || supportFaollaActive || !supportDataActivated) return;
    if (!supportUnreadStateHydrated) return;
    if (!supportUnreadStateHydrated && supportEffectiveBadgeCount <= 0) return;
    if (!supportPushBadgeHydrated && supportEffectiveBadgeCount <= 0) return;
    void syncSupportAppBadge(supportEffectiveBadgeCount);
    if (!canUseFaollaNativeNotifications()) {
      void syncSupportServiceWorkerBadge(supportEffectiveBadgeCount);
    }
  }, [
    isPlatformEditor,
    supportFaollaActive,
    supportDataActivated,
    supportEffectiveBadgeCount,
    supportPushBadgeHydrated,
    supportUnreadStateHydrated,
  ]);

  useEffect(() => {
    if (isPlatformEditor || supportFaollaActive || typeof window === "undefined" || !canUseFaollaNativeNotifications()) return;
    const siteId = (
      currentSupportMerchantId ||
      supportReadMerchantId ||
      editingSiteId ||
      merchantSessionIdentityRef.current.merchantId ||
      merchantIdsRef.current.find((item) => isMerchantNumericId(item)) ||
      merchantIdsRef.current[0] ||
      readRecentMerchantLaunchMerchantId() ||
      ""
    ).trim();
    if (!siteId) return;
    if (!supportDataActivated || !supportUnreadStateHydrated) return;
    configureFaollaNativeNotificationSync({
      enabled: true,
      alertsEnabled: Boolean(supportSystemNotificationsEnabled),
      baseUrl: window.location.origin,
      siteId,
      merchantEmail: ((editingSite?.contactEmail ?? "").trim() || String(merchantSessionIdentityRef.current.email ?? "").trim()) ?? "",
      merchantName: merchantDisplayName,
      accessToken: supportNativeAccessToken,
      refreshToken: supportNativeRefreshToken,
      officialLastReadAt: supportLastReadAt,
      peerLastRead: JSON.stringify(supportPeerLastReadMap),
      unreadCount: supportEffectiveBadgeCount,
      latestNotificationKey: supportLatestNativeNotificationKey,
      sound: supportMessageSoundEnabled,
      vibrate: supportVibrationEnabled,
    });
  }, [
    currentSupportMerchantId,
    editingSite?.contactEmail,
    editingSiteId,
    isPlatformEditor,
    merchantDisplayName,
    supportFaollaActive,
    supportDataActivated,
    supportEffectiveBadgeCount,
    supportLastReadAt,
    supportLatestNativeNotificationKey,
    supportMessageSoundEnabled,
    supportNativeAccessToken,
    supportNativeRefreshToken,
    supportPeerLastReadMap,
    supportReadMerchantId,
    supportSystemNotificationsEnabled,
    supportUnreadStateHydrated,
    supportVibrationEnabled,
  ]);

  useEffect(() => {
    if (isPlatformEditor || supportFaollaActive) return;
    void syncCurrentSupportPushSubscriptionState().catch(() => {
      // Ignore push bootstrap failures during initial app load.
    });
  }, [isPlatformEditor, supportFaollaActive, syncCurrentSupportPushSubscriptionState]);

  useEffect(() => {
    if (isPlatformEditor || typeof window === "undefined") return () => {};
    const handleNativePermission = (event: Event) => {
      const detail = (event as CustomEvent<{ permission?: unknown }>).detail;
      const permission =
        detail?.permission === "granted" || detail?.permission === "denied" || detail?.permission === "default"
          ? detail.permission
          : readSupportNativeNotificationPermission();
      setSupportPushPermission(permission);
      setSupportPushSubscribed(permission !== "unsupported" && permission !== "denied");
      if (permission === "denied") {
        setSupportPushError("通知已被系统拦截，请在系统设置里允许 Faolla 通知。");
      } else {
        setSupportPushError("");
      }
    };
    window.addEventListener("faolla-native-notification-permission", handleNativePermission as EventListener);
    return () => {
      window.removeEventListener("faolla-native-notification-permission", handleNativePermission as EventListener);
    };
  }, [isPlatformEditor]);

  useEffect(() => {
    if (isPlatformEditor || supportFaollaActive || !supportSystemNotificationsEnabled || !canUseFaollaNativeNotifications()) return;
    const permission = readSupportNativeNotificationPermission();
    setSupportPushPermission(permission);
    setSupportPushSubscribed(permission !== "unsupported" && permission !== "denied");
    if (permission === "default") {
      requestFaollaNativeNotificationPermission();
    }
  }, [isPlatformEditor, supportFaollaActive, supportSystemNotificationsEnabled]);

  useEffect(() => {
    if (isPlatformEditor || supportFaollaActive || !supportSystemNotificationsEnabled || canUseFaollaNativeNotifications()) return;
    void ensureSupportPushSubscription().catch(() => {
      // Ignore background subscription refresh failures.
    });
  }, [
    ensureSupportPushSubscription,
    isPlatformEditor,
    supportFaollaActive,
    supportPushPermission,
    supportSystemNotificationsEnabled,
  ]);

  useEffect(() => {
    if (
      isPlatformEditor ||
      supportFaollaActive ||
      !supportDataActivated ||
      !supportPushBadgeHydrated ||
      !supportSystemNotificationsEnabled ||
      supportPushPermission !== "granted" ||
      !supportPushEndpoint
    ) {
      return;
    }
    void sendSupportPushAction({
      action: "sync-badge",
      endpoint: supportPushEndpoint,
      unreadCount: supportEffectiveBadgeCount,
      permission: supportPushPermission,
    })
      .then(() => {
        setSupportRemoteBadgeCount(supportEffectiveBadgeCount);
      })
      .catch(() => {
      // Ignore badge sync failures; local badge updates still continue.
    });
  }, [
    isPlatformEditor,
    sendSupportPushAction,
    supportFaollaActive,
    supportDataActivated,
    supportEffectiveBadgeCount,
    supportPushEndpoint,
    supportPushBadgeHydrated,
    supportPushPermission,
    supportSystemNotificationsEnabled,
  ]);

  useEffect(() => {
    if (isPlatformEditor || !supportInterfaceOpen || !selectedSupportConversationVisible || typeof window === "undefined") return;
    if (
      selectedSupportLoading ||
      !selectedSupportReadStateHydrated ||
      !selectedSupportConversationKey
    ) {
      return;
    }
    const viewport = supportMessagesViewportRef.current;
    if (!viewport) return;
    const shouldScrollToInitialTarget = supportScrollToLatestPendingRef.current;
    if (
      shouldScrollToInitialTarget &&
      supportInitialScrollConversationKeyRef.current !== selectedSupportConversationKey
    ) {
      return;
    }
    const previousMessageKeys = supportVisibleMessageKeysRef.current;
    const currentMessageKeys = visibleSupportScrollMessages.map((message) => message.key);
    const firstNewIncomingMessageKey = shouldScrollToInitialTarget
      ? ""
      : findFirstNewIncomingSupportMessageKey(visibleSupportScrollMessages, previousMessageKeys);
    const shouldScrollForNewMessage =
      !!latestVisibleSupportMessageKey && supportLastVisibleMessageKeyRef.current !== latestVisibleSupportMessageKey;
    supportVisibleMessageKeysRef.current = currentMessageKeys;
    supportLastVisibleMessageKeyRef.current = latestVisibleSupportMessageKey;
    const shouldStartScroll = shouldScrollToInitialTarget || shouldScrollForNewMessage;
    const shouldContinueStabilizing =
      !shouldStartScroll && Date.now() < supportScrollStabilizationUntilRef.current;
    if (!shouldStartScroll && !shouldContinueStabilizing) return;

    let targetMessageKey = supportScrollStabilizationTargetKeyRef.current;
    let behavior: ScrollBehavior = "auto";
    if (shouldStartScroll) {
      // Initial opens fall through to the exact bottom; live updates target their first incoming message.
      targetMessageKey = shouldScrollToInitialTarget
        ? ""
        : firstNewIncomingMessageKey;
      behavior = shouldScrollToInitialTarget ? "auto" : "smooth";
      supportScrollStabilizationTargetKeyRef.current = targetMessageKey;
      supportScrollStabilizationUntilRef.current = Date.now() + 30000;
      supportScrollToLatestPendingRef.current = false;
    }

    let userInterrupted = false;
    const rafIds = new Set<number>();
    const scrollToSelectedPosition = (nextBehavior: ScrollBehavior) => {
      if (userInterrupted || Date.now() >= supportScrollStabilizationUntilRef.current) return;
      if (targetMessageKey) {
        const targetElement = supportMessageElementByKeyRef.current[targetMessageKey];
        if (targetElement && viewport.contains(targetElement)) {
          const viewportRect = viewport.getBoundingClientRect();
          const targetRect = targetElement.getBoundingClientRect();
          const maxScrollTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
          const targetScrollTop = Math.max(
            0,
            Math.min(maxScrollTop, viewport.scrollTop + targetRect.top - viewportRect.top - 12),
          );
          viewport.scrollTo({ top: targetScrollTop, behavior: nextBehavior });
          return;
        }
      }
      viewport.scrollTo({ top: viewport.scrollHeight, behavior: nextBehavior });
    };
    const queueScroll = (nextBehavior: ScrollBehavior) => {
      const rafId = window.requestAnimationFrame(() => {
        rafIds.delete(rafId);
        scrollToSelectedPosition(nextBehavior);
      });
      rafIds.add(rafId);
    };
    const timers = [0, 80, 240, 600, 1200, 2400].map((delay, index) =>
      window.setTimeout(() => {
        queueScroll(index === 0 ? behavior : "auto");
      }, delay),
    );

    const messageList = viewport.querySelector<HTMLElement>("[data-support-message-list='true']");
    const resizeObserver =
      typeof ResizeObserver === "undefined" || !messageList
        ? null
        : new ResizeObserver(() => queueScroll("auto"));
    if (messageList && resizeObserver) {
      resizeObserver.observe(messageList);
    }

    const stopStabilizingScroll = () => {
      userInterrupted = true;
      supportScrollStabilizationTargetKeyRef.current = "";
      supportScrollStabilizationUntilRef.current = 0;
      resizeObserver?.disconnect();
    };
    const handleMediaLoad = (event: Event) => {
      const target = event.target;
      if (target instanceof HTMLImageElement || target instanceof HTMLVideoElement) {
        queueScroll("auto");
      }
    };
    viewport.addEventListener("load", handleMediaLoad, true);
    viewport.addEventListener("wheel", stopStabilizingScroll, { passive: true });
    viewport.addEventListener("touchstart", stopStabilizingScroll, { passive: true });
    viewport.addEventListener("pointerdown", stopStabilizingScroll, { passive: true });
    timers.push(
      window.setTimeout(
        stopStabilizingScroll,
        Math.max(0, supportScrollStabilizationUntilRef.current - Date.now()),
      ),
    );

    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
      rafIds.forEach((rafId) => window.cancelAnimationFrame(rafId));
      resizeObserver?.disconnect();
      viewport.removeEventListener("load", handleMediaLoad, true);
      viewport.removeEventListener("wheel", stopStabilizingScroll);
      viewport.removeEventListener("touchstart", stopStabilizingScroll);
      viewport.removeEventListener("pointerdown", stopStabilizingScroll);
    };
  }, [
    isPlatformEditor,
    latestVisibleSupportMessageKey,
    selectedSupportConversationKey,
    selectedSupportConversationVisible,
    selectedSupportLoading,
    selectedSupportReadStateHydrated,
    supportInterfaceOpen,
    visibleSupportScrollMessages,
  ]);

  useEffect(() => {
    if (isIosSupportBrowser || !showMobileSupportThread || mobileVisualViewportMetrics.bottom <= 0 || typeof window === "undefined") return;
    const viewport = supportMessagesViewportRef.current;
    if (!viewport) return;
    const timer = window.setTimeout(() => {
      viewport.scrollTo({ top: viewport.scrollHeight, behavior: "auto" });
    }, 48);
    return () => {
      window.clearTimeout(timer);
    };
  }, [isIosSupportBrowser, mobileVisualViewportMetrics.bottom, showMobileSupportThread]);
  useEffect(() => {
    if (!isIosSupportBrowser || !showMobileSupportThread || typeof document === "undefined" || typeof window === "undefined") return;

    const timers = new Set<number>();
    const syncFocusedComposerIntoStableViewport = (delay = 0) => {
      const timer = window.setTimeout(() => {
        timers.delete(timer);
        const activeElement = document.activeElement;
        const composer = supportComposerRef.current;
        const viewport = supportMessagesViewportRef.current;
        if (!(activeElement instanceof HTMLElement) || !composer || !composer.contains(activeElement) || !viewport) return;
        window.scrollTo({ top: 0, left: 0, behavior: "auto" });
        viewport.scrollTo({ top: viewport.scrollHeight, behavior: "auto" });
      }, delay);
      timers.add(timer);
    };

    const handleFocusIn = (event: FocusEvent) => {
      const target = event.target;
      const composer = supportComposerRef.current;
      if (!(target instanceof HTMLElement) || !composer || !composer.contains(target)) return;
      syncFocusedComposerIntoStableViewport(140);
      syncFocusedComposerIntoStableViewport(320);
      syncFocusedComposerIntoStableViewport(520);
    };

    const handleViewportResize = () => {
      syncFocusedComposerIntoStableViewport(160);
    };

    document.addEventListener("focusin", handleFocusIn);
    window.addEventListener("resize", handleViewportResize);
    window.visualViewport?.addEventListener("resize", handleViewportResize);
    window.visualViewport?.addEventListener("scroll", handleViewportResize);
    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
      document.removeEventListener("focusin", handleFocusIn);
      window.removeEventListener("resize", handleViewportResize);
      window.visualViewport?.removeEventListener("resize", handleViewportResize);
      window.visualViewport?.removeEventListener("scroll", handleViewportResize);
    };
  }, [isIosSupportBrowser, showMobileSupportThread]);
  useEffect(() => {
    if (
      isPlatformEditor ||
      isMobileSupportDialog ||
      !supportInterfaceOpen ||
      !selectedSupportConversationVisible ||
      selectedSupportLoading ||
      supportComposerBusy
    ) {
      return;
    }
    focusSupportInput();
  }, [
    focusSupportInput,
    isMobileSupportDialog,
    isPlatformEditor,
    selectedSupportConversationVisible,
    selectedSupportLoading,
    supportComposerBusy,
    supportInterfaceOpen,
  ]);

  function resetSupportPickerInputValue(input: HTMLInputElement | null) {
    if (!input) return;
    input.value = "";
  }

  function buildSupportUploadMerchantHint() {
    return (
      editingSiteId ||
      merchantSessionIdentityRef.current.merchantId ||
      supportReadMerchantId ||
      merchantDisplayName ||
      "public"
    ).trim();
  }

  async function uploadSupportAssetDataUrl(
    dataUrl: string,
    folder: "merchant-assets" | "merchant-files" | "merchant-audio" = "merchant-assets",
  ) {
    const usage =
      folder === "merchant-files" ? "support-file" : folder === "merchant-audio" ? "audio" : "support-image";
    const operation =
      folder === "merchant-files"
        ? {
            operationModule: "会话",
            operationAction: "上传会话文件",
            operationSummary: "在会话中上传文件附件",
          }
        : folder === "merchant-audio"
          ? {
              operationModule: "会话",
              operationAction: "上传会话音频",
              operationSummary: "在会话中上传音频附件",
            }
          : {
              operationModule: "会话",
              operationAction: "上传会话图片",
              operationSummary: "在会话中上传图片附件",
            };
    const response = await runWithMerchantOperationContext(operation, () =>
      requestMerchantChatWithSessionRecovery("/api/assets/upload", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          dataUrl,
          merchantHint: buildSupportUploadMerchantHint(),
          folder,
          usage,
        }),
      }),
    );
    const payload = (await response.json().catch(() => null)) as
      | {
          ok?: boolean;
          url?: unknown;
          message?: unknown;
        }
      | null;
    const uploadedUrl = typeof payload?.url === "string" ? payload.url.trim() : "";
    if (response.ok && uploadedUrl) {
      return {
        ok: true as const,
        url: uploadedUrl,
        message: "",
      };
    }
    return {
      ok: false as const,
      url: "",
      message: typeof payload?.message === "string" ? payload.message.trim() : "",
    };
  }

  function buildSupportPhotoMessageText(label: "照片" | "拍照", fileName: string, url: string) {
    return [`${label}：${fileName || "图片"}`, url].filter(Boolean).join("\n");
  }

  function buildSupportLocationMapPreviewUrl(latitude: number, longitude: number) {
    const lat = latitude.toFixed(6);
    const lng = longitude.toFixed(6);
    return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
  }

  function buildSupportLocationMessageText(latitude: number, longitude: number, accuracy: number | null) {
    const lat = latitude.toFixed(6);
    const lng = longitude.toFixed(6);
    const accuracyLabel =
      typeof accuracy === "number" && Number.isFinite(accuracy) && accuracy > 0
        ? `（约 ${Math.round(accuracy)} 米）`
        : "";
    return [`位置：${lat}, ${lng}${accuracyLabel}`, buildSupportLocationMapPreviewUrl(latitude, longitude)].join("\n");
  }

  function buildSupportFileMessageText(file: File, url: string) {
    const fileName = file.name.trim() || "文件";
    return [`文件：${fileName} (${formatSupportAttachmentFileSize(file.size)})`, url].join("\n");
  }

function buildSupportSelfBusinessCardImageMessageText(input: {
  card: MerchantBusinessCardAsset;
  imageUrl?: string;
}) {
  const imageUrl =
    normalizeSupportDisplayValue(input.imageUrl) ||
    normalizeSupportDisplayValue(input.card.shareImageUrl) ||
    normalizeSupportDisplayValue(input.card.imageUrl);
  return imageUrl;
}

function buildSupportSelfBusinessCardLinkMessageText(input: {
  card: MerchantBusinessCardAsset;
  shareUrl?: string;
}) {
  const shareUrl =
    normalizeSupportDisplayValue(input.shareUrl) ||
    normalizeSupportDisplayValue(buildSupportMerchantCardLink(input.card));
  return shareUrl ? ["联系卡", shareUrl].join("\n") : "";
}

  async function sendSupportTextPayload(rawText: string, options?: { clearDraft?: boolean; allowSequential?: boolean }) {
    if (supportSendingRef.current || (!options?.allowSequential && supportSending)) return false;
    const text = rawText.trim();
    if (!text) {
      showTip("请先填写留言内容");
      return false;
    }
    const isOfficialContact = supportSelectedContactKey === SUPPORT_OFFICIAL_CONTACT_KEY;
    if (!isOfficialContact && !selectedSupportPeerContact) {
      showTip("请先在左侧精确搜索商户ID或邮箱");
      return false;
    }
    const merchantId = supportReadMerchantId || editingSiteId || merchantSessionIdentityRef.current.merchantId || "default";
    const requestId = ++supportRequestIdRef.current;
    supportSendingRef.current = true;
    setSupportSending(true);
    setSupportError("");
    setSupportAttachmentMenuOpen(false);
    setSupportEmojiMenuOpen(false);
    setSupportSelfCardPickerOpen(false);
    setSupportMessageContextMenu(null);
    if (options?.clearDraft) {
      setSupportDraft("");
    }
    if (isOfficialContact) {
      const localMessage: LocalSupportMessage = {
        id: `local-support-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        merchantId,
        sender: "merchant",
        text,
        createdAt: new Date().toISOString(),
        status: "pending",
      };
      setSupportLocalMessages((current) => [...current, localMessage]);
      try {
        const response = await requestSupportWithSessionRecovery({
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            text,
            merchantName: merchantDisplayName,
            merchantEmail:
              (editingSite?.contactEmail ?? "").trim() ||
              merchantSessionIdentityRef.current.email ||
              "",
            siteId: (editingSiteId || merchantSessionIdentityRef.current.merchantId || "").trim(),
          }),
        });
        const payload = (await response.json().catch(() => null)) as
          | {
              thread?: PlatformSupportThread | null;
              error?: string;
              message?: string;
            }
          | null;
        if (requestId !== supportRequestIdRef.current) return;
        setSupportLoading(false);
        if (!response.ok) {
          setSupportLocalMessages((current) =>
            current.map((message) =>
              message.id === localMessage.id
                ? {
                    ...message,
                    status: "failed",
                  }
                : message,
            ),
          );
          setSupportError(payload?.message || "留言发送失败，请稍后重试");
          return false;
        }
        setSupportLocalMessages((current) => current.filter((message) => message.id !== localMessage.id));
        setSupportError("");
        setSupportThread(payload?.thread ?? null);
        return true;
      } catch {
        if (requestId !== supportRequestIdRef.current) return false;
        setSupportLoading(false);
        setSupportLocalMessages((current) =>
          current.map((message) =>
            message.id === localMessage.id
              ? {
                  ...message,
                  status: "failed",
                }
              : message,
          ),
        );
        setSupportError("留言发送失败，请稍后重试");
        return false;
      } finally {
        supportSendingRef.current = false;
        setSupportSending(false);
      }
      return false;
    }

    const peerMerchantId = selectedSupportPeerContact?.merchantId || "";
    const localPeerMessage: LocalPeerSupportMessage = {
      id: `local-peer-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      contactMerchantId: peerMerchantId,
      senderMerchantId: merchantId,
      text,
      createdAt: new Date().toISOString(),
      status: "pending",
    };
    setSupportPeerLocalMessages((current) => [...current, localPeerMessage]);
    try {
      const response = await requestMerchantPeerWithSessionRecovery({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "send",
          recipientMerchantId: peerMerchantId,
          text,
          merchantName: merchantDisplayName,
          merchantEmail:
            (editingSite?.contactEmail ?? "").trim() ||
            merchantSessionIdentityRef.current.email ||
            "",
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | {
            contacts?: MerchantPeerContactSummary[];
            threads?: MerchantPeerThread[];
            error?: string;
            message?: string;
          }
        | null;
      if (requestId !== supportRequestIdRef.current) return false;
      if (!response.ok) {
        setSupportPeerLocalMessages((current) =>
          current.map((message) =>
            message.id === localPeerMessage.id
              ? {
                  ...message,
                  status: "failed",
                }
              : message,
          ),
        );
        setSupportError(payload?.message || "消息发送失败，请稍后重试");
        return false;
      }
      setSupportPeerLocalMessages((current) => current.filter((message) => message.id !== localPeerMessage.id));
      setSupportPeerContacts(Array.isArray(payload?.contacts) ? payload.contacts : []);
      setSupportPeerThreads(Array.isArray(payload?.threads) ? payload.threads : []);
      setSupportError("");
      return true;
    } catch {
      if (requestId !== supportRequestIdRef.current) return false;
      setSupportPeerLocalMessages((current) =>
        current.map((message) =>
          message.id === localPeerMessage.id
            ? {
                ...message,
                status: "failed",
              }
            : message,
        ),
      );
      setSupportError("消息发送失败，请稍后重试");
      return false;
    } finally {
      supportSendingRef.current = false;
      setSupportSending(false);
    }
    return false;
  }

  function createSupportPendingImageDraftId() {
    return `support-image-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function getSupportPendingImageFileName(rawText: string) {
    const firstLine = rawText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean);
    if (!firstLine) return "图片";
    return firstLine.replace(/^(?:图片|照片|拍照|联系卡)\s*[：:]\s*/u, "").trim() || "图片";
  }

  function createSupportPendingImageDraftFromMessage(rawText: string): SupportPendingImageDraft | null {
    const messageText = getSupportDisplayMessageText(rawText).trim();
    if (!messageText) return null;
    const preview = parseSupportMessageAttachmentPreview(messageText);
    if (!preview?.imageUrl) return null;
    return {
      id: createSupportPendingImageDraftId(),
      source: "message",
      previewUrl: normalizePublicAssetUrl(preview.imageUrl),
      fileName: getSupportPendingImageFileName(messageText),
      label: "照片",
      messageText,
    };
  }

  async function queueSupportImageDraftFromFile(file: File, label: "照片" | "拍照") {
    if (supportComposerBusy) return;
    try {
      const { fileToDataUrl } = await loadEditorAssetProcessing();
      const previewUrl = await fileToDataUrl(file);
      setSupportPendingImageDrafts((current) => [
        ...current,
        {
          id: createSupportPendingImageDraftId(),
          source: "file",
          previewUrl,
          fileName: file.name.trim() || `${label}.jpg`,
          label,
          file,
        },
      ]);
      setSupportAttachmentMenuOpen(false);
      setSupportEmojiMenuOpen(false);
      setSupportSelfCardPickerOpen(false);
      setSupportMessageContextMenu(null);
      focusSupportInput();
    } catch {
      showTip("图片读取失败，请重新复制图片");
    }
  }

  async function uploadSupportImageAttachment(file: File, label: "照片" | "拍照") {
    const {
      compressImageDataUrl,
      compressImageFileWithinLimit,
      fileToDataUrl,
    } = await loadEditorAssetProcessing();
    const imageCompression = {
      maxSide: 1440,
      quality: 0.76,
    };
    const originalDataUrl = await fileToDataUrl(file);
    let uploadedDataUrl = await compressImageDataUrl(originalDataUrl, imageCompression);
    let uploadedBytes = estimateDataUrlBytes(uploadedDataUrl);
    if (uploadedBytes > 50 * 1024) {
      const compressed = await compressImageFileWithinLimit(file, 50 * 1024, imageCompression);
      uploadedDataUrl = compressed.dataUrl;
      uploadedBytes = compressed.bytes;
    }
    if (!/^data:image\/webp/i.test(uploadedDataUrl)) {
      uploadedDataUrl = await compressImageDataUrl(uploadedDataUrl, {
        maxSide: 1280,
        quality: 0.7,
      });
      uploadedBytes = estimateDataUrlBytes(uploadedDataUrl);
    }
    if (uploadedBytes > 50 * 1024) {
      uploadedDataUrl = await compressImageDataUrl(uploadedDataUrl, {
        maxSide: 1080,
        quality: 0.62,
      });
      uploadedBytes = estimateDataUrlBytes(uploadedDataUrl);
    }
    if (uploadedBytes > 50 * 1024) {
      throw new Error(`${label}已自动压缩，但仍超过当前上传上限`);
    }
    const uploadResult = await uploadSupportAssetDataUrl(uploadedDataUrl, "merchant-assets");
    if (!uploadResult.ok || !uploadResult.url) {
      throw new Error(uploadResult.message || `${label}上传失败，请稍后重试`);
    }
    return uploadResult.url;
  }

  async function sendSupportPendingImageDraft(
    draft: SupportPendingImageDraft,
    options?: { replyDraft?: SupportReplyDraft | null },
  ) {
    let messageText = normalizeSupportDisplayValue(draft.messageText);
    if (!messageText) {
      if (!draft.file) return false;
      const uploadedUrl = await uploadSupportImageAttachment(draft.file, draft.label);
      messageText = buildSupportPhotoMessageText(draft.label, draft.fileName || `${draft.label}.jpg`, uploadedUrl);
    }
    const outgoingText = options?.replyDraft ? buildSupportReplyMessageText(options.replyDraft, messageText) : messageText;
    return sendSupportTextPayload(outgoingText, { clearDraft: false, allowSequential: true });
  }

  async function sendSupportMessage() {
    if (supportComposerBusy) return;
    const pendingImages = supportPendingImageDrafts;
    if (pendingImages.length === 0) {
      const rawText = supportReplyDraft ? buildSupportReplyMessageText(supportReplyDraft, supportDraft) : supportDraft;
      const sent = await sendSupportTextPayload(rawText, { clearDraft: true });
      if (sent) {
        setSupportReplyDraft(null);
      }
      return;
    }

    const draftHasText = !!supportDraft.trim();
    const sentImageIds: string[] = [];
    setSupportAttachmentBusy(true);
    try {
      for (let index = 0; index < pendingImages.length; index += 1) {
        const draft = pendingImages[index];
        const sent = await sendSupportPendingImageDraft(draft, {
          replyDraft: !draftHasText && index === 0 ? supportReplyDraft : null,
        });
        if (!sent) {
          setSupportPendingImageDrafts((current) => current.filter((item) => !sentImageIds.includes(item.id)));
          return;
        }
        sentImageIds.push(draft.id);
      }
      setSupportPendingImageDrafts([]);
      if (draftHasText) {
        const rawText = supportReplyDraft ? buildSupportReplyMessageText(supportReplyDraft, supportDraft) : supportDraft;
        const sentText = await sendSupportTextPayload(rawText, { clearDraft: true, allowSequential: true });
        if (sentText) {
          setSupportReplyDraft(null);
        }
        return;
      }
      setSupportDraft("");
      setSupportReplyDraft(null);
    } catch (error) {
      showTip(error instanceof Error ? error.message : "图片发送失败，请稍后重试");
      setSupportPendingImageDrafts((current) => current.filter((item) => !sentImageIds.includes(item.id)));
    } finally {
      setSupportAttachmentBusy(false);
    }
  }

  function insertSupportDraftText(insertText: string, target?: HTMLTextAreaElement | null) {
    const input = target ?? supportInputRef.current;
    const draftValue = supportDraft;
    const start =
      input && typeof input.selectionStart === "number"
        ? Math.max(0, Math.min(input.selectionStart, draftValue.length))
        : draftValue.length;
    const end =
      input && typeof input.selectionEnd === "number"
        ? Math.max(start, Math.min(input.selectionEnd, draftValue.length))
        : start;
    const nextDraft = `${draftValue.slice(0, start)}${insertText}${draftValue.slice(end)}`;
    const nextCaretPosition = start + insertText.length;
    setSupportDraft(nextDraft);
    if (typeof window === "undefined") return;
    window.requestAnimationFrame(() => {
      const nextInput = target ?? supportInputRef.current;
      if (!nextInput || nextInput.disabled) return;
      nextInput.focus({ preventScroll: true });
      try {
        nextInput.setSelectionRange(nextCaretPosition, nextCaretPosition);
      } catch {
        // Ignore browsers that do not allow setting selection here.
      }
      resizeSupportComposerInput(nextInput);
      keepSupportComposerCaretVisible(nextInput);
    });
  }

  function handleSupportComposerKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
    if (event.ctrlKey) {
      event.preventDefault();
      insertSupportDraftText("\n", event.currentTarget);
      return;
    }
    if (event.metaKey || event.altKey || event.shiftKey) return;
    event.preventDefault();
    void sendSupportMessage();
  }

  function handleSupportComposerPaste(event: ReactClipboardEvent<HTMLTextAreaElement>) {
    if (!supportComposerAvailable || supportComposerBusy) return;
    const clipboardData = event.clipboardData;
    const imageFromFiles = Array.from(clipboardData.files ?? []).find(isSupportImageFile);
    const imageFromItems = Array.from(clipboardData.items ?? [])
      .find((item) => item.kind === "file" && item.type.toLowerCase().startsWith("image/"))
      ?.getAsFile();
    const imageFile = imageFromFiles ?? imageFromItems ?? null;
    if (!imageFile) return;
    event.preventDefault();
    void queueSupportImageDraftFromFile(imageFile, "照片");
  }

  function appendSupportEmoji(emoji: string) {
    insertSupportDraftText(emoji);
    setSupportEmojiMenuOpen(false);
    setSupportAttachmentMenuOpen(false);
    setSupportMessageContextMenu(null);
  }

  function getSupportContextPreviewText(text: string) {
    const normalized = text.replace(/\s+/g, " ").trim();
    if (!normalized) return "消息";
    return normalized.length > 48 ? `${normalized.slice(0, 48)}...` : normalized;
  }

  function openSupportMessageContextMenu(
    event: ReactMouseEvent,
    message: {
      id: string;
      text: string;
      createdAt: string;
      isSelf: boolean;
      localStatus?: LocalSupportMessageStatus | null;
    },
  ) {
    event.preventDefault();
    event.stopPropagation();
    const menuWidth = 168;
    const menuHeight = 316;
    const viewportWidth = typeof window === "undefined" ? 0 : window.innerWidth;
    const viewportHeight = typeof window === "undefined" ? 0 : window.innerHeight;
    const nextX = viewportWidth > 0 ? Math.min(event.clientX, Math.max(8, viewportWidth - menuWidth - 8)) : event.clientX;
    const nextY = viewportHeight > 0 ? Math.min(event.clientY, Math.max(8, viewportHeight - menuHeight - 8)) : event.clientY;
    setSupportAttachmentMenuOpen(false);
    setSupportEmojiMenuOpen(false);
    setSupportSelfCardPickerOpen(false);
    setSupportFailedMessageActionKey("");
    setSupportMessageContextMenu({
      key: buildVisibleSupportMessageKey(message),
      text: message.text,
      isSelf: message.isSelf,
      localStatus: message.localStatus ?? null,
      x: nextX,
      y: nextY,
    });
  }

  function toggleSupportMessageSelection(key: string) {
    setSupportSelectedMessageKeys((current) =>
      current.includes(key) ? current.filter((item) => item !== key) : [...current, key],
    );
  }

  function clearSupportMessageSelection() {
    setSupportSelectedMessageKeys([]);
  }

  function runSupportSelectedMessagesAction(action: "forward" | "star" | "delete") {
    const selectedKeys = selectedSupportMessages.map((message) => buildVisibleSupportMessageKey(message));
    if (!selectedKeys.length) return;
    if (action === "forward") {
      const pendingImages: SupportPendingImageDraft[] = [];
      const textParts: string[] = [];
      selectedSupportMessages.forEach((message) => {
        const displayText = getSupportDisplayMessageText(message.text).trim();
        if (!displayText) return;
        const pendingImage = createSupportPendingImageDraftFromMessage(displayText);
        if (pendingImage) {
          pendingImages.push(pendingImage);
          return;
        }
        textParts.push(displayText);
      });
      setSupportPendingImageDrafts(pendingImages);
      setSupportDraft(textParts.join("\n\n"));
      clearSupportMessageSelection();
      showTip(pendingImages.length ? "已放入待发送内容，可切换会话后发送" : "已放入输入框，可切换会话后发送");
      focusSupportInput();
      return;
    }
    if (action === "star") {
      setSupportStarredMessageKeys((current) => Array.from(new Set([...current, ...selectedKeys])));
      clearSupportMessageSelection();
      showTip("已添加星标");
      return;
    }
    setSupportHiddenMessageKeys((current) => Array.from(new Set([...current, ...selectedKeys])));
    setSupportPinnedMessage((current) => (current && selectedKeys.includes(current.key) ? null : current));
    setSupportStarredMessageKeys((current) => current.filter((key) => !selectedKeys.includes(key)));
    clearSupportMessageSelection();
  }

  function runSupportMessageContextAction(
    action: "reply" | "copy" | "forward" | "pin" | "star" | "select" | "delete",
  ) {
    const context = supportMessageContextMenu;
    if (!context) return;
    const displayText = getSupportDisplayMessageText(context.text);
    const previewText = getSupportContextPreviewText(displayText);
    setSupportMessageContextMenu(null);
    if (action === "reply") {
      setSupportReplyDraft({
        key: context.key,
        senderLabel: context.isSelf ? "我" : selectedSupportDisplayName,
        text: previewText,
      });
      focusSupportInput();
      return;
    }
    if (action === "copy") {
      void copySupportTextToClipboard(displayText)
        .then(() => showTip("已复制"))
        .catch(() => showTip("复制失败，请手动选择复制"));
      return;
    }
    if (action === "forward") {
      const pendingImage = createSupportPendingImageDraftFromMessage(displayText);
      if (pendingImage) {
        setSupportPendingImageDrafts([pendingImage]);
        setSupportDraft("");
        showTip("已放入待发送图片，可切换会话后发送");
      } else {
        setSupportPendingImageDrafts([]);
        setSupportDraft(displayText);
        showTip("已放入输入框，可切换会话后发送");
      }
      focusSupportInput();
      return;
    }
    if (action === "pin") {
      setSupportPinnedMessage((current) =>
        current?.key === context.key
          ? null
          : {
              key: context.key,
              text: previewText,
            },
      );
      return;
    }
    if (action === "star") {
      setSupportStarredMessageKeys((current) =>
        current.includes(context.key) ? current.filter((key) => key !== context.key) : [...current, context.key],
      );
      return;
    }
    if (action === "select") {
      setSupportSelectedMessageKeys((current) =>
        current.includes(context.key) ? current.filter((key) => key !== context.key) : [...current, context.key],
      );
      return;
    }
    setSupportHiddenMessageKeys((current) => (current.includes(context.key) ? current : [...current, context.key]));
    setSupportPinnedMessage((current) => (current?.key === context.key ? null : current));
    setSupportStarredMessageKeys((current) => current.filter((key) => key !== context.key));
    setSupportSelectedMessageKeys((current) => current.filter((key) => key !== context.key));
  }

  function removeFailedSupportMessage(message: { id: string }) {
    if (supportSelectedContactKey === SUPPORT_OFFICIAL_CONTACT_KEY) {
      setSupportLocalMessages((current) => current.filter((item) => item.id !== message.id));
    } else {
      setSupportPeerLocalMessages((current) => current.filter((item) => item.id !== message.id));
    }
    setSupportFailedMessageActionKey("");
    setSupportError("");
  }

  async function retryFailedSupportMessage(message: { id: string; text: string }) {
    const text = String(message.text ?? "").trim();
    if (!text) {
      removeFailedSupportMessage(message);
      return;
    }
    removeFailedSupportMessage(message);
    await sendSupportTextPayload(text, { clearDraft: false });
  }

  async function handleSupportImageAttachment(file: File, label: "照片" | "拍照") {
    if (supportComposerBusy) return;
    setSupportAttachmentBusy(true);
    setSupportAttachmentMenuOpen(false);
    setSupportEmojiMenuOpen(false);
    setSupportSelfCardPickerOpen(false);
    supportInputRef.current?.blur();
    try {
      const uploadedUrl = await uploadSupportImageAttachment(file, label);
      await sendSupportTextPayload(buildSupportPhotoMessageText(label, file.name.trim() || `${label}.jpg`, uploadedUrl));
    } catch (error) {
      showTip(error instanceof Error ? error.message : `${label}发送失败，请稍后重试`);
    } finally {
      setSupportAttachmentBusy(false);
    }
  }

  async function handleSupportFileAttachment(file: File) {
    if (supportComposerBusy) return;
    if (isSupportImageFile(file)) {
      await handleSupportImageAttachment(file, "照片");
      return;
    }
    setSupportAttachmentBusy(true);
    setSupportAttachmentMenuOpen(false);
    setSupportEmojiMenuOpen(false);
    setSupportSelfCardPickerOpen(false);
    supportInputRef.current?.blur();
    try {
      const { fileToChatFileDataUrl } = await loadEditorAssetProcessing();
      const uploadResult = await uploadSupportAssetDataUrl(await fileToChatFileDataUrl(file), "merchant-files");
      if (!uploadResult.ok || !uploadResult.url) {
        throw new Error(uploadResult.message || "文件上传失败，请稍后重试");
      }
      await sendSupportTextPayload(buildSupportFileMessageText(file, uploadResult.url));
    } catch (error) {
      showTip(error instanceof Error ? error.message : "文件发送失败，请稍后重试");
    } finally {
      setSupportAttachmentBusy(false);
    }
  }

  async function pickSupportFileViaTemporaryInput(
    options: {
      accept: string;
      capture?: "environment" | "user";
      onFile: (file: File) => Promise<void>;
    },
  ) {
    if (typeof document === "undefined") return;
    const input = document.createElement("input");
    input.type = "file";
    input.accept = options.accept;
    input.tabIndex = -1;
    input.setAttribute("aria-hidden", "true");
    if (options.capture) {
      input.setAttribute("capture", options.capture);
    }
    Object.assign(input.style, {
      position: "fixed",
      left: "-9999px",
      width: "1px",
      height: "1px",
      opacity: "0",
      pointerEvents: "none",
    });
    let settled = false;
    const cleanup = () => {
      if (settled) return;
      settled = true;
      window.removeEventListener("focus", handleWindowFocus);
      input.removeEventListener("change", handleChange);
      input.remove();
    };
    const handleWindowFocus = () => {
      window.setTimeout(() => {
        if (!input.files?.length) {
          cleanup();
        }
      }, 0);
    };
    const handleChange = () => {
      const file = input.files?.[0] ?? null;
      cleanup();
      if (!file) return;
      void options.onFile(file);
    };
    window.addEventListener("focus", handleWindowFocus, { once: true });
    input.addEventListener("change", handleChange, { once: true });
    document.body.appendChild(input);
    input.click();
  }

  async function openSupportPhotoPicker() {
    if (supportComposerBusy) return;
    setSupportAttachmentMenuOpen(false);
    setSupportEmojiMenuOpen(false);
    setSupportSelfCardPickerOpen(false);
    supportInputRef.current?.blur();
    const pickerWindow = window as Window & {
      showOpenFilePicker?: (options?: unknown) => Promise<Array<{ getFile: () => Promise<File> }>>;
    };
    if (typeof pickerWindow.showOpenFilePicker === "function") {
      try {
        const handles = await pickerWindow.showOpenFilePicker({
          multiple: false,
          excludeAcceptAllOption: true,
          types: [
            {
              description: "照片",
              accept: {
                "image/*": [".png", ".jpg", ".jpeg", ".webp", ".heic", ".heif", ".gif"],
              },
            },
          ],
        });
        const file = await handles?.[0]?.getFile?.();
        if (!file) return;
        await handleSupportImageAttachment(file, "照片");
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
      }
    }
    await pickSupportFileViaTemporaryInput({
      accept: SUPPORT_PHOTO_PICKER_ACCEPT,
      onFile: async (file) => handleSupportImageAttachment(file, "照片"),
    });
  }

  async function openSupportCameraPicker() {
    if (supportComposerBusy) return;
    setSupportAttachmentMenuOpen(false);
    setSupportEmojiMenuOpen(false);
    setSupportSelfCardPickerOpen(false);
    supportInputRef.current?.blur();
    await pickSupportFileViaTemporaryInput({
      accept: SUPPORT_PHOTO_PICKER_ACCEPT,
      capture: "environment",
      onFile: async (file) => handleSupportImageAttachment(file, "拍照"),
    });
  }

  async function openSupportFilePicker() {
    if (supportComposerBusy) return;
    setSupportAttachmentMenuOpen(false);
    setSupportEmojiMenuOpen(false);
    setSupportSelfCardPickerOpen(false);
    supportInputRef.current?.blur();
    const pickerWindow = window as Window & {
      showOpenFilePicker?: (options?: unknown) => Promise<Array<{ getFile: () => Promise<File> }>>;
    };
    if (typeof pickerWindow.showOpenFilePicker === "function") {
      try {
        const handles = await pickerWindow.showOpenFilePicker({
          multiple: false,
          excludeAcceptAllOption: true,
          types: [
            {
              description: "文件",
              accept: {
                "application/pdf": [".pdf"],
                "image/*": [".png", ".jpg", ".jpeg", ".webp", ".heic", ".heif", ".gif"],
                "text/plain": [".txt"],
                "text/csv": [".csv"],
                "application/json": [".json"],
                "application/zip": [".zip"],
                "application/x-rar-compressed": [".rar"],
                "application/x-7z-compressed": [".7z"],
                "application/msword": [".doc"],
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
                "application/vnd.ms-excel": [".xls"],
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
                "application/vnd.ms-powerpoint": [".ppt"],
                "application/vnd.openxmlformats-officedocument.presentationml.presentation": [".pptx"],
              },
            },
          ],
        });
        const file = await handles?.[0]?.getFile?.();
        if (!file) return;
        await handleSupportFileAttachment(file);
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
      }
    }
    await pickSupportFileViaTemporaryInput({
      accept: SUPPORT_FILE_PICKER_ACCEPT,
      onFile: async (file) => handleSupportFileAttachment(file),
    });
  }

  async function handleSupportLocationAttachment() {
    if (supportComposerBusy) return;
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      showTip("当前设备不支持位置发送");
      return;
    }
    setSupportAttachmentBusy(true);
    setSupportAttachmentMenuOpen(false);
    setSupportEmojiMenuOpen(false);
    setSupportSelfCardPickerOpen(false);
    supportInputRef.current?.blur();
    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 12000,
          maximumAge: 60000,
        });
      });
      const mapPreviewUrl = buildSupportLocationMapPreviewUrl(
        position.coords.latitude,
        position.coords.longitude,
      );
      const sent = await sendSupportTextPayload(
        buildSupportLocationMessageText(
          position.coords.latitude,
          position.coords.longitude,
          position.coords.accuracy,
        ),
      );
      if (sent && typeof window !== "undefined") {
        window.open(mapPreviewUrl, "_blank", "noopener,noreferrer");
      }
    } catch (error) {
      const nextMessage =
        error && typeof error === "object" && "code" in error && Number((error as { code?: unknown }).code) === 1
          ? "定位权限被拒绝，请先允许浏览器访问位置"
          : "位置发送失败，请稍后重试";
      showTip(nextMessage);
    } finally {
      setSupportAttachmentBusy(false);
    }
  }

  async function handleSupportBusinessCardAttachment(card: MerchantBusinessCardAsset) {
    if (supportComposerBusy) return;
    setSupportAttachmentBusy(true);
    setSupportAttachmentMenuOpen(false);
    setSupportEmojiMenuOpen(false);
    setSupportSelfCardPickerOpen(false);
    supportInputRef.current?.blur();
    try {
      const shareBundle = await ensureSupportBusinessCardShareBundle(card);
      const imageMessageText = buildSupportSelfBusinessCardImageMessageText({
        card,
        imageUrl: shareBundle.imageUrl,
      });
      if (!imageMessageText) {
        showTip("当前名片暂时无法发送，请稍后重试");
        return;
      }
      const sentImage = await sendSupportTextPayload(imageMessageText);
      if (!sentImage) {
        return;
      }
      if (card.mode === "link") {
        const linkMessageText = buildSupportSelfBusinessCardLinkMessageText({
          card,
          shareUrl: shareBundle.shareUrl,
        });
        if (!linkMessageText) {
          showTip("联系卡链接暂时没生成成功，已先发送名片图片");
          return;
        }
        const sentLink = await sendSupportTextPayload(linkMessageText, { allowSequential: true });
        if (!sentLink) {
          showTip("名片图已发送，但联系卡短链发送失败，请稍后重试");
        }
      }
    } finally {
      setSupportAttachmentBusy(false);
    }
  }

  function toggleSupportAttachmentMenu() {
    if (!supportComposerAvailable || supportComposerBusy) return;
    const nextOpen = !supportAttachmentMenuOpen;
    setSupportEmojiMenuOpen(false);
    setSupportMessageContextMenu(null);
    setSupportSelfCardPickerOpen(false);
    setSupportAttachmentMenuOpen(nextOpen);
    if (nextOpen) {
      supportInputRef.current?.blur();
    } else {
      focusSupportInput();
    }
  }

  async function openSupportSelfCardPicker() {
    setSupportAttachmentMenuOpen(false);
    setSupportEmojiMenuOpen(false);
    setSupportMessageContextMenu(null);
    supportInputRef.current?.blur();
    const merchantId = editingSiteId.trim();
    if (/^\d{8}$/.test(merchantId)) {
      try {
        const requestStartedAt = Date.now();
        const response = await requestMerchantChatBusinessCardById(merchantId, {
          cache: "no-store",
        });
        const payload = (await response.json().catch(() => null)) as
          | {
              profile?: MerchantListPublishedSite | null;
              chatBusinessCard?: MerchantBusinessCardAsset | null;
            }
          | null;
        if (response.ok) {
          if ((supportPeerProfileLocalMutationAtRef.current[merchantId] ?? 0) > requestStartedAt) {
            return;
          }
          supportPeerProfileFetchedAtRef.current[merchantId] = Date.now();
          setSupportPeerProfilesByMerchantId((current) => ({
            ...current,
            [merchantId]: payload?.profile ?? null,
          }));
          const nextCard = payload?.chatBusinessCard ?? payload?.profile?.chatBusinessCard ?? null;
          setSupportPeerBusinessCardByMerchantId((current) => ({
            ...current,
            [merchantId]: nextCard,
          }));
          const fetchedCards = sortSupportBusinessCardsForDisplay(
            normalizeMerchantBusinessCards(
              Array.isArray(payload?.profile?.businessCards) ? payload?.profile?.businessCards : [],
            ).filter((card) => !isSupportSnapshotFallbackBusinessCard(card)),
          );
          setSupportSelfCardPickerCards(fetchedCards);
          if (fetchedCards.length > 0) {
            setSupportSelfCardPickerOpen(true);
            return;
          }
        }
      } catch {
        // Ignore and fall through to the empty-state tip.
      }
    }

    if (supportSelfBusinessCards.length > 0) {
      setSupportSelfCardPickerCards(supportSelfBusinessCards);
      setSupportSelfCardPickerOpen(true);
      return;
    }

    setSupportSelfCardPickerCards([]);
    showTip("当前还没有可发送的名片，请先在商户资料里生成名片");
  }

  async function saveSupportSelfSitePatch(
    patch: {
      chatAvatarImageUrl?: string;
      signature?: string;
      contactVisibility?: MerchantContactVisibility;
      businessCards?: MerchantBusinessCardAsset[];
    },
    options?: {
      successTip?: string;
      skipProfileSync?: boolean;
    },
  ) {
    const targetSiteId = editingSiteId || (await ensureEditableMerchantSiteId());
    if (!targetSiteId) {
      showTip("未找到当前商户，暂时无法保存");
      return false;
    }

    const fallbackEmail =
      normalizeSupportDisplayValue(editingSite?.contactEmail) ||
      normalizeSupportDisplayValue(merchantSessionIdentityRef.current.email);
    ensureScopedMerchantSite(targetSiteId, fallbackEmail || null);
    const platformState = loadPlatformState();
    const currentSite = platformState.sites.find((item) => item.id === targetSiteId) ?? null;
    if (!currentSite) {
      showTip("未找到当前商户资料，暂时无法保存");
      return false;
    }

    const baseSite = mergeSupportPublishedProfileIntoSite(currentSite, supportSelfProfile);

    const nextBusinessCards = patch.businessCards
      ? normalizeMerchantBusinessCardChatDisplaySelection(patch.businessCards)
      : baseSite.businessCards ?? [];
    const nextContactVisibility =
      patch.contactVisibility ?? baseSite.contactVisibility ?? createDefaultMerchantContactVisibility();
    const nextChatAvatarImageUrl =
      typeof patch.chatAvatarImageUrl === "string"
        ? patch.chatAvatarImageUrl
        : normalizeSupportDisplayValue(baseSite.chatAvatarImageUrl);
    const nextSignature =
      typeof patch.signature === "string" ? normalizeSupportDisplayValue(patch.signature) : normalizeSupportDisplayValue(baseSite.signature);
    const nextSite: Site = {
      ...baseSite,
      businessCards: nextBusinessCards,
      chatAvatarImageUrl: nextChatAvatarImageUrl,
      signature: nextSignature,
      contactVisibility: nextContactVisibility,
      updatedAt: new Date().toISOString(),
    };
    const nextProfile = buildSupportPublishedProfileFromSite(nextSite);
    supportPeerProfileLocalMutationAtRef.current[targetSiteId] = Date.now();

    savePlatformState({
      ...platformState,
      sites: platformState.sites.map((item) => (item.id === targetSiteId ? nextSite : item)),
    });
    supportPeerProfileFetchedAtRef.current[targetSiteId] = Date.now();
    setSupportPeerProfilesByMerchantId((current) => ({
      ...current,
      [targetSiteId]: nextProfile,
    }));
    setSupportPeerBusinessCardByMerchantId((current) => ({
      ...current,
      [targetSiteId]: nextProfile.chatBusinessCard ?? null,
    }));

    if (patch.businessCards) {
      scheduleMerchantChatBusinessCardSync(targetSiteId, nextBusinessCards);
    }

    if (options?.skipProfileSync) {
      if (options?.successTip) {
        showTip(options.successTip);
      }
      return true;
    }

    setSupportSelfProfileSaving(true);
    try {
      const baseDomain =
        resolveRuntimePortalBaseDomain(process.env.NEXT_PUBLIC_PORTAL_BASE_DOMAIN ?? "") ||
        (platformState.sites.find((site) => site.id === "site-main")?.domain ?? "").trim() ||
        normalizeSupportDisplayValue(nextSite.domain);
      const normalizedDomainPrefix = normalizeDomainPrefixForMerchant(
        nextSite.domainPrefix ?? nextSite.domainSuffix ?? targetSiteId,
      );
      const syncResult = await syncMerchantProfileBinding(
        targetSiteId,
        normalizedDomainPrefix,
        normalizeSupportDisplayValue(nextSite.merchantName) ||
          normalizeSupportDisplayValue(nextSite.name) ||
          targetSiteId,
        {
          signature: normalizeSupportDisplayValue(nextSite.signature),
          domain: buildMerchantDomainFromBase(baseDomain, normalizedDomainPrefix),
          contactAddress: nextSite.contactAddress,
          contactName: nextSite.contactName,
          contactPhone: nextSite.contactPhone,
          contactEmail: nextSite.contactEmail,
          industry: nextSite.industry,
          location: nextSite.location ?? null,
          chatAvatarImageUrl: nextSite.chatAvatarImageUrl ?? "",
          contactVisibility: nextSite.contactVisibility ?? createDefaultMerchantContactVisibility(),
          businessCards: nextBusinessCards,
        },
      );
      if (!syncResult.ok) {
        showTip("资料已保存到当前后台，但同步到超级后台失败，请稍后重试");
        return false;
      }
      if (options?.successTip) {
        showTip(options.successTip);
      }
      return true;
    } finally {
      setSupportSelfProfileSaving(false);
    }
  }

  function openSupportSelfAvatarPicker() {
    if (supportSelfAvatarUploading || supportSelfProfileSaving) return;
    supportSelfAvatarInputRef.current?.click();
  }

  async function handleSupportSelfAvatarInputChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    resetSupportPickerInputValue(event.target);
    if (!file) return;
    setSupportSelfAvatarUploading(true);
    try {
      const { compressSupportSelfAvatarFile } = await loadEditorAssetProcessing();
      const { dataUrl: avatarDataUrl } = await compressSupportSelfAvatarFile(file);
      const uploadResult = await uploadSupportAssetDataUrl(avatarDataUrl, "merchant-assets");
      if (!uploadResult.ok || !uploadResult.url) {
        throw new Error(uploadResult.message || "头像上传失败，请稍后重试");
      }
      await saveSupportSelfSitePatch(
        {
          chatAvatarImageUrl: uploadResult.url,
        },
        {
          successTip: "头像已更新",
        },
      );
    } catch (error) {
      showTip(error instanceof Error ? error.message : "头像上传失败，请稍后重试");
    } finally {
      setSupportSelfAvatarUploading(false);
    }
  }

  async function handleSupportSelfVisibilityChange(
    key: keyof MerchantContactVisibility,
    hidden: boolean,
  ) {
    await saveSupportSelfSitePatch(
      {
        contactVisibility: {
          ...supportSelfContactVisibility,
          [key]: hidden,
        },
      },
      {
        successTip: hidden ? "已隐藏该资料" : "已恢复显示该资料",
      },
    );
  }

  async function handleSupportSelfSignatureSave() {
    const normalizedSignature = supportSelfSignatureDraft.trim();
    const saved = await saveSupportSelfSitePatch(
      {
        signature: normalizedSignature,
      },
      {
        successTip: normalizedSignature ? "个性签名已更新" : "已恢复默认签名",
      },
    );
    if (saved) {
      setSupportSelfSignatureDirty(false);
    }
  }

  const shouldUseDesktopEditorSidebar = forceDesktopEditorSidebar || isPlatformEditor || isDesktopEditorSidebar;
  const toggleTopBarCollapsed = useCallback(() => {
    setTopBarCollapsed((prev) => !prev);
  }, []);
  const toggleDesktopEditorSidebar = useCallback(() => {
    if (!shouldUseDesktopEditorSidebar) return;
    toggleTopBarCollapsed();
  }, [shouldUseDesktopEditorSidebar, toggleTopBarCollapsed]);

  useEffect(() => {
    if (typeof window === "undefined" || !shouldUseDesktopEditorSidebar) return;
    const isTypingTarget = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false;
      if (target.isContentEditable) return true;
      if (target.closest('[contenteditable="true"]')) return true;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement
      ) {
        return true;
      }
      return false;
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (publishingRef.current) return;
      if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (event.key.toLowerCase() !== "s") return;
      if (isTypingTarget(event.target)) return;
      event.preventDefault();
      toggleDesktopEditorSidebar();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [shouldUseDesktopEditorSidebar, toggleDesktopEditorSidebar]);

  const pageBackgroundSource = blocks[0]?.props;
  const pageBackgroundStyle = getBackgroundStyle({
    imageUrl: pageBackgroundSource?.pageBgImageUrl,
    fillMode: pageBackgroundSource?.pageBgFillMode,
    position: pageBackgroundSource?.pageBgPosition,
    color: pageBackgroundSource?.pageBgColor,
    opacity: pageBackgroundSource?.pageBgOpacity,
    imageOpacity: pageBackgroundSource?.pageBgImageOpacity,
    colorOpacity: pageBackgroundSource?.pageBgColorOpacity,
  });
  const editingPlan = planConfig.plans.find((plan) => plan.id === editingPlanId) ?? planConfig.plans[0];
  const editingPages = editingPlan?.pages?.length
    ? editingPlan.pages
    : [{ id: "page-1", name: "页面1", blocks: editingPlan?.blocks ?? defaultEditorBlocks }];
  const editingPageIndex = Math.max(0, editingPages.findIndex((page) => page.id === editingPageId));
  const merchantCouponPageId =
    findFirstCouponPageIdInPlanConfig(planConfig) ||
    findFirstCouponPageIdInPlanConfig(viewportStatesRef.current.desktop.planConfig) ||
    findFirstCouponPageIdInPlanConfig(viewportStatesRef.current.mobile.planConfig);
  const editorAvailablePagesKey = editingPages
    .map((page) => `${page.id}:${toPlainText(page.name, page.id)}`)
    .join("||");
  if (editorAvailablePagesKeyRef.current !== editorAvailablePagesKey) {
    editorAvailablePagesKeyRef.current = editorAvailablePagesKey;
    editorAvailablePagesRef.current = editingPages.map((page) => ({ id: page.id, name: toPlainText(page.name, page.id) }));
  }
  const editorAvailablePages = editorAvailablePagesRef.current;
  const editorAvailableBlocks = useMemo<ButtonJumpBlock[]>(
    () =>
      blocks.map((block, index) => {
        const publicId = buildPublicBlockId(editingPageIndex, index);
        return {
          id: block.id,
          publicId,
          label: `${buildPageCopyBlockLabel(block, index)} · ID ${publicId}`,
          openByButton: block.props.blockOpenMode === "button",
        };
      }),
    [blocks, editingPageIndex],
  );
  const pageCopyTargetPages = editingPages.filter((page) => page.id !== editingPageId);
  const pageCopyBlockOptions = blocks.map((block, index) => ({
    id: buildPageCopyItemIdForBlock(block.id),
    label: buildPageCopyBlockLabel(block, index),
  }));
  const pageCopySelectedItemCount =
    (pageCopySelections[PAGE_COPY_BACKGROUND_ITEM_ID] ? 1 : 0) +
    (pageCopySelections[PAGE_COPY_THEME_ITEM_ID] ? 1 : 0) +
    pageCopyBlockOptions.filter((item) => pageCopySelections[item.id] === true).length;
  const imageCompressionOptions = getCurrentImageCompressionOptions();
  const otherBookingViewport = previewViewport === "desktop" ? "mobile" : "desktop";
  const otherBookingPlanConfig = viewportStatesRef.current[otherBookingViewport].planConfig;
  const desktopBookingConfig = previewViewport === "desktop" ? planConfig : viewportStatesRef.current.desktop.planConfig;
  const mobileBookingConfig = previewViewport === "mobile" ? planConfig : viewportStatesRef.current.mobile.planConfig;
  const merchantBookingBlockCount = useMemo(() => countBookingBlocksInPlanConfig(planConfig), [planConfig]);
  const merchantHasBookingBlockConfigured = merchantBookingBlockCount > 0;
  const merchantPermissionConfig = !isPlatformEditor
    ? (effectiveEditingSite?.permissionConfig ?? editingSite?.permissionConfig ?? createDefaultMerchantPermissionConfig())
    : null;
  const merchantPlanLimit = isPlatformEditor
    ? planConfig.plans.length
    : Math.max(1, Math.min(planConfig.plans.length, merchantPermissionConfig?.planLimit ?? 1));
  const merchantPageLimit = isPlatformEditor
    ? 12
    : Math.max(1, Math.min(12, merchantPermissionConfig?.pageLimit ?? 1));
  const missingMerchantProfileFields = !isPlatformEditor ? getMissingMerchantProfileFields(effectiveEditingSite ?? editingSite) : [];
  const canUseInsertBackgroundByPermission = isPlatformEditor || Boolean(merchantPermissionConfig?.allowInsertBackground);
  const canUseInsertBackground = canUseInsertBackgroundByPermission;
  const canUseThemeEffects = isPlatformEditor || Boolean(merchantPermissionConfig?.allowThemeEffects);
  const canUseGalleryBlock = isPlatformEditor || Boolean(merchantPermissionConfig?.allowGalleryBlock);
  const canUseMusicBlock = isPlatformEditor || Boolean(merchantPermissionConfig?.allowMusicBlock);
  const canUseProductBlock = isPlatformEditor || Boolean(merchantPermissionConfig?.allowProductBlock);
  const canUseCouponModule = !isPlatformEditor && Boolean(merchantPermissionConfig?.allowCouponModule);
  const canUseCouponBlock =
    isPlatformEditor ||
    Boolean(merchantPermissionConfig?.allowCouponModule && merchantPermissionConfig?.allowCouponBlock);
  const canUseOrderManagement =
    !isPlatformEditor &&
    Boolean(merchantPermissionConfig?.allowProductBlock) &&
    Boolean(merchantPermissionConfig?.allowOrderManagement);
  const canUseEnterpriseManagement =
    !isPlatformEditor && Boolean(merchantPermissionConfig?.allowEnterpriseManagement);
  useEffect(() => {
    if (supportMobileHomeTab !== "enterprise" || canUseEnterpriseManagement) return;
    openSupportMobileHomeTab("conversations");
  }, [canUseEnterpriseManagement, openSupportMobileHomeTab, supportMobileHomeTab]);
  const canUseMembershipManagement = !isPlatformEditor && Boolean(merchantPermissionConfig?.allowMembershipManagement);
  const canUsePointsRedemption =
    canUseMembershipManagement && Boolean(merchantPermissionConfig?.allowPointsRedemption);
  const canUseBookingBlock = isPlatformEditor || Boolean(merchantPermissionConfig?.allowBookingBlock) || merchantHasBookingBlockConfigured;
  const canUseButtonBlock = isPlatformEditor || Boolean(merchantPermissionConfig?.allowButtonBlock);
  const resolvedSupportMobileBusinessSection =
    canUseOrderManagement || supportMobileBusinessSection === "booking" ? supportMobileBusinessSection : "booking";
  const isBookingBlockAddLocked = merchantHasBookingBlockConfigured;
  const merchantBusinessBadgeLabel =
    merchantBusinessAttentionCount > 99 ? "99+" : String(merchantBusinessAttentionCount);
  const merchantHasBusinessAttention = merchantBusinessAttentionCount > 0;
  const isCurrentBlockTypeLocked =
    (!canUseButtonBlock && newBlockType === "button") ||
    (!canUseGalleryBlock && newBlockType === "gallery") ||
    (!canUseMusicBlock && newBlockType === "music") ||
    (!canUseProductBlock && newBlockType === "product") ||
    (!canUseCouponBlock && newBlockType === "coupon") ||
    ((!canUseBookingBlock || isBookingBlockAddLocked) && newBlockType === "booking");
  const showAddBlockGuide = !isPlatformEditor && !hasAddedExtraBlock && blocks.length === 1 && blocks[0]?.type === "nav";
  useEffect(() => {
    if (checkingAuth || isPlatformEditor || !canUseCouponModule || !editingSiteId) {
      setMerchantCouponRecords([]);
      return;
    }

    let cancelled = false;
    const cacheKey = makeMerchantAdminDataCacheKey("merchant-coupons", editingSiteId);
    const cachedSnapshot = readMerchantAdminDataCacheSnapshot<MerchantCouponRecord[]>(cacheKey);
    let loadedCouponsVersion: string | null = null;

    if (cachedSnapshot) {
      setMerchantCouponRecords(cachedSnapshot.data);
    } else {
      setMerchantCouponRecords([]);
    }

    const loadCouponsFromServer = async () => {
      const params = new URLSearchParams({ siteId: editingSiteId });
      if (cachedSnapshot?.version) params.set("knownVersion", cachedSnapshot.version);
      const response = await fetch(`/api/coupons?${params.toString()}`, {
        credentials: "same-origin",
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => null)) as {
        coupons?: unknown;
        message?: string;
        error?: string;
        notModified?: unknown;
        version?: unknown;
      } | null;
      if (!response.ok) {
        throw new Error(payload?.message || payload?.error || "优惠券加载失败");
      }
      loadedCouponsVersion =
        typeof payload?.version === "string" && payload.version.trim() ? payload.version.trim() : null;
      if (payload?.notModified === true && cachedSnapshot) return cachedSnapshot.data;
      return normalizeMerchantCouponRecords(payload?.coupons);
    };

    const refreshCoupons = () => {
      void fetchMerchantAdminDataWithCache(cacheKey, loadCouponsFromServer, {
        force: true,
        allowStaleOnError: true,
        dedupe: true,
        cacheVersion: () => loadedCouponsVersion,
      })
        .then((nextCoupons) => {
          if (!cancelled) setMerchantCouponRecords(nextCoupons);
        })
        .catch(() => {
          if (!cancelled && !cachedSnapshot) setMerchantCouponRecords([]);
        });
    };
    const cancelRefresh = scheduleAdminIdleTask(refreshCoupons, {
      timeoutMs: 2200,
      fallbackDelayMs: 900,
    });

    return () => {
      cancelled = true;
      cancelRefresh();
    };
  }, [canUseCouponModule, checkingAuth, editingSiteId, isPlatformEditor]);
  const merchantPublishSizeLimitBytes = !isPlatformEditor
    ? Math.max(1, Math.round(merchantPermissionConfig?.publishSizeLimitMb ?? 1)) * 1024 * 1024
    : null;
  const effectiveFrontendHref = !isPlatformEditor
    ? buildMerchantFrontendHref(
        editingSiteId || "site-main",
        effectiveEditingSite?.domainPrefix ?? effectiveEditingSite?.domainSuffix ?? editingSite?.domainPrefix ?? editingSite?.domainSuffix,
      )
    : frontendHref;
  const maxBlockOffsetY = blocks.reduce((max, block) => {
    const value =
      typeof block.props.blockOffsetY === "number" && Number.isFinite(block.props.blockOffsetY)
        ? Math.round(block.props.blockOffsetY)
        : 0;
    return Math.max(max, value);
  }, 0);
  const mobileFrontendPreviewPadding = Math.max(120, Math.max(0, maxBlockOffsetY) + 100);
  const isMobileMerchantEditorShell = isMobileMerchantSupportOnlyMode;
  const shouldPrepareBookingManagerData =
    !isPlatformEditor &&
    canUseBookingBlock &&
    (
      merchantBookingManagerOpen ||
      merchantDesktopSection === "booking" ||
      (isMobileMerchantEditorShell && resolvedSupportMobileBusinessSection === "booking")
    );
  const merchantBookingManagerData = useMemo<{
    storeOptions: string[];
    itemOptions: string[];
    titleOptions: string[];
    bookingRulesSnapshot: MerchantBookingRulesSnapshot | null;
  }>(() => {
    if (!shouldPrepareBookingManagerData) {
      return {
        storeOptions: [],
        itemOptions: [],
        titleOptions: [],
        bookingRulesSnapshot: null,
      };
    }

    const activeBookingOptions = collectBookingOptionsFromPlanConfig(planConfig);
    const otherBookingOptions = collectBookingOptionsFromPlanConfig(otherBookingPlanConfig);
    return {
      storeOptions: normalizeBookingOptionList(
        [...activeBookingOptions.storeOptions, ...otherBookingOptions.storeOptions],
        buildDefaultBookingStoreOptions(effectiveMerchantDisplayName || merchantDisplayName),
      ),
      itemOptions: normalizeBookingOptionList(
        [...activeBookingOptions.itemOptions, ...otherBookingOptions.itemOptions],
        buildDefaultBookingItemOptions(),
      ),
      titleOptions: normalizeBookingOptionList(
        [...activeBookingOptions.titleOptions, ...otherBookingOptions.titleOptions],
        buildDefaultBookingTitleOptions(),
      ),
      bookingRulesSnapshot: editingSiteId
        ? buildMerchantBookingRulesSnapshotFromPlanConfigs(
            editingSiteId,
            desktopBookingConfig,
            mobileBookingConfig,
            new Date().toISOString(),
          )
        : null,
    };
  }, [
    desktopBookingConfig,
    editingSiteId,
    effectiveMerchantDisplayName,
    merchantDisplayName,
    mobileBookingConfig,
    otherBookingPlanConfig,
    planConfig,
    shouldPrepareBookingManagerData,
  ]);
  const merchantBookingManagerOptions = {
    storeOptions: merchantBookingManagerData.storeOptions,
    itemOptions: merchantBookingManagerData.itemOptions,
    titleOptions: merchantBookingManagerData.titleOptions,
  };
  const merchantBookingRulesSnapshot = merchantBookingManagerData.bookingRulesSnapshot;
  const merchantEditorAvatarLabel = !isPlatformEditor ? getSupportContactAvatarLabel(effectiveMerchantDisplayName || merchantDisplayName, "商") : "";
  const shouldShowPublishActions = showPublishActions ?? !isPlatformEditor;
  const isDesktopMerchantWorkspace = desktopMerchantWorkspaceActive && !merchantEditorOnly;
  const showDesktopMerchantSupportPanel = isDesktopMerchantWorkspace && merchantDesktopSection === "support";

  function openMerchantOrderEnterpriseTask(
    order: MerchantOrderRecord,
    surface: "desktop" | "mobile",
  ) {
    if (!canUseEnterpriseManagement) {
      showTip("当前商户未开通企业管理");
      return;
    }
    void loadMerchantEnterpriseManager().catch(() => undefined);
    setMerchantSiteIdOverride(order.siteId);
    setMerchantEnterpriseTaskIntent({
      ...buildMerchantOrderTaskDraft(order),
      siteId: order.siteId,
      requestId: createClientMutationOperationId("merchant-order-task"),
    });
    setMerchantEnterpriseView("tasks");
    if (surface === "mobile") {
      openSupportMobileHomeTab("enterprise");
      return;
    }
    setMerchantOrderManagerOpen(false);
    setMerchantDesktopSection("enterprise");
  }

  function handleMerchantEnterpriseTaskIntentHandled(requestId: string) {
    setMerchantEnterpriseTaskIntent((current) =>
      current?.requestId === requestId ? null : current,
    );
  }

  async function openMerchantEnterpriseSourceOrder(
    input: { siteId: string; orderId: string },
    surface: "desktop" | "mobile",
  ) {
    if (!canUseEnterpriseManagement || !canUseOrderManagement) {
      throw new Error(
        getMerchantOrderSourceErrorMessage(
          canUseEnterpriseManagement
            ? "order_management_disabled"
            : "enterprise_management_disabled",
        ),
      );
    }
    const params = new URLSearchParams({
      siteId: input.siteId,
      orderId: input.orderId,
    });
    const requestController = new AbortController();
    const timeoutId = window.setTimeout(() => requestController.abort(), 15_000);
    let response: Response;
    try {
      response = await fetch(`/api/merchant-enterprise/order-sources?${params.toString()}`, {
        cache: "no-store",
        credentials: "same-origin",
        signal: requestController.signal,
      });
    } catch (error) {
      if (requestController.signal.aborted) {
        throw new Error("来源订单读取超时，请检查网络后重试。");
      }
      throw new Error(
        error instanceof Error && error.message
          ? error.message
          : "来源订单读取失败，请稍后重试。",
      );
    } finally {
      window.clearTimeout(timeoutId);
    }
    const payload = (await response.json().catch(() => null)) as
      | { ok?: boolean; error?: string; order?: MerchantOrderRecord }
      | null;
    if (!response.ok) {
      throw new Error(getMerchantOrderSourceErrorMessage(payload?.error));
    }
    const order = payload?.order;
    if (!order || order.siteId !== input.siteId || order.id !== input.orderId) {
      throw new Error(getMerchantOrderSourceErrorMessage("invalid_source_order_request"));
    }
    setMerchantSiteIdOverride(order.siteId);
    setMerchantOrderSourceIntent({
      siteId: order.siteId,
      orderId: order.id,
      order,
      requestId: createClientMutationOperationId("merchant-source-order"),
    });
    setMerchantOrderWorkbenchOpen(false);
    if (surface === "mobile") {
      setSupportMobileBusinessSection("orders");
      openSupportMobileHomeTab("business");
      return;
    }
    setMerchantOrderManagerOpen(false);
    setMerchantDesktopSection("orders");
  }

  function handleMerchantOrderSourceIntentHandled(requestId: string) {
    setMerchantOrderSourceIntent((current) =>
      current?.requestId === requestId ? null : current,
    );
  }
  const merchantDesktopPointRedemptionCenterActive =
    merchantDesktopSection === "pointRedemption" ||
    merchantDesktopSection === "redemptionRecords" ||
    merchantDesktopSection === "rechargeRecords" ||
    merchantDesktopSection === "redemptionCategories" ||
    merchantDesktopSection === "redemptionItems";
  const defaultMerchantDesktopSection: MerchantDesktopSection = canUsePointsRedemption
    ? "pointRedemption"
    : canUseBookingBlock
      ? "booking"
      : canUseOrderManagement
        ? "orders"
        : canUseEnterpriseManagement
          ? "enterprise"
        : canUseMembershipManagement
          ? "members"
          : canUseCouponModule
            ? "coupons"
            : "business";
  useEffect(() => {
    if (
      checkingAuth ||
      !isDesktopMerchantWorkspace ||
      merchantEditorOnly ||
      !merchantDesktopPointRedemptionCenterActive ||
      typeof window === "undefined"
    ) {
      return;
    }

    if (canUsePointsRedemption) {
      void loadMerchantPointRedemptionCashier().catch(() => undefined);
    }
  }, [
    canUsePointsRedemption,
    checkingAuth,
    isDesktopMerchantWorkspace,
    merchantDesktopPointRedemptionCenterActive,
    merchantEditorOnly,
  ]);
  useEffect(() => {
    if (checkingAuth || !isDesktopMerchantWorkspace || merchantEditorOnly) return;
    const explicitFaollaSection = typeof window !== "undefined" && isFaollaSectionSearch(window.location.search);
    const merchantWorkspaceSiteId = (
      editingSiteId ||
      merchantSiteIdOverride ||
      getSiteIdFromStoreScope(storeScope) ||
      merchantSessionIdentityRef.current.merchantId ||
      ""
    ).trim();
    if (!isMerchantNumericId(merchantWorkspaceSiteId)) return;
    if (merchantDesktopDefaultSectionSiteRef.current === merchantWorkspaceSiteId) return;
    if (explicitFaollaSection) {
      merchantDesktopDefaultSectionSiteRef.current = merchantWorkspaceSiteId;
      if (!editingSiteId) {
        setMerchantSiteIdOverride((current) => current || merchantWorkspaceSiteId);
      }
      setMerchantDesktopSection("faolla");
      return;
    }
    if (merchantDesktopSection !== "editor" && merchantDesktopSection !== "faolla") return;
    merchantDesktopDefaultSectionSiteRef.current = merchantWorkspaceSiteId;
    if (!editingSiteId) {
      setMerchantSiteIdOverride((current) => current || merchantWorkspaceSiteId);
    }
    if (defaultMerchantDesktopSection === "pointRedemption") {
      void loadMerchantPointRedemptionCashier().catch(() => undefined);
    } else if (defaultMerchantDesktopSection === "booking") {
      void loadMerchantBookingManagerDialog().catch(() => undefined);
    } else if (defaultMerchantDesktopSection === "orders") {
      void loadMerchantOrderManagerDialog().catch(() => undefined);
    } else if (defaultMerchantDesktopSection === "enterprise") {
      void loadMerchantEnterpriseManager().catch(() => undefined);
    } else if (defaultMerchantDesktopSection === "members") {
      void loadMerchantMemberManager().catch(() => undefined);
    } else if (defaultMerchantDesktopSection === "coupons") {
      void loadMerchantCouponManager().catch(() => undefined);
    }
    setMerchantDesktopSection(defaultMerchantDesktopSection);
  }, [
    checkingAuth,
    defaultMerchantDesktopSection,
    editingSiteId,
    isDesktopMerchantWorkspace,
    merchantDesktopSection,
    merchantEditorOnly,
    merchantSiteIdOverride,
    setMerchantDesktopSection,
    storeScope,
  ]);
  useEffect(() => {
    if (
      checkingAuth ||
      !isDesktopMerchantWorkspace ||
      merchantEditorOnly ||
      typeof window === "undefined"
    ) {
      return;
    }

    let cancelIdleTask = () => {};
    const preloadDelayId = window.setTimeout(() => {
      cancelIdleTask = scheduleAdminIdleTask(
        () => {
          void loadMerchantBusinessCardManager()
            .catch(() => undefined)
            .finally(() => {
              void loadMerchantPrintSettingsPanel().catch(() => undefined);
            });
        },
        { timeoutMs: 4000, fallbackDelayMs: 900 },
      );
    }, 2600);

    return () => {
      window.clearTimeout(preloadDelayId);
      cancelIdleTask();
    };
  }, [checkingAuth, isDesktopMerchantWorkspace, merchantEditorOnly]);
  useEffect(() => {
    if (!isDesktopMerchantWorkspace || merchantEditorOnly) return;
    if (merchantDesktopPointRedemptionCenterActive && !canUsePointsRedemption) {
      setMerchantDesktopSection(defaultMerchantDesktopSection);
      return;
    }
    if (merchantDesktopSection === "members" && !canUseMembershipManagement) {
      setMerchantDesktopSection(defaultMerchantDesktopSection);
      return;
    }
    if (merchantDesktopSection === "enterprise" && !canUseEnterpriseManagement) {
      setMerchantDesktopSection(defaultMerchantDesktopSection);
    }
  }, [
    canUseEnterpriseManagement,
    canUseMembershipManagement,
    canUsePointsRedemption,
    defaultMerchantDesktopSection,
    isDesktopMerchantWorkspace,
    merchantDesktopPointRedemptionCenterActive,
    merchantDesktopSection,
    merchantEditorOnly,
    setMerchantDesktopSection,
  ]);
  useEffect(() => {
    if (!isDesktopMerchantWorkspace || merchantDesktopSection !== "booking") {
      setMerchantBookingWorkbenchOpen(false);
    }
    if (!isDesktopMerchantWorkspace || merchantDesktopSection !== "orders") {
      setMerchantOrderWorkbenchOpen(false);
    }
  }, [isDesktopMerchantWorkspace, merchantDesktopSection]);
  const planTemplateKeyword = planTemplateSearch.trim().toLowerCase();
  const planTemplateCards = useMemo(
    () =>
      planTemplates
        .filter((template) => {
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
        })
        .map((template, index) => ({ template, index }))
        .sort((left, right) => {
          const leftTime = new Date(left.template.createdAt).getTime();
          const rightTime = new Date(right.template.createdAt).getTime();
          const normalizedLeft = Number.isFinite(leftTime) ? leftTime : 0;
          const normalizedRight = Number.isFinite(rightTime) ? rightTime : 0;
          if (normalizedRight !== normalizedLeft) {
            return normalizedRight - normalizedLeft;
          }
          return left.index - right.index;
        })
        .map(({ template }) => ({
          template,
          summary: summarizePlanTemplateBlocks(template.blocks),
          previewPlans: getPlanTemplatePreviewOptions(template.blocks),
        })),
    [planTemplateFilter, planTemplateKeyword, planTemplates],
  );

  if (checkingAuth) {
    if (!isPlatformEditor) {
      return (
        <LoadingProgressScreen
          locale={locale}
          statusTitle={
            locale.startsWith("zh")
              ? "欢迎使用 FAOLLA 愿您生意兴隆！"
              : "Welcome to FAOLLA. Wishing you a thriving business!"
          }
          statusDescription=""
        />
      );
    }

    if (!isPlatformEditor) {
      return (
        <main className="relative min-h-screen overflow-hidden bg-[#081121] text-white">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(56,189,248,0.22),_transparent_34%),radial-gradient(circle_at_85%_18%,_rgba(45,212,191,0.18),_transparent_26%),linear-gradient(180deg,_#081121_0%,_#101b33_56%,_#eaf1ff_100%)]" />
          <div className="absolute -left-16 top-20 h-48 w-48 rounded-full bg-cyan-300/20 blur-3xl" />
          <div className="absolute right-[-3rem] top-40 h-56 w-56 rounded-full bg-emerald-300/16 blur-3xl" />
          <div className="absolute bottom-[-5rem] left-1/2 h-64 w-64 -translate-x-1/2 rounded-full bg-white/12 blur-3xl" />
          <div className="relative flex min-h-screen flex-col">
            <div className="px-5 pb-8 pt-[calc(var(--faolla-mobile-safe-top)+1.5rem)] sm:px-6">
              <div className="inline-flex items-center gap-3 rounded-full border border-white/14 bg-white/10 px-4 py-2 text-xs font-medium uppercase tracking-[0.24em] text-cyan-50/90 backdrop-blur">
                <span className="inline-flex h-2 w-2 rounded-full bg-emerald-300" />
                Faolla.com
              </div>
              <div className="mt-8 flex items-center gap-4">
                <div className="flex h-16 w-16 items-center justify-center rounded-[24px] bg-white/14 text-2xl font-semibold tracking-[0.18em] text-white shadow-[0_16px_40px_rgba(8,17,33,0.28)] backdrop-blur">
                  FA
                </div>
                <div>
                  <div className="text-xs font-medium uppercase tracking-[0.28em] text-slate-200/72">Faolla.com</div>
                  <div className="mt-2 text-3xl font-semibold text-white">正在检查登录状态</div>
                </div>
              </div>
            </div>
            <div className="mt-auto rounded-t-[32px] bg-[linear-gradient(180deg,_rgba(248,251,255,0.96)_0%,_#ffffff_34%,_#f8fbff_100%)] px-5 pb-[calc(var(--faolla-mobile-safe-bottom)+1.5rem)] pt-6 text-slate-900 shadow-[0_-24px_60px_rgba(8,17,33,0.24)] sm:px-6">
              <div className="mx-auto max-w-md">
                <div className="mx-auto mb-5 h-1.5 w-14 rounded-full bg-slate-200" />
                <div className="rounded-[28px] border border-white/70 bg-white/90 p-6 shadow-[0_18px_40px_rgba(15,23,42,0.10)]">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 animate-spin rounded-full border-4 border-slate-200 border-t-slate-900" />
                    <div>
                      <div className="text-base font-semibold text-slate-950">正在进入商户后台</div>
                      <div className="mt-1 text-sm text-slate-500">请稍等，我们正在恢复你的登录状态。</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </main>
      );
    }
    return (
      <main className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="text-sm text-gray-600">{"正在检查登录状态..."}</div>
      </main>
    );
  }

  if (!hasEditorContent && backendNotice) {
    if (!isPlatformEditor) {
      const authNotice = /未登录|登录/.test(backendNotice);
      return (
        <LoadingProgressScreen locale={locale}>
          <div className="rounded-[28px] border border-white/70 bg-white/92 p-5 text-slate-900 shadow-[0_18px_40px_rgba(15,23,42,0.18)] backdrop-blur sm:p-6">
            <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">
              状态
            </div>
            <div className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">
              {authNotice
                ? "请重新登录继续"
                : "内容暂未恢复"}
            </div>
            <p className="mt-3 text-sm leading-6 text-slate-500">{backendNotice}</p>
            <div className="mt-6 grid grid-cols-2 gap-3">
              <button
                type="button"
                className="rounded-[20px] border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 shadow-[0_8px_24px_rgba(15,23,42,0.06)] transition hover:border-slate-300 hover:bg-white"
                onClick={() => {
                  setHasEditorContent(true);
                  setBackendNotice("当前使用空白模板继续编辑");
                }}
              >
                空白模板
              </button>
              <button
                type="button"
                className="rounded-[20px] border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 shadow-[0_8px_24px_rgba(15,23,42,0.06)] transition hover:border-slate-300 hover:bg-white"
                onClick={() => {
                  window.location.href = "/login";
                }}
              >
                重新登录
              </button>
            </div>
          </div>
        </LoadingProgressScreen>
      );
    }
    return (
      <main className="min-h-screen bg-gray-100 p-6">
        <div className="mx-auto max-w-3xl rounded-lg border bg-white p-6 shadow-sm">
          <h1 className="text-lg font-semibold text-gray-900">未加载到可编辑页面</h1>
          <p className="mt-2 text-sm text-gray-600">{backendNotice}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded border bg-white px-3 py-2 text-sm hover:bg-gray-50"
              onClick={() => {
                setHasEditorContent(true);
                setBackendNotice("当前使用空白模板继续编辑");
              }}
            >
              使用空白模板继续
            </button>
            <button
              type="button"
              className="rounded border bg-white px-3 py-2 text-sm hover:bg-gray-50"
              onClick={() => {
                window.location.href = "/login";
              }}
            >
              重新登录
            </button>
          </div>
        </div>
      </main>
    );
  }

  function renderTopMostOverlay(content: ReactNode) {
    if (typeof window === "undefined") return content;
    return createPortal(content, document.body);
  }

  const dialogOverlay = dialog
    ? renderTopMostOverlay(
        <div data-editor-overlay className="fixed inset-0 z-[2147483650] bg-black/40 flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-xl border bg-white p-4 shadow-xl space-y-3">
            <div className="text-base font-semibold">{dialog.title}</div>
            <div className="text-sm text-gray-700 whitespace-pre-wrap">{dialog.message}</div>
            <div className="flex justify-end gap-2 flex-wrap">
              {dialog.type === "compression-preset" ? (
                <>
                  <button
                    type="button"
                    className={`px-3 py-2 rounded border text-sm ${
                      dialog.currentPreset === "high" ? "bg-black text-white border-black" : "bg-white hover:bg-gray-50"
                    }`}
                    onClick={() => {
                      if (dialog.type === "compression-preset") dialog.resolve("high");
                      setDialog(null);
                    }}
                  >
                    {"高质"}
                  </button>
                  <button
                    type="button"
                    className={`px-3 py-2 rounded border text-sm ${
                      dialog.currentPreset === "balanced" ? "bg-black text-white border-black" : "bg-white hover:bg-gray-50"
                    }`}
                    onClick={() => {
                      if (dialog.type === "compression-preset") dialog.resolve("balanced");
                      setDialog(null);
                    }}
                  >
                    {"平衡"}
                  </button>
                  <button
                    type="button"
                    className={`px-3 py-2 rounded border text-sm ${
                      dialog.currentPreset === "compact" ? "bg-black text-white border-black" : "bg-white hover:bg-gray-50"
                    }`}
                    onClick={() => {
                      if (dialog.type === "compression-preset") dialog.resolve("compact");
                      setDialog(null);
                    }}
                  >
                    {"压缩优先"}
                  </button>
                </>
              ) : null}
              {dialog.type === "confirm" ? (
                <button
                  type="button"
                  className="px-3 py-2 rounded border bg-white hover:bg-gray-50 text-sm"
                  onClick={() => {
                    if (dialog.type === "confirm") dialog.resolve(false);
                    setDialog(null);
                  }}
                >
                  {"取消"}
                </button>
              ) : null}
              {dialog.type === "compression-preset" ? (
                <button
                  type="button"
                  className="px-3 py-2 rounded border bg-white hover:bg-gray-50 text-sm"
                  onClick={() => {
                    if (dialog.type === "compression-preset") dialog.resolve(null);
                    setDialog(null);
                  }}
                >
                  {"暂不切换"}
                </button>
              ) : null}
              <button
                type="button"
                className="px-3 py-2 rounded bg-black text-white text-sm"
                onClick={() => {
                  if (dialog.type === "alert") dialog.resolve();
                  if (dialog.type === "confirm") dialog.resolve(true);
                  if (dialog.type === "compression-preset") dialog.resolve(dialog.currentPreset);
                  setDialog(null);
                }}
              >
                {"确定"}
              </button>
            </div>
          </div>
        </div>,
      )
    : null;
  const editorUploadBusyOverlay = editorUploadBusy
    ? renderTopMostOverlay(
        <div
          data-editor-upload-busy
          className="fixed inset-0 z-[2147483640] flex items-center justify-center bg-black/30 p-4"
        >
          <div className="rounded-2xl border bg-white px-5 py-4 text-sm font-semibold text-slate-900 shadow-2xl">
            <div className="flex items-center gap-3">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-slate-950" />
              <span>{editorUploadMessage || "正在上传图片，请稍候..."}</span>
            </div>
          </div>
        </div>,
      )
    : null;
  const publishBusyOverlay = publishing
    ? renderTopMostOverlay(
        <div
          data-editor-publish-busy
          className="fixed inset-0 z-[2147483641] flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-[1px]"
        >
          <div className="max-w-sm rounded-2xl border border-white/20 bg-white px-5 py-4 text-center shadow-2xl">
            <div className="mx-auto h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-slate-950" />
            <div className="mt-3 text-sm font-semibold text-slate-950">发布中，请稍候...</div>
            <div className="mt-1 text-xs leading-5 text-slate-500">发布完成或失败前已暂时锁定编辑操作。</div>
          </div>
        </div>,
      )
    : null;

  const supportSelfDomainPrefix =
    normalizeSupportDisplayValue(supportSelfProfile?.domainPrefix) ||
    normalizeSupportDisplayValue(supportSelfProfile?.domainSuffix) ||
    normalizeSupportDisplayValue(editingSite?.domainPrefix) ||
    normalizeSupportDisplayValue(editingSite?.domainSuffix) ||
    "-";
  const supportSelfCountry =
    normalizeSupportDisplayValue(supportSelfProfile?.location?.country) ||
    normalizeSupportDisplayValue(editingSite?.location?.country) ||
    "-";
  const supportSelfProvince =
    normalizeSupportDisplayValue(supportSelfProfile?.location?.province) ||
    normalizeSupportDisplayValue(editingSite?.location?.province) ||
    "-";
  const supportSelfCity =
    normalizeSupportDisplayValue(supportSelfProfile?.location?.city) ||
    normalizeSupportDisplayValue(editingSite?.location?.city) ||
    "-";
  const supportSelfContactName =
    normalizeSupportDisplayValue(supportSelfProfile?.contactName) ||
    normalizeSupportDisplayValue(editingSite?.contactName) ||
    "-";
  const supportSelfPhone =
    normalizeSupportDisplayValue(supportSelfProfile?.contactPhone) ||
    normalizeSupportDisplayValue(editingSite?.contactPhone) ||
    "-";
  const supportSelfEmail =
    normalizeSupportDisplayValue(supportSelfProfile?.contactEmail) ||
    normalizeSupportDisplayValue(editingSite?.contactEmail) ||
    normalizeSupportDisplayValue(merchantSessionIdentityRef.current.email) ||
    "-";
  const supportSelfLocationSummary = [supportSelfCountry, supportSelfProvince, supportSelfCity].filter((item) => item && item !== "-").join(" / ");
  const supportSelfProfileSummary = [
    supportSelfDomainPrefix !== "-" ? `前缀 ${supportSelfDomainPrefix}` : "",
    supportSelfLocationSummary,
    supportSelfContactName !== "-" ? `联系人 ${supportSelfContactName}` : "",
  ]
    .filter(Boolean)
    .join(" · ") || "同步维护名称、前缀、地址和联系人";
  const merchantProfileDialogCommonProps = !isPlatformEditor
    ? {
        showBusinessCardManager: merchantProfileDialogShowBusinessCards,
        siteId: editingSiteId,
        siteBaseDomain: (() => {
          const platformState = loadPlatformState();
          const baseFromEnv = resolveRuntimePortalBaseDomain(process.env.NEXT_PUBLIC_PORTAL_BASE_DOMAIN ?? "");
          const baseFromMainSite = (platformState.sites.find((item) => item.id === "site-main")?.domain ?? "").trim();
          const fallback = (effectiveEditingSite?.domain ?? editingSite?.domain ?? "").trim();
          return normalizeBaseDomainForMerchant(baseFromEnv || baseFromMainSite || fallback);
        })(),
        initialServiceExpiresAt: effectiveEditingSite?.serviceExpiresAt ?? editingSite?.serviceExpiresAt ?? null,
        initialDomainPrefix:
          effectiveEditingSite?.domainPrefix ??
          effectiveEditingSite?.domainSuffix ??
          editingSite?.domainPrefix ??
          editingSite?.domainSuffix ??
          "",
        takenDomainPrefixes: loadPlatformState()
          .sites.filter((item) => item.id !== editingSiteId)
          .map((item) => item.domainPrefix ?? item.domainSuffix ?? ""),
        initialMerchantName: effectiveEditingSite?.merchantName ?? editingSite?.merchantName ?? "",
        initialContactAddress: effectiveEditingSite?.contactAddress ?? editingSite?.contactAddress ?? "",
        initialContactName: effectiveEditingSite?.contactName ?? editingSite?.contactName ?? "",
        initialContactPhone: effectiveEditingSite?.contactPhone ?? editingSite?.contactPhone ?? "",
        initialContactEmail: effectiveEditingSite?.contactEmail ?? editingSite?.contactEmail ?? "",
        initialLocation: effectiveEditingSite?.location ?? editingSite?.location ?? null,
        initialIndustry: effectiveEditingSite?.industry ?? editingSite?.industry ?? null,
        initialBusinessCards: effectiveEditingSite?.businessCards ?? editingSite?.businessCards ?? [],
        businessCardLimit:
          effectiveEditingSite?.permissionConfig?.businessCardLimit ??
          editingSite?.permissionConfig?.businessCardLimit ??
          createDefaultMerchantPermissionConfig().businessCardLimit,
        allowBusinessCardLinkMode:
          effectiveEditingSite?.permissionConfig?.allowBusinessCardLinkMode ??
          editingSite?.permissionConfig?.allowBusinessCardLinkMode ??
          createDefaultMerchantPermissionConfig().allowBusinessCardLinkMode,
        allowBusinessCardIntroVideo:
          effectiveEditingSite?.permissionConfig?.allowBusinessCardIntroVideo ??
          editingSite?.permissionConfig?.allowBusinessCardIntroVideo ??
          createDefaultMerchantPermissionConfig().allowBusinessCardIntroVideo,
        businessCardIntroVideoLimitMb:
          effectiveEditingSite?.permissionConfig?.businessCardIntroVideoLimitMb ??
          editingSite?.permissionConfig?.businessCardIntroVideoLimitMb ??
          createDefaultMerchantPermissionConfig().businessCardIntroVideoLimitMb,
        businessCardBackgroundImageLimitKb:
          effectiveEditingSite?.permissionConfig?.businessCardBackgroundImageLimitKb ??
          editingSite?.permissionConfig?.businessCardBackgroundImageLimitKb ??
          createDefaultMerchantPermissionConfig().businessCardBackgroundImageLimitKb,
        businessCardContactImageLimitKb:
          effectiveEditingSite?.permissionConfig?.businessCardContactImageLimitKb ??
          editingSite?.permissionConfig?.businessCardContactImageLimitKb ??
          createDefaultMerchantPermissionConfig().businessCardContactImageLimitKb,
        businessCardExportImageLimitKb:
          effectiveEditingSite?.permissionConfig?.businessCardExportImageLimitKb ??
          editingSite?.permissionConfig?.businessCardExportImageLimitKb ??
          createDefaultMerchantPermissionConfig().businessCardExportImageLimitKb,
        onClose: () => {
          setMerchantProfileDialogShowBusinessCards(true);
          setMerchantProfileDialogOpen(false);
          if (isDesktopMerchantWorkspace) {
            setMerchantDesktopSection("editor");
          }
        },
        onCardsChange: (cards: MerchantBusinessCardAsset[]) => {
          if (!editingSiteId) return;
          const previousCount = normalizeMerchantBusinessCards(editingSite?.businessCards ?? []).length;
          const platformState = loadPlatformState();
          const normalizedCards = normalizeMerchantBusinessCardChatDisplaySelection(cards);
          const nextUpdatedAt = new Date().toISOString();
          const currentSite = platformState.sites.find((item) => item.id === editingSiteId) ?? null;
          const nextSite = currentSite
            ? {
                ...currentSite,
                businessCards: normalizedCards,
                updatedAt: nextUpdatedAt,
              }
            : null;
          savePlatformState({
            ...platformState,
            sites: platformState.sites.map((item) =>
              item.id === editingSiteId
                ? nextSite ?? item
                : item,
            ),
          });
          supportPeerProfileLocalMutationAtRef.current[editingSiteId] = Date.now();
          if (nextSite) {
            const nextProfile = buildSupportPublishedProfileFromSite(nextSite);
            setSupportPeerProfilesByMerchantId((current) => ({
              ...current,
              [editingSiteId]: nextProfile,
            }));
            setSupportPeerBusinessCardByMerchantId((current) => ({
              ...current,
              [editingSiteId]: nextProfile.chatBusinessCard ?? null,
            }));
          }
          scheduleMerchantChatBusinessCardSync(editingSiteId, normalizedCards);
          recordMerchantOperationLog({
            siteId: editingSiteId,
            module: "经营中心 > 名片夹",
            action: "更新名片夹",
            summary: `在经营中心 > 名片夹更新名片数量：${previousCount} 张 -> ${normalizedCards.length} 张`,
            status: "success",
          });
        },
        onSave: async ({
          merchantName,
          domainPrefix,
          contactAddress,
          contactName,
          contactPhone,
          contactEmail,
          location,
          industry,
        }: {
          merchantName: string;
          domainPrefix: string;
          contactAddress: string;
          contactName: string;
          contactPhone: string;
          contactEmail: string;
          location: SiteLocation;
          industry: MerchantIndustry;
        }) => {
          const targetSiteId = editingSiteId || (await ensureEditableMerchantSiteId());
          if (!targetSiteId) {
            throw new Error("未找到可编辑的商户站点，无法保存");
          }
          setMerchantSiteIdOverride(targetSiteId);
          ensureScopedMerchantSite(targetSiteId, contactEmail || null);
          const platformState = loadPlatformState();
          const target = platformState.sites.find((item) => item.id === targetSiteId) ?? null;
          const normalizedDomainPrefix = normalizeDomainPrefixForMerchant(domainPrefix);
          const baseDomain =
            resolveRuntimePortalBaseDomain(process.env.NEXT_PUBLIC_PORTAL_BASE_DOMAIN ?? "") ||
            (platformState.sites.find((site) => site.id === "site-main")?.domain ?? "").trim() ||
            (target?.domain ?? "");
          const nextUpdatedAt = new Date().toISOString();
          const nextDomain = buildMerchantDomainFromBase(baseDomain, domainPrefix);
          const nextPlatformState = {
            ...platformState,
            sites: platformState.sites.map((item) =>
              item.id === targetSiteId
                ? {
                    ...item,
                    merchantName,
                    domainPrefix: normalizedDomainPrefix,
                    domainSuffix: normalizedDomainPrefix,
                    contactAddress,
                    contactName,
                    contactPhone,
                    contactEmail,
                    domain: nextDomain,
                    location,
                    industry,
                    updatedAt: nextUpdatedAt,
                  }
                : item,
            ),
          };
          const syncResult = await runWithMerchantOperationContext(
            {
              operationModule: "商户信息",
              operationAction: "保存",
              operationSummary: `保存商户信息：${merchantName || targetSiteId}`,
            },
            () =>
              syncMerchantProfileBinding(targetSiteId, normalizedDomainPrefix, merchantName, {
                domain: nextDomain,
                contactAddress,
                contactName,
                contactPhone,
                contactEmail,
                industry,
                location,
                businessCards: normalizeMerchantBusinessCardChatDisplaySelection(target?.businessCards ?? []),
              }),
          );
          if (!syncResult.ok) {
            throw new Error(syncResult.message || "商户信息同步失败，请稍后重新保存");
          }
          const saved = savePlatformState(nextPlatformState);
          if (!saved) {
            throw new Error("商户信息保存失败，请稍后重试");
          }
          if (!isDesktopMerchantWorkspace) {
            setMerchantProfileDialogOpen(false);
          }
          setMerchantProfileAttention(false);
          showTip("商户信息已保存");
        },
      }
    : null;
  const supportSelfPrimaryChatCard = resolveMerchantBusinessCardForChatDisplay(supportSelfBusinessCards);
  const supportSelfCardsSummary =
    supportSelfBusinessCards.length > 0
      ? `共 ${supportSelfBusinessCards.length} 张，当前展示：${supportSelfPrimaryChatCard?.name || "未命名名片"}`
      : "还没有名片，可在这里设置聊天展示与复制";
  const merchantBusinessCardManagerCommonProps = merchantProfileDialogCommonProps
    ? {
        merchantId: merchantProfileDialogCommonProps.siteId,
        siteBaseDomain: merchantProfileDialogCommonProps.siteBaseDomain,
        profile: {
          merchantName: merchantProfileDialogCommonProps.initialMerchantName,
          domainPrefix: merchantProfileDialogCommonProps.initialDomainPrefix,
          contactAddress: merchantProfileDialogCommonProps.initialContactAddress,
          contactName: merchantProfileDialogCommonProps.initialContactName,
          contactPhone: merchantProfileDialogCommonProps.initialContactPhone,
          contactEmail: merchantProfileDialogCommonProps.initialContactEmail,
          location: merchantProfileDialogCommonProps.initialLocation,
          industry: merchantProfileDialogCommonProps.initialIndustry ?? undefined,
        } satisfies MerchantBusinessCardProfileInput,
        cards: supportSelfBusinessCards,
        cardLimit: merchantProfileDialogCommonProps.businessCardLimit,
        allowLinkMode: merchantProfileDialogCommonProps.allowBusinessCardLinkMode,
        allowIntroVideo: merchantProfileDialogCommonProps.allowBusinessCardIntroVideo,
        backgroundImageLimitKb: merchantProfileDialogCommonProps.businessCardBackgroundImageLimitKb,
        contactPageImageLimitKb: merchantProfileDialogCommonProps.businessCardContactImageLimitKb,
        exportImageLimitKb: merchantProfileDialogCommonProps.businessCardExportImageLimitKb,
        introVideoLimitMb: merchantProfileDialogCommonProps.businessCardIntroVideoLimitMb,
        onCardsChange: merchantProfileDialogCommonProps.onCardsChange,
      }
    : null;
  const supportSelfVisibilityItems = [
    {
      key: "phone",
      label: "电话",
      value: supportSelfPhone,
      hidden: supportSelfContactVisibility.phoneHidden,
      visibilityKey: "phoneHidden" as const,
    },
    {
      key: "email",
      label: "邮箱",
      value: supportSelfEmail,
      hidden: supportSelfContactVisibility.emailHidden,
      visibilityKey: "emailHidden" as const,
    },
    {
      key: "card",
      label: "联系卡",
      value: supportSelfCardLabel,
      href: supportSelfCardHref || undefined,
      hidden: supportSelfContactVisibility.businessCardHidden,
      visibilityKey: "businessCardHidden" as const,
    },
    {
      key: "website",
      label: "官网",
      value: supportSelfWebsiteLabel,
      href: supportSelfWebsiteHref || undefined,
    },
  ];
  const supportPushAvailable = canUseSupportSystemNotifications();
  const supportNativeNotificationsAvailable = canUseFaollaNativeNotifications();
  const supportPushStatusText = !supportPushAvailable
    ? "当前环境暂不支持系统通知。"
    : !supportSystemNotificationsEnabled
      ? "系统消息通知已关闭。"
      : !supportNativeNotificationsAvailable && !supportPushStandalone
        ? "添加到主屏幕后可显示系统通知和角标。"
        : supportPushPermission === "granted"
          ? supportPushSubscribed
            ? "已开启新消息通知和角标。"
            : "通知权限已开启，正在连接当前设备。"
          : supportPushPermission === "denied"
            ? "通知已被系统拦截，请在浏览器或系统设置里重新允许。"
            : "开启后，后台新消息会显示系统通知和桌面角标。";
  const supportSelfNotificationSummary = [
    !supportPushAvailable
      ? "系统通知不可用"
      : supportSystemNotificationsEnabled
        ? "系统通知已开"
        : "系统通知已关",
    supportMessageSoundEnabled ? "提示音已开" : "提示音已关",
    supportVibrationEnabled ? "震动已开" : "震动已关",
  ].join(" · ");
  const supportMobileDarkMode = false;
  const supportMobileShellClassName = "support-mobile-shell";
  const supportMobileBackgroundClassName = "bg-[linear-gradient(180deg,#f8fafc_0%,#eef2ff_48%,#f8fafc_100%)]";

  const supportMobileConversationsContent = (
    <>
      <div className="faolla-mobile-list-header shrink-0 border-b border-slate-200/80 bg-white/90 px-4 pb-4 pt-[calc(var(--faolla-mobile-safe-top)+0.75rem)] shadow-[0_8px_30px_rgba(15,23,42,0.06)] backdrop-blur">
        <div className="flex items-center gap-3">
          <div className="faolla-mobile-list-badge flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-slate-900 text-sm font-semibold text-white shadow-sm">
            会话
          </div>
          <div className="min-w-0 flex-1">
            <div className="faolla-mobile-list-title text-[15px] font-semibold text-slate-900">聊天列表</div>
            <div className="faolla-mobile-list-summary mt-1 text-xs text-slate-500">{mobileSupportContactListSummary}</div>
          </div>
          {!isMobileMerchantSupportOnlyMode ? (
            <button
              type="button"
              className="shrink-0 rounded-full border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50"
              onClick={() => setSupportDialogOpen(false)}
              disabled={supportSending}
            >
              关闭
            </button>
          ) : null}
        </div>
        <div
          className="overflow-hidden transition-[max-height,opacity,padding] duration-150"
          style={{
            maxHeight:
              supportMobileConversationPullDistance > 0 || supportMobileConversationRefreshing
                ? `${Math.max(36, Math.round(supportMobileConversationPullDistance))}px`
                : "0px",
            opacity: supportMobileConversationPullDistance > 0 || supportMobileConversationRefreshing ? 1 : 0,
            paddingTop: supportMobileConversationPullDistance > 0 || supportMobileConversationRefreshing ? "0.75rem" : "0px",
          }}
        >
          <div className="flex justify-center">
            <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-medium text-slate-500 shadow-sm">
              {supportMobileConversationRefreshing
                ? "刷新中..."
                : supportMobileConversationReadyToRefresh
                  ? "松开刷新"
                  : "下拉刷新"}
            </span>
          </div>
        </div>
        <div className="faolla-mobile-search-row mt-4 flex items-center gap-2">
          <div className="faolla-mobile-search-box flex h-[34px] min-h-[34px] min-w-0 flex-1 items-center gap-2.5 rounded-[17px] border border-slate-200 bg-[#f3f4f6] px-3 py-1.5 shadow-sm">
            <svg viewBox="0 0 24 24" className="h-[17px] w-[17px] shrink-0 text-slate-400" fill="none" aria-hidden="true">
              <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.9" />
              <path d="m16 16 4 4" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
            </svg>
            <input
              type="text"
              className="min-w-0 flex-1 bg-transparent text-[14px] leading-5 text-slate-900 outline-none placeholder:text-slate-400"
              placeholder="商户ID / 邮箱"
              value={supportContactKeyword}
              onChange={(event) => setSupportContactKeyword(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
                event.preventDefault();
                void searchSupportPeerMerchant();
              }}
            />
          </div>
          <button
            type="button"
            className="faolla-mobile-search-button inline-flex h-[34px] min-h-[34px] shrink-0 items-center justify-center rounded-[17px] border border-slate-200 bg-white px-3 py-0 text-[13px] leading-none shadow-sm hover:bg-slate-50 disabled:opacity-50"
            onClick={() => void searchSupportPeerMerchant()}
            disabled={supportSearchLoading}
          >
            {supportSearchLoading ? "搜索中" : "搜索"}
          </button>
        </div>
        {supportSearchError ? (
          <div className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-600">
            {supportSearchError}
          </div>
        ) : null}
        {supportPeerError ? (
          <div className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-600">
            {supportPeerError}
          </div>
        ) : null}
      </div>
      <div
        ref={supportMobileConversationsViewportRef}
        className="faolla-mobile-chat-list min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-[calc(var(--faolla-mobile-safe-bottom)+5.85rem)] pt-3"
        {...supportMobileConversationPullBind}
      >
        <div className="flex flex-col">
          {supportContactRows.map((contactRow) => {
            const active = supportSelectedContactKey === contactRow.key;
            return (
              <button
                key={contactRow.key}
                type="button"
                className={`faolla-mobile-chat-row w-full rounded-none border-0 border-b border-slate-200/60 bg-transparent px-1 py-3 text-left shadow-none transition ${
                  active ? "bg-slate-50" : "hover:bg-slate-50"
                }`}
                onClick={() => openSupportContactThread(contactRow.key)}
              >
                <div className="flex items-start gap-3">
                  <SupportAvatarBadge
                    label={contactRow.avatarLabel}
                    imageUrl={contactRow.avatarImageUrl}
                    imageAlt={contactRow.name}
                    className={`faolla-mobile-chat-avatar mt-0.5 flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
                      contactRow.isOfficial || contactRow.unread
                        ? "bg-slate-900 text-white"
                        : "bg-slate-100 text-slate-700"
                    }`}
                    labelClassName="text-sm font-semibold"
                    showMerchantBadge={contactRow.accountType === "merchant"}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <div className="faolla-mobile-chat-name truncate text-sm font-semibold text-slate-900" data-no-translate="1">{contactRow.name}</div>
                          {!contactRow.isOfficial ? (
                            <span className="truncate text-[11px] font-medium text-slate-400" data-no-translate="1">{contactRow.subtitle}</span>
                          ) : null}
                          {contactRow.badge ? (
                            <span className="inline-flex shrink-0 items-center rounded-full bg-slate-900 px-2 py-0.5 text-[10px] font-medium text-white">
                              {contactRow.badge}
                            </span>
                          ) : null}
                          {contactRow.unreadCount > 0 ? (
                            <span
                              aria-label={`有 ${contactRow.unreadCount} 条未读消息`}
                              className="inline-flex min-w-[18px] shrink-0 items-center justify-center rounded-full bg-rose-500 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white"
                            >
                              {contactRow.unreadCount > 99 ? "99+" : contactRow.unreadCount}
                            </span>
                          ) : null}
                        </div>
                        {contactRow.isOfficial ? (
                          <div className="mt-1 truncate text-[11px] text-slate-500" data-no-translate="1">{contactRow.subtitle}</div>
                        ) : null}
                      </div>
                      <div className="faolla-mobile-chat-time shrink-0 text-[11px] text-slate-400">
                        {contactRow.updatedAt ? formatSupportConversationTime(contactRow.updatedAt) : "未开始"}
                      </div>
                    </div>
                    <div className="faolla-mobile-chat-preview mt-2 truncate text-[13px] leading-5 text-slate-600" data-no-translate="1">{contactRow.preview}</div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </>
  );

  const supportMobileBusinessContent = (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-[calc(var(--faolla-mobile-safe-bottom)+5.85rem)] pt-0">
        {supportMobileBookingSiteId ? (
          <div className="space-y-4">
            {resolvedSupportMobileBusinessSection === "orders" && canUseOrderManagement ? (
              <MerchantOrderMobilePanel
                siteId={supportMobileBookingSiteId}
                siteName={merchantDisplayName}
                darkMode={supportMobileDarkMode}
                onOrdersChange={handleMerchantOrderRecordsChange}
                onOpenConversation={openSupportConversationFromBusinessRecord}
                {...(canUseEnterpriseManagement
                  ? {
                      onOpenEnterpriseTask: (order: MerchantOrderRecord) =>
                        openMerchantOrderEnterpriseTask(order, "mobile"),
                    }
                  : {})}
                sourceOrderIntent={
                  merchantOrderSourceIntent?.siteId === supportMobileBookingSiteId
                    ? merchantOrderSourceIntent
                    : null
                }
                onSourceOrderIntentHandled={handleMerchantOrderSourceIntentHandled}
                onSectionChange={setSupportMobileBusinessSection}
              />
            ) : (
              <MerchantBookingMobilePanel
                siteId={supportMobileBookingSiteId}
                siteName={merchantDisplayName}
                siteCountryCode={effectiveEditingSite?.location?.countryCode ?? editingSite?.location?.countryCode ?? ""}
                storeOptions={merchantBookingManagerOptions.storeOptions}
                itemOptions={merchantBookingManagerOptions.itemOptions}
                titleOptions={merchantBookingManagerOptions.titleOptions}
                bookingRulesSnapshot={merchantBookingRulesSnapshot}
                darkMode={supportMobileDarkMode}
                allowBookingEmailPrefill={Boolean(merchantPermissionConfig?.allowBookingEmailPrefill)}
                allowCustomerAutoEmail={Boolean(merchantPermissionConfig?.allowBookingAutoEmail)}
                onRecordsChange={handleMerchantBookingRecordsChange}
                allowOrderManagement={canUseOrderManagement}
                onOpenConversation={openSupportConversationFromBusinessRecord}
                onSectionChange={setSupportMobileBusinessSection}
              />
            )}
          </div>
        ) : (
          <>
            <div className="pt-4">
              <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_14px_34px_rgba(15,23,42,0.08)]">
                <div className="text-base font-semibold text-slate-900">当前商户信息还没准备好</div>
                <div className="mt-2 text-sm leading-6 text-slate-500">
                  手机端暂时还没识别到当前商户，稍后刷新后会直接显示预约记录和处理入口。
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );

  const supportMobileEnterpriseContent = (
    <div
      data-enterprise-mobile-panel
      className={`flex h-full min-h-0 flex-1 flex-col overflow-hidden ${supportMobileBackgroundClassName}`}
    >
      <header className="shrink-0 border-b border-slate-200/80 bg-white/95 px-3 pb-3 pt-[calc(var(--faolla-mobile-safe-top)+0.55rem)] shadow-[0_8px_30px_rgba(15,23,42,0.06)] backdrop-blur">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-slate-900 transition hover:bg-slate-100 active:bg-slate-200"
            onClick={() => openSupportMobileHomeTab("conversations")}
            aria-label="返回会话"
          >
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" aria-hidden="true">
              <path
                d="M19 12H7M12 7l-5 5 5 5"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <div className="min-w-0">
            <div className="truncate text-base font-semibold text-slate-950">企业管理</div>
            <div className="mt-0.5 truncate text-xs text-slate-500">
              {effectiveMerchantDisplayName || merchantDisplayName || supportMobileBookingSiteId || "企业工作区"}
            </div>
          </div>
        </div>
      </header>
      <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain px-3 pb-[calc(var(--faolla-mobile-safe-bottom)+1rem)]">
        {canUseEnterpriseManagement && supportMobileBookingSiteId ? (
          <MerchantEnterpriseManager
            siteId={supportMobileBookingSiteId}
            siteName={effectiveMerchantDisplayName || merchantDisplayName}
            className="!min-h-0 !py-3"
            onTodoCountChange={setMerchantEnterpriseTodoCount}
            taskDraftIntent={
              merchantEnterpriseTaskIntent?.siteId === supportMobileBookingSiteId
                ? merchantEnterpriseTaskIntent
                : null
            }
            onTaskDraftIntentHandled={handleMerchantEnterpriseTaskIntentHandled}
            registerLeaveGuard={(guard) => {
              supportMobileEnterpriseLeaveGuardRef.current = guard;
            }}
            {...(canUseOrderManagement
              ? {
                  onOpenSourceOrder: (input: { siteId: string; orderId: string }) =>
                    openMerchantEnterpriseSourceOrder(input, "mobile"),
                }
              : {})}
          />
        ) : (
          <section className="mt-4 rounded-[28px] border border-amber-200 bg-white p-5 shadow-[0_14px_34px_rgba(15,23,42,0.08)]">
            <div className="text-base font-semibold text-slate-900">企业管理暂不可用</div>
            <div className="mt-2 text-sm leading-6 text-slate-500">
              {canUseEnterpriseManagement
                ? "当前商户信息还没准备好，请稍后刷新再试。"
                : "当前账号未开通企业管理。"}
            </div>
          </section>
        )}
      </div>
    </div>
  );

  const supportMobileSelfContent =
    supportSelfSectionView === "qr" ? (
      <FaollaQrPanel
        profileName={supportSelfDisplayName}
        profileSubtitle="Faolla 商户"
        avatarUrl={supportSelfAvatarImageUrl}
        avatarFallback={supportSelfAvatarLabel}
        qrUrl={supportSelfQrUrl}
        note="个人用户扫码后会打开该商户前台，并自动收藏该商户。"
        onBack={() => setSupportSelfSectionView("home")}
        onScanResult={handleSupportQrScanResult}
        onResetQr={resetSupportSelfQrCode}
      />
    ) : (
    <div
      className="flex h-full min-h-0 flex-1 flex-col overflow-hidden"
      onTouchStart={handleSupportSelfSectionTouchStart}
      onTouchEnd={handleSupportSelfSectionTouchEnd}
      onTouchCancel={() => {
        supportSelfSwipeStartRef.current = null;
      }}
    >
      <div className="faolla-mobile-self-header relative shrink-0 border-b border-slate-200/80 bg-white/90 px-4 pb-4 pt-[calc(var(--faolla-mobile-safe-top)+0.75rem)] shadow-[0_8px_30px_rgba(15,23,42,0.06)] backdrop-blur">
        {supportSelfSectionView === "home" ? (
          <button
            type="button"
            className="absolute left-4 top-[calc(var(--faolla-mobile-safe-top)+0.7rem)] z-20 flex h-11 w-11 items-center justify-center rounded-full bg-white text-slate-900 shadow-[0_10px_24px_rgba(15,23,42,0.10)]"
            onClick={() => {
              void loadFaollaQrPanel().catch(() => undefined);
              setSupportSelfSectionView("qr");
            }}
            aria-label="打开二维码"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
              <path d="M5 5h5v5H5V5Zm9 0h5v5h-5V5ZM5 14h5v5H5v-5Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
              <path d="M14 14h2.5v2.5H19M14 19h2M19 14v2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        ) : null}
        <div className="absolute right-4 top-[calc(var(--faolla-mobile-safe-top)+0.7rem)] z-20">
          <div ref={supportSelfLanguageRootRef} className="relative">
            <button
              type="button"
              className="faolla-mobile-language-button block h-6 w-[35px] overflow-hidden rounded-[3px] border border-slate-300/80 bg-transparent p-0 transition hover:brightness-105"
              onClick={() => setSupportSelfLanguageMenuOpen((current) => !current)}
              aria-label={t("lang.placeholder")}
              aria-expanded={supportSelfLanguageMenuOpen}
              title={supportSelfSelectedLanguage.label}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={languageFlagImageUrl(supportSelfSelectedLanguage.countryCode)}
                alt={supportSelfSelectedLanguage.label}
                width={80}
                height={60}
                className="block h-full w-full object-cover"
                loading="eager"
              />
            </button>
            {supportSelfLanguageMenuOpen ? (
              <div
                ref={supportSelfLanguageMenuRef}
                className="absolute right-0 top-[calc(100%+0.5rem)] max-h-[55vh] w-[220px] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-2 shadow-[0_22px_60px_rgba(15,23,42,0.22)]"
              >
                <div className="space-y-1">
                  {LANGUAGE_OPTIONS.map((item) => (
                    <button
                      key={item.code}
                      type="button"
                      className={`flex w-full items-center gap-2 rounded-xl px-2 py-2 text-left text-sm transition ${
                        item.code === resolvedAdminLocale
                          ? "bg-slate-900 text-white"
                          : "text-slate-700 hover:bg-slate-100"
                      }`}
                      onClick={() => {
                        setLocale(item.code);
                        setSupportSelfLanguageMenuOpen(false);
                      }}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={languageFlagImageUrl(item.countryCode)}
                        alt={item.label}
                        width={16}
                        height={12}
                        className="rounded-[2px] border border-slate-200 object-cover"
                        loading="lazy"
                      />
                      <span className="truncate">{item.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>
        {supportSelfSectionView === "home" ? (
          <div className="faolla-mobile-self-profile-hero flex flex-col items-center px-4 text-center">
            <button
              type="button"
              className="faolla-mobile-self-avatar relative flex h-[98px] w-[98px] shrink-0 items-center justify-center overflow-hidden rounded-full bg-slate-900 text-xl font-semibold text-white shadow-[0_18px_40px_rgba(15,23,42,0.16)]"
              onClick={openSupportSelfAvatarPicker}
              disabled={supportSelfAvatarUploading || supportSelfProfileSaving}
              aria-label="上传头像"
            >
              <SupportAvatarBadge
                label={supportSelfAvatarLabel}
                imageUrl={supportSelfAvatarImageUrl}
                imageAlt={supportSelfDisplayName}
                className="faolla-mobile-self-avatar-image flex h-full w-full items-center justify-center rounded-full bg-slate-900 text-white"
                labelClassName="text-xl font-semibold text-white"
              />
              {(supportSelfAvatarUploading || supportSelfProfileSaving) ? (
                <span className="absolute inset-0 flex items-center justify-center bg-slate-950/35">
                  <span className="h-6 w-6 animate-spin rounded-full border-2 border-white/35 border-t-white" />
                </span>
              ) : (
                <span className="absolute bottom-2 right-2 inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/80 bg-white text-slate-900 shadow-[0_8px_20px_rgba(15,23,42,0.18)]">
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" aria-hidden="true">
                    <path
                      d="M8.5 8.5 9.7 7h4.6l1.2 1.5H18A2 2 0 0 1 20 10.5v5A2.5 2.5 0 0 1 17.5 18h-11A2.5 2.5 0 0 1 4 15.5v-5A2 2 0 0 1 6 8.5h2.5Z"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <path
                      d="M12 14.7a2.4 2.4 0 1 0 0-4.8 2.4 2.4 0 0 0 0 4.8Z"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
              )}
            </button>
            <div className="faolla-mobile-self-name mt-4 truncate text-[28px] font-semibold leading-none text-slate-950">{supportSelfDisplayName}</div>
            <div className="faolla-mobile-self-subtitle mt-2 max-w-full truncate text-sm text-slate-500">
              {supportSelfWebsiteLabel !== "-" ? supportSelfWebsiteLabel : normalizeSupportDisplayValue(editingSiteId) || "点击头像上传资料照片"}
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3 pr-16">
            <button
              type="button"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-slate-900 hover:bg-slate-100"
              onClick={() => {
                if (isFaollaMobileSettingsView(supportSelfSectionView)) {
                  setSupportSelfSectionView(getFaollaMobileSettingsBackView(supportSelfSectionView));
                } else {
                  setSupportSelfSectionView("home");
                }
              }}
              aria-label="返回我的主页"
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
            <div className="min-w-0 flex-1">
              <div className="truncate text-[16px] font-semibold text-slate-900">
                {supportSelfSectionView === "profile"
                  ? "我的资料"
                  : supportSelfSectionView === "cards"
                    ? "名片夹"
                  : supportSelfSectionView === "coupons"
                    ? "优惠券"
                  : supportSelfSectionView === "tools"
                    ? "小工具"
                  : supportSelfSectionView === "games"
                    ? "游戏大厅"
                    : isFaollaMobileSettingsView(supportSelfSectionView)
                      ? getFaollaMobileSettingsTitle(supportSelfSectionView)
                      : "通知"}
              </div>
              <div className="mt-1 truncate text-xs text-slate-500">
                {supportSelfSectionView === "profile"
                  ? "手机端与电脑端共用同一份商户资料。"
                  : supportSelfSectionView === "cards"
                    ? "这里统一管理聊天展示名片与复制能力。"
                  : supportSelfSectionView === "coupons"
                    ? "查看优惠券列表，复制券、启停和删除与网页端一致。"
                  : supportSelfSectionView === "tools"
                    ? "商家后台里的常用计分工具。"
                  : supportSelfSectionView === "games"
                    ? "坦克大战等休闲游戏。"
                    : isFaollaMobileSettingsView(supportSelfSectionView)
                      ? getFaollaMobileSettingsSubtitle(supportSelfSectionView, supportSelfNotificationSummary)
                      : "这里控制系统消息通知、提示音和震动。"}
              </div>
            </div>
          </div>
        )}
      </div>
      <div
        ref={supportSelfScrollContainerRef}
        className="faolla-mobile-self-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-[calc(var(--faolla-mobile-safe-bottom)+5.85rem)] pt-4"
      >
        <input
          ref={supportSelfAvatarInputRef}
          className="hidden"
          type="file"
          accept="image/*"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(event) => {
            void handleSupportSelfAvatarInputChange(event);
          }}
        />
        {supportSelfSectionView === "home" ? (
          <div className="faolla-mobile-card-stack space-y-4">
            <section className="faolla-mobile-menu-card overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-[0_14px_34px_rgba(15,23,42,0.08)]">
              <div className="divide-y divide-slate-100">
                {[
                  {
                    key: "profile",
                    label: "我的资料",
                    summary: supportSelfProfileSummary,
                    icon: (
                      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
                        <circle cx="12" cy="8.5" r="3.2" fill="none" stroke="currentColor" strokeWidth="1.8" />
                        <path d="M6.2 18.2a5.8 5.8 0 0 1 11.6 0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                      </svg>
                    ),
                    onClick: () => setSupportSelfSectionView("profile" as const),
                  },
                  {
                    key: "cards",
                    label: "名片夹",
                    summary: supportSelfCardsSummary,
                    icon: (
                      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
                        <rect x="4.5" y="6" width="15" height="12" rx="2.5" stroke="currentColor" strokeWidth="1.8" />
                        <circle cx="9" cy="12" r="1.8" stroke="currentColor" strokeWidth="1.8" />
                        <path d="M13 10.2h3.5M13 13h3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                      </svg>
                    ),
                    onClick: () => setSupportSelfSectionView("cards" as const),
                  },
                  {
                    key: "coupons",
                    label: "优惠券",
                    summary: canUseCouponModule
                      ? `${merchantCouponRecords.filter((coupon) => coupon.status !== "archived").length} 张，${getVisibleMerchantCoupons(merchantCouponRecords).length} 张展示中`
                      : "当前商户未开通优惠券模块",
                    icon: (
                      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
                        <path d="M4.8 8.2V6.7A1.7 1.7 0 0 1 6.5 5h11A1.7 1.7 0 0 1 19.2 6.7v1.5a2.2 2.2 0 0 0 0 4.4v4.7a1.7 1.7 0 0 1-1.7 1.7h-11a1.7 1.7 0 0 1-1.7-1.7v-4.7a2.2 2.2 0 0 0 0-4.4Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
                        <path d="M9 8.5h6M9 12h6M9 15.5h3.8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                      </svg>
                    ),
                    onClick: () => {
                      void loadMerchantCouponManager().catch(() => undefined);
                      setSupportSelfSectionView("coupons" as const);
                    },
                  },
                  {
                    key: "tools",
                    label: "小工具",
                    summary: "双扣计分等常用工具",
                    icon: <ToolboxIcon />,
                    onClick: () => setSupportSelfSectionView("tools" as const),
                  },
                  {
                    key: "games",
                    label: "游戏大厅",
                    summary: "坦克大战等休闲游戏",
                    icon: <TankBattleIcon className="h-5 w-5" />,
                    onClick: () => setSupportSelfSectionView("games" as const),
                  },
                  {
                    key: "settings",
                    label: "设置",
                    summary: faollaAndroidAppUpdate.updateAvailable ? "有新版本可更新" : "通知、版本和法律",
                    icon: (
                      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
                        <path d="M12 8.4a3.6 3.6 0 1 0 0 7.2 3.6 3.6 0 0 0 0-7.2Z" stroke="currentColor" strokeWidth="1.8" />
                        <path
                          d="m18.4 13.6.2 1.6 1.5 1-1.8 3.1-1.7-.7-1.3 1H8.7l-1.3-1-1.7.7-1.8-3.1 1.5-1 .2-1.6L4.3 12l1.3-1.6-.2-1.6-1.5-1 1.8-3.1 1.7.7 1.3-1h6.6l1.3 1 1.7-.7 1.8 3.1-1.5 1-.2 1.6 1.3 1.6-1.3 1.6Z"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinejoin="round"
                        />
                      </svg>
                    ),
                    onClick: () => setSupportSelfSectionView("settings" as const),
                  },
                ].map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    className="faolla-mobile-menu-row flex w-full items-center gap-4 px-5 py-4 text-left transition hover:bg-slate-50"
                    onClick={item.onClick}
                  >
                    <span className="faolla-mobile-menu-icon inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-slate-100 text-slate-700">
                      {item.icon}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="faolla-mobile-menu-title flex items-center gap-2 text-sm font-semibold text-slate-900">
                        <span className="truncate">{item.label}</span>
                        {item.key === "settings" && faollaAndroidAppUpdate.updateAvailable ? (
                          <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-500 ring-2 ring-emerald-50" aria-label="有更新" />
                        ) : null}
                      </span>
                      <span className="faolla-mobile-menu-summary mt-1 block truncate text-xs leading-5 text-slate-500">{item.summary}</span>
                    </span>
                    <span className="text-slate-300">
                      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
                        <path d="m9 6 6 6-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </span>
                  </button>
                ))}
              </div>
            </section>

            <section className="faolla-mobile-menu-card overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-[0_14px_34px_rgba(15,23,42,0.08)]">
              <div className="grid grid-cols-2 divide-x divide-slate-100">
                <button
                  type="button"
                  className="faolla-mobile-menu-row flex items-center justify-between gap-3 px-5 py-4 text-left transition hover:bg-slate-50 disabled:opacity-50"
                  onClick={() => {
                    void openAccountSwitcher();
                  }}
                  disabled={loggingOut || Boolean(accountSwitchBusyKey)}
                >
                  <div className="text-sm font-semibold text-slate-800">切换账号</div>
                  <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-700">
                    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
                      <path d="M8 7.5h7.5a3 3 0 0 1 0 6H9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                      <path d="m11 4.5-3 3 3 3M16 16.5H8.5a3 3 0 0 1 0-6H15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                      <path d="m13 13.5 3 3-3 3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </span>
                </button>
                <button
                  type="button"
                  className="faolla-mobile-menu-row flex items-center justify-between gap-3 px-5 py-4 text-left transition hover:bg-rose-50/70 disabled:opacity-50"
                  onClick={() => {
                    void requestLogout();
                  }}
                  disabled={loggingOut}
                >
                  <div className="text-sm font-semibold text-rose-600">{loggingOut ? "退出中..." : "退出登录"}</div>
                  <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-rose-50 text-rose-600">
                    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
                      <path d="M14 7h2a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                      <path d="M10 8 6 12l4 4M7 12h9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </span>
                </button>
              </div>
            </section>
          </div>
        ) : supportSelfSectionView === "profile" ? (
          <div className="space-y-4">
            {merchantProfileDialogCommonProps ? (
              <MerchantProfileDialog
                {...merchantProfileDialogCommonProps}
                open
                mode="inline"
                showCloseButton={false}
                showBusinessCardManager={false}
                className="rounded-[28px] border-slate-200 shadow-[0_14px_34px_rgba(15,23,42,0.08)]"
              />
            ) : (
              <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-[0_14px_34px_rgba(15,23,42,0.08)]">
                <div className="px-5 py-4">
                  <div className="text-sm font-semibold text-slate-900">商户资料暂未准备好</div>
                  <div className="mt-1 text-xs leading-5 text-slate-500">稍后刷新后，这里会直接显示和电脑端同一套商户资料编辑表单。</div>
                </div>
              </section>
            )}

            <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-[0_14px_34px_rgba(15,23,42,0.08)]">
              <div className="border-b border-slate-100 px-5 py-4">
                <div className="text-sm font-semibold text-slate-900">聊天资料</div>
              </div>
              <div className="border-b border-slate-100 px-5 py-4">
                <div className="text-[11px] font-medium tracking-[0.08em] text-slate-400">个性签名</div>
                <textarea
                  className="mt-2 h-24 w-full resize-none rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-3 text-base leading-7 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-slate-300 focus:bg-white"
                  value={supportSelfSignatureDraft}
                  placeholder={SUPPORT_EMPTY_SIGNATURE_TEXT}
                  maxLength={80}
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                  onChange={(event) => {
                    setSupportSelfSignatureDraft(event.target.value);
                    setSupportSelfSignatureDirty(event.target.value.trim() !== supportSelfSignature);
                  }}
                  disabled={supportSelfProfileSaving}
                />
                <div className="mt-2 flex items-center justify-end gap-3 text-[11px] text-slate-500">
                  <button
                    type="button"
                    className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition ${
                      supportSelfSignatureDirty
                        ? "bg-slate-900 text-white shadow-sm"
                        : "border border-slate-200 bg-white text-slate-400"
                    }`}
                    onClick={() => {
                      void handleSupportSelfSignatureSave();
                    }}
                    disabled={supportSelfProfileSaving || !supportSelfSignatureDirty}
                  >
                    {supportSelfProfileSaving ? "保存中" : "保存签名"}
                  </button>
                </div>
              </div>
              <div className="divide-y divide-slate-100">
                {supportSelfVisibilityItems.map((item) => {
                  const canToggleHidden = "visibilityKey" in item;
                  return (
                    <div key={item.key} className="px-5 py-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="text-[11px] font-medium tracking-[0.08em] text-slate-400">{item.label}</div>
                          <div className="mt-1 text-sm leading-6 text-slate-900">
                            {item.href ? (
                              <a
                                href={item.href}
                                target={item.key === "website" ? "_blank" : undefined}
                                rel={item.key === "website" ? "noreferrer" : undefined}
                                className="break-all underline decoration-slate-300 underline-offset-4"
                              >
                                {item.value}
                              </a>
                            ) : (
                              <span>{item.value}</span>
                            )}
                          </div>
                        </div>
                        {canToggleHidden ? (
                          <button
                            type="button"
                            className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition ${
                              item.hidden
                                ? "bg-slate-900 text-white"
                                : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                            }`}
                            onClick={() => {
                              if (!item.visibilityKey) return;
                              void handleSupportSelfVisibilityChange(item.visibilityKey, !item.hidden);
                            }}
                            disabled={supportSelfProfileSaving}
                          >
                            {item.hidden ? "已隐藏" : "公开"}
                          </button>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          </div>
        ) : supportSelfSectionView === "cards" ? (
          merchantBusinessCardManagerCommonProps ? (
            <MerchantBusinessCardManager {...merchantBusinessCardManagerCommonProps} folderViewMode="page" />
          ) : (
            <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-[0_14px_34px_rgba(15,23,42,0.08)]">
              <div className="px-5 py-6">
                <div className="text-sm font-semibold text-slate-900">名片夹暂未准备好</div>
                <div className="mt-1 text-xs leading-5 text-slate-500">稍后刷新后，手机端这里会直接显示和电脑端同一套名片夹。</div>
              </div>
            </section>
          )
        ) : supportSelfSectionView === "coupons" ? (
          <div className="space-y-4">
            {canUseCouponModule ? (
              <MerchantCouponManager
                siteId={editingSiteId || ""}
                siteName={effectiveMerchantDisplayName || merchantDisplayName}
                publicSiteUrl={supportSelfWebsiteHref}
                couponPageId={merchantCouponPageId}
                onCouponsChange={setMerchantCouponRecords}
                listOnly
                className="faolla-mobile-coupon-list"
              />
            ) : (
              <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-[0_14px_34px_rgba(15,23,42,0.08)]">
                <div className="px-5 py-6">
                  <div className="text-sm font-semibold text-slate-900">优惠券模块未开通</div>
                  <div className="mt-1 text-xs leading-5 text-slate-500">开通后，手机端这里会显示与网页端一致的优惠券列表。</div>
                </div>
              </section>
            )}
          </div>
        ) : supportSelfSectionView === "tools" ? (
          <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_14px_34px_rgba(15,23,42,0.08)]">
            <div className="grid grid-cols-4 gap-x-4 gap-y-5">
              <button
                type="button"
                className="group flex min-w-0 flex-col items-center gap-2.5 text-center"
                onClick={openSupportShuangkouScoreTool}
              >
                <span className="flex h-14 w-14 items-center justify-center rounded-[18px] bg-emerald-700 text-white shadow-[0_12px_24px_rgba(4,120,87,0.28)] transition group-active:scale-95">
                  <ShuangkouToolIcon />
                </span>
                <span className="w-full truncate text-xs font-semibold text-slate-900">双扣计分</span>
              </button>
            </div>
          </section>
        ) : supportSelfSectionView === "games" ? (
          <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_14px_34px_rgba(15,23,42,0.08)]">
            <div className="grid grid-cols-4 gap-x-4 gap-y-5">
              <button
                type="button"
                className="group flex min-w-0 flex-col items-center gap-2.5 text-center"
                onClick={openSupportTankBattleGame}
              >
                <span className="flex h-14 w-14 items-center justify-center rounded-[18px] bg-lime-700 text-white shadow-[0_12px_24px_rgba(77,124,15,0.28)] transition group-active:scale-95">
                  <TankBattleIcon />
                </span>
                <span className="w-full truncate text-xs font-semibold text-slate-900">坦克大战</span>
              </button>
              <button
                type="button"
                className="group flex min-w-0 flex-col items-center gap-2.5 text-center"
                onClick={openSupportNoMercyFlagGame}
              >
                <span className="flex h-14 w-14 items-center justify-center rounded-[18px] bg-teal-700 text-white shadow-[0_12px_24px_rgba(15,118,110,0.28)] transition group-active:scale-95">
                  <NoMercyFlagIcon />
                </span>
                <span className="w-full truncate text-xs font-semibold text-slate-900">不服再试</span>
              </button>
            </div>
          </section>
        ) : isFaollaMobileSettingsView(supportSelfSectionView) ? (
          <FaollaMobileSettingsContent
            view={supportSelfSectionView}
            notificationSummary={supportSelfNotificationSummary}
            appUpdateState={faollaAndroidAppUpdate}
            onViewChange={(nextView) => setSupportSelfSectionView(nextView)}
            notificationContent={
              <div className="space-y-4">
                <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-[0_14px_34px_rgba(15,23,42,0.08)]">
                  <div className="border-b border-slate-100 px-5 py-4">
                    <div className="text-sm font-semibold text-slate-900">通知</div>
                    <div className="mt-1 text-xs text-slate-500">{supportPushStatusText}</div>
                  </div>
                  <div className="divide-y divide-slate-100">
                    {[
                      {
                        key: "system",
                        label: "系统消息通知",
                        description: supportPushStatusText,
                        checked: supportSystemNotificationsEnabled,
                        disabled: supportPushBusy || (!supportPushAvailable && !supportSystemNotificationsEnabled),
                        onToggle: () => {
                          void handleSupportSystemNotificationsToggle(!supportSystemNotificationsEnabled);
                        },
                      },
                      {
                        key: "sound",
                        label: "消息提示音",
                        description: "新消息到达时播放提示音。",
                        checked: supportMessageSoundEnabled,
                        disabled: false,
                        onToggle: () => setSupportMessageSoundEnabled((current) => !current),
                      },
                      {
                        key: "vibration",
                        label: "震动",
                        description:
                          canUseFaollaNativeNotifications() ||
                          (typeof navigator !== "undefined" && typeof navigator.vibrate === "function")
                            ? "新消息到达时使用设备震动提醒。"
                            : "当前设备或浏览器暂不支持震动提醒。",
                        checked: supportVibrationEnabled,
                        disabled:
                          !canUseFaollaNativeNotifications() &&
                          (typeof navigator === "undefined" || typeof navigator.vibrate !== "function"),
                        onToggle: () => setSupportVibrationEnabled((current) => !current),
                      },
                    ].map((item) => (
                      <div key={item.key} className="flex items-center gap-3 px-5 py-4">
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-semibold text-slate-900">{item.label}</div>
                          <div className="mt-1 text-xs leading-5 text-slate-500">{item.description}</div>
                        </div>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={item.checked}
                          className={`support-mobile-switch-track relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition ${
                            item.checked ? "bg-slate-900" : "bg-slate-200"
                          } ${item.disabled ? "opacity-45" : ""}`}
                          onClick={item.onToggle}
                          disabled={item.disabled}
                        >
                          <span
                            className={`support-mobile-switch-thumb inline-block h-5 w-5 rounded-full bg-white shadow-sm transition ${
                              item.checked ? "translate-x-6" : "translate-x-1"
                            }`}
                          />
                        </button>
                      </div>
                    ))}
                  </div>
                  {supportPushError ? (
                    <div className="border-t border-rose-100 bg-rose-50 px-5 py-3 text-xs leading-5 text-rose-600">
                      {supportPushError}
                    </div>
                  ) : null}
                </section>
              </div>
            }
          />
        ) : (
          null
        )}
      </div>
    </div>
  );

  const supportMobilePrimaryTabContent =
    supportMobileHomeTab === "conversations"
      ? supportMobileConversationsContent
      : supportMobileHomeTab === "business"
        ? supportMobileBusinessContent
        : supportMobileHomeTab === "enterprise"
          ? supportMobileEnterpriseContent
          : supportMobileSelfContent;
  const supportMobileListTabContent = (
    <>
      <div className={supportMobileHomeTab === "faolla" ? "hidden" : "contents"}>{supportMobilePrimaryTabContent}</div>
      <div className={supportMobileHomeTab === "faolla" ? "contents" : "hidden"}>{supportMobileFaollaContent}</div>
    </>
  );
  const isSupportMobileKeyboardVisible = mobileVisualViewportMetrics.bottom > 0;
  const supportMobileViewportFrameStyle: CSSProperties | undefined =
    isIosSupportBrowser && isMobileSupportDialog && mobileVisualViewportMetrics.height > 0
      ? {
          top: `${mobileVisualViewportMetrics.top}px`,
          height: `${mobileVisualViewportMetrics.height}px`,
          bottom: "auto",
        }
      : undefined;

  const supportMobileBottomNav = (
    <div
      className={`support-mobile-nav-shell pointer-events-none fixed bottom-0 left-1/2 z-[2147483298] w-full max-w-md -translate-x-1/2 overscroll-none touch-none transition duration-200 ${
        isSupportMobileKeyboardVisible ? "translate-y-full opacity-0" : "opacity-100"
      }`}
      aria-hidden={isSupportMobileKeyboardVisible}
      onTouchMove={(event) => {
        event.stopPropagation();
      }}
    >
      <div
        className="pointer-events-auto relative px-3 pt-1.5 touch-manipulation"
        style={{ paddingBottom: "calc(var(--faolla-mobile-safe-bottom) + 0.1rem)" }}
      >
        <div className="flex items-center gap-0 rounded-[22px] border border-slate-200/80 bg-white/95 px-1 py-1 shadow-[0_8px_22px_rgba(15,23,42,0.08)] backdrop-blur">
          {([
            {
              key: "conversations",
              label: "会话",
              icon: (
                <path
                  d="M5 7.5A2.5 2.5 0 0 1 7.5 5h9A2.5 2.5 0 0 1 19 7.5v6A2.5 2.5 0 0 1 16.5 14H10l-3.8 3.2A.75.75 0 0 1 5 16.6V14.2A2.5 2.5 0 0 1 3 11.8v-4.3A2.5 2.5 0 0 1 5.5 5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ),
            },
            {
              key: "business",
              label: "生意",
              icon: (
                <path
                  d="M4 10.5 12 5l8 5.5V18a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18v-7.5ZM9 19.5v-5h6v5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ),
            },
            ...(canUseEnterpriseManagement
              ? [
                  {
                    key: "enterprise" as const,
                    label: "企业",
                    icon: (
                      <>
                        <path
                          d="M5 20V7.5A1.5 1.5 0 0 1 6.5 6h7A1.5 1.5 0 0 1 15 7.5V20M15 11h2.5a1.5 1.5 0 0 1 1.5 1.5V20M3 20h18M8 10h1m3 0h1m-5 3h1m3 0h1m-5 3h1m3 0h1"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </>
                    ),
                  },
                ]
              : []),
            {
              key: "faolla",
              label: "Faolla",
              icon: (
                <path
                  d="M12 4 5.8 6.4v5.8c0 3.7 2.7 6.7 6.2 7.4 3.5-.7 6.2-3.7 6.2-7.4V6.4L12 4Zm0 4.1v4.4m0 0 2.3 2.2M12 12.5 9.7 14.7"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ),
            },
            {
              key: "self",
              label: "我的",
              icon: (
                <>
                  <circle cx="12" cy="8.5" r="3.2" fill="none" stroke="currentColor" strokeWidth="1.8" />
                  <path
                    d="M6.2 18.2a5.8 5.8 0 0 1 11.6 0"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                  />
                </>
              ),
            },
          ] as const).map((item) => {
            const active = supportMobileHomeTab === item.key;
            return (
              <button
                key={item.key}
                type="button"
                className={`relative flex min-w-0 flex-1 flex-col items-center justify-center gap-0 rounded-[18px] px-1 py-1 text-[10px] font-medium transition ${
                  active
                    ? "faolla-mobile-nav-tab-active bg-slate-200 text-slate-950 ring-1 ring-slate-950/10 shadow-sm"
                    : "text-slate-500 hover:bg-slate-50 hover:text-slate-900"
                }`}
                onClick={() => openSupportMobileHomeTab(item.key)}
              >
                {item.key === "conversations" && supportUnreadBadgeCount > 0 ? (
                  <span className="absolute right-2 top-1 inline-flex min-w-[18px] items-center justify-center rounded-full bg-rose-500 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white shadow-[0_8px_18px_rgba(244,63,94,0.28)]">
                    {supportUnreadBadgeLabel}
                  </span>
                ) : null}
                {item.key === "business" && merchantHasBusinessAttention ? (
                  <span className="absolute right-2 top-1 inline-flex min-w-[18px] items-center justify-center rounded-full bg-emerald-500 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white shadow-[0_8px_18px_rgba(16,185,129,0.28)]">
                    {merchantBusinessBadgeLabel}
                  </span>
                ) : null}
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
                  {item.icon}
                </svg>
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
  const supportMobileBottomNavOverlay =
    isMobileSupportDialog &&
    !showMobileSupportThread &&
    supportMobileHomeTab !== "enterprise" &&
    !isSupportMobileKeyboardVisible
      ? renderTopMostOverlay(supportMobileBottomNav)
      : null;
  const selectedSupportPeerMessagePage = selectedSupportPeerMerchantId
    ? supportPeerMessagePageByMerchantId[selectedSupportPeerMerchantId] ?? null
    : null;
  const canLoadOlderSupportPeerMessages =
    supportSelectedContactKey !== SUPPORT_OFFICIAL_CONTACT_KEY &&
    Boolean(selectedSupportPeerContact?.merchantId && selectedSupportPeerMessagePage?.hasMore);

  const supportEmojiPickerGrid = (
    <div className="grid grid-cols-8 gap-1.5">
      {SUPPORT_SYSTEM_EMOJIS.map((emoji) => (
        <button
          key={emoji}
          type="button"
          className="flex h-8 w-8 items-center justify-center rounded-xl text-[19px] leading-none transition hover:bg-slate-100 active:scale-95 disabled:opacity-45"
          onClick={() => appendSupportEmoji(emoji)}
          disabled={supportComposerBusy}
          aria-label={`输入表情 ${emoji}`}
        >
          {emoji}
        </button>
      ))}
    </div>
  );

  const supportReplyDraftBanner = supportReplyDraft ? (
    <div className="mb-2 flex items-start gap-2 rounded-2xl bg-white px-3 py-2 text-left shadow-sm ring-1 ring-slate-200/80">
      <div className="min-w-0 flex-1 border-l-2 border-slate-300 pl-2">
        <div className="text-[11px] font-semibold text-slate-500">回复 {supportReplyDraft.senderLabel}</div>
        <div className="mt-0.5 line-clamp-2 text-xs leading-5 text-slate-700">{supportReplyDraft.text}</div>
      </div>
      <button
        type="button"
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 hover:text-slate-900"
        onClick={() => setSupportReplyDraft(null)}
        aria-label="取消回复"
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" aria-hidden="true">
          <path d="m7 7 10 10M17 7 7 17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  ) : null;

  const supportPendingImageDraftsBanner = supportPendingImageDrafts.length ? (
    <div className="mb-2 flex max-w-full gap-2 overflow-x-auto rounded-2xl bg-white px-3 py-2 shadow-sm ring-1 ring-slate-200/80">
      {supportPendingImageDrafts.map((draft) => {
        const pendingImageUrl = normalizePublicAssetUrl(draft.previewUrl);
        return (
          <div
            key={draft.id}
            className="relative h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-slate-100 ring-1 ring-slate-200"
            title={draft.fileName}
          >
            {pendingImageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={pendingImageUrl} alt={draft.fileName || "待发送图片"} className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-xs text-slate-500">图片</div>
            )}
            <button
              type="button"
              className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-slate-950/75 text-white shadow-sm transition hover:bg-slate-950"
              onClick={() => setSupportPendingImageDrafts((current) => current.filter((item) => item.id !== draft.id))}
              aria-label="移除待发送图片"
            >
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" aria-hidden="true">
                <path d="m7 7 10 10M17 7 7 17" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        );
      })}
    </div>
  ) : null;

  const supportSelectionActionBar = supportSelectionActive ? (
    <div className="mb-2 flex items-center gap-2 rounded-2xl bg-white px-3 py-2 text-sm text-slate-700 shadow-sm ring-1 ring-slate-200/80">
      <button
        type="button"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-slate-700 hover:bg-slate-100"
        onClick={clearSupportMessageSelection}
        aria-label="退出选择"
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
          <path d="m7 7 10 10M17 7 7 17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>
      <span className="min-w-0 flex-1 font-medium">已选{selectedSupportMessages.length}项</span>
      {[
        {
          key: "forward",
          label: "转发",
          icon: (
            <path d="m14 7 5 5-5 5M19 12H9a5 5 0 0 0-5 5" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
          ),
        },
        {
          key: "star",
          label: "标星",
          icon: (
            <path d="m12 4 2.1 4.4 4.8.7-3.5 3.4.8 4.8L12 15l-4.2 2.3.8-4.8-3.5-3.4 4.8-.7L12 4Z" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
          ),
        },
        {
          key: "delete",
          label: "删除",
          icon: (
            <path d="M9 5h6m-7 4v10m8-10v10M6.5 7.5h11L16.8 20H7.2L6.5 7.5ZM10 5l.7-1h2.6l.7 1" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
          ),
        },
      ].map((action) => (
        <button
          key={action.key}
          type="button"
          className={`flex h-8 w-8 items-center justify-center rounded-full transition ${
            action.key === "delete" ? "text-rose-600 hover:bg-rose-50" : "text-slate-700 hover:bg-slate-100"
          }`}
          onClick={() => runSupportSelectedMessagesAction(action.key as "forward" | "star" | "delete")}
          aria-label={action.label}
          title={action.label}
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
            {action.icon}
          </svg>
        </button>
      ))}
    </div>
  ) : null;

  const supportPinnedMessageBanner = supportPinnedMessage ? (
    <div className="sticky top-0 z-20 mb-3 flex max-w-full items-center gap-1 rounded-full border border-slate-200/80 bg-white/95 px-2 py-1 text-xs text-slate-600 shadow-sm backdrop-blur">
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-2 rounded-full px-1.5 py-1 text-left transition hover:bg-slate-50"
        onClick={() => {
          const target = supportMessageElementByKeyRef.current[supportPinnedMessage.key];
          target?.scrollIntoView({ behavior: "smooth", block: "center" });
        }}
        title={supportPinnedMessage.text}
      >
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0 text-slate-500" fill="none" aria-hidden="true">
          <path d="m9 4 6 6m-7.5 2.5 6-6L18 11l-6 6-4.5.5.5-5Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="min-w-0 truncate">置顶：{supportPinnedMessage.text}</span>
      </button>
      <button
        type="button"
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
        onClick={() => setSupportPinnedMessage(null)}
        aria-label="取消置顶"
      >
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" aria-hidden="true">
          <path d="m7 7 10 10M17 7 7 17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  ) : null;

  const supportMessageContextMenuOverlay = supportMessageContextMenu
    ? renderTopMostOverlay(
        <>
          <button
            type="button"
            className="fixed inset-0 z-[2147483520] cursor-default bg-transparent"
            onClick={() => setSupportMessageContextMenu(null)}
            aria-label="关闭消息菜单"
          />
          <div
            className="fixed z-[2147483521] w-[168px] overflow-hidden rounded-[18px] border border-slate-200/80 bg-white py-1.5 text-sm text-slate-800 shadow-[0_18px_45px_rgba(15,23,42,0.18)]"
            style={{
              left: supportMessageContextMenu.x,
              top: supportMessageContextMenu.y,
            }}
            role="menu"
          >
            {[
              {
                key: "reply",
                label: "回复",
                icon: (
                  <path d="M10 8 6 12l4 4M7 12h8.5A4.5 4.5 0 0 1 20 16.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                ),
              },
              {
                key: "copy",
                label: "复制",
                icon: (
                  <path d="M8 8.5A2.5 2.5 0 0 1 10.5 6H17a2 2 0 0 1 2 2v8.5A2.5 2.5 0 0 1 16.5 19H10a2 2 0 0 1-2-2V8.5ZM5 15V6.5A2.5 2.5 0 0 1 7.5 4H15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                ),
              },
              {
                key: "forward",
                label: "转发",
                icon: (
                  <path d="m14 7 5 5-5 5M19 12H9a5 5 0 0 0-5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                ),
              },
              {
                key: "pin",
                label: supportPinnedMessage?.key === supportMessageContextMenu.key ? "取消置顶" : "置顶",
                icon: (
                  <path d="m9 4 6 6m-7.5 2.5 6-6L18 11l-6 6-4.5.5.5-5Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                ),
              },
              {
                key: "star",
                label: supportStarredMessageKeys.includes(supportMessageContextMenu.key) ? "取消星标" : "添加星标",
                icon: (
                  <path d="m12 4 2.1 4.4 4.8.7-3.5 3.4.8 4.8L12 15l-4.2 2.3.8-4.8-3.5-3.4 4.8-.7L12 4Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                ),
              },
              {
                key: "select",
                label: supportSelectedMessageKeys.includes(supportMessageContextMenu.key) ? "取消选择" : "选择",
                icon: (
                  <path d="M7 12.5 10.2 16 17 8M6.5 4.5h11A1.5 1.5 0 0 1 19 6v11a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 17V6a1.5 1.5 0 0 1 1.5-1.5Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                ),
              },
              {
                key: "delete",
                label: "删除",
                danger: true,
                icon: (
                  <path d="M9 5h6m-7 4v10m8-10v10M6.5 7.5h11L16.8 20H7.2L6.5 7.5ZM10 5l.7-1h2.6l.7 1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                ),
              },
            ].map((item, index) => (
              <button
                key={item.key}
                type="button"
                className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition ${
                  item.danger ? "text-rose-600 hover:bg-rose-50" : "hover:bg-slate-100"
                } ${index === 5 || index === 6 ? "border-t border-slate-100" : ""}`}
                onClick={() => runSupportMessageContextAction(item.key as "reply" | "copy" | "forward" | "pin" | "star" | "select" | "delete")}
                role="menuitem"
              >
                <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] shrink-0" fill="none" aria-hidden="true">
                  {item.icon}
                </svg>
                <span>{item.label}</span>
              </button>
            ))}
          </div>
        </>,
      )
    : null;

  const supportMobileDialogContent = showMobileSupportThread ? (
    <div
      className={`${supportMobileShellClassName} relative flex h-full min-h-0 flex-1 flex-col overflow-hidden ${supportMobileBackgroundClassName}`}
      onTouchStart={handleSupportMobileThreadTouchStart}
      onTouchEnd={handleSupportMobileThreadTouchEnd}
      onTouchCancel={() => {
        supportMobileSwipeStartRef.current = null;
      }}
    >
      <div className="shrink-0 border-b border-slate-200/80 bg-white/90 px-3 pb-3 pt-[calc(var(--faolla-mobile-safe-top)+0.55rem)] shadow-[0_8px_30px_rgba(15,23,42,0.06)] backdrop-blur">
        <div className="flex items-start justify-between gap-3">
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
            {selectedSupportIsOfficial ? (
              <SupportAvatarBadge
                label={selectedSupportAvatarLabel}
                imageAlt={selectedSupportDisplayName}
                className="faolla-mobile-thread-avatar flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-slate-900 text-sm font-semibold text-white shadow-sm"
                labelClassName="text-sm font-semibold text-white"
              />
            ) : (
              <button
                type="button"
                className="faolla-mobile-thread-avatar-button flex h-11 w-11 shrink-0 items-center justify-center overflow-visible rounded-full bg-slate-900 text-sm font-semibold text-white shadow-sm transition hover:scale-[1.02]"
                onClick={() => setSupportMerchantInfoSheetOpen(true)}
                aria-label="查看商户资料"
              >
                <SupportAvatarBadge
                  label={selectedSupportAvatarLabel}
                  imageUrl={selectedSupportAvatarImageUrl}
                  imageAlt={selectedSupportDisplayName}
                  className="faolla-mobile-thread-avatar flex h-full w-full items-center justify-center rounded-full bg-slate-900 text-white"
                  labelClassName="text-sm font-semibold text-white"
                  showMerchantBadge={selectedSupportPeerIsMerchant}
                />
              </button>
            )}
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <div className="truncate text-[15px] font-semibold text-slate-900">{selectedSupportDisplayName}</div>
                {selectedSupportIsOfficial ? (
                  <span className="inline-flex shrink-0 items-center rounded-full bg-slate-900 px-2 py-0.5 text-[10px] font-medium leading-none text-white">
                    {supportOfficialBadgeLabel}
                  </span>
                ) : null}
              </div>
              <div className="mt-1 line-clamp-2 text-[11px] leading-5 text-slate-500">{selectedSupportHeaderMeta}</div>
            </div>
          </div>
          {!isMobileMerchantSupportOnlyMode ? (
            <button
              type="button"
              className="shrink-0 rounded-full border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50"
              onClick={() => setSupportDialogOpen(false)}
              disabled={supportSending}
            >
              关闭
            </button>
          ) : null}
        </div>
      </div>
      {supportError && supportSelectedContactKey === SUPPORT_OFFICIAL_CONTACT_KEY ? (
        <div className="border-b border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-600">{supportError}</div>
      ) : null}
      <div
        ref={supportMessagesViewportRef}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-4 pt-4"
        style={{
          backgroundColor: "#eff6f3",
          backgroundImage:
            "linear-gradient(135deg, rgba(222,249,238,0.96) 0%, rgba(239,247,255,0.9) 46%, rgba(222,231,244,0.92) 100%)",
        }}
      >
        {supportPinnedMessageBanner}
        {canLoadOlderSupportPeerMessages ? (
          <div className="mb-3 flex justify-center">
            <button
              type="button"
              className="rounded-full bg-white/90 px-3 py-1.5 text-xs font-semibold text-slate-600 shadow-sm transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
              disabled={supportPeerHistoryLoading}
              onClick={() => selectedSupportPeerContact?.merchantId && void loadSupportPeerThreadMessages(selectedSupportPeerContact.merchantId, "prepend")}
            >
              {supportPeerHistoryLoading ? "加载中..." : "加载更早消息"}
            </button>
          </div>
        ) : null}
        {selectedSupportLoading ? (
          <div className="rounded-[28px] border border-dashed border-slate-300 bg-white/90 px-5 py-8 text-center text-sm text-slate-500 shadow-sm">
            正在加载聊天记录...
          </div>
        ) : visibleSupportMessages.length ? (
          <div className="space-y-2" data-support-message-list="true">
            {visibleSupportMessages.map((message, index) => {
              const previousMessage = index > 0 ? visibleSupportMessages[index - 1] : null;
              const showDateDivider =
                !previousMessage || !isSameSupportCalendarDay(previousMessage.createdAt, message.createdAt);
              const messageKey = buildVisibleSupportMessageKey(message);
              const messageMeta =
                message.localStatus === "pending"
                  ? "发送中"
                  : message.localStatus === "failed"
                    ? "发送失败"
                    : formatSupportClockTime(message.createdAt);
              const replyContent = parseSupportReplyMessageText(message.text);
              const displayMessageText = replyContent?.body ?? message.text;
              const hasAttachmentPreview = Boolean(parseSupportMessageAttachmentPreview(displayMessageText));
              const messageHidden = supportHiddenMessageKeys.includes(messageKey);
              const messageSelected = supportSelectedMessageKeys.includes(messageKey);
              const messageStarred = supportStarredMessageKeys.includes(messageKey);
              if (messageHidden) return null;
              return (
                <div
                  key={messageKey}
                  ref={(node) => {
                    supportMessageElementByKeyRef.current[messageKey] = node;
                  }}
                  className="space-y-2"
                >
                  {showDateDivider ? (
                    <div className="flex justify-center">
                      <span className="rounded-full bg-white/90 px-3 py-1 text-[11px] text-slate-500 shadow-sm">
                        {formatSupportThreadDateLabel(message.createdAt)}
                      </span>
                    </div>
                  ) : null}
                  <div className={`flex min-w-0 ${message.isSelf ? "justify-end" : "justify-start"}`}>
                    <div className={`flex max-w-[84%] min-w-0 items-end gap-2 ${message.isSelf ? "ml-auto justify-end" : "mr-auto justify-start"}`}>
                      {supportSelectionActive ? (
                        <button
                          type="button"
                          className={`mb-1 flex h-5 w-5 shrink-0 items-center justify-center rounded border text-white transition ${
                            messageSelected ? "border-emerald-500 bg-emerald-500" : "border-slate-300 bg-white"
                          }`}
                          onClick={(event) => {
                            event.stopPropagation();
                            toggleSupportMessageSelection(messageKey);
                          }}
                          aria-label={messageSelected ? "取消选择消息" : "选择消息"}
                        >
                          {messageSelected ? (
                            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" aria-hidden="true">
                              <path d="M6 12.5 10 16l8-9" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          ) : null}
                        </button>
                      ) : null}
                      <div
                        className={`faolla-message-bubble max-w-full min-w-0 rounded-[18px] shadow-sm ${
                          hasAttachmentPreview
                            ? `border border-transparent bg-transparent px-0 py-0 ${message.isSelf ? "ml-auto" : "mr-auto"}`
                            : message.isSelf
                              ? "bg-[#d9fdd3] px-3 py-1.5 text-slate-950"
                              : "border border-transparent bg-white px-3 py-1.5 text-slate-950"
                        } ${messageSelected ? "ring-2 ring-blue-400/70" : ""}`}
                        onContextMenu={(event) => openSupportMessageContextMenu(event, message)}
                        onClick={() => {
                          if (!supportSelectionActive) return;
                          toggleSupportMessageSelection(messageKey);
                        }}
                      >
                        {replyContent ? (
                          <div className="mb-1.5 max-w-full rounded-xl bg-slate-100/95 px-2.5 py-1.5 text-left text-xs leading-5 text-slate-500">
                            <div className="font-semibold text-slate-600">{replyContent.senderLabel}</div>
                            <div className="line-clamp-2">{replyContent.text}</div>
                          </div>
                        ) : null}
                        <SupportMessageContent
                          value={displayMessageText}
                          isSelf={message.isSelf}
                          onImageActivate={handleSupportMessageImageActivate}
                        />
                        <span className={`faolla-message-time text-[11px] leading-none ${hasAttachmentPreview ? "mt-1 block text-right" : "ml-2 inline-block align-baseline"} ${message.isSelf ? "text-slate-500" : "text-slate-400"}`}>
                          {messageMeta}
                          {messageStarred ? <span className="ml-1 text-[16px] leading-none text-amber-400">★</span> : null}
                        </span>
                      </div>
                      {message.isSelf && message.localStatus === "failed" ? (
                        <div className="relative mb-1 ml-2 shrink-0">
                          <button
                            type="button"
                            aria-label="发送失败，打开操作"
                            className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-rose-500 bg-white text-[12px] font-semibold leading-none text-rose-600 shadow-sm"
                            onClick={(event) => {
                              event.stopPropagation();
                              setSupportFailedMessageActionKey((current) => (current === messageKey ? "" : messageKey));
                            }}
                          >
                            !
                          </button>
                          {supportFailedMessageActionKey === messageKey ? (
                            <div className="absolute bottom-7 right-0 z-30 w-28 overflow-hidden rounded-2xl border border-slate-200 bg-white text-sm text-slate-900 shadow-xl">
                              <button
                                type="button"
                                className="block w-full px-3 py-2 text-left hover:bg-slate-50"
                                onClick={() => void retryFailedSupportMessage(message)}
                              >
                                重新发送
                              </button>
                              <button
                                type="button"
                                className="block w-full border-t border-slate-100 px-3 py-2 text-left text-rose-600 hover:bg-rose-50"
                                onClick={() => removeFailedSupportMessage(message)}
                              >
                                删除
                              </button>
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="rounded-[28px] border border-dashed border-slate-300 bg-white/90 px-5 py-6 text-center shadow-sm">
            <div className="text-sm font-medium text-slate-900">还没有聊天记录</div>
            <div className="mt-1.5 text-xs leading-6 text-slate-500">{selectedSupportEmptyStateText}</div>
          </div>
        )}
      </div>
      <div
        ref={supportComposerRef}
        className="faolla-mobile-composer shrink-0 overscroll-none border-t border-slate-200/80 bg-[#f0f2f5]/98 px-2 pb-[var(--faolla-mobile-safe-bottom)] pt-1 shadow-none backdrop-blur"
        style={
          isIosSupportBrowser && isSupportMobileKeyboardVisible
            ? {
                paddingBottom: "0",
                paddingTop: "0.15rem",
              }
            : undefined
        }
        onTouchMove={(event) => {
          event.stopPropagation();
        }}
      >
        {supportSelectionActionBar}
        {supportPendingImageDraftsBanner}
        {supportReplyDraftBanner}
        {supportAttachmentMenuOpen ? (
          <div className="faolla-mobile-attachment-menu mb-2 rounded-[20px] bg-white px-2.5 py-2.5 shadow-none ring-1 ring-slate-200/80">
            <div className="grid grid-cols-5 gap-2">
              <button
                type="button"
                className="faolla-mobile-attachment-button flex flex-col items-center gap-1.5 rounded-2xl px-1 py-1.5 text-[10px] font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
                onClick={() => {
                  void openSupportPhotoPicker();
                }}
                disabled={supportComposerBusy}
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-50 text-blue-500">
                  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
                    <path d="M6 8h2.3l1.2-1.7A1 1 0 0 1 10.3 6h3.4a1 1 0 0 1 .8.3L15.7 8H18a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2Z" stroke="currentColor" strokeWidth="1.8" />
                    <circle cx="12" cy="13" r="3.1" stroke="currentColor" strokeWidth="1.8" />
                  </svg>
                </span>
                <span>照片</span>
              </button>
              <button
                type="button"
                className="faolla-mobile-attachment-button flex flex-col items-center gap-1.5 rounded-2xl px-1 py-1.5 text-[10px] font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
                onClick={() => {
                  void openSupportCameraPicker();
                }}
                disabled={supportComposerBusy}
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-700">
                  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
                    <path d="M4 9a2 2 0 0 1 2-2h1.8l1.2-1.8A1 1 0 0 1 9.8 5h4.4a1 1 0 0 1 .8.2L16.2 7H18a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V9Z" stroke="currentColor" strokeWidth="1.8" />
                    <circle cx="12" cy="12.5" r="3.1" stroke="currentColor" strokeWidth="1.8" />
                  </svg>
                </span>
                <span>拍照</span>
              </button>
              <button
                type="button"
                className="faolla-mobile-attachment-button flex flex-col items-center gap-1.5 rounded-2xl px-1 py-1.5 text-[10px] font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
                onClick={() => {
                  void handleSupportLocationAttachment();
                }}
                disabled={supportComposerBusy}
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-50 text-emerald-500">
                  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
                    <path d="M12 20s6-5.5 6-10a6 6 0 1 0-12 0c0 4.5 6 10 6 10Z" stroke="currentColor" strokeWidth="1.8" />
                    <circle cx="12" cy="10" r="2.2" fill="currentColor" />
                  </svg>
                </span>
                <span>位置</span>
              </button>
              <button
                type="button"
                className="faolla-mobile-attachment-button flex flex-col items-center gap-1.5 rounded-2xl px-1 py-1.5 text-[10px] font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
                onClick={openSupportSelfCardPicker}
                disabled={supportComposerBusy}
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-violet-50 text-violet-500">
                  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
                    <path d="M5 7.5A2.5 2.5 0 0 1 7.5 5h9A2.5 2.5 0 0 1 19 7.5v9a2.5 2.5 0 0 1-2.5 2.5h-9A2.5 2.5 0 0 1 5 16.5v-9Z" stroke="currentColor" strokeWidth="1.8" />
                    <circle cx="12" cy="10" r="2.2" stroke="currentColor" strokeWidth="1.8" />
                    <path d="M8.5 16a3.5 3.5 0 0 1 7 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                  </svg>
                </span>
                <span>名片</span>
              </button>
              <button
                type="button"
                className="faolla-mobile-attachment-button flex flex-col items-center gap-1.5 rounded-2xl px-1 py-1.5 text-[10px] font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
                onClick={() => {
                  void openSupportFilePicker();
                }}
                disabled={supportComposerBusy}
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-50 text-amber-500">
                  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
                    <path d="M8 4.5h5.2L18 9.3V18a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V6.5a2 2 0 0 1 2-2Z" stroke="currentColor" strokeWidth="1.8" />
                    <path d="M13 4.8V9h4.2" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
                  </svg>
                </span>
                <span>文件</span>
              </button>
            </div>
          </div>
        ) : null}
        {supportEmojiMenuOpen ? (
          <div className="mb-2 rounded-[20px] bg-white px-3 py-3 shadow-none ring-1 ring-slate-200/80">
            {supportEmojiPickerGrid}
          </div>
        ) : null}
        <div className="flex items-end gap-1.5">
          <button
            type="button"
            className={`faolla-mobile-composer-icon flex h-[38px] min-h-[38px] w-[38px] min-w-[38px] shrink-0 items-center justify-center rounded-full p-0 text-slate-700 shadow-none ring-1 ring-slate-200/80 transition ${
              supportAttachmentMenuOpen ? "bg-slate-900 text-white" : "bg-white hover:bg-slate-50"
            }`}
            onClick={toggleSupportAttachmentMenu}
            disabled={!supportComposerAvailable || supportComposerBusy}
            aria-label="打开附件菜单"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
              <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
            </svg>
          </button>
          <button
            type="button"
            className={`faolla-mobile-composer-icon flex h-[38px] min-h-[38px] w-[38px] min-w-[38px] shrink-0 items-center justify-center rounded-full p-0 text-slate-700 shadow-none ring-1 ring-slate-200/80 transition ${
              supportEmojiMenuOpen ? "bg-slate-900 text-white" : "bg-white hover:bg-slate-50"
            }`}
            onClick={() => {
              if (!supportComposerAvailable || supportComposerBusy) return;
              setSupportAttachmentMenuOpen(false);
              setSupportSelfCardPickerOpen(false);
              setSupportMessageContextMenu(null);
              setSupportEmojiMenuOpen((current) => !current);
            }}
            disabled={!supportComposerAvailable || supportComposerBusy}
            aria-label="选择表情"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
              <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.8" />
              <path d="M8.8 10h.01M15.2 10h.01" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
              <path d="M8.8 14.2c.82 1.12 1.87 1.68 3.2 1.68s2.38-.56 3.2-1.68" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
          <div
            className="faolla-mobile-input-shell flex min-h-[38px] min-w-0 flex-1 items-end overflow-hidden rounded-[22px] bg-white px-3 py-2 shadow-none ring-1 ring-slate-200/80"
            style={isIosSupportBrowser && isSupportMobileKeyboardVisible ? { paddingTop: "0.3rem", paddingBottom: "0.3rem" } : undefined}
          >
            <textarea
              ref={supportInputRef}
              rows={1}
              data-support-auto-resize="mobile"
              className="min-h-[24px] w-full resize-none overflow-y-hidden bg-transparent px-1 py-0 text-base leading-6 outline-none transition placeholder:text-slate-400"
              placeholder={selectedSupportInputPlaceholder}
              value={supportDraft}
              onChange={(event) => {
                setSupportDraft(event.target.value);
                resizeSupportComposerInput(event.target);
                keepSupportComposerCaretVisible(event.target);
              }}
              onTouchStart={(event) => {
                if (!isIosSupportBrowser) return;
                if (typeof document !== "undefined" && document.activeElement === event.currentTarget) return;
                event.preventDefault();
                focusSupportInputImmediately();
              }}
              onMouseDown={(event) => {
                if (!isIosSupportBrowser) return;
                if (typeof document !== "undefined" && document.activeElement === event.currentTarget) return;
                event.preventDefault();
                focusSupportInputImmediately();
              }}
              onFocus={() => {
                setSupportAttachmentMenuOpen(false);
                setSupportEmojiMenuOpen(false);
                setSupportSelfCardPickerOpen(false);
                setSupportMessageContextMenu(null);
                if (!isIosSupportBrowser) {
                  window.setTimeout(() => {
                    supportMessagesViewportRef.current?.scrollTo({
                      top: supportMessagesViewportRef.current.scrollHeight,
                      behavior: "auto",
                    });
                  }, 80);
                }
              }}
              onKeyDown={handleSupportComposerKeyDown}
              onPaste={handleSupportComposerPaste}
              disabled={!supportComposerAvailable}
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="send"
              style={{ touchAction: isIosSupportBrowser ? "none" : "manipulation" }}
            />
          </div>
          <button
            type="button"
            className={`faolla-mobile-composer-send flex h-[38px] min-h-[38px] w-[38px] min-w-[38px] shrink-0 items-center justify-center rounded-full p-0 text-white shadow-none transition ${
              supportComposerBusy || supportCanSend
                ? "bg-emerald-500 hover:bg-emerald-600"
                : "bg-slate-300 shadow-none"
            }`}
            onPointerDown={(event) => {
              if (supportSendPointerHandledRef.current || supportComposerBusy || !supportCanSend) return;
              if (event.pointerType !== "touch" && event.pointerType !== "pen") return;
              event.preventDefault();
              supportSendPointerHandledRef.current = true;
              focusSupportInputImmediately();
              void sendSupportMessage();
              window.setTimeout(() => {
                supportSendPointerHandledRef.current = false;
              }, 600);
            }}
            onClick={() => {
              if (supportSendPointerHandledRef.current) {
                supportSendPointerHandledRef.current = false;
                return;
              }
              void sendSupportMessage();
            }}
            disabled={supportComposerBusy || !supportCanSend}
            aria-label={supportComposerBusy ? "发送中" : selectedSupportSendButtonLabel}
          >
            {supportComposerBusy ? (
              <span className="h-4 w-4 rounded-full border-2 border-white/35 border-t-white animate-spin" />
            ) : (
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
                <path
                  d="M5 12.5 18.2 5.8c.7-.36 1.5.28 1.29 1.04l-2.84 10.2c-.18.66-.97.92-1.5.5l-3.7-2.94a1 1 0 0 1-.27-1.17l1.63-3.62-4.46 3.54a1 1 0 0 1-.84.2L5.64 13.2A.77.77 0 0 1 5 12.5Z"
                  fill="currentColor"
                />
              </svg>
            )}
          </button>
        </div>
      </div>
    </div>
  ) : (
    <div className={`${supportMobileShellClassName} relative flex h-full min-h-0 flex-1 flex-col overflow-hidden ${supportMobileBackgroundClassName}`}>
      {supportMobileListTabContent}
    </div>
  );

  const supportSelfCardPickerOverlay =
    supportSelfCardPickerOpen && supportInterfaceOpen
      ? renderTopMostOverlay(
          <>
            <button
              type="button"
              className="fixed inset-0 z-[2147483398] bg-slate-950/40 backdrop-blur-[1px]"
              onClick={() => setSupportSelfCardPickerOpen(false)}
              aria-label="关闭名片夹"
            />
            <div
              className={
                showMobileSupportThread
                  ? "fixed inset-x-0 bottom-0 z-[2147483399] px-3 pb-[calc(var(--faolla-mobile-safe-bottom)+0.5rem)]"
                  : "fixed inset-0 z-[2147483399] flex items-center justify-center p-4"
              }
            >
              <div
                className="support-mobile-sheet mx-auto w-full max-w-md overflow-hidden rounded-[30px] bg-white shadow-[0_24px_80px_rgba(15,23,42,0.2)]"
              >
                <div className="px-4 pb-3 pt-3">
                  {showMobileSupportThread ? <div className="mx-auto h-1.5 w-12 rounded-full bg-slate-200" /> : null}
                  <div className="mt-4 flex items-center justify-between gap-3">
                    <div>
                      <div className="text-base font-semibold text-slate-900">我的名片夹</div>
                      <div className="mt-1 text-xs text-slate-500">选择一张直接发送到当前聊天。</div>
                    </div>
                    <button
                      type="button"
                      className="rounded-full border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
                      onClick={() => setSupportSelfCardPickerOpen(false)}
                    >
                      关闭
                    </button>
                  </div>
                </div>
                <div className="max-h-[58vh] space-y-2 overflow-y-auto px-3 pb-3">
                  {supportSelfCardPickerChoices.length ? (
                    supportSelfCardPickerChoices.map((card) => {
                      const cardPreviewUrl = getSupportPreferredBusinessCardPreviewUrl(card);
                      const cardModeLabel = card.mode === "link" ? "链接模式" : "图片模式";
                      return (
                        <button
                          key={card.id}
                          type="button"
                          className="flex w-full items-center gap-3 rounded-[22px] border border-slate-200 bg-slate-50/80 px-3 py-3 text-left transition hover:border-slate-300 hover:bg-white disabled:opacity-50"
                          onClick={() => {
                            void handleSupportBusinessCardAttachment(card);
                          }}
                          disabled={supportComposerBusy}
                        >
                          <div className="support-preserve-light-surface support-preserve-light-border flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-slate-200 bg-white p-1 text-xs font-semibold text-slate-700 shadow-sm">
                            {cardPreviewUrl ? (
                              /* eslint-disable-next-line @next/next/no-img-element */
                              <img src={cardPreviewUrl} alt={card.name} className="support-preserve-light-surface h-full w-full rounded-[12px] bg-white object-contain" />
                            ) : (
                              getSupportContactAvatarLabel(card.name || merchantDisplayName, "名")
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <div className="truncate text-sm font-semibold text-slate-900">
                                {card.name || "未命名名片"}
                              </div>
                              <span className="shrink-0 rounded-full bg-slate-900 px-2 py-0.5 text-[10px] font-medium text-white">
                                {cardModeLabel}
                              </span>
                            </div>
                          </div>
                        </button>
                      );
                    })
                  ) : (
                    <div className="rounded-[24px] border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
                      当前还没有可发送的名片。
                    </div>
                  )}
                </div>
              </div>
            </div>
          </>,
        )
      : null;

  const supportMerchantInfoSheetOverlay =
    supportMerchantInfoSheetOpen && (showMobileSupportThread || showDesktopMerchantSupportPanel)
      ? renderTopMostOverlay(
          <>
            <button
              type="button"
              className="fixed inset-0 z-[2147483400] bg-slate-950/40 backdrop-blur-[1px]"
              onClick={() => setSupportMerchantInfoSheetOpen(false)}
              aria-label="关闭商户资料"
            />
            {showMobileSupportThread ? (
              <div className="fixed inset-x-0 bottom-0 z-[2147483401] px-3 pb-[calc(var(--faolla-mobile-safe-bottom)+0.75rem)]">
                <div
                  className="support-mobile-sheet mx-auto w-full max-w-md rounded-[30px] bg-white px-4 pb-4 pt-3 shadow-[0_24px_80px_rgba(15,23,42,0.2)]"
                >
                  <div className="mx-auto h-1.5 w-12 rounded-full bg-slate-200" />
                  <div className="mt-4 flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <SupportAvatarBadge
                        label={selectedSupportAvatarLabel}
                        imageUrl={selectedSupportAvatarImageUrl}
                        imageAlt={selectedSupportDisplayName}
                        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-slate-900 text-sm font-semibold text-white"
                        labelClassName="text-sm font-semibold text-white"
                        showMerchantBadge={selectedSupportPeerIsMerchant}
                      />
                      <div className="min-w-0">
                        <div className="truncate text-base font-semibold text-slate-900">{selectedSupportDisplayName}</div>
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
            ) : (
              <div className="fixed inset-0 z-[2147483401] flex items-center justify-center p-4">
                <div className="w-full max-w-xl rounded-[30px] bg-white px-6 py-5 shadow-[0_24px_80px_rgba(15,23,42,0.22)]">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex min-w-0 items-center gap-4">
                      <SupportAvatarBadge
                        label={selectedSupportAvatarLabel}
                        imageUrl={selectedSupportAvatarImageUrl}
                        imageAlt={selectedSupportDisplayName}
                        className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-slate-900 text-base font-semibold text-white shadow-sm"
                        labelClassName="text-base font-semibold text-white"
                        showMerchantBadge={selectedSupportPeerIsMerchant}
                      />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <div className="truncate text-lg font-semibold text-slate-900">{selectedSupportDisplayName}</div>
                          {selectedSupportIsOfficial ? (
                            <span className="inline-flex shrink-0 items-center rounded-full bg-slate-900 px-2 py-0.5 text-[10px] font-medium leading-none text-white">
                              {supportOfficialBadgeLabel}
                            </span>
                          ) : null}
                        </div>
                        <div className="mt-1 text-sm text-slate-500">{selectedSupportHeaderMeta}</div>
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
                  <div className="mt-5 divide-y divide-slate-100 overflow-hidden rounded-[24px] border border-slate-100 bg-slate-50/80">
                    {selectedSupportMerchantInfoItems.map((item) => (
                      <div key={item.label} className="px-5 py-4">
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
            )}
          </>,
        )
      : null;
  if (isMobileMerchantSupportOnlyMode) {
    return (
      <>
        <main
          className={`${supportMobileShellClassName} fixed inset-x-0 top-0 bottom-0 z-[120] overflow-hidden overscroll-none ${supportMobileBackgroundClassName} touch-manipulation [&_input]:!text-base [&_select]:!text-base [&_textarea]:!text-base`}
          style={supportMobileViewportFrameStyle}
        >
          <div className="flex h-full min-h-0 flex-col overflow-hidden">
            {supportMobileDialogContent}
          </div>
        </main>
        {supportMobileBottomNavOverlay}
        {supportSelfCardPickerOverlay}
        {supportMessageContextMenuOverlay}
        {supportMerchantInfoSheetOverlay}
        {supportBusinessCardDialogOpen && supportInterfaceOpen && !isPlatformEditor ? (
          <ChatBusinessCardDialog
            open
            merchantName={selectedSupportDisplayName}
            subtitle={selectedSupportSubtitle}
            card={selectedSupportBusinessCard}
            loading={supportBusinessCardLoading}
            error={supportBusinessCardError}
            onClose={() => {
              setSupportBusinessCardDialogOpen(false);
              setSupportBusinessCardLoading(false);
              setSupportBusinessCardError("");
            }}
          />
        ) : null}
        {supportImagePreview ? (
          <SupportMessageImagePreviewOverlay
            open
            imageUrl={supportImagePreview.imageUrl}
            linkUrl={supportImagePreview.linkUrl}
            title={supportImagePreview.title || "图片预览"}
            onClose={() => setSupportImagePreview(null)}
            onNotice={showTip}
            currentForwardAction={
              selectedSupportPeerContact
                ? {
                    label: `转发给 ${selectedSupportPeerContact.merchantName || selectedSupportPeerContact.merchantId}`,
                    onForward: () =>
                      sendSupportAttachmentToPeerRecipient(
                        selectedSupportPeerContact.merchantId,
                        supportImagePreview.rawText,
                        selectedSupportPeerContact.merchantName || selectedSupportPeerContact.merchantId,
                      ),
                  }
                : null
            }
            queryForwardAction={{
              label: "转发给指定商户",
              placeholder: "例如：10000000 或 owner@example.com",
              onForward: (query) => forwardSupportAttachmentToSpecifiedMerchant(query, supportImagePreview.rawText),
            }}
          />
        ) : null}
        {accountSwitcherOpen ? (
          <AccountSwitcherDialog
            open
            entries={accountSwitchEntries}
            currentKey={merchantAccountSwitchCurrentKey}
            busyKey={accountSwitchBusyKey}
            error={accountSwitchError}
            onClose={() => {
              if (accountSwitchBusyKey) return;
              setAccountSwitcherOpen(false);
              setAccountSwitchError("");
            }}
            onSwitch={(entry) => {
              void handleAccountSwitch(entry);
            }}
            onRemove={(key) => {
              setAccountSwitchEntries(removeAccountSwitchEntry(key));
            }}
            onAddAccount={() => {
              void addAccountFromSwitcher();
            }}
          />
        ) : null}
        {editorUploadBusyOverlay}
        {publishBusyOverlay}
        {dialogOverlay}
      </>
    );
  }

  const editorMainClassName = `min-h-screen ${
    isMobileMerchantEditorShell
      ? "overflow-x-hidden bg-[radial-gradient(circle_at_top,_rgba(103,232,249,0.16),_transparent_28%),linear-gradient(180deg,_#eef6ff_0%,_#f8fbff_34%,_#e8f1ff_100%)]"
      : "bg-[#f3f6fb]"
  } ${!topBarCollapsed && shouldUseDesktopEditorSidebar ? "pl-[228px]" : ""}`;
  const toolbarWrapperClassName = topBarCollapsed
    ? "hidden"
    : shouldUseDesktopEditorSidebar
      ? `fixed inset-y-0 left-0 z-[15000] w-[228px] overflow-y-auto border-r border-white/5 bg-[#111827] ${
          merchantEditorOnly ? "text-slate-900" : "text-white"
        } shadow-[inset_-1px_0_0_rgba(0,0,0,0.12)]`
      : "fixed inset-x-0 top-0 z-[15000] border-b border-white/70 bg-[rgba(248,251,255,0.88)] shadow-[0_22px_48px_rgba(15,23,42,0.10)] backdrop-blur-xl";
  const toolbarContentClassName = shouldUseDesktopEditorSidebar
    ? "mx-0 flex max-w-none flex-col items-stretch justify-start gap-4 px-3 py-[18px]"
    : "mx-auto flex max-w-[460px] flex-col items-stretch gap-4 px-4 pb-4 pt-[calc(var(--faolla-mobile-safe-top)+0.9rem)]";
  const toolbarHeaderClassName = shouldUseDesktopEditorSidebar
    ? "flex flex-col items-stretch gap-3"
    : "flex flex-col gap-4";
  const toolbarActionsClassName = shouldUseDesktopEditorSidebar
    ? "grid grid-cols-2 gap-2"
    : "grid grid-cols-2 gap-3";
  const supportButtonClassName = shouldUseDesktopEditorSidebar
    ? `col-span-2 relative px-3 py-2 rounded text-white ${supportHasUnreadMessages ? "bg-rose-700 hover:bg-rose-800" : "bg-black hover:bg-slate-800"}`
    : `col-span-2 relative min-h-[52px] rounded-[22px] px-4 py-3 text-[15px] font-semibold text-white shadow-[0_16px_36px_rgba(15,23,42,0.18)] ${
        supportHasUnreadMessages ? "bg-rose-700 hover:bg-rose-800" : "bg-slate-950 hover:bg-slate-800"
      }`;
  const publishActionsClassName = shouldUseDesktopEditorSidebar
    ? "grid grid-cols-2 gap-2"
    : "grid grid-cols-2 gap-3";
  const merchantMobileToolbarCardClassName =
    "rounded-[28px] border border-white/70 bg-white/90 p-4 shadow-[0_18px_40px_rgba(15,23,42,0.08)] backdrop-blur";
  const merchantMobileToolbarSectionLabelClassName = "text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400";
  const merchantMobileToolbarButtonClassName =
    "min-h-[50px] w-full rounded-[20px] border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-800 shadow-[0_10px_24px_rgba(15,23,42,0.06)] transition active:scale-[0.99] hover:border-slate-300 hover:bg-white";
  const merchantMobileToolbarIconButtonClassName =
    "flex min-h-[54px] w-full items-center justify-center rounded-[20px] border border-slate-200 bg-white px-4 py-3 text-slate-900 shadow-[0_10px_24px_rgba(15,23,42,0.06)] transition active:scale-[0.99] hover:border-slate-300 hover:bg-white disabled:opacity-50";
  const merchantMobileToolbarSelectClassName =
    "w-full rounded-[20px] border border-slate-200 bg-white px-4 py-3 text-[15px] text-slate-900 shadow-[0_10px_24px_rgba(15,23,42,0.06)] outline-none";
  const merchantMobileToolbarSegmentClassName = "grid grid-cols-2 gap-3 rounded-[24px] border border-slate-200 bg-slate-50/90 p-1.5";
  const merchantMobileToolbarSegmentButtonBaseClassName =
    "min-h-[48px] rounded-[18px] px-3 py-2 text-sm font-semibold transition active:scale-[0.99]";
  const merchantDesktopOperationCenterActive =
    merchantDesktopSection === "profile" ||
    merchantDesktopSection === "editor" ||
    merchantDesktopSection === "business" ||
    merchantDesktopSection === "cards" ||
    merchantDesktopSection === "customers" ||
    merchantDesktopSection === "pollStats" ||
    merchantDesktopSection === "logs" ||
    merchantDesktopSection === "printer";
  const merchantDesktopCouponCenterActive =
    merchantDesktopSection === "coupons" ||
    merchantDesktopSection === "couponRedeemWorkbench" ||
    merchantDesktopSection === "couponClaims" ||
    merchantDesktopSection === "couponRedemptions" ||
    merchantDesktopSection === "couponDailyStats";
  const merchantCouponManagerView =
    merchantDesktopSection === "couponRedeemWorkbench"
      ? "redeemWorkbench"
      : merchantDesktopSection === "couponClaims"
      ? "claims"
      : merchantDesktopSection === "couponRedemptions"
        ? "redemptions"
        : merchantDesktopSection === "couponDailyStats"
          ? "dailyStats"
          : "list";
  const merchantBookingManagerDialogCommonProps =
    !isPlatformEditor && canUseBookingBlock
      ? {
          siteId: editingSiteId || "",
          siteName: effectiveMerchantDisplayName || merchantDisplayName,
          storeOptions: merchantBookingManagerOptions.storeOptions,
          itemOptions: merchantBookingManagerOptions.itemOptions,
          titleOptions: merchantBookingManagerOptions.titleOptions,
          bookingRulesSnapshot: merchantBookingRulesSnapshot,
          siteCountryCode: effectiveEditingSite?.location?.countryCode ?? editingSite?.location?.countryCode ?? "",
          allowBookingEmailPrefill: Boolean(merchantPermissionConfig?.allowBookingEmailPrefill),
          allowCustomerAutoEmail: Boolean(merchantPermissionConfig?.allowBookingAutoEmail),
          onRecordsChange: handleMerchantBookingRecordsChange,
          onOpenConversation: openSupportConversationFromBusinessRecord,
          onClose: () => {
            setMerchantBookingManagerOpen(false);
            if (isDesktopMerchantWorkspace) {
              setMerchantDesktopSection("editor");
            }
          },
        }
      : null;
  const merchantOrderManagerDialogCommonProps =
    canUseOrderManagement
      ? {
          siteId: editingSiteId || merchantSiteIdOverride || "",
          siteName: effectiveMerchantDisplayName || merchantDisplayName,
          onOrdersChange: handleMerchantOrderRecordsChange,
          onOpenConversation: openSupportConversationFromBusinessRecord,
          sourceOrderIntent:
            merchantOrderSourceIntent?.siteId ===
            (editingSiteId || merchantSiteIdOverride || "")
              ? merchantOrderSourceIntent
              : null,
          onSourceOrderIntentHandled: handleMerchantOrderSourceIntentHandled,
          ...(canUseEnterpriseManagement
            ? {
                onOpenEnterpriseTask: (order: MerchantOrderRecord) =>
                  openMerchantOrderEnterpriseTask(order, "desktop"),
              }
            : {}),
          onClose: () => {
            setMerchantOrderManagerOpen(false);
            if (isDesktopMerchantWorkspace) {
              setMerchantDesktopSection("editor");
            }
          },
        }
      : null;
  const merchantVisibleCouponRecords = getVisibleMerchantCoupons(merchantCouponRecords);
  const merchantCouponManagerCommonProps =
    canUseCouponModule
      ? {
          siteId: editingSiteId || "",
          siteName: effectiveMerchantDisplayName || merchantDisplayName,
          publicSiteUrl: supportSelfWebsiteHref,
          couponPageId: merchantCouponPageId,
          onCouponsChange: setMerchantCouponRecords,
        }
      : null;
  const formatMerchantLogTime = (value: string) => {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toLocaleString("zh-CN", { hour12: false }) : value;
  };
  const openMerchantOperationLogDatePicker = (input: HTMLInputElement | null) => {
    if (!input) return;
    const picker = input as HTMLInputElement & { showPicker?: () => void };
    if (typeof picker.showPicker === "function") {
      picker.showPicker();
      return;
    }
    input.focus();
    input.click();
  };
  const merchantOperationLogModuleOptions =
    merchantOperationLogModules.length > 0
      ? merchantOperationLogModules
      : Array.from(new Set(merchantOperationLogs.map((item) => item.module).filter(Boolean))).sort((left, right) =>
          left.localeCompare(right, "zh-CN"),
        );
  const hasMerchantOperationLogFilters =
    merchantOperationLogModuleFilter !== "all" ||
    merchantOperationLogStatusFilter !== "all" ||
    Boolean(merchantOperationLogStartDate) ||
    Boolean(merchantOperationLogEndDate);
  const merchantOperationLogItems = merchantOperationLogs;
  const exportMerchantOperationLogs = async () => {
    if (!merchantOperationLogTotal) {
      showTip("没有可导出的日志");
      return;
    }
    const normalizedStartDate = formatMerchantLogDateValue(merchantOperationLogStartDate);
    const normalizedEndDate = formatMerchantLogDateValue(merchantOperationLogEndDate);
    if (merchantOperationLogStartDate.trim() && !normalizedStartDate) {
      showTip("开始日期无效，请输入真实日期");
      return;
    }
    if (merchantOperationLogEndDate.trim() && !normalizedEndDate) {
      showTip("结束日期无效，请输入真实日期");
      return;
    }
    const startAt = normalizedStartDate ? formatMerchantLogDateBoundaryIso(normalizedStartDate, "start") : "";
    const endAt = normalizedEndDate ? formatMerchantLogDateBoundaryIso(normalizedEndDate, "end") : "";
    if (startAt && endAt && Date.parse(startAt) > Date.parse(endAt)) {
      showTip("开始日期不能晚于结束日期");
      return;
    }
    try {
      const params = new URLSearchParams({
        siteId: editingSiteId,
        export: "csv",
      });
      if (merchantOperationLogModuleFilter !== "all") params.set("module", merchantOperationLogModuleFilter);
      if (merchantOperationLogStatusFilter !== "all") params.set("status", merchantOperationLogStatusFilter);
      if (startAt) params.set("startAt", startAt);
      if (endAt) params.set("endAt", endAt);
      const response = await fetch(`/api/merchant-operation-logs?${params.toString()}`, {
        method: "GET",
        cache: "no-store",
        credentials: "same-origin",
      });
      if (!response.ok) throw new Error("export_failed");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `merchant-operation-logs-${editingSiteId || "merchant"}-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      showTip("已导出日志");
    } catch {
      showTip("导出失败");
    }
  };
  const merchantLogsPanelContent = merchantDesktopSection === "logs" ? (
    <div className="min-h-[calc(100vh-14rem)] space-y-4">
      <section className="rounded-2xl border border-slate-200 bg-white px-6 py-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-[26px] font-bold leading-8 text-slate-950">日志</div>
            <div className="mt-1 text-sm text-slate-500">查看此商户后台关键操作痕迹，包含保存、启停、删除、充值、兑换、订单、预约和名片等写操作，不记录会话聊天内容。</div>
          </div>
        </div>
        <div className="mt-5 grid gap-3 md:grid-cols-3">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
            <div className="text-xs font-semibold text-slate-500">操作记录</div>
            <div className="mt-2 text-2xl font-semibold text-slate-950">{merchantOperationLogTotal}</div>
            <div className="mt-1 text-xs text-slate-500">全部 {merchantOperationLogAllTotal}</div>
          </div>
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3">
            <div className="text-xs font-semibold text-emerald-700">成功操作</div>
            <div className="mt-2 text-2xl font-semibold text-emerald-800">{merchantOperationLogSuccessTotal}</div>
          </div>
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3">
            <div className="text-xs font-semibold text-rose-700">失败操作</div>
            <div className="mt-2 text-2xl font-semibold text-rose-800">{merchantOperationLogFailedTotal}</div>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white px-5 py-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-lg font-semibold text-slate-900">操作日志</div>
            <div className="mt-1 text-sm text-slate-500">
              显示此商户后台写操作，最新操作在最上方。筛选结果 {merchantOperationLogTotal} 条。
            </div>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              className="h-10 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-800 shadow-sm transition hover:border-slate-300 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={merchantOperationLogsLoading}
              onClick={() => void loadMerchantOperationLogs("reset")}
            >
              {merchantOperationLogsLoading ? "刷新中..." : "刷新"}
            </button>
            <button
              type="button"
              className="h-10 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-800 shadow-sm transition hover:border-slate-300 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!merchantOperationLogTotal || merchantOperationLogsLoading}
              onClick={exportMerchantOperationLogs}
            >
              导出
            </button>
          </div>
        </div>
        <div className="mt-4 grid gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 md:grid-cols-[1fr_1fr_1fr_1fr_auto] md:items-end">
          <label className="grid gap-1 text-xs font-semibold text-slate-500">
            菜单
            <select
              className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
              value={merchantOperationLogModuleFilter}
              onChange={(event) => setMerchantOperationLogModuleFilter(event.currentTarget.value)}
            >
              <option value="all">全部菜单</option>
              {merchantOperationLogModuleOptions.map((moduleName) => (
                <option key={moduleName} value={moduleName}>
                  {moduleName}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-xs font-semibold text-slate-500">
            状态
            <select
              className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
              value={merchantOperationLogStatusFilter}
              onChange={(event) => setMerchantOperationLogStatusFilter(event.currentTarget.value as "all" | MerchantOperationLogStatus)}
            >
              <option value="all">全部状态</option>
              <option value="success">成功</option>
              <option value="failed">失败</option>
            </select>
          </label>
          <label className="grid gap-1 text-xs font-semibold text-slate-500">
            开始时间
            <span className="relative block">
              <input
                key="merchant-operation-log-start-text-input"
                type="text"
                inputMode="numeric"
                autoComplete="off"
                pattern="[0-9./-]*"
                placeholder="例如 2026-06-04"
                className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 pr-11 text-sm font-semibold text-slate-800 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                value={merchantOperationLogStartDate}
                onChange={(event) => setMerchantOperationLogStartDate(event.currentTarget.value)}
              />
              <input
                ref={merchantOperationLogStartPickerRef}
                type="date"
                tabIndex={-1}
                aria-hidden="true"
                className="absolute right-3 top-1/2 h-px w-px -translate-y-1/2 opacity-0"
                value={formatMerchantLogDateValue(merchantOperationLogStartDate)}
                onChange={(event) => setMerchantOperationLogStartDate(event.currentTarget.value)}
              />
              <button
                type="button"
                className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
                onClick={() => openMerchantOperationLogDatePicker(merchantOperationLogStartPickerRef.current)}
                aria-label="选择开始时间"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M8 2v4M16 2v4M3 10h18" />
                  <path d="M5 5h14a2 2 0 0 1 2 2v14H3V7a2 2 0 0 1 2-2Z" />
                </svg>
              </button>
            </span>
          </label>
          <label className="grid gap-1 text-xs font-semibold text-slate-500">
            结束时间
            <span className="relative block">
              <input
                key="merchant-operation-log-end-text-input"
                type="text"
                inputMode="numeric"
                autoComplete="off"
                pattern="[0-9./-]*"
                placeholder="例如 2026-06-04"
                className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 pr-11 text-sm font-semibold text-slate-800 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                value={merchantOperationLogEndDate}
                onChange={(event) => setMerchantOperationLogEndDate(event.currentTarget.value)}
              />
              <input
                ref={merchantOperationLogEndPickerRef}
                type="date"
                tabIndex={-1}
                aria-hidden="true"
                className="absolute right-3 top-1/2 h-px w-px -translate-y-1/2 opacity-0"
                value={formatMerchantLogDateValue(merchantOperationLogEndDate)}
                onChange={(event) => setMerchantOperationLogEndDate(event.currentTarget.value)}
              />
              <button
                type="button"
                className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
                onClick={() => openMerchantOperationLogDatePicker(merchantOperationLogEndPickerRef.current)}
                aria-label="选择结束时间"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M8 2v4M16 2v4M3 10h18" />
                  <path d="M5 5h14a2 2 0 0 1 2 2v14H3V7a2 2 0 0 1 2-2Z" />
                </svg>
              </button>
            </span>
          </label>
          <button
            type="button"
            className="h-10 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-800 transition hover:border-slate-300 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!hasMerchantOperationLogFilters}
            onClick={() => {
              setMerchantOperationLogModuleFilter("all");
              setMerchantOperationLogStatusFilter("all");
              setMerchantOperationLogStartDate("");
              setMerchantOperationLogEndDate("");
            }}
          >
            重置
          </button>
        </div>
        {merchantOperationLogsError ? (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <span>{merchantOperationLogsError}</span>
            <button
              type="button"
              className="font-semibold text-amber-900 underline underline-offset-2 disabled:opacity-50"
              disabled={merchantOperationLogsLoading}
              onClick={() => void loadMerchantOperationLogs("reset")}
            >
              重试
            </button>
          </div>
        ) : null}
        <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200">
          {merchantOperationLogItems.length ? (
            <div className="divide-y divide-slate-100">
              {merchantOperationLogItems.map((item) => (
                <article key={item.id} className="grid gap-3 bg-white px-4 py-3 md:grid-cols-[180px_120px_140px_1fr_120px] md:items-center">
                  <div className="text-sm font-medium text-slate-700">{formatMerchantLogTime(item.at)}</div>
                  <div>
                    <span
                      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${
                        item.status === "success" ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100" : "bg-rose-50 text-rose-700 ring-1 ring-rose-100"
                      }`}
                    >
                      {item.status === "success" ? "成功" : "失败"}
                    </span>
                  </div>
                  <div className="text-sm font-semibold text-slate-800">{item.module}</div>
                  <div className="min-w-0 text-sm text-slate-600">
                    <span className="font-semibold text-slate-900">{item.action}</span>
                    <span className="ml-2 break-words">{item.summary}</span>
                    {item.detail ? <span className="ml-2 break-words text-rose-600">{item.detail}</span> : null}
                  </div>
                  <div className="text-right text-xs font-semibold text-slate-500">
                    {item.method || "-"} {item.endpoint || ""}
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="px-4 py-8 text-center text-sm text-slate-500">
              {hasMerchantOperationLogFilters ? "没有匹配当前筛选条件的操作记录。" : "当前还没有记录到此商户的后台操作。"}
            </div>
          )}
        </div>
        {merchantOperationLogHasMore ? (
          <div className="mt-4 flex justify-center">
            <button
              type="button"
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-800 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={merchantOperationLogsLoading}
              onClick={() => void loadMerchantOperationLogs("append")}
            >
              {merchantOperationLogsLoading ? "加载中..." : `加载更多（已显示 ${merchantOperationLogItems.length} / ${merchantOperationLogTotal}）`}
            </button>
          </div>
        ) : merchantOperationLogsLoading ? (
          <div className="mt-4 text-center text-sm text-slate-500">正在加载日志...</div>
        ) : null}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white px-5 py-5 shadow-sm">
        <div className="text-lg font-semibold text-slate-900">失败快照</div>
        <div className="mt-1 text-sm text-slate-500">发布失败时会保留本地快照，方便回溯问题。</div>
        <div className="mt-4 space-y-3">
          {merchantLogFailureSnapshots.length ? (
            merchantLogFailureSnapshots.map((item) => (
              <article key={`${item.at}:${item.reason}`} className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-rose-700">{item.reason}</div>
                    <div className="mt-1 text-xs text-rose-600">{formatMerchantLogTime(item.at)}</div>
                  </div>
                  <div className="shrink-0 rounded-full bg-white px-2 py-1 text-[11px] font-medium text-rose-600 ring-1 ring-rose-200">
                    {formatBytes(item.bytes)}
                  </div>
                </div>
              </article>
            ))
          ) : (
            <div className="rounded-xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500">最近没有发布失败记录。</div>
          )}
        </div>
      </section>
    </div>
  ) : null;
  const merchantBusinessCardCount = normalizeMerchantBusinessCards(
    effectiveEditingSite?.businessCards ?? editingSite?.businessCards ?? [],
  ).length;
  const merchantVisibleCouponCount = merchantVisibleCouponRecords.length;
  const merchantBusinessCenterContent = (
    <div className="min-h-[calc(100vh-14rem)] px-1 py-1">
      <div className="mx-auto max-w-5xl space-y-5">
        <section className="rounded-2xl border border-slate-200 bg-white px-6 py-6 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-lg font-semibold text-slate-950">经营中心</div>
              <div className="mt-1 text-sm text-slate-500">集中管理网站内容之外的经营数据，网站区块会从这里读取真实内容。</div>
            </div>
          </div>
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <button
              type="button"
              className="rounded-2xl border border-cyan-200 bg-cyan-50 px-4 py-4 text-left transition hover:border-cyan-300 hover:bg-cyan-100"
              onClick={openMerchantCardsPanel}
            >
              <div className="text-sm font-semibold text-cyan-900">名片夹</div>
              <div className="mt-2 text-2xl font-semibold text-cyan-900">{merchantBusinessCardCount} 张</div>
              <div className="mt-2 text-xs leading-5 text-cyan-700">管理图片名片和联系卡短链。</div>
            </button>
          </div>
        </section>
      </div>
    </div>
  );
  const supportDesktopSurfaceContent = (
    <div
      data-editor-overlay
      className={`flex min-h-0 min-w-0 w-full flex-col overflow-hidden border bg-white ${
        showDesktopMerchantSupportPanel
          ? "h-[calc(100vh-3rem)] min-h-[620px] rounded-[28px] border-slate-200 shadow-[0_18px_48px_rgba(15,23,42,0.08)] md:grid md:grid-cols-[360px_minmax(0,1fr)]"
          : "h-full max-h-[88vh] w-full max-w-5xl shadow-2xl md:grid md:grid-cols-[320px_minmax(0,1fr)]"
      }`}
    >
      <div className="flex min-h-0 min-w-0 flex-col overflow-hidden border-b border-slate-200 bg-white md:border-b-0 md:border-r">
        <div className="space-y-4 border-b border-slate-100 px-5 py-4">
          <div className="flex items-center justify-between gap-3">
            <div className="text-[26px] font-bold leading-8 text-slate-950">聊天</div>
            <button
              type="button"
              className="inline-flex h-9 w-9 items-center justify-center rounded-full text-slate-700 transition hover:bg-slate-100"
              onClick={() => void searchSupportPeerMerchant()}
              disabled={supportSearchLoading}
              aria-label="搜索"
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
                <path d="m21 21-4.3-4.3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
              </svg>
            </button>
          </div>
          <div className="flex h-11 items-center gap-2 rounded-full bg-[#f0f2f5] px-4">
            <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0 text-slate-500" fill="none" aria-hidden="true">
              <path d="m21 21-4.3-4.3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
            </svg>
            <input
              type="text"
              className="min-w-0 flex-1 border-0 bg-transparent px-0 py-2 text-sm text-slate-900 outline-none placeholder:text-slate-500"
              placeholder="精确搜索商户ID或邮箱"
              value={supportContactKeyword}
              onChange={(event) => setSupportContactKeyword(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
                event.preventDefault();
                void searchSupportPeerMerchant();
              }}
            />
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto bg-white p-3">
          {supportSearchError ? (
            <div className="mb-3 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-600">{supportSearchError}</div>
          ) : null}
          {supportPeerError ? (
            <div className="mb-3 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-600">{supportPeerError}</div>
          ) : null}
          {supportContactRows.length > 0 ? (
            <div className="space-y-2">
              {supportContactRows.map((contactRow) => {
                const active = supportSelectedContactKey === contactRow.key;
                return (
                  <button
                    key={contactRow.key}
                    type="button"
                    className={`w-full rounded-[14px] border-0 px-3 py-3 text-left transition ${
                      active ? "bg-[#f0f2f5]" : "bg-white hover:bg-slate-50"
                    }`}
                    onClick={() => {
                      setSupportSelectedContactKey(contactRow.key);
                      focusSupportInput();
                    }}
                  >
                    <div className="flex items-start gap-3">
                      <SupportAvatarBadge
                        label={contactRow.avatarLabel}
                        imageUrl={contactRow.avatarImageUrl}
                        imageAlt={contactRow.name}
                        className={`mt-0.5 flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-sm font-semibold shadow-sm ${
                          contactRow.isOfficial || contactRow.unread
                            ? "bg-slate-900 text-white"
                            : "bg-slate-100 text-slate-700"
                        }`}
                        labelClassName="text-sm font-semibold"
                        showMerchantBadge={contactRow.accountType === "merchant"}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                  <div className="truncate text-sm font-medium text-slate-900" data-no-translate="1">{contactRow.name}</div>
                                  {!contactRow.isOfficial ? (
                                    <span className="truncate text-[11px] font-medium text-slate-400" data-no-translate="1">{contactRow.subtitle}</span>
                                  ) : null}
                                  {contactRow.badge ? (
                                    <span className="inline-flex shrink-0 items-center rounded-full bg-slate-900 px-2 py-0.5 text-[10px] font-medium leading-none text-white">
                                      {contactRow.badge}
                                    </span>
                                  ) : null}
                                  {contactRow.unreadCount > 0 ? (
                                    <span
                                      aria-label={`有 ${contactRow.unreadCount} 条未读消息`}
                                      className="inline-flex min-w-[18px] shrink-0 items-center justify-center rounded-full bg-rose-500 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white"
                                    >
                                      {contactRow.unreadCount > 99 ? "99+" : contactRow.unreadCount}
                                    </span>
                                  ) : null}
                                </div>
                                {contactRow.isOfficial ? (
                                  <div className="truncate text-[11px] text-slate-500" data-no-translate="1">{contactRow.subtitle}</div>
                                ) : null}
                              </div>
                              <div className="shrink-0 text-[11px] text-slate-400">
                                {contactRow.updatedAt ? formatSupportConversationTime(contactRow.updatedAt) : "未聊天"}
                              </div>
                            </div>
                            <div className="mt-2 truncate text-xs leading-5 text-slate-600" data-no-translate="1">{contactRow.preview}</div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="rounded border border-dashed px-3 py-4 text-xs text-slate-500">还没有联系人，请先精确搜索商户ID或邮箱。</div>
          )}
        </div>
      </div>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[#edf4f7]">
        <div className="flex min-h-[64px] min-w-0 items-center justify-between gap-3 border-b border-slate-200 bg-white px-5 py-3">
          <div className="flex min-w-0 items-center gap-3">
            {selectedSupportIsOfficial ? (
              <SupportAvatarBadge
                label={selectedSupportAvatarLabel}
                imageAlt={selectedSupportDisplayName}
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-slate-900 text-sm font-semibold text-white shadow-sm"
                labelClassName="text-sm font-semibold text-white"
              />
            ) : showDesktopMerchantSupportPanel ? (
              <button
                type="button"
                className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full bg-slate-900 text-sm font-semibold text-white shadow-sm transition hover:scale-[1.02]"
                onClick={() => setSupportMerchantInfoSheetOpen(true)}
                aria-label="查看商户资料"
              >
                <SupportAvatarBadge
                  label={selectedSupportAvatarLabel}
                  imageUrl={selectedSupportAvatarImageUrl}
                  imageAlt={selectedSupportDisplayName}
                  className="flex h-full w-full items-center justify-center rounded-full bg-slate-900 text-white"
                  labelClassName="text-sm font-semibold text-white"
                  showMerchantBadge={selectedSupportPeerIsMerchant}
                />
              </button>
            ) : (
              <SupportAvatarBadge
                label={selectedSupportAvatarLabel}
                imageUrl={selectedSupportAvatarImageUrl}
                imageAlt={selectedSupportDisplayName}
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-slate-900 text-sm font-semibold text-white shadow-sm"
                labelClassName="text-sm font-semibold text-white"
                showMerchantBadge={selectedSupportPeerIsMerchant}
              />
            )}
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <div className="truncate text-base font-semibold text-slate-900">{selectedSupportDisplayName}</div>
                {selectedSupportIsOfficial ? (
                  <span className="inline-flex shrink-0 items-center rounded-full bg-slate-900 px-2 py-0.5 text-[10px] font-medium leading-none text-white">
                    {supportOfficialBadgeLabel}
                  </span>
                ) : null}
              </div>
              <div className="truncate text-xs text-slate-500">{selectedSupportHeaderMeta}</div>
            </div>
          </div>
          {!showDesktopMerchantSupportPanel ? (
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                className="rounded border bg-white px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-50"
                onClick={() => setSupportBusinessCardDialogOpen(true)}
                disabled={supportSending}
              >
                名片
              </button>
              <button
                type="button"
                className="rounded border bg-white px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-50"
                onClick={() => {
                  if (showDesktopMerchantSupportPanel) {
                    setMerchantDesktopSection("editor");
                  }
                  setSupportDialogOpen(false);
                }}
                disabled={supportSending}
              >
                关闭
              </button>
            </div>
          ) : null}
        </div>

        <div
          ref={supportMessagesViewportRef}
          className="min-h-0 min-w-0 flex-1 overflow-y-auto px-10 py-5"
          style={{
            backgroundColor: "#eff6f3",
            backgroundImage:
              "linear-gradient(135deg, rgba(222,249,238,0.96) 0%, rgba(239,247,255,0.9) 46%, rgba(222,231,244,0.92) 100%)",
          }}
        >
          {supportPinnedMessageBanner}
          {canLoadOlderSupportPeerMessages ? (
            <div className="mb-3 flex justify-center">
              <button
                type="button"
                className="rounded-full bg-white/90 px-3 py-1.5 text-xs font-semibold text-slate-600 shadow-sm transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
                disabled={supportPeerHistoryLoading}
                onClick={() => selectedSupportPeerContact?.merchantId && void loadSupportPeerThreadMessages(selectedSupportPeerContact.merchantId, "prepend")}
              >
                {supportPeerHistoryLoading ? "加载中..." : "加载更早消息"}
              </button>
            </div>
          ) : null}
          {selectedSupportLoading ? (
            <div className="rounded-2xl border border-dashed bg-white px-4 py-6 text-center text-sm text-slate-500">正在加载聊天记录...</div>
          ) : visibleSupportMessages.length ? (
            <div className="min-w-0 space-y-2" data-support-message-list="true">
              {visibleSupportMessages.map((message, index) => {
                const previousMessage = index > 0 ? visibleSupportMessages[index - 1] : null;
                const showDateDivider =
                  !previousMessage || !isSameSupportCalendarDay(previousMessage.createdAt, message.createdAt);
                const messageKey = buildVisibleSupportMessageKey(message);
                const messageMeta =
                  message.localStatus === "pending"
                    ? "发送中"
                    : message.localStatus === "failed"
                      ? "发送失败"
                      : formatSupportClockTime(message.createdAt);
                const replyContent = parseSupportReplyMessageText(message.text);
                const displayMessageText = replyContent?.body ?? message.text;
                const hasAttachmentPreview = Boolean(parseSupportMessageAttachmentPreview(displayMessageText));
                const messageHidden = supportHiddenMessageKeys.includes(messageKey);
                const messageSelected = supportSelectedMessageKeys.includes(messageKey);
                const messageStarred = supportStarredMessageKeys.includes(messageKey);
                if (messageHidden) return null;
                return (
                  <div
                    key={messageKey}
                    ref={(node) => {
                      supportMessageElementByKeyRef.current[messageKey] = node;
                    }}
                    className="space-y-2"
                  >
                    {showDateDivider ? (
                      <div className="flex justify-center">
                        <span className="rounded-full bg-white/90 px-3 py-1 text-[11px] text-slate-500 shadow-sm">
                          {formatSupportThreadDateLabel(message.createdAt)}
                        </span>
                      </div>
                    ) : null}
                    <div className={`flex min-w-0 ${message.isSelf ? "justify-end" : "justify-start"}`}>
                      <div className={`flex max-w-[82%] min-w-0 items-end gap-2 ${message.isSelf ? "ml-auto justify-end" : "mr-auto justify-start"}`}>
                        {supportSelectionActive ? (
                          <button
                            type="button"
                            className={`mb-1 flex h-5 w-5 shrink-0 items-center justify-center rounded border text-white transition ${
                              messageSelected ? "border-emerald-500 bg-emerald-500" : "border-slate-300 bg-white"
                            }`}
                            onClick={(event) => {
                              event.stopPropagation();
                              toggleSupportMessageSelection(messageKey);
                            }}
                            aria-label={messageSelected ? "取消选择消息" : "选择消息"}
                          >
                            {messageSelected ? (
                              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" aria-hidden="true">
                                <path d="M6 12.5 10 16l8-9" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            ) : null}
                          </button>
                        ) : null}
                        <div
                          className={`faolla-message-bubble max-w-full min-w-0 rounded-[18px] shadow-sm ${
                            hasAttachmentPreview
                              ? `border border-transparent bg-transparent px-0 py-0 ${message.isSelf ? "ml-auto" : "mr-auto"}`
                              : message.isSelf
                                ? "bg-[#d9fdd3] px-3 py-1.5 text-slate-950"
                                : "border border-transparent bg-white px-3 py-1.5 text-slate-950"
                          } ${messageSelected ? "ring-2 ring-blue-400/70" : ""}`}
                          onContextMenu={(event) => openSupportMessageContextMenu(event, message)}
                          onClick={() => {
                            if (!supportSelectionActive) return;
                            toggleSupportMessageSelection(messageKey);
                          }}
                        >
                          {replyContent ? (
                            <div className="mb-1.5 max-w-full rounded-xl bg-slate-100/95 px-2.5 py-1.5 text-left text-xs leading-5 text-slate-500">
                              <div className="font-semibold text-slate-600">{replyContent.senderLabel}</div>
                              <div className="line-clamp-2">{replyContent.text}</div>
                            </div>
                          ) : null}
                          <SupportMessageContent
                            value={displayMessageText}
                            isSelf={message.isSelf}
                            onImageActivate={handleSupportMessageImageActivate}
                          />
                          <span className={`faolla-message-time text-[11px] leading-none ${hasAttachmentPreview ? "mt-1 block text-right" : "ml-2 inline-block align-baseline"} ${message.isSelf ? "text-slate-500" : "text-slate-400"}`}>
                            {messageMeta}
                            {messageStarred ? <span className="ml-1 text-[16px] leading-none text-amber-400">★</span> : null}
                          </span>
                        </div>
                        {message.isSelf && message.localStatus === "failed" ? (
                          <div className="relative mb-1 ml-2 shrink-0">
                            <button
                              type="button"
                              aria-label="发送失败，打开操作"
                              className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-rose-500 bg-white text-[12px] font-semibold leading-none text-rose-600"
                              onClick={(event) => {
                                event.stopPropagation();
                                setSupportFailedMessageActionKey((current) => (current === messageKey ? "" : messageKey));
                              }}
                            >
                              !
                            </button>
                            {supportFailedMessageActionKey === messageKey ? (
                              <div className="absolute bottom-7 right-0 z-30 w-28 overflow-hidden rounded-2xl border border-slate-200 bg-white text-sm text-slate-900 shadow-xl">
                                <button
                                  type="button"
                                  className="block w-full px-3 py-2 text-left hover:bg-slate-50"
                                  onClick={() => void retryFailedSupportMessage(message)}
                                >
                                  重新发送
                                </button>
                                <button
                                  type="button"
                                  className="block w-full border-t border-slate-100 px-3 py-2 text-left text-rose-600 hover:bg-rose-50"
                                  onClick={() => removeFailedSupportMessage(message)}
                                >
                                  删除
                                </button>
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed bg-white px-4 py-6 text-center text-sm text-slate-500">
              {selectedSupportEmptyStateText}
            </div>
          )}
        </div>

        <div className="min-w-0 shrink-0 bg-[#edf5f2] px-5 py-3">
          {supportError && supportSelectedContactKey === SUPPORT_OFFICIAL_CONTACT_KEY ? (
            <div className="mb-3 text-sm text-rose-600">{supportError}</div>
          ) : null}
          {supportSelectionActionBar}
          {supportPendingImageDraftsBanner}
          {supportReplyDraftBanner}
          <div className="flex min-w-0 items-end gap-2 rounded-full bg-white px-3 py-2 shadow-sm ring-1 ring-slate-200/70">
            <div className="relative shrink-0">
              <button
                type="button"
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-slate-950 transition hover:bg-slate-100 disabled:opacity-45 ${
                  supportAttachmentMenuOpen ? "bg-slate-100" : ""
                }`}
                onClick={toggleSupportAttachmentMenu}
                disabled={!supportComposerAvailable || supportComposerBusy}
                aria-label="添加附件"
              >
                <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" aria-hidden="true">
                  <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </button>
              {supportAttachmentMenuOpen ? (
                <div className="absolute bottom-12 left-0 z-30 w-44 overflow-hidden rounded-[18px] border border-slate-200/80 bg-white py-1.5 text-sm text-slate-800 shadow-[0_16px_38px_rgba(15,23,42,0.16)]">
                  <button
                    type="button"
                    className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition hover:bg-slate-100 disabled:opacity-45"
                    onClick={() => {
                      void openSupportFilePicker();
                    }}
                    disabled={supportComposerBusy}
                  >
                    <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" aria-hidden="true">
                      <path d="M8 4.5h5.2L18 9.3V18a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V6.5a2 2 0 0 1 2-2Z" stroke="currentColor" strokeWidth="1.8" />
                      <path d="M13 4.8V9h4.2" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
                    </svg>
                    <span>文件</span>
                  </button>
                  <button
                    type="button"
                    className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition hover:bg-slate-100 disabled:opacity-45"
                    onClick={openSupportSelfCardPicker}
                    disabled={supportComposerBusy}
                  >
                    <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" aria-hidden="true">
                      <path d="M5 7.5A2.5 2.5 0 0 1 7.5 5h9A2.5 2.5 0 0 1 19 7.5v9a2.5 2.5 0 0 1-2.5 2.5h-9A2.5 2.5 0 0 1 5 16.5v-9Z" stroke="currentColor" strokeWidth="1.8" />
                      <circle cx="12" cy="10" r="2.2" stroke="currentColor" strokeWidth="1.8" />
                      <path d="M8.5 16a3.5 3.5 0 0 1 7 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                    </svg>
                    <span>名片</span>
                  </button>
                  <button
                    type="button"
                    className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition hover:bg-slate-100 disabled:opacity-45"
                    onClick={() => {
                      void handleSupportLocationAttachment();
                    }}
                    disabled={supportComposerBusy}
                  >
                    <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" aria-hidden="true">
                      <path d="M12 20s6-5.5 6-10a6 6 0 1 0-12 0c0 4.5 6 10 6 10Z" stroke="currentColor" strokeWidth="1.8" />
                      <circle cx="12" cy="10" r="2.2" fill="currentColor" />
                    </svg>
                    <span>位置</span>
                  </button>
                </div>
              ) : null}
            </div>
            <div className="relative shrink-0">
              <button
                type="button"
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-slate-950 transition hover:bg-slate-100 disabled:opacity-45 ${
                  supportEmojiMenuOpen ? "bg-slate-100" : ""
                }`}
                onClick={() => {
                  if (!supportComposerAvailable || supportComposerBusy) return;
                  setSupportAttachmentMenuOpen(false);
                  setSupportSelfCardPickerOpen(false);
                  setSupportMessageContextMenu(null);
                  setSupportEmojiMenuOpen((current) => !current);
                }}
                disabled={!supportComposerAvailable || supportComposerBusy}
                aria-label="选择表情"
              >
                <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" aria-hidden="true">
                  <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.8" />
                  <path d="M8.8 10h.01M15.2 10h.01" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
                  <path d="M8.8 14.2c.82 1.12 1.87 1.68 3.2 1.68s2.38-.56 3.2-1.68" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
              </button>
              {supportEmojiMenuOpen ? (
                <div className="absolute bottom-12 left-0 z-30 w-[292px] rounded-[20px] border border-slate-200/80 bg-white p-3 shadow-[0_16px_38px_rgba(15,23,42,0.16)]">
                  {supportEmojiPickerGrid}
                </div>
              ) : null}
            </div>
            <textarea
              ref={supportInputRef}
              rows={1}
              data-support-auto-resize="desktop"
              className="min-h-[36px] min-w-0 flex-1 resize-none border-0 bg-transparent px-1 py-2 text-[15px] leading-5 text-slate-900 caret-slate-900 outline-none transition placeholder:text-slate-400"
              placeholder={selectedSupportInputPlaceholder}
              value={supportDraft}
              style={{ WebkitTextFillColor: "#0f172a" }}
              onChange={(event) => {
                setSupportDraft(event.target.value);
                resizeSupportComposerInput(event.target);
                keepSupportComposerCaretVisible(event.target);
              }}
              onFocus={() => {
                setSupportAttachmentMenuOpen(false);
                setSupportEmojiMenuOpen(false);
                setSupportSelfCardPickerOpen(false);
                setSupportMessageContextMenu(null);
              }}
              onKeyDown={handleSupportComposerKeyDown}
              onPaste={handleSupportComposerPaste}
              disabled={supportSending || (!selectedSupportPeerContact && supportSelectedContactKey !== SUPPORT_OFFICIAL_CONTACT_KEY)}
            />
            <button
              type="button"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#22c55e] text-white transition hover:bg-[#16a34a] disabled:bg-slate-300 disabled:text-white"
              onClick={() => void sendSupportMessage()}
              disabled={supportComposerBusy || !supportCanSend}
              aria-label={supportComposerBusy ? "发送中" : selectedSupportSendButtonLabel}
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden="true">
                <path d="M5.35 4.45c-.74-.35-1.5.42-1.14 1.15l2.45 5.05c.12.24.36.4.63.42l6.26.47-6.26.47a.78.78 0 0 0-.63.42l-2.45 5.05c-.36.73.4 1.5 1.14 1.15l15-7.1a.85.85 0 0 0 0-1.54l-15-7.1Z" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
  const desktopMerchantWorkspaceContent =
    isDesktopMerchantWorkspace && merchantDesktopSection !== "editor" ? (
      <div
        className={`merchant-desktop-workspace ${
          merchantDesktopSection === "faolla" ? "min-h-screen bg-white" : "min-h-screen bg-[#f3f6fb]"
        }`}
        data-merchant-desktop-section={merchantDesktopSection}
      >
        <div className={merchantDesktopSection === "faolla" ? "w-full" : "w-full px-6 pb-8"}>
          {merchantDesktopSection === "profile" && merchantProfileDialogCommonProps ? (
            <MerchantProfileDialog
              {...merchantProfileDialogCommonProps}
              open
              mode="inline"
              showCloseButton={false}
              showBusinessCardManager={false}
              className="my-6 min-h-[calc(100vh-14rem)]"
            />
          ) : merchantDesktopSection === "business" ? (
            merchantBusinessCenterContent
          ) : merchantDesktopSection === "cards" && merchantBusinessCardManagerCommonProps ? (
            <MerchantBusinessCardManager {...merchantBusinessCardManagerCommonProps} folderViewMode="page" />
          ) : merchantDesktopSection === "customers" ? (
            <MerchantCustomerManager
              siteId={editingSiteId || merchantSiteIdOverride || ""}
              siteName={effectiveMerchantDisplayName || merchantDisplayName}
              className="min-h-[calc(100vh-14rem)]"
            />
          ) : merchantDesktopSection === "pollStats" ? (
            <MerchantPollStatsPanel
              siteId={editingSiteId || merchantSiteIdOverride || ""}
              siteName={effectiveMerchantDisplayName || merchantDisplayName}
              className="min-h-[calc(100vh-14rem)]"
            />
          ) : merchantDesktopCouponCenterActive && merchantCouponManagerCommonProps ? (
            <MerchantCouponManager {...merchantCouponManagerCommonProps} view={merchantCouponManagerView} />
          ) : merchantDesktopSection === "printer" ? (
            <MerchantPrintSettingsPanel
              siteId={editingSiteId || merchantSiteIdOverride || ""}
              siteName={effectiveMerchantDisplayName || merchantDisplayName}
              siteCountryCode={effectiveEditingSite?.location?.countryCode || editingSite?.location?.countryCode || ""}
              siteCountry={effectiveEditingSite?.location?.country || editingSite?.location?.country || ""}
              className="min-h-[calc(100vh-14rem)]"
            />
          ) : merchantDesktopSection === "pointRedemption" && canUsePointsRedemption ? (
            <MerchantPointRedemptionCashier
              siteId={editingSiteId || merchantSiteIdOverride || ""}
              siteName={effectiveMerchantDisplayName || merchantDisplayName}
              className="min-h-[calc(100vh-14rem)] py-6"
            />
          ) : merchantDesktopSection === "redemptionRecords" && canUsePointsRedemption ? (
            <MerchantPointRedemptionCashier
              siteId={editingSiteId || merchantSiteIdOverride || ""}
              siteName={effectiveMerchantDisplayName || merchantDisplayName}
              className="min-h-[calc(100vh-14rem)] py-6"
              view="records"
            />
          ) : merchantDesktopSection === "rechargeRecords" && canUsePointsRedemption ? (
            <MerchantPointRedemptionCashier
              siteId={editingSiteId || merchantSiteIdOverride || ""}
              siteName={effectiveMerchantDisplayName || merchantDisplayName}
              className="min-h-[calc(100vh-14rem)] py-6"
              view="rechargeRecords"
            />
          ) : (merchantDesktopSection === "redemptionCategories" || merchantDesktopSection === "redemptionItems") &&
            canUsePointsRedemption ? (
            <MerchantRedemptionSettingsPanel
              siteId={editingSiteId || merchantSiteIdOverride || ""}
              view={merchantDesktopSection}
              className="min-h-[calc(100vh-14rem)]"
            />
          ) : merchantDesktopSection === "members" && canUseMembershipManagement ? (
            merchantMemberSettingsView === "list" ? (
              <MerchantMemberManager
                siteId={editingSiteId || ""}
                siteName={effectiveMerchantDisplayName || merchantDisplayName}
                className="min-h-[calc(100vh-14rem)] py-6"
              />
            ) : (
              <MerchantMembershipSettingsPanel
                siteId={editingSiteId || ""}
                view={merchantMemberSettingsView}
                className="min-h-[calc(100vh-14rem)]"
              />
            )
          ) : merchantDesktopSection === "booking" && merchantBookingManagerDialogCommonProps ? (
            <MerchantBookingManagerDialog
              {...merchantBookingManagerDialogCommonProps}
              open
              mode="inline"
              showCloseButton={false}
              workbenchOpen={merchantBookingWorkbenchOpen}
              hideWorkbenchButton
              onWorkbenchOpenChange={setMerchantBookingWorkbenchOpen}
              className="min-h-[calc(100vh-14rem)]"
            />
          ) : merchantDesktopSection === "orders" && merchantOrderManagerDialogCommonProps ? (
            <MerchantOrderManagerDialog
              {...merchantOrderManagerDialogCommonProps}
              open
              mode="inline"
              showCloseButton={false}
              workbenchOpen={merchantOrderWorkbenchOpen}
              hideWorkbenchButton
              onWorkbenchOpenChange={setMerchantOrderWorkbenchOpen}
              className="min-h-[calc(100vh-14rem)]"
            />
          ) : merchantDesktopSection === "enterprise" && canUseEnterpriseManagement ? (
            <MerchantEnterpriseManager
              siteId={editingSiteId || merchantSiteIdOverride || ""}
              siteName={effectiveMerchantDisplayName || merchantDisplayName}
              className="min-h-[calc(100vh-14rem)]"
              onTodoCountChange={setMerchantEnterpriseTodoCount}
              taskDraftIntent={
                merchantEnterpriseTaskIntent?.siteId ===
                (editingSiteId || merchantSiteIdOverride || "")
                  ? merchantEnterpriseTaskIntent
                  : null
              }
              onTaskDraftIntentHandled={handleMerchantEnterpriseTaskIntentHandled}
              {...(canUseOrderManagement
                ? {
                    onOpenSourceOrder: (input: { siteId: string; orderId: string }) =>
                      openMerchantEnterpriseSourceOrder(input, "desktop"),
                  }
                : {})}
              navigation={{
                mode: "external",
                activeView: merchantEnterpriseView,
                onViewChange: setMerchantEnterpriseView,
                onAvailableViewsChange: setMerchantEnterpriseAvailableViews,
                registerViewChangeGuard: (guard) => {
                  merchantEnterpriseViewChangeGuardRef.current = guard;
                },
              }}
              registerLeaveGuard={(guard) => {
                merchantEnterpriseLeaveGuardRef.current = guard;
              }}
            />
          ) : merchantDesktopSection === "logs" ? (
            merchantLogsPanelContent
          ) : merchantDesktopSection === "support" ? (
            supportDesktopSurfaceContent
          ) : null}
          <div
            className={`relative overflow-hidden bg-white ${
              supportDesktopFaollaActive ? "h-[100dvh] min-h-[720px]" : "hidden h-[calc(100vh-9rem)] min-h-[560px]"
            }`}
          >
              <div className="pointer-events-none absolute left-4 top-4 z-10">
                <FaollaHomeButton className="pointer-events-auto h-11 w-11" onClick={navigateSupportFaollaHome} />
              </div>
              <iframe
                ref={supportDesktopFaollaFrameRef}
                title="Faolla"
                src={supportFaollaFrameTargetHref}
                onLoad={(event) => handleSupportFaollaFrameLoad(event.currentTarget)}
                className="absolute inset-0 h-full w-full border-0 bg-transparent"
              />
            </div>
        </div>
      </div>
    ) : null;

  return (
    <main
      className={editorMainClassName}
      style={{
        paddingTop: topBarCollapsed ? "0px" : shouldUseDesktopEditorSidebar ? "0px" : `${Math.max(topBarHeight, 56)}px`,
      }}
      onMouseDownCapture={handleEditorMouseDownCapture}
      data-editor-mode={editorMode}
      data-force-desktop-sidebar={forceDesktopEditorSidebar ? "1" : "0"}
      data-desktop-sidebar={shouldUseDesktopEditorSidebar ? "1" : "0"}
    >
      <style jsx global>{`
        [data-desktop-sidebar="1"],
        [data-desktop-sidebar="1"] .merchant-desktop-workspace {
          font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif;
          font-synthesis: none;
          text-rendering: optimizeLegibility;
          -webkit-font-smoothing: antialiased;
          -moz-osx-font-smoothing: grayscale;
        }

        [data-desktop-sidebar="1"] .merchant-desktop-workspace > div:first-child {
          min-height: 100vh;
        }

        [data-desktop-sidebar="1"] .merchant-desktop-workspace h1,
        [data-desktop-sidebar="1"] .merchant-desktop-workspace h2,
        [data-desktop-sidebar="1"] .merchant-desktop-workspace .cashier-title h2 {
          margin: 0;
          color: #0f172a;
          font-size: 26px;
          font-weight: 800;
          line-height: 32px;
          letter-spacing: 0;
        }

        [data-desktop-sidebar="1"] .merchant-desktop-workspace .text-\\[26px\\] {
          font-size: 26px;
          line-height: 32px;
          font-weight: 800;
          letter-spacing: 0;
        }

        [data-desktop-sidebar="1"] .merchant-desktop-workspace .text-2xl {
          letter-spacing: 0;
        }

        [data-desktop-sidebar="1"] .merchant-desktop-workspace > div:first-child > section:first-child,
        [data-desktop-sidebar="1"] .merchant-desktop-workspace > div:first-child > div:first-child {
          scroll-margin-top: 24px;
        }

        [data-desktop-sidebar="1"] .merchant-desktop-workspace [data-editor-overlay] {
          font-family: inherit;
        }

      `}</style>
      {!topBarCollapsed && backendNotice ? (
        <div className={isMobileMerchantEditorShell ? "mx-auto max-w-[460px] px-4 pb-4" : "max-w-6xl mx-auto px-6 pb-3"}>
          <div
            className={
              isMobileMerchantEditorShell
                ? "rounded-[22px] border border-amber-200 bg-amber-50/92 px-4 py-3 text-sm text-amber-800 shadow-[0_12px_28px_rgba(245,158,11,0.12)]"
                : "rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-800"
            }
          >
            {backendNotice}
          </div>
        </div>
      ) : null}
      <div
        className={`fixed z-[16000] ${
          shouldUseDesktopEditorSidebar
            ? topBarCollapsed
              ? "left-0 top-28"
              : "left-[227px] top-28"
            : isMobileMerchantEditorShell
              ? `left-4 ${topBarCollapsed ? "top-[calc(var(--faolla-mobile-safe-top)+1rem)]" : "top-[calc(var(--faolla-mobile-safe-top)+1.1rem)]"}`
              : "left-0 top-3"
        }`}
      >
        <button
          type="button"
          className={`group flex items-center justify-center border text-base leading-none transition-all ${
            shouldUseDesktopEditorSidebar
              ? "h-24 w-7 rounded-r-[16px] border-0 bg-[#111827] text-[#dbeafe] shadow-none hover:bg-[#111827] hover:text-white"
              : isMobileMerchantEditorShell
                ? "h-11 w-11 rounded-full border-white/70 bg-white/92 text-slate-700 shadow-[0_18px_40px_rgba(15,23,42,0.14)]"
                : "h-10 w-7 rounded-r-lg border-l-0 bg-white text-slate-700 shadow-sm hover:bg-gray-50"
          }`}
          onClick={toggleTopBarCollapsed}
          title={shouldUseDesktopEditorSidebar ? `${topBarCollapsed ? "展开侧栏" : "收起侧栏"} (Alt+S)` : topBarCollapsed ? "展开侧栏" : "收起侧栏"}
          aria-label={topBarCollapsed ? "展开编辑侧栏" : "收起编辑侧栏"}
          aria-keyshortcuts={shouldUseDesktopEditorSidebar ? "Alt+S" : undefined}
        >
          {isMobileMerchantEditorShell ? (
            topBarCollapsed ? "≡" : "×"
          ) : shouldUseDesktopEditorSidebar ? (
            <span className="pointer-events-none flex items-center justify-center transition-transform group-hover:scale-[1.04]">
              <svg viewBox="0 0 24 24" className={`h-7 w-7 ${topBarCollapsed ? "rotate-180" : ""}`} fill="none" aria-hidden="true">
                <path d="M15 6 9 12l6 6" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          ) : topBarCollapsed ? (
            ">"
          ) : (
            "<"
          )}
        </button>
      </div>
      <div
        ref={topBarRef}
        data-editor-toolbar
        data-editor-mode={editorMode}
        className={toolbarWrapperClassName}
      >
        <div className={toolbarContentClassName}>
            <div className={toolbarHeaderClassName}>
              {isPlatformEditor ? <div className="text-lg font-bold">{editorTitle}</div> : null}
              {!isPlatformEditor ? (
                isMobileMerchantEditorShell ? (
                  <div className="rounded-[30px] border border-white/75 bg-[linear-gradient(135deg,_rgba(8,17,33,0.96)_0%,_rgba(15,23,42,0.92)_50%,_rgba(15,118,110,0.84)_100%)] p-5 text-white shadow-[0_22px_55px_rgba(8,17,33,0.28)]">
                    <div className="flex items-start gap-4">
                      <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-[24px] bg-white/12 text-xl font-semibold tracking-[0.18em] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.16)]">
                        {merchantEditorAvatarLabel}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/10 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.24em] text-cyan-50/90">
                          <span className="inline-flex h-2 w-2 rounded-full bg-emerald-300" />
                          Merchant Space
                        </div>
                        <div className="mt-4 flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-[11px] font-medium uppercase tracking-[0.28em] text-slate-200/72">当前商户</div>
                            <div className="mt-2 truncate text-[28px] font-semibold tracking-tight text-white" title={merchantDisplayName}>
                              {merchantDisplayName}
                            </div>
                            <div className="mt-2 text-sm leading-6 text-slate-200/84">手机上也能像 app 一样编辑站点内容。</div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="relative block min-h-[70px] border-b border-white/10 px-2 pb-[18px] pt-2">
                    <div className="flex min-w-0 items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-[17px] font-bold leading-tight text-white" title={merchantDisplayName}>
                          {merchantDisplayName}
                        </div>
                        <div className="mt-1 truncate text-[13px] text-[#bfdbfe]">FAOLLA</div>
                      </div>
                      {isDesktopMerchantWorkspace ? (
                          <button
                            type="button"
                            className="inline-flex h-9 w-10 shrink-0 items-center justify-center rounded-lg border border-blue-300/35 bg-white/5 text-[#dbeafe] transition hover:bg-[#17233f] hover:text-white disabled:opacity-50"
                            onClick={() => {
                              void requestLogout();
                            }}
                            disabled={loggingOut}
                            title={loggingOut ? "退出中..." : "退出登录"}
                            aria-label={loggingOut ? "退出中..." : "退出登录"}
                          >
                            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
                              <path d="M14 7h2a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                              <path d="M10 8 6 12l4 4M7 12h9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          </button>
                      ) : null}
                    </div>
                  </div>
                )
              ) : null}
              {isPlatformEditor && storeScope !== "default" ? (
                <div className="rounded border border-blue-300 bg-blue-50 px-2 py-1 text-xs text-blue-700">
                  {isPlatformEditor ? "平台范围" : "站点范围"}：{storeScope}
                </div>
              ) : null}
            </div>
            {isDesktopMerchantWorkspace ? (
              merchantEditorOnly ? null : (
              <div className="grid gap-4">
                <div className="grid gap-[5px]">
                  <div className="grid gap-[5px]">
                    {canUsePointsRedemption ? (
                      <button
                        type="button"
                        className={getMerchantDesktopMenuButtonClassName(merchantDesktopPointRedemptionCenterActive)}
                        onPointerEnter={() => {
                          void loadMerchantPointRedemptionCashier().catch(() => undefined);
                        }}
                        onFocus={() => {
                          void loadMerchantPointRedemptionCashier().catch(() => undefined);
                        }}
                        onClick={() => {
                          void openMerchantPointRedemptionPanel();
                        }}
                      >
                        <span className="inline-flex min-w-0 items-center gap-2">
                          <MerchantDesktopMenuIcon name="points" />
                          <span>积分兑换</span>
                        </span>
                      </button>
                    ) : null}
                    {canUseBookingBlock ? (
                      <button
                        type="button"
                        className={getMerchantDesktopMenuButtonClassName(merchantDesktopSection === "booking")}
                        onPointerEnter={() => {
                          void loadMerchantBookingManagerDialog().catch(() => undefined);
                        }}
                        onFocus={() => {
                          void loadMerchantBookingManagerDialog().catch(() => undefined);
                        }}
                        onClick={() => {
                          void openMerchantBookingPanel();
                        }}
                      >
                        <span className="inline-flex min-w-0 items-center gap-2">
                          <MerchantDesktopMenuIcon name="booking" />
                          <span>预约管理</span>
                        </span>
                        {merchantBookingAttentionSummary.count > 0 ? (
                          <span className="ml-2 inline-flex min-w-[1.5rem] items-center justify-center rounded-full bg-emerald-500 px-2 py-0.5 text-xs font-semibold leading-none text-white">
                            {merchantBookingAttentionSummary.count > 99 ? "99+" : merchantBookingAttentionSummary.count}
                          </span>
                        ) : null}
                      </button>
                    ) : null}
                    {canUseOrderManagement ? (
                      <button
                        type="button"
                        className={getMerchantDesktopMenuButtonClassName(merchantDesktopSection === "orders")}
                        onPointerEnter={() => {
                          void loadMerchantOrderManagerDialog().catch(() => undefined);
                        }}
                        onFocus={() => {
                          void loadMerchantOrderManagerDialog().catch(() => undefined);
                        }}
                        onClick={() => {
                          void openMerchantOrderPanel();
                        }}
                      >
                        <span className="inline-flex min-w-0 items-center gap-2">
                          <MerchantDesktopMenuIcon name="orders" />
                          <span>订单管理</span>
                        </span>
                        {merchantOrderAttentionSummary.count > 0 ? (
                          <span className="ml-2 inline-flex min-w-[1.5rem] items-center justify-center rounded-full bg-emerald-500 px-2 py-0.5 text-xs font-semibold leading-none text-white">
                            {merchantOrderAttentionSummary.count > 99 ? "99+" : merchantOrderAttentionSummary.count}
                          </span>
                        ) : null}
                      </button>
                    ) : null}
                    {canUseEnterpriseManagement ? (
                      <button
                        type="button"
                        className={getMerchantDesktopMenuButtonClassName(merchantDesktopSection === "enterprise")}
                        onPointerEnter={() => {
                          void loadMerchantEnterpriseManager().catch(() => undefined);
                        }}
                        onFocus={() => {
                          void loadMerchantEnterpriseManager().catch(() => undefined);
                        }}
                        onClick={() => {
                          void openMerchantEnterprisePanel();
                        }}
                        aria-controls="merchant-enterprise-context-menu"
                        aria-expanded={merchantDesktopSection === "enterprise"}
                      >
                        <span className="inline-flex min-w-0 items-center gap-2">
                          <MerchantDesktopMenuIcon name="enterprise" />
                          <span>企业管理</span>
                        </span>
                        {merchantEnterpriseTodoCount > 0 ? (
                          <span className="ml-2 inline-flex min-w-[1.5rem] items-center justify-center rounded-full bg-rose-500 px-2 py-0.5 text-xs font-semibold leading-none text-white">
                            {merchantEnterpriseTodoCount > 99 ? "99+" : merchantEnterpriseTodoCount}
                          </span>
                        ) : null}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className={getMerchantDesktopMenuButtonClassName(
                        merchantDesktopSection === "support",
                        supportHasUnreadMessages ? "alert" : "default",
                      )}
                      onPointerEnter={() => {
                        void loadSupportMessageContent().catch(() => undefined);
                      }}
                      onFocus={() => {
                        void loadSupportMessageContent().catch(() => undefined);
                      }}
                      onClick={openMerchantSupportPanel}
                      aria-label={supportHasUnreadMessages ? "会话，有新消息" : "会话"}
                    >
                      <span className="relative inline-flex min-w-0 items-center gap-2">
                        <MerchantDesktopMenuIcon name="support" />
                        <span>会话</span>
                        {supportHasUnreadMessages ? (
                          <span
                            aria-hidden="true"
                            className="absolute -right-3 -top-1 h-2.5 w-2.5 rounded-full bg-rose-500 ring-2 ring-white"
                          />
                        ) : null}
                      </span>
                    </button>
                    {canUseMembershipManagement ? (
                      <button
                        type="button"
                        className={getMerchantDesktopMenuButtonClassName(merchantDesktopSection === "members")}
                        onPointerEnter={() => {
                          void loadMerchantMemberManager().catch(() => undefined);
                        }}
                        onFocus={() => {
                          void loadMerchantMemberManager().catch(() => undefined);
                        }}
                        onClick={() => {
                          void openMerchantMembersPanel();
                        }}
                      >
                        <span className="inline-flex min-w-0 items-center gap-2">
                          <MerchantDesktopMenuIcon name="members" />
                          <span>会员管理</span>
                        </span>
                      </button>
                    ) : null}
                    {canUseCouponModule ? (
                      <button
                        type="button"
                        className={getMerchantDesktopMenuButtonClassName(merchantDesktopCouponCenterActive)}
                        onPointerEnter={() => {
                          void loadMerchantCouponManager().catch(() => undefined);
                        }}
                        onFocus={() => {
                          void loadMerchantCouponManager().catch(() => undefined);
                        }}
                        onClick={() => openMerchantCouponsPanel()}
                        aria-current={merchantDesktopCouponCenterActive ? "page" : undefined}
                      >
                        <span className="inline-flex min-w-0 items-center gap-2">
                          <MerchantDesktopMenuIcon name="coupons" />
                          <span>优惠券</span>
                        </span>
                        {merchantVisibleCouponCount > 0 ? (
                          <span className="ml-2 inline-flex min-w-[1.5rem] items-center justify-center rounded-full bg-blue-50 px-2 py-0.5 text-xs font-semibold leading-none text-blue-700">
                            {merchantVisibleCouponCount > 99 ? "99+" : merchantVisibleCouponCount}
                          </span>
                        ) : null}
                      </button>
                    ) : null}
                    <div className="grid gap-[5px] pt-1">
                      <button
                        type="button"
                        className={getMerchantDesktopMenuButtonClassName(merchantDesktopOperationCenterActive)}
                        onClick={openMerchantBusinessCenterPanel}
                        aria-current={merchantDesktopOperationCenterActive ? "page" : undefined}
                      >
                        <span className="inline-flex min-w-0 items-center gap-2">
                          <MerchantDesktopMenuIcon name="business" />
                          <span>经营中心</span>
                        </span>
                      </button>
                    </div>
                </div>
              </div>
              </div>
              )
            ) : !merchantEditorOnly ? (
              <div className={toolbarActionsClassName}>
                <button
                  className={
                    isMobileMerchantEditorShell
                      ? merchantMobileToolbarButtonClassName
                      : "px-3 py-2 rounded border bg-white hover:bg-gray-50"
                  }
                  onClick={() => {
                    if (!isPlatformEditor) {
                      const missingFields = missingMerchantProfileFields;
                      if (missingFields.length > 0) {
                        setTopBarCollapsed(false);
                        triggerMerchantProfileAttention();
                        showTip(`请先完善商户信息后再去前台（缺少：${missingFields.join("、")}）`);
                        return;
                      }
                    }
                    const opened = window.open(effectiveFrontendHref, "_blank", "noopener,noreferrer");
                    if (!opened) {
                      showTip("浏览器拦截了新窗口，请允许弹窗后重试");
                    }
                  }}
                >
                  {"去前台"}
                </button>
                {!isPlatformEditor ? (
                  <button
                    ref={merchantProfileButtonRef}
                    className={
                      isMobileMerchantEditorShell
                        ? `${merchantMobileToolbarButtonClassName} ${
                            merchantProfileAttention
                              ? "border-rose-300 bg-rose-50 text-rose-700 shadow-[0_12px_28px_rgba(244,63,94,0.12)]"
                              : ""
                          }`
                        : `px-3 py-2 rounded border transition-colors ${
                            merchantProfileAttention
                              ? "border-rose-500 bg-rose-50 text-rose-700 hover:bg-rose-100"
                              : "bg-white hover:bg-gray-50"
                          }`
                    }
                    onClick={() => {
                      void openMerchantProfilePanel();
                    }}
                  >
                    {"商户信息"}
                  </button>
                ) : null}
                {!isPlatformEditor && canUseBookingBlock ? (
                  <button
                    className={
                      isMobileMerchantEditorShell
                        ? merchantMobileToolbarButtonClassName
                        : "px-3 py-2 rounded border bg-white hover:bg-gray-50 disabled:opacity-50"
                    }
                    onClick={() => setMerchantBookingManagerOpen(true)}
                    disabled={!editingSiteId}
                  >
                    {"预约管理"}
                  </button>
                ) : null}
                {canUseOrderManagement ? (
                  <button
                    className={
                      isMobileMerchantEditorShell
                        ? merchantMobileToolbarButtonClassName
                        : "px-3 py-2 rounded border bg-white hover:bg-gray-50 disabled:opacity-50"
                    }
                    onClick={() => setMerchantOrderManagerOpen(true)}
                    disabled={!editingSiteId}
                  >
                    {"订单管理"}
                  </button>
                ) : null}
                {canUseCouponModule ? (
                  <button
                    className={
                      isMobileMerchantEditorShell
                        ? merchantMobileToolbarButtonClassName
                        : "px-3 py-2 rounded border bg-white hover:bg-gray-50 disabled:opacity-50"
                    }
                    onClick={() => openMerchantCouponsPanel()}
                    disabled={!editingSiteId}
                  >
                    {"优惠券"}
                  </button>
                ) : null}
                {!isPlatformEditor ? (
                  <button
                    className={supportButtonClassName}
                    onClick={openSupportDialog}
                    aria-label={supportHasUnreadMessages ? "会话，有新消息" : "会话"}
                  >
                    <span className="relative inline-flex items-center">
                      {"会话"}
                      {supportHasUnreadMessages ? (
                        <span
                          aria-hidden="true"
                          className="absolute -right-3 -top-1 h-2.5 w-2.5 rounded-full bg-rose-500 ring-2 ring-white"
                        />
                      ) : null}
                    </span>
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        {!topBarCollapsed ? (
          isDesktopMerchantWorkspace ? (
            <div className="border-t border-blue-200/15 bg-[#16213a] shadow-[inset_0_1px_0_rgba(147,197,253,0.08),inset_0_18px_30px_rgba(0,0,0,0.10)]">
              <div className="w-full px-2 py-4">
                <div className="rounded-xl border border-blue-200/10 bg-[#111c32] px-2 py-2">
                  {merchantDesktopPointRedemptionCenterActive && canUsePointsRedemption ? (
                    <div className="grid gap-2">
                      <button
                        type="button"
                        className={getMerchantDesktopSubmenuButtonClassName(merchantDesktopSection === "redemptionRecords")}
                        onClick={() => void openMerchantRedemptionRecordsPanel()}
                      >
                        兑换记录
                      </button>
                      <button
                        type="button"
                        className={getMerchantDesktopSubmenuButtonClassName(merchantDesktopSection === "rechargeRecords")}
                        onClick={() => void openMerchantRechargeRecordsPanel()}
                      >
                        充值记录
                      </button>
                      <button
                        type="button"
                        className={getMerchantDesktopSubmenuButtonClassName(merchantDesktopSection === "redemptionCategories")}
                        onClick={() => void openMerchantPointRedemptionSettingsPanel("redemptionCategories")}
                      >
                        项目分类
                      </button>
                      <button
                        type="button"
                        className={getMerchantDesktopSubmenuButtonClassName(merchantDesktopSection === "redemptionItems")}
                        onClick={() => void openMerchantPointRedemptionSettingsPanel("redemptionItems")}
                      >
                        项目管理
                      </button>
                    </div>
                  ) : merchantDesktopSection === "booking" ? (
                    <div className="grid gap-2">
                      <button
                        type="button"
                        className={getMerchantDesktopSubmenuButtonClassName(merchantBookingWorkbenchOpen, "amber")}
                        onClick={() => setMerchantBookingWorkbenchOpen(true)}
                        aria-pressed={merchantBookingWorkbenchOpen}
                      >
                        预约工作台
                      </button>
                    </div>
                  ) : merchantDesktopSection === "orders" ? (
                    <div className="grid gap-2">
                      <button
                        type="button"
                        className={getMerchantDesktopSubmenuButtonClassName(merchantOrderWorkbenchOpen, "amber")}
                        onClick={() => setMerchantOrderWorkbenchOpen(true)}
                        aria-pressed={merchantOrderWorkbenchOpen}
                      >
                        订单工作台
                      </button>
                    </div>
                  ) : merchantDesktopSection === "enterprise" && canUseEnterpriseManagement ? (
                    <nav
                      id="merchant-enterprise-context-menu"
                      aria-label="企业管理子菜单"
                      className="grid gap-2"
                    >
                      {MERCHANT_ENTERPRISE_CONTEXT_MENU_ITEMS
                        .filter((item) => merchantEnterpriseAvailableViews.includes(item.view))
                        .map((item) => (
                          <button
                            key={item.view}
                            type="button"
                            className={getMerchantDesktopSubmenuButtonClassName(
                              merchantEnterpriseView === item.view,
                            )}
                            onClick={() => void openMerchantEnterprisePanel(item.view)}
                            aria-current={merchantEnterpriseView === item.view ? "page" : undefined}
                          >
                            <span className="inline-flex w-full items-center justify-between gap-2">
                              <span>{item.label}</span>
                              {item.view === "todos" && merchantEnterpriseTodoCount > 0 ? (
                                <span className="inline-flex min-w-[1.4rem] items-center justify-center rounded-full bg-rose-500 px-1.5 py-0.5 text-[11px] font-semibold leading-none text-white">
                                  {merchantEnterpriseTodoCount > 99 ? "99+" : merchantEnterpriseTodoCount}
                                </span>
                              ) : null}
                            </span>
                          </button>
                        ))}
                      {merchantEnterpriseAvailableViews.length === 0 ? (
                        <div className="px-3 py-2 text-xs leading-5 text-[#8fa39b]">
                          正在验证企业功能权限…
                        </div>
                      ) : merchantEnterpriseAvailableViews.length === 1 ? (
                        <div className="px-3 py-2 text-xs leading-5 text-[#8fa39b]">
                          当前账号仅可访问企业工作台。
                        </div>
                      ) : null}
                    </nav>
                  ) : merchantDesktopCouponCenterActive ? (
                    <div className="grid gap-2">
                      <button
                        type="button"
                        className={getMerchantDesktopSubmenuButtonClassName(merchantDesktopSection === "couponRedeemWorkbench", "rose")}
                        onClick={() => openMerchantCouponsPanel("couponRedeemWorkbench")}
                      >
                        核销工作台
                      </button>
                      <button
                        type="button"
                        className={getMerchantDesktopSubmenuButtonClassName(merchantDesktopSection === "couponClaims", "rose")}
                        onClick={() => openMerchantCouponsPanel("couponClaims")}
                      >
                        领取记录
                      </button>
                      <button
                        type="button"
                        className={getMerchantDesktopSubmenuButtonClassName(merchantDesktopSection === "couponRedemptions", "rose")}
                        onClick={() => openMerchantCouponsPanel("couponRedemptions")}
                      >
                        核销记录
                      </button>
                      <button
                        type="button"
                        className={getMerchantDesktopSubmenuButtonClassName(merchantDesktopSection === "couponDailyStats", "rose")}
                        onClick={() => openMerchantCouponsPanel("couponDailyStats")}
                      >
                        日报统计
                      </button>
                    </div>
                  ) : merchantDesktopOperationCenterActive ? (
                    <div className="grid gap-2">
                      <button
                        ref={merchantProfileButtonRef}
                        type="button"
                        className={getMerchantDesktopSubmenuButtonClassName(merchantDesktopSection === "profile")}
                        onClick={() => {
                          void openMerchantProfilePanel();
                        }}
                      >
                        商户信息
                      </button>
                      <button
                        type="button"
                        className={getMerchantDesktopSubmenuButtonClassName(merchantDesktopSection === "cards", "cyan")}
                        onPointerEnter={() => {
                          void loadMerchantBusinessCardManager().catch(() => undefined);
                        }}
                        onFocus={() => {
                          void loadMerchantBusinessCardManager().catch(() => undefined);
                        }}
                        onClick={openMerchantCardsPanel}
                      >
                        <span>名片夹</span>
                        <span className="min-w-8 rounded-full bg-blue-50 px-2 py-0.5 text-center text-[11px] font-bold text-blue-700 ring-1 ring-blue-100">
                          {merchantBusinessCardCount}
                        </span>
                      </button>
                      <button
                        type="button"
                        className={getMerchantDesktopSubmenuButtonClassName(merchantDesktopSection === "customers")}
                        onPointerEnter={() => {
                          void loadMerchantCustomerManager().catch(() => undefined);
                        }}
                        onFocus={() => {
                          void loadMerchantCustomerManager().catch(() => undefined);
                        }}
                        onClick={openMerchantCustomersPanel}
                      >
                        客户管理
                      </button>
                      <button
                        type="button"
                        className={getMerchantDesktopSubmenuButtonClassName(merchantDesktopSection === "pollStats")}
                        onPointerEnter={() => {
                          void loadMerchantPollStatsPanel().catch(() => undefined);
                        }}
                        onFocus={() => {
                          void loadMerchantPollStatsPanel().catch(() => undefined);
                        }}
                        onClick={() => void openMerchantPollStatsPanel()}
                      >
                        投票统计
                      </button>
                      <button
                        type="button"
                        className={getMerchantDesktopSubmenuButtonClassName(merchantDesktopSection === "logs")}
                        onClick={openMerchantLogsPanel}
                      >
                        日志
                      </button>
                      <button
                        type="button"
                        className={getMerchantDesktopSubmenuButtonClassName(merchantDesktopSection === "printer")}
                        onPointerEnter={() => {
                          void loadMerchantPrintSettingsPanel().catch(() => undefined);
                        }}
                        onFocus={() => {
                          void loadMerchantPrintSettingsPanel().catch(() => undefined);
                        }}
                        onClick={openMerchantPrintPanel}
                      >
                        打印机
                      </button>
                      <button
                        type="button"
                        className={getMerchantDesktopSubmenuButtonClassName(false)}
                        onClick={() => {
                          void openMerchantEditorInNewWindow();
                        }}
                      >
                        <span>网站编辑</span>
                        <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 opacity-80" fill="none" aria-hidden="true">
                          <path d="M14 5h5v5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                          <path d="M10 14 19 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                          <path d="M19 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </button>
                    </div>
                  ) : merchantDesktopSection === "members" && canUseMembershipManagement ? (
                    <div className="grid gap-2">
                        {MERCHANT_MEMBER_CONTEXT_MENU_ITEMS.map((item) => (
                          <button
                            key={item.view}
                            type="button"
                            className={getMerchantDesktopSubmenuButtonClassName(merchantMemberSettingsView === item.view)}
                            onClick={() => void openMerchantMemberSettingsPanel(item.view)}
                          >
                            {item.label}
                          </button>
                        ))}
                      </div>
                  ) : (
                    <>
                      <div className="px-3 text-[13px] font-semibold text-[#b9c8c3]">
                        {merchantDesktopSection === "faolla" ? "Faolla" : "会话"}
                      </div>
                      <div className="mt-1 px-3 text-xs leading-5 text-[#8fa39b]">
                        {merchantDesktopSection === "faolla"
                          ? "打开 Faolla 总站或登录前访问的前台页面。"
                          : "这里集中处理官方客服和商户聊天消息。"}
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          ) : (
          <>
            <div className={isMobileMerchantEditorShell ? "border-t border-white/70" : "border-t"}>
              <div
                className={
                  isMobileMerchantEditorShell
                    ? "mx-auto max-w-[460px] px-4 py-4"
                    : "max-w-6xl mx-auto px-6 py-3 lg:mx-0 lg:max-w-none lg:px-4 lg:py-4"
                }
              >
                <div
                  className={
                    isMobileMerchantEditorShell
                      ? "grid gap-4"
                      : "flex items-center gap-2 flex-wrap lg:flex-col lg:items-stretch lg:gap-4"
                  }
                >
                  <div
                    className={
                      isMobileMerchantEditorShell
                        ? `${merchantMobileToolbarCardClassName} grid gap-3`
                        : "flex items-center gap-2 flex-wrap lg:flex-col lg:items-stretch"
                    }
                  >
                    {isMobileMerchantEditorShell ? (
                      <div className={merchantMobileToolbarSectionLabelClassName}>页面设置</div>
                    ) : null}
                    {isPlatformEditor ? (
                      <button
                        type="button"
                        className={
                          isMobileMerchantEditorShell
                            ? merchantMobileToolbarButtonClassName
                            : "rounded border bg-white px-3 py-2 text-sm hover:bg-gray-50 lg:w-full"
                        }
                        onClick={() => setPlanTemplateDialogOpen(true)}
                      >
                        方案模板
                      </button>
                    ) : null}
                    <select
                      className={
                        isMobileMerchantEditorShell
                          ? merchantMobileToolbarSelectClassName
                          : "min-w-[140px] rounded border bg-white p-2 text-slate-900 lg:w-full"
                      }
                      value={editingPlanId}
                      onChange={(e) => switchEditingPlan(e.target.value as PlanId)}
                      title="选择要编辑的方案"
                    >
                      {planConfig.plans.map((plan, index) => {
                        const locked = !isPlatformEditor && index + 1 > merchantPlanLimit;
                        return (
                          <option key={plan.id} value={plan.id} disabled={locked}>
                            {"编辑"}{plan.name}{locked ? "（未开通）" : ""}
                          </option>
                        );
                      })}
                    </select>
                    {isMobileMerchantEditorShell ? (
                      <>
                        <select
                          className={merchantMobileToolbarSelectClassName}
                          value={editingPageId}
                          onChange={(e) => switchEditingPage(e.target.value)}
                          title="选择要编辑的页面"
                        >
                          {editingPages.map((page) => (
                            <option key={page.id} value={page.id}>
                              {toPlainText(page.name, page.id)}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          className={merchantMobileToolbarButtonClassName}
                          onClick={openPageCopyDialog}
                        >
                          复制
                        </button>
                      </>
                    ) : (
                      <div className="grid w-full min-w-0 grid-cols-[minmax(0,1fr)_72px] items-center gap-2">
                        <select
                          className="w-full min-w-0 rounded border bg-white p-2 text-slate-900"
                          value={editingPageId}
                          onChange={(e) => switchEditingPage(e.target.value)}
                          title="选择要编辑的页面"
                        >
                          {editingPages.map((page) => (
                            <option key={page.id} value={page.id}>
                              {toPlainText(page.name, page.id)}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          className="rounded border bg-white px-3 py-2 text-sm hover:bg-gray-50"
                          onClick={openPageCopyDialog}
                        >
                          复制
                        </button>
                      </div>
                    )}
                  </div>

                  <div
                    className={
                      isMobileMerchantEditorShell
                        ? `${merchantMobileToolbarCardClassName} grid gap-3`
                        : "flex items-center gap-2 flex-wrap lg:flex-col lg:items-stretch"
                    }
                  >
                    {isMobileMerchantEditorShell ? (
                      <div className={merchantMobileToolbarSectionLabelClassName}>预览视图</div>
                    ) : null}
                    <div className={isMobileMerchantEditorShell ? merchantMobileToolbarSegmentClassName : "inline-flex items-center rounded border overflow-hidden lg:w-full"}>
                      <button
                        type="button"
                        className={
                          isMobileMerchantEditorShell
                            ? `${merchantMobileToolbarSegmentButtonBaseClassName} ${
                                previewViewport === "desktop" ? "bg-slate-950 text-white shadow-sm" : "bg-transparent text-slate-600 hover:bg-white"
                              }`
                            : `px-3 py-2 text-sm lg:flex-1 ${previewViewport === "desktop" ? "bg-black text-white" : "bg-white hover:bg-gray-50"}`
                        }
                        onClick={() => switchPreviewViewport("desktop")}
                      >
                        PC
                      </button>
                      <button
                        type="button"
                        className={
                          isMobileMerchantEditorShell
                            ? `${merchantMobileToolbarSegmentButtonBaseClassName} ${
                                previewViewport === "mobile" ? "bg-slate-950 text-white shadow-sm" : "bg-transparent text-slate-600 hover:bg-white"
                              }`
                            : `px-3 py-2 text-sm border-l lg:flex-1 ${previewViewport === "mobile" ? "bg-black text-white" : "bg-white hover:bg-gray-50"}`
                        }
                        onClick={() => switchPreviewViewport("mobile")}
                      >
                        手机
                      </button>
                    </div>
                    <div className={isMobileMerchantEditorShell ? "grid grid-cols-2 gap-3" : "flex items-center gap-2 flex-wrap lg:grid lg:grid-cols-2"}>
                      <button
                        className={
                          isMobileMerchantEditorShell
                            ? merchantMobileToolbarButtonClassName
                            : "px-2 py-2 rounded border bg-white hover:bg-gray-50 text-xs lg:w-full"
                        }
                        onClick={() => copySelectedBlockStyleToViewport("mobile")}
                        title="将当前选中区块样式复制到手机端"
                      >
                        {"样式->手机"}
                      </button>
                      <button
                        className={
                          isMobileMerchantEditorShell
                            ? merchantMobileToolbarButtonClassName
                            : "px-2 py-2 rounded border bg-white hover:bg-gray-50 text-xs lg:w-full"
                        }
                        onClick={() => copySelectedBlockStyleToViewport("desktop")}
                        title="将当前选中区块样式复制到PC端"
                      >
                        {"样式->PC"}
                      </button>
                    </div>
                    {previewViewport === "mobile" ? (
                      <button
                        type="button"
                        className={
                          isMobileMerchantEditorShell
                            ? merchantMobileToolbarButtonClassName
                            : "hidden lg:block px-3 py-2 rounded border bg-white hover:bg-gray-50 text-sm"
                        }
                        onClick={() => void readDesktopIntoMobile()}
                      >
                        读取PC
                      </button>
                    ) : null}
                  </div>

                  <div
                    className={
                      isMobileMerchantEditorShell
                        ? `${merchantMobileToolbarCardClassName} grid grid-cols-3 gap-3`
                        : "flex items-center gap-2 flex-wrap lg:grid lg:grid-cols-3"
                    }
                  >
                    {isMobileMerchantEditorShell ? (
                      <div className={`col-span-3 ${merchantMobileToolbarSectionLabelClassName}`}>编辑历史</div>
                    ) : null}
                    <button
                      className={
                        isMobileMerchantEditorShell
                          ? merchantMobileToolbarIconButtonClassName.replace("bg-white", "bg-slate-950").replace("text-slate-900", "text-white")
                          : "px-3 py-2 rounded bg-black text-white disabled:opacity-50 lg:w-full"
                      }
                      onClick={saveDraft}
                      title="保存草稿"
                      aria-label="保存草稿"
                    >
                      <svg viewBox="0 0 24 24" className="h-5 w-5 mx-auto" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                        <path d="M5 4h12l2 2v14H5z" />
                        <path d="M8 4v6h8V4" />
                        <path d="M8 18h8" />
                      </svg>
                    </button>
                    <button
                      className={
                        isMobileMerchantEditorShell
                          ? merchantMobileToolbarIconButtonClassName
                          : "px-3 py-2 rounded border bg-white hover:bg-gray-50 disabled:opacity-50 lg:w-full"
                      }
                      onClick={undoEdit}
                      disabled={!canUndo}
                      title="撤销"
                      aria-label="撤销"
                    >
                      <svg viewBox="0 0 24 24" className="h-5 w-5 mx-auto" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                        <path d="M9 8 5 12l4 4" />
                        <path d="M6 12h8a5 5 0 0 1 0 10h-1" />
                      </svg>
                    </button>
                    <button
                      className={
                        isMobileMerchantEditorShell
                          ? merchantMobileToolbarIconButtonClassName
                          : "px-3 py-2 rounded border bg-white hover:bg-gray-50 disabled:opacity-50 lg:w-full"
                      }
                      onClick={redoEdit}
                      disabled={!canRedo}
                      title="重复"
                      aria-label="重复"
                    >
                      <svg viewBox="0 0 24 24" className="h-5 w-5 mx-auto" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                        <path d="m15 8 4 4-4 4" />
                        <path d="M18 12h-8a5 5 0 0 0 0 10h1" />
                      </svg>
                    </button>
                  </div>

                  <div
                    className={
                      isMobileMerchantEditorShell
                        ? `${merchantMobileToolbarCardClassName} grid gap-3`
                        : "flex items-center gap-2 flex-wrap lg:flex-col lg:items-stretch"
                    }
                  >
                    {isMobileMerchantEditorShell ? (
                      <div className={merchantMobileToolbarSectionLabelClassName}>页面风格</div>
                    ) : null}
                    <div className={isMobileMerchantEditorShell ? "grid grid-cols-2 gap-3" : "grid gap-2 lg:grid-cols-2"}>
                      <button
                        className={
                          isMobileMerchantEditorShell
                            ? `${merchantMobileToolbarButtonClassName} ${
                                canUseInsertBackground ? "" : "bg-gray-100 text-gray-400 cursor-not-allowed"
                              }`
                            : `px-3 py-2 rounded border lg:w-full ${
                                canUseInsertBackground ? "bg-white hover:bg-gray-50" : "bg-gray-100 text-gray-400 cursor-not-allowed"
                              }`
                        }
                        onClick={canUseInsertBackgroundByPermission ? insertPageImage : undefined}
                        disabled={!canUseInsertBackgroundByPermission}
                        title={!canUseInsertBackgroundByPermission ? "当前权限未开通插入背景" : undefined}
                      >
                        {"插入背景"}
                      </button>
                      <button
                        className={
                          isMobileMerchantEditorShell
                            ? merchantMobileToolbarButtonClassName
                            : "px-3 py-2 rounded border bg-white hover:bg-gray-50 lg:w-full"
                        }
                        onClick={() => void editPageImageSettings()}
                      >
                        {"背景参数"}
                      </button>
                    </div>
                    <select
                      className={
                        isMobileMerchantEditorShell
                          ? `${merchantMobileToolbarSelectClassName} ${
                              canUseThemeEffects ? "" : "bg-gray-100 text-gray-400 cursor-not-allowed"
                            }`
                          : `min-w-[130px] rounded border p-2 lg:w-full ${
                              canUseThemeEffects ? "bg-white text-slate-900" : "bg-gray-100 text-gray-400 cursor-not-allowed"
                            }`
                      }
                      value={themePreset}
                      disabled={!canUseThemeEffects}
                      title={!canUseThemeEffects ? "当前权限未开通主题效果" : "风格"}
                      onChange={(e) => {
                        const nextPreset = e.target.value as ThemePresetKey;
                        const previousPreset = themePreset;
                        setThemePreset(nextPreset);
                        void applyThemePresetToCurrentPage(nextPreset, previousPreset);
                      }}
                      >
                      {THEME_PRESET_OPTIONS.map((item) => (
                        <option key={item.value} value={item.value}>
                          {item.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div
                    className={
                      isMobileMerchantEditorShell
                        ? `${merchantMobileToolbarCardClassName} grid gap-3`
                        : "flex flex-col gap-2"
                    }
                  >
                    {isMobileMerchantEditorShell ? (
                      <div className={merchantMobileToolbarSectionLabelClassName}>新增区块</div>
                    ) : null}
                    <div className={isMobileMerchantEditorShell ? "grid grid-cols-[minmax(0,1fr)_72px] items-start gap-3" : "grid w-full grid-cols-[minmax(0,1fr)_56px] items-start gap-2"}>
                      <select
                        className={
                          isMobileMerchantEditorShell
                            ? merchantMobileToolbarSelectClassName
                            : "min-w-0 w-full rounded border bg-white p-2 text-slate-900"
                        }
                        value={newBlockType}
                        onChange={(e) => setNewBlockType(e.target.value as Block["type"])}
                      >
                        <option value="common">{"通用"}</option>
                        <option value="button" disabled={!canUseButtonBlock}>{"按钮"}{!canUseButtonBlock ? "（未开通）" : ""}</option>
                        <option value="gallery" disabled={!canUseGalleryBlock}>{"相册"}{!canUseGalleryBlock ? "（未开通）" : ""}</option>
                        <option value="chart">{"图表"}</option>
                        <option value="nav">{"导航"}</option>
                        <option value="music" disabled={!canUseMusicBlock}>{"音乐"}{!canUseMusicBlock ? "（未开通）" : ""}</option>
                        <option value="product" disabled={!canUseProductBlock}>{"产品"}{!canUseProductBlock ? "（未开通）" : ""}</option>
                        <option value="coupon" disabled={!canUseCouponBlock}>{"优惠券"}{!canUseCouponBlock ? "（未开通）" : ""}</option>
                        <option value="google-reviews">{"Google 评论"}</option>
                        <option value="poll">{"投票"}</option>
                        <option value="booking" disabled={!canUseBookingBlock || isBookingBlockAddLocked}>
                          {"预约"}
                          {!canUseBookingBlock ? "（未开通）" : isBookingBlockAddLocked ? "（已存在）" : ""}
                        </option>
                        <option value="contact">{"联系方式"}</option>
                        {isPlatformEditor ? <option value="search-bar">{"搜索"}</option> : null}
                        {isPlatformEditor ? <option value="merchant-list">{"商户列表"}</option> : null}
                      </select>
                      <div className="relative">
                        <button
                          className={
                            isMobileMerchantEditorShell
                              ? `${merchantMobileToolbarIconButtonClassName} ${
                                  isCurrentBlockTypeLocked ? "bg-gray-100 text-gray-400 cursor-not-allowed" : ""
                                }`
                              : `px-3 py-2 rounded border w-full ${
                                  isCurrentBlockTypeLocked ? "bg-gray-100 text-gray-400 cursor-not-allowed" : "bg-white hover:bg-gray-50"
                                }`
                          }
                          onClick={addBlock}
                          title="新增区块"
                          aria-label="新增区块"
                          disabled={isCurrentBlockTypeLocked}
                        >
                          <svg viewBox="0 0 24 24" className="h-5 w-5 mx-auto" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                            <path d="M12 5v14" />
                            <path d="M5 12h14" />
                          </svg>
                        </button>
                        {showAddBlockGuide ? (
                          <div className="absolute left-1/2 top-full z-20 mt-2 -translate-x-1/2 animate-pulse">
                            <div className="relative whitespace-nowrap rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 shadow-sm">
                              <span className="font-medium">在此处增加区块</span>
                              <span className="absolute left-1/2 -top-2 -translate-x-1/2 block w-0 h-0 border-l-[6px] border-r-[6px] border-b-[8px] border-l-transparent border-r-transparent border-b-amber-200" />
                              <span className="absolute left-1/2 -top-[7px] -translate-x-1/2 block w-0 h-0 border-l-[5px] border-r-[5px] border-b-[7px] border-l-transparent border-r-transparent border-b-amber-50" />
                            </div>
                          </div>
                        ) : null}
                      </div>
                      <input
                        ref={pageImageInputRef}
                        className="hidden"
                        type="file"
                        accept="image/*"
                        onChange={handlePageImageUpload}
                      />
                    </div>
                  </div>

                  {shouldShowPublishActions ? (
                    <>
                      <div
                        className={
                          isMobileMerchantEditorShell
                            ? `${merchantMobileToolbarCardClassName} grid gap-3`
                            : "flex items-center gap-2 flex-wrap lg:flex-col lg:items-stretch"
                        }
                      >
                        {isMobileMerchantEditorShell ? (
                          <div className={merchantMobileToolbarSectionLabelClassName}>发布操作</div>
                        ) : null}
                        <div className={publishActionsClassName}>
                          <button
                            className={
                              isMobileMerchantEditorShell
                                ? merchantMobileToolbarButtonClassName
                                : "px-3 py-2 rounded border bg-white hover:bg-gray-50"
                            }
                            onClick={rollbackToLastSuccessfulPublished}
                          >
                            {"回滚发布"}
                          </button>
                          <button
                            className={
                              isMobileMerchantEditorShell
                                ? merchantMobileToolbarButtonClassName
                                : "px-3 py-2 rounded border bg-white hover:bg-gray-50"
                            }
                            onClick={restoreLatestSavedDraft}
                          >
                            {"恢复草稿"}
                          </button>
                          <button
                            className={
                              isMobileMerchantEditorShell
                                ? "col-span-2 min-h-[52px] rounded-[22px] bg-slate-950 px-4 py-3 text-[15px] font-semibold text-white shadow-[0_18px_40px_rgba(15,23,42,0.18)] disabled:opacity-50"
                                : `px-3 py-2 rounded bg-black text-white disabled:opacity-50 ${shouldUseDesktopEditorSidebar ? "col-span-2" : ""}`
                            }
                            onClick={publishToFrontend}
                            disabled={
                              publishing ||
                              (!isPlatformEditor && !getSiteIdFromStoreScope(storeScope).trim())
                            }
                            title={
                              !isPlatformEditor && !getSiteIdFromStoreScope(storeScope).trim()
                                ? "缺少 site-xxx 作用域，暂不可发布"
                                : undefined
                            }
                          >
                            {publishing ? "发布中..." : "发布"}
                          </button>
                        </div>
                        {!isMobileMerchantEditorShell ? (
                          <button
                            type="button"
                            className="rounded border bg-white px-3 py-2 text-sm hover:bg-gray-50"
                            onClick={() => {
                              const missingFields = missingMerchantProfileFields;
                              if (missingFields.length > 0) {
                                setTopBarCollapsed(false);
                                triggerMerchantProfileAttention();
                                showTip(`请先完善商户信息后再去前台（缺少：${missingFields.join("、")}）`);
                                return;
                              }
                              const opened = window.open(effectiveFrontendHref, "_blank", "noopener,noreferrer");
                              if (!opened) {
                                showTip("浏览器拦截了新窗口，请允许弹窗后重试");
                              }
                            }}
                          >
                            去前台
                          </button>
                        ) : null}
                      </div>
                    </>
                  ) : null}
                </div>
              </div>
            </div>
            {previewViewport === "mobile" && !isMobileMerchantEditorShell ? (
              <div className="border-t lg:hidden">
                <div className="max-w-6xl mx-auto px-6 py-2">
                  <button
                    type="button"
                    className="px-3 py-2 rounded border bg-white hover:bg-gray-50 text-sm"
                    onClick={() => void readDesktopIntoMobile()}
                  >
                    读取PC
                  </button>
                </div>
              </div>
            ) : null}
          </>
          )
        ) : null}
      </div>

      {desktopMerchantWorkspaceContent ? (
        desktopMerchantWorkspaceContent
      ) : previewViewport === "mobile" ? (
        <div
          className={
            isMobileMerchantEditorShell
              ? "min-h-screen pb-[calc(var(--faolla-mobile-safe-bottom)+2rem)] pt-5"
              : "min-h-screen bg-gray-200 py-6"
          }
        >
          <div
            className={
              isMobileMerchantEditorShell
                ? "mx-auto flex w-full max-w-[460px] flex-col items-center gap-6 px-4"
                : "mx-auto flex w-full max-w-[1280px] items-start justify-center gap-20 px-3 lg:mx-0 lg:max-w-[980px] lg:justify-start lg:gap-12 lg:px-4"
            }
          >
            <div className="hidden lg:block w-[422px] shrink-0">
              <div className="sticky" style={{ top: `${Math.max(topBarHeight + 16, 72)}px` }}>
                <div className="rounded-[36px] border-8 border-gray-900 bg-black p-2 shadow-2xl">
                  <div
                    className="relative rounded-[28px] overflow-hidden min-h-[780px]"
                    style={{ ...pageBackgroundStyle, paddingBottom: `${mobileFrontendPreviewPadding}px` }}
                  >
                    <div className="editor-mobile-preview relative z-10 w-full py-4">
                      <div data-editor-viewport-boundary className="contents">
                        <BlockRenderer
                          blocks={blocks}
                          currentPageId={editingPageId}
                          currentPageIndex={editingPageIndex}
                          availablePages={editorAvailablePages}
                          forceMobileViewport
                          bookingSiteId={editingSiteId || ""}
                          bookingSiteName={merchantDisplayName}
                          productCartEnabled={canUseOrderManagement}
                          bookingInteractive={false}
                          onNavigatePage={(pageId) => {
                            if (editingPages.some((page) => page.id === pageId)) switchEditingPage(pageId);
                          }}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div className={isMobileMerchantEditorShell ? "w-full max-w-[422px]" : "w-full max-w-[422px] px-1"}>
              <div className="rounded-[36px] border-8 border-gray-900 bg-black p-2 shadow-2xl">
                <div
                  ref={backgroundLayerRef}
                  data-no-translate="1"
                  className="relative rounded-[28px] overflow-visible"
                  style={{ minHeight: `${Math.max(backgroundLayerMinHeight, 780)}px` }}
                >
                  <div className="absolute inset-0 rounded-[28px] overflow-hidden pointer-events-none" style={pageBackgroundStyle} />
                  <div className="relative z-10 w-full py-4">
                    <div data-editor-viewport-boundary className="space-y-0">
                      {blocks.map((block, index) => {
                        const sourceIndex = resizePreview ? blocks.findIndex((item) => item.id === resizePreview.blockId) : -1;
                        const previewOffsetY = sourceIndex >= 0 && index > sourceIndex ? -resizePreview!.heightDelta : 0;
                        const wrapperStackOrder =
                          draggingBlockId === block.id
                            ? 1_000_000
                            : block.id === selectedId
                              ? 999_999
                              : getBlockRenderStackOrder(block, index, blocks.length);
                        return (
                          <div key={block.id} className="relative" style={{ zIndex: wrapperStackOrder }}>
                            <MemoizedInlineEditorBlock
                              block={block}
                              publicBlockId={buildPublicBlockId(editingPageIndex, index)}
                              draggingBlockId={draggingBlockId}
                              isSelected={block.id === selectedId}
                              onDragHandleMouseDown={(point) => startDraggingBlock(block.id, point)}
                              onNudge={(dx, dy) => nudgeBlock(block.id, dx, dy)}
                              onLayerToFront={() => moveBlockToLayerEdge(block.id, "front")}
                              onLayerUp={() => moveBlockLayerByOne(block.id, "up")}
                              onLayerDown={() => moveBlockLayerByOne(block.id, "down")}
                              onLayerToBack={() => moveBlockToLayerEdge(block.id, "back")}
                              onSelect={() => setSelectedId(block.id)}
                              onChange={(patch) => updateBlockProps(block.id, patch)}
                              onResizePreview={(heightDelta) => previewResizeWithoutAffectingOthers(block.id, heightDelta)}
                              onResizeCommit={(patch, heightDelta) => resizeBlockWithoutAffectingOthers(block.id, patch, heightDelta)}
                              previewOffsetY={previewOffsetY}
                              onDelete={() => void deleteBlock(block.id)}
                              onAlert={(message) => {
                                void openAlert(message);
                              }}
                              availablePages={editorAvailablePages}
                              availableBlocks={editorAvailableBlocks}
                              currentPageId={editingPageId}
                              maxNavItems={merchantPageLimit}
                              recentColors={recentColors}
                              onRecordColor={recordRecentColor}
                              onClearRecentColors={clearRecentColors}
                              onApplyNavSettingsToOtherPages={applyNavSettingsToOtherPages}
                              onPersistImageFile={persistImageFileForEditor}
                              onPersistProductImageFile={persistProductImageFileForEditor}
                              onPersistAudioFile={persistAudioFileForEditor}
                              previewViewport={previewViewport}
                              runtimeSiteId={editingSiteId || ""}
                              runtimeSiteName={merchantDisplayName}
                              merchantCouponRecords={merchantCouponRecords}
                              onOpenMerchantCoupons={openMerchantCouponsPanel}
                              europeLocationOptionsApi={europeLocationOptionsApi}
                              onGoogleBusinessProfileRequest={requestMerchantChatWithSessionRecovery}
                            />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div
          ref={backgroundLayerRef}
          data-no-translate="1"
          className="min-h-screen"
          style={{ ...pageBackgroundStyle, minHeight: `${Math.max(backgroundLayerMinHeight, 0)}px` }}
        >
          <div className="max-w-6xl mx-auto px-6 py-6">
            <div data-editor-viewport-boundary className="space-y-0">
              {blocks.map((block, index) => {
                const sourceIndex = resizePreview ? blocks.findIndex((item) => item.id === resizePreview.blockId) : -1;
                const previewOffsetY = sourceIndex >= 0 && index > sourceIndex ? -resizePreview!.heightDelta : 0;
                const wrapperStackOrder =
                  draggingBlockId === block.id
                    ? 1_000_000
                    : block.id === selectedId
                      ? 999_999
                      : getBlockRenderStackOrder(block, index, blocks.length);
                return (
                  <div key={block.id} className="relative" style={{ zIndex: wrapperStackOrder }}>
                    <MemoizedInlineEditorBlock
                      block={block}
                      publicBlockId={buildPublicBlockId(editingPageIndex, index)}
                      draggingBlockId={draggingBlockId}
                      isSelected={block.id === selectedId}
                      onDragHandleMouseDown={(point) => startDraggingBlock(block.id, point)}
                      onNudge={(dx, dy) => nudgeBlock(block.id, dx, dy)}
                      onLayerToFront={() => moveBlockToLayerEdge(block.id, "front")}
                      onLayerUp={() => moveBlockLayerByOne(block.id, "up")}
                      onLayerDown={() => moveBlockLayerByOne(block.id, "down")}
                      onLayerToBack={() => moveBlockToLayerEdge(block.id, "back")}
                      onSelect={() => setSelectedId(block.id)}
                      onChange={(patch) => updateBlockProps(block.id, patch)}
                      onResizePreview={(heightDelta) => previewResizeWithoutAffectingOthers(block.id, heightDelta)}
                      onResizeCommit={(patch, heightDelta) => resizeBlockWithoutAffectingOthers(block.id, patch, heightDelta)}
                      previewOffsetY={previewOffsetY}
                      onDelete={() => void deleteBlock(block.id)}
                      onAlert={(message) => {
                        void openAlert(message);
                      }}
                      availablePages={editorAvailablePages}
                      availableBlocks={editorAvailableBlocks}
                      currentPageId={editingPageId}
                      maxNavItems={merchantPageLimit}
                      recentColors={recentColors}
                      onRecordColor={recordRecentColor}
                      onClearRecentColors={clearRecentColors}
                      onApplyNavSettingsToOtherPages={applyNavSettingsToOtherPages}
                      onPersistImageFile={persistImageFileForEditor}
                      onPersistProductImageFile={persistProductImageFileForEditor}
                      onPersistAudioFile={persistAudioFileForEditor}
                      previewViewport={previewViewport}
                      runtimeSiteId={editingSiteId || ""}
                      runtimeSiteName={merchantDisplayName}
                      merchantCouponRecords={merchantCouponRecords}
                      onOpenMerchantCoupons={openMerchantCouponsPanel}
                      europeLocationOptionsApi={europeLocationOptionsApi}
                      onGoogleBusinessProfileRequest={requestMerchantChatWithSessionRecovery}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {pageImageDialogOpen
        ? renderTopMostOverlay(
        <div className="fixed inset-0 z-[2147483000] bg-black/40 flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-white rounded-xl border p-4 space-y-3" onMouseDown={(event) => event.stopPropagation()}>
            <div className="text-sm font-semibold">{"插入背景"}</div>
            <div className="space-y-1">
              <div className="text-xs text-gray-600">图片 URL</div>
              <input
                className="border p-2 rounded w-full text-sm"
                value={pageImageUrlInput}
                placeholder={
                  isInlineDataImageUrl(blocks[0]?.props.pageBgImageUrl ?? "")
                    ? "当前背景已上传，可重新上传或填写图片 URL"
                    : "https://example.com/bg.jpg"
                }
                onChange={(e) => setPageImageUrlInput(e.target.value)}
                disabled={editorUploadBusy}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <label
                className={`px-3 py-2 rounded border bg-white text-sm ${
                  editorUploadBusy ? "cursor-wait opacity-60" : "cursor-pointer hover:bg-gray-50"
                }`}
              >
                {editorUploadBusy ? "正在上传..." : "上传背景"}
                <input
                  className="hidden"
                  type="file"
                  accept="image/*"
                  disabled={editorUploadBusy}
                  onChange={handlePageImageUpload}
                />
              </label>
              <button
                className="px-3 py-2 rounded border bg-white hover:bg-gray-50 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                disabled={editorUploadBusy}
                onClick={clearPageImage}
              >
                {"清除背景"}
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                className="px-3 py-2 rounded bg-black text-white text-sm disabled:cursor-not-allowed disabled:opacity-50"
                disabled={editorUploadBusy}
                onClick={applyPageImageFromInput}
              >
                {"应用"}
              </button>
              <button
                className="px-3 py-2 rounded border bg-white hover:bg-gray-50 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                disabled={editorUploadBusy}
                onClick={() => setPageImageDialogOpen(false)}
              >
                {"取消"}
              </button>
            </div>
            <div className="text-xs text-gray-500">
              {editorUploadBusy ? "正在上传背景图片，请勿关闭窗口。" : "选择文件后会立即上传并应用为页面背景。"}
            </div>
          </div>
        </div>,
      )
        : null}

      {pageImageSettingsOpen
        ? renderTopMostOverlay(
        <div className="fixed inset-0 z-[2147483000] bg-transparent flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-white rounded-xl border p-4 space-y-3" onMouseDown={(event) => event.stopPropagation()}>
            <div className="text-sm font-semibold">{"背景设置"}</div>
            <div className="space-y-1">
              <div className="text-xs text-gray-600">{"填充方式"}</div>
              <select
                className="border p-2 rounded w-full text-sm"
                value={pageSettingsFillMode}
                onChange={(e) => setPageSettingsFillMode(e.target.value as ImageFillMode)}
              >
                {IMAGE_FILL_VALUES.map((mode) => (
                  <option key={mode} value={mode}>
                    {mode}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <div className="text-xs text-gray-600">{"图片透明度："}{pageSettingsImageOpacity.toFixed(2)}</div>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                className="w-full"
                value={pageSettingsImageOpacity}
                onChange={(e) => setPageSettingsImageOpacity(Number(e.target.value))}
              />
            </div>
            <div className="space-y-1">
              <div className="text-xs text-gray-600">{"颜色透明度："}{pageSettingsColorOpacity.toFixed(2)}</div>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                className="w-full"
                value={pageSettingsColorOpacity}
                onChange={(e) => setPageSettingsColorOpacity(Number(e.target.value))}
              />
            </div>
            <div className="space-y-1">
              <div className="text-xs text-gray-600">{"背景位置（如 center, top, left top）"}</div>
              <select
                className="border p-2 rounded w-full text-sm"
                value={pageSettingsPosition}
                onChange={(e) => setPageSettingsPosition(e.target.value)}
              >
                {!BACKGROUND_POSITION_OPTIONS.includes(pageSettingsPosition) ? (
                  <option value={pageSettingsPosition}>{pageSettingsPosition}</option>
                ) : null}
                {BACKGROUND_POSITION_OPTIONS.map((position) => (
                  <option key={position} value={position}>
                    {position}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <div className="text-xs text-gray-600">{"色彩（可选）"}</div>
              <ColorOrGradientPicker value={pageSettingsColor} onChange={setPageSettingsColor} />
              <RecentColorBar
                colors={recentColors}
                onClear={clearRecentColors}
                onPick={(color) => setPageSettingsColor(color)}
                allowGradients
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                className="px-3 py-2 rounded bg-black text-white text-sm"
                onClick={applyPageImageSettings}
              >
                {"应用"}
              </button>
              <button
                className="px-3 py-2 rounded border bg-white hover:bg-gray-50 text-sm"
                onClick={() => setPageImageSettingsOpen(false)}
              >
                {"取消"}
              </button>
            </div>
          </div>
        </div>,
      )
        : null}

      {supportDialogOpen && !isPlatformEditor && !showDesktopMerchantSupportPanel
        ? renderTopMostOverlay(
            <>
              <button
                type="button"
                className="fixed inset-0 z-[2147483300] bg-black/45"
                onClick={() => {
                  if (supportSending) return;
                  setSupportDialogOpen(false);
                }}
                aria-label="关闭在线客服弹窗"
                />
                <div
                  className={`fixed inset-x-0 top-0 bottom-0 z-[2147483301] ${isMobileSupportDialog ? "" : "flex items-center justify-center p-4"}`}
                  style={isMobileSupportDialog ? supportMobileViewportFrameStyle : undefined}
                >
                  {isMobileSupportDialog ? (
                  <>
                    {supportMobileDialogContent}
                    {supportMobileBottomNavOverlay}
                  </>
                ) : supportDesktopSurfaceContent}
              </div>
            </>,
          )
        : null}

      {supportBusinessCardDialogOpen && supportInterfaceOpen && !isPlatformEditor ? (
        <ChatBusinessCardDialog
          open
          merchantName={selectedSupportDisplayName}
          subtitle={selectedSupportSubtitle}
          card={selectedSupportBusinessCard}
          loading={supportBusinessCardLoading}
          error={supportBusinessCardError}
          onClose={() => {
            setSupportBusinessCardDialogOpen(false);
            setSupportBusinessCardLoading(false);
            setSupportBusinessCardError("");
          }}
        />
      ) : null}
      {supportImagePreview ? (
        <SupportMessageImagePreviewOverlay
          open
          imageUrl={supportImagePreview.imageUrl}
          linkUrl={supportImagePreview.linkUrl}
          title={supportImagePreview.title || "图片预览"}
          onClose={() => setSupportImagePreview(null)}
          onNotice={showTip}
          currentForwardAction={
            selectedSupportPeerContact
              ? {
                  label: `转发给 ${selectedSupportPeerContact.merchantName || selectedSupportPeerContact.merchantId}`,
                  onForward: () =>
                    sendSupportAttachmentToPeerRecipient(
                      selectedSupportPeerContact.merchantId,
                      supportImagePreview.rawText,
                      selectedSupportPeerContact.merchantName || selectedSupportPeerContact.merchantId,
                    ),
                }
              : null
          }
          queryForwardAction={{
            label: "转发给指定商户",
            placeholder: "例如：10000000 或 owner@example.com",
            onForward: (query) => forwardSupportAttachmentToSpecifiedMerchant(query, supportImagePreview.rawText),
          }}
        />
      ) : null}

      {supportMerchantInfoSheetOverlay}
      {supportSelfCardPickerOverlay}
      {supportMessageContextMenuOverlay}

      {merchantProfileDialogOpen && merchantProfileDialogCommonProps ? (
        <MerchantProfileDialog
          {...merchantProfileDialogCommonProps}
          open={merchantProfileDialogOpen}
          showBusinessCardManager={false}
        />
      ) : null}

      {merchantBookingManagerOpen && merchantBookingManagerDialogCommonProps ? (
        <MerchantBookingManagerDialog
          {...merchantBookingManagerDialogCommonProps}
          open={merchantBookingManagerOpen}
        />
      ) : null}

      {merchantOrderManagerOpen && merchantOrderManagerDialogCommonProps ? (
        <MerchantOrderManagerDialog
          {...merchantOrderManagerDialogCommonProps}
          open={merchantOrderManagerOpen}
        />
      ) : null}

      {pageCopyDialogOpen
        ? renderTopMostOverlay(
            <div
              data-editor-overlay
              className="fixed inset-0 z-[2147482550] bg-black/45 p-4"
              onMouseDown={(event) => {
                if (event.target === event.currentTarget) {
                  setPageCopyDialogOpen(false);
                }
              }}
            >
              <div className="mx-auto flex h-full max-h-[calc(100vh-2rem)] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border bg-white shadow-2xl">
                <div className="flex flex-wrap items-start justify-between gap-3 border-b px-5 py-4">
                  <div className="space-y-1">
                    <div className="text-lg font-semibold text-slate-900">复制到目标页面</div>
                    <div className="text-sm text-slate-500">
                      勾选需要复制的背景、主题或区块，再选择目标页面后确认复制。
                    </div>
                  </div>
                  <button
                    type="button"
                    className="rounded border bg-white px-3 py-2 text-sm hover:bg-gray-50"
                    onClick={() => setPageCopyDialogOpen(false)}
                  >
                    关闭
                  </button>
                </div>

                <div className="space-y-4 overflow-y-auto px-5 py-5">
                  <label className="space-y-2">
                    <div className="text-sm font-medium text-slate-700">目标页面</div>
                    <select
                      className="w-full rounded border px-3 py-2 text-sm"
                      value={pageCopyTargetPageId}
                      onChange={(event) => setPageCopyTargetPageId(event.target.value)}
                    >
                      {pageCopyTargetPages.map((page) => (
                        <option key={page.id} value={page.id}>
                          {toPlainText(page.name, page.id)}
                        </option>
                      ))}
                    </select>
                  </label>

                  <div className="space-y-3 rounded-2xl border bg-slate-50 px-4 py-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-medium text-slate-800">复制项目</div>
                        <div className="text-xs text-slate-500">已选择 {pageCopySelectedItemCount} 项</div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          className="rounded border bg-white px-3 py-1.5 text-xs hover:bg-slate-50"
                          onClick={() =>
                            setPageCopySelections((current) =>
                              Object.keys(current).reduce<PageCopySelectionState>((accumulator, key) => {
                                accumulator[key] = true;
                                return accumulator;
                              }, {}),
                            )
                          }
                        >
                          全选
                        </button>
                        <button
                          type="button"
                          className="rounded border bg-white px-3 py-1.5 text-xs hover:bg-slate-50"
                          onClick={() => setPageCopySelections(buildPageCopySelectionDefaults(blocks))}
                        >
                          清空
                        </button>
                      </div>
                    </div>

                    <div className="grid gap-2 md:grid-cols-2">
                      <label className="flex items-start gap-3 rounded-xl border bg-white px-3 py-3 text-sm">
                        <input
                          type="checkbox"
                          className="mt-1 h-4 w-4"
                          checked={pageCopySelections[PAGE_COPY_BACKGROUND_ITEM_ID] === true}
                          onChange={(event) =>
                            setPageCopySelections((current) => ({
                              ...current,
                              [PAGE_COPY_BACKGROUND_ITEM_ID]: event.target.checked,
                            }))
                          }
                        />
                        <span className="space-y-1">
                          <span className="block font-medium text-slate-800">背景</span>
                          <span className="block text-xs text-slate-500">复制当前页面背景图、颜色、透明度和填充方式。</span>
                        </span>
                      </label>
                      <label className="flex items-start gap-3 rounded-xl border bg-white px-3 py-3 text-sm">
                        <input
                          type="checkbox"
                          className="mt-1 h-4 w-4"
                          checked={pageCopySelections[PAGE_COPY_THEME_ITEM_ID] === true}
                          onChange={(event) =>
                            setPageCopySelections((current) => ({
                              ...current,
                              [PAGE_COPY_THEME_ITEM_ID]: event.target.checked,
                            }))
                          }
                        />
                        <span className="space-y-1">
                          <span className="block font-medium text-slate-800">主题</span>
                          <span className="block text-xs text-slate-500">复制当前页面的主题风格样式，尽量保留目标页已有内容。</span>
                        </span>
                      </label>
                    </div>

                    <div className="space-y-2">
                      <div className="text-sm font-medium text-slate-800">当前页区块</div>
                      <div className="grid gap-2 md:grid-cols-2">
                        {pageCopyBlockOptions.map((item) => (
                          <label key={item.id} className="flex items-center gap-3 rounded-xl border bg-white px-3 py-3 text-sm">
                            <input
                              type="checkbox"
                              className="h-4 w-4"
                              checked={pageCopySelections[item.id] === true}
                              onChange={(event) =>
                                setPageCopySelections((current) => ({
                                  ...current,
                                  [item.id]: event.target.checked,
                                }))
                              }
                            />
                            <span className="min-w-0 truncate text-slate-700" title={item.label}>
                              {item.label}
                            </span>
                          </label>
                        ))}
                      </div>
                    </div>

                    <div className="rounded-xl border border-dashed bg-white px-3 py-3 text-xs leading-5 text-slate-500">
                      区块复制会把内容一起带过去。若目标页已有同类型同顺位区块，会优先覆盖；没有时会新增到目标页。
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap justify-end gap-2 border-t px-5 py-4">
                  <button
                    type="button"
                    className="rounded border bg-white px-4 py-2 text-sm hover:bg-slate-50"
                    onClick={() => setPageCopyDialogOpen(false)}
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    className="rounded bg-black px-4 py-2 text-sm text-white disabled:opacity-50"
                    onClick={applySelectedItemsToTargetPage}
                    disabled={pageCopySelectedItemCount === 0 || !pageCopyTargetPageId}
                  >
                    确认复制
                  </button>
                </div>
              </div>
            </div>,
          )
        : null}

      {planTemplateDialogOpen && isPlatformEditor
        ? renderTopMostOverlay(
            <div
              data-editor-overlay
              className="fixed inset-0 z-[2147482600] bg-black/45 p-4"
              onMouseDown={(event) => {
                if (event.target === event.currentTarget) {
                  setPlanTemplateDialogOpen(false);
                }
              }}
            >
              <div className="mx-auto flex h-full max-h-[calc(100vh-2rem)] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border bg-white shadow-2xl">
                <div className="flex flex-wrap items-start justify-between gap-3 border-b px-5 py-4">
                  <div className="space-y-1">
                    <div className="text-lg font-semibold text-slate-900">方案模板</div>
                    <div className="text-sm text-slate-500">选择整套已收录方案，一次应用 PC 和手机端页面配置。</div>
                  </div>
                  <button
                    type="button"
                    className="rounded border bg-white px-3 py-2 text-sm hover:bg-gray-50"
                    onClick={() => setPlanTemplateDialogOpen(false)}
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
                    <div className="text-sm text-slate-500">共 {planTemplateCards.length} 个方案</div>
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
                        const sourceLabel =
                          template.sourceSiteName || template.sourceSiteDomain || template.sourceSiteId || "未记录来源网站";
                        const blockLabels = summary.labels.length > 0 ? summary.labels : ["未识别区块"];
                        const coverImageUrl = (template.coverImageUrl ?? "").trim();
                        const coverBackground = extractPlanTemplateCoverBackground(template.blocks);
                        const coverBackgroundStyle =
                          !coverImageUrl && coverBackground ? getBackgroundStyle(coverBackground) : null;
                        const hasCustomCoverBackground = !!coverBackgroundStyle;
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
                                      <div className="text-xs uppercase tracking-[0.22em] text-white/60">模板封面</div>
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
                                    <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
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
                                    <div className="mt-4 flex flex-wrap gap-2">
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
                                      value={template.name}
                                      onChange={(event) =>
                                        updatePlanTemplateDraft(template.id, {
                                          name: event.target.value,
                                        })
                                      }
                                      onBlur={() => updatePlanTemplateDraft(template.id, {}, { persist: true })}
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
                                    onClick={() => void deletePlanTemplate(template)}
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
                                      onChange={(event) =>
                                        updatePlanTemplateDraft(
                                          template.id,
                                          { category: event.target.value as PlanTemplateCategory },
                                          { persist: true },
                                        )
                                      }
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
                                      {previewPlans.map((plan) => {
                                        const planPreviewUrl = String((template.planPreviewImageUrls ?? {})[plan.planId] ?? "").trim();
                                        const fallbackPreviewUrl = (template.previewImageUrl ?? "").trim();
                                        const previewUrl = planPreviewUrl || fallbackPreviewUrl;
                                        return (
                                          <button
                                            key={`${template.id}-${plan.planId}`}
                                            type="button"
                                            className="rounded border bg-white px-3 py-2 text-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                                            onClick={() => void openPlanTemplatePreview(template, plan.planId, plan.planName)}
                                            disabled={!previewUrl && !needsPlanTemplatePreviewRefresh(template)}
                                          >
                                            {plan.planName}
                                          </button>
                                        );
                                      })}
                                    </div>
                                  </div>
                                ) : null}

                                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-white px-3 py-3">
                                    <div className="text-xs text-slate-500">
                                      创建于 {new Date(template.createdAt).toLocaleString("zh-CN", { hour12: false })}
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
                                      className="rounded bg-black px-4 py-2 text-sm text-white hover:bg-slate-800"
                                      onClick={() => void applyPlanTemplate(template)}
                                    >
                                      应用整套方案
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
                      当前没有匹配的方案模板。你可以先去超级后台用户列表点击“收录方案”。
                    </div>
                  )}
                </div>
              </div>
            </div>,
          )
        : null}

      {planTemplateCoverPreview
        ? renderTopMostOverlay(
            <div className="fixed inset-0 z-[2147483600] flex items-center justify-center bg-black/65 p-4">
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
            </div>,
          )
        : null}

      {editorUploadBusyOverlay}
      {publishBusyOverlay}
      {dialogOverlay}
    </main>
  );
}
