import type { Block, PollOption, PollProps, PollQuestion, PollQuestionType } from "@/data/homeBlocks";

export const POLL_MAX_QUESTIONS = 30;
export const POLL_MAX_OPTIONS = 24;
export const POLL_MAX_TEXT_ANSWER_LENGTH = 4000;

export type NormalizedPollQuestion = {
  id: string;
  prompt: string;
  type: PollQuestionType;
  required: boolean;
  options: PollOption[];
};

export type NormalizedPollConfig = {
  pollId: string;
  heading: string;
  text: string;
  status: "open" | "closed";
  questions: NormalizedPollQuestion[];
  allowAnonymous: boolean;
  showResultsAfterSubmit: boolean;
  submitLabel: string;
  successTitle: string;
  successText: string;
  nameLabel: string;
  namePlaceholder: string;
};

export type PollAnswer = {
  questionId: string;
  optionIds: string[];
  text: string;
};

export type PollAnswerValidationResult =
  | { ok: true; answers: PollAnswer[] }
  | { ok: false; code: string; questionId?: string };

export type PollStoredBallot = {
  id: string;
  participantType: "member" | "guest";
  participantName: string;
  anonymous: boolean;
  answers: PollAnswer[];
  pollSnapshot: {
    heading: string;
    questions: NormalizedPollQuestion[];
  };
  createdAt: string;
};

export type PollSummaryOption = PollOption & { count: number };

export type PollSummaryTextResponse = {
  ballotId: string;
  value: string;
  participantName: string;
  anonymous: boolean;
  createdAt: string;
};

export type PollSummaryQuestion = {
  id: string;
  prompt: string;
  type: PollQuestionType;
  required: boolean;
  active: boolean;
  responseCount: number;
  skippedCount: number;
  options: PollSummaryOption[];
  textResponses?: PollSummaryTextResponse[];
};

