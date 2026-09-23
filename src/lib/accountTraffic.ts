/** Public analytics vocabulary. Never put contact/form contents in these events. */
export const TRAFFIC_ACTIONS = {
  website: ["view"],
  order: [],
  product: ["exposure", "view", "add_to_cart"],
  booking: ["exposure", "form_start", "submit_attempt"],
  coupon: ["exposure", "claim_attempt", "copy_attempt"],
  poll: ["exposure", "form_start", "submit_attempt"],
  membership: ["view", "entry_click", "form_start", "join_attempt"],
  card: ["view", "website_click", "contact_download_click", "phone_click", "email_click", "whatsapp_click"],
} as const;
export type TrafficModule = keyof typeof TRAFFIC_ACTIONS;
export type TrafficResource = { siteId: string; module: TrafficModule; objectId: string; label: string };
export type TrafficTokenEntry = { key: string; token: string };
export const TRAFFIC_MEDIA = ["unknown", "qr", "share", "nfc", "ad"] as const;
export type TrafficMedium = typeof TRAFFIC_MEDIA[number];
export const TRAFFIC_MEDIUM_PARAM = "faolla_medium";
export const TRAFFIC_CAMPAIGN_PARAM = "faolla_campaign";
export function trafficCampaign(search: string): string {
  try {
    const values = new URLSearchParams(search).getAll(TRAFFIC_CAMPAIGN_PARAM);
    return values.length === 1 && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(values[0]) && values[0].length <= 1024 ? values[0] : "";
  } catch { return ""; }
}
/** Used only on existing internal card redirects; never copies arbitrary query data. */
export function forwardTrafficTags(target: URL, source: URL): URL {
  const result = new URL(target.href);
  const medium = trafficMedium(source.search), campaign = trafficCampaign(source.search);
  if (medium !== "unknown") result.searchParams.set(TRAFFIC_MEDIUM_PARAM, medium);
  if (campaign) result.searchParams.set(TRAFFIC_CAMPAIGN_PARAM, campaign);
  return result;
}
/** A link label, not proof of a physical scan or actual sharing. No URL is retained. */
export function trafficMedium(search: string): TrafficMedium {
  try {
    const values = new URLSearchParams(search).getAll(TRAFFIC_MEDIUM_PARAM);
    return values.length === 1 && TRAFFIC_MEDIA.includes(values[0] as TrafficMedium) ? values[0] as TrafficMedium : "unknown";
  } catch { return "unknown"; }
}
export function buildTrafficChannelLink(value: string, medium: TrafficMedium): string {
  const url = new URL(value.trim());
  if (url.protocol !== "https:" || url.username || url.password || url.port
    || !(url.hostname === "faolla.com" || url.hostname.endsWith(".faolla.com"))
    || !TRAFFIC_MEDIA.includes(medium) || medium === "unknown") throw new Error("请输入 Faolla 公开网站或联系卡的 HTTPS 链接。");
  url.searchParams.set(TRAFFIC_MEDIUM_PARAM, medium);
  return url.href;
}
export function trafficResourceKey(module: TrafficModule, objectId: string) { return `${module}:${objectId}`; }
export function isTrafficAction(module: TrafficModule, action: unknown): action is string {
  return typeof action === "string" && (TRAFFIC_ACTIONS[module] as readonly string[]).includes(action);
}
export const TRAFFIC_SOURCES = ["direct_unknown", "internal", "google", "bing", "baidu", "facebook", "instagram", "other_referral"] as const;
export function trafficSource(referrer: string, origin: string): typeof TRAFFIC_SOURCES[number] {
  try {
    const url = new URL(referrer);
    if (!["https:", "http:"].includes(url.protocol)) return "direct_unknown";
    const host = url.hostname.toLowerCase();
    if (host === new URL(origin).hostname) return "internal";
    if (/(^|\.)google\.(com|es|co\.uk)$/.test(host)) return "google";
    for (const name of ["bing", "baidu", "facebook", "instagram"] as const) {
      if (host === `${name}.com` || host.endsWith(`.${name}.com`)) return name;
    }
    return "other_referral";
  } catch { return "direct_unknown"; }
}
export function trafficEnvironment(userAgent: string) {
  const ua = userAgent.slice(0, 1024);
  const bot = /bot\b|crawler|spider|headless|preview|facebookexternalhit|lighthouse|uptime|monitor/i.test(ua);
  const browser = /MicroMessenger/i.test(ua) ? "wechat" : /FBAN|FBAV/i.test(ua) ? "facebook_app"
    : /Instagram/i.test(ua) ? "instagram_app" : /Edg\//i.test(ua) ? "edge"
      : /Chrome|CriOS/i.test(ua) ? "chrome" : /Firefox|FxiOS/i.test(ua) ? "firefox"
        : /Safari/i.test(ua) ? "safari" : "other";
  const device = /iPad|Tablet/i.test(ua) ? "tablet" : /Mobile|iPhone|Android/i.test(ua) ? "mobile" : "desktop";
  return { bot, browser, device };
}
export type TrafficCountRow = { key: string; label?: string; module?: string; count: number; views?: number; exposures?: number; actions?: number; successes?: number };
export type AccountTrafficReport = {
  timezone: string; from: string; to: string; totalEvents: number; views: number; exposures: number; actions: number;
  firstCollectedAt: string | null; daily: TrafficCountRow[]; modules: TrafficCountRow[];
  objects: TrafficCountRow[]; sources: TrafficCountRow[]; browsers: TrafficCountRow[]; devices: TrafficCountRow[];
  actionTypes: TrafficCountRow[]; objectCount: number;
  media?: TrafficCountRow[];
  campaigns?: TrafficCountRow[];
  outcomes?: TrafficCountRow[];
  exportScope?: "all" | "page";
};
