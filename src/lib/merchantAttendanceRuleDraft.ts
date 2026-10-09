import { attendanceDayUtcRange, attendanceInstant, attendanceLocalDate, attendanceTimeZone, MerchantAttendanceError } from "./merchantAttendanceTime";

// Hypothetical drafts only. This module cannot authorize, publish, fetch facts,
// select a real group or change an attendance record / calculation.
export const RULE_KEYS = Object.freeze(["lateGraceMinutes", "earlyGraceMinutes", "openSpanWarningMinutes", "completedBreakMinimumMinutes"] as const);
export type AttendanceRuleKey = typeof RULE_KEYS[number];
export type AttendanceRuleSource = "enterprise" | "group" | "personal";
export type AttendanceRuleChoice = { mode: "inherit" } | { mode: "disabled" } | { mode: "value"; minutes: number };
export type AttendanceRuleDraft = Record<AttendanceRuleKey, AttendanceRuleChoice>;

// Bounds are technical input limits, NOT statutory or recommended thresholds.
export const RULE_DEFINITIONS = Object.freeze({
  lateGraceMinutes: Object.freeze({ label: "迟到宽限", min: 0, max: 1440 }),
  earlyGraceMinutes: Object.freeze({ label: "早退宽限", min: 0, max: 1440 }),
  openSpanWarningMinutes: Object.freeze({ label: "未结束班次提醒阈值（非工时）", min: 1, max: 44640 }),
  completedBreakMinimumMinutes: Object.freeze({ label: "单段已结束休息参考下限", min: 1, max: 1440 }),
});

export type AttendanceRuleDraftField = Readonly<{
  state: "unconfigured" | "disabled" | "value";
  minutes: number | null;
  source: AttendanceRuleSource | null;
  trace: ReadonlyArray<Readonly<{ source: AttendanceRuleSource; mode: AttendanceRuleChoice["mode"] }>>;
}>;

export type AttendanceRuleDraftPreview = Readonly<{
  protocol: "rule-draft-preview-v1";
  timeZone: string;
  effectiveOn: string;
  effectiveAt: string;
  checkedAt: string;
  fields: Readonly<Record<AttendanceRuleKey, AttendanceRuleDraftField>>;
}>;

function fail(code: string): never { throw new MerchantAttendanceError(code); }

// Also reject accessors and inherited/custom records. The public entry point
// accepts unknown: TypeScript types alone must not turn a bad draft into zero.
function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail("attendance_rule_draft_invalid_structure");
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== null && prototype !== Object.prototype) return fail("attendance_rule_draft_invalid_structure");
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== keys.length || ownKeys.some(key => typeof key !== "string" || !keys.includes(key))) {
    return fail("attendance_rule_draft_invalid_structure");
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (keys.some(key => !descriptors[key] || !("value" in descriptors[key]))) return fail("attendance_rule_draft_invalid_structure");
  return value as Record<string, unknown>;
}

function choice(value: unknown, key: AttendanceRuleKey): AttendanceRuleChoice {
  // Inspect a data descriptor before inspecting mode to avoid executing getters.
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail("attendance_rule_draft_invalid_choice");
  const descriptor = Object.getOwnPropertyDescriptor(value, "mode");
  const mode: unknown = descriptor && "value" in descriptor ? descriptor.value : undefined;
  if (mode === "inherit" || mode === "disabled") {
    exactRecord(value, ["mode"]);
    return { mode };
  }
  if (mode !== "value") return fail("attendance_rule_draft_invalid_choice");
  const raw = exactRecord(value, ["mode", "minutes"]);
  const minutes = raw.minutes, definition = RULE_DEFINITIONS[key];
  if (typeof minutes !== "number" || !Number.isSafeInteger(minutes) || Object.is(minutes, -0)
      || minutes < definition.min || minutes > definition.max) return fail("attendance_rule_draft_invalid_minutes");
  return { mode, minutes };
}

function parseDraft(value: unknown): AttendanceRuleDraft {
  const raw = exactRecord(value, RULE_KEYS);
  return Object.fromEntries(RULE_KEYS.map(key => [key, choice(raw[key], key)])) as AttendanceRuleDraft;
}

// Shared strict shape validation for the separate candidate-version ledger.
export { parseDraft as parseAttendanceRuleDraft };

export function emptyAttendanceRuleDraft(): AttendanceRuleDraft {
  // A fresh choice for every cell; no implicit legal/company defaults or aliasing.
  return Object.fromEntries(RULE_KEYS.map(key => [key, { mode: "inherit" }])) as AttendanceRuleDraft;
}

/**
 * Resolve one proposed draft, field by field: personal > group > enterprise.
 * 'disabled' is an explicit decision and must not fall back to the lower tier.
 * All-inherit is unconfigured, not disabled, and never an implicit zero.
 * This is not a resolver for effective published policies or historical groups.
 */
export function previewAttendanceRuleDraft(value: unknown): AttendanceRuleDraftPreview {
  const raw = exactRecord(value, ["timeZone", "now", "effectiveOn", "enterprise", "group", "personal"]);
  if (typeof raw.now !== "string" || typeof raw.timeZone !== "string" || typeof raw.effectiveOn !== "string") {
    return fail("attendance_rule_draft_invalid_structure");
  }
  const now = attendanceInstant(raw.now), timeZone = attendanceTimeZone(raw.timeZone);
  const today = attendanceLocalDate(raw.now, timeZone);
  // Validate both dates against the operational horizon and skipped local days.
  attendanceDayUtcRange(today, timeZone);
  const range = attendanceDayUtcRange(raw.effectiveOn, timeZone);
  if (raw.effectiveOn <= today || attendanceInstant(range.startAt) <= now) return fail("attendance_rule_draft_future_date_required");

  const drafts = { enterprise: parseDraft(raw.enterprise), group: parseDraft(raw.group), personal: parseDraft(raw.personal) };
  const priority = ["personal", "group", "enterprise"] as const;
  const fields = {} as Record<AttendanceRuleKey, AttendanceRuleDraftField>;
  for (const key of RULE_KEYS) {
    const trace: Array<Readonly<{ source: AttendanceRuleSource; mode: AttendanceRuleChoice["mode"] }>> = [];
    let state: AttendanceRuleDraftField["state"] = "unconfigured";
    let minutes: number | null = null, source: AttendanceRuleSource | null = null;
    for (const tier of priority) {
      const current = drafts[tier][key];
      trace.push(Object.freeze({ source: tier, mode: current.mode }));
      if (current.mode === "inherit") continue;
      source = tier;
      state = current.mode;
      if (current.mode === "value") minutes = current.minutes;
      break;
    }
    fields[key] = Object.freeze({ state, minutes, source, trace: Object.freeze(trace) });
  }
  return Object.freeze({ protocol: "rule-draft-preview-v1", timeZone, effectiveOn: raw.effectiveOn,
    effectiveAt: range.startAt, checkedAt: raw.now, fields: Object.freeze(fields) });
}
