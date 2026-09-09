/** Restore-only storage contract. This is neither a transaction nor a database lock. */
export const PLATFORM_ADMIN_BACKUP_WRITE_UNCONFIRMED = "super_admin_backup_write_unconfirmed";

type QueryResult = { data?: unknown; error?: unknown };
type StrictWriteQuery = PromiseLike<QueryResult> & {
  select(columns: string): StrictWriteQuery;
  update(body: Record<string, unknown>): StrictWriteQuery;
  insert(body: Record<string, unknown>): PromiseLike<QueryResult>;
  is(column: string, value: unknown): StrictWriteQuery;
  eq(column: string, value: unknown): StrictWriteQuery;
  limit(count: number): StrictWriteQuery;
  maybeSingle(): PromiseLike<QueryResult>;
};
export type StrictPlatformAdminBackupWriteClient = { from(table: string): StrictWriteQuery };
export type PlatformAdminBackupWriteRow = { id: string | number; blocks: unknown };

const SLUGS = new Set([
  "__platform_admin_data_backup__", "__platform_admin_data_backup_backup__",
  "__platform_merchant_snapshot__", "__platform_merchant_snapshot_backup__",
  "__platform_merchant_snapshot_history__", "__platform_merchant_snapshot_history_backup__",
  "__platform_merchant_config_archive__", "__platform_merchant_config_archive_backup__",
  "__platform_support_inbox__", "__platform_support_inbox_history__", "__platform_support_inbox_history_backup__",
]);

function fail(): never { throw new Error(PLATFORM_ADMIN_BACKUP_WRITE_UNCONFIRMED); }
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function validId(value: unknown): value is string | number {
  return typeof value === "string" ? value.length > 0 && value === value.trim()
    : typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

// JSON object key order is not significant in jsonb. Arrays and every value are.
function canonical(value: unknown, depth = 0): string {
  if (depth > 128) return fail();
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) {
    const items: string[] = [];
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.hasOwn(value, index)) return fail();
      items.push(canonical(value[index], depth + 1));
    }
    return `[${items.join(",")}]`;
  }
  if (record(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)) {
    // Builders may include absent optional object properties; JSON transport omits these.
    return `{${Object.keys(value).filter((key) => value[key] !== undefined).sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key], depth + 1)}`).join(",")}}`;
  }
  return fail();
}

/** No cache, missing-column fallback, limit-one duplicate masking or foreign-owner adoption. */
export async function readPlatformAdminBackupRowForWriteStrict(
  client: StrictPlatformAdminBackupWriteClient, slug: string,
): Promise<PlatformAdminBackupWriteRow | null> {
  try {
    if (!SLUGS.has(slug)) fail();
    const result = await client.from("pages").select("id,blocks").is("merchant_id", null)
      .eq("slug", slug).limit(2).maybeSingle();
    if (!result || result.error !== null || result.data === undefined) fail();
    if (result.data === null) {
      const otherOwner = await client.from("pages").select("id").eq("slug", slug).limit(1).maybeSingle();
      if (!otherOwner || otherOwner.error !== null || otherOwner.data !== null) fail();
      return null;
    }
    if (!record(result.data) || !validId(result.data.id) || !Object.hasOwn(result.data, "blocks")) fail();
    canonical(result.data.blocks);
    return { id: result.data.id, blocks: result.data.blocks };
  } catch { return fail(); }
}

/** Confirm a scoped write and observed contents. A later/cross-instance writer can still change them. */
export async function persistPlatformAdminBackupRowStrict(
  client: StrictPlatformAdminBackupWriteClient, slug: string, blocks: unknown,
  existing: PlatformAdminBackupWriteRow | null,
): Promise<void> {
  try {
    if (!SLUGS.has(slug)) fail();
    const expected = canonical(blocks);
    const body = { blocks, updated_at: new Date().toISOString() };
    if (existing !== null) {
      if (!validId(existing.id)) fail();
      const result = await client.from("pages").update(body).eq("id", existing.id)
        .eq("slug", slug).is("merchant_id", null).select("id").maybeSingle();
      if (!result || result.error !== null || !record(result.data) || result.data.id !== existing.id) fail();
    } else {
      const result = await client.from("pages").insert({ ...body, slug, merchant_id: null });
      if (!result || result.error !== null) fail();
    }
    const confirmed = await readPlatformAdminBackupRowForWriteStrict(client, slug);
    if (confirmed === null || (existing !== null && confirmed.id !== existing.id) || canonical(confirmed.blocks) !== expected) fail();
  } catch { fail(); }
}
