import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

type AuthUserSummary = {
  email?: string | null;
  email_confirmed_at?: string | null;
  user_metadata?: Record<string, unknown> | null;
};

function readEnv(name: string) {
  return (process.env[name] ?? "").trim();
}

function isEmailVerified(user: AuthUserSummary | null) {
  if (!user) return false;
  if (user.email_confirmed_at) return true;
  const metadata = user.user_metadata;
  return Boolean(metadata && typeof metadata === "object" && metadata.email_verified === true);
}

async function findUserByEmail(email: string) {
  const supabaseUrl = readEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = readEnv("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("auth_status_env_missing");
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  let page = 1;
  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;

    const users = data?.users ?? [];
    const match = users.find((user) => (user.email ?? "").trim().toLowerCase() === email);
    if (match) return match;
    if (users.length < 200) return null;
    page += 1;
  }
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json().catch(() => null)) as { email?: unknown } | null;
    const email = typeof payload?.email === "string" ? payload.email.trim().toLowerCase() : "";

    if (!email || !email.includes("@")) {
      return NextResponse.json({ error: "invalid_email" }, { status: 400 });
    }

    const user = await findUserByEmail(email);
    return NextResponse.json({
      exists: Boolean(user),
      confirmed: isEmailVerified(user),
    });
  } catch {
    return NextResponse.json({ error: "auth_status_unavailable" }, { status: 503 });
  }
}
