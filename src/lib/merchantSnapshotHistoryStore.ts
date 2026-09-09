import {
  PLATFORM_ADMIN_BACKUP_WRITE_UNCONFIRMED,
  readPlatformAdminBackupRowForWriteStrict,
  persistPlatformAdminBackupRowStrict,
  type StrictPlatformAdminBackupWriteClient,
} from "@/lib/platformAdminBackupStrictWrite";
import { PLATFORM_SNAPSHOT_ATOMIC_SCOPES } from "@/lib/platformSnapshotAtomic.server";
import { getPlatformSnapshotWriteMode, PLATFORM_SNAPSHOT_ATOMIC_CONFIGURATION_INVALID } from "@/lib/platformSnapshotAtomicMode.server";

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

const REQUIRED_HISTORY_WRITE_ERROR = PLATFORM_ADMIN_BACKUP_WRITE_UNCONFIRMED;
type SnapshotHistoryInput = {
  siteId: string; slug: string; backupSlug: string; source: string;
  before: unknown; after: unknown; at?: string | null; maxEntries?: number; merchantId?: string | null;
  /** Refuse unsafe updates when the backing schema cannot CAS updated_at. */
  requireCompareAndSwap?: boolean;
  /** Restore-only null-owner history: require primary and backup acknowledgements. */
  requireAllWrites?: boolean;
};

function canonicalHistoryJson(value: unknown, depth = 0): string {
  if (depth > 64) throw new Error(REQUIRED_HISTORY_WRITE_ERROR);
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalHistoryJson(item, depth + 1)).join(",")}]`;
  if (!value || typeof value !== "object" || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    throw new Error(REQUIRED_HISTORY_WRITE_ERROR);
  }
  return `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right, "en"))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalHistoryJson(item, depth + 1)}`).join(",")}}`;
}

function validateRequiredHistory(value: unknown, siteId: string): MerchantSnapshotHistoryPayload {
  const fail = (): never => { throw new Error(REQUIRED_HISTORY_WRITE_ERROR); };
  const record = (item: unknown, keys: string[]): Record<string, unknown> => {
    if (!item || typeof item !== "object" || Array.isArray(item) ||
      Object.keys(item).some((key) => !keys.includes(key)) || keys.some((key) => !Object.hasOwn(item, key))) fail();
    return item as Record<string, unknown>;
  };
  const date = (item: unknown) => typeof item === "string" && !!item.trim() && Number.isFinite(Date.parse(item));
  const payload = record(value, ["siteId", "updatedAt", "entries"]);
  if (payload.siteId !== siteId || (payload.updatedAt !== null && !date(payload.updatedAt)) || !Array.isArray(payload.entries)) fail();
  const seen = new Set<string>();
  for (const item of payload.entries as unknown[]) {
    const entry = record(item, ["id", "siteId", "at", "source", "before", "after"]);
    const id = normalizeText(entry.id);
    if (!id || seen.has(id) || entry.siteId !== siteId || !date(entry.at) || !normalizeText(entry.source)) fail();
    canonicalHistoryJson(entry.before); canonicalHistoryJson(entry.after); seen.add(id);
  }
  return value as MerchantSnapshotHistoryPayload;
}

