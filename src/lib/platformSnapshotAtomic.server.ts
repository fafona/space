import { Buffer } from "node:buffer";

/** Local candidate storage primitive; production enablement remains blocked.
 * A caller must validate business data separately, using copies of these physical
 * rows. Never rebuild a CAS expectation from a normalized business view.
 */
const scopes = {
  user_manage: [
    "__platform_merchant_config_archive__", "__platform_merchant_config_archive_backup__",
    "__platform_merchant_snapshot__", "__platform_merchant_snapshot_backup__",
    "__platform_merchant_snapshot_history__", "__platform_merchant_snapshot_history_backup__",
  ],
  support_messages: [
    "__platform_support_inbox__", "__platform_support_inbox_history__", "__platform_support_inbox_history_backup__",
  ],
  backup_catalog: ["__platform_admin_data_backup__", "__platform_admin_data_backup_backup__"],
} as const;
export const PLATFORM_SNAPSHOT_ATOMIC_SCOPES = Object.freeze(Object.fromEntries(
  Object.entries(scopes).map(([scope, slugs]) => [scope, Object.freeze([...slugs])]),
)) as Readonly<{ [K in keyof typeof scopes]: readonly string[] }>;
export type PlatformSnapshotAtomicScope = keyof typeof scopes;
export type PlatformSnapshotJson = null | boolean | number | string | PlatformSnapshotJson[] | { [key: string]: PlatformSnapshotJson };
export type PlatformSnapshotAtomicRow = { id: string; blocks: PlatformSnapshotJson; updatedAt: string | null };
export type PlatformSnapshotAtomicExpected = { slug: string; row: PlatformSnapshotAtomicRow | null };
export type PlatformSnapshotAtomicWrite = { slug: string; blocks: PlatformSnapshotJson };
export type PlatformSnapshotAtomicView = { version: 1; scope: PlatformSnapshotAtomicScope; rows: PlatformSnapshotAtomicExpected[] };
export type PlatformSnapshotRestoreAtomicScope = Exclude<PlatformSnapshotAtomicScope, "backup_catalog">;
export type PlatformSnapshotRestoreAtomicView = {
  version: 1; scope: PlatformSnapshotRestoreAtomicScope;
  catalog: PlatformSnapshotAtomicView; target: PlatformSnapshotAtomicView;
};
export type PlatformSnapshotAtomicClient = {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data?: unknown; error?: unknown }>;
};
export const PLATFORM_SNAPSHOT_ATOMIC_MAX_BYTES = 64 * 1024 * 1024;
const invalid = "platform_snapshot_atomic_invalid_request";
const unconfirmed = "platform_snapshot_atomic_write_unconfirmed";
const serverErrors = new Set([invalid, unconfirmed, "platform_snapshot_atomic_conflict", "platform_snapshot_atomic_store_corrupt"]);

