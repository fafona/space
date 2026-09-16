import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertAuthMiddlewareBuild } from "./check-auth-middleware-build.mjs";

test("build guard rejects missing middleware and expanded routes", () => {
  const dir = mkdtempSync(join(tmpdir(), "faolla-auth-build-"));
  try {
    mkdirSync(join(dir, "server"));
    const write = (value) => writeFileSync(join(dir, "server/functions-config-manifest.json"), JSON.stringify(value));
    write({ functions: {} });
    assert.throws(() => assertAuthMiddlewareBuild(dir), /build_missing/);
    const manifest = { functions: { "/_middleware": {
      runtime: "nodejs",
      matchers: [{ regexp: "^/(login|reset-password|enterprise|api/auth)(/.*)?$" }],
    } } };
    writeFileSync(join(dir, "server/middleware.js"), "// fixture");
    write(manifest);
    assert.equal(assertAuthMiddlewareBuild(dir), true);
    manifest.functions["/_middleware"].matchers = [{ regexp: "^/.*" }];
    write(manifest);
    assert.throws(() => assertAuthMiddlewareBuild(dir), /scope_expanded/);
    manifest.functions["/_middleware"].matchers = [{ regexp: "^/login$" }];
    write(manifest);
    assert.throws(() => assertAuthMiddlewareBuild(dir), /route_missing/);
    manifest.functions["/_middleware"].runtime = "edge";
    write(manifest);
    assert.throws(() => assertAuthMiddlewareBuild(dir), /build_missing/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
