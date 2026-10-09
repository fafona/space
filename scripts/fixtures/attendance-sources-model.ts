// Small synthetic wire fixture. No credentials, database or business writes.
import type { SourcesQuery } from "../../src/lib/merchantAttendanceSources";
export const sourcesId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const sourcesOwner = sourcesId(99);
export const sourcesQuery: SourcesQuery = { siteId: "99990001", workerId: sourcesId(201), fromDate: "2026-09-29", throughDate: "2026-10-01" };
export function sourcesWire(query = sourcesQuery) {
  const fromAt = `${query.fromDate}T00:00:00.000Z`, toAt = new Date(Date.parse(`${query.throughDate}T00:00:00.000Z`) + 86400000).toISOString();
  const readAt = "2026-10-04T12:00:00.000001Z", worker = { workerId: query.workerId, workerName: "Synthetic source worker", workerNo: "QA-201", employeeId: sourcesId(101), version: 1, active: true };
  return { protocol: "sources-v1", siteId: query.siteId, actorId: sourcesOwner, fromDate: query.fromDate, throughDate: query.throughDate,
    worker, settingsVersion: 1, timeZone: "UTC", fromAt, toAt, readAt,
    attendance: { version: "attendance-unified-v1", access: "owner", complete: true, payrollReady: false, missing: [],
      base: { siteId: query.siteId, workerId: query.workerId, employeeId: worker.employeeId, workerName: worker.workerName, workerNo: worker.workerNo,
        fromDate: query.fromDate, throughDate: query.throughDate, fromAt: fromAt.replace(".000Z", ".000000Z"), toAt: toAt.replace(".000Z", ".000000Z"),
        timeZone: "UTC", asOf: readAt, sourceVersion: "raw-and-approved-v2", complete: true, items: [] } },
    assignments: { limited: false, items: [] }, rules: { limited: false, items: [{ groupId: null, revision: 0, publications: [] }] },
    schedule: { limited: false, items: [] }, leave: { limited: false, items: [] }, calendar: { limited: false, items: [] } };
}
export const sourcesHttp = (query = sourcesQuery, moduleEnabled = true) => ({ ok: true, moduleEnabled, data: sourcesWire(query) });
