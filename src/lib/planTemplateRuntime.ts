import type { Block, ImageFillMode } from "@/data/homeBlocks";
import {
  buildPersistedBlocksFromPlanConfig,
  cloneBlocks,
  getPagePlanConfigFromBlocks,
  type PagePlan,
  type PagePlanConfig,
  type PlanPage,
} from "@/lib/pagePlans";

export type PlanTemplateViewport = "desktop" | "mobile";

export type PlanTemplatePageOption = {
  key: string;
  planId: string;
  planName: string;
  pageId: string;
  pageIndex: number;
  pageName: string;
};

export type PlanTemplatePlanOption = {
  planId: string;
  planName: string;
  pages: PlanTemplatePageOption[];
};

export type PlanTemplateViewportOption = {
  viewport: PlanTemplateViewport;
  label: string;
  plans: PlanTemplatePlanOption[];
};

export type PlanTemplateViewportScope = {
  enabled: boolean;
  applyBackground: boolean;
  selectedPageKeys: string[];
};

export type PlanTemplateApplyScope = Record<PlanTemplateViewport, PlanTemplateViewportScope>;

export type PlanTemplateReplaceOptions = {
  typography: boolean;
  buttonStyles: boolean;
  galleryImages: boolean;
  productData: boolean;
  contactInfo: boolean;
};

export type PlanTemplateCoverBackground = {
  imageUrl?: string;
  fillMode?: ImageFillMode;
  position?: string;
  color?: string;
  opacity?: number;
  imageOpacity?: number;
  colorOpacity?: number;
};

export const DEFAULT_PLAN_TEMPLATE_REPLACE_OPTIONS: PlanTemplateReplaceOptions = {
  typography: true,
  buttonStyles: true,
  galleryImages: false,
  productData: false,
  contactInfo: false,
};

const PAGE_BACKGROUND_KEYS = [
  "pageBgImageUrl",
  "pageBgFillMode",
  "pageBgPosition",
  "pageBgColor",
  "pageBgOpacity",
  "pageBgImageOpacity",
  "pageBgColorOpacity",
] as const;

const TYPOGRAPHY_KEYS = [
  "fontFamily",
  "fontColor",
  "fontSize",
  "fontWeight",
  "fontStyle",
  "textDecoration",
  "productCodeTypography",
  "productNameTypography",
  "productDescriptionTypography",
  "productPriceTypography",
  "merchantCardTypography",
] as const;

const BUTTON_STYLE_KEYS: Partial<Record<Block["type"], readonly string[]>> = {
  "search-bar": [
    "searchButtonBgColor",
    "searchButtonBgOpacity",
    "searchButtonBorderStyle",
    "searchButtonBorderColor",
    "searchButtonActiveBgColor",
    "searchButtonActiveBgOpacity",
    "searchButtonActiveBorderStyle",
    "searchButtonActiveBorderColor",
  ],
  "merchant-list": [
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
  ],
  nav: [
    "navItemBgColor",
    "navItemBgOpacity",
    "navItemBorderStyle",
    "navItemBorderColor",
    "navItemActiveBgColor",
    "navItemActiveBgOpacity",
    "navItemActiveBorderStyle",
    "navItemActiveBorderColor",
    "navItemActiveTextColor",
  ],
  product: [
    "productTagBgColor",
    "productTagBgOpacity",
    "productTagActiveBgColor",
    "productTagActiveBgOpacity",
    "productTagFontSize",
    "productTagWidth",
  ],
};

const CONTACT_DATA_KEYS = [
  "phone",
  "address",
  "addresses",
  "email",
  "whatsapp",
  "wechat",
  "twitter",
  "weibo",
  "telegram",
  "linkedin",
  "discord",
  "tiktok",
  "xiaohongshu",
  "facebook",
  "instagram",
] as const;

