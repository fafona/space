import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Launcher from "../components/enterprise/MerchantAttendanceRuleCaptureHistoryLauncher";
import Panel, { RuleCaptureHistoryEvidence } from "../components/enterprise/MerchantAttendanceRuleCaptureHistoryPanel";
import { parseRuleCaptureHistoryResponse, type RuleCaptureHistoryResponse } from "./merchantAttendanceRuleCaptureHistory";
import { ruleCaptureHistoryQuery as query, ruleCaptureHistoryResult } from "../../scripts/fixtures/attendance-rule-capture-history-model";
import { ruleSourcesOwner } from "../../scripts/fixtures/attendance-rule-sources-model";

const apiFetch = async (): Promise<Response> => { throw Error("SSR must not request network"); };
const props = { siteId: query.siteId, ownerId: ruleSourcesOwner, workerId: query.workerId, apiFetch };
const response = (count = 2, next = false, enabled = true) => parseRuleCaptureHistoryResponse({ ok: true, moduleEnabled: enabled, data: ruleCaptureHistoryResult(count, next) }, query, ruleSourcesOwner);
const evidence = (result: RuleCaptureHistoryResponse = response(), disabled = false) => renderToStaticMarkup(createElement(RuleCaptureHistoryEvidence, { result, disabled, onSelect: () => {} }));
const panelSource = () => readFileSync(new URL("../components/enterprise/MerchantAttendanceRuleCaptureHistoryPanel.tsx", import.meta.url), "utf8");
const launcherSource = () => readFileSync(new URL("../components/enterprise/MerchantAttendanceRuleCaptureHistoryLauncher.tsx", import.meta.url), "utf8");
const count = (text: string, term: string) => text.split(term).length - 1;

test("history feature is independently exact-one/default-off, inactive-safe and initially closed", () => {
  const key = "NEXT_PUBLIC_FAOLLA_ATTENDANCE_RULE_CAPTURE_HISTORY_ENABLED", previous = process.env[key];
  try {
    for (const value of [undefined, "0", "true", " 1"]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
      assert.equal(renderToStaticMarkup(createElement(Launcher, props)), "");
    }
    process.env[key] = "1";
    assert.equal(renderToStaticMarkup(createElement(Launcher, { ...props, active: false })), "");
    assert.equal(renderToStaticMarkup(createElement(Launcher, { ...props, enabled: false })), "");
    const html = renderToStaticMarkup(createElement(Launcher, props));
    assert.match(html, /候选留存历史（只读）/); assert.doesNotMatch(html, /<dialog|data-rule-capture-history-result|读取历史首页/);
  } finally { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; }
});

test("panel is empty and request-free until an explicit first read", () => {
  const html = renderToStaticMarkup(createElement(Panel, { ...props, onClose: () => {} }));
  assert.match(html, /单员工候选留存历史/); assert.match(html, /disabled="">读取历史首页/); assert.match(html, /关闭候选留存历史/);
  assert.match(html, /每页最多 25 条/); assert.match(html, /role="status"/);
  assert.doesNotMatch(html, /data-rule-capture-history-result|data-rule-capture-result|读取原留存|<input|<form|Synthetic archive worker/);
});

test("history context preserves exact authorized identities, status, cutoff and microsecond read time", () => {
  const value = response(), before = structuredClone(value), html = evidence(value);
  for (const text of [value.siteId, value.actorId, value.workerId, value.employeeId, value.employeeAuthUserId, value.workerName, value.workerNo, value.asOf, value.readAt]) assert(html.includes(text), text);
  assert.match(html, /档案启用 · 员工启用/); assert.match(html, /时间截止值不是事务快照/);
  assert.match(html, /当前负责人、当前考勤档案及当前员工双身份/); assert.deepEqual(value, before);
});

test("each listed operation has an explicit accessible detail action and complete metadata, not source bytes", () => {
  const value = response(), html = evidence(value);
  assert.equal(count(html, "data-rule-capture-history-item="), 2); assert.equal(count(html, ">读取原留存</button>"), 2);
  for (const item of value.items) {
    assert(html.includes(`aria-label="留存操作 ${item.operationId}"`));
    for (const text of [item.operationId, item.sourceId, item.command.reason, item.command.fromDate, item.command.throughDate, item.actorId,
      item.observedAt, item.recordedAt, item.sourceReadAt, item.sourceSha256, String(item.sourceBytes)]) assert(html.includes(text), text);
  }
  assert.match(html, /列表摘要尚未重新核验/); assert.match(html, /内容摘要不是签名/); assert.match(html, /读取原留存后才核验来源字节及与本行的一致性/);
  assert.doesNotMatch(html, /sourceText|<pre|<table|<iframe|<form|data-three-layer-segment/);
});

test("a full page renders exactly 25 metadata rows without inventing a total history count", () => {
  const html = evidence(response(25, true)); assert.equal(count(html, "data-rule-capture-history-item="), 25);
  assert.match(html, /本页留存记录 · 25 条/); assert.doesNotMatch(html, /全部历史 25|共 25 条历史|总计|第 1 \/ 2/);
});

