import { NextResponse } from "next/server";
import type {
  MerchantEnterpriseActor,
  MerchantEnterprisePermission,
} from "@/lib/merchantEnterprise";
import {
  requireMerchantEnterpriseEntitlement,
  resolveMerchantEnterpriseActor,
  toMerchantEnterpriseAccessResponse,
} from "@/lib/merchantEnterpriseAuth.server";
import {
  MAX_MERCHANT_ENTERPRISE_TODO_PAGE_SIZE,
  MERCHANT_ENTERPRISE_TODO_CATEGORIES,
  MERCHANT_ENTERPRISE_TODO_KINDS,
  type MerchantEnterpriseTodoCategory,
  type MerchantEnterpriseTodoCursor,
  type MerchantEnterpriseTodoKind,
  type MerchantEnterpriseTodoStorePage,
} from "@/lib/merchantEnterpriseTodos";
import {
  loadMerchantEnterpriseTodos,
  type MerchantEnterpriseTodoStoreClient,
} from "@/lib/merchantEnterpriseTodos.server";
import { isMerchantNumericId } from "@/lib/merchantIdentity";
import { createServerSupabaseServiceClient } from "@/lib/superAdminServer";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RESPONSE_HEADERS = { "Cache-Control": "private, no-store" } as const;

export type MerchantEnterpriseTodoRouteDependencies = {
  resolveActor: (
    request: Request,
    input: { siteId: string; requiredPermission: MerchantEnterprisePermission },
  ) => Promise<MerchantEnterpriseActor>;
  requireEnterpriseEntitlement: (siteId: string) => Promise<unknown>;
  loadTodos: (input: {
    siteId: string;
    actor: MerchantEnterpriseActor;
    category: MerchantEnterpriseTodoCategory;
    limit: number;
    cursor: MerchantEnterpriseTodoCursor | null;
  }) => Promise<MerchantEnterpriseTodoStorePage>;
};

function storeClient() {
  const client = createServerSupabaseServiceClient();
  if (!client) throw new Error("enterprise_store_unavailable");
  return client as unknown as MerchantEnterpriseTodoStoreClient;
}

const DEFAULT_DEPENDENCIES: MerchantEnterpriseTodoRouteDependencies = {
  resolveActor: resolveMerchantEnterpriseActor,
  requireEnterpriseEntitlement: requireMerchantEnterpriseEntitlement,
  loadTodos: (input) => loadMerchantEnterpriseTodos(storeClient(), input),
};

function response(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: RESPONSE_HEADERS });
}

function errorResponse(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  if (
    code === "invalid_enterprise_todo_query" ||
    code === "invalid_enterprise_todo_cursor"
  ) {
    return response({ ok: false, error: code }, 400);
  }
  if (code === "permission_denied") {
    return response({ ok: false, error: code }, 403);
  }
  const resolved = toMerchantEnterpriseAccessResponse(error);
  return response(resolved.body, resolved.status);
}

export function encodeMerchantEnterpriseTodoCursor(
  cursor: MerchantEnterpriseTodoCursor,
) {
  return Buffer.from(
    JSON.stringify([
      1,
      cursor.category,
      cursor.bucket,
      cursor.sortAt,
      cursor.kind,
      cursor.entityId,
    ]),
    "utf8",
  ).toString("base64url");
}

