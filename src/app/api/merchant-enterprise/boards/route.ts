import { NextResponse } from "next/server";
import { isMerchantEnterpriseVersion } from "@/lib/merchantEnterprise";
import {
  requireMerchantEnterpriseEntitlement,
  requireMerchantEnterpriseAllBoardAccess,
  requireMerchantEnterpriseBoardAccess,
  resolveMerchantEnterpriseActor,
  toMerchantEnterpriseAccessResponse,
} from "@/lib/merchantEnterpriseAuth.server";
import {
  createMerchantTaskBoard,
  updateMerchantTaskBoard,
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

type BoardBody = {
  siteId?: unknown;
  boardId?: unknown;
  version?: unknown;
  name?: unknown;
  description?: unknown;
  status?: unknown;
  position?: unknown;
  operationId?: unknown;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONFLICT_ERRORS = new Set([
  "enterprise_version_conflict",
  "enterprise_operation_in_progress",
  "board_limit_reached",
  "board_in_use",
  "last_active_board",
  "board_has_no_active_columns",
]);

function hasOwn(body: BoardBody | null, key: keyof BoardBody) {
  return Boolean(body && Object.prototype.hasOwnProperty.call(body, key));
}

function requiredText(value: unknown, maxLength: number, error: string) {
  if (typeof value !== "string") throw new Error(error);
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) throw new Error(error);
  return normalized;
}

function optionalDescription(body: BoardBody | null) {
  if (!hasOwn(body, "description")) return undefined;
  if (typeof body?.description !== "string" || body.description.length > 2000) {
    throw new Error("invalid_board_description");
  }
  return body.description.trim();
}

function optionalPosition(body: BoardBody | null) {
  if (!hasOwn(body, "position")) return undefined;
  if (
    typeof body?.position !== "number" ||
    !Number.isSafeInteger(body.position) ||
    body.position < 0 ||
    body.position > 1_000_000
  ) {
    throw new Error("invalid_board_position");
  }
  return body.position;
}

function boardId(value: unknown) {
  const normalized = requiredText(value, 80, "invalid_board_id");
  if (!UUID_PATTERN.test(normalized)) throw new Error("invalid_board_id");
  return normalized;
}

function operationId(request: Request, body: BoardBody | null) {
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

function fail(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (CONFLICT_ERRORS.has(message)) {
    return NextResponse.json({ ok: false, error: message }, { status: 409 });
  }
  const resolved = toMerchantEnterpriseAccessResponse(error);
  return NextResponse.json(resolved.body, { status: resolved.status });
}

export async function POST(request: Request) {
  if (!isTrustedSameOriginMutationRequest(request)) {
    return getTrustedMutationRequestErrorResponse();
  }
  try {
    const body = (await request.json().catch(() => null)) as BoardBody | null;
    const siteId =
      typeof body?.siteId === "string" ? body.siteId.trim() : "";
    if (!isMerchantNumericId(siteId)) {
      return NextResponse.json({ ok: false, error: "invalid_site_id" }, { status: 400 });
    }
    const name = requiredText(body?.name, 120, "invalid_board_name");
    const description = optionalDescription(body);
    const position = optionalPosition(body);
    const requestedOperationId = operationId(request, body);
    const actor = await authorize(request, siteId);
    requireMerchantEnterpriseAllBoardAccess(actor);
    const result = await createMerchantTaskBoard(client(), {
      siteId,
      name,
      ...(description !== undefined ? { description } : {}),
      ...(position !== undefined ? { position } : {}),
      operationId: requestedOperationId,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return fail(error);
  }
}

export async function PATCH(request: Request) {
  if (!isTrustedSameOriginMutationRequest(request)) {
    return getTrustedMutationRequestErrorResponse();
  }
  try {
    const body = (await request.json().catch(() => null)) as BoardBody | null;
    const siteId =
      typeof body?.siteId === "string" ? body.siteId.trim() : "";
    if (!isMerchantNumericId(siteId)) {
      return NextResponse.json({ ok: false, error: "invalid_site_id" }, { status: 400 });
    }
    const requestedBoardId = boardId(body?.boardId);
    if (!isMerchantEnterpriseVersion(body?.version)) {
      throw new Error("invalid_board_version");
    }
    const name = hasOwn(body, "name")
      ? requiredText(body?.name, 120, "invalid_board_name")
      : undefined;
    const description = optionalDescription(body);
    const position = optionalPosition(body);
    if (
      hasOwn(body, "status") &&
      body?.status !== "active" &&
      body?.status !== "archived"
    ) {
      throw new Error("invalid_board_status");
    }
    if (
      name === undefined &&
      description === undefined &&
      position === undefined &&
      !hasOwn(body, "status")
    ) {
      throw new Error("invalid_board_update");
    }
    const requestedOperationId = operationId(request, body);
    const actor = await authorize(request, siteId);
    requireMerchantEnterpriseBoardAccess(actor, requestedBoardId, "board_not_found");
    const board = await updateMerchantTaskBoard(client(), {
      siteId,
      boardId: requestedBoardId,
      version: body.version,
      ...(name !== undefined ? { name } : {}),
      ...(description !== undefined ? { description } : {}),
      ...(position !== undefined ? { position } : {}),
      ...(body?.status === "active" || body?.status === "archived"
        ? { status: body.status }
        : {}),
      operationId: requestedOperationId,
    });
    return NextResponse.json({ ok: true, board });
  } catch (error) {
    return fail(error);
  }
}
