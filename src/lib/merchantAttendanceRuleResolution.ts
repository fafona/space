import { RULE_KEYS, type AttendanceRuleKey, type AttendanceRuleDraft } from "./merchantAttendanceRuleDraft";
import { parseRulesItem, type RulesItem } from "./merchantAttendanceRules";
import type { SourcesAssignment, SourcesResult } from "./merchantAttendanceSources";
import { attendanceDayUtcRange, attendanceInstant, MerchantAttendanceError } from "./merchantAttendanceTime";

export const CANDIDATE_RULE_MAX_SEGMENTS = 301;
export type CandidateRuleLayer = "enterprise" | "group";
export type CandidateRuleProvenance = Readonly<{
  layer: CandidateRuleLayer; groupId: string | null; ledgerRevision: number; publishRevision: number;
  operationId: string; actorId: string; settingsVersion: number; groupRevision: number | null;
  timeZone: string; effectiveAt: string; recordedAt: string;
}>;
export type CandidateRuleTrace = Readonly<{
  layer: CandidateRuleLayer; groupId: string | null; mode: "missing_publication" | "inherit" | "disabled" | "value";
  minutes: number | null; source: CandidateRuleProvenance | null;
}>;
export type CandidateRuleField = Readonly<{
  state: "value" | "disabled" | "unconfigured" | "blocked"; minutes: number | null;
  source: CandidateRuleProvenance | null; trace: readonly CandidateRuleTrace[];
}>;
export type CandidateRuleSegment = Readonly<{
  fromAt: string; toAt: string; status: "candidate" | "blocked";
  assignmentId?: string; assignmentRevision?: number; groupId?: string;
  blockers: readonly string[]; fields: Readonly<Record<AttendanceRuleKey, CandidateRuleField>>;
}>;
export type CandidateAttendanceRuleResolution = Readonly<{
  protocol: "candidate-rule-resolution-v1"; siteId: string; workerId: string; actorId: string;
  fromDate: string; throughDate: string; timeZone: string; readAt: string;
  formalReady: false; applied: false; limitations: readonly string[]; segments: readonly CandidateRuleSegment[];
}>;
type Publication = RulesItem & { action: "publish"; rules: AttendanceRuleDraft; settingsVersion: number; timeZone: string; effectiveAt: string };
type Stream = { groupId: string | null; revision: number; publications: Publication[] };

function invalid(): never { throw new MerchantAttendanceError("attendance_rule_resolution_invalid"); }
function tooLarge(): never { throw new MerchantAttendanceError("attendance_rule_resolution_too_large"); }
const integer = (value: number, minimum = 0) => Number.isSafeInteger(value) && !Object.is(value, -0) && value >= minimum && value <= 9007199254740990;
const overlaps = (a: SourcesAssignment, fromAt: string, toAt: string) => a.fromAt < toAt && (a.toAt === null || a.toAt > fromAt);

function checkedStreams(source: SourcesResult): Map<string | null, Stream> {
  const streams = new Map<string | null, Stream>();
  const operations = new Set<string>(); let publications = 0;
  for (const raw of source.rules.items) {
    if (!raw || !integer(raw.revision) || !Array.isArray(raw.publications) || streams.has(raw.groupId)) invalid();
    if ((publications += raw.publications.length) > 100) tooLarge();
    let prior: Publication | null = null;
    const parsed = raw.publications.map(item => {
      let p: RulesItem;
      try { p = parseRulesItem(item, raw.groupId); } catch { return invalid(); }
      if (p.action !== "publish" || p.rules === null || p.settingsVersion === null || p.timeZone === null || p.effectiveAt === null
        || p.revision > raw.revision || p.recordedAt > source.readAt || p.effectiveAt >= source.toAt || operations.has(p.operationId)
        || prior !== null && (p.revision <= prior.revision || p.effectiveAt <= prior.effectiveAt)) invalid();
      operations.add(p.operationId); prior = p as Publication; return p as Publication;
    });
    if (parsed.filter(p => p.effectiveAt <= source.fromAt).length > 1) invalid();
    streams.set(raw.groupId, { groupId: raw.groupId, revision: raw.revision, publications: parsed });
  }
  return streams;
}

