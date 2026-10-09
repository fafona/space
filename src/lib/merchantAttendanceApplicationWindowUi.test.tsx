//194 Pure SSR/helpers; synthetic DTOs, no real browser/Auth/SQL claims.
import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Panel, { applicationWindowEditor, ApplicationWindowEvidence, ApplicationWindowTimeField } from "../components/enterprise/MerchantAttendanceApplicationWindowPanel";
import { applicationWindowFixture, windowActor } from "./merchantAttendanceApplicationWindowTestFixtures";
import { APPLICATION_WINDOW_FAMILIES } from "./merchantAttendanceApplicationWindow";
import { correctionDraftProposal, correctionTimeInput } from "./merchantAttendanceCorrectionForm";
import { correctionEmployee, correctionProposal } from "../../scripts/fixtures/attendance-correction-model";
test("194 panel mounts inert allfourfamilies and defaultoff still labels explicit原号 recovery", async () => {
  for (const family of APPLICATION_WINDOW_FAMILIES) { const f = await applicationWindowFixture(family); assert(f.query.mode === "prepare"); let calls = 0;
    const html = renderToStaticMarkup(<Panel query={f.query} employeeId={correctionEmployee} authUserId={windowActor} enabled={false} onClose={() => {}} apiFetch={async () => { calls++; throw Error("HTTP prohibited"); }} />);
    assert.equal(calls, 0); assert.match(html, /不会自动读取、提交或审批/); assert.match(html, /旧待确认编号优先/); assert.match(html, /新申请入口当前关闭/); assert.match(html, /min-w-0/);
    assert(!html.includes("来源指纹：")); assert(!html.includes("申请理由"));
  }
});
test("194 editor uses actualbasis/currentproposal/explicitmissingproposal and preserves microseconds", async () => {
  for (const family of APPLICATION_WINDOW_FAMILIES) { const f = await applicationWindowFixture(family), editor = applicationWindowEditor(f.result, correctionProposal); assert(editor);
    const proposal = correctionDraftProposal(editor.draft, editor.zone); assert.equal(proposal.startAt, correctionProposal.startAt);
    if (family.startsWith("missing")) assert.deepEqual(proposal, correctionProposal); assert.equal(applicationWindowEditor(f.post), null);
  }
});
test("194 evidence distinguishes originalbasis/currentapproval/root cap and receipt from any approval", async () => {
  const f = await applicationWindowFixture("correction_revision"), html = renderToStaticMarkup(<ApplicationWindowEvidence result={f.result} />);
  for (const text of ["独立原政策", "额外规则", "只收紧", "原根申请截止上限", "到点即过期", "当前核定（只读）", "不是审批"]) assert(html.includes(text));
  assert(html.includes(f.result.window!.effectiveDeadlineAt)); const receipt = renderToStaticMarkup(<ApplicationWindowEvidence result={f.post} />); assert.match(receipt, /收据不等于批准/);
});
test("194 walltime controls render both DST-fold offsets and reject missing civil time instead of guessing", () => {
  const fold = renderToStaticMarkup(<ApplicationWindowTimeField label="申请上班时间" value={correctionTimeInput("2026-10-25T00:30:00.000000Z", "Europe/Madrid")} zone="Europe/Madrid" disabled={false} onChange={() => {}} />);
  assert.match(fold, /\+01:00/); assert.match(fold, /\+02:00/); assert.match(fold, /UTC 偏移/);
  const gap = renderToStaticMarkup(<ApplicationWindowTimeField label="申请上班时间" value={{ local: "2026-03-29T02:30", offset: "" }} zone="Europe/Madrid" disabled={false} onChange={() => {}} />);
  assert.match(gap, /当地时间不存在或无效/);
});
