// Synthetic transport shared by the isolated component demo and client tests.
// No native location, real accounts, network fetch or persistent business data.
import { attendanceReviewState, parseAttendanceLocationReviewCommand, parseAttendanceLocationReviewQuery, type AttendanceLocationReviewResult, type AttendanceReviewEntry } from "../../src/lib/merchantAttendanceLocationReview";
import type { AttendanceApiFetch } from "../../src/lib/merchantAttendanceSelfClient";
export const reviewFixtureId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const reviewFixtureSite = "99990001", reviewFixtureOwner = reviewFixtureId(1), reviewFixtureEvent = reviewFixtureId(2);
export const reviewFixtureAt = "2026-09-30T10:00:00.000001Z", reviewFixtureAsOf = "2026-09-30T12:00:00.000001Z";
export function createAttendanceReviewFixture(options: { eventId?: string; occurredAt?: string; workerName?: string } = {}) {
  const fixtureEvent = options.eventId ?? reviewFixtureEvent, fixtureAt = options.occurredAt ?? reviewFixtureAt;
  const history: AttendanceReviewEntry[] = [], receipts = new Map<string, { command: string; entry: AttendanceReviewEntry }>();
  let mode = "normal", moduleEnabled = true, writes = 0;
  const calls: { method: string; url: string; body: string | null }[] = [];
  const item = () => ({ id: fixtureEvent, workerId: reviewFixtureId(3), locationId: reviewFixtureId(4), workerName: options.workerName ?? "合成人员", workerNo: "SYN-01", locationName: "合成地点", sequence: 1,
    action: "clock_in" as const, source: "web" as const, timeZone: "UTC", breakPaid: null, occurredAt: fixtureAt, reason: "denied" as const,
    reviewState: attendanceReviewState(history[0]?.outcome ?? null), reviewRevision: history[0]?.revision ?? 0 });
  const detail = (operationId: string | null = null): Extract<AttendanceLocationReviewResult, { mode: "detail" }> => ({ siteId: reviewFixtureSite, mode: "detail", asOf: reviewFixtureAsOf, item: item(),
    summary: { capturedAt: null, accuracyMeters: null, distanceMeters: null, settingsVersion: 1, workerVersion: 1, locationVersion: 1, algorithmVersion: 1 },
    history: history.slice(0, 20), historyTruncated: history.length > 20, receipt: operationId && receipts.has(operationId) ? { ...receipts.get(operationId)!.entry, operationId } : null });
  const apiFetch: AttendanceApiFetch = async (url, init) => {
    const method = init?.method ?? "GET", body = init?.body ? String(init.body) : null; calls.push({ method, url: String(url), body });
    const fail = (error: string, status: number) => Response.json({ ok: false, error }, { status });
    if (mode === "offline" || method === "POST" && mode === "unsent") throw Error("synthetic_network_failure");
    if (mode === "timeout" || method === "POST" && mode === "post_timeout") return new Promise<Response>(() => {});
    if (mode === "denied") return fail("attendance_access_denied", 403);
    if (method === "POST") {
      const { command, siteId } = parseAttendanceLocationReviewCommand(JSON.parse(body!));
      if (siteId !== reviewFixtureSite || command.eventId !== fixtureEvent) return fail("attendance_review_not_found", 404);
      if (mode === "reject") return fail("attendance_version_conflict", 409);
      const old = receipts.get(command.operationId);
      if (old && old.command !== JSON.stringify(command)) return fail("attendance_operation_conflict", 409);
      if (!old) {
        if (command.expectedRevision !== history.length) return fail("attendance_version_conflict", 409);
        if (command.outcome === "reopen" && item().reviewState === "pending") return fail("attendance_invalid_request", 400);
        const entry: AttendanceReviewEntry = { revision: history.length + 1, outcome: command.outcome, note: command.note,
          recordedAt: "2026-09-30T11:00:00.000001Z", actorRef: "a".repeat(32), byCurrentOwner: true };
        history.unshift(entry); receipts.set(command.operationId, { command: JSON.stringify(command), entry }); writes++;
      }
      if (mode === "lost") throw Error("synthetic_response_lost_after_commit");
      return Response.json({ ok: true, moduleEnabled, ...detail(command.operationId) });
    }
    const q = parseAttendanceLocationReviewQuery(new URL(String(url), "http://synthetic.invalid").href);
    if (q.siteId !== reviewFixtureSite) return fail("attendance_access_denied", 403);
    if (q.mode === "detail") {
      if (q.eventId !== fixtureEvent) return fail("attendance_review_not_found", 404);
      return Response.json({ ok: true, moduleEnabled, ...detail(q.operationId), ...(mode === "wrong_site" ? { siteId: "99990002" } : {}) });
    }
    const row = item();
    const matches = row.occurredAt >= q.fromAt && row.occurredAt < q.toAt && (!q.workerId || row.workerId === q.workerId) && (!q.locationId || row.locationId === q.locationId) && (q.status === "all" || q.status === row.reviewState);
    const emptyFirst = mode === "empty_page" && !q.cursorId;
    return Response.json({ ok: true, moduleEnabled, siteId: mode === "wrong_site" ? "99990002" : q.siteId, mode: "list", asOf: q.asOf ?? reviewFixtureAsOf,
      scanned: emptyFirst ? 50 : 1, items: matches && !emptyFirst ? [row] : [], nextCursor: emptyFirst ? { occurredAt: "2026-09-30T10:30:00.000001Z", id: reviewFixtureId(5) } : null });
  };
  return { apiFetch, calls, detail, history, mode: (value: string) => { mode = value; }, enabled: (value: boolean) => { moduleEnabled = value; }, writes: () => writes };
}
