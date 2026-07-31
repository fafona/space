import { NextResponse } from "next/server";
import type { MerchantTaskEvent } from "@/lib/merchantEnterprise";
import {
  resolveMerchantEnterpriseActor,
  toMerchantEnterpriseAccessResponse,
} from "@/lib/merchantEnterpriseAuth.server";
import {
  addMerchantTaskComment,
  loadMerchantTaskEvents,
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

type TaskEventBody = {
  siteId?: unknown;
  taskId?: unknown;
  text?: unknown;
  operationId?: unknown;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function storeClient() {
  const client = createServerSupabaseServiceClient();
  if (!client) throw new Error("enterprise_store_unavailable");
  return client as unknown as MerchantEnterpriseStoreClient;
}

function taskId(value: unknown) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!UUID_PATTERN.test(normalized)) throw new Error("invalid_task_id");
  return normalized;
}

function commentText(value: unknown) {
  if (typeof value !== "string") throw new Error("invalid_task_comment");
  const normalized = value.trim();
  if (!normalized || normalized.length > 2000) {
    throw new Error("invalid_task_comment");
  }
  return normalized;
}

function operationId(request: Request, body: TaskEventBody | null) {
  const hasBodyOperationId = Boolean(
    body && Object.prototype.hasOwnProperty.call(body, "operationId"),
  );
  const raw = hasBodyOperationId
    ? body?.operationId
    : request.headers.get("idempotency-key") ?? undefined;
  if (raw === undefined) return "";
  if (typeof raw !== "string") throw new Error("invalid_operation_id");
  const trimmed = raw.trim();
  const normalized = normalizeMutationOperationId(trimmed);
  if (!trimmed || normalized !== trimmed) throw new Error("invalid_operation_id");
  return normalized;
}

function fail(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message === "task_not_found") {
    return NextResponse.json({ ok: false, error: message }, { status: 404 });
  }
  if (
    message === "invalid_task_archived" ||
    message === "enterprise_operation_in_progress"
  ) {
    return NextResponse.json({ ok: false, error: message }, { status: 409 });
  }
  const resolved = toMerchantEnterpriseAccessResponse(error);
  return NextResponse.json(resolved.body, { status: resolved.status });
}

function siteId(value: unknown) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!isMerchantNumericId(normalized)) throw new Error("invalid_site_id");
  return normalized;
}

export function toPublicMerchantTaskEvent(event: MerchantTaskEvent): MerchantTaskEvent {
  return event.actorType === "owner" ? { ...event, actorId: "" } : event;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const requestedSiteId = siteId(url.searchParams.get("siteId"));
    const requestedTaskId = taskId(url.searchParams.get("taskId"));
    await resolveMerchantEnterpriseActor(request, {
      siteId: requestedSiteId,
      requiredPermission: "tasks.view",
    });
    const events = await loadMerchantTaskEvents(
      storeClient(),
      requestedSiteId,
      requestedTaskId,
    );
    return NextResponse.json({
      ok: true,
      events: events.map(toPublicMerchantTaskEvent),
    });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  if (!isTrustedSameOriginMutationRequest(request)) {
    return getTrustedMutationRequestErrorResponse();
  }
  try {
    const body = (await request.json().catch(() => null)) as TaskEventBody | null;
    const requestedSiteId = siteId(body?.siteId);
    const requestedTaskId = taskId(body?.taskId);
    const requestedText = commentText(body?.text);
    const requestedOperationId = operationId(request, body);
    const actor = await resolveMerchantEnterpriseActor(request, {
      siteId: requestedSiteId,
      requiredPermission: "tasks.update",
    });
    const event = await addMerchantTaskComment(storeClient(), {
      siteId: requestedSiteId,
      taskId: requestedTaskId,
      text: requestedText,
      actorType: actor.type,
      actorId: actor.id,
      operationId: requestedOperationId,
    });
    return NextResponse.json({ ok: true, event: toPublicMerchantTaskEvent(event) });
  } catch (error) {
    return fail(error);
  }
}
