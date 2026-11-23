import { parseMerchantCheckoutSelection } from "./merchantCheckoutCatalog";
import { parseCheckoutCouponClaims, type CheckoutCouponChoice } from "./merchantCheckoutCoupons";
import { parseBookingWallTime } from "./merchantBookingTime";
import { parseMemberCheckoutResult, type MemberCheckoutResult } from "./merchantMemberCheckoutResult";

export type CheckoutClientSelection = { siteId: string; offerId: string; offerRevision: string; quantity: number; appointmentAt?: string; couponClaims?: Array<{ couponId: string; claimEventId: string }> };
export type CheckoutCustomerDraft = { name: string; title: string; email: string; phone: string; note: string };
export type CheckoutClientQuote = {
  title: string; kind: "booking" | "order"; quantity: number; points: number | null; balance: number | null; available: boolean;
  confirmationHash: string | null; couponCount: number; coupons: CheckoutCouponChoice[];
  cancellation: { returnPoints: boolean; returnCoupons: boolean | null; advanceMinutes: number };
  bookingForm: { store: string; item: string; titles: string[]; timeZone: string } | null;
};
export type CheckoutClientState = { phase: "idle" | "quoting" | "ready" | "submitting" | "recovering" | "unconfirmed" | "confirmed" | "error";
  quote: CheckoutClientQuote | null; result: MemberCheckoutResult | null; pending: boolean; error: string;
  originalReview?: import("./merchantCheckoutCartReview").CartClientOriginal; intentReviewRequired?: boolean };
type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type CheckoutClientRequest = (path: string, body: unknown, signal: AbortSignal) => Promise<unknown>;
export type CheckoutClientExclusive = (key: string, run: () => Promise<void>) => Promise<boolean>;
export class CheckoutClientError extends Error {
  constructor(readonly code: string, readonly status = 0) { super(code); }
}
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const nonceValid = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v);
const number = (v: unknown, max = 99_999_999): v is number => Number.isSafeInteger(v) && Number(v) >= 0 && Number(v) <= max;
const need = (v: unknown): void => { if (!v) throw new CheckoutClientError("checkout_invalid_response"); };
const empty = (): CheckoutClientState => ({ phase: "idle", quote: null, result: null, pending: false, error: "" });
export function checkoutClientStorageKey(siteId: string, accountId: string) {
  if (!/^\d{8}$/.test(siteId) || !/^\d{8}$/.test(accountId)) throw new CheckoutClientError("checkout_unauthorized");
  return `faolla-member-checkout-v2:${siteId}:${accountId}`;
}
export function parseCheckoutClientSelection(raw: CheckoutClientSelection): CheckoutClientSelection {
  if (!object(raw) || Object.keys(raw).some(key => !["siteId", "offerId", "offerRevision", "quantity", "appointmentAt", "couponClaims"].includes(key))
    || !/^\d{8}$/.test(raw.siteId) || (raw.appointmentAt !== undefined && parseBookingWallTime(raw.appointmentAt)?.normalized !== raw.appointmentAt)) throw new CheckoutClientError("checkout_invalid_selection");
  const parsed = parseMerchantCheckoutSelection({ offerId: raw.offerId, offerRevision: raw.offerRevision, quantity: raw.quantity, couponClaims: raw.couponClaims });
  return { siteId: raw.siteId, offerId: parsed.offerId, offerRevision: parsed.offerRevision, quantity: parsed.quantity,
    couponClaims: parsed.couponClaims, ...(raw.appointmentAt ? { appointmentAt: raw.appointmentAt } : {}) };
}
export function parseCheckoutStartQuery(siteId: string, query: Record<string, string | string[] | undefined>) {
  if (Object.keys(query).some(key => !["offerId", "offerRevision", "quantity", "appointmentAt", "entry", "uiLocale"].includes(key))
    || Object.values(query).some(value => Array.isArray(value)) || query.entry !== undefined && query.entry !== "web"
    || query.uiLocale !== undefined && (query.uiLocale.length > 40 || !/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(query.uiLocale as string))
    || query.quantity !== undefined && !/^[1-9][0-9]{0,2}$/.test(query.quantity as string)) throw new CheckoutClientError("checkout_invalid_selection");
  return parseCheckoutClientSelection({ siteId, offerId: query.offerId as string, offerRevision: query.offerRevision as string,
    quantity: query.quantity === undefined ? 1 : Number(query.quantity), ...(query.appointmentAt !== undefined ? { appointmentAt: query.appointmentAt as string } : {}) });
}
/** Prepared for later wiring. No contact fields, member IDs, balances or
 * coupon claims in URLs; using this link does not publish/enable checkout. */