async function saveRequiredSnapshotHistory(
  supabase: MerchantSnapshotHistoryStoreClient, input: SnapshotHistoryInput,
): Promise<{ error: string | null }> {
  try {
    // This opt-in belongs only to platform restore; ordinary merchant histories
    // keep their existing compatibility/CAS path below.
    const siteId = normalizeText(input.siteId); const slug = normalizeText(input.slug); const backupSlug = normalizeText(input.backupSlug);
    const maxEntries = input.maxEntries ?? 240;
    if (!siteId || !slug || !backupSlug || slug === backupSlug || input.merchantId !== null || input.requireCompareAndSwap ||
      !Number.isSafeInteger(maxEntries) || maxEntries < 1 || maxEntries > 1000) {
      throw new Error(REQUIRED_HISTORY_WRITE_ERROR);
    }
    const client = supabase as StrictPlatformAdminBackupWriteClient;
    const reads = await Promise.allSettled([
      readPlatformAdminBackupRowForWriteStrict(client, slug),
      readPlatformAdminBackupRowForWriteStrict(client, backupSlug),
    ]);
    const primary = reads[0]; const backup = reads[1];
    if (primary.status !== "fulfilled" || backup.status !== "fulfilled") throw new Error(REQUIRED_HISTORY_WRITE_ERROR);
    const empty = (): MerchantSnapshotHistoryPayload => ({ siteId, updatedAt: null, entries: [] });
    const current = primary.value ? validateRequiredHistory(primary.value.blocks, siteId) : empty();
    const previousBackup = backup.value ? validateRequiredHistory(backup.value.blocks, siteId) : empty();
    const allEntries = new Map<string, MerchantSnapshotHistoryEntry>();
    for (const entry of [...current.entries, ...previousBackup.entries]) {
      const id = entry.id.trim(); const existing = allEntries.get(id);
      if (existing && canonicalHistoryJson(existing) !== canonicalHistoryJson(entry)) throw new Error(REQUIRED_HISTORY_WRITE_ERROR);
      allEntries.set(id, entry);
    }
    const at = normalizeText(input.at) || new Date().toISOString();
    const source = normalizeText(input.source) || "save";
    const entry: MerchantSnapshotHistoryEntry = { id: `${siteId}:${at}:${source}:${Math.random().toString(36).slice(2, 8)}`,
      siteId, at, source, before: input.before ?? null, after: input.after ?? null };
    const timestamp = Math.max(Date.now(), Date.parse(at), Date.parse(current.updatedAt ?? "") + 1 || 0,
      Date.parse(previousBackup.updatedAt ?? "") + 1 || 0);
    const next = { siteId, updatedAt: new Date(timestamp).toISOString(), entries: [entry, ...allEntries.values()] };
    validateRequiredHistory(next, siteId);
    const normalized = normalizeHistoryPayload(next, siteId);
    const payload = { ...normalized, entries: normalized.entries.slice(0, maxEntries) };
    // Sequential writes: on failure there is no already-started sibling left
    // behind. Earlier writes may remain; this is deliberately not atomic/CAS.
    await persistPlatformAdminBackupRowStrict(client, slug, payload, primary.value);
    await persistPlatformAdminBackupRowStrict(client, backupSlug, payload, backup.value);
    return { error: null };
  } catch {
    return { error: REQUIRED_HISTORY_WRITE_ERROR };
  }
}

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

function isUniqueConstraintError(message: string) {
  return /duplicate key|unique constraint|already exists/i.test(message);
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
  requireCompareAndSwap = false,
): Promise<{ error: string | null; conflict?: boolean }> {
  const existing = existingLookup ?? (await querySnapshotHistoryRow(supabase, siteId, slug, "id", merchantId));
  if (existing.error) return { error: existing.error };

  const updatedAt = payload.updatedAt || new Date().toISOString();
  const bodyWithUpdatedAt = { blocks: payload, updated_at: updatedAt };
  const bodyWithoutUpdatedAt = { blocks: payload };
  const existingUpdatedAt = normalizeText(existing.row?.updated_at);
  const write = async (body: Record<string, unknown>, useUpdatedAtGuard: boolean) => {
    if (existing.row?.id !== undefined && existing.row.id !== null) {
      let updateQuery = supabase.from("pages").update(body).eq("id", existing.row.id);
      if (useUpdatedAtGuard && existingUpdatedAt) {
        updateQuery = updateQuery.eq("updated_at", existingUpdatedAt);
      }
      const selectable = updateQuery as { select?: (columns: string) => Promise<{ data?: unknown; error?: unknown }> };
      const updated =
        typeof selectable.select === "function"
          ? await selectable.select("id")
          : await updateQuery;
      if (updated.error) return { error: toErrorMessage(updated.error), conflict: false };
      if (
        useUpdatedAtGuard &&
        existingUpdatedAt &&
        Array.isArray(updated.data) &&
        updated.data.length === 0
      ) {
        return { error: "history_revision_conflict", conflict: true };
      }
      return { error: null, conflict: false };
    }
    const inserted = await supabase.from("pages").insert({
      ...body,
      slug,
      ...(existing.supportsMerchantId ? { merchant_id: merchantId } : {}),
    });
    if (inserted.error) {
      const error = toErrorMessage(inserted.error);
      return { error, conflict: isUniqueConstraintError(error) };
    }
    return { error: null, conflict: false };
  };

  const first = await write(bodyWithUpdatedAt, true);
  if (!first.error) return first;
  if (first.conflict) return first;
  if (!isMissingUpdatedAtColumn(first.error)) return first;
  if (requireCompareAndSwap && existing.row?.id !== undefined && existing.row.id !== null) {
    return { error: "history_cas_unavailable", conflict: false };
  }
  return write(bodyWithoutUpdatedAt, false);
}

