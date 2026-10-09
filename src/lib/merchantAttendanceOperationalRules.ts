// 239: pure, unapproved input contract only. This module does not publish rules,
// resolve real membership/grants, authorize clocks, calculate dates, or write facts.
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { captureBrowserExact, parseCaptureBrowserJson } from "./merchantAttendanceRuleCapturesBrowser";

export const OPERATIONAL_RULES_PROTOCOL = "attendance-operational-rules-v1" as const;
export const OPERATIONAL_RULES_BYTE_LIMIT = 32768;
export const OPERATIONAL_RULES_NODE_LIMIT = 4096;
export const OPERATIONAL_RULES_DEPTH_LIMIT = 12;
export const OPERATIONAL_RULE_KEYS = Object.freeze(["allowedChannels", "locationScope", "shiftSource", "breakTypes",
  "correctionWindow", "reviewRouting", "timesheetCycle", "reminders"] as const);
export const OPERATIONAL_RULE_CHANNELS = Object.freeze(["self", "location", "pin", "onsite"] as const);
export const OPERATIONAL_RULE_REVIEW_CATEGORIES = Object.freeze(["correction", "missing", "leave", "work_arrangement"] as const);
export const OPERATIONAL_RULE_REMINDER_KINDS = Object.freeze(["open_session", "pending_review", "period_due"] as const);
export type OperationalRuleKey = typeof OPERATIONAL_RULE_KEYS[number];
export type OperationalRuleLayer = "enterprise" | "group" | "personal";
export type OperationalRuleChannel = typeof OPERATIONAL_RULE_CHANNELS[number];
export type OperationalReviewTarget = "owner" | Readonly<{ delegateEmployeeId: string; delegateAuthUserId: string }>;
export type OperationalTimesheetCycle = Readonly<
  { kind: "weekly"; weekStartsOn: number } | { kind: "fortnightly"; anchorDate: string } | { kind: "monthly" | "manual" }>;
export type OperationalReminder = Readonly<{ mode: "disabled" } | {
  mode: "enabled"; afterMinutes: number; repeatMinutes: number; maxOccurrences: number }>;
export type OperationalRuleValues = {
  allowedChannels: readonly OperationalRuleChannel[];
  locationScope: readonly string[];
  shiftSource: "published_selection" | "unplanned";
  breakTypes: Readonly<{ allowed: readonly ("paid" | "unpaid")[]; selection: "fixed" | "explicit" }>;
  correctionWindow: Readonly<{ days: number }>;
  reviewRouting: Readonly<Record<typeof OPERATIONAL_RULE_REVIEW_CATEGORIES[number], OperationalReviewTarget>>;
  timesheetCycle: OperationalTimesheetCycle;
  reminders: Readonly<Record<typeof OPERATIONAL_RULE_REMINDER_KINDS[number], OperationalReminder>>;
};
export type OperationalRuleChoice<T> = Readonly<{ mode: "inherit" } | { mode: "disabled" } | { mode: "value"; value: T }>;
export type OperationalRules = Readonly<{ [K in OperationalRuleKey]: OperationalRuleChoice<OperationalRuleValues[K]> }>;
export type OperationalRuleTrace<T> = Readonly<{ layer: OperationalRuleLayer; choice: OperationalRuleChoice<T> }>;
export type OperationalRuleField<T> = Readonly<{
  state: "unconfigured" | "disabled" | "value";
  value: T | null;
  // Input-layer labels only: not verified publication, employee or grant provenance.
  sources: readonly OperationalRuleLayer[];
  trace: readonly OperationalRuleTrace<T>[];
}>;
export type OperationalCorrectionWindowField = OperationalRuleField<OperationalRuleValues["correctionWindow"]> & Readonly<{
  baselineDays: number | null; constrainedDays: number | null; baselineMissing: boolean;
}>;
export type OperationalRulesPreview = Readonly<{
  protocol: "attendance-operational-rules-preview-v1";
  candidateOnly: true; applied: false; authorityChecked: false;
  providedLayers: readonly OperationalRuleLayer[];
  fields: Readonly<{ [K in Exclude<OperationalRuleKey, "correctionWindow">]: OperationalRuleField<OperationalRuleValues[K]> }
    & { correctionWindow: OperationalCorrectionWindowField }>;
}>;
export type OperationalRulesPreviewInput = Readonly<{
  enterprise: OperationalRules; group: OperationalRules | null; personal: OperationalRules | null;
  baselineCorrectionWindowDays: number | null;
}>;

