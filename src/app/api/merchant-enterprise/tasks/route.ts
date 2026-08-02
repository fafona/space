import { NextResponse } from "next/server";
import {
  hasMerchantEnterprisePermission,
  MAX_MERCHANT_TASK_ASSIGNEES,
} from "@/lib/merchantEnterprise";
import {
  requireMerchantEnterpriseEntitlement,
  requireMerchantEnterpriseBoardAccess,
  resolveMerchantEnterpriseActor,
  toMerchantEnterpriseAccessResponse,
} from "@/lib/merchantEnterpriseAuth.server";
import {
  createMerchantTask,
  loadMerchantTaskBoardIdForAccess,
  moveMerchantTask,
  updateMerchantTask,
  type MerchantEnterpriseStoreClient,
} from "@/lib/merchantEnterpriseStore.server";
import { isMerchantNumericId } from "@/lib/merchantIdentity";
import {
  getTrustedMutationRequestErrorResponse,
  isTrustedSameOriginMutationRequest,
} from "@/lib/requestMutationGuard";
import { createServerSupabaseServiceClient } from "@/lib/superAdminServer";
import { normalizeMutationOperationId } from "@/lib/mutationOperationId";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type TaskBody = {
  siteId?: unknown;
  taskId?: unknown;
  version?: unknown;
  boardId?: unknown;
  columnId?: unknown;
  title?: unknown;
  description?: unknown;
  priority?: unknown;
  dueAt?: unknown;
  position?: unknown;
  targetIndex?: unknown;
  archived?: unknown;
  assigneeIds?: unknown;
  sourceType?: unknown;
  sourceId?: unknown;
  operationId?: unknown;
};

function text(value: unknown, max = 4096) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function uuid(value: unknown, error = "invalid_task_id") {
  const normalized = text(value, 80);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized)) {
    throw new Error(error);
  }
  return normalized;
}

function client() {
  const value = createServerSupabaseServiceClient();
  if (!value) throw new Error("enterprise_store_unavailable");
  return value as unknown as MerchantEnterpriseStoreClient;
}

export function getMerchantTaskErrorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message === "task_not_found" || message === "board_not_found") {
    return NextResponse.json({ ok: false, error: message }, { status: 404 });
  }
  if (message === "permission_denied") {
    return NextResponse.json({ ok: false, error: message }, { status: 403 });
  }
  const resolved = toMerchantEnterpriseAccessResponse(error);
  return NextResponse.json(resolved.body, { status: resolved.status });
}

function priority(value: unknown, allowMissing = true) {
  if (allowMissing && value === undefined) return "normal" as const;
  if (value === "low" || value === "normal" || value === "high" || value === "urgent") return value;
  throw new Error("invalid_task_priority");
}

function assignees(value: unknown) {
  if (!Array.isArray(value) || value.length > MAX_MERCHANT_TASK_ASSIGNEES) {
    throw new Error("invalid_task_assignees");
  }
  const values = value.map((item) => uuid(item, "invalid_task_assignees"));
  return Array.from(new Set(values));
}

function hasOwn(body: TaskBody | null, key: keyof TaskBody) {
  return Boolean(body && Object.prototype.hasOwnProperty.call(body, key));
}

function hasSourceReferenceFields(body: TaskBody | null) {
  return hasOwn(body, "sourceType") || hasOwn(body, "sourceId");
}

function expectedVersion(value: unknown) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error("invalid_task_version");
  }
  return value;
}

function position(value: unknown) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error("invalid_task_position");
  return parsed;
}

function targetIndex(value: unknown) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > 10_000) {
    throw new Error("invalid_task_target_index");
  }
  return value;
}

function dueAt(value: unknown) {
  if (value === null || value === "") return null;
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new Error("invalid_task_due_at");
  }
  return new Date(value).toISOString();
}

function operationId(request: Request, body: TaskBody | null) {
  const raw = hasOwn(body, "operationId")
    ? body?.operationId
    : request.headers.get("idempotency-key");
  if (raw === undefined || raw === null || raw === "") return "";
  if (typeof raw !== "string") throw new Error("invalid_operation_id");
  const normalized = normalizeMutationOperationId(raw);
  if (!normalized) throw new Error("invalid_operation_id");
  return normalized;
}

export function getMerchantTaskPatchRequiredPermissions(body: TaskBody | null) {
  const required = [] as Array<"tasks.update" | "tasks.archive" | "tasks.assign">;
  if (
    hasOwn(body, "columnId") ||
    hasOwn(body, "title") ||
    hasOwn(body, "description") ||
    hasOwn(body, "priority") ||
    hasOwn(body, "dueAt") ||
    hasOwn(body, "position") ||
    hasOwn(body, "targetIndex")
  ) {
    required.push("tasks.update");
  }
  if (hasOwn(body, "archived")) required.push("tasks.archive");
  if (hasOwn(body, "assigneeIds")) required.push("tasks.assign");
  return required;
}

