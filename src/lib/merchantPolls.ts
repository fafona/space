import type { Block, PollAudience, PollOption, PollProps, PollQuestion, PollQuestionType } from "@/data/homeBlocks";

export const POLL_MAX_QUESTIONS = 30;
export const POLL_MAX_OPTIONS = 36;
export const POLL_MAX_TEXT_ANSWER_LENGTH = 4000;

export type PollSubmissionSource = "pc_web" | "mobile_web" | "contact_card";

export type NormalizedPollQuestion = {
  id: string;
  prompt: string;
  type: PollQuestionType;
  required: boolean;
  options: PollOption[];
};

export type NormalizedPollConfig = {
  pollId: string;
  legacyPollIds: string[];
  heading: string;
  text: string;
  status: "open" | "closed";
  audience: PollAudience;
  openAt: string;
  closeAt: string;
  questions: NormalizedPollQuestion[];
  allowAnonymous: boolean;
  showResultsAfterSubmit: boolean;
  submitLabel: string;
  successTitle: string;
  successText: string;
  nameLabel: string;
  namePlaceholder: string;
  contentBackgroundOpacity: number;
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
  ballotNo: string;
  participantType: "member" | "registered" | "guest";
  participantName: string;
  anonymous: boolean;
  answers: PollAnswer[];
  pollSnapshot: {
    heading: string;
    questions: NormalizedPollQuestion[];
    openAt?: string;
    closeAt?: string;
    audience?: PollAudience;
  };
  source: PollSubmissionSource | "";
  invalidatedAt: string;
  invalidatedBy: string;
  createdAt: string;
};

export type PollRoundBallotMetadata = {
  pollId: string;
  blockId: string;
  anonymous: boolean;
  invalidated: boolean;
  pollSnapshot: PollStoredBallot["pollSnapshot"];
  createdAt: string;
};

export type PublishedPollRound = {
  blockId: string;
  config: NormalizedPollConfig;
};

export type PollRoundOverview = {
  pollId: string;
  blockId: string;
  heading: string;
  status: "scheduled" | "open" | "closed" | "historical";
  published: boolean;
  openAt: string;
  closeAt: string;
  totalBallots: number;
  invalidatedBallots: number;
  anonymousBallots: number;
  questionCount: number;
  firstSubmittedAt: string;
  lastSubmittedAt: string;
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
  invalidatedBallots: number;
  anonymousBallots: number;
  questions: PollSummaryQuestion[];
};

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function trimText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function normalizeOpacity(value: unknown, fallback: number) {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : Number.NaN;
  return Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed)) : fallback;
}

function normalizeDateTime(value: unknown) {
  const raw = trimText(value, 64);
  if (!raw) return "";
  const timestamp = Date.parse(raw);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : "";
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
  const pollId = normalizeEntityId(record.pollId, normalizeEntityId(fallbackPollId, "poll"));
  const legacyPollIds = Array.isArray(record.pollLegacyIds)
    ? [...new Set(record.pollLegacyIds.map((item) => normalizeEntityId(item, "")).filter((item) => item && item !== pollId))]
    : [];
  return {
    pollId,
    legacyPollIds,
    heading: trimText(record.heading, 1000) || "在线投票",
    text: trimText(record.text, 4000),
    status: record.pollStatus === "closed" ? "closed" : "open",
    audience:
      record.pollAudience === "merchant-members" || record.pollAudience === "registered-users"
        ? record.pollAudience
        : "everyone",
    openAt: normalizeDateTime(record.pollOpenAt),
    closeAt: normalizeDateTime(record.pollCloseAt),
    questions: normalizePollQuestions(record.pollQuestions),
    allowAnonymous: record.pollAllowAnonymous !== false,
    showResultsAfterSubmit: record.pollShowResultsAfterSubmit === true,
    submitLabel: trimText(record.pollSubmitLabel, 80) || "提交投票",
    successTitle: trimText(record.pollSuccessTitle, 160) || "投票已提交",
    successText: trimText(record.pollSuccessText, 600) || "感谢您的参与。",
    nameLabel: trimText(record.pollNameLabel, 120) || "您的名称",
    namePlaceholder: trimText(record.pollNamePlaceholder, 120) || "请输入您的名称",
    contentBackgroundOpacity: normalizeOpacity(record.pollContentBackgroundOpacity, 0.72),
  } satisfies NormalizedPollConfig;
}

