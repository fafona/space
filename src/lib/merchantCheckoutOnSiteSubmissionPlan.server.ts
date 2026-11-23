import { createHash, randomBytes } from "node:crypto";
import { parseMemberCheckoutPreviewRequest, parseCheckoutPreviewRows } from "./merchantCheckoutPreview.server";
import { checkoutPrincipalKey, type CheckoutPrincipal } from "./merchantCheckoutQuote.server";
import { checkoutSubmissionRecoveryIdentity, type CheckoutSelectionQuoteIdentity, type CheckoutSubmissionSnapshot } from "./merchantCheckoutSubmissionPlan.server";
import { parseCheckoutConfigurationSnapshot } from "./merchantCheckoutConfigurationStore.server";
import { readPlatformMerchantSnapshotBlocksValidated } from "./platformAdminBackupValidation";
import { pickPublishedPageRow } from "./publishedSiteData";
import { getMerchantServiceState } from "./merchantServiceStatus";
import { checkoutAvailableQuantity, type CheckoutAvailabilityMaterial } from "./merchantCheckoutAvailability.server";
import { normalizeMerchantBookingRulesSnapshot, resolveMerchantBookingRuleEntry, resolveMerchantBookingRuleSelection, resolveMerchantBookingRuleOptionSets } from "./merchantBookingRules";
import { normalizeMerchantBookingWorkbenchSettings } from "./merchantBookingWorkbench";
import { parseBookingAppointment, bookingWallTimeAt } from "./merchantBookingTime";
import { buildMerchantBookingId, validateMerchantBookingInput, type MerchantBookingRecord } from "./merchantBookings";
import { buildMerchantOrderId, createMerchantOrder } from "./merchantOrders";
import { quoteCheckoutCoupons, checkoutCouponChoices } from "./merchantCheckoutCoupons";
import { quoteMerchantOfferAmounts } from "./merchantCheckoutCatalog";
import { prepareOnSitePendingTerms } from "./merchantCheckoutOnSitePending.server";
import { getUtf8ByteLength } from "./merchantProfileBinding";

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const fail = (code = "checkout_invalid_plan"): never => { throw new Error(code); };
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export type OnSiteSubmissionSnapshot = Omit<CheckoutSubmissionSnapshot, "version"> & { version: 3; method: "on_site" };
export function parseOnSiteSubmissionRequest(raw: unknown) {
  if (!object(raw) || Object.keys(raw).some(key => !["siteId", "offerId", "offerRevision", "quantity", "appointmentAt", "couponClaims", "nonce", "confirmationHash", "method", "customer"].includes(key))
    || raw.method !== "on_site" || typeof raw.nonce !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(raw.nonce)
    || typeof raw.confirmationHash !== "string" || !/^[a-f0-9]{64}$/.test(raw.confirmationHash) || !object(raw.customer)) return fail("checkout_invalid_request");
  const customer = raw.customer, fields = ["name", "title", "email", "phone", "note"] as const;
  if (Object.keys(customer).length !== fields.length || fields.some(key => typeof customer[key] !== "string" || customer[key] !== (customer[key] as string).trim()
    || (key === "note" ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u : /[\u0000-\u001f\u007f]/u).test(customer[key] as string))) return fail("checkout_invalid_request");
  const limits = { name: 40, title: 160, email: 320, phone: 80, note: 100 };
  if (fields.some(key => getUtf8ByteLength(customer[key] as string) > limits[key]) || !customer.name || !customer.phone
    || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email as string)) return fail("checkout_invalid_request");
  const { nonce, confirmationHash, method: _method, customer: _customer, ...selection } = raw; void _method; void _customer;
  return { ...parseMemberCheckoutPreviewRequest(selection), nonce: nonce.toLowerCase(), confirmationHash, method: "on_site" as const,
    customer: customer as Record<typeof fields[number], string> };
}
export function onSiteSubmissionIdentity(raw: unknown, principal: CheckoutPrincipal) {
  const request = parseOnSiteSubmissionRequest(structuredClone(raw)), shared = checkoutSubmissionRecoveryIdentity({ siteId: request.siteId, nonce: request.nonce }, principal);
  return { ...shared, requestHash: digest(["on_site", request.selection, request.appointmentAt ?? null, request.confirmationHash,
    request.customer.name, request.customer.title, request.customer.email, request.customer.phone, request.customer.note]), request };
}
export type OnSiteSubmissionIdentity = ReturnType<typeof onSiteSubmissionIdentity>;

