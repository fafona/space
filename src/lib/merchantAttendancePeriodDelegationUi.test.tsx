import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Panel, { confirmPeriodDelegationAction, periodDelegationPorts, periodDelegationUtcInput } from "../components/enterprise/MerchantAttendancePeriodDelegationPanel";
import { AttendancePeriodDelegationClient } from "./merchantAttendancePeriodDelegationClient";
import { parsePeriodDelegationBody, parsePeriodDelegationResponse, periodDelegationCommandFingerprint } from "./merchantAttendancePeriodDelegation";

// Synthetic protocol values only; no SQL, browser or real account is exercised.
const id = (n: number) => `60200000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const siteId = "99990001", owner = id(1), readAt = "2026-10-08T10:00:00.000000Z";
const noop = () => {};
const source = () => readFileSync(new URL("../components/enterprise/MerchantAttendancePeriodDelegationPanel.tsx", import.meta.url), "utf8");
function intent() {
  return parsePeriodDelegationBody({
    query: { siteId, access: "owner", mode: "list", catalog: null, grantId: null, afterId: null, operationId: null },
    command: { action: "grant", operationId: id(7), delegateEmployeeId: id(2), delegateAuthUserId: id(3), workerId: id(4), employeeId: id(5), employeeAuthUserId: id(6),
      actions: ["view"], fromDate: "2026-10-01", throughDate: "2026-10-31", includeExisting: false,
      validFrom: "2026-10-08T09:00:00.000000Z", validUntil: "2026-11-08T09:00:00.000000Z", reason: "Synthetic scope test" },
  });
}
async function savedIntent() {
  const { query, command } = intent(), commandFingerprint = await periodDelegationCommandFingerprint(query, command);
  return { version: 1, anchorId: owner, actorId: owner, employeeId: null, query, command, commandFingerprint };
}

test("panel SSR performs no request or storage access and does not advertise a delegated period writer", () => {
  let calls = 0;
  const apiFetch = async () => { calls++; throw Error("SSR must not fetch"); };
  for (const access of ["owner", "delegate"] as const) {
    const html = renderToStaticMarkup(<Panel siteId={siteId} actorId={owner} authUserId={owner} access={access} enabled apiFetch={apiFetch} onClose={noop}/>);
    assert.match(html, /周期管理授权/); assert.match(html, /不包含定位证据、附件或报表导出/);
    assert.doesNotMatch(html, /<fieldset|确认授予|封存本人已确认版本/);
  }
  assert.equal(calls, 0);
});

test("UTC draft conversion is exact and rejects invalid calendar dates", () => {
  assert.equal(periodDelegationUtcInput("2026-10-08T10:20"), "2026-10-08T10:20:00.000000Z");
  for (const value of ["2026-02-30T10:20", "0000-01-01T00:00", "2026-10-08T10:20Z", "2026-10-08T24:00"]) assert.throws(() => periodDelegationUtcInput(value));
});

test("captured storage handles and requester cannot outlive their scope", async () => {
  let live = true, reads = 0, writes = 0, removes = 0, requests = 0;
  const ports = periodDelegationPorts(async () => { requests++; return new Response("ok"); }, () => ({
    getItem: () => { reads++; return "original pending bytes"; }, setItem: () => { writes++; }, removeItem: () => { removes++; },
  }), () => live);
  const captured = ports.storage(); assert.equal(captured.getItem("pending"), "original pending bytes");
  live = false;
  assert.equal(ports.isCurrentAuth(), false); assert.throws(() => ports.storage(), /identity_changed/);
  assert.throws(() => captured.getItem("pending"), /identity_changed/);
  assert.throws(() => captured.setItem("pending", "replacement"), /identity_changed/);
  assert.throws(() => captured.removeItem("pending"), /identity_changed/);
  await assert.rejects(ports.apiFetch("/synthetic", undefined), /identity_changed/);
  assert.deepEqual({ reads, writes, removes, requests }, { reads: 1, writes: 0, removes: 0, requests: 0 });
});

test("storage factory invalidation stops the operation before the returned handle is used", () => {
  let live = true, mutations = 0;
  const ports = periodDelegationPorts(async () => new Response("ok"), () => {
    live = false;
    return { getItem: () => null, setItem: () => { mutations++; }, removeItem: () => { mutations++; } };
  }, () => live);
  const captured = ports.storage(); assert.throws(() => captured.setItem("pending", "new"), /identity_changed/);
  assert.equal(mutations, 0);
});

test("storage callback invalidation is detected before callers can continue", () => {
  let live = true;
  const ports = periodDelegationPorts(async () => new Response("ok"), () => ({
    getItem: () => { live = false; return "pending"; }, setItem: noop, removeItem: noop,
  }), () => live);
  assert.throws(() => ports.storage().getItem("pending"), /identity_changed/);
});

test("late headers are rejected and their unread body is cancelled", async () => {
  let live = true, finish!: (response: Response) => void, cancelled = 0;
  const ports = periodDelegationPorts(async () => new Promise<Response>(resolve => { finish = resolve; }),
    () => ({ getItem: () => null, setItem: noop, removeItem: noop }), () => live);
  const request = ports.apiFetch("/synthetic", undefined); live = false;
  finish(new Response(new ReadableStream({ cancel: () => { cancelled++; } })));
  await assert.rejects(request, /identity_changed/); assert.equal(cancelled, 1);
});

test("real client keeps exact pending bytes when scope changes after recovery headers and before complete body", async () => {
  const pending = await savedIntent(), q = { ...pending.query, mode: "recover" as const, operationId: pending.command.operationId };
  const wire = { ok: true, protocol: "period-delegation-v1", siteId, access: "owner", actorId: owner, employeeId: null, mode: "recover", canWrite: false,
    grants: [], catalogItems: [], nextAfterId: null, detail: null, readAt,
    receipt: { operationId: pending.command.operationId, action: "grant", grantId: pending.command.operationId, grantRevision: 1,
      periodId: null, periodRevision: null, actorId: owner, recordedAt: readAt, commandFingerprint: pending.commandFingerprint } };
  parsePeriodDelegationResponse(wire, q, { authUserId: owner });
  let live = true, requests = 0, mutations = 0, releaseBody!: () => void, bodyRead!: () => void;
  const waitingForBody = new Promise<void>(resolve => { bodyRead = resolve; }), values = new Map<string, string>();
  const bytes = new TextEncoder().encode(JSON.stringify(wire));
  const ports = periodDelegationPorts(async (_path, init) => {
    requests++; assert.equal(init?.method, "GET");
    return new Response(new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(bytes.slice(0, 1)); releaseBody = () => { controller.enqueue(bytes.slice(1)); controller.close(); }; },
      pull() { bodyRead(); },
    }), { headers: { "content-type": "application/json" } });
  }, () => ({ getItem: key => values.get(key) ?? null, setItem: (key, value) => { mutations++; values.set(key, value); }, removeItem: key => { mutations++; values.delete(key); } }), () => live);
  const client = new AttendancePeriodDelegationClient({ siteId, access: "owner", actorId: owner, expectedAuthUserId: owner, enabled: false, ...ports });
  const raw = JSON.stringify(pending, null, 2); values.set(client.storageKey, raw);
  await client.initialize(); assert.equal(requests, 0);
  const recovering = client.recover(); await waitingForBody; live = false; releaseBody(); await recovering;
  assert.equal(requests, 1); assert.equal(mutations, 0); assert.equal(values.get(client.storageKey), raw);
  assert.equal(client.getSnapshot().result, null); assert.equal(client.getSnapshot().pending?.command.operationId, pending.command.operationId);
});

test("confirmation checks scope both before and after the dialog", () => {
  let prompts = 0, acts = 0, live = false;
  const ask = () => { prompts++; return true; }, act = () => { acts++; };
  assert.equal(confirmPeriodDelegationAction(ask, () => live, act), false); assert.equal(prompts, 0);
  live = true;
  assert.equal(confirmPeriodDelegationAction(() => { prompts++; live = false; return true; }, () => live, act), false);
  assert.deepEqual({ prompts, acts }, { prompts: 1, acts: 0 });
});

test("a changed selected/read snapshot or draft generation invalidates modal confirmation", () => {
  for (const change of ["snapshot", "generation"] as const) {
    const original = {}, generation = 1; let currentSnapshot = original, currentGeneration = generation, acts = 0;
    const current = () => currentSnapshot === original && currentGeneration === generation;
    assert.equal(confirmPeriodDelegationAction(() => {
      if (change === "snapshot") currentSnapshot = {}; else currentGeneration++;
      return true;
    }, current, () => { acts++; }), false);
    assert.equal(acts, 0);
  }
});

test("cancelled leave keeps current state; accepted leave pauses immediately without removing pending", async () => {
  const pending = await savedIntent(), values = new Map<string, string>(); let requests = 0, cleared = 0;
  const client = new AttendancePeriodDelegationClient({ siteId, access: "owner", actorId: owner, expectedAuthUserId: owner, enabled: false,
    storage: () => ({ getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); }, removeItem: key => { values.delete(key); } }),
    apiFetch: async () => { requests++; throw Error("must not fetch"); } });
  const raw = JSON.stringify(pending); values.set(client.storageKey, raw); await client.initialize();
  const snapshot = client.getSnapshot(), current = () => snapshot === client.getSnapshot();
  const leave = () => { client.pause(); cleared++; };
  assert.equal(confirmPeriodDelegationAction(() => false, current, leave), false);
  assert.equal(client.getSnapshot(), snapshot); assert.equal(cleared, 0);
  assert.equal(confirmPeriodDelegationAction(() => true, current, leave), true);
  assert.notEqual(client.getSnapshot(), snapshot); assert.equal(cleared, 1);
  assert.equal(values.get(client.storageKey), raw); assert.equal(client.getSnapshot().pending?.command.operationId, pending.command.operationId); assert.equal(requests, 0);
});

test("render-time token includes every identity/requester/gate and cannot resurrect an A-B-A lease", () => {
  const code = source();
  for (const field of ["props.siteId", "props.access", "props.actorId", "props.authUserId"]) assert(code.includes(field));
  assert.match(code, /live\.current\.apiFetch !== props\.apiFetch/); assert.match(code, /live\.current\.authCheck !== props\.isCurrentAuth/);
  assert.match(code, /live\.current\.enabled !== enabled/); assert.match(code, /token: live\.current\.token \+ 1/);
  assert.match(code, /live\.current\.token === token && props\.isCurrentAuth\?\.\(\) !== false/);
  assert.match(code, /<Prepared key=\{token\}/); assert.match(code, /periodDelegationPorts\(props\.apiFetch, \(\) => sessionStorage, props\.isCurrent\)/);
});

test("actual grant, revoke and external leave use the same current-snapshot guards", () => {
  const code = source();
  assert.match(code, /snapshot === client\.getSnapshot\(\)/); assert.match(code, /registerLeaveGuard\?\.\(leave\)/);
  assert.match(code, /const invalidate = useCallback\(\(\) => \{ epoch\.current\+\+; client\.pause\(\); clear\(\); \}/);
  assert.match(code, /current\(generation, snapshot\), \(\) => \{ epoch\.current\+\+; clear\(\); submission = client\.grant\(value\); \}/);
  assert.match(code, /if \(submission\) await submission/);
  assert.match(code, /current\(generation, snapshot\) && !locked/); assert.match(code, /void client\.revoke\(grantId, reason!\)/);
  assert.match(code, /setDraft\(initial\(\)\); setError\(""\); state\.query\?\.catalog/);
  for (const event of ["visibilitychange", "pagehide", "pageshow", "beforeunload"]) assert(code.includes(event));
  assert.doesNotMatch(code, /localStorage|setInterval|client\.retry|client\.submit/);
});
