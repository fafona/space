import { createServerSupabaseServiceClient } from "./superAdminServer";
import { parseCheckoutReportingRequest, parseCheckoutReportingSnapshot, type CheckoutReportingRequest } from "./merchantCheckoutReporting";
import type { MemberCheckoutResultRpc } from "./merchantMemberCheckoutResult.server";

function rpc(): MemberCheckoutResultRpc {
  const client = createServerSupabaseServiceClient();
  if (!client) throw new Error("checkout_reporting_unavailable");
  return (name, args) => client.rpc(name, args).abortSignal(AbortSignal.timeout(12_000));
}
/** A single read-only SQL statement. No normalizer/legacy/JSON fallback, no
 * implicit unpaid status on an unavailable ledger, and no automatic writes. */
export async function readCheckoutReporting(input: CheckoutReportingRequest, call?: MemberCheckoutResultRpc) {
  const scope = parseCheckoutReportingRequest(input);
  try {
    const result = await (call ?? rpc())("faolla_member_checkout_reporting_v1", { p_site_id: scope.siteId, p_resources: scope.resources });
    if (result.error) throw new Error("unavailable");
    const snapshot = parseCheckoutReportingSnapshot(result.data, scope);
    if (snapshot.version !== 1) throw new Error("invalid"); return snapshot;
  } catch { throw new Error("checkout_reporting_unavailable"); }
}
/** Separate opt-in mixed projection. Never fall back to a points-only result
 * if cash cannot be read; an unavailable ledger is not proof of nonpayment. */
export async function readMixedCheckoutReporting(input: CheckoutReportingRequest, call?: MemberCheckoutResultRpc) {
  const scope = parseCheckoutReportingRequest(input);
  try { const result = await (call ?? rpc())("faolla_member_checkout_reporting_v2", { p_site_id: scope.siteId, p_resources: scope.resources });
    if (result.error) throw new Error("unavailable"); const snapshot = parseCheckoutReportingSnapshot(result.data, scope);
    if (snapshot.version !== 2) throw new Error("invalid"); return snapshot;
  } catch { throw new Error("checkout_reporting_unavailable"); }
}
/** One version-three projection, including old singles. Never retry an older
 * report on failure: it cannot safely classify an unknown cart receipt. */
export async function readCartCheckoutReporting(input: CheckoutReportingRequest, call?: MemberCheckoutResultRpc) {
  const scope = parseCheckoutReportingRequest(input);
  try { const result = await (call ?? rpc())("faolla_member_checkout_reporting_v3", { p_site_id: scope.siteId, p_resources: scope.resources });
    if (result.error) throw new Error("unavailable"); const snapshot = parseCheckoutReportingSnapshot(result.data, scope);
    if (snapshot.version !== 3) throw new Error("invalid"); return snapshot;
  } catch { throw new Error("checkout_reporting_unavailable"); }
}
