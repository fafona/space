import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Launcher from "../components/enterprise/MerchantAttendanceRuleSourcesLauncher";
import Panel, { AttendanceRuleSourcesEvidence } from "../components/enterprise/MerchantAttendanceRuleSourcesPanel";
import ThreeLayerRules from "../components/enterprise/MerchantAttendanceThreeLayerRules";
import { parseRuleSourcesResult, type RuleSourcesResult, type RuleSourcesResponse } from "./merchantAttendanceRuleSources";
import { attendanceDayUtcRange } from "./merchantAttendanceTime";
import { emptyAttendanceRuleDraft } from "./merchantAttendanceRuleDraft";
import { ruleSourcesAssignment, ruleSourcesId, ruleSourcesOwner, ruleSourcesPersonal, ruleSourcesPopulated, ruleSourcesPublication, ruleSourcesQuery, ruleSourcesWire, type RuleSourcesWire } from "../../scripts/fixtures/attendance-rule-sources-model";

const apiFetch = async (): Promise<Response> => { throw Error("SSR must not make a request"); };
const props = { siteId: ruleSourcesQuery.siteId, ownerId: ruleSourcesOwner, workerId: ruleSourcesQuery.workerId, apiFetch };
const parsed = (raw: RuleSourcesWire = ruleSourcesPopulated()) => parseRuleSourcesResult(raw, ruleSourcesQuery, ruleSourcesOwner);
const response = (raw: RuleSourcesWire = ruleSourcesPopulated(), moduleEnabled = true): RuleSourcesResponse => ({ ...parsed(raw), moduleEnabled });
const render = (source: RuleSourcesResult = parsed()) => renderToStaticMarkup(createElement(ThreeLayerRules, { source }));
const evidence = (result: RuleSourcesResponse = response()) => renderToStaticMarkup(createElement(AttendanceRuleSourcesEvidence, { result }));
const count = (html: string, value: string) => html.split(value).length - 1;

test("independent launcher is default-off, inactive-safe, closed and lazy without a request", () => {
  const previous = process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_RULE_SOURCES_ENABLED;
  try {
    delete process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_RULE_SOURCES_ENABLED;
    assert.equal(renderToStaticMarkup(createElement(Launcher, props)), "");
    process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_RULE_SOURCES_ENABLED = "0";
    assert.equal(renderToStaticMarkup(createElement(Launcher, props)), "");
    assert.equal(renderToStaticMarkup(createElement(Launcher, { ...props, enabled: true, active: false })), "");
    process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_RULE_SOURCES_ENABLED = "1";
    const html = renderToStaticMarkup(createElement(Launcher, props));
    assert.match(html, /三层规则预览（未应用）/); assert.doesNotMatch(html, /<dialog|<form|data-rule-sources-result/);
  } finally {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_RULE_SOURCES_ENABLED;
    else process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_RULE_SOURCES_ENABLED = previous;
  }
});

test("panel starts with two empty dates, an explicit disabled read and no source information", () => {
  const html = renderToStaticMarkup(createElement(Panel, { ...props, onClose: () => {} }));
  assert.match(html, /单员工三层规则只读预览/); assert.match(html, /连续 1–7 个企业当地日期/);
  assert.equal(count(html, 'type="date"'), 2); assert.equal(count(html, 'value=""'), 2);
  assert.match(html, /disabled="">读取三层规则来源/); assert.match(html, /关闭三层规则预览/);
  assert.match(html, /不保存、不发布、不核准或撤回任何记录/); assert.match(html, /role="status"/);
  assert.doesNotMatch(html, /data-rule-sources-result|Synthetic worker|<select|<textarea/);
});

test("known empty sources distinguish missing approval, no assignment, missing publication and unconfigured", () => {
  const html = render(parsed(ruleSourcesWire()));
  assert.match(html, /三层候选规则解析（未应用）/);
  for (const mode of ["missing_approval", "no_assignment", "missing_publication"]) assert.equal(count(html, `data-rule-trace-mode="${mode}"`), 4);
  assert.equal(count(html, 'data-rule-state="unconfigured"'), 4); assert.match(html, /未配置（不是 0，不补默认值）/);
  assert.match(html, /已读取个人来源/); assert.match(html, /未历史固定/);
  assert.doesNotMatch(html, /个人例外尚未接入|仅对照企业层|考勤正常|<input|<form/);
});

