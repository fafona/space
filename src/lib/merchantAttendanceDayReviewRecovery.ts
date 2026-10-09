// C15-A durable per-tab intent and original-number GET recovery. This does not
// POST, retry, end an unconfirmed attempt, save evidence or grant any authority.
import type { AttendanceApiFetch } from "./merchantAttendanceSelfClient";
import { captureBrowserExact as exact } from "./merchantAttendanceRuleCapturesBrowser";
import { freeze, hash, safeTree, uuid } from "./merchantAttendancePlanExceptionValidation";
import { DAY_REVIEW_API, DAY_REVIEW_REQUEST_LIMIT, DAY_REVIEW_RESPONSE_LIMIT, dayReviewCommandFingerprint, dayReviewQueryString,
  dayReviewReceiptMatches, parseDayReviewBody, parseDayReviewJson, parseDayReviewQuery, type DayReviewAccess, type DayReviewCommand, type DayReviewQuery } from "./merchantAttendanceDayReviewContract";
import { parseDayReviewSavedResult, type DayReviewSavedResult } from "./merchantAttendanceDayReviewResult";
import { MerchantAttendanceError } from "./merchantAttendanceTime";

export type DayReviewPending = Readonly<{ version: 1; actorId: string; query: DayReviewQuery; command: DayReviewCommand; fingerprint: string }>;
export type DayReviewRecoveryStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type Options = Readonly<{ siteId: string; actorId: string; access: DayReviewAccess; storage: () => DayReviewRecoveryStorage;
  apiFetch: AttendanceApiFetch; isCurrent?: () => boolean; timeoutMs?: number }>;
type Token = Readonly<{ pending: DayReviewPending; raw: string }>;
function fail(): never { throw new MerchantAttendanceError("attendance_day_review_recovery_required"); }
function scope(query: DayReviewQuery, siteId: string, access: DayReviewAccess) {
  if (query.siteId !== siteId || query.mode !== "preview" && query.mode !== "detail" || query.access !== access) fail();
}
export function dayReviewPendingKey(siteId: string, access: DayReviewAccess, actorId: string): string {
  parseDayReviewQuery({ siteId, mode: "recover", operationId: uuid(actorId) }); if (access !== "owner" && access !== "self") fail();
  return `faolla:attendance:day-reviews:v1:${siteId}:${access}:${actorId}`;
}
/** SessionStorage-like single-tab storage is required. It is not a claim of
 * cross-tab localStorage CAS. Ambiguous/changed storage is never overwritten. */
