import assert from "node:assert/strict";
import test from "node:test";
import type { Block } from "@/data/homeBlocks";
import {
  buildPollExportRows,
  buildPollRoundOverviews,
  buildPollSummary,
  collectPublishedPollRounds,
  findPublishedPollConfig,
  getPollAvailability,
  getPollAudienceAccessError,
  getPollConfigurationIssue,
  getPollIdentityIds,
  getPollParticipantTypeLabel,
  hasActivePollMerchantMembership,
  normalizePollConfig,
  normalizePollRoundBallotMetadata,
  normalizePollQuestions,
  normalizeStoredPollBallot,
  pollBallotMatchesSearch,
  POLL_MAX_OPTIONS,
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
  assert.equal(config.audience, "everyone");
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

test("poll audiences default safely and enforce registered/member access", () => {
  assert.equal(normalizePollConfig({ pollAudience: "registered-users" }).audience, "registered-users");
  assert.equal(normalizePollConfig({ pollAudience: "merchant-members" }).audience, "merchant-members");
  assert.equal(normalizePollConfig({ pollAudience: "unknown" }).audience, "everyone");

  assert.equal(
    getPollAudienceAccessError("registered-users", { registered: false, merchantMember: false }),
    "registered_user_required",
  );
  assert.equal(
    getPollAudienceAccessError("registered-users", { registered: true, merchantMember: false }),
    "",
  );
  assert.equal(
    getPollAudienceAccessError("merchant-members", { registered: true, merchantMember: false }),
    "merchant_membership_required",
  );
  assert.equal(
    getPollAudienceAccessError("merchant-members", { registered: true, merchantMember: true }),
    "",
  );
  assert.equal(getPollAudienceAccessError("everyone", { registered: false, merchantMember: false }), "");
});

test("merchant-only poll access matches an active membership in the publishing merchant", () => {
  const memberships = [
    { siteId: "10000000", status: "active", accountId: "account-1", userId: "user-1", email: "member@example.com" },
    { siteId: "20000000", status: "active", accountId: "account-2", userId: "user-2", email: "other@example.com" },
    { siteId: "10000000", status: "left", accountId: "account-3", userId: "user-3", email: "left@example.com" },
  ];
  assert.equal(
    hasActivePollMerchantMembership("10000000", memberships, { accountId: "account-1", userId: "", email: "" }),
    true,
  );
  assert.equal(
    hasActivePollMerchantMembership("10000000", memberships, { accountId: "", userId: "", email: "MEMBER@example.com" }),
    true,
  );
  assert.equal(
    hasActivePollMerchantMembership("10000000", memberships, { accountId: "account-2", userId: "user-2", email: "" }),
    false,
  );
  assert.equal(
    hasActivePollMerchantMembership("10000000", memberships, { accountId: "account-3", userId: "user-3", email: "" }),
    false,
  );
});

test("poll choice questions retain up to 36 options", () => {
  const options = Array.from({ length: POLL_MAX_OPTIONS + 5 }, (_, index) => ({
    id: `option-${index + 1}`,
    label: `选项 ${index + 1}`,
  }));
  const normalized = normalizePollConfig({
    pollQuestions: [{ id: "q-many", prompt: "请选择", type: "multiple", options }],
  });
  assert.equal(POLL_MAX_OPTIONS, 36);
  assert.equal(normalized.questions[0]?.options.length, 36);
  assert.equal(normalized.questions[0]?.options.at(-1)?.label, "选项 36");
});

test("stored ballots preserve registered participant identity", () => {
  const ballot = normalizeStoredPollBallot({
    id: "ballot-registered",
    participant_type: "registered",
    participant_name: "用户甲",
    anonymous: false,
    answers: [],
    poll_snapshot: { heading: "注册用户投票", questions: [], audience: "registered-users" },
    created_at: "2026-08-07T10:00:00.000Z",
  });
  assert.equal(ballot?.participantType, "registered");
  assert.equal(ballot?.pollSnapshot.audience, "registered-users");
  assert.equal(getPollParticipantTypeLabel("registered"), "注册用户");
});

test("poll availability follows configured opening and closing times", () => {
  const scheduled = normalizePollConfig({
    pollOpenAt: "2026-08-08T08:00:00.000Z",
    pollCloseAt: "2026-08-08T10:00:00.000Z",
  });
  assert.equal(getPollAvailability(scheduled, Date.parse("2026-08-08T07:59:59.000Z")), "scheduled");
  assert.equal(getPollAvailability(scheduled, Date.parse("2026-08-08T09:00:00.000Z")), "open");
  assert.equal(getPollAvailability(scheduled, Date.parse("2026-08-08T10:00:00.000Z")), "closed");
  assert.equal(getPollConfigurationIssue(scheduled), "missing_questions");

  const invalidSchedule = normalizePollConfig({
    pollOpenAt: "2026-08-08T10:00:00.000Z",
    pollCloseAt: "2026-08-08T09:00:00.000Z",
    pollQuestions: questions,
  });
  assert.equal(getPollConfigurationIssue(invalidSchedule), "invalid_schedule");

  const manuallyClosed = normalizePollConfig({ pollStatus: "closed" });
  assert.equal(getPollAvailability(manuallyClosed, Date.parse("2026-08-08T09:00:00.000Z")), "closed");
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
      ballotNo: "XP1000000026080600001",
      participantType: "member",
      participantName: "会员甲",
      anonymous: false,
      answers: [
        { questionId: "q-single", optionIds: ["a"], text: "" },
        { questionId: "q-multiple", optionIds: ["c", "d"], text: "" },
        { questionId: "q-text", optionIds: [], text: "文字回答" },
      ],
      pollSnapshot: { heading: config.heading, questions },
      source: "pc_web",
      invalidatedAt: "",
      invalidatedBy: "",
      createdAt: "2026-08-06T10:00:00.000Z",
    },
    {
      id: "ballot-2",
      ballotNo: "XP1000000026080600002",
      participantType: "guest",
      participantName: "",
      anonymous: true,
      answers: [{ questionId: "q-single", optionIds: ["b"], text: "" }],
      pollSnapshot: { heading: config.heading, questions },
      source: "contact_card",
      invalidatedAt: "",
      invalidatedBy: "",
      createdAt: "2026-08-06T10:01:00.000Z",
    },
    {
      id: "ballot-3",
      ballotNo: "XP1000000026080600003",
      participantType: "registered",
      participantName: "已作废用户",
      anonymous: false,
      answers: [
        { questionId: "q-single", optionIds: ["a"], text: "" },
        { questionId: "q-text", optionIds: [], text: "不应进入统计" },
      ],
      pollSnapshot: { heading: config.heading, questions },
      source: "mobile_web",
      invalidatedAt: "2026-08-06T11:00:00.000Z",
      invalidatedBy: "admin@example.com",
      createdAt: "2026-08-06T10:02:00.000Z",
    },
  ];

  const publicSummary = buildPollSummary(ballots, questions);
  assert.equal(publicSummary.totalBallots, 2);
  assert.equal(publicSummary.invalidatedBallots, 1);
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
  assert.equal(rows[0]["选票编号"], "XP1000000026080600001");
  assert.equal(rows[0]["来源"], "PC网页");
  assert.equal(rows[1]["来源"], "联系卡");
  assert.equal(rows[2]["来源"], "手机网页");
  assert.equal(rows[2]["选票状态"], "已作废");
  assert.equal(rows[2]["操作人"], "admin@example.com");
  assert.equal(Object.hasOwn(rows[0], "投票名称（提交时）"), false);

  assert.equal(pollBallotMatchesSearch(ballots[0], adminSummary, "会员甲"), true);
  assert.equal(pollBallotMatchesSearch(ballots[0], adminSummary, "PC网页"), true);
  assert.equal(pollBallotMatchesSearch(ballots[0], adminSummary, "XP1000000026080600001"), true);
  assert.equal(pollBallotMatchesSearch(ballots[0], adminSummary, "可选择多个"), true);
  assert.equal(pollBallotMatchesSearch(ballots[0], adminSummary, "丙；丁"), true);
  assert.equal(pollBallotMatchesSearch(ballots[0], adminSummary, "不存在的内容"), false);
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

test("identical legacy desktop and mobile poll copies share one published round", () => {
  const mobileQuestions = questions.map((question, questionIndex) => ({
    ...question,
    id: `mobile-question-${questionIndex + 1}`,
    options: question.options.map((option, optionIndex) => ({
      ...option,
      id: `mobile-option-${questionIndex + 1}-${optionIndex + 1}`,
    })),
  }));
  const desktop: Block = {
    id: "poll-desktop",
    type: "poll",
    props: {
      pollId: "poll-desktop-random",
      heading: "跨端投票",
      text: "同一轮投票",
      pollQuestions: questions,
    },
  };
  const mobile: Block = {
    id: "poll-mobile",
    type: "poll",
    props: {
      pollId: "poll-mobile-random",
      heading: "跨端投票",
      text: "同一轮投票",
      pollQuestions: mobileQuestions,
    },
  };

  const rounds = collectPublishedPollRounds([desktop, mobile]);
  assert.equal(rounds.length, 1);
  assert.deepEqual(
    new Set(getPollIdentityIds(rounds[0].config)),
    new Set(["poll-desktop-random", "poll-mobile-random"]),
  );
  assert.equal(findPublishedPollConfig([desktop, mobile], "poll-mobile-random")?.config.pollId, "poll-desktop-random");
});

test("legacy desktop and mobile ballots aggregate equivalent questions with different internal ids", () => {
  const mobileQuestions = normalizePollQuestions(questions.map((question, questionIndex) => ({
    ...question,
    id: `mobile-question-${questionIndex + 1}`,
    options: question.options.map((option, optionIndex) => ({
      ...option,
      id: `mobile-option-${questionIndex + 1}-${optionIndex + 1}`,
    })),
  })));
  const ballots: PollStoredBallot[] = [
    {
      id: "desktop-ballot",
      ballotNo: "XP1000000026080900001",
      participantType: "guest",
      participantName: "Desktop",
      anonymous: false,
      answers: [{ questionId: questions[0].id, optionIds: [questions[0].options[0].id], text: "" }],
      pollSnapshot: { heading: "Shared poll", questions },
      source: "pc_web",
      invalidatedAt: "",
      invalidatedBy: "",
      createdAt: "2026-08-09T10:00:00.000Z",
    },
    {
      id: "mobile-ballot",
      ballotNo: "XP1000000026080900002",
      participantType: "guest",
      participantName: "Mobile",
      anonymous: false,
      answers: [{ questionId: mobileQuestions[0].id, optionIds: [mobileQuestions[0].options[0].id], text: "" }],
      pollSnapshot: { heading: "Shared poll", questions: mobileQuestions },
      source: "mobile_web",
      invalidatedAt: "",
      invalidatedBy: "",
      createdAt: "2026-08-09T10:01:00.000Z",
    },
  ];

  const summary = buildPollSummary(ballots, questions, { includeTextResponses: true });
  assert.equal(summary.questions.length, questions.length);
  assert.equal(summary.questions[0].responseCount, 2);
  assert.equal(summary.questions[0].options[0].count, 2);
  const rows = buildPollExportRows(ballots, summary);
  assert.equal(rows[1][`Q1 ${questions[0].prompt}`], questions[0].options[0].label);
});

test("explicit TP identity remains canonical across copied poll blocks", () => {
  const pollId = "TP1000000026080901";
  const desktop: Block = {
    id: "poll-desktop",
    type: "poll",
    props: { pollId, pollLegacyIds: ["legacy-desktop"], heading: "统一投票", pollQuestions: questions },
  };
  const mobile: Block = {
    id: "poll-mobile",
    type: "poll",
    props: { pollId, pollLegacyIds: ["legacy-mobile"], heading: "统一投票", pollQuestions: questions },
  };

  const rounds = collectPublishedPollRounds([desktop, mobile]);
  assert.equal(rounds.length, 1);
  assert.equal(rounds[0].config.pollId, pollId);
  assert.deepEqual(
    new Set(getPollIdentityIds(rounds[0].config)),
    new Set([pollId, "legacy-desktop", "legacy-mobile"]),
  );
});

test("preferred copied block validates its local questions under the shared poll identity", () => {
  const pollId = "TP1000000026080901";
  const desktop: Block = {
    id: "poll-desktop",
    type: "poll",
    props: {
      pollId,
      heading: "Desktop poll",
      pollQuestions: [{
        id: "desktop-question",
        type: "single",
        prompt: "Desktop question",
        required: true,
        options: [
          { id: "desktop-option-a", label: "Desktop option A" },
          { id: "desktop-option-b", label: "Desktop option B" },
        ],
      }],
    },
  };
  const mobile: Block = {
    id: "poll-mobile",
    type: "poll",
    props: {
      pollId,
      heading: "Mobile poll",
      pollQuestions: [{
        id: "mobile-question",
        type: "single",
        prompt: "Mobile question",
        required: true,
        options: [
          { id: "mobile-option-a", label: "Mobile option A" },
          { id: "mobile-option-b", label: "Mobile option B" },
        ],
      }],
    },
  };

  const found = findPublishedPollConfig([desktop, mobile], pollId, mobile.id);
  assert.equal(found?.blockId, mobile.id);
  assert.equal(found?.config.pollId, pollId);
  assert.equal(found?.config.heading, "Mobile poll");
  assert.equal(found?.config.questions[0]?.id, "mobile-question");
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
