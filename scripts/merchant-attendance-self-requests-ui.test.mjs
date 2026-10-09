import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const launcher = read("src/components/enterprise/MerchantAttendanceSelfRequestsLauncher.tsx");
const panel = read("src/components/enterprise/MerchantAttendanceSelfRequestsPanel.tsx");
const client = read("src/lib/merchantAttendanceSelfRequestsClient.ts");
const selfPanel = read("src/components/enterprise/MerchantAttendanceSelfPanel.tsx");

test("the independent launcher is default-off, lazy and mounted with only stable self identity", () => {
  assert.match(launcher, /NEXT_PUBLIC_FAOLLA_ATTENDANCE_SELF_REQUESTS_ENABLED === "1"/);
  assert.match(launcher, /if \(!enabled\) return null/);
  assert.match(launcher, /lazy\(\(\) => import\("\.\/MerchantAttendanceSelfRequestsPanel"\)\)/);
  assert.match(launcher, /key=\{`\$\{props\.siteId\}:\$\{props\.employeeId\}`\}/);
  assert.doesNotMatch(launcher, /workerId|canClock|state\.result/);
  assert.match(selfPanel, /import SelfRequestsLauncher from "\.\/MerchantAttendanceSelfRequestsLauncher"/);
  assert.match(selfPanel, /<SelfRequestsLauncher siteId=\{siteId\} employeeId=\{employeeId\} apiFetch=\{apiFetch\}\/\>/);
  assert.match(client, /corrections\/context\?siteId=/);
  assert.match(client, /context\.employeeId !== this\.identity\.employeeId/);
  assert.match(client, /expectedEmployeeId: context\.employeeId/);
  assert.match(client, /expectedWorkerId: context\.workerId/);
});

test("reads are explicit, bounded and cleared on both filter changes, hide, pagehide and unmount", () => {
  const effect = panel.slice(panel.indexOf("useEffect(() =>"), panel.indexOf("return <section"));
  for (const event of ["visibilitychange", "pagehide"]) assert(effect.includes(event));
  assert.match(effect, /return \(\) => \{\s*hide\(\)/);
  assert.doesNotMatch(effect, /client\.(?:begin|next)\(/);
  assert.match(panel, /onChange=\{event => \{ client\.pause\(\); setKind/);
  assert.match(panel, /onChange=\{event => \{ client\.pause\(\); setStatus/);
  assert.match(panel, /disabled=\{busy \|\| !result\?\.nextCursor\}/);
  assert.match(client, /this\.generation\+\+;?\s*this\.controller\?\.abort\(\)/);
  assert.match(client, /this\.options\.timeoutMs \?\? 12000\) - \(performance\.now\(\) - started\)/);
  assert.match(client, /timeoutMs: remaining\(\), maxBytes: 2048/);
  assert.match(client, /timeoutMs: remaining\(\), maxBytes: 131072/);
  assert.match(client, /cursorKind: result\.nextCursor\.kind/);
  assert.doesNotMatch(launcher + panel + client,
    /localStorage|sessionStorage|setInterval|geolocation|method:\s*["'](?:POST|PATCH|PUT|DELETE)|sendBeacon|AttendanceRevisionCycleClient|AttendanceMissingClient/);
});

test("copy and rows state the bounded read-only three-source contract without implying approval or current effectiveness", () => {
  for (const label of ["我的申请记录（只读）", "查询我的申请", "下一页候选", "重新查询首页", "关闭申请记录"]) {
    assert(panel.includes(label));
  }
  for (const label of ["待审批", "已批准", "已驳回", "已撤回", "首次补正", "再次修订", "整段漏卡"]) assert(panel.includes(label));
  for (const copy of [
    "首次补正、再次修订和整段漏卡三类申请及四种申请状态",
    "当前本人、当前考勤档案",
    "不是数据库事务快照",
    "已批准”只是申请的历史状态，不保证目前仍是生效的考勤结果",
    "不提交、撤回、批准、驳回或恢复未知操作",
    "不重建当前考勤或工资",
    "只保留当前页",
    "空中间页仍可继续",
    "新考勤已暂停；仍可只读核对本人申请，不开放提交或审批。",
  ]) assert(panel.includes(copy));
  for (const field of ["item.kind", "item.rootRequestId", "item.requestId", "result.asOf", "result.scanned"]) {
    assert(panel.includes(field));
  }
  for (const copy of ["仍有下一页", "已到末页"]) assert(client.includes(copy));
  assert.doesNotMatch(panel, /dangerouslySetInnerHTML|查看审批|去审批|审批此申请|明确提交|明确撤回/);
});
