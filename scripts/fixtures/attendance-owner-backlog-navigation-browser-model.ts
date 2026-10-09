//229 synthetic GET-only protocol fixture. NOT SQL, Auth or approval execution.
import { parseAttendanceAdminQuery, parseAttendanceAdminResult } from "../../src/lib/merchantAttendanceAdmin";
import { parseOwnerBacklogHttpQuery, parseOwnerBacklogResponse, type OwnerBacklogKind } from "../../src/lib/merchantAttendanceOwnerBacklog";
import { parseCorrectionDecisionQuery } from "../../src/lib/merchantAttendanceCorrectionDecision";
import { parseCurrentCorrectionResponse } from "../../src/lib/merchantAttendanceCurrentCorrectionResponse";
import { correctionDecisionKey, parseCorrectionDecisionPending } from "../../src/lib/merchantAttendanceCorrectionDecisionClient";
import { parseRevisionApprovalHttpQuery, parseRevisionApprovalResponse } from "../../src/lib/merchantAttendanceRevisionApprovalResponse";
import { revisionApprovalKey, parseRevisionApprovalPending } from "../../src/lib/merchantAttendanceRevisionApprovalClient";
import { missingQueryString, parseMissingBody, parseMissingQuery, parseMissingResult, type MissingQuery } from "../../src/lib/merchantAttendanceMissing";
import { decisionQuery, decisionCommand, decisionResponse, currentDecisionResult } from "./attendance-correction-decision-model";
import { revisionApprovalResponse, recoverRevisionApproval } from "./attendance-revision-approval-model";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const backlogNavigationSeed = Object.freeze({ siteId: "99990001", owner: id(1), other: id(229999), worker: id(2), employee: id(3),
  correction: decisionQuery.requestId, revision: revisionApprovalResponse().requestId, missing: id(229003),
  submittedAt: "2026-09-30T11:00:00.000000Z", asOf: "2026-10-07T12:00:00.000000Z" });
const seed = backlogNavigationSeed;
export const backlogNavigationApi = Object.freeze({ admin: "/api/merchant-enterprise/attendance/admin", backlog: "/api/merchant-enterprise/attendance/owner-backlog",
  correction: "/api/merchant-enterprise/attendance/correction-decisions", revision: "/api/merchant-enterprise/attendance/revision-decisions", missing: "/api/merchant-enterprise/attendance/missing" });
type Mode = "normal" | "processed" | "denied" | "paused";
type Configuration = { kind?: OwnerBacklogKind; mode?: Mode; receiptAvailable?: boolean };
const replace = <T>(v: T, values: Record<string, string>): T => JSON.parse(JSON.stringify(v, (_k, value) => typeof value === "string" ? values[value] ?? value : value));
const fail = (error = "attendance_invalid_request", status = 400) => ({ status, body: { ok: false, error } });
const pendingId = (kind: OwnerBacklogKind) => id(229100 + ["correction", "revision", "missing"].indexOf(kind));
const operationId = (kind: OwnerBacklogKind) => id(229200 + ["correction", "revision", "missing"].indexOf(kind));
const missingQuery = (requestId: string): MissingQuery => ({ siteId: seed.siteId, access: "owner", fromDate: "2026-09-30", throughDate: "2026-09-30",
  requestId, operationId: null, beforeAt: null, beforeId: null });

export function backlogNavigationPending(kind: OwnerBacklogKind) {
  const requestId = pendingId(kind), op = operationId(kind);
  if (kind === "correction") {
    const value = { siteId: seed.siteId, ownerId: seed.owner, command: { ...decisionCommand, requestId, operationId: op, action: "reject" as const } };
    const raw = JSON.stringify(value); parseCorrectionDecisionPending(raw, seed.siteId, seed.owner);
    return { key: correctionDecisionKey(seed.siteId, seed.owner), raw, requestId, operationId: op };
  }
  if (kind === "revision") {
    const value = { siteId: seed.siteId, ownerId: seed.owner, command: { ...revisionApprovalResponse("reject").decision!.command, requestId, operationId: op } };
    const raw = JSON.stringify(value); parseRevisionApprovalPending(raw, seed.siteId, seed.owner);
    return { key: revisionApprovalKey(seed.siteId, seed.owner), raw, requestId, operationId: op };
  }
  const value = { actorId: seed.owner, query: missingQuery(requestId), command: { action: "reject" as const, operationId: op, requestId, expectedRevision: 1, evidenceToken: "a".repeat(32), reason: "Synthetic saved pending intent" } };
  parseMissingBody({ query: value.query, command: value.command });
  const raw = JSON.stringify(value);
  //The production parser takes only {query,command}; actorId belongs to its storage envelope.
  return { key: `faolla:attendance:missing:v1:${seed.siteId}:owner:${seed.owner}`, raw, requestId, operationId: op };
}

