import type { MerchantCookieSessionPayload } from "@/lib/authSessionRecovery";

export const FRONTEND_AUTH_BRIDGE_REQUEST = "faolla:frontend-auth-request";
export const FRONTEND_AUTH_BRIDGE_RESPONSE = "faolla:frontend-auth-response";

type FrontendAuthBridgeMessage = {
  type?: unknown;
  requestId?: unknown;
  payload?: unknown;
};

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function parseOrigin(value: unknown): URL | null {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw || raw === "null") return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url;
  } catch {
    return null;
  }
}

function isFaollaHostname(hostname: string) {
  const normalized = hostname.trim().toLowerCase();
  return normalized === "faolla.com" || normalized.endsWith(".faolla.com");
}

function isLocalLikeHostname(hostname: string) {
  const normalized = hostname.trim().toLowerCase();
  return normalized === "localhost" || /^\d+\.\d+\.\d+\.\d+$/.test(normalized);
}

export function isTrustedFrontendAuthBridgeOrigin(origin: unknown, currentOrigin?: string | null) {
  const candidate = parseOrigin(origin);
  if (!candidate) return false;
  const current =
    parseOrigin(currentOrigin) ??
    (typeof window !== "undefined" && window.location?.origin ? parseOrigin(window.location.origin) : null);
  if (!current) return false;
  if (candidate.origin === current.origin) return true;
  if (isFaollaHostname(candidate.hostname) && isFaollaHostname(current.hostname)) return true;
  return isLocalLikeHostname(candidate.hostname) && candidate.hostname === current.hostname;
}

export function normalizeFrontendAuthBridgePayload(input: unknown): MerchantCookieSessionPayload | null {
  const record = readRecord(input);
  if (record?.authenticated !== true) return null;
  const user = readRecord(record.user);
  if (!user) return null;
  const accountType = record.accountType === "personal" ? "personal" : record.accountType === "merchant" ? "merchant" : null;
  const merchantIds = Array.isArray(record.merchantIds)
    ? record.merchantIds.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean)
    : [];

  const frontendAuthProof = typeof record.frontendAuthProof === "string" ? record.frontendAuthProof.trim() : "";
  return {
    authenticated: true,
    accountType,
    accountId: typeof record.accountId === "string" ? record.accountId.trim() || null : null,
    merchantId: typeof record.merchantId === "string" ? record.merchantId.trim() || null : null,
    merchantIds,
    ...(frontendAuthProof ? { frontendAuthProof } : {}),
    user: user as unknown as MerchantCookieSessionPayload["user"],
  };
}

export function requestParentFrontendAuthPayload(timeoutMs = 1400): Promise<MerchantCookieSessionPayload | null> {
  if (typeof window === "undefined" || window.parent === window) return Promise.resolve(null);

  return new Promise((resolve) => {
    const requestId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    let settled = false;
    let timer: number | null = null;

    const finish = (payload: MerchantCookieSessionPayload | null) => {
      if (settled) return;
      settled = true;
      window.removeEventListener("message", handleMessage);
      if (timer !== null) window.clearTimeout(timer);
      resolve(payload);
    };

    const handleMessage = (event: MessageEvent) => {
      if (event.source !== window.parent) return;
      if (!isTrustedFrontendAuthBridgeOrigin(event.origin)) return;
      const message = readRecord(event.data) as FrontendAuthBridgeMessage | null;
      if (!message || message.type !== FRONTEND_AUTH_BRIDGE_RESPONSE || message.requestId !== requestId) return;
      finish(normalizeFrontendAuthBridgePayload(message.payload));
    };

    window.addEventListener("message", handleMessage);
    timer = window.setTimeout(() => finish(null), Math.max(400, timeoutMs));
    window.parent.postMessage(
      {
        type: FRONTEND_AUTH_BRIDGE_REQUEST,
        requestId,
      },
      "*",
    );
  });
}

export function installFrontendAuthBridgeResponder(
  getPayload: () => unknown | Promise<unknown>,
) {
  if (typeof window === "undefined") return () => {};

  const handleMessage = (event: MessageEvent) => {
    if (!isTrustedFrontendAuthBridgeOrigin(event.origin)) return;
    const message = readRecord(event.data) as FrontendAuthBridgeMessage | null;
    if (!message || message.type !== FRONTEND_AUTH_BRIDGE_REQUEST || typeof message.requestId !== "string") return;
    const source = event.source as Window | null;
    if (!source || typeof source.postMessage !== "function") return;

    void Promise.resolve(getPayload())
      .then((payload) => normalizeFrontendAuthBridgePayload(payload))
      .then((payload) => {
        if (!payload) return;
        source.postMessage(
          {
            type: FRONTEND_AUTH_BRIDGE_RESPONSE,
            requestId: message.requestId,
            payload,
          },
          event.origin,
        );
      })
      .catch(() => {
        // The bridge is only a display fallback for embedded pages.
      });
  };

  window.addEventListener("message", handleMessage);
  return () => {
    window.removeEventListener("message", handleMessage);
  };
}
