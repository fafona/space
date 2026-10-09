// Pure synthetic public DTOs, not SQL/Auth proof. Real projectors validate them.
import { createHash } from "node:crypto";
import { projectOutageResult } from "../../src/lib/merchantAttendanceOutage.server";
import { projectOutageReviewResult } from "../../src/lib/merchantAttendanceOutageReview.server";
import { parseOutageHttpQuery, parseOutageHttpResponse, OUTAGE_APIS } from "../../src/lib/merchantAttendanceOutageHttp";
import { outageClientPendingKey } from "../../src/lib/merchantAttendanceOutageClient";
import type { OutageResult } from "../../src/lib/merchantAttendanceOutageContract";
import type { OutageReviewEntry, OutageReviewProposal, OutageReviewResult } from "../../src/lib/merchantAttendanceOutageReviewContract";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const outagePrintSeed = Object.freeze({ siteId: "99990001", owner: id(220001), self: id(220002), other: id(220099), workerId: id(220003), employeeId: id(220004),
  declarationId: id(220005), otherDeclarationId: id(220006), incidentId: id(220007) });
const s = outagePrintSeed, at = "2026-01-07T12:00:00.000000Z";
const interval = { startAt: "2026-01-07T08:00:00.000000Z", endAt: "2026-01-07T10:00:00.000000Z", timeZone: "Europe/Madrid", startOffsetMinutes: 60, endOffsetMinutes: 60 };
export function outagePrintModel(declarationId = s.declarationId, access: "owner" | "self" = "owner") {
  const actorId = access === "owner" ? s.owner : s.self;
  const declaration: OutageResult = { protocol: "attendance-outage-v1", siteId: s.siteId, access, mode: "declaration", actorId,
    readAt: "2026-01-07T12:01:00.000000Z", canWrite: false, items: [], nextId: null, receipt: null,
    detail: { kind: "declaration", id: declarationId, operationId: id(220008), incidentId: s.incidentId, workerId: s.workerId, employeeId: s.employeeId, employeeAuthUserId: s.self,
      workerVersion: 2, employeeVersion: 3, generation: 0, interval: { ...interval }, statement: `合成纸面事实 <script>不执行</script> ${declarationId === s.declarationId ? "第一份" : "第二份"}`,
      originalOperationId: null, originalChannel: null, paperReference: "SYNTHETIC-PAPER-220", recordedBy: "owner", actorId: s.owner, actorEmployeeId: null, recordedAt: "2026-01-07T11:00:00.000000Z" } };
  const evidence: OutageReviewProposal["evidence"] = { protocol: "outage-review-evidence-v1", siteId: s.siteId, declarationId, linkOperationId: id(220011), linkRevision: 1,
    linkFingerprint: "a".repeat(64), linkEvidence: { protocol: "outage-link-evidence-v1", siteId: s.siteId, declarationId, workerId: s.workerId,
      employeeId: s.employeeId, employeeAuthUserId: s.self, workerVersion: 5, employeeVersion: 6, generation: 1, declaredInterval: { ...interval }, items: [{ reference: {
        kind: "session", startEventId: id(220009), lastEventId: id(220010), lastSequence: 2, effectOperationId: null, effectRevision: null },
        locationId: id(220012), timeZone: interval.timeZone, original: { startAt: interval.startAt, endAt: interval.endAt }, selected: { startAt: interval.startAt, endAt: interval.endAt },
        evidenceFingerprint: "b".repeat(64), pending: false, open: false }] }, original: { status: "not_required", operationId: null, channel: null, eventId: null } };
  evidence.linkFingerprint = hash(evidence.linkEvidence);
  const proposal: OutageReviewProposal = { operationId: id(220013), revision: 1, action: "propose", actorId: s.owner, resultVersion: 1,
    resultFingerprint: hash(evidence), reason: "合成负责人结果", recordedAt: at, evidence };
  const { evidence: _e, ...entry } = proposal; void _e;
  const response: OutageReviewEntry = { ...entry, operationId: id(220014), revision: 2, action: "confirm", actorId: s.self, reason: "合成本人确认精确版本" };
  const current: OutageReviewEntry = { ...entry, operationId: id(220015), revision: 3, action: "resolve", reason: "合成负责人结案" };
  const review: OutageReviewResult = { protocol: "attendance-outage-review-v1", siteId: s.siteId, access, mode: "detail", actorId, declarationId,
    readAt: "2026-01-07T12:02:00.000000Z", canWrite: false, revision: 3, resultVersion: 1, current, proposal, response,
    status: { basisFingerprint: proposal.resultFingerprint, linkOperationId: evidence.linkOperationId, linkRevision: evidence.linkRevision, linkFingerprint: evidence.linkFingerprint,
      blockers: [], canPropose: false, canConfirm: false, canResolve: false, resolved: true }, history: [], historyTruncated: false, receipt: null };
  return { declaration: projectOutageResult(declaration, { siteId: s.siteId, access, mode: "declaration", declarationId }, actorId),
    review: projectOutageReviewResult({ ...review, proposal: { ...proposal, sourceText: JSON.stringify(evidence) } }, { siteId: s.siteId, access, mode: "detail", declarationId }, actorId) };
}
export function outagePrintSyntheticResponse(url: string, actor: string) {
  const path = new URL(url).pathname, kind = path === OUTAGE_APIS.outages ? "outages" : path === OUTAGE_APIS.reviews ? "reviews" : null;
  if (!kind) throw Error("outage_print_fixture_endpoint");
  const q = parseOutageHttpQuery(kind, url);
  if (q.siteId !== s.siteId || actor !== (q.access === "owner" ? s.owner : s.self)) throw Error("outage_print_fixture_identity");
  if (kind === "outages" && q.mode === "incidents" && q.access === "owner") {
    const data: OutageResult = { ...outagePrintModel().declaration, mode: "incidents", canWrite: true, detail: null };
    const wire = { ok: true, canWrite: true, data }; parseOutageHttpResponse("outages", wire, { siteId: s.siteId, access: "owner", mode: "incidents", afterId: null }, actor); return wire;
  }
  if (!("declarationId" in q) || ![s.declarationId, s.otherDeclarationId].includes(q.declarationId) || q.mode !== (kind === "outages" ? "declaration" : "detail")) throw Error("outage_print_fixture_query");
  const model = outagePrintModel(q.declarationId, q.access), wire = { ok: true, canWrite: false, data: kind === "outages" ? model.declaration : model.review };
  parseOutageHttpResponse(kind, wire, q, actor); return wire;
}
export function outagePrintPendingSeed(kind: "outages" | "links" | "reviews" = "outages") {
  const incidentId = id(220020), operationId = id(220021), query = { siteId: s.siteId, access: "owner", mode: "incident", incidentId };
  const command = { action: "create_incident", operationId, incidentId, type: "network", channel: "web", locationId: null, interval: { ...interval }, reason: "合成待确认意图，不在此夹具发送" };
  const proposal = outagePrintModel().review.proposal!;
  const pending = kind === "outages" ? { query, command } : {
    query: { siteId: s.siteId, access: "owner", mode: "detail", declarationId: s.declarationId },
    command: kind === "links" ? { action: "apply", operationId, expectedRevision: 0, expectedFingerprint: proposal.evidence.linkFingerprint,
      sources: proposal.evidence.linkEvidence.items.map(item => item.reference), reason: command.reason }
      : { action: "propose", operationId, expectedRevision: 0, expectedResultVersion: 0, expectedFingerprint: proposal.resultFingerprint, reason: command.reason },
  };
  return { key: outageClientPendingKey(kind, s.siteId, "owner", s.owner), raw: JSON.stringify({ version: 1, kind, actorId: s.owner, ...pending }), operationId };
}

