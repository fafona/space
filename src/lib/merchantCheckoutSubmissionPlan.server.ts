import { createHash, randomBytes } from "node:crypto";
import { parseMemberCheckoutPreviewRequest, parseCheckoutPreviewRows, previewMemberCheckout } from "./merchantCheckoutPreview.server";
import { checkoutPrincipalKey, type CheckoutPrincipal } from "./merchantCheckoutQuote.server";
import { checkoutConfirmationHash } from "./merchantCheckoutConfirmation.server";
import { parseCheckoutConfigurationSnapshot } from "./merchantCheckoutConfigurationStore.server";
import type { ConfiguredCheckoutOffer } from "./merchantCheckoutConfiguration";
import { readPlatformMerchantSnapshotBlocksValidated } from "./platformAdminBackupValidation";
import { pickPublishedPageRow } from "./publishedSiteData";
import { normalizeMerchantBookingRulesSnapshot, resolveMerchantBookingRuleEntry, resolveMerchantBookingRuleSelection } from "./merchantBookingRules";
import { normalizeMerchantBookingWorkbenchSettings } from "./merchantBookingWorkbench";
import { parseBookingAppointment, bookingWallTimeAt } from "./merchantBookingTime";
import { buildMerchantBookingId, validateMerchantBookingInput, type MerchantBookingRecord } from "./merchantBookings";
import { buildMerchantOrderId, createMerchantOrder } from "./merchantOrders";
import { prepareMemberCheckoutAvailablePoints, prepareMemberCheckoutPointDebit } from "./merchantMemberships.server";
import { getUtf8ByteLength } from "./merchantProfileBinding";

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const fail = (code = "checkout_invalid_plan"): never => { throw new Error(code); };
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
type PhysicalRow = { id: string; merchant_id: string | null; slug: string | null; blocks: unknown; updated_at: string; created_at?: string | null };
export type CheckoutSubmissionSnapshot = {
  version: 2; siteId: string; operationKey: string; principalKey: string; requestHash: string; databaseNow: string;
  offer: ConfiguredCheckoutOffer; sourceRows: PhysicalRow[]; domainRows: PhysicalRow[];
  booking: null | { generation: string; revision: string; rows: PhysicalRow[] };
};
export function parseCheckoutSubmissionRequest(raw: unknown) {
  if (!object(raw) || Object.keys(raw).some(key => !["siteId", "offerId", "offerRevision", "quantity", "appointmentAt", "couponClaims", "nonce", "confirmationHash", "method", "customer"].includes(key))
    || raw.method !== "points" || typeof raw.nonce !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(raw.nonce)
    || typeof raw.confirmationHash !== "string" || !/^[a-f0-9]{64}$/.test(raw.confirmationHash) || !object(raw.customer)) return fail("checkout_invalid_request");
  const customer = raw.customer, fields = ["name", "title", "email", "phone", "note"] as const;
  if (Object.keys(customer).length !== fields.length || fields.some(key => typeof customer[key] !== "string"
    || customer[key] !== (customer[key] as string).trim()
    || (key === "note" ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u : /[\u0000-\u001f\u007f]/u).test(customer[key] as string))) return fail("checkout_invalid_request");
  const limits = { name: 40, title: 160, email: 320, phone: 80, note: 100 };
  if (fields.some(key => getUtf8ByteLength(customer[key] as string) > limits[key]) || !customer.name || !customer.phone
    || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email as string)) return fail("checkout_invalid_request");
  const { nonce, confirmationHash, method, customer: _customer, ...selection } = raw; void _customer;
  const preview = parseMemberCheckoutPreviewRequest(selection);
  return { ...preview, nonce: nonce.toLowerCase(), confirmationHash, method, customer: customer as Record<typeof fields[number], string> };
}
export function checkoutSubmissionIdentity(raw: unknown, principal: CheckoutPrincipal) {
  const request = parseCheckoutSubmissionRequest(structuredClone(raw)), principalKey = checkoutPrincipalKey(principal);
  return { siteId: request.siteId, principalKey,
    operationKey: checkoutSubmissionRecoveryIdentity({ siteId: request.siteId, nonce: request.nonce }, principal).operationKey,
    requestHash: digest(["points", request.selection, request.appointmentAt ?? null, request.confirmationHash,
      request.customer.name, request.customer.title, request.customer.email, request.customer.phone, request.customer.note]), request };
}
export type CheckoutSubmissionIdentity = ReturnType<typeof checkoutSubmissionIdentity>;
/** Read-only selection context. Deliberately lacks nonce, customer and a
 * confirmation hash, so a cart quote is not a financial submission identity. */
