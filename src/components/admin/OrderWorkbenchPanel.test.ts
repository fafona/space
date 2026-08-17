import assert from "node:assert/strict";
import test from "node:test";

import { getOrderWorkbenchContentScrollClassName } from "@/components/admin/OrderWorkbenchPanel";

test("inline order workbench lets wheel scrolling chain to the page", () => {
  const className = getOrderWorkbenchContentScrollClassName("inline");

  assert.match(className, /overflow-y-auto/);
  assert.doesNotMatch(className, /overscroll-contain/);
});

test("overlay order workbench keeps scrolling inside the dialog", () => {
  const className = getOrderWorkbenchContentScrollClassName("overlay");

  assert.match(className, /overflow-y-auto/);
  assert.match(className, /overscroll-contain/);
});
