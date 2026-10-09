import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Panel from "../components/enterprise/MerchantAttendanceRetentionPanel";
import Launcher from "../components/enterprise/MerchantAttendanceRetentionLauncher";

// SSR and source contracts only: no browser, Auth, database or write workflow is claimed.
const siteId = "99990001", actorId = "23720000-0000-4000-8000-000000000001";
const panel = () => readFileSync(new URL("../components/enterprise/MerchantAttendanceRetentionPanel.tsx", import.meta.url), "utf8");
const launcher = () => readFileSync(new URL("../components/enterprise/MerchantAttendanceRetentionLauncher.tsx", import.meta.url), "utf8");
const noop = () => {};
function between(source: string, start: string, end: string) {
  const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
  assert(a >= 0 && b > a, `Expected bounded source section ${start}`);
  return source.slice(a, b);
}

test("actual parent SSR does not open discovery, read a record or perform HTTP", () => {
  let requests = 0;
  const apiFetch = async () => { requests++; throw Error("SSR must not request"); };
  for (const periodsV2Enabled of [undefined, false, true]) {
    const html = renderToStaticMarkup(<Panel siteId={siteId} actorId={actorId} apiFetch={apiFetch} enabled periodsV2Enabled={periodsV2Enabled} onClose={noop}/>);
    assert.match(html, /考勤资料保留工作区/); assert.match(html, /按已有编号核对历史资料/);
    assert.doesNotMatch(html, /aria-label="长期周期归档查找"|data-period-id=|data-artifact-id=/);
  }
  assert.equal(requests, 0);
});

test("new flag alone never enables a disabled existing retention launcher", () => {
  let requests = 0;
  const apiFetch = async () => { requests++; throw Error("SSR must not request"); };
  assert.equal(renderToStaticMarkup(<Launcher siteId={siteId} actorId={actorId} apiFetch={apiFetch} enabled={false} periodsV2Enabled/>), "");
  assert.equal(renderToStaticMarkup(<Launcher siteId={siteId} actorId={actorId} apiFetch={apiFetch} enabled periodsV2Enabled active={false}/>), "");
  const html = renderToStaticMarkup(<Launcher siteId={siteId} actorId={actorId} apiFetch={apiFetch} enabled periodsV2Enabled/>);
  assert.match(html, /资料保留与单条保全/); assert.doesNotMatch(html, /<dialog|长期周期归档查找/); assert.equal(requests, 0);
});

test("discovery flag defaults off, with an explicit fixture override and unchanged launcher forwarding", () => {
  const source = panel();
  assert.match(source, /props\.periodsV2Enabled \?\? process\.env\.NEXT_PUBLIC_FAOLLA_ATTENDANCE_RETENTION_PERIODS_V2_ENABLED === "1"/);
  assert.match(source, /category === "period_artifact" && periodsV2Enabled && <button/);
  assert.match(source, /disabled=\{!enabled \|\| !workerId\} onClick=\{openDiscovery\}/);
  assert.match(launcher(), /periodsV2Enabled\?: boolean/); assert.match(launcher(), /<Panel \{\.\.\.props\}/);
});

test("runtime entry gate blocks dirty, directory, saving/loading and both parsed and unknown raw pending", () => {
  const gate = between(panel(), "function discoveryAllowed()", "function openDiscovery()");
  for (const term of ["!enabled", "!periodsV2Enabled", "props.active === false", "props.disabled", "!isDiscoveryScopeCurrent()",
    "hidden()", "!shown", "dirty.current", "directory.current", "snapshot.pending", '["loading", "saving"].includes(snapshot.phase)']) assert(gate.includes(term), term);
  assert.match(gate, /sessionStorage\.getItem\(retentionClientPendingKey\(siteId, actorId\)\) === null/);
  assert.match(gate, /catch \{ return false; \}/);
  assert.doesNotMatch(gate, /JSON\.parse|removeItem|setItem|endRejectedAttempt/);
});

