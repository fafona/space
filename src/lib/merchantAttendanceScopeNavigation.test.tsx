import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import ScopePanel, { attendanceScopeDraftIsDirty as dirty } from "../components/enterprise/MerchantAttendanceScopePanel";
import type { AttendanceManagementGrant } from "./merchantAttendanceScope";
import { AttendanceScopeClient } from "./merchantAttendanceManagementClient";

const scopeText = readFileSync(new URL("../components/enterprise/MerchantAttendanceScopePanel.tsx", import.meta.url), "utf8");
const parentText = readFileSync(new URL("../components/admin/MerchantEnterpriseManager.tsx", import.meta.url), "utf8");
function parse(text: string) { return ts.createSourceFile("panel.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX); }
const scope = parse(scopeText), parent = parse(parentText);
function find(source: ts.SourceFile, predicate: (node: ts.Node) => boolean) {
  const results: ts.Node[] = [];
  function walk(node: ts.Node) { if (predicate(node)) results.push(node); ts.forEachChild(node, walk); }
  walk(source); assert.equal(results.length, 1, "the actual handler/effect must be unambiguous"); return results[0];
}
function variable(source: ts.SourceFile, name: string) {
  const node = find(source, n => ts.isVariableDeclaration(n) && n.name.getText(source) === name) as ts.VariableDeclaration;
  const value = node.initializer!;
  return ts.isCallExpression(value) && value.expression.getText(source) === "useCallback" ? value.arguments[0].getText(source) : value.getText(source);
}
function effect(source: ts.SourceFile, hook: string, marker: string) {
  const node = find(source, n => ts.isCallExpression(n) && n.expression.getText(source) === hook && !!n.arguments[0]?.getText(source).includes(marker)) as ts.CallExpression;
  return node.arguments[0].getText(source);
}
function expression<T>(text: string, context: Record<string, unknown>): T {
  const js = ts.transpileModule(`const actual = ${text};`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  return runInNewContext(`${js}\nactual;`, context) as T;
}
const installScope = effect(scope, "useLayoutEffect", "const hasPending");
const installParentUnload = effect(parent, "useEffect", "const preventUnsavedUnload");
const parentNavigation = variable(parent, "confirmViewChange");
const storedScopeOperation = variable(parent, "hasStoredAttendanceScopeOperation");
type Guard = () => boolean;
type Unload = { returnValue: string | undefined; preventDefault: () => void };
function harness() {
  const stored = new Map<string, string>(), prompts: string[] = [], listeners = new Set<(event: Unload) => void>();
  let guard: Guard | null = null, cleanup: (() => void) | undefined;
  const state = { pending: null as unknown, phase: "loading", storageUnavailable: false, answer: false };
  const window = {
    confirm: (message: string) => { prompts.push(message); return state.answer; },
    sessionStorage: {
      getItem: (key: string) => { if (state.storageUnavailable) throw Error("storage unavailable"); return stored.get(key) ?? null; },
      setItem: () => { assert.fail("navigation must not write pending storage"); },
      removeItem: () => { assert.fail("navigation must not clear pending storage"); },
    },
    addEventListener: (type: string, listener: (event: Unload) => void) => { assert.equal(type, "beforeunload"); listeners.add(listener); },
    removeEventListener: (_type: string, listener: (event: Unload) => void) => { listeners.delete(listener); },
  };
  const actor = { id: "owner-a", type: "owner" }, siteId = "99990001";
  const originalClient = new AttendanceScopeClient({ siteId, ownerId: actor.id,
    apiFetch: async () => { throw Error("unexpected request"); }, storage: () => window.sessionStorage });
  const client = { storageKey: originalClient.storageKey, getSnapshot: () => state };
  const attendanceLeaveScope = "company:owner:attendanceScopes";
  const attendanceLeaveGuardRef = { get current() { return guard ? { scope: attendanceLeaveScope, guard } : null; } };
  const hasStoredAttendanceScopeOperation = expression<Guard>(storedScopeOperation, { window, actor, siteId, tab: "attendanceScopes" });
  function install(draftIsDirty = false) {
    cleanup?.();
    cleanup = expression<() => () => void>(installScope, { client, window, draftIsDirty, registerLeaveGuard: (value: Guard | null) => { guard = value; } })();
  }
  function native(tab = "attendanceScopes", canAutoRefreshOnFocus = false) {
    return expression<() => (() => void) | undefined>(installParentUnload, { actor, tab, canAutoRefreshOnFocus, window,
      attendanceLeaveGuardRef, attendanceLeaveScope, hasStoredAttendanceScopeOperation })();
  }
  function unload() {
    let prevented = false;
    const event: Unload = { returnValue: undefined, preventDefault: () => { prevented = true; } };
    for (const listener of listeners) listener(event);
    return { prevented, returnValue: event.returnValue };
  }
  function navigate(view: string | null = "tasks", busy = false) {
    const noop = () => {};
    const context = { actor, tab: "attendanceScopes", busy, canAutoRefreshOnFocus: false,
      attendanceLeaveScope, accountStatusClient: null, hasStoredAttendanceScopeOperation,
      correctionLeaveGuardRef: { current: null }, attendanceLeaveGuardRef,
      window, setMessage: noop, setEditingTaskId: noop, setDraggingTaskId: noop, setShowBoardSettings: noop, setMobileTaskComposerOpen: noop,
      currentWorkEmployeeIdRef: { current: "" }, employeeCurrentWorkGenerationRef: { current: 0 }, employeeCurrentWorkAbortRef: { current: null },
      setCurrentWorkEmployeeId: noop, setEmployeeCurrentWork: noop, EMPTY_CURRENT_OPERATIONS_STATE: {},
    };
    return expression<(view: string | null) => boolean>(parentNavigation, context)(view);
  }
  return { state, stored, prompts, listeners, client, install, native, unload, navigate, dispose: () => cleanup?.() };
}
const initial = (): AttendanceManagementGrant => ({ id: "grant-a", workerIds: ["worker-a", "worker-b"], locationIds: ["location-a"], validFrom: "2026-10-24T09:00:00.000000Z", validUntil: null });

test("pristine scope permits menu and module exits before and after the lazy editor mounts, even though refresh is paused", () => {
  const h = harness();
  assert.equal(h.navigate(), true); assert.deepEqual(h.prompts, []); h.install();
  for (const phase of ["loading", "ready", "blocked"]) {
    h.state.phase = phase;
    assert.equal(h.navigate("tasks"), true); assert.equal(h.navigate(null), true);
  }
  assert.deepEqual(h.prompts, []); assert.equal(h.stored.size, 0); h.dispose();
});
test("pristine scope no longer inherits the parent unload warning, while other enterprise views retain it", () => {
  const h = harness(); h.install();
  const scopeCleanup = h.native(); assert.equal(h.listeners.size, 2);
  assert.deepEqual(h.unload(), { prevented: false, returnValue: undefined });
  const cleanup = h.native("tasks"); assert.equal(h.listeners.size, 3); assert.equal(h.unload().prevented, true);
  cleanup?.(); assert.equal(h.listeners.size, 2); assert.equal(h.unload().prevented, false); scopeCleanup?.(); h.dispose();
});
test("actual editor initializes an independent baseline: simply viewing or opening a new blank grant is not an edit", () => {
  let draft: AttendanceManagementGrant | null = null, saved: AttendanceManagementGrant | null = null;
  const edit = expression<(grant?: AttendanceManagementGrant) => void>(variable(scope, "edit"), {
    state: { result: { scope: { revision: 2 } } }, locked: false, crypto: { randomUUID: () => "new-grant" },
    setInitialDraft: (value: AttendanceManagementGrant) => { saved = value; }, setDraft: (value: AttendanceManagementGrant) => { draft = value; },
    setRemoveId: () => {}, setNotice: () => {}, setPicker: () => {},
  });
  const existing = initial(); edit(existing); assert.equal(dirty(draft, saved), false);
  assert.notEqual(draft!.workerIds, saved!.workerIds); assert.notEqual(saved!.workerIds, existing.workerIds);
  edit(); assert.equal(dirty(draft, saved), false); assert.equal(draft!.workerIds.length, 0);
  assert.equal(dirty(null, saved), false);
});
test("only grant content changes are dirty; restoring selections, label refresh and equivalent fractional precision are clean", () => {
  const original = initial(), before = JSON.stringify(original);
  assert.equal(dirty({ ...original, workerIds: [...original.workerIds].reverse() }, original), false);
  const presentationOnly = { ...original, revision: 10, labels: { "workers:worker-a": { label: "refreshed name" } } };
  assert.equal(dirty(presentationOnly, original), false);
  assert.equal(dirty({ ...original, validFrom: "2026-10-24T09:00:00.000Z" }, original), false);
  for (const patch of [{ workerIds: [] }, { workerIds: ["other-worker"] }, { locationIds: ["other-location"] },
    { validFrom: "2026-10-24T09:00:01Z" }, { validUntil: "2026-10-25T09:00:00Z" }, { id: "other-grant" }]) assert.equal(dirty({ ...original, ...patch }, original), true);
  assert.equal(dirty({ ...original, validFrom: "2026-10-24T09:00:00.123457Z" }, { ...original, validFrom: "2026-10-24T09:00:00.123456Z" }), true);
  assert.equal(dirty(original, null), true); assert.equal(JSON.stringify(original), before);
});
test("real edits still require confirmation and block native unload; reverting or cancelling removes the warning", () => {
  const h = harness(); h.install(true);
  assert.equal(h.navigate(), false); assert.match(h.prompts[0], /未保存的修改/); assert.equal(h.unload().prevented, true);
  h.state.answer = true; assert.equal(h.navigate(), true); assert.equal(h.stored.size, 0);
  h.install(false); h.prompts.length = 0; assert.equal(h.listeners.size, 1);
  assert.equal(h.navigate(), true); assert.equal(h.unload().prevented, false); assert.deepEqual(h.prompts, []); h.dispose();
});
test("pending in-flight writes are read live, not from stale render state, and leaving never clears or retries them", () => {
  const h = harness(); h.install(); h.state.pending = { operationId: "original-operation" }; h.state.phase = "saving";
  assert.equal(h.navigate(), false); assert.match(h.prompts[0], /待确认操作/); assert.equal(h.unload().prevented, true);
  h.state.answer = true; assert.equal(h.navigate(null), true); assert.deepEqual(h.state.pending, { operationId: "original-operation" });
  h.state.pending = null; h.prompts.length = 0; assert.equal(h.navigate(), true); assert.equal(h.unload().prevented, false); assert.deepEqual(h.prompts, []); h.dispose();
});
test("persisted, malformed or unreadable pending storage stays protected without mutation", () => {
  for (const raw of ["{not-yet-restored}", "", "{malformed"]) {
    const h = harness(); h.stored.set(h.client.storageKey, raw); h.install();
    assert.equal(h.navigate(), false); assert.equal(h.unload().prevented, true);
    h.state.answer = true; assert.equal(h.navigate(), true); h.dispose(); assert.equal(h.stored.get(h.client.storageKey), raw);
  }
  const h = harness(); h.state.storageUnavailable = true; h.install();
  assert.equal(h.navigate(), false); assert.match(h.prompts[0], /无法核对/); assert.equal(h.unload().prevented, true); h.dispose();
});
test("same-view navigation and existing busy-save protection remain unchanged, and cleanup removes the scope guard", () => {
  const h = harness(); h.install(true);
  assert.equal(h.navigate("attendanceScopes"), true); assert.equal(h.navigate("tasks", true), false); assert.deepEqual(h.prompts, []);
  h.dispose(); assert.equal(h.listeners.size, 0);
  assert.equal(h.navigate(), true); assert.deepEqual(h.prompts, []);
});
test("slow-loading scope still protects the real client's persisted operation key before its child registers", () => {
  const h = harness(), cleanup = h.native();
  assert.equal(h.unload().prevented, false);
  const raw = "{original-scope-operation}"; h.stored.set(h.client.storageKey, raw);
  assert.equal(h.navigate(), false); assert.match(h.prompts[0], /待确认操作/); assert.equal(h.unload().prevented, true);
  h.state.answer = true; assert.equal(h.navigate(), true); assert.equal(h.stored.get(h.client.storageKey), raw);
  h.stored.clear(); h.state.storageUnavailable = true; h.state.answer = false;
  assert.equal(h.navigate(), false); assert.equal(h.unload().prevented, true);
  cleanup?.(); assert.equal(h.listeners.size, 0);
});
test("parent wires the owner/company-keyed scope guard; SSR performs no requests or storage writes", () => {
  assert.match(parentText, /<MerchantAttendanceScopePanel key=\{`\$\{siteId\}:\$\{actor\.id\}`\}[^\n]+registerLeaveGuard=\{registerAttendanceLeaveGuard\}/);
  assert.match(scopeText, /\[client, draftIsDirty, registerLeaveGuard\]/);
  let calls = 0;
  const html = renderToStaticMarkup(<ScopePanel siteId="99990001" ownerId="test-owner" apiFetch={async () => { calls++; throw Error("unexpected request"); }}/>);
  assert.match(html, /主管考勤范围/); assert.match(html, /尚未选择/); assert.equal(calls, 0);
});
