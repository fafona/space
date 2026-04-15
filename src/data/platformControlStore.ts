import { normalizeMerchantBusinessCards, type MerchantBusinessCardAsset } from "@/lib/merchantBusinessCards";
import { buildCombinedPersistedBlocks, extractPlanTemplateCoverImage } from "@/lib/planTemplateRuntime";
import type { PagePlanConfig, PlanPage } from "@/lib/pagePlans";
import type { BackgroundEditableProps, Block } from "./homeBlocks";

export type PermissionKey =
  | "dashboard.view"
  | "tenant.view"
  | "tenant.manage"
  | "site.view"
  | "site.manage"
  | "user.view"
  | "user.manage"
  | "role.manage"
  | "feature.manage"
  | "page_asset.view"
  | "page_asset.manage"
  | "publish.view"
  | "publish.trigger"
  | "rollback.trigger"
  | "approval.view"
  | "approval.handle"
  | "audit.view"
  | "alert.manage";

export type FeatureKey =
  | "multi_page_editor"
  | "schedule_publish"
  | "ai_copywriting"
  | "custom_domain"
  | "member_center"
  | "ab_test"
  | "api_access"
  | "advanced_analytics";

export type TenantStatus = "active" | "suspended";
export type SiteStatus = "online" | "maintenance" | "offline";
export type UserStatus = "active" | "disabled";
export type AssetStatus = "draft" | "published" | "archived";
export type PublishStatus = "success" | "failed" | "rollback";
export type ApprovalStatus = "pending" | "approved" | "rejected";
export type ApprovalType = "publish" | "rollback" | "permission_change" | "feature_change";
export type AlertLevel = "info" | "warning" | "critical";

export type PermissionMeta = {
  key: PermissionKey;
  label: string;
  description: string;
};

export type FeatureMeta = {
  key: FeatureKey;
  label: string;
  description: string;
};

export type MerchantIndustry = "" | "餐饮" | "娱乐" | "零售" | "服务" | "组织";
export const MERCHANT_INDUSTRY_OPTIONS: Exclude<MerchantIndustry, "">[] = ["餐饮", "娱乐", "零售", "服务", "组织"];
export type PlanTemplateCategory = Exclude<MerchantIndustry, ""> | "其他";
export const PLAN_TEMPLATE_CATEGORY_OPTIONS: PlanTemplateCategory[] = ["餐饮", "娱乐", "零售", "服务", "组织", "其他"];

export type Tenant = {
  id: string;
  name: string;
  owner: string;
  status: TenantStatus;
  createdAt: string;
  updatedAt: string;
};

export type SiteLocation = {
  countryCode: string;
  country: string;
  provinceCode: string;
  province: string;
  city: string;
};

export const MERCHANT_SORT_RULES = [
  "created_desc",
  "created_asc",
  "name_asc",
  "name_desc",
  "monthly_views_desc",
] as const;

export type MerchantSortRule = (typeof MERCHANT_SORT_RULES)[number];

export type MerchantServicePermissionConfig = {
  planLimit: number;
  pageLimit: number;
  businessCardLimit: number;
  allowBusinessCardLinkMode: boolean;
  allowBookingEmailPrefill: boolean;
  allowBookingAutoEmail: boolean;
  businessCardBackgroundImageLimitKb: number;
  businessCardContactImageLimitKb: number;
  businessCardExportImageLimitKb: number;
  commonBlockImageLimitKb: number;
  galleryBlockImageLimitKb: number;
  allowInsertBackground: boolean;
  allowThemeEffects: boolean;
  allowButtonBlock: boolean;
  allowGalleryBlock: boolean;
  allowMusicBlock: boolean;
  allowProductBlock: boolean;
  allowBookingBlock: boolean;
  publishSizeLimitMb: number;
};

export type MerchantSortConfig = {
  recommendedCountryRank: number | null;
  recommendedProvinceRank: number | null;
  recommendedCityRank: number | null;
  industryCountryRank: number | null;
  industryProvinceRank: number | null;
  industryCityRank: number | null;
};

export type MerchantConfigSnapshot = {
  serviceExpiresAt: string | null;
  permissionConfig: MerchantServicePermissionConfig;
  merchantCardImageUrl: string;
  merchantCardImageOpacity: number;
  chatAvatarImageUrl: string;
  contactVisibility: MerchantContactVisibility;
  sortConfig: MerchantSortConfig;
};

export type MerchantConfigHistoryEntry = {
  id: string;
  at: string;
  operator: string;
  summary: string;
  changes: string[];
  before: MerchantConfigSnapshot;
  after: MerchantConfigSnapshot;
};

export type MerchantContactVisibility = {
  phoneHidden: boolean;
  emailHidden: boolean;
  businessCardHidden: boolean;
};

export type Site = {
  id: string;
  tenantId: string;
  merchantName?: string;
  signature?: string;
  domainPrefix?: string;
  domainSuffix?: string;
  contactAddress?: string;
  contactName?: string;
  contactPhone?: string;
  contactEmail?: string;
  name: string;
  domain: string;
  categoryId: string;
  category: string;
  industry: MerchantIndustry;
  status: SiteStatus;
  publishedVersion: number;
  lastPublishedAt: string | null;
  features: Record<FeatureKey, boolean>;
  location: SiteLocation;
  serviceExpiresAt?: string | null;
  permissionConfig?: MerchantServicePermissionConfig;
  merchantCardImageUrl?: string;
  merchantCardImageOpacity?: number;
  chatAvatarImageUrl?: string;
  contactVisibility?: MerchantContactVisibility;
  businessCards?: MerchantBusinessCardAsset[];
  sortConfig?: MerchantSortConfig;
  configHistory?: MerchantConfigHistoryEntry[];
  createdAt: string;
  updatedAt: string;
};

export type IndustryCategoryStatus = "active" | "inactive";

export type IndustryCategory = {
  id: string;
  name: string;
  slug: string;
  description: string;
  parentId: string | null;
  sortOrder: number;
  status: IndustryCategoryStatus;
  createdAt: string;
  updatedAt: string;
};

export type HomeLayoutSection = {
  id: string;
  title: string;
  description: string;
  categoryId: string;
  sortOrder: number;
  visible: boolean;
};

export type HomeLayoutConfig = {
  heroTitle: string;
  heroSubtitle: string;
  featuredCategoryIds: string[];
  merchantDefaultSortRule: MerchantSortRule;
  sections: HomeLayoutSection[];
};

export type PlatformRole = {
  id: string;
  name: string;
  description: string;
  permissions: PermissionKey[];
  createdAt: string;
  updatedAt: string;
};

export type PlatformUser = {
  id: string;
  name: string;
  email: string;
  department: string;
  tenantIds: string[];
  siteIds: string[];
  roleIds: string[];
  status: UserStatus;
  createdAt: string;
  updatedAt: string;
};

export type PageAsset = {
  id: string;
  siteId: string;
  pagePath: string;
  group: string;
  tags: string[];
  status: AssetStatus;
  updatedBy: string;
  updatedAt: string;
};

export type PublishRecord = {
  id: string;
  tenantId: string;
  siteId: string;
  version: number;
  status: PublishStatus;
  operator: string;
  notes: string;
  at: string;
};

export type ApprovalRequest = {
  id: string;
  type: ApprovalType;
  tenantId: string;
  siteId: string;
  summary: string;
  requestedBy: string;
  requestedAt: string;
  status: ApprovalStatus;
  handledBy: string | null;
  handledAt: string | null;
  resultNote: string;
};

export type AlertRecord = {
  id: string;
  level: AlertLevel;
  title: string;
  message: string;
  createdAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
};

export type AuditRecord = {
  id: string;
  at: string;
  operator: string;
  action: string;
  targetType: string;
  targetId: string;
  detail: string;
};

export type PlanTemplate = {
  id: string;
  name: string;
  category: PlanTemplateCategory;
  sourceSiteId: string;
  sourceSiteName: string;
  sourceSiteDomain: string;
  sourceIndustry: MerchantIndustry;
  coverImageUrl?: string;
  previewImageUrl?: string;
  planPreviewImageUrls?: Record<string, string>;
  previewVariant?: string;
  blocks: unknown[];
  createdAt: string;
  updatedAt: string;
};

export type PlatformState = {
  version: number;
  tenants: Tenant[];
  sites: Site[];
  planTemplates: PlanTemplate[];
  industryCategories: IndustryCategory[];
  homeLayout: HomeLayoutConfig;
  roles: PlatformRole[];
  users: PlatformUser[];
  pageAssets: PageAsset[];
  publishRecords: PublishRecord[];
  approvals: ApprovalRequest[];
  alerts: AlertRecord[];
  audits: AuditRecord[];
};

const STORAGE_KEY = "merchant-space:platform-control-center:v1";
const MERCHANT_CONFIG_HISTORY_STORAGE_KEY = "merchant-space:platform-control-center:merchant-config-history:v1";
const STORE_EVENT = "merchant-space:platform-control-center:changed";
const MAX_AUDIT_RECORDS = 1200;
const MAX_ALERT_RECORDS = 400;
const MAX_PUBLISH_RECORDS = 600;
const MAX_APPROVAL_RECORDS = 500;

export const PERMISSION_CATALOG: PermissionMeta[] = [
  { key: "dashboard.view", label: "查看总览", description: "查看平台总览指标与统计。" },
  { key: "tenant.view", label: "查看租户", description: "查看租户列表与详情。" },
  { key: "tenant.manage", label: "管理租户", description: "创建、编辑、停用租户。" },
  { key: "site.view", label: "查看站点", description: "查看站点分布、分类与状态。" },
  { key: "site.manage", label: "管理站点", description: "新增站点、调整分类和状态。" },
  { key: "user.view", label: "查看用户", description: "查看平台用户与组织归属。" },
  { key: "user.manage", label: "管理用户", description: "创建用户、禁用用户、分配权限。" },
  { key: "role.manage", label: "管理角色权限", description: "创建角色并配置权限点。" },
  { key: "feature.manage", label: "功能开通", description: "按站点开关功能模块。" },
  { key: "page_asset.view", label: "查看页面资产", description: "查看页面资产分组与标签。" },
  { key: "page_asset.manage", label: "管理页面资产", description: "维护页面分组、标签与状态。" },
  { key: "publish.view", label: "查看发布中心", description: "查看发布记录、成功率、版本信息。" },
  { key: "publish.trigger", label: "发起发布", description: "发起正式发布流程。" },
  { key: "rollback.trigger", label: "发起回滚", description: "发起回滚发布流程。" },
  { key: "approval.view", label: "查看审批", description: "查看审批流转状态。" },
  { key: "approval.handle", label: "处理审批", description: "批准/驳回审批请求。" },
  { key: "audit.view", label: "查看审计日志", description: "查看平台关键操作审计日志。" },
  { key: "alert.manage", label: "处理告警", description: "查看并处理系统告警。" },
];

export const FEATURE_CATALOG: FeatureMeta[] = [
  { key: "multi_page_editor", label: "多页面编辑", description: "支持多页面编辑和切换发布。" },
  { key: "schedule_publish", label: "定时发布", description: "支持预约发布时间窗口。" },
  { key: "ai_copywriting", label: "AI 文案", description: "支持文案辅助生成与润色。" },
  { key: "custom_domain", label: "自定义域名", description: "支持绑定独立域名。" },
  { key: "member_center", label: "会员中心", description: "支持会员模块与登录态。" },
  { key: "ab_test", label: "A/B 实验", description: "支持页面版本实验与转化对比。" },
  { key: "api_access", label: "开放 API", description: "支持平台 API 集成能力。" },
  { key: "advanced_analytics", label: "高级分析", description: "支持深度流量与行为分析。" },
];
const ALL_PERMISSIONS = PERMISSION_CATALOG.map((item) => item.key);

function nowIso() {
  return new Date().toISOString();
}

function nextId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function ensureFeatureFlags(input?: Partial<Record<FeatureKey, boolean>>) {
  const flags = {} as Record<FeatureKey, boolean>;
  FEATURE_CATALOG.forEach((feature) => {
    flags[feature.key] = input?.[feature.key] === true;
  });
  return flags;
}

const FALLBACK_SITE_LOCATIONS: SiteLocation[] = [
  {
    countryCode: "",
    country: "",
    provinceCode: "",
    province: "",
    city: "",
  },
];

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeSiteIndustry(value: unknown): MerchantIndustry {
  const raw = normalizeText(value);
  return MERCHANT_INDUSTRY_OPTIONS.find((item) => item === raw) ?? "";
}

export function resolvePlanTemplateCategory(industry: unknown): PlanTemplateCategory {
  const normalized = normalizeSiteIndustry(industry);
  return normalized || "其他";
}

function normalizeMerchantSortRule(value: unknown): MerchantSortRule {
  const raw = normalizeText(value) as MerchantSortRule;
  return MERCHANT_SORT_RULES.includes(raw) ? raw : "created_desc";
}

export function createDefaultMerchantPermissionConfig(): MerchantServicePermissionConfig {
  return {
    planLimit: 1,
    pageLimit: 3,
    businessCardLimit: 1,
    allowBusinessCardLinkMode: false,
    allowBookingEmailPrefill: false,
    allowBookingAutoEmail: false,
    businessCardBackgroundImageLimitKb: 200,
    businessCardContactImageLimitKb: 200,
    businessCardExportImageLimitKb: 400,
    commonBlockImageLimitKb: 300,
    galleryBlockImageLimitKb: 300,
    allowInsertBackground: false,
    allowThemeEffects: false,
    allowButtonBlock: false,
    allowGalleryBlock: false,
    allowMusicBlock: false,
    allowProductBlock: false,
    allowBookingBlock: false,
    publishSizeLimitMb: 5,
  };
}

