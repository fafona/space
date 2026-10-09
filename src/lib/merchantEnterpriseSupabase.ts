import { createClient, type AuthChangeEvent, type Session } from "@supabase/supabase-js";
import { deleteBrowserAuthStorageCookie } from "@/lib/browserAuthStorage";
import { shouldApplyEnterpriseAuthEvent } from "@/lib/merchantEnterpriseAuthEvents";
import { createEnterpriseLogoutBoundary } from "@/lib/merchantEnterpriseLogout";
import {
  getResolvedSupabaseUrl,
  legacySupabaseAuthStorageKey,
  resolvedSupabaseAnonKey,
  resolvedSupabaseUrl,
} from "@/lib/supabase";

const enterpriseStorageKey = legacySupabaseAuthStorageKey
  ? legacySupabaseAuthStorageKey.replace(/-auth-token$/, "-enterprise-auth-token")
  : "faolla-enterprise-auth-token";

const enterpriseSupabaseUrl =
  typeof window === "undefined" ? resolvedSupabaseUrl : getResolvedSupabaseUrl();

const ENTERPRISE_OAUTH_TRANSIENT_TTL_MS = 15 * 60 * 1000;

export function isEnterpriseOAuthTransientStorageKey(key: string) {
  return /(code[-_]?verifier|pkce|oauth[-_]?state|flow[-_]?state)/i.test(
    String(key ?? ""),
  );
}

export function createEnterpriseBrowserAuthStorageAdapter(strictSessionStorage = false) {
  function transientCreatedAtKey(key: string) {
    return `${key}.faolla-created-at`;
  }

  function removeTransientPersistence(key: string) {
    if (typeof window !== "undefined") {
      try {
        window.localStorage.removeItem(key);
        window.localStorage.removeItem(transientCreatedAtKey(key));
      } catch (error) {
        // Storage can be unavailable in restricted browser contexts.
        if (strictSessionStorage) throw error;
      }
    }
    deleteBrowserAuthStorageCookie(key);
  }

  function clearLegacyPersistence(key: string) {
    if (typeof window !== "undefined") {
      try {
        window.localStorage.removeItem(key);
      } catch {
        // Storage can be unavailable in restricted browser contexts.
      }
    }
    deleteBrowserAuthStorageCookie(key);
  }

  return {
    getItem(key: string) {
      if (typeof window === "undefined") return null;
      if (isEnterpriseOAuthTransientStorageKey(key)) {
        try {
          const createdAt = Number(
            window.localStorage.getItem(transientCreatedAtKey(key)),
          );
          const value = window.localStorage.getItem(key);
          if (
            value &&
            Number.isFinite(createdAt) &&
            createdAt > 0 &&
            Date.now() - createdAt <= ENTERPRISE_OAUTH_TRANSIENT_TTL_MS
          ) {
            deleteBrowserAuthStorageCookie(key);
            return value;
          }
        } catch (error) {
          // Fall through to cleanup.
          if (strictSessionStorage) throw error;
        }
        removeTransientPersistence(key);
        return null;
      }
      let value: string | null = null;
      try {
        value = window.sessionStorage.getItem(key);
      } catch (error) {
        // Treat unavailable session storage as a signed-out session.
        if (strictSessionStorage) throw error;
      }
      clearLegacyPersistence(key);
      return value;
    },
    setItem(key: string, value: string) {
      if (isEnterpriseOAuthTransientStorageKey(key)) {
        if (typeof window !== "undefined") {
          try {
            window.localStorage.setItem(key, value);
            window.localStorage.setItem(
              transientCreatedAtKey(key),
              String(Date.now()),
            );
          } catch (error) {
            // Supabase will surface an unusable PKCE flow if persistence is blocked.
            if (strictSessionStorage) throw error;
          }
        }
        deleteBrowserAuthStorageCookie(key);
        return;
      }
      if (typeof window !== "undefined") {
        try {
          window.sessionStorage.setItem(key, value);
        } catch (error) {
          // Supabase will surface an unusable session if persistence is blocked.
          if (strictSessionStorage) throw error;
        }
      }
      clearLegacyPersistence(key);
    },
    removeItem(key: string) {
      if (isEnterpriseOAuthTransientStorageKey(key)) {
        removeTransientPersistence(key);
        return;
      }
      if (typeof window !== "undefined") {
        try {
          window.sessionStorage.removeItem(key);
        } catch (error) {
          // Best-effort cleanup.
          if (strictSessionStorage) throw error;
        }
      }
      clearLegacyPersistence(key);
    },
  };
}

/**
 * Enterprise employees intentionally use a separate browser session namespace.
 * Server-side authorization remains the security boundary; this prevents an
 * employee login from replacing a merchant owner's ordinary Faolla session.
 * Tokens stay in the current tab and are never mirrored into cross-subdomain
 * cookies or long-lived local storage. PKCE verifier/state values may use
 * same-origin local storage for at most 15 minutes so email callbacks opened
 * in a new tab can complete; they never contain access or refresh tokens.
 */
const enterpriseLogout = createEnterpriseLogoutBoundary(
  createEnterpriseBrowserAuthStorageAdapter(true),
  enterpriseStorageKey,
);

export const merchantEnterpriseSupabase = createClient(
  enterpriseSupabaseUrl,
  resolvedSupabaseAnonKey,
  {
    auth: {
      storage: enterpriseLogout.storage,
      storageKey: enterpriseStorageKey,
      persistSession: true,
      detectSessionInUrl: false,
      flowType: "pkce",
      autoRefreshToken: process.env.NEXT_PUBLIC_SUPABASE_DISABLE_AUTO_REFRESH !== "1",
    },
  },
);

export const isEnterpriseLogoutBlocked = enterpriseLogout.isBlocked;
/** Only this tab's persisted employee session may drive employee UI state. */
export function onEnterpriseAuthStateChange(
  callback: (event: AuthChangeEvent, session: Session | null) => void,
) {
  return merchantEnterpriseSupabase.auth.onAuthStateChange((event, session) => {
    if (!shouldApplyEnterpriseAuthEvent(
      session,
      () => enterpriseLogout.storage.getItem(enterpriseStorageKey),
      enterpriseLogout.isBlocked,
    )) return;
    callback(event, session);
  });
}
export function signOutEnterpriseSession() {
  return enterpriseLogout.signOut(() => merchantEnterpriseSupabase.auth.signOut());
}
export function signInEnterpriseWithPassword(credentials: { email: string; password: string }) {
  return enterpriseLogout.signIn(() => merchantEnterpriseSupabase.auth.signInWithPassword(credentials));
}