export function getPollConfigurationIssue(config: NormalizedPollConfig) {
  if (!config.pollId) return "missing_poll_id";
  if (config.openAt && config.closeAt && Date.parse(config.openAt) >= Date.parse(config.closeAt)) {
    return "invalid_schedule";
  }
  if (config.questions.length === 0) return "missing_questions";
  for (const question of config.questions) {
    if (question.type !== "text" && question.options.length < 2) {
      return `question_requires_options:${question.id}`;
    }
  }
  return "";
}

export type PollAvailability = "scheduled" | "open" | "closed";

export function getPollAvailability(config: NormalizedPollConfig, now = Date.now()): PollAvailability {
  if (config.status === "closed") return "closed";
  const openAt = config.openAt ? Date.parse(config.openAt) : Number.NaN;
  const closeAt = config.closeAt ? Date.parse(config.closeAt) : Number.NaN;
  if (Number.isFinite(openAt) && now < openAt) return "scheduled";
  if (Number.isFinite(closeAt) && now >= closeAt) return "closed";
  return "open";
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

export function getPollIdentityIds(config: Pick<NormalizedPollConfig, "pollId" | "legacyPollIds">) {
  return [...new Set([config.pollId, ...config.legacyPollIds].map((item) => normalizeEntityId(item, "")).filter(Boolean))];
}

function getPollDefinitionFingerprint(config: NormalizedPollConfig) {
  return JSON.stringify({
    heading: config.heading,
    text: config.text,
    status: config.status,
    audience: config.audience,
    openAt: config.openAt,
    closeAt: config.closeAt,
    questions: config.questions.map((question) => ({
      prompt: question.prompt,
      type: question.type,
      required: question.required,
      options: question.options.map((option) => option.label),
    })),
    allowAnonymous: config.allowAnonymous,
    showResultsAfterSubmit: config.showResultsAfterSubmit,
    submitLabel: config.submitLabel,
    successTitle: config.successTitle,
    successText: config.successText,
    nameLabel: config.nameLabel,
    namePlaceholder: config.namePlaceholder,
  });
}

type PollQuestionLike = Pick<NormalizedPollQuestion, "id" | "prompt" | "type"> & {
  options: Array<{ id: string; label: string }>;
};

function getOccurrenceKey<T>(items: T[], index: number, getBaseKey: (item: T) => string) {
  const baseKey = getBaseKey(items[index]);
  let occurrence = 0;
  for (let itemIndex = 0; itemIndex <= index; itemIndex += 1) {
    if (getBaseKey(items[itemIndex]) === baseKey) occurrence += 1;
  }
  return `${baseKey}\u0000${occurrence}`;
}

function getPollQuestionSemanticKey(question: PollQuestionLike, index: number, questions: PollQuestionLike[]) {
  return getOccurrenceKey(questions, index, (item) => `${item.type}\u0000${item.prompt}`);
}

function getPollOptionSemanticKey(
  option: { id: string; label: string },
  index: number,
  options: Array<{ id: string; label: string }>,
) {
  return getOccurrenceKey(options, index, (item) => item.label);
}

function mergePublishedPollRounds(rounds: PublishedPollRound[]) {
  const preferred = rounds.find((round) => /^TP\d{16}$/.test(round.config.pollId)) ?? rounds[0];
  if (!preferred) return null;
  const identityIds = [...new Set(rounds.flatMap((round) => getPollIdentityIds(round.config)))];
  return {
    blockId: preferred.blockId,
    config: {
      ...preferred.config,
      legacyPollIds: identityIds.filter((pollId) => pollId !== preferred.config.pollId),
    },
  } satisfies PublishedPollRound;
}

export function collectPublishedPollRounds(blocks: Block[]) {
  const uniqueByPollId = new Map<string, PublishedPollRound>();
  for (const block of collectPublishedPollBlocks(blocks)) {
    const config = normalizePollConfig(block.props, block.id);
    const existing = uniqueByPollId.get(config.pollId);
    if (!existing) {
      uniqueByPollId.set(config.pollId, { blockId: block.id, config });
      continue;
    }
    existing.config.legacyPollIds = [
      ...new Set([...existing.config.legacyPollIds, ...config.legacyPollIds].filter((pollId) => pollId !== config.pollId)),
    ];
  }

  const groups = [...uniqueByPollId.values()].map((round) => [round]);
  let changed = true;
  while (changed) {
    changed = false;
    outer: for (let leftIndex = 0; leftIndex < groups.length; leftIndex += 1) {
      const leftIds = new Set(groups[leftIndex].flatMap((round) => getPollIdentityIds(round.config)));
      for (let rightIndex = leftIndex + 1; rightIndex < groups.length; rightIndex += 1) {
        if (!groups[rightIndex].some((round) => getPollIdentityIds(round.config).some((pollId) => leftIds.has(pollId)))) continue;
        groups[leftIndex] = [...groups[leftIndex], ...groups[rightIndex]];
        groups.splice(rightIndex, 1);
        changed = true;
        break outer;
      }
    }
  }

  // Older PC/mobile copies retained separate random IDs. Merge only an exact pair
  // of identical legacy definitions; TP rounds and explicit aliases stay authoritative.
  const legacyBuckets = new Map<string, number[]>();
  groups.forEach((group, index) => {
    const merged = mergePublishedPollRounds(group);
    if (!merged || /^TP\d{16}$/.test(merged.config.pollId) || merged.config.legacyPollIds.length > 0) return;
    const fingerprint = getPollDefinitionFingerprint(merged.config);
    legacyBuckets.set(fingerprint, [...(legacyBuckets.get(fingerprint) ?? []), index]);
  });
  for (const indices of legacyBuckets.values()) {
    if (indices.length !== 2) continue;
    const [firstIndex, secondIndex] = indices;
    if (firstIndex === undefined || secondIndex === undefined || !groups[firstIndex] || !groups[secondIndex]) continue;
    groups[firstIndex] = [...groups[firstIndex], ...groups[secondIndex]];
    groups[secondIndex] = [];
  }

  return groups
    .filter((group) => group.length > 0)
    .map(mergePublishedPollRounds)
    .filter((round): round is PublishedPollRound => Boolean(round));
}

export function findPublishedPollConfig(blocks: Block[], pollId: string, preferredBlockId = "") {
  const normalizedPollId = normalizeEntityId(pollId, "");
  if (!normalizedPollId) return null;
  const matched = collectPublishedPollRounds(blocks)
    .find((entry) => getPollIdentityIds(entry.config).includes(normalizedPollId));
  if (!matched || !preferredBlockId) return matched ?? null;

  const preferredBlock = collectPublishedPollBlocks(blocks).find((block) => block.id === preferredBlockId);
  if (!preferredBlock) return matched;
  const preferredConfig = normalizePollConfig(preferredBlock.props, preferredBlock.id);
  const matchedIdentityIds = new Set(getPollIdentityIds(matched.config));
  if (!getPollIdentityIds(preferredConfig).some((identityId) => matchedIdentityIds.has(identityId))) return matched;

  const identityIds = [...new Set([...matchedIdentityIds, ...getPollIdentityIds(preferredConfig)])];
  return {
    blockId: preferredBlock.id,
    config: {
      ...preferredConfig,
      pollId: matched.config.pollId,
      legacyPollIds: identityIds.filter((identityId) => identityId !== matched.config.pollId),
    },
  } satisfies PublishedPollRound;
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
    openAt: config.openAt,
    closeAt: config.closeAt,
    audience: config.audience,
  };
}

