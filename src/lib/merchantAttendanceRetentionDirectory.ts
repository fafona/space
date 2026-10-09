import type { AttendanceApiFetch } from "./merchantAttendanceSelfClient";
import { parseAttendanceAdminQuery, parseAttendanceAdminResult, type AttendanceAdminWorker } from "./merchantAttendanceAdmin";
import { parsePeriodClosureQuery, parsePeriodClosureResponse, periodClosureQueryString, type PeriodClosureSummary } from "./merchantAttendancePeriodClosure";
import { exact, site, uuid } from "./merchantAttendancePlanExceptionValidation";
import { parseCaptureBrowserJson } from "./merchantAttendanceRuleCapturesBrowser";

// Explicit, bounded reads of existing directories. This helper never posts,
// stores identities, derives historical Auth, or automatically follows pages.
async function read(apiFetch: AttendanceApiFetch, url: string, signal: AbortSignal): Promise<unknown> {
  const controller = new AbortController(), deadline = performance.now() + 12000; let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let reject!: (e: Error) => void;
  const stopped = new Promise<never>((_, no) => { reject = no; });
  const abort = () => { controller.abort(); void reader?.cancel().catch(() => {}); reject(Error("directory_aborted")); };
  const timer = setTimeout(abort, 12000); signal.addEventListener("abort", abort, { once: true });
  const check = () => { if (signal.aborted || controller.signal.aborted || performance.now() >= deadline) throw Error("directory_aborted"); };
  const task = async () => {
    check();
    const response = await apiFetch(url, { method: "GET", headers: { Accept: "application/json" }, cache: "no-store", redirect: "error", signal: controller.signal });
    if (controller.signal.aborted || response.status !== 200 || response.redirected || response.headers.get("content-type")?.split(";")[0].trim() !== "application/json") {
      void response.body?.cancel().catch(() => {}); throw Error("directory_unavailable");
    }
    check(); reader = response.body?.getReader(); if (!reader) throw Error("directory_empty");
    const decoder = new TextDecoder("utf-8", { fatal: true }); let bytes = 0, text = "";
    while (true) { check(); const part = await reader.read(); check(); if (part.done) break;
      bytes += part.value.byteLength; if (bytes > 131072) throw Error("directory_too_large"); text += decoder.decode(part.value, { stream: true }); }
    check(); const value = parseCaptureBrowserJson(text + decoder.decode()); check(); return value;
  };
  try { return await Promise.race([task(), stopped]); }
  finally { clearTimeout(timer); signal.removeEventListener("abort", abort); controller.abort(); if (reader) { const ownedReader = reader; void ownedReader.cancel().catch(() => {}).finally(() => { try { ownedReader.releaseLock(); } catch { /* Pending abort read may still own the lock. */ } }); } }
}
export async function readRetentionWorkers(apiFetch: AttendanceApiFetch, siteId: string, signal: AbortSignal, search = "", cursor: string | null = null) {
  const params = new URLSearchParams({ siteId: site(siteId), view: "workers", search }); if (cursor) params.set("cursor", uuid(cursor));
  const url = `/api/merchant-enterprise/attendance/admin?${params}`, q = parseAttendanceAdminQuery(`https://local.invalid${url}`);
  const body = exact(await read(apiFetch, url, signal), ["ok", "siteId", "version", "settings", "view", "items", "nextCursor", "receipt", "moduleEnabled"]);
  if (body.ok !== true || typeof body.moduleEnabled !== "boolean") throw Error("directory_invalid");
  const result = parseAttendanceAdminResult(body, q); if (result.receipt) throw Error("directory_invalid");
  return { items: result.items as AttendanceAdminWorker[], nextCursor: result.nextCursor };
}
export async function readRetentionPeriods(apiFetch: AttendanceApiFetch, siteId: string, actorId: string, workerId: string, fromDate: string, throughDate: string, signal: AbortSignal): Promise<PeriodClosureSummary[]> {
  const q = parsePeriodClosureQuery({ siteId: site(siteId), access: "owner", workerId: uuid(workerId), fromDate, throughDate,
    mode: "list", periodId: null, operationId: null, version: null });
  const result = parsePeriodClosureResponse(await read(apiFetch, `/api/merchant-enterprise/attendance/period-closures?${periodClosureQueryString(q)}`, signal), q, { ownerId: uuid(actorId) });
  if (result.data.kind !== "list") throw Error("directory_invalid"); return result.data.items;
}
