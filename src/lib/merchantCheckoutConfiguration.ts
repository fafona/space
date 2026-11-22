import { assertMerchantCheckoutOffer, type MerchantCheckoutOffer } from "./merchantCheckoutCatalog";

export type CheckoutSourceChoice = {
  key: string; sourceVersion: string; title: string; kind: "booking" | "order"; viewport: "desktop" | "mobile";
  blockId: string; store?: string; item?: string; collectionId?: string; productId?: string;
  // Existing product cash prices are read-only here, not browser overrides.
  cashMinor: number | null;
};
export type CheckoutBinding = {
  sourceKey: string; sourceVersion: string; viewport: "desktop" | "mobile"; store?: string; item?: string;
  stockItemId: string | null; voucherCouponIds: string[]; durationMinutes: number | null;
  pointsReturnOnCancel: boolean; cancellationAdvanceMinutes: number;
};
export type ConfiguredCheckoutOffer = MerchantCheckoutOffer & { checkoutBinding: CheckoutBinding };
export type CheckoutConfigurationSnapshot = { version: string | null; offers: ConfiguredCheckoutOffer[] };
export type CheckoutConfigurationOptions = {
  sources: CheckoutSourceChoice[];
  defaultTimeZone?: string; countryCode?: string; canPoints?: boolean; canCoupons?: boolean;
  stockItems: Array<{ id: string; title: string; points: number | null }>;
  vouchers: Array<{ id: string; title: string; kind: "product_voucher" | "exchange_voucher" | "ticket_voucher" }>;
};
export type CheckoutConfigurationEdit = {
  offerId: string | null; sourceKey: string; sourceVersion: string; title: string; enabled: boolean;
  cashMinor: number | null; unitPoints: number | null; allowOnSite: boolean; maxQuantity: number;
  timeZone: string; stockItemId: string | null; voucherCouponIds: string[]; durationMinutes: number | null;
  pointsReturnOnCancel: boolean; couponReturnOnCancel: boolean; cancellationAdvanceMinutes: number;
};
export const checkoutConfigurationUuid = (value: unknown): value is string => typeof value === "string"
  && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
export const checkoutConfigurationHash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const key = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9:_-]{1,160}$/.test(value);
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
function need(value: unknown, code = "checkout_configuration_invalid"): asserts value { if (!value) throw new Error(code); }
function integer(value: unknown, min: number, max: number): value is number { return Number.isSafeInteger(value) && Number(value) >= min && Number(value) <= max; }

/** Merchant changes only NEW self-checkout settings. It never edits legacy
 * products, published booking choices, points rules, stock or existing orders. */
export function parseCheckoutConfigurationEdit(raw: unknown): CheckoutConfigurationEdit {
  const fields = ["offerId", "sourceKey", "sourceVersion", "title", "enabled", "cashMinor", "unitPoints", "allowOnSite", "maxQuantity",
    "timeZone", "stockItemId", "voucherCouponIds", "durationMinutes", "pointsReturnOnCancel", "couponReturnOnCancel", "cancellationAdvanceMinutes"];
  need(object(raw) && Object.keys(raw).length === fields.length && fields.every(field => Object.hasOwn(raw, field))
    && Object.keys(raw).every(field => fields.includes(field)));
  need(raw.offerId === null || checkoutConfigurationUuid(raw.offerId));
  need(checkoutConfigurationHash(raw.sourceKey) && checkoutConfigurationHash(raw.sourceVersion));
  need(typeof raw.title === "string" && raw.title === raw.title.trim() && raw.title.length > 0 && raw.title.length <= 200 && !/[\u0000-\u001f\u007f]/u.test(raw.title));
  need([raw.enabled, raw.allowOnSite, raw.pointsReturnOnCancel, raw.couponReturnOnCancel].every(value => typeof value === "boolean"));
  need(raw.cashMinor === null || integer(raw.cashMinor, 1, 99_999_999));
  need(raw.unitPoints === null || integer(raw.unitPoints, 1, 99_999_999));
  need(raw.cashMinor !== null || raw.unitPoints !== null);
  need(!raw.allowOnSite || raw.cashMinor !== null);
  need(integer(raw.maxQuantity, 1, 999) && integer(raw.cancellationAdvanceMinutes, 0, 43_200));
  need(typeof raw.timeZone === "string" && raw.timeZone.length < 100);
  need(raw.stockItemId === null || key(raw.stockItemId));
  need(raw.durationMinutes === null || integer(raw.durationMinutes, 1, 1440));
  need(Array.isArray(raw.voucherCouponIds) && raw.voucherCouponIds.length <= 20 && raw.voucherCouponIds.every(key)
    && new Set(raw.voucherCouponIds).size === raw.voucherCouponIds.length);
  return structuredClone(raw) as CheckoutConfigurationEdit;
}