export function buildCheckoutStartHref(selection: Omit<CheckoutClientSelection, "couponClaims">, locale?: string) {
  const checked = parseCheckoutClientSelection(selection);
  if (checked.couponClaims?.length) throw new CheckoutClientError("checkout_invalid_selection");
  const params = new URLSearchParams({ offerId: checked.offerId, offerRevision: checked.offerRevision, quantity: String(checked.quantity) });
  if (checked.appointmentAt) params.set("appointmentAt", checked.appointmentAt);
  if (locale) params.set("uiLocale", locale);
  parseCheckoutStartQuery(checked.siteId, Object.fromEntries(params));
  return `/member-checkout/${checked.siteId}/start?${params}`;
}
export function parseCheckoutClientPreview(raw: unknown, selection: CheckoutClientSelection): CheckoutClientQuote {
  if (!object(raw) || raw.ok !== true || !object(raw.quote)) throw new CheckoutClientError("checkout_invalid_response");
  const q = raw.quote;
  need(q.version === 1 && q.siteId === selection.siteId && q.offerId === selection.offerId && q.offerRevision === selection.offerRevision
    && q.quantity === selection.quantity && q.reservationCreated === false && ["booking", "order"].includes(String(q.resourceKind))
    && typeof q.title === "string" && q.title.length > 0 && q.title.length <= 200 && Array.isArray(q.options)
    && (q.ownPointBalance === null || number(q.ownPointBalance, Number.MAX_SAFE_INTEGER)));
  const options = (q.options as unknown[]).filter(option => object(option) && option.method === "points") as Record<string, unknown>[];
  need(options.length <= 1); const p = options[0];
  if (p) need(typeof p.available === "boolean" && (p.totalPoints === null || number(p.totalPoints)) && number(p.couponCount ?? 0, 20));
  const selected = parseCheckoutCouponClaims(selection.couponClaims), coupons: CheckoutCouponChoice[] = [];
  if (q.coupons !== undefined) {
    need(object(q.coupons)); const wallet = q.coupons as Record<string, unknown>;
    need(wallet.previewOnly === true && Array.isArray(wallet.points) && wallet.points.length <= 1000
      && [true, false, null].includes(wallet.returnOnCancel as boolean | null));
    need(JSON.stringify(parseCheckoutCouponClaims(wallet.selected)) === JSON.stringify(selected));
    for (const value of wallet.points as unknown[]) {
      if (!object(value)) throw new CheckoutClientError("checkout_invalid_response");
      parseCheckoutCouponClaims([{ couponId: value.couponId, claimEventId: value.claimEventId }]);
      need(typeof value.title === "string" && value.title.length <= 500 && typeof value.available === "boolean" && value.singleUse === true
        && ["points_voucher", "product_voucher", "exchange_voucher", "ticket_voucher", "amount_off", "threshold_amount_off", "percent_off", "stored_value"].includes(String(value.kind))
        && number(value.pointsDiscount) && number(value.cashDiscountMinor) && number(value.coveredQuantity, 999)
        && (value.validUntil === null || typeof value.validUntil === "string" && Number.isFinite(Date.parse(value.validUntil)))
        && (value.reason === undefined || ["inactive", "not_started", "expired", "used", "scenario", "target", "minimum", "wrong_units", "invalid"].includes(String(value.reason))));
      coupons.push({ couponId: value.couponId as string, claimEventId: value.claimEventId as string, title: value.title as string,
        kind: value.kind as CheckoutCouponChoice["kind"], available: value.available as boolean, singleUse: true, validUntil: value.validUntil as string | null,
        pointsDiscount: value.pointsDiscount as number, cashDiscountMinor: value.cashDiscountMinor as number, coveredQuantity: value.coveredQuantity as number,
        ...(value.reason ? { reason: value.reason as CheckoutCouponChoice["reason"] } : {}) });
    }
    need(new Set(coupons.map(c => JSON.stringify([c.couponId, c.claimEventId]))).size === coupons.length);
  } else need(selected.length === 0);
  let bookingForm: CheckoutClientQuote["bookingForm"] = null;
  if (q.resourceKind === "booking") {
    if (!object(raw.bookingForm) || !Array.isArray(raw.bookingForm.titles) || !object(raw.slot)) throw new CheckoutClientError("checkout_invalid_response");
    const form = raw.bookingForm;
    need([form.store, form.item, form.timeZone].every(value => typeof value === "string" && value.length > 0 && value.length <= 160)
      && (form.titles as unknown[]).every(value => typeof value === "string" && value.length > 0 && value.length <= 160)
      && (form.titles as unknown[]).length > 0 && (form.titles as unknown[]).length <= 1000
      && raw.slot.appointmentAt === selection.appointmentAt && raw.slot.timeZone === form.timeZone && raw.slot.reserved === false);
    new Intl.DateTimeFormat("en", { timeZone: form.timeZone as string }).format();
    bookingForm = { store: form.store as string, item: form.item as string, titles: [...form.titles as string[]], timeZone: form.timeZone as string };
  } else need(raw.slot === null && selection.appointmentAt === undefined);
  const available = p?.available === true;
  if (!object(raw.cancellationPolicy) || typeof raw.cancellationPolicy.returnPoints !== "boolean"
    || ![true, false, null].includes(raw.cancellationPolicy.returnCoupons as boolean | null)
    || !number(raw.cancellationPolicy.advanceMinutes, 43_200)) throw new CheckoutClientError("checkout_invalid_response");
  need(!available || typeof raw.confirmationHash === "string" && /^[a-f0-9]{64}$/.test(raw.confirmationHash)
    && number(p.totalPoints) && number(q.ownPointBalance, Number.MAX_SAFE_INTEGER) && Number(q.ownPointBalance) >= p.totalPoints
    && (p.totalPoints > 0 || Number(p.couponCount) > 0) && (p.couponCount ?? 0) === selected.length);
  return { title: q.title as string, kind: q.resourceKind as "booking" | "order", quantity: selection.quantity, points: p?.totalPoints as number | null ?? null,
    balance: q.ownPointBalance as number | null, available, couponCount: Number(p?.couponCount ?? 0), coupons, bookingForm,
    confirmationHash: available ? raw.confirmationHash as string : null, cancellation: { returnPoints: raw.cancellationPolicy.returnPoints,
      returnCoupons: raw.cancellationPolicy.returnCoupons as boolean | null, advanceMinutes: raw.cancellationPolicy.advanceMinutes } };
}

