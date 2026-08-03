"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClientMutationOperationId } from "@/lib/mutationOperationId";
import type {
  EnterpriseWorkflow,
  EnterpriseWorkflowApiFetch,
  EnterpriseWorkflowStep,
} from "./EnterpriseWorkflowsPanel";

const REVISION_API = "/api/merchant-enterprise/workflow-revisions";
const PERMISSION_GAP_API = "/api/merchant-enterprise/workflow-permission-gaps";
const WORKFLOW_PERMISSIONS = [
  "workflows.view",
  "workflows.manage",
  "workflows.publish",
] as const;

type WorkflowPermission = (typeof WORKFLOW_PERMISSIONS)[number];

type RevisionSummary = {
  id: string;
  revisionNo: number;
  publishedAt: string;
  title: string;
  scenario: string;
  category: string;
  tags: string[];
  stepCount: number;
  isCurrent: boolean;
};

type RevisionSnapshot = {
  title: string;
  scenario: string;
  description: string;
  category: string;
  tags: string[];
  steps: EnterpriseWorkflowStep[];
};

type RevisionDetail = {
  id: string;
  revisionNo: number;
  publishedAt: string;
  snapshot: RevisionSnapshot;
};

type PermissionGap = {
  roleId: string;
  name: string;
  systemKey: string;
  isSystem: boolean;
  version: number;
  permissions: string[];
  recommendedWorkflowPermissions: WorkflowPermission[];
  missingWorkflowPermissions: WorkflowPermission[];
  classification: "system_default_gap" | "custom_role_review";
  employeeCount: number;
};

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown, max = 5_000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function positiveInteger(value: unknown) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
}

function stringArray(value: unknown, maxItems = 50, maxLength = 160) {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(value.map((item) => text(item, maxLength)).filter(Boolean)),
  ).slice(0, maxItems);
}

function normalizeStep(value: unknown, fallbackPosition: number): EnterpriseWorkflowStep | null {
  const row = object(value);
  if (!row) return null;
  const id = text(row.id, 80);
  const title = text(row.title, 160);
  if (!id || !title) return null;
  return {
    id,
    title,
    instruction: text(row.instruction, 4_000),
    position: Number.isSafeInteger(Number(row.position))
      ? Math.max(0, Number(row.position))
      : fallbackPosition,
  };
}

function normalizeSnapshot(value: unknown): RevisionSnapshot | null {
  const row = object(value);
  if (!row) return null;
  const title = text(row.title, 160);
  const scenario = text(row.scenario, 500);
  if (!title || !scenario) return null;
  const steps = (Array.isArray(row.steps) ? row.steps : [])
    .map(normalizeStep)
    .filter((step): step is EnterpriseWorkflowStep => Boolean(step))
    .sort((left, right) => left.position - right.position || left.id.localeCompare(right.id));
  return {
    title,
    scenario,
    description: text(row.description, 5_000),
    category: text(row.category, 80),
    tags: stringArray(row.tags, 10, 40),
    steps,
  };
}

function normalizeRevisionSummary(value: unknown): RevisionSummary | null {
  const row = object(value);
  if (!row) return null;
  const id = text(row.id, 80);
  const revisionNo = positiveInteger(row.revisionNo ?? row.revision_no);
  const publishedAt = text(row.publishedAt ?? row.published_at, 80);
  const title = text(row.title, 160);
  if (!id || !revisionNo || !publishedAt || !title) return null;
  return {
    id,
    revisionNo,
    publishedAt,
    title,
    scenario: text(row.scenario, 500),
    category: text(row.category, 80),
    tags: stringArray(row.tags, 10, 40),
    stepCount: Math.max(0, Number(row.stepCount ?? row.step_count) || 0),
    isCurrent: row.isCurrent === true || row.is_current === true,
  };
}

function normalizeRevisionDetail(value: unknown): RevisionDetail | null {
  const row = object(value);
  if (!row) return null;
  const id = text(row.id, 80);
  const revisionNo = positiveInteger(row.revisionNo ?? row.revision_no);
  const publishedAt = text(row.publishedAt ?? row.published_at, 80);
  const snapshot = normalizeSnapshot(row.snapshot);
  if (!id || !revisionNo || !publishedAt || !snapshot) return null;
  return { id, revisionNo, publishedAt, snapshot };
}

function normalizePermission(value: unknown): WorkflowPermission | null {
  return WORKFLOW_PERMISSIONS.includes(value as WorkflowPermission)
    ? (value as WorkflowPermission)
    : null;
}