function cloneValue<T>(value: T): T {
  if (value === undefined) return value;
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

function clonePlanConfig(source: PagePlanConfig): PagePlanConfig {
  return cloneValue(source);
}

function safeBlocks(value: unknown): Block[] {
  if (!Array.isArray(value)) return [];
  try {
    return cloneBlocks(value as Block[]);
  } catch {
    return [];
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function firstBackgroundImageFromBlock(block: Block | undefined): string {
  if (!block) return "";
  const props = (block.props ?? {}) as Record<string, unknown>;
  if (isNonEmptyString(props.pageBgImageUrl)) return props.pageBgImageUrl.trim();
  if (isNonEmptyString(props.bgImageUrl)) return props.bgImageUrl.trim();
  return "";
}

function firstCoverBackgroundFromBlock(block: Block | undefined): PlanTemplateCoverBackground | null {
  if (!block) return null;
  const props = (block.props ?? {}) as Record<string, unknown>;
  const imageUrl = isNonEmptyString(props.pageBgImageUrl)
    ? props.pageBgImageUrl.trim()
    : isNonEmptyString(props.bgImageUrl)
      ? props.bgImageUrl.trim()
      : "";
  const color = isNonEmptyString(props.pageBgColor)
    ? props.pageBgColor.trim()
    : isNonEmptyString(props.bgColor)
      ? props.bgColor.trim()
      : "";
  const fillMode = isNonEmptyString(props.pageBgFillMode)
    ? props.pageBgFillMode.trim()
    : isNonEmptyString(props.bgFillMode)
      ? props.bgFillMode.trim()
      : "";
  const position = isNonEmptyString(props.pageBgPosition)
    ? props.pageBgPosition.trim()
    : isNonEmptyString(props.bgPosition)
      ? props.bgPosition.trim()
      : "";
  const opacity =
    typeof props.pageBgOpacity === "number" && Number.isFinite(props.pageBgOpacity)
      ? props.pageBgOpacity
      : typeof props.bgOpacity === "number" && Number.isFinite(props.bgOpacity)
        ? props.bgOpacity
        : undefined;
  const imageOpacity =
    typeof props.pageBgImageOpacity === "number" && Number.isFinite(props.pageBgImageOpacity)
      ? props.pageBgImageOpacity
      : typeof props.bgImageOpacity === "number" && Number.isFinite(props.bgImageOpacity)
        ? props.bgImageOpacity
        : undefined;
  const colorOpacity =
    typeof props.pageBgColorOpacity === "number" && Number.isFinite(props.pageBgColorOpacity)
      ? props.pageBgColorOpacity
      : typeof props.bgColorOpacity === "number" && Number.isFinite(props.bgColorOpacity)
        ? props.bgColorOpacity
        : undefined;

  if (!imageUrl && !color) return null;
  return {
    imageUrl: imageUrl || undefined,
    fillMode: (fillMode || undefined) as ImageFillMode | undefined,
    position: position || undefined,
    color: color || undefined,
    opacity,
    imageOpacity,
    colorOpacity,
  };
}

function makePageKey(planId: string, pageIndex: number) {
  return `${planId}::${pageIndex}`;
}

function syncPlan(plan: PagePlan): PagePlan {
  const pages = Array.isArray(plan.pages) && plan.pages.length > 0 ? cloneValue(plan.pages) : [];
  const safePages =
    pages.length > 0
      ? pages
      : [
          {
            id: "page-1",
            name: "页面1",
            blocks: cloneBlocks(plan.blocks ?? []),
          },
        ];
  const activePage = safePages.find((page) => page.id === plan.activePageId) ?? safePages[0];
  return {
    ...plan,
    pages: safePages,
    activePageId: activePage.id,
    blocks: cloneBlocks(activePage.blocks ?? []),
  };
}

function buildViewportOption(config: PagePlanConfig, viewport: PlanTemplateViewport): PlanTemplateViewportOption {
  return {
    viewport,
    label: viewport === "desktop" ? "PC" : "手机",
    plans: config.plans.map((plan) => ({
      planId: plan.id,
      planName: plan.name,
      pages: (plan.pages ?? []).map((page, pageIndex) => ({
        key: makePageKey(plan.id, pageIndex),
        planId: plan.id,
        planName: plan.name,
        pageId: page.id,
        pageIndex,
        pageName: page.name,
      })),
    })),
  };
}

function getPropBag(block: Block | undefined) {
  return ((block?.props ?? {}) as Record<string, unknown>) ?? {};
}

function copyKeys(nextProps: Record<string, unknown>, sourceProps: Record<string, unknown>, keys: readonly string[]) {
  keys.forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(sourceProps, key)) {
      nextProps[key] = cloneValue(sourceProps[key]);
      return;
    }
    delete nextProps[key];
  });
}

