import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { assertOutageLinksWriteQuery, outageLinksCommandFingerprintText, parseOutageLinksCommand, parseOutageLinksQuery, parseOutageLinksResult } from "./merchantAttendanceOutageLinks";
import { executeOutageLinks, outageLinksCommandFingerprint, outageLinksSiteEnabled, projectOutageLinksResult } from "./merchantAttendanceOutageLinks.server";
import type { OutageLinkEntry, OutageLinkEvidence, OutageLinkPreview, OutageLinkReference, OutageLinkSnapshot, OutageLinksCommand, OutageLinksQuery, OutageLinksResult } from "./merchantAttendanceOutageLinksContract";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const siteId = "99999001", owner = id(1), employee = id(2), declarationId = id(3), at = "2026-10-07T12:00:00.000000Z";
const digest = (text: string) => createHash("sha256").update(text).digest("hex");
const q = (): OutageLinksQuery => ({ siteId, access: "owner", mode: "detail", declarationId });
const session = (): Extract<OutageLinkReference, { kind: "session" }> => ({ kind: "session", startEventId: id(10), lastEventId: id(11), lastSequence: 2, effectOperationId: null, effectRevision: null });
const missing = (): OutageLinkReference => ({ kind: "missing", requestId: id(20), rootRequestId: id(20), approvalOperationId: id(21) });
function snap(): OutageLinkSnapshot {
  const range = { startAt: "2026-10-07T09:00:00.000001Z", endAt: "2026-10-07T11:00:00.000002Z" };
  return { reference: session(), locationId: id(4), timeZone: "Europe/Madrid", original: { ...range }, selected: { ...range }, evidenceFingerprint: "a".repeat(64), pending: false, open: false };
}
function evidence(): OutageLinkEvidence { return { protocol: "outage-link-evidence-v1", siteId, declarationId, workerId: id(5), employeeId: id(6), employeeAuthUserId: employee, workerVersion: 3, employeeVersion: 2, generation: 0,
  declaredInterval: { startAt: "2026-10-07T08:30:00.000000Z", endAt: "2026-10-07T11:30:00.000000Z", timeZone: "Europe/Madrid", startOffsetMinutes: 120, endOffsetMinutes: 120 }, items: [snap()] }; }
function preview(e = evidence()): OutageLinkPreview { return { fingerprint: digest(JSON.stringify(e)), evidence: e, eligible: true,
  observations: e.items.map(i => ({ reference: i.reference, current: structuredClone(i), available: true, changed: false, open: i.open, pending: i.pending })),
  blockers: [...(e.items.some(s => s.open) ? ["source_open" as const] : []), ...(e.items.some(s => s.pending) ? ["pending_source" as const] : [])] }; }
const command = (e = evidence()): Extract<OutageLinksCommand, { action: "apply" }> => ({ action: "apply", operationId: id(30), expectedRevision: 0, expectedFingerprint: digest(JSON.stringify(e)), sources: e.items.map(i => i.reference), reason: "明确关联，仅作待核依据" });
function entry(e = evidence()): OutageLinkEntry { const c = command(e); return { operationId: c.operationId, revision: 1, action: "apply", actorId: owner, reason: c.reason, sources: c.sources, evidence: e, fingerprint: c.expectedFingerprint, recordedAt: at }; }
const base = (query = q()): OutageLinksResult => ({ protocol: "attendance-outage-links-v1", siteId, access: query.access, mode: query.mode, actorId: query.access === "owner" ? owner : employee, declarationId, readAt: at, canWrite: false, revision: 0, current: null, preview: null, history: [], historyTruncated: false, receipt: null });
function detail(e = evidence(), query = q()): OutageLinksResult { return { ...base(query), revision: 1, current: entry(structuredClone(e)), preview: preview(structuredClone(e)) }; }
function saved(e = evidence()): OutageLinksResult { return { ...base(), revision: 1, receipt: { operationId: id(30), commandFingerprint: outageLinksCommandFingerprint(q(), command(e)), entry: entry(e) } }; }
function raw(v: OutageLinksResult): unknown {
  const source = (x: OutageLinkEntry | OutageLinkPreview | null) => x === null ? null : { ...x, sourceText: x.evidence === null ? null : JSON.stringify(x.evidence) };
  return structuredClone({ ...v, current: source(v.current), preview: source(v.preview), receipt: v.receipt && { ...v.receipt, entry: source(v.receipt.entry) } });
}
const previewQuery = (sources: OutageLinkReference[] = [session()]): OutageLinksQuery => ({ ...q(), mode: "preview", sources });
const recoverQuery = (): OutageLinksQuery => ({ ...q(), mode: "recover", operationId: id(30) });