export class AttendanceDayReviewRecovery {
  readonly key: string;
  private readonly options: Options;
  private generation = 0;
  private busy = false;
  private controller: AbortController | null = null;
  constructor(options: Options) {
    this.key = dayReviewPendingKey(options.siteId, options.access, options.actorId);
    if (typeof options.storage !== "function" || typeof options.apiFetch !== "function"
      || options.isCurrent !== undefined && typeof options.isCurrent !== "function"
      || options.timeoutMs !== undefined && (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1 || options.timeoutMs > 12000)) fail();
    this.options = Object.freeze({ ...options });
  }
  pause() { this.generation++; this.controller?.abort(); this.controller = null; }
  private guard(g: number) {
    if (g !== this.generation || typeof document !== "undefined" && document.hidden || this.options.isCurrent?.() === false) fail();
  }
  private stored(g: number) { this.guard(g); const storage = this.options.storage(); this.guard(g); const raw = storage.getItem(this.key); this.guard(g); return { storage, raw }; }
  private unchanged(g: number, raw: string | null) { const found = this.stored(g); if (found.raw !== raw) fail(); return found.storage; }
  private async decode(raw: string, g: number): Promise<DayReviewPending> {
    const value = exact(parseDayReviewJson(raw, DAY_REVIEW_REQUEST_LIMIT + 512), ["version", "actorId", "query", "command", "fingerprint"]);
    if (value.version !== 1 || value.actorId !== this.options.actorId) fail();
    const { query, command } = parseDayReviewBody({ query: value.query, command: value.command }); scope(query, this.options.siteId, this.options.access);
    if (command.action === "decide" ? command.employeeAuthUserId === this.options.actorId : this.options.access !== "self") fail();
    const fingerprint = hash(value.fingerprint), calculated = await dayReviewCommandFingerprint(query, this.options.actorId, command); this.guard(g);
    if (calculated !== fingerprint) fail(); return freeze({ version: 1, actorId: this.options.actorId, query, command, fingerprint });
  }
  /** Zero network, even for a valid pending operation. Invalid bytes remain. */
  async load(): Promise<DayReviewPending | null> {
    if (this.busy) fail(); this.busy = true; const g = this.generation;
    try { const { raw } = this.stored(g); if (raw === null) return null; const pending = await this.decode(raw, g); this.unchanged(g, raw); return pending; }
    finally { this.busy = false; }
  }
  /** Called once before the separate explicit POST. There is no replacement or
   * retry method; even a GET 404 does not prove that an old operation failed. */
  async stage(rawQuery: DayReviewQuery, rawCommand: DayReviewCommand): Promise<DayReviewPending> {
    if (this.busy) fail(); this.busy = true; const g = this.generation;
    try {
      const { query, command } = parseDayReviewBody({ query: rawQuery, command: rawCommand }); scope(query, this.options.siteId, this.options.access);
      if (command.action === "decide" ? command.employeeAuthUserId === this.options.actorId : this.options.access !== "self") fail();
      this.unchanged(g, null); const fingerprint = await dayReviewCommandFingerprint(query, this.options.actorId, command); this.guard(g);
      const pending: DayReviewPending = freeze({ version: 1, actorId: this.options.actorId, query, command, fingerprint });
      const raw = JSON.stringify(pending); safeTree(pending, DAY_REVIEW_REQUEST_LIMIT + 512);
      const storage = this.unchanged(g, null); this.guard(g); storage.setItem(this.key, raw); this.guard(g); this.unchanged(g, raw); return pending;
    } finally { this.busy = false; }
  }
  private async receipt(token: Token, g: number): Promise<DayReviewSavedResult> {
    const query: DayReviewQuery = { siteId: this.options.siteId, mode: "recover", operationId: token.pending.command.operationId };
    const controller = new AbortController(); this.controller = controller;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined, rejectTimeout: (e: Error) => void = () => {};
    const cancel = () => { controller.abort(); void reader?.cancel().catch(() => {}); rejectTimeout(Error("unknown_result")); };
    const abort = () => cancel(); controller.signal.addEventListener("abort", abort, { once: true });
    const deadline = new Promise<never>((_, reject) => { rejectTimeout = reject; });
    const limit = this.options.timeoutMs ?? 12000, started = performance.now(), timer = setTimeout(cancel, limit);
    const guard = () => { this.guard(g); if (controller.signal.aborted || performance.now() - started >= limit) fail(); this.unchanged(g, token.raw); };
    const run = async () => {
      guard(); const response = await this.options.apiFetch(DAY_REVIEW_API + "?" + dayReviewQueryString(query), {
        method: "GET", headers: { Accept: "application/json" }, cache: "no-store", redirect: "error", signal: controller.signal });
      try { guard(); } catch (error) { void response.body?.cancel().catch(() => {}); throw error; }
      if (response.status !== 200 || !response.ok || response.redirected
        || response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
        void response.body?.cancel().catch(() => {}); fail();
      }
      reader = response.body?.getReader(); if (!reader) fail();
      const decoder = new TextDecoder("utf-8", { fatal: true }); let bytes = 0, text = "";
      try {
        while (true) { const chunk = await reader.read(); guard(); if (chunk.done) break;
          bytes += chunk.value.byteLength; if (bytes > DAY_REVIEW_RESPONSE_LIMIT) fail(); text += decoder.decode(chunk.value, { stream: true }); }
        text += decoder.decode();
      } finally { void reader.cancel().catch(() => {}); reader.releaseLock(); reader = undefined; }
      guard(); const value = exact(parseDayReviewJson(text, DAY_REVIEW_RESPONSE_LIMIT), ["ok", "data"]); if (value.ok !== true) fail();
      const result = parseDayReviewSavedResult(value.data, query, this.options.actorId);
      if (result.kind !== "receipt" || !dayReviewReceiptMatches(result.receipt, token.pending.query, this.options.actorId, token.pending.command, token.pending.fingerprint)) fail();
      guard(); return result;
    };
    try { return await Promise.race([run(), deadline]); }
    finally { clearTimeout(timer); controller.signal.removeEventListener("abort", abort); if (this.controller === controller) this.controller = null; }
  }
  /** Only this explicit GET may clear exactly the staged bytes. Unknown, late,
   * foreign, dynamic-detail or storage-raced results preserve the original. */
  async recover(): Promise<DayReviewSavedResult> {
    if (this.busy) fail(); this.busy = true; const g = this.generation;
    try {
      const { raw } = this.stored(g); if (raw === null) fail(); const pending = await this.decode(raw, g); this.unchanged(g, raw);
      const result = await this.receipt({ pending, raw }, g); this.guard(g);
      const storage = this.unchanged(g, raw); storage.removeItem(this.key); this.guard(g); this.unchanged(g, null); return result;
    } finally { this.busy = false; }
  }
}