function mergeTemplateBlocks(
  templateBlocks: Block[],
  targetBlocks: Block[],
  replaceOptions: PlanTemplateReplaceOptions,
  applyBackground: boolean,
) {
  const nextBlocks = cloneBlocks(templateBlocks);
  const targetByType = new Map<Block["type"], Block[]>();
  targetBlocks.forEach((block) => {
    const bucket = targetByType.get(block.type) ?? [];
    bucket.push(block);
    targetByType.set(block.type, bucket);
  });
  const typeCounters = new Map<Block["type"], number>();

  nextBlocks.forEach((block, index) => {
    const typeIndex = typeCounters.get(block.type) ?? 0;
    typeCounters.set(block.type, typeIndex + 1);
    const targetBlock = targetByType.get(block.type)?.[typeIndex];
    if (!targetBlock) return;

    const nextProps = { ...getPropBag(block) };
    const targetProps = getPropBag(targetBlock);

    if (!replaceOptions.typography) {
      copyKeys(nextProps, targetProps, TYPOGRAPHY_KEYS);
    }
    if (!replaceOptions.buttonStyles) {
      copyKeys(nextProps, targetProps, BUTTON_STYLE_KEYS[block.type] ?? []);
    }
    if (!replaceOptions.galleryImages && block.type === "gallery") {
      copyKeys(nextProps, targetProps, ["images"]);
    }
    if (!replaceOptions.productData && block.type === "product") {
      copyKeys(nextProps, targetProps, ["products"]);
    }
    if (!replaceOptions.contactInfo && block.type === "contact") {
      copyKeys(nextProps, targetProps, CONTACT_DATA_KEYS);
    }
    if (!applyBackground && index === 0) {
      copyKeys(nextProps, targetProps, PAGE_BACKGROUND_KEYS);
    }

    nextBlocks[index] = {
      ...block,
      props: nextProps as never,
    };
  });

  return nextBlocks;
}

function mergePageBackground(templatePage: PlanPage, targetPage: PlanPage) {
  const nextBlocks = cloneBlocks(targetPage.blocks ?? []);
  if (!nextBlocks[0]) return nextBlocks;
  const nextProps = { ...getPropBag(nextBlocks[0]) };
  const templateProps = getPropBag(templatePage.blocks?.[0]);
  copyKeys(nextProps, templateProps, PAGE_BACKGROUND_KEYS);
  nextBlocks[0] = {
    ...nextBlocks[0],
    props: nextProps as never,
  };
  return nextBlocks;
}

function applyViewportTemplate(
  templateConfig: PagePlanConfig,
  targetConfig: PagePlanConfig,
  scope: PlanTemplateViewportScope,
  replaceOptions: PlanTemplateReplaceOptions,
) {
  const nextConfig = clonePlanConfig(targetConfig);
  nextConfig.plans = nextConfig.plans.map((plan) => syncPlan(plan));

  templateConfig.plans.forEach((templatePlan) => {
    const planIndex = nextConfig.plans.findIndex((item) => item.id === templatePlan.id);
    if (planIndex < 0) return;
    const targetPlan = syncPlan(nextConfig.plans[planIndex]);
    const nextPages = cloneValue(targetPlan.pages);

    templatePlan.pages.forEach((templatePage, pageIndex) => {
      const pageKey = makePageKey(templatePlan.id, pageIndex);
      const pageSelected = scope.selectedPageKeys.includes(pageKey);
      const existingTargetPage = nextPages[pageIndex];

      if (!pageSelected && !scope.applyBackground) {
        return;
      }

      if (pageSelected) {
        const mergedBlocks = mergeTemplateBlocks(
          templatePage.blocks ?? [],
          existingTargetPage?.blocks ?? [],
          replaceOptions,
          scope.applyBackground,
        );
        nextPages[pageIndex] = {
          id: existingTargetPage?.id || templatePage.id,
          name: existingTargetPage?.name || templatePage.name,
          blocks: mergedBlocks,
        };
        return;
      }

      if (scope.applyBackground && existingTargetPage) {
        nextPages[pageIndex] = {
          ...existingTargetPage,
          blocks: mergePageBackground(templatePage, existingTargetPage),
        };
      }
    });

    nextConfig.plans[planIndex] = syncPlan({
      ...targetPlan,
      pages: nextPages,
    });
  });

  return nextConfig;
}

