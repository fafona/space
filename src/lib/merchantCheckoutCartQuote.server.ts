import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { parseMerchantCheckoutSelection } from "./merchantCheckoutCatalog";
import { parseCheckoutConfigurationSnapshot } from "./merchantCheckoutConfigurationStore.server";
import { parseCheckoutPreviewRows } from "./merchantCheckoutPreview.server";
import { parseCheckoutSubmissionSnapshot, quoteCheckoutSubmissionSnapshot, type CheckoutSelectionQuoteIdentity, type CheckoutSubmissionSnapshot } from "./merchantCheckoutSubmissionPlan.server";
import { parseOnSiteSubmissionSnapshot, quoteOnSiteSubmissionSnapshot } from "./merchantCheckoutOnSiteSubmissionPlan.server";
import { checkoutPrincipalKey, MerchantCheckoutError, type CheckoutPrincipal } from "./merchantCheckoutQuote.server";
import type { CheckoutCouponClaim, CheckoutCouponChoice } from "./merchantCheckoutCoupons";

const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const fail = (code = "checkout_cart_unavailable"): never => { throw new Error(code); };
const digest = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
const uuid = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(v);
const sum = (values: number[]) => {
  const value = values.reduce((a, b) => a + b, 0);
  if (!Number.isSafeInteger(value) || value < 0 || value > 99_999_999) return fail("checkout_total_too_large");
  return value;
};

/** Products only; coupon claims are explicitly allocated to a line. No
 * browser amount, member ID, slot, customer, nonce or financial token. Do not
 * silently merge aliases or reinterpret line coupons as whole-cart coupons. */
export function parseCheckoutCartQuoteRequest(raw: unknown) {
  if (!object(raw) || Object.keys(raw).length !== 3 || !Object.keys(raw).every(k => ["siteId", "method", "lines"].includes(k))
    || typeof raw.siteId !== "string" || !/^\d{8}$/.test(raw.siteId) || raw.method !== "points" && raw.method !== "on_site"
    || !Array.isArray(raw.lines) || raw.lines.length < 1 || raw.lines.length > 20) return fail("checkout_invalid_cart");
  const ids = new Set<string>(), claims = new Set<string>();
  let quantity = 0;
  const lines = raw.lines.map(row => {
    if (!object(row) || Object.keys(row).some(k => !["offerId", "offerRevision", "quantity", "couponClaims"].includes(k))
      || !uuid(row.offerId) || !uuid(row.offerRevision)) return fail("checkout_invalid_cart");
    const parsed = parseMerchantCheckoutSelection(row);
    if (ids.has(parsed.offerId)) return fail("checkout_cart_duplicate_product");
    ids.add(parsed.offerId); quantity += parsed.quantity;
    for (const claim of parsed.couponClaims ?? []) {
      const key = JSON.stringify([claim.couponId, claim.claimEventId]);
      if (claims.has(key)) return fail("checkout_cart_coupon_reused"); claims.add(key);
    }
    return { offerId: parsed.offerId, offerRevision: parsed.offerRevision, quantity: parsed.quantity, couponClaims: parsed.couponClaims ?? [] };
  }).sort((a, b) => a.offerId < b.offerId ? -1 : a.offerId > b.offerId ? 1 : 0);
  if (quantity > 999 || claims.size > 20) return fail("checkout_invalid_cart");
  return { siteId: raw.siteId, method: raw.method as "points" | "on_site", lines };
}
export function checkoutCartQuoteIdentity(raw: unknown, principal: CheckoutPrincipal) {
  const request = parseCheckoutCartQuoteRequest(structuredClone(raw)), principalKey = checkoutPrincipalKey(principal);
  return { siteId: request.siteId, principalKey, requestHash: digest(["product-cart-quote-only-v1", principalKey, request]), request };
}
type Identity = ReturnType<typeof checkoutCartQuoteIdentity>;
type Snapshot = {
  version: 1; purpose: "product_cart_quote"; siteId: string; principalKey: string; requestHash: string; databaseNow: string;
  offers: unknown[]; sourceRows: CheckoutSubmissionSnapshot["sourceRows"]; domainRows: CheckoutSubmissionSnapshot["domainRows"];
};
export type CheckoutCartLineQuote = {
  offerId: string; offerRevision: string; productId: string; title: string; quantity: number;
  grossMinor: number | null; discountMinor: number | null; dueMinor: number | null;
  grossPoints: number | null; discountPoints: number | null; duePoints: number | null;
  couponClaims: CheckoutCouponClaim[];
  cancellationPolicy: { returnPoints: boolean; returnCoupons: boolean; advanceMinutes: number };
};
export type CheckoutCartQuote = {
  version: 1; purpose: "product_cart_quote"; siteId: string; method: "points" | "on_site";
  previewOnly: true; canSubmit: false; reservationCreated: false; capturedMinor: 0;
  quantity: number; currency: "eur" | null; grossMinor: number | null; discountMinor: number | null; dueMinor: number | null;
  grossPoints: number | null; discountPoints: number | null; duePoints: number | null; ownPointBalance: number | null;
  methodAvailable: boolean; reason?: "insufficient_points"; couponCount: number; lines: CheckoutCartLineQuote[];
  // Display fingerprint ONLY, not any single-offer confirmation/commit token.
  quoteHash: string;
};

