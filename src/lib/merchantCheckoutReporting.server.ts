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
    return parseCheckoutReportingSnapshot(result.data, scope);
  } catch { throw new Error("checkout_reporting_unavailable"); }
}
