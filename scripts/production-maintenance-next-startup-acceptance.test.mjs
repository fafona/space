import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  captureStartupFixtureProcessFact,
  STARTUP_PROCESS_FACT_KEYS,
  waitForStartupFixtureTitle,
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

const finalTitle = Buffer.from("next-server (v16.3.4)\0\0\0", "utf8");

test("fixture marker waits for the exact copied Next title before one fresh capture", async () => {
  let time = 100, reads = 0, captures = 0;
  await waitForStartupFixtureTitle({
    pid: 1234, version: "16.3.4", deadline: 200,
    now: () => time,
    readCommandLine: (pid) => {
      assert.equal(pid, 1234);
      assert.equal(captures, 0, "pending markers must not collect partial identity facts");
      return ++reads === 1 ? Buffer.from("/fixture/node\0/fixture/next\0") : finalTitle;
    },
    pause: async (milliseconds) => { time += milliseconds; },
  });
  assert.equal(reads, 2);
  assert.equal(time, 125, "marker and startup loop share the same deadline budget");
  captureStartupFixtureProcessFact(1234, () => { captures += 1; return { pid: 1234 }; });
  assert.equal(captures, 1);
});

test("an initialized marker never retries or masks a later guarded capture failure", async () => {
  let captures = 0, reads = 0;
  await waitForStartupFixtureTitle({
    pid: 1234, version: "16.3.4", deadline: 200, now: () => 100,
    readCommandLine: () => { reads += 1; return finalTitle; },
    pause: () => assert.fail("initialized title must not wait"),
  });
  const failure = new Error("process_identity_drift");
  assert.throws(() => captureStartupFixtureProcessFact(1234, () => {
    captures += 1; throw failure;
  }), (error) => error === failure);
  assert.equal(reads, 1);
  assert.equal(captures, 1);
});

test("actual Linux procfs capture rejects a title transition and accepts a fresh post-marker fact", {
  skip: process.platform !== "linux" ? "requires real Linux procfs; no simulated acceptance" : false,
  timeout: 10000,
}, () => {
  const supervisionUrl = new URL("./check-production-runtime-supervision.mjs", import.meta.url).href;
  const helperUrl = new URL("./test-helpers/startup-process-fact.mjs", import.meta.url).href;
  const childSource = `
    import assert from "node:assert/strict";
    import fs from "node:fs";
    import { createHash } from "node:crypto";
    import { syncBuiltinESMExports } from "node:module";
    // Import the actual production exports without executing their CLI entrypoint.
    process.argv[1] = ${JSON.stringify(fileURLToPath(import.meta.url))};
    const { captureProcessFact } = await import(${JSON.stringify(supervisionUrl)});
    const { captureStartupFixtureProcessFact, STARTUP_PROCESS_FACT_KEYS, waitForStartupFixtureTitle } =
      await import(${JSON.stringify(helperUrl)});
    const version = "16.3.4";
    const finalTitle = "next-server (v" + version + ")";
    // --eval contains newlines; replace only this disposable child's own argv first.
    process.title = "fixture-before-next-start";
    const commandLinePath = "/proc/" + process.pid + "/cmdline";
    const originalRead = fs.readFileSync;
    let commandLineReads = 0, guardedCaptures = 0;
    let firstBytes, secondBytes;
    fs.readFileSync = function (file, ...args) {
      const actualBytes = Reflect.apply(originalRead, this, [file, ...args]);
      if (file === commandLinePath) {
        commandLineReads += 1;
        if (commandLineReads === 1) {
          firstBytes = Buffer.from(actualBytes);
          // Return the real old bytes, then make the second real read see the new title.
          process.title = finalTitle;
        } else if (commandLineReads === 2) secondBytes = Buffer.from(actualBytes);
      }
      return actualBytes;
    };
    syncBuiltinESMExports();
    try {
      assert.throws(() => captureStartupFixtureProcessFact(process.pid, (pid) => {
        guardedCaptures += 1;
        return captureProcessFact(pid);
      }), (error) => error.message === "process_identity_drift");
      assert.equal(guardedCaptures, 1, "a rejected observation must not be retried");
      assert.equal(commandLineReads, 2, "the unchanged capture performs both real procfs reads");
      assert.ok(firstBytes.subarray(0, Buffer.byteLength("fixture-before-next-start\\0")).equals(
        Buffer.from("fixture-before-next-start\\0")));
      assert.ok(secondBytes.subarray(0, Buffer.byteLength(finalTitle + "\\0")).equals(
        Buffer.from(finalTitle + "\\0")));
      assert.equal(firstBytes.equals(secondBytes), false);
    } finally {
      fs.readFileSync = originalRead;
      syncBuiltinESMExports();
    }
    await waitForStartupFixtureTitle({
      pid: process.pid, version, deadline: Date.now() + 2000,
      pause: () => assert.fail("the already initialized real title must not wait"),
    });
    let freshCaptures = 0;
    const fact = captureStartupFixtureProcessFact(process.pid, (pid) => {
      freshCaptures += 1;
      return captureProcessFact(pid);
    });
    assert.equal(freshCaptures, 1);
    assert.deepEqual(Object.keys(fact), STARTUP_PROCESS_FACT_KEYS);
    assert.equal(fact.pid, process.pid);
    assert.equal(fact.uid, process.getuid());
    assert.equal(fact.cwd, fs.realpathSync(process.cwd()));
    assert.equal(fact.executable, fs.realpathSync(process.execPath));
    assert.match(fact.startTicks, /^[1-9][0-9]*$/);
    assert.equal(fact.commandLineDigest, createHash("sha256").update(
      originalRead(commandLinePath)).digest("hex"));
    console.log(JSON.stringify({redGuardRejected:true, guardedCaptures, commandLineReads, freshCaptures, finalTitleAccepted:true}));
  `;
  const child = spawnSync(process.execPath, ["--input-type=module", "--eval", childSource], {
    encoding: "utf8", timeout: 5000, maxBuffer: 32768,
    env: { NODE_OPTIONS: "", NODE_PATH: "" },
  });
  assert.equal(child.error, undefined);
  assert.equal(child.signal, null);
  assert.equal(child.status, 0, child.stderr);
  assert.deepEqual(JSON.parse(child.stdout), {
    redGuardRejected: true, guardedCaptures: 1, commandLineReads: 2,
    freshCaptures: 1, finalTitleAccepted: true,
  });
});