export type CheckoutSelectionQuoteIdentity = Pick<CheckoutSubmissionIdentity, "siteId" | "principalKey" | "operationKey" | "requestHash"> & {
  request: Pick<CheckoutSubmissionIdentity["request"], "selection" | "appointmentAt">;
};

/** Recovery needs only the locally retained nonce, never browser-selected
 * financial totals or a principal supplied in a URL/body. Absence of a result
 * is NOT evidence that an in-flight original submission cannot still commit. */
export function checkoutSubmissionRecoveryIdentity(raw: unknown, principal: CheckoutPrincipal) {
  if (!object(raw) || Object.keys(raw).length !== 2 || typeof raw.siteId !== "string" || !/^[0-9]{8}$/.test(raw.siteId)
    || typeof raw.nonce !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(raw.nonce)) return fail("checkout_invalid_request");
  const principalKey = checkoutPrincipalKey(principal);
  return { siteId: raw.siteId, principalKey, operationKey: digest(["member-checkout-v2", raw.siteId, principalKey, raw.nonce.toLowerCase()]) };
}

export function parseCheckoutSubmissionSnapshot(raw: unknown, identity: CheckoutSelectionQuoteIdentity): CheckoutSubmissionSnapshot {
  if (!object(raw) || raw.version !== 2 || typeof raw.databaseNow !== "string" || !Number.isFinite(Date.parse(raw.databaseNow))) return fail();
  for (const key of ["siteId", "principalKey", "operationKey", "requestHash"] as const) if (raw[key] !== identity[key]) return fail();
  const rows = (value: unknown, tenant: boolean) => {
    if (!Array.isArray(value) || value.some(row => !object(row) || typeof row.id !== "string" || !/^[a-f0-9-]{36}$/i.test(row.id)
      || typeof row.updated_at !== "string" || !Number.isFinite(Date.parse(row.updated_at)) || row.slug !== null && typeof row.slug !== "string"
      || tenant && row.merchant_id !== identity.siteId) || new Set(value.map(row => row.id)).size !== value.length) return fail();
    return value as PhysicalRow[];
  };
  const offer = parseCheckoutConfigurationSnapshot({ version: identity.request.selection.offerRevision, offers: [raw.offer] }, identity.siteId).offers[0];
  if (offer.id !== identity.request.selection.offerId || offer.revision !== identity.request.selection.offerRevision || !offer.enabled) return fail("checkout_quote_changed");
  const sourceRows = rows(raw.sourceRows, false), domainRows = rows(raw.domainRows, true);
  if (sourceRows.some(row => !(row.merchant_id === null && row.slug === "__platform_merchant_snapshot__")
    && !(row.merchant_id === identity.siteId && (row.slug === null || !row.slug.startsWith("__") || row.slug === `__merchant_catalog__:${identity.siteId}`)))) return fail();
  if (domainRows.some(row => !["__merchant_memberships__:", "__merchant_membership_settings__:", "__merchant_coupons__:", "__merchant_orders__:"].some(prefix => row.slug === prefix + identity.siteId)
    && !new RegExp(`^__merchant_orders__:${identity.siteId}:chunk:[0-9]+$`).test(row.slug ?? ""))) return fail();
  let booking: CheckoutSubmissionSnapshot["booking"] = null;
  if (offer.source.kind === "booking") {
    if (!object(raw.booking) || typeof raw.booking.generation !== "string" || !/^[a-f0-9-]{36}$/i.test(raw.booking.generation)
      || typeof raw.booking.revision !== "string" || !/^\d{1,19}$/.test(raw.booking.revision)) return fail();
    // Original booking rows intentionally omit merchant_id. Their exact raw
    // CAS vector must remain intact, not be rebuilt with tenant assumptions.
    const value = raw.booking.rows;
    if (!Array.isArray(value) || value.some(row => !object(row) || typeof row.id !== "string" || typeof row.slug !== "string" || !Object.hasOwn(row, "blocks"))) return fail();
    booking = { generation: raw.booking.generation, revision: raw.booking.revision, rows: value as PhysicalRow[] };
  } else if (raw.booking !== null) return fail();
  return structuredClone({ version: 2, siteId: identity.siteId, operationKey: identity.operationKey, principalKey: identity.principalKey,
    requestHash: identity.requestHash, databaseNow: raw.databaseNow, offer, sourceRows, domainRows, booking });
}

