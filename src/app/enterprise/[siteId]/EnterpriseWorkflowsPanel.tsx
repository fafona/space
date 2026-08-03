"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { createClientMutationOperationId } from "@/lib/mutationOperationId";
import styles from "./EnterpriseWorkflowsPanel.module.css";

const WORKFLOW_API_PATH = "/api/merchant-enterprise/workflows";
const REQUEST_TIMEOUT_MS = 30_000;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const LIMITS = {
  title: 160,
  scenario: 500,
  description: 5_000,
  category: 80,
  tags: 10,
  tag: 40,
  steps: 50,
  stepTitle: 160,
  stepInstruction: 4_000,
} as const;

export type EnterpriseWorkflowActor = {
  type: "owner" | "employee";
  id: string;
  permissions: readonly string[];
};

export type EnterpriseWorkflowApiFetch = (
  path: string,
  init?: RequestInit,
) => Promise<Response>;

export type EnterpriseWorkflowStatus = "draft" | "published" | "archived";

export type EnterpriseWorkflowStep = {
  id: string;
  title: string;
  instruction: string;
  position: number;
};

export type EnterpriseWorkflow = {
  id: string;
  siteId: string;
  title: string;
  scenario: string;
  description: string;
  category: string;
  tags: string[];
  status: EnterpriseWorkflowStatus;
  steps: EnterpriseWorkflowStep[];
  version: number;
  publishedVersion: number;
  publishedAt: string | null;
  hasUnpublishedChanges: boolean;
  createdAt: string;
  updatedAt: string;
};

export type EnterpriseWorkflowsPanelProps = {
  siteId: string;
  actor: EnterpriseWorkflowActor | null;
  apiFetch: EnterpriseWorkflowApiFetch;
  className?: string;
  focusWorkflowId?: string | null;
  focusRequestId?: number;
  onFocusHandled?: (requestId: number) => void;
  onDirtyChange?: (dirty: boolean) => void;
};

type WorkflowPayload = {
  ok?: boolean;
  error?: string;
  workflows?: unknown;
  workflow?: unknown;
};

type WorkflowDraftStep = EnterpriseWorkflowStep & {
  local: boolean;
};

type WorkflowDraft = {
  clientKey: string;
  workflowId: string | null;
  version: number | null;
  title: string;
  scenario: string;
  description: string;
  category: string;
  tagsText: string;
  steps: WorkflowDraftStep[];
};

