import type { Block } from "@/data/homeBlocks";

export function getBlockLayer(block: Block) {
  const value = block.props.blockLayer;
  return typeof value === "number" && Number.isFinite(value) ? Math.max(1, Math.round(value)) : 1;
}

function hasCustomLayerOrder(block: Block, index: number) {
  const value = block.props.blockLayer;
  if (typeof value !== "number" || !Number.isFinite(value)) return false;
  return Math.max(1, Math.round(value)) !== index + 1;
}

export function getBlockRenderStackOrder(block: Block, index: number, total: number) {
  const layer = getBlockLayer(block);
  const customLayer = hasCustomLayerOrder(block, index);
  if (!customLayer) return undefined;
  const reverseIndex = Math.max(0, total - index);
  return 1_000_000 + layer * 1_000 + reverseIndex;
}