test("three-layer choices preserve personal zero, group disabled and enterprise inheritance after personal end", () => {
  const source = parsed(), before = structuredClone(source), html = render(source);
  assert.equal(count(html, 'data-three-layer-segment="true"'), 2);
  assert.match(html, /data-rule-field="lateGraceMinutes" data-rule-state="value" data-rule-layer="personal"/);
  assert.match(html, /data-rule-field="lateGraceMinutes" data-rule-state="value" data-rule-layer="enterprise"/);
  assert.match(html, /data-rule-field="earlyGraceMinutes" data-rule-state="disabled" data-rule-layer="group"/);
  assert.match(html, /0 分钟/); assert.match(html, /12 分钟/); assert.match(html, /明确停用（不向下继承）/);
  assert.match(html, /data-rule-trace-mode="inherit"/); assert.match(html, /个人核准结束后重新比较下层/);
  assert.deepEqual(source, before);
});

test("all chosen and lower-layer provenance keeps exact identities, original zones, versions and microseconds", () => {
  const source = parsed(), html = render(source), personal = source.personal.items[1].approval;
  for (const value of [personal.operationId, personal.actorId, personal.employeeId, personal.employeeAuthUserId, personal.recordedAt,
    personal.startsOn, personal.endsOn, personal.fromAt, personal.toAt, source.rules.items[0].publications[0].operationId,
    source.rules.items[1].publications[0].operationId]) assert(html.includes(value), value);
  for (const text of ["账本版本 3", "核准版本 3", "账本版本 40", "账本版本 90", "候选发布版本 2", "设置版本 1", "档案版本 1", "组版本 1", "时区 UTC"]) assert(html.includes(text), text);
  assert.match(html, /查看个人 → 组 → 企业完整依据/); assert.match(html, /不是异常或工资结论/);
});

test("operation UUID reuse across personal and enterprise layers does not mark both trace sources as chosen", () => {
  const raw = ruleSourcesPopulated();
  raw.rules.items[0].publications[0].operationId = raw.personal.items[1].approval.operationId;
  const html = render(parsed(raw)), firstLate = html.split('data-rule-field="lateGraceMinutes"')[1].split('data-rule-field="earlyGraceMinutes"')[0];
  const personal = firstLate.match(/<li data-rule-trace-layer="personal"[\s\S]*?<\/li>/)?.[0];
  const enterprise = firstLate.match(/<li data-rule-trace-layer="enterprise"[\s\S]*?<\/li>/)?.[0];
  assert(personal && enterprise); assert.match(personal, /本项采用/); assert.doesNotMatch(enterprise, /本项采用/);
});

test("withdrawn approval is retained as separate evidence but does not supply candidate values or cutovers", () => {
  const raw = ruleSourcesPopulated(); raw.personal.items = [raw.personal.items[0]]; raw.personal.revision = 2;
  const result = response(raw), resolved = render(result), html = evidence(result);
  assert.equal(count(resolved, 'data-three-layer-segment="true"'), 1); assert.doesNotMatch(resolved, /data-rule-layer="personal"/);
  assert.equal(count(html, 'data-personal-rule-source="approve"'), 1); assert.equal(count(html, 'data-personal-rule-source="withdraw"'), 1);
  assert.match(html, /已由版本 2 撤回，不参与候选解析/); assert.match(html, /撤回目标核准版本 1/);
  assert(html.includes(ruleSourcesId(98))); assert.match(html, /2026-09-26T00:00:00.000002Z/);
});

test("each global insufficiency blocks all fields without fabricating lower-layer defaults", () => {
  for (const condition of ["assignments", "rules", "personal", "identity", "worker", "employee", "unbound"] as const) {
    const source = parsed();
    if (condition === "assignments" || condition === "rules" || condition === "personal") { source[condition].limited = true; source[condition].items = []; }
    else if (condition === "identity") source.warnings.push("identity_changed");
    else if (condition === "worker") source.worker.active = false;
    else if (condition === "employee") source.worker.employeeActive = false;
    else source.worker.employeeAuthUserId = null;
    const html = render(source);
    assert.equal(count(html, 'data-rule-state="blocked"'), 4, condition); assert.match(html, /data-rule-status="blocked"/);
    assert.doesNotMatch(html, /data-rule-state="value"|本项采用个人核准层候选|本项采用企业层候选/);
  }
});

