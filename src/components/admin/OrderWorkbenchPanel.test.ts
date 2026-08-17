import assert from "node:assert/strict";
import test from "node:test";

import {
  getOrderWorkbenchContentScrollClassName,
  getOrderWorkbenchDetailLayerClassName,
  getOrderExportNativeDateInputClassName,
  ORDER_EXPORT_DATE_VALUE_ATTRIBUTES,
  ORDER_EXPORT_NATIVE_DATE_INPUT_ATTRIBUTES,
  ORDER_EXPORT_VISIBLE_DATE_INPUT_ATTRIBUTES,
  openOrderExportDatePicker,
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

test("order export dates hide the locale-dependent native rendering", () => {
  const className = getOrderExportNativeDateInputClassName();

  assert.match(className, /(?:^|\s)absolute(?:\s|$)/);
  assert.match(className, /(?:^|\s)pointer-events-none(?:\s|$)/);
  assert.match(className, /(?:^|\s)opacity-0(?:\s|$)/);
  assert.deepEqual(ORDER_EXPORT_DATE_VALUE_ATTRIBUTES, {
    "data-no-translate": "1",
    translate: "no",
  });
  assert.deepEqual(ORDER_EXPORT_NATIVE_DATE_INPUT_ATTRIBUTES, {
    type: "date",
    tabIndex: -1,
    "aria-hidden": true,
    "data-no-translate": "1",
    translate: "no",
  });
  assert.deepEqual(ORDER_EXPORT_VISIBLE_DATE_INPUT_ATTRIBUTES, {
    type: "text",
    readOnly: true,
    inputMode: "numeric",
    autoComplete: "off",
    placeholder: "YYYY-MM-DD",
    "data-no-translate": "1",
    translate: "no",
  });
});

test("order export date picker uses showPicker with a click fallback", () => {
  let showCount = 0;
  let clickCount = 0;
  const supportedPicker = {
    showPicker: () => {
      showCount += 1;
    },
    click: () => {
      clickCount += 1;
    },
  } as unknown as HTMLInputElement;

  openOrderExportDatePicker(supportedPicker);
  assert.equal(showCount, 1);
  assert.equal(clickCount, 0);

  const fallbackPicker = {
    showPicker: () => {
      throw new Error("unsupported");
    },
    click: () => {
      clickCount += 1;
    },
  } as unknown as HTMLInputElement;

  openOrderExportDatePicker(fallbackPicker);
  assert.equal(clickCount, 1);
});
