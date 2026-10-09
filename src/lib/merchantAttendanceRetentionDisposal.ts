// C23 pure candidate foundation ONLY. Nothing here reads the database, checks
// authority, approves an action or clears a field. Caller-provided hashes and
// coverage assertions are not evidence of authentic/complete database reads.
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { captureBrowserExact, parseCaptureBrowserJson } from "./merchantAttendanceRuleCapturesBrowser";
import { RETENTION_MAX_DAYS, RETENTION_MAX_REVISION, type RetentionLocationSource } from "./merchantAttendanceRetentionContract";

export const RETENTION_DISPOSAL_INPUT_PROTOCOL = "attendance-retention-disposal-input-v1" as const;
export const RETENTION_DISPOSAL_PREVIEW_PROTOCOL = "attendance-retention-disposal-preview-v1" as const;
export const RETENTION_DISPOSAL_BYTE_LIMIT = 65536;
export const RETENTION_DISPOSAL_SELECTION_LIMIT = 25;
export const RETENTION_DISPOSAL_FIELDS = Object.freeze(["captured_at", "accuracy_meters", "distance_meters"] as const);
export type RetentionDisposalCoverage = "complete" | "unknown" | "over_limit";
export type RetentionDisposalHold = Readonly<{ revision: number; held: boolean; operationId: string | null; recordedAt: string | null }>;
export type RetentionDisposalInput = Readonly<{
  protocol: typeof RETENTION_DISPOSAL_INPUT_PROTOCOL; siteId: string; asOf: string;
  location: Readonly<{ evidenceId: string; workerId: string; sourceFingerprint: string; anchorAt: string;
    reason: RetentionLocationSource["reason"]; needsReview: boolean;
    precisionPresent: Readonly<{ capturedAt: boolean; accuracyMeters: boolean; distanceMeters: boolean }> }>;
  policy: Readonly<{ category: "location_results"; revision: number; retentionDays: number | null; operationId: string | null; recordedAt: string | null }>;
  dependencies: Readonly<{
    session: Readonly<{ state: "closed" | "open" | "unknown"; sessionId: string | null; sourceFingerprint: string | null }>;
    review: Readonly<{ coverage: RetentionDisposalCoverage; hasReview: boolean; hasDiscussion: boolean }>;
    locationSnapshotHistory: Readonly<{ coverage: RetentionDisposalCoverage; hasAnySnapshot: boolean }>;
    artifacts: Readonly<{ coverage: RetentionDisposalCoverage; items: readonly Readonly<{ artifactId: string; sourceFingerprint: string }>[] }>;
  }>;
  preservation: Readonly<{ coverage: RetentionDisposalCoverage; location: RetentionDisposalHold; event: RetentionDisposalHold;
    artifacts: readonly (RetentionDisposalHold & Readonly<{ artifactId: string }>)[] }>;
}>;
export const RETENTION_DISPOSAL_BLOCKERS = Object.freeze([
  "policy_unconfigured", "not_due", "not_inside", "precision_not_present", "session_not_closed", "review_incomplete",
  "location_review", "location_discussion", "snapshot_history_incomplete", "historical_location_snapshot", "artifact_dependencies_incomplete",
  "holds_incomplete", "location_held", "event_held", "artifact_held",
] as const);
export type RetentionDisposalBlocker = typeof RETENTION_DISPOSAL_BLOCKERS[number];
export type RetentionDisposalPreview = Readonly<{
  protocol: typeof RETENTION_DISPOSAL_PREVIEW_PROTOCOL; status: "preview_only"; candidateOnly: true; authorityChecked: false; applied: false;
  evidenceOrigin: "caller_provided"; sourceFingerprintVerified: false;
  siteId: string; asOf: string; evidenceId: string; workerId: string; fields: typeof RETENTION_DISPOSAL_FIELDS;
  candidateState: "candidate" | "blocked"; evidenceCompleteness: "caller_claimed_complete" | "incomplete";
  dueAt: string | null; blockers: readonly RetentionDisposalBlocker[]; sourceFingerprint: string;
  policyFingerprint: string; dependencyFingerprint: string; holdFingerprint: string; previewFingerprint: string;
}>;

