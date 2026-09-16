import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { config, proxy as middleware } from "./proxy";

test("Next-discovered auth entry preserves OAuth return and portal isolation", async () => {
  const previous = process.env.FAOLLA_CANONICAL_PORTAL_ORIGIN;
  process.env.FAOLLA_CANONICAL_PORTAL_ORIGIN = "https://launch.faolla.com";
  try {
    assert.deepEqual(config.matcher, ["/login/:path*", "/reset-password/:path*", "/enterprise/:path*", "/api/auth/:path*"]);
    const paths = [
      "/login?oauth=google&accountType=merchant&code=fixture-code&state=fixture-state&redirect=%2F10000000",
      "/login?oauth=google&accountType=personal&loginFrom=https%3A%2F%2Fwww.faolla.com%2F",
      "/login?error_code=bad_oauth_state&error_description=fixture",
      "/reset-password?code=fixture-code",
      "/enterprise/10000000",
    ];
    for (const path of paths) {
      for (const host of ["faolla.com", "www.faolla.com"]) {
        const result = await middleware(new NextRequest(`https://${host}${path}`));
        assert.equal(result.status, 308);
        assert.equal(result.headers.get("location"), `https://launch.faolla.com${path}`);
        assert.match(result.headers.get("cache-control") ?? "", /no-store/);
      }
      const result = await middleware(new NextRequest(`https://launch.faolla.com${path}`));
      assert.equal(result.headers.get("location"), null);
      assert.equal(result.headers.get("x-middleware-next"), "1");
    }
    const rejected = await middleware(new NextRequest("https://faolla.com/api/auth/merchant-session", { method: "POST" }));
    assert.equal(rejected.status, 421);
    assert.equal(rejected.headers.get("location"), null);
    const accepted = await middleware(new NextRequest("https://launch.faolla.com/api/auth/merchant-session", { method: "POST" }));
    assert.equal(accepted.headers.get("x-middleware-next"), "1");
    // Real reverse-proxy transport can use a loopback URL and Host header.
    // The forwarded public hostname must preserve canonical-origin behavior.
    for (const host of ["faolla.com", "www.faolla.com", "launch.faolla.com"]) {
      const result = await middleware(new NextRequest("http://127.0.0.1:3229/login", {
        headers: { host: "127.0.0.1:3229", "x-forwarded-host": host, "x-forwarded-proto": "https" },
      }));
      assert.equal(result.headers.get("location"), host === "launch.faolla.com" ? null : "https://launch.faolla.com/login");
      if (host === "launch.faolla.com") assert.equal(result.headers.get("x-middleware-next"), "1");
    }
    const conflictingHost = await middleware(new NextRequest("http://127.0.0.1:3229/api/auth/merchant-session", {
      method: "POST",
      headers: { host: "faolla.com", "x-forwarded-host": "launch.faolla.com", "x-forwarded-proto": "https" },
    }));
    assert.equal(conflictingHost.status, 421, "a nonlocal Host must take precedence over forwarded host");
  } finally {
    if (previous === undefined) delete process.env.FAOLLA_CANONICAL_PORTAL_ORIGIN;
    else process.env.FAOLLA_CANONICAL_PORTAL_ORIGIN = previous;
  }
});
