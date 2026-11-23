import { createHash } from "node:crypto";
import type { MerchantListPublishedSite } from "@/data/homeBlocks";
import { createServerSupabaseServiceClient } from "./superAdminServer";
import { loadAuthoritativeCurrentMerchantSnapshotSites } from "./publishedMerchantService";
import { fetchPublishedSiteBlocksFromSupabase } from "./publishedSiteData";
import { getMerchantServiceState } from "./merchantServiceStatus";
import { parseStrictMerchantCatalog, type MerchantCatalog } from "./merchantCatalog";
import { normalizeMerchantMembershipRecord, type MerchantMembershipRecord } from "./merchantMemberships";
import { normalizeMerchantMembershipSettings, type MerchantMembershipSettings } from "./merchantMembershipSettings";
import { normalizeMerchantCouponRecord, type MerchantCouponRecord } from "./merchantCoupons";
import { normalizeMerchantBookingRulesSnapshot, resolveMerchantBookingRuleEntry, resolveMerchantBookingRuleOptionSets } from "./merchantBookingRules";
import { normalizeMerchantBookingWorkbenchSettings } from "./merchantBookingWorkbench";
import type { MerchantBookingRecord } from "./merchantBookings";
import { readAtomicBookingSnapshot, isAtomicBookingStorageEnabled } from "./merchantBookingAtomicRuntime.server";
import { loadCheckoutConfiguration } from "./merchantCheckoutConfigurationStore.server";
import { parseMerchantCheckoutSelection } from "./merchantCheckoutCatalog";
import { parseBookingWallTime } from "./merchantBookingTime";
import { checkoutAvailableQuantity, checkoutSourceIsCurrent, type CheckoutAvailabilityMaterial } from "./merchantCheckoutAvailability.server";
import { isMemberCheckoutPilotEnabled } from "./merchantMemberCheckoutPilot.server";
import { prepareMemberCheckoutAvailablePoints } from "./merchantMemberships.server";
import { MerchantCheckoutError, quoteMerchantCheckout, type CheckoutPrincipal } from "./merchantCheckoutQuote.server";

const fail = (code = "checkout_unavailable"): never => { throw new Error(code); };
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
export function parseMemberCheckoutPreviewRequest(raw: unknown) {
  if (!object(raw) || Object.keys(raw).some(key => !["siteId", "offerId", "offerRevision", "quantity", "couponClaims", "appointmentAt"].includes(key))
    || typeof raw.siteId !== "string" || !/^\d{8}$/.test(raw.siteId)) return fail("checkout_invalid_selection");
  const appointmentAt = raw.appointmentAt;
  if (appointmentAt !== undefined && (typeof appointmentAt !== "string" || parseBookingWallTime(appointmentAt)?.normalized !== appointmentAt)) return fail("checkout_invalid_selection");
  // A reproducible selection label, NOT a signed ticket or reservation. A later
  // submit must prepare and atomically revalidate the underlying wall time.
  const slotKey = appointmentAt === undefined ? undefined : createHash("sha256").update(JSON.stringify([raw.siteId, raw.offerId, raw.offerRevision, appointmentAt])).digest("hex");
  const selection = parseMerchantCheckoutSelection({ offerId: raw.offerId, offerRevision: raw.offerRevision, quantity: raw.quantity,
    ...(raw.couponClaims !== undefined ? { couponClaims: raw.couponClaims } : {}), ...(slotKey ? { slotKey } : {}) });
  return { siteId: raw.siteId, selection, appointmentAt: appointmentAt as string | undefined };
}
export type CheckoutPreviewData = { catalog: MerchantCatalog | null; settings: MerchantMembershipSettings | null;
  memberships: MerchantMembershipRecord[]; coupons: MerchantCouponRecord[] };

