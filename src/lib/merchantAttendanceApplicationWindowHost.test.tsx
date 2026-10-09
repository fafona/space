//243 SSR and source-wiring checks only; no browser/Auth/SQL acceptance claims.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Correction from "../components/enterprise/MerchantAttendanceCorrectionWorkspace";
import Revision from "../components/enterprise/MerchantAttendanceRevisionWorkspace";
import Missing from "../components/enterprise/MerchantAttendanceMissingPanel";
import Recovery from "../components/enterprise/MerchantAttendanceApplicationWindowRecoveryLauncher";
import { applicationWindowLegacyPorts } from "./merchantAttendanceApplicationWindowClient";
import { windowActor, windowId as id, windowSite } from "./merchantAttendanceApplicationWindowTestFixtures";
import { correctionEmployee } from "../../scripts/fixtures/attendance-correction-model";
const source = (name: string) => readFileSync(new URL(`../components/enterprise/${name}.tsx`, import.meta.url), "utf8");
test("243 three actual hosts render original headings/defaultoff with no SSR HTTP and separate Auth-bound recovery", () => {
  let calls = 0; const apiFetch = async () => { calls++; throw Error("No network in SSR"); }, common = { siteId: windowSite, apiFetch, onClose: () => {}, applicationWindowEnabled: false };
  for (const node of [<Correction key="correction" {...common} employeeId={correctionEmployee} authUserId={windowActor} />, <Revision key="revision" {...common} employeeId={correctionEmployee} authUserId={windowActor} initialTarget={null} />,
    <Missing key="missing" {...common} actorId={correctionEmployee} authUserId={windowActor} access="self" />]) {
    const html = renderToStaticMarkup(node); assert.match(html, /核验规则窗口原编号/); assert(!html.includes('aria-label="规则申请窗口"')); assert(!html.includes("提交本人申请"));
  }
  assert.equal(calls, 0);
});
test("243 absent realAuth never substitutes employee/actor identity and ownerMissing never gets self window entry", () => {
  const common = { siteId: windowSite, apiFetch: async () => { throw Error("No HTTP"); }, onClose: () => {}, applicationWindowEnabled: true };
  for (const node of [<Correction key="correction" {...common} employeeId={correctionEmployee} />, <Revision key="revision" {...common} employeeId={correctionEmployee} initialTarget={null} />,
    <Missing key="self" {...common} actorId={correctionEmployee} access="self" />, <Missing key="owner" {...common} actorId={windowActor} authUserId={windowActor} access="owner" />]) {
    assert(!renderToStaticMarkup(node).includes("核验规则窗口原编号"));
  }
});
test("243 new recovery launcher mount is inert; saved-query discovery never advertises submit or approval", () => {
  let called = 0; const html = renderToStaticMarkup(<Recovery siteId={windowSite} employeeId={correctionEmployee} authUserId={windowActor} family="missing" beforeDiscover={() => { called++; return true; }} onSelect={() => { called++; }} />);
  assert.equal(called, 0); assert.match(html, /核验规则窗口原编号/); assert(!html.includes("打开原编号核对")); assert(!html.includes("提交本人申请"));
});
test("243 all hosts pause legacy before exclusive new panel; parent guard hands over without a second writer", () => {
  for (const name of ["MerchantAttendanceCorrectionWorkspace", "MerchantAttendanceRevisionWorkspace", "MerchantAttendanceMissingPanel"]) {
    const text = source(name); assert.match(text, /client\.pause\(\)[\s\S]{0,100}setWindowTarget\(/); assert.match(text, /if\s*\(windowTarget[^\n]*return <ApplicationWindowPanel/);
    assert.match(text, /applicationWindowLegacyPorts\(/); assert.match(text, /registerLeaveGuard=\{registerLeaveGuard\}/); assert.match(text, /if\s*\(windowTarget/);
    assert.match(text, /token:scope\.current\.token\+1/); assert.match(text, /isCurrentAuth=\{isCurrentAuth\}/);
  }
  const self = source("MerchantAttendanceSelfPanel"); assert.match(self, /<CorrectionWorkspace[^\n]*authUserId=\{authUserId\}[^\n]*registerLeaveGuard=\{registerCorrectionLeaveGuard\}/);
  assert.match(self, /<MissingLauncher[^\n]*authUserId=\{authUserId\}[^\n]*registerLeaveGuard=\{registerMissingLeaveGuard\}/);
  assert.match(self, /missingLeaveGuard\.current \|\| missingLeaveGuard\.current\(\)/);
});
test("243 missing verified full draft/start/ack passes to new read before any original submit; old off branch preserved", () => {
  const text = source("MerchantAttendanceMissingPanel"), branch = text.slice(text.indexOf("const submit ="), text.indexOf("const r = state.result"));
  assert.match(branch, /windowAvailable&&\(intent\.action==="submit"\|\|intent\.action==="revise"\)/);
  assert.match(branch, /proposedStartAt:intent\.proposal\.startAt/); assert.match(branch, /proposal:intent\.proposal,reason:intent\.reason/);
  assert(branch.indexOf("setWindowTarget") < branch.indexOf("void client.submit(intent)")); assert.match(branch, /\}return;/);
  assert.match(text, /if \(disabled \|\| !ack\) return/); assert.match(text, /missingProposal\(correctionDraftProposal/); assert.match(text, /initialProposal=\{windowTarget\.proposal\} initialReason=\{windowTarget\.reason\}/);
  assert.match(text, /windowEnabled\?"继续核验规则窗口":revision \? "提交整段修订" : "提交整段申请"/);
});
test("243 carried seed is single-use, clears on hide/leave, and never bypasses fresh read plus new acknowledgement", () => {
  const text = source("MerchantAttendanceApplicationWindowPanel"); assert.match(text, /seed\.current = null; dirtyRef\.current = false/);
  assert.match(text, /held\?\.proposal/); assert.match(text, /seed\.current = null; \} \}/); assert.match(text, /setAck\(\{ marker, value: false \}\); await client\.prepare\(next\)/);
  assert.match(text, /!!result\?\.canSubmit && result\.mode === "prepare"/); assert.match(text, /ack\.marker === marker && ack\.value/);
});
test("243 old host ports fence late response and each storage action immediately when Auth/requester changes", async () => {
  let current = true, cancelled = false, finish: ((r: Response) => void) | null = null; const values = new Map([["pending", "original"]]);
  const ports = applicationWindowLegacyPorts(async () => new Promise<Response>(resolve => { finish = resolve; }), () => ({ getItem: k => values.get(k) ?? null, setItem: (k, v) => { values.set(k, v); }, removeItem: k => { values.delete(k); } }), () => current);
  const store = ports.storage(); assert.equal(store.getItem("pending"), "original"); const inflight = ports.apiFetch("/synthetic", { method: "GET" }); current = false;
  assert(finish); (finish as (r: Response) => void)(new Response(new ReadableStream({ cancel() { cancelled = true; } })));
  await assert.rejects(inflight, /stale_scope/); assert.equal(cancelled, true); for (const fn of [() => store.getItem("pending"), () => store.setItem("pending", "changed"), () => store.removeItem("pending")]) assert.throws(fn, /stale_scope/);
  assert.equal(values.get("pending"), "original"); assert.equal(id(1), windowActor);
});
