import type { Block } from "@/data/homeBlocks";

export type StyleTransferMatchStrategy = "id" | "entity" | "label" | "occurrence" | "single-type";

export type StyleTransferMatch = {
  targetIndex: number;
  strategy: StyleTransferMatchStrategy;
};

const ENTITY_IDENTITY_KEYS = ["pollId"] as const;
const LABEL_IDENTITY_KEYS = ["heading", "title", "buttonLabel"] as const;

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