function normalizePermissionGap(value: unknown): PermissionGap | null {
  const row = object(value);
  if (!row) return null;
  const roleId = text(row.roleId ?? row.role_id, 80);
  const name = text(row.name, 80);
  const version = positiveInteger(row.version);
  const classification = row.classification;
  if (
    !roleId ||
    !name ||
    !version ||
    (classification !== "system_default_gap" && classification !== "custom_role_review")
  ) {
    return null;
  }
  const recommendedWorkflowPermissions = (Array.isArray(row.recommendedWorkflowPermissions)
    ? row.recommendedWorkflowPermissions
    : Array.isArray(row.recommended_workflow_permissions)
      ? row.recommended_workflow_permissions
      : [])
    .map(normalizePermission)
    .filter((permission): permission is WorkflowPermission => Boolean(permission));
  const missingWorkflowPermissions = (Array.isArray(row.missingWorkflowPermissions)
    ? row.missingWorkflowPermissions
    : Array.isArray(row.missing_workflow_permissions)
      ? row.missing_workflow_permissions
      : [])
    .map(normalizePermission)
    .filter((permission): permission is WorkflowPermission => Boolean(permission));
  return {
    roleId,
    name,
    systemKey: text(row.systemKey ?? row.system_key, 80),
    isSystem: row.isSystem === true || row.is_system === true,
    version,
    permissions: stringArray(row.permissions, 100, 80),
    recommendedWorkflowPermissions,
    missingWorkflowPermissions,
    classification,
    employeeCount: Math.max(0, Number(row.employeeCount ?? row.employee_count) || 0),
  };
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

function apiError(payload: unknown, fallback: string) {
  const code = text(object(payload)?.error, 120);
  if (code === "permission_denied" || code === "merchant_access_denied") {
    return "当前账号没有执行此操作的权限。";
  }
  if (code === "workflow_not_found" || code === "workflow_revision_not_found") {
    return "流程或该历史版本已不存在。";
  }
  if (code === "enterprise_version_conflict" || code === "workflow_version_conflict") {
    return "流程已被其他成员更新，请刷新后重试。";
  }
  if (code === "role_not_found") return "角色已不存在，请刷新后重试。";
  if (code === "role_version_conflict" || code === "enterprise_role_version_conflict") {
    return "角色权限已被其他成员更新，请刷新后重试。";
  }
  if (
    code === "invalid_role_permissions" ||
    code === "invalid_permission_gap_request" ||
    code === "invalid_permission_dependencies" ||
    code === "invalid_workflow_permission_grant"
  ) {
    return "所选权限缺少依赖，请重新选择。";
  }
  return fallback;
}

function snapshotChanges(current: RevisionSnapshot, previous: RevisionSnapshot | null) {
  if (!previous) {
    return {
      fields: ["首个发布版本"],
      added: current.steps,
      changed: [] as EnterpriseWorkflowStep[],
      removed: [] as EnterpriseWorkflowStep[],
    };
  }
  const fields: string[] = [];
  if (current.title !== previous.title) fields.push("名称");
  if (current.scenario !== previous.scenario) fields.push("适用场景");
  if (current.description !== previous.description) fields.push("说明");
  if (current.category !== previous.category) fields.push("分类");
  if (JSON.stringify(current.tags) !== JSON.stringify(previous.tags)) fields.push("标签");
  const previousById = new Map(previous.steps.map((step) => [step.id, step]));
  const currentById = new Map(current.steps.map((step) => [step.id, step]));
  const added = current.steps.filter((step) => !previousById.has(step.id));
  const removed = previous.steps.filter((step) => !currentById.has(step.id));
  const changed = current.steps.filter((step) => {
    const before = previousById.get(step.id);
    return Boolean(
      before &&
        (before.title !== step.title ||
          before.instruction !== step.instruction ||
          before.position !== step.position),
    );
  });
  return { fields, added, changed, removed };
}

export function WorkflowRevisionHistory({
  siteId,
  workflow,
  apiFetch,
  canManage,
  onRestored,
}: {
  siteId: string;
  workflow: EnterpriseWorkflow;
  apiFetch: EnterpriseWorkflowApiFetch;
  canManage: boolean;
  onRestored: (workflow: unknown, revisionNo: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [revisions, setRevisions] = useState<RevisionSummary[]>([]);
  const [listScope, setListScope] = useState("");
  const [nextBeforeRevision, setNextBeforeRevision] = useState<number | null>(null);
  const [detail, setDetail] = useState<RevisionDetail | null>(null);
  const [previous, setPrevious] = useState<RevisionDetail | null>(null);
  const [detailScope, setDetailScope] = useState("");
  const [canRestore, setCanRestore] = useState(false);
  const workflowScope = `${siteId}:${workflow.id}:${workflow.publishedVersion}`;
  const workflowScopeRef = useRef(workflowScope);
  const listRequestRef = useRef(0);
  const detailRequestRef = useRef(0);
  const restoreRequestRef = useRef(0);
  workflowScopeRef.current = workflowScope;

  const scopedRevisions = listScope === workflowScope ? revisions : [];
  const scopedNextBeforeRevision = listScope === workflowScope ? nextBeforeRevision : null;
  const scopedDetail = detailScope === workflowScope ? detail : null;
  const scopedPrevious = detailScope === workflowScope ? previous : null;

  const loadList = useCallback(
    async (append = false) => {
      const requestScope = workflowScope;
      const requestId = ++listRequestRef.current;
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams({
          siteId,
          workflowId: workflow.id,
          limit: "20",
        });
        if (append && scopedNextBeforeRevision) {
          params.set("beforeRevision", String(scopedNextBeforeRevision));
        }
        const response = await apiFetch(`${REVISION_API}?${params.toString()}`);
        const payload = (await response.json().catch(() => null)) as unknown;
        const body = object(payload);
        const items = (Array.isArray(body?.revisions) ? body.revisions : [])
          .map(normalizeRevisionSummary)
          .filter((item): item is RevisionSummary => Boolean(item));
        if (!response.ok || body?.ok !== true) {
          throw new Error(apiError(payload, "版本历史加载失败，请稍后重试。"));
        }
        if (
          workflowScopeRef.current !== requestScope ||
          listRequestRef.current !== requestId
        ) {
          return;
        }
        setListScope(requestScope);
        setRevisions((current) => {
          const merged = new Map<number, RevisionSummary>();
          const currentItems = listScope === requestScope ? current : [];
          for (const item of append ? [...currentItems, ...items] : items) {
            merged.set(item.revisionNo, item);
          }
          return [...merged.values()].sort((left, right) => right.revisionNo - left.revisionNo);
        });
        const next = body?.nextBeforeRevision ?? body?.next_before_revision;
        setNextBeforeRevision(positiveInteger(next) || null);
      } catch (caught) {
        if (
          workflowScopeRef.current === requestScope &&
          listRequestRef.current === requestId
        ) {
          setError(caught instanceof Error ? caught.message : "版本历史加载失败，请稍后重试。");
        }
      } finally {
        if (
          workflowScopeRef.current === requestScope &&
          listRequestRef.current === requestId
        ) {
          setLoading(false);
        }
      }
    },
    [apiFetch, listScope, scopedNextBeforeRevision, siteId, workflow.id, workflowScope],
  );

  useEffect(() => {
    listRequestRef.current += 1;
    detailRequestRef.current += 1;
    restoreRequestRef.current += 1;
    setLoading(false);
    setBusy(false);
    setOpen(false);
    setRevisions([]);
    setListScope("");
    setNextBeforeRevision(null);
    setDetail(null);
    setPrevious(null);
    setDetailScope("");
    setCanRestore(false);
    setError("");
    setNotice("");
  }, [siteId, workflow.id, workflow.publishedVersion]);

  async function toggleOpen() {
    const next = !open;
    setOpen(next);
    setDetail(null);
    setPrevious(null);
    setError("");
    if (next && scopedRevisions.length === 0) await loadList(false);
  }

  async function loadDetail(revisionNo: number) {
    const requestScope = workflowScope;
    const requestId = ++detailRequestRef.current;
    setLoading(true);
    setError("");
    setNotice("");
    try {
      const params = new URLSearchParams({
        siteId,
        workflowId: workflow.id,
        revision: String(revisionNo),
      });
      const response = await apiFetch(`${REVISION_API}?${params.toString()}`);
      const payload = (await response.json().catch(() => null)) as unknown;
      const body = object(payload);
      const nextDetail = normalizeRevisionDetail(body?.revision);
      const nextPrevious = body?.previousRevision
        ? normalizeRevisionDetail(body.previousRevision)
        : body?.previous_revision
          ? normalizeRevisionDetail(body.previous_revision)
          : null;
      if (!response.ok || body?.ok !== true || !nextDetail) {
        throw new Error(apiError(payload, "历史版本详情加载失败，请稍后重试。"));
      }
      if (
        workflowScopeRef.current !== requestScope ||
        detailRequestRef.current !== requestId
      ) {
        return;
      }
      setDetail(nextDetail);
      setPrevious(nextPrevious);
      setDetailScope(requestScope);
      const workflowMeta = object(body.workflow);
      setCanRestore(workflowMeta?.canRestore === true || workflowMeta?.can_restore === true);
    } catch (caught) {
      if (
        workflowScopeRef.current === requestScope &&
        detailRequestRef.current === requestId
      ) {
        setError(caught instanceof Error ? caught.message : "历史版本详情加载失败，请稍后重试。");
      }
    } finally {
      if (
        workflowScopeRef.current === requestScope &&
        detailRequestRef.current === requestId
      ) {
        setLoading(false);
      }
    }
  }

  async function restoreRevision() {
    if (!scopedDetail || !canManage || !canRestore || busy) return;
    const restoreScope = workflowScope;
    const revisionNo = scopedDetail.revisionNo;
    if (
      typeof window !== "undefined" &&
      !window.confirm(
        `将 v${revisionNo} 的内容复制为当前草稿？已发布版本不会立即改变，需再次发布后才对员工生效。`,
      )
    ) {
      return;
    }
    const requestId = ++restoreRequestRef.current;
    const isCurrentRestore = () =>
      workflowScopeRef.current === restoreScope &&
      restoreRequestRef.current === requestId;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await apiFetch(REVISION_API, {
        method: "POST",
        body: JSON.stringify({
          siteId,
          workflowId: workflow.id,
          revision: revisionNo,
          version: workflow.version,
          action: "restore_to_draft",
          operationId: createClientMutationOperationId("enterprise-workflow-revision-restore"),
        }),
      });
      const payload = (await response.json().catch(() => null)) as unknown;
      const body = object(payload);
      if (!response.ok || body?.ok !== true || !body.workflow) {
        throw new Error(apiError(payload, "历史版本恢复失败，请稍后重试。"));
      }
      if (!isCurrentRestore()) return;
      setNotice(`v${revisionNo} 已复制为新草稿。`);
      onRestored(body.workflow, revisionNo);
    } catch (caught) {
      if (isCurrentRestore()) {
        setError(caught instanceof Error ? caught.message : "历史版本恢复失败，请稍后重试。");
      }
    } finally {
      if (isCurrentRestore()) setBusy(false);
    }
  }

  const changes = useMemo(
    () =>
      scopedDetail
        ? snapshotChanges(scopedDetail.snapshot, scopedPrevious?.snapshot ?? null)
        : null,
    [scopedDetail, scopedPrevious],
  );

  if (workflow.publishedVersion < 1) return null;

  return (
    <section className="rounded-2xl border border-slate-200 bg-slate-50 p-4" data-workflow-revision-history>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h4 className="font-semibold text-slate-950">版本历史</h4>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            查看每次发布的不可变快照；恢复只会创建草稿，不会直接覆盖员工正在使用的版本。
          </p>
        </div>
        <button
          type="button"
          className="min-h-10 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-45"
          disabled={loading || busy}
          aria-expanded={open}
          onClick={() => void toggleOpen()}
        >
          {open ? "收起历史" : "查看版本历史"}
        </button>
      </div>

      {open ? (
        <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(220px,0.8fr)_minmax(0,1.5fr)]">
          <div className="space-y-2">
            {scopedRevisions.map((revision) => (
              <button
                key={revision.id}
                type="button"
                className={`w-full rounded-xl border px-3 py-3 text-left transition ${
                  scopedDetail?.revisionNo === revision.revisionNo
                    ? "border-blue-400 bg-blue-50"
                    : "border-slate-200 bg-white hover:border-blue-200"
                }`}
                disabled={loading || busy}
                onClick={() => void loadDetail(revision.revisionNo)}
              >
                <span className="flex items-center justify-between gap-2 text-sm font-semibold text-slate-900">
                  <span>v{revision.revisionNo}</span>
                  {revision.isCurrent ? (
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] text-emerald-700">当前发布</span>
                  ) : null}
                </span>
                <span className="mt-1 block text-xs text-slate-500">
                  {formatDate(revision.publishedAt)} · {revision.stepCount} 步
                </span>
              </button>
            ))}
            {!loading && revisions.length === 0 && !error ? (
              <div className="rounded-xl border border-dashed border-slate-300 px-3 py-6 text-center text-sm text-slate-500">
                暂无发布历史。
              </div>
            ) : null}
            {scopedNextBeforeRevision ? (
              <button
                type="button"
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-600 disabled:opacity-45"
                disabled={loading || busy}
                onClick={() => void loadList(true)}
              >
                加载更早版本
              </button>
            ) : null}
          </div>

          <div className="min-w-0 rounded-xl border border-slate-200 bg-white p-4">
            {scopedDetail && changes ? (
              <>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h5 className="font-semibold text-slate-950">v{scopedDetail.revisionNo} 发布内容</h5>
                    <p className="mt-1 text-xs text-slate-500">{formatDate(scopedDetail.publishedAt)}</p>
                  </div>
                  {canManage && canRestore ? (
                    <button
                      type="button"
                      className="min-h-10 rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-45"
                      disabled={busy || loading}
                      onClick={() => void restoreRevision()}
                    >
                      {busy ? "恢复中…" : "复制为当前草稿"}
                    </button>
                  ) : null}
                </div>
                <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                  <div><dt className="text-xs text-slate-500">流程名称</dt><dd className="mt-1 font-medium text-slate-900">{scopedDetail.snapshot.title}</dd></div>
                  <div><dt className="text-xs text-slate-500">适用场景</dt><dd className="mt-1 text-slate-700">{scopedDetail.snapshot.scenario}</dd></div>
                </dl>
                <div className="mt-4 flex flex-wrap gap-2 text-xs">
                  {changes.fields.map((field) => <span key={field} className="rounded-full bg-blue-50 px-2.5 py-1 text-blue-700">{field}有变化</span>)}
                  {changes.added.length > 0 ? <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-emerald-700">新增 {changes.added.length} 步</span> : null}
                  {changes.changed.length > 0 ? <span className="rounded-full bg-amber-50 px-2.5 py-1 text-amber-700">修改 {changes.changed.length} 步</span> : null}
                  {changes.removed.length > 0 ? <span className="rounded-full bg-rose-50 px-2.5 py-1 text-rose-700">移除 {changes.removed.length} 步</span> : null}
                  {changes.fields.length + changes.added.length + changes.changed.length + changes.removed.length === 0 ? (
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-600">与上一版内容一致</span>
                  ) : null}
                </div>
                <ol className="mt-4 space-y-2">
                  {scopedDetail.snapshot.steps.map((step, index) => (
                    <li key={step.id} className="rounded-xl border border-slate-200 px-3 py-3">
                      <div className="text-sm font-semibold text-slate-900">{index + 1}. {step.title}</div>
                      <p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-slate-600">{step.instruction}</p>
                    </li>
                  ))}
                </ol>
              </>
            ) : (
              <div className="grid min-h-40 place-items-center text-center text-sm text-slate-500">
                {loading ? "正在读取版本…" : "选择一个版本查看内容和变化。"}
              </div>
            )}
          </div>
        </div>
      ) : null}
      {error ? <div role="alert" className="mt-3 text-sm text-rose-700">{error}</div> : null}
      {notice ? <div role="status" className="mt-3 text-sm text-emerald-700">{notice}</div> : null}
    </section>
  );
}

