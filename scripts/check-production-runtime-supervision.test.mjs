import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createServer } from "node:net";
import {
  chmod,
  link,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  classifyRuntimeSupervision,
  RUNTIME_SUPERVISION_CODES,
} from "./check-production-runtime-supervision.mjs";

const runtime = "/srv/faolla/releases/aaaaaaaaaaaa-20260823120000";
const probePath = fileURLToPath(
  new URL("./check-production-runtime-supervision.mjs", import.meta.url),
);

async function unusedLoopbackPort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const port = address.port;
  await new Promise((resolve, reject) =>
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    }),
  );
  return port;
}

async function createRuntimeFixture(root, options = {}) {
  const expectedBuildId = options.expectedBuildId ?? "a".repeat(40);
  const opaqueBuildId =
    options.opaqueBuildId ?? "opaque.next-build_ID~2026-08-23";
  const appDirectory = join(root, "merchant-space");
  const releasesRoot = `${appDirectory}.releases`;
  const runtimeName = `${expectedBuildId.slice(0, 12)}-${options.timestamp ?? "20260823120000"}`;
  await mkdir(appDirectory, { recursive: true });
  await mkdir(releasesRoot, { recursive: true });
  const runtimeRoot = options.childLayout
    ? join(appDirectory, ".releases")
    : releasesRoot;
  const runtimeDirectory = join(runtimeRoot, runtimeName);
  await mkdir(join(runtimeDirectory, ".next"), { recursive: true });
  await mkdir(join(runtimeDirectory, "node_modules", "next", "dist", "bin"), {
    recursive: true,
  });
  await writeFile(
    join(runtimeDirectory, ".env.local"),
    `FAOLLA_WEB_BUILD_ID=${expectedBuildId}\n` +
      `NEXT_PUBLIC_FAOLLA_WEB_BUILD_ID=${expectedBuildId}\n`,
    { mode: 0o600 },
  );
  await writeFile(
    join(runtimeDirectory, ".next", "BUILD_ID"),
    `${opaqueBuildId}\n`,
    {
      mode: 0o600,
    },
  );
  const nextEntry = join(
    runtimeDirectory,
    "node_modules",
    "next",
    "dist",
    "bin",
    "next",
  );
  await writeFile(nextEntry, "#!/usr/bin/env node\n", { mode: 0o700 });
  await chmod(nextEntry, 0o700);
  const currentLink = `${appDirectory}.current`;
  if (options.createCurrent !== false) {
    await symlink(runtimeDirectory, currentLink, "dir");
  }
  return {
    appDirectory,
    currentLink,
    expectedBuildId,
    nextEntry,
    opaqueBuildId,
    releasesRoot,
    runtimeDirectory,
  };
}

async function createEmptySs(binDirectory, source = "#!/bin/sh\nexit 0\n") {
  await mkdir(binDirectory, { recursive: true });
  const ssPath = join(binDirectory, "ss");
  await writeFile(ssPath, source, { mode: 0o700 });
  await chmod(ssPath, 0o700);
}

function runProbe(fixture, binDirectory, port, environment = {}) {
  return spawnSync(
    process.execPath,
    [
      probePath,
      fixture.appDirectory,
      "faolla-web",
      String(port),
      fixture.expectedBuildId,
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        ...environment,
        PATH: `${binDirectory}${delimiter}${process.env.PATH ?? ""}`,
      },
      timeout: 15_000,
    },
  );
}

function assertFixedProbeResult(result, code, status, sensitiveValues = []) {
  assert.equal(result.status, status, `${result.stdout}\n${result.stderr}`);
  assert.equal(result.signal, null);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, `[runtime-supervision] ${code}\n`);
  for (const value of sensitiveValues) {
    assert.equal(`${result.stdout}${result.stderr}`.includes(value), false);
  }
}

function processFact(pid, cwd = runtime, parentPid = 1) {
  return {
    pid,
    parentPid,
    startTicks: String(pid + 1000),
    processIdentity: `1:${pid}:1`,
    cwd,
    cwdIdentity: `2:${pid}:2`,
  };
}

function snapshot(overrides = {}) {
  return {
    runtime,
    stable: true,
    healthVerified: true,
    ownership: { state: "owned", mode: "direct", pid: 101 },
    listener: { state: "single", pid: 101, chain: [processFact(101)] },
    ...overrides,
  };
}

test("classifies an exact direct Next PM2 listener", () => {
  assert.equal(
    classifyRuntimeSupervision(snapshot()),
    RUNTIME_SUPERVISION_CODES.direct,
  );
});

