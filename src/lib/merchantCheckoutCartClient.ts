import { checkoutClientRequest, checkoutClientStorageKey, CheckoutClientError, type CheckoutClientExclusive, type CheckoutClientRequest, type CheckoutCustomerDraft } from "./merchantCheckoutClient";
import { cartClientOriginalKey, parseCartClientOriginal, parseCartClientReview, parseCartClientSelection,
  type CartClientOriginal, type CartClientReview, type CartClientSelection } from "./merchantCheckoutCartReview";

export type CartClientState = { phase: "idle" | "quoting" | "ready" | "submitting" | "recovering" | "unconfirmed" | "confirmed" | "cancelling" | "error";
  pending: boolean; review: CartClientReview | null; original: CartClientOriginal | null; error: string };
const empty = (): CartClientState => ({ phase: "idle", pending: false, review: null, original: null, error: "" });
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const nonceValid = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(v);
function need(v: unknown): asserts v { if (!v) throw new CheckoutClientError("checkout_invalid_response"); }
function customerDraft(raw: CheckoutCustomerDraft): CheckoutCustomerDraft {
  const fields = ["name", "title", "email", "phone", "note"] as const, limits = [40, 160, 320, 80, 100];
  if (!object(raw) || Object.keys(raw).length !== 5) throw new CheckoutClientError("checkout_invalid_customer");
  const customer = {} as CheckoutCustomerDraft;
  fields.forEach((key, i) => {
    const value = raw[key], controls = key === "note" ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u : /[\u0000-\u001f\u007f]/u;
    if (typeof value !== "string" || controls.test(value) || new TextEncoder().encode(value.trim()).length > limits[i]) throw new CheckoutClientError("checkout_invalid_customer");
    customer[key] = value.trim();
  });
  if (!customer.name || !customer.phone || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email)) throw new CheckoutClientError("checkout_invalid_customer");
  return customer;
}
const definiteNoWrite = new Set(["checkout_invalid_request", "checkout_invalid_cart", "checkout_invalid_selection", "checkout_invalid_customer", "checkout_invalid_coupon_selection",
  "checkout_conflict", "checkout_quote_changed", "checkout_quote_expired", "checkout_offer_not_found", "checkout_module_unavailable",
  "checkout_membership_unavailable", "checkout_source_changed", "checkout_quantity_unavailable", "checkout_coupon_unavailable", "checkout_coupon_stack_not_allowed",
  "checkout_cart_coupon_reused", "checkout_cart_duplicate_product", "checkout_cart_source_mismatch", "checkout_cart_method_unavailable", "checkout_insufficient_points", "checkout_total_too_large"]);

/** One cart -> one original operation. Uses the SAME account/site nonce-only
 * record and native Web Lock as single-item checkout. No contact/member data,
 * items, amounts, coupon claims or confirmation hash in storage/URL. Unknown
 * writes can only be read, never resubmitted or silently discarded. */