test("opening pins current selection scope and pauses the parent without an automatic request", () => {
  const open = between(panel(), "function openDiscovery()", "function closeDiscovery()");
  assert.match(open, /!workerId \|\| activeDiscovery\.current \|\| !discoveryAllowed\(\)/);
  assert.match(open, /siteId, actorId, workerId, fromDate, throughDate/);
  assert.match(open, /activeDiscovery\.current === session && discoveryAllowed\(\)/);
  assert.match(open, /client\.pause\(\)/); assert.match(open, /activeDiscovery\.current = session; setDiscovery\(session\)/);
  assert.doesNotMatch(open, /client\.load|client\.submit|apiFetch\(|readRetention/);
});

test("selection must recheck session and identity, then performs exactly one old single-artifact GET", () => {
  const selected = between(panel(), "function selectDiscovery(", "function beginRead()");
  assert.match(selected, /!session \|\| !session\.isCurrentAuth\(\)/);
  for (const identity of ["siteId", "actorId", "workerId"]) assert(selected.includes(`selection.${identity} !== ${identity}`));
  assert(selected.indexOf("closeDiscovery();") < selected.indexOf("client.load("));
  assert.equal((selected.match(/client\.load\(/g) ?? []).length, 1);
  assert.match(selected, /client\.load\(\{ siteId, mode: "record", category: "period_artifact", recordId: selection\.artifactId \}\)/);
  assert.doesNotMatch(selected, /submit\(|mode: "preview"|readRetentionPeriods|POST|setItem|removeItem|crypto\./);
});

test("scope fence synchronously binds identity, dates, flags and the client bound to the requester", () => {
  const source = panel(), fence = between(source, "function useDiscoveryScope(", "type DiscoverySession");
  assert.match(fence, /current\.current\.key !== key \|\| current\.current\.client !== client/);
  assert.match(fence, /current\.current === scope/);
  assert.match(source, /\[siteId, actorId, apiFetch, enabled\]/);
  assert.match(source, /useDiscoveryScope\(JSON\.stringify\(\[siteId, actorId, workerId, fromDate, throughDate, enabled, periodsV2Enabled, props\.active, props\.disabled\]\), client\)/);
});

test("picker is an exclusive child rather than a second host alongside the retention editors", () => {
  const source = panel(), child = between(source, "if (discovery) return", "return <section aria-label=\"考勤资料保留工作区\"");
  assert.match(child, /<MerchantAttendanceRetentionPeriodsV2Picker \{\.\.\.discovery\}/);
  assert.match(child, /enabled=\{enabled && periodsV2Enabled\} apiFetch=\{apiFetch\}/);
  assert.match(child, /onSelect=\{selectDiscovery\} onClose=\{closeDiscovery\} registerLeaveGuard=\{registerDiscoveryGuard\}/);
  assert.equal((source.match(/<MerchantAttendanceRetentionPeriodsV2Picker/g) ?? []).length, 1);
});

test("return and outer close invalidate the child without a refresh or pending mutation", () => {
  const source = panel(), close = between(source, "function closeDiscovery()", "function selectDiscovery(");
  assert.match(close, /discoveryGuard\.current\?\.\(\)/);
  assert.match(close, /activeDiscovery\.current = null; setDiscovery\(null\)/);
  assert.doesNotMatch(close, /client\.load|initialize|submit|setItem|removeItem|readRetention/);
  assert.match(source, /discoveryGuard\.current\?\.\(\) === false/);
  assert.match(source, /client\.getSnapshot\(\) !== snapshot/);
  assert.match(source, /directory\.current\?\.abort\(\)/);
  assert.match(source, /registerLeaveGuard\?\.\(\(\) => guard\.current\(\)\)/);
});

test("existing directory/preview and explicit known-artifact paths remain separate", () => {
  const source = panel();
  assert.match(source, /readRetentionPeriods\(apiFetch, siteId, actorId, workerId, fromDate, throughDate, controller\.signal\)/);
  assert.match(source, /function preview\(\)/); assert.match(source, /mode: "preview", category, workerId, periodId/);
  assert.match(source, /归档编号（不是周期编号）/); assert.match(source, /mode: "record", category, recordId/);
  assert.match(source, /这是原操作结果；当前状态请明确重新读取/);
});
