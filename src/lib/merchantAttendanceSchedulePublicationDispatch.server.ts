type SchedulePublicationEnvironment = Readonly<Record<string, string | undefined>>;
type SchedulePublicationRpc = "faolla_attendance_schedule_v1" | "faolla_attendance_schedule_evidenced_v1";

/** This independent default-off pilot gate only selects a transaction wrapper.
 * Original099 and existing employee/membership constraints still authorize and
 * validate publication. This dispatch neither adds nor relaxes identity checks;
 * it does not promise that an unbound employee can successfully publish.
 * Reads/cancels never select the wrapper. No fallback or retry belongs here. */
export function attendanceSchedulePublicationRpcName(siteId: string, action: string | null,
  env: SchedulePublicationEnvironment = process.env): SchedulePublicationRpc {
  const original = "faolla_attendance_schedule_v1";
  if (action !== "publish" || env.FAOLLA_ATTENDANCE_SCHEDULE_PUBLICATION_EVIDENCE_ENABLED !== "1" || siteId.length !== 8 || !/^\d{8}$/.test(siteId)) return original;
  const raw = env.FAOLLA_ATTENDANCE_SCHEDULE_PUBLICATION_EVIDENCE_SITE_IDS;
  if (typeof raw !== "string" || raw.length > 4096) return original;
  const sites = raw.split(",").map(value => value.trim());
  if (sites.length > 100 || sites.some(value => !/^\d{8}$/.test(value))) return original;
  return sites.includes(siteId) ? "faolla_attendance_schedule_evidenced_v1" : original;
}
