import { readPersonalCheckoutCartResource, type CartHistoryDependencies } from "./merchantCheckoutCartHistory.server";
import { isMemberCheckoutHistoryReadEnabled } from "./merchantCheckoutHistoryPilot.server";
import { MerchantCheckoutError } from "./merchantCheckoutQuote.server";

/** Reuse the proven exact-principal, verified/unpaused, read-only v2 resource
 * lookup. Only this wrapper uses the independent history gate. No write port,
 * old-version retry, email/guest ownership fallback or new private SQL. */
export function readPersonalCheckoutHistoryResource(input: Parameters<typeof readPersonalCheckoutCartResource>[0], overrides: Partial<CartHistoryDependencies> = {}) {
  const budget = checkoutHistoryReadBudget(input.request), enabled = overrides.enabled ?? isMemberCheckoutHistoryReadEnabled;
  return budget.run(() => readPersonalCheckoutCartResource(input, { ...overrides, enabled: siteId => { budget.guard(); return enabled(siteId); } }));
}

/** Whole ownership/read budget, including ports which ignore abort. Does not
 * give an expired request permission to dispatch a late storage/ledger read. */
export function checkoutHistoryReadBudget(request: Request) {
  const deadline = Date.now() + 12_000, signal = AbortSignal.any([request.signal, AbortSignal.timeout(12_000)]);
  const guard = () => { if (signal.aborted || Date.now() >= deadline) throw new MerchantCheckoutError("checkout_unavailable", 503); };
  const run = async <T>(read: () => PromiseLike<T>): Promise<T> => {
    guard(); let abort: () => void = () => {};
    try { const result = await Promise.race([Promise.resolve().then(() => { guard(); return read(); }), new Promise<never>((_, reject) => {
      abort = () => reject(new MerchantCheckoutError("checkout_unavailable", 503)); signal.addEventListener("abort", abort, { once: true }); if (signal.aborted) abort();
    })]); guard(); return result; } finally { signal.removeEventListener("abort", abort); }
  };
  return { guard, run };
}
