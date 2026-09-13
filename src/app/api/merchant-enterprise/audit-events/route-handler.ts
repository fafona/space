import { NextResponse } from "next/server";
import {
  MERCHANT_ENTERPRISE_AUDIT_ENTITY_TYPES,
  MERCHANT_ENTERPRISE_AUDIT_EVENT_TYPES,
  normalizeMerchantEnterpriseAuditTimestamp,
  type MerchantEnterpriseActor,
  type MerchantEnterpriseAuditCursor,
  type MerchantEnterpriseAuditEntityType,
  type MerchantEnterpriseAuditEventType,
} from "@/lib/merchantEnterprise";
import {
  requireMerchantEnterpriseEntitlement,
  resolveMerchantEnterpriseActor,
  toMerchantEnterpriseAccessResponse,
} from "@/lib/merchantEnterpriseAuth.server";
import {
  loadMerchantEnterpriseAuditEvents,
  MAX_MERCHANT_ENTERPRISE_AUDIT_PAGE_SIZE,
  type MerchantEnterpriseAuditPage,
  type MerchantEnterpriseStoreClient,
} from "@/lib/merchantEnterpriseStore.server";
import { isMerchantNumericId } from "@/lib/merchantIdentity";
import { createServerSupabaseServiceClient } from "@/lib/superAdminServer";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STRICT_UTC_ISO_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const RESPONSE_HEADERS = { "Cache-Control": "private, no-store" } as const;
const AUDIT_CURSOR_VERSION = 2;

export type MerchantEnterpriseAuditRouteDependencies = {
  resolveActor: (
    request: Request,
    input: { siteId: string; requiredPermission: "audit.view" },
  ) => Promise<MerchantEnterpriseActor>;
  requireEnterpriseEntitlement: (siteId: string) => Promise<unknown>;
  loadAuditEvents: (input: {
    siteId: string;
    actor: MerchantEnterpriseActor;
    limit: number;
    cursor: MerchantEnterpriseAuditCursor | null;
    entityType?: MerchantEnterpriseAuditEntityType;
    eventType?: MerchantEnterpriseAuditEventType;
    filterActorType?: "owner" | "employee" | "system";
    filterActorId?: string;
    createdFrom?: string;
    createdToExclusive?: string;
  }) => Promise<MerchantEnterpriseAuditPage>;
};

function storeClient() {
  const client = createServerSupabaseServiceClient();
  if (!client) throw new Error("enterprise_store_unavailable");
  return client as unknown as MerchantEnterpriseStoreClient;
}

const DEFAULT_DEPENDENCIES: MerchantEnterpriseAuditRouteDependencies = {
  resolveActor: resolveMerchantEnterpriseActor,
  requireEnterpriseEntitlement: requireMerchantEnterpriseEntitlement,
  loadAuditEvents: (input) =>
    loadMerchantEnterpriseAuditEvents(storeClient(), {
      siteId: input.siteId,
      actorType: input.actor.type,
      actorId: input.actor.id,
      limit: input.limit,
      cursor: input.cursor,
      ...(input.entityType ? { entityType: input.entityType } : {}),
      ...(input.eventType ? { eventType: input.eventType } : {}),
      ...(input.filterActorType
        ? { filterActorType: input.filterActorType }
        : {}),
      ...(input.filterActorId ? { filterActorId: input.filterActorId } : {}),
      ...(input.createdFrom ? { createdFrom: input.createdFrom } : {}),
      ...(input.createdToExclusive
        ? { createdToExclusive: input.createdToExclusive }
        : {}),
    }),
};

function response(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: RESPONSE_HEADERS });
}

function fail(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message === "permission_denied") {
    return response({ ok: false, error: message }, 403);
  }
  const resolved = toMerchantEnterpriseAccessResponse(error);
  return response(resolved.body, resolved.status);
}