export function getPollAudienceAccessError(
  audience: PollAudience,
  access: { registered: boolean; merchantMember: boolean },
) {
  if (audience === "registered-users" && !access.registered) return "registered_user_required";
  if (audience === "merchant-members" && !access.merchantMember) return "merchant_membership_required";
  return "";
}

export function hasActivePollMerchantMembership(
  siteId: string,
  memberships: Array<{
    siteId: string;
    status: string;
    accountId: string;
    userId: string;
    email: string;
  }>,
  identity: { accountId: string; userId: string; email: string },
) {
  const normalizedSiteId = trimText(siteId, 64);
  const normalizedEmail = trimText(identity.email, 320).toLowerCase();
  if (!normalizedSiteId || (!identity.accountId && !identity.userId && !normalizedEmail)) return false;
  return memberships.some((membership) => {
    if (membership.siteId !== normalizedSiteId || membership.status !== "active") return false;
    if (identity.accountId && membership.accountId === identity.accountId) return true;
    if (identity.userId && membership.userId === identity.userId) return true;
    return Boolean(normalizedEmail && membership.email.toLowerCase() === normalizedEmail);
  });
}

export function getPollParticipantTypeLabel(participantType: PollStoredBallot["participantType"]) {
  if (participantType === "member") return "会员";
  if (participantType === "registered") return "注册用户";
  return "游客";
}

