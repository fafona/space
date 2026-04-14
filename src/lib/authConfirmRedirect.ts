import type { EmailOtpType } from "@supabase/supabase-js";

export function isResetPasswordRedirectTarget(url: URL) {
  const pathname = url.pathname.replace(/\/+$/, "") || "/";
  return pathname === "/reset-password" || pathname.startsWith("/reset-password/");
}

export function appendResetPasswordBridgeRedirectParams(
  redirectTo: URL,
  input: { type: EmailOtpType; tokenHash?: string; code?: string },
) {
  const targetUrl = new URL("/reset-password", redirectTo.origin);
  targetUrl.searchParams.set("type", input.type);
  const tokenHash = String(input.tokenHash ?? "").trim();
  const code = String(input.code ?? "").trim();
  if (tokenHash) {
    targetUrl.searchParams.set("token_hash", tokenHash);
  }
  if (code) {
    targetUrl.searchParams.set("code", code);
  }
  return targetUrl;
}