function parseSnapshot(raw: unknown, identity: Identity): Snapshot {
  if (!object(raw) || raw.version !== 1 || raw.purpose !== "product_cart_quote" || typeof raw.databaseNow !== "string"
    || !Number.isFinite(Date.parse(raw.databaseNow)) || !Array.isArray(raw.offers) || raw.offers.length !== identity.request.lines.length
    || !Array.isArray(raw.sourceRows) || !Array.isArray(raw.domainRows) || Buffer.byteLength(JSON.stringify(raw), "utf8") > 16_777_216) return fail();
  for (const key of ["siteId", "principalKey", "requestHash"] as const) if (raw[key] !== identity[key]) return fail();
  if (raw.domainRows.some(row => !object(row) || row.merchant_id !== identity.siteId || !["__merchant_memberships__:", "__merchant_membership_settings__:", "__merchant_coupons__:"]
    .some(prefix => row.slug === prefix + identity.siteId))) return fail();
  // Per-line strict parsers below validate the SAME immutable physical rows.
  return structuredClone(raw) as Snapshot;
}

/** One trusted raw DB statement snapshot in, whitelisted display quote out.
 * No storage, financial planner, provider, resource creation or mutation port.
 * Never combine per-line commits to turn this preview into a checkout. */
async function reviewCheckoutCartSnapshot(raw: unknown, suppliedIdentity: Identity, suppliedPrincipal: CheckoutPrincipal) {
  const principal = structuredClone(suppliedPrincipal), identity = checkoutCartQuoteIdentity(suppliedIdentity.request, principal);
  if (["siteId", "principalKey", "requestHash"].some(k => identity[k as keyof Identity] !== suppliedIdentity[k as keyof Identity])) return fail("checkout_unauthorized");
  const snapshot = parseSnapshot(raw, identity), config = parseCheckoutConfigurationSnapshot({ version: identity.request.lines[0].offerRevision, offers: snapshot.offers }, identity.siteId);
  const data = parseCheckoutPreviewRows(identity.siteId, [...snapshot.domainRows,
    ...snapshot.sourceRows.filter(row => row.slug === `__merchant_catalog__:${identity.siteId}`)]);
  const selected = identity.request.lines.flatMap(line => line.couponClaims), claimedCoupons = selected.map(claim => {
    const normalized = data.coupons.find(coupon => coupon.id === claim.couponId);
    const rows = snapshot.domainRows.filter(row => row.slug === `__merchant_coupons__:${identity.siteId}`);
    const original = rows.length === 1 && Array.isArray(rows[0].blocks) ? rows[0].blocks.find(c => object(c) && c.id === claim.couponId) : null;
    if (!normalized || !object(original)) return fail("checkout_coupon_unavailable");
    // Display normalizers must not silently repair an authoritative discount,
    // ownership, validity, use count or cart-wide voucher limit.
    for (const key of ["id", "siteId", "status", "discountType", "discountValue", "minimumAmount", "maxDiscountAmount", "productQuantity",
      "exchangeQuantity", "ticketDurationMinutes", "pointsVoucherMaxPerRedemption", "pointsVoucherMinimumRedeemPoints", "usedCount", "startsAt", "expiresAt",
      "usageScenarios", "applicableProductIds", "applicableTags", "claimEvents", "redeemEvents"] as const)
      if (!isDeepStrictEqual(original[key], normalized[key])) return fail("checkout_coupon_unavailable");
    return normalized;
  });
  // There is no approved general cart stacking rule. Retain the existing
  // conservative single cash/exchange coupon limit; points limits apply to
  // the entire redemption, not separately to each product.
  if (selected.length > 1 && claimedCoupons.some(c => c.discountType !== "points_voucher"
    || c.pointsVoucherMaxPerRedemption > 0 && selected.length > c.pointsVoucherMaxPerRedemption)) return fail("checkout_coupon_stack_not_allowed");
  const stockUse = new Map<string, number>(), products = new Set<string>(), lines: CheckoutCartLineQuote[] = [];
  for (const selection of identity.request.lines) {
    const offer = config.offers.find(o => o.id === selection.offerId);
    if (!offer || !offer.enabled || offer.revision !== selection.offerRevision) return fail("checkout_quote_changed");
    if (offer.source.kind !== "order") return fail("checkout_cart_products_only");
    if (products.has(offer.source.productId)) return fail("checkout_cart_duplicate_product"); products.add(offer.source.productId);
  }
  const balances: number[] = [], couponChoices: Array<{ offerId: string; choices: CheckoutCouponChoice[] }> = [];
  for (const selection of identity.request.lines) {
    const offer = config.offers.find(o => o.id === selection.offerId)!;
    if (offer.source.kind !== "order") return fail("checkout_cart_products_only");
    const quoteIdentity: CheckoutSelectionQuoteIdentity = { siteId: identity.siteId, principalKey: identity.principalKey,
      requestHash: digest([identity.requestHash, selection]), operationKey: digest(["cart-line-quote-only-v1", identity.principalKey, identity.requestHash, offer.id]),
      request: { selection, appointmentAt: undefined } };
    const common = { siteId: identity.siteId, principalKey: identity.principalKey, requestHash: quoteIdentity.requestHash, operationKey: quoteIdentity.operationKey,
      databaseNow: snapshot.databaseNow, offer, sourceRows: snapshot.sourceRows, domainRows: snapshot.domainRows, booking: null };
    const policy = { returnPoints: offer.checkoutBinding.pointsReturnOnCancel, returnCoupons: offer.couponReturnOnCancel!, advanceMinutes: offer.checkoutBinding.cancellationAdvanceMinutes };
    const line = { offerId: offer.id, offerRevision: offer.revision, productId: offer.source.productId, title: offer.title,
      quantity: selection.quantity, couponClaims: selection.couponClaims, cancellationPolicy: policy };
    if (identity.request.method === "points") {
      if (offer.unitPoints === null) return fail("checkout_cart_method_unavailable");
      const q = await quoteCheckoutSubmissionSnapshot(parseCheckoutSubmissionSnapshot({ ...common, version: 2 }, quoteIdentity), quoteIdentity, principal);
      const points = q.quote.options.find(option => option.method === "points");
      if (!points || !points.available && points.reason !== "insufficient_points" || points.totalPoints === null
        || q.quote.totalPoints === null || q.quote.ownPointBalance === null) return fail("checkout_cart_method_unavailable");
      balances.push(q.quote.ownPointBalance);
      couponChoices.push({ offerId: offer.id, choices: q.quote.coupons?.points ?? [] });
      lines.push({ ...line, grossMinor: null, discountMinor: null, dueMinor: null,
        grossPoints: q.quote.totalPoints, discountPoints: q.quote.totalPoints - points.totalPoints, duePoints: points.totalPoints });
    } else {
      if (!offer.allowOnSite || offer.cash === null) return fail("checkout_cart_method_unavailable");
      const q = quoteOnSiteSubmissionSnapshot(parseOnSiteSubmissionSnapshot({ ...common, version: 3, method: "on_site" }, quoteIdentity), quoteIdentity, principal);
      couponChoices.push({ offerId: offer.id, choices: q.coupons });
      lines.push({ ...line, grossMinor: q.grossMinor, discountMinor: q.discountMinor, dueMinor: q.dueMinor, grossPoints: null, discountPoints: null, duePoints: null });
    }
    if (offer.checkoutBinding.stockItemId !== null) stockUse.set(offer.checkoutBinding.stockItemId,
      (stockUse.get(offer.checkoutBinding.stockItemId) ?? 0) + selection.quantity);
  }
  for (const [id, used] of stockUse) {
    const item = data.settings?.redemptionItems.find(item => item.id === id);
    if (!item || !item.enabled || item.stock !== null && (!Number.isSafeInteger(item.stock) || used > item.stock)) return fail("checkout_quantity_unavailable");
  }
  if (balances.some(balance => balance !== balances[0])) return fail();
  const points = identity.request.method === "points", duePoints = points ? sum(lines.map(line => line.duePoints!)) : null;
  const ownPointBalance = points ? balances[0] : null, methodAvailable = !points || ownPointBalance! >= duePoints!;
  const quote = { version: 1 as const, purpose: "product_cart_quote" as const, siteId: identity.siteId, method: identity.request.method,
    previewOnly: true as const, canSubmit: false as const, reservationCreated: false as const, capturedMinor: 0 as const,
    quantity: sum(lines.map(line => line.quantity)), currency: points ? null : "eur" as const,
    grossMinor: points ? null : sum(lines.map(line => line.grossMinor!)), discountMinor: points ? null : sum(lines.map(line => line.discountMinor!)),
    dueMinor: points ? null : sum(lines.map(line => line.dueMinor!)), grossPoints: points ? sum(lines.map(line => line.grossPoints!)) : null,
    discountPoints: points ? sum(lines.map(line => line.discountPoints!)) : null, duePoints, ownPointBalance, methodAvailable,
    ...(!methodAvailable ? { reason: "insufficient_points" as const } : {}), couponCount: selected.length, lines };
  return { quote: { ...quote, quoteHash: digest(["cart-display-not-commit-v1", identity.principalKey, quote]) }, couponChoices };
}

