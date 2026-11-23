import { createCheckoutClientController, checkoutClientStorageKey, CheckoutClientError, type CheckoutClientExclusive, type CheckoutClientRequest, type CheckoutClientSelection, type CheckoutClientState, type CheckoutCustomerDraft } from "./merchantCheckoutClient";
import { createOnSiteCheckoutController, type OnSiteClientState } from "./merchantCheckoutOnSiteClient";
import { createCartCheckoutController } from "./merchantCheckoutCartClient";
import { checkoutIntentTransport } from "./merchantCheckoutIntentTransport";
import { cartClientOriginalKey, type CartClientOriginal } from "./merchantCheckoutCartReview";

type Options = Parameters<typeof createCheckoutClientController>[0];
type State = CheckoutClientState | OnSiteClientState;
export type SingleIntentView = { originalReview?: CartClientOriginal; intentReviewRequired?: boolean };
type Base<Args extends unknown[], S extends State> = {
  storageKey: string; getSnapshot(): S; subscribe(fn: () => void): () => void; activate(): Promise<void>; deactivate(): void;
  recover(): Promise<void>; edit(): void; preview(...args: Args): Promise<void>; submit(customer: CheckoutCustomerDraft): Promise<void>;
};
/** Only the new, default-closed single transport. The old routes/transport are
 * untouched. Account is a consistency hint, never a payment authority. */
export function checkoutSingleIntentTransport(accountId: string): CheckoutClientRequest {
  const recovery = checkoutIntentTransport(accountId);
  return async (path, body, signal) => {
    const single = /^\/api\/member-checkout\/(on-site\/)?(preview|submit)$/.exec(path);
    if (!single) return recovery(path, body, signal);
    const target = `/api/member-checkout/single/${single[1] ? "on-site" : "points"}/${single[2]}`;
    const response = await fetch(target, { method: "POST", credentials: "same-origin", cache: "no-store", signal,
      headers: { "content-type": "application/json", accept: "application/json", "x-checkout-account-scope": accountId }, body: JSON.stringify(body) });
    const value: unknown = await response.json().catch(() => null);
    if (!response.ok || !value || typeof value !== "object" || !("ok" in value) || value.ok !== true)
      throw new CheckoutClientError(value && typeof value === "object" && "error" in value && typeof value.error === "string" ? value.error : "checkout_unconfirmed", response.status);
    return value;
  };
}

/** Reuse the proven single quote/submit controllers and the shared original
 * reader/reviewer. Never call their old local-only startAnother. A cart may be
 * viewed here but only its original host can preserve/consume its draft. */
