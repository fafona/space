import test from "node:test";
import assert from "node:assert/strict";
import { serviceQrLink } from "./serviceQrLink";
test("scanning retains ordinary links, bare domains, same-origin paths, mail and phone without executing unsafe schemes", () => {
  assert.equal(serviceQrLink("faolla.com/connect?id=50010105", "https://launch.faolla.com"), "https://faolla.com/connect?id=50010105");
  assert.equal(serviceQrLink("/connect?id=50010105", "https://launch.faolla.com"), "https://launch.faolla.com/connect?id=50010105");
  assert.equal(serviceQrLink("https://example.invalid/visit", "https://launch.faolla.com"), "https://example.invalid/visit");
  for (const value of ["tel:+123456", "mailto:synthetic@example.invalid"]) assert.equal(serviceQrLink(value, "https://launch.faolla.com"), value);
  for (const value of ["javascript:alert(1)", "data:text/html,test", "blob:https://faolla.com/test", "Plain QR text"]) assert.equal(serviceQrLink(value, "https://launch.faolla.com"), "");
});
