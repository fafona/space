import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup as render } from "react-dom/server";
import Print from "../components/enterprise/MerchantAttendanceOutagePrint";
import Launcher, { outageLauncherVisible } from "../components/enterprise/MerchantAttendanceOutageLauncher";
import { outagePanelPrintPending } from "../components/enterprise/MerchantAttendanceOutagePanel";
import { outageClientPendingKey } from "./merchantAttendanceOutageClient";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const options = { siteId: "99990001", actorId: id(1), access: "owner" as const, declarationId: id(3),
  apiFetch: async () => { throw Error("render must not fetch"); }, available: () => true, contextKey: "synthetic" };

test("default-disabled print tools perform no reads; explicit owner entry requires acknowledgement", () => {
  assert.equal(render(<Print {...options} enabled={false}/>), "");
  const text = render(<Print {...options} enabled/>);
  for (const label of ["打印空白备用表", "重新核验并打印此声明交接单", "确认保管故障交接资料", "不是封存报表", "未缓存的网页不保证能打开"]) assert(text.includes(label), label);
  assert.match(text, /disabled=""[^>]*>重新核验并打印此声明交接单/);
  assert(!text.includes(options.actorId)); assert(!text.includes("<iframe"));
});
test("self and unselected owner retain blank preparation but cannot print saved handoff", () => {
  for (const props of [{ ...options, access: "self" as const }, { ...options, declarationId: null }]) {
    const text = render(<Print {...props} enabled/>);
    assert(text.includes("打印空白备用表")); assert(!text.includes("重新核验并打印此声明交接单"));
    assert(!text.includes("确认保管故障交接资料"));
  }
});
test("independent paper flag keeps preparation reachable while new outage writing is disabled", () => {
  assert(!outageLauncherVisible(false, false, false)); assert(outageLauncherVisible(false, false, false, true));
  assert(render(<Launcher {...options} enabled={false} printEnabled/>).includes("故障备用纸表与资料核对"));
  assert.equal(render(<Launcher {...options} enabled={false} printEnabled={false}/>), "");
});
test("actual workspace additive hook retains pending/draft guards and independent flag", () => {
  const panel = source("../components/enterprise/MerchantAttendanceOutagePanel.tsx"), launcher = source("../components/enterprise/MerchantAttendanceOutageLauncher.tsx");
  for (const token of ['lazy(() => import("./MerchantAttendanceOutagePrint"))', "declarationId={resolutionDeclarationId}",
    "!busy && !pending && !risk()", "NEXT_PUBLIC_FAOLLA_ATTENDANCE_OUTAGE_PRINT_ENABLED", "disabled={!readable || knownRecoveries.blocked", "!outagePanelPrintPending(sessionStorage, siteId, access, actorId)"]) assert(panel.includes(token), token);
  assert(launcher.includes("printEnabled?: boolean")); assert(launcher.includes("<Panel {...props}"));
});
test("print-only live exact-key guard blocks all pending kinds without mutation or foreign scans", () => {
  const values = new Map<string, string>(), queried: string[] = [];
  const storage = { getItem(key: string) { queried.push(key); return values.get(key) ?? null; } };
  const { siteId, actorId, access } = options;
  assert.equal(outagePanelPrintPending(storage, siteId, access, actorId), false);
  for (const kind of ["outages", "links", "reviews", "relations"] as const) {
    const key = outageClientPendingKey(kind, siteId, access, actorId);
    values.set(key, "malformed or unknown pending bytes");
    assert.equal(outagePanelPrintPending(storage, siteId, access, actorId), true);
    assert.equal(values.get(key), "malformed or unknown pending bytes"); values.delete(key);
  }
  values.set(outageClientPendingKey("reviews", siteId, access, id(9)), "foreign");
  assert.equal(outagePanelPrintPending(storage, siteId, access, actorId), false);
  assert.equal(outagePanelPrintPending({ getItem: () => { throw Error("storage unavailable"); } }, siteId, access, actorId), true);
  assert(queried.every(key => (["outages", "links", "reviews", "relations"] as const).some(kind => key === outageClientPendingKey(kind, siteId, access, actorId))));
});
test("print lifetime revokes before late delivery on scope changes, visibility, pagehide and unmount", () => {
  const text = source("../components/enterprise/MerchantAttendanceOutagePrint.tsx");
  for (const token of ["value.scope === scope", "value.props.apiFetch === props.apiFetch", "value.props.available()", "!document.hidden",
    "useLayoutEffect", "client.invalidate()", '"visibilitychange"', '"pagehide"', "key={scope}", "props.contextKey"]) assert(text.includes(token), token);
  for (const token of ["localStorage", "sessionStorage", "window.print", "window.open", "dangerouslySetInnerHTML"]) assert(!text.includes(token), token);
});
