"use client";

import { useEffect, useMemo, useState } from "react";
import type { PollProps } from "@/data/homeBlocks";
import { resolveFrontendAuthPayload } from "@/lib/authSessionRecovery";
import {
  getPollConfigurationIssue,
  normalizePollConfig,
  validatePollAnswers,
  type PollAnswer,
  type PollSummary,
} from "@/lib/merchantPolls";
import { isMerchantNumericId } from "@/lib/merchantIdentity";
import { readPersonalCustomerProfileFromSession } from "@/lib/personalCustomerProfile";
import { readPersonalGuestMergeToken, readPersonalGuestProfile } from "@/lib/personalGuestSession";
import { getBackgroundStyle } from "./backgroundStyle";
import { getBlockBorderClass, getBlockBorderInlineStyle } from "./borderStyle";
import { resolveMobileFitCardClass, resolveMobileFitSectionClass } from "./mobileFrame";
import { toRichHtml } from "./richText";

type PollBlockRuntimeProps = PollProps & {
  runtimeSiteId?: string;
  runtimeBlockId?: string;
  interactive?: boolean;
};

type PollAnswerDraft = {
  optionIds: string[];
  text: string;
};

function getPollErrorMessage(code: string) {
  if (code === "already_voted") return "您已经提交过本次投票。";
  if (code === "poll_closed") return "本次投票已经结束。";
  if (code === "poll_not_published") return "投票尚未发布，请稍后再试。";
  if (code === "participant_name_required") return "请填写名称。";
  if (code === "required_answer_missing") return "请完成所有必选题。";
  if (code === "answer_too_long") return "文字回答内容过长，请精简后再提交。";
  if (code === "poll_store_unavailable") return "投票服务正在配置中，请稍后再试。";
  if (code === "invalid_poll_configuration") return "投票配置不完整，请联系商家。";
  return "提交失败，请检查网络后重试。";
}