function normalizeInt(value: unknown, fallback: number, min = 0, max = 1_000_000) {
  const next = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : fallback;
  return Math.max(min, Math.min(max, next));
}

function normalizeNullableRank(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) return null;
  return Math.max(1, Math.round(num));
}

export function normalizeMerchantPermissionConfig(value: unknown): MerchantServicePermissionConfig {
  const source = value && typeof value === "object" ? (value as Partial<MerchantServicePermissionConfig>) : {};
  const fallback = createDefaultMerchantPermissionConfig();
  return {
    planLimit: normalizeInt(source.planLimit, fallback.planLimit, 1, 200),
    pageLimit: normalizeInt(source.pageLimit, fallback.pageLimit, 1, 500),
    businessCardLimit: normalizeInt(source.businessCardLimit, fallback.businessCardLimit, 1, 100),
    allowBusinessCardLinkMode:
      typeof source.allowBusinessCardLinkMode === "boolean" ? source.allowBusinessCardLinkMode : true,
    allowBookingEmailPrefill:
      typeof source.allowBookingEmailPrefill === "boolean"
        ? source.allowBookingEmailPrefill
        : fallback.allowBookingEmailPrefill,
    allowBookingAutoEmail:
      typeof source.allowBookingAutoEmail === "boolean"
        ? source.allowBookingAutoEmail
        : typeof source.allowBookingBlock === "boolean"
          ? source.allowBookingBlock
          : fallback.allowBookingAutoEmail,
    businessCardBackgroundImageLimitKb: normalizeInt(
      source.businessCardBackgroundImageLimitKb,
      fallback.businessCardBackgroundImageLimitKb,
      50,
      5000,
    ),
    businessCardContactImageLimitKb: normalizeInt(
      source.businessCardContactImageLimitKb,
      fallback.businessCardContactImageLimitKb,
      50,
      5000,
    ),
    businessCardExportImageLimitKb: normalizeInt(
      source.businessCardExportImageLimitKb,
      fallback.businessCardExportImageLimitKb,
      50,
      5000,
    ),
    commonBlockImageLimitKb: normalizeInt(
      source.commonBlockImageLimitKb,
      fallback.commonBlockImageLimitKb,
      50,
      5000,
    ),
    galleryBlockImageLimitKb: normalizeInt(
      source.galleryBlockImageLimitKb,
      fallback.galleryBlockImageLimitKb,
      50,
      5000,
    ),
    allowInsertBackground:
      typeof source.allowInsertBackground === "boolean" ? source.allowInsertBackground : fallback.allowInsertBackground,
    allowThemeEffects: typeof source.allowThemeEffects === "boolean" ? source.allowThemeEffects : fallback.allowThemeEffects,
    allowButtonBlock: typeof source.allowButtonBlock === "boolean" ? source.allowButtonBlock : fallback.allowButtonBlock,
    allowGalleryBlock: typeof source.allowGalleryBlock === "boolean" ? source.allowGalleryBlock : fallback.allowGalleryBlock,
    allowMusicBlock: typeof source.allowMusicBlock === "boolean" ? source.allowMusicBlock : fallback.allowMusicBlock,
    allowProductBlock: typeof source.allowProductBlock === "boolean" ? source.allowProductBlock : fallback.allowProductBlock,
    allowBookingBlock: typeof source.allowBookingBlock === "boolean" ? source.allowBookingBlock : fallback.allowBookingBlock,
    publishSizeLimitMb: normalizeInt(source.publishSizeLimitMb, fallback.publishSizeLimitMb, 1, 100),
  };
}

export function createDefaultMerchantSortConfig(): MerchantSortConfig {
  return {
    recommendedCountryRank: null,
    recommendedProvinceRank: null,
    recommendedCityRank: null,
    industryCountryRank: null,
    industryProvinceRank: null,
    industryCityRank: null,
  };
}

function normalizeMerchantSortConfig(value: unknown): MerchantSortConfig {
  const source = value && typeof value === "object" ? (value as Partial<MerchantSortConfig>) : {};
  return {
    recommendedCountryRank: normalizeNullableRank(source.recommendedCountryRank),
    recommendedProvinceRank: normalizeNullableRank(source.recommendedProvinceRank),
    recommendedCityRank: normalizeNullableRank(source.recommendedCityRank),
    industryCountryRank: normalizeNullableRank(source.industryCountryRank),
    industryProvinceRank: normalizeNullableRank(source.industryProvinceRank),
    industryCityRank: normalizeNullableRank(source.industryCityRank),
  };
}

export function createDefaultMerchantContactVisibility(): MerchantContactVisibility {
  return {
    phoneHidden: false,
    emailHidden: false,
    businessCardHidden: false,
  };
}

function normalizeUnitInterval(value: unknown, fallback = 1) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(1, value));
}

function normalizeMerchantContactVisibility(value: unknown): MerchantContactVisibility {
  const source = value && typeof value === "object" ? (value as Partial<MerchantContactVisibility>) : {};
  const fallback = createDefaultMerchantContactVisibility();
  return {
    phoneHidden: typeof source.phoneHidden === "boolean" ? source.phoneHidden : fallback.phoneHidden,
    emailHidden: typeof source.emailHidden === "boolean" ? source.emailHidden : fallback.emailHidden,
    businessCardHidden:
      typeof source.businessCardHidden === "boolean" ? source.businessCardHidden : fallback.businessCardHidden,
  };
}

function normalizeMerchantConfigSnapshot(value: unknown): MerchantConfigSnapshot {
  const source = value && typeof value === "object" ? (value as Partial<MerchantConfigSnapshot>) : {};
  return {
    serviceExpiresAt:
      typeof source.serviceExpiresAt === "string" && normalizeText(source.serviceExpiresAt)
        ? normalizeText(source.serviceExpiresAt)
        : null,
    permissionConfig: normalizeMerchantPermissionConfig(source.permissionConfig),
    merchantCardImageUrl: normalizeText(source.merchantCardImageUrl),
    merchantCardImageOpacity: normalizeUnitInterval(source.merchantCardImageOpacity, 1),
    chatAvatarImageUrl: normalizeText((source as { chatAvatarImageUrl?: unknown }).chatAvatarImageUrl),
    contactVisibility: normalizeMerchantContactVisibility((source as { contactVisibility?: unknown }).contactVisibility),
    sortConfig: normalizeMerchantSortConfig(source.sortConfig),
  };
}

function normalizeMerchantConfigHistoryChanges(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => normalizeText(item)).filter(Boolean);
}

function merchantConfigHistoryTimestamp(value: string) {
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export function mergeMerchantConfigHistoryEntries(
  ...groups: Array<MerchantConfigHistoryEntry[] | undefined>
): MerchantConfigHistoryEntry[] {
  const rows = new Map<string, MerchantConfigHistoryEntry>();
  groups.forEach((group) => {
    if (!Array.isArray(group)) return;
    group.forEach((entry) => {
      if (!entry?.id) return;
      const existing = rows.get(entry.id);
      if (!existing || merchantConfigHistoryTimestamp(entry.at) >= merchantConfigHistoryTimestamp(existing.at)) {
        rows.set(entry.id, entry);
      }
    });
  });
  return [...rows.values()].sort((a, b) => merchantConfigHistoryTimestamp(b.at) - merchantConfigHistoryTimestamp(a.at));
}

function normalizeMerchantConfigHistory(value: unknown): MerchantConfigHistoryEntry[] {
  if (!Array.isArray(value)) return [];
  const rows: MerchantConfigHistoryEntry[] = [];
  value.forEach((item) => {
    if (!item || typeof item !== "object") return;
    const row = item as Partial<MerchantConfigHistoryEntry>;
    const id = normalizeText(row.id);
    const at = normalizeText(row.at);
    if (!id || !at) return;
    rows.push({
      id,
      at,
      operator: normalizeText(row.operator) || "未知操作人",
      summary: normalizeText(row.summary) || "配置更新",
      changes: normalizeMerchantConfigHistoryChanges((row as { changes?: unknown }).changes),
      before: normalizeMerchantConfigSnapshot(row.before),
      after: normalizeMerchantConfigSnapshot(row.after),
    });
  });
  return mergeMerchantConfigHistoryEntries(rows);
}

type MerchantConfigHistoryStore = Record<string, MerchantConfigHistoryEntry[]>;

function normalizeMerchantConfigHistoryStore(value: unknown): MerchantConfigHistoryStore {
  if (!value || typeof value !== "object") return {};
  const source = value as Record<string, unknown>;
  const rows: MerchantConfigHistoryStore = {};
  Object.entries(source).forEach(([siteId, history]) => {
    const normalizedSiteId = normalizeText(siteId);
    if (!normalizedSiteId) return;
    const normalizedHistory = normalizeMerchantConfigHistory(history);
    if (normalizedHistory.length > 0) {
      rows[normalizedSiteId] = normalizedHistory;
    }
  });
  return rows;
}

function loadMerchantConfigHistoryStore(): MerchantConfigHistoryStore {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(MERCHANT_CONFIG_HISTORY_STORAGE_KEY);
    if (!raw) return {};
    return normalizeMerchantConfigHistoryStore(JSON.parse(raw));
  } catch {
    return {};
  }
}

function buildMerchantConfigHistoryStore(
  state: PlatformState,
  existingStore: MerchantConfigHistoryStore = {},
): MerchantConfigHistoryStore {
  const nextStore: MerchantConfigHistoryStore = { ...existingStore };
  state.sites.forEach((site) => {
    const siteId = normalizeText(site.id);
    if (!siteId) return;
    const mergedHistory = mergeMerchantConfigHistoryEntries(existingStore[siteId], site.configHistory);
    if (mergedHistory.length > 0) {
      nextStore[siteId] = mergedHistory;
    }
  });
  return nextStore;
}

function applyMerchantConfigHistoryStore(state: PlatformState, historyStore: MerchantConfigHistoryStore): PlatformState {
  return {
    ...state,
    sites: state.sites.map((site) => {
      const siteId = normalizeText(site.id);
      const mergedHistory = mergeMerchantConfigHistoryEntries(historyStore[siteId], site.configHistory);
      return {
        ...site,
        configHistory: mergedHistory,
      };
    }),
  };
}

function stripMerchantConfigHistoryForStorage(state: PlatformState): PlatformState {
  return {
    ...state,
    sites: state.sites.map((site) => ({
      ...site,
      configHistory: [],
    })),
  };
}

function persistPlatformState(
  state: PlatformState,
  historyStore: MerchantConfigHistoryStore,
  options: { emitEvent?: boolean } = {},
) {
  if (typeof window === "undefined") return false;
  try {
    localStorage.setItem(MERCHANT_CONFIG_HISTORY_STORAGE_KEY, JSON.stringify(historyStore));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stripMerchantConfigHistoryForStorage(state)));
    if (options.emitEvent !== false) {
      window.dispatchEvent(new Event(STORE_EVENT));
    }
    return true;
  } catch {
    return false;
  }
}

function stableHash(value: string) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) % 2147483647;
  }
  return Math.abs(hash);
}

function fallbackSiteLocation(seed: string) {
  const normalizedSeed = normalizeText(seed).toLowerCase() || "site";
  const index = stableHash(normalizedSeed) % FALLBACK_SITE_LOCATIONS.length;
  return FALLBACK_SITE_LOCATIONS[index];
}

function normalizeSiteLocation(input: Partial<SiteLocation> | undefined, seed: string): SiteLocation {
  const fallback = fallbackSiteLocation(seed);
  return {
    countryCode: normalizeText(input?.countryCode).toUpperCase() || fallback.countryCode,
    country: normalizeText(input?.country) || fallback.country,
    provinceCode: normalizeText(input?.provinceCode) || fallback.provinceCode,
    province: normalizeText(input?.province) || fallback.province,
    city: normalizeText(input?.city) || fallback.city,
  };
}

function createDefaultIndustryCategories() {
  const current = nowIso();
  return [
    {
      id: "cat-brand-site",
      name: "品牌官网",
      slug: "brand-site",
      description: "品牌介绍、企业形象与服务能力展示",
      parentId: null,
      sortOrder: 10,
      status: "active",
      createdAt: current,
      updatedAt: current,
    },
    {
      id: "cat-campaign",
      name: "营销活动",
      slug: "campaign",
      description: "活动报名、限时促销、专题着陆页",
      parentId: null,
      sortOrder: 20,
      status: "active",
      createdAt: current,
      updatedAt: current,
    },
    {
      id: "cat-service",
      name: "本地服务",
      slug: "local-service",
      description: "到店服务、预约咨询、服务介绍",
      parentId: null,
      sortOrder: 30,
      status: "active",
      createdAt: current,
      updatedAt: current,
    },
  ] satisfies IndustryCategory[];
}

function createDefaultHomeLayoutConfig(): HomeLayoutConfig {
  return {
    heroTitle: "行业模板与商户站点",
    heroSubtitle: "按行业快速查找商户站点，统一平台管理",
    featuredCategoryIds: ["cat-brand-site", "cat-campaign"],
    merchantDefaultSortRule: "created_desc",
    sections: [
      {
        id: "home-section-featured",
        title: "推荐行业",
        description: "平台重点运营行业",
        categoryId: "cat-brand-site",
        sortOrder: 10,
        visible: true,
      },
      {
        id: "home-section-hot",
        title: "热门行业",
        description: "近期入驻量增长较快的行业",
        categoryId: "cat-campaign",
        sortOrder: 20,
        visible: true,
      },
    ],
  };
}

