import assert from "node:assert/strict";
import test from "node:test";
import type { Block } from "../data/homeBlocks";
import { getBlockLayer, getBlockRenderStackOrder } from "./blockStacking";

function makeBlock(id: string, layer?: number): Block {
  return {
    id,
    type: "common",
    props: {
      commonTextBoxes: [],
      ...(typeof layer === "number" ? { blockLayer: layer } : {}),
    } as never,
  };
}

test("uses layer 1 when blockLayer is missing", () => {
  assert.equal(getBlockLayer(makeBlock("a")), 1);
});

test("renders earlier blocks above later blocks within the same layer", () => {
  const first = getBlockRenderStackOrder(makeBlock("a"), 0, 4);
  const later = getBlockRenderStackOrder(makeBlock("b"), 3, 4);
  assert.ok(first > later);
});

test("keeps higher block layers above lower layers", () => {
  const lowerLayer = getBlockRenderStackOrder(makeBlock("a", 1), 0, 4);
  const higherLayer = getBlockRenderStackOrder(makeBlock("b", 2), 3, 4);
  assert.ok(higherLayer > lowerLayer);
});
