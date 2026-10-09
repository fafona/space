import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parsePeriodClosureArtifact, parsePeriodClosureHttpQuery, type PeriodClosureArtifact,
  type PeriodClosureCommand, type PeriodClosureQuery } from "./merchantAttendancePeriodClosure";
import { executePeriodClosures, projectPeriodClosureSource } from "./merchantAttendancePeriodClosure.server";
import { AttendancePeriodClosureClient, periodClosureCanSendPreview, type PeriodClosureStorage } from "./merchantAttendancePeriodClosureClient";
import { buildPeriodClosureOutput, PeriodClosureSavedReport, periodClosureSavedContext } from "../components/enterprise/MerchantAttendancePeriodClosureWorkspace";
import { periodClosureUiArtifact, periodClosureUiHttp, periodClosureUiQuery,
  periodClosureUiId as id, periodClosureUiOwner as owner, periodClosureUiEmployee as employee,
  periodClosureUiPeriod as period, periodClosureUiOperation as operation } from "../../scripts/fixtures/attendance-period-closure-ui-model";
import { scheduleEvidenceMissing, scheduleEvidenceWire } from "../../scripts/fixtures/attendance-schedule-evidence-model";

const sha = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const query = periodClosureUiQuery();
// Collector-shaped synthetic data, NOT a claim that an SQL write was executed.
// A is the current approved report row. B only proposes replacing A outside
// this period and remains a pending context entry, never an approved report row.
function sourceRaw(withPending = true) {
  const report = scheduleEvidenceWire({ empty: true }).attendance, previous = periodClosureUiArtifact();
  const approved = scheduleEvidenceMissing(); report.missing = [approved];
  const parent = { requestId: approved.requestId, operationId: approved.operationId, revision: 2, status: "approved",
    startAt: approved.proposal.startAt, endAt: approved.proposal.endAt, recordedAt: approved.approvedAt,
    supersedesRequestId: null, rootRequestId: approved.requestId, isCurrentApproved: true };
  const child = { requestId: id(70001), operationId: id(70001), revision: 1, status: "submitted",
    startAt: "2026-09-04T08:00:00.000000Z", endAt: "2026-09-04T16:00:00.000000Z", recordedAt: "2026-09-10T08:00:00.000001Z",
    supersedesRequestId: parent.requestId, rootRequestId: parent.requestId, isCurrentApproved: false };
  const context = { pendingCorrections: [], missing: withPending ? [parent, child] : [parent], leave: [], calendar: [],
    plans: { items: [], sessions: [] }, reviews: [] };
  const base = structuredClone(report.base) as unknown as Record<string, unknown>; delete base.asOf;
  const canonical = { sourceVersion: "attendance-period-source-v1", siteId: query.siteId, workerId: query.workerId,
    employeeId: previous.worker.employeeId, employeeAuthUserId: previous.worker.employeeAuthUserId,
    timeZone: "UTC", fromDate: query.fromDate, throughDate: query.throughDate, fromAt: report.base.fromAt, toAt: report.base.toAt,
    dayBoundaries: previous.dayBoundaries, context,
    report: { version: report.version, base, missing: report.missing.map(row => ({ ...row, employeeId: previous.worker.employeeId })), complete: true, payrollReady: false } };
  const sourceText = JSON.stringify(canonical);
  return { ...canonical, report, sourceCanonical: canonical, sourceText, sourceFingerprint: sha(sourceText),
    readAt: report.base.asOf, blockers: withPending ? ["pending_missing"] : [], complete: true, validation: "owner_checked" };
}
function projected(withPending = true) { return projectPeriodClosureSource(sourceRaw(withPending), query); }

