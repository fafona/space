import { checkoutClientStorageKey, type CheckoutClientRequest } from "./merchantCheckoutClient";
import { checkoutHistoryRecoveryTransport } from "./merchantCheckoutHistoryTransport";
import { checkoutHistoryRecoveryReference, parseCheckoutHistoryRecovery, parseCheckoutHistoryRecoveryRequest, type CheckoutHistoryRecovery } from "./merchantCheckoutHistoryRecovery";

export type CheckoutLocalRecoveryState = { phase: "idle" | "reading" | "empty" | "confirmed" | "unconfirmed" | "error"; recovery: CheckoutHistoryRecovery | null };
const empty = (): CheckoutLocalRecoveryState => ({ phase: "idle", recovery: null });
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
/** getItem is the ONLY storage port. No local reference creation, adoption of
 * an unrelated shared draft, acknowledgement, clearing, lock or financial write.
 * A confirmed read deliberately retains the original reference too. */
export function createCheckoutHistoryRecoveryController(options: { siteId: string; accountId: string; storage?: Pick<Storage, "getItem">; request?: CheckoutClientRequest }) {
  const key = checkoutClientStorageKey(options.siteId, options.accountId), request = options.request ?? checkoutHistoryRecoveryTransport(options.accountId);
  let state = empty(), active = false, epoch = 0, busy = false, abort = new AbortController(), captured: string | null = null;
  const listeners = new Set<() => void>(), publish = (next: CheckoutLocalRecoveryState) => { state = next; listeners.forEach(f => f()); };
  const read = () => {
    const raw = (options.storage ?? window.localStorage).getItem(key);
    if (raw === null) return { raw, nonce: null }; if (raw.length > 256) throw new Error("invalid");
    const value: unknown = JSON.parse(raw);
    if (!object(value) || Object.keys(value).length !== 2 || value.version !== 1) throw new Error("invalid");
    return { raw, nonce: parseCheckoutHistoryRecoveryRequest({ siteId: options.siteId, nonce: value.nonce }).nonce };
  };
  const c = {
    getSnapshot: () => state, subscribe(f: () => void) { listeners.add(f); return () => { listeners.delete(f); }; },
    async activate() { abort.abort(); abort = new AbortController(); active = true; epoch++; busy = false; captured = null; return c.recover(); },
    deactivate() { active = false; epoch++; busy = false; abort.abort(); captured = null; publish(empty()); },
    async recover() {
      if (!active || busy) return; busy = true; const run = epoch, deadline = Date.now() + 12_000, signal = AbortSignal.any([abort.signal, AbortSignal.timeout(12_000)]);
      const current = () => active && epoch === run && !signal.aborted && Date.now() < deadline; let stop: () => void = () => {};
      publish({ phase: "reading", recovery: null });
      try {
        const stored = read(); if (captured !== null && stored.raw !== captured) throw new Error("changed");
        if (!stored.nonce) { if (!current()) throw new Error("expired"); publish({ phase: "empty", recovery: null }); return; } captured = stored.raw;
        const raw = await Promise.race([Promise.resolve().then(async () => {
          const reference = await checkoutHistoryRecoveryReference(options.siteId, options.accountId, stored.nonce!);
          if (!current() || read().raw !== captured) throw new Error("changed");
          const response = await request("/api/member-checkout/history/recover", { siteId: options.siteId, nonce: stored.nonce }, signal);
          return { response, reference };
        }), new Promise<never>((_, reject) => { stop = () => reject(new Error("unavailable")); signal.addEventListener("abort", stop, { once: true }); if (signal.aborted) stop(); })]);
        if (!active || epoch !== run) return; if (!current()) throw new Error("expired");
        if (read().raw !== captured || !object(raw.response) || raw.response.ok !== true || raw.response.readOnly !== true || raw.response.reference !== raw.reference) throw new Error("invalid");
        const recovery = parseCheckoutHistoryRecovery(raw.response.recovery, { siteId: options.siteId });
        publish({ phase: recovery.original ? "confirmed" : "unconfirmed", recovery });
      } catch { if (active && epoch === run) publish({ phase: "error", recovery: null }); }
      finally { signal.removeEventListener("abort", stop); if (active && epoch === run) busy = false; }
    },
  };
  return c;
}
