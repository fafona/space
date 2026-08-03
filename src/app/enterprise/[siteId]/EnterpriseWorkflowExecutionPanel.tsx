"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClientMutationOperationId } from "@/lib/mutationOperationId";
import {
  normalizeMerchantEnterpriseWorkflowAcknowledgement,
  normalizeMerchantEnterpriseWorkflowExecution,
  normalizeMerchantEnterpriseWorkflowExecutionStats,
  normalizeMerchantEnterpriseWorkflowFeedbackResolution,
  type MerchantEnterpriseWorkflowAcknowledgement,
  type MerchantEnterpriseWorkflowEvidence,
  type MerchantEnterpriseWorkflowExecution,
  type MerchantEnterpriseWorkflowExecutionFeedback,
  type MerchantEnterpriseWorkflowExecutionStats,
} from "@/lib/merchantEnterpriseWorkflowExecution";
import type {
  EnterpriseWorkflow,
  EnterpriseWorkflowActor,
  EnterpriseWorkflowApiFetch,
} from "./EnterpriseWorkflowsPanel";

const EXECUTION_API = "/api/merchant-enterprise/workflow-executions";

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function apiError(payload: unknown, fallback: string) {
  const code = typeof object(payload)?.error === "string" ? String(object(payload)?.error) : "";
  if (code === "permission_denied" || code === "merchant_access_denied") {
    return "当前账号没有执行此操作的权限。";
  }
  if (code === "workflow_not_found" || code === "workflow_not_published") {
    return "该流程尚未发布，或当前发布版本已不可用。";
  }
  if (code === "workflow_acknowledgement_required") {
    return "请先确认已阅读当前发布版本，再开始执行。";
  }
  if (code === "workflow_revision_changed" || code === "workflow_published_version_conflict") {
    return "流程已发布新版本，请刷新、阅读并确认最新版后再操作。";
  }
  if (code === "workflow_execution_not_found" || code === "workflow_execution_step_not_found") {
    return "执行记录已不存在或当前账号无权查看。";
  }
  if (code === "workflow_execution_version_conflict" || code === "enterprise_version_conflict") {
    return "执行记录已被更新，已为你重新加载，请再次确认。";
  }
  if (code === "workflow_execution_completed") return "该次执行已经完成。";
  if (code === "workflow_execution_incomplete") return "完成全部步骤后才能提交反馈。";
  if (code === "workflow_feedback_not_open") return "该条反馈已被处理或不存在。";
  if (
    code === "workflow_task_already_bound" ||
    code === "workflow_task_execution_exists" ||
    code === "task_workflow_checklist_source_exists"
  ) {
    return "该任务已经关联过工作流程，不能重复生成清单。";
  }
  if (code === "task_checklist_limit_reached") {
    return "关联后会超过任务清单 100 项上限，请先精简现有清单。";
  }
  if (code === "invalid_task_archived") return "已归档任务不能关联或执行工作流程。";
  return fallback;
}

function formatDate(value: string | null) {
  if (!value) return "—";
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(timestamp);
}

function normalizeEmployeeState(value: unknown, siteId: string, workflowId: string) {
  const body = object(value);
  const currentRevisionNo = Number(body?.currentRevisionNo ?? body?.current_revision_no);
  const acknowledgement = body?.acknowledgement
    ? normalizeMerchantEnterpriseWorkflowAcknowledgement(body.acknowledgement)
    : null;
  const executions = (Array.isArray(body?.executions) ? body.executions : [])
    .map(normalizeMerchantEnterpriseWorkflowExecution)
    .filter(
      (execution): execution is MerchantEnterpriseWorkflowExecution =>
        Boolean(
          execution && execution.siteId === siteId && execution.workflowId === workflowId,
        ),
    )
    .sort(
      (left, right) =>
        (Date.parse(right.updatedAt) || 0) - (Date.parse(left.updatedAt) || 0) ||
        right.id.localeCompare(left.id),
    );
  if (!body || body.ok !== true || !Number.isSafeInteger(currentRevisionNo) || currentRevisionNo < 1) {
    return null;
  }
  if (
    acknowledgement &&
    (acknowledgement.siteId !== siteId || acknowledgement.workflowId !== workflowId)
  ) {
    return null;
  }
  return {
    currentRevisionNo,
    acknowledgement,
    executions,
  };
}

function upsertExecution(
  current: MerchantEnterpriseWorkflowExecution[],
  execution: MerchantEnterpriseWorkflowExecution,
) {
  return [execution, ...current.filter((item) => item.id !== execution.id)].sort(
    (left, right) =>
      (Date.parse(right.updatedAt) || 0) - (Date.parse(left.updatedAt) || 0) ||
      right.id.localeCompare(left.id),
  );
}

