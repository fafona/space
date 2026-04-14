import { createClient } from "@supabase/supabase-js";
import { resolveTrustedPublicOrigin } from "@/lib/requestOrigin";

const SUPER_ADMIN_AUTH_ENV_KEYS = [
  "SUPER_ADMIN_ACCOUNT",
  "SUPER_ADMIN_PASSWORD",
  "SUPER_ADMIN_VERIFICATION_EMAIL",
  "SUPER_ADMIN_VERIFICATION_SECRET",
] as const;

const SUPER_ADMIN_SUPABASE_AUTH_ENV_KEYS = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"] as const;

function readEnv(name: string) {
  return (process.env[name] ?? "").trim();
}

function listMissingEnv(names: readonly string[]) {
  return names.filter((name) => !readEnv(name));
}

export function readSuperAdminAccount() {
  return readEnv("SUPER_ADMIN_ACCOUNT");
}

export function readSuperAdminPassword() {
  return readEnv("SUPER_ADMIN_PASSWORD");
}

export function readSuperAdminVerificationEmail() {
  return readEnv("SUPER_ADMIN_VERIFICATION_EMAIL");
}

export function readSuperAdminVerificationSecret() {
  return readEnv("SUPER_ADMIN_VERIFICATION_SECRET");
}

export function listMissingSuperAdminAuthEnv() {
  return listMissingEnv(SUPER_ADMIN_AUTH_ENV_KEYS);
}

export function listMissingSuperAdminSupabaseAuthEnv() {
  return listMissingEnv(SUPER_ADMIN_SUPABASE_AUTH_ENV_KEYS);
}

export function isSuperAdminAuthConfigured() {
  return listMissingSuperAdminAuthEnv().length === 0;
}

export function validateSuperAdminCredentials(account: string, password: string) {
  const configuredAccount = readSuperAdminAccount();
  const configuredPassword = readSuperAdminPassword();
  if (!configuredAccount || !configuredPassword || !readSuperAdminVerificationSecret()) {
    return false;
  }
  return account.trim() === configuredAccount && password === configuredPassword;
}

export function createServerSupabaseAuthClient() {
  const supabaseUrl = readEnv("NEXT_PUBLIC_SUPABASE_URL");
  const anonKey = readEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  if (!supabaseUrl || !anonKey) return null;

  return createClient(supabaseUrl, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

export function createServerSupabaseServiceClient() {
  const supabaseUrl = readEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = readEnv("SUPABASE_SERVICE_ROLE_KEY") || readEnv("NEXT_SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return null;

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

export function resolvePublicOrigin(request: Request, requestUrl: URL) {
  void request;
  return resolveTrustedPublicOrigin(requestUrl);
}

export function readRequestClientIp(request: Request) {
  const candidates = [
    (request.headers.get("cf-connecting-ip") ?? "").trim(),
    (request.headers.get("x-real-ip") ?? "").trim(),
    (request.headers.get("true-client-ip") ?? "").trim(),
    (request.headers.get("fastly-client-ip") ?? "").trim(),
    (request.headers.get("x-forwarded-for") ?? "")
      .split(",")[0]
      ?.trim(),
  ];
  return candidates.find((item) => item) ?? "";
}

export function maskEmailAddress(value: string) {
  const email = String(value ?? "").trim().toLowerCase();
  const [name, domain] = email.split("@");
  if (!name || !domain) return email;
  if (name.length <= 2) return `${name[0] ?? "*"}***@${domain}`;
  return `${name.slice(0, 2)}***${name.slice(-1)}@${domain}`;
}
