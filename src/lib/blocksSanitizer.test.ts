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
