import { createHash, randomUUID } from "node:crypto";
import { checkoutCartQuoteIdentity, parseCheckoutCartQuoteRequest, quoteCheckoutCartSnapshot, type CheckoutCartQuote } from "./merchantCheckoutCartQuote.server";
import { checkoutSubmissionRecoveryIdentity, type CheckoutSubmissionSnapshot } from "./merchantCheckoutSubmissionPlan.server";
import { checkoutPrincipalKey, type CheckoutPrincipal } from "./merchantCheckoutQuote.server";
import { parseCheckoutConfigurationSnapshot } from "./merchantCheckoutConfigurationStore.server";
import { parseCheckoutPreviewRows } from "./merchantCheckoutPreview.server";
import { prepareMemberCheckoutAvailablePoints, prepareMemberCheckoutPointDebit } from "./merchantMemberships.server";
import { buildMerchantOrderId, createMerchantOrder } from "./merchantOrders";
import { getUtf8ByteLength } from "./merchantProfileBinding";
import { readPlatformMerchantSnapshotBlocksValidated } from "./platformAdminBackupValidation";

const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const fail = (code = "checkout_invalid_plan"): never => { throw new Error(code); };
const digest = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
type RawRows = CheckoutSubmissionSnapshot["sourceRows"];
export type CartSubmissionSnapshot = { version: 1; purpose: "product_cart_submission"; siteId: string; operationKey: string; principalKey: string; requestHash: string;
  quoteSnapshot: { version: 1; purpose: "product_cart_quote"; siteId: string; principalKey: string; requestHash: string; databaseNow: string;
    offers: unknown[]; sourceRows: RawRows; domainRows: RawRows }; orderRows: RawRows };
export function parseCartSubmissionRequest(raw: unknown) {
  if (!object(raw) || Object.keys(raw).length !== 6 || Object.keys(raw).some(k => !["siteId", "method", "lines", "nonce", "confirmationHash", "customer"].includes(k))
    || typeof raw.nonce !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(raw.nonce)
    || typeof raw.confirmationHash !== "string" || !/^[a-f0-9]{64}$/.test(raw.confirmationHash) || !object(raw.customer)) return fail("checkout_invalid_request");
  const customer = raw.customer, limits = { name: 40, title: 160, email: 320, phone: 80, note: 100 }, fields = Object.keys(limits) as Array<keyof typeof limits>;
  if (Object.keys(customer).length !== fields.length || fields.some(k => typeof customer[k] !== "string" || customer[k] !== (customer[k] as string).trim()
    || getUtf8ByteLength(customer[k] as string) > limits[k] || (k === "note" ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u : /[\u0000-\u001f\u007f]/u).test(customer[k] as string))
    || !customer.name || !customer.phone || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email as string)) return fail("checkout_invalid_customer");
  return { ...parseCheckoutCartQuoteRequest({ siteId: raw.siteId, method: raw.method, lines: raw.lines }), nonce: raw.nonce.toLowerCase(), confirmationHash: raw.confirmationHash,
    customer: customer as Record<keyof typeof limits, string> };
}
export function cartSubmissionIdentity(raw: unknown, principal: CheckoutPrincipal) {
  const request = parseCartSubmissionRequest(structuredClone(raw));
  return { ...checkoutSubmissionRecoveryIdentity({ siteId: request.siteId, nonce: request.nonce }, principal),
    requestHash: digest(["product-cart-submit-v1", request.method, request.lines, request.confirmationHash,
      request.customer.name, request.customer.title, request.customer.email, request.customer.phone, request.customer.note]), request };
}
export type CartSubmissionIdentity = ReturnType<typeof cartSubmissionIdentity>;
export function cartSelectionIdentity(identity: CartSubmissionIdentity, principal: CheckoutPrincipal) {
  return checkoutCartQuoteIdentity({ siteId: identity.siteId, method: identity.request.method, lines: identity.request.lines }, principal);
}
export function cartConfirmationHash(quote: CheckoutCartQuote, principal: CheckoutPrincipal) {
  return digest(["product-cart-financial-confirmation-v1", checkoutPrincipalKey(principal), quote]);
}
export function parseCartSubmissionSnapshot(raw: unknown, identity: CartSubmissionIdentity): CartSubmissionSnapshot {
  if (!object(raw) || raw.version !== 1 || raw.purpose !== "product_cart_submission" || !object(raw.quoteSnapshot)
    || !Array.isArray(raw.orderRows) || Buffer.byteLength(JSON.stringify(raw), "utf8") > 16_777_216) return fail();
  for (const k of ["siteId", "operationKey", "principalKey", "requestHash"] as const) if (raw[k] !== identity[k]) return fail();
  if (raw.orderRows.some(r => !object(r) || typeof r.id !== "string" || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(r.id)
    || r.merchant_id !== identity.siteId || typeof r.slug !== "string" || !new RegExp(`^__merchant_orders__:${identity.siteId}(:chunk:[0-9]+)?$`).test(r.slug)
    || typeof r.updated_at !== "string" || !Number.isFinite(Date.parse(r.updated_at)) || !Array.isArray(r.blocks))
    || new Set(raw.orderRows.map(r => r.id)).size !== raw.orderRows.length || new Set(raw.orderRows.map(r => r.slug)).size !== raw.orderRows.length) return fail();
  return structuredClone(raw) as CartSubmissionSnapshot;
}

