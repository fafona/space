// CI-only production-build acceptance. Never connects to production services.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";

if (process.env.GITHUB_ACTIONS !== "true" || process.platform !== "linux") {
  throw new Error("auth_http_acceptance_requires_linux_ci");
}
const port = 3229;
const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(port)], {
  env: {
    PATH: process.env.PATH,
    NODE_ENV: "production",
    NEXT_TELEMETRY_DISABLED: "1",
    NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "dummy-anon-key",
    FAOLLA_CANONICAL_PORTAL_ORIGIN: "https://launch.faolla.com",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let output = "";
for (const stream of [child.stdout, child.stderr]) stream.on("data", (chunk) => { output = (output + chunk).slice(-8000); });
const exited = once(child, "exit");
const request = (host, path, method = "GET") => fetch(`http://127.0.0.1:${port}${path}`, {
  method, redirect: "manual", signal: AbortSignal.timeout(12000),
  // Match the production reverse proxy / release-smoke transport. Node fetch
  // may discard Host overrides, so loopback requests also need the public host.
  headers: { host, "x-forwarded-host": host, "x-forwarded-proto": "https" },
});
try {
  let ready = false;
  for (let attempt = 0; attempt < 45; attempt++) {
    if (child.exitCode !== null) throw new Error("auth_http_server_exited");
    try {
      const response = await request("launch.faolla.com", "/api/app-web-version");
      await response.arrayBuffer();
      if (response.status === 200) { ready = true; break; }
    } catch { /* bounded startup retry */ }
    await delay(400);
  }
  assert.ok(ready, "auth_http_server_not_ready");
  let count = 0;
  for (const host of ["faolla.com", "www.faolla.com"]) {
    for (const path of [
      "/login?oauth=google&accountType=merchant&code=fixture-code&state=fixture-state&redirect=%2F10000000",
      "/login?oauth=google&accountType=personal&loginFrom=https%3A%2F%2Fwww.faolla.com%2F",
      "/reset-password?code=fixture-code",
      "/enterprise/10000000",
    ]) {
      const response = await request(host, path);
      assert.equal(response.status, 308);
      assert.equal(response.headers.get("location"), `https://launch.faolla.com${path}`);
      assert.match(response.headers.get("cache-control") ?? "", /no-store/);
      await response.arrayBuffer();
      count++;
    }
    const rejected = await request(host, "/api/auth/merchant-session", "POST");
    assert.equal(rejected.status, 421);
    assert.equal(rejected.headers.get("location"), null);
    await rejected.arrayBuffer();
    count++;
  }
  for (const path of ["/login", "/enterprise"]) {
    const response = await request("launch.faolla.com", path);
    assert.equal(response.status, 200, `canonical ${path}: status=${response.status}, location=${response.headers.get("location")}`);
    assert.equal(response.headers.get("location"), null);
    assert.match(response.headers.get("cache-control") ?? "", /no-store/);
    await response.arrayBuffer();
    count++;
  }
  console.log(`[auth-http] ${count} production-build checks passed`);
} catch (error) {
  console.error(output);
  throw error;
} finally {
  if (child.exitCode === null) child.kill("SIGTERM");
  const timer = setTimeout(() => { if (child.exitCode === null) child.kill("SIGKILL"); }, 5000);
  try { await exited; } finally { clearTimeout(timer); }
}