const previewSlugs = (siteId: string) => ["__merchant_catalog__:", "__merchant_membership_settings__:", "__merchant_memberships__:", "__merchant_coupons__:"].map(prefix => prefix + siteId);
export function parseCheckoutPreviewRows(siteId: string, rows: unknown): CheckoutPreviewData {
  const slugs = previewSlugs(siteId);
  if (!/^\d{8}$/.test(siteId) || !Array.isArray(rows) || rows.some(row => !object(row) || row.merchant_id !== siteId || !slugs.includes(String(row.slug)))
    || new Set(rows.map(row => row.slug)).size !== rows.length) return fail();
  const raw = (prefix: string) => rows.find(row => row.slug === prefix + siteId)?.blocks as unknown;
  const catalogRaw = raw("__merchant_catalog__:"); let catalog: MerchantCatalog | null = null;
  if (catalogRaw !== undefined) {
    if (!object(catalogRaw) || catalogRaw.kind !== "merchant_catalog" || catalogRaw.siteId !== siteId) return fail();
    catalog = parseStrictMerchantCatalog(catalogRaw.catalog); if (!catalog) return fail();
  }
  const settingsRaw = raw("__merchant_membership_settings__:");
  if (settingsRaw !== undefined && (!object(settingsRaw) || settingsRaw.siteId !== siteId)) return fail();
  const settings = settingsRaw === undefined ? null : normalizeMerchantMembershipSettings(siteId, settingsRaw);
  if (settingsRaw !== undefined && object(settingsRaw) && settingsRaw.redemptionItems !== undefined) {
    const items = settingsRaw.redemptionItems;
    if (!Array.isArray(items) || items.length !== settings!.redemptionItems.length
      || new Set(items.map(item => object(item) ? item.id : undefined)).size !== items.length) return fail();
    for (const item of items) {
      if (!object(item)) return fail();
      const normalized = settings!.redemptionItems.find(value => value.id === item.id);
      // Missing/corrupt stock must not normalize into unlimited stock. A changed
      // price or enabled flag also cannot become a usable display quote.
      if (!normalized || item.stock !== normalized.stock || item.pointsCost !== normalized.pointsCost || item.enabled !== normalized.enabled) return fail();
    }
  }
  const membersRaw = raw("__merchant_memberships__:") ?? [], couponsRaw = raw("__merchant_coupons__:") ?? [];
  if (!Array.isArray(membersRaw) || !Array.isArray(couponsRaw)) return fail();
  const memberships = membersRaw.map(raw => {
    const value = normalizeMerchantMembershipRecord(raw);
    if (!value || !object(raw) || value.siteId !== siteId || raw.id !== value.id || raw.status !== value.status
      || raw.accountId !== value.accountId || raw.userId !== value.userId || raw.pointBalance !== value.pointBalance
      || !Array.isArray(raw.transactions) || value.transactions.length !== raw.transactions.length) return fail();
    return value;
  });
  const coupons = couponsRaw.map(raw => {
    const value = normalizeMerchantCouponRecord(raw);
    if (!value || !object(raw) || value.siteId !== siteId || raw.id !== value.id || raw.status !== value.status
      || !Array.isArray(raw.claimEvents) || !Array.isArray(raw.redeemEvents)
      || value.claimEvents.length !== raw.claimEvents.length || value.redeemEvents.length !== raw.redeemEvents.length) return fail();
    return value;
  });
  if (new Set(memberships.map(row => row.id)).size !== memberships.length || new Set(coupons.map(row => row.id)).size !== coupons.length) return fail();
  return { catalog, settings, memberships, coupons };
}
/** Fresh reads only: intentionally avoid the old catalog recovery, scheduled
 * member awards, metadata wallet, shadow mirroring and local JSON fallbacks. */
