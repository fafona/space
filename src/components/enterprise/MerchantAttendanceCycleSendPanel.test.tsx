// Actual component SSR, pure binders and bounded synthetic HTTP only.
// No live browser, Auth, SQL, source authority or saved employee is exercised.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup as render } from "react-dom/server";
import Panel, { cycleSendPanelContext, parseCycleSendPanelSource, readCycleSendPanelSource,
  cycleSendPanelCommand, confirmCycleSend, CycleSendSourceView, CycleSendVerifiedView } from "./MerchantAttendanceCycleSendPanel";
import { cycleId, cycleOwner, cycleReadAt, cycleRecordedAt } from "../../../scripts/fixtures/attendance-cycle-intent-model";
import { createCycleSendUiModel as model } from "../../../scripts/fixtures/attendance-cycle-send-ui-model";
import type { CycleIntentResult } from "../../lib/merchantAttendanceCycleIntentResult";
import { parseCycleSendResponse } from "../../lib/merchantAttendanceCycleSendResult";
import { cycleSendCommandFingerprint } from "../../lib/merchantAttendanceCycleSend";
import { parsePeriodClosureV2HttpQuery } from "../../lib/merchantAttendancePeriodClosureV2";
import { parsePeriodDelegatedClosureHttpQuery } from "../../lib/merchantAttendancePeriodDelegatedClosure";
const sourceText = readFileSync(new URL("./MerchantAttendanceCycleSendPanel.tsx", import.meta.url), "utf8");
const response = (value: unknown) => new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });

