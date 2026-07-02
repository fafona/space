import { NextResponse } from "next/server";
import { isMerchantNumericId } from "@/lib/merchantIdentity";
import { fetchPublishedSiteBlocksFromSupabase } from "@/lib/publishedSiteData";
import { createServerTiming } from "@/lib/serverTiming";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export { isMissingPublishedSlugColumn, isPublishedBlocksPayload, pickPublishedPageRow } from "@/lib/publishedSiteData";

const SITE_PUBLISHED_SUCCESS_CACHE_CONTROL = "no-store, max-age=0";
const SITE_PUBLISHED_PAYLOAD_TIMEOUT_MS = 25_000;
const SITE_PUBLISHED_TIMEOUT = Symbol("site_published_timeout");

type SitePublishedPayloadResult = Awaited<ReturnType<typeof fetchPublishedSiteBlocksFromSupabase>>;

async function withSitePublishedTimeout(promise: Promise<SitePublishedPayloadResult>) {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<typeof SITE_PUBLISHED_TIMEOUT>((resolve) => {
        timeout = setTimeout(() => resolve(SITE_PUBLISHED_TIMEOUT), SITE_PUBLISHED_PAYLOAD_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function GET(request: Request) {
  const timing = createServerTiming();
  const withTiming = (response: NextResponse) => {
    timing.apply(response.headers);
    return response;
  };
  const { searchParams } = new URL(request.url);
  const siteId = String(searchParams.get("siteId") ?? "").trim();
  if (!isMerchantNumericId(siteId)) {
    return withTiming(NextResponse.json({ error: "invalid_site_id" }, { status: 400 }));
  }

  if (
    !(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim() ||
    !((process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim() || (process.env.NEXT_SUPABASE_SERVICE_ROLE_KEY ?? "").trim())
  ) {
    return withTiming(NextResponse.json({ error: "site_published_env_missing" }, { status: 503 }));
  }

  try {
    const payload = await timing.time("payload", () => withSitePublishedTimeout(fetchPublishedSiteBlocksFromSupabase(siteId)));
    if (payload === SITE_PUBLISHED_TIMEOUT) {
      return withTiming(NextResponse.json(
        { error: "site_published_timeout" },
        {
          status: 503,
          headers: {
            "cache-control": "no-store, max-age=0",
          },
        },
      ));
    }
    if (!payload || payload.blocks.length === 0) {
      return withTiming(NextResponse.json({ error: "site_published_not_found" }, { status: 404 }));
    }

    return withTiming(NextResponse.json(
      {
        ok: true,
        siteId: payload.siteId,
        slug: payload.slug,
        merchantName: "",
        serviceState: null,
        orderManagementEnabled: payload.orderManagementEnabled,
        blocks: payload.blocks,
      },
      {
        headers: {
          "cache-control": SITE_PUBLISHED_SUCCESS_CACHE_CONTROL,
        },
      },
    ));
  } catch (error) {
    return withTiming(NextResponse.json(
      {
        error: "site_published_failed",
        message: error instanceof Error ? error.message : "unknown_error",
      },
      { status: 500 },
    ));
  }
}