/** No retries, including auth retries. The server reauthorizes financial writes. */
export const checkoutClientRequest: CheckoutClientRequest = async (path, body, signal) => {
  const response = await fetch(path, { method: "POST", credentials: "same-origin", cache: "no-store", signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
    headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(body) });
  const value: unknown = await response.json().catch(() => null);
  if (!response.ok || !object(value) || value.ok !== true) throw new CheckoutClientError(object(value) && typeof value.error === "string" ? value.error : "checkout_unconfirmed", response.status);
  return value;
};
const browserExclusive: CheckoutClientExclusive = async (key, run) => {
  if (!navigator.locks) throw new CheckoutClientError("checkout_browser_unsupported");
  return navigator.locks.request(key, { ifAvailable: true }, async lock => { if (!lock) return false; await run(); return true; });
};
const definiteNoWrite = new Set(["checkout_invalid_request", "checkout_invalid_selection", "checkout_invalid_customer", "checkout_invalid_coupon_selection", "checkout_conflict", "checkout_quote_changed",
  "checkout_quote_expired", "checkout_offer_not_found", "checkout_membership_unavailable", "checkout_insufficient_points", "checkout_quantity_unavailable", "checkout_coupon_unavailable",
  "checkout_source_changed", "checkout_module_unavailable", "checkout_slot_unavailable", "checkout_booking_quantity_unsupported"]);

