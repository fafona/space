import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

type SignInRoutePayload = {
  email?: unknown;
  password?: unknown;
};

type SignInRouteUser = {
  id?: string;
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
  app_metadata?: Record<string, unknown> | null;
};

type SignInRouteSession = {
  access_token?: string;
  refresh_token?: string;
  expires_at?: number | null;
  expires_in?: number;
  token_type?: string;
  user?: SignInRouteUser | null;
};

function readEnv(name: string) {
  return (process.env[name] ?? "").trim();
}

function createServerSupabaseClient() {
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

function sanitizeHttpStatus(value: unknown, fallback: number) {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed < 400 || parsed > 599) return fallback;
  return parsed;
}

function readErrorCode(error: unknown) {
  if (!error || typeof error !== "object") return "";
  const record = error as { code?: unknown; error_code?: unknown };
  if (typeof record.code === "string" && record.code.trim()) return record.code.trim();
  if (typeof record.error_code === "string" && record.error_code.trim()) return record.error_code.trim();
  return "";
}

function readErrorMessage(error: unknown) {
  if (!error || typeof error !== "object") return "";
  const record = error as { message?: unknown; msg?: unknown };
  if (typeof record.message === "string" && record.message.trim()) return record.message.trim();
  if (typeof record.msg === "string" && record.msg.trim()) return record.msg.trim();
  return "";
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json().catch(() => null)) as SignInRoutePayload | null;
    const email = typeof payload?.email === "string" ? payload.email.trim().toLowerCase() : "";
    const password = typeof payload?.password === "string" ? payload.password : "";

    if (!email || !email.includes("@")) {
      return NextResponse.json({ error: "invalid_email" }, { status: 400 });
    }
    if (!password || password.length < 6) {
      return NextResponse.json({ error: "invalid_password" }, { status: 400 });
    }

    const supabase = createServerSupabaseClient();
    if (!supabase) {
      return NextResponse.json({ error: "auth_signin_env_missing" }, { status: 503 });
    }

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      return NextResponse.json(
        {
          error: readErrorCode(error) || "auth_signin_failed",
          message: readErrorMessage(error) || "auth_signin_failed",
        },
        { status: sanitizeHttpStatus((error as { status?: unknown }).status, 401) },
      );
    }

    const session = (data.session ?? null) as SignInRouteSession | null;
    const accessToken = String(session?.access_token ?? "").trim();
    const refreshToken = String(session?.refresh_token ?? "").trim();
    if (!accessToken || !refreshToken) {
      return NextResponse.json({ error: "auth_signin_session_missing" }, { status: 502 });
    }

    return NextResponse.json({
      session,
      user: (data.user ?? session?.user ?? null) as SignInRouteUser | null,
    });
  } catch {
    return NextResponse.json({ error: "auth_signin_unavailable" }, { status: 503 });
  }
}
