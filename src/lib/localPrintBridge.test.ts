import assert from "node:assert/strict";
import test from "node:test";
import {
  LOCAL_PRINT_BRIDGE_DEFAULT_PORT,
  LOCAL_PRINT_BRIDGE_DEFAULT_URL,
  getLocalPrintBridgePort,
  normalizeLocalPrintBridgeUrl,
} from "./localPrintBridge";

test("normalizes supported loopback print-helper URLs", () => {
  assert.equal(normalizeLocalPrintBridgeUrl("http://localhost:18000/"), "http://127.0.0.1:18000");
  assert.equal(normalizeLocalPrintBridgeUrl("http://[::1]:19000"), "http://127.0.0.1:19000");
  assert.equal(getLocalPrintBridgePort("http://127.0.0.1:18000"), 18000);
});

test("rejects non-loopback and ambiguous print-helper URLs", () => {
  const rejected = [
    "https://faolla.com",
    "http://192.168.1.10:17658",
    "http://user:pass@127.0.0.1:17658",
    "http://127.0.0.1:17658/print",
    "http://127.0.0.1:17658?redirect=https://example.com",
    "not-a-url",
  ];
  rejected.forEach((value) => assert.equal(normalizeLocalPrintBridgeUrl(value), LOCAL_PRINT_BRIDGE_DEFAULT_URL));
  assert.equal(getLocalPrintBridgePort("http://127.0.0.1:80"), LOCAL_PRINT_BRIDGE_DEFAULT_PORT);
});
