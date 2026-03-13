import assert from "node:assert/strict";
import test from "node:test";
import type { Block } from "../data/homeBlocks";
import { BLOCKS_SCHEMA_VERSION } from "./blocksSchema";
import { sanitizeBlocksForRuntime } from "./blocksSanitizer";

function makeCommonBlock(props: Record<string, unknown>): Block {
  return {
    id: "b-common",
    type: "common",
    props: props as never,
  };
}

test("removes blockGroup and migrates schemaVersion to current version", () => {
  const input = [
    makeCommonBlock({
      commonTextBoxes: [],
      blockGroup: "hero-group",
      nested: {
        blockGroup: "nested-group",
      },
    }),
  ];

  const result = sanitizeBlocksForRuntime(input);
  const props = result.blocks[0].props as Record<string, unknown>;
  const nested = props.nested as Record<string, unknown>;

  assert.equal(props.blockGroup, undefined);
  assert.equal(nested.blockGroup, undefined);
  assert.equal(props.schemaVersion, BLOCKS_SCHEMA_VERSION);
  assert.ok(result.removed >= 3);
});

test("drops oversized inline image/audio data URLs", () => {
  const oversizedImage = `data:image/png;base64,${"a".repeat(6_000_001)}`;
  const oversizedAudio = `data:audio/mp3;base64,${"b".repeat(4_000_001)}`;
  const input = [
    makeCommonBlock({
      commonTextBoxes: [],
      heroImage: oversizedImage,
      nested: {
        audio: oversizedAudio,
      },
    }),
  ];

  const result = sanitizeBlocksForRuntime(input);
  const props = result.blocks[0].props as Record<string, unknown>;
  const nested = props.nested as Record<string, unknown>;

  assert.equal(props.heroImage, "");
  assert.equal(nested.audio, "");
  assert.ok(result.removed >= 3);
});

test("keeps current schemaVersion and normal URLs unchanged", () => {
  const smallImage = `data:image/png;base64,${"c".repeat(1024)}`;
  const input = [
    makeCommonBlock({
      schemaVersion: BLOCKS_SCHEMA_VERSION,
      commonTextBoxes: [],
      heroImage: smallImage,
    }),
  ];

  const result = sanitizeBlocksForRuntime(input);
  const props = result.blocks[0].props as Record<string, unknown>;

  assert.equal(props.schemaVersion, BLOCKS_SCHEMA_VERSION);
  assert.equal(props.heroImage, smallImage);
  assert.equal(result.removed, 0);
});

test("normalizes legacy portal search and merchant list overlap sequence", () => {
  const input = [
    makeCommonBlock({
      commonTextBoxes: [],
      pagePlanConfig: {
        activePlanId: "plan-1",
        plans: [
          {
            id: "plan-1",
            activePageId: "page-1",
            pages: [
              {
                id: "page-1",
                name: "首页",
                blocks: [
                  { id: "b-nav", type: "nav", props: { heading: "导航", navItems: [] } },
                  {
                    id: "b-merchant",
                    type: "merchant-list",
                    props: {
                      heading: "商户列表",
                      text: "说明",
                      blockOffsetX: 1,
                      blockOffsetY: 225,
                    },
                  },
                  {
                    id: "b-contact",
                    type: "contact",
                    props: {
                      heading: "联系我们",
                      phone: "",
                      address: "",
                      blockOffsetX: 1,
                      blockOffsetY: 189,
                    },
                  },
                  {
                    id: "b-search",
                    type: "search-bar",
                    props: {
                      heading: "搜索",
                      text: "说明",
                      blockOffsetX: 1,
                      blockOffsetY: -1287,
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
    }),
  ];

  const result = sanitizeBlocksForRuntime(input);
  const props = result.blocks[0].props as Record<string, unknown>;
  const pagePlanConfig = props.pagePlanConfig as {
    plans: Array<{ pages: Array<{ blocks: Block[] }> }>;
  };
  const blocks = pagePlanConfig.plans[0]?.pages[0]?.blocks ?? [];

  assert.deepEqual(
    blocks.map((block) => block.type),
    ["nav", "search-bar", "merchant-list", "contact"],
  );
  assert.equal((blocks[1]?.props as Record<string, unknown>).blockOffsetY, 0);
  assert.equal((blocks[2]?.props as Record<string, unknown>).blockOffsetY, 0);
  assert.equal((blocks[3]?.props as Record<string, unknown>).blockOffsetY, 0);
});

test("normalizes legacy mobile portal search sequence without nav block", () => {
  const input = [
    makeCommonBlock({
      commonTextBoxes: [],
      pagePlanConfigMobile: {
        activePlanId: "plan-1",
        plans: [
          {
            id: "plan-1",
            activePageId: "page-1",
            pages: [
              {
                id: "page-1",
                name: "首页",
                blocks: [
                  {
                    id: "b-merchant",
                    type: "merchant-list",
                    props: {
                      heading: "商户列表",
                      text: "说明",
                      blockOffsetX: -17,
                      blockOffsetY: 304,
                    },
                  },
                  {
                    id: "b-contact",
                    type: "contact",
                    props: {
                      heading: "联系我们",
                      phone: "",
                      address: "",
                      blockOffsetX: -17,
                      blockOffsetY: 267,
                    },
                  },
                  {
                    id: "b-search",
                    type: "search-bar",
                    props: {
                      heading: "搜索",
                      text: "说明",
                      blockOffsetX: -19,
                      blockOffsetY: -1251,
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
    }),
  ];

  const result = sanitizeBlocksForRuntime(input);
  const props = result.blocks[0].props as Record<string, unknown>;
  const pagePlanConfigMobile = props.pagePlanConfigMobile as {
    plans: Array<{ pages: Array<{ blocks: Block[] }> }>;
  };
  const blocks = pagePlanConfigMobile.plans[0]?.pages[0]?.blocks ?? [];

  assert.deepEqual(
    blocks.map((block) => block.type),
    ["search-bar", "merchant-list", "contact"],
  );
  assert.equal((blocks[0]?.props as Record<string, unknown>).blockOffsetY, 0);
  assert.equal((blocks[1]?.props as Record<string, unknown>).blockOffsetY, 0);
  assert.equal((blocks[2]?.props as Record<string, unknown>).blockOffsetY, 0);
});