class WorkflowVersionConflictError extends Error {
  constructor() {
    super("workflow_version_conflict");
    this.name = "WorkflowVersionConflictError";
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function integer(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function dateText(value: unknown) {
  const normalized = text(value, 80);
  return normalized && Number.isFinite(Date.parse(normalized)) ? normalized : null;
}

function workflowStatus(value: unknown): EnterpriseWorkflowStatus | null {
  return value === "draft" || value === "published" || value === "archived"
    ? value
    : null;
}

function normalizeWorkflowStep(value: unknown, fallbackPosition: number) {
  const source = record(value);
  if (!source) return null;
  const id = text(source.id, 80);
  const title = text(source.title, LIMITS.stepTitle);
  if (!UUID_PATTERN.test(id) || !title) return null;
  return {
    id,
    title,
    instruction: text(source.instruction, LIMITS.stepInstruction),
    position: integer(source.position, fallbackPosition),
  } satisfies EnterpriseWorkflowStep;
}

function normalizeWorkflow(value: unknown): EnterpriseWorkflow | null {
  const source = record(value);
  if (!source) return null;
  const id = text(source.id, 80);
  const siteId = text(source.siteId ?? source.site_id, 80);
  const title = text(source.title, LIMITS.title);
  const status = workflowStatus(source.status);
  const version = integer(source.version);
  if (!id || !siteId || !title || !status || version < 1) return null;
  const steps = (Array.isArray(source.steps) ? source.steps : [])
    .map(normalizeWorkflowStep)
    .filter((step): step is EnterpriseWorkflowStep => Boolean(step))
    .sort((left, right) => left.position - right.position || left.id.localeCompare(right.id))
    .slice(0, LIMITS.steps)
    .map((step, position) => ({ ...step, position }));
  const rawTags = Array.isArray(source.tags) ? source.tags : [];
  const tags = Array.from(
    new Set(rawTags.map((tag) => text(tag, LIMITS.tag)).filter(Boolean)),
  ).slice(0, LIMITS.tags);
  return {
    id,
    siteId,
    title,
    scenario: text(source.scenario, LIMITS.scenario),
    description: text(source.description, LIMITS.description),
    category: text(source.category, LIMITS.category),
    tags,
    status,
    steps,
    version,
    publishedVersion: integer(source.publishedVersion ?? source.published_version),
    publishedAt: dateText(source.publishedAt ?? source.published_at),
    hasUnpublishedChanges:
      source.hasUnpublishedChanges === true || source.has_unpublished_changes === true,
    createdAt: dateText(source.createdAt ?? source.created_at) ?? "",
    updatedAt: dateText(source.updatedAt ?? source.updated_at) ?? "",
  };
}

function blankDraft(): WorkflowDraft {
  return {
    clientKey: clientUuid(),
    workflowId: null,
    version: null,
    title: "",
    scenario: "",
    description: "",
    category: "",
    tagsText: "",
    steps: [],
  };
}

function draftFromWorkflow(workflow: EnterpriseWorkflow): WorkflowDraft {
  return {
    clientKey: `workflow:${workflow.id}`,
    workflowId: workflow.id,
    version: workflow.version,
    title: workflow.title,
    scenario: workflow.scenario,
    description: workflow.description,
    category: workflow.category,
    tagsText: workflow.tags.join("，"),
    steps: workflow.steps.map((step) => ({ ...step, local: false })),
  };
}

function draftSignature(draft: WorkflowDraft | null) {
  if (!draft) return "";
  return JSON.stringify({
    workflowId: draft.workflowId,
    version: draft.version,
    title: draft.title,
    scenario: draft.scenario,
    description: draft.description,
    category: draft.category,
    tagsText: draft.tagsText,
    steps: draft.steps.map(({ id, title, instruction, position, local }) => ({
      id,
      title,
      instruction,
      position,
      local,
    })),
  });
}

function parseTags(value: string) {
  const tags: string[] = [];
  const seen = new Set<string>();
  for (const candidate of value.split(/[,，\n]/)) {
    const tag = candidate.trim();
    if (!tag) continue;
    if (tag.length > LIMITS.tag) {
      throw new Error(`每个标签最多 ${LIMITS.tag} 个字符。`);
    }
    const key = tag.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
  }
  if (tags.length > LIMITS.tags) {
    throw new Error(`最多可设置 ${LIMITS.tags} 个标签。`);
  }
  return tags;
}

function validateDraft(draft: WorkflowDraft, options: { publishing: boolean }) {
  const title = draft.title.trim();
  const scenario = draft.scenario.trim();
  if (!title) throw new Error("请填写流程名称。");
  if (!scenario) throw new Error("请填写适用场景。");
  if (title.length > LIMITS.title) throw new Error(`流程名称最多 ${LIMITS.title} 个字符。`);
  if (scenario.length > LIMITS.scenario) {
    throw new Error(`适用场景最多 ${LIMITS.scenario} 个字符。`);
  }
  if (draft.description.length > LIMITS.description) {
    throw new Error(`流程说明最多 ${LIMITS.description} 个字符。`);
  }
  if (draft.category.trim().length > LIMITS.category) {
    throw new Error(`分类最多 ${LIMITS.category} 个字符。`);
  }
  if (draft.steps.length > LIMITS.steps) {
    throw new Error(`每个流程最多 ${LIMITS.steps} 个步骤。`);
  }
  if (options.publishing && draft.steps.length === 0) {
    throw new Error("发布前至少需要添加一个步骤。");
  }
  draft.steps.forEach((step, index) => {
    if (!UUID_PATTERN.test(step.id)) {
      throw new Error(`第 ${index + 1} 个步骤标识无效，请删除后重新添加。`);
    }
    if (!step.title.trim()) throw new Error(`请填写第 ${index + 1} 个步骤的标题。`);
    if (step.title.trim().length > LIMITS.stepTitle) {
      throw new Error(`第 ${index + 1} 个步骤标题最多 ${LIMITS.stepTitle} 个字符。`);
    }
    if (!step.instruction.trim()) throw new Error(`请填写第 ${index + 1} 个步骤的操作说明。`);
    if (step.instruction.length > LIMITS.stepInstruction) {
      throw new Error(`第 ${index + 1} 个步骤说明最多 ${LIMITS.stepInstruction} 个字符。`);
    }
  });
  return {
    title,
    scenario,
    description: draft.description.trim(),
    category: draft.category.trim(),
    tags: parseTags(draft.tagsText),
    steps: draft.steps.map((step, position) => ({
      id: step.id,
      title: step.title.trim(),
      instruction: step.instruction.trim(),
      position,
    })),
  };
}

function workflowStatusLabel(workflow: EnterpriseWorkflow) {
  if (workflow.status === "archived") return "已归档";
  if (workflow.status === "draft") return "草稿";
  return workflow.hasUnpublishedChanges ? "已发布 · 有新草稿" : "已发布";
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

function readWorkflowError(payload: WorkflowPayload | null, fallback: string) {
  const error = payload?.error ?? "";
  if (error === "permission_denied" || error === "merchant_access_denied") {
    return "当前账号没有执行此操作的权限。";
  }
  if (error === "workflow_not_found") return "流程不存在或已不可访问。";
  if (error === "workflow_name_conflict") return "已有同名流程，请更换名称。";
  if (error === "workflow_publish_incomplete" || error === "workflow_publish_invalid") {
    return "流程内容不完整，暂时无法发布。";
  }
  if (error === "enterprise_version_conflict" || error === "workflow_version_conflict") {
    return "该流程已被其他成员更新，请重新加载后再操作。";
  }
  if (error === "enterprise_management_disabled") return "当前企业尚未开通企业管理。";
  return fallback;
}

function clientUuid() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export default function EnterpriseWorkflowsPanel({
  siteId,
  actor,
  apiFetch,
  className = "",
  focusWorkflowId = null,
  focusRequestId = 0,
  onFocusHandled,
  onDirtyChange,
}: EnterpriseWorkflowsPanelProps) {
  const [workflows, setWorkflows] = useState<EnterpriseWorkflow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [notice, setNotice] = useState("");
  const [mutationError, setMutationError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [busy, setBusy] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<WorkflowDraft | null>(null);
  const [baselineSignature, setBaselineSignature] = useState("");
  const [query, setQuery] = useState("");
  const [scenarioFilter, setScenarioFilter] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<"current" | "all" | EnterpriseWorkflowStatus>(
    "current",
  );
  const loadSequenceRef = useRef(0);
  const mutationOperationRef = useRef<{ key: string; operationId: string } | null>(null);

  const canView = Boolean(
    actor &&
      (actor.type === "owner" ||
        actor.permissions.some((permission) =>
          ["workflows.view", "workflows.manage", "workflows.publish"].includes(permission),
        )),
  );
  const canManage = Boolean(
    actor && (actor.type === "owner" || actor.permissions.includes("workflows.manage")),
  );
  const canPublish = Boolean(
    actor && (actor.type === "owner" || actor.permissions.includes("workflows.publish")),
  );
  const isDirty = Boolean(draft && draftSignature(draft) !== baselineSignature);

  const operationIdFor = useCallback((key: string, prefix: string) => {
    if (mutationOperationRef.current?.key === key) {
      return mutationOperationRef.current.operationId;
    }
    const operationId = createClientMutationOperationId(prefix);
    mutationOperationRef.current = { key, operationId };
    return operationId;
  }, []);

  const clearOperationId = useCallback((key: string) => {
    if (mutationOperationRef.current?.key === key) mutationOperationRef.current = null;
  }, []);

  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  useEffect(() => {
    if (!isDirty) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isDirty]);

  useEffect(
    () => () => {
      onDirtyChange?.(false);
    },
    [onDirtyChange],
  );

  const request = useCallback(
    async (path: string, init: RequestInit = {}) => {
      const controller = new AbortController();
      const callerSignal = init.signal;
      let timedOut = false;
      const abort = () => controller.abort(callerSignal?.reason);
      if (callerSignal?.aborted) abort();
      else callerSignal?.addEventListener("abort", abort, { once: true });
      const timeoutId = window.setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, REQUEST_TIMEOUT_MS);
      try {
        return await apiFetch(path, { ...init, signal: controller.signal });
      } catch (error) {
        if (timedOut) throw new Error("请求超时，请检查网络后重试。");
        throw error;
      } finally {
        window.clearTimeout(timeoutId);
        callerSignal?.removeEventListener("abort", abort);
      }
    },
    [apiFetch],
  );

  const loadWorkflows = useCallback(
    async (options: { preserveSelection?: boolean } = {}) => {
      if (!canView || !/^\d{8}$/.test(siteId)) {
        setWorkflows([]);
        setLoading(false);
        return;
      }
      const sequence = loadSequenceRef.current + 1;
      loadSequenceRef.current = sequence;
      setLoading(true);
      setLoadError("");
      try {
        const params = new URLSearchParams({ siteId });
        const response = await request(`${WORKFLOW_API_PATH}?${params.toString()}`);
        const payload = (await response.json().catch(() => null)) as WorkflowPayload | null;
        if (!response.ok || !payload?.ok || !Array.isArray(payload.workflows)) {
          throw new Error(readWorkflowError(payload, "工作流程加载失败，请稍后重试。"));
        }
        const normalized = payload.workflows
          .map(normalizeWorkflow)
          .filter((workflow): workflow is EnterpriseWorkflow => Boolean(workflow))
          .filter((workflow) => workflow.siteId === siteId)
          .sort((left, right) => {
            if (left.status === "archived" && right.status !== "archived") return 1;
            if (right.status === "archived" && left.status !== "archived") return -1;
            return (Date.parse(right.updatedAt) || 0) - (Date.parse(left.updatedAt) || 0);
          });
        if (sequence !== loadSequenceRef.current) return;
        setWorkflows(normalized);
        setSelectedId((current) => {
          if (options.preserveSelection && current && normalized.some((item) => item.id === current)) {
            return current;
          }
          const firstPublished = normalized.find((item) => item.status === "published");
          return firstPublished?.id ?? normalized[0]?.id ?? null;
        });
      } catch (error) {
        if (sequence !== loadSequenceRef.current) return;
        setLoadError(error instanceof Error ? error.message : "工作流程加载失败，请稍后重试。");
      } finally {
        if (sequence === loadSequenceRef.current) setLoading(false);
      }
    },
    [canView, request, siteId],
  );

  useEffect(() => {
    void loadWorkflows();
  }, [loadWorkflows]);

  const scenarioOptions = useMemo(
    () =>
      Array.from(new Set(workflows.map((workflow) => workflow.scenario).filter(Boolean))).sort(
        (left, right) => left.localeCompare(right, "zh-CN"),
      ),
    [workflows],
  );
  const tagOptions = useMemo(
    () =>
      Array.from(new Set(workflows.flatMap((workflow) => workflow.tags))).sort((left, right) =>
        left.localeCompare(right, "zh-CN"),
      ),
    [workflows],
  );

  const filteredWorkflows = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return workflows.filter((workflow) => {
      if (statusFilter === "current" && workflow.status === "archived") return false;
      if (statusFilter !== "current" && statusFilter !== "all" && workflow.status !== statusFilter) {
        return false;
      }
      if (scenarioFilter && workflow.scenario !== scenarioFilter) return false;
      if (tagFilter && !workflow.tags.includes(tagFilter)) return false;
      if (!normalizedQuery) return true;
      const haystack = [
        workflow.title,
        workflow.scenario,
        workflow.description,
        workflow.category,
        ...workflow.tags,
        ...workflow.steps.flatMap((step) => [step.title, step.instruction]),
      ]
        .join("\n")
        .toLocaleLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [query, scenarioFilter, statusFilter, tagFilter, workflows]);

  const selectedWorkflow =
    filteredWorkflows.find((workflow) => workflow.id === selectedId) ??
    filteredWorkflows[0] ??
    null;

  useEffect(() => {
    if (selectedWorkflow && selectedWorkflow.id !== selectedId && !draft) {
      setSelectedId(selectedWorkflow.id);
    }
  }, [draft, selectedId, selectedWorkflow]);

  const confirmDiscard = useCallback(() => {
    if (!isDirty) return true;
    return window.confirm("当前流程有尚未保存的修改，确定放弃这些修改吗？");
  }, [isDirty]);

  useEffect(() => {
    if (!focusWorkflowId || focusRequestId <= 0 || loading || busy) return;
    const focused = workflows.find((workflow) => workflow.id === focusWorkflowId);
    if (focused) {
      setDraft(null);
      setBaselineSignature("");
      setMutationError("");
      setConflict(false);
      setNotice("");
      setQuery("");
      setScenarioFilter("");
      setTagFilter("");
      setStatusFilter(focused.status === "archived" ? "all" : "current");
      setSelectedId(focused.id);
    }
    onFocusHandled?.(focusRequestId);
  }, [busy, focusRequestId, focusWorkflowId, loading, onFocusHandled, workflows]);

  function beginCreate() {
    if (!confirmDiscard()) return;
    const next = blankDraft();
    setDraft(next);
    setBaselineSignature(draftSignature(next));
    setSelectedId(null);
    setMutationError("");
    setConflict(false);
    setNotice("");
  }

  function beginEdit(workflow: EnterpriseWorkflow) {
    if (!confirmDiscard()) return;
    const next = draftFromWorkflow(workflow);
    setSelectedId(workflow.id);
    setDraft(next);
    setBaselineSignature(draftSignature(next));
    setMutationError("");
    setConflict(false);
    setNotice("");
  }

  function selectWorkflow(workflow: EnterpriseWorkflow) {
    if (workflow.id === selectedId && !draft) return;
    if (!confirmDiscard()) return;
    setDraft(null);
    setBaselineSignature("");
    setSelectedId(workflow.id);
    setMutationError("");
    setConflict(false);
    setNotice("");
  }

  function closeEditor() {
    if (!confirmDiscard()) return;
    setDraft(null);
    setBaselineSignature("");
    setMutationError("");
    setConflict(false);
  }

  function updateDraft(patch: Partial<WorkflowDraft>) {
    setDraft((current) => (current ? { ...current, ...patch } : current));
    setMutationError("");
    setConflict(false);
    setNotice("");
  }

  function updateDraftStep(stepId: string, patch: Partial<WorkflowDraftStep>) {
    setDraft((current) =>
      current
        ? {
            ...current,
            steps: current.steps.map((step) =>
              step.id === stepId ? { ...step, ...patch } : step,
            ),
          }
        : current,
    );
    setMutationError("");
    setConflict(false);
    setNotice("");
  }

  function addStep() {
    setDraft((current) => {
      if (!current || current.steps.length >= LIMITS.steps) return current;
      return {
        ...current,
        steps: [
          ...current.steps,
          {
            id: clientUuid(),
            title: "",
            instruction: "",
            position: current.steps.length,
            local: true,
          },
        ],
      };
    });
    setMutationError("");
    setConflict(false);
    setNotice("");
  }

  function removeStep(stepId: string) {
    setDraft((current) =>
      current
        ? {
            ...current,
            steps: current.steps
              .filter((step) => step.id !== stepId)
              .map((step, position) => ({ ...step, position })),
          }
        : current,
    );
    setMutationError("");
    setConflict(false);
    setNotice("");
  }

  function moveStep(stepId: string, offset: -1 | 1) {
    setDraft((current) => {
      if (!current) return current;
      const index = current.steps.findIndex((step) => step.id === stepId);
      const target = index + offset;
      if (index < 0 || target < 0 || target >= current.steps.length) return current;
      const steps = [...current.steps];
      [steps[index], steps[target]] = [steps[target], steps[index]];
      return { ...current, steps: steps.map((step, position) => ({ ...step, position })) };
    });
    setMutationError("");
    setConflict(false);
    setNotice("");
  }

  const sendMutation = useCallback(
    async (method: "POST" | "PATCH", body: Record<string, unknown>) => {
      const response = await request(WORKFLOW_API_PATH, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await response.json().catch(() => null)) as WorkflowPayload | null;
      if (
        response.status === 409 &&
        ["enterprise_version_conflict", "workflow_version_conflict"].includes(payload?.error ?? "")
      ) {
        throw new WorkflowVersionConflictError();
      }
      const workflow = normalizeWorkflow(payload?.workflow);
      if (!response.ok || !payload?.ok || !workflow || workflow.siteId !== siteId) {
        throw new Error(readWorkflowError(payload, "流程保存失败，请稍后重试。"));
      }
      return workflow;
    },
    [request, siteId],
  );

  const replaceWorkflow = useCallback((workflow: EnterpriseWorkflow) => {
    setWorkflows((current) => {
      const exists = current.some((item) => item.id === workflow.id);
      const next = exists
        ? current.map((item) => (item.id === workflow.id ? workflow : item))
        : [workflow, ...current];
      return next.sort((left, right) => {
        if (left.status === "archived" && right.status !== "archived") return 1;
        if (right.status === "archived" && left.status !== "archived") return -1;
        return (Date.parse(right.updatedAt) || 0) - (Date.parse(left.updatedAt) || 0);
      });
    });
    setSelectedId(workflow.id);
  }, []);

  async function saveDraft(options: { publishing: boolean }) {
    if (!draft || busy) return;
    if (!canManage) {
      setMutationError("当前账号没有编辑工作流程的权限。");
      return;
    }
    if (options.publishing && !canPublish) {
      setMutationError("当前账号没有发布工作流程的权限。");
      return;
    }
    setBusy(true);
    setMutationError("");
    setConflict(false);
    setNotice("");
    let persistedBeforePublish = false;
    try {
      const fields = validateDraft(draft, options);
      let saved: EnterpriseWorkflow;
      const needsSave = !draft.workflowId || isDirty;
      if (!needsSave && draft.workflowId) {
        const current = workflows.find((workflow) => workflow.id === draft.workflowId);
        if (!current) throw new Error("当前流程已不在列表中，请重新加载后再试。");
        saved = current;
      } else if (draft.workflowId && draft.version) {
        const operationKey = `save:${draft.workflowId}:${draft.version}:${draftSignature(draft)}`;
        saved = await sendMutation("PATCH", {
          siteId,
          workflowId: draft.workflowId,
          version: draft.version,
          operationId: operationIdFor(operationKey, "workflow-save"),
          action: "save",
          ...fields,
        });
        clearOperationId(operationKey);
      } else {
        const operationKey = `create:${draft.clientKey}`;
        saved = await sendMutation("POST", {
          siteId,
          operationId: operationIdFor(operationKey, "workflow-create"),
          ...fields,
        });
        clearOperationId(operationKey);
      }
      if (needsSave) {
        replaceWorkflow(saved);
        const nextDraft = draftFromWorkflow(saved);
        setDraft(nextDraft);
        setBaselineSignature(draftSignature(nextDraft));
        persistedBeforePublish = options.publishing;
      }
      if (options.publishing) {
        if (saved.status === "published" && !saved.hasUnpublishedChanges) {
          setNotice("当前流程已是最新发布版本。");
          return;
        }
        const operationKey = `publish:${saved.id}:${saved.version}`;
        saved = await sendMutation("PATCH", {
          siteId,
          workflowId: saved.id,
          version: saved.version,
          operationId: operationIdFor(operationKey, "workflow-publish"),
          action: "publish",
        });
        clearOperationId(operationKey);
      }
      replaceWorkflow(saved);
      const nextDraft = draftFromWorkflow(saved);
      setDraft(nextDraft);
      setBaselineSignature(draftSignature(nextDraft));
      setNotice(options.publishing ? "流程已发布，员工现在可以查看最新版本。" : "草稿已保存。");
    } catch (error) {
      if (error instanceof WorkflowVersionConflictError) {
        setConflict(true);
        setMutationError(
          persistedBeforePublish
            ? "草稿已保存，但发布时发现流程已被其他成员更新。请重新加载后确认。"
            : "该流程已被其他成员更新。请重新加载最新版本后再编辑。",
        );
      } else {
        const detail = error instanceof Error ? error.message : "流程保存失败，请稍后重试。";
        setMutationError(persistedBeforePublish ? `草稿已保存，但发布失败：${detail}` : detail);
      }
    } finally {
      setBusy(false);
    }
  }

  async function changeWorkflowStatus(
    workflow: EnterpriseWorkflow,
    action: "archive" | "restore" | "publish",
  ) {
    if (busy) return;
    if (!canPublish) {
      setMutationError("当前账号没有发布或变更流程可见性的权限。");
      return;
    }
    if (isDirty && !confirmDiscard()) return;
    const actionLabel = action === "archive" ? "归档" : action === "restore" ? "恢复" : "发布";
    if (
      action === "archive" &&
      !window.confirm("归档后普通员工将无法查看此流程，确定继续吗？")
    ) {
      return;
    }
    setBusy(true);
    setMutationError("");
    setConflict(false);
    setNotice("");
    const operationKey = `${action}:${workflow.id}:${workflow.version}`;
    try {
      const updated = await sendMutation("PATCH", {
        siteId,
        workflowId: workflow.id,
        version: workflow.version,
        operationId: operationIdFor(operationKey, `workflow-${action}`),
        action,
      });
      clearOperationId(operationKey);
      replaceWorkflow(updated);
      setDraft(null);
      setBaselineSignature("");
      setNotice(`流程已${actionLabel}。`);
    } catch (error) {
      if (error instanceof WorkflowVersionConflictError) {
        setConflict(true);
        setMutationError("该流程已被其他成员更新，当前操作未执行。请重新加载。");
      } else {
        setMutationError(error instanceof Error ? error.message : `流程${actionLabel}失败。`);
      }
    } finally {
      setBusy(false);
    }
  }

  async function reloadAfterConflict() {
    if (!confirmDiscard()) return;
    setDraft(null);
    setBaselineSignature("");
    setConflict(false);
    setMutationError("");
    setNotice("");
    await loadWorkflows({ preserveSelection: true });
  }

  function submitEditor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void saveDraft({ publishing: false });
  }

  if (!actor) {
    return (
      <section className={`${styles.panel} ${className}`} aria-busy="true">
        <div className={styles.stateCard}>正在确认工作流程权限...</div>
      </section>
    );
  }

  if (!canView) {
    return (
      <section className={`${styles.panel} ${className}`}>
        <div className={styles.stateCard}>
          <h2>无法查看工作流程</h2>
          <p>当前角色没有“查看工作流程”权限，请联系企业负责人。</p>
        </div>
      </section>
    );
  }

  return (
    <section className={`${styles.panel} ${className}`} aria-label="工作流程与标准作业程序">
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>Enterprise SOP</span>
          <h2>工作流程</h2>
          <p>把团队经验整理成可搜索、可执行、可持续更新的标准步骤。</p>
        </div>
        <div className={styles.headerActions}>
          <button
            type="button"
            className={styles.secondaryButton}
            disabled={loading || busy}
            onClick={() => void loadWorkflows({ preserveSelection: true })}
          >
            刷新
          </button>
          {canManage ? (
            <button type="button" className={styles.primaryButton} disabled={busy} onClick={beginCreate}>
              新建流程
            </button>
          ) : null}
        </div>
      </header>

      {notice ? (
        <div className={styles.successBanner} role="status">
          {notice}
        </div>
      ) : null}
      {mutationError ? (
        <div className={styles.errorBanner} role="alert">
          <span>{mutationError}</span>
          {conflict ? (
            <button type="button" onClick={() => void reloadAfterConflict()} disabled={busy || loading}>
              重新加载
            </button>
          ) : null}
        </div>
      ) : null}

      <div className={styles.filters} aria-label="流程筛选">
        <label className={styles.searchField}>
          <span>搜索</span>
          <input
            type="search"
            value={query}
            placeholder="搜索流程、步骤或说明"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <label>
          <span>场景</span>
          <select value={scenarioFilter} onChange={(event) => setScenarioFilter(event.target.value)}>
            <option value="">全部场景</option>
            {scenarioOptions.map((scenario) => (
              <option value={scenario} key={scenario}>
                {scenario}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>标签</span>
          <select value={tagFilter} onChange={(event) => setTagFilter(event.target.value)}>
            <option value="">全部标签</option>
            {tagOptions.map((tag) => (
              <option value={tag} key={tag}>
                {tag}
              </option>
            ))}
          </select>
        </label>
        {canManage || canPublish ? (
          <label>
            <span>状态</span>
            <select
              value={statusFilter}
              onChange={(event) =>
                setStatusFilter(event.target.value as typeof statusFilter)
              }
            >
              <option value="current">当前流程</option>
              <option value="all">全部状态</option>
              <option value="draft">草稿</option>
              <option value="published">已发布</option>
              <option value="archived">已归档</option>
            </select>
          </label>
        ) : null}
        <div className={styles.resultCount} aria-live="polite">
          {filteredWorkflows.length} 个流程
        </div>
      </div>

      {loading ? (
        <div className={styles.loadingGrid} aria-busy="true" aria-label="正在加载工作流程">
          <div />
          <div />
          <div />
        </div>
      ) : loadError ? (
        <div className={styles.stateCard} role="alert">
          <h3>暂时无法加载工作流程</h3>
          <p>{loadError}</p>
          <button type="button" className={styles.primaryButton} onClick={() => void loadWorkflows()}>
            重试
          </button>
        </div>
      ) : workflows.length === 0 && !draft ? (
        <div className={styles.stateCard}>
          <h3>{canManage ? "从第一份标准流程开始" : "暂无已发布流程"}</h3>
          <p>
            {canManage
              ? "创建草稿、整理有序步骤，确认后再发布给员工。"
              : "管理员发布流程后，会在这里显示。"}
          </p>
          {canManage ? (
            <button type="button" className={styles.primaryButton} onClick={beginCreate}>
              新建流程
            </button>
          ) : null}
        </div>
      ) : (
        <div className={styles.workspace}>
          <aside className={styles.workflowList} aria-label="流程列表">
            {filteredWorkflows.length === 0 ? (
              <div className={styles.noResults}>
                <strong>没有符合条件的流程</strong>
                <span>可以清除搜索词或切换筛选条件。</span>
              </div>
            ) : (
              filteredWorkflows.map((workflow) => (
                <button
                  type="button"
                  key={workflow.id}
                  className={`${styles.workflowCard} ${
                    workflow.id === selectedWorkflow?.id && !draft ? styles.workflowCardActive : ""
                  }`}
                  onClick={() => selectWorkflow(workflow)}
                >
                  <span className={styles.cardTopline}>
                    <span className={`${styles.statusBadge} ${styles[`status_${workflow.status}`]}`}>
                      {workflowStatusLabel(workflow)}
                    </span>
                    <span>{workflow.steps.length} 步</span>
                  </span>
                  <strong>{workflow.title}</strong>
                  <span className={styles.cardScenario}>{workflow.scenario || "未设置场景"}</span>
                  {workflow.tags.length > 0 ? (
                    <span className={styles.cardTags}>
                      {workflow.tags.slice(0, 3).map((tag) => (
                        <span key={tag}>#{tag}</span>
                      ))}
                    </span>
                  ) : null}
                </button>
              ))
            )}
          </aside>

          <div className={styles.contentPane}>
            {draft ? (
              <form className={styles.editor} onSubmit={submitEditor}>
                <div className={styles.contentHeading}>
                  <div>
                    <span className={styles.eyebrow}>{draft.workflowId ? "Edit draft" : "New draft"}</span>
                    <h3>{draft.workflowId ? "编辑流程草稿" : "新建流程草稿"}</h3>
                    <p>保存不会影响员工正在查看的已发布版本，重新发布后才会生效。</p>
                  </div>
                  <button type="button" className={styles.textButton} onClick={closeEditor} disabled={busy}>
                    关闭
                  </button>
                </div>

                <div className={styles.formGrid}>
                  <label className={styles.fullField}>
                    <span>流程名称 *</span>
                    <input
                      value={draft.title}
                      maxLength={LIMITS.title}
                      placeholder="例如：新员工首日接待"
                      onChange={(event) => updateDraft({ title: event.target.value })}
                    />
                  </label>
                  <label>
                    <span>适用场景 *</span>
                    <input
                      value={draft.scenario}
                      maxLength={LIMITS.scenario}
                      placeholder="例如：新员工入职"
                      onChange={(event) => updateDraft({ scenario: event.target.value })}
                    />
                  </label>
                  <label>
                    <span>分类</span>
                    <input
                      value={draft.category}
                      maxLength={LIMITS.category}
                      placeholder="例如：人事 / 门店 / 客诉"
                      onChange={(event) => updateDraft({ category: event.target.value })}
                    />
                  </label>
                  <label className={styles.fullField}>
                    <span>标签</span>
                    <input
                      value={draft.tagsText}
                      placeholder="用逗号分隔，最多 10 项"
                      onChange={(event) => updateDraft({ tagsText: event.target.value })}
                    />
                  </label>
                  <label className={styles.fullField}>
                    <span>流程说明</span>
                    <textarea
                      value={draft.description}
                      maxLength={LIMITS.description}
                      rows={4}
                      placeholder="说明流程目标、适用边界和完成标准。"
                      onChange={(event) => updateDraft({ description: event.target.value })}
                    />
                  </label>
                </div>

                <div className={styles.stepsEditor}>
                  <div className={styles.stepsHeader}>
                    <div>
                      <h4>执行步骤</h4>
                      <p>步骤将按照这里的顺序展示给员工。</p>
                    </div>
                    <button
                      type="button"
                      className={styles.secondaryButton}
                      disabled={busy || draft.steps.length >= LIMITS.steps}
                      onClick={addStep}
                    >
                      添加步骤
                    </button>
                  </div>
                  {draft.steps.length === 0 ? (
                    <button type="button" className={styles.emptySteps} onClick={addStep}>
                      <strong>还没有步骤</strong>
                      <span>点击添加第一步，发布前至少需要一个步骤。</span>
                    </button>
                  ) : (
                    <ol className={styles.editableSteps}>
                      {draft.steps.map((step, index) => (
                        <li key={step.id} className={styles.stepEditorCard}>
                          <div className={styles.stepNumber}>{index + 1}</div>
                          <div className={styles.stepFields}>
                            <label>
                              <span>步骤标题 *</span>
                              <input
                                value={step.title}
                                maxLength={LIMITS.stepTitle}
                                placeholder="这一阶段要完成什么"
                                onChange={(event) =>
                                  updateDraftStep(step.id, { title: event.target.value })
                                }
                              />
                            </label>
                            <label>
                              <span>操作说明 *</span>
                              <textarea
                                value={step.instruction}
                                maxLength={LIMITS.stepInstruction}
                                rows={3}
                                placeholder="写清执行方法、注意事项和完成标准。"
                                onChange={(event) =>
                                  updateDraftStep(step.id, { instruction: event.target.value })
                                }
                              />
                            </label>
                          </div>
                          <div className={styles.stepActions} aria-label={`调整第 ${index + 1} 步`}>
                            <button
                              type="button"
                              title="上移"
                              aria-label={`将第 ${index + 1} 步上移`}
                              disabled={busy || index === 0}
                              onClick={() => moveStep(step.id, -1)}
                            >
                              ↑
                            </button>
                            <button
                              type="button"
                              title="下移"
                              aria-label={`将第 ${index + 1} 步下移`}
                              disabled={busy || index === draft.steps.length - 1}
                              onClick={() => moveStep(step.id, 1)}
                            >
                              ↓
                            </button>
                            <button
                              type="button"
                              className={styles.removeStepButton}
                              title="删除"
                              aria-label={`删除第 ${index + 1} 步`}
                              disabled={busy}
                              onClick={() => removeStep(step.id)}
                            >
                              ×
                            </button>
                          </div>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>

                <div className={styles.editorFooter}>
                  <span className={isDirty ? styles.unsavedText : styles.savedText}>
                    {isDirty ? "有尚未保存的修改" : "所有修改已保存"}
                  </span>
                  <div>
                    <button type="submit" className={styles.secondaryButton} disabled={busy || !isDirty}>
                      {busy ? "处理中..." : "保存草稿"}
                    </button>
                    {canPublish ? (
                      <button
                        type="button"
                        className={styles.primaryButton}
                        disabled={busy}
                        onClick={() => void saveDraft({ publishing: true })}
                      >
                        {busy ? "处理中..." : "保存并发布"}
                      </button>
                    ) : null}
                  </div>
                </div>
              </form>
            ) : selectedWorkflow ? (
              <article className={styles.workflowDetail}>
                <div className={styles.contentHeading}>
                  <div>
                    <span className={styles.eyebrow}>{selectedWorkflow.category || "Standard procedure"}</span>
                    <h3>{selectedWorkflow.title}</h3>
                    <p>{selectedWorkflow.scenario || "未设置适用场景"}</p>
                  </div>
                  <span className={`${styles.statusBadge} ${styles[`status_${selectedWorkflow.status}`]}`}>
                    {workflowStatusLabel(selectedWorkflow)}
                  </span>
                </div>

                {selectedWorkflow.description ? (
                  <p className={styles.description}>{selectedWorkflow.description}</p>
                ) : null}

                <dl className={styles.metadata}>
                  <div>
                    <dt>当前版本</dt>
                    <dd>v{selectedWorkflow.version}</dd>
                  </div>
                  <div>
                    <dt>已发布版本</dt>
                    <dd>{selectedWorkflow.publishedVersion ? `v${selectedWorkflow.publishedVersion}` : "未发布"}</dd>
                  </div>
                  <div>
                    <dt>发布时间</dt>
                    <dd>{formatDate(selectedWorkflow.publishedAt)}</dd>
                  </div>
                  <div>
                    <dt>最近更新</dt>
                    <dd>{formatDate(selectedWorkflow.updatedAt)}</dd>
                  </div>
                </dl>

                {selectedWorkflow.tags.length > 0 ? (
                  <div className={styles.detailTags}>
                    {selectedWorkflow.tags.map((tag) => (
                      <span key={tag}>#{tag}</span>
                    ))}
                  </div>
                ) : null}

                <div className={styles.stepsView}>
                  <div className={styles.stepsHeader}>
                    <div>
                      <h4>执行步骤</h4>
                      <p>按顺序完成以下 {selectedWorkflow.steps.length} 个步骤。</p>
                    </div>
                  </div>
                  {selectedWorkflow.steps.length === 0 ? (
                    <div className={styles.readonlyEmpty}>此草稿还没有添加步骤。</div>
                  ) : (
                    <ol>
                      {selectedWorkflow.steps.map((step, index) => (
                        <li key={step.id}>
                          <span className={styles.stepNumber}>{index + 1}</span>
                          <div>
                            <h5>{step.title}</h5>
                            {step.instruction ? <p>{step.instruction}</p> : null}
                          </div>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>

                {canManage || canPublish ? (
                  <div className={styles.detailActions}>
                    {canManage && selectedWorkflow.status !== "archived" ? (
                      <button
                        type="button"
                        className={styles.secondaryButton}
                        disabled={busy}
                        onClick={() => beginEdit(selectedWorkflow)}
                      >
                        编辑草稿
                      </button>
                    ) : null}
                    {canPublish && selectedWorkflow.status === "archived" ? (
                      <button
                        type="button"
                        className={styles.secondaryButton}
                        disabled={busy}
                        onClick={() => void changeWorkflowStatus(selectedWorkflow, "restore")}
                      >
                        恢复流程
                      </button>
                    ) : null}
                    {canPublish &&
                    selectedWorkflow.status !== "archived" &&
                    (selectedWorkflow.status === "draft" || selectedWorkflow.hasUnpublishedChanges) ? (
                      <button
                        type="button"
                        className={styles.primaryButton}
                        disabled={busy || selectedWorkflow.steps.length === 0}
                        onClick={() => void changeWorkflowStatus(selectedWorkflow, "publish")}
                      >
                        发布当前草稿
                      </button>
                    ) : null}
                    {canPublish && selectedWorkflow.status !== "archived" ? (
                      <button
                        type="button"
                        className={styles.dangerButton}
                        disabled={busy}
                        onClick={() => void changeWorkflowStatus(selectedWorkflow, "archive")}
                      >
                        归档
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </article>
            ) : (
              <div className={styles.stateCard}>请选择一个流程查看步骤。</div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
