import { createClient } from "@supabase/supabase-js";
import { createMirroredBrowserAuthStorageAdapter } from "@/lib/browserAuthStorage";
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

/**
 * Enterprise employees intentionally use a separate browser session namespace.
 * Server-side authorization remains the security boundary; this prevents an
 * employee login from replacing a merchant owner's ordinary Faolla session in
 * the same browser.
 */
export const merchantEnterpriseSupabase = createClient(
  enterpriseSupabaseUrl,
  resolvedSupabaseAnonKey,
  {
    auth: {
      storage: createMirroredBrowserAuthStorageAdapter(),
      storageKey: enterpriseStorageKey,
      persistSession: true,
      detectSessionInUrl: false,
      flowType: "pkce",
      autoRefreshToken: process.env.NEXT_PUBLIC_SUPABASE_DISABLE_AUTO_REFRESH !== "1",
    },
  },
);
