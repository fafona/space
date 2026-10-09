// Owner-only196 transport. Durable intent contains only the nonsecret command;
// PIN exists solely in the one transient issue POST. No retry or auto-fetch.
import type { AttendanceApiFetch } from "./merchantAttendanceSelfClient";
import { captureBrowserExact as exact } from "./merchantAttendanceRuleCapturesBrowser";
import { freeze } from "./merchantAttendancePlanExceptionValidation";
import { INDEPENDENT_BODY_LIMIT, INDEPENDENT_RESPONSE_LIMIT, independentAdminCommandFingerprint, independentAdminReceiptMatches,
  independentQueryString, parseIndependentAdminResult, parseIndependentBody, parseIndependentJson, parseIndependentOwnerBody,
  parseIndependentQuery, type IndependentAdminResult, type IndependentBody, type IndependentCommand, type IndependentQuery } from "./merchantAttendanceIndependent";
import { MerchantAttendanceError } from "./merchantAttendanceTime";

export const INDEPENDENT_ADMIN_API = "/api/merchant-enterprise/attendance/independent";
export type IndependentAdminPending = Readonly<{ version: 1; actorId: string; query: IndependentQuery; command: IndependentCommand; fingerprint: string }>;
export type IndependentAdminStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type IndependentAdminClientOptions = Readonly<{ siteId: string; actorId: string; apiFetch: AttendanceApiFetch;
  storage: () => IndependentAdminStorage; isCurrent?: () => boolean; timeoutMs?: number }>;
