import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { build } from "esbuild";

// Compile the actual entry; never import the real worker or start any jobs.
async function compiled(runtime: string, mode: string, throws = false) {
  let imports = 0;
  const result = await build({
    stdin: { contents: await readFile("src/instrumentation.ts", "utf8"), loader: "ts", sourcefile: "src/instrumentation.ts" },
    bundle: true, write: false, format: "cjs", platform: runtime === "edge" ? "browser" : "node", logLevel: "silent",
    define: { "process.env.NEXT_RUNTIME": JSON.stringify(runtime), "process.env.NODE_ENV": JSON.stringify(mode) },
    plugins: [{ name: "isolated-worker-observer", setup(builder) {
      builder.onResolve({ filter: /^@\/lib\/merchantBookingAutomationRuntime$/ }, () => { imports++; return { path: "worker", namespace: "synthetic" }; });
      builder.onLoad({ filter: /^worker$/, namespace: "synthetic" }, () => ({ contents:
        "export function startMerchantBookingAutomationRuntime(){globalThis.calls++;if(globalThis.fail)throw Error('synthetic-start-failed')}" }));
    } }],
  });
  const fixtureModule = { exports: {} as { register?: () => Promise<void> } }, sandbox = { module: fixtureModule, calls: 0, fail: throws };
  vm.runInNewContext(result.outputFiles[0].text, sandbox);
  return { imports, sandbox, register: fixtureModule.exports.register! };
}

for (const [runtime, mode] of [["edge", "production"], ["edge", "development"], ["nodejs", "development"], ["nodejs", "test"], ["", "production"]]) {
  test(`${runtime || "unset"}/${mode} neither bundles nor starts the Node-only booking worker`, async () => {
    const fixture = await compiled(runtime, mode); await fixture.register();
    assert.equal(fixture.imports, 0); assert.equal(fixture.sandbox.calls, 0);
  });
}
test("nodejs/production retains the original one startup call and propagates its failure without retry", async () => {
  const success = await compiled("nodejs", "production"); await success.register(); assert.equal(success.imports, 1); assert.equal(success.sandbox.calls, 1);
  const failure = await compiled("nodejs", "production", true); await assert.rejects(failure.register(), /synthetic-start-failed/);
  assert.equal(failure.imports, 1); assert.equal(failure.sandbox.calls, 1);
});
