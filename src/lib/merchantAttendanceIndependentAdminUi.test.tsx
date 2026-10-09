// Real-component SSR and synchronous guard tests; not browser/Auth/SQL proof.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import Panel, { confirmIndependentAction } from "../components/enterprise/MerchantAttendanceIndependentAdminPanel";
import Launcher from "../components/enterprise/MerchantAttendanceIndependentAdminLauncher";
import { independentUiSite as siteId, independentUiOwner as actorId } from "../../scripts/fixtures/attendance-independent-ui-model";
test("196 owner initial body is inert, explains nonsecret pending and explicit recovery", () => {
  let requests = 0; const apiFetch = async () => { requests++; assert.fail("initial render must not request"); };
  const html = renderToStaticMarkup(<Panel {...{siteId, actorId, apiFetch}} onClose={() => {}}/>);
  assert.match(html, /不创建假账号/); assert.match(html, /仅 GET 核验原编号/); assert.match(html, /不存入本地原编号/);
  assert.match(html, /新操作尚未开放/); assert.match(html, /min-w-0/); assert.equal(requests, 0);
});
test("196 real launcher opens no dialog and performs no initial request", () => {
  const html = renderToStaticMarkup(<Launcher {...{siteId, actorId}} apiFetch={async () => assert.fail()}/>);
  assert.match(html, /无邮箱员工/); assert.doesNotMatch(html, /<dialog/);
});
test("196 stable false Auth callback hides launcher and private panel synchronously", () => {
  const props = {siteId, actorId, apiFetch: async () => assert.fail(), isCurrentAuth: () => false};
  assert.equal(renderToStaticMarkup(<Panel {...props} onClose={() => {}}/>), "");
  assert.equal(renderToStaticMarkup(<Launcher {...props}/>), "");
});
test("196 confirmation rechecks frozen draft/Auth; cancellation never submits", () => {
  let current = true, sends = 0;
  assert.equal(confirmIndependentAction(() => {current = false; return true;}, () => current, () => {sends++;}), false);
  current = true; assert.equal(confirmIndependentAction(() => false, () => current, () => {sends++;}), false);
  assert.equal(sends, 0); assert.equal(confirmIndependentAction(() => true, () => current, () => {sends++;}), true); assert.equal(sends, 1);
});