const BUILTIN_NEW_MERCHANT_TEMPLATE_ID = "builtin-template-new-merchant-service-starter";
const BUILTIN_NEW_MERCHANT_TEMPLATE_TIMESTAMP = "2026-04-15T03:40:00.000Z";
const BUILTIN_RESTAURANT_TEMPLATE_ID = "builtin-template-restaurant-signature-starter";
type BuiltinServiceStarterVariant = {
  key: string;
  planId: "plan-1" | "plan-2" | "plan-3";
  name: string;
  heroTitle: string;
  heroSubtitle: string;
  pageBgColor: string;
  navItemBorderColor: string;
  navActiveBgColor: string;
  navActiveBorderColor: string;
  heroBorderColor: string;
  listHeading: string;
  listItems: string[];
  servicesIntro: string;
  serviceListHeading: string;
  serviceListItems: string[];
  chartHeading: string;
  chartText: string;
  chartValues: number[];
  contactIntro: string;
};

type BuiltinRestaurantVariant = {
  key: string;
  planId: "plan-1" | "plan-2" | "plan-3";
  name: string;
  heroTitle: string;
  heroSubtitle: string;
  pageBgColor: string;
  heroBgColor: string;
  navItemBgColor: string;
  navItemBorderColor: string;
  navItemTextColor: string;
  navActiveBgColor: string;
  navActiveBorderColor: string;
  heroBorderColor: string;
  accentColor: string;
  surfaceColor: string;
  surfaceAltColor: string;
  textColor: string;
  entryHeading: string;
  entryItems: string[];
  introHeading: string;
  introText: string;
  featureHeading: string;
  featureItems: string[];
  menuHeading: string;
  menuIntro: string;
  menuFeatureHeading: string;
  menuFeatureItems: string[];
  processHeading: string;
  processText: string;
  processChartType: "bar" | "line" | "pie";
  processLabels: string[];
  processValues: number[];
  menuChartHeading: string;
  menuChartText: string;
  menuChartType: "bar" | "line" | "pie";
  menuChartLabels: string[];
  menuChartValues: number[];
  contactHeading: string;
  contactIntro: string;
  contactItems: string[];
};

const BUILTIN_NEW_MERCHANT_TEMPLATE_VARIANTS: BuiltinServiceStarterVariant[] = [
  {
    key: "fresh",
    planId: "plan-1",
    name: "清爽服务版",
    heroTitle: "把你的服务介绍清楚，让客户更快找到你",
    heroSubtitle: "适合咨询、工作室、门店与个人服务的新用户入门版，先把业务说明、优势和联系方式搭起来。",
    pageBgColor: "#f8fafc",
    navItemBorderColor: "#d7e1ee",
    navActiveBgColor: "#0f172a",
    navActiveBorderColor: "#0f172a",
    heroBorderColor: "#cfe0f7",
    listHeading: "首页建议展示的重点",
    listItems: [
      "一句话介绍你的核心服务",
      "3 到 5 个最常见的服务项目",
      "服务流程或合作方式",
      "联系方式、营业时间或服务区域",
    ],
    servicesIntro: "这一页适合详细写清楚你能做什么。可以按服务类型、套餐、适用对象或交付方式来分组说明，先写核心项目，再补充细节。",
    serviceListHeading: "可直接替换的服务清单",
    serviceListItems: [
      "基础咨询 / 到店沟通",
      "标准服务 / 常规方案",
      "进阶服务 / 定制方案",
      "售后支持 / 二次跟进",
    ],
    chartHeading: "合作流程示意",
    chartText: "把服务流程写清楚，可以降低客户的理解成本。这里可替换成你的阶段流程、响应时效或常见项目占比。",
    chartValues: [1, 2, 3, 4],
    contactIntro: "最后一页建议只放最关键的信息：电话、邮箱、地址、地图和服务时间。这样客户看完介绍后，能直接找到你。",
  },
  {
    key: "flow",
    planId: "plan-2",
    name: "流程说明版",
    heroTitle: "先讲清服务流程，让客户更安心地下单",
    heroSubtitle: "适合顾问、工作室、咨询与项目制服务，把步骤、时间和交付方式先讲明白。",
    pageBgColor: "#f6f5ff",
    navItemBorderColor: "#ddd6fe",
    navActiveBgColor: "#4338ca",
    navActiveBorderColor: "#4338ca",
    heroBorderColor: "#c7d2fe",
    listHeading: "首页建议强调的内容",
    listItems: [
      "你的服务适合什么客户",
      "首次咨询如何开始",
      "标准流程分几步完成",
      "每一步大概需要多久",
    ],
    servicesIntro: "把服务拆成几个阶段，会更适合流程型业务。客户知道从咨询到交付会经历什么，决策会更快。",
    serviceListHeading: "推荐展示的流程节点",
    serviceListItems: [
      "需求沟通 / 信息收集",
      "方案确认 / 时间安排",
      "执行服务 / 中途反馈",
      "结果交付 / 后续跟进",
    ],
    chartHeading: "服务阶段占比",
    chartText: "你可以把每个阶段的工作量、耗时比例或重点项目展示出来，让客户更直观理解服务结构。",
    chartValues: [2, 3, 4, 2],
    contactIntro: "联系页建议继续强调响应时间、接单时间段和主要沟通方式，让客户知道什么时候联系最有效。",
  },
  {
    key: "contact",
    planId: "plan-3",
    name: "快速联系版",
    heroTitle: "把核心服务和联系方式直接摆在前面",
    heroSubtitle: "适合到店、预约、上门与本地服务，客户看完一眼就知道你做什么、怎么联系你。",
    pageBgColor: "#fff7ed",
    navItemBorderColor: "#fed7aa",
    navActiveBgColor: "#c2410c",
    navActiveBorderColor: "#c2410c",
    heroBorderColor: "#fdba74",
    listHeading: "首页建议优先放什么",
    listItems: [
      "你最主要的 3 项服务",
      "服务区域 / 到店方式",
      "营业时间 / 接单时间",
      "电话、地址、即时联系入口",
    ],
    servicesIntro: "如果你的业务以快速沟通、到店或预约为主，这一页建议突出项目简述、适合场景和价格说明。",
    serviceListHeading: "可直接替换的服务项目",
    serviceListItems: [
      "到店咨询 / 快速接待",
      "热门服务 / 高频项目",
      "预约项目 / 时段服务",
      "补充服务 / 上门支持",
    ],
    chartHeading: "热门服务分布",
    chartText: "这里可以换成你的热门项目、成交占比、到店高峰时段或客户最常咨询的服务类型。",
    chartValues: [4, 3, 2, 1],
    contactIntro: "联系页建议把电话、邮箱、地址、地图和主要社交账号都放齐，方便客户立刻联系或导航到店。",
  },
];

const BUILTIN_RESTAURANT_TEMPLATE_VARIANTS: BuiltinRestaurantVariant[] = [
  {
    key: "fresh-order",
    planId: "plan-1",
    name: "轻食点单版",
    heroTitle: "首页先做点单入口，再把招牌组合讲清楚",
    heroSubtitle: "参考 Sweetgreen 这类强转化餐饮官网：首页先给出点单理由和热卖逻辑，再把自定义、取餐和招牌搭配标准化。",
    pageBgColor: "linear-gradient(180deg, #f3f8ec 0%, #eef6d8 34%, #f7fbf0 100%)",
    heroBgColor: "linear-gradient(135deg, #c7ddb9 0%, #b5d1ab 58%, #e8f4dc 100%)",
    navItemBgColor: "#f8fcf2",
    navItemBorderColor: "#c8d8b7",
    navItemTextColor: "#233125",
    navActiveBgColor: "#223b2c",
    navActiveBorderColor: "#223b2c",
    heroBorderColor: "#a9bf8d",
    accentColor: "#223b2c",
    surfaceColor: "#fbfdf8",
    surfaceAltColor: "#d9e8cb",
    textColor: "#233125",
    entryHeading: "快速入口",
    entryItems: [
      "30 秒完成招牌碗 / 沙拉下单",
      "自提、外送与门店堂食一眼分清",
      "热门组合、热量和自定义逻辑前置",
    ],
    introHeading: "为什么这样排",
    introText: "这版首页先像点单入口，再像品牌官网。客户先看到热门组合和最短路径，品牌感、食材理念和门店体验放在第二层补足。",
    featureHeading: "首页最该直接说清楚的事",
    featureItems: [
      "招牌组合适合谁，第一次点什么",
      "可自定义的主菜、酱汁和配料",
      "取餐方式：外送 / 自提 / 到店",
      "门店位置与当前营业时段",
    ],
    menuHeading: "热卖卡片结构",
    menuIntro: "菜单页先做成标准化商品卡片，比直接摆长菜单更容易转化。每张卡片建议都包含图、卖点、热量/份量和可替换项。",
    menuFeatureHeading: "建议优先展示的组合",
    menuFeatureItems: [
      "招牌轻食碗 / 人气最多的默认搭配",
      "高蛋白组合 / 健身友好说明",
      "当天特供 / 季节限定与新品",
      "自定义选项 / 酱汁、主食、加料",
    ],
    processHeading: "下单转化路径",
    processText: "把浏览、挑组合、下单和取餐拆成可感知步骤，首页会更像成熟连锁餐饮官网，不会只像一张介绍页。",
    processChartType: "line",
    processLabels: ["进入首页", "选组合", "确认方式", "完成下单"],
    processValues: [1, 3, 4, 5],
    menuChartHeading: "热卖偏好分布",
    menuChartText: "这块可以直接替换成热卖分类占比，让客户先知道什么最值得点，而不是面对一整页没有重点的菜单。",
    menuChartType: "bar",
    menuChartLabels: ["轻食碗", "热主菜", "甜品", "饮品"],
    menuChartValues: [4, 3, 2, 2],
    contactHeading: "取餐与门店联系",
    contactIntro: "联系页建议直接给出店址、营业时间、取餐方式和客服渠道，让客户看完菜单后立刻能完成最后一步。",
    contactItems: ["高峰午餐时段可提示建议提前下单", "外送范围、自提柜台和堂食信息分开写", "把地图、电话和营业时间都放在同一区块"],
  },
  {
    key: "tracker-blue",
    planId: "plan-2",
    name: "蓝标流程版",
    heroTitle: "先让客户知道怎么点、点完会发生什么，再去看菜单",
    heroSubtitle: "这一版直接照着 Domino's 这类强流程餐饮站去做：第一屏先给点单入口、步骤反馈和手机订单卡，而不是把品牌介绍堆在最前面。",
    pageBgColor: "linear-gradient(180deg, #edf5ff 0%, #d7ebff 38%, #f5f9ff 100%)",
    heroBgColor: "linear-gradient(135deg, #1474b9 0%, #0e5ca8 58%, #1e86cb 100%)",
    navItemBgColor: "#f8fbff",
    navItemBorderColor: "#a5c6ea",
    navItemTextColor: "#11304e",
    navActiveBgColor: "#d9252a",
    navActiveBorderColor: "#d9252a",
    heroBorderColor: "#0e5ca8",
    accentColor: "#123357",
    surfaceColor: "#ffffff",
    surfaceAltColor: "#e4f0fb",
    textColor: "#143151",
    entryHeading: "先走通第一步",
    entryItems: [
      "先输地址或选门店，再决定外送 / 自提",
      "首页直接给套餐入口，不让客户先翻长菜单",
      "把已下单、制作中、可取餐做成页面固定反馈",
    ],
    introHeading: "像点单系统，不像普通官网",
    introText: "这个版本不是让客户先读品牌故事，而是像 Domino's 那样一上来就知道：从哪里开始点、当前流程怎么走、取餐或配送接下来会发生什么。",
    featureHeading: "首页先给客户的 4 个确定感",
    featureItems: [
      "最快的点单入口在哪里",
      "今天最值得点的组合是什么",
      "下单后当前会走到哪一步",
      "自提、外送和门店支持怎么分",
    ],
    menuHeading: "套餐、单点和加购要一眼分层",
    menuIntro: "菜单页继续按 Domino's 这类品牌的逻辑走：先给最稳的套餐，再给单点和加购，不让客户自己在一长串分类里摸索。",
    menuFeatureHeading: "这版更适合直接做成的卡片",
    menuFeatureItems: [
      "单人、双人、家庭这 3 种主套餐",
      "尺寸、边料和口味差异直接前置",
      "加购配菜、饮品、甜品单独收一层",
      "活动入口只保留一个最重要的",
    ],
    processHeading: "状态条要像真的在推进",
    processText: "把下单、门店接单、制作、出餐、配送做成连续状态，比单纯写一句“已下单成功”更有体感，也更像成熟连锁品牌的网站。",
    processChartType: "bar",
    processLabels: ["选门店", "选套餐", "门店接单", "制作中", "准备完成"],
    processValues: [5, 5, 4, 3, 5],
    menuChartHeading: "热卖组合分布",
    menuChartText: "这里更适合表达“主披萨 / 配菜 / 甜品 / 饮品”在一个订单里的组合权重，而不是只做静态介绍。",
    menuChartType: "pie",
    menuChartLabels: ["主品", "配菜", "甜品", "饮品"],
    menuChartValues: [5, 3, 2, 2],
    contactHeading: "门店、配送与异常订单支持",
    contactIntro: "联系页不要只放电话地址，而是要让客户一眼知道配送范围、门店营业时段、改址或异常订单该怎么处理。",
    contactItems: ["配送范围、自提柜台和营业时间要分开写", "订单异常、改址和补差价要有独立联系方式", "活动券和会员入口继续留在首页，不塞进联系页"],
  },
  {
    key: "brand-convert",
    planId: "plan-3",
    name: "品牌转化版",
    heroTitle: "品牌感和点单转化放在同一屏里解决",
    heroSubtitle: "这一版把 Sweetgreen 的清爽品牌表达和 Domino's 的行动导向揉在一起，更适合想做官网感又不想失去转化效率的餐饮商家。",
    pageBgColor: "linear-gradient(180deg, #fff8ef 0%, #fde9d3 34%, #fffdf9 100%)",
    heroBgColor: "linear-gradient(135deg, #fff3df 0%, #f4d4ae 58%, #fff8ee 100%)",
    navItemBgColor: "#fffdf9",
    navItemBorderColor: "#ebc7a0",
    navItemTextColor: "#342722",
    navActiveBgColor: "#1d3d33",
    navActiveBorderColor: "#1d3d33",
    heroBorderColor: "#deb17f",
    accentColor: "#1d3d33",
    surfaceColor: "#fffdf9",
    surfaceAltColor: "#fce7cb",
    textColor: "#342722",
    entryHeading: "首页主动作",
    entryItems: [
      "立即查看招牌组合与门店信息",
      "把首次推荐、热门菜和限时活动做在第一屏",
      "让客户先知道怎么点、再决定要不要细看品牌故事",
    ],
    introHeading: "转化思路",
    introText: "很多餐饮官网的问题不是不好看，而是第一屏没有动作。这个版本强调“先行动，再了解”，让页面既有品牌感，也更有成交指向。",
    featureHeading: "首页应该同时完成的任务",
    featureItems: [
      "让客户立刻知道你卖什么",
      "给出最值得点的 3 到 4 个入口",
      "把营业时段与门店信息提前露出",
      "给出复购理由：套餐、会员或限定款",
    ],
    menuHeading: "招牌卡片与推荐逻辑",
    menuIntro: "菜单页不只是在列项目，而是把“为什么推荐点这个”讲出来。建议每张卡片都具备卖点、适合场景和推荐搭配。",
    menuFeatureHeading: "适合做成重点推荐的内容",
    menuFeatureItems: [
      "品牌招牌 / 新客第一次必点",
      "高复购套餐 / 门店销量前列",
      "限定新品 / 节日活动主推",
      "饮品或甜品搭配建议",
    ],
    processHeading: "客户行动节奏",
    processText: "这块用来表达从首页被吸引，到看菜单、选门店、完成联系或下单的路径。页面自己要帮客户缩短决策时间。",
    processChartType: "line",
    processLabels: ["被吸引", "看推荐", "选门店", "完成行动"],
    processValues: [2, 4, 4, 5],
    menuChartHeading: "推荐区热度",
    menuChartText: "可以替换成新客必点、套餐、甜品和饮品的点击重点，帮助客户理解你最想推什么。",
    menuChartType: "bar",
    menuChartLabels: ["必点", "套餐", "甜品", "饮品"],
    menuChartValues: [5, 4, 3, 2],
    contactHeading: "门店联系与营业提示",
    contactIntro: "联系页建议把到店、自提、活动时段和地图集中在一起，让客户在最后一步不会掉线。",
    contactItems: ["活动、停供和节假日营业建议放在这里同步", "外带、自提和堂食的说明不要混在一起", "如果有多个门店，建议按区域分组展示联系方式"],
  },
];

