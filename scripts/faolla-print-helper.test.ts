import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import path from "node:path";
import test from "node:test";

async function findFreePort() {
  return await new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

async function waitForHealth(url: string) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${url}/health`, { cache: "no-store" });
      if (response.ok) return response;
    } catch {
      // The helper process may still be binding its loopback port.
    }
    await new Promise((resolve) => setTimeout(resolve, 75));
  }
  throw new Error("print_helper_health_timeout");
}

test("helper accepts protocol launch ports and enforces its browser boundary", async (context) => {
  const port = await findFreePort();
  const helperPath = path.resolve(process.cwd(), "scripts/faolla-print-helper.mjs");
  const child = spawn(process.execPath, [helperPath, `faolla-print-helper://start?port=${port}`], {
    stdio: "ignore",
    windowsHide: true,
  });
  context.after(() => {
    child.kill();
  });

  const helperUrl = `http://127.0.0.1:${port}`;
  const healthResponse = await waitForHealth(helperUrl);
  const health = (await healthResponse.json()) as Record<string, unknown>;
  assert.equal(health.ok, true);
  assert.equal(health.name, "faolla-print-helper");
  assert.equal(health.version, "1.5.5");

  const preflight = await fetch(`${helperUrl}/print`, {
    method: "OPTIONS",
    headers: {
      origin: "https://faolla.com",
      "access-control-request-method": "POST",
      "access-control-request-private-network": "true",
    },
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), "https://faolla.com");
  assert.equal(preflight.headers.get("access-control-allow-private-network"), "true");

  const blocked = await fetch(`${helperUrl}/print`, {
    method: "POST",
    headers: {
      origin: "https://example.com",
      "content-type": "application/json",
    },
    body: JSON.stringify({ source: "faolla-web", content: "must not print" }),
  });
  assert.equal(blocked.status, 403);
});