export type PollSummary = {
  totalBallots: number;
  anonymousBallots: number;
  questions: PollSummaryQuestion[];
};

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function trimText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function normalizeEntityId(value: unknown, fallback: string) {
  const normalized = trimText(value, 96)
    .replace(/[^A-Za-z0-9:_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || fallback;
}

function normalizeQuestionType(value: unknown): PollQuestionType {
  if (value === "multiple" || value === "text") return value;
  return "single";
}

export function createPollEntityId(prefix: string) {
  const safePrefix = normalizeEntityId(prefix, "poll");
  const random =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID().replace(/-/g, "")
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
  return `${safePrefix}-${random.slice(0, 24)}`;
}

function normalizeOptions(value: unknown, questionId: string) {
  const source = Array.isArray(value) ? value : [];
  const usedIds = new Set<string>();
  const options: PollOption[] = [];
  for (let index = 0; index < source.length && options.length < POLL_MAX_OPTIONS; index += 1) {
    const record = readRecord(source[index]);
    const label = trimText(record?.label, 240);
    if (!label) continue;
    let id = normalizeEntityId(record?.id, `${questionId}-option-${index + 1}`);
    if (usedIds.has(id)) id = `${id}-${index + 1}`;
    usedIds.add(id);
    options.push({ id, label });
  }
  return options;
}

export function normalizePollQuestions(value: unknown): NormalizedPollQuestion[] {
  const source = Array.isArray(value) ? value : [];
  const usedIds = new Set<string>();
  const questions: NormalizedPollQuestion[] = [];
  for (let index = 0; index < source.length && questions.length < POLL_MAX_QUESTIONS; index += 1) {
    const record = readRecord(source[index]);
    if (!record) continue;
    const prompt = trimText(record.prompt, 400);
    if (!prompt) continue;
    let id = normalizeEntityId(record.id, `question-${index + 1}`);
    if (usedIds.has(id)) id = `${id}-${index + 1}`;
    usedIds.add(id);
    const type = normalizeQuestionType(record.type);
    questions.push({
      id,
      prompt,
      type,
      required: record.required === true,
      options: type === "text" ? [] : normalizeOptions(record.options, id),
    });
  }
  return questions;
}

export function normalizePollConfig(value: PollProps | Record<string, unknown> | null | undefined, fallbackPollId = "poll") {
  const record = readRecord(value) ?? {};
  return {
    pollId: normalizeEntityId(record.pollId, normalizeEntityId(fallbackPollId, "poll")),
    heading: trimText(record.heading, 1000) || "在线投票",
    text: trimText(record.text, 4000),
    status: record.pollStatus === "closed" ? "closed" : "open",
    questions: normalizePollQuestions(record.pollQuestions),
    allowAnonymous: record.pollAllowAnonymous !== false,
    showResultsAfterSubmit: record.pollShowResultsAfterSubmit === true,
    submitLabel: trimText(record.pollSubmitLabel, 80) || "提交投票",
    successTitle: trimText(record.pollSuccessTitle, 160) || "投票已提交",
    successText: trimText(record.pollSuccessText, 600) || "感谢您的参与。",
    nameLabel: trimText(record.pollNameLabel, 120) || "您的名称",
    namePlaceholder: trimText(record.pollNamePlaceholder, 120) || "请输入您的名称",
  } satisfies NormalizedPollConfig;
}

export function getPollConfigurationIssue(config: NormalizedPollConfig) {
  if (!config.pollId) return "missing_poll_id";
  if (config.questions.length === 0) return "missing_questions";
  for (const question of config.questions) {
    if (question.type !== "text" && question.options.length < 2) {
      return `question_requires_options:${question.id}`;
    }
  }
  return "";
}

function collectNestedBlocks(value: unknown, output: Block[], visited: Set<unknown>) {
  if (!value || typeof value !== "object" || visited.has(value)) return;
  visited.add(value);
  if (Array.isArray(value)) {
    for (const item of value) collectNestedBlocks(item, output, visited);
    return;
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.id === "string" &&
    typeof record.type === "string" &&
    record.props &&
    typeof record.props === "object" &&
    !Array.isArray(record.props)
  ) {
    const block = record as unknown as Block;
    output.push(block);
    const props = record.props as Record<string, unknown>;
    collectNestedBlocks(props.pagePlanConfig, output, visited);
    collectNestedBlocks(props.pagePlanConfigMobile, output, visited);
    return;
  }
  collectNestedBlocks(record.blocks, output, visited);
  collectNestedBlocks(record.pages, output, visited);
  collectNestedBlocks(record.plans, output, visited);
}

export function collectPublishedPollBlocks(blocks: Block[]) {
  const output: Block[] = [];
  collectNestedBlocks(blocks, output, new Set<unknown>());
  return output.filter((block): block is Extract<Block, { type: "poll" }> => block.type === "poll");
}

export function findPublishedPollConfig(blocks: Block[], pollId: string, preferredBlockId = "") {
  const normalizedPollId = normalizeEntityId(pollId, "");
  if (!normalizedPollId) return null;
  const candidates = collectPublishedPollBlocks(blocks)
    .map((block) => ({ block, config: normalizePollConfig(block.props, block.id) }))
    .filter((entry) => entry.config.pollId === normalizedPollId);
  const matched = candidates.find((entry) => preferredBlockId && entry.block.id === preferredBlockId) ?? candidates[0];
  return matched ? { blockId: matched.block.id, config: matched.config } : null;
}

export function validatePollAnswers(config: NormalizedPollConfig, value: unknown): PollAnswerValidationResult {
  if (getPollConfigurationIssue(config)) return { ok: false, code: "invalid_poll_configuration" };
  const source = Array.isArray(value) ? value : [];
  const inputByQuestion = new Map<string, Record<string, unknown>>();
  const knownQuestionIds = new Set(config.questions.map((question) => question.id));
  for (const item of source) {
    const record = readRecord(item);
    const questionId = trimText(record?.questionId, 96);
    if (!questionId || !knownQuestionIds.has(questionId) || inputByQuestion.has(questionId)) {
      return { ok: false, code: "invalid_answer_shape", ...(questionId ? { questionId } : {}) };
    }
    inputByQuestion.set(questionId, record ?? {});
  }

  const answers: PollAnswer[] = [];
  for (const question of config.questions) {
    const input = inputByQuestion.get(question.id) ?? {};
    if (question.type === "text") {
      const rawText = typeof input.text === "string" ? input.text.trim() : "";
      if (rawText.length > POLL_MAX_TEXT_ANSWER_LENGTH) {
        return { ok: false, code: "answer_too_long", questionId: question.id };
      }
      if (question.required && !rawText) {
        return { ok: false, code: "required_answer_missing", questionId: question.id };
      }
      if (rawText) answers.push({ questionId: question.id, optionIds: [], text: rawText });
      continue;
    }

    const rawOptionIds = Array.isArray(input.optionIds)
      ? input.optionIds.map((item) => trimText(item, 96)).filter(Boolean)
      : [];
    const uniqueOptionIds = [...new Set(rawOptionIds)];
    const allowedIds = new Set(question.options.map((option) => option.id));
    if (uniqueOptionIds.some((id) => !allowedIds.has(id))) {
      return { ok: false, code: "invalid_option", questionId: question.id };
    }
    const selected = question.type === "single" ? uniqueOptionIds.slice(0, 1) : uniqueOptionIds;
    if (question.required && selected.length === 0) {
      return { ok: false, code: "required_answer_missing", questionId: question.id };
    }
    if (selected.length > 0) answers.push({ questionId: question.id, optionIds: selected, text: "" });
  }
  return { ok: true, answers };
}

export function buildPollSnapshot(config: NormalizedPollConfig) {
  return {
    heading: config.heading,
    questions: config.questions,
  };
}

export function normalizeStoredPollBallot(value: unknown): PollStoredBallot | null {
  const record = readRecord(value);
  if (!record) return null;
  const id = trimText(record.id, 128);
  const participantType = record.participant_type === "member" || record.participantType === "member" ? "member" : "guest";
  const snapshotRecord = readRecord(record.poll_snapshot ?? record.pollSnapshot) ?? {};
  const answersSource = Array.isArray(record.answers) ? record.answers : [];
  const answers: PollAnswer[] = answersSource
    .map((answer) => {
      const answerRecord = readRecord(answer);
      const questionId = trimText(answerRecord?.questionId, 96);
      if (!questionId) return null;
      return {
        questionId,
        optionIds: Array.isArray(answerRecord?.optionIds)
          ? [...new Set(answerRecord.optionIds.map((item) => trimText(item, 96)).filter(Boolean))]
          : [],
        text: trimText(answerRecord?.text, POLL_MAX_TEXT_ANSWER_LENGTH),
      };
    })
    .filter((answer): answer is PollAnswer => Boolean(answer));
  return {
    id,
    participantType,
    participantName: trimText(record.participant_name ?? record.participantName, 120),
    anonymous: record.anonymous === true,
    answers,
    pollSnapshot: {
      heading: trimText(snapshotRecord.heading, 1000),
      questions: normalizePollQuestions(snapshotRecord.questions),
    },
    createdAt: trimText(record.created_at ?? record.createdAt, 64),
  };
}

export function buildPollSummary(
  ballots: PollStoredBallot[],
  currentQuestions: NormalizedPollQuestion[] = [],
  options: { includeTextResponses?: boolean } = {},
): PollSummary {
  const catalog = new Map<string, NormalizedPollQuestion & { active: boolean }>();
  for (const question of currentQuestions) catalog.set(question.id, { ...question, active: true });
  for (const ballot of ballots) {
    for (const question of ballot.pollSnapshot.questions) {
      const existing = catalog.get(question.id);
      if (!existing) {
        catalog.set(question.id, { ...question, active: false });
        continue;
      }
      const optionIds = new Set(existing.options.map((option) => option.id));
      for (const option of question.options) {
        if (!optionIds.has(option.id)) existing.options.push(option);
      }
    }
  }

  const questions: PollSummaryQuestion[] = [...catalog.values()].map((question) => ({
    id: question.id,
    prompt: question.prompt,
    type: question.type,
    required: question.required,
    active: question.active,
    responseCount: 0,
    skippedCount: ballots.length,
    options: question.options.map((option) => ({ ...option, count: 0 })),
    ...(question.type === "text" && options.includeTextResponses ? { textResponses: [] } : {}),
  }));
  const summaryById = new Map(questions.map((question) => [question.id, question]));

  for (const ballot of ballots) {
    for (const answer of ballot.answers) {
      const question = summaryById.get(answer.questionId);
      if (!question) continue;
      if (question.type === "text") {
        if (!answer.text) continue;
        question.responseCount += 1;
        question.skippedCount -= 1;
        question.textResponses?.push({
          ballotId: ballot.id,
          value: answer.text,
          participantName: ballot.anonymous ? "匿名" : ballot.participantName || "未填写",
          anonymous: ballot.anonymous,
          createdAt: ballot.createdAt,
        });
        continue;
      }
      if (answer.optionIds.length === 0) continue;
      question.responseCount += 1;
      question.skippedCount -= 1;
      const counts = new Map(question.options.map((option) => [option.id, option]));
      for (const optionId of answer.optionIds) {
        const option = counts.get(optionId);
        if (option) option.count += 1;
      }
    }
  }

  return {
    totalBallots: ballots.length,
    anonymousBallots: ballots.filter((ballot) => ballot.anonymous).length,
    questions,
  };
}

export function buildPollExportRows(ballots: PollStoredBallot[], summary: PollSummary) {
  return ballots.map((ballot) => {
    const answerByQuestion = new Map(ballot.answers.map((answer) => [answer.questionId, answer]));
    const snapshotQuestionById = new Map(ballot.pollSnapshot.questions.map((question) => [question.id, question]));
    const row: Record<string, string> = {
      "选票编号": ballot.id,
      "提交时间": ballot.createdAt,
      "身份": ballot.participantType === "member" ? "会员" : "游客",
      "投票人": ballot.anonymous ? "匿名" : ballot.participantName || "未填写",
      "匿名投票": ballot.anonymous ? "是" : "否",
    };
    summary.questions.forEach((question, index) => {
      const answer = answerByQuestion.get(question.id);
      const snapshotQuestion = snapshotQuestionById.get(question.id);
      const optionLabels = new Map((snapshotQuestion?.options ?? question.options).map((option) => [option.id, option.label]));
      row[`Q${index + 1} ${question.prompt}`] =
        question.type === "text"
          ? answer?.text ?? ""
          : (answer?.optionIds ?? []).map((id) => optionLabels.get(id) ?? id).join("；");
    });
    return row;
  });
}

export function createDefaultPollQuestions(): PollQuestion[] {
  const questionId = createPollEntityId("question");
  return [
    {
      id: questionId,
      prompt: "请选择您支持的选项",
      type: "single",
      required: true,
      options: [
        { id: createPollEntityId("option"), label: "选项一" },
        { id: createPollEntityId("option"), label: "选项二" },
      ],
    },
  ];
}
