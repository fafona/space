import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { SUPER_ADMIN_SESSION_COOKIE, SUPER_ADMIN_SESSION_VALUE } from "@/lib/superAdminSession";

type MerchantRow = {
  id: string;
  name?: string | null;
  email?: string | null;
  owner_email?: string | null;
  contact_email?: string | null;
  user_email?: string | null;
  user_id?: string | null;
  auth_user_id?: string | null;
  created_at?: string | null;
};

type AuthUserSummary = {
  id: string;
  email?: string | null;
  email_confirmed_at?: string | null;
  last_sign_in_at?: string | null;
};

function parseCookieValue(cookieHeader: string, key: string) {
  return cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${key}=`))
    ?.slice(key.length + 1) ?? "";
}

function readEnv(name: string) {
  return (process.env[name] ?? "").trim();
}

function normalizeEmail(...values: Array<string | null | undefined>) {
  for (const value of values) {
    const normalized = String(value ?? "").trim().toLowerCase();
    if (normalized) return normalized;
  }
  return "";
}

async function listAuthUsers(supabase: any) {
  const users: AuthUserSummary[] = [];
  let page = 1;
  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const chunk = (data?.users ?? []).map((user: any) => ({
      id: user.id,
      email: user.email,
      email_confirmed_at: user.email_confirmed_at,
      last_sign_in_at: user.last_sign_in_at,
    }));
    users.push(...chunk);
    if (chunk.length < 200) break;
    page += 1;
  }
  return users;
}

export async function GET(request: Request) {
  const cookieHeader = request.headers.get("cookie") ?? "";
  if (parseCookieValue(cookieHeader, SUPER_ADMIN_SESSION_COOKIE) !== SUPER_ADMIN_SESSION_VALUE) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabaseUrl = readEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey =
    readEnv("SUPABASE_SERVICE_ROLE_KEY") ||
    readEnv("NEXT_SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json({ error: "merchant_account_env_missing" }, { status: 503 });
  }

  try {
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });

    const [{ data: merchants, error: merchantError }, authUsers] = await Promise.all([
      supabase
        .from("merchants")
        .select("id,name,email,owner_email,contact_email,user_email,user_id,auth_user_id,created_at")
        .order("created_at", { ascending: false })
        .limit(500),
      listAuthUsers(supabase),
    ]);

    if (merchantError) throw merchantError;

    const authById = new Map(authUsers.map((user) => [user.id, user] as const));
    const authByEmail = new Map(
      authUsers
        .map((user) => [normalizeEmail(user.email), user] as const)
        .filter(([email]) => !!email),
    );

    const items = ((merchants ?? []) as MerchantRow[]).map((merchant) => {
      const email = normalizeEmail(
        merchant.user_email,
        merchant.email,
        merchant.owner_email,
        merchant.contact_email,
      );
      const fallbackAuthUserId = String(merchant.auth_user_id ?? merchant.user_id ?? "").trim();
      const authUser =
        authById.get(String(merchant.auth_user_id ?? "").trim()) ??
        authById.get(String(merchant.user_id ?? "").trim()) ??
        authByEmail.get(email) ??
        null;

      return {
        merchantId: String(merchant.id ?? "").trim(),
        merchantName: String(merchant.name ?? "").trim() || "未命名商户",
        email,
        createdAt: merchant.created_at ?? null,
        authUserId: (authUser?.id ?? fallbackAuthUserId) || null,
        emailConfirmed: Boolean(authUser?.email_confirmed_at),
        emailConfirmedAt: authUser?.email_confirmed_at ?? null,
        lastSignInAt: authUser?.last_sign_in_at ?? null,
      };
    });

    return NextResponse.json({ items });
  } catch (error) {
    return NextResponse.json(
      {
        error: "merchant_account_load_failed",
        message: error instanceof Error ? error.message : "unknown_error",
      },
      { status: 500 },
    );
  }
}
