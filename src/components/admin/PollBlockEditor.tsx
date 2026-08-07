"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PollOption, PollProps, PollQuestion, PollQuestionType } from "@/data/homeBlocks";
import {
  buildPollExportRows,
  createPollEntityId,
  getPollConfigurationIssue,
  normalizePollConfig,
  type PollStoredBallot,
  type PollSummary,
} from "@/lib/merchantPolls";
import { isMerchantNumericId } from "@/lib/merchantIdentity";
import { useBufferedEditorTextCommit } from "@/components/admin/useBufferedEditorTextCommit";

type PollBlockEditorProps = {
  props: PollProps;
  runtimeSiteId: string;
  runtimeBlockId: string;
  onChange: (patch: Partial<PollProps>) => void;
};

type PollResultsPayload = {
  ok?: boolean;
  error?: string;
  published?: boolean;
  summary?: PollSummary;
  ballots?: PollStoredBallot[];
  truncated?: boolean;
};

type EditablePollQuestion = Omit<PollQuestion, "options"> & {
  options: PollOption[];
};

const questionTypeLabels: Record<PollQuestionType, string> = {
  single: "单选",
  multiple: "多选",
  text: "文字输入",
};

function createChoiceOptions() {
  return [
    { id: createPollEntityId("option"), label: "选项一" },
    { id: createPollEntityId("option"), label: "选项二" },
  ];
}

function createQuestion(type: PollQuestionType): EditablePollQuestion {
  return {
    id: createPollEntityId("question"),
    prompt: type === "text" ? "请填写您的意见" : "请输入问题",
    type,
    required: true,
    options: type === "text" ? [] : createChoiceOptions(),
  };
}

function readEditableQuestions(value: PollProps["pollQuestions"]): EditablePollQuestion[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 30).map((question, questionIndex) => {
    const type: PollQuestionType = question.type === "multiple" || question.type === "text" ? question.type : "single";
    return {
      id: String(question.id || `question-${questionIndex + 1}`),
      prompt: String(question.prompt ?? ""),
      type,
      required: question.required === true,
      options: type === "text"
        ? []
        : (Array.isArray(question.options) ? question.options : []).slice(0, 24).map((option, optionIndex) => ({
            id: String(option.id || `question-${questionIndex + 1}-option-${optionIndex + 1}`),
            label: String(option.label ?? ""),
          })),
    };
  });
}

