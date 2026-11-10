import assert from "node:assert/strict";
import test from "node:test";
import type { Block, PollProps } from "@/data/homeBlocks";
import { sanitizeBlocksForRuntime } from "@/lib/blocksSanitizer";
import { collectPublishedPollRounds, findPublishedPollConfig, getPollAvailability, normalizePollConfig, normalizeStoredPollBallot } from "@/lib/merchantPolls";
import { readPollEditorRounds, recoverPollRoundFromBallots, selectPollEditorRound, setPollEditorRoundDeleted, snapshotPollRound, startPollEditorRound } from "@/lib/merchantPollRounds";

const first: PollProps = {
  pollId: "TP1000000026110101", heading: "第一轮", text: "说明",
  pollLegacyIds: ["old-alias"], pollStatus: "closed", pollAudience: "registered-users",
  pollOpenAt: "2026-11-01T12:00:00Z", pollCloseAt: "2026-11-02T12:00:00Z",
  pollQuestions: [{ id: "q1", prompt: "", type: "single", required: true, options: [{ id: "a", label: "甲" }, { id: "b", label: "" }] }],
  pollAllowAnonymous: false, pollShowResultsAfterSubmit: true, pollSubmitLabel: "投票",
  pollSuccessTitle: "收到", pollSuccessText: "谢谢", pollNameLabel: "昵称",
  pollNamePlaceholder: "填写昵称", pollContentBackgroundOpacity: 0.05,
  bgColor: "#123456", blockOffsetX: 40,
};
const secondId = "TP1000000026110102";
const apply = (props: PollProps, patch: Partial<PollProps>): PollProps => ({ ...props, ...patch });

test("new rounds retain exact drafts, aliases and all poll settings without layout or nested history", () => {
  const original = structuredClone(first);
  const next = apply(first, startPollEditorRound(first, "block", secondId));
  assert.equal(next.pollId, secondId);
  assert.deepEqual(next.pollLegacyIds, []);
  assert.equal(next.pollStatus, "open");
  assert.equal(next.pollOpenAt, "");
  assert.equal(next.pollCloseAt, "");
  assert.equal(next.bgColor, first.bgColor);
  assert.equal(next.pollRoundHistory?.length, 1);
  assert.deepEqual(next.pollRoundHistory?.[0], snapshotPollRound(first, "block"));
  assert.equal("bgColor" in next.pollRoundHistory![0].settings, false);
  assert.equal("pollRoundHistory" in next.pollRoundHistory![0].settings, false);
  assert.equal(next.pollRoundHistory![0].settings.pollQuestions![0].prompt, "");
  next.pollRoundHistory![0].settings.pollQuestions![0].options![0].label = "changed";
  assert.deepEqual(first, original, "snapshot and source must not share mutable questions");
  assert.throws(() => startPollEditorRound(first, "block", "old-alias"));
});

test("switching away and back retains edits and clears settings absent from the selected round", () => {
  let props = apply(first, startPollEditorRound(first, "block", secondId));
  props = { ...props, heading: "第二轮", pollQuestions: [], pollSuccessText: undefined };
  props = apply(props, selectPollEditorRound(props, "block", first.pollId!));
  assert.deepEqual(snapshotPollRound(props, "block"), snapshotPollRound(first, "block"));
  props = apply(props, selectPollEditorRound(props, "block", secondId));
  assert.equal(props.heading, "第二轮");
  assert.deepEqual(props.pollQuestions, []);
  assert.equal(props.pollSuccessText, undefined);
  assert.equal(props.bgColor, "#123456");
  assert.equal(readPollEditorRounds(props, "block").length, 2);
});

test("zero-ballot round history survives JSON storage and normal runtime sanitization", () => {
  let props = first;
  for (let i = 2; i <= 30; i++) props = apply(props, startPollEditorRound(props, "block", `poll-${i}`));
  const input = JSON.parse(JSON.stringify([{ id: "block", type: "poll", props }])) as Block[];
  const saved = sanitizeBlocksForRuntime(input).blocks[0].props as PollProps;
  assert.equal(readPollEditorRounds(saved, "block").length, 30);
  const selected = apply(saved, selectPollEditorRound(saved, "block", first.pollId!));
  assert.equal(selected.heading, "第一轮");
  assert.equal(selected.pollAllowAnonymous, false);
  assert.deepEqual(selected.pollLegacyIds, ["old-alias"]);
  const serialized = JSON.stringify(saved);
  assert.equal((serialized.match(/pollRoundHistory/g) ?? []).length, 1, "history must grow linearly, not recursively");
});

