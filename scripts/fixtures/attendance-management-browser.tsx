import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import MerchantAttendanceScopePanel from "../../src/components/enterprise/MerchantAttendanceScopePanel";
import MerchantAttendanceRecordsPanel from "../../src/components/enterprise/MerchantAttendanceRecordsPanel";
import { parseAttendanceScopeCommand, type AttendanceRecord, type AttendanceScopeCommand, type AttendanceScopeReceipt } from "../../src/lib/merchantAttendanceManagement";
import type { AttendanceManagementGrant } from "../../src/lib/merchantAttendanceScope";
import type { AttendanceApiFetch } from "../../src/lib/merchantAttendanceSelfClient";

// Synthetic memory-only data, no auth, network, real users or business writes.
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const siteId = "99990001", ownerId = id(1), managerId = id(2);
const worker = (n: number) => ({ id: id(100 + n), label: `合成人员 ${String(n).padStart(2, "0")}`, detail: `T${n}`, eligible: n !== 28 });
const workers = Array.from({ length: 28 }, (_, n) => worker(n + 1));
const locations = [{ id: id(200), label: "合成门店 A", detail: "Europe/Madrid", eligible: true }, { id: id(201), label: "合成门店 B", detail: "UTC", eligible: false }];
let version = 0, grants: AttendanceManagementGrant[] = [], moduleEnabled = true, lost = false, denied = false, posts = 0, reads = 0;
const receipts = new Map<string, { command: AttendanceScopeCommand; receipt: AttendanceScopeReceipt }>();
let notify = () => {};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const row = (n: number, day: string): AttendanceRecord => ({ id: id(9000 - n), workerId: worker(n % 2 + 1).id, locationId: locations[n % 2].id,
  workerName: worker(n % 2 + 1).label, workerNo: `T${n % 2 + 1}`, locationName: locations[n % 2].label, sequence: 100 - n,
  action: "clock_in", source: "web", timeZone: "Europe/Madrid", breakPaid: null, occurredAt: `${day}T12:00:00.${String(999999 - n).padStart(6, "0")}Z` });
const apiFetch: AttendanceApiFetch = async (path, init) => {
  const u = new URL(path, "https://synthetic.invalid"), q = u.searchParams;
  reads++; notify();
  if (u.pathname.endsWith("/choices")) {
    const kind = q.get("kind"), cursor = q.get("cursor"), search = q.get("search") ?? "", ids = q.get("ids")?.split(",");
    const choices = (kind === "managers" ? [{ id: managerId, label: "合成主管 A", detail: "active", eligible: true }, { id: id(3), label: "合成主管 B", detail: "disabled", eligible: false }] : kind === "workers" ? workers : locations)
      .filter(x => (!cursor || x.id > cursor) && (!ids || ids.includes(x.id)) && (x.label + x.detail).includes(search));
    return json({ ok: true, moduleEnabled, siteId, kind, items: choices.slice(0, 25), nextCursor: choices.length > 25 ? choices[24].id : null });
  }
  if (u.pathname.endsWith("/scopes")) {
    const command = init?.method === "POST" ? parseAttendanceScopeCommand(JSON.parse(String(init.body))).command : null;
    if (command) {
      posts++; notify();
      if (!moduleEnabled && command.action === "put") return json({ ok: false, error: "attendance_platform_paused" }, 403);
      if (!receipts.has(command.operationId)) {
        if (command.expectedRevision !== version) return json({ ok: false, error: "attendance_version_conflict" }, 409);
        version++; grants = grants.filter(g => g.id !== command.grantId);
        if (command.action === "put") grants.push({ id: command.grantId, ...command.grant! });
        receipts.set(command.operationId, { command, receipt: { operationId: command.operationId, revision: version, action: command.action, grantId: command.grantId } });
        notify();
      }
      if (lost) { lost = false; notify(); throw Error("synthetic_response_lost"); }
    }
    return json({ ok: true, moduleEnabled, scope: { siteId, employeeId: command ? managerId : q.get("employeeId"), revision: version, grants },
      receipt: receipts.get(command?.operationId ?? q.get("operationId") ?? "")?.receipt ?? null });
  }
  if (u.pathname.endsWith("/records")) {
    if (denied) return json({ ok: false, error: "attendance_access_denied" }, 403);
    const day = q.get("fromAt")!.slice(0, 10), cursor = q.get("cursorAt"), asOf = q.get("asOf") ?? new Date().toISOString().replace("Z", "000Z");
    const matched = Array.from({ length: 56 }, (_, n) => row(n, day)).filter(r => r.occurredAt < asOf && (!cursor || r.occurredAt < cursor)
      && (!q.get("workerId") || r.workerId === q.get("workerId")) && (!q.get("locationId") || r.locationId === q.get("locationId")));
    const items = matched.slice(0, 50), tail = items.at(-1);
    return json({ ok: true, moduleEnabled, siteId, access: q.get("access"), scopeRevision: q.get("access") === "owner" ? null : version,
      asOf, items, nextCursor: matched.length > 50 && tail ? { id: tail.id, occurredAt: tail.occurredAt } : null });
  }
  throw Error("unexpected_synthetic_request");
};
function Harness() {
  const [, render] = useState(0), [screen, setScreen] = useState<"scope" | "manager" | "owner">("scope"), [mount, setMount] = useState(0);
  useEffect(() => { notify = () => render(n => n + 1); return () => { notify = () => {}; }; }, []);
  return <><div className="qa-toolbar"><strong>隔离考勤组件验收 · 仅合成数据 · 禁止生产连接</strong><div className="qa-controls">
    <button onClick={() => setScreen("scope")}>负责人授权页</button><button onClick={() => setScreen("manager")}>主管明细页</button><button onClick={() => setScreen("owner")}>负责人明细页</button>
    <button onClick={() => setMount(n => n + 1)}>重新挂载组件</button><button onClick={() => { lost = !lost; notify(); }}>下一次保存丢响应：{lost ? "开" : "关"}</button>
    <button onClick={() => { moduleEnabled = !moduleEnabled; notify(); }}>平台暂停：{moduleEnabled ? "关" : "开"}</button><button onClick={() => { denied = !denied; notify(); }}>明细撤权：{denied ? "开" : "关"}</button>
  </div><div role="status">合成 POST {posts} · 授权版本 {version} · 收据 {receipts.size} · 总读取 {reads}</div></div>
    <main className="qa-main">{screen === "scope" ? <MerchantAttendanceScopePanel key={mount} siteId={siteId} ownerId={ownerId} apiFetch={apiFetch} />
      : <MerchantAttendanceRecordsPanel key={`${mount}:${screen}`} siteId={siteId} actorId={screen === "owner" ? ownerId : managerId} access={screen} apiFetch={apiFetch} />}</main></>;
}
createRoot(document.getElementById("qa-root")!).render(<Harness />);
