import assert from "node:assert/strict";
import test from "node:test";
import type { Block } from "@/data/homeBlocks";
import {
  buildPollExportRows,
  buildPollRoundOverviews,
  buildPollSummary,
  findPublishedPollConfig,
  getPollConfigurationIssue,
  normalizePollConfig,
  normalizePollRoundBallotMetadata,
  normalizePollQuestions,
  validatePollAnswers,
  type PollStoredBallot,
} from "@/lib/merchantPolls";

const questions = normalizePollQuestions([
  {
    id: "q-single",
    prompt: "请选择一个",
    type: "single",
    required: true,
    options: [
      { id: "a", label: "甲" },
      { id: "b", label: "乙" },
    ],
  },
  {
    id: "q-multiple",
    prompt: "可选择多个",
    type: "multiple",
    required: false,
    options: [
      { id: "c", label: "丙" },
      { id: "d", label: "丁" },
    ],
  },
  {
    id: "q-text",
    prompt: "补充说明",
    type: "text",
    required: false,
  },
]);

const config = normalizePollConfig({
  pollId: "poll-round-1",
  heading: "满意度调查",
  pollQuestions: questions,
});

test("poll config normalizes supported question types and rejects incomplete choices", () => {
  assert.equal(getPollConfigurationIssue(config), "");
  assert.equal(config.questions.length, 3);
  assert.equal(config.allowAnonymous, true);
  assert.equal(config.nameLabel, "您的名称");
  assert.equal(config.contentBackgroundOpacity, 0.72);

  const customName = normalizePollConfig({
    pollAllowAnonymous: false,
    pollNameLabel: "联系人称呼",
    pollNamePlaceholder: "请输入联系人称呼",
  });
  assert.equal(customName.allowAnonymous, false);
  assert.equal(customName.nameLabel, "联系人称呼");
  assert.equal(customName.namePlaceholder, "请输入联系人称呼");

  assert.equal(normalizePollConfig({ pollContentBackgroundOpacity: 0.36 }).contentBackgroundOpacity, 0.36);
  assert.equal(normalizePollConfig({ pollContentBackgroundOpacity: -1 }).contentBackgroundOpacity, 0);
  assert.equal(normalizePollConfig({ pollContentBackgroundOpacity: 3 }).contentBackgroundOpacity, 1);

  const invalid = normalizePollConfig({
    pollId: "poll-invalid",
    pollQuestions: [{ id: "q", prompt: "不完整", type: "single", options: [{ id: "only", label: "仅一个" }] }],
  });
  assert.equal(getPollConfigurationIssue(invalid), "question_requires_options:q");
});

test("poll answers enforce required questions and validate option ownership", () => {
  const missing = validatePollAnswers(config, []);
  assert.deepEqual(missing, { ok: false, code: "required_answer_missing", questionId: "q-single" });

  const foreign = validatePollAnswers(config, [{ questionId: "q-single", optionIds: ["not-allowed"] }]);
  assert.deepEqual(foreign, { ok: false, code: "invalid_option", questionId: "q-single" });

  const valid = validatePollAnswers(config, [
    { questionId: "q-single", optionIds: ["a", "b"] },
    { questionId: "q-multiple", optionIds: ["c", "d", "c"] },
    { questionId: "q-text", text: "  服务很好  " },
  ]);
  assert.equal(valid.ok, true);
  if (!valid.ok) return;
  assert.deepEqual(valid.answers, [
    { questionId: "q-single", optionIds: ["a"], text: "" },
    { questionId: "q-multiple", optionIds: ["c", "d"], text: "" },
    { questionId: "q-text", optionIds: [], text: "服务很好" },
  ]);
});

test("poll summary counts choices, skips and private text responses without leaking publicly", () => {
  const ballots: PollStoredBallot[] = [
    {
      id: "ballot-1",
      participantType: "member",
      participantName: "会员甲",
      anonymous: false,
      answers: [
        { questionId: "q-single", optionIds: ["a"], text: "" },
        { questionId: "q-multiple", optionIds: ["c", "d"], text: "" },
        { questionId: "q-text", optionIds: [], text: "文字回答" },
      ],
      pollSnapshot: { heading: config.heading, questions },
      createdAt: "2026-08-06T10:00:00.000Z",
    },
    {
      id: "ballot-2",
      participantType: "guest",
      participantName: "",
      anonymous: true,
      answers: [{ questionId: "q-single", optionIds: ["b"], text: "" }],
      pollSnapshot: { heading: config.heading, questions },
      createdAt: "2026-08-06T10:01:00.000Z",
    },
  ];

  const publicSummary = buildPollSummary(ballots, questions);
  assert.equal(publicSummary.totalBallots, 2);
  assert.equal(publicSummary.anonymousBallots, 1);
  assert.equal(publicSummary.questions[0].responseCount, 2);
  assert.deepEqual(publicSummary.questions[0].options.map((option) => option.count), [1, 1]);
  assert.equal(publicSummary.questions[1].skippedCount, 1);
  assert.equal(publicSummary.questions[2].textResponses, undefined);

  const adminSummary = buildPollSummary(ballots, questions, { includeTextResponses: true });
  assert.equal(adminSummary.questions[2].textResponses?.[0]?.participantName, "会员甲");
  assert.equal(adminSummary.questions[2].textResponses?.[0]?.value, "文字回答");

  const rows = buildPollExportRows(ballots, adminSummary);
  assert.equal(rows[0]["身份"], "会员");
  assert.equal(rows[1]["投票人"], "匿名");
  assert.equal(rows[0]["Q2 可选择多个"], "丙；丁");
});

test("published poll lookup traverses nested desktop and mobile page plans", () => {
  const pollBlock: Block = {
    id: "poll-block",
    type: "poll",
    props: {
      pollId: "nested-poll",
      heading: "嵌套投票",
      pollQuestions: questions,
    },
  };
  const root = {
    id: "root-common",
    type: "common",
    props: {
      pagePlanConfigMobile: {
        plans: [{ pages: [{ blocks: [pollBlock] }] }],
      },
    },
  } as unknown as Block;

  const found = findPublishedPollConfig([root], "nested-poll", "poll-block");
  assert.equal(found?.blockId, "poll-block");
  assert.equal(found?.config.heading, "嵌套投票");
});

test("poll round overviews retain historical rounds and include published zero-ballot rounds", () => {
  const historical = normalizePollRoundBallotMetadata({
    poll_id: "round-old",
    block_id: "poll-old",
    anonymous: true,
    poll_snapshot: { heading: "旧投票", questions },
    created_at: "2026-08-01T10:00:00.000Z",
  });
  assert.ok(historical);

  const rounds = buildPollRoundOverviews(
    historical ? [historical] : [],
    [{
      blockId: "poll-current",
      config: normalizePollConfig({
        pollId: "round-current",
        heading: "当前投票",
        pollStatus: "open",
        pollQuestions: questions,
      }),
    }],
  );
  assert.equal(rounds.length, 2);
  assert.equal(rounds[0].pollId, "round-current");
  assert.equal(rounds[0].published, true);
  assert.equal(rounds[0].totalBallots, 0);
  assert.equal(rounds[1].pollId, "round-old");
  assert.equal(rounds[1].status, "historical");
  assert.equal(rounds[1].anonymousBallots, 1);
});
