import assert from "node:assert/strict";
import test from "node:test";

import type { Block } from "@/data/homeBlocks";
import { findStyleTransferTargetBlock } from "./editorStyleTransfer";

function poll(id: string, heading: string, pollId = ""): Block {
  return {
    id,
    type: "poll",
    props: {
      heading,
      pollId,
    },
  };
}

test("style transfer prefers an exact block id", () => {
  const source = poll("poll-a", "活动投票", "source-poll");
  const target = [poll("poll-other", "活动投票", "other-poll"), poll("poll-a", "另一投票", "target-poll")];

  assert.deepEqual(findStyleTransferTargetBlock(source, [source], target), {
    targetIndex: 1,
    strategy: "id",
  });
});

test("style transfer matches a poll by poll id across viewport block ids", () => {
  const source = poll("desktop-poll", "活动投票", "poll-shared");
  const target = [poll("mobile-poll", "手机标题", "poll-shared")];

  assert.deepEqual(findStyleTransferTargetBlock(source, [source], target), {
    targetIndex: 0,
    strategy: "entity",
  });
});

test("style transfer matches a separately created poll by its unique heading", () => {
  const source = poll("desktop-poll", "满意度调查", "desktop-entity");
  const target = [
    poll("mobile-poll-1", "其他投票", "mobile-entity-1"),
    poll("mobile-poll-2", "满意度调查", "mobile-entity-2"),
  ];

  assert.deepEqual(findStyleTransferTargetBlock(source, [source], target), {
    targetIndex: 1,
    strategy: "label",
  });
});

test("style transfer falls back to the same type occurrence", () => {
  const source = [poll("desktop-poll-1", "重复标题"), poll("desktop-poll-2", "重复标题")];
  const target = [poll("mobile-poll-1", "重复标题"), poll("mobile-poll-2", "重复标题")];

  assert.deepEqual(findStyleTransferTargetBlock(source[1], source, target), {
    targetIndex: 1,
    strategy: "occurrence",
  });
});

test("style transfer reports no match when the target page lacks the block type", () => {
  const source = poll("desktop-poll", "活动投票");
  const target: Block[] = [{ id: "text-a", type: "text", props: { heading: "说明", text: "说明内容" } }];

  assert.equal(findStyleTransferTargetBlock(source, [source], target), null);
});
