import { MerchantAttendanceError } from "./merchantAttendanceTime";

/** Current RPC/HTTP dispatch only. Historical callers keep their explicit
 * parser version; an absent or older marker is never an automatic fallback. */
export function currentAttendanceReportVersion(raw: unknown): "raw-and-approved-v2" | "raw-and-approved-v3" {
  if (raw && typeof raw === "object" && !Array.isArray(raw) && Object.hasOwn(raw, "sourceVersion")) {
    const version = (raw as Record<string, unknown>).sourceVersion;
    if (version === "raw-and-approved-v2" || version === "raw-and-approved-v3") return version;
  }
  throw new MerchantAttendanceError("attendance_report_invalid_data");
}