export function parseMerchantEnterpriseTodoCursor(
  value: string | null,
  category: MerchantEnterpriseTodoCategory,
): MerchantEnterpriseTodoCursor | null {
  if (value === null) return null;
  if (value === "") throw new Error("invalid_enterprise_todo_cursor");
  if (value.length > 320 || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error("invalid_enterprise_todo_cursor");
  }
  try {
    const decoded = Buffer.from(value, "base64url").toString("utf8");
    if (Buffer.from(decoded, "utf8").toString("base64url") !== value) {
      throw new Error("invalid_enterprise_todo_cursor");
    }
    const parsed = JSON.parse(decoded) as unknown;
    if (!Array.isArray(parsed) || parsed.length !== 6) {
      throw new Error("invalid_enterprise_todo_cursor");
    }
    const [version, cursorCategory, bucket, sortAt, kind, entityId] = parsed;
    if (
      version !== 1 ||
      cursorCategory !== category ||
      !MERCHANT_ENTERPRISE_TODO_CATEGORIES.includes(
        cursorCategory as MerchantEnterpriseTodoCategory,
      ) ||
      typeof bucket !== "number" ||
      !Number.isSafeInteger(bucket) ||
      bucket < 0 ||
      bucket > 5 ||
      typeof sortAt !== "string" ||
      sortAt.length > 80 ||
      !Number.isFinite(Date.parse(sortAt)) ||
      !MERCHANT_ENTERPRISE_TODO_KINDS.includes(kind as MerchantEnterpriseTodoKind) ||
      typeof entityId !== "string" ||
      !UUID_PATTERN.test(entityId)
    ) {
      throw new Error("invalid_enterprise_todo_cursor");
    }
    return {
      category,
      bucket,
      sortAt,
      kind: kind as MerchantEnterpriseTodoKind,
      entityId: entityId.toLowerCase(),
    };
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "invalid_enterprise_todo_cursor"
    ) {
      throw error;
    }
    throw new Error("invalid_enterprise_todo_cursor");
  }
}

export function parseMerchantEnterpriseTodoQuery(request: Request) {
  const params = new URL(request.url).searchParams;
  const allowedKeys = new Set(["siteId", "category", "limit", "cursor"]);
  if (
    Array.from(params.keys()).some((key) => !allowedKeys.has(key)) ||
    params.getAll("siteId").length !== 1 ||
    ["category", "limit", "cursor"].some((key) => params.getAll(key).length > 1)
  ) {
    throw new Error("invalid_enterprise_todo_query");
  }
  const siteId = params.get("siteId") ?? "";
  if (siteId !== siteId.trim() || !isMerchantNumericId(siteId)) {
    throw new Error("invalid_enterprise_todo_query");
  }
  const categoryValue = params.get("category") ?? "all";
  if (
    categoryValue !== categoryValue.trim() ||
    !MERCHANT_ENTERPRISE_TODO_CATEGORIES.includes(
      categoryValue as MerchantEnterpriseTodoCategory,
    )
  ) {
    throw new Error("invalid_enterprise_todo_query");
  }
  const category = categoryValue as MerchantEnterpriseTodoCategory;
  const limitText = params.get("limit");
  const limit = limitText === null ? 20 : Number(limitText);
  if (
    limitText === "" ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > MAX_MERCHANT_ENTERPRISE_TODO_PAGE_SIZE
  ) {
    throw new Error("invalid_enterprise_todo_query");
  }
  return {
    siteId,
    category,
    limit,
    cursor: parseMerchantEnterpriseTodoCursor(params.get("cursor"), category),
  };
}

export async function handleMerchantEnterpriseTodosGet(
  request: Request,
  overrides: Partial<MerchantEnterpriseTodoRouteDependencies> = {},
) {
  const dependencies = { ...DEFAULT_DEPENDENCIES, ...overrides };
  try {
    const query = parseMerchantEnterpriseTodoQuery(request);
    const actor = await dependencies.resolveActor(request, {
      siteId: query.siteId,
      requiredPermission: "enterprise.view",
    });
    await dependencies.requireEnterpriseEntitlement(query.siteId);
    const page = await dependencies.loadTodos({ ...query, actor });
    if (page.merchantId !== query.siteId) {
      throw new Error("enterprise_todos_read_failed");
    }
    return response({
      ok: true,
      merchantId: page.merchantId,
      items: page.items,
      counts: page.counts,
      nextCursor: page.nextCursor
        ? encodeMerchantEnterpriseTodoCursor(page.nextCursor)
        : null,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function GET(request: Request) {
  return handleMerchantEnterpriseTodosGet(request);
}
