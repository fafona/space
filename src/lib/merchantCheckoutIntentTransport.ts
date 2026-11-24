import { CheckoutClientError, type CheckoutClientRequest } from "./merchantCheckoutClient";
/** Account is only a consistency hint; HTTP rechecks the actual session. */
export function checkoutIntentTransport(accountId: string): CheckoutClientRequest {
  if (!/^\d{8}$/.test(accountId)) throw new CheckoutClientError("checkout_unauthorized");
  return async (path, body, signal) => {
    if (!/^\/api\/member-checkout\/(?:intent\/(?:pending|review|acknowledge|retained-review|register-retained)|cart\/(?:preview|submit|recover|result|cancel))$/.test(path)) throw new CheckoutClientError("checkout_invalid_request");
    const response = await fetch(path, { method: "POST", credentials: "same-origin", cache: "no-store", signal,
      headers: { "content-type": "application/json", accept: "application/json", "x-checkout-account-scope": accountId }, body: JSON.stringify(body) });
    const value: unknown = await response.json().catch(() => null);
    if (!value || typeof value !== "object" || !("ok" in value) || value.ok !== true || !response.ok)
      throw new CheckoutClientError(value && typeof value === "object" && "error" in value && typeof value.error === "string" ? value.error : "checkout_unconfirmed", response.status);
    return value;
  };
}
