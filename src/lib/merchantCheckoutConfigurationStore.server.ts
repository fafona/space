import { createServerMerchantCheckoutRuntimeClient } from "./merchantCheckoutRuntime.server";
import { assertMerchantCheckoutOffer } from "./merchantCheckoutCatalog";
import { checkoutConfigurationHash, checkoutConfigurationUuid, parseCheckoutConfigurationEdit, checkoutEditFromOffer,
  type CheckoutConfigurationSnapshot, type ConfiguredCheckoutOffer } from "./merchantCheckoutConfiguration";

export type CheckoutConfigurationRpc = { rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }> };
export function parseCheckoutConfigurationSnapshot(raw: unknown, siteId: string): CheckoutConfigurationSnapshot {
  const fail = (): never => { throw new Error("checkout_configuration_unavailable"); };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fail();
  const value = raw as CheckoutConfigurationSnapshot;
  if (value.version !== null && !checkoutConfigurationUuid(value.version) || !Array.isArray(value.offers) || value.offers.length > 100) return fail();
  if (value.version === null && value.offers.length) return fail();
  const ids = new Set<string>();
  for (const offer of value.offers) {
    try {
      assertMerchantCheckoutOffer(offer);
      if (offer.siteId !== siteId || ids.has(offer.id) || typeof offer.couponReturnOnCancel !== "boolean"
        || !offer.checkoutBinding || !checkoutConfigurationHash(offer.checkoutBinding.sourceKey)
        || !["desktop", "mobile"].includes(offer.checkoutBinding.viewport)) return fail();
      parseCheckoutConfigurationEdit(checkoutEditFromOffer(offer));
      ids.add(offer.id);
    } catch { return fail(); }
  }
  return structuredClone({ version: value.version, offers: value.offers });
}
function client() {
  const connection = createServerMerchantCheckoutRuntimeClient();
  if (!connection) throw new Error("checkout_configuration_unavailable");
  return connection as unknown as CheckoutConfigurationRpc;
}
export async function loadCheckoutConfiguration(siteId: string, connection = client()) {
  if (!/^\d{8}$/.test(siteId)) throw new Error("checkout_configuration_invalid");
  const result = await Promise.resolve(connection.rpc("faolla_member_checkout_catalog_snapshot_v1", { p_site_id: siteId }))
    .catch(() => { throw new Error("checkout_configuration_unavailable"); });
  if (result.error) throw new Error("checkout_configuration_unavailable");
  return parseCheckoutConfigurationSnapshot(result.data, siteId);
}
/** Sole configuration write. An ambiguous response is NOT retried; reread the
 * original catalog and reconcile. No direct pages fallback or shared settings
 * writes. RPC is proposal-only and intentionally NOT installed by this code. */
export async function saveCheckoutConfiguration(input: {
  siteId: string; expectedVersion: string | null; nextVersion: string; actorKey: string; offer: ConfiguredCheckoutOffer;
}, connection = client()) {
  if (!/^\d{8}$/.test(input.siteId) || input.expectedVersion !== null && !checkoutConfigurationUuid(input.expectedVersion)
    || !checkoutConfigurationUuid(input.nextVersion) || input.nextVersion === input.expectedVersion
    || !/^owner:[A-Za-z0-9_-]{8,128}$/.test(input.actorKey)) throw new Error("checkout_configuration_invalid");
  assertMerchantCheckoutOffer(input.offer);
  if (input.offer.siteId !== input.siteId) throw new Error("checkout_configuration_invalid");
  const result = await Promise.resolve(connection.rpc("faolla_member_checkout_catalog_save_v1", {
    p_site_id: input.siteId, p_expected_version: input.expectedVersion, p_next_version: input.nextVersion, p_actor_key: input.actorKey, p_offer: input.offer,
  })).catch(() => { throw new Error("checkout_configuration_unconfirmed"); });
  if (result.error) {
    const message = result.error && typeof result.error === "object" ? (result.error as { message?: unknown }).message : "";
    if (message === "checkout_configuration_conflict") throw new Error(message);
    throw new Error("checkout_configuration_unconfirmed");
  }
  const snapshot = parseCheckoutConfigurationSnapshot(result.data, input.siteId);
  if (snapshot.version !== input.nextVersion || snapshot.offers.filter(offer => offer.id === input.offer.id && offer.revision === input.offer.revision).length !== 1) {
    throw new Error("checkout_configuration_unconfirmed");
  }
  return snapshot;
}
