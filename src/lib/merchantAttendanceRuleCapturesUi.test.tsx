import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Launcher from "../components/enterprise/MerchantAttendanceRuleCapturesLauncher";
import Panel, { capturePreflightEligible, captureUiConfirmationCurrent, checkedCaptureReason, RuleCapturePending, RuleCapturePreflight, RuleCaptureReceipt, validCaptureUiOperationId } from "../components/enterprise/MerchantAttendanceRuleCapturesPanel";
import { parseRuleSourcesResponse, type RuleSourcesResponse } from "./merchantAttendanceRuleSources";
import { parseCompactRuleCaptureResponse, type CompactRuleCaptureResponse } from "./merchantAttendanceRuleCapturesBrowser";
import { ruleSourcesOwner, ruleSourcesPopulated, ruleSourcesQuery } from "../../scripts/fixtures/attendance-rule-sources-model";
import { ruleCapturesQuery, ruleCapturesResult } from "../../scripts/fixtures/attendance-rule-captures-model";

const apiFetch = async (): Promise<Response> => { throw Error("SSR must not request the network"); };
const props = { siteId: ruleSourcesQuery.siteId, ownerId: ruleSourcesOwner, workerId: ruleSourcesQuery.workerId, apiFetch };
const source = (): RuleSourcesResponse => parseRuleSourcesResponse({ ok: true, moduleEnabled: true, data: ruleSourcesPopulated() }, ruleSourcesQuery, ruleSourcesOwner);
const compact = () => parseCompactRuleCaptureResponse({ ok: true, moduleEnabled: true, data: ruleCapturesResult() }, ruleCapturesQuery, ruleSourcesOwner);
const preflight = (value = source()) => renderToStaticMarkup(createElement(RuleCapturePreflight, { source: value }));
const receipt = (value: CompactRuleCaptureResponse) => renderToStaticMarkup(createElement(RuleCaptureReceipt, { result: value }));
const count = (text: string, term: string) => text.split(term).length - 1;
const panelSource = () => readFileSync(new URL("../components/enterprise/MerchantAttendanceRuleCapturesPanel.tsx", import.meta.url), "utf8");
const launcherSource = () => readFileSync(new URL("../components/enterprise/MerchantAttendanceRuleCapturesLauncher.tsx", import.meta.url), "utf8");

test("independent exact-one flag is default-off; enabled launcher is closed, lazy and request-free", () => {
  const name = "NEXT_PUBLIC_FAOLLA_ATTENDANCE_RULE_CAPTURES_ENABLED", previous = process.env[name];
  try {
    for (const value of [undefined, "0", "true", " 1"]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
      assert.equal(renderToStaticMarkup(createElement(Launcher, props)), "");
    }
    process.env[name] = "1";
    assert.equal(renderToStaticMarkup(createElement(Launcher, { ...props, active: false })), "");
    assert.equal(renderToStaticMarkup(createElement(Launcher, { ...props, enabled: false })), "");
    const html = renderToStaticMarkup(createElement(Launcher, props));
    assert.match(html, /候选来源留存（未应用）/); assert.doesNotMatch(html, /<dialog|<form|data-rule-capture-/);
  } finally { if (previous === undefined) delete process.env[name]; else process.env[name] = previous; }
});

test("initial panel has blank bounded dates and reason, explicit disabled actions, no source or receipt", () => {
  const html = renderToStaticMarkup(createElement(Panel, { ...props, onClose: () => {} }));
  assert.match(html, /单员工候选来源留存/); assert.match(html, /连续 1–7 个企业当地日期/);
  assert.equal(count(html, 'type="date"'), 2); assert.equal(count(html, 'value=""'), 4);
  assert.equal(count(html, 'min="2000-01-01" max="2100-12-31"'), 2);
  for (const action of ["读取留存前核对", "确认留存当前来源", "读取指定留存"]) assert(html.includes(`disabled="">${action}`), action);
  assert.match(html, /关闭候选来源留存/); assert.match(html, /role="status"/);
  assert.doesNotMatch(html, /data-rule-capture-preflight|data-rule-capture-result|Synthetic worker/);
});