export function getEmbeddedMobilePlanConfig(sourceBlocks: Block[]): PagePlanConfig | null {
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

export function buildCombinedPersistedBlocks(desktopConfig: PagePlanConfig, mobileConfig?: PagePlanConfig | null) {
  const desktopBlocks = buildPersistedBlocksFromPlanConfig(desktopConfig);
  if (!mobileConfig) return desktopBlocks;
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

export function extractPlanTemplateCoverImage(rawBlocks: unknown) {
  const blocks = safeBlocks(rawBlocks);
  if (blocks.length === 0) return "";
  const config = getPagePlanConfigFromBlocks(blocks);
  for (const plan of config.plans) {
    for (const page of plan.pages ?? []) {
      for (const block of page.blocks ?? []) {
        const image = firstBackgroundImageFromBlock(block);
        if (image) return image;
      }
    }
  }
  for (const block of blocks) {
    const image = firstBackgroundImageFromBlock(block);
    if (image) return image;
  }
  return "";
}

export function extractPlanTemplateCoverBackground(rawBlocks: unknown) {
  const blocks = safeBlocks(rawBlocks);
  if (blocks.length === 0) return null;
  const config = getPagePlanConfigFromBlocks(blocks);
  for (const plan of config.plans) {
    for (const page of plan.pages ?? []) {
      for (const block of page.blocks ?? []) {
        const background = firstCoverBackgroundFromBlock(block);
        if (background) return background;
      }
    }
  }
  for (const block of blocks) {
    const background = firstCoverBackgroundFromBlock(block);
    if (background) return background;
  }
  return null;
}

export function getPlanTemplateViewportOptions(rawBlocks: unknown): PlanTemplateViewportOption[] {
  const blocks = safeBlocks(rawBlocks);
  if (blocks.length === 0) return [];
  const desktopConfig = getPagePlanConfigFromBlocks(blocks);
  const options: PlanTemplateViewportOption[] = [buildViewportOption(desktopConfig, "desktop")];
  const mobileConfig = getEmbeddedMobilePlanConfig(blocks);
  if (mobileConfig) {
    options.push(buildViewportOption(mobileConfig, "mobile"));
  }
  return options;
}

export function createDefaultPlanTemplateApplyScope(rawBlocks: unknown): PlanTemplateApplyScope {
  const options = getPlanTemplateViewportOptions(rawBlocks);
  const byViewport = new Map(options.map((option) => [option.viewport, option]));
  const defaultScope = (viewport: PlanTemplateViewport): PlanTemplateViewportScope => {
    const option = byViewport.get(viewport);
    const selectedPageKeys = option ? option.plans.flatMap((plan) => plan.pages.map((page) => page.key)) : [];
    return {
      enabled: !!option,
      applyBackground: !!option,
      selectedPageKeys,
    };
  };
  return {
    desktop: defaultScope("desktop"),
    mobile: defaultScope("mobile"),
  };
}

export function hasPlanTemplateApplySelection(scope: PlanTemplateApplyScope) {
  return (["desktop", "mobile"] as const).some((viewport) => {
    const viewScope = scope[viewport];
    if (!viewScope.enabled) return false;
    return viewScope.applyBackground || viewScope.selectedPageKeys.length > 0;
  });
}

export function applyPlanTemplateToBlocks(
  templateBlocks: unknown,
  targetBlocks: Block[],
  scope: PlanTemplateApplyScope,
  replaceOptions: PlanTemplateReplaceOptions,
) {
  const normalizedTemplateBlocks = safeBlocks(templateBlocks);
  const normalizedTargetBlocks = safeBlocks(targetBlocks);
  const templateDesktop = getPagePlanConfigFromBlocks(normalizedTemplateBlocks);
  const targetDesktop = getPagePlanConfigFromBlocks(normalizedTargetBlocks);
  const templateMobile = getEmbeddedMobilePlanConfig(normalizedTemplateBlocks);
  const targetMobile = getEmbeddedMobilePlanConfig(normalizedTargetBlocks);

  const nextDesktop = scope.desktop.enabled
    ? applyViewportTemplate(templateDesktop, targetDesktop, scope.desktop, replaceOptions)
    : targetDesktop;

  let nextMobile = targetMobile ? clonePlanConfig(targetMobile) : null;
  if (scope.mobile.enabled && templateMobile) {
    nextMobile = applyViewportTemplate(templateMobile, targetMobile ?? templateMobile, scope.mobile, replaceOptions);
  }

  return buildCombinedPersistedBlocks(nextDesktop, nextMobile);
}
