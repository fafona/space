import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { SUPER_ADMIN_SESSION_COOKIE, SUPER_ADMIN_SESSION_VALUE } from "@/lib/superAdminSession";
import {
  PLATFORM_MERCHANT_SNAPSHOT_SLUG,
  buildPlatformMerchantSnapshotBlocks,
  normalizePlatformMerchantSnapshotPayload,
} from "@/lib/platformMerchantSnapshot";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type SaveErrorLike = { message?: string } | null;

type LooseQueryBuilder = PromiseLike<{ data?: unknown; error: SaveErrorLike }> & {
  select: (columns: string) => LooseQueryBuilder;
  update: (payload: Record<string, unknown>) => LooseQueryBuilder;
  insert: (payload: Record<string, unknown>) => Promise<{ data?: unknown; error: SaveErrorLike }>;
  is: (column: string, value: unknown) => LooseQueryBuilder;
  eq: (column: string, value: unknown) => LooseQueryBuilder;
  limit: (value: number) => LooseQueryBuilder;
  maybeSingle: () => Promise<{ data?: unknown; error: SaveErrorLike }>;
};

type LooseSupabaseClient = {
  from: (table: string) => LooseQueryBuilder;
};

function parseCookieValue(cookieHeader: string, key: string) {
  return (
    cookieHeader
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${key}=`))
      ?.slice(key.length + 1) ?? ""
  );
}

function readEnv(name: string) {
  return String(process.env[name] ?? "").trim();
}

function toErrorMessage(input: unknown) {
  if (!input || typeof input !== "object") return "unknown_error";
  const message = (input as { message?: unknown }).message;
  return typeof message === "string" && message.trim() ? message.trim() : "unknown_error";
}

function isMissingSlugColumn(message: string) {
  return (
    /column\s+pages\.slug\s+does\s+not\s+exist/i.test(message) ||
    /could not find the ['"]slug['"] column of ['"]pages['"] in the schema cache/i.test(message)
  );
}

function isMissingMerchantIdColumn(message: string) {
  return (
    /column\s+pages\.merchant_id\s+does\s+not\s+exist/i.test(message) ||
    /could not find the ['"]merchant_id['"] column of ['"]pages['"] in the schema cache/i.test(message)
  );
}

function isMissingUpdatedAtColumn(message: string) {
  return (
    /column\s+pages\.updated_at\s+does\s+not\s+exist/i.test(message) ||
    /could not find the ['"]updated_at['"] column of ['"]pages['"] in the schema cache/i.test(message)
  );
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

async function savePlatformMerchantSnapshot(
  supabase: LooseSupabaseClient,
  blocks: ReturnType<typeof buildPlatformMerchantSnapshotBlocks>,
) {
  const basePayload = {
    blocks,
    updated_at: new Date().toISOString(),
  };

  const queryExisting = async () => {
    const scoped = await supabase
      .from("pages")
      .select("id")
      .is("merchant_id", null)
      .eq("slug", PLATFORM_MERCHANT_SNAPSHOT_SLUG)
      .limit(1)
      .maybeSingle();
    if (!scoped.error) {
      return { record: (scoped.data ?? null) as { id?: string | number | null } | null, supportsSlug: true, supportsMerchantId: true };
    }

    const scopedMessage = toErrorMessage(scoped.error);
    if (isMissingMerchantIdColumn(scopedMessage)) {
      const bySlug = await supabase
        .from("pages")
        .select("id")
        .eq("slug", PLATFORM_MERCHANT_SNAPSHOT_SLUG)
        .limit(1)
        .maybeSingle();
      if (!bySlug.error) {
        return { record: (bySlug.data ?? null) as { id?: string | number | null } | null, supportsSlug: true, supportsMerchantId: false };
      }
      return { error: toErrorMessage(bySlug.error) };
    }

    if (isMissingSlugColumn(scopedMessage)) {
      return { error: "pages_slug_column_missing" };
    }

    return { error: scopedMessage };
  };

  const existing = await queryExisting();
  if ("error" in existing && existing.error) {
    return { error: existing.error };
  }

  const recordId = existing.record?.id;
  const payloadWithoutUpdatedAt = { blocks };
  const updatePayload = async (payload: Record<string, unknown>) => {
    if (recordId !== undefined && recordId !== null) {
      const updated = await supabase.from("pages").update(payload).eq("id", recordId);
      return updated.error ? { error: toErrorMessage(updated.error) } : { error: null };
    }

    if (existing.supportsSlug) {
      const inserted = await supabase.from("pages").insert({
        ...payload,
        slug: PLATFORM_MERCHANT_SNAPSHOT_SLUG,
        ...(existing.supportsMerchantId ? { merchant_id: null } : {}),
      });
      return inserted.error ? { error: toErrorMessage(inserted.error) } : { error: null };
    }

    return { error: "pages_slug_column_missing" };
  };

  const first = await updatePayload(basePayload);
  if (!first.error) return { error: null };
  if (!isMissingUpdatedAtColumn(first.error)) return first;
  return updatePayload(payloadWithoutUpdatedAt);
}

export async function POST(request: Request) {
  const cookieHeader = request.headers.get("cookie") ?? "";
  if (parseCookieValue(cookieHeader, SUPER_ADMIN_SESSION_COOKIE) !== SUPER_ADMIN_SESSION_VALUE) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = createServerSupabaseClient();
  if (!supabase) {
    return NextResponse.json({ error: "platform_merchant_snapshot_env_missing" }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const payload = normalizePlatformMerchantSnapshotPayload(body);
  if (payload.snapshot.length === 0) {
    return NextResponse.json({ error: "empty_snapshot" }, { status: 400 });
  }

  const saveResult = await savePlatformMerchantSnapshot(
    supabase,
    buildPlatformMerchantSnapshotBlocks(payload),
  );

  if (saveResult.error) {
    return NextResponse.json(
      {
        error: "platform_merchant_snapshot_save_failed",
        message: saveResult.error,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    count: payload.snapshot.length,
    defaultSortRule: payload.defaultSortRule,
  });
}