function coordinate<Args extends unknown[], S extends State>(options: Options, makeBase: (options: Options) => Base<Args, S>) {
  const key = checkoutClientStorageKey(options.siteId, options.accountId), request = options.request ?? checkoutSingleIntentTransport(options.accountId);
  const exclusive: CheckoutClientExclusive = options.exclusive ?? (async (name, run) => {
    if (!navigator.locks) throw new CheckoutClientError("checkout_browser_unsupported");
    return navigator.locks.request(name, { ifAvailable: true }, async lock => { if (!lock) return false; await run(); return true; });
  });
  let active = false, busy = false, epoch = 0, baseReady = false, rolledBackToOriginal = false;
  const reader = createCartCheckoutController({ ...options, request, exclusive, intentEnabled: true });
  const base = makeBase({ ...options, request: async (path, body, signal) => {
    // An injected transport must obey the same bounded/abort contract as fetch.
    const bounded = AbortSignal.any([signal, AbortSignal.timeout(15_000)]); let stop: () => void = () => {};
    try { return await Promise.race([Promise.resolve().then(() => { if (!active || bounded.aborted) throw new CheckoutClientError("checkout_unconfirmed"); return request(path, body, bounded); }), new Promise<never>((_, reject) => {
      stop = () => reject(new CheckoutClientError("checkout_unconfirmed")); bounded.addEventListener("abort", stop, { once: true }); if (bounded.aborted) stop();
    })]); } catch (error) {
      if (active && !bounded.aborted && path.endsWith("/submit") && error instanceof CheckoutClientError && error.status === 409 && ["checkout_original_pending", "checkout_intent_review_required"].includes(error.code)) {
        // The NEW HTTP adapter only emits this on a proven SQL rollback and
        // unchanged verified identity. Reuse the old controller's checked,
        // locked conflict release for this fresh nonce, then READ the winner.
        rolledBackToOriginal = true; throw new CheckoutClientError("checkout_conflict", 409);
      } throw error;
    } finally { bounded.removeEventListener("abort", stop); }
  }, exclusive: async (name, run) => exclusive(name, async () => {
    // This check runs under the SAME Web Lock, before the old controller writes
    // a fresh nonce. Checking after nonce creation would deadlock recovery.
    await reader.recover(); if (!active || reader.getSnapshot().pending) throw new CheckoutClientError("checkout_original_pending", 409);
    await run();
  }) });
  const listeners = new Set<() => void>();
  let state: S & SingleIntentView = base.getSnapshot();
  const valid = (run: number) => active && epoch === run;
  const publish = () => {
    const own = base.getSnapshot(), shared = reader.getSnapshot();
    state = shared.pending ? { ...own, phase: shared.phase === "acknowledging" ? "recovering" : shared.phase === "cancelling" ? "recovering" : shared.phase,
      quote: null, result: null, original: null, pending: true, error: shared.error, ...(shared.original ? { originalReview: shared.original } : {}), intentReviewRequired: shared.intentReviewRequired === true }
      : { ...own };
    listeners.forEach(fn => fn());
  };
  const resetBase = async (run: number) => { if (!valid(run)) return; base.deactivate(); baseReady = false; await base.activate(); if (valid(run)) baseReady = true; };
  const recover = async (run: number) => {
    await reader.recover(); if (!valid(run)) return;
    if (!reader.getSnapshot().pending && !baseReady) await resetBase(run);
    publish();
  };
  // Controller subscriptions are object-local and detached on deactivation.
  let unsubscribeBase = () => {}, unsubscribeReader = () => {};
  const controller = {
    storageKey: key, getSnapshot: () => state,
    subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    async activate() {
      controller.deactivate(); active = true; const run = ++epoch; busy = true;
      unsubscribeBase = base.subscribe(publish); unsubscribeReader = reader.subscribe(publish);
      try { await reader.activate(); if (valid(run) && !reader.getSnapshot().pending) await resetBase(run); if (valid(run)) publish(); }
      finally { if (valid(run)) busy = false; }
    },
    deactivate() { active = false; epoch++; busy = false; baseReady = false; rolledBackToOriginal = false; unsubscribeBase(); unsubscribeReader(); base.deactivate(); reader.deactivate(); state = base.getSnapshot(); },
    edit() { if (!active || busy || reader.getSnapshot().pending) return; base.edit(); },
    async recover() { if (!active || busy) return; busy = true; const run = epoch; try { await recover(run); } finally { if (valid(run)) busy = false; } },
    async preview(...args: Args) {
      if (!active || busy || reader.getSnapshot().pending) return; busy = true; const run = epoch;
      try { await recover(run); if (!valid(run) || reader.getSnapshot().pending) return; await base.preview(...args); if (valid(run)) publish(); }
      finally { if (valid(run)) busy = false; }
    },
    async submit(customer: CheckoutCustomerDraft) {
      if (!active || busy || reader.getSnapshot().pending) return; busy = true; const run = epoch;
      try {
        rolledBackToOriginal = false; await base.submit(customer); if (!valid(run)) return;
        // A confirmed response is still not a review/acknowledgement proof.
        // Unknown outcomes only trigger an original READ, never another submit.
        if (base.getSnapshot().pending || reader.getSnapshot().pending || rolledBackToOriginal) await reader.recover();
        if (valid(run)) publish();
      } finally { if (valid(run)) busy = false; }
    },
    async startAnother() {
      const shared = reader.getSnapshot(), original = shared.original;
      if (!active || busy || shared.phase !== "confirmed" || original?.kind !== "single" || shared.intentReviewRequired) return;
      busy = true; const run = epoch, operationKey = cartClientOriginalKey(original);
      try {
        await reader.startAnother(current => {
          if (!valid(run) || current.kind !== "single" || cartClientOriginalKey(current) !== operationKey) throw new CheckoutClientError("checkout_intent_changed");
          // Standalone single checkout never owns the merchant form or cart.
          // Preserve all host drafts byte-for-byte; only explicit server proof
          // may release the common nonce. The panel resets its own fields later.
        });
        if (valid(run) && !reader.getSnapshot().pending) await resetBase(run);
        if (valid(run)) publish();
      } finally { if (valid(run)) busy = false; }
    },
  };
  return controller;
}
export function createIntentPointsCheckoutController(options: Options) {
  return coordinate<[CheckoutClientSelection], CheckoutClientState>(options, createCheckoutClientController);
}
export function createIntentOnSiteCheckoutController(options: Options) {
  return coordinate<[CheckoutClientSelection, CheckoutCustomerDraft], OnSiteClientState>(options, createOnSiteCheckoutController);
}