export function encodeMerchantEnterpriseAuditCursor(
  cursor: MerchantEnterpriseAuditCursor,
) {
  return Buffer.from(
    JSON.stringify([
      AUDIT_CURSOR_VERSION,
      cursor.beforeCreatedAt,
      cursor.beforeId,
    ]),
    "utf8",
  ).toString("base64url");
}

export function parseMerchantEnterpriseAuditCursor(
  value: string | null,
): MerchantEnterpriseAuditCursor | null {
  if (value === null || value === "") return null;
  if (value.length > 180 || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error("invalid_enterprise_audit_cursor");
  }
  try {
    const decoded = Buffer.from(value, "base64url").toString("utf8");
    if (Buffer.from(decoded, "utf8").toString("base64url") !== value) {
      throw new Error("invalid_enterprise_audit_cursor");
    }
    const parsed = JSON.parse(decoded) as unknown;
    if (
      !Array.isArray(parsed) ||
      parsed.length !== 3 ||
      parsed[0] !== AUDIT_CURSOR_VERSION
    ) {
      throw new Error("invalid_enterprise_audit_cursor");
    }
    const [, beforeCreatedAt, beforeId] = parsed;
    const normalizedBeforeCreatedAt =
      normalizeMerchantEnterpriseAuditTimestamp(beforeCreatedAt);
    if (
      typeof beforeCreatedAt !== "string" ||
      normalizedBeforeCreatedAt !== beforeCreatedAt ||
      typeof beforeId !== "string" ||
      !UUID_PATTERN.test(beforeId)
    ) {
      throw new Error("invalid_enterprise_audit_cursor");
    }
    return { beforeCreatedAt, beforeId };
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "invalid_enterprise_audit_cursor"
    ) {
      throw error;
    }
    throw new Error("invalid_enterprise_audit_cursor");
  }
}

function eventMatchesEntity(
  eventType: MerchantEnterpriseAuditEventType,
  entityType: MerchantEnterpriseAuditEntityType,
) {
  const prefix = eventType.split(".", 1)[0];
  if (prefix === "workspace") return entityType === "workspace";
  if (prefix === "role") return entityType === "role";
  if (prefix === "board") return entityType === "board";
  if (prefix === "column") return entityType === "column";
  if (prefix === "employee") return entityType === "employee";
  if (prefix === "invitation") return entityType === "invitation";
  if (prefix === "automation") return entityType === "automation";
  return prefix === "workflow" && entityType === "workflow";
}

function parseStrictUtcBoundary(value: string | null) {
  if (value === null) return null;
  if (!STRICT_UTC_ISO_PATTERN.test(value)) {
    throw new Error("invalid_enterprise_audit_query");
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new Error("invalid_enterprise_audit_query");
  }
  const normalized = new Date(parsed).toISOString();
  if (value !== normalized && value !== normalized.replace(".000Z", "Z")) {
    throw new Error("invalid_enterprise_audit_query");
  }
  return normalized;
}