function createBuiltinServiceStarterPageIds(variantKey: string) {
  return {
    home: `page-service-home-${variantKey}`,
    services: `page-service-offerings-${variantKey}`,
    contact: `page-service-contact-${variantKey}`,
  } as const;
}

function createBuiltinRestaurantPageIds(variantKey: string) {
  return {
    home: `page-restaurant-home-${variantKey}`,
    menu: `page-restaurant-menu-${variantKey}`,
    contact: `page-restaurant-contact-${variantKey}`,
  } as const;
}

function createBuiltinServiceStarterNavItems(variant: BuiltinServiceStarterVariant) {
  const pageIds = createBuiltinServiceStarterPageIds(variant.key);
  return [
    { id: `builtin-nav-home-${variant.key}`, label: "首页", pageId: pageIds.home },
    { id: `builtin-nav-services-${variant.key}`, label: "服务内容", pageId: pageIds.services },
    { id: `builtin-nav-contact-${variant.key}`, label: "联系", pageId: pageIds.contact },
  ];
}

function createBuiltinRestaurantNavItems(variant: BuiltinRestaurantVariant) {
  const pageIds = createBuiltinRestaurantPageIds(variant.key);
  return [
    { id: `builtin-restaurant-nav-home-${variant.key}`, label: "点单入口", pageId: pageIds.home },
    { id: `builtin-restaurant-nav-menu-${variant.key}`, label: "热卖菜单", pageId: pageIds.menu },
    { id: `builtin-restaurant-nav-contact-${variant.key}`, label: "到店联系", pageId: pageIds.contact },
  ];
}

function createBuiltinServiceStarterNavBlock(idSuffix: string, variant: BuiltinServiceStarterVariant): Block {
  return {
    id: `builtin-service-nav-${variant.key}-${idSuffix}`,
    type: "nav",
    props: {
      heading: "",
      navOrientation: "horizontal",
      navItems: createBuiltinServiceStarterNavItems(variant),
      pageBgColor: variant.pageBgColor,
      pageBgColorOpacity: 1,
      navItemBgColor: "#ffffff",
      navItemBgOpacity: 1,
      navItemBorderStyle: "solid",
      navItemBorderColor: variant.navItemBorderColor,
      navItemActiveBgColor: variant.navActiveBgColor,
      navItemActiveBgOpacity: 1,
      navItemActiveBorderStyle: "solid",
      navItemActiveBorderColor: variant.navActiveBorderColor,
      navItemActiveTextColor: "#ffffff",
      fontColor: "#0f172a",
      fontWeight: "bold",
    },
  };
}

function createBuiltinRestaurantNavBlock(idSuffix: string, variant: BuiltinRestaurantVariant): Block {
  return {
    id: `builtin-restaurant-nav-${variant.key}-${idSuffix}`,
    type: "nav",
    props: {
      heading: "",
      navOrientation: "horizontal",
      navItems: createBuiltinRestaurantNavItems(variant),
      pageBgColor: variant.pageBgColor,
      pageBgColorOpacity: 1,
      navItemBgColor: variant.navItemBgColor,
      navItemBgOpacity: 1,
      navItemBorderStyle: "solid",
      navItemBorderColor: variant.navItemBorderColor,
      navItemActiveBgColor: variant.navActiveBgColor,
      navItemActiveBgOpacity: 1,
      navItemActiveBorderStyle: "solid",
      navItemActiveBorderColor: variant.navActiveBorderColor,
      navItemActiveTextColor: "#ffffff",
      fontColor: variant.navItemTextColor,
      fontWeight: "bold",
    },
  };
}

function createBuiltinRestaurantTextBlock(
  id: string,
  heading: string,
  text: string,
  variant: BuiltinRestaurantVariant,
  layout: Partial<BackgroundEditableProps> = {},
): Block {
  return {
    id,
    type: "text",
    props: {
      heading,
      text,
      bgColor: variant.surfaceColor,
      bgColorOpacity: 1,
      blockBorderStyle: "accent",
      blockBorderColor: variant.navItemBorderColor,
      fontColor: variant.textColor,
      ...layout,
    },
  };
}

function createBuiltinRestaurantListBlock(
  id: string,
  heading: string,
  items: string[],
  variant: BuiltinRestaurantVariant,
  layout: Partial<BackgroundEditableProps> = {},
): Block {
  return {
    id,
    type: "list",
    props: {
      heading,
      items,
      bgColor: variant.surfaceAltColor,
      bgColorOpacity: 1,
      blockBorderStyle: "soft",
      blockBorderColor: variant.navItemBorderColor,
      fontColor: variant.textColor,
      ...layout,
    },
  };
}

function createBuiltinRestaurantChartBlock(
  id: string,
  heading: string,
  text: string,
  labels: string[],
  values: number[],
  variant: BuiltinRestaurantVariant,
  layout: Partial<BackgroundEditableProps> = {},
  chartType: BuiltinRestaurantVariant["menuChartType"] = variant.menuChartType,
): Block {
  return {
    id,
    type: "chart",
    props: {
      heading,
      text,
      chartType,
      labels,
      values,
      bgColor: variant.surfaceColor,
      bgColorOpacity: 1,
      blockBorderStyle: "solid",
      blockBorderColor: variant.heroBorderColor,
      fontColor: variant.accentColor,
      ...layout,
    },
  };
}

function createBuiltinRestaurantCommonCardHtml(
  title: string,
  text: string,
  options: {
    background: string;
    borderColor: string;
    accent?: string;
    subtle?: string;
    pill?: string;
    align?: "start" | "center";
  },
) {
  const justify = options.align === "center" ? "center" : "space-between";
  const alignItems = options.align === "center" ? "center" : "flex-start";
  const textAlign = options.align === "center" ? "center" : "left";
  const accent = options.accent ?? "#1f2937";
  const subtle = options.subtle ?? "rgba(15,23,42,0.74)";
  const pillHtml = options.pill
    ? `<div style="display:inline-flex;align-items:center;gap:8px;padding:8px 14px;border-radius:999px;background:#f7ff61;color:#142013;font-size:14px;font-weight:700;">${options.pill}</div>`
    : "";
  return `
    <div style="width:100%;height:100%;padding:24px;border-radius:28px;border:1px solid ${options.borderColor};background:${options.background};box-shadow:0 24px 48px rgba(15,23,42,0.08);display:flex;flex-direction:column;justify-content:${justify};align-items:${alignItems};text-align:${textAlign};">
      <div style="display:flex;flex-direction:column;gap:14px;">
        <div style="font-size:34px;line-height:1.05;font-weight:800;letter-spacing:-0.04em;color:${accent};">${title}</div>
        <div style="font-size:15px;line-height:1.65;color:${subtle};">${text}</div>
      </div>
      ${pillHtml}
    </div>
  `;
}

function createBuiltinRestaurantMiniPhoneHtml(
  heading: string,
  lines: string[],
  options: {
    background: string;
    borderColor: string;
    accent: string;
    badge: string;
  },
) {
  const lineHtml = lines
    .map(
      (line) =>
        `<div style="height:26px;border-radius:13px;background:rgba(255,255,255,0.82);padding:0 12px;display:flex;align-items:center;font-size:13px;color:#1f2937;">${line}</div>`,
    )
    .join("");
  return `
    <div style="width:100%;height:100%;padding:22px;border-radius:28px;border:1px solid ${options.borderColor};background:${options.background};box-shadow:0 24px 48px rgba(15,23,42,0.08);display:flex;align-items:center;justify-content:center;">
      <div style="width:210px;height:100%;max-height:360px;border-radius:34px;border:6px solid #121826;background:#ffffff;padding:16px 14px;display:flex;flex-direction:column;gap:12px;">
        <div style="font-size:14px;font-weight:800;color:${options.accent};letter-spacing:0.01em;">${heading}</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <span style="display:inline-flex;padding:6px 10px;border-radius:999px;background:#eef5ff;font-size:12px;color:#285a8b;">${options.badge}</span>
        </div>
        ${lineHtml}
      </div>
    </div>
  `;
}

