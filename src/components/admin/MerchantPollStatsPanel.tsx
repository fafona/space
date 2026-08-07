"use client";

import { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";

import {
  buildPollExportRows,
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

type PollStatusFilter = "all" | PollRoundOverview["status"];

const QUESTION_TYPE_LABELS = {
  single: "单选",
  multiple: "多选",
  text: "文字输入",
} as const;

const STATUS_LABELS: Record<PollRoundOverview["status"], string> = {
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

function formatPollError(payload: PollRoundsPayload | PollRoundDetailPayload | null) {
  const code = trimText(payload?.error, 100);
  const message = trimText(payload?.message, 300);
  if (code === "unauthorized") return "当前登录状态无法读取投票统计，请重新登录后重试。";
  if (code === "poll_store_unavailable") return "投票数据表暂时不可用，请检查数据库迁移和服务配置。";
  return message || "投票统计加载失败，请稍后重试。";
}

function getStatusClassName(status: PollRoundOverview["status"]) {
  if (status === "open") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "closed") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-slate-200 bg-slate-50 text-slate-600";
}

function buildSummaryRows(summary: PollSummary) {
  return summary.questions.flatMap((question, questionIndex) => {
    if (question.type === "text") {
      return [{
        "题号": questionIndex + 1,
        "问题": question.prompt,
        "类型": QUESTION_TYPE_LABELS[question.type],
        "选项": "",
        "票数/回答数": question.responseCount,
        "跳过数": question.skippedCount,
        "当前题目": question.active ? "是" : "否",
      }];
    }
    return question.options.map((option) => ({
      "题号": questionIndex + 1,
      "问题": question.prompt,
      "类型": QUESTION_TYPE_LABELS[question.type],
      "选项": option.label,
      "票数/回答数": option.count,
      "跳过数": question.skippedCount,
      "当前题目": question.active ? "是" : "否",
    }));
  });
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

export default function MerchantPollStatsPanel({ siteId, siteName, className = "" }: MerchantPollStatsPanelProps) {
  const [rounds, setRounds] = useState<PollRoundOverview[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [truncated, setTruncated] = useState(false);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<PollStatusFilter>("all");
  const [selectedRound, setSelectedRound] = useState<PollRoundOverview | null>(null);
  const [details, setDetails] = useState<Record<string, PollRoundDetailPayload>>({});
  const [detailLoadingPollId, setDetailLoadingPollId] = useState("");
  const [detailError, setDetailError] = useState("");
  const [exportingPollId, setExportingPollId] = useState("");
  const deferredQuery = useDeferredValue(query.trim().toLocaleLowerCase("zh-CN"));

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

  const exportRound = async (round: PollRoundOverview) => {
    if (exportingPollId) return;
    setExportingPollId(round.pollId);
    try {
      const payload = details[round.pollId] ?? await requestRoundDetail(round.pollId);
      if (!payload.summary || !Array.isArray(payload.ballots)) throw new Error("投票结果数据不完整，暂时无法导出。");
      const XLSX = await import("xlsx");
      const workbook = XLSX.utils.book_new();
      const overviewSheet = XLSX.utils.json_to_sheet([{
        "投票名称": round.heading,
        "投票编号": round.pollId,
        "状态": STATUS_LABELS[round.status],
        "总票数": payload.summary.totalBallots,
        "匿名票数": payload.summary.anonymousBallots,
        "首次提交": round.firstSubmittedAt,
        "最后提交": round.lastSubmittedAt,
      }]);
      const summaryRows = buildSummaryRows(payload.summary);
      const ballotRows = buildPollExportRows(payload.ballots, payload.summary);
      XLSX.utils.book_append_sheet(workbook, overviewSheet, "轮次信息");
      XLSX.utils.book_append_sheet(
        workbook,
        summaryRows.length ? XLSX.utils.json_to_sheet(summaryRows) : XLSX.utils.aoa_to_sheet([["暂无统计结果"]]),
        "结果统计",
      );
      XLSX.utils.book_append_sheet(
        workbook,
        ballotRows.length ? XLSX.utils.json_to_sheet(ballotRows) : XLSX.utils.aoa_to_sheet([["暂无投票明细"]]),
        "投票明细",
      );
      const safeName = round.heading.replace(/[\\/:*?"<>|]/g, "-").slice(0, 48) || "投票结果";
      XLSX.writeFile(workbook, `${safeName}-${round.pollId}.xlsx`);
      showGlobalToast("投票结果已导出", { tone: "success" });
    } catch (exportError) {
      showGlobalToast(exportError instanceof Error ? exportError.message : "投票结果导出失败", { tone: "error" });
    } finally {
      setExportingPollId("");
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
    anonymous: rounds.reduce((total, round) => total + round.anonymousBallots, 0),
  }), [rounds]);

  const selectedDetail = selectedRound ? details[selectedRound.pollId] : null;

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

      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          ["投票轮次", totals.rounds],
          ["当前发布", totals.published],
          ["累计票数", totals.ballots],
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
                <th className="w-[34%] px-4 py-3 font-semibold">投票</th>
                <th className="w-[13%] px-4 py-3 font-semibold">状态</th>
                <th className="w-[12%] px-4 py-3 text-right font-semibold">票数</th>
                <th className="w-[12%] px-4 py-3 text-right font-semibold">匿名</th>
                <th className="w-[18%] px-4 py-3 font-semibold">最后提交</th>
                <th className="w-[11%] px-4 py-3 text-right font-semibold">操作</th>
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
                  <td className="px-4 py-3 text-right font-semibold tabular-nums text-slate-900">{round.totalBallots}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-600">{round.anonymousBallots}</td>
                  <td className="px-4 py-3 text-slate-600">{formatDateTime(round.lastSubmittedAt)}</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      <button type="button" className="h-8 rounded border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50" onClick={() => void openRoundDetail(round)}>
                        查看
                      </button>
                      <button type="button" className="h-8 rounded border border-blue-200 bg-blue-50 px-3 text-xs font-semibold text-blue-700 hover:bg-blue-100 disabled:opacity-50" disabled={Boolean(exportingPollId)} onClick={() => void exportRound(round)}>
                        {exportingPollId === round.pollId ? "导出中" : "导出"}
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
              <div className="mt-3 grid grid-cols-3 gap-2 text-xs text-slate-500">
                <div><span className="block text-slate-400">票数</span><strong className="text-sm text-slate-900">{round.totalBallots}</strong></div>
                <div><span className="block text-slate-400">匿名</span><strong className="text-sm text-slate-900">{round.anonymousBallots}</strong></div>
                <div><span className="block text-slate-400">问题</span><strong className="text-sm text-slate-900">{round.questionCount}</strong></div>
              </div>
              <div className="mt-3 text-xs text-slate-500">最后提交：{formatDateTime(round.lastSubmittedAt)}</div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button type="button" className="h-9 rounded border border-slate-200 bg-white text-sm font-semibold text-slate-700" onClick={() => void openRoundDetail(round)}>查看</button>
                <button type="button" className="h-9 rounded border border-blue-200 bg-blue-50 text-sm font-semibold text-blue-700 disabled:opacity-50" disabled={Boolean(exportingPollId)} onClick={() => void exportRound(round)}>{exportingPollId === round.pollId ? "导出中..." : "导出 Excel"}</button>
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
              </div>
              <button type="button" aria-label="关闭投票结果" title="关闭" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-slate-200 text-xl text-slate-600 hover:bg-slate-50" onClick={() => setSelectedRound(null)}>×</button>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
              {detailLoadingPollId === selectedRound.pollId ? <div className="py-16 text-center text-sm text-slate-500">正在加载本轮统计...</div> : null}
              {detailError ? <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-3 text-sm text-rose-700">{detailError}</div> : null}
              {selectedDetail?.summary ? (
                <div className="grid gap-5">
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {[
                      ["总票数", selectedDetail.summary.totalBallots],
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

            <footer className="flex shrink-0 justify-end gap-2 border-t border-slate-200 px-4 py-3 sm:px-5">
              <button type="button" className="h-10 rounded border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50" onClick={() => setSelectedRound(null)}>关闭</button>
              <button type="button" className="h-10 rounded bg-slate-950 px-4 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50" disabled={Boolean(exportingPollId) || !selectedDetail?.summary} onClick={() => void exportRound(selectedRound)}>{exportingPollId === selectedRound.pollId ? "导出中..." : "导出 Excel"}</button>
            </footer>
          </div>
        </div>
      ) : null}
    </section>
  );
}
