import type { Block } from "@/data/homeBlocks";

export function getBlockLayer(block: Block) {
  const value = block.props.blockLayer;
  return typeof value === "number" && Number.isFinite(value) ? Math.max(1, Math.round(value)) : 1;
}

export function getBlockRenderStackOrder(block: Block, index: number, total: number) {
  const reverseIndex = Math.max(0, total - index);
  return getBlockLayer(block) * 10_000 + reverseIndex;
}
