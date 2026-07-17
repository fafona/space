import { NextResponse } from "next/server";
import { findGoogleBusinessProfileLocation } from "@/lib/googleBusinessProfile";
import {
  discoverGoogleBusinessProfileResources,
  markGoogleBusinessProfileError,
  revokeGoogleBusinessProfileAuthorization,
  syncGoogleBusinessProfileReviews,
  toGoogleBusinessProfileClientStatus,
  toGoogleBusinessProfileUserMessage,
} from "@/lib/googleBusinessProfileServer";
import {
  deleteGoogleBusinessProfileIntegration,
  loadGoogleBusinessProfileIntegration,
  saveGoogleBusinessProfileIntegration,
} from "@/lib/googleBusinessProfileStore";
import { isMerchantNumericId } from "@/lib/merchantIdentity";
import { getTrustedMutationRequestErrorResponse, isTrustedSameOriginMutationRequest } from "@/lib/requestMutationGuard";
import { resolveMerchantSessionFromRequest } from "@/lib/serverMerchantSession";
import { createServerSupabaseServiceClient } from "@/lib/superAdminServer";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function trimText(value: unknown, maxLength = 4096) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

async function authorize(request: Request, siteId: string) {
  if (!isMerchantNumericId(siteId)) return false;
  const session = await resolveMerchantSessionFromRequest(request, { hintedMerchantId: siteId });
  return Boolean(session && session.merchantId === siteId);
}

function requireStore() {
  const supabase = createServerSupabaseServiceClient();
  if (!supabase) throw new Error("google_business_profile_store_unavailable");
  return supabase;
}

export async function GET(request: Request) {
  const siteId = trimText(new URL(request.url).searchParams.get("siteId"), 64);
  if (!isMerchantNumericId(siteId)) return NextResponse.json({ error: "invalid_site_id" }, { status: 400 });
  if (!(await authorize(request, siteId))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const integration = await loadGoogleBusinessProfileIntegration(requireStore(), siteId);
    return NextResponse.json({ ok: true, status: toGoogleBusinessProfileClientStatus(integration) });
  } catch (error) {
    return NextResponse.json(
      { error: "google_business_profile_status_failed", message: toGoogleBusinessProfileUserMessage(error) },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  if (!isTrustedSameOriginMutationRequest(request)) return getTrustedMutationRequestErrorResponse();
  const body = (await request.json().catch(() => null)) as {
    siteId?: unknown;
    action?: unknown;
    accountName?: unknown;
    locationName?: unknown;
  } | null;
  const siteId = trimText(body?.siteId, 64);
  const action = trimText(body?.action, 64);
  if (!isMerchantNumericId(siteId)) return NextResponse.json({ error: "invalid_site_id" }, { status: 400 });
  if (!(await authorize(request, siteId))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const supabase = requireStore();
  let integration = await loadGoogleBusinessProfileIntegration(supabase, siteId);
  if (!integration) {
    return NextResponse.json(
      { error: "google_business_profile_not_connected", message: "请先连接 Google 商家资料。" },
      { status: 409 },
    );
  }

  if (action === "disconnect") {
    await revokeGoogleBusinessProfileAuthorization(integration);
    await deleteGoogleBusinessProfileIntegration(supabase, siteId);
    return NextResponse.json({ ok: true, status: toGoogleBusinessProfileClientStatus(null) });
  }

  try {
    if (action === "refresh-locations") {
      integration = await discoverGoogleBusinessProfileResources(integration);
      if (integration.locations.length === 1 && integration.selectedLocationName) {
        integration = await syncGoogleBusinessProfileReviews(integration);
      }
    } else if (action === "select-location") {
      const accountName = trimText(body?.accountName, 240);
      const locationName = trimText(body?.locationName, 240);
      const location = findGoogleBusinessProfileLocation(integration.locations, accountName, locationName);
      if (!location) {
        return NextResponse.json({ error: "google_location_not_found", message: "所选 Google 商家地点不存在。" }, { status: 400 });
      }
      const selectionChanged =
        integration.selectedAccountName !== location.accountName || integration.selectedLocationName !== location.name;
      integration = {
        ...integration,
        selectedAccountName: location.accountName,
        selectedLocationName: location.name,
        snapshot: selectionChanged ? null : integration.snapshot,
        updatedAt: new Date().toISOString(),
      };
      integration = await syncGoogleBusinessProfileReviews(integration);
    } else if (action === "sync") {
      integration = await syncGoogleBusinessProfileReviews(integration);
    } else {
      return NextResponse.json({ error: "invalid_action" }, { status: 400 });
    }
    await saveGoogleBusinessProfileIntegration(supabase, integration);
    return NextResponse.json({ ok: true, status: toGoogleBusinessProfileClientStatus(integration) });
  } catch (error) {
    integration = markGoogleBusinessProfileError(integration, error);
    await saveGoogleBusinessProfileIntegration(supabase, integration).catch(() => null);
    return NextResponse.json(
      {
        error: "google_business_profile_action_failed",
        message: toGoogleBusinessProfileUserMessage(error),
        status: toGoogleBusinessProfileClientStatus(integration),
      },
      { status: 502 },
    );
  }
}