const fail = (): never => { throw new MerchantAttendanceError("attendance_operational_rules_invalid"); };
const integer = (v: unknown, min: number, max: number): number => typeof v === "number" && Number.isSafeInteger(v)
  && !Object.is(v, -0) && v >= min && v <= max ? v : fail();
const uuid = (v: unknown): string => typeof v === "string" && v.length === 36 && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v) ? v : fail();
const exact = captureBrowserExact;
function freeze<T>(v: T): T {
  if (v && typeof v === "object") { Object.values(v).forEach(freeze); Object.freeze(v); }
  return v;
}
function wellFormed(v: string) {
  for (let i = 0; i < v.length; i++) {
    const c = v.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) { const next = v.charCodeAt(++i); if (!(next >= 0xdc00 && next <= 0xdfff)) fail(); }
    else if (c >= 0xdc00 && c <= 0xdfff) fail();
  }
}
// Validate descriptors BEFORE inspecting values or serializing; no getter/toJSON
// execution, sparse/custom arrays, prototype keys, cycles or hidden properties.
function validateTree(raw: unknown) {
  let nodes = 0; const ancestors = new Set<object>();
  const walk = (v: unknown, depth: number): void => {
    if (++nodes > OPERATIONAL_RULES_NODE_LIMIT || depth > OPERATIONAL_RULES_DEPTH_LIMIT) fail();
    if (v === null || typeof v === "boolean") return;
    if (typeof v === "string") { if (v.length > OPERATIONAL_RULES_BYTE_LIMIT) fail(); wellFormed(v); return; }
    if (typeof v === "number") { if (!Number.isSafeInteger(v) || Object.is(v, -0)) fail(); return; }
    if (!v || typeof v !== "object" || ancestors.has(v)) return fail();
    ancestors.add(v);
    const proto = Object.getPrototypeOf(v), descriptors = Object.getOwnPropertyDescriptors(v), keys = Reflect.ownKeys(v);
    if (Array.isArray(v)) {
      if (proto !== Array.prototype || v.length > 25 || keys.length !== v.length + 1) fail();
      for (let i = 0; i < v.length; i++) {
        const d = descriptors[String(i)]; if (!d || !("value" in d) || !d.enumerable) fail(); walk(d.value, depth + 1);
      }
    } else {
      if (proto !== null && proto !== Object.prototype) fail();
      for (const key of keys) {
        if (typeof key !== "string" || key.length > OPERATIONAL_RULES_BYTE_LIMIT || ["__proto__", "prototype", "constructor"].includes(key)) return fail();
        wellFormed(key); const d = descriptors[key]; if (!("value" in d) || !d.enumerable) fail(); walk(d.value, depth + 1);
      }
    }
    ancestors.delete(v);
  };
  walk(raw, 0);
  if (new TextEncoder().encode(JSON.stringify(raw)).byteLength > OPERATIONAL_RULES_BYTE_LIMIT) fail();
}
function orderedSubset<T extends string>(v: unknown, order: readonly T[]): T[] {
  if (!Array.isArray(v) || !v.length || v.length > order.length) return fail();
  let previous = -1;
  return v.map(x => {
    const position = order.indexOf(x as T); if (position <= previous) fail(); previous = position; return order[position];
  });
}
function locations(raw: unknown): string[] {
  if (!Array.isArray(raw) || !raw.length || raw.length > 25) return fail();
  let previous = "";
  return raw.map(v => { const parsed = uuid(v); if (parsed <= previous) fail(); previous = parsed; return parsed; });
}
function cycle(raw: unknown): OperationalTimesheetCycle {
  const kind = Object.getOwnPropertyDescriptor(raw, "kind")?.value;
  if (kind === "weekly") { const v = exact(raw, ["kind", "weekStartsOn"]); return { kind, weekStartsOn: integer(v.weekStartsOn, 1, 7) }; }
  if (kind === "fortnightly") {
    const v = exact(raw, ["kind", "anchorDate"]), date = v.anchorDate;
    if (typeof date !== "string" || date.length !== 10 || !/^\d{4}-\d{2}-\d{2}$/.test(date) || date.startsWith("0000")) return fail();
    const parsed = Date.parse(date + "T00:00:00.000Z");
    if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== date) fail();
    return { kind, anchorDate: date };
  }
  if (kind !== "monthly" && kind !== "manual") return fail(); exact(raw, ["kind"]); return { kind };
}
function routing(raw: unknown): OperationalRuleValues["reviewRouting"] {
  const v = exact(raw, OPERATIONAL_RULE_REVIEW_CATEGORIES);
  return Object.fromEntries(OPERATIONAL_RULE_REVIEW_CATEGORIES.map(key => {
    if (v[key] === "owner") return [key, "owner"];
    const target = exact(v[key], ["delegateEmployeeId", "delegateAuthUserId"]);
    return [key, { delegateEmployeeId: uuid(target.delegateEmployeeId), delegateAuthUserId: uuid(target.delegateAuthUserId) }];
  })) as OperationalRuleValues["reviewRouting"];
}
function reminders(raw: unknown): OperationalRuleValues["reminders"] {
  const v = exact(raw, OPERATIONAL_RULE_REMINDER_KINDS);
  return Object.fromEntries(OPERATIONAL_RULE_REMINDER_KINDS.map(key => {
    const raw = v[key], mode = Object.getOwnPropertyDescriptor(raw, "mode")?.value;
    if (mode === "disabled") { exact(raw, ["mode"]); return [key, { mode }]; }
    if (mode !== "enabled") return fail();
    const item = exact(raw, ["mode", "afterMinutes", "repeatMinutes", "maxOccurrences"]);
    return [key, { mode, afterMinutes: integer(item.afterMinutes, 1, 44640), repeatMinutes: integer(item.repeatMinutes, 60, 44640),
      maxOccurrences: integer(item.maxOccurrences, 1, 10) }];
  })) as OperationalRuleValues["reminders"];
}
const parsers: { [K in OperationalRuleKey]: (v: unknown) => OperationalRuleValues[K] } = {
  allowedChannels: v => orderedSubset(v, OPERATIONAL_RULE_CHANNELS), locationScope: locations,
  shiftSource: v => v === "published_selection" || v === "unplanned" ? v : fail(),
  breakTypes: raw => { const v = exact(raw, ["allowed", "selection"]), allowed = orderedSubset(v.allowed, ["paid", "unpaid"] as const);
    if (v.selection !== "fixed" && v.selection !== "explicit" || v.selection === "fixed" && allowed.length !== 1) return fail();
    return { allowed, selection: v.selection as "fixed" | "explicit" }; },
  correctionWindow: raw => { const v = exact(raw, ["days"]); return { days: integer(v.days, 0, 365) }; },
  reviewRouting: routing, timesheetCycle: cycle, reminders,
};
function choice<K extends OperationalRuleKey>(raw: unknown, key: K): OperationalRuleChoice<OperationalRuleValues[K]> {
  const mode = Object.getOwnPropertyDescriptor(raw, "mode")?.value;
  if (mode === "inherit" || mode === "disabled") { exact(raw, ["mode"]); return { mode }; }
  if (mode !== "value") return fail(); const v = exact(raw, ["mode", "value"]);
  return { mode, value: parsers[key](v.value) };
}
function document(raw: unknown): OperationalRules {
  const v = exact(raw, OPERATIONAL_RULE_KEYS);
  return Object.fromEntries(OPERATIONAL_RULE_KEYS.map(key => [key, choice(v[key], key)])) as OperationalRules;
}
export function parseOperationalRules(raw: unknown): OperationalRules {
  try { validateTree(raw); return freeze(document(raw)); } catch { return fail(); }
}
export function parseOperationalRulesJson(text: string): OperationalRules {
  try {
    if (typeof text !== "string" || text.length > OPERATIONAL_RULES_BYTE_LIMIT) return fail();
    wellFormed(text); if (new TextEncoder().encode(text).byteLength > OPERATIONAL_RULES_BYTE_LIMIT) fail();
    // The shared pure decoder rejects duplicate keys, including escaped names.
    return parseOperationalRules(parseCaptureBrowserJson(text));
  } catch { return fail(); }
}

