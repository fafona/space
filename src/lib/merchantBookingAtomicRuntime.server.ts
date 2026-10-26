import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { createServerSupabaseServiceClient } from "./superAdminServer";
import { executeAtomicBookingCommand, bookingAtomicCommandIdentity, type BookingAtomicJson, type BookingAtomicRpc, type BookingAtomicSnapshot, type BookingMailIntent } from "./merchantBookingAtomicPreparation.server";
import type { MerchantBookingStoredRecord } from "./merchantBookings";

const slugs = { records: "__merchant_booking_records__:v1", rules: "__merchant_booking_rules__:v1", workbench: "__merchant_booking_workbench__:v1" };
type Key = keyof typeof slugs;
type Store = { version: 1; records: MerchantBookingStoredRecord[] };
type RequestIdentity = { nonce?: string; principalScope: string; semanticInput: unknown };
type Context = { siteId: string; snapshot: BookingAtomicSnapshot; next: Store; dirty: boolean;
  configuration: { rules?: BookingAtomicJson; workbench?: BookingAtomicJson }; jobs: BookingMailIntent[] };
const context = new AsyncLocalStorage<Context>();
const requestIdentity = new AsyncLocalStorage<RequestIdentity>();
const io = new AsyncLocalStorage<BookingAtomicRpc>();

/** Internal dependency injection for isolated database acceptance. Never bind
 * this to request JSON, a URL, a browser credential or an application setting. */
export function withIsolatedBookingAtomicRpc<T>(rpc: BookingAtomicRpc, task: () => Promise<T>) {
  return io.run(rpc, task);
}

export function isAtomicBookingStorageEnabled() {
  if (io.getStore()) return true;
  const mode = process.env.MERCHANT_BOOKING_STORAGE_MODE?.trim() || "legacy";
  if (mode !== "legacy" && mode !== "atomic-v2") throw new Error("booking_atomic_invalid_mode");
  return mode === "atomic-v2";
}

export function withBookingRequestIdentity<T>(identity: RequestIdentity, task: () => Promise<T>) {
  return requestIdentity.run(identity, task);
}

export async function findBookingSubmissionResult(siteId: string, nonce: string, principalScope: string) {
  if (!isAtomicBookingStorageEnabled()) return { supported: false, found: false };
  const identity = bookingAtomicCommandIdentity({ siteId, nonce, principalScope, semanticInput: null });
  const response = await bookingAtomicRpc()("faolla_booking_command_result_v2", { p_site_id: siteId, p_command_key: identity.p_command_key });
  if (response.error) throw new Error("booking_atomic_storage_unconfirmed");
  return { supported: true, found: Boolean(response.data), result: (response.data as { value?: unknown } | null)?.value };
}

export function bookingAtomicRpc(): BookingAtomicRpc {
  const supplied = io.getStore();
  if (supplied) return supplied;
  const client = createServerSupabaseServiceClient();
  if (!client) throw new Error("booking_atomic_storage_unavailable");
  return async (name, args) => {
    try {
      return await client.rpc(name, args).abortSignal(AbortSignal.timeout(12_000));
    } catch {
      return { data: null, error: { message: "booking_atomic_storage_unconfirmed" } };
    }
  };
}

export async function readAtomicBookingSnapshot(): Promise<BookingAtomicSnapshot> {
  const response = await bookingAtomicRpc()("faolla_booking_atomic_read_v2", {});
  if (response.error || !response.data || typeof response.data !== "object") throw new Error("booking_atomic_storage_unavailable");
  const snapshot = response.data as BookingAtomicSnapshot & { protocol: number };
  if (snapshot.protocol !== 2 || !Array.isArray(snapshot.rows) || typeof snapshot.revision !== "string" || typeof snapshot.generation !== "string") {
    throw new Error("booking_atomic_protocol_mismatch");
  }
  return snapshot;
}

function rawValue(snapshot: BookingAtomicSnapshot, key: Key) {
  return snapshot.rows.find((row) => row.slug === slugs[key])?.blocks ?? null;
}
function recordsValue(snapshot: BookingAtomicSnapshot): Store {
  const value = rawValue(snapshot, "records") as Store | null;
  if (!value || value.version !== 1 || !Array.isArray(value.records)) throw new Error("booking_atomic_store_corrupt");
  return structuredClone(value);
}

