"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  hasMerchantEnterprisePermission,
  type MerchantEnterpriseActor,
  type MerchantEnterpriseSnapshot,
  type MerchantTaskPriority,
} from "@/lib/merchantEnterprise";
import {
  MAX_MERCHANT_ENTERPRISE_AUTOMATION_DUE_OFFSET_MINUTES,
  hasOnlyMerchantEnterpriseAutomationTemplateTokens,
  normalizeMerchantEnterpriseAutomationRule,
  normalizeMerchantEnterpriseAutomationRun,
  type MerchantEnterpriseAutomationEditableRuleStatus,
  type MerchantEnterpriseAutomationEventType,
  type MerchantEnterpriseAutomationRule,
  type MerchantEnterpriseAutomationRun,
  type MerchantEnterpriseAutomationSourceAvailabilityMap,
  type MerchantEnterpriseAutomationSourceType,
} from "@/lib/merchantEnterpriseAutomation";
import {
  normalizeMerchantEnterprisePublishedWorkflowChoice,
  type MerchantEnterprisePublishedWorkflowChoice,
} from "@/lib/merchantEnterprisePublishedWorkflows";
import { createClientMutationOperationId } from "@/lib/mutationOperationId";

const AUTOMATION_API = "/api/merchant-enterprise/workflow-automations";
const PUBLISHED_WORKFLOWS_API = "/api/merchant-enterprise/published-workflows";

type AutomationSource = MerchantEnterpriseAutomationSourceType;
type AutomationEvent = MerchantEnterpriseAutomationEventType;
type AutomationStatus = MerchantEnterpriseAutomationEditableRuleStatus;
type SourceAvailability = MerchantEnterpriseAutomationSourceAvailabilityMap;
type AutomationRule = MerchantEnterpriseAutomationRule;
type AutomationRun = MerchantEnterpriseAutomationRun;

type AutomationDraft = {
  ruleId: string | null;
  expectedVersion: number | null;
  name: string;
  sourceType: AutomationSource;
  eventType: AutomationEvent;
  fromStatus: string;
  toStatus: string;
  boardId: string;
  columnId: string;
  workflowId: string;
  workflowRevisionId: string;
  taskTitle: string;
  taskDescription: string;
  priority: MerchantTaskPriority;
  dueOffsetMinutes: string;
  status: AutomationStatus;
  assigneeIds: string[];
};

export type MerchantEnterpriseAutomationManagerProps = {
  siteId: string;
  actor: MerchantEnterpriseActor;
  snapshot: MerchantEnterpriseSnapshot;
  apiFetch: (path: string, init?: RequestInit) => Promise<Response>;
  onOpenTask?: (taskId: string) => void;
  onDirtyChange?: (dirty: boolean) => void;
};

const SOURCE_LABELS: Record<AutomationSource, string> = {
  order: "订单",
  booking: "预约",
};
const AUTOMATION_AUTO_PAUSE_ERROR_CODES = new Set([
  "automation_target_unavailable",
  "automation_workflow_unavailable",
  "automation_assignee_unavailable",
]);
const AUTOMATION_RUN_ERROR_LABELS: Readonly<Record<string, string>> = {
  automation_rule_not_matched: "触发条件未匹配",
  automation_target_unavailable: "目标看板/工作列不可用",
  automation_workflow_unavailable: "工作流程不可用",
  automation_assignee_unavailable: "负责人权限已失效",
  automation_execution_failed: "执行失败",
};

const SOURCE_STATUSES: Record<AutomationSource, ReadonlyArray<{ value: string; label: string }>> = {
  order: [
    { value: "pending", label: "待处理" },
    { value: "confirmed", label: "已确认" },
    { value: "completed", label: "已完成" },
    { value: "cancelled", label: "已取消" },
  ],
  booking: [
    { value: "active", label: "待确认" },
    { value: "confirmed", label: "已确认" },
    { value: "completed", label: "已完成" },
    { value: "no_show", label: "未到店" },
    { value: "cancelled", label: "已取消" },
  ],
};

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown, maximum = 5000) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function normalizeAvailability(value: unknown): SourceAvailability {
  const record = object(value);
  return {
    order: record?.order === "active" ? "active" : "inactive",
    booking: record?.booking === "active" ? "active" : "inactive",
  };
}

function dateTime(value: string) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp)
    ? new Intl.DateTimeFormat("zh-CN", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(timestamp)
    : "—";
}

function automationRunErrorLabel(errorCode: string) {
  return errorCode ? AUTOMATION_RUN_ERROR_LABELS[errorCode] || "执行失败" : "";
}

