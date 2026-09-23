import { NextResponse } from "next/server";
import { isMerchantNumericId } from "@/lib/merchantIdentity";
import { isTrustedSameOriginMutationRequest } from "@/lib/requestMutationGuard";
import { fetchPublishedSitePayloadFromSupabase } from "@/lib/publishedSiteData";
import { loadMerchantCatalog } from "@/lib/merchantCatalogStore";
import { trafficEnvironment, trafficResourceKey } from "@/lib/accountTraffic";
import { allowTrafficRequest, readTrafficJson, signTrafficResource, trafficEnabled } from "@/lib/accountTraffic.server";
import { resolveTrafficResources } from "@/lib/accountTrafficResources.server";
import { cachedTrafficContext } from "@/lib/accountTrafficContextCache.server";

export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
  if (!trafficEnabled()) return json({ tokens: [], enabled: false });
  if (!isTrustedSameOriginMutationRequest(request)) return json({ error: "forbidden_origin" }, 403);
  if (request.headers.get("sec-gpc") === "1" || request.headers.get("dnt") === "1") return json({ tokens: [] });
  if (trafficEnvironment(request.headers.get("user-agent") ?? "").bot) return json({ tokens: [] });
  if (!allowTrafficRequest(request, "context")) return json({ error: "rate_limited" }, 429);
  let body;
  try { body = await readTrafficJson(request, 2048) as Record<string, unknown>; } catch { return json({ error: "invalid_request" }, 400); }
  if (!body || !isMerchantNumericId(String(body.siteId ?? "")) || typeof body.pageId !== "string" || body.pageId.length > 200
    || (body.viewport !== "desktop" && body.viewport !== "mobile")
    || (body.resourceKey !== undefined && (typeof body.resourceKey !== "string" || body.resourceKey.length > 260))) return json({ error: "invalid_scope" }, 400);
  try {
    const siteId = String(body.siteId);
    const pageId = body.pageId;
    const viewport = body.viewport;
    const resources = await cachedTrafficContext(`${siteId}:${viewport}:${pageId}`, async () => {
      const published = await fetchPublishedSitePayloadFromSupabase(siteId);
      if (!published?.serviceState || published.serviceState.maintenance || published.serviceState.expired || published.serviceState.status !== "online") return [];
      const input = { siteId, blocks: published.blocks, pageId, viewport: viewport as "desktop" | "mobile" };
      const base = resolveTrafficResources({ ...input, catalog: null });
      if (!base.some((resource) => resource.module === "product")) return base;
      const catalog = await loadMerchantCatalog(siteId);
      return catalog ? resolveTrafficResources({ ...input, catalog }) : base;
    });
    const selected = body.resourceKey ? resources.filter((resource) => trafficResourceKey(resource.module, resource.objectId) === body.resourceKey) : resources.slice(0, 200);
    return json({ enabled: true, tokens: selected.map((resource) => ({ key: trafficResourceKey(resource.module, resource.objectId), token: signTrafficResource(resource) })) });
  } catch { return json({ error: "traffic_unavailable" }, 503); }
}
