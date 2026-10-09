import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import RuleResolution from "../components/enterprise/MerchantAttendanceRuleResolution";
import { parseSourcesResult, type SourcesResult } from "./merchantAttendanceSources";
import { sourcesWire, sourcesQuery, sourcesOwner, sourcesId } from "../../scripts/fixtures/attendance-sources-model";
import { emptyAttendanceRuleDraft } from "./merchantAttendanceRuleDraft";
import { attendanceDayUtcRange } from "./merchantAttendanceTime";
import type { RulesItem } from "./merchantAttendanceRules";

const source = () => parseSourcesResult(sourcesWire(), sourcesQuery, sourcesOwner);
const render = (s: SourcesResult = source()) => renderToStaticMarkup(createElement(RuleResolution, { source: s }));
function published(): SourcesResult {
  const s = source(), rules = emptyAttendanceRuleDraft();
  rules.lateGraceMinutes = { mode: "value", minutes: 0 };
  rules.earlyGraceMinutes = { mode: "disabled" };
  rules.completedBreakMinimumMinutes = { mode: "value", minutes: 15 };
  const p: RulesItem = { action: "publish", revision: 2, operationId: sourcesId(702), actorId: sourcesOwner,
    reason: "Synthetic", recordedAt: "2026-09-27T00:00:00.000001Z", settingsVersion: 1, groupRevision: null,
    timeZone: "UTC", rules, effectiveOn: "2026-09-28", effectiveAt: "2026-09-28T00:00:00.000Z", publishedRevision: null };
  s.rules.items = [{ groupId: null, revision: 2, publications: [p] }];
  return s;
}

test("candidate UI clearly distinguishes two-layer preview from formal assessment and unconfigured from zero", () => {
  const html = render();
  assert.match(html, /aria-label="候选规则解析（未应用）"/);
  assert.match(html, /个人例外尚未接入/); assert.match(html, /不作正式考勤判定/);
  assert.equal((html.match(/data-rule-state="unconfigured"/g) ?? []).length, 4);
  assert.match(html, /未配置（不是0）/); assert.match(html, /该时点无候选发布/);
  assert.doesNotMatch(html, /<form|<input|<button|已生效|考勤正常/);
});
test("candidate UI preserves literal zero, disabled and exact source provenance without editing controls", () => {
  const s = published(), before = structuredClone(s), html = render(s);
  assert.match(html, /data-rule-field="lateGraceMinutes" data-rule-state="value" data-rule-layer="enterprise"/);
  assert.match(html, /0 分钟/); assert.match(html, /明确停用（不向下继承）/);
  assert.match(html, /候选发布版本 2/); assert(html.includes(sourcesId(702)));
  assert.match(html, /保存时区 UTC/); assert.match(html, /账本版本 2/);
  assert.deepEqual(s, before); assert.doesNotMatch(html, /<form|<button|<input|<select/);
});
test("incomplete rules or changed identity block all fields and never show a fallback value", () => {
  for (const kind of ["rules", "identity", "inactive"] as const) {
    const s = published();
    if (kind === "rules") s.rules = { limited: true, items: [] };
    else if (kind === "identity") s.warnings.push("identity_changed");
    else s.worker.active = false;
    const html = render(s);
    assert.equal((html.match(/data-rule-state="blocked"/g) ?? []).length, 4);
    assert.match(html, /data-rule-status="blocked"/); assert.doesNotMatch(html, /data-rule-state="value"|采用企业默认层候选/);
  }
});
test("context coverage warnings remain visible even though rule candidates themselves can be compared", () => {
  const s = published(); s.leave = { limited: true, items: [] }; s.schedule = { limited: true, items: [] }; s.calendar = { limited: true, items: [] };
  const html = render(s);
  assert.match(html, /排班来源不完整/); assert.match(html, /请假来源不完整/); assert.match(html, /日历提示不完整/);
  assert.match(html, /data-rule-status="candidate"/); assert.match(html, /不作正式考勤判定/);
});
test("invalid internal candidate input fails locally instead of replacing original source display or inventing defaults", () => {
  const s = published(); s.rules.items[0].publications[0].rules!.lateGraceMinutes = { mode: "value", minutes: -1 };
  const html = render(s); assert.match(html, /role="alert"/); assert.match(html, /无法可靠解析候选规则/);
  assert.doesNotMatch(html, /data-rule-field=/);
});
test("all candidate text is escaped rather than interpreted as active HTML", () => {
  const s = source(); s.readAt = '<img src=x onerror="alert(1)">';
  const html = render(s); assert.doesNotMatch(html, /<img|<script|<iframe/);
  assert.match(html, /&lt;img/);
});
test("large timelines show only ten segments at once with local previous/next controls", () => {
  // Counterfactual internal-normalized fixture: different zones create >10
  // boundaries in seven dates; this is not a database publication proof.
  const s = source(), template = published().rules.items[0].publications[0];
  const zones = ["Pacific/Kiritimati", "Pacific/Auckland", "Asia/Tokyo", "Asia/Shanghai", "Asia/Kolkata", "Asia/Dubai", "Europe/Madrid", "Europe/London", "UTC", "America/New_York", "America/Los_Angeles", "Pacific/Honolulu"];
  const pubs = zones.map((timeZone, n): RulesItem => ({ ...structuredClone(template), revision: 2 * (n + 1), operationId: sourcesId(800 + n),
    timeZone, effectiveOn: "2026-09-30", effectiveAt: attendanceDayUtcRange("2026-09-30", timeZone).startAt }));
  pubs.sort((a, b) => a.effectiveAt!.localeCompare(b.effectiveAt!)); pubs.forEach((p, n) => { p.revision = 2 * (n + 1); });
  s.rules.items = [{ groupId: null, revision: 24, publications: pubs }];
  const html = render(s);
  assert.equal((html.match(/data-rule-segment="true"/g) ?? []).length, 10);
  assert.match(html, /候选规则时间段分页/); assert.match(html, /下一页时间段/);
});