type LayerDocument = Readonly<{ layer: OperationalRuleLayer; rules: OperationalRules }>;
function resolveField<K extends OperationalRuleKey>(layers: readonly LayerDocument[], key: K): OperationalRuleField<OperationalRuleValues[K]> {
  const trace = layers.map(({ layer, rules }) => ({ layer, choice: rules[key] }));
  const selected = trace.find(item => item.choice.mode !== "inherit");
  return { state: selected?.choice.mode ?? "unconfigured", value: selected?.choice.mode === "value" ? selected.choice.value : null,
    sources: selected ? [selected.layer] : [], trace } as OperationalRuleField<OperationalRuleValues[K]>;
}
/** Resolve ONLY the supplied unapproved input layers. Null means not supplied,
 * never proof that an actual group/personal publication is absent. No same-site
 * location, current role, grant, deadline, publication or authority is verified. */
export function resolveOperationalRules(raw: unknown): OperationalRulesPreview {
  try {
    validateTree(raw); const v = exact(raw, ["enterprise", "group", "personal", "baselineCorrectionWindowDays"]);
    const enterprise = document(v.enterprise), group = v.group === null ? null : document(v.group), personal = v.personal === null ? null : document(v.personal);
    const baselineDays = v.baselineCorrectionWindowDays === null ? null : integer(v.baselineCorrectionWindowDays, 0, 365);
    const layers: LayerDocument[] = [];
    if (personal) layers.push({ layer: "personal", rules: personal }); if (group) layers.push({ layer: "group", rules: group });
    layers.push({ layer: "enterprise", rules: enterprise });
    const locationField = resolveField(layers, "locationScope");
    const restrictions = locationField.trace.filter((item): item is OperationalRuleTrace<readonly string[]> & { choice: { mode: "value"; value: readonly string[] } } => item.choice.mode === "value");
    // Disabled/inherit do not cancel another supplied layer's restrictions.
    const locationScope = restrictions.length ? { ...locationField, state: "value" as const,
      value: restrictions[0].choice.value.filter(id => restrictions.every(item => item.choice.value.includes(id))),
      sources: restrictions.map(item => item.layer) } : locationField;
    const window = resolveField(layers, "correctionWindow");
    const correctionWindow: OperationalCorrectionWindowField = { ...window, baselineDays, baselineMissing: baselineDays === null,
      constrainedDays: baselineDays === null ? null : window.value === null ? baselineDays : Math.min(baselineDays, window.value.days) };
    return freeze({ protocol: "attendance-operational-rules-preview-v1", candidateOnly: true, applied: false, authorityChecked: false,
      providedLayers: layers.map(item => item.layer), fields: {
        allowedChannels: resolveField(layers, "allowedChannels"), locationScope, shiftSource: resolveField(layers, "shiftSource"),
        breakTypes: resolveField(layers, "breakTypes"), correctionWindow, reviewRouting: resolveField(layers, "reviewRouting"),
        timesheetCycle: resolveField(layers, "timesheetCycle"), reminders: resolveField(layers, "reminders"),
      } });
  } catch { return fail(); }
}