export function getPollSubmissionSourceLabel(source: PollStoredBallot["source"]) {
  if (source === "pc_web") return "PC网页";
  if (source === "mobile_web") return "手机网页";
  if (source === "contact_card") return "联系卡";
  return "历史记录（未记录来源）";
}

export function normalizeStoredPollBallot(value: unknown): PollStoredBallot | null {
  const record = readRecord(value);
  if (!record) return null;
  const id = trimText(record.id, 128);
  const rawParticipantType = record.participant_type ?? record.participantType;
  const participantType = rawParticipantType === "member"
    ? "member"
    : rawParticipantType === "registered"
      ? "registered"
      : "guest";
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
    ballotNo: trimText(record.ballot_no ?? record.ballotNo, 64),
    participantType,
    participantName: trimText(record.participant_name ?? record.participantName, 120),
    anonymous: record.anonymous === true,
    answers,
    pollSnapshot: {
      heading: trimText(snapshotRecord.heading, 1000),
      questions: normalizePollQuestions(snapshotRecord.questions),
      openAt: normalizeDateTime(snapshotRecord.openAt),
      closeAt: normalizeDateTime(snapshotRecord.closeAt),
      audience:
        snapshotRecord.audience === "merchant-members" || snapshotRecord.audience === "registered-users"
          ? snapshotRecord.audience
          : "everyone",
    },
    source:
      record.source === "pc_web" || record.source === "mobile_web" || record.source === "contact_card"
        ? record.source
        : "",
    invalidatedAt: trimText(record.invalidated_at ?? record.invalidatedAt, 64),
    invalidatedBy: trimText(record.invalidated_by ?? record.invalidatedBy, 320),
    createdAt: trimText(record.created_at ?? record.createdAt, 64),
  };
}

export function normalizePollRoundBallotMetadata(value: unknown): PollRoundBallotMetadata | null {
  const record = readRecord(value);
  if (!record) return null;
  const pollId = normalizeEntityId(record.poll_id ?? record.pollId, "");
  if (!pollId) return null;
  const snapshotRecord = readRecord(record.poll_snapshot ?? record.pollSnapshot) ?? {};
  return {
    pollId,
    blockId: trimText(record.block_id ?? record.blockId, 160),
    anonymous: record.anonymous === true,
    invalidated: Boolean(trimText(record.invalidated_at ?? record.invalidatedAt, 64)),
    pollSnapshot: {
      heading: trimText(snapshotRecord.heading, 1000),
      questions: normalizePollQuestions(snapshotRecord.questions),
      openAt: normalizeDateTime(snapshotRecord.openAt),
      closeAt: normalizeDateTime(snapshotRecord.closeAt),
      audience:
        snapshotRecord.audience === "merchant-members" || snapshotRecord.audience === "registered-users"
          ? snapshotRecord.audience
          : "everyone",
    },
    createdAt: trimText(record.created_at ?? record.createdAt, 64),
  };
}

