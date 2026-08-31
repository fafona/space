import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAuthResetRedirectUrl,
  resolveAuthResetReturnPath,
} from "./authResetReturnPath";

for (const returnTo of ["/enterprise", "/enterprise/10000000"]) {
  test(`accepts the enterprise destination ${returnTo}`, () => {
    assert.equal(resolveAuthResetReturnPath(new URLSearchParams({ returnTo })), returnTo);
    assert.equal(
      buildAuthResetRedirectUrl("https://launch.faolla.com", returnTo),
      `https://launch.faolla.com/reset-password?returnTo=${encodeURIComponent(returnTo)}`,
    );
  });
}

for (const returnTo of [
  "https://evil.example/enterprise",
  "//evil.example/enterprise",
  "/enterprise/1000000",
  "/enterprise/100000000",
  "/enterprise/10000000?next=https://evil.example",
  "/login",
  "",
]) {
  test(`rejects the unsafe or unsupported destination ${returnTo}`, () => {
    assert.equal(resolveAuthResetReturnPath(new URLSearchParams({ returnTo })), "/login");
    assert.equal(
      buildAuthResetRedirectUrl("https://launch.faolla.com", returnTo),
      "https://launch.faolla.com/reset-password?returnTo=%2Flogin",
    );
  });
}

test("rejects duplicate return destinations", () => {
  const params = new URLSearchParams("returnTo=%2Fenterprise&returnTo=%2Fenterprise%2F10000000");
  assert.equal(resolveAuthResetReturnPath(params), "/login");
});