test("wrong versions, substrings and extra arguments cannot become initialized markers", async () => {
  for (const bytes of [
    Buffer.from("next-server (v16.3.5)\0"),
    Buffer.from("prefix next-server (v16.3.4)\0"),
    Buffer.from("next-server (v16.3.4)\0extra\0"),
  ]) {
    let time = 100, reads = 0;
    await assert.rejects(waitForStartupFixtureTitle({
      pid: 1234, version: "16.3.4", deadline: 125, now: () => time,
      readCommandLine: () => { reads += 1; return bytes; },
      pause: async (milliseconds) => { time += milliseconds; },
    }), /startup_fixture_title_timeout/);
    assert.equal(reads, 1);
    assert.equal(time, 125);
  }
});

test("invalid marker bytes and process read failures fail without retry", async () => {
  for (const bytes of [Buffer.alloc(0), Buffer.alloc(65537), Buffer.from("next-server (v16.3.4)"), Buffer.from([255, 0])]) {
    let reads = 0;
    await assert.rejects(waitForStartupFixtureTitle({
      pid: 1234, version: "16.3.4", deadline: 200, now: () => 100,
      readCommandLine: () => { reads += 1; return bytes; },
      pause: () => assert.fail("malformed marker must not wait"),
    }));
    assert.equal(reads, 1);
  }
  for (const code of ["ENOENT", "EACCES"]) {
    const failure = Object.assign(new Error(code), { code });
    let reads = 0;
    await assert.rejects(waitForStartupFixtureTitle({
      pid: 1234, version: "16.3.4", deadline: 200, now: () => 100,
      readCommandLine: () => { reads += 1; throw failure; },
      pause: () => assert.fail("failed read must not wait"),
    }), (error) => error === failure);
    assert.equal(reads, 1);
  }
});

test("expired or over-budget marker observations never admit a first capture", async () => {
  let reads = 0, time = 200;
  const options = {
    pid: 1234, version: "16.3.4", deadline: 200, now: () => time,
    readCommandLine: () => { reads += 1; time = 200; return finalTitle; },
    pause: () => assert.fail("expired title must not wait"),
  };
  await assert.rejects(waitForStartupFixtureTitle(options), /startup_fixture_title_timeout/);
  assert.equal(reads, 0);
  time = 100;
  await assert.rejects(waitForStartupFixtureTitle(options), /startup_fixture_title_timeout/);
  assert.equal(reads, 1);
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
  assert.match(fixture, /const deadline=Date\.now\(\)\+60000;[\s\S]*nextVersion=JSON\.parse\(readFileSync\(release\+'\/node_modules\/next\/package\.json','utf8'\)\)\.version;[\s\S]*await waitForStartupFixtureTitle\(\{pid:row\.pid,version:nextVersion,deadline\}\);\s*initial=fact\(row\.pid\)/);
  assert.equal((fixture.match(/Date\.now\(\)\+60000/g) ?? []).length, 1);
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
