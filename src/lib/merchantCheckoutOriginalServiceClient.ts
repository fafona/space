import { CheckoutClientError, type CheckoutClientRequest } from "./merchantCheckoutClient";
import { parseOriginalServiceRequest, parseOriginalServiceReview, parseOriginalServiceCancellation, originalServiceResource, originalServiceClosed, type OriginalServiceReview } from "./merchantCheckoutOriginalService";
export function originalServiceTransport(accountId: string): CheckoutClientRequest {
  if (!/^\d{8}$/.test(accountId)) throw Error("checkout_unauthorized");
  return async (path, body, signal) => {
    if (!/^\/api\/member-checkout\/original-service\/(review|cancel)$/.test(path)) throw Error("checkout_invalid_request");
    const r = await fetch(path, { method: "POST", credentials: "same-origin", cache: "no-store", signal,
      headers: { "content-type": "application/json", "x-checkout-account-scope": accountId }, body: JSON.stringify(body) });
    const v = await r.json().catch(() => null);
    if (!r.ok || !v || v.ok !== true) throw new CheckoutClientError(v?.error ?? "checkout_service_unavailable", r.status); return v;
  };
}
export function createOriginalServiceController(options: { siteId: string; operationKey: string; accountId: string; request?: CheckoutClientRequest }) {
  const scope = parseOriginalServiceRequest({ siteId: options.siteId, operationKey: options.operationKey }, false), request = options.request ?? originalServiceTransport(options.accountId);
  if (!/^\d{8}$/.test(options.accountId)) throw Error("checkout_unauthorized");
  type State = { phase: "idle" | "reading" | "ready" | "cancelling" | "unconfirmed" | "error"; review: OriginalServiceReview | null; error: string };
  let state: State = { phase: "idle", review: null, error: "" }, active = false, epoch = 0, abort = new AbortController(), busy = false;
  const listeners = new Set<() => void>(), emit = (s: State) => { state = s; listeners.forEach(f => f()); };
  const call = async (cancel: boolean, body: unknown, run: number) => {
    const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(13_000)]), live = () => active && epoch === run && !signal.aborted; let stop: () => void = () => {};
    try { if (!live()) throw Error("unavailable");
      const v = await Promise.race([Promise.resolve().then(() => { if (!live()) throw Error("unavailable"); return request(`/api/member-checkout/original-service/${cancel ? "cancel" : "review"}`, body, signal); }),
        new Promise<never>((_, reject) => { stop = () => reject(Error("unavailable")); signal.addEventListener("abort", stop, { once: true }); if (signal.aborted) stop(); })]);
      if (!live() || !v || typeof v !== "object" || !("ok" in v) || v.ok !== true) throw Error("unavailable"); return v as Record<string, unknown>;
    } finally { signal.removeEventListener("abort", stop); }
  };
  const c = { getSnapshot: () => state, subscribe(f: () => void) { listeners.add(f); return () => { listeners.delete(f); }; },
    async activate() { c.deactivate(); active = true; abort = new AbortController(); await c.read(); },
    deactivate() { active = false; epoch++; abort.abort(); busy = false; emit({ phase: "idle", review: null, error: "" }); },
    async read() { if (!active || busy) return; const run = epoch; busy = true; emit({ phase: "reading", review: null, error: "" });
      try { const v = await call(false, scope, run); if (v.readOnly !== true) throw Error("invalid"); const review = parseOriginalServiceReview(v.review, scope);
        emit({ phase: "ready", review, error: "" });
      } catch (error) { if (active && epoch === run) emit({ phase: "error", review: null, error: error instanceof CheckoutClientError ? error.code : "checkout_service_unavailable" }); }
      finally { if (active && epoch === run) busy = false; }
    },
    async cancel(confirmed: boolean) { const review = state.review, resource = review && originalServiceResource(review.original);
      if (!active || busy || confirmed !== true || state.phase !== "ready" || !review || !resource || review.reviewRequired || originalServiceClosed(review.original)) return;
      const result = review.original.kind === "cart" ? review.original.result : review.original.original.result; if (!result.cancellationAvailable) return;
      const run = epoch; busy = true; emit({ phase: "cancelling", review, error: "" });
      try { const v = await call(true, { ...scope, reviewHash: review.reviewHash, expectedUpdatedAt: resource.updatedAt }, run);
        const cancelled = parseOriginalServiceCancellation(v.cancellation, { ...scope, reviewHash: review.reviewHash }); emit({ phase: "ready", review: cancelled.review, error: "" });
      } catch (error) { if (active && epoch === run) emit({ phase: "unconfirmed", review, error: error instanceof CheckoutClientError ? error.code : "checkout_service_unconfirmed" }); }
      finally { if (active && epoch === run) busy = false; }
    },
  }; return c;
}
