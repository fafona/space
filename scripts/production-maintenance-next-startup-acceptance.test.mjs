import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  captureStartupFixtureProcessFact,
  STARTUP_PROCESS_FACT_KEYS,
} from "./test-helpers/startup-process-fact.mjs";

const expectedKeys = [
  "pid", "parentPid", "startTicks", "processIdentity", "uid", "cwd",
  "cwdIdentity", "executable", "executableIdentity", "commandLineDigest",
];

test("one fixture fact projects all ten fields from one guarded observation", () => {
  let captures = 0;
  const read = (pid) => {
    assert.equal(pid, 1234);
    captures += 1;
    return Object.fromEntries(expectedKeys.map((key) => [key, `${key}:${captures}`]));
  };
  const fact = captureStartupFixtureProcessFact(1234, read);
  assert.equal(captures, 1);
  assert.deepEqual(fact, Object.fromEntries(expectedKeys.map((key) => [key, `${key}:1`])));
});

test("each fixture observation is fresh, with no cross-invocation cache", () => {
  let captures = 0;
  const read = (pid) => ({ pid, startTicks: String(++captures), uid: 0 });
  const first = captureStartupFixtureProcessFact(1234, read);
  const second = captureStartupFixtureProcessFact(1234, read);
  assert.equal(captures, 2);
  assert.equal(first.startTicks, "1");
  assert.equal(second.startTicks, "2");
  assert.notEqual(first, second);
});

test("guard failures propagate unchanged without retry, fallback or partial facts", () => {
  for (const code of ["process_identity_drift", "ENOENT", "EACCES", "invalid_pid"]) {
    const failure = Object.assign(new Error(code), { code });
    let captures = 0;
    assert.throws(() => captureStartupFixtureProcessFact(0, (pid) => {
      assert.equal(pid, 0);
      captures += 1;
      throw failure;
    }), (error) => error === failure);
    assert.equal(captures, 1, code);
  }
});

test("projection preserves exact fields and types without exposing argv or mutating input", () => {
  const snapshot = Object.freeze({
    pid: 1234, parentPid: 4321, startTicks: "12345678901234567890",
    processIdentity: "proc-proof", uid: 0, cwd: "/fixture/app",
    cwdIdentity: "cwd-proof", executable: "/fixture/node",
    executableIdentity: "exe-proof", commandLineDigest: "digest-proof",
    commandLine: Object.freeze(["sensitive-argument"]), extra: "not-a-fact-field",
  });
  const before = JSON.stringify(snapshot);
  const result = captureStartupFixtureProcessFact(1234, () => snapshot);
  assert.deepEqual(STARTUP_PROCESS_FACT_KEYS, expectedKeys);
  assert(Object.isFrozen(STARTUP_PROCESS_FACT_KEYS));
  assert.deepEqual(Object.keys(result), expectedKeys);
  assert.equal(result.uid, 0);
  assert.equal(result.pid, 1234);
  assert.equal(result.startTicks, "12345678901234567890");
  assert.equal(result.commandLineDigest, "digest-proof");
  assert.equal("commandLine" in result, false);
  assert.equal("extra" in result, false);
  result.cwd = "/another-fixture";
  assert.equal(JSON.stringify(snapshot), before);
});

test("the real fixture uses the projection without changing identity or acceptance requirements", () => {
  const fixture = readFileSync(new URL("./production-maintenance-next-startup-acceptance.mjs", import.meta.url), "utf8");
  assert(fixture.includes("STARTUP_PROCESS_FACT_KEYS as keys,captureStartupFixtureProcessFact"));
  assert(fixture.includes("const fact=pid=>captureStartupFixtureProcessFact(pid,captureProcessFact);"));
  assert(fixture.includes("const {captureProcessFact,captureSupervisionSnapshot}=await import(scripts+'check-production-runtime-supervision.mjs');"));
  assert(!fixture.includes("keys.map(k=>[k,captureProcessFact(pid)[k]])"));
  for (const token of [
    "process.platform!=='linux'", "process.getuid?.()!==0", "process.env.GITHUB_ACTIONS!=='true'", "RUNNER_ENVIRONMENT!=='github-hosted'",
    "FAOLLA_NEXT_STARTUP_ACCEPTANCE!=='1'", "await controlPm2(daemon,boot,",
    "keys.filter(k=>k!=='commandLineDigest'&&prior[k]!==current[k])",
    "assert.deepEqual(reg,row)", "assert.equal(observation.listener.state,'single')",
    "assert.equal(observation.listener.pid,row.pid)", "assert.equal(observation.ownership.state,'owned')",
    "assert.equal(observation.ownership.mode,'direct')", "if(observation.healthVerified)accepted++",
    "const deadline=Date.now()+60000", "i<240&&Date.now()<deadline",
    "assert.ok(accepted>=2,'startup never became verified')",
  ]) assert(fixture.includes(token), token);
  assert(!/catch\s*\(|continue-on-error|process_identity_drift/.test(fixture));
});

test("the acceptance entrypoint still refuses implicit execution before any fixture setup", () => {
  const result = spawnSync(process.execPath, [
    fileURLToPath(new URL("./production-maintenance-next-startup-acceptance.mjs", import.meta.url)),
  ], {
    encoding: "utf8", timeout: 10000,
    env: { ...process.env, GITHUB_ACTIONS: "false", RUNNER_ENVIRONMENT: "", FAOLLA_NEXT_STARTUP_ACCEPTANCE: "0" },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /isolated_next_opt_in_required/);
  assert(!result.stdout.includes("fixtureBuild"));
  assert(!result.stdout.includes("fixtureCleanup"));
});
