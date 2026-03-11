import { NextResponse } from "next/server";
import { createClient, type EmailOtpType } from "@supabase/supabase-js";

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

function resolveSafeRedirect(requestUrl: URL, rawRedirectTo: string | null, type: EmailOtpType) {
  const fallbackPath = type === "recovery" ? "/reset-password" : "/login";
  if (!rawRedirectTo) return new URL(fallbackPath, requestUrl.origin);
  try {
    const nextUrl = new URL(rawRedirectTo, requestUrl.origin);
    if (nextUrl.origin !== requestUrl.origin) {
      return new URL(fallbackPath, requestUrl.origin);
    }
    return nextUrl;
  } catch {
    return new URL(fallbackPath, requestUrl.origin);
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

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const tokenHash = (requestUrl.searchParams.get("token_hash") ?? requestUrl.searchParams.get("token") ?? "").trim();
  const rawType = (requestUrl.searchParams.get("type") ?? "").trim() as EmailOtpType;
  const redirectTo = resolveSafeRedirect(requestUrl, requestUrl.searchParams.get("redirect_to"), rawType || "signup");

  if (!tokenHash || !SUPPORTED_TYPES.has(rawType)) {
    return NextResponse.redirect(
      appendResultParams(redirectTo, false, "验证链接无效，请重新发送验证邮件。"),
      { status: 303 },
    );
  }

  const supabaseUrl = readEnv("NEXT_PUBLIC_SUPABASE_URL");
  const anonKey = readEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");

  if (!supabaseUrl || !anonKey) {
    return NextResponse.redirect(
      appendResultParams(redirectTo, false, "验证服务暂时不可用，请稍后重试。"),
      { status: 303 },
    );
  }

  const supabase = createClient(supabaseUrl, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

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

  return NextResponse.redirect(
    appendResultParams(redirectTo, true, rawType === "recovery" ? "验证成功，请继续重置密码。" : "邮箱验证成功，请直接登录。"),
    { status: 303 },
  );
}