export async function quoteCheckoutCartSnapshot(raw: unknown, identity: Identity, principal: CheckoutPrincipal): Promise<CheckoutCartQuote> {
  return (await reviewCheckoutCartSnapshot(raw, identity, principal)).quote;
}
/** Same statement snapshot and per-line rules as the financial review. Only
 * own safe display choices, never raw claims/codes or a separate wallet read.
 * Choices are NOT added to the financial confirmation fingerprint. */
export const reviewCheckoutCartPreviewSnapshot = reviewCheckoutCartSnapshot;

export type CheckoutCartQuoteRpc = (name: "faolla_member_checkout_cart_quote_snapshot_v1", args: Record<string, unknown>, signal: AbortSignal) => Promise<{ data: unknown; error: unknown }>;

/** Private opt-in service only; deliberately no live client, route, env flag,
 * automatic retries or default-on fallback. Authenticate before/after async
 * work, bound it, and never return raw pages or private coupon/member records. */
export async function previewCheckoutCart(input: { request: unknown; principal: CheckoutPrincipal; authorize(): Promise<CheckoutPrincipal | null>;
  enabled?: (siteId: string) => boolean; signal?: AbortSignal; now?: () => number }, rpc: CheckoutCartQuoteRpc): Promise<CheckoutCartQuote> {
  try {
    const principal = structuredClone(input.principal), identity = checkoutCartQuoteIdentity(input.request, principal), now = input.now ?? Date.now;
    const deadline = now() + 12_000, timeout = AbortSignal.timeout(12_000), signal = input.signal ? AbortSignal.any([input.signal, timeout]) : timeout;
    const guard = () => { if (signal.aborted || now() >= deadline || input.enabled?.(identity.siteId) !== true) return fail(); };
    const bounded = async <T>(promise: Promise<T>): Promise<T> => {
      guard();
      let abort: () => void = () => {};
      try { return await Promise.race([promise, new Promise<never>((_, reject) => {
        abort = () => reject(new Error("checkout_cart_unavailable")); signal.addEventListener("abort", abort, { once: true }); if (signal.aborted) abort();
      })]); } finally { signal.removeEventListener("abort", abort); }
    };
    const authorize = async () => { guard(); const current = await bounded(Promise.resolve().then(() => input.authorize())); guard();
      if (!current || checkoutPrincipalKey(current) !== identity.principalKey) return fail("checkout_unauthorized"); };
    await authorize(); guard();
    const response = await bounded(Promise.resolve().then(() => { guard(); return rpc("faolla_member_checkout_cart_quote_snapshot_v1", {
      p_site_id: identity.siteId, p_principal_key: identity.principalKey, p_request_hash: identity.requestHash, p_offer_ids: identity.request.lines.map(line => line.offerId),
    }, signal); }));
    guard(); await authorize();
    if (!object(response) || response.error !== null || !Object.hasOwn(response, "data")) return fail();
    const stamp = object(response.data) && typeof response.data.databaseNow === "string" ? Date.parse(response.data.databaseNow) : NaN;
    if (!Number.isFinite(stamp) || stamp > now() + 2_000 || now() - stamp > 12_000) return fail();
    const quote = await bounded(quoteCheckoutCartSnapshot(response.data, identity, principal));
    await authorize(); guard(); return quote;
  } catch (error) {
    const code = error instanceof Error ? error.message : "", safe = ["checkout_invalid_cart", "checkout_invalid_selection", "checkout_invalid_coupon_selection",
      "checkout_cart_duplicate_product", "checkout_cart_coupon_reused", "checkout_coupon_stack_not_allowed", "checkout_coupon_unavailable", "checkout_unauthorized",
      "checkout_quantity_unavailable", "checkout_quote_changed", "checkout_source_changed", "checkout_module_unavailable", "checkout_membership_unavailable",
      "checkout_cart_products_only", "checkout_cart_method_unavailable", "checkout_total_too_large"];
    const publicCode = safe.includes(code) ? code : "checkout_cart_unavailable";
    throw new MerchantCheckoutError(publicCode, publicCode === "checkout_unauthorized" ? 401 : publicCode === "checkout_cart_unavailable" ? 503
      : publicCode.startsWith("checkout_invalid_") ? 400 : 409);
  }
}
