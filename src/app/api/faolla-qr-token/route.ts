import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { createServerSupabaseServiceClient } from "@/lib/superAdminServer";
import { resolvePersonalAccountSessionFromRequest } from "@/lib/personalAccountSession.server";
import { resolveMerchantSessionFromRequest } from "@/lib/serverMerchantSession";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

type QrAccountType = "merchant" | "personal";

type QrTokenEntry = {
  token: string;
  updatedAt: string;
};

type QrTokenPayload = {
  type: "faolla_qr_tokens";
  version: 1;
  entries: Record<string, QrTokenEntry>;
};

const FAOLLA_QR_TOKEN_SLUG = "__faolla_qr_tokens__";

function trimText(value: unknown, maxLength = 4096) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function normalizeAccountId(value: unknown) {
  const normalized = trimText(value, 32);
  return /^\d{8}$/.test(normalized) ? normalized : "";
}

function normalizeQrAccountType(value: unknown): QrAccountType | "" {
  return value === "merchant" || value === "personal" ? value : "";
}

function noStoreJson(body: unknown, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("cache-control", "no-store");
  return response;
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

function buildEntryKey(type: QrAccountType, accountId: string) {
  return `${type}:${accountId}`;
}

function createQrToken() {
  return randomUUID().replace(/-/g, "");
}

function readQrTokenPayload(blocks: unknown): QrTokenPayload {
  if (!blocks || typeof blocks !== "object") {
    return { type: "faolla_qr_tokens", version: 1, entries: {} };
  }
  const record = blocks as { entries?: unknown };
  const entries: Record<string, QrTokenEntry> = {};
  if (record.entries && typeof record.entries === "object" && !Array.isArray(record.entries)) {
    Object.entries(record.entries as Record<string, unknown>).forEach(([key, rawEntry]) => {
      if (!rawEntry || typeof rawEntry !== "object") return;
      const token = trimText((rawEntry as { token?: unknown }).token, 128);
      if (!token) return;
      entries[key] = {
        token,
        updatedAt: trimText((rawEntry as { updatedAt?: unknown }).updatedAt, 64) || new Date(0).toISOString(),
      };
    });
  }
  return { type: "faolla_qr_tokens", version: 1, entries };
}

async function loadQrTokenPayload(supabase: NonNullable<ReturnType<typeof createServerSupabaseServiceClient>>) {
  const initialQuery = await supabase
    .from("pages")
    .select("blocks")
    .is("merchant_id", null)
    .eq("slug", FAOLLA_QR_TOKEN_SLUG)
    .limit(1)
    .maybeSingle();

  let data = initialQuery.data as { blocks?: unknown } | null;
  let error = initialQuery.error;

  if (error) {
    const message = toErrorMessage(error);
    if (isMissingMerchantIdColumn(message)) {
      const bySlug = await supabase.from("pages").select("blocks").eq("slug", FAOLLA_QR_TOKEN_SLUG).limit(1).maybeSingle();
      data = bySlug.data as { blocks?: unknown } | null;
      error = bySlug.error;
    } else if (isMissingSlugColumn(message)) {
      return { payload: readQrTokenPayload(null), error: "pages_slug_column_missing" };
    } else {
      return { payload: readQrTokenPayload(null), error: message };
    }
  }

  if (error) return { payload: readQrTokenPayload(null), error: toErrorMessage(error) };
  return { payload: readQrTokenPayload(data?.blocks), error: null };
}

async function saveQrTokenPayload(
  supabase: NonNullable<ReturnType<typeof createServerSupabaseServiceClient>>,
  payload: QrTokenPayload,
) {
  const blocks = {
    type: payload.type,
    version: payload.version,
    entries: payload.entries,
  };
  const basePayload = {
    blocks,
    updated_at: new Date().toISOString(),
  };

  const queryExisting = async () => {
    const scoped = await supabase
      .from("pages")
      .select("id")
      .is("merchant_id", null)
      .eq("slug", FAOLLA_QR_TOKEN_SLUG)
      .limit(1)
      .maybeSingle();
    if (!scoped.error) {
      return {
        record: (scoped.data ?? null) as { id?: string | number | null } | null,
        supportsSlug: true,
        supportsMerchantId: true,
      };
    }

    const scopedMessage = toErrorMessage(scoped.error);
    if (isMissingMerchantIdColumn(scopedMessage)) {
      const bySlug = await supabase.from("pages").select("id").eq("slug", FAOLLA_QR_TOKEN_SLUG).limit(1).maybeSingle();
      if (!bySlug.error) {
        return {
          record: (bySlug.data ?? null) as { id?: string | number | null } | null,
          supportsSlug: true,
          supportsMerchantId: false,
        };
      }
      return { error: toErrorMessage(bySlug.error) };
    }

    if (isMissingSlugColumn(scopedMessage)) return { error: "pages_slug_column_missing" };
    return { error: scopedMessage };
  };

  const existing = await queryExisting();
  if ("error" in existing && existing.error) return { error: existing.error };

  const updatePayload = async (body: Record<string, unknown>) => {
    const recordId = existing.record?.id;
    if (recordId !== undefined && recordId !== null) {
      const updated = await supabase.from("pages").update(body).eq("id", recordId);
      return updated.error ? { error: toErrorMessage(updated.error) } : { error: null };
    }
    if (existing.supportsSlug) {
      const inserted = await supabase.from("pages").insert({
        ...body,
        slug: FAOLLA_QR_TOKEN_SLUG,
        ...(existing.supportsMerchantId ? { merchant_id: null } : {}),
      });
      return inserted.error ? { error: toErrorMessage(inserted.error) } : { error: null };
    }
    return { error: "pages_slug_column_missing" };
  };

  const first = await updatePayload(basePayload);
  if (!first.error) return { error: null };
  if (!isMissingUpdatedAtColumn(first.error)) return first;
  return updatePayload({ blocks });
}

async function isAuthorizedOwner(request: Request, type: QrAccountType, accountId: string) {
  if (type === "personal") {
    const session = await resolvePersonalAccountSessionFromRequest(request);
    return session?.accountId === accountId;
  }
  const session = await resolveMerchantSessionFromRequest(request, { hintedMerchantId: accountId });
  return session?.merchantId === accountId;
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const type = normalizeQrAccountType(requestUrl.searchParams.get("type"));
  const accountId = normalizeAccountId(requestUrl.searchParams.get("id"));
  if (!type || !accountId) return noStoreJson({ error: "invalid_qr_account" }, { status: 400 });

  const supabase = createServerSupabaseServiceClient();
  if (!supabase) return noStoreJson({ error: "supabase_not_configured" }, { status: 503 });

  const { payload, error } = await loadQrTokenPayload(supabase);
  if (error && error !== "pages_slug_column_missing") {
    return noStoreJson({ error: "qr_token_load_failed", message: error }, { status: 500 });
  }

  const key = buildEntryKey(type, accountId);
  const mode = trimText(requestUrl.searchParams.get("mode"), 32);
  if (mode === "validate") {
    const token = trimText(requestUrl.searchParams.get("token"), 128);
    return noStoreJson({ ok: true, valid: Boolean(token && payload.entries[key]?.token === token) });
  }

  const authorized = await isAuthorizedOwner(request, type, accountId);
  if (!authorized) return noStoreJson({ error: "unauthorized" }, { status: 401 });

  const ensure = requestUrl.searchParams.get("ensure") === "1";
  let entry = payload.entries[key] ?? null;
  if (!entry && ensure) {
    entry = { token: createQrToken(), updatedAt: new Date().toISOString() };
    const nextPayload: QrTokenPayload = {
      ...payload,
      entries: {
        ...payload.entries,
        [key]: entry,
      },
    };
    const saveResult = await saveQrTokenPayload(supabase, nextPayload);
    if (saveResult.error) {
      return noStoreJson({ error: "qr_token_save_failed", message: saveResult.error }, { status: 500 });
    }
  }

  return noStoreJson({ ok: true, token: entry?.token ?? "", updatedAt: entry?.updatedAt ?? "" });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    type?: unknown;
    id?: unknown;
    action?: unknown;
  } | null;
  const type = normalizeQrAccountType(body?.type);
  const accountId = normalizeAccountId(body?.id);
  const action = trimText(body?.action, 32);
  if (!type || !accountId) return noStoreJson({ error: "invalid_qr_account" }, { status: 400 });
  if (action !== "reset") return noStoreJson({ error: "unsupported_action" }, { status: 400 });

  const authorized = await isAuthorizedOwner(request, type, accountId);
  if (!authorized) return noStoreJson({ error: "unauthorized" }, { status: 401 });

  const supabase = createServerSupabaseServiceClient();
  if (!supabase) return noStoreJson({ error: "supabase_not_configured" }, { status: 503 });

  const { payload, error } = await loadQrTokenPayload(supabase);
  if (error && error !== "pages_slug_column_missing") {
    return noStoreJson({ error: "qr_token_load_failed", message: error }, { status: 500 });
  }

  const key = buildEntryKey(type, accountId);
  const entry = { token: createQrToken(), updatedAt: new Date().toISOString() };
  const nextPayload: QrTokenPayload = {
    ...payload,
    entries: {
      ...payload.entries,
      [key]: entry,
    },
  };
  const saveResult = await saveQrTokenPayload(supabase, nextPayload);
  if (saveResult.error) {
    return noStoreJson({ error: "qr_token_save_failed", message: saveResult.error }, { status: 500 });
  }

  return noStoreJson({ ok: true, token: entry.token, updatedAt: entry.updatedAt });
}
