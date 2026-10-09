// Pure candidate only. This does not verify publication, real source, timezone
// ownership or authority, and never reads/writes/sends/confirms/seals a period.
// UTC boundaries (including skipped interior dates) belong to the existing V2
// authoritative server preview. Only the requested civil date must exist here.
import { MerchantAttendanceError, attendanceDayUtcRange, attendanceTimeZone } from "./merchantAttendanceTime";
import { captureBrowserExact } from "./merchantAttendanceRuleCapturesBrowser";
import { OPERATIONAL_RULE_KEYS, parseOperationalRules, type OperationalRuleChoice, type OperationalTimesheetCycle } from "./merchantAttendanceOperationalRules";

export const OPERATIONAL_CYCLE_PROTOCOL = "attendance-operational-cycle-candidate-v1" as const;
export type OperationalCycleRange = Readonly<{ fromDate: string; throughDate: string; civilDays: number }>;
export type OperationalCycleInput = Readonly<{ date: string; timeZone: string; cycle: OperationalTimesheetCycle }>;
export type OperationalCycleChoiceInput = Readonly<{ date: string; timeZone: string; choice: OperationalRuleChoice<OperationalTimesheetCycle> }>;
export type OperationalCycleCandidate = Readonly<{
  protocol: typeof OPERATIONAL_CYCLE_PROTOCOL; candidateOnly: true; applied: false;
  date: string; timeZone: string; source: "provided_value" | "provided_choice";
  choice: OperationalRuleChoice<OperationalTimesheetCycle>;
  reason: null | "manual" | "disabled" | "unconfigured";
  range: OperationalCycleRange | null;
}>;

const DAY_MS = 86_400_000;
function invalid(): never { throw new MerchantAttendanceError("attendance_operational_cycle_invalid"); }
function freeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
function exact(raw: unknown, keys: readonly string[]) { try { return captureBrowserExact(raw, keys); } catch { return invalid(); } }
function civilDate(raw: unknown): string {
  if (typeof raw !== "string" || raw.length !== 10 || !/^\d{4}-\d{2}-\d{2}$/.test(raw)
    || raw < "2000-01-01" || raw > "2100-12-31") invalid();
  const milliseconds = Date.parse(raw + "T00:00:00.000Z");
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString().slice(0, 10) !== raw) invalid();
  return raw;
}
function parsedChoice(raw: unknown): OperationalRuleChoice<OperationalTimesheetCycle> {
  // The seven inherited fields exist only to call the exact, already-established
  // value parser. No resolver runs and no default policy/source is manufactured.
  const document = Object.fromEntries(OPERATIONAL_RULE_KEYS.map(key => [key, key === "timesheetCycle" ? raw : { mode: "inherit" }]));
  try { return parseOperationalRules(document).timesheetCycle; } catch { return invalid(); }
}
const ordinal = (date: string) => Date.parse(date + "T00:00:00.000Z") / DAY_MS;
const dateAt = (day: number) => new Date(day * DAY_MS).toISOString().slice(0, 10);
function rangeFor(date: string, cycle: OperationalTimesheetCycle): OperationalCycleRange {
  const at = ordinal(date); let start: number, end: number;
  if (cycle.kind === "weekly") {
    // ISO convention: Monday=1, Sunday=7. Never use the host's local weekday.
    const weekday = new Date(at * DAY_MS).getUTCDay() || 7;
    start = at - (weekday - cycle.weekStartsOn + 7) % 7; end = start + 6;
  } else if (cycle.kind === "fortnightly") {
    const anchor = ordinal(cycle.anchorDate);
    // floor, not truncation: dates before the anchor occupy the preceding block.
    start = anchor + Math.floor((at - anchor) / 14) * 14; end = start + 13;
  } else if (cycle.kind === "monthly") {
    start = ordinal(date.slice(0, 7) + "-01");
    const next = new Date(start * DAY_MS); next.setUTCMonth(next.getUTCMonth() + 1);
    end = next.getTime() / DAY_MS - 1;
  } else return invalid();
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end - start < 0 || end - start > 30 || at < start || at > end) invalid();
  const fromDate = dateAt(start), throughDate = dateAt(end);
  if (fromDate < "2000-01-01" || throughDate > "2100-12-31") throw new MerchantAttendanceError("attendance_operational_cycle_out_of_range");
  // Validate the entire civil range without clipping a boundary period.
  civilDate(fromDate); civilDate(throughDate);
  return { fromDate, throughDate, civilDays: end - start + 1 };
}
function candidate(dateRaw: unknown, zoneRaw: unknown, choice: OperationalRuleChoice<OperationalTimesheetCycle>, source: OperationalCycleCandidate["source"]): OperationalCycleCandidate {
  const date = civilDate(dateRaw); let timeZone: string;
  try { timeZone = attendanceTimeZone(zoneRaw as string); } catch { return invalid(); }
  // This verifies only the provided target date/zone. It is not proof that the
  // zone is the merchant's saved setting, nor a calculation of period UTC edges.
  attendanceDayUtcRange(date, timeZone);
  const reason = choice.mode === "inherit" ? "unconfigured" : choice.mode === "disabled" ? "disabled" : choice.value.kind === "manual" ? "manual" : null;
  const range = reason === null && choice.mode === "value" ? rangeFor(date, choice.value) : null;
  return freeze({ protocol: OPERATIONAL_CYCLE_PROTOCOL, candidateOnly: true, applied: false, date, timeZone, source, choice, reason, range });
}
/** The supplied value is not a checked/selected publication. */
export function suggestOperationalCycle(raw: unknown): OperationalCycleCandidate {
  const input = exact(raw, ["date", "timeZone", "cycle"]);
  return candidate(input.date, input.timeZone, parsedChoice({ mode: "value", value: input.cycle }), "provided_value");
}
/** Maps only the supplied choice. inherit means unconfigured here, not proof
 * that no enterprise/group/personal publication exists. disabled and manual
 * explicitly provide no suggestion; neither creates a default weekly period. */
export function suggestOperationalCycleChoice(raw: unknown): OperationalCycleCandidate {
  const input = exact(raw, ["date", "timeZone", "choice"]);
  return candidate(input.date, input.timeZone, parsedChoice(input.choice), "provided_choice");
}
