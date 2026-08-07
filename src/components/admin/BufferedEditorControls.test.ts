import assert from "node:assert/strict";
import test from "node:test";

import { shouldBufferEditorInput } from "@/components/admin/BufferedEditorControls";

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
