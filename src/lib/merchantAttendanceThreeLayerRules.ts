import { RULE_KEYS, type AttendanceRuleKey, type AttendanceRuleDraft } from "./merchantAttendanceRuleDraft";
import { parseRulesItem, type RulesItem } from "./merchantAttendanceRules";
import { parsePersonalRulesItem, type PersonalRulesItem } from "./merchantAttendancePersonalRules";
import type { RuleSourcesResult } from "./merchantAttendanceRuleSources";
import type { SourcesAssignment } from "./merchantAttendanceSources";
import { attendanceRecordInstant } from "./merchantAttendanceManagement";
import { attendanceDayUtcRange, attendanceInstant, MerchantAttendanceError } from "./merchantAttendanceTime";

export const THREE_LAYER_RULE_MAX_SEGMENTS = 501;
export type ThreeLayerPublicationProvenance = Readonly<{
  layer: "enterprise" | "group"; groupId: string | null; ledgerRevision: number; publishRevision: number;
  operationId: string; actorId: string; settingsVersion: number; groupRevision: number | null;
  timeZone: string; effectiveOn: string; effectiveAt: string; recordedAt: string;
}>;
export type ThreeLayerPersonalProvenance = Readonly<{
  layer: "personal"; groupId: null; ledgerRevision: number; approvalRevision: number; employeeId: string; employeeAuthUserId: string;
  workerVersion: number; settingsVersion: number; operationId: string; actorId: string; timeZone: string;
  startsOn: string; endsOn: string; fromAt: string; toAt: string; recordedAt: string;
}>;
export type ThreeLayerRuleProvenance = ThreeLayerPublicationProvenance | ThreeLayerPersonalProvenance;
export type ThreeLayerRuleTrace = Readonly<{
  layer: "personal" | "group" | "enterprise"; groupId: string | null; ledgerRevision: number | null;
  mode: "missing_approval" | "no_assignment" | "missing_publication" | "inherit" | "disabled" | "value";
  minutes: number | null; source: ThreeLayerRuleProvenance | null;
}>;
export type ThreeLayerRuleField = Readonly<{
  state: "value" | "disabled" | "unconfigured" | "blocked"; minutes: number | null;
  source: ThreeLayerRuleProvenance | null; trace: readonly ThreeLayerRuleTrace[];
}>;
export type ThreeLayerRuleSegment = Readonly<{
  fromAt: string; toAt: string; status: "candidate" | "blocked"; assignmentId?: string; assignmentRevision?: number; groupId?: string;
  personalApprovalRevision?: number; blockers: readonly string[]; fields: Readonly<Record<AttendanceRuleKey, ThreeLayerRuleField>>;
}>;
export type CandidateThreeLayerRulesResolution = Readonly<{
  protocol: "candidate-three-layer-rules-v1"; siteId: string; workerId: string; actorId: string;
  employeeId: string | null; employeeAuthUserId: string | null; personalRevision: number;
  fromDate: string; throughDate: string; fromAt: string; toAt: string; timeZone: string; readAt: string;
  formalReady: false; applied: false; limitations: readonly string[]; segments: readonly ThreeLayerRuleSegment[];
}>;

type Publication = RulesItem & { action: "publish"; rules: AttendanceRuleDraft; settingsVersion: number; timeZone: string; effectiveOn: string; effectiveAt: string };
type Stream = { groupId: string | null; revision: number; publications: Publication[] };
type Approval = Extract<PersonalRulesItem, { action: "approve" }>;
const invalid = (): never => { throw new MerchantAttendanceError("attendance_three_layer_rules_invalid"); };
const tooLarge = (): never => { throw new MerchantAttendanceError("attendance_three_layer_rules_too_large"); };
const integer = (n: number, minimum = 0) => Number.isSafeInteger(n) && !Object.is(n, -0) && n >= minimum && n <= 9007199254740990;
const overlaps = (start: string, end: string | null, from: string, to: string) => start < to && (end === null || end > from);
const snapshotKeys = ["employeeId", "employeeAuthUserId", "workerVersion", "settingsVersion", "timeZone", "startsOn", "endsOn", "fromAt", "toAt", "rules"] as const;

