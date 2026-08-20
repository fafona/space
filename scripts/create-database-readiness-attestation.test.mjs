import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createDatabaseReadinessAttestation,
  runDatabaseReadinessAttestationCli,
} from "./create-database-readiness-attestation.mjs";
import {
  canonicalJsonBytes,
  parseProductionReleaseAttestation,
  PRODUCTION_BACKUP_ATTESTATION_KIND,
  PRODUCTION_READINESS_ATTESTATION_KIND,
  ProductionReleaseAttestationError,
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
  headSha = TARGET_SHA,
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
    headSha,
    file,
  };
}

function backupAttestation(overrides = {}) {
  const value = {
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
  };
  return Object.assign(value, overrides);
}

function checker(overrides = {}) {
  const value = {
    ok: true,
    schemaVersion: 1,
    mode: "read_only",
    databaseContainer: "supabase-db",
    databaseIdentity: {
      dbName: "postgres",
      dbOid: "16384",
      systemId: "7612345678901234567",
      primary: true,
    },
    databaseActorReady: true,
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
      asOf: "2026-08-20T11:59:00.000Z",
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
    status: "ready",
  };
  return Object.assign(value, overrides);
}

function fileBinding(filePath, bytes) {
  return {
    name: path.basename(filePath),
    sizeBytes: String(bytes.length),
    sha256: sha256Hex(bytes),
  };
}

async function writeCanonical(filePath, value) {
  const bytes = canonicalJsonBytes(value);
  await writeFile(filePath, bytes);
  return bytes;
}

async function fixture(directory) {
  const paths = {
    backupAttestation: path.join(
      directory,
      "production-backup-attestation.json",
    ),
    backupArtifact: path.join(directory, "backup-attestation-artifact.json"),
    checker: path.join(directory, "production-readiness-report.json"),
    readinessArtifact: path.join(directory, "readiness-report-artifact.json"),
    run: path.join(directory, "readiness-run.json"),
    remoteSource: path.join(directory, "readiness-remote-source.json"),
    output: path.join(directory, "production-readiness-attestation.json"),
  };
  const backup = parseProductionReleaseAttestation(backupAttestation(), {
    nowMs: NOW_MS,
    expectedKind: "backup",
  });
  const backupBytes = await writeCanonical(paths.backupAttestation, backup);
  const report = checker();
  const checkerBytes = Buffer.from(`${JSON.stringify(report)}\n`, "utf8");
  await writeFile(paths.checker, checkerBytes);
  const backupArtifactMetadata = artifact({
    id: "9002",
    name: "faolla-production-backup-attestation-8001-1",
    runId: "8001",
    createdAt: "2026-08-20T11:10:00.000Z",
    file: fileBinding(paths.backupAttestation, backupBytes),
    digestCharacter: "e",
  });
  const readinessArtifactMetadata = artifact({
    id: "9003",
    name: "faolla-production-readiness-report-8002-1",
    runId: "8002",
    createdAt: "2026-08-20T11:59:30.000Z",
    file: fileBinding(paths.checker, checkerBytes),
    digestCharacter: "f",
  });
  const run = {
    id: "8002",
    attempt: "1",
    workflowPath: ".github/workflows/ordinary-account-cutover-readiness.yml",
    event: "workflow_dispatch",
    headSha: TARGET_SHA,
    headBranch: "main",
  };
  const remoteSource = {
    headSha: TARGET_SHA,
    originMainSha: TARGET_SHA,
    detached: true,
    cleanBefore: true,
    cleanAfter: true,
  };
  await Promise.all([
    writeCanonical(paths.backupArtifact, backupArtifactMetadata),
    writeCanonical(paths.readinessArtifact, readinessArtifactMetadata),
    writeCanonical(paths.run, run),
    writeCanonical(paths.remoteSource, remoteSource),
  ]);
  return {
    paths,
    backup,
    report,
    backupArtifactMetadata,
    readinessArtifactMetadata,
    run,
    remoteSource,
    input: {
      backupAttestationPath: paths.backupAttestation,
      backupAttestationArtifactPath: paths.backupArtifact,
      checkerReportPath: paths.checker,
      readinessArtifactPath: paths.readinessArtifact,
      runPath: paths.run,
      remoteSourcePath: paths.remoteSource,
      containerId: CONTAINER_ID,
      issuedAt: NOW,
      validUntil: "2026-08-20T14:00:00.000Z",
    },
  };
}

