export const PLATFORM_ADMIN_BACKUP_READ_UNAVAILABLE = "super_admin_backup_read_unavailable";

type StrictReadBuilder = {
  select(columns: string): StrictReadBuilder;
  is(column: string, value: unknown): StrictReadBuilder;
  eq(column: string, value: unknown): StrictReadBuilder;
  limit(count: number): StrictReadBuilder;
  maybeSingle(): PromiseLike<{ data?: unknown; error: unknown }>;
};

type StrictReadClient = { from(table: string): StrictReadBuilder };

/** Backup-only read: no cache, schema fallback, cross-owner data fallback or error-as-empty. */
export async function readPlatformAdminBackupBlocksStrict(client: StrictReadClient, slug: string): Promise<unknown[] | null> {
  try {
    const result = await client.from("pages").select("blocks").is("merchant_id", null)
      .eq("slug", slug).limit(2).maybeSingle();
    if (result.error || result.data === undefined) throw new Error(PLATFORM_ADMIN_BACKUP_READ_UNAVAILABLE);
    if (result.data === null) {
      // Old stores accepted internal slugs owned by a non-null merchant. Do not
      // silently snapshot these as empty, or copy another owner's data: stop for review.
      const legacy = await client.from("pages").select("blocks").eq("slug", slug).limit(1).maybeSingle();
      if (legacy.error || legacy.data !== null) throw new Error(PLATFORM_ADMIN_BACKUP_READ_UNAVAILABLE);
      return null;
    }
    if (typeof result.data !== "object" || Array.isArray(result.data) ||
      !Array.isArray((result.data as { blocks?: unknown }).blocks)) {
      throw new Error(PLATFORM_ADMIN_BACKUP_READ_UNAVAILABLE);
    }
    return (result.data as { blocks: unknown[] }).blocks;
  } catch {
    // Never expose database messages, credentials or response bodies through this boundary.
    throw new Error(PLATFORM_ADMIN_BACKUP_READ_UNAVAILABLE);
  }
}

/** Keeps the API read failure distinct from genuine, successfully read empty state. */
export async function tryPlatformAdminBackupRead<T>(read: () => Promise<T>): Promise<
  { ok: true; value: T } | { ok: false; error: typeof PLATFORM_ADMIN_BACKUP_READ_UNAVAILABLE }
> {
  try {
    return { ok: true, value: await read() };
  } catch {
    return { ok: false, error: PLATFORM_ADMIN_BACKUP_READ_UNAVAILABLE };
  }
}