/** No I/O or writes. Only raw database snapshots enter this planner; selection
 * previews, browser prices and arbitrary member identities are not accepted. */
async function prepareCheckoutSubmissionContext(snapshot: CheckoutSubmissionSnapshot, identity: CheckoutSelectionQuoteIdentity, principal: CheckoutPrincipal) {
  if (checkoutPrincipalKey(principal) !== identity.principalKey) return fail("checkout_unauthorized");
  snapshot = parseCheckoutSubmissionSnapshot(structuredClone(snapshot), identity);
  const offer = snapshot.offer, now = new Date(snapshot.databaseNow), nowIso = now.toISOString(), siteId = snapshot.siteId;
  const roots = snapshot.sourceRows.filter(row => row.slug === "__platform_merchant_snapshot__" && row.merchant_id === null);
  if (roots.length !== 1 || !Array.isArray(roots[0].blocks)) return fail("checkout_unavailable");
  const platform = readPlatformMerchantSnapshotBlocksValidated(roots[0].blocks);
  const sites = platform?.snapshot.filter(site => site.id === siteId) ?? [];
  if (sites.length !== 1) return fail("checkout_module_unavailable");
  const site = sites[0], published = pickPublishedPageRow(snapshot.sourceRows.filter(row => row.merchant_id === siteId && !row.slug?.startsWith("__")));
  if (!published || !Array.isArray(published.blocks)) return fail("checkout_source_changed");
  const data = parseCheckoutPreviewRows(siteId, [...snapshot.domainRows.filter(row => !row.slug?.startsWith("__merchant_orders__:")),
    ...snapshot.sourceRows.filter(row => row.slug === `__merchant_catalog__:${siteId}`)]);
  const document = (prefix: string) => {
    const rows = snapshot.domainRows.filter(row => row.slug === prefix + siteId);
    if (rows.length !== 1) return fail("checkout_unavailable"); return rows[0];
  };
  const memberRow = document("__merchant_memberships__:"); document("__merchant_membership_settings__:");
  const own = data.memberships.filter(member => Boolean(member.accountId || member.userId)
    && (!member.accountId || member.accountId === principal.accountId) && (!member.userId || member.userId === principal.userId));
  if (own.length !== 1 || own[0].status !== "active" || !data.settings || offer.unitPoints === null
    || !site.permissionConfig?.allowMembershipManagement || !site.permissionConfig.allowPointsRedemption) return fail("checkout_membership_unavailable");
  const original = own[0], rawOriginal = (memberRow.blocks as Array<Record<string, unknown>>).find(member => member.id === original.id)!;
  if (rawOriginal.growthValue !== original.growthValue || rawOriginal.levelId !== original.levelId
    || new Set(original.transactions.map(tx => tx.id)).size !== original.transactions.length) return fail("checkout_membership_unavailable");
  for (const tx of original.transactions) {
    const rawTx = (rawOriginal.transactions as Array<Record<string, unknown>>).find(row => row.id === tx.id);
    if (!rawTx || (["id", "type", "status", "pointDelta", "balanceDelta", "growthDelta", "operatorId"] as const).some(key => rawTx[key] !== tx[key])) return fail("checkout_membership_unavailable");
  }
  const bookingDocument = (slug: string) => {
    const rows = snapshot.booking?.rows.filter(row => row.slug === slug) ?? [];
    if (rows.length !== 1 || !object(rows[0].blocks) || rows[0].blocks.version !== 1) return fail("checkout_unavailable"); return rows[0].blocks;
  };
  let booking = null;
  if (offer.source.kind === "booking") {
    const rules = bookingDocument("__merchant_booking_rules__:v1"), workbench = bookingDocument("__merchant_booking_workbench__:v1"), records = bookingDocument("__merchant_booking_records__:v1");
    if (!object(rules.snapshots) || !object(workbench.settingsBySiteId) || !object(workbench.settingsBySiteId[siteId]) || !Array.isArray(records.records)) return fail();
    const selectedRules = normalizeMerchantBookingRulesSnapshot(rules.snapshots[siteId]); if (!selectedRules) return fail();
    booking = { rules: selectedRules, workbench: normalizeMerchantBookingWorkbenchSettings(workbench.settingsBySiteId[siteId]), records: records.records as MerchantBookingRecord[] };
  }
  const request = identity.request;
  const selection = { siteId, offerId: offer.id, offerRevision: offer.revision, quantity: request.selection.quantity,
    ...(request.appointmentAt ? { appointmentAt: request.appointmentAt } : {}), ...(request.selection.couponClaims ? { couponClaims: request.selection.couponClaims } : {}) };
  const preview = await previewMemberCheckout({ request: selection, authorize: async () => principal }, {
    enabled: () => true, sites: async () => [site], configuration: async () => ({ version: offer.revision, offers: [offer] }),
    published: async () => ({ siteId, slug: published.slug ?? "", blocks: published.blocks as never, orderManagementEnabled: true }),
    data: async () => data, booking: async () => { if (!booking) return fail(); return booking; }, now: () => now,
  });
  return { snapshot, offer, now, nowIso, siteId, site, data, document, original, booking, request, preview };
}
export async function quoteCheckoutSubmissionSnapshot(snapshot: CheckoutSubmissionSnapshot, identity: CheckoutSelectionQuoteIdentity, principal: CheckoutPrincipal) {
  identity = structuredClone(identity); principal = structuredClone(principal);
  const { preview } = await prepareCheckoutSubmissionContext(snapshot, identity, principal);
  return { ...preview, confirmationHash: checkoutConfirmationHash(preview.quote, principal, preview.slot) };
}
export async function planCheckoutSubmission(snapshot: CheckoutSubmissionSnapshot, identity: CheckoutSubmissionIdentity, principal: CheckoutPrincipal) {
  identity = structuredClone(identity); principal = structuredClone(principal);
  const { snapshot: stableSnapshot, offer, now, nowIso, siteId, site, data, document, original, booking, preview } = await prepareCheckoutSubmissionContext(snapshot, identity, principal);
  const request = identity.request;
  snapshot = stableSnapshot;
  if (!data.settings || offer.unitPoints === null) return fail("checkout_membership_unavailable");
  const memberRow = document("__merchant_memberships__:"), settingsRow = document("__merchant_membership_settings__:");
  if (checkoutConfirmationHash(preview.quote, principal, preview.slot) !== request.confirmationHash) return fail("checkout_quote_changed");
  const option = preview.quote.options.find(option => option.method === "points");
  if (!option?.available || option.totalPoints === null) return fail("checkout_insufficient_points");
  const couponCount = option.couponCount ?? 0, available = prepareMemberCheckoutAvailablePoints({ membership: original, settings: data.settings,
    now: nowIso, unitPoints: offer.unitPoints, quantity: request.selection.quantity });
  const debit = prepareMemberCheckoutPointDebit({ original, prepared: available.membership, settings: data.settings,
    points: option.totalPoints, couponCount, ...principal, operationKey: identity.operationKey, now: nowIso, title: offer.title });
  const plan: Record<string, unknown> = { offer: { id: offer.id, revision: offer.revision }, settingsVersion: settingsRow.updated_at,
    membership: { ...debit.mutation, expectedUpdatedAt: memberRow.updated_at } };
  if (offer.checkoutBinding.stockItemId) plan.stock = { expectedUpdatedAt: settingsRow.updated_at,
    deltas: [{ itemId: offer.checkoutBinding.stockItemId, quantity: request.selection.quantity }] };
  if (couponCount > 0) {
    plan.couponReturnOnCancel = offer.couponReturnOnCancel;
    plan.coupons = { expectedUpdatedAt: document("__merchant_coupons__:").updated_at, claims: request.selection.couponClaims };
  }
  const deadlines = [now.getTime() + 30_000], midnight = new Date(now); midnight.setHours(24, 0, 0, 0); deadlines.push(midnight.getTime());
  // Time-based eligibility can change without any source/member CAS change.
  // Carry the earliest service/selected-claim expiry through lock waits too.
  deadlines.push(Date.parse(site.serviceExpiresAt!));
  for (const selected of request.selection.couponClaims ?? []) {
    const choice = preview.quote.coupons?.points.find(choice => choice.couponId === selected.couponId && choice.claimEventId === selected.claimEventId);
    if (!choice?.available) return fail("checkout_coupon_unavailable");
    if (choice.validUntil !== null) deadlines.push(Date.parse(choice.validUntil));
  }
  if (!data.settings.pointsRules.pointsNeverExpire && data.settings.pointsRules.pointsValidDays > 0) {
    for (const tx of original.transactions) if (tx.status === "completed" && tx.pointDelta > 0) {
      const expiry = Date.parse(tx.at) + data.settings.pointsRules.pointsValidDays * 86_400_000;
      if (expiry > now.getTime()) deadlines.push(expiry);
    }
  }
  let resourceId: string;
  if (offer.source.kind === "booking" && booking && snapshot.booking) {
    const appointmentAt = request.appointmentAt!, rule = resolveMerchantBookingRuleEntry(booking.rules, { bookingBlockId: offer.source.blockId, bookingViewport: offer.checkoutBinding.viewport });
    const supplied = { ...request.customer, customerName: request.customer.name, appointmentAt, store: offer.checkoutBinding.store!, item: offer.checkoutBinding.item! };
    const selected = rule && resolveMerchantBookingRuleSelection(supplied, rule, site.name);
    if (!selected) return fail("checkout_invalid_customer");
    const editable = { ...supplied, ...selected };
    if (validateMerchantBookingInput(editable).length) return fail("checkout_invalid_customer");
    const instant = parseBookingAppointment(appointmentAt, offer.source.timeZone); if (!instant) return fail("checkout_slot_unavailable");
    deadlines.push(instant.getTime() - (booking.workbench.minAdvanceMinutes ?? 0) * 60_000);
    if (booking.workbench.dailyCutoffTime && bookingWallTimeAt(now, offer.source.timeZone).slice(0, 10) === appointmentAt.slice(0, 10)) {
      const cutoff = parseBookingAppointment(`${appointmentAt.slice(0, 10)}T${booking.workbench.dailyCutoffTime}`, offer.source.timeZone);
      if (!cutoff) return fail("checkout_slot_unavailable"); deadlines.push(cutoff.getTime());
    }
    resourceId = buildMerchantBookingId(siteId, now, booking.records.map(row => row.id));
    plan.booking = { generation: snapshot.booking.generation, revision: snapshot.booking.revision, mailJobs: [], record: {
      id: resourceId, siteId, siteName: site.name, customerAccountId: principal.accountId, customerUserId: principal.userId,
      customerLoginEmail: "", customerGuestHash: "", bookingBlockId: offer.source.blockId, bookingViewport: offer.checkoutBinding.viewport,
      store: editable.store, item: editable.item, title: editable.title, customerName: editable.customerName, email: editable.email, phone: editable.phone, note: editable.note,
      appointmentAt, appointmentTimeZone: offer.source.timeZone, status: "active", createdAt: nowIso, updatedAt: nowIso, merchantTouchedAt: "",
      editToken: randomBytes(18).toString("hex"), customerReminderProcessedMinutes: [], merchantReminderProcessedMinutes: [],
      checkoutOperationKey: identity.operationKey, timeline: [{ id: `checkout-${identity.operationKey}`, actor: "customer", kind: "created", at: nowIso }],
    } };
  } else if (offer.source.kind === "order") {
    const orderRows = snapshot.domainRows.filter(row => row.slug === `__merchant_orders__:${siteId}` || row.slug?.startsWith(`__merchant_orders__:${siteId}:chunk:`));
    const chunks = orderRows.filter(row => row.slug?.includes(":chunk:")), records = (chunks.length ? chunks : orderRows).flatMap(row => {
      if (!Array.isArray(row.blocks) || row.blocks.some(order => !object(order) || typeof order.id !== "string")) return fail(); return row.blocks as Array<{ id: string }>;
    });
    if (new Set(records.map(row => row.id)).size !== records.length) return fail();
    const product = data.catalog?.products.find(product => offer.source.kind === "order" && product.id === offer.source.productId); if (!product) return fail("checkout_source_changed");
    resourceId = buildMerchantOrderId(siteId, now, records.map(row => row.id));
    const record = createMerchantOrder({ siteId, siteName: site.name, blockId: offer.source.blockId, customerAccountId: principal.accountId, customerUserId: principal.userId,
      customer: request.customer, pricePrefix: "€", items: [{ productId: product.id, code: product.code, name: product.name, description: product.description,
        imageUrl: product.imageUrl, tag: product.tag, quantity: request.selection.quantity, unitPrice: 0, unitPriceText: "" }] }, { id: resourceId, createdAt: nowIso, updatedAt: nowIso });
    plan.order = { expectedVersions: orderRows.map(row => ({ id: row.id, slug: row.slug, updatedAt: row.updated_at })),
      record: { ...record, checkoutOperationKey: identity.operationKey } };
  } else return fail();
  plan.receipt = { version: 1, resourceKind: offer.source.kind, resourceId, totalPoints: option.totalPoints, couponCount };
  const notAfter = new Date(Math.min(...deadlines)).toISOString();
  if (Date.parse(notAfter) <= now.getTime()) return fail("checkout_quote_expired");
  return { plan, notAfter };
}
