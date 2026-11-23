import { checkoutClientStorageKey, checkoutClientRequest, CheckoutClientError, parseCheckoutClientSelection, buildCheckoutStartHref,
  type CheckoutClientSelection, type CheckoutCustomerDraft, type CheckoutClientRequest, type CheckoutClientExclusive } from "./merchantCheckoutClient";
import { parseCheckoutCouponClaims, type CheckoutCouponChoice } from "./merchantCheckoutCoupons";
import { parseOnSiteCheckoutResult } from "./merchantCheckoutOnSiteResult";
import { parseCheckoutOriginalResult, type CheckoutOriginalResult } from "./merchantCheckoutOriginalResult";

export type OnSiteClientQuote = { title: string; kind: "booking" | "order"; quantity: number; grossMinor: number; discountMinor: number; dueMinor: number;
  couponCount: number; coupons: CheckoutCouponChoice[]; confirmationHash: string;
  cancellation: { returnCoupons: boolean; advanceMinutes: number };
  bookingForm: { store: string; item: string; titles: string[]; timeZone: string } | null };
export type OnSiteClientState = { phase: "idle" | "quoting" | "ready" | "submitting" | "recovering" | "unconfirmed" | "confirmed" | "error";
  quote: OnSiteClientQuote | null; original: CheckoutOriginalResult | null; pending: boolean; error: string;
  originalReview?: import("./merchantCheckoutCartReview").CartClientOriginal; intentReviewRequired?: boolean };
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const number = (v: unknown, max = 99_999_999): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && v <= max;
const nonceValid = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v);
function need(v: unknown): asserts v { if (!v) throw new CheckoutClientError("checkout_invalid_response"); }
const empty = (): OnSiteClientState => ({ phase: "idle", quote: null, original: null, pending: false, error: "" });
export function buildOnSiteCheckoutStartHref(selection: Omit<CheckoutClientSelection, "couponClaims">, locale?: string) {
  return buildCheckoutStartHref(selection, locale).replace(`/${selection.siteId}/start?`, `/${selection.siteId}/on-site/start?`);
}
export function parseOnSiteClientQuote(raw: unknown, selection: CheckoutClientSelection): OnSiteClientQuote {
  need(object(raw) && raw.ok === true && object(raw.quote)); const q = raw.quote;
  need(q.version === 1 && q.method === "on_site" && q.siteId === selection.siteId && q.offerId === selection.offerId && q.offerRevision === selection.offerRevision
    && q.quantity === selection.quantity && ["booking", "order"].includes(String(q.resourceKind)) && typeof q.title === "string" && q.title.length > 0 && q.title.length <= 200
    && q.reservationCreated === false && q.capturedMinor === 0 && q.totalPoints === null && number(q.grossMinor) && q.grossMinor > 0
    && number(q.discountMinor) && number(q.dueMinor) && q.dueMinor === q.grossMinor - q.discountMinor && number(q.couponCount, 1)
    && q.couponCount === (q.discountMinor > 0 ? 1 : 0) && typeof q.confirmationHash === "string" && /^[a-f0-9]{64}$/.test(q.confirmationHash));
  const selected = parseCheckoutCouponClaims(selection.couponClaims);
  need(JSON.stringify(parseCheckoutCouponClaims(q.selected)) === JSON.stringify(selected) && q.couponCount === selected.length && Array.isArray(q.coupons) && q.coupons.length <= 1000);
  const coupons = q.coupons.map(v => {
    need(object(v)); parseCheckoutCouponClaims([{ couponId: v.couponId, claimEventId: v.claimEventId }]);
    need(typeof v.title === "string" && v.title.length <= 500 && typeof v.available === "boolean" && v.singleUse === true
      && ["points_voucher", "product_voucher", "exchange_voucher", "ticket_voucher", "amount_off", "threshold_amount_off", "percent_off", "stored_value"].includes(String(v.kind))
      && number(v.cashDiscountMinor) && number(v.pointsDiscount) && v.pointsDiscount === 0 && number(v.coveredQuantity, 999)
      && (v.validUntil === null || typeof v.validUntil === "string" && Number.isFinite(Date.parse(v.validUntil)))
      && (v.reason === undefined || ["inactive", "not_started", "expired", "used", "scenario", "target", "minimum", "wrong_units", "invalid"].includes(String(v.reason))));
    return { couponId: v.couponId as string, claimEventId: v.claimEventId as string, title: v.title, available: v.available, singleUse: true as const,
      kind: v.kind as CheckoutCouponChoice["kind"], cashDiscountMinor: v.cashDiscountMinor, pointsDiscount: 0, coveredQuantity: v.coveredQuantity,
      validUntil: v.validUntil as string | null, ...(v.reason ? { reason: v.reason as CheckoutCouponChoice["reason"] } : {}) };
  });
  need(new Set(coupons.map(c => JSON.stringify([c.couponId, c.claimEventId]))).size === coupons.length);
  for (const claim of selected) need(coupons.some(c => c.couponId === claim.couponId && c.claimEventId === claim.claimEventId && c.available));
  need(object(q.cancellationPolicy) && typeof q.cancellationPolicy.returnCoupons === "boolean" && number(q.cancellationPolicy.advanceMinutes, 43_200));
  let bookingForm: OnSiteClientQuote["bookingForm"] = null;
  if (q.resourceKind === "booking") {
    const f = q.bookingForm, slot = q.slot;
    need(object(f) && object(slot) && [f.store, f.item, f.timeZone].every(v => typeof v === "string" && v.length > 0 && v.length <= 160)
      && Array.isArray(f.titles) && f.titles.length > 0 && f.titles.length <= 1000 && f.titles.every(v => typeof v === "string" && v.length > 0 && v.length <= 160)
      && slot.appointmentAt === selection.appointmentAt && slot.timeZone === f.timeZone && slot.reserved === false);
    new Intl.DateTimeFormat("en", { timeZone: f.timeZone as string }).format();
    bookingForm = { store: f.store as string, item: f.item as string, timeZone: f.timeZone as string, titles: [...f.titles as string[]] };
  } else need(q.slot === null && q.bookingForm === null && selection.appointmentAt === undefined);
  return { title: q.title, kind: q.resourceKind as "booking" | "order", quantity: selection.quantity, grossMinor: q.grossMinor, discountMinor: q.discountMinor, dueMinor: q.dueMinor,
    couponCount: q.couponCount, coupons, confirmationHash: q.confirmationHash, bookingForm,
    cancellation: { returnCoupons: q.cancellationPolicy.returnCoupons, advanceMinutes: q.cancellationPolicy.advanceMinutes } };
}
const noWrite = new Set(["checkout_invalid_request", "checkout_invalid_selection", "checkout_invalid_customer", "checkout_invalid_coupon_selection", "checkout_conflict", "checkout_quote_changed",
  "checkout_quote_expired", "checkout_offer_not_found", "checkout_membership_unavailable", "checkout_quantity_unavailable", "checkout_coupon_unavailable", "checkout_source_changed", "checkout_module_unavailable",
  "checkout_slot_unavailable", "checkout_booking_quantity_unsupported", "checkout_on_site_unavailable"]);
