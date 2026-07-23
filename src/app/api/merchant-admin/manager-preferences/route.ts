import { NextResponse } from "next/server";
import {
  getMerchantManagerPreferencesStoredState,
  type MerchantManagerPreferenceKind,
} from "@/lib/merchantManagerPreferences";
import {
  getMerchantManagerPreferences,
  updateMerchantManagerPreferences,
} from "@/lib/merchantManagerPreferences.server";
import { isMerchantNumericId } from "@/lib/merchantIdentity";
import {
  getTrustedMutationRequestErrorResponse,
  isTrustedSameOriginMutationRequest,
} from "@/lib/requestMutationGuard";
import { resolveMerchantSessionFromRequest } from "@/lib/serverMerchantSession";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function noStoreJson(body: unknown, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("cache-control", "no-store");
  return response;
}

async function resolvePreferencesSession(request: Request, siteId: string) {
  const session = await resolveMerchantSessionFromRequest(request, {
    hintedMerchantId: siteId,
  });
  return session?.merchantId === siteId ? session : null;
}

function buildResponse(snapshot: Awaited<ReturnType<typeof getMerchantManagerPreferences>>) {
  return {
    ok: true,
    preferences: {
      booking: snapshot.booking,
      order: snapshot.order,
    },
    stored: getMerchantManagerPreferencesStoredState(snapshot),
    updatedAt: snapshot.updatedAt,
  };
}

export async function GET(request: Request) {
  const siteId = normalizeText(new URL(request.url).searchParams.get("siteId"));
  if (!isMerchantNumericId(siteId)) {
    return noStoreJson({ error: "invalid_site_id" }, { status: 400 });
  }
  if (!(await resolvePreferencesSession(request, siteId))) {
    return noStoreJson({ error: "unauthorized" }, { status: 401 });
  }
  try {
    return noStoreJson(buildResponse(await getMerchantManagerPreferences(siteId)));
  } catch (error) {
    return noStoreJson(
      {
        error: error instanceof Error ? error.message : "manager_preferences_load_failed",
      },
      { status: 503 },
    );
  }
}

export async function PATCH(request: Request) {
  if (!isTrustedSameOriginMutationRequest(request)) {
    return getTrustedMutationRequestErrorResponse();
  }
  const body = (await request.json().catch(() => null)) as
    | {
        siteId?: unknown;
        kind?: unknown;
        preferences?: unknown;
      }
    | null;
  const siteId = normalizeText(body?.siteId);
  const kind: MerchantManagerPreferenceKind | "" =
    body?.kind === "booking" || body?.kind === "order" ? body.kind : "";
  if (!isMerchantNumericId(siteId)) {
    return noStoreJson({ error: "invalid_site_id" }, { status: 400 });
  }
  if (!kind) {
    return noStoreJson({ error: "invalid_preference_kind" }, { status: 400 });
  }
  if (!(await resolvePreferencesSession(request, siteId))) {
    return noStoreJson({ error: "unauthorized" }, { status: 401 });
  }
  try {
    return noStoreJson(
      buildResponse(
        await updateMerchantManagerPreferences({
          siteId,
          kind,
          preferences: body?.preferences,
        }),
      ),
    );
  } catch (error) {
    return noStoreJson(
      {
        error: error instanceof Error ? error.message : "manager_preferences_save_failed",
      },
      { status: 503 },
    );
  }
}