async function readPreviewData(siteId: string): Promise<CheckoutPreviewData> {
  const client = createServerSupabaseServiceClient();
  if (!client) return fail();
  const response = await client.from("pages").select("slug,merchant_id,blocks").eq("merchant_id", siteId).in("slug", previewSlugs(siteId)).abortSignal(AbortSignal.timeout(10_000));
  if (response.error) return fail();
  return parseCheckoutPreviewRows(siteId, response.data);
}
async function readPreviewBooking(siteId: string): Promise<NonNullable<CheckoutAvailabilityMaterial["booking"]>> {
  if (!isAtomicBookingStorageEnabled()) return fail();
  const snapshot = await readAtomicBookingSnapshot();
  const raw = (slug: string) => {
    const rows = snapshot.rows.filter(row => row.slug === slug);
    if (rows.length !== 1 || !object(rows[0].blocks) || rows[0].blocks.version !== 1) return fail();
    return rows[0].blocks as Record<string, unknown>;
  };
  const rulesRaw = raw("__merchant_booking_rules__:v1"), workbenchRaw = raw("__merchant_booking_workbench__:v1"), recordsRaw = raw("__merchant_booking_records__:v1");
  if (!object(rulesRaw.snapshots) || !object(workbenchRaw.settingsBySiteId) || !object(workbenchRaw.settingsBySiteId[siteId]) || !Array.isArray(recordsRaw.records)) return fail();
  const rules = normalizeMerchantBookingRulesSnapshot(rulesRaw.snapshots[siteId]);
  if (!rules || rules.siteId !== siteId || recordsRaw.records.some(row => !object(row) || typeof row.id !== "string" || typeof row.siteId !== "string"
    || !["active", "confirmed", "completed", "no_show", "cancelled"].includes(String(row.status)))) return fail();
  return { rules, workbench: normalizeMerchantBookingWorkbenchSettings(workbenchRaw.settingsBySiteId[siteId]), records: recordsRaw.records as MerchantBookingRecord[] };
}
const defaults = { enabled: isMemberCheckoutPilotEnabled, sites: loadAuthoritativeCurrentMerchantSnapshotSites, configuration: loadCheckoutConfiguration,
  published: (siteId: string) => fetchPublishedSiteBlocksFromSupabase(siteId, { fresh: true }),
  data: readPreviewData, booking: readPreviewBooking, now: () => new Date() };
export type MemberCheckoutPreviewDependencies = typeof defaults;

/** Real read adapters behind the disabled pilot. This function has NO write
 * ports and cannot create a booking, debit points, consume coupons or contact
 * Stripe. Its display quote is deliberately not a financial commit token. */
