import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { normalizeDomainPrefix } from "@/lib/merchantIdentity";
import { SUPER_ADMIN_SESSION_COOKIE, SUPER_ADMIN_SESSION_VALUE } from "@/lib/superAdminSession";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type MerchantRow = {
  id?: string | null;
};

type DomainBindingBody = {
  merchantId?: unknown;
  domainPrefix?: unknown;
};

function readEnv(name: string) {
  return (process.env[name] ?? "").trim();
}

function parseCookieValue(cookieHeader: string, key: string) {
  return cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${key}=`))
    ?.slice(key.length + 1) ?? "";
}

function normalizeEmail(value: string | null | undefined) {
  return String(value ?? "").trim().toLowerCase();
}

function isMissingSlugColumn(message: string) {
  return (
    /column\s+pages\.slug\s+does\s+not\s+exist/i.test(message) ||
    /could not find the ['"]slug['"] column of ['"]pages['"] in the schema cache/i.test(message)
  );
}

function isMissingUpdatedAtColumn(message: string) {
  return (
    /column\s+pages\.updated_at\s+does\s+not\s+exist/i.test(message) ||
    /could not find the ['"]updated_at['"] column of ['"]pages['"] in the schema cache/i.test(message)
  );
}

async function getAuthorizedMerchantIds(
  supabase: any,
  userId: string,
  email: string,
) {
  const lookups: Array<PromiseLike<{ data: MerchantRow[] | null; error: { message?: string } | null }>> = [];

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
  supabase: any,
  merchantId: string,
) {
  const cookieHeader = request.headers.get("cookie") ?? "";
  if (parseCookieValue(cookieHeader, SUPER_ADMIN_SESSION_COOKIE) === SUPER_ADMIN_SESSION_VALUE) {
    return true;
  }

  const authHeader = request.headers.get("authorization") ?? "";
  const tokenMatch = authHeader.match(/^Bearer\s+(.+)$/i);
  const accessToken = tokenMatch?.[1]?.trim() ?? "";
  if (!accessToken) return false;

  const authResult = await supabase.auth.getUser(accessToken);
  if (authResult.error || !authResult.data.user) return false;

  const authorizedMerchantIds = await getAuthorizedMerchantIds(
    supabase,
    String(authResult.data.user.id ?? "").trim(),
    normalizeEmail(authResult.data.user.email),
  );
  return authorizedMerchantIds.includes(merchantId);
}

async function updateMerchantSlug(
  supabase: any,
  merchantId: string,
  slug: string,
) {
  const { data: existing, error: existingError } = await supabase
    .from("pages")
    .select("id")
    .eq("merchant_id", merchantId)
    .limit(1)
    .maybeSingle();

  if (existingError) {
    return { ok: false, status: 409, message: existingError.message };
  }

  const existingRow = (existing ?? null) as { id?: string | number | null } | null;
  const rowId = String(existingRow?.id ?? "").trim();
  if (!rowId) {
    return { ok: true, updated: false };
  }

  const withUpdatedAt = await supabase
    .from("pages")
    .update({ slug, updated_at: new Date().toISOString() } as never)
    .eq("id", rowId);
  if (!withUpdatedAt.error) {
    return { ok: true, updated: true };
  }

  if (isMissingUpdatedAtColumn(withUpdatedAt.error.message)) {
    const withoutUpdatedAt = await supabase.from("pages").update({ slug } as never).eq("id", rowId);
    if (!withoutUpdatedAt.error) {
      return { ok: true, updated: true };
    }
    if (isMissingSlugColumn(withoutUpdatedAt.error.message)) {
      return { ok: false, status: 503, message: "pages.slug column missing" };
    }
    return { ok: false, status: 409, message: withoutUpdatedAt.error.message };
  }

  if (isMissingSlugColumn(withUpdatedAt.error.message)) {
    return { ok: false, status: 503, message: "pages.slug column missing" };
  }

  return { ok: false, status: 409, message: withUpdatedAt.error.message };
}

export async function POST(request: Request) {
  const supabaseUrl = readEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = readEnv("SUPABASE_SERVICE_ROLE_KEY") || readEnv("NEXT_SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json({ error: "merchant_domain_binding_env_missing" }, { status: 503 });
  }

  let body: DomainBindingBody | null = null;
  try {
    body = (await request.json()) as DomainBindingBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const merchantId = String(body?.merchantId ?? "").trim();
  const domainPrefix = normalizeDomainPrefix(String(body?.domainPrefix ?? ""));
  if (!merchantId || !domainPrefix) {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }

  try {
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });

    const authorized = await isAuthorizedForMerchant(request, supabase, merchantId);
    if (!authorized) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const result = await updateMerchantSlug(supabase, merchantId, domainPrefix);
    if (!result.ok) {
      return NextResponse.json(
        {
          error: "merchant_domain_binding_failed",
          message: result.message,
        },
        { status: result.status },
      );
    }

    return NextResponse.json({
      ok: true,
      merchantId,
      slug: domainPrefix,
      updated: result.updated,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "merchant_domain_binding_failed",
        message: error instanceof Error ? error.message : "unknown_error",
      },
      { status: 500 },
    );
  }
}
