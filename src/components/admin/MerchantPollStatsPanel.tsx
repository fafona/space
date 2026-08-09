"use client";

import { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";

import {
  buildPollExportRows,
  getPollParticipantTypeLabel,
  getPollSubmissionSourceLabel,
  pollBallotMatchesSearch,
  type PollRoundOverview,
  type PollStoredBallot,
  type PollSummary,
  type PollSummaryQuestion,
} from "@/lib/merchantPolls";
import { showGlobalToast } from "@/lib/globalToast";

type MerchantPollStatsPanelProps = {
  siteId: string;
  siteName?: string;
  className?: string;
};

type PollRoundsPayload = {
  ok?: boolean;
  error?: string;
  message?: string;
  rounds?: PollRoundOverview[];
  totalRounds?: number;
  totalBallots?: number;
  truncated?: boolean;
};

type PollRoundDetailPayload = {
  ok?: boolean;
  error?: string;
  message?: string;
  pollId?: string;
  published?: boolean;
  summary?: PollSummary;
  ballots?: PollStoredBallot[];
  truncated?: boolean;
};

type PollDeletePayload = {
  ok?: boolean;
  error?: string;
  message?: string;
  deletedCount?: number;
};

type PollBallotMutationPayload = {
  ok?: boolean;
  error?: string;
  message?: string;
  pollId?: string;
  ballot?: PollStoredBallot;
};

type PollStatusFilter = "all" | PollRoundOverview["status"];

const QUESTION_TYPE_LABELS = {
  single: "单选",
  multiple: "多选",
  text: "文字输入",
} as const;

const STATUS_LABELS: Record<PollRoundOverview["status"], string> = {
  scheduled: "未开始",
  open: "开放",
  closed: "已结束",
  historical: "历史轮次",
};

function trimText(value: unknown, maxLength = 4096) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function formatDateTime(value: string | null | undefined) {
  const timestamp = Date.parse(String(value ?? ""));
  if (!Number.isFinite(timestamp)) return "-";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(timestamp));
}

function getBallotRenderKey(ballot: PollStoredBallot, index: number) {
  return ballot.id || ballot.ballotNo || `${ballot.createdAt}-${ballot.participantName}-${index}`;
}

function formatPollError(payload: PollRoundsPayload | PollRoundDetailPayload | PollDeletePayload | PollBallotMutationPayload | null) {
  const code = trimText(payload?.error, 100);
  const message = trimText(payload?.message, 300);
  if (code === "unauthorized") return "当前登录状态无法读取投票统计，请重新登录后重试。";
  if (code === "poll_store_unavailable") return "投票数据表暂时不可用，请检查数据库迁移和服务配置。";
  if (code === "poll_results_delete_failed") return "投票记录删除失败，请稍后重试。";
  if (code === "poll_ballot_not_found") return "没有找到这张选票，请刷新后重试。";
  if (code === "poll_ballot_update_failed") return "选票状态更新失败，请稍后重试。";
  return message || "投票统计加载失败，请稍后重试。";
}

function getStatusClassName(status: PollRoundOverview["status"]) {
  if (status === "open") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "scheduled") return "border-sky-200 bg-sky-50 text-sky-700";
  if (status === "closed") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-slate-200 bg-slate-50 text-slate-600";
}