export function buildPollRoundOverviews(
  metadata: PollRoundBallotMetadata[],
  publishedRounds: PublishedPollRound[] = [],
) {
  const rounds = new Map<string, PollRoundOverview>();
  const canonicalPollIds = new Map<string, string>();
  for (const publishedRound of publishedRounds) {
    for (const identityId of getPollIdentityIds(publishedRound.config)) {
      canonicalPollIds.set(identityId, publishedRound.config.pollId);
    }
  }
  for (const ballot of metadata) {
    const canonicalPollId = canonicalPollIds.get(ballot.pollId) ?? ballot.pollId;
    const existing = rounds.get(canonicalPollId);
    const createdAt = ballot.createdAt;
    if (!existing) {
      rounds.set(canonicalPollId, {
        pollId: canonicalPollId,
        blockId: ballot.blockId,
        heading: ballot.pollSnapshot.heading || "未命名投票",
        status: "historical",
        published: false,
        openAt: ballot.pollSnapshot.openAt ?? "",
        closeAt: ballot.pollSnapshot.closeAt ?? "",
        totalBallots: ballot.invalidated ? 0 : 1,
        invalidatedBallots: ballot.invalidated ? 1 : 0,
        anonymousBallots: !ballot.invalidated && ballot.anonymous ? 1 : 0,
        questionCount: ballot.pollSnapshot.questions.length,
        firstSubmittedAt: createdAt,
        lastSubmittedAt: createdAt,
      });
      continue;
    }
    if (ballot.invalidated) {
      existing.invalidatedBallots += 1;
    } else {
      existing.totalBallots += 1;
      if (ballot.anonymous) existing.anonymousBallots += 1;
      if (!existing.firstSubmittedAt || (createdAt && createdAt < existing.firstSubmittedAt)) {
        existing.firstSubmittedAt = createdAt;
      }
      if (!existing.lastSubmittedAt || (createdAt && createdAt > existing.lastSubmittedAt)) {
        existing.lastSubmittedAt = createdAt;
        existing.blockId = ballot.blockId || existing.blockId;
        existing.heading = ballot.pollSnapshot.heading || existing.heading;
        existing.questionCount = ballot.pollSnapshot.questions.length || existing.questionCount;
      }
    }
  }

  for (const publishedRound of publishedRounds) {
    const pollId = publishedRound.config.pollId;
    const existing = rounds.get(pollId);
    if (existing) {
      existing.blockId = publishedRound.blockId || existing.blockId;
      existing.heading = publishedRound.config.heading || existing.heading;
      existing.status = getPollAvailability(publishedRound.config);
      existing.published = true;
      existing.openAt = publishedRound.config.openAt;
      existing.closeAt = publishedRound.config.closeAt;
      existing.questionCount = publishedRound.config.questions.length;
      continue;
    }
    rounds.set(pollId, {
      pollId,
      blockId: publishedRound.blockId,
      heading: publishedRound.config.heading || "未命名投票",
      status: getPollAvailability(publishedRound.config),
      published: true,
      openAt: publishedRound.config.openAt,
      closeAt: publishedRound.config.closeAt,
      totalBallots: 0,
      invalidatedBallots: 0,
      anonymousBallots: 0,
      questionCount: publishedRound.config.questions.length,
      firstSubmittedAt: "",
      lastSubmittedAt: "",
    });
  }

  return [...rounds.values()].sort((left, right) => {
    if (left.published !== right.published) return left.published ? -1 : 1;
    return right.lastSubmittedAt.localeCompare(left.lastSubmittedAt) || left.heading.localeCompare(right.heading, "zh-CN");
  });
}

