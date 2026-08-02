import { NextResponse } from "next/server";
import { isMerchantEnterpriseVersion } from "@/lib/merchantEnterprise";
import {
  requireMerchantEnterpriseEntitlement,
  requireMerchantEnterpriseBoardAccess,
  resolveMerchantEnterpriseActor,
  toMerchantEnterpriseAccessResponse,
} from "@/lib/merchantEnterpriseAuth.server";
import {
  createMerchantTaskColumn,
  updateMerchantTaskColumn,
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

type ColumnBody = {
  siteId?: unknown;
  boardId?: unknown;
  columnId?: unknown;
  version?: unknown;
  name?: unknown;
  color?: unknown;
  isDone?: unknown;
  status?: unknown;
  position?: unknown;
  operationId?: unknown;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COLOR_PATTERN = /^#[0-9a-f]{6}$/i;
const CONFLICT_ERRORS = new Set([
  "enterprise_version_conflict",
  "enterprise_operation_in_progress",
  "column_limit_reached",
  "column_in_use",
  "last_active_column",
  "inactive_board",
  "inactive_column",
  "board_has_no_active_columns",
]);

function hasOwn(body: ColumnBody | null, key: keyof ColumnBody) {
  return Boolean(body && Object.prototype.hasOwnProperty.call(body, key));
}

function requiredText(value: unknown, maxLength: number, error: string) {
  if (typeof value !== "string") throw new Error(error);
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) throw new Error(error);
  return normalized;
}

function uuid(value: unknown, error: string) {
  const normalized = requiredText(value, 80, error);
  if (!UUID_PATTERN.test(normalized)) throw new Error(error);
  return normalized;
}

function optionalColor(body: ColumnBody | null, requiredDefault = false) {
  if (!hasOwn(body, "color")) return requiredDefault ? "#64748b" : undefined;
  if (typeof body?.color !== "string" || !COLOR_PATTERN.test(body.color.trim())) {
    throw new Error("invalid_column_color");
  }
  return body.color.trim().toLowerCase();
}

function optionalPosition(body: ColumnBody | null) {
  if (!hasOwn(body, "position")) return undefined;
  if (
    typeof body?.position !== "number" ||
    !Number.isSafeInteger(body.position) ||
    body.position < 0 ||
    body.position > 1_000_000
  ) {
    throw new Error("invalid_column_position");
  }
  return body.position;
}

function operationId(request: Request, body: ColumnBody | null) {
  const raw = hasOwn(body, "operationId")
    ? body?.operationId
    : request.headers.get("idempotency-key") ?? undefined;
  if (raw === undefined) return "";
  if (typeof raw !== "string" || !raw.trim()) throw new Error("invalid_operation_id");
  const normalized = normalizeMutationOperationId(raw);
  if (!normalized) throw new Error("invalid_operation_id");
  return normalized;
}

function client() {
  const value = createServerSupabaseServiceClient();
  if (!value) throw new Error("enterprise_store_unavailable");
  return value as unknown as MerchantEnterpriseStoreClient;
}

async function authorize(request: Request, siteId: string) {
  const actor = await resolveMerchantEnterpriseActor(request, {
    siteId,
    requiredPermission: "boards.manage",
  });
  await requireMerchantEnterpriseEntitlement(siteId);
  return actor;
}

export function getMerchantTaskColumnErrorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (CONFLICT_ERRORS.has(message)) {
    return NextResponse.json({ ok: false, error: message }, { status: 409 });
  }
  if (
    message === "permission_denied" ||
    message === "merchant_access_denied" ||
    message === "employee_not_found" ||
    message === "employee_account_disabled" ||
    message === "role_not_found" ||
    message === "role_inactive" ||
    message === "merchant_role_invalid"
  ) {
    return NextResponse.json(
      { ok: false, error: "permission_denied" },
      { status: 403 },
    );
  }
  if (message === "board_not_found" || message === "column_not_found") {
    return NextResponse.json({ ok: false, error: message }, { status: 404 });
  }
  const resolved = toMerchantEnterpriseAccessResponse(error);
  return NextResponse.json(resolved.body, { status: resolved.status });
}

