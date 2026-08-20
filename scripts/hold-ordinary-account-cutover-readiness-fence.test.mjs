import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import {
  access,
  link,
  lstat,
  mkdtemp,
  open,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough, Writable } from "node:stream";
import test from "node:test";

import { ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL } from "./check-ordinary-account-cutover-readiness.mjs";
import {
  buildOrdinaryAccountCutoverReadinessFenceSql,
  holdOrdinaryAccountCutoverReadinessFence,
  OrdinaryAccountCutoverReadinessFenceError,
  runOrdinaryAccountCutoverReadinessFenceCli,
  writeAtomicReadinessFenceMarker,
} from "./hold-ordinary-account-cutover-readiness-fence.mjs";
import {
  canonicalJsonBytes,
  parseProductionReleaseAttestation,
  PRODUCTION_BACKUP_ATTESTATION_KIND,
  PRODUCTION_READINESS_ATTESTATION_KIND,
  sha256Hex,
} from "./production-release-attestation.mjs";

const NOW = "2026-08-20T12:00:00.000Z";
const NOW_MS = Date.parse(NOW);
const TARGET_SHA = "a".repeat(40);
const CONTAINER_ID = "b".repeat(64);

function database(overrides = {}) {
  return {
    containerName: "supabase-db",
    containerId: CONTAINER_ID,
    dbName: "postgres",
    dbOid: "16384",
    systemId: "7612345678901234567",
    primary: true,
    ...overrides,
  };
}

function baseline(overrides = {}) {
  return {
    merchantRecordCount: "11",
    merchantAuthoritativeBindingCount: "11",
    merchantInvalidBindingCount: "0",
    personalCanonicalBindingCount: "6",
    personalCanonicalOrphanCount: "0",
    personalInvalidCanonicalCount: "0",
    personalDuplicateAuthUserCount: "0",
    personalDuplicateAccountIdCount: "0",
    crossAccountTypeOverlapCount: "0",
    accountIdentifierCollisionCount: "0",
    staffRegistryOverlapCount: "0",
    systemSitePrincipalOverlapCount: "0",
    ordinaryIdentityContentSha256: "1".repeat(64),
    ...overrides,
  };
}

function artifact({
  id,
  name,
  runId,
  createdAt,
  file,
  digestCharacter = "c",
} = {}) {
  return {
    id,
    name,
    digest: `sha256:${digestCharacter.repeat(64)}`,
    sizeBytes: "4096",
    createdAt,
    expiresAt: "2026-08-27T12:00:00.000Z",
    expired: false,
    workflowRunId: runId,
    workflowRunAttempt: "1",
    headSha: TARGET_SHA,
    file,
  };
}

function readinessAttestation(overrides = {}) {
  const backup = parseProductionReleaseAttestation(
    {
      schemaVersion: 1,
      kind: PRODUCTION_BACKUP_ATTESTATION_KIND,
      repository: "fafona/space",
      targetSha: TARGET_SHA,
      run: {
        id: "8001",
        attempt: "1",
        workflowPath: ".github/workflows/database-backup.yml",
        event: "workflow_dispatch",
        headSha: TARGET_SHA,
        headBranch: "main",
      },
      remoteSource: {
        headSha: TARGET_SHA,
        originMainSha: TARGET_SHA,
        detached: true,
        cleanBefore: true,
        cleanAfter: true,
      },
      database: database(),
      baseline: baseline(),
      backupArtifact: artifact({
        id: "9001",
        name: "faolla-encrypted-disaster-recovery-8001-1",
        runId: "8001",
        createdAt: "2026-08-20T11:00:00.000Z",
        file: {
          name: "faolla-database-backup.tar.enc",
          sizeBytes: "2048",
          sha256: "d".repeat(64),
        },
      }),
      issuedAt: "2026-08-20T11:05:00.000Z",
      validUntil: "2026-08-21T11:05:00.000Z",
    },
    { nowMs: NOW_MS, expectedKind: "backup" },
  );
  const backupBytes = canonicalJsonBytes(backup);
  const value = {
    schemaVersion: 1,
    kind: PRODUCTION_READINESS_ATTESTATION_KIND,
    repository: "fafona/space",
    targetSha: TARGET_SHA,
    run: {
      id: "8002",
      attempt: "1",
      workflowPath: ".github/workflows/ordinary-account-cutover-readiness.yml",
      event: "workflow_dispatch",
      headSha: TARGET_SHA,
      headBranch: "main",
    },
    remoteSource: {
      headSha: TARGET_SHA,
      originMainSha: TARGET_SHA,
      detached: true,
      cleanBefore: true,
      cleanAfter: true,
    },
    database: database(),
    baseline: baseline(),
    readinessArtifact: artifact({
      id: "9003",
      name: "faolla-production-readiness-report-8002-1",
      runId: "8002",
      createdAt: "2026-08-20T11:59:00.000Z",
      digestCharacter: "f",
      file: {
        name: "production-readiness-report.json",
        sizeBytes: "1024",
        sha256: "e".repeat(64),
      },
    }),
    backup: {
      attestation: backup,
      attestationArtifact: artifact({
        id: "9002",
        name: "faolla-production-backup-attestation-8001-1",
        runId: "8001",
        createdAt: "2026-08-20T11:10:00.000Z",
        digestCharacter: "1",
        file: {
          name: "production-backup-attestation.json",
          sizeBytes: String(backupBytes.length),
          sha256: sha256Hex(backupBytes),
        },
      }),
    },
    issuedAt: NOW,
    validUntil: "2026-08-20T14:00:00.000Z",
  };
  return parseProductionReleaseAttestation(Object.assign(value, overrides), {
    nowMs: NOW_MS,
    expectedKind: "readiness",
  });
}