// Parse exact emitted CSV records (all cells quoted), including embedded CRLF,
// commas and doubled quotes. Never identify context by substring occurrence.
function csvRows(csv: string): string[][] {
  const text = csv.replace(/^\ufeff/, ""), rows: string[][] = []; let offset = 0, row: string[] = [];
  while (offset < text.length) {
    assert.equal(text[offset++], '"'); let cell = "", closed = false;
    while (offset < text.length) { const c = text[offset++]; if (c !== '"') { cell += c; continue; }
      if (text[offset] === '"') { cell += '"'; offset++; } else { closed = true; break; } }
    assert(closed); row.push(cell);
    if (text[offset] === ",") { offset++; continue; }
    assert.equal(text.slice(offset, offset + 2), "\r\n"); offset += 2; rows.push(row); row = [];
  }
  assert.equal(row.length, 0); return rows;
}
function printRows(html: string): string[][] {
  const decode = (text: string) => text.replace(/&(?:amp|lt|gt|quot|#39);/g,
    entity => ({ "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'" })[entity]!);
  return [...html.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map(row => [...row[1].matchAll(/<t[dh]>([\s\S]*?)<\/t[dh]>/g)].map(cell => decode(cell[1])));
}
function checkContextRows(rows: string[][], artifact: PeriodClosureArtifact) {
  const context = rows.filter(row => row[0] === "保存上下文完整证据");
  const entries = periodClosureSavedContext(artifact); assert.equal(context.length, entries.length);
  for (const entry of entries) {
    const matches = context.filter(row => row[3] === entry.key); assert.equal(matches.length, 1);
    assert.equal(matches[0][1], entry.title); assert.equal(matches[0][2], "1");
    assert.deepEqual(JSON.parse(matches[0][10]), entry.value);
  }
}

test("period-outside pending child changes saved context/fingerprint, not A's approved totals or report", () => {
  const before = projected(false), after = projected(), raw = sourceRaw(), [parent, child] = raw.context.missing;
  assert(child.startAt >= after.artifact.period.endAt); assert.equal(child.supersedesRequestId, parent.requestId);
  assert.deepEqual(after.artifact.report, before.artifact.report);
  assert.equal(after.artifact.report.missing.length, 1); assert.equal(after.artifact.report.missing[0].requestId, parent.requestId);
  assert.equal(after.artifact.report.totals.missingSelected.workedUs, 8 * 60 * 60 * 1_000_000);
  assert.deepEqual(after.blockers, ["pending_missing"]); assert.notEqual(after.artifact.sourceFingerprint, before.artifact.sourceFingerprint);
  assert.deepEqual(after.artifact.source.context, raw.context);
  assert.deepEqual(parsePeriodClosureArtifact(after.artifact), after.artifact);
});

test("projection binds the added child to exact canonical bytes instead of accepting independent context substitution", () => {
  const raw = sourceRaw(); raw.context = { ...raw.context, missing: [raw.context.missing[0]] };
  assert.throws(() => projectPeriodClosureSource(raw, query), /attendance_period_closure_invalid/);
  const changed = sourceRaw(); changed.sourceFingerprint = sourceRaw(false).sourceFingerprint;
  assert.throws(() => projectPeriodClosureSource(changed, query), /attendance_period_closure_invalid/);
});

test("fixed CSV and print retain A and the complete outside child in the missing context, never as approved B", () => {
  const { artifact } = projected(), context = sourceRaw().context, file = buildPeriodClosureOutput(artifact, period, 1);
  for (const rows of [csvRows(file.csv), printRows(file.html)]) {
    checkContextRows(rows, artifact);
    const approved = rows.filter(row => row[0] === "已批准整段漏卡"); assert.equal(approved.length, 1);
    assert.equal(approved[0][1], context.missing[0].requestId);
    assert(!approved.some(row => row[1] === context.missing[1].requestId));
    assert.equal(rows.find(row => row[0] === "来源指纹")?.[1], artifact.sourceFingerprint);
  }
  const html = renderToStaticMarkup(<PeriodClosureSavedReport artifact={artifact}/>);
  assert.match(html, /整段漏卡及最新修订/); assert.match(html, /2 项/);
  assert.match(html, /批准整段漏卡 1 条/); assert.match(html, /均为该版本保存值/);
});

test("pre-fix and new saved artifacts stay readable/output-identical without current Intl or recalculation", () => {
  const artifacts = [projected(false).artifact, projected().artifact];
  const outputs = artifacts.map(a => buildPeriodClosureOutput(a, period, 1));
  const descriptor = Object.getOwnPropertyDescriptor(Intl, "DateTimeFormat")!;
  try {
    Object.defineProperty(Intl, "DateTimeFormat", { ...descriptor, value: function () { throw Error("current_timezone_must_not_run"); } });
    for (let n = 0; n < artifacts.length; n++) {
      const parsed = parsePeriodClosureArtifact(structuredClone(artifacts[n]));
      assert.deepEqual(parsed, artifacts[n]); assert.deepEqual(buildPeriodClosureOutput(parsed, period, 1), outputs[n]);
      assert.match(renderToStaticMarkup(<PeriodClosureSavedReport artifact={parsed}/>), /以下仅显示保存值/);
    }
  } finally { Object.defineProperty(Intl, "DateTimeFormat", descriptor); }
});

test("fixed-version service export reads stored bytes without calling the revised source collector", async () => {
  for (const withPending of [false, true]) {
    const q = periodClosureUiQuery("export"), http = periodClosureUiHttp(q); assert.equal(http.data.kind, "detail");
    if (http.data.kind !== "detail") throw Error("fixture");
    http.data.artifact = projected(withPending).artifact;
    const artifactText = JSON.stringify(http.data.artifact), calls: string[] = [];
    const data = await executePeriodClosures({ query: q, authUserId: owner }, { rpc: async (name, args) => {
      calls.push(name); assert.deepEqual(args.p_query, q); assert.equal(args.p_command, null);
      return { data: { ...http.data, artifactText, artifactBytes: Buffer.byteLength(artifactText), artifactSha256: sha(artifactText) }, error: null };
    } });
    assert.deepEqual(calls, ["faolla_attendance_period_closure_v1"]);
    assert.equal(data.kind, "detail"); if (data.kind === "detail") assert.deepEqual(data.artifact, http.data.artifact);
  }
});

test("client permits explicit review send and employee confirmation of the same saved pending-child version", async () => {
  const { artifact, blockers } = projected(); assert.equal(periodClosureCanSendPreview(blockers), true);
  assert.equal(periodClosureCanSendPreview([...blockers, "period_in_progress"]), false);
  for (const access of ["owner", "self"] as const) {
    const values = new Map<string, string>(), calls: { query: PeriodClosureQuery; command: PeriodClosureCommand | null }[] = [];
    const storage: PeriodClosureStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); }, removeItem: key => { values.delete(key); } };
    let ids = 0;
    const client = new AttendancePeriodClosureClient({ ...query, access, actorId: access === "owner" ? owner : employee,
      enabled: true, storage: () => storage, randomId: () => ids++ === 0 ? operation : period,
      apiFetch: async (url, init = {}) => {
        const body = init.method === "POST" ? JSON.parse(String(init.body)) as { query: PeriodClosureQuery; command: PeriodClosureCommand } : null;
        const q = body?.query ?? parsePeriodClosureHttpQuery(`https://fixture.invalid${url}`), command = body?.command ?? null;
        calls.push({ query: q, command }); const reply = periodClosureUiHttp(q, command);
        if (reply.data.kind === "preview") reply.data.preview = { ...reply.data.preview, artifact, blockers };
        if (reply.data.kind === "detail") {
          reply.data.artifact = artifact;
          for (const entry of reply.data.history) if (entry.command.expectedFingerprint !== null) entry.command.expectedFingerprint = artifact.sourceFingerprint;
        }
        return new Response(JSON.stringify(reply), { headers: { "content-type": "application/json" } });
      } });
    await client.initialize();
    if (access === "owner") await client.preview(); else await client.detail(period);
    await client.submit(access === "owner" ? "send" : "confirm", "Review pending child, not approval of its proposed hours");
    assert.equal(calls.length, 2); assert.equal(calls[0].command, null);
    assert.equal(calls[1].command?.action, access === "owner" ? "send" : "confirm");
    assert.equal(calls[1].command?.expectedFingerprint, artifact.sourceFingerprint);
    assert.equal(client.getSnapshot().phase, "ready"); assert.equal(client.getSnapshot().pending, null);
  }
});

