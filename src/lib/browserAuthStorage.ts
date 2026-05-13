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

function getBrowserAuthStorages() {
  if (typeof window === "undefined") return [];
  return collectUsableBrowserStorages([window.sessionStorage, window.localStorage]);
}

const browserAuthCookiePrefix = "faolla-auth-storage.";
const browserAuthCookieMaxAgeSeconds = 60 * 60 * 24 * 180;
const browserAuthCookieMaxValueLength = 3800;

type CompactAuthSession = {
  access_token: string;
  refresh_token: string;
  expires_at?: number;
  expires_in?: number;
  token_type?: string;
};

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

function getBrowserAuthCookieAttributes() {
  if (typeof window === "undefined") return "; Path=/; SameSite=Lax";
  const hostname = window.location.hostname.toLowerCase();
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  const domain = hostname === "faolla.com" || hostname.endsWith(".faolla.com") ? "; Domain=.faolla.com" : "";
  return `; Path=/; SameSite=Lax${domain}${secure}`;
}

function readCookieValue(name: string) {
  if (!canUseDocumentCookies()) return null;
  const prefix = `${name}=`;
  const parts = document.cookie.split("; ");
  for (const part of parts) {
    if (!part.startsWith(prefix)) continue;
    try {
      return decodeURIComponent(part.slice(prefix.length));
    } catch {
      return part.slice(prefix.length);
    }
  }
  return null;
}

function normalizeFiniteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function compactAuthStorageValue(key: string, value: string) {
  if (isBrowserOAuthTransientStorageKey(key) && !isBrowserAuthTokenStorageKey(key)) {
    const raw = String(value ?? "");
    return raw.length > 0 && raw.length <= browserAuthCookieMaxValueLength ? raw : "";
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object") return "";
    const record = parsed as Record<string, unknown>;
    const containers = [record, record.currentSession, record.session];
    for (const container of containers) {
      if (!container || typeof container !== "object") continue;
      const candidate = container as Record<string, unknown>;
      const accessToken = typeof candidate.access_token === "string" ? candidate.access_token.trim() : "";
      const refreshToken = typeof candidate.refresh_token === "string" ? candidate.refresh_token.trim() : "";
      if (!accessToken || !refreshToken) continue;
      const compact: CompactAuthSession = {
        access_token: accessToken,
        refresh_token: refreshToken,
      };
      const expiresAt = normalizeFiniteNumber(candidate.expires_at);
      const expiresIn = normalizeFiniteNumber(candidate.expires_in);
      const tokenType = typeof candidate.token_type === "string" ? candidate.token_type.trim() : "";
      if (expiresAt !== undefined) compact.expires_at = expiresAt;
      if (expiresIn !== undefined) compact.expires_in = expiresIn;
      if (tokenType) compact.token_type = tokenType;
      return JSON.stringify({
        currentSession: compact,
        session: compact,
      });
    }
  } catch {
    // Ignore malformed storage values; they are not useful for cookie-backed recovery.
  }
  return "";
}

export function readBrowserAuthStorageCookie(key: string) {
  if (!isBrowserAuthStorageKey(key)) return null;
  return readCookieValue(getBrowserAuthCookieName(key));
}

export function writeBrowserAuthStorageCookie(key: string, value: string) {
  if (!canUseDocumentCookies() || !isBrowserAuthStorageKey(key)) return false;
  const compact = compactAuthStorageValue(key, value);
  if (!compact) return false;
  const encoded = encodeURIComponent(compact);
  if (encoded.length > browserAuthCookieMaxValueLength) return false;
  document.cookie = `${getBrowserAuthCookieName(key)}=${encoded}; Max-Age=${browserAuthCookieMaxAgeSeconds}${getBrowserAuthCookieAttributes()}`;
  return true;
}

export function deleteBrowserAuthStorageCookie(key: string) {
  if (!canUseDocumentCookies() || !isBrowserAuthStorageKey(key)) return;
  document.cookie = `${getBrowserAuthCookieName(key)}=; Max-Age=0${getBrowserAuthCookieAttributes()}`;
}

export function createMirroredBrowserAuthStorageAdapter() {
  return {
    getItem(key: string) {
      const storages = getBrowserAuthStorages();
      for (let index = 0; index < storages.length; index += 1) {
        const storage = storages[index];
        try {
          const raw = storage.getItem(key);
          if (raw === null) continue;
          if (index > 0) {
            for (let copyIndex = 0; copyIndex < index; copyIndex += 1) {
              try {
                if (storages[copyIndex].getItem(key) === null) {
                  storages[copyIndex].setItem(key, raw);
                }
              } catch {
                // Ignore best-effort mirroring failures.
              }
            }
          }
          return raw;
        } catch {
          // Ignore failed storage reads and keep trying fallbacks.
        }
      }
      const cookieValue = readBrowserAuthStorageCookie(key);
      if (cookieValue !== null) {
        for (const storage of storages) {
          try {
            if (storage.getItem(key) === null) {
              storage.setItem(key, cookieValue);
            }
          } catch {
            // Ignore best-effort mirroring failures.
          }
        }
        return cookieValue;
      }
      return null;
    },
    setItem(key: string, value: string) {
      for (const storage of getBrowserAuthStorages()) {
        try {
          storage.setItem(key, value);
        } catch {
          // Ignore partial persistence failures.
        }
      }
      writeBrowserAuthStorageCookie(key, value);
    },
    removeItem(key: string) {
      for (const storage of getBrowserAuthStorages()) {
        try {
          storage.removeItem(key);
        } catch {
          // Ignore partial cleanup failures.
        }
      }
      deleteBrowserAuthStorageCookie(key);
    },
  };
}
