import type { Block } from "@/data/homeBlocks";

export type StyleTransferMatchStrategy = "id" | "entity" | "label" | "occurrence" | "single-type";

export type StyleTransferMatch = {
  targetIndex: number;
  strategy: StyleTransferMatchStrategy;
};

const ENTITY_IDENTITY_KEYS = ["pollId"] as const;
const LABEL_IDENTITY_KEYS = ["heading", "title", "buttonLabel"] as const;
const TARGET_OWNED_PROP_KEYS = new Set([
  "blockLocked",
  "mobileFitScreenWidth",
  "pageBgImageUrl",
  "pageBgFillMode",
  "pageBgPosition",
  "pageBgColor",
  "pageBgOpacity",
  "pageBgImageOpacity",
  "pageBgColorOpacity",
  "pagePlanConfig",
  "pagePlanConfigMobile",
  "publishedMerchantSnapshot",
]);

function cloneTransferValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cloneTransferValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nestedValue]) => [
        key,
        cloneTransferValue(nestedValue),
      ]),
    );
  }
  return value;
}

export function buildStyleTransferProps<T extends Block>(
  sourceBlock: Block,
  targetBlock: T,
  styleKeys: readonly string[],
  includeContent: boolean,
) {
  const sourceProps = sourceBlock.props as Record<string, unknown>;
  const targetProps = targetBlock.props as Record<string, unknown>;
  const nextProps: Record<string, unknown> = { ...targetProps };

  if (includeContent) {
    Object.entries(sourceProps).forEach(([key, value]) => {
      if (TARGET_OWNED_PROP_KEYS.has(key)) return;
      nextProps[key] = cloneTransferValue(value);
    });
  }

  styleKeys.forEach((key) => {
    const value = sourceProps[key];
    if (typeof value !== "undefined") nextProps[key] = cloneTransferValue(value);
  });

  return nextProps as T["props"];
}

function normalizeIdentityValue(value: unknown) {
  if (typeof value !== "string") return "";
  return value
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase();
}

function findUniquePropertyMatch(
  sourceBlock: Block,
  targetBlocks: Block[],
  keys: readonly string[],
): number {
  const sourceProps = sourceBlock.props as Record<string, unknown>;
  for (const key of keys) {
    const sourceValue = normalizeIdentityValue(sourceProps[key]);
    if (!sourceValue) continue;
    const matches = targetBlocks.reduce<number[]>((indices, block, index) => {
      if (block.type !== sourceBlock.type) return indices;
      const targetValue = normalizeIdentityValue((block.props as Record<string, unknown>)[key]);
      if (targetValue === sourceValue) indices.push(index);
      return indices;
    }, []);
    if (matches.length === 1) return matches[0];
  }
  return -1;
}

export function findStyleTransferTargetBlock(
  sourceBlock: Block,
  sourceBlocks: Block[],
  targetBlocks: Block[],
): StyleTransferMatch | null {
  const exactIdIndex = targetBlocks.findIndex(
    (block) => block.id === sourceBlock.id && block.type === sourceBlock.type,
  );
  if (exactIdIndex >= 0) {
    return { targetIndex: exactIdIndex, strategy: "id" };
  }

  const entityIndex = findUniquePropertyMatch(sourceBlock, targetBlocks, ENTITY_IDENTITY_KEYS);
  if (entityIndex >= 0) {
    return { targetIndex: entityIndex, strategy: "entity" };
  }

  const labelIndex = findUniquePropertyMatch(sourceBlock, targetBlocks, LABEL_IDENTITY_KEYS);
  if (labelIndex >= 0) {
    return { targetIndex: labelIndex, strategy: "label" };
  }

  const sourceIndex = sourceBlocks.findIndex((block) => block.id === sourceBlock.id);
  if (sourceIndex >= 0) {
    const occurrenceIndex = sourceBlocks
      .slice(0, sourceIndex)
      .filter((block) => block.type === sourceBlock.type).length;
    const sameTypeTargetIndices = targetBlocks.reduce<number[]>((indices, block, index) => {
      if (block.type === sourceBlock.type) indices.push(index);
      return indices;
    }, []);
    const occurrenceTargetIndex = sameTypeTargetIndices[occurrenceIndex];
    if (typeof occurrenceTargetIndex === "number") {
      return { targetIndex: occurrenceTargetIndex, strategy: "occurrence" };
    }
    if (sameTypeTargetIndices.length === 1) {
      return { targetIndex: sameTypeTargetIndices[0], strategy: "single-type" };
    }
  }

  return null;
}
