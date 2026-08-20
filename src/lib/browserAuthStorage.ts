function collectUsableBrowserStorages(candidates: Array<Storage | null | undefined>) {
  if (typeof window === "undefined") return [];
  const storages: Storage[] = [];
  for (const candidate of candidates) {
    if (!candidate || storages.includes(candidate)) continue;
    try {
      const probeKey = "__merchant_browser_auth_storage_probe__";
      candidate.setItem(probeKey, "1");
      candidate.removeItem(probeKey);
      storages.push(candidate);
    } catch {
      // Ignore unavailable browser storage backends.
    }
  }
  return storages;
}

const browserAuthCookiePrefix = "faolla-auth-storage.";
const BROWSER_OAUTH_TRANSIENT_TTL_MS = 15 * 60 * 1000;
const BROWSER_OAUTH_TRANSIENT_CREATED_AT_SUFFIX = ".faolla-created-at";

function canUseDocumentCookies() {
  return typeof document !== "undefined" && typeof window !== "undefined";
}

function normalizeBrowserAuthStorageKey(key: string) {
  return String(key ?? "").trim();
}

function isBrowserAuthTokenStorageKey(key: string) {
  const normalized = normalizeBrowserAuthStorageKey(key);
  return /^sb-[A-Za-z0-9_-]+-auth-token$/.test(normalized) || /auth-token$/i.test(normalized);
}

function isBrowserOAuthTransientStorageKey(key: string) {
  const normalized = normalizeBrowserAuthStorageKey(key);
  return (
    /^sb-[A-Za-z0-9_-]+-auth-token-[A-Za-z0-9_-]+$/.test(normalized) ||
    /(code[-_]?verifier|pkce|oauth[-_]?state|flow[-_]?state)/i.test(normalized)
  );
}

function isBrowserAuthStorageKey(key: string) {
  const normalized = String(key ?? "").trim();
  return Boolean(normalized) && (isBrowserAuthTokenStorageKey(normalized) || isBrowserOAuthTransientStorageKey(normalized));
}

function getBrowserAuthCookieName(key: string) {
  return `${browserAuthCookiePrefix}${String(key).replace(/[^A-Za-z0-9_-]/g, "_")}`;
}

function getBrowserStorage(candidate: Storage | null | undefined) {
  return collectUsableBrowserStorages([candidate])[0] ?? null;
}

function cleanupLegacyAccountSwitchStorage() {
  if (typeof window === "undefined") return;
  for (const storage of [window.sessionStorage, window.localStorage]) {
    try {
      storage.removeItem("faolla.accountSwitch.v1");
    } catch {
      // Best-effort cleanup of legacy multi-account bearer tokens.
    }
  }
}

function transientCreatedAtKey(key: string) {
  return `${key}${BROWSER_OAUTH_TRANSIENT_CREATED_AT_SUFFIX}`;
}

function clearLegacyPersistentAuthValue(key: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(key);
    window.localStorage.removeItem(transientCreatedAtKey(key));
  } catch {
    // Storage can be unavailable in restricted browser contexts.
  }
}

function removeOAuthTransientValue(key: string) {
  clearLegacyPersistentAuthValue(key);
}

export function readBrowserAuthStorageCookie(key: string) {
  if (isBrowserAuthStorageKey(key)) deleteBrowserAuthStorageCookie(key);
  return null;
}

export function writeBrowserAuthStorageCookie(key: string, value: string) {
  void value;
  if (isBrowserAuthStorageKey(key)) deleteBrowserAuthStorageCookie(key);
  return false;
}

export function deleteBrowserAuthStorageCookie(key: string) {
  if (!canUseDocumentCookies() || !isBrowserAuthStorageKey(key)) return;
  const cookieName = getBrowserAuthCookieName(key);
  document.cookie = `${cookieName}=; Path=/; Max-Age=0; SameSite=Lax; Secure`;
  document.cookie = `${cookieName}=; Path=/; Domain=.faolla.com; Max-Age=0; SameSite=Lax; Secure`;
}

export function createMirroredBrowserAuthStorageAdapter() {
  return {
    getItem(key: string) {
      cleanupLegacyAccountSwitchStorage();
      deleteBrowserAuthStorageCookie(key);

      if (isBrowserOAuthTransientStorageKey(key)) {
        try {
          const localStorage = getBrowserStorage(window.localStorage);
          const value = localStorage?.getItem(key) ?? null;
          const createdAt = Number(localStorage?.getItem(transientCreatedAtKey(key)) ?? "");
          if (
            value &&
            Number.isFinite(createdAt) &&
            createdAt > 0 &&
            Date.now() - createdAt <= BROWSER_OAUTH_TRANSIENT_TTL_MS
          ) {
            return value;
          }
        } catch {
          // Fall through to fail-closed cleanup.
        }
        removeOAuthTransientValue(key);
        return null;
      }

      let value: string | null = null;
      if (typeof window !== "undefined") {
        try {
          value = getBrowserStorage(window.sessionStorage)?.getItem(key) ?? null;
        } catch {
          // Treat unavailable current-tab storage as a signed-out session.
        }
      }
      clearLegacyPersistentAuthValue(key);
      return value;
    },
    setItem(key: string, value: string) {
      cleanupLegacyAccountSwitchStorage();
      if (isBrowserOAuthTransientStorageKey(key)) {
        try {
          const localStorage = getBrowserStorage(window.localStorage);
          localStorage?.setItem(key, value);
          localStorage?.setItem(transientCreatedAtKey(key), String(Date.now()));
        } catch {
          // Supabase will surface an unusable PKCE flow if persistence is blocked.
        }
        deleteBrowserAuthStorageCookie(key);
        return;
      }
      if (typeof window !== "undefined") {
        try {
          getBrowserStorage(window.sessionStorage)?.setItem(key, value);
        } catch {
          // Supabase will surface an unusable current-tab session if storage is blocked.
        }
      }
      clearLegacyPersistentAuthValue(key);
      deleteBrowserAuthStorageCookie(key);
    },
    removeItem(key: string) {
      cleanupLegacyAccountSwitchStorage();
      if (typeof window !== "undefined") {
        try {
          getBrowserStorage(window.sessionStorage)?.removeItem(key);
        } catch {
          // Best-effort cleanup.
        }
      }
      if (isBrowserOAuthTransientStorageKey(key)) removeOAuthTransientValue(key);
      else clearLegacyPersistentAuthValue(key);
      deleteBrowserAuthStorageCookie(key);
    },
  };
}
