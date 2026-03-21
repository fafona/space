import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isMerchantNumericId } from "@/lib/merchantIdentity";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type AuthMetadata = Record<string, unknown> | null | undefined;

type AuthUserSummary = {
  email?: string | null;
  user_metadata?: AuthMetadata;
  app_metadata?: AuthMetadata;
};

type AdminListUsersClient = {
  auth: {
    admin: {
      listUsers: (params: { page: number; perPage: number }) => Promise<{
        data: { users: AuthUserSummary[] } | null;
        error: Error | null;
      }>;
    };
  };
};

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

function normalizeAccountValue(value: string | null | undefined) {
  return String(value ?? "").trim().toLowerCase();
}

function readMetadataString(metadata: AuthMetadata, ...keys: string[]) {
  if (!metadata || typeof metadata !== "object") return "";
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value !== "string") continue;
    const normalized = value.trim();
    if (normalized) return normalized;
  }
  return "";
}

function readAccountKeys(user: AuthUserSummary) {
  const username =
    readMetadataString(user.user_metadata, "username", "display_name", "name") ||
    readMetadataString(user.app_metadata, "username", "display_name", "name");
  const loginId =
    readMetadataString(user.user_metadata, "login_id", "loginId", "merchant_id", "merchantId", "merchantID") ||
    readMetadataString(user.app_metadata, "login_id", "loginId", "merchant_id", "merchantId", "merchantID");
  const merchantId =
    readMetadataString(user.user_metadata, "merchant_id", "merchantId", "merchantID", "login_id", "loginId") ||
    readMetadataString(user.app_metadata, "merchant_id", "merchantId", "merchantID", "login_id", "loginId");

  return [username, loginId, merchantId].map(normalizeAccountValue).filter(Boolean);
}

function createServerSupabaseClient() {
  const supabaseUrl = readEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey =
    readEnv("SUPABASE_SERVICE_ROLE_KEY") ||
    readEnv("NEXT_SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    return null;
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

async function listAuthUsers(supabase: AdminListUsersClient) {
  const users: AuthUserSummary[] = [];
  let page = 1;
  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const chunk = (data?.users ?? []).map((user) => ({
      email: user.email,
      user_metadata: user.user_metadata ?? null,
      app_metadata: user.app_metadata ?? null,
    }));
    users.push(...chunk);
    if (chunk.length < 200) break;
    page += 1;
  }
  return users;
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json().catch(() => null)) as { account?: unknown } | null;
    const account = typeof payload?.account === "string" ? payload.account.trim() : "";
    const normalizedAccount = normalizeAccountValue(account);

    if (!normalizedAccount) {
      return NextResponse.json({ error: "invalid_account" }, { status: 400 });
    }

    if (normalizedAccount.includes("@")) {
      return NextResponse.json({ email: normalizedAccount });
    }

    const supabase = createServerSupabaseClient();
    if (!supabase) {
      return NextResponse.json({ error: "account_resolve_env_missing" }, { status: 503 });
    }

    if (isMerchantNumericId(normalizedAccount)) {
      const { data: merchant, error } = await supabase
        .from("merchants")
        .select("id,email,owner_email,contact_email,user_email")
        .eq("id", normalizedAccount)
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      const email = normalizeEmail(
        merchant?.user_email,
        merchant?.email,
        merchant?.owner_email,
        merchant?.contact_email,
      );
      if (email) {
        return NextResponse.json({ email });
      }
    }

    const authUsers = await listAuthUsers(supabase);
    const matchedUser = authUsers.find((user) => readAccountKeys(user).includes(normalizedAccount));
    return NextResponse.json({
      email: matchedUser ? normalizeEmail(matchedUser.email) : "",
    });
  } catch {
    return NextResponse.json({ error: "account_resolve_failed" }, { status: 503 });
  }
}