test("manual UUID eligibility matches canonical lowercase version 1 through 8 and rejects invalid variants", () => {
  for (let version = 1; version <= 8; version++) assert(validCaptureUiOperationId(`00000000-0000-${version}000-8000-000000000001`));
  assert(validCaptureUiOperationId(` ${ruleCapturesQuery.operationId} `));
  for (const invalid of ["", "00000000-0000-0000-8000-000000000001", "00000000-0000-9000-8000-000000000001", "00000000-0000-4000-0000-000000000001",
    "abcdefab-0000-4000-8000-000000000001".toUpperCase(), `${ruleCapturesQuery.operationId}x`]) assert.equal(validCaptureUiOperationId(invalid), false, invalid);
});

test("reason validator preserves Unicode and explicit text without coercing blank, controls or broken surrogates", () => {
  assert.equal(checkedCaptureReason("  仅候选来源 🧭  "), "仅候选来源 🧭");
  assert.equal(checkedCaptureReason("🧭".repeat(200)), "🧭".repeat(200));
  for (const value of ["", "   ", "x".repeat(201), "a\nb", "a\u0000b", "a\u007fb", "a\u0085b", "\ud800", "\udc00", "x\ud800y"]) assert.throws(() => checkedCaptureReason(value));
});

test("capture eligibility requires complete sources, active dual identity and current module permission", () => {
  assert(capturePreflightEligible(source())); assert.equal(capturePreflightEligible(null), false);
  for (const key of ["assignments", "rules", "personal"] as const) {
    const value = source(); value[key].limited = true; value[key].items = [];
    assert.equal(capturePreflightEligible(value), false, key); assert.match(preflight(value), /本次来源未完整取得/);
  }
  for (const condition of ["module", "worker", "employee", "employeeId", "authId"] as const) {
    const value = source();
    if (condition === "module") value.moduleEnabled = false;
    else if (condition === "worker") value.worker.active = false;
    else if (condition === "employee") value.worker.employeeActive = false;
    else if (condition === "employeeId") value.worker.employeeId = null;
    else value.worker.employeeAuthUserId = null;
    assert.equal(capturePreflightEligible(value), false, condition);
  }
});

test("complete observations remain capturable even when candidate application is blocked", () => {
  const value = source(); value.warnings.push("identity_changed", "assignment_utc_overlap"); value.assignments.items[0].currentGroup.active = false;
  assert(capturePreflightEligible(value)); // Capturing facts is not applying or approving them.
});

test("preflight shows verified current identities, context, exact UTC and fresh-read caveat without full sources", () => {
  const value = source(), before = structuredClone(value), html = preflight(value);
  for (const text of [value.siteId, value.actorId, value.worker.workerId, value.worker.workerName, value.worker.employeeId!, value.worker.employeeAuthUserId!, value.timeZone, value.readAt, value.fromAt, value.toAt]) assert(html.includes(text), text);
  assert.match(html, /服务器会重新读取，可能与预核对不同/); assert.match(html, /尚未保存/);
  assert.doesNotMatch(html, /<pre|data-three-layer-segment|lateGraceMinutes|个人核准与撤回来源|<input|<form/);
  assert.deepEqual(value, before);
});

test("paused preflight and incomplete employee context cannot be mistaken for write permission", () => {
  const value = source(); value.moduleEnabled = false; value.worker.employeeAuthUserId = null;
  const html = preflight(value); assert.match(html, /新考勤模块已暂停，不能发起新留存/);
  assert.match(html, /双身份未绑定，不能发起新留存/); assert.match(html, /未绑定/);
});

test("compact receipt retains source ID, hash, exact timestamps, identity, dates, byte count and bounded counters", async () => {
  const value = await compact(), item = value.receipt!; const before = structuredClone(value), html = receipt(value);
  for (const text of [value.operationId, value.readAt, item.sourceId, item.actorId, item.sourceSha256, item.sourceReadAt, item.observedAt, item.recordedAt,
    item.command.employeeId, item.command.employeeAuthUserId, item.command.reason, item.summary.fromAt, item.summary.toAt, item.canonicalFormat, String(item.sourceBytes)]) assert(html.includes(text), text);
  assert.match(html, /归组 1 · 企业／组流 2 · 候选发布 2 · 个人核准 2 · 个人撤回 1/);
  for (const text of ["本操作新读取时间", "本操作登记时间", "被留存来源的读取时间", "内容摘要，不是签名", "不是全部历史数量", "不证明历史上实际采用了这些规则"]) assert(html.includes(text), text);
  assert.doesNotMatch(html, /<pre|sourceText|lateGraceMinutes|data-three-layer-segment|<table|<iframe|<input|<form/);
  assert.deepEqual(value, before);
});

