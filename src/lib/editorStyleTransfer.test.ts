import assert from "node:assert/strict";
import test from "node:test";

import type { Block } from "@/data/homeBlocks";
import { buildStyleTransferProps, findStyleTransferTargetBlock } from "./editorStyleTransfer";

function poll(id: string, heading: string, pollId = ""): Extract<Block, { type: "poll" }> {
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

test("style-only transfer leaves target content unchanged", () => {
  const source = poll("source", "源投票", "source-poll");
  source.props.bgColor = "#112233";
  const target = poll("target", "目标投票", "target-poll");
  target.props.bgColor = "#ffffff";

  const props = buildStyleTransferProps(source, target, ["bgColor"], false);

  assert.equal(props.heading, "目标投票");
  assert.equal(props.bgColor, "#112233");
  assert.equal(props.pollId, "target-poll");
});

test("content transfer copies editable values and poll identity while preserving page-owned state", () => {
  const source = poll("source", "源投票", "source-poll");
  source.props.pollLegacyIds = ["source-legacy"];
  source.props.text = "源说明";
  source.props.bgColor = "#112233";
  source.props.pollQuestions = [
    {
      id: "question-source",
      prompt: "请选择",
      type: "single",
      options: [{ id: "option-source", label: "选项一" }],
    },
  ];
  source.props.pageBgColor = "#000000";
  source.props.blockLocked = true;
  source.props.mobileFitScreenWidth = true;
  source.props.pagePlanConfig = { activePlanId: "source-plan" };

  const target = poll("target", "目标投票", "target-poll");
  target.props.pollLegacyIds = ["target-legacy"];
  target.props.text = "目标说明";
  target.props.pageBgColor = "#eeeeee";
  target.props.blockLocked = false;
  target.props.mobileFitScreenWidth = false;
  target.props.pagePlanConfig = { activePlanId: "target-plan" };

  const props = buildStyleTransferProps(source, target, ["bgColor"], true);

  assert.equal(props.heading, "源投票");
  assert.equal(props.text, "源说明");
  assert.equal(props.bgColor, "#112233");
  assert.deepEqual(props.pollQuestions, source.props.pollQuestions);
  assert.notEqual(props.pollQuestions, source.props.pollQuestions);
  assert.equal(props.pollId, "source-poll");
  assert.deepEqual(props.pollLegacyIds, ["source-legacy"]);
  assert.equal(props.pageBgColor, "#eeeeee");
  assert.equal(props.blockLocked, false);
  assert.equal(props.mobileFitScreenWidth, false);
  assert.deepEqual(props.pagePlanConfig, { activePlanId: "target-plan" });
});