test("classifies an exact legacy npm wrapper and its listener descendant", () => {
  assert.equal(
    classifyRuntimeSupervision(
      snapshot({
        ownership: { state: "owned", mode: "legacy", pid: 101 },
        listener: {
          state: "single",
          pid: 303,
          chain: [
            processFact(303, runtime, 202),
            processFact(202, runtime, 101),
            processFact(101),
          ],
        },
      }),
    ),
    RUNTIME_SUPERVISION_CODES.legacy,
  );
});

test("distinguishes a stable runtime listener reparented directly to init", () => {
  assert.equal(
    classifyRuntimeSupervision(
      snapshot({
        ownership: { state: "init_reparented", mode: "none", pid: 0 },
        listener: { state: "single", pid: 303, chain: [processFact(303)] },
      }),
    ),
    RUNTIME_SUPERVISION_CODES.initReparented,
  );
});

test("fails closed for missing, multiple, unrelated, or unstable listeners", () => {
  const fixtures = [
    [
      snapshot({
        healthVerified: false,
        listener: { state: "absent", pid: 0, chain: [] },
      }),
      RUNTIME_SUPERVISION_CODES.listenerAbsent,
    ],
    [
      snapshot({ listener: { state: "mismatch", pid: 0, chain: [] } }),
      RUNTIME_SUPERVISION_CODES.mismatch,
    ],
    [
      snapshot({
        listener: { state: "single", pid: 202, chain: [processFact(202)] },
      }),
      RUNTIME_SUPERVISION_CODES.mismatch,
    ],
    [snapshot({ stable: false }), RUNTIME_SUPERVISION_CODES.unreadable],
    [snapshot({ healthVerified: false }), RUNTIME_SUPERVISION_CODES.unreadable],
    [
      snapshot({ ownership: { state: "mismatch", mode: "unknown", pid: 0 } }),
      RUNTIME_SUPERVISION_CODES.mismatch,
    ],
  ];
  for (const [fixture, expected] of fixtures) {
    assert.equal(classifyRuntimeSupervision(fixture), expected);
  }
});

