// Synthetic metadata only. This is NOT the SQL function or an Auth verifier.
import { createHash } from "node:crypto";
import { parseCaptureBrowserJson } from "../../src/lib/merchantAttendanceRuleCapturesBrowser";
import { parseAttendanceAdminQuery, parseAttendanceAdminResult, type AttendanceAdminWorker } from "../../src/lib/merchantAttendanceAdmin";
import { parsePeriodClosureHttpQuery, parsePeriodClosureResponse, type PeriodClosureSummary } from "../../src/lib/merchantAttendancePeriodClosure";
import { RETENTION_API, RETENTION_CATEGORIES, RETENTION_ERRORS, parseRetentionBody, parseRetentionHttpQuery,
  parseRetentionResponse, retentionCommandFingerprintText,
  type RetentionCategory, type RetentionCommand, type RetentionPolicy, type RetentionPreservation,
  type RetentionQuery, type RetentionReceipt, type RetentionRecord, type RetentionResult } from "../../src/lib/merchantAttendanceRetention";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const retentionBrowserSeed = Object.freeze({ siteId: "99990223", owner: id(1), other: id(2), recordId: id(3),
  workerId: id(4), periodId: id(5), artifactId: id(14), activeWorkerId: id(10), fromDate: "2026-10-07", throughDate: "2026-10-07", at: "2026-10-07T12:00:00.000000Z" });
const seed = retentionBrowserSeed;
const sha = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const basePolicy = (category: RetentionCategory): RetentionPolicy => ({ category, revision: 0, retentionDays: null, operationId: null, recordedAt: null });
const basePreservation = (): RetentionPreservation => ({ revision: 0, held: false, operationId: null, actorId: null, reason: null, recordedAt: null });
const error = (code: string) => ({ status: RETENTION_ERRORS[code] ?? 503, body: { ok: false, error: code } });

