import { createClient } from "@supabase/supabase-js";

function readEnv(name: string) {
  return (process.env[name] ?? "").trim();
}

export function readSuperAdminAccount() {
  return readEnv("SUPER_ADMIN_ACCOUNT") || "felix";
}

export function readSuperAdminPassword() {
  return readEnv("SUPER_ADMIN_PASSWORD") || "987987";
}

export function readSuperAdminVerificationEmail() {
  return readEnv("SUPER_ADMIN_VERIFICATION_EMAIL") || "caimin6669@qq.com";
}

export function readSuperAdminVerificationSecret() {
  return (
    readEnv("SUPER_ADMIN_VERIFICATION_SECRET") ||
    `${readSuperAdminAccount()}::${readSuperAdminPassword()}::${readSuperAdminVerificationEmail()}::merchant-space`
  );
}

export function validateSuperAdminCredentials(account: string, password: string) {
  return account.trim() === readSuperAdminAccount() && password === readSuperAdminPassword();
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

export function resolvePublicOrigin(request: Request, requestUrl: URL) {
  const forwardedProto = (request.headers.get("x-forwarded-proto") ?? "").split(",")[0]?.trim();
  const forwardedHost = (request.headers.get("x-forwarded-host") ?? "").split(",")[0]?.trim();
  const host = (request.headers.get("host") ?? "").trim();
  const publicHost = forwardedHost || host;
  const protocol = forwardedProto || requestUrl.protocol.replace(/:$/, "") || "http";
  if (publicHost) return `${protocol}://${publicHost}`;
  return requestUrl.origin;
}

export function maskEmailAddress(value: string) {
  const email = String(value ?? "").trim().toLowerCase();
  const [name, domain] = email.split("@");
  if (!name || !domain) return email;
  if (name.length <= 2) return `${name[0] ?? "*"}***@${domain}`;
  return `${name.slice(0, 2)}***${name.slice(-1)}@${domain}`;
}
