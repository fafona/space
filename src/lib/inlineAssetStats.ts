export type InlineAssetStats = {
  imageCount: number;
  audioCount: number;
  totalCount: number;
};

function visitInlineAssets(input: unknown, stats: InlineAssetStats) {
  if (typeof input === "string") {
    if (/^data:image\//i.test(input)) {
      stats.imageCount += 1;
      stats.totalCount += 1;
      return;
    }
    if (/^data:audio\//i.test(input)) {
      stats.audioCount += 1;
      stats.totalCount += 1;
    }
    return;
  }

  if (Array.isArray(input)) {
    input.forEach((item) => visitInlineAssets(item, stats));
    return;
  }

  if (input && typeof input === "object") {
    Object.values(input as Record<string, unknown>).forEach((value) => visitInlineAssets(value, stats));
  }
}

export function countInlineAssets(input: unknown): InlineAssetStats {
  const stats: InlineAssetStats = {
    imageCount: 0,
    audioCount: 0,
    totalCount: 0,
  };
  visitInlineAssets(input, stats);
  return stats;
}

export function hasInlineAssets(input: unknown) {
  return countInlineAssets(input).totalCount > 0;
}
