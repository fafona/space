import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { Block } from "@/data/homeBlocks";
import { parseCookieValue, readMerchantRequestAccessTokens } from "@/lib/merchantAuthSession";
import { loadStoredMerchantDraft, saveStoredMerchantDraft, type MerchantDraftStoreClient } from "@/lib/merchantDraftStore";
import { SUPER_ADMIN_SESSION_COOKIE, SUPER_ADMIN_SESSION_VALUE } from "@/lib/superAdminSession";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type LoosePostgrestError = { message?: string } | null;
type LoosePostgrestResponse = {
  data?: unknown;
  error: LoosePostgrestError;
};
type LooseQueryBuilder = PromiseLike<LoosePostgrestResponse> & {
  select: (columns: string) => LooseQueryBuilder;
  eq: (column: string, value: unknown) => LooseQueryBuilder;
  limit: (value: number) => LooseQueryBuilder;
  maybeSingle: () => Promise<LoosePostgrestResponse>;
};
type LooseSupabaseClient = MerchantDraftStoreClient & {
  auth: {
    getUser: (token: string) => Promise<{
      data: { user: { id?: string; email?: string | null } | null };
      error: { message?: string } | null;
    }>;
  };
};

type MerchantRow = {
  id?: string | null;
};

type MerchantDraftBody = {
  siteId?: unknown;
  blocks?: unknown;
  updatedAt?: unknown;
};

function readEnv(name: string) {
  return (process.env[name] ?? "").trim();
}

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeEmail(value: string | null | undefined) {
  return String(value ?? "").trim().toLowerCase();
}

async function getAuthorizedMerchantIds(
  supabase: LooseSupabaseClient,
  userId: string,
  email: string,
) {
  const lookups: LooseQueryBuilder[] = [];

  if (userId) {
    ["user_id", "auth_user_id", "owner_user_id", "owner_id", "auth_id", "created_by", "created_by_user_id"].forEach(
      (column) => {
        lookups.push(supabase.from("merchants").select("id").eq(column, userId).limit(20));
      },
    );
  }

  if (email) {
    ["email", "owner_email", "contact_email", "user_email"].forEach((column) => {
      lookups.push(supabase.from("merchants").select("id").eq(column, email).limit(20));
    });
  }

  const settled = await Promise.allSettled(lookups);
  const merchantIds: string[] = [];
  settled.forEach((result) => {
    if (result.status !== "fulfilled") return;
    if (result.value.error) return;
    ((result.value.data ?? []) as MerchantRow[]).forEach((row) => {
      const merchantId = String(row.id ?? "").trim();
      if (!merchantId || merchantIds.includes(merchantId)) return;
      merchantIds.push(merchantId);
    });
  });
  return merchantIds;
}

async function isAuthorizedForMerchant(
  request: Request,
  supabase: LooseSupabaseClient,
  merchantId: string,
) {
  const cookieHeader = request.headers.get("cookie") ?? "";
  if (parseCookieValue(cookieHeader, SUPER_ADMIN_SESSION_COOKIE) === SUPER_ADMIN_SESSION_VALUE) {
    return true;
  }

  const accessTokens = readMerchantRequestAccessTokens(request);
  for (const accessToken of accessTokens) {
    const authResult = await supabase.auth.getUser(accessToken);
    if (authResult.error || !authResult.data.user) continue;

    const authorizedMerchantIds = await getAuthorizedMerchantIds(
      supabase,
      String(authResult.data.user.id ?? "").trim(),
      normalizeEmail(authResult.data.user.email),
    );
    if (authorizedMerchantIds.includes(merchantId)) {
      return true;
    }
  }

  return false;
}

function createServerSupabaseClient() {
  const supabaseUrl = readEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey =
    readEnv("SUPABASE_SERVICE_ROLE_KEY") ||
    readEnv("NEXT_SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) return null;

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  }) as unknown as LooseSupabaseClient;
}

export async function GET(request: Request) {
  const siteId = normalizeText(new URL(request.url).searchParams.get("siteId"));
  if (!siteId) {
    return NextResponse.json({ ok: false, error: "invalid_site_id" }, { status: 400 });
  }

  const supabase = createServerSupabaseClient();
  if (!supabase) {
    return NextResponse.json({ ok: false, error: "merchant_draft_env_missing" }, { status: 503 });
  }

  if (!(await isAuthorizedForMerchant(request, supabase, siteId))) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  try {
    const payload = await loadStoredMerchantDraft(supabase, siteId);
    if (!payload || payload.blocks.length === 0) {
      return NextResponse.json({ ok: false, error: "merchant_draft_not_found" }, { status: 404 });
    }
    return NextResponse.json({
      ok: true,
      siteId: payload.siteId,
      updatedAt: payload.updatedAt,
      blocks: payload.blocks,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: "merchant_draft_load_failed",
        message: error instanceof Error ? error.message : "unknown_error",
      },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const supabase = createServerSupabaseClient();
  if (!supabase) {
    return NextResponse.json({ ok: false, error: "merchant_draft_env_missing" }, { status: 503 });
  }

  let body: MerchantDraftBody | null = null;
  try {
    body = (await request.json()) as MerchantDraftBody;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const siteId = normalizeText(body?.siteId);
  if (!siteId) {
    return NextResponse.json({ ok: false, error: "invalid_site_id" }, { status: 400 });
  }
  if (!(await isAuthorizedForMerchant(request, supabase, siteId))) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  if (!Array.isArray(body?.blocks)) {
    return NextResponse.json({ ok: false, error: "invalid_blocks" }, { status: 400 });
  }

  try {
    const saved = await saveStoredMerchantDraft(supabase, {
      siteId,
      blocks: body.blocks as Block[],
      updatedAt: normalizeText(body?.updatedAt),
    });
    if (saved.error) {
      return NextResponse.json({ ok: false, error: "merchant_draft_save_failed", message: saved.error }, { status: 500 });
    }
    return NextResponse.json({ ok: true, siteId });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: "merchant_draft_save_failed",
        message: error instanceof Error ? error.message : "unknown_error",
      },
      { status: 500 },
    );
  }
}