test("SQL contract, not a stubbed success, retains send/confirm versus fresh owner seal blocker distinction", () => {
  // Static protection complements the independent native 103→152→149 test;
  // it does not claim that a database transaction ran in this pure suite.
  const sql = readFileSync(new URL("../../scripts/supabase-migrations/202610050149_merchant_attendance_period_closure.sql", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const begin = sql.indexOf("if action_name='send' then"), end = sql.indexOf("else\n      select * into v", begin);
  assert(begin >= 0 && end > begin); const send = sql.slice(begin, end);
  assert.match(send, /if source_result->'blockers' \? 'period_in_progress' then raise exception 'attendance_period_blocked'/);
  const validation = sql.slice(sql.indexOf("if action_name in('confirm','seal') then"), sql.indexOf("elsif action_name='dispute' then"));
  assert.match(validation, /source_result:=public\.faolla_attendance_period_source_v1\(source_query,p_auth_user_id\)/);
  assert.match(validation, /source_result->'sourceCanonical' is distinct from artifact_json->'source'/);
  assert.match(validation, /if action_name='confirm' then c\.confirmed_version:=c\.current_version/);
  assert.match(validation, /source_result->>'validation' is distinct from 'owner_checked' or source_result->'blockers' is distinct from '\[\]'::jsonb then raise exception 'attendance_period_blocked'/);
});