function apiError(payload: unknown, fallback: string) {
  const code = text(object(payload)?.error, 100);
  if (code === "source_event_stream_unavailable") return "当前来源的事件接入尚未启用，规则只能先保存为暂停。";
  if (code === "automation_rule_limit_reached") return "企业最多可创建 100 条自动化规则，请先合并现有规则或清理不再使用的规则。";
  if (code === "automation_active_rule_limit_reached") return "同类来源和触发时机最多启用 20 条规则，请先暂停或合并现有规则。";
  if (code === "workflow_revision_changed" || code === "workflow_not_published") return "工作流程已发布新版本，请选择最新版后重新保存。";
  if (code === "automation_target_unavailable") return "目标看板或工作列已不可用，请重新选择。";
  if (code === "automation_assignee_unavailable") return "负责人已停用或无权访问目标看板，请重新选择。";
  if (code === "automation_rule_archived") return "这条自动化规则已归档，请刷新列表后再操作。";
  if (code === "enterprise_version_conflict") return "规则已被其他账号更新，请刷新后重试。";
  if (code === "permission_denied" || code === "merchant_access_denied") return "当前账号没有管理此自动化规则的权限。";
  return fallback;
}

function blankDraft(input: {
  boardId?: string;
  columnId?: string;
  workflow?: MerchantEnterprisePublishedWorkflowChoice | null;
} = {}): AutomationDraft {
  return {
    ruleId: null,
    expectedVersion: null,
    name: "",
    sourceType: "order",
    eventType: "created",
    fromStatus: "",
    toStatus: "",
    boardId: input.boardId ?? "",
    columnId: input.columnId ?? "",
    workflowId: input.workflow?.id ?? "",
    workflowRevisionId: input.workflow?.revisionId ?? "",
    taskTitle: "处理订单事件 {eventRef}",
    taskDescription: "",
    priority: "normal",
    dueOffsetMinutes: "",
    status: "paused",
    assigneeIds: [],
  };
}

function draftFromRule(rule: AutomationRule): AutomationDraft {
  return {
    ruleId: rule.id,
    expectedVersion: rule.version,
    name: rule.name,
    sourceType: rule.sourceType,
    eventType: rule.eventType,
    fromStatus: rule.fromStatus ?? "",
    toStatus: rule.toStatus ?? "",
    boardId: rule.boardId,
    columnId: rule.columnId,
    workflowId: rule.workflowId,
    workflowRevisionId: rule.workflowRevisionId,
    taskTitle: rule.taskTitle,
    taskDescription: rule.taskDescription,
    priority: rule.priority,
    dueOffsetMinutes: rule.dueOffsetMinutes === null ? "" : String(rule.dueOffsetMinutes),
    status: rule.status === "active" ? "active" : "paused",
    assigneeIds: [...rule.assigneeIds],
  };
}

function draftSignature(draft: AutomationDraft | null) {
  return draft
    ? JSON.stringify({ ...draft, assigneeIds: [...draft.assigneeIds].sort() })
    : "";
}

