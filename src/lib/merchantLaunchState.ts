export const RECENT_MERCHANT_LAUNCH_STORAGE_KEY = "merchant-space:recent-merchant-launch:v1";
export const RECENT_MERCHANT_LAUNCH_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

type RecentMerchantLaunchRecord = {
  merchantId: string;
  updatedAt: number;
};

function normalizeMerchantId(value: string | null | undefined) {
  const normalized = String(value ?? "").trim();
  return /^\d{8}$/.test(normalized) ? normalized : "";
}

function getLaunchStorages() {
  if (typeof window === "undefined") return [];
  const storages: Storage[] = [];
  for (const candidate of [window.sessionStorage, window.localStorage]) {
    if (!candidate || storages.includes(candidate)) continue;
    try {
      const probeKey = "__merchant_launch_state_probe__";
      candidate.setItem(probeKey, "1");
      candidate.removeItem(probeKey);
      storages.push(candidate);
    } catch {
      // Ignore unavailable browser storage backends.
    }
  }
  return storages;
}

function normalizeLaunchRecord(input: unknown, maxAgeMs: number): RecentMerchantLaunchRecord | null {
  if (!input || typeof input !== "object") return null;
  const record = input as Partial<RecentMerchantLaunchRecord>;
  const merchantId = normalizeMerchantId(record.merchantId);
  const updatedAt = Number(record.updatedAt ?? 0);
  if (!merchantId || !Number.isFinite(updatedAt) || updatedAt <= 0) return null;
  if (Date.now() - updatedAt > Math.max(60_000, maxAgeMs)) return null;
  return {
    merchantId,
    updatedAt,
  };
}

export function persistRecentMerchantLaunchState(merchantId: string, updatedAt = Date.now()) {
  const normalizedMerchantId = normalizeMerchantId(merchantId);
  const storages = getLaunchStorages();
  if (!normalizedMerchantId || storages.length === 0) return false;

  const payload = JSON.stringify({
    merchantId: normalizedMerchantId,
    updatedAt,
  } satisfies RecentMerchantLaunchRecord);

  let stored = false;
  for (const storage of storages) {
    try {
      storage.setItem(RECENT_MERCHANT_LAUNCH_STORAGE_KEY, payload);
      stored = true;
    } catch {
      // Ignore partial storage failures.
    }
  }
  return stored;
}

export function readRecentMerchantLaunchState(maxAgeMs = RECENT_MERCHANT_LAUNCH_MAX_AGE_MS): RecentMerchantLaunchRecord | null {
  const storages = getLaunchStorages();
  for (let index = 0; index < storages.length; index += 1) {
    const storage = storages[index];
    try {
      const raw = storage.getItem(RECENT_MERCHANT_LAUNCH_STORAGE_KEY);
      if (!raw) continue;
      const normalized = normalizeLaunchRecord(JSON.parse(raw) as unknown, maxAgeMs);
      if (!normalized) {
        storage.removeItem(RECENT_MERCHANT_LAUNCH_STORAGE_KEY);
        continue;
      }
      if (index > 0) {
        const snapshot = JSON.stringify(normalized);
        for (let mirrorIndex = 0; mirrorIndex < index; mirrorIndex += 1) {
          try {
            storages[mirrorIndex].setItem(RECENT_MERCHANT_LAUNCH_STORAGE_KEY, snapshot);
          } catch {
            // Ignore best-effort mirror failures.
          }
        }
      }
      return normalized;
    } catch {
      try {
        storage.removeItem(RECENT_MERCHANT_LAUNCH_STORAGE_KEY);
      } catch {
        // Ignore malformed storage cleanup failures.
      }
    }
  }
  return null;
}

export function readRecentMerchantLaunchMerchantId(maxAgeMs = RECENT_MERCHANT_LAUNCH_MAX_AGE_MS) {
  return readRecentMerchantLaunchState(maxAgeMs)?.merchantId ?? "";
}

export function clearRecentMerchantLaunchState() {
  for (const storage of getLaunchStorages()) {
    try {
      storage.removeItem(RECENT_MERCHANT_LAUNCH_STORAGE_KEY);
    } catch {
      // Ignore storage cleanup failures.
    }
  }
}
