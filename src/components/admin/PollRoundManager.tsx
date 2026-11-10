"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { PollProps } from "@/data/homeBlocks";
import { flushBufferedEditorTextCommits } from "@/lib/editorTextCommitBuffer";
import { showGlobalToast } from "@/lib/globalToast";
import { isMerchantNumericId } from "@/lib/merchantIdentity";
import { allocateMerchantPollId } from "@/lib/merchantPollClient";
import { createPollEntityId, getPollIdentityIds, normalizePollConfig, type PollRoundOverview, type PollStoredBallot } from "@/lib/merchantPolls";
import {
  readPollEditorRounds, recoverPollRoundFromBallots, selectPollEditorRound,
  setPollEditorRoundDeleted, startPollEditorRound,
} from "@/lib/merchantPollRounds";

type Props = {
  props: PollProps;
  runtimeSiteId: string;
  runtimeBlockId: string;
  onChange: (patch: Partial<PollProps>) => void;
  onFlushPendingChanges?: () => void;
};

function roundTitle(heading: string | undefined) {
  return (heading || "未命名投票").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

export default function PollRoundManager(input: Props) {
  const { props, runtimeSiteId, runtimeBlockId } = input;
  const latest = useRef(input);
  latest.current = input;
  const mounted = useRef(true);
  const operation = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [pastRounds, setPastRounds] = useState<PollRoundOverview[]>([]);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const rounds = useMemo(() => readPollEditorRounds(props, runtimeBlockId), [props, runtimeBlockId]);
  const available = rounds.filter((round) => !round.deleted);
  const removed = rounds.filter((round) => round.deleted);
  const knownIds = new Set(rounds.flatMap((round) => getPollIdentityIds(normalizePollConfig(round.settings))));
  const recoverable = pastRounds.filter((round) => !knownIds.has(round.pollId));

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      operation.current?.abort();
    };
  }, []);

  const readLatest = () => {
    // Commit IME/buffered fields before taking a snapshot or replacing a round.
    flushSync(() => {
      flushBufferedEditorTextCommits();
      latest.current.onFlushPendingChanges?.();
    });
    return latest.current;
  };

  const commitPatch = (current: Props, patch: Partial<PollProps>) => {
    flushSync(() => {
      current.onChange(patch);
      current.onFlushPendingChanges?.();
    });
  };

  const run = async (task: (signal: AbortSignal) => Promise<void>) => {
    if (operation.current) return;
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await task(controller.signal);
    } catch (failure) {
      if (mounted.current && !controller.signal.aborted) {
        setError(failure instanceof Error ? failure.message : "投票操作失败，请重试。");
      }
    } finally {
      if (operation.current === controller) operation.current = null;
      if (mounted.current) setBusy(false);
    }
  };

  const createRound = () => {
    if (operation.current) return;
    if (!window.confirm("新建一轮投票？当前轮次的题目和设置会保存到轮次列表，已有选票保持不变。保存并发布后，新轮次才会在前台生效。")) return;
    readLatest();
    void run(async (signal) => {
      const current = latest.current;
      const pollId = isMerchantNumericId(current.runtimeSiteId)
        ? await allocateMerchantPollId(current.runtimeSiteId)
        : createPollEntityId("poll");
      if (signal.aborted || !mounted.current) return;
      const fresh = readLatest();
      commitPatch(fresh, startPollEditorRound(fresh.props, fresh.runtimeBlockId, pollId));
      setNotice("已新建一轮，上一轮已保留。请保存并发布。");
    });
  };

  const selectRound = (pollId: string) => {
    if (!pollId || operation.current) return;
    const current = readLatest();
    const local = readPollEditorRounds(current.props, current.runtimeBlockId);
    if (local.some((round) => round.settings.pollId === pollId && !round.deleted)) {
      commitPatch(current, selectPollEditorRound(current.props, current.runtimeBlockId, pollId));
      setError("");
      setNotice("已切换编辑轮次；保存并发布后，前台才会切换。原轮次的修改已保留。");
      return;
    }
    if (!pastRounds.some((round) => round.pollId === pollId && round.blockId === runtimeBlockId)) return;
    void run(async (signal) => {
      const search = new URLSearchParams({ siteId: current.runtimeSiteId, pollId });
      const response = await fetch(`/api/polls?${search}`, { cache: "no-store", signal });
      const payload = await response.json();
      if (!response.ok || !payload?.ok || payload.pollId !== pollId || !Array.isArray(payload.ballots)) {
        throw new Error("旧轮次读取失败，请检查登录状态后重试。");
      }
      const recovered = recoverPollRoundFromBallots(pollId, payload.ballots as PollStoredBallot[]);
      if (signal.aborted || !mounted.current) return;
      const fresh = readLatest();
      const withRecovered: PollProps = {
        ...fresh.props,
        pollRoundHistory: [...(fresh.props.pollRoundHistory ?? []), recovered],
      };
      commitPatch(fresh, selectPollEditorRound(withRecovered, fresh.runtimeBlockId, pollId));
      setNotice("已从旧选票恢复题目和时间。旧记录不含全部设置，已默认结束投票；请核对设置后再发布。");
    });
  };

  const loadPastRounds = () => void run(async (signal) => {
    const search = new URLSearchParams({ siteId: runtimeSiteId });
    const response = await fetch(`/api/polls?${search}`, { cache: "no-store", signal });
    const payload = await response.json();
    if (!response.ok || !payload?.ok || !Array.isArray(payload.rounds)) {
      throw new Error("历史轮次读取失败，请检查登录状态后重试。");
    }
    if (signal.aborted || !mounted.current) return;
    const related = (payload.rounds as PollRoundOverview[]).filter((round) => round.blockId === runtimeBlockId);
    setPastRounds(related);
    setNotice(payload.truncated
      ? "历史选票过多，本次列表可能不完整；已保存的轮次不受影响。"
      : "已读取本投票区块的旧轮次。有选票快照的旧轮次可从列表选择恢复；旧版未保存且没有选票的轮次无法找回。");
  });

  const changeDeleted = (pollId: string, deleted: boolean) => {
    if (operation.current) return;
    const current = readLatest();
    const target = readPollEditorRounds(current.props, current.runtimeBlockId).find((round) => round.settings.pollId === pollId);
    if (!target) return;
    if (deleted && !window.confirm(`删除“${roundTitle(target.settings.heading)}”（${pollId}）？\n该轮将移入已删除列表，可恢复。选票与历史统计不会清空。保存并发布后，当前区块不再显示本轮，也不会自动开放其他轮次。其他设备或区块中的副本需同步修改。`)) return;
    commitPatch(current, setPollEditorRoundDeleted(current.props, current.runtimeBlockId, pollId, deleted));
    setNotice(deleted ? "已移入已删除列表，可恢复。请保存并发布使前台生效。" : "已恢复轮次；请核对开放状态，保存并发布后生效。");
    setError("");
    showGlobalToast(deleted ? "投票已移入已删除列表" : "投票轮次已恢复", { tone: "success" });
  };

  return (
    <section className="grid min-w-0 gap-3 rounded-xl border border-slate-200 bg-slate-50/90 p-3 sm:p-4" aria-label="投票轮次管理" aria-busy={busy}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-900">投票轮次</h3>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={busy} className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-700 disabled:opacity-50" onClick={createRound}>新建一轮</button>
          <button type="button" disabled={busy || props.pollRoundDeleted === true} className="h-9 rounded-lg border border-rose-200 bg-white px-3 text-sm text-rose-700 disabled:opacity-50" onClick={() => changeDeleted(rounds[0].settings.pollId, true)}>删除本轮</button>
        </div>
      </div>
      <label className="grid min-w-0 gap-1 text-sm text-slate-700">
        <span>选择编辑轮次（{available.length + recoverable.length}）</span>
        <select className="h-10 w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3" aria-label="选择投票轮次" disabled={busy} value={props.pollRoundDeleted === true ? "" : rounds[0].settings.pollId} onChange={(event) => selectRound(event.target.value)}>
          {props.pollRoundDeleted === true ? <option value="">本轮已删除，请选择其他轮次或恢复</option> : null}
          {available.map((round) => <option key={round.settings.pollId} value={round.settings.pollId}>{roundTitle(round.settings.heading)} · {round.settings.pollId}</option>)}
          {recoverable.length ? <optgroup label="旧版轮次（从选票恢复）">{recoverable.map((round) => <option key={round.pollId} value={round.pollId}>{roundTitle(round.heading)} · {round.pollId}</option>)}</optgroup> : null}
        </select>
      </label>
      <p className="text-xs leading-5 text-slate-500">切换仅更改当前区块草稿，保存并发布后才影响前台；PC／手机副本需同步修改。各轮选票独立统计，不会合并或清空。</p>
      {isMerchantNumericId(runtimeSiteId) ? <button type="button" disabled={busy} className="justify-self-start text-xs font-medium text-sky-700 underline underline-offset-4 disabled:opacity-50" onClick={loadPastRounds}>读取旧版历史轮次</button> : null}
      {removed.length ? (
        <details className="rounded-lg border border-slate-200 bg-white px-3 py-2">
          <summary className="cursor-pointer text-sm text-slate-600">已删除（{removed.length}），可恢复</summary>
          <ul className="mt-2 grid max-h-56 gap-2 overflow-auto">
            {removed.map((round) => <li key={round.settings.pollId} className="flex items-center justify-between gap-3 text-xs"><span className="min-w-0 break-words">{roundTitle(round.settings.heading)}<span className="mt-0.5 block break-all text-slate-400">{round.settings.pollId}</span></span><button type="button" className="h-8 shrink-0 rounded border border-slate-200 px-3 text-sky-700 disabled:opacity-50" disabled={busy} onClick={() => changeDeleted(round.settings.pollId, false)}>恢复</button></li>)}
          </ul>
        </details>
      ) : null}
      {busy ? <p role="status" className="text-xs text-slate-500">正在处理投票轮次…</p> : null}
      {notice ? <p role="status" className="text-xs leading-5 text-slate-600">{notice}</p> : null}
      {error ? <p role="alert" className="text-sm text-rose-700">{error}</p> : null}
    </section>
  );
}