function readyReport(overrides = {}) {
  const value = {
    databaseActorReady: true,
    databaseIdentity: {
      dbName: "postgres",
      dbOid: "16384",
      systemId: "7612345678901234567",
      primary: true,
    },
    databaseIdentityReady: true,
    baselineReady: true,
    runtimeRpcHardeningReady: true,
    migrationsReady: true,
    functionMetadataReady: true,
    functionAclReady: true,
    registryAclReady: true,
    objectContractsReady: true,
    readiness: {
      schemaVersion: 1,
      asOf: NOW,
      readyForCutover: true,
      schemaReady: true,
      aclReady: true,
      merchantRecordCount: 11,
      merchantAuthoritativeBindingCount: 11,
      merchantInvalidBindingCount: 0,
      personalCanonicalBindingCount: 6,
      personalCanonicalOrphanCount: 0,
      personalInvalidCanonicalCount: 0,
      personalDuplicateAuthUserCount: 0,
      personalDuplicateAccountIdCount: 0,
      crossAccountTypeOverlapCount: 0,
      accountIdentifierCollisionCount: 0,
      staffRegistryOverlapCount: 0,
      systemSitePrincipalOverlapCount: 0,
      ordinaryIdentityContentSha256: "1".repeat(64),
    },
  };
  return Object.assign(value, overrides);
}

function fenceLine(report = readyReport()) {
  return `${JSON.stringify({ backendPid: "4321", report })}\n`;
}

class FakeChild extends EventEmitter {
  constructor() {
    super();
    this.stdout = new PassThrough();
    this.stderr = new PassThrough();
    this.input = Buffer.alloc(0);
    this.signals = [];
    this.closed = false;
    this.stdin = new Writable({
      write: (chunk, _encoding, callback) => {
        this.input = Buffer.concat([this.input, Buffer.from(chunk)]);
        callback();
      },
    });
  }

  kill(signal) {
    this.signals.push(signal);
    queueMicrotask(() => this.close(null, signal));
    return true;
  }

  close(code = 0, signal = null) {
    if (this.closed) return;
    this.closed = true;
    this.stdout.end();
    this.stderr.end();
    this.emit("close", code, signal);
  }
}

async function temporaryDirectory(callback) {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "faolla-readiness-fence-test-"),
  );
  try {
    await callback(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function fixture(directory, attestation = readinessAttestation()) {
  const attestationPath = path.join(directory, "readiness-attestation.json");
  const markerPath = path.join(directory, "readiness-fence.ready.json");
  await writeFile(attestationPath, canonicalJsonBytes(attestation));
  return {
    attestation,
    attestationPath,
    markerPath,
    input: {
      attestationPath,
      expectedTargetSha: TARGET_SHA,
      expectedRunId: "8002",
      expectedRunAttempt: "1",
      expectedArtifactId: "9003",
      expectedArtifactDigest: `sha256:${"f".repeat(64)}`,
      expectedContainerId: CONTAINER_ID,
      minimumRemainingTtlSeconds: "60",
      markerPath,
      maximumHoldSeconds: "30",
    },
  };
}

async function assertCode(promise, expectedCode) {
  await assert.rejects(
    promise,
    (error) =>
      error instanceof OrdinaryAccountCutoverReadinessFenceError &&
      error.code === expectedCode,
  );
}

async function assertMissing(filePath) {
  await assert.rejects(access(filePath), { code: "ENOENT" });
}

async function waitForFile(filePath) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      return await readFile(filePath);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
  }
  throw new Error("marker_not_created");
}

