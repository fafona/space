//201 narrow, explicitly re-authorized navigation. A saved reminder is a stale
//pointer, never a grant, a current approval decision, or an approval command.
import type { AttendanceApiFetch } from "./merchantAttendanceSelfClient";
import { captureBrowserExact as exact } from "./merchantAttendanceRuleCapturesBrowser";
import { uuid, integer } from "./merchantAttendancePlanExceptionValidation";
import { operationalRuleLedgerFreeze as freeze } from "./merchantAttendanceOperationalRuleLedger";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { assertAttendanceReminderTree, type AttendanceReminderTarget } from "./merchantAttendanceReminders";
import { attendanceReminderPendingKey, remindersAuthCurrent, type ReminderStorage } from "./merchantAttendanceRemindersClient";
import { correctionDecisionKey } from "./merchantAttendanceCorrectionDecisionClient";
import { reviewRoutingPendingKey } from "./merchantAttendanceReviewRoutingClient";
import { REVIEW_ROUTING_API, REVIEW_ROUTING_RESPONSE_LIMIT, REVIEW_ROUTING_FAMILIES, parseReviewRoutingJson, parseReviewRoutingQuery,
  parseReviewRoutingResponse, reviewRoutingQueryString, type ReviewRoutingRequest } from "./merchantAttendanceReviewRouting";
import { CYCLE_INTENT_API, parseCycleIntentQuery, cycleIntentQueryString } from "./merchantAttendanceCycleIntent";
import { CYCLE_INTENT_RESULT_LIMIT, parseCycleIntentResultJson, parseCycleIntentResponse, type CycleIntentResult } from "./merchantAttendanceCycleIntentResult";
import { cycleIntentPendingKey } from "./merchantAttendanceCycleIntentClient";
import { periodClosurePendingKey } from "./merchantAttendancePeriodClosureClient";

export type ReminderReviewTarget = Extract<AttendanceReminderTarget, { kind: "pending_review" }>;
export type ReminderNavigationState = Readonly<{ phase: "idle" | "loading" | "ready" | "blocked"; message: string }>;
export type ReminderNavigationOptions = Readonly<{ siteId: string; actorId: string; ownerId: string; apiFetch: AttendanceApiFetch;
  storage: () => Pick<ReminderStorage, "getItem">; isCurrentAuth?: () => boolean;
  onState?: (state: ReminderNavigationState) => void; timeoutMs?: number }>;