export async function POST(request: Request) {
  if (!isTrustedSameOriginMutationRequest(request)) return getTrustedMutationRequestErrorResponse();
  try {
    const body = (await request.json().catch(() => null)) as TaskBody | null;
    const siteId = text(body?.siteId, 80);
    if (!isMerchantNumericId(siteId)) {
      return NextResponse.json({ ok: false, error: "invalid_site_id" }, { status: 400 });
    }
    if (hasSourceReferenceFields(body)) throw new Error("invalid_task_source");
    const actor = await resolveMerchantEnterpriseActor(request, {
      siteId,
      requiredPermission: "tasks.create",
    });
    await requireMerchantEnterpriseEntitlement(siteId);
    const title = text(body?.title, 240);
    if (!title) throw new Error("invalid_task");
    if (hasOwn(body, "description") && typeof body?.description !== "string") {
      throw new Error("invalid_task_description");
    }
    const boardId = uuid(body?.boardId, "invalid_task_board");
    const columnId = uuid(body?.columnId, "invalid_task_column");
    requireMerchantEnterpriseBoardAccess(actor, boardId, "board_not_found");
    const requestedAssignees = hasOwn(body, "assigneeIds") ? assignees(body?.assigneeIds) : [];
    if (requestedAssignees.length > 0 && !hasMerchantEnterprisePermission(actor, "tasks.assign")) {
      return NextResponse.json({ ok: false, error: "permission_denied" }, { status: 403 });
    }
    const requestedPriority = priority(body?.priority);
    const requestedDueAt = hasOwn(body, "dueAt") ? dueAt(body?.dueAt) : null;
    const requestedPosition = hasOwn(body, "position") ? position(body?.position) : undefined;
    const task = await createMerchantTask(client(), {
      siteId,
      boardId,
      columnId,
      title,
      description: text(body?.description, 10000),
      priority: requestedPriority,
      dueAt: requestedDueAt,
      ...(requestedPosition !== undefined ? { position: requestedPosition } : {}),
      createdByEmployeeId: actor.type === "employee" ? actor.id : "",
      assigneeIds: requestedAssignees,
      actorType: actor.type,
      actorId: actor.id,
      operationId: operationId(request, body),
    });
    return NextResponse.json({ ok: true, task });
  } catch (error) {
    return getMerchantTaskErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  if (!isTrustedSameOriginMutationRequest(request)) return getTrustedMutationRequestErrorResponse();
  try {
    const body = (await request.json().catch(() => null)) as TaskBody | null;
    const siteId = text(body?.siteId, 80);
    if (!isMerchantNumericId(siteId)) {
      return NextResponse.json({ ok: false, error: "invalid_site_id" }, { status: 400 });
    }
    if (hasSourceReferenceFields(body)) throw new Error("invalid_task_source");
    const requiredPermissions = getMerchantTaskPatchRequiredPermissions(body);
    if (requiredPermissions.length === 0) throw new Error("invalid_task_update");
    if (hasOwn(body, "archived") && typeof body?.archived !== "boolean") {
      throw new Error("invalid_task_archived");
    }
    if (hasOwn(body, "columnId")) uuid(body?.columnId, "invalid_task_column");
    if (hasOwn(body, "title") && !text(body?.title, 240)) {
      throw new Error("invalid_task_title");
    }
    if (hasOwn(body, "description") && typeof body?.description !== "string") {
      throw new Error("invalid_task_description");
    }
    const parsedVersion = expectedVersion(body?.version);
    const requestedAssignees = hasOwn(body, "assigneeIds") ? assignees(body?.assigneeIds) : undefined;
    const requestedPriority = hasOwn(body, "priority") ? priority(body?.priority, false) : undefined;
    const requestedDueAt = hasOwn(body, "dueAt") ? dueAt(body?.dueAt) : undefined;
    const requestedPosition = hasOwn(body, "position") ? position(body?.position) : undefined;
    const requestedTargetIndex = hasOwn(body, "targetIndex")
      ? targetIndex(body?.targetIndex)
      : undefined;
    const taskId = uuid(body?.taskId);
    if (requestedTargetIndex !== undefined) {
      if (
        !hasOwn(body, "columnId") ||
        hasOwn(body, "title") ||
        hasOwn(body, "description") ||
        hasOwn(body, "priority") ||
        hasOwn(body, "dueAt") ||
        hasOwn(body, "position") ||
        hasOwn(body, "archived") ||
        hasOwn(body, "assigneeIds")
      ) {
        throw new Error("invalid_task_move");
      }
    } else if (hasOwn(body, "columnId") || requestedPosition !== undefined) {
      throw new Error("invalid_task_move");
    }
    const actor = await resolveMerchantEnterpriseActor(request, {
      siteId,
      requiredPermission: requiredPermissions[0],
    });
    await requireMerchantEnterpriseEntitlement(siteId);
    if (requiredPermissions.some((permission) => !hasMerchantEnterprisePermission(actor, permission))) {
      return NextResponse.json({ ok: false, error: "permission_denied" }, { status: 403 });
    }
    const enterpriseStore = client();
    const taskBoardId = await loadMerchantTaskBoardIdForAccess(
      enterpriseStore,
      siteId,
      taskId,
    );
    requireMerchantEnterpriseBoardAccess(actor, taskBoardId, "task_not_found");
    if (requestedTargetIndex !== undefined) {
      const task = await moveMerchantTask(enterpriseStore, {
        siteId,
        taskId,
        version: parsedVersion,
        columnId: uuid(body?.columnId, "invalid_task_column"),
        targetIndex: requestedTargetIndex,
        actorType: actor.type,
        actorId: actor.id,
        operationId: operationId(request, body),
      });
      return NextResponse.json({ ok: true, task });
    }
    const task = await updateMerchantTask(enterpriseStore, {
      siteId,
      taskId,
      version: parsedVersion,
      actorType: actor.type,
      actorId: actor.id,
      ...(body?.title !== undefined ? { title: text(body.title, 240) } : {}),
      ...(body?.description !== undefined ? { description: text(body.description, 10000) } : {}),
      ...(requestedPriority !== undefined ? { priority: requestedPriority } : {}),
      ...(requestedDueAt !== undefined ? { dueAt: requestedDueAt } : {}),
      ...(hasOwn(body, "archived") ? { archived: body?.archived as boolean } : {}),
      ...(requestedAssignees !== undefined ? { assigneeIds: requestedAssignees } : {}),
      operationId: operationId(request, body),
    });
    return NextResponse.json({ ok: true, task });
  } catch (error) {
    return getMerchantTaskErrorResponse(error);
  }
}