test("receipt null is unknown, not proof of no write, and paused original reads remain explicit", async () => {
  const value = await compact(); value.receipt = null; value.moduleEnabled = false;
  const html = receipt(value); assert.match(html, /本次未找到该编号的收据/); assert.match(html, /不等于证明没有写入/);
  assert.match(html, /新考勤模块已暂停/); assert.match(html, /不要另建编号/); assert.doesNotMatch(html, /来源 SHA-256|归组 0|已经撤销/);
});

test("source names and compact receipt names and reasons are escaped text only", async () => {
  const payload = '<img src=x onerror="alert(1)">', s = source(), result = await compact();
  s.worker.workerName = payload; result.receipt!.summary.workerName = payload; result.receipt!.command.reason = payload;
  for (const html of [preflight(s), receipt(result)]) {
    assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/); assert.doesNotMatch(html, /<img|<script|<iframe/);
  }
});

test("pending recovery shows original ID and both explicit actions even outside an unconfirmed phase", () => {
  const html = renderToStaticMarkup(createElement(RuleCapturePending, { operationId: ruleCapturesQuery.operationId, busy: false, onRecover: () => {}, onRetry: () => {} }));
  assert(html.includes(ruleCapturesQuery.operationId)); assert.match(html, /核对原留存编号/); assert.match(html, /原编号核对并重试/);
  assert.match(html, /不会自动重发/); assert.match(html, /不能修改输入或发起新留存/); assert.doesNotMatch(html, /disabled=/);
  const busy = renderToStaticMarkup(createElement(RuleCapturePending, { operationId: ruleCapturesQuery.operationId, busy: true, onRecover: () => {}, onRetry: () => {} }));
  assert.equal(count(busy, 'disabled=""'), 2);
  assert.match(panelSource(), /visible && state\.pending && <RuleCapturePending/);
});

test("confirmation continuation passes only the current visible mounted generation and same immutable source", () => {
  const life = { alive: true, visible: true, epoch: 7 }, expected = source(); let submissions = 0;
  if (captureUiConfirmationCurrent(life, 7, true, expected, expected)) submissions++;
  for (const attempt of [
    () => captureUiConfirmationCurrent({ ...life, alive: false }, 7, true, expected, expected),
    () => captureUiConfirmationCurrent({ ...life, visible: false }, 7, true, expected, expected),
    () => captureUiConfirmationCurrent({ ...life, epoch: 8 }, 7, true, expected, expected),
    () => captureUiConfirmationCurrent(life, 7, false, expected, expected),
    () => captureUiConfirmationCurrent(life, 7, true, expected, structuredClone(expected)),
    () => captureUiConfirmationCurrent(life, 7, true, expected, null),
  ]) { if (attempt()) submissions++; }
  assert.equal(submissions, 1);
});

test("pending confirmation is reference-bound and a hide then show cannot revive its old generation", () => {
  const life = { alive: true, visible: true, epoch: 1 }, pending = { operationId: ruleCapturesQuery.operationId }, epoch = life.epoch;
  assert(captureUiConfirmationCurrent(life, epoch, true, pending, pending));
  life.visible = false; life.epoch++; life.visible = true; life.epoch++;
  assert.equal(captureUiConfirmationCurrent(life, epoch, true, pending, pending), false);
  assert.equal(captureUiConfirmationCurrent(life, life.epoch, true, pending, { ...pending }), false);
});

test("close during initial local initialization is allowed only in its unchanged lifecycle", () => {
  const snapshot = {}, life = { alive: true, visible: false, epoch: 1 };
  assert(captureUiConfirmationCurrent(life, 1, true, snapshot, snapshot, false));
  life.visible = true; assert.equal(captureUiConfirmationCurrent(life, 1, true, snapshot, snapshot, false), false);
  life.visible = false; life.alive = false; assert.equal(captureUiConfirmationCurrent(life, 1, true, snapshot, snapshot, false), false);
});

