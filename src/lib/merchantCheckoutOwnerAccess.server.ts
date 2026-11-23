import { createHash } from "node:crypto";
import { resolveMerchantBusinessActor, MerchantBusinessAccessError } from "./merchantBusinessActor.server";
import { loadAuthoritativeCurrentMerchantSnapshotSites } from "./publishedMerchantService";
import { getMerchantServiceState } from "./merchantServiceStatus";
import { isMemberCheckoutPilotEnabled } from "./merchantMemberCheckoutPilot.server";

export const checkoutOwnerDependencies = { enabled: isMemberCheckoutPilotEnabled, actor: resolveMerchantBusinessActor,
  site: async (id: string) => (await loadAuthoritativeCurrentMerchantSnapshotSites()).find(s => s.id === id) ?? null };
export type CheckoutOwnerDependencies = typeof checkoutOwnerDependencies;
/** Same owner/permission/service generation as the proven read-only report.
 * UI scope is just an anti-stale hint; authorization is always re-resolved. */
export async function authorizeCheckoutOwner(request: Request, siteId: string, deps: CheckoutOwnerDependencies) {
  const initial = await deps.actor(request, { siteId });
  if (initial.type !== "owner" || initial.siteId !== siteId) throw new MerchantBusinessAccessError("owner_required", 403);
  const ownerSignature = JSON.stringify([initial.authUserId, initial.principalKey, initial.authorizationVersion]);
  const initialSite = await deps.site(siteId);
  if (!initialSite || initialSite.id !== siteId || initialSite.status !== "online" || getMerchantServiceState(initialSite.status, initialSite.serviceExpiresAt).reason !== null) throw new MerchantBusinessAccessError("permission_denied", 403);
  const permissionSignature = JSON.stringify(initialSite.permissionConfig), serviceExpiresAt = initialSite.serviceExpiresAt;
  const identityKey = createHash("sha256").update(JSON.stringify([siteId, ownerSignature, permissionSignature, serviceExpiresAt])).digest("hex");
  const reauthorize = async () => {
    const current = await deps.actor(request, { siteId }), site = await deps.site(siteId);
    if (current.type !== "owner" || current.siteId !== siteId
      || JSON.stringify([current.authUserId, current.principalKey, current.authorizationVersion]) !== ownerSignature
      || !site || site.id !== siteId || site.status !== "online" || getMerchantServiceState(site.status, site.serviceExpiresAt).reason !== null
      || JSON.stringify(site.permissionConfig) !== permissionSignature || site.serviceExpiresAt !== serviceExpiresAt || !deps.enabled(siteId)) throw new MerchantBusinessAccessError("permission_denied", 403);
  };
  return { identityKey, actorKey: initial.principalKey, reauthorize };
}
