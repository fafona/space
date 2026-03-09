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

export type MerchantIndustry = "" | "餐饮" | "娱乐" | "零售" | "服务";
export const MERCHANT_INDUSTRY_OPTIONS: MerchantIndustry[] = ["餐饮", "娱乐", "零售", "服务"];

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
  allowInsertBackground: boolean;
  allowThemeEffects: boolean;
  allowGalleryBlock: boolean;
  allowMusicBlock: boolean;
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
  sortConfig: MerchantSortConfig;
};

export type MerchantConfigHistoryEntry = {
  id: string;
  at: string;
  operator: string;
  summary: string;
  before: MerchantConfigSnapshot;
  after: MerchantConfigSnapshot;
};

export type Site = {
  id: string;
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

export type PlatformState = {
  version: number;
  tenants: Tenant[];
  sites: Site[];
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
const STORE_EVENT = "merchant-space:platform-control-center:changed";
const MAX_AUDIT_RECORDS = 1200;
const MAX_ALERT_RECORDS = 400;
const MAX_PUBLISH_RECORDS = 600;
const MAX_APPROVAL_RECORDS = 500;
const MAX_MERCHANT_CONFIG_HISTORY = 30;

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
  const raw = normalizeText(value) as MerchantIndustry;
  return MERCHANT_INDUSTRY_OPTIONS.includes(raw) ? raw : "";
}

function normalizeMerchantSortRule(value: unknown): MerchantSortRule {
  const raw = normalizeText(value) as MerchantSortRule;
  return MERCHANT_SORT_RULES.includes(raw) ? raw : "created_desc";
}

export function createDefaultMerchantPermissionConfig(): MerchantServicePermissionConfig {
  return {
    planLimit: 1,
    pageLimit: 3,
    allowInsertBackground: false,
    allowThemeEffects: false,
    allowGalleryBlock: false,
    allowMusicBlock: false,
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

function normalizeMerchantPermissionConfig(value: unknown): MerchantServicePermissionConfig {
  const source = value && typeof value === "object" ? (value as Partial<MerchantServicePermissionConfig>) : {};
  const fallback = createDefaultMerchantPermissionConfig();
  return {
    planLimit: normalizeInt(source.planLimit, fallback.planLimit, 1, 200),
    pageLimit: normalizeInt(source.pageLimit, fallback.pageLimit, 1, 500),
    allowInsertBackground:
      typeof source.allowInsertBackground === "boolean" ? source.allowInsertBackground : fallback.allowInsertBackground,
    allowThemeEffects: typeof source.allowThemeEffects === "boolean" ? source.allowThemeEffects : fallback.allowThemeEffects,
    allowGalleryBlock: typeof source.allowGalleryBlock === "boolean" ? source.allowGalleryBlock : fallback.allowGalleryBlock,
    allowMusicBlock: typeof source.allowMusicBlock === "boolean" ? source.allowMusicBlock : fallback.allowMusicBlock,
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

function normalizeMerchantConfigSnapshot(value: unknown): MerchantConfigSnapshot {
  const source = value && typeof value === "object" ? (value as Partial<MerchantConfigSnapshot>) : {};
  return {
    serviceExpiresAt:
      typeof source.serviceExpiresAt === "string" && normalizeText(source.serviceExpiresAt)
        ? normalizeText(source.serviceExpiresAt)
        : null,
    permissionConfig: normalizeMerchantPermissionConfig(source.permissionConfig),
    merchantCardImageUrl: normalizeText(source.merchantCardImageUrl),
    sortConfig: normalizeMerchantSortConfig(source.sortConfig),
  };
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
      before: normalizeMerchantConfigSnapshot(row.before),
      after: normalizeMerchantConfigSnapshot(row.after),
    });
  });
  return rows
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, MAX_MERCHANT_CONFIG_HISTORY);
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
        sortConfig: createDefaultMerchantSortConfig(),
        configHistory: [],
        createdAt: current,
        updatedAt: current,
      },
    ],
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
          sortConfig: normalizeMerchantSortConfig((site as { sortConfig?: unknown }).sortConfig),
          configHistory: normalizeMerchantConfigHistory((site as { configHistory?: unknown }).configHistory),
        }))
      : [],
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
    return normalizeState(parsed);
  } catch {
    const seeded = createDefaultState();
    savePlatformState(seeded);
    return seeded;
  }
}

export function savePlatformState(state: PlatformState) {
  if (typeof window === "undefined") return false;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeState(state)));
    window.dispatchEvent(new Event(STORE_EVENT));
    return true;
  } catch {
    // ignore storage write failures
    return false;
  }
}

export function subscribePlatformState(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) onChange();
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
    sortConfig: createDefaultMerchantSortConfig(),
    configHistory: [],
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