/** New, isolated personal checkout only. The merchant/account-scoped storage
 * VALUE contains one random nonce, NEVER contact fields, form data, balances,
 * prices or claims. The storage key contains the two non-secret scope IDs.
 * Unknown outcomes cannot be discarded or resubmitted, including after reload. */
export function createCheckoutClientController(options: { siteId: string; accountId: string; request?: CheckoutClientRequest; storage?: StorageLike;
  exclusive?: CheckoutClientExclusive; randomNonce?: () => string }) {
  const key = checkoutClientStorageKey(options.siteId, options.accountId), request = options.request ?? checkoutClientRequest;
  const exclusive = options.exclusive ?? browserExclusive;
  let state = empty(), active = false, epoch = 0, busy = false, nonce: string | null = null, selection: CheckoutClientSelection | null = null;
  let abort = new AbortController(); const listeners = new Set<() => void>();
  const publish = (patch: Partial<CheckoutClientState>) => { state = { ...state, ...patch, pending: nonce !== null }; listeners.forEach(fn => fn()); };
  const valid = (run: number) => active && epoch === run && !abort.signal.aborted;
  const storage = () => { try { return options.storage ?? window.localStorage; } catch { throw new CheckoutClientError("checkout_storage_unavailable"); } };
  const read = () => {
    try {
      const raw = storage().getItem(key); if (raw === null) return null;
      const parsed: unknown = JSON.parse(raw);
      if (!object(parsed) || Object.keys(parsed).length !== 2 || parsed.version !== 1 || !nonceValid(parsed.nonce)) throw new Error("invalid");
      return parsed.nonce;
    } catch { throw new CheckoutClientError("checkout_storage_unavailable"); }
  };
  const write = (value: string | null, expected: string | null) => {
    try {
      if (read() !== expected) throw new CheckoutClientError("checkout_other_tab");
      if (value === null) storage().removeItem(key); else storage().setItem(key, JSON.stringify({ version: 1, nonce: value }));
      if (read() !== value) throw new Error("not durable");
    } catch (error) { throw error instanceof CheckoutClientError ? error : new CheckoutClientError("checkout_storage_unavailable"); }
  };
  const recover = async (run: number) => {
    const persisted = read();
    // A missing/replaced local record cannot erase an in-memory original that
    // may still be committing. Only the explicit confirmed acknowledgement
    // below is allowed to release our known nonce.
    if (nonce && persisted !== nonce) throw new CheckoutClientError(persisted ? "checkout_other_tab" : "checkout_storage_unavailable");
    nonce = persisted; if (!nonce) { publish({ phase: "idle", quote: null, result: null, error: "" }); return; }
    publish({ phase: "recovering", quote: null, result: null, error: "" });
    const original = nonce, raw = await request("/api/member-checkout/recover", { siteId: options.siteId, nonce: original }, abort.signal);
    if (!valid(run)) return;
    if (read() !== original) throw new CheckoutClientError("checkout_other_tab");
    if (!object(raw) || raw.ok !== true || !["unconfirmed", "confirmed"].includes(String(raw.state))) throw new CheckoutClientError("checkout_invalid_response");
    if (raw.state === "unconfirmed") { publish({ phase: "unconfirmed", error: "checkout_unconfirmed" }); return; }
    const result = parseResult(raw.result);
    publish({ phase: "confirmed", result, error: "" });
  };
  const parseResult = (raw: unknown) => {
    if (!object(raw) || typeof raw.operationKey !== "string" || !/^[a-f0-9]{64}$/.test(raw.operationKey)) throw new CheckoutClientError("checkout_invalid_response");
    return parseMemberCheckoutResult(raw, { siteId: options.siteId, operationKey: raw.operationKey });
  };
  const failed = (error: unknown) => publish({ phase: nonce ? "unconfirmed" : "error", result: null, quote: null,
    error: error instanceof CheckoutClientError ? error.code : nonce ? "checkout_unconfirmed" : "checkout_unavailable" });
  const controller = {
    storageKey: key, getSnapshot: () => state,
    subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    async activate() { active = true; epoch++; busy = false; nonce = null; selection = null; abort = new AbortController(); state = empty(); return controller.recover(); },
    deactivate() { active = false; epoch++; busy = false; abort.abort(); nonce = null; selection = null; state = empty(); },
    edit() {
      if (!active || busy || nonce) return;
      selection = null; publish({ phase: "idle", quote: null, result: null, error: "" });
    },
    async recover() {
      if (!active || busy) return; busy = true; const run = epoch;
      try { await recover(run); } catch (error) { if (valid(run)) failed(error); } finally { if (valid(run)) busy = false; }
    },
    async preview(raw: CheckoutClientSelection) {
      if (!active || busy || nonce) return; busy = true; const run = epoch; selection = null;
      publish({ phase: "quoting", quote: null, result: null, error: "" });
      try {
        if (read()) { await recover(run); return; }
        const captured = parseCheckoutClientSelection(structuredClone(raw)); if (captured.siteId !== options.siteId) throw new CheckoutClientError("checkout_invalid_selection");
        const response = await request("/api/member-checkout/preview", captured, abort.signal); if (!valid(run)) return;
        if (read()) { await recover(run); return; }
        const quote = parseCheckoutClientPreview(response, captured); selection = captured; publish({ phase: "ready", quote, error: "" });
      } catch (error) { if (valid(run)) failed(error); } finally { if (valid(run)) busy = false; }
    },
    async submit(customer: CheckoutCustomerDraft) {
      if (!active || busy || nonce || state.phase !== "ready" || !state.quote?.available || !selection) return;
      const captured = structuredClone(selection), quote = structuredClone(state.quote), person = structuredClone(customer), run = epoch;
      busy = true; publish({ phase: "submitting", error: "" });
      try {
        const locked = await exclusive(key, async () => {
          if (!valid(run)) return;
          if (read()) { await recover(run); return; }
          const next = options.randomNonce?.() ?? crypto.randomUUID(); if (!nonceValid(next)) throw new CheckoutClientError("checkout_browser_unsupported");
          write(next, null); nonce = next;
          if (!valid(run)) return;
          try {
            const raw = await request("/api/member-checkout/submit", { ...captured, nonce, method: "points", confirmationHash: quote.confirmationHash, customer: person }, abort.signal);
            if (!valid(run)) return;
            if (read() !== next || !object(raw) || raw.ok !== true || typeof raw.replayed !== "boolean") throw new CheckoutClientError("checkout_invalid_response");
            const result = parseResult(raw.result);
            if (result.resourceKind !== quote.kind || result.totalPoints !== quote.points || result.couponCount !== quote.couponCount) throw new CheckoutClientError("checkout_invalid_response");
            publish({ phase: "confirmed", result, quote: null, error: "" });
          } catch (error) {
            if (valid(run) && error instanceof CheckoutClientError && [400, 403, 404, 409].includes(error.status) && definiteNoWrite.has(error.code)) {
              write(null, next); nonce = null; selection = null; publish({ phase: "error", quote: null, result: null, error: error.code }); return;
            }
            throw error;
          }
        });
        if (valid(run) && !locked) throw new CheckoutClientError("checkout_other_tab");
      } catch (error) { if (valid(run)) failed(error); } finally { if (valid(run)) busy = false; }
    },
    async startAnother() {
      if (!active || busy || !nonce || state.phase !== "confirmed" || !state.result) return;
      const original = nonce, resultKey = state.result.operationKey, run = epoch; busy = true; publish({ phase: "recovering", error: "" });
      try {
        const locked = await exclusive(key, async () => {
          if (!valid(run)) return;
          await recover(run); if (!valid(run) || state.phase !== "confirmed" || nonce !== original || state.result?.operationKey !== resultKey) return;
          write(null, original); nonce = null; selection = null; publish({ ...empty() });
        });
        if (valid(run) && !locked) throw new CheckoutClientError("checkout_other_tab");
      } catch (error) { if (valid(run)) failed(error); } finally { if (valid(run)) busy = false; }
    },
  };
  return controller;
}
