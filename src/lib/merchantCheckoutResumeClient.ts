import { CheckoutClientError, type CheckoutClientRequest } from "./merchantCheckoutClient";
import { checkoutIntentTransport } from "./merchantCheckoutIntentTransport";
import { checkoutHistoryPendingTransport } from "./merchantCheckoutHistoryTransport";
import { parsePendingCheckoutSnapshot, type PendingCheckoutSnapshot } from "./merchantCheckoutPendingIntent";
import type { CartClientOriginal } from "./merchantCheckoutCartReview";

function site(value: string) { if (!/^\d{8}$/.test(value)) throw new CheckoutClientError("checkout_invalid_request"); return value; }
function language(value: string) { if (value.length > 40 || !/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(value)) throw new CheckoutClientError("checkout_invalid_request"); return encodeURIComponent(value); }
export function buildCheckoutResumeHref(siteId: string, locale?: string) { return `/member-checkout/${site(siteId)}/resume${locale === undefined ? "" : `?uiLocale=${language(locale)}`}`; }
export function checkoutResumeOriginalHref(original: CartClientOriginal, siteId: string, locale: string) {
  const r = original.kind === "cart" ? original.result : original.original.result;
  if (r.siteId !== site(siteId) || !/^[a-f0-9]{64}$/.test(r.operationKey)) throw new CheckoutClientError("checkout_invalid_response");
  const path = original.kind === "cart" ? "cart/" : original.original.method === "on_site" ? "on-site/" : "";
  return `/member-checkout/${siteId}/${path}${r.operationKey}?uiLocale=${language(locale)}`;
}
export type CheckoutResumeState = { phase: "idle" | "reading" | "ready" | "error"; snapshot: PendingCheckoutSnapshot | null; error: string };
const empty = (): CheckoutResumeState => ({ phase: "idle", snapshot: null, error: "" });
/** Read-only discovery: no local storage, nonce, locks, acknowledgement,
 * cancellation or finance methods. Absence of a durable claim is NOT proof
 * that another in-flight/local submission failed. Never release a cart here. */
export function createCheckoutResumeController(options: { siteId: string; accountId: string; readOnly?: boolean; request?: CheckoutClientRequest }) {
  site(options.siteId); if (!/^\d{8}$/.test(options.accountId)) throw new CheckoutClientError("checkout_unauthorized");
  const readOnly = options.readOnly === true;
  const request = options.request ?? (readOnly ? checkoutHistoryPendingTransport(options.accountId) : checkoutIntentTransport(options.accountId)), listeners = new Set<() => void>();
  let state = empty(), active = false, busy = false, epoch = 0, abort = new AbortController();
  const publish = (next: CheckoutResumeState) => { state = next; listeners.forEach(fn => fn()); };
  const controller = {
    getSnapshot: () => state, subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    async activate() { abort.abort(); abort = new AbortController(); active = true; busy = false; epoch++; return controller.read(); },
    deactivate() { active = false; busy = false; epoch++; abort.abort(); publish(empty()); },
    async read() {
      if (!active || busy) return; busy = true; const run = epoch, signal = AbortSignal.any([abort.signal, AbortSignal.timeout(12_000)]);
      const current = () => active && epoch === run && !signal.aborted;
      publish({ phase: "reading", snapshot: null, error: "" }); let stop: () => void = () => {};
      try {
        const raw = await Promise.race([Promise.resolve().then(() => { if (!current()) throw new Error("stale"); return request(readOnly ? "/api/member-checkout/history/pending" : "/api/member-checkout/intent/pending", { siteId: options.siteId }, signal); }), new Promise<never>((_, reject) => {
          stop = () => reject(new Error("unavailable")); signal.addEventListener("abort", stop, { once: true }); if (signal.aborted) stop();
        })]);
        if (!current()) return;
        if (!raw || typeof raw !== "object" || !("ok" in raw) || raw.ok !== true || !("snapshot" in raw)) throw new Error("invalid");
        if (readOnly && (!("readOnly" in raw) || raw.readOnly !== true)) throw new Error("invalid");
        const snapshot = parsePendingCheckoutSnapshot(raw.snapshot, options.siteId);
        publish({ phase: "ready", snapshot, error: "" });
      } catch { if (active && epoch === run) publish({ phase: "error", snapshot: null, error: "checkout_intent_unavailable" }); }
      finally { signal.removeEventListener("abort", stop); if (active && epoch === run) busy = false; }
    },
  };
  return controller;
}
