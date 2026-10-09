//203 private RPC transport: one canonicalText, one SHA, exact bytes. No old
//owner proxy, artifact pre-read, second SQL call or body retained in receipts.
import { createHash } from "node:crypto";
import { captureBrowserExact } from "./merchantAttendanceRuleCapturesBrowser";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { attendanceRecordInstant } from "./merchantAttendanceManagement";
import { DELEGATED_AUDIT_RESULT_BYTES, assertDelegatedAuditTree, parseDelegatedAuditJson, parseDelegatedAuditQuery,
  parseDelegatedAuditBody, parseDelegatedAuditResult, type DelegatedAuditQuery, type DelegatedAuditCommand, type DelegatedAuditResult } from "./merchantAttendanceDelegatedAudit";

function fail(): never { throw new MerchantAttendanceError("attendance_delegated_audit_invalid"); }
function semantic(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(semantic).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${semantic((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
//Old066 scope receipts legitimately retain UTC milliseconds. Normalize only
//their public timestamp presentation, never their saved bytes or fingerprint.
//The complete delegated DTO parser still validates the resulting whole row.
function projectScopeRow(raw: unknown): unknown {
  const row = captureBrowserExact(raw, ["item", "before", "after"]);
  const snapshot = (rawValue: unknown): unknown => {
    if (rawValue === null) return null;
    const value = captureBrowserExact(rawValue, ["id", "workerIds", "locationIds", "validFrom", "validUntil"]);
    return { ...value, validFrom: attendanceRecordInstant(value.validFrom),
      validUntil: value.validUntil === null ? null : attendanceRecordInstant(value.validUntil) };
  };
  return { ...row, before: snapshot(row.before), after: snapshot(row.after) };
}
function projectScopePayload(raw: unknown): unknown {
  const payload = captureBrowserExact(raw, ["schemaVersion", "fromAt", "toAt", "asOf", "count", "rows"]);
  const rows = payload.rows;
  if (!Array.isArray(rows)) return fail();
  return { ...payload, rows: rows.map(projectScopeRow) };
}
export async function projectDelegatedAuditSource(raw: unknown, query: DelegatedAuditQuery, actorId: string,
  command: DelegatedAuditCommand | null = null): Promise<DelegatedAuditResult> {
  try { assertDelegatedAuditTree(raw); const q = parseDelegatedAuditQuery(query), kind = Object.getOwnPropertyDescriptor(raw, "kind")?.value;
    if (kind !== "export") {
      if (kind === "detail" && q.mode === "detail" && q.source === "scope") {
        const detail = captureBrowserExact(raw, ["protocol", "siteId", "actorId", "readAt", "kind", "grantId", "source", "scopeKind", "target", "row"]);
        return await parseDelegatedAuditResult({ ...detail, row: projectScopeRow(detail.row) }, q, actorId, command);
      }
      return await parseDelegatedAuditResult(raw, q, actorId, command);
    }
    if (q.mode !== "export" || command === null) return fail(); parseDelegatedAuditBody({ query: q, command });
    const v = captureBrowserExact(raw, ["protocol", "siteId", "actorId", "readAt", "kind", "grantId", "source", "scopeKind", "target", "receipt", "snapshotText", "snapshotBytes", "snapshotFingerprint"]);
    if (typeof v.snapshotText !== "string" || typeof v.snapshotBytes !== "number" || !Number.isSafeInteger(v.snapshotBytes)
      || v.snapshotBytes < 1 || v.snapshotBytes > DELEGATED_AUDIT_RESULT_BYTES
      || Buffer.byteLength(v.snapshotText, "utf8") !== v.snapshotBytes || typeof v.snapshotFingerprint !== "string" || !/^[0-9a-f]{64}$/.test(v.snapshotFingerprint)
      || createHash("sha256").update(v.snapshotText, "utf8").digest("hex") !== v.snapshotFingerprint) fail();
    const canonical = parseDelegatedAuditJson(v.snapshotText as string, DELEGATED_AUDIT_RESULT_BYTES);
    if (!Array.isArray(canonical) || canonical.length !== 6 || canonical[0] !== "attendance-delegated-audit-snapshot-v1"
      || canonical[1] !== q.siteId || canonical[2] !== actorId || canonical[3] !== q.grantId || semantic(canonical[4]) !== semantic(q)) fail();
    const { snapshotText, snapshotBytes, snapshotFingerprint, ...base } = v; void snapshotText; void snapshotBytes;
    const payload = q.source === "scope" ? projectScopePayload(canonical[5]) : canonical[5];
    const projected = await parseDelegatedAuditResult({ ...base, payload }, q, actorId, command);
    if (projected.kind !== "export" || projected.receipt.resultFingerprint !== snapshotFingerprint) fail();
    //Only normalized public rows and minimal receipt survive. No canonicalText,
    //salt/PIN/material/grant command/private SQL body is passed to the browser.
    return projected;
  } catch { return fail(); }
}