function createBuiltinRestaurantStoryboardBlock(variant: BuiltinRestaurantVariant): Block {
  const makeBox = (id: string, html: string, x: number, y: number, width: number, height: number) => ({
    id,
    html,
    x,
    y,
    width,
    height,
  });

  if (variant.key === "fresh-order") {
    return {
      id: `builtin-restaurant-storyboard-home-${variant.key}`,
      type: "common",
      props: {
        bgColor: "transparent",
        bgColorOpacity: 0,
        blockBorderStyle: "none",
        blockWidth: 1080,
        blockHeight: 520,
        commonTextBoxes: [
          makeBox(
            `story-left-${variant.key}`,
            createBuiltinRestaurantCommonCardHtml(
              "Explore our\nnew signature bowl",
              "把首页主区域直接做成首单推荐和核心卖点入口。先告诉客户为什么点、适合谁、能怎么换配料，再给一个很亮的主按钮。",
              {
                background: "linear-gradient(180deg, #c9dcb9 0%, #bdd3ae 100%)",
                borderColor: "#9db38d",
                accent: "#102114",
                subtle: "rgba(16,33,20,0.76)",
                pill: "马上点这一碗",
              },
            ),
            0,
            0,
            390,
            400,
          ),
          makeBox(
            `story-mini-1-${variant.key}`,
            createBuiltinRestaurantCommonCardHtml("Feel-good food", "用窄卡片去承接品牌口号、当季食材或一条很短的价值主张。", {
              background: "linear-gradient(180deg, #d7f2ef 0%, #c4ebe7 100%)",
              borderColor: "#a3d7d0",
              accent: "#16414b",
              subtle: "rgba(22,65,75,0.76)",
              pill: "fresh",
              align: "center",
            }),
            422,
            0,
            146,
            400,
          ),
          makeBox(
            `story-mini-2-${variant.key}`,
            createBuiltinRestaurantCommonCardHtml("Order ahead", "做成外送、自提、堂食这类路径卡，客户会更快知道下一步。", {
              background: "linear-gradient(180deg, #f1f6ff 0%, #d9e7ff 100%)",
              borderColor: "#b8caef",
              accent: "#1a3765",
              subtle: "rgba(26,55,101,0.74)",
              pill: "pickup",
              align: "center",
            }),
            586,
            0,
            146,
            400,
          ),
          makeBox(
            `story-mini-3-${variant.key}`,
            createBuiltinRestaurantCommonCardHtml("Access menu", "第三张窄卡更适合放菜单结构或新品入口，像样板图那样形成节奏。", {
              background: "linear-gradient(180deg, #fff8d8 0%, #faefba 100%)",
              borderColor: "#e7d79d",
              accent: "#4f3f0a",
              subtle: "rgba(79,63,10,0.74)",
              pill: "menu",
              align: "center",
            }),
            750,
            0,
            146,
            400,
          ),
          makeBox(
            `story-phone-${variant.key}`,
            createBuiltinRestaurantMiniPhoneHtml("Signature bowl", ["牛油果 + 烤鸡", "糙米 / 青菜 / 玉米", "加酱汁 / 加配料", "确认自提或外送"], {
              background: "linear-gradient(180deg, #dce8ff 0%, #c9d9f8 100%)",
              borderColor: "#b3c5e6",
              accent: "#244b85",
              badge: "热卖 No.1",
            }),
            914,
            0,
            166,
            400,
          ),
        ],
      },
    };
  }

  if (variant.key === "tracker-blue") {
    const trackerBlackCardHtml = `
      <div style="width:100%;height:100%;padding:24px;border-radius:24px;border:1px solid #262626;background:linear-gradient(180deg, #111111 0%, #050505 100%);box-shadow:0 22px 44px rgba(15,23,42,0.16);display:flex;flex-direction:column;justify-content:space-between;">
        <div style="display:flex;flex-direction:column;gap:18px;">
          <div style="display:inline-flex;width:max-content;padding:5px 11px;border-radius:999px;border:1px solid rgba(255,255,255,0.16);font-size:10px;font-weight:800;letter-spacing:0.18em;color:rgba(255,255,255,0.78);">QUALITY CHECK</div>
          <div style="font-size:29px;line-height:1.04;font-weight:900;letter-spacing:-0.03em;color:#ffffff;text-transform:uppercase;">Red steps are in progress.\nBlue steps are complete.</div>
          <div style="font-size:13px;line-height:1.68;color:rgba(255,255,255,0.7);">先把当前流程和下一步动作说清楚，黑卡就是提醒入口，不承载多余信息。</div>
        </div>
        <div style="display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;">
          <div style="display:inline-flex;align-items:center;justify-content:center;padding:10px 18px;border-radius:8px;background:#ef233c;color:#ffffff;font-size:12px;font-weight:900;letter-spacing:0.06em;text-transform:uppercase;">Skip Intro</div>
          <div style="font-size:11px;color:rgba(255,255,255,0.6);text-transform:uppercase;">外送 / 自提 / 堂食</div>
        </div>
      </div>
    `;
    const trackerBlueCardHtml = `
      <div style="width:100%;height:100%;padding:24px;border-radius:24px;border:1px solid #0b5b98;background:linear-gradient(180deg, #0d78bd 0%, #0a63a7 100%);box-shadow:0 22px 44px rgba(15,23,42,0.12);display:flex;flex-direction:column;justify-content:space-between;position:relative;overflow:hidden;">
        <div style="position:absolute;inset:16px auto auto 18px;display:flex;gap:14px;flex-wrap:wrap;opacity:0.12;font-size:13px;font-weight:800;color:#ffffff;text-transform:uppercase;">
          <span>pizza</span><span>slice</span><span>deal</span><span>hot</span><span>cheese</span><span>order</span><span>box</span>
        </div>
        <div style="position:absolute;inset:auto -30px -36px auto;width:146px;height:146px;border-radius:999px;background:rgba(255,255,255,0.08);"></div>
        <div style="display:flex;flex-direction:column;gap:14px;padding-top:44px;position:relative;z-index:1;">
          <div style="font-size:40px;line-height:1.02;font-weight:900;letter-spacing:-0.04em;color:#ffffff;">Domino's<br/>Redesign</div>
          <div style="font-size:13px;line-height:1.66;color:rgba(255,255,255,0.8);">中间蓝卡像总控面板，解释套餐入口、流程步骤和当前推荐动作。</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <span style="display:inline-flex;padding:8px 12px;border-radius:999px;background:#ffffff;color:#0a63a7;font-size:11px;font-weight:800;">Start order</span>
            <span style="display:inline-flex;padding:8px 12px;border-radius:999px;background:#ffffff;color:#0a63a7;font-size:11px;font-weight:800;">View deals</span>
            <span style="display:inline-flex;padding:8px 12px;border-radius:999px;background:#ffffff;color:#0a63a7;font-size:11px;font-weight:800;">Pizza Tracker</span>
          </div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;position:relative;z-index:1;">
          <span style="display:inline-flex;padding:8px 12px;border-radius:999px;border:1px solid rgba(255,255,255,0.26);color:#ffffff;font-size:11px;font-weight:700;">Order ahead</span>
          <span style="display:inline-flex;padding:8px 12px;border-radius:999px;border:1px solid rgba(255,255,255,0.26);color:#ffffff;font-size:11px;font-weight:700;">Pick up</span>
        </div>
      </div>
    `;
    const trackerPhoneCardHtml = `
      <div style="width:100%;height:100%;padding:22px;border-radius:24px;border:1px solid #0d5da7;background:linear-gradient(180deg, #3db0ff 0%, #1d82dc 100%);box-shadow:0 22px 44px rgba(15,23,42,0.14);display:flex;align-items:center;justify-content:center;position:relative;overflow:hidden;">
        <div style="position:absolute;inset:18px 18px auto auto;display:inline-flex;padding:6px 10px;border-radius:999px;background:rgba(255,255,255,0.22);font-size:11px;font-weight:800;color:#ffffff;">MOBILE ORDER</div>
        <div style="position:absolute;inset:54px 36px auto auto;width:148px;height:250px;border-radius:28px;background:rgba(255,255,255,0.18);transform:rotate(6deg);"></div>
        <div style="width:198px;height:100%;max-height:332px;border-radius:32px;border:6px solid #121826;background:#ffffff;padding:15px 13px;display:flex;flex-direction:column;gap:11px;position:relative;z-index:1;transform:rotate(-10deg);box-shadow:0 18px 36px rgba(15,23,42,0.22);">
          <div style="font-size:14px;font-weight:800;color:#0f3d73;letter-spacing:0.01em;">Pepperoni Combo</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <span style="display:inline-flex;padding:6px 10px;border-radius:999px;background:#eef5ff;font-size:12px;color:#285a8b;">追踪中</span>
            <span style="display:inline-flex;padding:6px 10px;border-radius:999px;background:#fff3f3;font-size:12px;color:#d9252a;">热卖</span>
          </div>
          <div style="height:78px;border-radius:18px;background:linear-gradient(180deg, #e9f4ff 0%, #d5ebff 100%);padding:12px;display:flex;flex-direction:column;justify-content:space-between;">
            <div style="font-size:13px;font-weight:700;color:#143151;">Pizza Tracker</div>
            <div style="display:flex;align-items:center;gap:8px;">
              <span style="width:10px;height:10px;border-radius:999px;background:#d9252a;display:inline-flex;"></span>
              <span style="width:10px;height:10px;border-radius:999px;background:#0e5ca8;display:inline-flex;"></span>
              <span style="width:10px;height:10px;border-radius:999px;background:#0e5ca8;display:inline-flex;opacity:0.45;"></span>
              <span style="width:10px;height:10px;border-radius:999px;background:#0e5ca8;display:inline-flex;opacity:0.25;"></span>
            </div>
          </div>
          <div style="height:24px;border-radius:12px;background:rgba(239,244,255,0.96);padding:0 11px;display:flex;align-items:center;font-size:12px;color:#1f2937;">门店已确认订单</div>
          <div style="height:24px;border-radius:12px;background:rgba(239,244,255,0.96);padding:0 11px;display:flex;align-items:center;font-size:12px;color:#1f2937;">披萨与配菜制作中</div>
          <div style="height:24px;border-radius:12px;background:rgba(239,244,255,0.96);padding:0 11px;display:flex;align-items:center;font-size:12px;color:#1f2937;">预计 14 分钟后完成</div>
          <div style="display:flex;gap:8px;">
            <div style="flex:1;display:inline-flex;align-items:center;justify-content:center;padding:8px 0;border-radius:12px;background:#d9252a;color:#ffffff;font-size:12px;font-weight:800;">重复下单</div>
            <div style="flex:1;display:inline-flex;align-items:center;justify-content:center;padding:8px 0;border-radius:12px;background:#0e5ca8;color:#ffffff;font-size:12px;font-weight:700;">查看订单</div>
          </div>
        </div>
      </div>
    `;
    return {
      id: `builtin-restaurant-storyboard-home-${variant.key}`,
      type: "common",
      props: {
        bgColor: "transparent",
        bgColorOpacity: 0,
        blockBorderStyle: "none",
        blockWidth: 1080,
        blockHeight: 388,
        commonTextBoxes: [
          makeBox(
            `tracker-left-${variant.key}`,
            trackerBlackCardHtml,
            18,
            28,
            316,
            284,
          ),
          makeBox(
            `tracker-middle-${variant.key}`,
            trackerBlueCardHtml,
            382,
            28,
            316,
            284,
          ),
          makeBox(
            `tracker-right-${variant.key}`,
            trackerPhoneCardHtml,
            746,
            28,
            316,
            284,
          ),
        ],
      },
    };
  }

  return {
    id: `builtin-restaurant-storyboard-home-${variant.key}`,
    type: "common",
    props: {
      bgColor: "transparent",
      bgColorOpacity: 0,
      blockBorderStyle: "none",
      blockWidth: 1080,
      blockHeight: 470,
      commonTextBoxes: [
        makeBox(
          `brand-main-${variant.key}`,
          createBuiltinRestaurantCommonCardHtml(
            "Brand first,\norder fast",
            "这一版把品牌感和行动入口放在一块：大卡负责情绪和主叙事，右侧与下方小卡负责首次推荐、活动和门店入口。",
            {
              background: "linear-gradient(180deg, #fff1da 0%, #f7dfbd 100%)",
              borderColor: "#e1bf92",
              accent: "#1d3d33",
              subtle: "rgba(39,32,24,0.74)",
              pill: "先看招牌",
            },
          ),
          0,
          0,
          500,
          360,
        ),
        makeBox(
          `brand-right-top-${variant.key}`,
          createBuiltinRestaurantCommonCardHtml("Best sellers", "用一张更窄的推荐卡承接“首次必点”或“门店热卖”。", {
            background: "linear-gradient(180deg, #f4f7ee 0%, #dfe9d3 100%)",
            borderColor: "#cad9ba",
            accent: "#203c2f",
            subtle: "rgba(32,60,47,0.72)",
            pill: "top picks",
            align: "center",
          }),
          540,
          0,
          240,
          170,
        ),
        makeBox(
          `brand-right-phone-${variant.key}`,
          createBuiltinRestaurantMiniPhoneHtml("Dinner set", ["双人套餐", "加购饮品", "选择门店", "预约到店"], {
            background: "linear-gradient(180deg, #f3efe9 0%, #efe2cf 100%)",
            borderColor: "#d4bda0",
            accent: "#8f5e31",
            badge: "今晚推荐",
          }),
          810,
          0,
          270,
          360,
        ),
        makeBox(
          `brand-bottom-1-${variant.key}`,
          createBuiltinRestaurantCommonCardHtml("会员权益", "把复购理由放在首页，不要等客户滚到最底。", {
            background: "#ffffff",
            borderColor: "#e8d2b2",
            accent: "#1d3d33",
            subtle: "rgba(29,61,51,0.72)",
            align: "center",
          }),
          540,
          200,
          240,
          160,
        ),
      ],
    },
  };
}

function createBuiltinRestaurantMenuShowcaseBlock(variant: BuiltinRestaurantVariant): Block {
  const makeBox = (id: string, html: string, x: number, y: number, width: number, height: number) => ({
    id,
    html,
    x,
    y,
    width,
    height,
  });
  const card = (title: string, subtitle: string, badge: string, bg: string, border: string) =>
    `
      <div style="width:100%;height:100%;padding:22px;border-radius:24px;border:1px solid ${border};background:${bg};display:flex;flex-direction:column;justify-content:space-between;box-shadow:0 18px 38px rgba(15,23,42,0.08);">
        <div style="display:flex;flex-direction:column;gap:12px;">
          <div style="display:inline-flex;width:max-content;padding:7px 12px;border-radius:999px;background:rgba(255,255,255,0.78);font-size:12px;font-weight:700;color:#1f2937;">${badge}</div>
          <div style="font-size:28px;line-height:1.08;font-weight:800;color:${variant.textColor};">${title}</div>
          <div style="font-size:14px;line-height:1.6;color:rgba(15,23,42,0.72);">${subtitle}</div>
        </div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;">
          <span style="display:inline-flex;padding:6px 10px;border-radius:999px;background:rgba(255,255,255,0.85);font-size:12px;">招牌</span>
          <span style="display:inline-flex;padding:6px 10px;border-radius:999px;background:rgba(255,255,255,0.85);font-size:12px;">可加购</span>
        </div>
      </div>
    `;
  if (variant.key === "tracker-blue") {
    return {
      id: `builtin-restaurant-menu-showcase-${variant.key}`,
      type: "common",
      props: {
        bgColor: "transparent",
        bgColorOpacity: 0,
        blockBorderStyle: "none",
        blockWidth: 1080,
        blockHeight: 430,
        commonTextBoxes: [
          makeBox(
            "card-1",
            card(
              "先推最稳的家庭套餐",
              "像 Domino's 那样先给最容易下单的套餐入口，让客户不用先理解全部菜单结构。",
              "BEST VALUE",
              "linear-gradient(180deg, #f5fbff 0%, #dceeff 100%)",
              "#b7d2ef",
            ),
            0,
            0,
            340,
            320,
          ),
          makeBox(
            "card-2",
            card(
              "尺寸、边料、口味写清楚",
              "第二张卡直接承接最常见的决策项：尺寸、边料、口味和适合几个人。",
              "STEP 02",
              "linear-gradient(180deg, #ffffff 0%, #f7f9fc 100%)",
              "#ced9e7",
            ),
            370,
            0,
            340,
            320,
          ),
          makeBox(
            "card-3",
            card(
              "加购和流程提示单独收口",
              "右侧卡片继续负责配菜、甜品和订单进度，让菜单页延续首页的流程心智。",
              "TRACKER",
              "linear-gradient(180deg, #e7f2ff 0%, #cfe5ff 100%)",
              "#a8c7eb",
            ),
            740,
            0,
            340,
            320,
          ),
        ],
      },
    };
  }
  return {
    id: `builtin-restaurant-menu-showcase-${variant.key}`,
    type: "common",
    props: {
      bgColor: "transparent",
      bgColorOpacity: 0,
      blockBorderStyle: "none",
      blockWidth: 1080,
      blockHeight: 430,
      commonTextBoxes: [
        makeBox("card-1", card("招牌组合", "第一张卡就应该是新客最容易点的默认组合。", "NEW", "#f3f8ec", "#cadeb2"), 0, 0, 340, 320),
        makeBox("card-2", card("高峰套餐", "用第二张卡解释双人或多人分享的点法。", "POPULAR", "#fff0df", "#ebc493"), 370, 0, 340, 320),
        makeBox("card-3", card("加购甜品", "第三张卡专门承接饮品、甜品和附加项。", "ADD-ON", "#e7f1ff", "#b8ceef"), 740, 0, 340, 320),
      ],
    },
  };
}

