//199 explicit bounded reads only. No polling, POST, source manufacture or
//receipt recovery; the separate attempt client owns the staged write intent.
import type { AttendanceApiFetch } from "./merchantAttendanceSelfClient";
import { captureBrowserExact as exact } from "./merchantAttendanceRuleCapturesBrowser";
import { DAY_REVIEW_API, DAY_REVIEW_RESPONSE_LIMIT, dayReviewQueryString, parseDayReviewJson, parseDayReviewQuery,
  type DayReviewAccess, type DayReviewQuery } from "./merchantAttendanceDayReviewContract";
import { parseDayReviewSavedResult, type DayReviewSavedResult } from "./merchantAttendanceDayReviewResult";
import { parseDayReviewSourceView, type DayReviewSourceView } from "./merchantAttendanceDayReviewSource";
import { dayReviewPendingKey, type DayReviewRecoveryStorage } from "./merchantAttendanceDayReviewRecovery";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
export type DayReviewReadResult = DayReviewSavedResult | DayReviewSourceView;
type Options = Readonly<{ siteId: string; actorId: string; access: DayReviewAccess; apiFetch: AttendanceApiFetch;
  storage: () => DayReviewRecoveryStorage; isCurrent?: () => boolean; timeoutMs?: number }>;
function fail(): never { throw new MerchantAttendanceError("attendance_day_review_read_required"); }
export class AttendanceDayReviewReader {
  private readonly options: Options;
  private readonly key: string;
  private generation = 0;
  private busy = false;
  private controller: AbortController | null = null;
  constructor(options: Options) {
    this.key = dayReviewPendingKey(options.siteId, options.access, options.actorId);
    if (options.timeoutMs !== undefined && (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1 || options.timeoutMs > 12000)) fail();
    this.options = Object.freeze({ ...options });
  }
  pause(): void { this.generation++; this.controller?.abort(); this.controller = null; }
  private guard(g: number): void {
    if (g !== this.generation || typeof document !== "undefined" && document.hidden || this.options.isCurrent?.() === false) fail();
    const storage = this.options.storage(); if (storage.getItem(this.key) !== null) fail();
    if (g !== this.generation || this.options.isCurrent?.() === false) fail();
  }
  async read(raw: DayReviewQuery): Promise<DayReviewReadResult> {
    if (this.busy) fail(); const q = parseDayReviewQuery(raw);
    if (q.siteId !== this.options.siteId || q.mode === "recover" || q.access !== this.options.access) fail();
    this.busy = true; const g = this.generation, controller = new AbortController(); this.controller = controller;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined, reject!: (error: Error) => void;
    const interruption = new Promise<never>((_, r) => { reject = r; });
    const stop = () => { void reader?.cancel().catch(() => {}); reject(new MerchantAttendanceError("attendance_day_review_read_required")); };
    controller.signal.addEventListener("abort", stop, { once: true });
    const limit = this.options.timeoutMs ?? 12000, deadline = performance.now() + limit;
    const timer = setTimeout(() => controller.abort(), limit);
    const check = () => { this.guard(g); if (controller.signal.aborted || performance.now() >= deadline) fail(); };
    const run = async () => {
      check(); const response = await this.options.apiFetch(DAY_REVIEW_API + "?" + dayReviewQueryString(q), {
        method: "GET", cache: "no-store", redirect: "error", headers: { Accept: "application/json" }, signal: controller.signal });
      try { check(); } catch (error) { void response.body?.cancel().catch(() => {}); throw error; }
      if (!response.ok || response.status !== 200 || response.redirected || response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
        void response.body?.cancel().catch(() => {}); fail(); }
      reader = response.body?.getReader(); if (!reader) fail(); let bytes = 0, text = "";
      const decoder = new TextDecoder("utf-8", { fatal: true });
      try { while (true) { const part = await reader.read(); check(); if (part.done) break;
        bytes += part.value.byteLength; if (bytes > DAY_REVIEW_RESPONSE_LIMIT) fail(); text += decoder.decode(part.value, { stream: true }); }
        text += decoder.decode();
      } finally { void reader.cancel().catch(() => {}); reader.releaseLock(); reader = undefined; }
      check(); const value = exact(parseDayReviewJson(text, DAY_REVIEW_RESPONSE_LIMIT), ["ok", "data"]); if (value.ok !== true) fail();
      const result = q.mode === "candidates" || q.mode === "preview" ? parseDayReviewSourceView(value.data, q, this.options.actorId)
        : parseDayReviewSavedResult(value.data, q, this.options.actorId);
      check(); return result;
    };
    try { return await Promise.race([run(), interruption]); }
    catch { return fail(); }
    finally { this.busy = false; clearTimeout(timer); controller.signal.removeEventListener("abort", stop);
      if (this.controller === controller) this.controller = null; }
  }
}
