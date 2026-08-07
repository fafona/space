import assert from "node:assert/strict";
import test from "node:test";

import {
  flushBufferedEditorTextCommits,
  registerEditorTextFlush,
} from "./editorTextCommitBuffer";

test("buffered editor text flushes every pending commit once", () => {
  const calls: string[] = [];
  registerEditorTextFlush(() => calls.push("first"));
  registerEditorTextFlush(() => calls.push("second"));

  flushBufferedEditorTextCommits();

  assert.deepEqual(calls, ["first", "second"]);
});

test("unregistered editor text commits are not flushed", () => {
  let called = false;
  const unregister = registerEditorTextFlush(() => {
    called = true;
  });

  unregister();
  flushBufferedEditorTextCommits();

  assert.equal(called, false);
});
