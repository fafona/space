"use client";

import { useMemo, useRef } from "react";
import type { PollAudience, PollOption, PollProps, PollQuestion, PollQuestionType } from "@/data/homeBlocks";
import {
  POLL_MAX_OPTIONS,
  POLL_MAX_QUESTIONS,
  createPollEntityId,
  getPollConfigurationIssue,
  normalizePollConfig,
} from "@/lib/merchantPolls";
import { BufferedEditorInput, BufferedEditorTextarea } from "@/components/admin/BufferedEditorControls";

type PollBlockEditorProps = {
  props: PollProps;
  runtimeSiteId: string;
  runtimeBlockId: string;
  onChange: (patch: Partial<PollProps>) => void;
};

type EditablePollQuestion = Omit<PollQuestion, "options"> & {
  options: PollOption[];
};

const questionTypeLabels: Record<PollQuestionType, string> = {
  single: "单选",
  multiple: "多选",
  text: "文字输入",
};

const pollAudienceLabels: Record<PollAudience, string> = {
  everyone: "所有人",
  "merchant-members": "仅本商户会员",
  "registered-users": "Faolla 注册用户",
};

const POLL_EDITOR_COMMIT_DELAY_MS = 480;
const POLL_EDITOR_COMMIT_MAX_WAIT_MS = 1800;

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
  return value.slice(0, POLL_MAX_QUESTIONS).map((question, questionIndex) => {
    const type: PollQuestionType = question.type === "multiple" || question.type === "text" ? question.type : "single";
    return {
      id: String(question.id || `question-${questionIndex + 1}`),
      prompt: String(question.prompt ?? ""),
      type,
      required: question.required === true,
      options: type === "text"
        ? []
        : (Array.isArray(question.options) ? question.options : []).slice(0, POLL_MAX_OPTIONS).map((option, optionIndex) => ({
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

function toDateTimeLocalInput(value: string) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "";
  const date = new Date(timestamp);
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return localDate.toISOString().slice(0, 16);
}

function fromDateTimeLocalInput(value: string) {
  if (!value) return "";
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : "";
}

function formatDateTimeDisplay(value: string) {
  return toDateTimeLocalInput(value).replace("T", " ");
}

function openNativeDateTimePicker(input: HTMLInputElement | null) {
  if (!input) return;
  const pickerInput = input as HTMLInputElement & { showPicker?: () => void };
  try {
    pickerInput.focus({ preventScroll: true });
  } catch {
    pickerInput.focus();
  }
  if (typeof pickerInput.showPicker === "function") {
    try {
      pickerInput.showPicker();
      return;
    } catch {
      // Fall through to the click path for embedded browsers.
    }
  }
  try {
    pickerInput.click();
  } catch {
    // Some embedded browsers do not expose a native date-time picker.
  }
}

function PollCalendarIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-4 w-4">
      <path
        d="M6 2.75v2.5M14 2.75v2.5M3.75 7.25h12.5M5.5 4.5h9a1.75 1.75 0 0 1 1.75 1.75v8.25A1.75 1.75 0 0 1 14.5 16.25h-9A1.75 1.75 0 0 1 3.75 14.5V6.25A1.75 1.75 0 0 1 5.5 4.5Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PollDateTimeField({
  label,
  value,
  min,
  onChange,
}: {
  label: string;
  value: string;
  min?: string;
  onChange: (value: string) => void;
}) {
  const pickerInputRef = useRef<HTMLInputElement>(null);
  const pickerValue = toDateTimeLocalInput(value);

  return (
    <label className="grid gap-1 text-sm text-slate-700">
      <span>{label}</span>
      <span className="relative block">
        <input
          type="text"
          readOnly
          data-no-translate="1"
          translate="no"
          className="h-10 w-full cursor-pointer rounded-lg border border-slate-300 bg-white px-3 pr-20 text-sm text-slate-800 outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
          value={formatDateTimeDisplay(value)}
          placeholder="请选择日期和时间"
          onClick={() => openNativeDateTimePicker(pickerInputRef.current)}
        />
        {pickerValue ? (
          <button
            type="button"
            className="absolute inset-y-0 right-10 inline-flex w-8 items-center justify-center rounded-md text-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-300"
            aria-label={`清除${label}`}
            title={`清除${label}`}
            onClick={() => onChange("")}
          >
            ×
          </button>
        ) : null}
        <button
          type="button"
          className="absolute inset-y-0 right-1 inline-flex w-9 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-300"
          aria-label={`${label}选择器`}
          title={`${label}选择器`}
          onClick={() => openNativeDateTimePicker(pickerInputRef.current)}
        >
          <PollCalendarIcon />
        </button>
        <input
          ref={pickerInputRef}
          type="datetime-local"
          tabIndex={-1}
          aria-hidden="true"
          data-no-translate="1"
          translate="no"
          className="pointer-events-none absolute right-2 top-1/2 h-8 w-8 -translate-y-1/2 opacity-0"
          min={min}
          value={pickerValue}
          onChange={(event) => onChange(fromDateTimeLocalInput(event.target.value))}
        />
      </span>
    </label>
  );
}

function getConfigurationMessage(issue: string) {
  if (issue === "invalid_schedule") return "开放时间必须早于结束时间。";
  if (issue === "missing_questions") return "请至少设置一个投票问题。";
  return "每个选择题至少需要两个有内容的选项。";
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
  return (
    <BufferedEditorInput
      aria-label={ariaLabel}
      className={className}
      maxLength={maxLength}
      placeholder={placeholder}
      value={value}
      commitDelayMs={POLL_EDITOR_COMMIT_DELAY_MS}
      commitMaxWaitMs={POLL_EDITOR_COMMIT_MAX_WAIT_MS}
      onChange={(event) => onChange(event.currentTarget.value)}
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
  return (
    <BufferedEditorTextarea
      className={className}
      maxLength={maxLength}
      placeholder={placeholder}
      value={value}
      commitDelayMs={POLL_EDITOR_COMMIT_DELAY_MS}
      commitMaxWaitMs={POLL_EDITOR_COMMIT_MAX_WAIT_MS}
      onChange={(event) => onChange(event.currentTarget.value)}
    />
  );
}

export default function PollBlockEditor({ props, runtimeBlockId, onChange }: PollBlockEditorProps) {
  const config = useMemo(() => normalizePollConfig(props, runtimeBlockId || "poll"), [props, runtimeBlockId]);
  const questions = useMemo(() => readEditableQuestions(props.pollQuestions), [props.pollQuestions]);
  const configurationIssue = getPollConfigurationIssue(config);

  const updateQuestions = (next: EditablePollQuestion[]) => {
    onChange({ pollQuestions: next });
  };

  const updateQuestion = (questionId: string, patch: Partial<EditablePollQuestion>) => {
    updateQuestions(questions.map((question) => (question.id === questionId ? { ...question, ...patch } : question)));
  };

  const startNewRound = () => {
    if (typeof window !== "undefined" && !window.confirm("确定新建一轮投票吗？当前轮次的结果会保留，并可按原投票编号继续查询。")) return;
    onChange({ pollId: createPollEntityId("poll"), pollStatus: "open", pollOpenAt: "", pollCloseAt: "" });
  };

  return (
    <div className="grid gap-4">
      <section className="grid gap-3 border-b border-slate-200 pb-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-slate-900">投票设置</div>
            <div className="mt-1 break-all text-xs text-slate-500">投票编号：{config.pollId}</div>
            <div className="mt-1 text-xs text-slate-500">统计和导出请前往经营中心的“投票统计”。</div>
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
            <span>投票对象</span>
            <select
              className="h-10 rounded-lg border border-slate-300 bg-white px-3"
              value={config.audience}
              onChange={(event) => onChange({ pollAudience: event.target.value as PollAudience })}
            >
              {(Object.keys(pollAudienceLabels) as PollAudience[]).map((audience) => (
                <option key={audience} value={audience}>{pollAudienceLabels[audience]}</option>
              ))}
            </select>
          </label>
          <PollDateTimeField
            label="开放时间（可选）"
            value={config.openAt}
            onChange={(pollOpenAt) => onChange({ pollOpenAt })}
          />
          <PollDateTimeField
            label="结束时间（可选）"
            value={config.closeAt}
            min={toDateTimeLocalInput(config.openAt) || undefined}
            onChange={(pollCloseAt) => onChange({ pollCloseAt })}
          />
          <div className="flex min-h-10 items-center rounded-lg border border-slate-200 px-3 text-xs leading-5 text-slate-500">
            留空表示立即开放或不设结束时间；页面停留期间也会按时间自动切换状态。
          </div>
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
          <label className="grid gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 md:col-span-2">
            <span className="flex items-center justify-between gap-3">
              <span>内容底框透明度</span>
              <span className="tabular-nums text-slate-500">{Math.round(config.contentBackgroundOpacity * 100)}%</span>
            </span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              className="w-full"
              value={config.contentBackgroundOpacity}
              onChange={(event) => onChange({ pollContentBackgroundOpacity: Number(event.target.value) })}
            />
            <span className="text-xs text-slate-500">作用于姓名区、题目区和结果区底框；0% 为完全透明，100% 为不透明。</span>
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
              <button
                key={type}
                type="button"
                className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={questions.length >= POLL_MAX_QUESTIONS}
                onClick={() => updateQuestions([...questions, createQuestion(type)])}
              >
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
                    <div className="text-right text-xs tabular-nums text-slate-500">选项 {question.options.length} / {POLL_MAX_OPTIONS}</div>
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
                    <button
                      type="button"
                      className="h-9 justify-self-start rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={question.options.length >= POLL_MAX_OPTIONS}
                      onClick={() => updateQuestion(question.id, { options: [...question.options, { id: createPollEntityId("option"), label: `选项 ${question.options.length + 1}` }] })}
                    >
                      + 新增选项
                    </button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
        {configurationIssue ? <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">配置尚未完成：{getConfigurationMessage(configurationIssue)}</div> : null}
      </section>

    </div>
  );
}