export function outagePrintLongModel() {
  const model = structuredClone(outagePrintModel()), declaration = model.declaration, review = model.review;
  if (declaration.detail?.kind !== "declaration" || !review.proposal || !review.current || !review.response || !review.status) throw Error("synthetic_long_model_shape");
  const text = "合成长内容用于核对打印分页与换行".repeat(100).slice(0, 1000);
  declaration.detail.statement = text; declaration.detail.paperReference = "合成纸面参考".repeat(20);
  for (const entry of [review.proposal, review.current, review.response]) entry.reason = text;
  const first = review.proposal.evidence.linkEvidence.items[0];
  review.proposal.evidence.linkEvidence.items = Array.from({ length: 10 }, (_, index) => ({ ...structuredClone(first),
    reference: { kind: "session", startEventId: id(220100 + index * 2), lastEventId: id(220101 + index * 2), lastSequence: 2, effectOperationId: null, effectRevision: null } }));
  const evidence = review.proposal.evidence; evidence.linkFingerprint = hash(evidence.linkEvidence); review.proposal.resultFingerprint = hash(evidence);
  review.current.resultFingerprint = review.proposal.resultFingerprint; review.response.resultFingerprint = review.proposal.resultFingerprint;
  review.status.basisFingerprint = review.proposal.resultFingerprint; review.status.linkFingerprint = evidence.linkFingerprint;
  return { declaration: projectOutageResult(declaration, { siteId: s.siteId, access: "owner", mode: "declaration", declarationId: s.declarationId }, s.owner),
    review: projectOutageReviewResult({ ...review, proposal: { ...review.proposal, sourceText: JSON.stringify(evidence) } }, { siteId: s.siteId, access: "owner", mode: "detail", declarationId: s.declarationId }, s.owner) };
}
