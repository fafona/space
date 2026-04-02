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

test("does not force stacking for plain flow blocks", () => {
  assert.equal(getBlockRenderStackOrder(makeBlock("a"), 0, 4), undefined);
});

test("does not force stacking for blocks that only follow natural layer order", () => {
  assert.equal(getBlockRenderStackOrder(makeBlock("b", 2), 1, 4), undefined);
});

test("renders offset blocks above later blocks within the same layer", () => {
  const first = getBlockRenderStackOrder(
    {
      ...makeBlock("a"),
      props: {
        ...makeBlock("a").props,
        blockOffsetY: -24,
      } as never,
    },
    0,
    4,
  );
  const later = getBlockRenderStackOrder(
    {
      ...makeBlock("b"),
      props: {
        ...makeBlock("b").props,
        blockOffsetY: -24,
      } as never,
    },
    3,
    4,
  );
  assert.ok(typeof first === "number");
  assert.ok(typeof later === "number");
  assert.ok(first > later);
});

test("keeps higher block layers above lower layers", () => {
  const lowerLayer = getBlockRenderStackOrder(makeBlock("a", 3), 0, 4);
  const higherLayer = getBlockRenderStackOrder(makeBlock("b", 4), 1, 4);
  assert.ok(typeof lowerLayer === "number");
  assert.ok(typeof higherLayer === "number");
  assert.ok(higherLayer > lowerLayer);
});

test("keeps custom layers above offset-only blocks", () => {
  const offsetOnly = getBlockRenderStackOrder(
    {
      ...makeBlock("a"),
      props: {
        ...makeBlock("a").props,
        blockOffsetY: 40,
      } as never,
    },
    0,
    4,
  );
  const customLayer = getBlockRenderStackOrder(makeBlock("b", 4), 1, 4);
  assert.ok(typeof offsetOnly === "number");
  assert.ok(typeof customLayer === "number");
  assert.ok(customLayer > offsetOnly);
});
