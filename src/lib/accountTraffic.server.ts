import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { isMerchantNumericId } from "@/lib/merchantIdentity";
import { TRAFFIC_ACTIONS, type TrafficResource } from "@/lib/accountTraffic";

export function trafficEnabled() {
  return process.env.FAOLLA_TRAFFIC_ENABLED === "1" && (process.env.FAOLLA_TRAFFIC_SIGNING_SECRET?.length ?? 0) >= 32;
}
function signature(body: string, secret: string) { return createHmac("sha256", secret).update(body).digest("base64url"); }
export function signTrafficResource(resource: TrafficResource, secret = process.env.FAOLLA_TRAFFIC_SIGNING_SECRET ?? "", now = Date.now()) {
  if (secret.length < 32 || !isMerchantNumericId(resource.siteId) || !Object.hasOwn(TRAFFIC_ACTIONS, resource.module)
    || typeof resource.objectId !== "string" || !resource.objectId || resource.objectId.length > 240 || typeof resource.label !== "string") return "";
  const body = Buffer.from(JSON.stringify({ ...resource, label: resource.label.slice(0, 120), exp: Math.floor(now / 1000) + 3600, v: 1 })).toString("base64url");
  return `${body}.${signature(body, secret)}`;
}
export function readTrafficResource(token: unknown, secret = process.env.FAOLLA_TRAFFIC_SIGNING_SECRET ?? "", now = Date.now()): TrafficResource | null {
  if (typeof token !== "string" || token.length > 2048 || secret.length < 32) return null;
  try {
    const [body, sig, extra] = token.split(".");
    if (!body || !sig || extra) return null;
    const expected = Buffer.from(signature(body, secret));
    const actual = Buffer.from(sig);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
    const value = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (value.v !== 1 || !Number.isFinite(value.exp) || value.exp <= now / 1000 || value.exp > now / 1000 + 3601
      || !isMerchantNumericId(value.siteId) || !Object.hasOwn(TRAFFIC_ACTIONS, value.module)
      || typeof value.objectId !== "string" || !value.objectId || value.objectId.length > 240
      || typeof value.label !== "string" || value.label.length > 120) return null;
    return { siteId: value.siteId, module: value.module, objectId: value.objectId, label: value.label };
  } catch { return null; }
}

// Ephemeral, bounded abuse limiter, not a visitor identifier or a distributed quota.
const salt = randomBytes(32);
const buckets = new Map<string, { count: number; until: number }>();
export function allowTrafficRequest(request: Request, kind: "context" | "collect", now = Date.now()) {
  const ip = request.headers.get("x-real-ip") || request.headers.get("x-forwarded-for")?.split(",")[0] || "unknown";
  const key = createHmac("sha256", salt).update(`${kind}:${ip.slice(0, 100)}`).digest("hex");
  if (buckets.size >= 10000) {
    for (const [entry, value] of buckets) if (value.until <= now) buckets.delete(entry);
    if (buckets.size >= 10000 && !buckets.has(key)) return false;
  }
  const current = buckets.get(key);
  if (!current || current.until <= now) { buckets.set(key, { count: 1, until: now + 60000 }); return true; }
  return ++current.count <= (kind === "context" ? 30 : 90);
}

export async function readTrafficJson(request: Request, maxBytes = 24576): Promise<unknown> {
  if (!request.headers.get("content-type")?.includes("application/json")) throw new Error("invalid_content_type");
  if (Number(request.headers.get("content-length")) > maxBytes) throw new Error("body_too_large");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("empty_body");
  const parts: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw new Error("body_too_large"); }
      parts.push(value);
    }
  } finally { reader.releaseLock(); }
  return JSON.parse(Buffer.concat(parts).toString("utf8"));
}
