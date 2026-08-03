"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { MerchantTask } from "@/lib/merchantEnterprise";
import {
  normalizeMerchantEnterprisePublishedWorkflowChoice,
  type MerchantEnterprisePublishedWorkflowChoice,
} from "@/lib/merchantEnterprisePublishedWorkflows";
import {
  normalizeMerchantTaskWorkflowBinding,
  type MerchantTaskWorkflowBinding,
} from "@/lib/merchantTaskWorkflow";
import { createClientMutationOperationId } from "@/lib/mutationOperationId";
import type { EnterpriseWorkflowApiFetch } from "@/app/enterprise/[siteId]/EnterpriseWorkflowsPanel";

const PUBLISHED_WORKFLOWS_API = "/api/merchant-enterprise/published-workflows";
const TASK_WORKFLOW_API = "/api/merchant-enterprise/task-workflow";

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function apiError(payload: unknown, fallback: string) {
  const code = text(object(payload)?.error, 160);
  if (code === "permission_denied" || code === "merchant_access_denied") {
    return "当前账号没有将工作流程应用到此任务的权限。";
  }
  if (code === "task_not_found") return "任务不存在或当前账号无权查看。";
  if (code === "workflow_not_found" || code === "workflow_not_published") {
    return "所选工作流程已下线或不再是已发布状态，请重新选择。";
  }
  if (code === "workflow_revision_changed") {
    return "所选流程刚刚发布了新版本，请重新确认后再关联。";
  }
  if (
    code === "task_workflow_already_bound" ||
    code === "task_workflow_checklist_source_exists" ||
    code === "workflow_task_execution_exists"
  ) {
    return "该任务已经关联或生成过工作流程清单，不能重复关联或静默替换。";
  }
  if (code === "task_checklist_limit_reached") {
    return "应用后会超过任务清单 100 项上限，请先精简现有清单。";
  }
  if (code === "invalid_task_archived") return "已归档任务不能再关联工作流程。";
  if (code === "enterprise_version_conflict") {
    return "任务或流程已被其他成员更新，请刷新后再操作。";
  }
  return fallback;
}