function moveItem<T>(items: T[], index: number, direction: -1 | 1) {
  const target = index + direction;
  if (target < 0 || target >= items.length) return items;
  const next = [...items];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

function formatResultError(code: string) {
  if (code === "unauthorized") return "当前登录状态无法读取投票结果，请重新登录后重试。";
  if (code === "poll_store_unavailable") return "投票数据表尚未部署，发布前请先执行数据库迁移。";
  return "投票结果加载失败，请稍后重试。";
}

function CompositionSafePollInput({
  ariaLabel,
  className,
  maxLength,
  placeholder,
  value,
  onChange,
}: {
  ariaLabel?: string;
  className?: string;
  maxLength?: number;
  placeholder?: string;
  value: string;
  onChange: (nextValue: string) => void;
}) {
  const [draftText, setDraftText] = useState<string | null>(null);
  const composingRef = useRef(false);
  const textValue = draftText ?? value;

  const { scheduleCommit, flushCommit } = useBufferedEditorTextCommit(onChange);

  return (
    <input
      aria-label={ariaLabel}
      className={className}
      maxLength={maxLength}
      placeholder={placeholder}
      value={textValue}
      onFocus={() => setDraftText((currentText) => currentText ?? value)}
      onCompositionStart={() => {
        composingRef.current = true;
      }}
      onCompositionEnd={(event) => {
        composingRef.current = false;
        const nextText = event.currentTarget.value;
        setDraftText(nextText);
        scheduleCommit(nextText);
      }}
      onChange={(event) => {
        const nextText = event.currentTarget.value;
        setDraftText(nextText);
        if (!composingRef.current) scheduleCommit(nextText);
      }}
      onBlur={(event) => {
        composingRef.current = false;
        scheduleCommit(event.currentTarget.value);
        flushCommit();
        setDraftText(null);
      }}
    />
  );
}

function CompositionSafePollTextarea({
  className,
  maxLength,
  placeholder,
  value,
  onChange,
}: {
  className?: string;
  maxLength?: number;
  placeholder?: string;
  value: string;
  onChange: (nextValue: string) => void;
}) {
  const [draftText, setDraftText] = useState<string | null>(null);
  const composingRef = useRef(false);
  const textValue = draftText ?? value;

  const { scheduleCommit, flushCommit } = useBufferedEditorTextCommit(onChange);

  return (
    <textarea
      className={className}
      maxLength={maxLength}
      placeholder={placeholder}
      value={textValue}
      onFocus={() => setDraftText((currentText) => currentText ?? value)}
      onCompositionStart={() => {
        composingRef.current = true;
      }}
      onCompositionEnd={(event) => {
        composingRef.current = false;
        const nextText = event.currentTarget.value;
        setDraftText(nextText);
        scheduleCommit(nextText);
      }}
      onChange={(event) => {
        const nextText = event.currentTarget.value;
        setDraftText(nextText);
        if (!composingRef.current) scheduleCommit(nextText);
      }}
      onBlur={(event) => {
        composingRef.current = false;
        scheduleCommit(event.currentTarget.value);
        flushCommit();
        setDraftText(null);
      }}
    />
  );
}

export default function PollBlockEditor({ props, runtimeSiteId, runtimeBlockId, onChange }: PollBlockEditorProps) {
  const config = useMemo(() => normalizePollConfig(props, runtimeBlockId || "poll"), [props, runtimeBlockId]);
  const questions = useMemo(() => readEditableQuestions(props.pollQuestions), [props.pollQuestions]);
  const configurationIssue = getPollConfigurationIssue(config);
  const [results, setResults] = useState<PollResultsPayload | null>(null);
  const [resultsLoading, setResultsLoading] = useState(false);
  const [resultsError, setResultsError] = useState("");
  const [exporting, setExporting] = useState(false);

  const updateQuestions = (next: EditablePollQuestion[]) => {
    onChange({ pollQuestions: next });
    setResults((current) => (current ? { ...current, summary: undefined } : current));
  };

  const updateQuestion = (questionId: string, patch: Partial<EditablePollQuestion>) => {
    updateQuestions(questions.map((question) => (question.id === questionId ? { ...question, ...patch } : question)));
  };

  const loadResults = useCallback(async () => {
    if (!isMerchantNumericId(runtimeSiteId) || !config.pollId) {
      setResults(null);
      setResultsError("");
      return;
    }
    setResultsLoading(true);
    setResultsError("");
    try {
      const query = new URLSearchParams({ siteId: runtimeSiteId, pollId: config.pollId });
      const response = await fetch(`/api/polls?${query.toString()}`, { cache: "no-store" });
      const payload = (await response.json().catch(() => null)) as PollResultsPayload | null;
      if (!response.ok || !payload?.ok) throw new Error(payload?.error || "poll_results_load_failed");
      setResults(payload);
    } catch (error) {
      setResults(null);
      setResultsError(formatResultError(error instanceof Error ? error.message : "poll_results_load_failed"));
    } finally {
      setResultsLoading(false);
    }
  }, [config.pollId, runtimeSiteId]);

  useEffect(() => {
    void loadResults();
  }, [loadResults]);

  const exportResults = async () => {
    if (!results?.summary || !Array.isArray(results.ballots) || results.ballots.length === 0 || exporting) return;
    setExporting(true);
    try {
      const XLSX = await import("xlsx");
      const rows = buildPollExportRows(results.ballots, results.summary);
      const workbook = XLSX.utils.book_new();
      const ballotsSheet = XLSX.utils.json_to_sheet(rows);
      const summaryRows = results.summary.questions.flatMap((question, questionIndex) => {
        if (question.type === "text") {
          return [{
            "题号": questionIndex + 1,
            "问题": question.prompt,
            "类型": questionTypeLabels[question.type],
            "选项": "",
            "票数/回答数": question.responseCount,
            "跳过数": question.skippedCount,
          }];
        }
        return question.options.map((option) => ({
          "题号": questionIndex + 1,
          "问题": question.prompt,
          "类型": questionTypeLabels[question.type],
          "选项": option.label,
          "票数/回答数": option.count,
          "跳过数": question.skippedCount,
        }));
      });
      XLSX.utils.book_append_sheet(workbook, ballotsSheet, "投票明细");
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(summaryRows), "结果统计");
      const safeName = config.heading.replace(/[\\/:*?"<>|]/g, "-").slice(0, 48) || "投票结果";
      XLSX.writeFile(workbook, `${safeName}-${config.pollId}.xlsx`);
    } finally {
      setExporting(false);
    }
  };

  const startNewRound = () => {
    if (typeof window !== "undefined" && !window.confirm("确定新建一轮投票吗？当前轮次的结果会保留，并可按原投票编号继续查询。")) return;
    onChange({ pollId: createPollEntityId("poll"), pollStatus: "open" });
    setResults(null);
    setResultsError("");
  };

  return (
    <div className="grid gap-4">
      <section className="grid gap-3 border-b border-slate-200 pb-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-slate-900">投票设置</div>
            <div className="mt-1 break-all text-xs text-slate-500">投票编号：{config.pollId}</div>
          </div>
          <button type="button" className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-700 hover:bg-slate-50" onClick={startNewRound}>
            新建一轮
          </button>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="grid gap-1 text-sm text-slate-700">
            <span>投票状态</span>
            <select className="h-10 rounded-lg border border-slate-300 bg-white px-3" value={config.status} onChange={(event) => onChange({ pollStatus: event.target.value === "closed" ? "closed" : "open" })}>
              <option value="open">开放投票</option>
              <option value="closed">结束投票</option>
            </select>
          </label>
          <label className="grid gap-1 text-sm text-slate-700">
            <span>名称字段标题</span>
            <CompositionSafePollInput className="h-10 rounded-lg border border-slate-300 px-3" value={props.pollNameLabel ?? ""} placeholder="您的名称" onChange={(nextValue) => onChange({ pollNameLabel: nextValue })} />
          </label>
          <label className="grid gap-1 text-sm text-slate-700">
            <span>名称输入提示</span>
            <CompositionSafePollInput className="h-10 rounded-lg border border-slate-300 px-3" value={props.pollNamePlaceholder ?? ""} placeholder="请输入您的名称" onChange={(nextValue) => onChange({ pollNamePlaceholder: nextValue })} />
          </label>
          <label className="flex min-h-10 items-center gap-2 rounded-lg border border-slate-200 px-3 text-sm text-slate-700">
            <input type="checkbox" checked={config.allowAnonymous} onChange={(event) => onChange({ pollAllowAnonymous: event.target.checked })} />
            允许匿名投票
          </label>
          <label className="flex min-h-10 items-center gap-2 rounded-lg border border-slate-200 px-3 text-sm text-slate-700">
            <input type="checkbox" checked={config.showResultsAfterSubmit} onChange={(event) => onChange({ pollShowResultsAfterSubmit: event.target.checked })} />
            提交后显示汇总结果
          </label>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="grid gap-1 text-sm text-slate-700">
            <span>提交按钮</span>
            <CompositionSafePollInput className="h-10 rounded-lg border border-slate-300 px-3" value={props.pollSubmitLabel ?? ""} placeholder="提交投票" onChange={(nextValue) => onChange({ pollSubmitLabel: nextValue })} />
          </label>
          <label className="grid gap-1 text-sm text-slate-700">
            <span>成功标题</span>
            <CompositionSafePollInput className="h-10 rounded-lg border border-slate-300 px-3" value={props.pollSuccessTitle ?? ""} placeholder="投票已提交" onChange={(nextValue) => onChange({ pollSuccessTitle: nextValue })} />
          </label>
          <label className="grid gap-1 text-sm text-slate-700 md:col-span-2">
            <span>成功说明</span>
            <CompositionSafePollTextarea className="min-h-20 resize-y rounded-lg border border-slate-300 px-3 py-2" value={props.pollSuccessText ?? ""} placeholder="感谢您的参与。" onChange={(nextValue) => onChange({ pollSuccessText: nextValue })} />
          </label>
        </div>
      </section>

      <section className="grid gap-3 border-b border-slate-200 pb-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-slate-900">问题与选项</div>
            <div className="mt-1 text-xs text-slate-500">单选、多选和文字输入题都可以设为必选或可选。</div>
          </div>
          <div className="flex flex-wrap gap-2">
            {(["single", "multiple", "text"] as PollQuestionType[]).map((type) => (
              <button key={type} type="button" className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-700 hover:bg-slate-50" onClick={() => updateQuestions([...questions, createQuestion(type)])}>
                + {questionTypeLabels[type]}
              </button>
            ))}
          </div>
        </div>

        {questions.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500">请新增至少一个问题。</div>
        ) : (
          <div className="grid gap-3">
            {questions.map((question, questionIndex) => (
              <div key={question.id} className="grid gap-3 rounded-lg border border-slate-200 bg-white p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-slate-800">问题 {questionIndex + 1}</span>
                  <div className="flex items-center gap-1">
                    <button type="button" aria-label="上移问题" title="上移问题" className="h-8 w-8 rounded-lg border border-slate-300 bg-white text-sm disabled:opacity-40" disabled={questionIndex === 0} onClick={() => updateQuestions(moveItem(questions, questionIndex, -1))}>↑</button>
                    <button type="button" aria-label="下移问题" title="下移问题" className="h-8 w-8 rounded-lg border border-slate-300 bg-white text-sm disabled:opacity-40" disabled={questionIndex === questions.length - 1} onClick={() => updateQuestions(moveItem(questions, questionIndex, 1))}>↓</button>
                    <button type="button" className="h-8 rounded-lg border border-rose-200 bg-white px-2 text-xs text-rose-700" onClick={() => updateQuestions(questions.filter((item) => item.id !== question.id))}>删除</button>
                  </div>
                </div>
                <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_140px_auto] md:items-end">
                  <label className="grid min-w-0 gap-1 text-sm text-slate-700">
                    <span>问题内容</span>
                    <CompositionSafePollInput className="h-10 min-w-0 rounded-lg border border-slate-300 px-3" value={question.prompt} maxLength={400} onChange={(nextValue) => updateQuestion(question.id, { prompt: nextValue })} />
                  </label>
                  <label className="grid gap-1 text-sm text-slate-700">
                    <span>题型</span>
                    <select
                      className="h-10 rounded-lg border border-slate-300 bg-white px-3"
                      value={question.type}
                      onChange={(event) => {
                        const type = event.target.value as PollQuestionType;
                        updateQuestion(question.id, { type, options: type === "text" ? [] : question.options.length >= 2 ? question.options : createChoiceOptions() });
                      }}
                    >
                      <option value="single">单选</option>
                      <option value="multiple">多选</option>
                      <option value="text">文字输入</option>
                    </select>
                  </label>
                  <label className="flex h-10 items-center gap-2 rounded-lg border border-slate-200 px-3 text-sm text-slate-700">
                    <input type="checkbox" checked={question.required} onChange={(event) => updateQuestion(question.id, { required: event.target.checked })} />
                    必选
                  </label>
                </div>

                {question.type !== "text" ? (
                  <div className="grid gap-2 border-t border-slate-100 pt-3">
                    {question.options.map((option, optionIndex) => (
                      <div key={option.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                        <CompositionSafePollInput
                          ariaLabel={`问题 ${questionIndex + 1} 选项 ${optionIndex + 1}`}
                          className="h-10 min-w-0 rounded-lg border border-slate-300 px-3"
                          value={option.label}
                          maxLength={240}
                          onChange={(nextValue) => updateQuestion(question.id, { options: question.options.map((item) => item.id === option.id ? { ...item, label: nextValue } : item) })}
                        />
                        <button type="button" aria-label="删除选项" title="删除选项" className="h-10 w-10 rounded-lg border border-slate-300 bg-white text-slate-500 disabled:opacity-40" disabled={question.options.length <= 2} onClick={() => updateQuestion(question.id, { options: question.options.filter((item) => item.id !== option.id) })}>×</button>
                      </div>
                    ))}
                    <button type="button" className="h-9 justify-self-start rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-700" onClick={() => updateQuestion(question.id, { options: [...question.options, { id: createPollEntityId("option"), label: `选项 ${question.options.length + 1}` }] })}>
                      + 新增选项
                    </button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
        {configurationIssue ? <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">配置尚未完成：每个选择题至少需要两个有内容的选项。</div> : null}
      </section>

      <section className="grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-slate-900">结果统计</div>
            <div className="mt-1 text-xs text-slate-500">结果按投票轮次保存；匿名投票不会导出投票人名称。</div>
          </div>
          <div className="flex gap-2">
            <button type="button" className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-700 disabled:opacity-50" disabled={resultsLoading || !isMerchantNumericId(runtimeSiteId)} onClick={() => void loadResults()}>
              {resultsLoading ? "刷新中..." : "刷新结果"}
            </button>
            <button type="button" className="h-9 rounded-lg bg-slate-950 px-3 text-sm font-semibold text-white disabled:opacity-50" disabled={exporting || !results?.ballots?.length} onClick={() => void exportResults()}>
              {exporting ? "导出中..." : "导出 Excel"}
            </button>
          </div>
        </div>
        {!isMerchantNumericId(runtimeSiteId) ? <div className="text-sm text-slate-500">保存到商户站点后可查看投票结果。</div> : null}
        {resultsError ? <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{resultsError}</div> : null}
        {results?.summary ? (
          <div className="grid gap-4">
            <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-slate-600">
              <span>总票数：<strong className="text-slate-900">{results.summary.totalBallots}</strong></span>
              <span>匿名：<strong className="text-slate-900">{results.summary.anonymousBallots}</strong></span>
              <span>{results.published ? "当前轮次已发布" : "当前轮次尚未发布"}</span>
              {results.truncated ? <span className="text-amber-700">数据量较大，当前导出已达上限</span> : null}
            </div>
            {results.summary.questions.map((question, questionIndex) => (
              <div key={question.id} className="grid gap-2 border-t border-slate-200 pt-3">
                <div className="text-sm font-medium text-slate-800">{questionIndex + 1}. {question.prompt}</div>
                <div className="text-xs text-slate-500">回答 {question.responseCount}，跳过 {question.skippedCount}{question.active ? "" : "，历史题目"}</div>
                {question.type === "text" ? (
                  <div className="max-h-48 overflow-y-auto rounded-lg border border-slate-200 bg-white">
                    {question.textResponses?.length ? question.textResponses.map((response) => (
                      <div key={`${response.ballotId}-${response.createdAt}`} className="border-b border-slate-100 px-3 py-2 last:border-b-0">
                        <div className="whitespace-pre-wrap break-words text-sm text-slate-800">{response.value}</div>
                        <div className="mt-1 text-xs text-slate-400">{response.anonymous ? "匿名" : response.participantName} · {response.createdAt}</div>
                      </div>
                    )) : <div className="px-3 py-4 text-sm text-slate-500">暂无文字回答</div>}
                  </div>
                ) : (
                  <div className="grid gap-2">
                    {question.options.map((option) => {
                      const percentage = question.responseCount > 0 ? Math.round((option.count / question.responseCount) * 100) : 0;
                      return (
                        <div key={option.id} className="grid gap-1">
                          <div className="flex justify-between gap-3 text-sm text-slate-700"><span className="break-words">{option.label}</span><span className="shrink-0">{option.count} 票 · {percentage}%</span></div>
                          <div className="h-2 overflow-hidden rounded bg-slate-100"><div className="h-full rounded bg-sky-600" style={{ width: `${percentage}%` }} /></div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : resultsLoading ? <div className="text-sm text-slate-500">正在读取结果...</div> : null}
      </section>
    </div>
  );
}
