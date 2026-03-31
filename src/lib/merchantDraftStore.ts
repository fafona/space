import type { Block } from "@/data/homeBlocks";
import { sanitizeBlocksForRuntime } from "@/lib/blocksSanitizer";

const MERCHANT_DRAFT_SLUG_PREFIX = "__merchant_draft__:";

type DraftErrorLike = { message?: string } | null;

type DraftQueryBuilder = PromiseLike<{ data?: unknown; error: DraftErrorLike }> & {
  select: (columns: string) => DraftQueryBuilder;
  update: (payload: Record<string, unknown>) => DraftQueryBuilder;
  insert: (payload: Record<string, unknown>) => Promise<{ data?: unknown; error: DraftErrorLike }>;
  is: (column: string, value: unknown) => DraftQueryBuilder;
  eq: (column: string, value: unknown) => DraftQueryBuilder;
  limit: (value: number) => DraftQueryBuilder;
  maybeSingle: () => Promise<{ data?: unknown; error: DraftErrorLike }>;
};

export type MerchantDraftStoreClient = {
  from: (table: string) => DraftQueryBuilder;
};

export type StoredMerchantDraft = {
  siteId: string;
  blocks: Block[];
  updatedAt: string | null;
};

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeSiteId(value: unknown) {
  return normalizeText(value);
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

function buildMerchantDraftSlug(siteId: string) {
  return `${MERCHANT_DRAFT_SLUG_PREFIX}${siteId}`;
}

export async function loadStoredMerchantDraft(
  supabase: MerchantDraftStoreClient,
  siteId: string,
): Promise<StoredMerchantDraft | null> {
  const normalizedSiteId = normalizeSiteId(siteId);
  if (!normalizedSiteId) return null;
  const slug = buildMerchantDraftSlug(normalizedSiteId);

  const initialQuery = await supabase
    .from("pages")
    .select("blocks,updated_at")
    .is("merchant_id", null)
    .eq("slug", slug)
    .limit(1)
    .maybeSingle();

  let data = initialQuery.data as { blocks?: unknown; updated_at?: unknown } | null;
  let error = initialQuery.error;

  if (error) {
    const message = toErrorMessage(error);
    if (isMissingMerchantIdColumn(message)) {
      const bySlug = await supabase
        .from("pages")
        .select("blocks,updated_at")
        .eq("slug", slug)
        .limit(1)
        .maybeSingle();
      data = bySlug.data as { blocks?: unknown; updated_at?: unknown } | null;
      error = bySlug.error;
    } else if (isMissingSlugColumn(message)) {
      return null;
    } else {
      return null;
    }
  }

  if (error || !Array.isArray(data?.blocks)) return null;
  const sanitized = sanitizeBlocksForRuntime(data.blocks as Block[]).blocks;
  if (sanitized.length === 0) return null;
  return {
    siteId: normalizedSiteId,
    blocks: sanitized,
    updatedAt: typeof data?.updated_at === "string" ? data.updated_at.trim() : null,
  };
}

export async function saveStoredMerchantDraft(
  supabase: MerchantDraftStoreClient,
  input: {
    siteId: string;
    blocks: Block[];
    updatedAt?: string | null;
  },
): Promise<{ error: string | null }> {
  const normalizedSiteId = normalizeSiteId(input.siteId);
  if (!normalizedSiteId) return { error: "invalid_site_id" };
  const slug = buildMerchantDraftSlug(normalizedSiteId);
  const sanitizedBlocks = sanitizeBlocksForRuntime(Array.isArray(input.blocks) ? input.blocks : []).blocks;
  const updatedAt = normalizeText(input.updatedAt) || new Date().toISOString();
  const basePayload = {
    blocks: sanitizedBlocks,
    updated_at: updatedAt,
  };

  const queryExisting = async () => {
    const scoped = await supabase
      .from("pages")
      .select("id")
      .is("merchant_id", null)
      .eq("slug", slug)
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
      const bySlug = await supabase
        .from("pages")
        .select("id")
        .eq("slug", slug)
        .limit(1)
        .maybeSingle();
      if (!bySlug.error) {
        return {
          record: (bySlug.data ?? null) as { id?: string | number | null } | null,
          supportsSlug: true,
          supportsMerchantId: false,
        };
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

  const updatePayload = async (body: Record<string, unknown>) => {
    const recordId = existing.record?.id;
    if (recordId !== undefined && recordId !== null) {
      const updated = await supabase.from("pages").update(body).eq("id", recordId);
      return updated.error ? { error: toErrorMessage(updated.error) } : { error: null };
    }

    if (existing.supportsSlug) {
      const inserted = await supabase.from("pages").insert({
        ...body,
        slug,
        ...(existing.supportsMerchantId ? { merchant_id: null } : {}),
      });
      return inserted.error ? { error: toErrorMessage(inserted.error) } : { error: null };
    }

    return { error: "pages_slug_column_missing" };
  };

  const first = await updatePayload(basePayload);
  if (!first.error) return { error: null };
  if (!isMissingUpdatedAtColumn(first.error)) return first;
  return updatePayload({ blocks: sanitizedBlocks });
}