export function createBacklogNavigationModel() {
  const modes: Record<OwnerBacklogKind, Mode> = { correction: "normal", revision: "normal", missing: "normal" };
  let receiptAvailable = false;
  const calls: { method: string; path: string; actor: string; requestId: string | null; operationId: string | null; status: number }[] = [];
  const configure = (value: Configuration) => {
    if (!value || Object.keys(value).some(k => !["kind", "mode", "receiptAvailable"].includes(k))
      || value.kind !== undefined && !["correction", "revision", "missing"].includes(value.kind)
      || value.mode !== undefined && !["normal", "processed", "denied", "paused"].includes(value.mode)
      || value.receiptAvailable !== undefined && typeof value.receiptAvailable !== "boolean") throw Error("backlog_navigation_configuration");
    if (value.mode !== undefined) {
      if (value.kind) modes[value.kind] = value.mode; else for (const kind of Object.keys(modes) as OwnerBacklogKind[]) modes[kind] = value.mode;
    }
    if (value.receiptAvailable !== undefined) receiptAvailable = value.receiptAvailable;
  };
  function value(kind: OwnerBacklogKind, url: URL) {
    const requestId = url.searchParams.get("requestId"), op = url.searchParams.get("operationId"), pending = requestId === pendingId(kind);
    if (kind === "missing" && requestId === null && op === null) {
      const q = parseMissingQuery(url.href);
      const body = { ok: true, moduleEnabled: modes.missing !== "paused", siteId: seed.siteId, access: "owner", employeeId: null, workerId: null,
        locationId: null, timeZone: "UTC", canRequest: false, settingsVersion: 1, policyRevision: 1, fromDate: q.fromDate, throughDate: q.throughDate,
        asOf: seed.asOf, items: [], nextCursor: null, detail: null, receipt: null, includedInTimesheet: false };
      parseMissingResult(body, q); return { status: 200, body };
    }
    if (requestId !== seed[kind] && !pending) return fail("attendance_correction_not_found", 404);
    if (op && (!pending || op !== operationId(kind))) return fail("attendance_operation_conflict", 409);
    if (modes[kind] === "denied") return fail("attendance_access_denied", 403);
    const closed = modes[kind] === "processed" || pending && receiptAvailable, enabled = modes[kind] !== "paused";
    if (kind === "correction") {
      const q = parseCorrectionDecisionQuery(url.href);
      const r = currentDecisionResult(decisionResponse(closed ? "reject" : null, pending && receiptAvailable), { writeEnabled: enabled });
      const body = replace({ ok: true, moduleEnabled: enabled, ...r }, { [decisionQuery.requestId]: requestId!, [decisionCommand.operationId]: operationId(kind) });
      parseCurrentCorrectionResponse(body, q); return { status: 200, body };
    }
    if (kind === "revision") {
      const q = parseRevisionApprovalHttpQuery(url.href), initial = revisionApprovalResponse(closed ? "reject" : null);
      const r = closed ? recoverRevisionApproval(initial) : initial;
      if (!op || !receiptAvailable) { r.receipt = null; r.replayed = false; }
      r.writeEnabled = enabled; if (!enabled) r.canApprove = r.canReject = false;
      const body = replace({ ok: true, moduleEnabled: enabled, ...r }, { [seed.revision]: requestId!, [revisionApprovalResponse("reject").decision!.operationId]: operationId(kind) });
      parseRevisionApprovalResponse(body, q); return { status: 200, body };
    }
    const q = parseMissingQuery(url.href), saved = JSON.parse(backlogNavigationPending("missing").raw);
    const detail = { requestId: requestId!, employeeId: seed.employee, workerName: "合成待审员工", startAt: "2026-09-28T08:00:00.000000Z", endAt: "2026-09-28T10:00:00.000000Z",
      submittedAt: seed.submittedAt, revision: closed ? 2 : 1, status: closed ? "rejected" : "submitted", reason: "合成整段漏卡声明", proposal: { startAt: "2026-09-28T08:00:00.000000Z", endAt: "2026-09-28T10:00:00.000000Z", breaks: [] },
      locationName: "合成地点", timeZone: "UTC", policyRevision: 1, deadlineAt: "2026-10-30T23:59:59.000000Z", terminal: closed ? { reason: pending ? saved.command.reason : "合成已处理", recordedAt: "2026-10-01T12:00:00.000000Z" } : null,
      issues: closed ? ["terminal"] : [], evidenceToken: "a".repeat(32), canApprove: enabled && !closed, canReject: enabled && !closed,
      lineage: { rootRequestId: requestId!, supersedesRequestId: null, currentRequestId: null, currentApprovalOperationId: null, canRevise: false } };
    const body = { ok: true, moduleEnabled: enabled, siteId: seed.siteId, access: "owner", employeeId: null, workerId: null, locationId: null, timeZone: "UTC", canRequest: false,
      settingsVersion: 1, policyRevision: 1, fromDate: q.fromDate, throughDate: q.throughDate, asOf: seed.asOf, items: [], nextCursor: null, detail,
      receipt: pending && receiptAvailable && op ? { operationId: op, requestId, revision: 2, command: saved.command } : null, includedInTimesheet: false };
    parseMissingResult(body, q); return { status: 200, body };
  }
  function respond(input: { url: string; method: string; actor: string }) {
    const url = new URL(input.url); let result;
    try {
      if (input.method !== "GET") result = fail("method_not_allowed", 405);
      else if (input.actor !== seed.owner) result = fail("attendance_access_denied", 403);
      else if (url.pathname === backlogNavigationApi.admin) {
        const q = parseAttendanceAdminQuery(url.href);
        if (q.siteId !== seed.siteId || q.view !== "settings" || q.operationId || q.cursor || q.search) throw Error("admin_scope");
        const body = { ok: true, moduleEnabled: true, siteId: seed.siteId, view: "settings", version: 1,
          settings: { timeZone: "Europe/Madrid", enabled: true, webClockEnabled: true, webBreakPaid: false }, items: [], nextCursor: null, receipt: null };
        parseAttendanceAdminResult(body, q); result = { status: 200, body };
      } else if (url.pathname === backlogNavigationApi.backlog) {
        const q = parseOwnerBacklogHttpQuery(url.href); if (q.siteId !== seed.siteId) throw Error("site");
        //The intentionally stale list is independent of a later detail state.
        const items = (["correction", "revision", "missing"] as const).filter(kind => q.kind === "all" || q.kind === kind).map(kind => ({ kind, requestId: seed[kind], workerId: seed.worker,
          workerName: "合成待审员工", workerNo: "QA-229", submittedAt: seed.submittedAt, proposedStartAt: "2026-09-28T08:00:00.000000Z", proposedEndAt: "2026-09-28T10:00:00.000000Z", status: "submitted" }));
        const body = { ok: true, moduleEnabled: true, protocol: "owner-backlog-v1", readOnly: true, siteId: seed.siteId, ownerId: seed.owner, asOf: q.asOf ?? seed.asOf,
          items: q.cursorAt ? [] : items, scanned: q.cursorAt ? 0 : items.length, nextCursor: null };
        parseOwnerBacklogResponse(body, q); result = { status: 200, body };
      } else {
        const kind = (["correction", "revision", "missing"] as const).find(k => backlogNavigationApi[k] === url.pathname);
        if (!kind || url.searchParams.get("siteId") !== seed.siteId) throw Error("route"); result = value(kind, url);
      }
    } catch { result = fail(); }
    calls.push({ method: input.method, path: url.pathname, actor: input.actor, requestId: url.searchParams.get("requestId"), operationId: url.searchParams.get("operationId"), status: result.status });
    return result;
  }
  return { respond, configure, pending: backlogNavigationPending,
    snapshot: () => ({ syntheticOnly: true, realSql: false, realAuth: false, successfulWrites: 0, calls: structuredClone(calls), modes: { ...modes }, receiptAvailable }) };
}
export const backlogNavigationMissingQueryString = (requestId: string) => missingQueryString(missingQuery(requestId));