type Tuple = null | boolean | number | string | readonly Tuple[];
function invalid(): never { throw new MerchantAttendanceError("attendance_retention_disposal_invalid"); }
function exact(value: unknown, keys: readonly string[]) { try { return captureBrowserExact(value, keys); } catch { return invalid(); } }
function freeze<T>(value: T): T { if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
function unicode(value: string) {
  if (value.includes("\0")) invalid();
  for (let i = 0; i < value.length; i++) { const unit = value.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff) { const next = value.charCodeAt(++i); if (!(next >= 0xdc00 && next <= 0xdfff)) invalid(); }
    else if (unit >= 0xdc00 && unit <= 0xdfff) invalid(); }
}
// Validate descriptors before touching any user-controlled property or serializing.
function tree(raw: unknown) {
  let nodes = 0; const ancestors = new Set<object>();
  const visit = (v: unknown, depth: number): void => {
    if (++nodes > 4096 || depth > 16) invalid();
    if (v === null || typeof v === "boolean") return;
    if (typeof v === "string") { if (v.length > RETENTION_DISPOSAL_BYTE_LIMIT) invalid(); unicode(v); return; }
    if (typeof v === "number") { if (!Number.isSafeInteger(v) || Object.is(v, -0)) invalid(); return; }
    if (typeof v !== "object" || ancestors.has(v)) invalid(); ancestors.add(v);
    const array = Array.isArray(v), prototype = Object.getPrototypeOf(v), keys = Reflect.ownKeys(v);
    if (array ? prototype !== Array.prototype || v.length > RETENTION_DISPOSAL_SELECTION_LIMIT || keys.length !== v.length + 1
      : prototype !== Object.prototype && prototype !== null) invalid();
    for (const key of keys) {
      if (typeof key !== "string" || key.length > RETENTION_DISPOSAL_BYTE_LIMIT) invalid(); unicode(key);
      if (array && key === "length") continue;
      if (["__proto__", "constructor", "prototype"].includes(key) || array && !/^(0|[1-9][0-9]*)$/.test(key)) invalid();
      const descriptor = Object.getOwnPropertyDescriptor(v, key)!;
      if (!("value" in descriptor) || !descriptor.enumerable) invalid(); visit(descriptor.value, depth + 1);
    }
    // Length+key count alone would permit a sparse array with an extra index.
    if (array) for (let i = 0; i < v.length; i++) if (!Object.hasOwn(v, String(i))) invalid();
    ancestors.delete(v);
  };
  visit(raw, 0); if (new TextEncoder().encode(JSON.stringify(raw)).byteLength > RETENTION_DISPOSAL_BYTE_LIMIT) invalid();
}
const uuid = (v: unknown): string => typeof v === "string" && v.length === 36 && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v) ? v : invalid();
const site = (v: unknown): string => typeof v === "string" && v.length === 8 && /^[0-9]{8}$/.test(v) ? v : invalid();
const hash = (v: unknown): string => typeof v === "string" && v.length === 64 && /^[0-9a-f]{64}$/.test(v) ? v : invalid();
const bool = (v: unknown): boolean => typeof v === "boolean" ? v : invalid();
const integer = (v: unknown, min = 0, max = RETENTION_MAX_REVISION): number => typeof v === "number" && Number.isSafeInteger(v) && !Object.is(v, -0) && v >= min && v <= max ? v : invalid();
function choice<T extends string>(v: unknown, values: readonly T[]): T { return typeof v === "string" && values.includes(v as T) ? v as T : invalid(); }
const coverage = (v: unknown) => choice(v, ["complete", "unknown", "over_limit"] as const);
function stamp(v: unknown): string {
  if (typeof v !== "string" || v.length !== 27 || !/^(?!0000)\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(v)) invalid();
  const short = v.slice(0, 23) + "Z"; if (!Number.isFinite(Date.parse(short)) || new Date(short).toISOString() !== short) invalid(); return v;
}
function observed(v: unknown, asOf: string): string { const value = stamp(v); if (value > asOf) invalid(); return value; }
function hold(raw: unknown, asOf: string): RetentionDisposalHold {
  const h = exact(raw, ["revision", "held", "operationId", "recordedAt"]);
  const value = { revision: integer(h.revision), held: bool(h.held), operationId: h.operationId === null ? null : uuid(h.operationId), recordedAt: h.recordedAt === null ? null : observed(h.recordedAt, asOf) };
  if (value.revision === 0 ? value.held || value.operationId !== null || value.recordedAt !== null
    : value.operationId === null || value.recordedAt === null || value.revision === 1 && !value.held) invalid(); return value;
}
function sortedIds<T>(items: readonly T[], getId: (item: T) => string) {
  for (let i = 1; i < items.length; i++) if (getId(items[i - 1]) >= getId(items[i])) invalid();
}
/** Exact metadata parsing only; it does not verify a source hash or authenticate
 * the actor who provided these observations. Values are detached before await. */
