import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

// Extract only the local helper: importing the executable browser journey would
// start Next/Chromium. These tests use no browser, server, network or production.
const source = readFileSync(new URL("./check-merchant-enterprise-browser.mjs", import.meta.url), "utf8");
const start = source.indexOf("async function confirmBoardSettingsAction(");
const end = source.indexOf("async function waitForServer(", start);
assert.ok(start > 0 && end > start);
function fixture() {
  const state = { boardId: "original-board", draft: "unsaved draft" };
  const timers = new Set();
  const page = new EventEmitter();
  page.waits = 0;
  page.waitForFunction = async (predicate, expected, options) => {
    page.waits++;
    assert.equal(options.timeout, 5000);
    if (!predicate(expected)) throw new Error("state not matched");
    return { dispose: async () => {} };
  };
  page.getByLabel = () => ({ inputValue: async () => state.boardId });
  page.getByPlaceholder = () => ({ inputValue: async () => state.draft });
  const context = {
    setTimeout: (callback, delay) => {
      assert.equal(delay, 5000);
      const timer = { callback }; timers.add(timer); return timer;
    },
    clearTimeout: (timer) => timers.delete(timer),
    assert: (condition, message) => assert.ok(condition, message),
    document: {
      querySelectorAll: () => [{ value: state.boardId, closest: () => ({ textContent: "当前看板" }) }],
      querySelector: () => state.draft === null ? null : { value: state.draft },
    },
  };
  const execute = vm.runInNewContext(`${source.slice(start, end)}; confirmBoardSettingsAction`, context);
  const options = { accept: false, expectedMessage: "expected confirmation", expectedBoardId: state.boardId,
    expectedDraft: state.draft, failureMessage: "draft guard failed" };
  const dialog = { type: () => "confirm", message: () => options.expectedMessage,
    dismiss: async () => {}, accept: async () => {} };
  return { state, page, options, dialog, execute, expire: () => {
    for (const timer of [...timers]) { timers.delete(timer); timer.callback(); }
  } };
}

test("board confirmation fully awaits dismissal before checking both values", async () => {
  const f = fixture(); let completeDismiss;
  f.dialog.dismiss = () => new Promise((resolve) => { completeDismiss = resolve; });
  const pending = f.execute(f.page, { ...f.options, action: async () => f.page.emit("dialog", f.dialog) });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.page.waits, 0);
  completeDismiss(); await pending;
  assert.equal(f.page.waits, 1); assert.equal(f.page.listenerCount("dialog"), 0);
});

test("action completion without the expected dialog still fails and removes listener", async () => {
  const f = fixture();
  const rejected = assert.rejects(f.execute(f.page, { ...f.options, action: async () => {} }),
    /confirm_timeout.*"dialogSeen":false.*"boardId":"original-board".*"draft":"unsaved draft"/);
  f.expire(); await rejected;
  assert.equal(f.page.waits, 0); assert.equal(f.page.listenerCount("dialog"), 0);
});

test("unexpected dialogs are never accepted and fail with bounded synthetic context", async () => {
  const f = fixture(); let dismissed = 0; let accepted = 0;
  f.dialog.message = () => "unexpected message must not appear in diagnostics";
  f.dialog.dismiss = async () => { dismissed++; };
  f.dialog.accept = async () => { accepted++; };
  await assert.rejects(f.execute(f.page, { ...f.options, accept: true, action: async () => f.page.emit("dialog", f.dialog) }), (error) => {
    assert.match(error.message, /unexpected_dialog.*"dialogMatched":false/);
    assert.equal(error.message.includes("unexpected message"), false); return true;
  });
  assert.equal(dismissed, 1); assert.equal(accepted, 0); assert.equal(f.page.listenerCount("dialog"), 0);
});

test("a completed confirmation cannot hide either a changed board or a lost draft", async () => {
  for (const field of ["boardId", "draft"]) {
    const f = fixture(); f.state[field] = "unexpected";
    await assert.rejects(f.execute(f.page, { ...f.options, action: async () => f.page.emit("dialog", f.dialog) }),
      /state_not_settled.*"dialogHandled":true/);
    assert.equal(f.page.listenerCount("dialog"), 0);
  }
});

test("accepted switch and collapse require their exact final board and draft state", async () => {
  for (const nextDraft of ["", null]) {
    const f = fixture(); let accepted = 0;
    f.dialog.accept = async () => { accepted++; f.state.boardId = "next-board"; f.state.draft = nextDraft; };
    await f.execute(f.page, { ...f.options, accept: true, expectedBoardId: "next-board", expectedDraft: nextDraft,
      action: async () => f.page.emit("dialog", f.dialog) });
    assert.equal(accepted, 1); assert.equal(f.page.waits, 1); assert.equal(f.page.listenerCount("dialog"), 0);
  }
});
