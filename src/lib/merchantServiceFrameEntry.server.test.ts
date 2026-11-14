import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { handleMerchantServiceFrameEntry } from "./merchantServiceFrameEntry.server";

const canonical = "https://launch.faolla.com", parent = "https://synthetic.faolla.com";
function request({ host = "launch.faolla.com", nonce = "synthetic-bound-channel", origin = parent } = {}) {
  const url = new URL("/service-center", canonical);
  for (const [key, value] of Object.entries({ parentOrigin: origin, siteId: "99990001", nonce })) url.searchParams.set(key, value);
  return new NextRequest(url, { headers: { host } });
}
test("only the canonical, site-bound document receives the exact frame policy and cannot be cached", async () => {
  const previous = process.env.FAOLLA_CANONICAL_PORTAL_ORIGIN;
  process.env.FAOLLA_CANONICAL_PORTAL_ORIGIN = canonical;
  let checks = 0;
  try {
    const authorize = async (_request: Request, origin: string, site: string) => { checks++; return origin === parent && site === "99990001"; };
    const valid = await handleMerchantServiceFrameEntry(request(), authorize);
    assert.equal(valid.status, 200);
    assert.equal(valid.headers.get("content-security-policy"), `frame-ancestors 'self' ${parent}; object-src 'none'; base-uri 'self'; form-action 'self'`);
    assert.match(valid.headers.get("cache-control") ?? "", /private, no-store/);
    assert.equal(valid.headers.get("referrer-policy"), "no-referrer");
    assert.equal(valid.headers.get("permissions-policy"), "camera=(), microphone=(), payment=()", "restoring My features must not relax the existing frame permission policy");
    assert.equal(valid.headers.get("set-cookie"), null, "frame admission never reads or renews credentials");
    assert.equal(await valid.text(), "");
    assert.equal((await handleMerchantServiceFrameEntry(request({ host: "synthetic.faolla.com" }), authorize)).status, 421);
    assert.equal(checks, 1, "a merchant host cannot reach the identity channel");
    const invalid = await handleMerchantServiceFrameEntry(request({ origin: "https://evil.invalid" }), authorize);
    assert.equal(invalid.status, 403);
    assert.equal(invalid.headers.get("content-security-policy"), "frame-ancestors 'none'");
    assert.equal((await handleMerchantServiceFrameEntry(request({ nonce: "too-short" }), authorize)).status, 403);
    assert.equal(checks, 2, "invalid channel ids are refused before site lookup");
  } finally {
    if (previous === undefined) delete process.env.FAOLLA_CANONICAL_PORTAL_ORIGIN; else process.env.FAOLLA_CANONICAL_PORTAL_ORIGIN = previous;
  }
});
