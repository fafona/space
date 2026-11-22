import { isDeepStrictEqual } from "node:util";
import type { Block } from "@/data/homeBlocks";
import type { MerchantCatalog } from "./merchantCatalog";
import type { ConfiguredCheckoutOffer } from "./merchantCheckoutConfiguration";
import { buildCheckoutSourceChoices } from "./merchantCheckoutSources.server";
import { buildMerchantBookingRulesSnapshot, resolveMerchantBookingRuleEntry, type MerchantBookingRulesSnapshot } from "./merchantBookingRules";
import { getMerchantBookingDateAvailabilityIssue, getMerchantBookingTimeAvailabilityIssue, getMerchantBookingSlotCapacityIssue, type MerchantBookingRecord } from "./merchantBookings";
import { getMerchantBookingAdvanceIssue, getMerchantBookingBufferIssue, getMerchantBookingRecurringIssue, type MerchantBookingWorkbenchSettings } from "./merchantBookingWorkbench";
import { getCustomerBookingTimeIssue, parseBookingAppointment, parseBookingWallTime } from "./merchantBookingTime";
import type { MerchantMembershipSettings } from "./merchantMembershipSettings";

/** Read-only material prepared from actual published/operating sources. This is
 * NOT a slot hold or permission to commit. The submission transaction must CAS
 * the same source, permissions, booking generation and financial snapshots. */
export type CheckoutAvailabilityMaterial = {
  siteId: string; siteName: string; blocks: Block[]; catalog: MerchantCatalog | null;
  bookings: boolean; orders: boolean; settings: MerchantMembershipSettings | null;
  booking: null | { rules: MerchantBookingRulesSnapshot; workbench: MerchantBookingWorkbenchSettings; records: MerchantBookingRecord[] };
};
const fail = (code: string): never => { throw new Error(code); };

export function checkoutSourceIsCurrent(offer: ConfiguredCheckoutOffer, material: CheckoutAvailabilityMaterial) {
  if (offer.siteId !== material.siteId) return false;
  const sources = buildCheckoutSourceChoices({ siteId: material.siteId, siteName: material.siteName,
    blocks: material.blocks, catalog: material.catalog, allowBooking: material.bookings, allowOrder: material.orders });
  const matches = sources.filter(source => source.key === offer.checkoutBinding.sourceKey);
  if (matches.length !== 1) return false;
  const source = matches[0], binding = offer.checkoutBinding;
  if (source.sourceVersion !== binding.sourceVersion || source.kind !== offer.source.kind
    || source.blockId !== offer.source.blockId || source.viewport !== binding.viewport) return false;
  if (source.kind === "booking") return source.store === binding.store && source.item === binding.item;
  return offer.source.kind === "order" && source.collectionId === offer.source.collectionId
    && source.productId === offer.source.productId && source.cashMinor === (offer.cash?.unitAmountMinor ?? null);
}

/** Preserve original booking capacity pools and workbench rules. Group/seat
 * quantity is deliberately not inferred: the old model counts appointments,
 * not attendees. One selected booking is one appointment until that separate
 * business rule is explicitly modelled; product quantity remains supported. */
export function checkoutAvailableQuantity(input: {
  offer: ConfiguredCheckoutOffer; material: CheckoutAvailabilityMaterial; quantity: number;
  appointmentAt?: string; now: Date;
}) {
  const { offer, material, now, quantity } = input;
  if (!checkoutSourceIsCurrent(offer, material)) return fail("checkout_source_changed");
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > offer.maxQuantity || !Number.isFinite(now.getTime())) return fail("checkout_invalid_selection");
  let available = offer.maxQuantity;
  const stockId = offer.checkoutBinding.stockItemId;
  if (stockId) {
    if (material.settings?.siteId !== offer.siteId) return fail("checkout_unavailable");
    const rows = material.settings.redemptionItems.filter(item => item.id === stockId);
    if (rows.length !== 1 || rows[0].enabled !== true || offer.unitPoints !== null && rows[0].pointsCost !== offer.unitPoints) return fail("checkout_source_changed");
    const stock = rows[0].stock;
    if (stock !== null && (!Number.isSafeInteger(stock) || stock < 0)) return fail("checkout_unavailable");
    if (stock !== null) available = Math.min(available, stock);
  }
  if (offer.source.kind === "order") {
    if (input.appointmentAt !== undefined) return fail("checkout_invalid_selection");
    return available;
  }
  if (quantity !== 1) return fail("checkout_booking_quantity_unsupported");
  available = Math.min(available, 1);
  const appointmentAt = input.appointmentAt;
  if (!appointmentAt || parseBookingWallTime(appointmentAt)?.normalized !== appointmentAt) return fail("checkout_invalid_selection");
  const booking = material.booking, binding = { bookingBlockId: offer.source.blockId, bookingViewport: offer.checkoutBinding.viewport };
  if (!booking || booking.rules.siteId !== material.siteId) return fail("checkout_unavailable");
  const publishedRules = buildMerchantBookingRulesSnapshot(material.siteId, material.blocks, "2000-01-01T00:00:00.000Z");
  const publishedRule = resolveMerchantBookingRuleEntry(publishedRules, binding), rule = resolveMerchantBookingRuleEntry(booking.rules, binding);
  // A separately published rule snapshot must agree with the live page. Never
  // silently price one source while reserving against another capacity pool.
  if (!rule || !publishedRule || !isDeepStrictEqual(rule, publishedRule)
    || booking.workbench.timeZone !== offer.source.timeZone) return fail("checkout_source_changed");
  if (getCustomerBookingTimeIssue(appointmentAt, offer.source.timeZone, now)) return fail("checkout_slot_unavailable");
  if (getMerchantBookingDateAvailabilityIssue(appointmentAt.slice(0, 10), rule.blockedDates, rule.holidayDates)
    || getMerchantBookingTimeAvailabilityIssue(appointmentAt.slice(11), rule.availableTimeRanges)
    || getMerchantBookingAdvanceIssue(appointmentAt, booking.workbench, now)
    || getMerchantBookingRecurringIssue(appointmentAt, booking.workbench.recurringRules)) return 0;
  if (new Set(booking.records.map(row => row.id)).size !== booking.records.length) return fail("checkout_unavailable");
  const bound = booking.records.filter(row => row.siteId === material.siteId && row.bookingBlockId === binding.bookingBlockId
    && row.bookingViewport === binding.bookingViewport);
  if (bound.some(row => (row.status === "active" || row.status === "confirmed")
    && !parseBookingAppointment(row.appointmentAt, row.appointmentTimeZone))) return fail("checkout_unavailable");
  if (getMerchantBookingSlotCapacityIssue(appointmentAt, rule.timeSlotRules, bound)
    || getMerchantBookingBufferIssue({ appointmentAt, appointmentTimeZone: offer.source.timeZone,
      store: offer.checkoutBinding.store!, item: offer.checkoutBinding.item! }, booking.workbench.bufferMinutes, bound)) return 0;
  return available;
}
