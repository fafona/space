import { NextResponse } from "next/server";
import { isTrustedSameOriginMutationRequest } from "@/lib/requestMutationGuard";
import { createServerSupabaseServiceClient } from "@/lib/superAdminServer";
import { isTrafficAction, TRAFFIC_MEDIA, TRAFFIC_SOURCES, trafficEnvironment } from "@/lib/accountTraffic";
import { allowTrafficRequest, readTrafficJson, readTrafficResource, trafficEnabled } from "@/lib/accountTraffic.server";
import { readTrafficCampaign } from "@/lib/accountTrafficCampaign.server";

const defaults = { enabled: trafficEnabled, allow: allowTrafficRequest, verify: readTrafficResource, campaign: readTrafficCampaign, client: createServerSupabaseServiceClient };
export async function handleTrafficCollect(request: Request, overrides: Partial<typeof defaults> = {}) {
  const deps = { ...defaults, ...overrides };
  const response = (status: number) => new NextResponse(null, { status, headers: { "Cache-Control": "no-store" } });
  if (!deps.enabled()) return response(204);
  if (!isTrustedSameOriginMutationRequest(request)) return response(403);
  if (request.headers.get("sec-gpc") === "1" || request.headers.get("dnt") === "1") return response(204);
  const environment = trafficEnvironment(request.headers.get("user-agent") ?? "");
  if (environment.bot) return response(204);
  if (!deps.allow(request, "collect")) return response(429);
  let body;
  try { body = await readTrafficJson(request) as { events?: unknown[] }; } catch { return response(400); }
  if (!body || !Array.isArray(body.events) || !body.events.length || body.events.length > 10) return response(400);
  const rows = [];
  for (const raw of body.events) {
    if (!raw || typeof raw !== "object") return response(400);
    const event = raw as Record<string, unknown>;
    const resource = deps.verify(event.token);
    if (!resource || !isTrafficAction(resource.module, event.action)
      || typeof event.id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(event.id)
      || !TRAFFIC_SOURCES.includes(event.source as never)
      || (event.medium !== undefined && !TRAFFIC_MEDIA.includes(event.medium as never))) return response(400);
    const campaign = deps.campaign(event.campaign, resource.siteId);
    rows.push({ site_id: resource.siteId, event_id: event.id, module: resource.module, object_id: resource.objectId,
      object_label: resource.label, action: event.action, source: String(event.source), medium: campaign?.medium ?? event.medium ?? "unknown",
      campaign_id: campaign?.id || "", campaign_label: campaign?.label || "", browser: environment.browser, device: environment.device });
  }
  try {
    const client = deps.client();
    if (!client) return response(503);
    const { error } = await client.from("account_traffic_events").upsert(rows, { onConflict: "site_id,event_id", ignoreDuplicates: true }).abortSignal(AbortSignal.timeout(3000));
    return response(error ? 503 : 204);
  } catch { return response(503); }
}
