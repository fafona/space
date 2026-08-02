import { NextResponse } from "next/server";
import {
  hasMerchantEnterprisePermission,
  MAX_MERCHANT_TASK_ASSIGNEES,
  type MerchantEnterpriseActor,
  type MerchantTaskPriority,
} from "@/lib/merchantEnterprise";
import {
  MerchantEnterpriseAccessError,
  requireMerchantEnterpriseBoardAccess,
  requireMerchantEnterpriseEntitlement,
  resolveMerchantEnterpriseActor,
  toMerchantEnterpriseAccessResponse,
} from "@/lib/merchantEnterpriseAuth.server";
import {
  createOrGetMerchantOrderTask,
  type MerchantEnterpriseStoreClient,
} from "@/lib/merchantEnterpriseStore.server";
import { isMerchantNumericId } from "@/lib/merchantIdentity";
import { listMerchantOrders } from "@/lib/merchantOrders.server";
import { normalizeMutationOperationId } from "@/lib/mutationOperationId";
import {
  getTrustedMutationRequestErrorResponse,
  isTrustedSameOriginMutationRequest,
} from "@/lib/requestMutationGuard";
import { createServerSupabaseServiceClient } from "@/lib/superAdminServer";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ORDER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const ORDER_TASK_FIELDS = new Set([
  "siteId",
  "orderId",
  "boardId",
  "columnId",
  "title",
  "description",
  "priority",
  "dueAt",
  "assigneeIds",
  "operationId",
]);

export type MerchantOrderTaskInput = {
  siteId: string;
  orderId: string;
  boardId: string;
  columnId: string;
  title: string;
  description: string;
  priority: MerchantTaskPriority;
  dueAt: string | null;
  assigneeIds: string[];
  operationId: string;
};

export type MerchantOrderTaskRouteDependencies = {
  resolveActor: (
    request: Request,
    input: { siteId: string; requiredPermission?: "tasks.create" },
  ) => Promise<MerchantEnterpriseActor>;
  requireEnterpriseEntitlement: (siteId: string) => Promise<{
    permissionConfig?: {
      allowProductBlock?: boolean;
      allowOrderManagement?: boolean;
    } | null;
  } | null>;
  listOrders: (siteId: string) => Promise<readonly { id: string; siteId: string }[]>;
  createOrGetTask: typeof createOrGetMerchantOrderTask;
  createStoreClient: () => MerchantEnterpriseStoreClient;
};

const DEFAULT_DEPENDENCIES: MerchantOrderTaskRouteDependencies = {
  resolveActor: resolveMerchantEnterpriseActor,
  requireEnterpriseEntitlement: requireMerchantEnterpriseEntitlement,
  listOrders: listMerchantOrders,
  createOrGetTask: createOrGetMerchantOrderTask,
  createStoreClient: () => {
    const client = createServerSupabaseServiceClient();
    if (!client) throw new Error("enterprise_store_unavailable");
    return client as unknown as MerchantEnterpriseStoreClient;
  },
};

function inputRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("invalid_order_task_request");
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !ORDER_TASK_FIELDS.has(key))) {
    throw new Error("invalid_order_task_request");
  }
  return record;
}

function boundedText(
  value: unknown,
  input: { error: string; maxLength: number; required?: boolean },
) {
  if (typeof value !== "string") throw new Error(input.error);
  const normalized = value.trim();
  if ((input.required && !normalized) || normalized.length > input.maxLength) {
    throw new Error(input.error);
  }
  return normalized;
}

function uuid(value: unknown, error: string) {
  const normalized = boundedText(value, { error, maxLength: 80, required: true });
  if (!UUID_PATTERN.test(normalized)) throw new Error(error);
  return normalized;
}

function priority(value: unknown): MerchantTaskPriority {
  if (value === undefined) return "normal";
  if (value === "low" || value === "normal" || value === "high" || value === "urgent") {
    return value;
  }
  throw new Error("invalid_task_priority");
}

function dueAt(value: unknown) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.length > 80 || !Number.isFinite(Date.parse(value))) {
    throw new Error("invalid_task_due_at");
  }
  return new Date(value).toISOString();
}

function assignees(value: unknown) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_MERCHANT_TASK_ASSIGNEES) {
    throw new Error("invalid_task_assignees");
  }
  return Array.from(
    new Set(value.map((item) => uuid(item, "invalid_task_assignees"))),
  );
}

