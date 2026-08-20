import type { MerchantCookieSessionPayload } from "@/lib/authSessionRecovery";

export const FRONTEND_AUTH_BRIDGE_REQUEST = "faolla:frontend-auth-request";
export const FRONTEND_AUTH_BRIDGE_RESPONSE = "faolla:frontend-auth-response";

export function isTrustedFrontendAuthBridgeOrigin(
  origin: unknown,
  currentOrigin?: string | null,
) {
  void origin;
  void currentOrigin;
  return false;
}

export function isDirectFrontendAuthBridgeChild(
  source: MessageEventSource | null,
  ownerWindow?: Pick<Window, "frames"> | null,
) {
  void source;
  void ownerWindow;
  return false;
}

export function normalizeFrontendAuthBridgePayload(
  input: unknown,
): MerchantCookieSessionPayload | null {
  void input;
  return null;
}

export function requestParentFrontendAuthPayload(
  timeoutMs = 1400,
): Promise<MerchantCookieSessionPayload | null> {
  void timeoutMs;
  return Promise.resolve(null);
}

export function installFrontendAuthBridgeResponder(
  getPayload: () => unknown | Promise<unknown>,
) {
  void getPayload;
  // Cross-window session/PII transport stays disabled until an explicit,
  // origin-isolated capability exchange is designed and reviewed.
  return () => {};
}
