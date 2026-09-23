import { createHash } from "node:crypto";
import { createServerSupabaseServiceClient } from "@/lib/superAdminServer";
import { trafficEnabled } from "@/lib/accountTraffic.server";
import { trafficCampaign, trafficEnvironment, trafficMedium, type TrafficModule } from "@/lib/accountTraffic";
import { readTrafficCampaign } from "@/lib/accountTrafficCampaign.server";
import { isMerchantNumericId } from "@/lib/merchantIdentity";

export const TRAFFIC_OUTCOMES = { booking: "booking_created", order: "order_created", membership: "membership_joined", poll: "poll_submitted" } as const;
type Input = { siteId: string; module: keyof typeof TRAFFIC_OUTCOMES; recordId: string; objectId: string; occurredAt: string };
const defaults = { enabled: trafficEnabled, client: createServerSupabaseServiceClient, now: Date.now };
export function trafficOutcomeId(siteId: string, module: TrafficModule, recordId: string) {
  const hex = createHash("sha256").update(JSON.stringify(["traffic-outcome-v1", siteId, module, recordId])).digest("hex");
  // UUID v5-shaped internal key; the public collector accepts only v4 and no success actions.
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-5${hex.slice(13,16)}-8${hex.slice(17,20)}-${hex.slice(20,32)}`;
}
/** Best-effort, isolated from business writes; never awaited by a business handler. */
export async function recordTrafficOutcome(request: Request, input: Input, overrides: Partial<typeof defaults> = {}) {
  try {
    const deps = { ...defaults, ...overrides };
    if (!deps.enabled() || request.headers.get("dnt") === "1" || request.headers.get("sec-gpc") === "1"
      || !isMerchantNumericId(input.siteId) || !Object.hasOwn(TRAFFIC_OUTCOMES, input.module)
      || !input.recordId || input.recordId.length > 240 || !input.objectId || input.objectId.length > 240) return false;
    const at = Date.parse(input.occurredAt), now = deps.now();
    // Do not count re-opening an old membership or old idempotent orders as new conversions.
    if (!Number.isFinite(at) || at > now + 60000 || at < now - 600000) return false;
    const environment = trafficEnvironment(request.headers.get("user-agent") || "");
    if (environment.bot) return false;
    let search = "";
    try { const ref = new URL(request.headers.get("referer") || ""); if (ref.origin === new URL(request.url).origin) search = ref.search; } catch { /* no attribution */ }
    const campaign = readTrafficCampaign(trafficCampaign(search), input.siteId);
    const client = deps.client(); if (!client) return false;
    const { error } = await client.from("account_traffic_events").upsert([{
      site_id: input.siteId, event_id: trafficOutcomeId(input.siteId,input.module,input.recordId), module: input.module,
      object_id: input.objectId, object_label: { booking: "预约模块", order: "订单创建", membership: "会员入口", poll: "投票模块" }[input.module],
      action: TRAFFIC_OUTCOMES[input.module], source: "direct_unknown", medium: campaign?.medium || trafficMedium(search),
      campaign_id: campaign?.id || "", campaign_label: campaign?.label || "", browser: environment.browser, device: environment.device,
      created_at: new Date(at).toISOString(),
    }], { onConflict: "site_id,event_id", ignoreDuplicates: true }).abortSignal(AbortSignal.timeout(2000));
    return !error;
  } catch { return false; }
}