test("empty page means no current-owner/current-dual-identity matches, not absence of all history", () => {
  const html = evidence(response(0)); assert.match(html, /本页未找到符合当前负责人和当前员工双身份的记录/);
  assert.match(html, /不代表其他负责人、其他身份或全部历史都没有留存/); assert.doesNotMatch(html, /data-rule-capture-history-item|读取原留存/);
});

test("paused and inactive records stay readable without accidentally offering writes", () => {
  const value = response(2, false, false); value.workerActive = false; value.employeeActive = false;
  const html = evidence(value); assert.match(html, /档案停用 · 员工停用/); assert.match(html, /新考勤模块已暂停/);
  assert.equal(count(html, ">读取原留存</button>"), 2); assert.doesNotMatch(html, /disabled=|确认留存|原编号核对并重试|核准个人/);
});

test("loading disables current row selection without a second automatic detail request", () => {
  const html = evidence(response(), true); assert.equal(count(html, 'disabled=""'), 2);
  assert.match(panelSource(), /disabled=\{busy\} onSelect=/);
});

test("worker names and stored reasons are escaped instead of parsed as HTML", () => {
  const value = response(), payload = '<img src=x onerror="alert(1)">'; value.workerName = payload; value.items[0].command.reason = payload;
  const html = evidence(value); assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/); assert.doesNotMatch(html, /<img|<script/);
});

test("read-only UI lifecycle has no auto-read, storage, confirmations, polling or write controls", () => {
  // Static lifecycle contract only; actual DOM acceptance is a separate harness.
  const panel = panelSource(), effect = panel.split("useLayoutEffect(() => {")[1].split("}, [client]);")[0];
  assert.doesNotMatch(effect, /client\.(firstread|next|select)\(/); assert.match(effect, /flushSync\(hide\)/);
  for (const event of ["visibilitychange", "pagehide"]) { assert(effect.includes(`addEventListener("${event}"`)); assert(effect.includes(`removeEventListener("${event}"`)); }
  assert.match(effect, /return \(\) => \{ client\.pause\(\)/); assert.match(panel, /binding\.apiFetch !== props\.apiFetch/);
  assert.equal(count(panel, "client.firstread("), 1); assert.equal(count(panel, "client.next("), 1); assert.equal(count(panel, "client.select("), 1);
  assert.match(panel, /RuleCaptureReceipt result=\{detail\}/); assert.match(panel, /const close = \(\) => \{ client\.pause\(\); onClose\(\); \}/);
  assert.doesNotMatch(panel + launcherSource(), /sessionStorage|localStorage|JSON\.stringify|sourceText|setInterval|window\.confirm|\.capture\(|\.retry\(|\.approve\(|\.publish\(/);
});

test("native modal closes through Escape/native close and fits small viewport without global state", () => {
  const launcher = launcherSource(); assert.match(launcher, /lazy\(\(\) => import\("\.\/MerchantAttendanceRuleCaptureHistoryPanel"\)\)/);
  assert.match(launcher, /dialog\.showModal\(\)/); assert.match(launcher, /if \(dialog\.open\) dialog\.close\(\)/);
  assert.match(launcher, /onCancel=\{event => \{ event\.preventDefault\(\); setOpen\(false\); \}\}/); assert.match(launcher, /onClose=\{\(\) => setOpen\(false\)\}/);
  assert.match(launcher, /maxWidth: "calc\(100vw - 1rem\)"/); assert.match(launcher, /maxHeight: "calc\(100dvh - 1rem\)"/); assert.match(launcher, /overflowY: "auto"/);
  assert.match(panelSource(), /grid min-w-0 gap-3[^"]*sm:grid-cols-2/);
});

test("new Admin entry is a separate disabled-by-default worker launcher on the authorization epoch", () => {
  // Source contract only, not a full parent business-path acceptance claim.
  const admin = readFileSync(new URL("../components/enterprise/MerchantAttendanceAdminPanel.tsx", import.meta.url), "utf8");
  const entries = [...admin.matchAll(/<RuleCaptureHistoryLauncher\b[\s\S]*?\/>/g)]; assert.equal(entries.length, 1);
  for (const text of ['key={`rule-capture-history:${state.authorizationEpoch}`}', 'siteId={siteId}', 'ownerId={ownerId}', 'workerId={item.id}', 'apiFetch={apiFetch}', '!busy', '!state.pending', '!editor', 'state.phase === "ready"', '!exceptionOpen', '!correctionReviewOpen', '!correctionControlsOpen', '!revisionApprovalOpen', '!(timesheetEnabled && timesheetOpen)']) assert(entries[0][0].includes(text), text);
  assert.doesNotMatch(entries[0][0], /\benabled\s*=/); assert.match(admin, /view === "workers" && !chooser && "workerNo" in item && <RuleCaptureHistoryLauncher/);
});
