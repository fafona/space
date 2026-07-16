export type MerchantSnapshotHistoryStoreClient = {
  // Supabase query builders are heavily generic; this store only relies on runtime chaining.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (table: string) => any;
};

type StoredSnapshotHistoryRow = {
  id?: string | number | null;
  blocks?: unknown;
  updated_at?: unknown;
};

type SnapshotHistoryRowLookup = {
  row: StoredSnapshotHistoryRow | null;
  error: string | null;
  supportsMerchantId: boolean;
};

export type MerchantSnapshotHistoryEntry = {
  id: string;
  siteId: string;
  at: string;
  source: string;
  before: unknown;
  after: unknown;
};

export type MerchantSnapshotHistoryPayload = {
  siteId: string;
  updatedAt: string | null;
  entries: MerchantSnapshotHistoryEntry[];
};

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
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

function normalizeHistoryEntry(value: unknown): MerchantSnapshotHistoryEntry | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Partial<MerchantSnapshotHistoryEntry>;
  const id = normalizeText(input.id);
  const siteId = normalizeText(input.siteId);
  const at = normalizeText(input.at);
  const source = normalizeText(input.source);
  if (!id || !siteId || !at) return null;
  return {
    id,
    siteId,
    at,
    source: source || "save",
    before: input.before ?? null,
    after: input.after ?? null,
  };
}

function normalizeHistoryPayload(value: unknown, siteId: string): MerchantSnapshotHistoryPayload {
  const record = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const entries = Array.isArray(record.entries)
    ? record.entries.map((item) => normalizeHistoryEntry(item)).filter((item): item is MerchantSnapshotHistoryEntry => !!item)
    : [];
  const deduped = new Map<string, MerchantSnapshotHistoryEntry>();
  entries.forEach((entry) => {
    if (entry.siteId === siteId) deduped.set(entry.id, entry);
  });
  return {
    siteId,
    updatedAt: normalizeText(record.updatedAt) || null,
    entries: [...deduped.values()].sort((left, right) => {
      const delta = Date.parse(right.at) - Date.parse(left.at);
      if (Number.isFinite(delta) && delta !== 0) return delta;
      return right.id.localeCompare(left.id, "en");
    }),
  };
}

async function querySnapshotHistoryRow(
  supabase: MerchantSnapshotHistoryStoreClient,
  siteId: string,
  slug: string,
  columns: string,
  merchantId: string | null = siteId,
): Promise<SnapshotHistoryRowLookup> {
  const merchantQuery = supabase.from("pages").select(columns);
  const byMerchant = await (merchantId === null ? merchantQuery.is("merchant_id", null) : merchantQuery.eq("merchant_id", merchantId))
    .eq("slug", slug)
    .limit(1);

  if (!byMerchant.error) {
    const rows = Array.isArray(byMerchant.data) ? byMerchant.data : [];
    if (rows[0]) return { row: rows[0] as StoredSnapshotHistoryRow, error: null, supportsMerchantId: true };
  } else {
    const message = toErrorMessage(byMerchant.error);
    if (isMissingSlugColumn(message)) return { row: null, error: "pages_slug_column_missing", supportsMerchantId: true };
    if (!isMissingMerchantIdColumn(message) && !isMissingUpdatedAtColumn(message)) {
      return { row: null, error: message, supportsMerchantId: true };
    }
    if (isMissingUpdatedAtColumn(message) && columns.includes("updated_at")) {
      return querySnapshotHistoryRow(
        supabase,
        siteId,
        slug,
        columns.replace(/,?updated_at,?/g, ",").replace(/,+/g, ",").replace(/^,|,$/g, ""),
        merchantId,
      );
    }
  }

  const bySlug = await supabase.from("pages").select(columns).eq("slug", slug).limit(1);
  if (!bySlug.error) {
    const rows = Array.isArray(bySlug.data) ? bySlug.data : [];
    return { row: (rows[0] ?? null) as StoredSnapshotHistoryRow | null, error: null, supportsMerchantId: !byMerchant.error };
  }
  const message = toErrorMessage(bySlug.error);
  if (isMissingUpdatedAtColumn(message) && columns.includes("updated_at")) {
    return querySnapshotHistoryRow(
      supabase,
      siteId,
      slug,
      columns.replace(/,?updated_at,?/g, ",").replace(/,+/g, ",").replace(/^,|,$/g, ""),
      merchantId,
    );
  }
  return { row: null, error: isMissingSlugColumn(message) ? "pages_slug_column_missing" : message, supportsMerchantId: false };
}

