// Actual-component SSR and wiring evidence only, not browser/Auth/SQL acceptance.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import Panel, { DelegatedPlanExceptionReview } from "../components/enterprise/MerchantAttendanceDelegatedPlanExceptionsPanel";
import Launcher from "../components/enterprise/MerchantAttendanceDelegatedPlanExceptionsLauncher";
import { delegatedPlanExceptionsModel as model } from "../../scripts/fixtures/attendance-delegated-plan-exceptions-model";
const f = model(), apiFetch = async () => assert.fail("initial component render must not request");
const props = { siteId: f.query.siteId, actorId: f.actor, apiFetch, isCurrentAuth: () => true, onClose: () => {} };
test("209 actual owner has one precise structured grant, delegate no owner list, no new annul", () => {
  const owner = renderToStaticMarkup(<Panel {...props} ownerMode/>), delegate = renderToStaticMarkup(<Panel {...props}/>);
  for (const label of ["受托员工 Employee ID", "受托账户 Auth ID", "目标档案 Worker ID", "目标员工 Employee ID", "目标账户 Auth ID", "UTC", "默认不选"])
    assert(owner.includes(label), label);
  assert.match(owner, /新增唯一人员的正式异常审批授权/); assert.match(owner, /<fieldset disabled=""/);
  assert.doesNotMatch(delegate, /新增唯一人员的正式异常审批授权|读取正式异常授权（25条）|撤销此授权/);
  assert.doesNotMatch(owner, /value="annul"|value="JSON"/);
  assert.equal(renderToStaticMarkup(<Launcher {...props}/>), "", "new launcher is default-off");
  assert.equal(renderToStaticMarkup(<Launcher {...props} enabled isCurrentAuth={() => false}/>), "");
});
test("209 actual fixed review escapes data and identifies candidate anomaly minutes, not grace minutes", () => {
  for (const eligible of [true, false]) { const context = model(eligible).context, html = renderToStaticMarkup(<DelegatedPlanExceptionReview context={context}/>);
    assert(html.includes(context.context.review.detail!.worker.workerId)); assert(html.includes(context.context.review.detail!.slotId));
    assert(html.includes("&lt;img src=x onerror=bad&gt;")); assert.doesNotMatch(html, /<img|<input|<textarea|<button|宽限/);
    if (eligible) assert.match(html, /异常分钟/); else assert.match(html, /不得视为缺勤或自动确认/);
    assert.match(html, /只允许授权登记后新发布的排班/);
  }
});
test("209 actual target changes confirm before clearing all forms; independent revoke gates and late-response fences remain", () => {
  const source = readFileSync(new URL("../components/enterprise/MerchantAttendanceDelegatedPlanExceptionsPanel.tsx", import.meta.url), "utf8"),
    change = source.slice(source.indexOf("const updateTarget ="), source.indexOf("return <section aria-label", source.indexOf("const updateTarget =")));
  assert(change.includes("!discard()")); assert(change.indexOf("!discard()") < change.indexOf("client.pause()"));
  assert(change.includes("client.pause(); management.pause(); clear(); setTarget({ ...target, [key]: value })"));
  assert.match(source, /onChange=\{event => updateTarget\(key, event.target.value\)\}/);
  assert.match(source, /const revoke = \(\) => \{ if \(!ready\(\) \|\| !ownerMode \|\| !enabled \|\| !grantEnabled/);
  assert.match(source, /fieldset disabled=\{lock \|\| !enabled \|\| !grantEnabled\}/);
  assert.match(source, /window.addEventListener\("pagehide", suspend\)/); assert.match(source, /document.addEventListener\("visibilitychange", visibility\)/);
  assert.match(source, /JSON.stringify\(latest.current.target\) !== JSON.stringify\(snapshot.target\)/);
  assert.match(source, /acknowledged: Object.keys\(change\).length === 1 && change.acknowledged === true/);
  assert.match(source, /note: event.target.value, acknowledged: false/);
  assert.equal((source.match(/<select aria-label="明确处理"/g) ?? []).length, 1, "outcome has a stable accessible name, not concatenated option labels");
  const fields = source.match(/<(?:input|select|textarea)\b[^>]*>/g) ?? [];
  assert.equal(fields.length, 14); fields.forEach(field => assert(field.includes("aria-label="), "every209 field has an explicit stable accessible name"));
  for (const name of ["真实授权编号", "撤销理由", "已核验，明确撤销此授权", "生效时间（UTC）", "失效时间（UTC，不含端点）", "授权理由", "处理说明",
    "已核验双身份、地点、期限和旧排班边界，只授此明确动作", "已核验此真实人员、排班及完整依据，明确处理"])
    assert(source.includes(`aria-label="${name}"`), name);
  assert(source.includes("aria-label={grantFieldLabels[index]}")); assert(source.includes("aria-label={targetFieldLabels[index]}"));
  assert(source.includes('pending.domain === "plan-exceptions" ? pending.command.operationId : attendanceManagementPendingOperationId(pending)'));
  assert.match(source, /retireManagementPlanExceptionsClients\(\[client, management\], \(\) => mounted.current\)/);
  assert.match(source, /setState\(client.getSnapshot\(\)\); setManagementState\(management.getSnapshot\(\)\)/);
  assert.doesNotMatch(source, /invalidate\(\); client.dispose\(\)/);
  const admin = readFileSync(new URL("../components/enterprise/MerchantAttendanceAdminPanel.tsx", import.meta.url), "utf8"), manager = readFileSync(new URL("../components/admin/MerchantEnterpriseManager.tsx", import.meta.url), "utf8");
  assert.match(admin, /registerChild\("plan-exceptions-delegated"\)/); assert.match(manager, /delegatedPlanExceptionsLeaveGuardRef/);
  assert.match(manager, /registerLeaveGuard=\{registerDelegatedPlanExceptionsLeaveGuard\}/);
});
