import { CheckoutClientError, type CheckoutClientRequest } from "./merchantCheckoutClient";

/** Deliberately separate from the purchase/intent transport. Account ID is a
 * consistency hint only; the server derives and rechecks the real principal. */
export function checkoutHistoryPendingTransport(accountId: string): CheckoutClientRequest {
  if (!/^\d{8}$/.test(accountId)) throw new CheckoutClientError("checkout_unauthorized");
  return async (path, body, signal) => {
    if (path !== "/api/member-checkout/history/pending") throw new CheckoutClientError("checkout_invalid_request");
    const response = await fetch(path, { method: "POST", credentials: "same-origin", cache: "no-store", signal,
      headers: { "content-type": "application/json", accept: "application/json", "x-checkout-account-scope": accountId }, body: JSON.stringify(body) });
    const value: unknown = await response.json().catch(() => null);
    if (!response.ok || !value || typeof value !== "object" || !("ok" in value) || value.ok !== true || !("readOnly" in value) || value.readOnly !== true)
      throw new CheckoutClientError("checkout_intent_unavailable", response.status);
    return value;
  };
}
