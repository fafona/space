import type { PollProps, PollRoundSettings, PollRoundSnapshot } from "@/data/homeBlocks";
import { getPollIdentityIds, normalizePollConfig, type PollStoredBallot } from "@/lib/merchantPolls";

// Deliberately exclude layout, nested history and unrelated block settings.
const ROUND_KEYS = [
  "heading", "text", "pollId", "pollLegacyIds", "pollStatus", "pollAudience",
  "pollOpenAt", "pollCloseAt", "pollQuestions", "pollAllowAnonymous",
  "pollShowResultsAfterSubmit", "pollSubmitLabel", "pollSuccessTitle", "pollSuccessText",
  "pollNameLabel", "pollNamePlaceholder", "pollContentBackgroundOpacity",
] as const satisfies readonly (keyof PollRoundSettings)[];

export function snapshotPollRound(props: PollProps, fallbackId: string): PollRoundSnapshot {
  const settings = Object.fromEntries(ROUND_KEYS.map((key) => [
    key,
    props[key] === undefined ? undefined : structuredClone(props[key]),
  ])) as PollRoundSnapshot["settings"];
  settings.pollId = normalizePollConfig(props, fallbackId).pollId;
  return { settings, deleted: props.pollRoundDeleted === true };
}

export function readPollEditorRounds(props: PollProps, fallbackId: string): PollRoundSnapshot[] {
  const current = snapshotPollRound(props, fallbackId);
  const rounds = [current];
  const usedIds = new Set(getPollIdentityIds(normalizePollConfig(current.settings)));
  for (const value of Array.isArray(props.pollRoundHistory) ? props.pollRoundHistory : []) {
    if (!value || typeof value !== "object" || !value.settings || typeof value.settings !== "object") continue;
    if (typeof value.settings.pollId !== "string" || !value.settings.pollId.trim()) continue;
    const round = snapshotPollRound({ ...value.settings, pollRoundDeleted: value.deleted === true }, "poll");
    const ids = getPollIdentityIds(normalizePollConfig(round.settings));
    if (ids.some((id) => usedIds.has(id))) continue;
    ids.forEach((id) => usedIds.add(id));
    rounds.push(round);
  }
  return rounds;
}

export function selectPollEditorRound(props: PollProps, fallbackId: string, pollId: string): Partial<PollProps> {
  const rounds = readPollEditorRounds(props, fallbackId);
  const selected = rounds.find((round) => round.settings.pollId === pollId && !round.deleted);
  if (!selected) throw new Error("未找到可用的投票轮次，请先恢复或刷新。");
  return {
    ...snapshotPollRound(selected.settings, pollId).settings,
    pollRoundDeleted: false,
    pollRoundHistory: rounds.filter((round) => round.settings.pollId !== pollId),
  };
}

export function startPollEditorRound(props: PollProps, fallbackId: string, pollId: string): Partial<PollProps> {
  const rounds = readPollEditorRounds(props, fallbackId);
  if (!pollId || rounds.some((round) => getPollIdentityIds(normalizePollConfig(round.settings)).includes(pollId))) {
    throw new Error("新投票编号重复，请重新新建。");
  }
  return {
    pollId, pollLegacyIds: [], pollStatus: "open", pollOpenAt: "", pollCloseAt: "",
    pollRoundDeleted: false,
    pollRoundHistory: rounds,
  };
}

export function setPollEditorRoundDeleted(
  props: PollProps, fallbackId: string, pollId: string, deleted: boolean,
): Partial<PollProps> {
  const rounds = readPollEditorRounds(props, fallbackId);
  if (!rounds.some((round) => round.settings.pollId === pollId)) throw new Error("未找到该投票轮次。");
  // Do not silently activate another round when deleting the selected one.
  return {
    pollRoundDeleted: rounds[0].settings.pollId === pollId ? deleted : rounds[0].deleted === true,
    pollRoundHistory: rounds.slice(1).map((round) => round.settings.pollId === pollId ? { ...round, deleted } : round),
  };
}

export function recoverPollRoundFromBallots(pollId: string, ballots: PollStoredBallot[]): PollRoundSnapshot {
  const latest = [...ballots].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  if (!latest || latest.pollSnapshot.questions.length === 0) throw new Error("这轮投票没有可恢复的题目快照。");
  const snapshot = latest.pollSnapshot;
  return snapshotPollRound({
    pollId, heading: snapshot.heading, pollQuestions: snapshot.questions,
    pollOpenAt: snapshot.openAt, pollCloseAt: snapshot.closeAt, pollAudience: snapshot.audience,
    // Old ballots do not contain all editor settings. Never reopen them implicitly.
    pollStatus: "closed",
  }, pollId);
}