function operationId(value: unknown) {
  if (typeof value !== "string") throw new Error("invalid_operation_id");
  const normalized = value.trim();
  if (
    !normalized ||
    normalized.length > 120 ||
    normalizeMutationOperationId(normalized) !== normalized
  ) {
    throw new Error("invalid_operation_id");
  }
  return normalized;
}

export function parseMerchantOrderTaskInput(
  value: unknown,
  idempotencyKey?: string | null,
): MerchantOrderTaskInput {
  const record = inputRecord(value);
  const siteId = boundedText(record.siteId, {
    error: "invalid_site_id",
    maxLength: 80,
    required: true,
  });
  if (!isMerchantNumericId(siteId)) throw new Error("invalid_site_id");
  const orderId = boundedText(record.orderId, {
    error: "invalid_order_id",
    maxLength: 200,
    required: true,
  });
  if (!ORDER_ID_PATTERN.test(orderId)) throw new Error("invalid_order_id");

  const description =
    record.description === undefined
      ? ""
      : boundedText(record.description, {
          error: "invalid_task_description",
          maxLength: 10_000,
        });
  const rawOperationId = Object.prototype.hasOwnProperty.call(record, "operationId")
    ? record.operationId
    : idempotencyKey;

  return {
    siteId,
    orderId,
    boardId: uuid(record.boardId, "invalid_task_board"),
    columnId: uuid(record.columnId, "invalid_task_column"),
    title: boundedText(record.title, {
      error: "invalid_task_title",
      maxLength: 240,
      required: true,
    }),
    description,
    priority: priority(record.priority),
    dueAt: dueAt(record.dueAt),
    assigneeIds: assignees(record.assigneeIds),
    operationId: operationId(rawOperationId),
  };
}

function fail(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message === "permission_denied") {
    return NextResponse.json({ ok: false, error: message }, { status: 403 });
  }
  if (message === "board_not_found") {
    return NextResponse.json({ ok: false, error: message }, { status: 404 });
  }
  const resolved = toMerchantEnterpriseAccessResponse(error);
  return NextResponse.json(resolved.body, { status: resolved.status });
}

export async function handleMerchantOrderTaskPost(
  request: Request,
  dependencyOverrides: Partial<MerchantOrderTaskRouteDependencies> = {},
) {
  if (!isTrustedSameOriginMutationRequest(request)) {
    return getTrustedMutationRequestErrorResponse();
  }
  const dependencies = { ...DEFAULT_DEPENDENCIES, ...dependencyOverrides };
  try {
    const body = await request.json().catch(() => null);
    const input = parseMerchantOrderTaskInput(
      body,
      request.headers.get("idempotency-key"),
    );
    const actor = await dependencies.resolveActor(request, {
      siteId: input.siteId,
      requiredPermission: "tasks.create",
    });
    if (actor.type !== "owner") {
      throw new MerchantEnterpriseAccessError("permission_denied", 403);
    }
    const authoritativeSite = await dependencies.requireEnterpriseEntitlement(input.siteId);
    if (
      !authoritativeSite?.permissionConfig?.allowProductBlock ||
      !authoritativeSite.permissionConfig.allowOrderManagement
    ) {
      throw new MerchantEnterpriseAccessError("order_management_disabled", 403);
    }

    requireMerchantEnterpriseBoardAccess(actor, input.boardId, "board_not_found");
    if (
      input.assigneeIds.length > 0 &&
      !hasMerchantEnterprisePermission(actor, "tasks.assign")
    ) {
      throw new MerchantEnterpriseAccessError("permission_denied", 403);
    }

    const orders = await dependencies.listOrders(input.siteId);
    const orderExists = orders.some(
      (order) => order.siteId === input.siteId && order.id === input.orderId,
    );
    if (!orderExists) {
      throw new MerchantEnterpriseAccessError("order_not_found", 404);
    }

    const result = await dependencies.createOrGetTask(
      dependencies.createStoreClient(),
      {
        siteId: input.siteId,
        orderId: input.orderId,
        boardId: input.boardId,
        columnId: input.columnId,
        title: input.title,
        description: input.description,
        priority: input.priority,
        dueAt: input.dueAt,
        createdByEmployeeId: "",
        assigneeIds: input.assigneeIds,
        actorType: "owner",
        actorId: actor.id,
        operationId: input.operationId,
      },
    );
    return NextResponse.json({
      ok: true,
      task: result.task,
      created: result.created,
    });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  return handleMerchantOrderTaskPost(request);
}