export async function previewMemberCheckout(input: { request: unknown; authorize: () => Promise<CheckoutPrincipal | null> }, overrides: Partial<MemberCheckoutPreviewDependencies> = {}) {
  try {
    const deps = { ...defaults, ...overrides }, request = parseMemberCheckoutPreviewRequest(structuredClone(input.request));
    if (!deps.enabled(request.siteId)) return fail("checkout_disabled");
    const sites = await deps.sites(), matching = sites.filter(site => site.id === request.siteId);
    if (matching.length !== 1) return fail("checkout_module_unavailable");
    const site: MerchantListPublishedSite = matching[0], permissions = site.permissionConfig;
    if (getMerchantServiceState(site.status, site.serviceExpiresAt, deps.now().getTime()).reason !== null) return fail("checkout_module_unavailable");
    const config = await deps.configuration(request.siteId), offers = config.offers.filter(offer => offer.id === request.selection.offerId);
    if (offers.length !== 1 || !offers[0].enabled || offers[0].siteId !== request.siteId) return fail("checkout_offer_not_found");
    const offer = structuredClone(offers[0]);
    if (offer.revision !== request.selection.offerRevision) return fail("checkout_quote_changed");
    const bookings = permissions?.allowBookingBlock === true;
    const orders = permissions?.allowProductBlock === true && permissions.allowOrderManagement === true;
    const points = permissions?.allowMembershipManagement === true && permissions.allowPointsRedemption === true;
    const coupons = permissions?.allowMembershipManagement === true && permissions.allowCouponModule === true;
    if (!(offer.source.kind === "booking" ? bookings : orders)) return fail("checkout_module_unavailable");
    const [published, data, booking] = await Promise.all([deps.published(request.siteId), deps.data(request.siteId), offer.source.kind === "booking" ? deps.booking(request.siteId) : null]);
    if (!published || published.siteId !== request.siteId) return fail("checkout_source_changed");
    const now = deps.now(), material: CheckoutAvailabilityMaterial = { siteId: request.siteId, siteName: site.name, blocks: published.blocks, catalog: data.catalog,
      bookings, orders, settings: data.settings, booking };
    if (!checkoutSourceIsCurrent(offer, material)) return fail("checkout_source_changed");
    const quote = await quoteMerchantCheckout({ siteId: request.siteId, selection: request.selection, authorize: input.authorize, now: () => now.getTime(), repository: {
      pilot: async () => ({ enabled: deps.enabled(request.siteId), bookings, orders, points, coupons, onlinePayments: false }),
      offer: async () => structuredClone(offer), sourceVisible: async () => checkoutSourceIsCurrent(offer, material),
      availability: async () => ({ available: checkoutAvailableQuantity({ offer, material, quantity: request.selection.quantity, appointmentAt: request.appointmentAt, now }) }),
      ownMembership: async (_site, principal) => {
        const own = data.memberships.filter(row => row.siteId === request.siteId && Boolean(row.accountId || row.userId)
          && (!row.accountId || row.accountId === principal.accountId) && (!row.userId || row.userId === principal.userId));
        if (own.length > 1) return fail("checkout_membership_unavailable");
        const member = own[0]; if (!member || member.status !== "active") return null;
        if (!data.settings || data.settings.siteId !== request.siteId) return fail();
        const prepared = offer.unitPoints === null ? null : prepareMemberCheckoutAvailablePoints({ membership: member, settings: data.settings,
          now: now.toISOString(), unitPoints: offer.unitPoints, quantity: request.selection.quantity });
        return { id: member.id, siteId: member.siteId, accountId: member.accountId, userId: member.userId, status: member.status,
          pointBalance: prepared?.spendablePoints ?? member.pointBalance, unitPoints: prepared?.unitPoints ?? null };
      },
      coupons: async () => ({ rows: data.coupons, tags: offer.source.kind === "order"
        ? [data.catalog?.products.find(row => offer.source.kind === "order" && row.id === offer.source.productId)?.tag ?? ""].filter(Boolean) : [],
        voucherCouponIds: offer.checkoutBinding.voucherCouponIds, ...(offer.checkoutBinding.durationMinutes !== null ? { durationMinutes: offer.checkoutBinding.durationMinutes } : {}) }),
      onlineReadiness: async () => fail(),
    } });
    let bookingForm: { store: string; item: string; titles: string[]; timeZone: string } | null = null;
    if (offer.source.kind === "booking") {
      const entry = booking && resolveMerchantBookingRuleEntry(booking.rules, { bookingBlockId: offer.source.blockId, bookingViewport: offer.checkoutBinding.viewport });
      if (!entry) return fail("checkout_source_changed");
      bookingForm = { store: offer.checkoutBinding.store!, item: offer.checkoutBinding.item!,
        titles: resolveMerchantBookingRuleOptionSets(entry, site.name).title, timeZone: offer.source.timeZone };
    }
    const cancellationPolicy = { returnPoints: offer.checkoutBinding.pointsReturnOnCancel,
      returnCoupons: offer.couponReturnOnCancel ?? null, advanceMinutes: offer.checkoutBinding.cancellationAdvanceMinutes };
    return { quote, bookingForm, cancellationPolicy, slot: request.appointmentAt && offer.source.kind === "booking" ? {
      key: request.selection.slotKey!, appointmentAt: request.appointmentAt, timeZone: offer.source.timeZone, reserved: false as const } : null };
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    const allowed = ["checkout_disabled", "checkout_invalid_selection", "checkout_quote_changed", "checkout_offer_not_found", "checkout_source_changed",
      "checkout_module_unavailable", "checkout_quantity_unavailable", "checkout_slot_unavailable", "checkout_booking_quantity_unsupported", "checkout_identity_changed",
      "checkout_coupon_unavailable", "checkout_invalid_coupon_selection", "checkout_membership_unavailable"];
    throw new MerchantCheckoutError(allowed.includes(code) ? code : "checkout_unavailable", code === "checkout_disabled" || !allowed.includes(code) ? 503
      : ["checkout_invalid_selection", "checkout_invalid_coupon_selection"].includes(code) ? 400 : code === "checkout_offer_not_found" ? 404 : code === "checkout_module_unavailable" ? 403 : 409);
  }
}
