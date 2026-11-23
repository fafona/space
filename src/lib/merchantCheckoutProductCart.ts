import { parseCartClientSelection, type CartClientOriginal, type CartClientSelection } from "./merchantCheckoutCartReview";
import type { CheckoutEntryAccess } from "./merchantCheckoutEntry";
import type { CheckoutCustomerDraft } from "./merchantCheckoutClient";
export type ProductCheckoutDraftLine = { productId: string; quantity: number; checked: boolean };
export type ProductCheckoutDraft = { items: ProductCheckoutDraftLine[]; customer: CheckoutCustomerDraft };
/** Selection hints only: never accepts browser prices, member IDs or balances.
 * Missing/ambiguous bindings fail the WHOLE selection, not just that line. */
export function productCartCheckoutSelection(siteId: string, access: CheckoutEntryAccess, items: ProductCheckoutDraftLine[]): CartClientSelection {
  if (access.siteId !== siteId || !/^\d{8}$/.test(access.accountId) || !Array.isArray(items)) throw new Error("checkout_invalid_cart");
  const chosen = items.filter(l => l.checked);
  if (!chosen.length || chosen.length > 20 || new Set(items.map(l => l.productId)).size !== items.length) throw new Error("checkout_invalid_cart");
  const offers = chosen.map(l => {
    const matches = access.offers.filter(o => o.source.kind === "order" && o.source.productId === l.productId);
    if (matches.length !== 1 || !Number.isSafeInteger(l.quantity) || l.quantity < 1 || l.quantity > matches[0].maxQuantity) throw new Error("checkout_source_changed");
    return { line: l, offer: matches[0] };
  });
  return parseCartClientSelection({ siteId, method: offers.some(o => o.offer.onSiteOnly) ? "on_site" : "points",
    lines: offers.map(({ line, offer }) => ({ offerId: offer.offerId.toLowerCase(), offerRevision: offer.offerRevision.toLowerCase(), quantity: line.quantity, couponClaims: [] })) });
}
/** Only an explicitly acknowledged fresh, open original may consume precisely
 * the frozen checked lines. Recovery/closed/unrelated originals preserve the
 * draft. Any intervening cart edit fails rather than deleting newer items. */
export function productCartAfterAcknowledgement<T extends ProductCheckoutDraftLine>(current: T[], frozen: T[], selection: CartClientSelection,
  original: CartClientOriginal, fresh: boolean): T[] {
  if (!fresh || original.kind !== "cart" || original.result.closed) return current;
  const r = original.result;
  if (r.reviewRequired || r.siteId !== selection.siteId || JSON.stringify(current) !== JSON.stringify(frozen)) throw new Error("checkout_cart_changed");
  const chosen = frozen.filter(l => l.checked), remaining = new Map(selection.lines.map(l => [l.offerId, l]));
  if (r.lines.length !== chosen.length || remaining.size !== chosen.length) throw new Error("checkout_cart_changed");
  for (const l of r.lines) {
    const offer = remaining.get(l.offerId), matches = chosen.filter(c => c.productId === l.productId);
    if (!offer || offer.offerRevision !== l.offerRevision || offer.quantity !== l.quantity || matches.length !== 1 || matches[0].quantity !== l.quantity) throw new Error("checkout_cart_changed");
    remaining.delete(l.offerId);
  }
  if (remaining.size) throw new Error("checkout_cart_changed");
  const ids = new Set(chosen.map(l => l.productId)); return current.filter(l => !ids.has(l.productId));
}
/** Strict write/readback used ONLY by the new integration. The original
 * best-effort legacy draft writer is deliberately not changed. */
export function persistProductCheckoutDraft(storage: Pick<Storage, "getItem" | "setItem">, key: string, expected: string | null, next: string) {
  if (!key.startsWith("merchant-space:product-cart:v1:") || !next || new TextEncoder().encode(next).length > 1_048_576) throw new Error("checkout_storage_unavailable");
  try {
    if (storage.getItem(key) !== expected) throw new Error("checkout_cart_changed");
    storage.setItem(key, next); if (storage.getItem(key) !== next) throw new Error("checkout_storage_unavailable");
  } catch (error) { if (error instanceof Error && error.message === "checkout_cart_changed") throw error; throw new Error("checkout_storage_unavailable"); }
}