function PollQuestionResult({ question, index }: { question: PollSummaryQuestion; index: number }) {
  return (
    <section className="border-t border-slate-200 pt-4 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="break-words text-sm font-semibold text-slate-900">
            {index + 1}. {question.prompt}
          </h3>
          <p className="mt-1 text-xs text-slate-500">
            {QUESTION_TYPE_LABELS[question.type]} · 回答 {question.responseCount} · 跳过 {question.skippedCount}
            {question.active ? "" : " · 历史题目"}
          </p>
        </div>
      </div>

      {question.type === "text" ? (
        <div className="mt-3 max-h-56 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50">
          {question.textResponses?.length ? (
            question.textResponses.map((response) => (
              <div key={`${response.ballotId}-${response.createdAt}`} className="border-b border-slate-200 px-3 py-2 last:border-b-0">
                <div className="whitespace-pre-wrap break-words text-sm text-slate-800">{response.value}</div>
                <div className="mt-1 text-xs text-slate-500">
                  {response.anonymous ? "匿名" : response.participantName || "未填写"} · {formatDateTime(response.createdAt)}
                </div>
              </div>
            ))
          ) : (
            <div className="px-3 py-5 text-center text-sm text-slate-500">暂无文字回答</div>
          )}
        </div>
      ) : (
        <div className="mt-3 grid gap-3">
          {question.options.map((option) => {
            const percentage = question.responseCount > 0
              ? Math.round((option.count / question.responseCount) * 100)
              : 0;
            return (
              <div key={option.id} className="grid gap-1.5">
                <div className="flex items-start justify-between gap-3 text-sm text-slate-700">
                  <span className="min-w-0 break-words">{option.label}</span>
                  <span className="shrink-0 tabular-nums">{option.count} 票 · {percentage}%</span>
                </div>
                <div className="h-2 overflow-hidden rounded bg-slate-100">
                  <div className="h-full rounded bg-blue-600" style={{ width: `${Math.min(100, percentage)}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function PollBallotDetail({
  ballot,
  index,
  summary,
  expanded,
  processing,
  onToggleExpanded,
  onToggleInvalidated,
}: {
  ballot: PollStoredBallot;
  index: number;
  summary: PollSummary;
  expanded: boolean;
  processing: boolean;
  onToggleExpanded: () => void;
  onToggleInvalidated: (ballot: PollStoredBallot) => void;
}) {
  const answerByQuestion = new Map(ballot.answers.map((answer) => [answer.questionId, answer]));
  const summaryByQuestion = new Map(summary.questions.map((question) => [question.id, question]));
  const questions = [...ballot.pollSnapshot.questions];
  for (const answer of ballot.answers) {
    if (questions.some((question) => question.id === answer.questionId)) continue;
    const fallback = summaryByQuestion.get(answer.questionId);
    if (fallback) questions.push(fallback);
  }
  const voterName = ballot.anonymous ? "匿名" : ballot.participantName || "未填写名称";
  const invalidated = Boolean(ballot.invalidatedAt);

  return (
    <article className={`overflow-hidden rounded-lg border bg-white ${invalidated ? "border-rose-200 opacity-80" : "border-slate-200"}`}>
      <div className={`flex flex-wrap items-center justify-between gap-2 px-3 py-2 ${invalidated ? "bg-rose-50" : "bg-slate-50"}`}>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <strong className="break-words text-sm text-slate-950">{index + 1}. {voterName}</strong>
            <span className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-xs text-slate-600">
              {getPollParticipantTypeLabel(ballot.participantType)}
            </span>
            {ballot.anonymous ? <span className="rounded border border-violet-200 bg-violet-50 px-1.5 py-0.5 text-xs text-violet-700">匿名</span> : null}
            {invalidated ? <span className="rounded border border-rose-200 bg-white px-1.5 py-0.5 text-xs font-semibold text-rose-700">已作废</span> : null}
          </div>
          <div className="mt-1 text-xs text-slate-500">投票时间：{formatDateTime(ballot.createdAt)}</div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            className={`h-8 rounded border px-3 text-xs font-semibold disabled:cursor-wait disabled:opacity-50 ${invalidated ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100" : "border-rose-200 bg-white text-rose-700 hover:bg-rose-50"}`}
            disabled={processing}
            onClick={() => onToggleInvalidated(ballot)}
          >
            {processing ? "处理中..." : invalidated ? "恢复" : "作废"}
          </button>
          <button type="button" className="h-8 rounded border border-slate-200 bg-white px-3 text-xs font-semibold text-blue-700 hover:bg-slate-50" onClick={onToggleExpanded}>
            {expanded ? "收起明细" : "展开明细"}
          </button>
        </div>
      </div>
      {expanded ? <div className="grid gap-3 border-t border-slate-200 px-3 py-3">
        <dl className="grid gap-x-5 gap-y-2 text-xs sm:grid-cols-2 xl:grid-cols-5">
          <div className="min-w-0"><dt className="text-slate-400">填写名称</dt><dd className="mt-0.5 break-words text-slate-800">{voterName}</dd></div>
          <div className="min-w-0"><dt className="text-slate-400">身份</dt><dd className="mt-0.5 text-slate-800">{getPollParticipantTypeLabel(ballot.participantType)}</dd></div>
          <div className="min-w-0"><dt className="text-slate-400">选票编号</dt><dd className="mt-0.5 break-all font-mono text-slate-800">{ballot.ballotNo || ballot.id || "-"}</dd></div>
          <div className="min-w-0"><dt className="text-slate-400">来源</dt><dd className="mt-0.5 text-slate-800">{getPollSubmissionSourceLabel(ballot.source)}</dd></div>
          <div className="min-w-0"><dt className="text-slate-400">选票状态</dt><dd className={`mt-0.5 font-semibold ${invalidated ? "text-rose-700" : "text-emerald-700"}`}>{invalidated ? "已作废" : "有效"}</dd></div>
          {invalidated ? <div className="min-w-0"><dt className="text-slate-400">作废时间</dt><dd className="mt-0.5 text-slate-800">{formatDateTime(ballot.invalidatedAt)}</dd></div> : null}
          {invalidated ? <div className="min-w-0"><dt className="text-slate-400">操作人</dt><dd className="mt-0.5 break-all text-slate-800">{ballot.invalidatedBy || "-"}</dd></div> : null}
        </dl>
        <div className="grid gap-2 xl:grid-cols-2">
          {questions.length ? questions.map((question, questionIndex) => {
            const answer = answerByQuestion.get(question.id);
            const optionLabels = new Map(question.options.map((option) => [option.id, option.label]));
            const answerText = question.type === "text"
              ? answer?.text || "未填写"
              : answer?.optionIds.length
                ? answer.optionIds.map((optionId) => optionLabels.get(optionId) || optionId).join("；")
                : "未选择";
            return (
              <div key={question.id} className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                <div className="flex flex-wrap items-start gap-2 text-xs text-slate-500">
                  <span>{questionIndex + 1}. {QUESTION_TYPE_LABELS[question.type]}</span>
                  <span>{question.required ? "必选" : "可选"}</span>
                </div>
                <div className="mt-1 break-words text-sm font-medium text-slate-800">{question.prompt}</div>
                <div className="mt-1 whitespace-pre-wrap break-words text-sm text-blue-800">{answerText}</div>
              </div>
            );
          }) : <div className="rounded-lg bg-slate-50 px-3 py-4 text-center text-sm text-slate-500">本张选票没有可显示的题目快照。</div>}
        </div>
      </div> : null}
    </article>
  );
}

export default function MerchantPollStatsPanel({ siteId, siteName, className = "" }: MerchantPollStatsPanelProps) {
  const [rounds, setRounds] = useState<PollRoundOverview[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [truncated, setTruncated] = useState(false);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<PollStatusFilter>("all");
  const [selectedRound, setSelectedRound] = useState<PollRoundOverview | null>(null);
  const [selectedBallotRound, setSelectedBallotRound] = useState<PollRoundOverview | null>(null);
  const [ballotQuery, setBallotQuery] = useState("");
  const [expandedBallotIds, setExpandedBallotIds] = useState<Set<string>>(() => new Set());
  const [details, setDetails] = useState<Record<string, PollRoundDetailPayload>>({});
  const [detailLoadingPollId, setDetailLoadingPollId] = useState("");
  const [detailError, setDetailError] = useState("");
  const [exportingPollId, setExportingPollId] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<PollRoundOverview | null>(null);
  const [deletingPollId, setDeletingPollId] = useState("");
  const [mutatingBallotId, setMutatingBallotId] = useState("");
  const deferredQuery = useDeferredValue(query.trim().toLocaleLowerCase("zh-CN"));
  const deferredBallotQuery = useDeferredValue(ballotQuery);

  const loadRounds = useCallback(async () => {
    if (!siteId) {
      setRounds([]);
      setError("当前商户尚未准备好，暂时无法读取投票统计。");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const search = new URLSearchParams({ siteId });
      const response = await fetch(`/api/polls?${search.toString()}`, { cache: "no-store" });
      const payload = (await response.json().catch(() => null)) as PollRoundsPayload | null;
      if (!response.ok || !payload?.ok) throw new Error(formatPollError(payload));
      setRounds(Array.isArray(payload.rounds) ? payload.rounds : []);
      setTruncated(payload.truncated === true);
    } catch (loadError) {
      setRounds([]);
      setTruncated(false);
      setError(loadError instanceof Error ? loadError.message : "投票统计加载失败，请稍后重试。");
    } finally {
      setLoading(false);
    }
  }, [siteId]);

  useEffect(() => {
    void loadRounds();
  }, [loadRounds]);

  useEffect(() => {
    setDetails({});
    setSelectedRound(null);
    setSelectedBallotRound(null);
    setBallotQuery("");
    setExpandedBallotIds(new Set());
    setDetailError("");
  }, [siteId]);

  const requestRoundDetail = useCallback(async (pollId: string) => {
    const search = new URLSearchParams({ siteId, pollId });
    const response = await fetch(`/api/polls?${search.toString()}`, { cache: "no-store" });
    const payload = (await response.json().catch(() => null)) as PollRoundDetailPayload | null;
    if (!response.ok || !payload?.ok || !payload.summary || !Array.isArray(payload.ballots)) {
      throw new Error(formatPollError(payload));
    }
    setDetails((current) => ({ ...current, [pollId]: payload }));
    return payload;
  }, [siteId]);

  const openRoundDetail = async (round: PollRoundOverview) => {
    setSelectedRound(round);
    setDetailError("");
    if (details[round.pollId]) return;
    setDetailLoadingPollId(round.pollId);
    try {
      await requestRoundDetail(round.pollId);
    } catch (loadError) {
      setDetailError(loadError instanceof Error ? loadError.message : "投票详情加载失败，请稍后重试。");
    } finally {
      setDetailLoadingPollId("");
    }
  };

  const openBallotDetail = async (round: PollRoundOverview) => {
    setSelectedBallotRound(round);
    setBallotQuery("");
    setDetailError("");
    const cached = details[round.pollId];
    if (cached?.ballots) {
      setExpandedBallotIds(new Set());
      return;
    }
    setDetailLoadingPollId(round.pollId);
    try {
      await requestRoundDetail(round.pollId);
      setExpandedBallotIds(new Set());
    } catch (loadError) {
      setDetailError(loadError instanceof Error ? loadError.message : "投票明细加载失败，请稍后重试。");
    } finally {
      setDetailLoadingPollId("");
    }
  };

  const toggleBallotInvalidated = async (round: PollRoundOverview, ballot: PollStoredBallot) => {
    if (!ballot.id || mutatingBallotId) return;
    const invalidated = Boolean(ballot.invalidatedAt);
    if (!invalidated && typeof window !== "undefined" && !window.confirm("确定作废这张选票吗？作废后不计入统计，之后仍可恢复。")) return;
    setMutatingBallotId(ballot.id);
    try {
      const response = await fetch("/api/polls", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          siteId,
          pollId: round.pollId,
          ballotId: ballot.id,
          invalidated: !invalidated,
        }),
      });
      const payload = (await response.json().catch(() => null)) as PollBallotMutationPayload | null;
      if (!response.ok || !payload?.ok) throw new Error(formatPollError(payload));
      const detail = await requestRoundDetail(round.pollId);
      const summary = detail.summary;
      const updateRoundSummary = (current: PollRoundOverview | null) => current && current.pollId === round.pollId && summary
        ? {
            ...current,
            totalBallots: summary.totalBallots,
            invalidatedBallots: summary.invalidatedBallots,
            anonymousBallots: summary.anonymousBallots,
          }
        : current;
      setSelectedRound(updateRoundSummary);
      setSelectedBallotRound(updateRoundSummary);
      showGlobalToast(invalidated ? "选票已恢复并重新计入统计" : "选票已作废，不再计入统计", { tone: "success" });
      await loadRounds();
    } catch (mutationError) {
      showGlobalToast(mutationError instanceof Error ? mutationError.message : "选票状态更新失败，请稍后重试。", { tone: "error" });
    } finally {
      setMutatingBallotId("");
    }
  };

  const exportRound = async (round: PollRoundOverview) => {
    if (exportingPollId) return;
    setExportingPollId(round.pollId);
    try {
      const payload = details[round.pollId] ?? await requestRoundDetail(round.pollId);
      if (!payload.summary || !Array.isArray(payload.ballots)) throw new Error("投票结果数据不完整，暂时无法导出。");
      const XLSX = await import("xlsx");
      const workbook = XLSX.utils.book_new();
      const ballotRows = buildPollExportRows(payload.ballots, payload.summary);
      XLSX.utils.book_append_sheet(
        workbook,
        ballotRows.length ? XLSX.utils.json_to_sheet(ballotRows) : XLSX.utils.aoa_to_sheet([["暂无投票明细"]]),
        "逐票明细",
      );
      const safeName = round.heading.replace(/[\\/:*?"<>|]/g, "-").slice(0, 48) || "投票";
      XLSX.writeFile(workbook, `${safeName}-逐票明细-${round.pollId}.xlsx`);
      showGlobalToast("逐票明细已导出", { tone: "success" });
    } catch (exportError) {
      showGlobalToast(exportError instanceof Error ? exportError.message : "投票结果导出失败", { tone: "error" });
    } finally {
      setExportingPollId("");
    }
  };

  const deleteRoundResults = async () => {
    if (!deleteTarget || deletingPollId) return;
    const pollId = deleteTarget.pollId;
    setDeletingPollId(pollId);
    try {
      const response = await fetch("/api/polls", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ siteId, pollId }),
      });
      const payload = (await response.json().catch(() => null)) as PollDeletePayload | null;
      if (!response.ok || !payload?.ok) throw new Error(formatPollError(payload));
      setDetails((current) => {
        const next = { ...current };
        delete next[pollId];
        return next;
      });
      if (selectedRound?.pollId === pollId) setSelectedRound(null);
      if (selectedBallotRound?.pollId === pollId) setSelectedBallotRound(null);
      setDeleteTarget(null);
      showGlobalToast(`已删除 ${payload.deletedCount ?? 0} 条投票记录`, { tone: "success" });
      await loadRounds();
    } catch (deleteError) {
      showGlobalToast(deleteError instanceof Error ? deleteError.message : "投票记录删除失败", { tone: "error" });
    } finally {
      setDeletingPollId("");
    }
  };

  const filteredRounds = useMemo(() => rounds.filter((round) => {
    if (status !== "all" && round.status !== status) return false;
    if (!deferredQuery) return true;
    return `${round.heading} ${round.pollId}`.toLocaleLowerCase("zh-CN").includes(deferredQuery);
  }), [deferredQuery, rounds, status]);

  const totals = useMemo(() => ({
    rounds: rounds.length,
    published: rounds.filter((round) => round.published).length,
    ballots: rounds.reduce((total, round) => total + round.totalBallots, 0),
    invalidated: rounds.reduce((total, round) => total + round.invalidatedBallots, 0),
    anonymous: rounds.reduce((total, round) => total + round.anonymousBallots, 0),
  }), [rounds]);

  const selectedDetail = selectedRound ? details[selectedRound.pollId] : null;
  const selectedBallotDetail = selectedBallotRound ? details[selectedBallotRound.pollId] : null;
  const filteredBallotItems = useMemo(() => {
    if (!selectedBallotDetail?.summary || !selectedBallotDetail.ballots) return [];
    return selectedBallotDetail.ballots
      .map((ballot, index) => ({ ballot, index, key: getBallotRenderKey(ballot, index) }))
      .filter(({ ballot }) => pollBallotMatchesSearch(ballot, selectedBallotDetail.summary!, deferredBallotQuery));
  }, [deferredBallotQuery, selectedBallotDetail]);

  return (
    <section className={`py-6 ${className}`.trim()}>
      <header className="flex flex-wrap items-start justify-between gap-4 rounded-lg border border-slate-200 bg-white px-5 py-5 shadow-sm">
        <div>
          <h1 className="text-[26px] font-extrabold leading-8 text-slate-950">投票统计</h1>
          <p className="mt-1 text-sm text-slate-500">
            按投票轮次留存统计、文字回答和投票明细，并支持导出 Excel。
            {siteName ? ` 当前商户：${siteName}` : ""}
          </p>
        </div>
        <button
          type="button"
          className="h-10 rounded border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          onClick={() => void loadRounds()}
          disabled={loading}
        >
          {loading ? "刷新中..." : "刷新"}
        </button>
      </header>

      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        {[
          ["投票轮次", totals.rounds],
          ["当前发布", totals.published],
          ["累计票数", totals.ballots],
          ["作废票数", totals.invalidated],
          ["匿名票数", totals.anonymous],
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
            <div className="text-xs font-medium text-slate-500">{label}</div>
            <div className="mt-1 text-2xl font-bold tabular-nums text-slate-950">{value}</div>
          </div>
        ))}
      </div>

      <div className="mt-4 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="grid gap-3 border-b border-slate-200 p-4 lg:grid-cols-[minmax(260px,1fr)_220px]">
          <label className="grid gap-1 text-xs font-medium text-slate-500">
            搜索
            <input
              className="h-10 rounded border border-slate-200 px-3 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="投票名称 / 投票编号"
            />
          </label>
          <label className="grid gap-1 text-xs font-medium text-slate-500">
            状态
            <select
              className="h-10 rounded border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-blue-500"
              value={status}
              onChange={(event) => setStatus(event.target.value as PollStatusFilter)}
            >
              <option value="all">全部状态</option>
              <option value="scheduled">未开始</option>
              <option value="open">开放</option>
              <option value="closed">已结束</option>
              <option value="historical">历史轮次</option>
            </select>
          </label>
        </div>

        {truncated ? (
          <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800">
            投票明细已达到单次读取上限，页面统计可能仅包含最近的数据；单轮导出也会标记读取上限。
          </div>
        ) : null}
        {error ? (
          <div role="alert" className="border-b border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        ) : null}

        <div className="hidden overflow-x-auto md:block">
          <table className="min-w-full table-fixed text-left text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500">
              <tr>
                <th className="w-[30%] px-4 py-3 font-semibold">投票</th>
                <th className="w-[11%] px-4 py-3 font-semibold">状态</th>
                <th className="w-[9%] px-4 py-3 text-right font-semibold">票数</th>
                <th className="w-[9%] px-4 py-3 text-right font-semibold">匿名</th>
                <th className="w-[17%] px-4 py-3 font-semibold">最后提交</th>
                <th className="w-[24%] px-4 py-3 text-right font-semibold">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredRounds.map((round) => (
                <tr key={round.pollId} className="align-top hover:bg-slate-50/70">
                  <td className="px-4 py-3">
                    <div className="break-words font-semibold text-slate-950">{round.heading || "未命名投票"}</div>
                    <div className="mt-1 truncate font-mono text-xs text-slate-500" title={round.pollId}>{round.pollId}</div>
                    <div className="mt-1 text-xs text-slate-400">{round.questionCount} 个问题</div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex rounded border px-2 py-1 text-xs font-semibold ${getStatusClassName(round.status)}`}>
                      {STATUS_LABELS[round.status]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-semibold tabular-nums text-slate-900">
                    <div>{round.totalBallots}</div>
                    {round.invalidatedBallots ? <div className="mt-0.5 text-xs font-normal text-rose-600">作废 {round.invalidatedBallots}</div> : null}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-600">{round.anonymousBallots}</td>
                  <td className="px-4 py-3 text-slate-600">{formatDateTime(round.lastSubmittedAt)}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap justify-end gap-2">
                      <button type="button" className="h-8 rounded border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50" onClick={() => void openRoundDetail(round)}>
                        查看
                      </button>
                      <button type="button" className="h-8 rounded border border-violet-200 bg-violet-50 px-3 text-xs font-semibold text-violet-700 hover:bg-violet-100" onClick={() => void openBallotDetail(round)}>
                        逐票明细
                      </button>
                      <button type="button" className="h-8 rounded border border-blue-200 bg-blue-50 px-3 text-xs font-semibold text-blue-700 hover:bg-blue-100 disabled:opacity-50" disabled={Boolean(exportingPollId)} onClick={() => void exportRound(round)}>
                        {exportingPollId === round.pollId ? "导出中" : "导出"}
                      </button>
                      <button type="button" className="h-8 rounded border border-rose-200 bg-white px-3 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50" disabled={round.totalBallots + round.invalidatedBallots === 0 || Boolean(deletingPollId)} onClick={() => setDeleteTarget(round)}>
                        删除
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="divide-y divide-slate-100 md:hidden">
          {filteredRounds.map((round) => (
            <article key={round.pollId} className="px-4 py-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="break-words font-semibold text-slate-950">{round.heading || "未命名投票"}</h2>
                  <div className="mt-1 truncate font-mono text-xs text-slate-500">{round.pollId}</div>
                </div>
                <span className={`shrink-0 rounded border px-2 py-1 text-xs font-semibold ${getStatusClassName(round.status)}`}>
                  {STATUS_LABELS[round.status]}
                </span>
              </div>
              <div className="mt-3 grid grid-cols-4 gap-2 text-xs text-slate-500">
                <div><span className="block text-slate-400">票数</span><strong className="text-sm text-slate-900">{round.totalBallots}</strong></div>
                <div><span className="block text-slate-400">作废</span><strong className="text-sm text-rose-700">{round.invalidatedBallots}</strong></div>
                <div><span className="block text-slate-400">匿名</span><strong className="text-sm text-slate-900">{round.anonymousBallots}</strong></div>
                <div><span className="block text-slate-400">问题</span><strong className="text-sm text-slate-900">{round.questionCount}</strong></div>
              </div>
              <div className="mt-3 text-xs text-slate-500">最后提交：{formatDateTime(round.lastSubmittedAt)}</div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button type="button" className="h-9 rounded border border-slate-200 bg-white text-sm font-semibold text-slate-700" onClick={() => void openRoundDetail(round)}>查看</button>
                <button type="button" className="h-9 rounded border border-violet-200 bg-violet-50 text-sm font-semibold text-violet-700" onClick={() => void openBallotDetail(round)}>逐票明细</button>
                <button type="button" className="h-9 rounded border border-blue-200 bg-blue-50 text-sm font-semibold text-blue-700 disabled:opacity-50" disabled={Boolean(exportingPollId)} onClick={() => void exportRound(round)}>{exportingPollId === round.pollId ? "导出中..." : "导出明细"}</button>
                <button type="button" className="h-9 rounded border border-rose-200 bg-white text-sm font-semibold text-rose-700 disabled:opacity-50" disabled={round.totalBallots + round.invalidatedBallots === 0 || Boolean(deletingPollId)} onClick={() => setDeleteTarget(round)}>删除</button>
              </div>
            </article>
          ))}
        </div>

        {!loading && filteredRounds.length === 0 ? (
          <div className="px-4 py-16 text-center text-sm text-slate-500">
            {rounds.length ? "没有符合筛选条件的投票轮次。" : "暂无投票统计。发布投票并收到投票后，结果会保留在这里。"}
          </div>
        ) : null}
        {loading && rounds.length === 0 ? <div className="px-4 py-16 text-center text-sm text-slate-500">正在加载投票统计...</div> : null}
      </div>

      {selectedRound ? (
        <div className="fixed inset-0 z-[21000] flex items-center justify-center bg-slate-950/55 p-3 sm:p-6" role="dialog" aria-modal="true" aria-label={`${selectedRound.heading} 投票结果`}>
          <div className="flex max-h-[calc(100dvh-1.5rem)] w-full max-w-4xl flex-col overflow-hidden rounded-lg bg-white shadow-2xl sm:max-h-[calc(100dvh-3rem)]">
            <header className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-200 px-4 py-4 sm:px-5">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="break-words text-xl font-bold text-slate-950">{selectedRound.heading}</h2>
                  <span className={`rounded border px-2 py-1 text-xs font-semibold ${getStatusClassName(selectedRound.status)}`}>
                    {STATUS_LABELS[selectedRound.status]}
                  </span>
                </div>
                <div className="mt-1 break-all font-mono text-xs text-slate-500">{selectedRound.pollId}</div>
                {(selectedRound.openAt || selectedRound.closeAt) ? (
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                    <span>开放：{selectedRound.openAt ? formatDateTime(selectedRound.openAt) : "立即开放"}</span>
                    <span>结束：{selectedRound.closeAt ? formatDateTime(selectedRound.closeAt) : "不设结束时间"}</span>
                  </div>
                ) : null}
              </div>
              <button type="button" aria-label="关闭投票结果" title="关闭" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-slate-200 text-xl text-slate-600 hover:bg-slate-50" onClick={() => setSelectedRound(null)}>×</button>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
              {detailLoadingPollId === selectedRound.pollId ? <div className="py-16 text-center text-sm text-slate-500">正在加载本轮统计...</div> : null}
              {detailError ? <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-3 text-sm text-rose-700">{detailError}</div> : null}
              {selectedDetail?.summary ? (
                <div className="grid gap-5">
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                    {[
                      ["有效票数", selectedDetail.summary.totalBallots],
                      ["作废票数", selectedDetail.summary.invalidatedBallots],
                      ["匿名票数", selectedDetail.summary.anonymousBallots],
                      ["问题数", selectedDetail.summary.questions.length],
                      ["非匿名", selectedDetail.summary.totalBallots - selectedDetail.summary.anonymousBallots],
                    ].map(([label, value]) => (
                      <div key={label} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
                        <div className="text-xs text-slate-500">{label}</div>
                        <div className="mt-1 text-xl font-bold tabular-nums text-slate-950">{value}</div>
                      </div>
                    ))}
                  </div>
                  {selectedDetail.truncated ? <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">本轮数据已达到单次读取上限，当前统计和导出只包含已读取的明细。</div> : null}
                  <div className="grid gap-4">
                    {selectedDetail.summary.questions.length ? selectedDetail.summary.questions.map((question, index) => (
                      <PollQuestionResult key={question.id} question={question} index={index} />
                    )) : <div className="py-10 text-center text-sm text-slate-500">本轮暂无题目或投票数据。</div>}
                  </div>
                </div>
              ) : null}
            </div>

            <footer className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-slate-200 px-4 py-3 sm:px-5">
              <button type="button" className="h-10 rounded border border-rose-200 bg-white px-4 text-sm font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50" disabled={selectedRound.totalBallots + selectedRound.invalidatedBallots === 0 || Boolean(deletingPollId)} onClick={() => setDeleteTarget(selectedRound)}>删除记录</button>
              <button type="button" className="h-10 rounded border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50" onClick={() => setSelectedRound(null)}>关闭</button>
            </footer>
          </div>
        </div>
      ) : null}

      {selectedBallotRound ? (
        <div className="fixed inset-0 z-[21500] flex items-center justify-center bg-slate-950/55 p-2 sm:p-4" role="dialog" aria-modal="true" aria-label={`${selectedBallotRound.heading} 逐票明细`}>
          <div className="flex max-h-[96dvh] w-[min(96vw,1440px)] flex-col overflow-hidden rounded-lg bg-white shadow-2xl">
            <header className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-200 px-4 py-3 sm:px-5">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="break-words text-xl font-bold text-slate-950">{selectedBallotRound.heading} · 逐票明细</h2>
                  <span className={`rounded border px-2 py-1 text-xs font-semibold ${getStatusClassName(selectedBallotRound.status)}`}>
                    {STATUS_LABELS[selectedBallotRound.status]}
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-500">每张选票的填写人、身份、来源、时间、状态与完整作答内容。</p>
              </div>
              <button
                type="button"
                aria-label="关闭逐票明细"
                title="关闭"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-slate-200 text-xl text-slate-600 hover:bg-slate-50"
                onClick={() => {
                  setSelectedBallotRound(null);
                  setBallotQuery("");
                  setExpandedBallotIds(new Set());
                }}
              >×</button>
            </header>

            <div className="grid shrink-0 gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3 lg:grid-cols-[minmax(280px,1fr)_auto] lg:items-end sm:px-5">
              <label className="grid gap-1 text-xs font-medium text-slate-500">
                搜索逐票明细
                <input
                  type="search"
                  className="h-10 rounded border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                  value={ballotQuery}
                  onChange={(event) => setBallotQuery(event.target.value)}
                  placeholder="搜索姓名、身份、来源、选票编号、题目或作答内容"
                />
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <span className="mr-1 text-xs tabular-nums text-slate-500">
                  {ballotQuery.trim() ? `找到 ${filteredBallotItems.length} / ` : "共 "}{selectedBallotDetail?.ballots?.length ?? 0} 张
                </span>
                <button
                  type="button"
                  className="h-9 rounded border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                  disabled={filteredBallotItems.length === 0}
                  onClick={() => setExpandedBallotIds(new Set(filteredBallotItems.map((item) => item.key)))}
                >全部展开</button>
                <button
                  type="button"
                  className="h-9 rounded border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                  disabled={expandedBallotIds.size === 0}
                  onClick={() => setExpandedBallotIds(new Set())}
                >全部收起</button>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 sm:px-5">
              {detailLoadingPollId === selectedBallotRound.pollId ? <div className="py-16 text-center text-sm text-slate-500">正在加载逐票明细...</div> : null}
              {detailError ? <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-3 text-sm text-rose-700">{detailError}</div> : null}
              {selectedBallotDetail?.truncated ? <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">本轮数据已达到单次读取上限，当前页面和导出只包含已读取的逐票明细。</div> : null}
              {selectedBallotDetail?.summary ? (
                <div className="grid gap-2">
                  {filteredBallotItems.map(({ ballot, index, key }) => (
                    <PollBallotDetail
                      key={key}
                      ballot={ballot}
                      index={index}
                      summary={selectedBallotDetail.summary!}
                      expanded={expandedBallotIds.has(key)}
                      processing={mutatingBallotId === ballot.id}
                      onToggleExpanded={() => setExpandedBallotIds((current) => {
                        const next = new Set(current);
                        if (next.has(key)) next.delete(key);
                        else next.add(key);
                        return next;
                      })}
                      onToggleInvalidated={(target) => void toggleBallotInvalidated(selectedBallotRound, target)}
                    />
                  ))}
                  {filteredBallotItems.length === 0 ? (
                    <div className="rounded-lg bg-slate-50 px-3 py-12 text-center text-sm text-slate-500">
                      {selectedBallotDetail.ballots?.length ? "没有找到包含该内容的选票。" : "本轮暂无投票明细。"}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>

            <footer className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-slate-200 px-4 py-3 sm:px-5">
              <span className="text-xs text-slate-500">Excel 仅导出逐票明细，每张选票占一行。</span>
              <div className="flex gap-2">
                <button type="button" className="h-10 rounded border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50" onClick={() => {
                  setSelectedBallotRound(null);
                  setBallotQuery("");
                  setExpandedBallotIds(new Set());
                }}>关闭</button>
                <button type="button" className="h-10 rounded bg-slate-950 px-4 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50" disabled={Boolean(exportingPollId) || !selectedBallotDetail?.summary} onClick={() => void exportRound(selectedBallotRound)}>{exportingPollId === selectedBallotRound.pollId ? "导出中..." : "导出逐票明细"}</button>
              </div>
            </footer>
          </div>
        </div>
      ) : null}

      {deleteTarget ? (
        <div className="fixed inset-0 z-[22000] flex items-center justify-center bg-slate-950/60 p-4" role="dialog" aria-modal="true" aria-label="确认删除投票记录">
          <div className="w-full max-w-md overflow-hidden rounded-lg bg-white shadow-2xl">
            <header className="border-b border-slate-200 px-5 py-4">
              <h2 className="text-lg font-bold text-slate-950">确认删除投票记录</h2>
              <p className="mt-1 break-words text-sm text-slate-500">{deleteTarget.heading}</p>
            </header>
            <div className="grid gap-3 px-5 py-5 text-sm text-slate-700">
              <p>将永久删除本轮的 <strong className="text-rose-700">{deleteTarget.totalBallots + deleteTarget.invalidatedBallots} 条</strong>投票记录（含 {deleteTarget.invalidatedBallots} 条作废票）、选择内容和填写内容，删除后无法恢复。</p>
              {deleteTarget.published ? (
                <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800">该投票仍发布在网页中。删除结果不会删除投票区块，访客仍可继续投票并产生新的统计。</p>
              ) : null}
              <div className="break-all rounded-lg bg-slate-50 px-3 py-2 font-mono text-xs text-slate-500">{deleteTarget.pollId}</div>
            </div>
            <footer className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
              <button type="button" className="h-10 rounded border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 disabled:opacity-50" disabled={Boolean(deletingPollId)} onClick={() => setDeleteTarget(null)}>返回</button>
              <button type="button" className="h-10 rounded bg-rose-700 px-4 text-sm font-semibold text-white hover:bg-rose-800 disabled:opacity-50" disabled={Boolean(deletingPollId)} onClick={() => void deleteRoundResults()}>{deletingPollId ? "删除中..." : "确认删除"}</button>
            </footer>
          </div>
        </div>
      ) : null}
    </section>
  );
}
