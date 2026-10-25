import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import RecordsPanel, { AttendanceRecordsDateField } from "../components/enterprise/MerchantAttendanceRecordsPanel";
import { attendanceRecordsDateQuery } from "./merchantAttendanceManagementClient";

const parentText = readFileSync(new URL("../components/admin/MerchantEnterpriseManager.tsx", import.meta.url), "utf8");
const fieldText = readFileSync(new URL("../components/enterprise/MerchantAttendanceRecordsPanel.tsx", import.meta.url), "utf8");
const parse = (text: string) => ts.createSourceFile("actual.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const parent = parse(parentText), fields = parse(fieldText);
function find(source: ts.SourceFile, predicate: (node: ts.Node) => boolean) {
  const found: ts.Node[] = [];
  function visit(node: ts.Node) { if (predicate(node)) found.push(node); ts.forEachChild(node, visit); }
  visit(source); assert.equal(found.length, 1, "execute the unique actual source handler"); return found[0];
}
function variable(name: string) {
  const node = find(parent, n => ts.isVariableDeclaration(n) && n.name.getText(parent) === name) as ts.VariableDeclaration;
  const value = node.initializer!;
  return ts.isCallExpression(value) && value.expression.getText(parent) === "useCallback" ? value.arguments[0].getText(parent) : value.getText(parent);
}
function expression<T>(source: string, context: Record<string, unknown>): T {
  const code = ts.transpileModule(`const actual = ${source};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return runInNewContext(`(() => { ${code}\nreturn actual; })()`, context) as T;
}
const unloadEffect = find(parent, n => ts.isCallExpression(n) && n.expression.getText(parent) === "useEffect"
  && !!n.arguments[0]?.getText(parent).includes("const preventUnsavedUnload")) as ts.CallExpression;
type Guard = { scope: string; guard: () => boolean };
function navigation(tab = "attendanceRecords", actorType = "owner") {
  const prompts: string[] = [], notices: unknown[] = [], listeners = new Set<(e: { preventDefault: () => void; returnValue?: string }) => void>();
  const state = { answer: false, busy: false }, noop = () => {};
  const attendanceLeaveScope = `99990001:${actorType}:${tab}`;
  const context = { actor: { id: "synthetic-viewer", type: actorType }, tab, attendanceLeaveScope, canAutoRefreshOnFocus: false,
    get busy() { return state.busy; }, accountStatusClient: null, hasStoredAttendanceScopeOperation: () => false,
    attendanceLeaveGuardRef: { current: null as Guard | null }, correctionLeaveGuardRef: { current: null as Guard | null },
    window: { confirm: (message: string) => { prompts.push(message); return state.answer; },
      addEventListener: (_type: string, fn: (e: { preventDefault: () => void; returnValue?: string }) => void) => { listeners.add(fn); },
      removeEventListener: (_type: string, fn: (e: { preventDefault: () => void; returnValue?: string }) => void) => { listeners.delete(fn); } },
    setMessage: (value: unknown) => notices.push(value), setEditingTaskId: noop, setDraggingTaskId: noop, setShowBoardSettings: noop,
    setMobileTaskComposerOpen: noop, currentWorkEmployeeIdRef: { current: "" }, employeeCurrentWorkGenerationRef: { current: 0 },
    employeeCurrentWorkAbortRef: { current: null }, setCurrentWorkEmployeeId: noop, setEmployeeCurrentWork: noop, EMPTY_CURRENT_OPERATIONS_STATE: {},
  };
  const navigate = expression<(view: string | null) => boolean>(variable("confirmViewChange"), context);
  const install = () => expression<() => (() => void) | undefined>(unloadEffect.arguments[0].getText(parent), context)();
  return { context, state, prompts, notices, listeners, navigate, install };
}

test("read-only attendance records never invent edits on menu/module exits, for owner or manager, including lazy loading", () => {
  for (const actor of ["owner", "employee"]) {
    const h = navigation("attendanceRecords", actor);
    for (const destination of ["tasks", "attendanceScopes", "audit", null, "attendanceRecords"]) assert.equal(h.navigate(destination), true);
    assert.deepEqual(h.prompts, []); assert.equal(h.install(), undefined); assert.equal(h.listeners.size, 0);
  }
});
test("query filters do not enable background overview refresh or discard protections in other editors", () => {
  assert.doesNotMatch(variable("canAutoRefreshOnFocus"), /attendanceRecords/);
  for (const tab of ["tasks", "roles", "attendanceAdmin", "attendance"]) {
    const h = navigation(tab); assert.equal(h.navigate(null), false); assert.match(h.prompts[0], /未保存/);
    h.state.answer = true; assert.equal(h.navigate("audit"), true);
    const cleanup = h.install(); assert.equal(h.listeners.size, 1);
    let prevented = false; for (const listener of h.listeners) listener({ preventDefault: () => { prevented = true; } });
    assert.equal(prevented, true); cleanup?.(); assert.equal(h.listeners.size, 0);
  }
});
test("busy-save protection and explicit scope-matched child guards still take priority over read-only exemption", () => {
  const h = navigation(); h.state.busy = true;
  assert.equal(h.navigate("tasks"), false); assert.equal(h.notices.length, 1); assert.deepEqual(h.prompts, []);
  assert.equal(h.navigate("attendanceRecords"), true); h.state.busy = false;
  let calls = 0;
  h.context.attendanceLeaveGuardRef.current = { scope: h.context.attendanceLeaveScope, guard: () => { calls++; return false; } };
  assert.equal(h.navigate(null), false); assert.equal(calls, 1);
  h.context.correctionLeaveGuardRef.current = { scope: h.context.attendanceLeaveScope, guard: () => true };
  assert.equal(h.navigate("tasks"), true); assert.equal(calls, 1);
  h.context.correctionLeaveGuardRef.current = null;
  h.context.attendanceLeaveGuardRef.current.scope = "other-site-or-old-tab";
  assert.equal(h.navigate("tasks"), true); assert.equal(calls, 1); assert.deepEqual(h.prompts, []);
});
test("manual collaboration refresh does not invent records edits, while real editors still require confirmation", async () => {
  for (const tab of ["attendanceRecords", "tasks", "roles"]) {
    const h = navigation(tab); let refreshes = 0;
    const context = { ...h.context, canAutoRefreshOnFocusRef: { current: false }, overviewAbortControllerRef: { current: null as AbortController | null },
      loadOverview: async (options: { preserveData: boolean }) => { assert.equal(options.preserveData, true); refreshes++; return true; } };
    const refresh = expression<() => Promise<void>>(variable("refreshOverview"), context);
    await refresh(); assert.equal(refreshes, tab === "attendanceRecords" ? 1 : 0);
    assert.equal(h.prompts.length, tab === "attendanceRecords" ? 0 : 1);
    context.overviewAbortControllerRef.current = new AbortController();
    await refresh(); assert.equal(refreshes, tab === "attendanceRecords" ? 1 : 0);
  }
});
test("SSR exposes two labelled ISO text fields, retains invisible native pickers and performs no business request", () => {
  let requests = 0;
  const html = renderToStaticMarkup(<RecordsPanel siteId="99990001" actorId="synthetic-owner" access="owner"
    apiFetch={async () => { requests++; throw Error("no SSR IO"); }} />);
  assert.equal(requests, 0); assert.equal((html.match(/placeholder="YYYY-MM-DD"/g) ?? []).length, 2);
  assert.equal((html.match(/type="text"/g) ?? []).length, 2); // dates are explicit, the zone uses default text type
  assert.equal((html.match(/type="date"/g) ?? []).length, 2);
  assert.equal((html.match(/pointer-events-none[^\"]*opacity-0/g) ?? []).length, 2);
  assert.equal((html.match(/type="button" aria-label="选择/g) ?? []).length, 2);
  assert.match(html, /data-no-translate="1" translate="no"/);
  assert.match(html, /UTC/); assert.match(html, /不推算缺卡、工资或应出勤时数/);
});
test("fixed display preserves exact ISO values, blank/partial input, and rejects invalid dates without clamping or timezone shifts", () => {
  for (const date of ["2026-10-25", "2024-02-29", "2026-02-30", "2026-1", ""]) {
    const html = renderToStaticMarkup(<AttendanceRecordsDateField label="开始日期" value={date} onChange={() => assert.fail("SSR is read only")} />);
    assert.ok(html.includes(`value="${date}"`)); assert.match(html, /required=""/);
  }
  for (const [from, through] of [["2026-02-30", "2026-03-01"], ["2026-1", "2026-10-25"], ["2026-10-25", "2026-10-24"]])
    assert.throws(() => attendanceRecordsDateQuery("99990001", "owner", from, through, "UTC"));
  const q = attendanceRecordsDateQuery("99990001", "owner", "2026-10-25", "2026-10-25", "Europe/Madrid");
  assert.equal(Date.parse(q.toAt) - Date.parse(q.fromAt), 25 * 3600000); // autumn DST stays unchanged
});
test("calendar button invokes native picker; unsupported/blocked picker falls back without submitting or changing dates", () => {
  const declaration = find(fields, n => ts.isFunctionDeclaration(n) && n.name?.text === "AttendanceRecordsDateField");
  const noExport = declaration.getText(fields).replace(/^export /, "");
  for (const mode of ["supported", "unsupported", "blocked", "unavailable"] as const) {
    const calls: string[] = [], refs: { current: unknown }[] = [], changes: string[] = [];
    const code = ts.transpileModule(`${noExport}\nmodule.exports = AttendanceRecordsDateField;`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;
    const sandboxModule = { exports: null as unknown };
    runInNewContext(code, { module: sandboxModule, React, input: "field", useId: () => "synthetic-date",
      useRef: () => { const ref = { current: null }; refs.push(ref); return ref; } });
    const field = sandboxModule.exports as typeof AttendanceRecordsDateField;
    const tree = field({ label: "开始日期", value: "2026-10-25", onChange: value => changes.push(value) });
    type El = React.ReactElement<Record<string, unknown>>;
    function all(node: React.ReactNode): El[] {
      if (!React.isValidElement(node)) return [];
      const el = node as El; return [el, ...React.Children.toArray(el.props.children as React.ReactNode).flatMap(all)];
    }
    const nodes = all(tree), button = nodes.find(n => n.type === "button")!;
    refs[0].current = { ...(mode === "unsupported" ? {} : { showPicker: () => { calls.push("picker"); if (mode !== "supported") throw Error("blocked"); } }),
      focus: () => calls.push("native-focus"), click: () => { calls.push("native-click"); if (mode === "unavailable") throw Error("no picker"); } };
    refs[1].current = { focus: () => calls.push("text-focus") };
    assert.equal(button.props.type, "button"); (button.props.onClick as () => void)();
    assert.deepEqual(calls, mode === "supported" ? ["picker"] : mode === "unsupported" ? ["native-focus", "native-click"]
      : mode === "blocked" ? ["picker", "native-focus", "native-click"] : ["picker", "native-focus", "native-click", "text-focus"]);
    assert.deepEqual(changes, []);
    for (const node of nodes.filter(n => n.type === "input")) (node.props.onChange as (e: { target: { value: string } }) => void)({ target: { value: "2026-10-26" } });
    assert.deepEqual(changes, ["2026-10-26", "2026-10-26"]);
  }
});