function evidenceFromDraft(label: string, reference: string): MerchantEnterpriseWorkflowEvidence | null {
  const normalizedReference = reference.trim();
  if (!normalizedReference) return null;
  return {
    kind: /^https?:\/\//i.test(normalizedReference) ? "link" : "reference",
    label: label.trim() || (/^https?:\/\//i.test(normalizedReference) ? "相关链接" : "补充凭证"),
    reference: normalizedReference,
    mediaType: "",
    sizeBytes: null,
  };
}

function EmployeeExecutionWorkspace({
  siteId,
  workflow,
  apiFetch,
  acknowledgement,
  currentRevisionNo,
  executions,
  loading,
  onReload,
  onAcknowledgement,
  onExecutions,
  taskId = null,
  generateChecklist = false,
  onTaskChecklistGenerated,
}: {
  siteId: string;
  workflow: EnterpriseWorkflow;
  apiFetch: EnterpriseWorkflowApiFetch;
  acknowledgement: MerchantEnterpriseWorkflowAcknowledgement | null;
  currentRevisionNo: number;
  executions: MerchantEnterpriseWorkflowExecution[];
  loading: boolean;
  onReload: () => Promise<void>;
  onAcknowledgement: (value: MerchantEnterpriseWorkflowAcknowledgement) => void;
  onExecutions: (value: MerchantEnterpriseWorkflowExecution[]) => void;
  taskId?: string | null;
  generateChecklist?: boolean;
  onTaskChecklistGenerated?: (count: number) => void | Promise<void>;
}) {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [subject, setSubject] = useState("");
  const [selectedExecutionId, setSelectedExecutionId] = useState("");
  const [stepNotes, setStepNotes] = useState<Record<string, string>>({});
  const [evidenceLabels, setEvidenceLabels] = useState<Record<string, string>>({});
  const [evidenceReferences, setEvidenceReferences] = useState<Record<string, string>>({});
  const [feedbackRating, setFeedbackRating] = useState("");
  const [feedbackText, setFeedbackText] = useState("");
  const draftExecutionIdRef = useRef("");
  const dirtyStepNoteIdsRef = useRef(new Set<string>());
  const feedbackDraftDirtyRef = useRef(false);

  const acknowledgedCurrent = acknowledgement?.revisionNo === currentRevisionNo;
  const taskExecution = taskId
    ? executions.find((execution) => execution.taskId === taskId) ?? null
    : null;
  const selectedExecution =
    taskExecution ??
    executions.find((execution) => execution.id === selectedExecutionId) ??
    executions[0] ??
    null;

  useEffect(() => {
    if (selectedExecution && selectedExecution.id !== selectedExecutionId) {
      setSelectedExecutionId(selectedExecution.id);
    }
  }, [selectedExecution, selectedExecutionId]);

  useEffect(() => {
    if (!selectedExecution) {
      draftExecutionIdRef.current = "";
      dirtyStepNoteIdsRef.current.clear();
      feedbackDraftDirtyRef.current = false;
      setStepNotes({});
      setEvidenceLabels({});
      setEvidenceReferences({});
      setFeedbackRating("");
      setFeedbackText("");
      return;
    }
    if (draftExecutionIdRef.current !== selectedExecution.id) {
      draftExecutionIdRef.current = selectedExecution.id;
      dirtyStepNoteIdsRef.current.clear();
      feedbackDraftDirtyRef.current = false;
      setStepNotes(
        Object.fromEntries(selectedExecution.steps.map((step) => [step.stepId, step.note])),
      );
      setEvidenceLabels({});
      setEvidenceReferences({});
      setFeedbackRating(
        selectedExecution.feedbackRating ? String(selectedExecution.feedbackRating) : "",
      );
      setFeedbackText(selectedExecution.feedbackText);
      return;
    }
    setStepNotes((current) => {
      const validStepIds = new Set(selectedExecution.steps.map((step) => step.stepId));
      const next = Object.fromEntries(
        Object.entries(current).filter(([stepId]) => validStepIds.has(stepId)),
      );
      for (const step of selectedExecution.steps) {
        if (!dirtyStepNoteIdsRef.current.has(step.stepId)) next[step.stepId] = step.note;
      }
      return next;
    });
    if (!feedbackDraftDirtyRef.current) {
      setFeedbackRating(
        selectedExecution.feedbackRating ? String(selectedExecution.feedbackRating) : "",
      );
      setFeedbackText(selectedExecution.feedbackText);
    }
  }, [selectedExecution]);

  function hasUnsavedExecutionDraft() {
    return (
      dirtyStepNoteIdsRef.current.size > 0 ||
      feedbackDraftDirtyRef.current ||
      Object.values(evidenceLabels).some((value) => value.trim()) ||
      Object.values(evidenceReferences).some((value) => value.trim())
    );
  }

  function confirmDiscardExecutionDraft(message: string) {
    return (
      !hasUnsavedExecutionDraft() ||
      typeof window === "undefined" ||
      window.confirm(message)
    );
  }

  async function acknowledge() {
    if (busy || currentRevisionNo < 1) return;
    setBusy("acknowledge");
    setError("");
    setNotice("");
    try {
      const response = await apiFetch(EXECUTION_API, {
        method: "POST",
        body: JSON.stringify({
          siteId,
          action: "acknowledge",
          workflowId: workflow.id,
          publishedVersion: currentRevisionNo,
          operationId: createClientMutationOperationId("enterprise-workflow-acknowledge"),
        }),
      });
      const payload = (await response.json().catch(() => null)) as unknown;
      const normalized = normalizeMerchantEnterpriseWorkflowAcknowledgement(
        object(payload)?.acknowledgement,
      );
      if (!response.ok || object(payload)?.ok !== true || !normalized) {
        throw new Error(apiError(payload, "阅读确认失败，请稍后重试。"));
      }
      onAcknowledgement(normalized);
      setNotice(`已确认阅读 v${normalized.revisionNo}。`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "阅读确认失败，请稍后重试。");
      if (responseNeedsReload(caught)) await onReload();
    } finally {
      setBusy("");
    }
  }

  async function startExecution() {
    if (busy || !acknowledgedCurrent || (taskId && taskExecution)) return;
    if (
      selectedExecution &&
      !confirmDiscardExecutionDraft(
        "当前执行记录还有未保存的备注、凭证或反馈。继续开始新执行将放弃这些草稿，是否继续？",
      )
    ) {
      return;
    }
    setBusy("start");
    setError("");
    setNotice("");
    try {
      const response = await apiFetch(EXECUTION_API, {
        method: "POST",
        body: JSON.stringify({
          siteId,
          action: "start",
          workflowId: workflow.id,
          publishedVersion: currentRevisionNo,
          subject: subject.trim(),
          ...(taskId ? { taskId, generateChecklist } : {}),
          operationId: createClientMutationOperationId("enterprise-workflow-execution-start"),
        }),
      });
      const payload = (await response.json().catch(() => null)) as unknown;
      const execution = normalizeMerchantEnterpriseWorkflowExecution(object(payload)?.execution);
      const generatedChecklistCount = Number(
        object(payload)?.generatedChecklistCount ?? object(payload)?.generated_checklist_count ?? 0,
      );
      if (
        !response.ok ||
        object(payload)?.ok !== true ||
        !execution ||
        execution.siteId !== siteId ||
        execution.workflowId !== workflow.id ||
        (taskId && execution.taskId !== taskId)
      ) {
        throw new Error(apiError(payload, "开始执行失败，请稍后重试。"));
      }
      const next = upsertExecution(executions, execution);
      onExecutions(next);
      setSelectedExecutionId(execution.id);
      setSubject("");
      if (generatedChecklistCount > 0) {
        await Promise.resolve(onTaskChecklistGenerated?.(generatedChecklistCount));
      }
      setNotice(
        generatedChecklistCount > 0
          ? `已关联 v${execution.revisionNo}，并生成 ${generatedChecklistCount} 项任务清单。`
          : `已开始执行 v${execution.revisionNo}。`,
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "开始执行失败，请稍后重试。");
      await onReload();
    } finally {
      setBusy("");
    }
  }

  async function patchExecution(
    execution: MerchantEnterpriseWorkflowExecution,
    body: Record<string, unknown>,
    busyKey: string,
    success: string,
    beforePublish?: (updated: MerchantEnterpriseWorkflowExecution) => void,
  ) {
    if (busy) return;
    setBusy(busyKey);
    setError("");
    setNotice("");
    try {
      const response = await apiFetch(EXECUTION_API, {
        method: "PATCH",
        body: JSON.stringify({
          siteId,
          executionId: execution.id,
          version: execution.version,
          operationId: createClientMutationOperationId("enterprise-workflow-execution-update"),
          ...body,
        }),
      });
      const payload = (await response.json().catch(() => null)) as unknown;
      const updated = normalizeMerchantEnterpriseWorkflowExecution(object(payload)?.execution);
      if (
        !response.ok ||
        object(payload)?.ok !== true ||
        !updated ||
        updated.siteId !== siteId ||
        updated.id !== execution.id
      ) {
        throw new Error(apiError(payload, "执行记录保存失败，请稍后重试。"));
      }
      beforePublish?.(updated);
      onExecutions(upsertExecution(executions, updated));
      setNotice(success);
      return updated;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "执行记录保存失败，请稍后重试。");
      await onReload();
      return null;
    } finally {
      setBusy("");
    }
  }

  async function updateStepCompletion(
    execution: MerchantEnterpriseWorkflowExecution,
    stepId: string,
    completed: boolean,
  ) {
    await patchExecution(
      execution,
      { action: "step", stepId, completed },
      `step:${stepId}`,
      completed ? "步骤已完成。" : "步骤已重新打开。",
    );
  }

  async function saveStepDetail(
    execution: MerchantEnterpriseWorkflowExecution,
    stepId: string,
  ) {
    const step = execution.steps.find((item) => item.stepId === stepId);
    if (!step) return;
    const nextEvidence = evidenceFromDraft(
      evidenceLabels[stepId] ?? "",
      evidenceReferences[stepId] ?? "",
    );
    const evidence = nextEvidence ? [...step.evidence, nextEvidence] : step.evidence;
    if (evidence.length > 10) {
      setError("每个步骤最多保存 10 项凭证。");
      return;
    }
    const updated = await patchExecution(
      execution,
      { action: "step", stepId, note: stepNotes[stepId] ?? "", evidence },
      `step:${stepId}`,
      "步骤备注和凭证已保存。",
      (nextExecution) => {
        dirtyStepNoteIdsRef.current.delete(stepId);
        const savedStep = nextExecution.steps.find((item) => item.stepId === stepId);
        if (savedStep) {
          setStepNotes((current) => ({ ...current, [stepId]: savedStep.note }));
        }
      },
    );
    if (updated) {
      setEvidenceLabels((current) => ({ ...current, [stepId]: "" }));
      setEvidenceReferences((current) => ({ ...current, [stepId]: "" }));
    }
  }

  async function removeEvidence(
    execution: MerchantEnterpriseWorkflowExecution,
    stepId: string,
    index: number,
  ) {
    const step = execution.steps.find((item) => item.stepId === stepId);
    if (!step) return;
    await patchExecution(
      execution,
      { action: "step", stepId, evidence: step.evidence.filter((_, itemIndex) => itemIndex !== index) },
      `step:${stepId}`,
      "凭证已移除。",
    );
  }

  async function submitFeedback(execution: MerchantEnterpriseWorkflowExecution) {
    const rating = Number(feedbackRating);
    const normalizedText = feedbackText.trim();
    if ((!Number.isSafeInteger(rating) || rating < 1 || rating > 5) && !normalizedText) {
      setError("请选择评分或填写改进建议。");
      return;
    }
    await patchExecution(
      execution,
      {
        action: "feedback",
        ...(Number.isSafeInteger(rating) && rating >= 1 && rating <= 5 ? { rating } : {}),
        ...(normalizedText ? { text: normalizedText } : {}),
      },
      "feedback",
      "反馈已提交，管理者可以在执行统计中处理。",
      (nextExecution) => {
        feedbackDraftDirtyRef.current = false;
        setFeedbackRating(
          nextExecution.feedbackRating ? String(nextExecution.feedbackRating) : "",
        );
        setFeedbackText(nextExecution.feedbackText);
      },
    );
  }

  return (
    <section className="rounded-2xl border border-blue-200 bg-blue-50/50 p-4" data-workflow-employee-execution>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h4 className="font-semibold text-slate-950">阅读与执行</h4>
          <p className="mt-1 text-xs leading-5 text-slate-600">
            当前发布版 v{currentRevisionNo}。阅读确认与每次执行都固定到这个版本，后续更新不会改写既有记录。
          </p>
        </div>
        <button
          type="button"
          className="min-h-10 rounded-xl border border-blue-200 bg-white px-3 py-2 text-sm font-semibold text-blue-700 disabled:opacity-45"
          disabled={loading || Boolean(busy)}
          onClick={() => void onReload()}
        >
          {loading ? "刷新中…" : "刷新记录"}
        </button>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <div className={`rounded-xl border px-3 py-3 text-sm ${acknowledgedCurrent ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-800"}`}>
          {acknowledgedCurrent
            ? `已于 ${formatDate(acknowledgement?.acknowledgedAt ?? null)}确认阅读 v${currentRevisionNo}`
            : acknowledgement
              ? `你确认过 v${acknowledgement.revisionNo}，当前 v${currentRevisionNo} 需要重新阅读确认。`
              : "确认你已阅读并理解当前步骤后，才能开始执行。"}
        </div>
        {!acknowledgedCurrent ? (
          <button
            type="button"
            className="min-h-11 rounded-xl bg-blue-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-45"
            disabled={Boolean(busy) || loading}
            onClick={() => void acknowledge()}
          >
            {busy === "acknowledge" ? "确认中…" : `确认已阅读 v${currentRevisionNo}`}
          </button>
        ) : null}
      </div>

      {!taskExecution ? (
        <div className="mt-4 rounded-xl border border-blue-100 bg-white p-3">
          <label className="block text-xs font-medium text-slate-600">
            本次执行事项（可选）
            <input
              className="mt-1.5 min-h-11 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
              value={subject}
              maxLength={240}
              disabled={Boolean(busy)}
              placeholder={taskId ? "例如：按标准流程处理此任务" : "例如：处理今日闭店检查"}
              onChange={(event) => setSubject(event.target.value)}
            />
          </label>
          <button
            type="button"
            className="mt-3 min-h-11 rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-45"
            disabled={Boolean(busy) || loading || !acknowledgedCurrent}
            onClick={() => void startExecution()}
          >
            {busy === "start"
              ? "创建中…"
              : taskId && generateChecklist
                ? "关联流程并生成任务清单"
                : "开始一次执行"}
          </button>
          {!acknowledgedCurrent ? <p className="mt-2 text-xs text-amber-700">请先完成当前版本阅读确认。</p> : null}
        </div>
      ) : null}

      {!taskId && executions.length > 1 ? (
        <label className="mt-4 block text-xs font-medium text-slate-600">
          执行记录
          <select
            className="mt-1.5 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
            value={selectedExecution?.id ?? ""}
            disabled={Boolean(busy)}
            onChange={(event) => {
              const nextExecutionId = event.target.value;
              if (
                nextExecutionId !== selectedExecution?.id &&
                !confirmDiscardExecutionDraft(
                  "当前执行记录还有未保存的备注、凭证或反馈。切换记录将放弃这些草稿，是否继续？",
                )
              ) {
                return;
              }
              setSelectedExecutionId(nextExecutionId);
            }}
          >
            {executions.map((execution) => (
              <option key={execution.id} value={execution.id}>
                {execution.subject || `执行 v${execution.revisionNo}`} · {execution.status === "completed" ? "已完成" : `${execution.completedSteps}/${execution.totalSteps}`}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {selectedExecution ? (
        <article className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h5 className="font-semibold text-slate-950">{selectedExecution.subject || selectedExecution.workflowSnapshot.title}</h5>
              <p className="mt-1 text-xs text-slate-500">
                v{selectedExecution.revisionNo} · 开始于 {formatDate(selectedExecution.startedAt)}
                {selectedExecution.taskId ? " · 已关联任务" : ""}
              </p>
            </div>
            <span className={`rounded-full px-3 py-1 text-xs font-semibold ${selectedExecution.status === "completed" ? "bg-emerald-100 text-emerald-700" : "bg-blue-100 text-blue-700"}`}>
              {selectedExecution.status === "completed" ? "已完成" : `${selectedExecution.completedSteps}/${selectedExecution.totalSteps} 进行中`}
            </span>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100" aria-label="流程执行进度">
            <div className="h-full rounded-full bg-blue-600 transition-all" style={{ width: `${Math.round((selectedExecution.completedSteps / selectedExecution.totalSteps) * 100)}%` }} />
          </div>

          <ol className="mt-4 space-y-3">
            {selectedExecution.steps.map((step, index) => {
              const stepBusy = busy === `step:${step.stepId}`;
              return (
                <li key={step.stepId} className={`rounded-xl border p-3 ${step.completedAt ? "border-emerald-200 bg-emerald-50/40" : "border-slate-200"}`}>
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      className="mt-1 h-4 w-4"
                      checked={Boolean(step.completedAt)}
                      disabled={Boolean(busy)}
                      aria-label={`${step.completedAt ? "重新打开" : "完成"}步骤：${step.title}`}
                      onChange={(event) => void updateStepCompletion(selectedExecution, step.stepId, event.target.checked)}
                    />
                    <div className="min-w-0 flex-1">
                      <h6 className="text-sm font-semibold text-slate-900">{index + 1}. {step.title}</h6>
                      <p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-slate-600">{step.instruction}</p>
                    </div>
                  </div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <label className="block text-xs text-slate-600 sm:col-span-2">
                      执行备注
                      <textarea
                        className="mt-1 min-h-20 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                        value={stepNotes[step.stepId] ?? ""}
                        maxLength={2_000}
                        disabled={Boolean(busy)}
                        placeholder="记录异常、处理结果或需要交接的信息"
                        onChange={(event) => {
                          dirtyStepNoteIdsRef.current.add(step.stepId);
                          setStepNotes((current) => ({
                            ...current,
                            [step.stepId]: event.target.value,
                          }));
                        }}
                      />
                    </label>
                    <label className="block text-xs text-slate-600">
                      凭证名称
                      <input
                        className="mt-1 min-h-10 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                        value={evidenceLabels[step.stepId] ?? ""}
                        maxLength={160}
                        disabled={Boolean(busy)}
                        placeholder="例如：完成照片"
                        onChange={(event) => setEvidenceLabels((current) => ({ ...current, [step.stepId]: event.target.value }))}
                      />
                    </label>
                    <label className="block text-xs text-slate-600">
                      链接或文件编号
                      <input
                        className="mt-1 min-h-10 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                        value={evidenceReferences[step.stepId] ?? ""}
                        maxLength={1_000}
                        disabled={Boolean(busy)}
                        placeholder="https://… 或内部文件编号"
                        onChange={(event) => setEvidenceReferences((current) => ({ ...current, [step.stepId]: event.target.value }))}
                      />
                    </label>
                  </div>
                  {step.evidence.length > 0 ? (
                    <ul className="mt-3 space-y-1">
                      {step.evidence.map((item, evidenceIndex) => (
                        <li key={`${item.kind}:${item.reference}:${evidenceIndex}`} className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                          <span className="min-w-0 truncate">{item.label} · {item.reference}</span>
                          <button
                            type="button"
                            className="shrink-0 font-semibold text-rose-600 disabled:opacity-45"
                            disabled={Boolean(busy)}
                            onClick={() => void removeEvidence(selectedExecution, step.stepId, evidenceIndex)}
                          >
                            移除
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <button
                    type="button"
                    className="mt-3 min-h-10 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-700 disabled:opacity-45"
                    disabled={Boolean(busy)}
                    onClick={() => void saveStepDetail(selectedExecution, step.stepId)}
                  >
                    {stepBusy ? "保存中…" : "保存备注与凭证"}
                  </button>
                </li>
              );
            })}
          </ol>

          {selectedExecution.status === "completed" ? (
            <section className="mt-4 rounded-xl border border-violet-200 bg-violet-50/50 p-3">
              <h6 className="text-sm font-semibold text-slate-900">执行反馈</h6>
              <p className="mt-1 text-xs text-slate-600">对当前版本评分，并指出不清楚、难执行或需要改进的步骤。</p>
              <div className="mt-3 grid gap-2 sm:grid-cols-[140px_minmax(0,1fr)]">
                <label className="block text-xs text-slate-600">
                  评分
                  <select
                    className="mt-1 min-h-10 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
                    value={feedbackRating}
                    disabled={Boolean(busy)}
                    onChange={(event) => {
                      feedbackDraftDirtyRef.current = true;
                      setFeedbackRating(event.target.value);
                    }}
                  >
                    <option value="">暂不评分</option>
                    {[5, 4, 3, 2, 1].map((rating) => <option key={rating} value={rating}>{rating} 分</option>)}
                  </select>
                </label>
                <label className="block text-xs text-slate-600">
                  建议或问题
                  <textarea
                    className="mt-1 min-h-20 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
                    value={feedbackText}
                    maxLength={2_000}
                    disabled={Boolean(busy)}
                    onChange={(event) => {
                      feedbackDraftDirtyRef.current = true;
                      setFeedbackText(event.target.value);
                    }}
                  />
                </label>
              </div>
              <button
                type="button"
                className="mt-3 min-h-10 rounded-xl bg-violet-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-45"
                disabled={Boolean(busy) || (!feedbackRating && !feedbackText.trim())}
                onClick={() => void submitFeedback(selectedExecution)}
              >
                {busy === "feedback" ? "提交中…" : selectedExecution.feedbackStatus === "none" ? "提交反馈" : "更新反馈"}
              </button>
              {selectedExecution.feedbackStatus !== "none" ? (
                <div className={`mt-3 rounded-lg px-3 py-2 text-xs ${selectedExecution.feedbackStatus === "resolved" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-800"}`}>
                  {selectedExecution.feedbackStatus === "resolved"
                    ? `管理者已处理${selectedExecution.feedbackResolutionNote ? `：${selectedExecution.feedbackResolutionNote}` : "。"}`
                    : "反馈已提交，等待管理者处理。"}
                </div>
              ) : null}
            </section>
          ) : null}
        </article>
      ) : null}

      {error ? <div role="alert" className="mt-3 text-sm text-rose-700">{error}</div> : null}
      {notice ? <div role="status" className="mt-3 text-sm text-emerald-700">{notice}</div> : null}
    </section>
  );
}

function responseNeedsReload(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  return message.includes("重新加载") || message.includes("新版本");
}

function ManagerExecutionStats({
  siteId,
  apiFetch,
  stats,
  loading,
  onReload,
}: {
  siteId: string;
  apiFetch: EnterpriseWorkflowApiFetch;
  stats: MerchantEnterpriseWorkflowExecutionStats | null;
  loading: boolean;
  onReload: () => Promise<void>;
}) {
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [resolutionNotes, setResolutionNotes] = useState<Record<string, string>>({});

  async function resolveFeedback(feedback: MerchantEnterpriseWorkflowExecutionFeedback) {
    const executionVersion = Number(
      (feedback as MerchantEnterpriseWorkflowExecutionFeedback & { executionVersion?: number })
        .executionVersion,
    );
    if (!Number.isSafeInteger(executionVersion) || executionVersion < 1 || busyId) {
      setError("反馈记录版本不可用，请刷新统计后重试。");
      return;
    }
    setBusyId(feedback.executionId);
    setError("");
    setNotice("");
    try {
      const response = await apiFetch(EXECUTION_API, {
        method: "PATCH",
        body: JSON.stringify({
          siteId,
          action: "resolve_feedback",
          executionId: feedback.executionId,
          version: executionVersion,
          resolutionNote: (resolutionNotes[feedback.executionId] ?? "").trim(),
          operationId: createClientMutationOperationId("enterprise-workflow-feedback-resolve"),
        }),
      });
      const payload = (await response.json().catch(() => null)) as unknown;
      const resolution = normalizeMerchantEnterpriseWorkflowFeedbackResolution(
        object(payload)?.resolution,
      );
      if (
        !response.ok ||
        object(payload)?.ok !== true ||
        !resolution ||
        resolution.executionId !== feedback.executionId ||
        resolution.version <= executionVersion
      ) {
        throw new Error(apiError(payload, "反馈处理失败，请稍后重试。"));
      }
      setNotice("反馈已标记为处理完成。");
      await onReload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "反馈处理失败，请稍后重试。");
      await onReload();
    } finally {
      setBusyId("");
    }
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-slate-50 p-4" data-workflow-execution-stats>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h4 className="font-semibold text-slate-950">执行与培训统计</h4>
          <p className="mt-1 text-xs leading-5 text-slate-500">阅读覆盖、执行与评分按当前发布版本统计；待处理反馈汇总此流程的全部版本。</p>
        </div>
        <button
          type="button"
          className="min-h-10 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 disabled:opacity-45"
          disabled={loading || Boolean(busyId)}
          onClick={() => void onReload()}
        >
          {loading ? "统计中…" : "刷新统计"}
        </button>
      </div>

      {stats ? (
        <>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ["阅读覆盖", `${stats.acknowledgedEmployeeCount}/${stats.eligibleEmployeeCount}`],
              ["执行中", stats.inProgressCount],
              ["已完成", stats.completedCount],
              ["待处理反馈", stats.openFeedbackCount],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-xl border border-slate-200 bg-white p-3">
                <div className="text-xs text-slate-500">{label}</div>
                <div className="mt-1 text-xl font-bold text-slate-950">{value}</div>
              </div>
            ))}
          </div>

          <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500">
                <tr><th className="px-3 py-2">员工</th><th className="px-3 py-2">阅读确认</th><th className="px-3 py-2">执行</th><th className="px-3 py-2">最近活动</th></tr>
              </thead>
              <tbody>
                {stats.participants.map((participant) => (
                  <tr key={participant.employeeId} className="border-t border-slate-100">
                    <td className="px-3 py-2 font-medium text-slate-900">{participant.employeeName}</td>
                    <td className="px-3 py-2 text-slate-600">{participant.acknowledgedAt ? formatDate(participant.acknowledgedAt) : "未确认"}</td>
                    <td className="px-3 py-2 text-slate-600">{participant.completedCount}/{participant.executionCount} 完成</td>
                    <td className="px-3 py-2 text-slate-600">{formatDate(participant.lastActivityAt)}</td>
                  </tr>
                ))}
                {stats.participants.length === 0 ? <tr><td colSpan={4} className="px-3 py-8 text-center text-slate-500">暂无可统计员工。</td></tr> : null}
              </tbody>
            </table>
          </div>

          {stats.recentFeedback.length > 0 ? (
            <div className="mt-4 space-y-3">
              <h5 className="text-sm font-semibold text-slate-900">反馈处理队列（全部版本）</h5>
              {stats.recentFeedback.map((feedback) => (
                <article key={feedback.executionId} className="rounded-xl border border-slate-200 bg-white p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="text-sm font-semibold text-slate-900">{feedback.employeeName} · v{feedback.revisionNo}</div>
                      <div className="mt-1 text-xs text-slate-500">{feedback.rating ? `${feedback.rating} 分 · ` : ""}{formatDate(feedback.submittedAt)}</div>
                    </div>
                    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${feedback.status === "resolved" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-800"}`}>
                      {feedback.status === "resolved" ? "已处理" : "待处理"}
                    </span>
                  </div>
                  {feedback.text ? <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-700">{feedback.text}</p> : null}
                  {feedback.status === "resolved" ? (
                    feedback.resolutionNote ? <div className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700">处理说明：{feedback.resolutionNote}</div> : null
                  ) : (
                    <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                      <input
                        className="min-h-10 flex-1 rounded-xl border border-slate-300 px-3 py-2 text-sm"
                        value={resolutionNotes[feedback.executionId] ?? ""}
                        maxLength={2_000}
                        disabled={Boolean(busyId)}
                        placeholder="处理说明（可选）"
                        onChange={(event) => setResolutionNotes((current) => ({ ...current, [feedback.executionId]: event.target.value }))}
                      />
                      <button
                        type="button"
                        className="min-h-10 rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-45"
                        disabled={Boolean(busyId)}
                        onClick={() => void resolveFeedback(feedback)}
                      >
                        {busyId === feedback.executionId ? "处理中…" : "标记已处理"}
                      </button>
                    </div>
                  )}
                </article>
              ))}
            </div>
          ) : null}
        </>
      ) : (
        <div className="mt-4 rounded-xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500">{loading ? "正在汇总执行数据…" : "暂无执行统计。"}</div>
      )}
      {error ? <div role="alert" className="mt-3 text-sm text-rose-700">{error}</div> : null}
      {notice ? <div role="status" className="mt-3 text-sm text-emerald-700">{notice}</div> : null}
    </section>
  );
}

export default function EnterpriseWorkflowExecutionPanel({
  siteId,
  workflow,
  actor,
  apiFetch,
  taskId = null,
  generateChecklist = false,
  onTaskChecklistGenerated,
}: {
  siteId: string;
  workflow: EnterpriseWorkflow;
  actor: EnterpriseWorkflowActor;
  apiFetch: EnterpriseWorkflowApiFetch;
  taskId?: string | null;
  generateChecklist?: boolean;
  onTaskChecklistGenerated?: (count: number) => void | Promise<void>;
}) {
  const employee = actor.type === "employee";
  const manager = actor.type === "owner" || actor.permissions.includes("workflows.manage") || actor.permissions.includes("workflows.publish");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [currentRevisionNo, setCurrentRevisionNo] = useState(workflow.publishedVersion);
  const [acknowledgement, setAcknowledgement] = useState<MerchantEnterpriseWorkflowAcknowledgement | null>(null);
  const [executions, setExecutions] = useState<MerchantEnterpriseWorkflowExecution[]>([]);
  const [stats, setStats] = useState<MerchantEnterpriseWorkflowExecutionStats | null>(null);
  const loadEpochRef = useRef(0);
  const loadScope = [
    siteId,
    workflow.id,
    workflow.publishedVersion,
    actor.type,
    actor.id,
    employee ? "employee" : "",
    manager ? "manager" : "",
  ].join(":");
  const activeLoadScopeRef = useRef(loadScope);
  activeLoadScopeRef.current = loadScope;

  const load = useCallback(async () => {
    const requestEpoch = loadEpochRef.current + 1;
    loadEpochRef.current = requestEpoch;
    const isCurrentLoad = () =>
      loadEpochRef.current === requestEpoch && activeLoadScopeRef.current === loadScope;
    if (workflow.publishedVersion < 1) {
      if (isCurrentLoad()) setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const requests: Promise<void>[] = [];
      if (employee) {
        requests.push((async () => {
          const params = new URLSearchParams({ siteId, scope: "mine", workflowId: workflow.id });
          const response = await apiFetch(`${EXECUTION_API}?${params.toString()}`);
          if (!isCurrentLoad()) return;
          const payload = (await response.json().catch(() => null)) as unknown;
          if (!isCurrentLoad()) return;
          const normalized = normalizeEmployeeState(payload, siteId, workflow.id);
          if (!response.ok || !normalized) throw new Error(apiError(payload, "个人执行记录加载失败，请稍后重试。"));
          if (!isCurrentLoad()) return;
          setCurrentRevisionNo(normalized.currentRevisionNo);
          setAcknowledgement(normalized.acknowledgement);
          setExecutions(normalized.executions);
        })());
      }
      if (manager) {
        requests.push((async () => {
          const params = new URLSearchParams({ siteId, scope: "stats", workflowId: workflow.id });
          const response = await apiFetch(`${EXECUTION_API}?${params.toString()}`);
          if (!isCurrentLoad()) return;
          const payload = (await response.json().catch(() => null)) as unknown;
          if (!isCurrentLoad()) return;
          const normalized = normalizeMerchantEnterpriseWorkflowExecutionStats(object(payload)?.stats);
          if (!response.ok || object(payload)?.ok !== true || !normalized || normalized.workflowId !== workflow.id) {
            throw new Error(apiError(payload, "执行统计加载失败，请稍后重试。"));
          }
          if (!isCurrentLoad()) return;
          setStats(normalized);
        })());
      }
      await Promise.all(requests);
    } catch (caught) {
      if (isCurrentLoad()) {
        setError(caught instanceof Error ? caught.message : "流程执行数据加载失败，请稍后重试。");
      }
    } finally {
      if (isCurrentLoad()) setLoading(false);
    }
  }, [apiFetch, employee, loadScope, manager, siteId, workflow.id, workflow.publishedVersion]);

  useEffect(() => {
    setCurrentRevisionNo(workflow.publishedVersion);
    setAcknowledgement(null);
    setExecutions([]);
    setStats(null);
    void load();
    return () => {
      loadEpochRef.current += 1;
    };
  }, [load, loadScope, workflow.id, workflow.publishedVersion]);

  if (workflow.publishedVersion < 1 || workflow.status === "archived") return null;

  return (
    <div className="space-y-4" data-workflow-execution-center>
      {workflow.hasUnpublishedChanges ? (
        <div
          className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800"
          data-workflow-published-version-notice
        >
          当前还有未发布草稿；员工阅读、执行和管理统计仍基于已发布版本 v
          {workflow.publishedVersion}，草稿发布后才会生效。
        </div>
      ) : null}
      {employee ? (
        <EmployeeExecutionWorkspace
          siteId={siteId}
          workflow={workflow}
          apiFetch={apiFetch}
          acknowledgement={acknowledgement}
          currentRevisionNo={currentRevisionNo}
          executions={executions}
          loading={loading}
          onReload={load}
          onAcknowledgement={setAcknowledgement}
          onExecutions={setExecutions}
          taskId={taskId}
          generateChecklist={generateChecklist}
          onTaskChecklistGenerated={onTaskChecklistGenerated}
        />
      ) : null}
      {manager && !taskId ? (
        <ManagerExecutionStats
          siteId={siteId}
          apiFetch={apiFetch}
          stats={stats}
          loading={loading}
          onReload={load}
        />
      ) : null}
      {error ? <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div> : null}
    </div>
  );
}