export function buildPollSummary(
  ballots: PollStoredBallot[],
  currentQuestions: NormalizedPollQuestion[] = [],
  options: { includeTextResponses?: boolean } = {},
): PollSummary {
  const activeBallots = ballots.filter((ballot) => !ballot.invalidatedAt);
  type CatalogEntry = {
    question: NormalizedPollQuestion & { active: boolean };
    semanticKey: string;
  };
  type BallotQuestionMapping = {
    summaryQuestionId: string;
    optionIdMap: Map<string, string>;
  };

  const catalog: CatalogEntry[] = [];
  const catalogById = new Map<string, CatalogEntry>();
  const catalogBySemanticKey = new Map<string, CatalogEntry>();
  const mappingsByBallot = new Map<PollStoredBallot, Map<string, BallotQuestionMapping>>();
  const addCatalogQuestion = (question: NormalizedPollQuestion, active: boolean, semanticKey: string) => {
    const entry: CatalogEntry = {
      question: { ...question, options: question.options.map((option) => ({ ...option })), active },
      semanticKey,
    };
    catalog.push(entry);
    catalogById.set(question.id, entry);
    if (!catalogBySemanticKey.has(semanticKey)) catalogBySemanticKey.set(semanticKey, entry);
    return entry;
  };

  currentQuestions.forEach((question, index) => {
    addCatalogQuestion(question, true, getPollQuestionSemanticKey(question, index, currentQuestions));
  });
  for (const ballot of ballots) {
    const ballotMapping = new Map<string, BallotQuestionMapping>();
    const snapshotQuestions = ballot.pollSnapshot.questions;
    snapshotQuestions.forEach((question, questionIndex) => {
      const semanticKey = getPollQuestionSemanticKey(question, questionIndex, snapshotQuestions);
      const entry = catalogById.get(question.id)
        ?? catalogBySemanticKey.get(semanticKey)
        ?? addCatalogQuestion(question, false, semanticKey);
      const optionIdMap = new Map<string, string>();
      const targetOptionById = new Map(entry.question.options.map((option) => [option.id, option]));
      const targetOptionBySemanticKey = new Map(
        entry.question.options.map((option, optionIndex) => [
          getPollOptionSemanticKey(option, optionIndex, entry.question.options),
          option,
        ]),
      );
      question.options.forEach((option, optionIndex) => {
        const optionSemanticKey = getPollOptionSemanticKey(option, optionIndex, question.options);
        let targetOption = targetOptionById.get(option.id) ?? targetOptionBySemanticKey.get(optionSemanticKey);
        if (!targetOption) {
          targetOption = { ...option };
          entry.question.options.push(targetOption);
          targetOptionById.set(targetOption.id, targetOption);
          targetOptionBySemanticKey.set(optionSemanticKey, targetOption);
        }
        optionIdMap.set(option.id, targetOption.id);
      });
      ballotMapping.set(question.id, { summaryQuestionId: entry.question.id, optionIdMap });
    });
    mappingsByBallot.set(ballot, ballotMapping);
  }

  const questions: PollSummaryQuestion[] = catalog.map(({ question }) => ({
    id: question.id,
    prompt: question.prompt,
    type: question.type,
    required: question.required,
    active: question.active,
    responseCount: 0,
    skippedCount: activeBallots.length,
    options: question.options.map((option) => ({ ...option, count: 0 })),
    ...(question.type === "text" && options.includeTextResponses ? { textResponses: [] } : {}),
  }));
  const summaryById = new Map(questions.map((question) => [question.id, question]));

  for (const ballot of activeBallots) {
    const ballotMapping = mappingsByBallot.get(ballot);
    for (const answer of ballot.answers) {
      const mapping = ballotMapping?.get(answer.questionId);
      const question = summaryById.get(mapping?.summaryQuestionId ?? answer.questionId);
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
        const option = counts.get(mapping?.optionIdMap.get(optionId) ?? optionId);
        if (option) option.count += 1;
      }
    }
  }

  return {
    totalBallots: activeBallots.length,
    invalidatedBallots: ballots.length - activeBallots.length,
    anonymousBallots: activeBallots.filter((ballot) => ballot.anonymous).length,
    questions,
  };
}