function createBuiltinServiceStarterPages(variant: BuiltinServiceStarterVariant): PlanPage[] {
  const pageIds = createBuiltinServiceStarterPageIds(variant.key);
  return [
    {
      id: pageIds.home,
      name: "首页",
      blocks: [
        createBuiltinServiceStarterNavBlock("home", variant),
        {
          id: `builtin-service-hero-home-${variant.key}`,
          type: "hero",
          props: {
            title: variant.heroTitle,
            subtitle: variant.heroSubtitle,
            bgColor: variant.pageBgColor,
            bgColorOpacity: 1,
            blockBorderStyle: "solid",
            blockBorderColor: variant.heroBorderColor,
            fontColor: "#0f172a",
          },
        },
        {
          id: `builtin-service-text-home-${variant.key}`,
          type: "text",
          props: {
            heading: "你可以先写什么",
            text: "用一小段文字说明主营服务、适合的人群、服务区域或到店方式。先把最常被问到的问题写清楚，客户会更容易理解你提供什么。",
            bgColor: "#ffffff",
            bgColorOpacity: 1,
            blockBorderStyle: "solid",
            blockBorderColor: "#e2e8f0",
          },
        },
        {
          id: `builtin-service-list-home-${variant.key}`,
          type: "list",
          props: {
            heading: variant.listHeading,
            items: variant.listItems,
            bgColor: "#ffffff",
            bgColorOpacity: 1,
            blockBorderStyle: "solid",
            blockBorderColor: "#e2e8f0",
          },
        },
      ],
    },
    {
      id: pageIds.services,
      name: "服务内容",
      blocks: [
        createBuiltinServiceStarterNavBlock("services", variant),
        {
          id: `builtin-service-text-offerings-${variant.key}`,
          type: "text",
          props: {
            heading: "服务内容",
            text: variant.servicesIntro,
            bgColor: "#ffffff",
            bgColorOpacity: 1,
            blockBorderStyle: "solid",
            blockBorderColor: "#e2e8f0",
          },
        },
        {
          id: `builtin-service-list-offerings-${variant.key}`,
          type: "list",
          props: {
            heading: variant.serviceListHeading,
            items: variant.serviceListItems,
            bgColor: "#ffffff",
            bgColorOpacity: 1,
            blockBorderStyle: "solid",
            blockBorderColor: "#e2e8f0",
          },
        },
        {
          id: `builtin-service-chart-process-${variant.key}`,
          type: "chart",
          props: {
            heading: variant.chartHeading,
            text: variant.chartText,
            chartType: "bar",
            labels: ["咨询", "确认", "执行", "交付"],
            values: variant.chartValues,
            bgColor: "#ffffff",
            bgColorOpacity: 1,
            blockBorderStyle: "solid",
            blockBorderColor: "#e2e8f0",
          },
        },
      ],
    },
    {
      id: pageIds.contact,
      name: "联系",
      blocks: [
        createBuiltinServiceStarterNavBlock("contact", variant),
        {
          id: `builtin-service-text-contact-${variant.key}`,
          type: "text",
          props: {
            heading: "联系与到店信息",
            text: variant.contactIntro,
            bgColor: "#ffffff",
            bgColorOpacity: 1,
            blockBorderStyle: "solid",
            blockBorderColor: "#e2e8f0",
          },
        },
        {
          id: `builtin-service-contact-${variant.key}`,
          type: "contact",
          props: {
            heading: "联系方式",
            phone: "",
            phones: [],
            address: "",
            addresses: [],
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
            mapZoom: 13,
            mapType: "roadmap",
            mapShowMarker: true,
            bgColor: "#ffffff",
            bgColorOpacity: 1,
            blockBorderStyle: "solid",
            blockBorderColor: "#e2e8f0",
          },
        },
      ],
    },
  ];
}

function createBuiltinRestaurantPages(variant: BuiltinRestaurantVariant): PlanPage[] {
  const pageIds = createBuiltinRestaurantPageIds(variant.key);
  const homeNoteText =
    variant.key === "tracker-blue"
      ? "这一屏直接照着强流程餐饮站来排：左边先给状态提醒，中间放蓝色流程卡，右边再用手机订单卡承接点单和追踪。"
      : "这一屏不是普通官网介绍，而是参考主流餐饮官网的转化首页：先把行动入口、热卖内容和流程提示摆出来，再补品牌说明。";
  const menuNoteText =
    variant.key === "tracker-blue"
      ? "这版菜单页继续照着 Domino's 的方式走：先给最稳的套餐入口，再把尺寸、边料和加购拆清楚，让客户按步骤选而不是自己猜。"
      : "参考主流餐饮官网时，最重要的不是照搬版式，而是先把“最值得点什么、怎么点、点完会怎样”这三件事讲清楚。这样页面才会既好看又有转化力。";
  return [
    {
      id: pageIds.home,
      name: "首页",
      blocks: [
        createBuiltinRestaurantNavBlock("home", variant),
        createBuiltinRestaurantStoryboardBlock(variant),
        createBuiltinRestaurantTextBlock(
          `builtin-restaurant-text-home-${variant.key}`,
          variant.introHeading,
          variant.introText,
          variant,
          {
            blockWidth: 520,
            blockOffsetX: -120,
            blockOffsetY: -14,
            blockLayer: 2,
          },
        ),
        createBuiltinRestaurantListBlock(
          `builtin-restaurant-list-home-${variant.key}`,
          variant.featureHeading,
          variant.featureItems,
          variant,
          {
            blockWidth: 430,
            blockOffsetX: 200,
            blockOffsetY: -220,
            blockLayer: 3,
          },
        ),
        createBuiltinRestaurantTextBlock(
          `builtin-restaurant-home-note-${variant.key}`,
          "为什么这样排",
          homeNoteText,
          variant,
          {
            blockWidth: 940,
            blockOffsetY: -90,
            blockLayer: 1,
          },
        ),
      ],
    },
    {
      id: pageIds.menu,
      name: "菜单精选",
      blocks: [
        createBuiltinRestaurantNavBlock("menu", variant),
        createBuiltinRestaurantTextBlock(
          `builtin-restaurant-text-menu-${variant.key}`,
          variant.menuHeading,
          variant.menuIntro,
          variant,
          {
            blockWidth: 1040,
          },
        ),
        createBuiltinRestaurantMenuShowcaseBlock(variant),
        createBuiltinRestaurantListBlock(
          `builtin-restaurant-list-menu-${variant.key}`,
          variant.menuFeatureHeading,
          variant.menuFeatureItems,
          variant,
          {
            blockWidth: 500,
            blockOffsetX: -150,
            blockOffsetY: -34,
          },
        ),
        createBuiltinRestaurantTextBlock(
          `builtin-restaurant-text-menu-note-${variant.key}`,
          "页面排版建议",
          menuNoteText,
          variant,
          {
            blockWidth: 520,
            blockOffsetX: 210,
            blockOffsetY: -280,
            blockLayer: 3,
          },
        ),
        createBuiltinRestaurantChartBlock(
          `builtin-restaurant-chart-menu-${variant.key}`,
          variant.menuChartHeading,
          variant.menuChartText,
          variant.menuChartLabels,
          variant.menuChartValues,
          variant,
          {
            blockWidth: 960,
            blockOffsetY: -100,
          },
          variant.menuChartType,
        ),
      ],
    },
    {
      id: pageIds.contact,
      name: "到店联系",
      blocks: [
        createBuiltinRestaurantNavBlock("contact", variant),
        createBuiltinRestaurantTextBlock(
          `builtin-restaurant-text-contact-${variant.key}`,
          variant.contactHeading,
          variant.contactIntro,
          variant,
          {
            blockWidth: 700,
            blockOffsetX: -70,
          },
        ),
        createBuiltinRestaurantListBlock(
          `builtin-restaurant-list-contact-${variant.key}`,
          "到店提示",
          variant.contactItems,
          variant,
          {
            blockWidth: 410,
            blockOffsetX: 260,
            blockOffsetY: -170,
            blockLayer: 3,
          },
        ),
        {
          id: `builtin-restaurant-contact-${variant.key}`,
          type: "contact",
          props: {
            heading: "门店信息",
            phone: "",
            phones: [],
            address: "",
            addresses: [],
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
            mapZoom: 14,
            mapType: "roadmap",
            mapShowMarker: true,
            bgColor: variant.surfaceColor,
            bgColorOpacity: 1,
            blockBorderStyle: "accent",
            blockBorderColor: variant.heroBorderColor,
            blockWidth: 980,
            blockOffsetY: -70,
            fontColor: variant.textColor,
          },
        },
      ],
    },
  ];
}

function createBuiltinServiceStarterPlanConfig(): PagePlanConfig {
  return {
    activePlanId: "plan-1",
    plans: BUILTIN_NEW_MERCHANT_TEMPLATE_VARIANTS.map((variant) => {
      const pages = createBuiltinServiceStarterPages(variant);
      return {
        id: variant.planId,
        name: variant.name,
        blocks: pages[0]?.blocks ?? [],
        pages,
        activePageId: createBuiltinServiceStarterPageIds(variant.key).home,
      };
    }),
  };
}

function createBuiltinPlanTemplates(): PlanTemplate[] {
  const serviceConfig = createBuiltinServiceStarterPlanConfig();
  const restaurantConfig: PagePlanConfig = {
    activePlanId: "plan-1",
    plans: BUILTIN_RESTAURANT_TEMPLATE_VARIANTS.map((variant) => {
      const pages = createBuiltinRestaurantPages(variant);
      return {
        id: variant.planId,
        name: variant.name,
        blocks: pages[0]?.blocks ?? [],
        pages,
        activePageId: createBuiltinRestaurantPageIds(variant.key).home,
      };
    }),
  };
  return [
    {
      id: BUILTIN_NEW_MERCHANT_TEMPLATE_ID,
      name: "新用户服务入门版",
      category: "服务",
      sourceSiteId: "builtin:new-merchant-service",
      sourceSiteName: "FAOLLA 内置模板",
      sourceSiteDomain: "faolla.com",
      sourceIndustry: "服务",
      coverImageUrl: "",
      previewImageUrl: "",
      planPreviewImageUrls: {},
      previewVariant: "",
      blocks: buildCombinedPersistedBlocks(serviceConfig, serviceConfig),
      createdAt: BUILTIN_NEW_MERCHANT_TEMPLATE_TIMESTAMP,
      updatedAt: BUILTIN_NEW_MERCHANT_TEMPLATE_TIMESTAMP,
    },
    {
      id: BUILTIN_RESTAURANT_TEMPLATE_ID,
      name: "餐饮品牌官网版",
      category: "餐饮",
      sourceSiteId: "builtin:restaurant-signature",
      sourceSiteName: "FAOLLA 内置模板",
      sourceSiteDomain: "faolla.com",
      sourceIndustry: "餐饮",
      coverImageUrl: "",
      previewImageUrl: "",
      planPreviewImageUrls: {},
      previewVariant: "",
      blocks: buildCombinedPersistedBlocks(restaurantConfig, restaurantConfig),
      createdAt: BUILTIN_NEW_MERCHANT_TEMPLATE_TIMESTAMP,
      updatedAt: BUILTIN_NEW_MERCHANT_TEMPLATE_TIMESTAMP,
    },
  ];
}

function normalizeIndustryCategories(input: unknown): IndustryCategory[] {
  if (!Array.isArray(input)) return [];
  const fallbackById: Record<string, { name: string; description: string; slug: string }> = {
    "cat-brand-site": {
      name: "品牌官网",
      description: "品牌介绍、企业形象与服务能力展示",
      slug: "brand-site",
    },
    "cat-campaign": {
      name: "营销活动",
      description: "活动报名、限时促销、专题着陆页",
      slug: "campaign",
    },
    "cat-service": {
      name: "本地服务",
      description: "到店服务、预约咨询、服务介绍",
      slug: "local-service",
    },
  };
  const rows: IndustryCategory[] = [];
  input.forEach((item, idx) => {
    if (!item || typeof item !== "object") return;
    const row = item as Partial<IndustryCategory>;
    if (typeof row.id !== "string" || typeof row.name !== "string") return;
    const fallback = fallbackById[row.id];
    const slug =
      typeof row.slug === "string" && row.slug.trim()
        ? row.slug.trim()
        : fallback?.slug ?? row.id;
    const name = fallback?.name ?? row.name;
    const description = fallback?.description ?? (typeof row.description === "string" ? row.description : "");
    rows.push({
      id: row.id,
      name,
      slug,
      description,
      parentId: typeof row.parentId === "string" && row.parentId ? row.parentId : null,
      sortOrder:
        typeof row.sortOrder === "number" && Number.isFinite(row.sortOrder)
          ? Math.max(0, Math.round(row.sortOrder))
          : (idx + 1) * 10,
      status: row.status === "inactive" ? "inactive" : "active",
      createdAt: typeof row.createdAt === "string" ? row.createdAt : nowIso(),
      updatedAt: typeof row.updatedAt === "string" ? row.updatedAt : nowIso(),
    });
  });
  return rows;
}