async function persistSnapshotHistoryPayload(
  supabase: MerchantSnapshotHistoryStoreClient,
  siteId: string,
  slug: string,
  payload: MerchantSnapshotHistoryPayload,
  merchantId: string | null = siteId,
  existingLookup?: SnapshotHistoryRowLookup,
): Promise<{ error: string | null }> {
  const existing = existingLookup ?? (await querySnapshotHistoryRow(supabase, siteId, slug, "id", merchantId));
  if (existing.error) return { error: existing.error };

  const updatedAt = payload.updatedAt || new Date().toISOString();
  const bodyWithUpdatedAt = { blocks: payload, updated_at: updatedAt };
  const bodyWithoutUpdatedAt = { blocks: payload };
  const write = async (body: Record<string, unknown>) => {
    if (existing.row?.id !== undefined && existing.row.id !== null) {
      const updated = await supabase.from("pages").update(body).eq("id", existing.row.id);
      return updated.error ? { error: toErrorMessage(updated.error) } : { error: null };
    }
    const inserted = await supabase.from("pages").insert({
      ...body,
      slug,
      ...(existing.supportsMerchantId ? { merchant_id: merchantId } : {}),
    });
    return inserted.error ? { error: toErrorMessage(inserted.error) } : { error: null };
  };

  const first = await write(bodyWithUpdatedAt);
  if (!first.error) return first;
  if (!isMissingUpdatedAtColumn(first.error)) return first;
  return write(bodyWithoutUpdatedAt);
}

export async function saveMerchantSnapshotHistory(
  supabase: MerchantSnapshotHistoryStoreClient,
  input: {
    siteId: string;
    slug: string;
    backupSlug: string;
    source: string;
    before: unknown;
    after: unknown;
    at?: string | null;
    maxEntries?: number;
    merchantId?: string | null;
  },
): Promise<{ error: string | null }> {
  const siteId = normalizeText(input.siteId);
  const slug = normalizeText(input.slug);
  const backupSlug = normalizeText(input.backupSlug);
  if (!siteId || !slug || !backupSlug) return { error: "invalid_history_input" };

  const at = normalizeText(input.at) || new Date().toISOString();
  const id = `${siteId}:${at}:${normalizeText(input.source) || "save"}:${Math.random().toString(36).slice(2, 8)}`;
  const merchantId =
    Object.prototype.hasOwnProperty.call(input, "merchantId") && input.merchantId === null
      ? null
      : normalizeText(input.merchantId) || siteId;
  const [current, backupCurrent] = await Promise.all([
    querySnapshotHistoryRow(supabase, siteId, slug, "id,blocks,updated_at", merchantId),
    querySnapshotHistoryRow(supabase, siteId, backupSlug, "id", merchantId),
  ]);
  if (current.error) return { error: current.error };
  const currentPayload = normalizeHistoryPayload(current.row?.blocks, siteId);
  const maxEntries = Math.max(1, Math.min(1000, input.maxEntries ?? 240));
  const nextPayload = normalizeHistoryPayload(
    {
      siteId,
      updatedAt: at,
      entries: [
        {
          id,
          siteId,
          at,
          source: normalizeText(input.source) || "save",
          before: input.before ?? null,
          after: input.after ?? null,
        },
        ...currentPayload.entries,
      ].slice(0, maxEntries),
    },
    siteId,
  );

  const primary = await persistSnapshotHistoryPayload(supabase, siteId, slug, nextPayload, merchantId, current);
  if (primary.error) return primary;
  const backup = backupCurrent.error
    ? { error: backupCurrent.error }
    : await persistSnapshotHistoryPayload(supabase, siteId, backupSlug, nextPayload, merchantId, backupCurrent);
  if (backup.error && typeof console !== "undefined") {
    console.error("[merchant-snapshot-history] backup save failed", backup.error);
  }
  return { error: null };
}
