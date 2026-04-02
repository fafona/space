import type { Block } from "@/data/homeBlocks";

export function getBlockLayer(block: Block) {
  const value = block.props.blockLayer;
  return typeof value === "number" && Number.isFinite(value) ? Math.max(1, Math.round(value)) : 1;
}

function hasNonZeroOffset(block: Block) {
  const offsetX = block.props.blockOffsetX;
  const offsetY = block.props.blockOffsetY;
  return (
    (typeof offsetX === "number" && Number.isFinite(offsetX) && Math.round(offsetX) !== 0) ||
    (typeof offsetY === "number" && Number.isFinite(offsetY) && Math.round(offsetY) !== 0)
  );
}

function hasCustomLayerOrder(block: Block, index: number) {
  const value = block.props.blockLayer;
  if (typeof value !== "number" || !Number.isFinite(value)) return false;
  return Math.max(1, Math.round(value)) !== index + 1;
}

export function getBlockRenderStackOrder(block: Block, index: number, total: number) {
  const layer = getBlockLayer(block);
  const offset = hasNonZeroOffset(block);
  const customLayer = hasCustomLayerOrder(block, index);
  if (!offset && !customLayer) return undefined;
  const reverseIndex = Math.max(0, total - index);
  if (customLayer) {
    return 1_000_000 + layer * 1_000 + reverseIndex;
  }
  return 100_000 + reverseIndex;
}
