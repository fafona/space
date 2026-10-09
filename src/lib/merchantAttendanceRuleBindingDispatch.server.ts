type ClockChannel = "self" | "location" | "pin" | "onsite";
type BindingEnvironment = Readonly<Record<string, string | undefined>>;

const RPCS = {
  self: ["faolla_attendance_self_v1", "faolla_attendance_self_bound_v1"],
  location: ["faolla_attendance_location_clock_v2", "faolla_attendance_location_clock_bound_v1"],
  pin: ["faolla_attendance_pin_clock_v1", "faolla_attendance_pin_clock_bound_v1"],
  onsite: ["faolla_attendance_onsite_clock_v1", "faolla_attendance_onsite_clock_bound_v1"],
} as const;

/** Independent, server-only pilot gate. This selects a transaction wrapper, not
 * attendance authorization: all existing permissions/identity/clock guards still
 * run inside the original RPC. No flag or wildcard silently opts all merchants in.
 * New migration installation alone leaves all four current dispatches unchanged. */
export function attendanceClockRpcName(channel: ClockChannel, siteId: string, env: BindingEnvironment = process.env): string {
  const disabled = RPCS[channel][0];
  if (env.FAOLLA_ATTENDANCE_RULE_BINDINGS_ENABLED !== "1" || !/^\d{8}$/.test(siteId)) return disabled;
  const raw = env.FAOLLA_ATTENDANCE_RULE_BINDINGS_SITE_IDS;
  if (typeof raw !== "string" || raw.length > 4096) return disabled;
  const sites = raw.split(",").map(value => value.trim());
  if (sites.length > 100 || sites.some(value => !/^\d{8}$/.test(value))) return disabled;
  return sites.includes(siteId) ? RPCS[channel][1] : disabled;
}