function assignments(source: RuleSourcesResult) {
  const ids = new Set<string>(), groups = new Map<string, SourcesAssignment["currentGroup"]>(), live: SourcesAssignment[] = [];
  for (const a of source.assignments.items) {
    if (!a || !a.detail || !a.currentGroup || ids.has(a.detail.assignmentId) || a.detail.workerId !== source.worker.workerId
      || a.detail.groupId !== a.currentGroup.groupId || !integer(a.detail.revision, 1) || a.detail.revision > 3
      || !["assigned", "ended", "cancelled"].includes(a.detail.status) || typeof a.currentGroup.active !== "boolean") invalid();
    try {
      attendanceInstant(a.fromAt); if (a.toAt !== null) attendanceInstant(a.toAt);
      if (a.fromAt !== attendanceDayUtcRange(a.detail.startsOn, a.detail.timeZone).startAt
        || a.toAt !== (a.detail.endsOn === null ? null : attendanceDayUtcRange(a.detail.endsOn, a.detail.timeZone).endAt)) invalid();
    } catch { return invalid(); }
    if (a.toAt !== null && a.toAt <= a.fromAt) invalid();
    const previous = groups.get(a.detail.groupId);
    if (previous && JSON.stringify(previous) !== JSON.stringify(a.currentGroup)) invalid();
    ids.add(a.detail.assignmentId); groups.set(a.detail.groupId, a.currentGroup);
    if (a.detail.status !== "cancelled" && overlaps(a.fromAt, a.toAt, source.fromAt, source.toAt)) live.push(a);
  }
  return { groups, live };
}

function streams(source: RuleSourcesResult, groups: Map<string, SourcesAssignment["currentGroup"]>): Map<string | null, Stream> {
  const result = new Map<string | null, Stream>(), operations = new Set<string>(); let total = 0;
  for (const raw of source.rules.items) {
    if (!raw || !integer(raw.revision) || !Array.isArray(raw.publications) || result.has(raw.groupId)
      || raw.groupId !== null && !groups.has(raw.groupId)) invalid();
    if ((total += raw.publications.length) > 100) tooLarge();
    let previous: Publication | null = null;
    const publications = raw.publications.map(item => {
      let p: RulesItem; try { p = parseRulesItem(item, raw.groupId); } catch { return invalid(); }
      if (p.action !== "publish" || p.rules === null || p.settingsVersion === null || p.timeZone === null || p.effectiveAt === null || p.effectiveOn === null
        || p.revision > raw.revision || p.settingsVersion > source.settingsVersion || p.recordedAt > source.readAt || p.effectiveAt >= source.toAt
        || raw.groupId !== null && p.groupRevision! > groups.get(raw.groupId)!.revision || operations.has(p.operationId)
        || previous && (p.revision <= previous.revision || p.effectiveAt <= previous.effectiveAt)) invalid();
      operations.add(p.operationId); previous = p as Publication; return p as Publication;
    });
    if (publications.filter(p => p.effectiveAt <= source.fromAt).length > 1) invalid();
    result.set(raw.groupId, { groupId: raw.groupId, revision: raw.revision, publications });
  }
  return result;
}

function approvals(source: RuleSourcesResult): Approval[] {
  const live: Approval[] = [], revisions = new Set<number>(), operations = new Set<string>(); let previous = 0;
  const check = (item: PersonalRulesItem) => {
    if (item.revision > source.personal.revision || revisions.has(item.revision) || operations.has(item.operationId)
      || item.employeeId !== source.worker.employeeId || item.employeeAuthUserId !== source.worker.employeeAuthUserId
      || item.workerVersion > source.worker.version || item.settingsVersion > source.settingsVersion || item.recordedAt > source.readAt) invalid();
    revisions.add(item.revision); operations.add(item.operationId);
  };
  for (const pair of source.personal.items) {
    if (!pair) invalid();
    let approved: PersonalRulesItem; try { approved = parsePersonalRulesItem(pair.approval); } catch { return invalid(); }
    if (approved.action !== "approve") return invalid();
    if (approved.revision <= previous || !overlaps(approved.fromAt, approved.toAt, source.fromAt, source.toAt)) invalid();
    previous = approved.revision; check(approved);
    if (pair.withdrawal === null) live.push(approved);
    else {
      let withdrawn: PersonalRulesItem; try { withdrawn = parsePersonalRulesItem(pair.withdrawal); } catch { return invalid(); }
      if (withdrawn.action !== "withdraw" || withdrawn.approvedRevision !== approved.revision || withdrawn.recordedAt < approved.recordedAt
        || !snapshotKeys.every(key => JSON.stringify(approved[key]) === JSON.stringify(withdrawn[key]))) invalid();
      check(withdrawn);
    }
  }
  return live;
}

