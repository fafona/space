import assert from "node:assert/strict";
import test from "node:test";
import {
  MERCHANT_CUSTOMER_DESKTOP_QUERY,
  getMerchantCustomerDesktopSnapshot,
  getMerchantCustomerServerSnapshot,
  subscribeMerchantCustomerViewport,
} from "@/lib/merchantCustomerListViewport";

function withWindow(value: unknown, check: () => void) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { value, configurable: true });
  try {
    check();
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "window", descriptor);
    else Reflect.deleteProperty(globalThis, "window");
  }
}

test("customer list server snapshots do not read browser state", () => {
  withWindow(undefined, () => {
    assert.equal(getMerchantCustomerServerSnapshot(), false);
    assert.equal(getMerchantCustomerDesktopSnapshot(), false);
    assert.doesNotThrow(subscribeMerchantCustomerViewport(() => {}));
  });
});

test("customer list switches at the existing lg breakpoint and removes its media listener", () => {
  let matches = false;
  let listener: (() => void) | undefined;
  let notifications = 0;
  const media = {
    get matches() { return matches; },
    addEventListener: (event: string, callback: () => void) => {
      assert.equal(event, "change");
      listener = callback;
    },
    removeEventListener: (event: string, callback: () => void) => {
      assert.equal(event, "change");
      assert.equal(callback, listener);
      listener = undefined;
    },
  };
  withWindow({ matchMedia: (query: string) => {
    assert.equal(query, MERCHANT_CUSTOMER_DESKTOP_QUERY);
    return media;
  } }, () => {
    const cleanup = subscribeMerchantCustomerViewport(() => { notifications += 1; });
    assert.equal(getMerchantCustomerDesktopSnapshot(), false);
    matches = true;
    listener?.();
    assert.equal(notifications, 1);
    assert.equal(getMerchantCustomerDesktopSnapshot(), true);
    // Hydration always starts with the server snapshot, even on desktop.
    assert.equal(getMerchantCustomerServerSnapshot(), false);
    matches = false;
    listener?.();
    assert.equal(getMerchantCustomerDesktopSnapshot(), false);
    cleanup();
    assert.equal(listener, undefined);
  });
});

test("customer list supports legacy media listeners without registering duplicates", () => {
  let listener: (() => void) | undefined;
  withWindow({ matchMedia: () => ({
    matches: true,
    addListener: (callback: () => void) => { listener = callback; },
    removeListener: (callback: () => void) => {
      assert.equal(callback, listener);
      listener = undefined;
    },
  }) }, () => {
    const cleanup = subscribeMerchantCustomerViewport(() => {});
    assert.equal(typeof listener, "function");
    assert.equal(getMerchantCustomerDesktopSnapshot(), true);
    cleanup();
    assert.equal(listener, undefined);
  });
});

test("customer list falls back to a cleaned-up resize listener without matchMedia", () => {
  let listener: (() => void) | undefined;
  const browser = {
    innerWidth: 1023,
    addEventListener: (event: string, callback: () => void) => {
      assert.equal(event, "resize");
      listener = callback;
    },
    removeEventListener: (event: string, callback: () => void) => {
      assert.equal(event, "resize");
      assert.equal(callback, listener);
      listener = undefined;
    },
  };
  withWindow(browser, () => {
    const cleanup = subscribeMerchantCustomerViewport(() => {});
    assert.equal(getMerchantCustomerDesktopSnapshot(), false);
    browser.innerWidth = 1024;
    assert.equal(getMerchantCustomerDesktopSnapshot(), true);
    cleanup();
    assert.equal(listener, undefined);
  });
});
