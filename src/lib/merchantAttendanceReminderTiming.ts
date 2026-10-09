// Shared pure timing for the finite C07/C15-B reminder engine. No authorization,
// source eligibility, database origin, delivery, catch-up, or task registration.
// SQL owns locked clock_timestamp, exact recipients and derived-head proofs.
import { captureBrowserExact as exact } from "./merchantAttendanceRuleCapturesBrowser";
import { operationalRuleLedgerFreeze as freeze } from "./merchantAttendanceOperationalRuleLedger";
import { OPERATIONAL_RULE_KEYS, OPERATIONAL_RULE_REMINDER_KINDS, parseOperationalRules, type OperationalReminder } from "./merchantAttendanceOperationalRules";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
export type ReminderTimingInput = Readonly<{ anchorAt: string; configuration: OperationalReminder; deliveredCount: number; lastDeliveredAt: string | null }>;
export type ReminderTiming = Readonly<{ state: "disabled" | "exhausted"; ordinal: null; dueAt: null }
  | { state: "scheduled"; ordinal: number; dueAt: string }>;
const ZERO = BigInt(0), ONE = BigInt(1), THOUSAND = BigInt(1000), MINUTE = BigInt(60000000), HOUR = BigInt(3600000000);
function invalid(): never { throw new MerchantAttendanceError("attendance_reminder_invalid"); }
/** UTC6 only; microseconds survive arithmetic and half-open window checks. */
function micro(raw: unknown): bigint {
  if (typeof raw !== "string" || raw.length !== 27 || !/^(?!0000)\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(raw)) invalid();
  const ms = raw.slice(0, 23) + "Z", value = Date.parse(ms);
  if (!Number.isFinite(value) || new Date(value).toISOString() !== ms) invalid();
  return BigInt(value) * THOUSAND + BigInt(raw.slice(23, 26));
}
function stamp(value: bigint): string {
  // floor, not truncation: dates before Unix epoch also preserve UTC6 exactly.
  let milliseconds = value / THOUSAND, remainder = value % THOUSAND;
  if (remainder < ZERO) { milliseconds--; remainder += THOUSAND; }
  const number = Number(milliseconds); if (!Number.isSafeInteger(number)) invalid();
  const date = new Date(number); if (!Number.isFinite(date.getTime())) invalid();
  const iso = date.toISOString(); if (iso.length !== 24 || iso.startsWith("0000")) invalid();
  const result = iso.slice(0, -1) + remainder.toString().padStart(3, "0") + "Z"; micro(result); return result;
}
function parse(raw: unknown): ReminderTimingInput {
  try {
    const v = exact(raw, ["anchorAt", "configuration", "deliveredCount", "lastDeliveredAt"]); micro(v.anchorAt);
    if (typeof v.deliveredCount !== "number" || !Number.isInteger(v.deliveredCount) || Object.is(v.deliveredCount, -0) || v.deliveredCount < 0 || v.deliveredCount > 10
      || (v.deliveredCount === 0) !== (v.lastDeliveredAt === null)) invalid();
    const fields = Object.fromEntries(OPERATIONAL_RULE_KEYS.map(key => [key, key === "reminders" ? { mode: "value", value: Object.fromEntries(OPERATIONAL_RULE_REMINDER_KINDS.map(kind => [kind, v.configuration])) } : { mode: "inherit" }]));
    const choice = parseOperationalRules(fields).reminders; if (choice.mode !== "value") invalid();
    const configuration = choice.value.open_session;
    if (configuration.mode === "disabled" ? v.deliveredCount !== 0 : v.deliveredCount > configuration.maxOccurrences) invalid();
    if (v.lastDeliveredAt !== null) {
      const last = micro(v.lastDeliveredAt);
      if (configuration.mode !== "enabled" || last < micro(v.anchorAt) + BigInt(configuration.afterMinutes + (v.deliveredCount - 1) * configuration.repeatMinutes) * MINUTE) invalid();
    }
    return freeze({ anchorAt: v.anchorAt as string, configuration, deliveredCount: v.deliveredCount, lastDeliveredAt: v.lastDeliveredAt as string | null });
  } catch { return invalid(); }
}
/** The next ordinal is the next actual delivery, not the number of elapsed
 * theoretical rounds. A delayed run cannot consume or replay missed rounds. */
export function reminderTiming(raw: unknown): ReminderTiming {
  const value = parse(raw), rule = value.configuration;
  if (rule.mode === "disabled") return freeze({ state: "disabled", ordinal: null, dueAt: null });
  if (value.deliveredCount === rule.maxOccurrences) return freeze({ state: "exhausted", ordinal: null, dueAt: null });
  const theoretical = micro(value.anchorAt) + BigInt(rule.afterMinutes + value.deliveredCount * rule.repeatMinutes) * MINUTE;
  const limited = value.lastDeliveredAt === null ? theoretical : micro(value.lastDeliveredAt) + BigInt(rule.repeatMinutes) * MINUTE;
  return freeze({ state: "scheduled", ordinal: value.deliveredCount + 1, dueAt: stamp(theoretical > limited ? theoretical : limited) });
}
/** Applies one observed delivery only after due. The caller must first prove an
 * unused plan/ordinal and recipient/category window under database locks. */
export function reminderTimingAfterDelivery(raw: unknown, observedAt: string): ReminderTiming {
  const input = parse(raw), now = micro(observedAt), timing = reminderTiming(input);
  if (timing.state !== "scheduled" || now < micro(timing.dueAt)) invalid();
  return reminderTiming({ ...input, deliveredCount: timing.ordinal, lastDeliveredAt: observedAt });
}
export function reminderUtcWindow(observedAt: string): Readonly<{ fromAt: string; toAt: string }> {
  const now = micro(observedAt); let hour = now / HOUR; if (now % HOUR < ZERO) hour--;
  return freeze({ fromAt: stamp(hour * HOUR), toAt: stamp((hour + ONE) * HOUR) });
}
/** A full immutable summary does not consume another plan occurrence. A defer
 * event/head may point to this next window; it must not masquerade as delivery. */
export function reminderDeferredUntil(raw: unknown, observedAt: string): string {
  const timing = reminderTiming(raw), now = micro(observedAt); if (timing.state !== "scheduled" || now < micro(timing.dueAt)) invalid();
  return reminderUtcWindow(observedAt).toAt;
}
