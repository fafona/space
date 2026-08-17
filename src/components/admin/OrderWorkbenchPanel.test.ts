import assert from "node:assert/strict";
import test from "node:test";

import {
  getOrderWorkbenchContentScrollClassName,
  getOrderWorkbenchDetailLayerClassName,
  shouldRenderOrderWorkbenchDetailPortal,
} from "@/components/admin/OrderWorkbenchPanel";

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

test("order detail drawer is fixed to the viewport above the workbench", () => {
  const className = getOrderWorkbenchDetailLayerClassName();

  assert.match(className, /(?:^|\s)fixed(?:\s|$)/);
  assert.match(className, /(?:^|\s)inset-0(?:\s|$)/);
  assert.match(className, /z-\[2147483000\]/);
  assert.doesNotMatch(className, /(?:^|\s)absolute(?:\s|$)/);
});

test("order detail portal waits for the browser body and a current order", () => {
  assert.equal(shouldRenderOrderWorkbenchDetailPortal(false, "order-1"), false);
  assert.equal(shouldRenderOrderWorkbenchDetailPortal(true, ""), false);
  assert.equal(shouldRenderOrderWorkbenchDetailPortal(true, "   "), false);
  assert.equal(shouldRenderOrderWorkbenchDetailPortal(true, "order-1"), true);
});
