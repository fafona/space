import { parseCorrectionCommand, parseCorrectionProposal, type CorrectionCommand } from "../../src/lib/merchantAttendanceCorrection";
import type { AttendanceApiFetch } from "../../src/lib/merchantAttendanceSelfClient";
import type {CorrectionRules} from "../../src/lib/merchantAttendanceCorrectionRules";
export const correctionId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const correctionSite = "99990001", correctionEmployee = correctionId(3), correctionWorker = correctionId(2), correctionStart = correctionId(10);
export const correctionNow = "2026-09-30T12:00:00.000000Z";
export function correctionRules(binding:CorrectionRules["binding"]="preparation"):CorrectionRules{return {binding,checkedAt:correctionNow,approvalAvailable:false,
  policy:binding==="legacy"?null:{revision:1,recordedAt:"2026-09-27T12:00:00.000000Z",submissionWindowDays:7,timeZone:"Europe/Madrid"},
  deadlineAt:binding==="legacy"?null:"2026-10-05T22:00:00.000000Z",lockedPeriodCount:0,issues:binding==="legacy"?["legacy_unbound"]:[]};}
export const correctionProposal = { startAt: "2026-09-28T08:00:00.000000Z", endAt: "2026-09-28T17:00:00.000000Z", breaks: [
  { startAt: "2026-09-28T12:00:00.000000Z", endAt: "2026-09-28T12:30:00.000000Z", paid: false }] };
