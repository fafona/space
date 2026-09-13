import { NextResponse } from "next/server";
import {
  isMerchantEnterpriseVersion,
  MAX_MERCHANT_TASK_CHECKLIST_TEXT_LENGTH,
} from "@/lib/merchantEnterprise";
import {
  requireMerchantEnterpriseBoardAccess,
  resolveMerchantEnterpriseActor,
  toMerchantEnterpriseAccessResponse,
} from "@/lib/merchantEnterpriseAuth.server";
import {
  createMerchantTaskChecklistItem,
  loadMerchantTaskChecklistItems,
  loadMerchantTaskBoardIdForAccess,
  updateMerchantTaskChecklistItem,
  type MerchantEnterpriseStoreClient,
} from "@/lib/merchantEnterpriseStore.server";
import { isMerchantNumericId } from "@/lib/merchantIdentity";
import { normalizeMutationOperationId } from "@/lib/mutationOperationId";
import {
  getTrustedMutationRequestErrorResponse,
  isTrustedSameOriginMutationRequest,
} from "@/lib/requestMutationGuard";
import { createServerSupabaseServiceClient } from "@/lib/superAdminServer";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type TaskChecklistBody = {
  siteId?: unknown;
  taskId?: unknown;
  itemId?: unknown;
  version?: unknown;
  text?: unknown;
  completed?: unknown;
  archived?: unknown;
  operationId?: unknown;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NOT_FOUND_ERRORS = new Set([
  "task_not_found",
  "task_checklist_item_not_found",
]);
const CONFLICT_ERRORS = new Set([
  "enterprise_version_conflict",
  "enterprise_operation_in_progress",
  "task_checklist_limit_reached",
  "invalid_task_archived",
]);
const CREATE_FIELDS = new Set(["siteId", "taskId", "text", "operationId"]);
const UPDATE_FIELDS = new Set([
  "siteId",
  "taskId",
  "itemId",
  "version",
  "text",
  "completed",
  "archived",
  "operationId",
]);

function hasOwn(body: TaskChecklistBody | null, key: keyof TaskChecklistBody) {
  return Boolean(body && Object.prototype.hasOwnProperty.call(body, key));
}

function hasOnlyFields(body: TaskChecklistBody | null, allowed: ReadonlySet<string>) {
  return Boolean(
    body &&
      typeof body === "object" &&
      !Array.isArray(body) &&
      Object.keys(body).every((field) => allowed.has(field)),
  );
}

function requestedSiteId(value: unknown) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!isMerchantNumericId(normalized)) throw new Error("invalid_site_id");
  return normalized;
}

function uuid(value: unknown, error: "invalid_task_id" | "invalid_task_checklist_item_id") {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!UUID_PATTERN.test(normalized)) throw new Error(error);
  return normalized;
}

function checklistText(value: unknown) {
  if (typeof value !== "string") throw new Error("invalid_task_checklist_text");
  const normalized = value.trim();
  if (!normalized || normalized.length > MAX_MERCHANT_TASK_CHECKLIST_TEXT_LENGTH) {
    throw new Error("invalid_task_checklist_text");
  }
  return normalized;
}

function operationId(request: Request, body: TaskChecklistBody | null) {
  const raw = hasOwn(body, "operationId")
    ? body?.operationId
    : request.headers.get("idempotency-key") ?? undefined;
  if (raw === undefined) return "";
  if (typeof raw !== "string") throw new Error("invalid_operation_id");
  const trimmed = raw.trim();
  const normalized = normalizeMutationOperationId(trimmed);
  if (!trimmed || normalized !== trimmed) throw new Error("invalid_operation_id");
  return normalized;
}

function storeClient() {
  const client = createServerSupabaseServiceClient();
  if (!client) throw new Error("enterprise_store_unavailable");
  return client as unknown as MerchantEnterpriseStoreClient;
}

export function getMerchantTaskChecklistErrorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (NOT_FOUND_ERRORS.has(message)) {
    return NextResponse.json({ ok: false, error: message }, { status: 404 });
  }
  if (message === "permission_denied") {
    return NextResponse.json({ ok: false, error: message }, { status: 403 });
  }
  if (CONFLICT_ERRORS.has(message)) {
    return NextResponse.json({ ok: false, error: message }, { status: 409 });
  }
  const resolved = toMerchantEnterpriseAccessResponse(error);
  return NextResponse.json(resolved.body, { status: resolved.status });
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const siteId = requestedSiteId(url.searchParams.get("siteId"));
    const taskId = uuid(url.searchParams.get("taskId"), "invalid_task_id");
    const actor = await resolveMerchantEnterpriseActor(request, {
      siteId,
      requiredPermission: "tasks.view",
    });
    const store = storeClient();
    const boardId = await loadMerchantTaskBoardIdForAccess(store, siteId, taskId);
    requireMerchantEnterpriseBoardAccess(actor, boardId, "task_not_found");
    const items = await loadMerchantTaskChecklistItems(store, siteId, taskId);
    return NextResponse.json({ ok: true, items });
  } catch (error) {
    return getMerchantTaskChecklistErrorResponse(error);
  }
}

export async function POST(request: Request) {
  if (!isTrustedSameOriginMutationRequest(request)) {
    return getTrustedMutationRequestErrorResponse();
  }
  try {
    const body = (await request.json().catch(() => null)) as TaskChecklistBody | null;
    const siteId = requestedSiteId(body?.siteId);
    const taskId = uuid(body?.taskId, "invalid_task_id");
    if (!hasOnlyFields(body, CREATE_FIELDS)) {
      throw new Error("invalid_task_checklist_create");
    }
    const text = checklistText(body?.text);
    const requestedOperationId = operationId(request, body);
    const actor = await resolveMerchantEnterpriseActor(request, {
      siteId,
      requiredPermission: "tasks.update",
    });
    const store = storeClient();
    const boardId = await loadMerchantTaskBoardIdForAccess(store, siteId, taskId);
    requireMerchantEnterpriseBoardAccess(actor, boardId, "task_not_found");
    const item = await createMerchantTaskChecklistItem(store, {
      siteId,
      taskId,
      text,
      actorType: actor.type,
      actorId: actor.id,
      operationId: requestedOperationId,
    });
    return NextResponse.json({ ok: true, item });
  } catch (error) {
    return getMerchantTaskChecklistErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  if (!isTrustedSameOriginMutationRequest(request)) {
    return getTrustedMutationRequestErrorResponse();
  }
  try {
    const body = (await request.json().catch(() => null)) as TaskChecklistBody | null;
    const siteId = requestedSiteId(body?.siteId);
    const taskId = uuid(body?.taskId, "invalid_task_id");
    const itemId = uuid(body?.itemId, "invalid_task_checklist_item_id");
    if (!isMerchantEnterpriseVersion(body?.version)) {
      throw new Error("invalid_task_checklist_version");
    }
    if (!hasOnlyFields(body, UPDATE_FIELDS)) {
      throw new Error("invalid_task_checklist_update");
    }

    const changedFields = (["text", "completed", "archived"] as const).filter((field) =>
      hasOwn(body, field),
    );
    if (changedFields.length !== 1) throw new Error("invalid_task_checklist_update");

    const text = hasOwn(body, "text") ? checklistText(body?.text) : undefined;
    if (hasOwn(body, "completed") && typeof body?.completed !== "boolean") {
      throw new Error("invalid_task_checklist_completed");
    }
    if (hasOwn(body, "archived") && typeof body?.archived !== "boolean") {
      throw new Error("invalid_task_checklist_archived");
    }
    const requestedOperationId = operationId(request, body);
    const actor = await resolveMerchantEnterpriseActor(request, {
      siteId,
      requiredPermission: "tasks.update",
    });
    const store = storeClient();
    const boardId = await loadMerchantTaskBoardIdForAccess(store, siteId, taskId);
    requireMerchantEnterpriseBoardAccess(actor, boardId, "task_not_found");
    const item = await updateMerchantTaskChecklistItem(store, {
      siteId,
      taskId,
      itemId,
      version: body.version,
      actorType: actor.type,
      actorId: actor.id,
      operationId: requestedOperationId,
      ...(text !== undefined ? { text } : {}),
      ...(typeof body?.completed === "boolean" ? { completed: body.completed } : {}),
      ...(typeof body?.archived === "boolean" ? { archived: body.archived } : {}),
    });
    return NextResponse.json({ ok: true, item });
  } catch (error) {
    return getMerchantTaskChecklistErrorResponse(error);
  }
}
