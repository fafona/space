import { NextResponse } from "next/server";
import { isMerchantNumericId } from "@/lib/merchantIdentity";
import { fetchPublishedSitePayloadFromSupabase } from "@/lib/publishedSiteData";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export { isMissingPublishedSlugColumn, pickPublishedPageRow } from "@/lib/publishedSiteData";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const siteId = String(searchParams.get("siteId") ?? "").trim();
  if (!isMerchantNumericId(siteId)) {
    return NextResponse.json({ error: "invalid_site_id" }, { status: 400 });
  }

  if (
    !(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim() ||
    !((process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim() || (process.env.NEXT_SUPABASE_SERVICE_ROLE_KEY ?? "").trim())
  ) {
    return NextResponse.json({ error: "site_published_env_missing" }, { status: 503 });
  }

  try {
    const payload = await fetchPublishedSitePayloadFromSupabase(siteId);
    if (!payload || payload.blocks.length === 0) {
      return NextResponse.json({ error: "site_published_not_found" }, { status: 404 });
    }

    return NextResponse.json({
      ok: true,
      siteId: payload.siteId,
      slug: payload.slug,
      merchantName: payload.merchantName,
      serviceState: payload.serviceState,
      blocks: payload.blocks,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "site_published_failed",
        message: error instanceof Error ? error.message : "unknown_error",
      },
      { status: 500 },
    );
  }
}