test("source lifecycle contract uses local-only initialize, synchronous hidden cleanup and no automatic read or retry", () => {
  // Source contract + pure fences, not a jsdom or real-browser lifecycle claim.
  const panel = panelSource(), effect = panel.split("useLayoutEffect(() => {")[1].split("}, [client]);")[0];
  assert.match(effect, /await client\.initialize\(\)/); assert.doesNotMatch(effect, /client\.(read|recover|retry|capture)\(/);
  for (const event of ["visibilitychange", "pagehide", "pageshow"]) { assert(effect.includes(`addEventListener("${event}"`)); assert(effect.includes(`removeEventListener("${event}"`)); }
  assert.match(effect, /flushSync\(hide\)/); assert.match(effect, /clearInputs\(\); client\.pause\(\)/); assert.match(effect, /life\.alive = false; \+\+life\.epoch/);
  assert.match(panel, /binding\.apiFetch !== props\.apiFetch/); assert.match(panel, /workerId}:\$\{binding\.revision}/);
  assert.equal(count(panel, "client.read("), 1); assert.equal(count(panel, "client.capture("), 1); assert.equal(count(panel, "client.retry("), 1);
  assert.match(panel, /\+\+lifecycle\.current\.epoch; client\.invalidate\(\)/);
  assert.match(panel, /expected\.pending/); assert.match(panel, /dirty \|\| state\.pending/); assert.match(panel, /beforeunload/);
  assert.doesNotMatch(panel, /setInterval|localStorage|navigator\.clipboard|JSON\.stringify|sourceText|\.approve\(|\.publish\(|\.withdraw\(/);
});

test("native modal traps underlying controls, Esc delegates close warning, native close and unmount remove content", () => {
  const launcher = launcherSource(), panel = panelSource();
  assert.match(launcher, /lazy\(\(\) => import\("\.\/MerchantAttendanceRuleCapturesPanel"\)\)/);
  assert.match(launcher, /dialog\.showModal\(\)/); assert.match(launcher, /if \(dialog\.open\) dialog\.close\(\)/);
  assert.match(launcher, /onCancel=\{event => \{ event\.preventDefault\(\); requestClose\(\); \}\} onClose=\{close\}/);
  assert.match(launcher, /registerCloseHandler=\{registerCloseHandler\}/); assert.match(panel, /registerCloseHandler\?\.\(null\)/);
  assert.match(launcher, /aria-label="候选来源留存（未应用）"/);
  assert.match(launcher, /maxWidth: "calc\(100vw - 1rem\)"/); assert.match(launcher, /maxHeight: "calc\(100dvh - 1rem\)"/); assert.match(launcher, /overflowY: "auto"/);
  assert.match(panel, /warnings\.join\("\\n"\)/); assert.match(panel, /!current\(epoch, expected, client\.getSnapshot\(\), wasVisible\)/);
  const cleanup = panel.split("return () => {\n      life.alive = false;")[1]?.split("};")[0]; assert(cleanup); assert.doesNotMatch(cleanup, /confirm/);
});

test("page explains session-only recent ID, no archive search and no reliable persistence promise", () => {
  const html = renderToStaticMarkup(createElement(Panel, { ...props, onClose: () => {} }));
  for (const text of ["本标签页最近一次留存", "不是全部历史或全库检索", "此操作只读取，不重试保存", "修改日期或理由会清除旧核对结果", "不能保证恢复", "没有自动重发"]) assert(html.includes(text), text);
  const panel = panelSource(); assert.match(panel, /server|服务器会重新读取，可能与预核对不同/);
  assert.doesNotMatch(panel, /from .*merchantAttendanceRuleCaptures"|MerchantAttendanceThreeLayerRules|resolveCandidate/);
});

test("Admin integration adds only a separately gated worker launcher on the authorization epoch", () => {
  // Minimal source contract only; full Admin user paths are not asserted here.
  const admin = readFileSync(new URL("../components/enterprise/MerchantAttendanceAdminPanel.tsx", import.meta.url), "utf8");
  const entries = [...admin.matchAll(/<RuleCapturesLauncher\b[\s\S]*?\/>/g)]; assert.equal(entries.length, 1);
  for (const text of ['key={`rule-captures:${state.authorizationEpoch}`}', 'siteId={siteId}', 'ownerId={ownerId}', 'workerId={item.id}', 'apiFetch={apiFetch}', '!busy', '!state.pending', '!editor', 'state.phase === "ready"', '!exceptionOpen', '!correctionReviewOpen', '!correctionControlsOpen', '!revisionApprovalOpen', '!(timesheetEnabled && timesheetOpen)']) assert(entries[0][0].includes(text), text);
  assert.doesNotMatch(entries[0][0], /\benabled\s*=/); assert.match(admin, /view === "workers" && !chooser && "workerNo" in item && <RuleCapturesLauncher/);
});
