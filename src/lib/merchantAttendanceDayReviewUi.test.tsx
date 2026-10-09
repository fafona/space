// Static real-component render and guard functions, not browser interaction.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import Workspace, { DayReviewEntryView, confirmDayReviewAction } from "../components/enterprise/MerchantAttendanceDayReviewWorkspace";
import Launcher from "../components/enterprise/MerchantAttendanceDayReviewLauncher";
import { dayUiHead, dayUiOwner as actorId, dayUiSite as siteId, dayUiWorker as workerId } from "../../scripts/fixtures/attendance-day-review-ui-model";
test("199 initial owner/self real components are inert, bounded layout and explain separate administrative scope", () => {
  let calls = 0; const apiFetch = async () => { calls++; assert.fail("SSR must not request"); };
  for (const access of ["owner", "self"] as const) {
    const html = renderToStaticMarkup(<Workspace {...{siteId, actorId, access, workerId, apiFetch}} onClose={() => {}}/>);
    assert.match(html, /不改变原打卡/); assert.match(html, /仅 GET 核验原编号/); assert.match(html, /min-w-0/); assert.equal(calls, 0);
    const entry = renderToStaticMarkup(<Launcher {...{siteId, actorId, access, workerId, apiFetch}}/>); assert.match(entry, /核查/); assert.doesNotMatch(entry, /<dialog/);
  }
});
test("199 stable Auth callback false suppresses real launcher/body, without any network or storage access", () => {
  const props = { siteId, actorId, access: "owner" as const, workerId, apiFetch: async () => { assert.fail(); }, isCurrentAuth: () => false };
  assert.equal(renderToStaticMarkup(<Workspace {...props} onClose={() => {}}/>), "");
  assert.equal(renderToStaticMarkup(<Launcher {...props}/>), "");
});
test("199 saved entry prints exact original version/reason/operation and never declares no-record as absence", () => {
  const html = renderToStaticMarkup(<DayReviewEntryView entry={dayUiHead().latestDecision}/>);
  assert.match(html, /版本 1/); assert.match(html, /不等于未工作/); assert.match(html, /000000000031/); assert.doesNotMatch(html, /旷工|零工时/);
});
test("199 confirm guard rechecks actual scope and frozen draft after the dialog; no late submit", () => {
  let current = true, sends = 0;
  assert.equal(confirmDayReviewAction(() => { current = false; return true; }, () => current, () => { sends++; }), false); assert.equal(sends, 0);
  current = true; assert.equal(confirmDayReviewAction(() => false, () => current, () => { sends++; }), false);
  assert.equal(confirmDayReviewAction(() => true, () => current, () => { sends++; }), true); assert.equal(sends, 1);
});
