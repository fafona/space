import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createStartupDiagnostic } from "./production-maintenance-startup-diagnostic.mjs";
test("startup diagnostics emit only fixed stages, status and bounded duration",async()=>{
  const lines=[],value={private:"credential-like-data"};let now=1000;
  const diagnostic=createStartupDiagnostic({now:()=>now,write:line=>lines.push(line)});
  assert.equal(await diagnostic("runtime_launch",async()=>{now=2500;return value;}),value);
  const failure=new Error("private-secret-token");
  await assert.rejects(diagnostic("launch_confirm",async()=>{throw failure;}),e=>e===failure);
  assert.deepEqual(lines,["[deploy] maintenance_start_diagnostic stage=runtime_launch code=start elapsed_seconds=0\n",
    "[deploy] maintenance_start_diagnostic stage=runtime_launch code=passed elapsed_seconds=1\n",
    "[deploy] maintenance_start_diagnostic stage=launch_confirm code=start elapsed_seconds=0\n",
    "[deploy] maintenance_start_diagnostic stage=launch_confirm code=failed elapsed_seconds=0\n"]);
  await assert.rejects(diagnostic("raw-secret",async()=>true));assert.equal(lines.length,4);
  const unavailable=createStartupDiagnostic({write:()=>{throw Error("unavailable");}});
  assert.equal(await unavailable("runtime_settle",async()=>42),42);
});
test("startup keeps the original timeout and no additional launch send on observation retry",()=>{
  const runtime=readFileSync(new URL("./production-maintenance-runtime.mjs",import.meta.url),"utf8");
  const wait=runtime.slice(runtime.indexOf("async function waitForStartedCandidate"),runtime.indexOf("export async function startCandidate"));
  assert.match(wait,/const deadline = d.now\(\) \+ 60_000/);assert.doesNotMatch(wait,/pm2Control|launchOnce|journal\.attempt/);
  assert.match(wait,/await assertLaunch\(\);\s*if \(deadline - d.now\(\) < 250\) fail\(\);/);
  const workflow=readFileSync(new URL("../.github/workflows/deploy.yml",import.meta.url),"utf8");
  assert.match(workflow,/const startupAllowed =/);assert.match(workflow,/fenceAllowed\.exec\(line\) \?\? startupAllowed\.exec\(line\)/);
  assert.match(workflow,/match\[0\] !== line/);
});