test("inactive group, overlapping assignments and missing lower stream block even a personal override", () => {
  for (const condition of ["inactive", "overlap", "missing"] as const) {
    const raw = ruleSourcesPopulated();
    if (condition === "inactive") raw.assignments.items[0].currentGroup.active = false;
    else if (condition === "overlap") raw.assignments.items.push(ruleSourcesAssignment(ruleSourcesQuery, 701, 802));
    const source = parsed(raw);
    if (condition === "missing") source.rules.items = source.rules.items.filter(stream => stream.groupId !== null);
    const html = render(source); assert.match(html, /data-rule-status="blocked"/); assert.doesNotMatch(html, /data-rule-state="value"/);
  }
});

test("invalid internal candidate data reports a local error rather than inventing a decision", () => {
  const source = parsed(); source.rules.items[0].publications[0].rules!.lateGraceMinutes = { mode: "value", minutes: -1 };
  const html = render(source); assert.match(html, /role="alert"/); assert.match(html, /无法可靠解析三层候选/);
  assert.doesNotMatch(html, /data-rule-field=/);
});

test("read context and paused module stay explicit without write controls or raw JSON", () => {
  const result = response(undefined, false), html = evidence(result);
  for (const value of [result.siteId, result.actorId, result.worker.workerId, result.worker.workerName, result.readAt, result.fromAt, result.toAt]) assert(html.includes(value), value);
  assert.match(html, /新考勤模块已暂停/); assert.match(html, /个人账本版本 3/); assert.match(html, /不是全部业务数据的历史快照/);
  assert.match(html, /原归组与当前组来源/); assert.match(html, /企业与组候选发布来源/);
  assert.doesNotMatch(html, /<form|<input|<textarea|<select|<pre|dangerouslySetInnerHTML/);
});

test("enterprise inherited fields do not imply a nonexistent lower layer in publication evidence", () => {
  const raw = ruleSourcesWire(), publication = ruleSourcesPublication(); publication.rules = emptyAttendanceRuleDraft();
  raw.rules.items = [{ groupId: null, revision: 2, publications: [publication] }];
  const html = evidence(response(raw)), publications = html.split('aria-label="企业与组候选发布来源"')[1];
  assert(publications); assert.equal(count(publications, "本层未设值（没有更低层，不补默认值）"), 4);
  assert.doesNotMatch(publications, /继承下一层/);
  const populated = evidence(); assert.match(populated.split('aria-label="个人核准与撤回来源"')[1].split('aria-label="原归组与当前组来源"')[0], /继承下一层（本层未设值）/);
});

test("stored names, reasons and historical owner identifiers render only as escaped text", () => {
  const raw = ruleSourcesPopulated(), payload = '<img src=x onerror="alert(1)">';
  raw.assignments.items[0].currentGroup.name = payload; raw.personal.items[1].approval.reason = payload;
  raw.rules.items[0].publications[0].reason = payload;
  const result = response(raw), before = structuredClone(result), html = evidence(result);
  assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/); assert.doesNotMatch(html, /<img|<script|<iframe/);
  assert.deepEqual(result, before);
});

test("timelines with more than ten UTC cutovers render exactly ten segments and local paging controls", () => {
  const raw = ruleSourcesWire(), zones = ["Pacific/Kiritimati", "Pacific/Auckland", "Asia/Tokyo", "Asia/Shanghai", "Asia/Kolkata", "Asia/Dubai", "Europe/Madrid", "Europe/London", "UTC", "America/New_York", "America/Los_Angeles", "Pacific/Honolulu"];
  const publications = zones.map((timeZone, index) => ({ ...ruleSourcesPublication(3000 + index, null, "2026-09-30"), timeZone, effectiveAt: attendanceDayUtcRange("2026-09-30", timeZone).startAt }));
  publications.sort((a, b) => a.effectiveAt!.localeCompare(b.effectiveAt!)); publications.forEach((item, index) => { item.revision = 2 * (index + 1); });
  raw.rules.items = [{ groupId: null, revision: 24, publications }];
  const html = render(parsed(raw)); assert.equal(count(html, 'data-three-layer-segment="true"'), 10);
  assert.match(html, /三层规则时间段分页/); assert.match(html, /下一页时间段/);
});

