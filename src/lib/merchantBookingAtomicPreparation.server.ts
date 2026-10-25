import { createHash } from "node:crypto";
import type { MerchantBookingStoredRecord } from "./merchantBookings";

/** Preparation-only adapter: intentionally NOT imported by any route or worker.
 * No environment activation, client creation, legacy/local fallback, mail send,
 * or production enablement lives here. All writers/configuration/automation and
 * rollback cohorts must be adapted and checked before future activation.
 */
type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type BookingAtomicSnapshot = {
  generation: string;
  revision: string;
  rows: Array<{ id: string; slug: string; blocks: Json; updated_at: string | null }>;
};
export type BookingMailIntent = {
  bookingId: string;
  kind: "status" | "reminder" | "manual";
  // A deliberate whitelist, with NO editToken or manage link. Future dispatch
  // must resolve the private token only in memory and check the booking again.
  message: {
    recipient: string;
    locale?: string;
    siteName?: string;
    replyTo?: string | null;
    appointmentAt?: string;
    appointmentTimeZone?: string | null;
    status?: string;
    customerName?: string;
    customerPhone?: string;
    serviceName?: string;
    optionName?: string;
    notes?: string;
    reminderOffsetMinutes?: number;
  };
};
export type BookingAtomicPlan = {
  next: { version: 1; records: MerchantBookingStoredRecord[] };
  result: { [key: string]: Json };
  mailJobs: BookingMailIntent[];
};
export type BookingAtomicRpc = (
  name: string,
  args: Record<string, unknown>,
) => PromiseLike<{ data: unknown; error: { message?: string } | null }>;

function canonicalJson(value: Json): string {
  if (value === null || typeof value !== "object") {
    if (typeof value === "number" && !Number.isFinite(value)) throw new Error("booking_atomic_invalid_input");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

export function bookingAtomicCommandIdentity(input: {
  siteId: string; principalScope: string; nonce: string; semanticInput: Json;
}) {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(input.siteId) || !input.principalScope.trim()
    || input.principalScope.length > 512
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.nonce)) {
    throw new Error("booking_atomic_invalid_command");
  }
  return {
    p_site_id: input.siteId,
    p_command_key: hash(canonicalJson(["booking-command-v1", input.siteId, input.principalScope, input.nonce.toLowerCase()])),
    p_request_hash: hash(canonicalJson(input.semanticInput)),
  };
}

async function call(rpc: BookingAtomicRpc, name: string, args: Record<string, unknown>) {
  let response: Awaited<ReturnType<BookingAtomicRpc>>;
  try {
    response = await rpc(name, args);
  } catch {
    throw new Error("booking_atomic_storage_unconfirmed");
  }
  if (response.error) {
    // Never leak database/provider bodies (which may include customer data).
    const known = response.error.message?.match(/^booking_atomic_[a-z_]+$/)?.[0];
    throw new Error(known ?? "booking_atomic_storage_unconfirmed");
  }
  if (!response.data || typeof response.data !== "object" || Array.isArray(response.data)) {
    throw new Error("booking_atomic_invalid_storage_response");
  }
  return response.data as Record<string, unknown>;
}

function outcome(response: Record<string, unknown>) {
  if (typeof response.replayed !== "boolean" || !response.result
    || typeof response.result !== "object" || Array.isArray(response.result)) {
    throw new Error("booking_atomic_invalid_storage_response");
  }
  return { replayed: response.replayed, result: response.result as BookingAtomicPlan["result"] };
}

/** authorize() runs before EVERY lookup/replay/retry, not just initial creation.
 * plan() must be side-effect-free: validate capacity, policy and lifecycle from
 * this exact snapshot. It may run again on CAS conflict. No blind timeout retry.
 * A caller must retain the SAME nonce and semantic input after uncertain commit.
 */
export async function executeAtomicBookingCommand(options: {
  rpc: BookingAtomicRpc;
  identity: Parameters<typeof bookingAtomicCommandIdentity>[0];
  authorize: () => Promise<void>;
  plan: (snapshot: BookingAtomicSnapshot) => Promise<BookingAtomicPlan>;
}) {
  const identity = bookingAtomicCommandIdentity(options.identity);
  for (let attempt = 0; attempt < 3; attempt++) {
    await options.authorize();
    const snapshot = await call(options.rpc, "faolla_booking_atomic_snapshot_v1", identity);
    if (snapshot.replayed === true) return outcome(snapshot);
    if (snapshot.replayed !== false || typeof snapshot.generation !== "string"
      || typeof snapshot.revision !== "string" || !Array.isArray(snapshot.rows)) {
      throw new Error("booking_atomic_invalid_storage_response");
    }
    const expected: BookingAtomicSnapshot = {
      generation: snapshot.generation,
      revision: snapshot.revision,
      rows: snapshot.rows as BookingAtomicSnapshot["rows"],
    };
    const plan = await options.plan(structuredClone(expected));
    try {
      return outcome(await call(options.rpc, "faolla_booking_atomic_commit_v1", {
        ...identity,
        p_mutation: { ...expected, next: plan.next, result: plan.result, mailJobs: plan.mailJobs },
      }));
    } catch (error) {
      if (!(error instanceof Error) || error.message !== "booking_atomic_conflict" || attempt === 2) throw error;
    }
  }
  throw new Error("booking_atomic_conflict");
}