function publicationProvenance(stream: Stream, p: Publication): ThreeLayerPublicationProvenance {
  return Object.freeze({ layer: stream.groupId === null ? "enterprise" : "group", groupId: stream.groupId, ledgerRevision: stream.revision,
    publishRevision: p.revision, operationId: p.operationId, actorId: p.actorId, settingsVersion: p.settingsVersion, groupRevision: p.groupRevision,
    timeZone: p.timeZone, effectiveOn: p.effectiveOn, effectiveAt: p.effectiveAt, recordedAt: p.recordedAt });
}
function personalProvenance(revision: number, p: Approval): ThreeLayerPersonalProvenance {
  return Object.freeze({ layer: "personal", groupId: null, ledgerRevision: revision, approvalRevision: p.revision,
    employeeId: p.employeeId, employeeAuthUserId: p.employeeAuthUserId, workerVersion: p.workerVersion, settingsVersion: p.settingsVersion,
    operationId: p.operationId, actorId: p.actorId, timeZone: p.timeZone, startsOn: p.startsOn, endsOn: p.endsOn,
    fromAt: p.fromAt, toAt: p.toAt, recordedAt: p.recordedAt });
}
function latest(stream: Stream, at: string) {
  let selected: Publication | null = null;
  for (const p of stream.publications) { if (p.effectiveAt > at) break; selected = p; }
  return selected;
}
function blockedFields(): Readonly<Record<AttendanceRuleKey, ThreeLayerRuleField>> {
  const fields = {} as Record<AttendanceRuleKey, ThreeLayerRuleField>;
  for (const key of RULE_KEYS) fields[key] = Object.freeze({ state: "blocked", minutes: null, source: null, trace: Object.freeze([]) });
  return Object.freeze(fields);
}
function candidateFields(revision: number, personal: Approval | null, group: Stream | null, enterprise: Stream, at: string) {
  const personalSource = personal ? personalProvenance(revision, personal) : null;
  const selected = [group, enterprise].map(stream => {
    const publication = stream ? latest(stream, at) : null;
    return { stream, publication, source: stream && publication ? publicationProvenance(stream, publication) : null };
  });
  const fields = {} as Record<AttendanceRuleKey, ThreeLayerRuleField>;
  for (const key of RULE_KEYS) {
    const choice = personal?.rules[key];
    const trace: ThreeLayerRuleTrace[] = [Object.freeze({ layer: "personal", groupId: null, ledgerRevision: revision,
      mode: choice?.mode ?? "missing_approval", minutes: choice?.mode === "value" ? choice.minutes : null, source: personalSource })];
    selected.forEach(({ stream, publication, source }, index) => {
      const choice = publication?.rules[key];
      trace.push(Object.freeze({ layer: index === 0 ? "group" : "enterprise", groupId: stream?.groupId ?? null, ledgerRevision: stream?.revision ?? null,
        mode: stream === null ? "no_assignment" : choice?.mode ?? "missing_publication", minutes: choice?.mode === "value" ? choice.minutes : null, source }));
    });
    const chosen = trace.find(t => t.mode === "value" || t.mode === "disabled");
    fields[key] = Object.freeze({ state: chosen ? chosen.mode === "value" ? "value" : "disabled" : "unconfigured",
      minutes: chosen?.mode === "value" ? chosen.minutes : null, source: chosen?.source ?? null, trace: Object.freeze(trace) });
  }
  return Object.freeze(fields);
}

/**
 * A current, unsealed candidate projection of an ALREADY PARSED rule-sources-v1
 * read. This pure function is not an authorization or completeness boundary and
 * must never be fed separately fetched paginated ledgers joined in a browser.
 * It does not inspect attendance facts or apply/classify any actual attendance.
 * Personal intervals were future when approved; past query dates still describe
 * today's ledger projection, never a reconstructed historical applied policy.
 */
