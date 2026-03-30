import { NextResponse } from "next/server";
import { createClient, type EmailOtpType, type Session } from "@supabase/supabase-js";
import { createSuperAdminEmailProofToken } from "@/lib/superAdminVerification";
import { setResetRecoveryCookies } from "@/lib/resetPasswordRecoverySession";

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

function resolvePublicOrigin(request: Request, requestUrl: URL) {
  const forwardedProto = (request.headers.get("x-forwarded-proto") ?? "").split(",")[0]?.trim();
  const forwardedHost = (request.headers.get("x-forwarded-host") ?? "").split(",")[0]?.trim();
  const host = (request.headers.get("host") ?? "").trim();
  const publicHost = forwardedHost || host;
  const protocol = forwardedProto || requestUrl.protocol.replace(/:$/, "") || "http";
  if (publicHost) return `${protocol}://${publicHost}`;
  return requestUrl.origin;
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
  url.searchParams.set("confirmed", confirmed ? "1" : "0");
  if (message) {
    url.searchParams.set("confirm_message", message);
  } else {
    url.searchParams.delete("confirm_message");
  }
  return url;
}

function appendSuperAdminProofParams(url: URL, confirmed: boolean) {
  const challenge = (url.searchParams.get("superAdminChallenge") ?? "").trim();
  if (!challenge || !confirmed) return url;
  const proof = createSuperAdminEmailProofToken(challenge);
  if (!proof) return url;
  url.searchParams.set("superAdminVerified", "1");
  url.searchParams.set("superAdminProof", proof);
  return url;
}

function appendRecoverySessionHash(url: URL, session: Session | null | undefined) {
  const accessToken = String(session?.access_token ?? "").trim();
  const refreshToken = String(session?.refresh_token ?? "").trim();
  if (!accessToken || !refreshToken) return url;
  const hashParams = new URLSearchParams();
  hashParams.set("type", "recovery");
  hashParams.set("access_token", accessToken);
  hashParams.set("refresh_token", refreshToken);
  if (typeof session?.expires_in === "number" && Number.isFinite(session.expires_in)) {
    hashParams.set("expires_in", String(session.expires_in));
  }
  if (typeof session?.expires_at === "number" && Number.isFinite(session.expires_at)) {
    hashParams.set("expires_at", String(session.expires_at));
  }
  const tokenType = String(session?.token_type ?? "").trim();
  if (tokenType) {
    hashParams.set("token_type", tokenType);
  }
  url.hash = hashParams.toString();
  return url;
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const tokenHash = (requestUrl.searchParams.get("token_hash") ?? requestUrl.searchParams.get("token") ?? "").trim();
  const rawType = (requestUrl.searchParams.get("type") ?? "").trim() as EmailOtpType;
  const publicOrigin = resolvePublicOrigin(request, requestUrl);
  const redirectTo = resolveSafeRedirect(publicOrigin, requestUrl.searchParams.get("redirect_to"), rawType || "signup");

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

  const { data, error } = await supabase.auth.verifyOtp({
    type: rawType,
    token_hash: tokenHash,
  });

  if (error) {
    return NextResponse.redirect(
      appendResultParams(redirectTo, false, error.message || "邮箱验证失败，请重新发送验证邮件。"),
      { status: 303 },
    );
  }

  const successMessage = rawType === "recovery" ? "验证成功，请继续重置密码。" : "邮箱验证成功，请继续登录。";
  const successRedirect = appendResultParams(redirectTo, true, successMessage);
  if (rawType === "recovery") {
    appendRecoverySessionHash(successRedirect, data.session);
  }
  const response = NextResponse.redirect(appendSuperAdminProofParams(successRedirect, true), { status: 303 });
  if (rawType === "recovery") {
    setResetRecoveryCookies(response, {
      accessToken: String(data.session?.access_token ?? "").trim(),
      refreshToken: String(data.session?.refresh_token ?? "").trim(),
      maxAgeSeconds: data.session?.expires_in,
    });
  }
  return response;
}
