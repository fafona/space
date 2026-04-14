import { NextResponse } from "next/server";
import { createClient, type EmailOtpType } from "@supabase/supabase-js";
import {
  appendResetPasswordBridgeRedirectParams,
  isResetPasswordRedirectTarget,
} from "@/lib/authConfirmRedirect";
import { resolveTrustedPublicOrigin } from "@/lib/requestOrigin";
import { createSuperAdminEmailProofToken } from "@/lib/superAdminVerification";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const SUPPORTED_TYPES = new Set<EmailOtpType>([
  "signup",
  "invite",
  "magiclink",
  "email_change",
  "recovery",
  "email",
]);

function readEnv(name: string) {
  return (process.env[name] ?? "").trim();
}

function resolveSafeRedirect(publicOrigin: string, rawRedirectTo: string | null, type: EmailOtpType) {
  const fallbackPath = type === "recovery" ? "/reset-password" : "/login";
  if (!rawRedirectTo) return new URL(fallbackPath, publicOrigin);
  try {
    const nextUrl = new URL(rawRedirectTo, publicOrigin);
    if (nextUrl.origin !== publicOrigin) {
      return new URL(fallbackPath, publicOrigin);
    }
    return nextUrl;
  } catch {
    return new URL(fallbackPath, publicOrigin);
  }
}

function appendResultParams(url: URL, confirmed: boolean, message?: string) {
  const nextUrl = new URL(url.toString());
  nextUrl.searchParams.set("confirmed", confirmed ? "1" : "0");
  if (message) {
    nextUrl.searchParams.set("confirm_message", message);
  } else {
    nextUrl.searchParams.delete("confirm_message");
  }
  return nextUrl;
}

function appendSuperAdminProofParams(url: URL, confirmed: boolean) {
  const nextUrl = new URL(url.toString());
  const challenge = (nextUrl.searchParams.get("superAdminChallenge") ?? "").trim();
  if (!challenge || !confirmed) return nextUrl;
  const proof = createSuperAdminEmailProofToken(challenge);
  if (!proof) return nextUrl;
  nextUrl.searchParams.set("superAdminVerified", "1");
  nextUrl.searchParams.set("superAdminProof", proof);
  return nextUrl;
}

function appendRecoveryRedirectParams(url: URL, input: { tokenHash?: string; code?: string }) {
  const nextUrl = isResetPasswordRedirectTarget(url) ? new URL("/reset-password", url.origin) : new URL(url.toString());
  const tokenHash = String(input.tokenHash ?? "").trim();
  const code = String(input.code ?? "").trim();
  nextUrl.searchParams.set("type", "recovery");
  if (tokenHash) {
    nextUrl.searchParams.set("token_hash", tokenHash);
  } else {
    nextUrl.searchParams.delete("token_hash");
  }
  if (code) {
    nextUrl.searchParams.set("code", code);
  } else {
    nextUrl.searchParams.delete("code");
  }
  nextUrl.searchParams.delete("token");
  nextUrl.hash = "";
  return nextUrl;
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const tokenHash = (requestUrl.searchParams.get("token_hash") ?? requestUrl.searchParams.get("token") ?? "").trim();
  const code = (requestUrl.searchParams.get("code") ?? "").trim();
  const rawType = (requestUrl.searchParams.get("type") ?? "").trim() as EmailOtpType;
  const publicOrigin = resolveTrustedPublicOrigin(requestUrl);
  const redirectTo = resolveSafeRedirect(publicOrigin, requestUrl.searchParams.get("redirect_to"), rawType || "signup");

  if (rawType === "recovery") {
    if (!tokenHash && !code) {
      return NextResponse.redirect(
        appendResultParams(redirectTo, false, "验证链接无效或已过期，请重新发送重置密码邮件。"),
        { status: 303 },
      );
    }

    return NextResponse.redirect(appendRecoveryRedirectParams(redirectTo, { tokenHash, code }), { status: 303 });
  }

  if (!tokenHash || !SUPPORTED_TYPES.has(rawType)) {
    return NextResponse.redirect(
      appendResultParams(redirectTo, false, "验证链接无效或已过期，请重新发送验证邮件。"),
      { status: 303 },
    );
  }

  const supabaseUrl = readEnv("NEXT_PUBLIC_SUPABASE_URL");
  const anonKey = readEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");

  if (!supabaseUrl || !anonKey) {
    return NextResponse.redirect(appendResultParams(redirectTo, false, "验证服务暂时不可用，请稍后重试。"), {
      status: 303,
    });
  }

  const supabase = createClient(supabaseUrl, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  if ((rawType === "email" || rawType === "magiclink") && isResetPasswordRedirectTarget(redirectTo)) {
    if (!tokenHash && !code) {
      return NextResponse.redirect(
        appendResultParams(redirectTo, false, "验证链接无效或已过期，请重新发送找回密码邮件。"),
        { status: 303 },
      );
    }
    return NextResponse.redirect(
      appendResetPasswordBridgeRedirectParams(redirectTo, { type: rawType, tokenHash, code }),
      { status: 303 },
    );
  }

  const { error } = await supabase.auth.verifyOtp({
    type: rawType,
    token_hash: tokenHash,
  });

  if (error) {
    return NextResponse.redirect(
      appendResultParams(redirectTo, false, error.message || "邮箱验证失败，请重新发送验证邮件。"),
      { status: 303 },
    );
  }

  const successRedirect = appendResultParams(redirectTo, true, "邮箱验证成功，请继续登录。");
  return NextResponse.redirect(appendSuperAdminProofParams(successRedirect, true), { status: 303 });
}