/** Separate method/version: never forge a points request to reuse its parser. */
export function parseOnSiteSubmissionSnapshot(raw: unknown, identity: CheckoutSelectionQuoteIdentity): OnSiteSubmissionSnapshot {
  if (!object(raw) || raw.version !== 3 || raw.method !== "on_site" || typeof raw.databaseNow !== "string" || !Number.isFinite(Date.parse(raw.databaseNow))) return fail();
  for (const key of ["siteId", "principalKey", "operationKey", "requestHash"] as const) if (raw[key] !== identity[key]) return fail();
  const rows = (value: unknown, tenant: boolean) => {
    if (!Array.isArray(value) || value.some(row => !object(row) || typeof row.id !== "string" || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(row.id)
      || typeof row.updated_at !== "string" || !Number.isFinite(Date.parse(row.updated_at)) || row.slug !== null && typeof row.slug !== "string"
      || tenant && row.merchant_id !== identity.siteId) || new Set(value.map(row => row.id)).size !== value.length) return fail();
    return value as OnSiteSubmissionSnapshot["sourceRows"];
  };
  const offer = parseCheckoutConfigurationSnapshot({ version: identity.request.selection.offerRevision, offers: [raw.offer] }, identity.siteId).offers[0];
  if (!offer.enabled || !offer.allowOnSite || !offer.cash || offer.id !== identity.request.selection.offerId || offer.revision !== identity.request.selection.offerRevision) return fail("checkout_quote_changed");
  const sourceRows = rows(raw.sourceRows, false), domainRows = rows(raw.domainRows, true);
  if (sourceRows.some(row => !(row.merchant_id === null && row.slug === "__platform_merchant_snapshot__")
    && !(row.merchant_id === identity.siteId && (row.slug === null || !row.slug.startsWith("__") || row.slug === `__merchant_catalog__:${identity.siteId}`)))) return fail();
  if (domainRows.some(row => !["__merchant_memberships__:", "__merchant_membership_settings__:", "__merchant_coupons__:", "__merchant_orders__:"].some(prefix => row.slug === prefix + identity.siteId)
    && !new RegExp(`^__merchant_orders__:${identity.siteId}:chunk:[0-9]+$`).test(row.slug ?? ""))) return fail();
  let booking: OnSiteSubmissionSnapshot["booking"] = null;
  if (offer.source.kind === "booking") {
    if (!object(raw.booking) || typeof raw.booking.generation !== "string" || !/^[a-f0-9-]{36}$/i.test(raw.booking.generation)
      || typeof raw.booking.revision !== "string" || !/^\d{1,19}$/.test(raw.booking.revision) || !Array.isArray(raw.booking.rows)
      || raw.booking.rows.some(row => !object(row) || typeof row.id !== "string" || typeof row.slug !== "string" || !Object.hasOwn(row, "blocks"))
      || new Set(raw.booking.rows.map(row => row.id)).size !== raw.booking.rows.length) return fail();
    booking = { generation: raw.booking.generation, revision: raw.booking.revision, rows: raw.booking.rows as NonNullable<OnSiteSubmissionSnapshot["booking"]>["rows"] };
  } else if (raw.booking !== null) return fail();
  return structuredClone({ version: 3, method: "on_site", siteId: identity.siteId, operationKey: identity.operationKey, principalKey: identity.principalKey,
    requestHash: identity.requestHash, databaseNow: raw.databaseNow, offer, sourceRows, domainRows, booking });
}