test("200 first-send SSR is explicit, fail-closed, responsive and performs no HTTP", async () => {
  let calls = 0; const apiFetch = async () => { calls++; throw Error("unexpected HTTP"); };
  for (const access of ["owner", "delegate"] as const) {
    const m = await model(access), props = { detail: m.detail, actorId: cycleOwner, apiFetch, onClose: () => {},
      ...(access === "delegate" ? { delegateScope: m.delegateScope } : {}) };
    const html = render(<Panel {...props} isCurrentAuth={() => true}/>);
    assert.match(html, /周期首次送审/); assert.match(html, /读取当前工时来源/); assert.match(html, /仅 GET 核验首次送审原号/);
    assert.match(html, /尚未开放/); assert(!html.includes("data-cycle-send-source")); assert(!html.includes("首次送审理由"));
    assert.match(html, /min-w-0 max-w-full/); assert.match(html, /flex-wrap/);
    assert.equal(render(<Panel {...props}/>), ""); assert.equal(render(<Panel {...props} isCurrentAuth={() => false}/>), "");
    assert.equal(render(<Panel {...props} isCurrentAuth={() => { throw Error("no Auth"); }}/>), "");
  }
  assert.equal(calls, 0);
});
test("200 only the original accepting actor/unlinked head can start new send; delegate exact nine scope is mandatory", async () => {
  const m = await model(), d = await model("delegate"); assert(m.c.acceptedByActor); assert(d.c.acceptedByActor);
  if (m.detail.data.kind !== "detail") throw Error();
  for (const patch of [{ action: "cancel", revision: 2 }, { action: "link", revision: 2, periodId: cycleId(80), sendOperationId: cycleId(81) }, { actorId: cycleId(82) }]) {
    const altered = { ...m.detail, data: { ...m.detail.data, head: { ...m.detail.data.head, ...patch } } } as CycleIntentResult;
    assert.equal(cycleSendPanelContext(altered, cycleOwner).acceptedByActor, false);
  }
  assert.throws(() => cycleSendPanelContext(m.detail, cycleId(89))); assert.throws(() => cycleSendPanelContext(m.detail, cycleOwner, d.delegateScope));
  assert.throws(() => cycleSendPanelContext(d.detail, cycleOwner));
  for (const patch of [{ expectedAuthUserId: cycleId(89) }, { grantId: cycleId(89) }, { workerId: cycleId(89) }, { targetEmployeeId: cycleId(89) },
    { targetAuthUserId: cycleId(89) }, { authorizedFromDate: "2026-10-06" }, { authorizedThroughDate: "2026-10-10" }, { extra: true }])
    assert.throws(() => cycleSendPanelContext(d.detail, cycleOwner, { ...d.delegateScope, ...patch }));
  assert(Object.isFrozen(d.c)); assert(Object.isFrozen(d.c.delegateScope));
});
test("200 owner/delegate preview uses its real original route, true grant and null period with exact saved bounds", async () => {
  for (const access of ["owner", "delegate"] as const) {
    const m = await model(access); let calls = 0;
    const value = await readCycleSendPanelSource(m.c, async (url, init) => {
      calls++; assert.equal(init?.method, "GET"); assert.equal(init?.cache, "no-store"); assert.equal(init?.redirect, "error"); assert.equal(init?.body, undefined);
      const absolute = "https://synthetic.invalid" + url, q = access === "owner" ? parsePeriodClosureV2HttpQuery(absolute) : parsePeriodDelegatedClosureHttpQuery(absolute);
      assert.equal(q.periodId, null); assert.equal(q.mode, "preview"); assert.equal(q.workerId, m.c.workerId); assert.equal(q.access, access);
      assert.equal(q.fromDate, m.c.fromDate); assert.equal(q.throughDate, m.c.throughDate);
      if (q.access === "delegate") { assert.equal(q.grantId, m.c.grantId); assert(String(url).startsWith("/api/merchant-enterprise/attendance/period-delegated-closure?")); }
      else assert(String(url).startsWith("/api/merchant-enterprise/attendance/period-closures-v2?"));
      return response(m.raw);
    }, new AbortController().signal, () => true);
    assert.equal(calls, 1); assert(value.canSend); assert(Object.isFrozen(value.artifact));
    assert.equal(value.artifact.report.access, access); assert.equal(value.artifact.period.startAt, m.c.fromAt); assert.equal(value.artifact.period.endAt, m.c.toAt);
  }
});
test("200 identity/civil dates/saved timezone/canonical UTC metadata cannot drift; blockers/flag/usable actions prevent send", async () => {
  for (const access of ["owner", "delegate"] as const) {
    const m = await model(access);
    for (const patch of [{ workerId: cycleId(89) }, { employeeId: cycleId(89) }, { employeeAuthUserId: cycleId(89) }, { timeZone: "UTC" },
      { fromDate: "2026-10-06" }, { throughDate: "2026-10-10" }, { fromAt: "2026-10-05T00:00:00.000000Z" }, { toAt: "2026-10-12T00:00:00.000000Z" }]) {
      const raw = structuredClone(m.raw); Object.assign(raw.data.preview.artifact.source, patch); assert.throws(() => parseCycleSendPanelSource(raw, m.c));
    }
    const blocked = structuredClone(m.raw); blocked.data.preview.blockers.push("pending_correction");
    assert.equal(parseCycleSendPanelSource(blocked, m.c).canSend, false);
    assert.equal(parseCycleSendPanelSource({ ...m.raw, moduleEnabled: false }, m.c).canSend, false);
    assert.throws(() => cycleSendPanelCommand(m.c, parseCycleSendPanelSource(blocked, m.c), "reason", cycleId(80), cycleId(81)));
    if (access === "delegate") assert.equal(parseCycleSendPanelSource({ ...m.raw, data: { ...m.raw.data, usableActions: ["view"] } }, m.c).canSend, false);
  }
});
test("200 final first-send command copies accepted frame/source SHA with revision/version zero only after explicit confirmation", async () => {
  for (const access of ["owner", "delegate"] as const) {
    const m = await model(access), pair = cycleSendPanelCommand(m.c, m.source, "明确首次送审", cycleId(80), cycleId(81));
    assert.equal(pair.frame.intentId, m.c.intentId); assert.equal(pair.frame.expectedIntentFingerprint, m.c.expectedIntentFingerprint);
    assert.equal(pair.frame.workerId, m.c.workerId); assert.equal(pair.frame.grantId, m.c.grantId); assert.equal(pair.command.expectedRevision, 0);
    assert.equal(pair.command.expectedVersion, 0); assert.equal(pair.command.expectedFingerprint, m.source.artifact.sourceFingerprint); assert.equal(pair.command.action, "send");
    assert(Object.isFrozen(pair)); assert.throws(() => cycleSendPanelCommand(m.c, m.source, "reason", m.c.intentId, cycleId(81)));
    let ids = 0, live = true; const generate = () => { ids += 2; };
    assert.equal(confirmCycleSend(() => false, () => true, generate), false);
    assert.equal(confirmCycleSend(() => { live = false; return true; }, () => live, generate), false); assert.equal(ids, 0);
    assert.equal(confirmCycleSend(() => true, () => true, generate), true); assert.equal(ids, 2);
  }
});
test("200 source transport rejects duplicate JSON, invalid UTF8, over 4MiB, bad status/MIME, abort and late lost Auth", async () => {
  const m = await model();
  const replies = [() => new Response(JSON.stringify(m.raw).replace('"ok":true', '"ok":true,"ok":true'), { headers: { "content-type": "application/json" } }),
    () => new Response(new Uint8Array([0xc3, 0x28]), { headers: { "content-type": "application/json" } }),
    () => new Response(new Uint8Array(4194305), { headers: { "content-type": "application/json" } }),
    () => new Response("{}", { status: 503, headers: { "content-type": "application/json" } }), () => new Response("{}", { headers: { "content-type": "text/html" } })];
  for (const reply of replies) await assert.rejects(readCycleSendPanelSource(m.c, async () => reply(), new AbortController().signal, () => true));
  const stopped = new AbortController(); stopped.abort(); let calls = 0;
  await assert.rejects(readCycleSendPanelSource(m.c, async () => { calls++; return response(m.raw); }, stopped.signal, () => true)); assert.equal(calls, 0);
  let live = true; await assert.rejects(readCycleSendPanelSource(m.c, async () => { live = false; return response(m.raw); }, new AbortController().signal, () => live));
  for (const reply of [() => new Promise<Response>(() => {}), () => Promise.resolve(new Response(new ReadableStream<Uint8Array>({ start() {}, cancel() {} }), { headers: { "content-type": "application/json" } }))]) {
    const started = performance.now(); await assert.rejects(readCycleSendPanelSource(m.c, async () => reply(), new AbortController().signal, () => true, 10)); assert(performance.now() - started < 1000);
  }
});
test("200 views distinguish candidate from matching GET version1 adoption; never label employee confirmation or sealing", async () => {
  const m = await model(), preview = render(<CycleSendSourceView source={m.source}/>); assert.match(preview, /只是来源预览/); assert.match(preview, /双身份/);
  assert(!preview.includes("sourceFingerprint")); assert(!preview.includes("sourceCanonical"));
  const pair = cycleSendPanelCommand(m.c, m.source, "synthetic explicit send", cycleId(80), cycleId(81)), fingerprint = await cycleSendCommandFingerprint(pair.frame, pair.command, cycleOwner);
  const raw = { ok: true, moduleEnabled: true, data: { protocol: m.detail.protocol, siteId: m.c.siteId, actorId: cycleOwner, readAt: cycleReadAt,
    data: { kind: "linked", periodOperation: { operationId: pair.command.operationId, revision: 1, action: "send", version: 1, actorId: cycleOwner, reason: pair.command.reason,
      recordedAt: cycleRecordedAt, command: pair.command } }, receipt: { operationId: pair.command.operationId, intentId: m.c.intentId, action: "link", actorId: cycleOwner,
      revision: 2, recordedAt: cycleRecordedAt, commandFingerprint: fingerprint, periodId: pair.frame.periodId, sendOperationId: pair.command.operationId } } };
  const value = await parseCycleSendResponse(raw, pair.frame, cycleOwner, pair.command.operationId, fingerprint, pair.command), html = render(<CycleSendVerifiedView value={value.data}/>);
  assert.match(html, /原号 GET 已核验/); assert.match(html, /首次第 1 版已送审/); assert.match(html, /不表示员工已确认或工时表已封存/);
  assert.equal(render(<CycleSendVerifiedView value={{ protocol: m.detail.protocol, siteId: m.c.siteId, actorId: cycleOwner, readAt: cycleReadAt, data: { kind: "receipt" }, receipt: null }}/>), "");
});
test("200 SOURCE retains original raw slot and guard, clears body/draft on hide/scope/API/Auth, no automatic network/POST replay", () => {
  for (const token of ["marker.detail !== props.detail", "marker.actorId !== props.actorId", "marker.scopeToken !== scopeToken", "marker.apiFetch !== props.apiFetch",
    "marker.isCurrentAuth !== props.isCurrentAuth", "marker.enabled !== props.enabled", "!currentAuth(props.isCurrentAuth)", "return null", "currentAuth(isCurrentAuth)",
    "setSource(null); setVerified(null); setDraft", "setPending(null); setBlocked(true); setBusy(false); setExposed(false)", 'window.addEventListener("pagehide", pause)',
    'document.addEventListener("visibilitychange", visibility)', "registerLeaveGuard?.(mayLeave)", "working.current || client.hasLeaveRisk() || dirty()",
    "sessionStorage.getItem(client.storageKey) !== null", "原槽不是可核验的首次送审格式", "旧格式请回原周期入口核验", "await client.submit(pair.frame, pair.command)",
    "await client.recover()", "setRetired(true)", "snapshot.source.canSend", "JSON.stringify(latest.current.draft) === draftBytes", "sourceRequest.current?.abort()", "client.dispose()"])
    assert(sourceText.includes(token), token);
  assert(!sourceText.includes("removeItem(")); assert(!sourceText.includes("setInterval(")); assert(!sourceText.includes("JSON.stringify(source)"));
  const effect = sourceText.slice(sourceText.indexOf("useLayoutEffect(() =>"), sourceText.indexOf("const readSource = async"));
  assert(effect.includes("void local()")); assert(!effect.includes("readCycleSendPanelSource(")); assert(!effect.includes("client.recover()")); assert(!effect.includes("client.submit("));
  assert(sourceText.indexOf("crypto.randomUUID()") > sourceText.indexOf("confirmCycleSend(() => window.confirm"));
});