function coreDependencies(child, overrides = {}) {
  return {
    nowMs: NOW_MS,
    clockMs: () => NOW_MS,
    randomHex: () => "1".repeat(24),
    signalSource: new EventEmitter(),
    spawnProcess: () => child,
    terminateSession: async () => {},
    ...overrides,
  };
}

test("fence SQL derives from the complete checker SQL, captures one report line, sleeps after locks, and has one final rollback", () => {
  const sql = buildOrdinaryAccountCutoverReadinessFenceSql("30");
  const captureBoundary = " AS report\n\n\\gset fence_";
  const captureIndex = sql.indexOf(captureBoundary);
  const originalWithoutRollback = ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL.slice(
    0,
    -"\n\nROLLBACK;".length,
  );

  assert.ok(captureIndex > 0);
  assert.equal(`${sql.slice(0, captureIndex)};`, originalWithoutRollback);
  assert.equal(sql.match(/ROLLBACK;/g)?.length, 1);
  assert.ok(sql.endsWith("ROLLBACK;"));
  assert.ok(sql.indexOf("pg_sleep") > sql.lastIndexOf("LOCK TABLE"));
  assert.ok(sql.indexOf("pg_sleep") > captureIndex);
  assert.equal(
    sql.slice(0, sql.indexOf("pg_sleep")).includes("ROLLBACK;"),
    false,
  );
  assert.match(sql, /30::double precision/);
  assert.throws(
    () => buildOrdinaryAccountCutoverReadinessFenceSql("121"),
    (error) => error.code === "readiness_fence_max_hold_seconds_invalid",
  );
});

test("attestation validation fails closed on wrong, expired, noncanonical, and container-mismatched evidence before Docker", async (t) => {
  const cases = [
    [
      "wrong target",
      async (value) => {
        value.input.expectedTargetSha = "c".repeat(40);
      },
      "attestation_target_sha_mismatch",
      NOW_MS,
    ],
    [
      "expired",
      async () => {},
      "attestation_expired",
      Date.parse("2026-08-20T15:00:00.000Z"),
    ],
    [
      "container",
      async (value) => {
        value.input.expectedContainerId = "c".repeat(64);
      },
      "readiness_fence_container_id_mismatch",
      NOW_MS,
    ],
    [
      "noncanonical",
      async (value) => {
        await writeFile(
          value.attestationPath,
          `${JSON.stringify(value.attestation, null, 2)}\n`,
        );
      },
      "attestation_json_not_canonical",
      NOW_MS,
    ],
    [
      "attestation symlink",
      async (value) => {
        const target = path.join(
          path.dirname(value.attestationPath),
          "readiness-attestation-target.json",
        );
        await writeFile(target, canonicalJsonBytes(value.attestation));
        await unlink(value.attestationPath);
        await symlink(target, value.attestationPath, "file");
      },
      "readiness_fence_attestation_symlink",
      NOW_MS,
    ],
    [
      "attestation path swap",
      async () => {},
      "readiness_fence_attestation_file_changed",
      NOW_MS,
      async (value) => {
        const replacement = path.join(
          path.dirname(value.attestationPath),
          "readiness-attestation-replacement.json",
        );
        await writeFile(replacement, canonicalJsonBytes(value.attestation));
        return {
          attestationFileOperations: {
            lstat,
            open: async (filePath, flags) => {
              await unlink(filePath);
              await rename(replacement, filePath);
              return open(filePath, flags);
            },
          },
        };
      },
    ],
  ];
  for (const [name, mutate, code, nowMs, dependencyFactory] of cases) {
    await t.test(name, async () => {
      await temporaryDirectory(async (directory) => {
        const value = await fixture(directory);
        await mutate(value);
        const extraDependencies = dependencyFactory
          ? await dependencyFactory(value)
          : {};
        let spawnCount = 0;
        await assertCode(
          holdOrdinaryAccountCutoverReadinessFence(value.input, {
            nowMs,
            ...extraDependencies,
            spawnProcess: () => {
              spawnCount += 1;
              throw new Error("must_not_spawn");
            },
          }),
          code,
        );
        assert.equal(spawnCount, 0);
        await assertMissing(value.markerPath);
      });
    });
  }
});