export function createRetentionBrowserModel() {
  const policies = new Map(RETENTION_CATEGORIES.map(category => [category, basePolicy(category)]));
  const preservations = new Map(RETENTION_CATEGORIES.map(category => [category, basePreservation()]));
  const receipts = new Map<string, RetentionReceipt>();
  const counters = { requests: 0, gets: 0, posts: 0, successfulWrites: 0 };
  const workers: AttendanceAdminWorker[] = [
    { id: seed.workerId, employeeId: id(8), workerNo: "QA-INACTIVE", displayName: "合成停用人员", locationId: id(6), active: false, startsOn: "2026-01-01" },
    { id: seed.activeWorkerId, employeeId: id(11), workerNo: "QA-ACTIVE", displayName: "合成在职人员", locationId: id(6), active: true, startsOn: "2026-01-01" },
  ];
  // Explicit synthetic historical identity. Never derive it from current Auth.
  const period: PeriodClosureSummary = { workerId: seed.workerId, employeeId: id(8), employeeAuthUserId: id(13), workerName: "合成停用人员", workerNo: "QA-INACTIVE",
    fromDate: seed.fromDate, throughDate: seed.throughDate, timeZone: "Europe/Madrid", startAt: "2026-10-06T22:00:00.000000Z", endAt: "2026-10-07T22:00:00.000000Z",
    periodId: seed.periodId, revision: 2, currentVersion: 1, state: "sealed", sealed: true, confirmedVersion: 1, unresolvedDispute: false };
  function record(category: RetentionCategory): RetentionRecord {
    const recordId = category === "period_artifact" ? seed.artifactId : seed.recordId;
    const event = { kind: "event" as const, eventId: seed.recordId, workerId: seed.workerId, locationId: id(6), operationId: id(7), sequence: 1,
      action: "clock_in" as const, rawSource: "web" as const, breakPaid: null, occurredAt: seed.at, receivedAt: seed.at, timeZone: "Europe/Madrid", actorEmployeeId: null };
    const source: RetentionRecord["source"] = category === "events" ? event : category === "location_results"
      ? { kind: "location_summary", event, settingsVersion: 1, workerVersion: 1, locationVersion: 1, algorithmVersion: 1,
        reason: "not_provided", needsReview: true, capturedAt: null, accuracyMeters: null, distanceMeters: null }
      : { kind: "period_artifact", artifactId: seed.artifactId, periodId: seed.periodId, workerId: seed.workerId, employeeId: id(8),
        fromDate: seed.fromDate, throughDate: seed.throughDate, timeZone: "Europe/Madrid", startAt: "2026-10-06T22:00:00.000000Z", endAt: "2026-10-07T22:00:00.000000Z",
        recordedAt: seed.at, artifactSha256: sha("synthetic immutable artifact"), artifactBytes: 29, sourceFingerprint: sha("synthetic artifact input") };
    const policy = policies.get(category)!;
    const dueAt = policy.retentionDays === null ? null : new Date(Date.parse(seed.at) + policy.retentionDays * 86400000).toISOString().replace(".000Z", ".000000Z");
    return { category, recordId, source, sourceFingerprint: sha(JSON.stringify({ siteId: seed.siteId, category, recordId, source })),
      policy: structuredClone(policy), anchorAt: seed.at, asOf: seed.at, dueAt, ageState: dueAt === null ? "unconfigured" : "not_due",
      preservation: structuredClone(preservations.get(category)!) };
  }
  function envelope(data: RetentionResult["data"], canWrite: boolean, receipt: RetentionReceipt | null = null): RetentionResult {
    return { protocol: "attendance-retention-v1", siteId: seed.siteId, actorId: seed.owner, readAt: seed.at, canWrite, data, receipt, disposition: "preview_only" };
  }
  function response(query: RetentionQuery, result: RetentionResult, command: RetentionCommand | null = null) {
    const body = { ok: true, canWrite: result.canWrite, data: result };
    parseRetentionResponse(body, query, seed.owner, command); return { status: 200, body };
  }
  function respond(input: { url: string; method: string; actor: string; enabled: boolean; body?: string }) {
    counters.requests++; if (input.method === "POST") counters.posts++; else counters.gets++;
    if (input.actor !== seed.owner) return error("attendance_access_denied");
    try {
      const url = new URL(input.url);
      if (url.pathname === "/api/merchant-enterprise/attendance/admin" && input.method === "GET") {
        const query = parseAttendanceAdminQuery(input.url);
        if (query.siteId !== seed.siteId || query.view !== "workers" || query.operationId !== null || query.cursor !== null) return error("attendance_invalid_request");
        const body = { ok: true, siteId: seed.siteId, version: 1, settings: { timeZone: "Europe/Madrid", enabled: false, webClockEnabled: false, webBreakPaid: false },
          view: "workers", items: structuredClone(workers.filter(w => !query.search || `${w.workerNo} ${w.displayName}`.includes(query.search))), nextCursor: null, receipt: null, moduleEnabled: false };
        parseAttendanceAdminResult(body, query); return { status: 200, body };
      }
      if (url.pathname === "/api/merchant-enterprise/attendance/period-closures" && input.method === "GET") {
        const query = parsePeriodClosureHttpQuery(input.url);
        if (query.siteId !== seed.siteId || query.workerId !== seed.workerId || query.mode !== "list" || query.access !== "owner") return error("attendance_invalid_request");
        const body = { ok: true, moduleEnabled: false, data: { protocol: "period-closure-v1", siteId: seed.siteId, actorId: seed.owner,
          workerId: seed.workerId, access: "owner", readAt: seed.at, kind: "list",
          items: query.fromDate === period.fromDate && query.throughDate === period.throughDate ? [structuredClone(period)] : [] } };
        parsePeriodClosureResponse(body, query, { ownerId: seed.owner }); return { status: 200, body };
      }
      if (url.pathname !== RETENTION_API || !["GET", "POST"].includes(input.method)) return error("attendance_invalid_request");
      const body = input.method === "POST" ? parseRetentionBody(parseCaptureBrowserJson(input.body ?? "")) : null;
      const query = body?.query ?? parseRetentionHttpQuery(input.url), command = body?.command ?? null;
      if (query.siteId !== seed.siteId) return error("attendance_access_denied");
      if (command) {
        const existing = receipts.get(command.operationId);
        if (existing) return existing.commandFingerprint === sha(retentionCommandFingerprintText(command))
          ? response(query, envelope({ kind: "receipt" }, false, existing), command) : error("attendance_operation_conflict");
        if (!input.enabled) return error("attendance_retention_disabled");
        if (command.action === "set_policy") {
          const current = policies.get(command.category)!;
          if (command.expectedRevision !== current.revision) return error("attendance_retention_changed");
          if (command.retentionDays === current.retentionDays) return error("attendance_retention_unchanged");
        } else {
          if (command.recordId !== record(command.category).recordId) return error("attendance_retention_not_found");
          const current = record(command.category);
          if (command.expectedRevision !== current.preservation.revision || command.expectedSourceFingerprint !== current.sourceFingerprint) return error("attendance_retention_changed");
          if ((command.action === "hold") === current.preservation.held) return error("attendance_retention_unchanged");
        }
        const receipt: RetentionReceipt = { operationId: command.operationId, actorId: seed.owner, revision: command.expectedRevision + 1,
          command: structuredClone(command), commandFingerprint: sha(retentionCommandFingerprintText(command)), recordedAt: seed.at };
        const done = response(query, envelope({ kind: "receipt" }, false, receipt), command);
        if (command.action === "set_policy") policies.set(command.category, { category: command.category, revision: receipt.revision,
          retentionDays: command.retentionDays, operationId: command.operationId, recordedAt: seed.at });
        else preservations.set(command.category, { revision: receipt.revision, held: command.action === "hold", operationId: command.operationId,
          actorId: seed.owner, reason: command.reason, recordedAt: seed.at });
        receipts.set(command.operationId, receipt); counters.successfulWrites++; return done;
      }
      if (query.mode === "recover") return response(query, envelope({ kind: "receipt" }, false, receipts.get(query.operationId) ?? null));
      if (query.mode === "policies") return response(query, envelope({ kind: "policies", items: RETENTION_CATEGORIES.map(c => structuredClone(policies.get(c)!)) }, input.enabled));
      if (query.mode === "record") return query.recordId === record(query.category).recordId ? response(query, envelope({ kind: "record", item: record(query.category) }, input.enabled)) : error("attendance_retention_not_found");
      if (query.mode === "preview") {
        const selected = query.workerId === seed.workerId && (query.category === "period_artifact" ? query.periodId === seed.periodId
          : query.fromAt <= seed.at && seed.at < query.toAt);
        return response(query, envelope({ kind: "preview", asOf: seed.at, items: selected ? [record(query.category)] : [] }, false));
      }
      const items = [...receipts.values()].filter(r => r.command.category === query.category
        && (r.command.action === "set_policy" ? query.recordId === null : r.command.recordId === query.recordId)
        && (query.beforeRevision === null || r.revision < query.beforeRevision)).sort((a, b) => b.revision - a.revision);
      return response(query, envelope({ kind: "history", items: items.slice(0, 25), nextBeforeRevision: items.length > 25 ? items[24].revision : null }, false));
    } catch { return error("attendance_invalid_request"); }
  }
  return { respond, snapshot: () => ({ syntheticOnly: true, realSql: false, realAuth: false, ...counters,
    policies: structuredClone([...policies.values()]), receipts: structuredClone([...receipts.values()]),
    records: RETENTION_CATEGORIES.map(record) }) };
}
