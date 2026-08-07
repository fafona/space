import assert from "node:assert/strict";
import test from "node:test";

import { shouldBufferEditorInput } from "@/components/admin/BufferedEditorControls";
import {
  DEFAULT_EDITOR_TEXT_COMMIT_DELAY_MS,
  DEFAULT_EDITOR_TEXT_COMMIT_MAX_WAIT_MS,
} from "@/components/admin/useBufferedEditorTextCommit";

test("editor text commits leave enough idle time between preview refreshes", () => {
  assert.equal(DEFAULT_EDITOR_TEXT_COMMIT_DELAY_MS, 500);
  assert.equal(DEFAULT_EDITOR_TEXT_COMMIT_MAX_WAIT_MS, 2500);
});

test("editor text-like controls use local buffered updates", () => {
  for (const type of [undefined, "", "text", "search", "url", "email", "tel", "password", "number"]) {
    assert.equal(shouldBufferEditorInput(type), true, `expected ${String(type)} to be buffered`);
  }
});

test("editor immediate controls and locked fields bypass text buffering", () => {
  for (const type of ["checkbox", "radio", "range", "file", "color", "date", "time", "button", "submit"]) {
    assert.equal(shouldBufferEditorInput(type), false, `expected ${type} to stay immediate`);
  }
  assert.equal(shouldBufferEditorInput("text", true, false), false);
  assert.equal(shouldBufferEditorInput("text", false, true), false);
});
