import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { isSuperAdminRequestAuthorized } from "@/lib/superAdminRequestAuth";
import { isTrustedSameOriginMutationRequest } from "@/lib/requestMutationGuard";
import { isMerchantNumericId } from "@/lib/merchantIdentity";
import { readTrafficJson } from "@/lib/accountTraffic.server";
import { signTrafficCampaign } from "@/lib/accountTrafficCampaign.server";
import { buildTrafficChannelLink, TRAFFIC_CAMPAIGN_PARAM, type TrafficMedium } from "@/lib/accountTraffic";
const defaults = { authorize: isSuperAdminRequestAuthorized, sign: signTrafficCampaign, id: randomUUID };
export async function handleTrafficCampaign(request: Request, overrides: Partial<typeof defaults> = {}) {
  const deps = { ...defaults, ...overrides };
  const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store, private", Vary: "Cookie" } });
  if (!await deps.authorize(request)) return json({ error: "unauthorized" }, 401);
  if (!isTrustedSameOriginMutationRequest(request)) return json({ error: "forbidden_origin" }, 403);
  try {
    const body = await readTrafficJson(request, 4096) as Record<string, unknown>;
    if (!body || !isMerchantNumericId(String(body.siteId || "")) || typeof body.label !== "string"
      || !body.label.trim() || body.label.length > 80 || /[\x00-\x1f]/.test(body.label) || typeof body.url !== "string" || body.url.length > 2048) return json({ error: "invalid_campaign" }, 400);
    const url = new URL(buildTrafficChannelLink(body.url, body.medium as TrafficMedium));
    const id = deps.id(), token = deps.sign({ siteId: String(body.siteId), id, label: body.label.trim(), medium: body.medium as TrafficMedium });
    if (!token) return json({ error: "signing_unavailable", message: "统计签名尚未配置，暂不能生成活动链接。" }, 503);
    url.searchParams.set(TRAFFIC_CAMPAIGN_PARAM, token);
    return json({ id, label: body.label.trim(), url: url.href });
  } catch { return json({ error: "invalid_campaign", message: "请检查活动名称与公开页面链接。" }, 400); }
}
