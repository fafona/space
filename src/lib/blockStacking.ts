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

export function getBlockRenderStackOrder(block: Block, index: number, total: number) {
  const layer = getBlockLayer(block);
  if (layer <= 1 && !hasNonZeroOffset(block)) return undefined;
  const reverseIndex = Math.max(0, total - index);
  return layer * 10_000 + reverseIndex;
}
