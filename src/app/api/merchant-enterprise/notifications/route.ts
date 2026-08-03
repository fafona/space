import { NextResponse } from "next/server";
import type {
  MerchantEnterpriseActor,
  MerchantEnterpriseNotification,
} from "@/lib/merchantEnterprise";
import {
  requireMerchantEnterpriseEntitlement,
  resolveMerchantEnterpriseActor,
  toMerchantEnterpriseAccessResponse,
} from "@/lib/merchantEnterpriseAuth.server";
import {
  loadMerchantEnterpriseNotifications,
  markMerchantEnterpriseNotificationsRead,
  MAX_MERCHANT_ENTERPRISE_NOTIFICATION_PAGE_SIZE,
  type MerchantEnterpriseNotificationCursor,
  type MerchantEnterpriseNotificationPage,
  type MerchantEnterpriseStoreClient,
} from "@/lib/merchantEnterpriseStore.server";
import { isMerchantNumericId } from "@/lib/merchantIdentity";
import {
  getTrustedMutationRequestErrorResponse,
  isTrustedSameOriginMutationRequest,
} from "@/lib/requestMutationGuard";
import { createServerSupabaseServiceClient } from "@/lib/superAdminServer";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RESPONSE_HEADERS = { "Cache-Control": "private, no-store" } as const;

type NotificationMutationBody = {
  siteId?: unknown;
  notificationId?: unknown;
  all?: unknown;
};

type ParsedNotificationMutation =
  | { siteId: string; notificationId: string }
  | { siteId: string; all: true };

type EmployeeActor = Extract<MerchantEnterpriseActor, { type: "employee" }>;

export type MerchantEnterpriseNotificationRouteDependencies = {
  resolveActor: (
    request: Request,
    input: { siteId: string; requiredPermission: "tasks.view" },
  ) => Promise<MerchantEnterpriseActor>;
  requireEnterpriseEntitlement: (siteId: string) => Promise<unknown>;
  loadNotifications: (input: {
    siteId: string;
    actor: EmployeeActor;
    limit: number;
    cursor: MerchantEnterpriseNotificationCursor | null;
  }) => Promise<MerchantEnterpriseNotificationPage>;
  markNotificationsRead: (input: {
    siteId: string;
    actor: EmployeeActor;
    notificationId?: string;
    all?: boolean;
  }) => Promise<{ markedCount: number; unreadCount: number }>;
};

function storeClient() {
  const client = createServerSupabaseServiceClient();
  if (!client) throw new Error("enterprise_store_unavailable");
  return client as unknown as MerchantEnterpriseStoreClient;
}

const DEFAULT_DEPENDENCIES: MerchantEnterpriseNotificationRouteDependencies = {
  resolveActor: resolveMerchantEnterpriseActor,
  requireEnterpriseEntitlement: requireMerchantEnterpriseEntitlement,
  loadNotifications: (input) =>
    loadMerchantEnterpriseNotifications(storeClient(), {
      siteId: input.siteId,
      actorType: "employee",
      actorId: input.actor.id,
      limit: input.limit,
      cursor: input.cursor,
    }),
  markNotificationsRead: (input) =>
    markMerchantEnterpriseNotificationsRead(storeClient(), {
      siteId: input.siteId,
      actorType: "employee",
      actorId: input.actor.id,
      ...(input.notificationId
        ? { notificationId: input.notificationId }
        : { all: true }),
    }),
};

function response(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: RESPONSE_HEADERS,
  });
}

function fail(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message === "permission_denied") {
    return response({ ok: false, error: message }, 403);
  }
  const resolved = toMerchantEnterpriseAccessResponse(error);
  return response(resolved.body, resolved.status);
}

export function encodeMerchantEnterpriseNotificationCursor(
  cursor: MerchantEnterpriseNotificationCursor,
) {
  return Buffer.from(JSON.stringify([cursor.createdAt, cursor.id]), "utf8").toString(
    "base64url",
  );
}

export function parseMerchantEnterpriseNotificationCursor(
  value: string | null,
): MerchantEnterpriseNotificationCursor | null {
  if (value === null || value === "") return null;
  if (value.length > 180 || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error("invalid_notification_cursor");
  }
  try {
    const decoded = Buffer.from(value, "base64url").toString("utf8");
    if (Buffer.from(decoded, "utf8").toString("base64url") !== value) {
      throw new Error("invalid_notification_cursor");
    }
    const parsed = JSON.parse(decoded) as unknown;
    if (!Array.isArray(parsed) || parsed.length !== 2) {
      throw new Error("invalid_notification_cursor");
    }
    const [createdAt, id] = parsed;
    if (
      typeof createdAt !== "string" ||
      !Number.isFinite(Date.parse(createdAt)) ||
      new Date(createdAt).toISOString() !== createdAt ||
      typeof id !== "string" ||
      !UUID_PATTERN.test(id)
    ) {
      throw new Error("invalid_notification_cursor");
    }
    return { createdAt, id };
  } catch (error) {
    if (error instanceof Error && error.message === "invalid_notification_cursor") {
      throw error;
    }
    throw new Error("invalid_notification_cursor");
  }
}

