import {
  PLATFORM_MERCHANT_SNAPSHOT_SLUG,
  buildPlatformMerchantSnapshotBlocks,
  readPlatformMerchantSnapshotFromBlocks,
  type PlatformMerchantSnapshotPayload,
} from "@/lib/platformMerchantSnapshot";

type SnapshotErrorLike = { message?: string } | null;

type SnapshotQueryBuilder = PromiseLike<{ data?: unknown; error: SnapshotErrorLike }> & {
  select: (columns: string) => SnapshotQueryBuilder;
  update: (payload: Record<string, unknown>) => SnapshotQueryBuilder;
  insert: (payload: Record<string, unknown>) => Promise<{ data?: unknown; error: SnapshotErrorLike }>;
  is: (column: string, value: unknown) => SnapshotQueryBuilder;
  eq: (column: string, value: unknown) => SnapshotQueryBuilder;
  limit: (value: number) => SnapshotQueryBuilder;
  maybeSingle: () => Promise<{ data?: unknown; error: SnapshotErrorLike }>;
};

export type PlatformMerchantSnapshotStoreClient = {
  from: (table: string) => SnapshotQueryBuilder;
};

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

export async function loadStoredPlatformMerchantSnapshot(
  supabase: PlatformMerchantSnapshotStoreClient,
): Promise<PlatformMerchantSnapshotPayload | null> {
  const initialQuery = await supabase
    .from("pages")
    .select("blocks")
    .is("merchant_id", null)
    .eq("slug", PLATFORM_MERCHANT_SNAPSHOT_SLUG)
    .limit(1)
    .maybeSingle();

  let data = initialQuery.data as { blocks?: unknown } | null;
  let error = initialQuery.error;

  if (error) {
    const message = toErrorMessage(error);
    if (isMissingMerchantIdColumn(message)) {
      const bySlug = await supabase
        .from("pages")
        .select("blocks")
        .eq("slug", PLATFORM_MERCHANT_SNAPSHOT_SLUG)
        .limit(1)
        .maybeSingle();
      data = bySlug.data as { blocks?: unknown } | null;
      error = bySlug.error;
    } else if (isMissingSlugColumn(message)) {
      return null;
    } else {
      return null;
    }
  }

  if (error) return null;
  const payload = readPlatformMerchantSnapshotFromBlocks(data?.blocks);
  return payload && payload.snapshot.length > 0 ? payload : null;
}

export async function savePlatformMerchantSnapshot(
  supabase: PlatformMerchantSnapshotStoreClient,
  payload: PlatformMerchantSnapshotPayload,
): Promise<{ error: string | null }> {
  const blocks = buildPlatformMerchantSnapshotBlocks(payload);
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
        .eq("slug", PLATFORM_MERCHANT_SNAPSHOT_SLUG)
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

  const recordId = existing.record?.id;
  const payloadWithoutUpdatedAt = { blocks };
  const updatePayload = async (body: Record<string, unknown>) => {
    if (recordId !== undefined && recordId !== null) {
      const updated = await supabase.from("pages").update(body).eq("id", recordId);
      return updated.error ? { error: toErrorMessage(updated.error) } : { error: null };
    }

    if (existing.supportsSlug) {
      const inserted = await supabase.from("pages").insert({
        ...body,
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