function parseAuditQuery(request: Request) {
  const searchParams = new URL(request.url).searchParams;
  const allowedKeys = new Set([
    "siteId",
    "limit",
    "cursor",
    "entityType",
    "eventType",
    "actorType",
    "actorId",
    "createdFrom",
    "createdToExclusive",
  ]);
  if (
    Array.from(searchParams.keys()).some((key) => !allowedKeys.has(key)) ||
    searchParams.getAll("siteId").length !== 1 ||
    [
      "limit",
      "cursor",
      "entityType",
      "eventType",
      "actorType",
      "actorId",
      "createdFrom",
      "createdToExclusive",
    ].some(
      (key) => searchParams.getAll(key).length > 1,
    )
  ) {
    throw new Error("invalid_enterprise_audit_query");
  }
  const siteId = searchParams.get("siteId") ?? "";
  const limitText = searchParams.get("limit");
  const entityTypeText = searchParams.get("entityType");
  const eventTypeText = searchParams.get("eventType");
  const filterActorTypeText = searchParams.get("actorType");
  const filterActorId = searchParams.get("actorId");
  const createdFrom = parseStrictUtcBoundary(searchParams.get("createdFrom"));
  const createdToExclusive = parseStrictUtcBoundary(
    searchParams.get("createdToExclusive"),
  );
  const limit = limitText === null ? 50 : Number(limitText);
  if (
    siteId !== siteId.trim() ||
    !isMerchantNumericId(siteId) ||
    limitText === "" ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > MAX_MERCHANT_ENTERPRISE_AUDIT_PAGE_SIZE ||
    (entityTypeText !== null &&
      (!entityTypeText ||
        !MERCHANT_ENTERPRISE_AUDIT_ENTITY_TYPES.includes(
          entityTypeText as MerchantEnterpriseAuditEntityType,
        ))) ||
    (eventTypeText !== null &&
      (!eventTypeText ||
        !MERCHANT_ENTERPRISE_AUDIT_EVENT_TYPES.includes(
          eventTypeText as MerchantEnterpriseAuditEventType,
        ))) ||
    (filterActorTypeText !== null &&
      !(["owner", "employee", "system"] as const).includes(
        filterActorTypeText as "owner" | "employee" | "system",
      )) ||
    (filterActorId !== null && !UUID_PATTERN.test(filterActorId)) ||
    (filterActorId !== null &&
      (filterActorTypeText === "owner" || filterActorTypeText === "system")) ||
    (createdFrom !== null &&
      createdToExclusive !== null &&
      Date.parse(createdFrom) >= Date.parse(createdToExclusive))
  ) {
    throw new Error("invalid_enterprise_audit_query");
  }
  const entityType = entityTypeText as MerchantEnterpriseAuditEntityType | null;
  const eventType = eventTypeText as MerchantEnterpriseAuditEventType | null;
  const filterActorType = filterActorTypeText as
    | "owner"
    | "employee"
    | "system"
    | null;
  if (entityType && eventType && !eventMatchesEntity(eventType, entityType)) {
    throw new Error("invalid_enterprise_audit_query");
  }
  return {
    siteId,
    limit,
    cursor: parseMerchantEnterpriseAuditCursor(searchParams.get("cursor")),
    ...(entityType ? { entityType } : {}),
    ...(eventType ? { eventType } : {}),
    ...(filterActorType ? { filterActorType } : {}),
    ...(filterActorId ? { filterActorId } : {}),
    ...(createdFrom ? { createdFrom } : {}),
    ...(createdToExclusive ? { createdToExclusive } : {}),
  };
}

export async function handleMerchantEnterpriseAuditEventsGet(
  request: Request,
  dependencyOverrides: Partial<MerchantEnterpriseAuditRouteDependencies> = {},
) {
  const dependencies = { ...DEFAULT_DEPENDENCIES, ...dependencyOverrides };
  try {
    const query = parseAuditQuery(request);
    const actor = await dependencies.resolveActor(request, {
      siteId: query.siteId,
      requiredPermission: "audit.view",
    });
    await dependencies.requireEnterpriseEntitlement(query.siteId);
    const page = await dependencies.loadAuditEvents({
      siteId: query.siteId,
      actor,
      limit: query.limit,
      cursor: query.cursor,
      ...(query.entityType ? { entityType: query.entityType } : {}),
      ...(query.eventType ? { eventType: query.eventType } : {}),
      ...(query.filterActorType
        ? { filterActorType: query.filterActorType }
        : {}),
      ...(query.filterActorId ? { filterActorId: query.filterActorId } : {}),
      ...(query.createdFrom ? { createdFrom: query.createdFrom } : {}),
      ...(query.createdToExclusive
        ? { createdToExclusive: query.createdToExclusive }
        : {}),
    });
    return response({
      ok: true,
      events: page.events,
      nextCursor: page.nextCursor
        ? encodeMerchantEnterpriseAuditCursor(page.nextCursor)
        : null,
    });
  } catch (error) {
    return fail(error);
  }
}

export async function GET(request: Request) {
  return handleMerchantEnterpriseAuditEventsGet(request);
}