export function buildPollExportRows(ballots: PollStoredBallot[], summary: PollSummary) {
  return ballots.map((ballot) => {
    const answerByQuestion = new Map(ballot.answers.map((answer) => [answer.questionId, answer]));
    const snapshotQuestionById = new Map(ballot.pollSnapshot.questions.map((question) => [question.id, question]));
    const row: Record<string, string> = {
      "选票编号": ballot.ballotNo || ballot.id,
      "提交时间": ballot.createdAt,
      "身份": getPollParticipantTypeLabel(ballot.participantType),
      "投票人": ballot.anonymous ? "匿名" : ballot.participantName || "未填写",
      "匿名投票": ballot.anonymous ? "是" : "否",
      "来源": getPollSubmissionSourceLabel(ballot.source),
      "选票状态": ballot.invalidatedAt ? "已作废" : "有效",
      "作废时间": ballot.invalidatedAt,
      "操作人": ballot.invalidatedBy,
      "开放时间（提交时）": ballot.pollSnapshot.openAt ?? "",
      "结束时间（提交时）": ballot.pollSnapshot.closeAt ?? "",
    };
    summary.questions.forEach((question, index) => {
      const semanticKey = getPollQuestionSemanticKey(question, index, summary.questions);
      const snapshotQuestion = snapshotQuestionById.get(question.id)
        ?? ballot.pollSnapshot.questions.find((candidate, candidateIndex, questions) => (
          getPollQuestionSemanticKey(candidate, candidateIndex, questions) === semanticKey
        ));
      const answer = answerByQuestion.get(snapshotQuestion?.id ?? question.id);
      const optionLabels = new Map((snapshotQuestion?.options ?? question.options).map((option) => [option.id, option.label]));
      row[`Q${index + 1} ${question.prompt}`] =
        question.type === "text"
          ? answer?.text ?? ""
          : (answer?.optionIds ?? []).map((id) => optionLabels.get(id) ?? id).join("；");
    });
    return row;
  });
}

function normalizePollSearchText(value: unknown) {
  return String(value ?? "").normalize("NFKC").toLocaleLowerCase("zh-CN");
}

export function pollBallotMatchesSearch(ballot: PollStoredBallot, summary: PollSummary, query: string) {
  const normalizedQuery = normalizePollSearchText(query).trim();
  if (!normalizedQuery) return true;

  const exportRow = buildPollExportRows([ballot], summary)[0] ?? {};
  const searchableValues = [
    ballot.id,
    ballot.ballotNo,
    ballot.participantName,
    getPollParticipantTypeLabel(ballot.participantType),
    ballot.anonymous ? "匿名" : "非匿名",
    getPollSubmissionSourceLabel(ballot.source),
    ballot.invalidatedAt ? "已作废" : "有效",
    ballot.createdAt,
    ballot.invalidatedAt,
    ballot.invalidatedBy,
    ballot.pollSnapshot.heading,
    ballot.pollSnapshot.openAt,
    ballot.pollSnapshot.closeAt,
    ...ballot.pollSnapshot.questions.flatMap((question) => [
      question.id,
      question.prompt,
      ...question.options.flatMap((option) => [option.id, option.label]),
    ]),
    ...ballot.answers.flatMap((answer) => [answer.questionId, answer.text, ...answer.optionIds]),
    ...Object.entries(exportRow).flatMap(([key, value]) => [key, value]),
  ];

  return normalizePollSearchText(searchableValues.join("\n")).includes(normalizedQuery);
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
