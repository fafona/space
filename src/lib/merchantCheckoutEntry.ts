import { buildCheckoutStartHref } from "./merchantCheckoutClient";
import { buildOnSiteCheckoutStartHref } from "./merchantCheckoutOnSiteClient";

export type CheckoutEntryQuery = { siteId: string; kind: "booking" | "order"; blockId: string; viewport: "desktop" | "mobile" };
export type CheckoutEntryOffer = { offerId: string; offerRevision: string; title: string; maxQuantity: number;
  onSiteOnly?: true;
  source: { kind: "booking"; store: string; item: string } | { kind: "order"; productId: string } };
export type CheckoutEntryAccess = { siteId: string; accountId: string; offers: CheckoutEntryOffer[]; recoveryEnabled?: true };
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const id = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9:_-]{1,160}$/.test(v);
const uuid = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v);
const text = (v: unknown): v is string => typeof v === "string" && v.trim() === v && v.length > 0 && v.length <= 200 && !/[\u0000-\u001f\u007f]/u.test(v);
function need(v: unknown): asserts v { if (!v) throw new Error("checkout_entry_invalid"); }
export function parseCheckoutEntryQuery(raw: unknown): CheckoutEntryQuery {
  need(object(raw) && Object.keys(raw).length === 4 && ["siteId", "kind", "blockId", "viewport"].every(k => Object.hasOwn(raw, k)));
  need(typeof raw.siteId === "string" && /^\d{8}$/.test(raw.siteId) && id(raw.blockId)
    && (raw.kind === "booking" || raw.kind === "order") && (raw.viewport === "desktop" || raw.viewport === "mobile"));
  return { siteId: raw.siteId, kind: raw.kind as CheckoutEntryQuery["kind"], blockId: raw.blockId, viewport: raw.viewport as CheckoutEntryQuery["viewport"] };
}
/** Only a visibility/selection hint. Prices, balances, coupons and authority
 * are obtained afresh by preview/submit; this payload cannot authorize a debit. */
export function parseCheckoutEntryAccess(raw: unknown, query: CheckoutEntryQuery): CheckoutEntryAccess | null {
  need(object(raw) && raw.ok === true && Object.hasOwn(raw, "entry"));
  if (raw.entry === null) return null;
  const entry = raw.entry;
  need(object(entry) && entry.siteId === query.siteId && typeof entry.accountId === "string" && /^\d{8}$/.test(entry.accountId)
    && object(entry.query) && JSON.stringify(parseCheckoutEntryQuery(entry.query)) === JSON.stringify(parseCheckoutEntryQuery(query))
    && Array.isArray(entry.offers) && entry.offers.length <= 100 && (entry.recoveryEnabled === undefined || entry.recoveryEnabled === true));
  const sources = new Set<string>(), ids = new Set<string>();
  const offers = entry.offers.map(raw => {
    need(object(raw) && uuid(raw.offerId) && uuid(raw.offerRevision) && text(raw.title) && Number.isSafeInteger(raw.maxQuantity)
      && Number(raw.maxQuantity) >= 1 && Number(raw.maxQuantity) <= 999 && object(raw.source) && raw.source.kind === query.kind && (raw.onSiteOnly === undefined || raw.onSiteOnly === true));
    const source = raw.source.kind === "booking" ? (need(text(raw.source.store) && text(raw.source.item)), { kind: "booking" as const, store: raw.source.store, item: raw.source.item })
      : (need(id(raw.source.productId)), { kind: "order" as const, productId: raw.source.productId });
    const key = JSON.stringify(source); need(!sources.has(key) && !ids.has(raw.offerId)); sources.add(key); ids.add(raw.offerId);
    return { offerId: raw.offerId, offerRevision: raw.offerRevision, title: raw.title, maxQuantity: Number(raw.maxQuantity), source, ...(raw.onSiteOnly === true ? { onSiteOnly: true as const } : {}) };
  });
  return { siteId: entry.siteId, accountId: entry.accountId, offers, ...(entry.recoveryEnabled === true ? { recoveryEnabled: true as const } : {}) };
}
/** Public login/recovery navigation is not membership or purchase authority.
 * It may be offered on a merchant host with no platform login cookie. */
export function parseCheckoutEntryDiscovery(raw: unknown, query: CheckoutEntryQuery) {
  const access = parseCheckoutEntryAccess(raw, query);
  need(object(raw));
  if (raw.recovery !== undefined) need(object(raw.recovery) && Object.keys(raw.recovery).length === 1 && raw.recovery.siteId === query.siteId);
  return { access, recoveryEnabled: raw.recovery !== undefined || access?.recoveryEnabled === true };
}
export function buildCheckoutEntryHref(siteId: string, offer: CheckoutEntryOffer, quantity: number, appointmentAt: string | undefined, locale: string) {
  need(Number.isSafeInteger(quantity) && quantity >= 1 && quantity <= offer.maxQuantity);
  need(offer.source.kind === "booking" ? quantity === 1 && appointmentAt !== undefined : appointmentAt === undefined);
  return (offer.onSiteOnly ? buildOnSiteCheckoutStartHref : buildCheckoutStartHref)({ siteId, offerId: offer.offerId, offerRevision: offer.offerRevision, quantity, ...(appointmentAt !== undefined ? { appointmentAt } : {}) }, locale);
}