test("blocked and live-database-mismatched reports terminate the session without a marker", async (t) => {
  const blocked = readyReport({ objectContractsReady: false });
  const wrongDatabase = readyReport({
    databaseIdentity: {
      dbName: "postgres",
      dbOid: "16385",
      systemId: "7612345678901234567",
      primary: true,
    },
  });
  const wrongIdentityContent = readyReport();
  wrongIdentityContent.readiness = {
    ...wrongIdentityContent.readiness,
    ordinaryIdentityContentSha256: "2".repeat(64),
  };
  for (const [name, report, code] of [
    ["blocked", blocked, "readiness_fence_report_blocked"],
    [
      "database identity",
      wrongDatabase,
      "readiness_fence_database_identity_mismatch",
    ],
    [
      "same-count identity content",
      wrongIdentityContent,
      "readiness_fence_baseline_mismatch",
    ],
  ]) {
    await t.test(name, async () => {
      await temporaryDirectory(async (directory) => {
        const value = await fixture(directory);
        const child = new FakeChild();
        const dependencies = coreDependencies(child, {
          spawnProcess: () => {
            queueMicrotask(() => child.stdout.write(fenceLine(report)));
            return child;
          },
        });
        await assertCode(
          holdOrdinaryAccountCutoverReadinessFence(value.input, dependencies),
          code,
        );
        assert.deepEqual(child.signals, ["SIGTERM"]);
        await assertMissing(value.markerPath);
      });
    });
  }
});

test("atomic marker creation refuses symlinks and cleans a failed partial temporary write", async (t) => {
  await t.test("existing symlink", async () => {
    await temporaryDirectory(async (directory) => {
      const target = path.join(directory, "target.json");
      const marker = path.join(directory, "marker.json");
      await writeFile(target, "unchanged");
      await symlink(target, marker, "file");
      await assertCode(
        writeAtomicReadinessFenceMarker(
          marker,
          canonicalJsonBytes({ ok: true }),
        ),
        "readiness_fence_marker_exists",
      );
      assert.equal(await readFile(target, "utf8"), "unchanged");
      assert.equal((await lstat(marker)).isSymbolicLink(), true);
    });
  });

  await t.test("partial temporary write", async () => {
    await temporaryDirectory(async (directory) => {
      const marker = path.join(directory, "marker.json");
      const operations = {
        link,
        lstat,
        unlink,
        open: async (...argumentsList) => {
          const handle = await open(...argumentsList);
          return {
            writeFile: async (bytes) => {
              await handle.write(bytes.subarray(0, 4));
              throw Object.assign(new Error("injected_write_failure"), {
                code: "EIO",
              });
            },
            sync: () => handle.sync(),
            close: () => handle.close(),
          };
        },
      };
      await assertCode(
        writeAtomicReadinessFenceMarker(
          marker,
          canonicalJsonBytes({ ok: true }),
          { operations },
        ),
        "readiness_fence_marker_write_failed",
      );
      await assertMissing(marker);
      assert.deepEqual(await readdir(directory), []);
    });
  });
});

test("SIGTERM kills the psql child, waits termination, and removes the complete 0600 marker", async () => {
  await temporaryDirectory(async (directory) => {
    const value = await fixture(directory);
    const child = new FakeChild();
    const signals = new EventEmitter();
    let spawnArguments = [];
    let terminationFinished = false;
    const promise = holdOrdinaryAccountCutoverReadinessFence(
      value.input,
      coreDependencies(child, {
        signalSource: signals,
        spawnProcess: (command, argumentsList) => {
          assert.equal(command, "docker");
          spawnArguments = argumentsList;
          queueMicrotask(() => child.stdout.write(fenceLine()));
          return child;
        },
        terminateSession: async () => {
          await new Promise((resolve) => setTimeout(resolve, 5));
          terminationFinished = true;
        },
      }),
    );
    const markerBytes = await waitForFile(value.markerPath);
    const marker = JSON.parse(markerBytes);
    const markerMode = (await lstat(value.markerPath)).mode & 0o777;

    try {
      assert.deepEqual(markerBytes, canonicalJsonBytes(marker));
      assert.equal(marker.backendPid, "4321");
      assert.equal(marker.database.containerId, CONTAINER_ID);
      assert.ok(
        spawnArguments.includes(
          `FAOLLA_EXPECTED_ORDINARY_IDENTITY_CONTENT_SHA256=${"1".repeat(64)}`,
        ),
      );
      if (process.platform !== "win32") assert.equal(markerMode, 0o600);
    } finally {
      signals.emit("SIGTERM");
    }
    await assertCode(promise, "readiness_fence_interrupted");
    assert.equal(terminationFinished, true);
    assert.deepEqual(child.signals, ["SIGTERM"]);
    await assertMissing(value.markerPath);
  });
});

