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

function getLocalStorage() {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function getBridgeStorages() {
  const storages = [getSessionStorage(), getLocalStorage()].filter((storage, index, list): storage is Storage => {
    return Boolean(storage) && list.indexOf(storage) === index;
  });
  return storages;
}

function readBridgeRecord(): MerchantSignInBridgeRecord | null {
  for (const storage of getBridgeStorages()) {
    try {
      const raw = storage.getItem(MERCHANT_SIGN_IN_BRIDGE_KEY);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as Partial<MerchantSignInBridgeRecord> | null;
      const merchantId = String(parsed?.merchantId ?? "").trim();
      const expiresAt = Number(parsed?.expiresAt ?? 0);
      if (!merchantId || !Number.isFinite(expiresAt)) {
        storage.removeItem(MERCHANT_SIGN_IN_BRIDGE_KEY);
        continue;
      }
      if (Date.now() > expiresAt) {
        storage.removeItem(MERCHANT_SIGN_IN_BRIDGE_KEY);
        continue;
      }
      return { merchantId, expiresAt };
    } catch {
      // Ignore malformed bridge storage and keep checking other storages.
    }
  }
  return null;
}

export function setMerchantSignInBridge(merchantId: string, ttlMs = MERCHANT_SIGN_IN_BRIDGE_TTL_MS) {
  const normalizedMerchantId = String(merchantId ?? "").trim();
  const storages = getBridgeStorages();
  if (!normalizedMerchantId || storages.length === 0) return false;
  const payload = JSON.stringify({
    merchantId: normalizedMerchantId,
    expiresAt: Date.now() + Math.max(30_000, ttlMs),
  } satisfies MerchantSignInBridgeRecord);
  let stored = false;
  for (const storage of storages) {
    try {
      storage.setItem(MERCHANT_SIGN_IN_BRIDGE_KEY, payload);
      stored = true;
    } catch {
      // Ignore bridge storage write failures and keep trying other storages.
    }
  }
  return stored;
}

export function hasMerchantSignInBridge(merchantId: string) {
  const record = readBridgeRecord();
  return Boolean(record && record.merchantId === String(merchantId ?? "").trim());
}

export function clearMerchantSignInBridge(merchantId?: string) {
  const storages = getBridgeStorages();
  if (storages.length === 0) return;
  if (!merchantId) {
    for (const storage of storages) {
      try {
        storage.removeItem(MERCHANT_SIGN_IN_BRIDGE_KEY);
      } catch {
        // ignore cleanup failures
      }
    }
    return;
  }
  const record = readBridgeRecord();
  if (!record) return;
  if (record.merchantId !== String(merchantId ?? "").trim()) return;
  for (const storage of storages) {
    try {
      storage.removeItem(MERCHANT_SIGN_IN_BRIDGE_KEY);
    } catch {
      // ignore cleanup failures
    }
  }
}