test("personal source paging limits individual approval and withdrawal records to ten, not ten pairs", () => {
  const raw = ruleSourcesWire(); raw.personal = { limited: false, revision: 12, items: Array.from({ length: 6 }, (_, index) => ruleSourcesPersonal(2 * index + 1, ruleSourcesQuery.fromDate, ruleSourcesQuery.throughDate, true)) };
  const html = evidence(response(raw)); assert.equal(count(html, 'data-personal-rule-source='), 10);
  assert.match(html, /个人核准与撤回来源分页/); assert.match(html, /本次范围返回 12 条展示记录/);
  assert.doesNotMatch(html, /<pre/);
});

test("assignment and empty-stream evidence each render at most ten local rows", () => {
  const raw = ruleSourcesWire(); raw.assignments.items = Array.from({ length: 11 }, (_, index) => ruleSourcesAssignment(ruleSourcesQuery, 701 + index, 801 + index));
  raw.rules.items.push(...raw.assignments.items.map(({ currentGroup }) => ({ groupId: currentGroup.groupId, revision: 0, publications: [] })));
  const html = evidence(response(raw)); assert.equal(count(html, 'data-rule-assignment-source="true"'), 10); assert.equal(count(html, 'data-rule-publication-source="true"'), 10);
  assert.match(html, /原归组与当前组来源分页/); assert.match(html, /企业与组候选发布来源分页/);
});

test("limited personal evidence is never displayed as an empty known stream", () => {
  const raw = ruleSourcesWire(); raw.personal = { limited: true, revision: 10, items: [] };
  const html = evidence(response(raw)); assert.match(html, /个人核准来源未完整取得/);
  assert.doesNotMatch(html, /本次完整读取的范围内没有个人核准来源|data-rule-trace-mode="missing_approval"/);
});

test("new UI source keeps native modal lifecycle, explicit reads and memory-only binding cleanup", () => {
  const launcher = readFileSync(new URL("../components/enterprise/MerchantAttendanceRuleSourcesLauncher.tsx", import.meta.url), "utf8");
  const panel = readFileSync(new URL("../components/enterprise/MerchantAttendanceRuleSourcesPanel.tsx", import.meta.url), "utf8");
  assert.match(launcher, /lazy\(\(\) => import\("\.\/MerchantAttendanceRuleSourcesPanel"\)\)/);
  assert.match(launcher, /element\.showModal\(\)/); assert.match(launcher, /if \(element\.open\) element\.close\(\)/);
  assert.match(launcher, /onCancel=\{event => \{ event\.preventDefault\(\); setOpen\(false\); \}\}/);
  assert.match(panel, /binding\.apiFetch !== props\.apiFetch/); assert.match(panel, /binding\.revision/);
  assert.match(panel, /visibilitychange/); assert.match(panel, /pagehide/); assert.match(panel, /flushSync\(hide\)/);
  assert.equal(count(panel, "client.read("), 1); assert.match(panel, /client\.invalidate\(\); setFrom/); assert.match(panel, /client\.invalidate\(\); setThrough/);
  assert.doesNotMatch(launcher + panel, /window\.confirm|localStorage|sessionStorage|setInterval|JSON\.stringify|\.approve\(|\.withdraw\(|\.publish\(/);
});

test("parent integration is only a gated worker-row launcher keyed to the current authorization epoch", () => {
  // Source contract only; this is not a full parent browser acceptance claim.
  const admin = readFileSync(new URL("../components/enterprise/MerchantAttendanceAdminPanel.tsx", import.meta.url), "utf8");
  const matches = [...admin.matchAll(/<RuleSourcesLauncher\b[\s\S]*?\/>/g)]; assert.equal(matches.length, 1);
  const entry = matches[0][0];
  for (const text of ['key={`rule-sources:${state.authorizationEpoch}`}', 'siteId={siteId}', 'ownerId={ownerId}', 'workerId={item.id}', 'apiFetch={apiFetch}', '!state.pending', '!editor', 'state.phase === "ready"', '!exceptionOpen', '!correctionReviewOpen', '!correctionControlsOpen', '!revisionApprovalOpen']) assert(entry.includes(text), text);
  assert.doesNotMatch(entry, /\benabled\s*=/); assert.match(admin, /view === "workers" && !chooser && "workerNo" in item && <RuleSourcesLauncher/);
});