function provenance(stream: Stream, item: Publication): CandidateRuleProvenance {
  return Object.freeze({ layer: stream.groupId === null ? "enterprise" : "group", groupId: stream.groupId,
    ledgerRevision: stream.revision, publishRevision: item.revision, operationId: item.operationId, actorId: item.actorId,
    settingsVersion: item.settingsVersion, groupRevision: item.groupRevision, timeZone: item.timeZone,
    effectiveAt: item.effectiveAt, recordedAt: item.recordedAt });
}
function latest(stream: Stream, at: string): Publication | null {
  let selected: Publication | null = null;
  for (const publication of stream.publications) { if (publication.effectiveAt > at) break; selected = publication; }
  return selected;
}
function blockedFields(): Readonly<Record<AttendanceRuleKey, CandidateRuleField>> {
  const fields = {} as Record<AttendanceRuleKey, CandidateRuleField>;
  for (const key of RULE_KEYS) fields[key] = Object.freeze({ state: "blocked", minutes: null, source: null, trace: Object.freeze([]) });
  return Object.freeze(fields);
}
function candidateFields(streams: Stream[], fromAt: string): Readonly<Record<AttendanceRuleKey, CandidateRuleField>> {
  const selected = streams.map(stream => {
    const publication = latest(stream, fromAt);
    return { stream, publication, source: publication === null ? null : provenance(stream, publication) };
  });
  return Object.freeze(Object.fromEntries(RULE_KEYS.map(key => {
    const trace: CandidateRuleTrace[] = selected.map(({ stream, publication, source }) => {
      const choice = publication?.rules[key];
      return Object.freeze({ layer: stream.groupId === null ? "enterprise" : "group", groupId: stream.groupId,
        mode: choice?.mode ?? "missing_publication", minutes: choice?.mode === "value" ? choice.minutes : null, source });
    });
    const chosen = trace.find(t => t.mode === "value" || t.mode === "disabled");
    return [key, Object.freeze({ state: chosen?.mode ?? "unconfigured", minutes: chosen?.mode === "value" ? chosen.minutes : null,
      source: chosen?.source ?? null, trace: Object.freeze(trace) })];
  })) as Record<AttendanceRuleKey, CandidateRuleField>);
}

/**
 * Resolve an already parsed, normalized SourcesResult for candidate display only.
 * This is NOT an authorization/wire-validation boundary, a personal-exception
 * resolver, a historical policy snapshot, or an attendance/payroll assessment.
 * The caller must obtain SourcesResult through the existing sources parser.
 * Focused invariant guards below detect internal misuse; they do not establish
 * completeness or current authority independently of that source reader.
 */
