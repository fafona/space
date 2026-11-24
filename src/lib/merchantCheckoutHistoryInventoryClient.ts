import { CheckoutClientError, type CheckoutClientRequest } from "./merchantCheckoutClient";
import { parseCheckoutHistoryInventory, type CheckoutHistoryInventory } from "./merchantCheckoutHistoryInventory";
const path = "/api/member-checkout/history/retained";
export function checkoutHistoryInventoryTransport(accountId: string): CheckoutClientRequest {
  if (!/^\d{8}$/.test(accountId)) throw new CheckoutClientError("checkout_unauthorized");
  return async (target, body, signal) => {
    if (target !== path) throw new CheckoutClientError("checkout_invalid_request");
    const response = await fetch(path, { method: "POST", credentials: "same-origin", cache: "no-store", signal,
      headers: { "content-type": "application/json", accept: "application/json", "x-checkout-account-scope": accountId }, body: JSON.stringify(body) });
    const value: unknown = await response.json().catch(() => null);
    if (!response.ok) throw new CheckoutClientError("checkout_history_unavailable", response.status);
    return value;
  };
}
type State = { phase: "idle" | "reading" | "ready" | "error"; inventory: CheckoutHistoryInventory | null };
/** Explicit, paginated READS only. No browser storage, nonce, purchase,
 * acknowledgement, registration, retry-write or draft-release port exists. */
export function createCheckoutHistoryInventoryController(options: { siteId: string; accountId: string; request?: CheckoutClientRequest }) {
  if (!/^\d{8}$/.test(options.siteId) || !/^\d{8}$/.test(options.accountId)) throw new CheckoutClientError("checkout_invalid_request");
  const request = options.request ?? checkoutHistoryInventoryTransport(options.accountId), listeners = new Set<() => void>();
  let active = false, busy = false, epoch = 0, abort = new AbortController(), state: State = { phase: "idle", inventory: null };
  const publish = (value: State) => { state = value; listeners.forEach(fn => fn()); };
  const read = async (after: string | null) => {
    if (!active || busy) return; busy = true;
    const run = epoch, deadline = Date.now() + 12_000, signal = AbortSignal.any([abort.signal, AbortSignal.timeout(12_000)]), valid = () => active && epoch === run && !signal.aborted && Date.now() < deadline;
    let stop: () => void = () => {}; publish({ phase: "reading", inventory: null });
    try {
      const raw = await Promise.race([Promise.resolve().then(() => { if (!valid()) throw Error("stale"); return request(path, { siteId: options.siteId, after }, signal); }), new Promise<never>((_, reject) => {
        stop = () => reject(Error("unavailable")); signal.addEventListener("abort", stop, { once: true }); if (signal.aborted) stop();
      })]);
      if (!active || epoch !== run) return; if (!valid()) throw Error("expired");
      if (!raw || typeof raw !== "object" || !("ok" in raw) || raw.ok !== true || !("readOnly" in raw) || raw.readOnly !== true || !("inventory" in raw)) throw Error("invalid");
      const inventory = parseCheckoutHistoryInventory(raw.inventory, { siteId: options.siteId, after });
      if (!valid()) throw Error("expired"); publish({ phase: "ready", inventory });
    } catch { if (active && epoch === run) publish({ phase: "error", inventory: null }); }
    finally { signal.removeEventListener("abort", stop); if (active && epoch === run) busy = false; }
  };
  return {
    getSnapshot: () => state, subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    activate() { abort.abort(); abort = new AbortController(); active = true; epoch++; busy = false; publish({ phase: "idle", inventory: null }); },
    deactivate() { active = false; epoch++; busy = false; abort.abort(); publish({ phase: "idle", inventory: null }); },
    read: () => read(null),
    next: () => state.phase === "ready" && state.inventory?.nextCursor ? read(state.inventory.nextCursor) : Promise.resolve(),
  };
}