function unknown(): never { throw new MerchantAttendanceError("attendance_reminder_changed"); }
const hidden = () => typeof document !== "undefined" && document.hidden;
export function reminderOriginalSupported(target: AttendanceReminderTarget): boolean { return target.kind === "pending_review" || target.kind === "period_due"; }
export function reminderOriginalTarget(raw: AttendanceReminderTarget): ReminderReviewTarget {
  assertAttendanceReminderTree(raw, "request"); const v = exact(raw, ["kind", "family", "requestId", "responsibilityRevision", "responsibilityOperationId"]);
  if (v.kind !== "pending_review" || !REVIEW_ROUTING_FAMILIES.includes(v.family as ReminderReviewTarget["family"])) unknown();
  return freeze({ kind: "pending_review", family: v.family as ReminderReviewTarget["family"], requestId: uuid(v.requestId), responsibilityRevision: integer(v.responsibilityRevision), responsibilityOperationId: uuid(v.responsibilityOperationId) });
}
export class AttendanceReminderNavigation {
  private readonly options: ReminderNavigationOptions;
  private readonly keys: readonly string[];
  private state: ReminderNavigationState = freeze({ phase: "idle", message: "负责人须重新核验当前审批或周期原入口；提醒不授予权限。" });
  private controller: AbortController | null = null; private generation = 0; private disposed = false; private notifying = false;
  constructor(options: ReminderNavigationOptions) {
    this.keys = [attendanceReminderPendingKey(options.siteId, options.actorId), correctionDecisionKey(options.siteId, options.actorId), reviewRoutingPendingKey(options.siteId, options.actorId)];
    if (uuid(options.ownerId) !== options.actorId || typeof options.apiFetch !== "function" || typeof options.storage !== "function"
      || options.timeoutMs !== undefined && (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1 || options.timeoutMs > 12000)) unknown();
    this.options = Object.freeze({ ...options });
  }
  getSnapshot = () => this.state;
  private publish(state: ReminderNavigationState) { this.state = freeze(state); if (!this.disposed && !this.notifying) { this.notifying = true;
    try { this.options.onState?.(state); } catch { /* No authority. */ } finally { this.notifying = false; } } }
  pause = () => { this.generation++; const prior = this.controller; this.controller = null; prior?.abort(); this.publish({ phase: "idle", message: "跳转正文已清除；请重新明确核验原入口。" }); };
  dispose = () => { this.disposed = true; this.pause(); };
  hasLeaveRisk = () => this.controller !== null;
  private current() { return !this.disposed && !hidden() && remindersAuthCurrent(this.options.isCurrentAuth); }
  private noPending(extraKeys: readonly string[]) { const storage = this.options.storage(); if ([...this.keys, ...extraKeys].some(k => storage.getItem(k) !== null)) unknown(); }
  /** Returns only a fresh, strictly parsed original identity. The real host must
   * check its own drafts/pending again and the original panel must re-read. */
  freshOriginal = async (raw: AttendanceReminderTarget): Promise<ReviewRoutingRequest> => {
    const target = reminderOriginalTarget(raw), query = parseReviewRoutingQuery({ siteId: this.options.siteId, mode: "detail", family: target.family, requestId: target.requestId });
    return this.readOriginal(REVIEW_ROUTING_API + "?" + reviewRoutingQueryString(query), REVIEW_ROUTING_RESPONSE_LIMIT, async text => {
      const parsed = await parseReviewRoutingResponse(parseReviewRoutingJson(text), query, this.options.actorId);
      if (!parsed.ok || parsed.data.data.kind !== "detail") unknown(); const detail = parsed.data.data;
      if (detail.request.family !== target.family || detail.request.requestId !== target.requestId
        || !detail.current || detail.current.operationId !== target.responsibilityOperationId || detail.current.revision !== target.responsibilityRevision
        || detail.current.assignment.kind !== "owner" || detail.current.assignment.authUserId !== this.options.actorId
        || detail.observation.status !== "submitted" || !detail.observation.bindingCurrent || detail.observation.routeState !== "assigned" || detail.observation.reason !== null) unknown();
      return detail.request;
    });
  };
  freshPeriod = async (raw: AttendanceReminderTarget): Promise<CycleIntentResult> => {
    assertAttendanceReminderTree(raw, "request"); const value = exact(raw, ["kind", "workerId", "intentId"]); if (value.kind !== "period_due") unknown();
    const query = parseCycleIntentQuery({ siteId: this.options.siteId, access: "owner", workerId: uuid(value.workerId), grantId: null, mode: "detail", intentId: uuid(value.intentId) });
    return this.readOriginal(CYCLE_INTENT_API + "?" + cycleIntentQueryString(query), CYCLE_INTENT_RESULT_LIMIT, async text => {
      const parsed = (await parseCycleIntentResponse(parseCycleIntentResultJson(text), query, this.options.actorId)).data;
      if (parsed.data.kind !== "detail" || parsed.receipt !== null || parsed.data.intent.access !== "owner" || parsed.data.intent.grantId !== null
        || parsed.data.intent.actorId !== this.options.actorId || parsed.data.intent.workerId !== query.workerId
        || parsed.data.head.action !== "accept" || parsed.data.head.revision !== 1) unknown();
      return parsed;
    }, [cycleIntentPendingKey(this.options.siteId, this.options.actorId), periodClosurePendingKey(this.options.siteId, "owner", this.options.actorId)]);
  };
  private async readOriginal<T>(path: string, limit: number, parse: (text: string) => Promise<T>, extraKeys: readonly string[] = []): Promise<T> {
    if (this.controller || !this.current()) unknown();
    const controller = new AbortController(), generation = ++this.generation, deadline = performance.now() + (this.options.timeoutMs ?? 12000);
    this.controller = controller;
    const guard = () => { if (!this.current() || controller.signal.aborted || this.controller !== controller || generation !== this.generation || performance.now() >= deadline) unknown(); this.noPending(extraKeys);
      if (!this.current() || controller.signal.aborted || this.controller !== controller || generation !== this.generation || performance.now() >= deadline) unknown(); };
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined, reject!: (error: Error) => void;
    const interrupted = new Promise<never>((_, no) => { reject = no; }), abort = () => { void reader?.cancel().catch(() => {}); reject(Error("cancelled")); };
    controller.signal.addEventListener("abort", abort, { once: true }); const timer = setTimeout(() => controller.abort(), Math.max(0, deadline - performance.now()));
    try {
      return await Promise.race([Promise.resolve().then(async () => {
        guard(); this.publish({ phase: "loading", message: "正在重新读取当前原入口及完整身份；未提交任何业务操作。" }); guard();
        const response = await this.options.apiFetch(path, { method: "GET", cache: "no-store", redirect: "error", signal: controller.signal, headers: { Accept: "application/json" } });
        try { guard(); } catch (error) { void response.body?.cancel().catch(() => {}); throw error; }
        if (response.status !== 200 || !response.ok || response.redirected || response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") { void response.body?.cancel().catch(() => {}); unknown(); }
        reader = response.body?.getReader(); if (!reader) unknown(); let bytes = 0, text = ""; const decoder = new TextDecoder("utf-8", { fatal: true });
        try { while (true) { const part = await reader.read(); guard(); if (part.done) break; bytes += part.value.byteLength; if (bytes > limit) unknown(); text += decoder.decode(part.value, { stream: true }); } text += decoder.decode(); }
        finally { void reader.cancel().catch(() => {}); reader.releaseLock(); reader = undefined; }
        const parsed = await parse(text); guard();
        this.publish({ phase: "ready", message: "当前原始身份已核验；进入原入口后仍须重新读取，不自动审批、送审或标记已读。" }); guard(); return parsed;
      }), interrupted]);
    } catch { if (generation === this.generation && !this.disposed) this.publish({ phase: "blocked", message: "原入口尚不能核实，可能责任或身份已变化；未打开、未审批、未标记已读。" }); return unknown(); }
    finally { clearTimeout(timer); controller.signal.removeEventListener("abort", abort); if (this.controller === controller) this.controller = null; }
  }
}