function normalizePlanTemplateBlocks(value: unknown) {
  if (!Array.isArray(value)) return [] as unknown[];
  try {
    return JSON.parse(JSON.stringify(value)) as unknown[];
  } catch {
    return [] as unknown[];
  }
}

function normalizePlanTemplatePreviewImages(value: unknown) {
  if (!value || typeof value !== "object") return {} as Record<string, string>;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .map(([key, url]) => [normalizeText(key), normalizeText(url)] as const)
      .filter(([key, url]) => key && url),
  );
}

function normalizePlanTemplate(value: unknown): PlanTemplate | null {
  const source = value && typeof value === "object" ? (value as Partial<PlanTemplate>) : null;
  if (!source) return null;
  const id = normalizeText(source.id);
  if (!id) return null;
  const current = nowIso();
  return {
    id,
    name: normalizeText(source.name) || "未命名方案",
    category: resolvePlanTemplateCategory(source.category),
    sourceSiteId: normalizeText(source.sourceSiteId),
    sourceSiteName: normalizeText(source.sourceSiteName),
    sourceSiteDomain: normalizeText(source.sourceSiteDomain),
    sourceIndustry: normalizeSiteIndustry(source.sourceIndustry),
    coverImageUrl: normalizeText(source.coverImageUrl) || extractPlanTemplateCoverImage(source.blocks),
    previewImageUrl: normalizeText(source.previewImageUrl),
    planPreviewImageUrls: normalizePlanTemplatePreviewImages(source.planPreviewImageUrls),
    previewVariant: normalizeText((source as { previewVariant?: unknown }).previewVariant),
    blocks: normalizePlanTemplateBlocks(source.blocks),
    createdAt: normalizeText(source.createdAt) || current,
    updatedAt: normalizeText(source.updatedAt) || normalizeText(source.createdAt) || current,
  };
}

function normalizePlanTemplates(value: unknown): PlanTemplate[] {
  const rows = Array.isArray(value)
    ? value
        .map((item) => normalizePlanTemplate(item))
        .filter((item): item is PlanTemplate => !!item)
    : [];
  const unique = new Map<string, PlanTemplate>();
  const builtinTemplates = createBuiltinPlanTemplates();
  const builtinById = new Map(builtinTemplates.map((item) => [item.id, item] as const));
  for (const row of builtinTemplates) {
    unique.set(row.id, row);
  }
  for (const row of rows) {
    const builtin = builtinById.get(row.id);
    if (builtin) {
      unique.set(row.id, {
        ...builtin,
        name: row.name.trim() || builtin.name,
        category: row.category,
        createdAt: row.createdAt || builtin.createdAt,
        updatedAt: row.updatedAt || builtin.updatedAt,
      });
      continue;
    }
    unique.set(row.id, row);
  }
  return [...unique.values()].sort((left, right) => {
    const leftTime = new Date(left.updatedAt).getTime();
    const rightTime = new Date(right.updatedAt).getTime();
    return (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0);
  });
}

function normalizeHomeLayout(input: unknown, categories: IndustryCategory[]): HomeLayoutConfig {
  const fallback = createDefaultHomeLayoutConfig();
  const validCategoryIds = new Set(categories.map((item) => item.id));
  if (!input || typeof input !== "object") return fallback;
  const record = input as Partial<HomeLayoutConfig>;
  const sectionsSource = Array.isArray(record.sections) ? record.sections : [];
  const sections: HomeLayoutSection[] = sectionsSource
    .map((item, idx) => {
      if (!item || typeof item !== "object") return null;
      const row = item as Partial<HomeLayoutSection>;
      if (typeof row.id !== "string" || typeof row.title !== "string") return null;
      const categoryId =
        typeof row.categoryId === "string" && validCategoryIds.has(row.categoryId)
          ? row.categoryId
          : categories[0]?.id ?? "";
      return {
        id: row.id,
        title: row.title,
        description: typeof row.description === "string" ? row.description : "",
        categoryId,
        sortOrder:
          typeof row.sortOrder === "number" && Number.isFinite(row.sortOrder)
            ? Math.max(0, Math.round(row.sortOrder))
            : (idx + 1) * 10,
        visible: row.visible !== false,
      };
    })
    .filter((item): item is HomeLayoutSection => item !== null)
    .sort((a, b) => a.sortOrder - b.sortOrder);

  const featuredCategoryIds = Array.isArray(record.featuredCategoryIds)
    ? record.featuredCategoryIds.filter((id): id is string => typeof id === "string" && validCategoryIds.has(id))
    : [];

  return {
    heroTitle: typeof record.heroTitle === "string" ? record.heroTitle : fallback.heroTitle,
    heroSubtitle: typeof record.heroSubtitle === "string" ? record.heroSubtitle : fallback.heroSubtitle,
    featuredCategoryIds: featuredCategoryIds.length ? featuredCategoryIds : fallback.featuredCategoryIds.filter((id) => validCategoryIds.has(id)),
    merchantDefaultSortRule: normalizeMerchantSortRule(record.merchantDefaultSortRule),
    sections: sections.length ? sections : fallback.sections.filter((item) => validCategoryIds.has(item.categoryId)),
  };
}

export function createFeaturePackage(kind: "basic" | "standard" | "enterprise") {
  const flags = ensureFeatureFlags();
  if (kind === "basic") {
    flags.multi_page_editor = true;
    flags.custom_domain = true;
    return flags;
  }
  if (kind === "standard") {
    flags.multi_page_editor = true;
    flags.custom_domain = true;
    flags.schedule_publish = true;
    flags.advanced_analytics = true;
    flags.member_center = true;
    return flags;
  }
  FEATURE_CATALOG.forEach((feature) => {
    flags[feature.key] = true;
  });
  return flags;
}

function createDefaultState(): PlatformState {
  const current = nowIso();
  const tenantId = "tenant-demo";
  const siteA = "site-main";
  const siteB = "site-sub";
  const industryCategories = createDefaultIndustryCategories();
  const homeLayout = createDefaultHomeLayoutConfig();

  return {
    version: 1,
    tenants: [
      {
        id: tenantId,
        name: "Fafona 平台演示租户",
        owner: "owner@fafona.com",
        status: "active",
        createdAt: current,
        updatedAt: current,
      },
    ],
    sites: [
      {
        id: siteA,
        tenantId,
        merchantName: "",
        domainSuffix: "",
        contactAddress: "",
        contactName: "",
        contactPhone: "",
        contactEmail: "",
        name: "总站首页",
        domain: "main.fafona.com",
        categoryId: "cat-brand-site",
        category: "品牌官网",
        industry: "",
        status: "online",
        publishedVersion: 3,
        lastPublishedAt: current,
        features: createFeaturePackage("enterprise"),
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
        chatAvatarImageUrl: "",
        contactVisibility: createDefaultMerchantContactVisibility(),
        businessCards: [],
        sortConfig: createDefaultMerchantSortConfig(),
        configHistory: [],
        createdAt: current,
        updatedAt: current,
      },
      {
        id: siteB,
        tenantId,
        merchantName: "",
        domainSuffix: "",
        contactAddress: "",
        contactName: "",
        contactPhone: "",
        contactEmail: "",
        name: "活动分站",
        domain: "campaign.fafona.com",
        categoryId: "cat-campaign",
        category: "营销活动",
        industry: "",
        status: "maintenance",
        publishedVersion: 1,
        lastPublishedAt: current,
        features: createFeaturePackage("standard"),
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
        chatAvatarImageUrl: "",
        contactVisibility: createDefaultMerchantContactVisibility(),
        businessCards: [],
        sortConfig: createDefaultMerchantSortConfig(),
        configHistory: [],
        createdAt: current,
        updatedAt: current,
      },
    ],
    planTemplates: createBuiltinPlanTemplates(),
    industryCategories,
    homeLayout,
    roles: [
      {
        id: "role-super-admin",
        name: "平台超级管理员",
        description: "拥有平台全部权限。",
        permissions: [...ALL_PERMISSIONS],
        createdAt: current,
        updatedAt: current,
      },
      {
        id: "role-tenant-admin",
        name: "租户管理员",
        description: "管理租户内站点、用户与发布。",
        permissions: [
          "dashboard.view",
          "tenant.view",
          "site.view",
          "site.manage",
          "user.view",
          "user.manage",
          "feature.manage",
          "page_asset.view",
          "page_asset.manage",
          "publish.view",
          "publish.trigger",
          "rollback.trigger",
          "approval.view",
          "audit.view",
        ],
        createdAt: current,
        updatedAt: current,
      },
      {
        id: "role-auditor",
        name: "审计员",
        description: "仅查看发布、审批、审计与告警。",
        permissions: [
          "dashboard.view",
          "site.view",
          "publish.view",
          "approval.view",
          "audit.view",
          "alert.manage",
        ],
        createdAt: current,
        updatedAt: current,
      },
    ],
    users: [
      {
        id: "user-platform-admin",
        name: "平台管理员",
        email: "admin@fafona.com",
        department: "平台运营",
        tenantIds: [tenantId],
        siteIds: [siteA, siteB],
        roleIds: ["role-super-admin"],
        status: "active",
        createdAt: current,
        updatedAt: current,
      },
      {
        id: "user-tenant-admin",
        name: "租户负责人",
        email: "tenant@fafona.com",
        department: "租户运营",
        tenantIds: [tenantId],
        siteIds: [siteA],
        roleIds: ["role-tenant-admin"],
        status: "active",
        createdAt: current,
        updatedAt: current,
      },
      {
        id: "user-auditor",
        name: "审计同学",
        email: "audit@fafona.com",
        department: "风控审计",
        tenantIds: [tenantId],
        siteIds: [siteA, siteB],
        roleIds: ["role-auditor"],
        status: "active",
        createdAt: current,
        updatedAt: current,
      },
    ],
    pageAssets: [
      {
        id: "asset-home",
        siteId: siteA,
        pagePath: "/",
        group: "首页",
        tags: ["品牌", "导航", "首页"],
        status: "published",
        updatedBy: "平台管理员",
        updatedAt: current,
      },
      {
        id: "asset-campaign",
        siteId: siteB,
        pagePath: "/campaign/spring",
        group: "活动页",
        tags: ["促销", "活动", "春季"],
        status: "draft",
        updatedBy: "租户负责人",
        updatedAt: current,
      },
    ],
    publishRecords: [
      {
        id: "publish-seed-1",
        tenantId,
        siteId: siteA,
        version: 3,
        status: "success",
        operator: "平台管理员",
        notes: "基础版本发布成功",
        at: current,
      },
    ],
    approvals: [
      {
        id: "approval-seed-1",
        type: "publish",
        tenantId,
        siteId: siteB,
        summary: "活动分站发布申请（含资源更新）",
        requestedBy: "租户负责人",
        requestedAt: current,
        status: "pending",
        handledBy: null,
        handledAt: null,
        resultNote: "",
      },
    ],
    alerts: [
      {
        id: "alert-seed-1",
        level: "warning",
        title: "活动分站处于维护状态",
        message: "站点 campaign.fafona.com 当前状态为维护中，请确认发布时间。",
        createdAt: current,
        resolvedAt: null,
        resolvedBy: null,
      },
    ],
    audits: [
      {
        id: "audit-seed-1",
        at: current,
        operator: "system",
        action: "seed_initialized",
        targetType: "platform",
        targetId: "default",
        detail: "已生成总后台默认演示数据。",
      },
    ],
  };
}
function normalizeState(input: PlatformState): PlatformState {
  const industryCategoriesRaw = normalizeIndustryCategories((input as Partial<PlatformState>).industryCategories);
  const industryCategories =
    industryCategoriesRaw.length > 0 ? industryCategoriesRaw : createDefaultIndustryCategories();
  const homeLayout = normalizeHomeLayout((input as Partial<PlatformState>).homeLayout, industryCategories);
  const categoryNameMap = new Map(industryCategories.map((item) => [item.id, item.name]));

  return {
    ...input,
    version: typeof input.version === "number" && Number.isFinite(input.version) ? input.version : 1,
    tenants: Array.isArray(input.tenants) ? input.tenants : [],
    sites: Array.isArray(input.sites)
        ? input.sites.map((site, idx) => ({
            ...(function () {
              const normalizedDomainPrefix = normalizeText(
                (site as { domainPrefix?: unknown }).domainPrefix ?? (site as { domainSuffix?: unknown }).domainSuffix,
              ).toLowerCase();
              return {
                domainPrefix: normalizedDomainPrefix,
                domainSuffix: normalizedDomainPrefix,
              };
            })(),
            ...site,
            merchantName: normalizeText((site as { merchantName?: unknown }).merchantName),
            signature: normalizeText((site as { signature?: unknown }).signature),
            domainPrefix: normalizeText(
              (site as { domainPrefix?: unknown }).domainPrefix ?? (site as { domainSuffix?: unknown }).domainSuffix,
            ).toLowerCase(),
            domainSuffix: normalizeText(
              (site as { domainPrefix?: unknown }).domainPrefix ?? (site as { domainSuffix?: unknown }).domainSuffix,
            ).toLowerCase(),
            contactAddress: normalizeText((site as { contactAddress?: unknown }).contactAddress),
            contactName: normalizeText((site as { contactName?: unknown }).contactName),
            contactPhone: normalizeText((site as { contactPhone?: unknown }).contactPhone),
            contactEmail: normalizeText((site as { contactEmail?: unknown }).contactEmail),
            categoryId: typeof site.categoryId === "string" ? site.categoryId : "",
          category:
            typeof site.category === "string" && site.category.trim()
              ? site.category
              : categoryNameMap.get(site.categoryId) ?? "未分类",
          industry: normalizeSiteIndustry(site.industry),
          features: ensureFeatureFlags(site.features),
          location: normalizeSiteLocation(site.location, `${site.id ?? idx}-${site.name ?? ""}-${site.domain ?? ""}`),
          serviceExpiresAt:
            typeof (site as { serviceExpiresAt?: unknown }).serviceExpiresAt === "string" &&
            normalizeText((site as { serviceExpiresAt?: unknown }).serviceExpiresAt)
              ? normalizeText((site as { serviceExpiresAt?: unknown }).serviceExpiresAt)
              : null,
          permissionConfig: normalizeMerchantPermissionConfig((site as { permissionConfig?: unknown }).permissionConfig),
          merchantCardImageUrl: normalizeText((site as { merchantCardImageUrl?: unknown }).merchantCardImageUrl),
          merchantCardImageOpacity: normalizeUnitInterval((site as { merchantCardImageOpacity?: unknown }).merchantCardImageOpacity, 1),
          chatAvatarImageUrl: normalizeText((site as { chatAvatarImageUrl?: unknown }).chatAvatarImageUrl),
          contactVisibility: normalizeMerchantContactVisibility((site as { contactVisibility?: unknown }).contactVisibility),
          businessCards: normalizeMerchantBusinessCards((site as { businessCards?: unknown }).businessCards),
          sortConfig: normalizeMerchantSortConfig((site as { sortConfig?: unknown }).sortConfig),
          configHistory: normalizeMerchantConfigHistory((site as { configHistory?: unknown }).configHistory),
        }))
      : [],
    planTemplates: normalizePlanTemplates((input as Partial<PlatformState>).planTemplates),
    industryCategories,
    homeLayout,
    roles: Array.isArray(input.roles) ? input.roles : [],
    users: Array.isArray(input.users) ? input.users : [],
    pageAssets: Array.isArray(input.pageAssets) ? input.pageAssets : [],
    publishRecords: Array.isArray(input.publishRecords) ? input.publishRecords.slice(0, MAX_PUBLISH_RECORDS) : [],
    approvals: Array.isArray(input.approvals) ? input.approvals.slice(0, MAX_APPROVAL_RECORDS) : [],
    alerts: Array.isArray(input.alerts) ? input.alerts.slice(0, MAX_ALERT_RECORDS) : [],
    audits: Array.isArray(input.audits) ? input.audits.slice(0, MAX_AUDIT_RECORDS) : [],
  };
}

