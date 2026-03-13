import type { Block } from "../data/homeBlocks";
import { BLOCKS_SCHEMA_VERSION } from "./blocksSchema";

const MAX_INLINE_IMAGE_URL_LENGTH = 6_000_000;
const MAX_INLINE_AUDIO_URL_LENGTH = 4_000_000;

function sanitizeInlineDataUrl(value: string): { value: string; removed: number } {
  if (/^data:image\//i.test(value) && value.length > MAX_INLINE_IMAGE_URL_LENGTH) {
    return { value: "", removed: 1 };
  }
  if (/^data:audio\//i.test(value) && value.length > MAX_INLINE_AUDIO_URL_LENGTH) {
    return { value: "", removed: 1 };
  }
  return { value, removed: 0 };
}

function sanitizeUnknown(input: unknown): { value: unknown; removed: number } {
  if (typeof input === "string") {
    return sanitizeInlineDataUrl(input);
  }

  if (Array.isArray(input)) {
    let removed = 0;
    const value = input.map((item) => {
      const next = sanitizeUnknown(item);
      removed += next.removed;
      return next.value;
    });
    return { value, removed };
  }

  if (input && typeof input === "object") {
    let removed = 0;
    const record = input as Record<string, unknown>;
    const nextRecord: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(record)) {
      if (key === "blockGroup") {
        removed += 1;
        continue;
      }
      const next = sanitizeUnknown(value);
      removed += next.removed;
      nextRecord[key] = next.value;
    }
    return { value: nextRecord, removed };
  }

  return { value: input, removed: 0 };
}

function normalizeSchemaVersion(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const rounded = Math.floor(value);
  return rounded > 0 ? rounded : null;
}

function migrateBlocksSchemaVersion(blocks: Block[]): { blocks: Block[]; migrated: number } {
  if (!Array.isArray(blocks) || blocks.length === 0) {
    return { blocks, migrated: 0 };
  }

  const first = blocks[0];
  if (!first || !first.props || typeof first.props !== "object") {
    return { blocks, migrated: 0 };
  }

  const currentVersion = normalizeSchemaVersion((first.props as Record<string, unknown>).schemaVersion);
  if (currentVersion === BLOCKS_SCHEMA_VERSION) {
    return { blocks, migrated: 0 };
  }

  const next = [...blocks];
  next[0] = {
    ...first,
    props: {
      ...first.props,
      schemaVersion: BLOCKS_SCHEMA_VERSION,
    } as never,
  } as Block;
  return { blocks: next, migrated: 1 };
}

const LEGACY_PORTAL_STACK_ORDER: Partial<Record<Block["type"], number>> = {
  nav: 1,
  "search-bar": 2,
  "merchant-list": 3,
  contact: 4,
};

function normalizeOffsetValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : 0;
}

function shouldNormalizeLegacyPortalSequence(blocks: Block[]) {
  const navIndex = blocks.findIndex((block) => block.type === "nav");
  const merchantIndex = blocks.findIndex((block) => block.type === "merchant-list");
  const contactIndex = blocks.findIndex((block) => block.type === "contact");
  const searchIndex = blocks.findIndex((block) => block.type === "search-bar");
  if (navIndex < 0 || merchantIndex < 0 || contactIndex < 0 || searchIndex < 0) return false;

  const merchantOffsetY = normalizeOffsetValue(blocks[merchantIndex]?.props?.blockOffsetY);
  const contactOffsetY = normalizeOffsetValue(blocks[contactIndex]?.props?.blockOffsetY);
  const searchOffsetY = normalizeOffsetValue(blocks[searchIndex]?.props?.blockOffsetY);

  return (
    searchIndex > contactIndex &&
    contactIndex > merchantIndex &&
    merchantIndex > navIndex &&
    searchOffsetY <= -600 &&
    merchantOffsetY >= 100 &&
    contactOffsetY >= 100
  );
}

