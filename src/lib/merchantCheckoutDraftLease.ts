/** In-process lease for a callback already held by the common checkout Web
 * Lock. It is neither an auth token nor serializable/reusable after release.
 * Production callers must acquire the native account/site lock first. */
export type CheckoutDraftLease = { readonly key: string };
/** Synchronous local durability check, not server authority. It must neither
 * rewrite a draft nor yield between the final check and nonce release. */
export type CheckoutDraftReleaseCheck = (lease: CheckoutDraftLease) => undefined;
const live = new WeakSet<object>();
export async function withCheckoutDraftLease<T>(key: string, run: (lease: CheckoutDraftLease) => Promise<T>): Promise<T> {
  const lease = Object.freeze({ key }); live.add(lease);
  try { return await run(lease); } finally { live.delete(lease); }
}
export function assertCheckoutDraftLease(lease: CheckoutDraftLease | undefined, key: string) {
  if (!lease || lease.key !== key || !live.has(lease)) throw new Error("checkout_draft_lock_required");
}