export function parseRetentionDisposalInput(raw: unknown): RetentionDisposalInput {
  try {
    tree(raw); const r = exact(raw, ["protocol", "siteId", "asOf", "location", "policy", "dependencies", "preservation"]);
    if (r.protocol !== RETENTION_DISPOSAL_INPUT_PROTOCOL) invalid(); const siteId = site(r.siteId), asOf = stamp(r.asOf);
    const l = exact(r.location, ["evidenceId", "workerId", "sourceFingerprint", "anchorAt", "reason", "needsReview", "precisionPresent"]), pp = exact(l.precisionPresent, ["capturedAt", "accuracyMeters", "distanceMeters"]);
    const location: RetentionDisposalInput["location"] = { evidenceId: uuid(l.evidenceId), workerId: uuid(l.workerId), sourceFingerprint: hash(l.sourceFingerprint), anchorAt: observed(l.anchorAt, asOf),
      reason: choice(l.reason, ["inside", "outside", "uncertain", "stale", "future", "denied", "timeout", "unavailable", "unsupported", "not_provided"] as const), needsReview: bool(l.needsReview),
      precisionPresent: { capturedAt: bool(pp.capturedAt), accuracyMeters: bool(pp.accuracyMeters), distanceMeters: bool(pp.distanceMeters) } };
    if (location.needsReview !== (location.reason !== "inside")) invalid();
    const p = exact(r.policy, ["category", "revision", "retentionDays", "operationId", "recordedAt"]); if (p.category !== "location_results") invalid();
    const policy: RetentionDisposalInput["policy"] = { category: "location_results", revision: integer(p.revision), retentionDays: p.retentionDays === null ? null : integer(p.retentionDays, 1, RETENTION_MAX_DAYS),
      operationId: p.operationId === null ? null : uuid(p.operationId), recordedAt: p.recordedAt === null ? null : observed(p.recordedAt, asOf) };
    if (policy.revision === 0 ? policy.retentionDays !== null || policy.operationId !== null || policy.recordedAt !== null : policy.operationId === null || policy.recordedAt === null) invalid();
    const d = exact(r.dependencies, ["session", "review", "locationSnapshotHistory", "artifacts"]), s = exact(d.session, ["state", "sessionId", "sourceFingerprint"]);
    const session = { state: choice(s.state, ["closed", "open", "unknown"] as const), sessionId: s.sessionId === null ? null : uuid(s.sessionId), sourceFingerprint: s.sourceFingerprint === null ? null : hash(s.sourceFingerprint) };
    if (session.state === "unknown" ? session.sessionId !== null || session.sourceFingerprint !== null : session.sessionId === null || session.sourceFingerprint === null) invalid();
    const rv = exact(d.review, ["coverage", "hasReview", "hasDiscussion"]), sh = exact(d.locationSnapshotHistory, ["coverage", "hasAnySnapshot"]), ar = exact(d.artifacts, ["coverage", "items"]);
    if (!Array.isArray(ar.items)) invalid();
    const items = ar.items.map(raw => { const a = exact(raw, ["artifactId", "sourceFingerprint"]); return { artifactId: uuid(a.artifactId), sourceFingerprint: hash(a.sourceFingerprint) }; });
    sortedIds(items, a => a.artifactId);
    const dependencies: RetentionDisposalInput["dependencies"] = { session, review: { coverage: coverage(rv.coverage), hasReview: bool(rv.hasReview), hasDiscussion: bool(rv.hasDiscussion) },
      locationSnapshotHistory: { coverage: coverage(sh.coverage), hasAnySnapshot: bool(sh.hasAnySnapshot) }, artifacts: { coverage: coverage(ar.coverage), items } };
    const ph = exact(r.preservation, ["coverage", "location", "event", "artifacts"]); if (!Array.isArray(ph.artifacts)) invalid();
    const artifacts = ph.artifacts.map(raw => { const a = exact(raw, ["artifactId", "revision", "held", "operationId", "recordedAt"]);
      return { artifactId: uuid(a.artifactId), ...hold({ revision: a.revision, held: a.held, operationId: a.operationId, recordedAt: a.recordedAt }, asOf) }; });
    const preservation: RetentionDisposalInput["preservation"] = { coverage: coverage(ph.coverage), location: hold(ph.location, asOf), event: hold(ph.event, asOf), artifacts };
    if (items.length !== artifacts.length || items.some((a, i) => a.artifactId !== artifacts[i].artifactId)
      || (preservation.location.revision > 0) !== dependencies.locationSnapshotHistory.hasAnySnapshot) invalid();
    return freeze({ protocol: RETENTION_DISPOSAL_INPUT_PROTOCOL, siteId, asOf, location, policy, dependencies, preservation });
  } catch { return invalid(); }
}
export function parseRetentionDisposalInputJson(text: string): RetentionDisposalInput {
  try { if (typeof text !== "string" || text.length > RETENTION_DISPOSAL_BYTE_LIMIT || new TextEncoder().encode(text).byteLength > RETENTION_DISPOSAL_BYTE_LIMIT) invalid();
    unicode(text); return parseRetentionDisposalInput(parseCaptureBrowserJson(text)); } catch { return invalid(); }
}
function encode(tuple: Tuple): string { return Array.isArray(tuple) ? `[${tuple.map(encode).join(", ")}]` : JSON.stringify(tuple); }
async function digest(tuple: Tuple): Promise<string> { const bytes = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(encode(tuple))); return [...new Uint8Array(bytes)].map(n => n.toString(16).padStart(2, "0")).join(""); }
function dueAt(input: RetentionDisposalInput): string | null {
  if (input.policy.retentionDays === null) return null;
  // Days are fixed 86,400 seconds, matching retention v1, not local civil days.
  const anchor = input.location.anchorAt, ms = Date.parse(anchor.slice(0, 23) + "Z") + input.policy.retentionDays * 86400000;
  const date = new Date(ms).toISOString(); return stamp(date.slice(0, -1) + anchor.slice(23, 26) + "Z");
}
async function evaluateParsed(input: RetentionDisposalInput): Promise<RetentionDisposalPreview> {
  const { siteId, asOf, location: l, policy: p, dependencies: d, preservation: h } = input, due = dueAt(input);
  const conditions: readonly boolean[] = [p.retentionDays === null, due !== null && asOf < due, l.reason !== "inside",
    !l.precisionPresent.capturedAt || !l.precisionPresent.accuracyMeters || !l.precisionPresent.distanceMeters, d.session.state !== "closed",
    d.review.coverage !== "complete", d.review.hasReview, d.review.hasDiscussion, d.locationSnapshotHistory.coverage !== "complete", d.locationSnapshotHistory.hasAnySnapshot,
    d.artifacts.coverage !== "complete", h.coverage !== "complete", h.location.held, h.event.held, h.artifacts.some(a => a.held)];
  const blockers = RETENTION_DISPOSAL_BLOCKERS.filter((_, i) => conditions[i]);
  const complete = d.review.coverage === "complete" && d.locationSnapshotHistory.coverage === "complete" && d.artifacts.coverage === "complete" && h.coverage === "complete" && d.session.state !== "unknown";
  const holdTuple = (v: RetentionDisposalHold): Tuple[] => [v.revision, v.held, v.operationId, v.recordedAt];
  const [policyFingerprint, dependencyFingerprint, holdFingerprint] = await Promise.all([
    digest(["attendance-retention-disposal-policy-v1", siteId, [p.category, p.revision, p.retentionDays, p.operationId, p.recordedAt]]),
    digest(["attendance-retention-disposal-dependencies-v1", siteId, l.evidenceId, [[d.session.state, d.session.sessionId, d.session.sourceFingerprint],
      [d.review.coverage, d.review.hasReview, d.review.hasDiscussion], [d.locationSnapshotHistory.coverage, d.locationSnapshotHistory.hasAnySnapshot],
      [d.artifacts.coverage, d.artifacts.items.map(a => [a.artifactId, a.sourceFingerprint])]]]),
    digest(["attendance-retention-disposal-holds-v1", siteId, l.evidenceId, [h.coverage, holdTuple(h.location), holdTuple(h.event), h.artifacts.map(a => [a.artifactId, ...holdTuple(a)])]]),
  ]);
  const previewFingerprint = await digest([RETENTION_DISPOSAL_PREVIEW_PROTOCOL, siteId, asOf,
    [l.evidenceId, l.workerId, l.sourceFingerprint, l.anchorAt, l.reason, l.needsReview, [l.precisionPresent.capturedAt, l.precisionPresent.accuracyMeters, l.precisionPresent.distanceMeters]],
    RETENTION_DISPOSAL_FIELDS, policyFingerprint, dependencyFingerprint, holdFingerprint, due, blockers]);
  return freeze({ protocol: RETENTION_DISPOSAL_PREVIEW_PROTOCOL, status: "preview_only", candidateOnly: true, authorityChecked: false, applied: false,
    evidenceOrigin: "caller_provided", sourceFingerprintVerified: false, siteId, asOf, evidenceId: l.evidenceId, workerId: l.workerId, fields: RETENTION_DISPOSAL_FIELDS,
    candidateState: blockers.length ? "blocked" : "candidate", evidenceCompleteness: complete ? "caller_claimed_complete" : "incomplete", dueAt: due, blockers,
    sourceFingerprint: l.sourceFingerprint, policyFingerprint, dependencyFingerprint, holdFingerprint, previewFingerprint });
}
export async function evaluateRetentionDisposal(raw: unknown): Promise<RetentionDisposalPreview> {
  try { return await evaluateParsed(parseRetentionDisposalInput(raw)); } catch { return invalid(); }
}
/** Independent previews only: no whole-selection approval/eligibility or state.
 * The same 64 KiB/4096-node budget applies to the entire optional selection. */
export async function evaluateRetentionDisposalCandidates(raw: unknown): Promise<readonly RetentionDisposalPreview[]> {
  try {
    tree(raw); const r = exact(raw, ["locationEvidenceIds", "inputs"]);
    if (!Array.isArray(r.locationEvidenceIds) || !Array.isArray(r.inputs) || !r.inputs.length || r.inputs.length !== r.locationEvidenceIds.length) invalid();
    const ids = r.locationEvidenceIds.map(uuid), inputs = r.inputs.map(parseRetentionDisposalInput); sortedIds(ids, id => id);
    if (inputs.some((input, i) => input.location.evidenceId !== ids[i] || input.siteId !== inputs[0].siteId || input.asOf !== inputs[0].asOf)) invalid();
    return freeze(await Promise.all(inputs.map(evaluateParsed)));
  } catch { return invalid(); }
}