test("strict discriminated query permits self detail/history but no self preview/recovery or authority fields", () => {
  for (const query of [q(), previewQuery(), recoverQuery(), { ...q(), access: "self", mode: "history", beforeRevision: null }, { ...q(), access: "self" }] as OutageLinksQuery[]) assert.deepEqual(parseOutageLinksQuery(query), query);
  for (const query of [{ ...q(), sourceText: "forged" }, { ...previewQuery(), access: "self" }, { ...recoverQuery(), access: "self" }, { ...q(), mode: "history", beforeRevision: 0 }, { ...q(), mode: "history", beforeRevision: 102 }, { ...q(), siteId: siteId + "\n" }]) assert.throws(() => parseOutageLinksQuery(query));
});
test("apply/revoke commands reserve final revision for withdrawal and require explicit reason", () => {
  assert.deepEqual(parseOutageLinksCommand(command()), command());
  const revoke = { action: "revoke", operationId: id(31), expectedRevision: 99, expectedFingerprint: "a".repeat(64), reason: "撤销关联，不修改原记录" };
  assert.doesNotThrow(() => parseOutageLinksCommand(revoke));
  for (const patch of [{ reason: " " }, { reason: "x".repeat(1001) }, { approved: true }, { expectedRevision: 99 }, { expectedRevision: -0 }, { expectedFingerprint: "A".repeat(64) }, { sources: [] }]) assert.throws(() => parseOutageLinksCommand({ ...command(), ...patch }));
  assert.throws(() => parseOutageLinksCommand({ ...revoke, expectedRevision: 0 })); assert.throws(() => parseOutageLinksCommand({ ...revoke, sources: [] }));
  assert.doesNotThrow(() => assertOutageLinksWriteQuery(q()));
  for (const query of [previewQuery(), recoverQuery(), { ...q(), access: "self" }] as OutageLinksQuery[]) assert.throws(() => assertOutageLinksWriteQuery(query));
});
test("references keep exact session or current approved missing identity without duplicate roots", () => {
  assert.doesNotThrow(() => parseOutageLinksCommand({ ...command(), sources: [session(), missing()] }));
  for (const sources of [[session(), session()], [{ ...session(), effectRevision: 1 }], [{ ...missing(), approvalOperationId: id(20) }], [{ ...missing(), extra: true }],
    [missing(), { ...missing(), requestId: id(22) }], Array.from({ length: 11 }, (_, n) => ({ ...session(), startEventId: id(100 + n) }))]) assert.throws(() => parseOutageLinksCommand({ ...command(), sources }));
});
test("command digest uses ordered scalar reference tuples and is independent of object key ordering", () => {
  const c = command(), r = session();
  assert.equal(outageLinksCommandFingerprintText(q(), c), JSON.stringify([siteId, "owner", declarationId, "apply", c.operationId, 0, c.expectedFingerprint, [["session", r.startEventId, r.lastEventId, 2, null, null]], c.reason]));
  assert.equal(outageLinksCommandFingerprint(q(), c), outageLinksCommandFingerprint(q(), Object.fromEntries(Object.entries(c).reverse()) as OutageLinksCommand));
  assert.notEqual(outageLinksCommandFingerprint(q(), c), outageLinksCommandFingerprint(q(), { ...c, reason: "另一声明" }));
});
test("current evidence is verified by canonical UTF8 SHA and stripped before returning detached frozen data", () => {
  const input = raw(detail()), result = projectOutageLinksResult(input, q(), owner);
  assert.deepEqual(result, detail()); assert(!("sourceText" in result.current!)); assert(Object.isFrozen(result.current!.evidence!.items)); assert(!Object.isFrozen(input));
  for (const mutate of [
    (v: Record<string, unknown>) => { (v.current as Record<string, unknown>).sourceText = "{}"; },
    (v: Record<string, unknown>) => { (v.current as Record<string, unknown>).fingerprint = "b".repeat(64); },
    (v: Record<string, unknown>) => { ((v.current as OutageLinkEntry).evidence!).items[0].pending = true; },
  ]) { const value = raw(detail()) as Record<string, unknown>; mutate(value); assert.throws(() => projectOutageLinksResult(value, q(), owner)); }
});
test("open/pending evidence remains explicit unresolved preparation even when eligible to link", () => {
  const e = evidence(); e.items[0] = { ...snap(), reference: { ...session(), lastEventId: session().startEventId, lastSequence: 1 }, original: { startAt: snap().selected.startAt, endAt: null }, selected: { startAt: snap().selected.startAt, endAt: null }, open: true, pending: true };
  const query = previewQuery(e.items.map(i => i.reference)), v = { ...base(query), preview: preview(e) };
  const result = projectOutageLinksResult(raw(v), query, owner);
  assert.equal(result.preview!.eligible, true); assert.deepEqual(result.preview!.blockers, ["source_open", "pending_source"]);
  assert.equal("resolved" in result, false); assert.equal("confirmed" in result, false);
  for (const blockers of [[], ["source_open"], ["pending_source"]]) assert.throws(() => parseOutageLinksResult({ ...v, preview: { ...v.preview, blockers } }, query, owner));
});
test("missing and corrected session snapshots preserve distinct originals and selected values", () => {
  const e = evidence(); e.items = [{ ...snap(), reference: missing(), original: null }, { ...snap(), reference: { ...session(), effectOperationId: id(32), effectRevision: 1 }, selected: { ...snap().selected, startAt: "2026-10-07T08:45:00.000000Z" } }];
  assert.doesNotThrow(() => projectOutageLinksResult(raw(detail(e)), q(), owner));
  for (const patch of [{ original: snap().original }, { open: true }, { selected: { ...snap().selected, endAt: null } }]) {
    const bad = structuredClone(e); bad.items[0] = { ...bad.items[0], ...patch }; assert.throws(() => projectOutageLinksResult(raw(detail(bad)), q(), owner));
  }
});
test("later exact source or pending revision change is marked stale without replacing saved snapshot", () => {
  const v = detail(), old = structuredClone(v.current);
  v.preview!.observations[0].current!.reference = { ...session(), effectOperationId: id(40), effectRevision: 1 };
  v.preview!.observations[0].current!.selected.endAt = "2026-10-07T11:15:00.000000Z";
  v.preview!.observations[0].current!.evidenceFingerprint = "b".repeat(64);
  v.preview!.observations[0].changed = true; v.preview!.eligible = false; v.preview!.blockers = ["source_changed"];
  v.preview!.evidence!.items = [structuredClone(v.preview!.observations[0].current!)]; v.preview!.fingerprint = digest(JSON.stringify(v.preview!.evidence));
  const result = projectOutageLinksResult(raw(v), q(), owner);
  assert.deepEqual(result.current, old); assert.equal(result.preview!.observations[0].changed, true);
  const bad = structuredClone(v); bad.preview!.observations[0].changed = false; assert.throws(() => projectOutageLinksResult(raw(bad), q(), owner));
  const pending = detail(); pending.preview!.observations[0].current!.evidenceFingerprint = "c".repeat(64);
  pending.preview!.evidence!.items = [structuredClone(pending.preview!.observations[0].current!)]; pending.preview!.fingerprint = digest(JSON.stringify(pending.preview!.evidence));
  assert.throws(() => projectOutageLinksResult(raw(pending), q(), owner)); // Same refs and boolean still require precise pending fingerprint change.
});
test("unknown/unavailable sources do not become a fabricated successful current result", () => {
  const v = detail(); v.preview = { fingerprint: null, evidence: null, eligible: false, blockers: ["source_unavailable"], observations: [{ reference: session(), current: null, available: false, changed: false, open: false, pending: false }] };
  assert.doesNotThrow(() => projectOutageLinksResult(raw(v), q(), owner));
  for (const patch of [{ eligible: true }, { blockers: [] }, { fingerprint: "a".repeat(64) }]) assert.throws(() => projectOutageLinksResult(raw({ ...v, preview: { ...v.preview!, ...patch } }), q(), owner));
});
test("identity/version changes never migrate a saved declaration to another employee", () => {
  const v = detail(); v.preview!.evidence!.generation++;
  v.preview!.fingerprint = digest(JSON.stringify(v.preview!.evidence));
  assert.throws(() => projectOutageLinksResult(raw(v), q(), owner));
  v.preview!.eligible = false; v.preview!.blockers = ["source_changed"];
  assert.doesNotThrow(() => projectOutageLinksResult(raw(v), q(), owner));
  v.preview!.evidence!.employeeAuthUserId = id(99); v.preview!.fingerprint = digest(JSON.stringify(v.preview!.evidence));
  assert.throws(() => projectOutageLinksResult(raw(v), q(), owner));
  const self: OutageLinksQuery = { ...q(), access: "self" };
  assert.doesNotThrow(() => projectOutageLinksResult(raw(detail(evidence(), self)), self, employee));
  assert.throws(() => projectOutageLinksResult(raw(detail(evidence(), self)), self, owner));
});
test("unavailable observations are unknown, while available previews cannot claim future evidence", () => {
  const v = detail(); v.preview = { fingerprint: null, evidence: null, eligible: false, blockers: ["source_unavailable", "source_changed"], observations: [{ reference: session(), current: null, available: false, changed: true, open: false, pending: false }] };
  assert.throws(() => projectOutageLinksResult(raw(v), q(), owner));
  const e = evidence(); e.items[0].original!.endAt = e.items[0].selected.endAt = "2026-10-07T12:00:00.000001Z";
  const query = previewQuery(), future = { ...base(query), preview: preview(e) };
  assert.throws(() => projectOutageLinksResult(raw(future), query, owner));
});
test("POST and original recovery carry the immutable original entry rather than today's source", () => {
  assert.deepEqual(projectOutageLinksResult(raw(saved()), q(), owner, command()), saved());
  const rq = recoverQuery(), v = { ...saved(), mode: "recover" as const };
  assert.deepEqual(projectOutageLinksResult(raw(v), rq, owner), v);
  for (const patch of [{ current: entry() }, { preview: preview() }, { canWrite: true }, { historyTruncated: true }, { revision: 2 }, { actorId: employee }]) assert.throws(() => projectOutageLinksResult(raw({ ...saved(), ...patch }), q(), owner, command()));
  assert.throws(() => projectOutageLinksResult(raw(saved()), q(), owner, { ...command(), reason: "另一次操作" }));
  assert.throws(() => projectOutageLinksResult(raw({ ...saved(), receipt: { ...saved().receipt!, commandFingerprint: "b".repeat(64) } }), q(), owner, command()));
});
test("revocation has no replacement evidence, retains old fingerprint and original apply remains recoverable", () => {
  const c: OutageLinksCommand = { action: "revoke", operationId: id(31), expectedRevision: 1, expectedFingerprint: command().expectedFingerprint, reason: "来源需重核，先撤销关联" };
  const revoked: OutageLinkEntry = { ...entry(), operationId: c.operationId, revision: 2, action: "revoke", reason: c.reason, sources: [], evidence: null };
  const v: OutageLinksResult = { ...base(), revision: 2, receipt: { operationId: c.operationId, commandFingerprint: outageLinksCommandFingerprint(q(), c), entry: revoked } };
  assert.doesNotThrow(() => projectOutageLinksResult(raw(v), q(), owner, c));
  assert.doesNotThrow(() => projectOutageLinksResult(raw({ ...base(), revision: 2, current: revoked }), q(), owner));
  assert.doesNotThrow(() => projectOutageLinksResult(raw({ ...saved(), mode: "recover" }), recoverQuery(), owner));
  for (const patch of [{ evidence: evidence() }, { sources: [session()] }, { revision: 1 }]) assert.throws(() => projectOutageLinksResult(raw({ ...v, receipt: { ...v.receipt!, entry: { ...revoked, ...patch } } }), q(), owner, c));
});
test("history pages are bounded descending summaries without duplicated evidence bodies", () => {
  const query: OutageLinksQuery = { ...q(), mode: "history", beforeRevision: null };
  const one = entry(), { sources: _s, evidence: _e, ...head } = one; void _s; void _e;
  const history = Array.from({ length: 25 }, (_, n) => ({ ...head, operationId: id(100 + n), revision: 30 - n, sourceCount: 1 }));
  const v: OutageLinksResult = { ...base(query), revision: 30, history, historyTruncated: true };
  assert.doesNotThrow(() => projectOutageLinksResult(raw(v), query, owner));
  for (const patch of [{ history: history.slice(0, 24) }, { historyTruncated: false }, { canWrite: true }, { current: one }, { history: [...history].reverse() }, { history: [{ ...history[0], sourceCount: 0 }, ...history.slice(1)] }]) assert.throws(() => projectOutageLinksResult(raw({ ...v, ...patch }), query, owner));
  const next = { ...query, beforeRevision: 6 }, end: OutageLinksResult = { ...v, history: history.slice(0, 5).map((h, n) => ({ ...h, revision: 5 - n })), historyTruncated: false };
  assert.doesNotThrow(() => projectOutageLinksResult(raw(end), next, owner));
});
test("parsers reject executable getters, sparse sources, extra authority and oversized private text", () => {
  let called = false; assert.throws(() => parseOutageLinksQuery({ ...q(), get mode() { called = true; return "detail"; } })); assert.equal(called, false);
  const sparse = new Array(2); sparse[1] = session(); assert.throws(() => parseOutageLinksCommand({ ...command(), sources: sparse }));
  assert.throws(() => parseOutageLinksResult({ ...detail(), resolved: true }, q(), owner));
  const value = raw(detail()) as { current: { sourceText: string } }; value.current.sourceText = "x".repeat(131073); assert.throws(() => projectOutageLinksResult(value, q(), owner));
});
test("service write rollout is opt-in/exact-site and cannot be enabled by self or preview commands", async () => {
  assert(!outageLinksSiteEnabled(siteId, {}));
  const enabled = { FAOLLA_ATTENDANCE_OUTAGE_LINKS_ENABLED: "1", FAOLLA_ATTENDANCE_OUTAGE_LINKS_SITE_IDS: siteId };
  assert(outageLinksSiteEnabled(siteId, enabled));
  for (const text of [siteId + ",", "", "bad," + siteId, Array(101).fill(siteId).join(","), "x".repeat(4097)]) assert(!outageLinksSiteEnabled(siteId, { ...enabled, FAOLLA_ATTENDANCE_OUTAGE_LINKS_SITE_IDS: text }));
  const calls: unknown[] = [], service = { rpc: async (name: string, args: Record<string, unknown>) => { calls.push({ name, args }); return { data: raw({ ...saved(), mode: "recover" }), error: null }; } };
  await executeOutageLinks({ query: recoverQuery(), authUserId: owner, moduleEnabled: false }, service);
  assert.deepEqual(calls, [{ name: "faolla_attendance_outage_links_v1", args: { p_query: recoverQuery(), p_auth_user_id: owner, p_command: null, p_allow_write: false } }]);
  await assert.rejects(executeOutageLinks({ query: previewQuery(), authUserId: owner, command: command() }, service), /attendance_invalid_request/); assert.equal(calls.length, 1);
});
test("service sanitizes unknown RPC failures and revalidates source/hash before acknowledging success", async () => {
  await assert.rejects(executeOutageLinks({ query: q(), authUserId: owner }, null), /attendance_unavailable/);
  for (const [message, error] of [["attendance_outage_links_changed", "attendance_outage_links_changed"], ["SQL private details", "attendance_unavailable"]]) await assert.rejects(executeOutageLinks({ query: q(), authUserId: owner }, { rpc: async () => ({ data: null, error: { message } }) }), new RegExp(error));
  await assert.rejects(executeOutageLinks({ query: q(), authUserId: owner }, { rpc: async () => { throw Error("secret"); } }), /attendance_unavailable/);
  await assert.rejects(executeOutageLinks({ query: q(), authUserId: owner }, { rpc: async () => ({ data: null, error: null }) }), /attendance_outage_links_invalid/);
});