export function resolveCandidateThreeLayerRules(source: RuleSourcesResult): CandidateThreeLayerRulesResolution {
  if (!source || source.protocol !== "rule-sources-v1" || !source.worker || typeof source.worker.active !== "boolean"
    || typeof source.worker.employeeActive !== "boolean" || !integer(source.worker.version, 1) || !integer(source.settingsVersion, 1)
    || !Array.isArray(source.warnings) || !source.assignments || !source.rules || !source.personal || !integer(source.personal.revision)) invalid();
  for (const section of [source.assignments, source.rules, source.personal]) {
    if (typeof section.limited !== "boolean" || !Array.isArray(section.items)) invalid();
    if (section.items.length > 100) tooLarge();
    if (section.limited && section.items.length) invalid();
  }
  try {
    attendanceInstant(source.fromAt); attendanceInstant(source.toAt);
    const days = (Date.parse(source.throughDate) - Date.parse(source.fromDate)) / 86400000 + 1;
    if (!Number.isInteger(days) || days < 1 || days > 7 || source.fromAt >= source.toAt
      || source.fromAt !== attendanceDayUtcRange(source.fromDate, source.timeZone).startAt
      || source.toAt !== attendanceDayUtcRange(source.throughDate, source.timeZone).endAt || attendanceRecordInstant(source.readAt) !== source.readAt) invalid();
  } catch { return invalid(); }
  const blockers: string[] = [];
  if (source.assignments.limited) blockers.push("assignments_truncated");
  if (source.rules.limited) blockers.push("rules_truncated");
  if (source.personal.limited) blockers.push("personal_truncated");
  if (source.warnings.includes("identity_changed") || source.assignments.items.some(a => a?.detail && a.detail.employeeId !== source.worker.employeeId)) blockers.push("identity_changed");
  if (!source.worker.active) blockers.push("inactive_worker");
  if (!source.worker.employeeActive) blockers.push("inactive_employee");
  if (source.worker.employeeId === null || source.worker.employeeAuthUserId === null) blockers.push("unbound_employee");
  const finish = (segments: ThreeLayerRuleSegment[]): CandidateThreeLayerRulesResolution => Object.freeze({
    protocol: "candidate-three-layer-rules-v1", siteId: source.siteId, workerId: source.worker.workerId, actorId: source.actorId,
    employeeId: source.worker.employeeId, employeeAuthUserId: source.worker.employeeAuthUserId, personalRevision: source.personal.revision,
    fromDate: source.fromDate, throughDate: source.throughDate, fromAt: source.fromAt, toAt: source.toAt, timeZone: source.timeZone, readAt: source.readAt,
    formalReady: false, applied: false, limitations: Object.freeze(["candidate_rules_not_applied", "historical_context_not_pinned"]), segments: Object.freeze(segments),
  });
  if (blockers.length) return finish([Object.freeze({ fromAt: source.fromAt, toAt: source.toAt, status: "blocked", blockers: Object.freeze(blockers), fields: blockedFields() })]);

  const assigned = assignments(source), byGroup = streams(source, assigned.groups), personal = approvals(source);
  const relevant = new Set(assigned.live.map(a => a.detail.groupId)), boundaries = new Set([source.fromAt, source.toAt]);
  const add = (at: string | null) => { if (at !== null && at > source.fromAt && at < source.toAt) boundaries.add(at); };
  for (const a of assigned.live) { add(a.fromAt); add(a.toAt); }
  for (const stream of byGroup.values()) if (stream.groupId === null || relevant.has(stream.groupId)) for (const p of stream.publications) add(p.effectiveAt);
  for (const p of personal) { add(p.fromAt); add(p.toAt); }
  const points = [...boundaries].sort();
  // 100 assignments * 2 + 100 publications + 100 approvals * 2 + 1.
  if (points.length - 1 > THREE_LAYER_RULE_MAX_SEGMENTS) tooLarge();
  const segments: ThreeLayerRuleSegment[] = [];
  for (let index = 0; index < points.length - 1; index++) {
    const fromAt = points[index], toAt = points[index + 1], active = assigned.live.filter(a => overlaps(a.fromAt, a.toAt, fromAt, toAt));
    const activePersonal = personal.filter(p => overlaps(p.fromAt, p.toAt, fromAt, toAt)), assignment = active.length === 1 ? active[0] : null;
    const selectedPersonal = activePersonal.length === 1 ? activePersonal[0] : null, enterprise = byGroup.get(null);
    const group = assignment ? byGroup.get(assignment.detail.groupId) : null, blockers: string[] = [];
    if (active.length > 1) blockers.push("assignment_overlap");
    if (activePersonal.length > 1) blockers.push("personal_overlap");
    if (assignment && !assignment.currentGroup.active) blockers.push("inactive_group");
    if (!enterprise || assignment && !group) blockers.push("missing_rule_stream");
    segments.push(Object.freeze({ fromAt, toAt, status: blockers.length ? "blocked" : "candidate",
      ...(assignment ? { assignmentId: assignment.detail.assignmentId, assignmentRevision: assignment.detail.revision, groupId: assignment.detail.groupId } : {}),
      ...(selectedPersonal ? { personalApprovalRevision: selectedPersonal.revision } : {}), blockers: Object.freeze(blockers),
      fields: blockers.length ? blockedFields() : candidateFields(source.personal.revision, selectedPersonal, group ?? null, enterprise!, fromAt) }));
  }
  return finish(segments);
}