export function correctionBasis({employeeId=correctionEmployee,workerId=correctionWorker}: {employeeId?:string;workerId?:string}={}) { return { siteId: correctionSite, employeeId, workerId, asOf: correctionNow,
  events: [{ id: correctionStart, locationId: correctionId(4), sequence: 1, action: "clock_in" as const, occurredAt: correctionProposal.startAt, timeZone: "Europe/Madrid", breakPaid: null, source: "web" as const },
    { id: correctionId(11), locationId: correctionId(4), sequence: 2, action: "clock_out" as const, occurredAt: "2026-09-28T16:00:00.000000Z", timeZone: "Europe/Madrid", breakPaid: null, source: "web" as const }] }; }
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
// Synthetic transport only: no network, credentials, production data or implied SQL/HTTP validation.
export function createCorrectionFixture({employeeId=correctionEmployee,workerId=correctionWorker}: {employeeId?:string;workerId?:string}={}) {
  const basis=()=>correctionBasis({employeeId,workerId});
  type Entry = { submit: Extract<CorrectionCommand, { action: "submit" }>; revision: number; withdrawal: { command: Extract<CorrectionCommand, { action: "withdraw" }>; revision: number } | null };
  const entries = new Map<string, Entry>(), operations = new Map<string, { command: CorrectionCommand; revision: number; requestId: string }>();
  const calls: { path: string; method: string; body: string | undefined }[] = [];
  let mode = "normal", enabled = true, permission = true, revision = 0;
  const common = () => ({ ok: true, rulesEnforced:true, decisionsAvailable:true,moduleEnabled: enabled, canRequest: permission, siteId: correctionSite,
    employeeId: employeeId, workerId: workerId, asOf: correctionNow });
  const err = (error: string, status: number) => response({ ok: false, error }, status);
  const summary = (e: Entry) => ({ requestId: e.submit.operationId, startEventId: correctionStart, revision: e.withdrawal?.revision ?? e.revision,
    status: e.withdrawal ? "withdrawn" : "submitted", decision:null,submittedAt: correctionNow, startAt: e.submit.proposal.startAt, endAt: e.submit.proposal.endAt });
  const apiFetch: AttendanceApiFetch = async (path, init) => {
    const method = init?.method ?? "GET"; calls.push({ path, method, body: typeof init?.body === "string" ? init.body : undefined });
    if (mode === "offline") throw Error("offline");
    if (mode === "denied") return err("attendance_access_denied", 403);
    const url = new URL(path, "https://synthetic.invalid"), q = url.searchParams;
    if (url.pathname.endsWith("/context")) return response({ ...common(), locationId: null, workerId: mode === "rebound" ? correctionId(99) : workerId });
    if (url.pathname.endsWith("/history")) return response({ ...common(), items: basis().events.map(e => ({ ...e, workerId: workerId, workerName: "合成员工", workerNo: "TEST-01", locationName: "合成门店" })).reverse(), nextCursor: null });
    if (url.pathname.endsWith("/session")) return response({ ...common(), ...basis() });
    if (!url.pathname.endsWith("/corrections")) return err("synthetic_route_missing", 404);
    if (mode === "rebound" || (method === "GET" && q.get("expectedWorkerId") !== workerId)) return err("attendance_worker_changed", 409);
    let requestId = q.get("requestId"), operationId = q.get("operationId");
    if (method === "POST") {
      if (mode === "unsent") throw Error("request_not_delivered");
      const parsed = parseCorrectionCommand(JSON.parse(String(init?.body))), c = parsed.command;
      if (parsed.expectedWorkerId !== workerId) return err("attendance_worker_changed", 409);
      const old = operations.get(c.operationId);
      requestId = c.action === "submit" ? c.operationId : c.requestId; operationId = c.operationId;
      if (old) { if (JSON.stringify(c) !== JSON.stringify(old.command)) return err("attendance_operation_conflict", 409); }
      else {
        if (!permission) return err("attendance_access_denied", 403);
        if (c.expectedRevision !== revision || mode === "stale") return err("attendance_version_conflict", 409);
        if (c.action === "submit") {
          if (!enabled) return err("attendance_platform_paused", 403);
          if ([...entries.values()].some(e => !e.withdrawal)) return err("attendance_correction_pending", 409);
          if (mode === "basis_changed" || c.expectedLastEventId !== correctionId(11)) return err("attendance_correction_basis_changed", 409);
          if(c.expectedPolicyRevision===undefined)return err("attendance_correction_policy_required",409);
          if(c.expectedPolicyRevision!==1||mode==="policy_changed")return err("attendance_correction_policy_changed",409);
          if(mode==="period_locked")return err("attendance_correction_period_locked",409);
          try { parseCorrectionProposal(c.proposal, correctionNow); } catch { return err("attendance_invalid_request", 400); }
          entries.set(requestId, { submit: c, revision: ++revision, withdrawal: null });
        } else {
          const e = entries.get(requestId); if (!e) return err("attendance_correction_not_found", 404);
          if (e.withdrawal) return err("attendance_correction_closed", 409);
          e.withdrawal = { command: c, revision: ++revision };
        }
        operations.set(c.operationId, { command: c, revision, requestId });
        if (mode === "lost") throw Error("committed_response_lost");
      }
    } else if (q.get("mode") === "prepare") {
      return response({ ...common(), mode: "prepare", basis: basis(), revision,rules:correctionRules(),
        pendingRequestId: [...entries.values()].find(e => !e.withdrawal)?.submit.operationId ?? null });
    } else if (q.get("mode") === "list") {
      const all = [...entries.values()].map(summary).sort((a, b) => b.requestId.localeCompare(a.requestId))
        .filter(e => !q.get("cursorId") || e.requestId < q.get("cursorId")!);
      const items = all.slice(0, 25);
      return response({ ...common(), mode: "list", items, nextCursor: all.length > 25 ? { recordedAt: correctionNow, requestId: items.at(-1)!.requestId } : null });
    }
    const e = entries.get(requestId!); if (!e) return err("attendance_correction_not_found", 404);
    const op = operations.get(operationId!);
    return response({ ...common(), mode: "detail", item: summary(e), basis: basis(), proposal: e.submit.proposal, reason: e.submit.reason,rules:correctionRules(e.submit.expectedPolicyRevision?"bound":"legacy"),
      withdrawal: e.withdrawal ? { reason: e.withdrawal.command.reason, recordedAt: correctionNow } : null,
      receipt: op && op.requestId === requestId ? { operationId, requestId, revision: op.revision, action: op.command.action, recordedAt: correctionNow } : null });
  };
  return { apiFetch, calls, writes: () => operations.size, mode: (value: string) => { mode = value; }, enabled: (v: boolean) => { enabled = v; }, canRequest: (v: boolean) => { permission = v; } };
}