export class PlatformSnapshotAtomicError extends Error {
  // Even an apparently failed transport may have committed. Never replay here.
  readonly retrySafe = false;
  constructor(code: string) { super(code); this.name = "PlatformSnapshotAtomicError"; }
}
function fail(code = invalid): never { throw new PlatformSnapshotAtomicError(code); }
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
function exact(value: unknown, keys: readonly string[]): asserts value is Record<string, unknown> {
  if (!object(value) || Reflect.ownKeys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))) fail();
}
function canonical(value: unknown, depth = 0): string {
  if (depth > 64) fail();
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value) && (!Number.isInteger(value) || Number.isSafeInteger(value))) return JSON.stringify(value);
  if (!Array.isArray(value) && !object(value)) return fail();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(value).some((key) => typeof key !== "string") ||
    Object.entries(descriptors).some(([key, entry]) => !Object.hasOwn(entry, "value") ||
      (!entry.enumerable && !(Array.isArray(value) && key === "length")))) fail();
  if (Array.isArray(value)) {
    if (Object.keys(value).length !== value.length) fail();
    const items: string[] = [];
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.hasOwn(value, index)) fail();
      items.push(canonical(value[index], depth + 1));
    }
    return `[${items.join(",")}]`;
  }
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key], depth + 1)}`).join(",")}}`;
}
function snapshot(value: unknown): unknown {
  const serialized = canonical(value);
  if (Buffer.byteLength(serialized, "utf8") > PLATFORM_SNAPSHOT_ATOMIC_MAX_BYTES) fail();
  return JSON.parse(serialized);
}
function scopeSlugs(scope: unknown): readonly string[] {
  if (typeof scope !== "string" || !Object.hasOwn(PLATFORM_SNAPSHOT_ATOMIC_SCOPES, scope)) fail();
  return PLATFORM_SNAPSHOT_ATOMIC_SCOPES[scope as PlatformSnapshotAtomicScope];
}
function blocks(slug: string, value: unknown): void {
  // Only support history is an object. Snapshot history is a block array.
  const history = slug === "__platform_support_inbox_history__" || slug === "__platform_support_inbox_history_backup__";
  if (history ? !object(value) : !Array.isArray(value)) fail();
}
function vector(scope: PlatformSnapshotAtomicScope, value: unknown, kind: "expected" | "writes"): void {
  const slugs = scopeSlugs(scope);
  if (!Array.isArray(value) || value.length !== slugs.length) fail();
  const ids = new Set<string>();
  value.forEach((entry, index) => {
    exact(entry, kind === "expected" ? ["slug", "row"] : ["slug", "blocks"]);
    if (entry.slug !== slugs[index]) fail();
    if (kind === "writes") { blocks(slugs[index], entry.blocks); return; }
    if (entry.row === null) return;
    exact(entry.row, ["id", "blocks", "updatedAt"]);
    const row = entry.row;
    if (typeof row.id !== "string" || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(row.id) || ids.has(row.id)) fail();
    ids.add(row.id);
    // Retain the original PostgreSQL microseconds/offset; Date.toISOString is NOT a CAS version.
    if (row.updatedAt !== null && (typeof row.updatedAt !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(row.updatedAt) || !Number.isFinite(Date.parse(row.updatedAt)))) fail();
    blocks(slugs[index], row.blocks);
  });
}
function view(scope: PlatformSnapshotAtomicScope, value: unknown): PlatformSnapshotAtomicView {
  exact(value, ["version", "scope", "rows"]);
  if (value.version !== 1 || value.scope !== scope) fail();
  vector(scope, value.rows, "expected");
  return value as PlatformSnapshotAtomicView;
}
/** Pure validation/capture for business planners; never normalize a physical CAS vector. */
export function parsePlatformSnapshotAtomicView(scope: PlatformSnapshotAtomicScope, value: unknown): PlatformSnapshotAtomicView {
  scopeSlugs(scope);
  return view(scope, snapshot(value));
}
function timestampKey(value: string | null): string | null {
  if (value === null) return null;
  // Validation already bounded this to an ISO timestamp with <= 6 fractional digits.
  // Normalize only for equality, retaining microseconds separately from Date's milliseconds.
  const fraction = /T\d{2}:\d{2}:\d{2}(?:\.(\d{1,6}))?/.exec(value)?.[1] ?? "";
  return `${Math.floor(Date.parse(value) / 1000)}:${fraction.padEnd(6, "0")}`;
}
async function invoke(client: PlatformSnapshotAtomicClient, name: string, args: Record<string, unknown>): Promise<unknown> {
  let result: { data?: unknown; error?: unknown };
  try { result = await client.rpc(name, args); } catch { return fail(unconfirmed); }
  if (!result || result.error !== null || result.data === undefined || result.data === null) {
    const error = result?.error;
    if (result?.data === null && object(error) && error.code === "P0001" && typeof error.message === "string" && serverErrors.has(error.message)) fail(error.message);
    fail(unconfirmed);
  }
  return result.data;
}
export async function readPlatformSnapshotAtomic(client: PlatformSnapshotAtomicClient, scope: PlatformSnapshotAtomicScope): Promise<PlatformSnapshotAtomicView> {
  scopeSlugs(scope);
  const data = await invoke(client, "faolla_read_platform_snapshot_rows_v1", { p_scope: scope });
  try { return view(scope, snapshot(data)); } catch { return fail(unconfirmed); }
}
export async function commitPlatformSnapshotAtomic(
  client: PlatformSnapshotAtomicClient, scope: PlatformSnapshotAtomicScope,
  expected: readonly PlatformSnapshotAtomicExpected[], writes: readonly PlatformSnapshotAtomicWrite[],
): Promise<PlatformSnapshotAtomicView> {
  scopeSlugs(scope);
  // Capture the whole plan before the first await: later UI/caller mutations cannot change CAS or verification.
  const plan = snapshot({ expected, writes }) as { expected: PlatformSnapshotAtomicExpected[]; writes: PlatformSnapshotAtomicWrite[] };
  vector(scope, plan.expected, "expected"); vector(scope, plan.writes, "writes");
  const data = await invoke(client, "faolla_commit_platform_snapshot_rows_v1", {
    p_scope: scope, p_expected: plan.expected, p_writes: plan.writes,
  });
  try {
    const result = view(scope, snapshot(data));
    result.rows.forEach((entry, index) => {
      const previous = plan.expected[index].row;
      if (!entry.row || (previous && entry.row.id !== previous.id) ||
        canonical(entry.row.blocks) !== canonical(plan.writes[index].blocks)) fail();
      if (previous && canonical(previous.blocks) === canonical(plan.writes[index].blocks) &&
        timestampKey(entry.row.updatedAt) !== timestampKey(previous.updatedAt)) fail();
    });
    return result;
  } catch { return fail(unconfirmed); }
}