export function WorkflowPermissionGapCard({
  siteId,
  actorType,
  apiFetch,
  onChanged,
}: {
  siteId: string;
  actorType: "owner" | "employee";
  apiFetch: EnterpriseWorkflowApiFetch;
  onChanged?: () => void | Promise<void>;
}) {
  const [loading, setLoading] = useState(actorType === "owner");
  const [busyRoleId, setBusyRoleId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [gaps, setGaps] = useState<PermissionGap[]>([]);
  const [selection, setSelection] = useState<Record<string, WorkflowPermission[]>>({});

  const load = useCallback(async () => {
    if (actorType !== "owner") return;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ siteId });
      const response = await apiFetch(`${PERMISSION_GAP_API}?${params.toString()}`);
      const payload = (await response.json().catch(() => null)) as unknown;
      const body = object(payload);
      const nextGaps = (Array.isArray(body?.gaps) ? body.gaps : [])
        .map(normalizePermissionGap)
        .filter((gap): gap is PermissionGap => Boolean(gap));
      if (!response.ok || body?.ok !== true) {
        throw new Error(apiError(payload, "流程权限检查失败，请稍后重试。"));
      }
      setGaps(nextGaps);
      setSelection(
        Object.fromEntries(
          nextGaps.map((gap) => [gap.roleId, gap.recommendedWorkflowPermissions]),
        ),
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "流程权限检查失败，请稍后重试。");
    } finally {
      setLoading(false);
    }
  }, [actorType, apiFetch, siteId]);

  useEffect(() => {
    void load();
  }, [load]);

  function togglePermission(roleId: string, permission: WorkflowPermission, checked: boolean) {
    setSelection((current) => {
      let next = new Set(current[roleId] ?? []);
      if (checked) {
        next.add("workflows.view");
        next.add(permission);
      } else {
        next.delete(permission);
        if (permission === "workflows.view") {
          next = new Set();
        }
      }
      return { ...current, [roleId]: WORKFLOW_PERMISSIONS.filter((item) => next.has(item)) };
    });
  }

  async function grant(gap: PermissionGap) {
    const selected = selection[gap.roleId] ?? [];
    if (selected.length === 0 || busyRoleId) return;
    if (
      typeof window !== "undefined" &&
      !window.confirm(
        `确认给“${gap.name}”角色新增：${selected.map((item) => item.replace("workflows.", "")).join("、")}？该角色下 ${gap.employeeCount} 名员工会立即获得相应能力。`,
      )
    ) {
      return;
    }
    setBusyRoleId(gap.roleId);
    setError("");
    setNotice("");
    try {
      const response = await apiFetch(PERMISSION_GAP_API, {
        method: "POST",
        body: JSON.stringify({
          siteId,
          roleId: gap.roleId,
          version: gap.version,
          workflowPermissions: selected,
          operationId: createClientMutationOperationId("enterprise-workflow-permission-grant"),
        }),
      });
      const payload = (await response.json().catch(() => null)) as unknown;
      const body = object(payload);
      if (!response.ok || body?.ok !== true) {
        throw new Error(apiError(payload, "角色流程权限保存失败，请稍后重试。"));
      }
      setNotice(`“${gap.name}”的流程权限已更新。`);
      await Promise.resolve(onChanged?.());
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "角色流程权限保存失败，请稍后重试。");
    } finally {
      setBusyRoleId("");
    }
  }

  if (actorType !== "owner") return null;

  return (
    <section className="rounded-3xl border border-cyan-200 bg-cyan-50/70 p-5 shadow-sm" data-workflow-permission-gaps>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-950">旧角色流程权限检查</h2>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            这里只检测历史角色，不会自动提权。请核对每个角色后再明确授权。
          </p>
        </div>
        <button
          type="button"
          className="min-h-10 rounded-xl border border-cyan-300 bg-white px-4 py-2 text-sm font-semibold text-cyan-800 disabled:opacity-45"
          disabled={loading || Boolean(busyRoleId)}
          onClick={() => void load()}
        >
          {loading ? "检查中…" : "重新检查"}
        </button>
      </div>

      {!loading && gaps.length === 0 && !error ? (
        <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          当前角色均已完成工作流程权限配置。
        </div>
      ) : null}

      <div className="mt-4 space-y-3">
        {gaps.map((gap) => {
          const selected = selection[gap.roleId] ?? [];
          return (
            <article key={gap.roleId} className="rounded-2xl border border-cyan-200 bg-white p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="font-semibold text-slate-950">{gap.name}</h3>
                  <p className="mt-1 text-xs text-slate-500">
                    {gap.employeeCount} 名员工 · {gap.classification === "system_default_gap" ? "历史系统角色" : "自定义角色，请人工复核"}
                  </p>
                </div>
                <button
                  type="button"
                  className="min-h-10 rounded-xl bg-cyan-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-45"
                  disabled={busyRoleId === gap.roleId || selected.length === 0}
                  onClick={() => void grant(gap)}
                >
                  {busyRoleId === gap.roleId ? "保存中…" : "确认授予所选权限"}
                </button>
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                {WORKFLOW_PERMISSIONS.filter((permission) => gap.missingWorkflowPermissions.includes(permission)).map((permission) => (
                  <label key={permission} className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={selected.includes(permission)}
                      disabled={Boolean(busyRoleId)}
                      onChange={(event) => togglePermission(gap.roleId, permission, event.target.checked)}
                    />
                    {permission === "workflows.view" ? "查看流程" : permission === "workflows.manage" ? "编写流程" : "发布流程"}
                  </label>
                ))}
              </div>
            </article>
          );
        })}
      </div>
      {error ? <div role="alert" className="mt-3 text-sm text-rose-700">{error}</div> : null}
      {notice ? <div role="status" className="mt-3 text-sm text-emerald-700">{notice}</div> : null}
    </section>
  );
}
