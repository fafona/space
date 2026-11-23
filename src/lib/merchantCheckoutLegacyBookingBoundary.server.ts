import type { BookingAtomicRpc } from "./merchantBookingAtomicPreparation.server";

/** Internal server adapter only; no config from HTTP. Deadline is shared by
 * reads, planning waits and every original CAS attempt, never renewed on retry.
 * The SQL wrapper retains the proven original booking transaction/outbox. */
export function bookingRpcWithCheckoutIntent(rpc: BookingAtomicRpc, startedAt = Date.now()): BookingAtomicRpc {
  const deadline = startedAt + 11_000, signal = AbortSignal.timeout(Math.max(1, startedAt + 12_000 - Date.now()));
  return async (name, args) => {
    if (signal.aborted || Date.now() >= deadline) return { data: null, error: { message: "checkout_create_unconfirmed" } };
    let stop = () => {};
    try {
      const response = await Promise.race([Promise.resolve().then(() => {
        if (signal.aborted || Date.now() >= deadline) return { data: null, error: { message: "checkout_create_unconfirmed" } };
        return rpc(name === "faolla_booking_atomic_commit_v1" ? "faolla_checkout_legacy_booking_commit_v1" : name,
          name === "faolla_booking_atomic_commit_v1" ? { ...args, p_not_after: new Date(deadline).toISOString() } : args);
      }), new Promise<Awaited<ReturnType<BookingAtomicRpc>>>(resolve => {
        stop = () => resolve({ data: null, error: { message: "checkout_create_unconfirmed" } });
        signal.addEventListener("abort", stop, { once: true });
      })]);
      return response.error?.message === "checkout_intent_expired" ? { data: null, error: { message: "checkout_create_unconfirmed" } } : response;
    } catch {
      return { data: null, error: { message: "checkout_create_unconfirmed" } };
    } finally { signal.removeEventListener("abort", stop); }
  };
}
