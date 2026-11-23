import { parseMemberCheckoutResult, type MemberCheckoutResult } from "./merchantMemberCheckoutResult";
import { parseOnSiteCheckoutResult, type OnSiteCheckoutResult } from "./merchantCheckoutOnSiteResult";
export type CheckoutOriginalResult = { method: "points"; result: MemberCheckoutResult } | { method: "on_site"; result: OnSiteCheckoutResult };
export function parseCheckoutOriginalResult(raw: unknown, scope: { siteId: string; operationKey: string }): CheckoutOriginalResult {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("checkout_invalid_response");
  const value = raw as Record<string, unknown>;
  if (value.method === "points") return { method: "points", result: parseMemberCheckoutResult(value.result, scope) };
  if (value.method === "on_site") return { method: "on_site", result: parseOnSiteCheckoutResult(value.result, scope) };
  throw new Error("checkout_invalid_response");
}