/** Same nonce-only storage and native lock as the existing points controller.
 * Method changes cannot bypass an unresolved original. No contacts/prices/coupon
 * claims are persisted, no automatic retry and no cash-paid browser flag. */
export function createOnSiteCheckoutController(options: { siteId: string; accountId: string; request?: CheckoutClientRequest;
  storage?: Pick<Storage, "getItem" | "setItem" | "removeItem">; exclusive?: CheckoutClientExclusive; randomNonce?: () => string }) {
  const key = checkoutClientStorageKey(options.siteId, options.accountId), request = options.request ?? checkoutClientRequest;
  const exclusive: CheckoutClientExclusive = options.exclusive ?? (async (name, run) => {
    if (!navigator.locks) throw new CheckoutClientError("checkout_browser_unsupported");
    return navigator.locks.request(name, { ifAvailable: true }, async lock => { if (!lock) return false; await run(); return true; });
  });
  let state = empty(), active = false, epoch = 0, busy = false, nonce: string | null = null, selection: CheckoutClientSelection | null = null, abort = new AbortController();
  const listeners = new Set<() => void>(), valid = (run: number) => active && epoch === run && !abort.signal.aborted;
  const publish = (patch: Partial<OnSiteClientState>) => { state = { ...state, ...patch, pending: nonce !== null }; listeners.forEach(fn => fn()); };
  const storage = () => { try { return options.storage ?? window.localStorage; } catch { throw new CheckoutClientError("checkout_storage_unavailable"); } };
  const read = () => { try {
    const raw = storage().getItem(key); if (raw === null) return null; const value: unknown = JSON.parse(raw);
    if (!object(value) || Object.keys(value).length !== 2 || value.version !== 1 || !nonceValid(value.nonce)) throw new Error("invalid"); return value.nonce;
  } catch { throw new CheckoutClientError("checkout_storage_unavailable"); } };
  const write = (value: string | null, expected: string | null) => {
    try { if (read() !== expected) throw new CheckoutClientError("checkout_other_tab");
      if (value === null) storage().removeItem(key); else storage().setItem(key, JSON.stringify({ version: 1, nonce: value }));
      if (read() !== value) throw new Error("not durable");
    } catch (error) { throw error instanceof CheckoutClientError ? error : new CheckoutClientError("checkout_storage_unavailable"); }
  };
  const original = (raw: unknown) => { need(object(raw) && object(raw.result) && typeof raw.result.operationKey === "string");
    return parseCheckoutOriginalResult(raw, { siteId: options.siteId, operationKey: raw.result.operationKey }); };
  const recover = async (run: number) => {
    const stored = read(); if (nonce && stored !== nonce) throw new CheckoutClientError(stored ? "checkout_other_tab" : "checkout_storage_unavailable");
    nonce = stored; if (!nonce) { publish(empty()); return; } const ref = nonce;
    publish({ phase: "recovering", quote: null, original: null, error: "" });
    const raw = await request("/api/member-checkout/on-site/recover", { siteId: options.siteId, nonce: ref }, abort.signal); if (!valid(run)) return;
    if (read() !== ref) throw new CheckoutClientError("checkout_other_tab"); need(object(raw) && raw.ok === true && ["confirmed", "unconfirmed"].includes(String(raw.state)));
    if (raw.state === "unconfirmed") publish({ phase: "unconfirmed", error: "checkout_unconfirmed" });
    else publish({ phase: "confirmed", original: original(raw.original), error: "" });
  };
  const failed = (error: unknown) => publish({ phase: nonce ? "unconfirmed" : "error", quote: null, original: null,
    error: error instanceof CheckoutClientError ? error.code : nonce ? "checkout_unconfirmed" : "checkout_unavailable" });
  const controller = { storageKey: key, getSnapshot: () => state, subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    async activate() { active = true; epoch++; busy = false; nonce = null; selection = null; abort = new AbortController(); state = empty(); return controller.recover(); },
    deactivate() { active = false; epoch++; busy = false; abort.abort(); nonce = null; selection = null; state = empty(); },
    edit() { if (!active || busy || nonce) return; selection = null; publish(empty()); },
    async recover() { if (!active || busy) return; busy = true; const run = epoch;
      try { await recover(run); } catch (error) { if (valid(run)) failed(error); } finally { if (valid(run)) busy = false; } },
    async preview(raw: CheckoutClientSelection, customer: CheckoutCustomerDraft) {
      if (!active || busy || nonce) return; busy = true; const run = epoch; selection = null; publish({ phase: "quoting", quote: null, original: null, error: "" });
      try { if (read()) { await recover(run); return; } const captured = parseCheckoutClientSelection(structuredClone(raw)), person = structuredClone(customer);
        if (captured.siteId !== options.siteId) throw new CheckoutClientError("checkout_invalid_selection");
        const value = await request("/api/member-checkout/on-site/preview", { ...captured, method: "on_site", nonce: options.randomNonce?.() ?? crypto.randomUUID(), confirmationHash: "0".repeat(64), customer: person }, abort.signal);
        if (!valid(run)) return; if (read()) { await recover(run); return; }
        const quote = parseOnSiteClientQuote(value, captured); selection = captured; publish({ phase: "ready", quote, error: "" });
      } catch (error) { if (valid(run)) failed(error); } finally { if (valid(run)) busy = false; }
    },
    async submit(customer: CheckoutCustomerDraft) {
      if (!active || busy || nonce || state.phase !== "ready" || !state.quote || !selection) return;
      const chosen = structuredClone(selection), quote = structuredClone(state.quote), person = structuredClone(customer), run = epoch;
      busy = true; publish({ phase: "submitting", error: "" });
      try { const locked = await exclusive(key, async () => {
        if (!valid(run)) return; if (read()) { await recover(run); return; }
        const next = options.randomNonce?.() ?? crypto.randomUUID(); if (!nonceValid(next)) throw new CheckoutClientError("checkout_browser_unsupported");
        write(next, null); nonce = next; if (!valid(run)) return;
        try {
          const raw = await request("/api/member-checkout/on-site/submit", { ...chosen, method: "on_site", nonce: next, confirmationHash: quote.confirmationHash, customer: person }, abort.signal);
          if (!valid(run)) return; if (read() !== next) throw new CheckoutClientError("checkout_other_tab");
          need(object(raw) && raw.ok === true && typeof raw.replayed === "boolean" && object(raw.result) && typeof raw.result.operationKey === "string");
          const result = parseOnSiteCheckoutResult(raw.result, { siteId: options.siteId, operationKey: raw.result.operationKey });
          need(result.terms.resourceKind === quote.kind && result.terms.grossMinor === quote.grossMinor && result.terms.discountMinor === quote.discountMinor && result.terms.dueMinor === quote.dueMinor && result.terms.couponCount === quote.couponCount);
          publish({ phase: "confirmed", original: { method: "on_site", result }, quote: null, error: "" });
        } catch (error) {
          if (valid(run) && error instanceof CheckoutClientError && [400, 403, 404, 409].includes(error.status) && noWrite.has(error.code)) {
            write(null, next); nonce = null; selection = null; publish({ ...empty(), phase: "error", error: error.code }); return;
          } throw error;
        }
      }); if (valid(run) && !locked) throw new CheckoutClientError("checkout_other_tab");
      } catch (error) { if (valid(run)) failed(error); } finally { if (valid(run)) busy = false; }
    },
    async startAnother() {
      if (!active || busy || !nonce || state.phase !== "confirmed" || !state.original) return;
      const ref = nonce, resultKey = state.original.result.operationKey, run = epoch; busy = true;
      try { const locked = await exclusive(key, async () => {
        await recover(run); if (!valid(run) || state.phase !== "confirmed" || nonce !== ref || state.original?.result.operationKey !== resultKey) return;
        write(null, ref); nonce = null; selection = null; publish(empty());
      }); if (valid(run) && !locked) throw new CheckoutClientError("checkout_other_tab");
      } catch (error) { if (valid(run)) failed(error); } finally { if (valid(run)) busy = false; }
    },
  }; return controller;
}