export function resolveCandidateAttendanceRules(source: SourcesResult): CandidateAttendanceRuleResolution {
  if (!source || source.protocol !== "sources-v1" || !source.worker || typeof source.worker.active !== "boolean"
    || !source.assignments || !source.rules || !Array.isArray(source.assignments.items) || !Array.isArray(source.rules.items)
    || !Array.isArray(source.warnings) || typeof source.assignments.limited !== "boolean" || typeof source.rules.limited !== "boolean") invalid();
  if (source.assignments.items.length > 100 || source.rules.items.length > 100) tooLarge();
  try {
    attendanceInstant(source.fromAt); attendanceInstant(source.toAt);
    if (source.fromAt >= source.toAt || source.fromAt !== attendanceDayUtcRange(source.fromDate, source.timeZone).startAt
      || source.toAt !== attendanceDayUtcRange(source.throughDate, source.timeZone).endAt) invalid();
  } catch { return invalid(); }
  if (source.assignments.limited && source.assignments.items.length || source.rules.limited && source.rules.items.length) invalid();
  const limitations = ["personal_exceptions_not_supported", "historical_context_not_pinned", "candidate_rules_not_applied"];
  for (const name of ["schedule", "leave", "calendar"] as const) {
    if (source[name]?.limited || source.warnings.includes(`${name}_truncated`)) limitations.push(`${name}_truncated`);
  }
  const globalBlockers: string[] = [];
  if (source.assignments.limited) globalBlockers.push("assignments_truncated");
  if (source.rules.limited) globalBlockers.push("rules_truncated");
  if (source.warnings.includes("identity_changed")) globalBlockers.push("identity_changed");
  if (!source.worker.active) globalBlockers.push("inactive_worker");
  const finish = (segments: CandidateRuleSegment[]): CandidateAttendanceRuleResolution => Object.freeze({
    protocol: "candidate-rule-resolution-v1", siteId: source.siteId, workerId: source.worker.workerId, actorId: source.actorId,
    fromDate: source.fromDate, throughDate: source.throughDate, timeZone: source.timeZone, readAt: source.readAt,
    formalReady: false, applied: false, limitations: Object.freeze([...limitations]), segments: Object.freeze(segments),
  });
  if (globalBlockers.length) return finish([Object.freeze({ fromAt: source.fromAt, toAt: source.toAt, status: "blocked",
    blockers: Object.freeze(globalBlockers), fields: blockedFields() })]);

  const streams = checkedStreams(source), ids = new Set<string>(), groups = new Map<string, string>();
  const live: SourcesAssignment[] = [];
  for (const assignment of source.assignments.items) {
    if (!assignment || !assignment.detail || !assignment.currentGroup || ids.has(assignment.detail.assignmentId)
      || assignment.detail.workerId !== source.worker.workerId || assignment.detail.groupId !== assignment.currentGroup.groupId
      || !integer(assignment.detail.revision, 1) || assignment.detail.revision > 3
      || !["assigned", "ended", "cancelled"].includes(assignment.detail.status) || typeof assignment.currentGroup.active !== "boolean") invalid();
    try { attendanceInstant(assignment.fromAt); if (assignment.toAt !== null) attendanceInstant(assignment.toAt); } catch { return invalid(); }
    if (assignment.toAt !== null && assignment.toAt <= assignment.fromAt) invalid();
    const group = JSON.stringify(assignment.currentGroup), previousGroup = groups.get(assignment.detail.groupId);
    if (previousGroup !== undefined && previousGroup !== group) invalid();
    ids.add(assignment.detail.assignmentId); groups.set(assignment.detail.groupId, group);
    if (assignment.detail.status !== "cancelled" && overlaps(assignment, source.fromAt, source.toAt)) live.push(assignment);
  }
  const relevantGroups = new Set(live.map(a => a.detail.groupId));
  const boundaries = new Set([source.fromAt, source.toAt]);
  const addBoundary = (at: string | null) => { if (at !== null && at > source.fromAt && at < source.toAt) boundaries.add(at); };
  for (const assignment of live) { addBoundary(assignment.fromAt); addBoundary(assignment.toAt); }
  for (const stream of streams.values()) if (stream.groupId === null || relevantGroups.has(stream.groupId)) {
    for (const publication of stream.publications) addBoundary(publication.effectiveAt);
  }
  const points = [...boundaries].sort();
  // At most 100*2 assignment boundaries + 100 publication boundaries + 1.
  // Keep an explicit result guard even if upstream collection limits change.
  if (points.length - 1 > CANDIDATE_RULE_MAX_SEGMENTS) tooLarge();
  const segments: CandidateRuleSegment[] = [];
  for (let n = 0; n < points.length - 1; n++) {
    const fromAt = points[n], toAt = points[n + 1], active = live.filter(a => overlaps(a, fromAt, toAt));
    const blockers: string[] = [], enterprise = streams.get(null), assignment = active.length === 1 ? active[0] : null;
    if (active.length > 1) blockers.push("assignment_overlap");
    if (!enterprise) blockers.push("missing_rule_stream");
    const group = assignment === null ? null : streams.get(assignment.detail.groupId);
    if (assignment && !assignment.currentGroup.active) blockers.push("inactive_group");
    if (assignment && !group && !blockers.includes("missing_rule_stream")) blockers.push("missing_rule_stream");
    const fields = blockers.length ? blockedFields() : candidateFields(group ? [group, enterprise!] : [enterprise!], fromAt);
    segments.push(Object.freeze({ fromAt, toAt, status: blockers.length ? "blocked" : "candidate",
      ...(assignment ? { assignmentId: assignment.detail.assignmentId, assignmentRevision: assignment.detail.revision, groupId: assignment.detail.groupId } : {}),
      blockers: Object.freeze(blockers), fields }));
  }
  return finish(segments);
}