export default function MerchantEnterpriseAutomationManager({
  siteId,
  actor,
  snapshot,
  apiFetch,
  onOpenTask,
  onDirtyChange,
}: MerchantEnterpriseAutomationManagerProps) {
  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [runs, setRuns] = useState<AutomationRun[]>([]);
  const [availability, setAvailability] = useState<SourceAvailability>({ order: "inactive", booking: "inactive" });
  const [workflows, setWorkflows] = useState<MerchantEnterprisePublishedWorkflowChoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [draft, setDraft] = useState<AutomationDraft | null>(null);
  const [baseline, setBaseline] = useState("");
  const loadSequenceRef = useRef(0);
  const mutationRef = useRef<{ signature: string; operationId: string } | null>(null);
  const archiveMutationRef = useRef<{ signature: string; operationId: string } | null>(null);

  const canManage = hasMerchantEnterprisePermission(actor, "automations.manage");
  const boards = useMemo(
    () => snapshot.boards.filter((board) => board.status === "active"),
    [snapshot.boards],
  );
  const columns = useMemo(
    () => snapshot.columns.filter((column) => column.status === "active" && !column.isDone),
    [snapshot.columns],
  );
  const rolesById = useMemo(
    () => new Map(snapshot.roles.map((role) => [role.id, role] as const)),
    [snapshot.roles],
  );
  const eligibleEmployees = useMemo(
    () => snapshot.employees.filter((employee) => {
      if (employee.status !== "active" || !draft?.boardId) return false;
      const role = rolesById.get(employee.roleId);
      return Boolean(
        role &&
          role.status === "active" &&
          role.permissions.includes("tasks.view") &&
          (role.accessScope === "all" || role.allowedBoardIds.includes(draft.boardId)),
      );
    }),
    [draft?.boardId, rolesById, snapshot.employees],
  );
  const invalidSelectedAssignees = useMemo(
    () => {
      const eligibleIds = new Set(eligibleEmployees.map((employee) => employee.id));
      return (draft?.assigneeIds ?? [])
        .filter((id) => !eligibleIds.has(id))
        .map((id) => ({
          id,
          label:
            snapshot.employees.find((employee) => employee.id === id)?.displayName ||
            `未知员工（${id.slice(0, 8)}…）`,
        }));
    },
    [draft?.assigneeIds, eligibleEmployees, snapshot.employees],
  );
  const draftIsDirty = Boolean(draft && draftSignature(draft) !== baseline);

  useEffect(() => {
    onDirtyChange?.(draftIsDirty);
  }, [draftIsDirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

  const load = useCallback(async (preserveDraft = false) => {
    const sequence = ++loadSequenceRef.current;
    setLoading(true);
    setError("");
    try {
      const [automationResponse, workflowResponse] = await Promise.all([
        apiFetch(`${AUTOMATION_API}?siteId=${encodeURIComponent(siteId)}`),
        apiFetch(`${PUBLISHED_WORKFLOWS_API}?siteId=${encodeURIComponent(siteId)}`),
      ]);
      const [automationPayload, workflowPayload] = await Promise.all([
        automationResponse.json().catch(() => null),
        workflowResponse.json().catch(() => null),
      ]);
      if (!automationResponse.ok || object(automationPayload)?.ok !== true) {
        throw new Error(apiError(automationPayload, "自动化规则加载失败，请稍后重试。"));
      }
      if (!workflowResponse.ok || object(workflowPayload)?.ok !== true) {
        throw new Error(apiError(workflowPayload, "已发布工作流程加载失败，请稍后重试。"));
      }
      const nextRules = (Array.isArray(object(automationPayload)?.rules) ? object(automationPayload)?.rules as unknown[] : [])
        .map(normalizeMerchantEnterpriseAutomationRule)
        .filter((rule): rule is AutomationRule => Boolean(rule && rule.siteId === siteId));
      const nextRuns = (Array.isArray(object(automationPayload)?.runs) ? object(automationPayload)?.runs as unknown[] : [])
        .map(normalizeMerchantEnterpriseAutomationRun)
        .filter((run): run is AutomationRun => Boolean(run && run.siteId === siteId));
      const nextWorkflows = (Array.isArray(object(workflowPayload)?.choices) ? object(workflowPayload)?.choices as unknown[] : [])
        .map(normalizeMerchantEnterprisePublishedWorkflowChoice)
        .filter((choice): choice is MerchantEnterprisePublishedWorkflowChoice => Boolean(choice));
      if (sequence !== loadSequenceRef.current) return;
      setRules(nextRules);
      setRuns(nextRuns);
      setAvailability(normalizeAvailability(object(automationPayload)?.sourceAvailability));
      setWorkflows(nextWorkflows);
      if (!preserveDraft) {
        setDraft(null);
        setBaseline("");
      }
    } catch (caught) {
      if (sequence !== loadSequenceRef.current) return;
      setError(caught instanceof Error ? caught.message : "自动化规则加载失败，请稍后重试。");
    } finally {
      if (sequence === loadSequenceRef.current) setLoading(false);
    }
  }, [apiFetch, siteId]);

  useEffect(() => {
    void load();
    return () => {
      loadSequenceRef.current += 1;
    };
  }, [load]);

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== "visible" || draftIsDirty || busy) return;
      void load(Boolean(draft));
    };
    const interval = window.setInterval(refresh, 30_000);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
    };
  }, [busy, draft, draftIsDirty, load]);

  function startCreate() {
    if (!canManage) return;
    if (draftIsDirty && !window.confirm("当前规则有尚未保存的修改，确定放弃吗？")) return;
    const board = boards[0];
    const column = columns.find((item) => item.boardId === board?.id);
    const next = blankDraft({ boardId: board?.id, columnId: column?.id, workflow: workflows[0] });
    setDraft(next);
    setBaseline(draftSignature(next));
    setError("");
    setNotice("");
  }

  function startEdit(rule: AutomationRule) {
    if (draftIsDirty && !window.confirm("当前规则有尚未保存的修改，确定放弃吗？")) return;
    const next = draftFromRule(rule);
    setDraft(next);
    setBaseline(draftSignature(next));
    setError("");
    setNotice("");
  }

  function updateDraft(patch: Partial<AutomationDraft>) {
    setDraft((current) => current ? { ...current, ...patch } : current);
  }

  function changeSource(nextSource: AutomationSource) {
    if (!draft) return;
    updateDraft({
      sourceType: nextSource,
      fromStatus: "",
      toStatus: "",
      taskTitle:
        draft.taskTitle === "处理订单事件 {eventRef}" ||
        draft.taskTitle === "跟进预约事件 {eventRef}"
          ? nextSource === "order"
            ? "处理订单事件 {eventRef}"
            : "跟进预约事件 {eventRef}"
        : draft.taskTitle,
      ...(availability[nextSource] === "inactive" ? { status: "paused" as const } : {}),
    });
  }

  function selectWorkflow(workflowId: string) {
    const workflow = workflows.find((item) => item.id === workflowId);
    updateDraft({
      workflowId,
      workflowRevisionId: workflow?.revisionId ?? "",
    });
  }

  async function saveDraft() {
    if (!draft || busy || !canManage) return;
    const dueOffsetMinutes = draft.dueOffsetMinutes.trim()
      ? Number(draft.dueOffsetMinutes)
      : null;
    if (!draft.name.trim() || !draft.taskTitle.trim()) {
      setError("请填写规则名称和自动创建的任务标题。");
      return;
    }
    if (
      !hasOnlyMerchantEnterpriseAutomationTemplateTokens(draft.taskTitle) ||
      !hasOnlyMerchantEnterpriseAutomationTemplateTokens(draft.taskDescription)
    ) {
      setError("任务模板只能使用 {eventRef}、{fromStatus}、{toStatus} 三个安全占位符。");
      return;
    }
    if (!draft.boardId || !draft.columnId || !draft.workflowId || !draft.workflowRevisionId) {
      setError("请选择目标看板、工作列和已发布工作流程。");
      return;
    }
    if (!columns.some((column) => column.id === draft.columnId && column.boardId === draft.boardId)) {
      setError("初始工作列必须是当前看板中仍在使用的未完成列，请重新选择。");
      return;
    }
    if (invalidSelectedAssignees.length > 0) {
      setError(`以下负责人已停用或无权访问目标看板，请先移除：${invalidSelectedAssignees.map((employee) => employee.label).join("、")}`);
      return;
    }
    if (draft.eventType === "status_changed" && !draft.toStatus) {
      setError("状态变化规则必须选择目标状态。");
      return;
    }
    if (
      dueOffsetMinutes !== null &&
      (!Number.isSafeInteger(dueOffsetMinutes) ||
        dueOffsetMinutes < 0 ||
        dueOffsetMinutes > MAX_MERCHANT_ENTERPRISE_AUTOMATION_DUE_OFFSET_MINUTES)
    ) {
      setError(
        `截止时间偏移需为 0 到 ${MAX_MERCHANT_ENTERPRISE_AUTOMATION_DUE_OFFSET_MINUTES} 分钟之间的整数。`,
      );
      return;
    }
    if (draft.status === "active" && availability[draft.sourceType] !== "active") {
      setError("当前来源的事件接入尚未启用，请先保存为暂停规则。");
      return;
    }
    const body = {
      siteId,
      name: draft.name.trim(),
      sourceType: draft.sourceType,
      eventType: draft.eventType,
      ...(draft.eventType === "status_changed"
        ? { fromStatus: draft.fromStatus || null, toStatus: draft.toStatus }
        : {}),
      boardId: draft.boardId,
      columnId: draft.columnId,
      workflowId: draft.workflowId,
      workflowRevisionId: draft.workflowRevisionId,
      taskTitle: draft.taskTitle.trim(),
      taskDescription: draft.taskDescription.trim(),
      priority: draft.priority,
      dueOffsetMinutes,
      status: draft.status,
      assigneeIds: draft.assigneeIds,
      ...(draft.ruleId
        ? { ruleId: draft.ruleId, expectedVersion: draft.expectedVersion }
        : {}),
    };
    const signature = JSON.stringify(body);
    if (mutationRef.current?.signature !== signature) {
      mutationRef.current = {
        signature,
        operationId: createClientMutationOperationId("enterprise-automation"),
      };
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await apiFetch(AUTOMATION_API, {
        method: draft.ruleId ? "PATCH" : "POST",
        body: JSON.stringify({ ...body, operationId: mutationRef.current.operationId }),
      });
      const payload = await response.json().catch(() => null);
      if (
        !response.ok ||
        object(payload)?.ok !== true ||
        !normalizeMerchantEnterpriseAutomationRule(object(payload)?.rule)
      ) {
        const responseAvailability = object(payload)?.sourceAvailability;
        if (responseAvailability) setAvailability(normalizeAvailability(responseAvailability));
        throw new Error(apiError(payload, "自动化规则保存失败，请稍后重试。"));
      }
      mutationRef.current = null;
      setNotice(draft.ruleId ? "自动化规则已更新。" : "自动化规则已创建。待新业务事件到达后会按规则执行。");
      setDraft(null);
      setBaseline("");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "自动化规则保存失败，请稍后重试。");
    } finally {
      setBusy(false);
    }
  }

  async function archiveRule(rule: AutomationRule) {
    if (busy || !canManage || rule.status === "archived") return;
    const editingThisRule = draft?.ruleId === rule.id;
    const discardCopy = editingThisRule && draftIsDirty
      ? " 当前正在编辑的未保存修改也会被放弃。"
      : "";
    if (
      !window.confirm(
        `归档规则“${rule.name}”？归档后不再触发新任务，已有运行记录和审计记录会保留。${discardCopy}`,
      )
    ) {
      return;
    }
    const signature = `${rule.id}:${rule.version}`;
    if (archiveMutationRef.current?.signature !== signature) {
      archiveMutationRef.current = {
        signature,
        operationId: createClientMutationOperationId("enterprise-automation-archive"),
      };
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await apiFetch(AUTOMATION_API, {
        method: "PATCH",
        body: JSON.stringify({
          siteId,
          action: "archive",
          ruleId: rule.id,
          expectedVersion: rule.version,
          operationId: archiveMutationRef.current.operationId,
        }),
      });
      const payload = await response.json().catch(() => null);
      const archivedRule = normalizeMerchantEnterpriseAutomationRule(
        object(payload)?.rule,
      );
      if (
        !response.ok ||
        object(payload)?.ok !== true ||
        !archivedRule ||
        archivedRule.status !== "archived" ||
        !archivedRule.archivedAt
      ) {
        throw new Error(apiError(payload, "自动化规则归档失败，请稍后重试。"));
      }
      archiveMutationRef.current = null;
      setRules((current) => current.filter((candidate) => candidate.id !== rule.id));
      if (editingThisRule) {
        setDraft(null);
        setBaseline("");
      }
      setNotice("自动化规则已归档；已有运行记录和审计记录会继续保留。");
      await load(Boolean(draft && !editingThisRule));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "自动化规则归档失败，请稍后重试。");
    } finally {
      setBusy(false);
    }
  }

  const selectedBoardColumns = draft
    ? columns.filter((column) => column.boardId === draft.boardId)
    : [];
  const selectedWorkflow = draft
    ? workflows.find((workflow) => workflow.id === draft.workflowId) ?? null
    : null;
  const selectedRule = draft?.ruleId
    ? rules.find((rule) => rule.id === draft.ruleId) ?? null
    : null;
  const revisionUpgradeAvailable = Boolean(
    selectedRule &&
      selectedWorkflow &&
      draft?.workflowRevisionId !== selectedWorkflow.revisionId,
  );

  return (
    <div className="space-y-5" data-enterprise-automation-manager>
      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-slate-950">流程自动化</h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">
              当新订单、预约或状态变化到达时，自动建立任务、固定当时的流程版本、生成清单并通知负责人。规则只处理启用后的新事件，不回溯历史数据。
            </p>
          </div>
          {canManage ? (
            <button type="button" className="min-h-10 rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white" onClick={startCreate}>
              新建规则
            </button>
          ) : null}
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {(["order", "booking"] as const).map((sourceType) => (
            <div key={sourceType} className={`rounded-2xl border px-4 py-3 ${availability[sourceType] === "active" ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}>
              <div className="flex items-center justify-between gap-3">
                <span className="font-semibold text-slate-900">{SOURCE_LABELS[sourceType]}事件接入</span>
                <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${availability[sourceType] === "active" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-800"}`}>
                  {availability[sourceType] === "active" ? "可自动触发" : "尚未启用"}
                </span>
              </div>
              {availability[sourceType] === "inactive" ? <p className="mt-2 text-xs leading-5 text-amber-800">可以先保存暂停规则；事件接入启用后再将规则切换为运行中。</p> : null}
            </div>
          ))}
        </div>
      </section>

      {error ? <div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}
      {notice ? <div role="status" className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{notice}</div> : null}

      {draft ? (
        <section className="rounded-3xl border border-blue-200 bg-white p-5 shadow-sm" data-enterprise-automation-editor>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold text-slate-950">{draft.ruleId ? "编辑自动化规则" : "新建自动化规则"}</h3>
              <p className="mt-1 text-sm text-slate-500">流程版本会在保存时固定；以后发布新版不会悄然改变正在运行的规则。</p>
            </div>
            <button type="button" className="text-sm font-semibold text-slate-600" onClick={() => {
              if (!draftIsDirty || window.confirm("确定放弃尚未保存的规则修改吗？")) {
                setDraft(null);
                setBaseline("");
              }
            }}>关闭</button>
          </div>

          <fieldset disabled={!canManage || busy} className="mt-5 grid gap-4 disabled:opacity-75 lg:grid-cols-2">
            <label className="grid gap-1 text-sm font-medium text-slate-700">规则名称
              <input className="min-h-11 rounded-xl border border-slate-300 px-3 py-2" maxLength={160} value={draft.name} onChange={(event) => updateDraft({ name: event.target.value })} placeholder="例如：新订单交付检查" />
            </label>
            <label className="grid gap-1 text-sm font-medium text-slate-700">运行状态
              <select className="min-h-11 rounded-xl border border-slate-300 px-3 py-2" value={draft.status} onChange={(event) => updateDraft({ status: event.target.value as AutomationStatus })}>
                <option value="paused">暂停</option>
                <option value="active" disabled={availability[draft.sourceType] !== "active"}>运行中</option>
              </select>
            </label>
            <label className="grid gap-1 text-sm font-medium text-slate-700">业务来源
              <select className="min-h-11 rounded-xl border border-slate-300 px-3 py-2" value={draft.sourceType} onChange={(event) => changeSource(event.target.value as AutomationSource)}>
                <option value="order">订单</option><option value="booking">预约</option>
              </select>
            </label>
            <label className="grid gap-1 text-sm font-medium text-slate-700">触发时机
              <select className="min-h-11 rounded-xl border border-slate-300 px-3 py-2" value={draft.eventType} onChange={(event) => updateDraft({ eventType: event.target.value as AutomationEvent, fromStatus: "", toStatus: "" })}>
                <option value="created">新建时</option><option value="status_changed">状态变化时</option>
              </select>
            </label>
            {draft.eventType === "status_changed" ? <>
              <label className="grid gap-1 text-sm font-medium text-slate-700">原状态（可选）
                <select className="min-h-11 rounded-xl border border-slate-300 px-3 py-2" value={draft.fromStatus} onChange={(event) => updateDraft({ fromStatus: event.target.value })}>
                  <option value="">任意原状态</option>{SOURCE_STATUSES[draft.sourceType].map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                </select>
              </label>
              <label className="grid gap-1 text-sm font-medium text-slate-700">目标状态
                <select className="min-h-11 rounded-xl border border-slate-300 px-3 py-2" value={draft.toStatus} onChange={(event) => updateDraft({ toStatus: event.target.value })}>
                  <option value="">请选择</option>{SOURCE_STATUSES[draft.sourceType].map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                </select>
              </label>
            </> : null}
            <label className="grid gap-1 text-sm font-medium text-slate-700">目标看板
              <select className="min-h-11 rounded-xl border border-slate-300 px-3 py-2" value={draft.boardId} onChange={(event) => {
                const boardId = event.target.value;
                updateDraft({ boardId, columnId: columns.find((column) => column.boardId === boardId)?.id ?? "", assigneeIds: [] });
              }}><option value="">请选择</option>{boards.map((board) => <option key={board.id} value={board.id}>{board.name}</option>)}</select>
            </label>
            <label className="grid gap-1 text-sm font-medium text-slate-700">初始工作列
              <select className="min-h-11 rounded-xl border border-slate-300 px-3 py-2" value={draft.columnId} onChange={(event) => updateDraft({ columnId: event.target.value })}><option value="">请选择</option>{draft.columnId && !selectedBoardColumns.some((column) => column.id === draft.columnId) ? <option value={draft.columnId}>原工作列已完成或停用（请重选）</option> : null}{selectedBoardColumns.map((column) => <option key={column.id} value={column.id}>{column.name}</option>)}</select>
              <span className="text-xs font-normal text-slate-500">自动创建的任务只能进入仍在使用的未完成列。</span>
            </label>
            <label className="grid gap-1 text-sm font-medium text-slate-700 lg:col-span-2">固定工作流程版本
              <div className="flex flex-col gap-2 sm:flex-row">
                <select className="min-h-11 flex-1 rounded-xl border border-slate-300 px-3 py-2" value={draft.workflowId} onChange={(event) => selectWorkflow(event.target.value)}>
                  <option value="">请选择已发布流程</option>{workflows.map((workflow) => <option key={workflow.id} value={workflow.id}>{workflow.title} · v{workflow.revisionNo} · {workflow.stepCount} 步</option>)}
                </select>
                {revisionUpgradeAvailable && selectedWorkflow ? <button type="button" className="min-h-11 rounded-xl border border-blue-300 px-3 py-2 text-sm font-semibold text-blue-700" onClick={() => updateDraft({ workflowRevisionId: selectedWorkflow.revisionId })}>升级到 v{selectedWorkflow.revisionNo}</button> : null}
              </div>
              {selectedRule ? <span className="text-xs text-slate-500">当前固定 v{selectedRule.workflowRevisionNo}{revisionUpgradeAvailable ? "；已有新发布版本，需手动升级。" : ""}</span> : null}
            </label>
            <label className="grid gap-1 text-sm font-medium text-slate-700">任务标题
              <input className="min-h-11 rounded-xl border border-slate-300 px-3 py-2" maxLength={240} value={draft.taskTitle} onChange={(event) => updateDraft({ taskTitle: event.target.value })} />
              <span className="text-xs font-normal text-slate-500">可使用安全占位符：{"{eventRef}"}、{"{fromStatus}"}、{"{toStatus}"}；事件引用为不可反查业务内容的随机标识，不会注入客户资料。</span>
            </label>
            <label className="grid gap-1 text-sm font-medium text-slate-700">优先级
              <select className="min-h-11 rounded-xl border border-slate-300 px-3 py-2" value={draft.priority} onChange={(event) => updateDraft({ priority: event.target.value as MerchantTaskPriority })}>
                <option value="low">低</option><option value="normal">普通</option><option value="high">高</option><option value="urgent">紧急</option>
              </select>
            </label>
            <label className="grid gap-1 text-sm font-medium text-slate-700 lg:col-span-2">任务说明（可选）
              <textarea className="min-h-24 rounded-xl border border-slate-300 px-3 py-2" maxLength={10000} value={draft.taskDescription} onChange={(event) => updateDraft({ taskDescription: event.target.value })} />
            </label>
            <label className="grid gap-1 text-sm font-medium text-slate-700">截止时间偏移（分钟，可选）
              <input type="number" min={0} max={MAX_MERCHANT_ENTERPRISE_AUTOMATION_DUE_OFFSET_MINUTES} step={1} className="min-h-11 rounded-xl border border-slate-300 px-3 py-2" value={draft.dueOffsetMinutes} onChange={(event) => updateDraft({ dueOffsetMinutes: event.target.value })} placeholder="例如：1440 表示 1 天后" />
            </label>
            <fieldset className="rounded-2xl border border-slate-200 p-3 lg:col-span-2">
              <legend className="px-1 text-sm font-medium text-slate-700">负责人（可多选）</legend>
              <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {eligibleEmployees.map((employee) => <label key={employee.id} className="flex min-h-10 items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-700"><input type="checkbox" checked={draft.assigneeIds.includes(employee.id)} onChange={(event) => updateDraft({ assigneeIds: event.target.checked ? [...draft.assigneeIds, employee.id] : draft.assigneeIds.filter((id) => id !== employee.id) })} />{employee.displayName}</label>)}
                {invalidSelectedAssignees.map((employee) => <label key={employee.id} className="flex min-h-10 items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700"><input type="checkbox" checked onChange={() => updateDraft({ assigneeIds: draft.assigneeIds.filter((id) => id !== employee.id) })} />{employee.label}（已停用或无权访问此看板，请取消勾选）</label>)}
                {eligibleEmployees.length === 0 && invalidSelectedAssignees.length === 0 ? <span className="text-sm text-slate-500">暂无具备任务查看权限且可访问此看板的员工；可以先保存无负责人的暂停规则。</span> : null}
              </div>
              {invalidSelectedAssignees.length > 0 ? <p role="alert" className="mt-3 text-xs leading-5 text-rose-700">旧规则中存在已失效负责人。保存前请取消其勾选，或先恢复员工、角色及看板权限。</p> : null}
            </fieldset>
          </fieldset>
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <button type="button" className="min-h-10 rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700" disabled={busy} onClick={() => {
              const next = draft.ruleId && selectedRule ? draftFromRule(selectedRule) : blankDraft({ boardId: boards[0]?.id, columnId: columns.find((column) => column.boardId === boards[0]?.id)?.id, workflow: workflows[0] });
              setDraft(next); setBaseline(draftSignature(next));
            }}>重置</button>
            <button type="button" className="min-h-10 rounded-xl bg-blue-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-45" disabled={busy || !draftIsDirty || !canManage} onClick={() => void saveDraft()}>{!canManage ? "仅可查看" : busy ? "保存中…" : "保存规则"}</button>
          </div>
        </section>
      ) : null}

      <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4"><div><h3 className="font-semibold text-slate-950">自动化规则</h3><p className="mt-1 text-xs text-slate-500">最多展示 100 条规则。</p></div><button type="button" className="text-sm font-semibold text-blue-700" disabled={loading || busy} onClick={() => void load(Boolean(draft))}>{loading ? "刷新中…" : "刷新"}</button></div>
        {loading && rules.length === 0 ? <div className="px-5 py-12 text-center text-sm text-slate-500">正在加载自动化规则…</div> : null}
        {!loading && rules.length === 0 ? <div className="px-5 py-12 text-center text-sm text-slate-500">还没有自动化规则。建议先保存为暂停，核对目标与流程后再启用。</div> : null}
        <div className="divide-y divide-slate-100">
          {rules.map((rule) => {
            const boardName = snapshot.boards.find((board) => board.id === rule.boardId)?.name ?? "看板不可用";
            const columnName = snapshot.columns.find((column) => column.id === rule.columnId)?.name ?? "工作列不可用";
            const workflow = workflows.find((item) => item.id === rule.workflowId);
            const hasNewRevision = Boolean(workflow && workflow.revisionId !== rule.workflowRevisionId);
            const waitingForEventService =
              rule.status === "active" && availability[rule.sourceType] !== "active";
            const statusLabel = waitingForEventService
              ? "已启用·等待事件服务"
              : rule.status === "active"
                ? "运行中"
                : "已暂停";
            return <article key={rule.id} className="px-5 py-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h4 className="font-semibold text-slate-950">{rule.name}</h4><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${waitingForEventService ? "bg-amber-100 text-amber-800" : rule.status === "active" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>{statusLabel}</span>{hasNewRevision ? <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700">有新流程版本</span> : null}</div><p className="mt-2 text-sm text-slate-600">{SOURCE_LABELS[rule.sourceType]} · {rule.eventType === "created" ? "新建时" : `状态变为 ${rule.toStatus || "—"}`} · {boardName}/{columnName}</p><p className="mt-1 text-xs text-slate-500">固定流程 v{rule.workflowRevisionNo} · {rule.assigneeIds.length} 位负责人 · 任务“{rule.taskTitle}”</p></div><div className="flex shrink-0 flex-wrap gap-2"><button type="button" className="min-h-10 rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700" disabled={busy} onClick={() => startEdit(rule)}>{canManage ? "编辑" : "查看"}</button>{canManage ? <button type="button" className="min-h-10 rounded-xl border border-rose-200 px-4 py-2 text-sm font-semibold text-rose-700 disabled:opacity-45" disabled={busy} onClick={() => void archiveRule(rule)}>归档</button> : null}</div></div></article>;
          })}
        </div>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-5 py-4"><h3 className="font-semibold text-slate-950">最近运行</h3><p className="mt-1 text-xs text-slate-500">只展示不可反查业务内容的随机事件引用、状态与错误码，不保存客户姓名、电话、业务编号或正文。</p></div>
        {runs.length === 0 ? <div className="px-5 py-10 text-center text-sm text-slate-500">暂无运行记录。启用规则并产生新业务事件后会显示在这里。</div> : <div className="divide-y divide-slate-100">{runs.slice(0, 30).map((run) => {
          const statusLabel = run.status === "completed"
            ? "已创建任务"
            : run.status === "failed"
              ? "执行失败"
              : run.status === "processing"
                ? "处理中"
                : "已跳过";
          const statusTone = run.status === "completed"
            ? "bg-emerald-100 text-emerald-700"
            : run.status === "failed"
              ? "bg-rose-100 text-rose-700"
              : run.status === "processing"
                ? "bg-blue-100 text-blue-700"
                : "bg-slate-100 text-slate-600";
          const autoPausedForInvalidConfiguration =
            run.status === "failed" && AUTOMATION_AUTO_PAUSE_ERROR_CODES.has(run.errorCode);
          return <article key={run.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"><div><div className="flex flex-wrap items-center gap-2"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusTone}`}>{statusLabel}</span><span className="text-sm font-semibold text-slate-900">{SOURCE_LABELS[run.sourceType]}事件 {run.eventRef}</span>{run.attemptCount > 1 ? <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600">第 {run.attemptCount} 次尝试</span> : null}</div><p className="mt-1 text-xs text-slate-500">{dateTime(run.sourceEventAt)}{run.eventType === "created" ? " · 新建事件" : ` · 状态 ${run.fromStatus || "—"} → ${run.toStatus || "—"}`}{run.errorCode ? ` · ${automationRunErrorLabel(run.errorCode)}` : ""}</p>{autoPausedForInvalidConfiguration ? <p className="mt-1 text-xs font-medium text-rose-700">规则已自动暂停，请修复目标、流程或负责人配置后再启用。</p> : run.status === "failed" ? <p className="mt-1 text-xs text-amber-700">系统会自动重试；如持续失败，请检查规则目标、流程版本和事件服务配置。</p> : null}</div>{run.taskId && onOpenTask ? <button type="button" className="min-h-10 rounded-xl border border-blue-300 px-3 py-2 text-sm font-semibold text-blue-700" onClick={() => onOpenTask(run.taskId!)}>打开任务</button> : null}</article>;
        })}</div>}
      </section>
    </div>
  );
}