function unknown(): never { throw new MerchantAttendanceError("attendance_independent_recovery_required"); }
export function independentAdminPendingKey(siteId: string, actorId: string) {
  parseIndependentQuery({ siteId, mode: "detail", subjectId: actorId });
  return `faolla:attendance:independent-admin:v1:${siteId}:${actorId}`;
}
export class AttendanceIndependentAdminClient {
  readonly key: string;
  private readonly options: IndependentAdminClientOptions;
  private generation = 0;
  private busy = false;
  private controller: AbortController | null = null;
  constructor(options: IndependentAdminClientOptions) {
    this.key = independentAdminPendingKey(options.siteId, options.actorId);
    if (typeof options.apiFetch !== "function" || typeof options.storage !== "function"
      || options.isCurrent !== undefined && typeof options.isCurrent !== "function"
      || options.timeoutMs !== undefined && (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1 || options.timeoutMs > 12000)) unknown();
    this.options = Object.freeze({ ...options });
  }
  pause() { this.generation++; this.controller?.abort(); this.controller = null; }
  private guard(g: number) {
    if (g !== this.generation || typeof document !== "undefined" && document.hidden || this.options.isCurrent?.() === false) unknown();
  }
  private stored(g: number, expected?: string | null) {
    this.guard(g); const storage = this.options.storage(); this.guard(g); const raw = storage.getItem(this.key); this.guard(g);
    if (expected !== undefined && raw !== expected) unknown(); return { storage, raw };
  }
  private scoped(raw: IndependentQuery) { const q = parseIndependentQuery(raw); if (q.siteId !== this.options.siteId) unknown(); return q; }
  private async decode(raw: string, g: number): Promise<IndependentAdminPending> {
    if (new TextEncoder().encode(raw).byteLength > INDEPENDENT_BODY_LIMIT + 512) unknown();
    const v = exact(parseIndependentJson(raw), ["version", "actorId", "query", "command", "fingerprint"]);
    if (v.version !== 1 || v.actorId !== this.options.actorId) unknown();
    const pair = parseIndependentBody({ query: v.query, command: v.command }); this.scoped(pair.query);
    const fingerprint = await independentAdminCommandFingerprint(pair.query.siteId, this.options.actorId, pair.command); this.guard(g);
    if (v.fingerprint !== fingerprint) unknown(); return freeze({ version: 1, actorId: this.options.actorId, ...pair, fingerprint });
  }
  /** Local only. Damaged/foreign bytes remain for deliberate investigation. */
  async load(): Promise<IndependentAdminPending | null> {
    if (this.busy) unknown(); this.busy = true; const g = this.generation;
    try { const { raw } = this.stored(g); if (raw === null) return null; const pending = await this.decode(raw, g); this.stored(g, raw); return pending; }
    finally { this.busy = false; }
  }
  private async stage(pair: IndependentBody, g: number) {
    this.scoped(pair.query); this.stored(g, null);
    const fingerprint = await independentAdminCommandFingerprint(pair.query.siteId, this.options.actorId, pair.command); this.guard(g);
    const pending: IndependentAdminPending = freeze({ version: 1, actorId: this.options.actorId, ...pair, fingerprint }), raw = JSON.stringify(pending);
    if (new TextEncoder().encode(raw).byteLength > INDEPENDENT_BODY_LIMIT + 512) unknown();
    const { storage } = this.stored(g, null); storage.setItem(this.key, raw); this.stored(g, raw); return { pending, raw };
  }
  private async transport(query: IndependentQuery, body: string | null, g: number, stored: string | null, command: IndependentCommand | null = null) {
    const controller = new AbortController(); this.controller = controller;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined, rejectDeadline: (e: Error) => void = () => {};
    const deadline = new Promise<never>((_, reject) => { rejectDeadline = reject; });
    const abort = () => { void reader?.cancel().catch(() => {}); rejectDeadline(Error("unknown_result")); };
    controller.signal.addEventListener("abort", abort, { once: true });
    const limit = this.options.timeoutMs ?? 12000, started = performance.now(), timer = setTimeout(() => controller.abort(), limit);
    const guard = () => { this.guard(g); if (controller.signal.aborted || performance.now() - started >= limit) unknown(); this.stored(g, stored); };
    const run = async () => {
      guard(); const response = await this.options.apiFetch(INDEPENDENT_ADMIN_API + (body === null ? "?" + independentQueryString(query) : ""), {
        method: body === null ? "GET" : "POST", cache: "no-store", redirect: "error", signal: controller.signal,
        headers: body === null ? { Accept: "application/json" } : { Accept: "application/json", "Content-Type": "application/json" }, ...(body === null ? {} : { body }) });
      try { guard(); } catch (e) { void response.body?.cancel().catch(() => {}); throw e; }
      if (!response.ok || response.status !== 200 || response.redirected
        || response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
        void response.body?.cancel().catch(() => {}); unknown();
      }
      reader = response.body?.getReader(); if (!reader) unknown();
      const decoder = new TextDecoder("utf-8", { fatal: true }); let bytes = 0, text = "";
      try { while (true) { const chunk = await reader.read(); guard(); if (chunk.done) break; bytes += chunk.value.byteLength;
        if (bytes > INDEPENDENT_RESPONSE_LIMIT) unknown(); text += decoder.decode(chunk.value, { stream: true }); } text += decoder.decode(); }
      finally { void reader.cancel().catch(() => {}); reader.releaseLock(); reader = undefined; }
      guard(); const envelope = exact(parseIndependentJson(text), ["ok", "data"]); if (envelope.ok !== true) unknown();
      const result = await parseIndependentAdminResult(envelope.data, query, this.options.actorId, command); guard(); return result;
    };
    try { return await Promise.race([run(), deadline]); }
    finally { clearTimeout(timer); controller.signal.removeEventListener("abort", abort); if (this.controller === controller) this.controller = null; }
  }
  /** Explicit GET only; pending blocks unrelated reads, including history. */
  async read(raw: IndependentQuery): Promise<IndependentAdminResult> {
    if (this.busy) unknown(); this.busy = true; const g = this.generation;
    try { const q = this.scoped(raw); if (q.mode === "recover") unknown(); this.stored(g, null);
      const result = await this.transport(q, null, g, null); this.stored(g, null); return result; }
    finally { this.busy = false; }
  }
  /** Even a valid POST receipt leaves the exact operation durably pending. */
  async post(query: IndependentQuery, command: IndependentCommand, pin: string | null = null): Promise<IndependentAdminResult> {
    if (this.busy) unknown(); this.busy = true; const g = this.generation;
    try {
      // Snapshot the transient body before the first await; never store its PIN.
      const transient = parseIndependentOwnerBody(pin === null ? { query, command } : { query, command, pin }), body = JSON.stringify(transient);
      if (new TextEncoder().encode(body).byteLength > INDEPENDENT_BODY_LIMIT) unknown();
      const pair = parseIndependentBody({ query: transient.query, command: transient.command }), token = await this.stage(pair, g);
      this.stored(g, token.raw);
      const result = await this.transport(pair.query, body, g, token.raw, pair.command);
      this.stored(g, token.raw);
      if (!result.receipt || !independentAdminReceiptMatches(result.receipt, pair.command, this.options.actorId, token.pending.fingerprint)) unknown(); return result;
    } finally { this.busy = false; }
  }
  /** Only the original actor's matching minimal GET clears the staged bytes.
   * null/404/timeouts/late/foreign responses cannot establish a failed write. */
  async recover(): Promise<IndependentAdminResult> {
    if (this.busy) unknown(); this.busy = true; const g = this.generation;
    try {
      const { raw } = this.stored(g); if (raw === null) unknown(); const pending = await this.decode(raw, g); this.stored(g, raw);
      const q: IndependentQuery = { siteId: this.options.siteId, mode: "recover", subjectId: pending.command.subjectId, operationId: pending.command.operationId };
      const result = await this.transport(q, null, g, raw, pending.command); this.stored(g, raw);
      if (result.data.kind !== "receipt" || !result.receipt || !independentAdminReceiptMatches(result.receipt, pending.command, this.options.actorId, pending.fingerprint)) unknown();
      const { storage } = this.stored(g, raw); storage.removeItem(this.key); this.stored(g, null); return result;
    } finally { this.busy = false; }
  }
}