export function createCartCheckoutController(options: { siteId: string; accountId: string; request?: CheckoutClientRequest;
  storage?: Pick<Storage, "getItem" | "setItem" | "removeItem">; exclusive?: CheckoutClientExclusive; randomNonce?: () => string }) {
  const key = checkoutClientStorageKey(options.siteId, options.accountId), request = options.request ?? checkoutClientRequest;
  const exclusive: CheckoutClientExclusive = options.exclusive ?? (async (name, run) => {
    if (!navigator.locks) throw new CheckoutClientError("checkout_browser_unsupported");
    return navigator.locks.request(name, { ifAvailable: true }, async lock => { if (!lock) return false; await run(); return true; });
  });
  let state = empty(), active = false, epoch = 0, busy = false, nonce: string | null = null;
  let selection: CartClientSelection | null = null, person: CheckoutCustomerDraft | null = null, abort = new AbortController();
  const listeners = new Set<() => void>(), valid = (run: number) => active && epoch === run && !abort.signal.aborted;
  const publish = (patch: Partial<CartClientState>) => { state = { ...state, ...patch, pending: nonce !== null }; listeners.forEach(fn => fn()); };
  const storage = () => { try { return options.storage ?? window.localStorage; } catch { throw new CheckoutClientError("checkout_storage_unavailable"); } };
  const read = () => { try {
    const raw = storage().getItem(key); if (raw === null) return null; const value: unknown = JSON.parse(raw);
    if (!object(value) || Object.keys(value).length !== 2 || value.version !== 1 || !nonceValid(value.nonce)) throw new Error("invalid"); return value.nonce;
  } catch { throw new CheckoutClientError("checkout_storage_unavailable"); } };
  const write = (next: string | null, expected: string | null) => {
    try { if (read() !== expected) throw new CheckoutClientError("checkout_other_tab");
      if (next === null) storage().removeItem(key); else storage().setItem(key, JSON.stringify({ version: 1, nonce: next }));
      if (read() !== next) throw new Error("not durable");
    } catch (error) { throw error instanceof CheckoutClientError ? error : new CheckoutClientError("checkout_storage_unavailable"); }
  };
  const call = async (path: string, body: unknown, run: number) => {
    if (!valid(run)) throw new CheckoutClientError("checkout_unavailable");
    const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(15_000)]); let stop: () => void = () => {};
    try { return await Promise.race([Promise.resolve().then(() => { if (!valid(run) || signal.aborted) throw new CheckoutClientError("checkout_unavailable"); return request(path, body, signal); }), new Promise<never>((_, reject) => {
      stop = () => reject(new CheckoutClientError("checkout_unconfirmed")); signal.addEventListener("abort", stop, { once: true }); if (signal.aborted) stop();
    })]); } finally { signal.removeEventListener("abort", stop); }
  };
  const freshNonce = () => { const next = options.randomNonce?.() ?? crypto.randomUUID(); if (!nonceValid(next)) throw new CheckoutClientError("checkout_browser_unsupported"); return next; };
  const recover = async (run: number) => {
    const stored = read(); if (nonce && stored !== nonce) throw new CheckoutClientError(stored ? "checkout_other_tab" : "checkout_storage_unavailable");
    nonce = stored; selection = null; person = null;
    if (!nonce) { publish(empty()); return; } const ref = nonce;
    publish({ phase: "recovering", review: null, original: null, error: "" });
    const raw = await call("/api/member-checkout/cart/recover", { siteId: options.siteId, nonce: ref }, run); if (!valid(run)) return;
    if (read() !== ref) throw new CheckoutClientError("checkout_other_tab");
    need(object(raw) && raw.ok === true && ["confirmed", "unconfirmed"].includes(String(raw.state)));
    if (raw.state === "unconfirmed") publish({ phase: "unconfirmed", error: "checkout_unconfirmed" });
    else publish({ phase: "confirmed", original: parseCartClientOriginal(raw.original, options.siteId), error: "" });
  };
  const failed = (error: unknown) => publish({ phase: nonce ? "unconfirmed" : "error", review: null, original: null,
    error: error instanceof CheckoutClientError ? error.code : nonce ? "checkout_unconfirmed" : "checkout_unavailable" });
  const controller = { storageKey: key, getSnapshot: () => state, subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    async activate() { abort.abort(); active = true; epoch++; busy = false; nonce = null; selection = null; person = null; abort = new AbortController(); state = empty(); return controller.recover(); },
    deactivate() { active = false; epoch++; busy = false; abort.abort(); nonce = null; selection = null; person = null; state = empty(); },
    edit() { if (!active || busy || nonce) return; selection = null; person = null; publish(empty()); },
    async recover() { if (!active || busy) return; busy = true; const run = epoch;
      try { await recover(run); } catch (error) { if (valid(run)) failed(error); } finally { if (valid(run)) busy = false; } },
    async preview(raw: CartClientSelection, customer: CheckoutCustomerDraft) {
      if (!active || busy || nonce) return; busy = true; const run = epoch; selection = null; person = null;
      publish({ phase: "quoting", review: null, original: null, error: "" });
      try {
        if (read()) { await recover(run); return; }
        const chosen = parseCartClientSelection(structuredClone(raw)), captured = customerDraft(structuredClone(customer));
        if (chosen.siteId !== options.siteId) throw new CheckoutClientError("checkout_invalid_cart");
        const response = await call("/api/member-checkout/cart/preview", { ...chosen, nonce: freshNonce(), confirmationHash: "0".repeat(64), customer: captured }, run);
        if (!valid(run)) return; if (read()) { await recover(run); return; }
        const review = parseCartClientReview(response, chosen); selection = chosen; person = captured; publish({ phase: "ready", review, error: "" });
      } catch (error) { if (valid(run)) failed(error); } finally { if (valid(run)) busy = false; }
    },
    async submit() {
      if (!active || busy || nonce || state.phase !== "ready" || !state.review?.quote.methodAvailable || !selection || !person) return;
      const chosen = structuredClone(selection), customer = structuredClone(person), review = structuredClone(state.review), run = epoch;
      busy = true; publish({ phase: "submitting", error: "" });
      try { const locked = await exclusive(key, async () => {
        if (!valid(run)) return; if (read()) { await recover(run); return; }
        const next = freshNonce(); write(next, null); nonce = next; publish({}); if (!valid(run)) return;
        try {
          const response = await call("/api/member-checkout/cart/submit", { ...chosen, customer, nonce: next, confirmationHash: review.confirmationHash }, run);
          if (!valid(run)) return; if (read() !== next) throw new CheckoutClientError("checkout_other_tab");
          need(object(response) && response.ok === true && typeof response.replayed === "boolean");
          const original = parseCartClientOriginal({ kind: "cart", result: response.result }, options.siteId); need(original.kind === "cart");
          const r = original.result, q = review.quote;
          need(r.method === q.method && r.totalPoints === q.duePoints && r.grossMinor === q.grossMinor && r.discountMinor === q.discountMinor && r.dueMinor === q.dueMinor && r.couponCount === q.couponCount
            && JSON.stringify(r.lines.map(l => [l.offerId, l.offerRevision, l.productId, l.title, l.quantity, l.points, l.grossMinor, l.discountMinor, l.dueMinor, l.returnPoints, l.returnCoupons, l.couponCount]))
              === JSON.stringify(q.lines.map(l => [l.offerId, l.offerRevision, l.productId, l.title, l.quantity, l.duePoints, l.grossMinor, l.discountMinor, l.dueMinor, l.cancellationPolicy.returnPoints, l.cancellationPolicy.returnCoupons, l.couponClaims.length])));
          selection = null; person = null; publish({ phase: "confirmed", review: null, original, error: "" });
        } catch (error) {
          if (valid(run) && error instanceof CheckoutClientError && [400, 403, 404, 409].includes(error.status) && definiteNoWrite.has(error.code)) {
            write(null, next); nonce = null; selection = null; person = null; publish({ ...empty(), phase: "error", error: error.code }); return;
          } throw error;
        }
      }); if (valid(run) && !locked) throw new CheckoutClientError("checkout_other_tab");
      } catch (error) { if (valid(run)) failed(error); } finally { if (valid(run)) busy = false; }
    },
    async cancel() {
      const original = state.original;
      if (!active || busy || !nonce || state.phase !== "confirmed" || original?.kind !== "cart" || !original.result.cancellationAvailable || !original.result.resource) return;
      const ref = nonce, previous = original.result, run = epoch; busy = true; publish({ phase: "cancelling", original: null, review: null, error: "" });
      try { const locked = await exclusive(key, async () => {
        if (!valid(run)) return; if (read() !== ref) throw new CheckoutClientError("checkout_other_tab");
        const response = await call("/api/member-checkout/cart/cancel", { siteId: options.siteId, operationKey: previous.operationKey, expectedUpdatedAt: previous.resource!.updatedAt }, run);
        if (!valid(run)) return; if (read() !== ref) throw new CheckoutClientError("checkout_other_tab");
        need(object(response) && response.ok === true && typeof response.replayed === "boolean");
        const closed = parseCartClientOriginal({ kind: "cart", result: response.result }, options.siteId);
        need(closed.kind === "cart" && closed.result.closed && closed.result.operationKey === previous.operationKey && closed.result.resourceId === previous.resourceId);
        const immutable = (r: typeof previous) => [r.method, r.currency, r.totalPoints, r.grossMinor, r.discountMinor, r.dueMinor, r.capturedMinor, r.couponCount, r.lines];
        need(JSON.stringify(immutable(closed.result)) === JSON.stringify(immutable(previous)));
        publish({ phase: "confirmed", original: closed, error: "" });
      }); if (valid(run) && !locked) throw new CheckoutClientError("checkout_other_tab");
      } catch (error) { if (valid(run)) failed(error); } finally { if (valid(run)) busy = false; }
    },
    async startAnother(beforeRelease?: (original: CartClientOriginal) => void | Promise<void>) {
      if (!active || busy || !nonce || state.phase !== "confirmed" || !state.original || state.original.kind === "cart" && state.original.result.reviewRequired) return;
      const ref = nonce, op = cartClientOriginalKey(state.original), run = epoch; busy = true;
      try { const locked = await exclusive(key, async () => {
        if (!valid(run)) return; await recover(run);
        if (!valid(run) || state.phase !== "confirmed" || !state.original || nonce !== ref || cartClientOriginalKey(state.original) !== op
          || state.original.kind === "cart" && state.original.result.reviewRequired) return;
        // An embedding cart must durably preserve/consume its own draft BEFORE
        // the shared nonce is released. A failed callback retains the original.
        if (beforeRelease) await beforeRelease(structuredClone(state.original));
        if (!valid(run) || read() !== ref) throw new CheckoutClientError("checkout_other_tab");
        write(null, ref); nonce = null; selection = null; person = null; publish(empty());
      }); if (valid(run) && !locked) throw new CheckoutClientError("checkout_other_tab");
      } catch (error) { if (valid(run)) failed(error); } finally { if (valid(run)) busy = false; }
    },
  }; return controller;
}