function formatDate(value: string) {
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

export default function MerchantTaskWorkflowBindingCard({
  task,
  apiFetch,
  canBind,
  onChecklistChanged,
}: {
  task: MerchantTask;
  apiFetch: EnterpriseWorkflowApiFetch;
  canBind: boolean;
  onChecklistChanged: () => void | Promise<void>;
}) {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [binding, setBinding] = useState<MerchantTaskWorkflowBinding | null>(null);
  const [choices, setChoices] = useState<MerchantEnterprisePublishedWorkflowChoice[]>([]);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState("");

  const selectedChoice = useMemo(
    () => choices.find((choice) => choice.id === selectedWorkflowId) ?? choices[0] ?? null,
    [choices, selectedWorkflowId],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const bindingParams = new URLSearchParams({ siteId: task.siteId, taskId: task.id });
      const bindingResponse = await apiFetch(`${TASK_WORKFLOW_API}?${bindingParams.toString()}`);
      const bindingPayload = (await bindingResponse.json().catch(() => null)) as unknown;
      const bindingBody = object(bindingPayload);
      if (!bindingResponse.ok || bindingBody?.ok !== true) {
        throw new Error(apiError(bindingPayload, "任务工作流程加载失败，请稍后重试。"));
      }
      const nextBinding = bindingBody.binding
        ? normalizeMerchantTaskWorkflowBinding(bindingBody.binding)
        : null;
      if (
        bindingBody.binding &&
        (!nextBinding || nextBinding.siteId !== task.siteId || nextBinding.taskId !== task.id)
      ) {
        throw new Error("任务工作流程数据无法验证，请稍后重试。");
      }
      setBinding(nextBinding);
      if (nextBinding || !canBind || task.archivedAt) {
        setChoices([]);
        return nextBinding;
      }
      const choiceParams = new URLSearchParams({ siteId: task.siteId });
      const choiceResponse = await apiFetch(`${PUBLISHED_WORKFLOWS_API}?${choiceParams.toString()}`);
      const choicePayload = (await choiceResponse.json().catch(() => null)) as unknown;
      const choiceBody = object(choicePayload);
      const nextChoices = (Array.isArray(choiceBody?.choices) ? choiceBody.choices : [])
        .map(normalizeMerchantEnterprisePublishedWorkflowChoice)
        .filter((choice): choice is MerchantEnterprisePublishedWorkflowChoice => Boolean(choice));
      if (!choiceResponse.ok || choiceBody?.ok !== true) {
        throw new Error(apiError(choicePayload, "已发布工作流程加载失败，请稍后重试。"));
      }
      setChoices(nextChoices);
      setSelectedWorkflowId((current) =>
        nextChoices.some((choice) => choice.id === current) ? current : nextChoices[0]?.id ?? "",
      );
      return null;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "任务工作流程加载失败，请稍后重试。");
      return undefined;
    } finally {
      setLoading(false);
    }
  }, [apiFetch, canBind, task.archivedAt, task.id, task.siteId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function bindWorkflow() {
    if (!selectedChoice || busy || task.archivedAt) return;
    if (
      typeof window !== "undefined" &&
      !window.confirm(
        `确认将“${selectedChoice.title}”v${selectedChoice.revisionNo} 应用到此任务？将保留现有清单，并在末尾追加 ${selectedChoice.stepCount} 项；后续流程发版不会自动改写本任务。`,
      )
    ) {
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await apiFetch(TASK_WORKFLOW_API, {
        method: "POST",
        body: JSON.stringify({
          siteId: task.siteId,
          taskId: task.id,
          workflowId: selectedChoice.id,
          expectedTaskVersion: task.version,
          expectedRevisionId: selectedChoice.revisionId,
          operationId: createClientMutationOperationId("enterprise-task-workflow-bind"),
        }),
      });
      const payload = (await response.json().catch(() => null)) as unknown;
      const normalized = normalizeMerchantTaskWorkflowBinding(object(payload)?.binding);
      if (
        !response.ok ||
        object(payload)?.ok !== true ||
        !normalized ||
        normalized.siteId !== task.siteId ||
        normalized.taskId !== task.id
      ) {
        throw new Error(apiError(payload, "工作流程应用失败，请稍后重试。"));
      }
      setBinding(normalized);
      setChoices([]);
      setNotice(`已固定“${normalized.title}”v${normalized.revisionNo}，并生成 ${normalized.generatedChecklistCount} 项任务清单。`);
      await Promise.resolve(onChecklistChanged());
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "工作流程应用失败，请稍后重试。";
      const recovered = await load();
      if (recovered) {
        setNotice(
          `已确认“${recovered.title}”v${recovered.revisionNo} 已关联，并生成 ${recovered.generatedChecklistCount} 项任务清单。`,
        );
        await Promise.resolve(onChecklistChanged());
      } else {
        setError(message);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border border-cyan-200 bg-cyan-50/60 p-4" data-enterprise-task-workflow>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-slate-900">执行标准工作流程</h3>
          <p className="mt-1 text-xs leading-5 text-slate-600">
            将已发布 SOP 固定到任务，并从不可变发布版本生成可勾选清单。
          </p>
        </div>
        <button
          type="button"
          className="min-h-10 rounded-xl border border-cyan-300 bg-white px-3 py-2 text-sm font-semibold text-cyan-800 disabled:opacity-45"
          disabled={loading || busy}
          onClick={() => void load()}
        >
          {loading ? "刷新中…" : "刷新"}
        </button>
      </div>

      {binding ? (
        <div className="mt-4 rounded-xl border border-cyan-200 bg-white p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h4 className="font-semibold text-slate-950">{binding.title}</h4>
              <p className="mt-1 text-xs text-slate-500">v{binding.revisionNo} · {binding.generatedChecklistCount} 步 · 关联于 {formatDate(binding.boundAt)}</p>
            </div>
            <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-700">版本已固定</span>
          </div>
          <p className="mt-3 text-sm leading-6 text-slate-700">{binding.scenario}</p>
          <details className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
            <summary className="cursor-pointer text-sm font-semibold text-slate-700">查看关联时的完整步骤</summary>
            <ol className="mt-3 space-y-2">
              {binding.steps.map((step, index) => (
                <li key={step.id} className="rounded-lg bg-white px-3 py-2 text-sm">
                  <div className="font-semibold text-slate-900">{index + 1}. {step.title}</div>
                  <p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-slate-600">{step.instruction}</p>
                </li>
              ))}
            </ol>
          </details>
          <p className="mt-3 text-xs leading-5 text-slate-500">后续工作流程发布新版本不会改变本任务；员工按下方任务清单执行并留痕。</p>
        </div>
      ) : canBind && !task.archivedAt ? (
        <div className="mt-4 rounded-xl border border-cyan-200 bg-white p-4">
          {choices.length > 0 ? (
            <>
              <label className="block text-xs font-medium text-slate-600">
                选择已发布流程
                <select
                  className="mt-1.5 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
                  value={selectedChoice?.id ?? ""}
                  disabled={busy}
                  onChange={(event) => setSelectedWorkflowId(event.target.value)}
                >
                  {choices.map((choice) => (
                    <option key={choice.id} value={choice.id}>{choice.title} · v{choice.revisionNo} · {choice.stepCount} 步</option>
                  ))}
                </select>
              </label>
              {selectedChoice ? <p className="mt-2 text-xs leading-5 text-slate-600">适用场景：{selectedChoice.scenario}</p> : null}
              <div className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
                会保留已有清单并追加 {selectedChoice?.stepCount ?? 0} 项。本任务将固定所选版本，不能静默换版。
              </div>
              <button
                type="button"
                className="mt-3 min-h-11 rounded-xl bg-cyan-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-45"
                disabled={busy || !selectedChoice}
                onClick={() => void bindWorkflow()}
              >
                {busy ? "应用中…" : "应用流程并生成清单"}
              </button>
            </>
          ) : loading ? null : (
            <div className="rounded-lg border border-dashed border-slate-300 px-3 py-6 text-center text-sm text-slate-500">暂无可用的已发布工作流程。</div>
          )}
        </div>
      ) : (
        <div className="mt-4 rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-600">
          {task.archivedAt ? "已归档任务不能再关联工作流程。" : "当前账号可查看任务，但没有应用工作流程的权限。"}
        </div>
      )}

      {error ? <div role="alert" className="mt-3 text-sm text-rose-700">{error}</div> : null}
      {notice ? <div role="status" className="mt-3 text-sm text-emerald-700">{notice}</div> : null}
    </section>
  );
}
