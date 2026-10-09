// Explicit200 transport: one scoped, nonsecret pending command per actor/tab.
// No auto GET/retry, hidden work, POST replay or clearing by an unproved error.
import type { AttendanceApiFetch } from "./merchantAttendanceSelfClient";
import { captureBrowserExact as exact } from "./merchantAttendanceRuleCapturesBrowser";
import { operationalRuleLedgerFreeze as freeze } from "./merchantAttendanceOperationalRuleLedger";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { CYCLE_INTENT_API, CYCLE_INTENT_BODY_LIMIT, cycleIntentQueryString, cycleIntentCommandFingerprint,
  parseCycleIntentBody, parseCycleIntentBodyJson, parseCycleIntentQuery, type CycleIntentQuery, type CycleIntentCommand } from "./merchantAttendanceCycleIntent";
import { CYCLE_INTENT_RESULT_LIMIT, parseCycleIntentResultJson, parseCycleIntentResponse, type CycleIntentResult } from "./merchantAttendanceCycleIntentResult";
export type CycleIntentPending = Readonly<{ version: 1; actorId: string; query: CycleIntentQuery; command: CycleIntentCommand; fingerprint: string }>;
export type CycleIntentStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type Options = Readonly<{ siteId: string; actorId: string; apiFetch: AttendanceApiFetch; storage: () => CycleIntentStorage; isCurrent?: () => boolean; timeoutMs?: number }>;
function unknown(): never { throw new MerchantAttendanceError("attendance_cycle_recovery_required"); }
export function cycleIntentAuthCurrent(check?: () => boolean): boolean {
  try { return typeof check === "function" && check() === true; } catch { return false; }
}
export function cycleIntentPendingKey(siteId: string, actorId: string) {
  parseCycleIntentQuery({ siteId, access: "owner", workerId: actorId, grantId: null, mode: "list", cursor: null });
  return `faolla:attendance:cycle-intent:v1:${siteId}:${actorId}`;
}
export class AttendanceCycleIntentClient {
  readonly key: string; private readonly options: Options; private generation = 0; private busy = false; private controller: AbortController | null = null; private deadline = 0;
  constructor(options: Options) {
    this.key = cycleIntentPendingKey(options.siteId, options.actorId);
    if (typeof options.apiFetch !== "function" || typeof options.storage !== "function" || options.isCurrent !== undefined && typeof options.isCurrent !== "function"
      || options.timeoutMs !== undefined && (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1 || options.timeoutMs > 12000)) unknown();
    this.options = Object.freeze({ ...options });
  }
  pause() { this.generation++; this.controller?.abort(); this.controller = null; }
  private guard(g: number) {
    if (!this.busy || !this.controller || this.controller.signal.aborted || g !== this.generation || typeof document !== "undefined" && document.hidden || !cycleIntentAuthCurrent(this.options.isCurrent)) unknown();
    if (performance.now() >= this.deadline) { this.controller.abort(); unknown(); }
  }
  // One deadline covers local decoding, all digest work, transport and result
  // verification. Late continuations cannot occupy/clear a slot or dispatch.
  private async operation<T>(run: (g: number) => Promise<T>): Promise<T> {
    if (this.busy) unknown(); this.busy = true; const g = ++this.generation, controller = new AbortController();
    this.controller = controller; this.deadline = performance.now() + (this.options.timeoutMs ?? 12000);
    let reject!: (error: Error) => void;
    const interruption = new Promise<never>((_, no) => { reject = no; }), abort = () => reject(Error("unknown_result"));
    controller.signal.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => controller.abort(), Math.max(0, this.deadline - performance.now()));
    try { return await Promise.race([Promise.resolve().then(() => { this.guard(g); return run(g); }), interruption]); }
    finally { clearTimeout(timer); controller.signal.removeEventListener("abort", abort); controller.abort(); if (this.controller === controller) this.controller = null; this.busy = false; }
  }
  private stored(g: number, expected?: string | null) {
    this.guard(g); const storage = this.options.storage(); this.guard(g); const raw = storage.getItem(this.key); this.guard(g);
    if (expected !== undefined && raw !== expected) unknown(); return { storage, raw };
  }
  private scoped(raw: CycleIntentQuery) { const q = parseCycleIntentQuery(raw); if (q.siteId !== this.options.siteId) unknown(); return q; }
  private async decode(raw: string, g: number): Promise<CycleIntentPending> {
    if (new TextEncoder().encode(raw).byteLength > CYCLE_INTENT_BODY_LIMIT + 512) unknown();
    const value = exact(parseCycleIntentResultJson(raw), ["version", "actorId", "query", "command", "fingerprint"]);
    if (value.version !== 1 || value.actorId !== this.options.actorId) unknown();
    const pair = parseCycleIntentBody({ query: value.query, command: value.command }); this.scoped(pair.query);
    const fingerprint = await cycleIntentCommandFingerprint(pair.query, pair.command, this.options.actorId); this.guard(g);
    if (value.fingerprint !== fingerprint) unknown(); return freeze({ version: 1, actorId: this.options.actorId, ...pair, fingerprint });
  }
  async load(): Promise<CycleIntentPending | null> {
    return this.operation(async g => { const { raw } = this.stored(g); if (raw === null) return null; const value = await this.decode(raw, g); this.stored(g, raw); return value; });
  }
  private async transport(query: CycleIntentQuery, body: string | null, g: number, pending: string | null, command: CycleIntentCommand | null = null) {
    this.guard(g); const controller = this.controller!; let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    const abort = () => { void reader?.cancel().catch(() => {}); };
    controller.signal.addEventListener("abort", abort, { once: true });
    const guard = () => { this.stored(g, pending); };
    const run = async () => {
      guard(); const response = await this.options.apiFetch(CYCLE_INTENT_API + (body === null ? "?" + cycleIntentQueryString(query) : ""), {
        method: body === null ? "GET" : "POST", cache: "no-store", redirect: "error", signal: controller.signal,
        headers: body === null ? { Accept: "application/json" } : { Accept: "application/json", "Content-Type": "application/json" }, ...(body === null ? {} : { body }) });
      try { guard(); } catch (error) { void response.body?.cancel().catch(() => {}); throw error; }
      if (!response.ok || response.status !== 200 || response.redirected || response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") { void response.body?.cancel().catch(() => {}); unknown(); }
      reader = response.body?.getReader(); if (!reader) unknown(); const decoder = new TextDecoder("utf-8", { fatal: true }); let bytes = 0, text = "";
      try { while (true) { const part = await reader.read(); guard(); if (part.done) break; bytes += part.value.byteLength; if (bytes > CYCLE_INTENT_RESULT_LIMIT) unknown(); text += decoder.decode(part.value, { stream: true }); } text += decoder.decode(); }
      finally { void reader.cancel().catch(() => {}); reader.releaseLock(); reader = undefined; }
      guard(); const result = (await parseCycleIntentResponse(parseCycleIntentResultJson(text), query, this.options.actorId, command)).data; guard(); return result;
    };
    try { return await run(); } finally { controller.signal.removeEventListener("abort", abort); }
  }
  async read(raw: CycleIntentQuery): Promise<CycleIntentResult> {
    const q = this.scoped(raw); if (q.mode === "recover") unknown();
    return this.operation(async g => { this.stored(g, null); const result = await this.transport(q, null, g, null); this.stored(g, null); return result; });
  }
  /** Even valid POST receipt stays pending until an explicit matching GET. */
  async post(rawQuery: CycleIntentQuery, rawCommand: CycleIntentCommand): Promise<CycleIntentResult> {
    const pair = parseCycleIntentBodyJson(JSON.stringify(parseCycleIntentBody({ query: rawQuery, command: rawCommand }))); this.scoped(pair.query);
    return this.operation(async g => {
      this.stored(g, null);
      const fingerprint = await cycleIntentCommandFingerprint(pair.query, pair.command, this.options.actorId); this.guard(g);
      const value: CycleIntentPending = freeze({ version: 1, actorId: this.options.actorId, ...pair, fingerprint }), raw = JSON.stringify(value);
      if (new TextEncoder().encode(raw).byteLength > CYCLE_INTENT_BODY_LIMIT + 512) unknown(); const { storage } = this.stored(g, null); storage.setItem(this.key, raw); this.stored(g, raw);
      const result = await this.transport(pair.query, JSON.stringify(pair), g, raw, pair.command); this.stored(g, raw); return result;
    });
  }
  async recover(): Promise<CycleIntentResult> {
    return this.operation(async g => {
      const { raw } = this.stored(g); if (raw === null) unknown(); const value = await this.decode(raw, g); this.stored(g, raw);
      const query: CycleIntentQuery = { siteId: value.query.siteId, access: value.query.access, workerId: value.query.workerId, grantId: value.query.grantId,
        mode: "recover", intentId: value.command.intentId, operationId: value.command.operationId };
      const result = await this.transport(query, null, g, raw, value.command); this.stored(g, raw);
      if (!result.receipt || result.data.kind !== "receipt" || result.receipt.commandFingerprint !== value.fingerprint) unknown();
      const { storage } = this.stored(g, raw); storage.removeItem(this.key); this.stored(g, null); return result;
    });
  }
}