export function loadPlatformState(): PlatformState {
  if (typeof window === "undefined") return createDefaultState();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const seeded = createDefaultState();
      savePlatformState(seeded);
      return seeded;
    }
    const parsed = JSON.parse(raw) as PlatformState;
    if (!parsed || typeof parsed !== "object") {
      const seeded = createDefaultState();
      savePlatformState(seeded);
      return seeded;
    }
    const normalized = normalizeState(parsed);
    const storedHistory = loadMerchantConfigHistoryStore();
    const mergedHistoryStore = buildMerchantConfigHistoryStore(normalized, storedHistory);
    const nextState = applyMerchantConfigHistoryStore(normalized, mergedHistoryStore);
    const hasInlineHistory = normalized.sites.some((site) => (site.configHistory?.length ?? 0) > 0);
    const hasStoredHistoryKey = localStorage.getItem(MERCHANT_CONFIG_HISTORY_STORAGE_KEY) !== null;
    if (hasInlineHistory || (!hasStoredHistoryKey && Object.keys(mergedHistoryStore).length > 0)) {
      persistPlatformState(nextState, mergedHistoryStore, { emitEvent: false });
    }
    return nextState;
  } catch {
    const seeded = createDefaultState();
    savePlatformState(seeded);
    return seeded;
  }
}

export function savePlatformState(state: PlatformState) {
  if (typeof window === "undefined") return false;
  const normalized = normalizeState(state);
  const currentHistoryStore = loadMerchantConfigHistoryStore();
  const nextHistoryStore = buildMerchantConfigHistoryStore(normalized, currentHistoryStore);
  const nextState = applyMerchantConfigHistoryStore(normalized, nextHistoryStore);
  return persistPlatformState(nextState, nextHistoryStore, { emitEvent: true });
}

export function subscribePlatformState(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY || event.key === MERCHANT_CONFIG_HISTORY_STORAGE_KEY) onChange();
  };
  const onCustom = () => onChange();
  window.addEventListener("storage", onStorage);
  window.addEventListener(STORE_EVENT, onCustom);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(STORE_EVENT, onCustom);
  };
}

export function createAuditRecord(input: {
  operator: string;
  action: string;
  targetType: string;
  targetId: string;
  detail: string;
}): AuditRecord {
  return {
    id: nextId("audit"),
    at: nowIso(),
    operator: input.operator,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId,
    detail: input.detail,
  };
}

export function createAlertRecord(input: {
  level: AlertLevel;
  title: string;
  message: string;
}): AlertRecord {
  return {
    id: nextId("alert"),
    level: input.level,
    title: input.title,
    message: input.message,
    createdAt: nowIso(),
    resolvedAt: null,
    resolvedBy: null,
  };
}

export function createApprovalRecord(input: {
  type: ApprovalType;
  tenantId: string;
  siteId: string;
  summary: string;
  requestedBy: string;
}): ApprovalRequest {
  return {
    id: nextId("approval"),
    type: input.type,
    tenantId: input.tenantId,
    siteId: input.siteId,
    summary: input.summary.trim(),
    requestedBy: input.requestedBy,
    requestedAt: nowIso(),
    status: "pending",
    handledBy: null,
    handledAt: null,
    resultNote: "",
  };
}

export function createPublishRecord(input: {
  tenantId: string;
  siteId: string;
  version: number;
  status: PublishStatus;
  operator: string;
  notes: string;
}): PublishRecord {
  return {
    id: nextId("publish"),
    tenantId: input.tenantId,
    siteId: input.siteId,
    version: Math.max(1, Math.round(input.version)),
    status: input.status,
    operator: input.operator,
    notes: input.notes.trim(),
    at: nowIso(),
  };
}

export function createTenant(input: { name: string; owner: string }): Tenant {
  const current = nowIso();
  return {
    id: nextId("tenant"),
    name: input.name.trim(),
    owner: input.owner.trim(),
    status: "active",
    createdAt: current,
    updatedAt: current,
  };
}

export function createIndustryCategory(input: {
  name: string;
  slug: string;
  description?: string;
  parentId?: string | null;
  sortOrder?: number;
}): IndustryCategory {
  const current = nowIso();
  const normalizedSlug = input.slug.trim().toLowerCase().replace(/\s+/g, "-");
  return {
    id: nextId("category"),
    name: input.name.trim(),
    slug: normalizedSlug,
    description: (input.description ?? "").trim(),
    parentId: input.parentId ?? null,
    sortOrder:
      typeof input.sortOrder === "number" && Number.isFinite(input.sortOrder)
        ? Math.max(0, Math.round(input.sortOrder))
        : 999,
    status: "active",
    createdAt: current,
    updatedAt: current,
  };
}

export function createHomeLayoutSection(input: {
  title: string;
  description?: string;
  categoryId: string;
  sortOrder?: number;
}): HomeLayoutSection {
  return {
    id: nextId("home-section"),
    title: input.title.trim(),
    description: (input.description ?? "").trim(),
    categoryId: input.categoryId,
    sortOrder:
      typeof input.sortOrder === "number" && Number.isFinite(input.sortOrder)
        ? Math.max(0, Math.round(input.sortOrder))
        : 999,
    visible: true,
  };
}

export function createSite(input: {
  tenantId: string;
  merchantName?: string;
  domainPrefix?: string;
  domainSuffix?: string;
  contactAddress?: string;
  contactName?: string;
  contactPhone?: string;
  contactEmail?: string;
  name: string;
  domain: string;
  categoryId: string;
  categoryName: string;
  featurePackage: "basic" | "standard" | "enterprise";
  industry?: MerchantIndustry;
  location?: Partial<SiteLocation>;
}): Site {
  const current = nowIso();
  const name = input.name.trim();
  const domain = input.domain.trim();
  const normalizedDomainPrefix = normalizeText(input.domainPrefix ?? input.domainSuffix).toLowerCase();
  return {
    id: nextId("site"),
    tenantId: input.tenantId,
    merchantName: normalizeText(input.merchantName),
    signature: "",
    domainPrefix: normalizedDomainPrefix,
    domainSuffix: normalizedDomainPrefix,
    contactAddress: normalizeText(input.contactAddress),
    contactName: normalizeText(input.contactName),
    contactPhone: normalizeText(input.contactPhone),
    contactEmail: normalizeText(input.contactEmail),
    name,
    domain,
    categoryId: input.categoryId.trim(),
    category: input.categoryName.trim(),
    industry: normalizeSiteIndustry(input.industry),
    status: "online",
    publishedVersion: 1,
    lastPublishedAt: null,
    features: createFeaturePackage(input.featurePackage),
    location: normalizeSiteLocation(input.location, `${input.tenantId}-${name}-${domain}`),
    serviceExpiresAt: null,
    permissionConfig: createDefaultMerchantPermissionConfig(),
    merchantCardImageUrl: "",
    merchantCardImageOpacity: 1,
    chatAvatarImageUrl: "",
    contactVisibility: createDefaultMerchantContactVisibility(),
    businessCards: [],
    sortConfig: createDefaultMerchantSortConfig(),
    configHistory: [],
    createdAt: current,
    updatedAt: current,
  };
}

export function createPlanTemplate(input: {
  name: string;
  category?: PlanTemplateCategory;
  sourceSiteId?: string;
  sourceSiteName?: string;
  sourceSiteDomain?: string;
  sourceIndustry?: MerchantIndustry;
  coverImageUrl?: string;
  previewImageUrl?: string;
  planPreviewImageUrls?: Record<string, string>;
  previewVariant?: string;
  blocks?: unknown[];
}): PlanTemplate {
  const current = nowIso();
  const blocks = normalizePlanTemplateBlocks(input.blocks);
  return {
    id: nextId("template"),
    name: normalizeText(input.name) || "未命名方案",
    category: resolvePlanTemplateCategory(input.category ?? input.sourceIndustry),
    sourceSiteId: normalizeText(input.sourceSiteId),
    sourceSiteName: normalizeText(input.sourceSiteName),
    sourceSiteDomain: normalizeText(input.sourceSiteDomain),
    sourceIndustry: normalizeSiteIndustry(input.sourceIndustry),
    coverImageUrl: normalizeText(input.coverImageUrl) || extractPlanTemplateCoverImage(blocks),
    previewImageUrl: normalizeText(input.previewImageUrl),
    planPreviewImageUrls: normalizePlanTemplatePreviewImages(input.planPreviewImageUrls),
    previewVariant: normalizeText(input.previewVariant),
    blocks,
    createdAt: current,
    updatedAt: current,
  };
}

export function createPlatformUser(input: {
  name: string;
  email: string;
  department: string;
  tenantIds: string[];
  siteIds: string[];
  roleIds: string[];
}): PlatformUser {
  const current = nowIso();
  return {
    id: nextId("user"),
    name: input.name.trim(),
    email: input.email.trim(),
    department: input.department.trim(),
    tenantIds: [...new Set(input.tenantIds)],
    siteIds: [...new Set(input.siteIds)],
    roleIds: [...new Set(input.roleIds)],
    status: "active",
    createdAt: current,
    updatedAt: current,
  };
}

export function createRole(input: {
  name: string;
  description: string;
  permissions: PermissionKey[];
}): PlatformRole {
  const current = nowIso();
  return {
    id: nextId("role"),
    name: input.name.trim(),
    description: input.description.trim(),
    permissions: [...new Set(input.permissions)],
    createdAt: current,
    updatedAt: current,
  };
}

export function createPageAsset(input: {
  siteId: string;
  pagePath: string;
  group: string;
  tags: string[];
  status: AssetStatus;
  updatedBy: string;
}): PageAsset {
  return {
    id: nextId("asset"),
    siteId: input.siteId,
    pagePath: input.pagePath.trim(),
    group: input.group.trim(),
    tags: [...new Set(input.tags.map((tag) => tag.trim()).filter(Boolean))],
    status: input.status,
    updatedBy: input.updatedBy,
    updatedAt: nowIso(),
  };
}

export function resolvePermissionsForUser(state: PlatformState, userId: string): PermissionKey[] {
  const user = state.users.find((item) => item.id === userId);
  if (!user || user.status !== "active") return [];
  const permissions = new Set<PermissionKey>();
  user.roleIds.forEach((roleId) => {
    const role = state.roles.find((item) => item.id === roleId);
    if (!role) return;
    role.permissions.forEach((permission) => permissions.add(permission));
  });
  return [...permissions];
}

export function applyAudit(state: PlatformState, audit: AuditRecord): PlatformState {
  return {
    ...state,
    audits: [audit, ...state.audits].slice(0, MAX_AUDIT_RECORDS),
  };
}

export function applyAlert(state: PlatformState, alert: AlertRecord): PlatformState {
  return {
    ...state,
    alerts: [alert, ...state.alerts].slice(0, MAX_ALERT_RECORDS),
  };
}

export function nextIsoNow() {
  return nowIso();
}