async function inTemporaryDirectory(callback) {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "faolla-readiness-builder-test-"),
  );
  try {
    await callback(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function assertCode(promise, expectedCode) {
  await assert.rejects(
    promise,
    (error) =>
      error instanceof ProductionReleaseAttestationError &&
      error.code === expectedCode,
  );
}

function cliArguments(value) {
  return [
    "create",
    "--backup-attestation",
    value.paths.backupAttestation,
    "--backup-attestation-artifact",
    value.paths.backupArtifact,
    "--checker-report",
    value.paths.checker,
    "--readiness-artifact",
    value.paths.readinessArtifact,
    "--run",
    value.paths.run,
    "--remote-source",
    value.paths.remoteSource,
    "--container-id",
    CONTAINER_ID,
    "--issued-at",
    NOW,
    "--valid-until",
    "2026-08-20T14:00:00.000Z",
    "--output",
    value.paths.output,
    "--now",
    NOW,
  ];
}

test("builder binds canonical backup, exact ready report, artifacts, run, source, database, and baseline", async () => {
  await inTemporaryDirectory(async (directory) => {
    const value = await fixture(directory);
    const result = await createDatabaseReadinessAttestation(value.input, {
      nowMs: NOW_MS,
    });
    const parsed = parseProductionReleaseAttestation(result.attestation, {
      nowMs: NOW_MS,
      expectedKind: "readiness",
    });

    assert.equal(parsed.kind, PRODUCTION_READINESS_ATTESTATION_KIND);
    assert.deepEqual(parsed.database, database());
    assert.equal(parsed.baseline.merchantRecordCount, "11");
    assert.equal(parsed.baseline.personalCanonicalBindingCount, "6");
    assert.equal(parsed.baseline.ordinaryIdentityContentSha256, "1".repeat(64));
    assert.equal(parsed.backup.attestation.run.id, "8001");
    assert.deepEqual(result.canonicalBytes, canonicalJsonBytes(parsed));
    assert.equal(result.sizeBytes, String(result.canonicalBytes.length));
    assert.equal(result.sha256, sha256Hex(result.canonicalBytes));
  });
});

test("CLI accepts only exact unique path arguments and atomically emits canonical bytes", async () => {
  await inTemporaryDirectory(async (directory) => {
    const value = await fixture(directory);
    const writes = [];
    const status = await runDatabaseReadinessAttestationCli(
      cliArguments(value),
      { write: (bytes) => writes.push(Buffer.from(bytes)) },
    );
    const output = await readFile(value.paths.output);
    const summary = JSON.parse(Buffer.concat(writes).toString("utf8"));

    assert.equal(status, 0);
    assert.deepEqual(output, canonicalJsonBytes(JSON.parse(output)));
    assert.equal(summary.ok, true);
    assert.equal(summary.outputFile, path.basename(value.paths.output));
    assert.equal(summary.sizeBytes, String(output.length));
    assert.equal(summary.sha256, sha256Hex(output));

    await assertCode(
      runDatabaseReadinessAttestationCli([
        ...cliArguments(value),
        "--output",
        path.join(directory, "duplicate.json"),
      ]),
      "readiness_attestation_cli_argument_invalid",
    );
    const extra = cliArguments(value);
    extra.push("--unexpected", "value");
    await assertCode(
      runDatabaseReadinessAttestationCli(extra),
      "readiness_attestation_cli_argument_invalid",
    );
    const reused = cliArguments(value);
    reused[reused.indexOf("--output") + 1] = value.paths.run;
    await assertCode(
      runDatabaseReadinessAttestationCli(reused),
      "readiness_attestation_cli_path_reused",
    );
  });
});

test("builder rejects wrong backup scope and scheduled backup evidence", async (t) => {
  await t.test("backup target differs from readiness run", async () => {
    await inTemporaryDirectory(async (directory) => {
      const value = await fixture(directory);
      const wrongSha = "c".repeat(40);
      const backup = structuredClone(value.backup);
      backup.targetSha = wrongSha;
      backup.run.headSha = wrongSha;
      backup.remoteSource.headSha = wrongSha;
      backup.remoteSource.originMainSha = wrongSha;
      backup.backupArtifact.headSha = wrongSha;
      const backupBytes = await writeCanonical(
        value.paths.backupAttestation,
        backup,
      );
      value.backupArtifactMetadata.headSha = wrongSha;
      value.backupArtifactMetadata.file = fileBinding(
        value.paths.backupAttestation,
        backupBytes,
      );
      await writeCanonical(
        value.paths.backupArtifact,
        value.backupArtifactMetadata,
      );
      await assertCode(
        createDatabaseReadinessAttestation(value.input, { nowMs: NOW_MS }),
        "attestation_run_head_sha_mismatch",
      );
    });
  });

  await t.test("scheduled backup is not cutover evidence", async () => {
    await inTemporaryDirectory(async (directory) => {
      const value = await fixture(directory);
      const backup = structuredClone(value.backup);
      backup.run.event = "schedule";
      const backupBytes = await writeCanonical(
        value.paths.backupAttestation,
        backup,
      );
      value.backupArtifactMetadata.file = fileBinding(
        value.paths.backupAttestation,
        backupBytes,
      );
      await writeCanonical(
        value.paths.backupArtifact,
        value.backupArtifactMetadata,
      );
      await assertCode(
        createDatabaseReadinessAttestation(value.input, { nowMs: NOW_MS }),
        "readiness_backup_event_invalid",
      );
    });
  });
});

test("builder rejects checker database identity and baseline drift", async (t) => {
  for (const [name, mutate, code] of [
    [
      "container ID",
      (value) => {
        value.input.containerId = "c".repeat(64);
      },
      "readiness_backup_database_mismatch",
    ],
    [
      "database name",
      (value) => {
        value.report.databaseIdentity.dbName = "template1";
      },
      "readiness_backup_database_mismatch",
    ],
    [
      "system identifier",
      (value) => {
        value.report.databaseIdentity.systemId = "7612345678901234568";
      },
      "readiness_backup_database_mismatch",
    ],
    [
      "blocked baseline",
      (value) => {
        value.report.baselineReady = false;
        value.report.status = "blocked";
      },
      "readiness_checker_not_ready",
    ],
    [
      "ready population changed after backup",
      (value) => {
        value.report.readiness.merchantRecordCount = 12;
        value.report.readiness.merchantAuthoritativeBindingCount = 12;
      },
      "readiness_backup_baseline_mismatch",
    ],
    [
      "same-count identity content changed after backup",
      (value) => {
        value.report.readiness.ordinaryIdentityContentSha256 = "2".repeat(64);
      },
      "readiness_backup_baseline_mismatch",
    ],
  ]) {
    await t.test(name, async () => {
      await inTemporaryDirectory(async (directory) => {
        const value = await fixture(directory);
        mutate(value);
        if (name !== "container ID") {
          const checkerBytes = Buffer.from(
            `${JSON.stringify(value.report)}\n`,
            "utf8",
          );
          await writeFile(value.paths.checker, checkerBytes);
          value.readinessArtifactMetadata.file = fileBinding(
            value.paths.checker,
            checkerBytes,
          );
          await writeCanonical(
            value.paths.readinessArtifact,
            value.readinessArtifactMetadata,
          );
        }
        await assertCode(
          createDatabaseReadinessAttestation(value.input, { nowMs: NOW_MS }),
          code,
        );
      });
    });
  }
});

test("builder rejects artifact metadata, actual file, run, and TTL mismatches", async (t) => {
  const cases = [
    [
      "artifact run",
      async (value) => {
        value.readinessArtifactMetadata.workflowRunId = "8003";
        await writeCanonical(
          value.paths.readinessArtifact,
          value.readinessArtifactMetadata,
        );
      },
      "attestation_artifact_run_mismatch",
    ],
    [
      "artifact file hash",
      async (value) => {
        value.readinessArtifactMetadata.file.sha256 = "0".repeat(64);
        await writeCanonical(
          value.paths.readinessArtifact,
          value.readinessArtifactMetadata,
        );
      },
      "readiness_artifact_file_mismatch",
    ],
    [
      "readiness run",
      async (value) => {
        value.run.workflowPath = ".github/workflows/database-backup.yml";
        await writeCanonical(value.paths.run, value.run);
      },
      "attestation_run_workflow_path_mismatch",
    ],
    [
      "readiness TTL",
      async (value) => {
        value.input.validUntil = "2026-08-20T14:00:00.001Z";
      },
      "attestation_ttl_invalid",
    ],
  ];
  for (const [name, mutate, code] of cases) {
    await t.test(name, async () => {
      await inTemporaryDirectory(async (directory) => {
        const value = await fixture(directory);
        await mutate(value);
        await assertCode(
          createDatabaseReadinessAttestation(value.input, { nowMs: NOW_MS }),
          code,
        );
      });
    });
  }
});

test("builder rejects noncanonical JSON, non-exact checker bytes, and extra keys", async (t) => {
  const cases = [
    [
      "noncanonical backup",
      async (value) => {
        await writeFile(
          value.paths.backupAttestation,
          `${JSON.stringify(value.backup, null, 2)}\n`,
        );
      },
      "attestation_json_not_canonical",
    ],
    [
      "non-exact checker",
      async (value) => {
        await writeFile(
          value.paths.checker,
          `${JSON.stringify(value.report, null, 2)}\n`,
        );
      },
      "readiness_checker_json_not_exact",
    ],
    [
      "extra checker key",
      async (value) => {
        value.report.unexpected = true;
        await writeFile(
          value.paths.checker,
          Buffer.from(`${JSON.stringify(value.report)}\n`, "utf8"),
        );
      },
      "readiness_checker_keys_invalid",
    ],
    [
      "extra run key",
      async (value) => {
        value.run.unexpected = true;
        await writeCanonical(value.paths.run, value.run);
      },
      "attestation_run_invalid",
    ],
  ];
  for (const [name, mutate, code] of cases) {
    await t.test(name, async () => {
      await inTemporaryDirectory(async (directory) => {
        const value = await fixture(directory);
        await mutate(value);
        await assertCode(
          createDatabaseReadinessAttestation(value.input, { nowMs: NOW_MS }),
          code,
        );
      });
    });
  }
});

test("a failed CLI validation leaves no output file", async () => {
  await inTemporaryDirectory(async (directory) => {
    const value = await fixture(directory);
    value.report.status = "blocked";
    value.report.objectContractsReady = false;
    await writeFile(
      value.paths.checker,
      Buffer.from(`${JSON.stringify(value.report)}\n`, "utf8"),
    );
    await assertCode(
      runDatabaseReadinessAttestationCli(cliArguments(value)),
      "readiness_checker_not_ready",
    );
    await assert.rejects(access(value.paths.output), { code: "ENOENT" });
  });
});
