import { trafficSource, trafficMedium, trafficCampaign, type TrafficMedium } from "@/lib/accountTraffic";
type PendingEvent = { id: string; token: string; action: string; source: string; medium: TrafficMedium; campaign?: string };
const queue: PendingEvent[] = [];
let timer: ReturnType<typeof setTimeout> | undefined;
let listening = false;
export function trafficClientAllowed() {
  return typeof window !== "undefined" && window.top === window && navigator.doNotTrack !== "1"
    && !(navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl;
}
function flushTraffic() {
  if (timer) clearTimeout(timer);
  timer = undefined;
  if (!trafficClientAllowed()) { queue.length = 0; return; }
  const events = queue.splice(0, 10);
  if (!events.length) return;
  // No retry loop, storage, or dependence on a successful analytics request.
  void fetch("/api/traffic/collect", { method: "POST", credentials: "omit", keepalive: true,
    headers: { "Content-Type": "application/json" }, body: JSON.stringify({ events }), signal: AbortSignal.timeout(4000),
  }).catch(() => undefined);
  if (queue.length) timer = setTimeout(flushTraffic, 1200);
}
export function enqueueTraffic(token: string, action: string) {
  try {
  if (!token || !trafficClientAllowed() || !crypto.randomUUID || queue.length >= 40) return;
  queue.push({ id: crypto.randomUUID(), token, action, source: trafficSource(document.referrer, location.origin), medium: trafficMedium(location.search), campaign: trafficCampaign(location.search) || undefined });
  if (!timer) timer = setTimeout(flushTraffic, 1200);
  if (!listening) {
    listening = true;
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flushTraffic(); });
    window.addEventListener("pagehide", flushTraffic);
  }
  } catch { /* Restricted browser APIs are not a business-operation failure. */ }
}
