import { createHmac, timingSafeEqual } from "node:crypto";
import { TRAFFIC_MEDIA, type TrafficMedium } from "@/lib/accountTraffic";
import { isMerchantNumericId } from "@/lib/merchantIdentity";
export type TrafficCampaign = { siteId: string; id: string; label: string; medium: TrafficMedium };
function valid(value: TrafficCampaign) {
  return value && isMerchantNumericId(value.siteId) && typeof value.id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.id)
    && typeof value.label === "string" && value.label.trim().length > 0 && value.label.length <= 80
    && TRAFFIC_MEDIA.includes(value.medium) && value.medium !== "unknown";
}
const digest = (body: string, secret: string) => createHmac("sha256", secret).update("traffic-campaign-v1:" + body).digest("base64url");
/** Static printed links remain usable until the analytics signing key is rotated. */
export function signTrafficCampaign(value: TrafficCampaign, secret = process.env.FAOLLA_TRAFFIC_SIGNING_SECRET ?? "") {
  if (secret.length < 32 || !valid(value)) return "";
  const body = Buffer.from(JSON.stringify({ ...value, label: value.label.trim(), v: 1 })).toString("base64url");
  return `${body}.${digest(body, secret)}`;
}
export function readTrafficCampaign(token: unknown, siteId: string, secret = process.env.FAOLLA_TRAFFIC_SIGNING_SECRET ?? ""): TrafficCampaign | null {
  if (secret.length < 32 || typeof token !== "string" || token.length > 1024) return null;
  try {
    const [body, signature, extra] = token.split(".");
    if (!body || !signature || extra) return null;
    const expected = Buffer.from(digest(body, secret)), actual = Buffer.from(signature);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
    const value = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    return value.v === 1 && value.siteId === siteId && valid(value) ? { siteId, id: value.id, label: value.label, medium: value.medium } : null;
  } catch { return null; }
}
