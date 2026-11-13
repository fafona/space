import test from "node:test";
import assert from "node:assert/strict";
import { readPublicMerchantHost } from "./publicMerchantHost.server";
test("only merchant hosts under the configured public root use the server-first merchant path", () => {
  assert.deepEqual(readPublicMerchantHost("cyberspace.faolla.com", "faolla.com"), { prefix: "cyberspace", host: "cyberspace.faolla.com" });
  for (const host of ["faolla.com", "www.faolla.com", "launch.faolla.com", "cyberspace.evil.invalid", "cyberspace.faolla.com.evil.invalid", "localhost:3000", "cyberspace.faolla.com/path"])
    assert.equal(readPublicMerchantHost(host, "faolla.com"), null, host);
});