export function buildConfiguredCheckoutOffer(input: {
  siteId: string; edit: unknown; current: CheckoutConfigurationSnapshot; options: CheckoutConfigurationOptions;
  newId: string; newRevision: string;
}): ConfiguredCheckoutOffer {
  const edit = parseCheckoutConfigurationEdit(input.edit);
  need(/^\d{8}$/.test(input.siteId) && checkoutConfigurationUuid(input.newId) && checkoutConfigurationUuid(input.newRevision));
  const matches = input.options.sources.filter(source => source.key === edit.sourceKey);
  need(matches.length === 1 && matches[0].sourceVersion === edit.sourceVersion, "checkout_source_changed");
  const source = matches[0], existing = edit.offerId ? input.current.offers.filter(offer => offer.id === edit.offerId) : [];
  need(!edit.offerId || existing.length === 1 && existing[0].siteId === input.siteId, "checkout_offer_not_found");
  // A stable offer cannot silently become a different product/service.
  need(!existing.length || existing[0].checkoutBinding.sourceKey === edit.sourceKey, "checkout_source_rebinding_forbidden");
  need(!input.current.offers.some(offer => offer.id !== edit.offerId && offer.checkoutBinding.sourceKey === edit.sourceKey), "checkout_source_already_configured");
  need(input.current.offers.length < 100 || existing.length === 1, "checkout_configuration_limit");
  need(!edit.stockItemId || input.options.stockItems.filter(item => item.id === edit.stockItemId).length === 1, "checkout_stock_binding_unavailable");
  if (edit.stockItemId && edit.unitPoints !== null) need(input.options.stockItems.find(item => item.id === edit.stockItemId)!.points === edit.unitPoints, "checkout_stock_price_changed");
  for (const id of edit.voucherCouponIds) {
    const rows = input.options.vouchers.filter(voucher => voucher.id === id);
    need(rows.length === 1 && (source.kind === "order" ? rows[0].kind === "product_voucher" : rows[0].kind !== "product_voucher"), "checkout_voucher_binding_unavailable");
    need(rows[0].kind !== "ticket_voucher" || edit.durationMinutes !== null, "checkout_duration_required");
  }
  if (source.kind === "order") need(edit.cashMinor === source.cashMinor, "checkout_source_price_changed");
  const offer: ConfiguredCheckoutOffer = {
    version: 1, id: edit.offerId ?? input.newId, revision: input.newRevision, siteId: input.siteId,
    enabled: edit.enabled, title: edit.title, maxQuantity: edit.maxQuantity,
    source: source.kind === "booking" ? { kind: "booking", blockId: source.blockId, serviceId: edit.offerId ?? input.newId, timeZone: edit.timeZone }
      : { kind: "order", blockId: source.blockId, collectionId: source.collectionId!, productId: source.productId! },
    cash: edit.cashMinor === null ? null : { currency: "eur", unitAmountMinor: edit.cashMinor, initialPolicy: { mode: "full" } },
    unitPoints: edit.unitPoints, allowOnSite: edit.allowOnSite, couponReturnOnCancel: edit.couponReturnOnCancel,
    checkoutBinding: { sourceKey: source.key, sourceVersion: source.sourceVersion, viewport: source.viewport,
      ...(source.kind === "booking" ? { store: source.store!, item: source.item! } : {}), stockItemId: edit.stockItemId,
      voucherCouponIds: [...edit.voucherCouponIds].sort(), durationMinutes: edit.durationMinutes,
      pointsReturnOnCancel: edit.pointsReturnOnCancel, cancellationAdvanceMinutes: edit.cancellationAdvanceMinutes },
  };
  assertMerchantCheckoutOffer(offer);
  return offer;
}

export function checkoutEditFromOffer(offer: ConfiguredCheckoutOffer): CheckoutConfigurationEdit {
  return { offerId: offer.id, sourceKey: offer.checkoutBinding.sourceKey, sourceVersion: offer.checkoutBinding.sourceVersion, title: offer.title,
    enabled: offer.enabled, cashMinor: offer.cash?.unitAmountMinor ?? null, unitPoints: offer.unitPoints, allowOnSite: offer.allowOnSite,
    maxQuantity: offer.maxQuantity, timeZone: offer.source.kind === "booking" ? offer.source.timeZone : "UTC",
    stockItemId: offer.checkoutBinding.stockItemId, voucherCouponIds: [...offer.checkoutBinding.voucherCouponIds],
    durationMinutes: offer.checkoutBinding.durationMinutes, pointsReturnOnCancel: offer.checkoutBinding.pointsReturnOnCancel,
    cancellationAdvanceMinutes: offer.checkoutBinding.cancellationAdvanceMinutes,
    couponReturnOnCancel: offer.couponReturnOnCancel! };
}
