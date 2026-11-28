// Independent application candidate. Not imported by the frozen src tree.
import methods from "../../src/lib/merchantCheckoutRuntimeMethods.json";

export type PgReply = { data: unknown; error: { message: string } | null };
export type PgClient = {
  connect(): Promise<unknown>;
  query(input: { text: string; values: string[]; queryMode: "extended" }): Promise<{ rows: Record<string, unknown>[] }>;
  end(): Promise<unknown>;
  on(event: "error", listener: () => void): unknown;
};
export type PgGate = { active: number };
export const queryText = "SELECT public.faolla_checkout_runtime_v1($1::text,$2::jsonb) AS result";
const limit = 33_554_432;
const unavailable = (): PgReply => ({ data: null, error: { message: "checkout_runtime_unavailable" } });
const invalid = (): never => { throw Error("checkout_runtime_unavailable"); };
function json(value: unknown, seen = new Set<object>(), depth = 0): unknown {
  if (depth > 100) return invalid();
  if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value)) return value;
  if (!value || typeof value !== "object" || seen.has(value) || Object.getOwnPropertySymbols(value).length) return invalid();
  const array = Array.isArray(value);
  if (!array && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return invalid();
  seen.add(value);
  try {
    const properties = Object.getOwnPropertyDescriptors(value), keys = Object.keys(properties).filter(key => !(array && key === "length"));
    if (array && (keys.length !== value.length || keys.some((key, i) => key !== String(i)))) return invalid();
    const copy: unknown[] | Record<string, unknown> = array ? [] : Object.create(null);
    for (const key of keys) {
      const p = properties[key]; if (!p.enumerable || !Object.hasOwn(p, "value")) return invalid();
      Object.defineProperty(copy, key, { value: json(p.value, seen, depth + 1), enumerable: true });
    }
    return copy;
  } finally { seen.delete(value); }
}
function envelope(name: string, args: Record<string, unknown>) {
  const expected = Object.hasOwn(methods, name) ? (methods as Record<string, string[]>)[name] : null;
  if (!expected) return invalid();
  const value = json(args);
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== expected.length || expected.some(key => !Object.hasOwn(value, key))) return invalid();
  const body = JSON.stringify(value); if (Buffer.byteLength(body) > limit) return invalid(); return body;
}
class PgCall implements PromiseLike<PgReply> {
  private pending?: Promise<PgReply>;
  private signals: AbortSignal[] = [];
  constructor(private run: (signals: AbortSignal[]) => Promise<PgReply>) {}
  abortSignal(signal: AbortSignal) { if (this.pending || !(signal instanceof AbortSignal)) return invalid(); this.signals.push(signal); return this; }
  then<T = PgReply, E = never>(ok?: ((value: PgReply) => T | PromiseLike<T>) | null, fail?: ((error: unknown) => E | PromiseLike<E>) | null): Promise<T | E> {
    this.pending ??= this.run(this.signals); return this.pending.then(ok, fail);
  }
}
export function createPgRuntimeCore(options: { clientFactory: () => PgClient; current: () => boolean; gate: PgGate; timeoutMs: number }) {
  const { clientFactory, current, gate, timeoutMs } = options;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 12000 || !Number.isInteger(gate.active) || gate.active < 0 || gate.active > 4) return invalid();
  return { rpc(name: string, args: Record<string, unknown>) {
    const body = envelope(name, args);
    return new PgCall(async signals => {
      if (!current() || gate.active >= 4 || signals.some(s => s.aborted)) return unavailable();
      gate.active++;
      const controller = new AbortController(), signal = AbortSignal.any([...signals, controller.signal]);
      let client: PgClient | undefined, ending: Promise<unknown> | undefined, released = false;
      const releaseSlot = () => { if (!released) { released = true; gate.active--; } };
      const end = () => {
        if (!ending && client) ending = Promise.resolve().then(() => client!.end()).then(releaseSlot, () => {});
        return ending;
      };
      let stop = () => {};
      const stopped = new Promise<never>((_, reject) => { stop = () => { void end(); reject(Error("checkout_runtime_unavailable")); }; signal.addEventListener("abort", stop, { once: true }); });
      void stopped.catch(() => {});
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        client = clientFactory(); client.on("error", () => {});
        if (signal.aborted || !current()) return unavailable();
        await Promise.race([client.connect(), stopped]);
        if (signal.aborted || !current()) return unavailable();
        const response = await Promise.race([client.query({ text: queryText, values: [name, body], queryMode: "extended" }), stopped]);
        if (signal.aborted || !current() || response.rows?.length !== 1 || !Object.hasOwn(response.rows[0], "result")) return unavailable();
        const result = JSON.stringify(json(response.rows[0].result)); if (Buffer.byteLength(result) > limit) return unavailable();
        return { data: JSON.parse(result), error: null };
      } catch (error) {
        const e = error as { code?: unknown; message?: unknown };
        if (!signal.aborted && current() && e?.code === "P0001" && typeof e.message === "string" && /^(?:checkout_[a-z0-9_]{1,80}|booking_atomic_[a-z0-9_]{1,80}|order_update_conflict|merchant_memberships_conflict|merchant_membership_settings_conflict|merchant_coupons_conflict)$/.test(e.message))
          return { data: null, error: { message: e.message } };
        return unavailable();
      } finally {
        clearTimeout(timer); signal.removeEventListener("abort", stop);
        const pending = end();
        if (pending) {
          let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
          await Promise.race([pending, new Promise(resolve => { cleanupTimer = setTimeout(resolve, 500); })]).finally(() => clearTimeout(cleanupTimer));
        } else if (!client) releaseSlot();
        // A genuinely late close releases only its own slot. A failed close does
        // not recycle capacity; no abandoned connection is put into a pool.
      }
    });
  } };
}
