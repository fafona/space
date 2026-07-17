import { NextResponse } from "next/server";
import { findGoogleBusinessProfileLocation } from "@/lib/googleBusinessProfile";
import {
  markGoogleBusinessProfileError,
  syncGoogleBusinessProfileReviews,
} from "@/lib/googleBusinessProfileServer";
import {
  loadGoogleBusinessProfileIntegration,
  saveGoogleBusinessProfileIntegration,
  type GoogleBusinessProfileIntegration,
} from "@/lib/googleBusinessProfileStore";
import { isMerchantNumericId } from "@/lib/merchantIdentity";
import { createServerSupabaseServiceClient } from "@/lib/superAdminServer";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const syncTasks = new Map<string, Promise<GoogleBusinessProfileIntegration>>();

function trimText(value: unknown, maxLength = 4096) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function readSyncIntervalMs() {
  const configured = Number(process.env.GOOGLE_BUSINESS_PROFILE_SYNC_INTERVAL_MS ?? "");
  if (!Number.isFinite(configured)) return 15 * 60 * 1000;
  return Math.max(5 * 60 * 1000, Math.min(24 * 60 * 60 * 1000, Math.round(configured)));
}

function isFresh(integration: GoogleBusinessProfileIntegration) {
  const syncedAt = new Date(integration.snapshot?.syncedAt ?? "").getTime();
  return Number.isFinite(syncedAt) && syncedAt > Date.now() - readSyncIntervalMs();
}

function publicPayload(integration: GoogleBusinessProfileIntegration, stale: boolean) {
  const location = findGoogleBusinessProfileLocation(
    integration.locations,
    integration.selectedAccountName,
    integration.selectedLocationName,
  );
  return {
    ok: true,
    stale,
    snapshot: integration.snapshot,
    location: location
      ? { title: location.title, mapsUri: location.mapsUri, newReviewUri: location.newReviewUri }
      : null,
  };
}

export async function GET(request: Request) {
  const siteId = trimText(new URL(request.url).searchParams.get("siteId"), 64);
  if (!isMerchantNumericId(siteId)) return NextResponse.json({ error: "invalid_site_id" }, { status: 400 });
  const supabase = createServerSupabaseServiceClient();
  if (!supabase) return NextResponse.json({ error: "service_unavailable" }, { status: 503 });
  let integration = await loadGoogleBusinessProfileIntegration(supabase, siteId).catch(() => null);
  if (!integration || !integration.selectedLocationName) {
    return NextResponse.json({ error: "google_reviews_not_connected" }, { status: 404 });
  }

  if (!isFresh(integration)) {
    let task = syncTasks.get(siteId);
    if (!task) {
      const source = integration;
      task = syncGoogleBusinessProfileReviews(source)
        .then(async (next) => {
          await saveGoogleBusinessProfileIntegration(supabase, next);
          return next;
        })
        .finally(() => syncTasks.delete(siteId));
      syncTasks.set(siteId, task);
    }
    try {
      integration = await task;
    } catch (error) {
      integration = markGoogleBusinessProfileError(integration, error);
      await saveGoogleBusinessProfileIntegration(supabase, integration).catch(() => null);
      if (!integration.snapshot) return NextResponse.json({ error: "google_reviews_sync_failed" }, { status: 503 });
      return NextResponse.json(publicPayload(integration, true), {
        headers: { "cache-control": "public, s-maxage=60, stale-while-revalidate=300" },
      });
    }
  }

  if (!integration.snapshot) return NextResponse.json({ error: "google_reviews_not_synced" }, { status: 404 });
  return NextResponse.json(publicPayload(integration, false), {
    headers: { "cache-control": "public, s-maxage=300, stale-while-revalidate=900" },
  });
}