function PollResults({ summary }: { summary: PollSummary }) {
  return (
    <div className="mt-5 border-t border-slate-200 pt-4">
      <div className="flex items-center justify-between gap-3">
        <div className="text-base font-semibold text-slate-900">投票结果</div>
        <div className="text-sm text-slate-500">共 {summary.totalBallots} 票</div>
      </div>
      <div className="mt-4 grid gap-5">
        {summary.questions.map((question, questionIndex) => (
          <div key={question.id} className="min-w-0">
            <div className="text-sm font-medium text-slate-800">
              {questionIndex + 1}. {question.prompt}
            </div>
            {question.type === "text" ? (
              <div className="mt-2 text-sm text-slate-500">已收到 {question.responseCount} 条文字回答</div>
            ) : (
              <div className="mt-2 grid gap-2">
                {question.options.map((option) => {
                  const percentage = question.responseCount > 0 ? Math.round((option.count / question.responseCount) * 100) : 0;
                  return (
                    <div key={option.id} className="grid gap-1">
                      <div className="flex items-center justify-between gap-3 text-sm text-slate-700">
                        <span className="min-w-0 break-words">{option.label}</span>
                        <span className="shrink-0 text-slate-500">{option.count} 票 · {percentage}%</span>
                      </div>
                      <div className="h-2 overflow-hidden rounded bg-slate-100">
                        <div className="h-full rounded bg-sky-600 transition-[width]" style={{ width: `${percentage}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function PollBlock({
  runtimeSiteId = "",
  runtimeBlockId = "",
  interactive = true,
  ...props
}: PollBlockRuntimeProps) {
  const config = useMemo(() => normalizePollConfig(props, runtimeBlockId || "poll"), [props, runtimeBlockId]);
  const configurationIssue = getPollConfigurationIssue(config);
  const [answerDrafts, setAnswerDrafts] = useState<Record<string, PollAnswerDraft>>({});
  const [participantName, setParticipantName] = useState("");
  const [anonymous, setAnonymous] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");
  const [summary, setSummary] = useState<PollSummary | null>(null);

  useEffect(() => {
    if (!interactive) return;
    let active = true;
    const guestProfile = readPersonalGuestProfile();
    if (guestProfile.displayName) setParticipantName((current) => current || guestProfile.displayName);
    void resolveFrontendAuthPayload(2600)
      .then((payload) => {
        if (!active) return;
        const profile = readPersonalCustomerProfileFromSession(payload);
        const isMember = payload?.authenticated === true && payload.accountType === "personal";
        if (isMember && profile.name) setParticipantName((current) => current || profile.name);
      })
      .catch(() => null);
    return () => {
      active = false;
    };
  }, [interactive]);

  useEffect(() => {
    if (!config.allowAnonymous) setAnonymous(false);
  }, [config.allowAnonymous]);

  const updateAnswer = (questionId: string, patch: Partial<PollAnswerDraft>) => {
    setAnswerDrafts((current) => ({
      ...current,
      [questionId]: {
        optionIds: current[questionId]?.optionIds ?? [],
        text: current[questionId]?.text ?? "",
        ...patch,
      },
    }));
    setError("");
  };

  const buildAnswers = (): PollAnswer[] =>
    config.questions.map((question) => ({
      questionId: question.id,
      optionIds: answerDrafts[question.id]?.optionIds ?? [],
      text: answerDrafts[question.id]?.text ?? "",
    }));

  const submitPoll = async () => {
    if (!interactive || submitting || submitted) return;
    if (!isMerchantNumericId(runtimeSiteId)) {
      setError("投票仅在发布后可以提交。");
      return;
    }
    if (configurationIssue) {
      setError(getPollErrorMessage("invalid_poll_configuration"));
      return;
    }
    if (!anonymous && !participantName.trim()) {
      setError(getPollErrorMessage("participant_name_required"));
      return;
    }
    const answers = buildAnswers();
    const validation = validatePollAnswers(config, answers);
    if (!validation.ok) {
      setError(getPollErrorMessage(validation.code));
      return;
    }

    setSubmitting(true);
    setError("");
    try {
      const authPayload = await resolveFrontendAuthPayload(2600).catch(() => null);
      const isMember = authPayload?.authenticated === true && authPayload.accountType === "personal";
      const response = await fetch("/api/polls", {
        method: "POST",
        headers: { "content-type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          siteId: runtimeSiteId,
          pollId: config.pollId,
          blockId: runtimeBlockId,
          participantName: participantName.trim(),
          anonymous,
          answers: validation.answers,
          frontendAuthProof: authPayload?.frontendAuthProof ?? "",
          guestToken: isMember ? "" : readPersonalGuestMergeToken(),
        }),
      });
      const payload = (await response.json().catch(() => null)) as { ok?: boolean; error?: string; summary?: PollSummary | null } | null;
      if (!response.ok || !payload?.ok) throw new Error(payload?.error || "poll_submit_failed");
      setSummary(payload.summary ?? null);
      setSubmitted(true);
    } catch (submitError) {
      setError(getPollErrorMessage(submitError instanceof Error ? submitError.message : "poll_submit_failed"));
    } finally {
      setSubmitting(false);
    }
  };

  const mobileFitScreenWidth = props.mobileFitScreenWidth === true;
  const backgroundStyle = getBackgroundStyle({
    imageUrl: props.bgImageUrl,
    fillMode: props.bgFillMode,
    position: props.bgPosition,
    color: props.bgColor,
    opacity: props.bgOpacity,
    imageOpacity: props.bgImageOpacity,
    colorOpacity: props.bgColorOpacity,
  });
  const borderClass = getBlockBorderClass(props.blockBorderStyle);
  const borderStyle = getBlockBorderInlineStyle(props.blockBorderStyle, props.blockBorderColor);
  const headingHtml = toRichHtml(config.heading, "在线投票");
  const textHtml = toRichHtml(config.text, "");
  const live = interactive && config.status === "open" && !configurationIssue;
  const contentBackgroundStyle = {
    backgroundColor: `rgba(255, 255, 255, ${config.contentBackgroundOpacity})`,
  };

  return (
    <section
      className={resolveMobileFitCardClass(
        resolveMobileFitSectionClass(`mx-auto max-w-6xl rounded-lg p-5 shadow-sm ${borderClass}`, mobileFitScreenWidth),
        mobileFitScreenWidth,
      )}
      style={{
        ...backgroundStyle,
        ...borderStyle,
        width: props.blockWidth ? `${props.blockWidth}px` : undefined,
        minHeight: props.blockHeight ? `${props.blockHeight}px` : undefined,
      }}
    >
      <div className="rounded-lg border border-white/50 p-4 shadow-sm sm:p-5" style={contentBackgroundStyle}>
        <div className="text-2xl font-bold text-slate-900 break-words" dangerouslySetInnerHTML={{ __html: headingHtml }} />
        {config.text ? (
          <div className="mt-2 text-sm leading-6 text-slate-600 break-words" dangerouslySetInnerHTML={{ __html: textHtml }} />
        ) : null}

        {submitted ? (
          <div className="mt-5 rounded-lg border border-emerald-300/80 p-4">
            <div className="text-lg font-semibold text-emerald-900">{config.successTitle}</div>
            <div className="mt-1 text-sm text-emerald-800">{config.successText}</div>
            {summary ? <PollResults summary={summary} /> : null}
          </div>
        ) : (
          <form
            className="mt-5 grid gap-5"
            onSubmit={(event) => {
              event.preventDefault();
              void submitPoll();
            }}
          >
            <div className="grid gap-3 border-b border-slate-300/70 pb-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
            <label className="grid min-w-0 gap-1 text-sm text-slate-700">
              <span>
                {config.nameLabel}
                {!config.allowAnonymous ? <span className="ml-2 text-xs text-rose-600">必填</span> : null}
              </span>
              <input
                className="h-11 min-w-0 rounded-lg border border-slate-300 bg-white px-3 text-base outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 disabled:bg-slate-100"
                value={participantName}
                placeholder={config.namePlaceholder}
                disabled={anonymous || submitting || !live}
                required={!anonymous}
                aria-required={!anonymous}
                maxLength={120}
                onChange={(event) => {
                  setParticipantName(event.target.value);
                  setError("");
                }}
              />
            </label>
            {config.allowAnonymous ? (
              <label className="flex min-h-11 items-center gap-2 rounded-lg border border-slate-200 px-3 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={anonymous}
                  disabled={submitting || !live}
                  onChange={(event) => {
                    setAnonymous(event.target.checked);
                    setError("");
                  }}
                />
                匿名投票
              </label>
            ) : null}
          </div>

          <div className="grid gap-4">
            {config.questions.map((question, questionIndex) => {
              const draft = answerDrafts[question.id] ?? { optionIds: [], text: "" };
              const questionTypeLabel = question.type === "single" ? "单选" : question.type === "multiple" ? "多选" : "文字输入";
              return (
                <fieldset
                  key={question.id}
                  aria-labelledby={`poll-question-${config.pollId}-${question.id}`}
                  className="min-w-0 rounded-lg border border-slate-300/80 p-4"
                  disabled={submitting || !live}
                >
                  <div
                    id={`poll-question-${config.pollId}-${question.id}`}
                    className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-base text-slate-900"
                  >
                    <span className="min-w-0 flex-1 basis-64 font-semibold break-words">
                      {questionIndex + 1}. {question.prompt}
                    </span>
                    <span className="inline-flex rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 align-middle text-xs font-normal text-slate-600">
                      {questionTypeLabel}
                    </span>
                    <span className={`inline-flex px-1 py-0.5 align-middle text-xs font-normal ${question.required ? "text-rose-600" : "text-slate-500"}`}>
                      {question.required ? "必选" : "可选"}
                    </span>
                  </div>
                  {question.type === "text" ? (
                    <textarea
                      className="mt-3 min-h-28 w-full resize-y rounded-lg border border-slate-300 bg-white px-3 py-2 text-base outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20"
                      value={draft.text}
                      maxLength={4000}
                      aria-required={question.required}
                      placeholder="请输入您的回答"
                      onChange={(event) => updateAnswer(question.id, { text: event.target.value })}
                    />
                  ) : (
                    <div className="mt-3 grid gap-2">
                      {question.options.map((option) => {
                        const checked = draft.optionIds.includes(option.id);
                        return (
                          <label key={option.id} className="flex min-h-11 items-start gap-3 rounded-lg border border-slate-200/90 px-3 py-2.5 text-sm text-slate-800 hover:bg-white/50">
                            <input
                              className="mt-0.5 h-4 w-4 shrink-0"
                              type={question.type === "single" ? "radio" : "checkbox"}
                              name={`poll-${config.pollId}-${question.id}`}
                              checked={checked}
                              onChange={(event) => {
                                if (question.type === "single") {
                                  updateAnswer(question.id, { optionIds: event.target.checked ? [option.id] : [] });
                                  return;
                                }
                                updateAnswer(question.id, {
                                  optionIds: event.target.checked
                                    ? [...new Set([...draft.optionIds, option.id])]
                                    : draft.optionIds.filter((id) => id !== option.id),
                                });
                              }}
                            />
                            <span className="min-w-0 break-words">{option.label}</span>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </fieldset>
              );
            })}
          </div>

          {!live ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              {config.status === "closed" ? "本次投票已经结束。" : "请完善投票问题和选项后发布。"}
            </div>
          ) : null}
          {error ? <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div> : null}
          <button
            type="submit"
            className="h-11 w-full rounded-lg bg-slate-950 px-5 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
            disabled={!live || submitting}
          >
            {submitting ? "正在提交..." : config.submitLabel}
          </button>
          </form>
        )}
      </div>
    </section>
  );
}