test(
  "the Linux probe accepts a real sibling release with an opaque Next BUILD_ID",
  { skip: process.platform !== "linux", timeout: 20_000 },
  async () => {
    const temporaryDirectory = await mkdtemp(
      join(tmpdir(), "faolla-runtime-supervision-positive-"),
    );
    try {
      const fixture = await createRuntimeFixture(temporaryDirectory);
      const binDirectory = join(temporaryDirectory, "bin");
      await createEmptySs(binDirectory);
      const port = await unusedLoopbackPort();
      const result = runProbe(fixture, binDirectory, port);
      assertFixedProbeResult(
        result,
        RUNTIME_SUPERVISION_CODES.listenerAbsent,
        21,
        [temporaryDirectory, fixture.expectedBuildId, fixture.opaqueBuildId],
      );
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  },
);

test(
  "the Linux runtime proof rejects child layouts and linked trusted files",
  { skip: process.platform !== "linux", timeout: 30_000 },
  async () => {
    const temporaryDirectory = await mkdtemp(
      join(tmpdir(), "faolla-runtime-supervision-negative-"),
    );
    const binDirectory = join(temporaryDirectory, "bin");
    const cases = [
      {
        name: "release directory nested under the checkout",
        options: { childLayout: true },
      },
      {
        name: "environment symlink",
        mutate: async (fixture) => {
          const path = join(fixture.runtimeDirectory, ".env.local");
          const target = `${path}.target`;
          await rename(path, target);
          await symlink(target, path, "file");
        },
      },
      {
        name: "environment hardlink",
        mutate: async (fixture) => {
          const path = join(fixture.runtimeDirectory, ".env.local");
          await link(path, `${path}.alias`);
        },
      },
      {
        name: "Next BUILD_ID symlink",
        mutate: async (fixture) => {
          const path = join(fixture.runtimeDirectory, ".next", "BUILD_ID");
          const target = `${path}.target`;
          await rename(path, target);
          await symlink(target, path, "file");
        },
      },
      {
        name: "Next BUILD_ID hardlink",
        mutate: async (fixture) => {
          const path = join(fixture.runtimeDirectory, ".next", "BUILD_ID");
          await link(path, `${path}.alias`);
        },
      },
      {
        name: "Next entry symlink",
        mutate: async (fixture) => {
          const target = `${fixture.nextEntry}.target`;
          await rename(fixture.nextEntry, target);
          await symlink(target, fixture.nextEntry, "file");
        },
      },
      {
        name: "Next entry hardlink",
        mutate: async (fixture) => {
          await link(fixture.nextEntry, `${fixture.nextEntry}.alias`);
        },
      },
    ];
    try {
      await createEmptySs(binDirectory);
      const port = await unusedLoopbackPort();
      for (const [index, fixtureCase] of cases.entries()) {
        const fixtureRoot = join(temporaryDirectory, `fixture-${index}`);
        await mkdir(fixtureRoot, { recursive: true });
        const fixture = await createRuntimeFixture(
          fixtureRoot,
          fixtureCase.options,
        );
        await fixtureCase.mutate?.(fixture);
        const result = runProbe(fixture, binDirectory, port);
        assertFixedProbeResult(
          result,
          RUNTIME_SUPERVISION_CODES.unreadable,
          23,
          [fixtureRoot, fixture.expectedBuildId, fixture.opaqueBuildId],
        );
      }
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  },
);

test(
  "the Linux probe detects an atomic current-link drift between stable snapshots",
  { skip: process.platform !== "linux", timeout: 20_000 },
  async () => {
    const temporaryDirectory = await mkdtemp(
      join(tmpdir(), "faolla-runtime-supervision-drift-"),
    );
    try {
      const first = await createRuntimeFixture(temporaryDirectory);
      const second = await createRuntimeFixture(temporaryDirectory, {
        createCurrent: false,
        timestamp: "20260823120001",
      });
      const pendingLink = `${first.currentLink}.test-pending`;
      const marker = join(temporaryDirectory, "current-drift-triggered");
      await symlink(second.runtimeDirectory, pendingLink, "dir");
      const binDirectory = join(temporaryDirectory, "bin");
      await createEmptySs(
        binDirectory,
        [
          "#!/bin/sh",
          "set -eu",
          'if [ ! -e "$FAOLLA_DRIFT_MARKER" ]; then',
          '  : > "$FAOLLA_DRIFT_MARKER"',
          '  mv -Tf -- "$FAOLLA_PENDING_LINK" "$FAOLLA_CURRENT_LINK"',
          "fi",
          "exit 0",
          "",
        ].join("\n"),
      );
      const port = await unusedLoopbackPort();
      const result = runProbe(first, binDirectory, port, {
        FAOLLA_CURRENT_LINK: first.currentLink,
        FAOLLA_DRIFT_MARKER: marker,
        FAOLLA_PENDING_LINK: pendingLink,
      });
      assert.equal(await readFile(marker, "utf8"), "");
      assert.equal(
        await realpath(first.currentLink),
        await realpath(second.runtimeDirectory),
      );
      assertFixedProbeResult(result, RUNTIME_SUPERVISION_CODES.unreadable, 23, [
        temporaryDirectory,
        first.expectedBuildId,
        first.opaqueBuildId,
      ]);
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  },
);

test("the remote probe is read-only and emits only fixed supervision codes", async () => {
  const source = await readFile(
    new URL("./check-production-runtime-supervision.mjs", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(
    source,
    /\b(?:kill|pkill|killall|fuser|unlink|rename|rm|rmdir|writeFile|appendFile)\b|pm2\s+(?:delete|stop|restart|start|save)/,
  );
  assert.doesNotMatch(source, /runCaptured\("pm2"|\bpm2\s+jlist\b/);
  assert.match(source, /runCaptured\("ss", \["-H", "-ltnp"/);
  assert.match(source, /isPm2DaemonFact/);
  assert.match(source, /captureSelectedProcessEnvironment/);
  assert.match(source, /\/api\/app-web-version/);
  assert.match(source, /realpathSync\(`\$\{appDirectory\}\.releases`\)/);
  assert.match(source, /const currentLink = `\$\{appDirectory\}\.current`/);
  assert.match(source, /\^\[A-Za-z0-9\._~-\]\{1,128\}\$/);
  assert.doesNotMatch(source, /nextBuild\.text !== expectedBuildId/);
  assert.match(source, /constants\.O_NOFOLLOW/);
  assert.match(source, /fileIdentity\(after\) !== openedProof\.identity/);
  assert.doesNotMatch(source, /console\.(?:log|error|warn)|process\.stderr/);
  for (const code of Object.values(RUNTIME_SUPERVISION_CODES)) {
    assert.match(source, new RegExp(`\\b${code}\\b`));
  }
});