function restoreScope(scope: unknown): asserts scope is PlatformSnapshotRestoreAtomicScope {
  if (scope !== "user_manage" && scope !== "support_messages") fail();
}
function restoreView(scope: PlatformSnapshotRestoreAtomicScope, value: unknown): PlatformSnapshotRestoreAtomicView {
  exact(value, ["version", "scope", "catalog", "target"]);
  if (value.version !== 1 || value.scope !== scope) fail();
  const catalog = view("backup_catalog", value.catalog);
  const target = view(scope, value.target);
  const ids = [...catalog.rows, ...target.rows].flatMap(({ row }) => row ? [row.id] : []);
  if (new Set(ids).size !== ids.length) fail();
  return value as PlatformSnapshotRestoreAtomicView;
}
export function parsePlatformSnapshotRestoreAtomicView(scope: PlatformSnapshotRestoreAtomicScope, value: unknown): PlatformSnapshotRestoreAtomicView {
  restoreScope(scope);
  return restoreView(scope, snapshot(value));
}
function equalPhysicalRow(left: PlatformSnapshotAtomicRow | null, right: PlatformSnapshotAtomicRow | null): boolean {
  if (!left || !right) return left === right;
  return left.id === right.id && canonical(left.blocks) === canonical(right.blocks) &&
    timestampKey(left.updatedAt) === timestampKey(right.updatedAt);
}
export async function readPlatformSnapshotRestoreAtomic(
  client: PlatformSnapshotAtomicClient, scope: PlatformSnapshotRestoreAtomicScope,
): Promise<PlatformSnapshotRestoreAtomicView> {
  restoreScope(scope);
  const data = await invoke(client, "faolla_read_platform_snapshot_restore_v1", { p_scope: scope });
  try { return parsePlatformSnapshotRestoreAtomicView(scope, data); } catch { return fail(unconfirmed); }
}
/** Source catalog is a read dependency, never a write target. This protocol
 * binds one server restore scope, not Auth, shadow tables or browser state.
 * A lost receipt is not permission to replay an old destructive restore.
 */
export async function commitPlatformSnapshotRestoreAtomic(
  client: PlatformSnapshotAtomicClient, expected: PlatformSnapshotRestoreAtomicView,
  writes: readonly PlatformSnapshotAtomicWrite[],
): Promise<PlatformSnapshotRestoreAtomicView> {
  const plan = preparePlatformSnapshotRestoreAtomicCommit(expected, writes);
  const data = await invoke(client, "faolla_commit_platform_snapshot_restore_v1", {
    p_scope: plan.expected.scope, p_catalog_expected: plan.expected.catalog.rows,
    p_target_expected: plan.expected.target.rows, p_writes: plan.writes,
  });
  return verifyPlatformSnapshotRestoreAtomicCommit(plan, data);
}
/** Shared pure boundary for both candidate restore protocols. */
export function preparePlatformSnapshotRestoreAtomicCommit(
  expected: PlatformSnapshotRestoreAtomicView, writes: readonly PlatformSnapshotAtomicWrite[],
): { expected: PlatformSnapshotRestoreAtomicView; writes: PlatformSnapshotAtomicWrite[] } {
  // Snapshot the entire plan under one size limit before the first async call.
  const plan = snapshot({ expected, writes }) as { expected: PlatformSnapshotRestoreAtomicView; writes: PlatformSnapshotAtomicWrite[] };
  restoreScope(plan.expected?.scope);
  const scope = plan.expected.scope;
  restoreView(scope, plan.expected);
  vector(scope, plan.writes, "writes");
  if (plan.expected.catalog.rows.every(({ row }) => row === null)) fail();
  return plan;
}
/** A valid physical result is not itself a durable operation receipt. */
export function verifyPlatformSnapshotRestoreAtomicCommit(
  plan: ReturnType<typeof preparePlatformSnapshotRestoreAtomicCommit>, data: unknown,
): PlatformSnapshotRestoreAtomicView {
  try {
    const result = parsePlatformSnapshotRestoreAtomicView(plan.expected.scope, data);
    result.catalog.rows.forEach(({ row }, index) => {
      if (!equalPhysicalRow(row, plan.expected.catalog.rows[index].row)) fail();
    });
    result.target.rows.forEach(({ row }, index) => {
      const previous = plan.expected.target.rows[index].row;
      if (!row || (previous && row.id !== previous.id) || canonical(row.blocks) !== canonical(plan.writes[index].blocks)) fail();
      if (previous && canonical(previous.blocks) === canonical(plan.writes[index].blocks) &&
        timestampKey(row.updatedAt) !== timestampKey(previous.updatedAt)) fail();
    });
    return result;
  } catch { return fail(unconfirmed); }
}
