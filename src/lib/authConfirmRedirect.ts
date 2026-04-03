import type { EmailOtpType } from "@supabase/supabase-js";

export function isResetPasswordRedirectTarget(url: URL) {
  const pathname = url.pathname.replace(/\/+$/, "") || "/";
  return pathname === "/reset-password" || pathname.startsWith("/reset-password/");
}

export function appendResetPasswordBridgeRedirectParams(
  redirectTo: URL,
  input: { type: EmailOtpType; tokenHash?: string; code?: string },
) {
  const bridgeUrl = new URL("/reset-password/bridge", redirectTo.origin);
  bridgeUrl.searchParams.set("type", input.type);
  const tokenHash = String(input.tokenHash ?? "").trim();
  const code = String(input.code ?? "").trim();
  if (tokenHash) {
    bridgeUrl.searchParams.set("token_hash", tokenHash);
  }
  if (code) {
    bridgeUrl.searchParams.set("code", code);
  }
  return bridgeUrl;
}
