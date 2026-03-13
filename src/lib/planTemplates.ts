import type { Block } from "@/data/homeBlocks";
import type { MerchantIndustry, PlanTemplate, PlanTemplateCategory } from "@/data/platformControlStore";
import { resolvePlanTemplateCategory } from "@/data/platformControlStore";
import { cloneBlocks, getPagePlanConfigFromBlocks } from "@/lib/pagePlans";

export const PLAN_TEMPLATE_FILTER_OPTIONS = ["全部", "餐饮", "娱乐", "零售", "服务", "组织", "其他"] as const;
export type PlanTemplateFilterCategory = (typeof PLAN_TEMPLATE_FILTER_OPTIONS)[number];

const BLOCK_TYPE_LABELS: Partial<Record<Block["type"], string>> = {
  nav: "导航",
  hero: "头图",
  common: "通用",
  gallery: "相册",
  chart: "图表",
  music: "音乐",
  product: "产品",
  "merchant-list": "商户列表",
  contact: "联系方式",
  "search-bar": "搜索",
};

function safeArrayToBlocks(value: unknown): Block[] {
  if (!Array.isArray(value)) return [];
  try {
    return cloneBlocks(value as Block[]);
  } catch {
    return [];
  }
}

export function resolveTemplateCategoryFromIndustry(industry: MerchantIndustry | "" | null | undefined): PlanTemplateCategory {
  return resolvePlanTemplateCategory(industry);
}

export function matchPlanTemplateCategory(
  template: Pick<PlanTemplate, "category">,
  activeCategory: PlanTemplateFilterCategory,
) {
  return activeCategory === "全部" ? true : template.category === activeCategory;
}

export function summarizePlanTemplateBlocks(rawBlocks: unknown) {
  const blocks = safeArrayToBlocks(rawBlocks);
  const desktopPlanConfig = getPagePlanConfigFromBlocks(blocks);
  const planCount = desktopPlanConfig.plans.length;
  const pageCount = desktopPlanConfig.plans.reduce((total, plan) => total + (plan.pages?.length || 0), 0);
  const blockCount = desktopPlanConfig.plans.reduce(
    (total, plan) =>
      total +
      (plan.pages?.reduce((pageTotal, page) => pageTotal + (Array.isArray(page.blocks) ? page.blocks.length : 0), 0) ?? 0),
    0,
  );
  const labels = Array.from(
    new Set(
      blocks
        .map((block) => BLOCK_TYPE_LABELS[block.type] ?? block.type)
        .filter(Boolean),
    ),
  ).slice(0, 4);
  const previewTitle =
    blocks
      .map((block) => {
        const props = (block.props ?? {}) as Record<string, unknown>;
        const candidates = [props.heading, props.title, props.name, props.text];
        return candidates.find((item) => typeof item === "string" && item.trim().length > 0);
      })
      .find((item): item is string => typeof item === "string" && item.trim().length > 0)
      ?.trim() ?? "";
  const hasMobile = blocks.some((block) => {
    const props = (block.props ?? {}) as Record<string, unknown>;
    return !!props.pagePlanConfigMobile;
  });
  return {
    previewTitle,
    labels,
    planCount,
    pageCount,
    blockCount,
    hasMobile,
  };
}
