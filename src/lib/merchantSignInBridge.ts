"use client";

const MERCHANT_SIGN_IN_BRIDGE_KEY = "merchant-signin-bridge";
const MERCHANT_SIGN_IN_BRIDGE_TTL_MS = 5 * 60 * 1000;

type MerchantSignInBridgeRecord = {
  merchantId: string;
  expiresAt: number;
};

function getSessionStorage() {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function readBridgeRecord(): MerchantSignInBridgeRecord | null {
  const storage = getSessionStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(MERCHANT_SIGN_IN_BRIDGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<MerchantSignInBridgeRecord> | null;
    const merchantId = String(parsed?.merchantId ?? "").trim();
    const expiresAt = Number(parsed?.expiresAt ?? 0);
    if (!merchantId || !Number.isFinite(expiresAt)) {
      storage.removeItem(MERCHANT_SIGN_IN_BRIDGE_KEY);
      return null;
    }
    if (Date.now() > expiresAt) {
      storage.removeItem(MERCHANT_SIGN_IN_BRIDGE_KEY);
      return null;
    }
    return { merchantId, expiresAt };
  } catch {
    return null;
  }
}

export function setMerchantSignInBridge(merchantId: string, ttlMs = MERCHANT_SIGN_IN_BRIDGE_TTL_MS) {
  const normalizedMerchantId = String(merchantId ?? "").trim();
  const storage = getSessionStorage();
  if (!normalizedMerchantId || !storage) return false;
  try {
    storage.setItem(
      MERCHANT_SIGN_IN_BRIDGE_KEY,
      JSON.stringify({
        merchantId: normalizedMerchantId,
        expiresAt: Date.now() + Math.max(30_000, ttlMs),
      } satisfies MerchantSignInBridgeRecord),
    );
    return true;
  } catch {
    return false;
  }
}

export function hasMerchantSignInBridge(merchantId: string) {
  const record = readBridgeRecord();
  return Boolean(record && record.merchantId === String(merchantId ?? "").trim());
}

export function clearMerchantSignInBridge(merchantId?: string) {
  const storage = getSessionStorage();
  if (!storage) return;
  if (!merchantId) {
    try {
      storage.removeItem(MERCHANT_SIGN_IN_BRIDGE_KEY);
    } catch {
      // ignore cleanup failures
    }
    return;
  }
  const record = readBridgeRecord();
  if (!record) return;
  if (record.merchantId !== String(merchantId ?? "").trim()) return;
  try {
    storage.removeItem(MERCHANT_SIGN_IN_BRIDGE_KEY);
  } catch {
    // ignore cleanup failures
  }
}
