// C15-A explicit single-attempt transport. No automatic requests, source read,
// authority inference, retry, or clearing an intent from a dynamic POST result.
import type { AttendanceApiFetch } from "./merchantAttendanceSelfClient";
import { captureBrowserExact as exact } from "./merchantAttendanceRuleCapturesBrowser";
import { DAY_REVIEW_API, DAY_REVIEW_REQUEST_LIMIT, DAY_REVIEW_RESPONSE_LIMIT, parseDayReviewJson,
  type DayReviewAccess, type DayReviewCommand, type DayReviewQuery } from "./merchantAttendanceDayReviewContract";
import { AttendanceDayReviewRecovery, type DayReviewPending, type DayReviewRecoveryStorage } from "./merchantAttendanceDayReviewRecovery";
import { parseDayReviewSavedResult, type DayReviewSavedResult } from "./merchantAttendanceDayReviewResult";
import { MerchantAttendanceError } from "./merchantAttendanceTime";

type Options = Readonly<{ siteId: string; actorId: string; access: DayReviewAccess; storage: () => DayReviewRecoveryStorage;
  apiFetch: AttendanceApiFetch; isCurrent?: () => boolean; timeoutMs?: number }>;
function unknown(): never { throw new MerchantAttendanceError("attendance_day_review_recovery_required"); }

/** One instance belongs to one actual viewer scope. The UI must synchronously
 * pause on hide/pagehide, requester or Auth changes, and keep the saved number.
 * The caller separately confirms the frozen current source/command before post. */
export class AttendanceDayReviewAttempt {
  private readonly options: Options;
  private readonly recovery: AttendanceDayReviewRecovery;
  private generation = 0;
  private busy = false;
  private controller: AbortController | null = null;
  constructor(options: Options) {
    this.options = Object.freeze({ ...options });
    this.recovery = new AttendanceDayReviewRecovery(options);
  }
  pause(): void { this.generation++; this.controller?.abort(); this.controller = null; this.recovery.pause(); }
  private guard(g: number): void {
    if (g !== this.generation || typeof document !== "undefined" && document.hidden || this.options.isCurrent?.() === false) unknown();
  }
  /** Initialization is local only. A pending/invalid intent is never replaced. */
  async load(): Promise<DayReviewPending | null> {
    if (this.busy) unknown(); this.busy = true; const g = this.generation;
    try { this.guard(g); const pending = await this.recovery.load(); this.guard(g); return pending; }
    finally { this.busy = false; }
  }
  /** This is the sole network write. Even a valid result leaves the operation
   * staged until the user explicitly recovers its original-actor receipt. */
  async post(query: DayReviewQuery, command: DayReviewCommand): Promise<DayReviewSavedResult> {
    if (this.busy) unknown(); this.busy = true; const g = this.generation;
    try {
      this.guard(g); const pending = await this.recovery.stage(query, command); this.guard(g);
      const body = JSON.stringify({ query: pending.query, command: pending.command });
      // This exact detached command was already validated and durably saved.
      if (new TextEncoder().encode(body).byteLength > DAY_REVIEW_REQUEST_LIMIT) unknown();
      return await this.send(pending, body, g);
    } finally { this.busy = false; }
  }
  private async send(pending: DayReviewPending, body: string, g: number): Promise<DayReviewSavedResult> {
    const controller = new AbortController(); this.controller = controller;
    const original = JSON.stringify(pending);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let rejectDeadline: (error: Error) => void = () => {};
    const deadline = new Promise<never>((_, reject) => { rejectDeadline = reject; });
    const abort = () => { void reader?.cancel().catch(() => {}); rejectDeadline(Error("unknown_result")); };
    controller.signal.addEventListener("abort", abort, { once: true });
    const limit = this.options.timeoutMs ?? 12000, started = performance.now();
    const timer = setTimeout(() => controller.abort(), limit);
    const guard = () => {
      this.guard(g); if (controller.signal.aborted || performance.now() - started >= limit) unknown();
      const storage = this.options.storage(); this.guard(g); const raw = storage.getItem(this.recovery.key); this.guard(g);
      if (raw !== original) unknown();
    };
    const run = async () => {
      guard();
      const response = await this.options.apiFetch(DAY_REVIEW_API, { method: "POST", cache: "no-store", redirect: "error",
        headers: { Accept: "application/json", "Content-Type": "application/json" }, body, signal: controller.signal });
      try { guard(); } catch (error) { void response.body?.cancel().catch(() => {}); throw error; }
      if (response.status !== 200 || !response.ok || response.redirected
        || response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
        void response.body?.cancel().catch(() => {}); unknown();
      }
      reader = response.body?.getReader(); if (!reader) unknown();
      const decoder = new TextDecoder("utf-8", { fatal: true }); let bytes = 0, text = "";
      try {
        while (true) { const chunk = await reader.read(); guard(); if (chunk.done) break;
          bytes += chunk.value.byteLength; if (bytes > DAY_REVIEW_RESPONSE_LIMIT) unknown();
          text += decoder.decode(chunk.value, { stream: true }); }
        text += decoder.decode();
      } finally { void reader.cancel().catch(() => {}); reader.releaseLock(); reader = undefined; }
      guard(); const envelope = exact(parseDayReviewJson(text, DAY_REVIEW_RESPONSE_LIMIT), ["ok", "data"]);
      if (envelope.ok !== true) unknown();
      const result = parseDayReviewSavedResult(envelope.data, pending.query, this.options.actorId,
        { command: pending.command, fingerprint: pending.fingerprint });
      guard(); return result;
    };
    try { return await Promise.race([run(), deadline]); }
    catch { return unknown(); }
    finally { clearTimeout(timer); controller.signal.removeEventListener("abort", abort);
      if (this.controller === controller) this.controller = null; }
  }
  /** A saved command can only be resolved by this explicit GET. It does not
   * trigger a second POST even after a 404, timeout, refresh or permission loss. */
  async recover(): Promise<DayReviewSavedResult> {
    if (this.busy) unknown(); this.busy = true; const g = this.generation;
    try { this.guard(g); const result = await this.recovery.recover(); this.guard(g); return result; }
    finally { this.busy = false; }
  }
}