function normalizeLegacyPortalSequence(blocks: Block[]): { blocks: Block[]; migrated: number } {
  if (!shouldNormalizeLegacyPortalSequence(blocks)) {
    return { blocks, migrated: 0 };
  }

  let changed = false;
  const reordered = [...blocks].sort((left, right) => {
    const leftRank = LEGACY_PORTAL_STACK_ORDER[left.type];
    const rightRank = LEGACY_PORTAL_STACK_ORDER[right.type];
    if (leftRank === undefined && rightRank === undefined) return 0;
    if (leftRank === undefined) return 1;
    if (rightRank === undefined) return -1;
    return leftRank - rightRank;
  });

  const next = reordered.map((block) => {
    if (block.type !== "search-bar" && block.type !== "merchant-list" && block.type !== "contact") {
      return block;
    }
    const nextProps = {
      ...block.props,
      blockOffsetX: 0,
      blockOffsetY: 0,
    } as never;
    if (
      normalizeOffsetValue(block.props.blockOffsetX) !== 0 ||
      normalizeOffsetValue(block.props.blockOffsetY) !== 0
    ) {
      changed = true;
    }
    return { ...block, props: nextProps } as Block;
  });

  if (!changed && next.every((block, index) => block.id === blocks[index]?.id)) {
    return { blocks, migrated: 0 };
  }

  return { blocks: next, migrated: 1 };
}

function normalizePlanConfig(input: unknown): { value: unknown; migrated: number } {
  if (!input || typeof input !== "object") return { value: input, migrated: 0 };
  const record = input as Record<string, unknown>;
  if (!Array.isArray(record.plans)) return { value: input, migrated: 0 };

  let migrated = 0;
  let changed = false;
  const plans = (record.plans as Array<Record<string, unknown>>).map((plan) => {
    if (!plan || typeof plan !== "object") return plan;
    let planChanged = false;
    let nextPlan: Record<string, unknown> = plan;

    if (Array.isArray(plan.blocks)) {
      const normalizedBlocks = normalizeLegacyPortalSequence(plan.blocks as Block[]);
      if (normalizedBlocks.migrated > 0) {
        migrated += normalizedBlocks.migrated;
        planChanged = true;
        nextPlan = { ...nextPlan, blocks: normalizedBlocks.blocks };
      }
    }

    if (Array.isArray(plan.pages)) {
      const nextPages = (plan.pages as Array<Record<string, unknown>>).map((page) => {
        if (!page || typeof page !== "object" || !Array.isArray(page.blocks)) return page;
        const normalizedBlocks = normalizeLegacyPortalSequence(page.blocks as Block[]);
        if (normalizedBlocks.migrated === 0) return page;
        migrated += normalizedBlocks.migrated;
        planChanged = true;
        return { ...page, blocks: normalizedBlocks.blocks };
      });
      if (planChanged) {
        nextPlan = { ...nextPlan, pages: nextPages };
      }
    }

    if (planChanged) {
      changed = true;
    }
    return nextPlan;
  });

  if (!changed) return { value: input, migrated: 0 };
  return {
    value: {
      ...record,
      plans,
    },
    migrated,
  };
}

function normalizeEmbeddedPlanConfigs(blocks: Block[]): { blocks: Block[]; migrated: number } {
  let migrated = 0;
  let changed = false;
  const next = blocks.map((block) => {
    let nextProps: Record<string, unknown> | null = null;

    const pagePlanConfig = normalizePlanConfig((block.props as Record<string, unknown>).pagePlanConfig);
    if (pagePlanConfig.migrated > 0) {
      migrated += pagePlanConfig.migrated;
      changed = true;
      nextProps = {
        ...(nextProps ?? (block.props as Record<string, unknown>)),
        pagePlanConfig: pagePlanConfig.value,
      };
    }

    const pagePlanConfigMobile = normalizePlanConfig((block.props as Record<string, unknown>).pagePlanConfigMobile);
    if (pagePlanConfigMobile.migrated > 0) {
      migrated += pagePlanConfigMobile.migrated;
      changed = true;
      nextProps = {
        ...(nextProps ?? (block.props as Record<string, unknown>)),
        pagePlanConfigMobile: pagePlanConfigMobile.value,
      };
    }

    if (!nextProps) return block;
    return {
      ...block,
      props: nextProps as never,
    } as Block;
  });

  if (!changed) return { blocks, migrated: 0 };
  return { blocks: next, migrated };
}

export function sanitizeBlocksForRuntime(blocks: Block[]): { blocks: Block[]; removed: number } {
  const next = sanitizeUnknown(blocks);
  const sanitizedBlocks = Array.isArray(next.value) ? (next.value as Block[]) : [];
  const migrated = migrateBlocksSchemaVersion(sanitizedBlocks);
  const normalizedRoot = normalizeLegacyPortalSequence(migrated.blocks);
  const normalizedPlans = normalizeEmbeddedPlanConfigs(normalizedRoot.blocks);
  return {
    blocks: normalizedPlans.blocks,
    removed: next.removed + migrated.migrated + normalizedRoot.migrated + normalizedPlans.migrated,
  };
}
