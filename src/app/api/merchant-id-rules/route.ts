import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { loadMerchantIdRulesFromStore } from "@/lib/merchantIdRuleStore";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function readEnv(name: string) {
  return (process.env[name] ?? "").trim();
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

export async function GET() {
  const supabase = createServerSupabaseClient();
  if (!supabase) {
    return NextResponse.json({ error: "merchant_id_rules_env_missing" }, { status: 503 });
  }

  try {
    const { rules } = await loadMerchantIdRulesFromStore(supabase);
    return NextResponse.json({ rules });
  } catch (error) {
    return NextResponse.json(
      {
        error: "merchant_id_rules_load_failed",
        message: error instanceof Error ? error.message : "unknown_error",
      },
      { status: 500 },
    );
  }
}
