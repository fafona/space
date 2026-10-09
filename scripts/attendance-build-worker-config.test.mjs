import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = fs.readFileSync(new URL("../next.config.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;

function evaluate(flag) {
  const evaluatedModule = { exports: {} };
  new Function("module", "exports", "process", compiled)(
    evaluatedModule,
    evaluatedModule.exports,
    { env: flag === undefined ? {} : { FAOLLA_BUILD_SINGLE_WORKER: flag } },
  );
  return evaluatedModule.exports.default;
}

test("normal builds have no new worker override", () => {
  for (const flag of [undefined, "", "0", "true", " 1", "1 "]) {
    assert.equal(Object.hasOwn(evaluate(flag).experimental, "cpus"), false);
  }
});

test("only the exact candidate-build opt-in selects one static worker", async () => {
  assert.equal(evaluate("1").experimental.cpus, 1);
  const opted = evaluate("1");
  delete opted.experimental.cpus;
  const normal = evaluate(undefined);
  assert.deepEqual(await opted.headers(), await normal.headers());
  assert.deepEqual(Object.keys(opted).filter(key => typeof opted[key] === "function"), ["headers"]);
  delete opted.headers;
  delete normal.headers;
  assert.deepEqual(opted, normal);
});

test("single-worker mode preserves safety and application configuration", async () => {
  const config = evaluate("1");
  assert.equal(config.reactStrictMode, true);
  assert.equal(config.experimental.proxyClientMaxBodySize, "96mb");
  assert.deepEqual(config.serverExternalPackages, ["ffmpeg-static"]);
  assert.equal(config.typescript?.ignoreBuildErrors, undefined);
  assert.equal(config.images.remotePatterns.length, 5);
  assert.deepEqual(await config.headers(), await evaluate(undefined).headers());
});