/** Read-only preparation from raw DB snapshots. Does not call points-benefit,
 * expiry, wallet, scheduled award, shadow write, catalog repair or Stripe ports. */
function context(raw: OnSiteSubmissionSnapshot, identity: CheckoutSelectionQuoteIdentity, principal: CheckoutPrincipal) {
  if (checkoutPrincipalKey(principal) !== identity.principalKey) return fail("checkout_unauthorized");
  const snapshot = parseOnSiteSubmissionSnapshot(raw, identity), { offer, siteId } = snapshot, now = new Date(snapshot.databaseNow), request = identity.request;
  const roots = snapshot.sourceRows.filter(row => row.slug === "__platform_merchant_snapshot__" && row.merchant_id === null);
  if (roots.length !== 1 || !Array.isArray(roots[0].blocks)) return fail("checkout_unavailable");
  const sites = readPlatformMerchantSnapshotBlocksValidated(roots[0].blocks)?.snapshot.filter(site => site.id === siteId) ?? [];
  if (sites.length !== 1) return fail("checkout_module_unavailable");
  const site = sites[0], permissions = site.permissionConfig;
  const bookings = permissions?.allowBookingBlock === true, orders = permissions?.allowProductBlock === true && permissions.allowOrderManagement === true;
  if (getMerchantServiceState(site.status, site.serviceExpiresAt, now.getTime()).reason !== null || !permissions?.allowMembershipManagement
    || !(offer.source.kind === "booking" ? bookings : orders)) return fail("checkout_module_unavailable");
  if (request.selection.couponClaims?.length && !permissions.allowCouponModule) return fail("checkout_module_unavailable");
  const published = pickPublishedPageRow(snapshot.sourceRows.filter(row => row.merchant_id === siteId && !row.slug?.startsWith("__")));
  if (!published || !Array.isArray(published.blocks)) return fail("checkout_source_changed");
  const data = parseCheckoutPreviewRows(siteId, [...snapshot.domainRows.filter(row => !row.slug?.startsWith("__merchant_orders__:")),
    ...snapshot.sourceRows.filter(row => row.slug === `__merchant_catalog__:${siteId}`)]);
  const document = (prefix: string) => { const rows = snapshot.domainRows.filter(row => row.slug === prefix + siteId); if (rows.length !== 1) return fail("checkout_unavailable"); return rows[0]; };
  document("__merchant_memberships__:"); document("__merchant_membership_settings__:");
  const own = data.memberships.filter(member => Boolean(member.accountId || member.userId)
    && (!member.accountId || member.accountId === principal.accountId) && (!member.userId || member.userId === principal.userId));
  if (own.length !== 1 || own[0].status !== "active" || !data.settings) return fail("checkout_membership_unavailable");
  // Cash discounts must not rely on a financial scalar or identity silently
  // repaired by the old display normalizer. All selected raw values must agree.
  for (const selected of request.selection.couponClaims ?? []) {
    const row = document("__merchant_coupons__:"), originals = Array.isArray(row.blocks) ? row.blocks : [], normalized = data.coupons.find(c => c.id === selected.couponId);
    const original = originals.find(c => object(c) && c.id === selected.couponId);
    if (!normalized || !object(original)) return fail("checkout_coupon_unavailable");
    for (const field of ["id", "siteId", "status", "discountType", "discountValue", "minimumAmount", "maxDiscountAmount", "productQuantity", "exchangeQuantity", "ticketDurationMinutes", "usedCount", "startsAt", "expiresAt"] as const)
      if (original[field] !== normalized[field]) return fail("checkout_coupon_unavailable");
    for (const field of ["usageScenarios", "applicableProductIds", "applicableTags"] as const)
      if (JSON.stringify(original[field]) !== JSON.stringify(normalized[field])) return fail("checkout_coupon_unavailable");
    for (const event of [...normalized.claimEvents, ...normalized.redeemEvents]) {
      const array = "settlementType" in event ? original.claimEvents : original.redeemEvents;
      const stored = Array.isArray(array) ? array.find(e => object(e) && e.id === event.id) : undefined;
      if (!object(stored)) return fail("checkout_coupon_unavailable");
      for (const field of ["id", "accountId", "userId", "settlementCode", "at"] as const) if (stored[field] !== event[field]) return fail("checkout_coupon_unavailable");
      if ("validUntil" in event && stored.validUntil !== event.validUntil) return fail("checkout_coupon_unavailable");
      if ("claimEventId" in event && stored.claimEventId !== event.claimEventId) return fail("checkout_coupon_unavailable");
    }
  }
  let booking: CheckoutAvailabilityMaterial["booking"] = null;
  if (offer.source.kind === "booking") {
    const doc = (slug: string) => { const rows = snapshot.booking?.rows.filter(row => row.slug === slug) ?? [];
      if (rows.length !== 1 || !object(rows[0].blocks) || rows[0].blocks.version !== 1) return fail(); return rows[0].blocks; };
    const rules = doc("__merchant_booking_rules__:v1"), workbench = doc("__merchant_booking_workbench__:v1"), records = doc("__merchant_booking_records__:v1");
    if (!object(rules.snapshots) || !object(workbench.settingsBySiteId) || !object(workbench.settingsBySiteId[siteId]) || !Array.isArray(records.records)) return fail();
    const selected = normalizeMerchantBookingRulesSnapshot(rules.snapshots[siteId]);
    if (!selected || selected.siteId !== siteId || records.records.some(row => !object(row) || typeof row.id !== "string" || typeof row.siteId !== "string"
      || !["active", "confirmed", "completed", "no_show", "cancelled"].includes(String(row.status)))) return fail();
    booking = { rules: selected, workbench: normalizeMerchantBookingWorkbenchSettings(workbench.settingsBySiteId[siteId]), records: records.records as MerchantBookingRecord[] };
  }
  const material: CheckoutAvailabilityMaterial = { siteId, siteName: site.name, blocks: published.blocks, catalog: data.catalog, bookings, orders, settings: data.settings, booking };
  if (checkoutAvailableQuantity({ offer, material, quantity: request.selection.quantity, appointmentAt: request.appointmentAt, now }) < request.selection.quantity) return fail("checkout_quantity_unavailable");
  const amounts = quoteMerchantOfferAmounts(offer, request.selection), tags = offer.source.kind === "order"
    ? [data.catalog?.products.find(p => offer.source.kind === "order" && p.id === offer.source.productId)?.tag ?? ""].filter(Boolean) : [];
  const couponContext = { siteId, ...principal, membershipActive: true, kind: offer.source.kind, method: "on_site" as const,
    targetId: offer.source.kind === "booking" ? offer.source.serviceId : offer.source.productId, tags, quantity: request.selection.quantity,
    unitCashMinor: offer.cash!.unitAmountMinor, unitPoints: null, voucherCouponIds: offer.checkoutBinding.voucherCouponIds,
    durationMinutes: offer.checkoutBinding.durationMinutes ?? undefined, now: now.toISOString() };
  const couponQuote = quoteCheckoutCoupons(data.coupons, couponContext, request.selection.couponClaims);
  const slot = offer.source.kind === "booking" ? { key: request.selection.slotKey!, appointmentAt: request.appointmentAt!, timeZone: offer.source.timeZone, reserved: false as const } : null;
  const rule = booking && resolveMerchantBookingRuleEntry(booking.rules, { bookingBlockId: offer.source.blockId, bookingViewport: offer.checkoutBinding.viewport });
  const quote = { version: 1 as const, method: "on_site" as const, siteId, offerId: offer.id, offerRevision: offer.revision, resourceKind: offer.source.kind,
    title: offer.title, quantity: request.selection.quantity, currency: "eur" as const, grossMinor: amounts.cashTotalMinor!, discountMinor: couponQuote.cashDiscountMinor,
    dueMinor: couponQuote.payableCashMinor!, capturedMinor: 0 as const, totalPoints: null, couponCount: couponQuote.claims.length, selected: couponQuote.claims,
    coupons: permissions.allowCouponModule ? checkoutCouponChoices(data.coupons, couponContext) : [], reservationCreated: false as const,
    cancellationPolicy: { returnCoupons: offer.couponReturnOnCancel!, advanceMinutes: offer.checkoutBinding.cancellationAdvanceMinutes }, slot,
    bookingForm: rule ? { store: offer.checkoutBinding.store!, item: offer.checkoutBinding.item!, titles: resolveMerchantBookingRuleOptionSets(rule, site.name).title, timeZone: offer.source.kind === "booking" ? offer.source.timeZone : "" } : null };
  const confirmationHash = digest(["member-checkout-on-site-confirmation-v1", identity.principalKey, quote.siteId, quote.offerId, quote.offerRevision,
    quote.resourceKind, quote.title, quote.quantity, quote.currency, quote.grossMinor, quote.discountMinor, quote.dueMinor, quote.couponCount, quote.selected, quote.cancellationPolicy,
    slot ? [slot.key, slot.appointmentAt, slot.timeZone] : null]);
  return { snapshot, offer, siteId, site, now, request, data, document, member: own[0], booking, quote, confirmationHash, tags };
}
export function quoteOnSiteSubmissionSnapshot(snapshot: OnSiteSubmissionSnapshot, identity: CheckoutSelectionQuoteIdentity, principal: CheckoutPrincipal) {
  const c = context(structuredClone(snapshot), structuredClone(identity), structuredClone(principal));
  return { ...c.quote, confirmationHash: c.confirmationHash };
}
export function planOnSiteSubmission(snapshot: OnSiteSubmissionSnapshot, identity: OnSiteSubmissionIdentity, principal: CheckoutPrincipal) {
  identity = structuredClone(identity); principal = structuredClone(principal);
  const c = context(structuredClone(snapshot), identity, principal), { offer, siteId, site, now, data, document, booking, member, quote } = c;
  const request = identity.request;
  if (request.confirmationHash !== c.confirmationHash) return fail("checkout_quote_changed");
  const nowIso = now.toISOString(), deadlines = [now.getTime() + 30_000, Date.parse(site.serviceExpiresAt!)];
  for (const selected of quote.selected) {
    const choice = quote.coupons.find(row => row.couponId === selected.couponId && row.claimEventId === selected.claimEventId);
    if (!choice?.available) return fail("checkout_coupon_unavailable"); if (choice.validUntil !== null) deadlines.push(Date.parse(choice.validUntil));
  }
  let resourceId: string, resource: Record<string, unknown>;
  if (offer.source.kind === "booking" && booking && c.snapshot.booking) {
    const appointmentAt = request.appointmentAt!, rule = resolveMerchantBookingRuleEntry(booking.rules, { bookingBlockId: offer.source.blockId, bookingViewport: offer.checkoutBinding.viewport });
    const supplied = { ...request.customer, customerName: request.customer.name, appointmentAt, store: offer.checkoutBinding.store!, item: offer.checkoutBinding.item! };
    const selected = rule && resolveMerchantBookingRuleSelection(supplied, rule, site.name); if (!selected) return fail("checkout_invalid_customer");
    const editable = { ...supplied, ...selected }; if (validateMerchantBookingInput(editable).length) return fail("checkout_invalid_customer");
    const instant = parseBookingAppointment(appointmentAt, offer.source.timeZone); if (!instant) return fail("checkout_slot_unavailable");
    deadlines.push(instant.getTime() - (booking.workbench.minAdvanceMinutes ?? 0) * 60_000);
    if (booking.workbench.dailyCutoffTime && bookingWallTimeAt(now, offer.source.timeZone).slice(0, 10) === appointmentAt.slice(0, 10)) {
      const cutoff = parseBookingAppointment(`${appointmentAt.slice(0, 10)}T${booking.workbench.dailyCutoffTime}`, offer.source.timeZone);
      if (!cutoff) return fail("checkout_slot_unavailable"); deadlines.push(cutoff.getTime());
    }
    resourceId = buildMerchantBookingId(siteId, now, booking.records.map(row => row.id));
    resource = { generation: c.snapshot.booking.generation, revision: c.snapshot.booking.revision, mailJobs: [], record: {
      id: resourceId, siteId, siteName: site.name, customerAccountId: principal.accountId, customerUserId: principal.userId,
      customerLoginEmail: "", customerGuestHash: "", bookingBlockId: offer.source.blockId, bookingViewport: offer.checkoutBinding.viewport,
      store: editable.store, item: editable.item, title: editable.title, customerName: editable.customerName, email: editable.email, phone: editable.phone, note: editable.note,
      appointmentAt, appointmentTimeZone: offer.source.timeZone, status: "active", createdAt: nowIso, updatedAt: nowIso, merchantTouchedAt: "",
      editToken: randomBytes(18).toString("hex"), customerReminderProcessedMinutes: [], merchantReminderProcessedMinutes: [], checkoutOperationKey: identity.operationKey,
      timeline: [{ id: `checkout-${identity.operationKey}`, actor: "customer", kind: "created", at: nowIso }],
    } };
  } else if (offer.source.kind === "order") {
    const rows = c.snapshot.domainRows.filter(row => row.slug === `__merchant_orders__:${siteId}` || row.slug?.startsWith(`__merchant_orders__:${siteId}:chunk:`));
    const chunks = rows.filter(row => row.slug?.includes(":chunk:")), records = (chunks.length ? chunks : rows).flatMap(row => {
      if (!Array.isArray(row.blocks) || row.blocks.some(order => !object(order) || typeof order.id !== "string")) return fail(); return row.blocks as Array<{ id: string }>;
    });
    if (new Set(records.map(row => row.id)).size !== records.length) return fail();
    const product = data.catalog?.products.find(product => offer.source.kind === "order" && product.id === offer.source.productId); if (!product) return fail("checkout_source_changed");
    resourceId = buildMerchantOrderId(siteId, now, records.map(row => row.id));
    resource = { expectedVersions: rows.map(row => ({ id: row.id, slug: row.slug, updatedAt: row.updated_at })), record: {
      ...createMerchantOrder({ siteId, siteName: site.name, blockId: offer.source.blockId, customerAccountId: principal.accountId, customerUserId: principal.userId,
        customer: request.customer, pricePrefix: "€", items: [{ productId: product.id, code: product.code, name: product.name, description: product.description,
          imageUrl: product.imageUrl, tag: product.tag, quantity: request.selection.quantity, unitPrice: offer.cash!.unitAmountMinor / 100, unitPriceText: "" }] },
      { id: resourceId, createdAt: nowIso, updatedAt: nowIso }), checkoutOperationKey: identity.operationKey,
    } };
  } else return fail();
  const terms = prepareOnSitePendingTerms({ siteId, offer, selection: request.selection, principal, membership: member, coupons: data.coupons, tags: c.tags, now: nowIso, resourceId });
  if (terms.receipt.dueMinor !== quote.dueMinor || terms.receipt.discountMinor !== quote.discountMinor || terms.receipt.couponCount !== quote.couponCount) return fail("checkout_quote_changed");
  const plan = { offer: terms.offer, quantity: request.selection.quantity,
    membership: { id: member.id, expectedUpdatedAt: document("__merchant_memberships__:").updated_at }, settingsVersion: document("__merchant_membership_settings__:").updated_at,
    ...(terms.couponClaims.length ? { coupons: { expectedUpdatedAt: document("__merchant_coupons__:").updated_at, claims: terms.couponClaims } } : {}),
    [offer.source.kind]: resource, receipt: terms.receipt };
  const notAfter = new Date(Math.min(...deadlines)).toISOString(); if (Date.parse(notAfter) <= now.getTime()) return fail("checkout_quote_expired");
  return { plan, notAfter };
}
