import type { Block } from "@/data/homeBlocks";
import { countInlineAssets } from "@/lib/inlineAssetStats";

export function getInlinePublishPayloadViolation(blocks: Block[]) {
  const inlineAssets = countInlineAssets(blocks);
  if (inlineAssets.totalCount <= 0) return null;
  const parts: string[] = [];
  if (inlineAssets.imageCount > 0) parts.push(`图片 ${inlineAssets.imageCount}`);
  if (inlineAssets.audioCount > 0) parts.push(`音频 ${inlineAssets.audioCount}`);
  return `发布请求包含未外链化资源（${parts.join("，")}）`;
}
