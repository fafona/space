import type { CheckoutClientRequest } from "./merchantCheckoutClient";
import { parseLegacyOrderReview, parseLegacyReviewRequest, type LegacyOrderReview, type LegacyReviewRequest } from "./merchantCheckoutLegacyReview";
const endpoint = "/api/member-checkout/legacy/review";
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
export function legacyReviewTransport(accountId: string): CheckoutClientRequest {
  if (!/^\d{8}$/.test(accountId)) throw new Error("unauthorized");
  return async (path, body, signal) => {
    if (path !== endpoint) throw new Error("invalid");
    const response = await fetch(endpoint, { method: "POST", credentials: "same-origin", cache: "no-store", headers: { "content-type": "application/json", "x-checkout-account-scope": accountId }, body: JSON.stringify(body), signal });
    if (!response.ok) throw new Error("unavailable"); return response.json();
  };
}
export function legacyReviewStorageKey(siteId: string, blockId: string) {
  parseLegacyReviewRequest({ siteId, blockId, requestId: "validate-only" }); return `merchant-space:product-cart:v1:${siteId}:${blockId}`;
}
type State = { phase: "idle" | "empty" | "ready" | "reading" | "owned" | "unconfirmed" | "error"; review: LegacyOrderReview | null };
/** Only getItem. Activation captures a reference but does not query a server.
 * A record match never authorizes a draft import, write, clear or new checkout. */
export function createLegacyReviewController(options: { siteId: string; blockId: string; accountId: string; storage?: Pick<Storage, "getItem">; request?: CheckoutClientRequest }) {
  const key = legacyReviewStorageKey(options.siteId, options.blockId), request = options.request ?? legacyReviewTransport(options.accountId);
  if (!/^\d{8}$/.test(options.accountId)) throw new Error("unauthorized");
  let state: State = { phase: "idle", review: null }, active = false, busy = false, epoch = 0, captured: string | null = null, query: LegacyReviewRequest | null = null, abort = new AbortController();
  const listeners = new Set<() => void>(), publish = (phase: State["phase"], review: LegacyOrderReview | null = null) => { state = { phase, review }; listeners.forEach(f => f()); };
  const read = () => {
    const raw = (options.storage ?? window.localStorage).getItem(key); if (raw === null) return { raw, query: null };
    if (new TextEncoder().encode(raw).length > 1_048_576) throw new Error("invalid");
    const value: unknown = JSON.parse(raw);
    if (!object(value) || typeof value.clientRequestId !== "string") throw new Error("invalid");
    return { raw, query: value.clientRequestId === "" ? null : parseLegacyReviewRequest({ siteId: options.siteId, blockId: options.blockId, requestId: value.clientRequestId }) };
  };
  const c = {
    getSnapshot: () => state, subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    activate() { abort.abort(); abort = new AbortController(); active = true; busy = false; epoch++; captured = null; query = null;
      try { const v = read(); captured = v.raw; query = v.query; publish(query ? "ready" : "empty"); } catch { publish("error"); } },
    deactivate() { active = false; busy = false; epoch++; abort.abort(); captured = null; query = null; publish("idle"); },
    async read() {
      if (!active || busy || !query) return; busy = true; const run = epoch, expected = query, deadline = Date.now() + 12_000;
      const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(12_000)]), current = () => active && epoch === run && !signal.aborted && Date.now() < deadline;
      let stop: () => void = () => {}; publish("reading");
      try {
        if (read().raw !== captured) throw new Error("changed");
        const response = await Promise.race([Promise.resolve().then(() => { if (!current() || read().raw !== captured) throw new Error("changed"); return request(endpoint, expected, signal); }),
          new Promise<never>((_, reject) => { stop = () => reject(new Error("unavailable")); signal.addEventListener("abort", stop, { once: true }); if (signal.aborted) stop(); })]);
        if (!active || epoch !== run) return;
        if (!current() || read().raw !== captured || !object(response) || response.ok !== true || response.readOnly !== true) throw new Error("invalid");
        const review = parseLegacyOrderReview(response.review, expected); publish(review.order ? "owned" : "unconfirmed", review);
      } catch { if (active && epoch === run) publish("error"); }
      finally { signal.removeEventListener("abort", stop); if (active && epoch === run) busy = false; }
    },
  }; return c;
}