test("deleting the selected round never opens another round and restoring preserves original settings", () => {
  let props = apply(first, startPollEditorRound(first, "block", secondId));
  props = apply(props, setPollEditorRoundDeleted(props, "block", secondId, true));
  assert.equal(props.pollId, secondId);
  assert.equal(props.pollRoundDeleted, true);
  assert.equal(getPollAvailability(normalizePollConfig(props)), "closed");
  const deletedBlock: Block = { id: "block", type: "poll", props };
  assert.deepEqual(collectPublishedPollRounds([deletedBlock]), []);
  assert.equal(findPublishedPollConfig([deletedBlock], secondId, "block"), null);
  assert.equal(findPublishedPollConfig([deletedBlock], first.pollId!, "block"), null, "archived round must not accept public votes");
  assert.throws(() => selectPollEditorRound(props, "block", secondId));
  props = apply(props, selectPollEditorRound(props, "block", first.pollId!));
  assert.equal(readPollEditorRounds(props, "block").find((round) => round.settings.pollId === secondId)?.deleted, true);
  props = apply(props, setPollEditorRoundDeleted(props, "block", secondId, false));
  assert.equal(props.pollId, first.pollId, "restoring a historical round must not switch the active round");
  props = apply(props, selectPollEditorRound(props, "block", secondId));
  assert.equal(props.pollRoundDeleted, false);
  assert.equal(props.pollStatus, "open");
});

test("single-round deletion persists and is reversible without needing a replacement round", () => {
  const deleted = apply(first, setPollEditorRoundDeleted(first, "block", first.pollId!, true));
  const saved = JSON.parse(JSON.stringify(deleted)) as PollProps;
  assert.equal(readPollEditorRounds(saved, "block").filter((round) => !round.deleted).length, 0);
  const restored = apply(saved, setPollEditorRoundDeleted(saved, "block", first.pollId!, false));
  assert.deepEqual(snapshotPollRound(restored, "block"), snapshotPollRound(first, "block"));
  const newRound = apply(saved, startPollEditorRound(saved, "block", secondId));
  assert.equal(newRound.pollRoundDeleted, false);
  assert.equal(newRound.pollRoundHistory?.[0].deleted, true);
});

test("malformed and aliased duplicate archives cannot replace the active definition", () => {
  const props = { ...first, pollRoundHistory: [
    null, {}, { settings: { pollId: "old-alias", heading: "wrong" } },
    { settings: { pollId: secondId, heading: "valid" } },
    { settings: { pollId: secondId, heading: "duplicate" } },
  ] } as unknown as PollProps;
  assert.deepEqual(readPollEditorRounds(props, "block").map((round) => round.settings.heading), ["第一轮", "valid"]);
});

test("legacy ballot recovery takes the latest snapshot and stays closed with settings explicitly cleared", () => {
  const old = normalizeStoredPollBallot({ id: "one", created_at: "2026-10-01T00:00:00Z", poll_snapshot: { heading: "旧题", questions: [{ id: "q", prompt: "旧题", type: "text" }] } })!;
  const recent = normalizeStoredPollBallot({ id: "two", created_at: "2026-10-02T00:00:00Z", poll_snapshot: { heading: "新题", questions: [{ id: "q", prompt: "新题", type: "text" }], audience: "registered-users" } })!;
  const recovered = recoverPollRoundFromBallots(secondId, [recent, old]);
  assert.equal(recovered.settings.heading, "新题");
  assert.equal(recovered.settings.pollStatus, "closed");
  assert.equal(recovered.settings.pollAudience, "registered-users");
  const selected = apply(first, selectPollEditorRound({ ...first, pollRoundHistory: [recovered] }, "block", secondId));
  assert.equal(selected.pollNameLabel, undefined, "do not carry a newer round's missing historical settings into the recovered round");
  assert.equal(selected.pollCloseAt, "");
  assert.throws(() => recoverPollRoundFromBallots(secondId, []));
});
