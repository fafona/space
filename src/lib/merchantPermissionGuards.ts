import type { Block } from "@/data/homeBlocks";
import {
  normalizeMerchantPermissionConfig,
  type MerchantServicePermissionConfig,
} from "@/data/platformControlStore";
import type { MerchantBusinessCardAsset } from "@/lib/merchantBusinessCards";
import { getPagePlanConfigFromBlocks, type PagePlan, type PagePlanConfig } from "@/lib/pagePlans";
import { getEmbeddedMobilePlanConfig } from "@/lib/planTemplateRuntime";

export type MerchantPermissionViolation = {
  code: string;
  message: string;
};

function estimateUtf8Bytes(value: string) {
  return new TextEncoder().encode(value).length;
}

function normalizeBlocks(value: unknown): Block[] {
  return Array.isArray(value) ? (value as Block[]) : [];
}

function buildPlanSignature(plan: PagePlan) {
  return JSON.stringify({
    activePageId: plan.activePageId,
    pages: (plan.pages ?? []).map((page) => ({
      name: page.name,
      blocks: page.blocks,
    })),
  });
}

function collectPersistedPlanConfigs(blocks: Block[]) {
  const desktopConfig = getPagePlanConfigFromBlocks(blocks);
  const mobileConfig = getEmbeddedMobilePlanConfig(blocks);
  return [
    { label: "desktop", config: desktopConfig },
    ...(mobileConfig ? [{ label: "mobile", config: mobileConfig }] : []),
  ] as Array<{ label: "desktop" | "mobile"; config: PagePlanConfig }>;
}

function collectPlanBlocks(config: PagePlanConfig) {
  const seenPlanSignatures = new Set<string>();
  return config.plans.flatMap((plan) => {
    const signature = buildPlanSignature(plan);
    if (seenPlanSignatures.has(signature)) return [];
    seenPlanSignatures.add(signature);
    return (plan.pages ?? []).flatMap((page) => normalizeBlocks(page.blocks));
  });
}

function getDisallowedBlockViolation(
  permissionConfig: MerchantServicePermissionConfig,
  block: Block,
): MerchantPermissionViolation | null {
  if (block.type === "button" && !permissionConfig.allowButtonBlock) {
    return { code: "button_block_not_allowed", message: "当前权限未开通按钮区块" };
  }
  if (block.type === "gallery" && !permissionConfig.allowGalleryBlock) {
    return { code: "gallery_block_not_allowed", message: "当前权限未开通相册区块" };
  }
  if (block.type === "music" && !permissionConfig.allowMusicBlock) {
    return { code: "music_block_not_allowed", message: "当前权限未开通音乐区块" };
  }
  if (block.type === "product" && !permissionConfig.allowProductBlock) {
    return { code: "product_block_not_allowed", message: "当前权限未开通产品区块" };
  }
  if (block.type === "booking" && !permissionConfig.allowBookingBlock) {
    return { code: "booking_block_not_allowed", message: "当前权限未开通预约区块" };
  }
  const pageBgImageUrl =
    typeof (block.props as { pageBgImageUrl?: unknown } | undefined)?.pageBgImageUrl === "string"
      ? ((block.props as { pageBgImageUrl?: string }).pageBgImageUrl ?? "").trim()
      : "";
  if (pageBgImageUrl && !permissionConfig.allowInsertBackground) {
    return { code: "insert_background_not_allowed", message: "当前权限未开通插入背景" };
  }
  return null;
}

export function getMerchantPublishPermissionViolation(
  permissionInput: MerchantServicePermissionConfig | null | undefined,
  blocksInput: unknown,
): MerchantPermissionViolation | null {
  const permissionConfig = normalizeMerchantPermissionConfig(permissionInput);
  const blocks = normalizeBlocks(blocksInput);
  const publishSizeLimitBytes = Math.max(1, Math.round(permissionConfig.publishSizeLimitMb)) * 1024 * 1024;
  const payloadBytes = estimateUtf8Bytes(JSON.stringify(blocks));
  if (payloadBytes > publishSizeLimitBytes) {
    return {
      code: "publish_size_limit_exceeded",
      message: `发布内容超过 ${permissionConfig.publishSizeLimitMb} MB 限制`,
    };
  }

  const configs = collectPersistedPlanConfigs(blocks);
  for (const { config } of configs) {
    const allowedPlanCount = Math.max(1, Math.min(config.plans.length, Math.round(permissionConfig.planLimit)));
    const allowedPlanSignatures = new Set(
      config.plans.slice(0, allowedPlanCount).map((plan) => buildPlanSignature(plan)),
    );
    const extraPlan = config.plans
      .slice(allowedPlanCount)
      .find((plan) => !allowedPlanSignatures.has(buildPlanSignature(plan)));
    if (extraPlan) {
      return {
        code: "plan_limit_exceeded",
        message: `当前权限仅允许使用前 ${permissionConfig.planLimit} 个方案`,
      };
    }

    const oversizedPlan = config.plans
      .slice(0, allowedPlanCount)
      .find((plan) => (plan.pages?.length ?? 0) > permissionConfig.pageLimit);
    if (oversizedPlan) {
      return {
        code: "page_limit_exceeded",
        message: `当前权限每个方案最多 ${permissionConfig.pageLimit} 个页面`,
      };
    }

    const planBlocks = collectPlanBlocks(config);
    const bookingBlockCount = planBlocks.filter((block) => block.type === "booking").length;
    if (bookingBlockCount > 1) {
      return {
        code: "booking_block_limit_exceeded",
        message: "预约区块只能有一个",
      };
    }

    for (const block of planBlocks) {
      const violation = getDisallowedBlockViolation(permissionConfig, block);
      if (violation) return violation;
    }
  }

  return null;
}

export function getMerchantBusinessCardPermissionViolation(
  permissionInput: MerchantServicePermissionConfig | null | undefined,
  cardsInput: MerchantBusinessCardAsset[],
): MerchantPermissionViolation | null {
  const permissionConfig = normalizeMerchantPermissionConfig(permissionInput);
  if (cardsInput.length > permissionConfig.businessCardLimit) {
    return {
      code: "business_card_limit_exceeded",
      message: `名片夹已达到上限（${permissionConfig.businessCardLimit} 张）`,
    };
  }

  if (!permissionConfig.allowBusinessCardLinkMode) {
    const linkCard = cardsInput.find((card) => card.mode === "link");
    if (linkCard) {
      return {
        code: "business_card_link_mode_not_allowed",
        message: "当前权限未开通链接模式名片",
      };
    }
  }

  return null;
}