test("child exit before a report fails closed without orphaning a marker", async () => {
  await temporaryDirectory(async (directory) => {
    const value = await fixture(directory);
    const child = new FakeChild();
    const promise = holdOrdinaryAccountCutoverReadinessFence(
      value.input,
      coreDependencies(child, {
        spawnProcess: () => {
          queueMicrotask(() => child.close(2));
          return child;
        },
      }),
    );
    await assertCode(promise, "readiness_fence_child_failed");
    await assertMissing(value.markerPath);
  });
});

test("finite maximum hold timeout terminates the child without an orphan marker", async () => {
  await temporaryDirectory(async (directory) => {
    const value = await fixture(directory);
    value.input.minimumRemainingTtlSeconds = "1";
    value.input.maximumHoldSeconds = "1";
    const child = new FakeChild();
    const scheduled = [];
    await assertCode(
      holdOrdinaryAccountCutoverReadinessFence(
        value.input,
        coreDependencies(child, {
          setTimer: (callback, milliseconds) => {
            scheduled.push(milliseconds);
            const delay = milliseconds === 1000 ? 0 : milliseconds;
            return setTimeout(callback, delay);
          },
          clearTimer: clearTimeout,
        }),
      ),
      "readiness_fence_timeout",
    );
    assert.ok(scheduled.includes(1000));
    assert.deepEqual(child.signals, ["SIGTERM"]);
    await assertMissing(value.markerPath);
  });
});

function cliArguments(value) {
  return [
    "hold",
    "--attestation",
    value.attestationPath,
    "--expected-target-sha",
    TARGET_SHA,
    "--expected-run-id",
    "8002",
    "--expected-run-attempt",
    "1",
    "--expected-artifact-id",
    "9003",
    "--expected-artifact-digest",
    `sha256:${"f".repeat(64)}`,
    "--expected-container-id",
    CONTAINER_ID,
    "--minimum-remaining-ttl-seconds",
    "60",
    "--ready-marker",
    value.markerPath,
    "--maximum-hold-seconds",
    "30",
  ];
}

test("CLI rejects duplicate and extra arguments and emits only canonical aggregate success", async () => {
  await temporaryDirectory(async (directory) => {
    const value = await fixture(directory);
    await assertCode(
      runOrdinaryAccountCutoverReadinessFenceCli([
        ...cliArguments(value),
        "--expected-run-id",
        "8002",
      ]),
      "readiness_fence_cli_argument_invalid",
    );
    await assertCode(
      runOrdinaryAccountCutoverReadinessFenceCli([
        ...cliArguments(value),
        "--extra",
        "value",
      ]),
      "readiness_fence_cli_argument_invalid",
    );

    const child = new FakeChild();
    const writes = [];
    const statusPromise = runOrdinaryAccountCutoverReadinessFenceCli(
      cliArguments(value),
      coreDependencies(child, {
        spawnProcess: () => {
          queueMicrotask(() => child.stdout.write(fenceLine()));
          setTimeout(() => child.close(0), 20);
          return child;
        },
        write: (bytes) => writes.push(Buffer.from(bytes)),
      }),
    );
    assert.equal(await statusPromise, 0);
    const output = Buffer.concat(writes);
    const summary = JSON.parse(output);
    assert.deepEqual(output, canonicalJsonBytes(summary));
    assert.equal(summary.ok, true);
    assert.equal(summary.backendPid, "4321");
    assert.match(summary.markerSha256, /^[0-9a-f]{64}$/);
    await assertMissing(value.markerPath);
  });
});
