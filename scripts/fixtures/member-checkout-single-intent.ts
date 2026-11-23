// Synthetic data only. No database, live sessions or provider IO.
import { checkoutResumeFixture } from "./member-checkout-resume";
import type { CheckoutClientSelection } from "../../src/lib/merchantCheckoutClient";
export async function singleIntentFixture(method: "points" | "on_site" = "points") {
  const x = await checkoutResumeFixture(method === "points" ? "single_points" : "single_on_site");
  const selection: CheckoutClientSelection = { siteId: x.siteId, offerId: "11111111-1111-4111-8111-111111111111", offerRevision: "22222222-2222-4222-8222-222222222222", quantity: 1, appointmentAt: "2030-01-01T12:00", couponClaims: [] };
  const customer = { name: "Synthetic", title: "Mx", email: "synthetic@example.invalid", phone: "000000000", note: "Original note" };
  const form = { store: "Synthetic", item: "Play", titles: ["Mx"], timeZone: "Europe/Madrid" }, slot = { key: "synthetic-slot", appointmentAt: selection.appointmentAt, timeZone: form.timeZone, reserved: false };
  const pointsPreview = { ok: true, confirmationHash: "b".repeat(64), quote: { version: 1, siteId: x.siteId, offerId: selection.offerId, offerRevision: selection.offerRevision,
    quantity: 1, title: "Synthetic play", resourceKind: "booking", ownPointBalance: 500, reservationCreated: false, cashTotalMinor: 1000, totalPoints: 100,
    options: [{ method: "points", available: true, totalPoints: 100, couponCount: 0 }] }, bookingForm: form, slot, cancellationPolicy: { returnPoints: true, returnCoupons: false, advanceMinutes: 0 } };
  const cashPreview = { ok: true, quote: { version: 1, method: "on_site", siteId: x.siteId, offerId: selection.offerId, offerRevision: selection.offerRevision, quantity: 1,
    title: "Synthetic play", resourceKind: "booking", reservationCreated: false, capturedMinor: 0, totalPoints: null, grossMinor: 1000, discountMinor: 0, dueMinor: 1000,
    couponCount: 0, confirmationHash: "b".repeat(64), selected: [], coupons: [], cancellationPolicy: { returnCoupons: false, advanceMinutes: 0 }, bookingForm: form, slot } };
  return { ...x, selection, customer, pointsPreview, cashPreview, nonce: "33333333-3333-4333-8333-333333333333" };
}