export async function saveMerchantSnapshotHistory(
  supabase: MerchantSnapshotHistoryStoreClient,
  input: SnapshotHistoryInput,
): Promise<{ error: string | null }> {
  // These rows belong to a complete atomic scope. This generic two-row writer
  // cannot safely participate, including its restore-only strict branch.
  const internalSlugs = Object.values(PLATFORM_SNAPSHOT_ATOMIC_SCOPES).flat() as readonly string[];
  if (internalSlugs.includes(normalizeText(input.slug)) || internalSlugs.includes(normalizeText(input.backupSlug))) {
    try {
      if (getPlatformSnapshotWriteMode() === "atomic") return { error: "platform_snapshot_atomic_direct_write_forbidden" };
    } catch {
      return { error: PLATFORM_SNAPSHOT_ATOMIC_CONFIGURATION_INVALID };
    }
  }
  if (input.requireAllWrites) return saveRequiredSnapshotHistory(supabase, input);
  const siteId = normalizeText(input.siteId);
  const slug = normalizeText(input.slug);
  const backupSlug = normalizeText(input.backupSlug);
  if (!siteId || !slug || !backupSlug) return { error: "invalid_history_input" };

  const at = normalizeText(input.at) || new Date().toISOString();
  const source = normalizeText(input.source) || "save";
  const entry: MerchantSnapshotHistoryEntry = {
    id: `${siteId}:${at}:${source}:${Math.random().toString(36).slice(2, 8)}`,
    siteId,
    at,
    source,
    before: input.before ?? null,
    after: input.after ?? null,
  };
  const merchantId =
    Object.prototype.hasOwnProperty.call(input, "merchantId") && input.merchantId === null
      ? null
      : normalizeText(input.merchantId) || siteId;
  const [current, backupCurrent] = await Promise.all([
    querySnapshotHistoryRow(supabase, siteId, slug, "id,blocks,updated_at", merchantId),
    querySnapshotHistoryRow(supabase, siteId, backupSlug, "id,blocks,updated_at", merchantId),
  ]);
  if (current.error) return { error: current.error };
  const maxEntries = Math.max(1, Math.min(1000, input.maxEntries ?? 240));
  const buildPayload = (
    lookup: SnapshotHistoryRowLookup,
    additions: MerchantSnapshotHistoryEntry[],
  ) => {
    const currentPayload = normalizeHistoryPayload(lookup.row?.blocks, siteId);
    const currentStamp = Date.parse(currentPayload.updatedAt ?? "");
    const incomingStamp = Math.max(...additions.map((item) => Date.parse(item.at)).filter(Number.isFinite));
    const nextStamp = Math.max(
      Date.now(),
      Number.isFinite(incomingStamp) ? incomingStamp : 0,
      Number.isFinite(currentStamp) ? currentStamp + 1 : 0,
    );
    const updatedAt = new Date(nextStamp).toISOString();
    const normalized = normalizeHistoryPayload(
      {
        siteId,
        updatedAt,
        entries: [...additions, ...currentPayload.entries],
      },
      siteId,
    );
    return { ...normalized, entries: normalized.entries.slice(0, maxEntries) };
  };

  let primaryLookup = current;
  let nextPayload: MerchantSnapshotHistoryPayload | null = null;
  let primary: { error: string | null; conflict?: boolean } = { error: "history_revision_conflict" };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    nextPayload = buildPayload(primaryLookup, [entry]);
    primary = await persistSnapshotHistoryPayload(
      supabase,
      siteId,
      slug,
      nextPayload,
      merchantId,
      primaryLookup,
      input.requireCompareAndSwap === true,
    );
    if (!primary.conflict) break;
    primaryLookup = await querySnapshotHistoryRow(supabase, siteId, slug, "id,blocks,updated_at", merchantId);
    if (primaryLookup.error) return { error: primaryLookup.error };
  }
  if (primary.error) return { error: primary.error };

  let backup: { error: string | null; conflict?: boolean } = backupCurrent.error
    ? { error: backupCurrent.error, conflict: false }
    : { error: "history_revision_conflict", conflict: true };
  let backupLookup = backupCurrent;
  for (let attempt = 0; !backupCurrent.error && attempt < 3; attempt += 1) {
    const backupPayload = buildPayload(backupLookup, nextPayload?.entries ?? [entry]);
    backup = await persistSnapshotHistoryPayload(
      supabase,
      siteId,
      backupSlug,
      backupPayload,
      merchantId,
      backupLookup,
      input.requireCompareAndSwap === true,
    );
    if (!backup.conflict) break;
    backupLookup = await querySnapshotHistoryRow(supabase, siteId, backupSlug, "id,blocks,updated_at", merchantId);
    if (backupLookup.error) {
      backup = { error: backupLookup.error, conflict: false };
      break;
    }
  }
  if (backup.error && typeof console !== "undefined") {
    console.error("[merchant-snapshot-history] backup save failed", backup.error);
  }
  return { error: null };
}
