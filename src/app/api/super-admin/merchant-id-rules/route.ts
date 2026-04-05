import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { loadMerchantIdRulesFromStore, saveMerchantIdRulesToStore } from "@/lib/merchantIdRuleStore";
import { parseMerchantIdRuleInput, sortMerchantIdRules, type MerchantIdRule } from "@/lib/merchantIdRules";
import { isSuperAdminRequestAuthorized } from "@/lib/superAdminRequestAuth";

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

function unauthorizedJson() {
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

function ensureAuthorized(request: Request) {
  return isSuperAdminRequestAuthorized(request);
}

export async function GET(request: Request) {
  if (!ensureAuthorized(request)) {
    return unauthorizedJson();
  }

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

export async function POST(request: Request) {
  if (!ensureAuthorized(request)) {
    return unauthorizedJson();
  }

  const supabase = createServerSupabaseClient();
  if (!supabase) {
    return NextResponse.json({ error: "merchant_id_rules_env_missing" }, { status: 503 });
  }

  try {
    const payload = (await request.json().catch(() => null)) as {
      expression?: unknown;
      note?: unknown;
    } | null;
    const expression = typeof payload?.expression === "string" ? payload.expression : "";
    const note = typeof payload?.note === "string" ? payload.note.trim() : "";

    const parsed = parseMerchantIdRuleInput(expression);
    if (!parsed.ok) {
      return NextResponse.json({ error: "invalid_rule", message: parsed.message }, { status: 400 });
    }

    const { rowId, rules } = await loadMerchantIdRulesFromStore(supabase);
    if (rules.some((item) => item.expression === parsed.rule.expression)) {
      return NextResponse.json({ error: "rule_exists", message: "该规则已存在" }, { status: 409 });
    }

    const createdRule: MerchantIdRule = {
      id: `merchant-id-rule-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: parsed.rule.type,
      expression: parsed.rule.expression,
      note,
      intervalStart: parsed.rule.intervalStart,
      intervalEnd: parsed.rule.intervalEnd,
      createdAt: new Date().toISOString(),
    };
    const nextRules = sortMerchantIdRules([createdRule, ...rules]);
    await saveMerchantIdRulesToStore(supabase, rowId, nextRules);

    return NextResponse.json({ rule: createdRule }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      {
        error: "merchant_id_rules_save_failed",
        message: error instanceof Error ? error.message : "unknown_error",
      },
      { status: 500 },
    );
  }
}

export async function DELETE(request: Request) {
  if (!ensureAuthorized(request)) {
    return unauthorizedJson();
  }

  const supabase = createServerSupabaseClient();
  if (!supabase) {
    return NextResponse.json({ error: "merchant_id_rules_env_missing" }, { status: 503 });
  }

  try {
    const payload = (await request.json().catch(() => null)) as { id?: unknown } | null;
    const ruleId = typeof payload?.id === "string" ? payload.id.trim() : "";
    if (!ruleId) {
      return NextResponse.json({ error: "invalid_rule_id", message: "缺少规则 ID" }, { status: 400 });
    }

    const { rowId, rules } = await loadMerchantIdRulesFromStore(supabase);
    const nextRules = rules.filter((item) => item.id !== ruleId);
    if (nextRules.length === rules.length) {
      return NextResponse.json({ error: "rule_not_found", message: "规则不存在" }, { status: 404 });
    }

    await saveMerchantIdRulesToStore(supabase, rowId, nextRules);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      {
        error: "merchant_id_rules_delete_failed",
        message: error instanceof Error ? error.message : "unknown_error",
      },
      { status: 500 },
    );
  }
}