export async function POST(request: Request) {
  if (!isTrustedSameOriginMutationRequest(request)) {
    return getTrustedMutationRequestErrorResponse();
  }
  try {
    const body = (await request.json().catch(() => null)) as ColumnBody | null;
    const siteId =
      typeof body?.siteId === "string" ? body.siteId.trim() : "";
    if (!isMerchantNumericId(siteId)) {
      return NextResponse.json({ ok: false, error: "invalid_site_id" }, { status: 400 });
    }
    const requestedBoardId = uuid(body?.boardId, "invalid_board_id");
    const name = requiredText(body?.name, 80, "invalid_column_name");
    const color = optionalColor(body, true);
    const position = optionalPosition(body);
    if (hasOwn(body, "isDone") && typeof body?.isDone !== "boolean") {
      throw new Error("invalid_column_is_done");
    }
    const requestedOperationId = operationId(request, body);
    const actor = await authorize(request, siteId);
    requireMerchantEnterpriseBoardAccess(actor, requestedBoardId, "board_not_found");
    const column = await createMerchantTaskColumn(client(), {
      siteId,
      actorType: actor.type,
      actorId: actor.id,
      boardId: requestedBoardId,
      name,
      color,
      isDone: body?.isDone === true,
      ...(position !== undefined ? { position } : {}),
      operationId: requestedOperationId,
    });
    return NextResponse.json({ ok: true, column });
  } catch (error) {
    return getMerchantTaskColumnErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  if (!isTrustedSameOriginMutationRequest(request)) {
    return getTrustedMutationRequestErrorResponse();
  }
  try {
    const body = (await request.json().catch(() => null)) as ColumnBody | null;
    const siteId =
      typeof body?.siteId === "string" ? body.siteId.trim() : "";
    if (!isMerchantNumericId(siteId)) {
      return NextResponse.json({ ok: false, error: "invalid_site_id" }, { status: 400 });
    }
    const requestedBoardId = uuid(body?.boardId, "invalid_board_id");
    const requestedColumnId = uuid(body?.columnId, "invalid_column_id");
    if (!isMerchantEnterpriseVersion(body?.version)) {
      throw new Error("invalid_column_version");
    }
    const name = hasOwn(body, "name")
      ? requiredText(body?.name, 80, "invalid_column_name")
      : undefined;
    const color = optionalColor(body);
    const position = optionalPosition(body);
    if (hasOwn(body, "isDone") && typeof body?.isDone !== "boolean") {
      throw new Error("invalid_column_is_done");
    }
    if (
      hasOwn(body, "status") &&
      body?.status !== "active" &&
      body?.status !== "archived"
    ) {
      throw new Error("invalid_column_status");
    }
    if (
      name === undefined &&
      color === undefined &&
      position === undefined &&
      !hasOwn(body, "isDone") &&
      !hasOwn(body, "status")
    ) {
      throw new Error("invalid_column_update");
    }
    const requestedOperationId = operationId(request, body);
    const actor = await authorize(request, siteId);
    requireMerchantEnterpriseBoardAccess(actor, requestedBoardId, "board_not_found");
    const column = await updateMerchantTaskColumn(client(), {
      siteId,
      actorType: actor.type,
      actorId: actor.id,
      boardId: requestedBoardId,
      columnId: requestedColumnId,
      version: body.version,
      ...(name !== undefined ? { name } : {}),
      ...(color !== undefined ? { color } : {}),
      ...(position !== undefined ? { position } : {}),
      ...(typeof body?.isDone === "boolean" ? { isDone: body.isDone } : {}),
      ...(body?.status === "active" || body?.status === "archived"
        ? { status: body.status }
        : {}),
      operationId: requestedOperationId,
    });
    return NextResponse.json({ ok: true, column });
  } catch (error) {
    return getMerchantTaskColumnErrorResponse(error);
  }
}
