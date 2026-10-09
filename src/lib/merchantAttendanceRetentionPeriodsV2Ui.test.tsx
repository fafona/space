import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Picker, { handoffRetentionPeriodArtifact, retentionPeriodsV2Fetch } from "../components/enterprise/MerchantAttendanceRetentionPeriodsV2Picker";
import { AttendanceRetentionPeriodsV2Client, type RetentionPeriodArtifactSelection } from "./merchantAttendanceRetentionPeriodsV2Client";
import { parsePeriodClosureV2HttpQuery, parsePeriodClosureV2Response, type PeriodClosureV2Query } from "./merchantAttendancePeriodClosureV2";

// Protocol-only synthetic identities and replies. These tests do not run a browser, Auth or SQL.
const id = (n: number) => `23710000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const siteId = "99990001", actorId = id(1), workerId = id(2), periodId = id(3);
const fromDate = "2026-09-02", throughDate = fromDate, hash = "a".repeat(64), readAt = "2026-10-08T10:00:00.000000Z";
const scope = { siteId, actorId, workerId, fromDate, throughDate, enabled: true, isCurrentAuth: () => true };
const noop = () => {};
const code = () => readFileSync(new URL("../components/enterprise/MerchantAttendanceRetentionPeriodsV2Picker.tsx", import.meta.url), "utf8");
const selected = Object.freeze({ siteId, actorId, workerId, employeeId: id(4), employeeAuthUserId: id(5), periodId,
  fromDate: "2026-09-01", throughDate: "2026-09-03", version: 21, artifactId: id(6), sourceFingerprint: hash, artifactSha256: "b".repeat(64) });
function fakeClient(onSelect = () => selected as RetentionPeriodArtifactSelection | null) {
  let snapshot: ReturnType<AttendanceRetentionPeriodsV2Client["getSnapshot"]> = {
    phase: "idle", query: null, result: null, selectedPeriod: null, message: "Synthetic fixture",
  };
  let pauses = 0, selections = 0;
  return { client: { getSnapshot: () => snapshot, selectVersion: () => { selections++; return onSelect(); },
    pause: () => { pauses++; snapshot = { ...snapshot }; } },
    replace: () => { snapshot = { ...snapshot }; }, counts: () => ({ pauses, selections }) };
}
function wire(q: PeriodClosureV2Query) {
  const period = { workerId, employeeId: id(4), employeeAuthUserId: id(5), workerName: "Synthetic worker", workerNo: "TEST",
    fromDate: "2026-09-01", throughDate: "2026-09-03", timeZone: "UTC", startAt: "2026-09-01T00:00:00.000000Z", endAt: "2026-09-04T00:00:00.000000Z",
    periodId, revision: 101, currentVersion: 21, state: "review", sealed: false, confirmedVersion: null, unresolvedDispute: false };
  const common = { protocol: "period-closure-v2", siteId, workerId, actorId, access: "owner", readAt };
  const start = q.cursor?.kind === "versions" ? q.cursor.beforeVersion - 1 : 21;
  const data = q.mode === "list" ? { ...common, kind: "list", items: [{ ...period, openedAt: "2026-09-04T00:00:00.000000Z" }], nextCursor: null }
    : { ...common, kind: "versions", period, items: Array.from({ length: Math.min(start, 20) }, (_, offset) => ({
      version: start - offset, operationId: id(100 + start - offset), recordedAt: readAt, artifactId: id(6), sourceFingerprint: hash,
      artifactBytes: 1024, artifactSha256: "b".repeat(64),
    })), nextCursor: start > 20 ? { kind: "versions", siteId, access: "owner", workerId, periodId,
      fromDate: period.fromDate, throughDate: period.throughDate, atVersion: 21, beforeVersion: 2 } : null };
  const value = { ok: true, moduleEnabled: true, data };
  parsePeriodClosureV2Response(value, q, { ownerId: actorId });
  return new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
}

test("actual picker SSR is local-only and advertises discovery, not retention writes", () => {
  let calls = 0;
  for (const enabled of [true, false]) {
    const html = renderToStaticMarkup(<Picker {...scope} enabled={enabled} apiFetch={async () => { calls++; throw Error("unexpected request"); }} onSelect={noop} onClose={noop}/>);
    assert.match(html, /按长期周期／版本查找归档/); assert.match(html, /不试算整期、不删除或保全/);
    assert.match(html, /返回保留资料/); assert.doesNotMatch(html, />(?:读取此周期版本|核对本条归档)<\/button>/);
  }
  assert.equal(calls, 0);
});

test("invalid constructor scope still has a return path and never requests", () => {
  let calls = 0;
  const html = renderToStaticMarkup(<Picker {...scope} siteId="invalid" apiFetch={async () => { calls++; throw Error("unexpected request"); }} onSelect={noop} onClose={noop}/>);
  assert.match(html, /人员、身份或日期范围无效/); assert.match(html, /返回保留资料/); assert.equal(calls, 0);
});

test("render fence fetch rejects expired scope before invoking the requester", async () => {
  let calls = 0;
  const fetch = retentionPeriodsV2Fetch(async () => { calls++; return new Response("unused"); }, () => false);
  await assert.rejects(fetch("/synthetic"), /identity_changed/); assert.equal(calls, 0);
});

test("render fence cancels a late unread response", async () => {
  let live = true, finish!: (response: Response) => void, cancelled = 0;
  const fetch = retentionPeriodsV2Fetch(async () => new Promise<Response>(resolve => { finish = resolve; }), () => live);
  const request = fetch("/synthetic"); live = false;
  finish(new Response(new ReadableStream({ cancel: () => { cancelled++; } })));
  await assert.rejects(request, /identity_changed/); assert.equal(cancelled, 1);
});

test("handoff requires a current ready-page selection and never invents one", () => {
  const blocked = fakeClient(), absent = fakeClient(() => null); let calls = 0;
  assert.equal(handoffRetentionPeriodArtifact(blocked.client, 21, () => false, () => { calls++; }), false);
  assert.equal(handoffRetentionPeriodArtifact(absent.client, 999, () => true, () => { calls++; }), false);
  assert.deepEqual(blocked.counts(), { pauses: 0, selections: 0 });
  assert.deepEqual(absent.counts(), { pauses: 0, selections: 1 }); assert.equal(calls, 0);
});

test("handoff rejects an observer replacing the snapshot during selection", () => {
  const f = fakeClient(() => { f.replace(); return selected; }); let calls = 0;
  assert.equal(handoffRetentionPeriodArtifact(f.client, 21, () => true, () => { calls++; }), false);
  assert.equal(calls, 0); assert.equal(f.counts().pauses, 0);
});

test("handoff rechecks scope after selection and after synchronous pause observers", () => {
  let live = true, calls = 0;
  const selectedChanged = fakeClient(() => { live = false; return selected; });
  assert.equal(handoffRetentionPeriodArtifact(selectedChanged.client, 21, () => live, () => { calls++; }), false);
  live = true;
  const pausedChanged = fakeClient(), client = { ...pausedChanged.client, pause: () => { pausedChanged.client.pause(); live = false; } };
  assert.equal(handoffRetentionPeriodArtifact(client, 21, () => live, () => { calls++; }), false);
  assert.equal(calls, 0); assert.equal(pausedChanged.counts().pauses, 1);
});

test("successful handoff pauses before delivery and keeps exact saved metadata", () => {
  const f = fakeClient(); let value: RetentionPeriodArtifactSelection | null = null;
  assert.equal(handoffRetentionPeriodArtifact(f.client, 21, () => true, selection => {
    assert.equal(f.counts().pauses, 1); value = selection;
  }), true);
  assert.equal(value, selected); assert(Object.isFrozen(value));
});

test("actual client and UI handoff keep intersecting saved dates, revision101/version21 and a reused artifact", async () => {
  const queries: PeriodClosureV2Query[] = [];
  const client = new AttendanceRetentionPeriodsV2Client({ ...scope, apiFetch: async (url, init) => {
    assert.equal(init?.method, "GET"); const q = parsePeriodClosureV2HttpQuery(new URL(String(url), "http://127.0.0.1").href);
    queries.push(q); return wire(q);
  } });
  assert.equal(queries.length, 0); await client.list(); await client.openPeriod(periodId);
  assert.equal(client.getSnapshot().phase, "ready");
  assert.deepEqual(queries.map(q => [q.mode, q.fromDate, q.throughDate]), [["list", fromDate, throughDate], ["versions", "2026-09-01", "2026-09-03"]]);
  assert.equal(client.selectVersion(21)?.artifactId, client.selectVersion(20)?.artifactId);
  await client.nextVersions(); assert.equal(queries.length, 3); assert.equal(client.selectVersion(21), null);
  let value: RetentionPeriodArtifactSelection | null = null;
  assert.equal(handoffRetentionPeriodArtifact(client, 1, () => true, selection => { value = selection; }), true);
  assert.deepEqual(value, { ...selected, version: 1 }); assert.equal(queries.length, 3);
  assert.equal(client.getSnapshot().result, null); client.dispose();
});

test("actual client cannot hand off after synchronous Auth invalidation", async () => {
  let live = true, calls = 0;
  const client = new AttendanceRetentionPeriodsV2Client({ ...scope, isCurrentAuth: () => live,
    apiFetch: async url => wire(parsePeriodClosureV2HttpQuery(new URL(String(url), "http://127.0.0.1").href)) });
  await client.list(); await client.openPeriod(periodId); live = false;
  assert.equal(handoffRetentionPeriodArtifact(client, 21, () => live, () => { calls++; }), false);
  assert.equal(calls, 0); client.dispose();
});

test("component integrates every scope fence and explicit page/selection API", () => {
  const text = code();
  assert.match(text, /JSON\.stringify\(\[siteId, actorId, workerId, fromDate, throughDate, enabled\]\)/);
  assert.match(text, /live\.current\.fetch !== apiFetch \|\| live\.current\.auth !== checkAuth/);
  assert.match(text, /token: live\.current\.token \+ 1/); assert.match(text, /<Prepared key=\{token\}/);
  for (const method of ["list()", "nextPeriods()", "openPeriod(period.periodId)", "nextVersions()"]) assert(text.includes(`client.${method}`));
  assert.match(text, /handoffRetentionPeriodArtifact\(client, version\.version, current, onSelect\)/);
  assert.doesNotMatch(text, /localStorage|sessionStorage|randomUUID|method:\s*["']POST|client\.initialize|client\.load|client\.submit|client\.recover/);
});

test("hide/pagehide and external leave pause reads; show and return never auto-fetch", () => {
  const text = code();
  assert.match(text, /const leave = useCallback\(\(\) => \{ client\.pause\(\); return true; \}/);
  assert.match(text, /registerLeaveGuard\?\.\(leave\)/); assert.match(text, /registerLeaveGuard\?\.\(null\)/);
  assert.match(text, /const hide = \(\) => \{ client\.pause\(\); setShown\(false\); \}/);
  assert.match(text, /const eventHide = \(\) => flushSync\(hide\)/);
  assert.match(text, /const show = \(\) => \{ if \(isCurrent\(\) && !document\.hidden\) setShown\(true\); \}/);
  assert.match(text, /if \(isCurrent\(\) && leave\(\)\) onClose\(\)/);
  for (const event of ["visibilitychange", "pagehide", "pageshow"]) assert(text.includes(`removeEventListener("${event}"`));
  assert.match(text, /max-w-full whitespace-normal break-words/); assert.match(text, /data-period-id=/); assert.match(text, /data-artifact-id=/);
});