function parseNotificationQuery(request: Request) {
  const searchParams = new URL(request.url).searchParams;
  const allowedKeys = new Set(["siteId", "limit", "cursor"]);
  if (
    Array.from(searchParams.keys()).some((key) => !allowedKeys.has(key)) ||
    searchParams.getAll("siteId").length !== 1 ||
    searchParams.getAll("limit").length > 1 ||
    searchParams.getAll("cursor").length > 1
  ) {
    throw new Error("invalid_notification_request");
  }
  const siteId = searchParams.get("siteId") ?? "";
  const limitText = searchParams.get("limit");
  if (siteId !== siteId.trim() || !isMerchantNumericId(siteId)) {
    throw new Error("invalid_notification_request");
  }
  const limit = limitText === null ? 20 : Number(limitText);
  if (
    limitText === "" ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > MAX_MERCHANT_ENTERPRISE_NOTIFICATION_PAGE_SIZE
  ) {
    throw new Error("invalid_notification_request");
  }
  return {
    siteId,
    limit,
    cursor: parseMerchantEnterpriseNotificationCursor(
      searchParams.get("cursor"),
    ),
  };
}

function parseNotificationMutationBody(value: unknown): ParsedNotificationMutation {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("invalid_notification_request");
  }
  const body = value as NotificationMutationBody & Record<string, unknown>;
  if (
    Object.keys(body).some(
      (key) => key !== "siteId" && key !== "notificationId" && key !== "all",
    )
  ) {
    throw new Error("invalid_notification_request");
  }
  const siteId = body.siteId;
  const notificationId = body.notificationId;
  const markAll = body.all === true;
  if (
    typeof siteId !== "string" ||
    siteId !== siteId.trim() ||
    !isMerchantNumericId(siteId) ||
    (markAll === (typeof notificationId === "string" && notificationId.length > 0)) ||
    (notificationId !== undefined &&
      (typeof notificationId !== "string" || !UUID_PATTERN.test(notificationId))) ||
    (body.all !== undefined && body.all !== true)
  ) {
    throw new Error("invalid_notification_request");
  }
  return {
    siteId,
    ...(notificationId ? { notificationId } : { all: true as const }),
  };
}

export function toPublicMerchantEnterpriseNotification(
  notification: MerchantEnterpriseNotification,
) {
  return notification.actorType === "owner"
    ? { ...notification, actorId: "" }
    : notification;
}

export async function handleMerchantEnterpriseNotificationsGet(
  request: Request,
  dependencyOverrides: Partial<MerchantEnterpriseNotificationRouteDependencies> = {},
) {
  const dependencies = { ...DEFAULT_DEPENDENCIES, ...dependencyOverrides };
  try {
    const query = parseNotificationQuery(request);
    const actor = await dependencies.resolveActor(request, {
      siteId: query.siteId,
      requiredPermission: "tasks.view",
    });
    await dependencies.requireEnterpriseEntitlement(query.siteId);
    if (actor.type === "owner") {
      return response({
        ok: true,
        notifications: [],
        unreadCount: 0,
        nextCursor: null,
      });
    }
    const page = await dependencies.loadNotifications({
      siteId: query.siteId,
      actor,
      limit: query.limit,
      cursor: query.cursor,
    });
    return response({
      ok: true,
      notifications: page.notifications.map(toPublicMerchantEnterpriseNotification),
      unreadCount: page.unreadCount,
      nextCursor: page.nextCursor
        ? encodeMerchantEnterpriseNotificationCursor(page.nextCursor)
        : null,
    });
  } catch (error) {
    return fail(error);
  }
}

export async function handleMerchantEnterpriseNotificationsPatch(
  request: Request,
  dependencyOverrides: Partial<MerchantEnterpriseNotificationRouteDependencies> = {},
) {
  if (!isTrustedSameOriginMutationRequest(request)) {
    return getTrustedMutationRequestErrorResponse();
  }
  const dependencies = { ...DEFAULT_DEPENDENCIES, ...dependencyOverrides };
  try {
    const body = parseNotificationMutationBody(
      await request.json().catch(() => null),
    );
    const actor = await dependencies.resolveActor(request, {
      siteId: body.siteId,
      requiredPermission: "tasks.view",
    });
    await dependencies.requireEnterpriseEntitlement(body.siteId);
    if (actor.type === "owner") {
      return response({ ok: true, markedCount: 0, unreadCount: 0 });
    }
    const result = await dependencies.markNotificationsRead({
      siteId: body.siteId,
      actor,
      ...("notificationId" in body
        ? { notificationId: body.notificationId }
        : { all: true }),
    });
    return response({ ok: true, ...result });
  } catch (error) {
    return fail(error);
  }
}

export async function GET(request: Request) {
  return handleMerchantEnterpriseNotificationsGet(request);
}

export async function PATCH(request: Request) {
  return handleMerchantEnterpriseNotificationsPatch(request);
}