/** No local merge, backup restoration, migration or read-time write in v2. */
export async function readAtomicBookingPersistence<T>(key: Key, normalize: (raw: unknown) => T | null) {
  if (!isAtomicBookingStorageEnabled()) return { handled: false as const };
  const current = context.getStore();
  const snapshot = current?.snapshot ?? await readAtomicBookingSnapshot();
  const raw = key === "records" && current ? current.next
    : current?.configuration[key as "rules" | "workbench"] ?? rawValue(snapshot, key);
  if (raw === null) return { handled: true as const, value: null };
  const value = normalize(structuredClone(raw));
  if (value === null) throw new Error("booking_atomic_store_corrupt");
  return { handled: true as const, value };
}

export function stageAtomicBookingPersistence(key: Key, value: unknown) {
  if (!isAtomicBookingStorageEnabled()) return false;
  const current = context.getStore();
  if (!current) throw new Error("booking_atomic_command_required");
  if (key === "records") {
    const next = value as Store;
    current.dirty ||= !isDeepStrictEqual(current.next, next);
    current.next = structuredClone(next);
  } else {
    const property = key === "rules" ? "snapshots" : "settingsBySiteId";
    const previous = (rawValue(current.snapshot, key) ?? { version: 1, [property]: {} }) as Record<string, unknown>;
    const map = previous[property];
    if (!map || typeof map !== "object" || Array.isArray(map)) throw new Error("booking_atomic_store_corrupt");
    const updated = (value as Record<string, Record<string, BookingAtomicJson>>)[property]?.[current.siteId];
    if (updated === undefined) throw new Error("booking_atomic_invalid_configuration");
    // Preserve every other merchant's ORIGINAL JSON, including unknown legacy
    // fields. Normalization is not permission to rewrite unrelated settings.
    const next = { ...previous, [property]: { ...map, [current.siteId]: updated } } as BookingAtomicJson;
    current.configuration[key] = structuredClone(next);
    current.dirty ||= !isDeepStrictEqual(previous, next);
  }
  return true;
}

export function enqueueAtomicBookingNotification(intent: BookingMailIntent) {
  const current = context.getStore();
  if (!current) return false;
  if (intent.context?.booking.siteId !== current.siteId) throw new Error("booking_atomic_scope_violation");
  current.jobs.push(intent);
  current.dirty = true;
  return true;
}

/** All business checks run again after CAS loss; no side effects inside task.
 * RPC injection is for isolated acceptance only, never taken from HTTP input.
 * Environment opt-in still requires an ACTIVE compatible database generation.
 */
export async function runAtomicBookingMutation<T>(input: {
  siteId: string; operation: string; semanticInput?: unknown; authorize?: () => Promise<void>; rememberResult?: boolean;
}, task: () => Promise<T>, testRpc?: BookingAtomicRpc): Promise<T> {
  if (!testRpc && !isAtomicBookingStorageEnabled()) return task();
  const parent = context.getStore();
  if (parent) {
    if (parent.siteId !== input.siteId) throw new Error("booking_atomic_cross_site_command");
    return task();
  }
  const rpc = testRpc ?? bookingAtomicRpc();
  return io.run(rpc, async () => {
    await readAtomicBookingSnapshot();
    const request = requestIdentity.getStore();
    const identity = { siteId: input.siteId, nonce: request?.nonce || randomUUID(),
      principalScope: request?.principalScope || "internal-booking-command",
      semanticInput: JSON.parse(JSON.stringify({ operation: input.operation, input: request?.semanticInput ?? input.semanticInput ?? null })) as BookingAtomicJson };
    let captured: T | undefined;
    const result = await executeAtomicBookingCommand({ rpc, identity, authorize: input.authorize ?? (async () => {}),
      plan: async (snapshot) => {
        const state: Context = { siteId: input.siteId, snapshot, next: recordsValue(snapshot), dirty: false, configuration: {}, jobs: [] };
        return context.run(state, async () => {
          captured = await task();
          const remembered: { [key: string]: BookingAtomicJson } = input.rememberResult === false ? {} : { value: JSON.parse(JSON.stringify(captured)) as BookingAtomicJson };
          return { next: state.next, result: remembered,
            configuration: state.configuration, mailJobs: state.jobs, noop: !state.dirty };
        });
      },
    });
    return captured !== undefined && !result.replayed ? captured : result.result.value as T;
  });
}