/** Deterministic largest-remainder allocation of an EXISTING total growth
 * amount, in hundredths. It does not change the existing gift/level rule or
 * recompute member discounts as each cart line is consumed. */
export function allocateCartGrowth(points: number[], growth: number) {
  const total = points.reduce((a, b) => a + b, 0), cents = Math.round(growth * 100);
  if (!points.length || points.some(p => !Number.isSafeInteger(p) || p < 0) || !Number.isSafeInteger(total) || total <= 0
    || !Number.isSafeInteger(cents) || cents < 0) return fail();
  const raw = points.map((p, i) => { const n = BigInt(p) * BigInt(cents); return { i, cents: n / BigInt(total), remainder: n % BigInt(total) }; });
  let left = BigInt(cents) - raw.reduce((s, r) => s + r.cents, BigInt(0));
  for (const row of [...raw].sort((a, b) => a.remainder === b.remainder ? a.i - b.i : a.remainder > b.remainder ? -1 : 1)) {
    if (left <= 0) break; row.cents++; left--;
  }
  return raw.map(row => Number(row.cents) / 100);
}

/** Trusted preparation ONLY. One full quote; benefits prepared once; a single
 * transaction later applies ALL line debits, stock, coupons and the order. */
export async function planCartSubmission(raw: unknown, suppliedIdentity: CartSubmissionIdentity, suppliedPrincipal: CheckoutPrincipal) {
  const principal = structuredClone(suppliedPrincipal), identity = cartSubmissionIdentity(suppliedIdentity.request, principal);
  if (["siteId", "principalKey", "operationKey", "requestHash"].some(k => identity[k as keyof CartSubmissionIdentity] !== suppliedIdentity[k as keyof CartSubmissionIdentity])) return fail("checkout_unauthorized");
  const snapshot = parseCartSubmissionSnapshot(raw, identity), quoteIdentity = cartSelectionIdentity(identity, principal);
  const quote = await quoteCheckoutCartSnapshot(snapshot.quoteSnapshot, quoteIdentity, principal);
  if (cartConfirmationHash(quote, principal) !== identity.request.confirmationHash) return fail("checkout_quote_changed");
  if (!quote.methodAvailable) return fail("checkout_insufficient_points");
  const config = parseCheckoutConfigurationSnapshot({ version: identity.request.lines[0].offerRevision, offers: snapshot.quoteSnapshot.offers }, identity.siteId);
  const offers = identity.request.lines.map(line => config.offers.find(o => o.id === line.offerId)!);
  if (offers.some(o => o.source.kind !== "order" || o.source.blockId !== offers[0].source.blockId || o.checkoutBinding.viewport !== offers[0].checkoutBinding.viewport)) return fail("checkout_cart_source_mismatch");
  const data = parseCheckoutPreviewRows(identity.siteId, [...snapshot.quoteSnapshot.domainRows, ...snapshot.quoteSnapshot.sourceRows.filter(r => r.slug === `__merchant_catalog__:${identity.siteId}`)]);
  const members = data.memberships.filter(m => Boolean(m.accountId || m.userId) && (!m.accountId || m.accountId === principal.accountId) && (!m.userId || m.userId === principal.userId));
  if (members.length !== 1 || !data.settings || !data.catalog) return fail("checkout_membership_unavailable");
  const member = members[0], now = new Date(snapshot.quoteSnapshot.databaseNow), stamp = now.toISOString();
  const document = (prefix: string) => { const rows = snapshot.quoteSnapshot.domainRows.filter(r => r.slug === prefix + identity.siteId); if (rows.length !== 1) return fail(); return rows[0]; };
  const root = snapshot.quoteSnapshot.sourceRows.filter(r => r.merchant_id === null && r.slug === "__platform_merchant_snapshot__");
  const site = root.length === 1 && Array.isArray(root[0].blocks) ? readPlatformMerchantSnapshotBlocksValidated(root[0].blocks)?.snapshot.find(s => s.id === identity.siteId) : null;
  if (!site) return fail();
  const chunks = snapshot.orderRows.filter(r => r.slug?.includes(":chunk:")), records = (chunks.length ? chunks : snapshot.orderRows).flatMap(r => r.blocks as Array<Record<string, unknown>>);
  if (records.some(r => !object(r) || typeof r.id !== "string" || r.siteId !== identity.siteId) || new Set(records.map(r => r.id)).size !== records.length) return fail();
  const resourceId = buildMerchantOrderId(identity.siteId, now, records.map(r => r.id as string));
  const record = { ...createMerchantOrder({ siteId: identity.siteId, siteName: site.name, blockId: offers[0].source.blockId, ...{ customerAccountId: principal.accountId, customerUserId: principal.userId },
    customer: identity.request.customer, pricePrefix: "€", items: offers.map((o, i) => {
      if (o.source.kind !== "order") return fail(); const product = data.catalog!.products.find(p => p.id === (o.source as { productId: string }).productId); if (!product) return fail();
      return { productId: product.id, code: product.code, name: product.name, description: product.description, imageUrl: product.imageUrl, tag: product.tag,
        quantity: quote.lines[i].quantity, unitPrice: quote.method === "points" ? 0 : o.cash!.unitAmountMinor / 100, unitPriceText: "" };
    }) }, { id: resourceId, createdAt: stamp, updatedAt: stamp }), checkoutOperationKey: identity.operationKey };
  let mutation: ReturnType<typeof prepareMemberCheckoutPointDebit>["mutation"] | null = null;
  const pointTransactionIds = new Map<string, string>();
  if (quote.method === "points") {
    const available = prepareMemberCheckoutAvailablePoints({ membership: member, settings: data.settings, now: stamp, unitPoints: offers[0].unitPoints!, quantity: 1 });
    const debit = prepareMemberCheckoutPointDebit({ original: member, prepared: available.membership, settings: data.settings, points: quote.duePoints!, couponCount: quote.couponCount,
      ...principal, operationKey: identity.operationKey, now: stamp, title: "购物车 / Cart" });
    mutation = debit.mutation;
    const customerTx = mutation.transactions.filter(t => t.operatorId === `customer:${principal.accountId}`);
    if (quote.duePoints! > 0) {
      if (customerTx.length !== 1) return fail(); const original = customerTx[0], weights = quote.lines.map(l => l.duePoints!);
      const growth = allocateCartGrowth(weights, original.growthDelta);
      const split = quote.lines.flatMap((line, i) => {
        if (!line.duePoints) return []; const id = randomUUID(); pointTransactionIds.set(line.offerId, id);
        return [{ ...original, id, pointDelta: -line.duePoints, growthDelta: growth[i], note: `${original.note} [cart-line:${line.offerId}]` }];
      });
      mutation = { ...mutation, transactions: [...mutation.transactions.filter(t => t.id !== original.id), ...split] };
    } else if (customerTx.length) return fail();
  }
  const lines = quote.lines.map((l, i) => ({ offerId: l.offerId, offerRevision: l.offerRevision, productId: l.productId, title: l.title, quantity: l.quantity,
    points: l.duePoints, grossMinor: l.grossMinor, discountMinor: l.discountMinor, dueMinor: l.dueMinor,
    returnPoints: l.cancellationPolicy.returnPoints, returnCoupons: l.cancellationPolicy.returnCoupons,
    stockItemId: offers[i].checkoutBinding.stockItemId, couponClaims: l.couponClaims, pointTransactionId: pointTransactionIds.get(l.offerId) ?? null }));
  const deadlines = [now.getTime() + 30_000, Date.parse(site.serviceExpiresAt!)], midnight = new Date(now); midnight.setHours(24, 0, 0, 0);
  if (quote.method === "points") {
    deadlines.push(midnight.getTime());
    if (!data.settings.pointsRules.pointsNeverExpire && data.settings.pointsRules.pointsValidDays > 0) for (const tx of member.transactions) {
      const expiry = Date.parse(tx.at) + data.settings.pointsRules.pointsValidDays * 86_400_000;
      if (tx.status === "completed" && tx.pointDelta > 0 && expiry > now.getTime()) deadlines.push(expiry);
    }
  }
  for (const line of lines) for (const pick of line.couponClaims) {
    const coupon = data.coupons.find(c => c.id === pick.couponId)!, claim = coupon.claimEvents.find(c => c.id === pick.claimEventId)!;
    for (const expiry of [coupon.expiresAt, claim.validUntil]) if (expiry !== null) deadlines.push(Date.parse(expiry));
  }
  const notAfter = new Date(Math.min(...deadlines)).toISOString(); if (Date.parse(notAfter) <= now.getTime()) return fail("checkout_quote_expired");
  const plan = { version: 1, method: quote.method, memberId: member.id, membership: mutation, lines, record,
    terms: { totalPoints: quote.duePoints, grossMinor: quote.grossMinor, discountMinor: quote.discountMinor, dueMinor: quote.dueMinor, couponCount: quote.couponCount, capturedMinor: 0 } };
  if (Buffer.byteLength(JSON.stringify(plan), "utf8") > 262_144) return fail();
  document("__merchant_memberships__:"); document("__merchant_membership_settings__:");
  return { snapshot, plan, quote, notAfter };
}
