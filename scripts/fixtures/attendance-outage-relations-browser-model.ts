/** Synthetic in-memory transport only. No Supabase, real Auth, SQL or user data.
 * Real public/projector parsers validate every generated response. The JSON
 * serialization here is synthetic, not a claim to reproduce PostgreSQL text. */
import { createHash, randomUUID } from "node:crypto";
import { OUTAGE_APIS, OUTAGE_HTTP_ERRORS, outageHttpQueryString, parseOutageHttpBody, parseOutageHttpQuery, parseOutageHttpResponse } from "../../src/lib/merchantAttendanceOutageHttp";
import { projectOutageRelationsResult, outageRelationsCommandFingerprint } from "../../src/lib/merchantAttendanceOutageRelations.server";
import type { OutageDeclaration, OutageResult } from "../../src/lib/merchantAttendanceOutageContract";
import type { OutageRelationEntry, OutageRelationEvidence, OutageRelationPreview, OutageRelationsCommand, OutageRelationsQuery, OutageRelationsResult } from "../../src/lib/merchantAttendanceOutageRelationsContract";
import { OUTAGE_RELATIONS_MODEL as m, outageRelationsModelId as id, outageRelationsModelEvidence } from "./attendance-outage-relations-model";

const sha = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const failure = (code: string): never => { throw Object.assign(Error(code), { code }); };
export const outageRelationsBrowserSeed = Object.freeze({ ...m, otherActor: id(99) });
export function outageRelationsBrowserDeclaration(other = false): OutageDeclaration {
  return { kind: "declaration", id: other ? m.related : m.declaration, operationId: id(other ? 21 : 20), incidentId: id(other ? 51 : 50),
    workerId: m.worker, employeeId: m.employee, employeeAuthUserId: m.auth, workerVersion: 1, employeeVersion: 1, generation: 0,
    interval: { startAt: "2026-10-07T09:00:00.000000Z", endAt: "2026-10-07T10:00:00.000000Z", timeZone: "UTC", startOffsetMinutes: 0, endOffsetMinutes: 0 },
    statement: other ? "合成补充声明：与第一份相同纸面参考，不自动认定重复或合并。" : "合成负责人代录：<script>不会执行</script>；须逐份核对。",
    originalOperationId: null, originalChannel: null, paperReference: "QA-223-纸面参考", recordedBy: "owner", actorId: m.owner, actorEmployeeId: null, recordedAt: m.at };
}
export function createOutageRelationsBrowserModel() {
  type Stored = { query: OutageRelationsQuery; command: OutageRelationsCommand; entry: OutageRelationEntry; commandFingerprint: string };
  const rows: Stored[] = [], declarations = [outageRelationsBrowserDeclaration(), outageRelationsBrowserDeclaration(true)];
  const source: OutageRelationEvidence = { ...outageRelationsModelEvidence(), declarations: declarations.map(d => ({ declarationId: d.id,
    operationId: d.operationId, fingerprint: sha(JSON.stringify(d)) })) as OutageRelationEvidence["declarations"] };
  const sourceText = JSON.stringify(source), fingerprint = sha(sourceText);
  const rawEntry = (entry: OutageRelationEntry | null) => entry === null ? null : { ...entry, sourceText: entry.evidence === null ? null : sourceText };
  const summary = (entry: OutageRelationEntry) => { const { evidence: _evidence, ...rest } = entry; void _evidence; return rest; };
  const actorFor = (access: "owner" | "self") => access === "owner" ? m.owner : m.auth;
  const counters = { requests: 0, gets: 0, posts: 0, successfulWrites: 0, errors: 0 };
  const setupCounters = { requests: 0, gets: 0, posts: 0, successfulWrites: 0, errors: 0 };
  let identityChanged = false, preparing = false;
  function respond(input: { url: string; method: string; actor: string; body?: string; enabled: boolean }) {
    const count = preparing ? setupCounters : counters;
    count.requests++; if (input.method === "GET") count.gets++; else if (input.method === "POST") count.posts++;
    try {
      const url = new URL(input.url);
      if (url.pathname === OUTAGE_APIS.outages) {
        if (input.method !== "GET") failure("method_not_allowed");
        const q = parseOutageHttpQuery("outages", input.url);
        if (q.mode !== "declaration") return failure("attendance_access_denied");
        if (input.actor !== actorFor(q.access) || q.access === "self" && identityChanged) failure("attendance_access_denied");
        const declarationId = q.declarationId;
        const d = declarations.find(d => d.id === declarationId); if (!d) failure("attendance_outage_not_found");
        const data: OutageResult = { protocol: "attendance-outage-v1", siteId: q.siteId, access: q.access, mode: q.mode,
          actorId: input.actor, readAt: m.at, canWrite: false, items: [], detail: d!, nextId: null, receipt: null };
        if (q.siteId !== m.siteId) failure("attendance_access_denied");
        const wire = { ok: true, canWrite: false, data }; parseOutageHttpResponse("outages", wire, q, input.actor);
        return { status: 200, body: wire };
      }
      if (url.pathname !== OUTAGE_APIS.relations || !["GET", "POST"].includes(input.method)) failure("method_not_allowed");
      if (input.method === "POST" && url.search) failure("attendance_invalid_request");
      const parsed = input.method === "POST" ? parseOutageHttpBody("relations", input.body, input.actor) : null;
      const q = parsed?.query ?? parseOutageHttpQuery("relations", input.url), c = parsed?.command ?? null;
      if (q.siteId !== m.siteId || input.actor !== actorFor(q.access) || q.access === "self" && identityChanged) failure("attendance_access_denied");
      if (!declarations.some(d => d.id === q.declarationId) || q.mode !== "list" && !declarations.some(d => d.id === q.relatedDeclarationId)) failure("attendance_outage_relations_not_found");
      const head = rows.at(-1)?.entry ?? null, revision = head?.revision ?? 0;
      const base: OutageRelationsResult = { protocol: "attendance-outage-relations-v1", siteId: q.siteId, access: q.access, mode: q.mode,
        actorId: input.actor, declarationId: q.declarationId, relatedDeclarationId: q.mode === "list" ? null : q.relatedDeclarationId,
        readAt: m.at, canWrite: false, items: [], revision, current: null, preview: null, history: [], historyTruncated: false, receipt: null };
      let raw: unknown = base;
      const op = c?.operationId ?? (q.mode === "recover" ? q.operationId : null);
      let stored = op === null ? undefined : rows.find(row => row.command.operationId === op);
      if (stored) {
        if (q.mode === "list" || stored.query.mode !== "detail" || stored.query.declarationId !== q.declarationId || stored.query.relatedDeclarationId !== q.relatedDeclarationId
          || c && stored.commandFingerprint !== outageRelationsCommandFingerprint(q, c)) failure("attendance_operation_conflict");
      } else if (q.mode === "recover") failure("attendance_outage_relations_not_found");
      else if (c) {
        if (!input.enabled) failure("attendance_outage_relations_disabled");
        if (c.expectedRevision !== revision) failure("attendance_outage_relations_changed");
        if (revision >= 100 || c.action === "apply" && revision >= 99) failure("attendance_outage_relations_limit");
        if (c.action === "apply" && identityChanged) failure("attendance_outage_relations_blocked");
        if (c.expectedFingerprint !== (c.action === "apply" ? fingerprint : head?.fingerprint) || c.action === "revoke" && head?.action !== "apply") failure("attendance_outage_relations_changed");
        const entry: OutageRelationEntry = { pair: [m.declaration, m.related], operationId: c.operationId, revision: revision + 1, action: c.action,
          kind: c.action === "apply" ? c.kind : head!.kind, actorId: input.actor, reason: c.reason,
          evidence: c.action === "apply" ? source : null, fingerprint: c.expectedFingerprint, recordedAt: m.at };
        stored = { query: q, command: c, entry, commandFingerprint: outageRelationsCommandFingerprint(q, c) };
        rows.push(stored); count.successfulWrites++;
      }
      if (stored) raw = { ...base, revision: stored.entry.revision, receipt: { operationId: stored.entry.operationId,
        commandFingerprint: stored.commandFingerprint, entry: rawEntry(stored.entry) } };
      else if (q.mode === "list") raw = { ...base, revision: 0, items: head ? [summary(head)] : [] };
      else if (q.mode === "history") {
        const history = rows.filter(row => q.beforeRevision === null || row.entry.revision < q.beforeRevision).toReversed();
        raw = { ...base, history: history.slice(0, 25).map(row => summary(row.entry)), historyTruncated: history.length > 25 };
      } else {
        const blockers: OutageRelationPreview["blockers"] = [...(identityChanged ? ["identity_changed" as const] : []), ...(revision >= 99 ? ["revision_limit" as const] : [])];
        const eligible = blockers.length === 0;
        raw = { ...base, canWrite: q.access === "owner" && input.enabled && (eligible || head?.action === "apply" && revision < 100), current: rawEntry(head),
          preview: { evidence: identityChanged ? null : source, sourceText: identityChanged ? null : sourceText, fingerprint: identityChanged ? null : fingerprint, eligible, blockers } };
      }
      const data = projectOutageRelationsResult(raw, q, input.actor, c), wire = { ok: true, canWrite: input.enabled && q.access === "owner", data };
      parseOutageHttpResponse("relations", wire, q, input.actor, c);
      return { status: 200, body: wire };
    } catch (error) {
      count.errors++; const code = typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : "attendance_unavailable";
      return { status: OUTAGE_HTTP_ERRORS[code] ?? 503, body: { ok: false, error: Object.hasOwn(OUTAGE_HTTP_ERRORS, code) ? code : "attendance_unavailable" } };
    }
  }
  const summaries = () => rows.map(row => ({ operationId: row.entry.operationId, revision: row.entry.revision, action: row.entry.action, kind: row.entry.kind }));
  // Node-side fixture controls only: not an HTTP endpoint, browser hook or
  // product permission. They simulate a current eligibility change, NOT a real
  // Auth rebind. Existing declarations, commands and receipts remain immutable.
  const controls = Object.freeze({
    setIdentityChanged(value: boolean) {
      if (typeof value !== "boolean" || preparing) throw Error("outage_relations_fixture_invalid_control");
      identityChanged = value;
    },
    prepareHistory(throughRevision: number) {
      const fromRevision = rows.at(-1)?.entry.revision ?? 0;
      if (!Number.isInteger(throughRevision) || throughRevision < fromRevision || throughRevision > 98 || identityChanged || preparing) {
        throw Error("outage_relations_fixture_invalid_history");
      }
      const query: Extract<OutageRelationsQuery, { mode: "detail" }> = { siteId: m.siteId, access: "owner", mode: "detail", declarationId: m.declaration, relatedDeclarationId: m.related };
      const origin = "http://127.0.0.1:1", before = setupCounters.successfulWrites;
      preparing = true;
      try {
        // Each append executes the SAME strict input, CAS, digest, projector and
        // public parser path as HTTP. No row injection, history replacement or
        // assertion that these local setup commands were UI/HTTP/SQL actions.
        for (let next = fromRevision + 1; next <= throughRevision; next++) {
          const read = respond({ url: origin + OUTAGE_APIS.relations + "?" + outageHttpQueryString("relations", query), method: "GET", actor: m.owner, enabled: true });
          if (read.status !== 200) throw Error("outage_relations_fixture_history_read_failed");
          const current = parseOutageHttpResponse("relations", read.body, query, m.owner).result;
          const shared = { operationId: randomUUID(), expectedRevision: current.revision, reason: `纯内存准备历史 ${next}；不是 HTTP、界面或 SQL 写入。` };
          const command: OutageRelationsCommand = current.current?.action === "apply"
            ? { ...shared, action: "revoke", expectedFingerprint: current.current.fingerprint }
            : { ...shared, action: "apply", kind: next % 4 === 1 ? "possible_duplicate" : "complementary", expectedFingerprint: current.preview!.fingerprint! };
          const written = respond({ url: origin + OUTAGE_APIS.relations, method: "POST", actor: m.owner, enabled: true, body: JSON.stringify({ query, command }) });
          if (written.status !== 200) throw Error("outage_relations_fixture_history_write_failed");
          const receipt = parseOutageHttpResponse("relations", written.body, query, m.owner, command).result.receipt;
          if (receipt?.entry.revision !== next) throw Error("outage_relations_fixture_history_revision");
        }
        return { fromRevision, throughRevision, setupWrites: setupCounters.successfulWrites - before, rows: summaries() };
      } finally { preparing = false; }
    },
  });
  return { respond, controls, snapshot: () => ({ syntheticAuth: true, realAuth: false, realSql: false, identityChanged, ...counters,
    setupRequests: setupCounters.requests, setupGets: setupCounters.gets, setupPosts: setupCounters.posts, setupWrites: setupCounters.successfulWrites, setupErrors: setupCounters.errors,
    rows: summaries() }) };
}
