// Synthetic only. The server-derived operation binds this fixture's nonce and
// principal; the independent pending snapshot deliberately has another key.
import { checkoutResumeFixture } from "./member-checkout-resume";
import { checkoutSubmissionRecoveryIdentity } from "../../src/lib/merchantCheckoutSubmissionPlan.server";
import { checkoutHistoryRecoveryReference, type CheckoutHistoryRecovery } from "../../src/lib/merchantCheckoutHistoryRecovery";
export async function historyRecoveryFixture(kind: Parameters<typeof checkoutResumeFixture>[0] = "cart_points") {
  const x = await checkoutResumeFixture(kind), nonce = "33333333-3333-4333-8333-333333333333", principal = { accountId: x.accountId, userId: x.userId };
  const identity = checkoutSubmissionRecoveryIdentity({ siteId: x.siteId, nonce }, principal), original = structuredClone(x.original);
  if (original.kind === "cart") { original.result.operationKey = identity.operationKey; original.result.resourceId += "_retained"; }
  else { original.original.result.operationKey = identity.operationKey;
    if (original.original.method === "points") original.original.result.resourceId += "_retained"; else original.original.result.terms.resourceId += "_retained";
  }
  const recovery: CheckoutHistoryRecovery = { version: 1, siteId: x.siteId, operationKey: identity.operationKey, original, reviewRequired: false };
  const reference = await checkoutHistoryRecoveryReference(x.siteId, x.accountId, nonce);
  return { ...x, nonce, principal, identity, recovery, reference, envelope: { ok: true, readOnly: true, reference, recovery } };
}
