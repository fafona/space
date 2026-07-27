import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  buildProductionPitrReadinessReport,
  inspectProductionPitrState,
} from "./check-production-pitr-readiness.mjs";

const NOW = new Date("2026-07-27T20:00:00.000Z");
const GIB = 1024 ** 3;

function readyState(overrides = {}) {
  return {
    dockerAvailable: true,
    databaseContainer: {
      name: "supabase-db",
      image: "supabase/postgres:15.8.1.085",
    },
    databaseProbeSucceeded: true,
    settings: {
      walLevel: "logical",
      archiveMode: "on",
      archiveTimeoutSeconds: 300,
      archiveCommandConfigured: true,
      archiveLibraryConfigured: false,
    },
    archiver: {
      archivedCount: 120,
      failedCount: 0,
      lastArchivedAt: "2026-07-27T19:55:00.000Z",
      lastFailedAt: null,
    },
    wal: {
      bytes: 128 * 1024 * 1024,
      readyCount: 0,
      doneCount: 12,
    },
    walG: {
      available: true,
      configPresent: true,
      configMode: "600",
    },
    repository: {
      probeSucceeded: true,
      backupCount: 2,
      latestBackupAt: "2026-07-26T20:00:00.000Z",
    },
    disk: {
      totalBytes: 100 * GIB,
      availableBytes: 50 * GIB,
      availablePercent: 50,
    },
    ...overrides,
  };
}

function readyInput(overrides = {}) {
  return {
    now: NOW,
    env: {
      FAOLLA_PITR_ENABLED: "true",
      FAOLLA_PITR_OFFSITE_PROVIDER: "cloudflare_r2",
    },
    configFile: {
      exists: true,
      securePermissions: true,
      mode: "600",
    },
    restoreEvidence: {
      present: true,
      valid: true,
      isolationVerified: true,
      completedAt: "2026-07-26T18:00:00.000Z",
    },
    state: readyState(),
    ...overrides,
  };
}

test("PITR readiness reports ready only with a verified continuous recovery path", () => {
  const report = buildProductionPitrReadinessReport(readyInput());

  assert.equal(report.status, "ready");
  assert.equal(report.pitrReady, true);
  assert.deepEqual(report.blockers, []);
  assert.deepEqual(report.warnings, []);
  assert.equal(report.state.repository.backupCount, 2);
  assert.equal(report.restoreRehearsal.isolationVerified, true);
});

test("PITR readiness fails closed for the current unconfigured production shape", () => {
  const report = buildProductionPitrReadinessReport({
    now: NOW,
    env: {},
    configFile: {
      exists: false,
      securePermissions: false,
      mode: null,
    },
    restoreEvidence: {
      present: false,
      valid: false,
      isolationVerified: false,
      completedAt: null,
    },
    state: {
      dockerAvailable: true,
      databaseContainer: {
        name: "supabase-db",
        image: "supabase/postgres:15.8.1.085",
      },
      databaseProbeSucceeded: true,
      settings: {
        walLevel: "logical",
        archiveMode: "off",
        archiveTimeoutSeconds: 0,
        archiveCommandConfigured: false,
        archiveLibraryConfigured: false,
      },
      archiver: {
        archivedCount: 0,
        failedCount: 0,
        lastArchivedAt: null,
        lastFailedAt: null,
      },
      wal: {
        bytes: 64 * 1024 * 1024,
        readyCount: 0,
        doneCount: 0,
      },
      walG: {
        available: false,
        configPresent: false,
        configMode: null,
      },
      repository: {
        probeSucceeded: false,
        backupCount: 0,
        latestBackupAt: null,
      },
      disk: {
        totalBytes: 40 * GIB,
        availableBytes: 11 * GIB,
        availablePercent: 27.5,
      },
    },
  });

  assert.equal(report.status, "blocked");
  assert.equal(report.pitrReady, false);
  assert.equal(report.blockers.includes("pitr_not_enabled"), true);
  assert.equal(report.blockers.includes("archive_mode_disabled"), true);
  assert.equal(report.blockers.includes("wal_g_missing"), true);
  assert.equal(
    report.blockers.includes("offsite_repository_unreachable"),
    true,
  );
  assert.equal(
    report.blockers.includes("pitr_restore_rehearsal_missing"),
    true,
  );
  assert.equal(
    report.warnings.includes(
      "database_disk_capacity_below_recommended",
    ),
    true,
  );
});

test("PITR readiness blocks a failed latest archive and queued WAL backlog", () => {
  const state = readyState({
    archiver: {
      archivedCount: 120,
      failedCount: 2,
      lastArchivedAt: "2026-07-27T19:45:00.000Z",
      lastFailedAt: "2026-07-27T19:58:00.000Z",
    },
    wal: {
      bytes: 512 * 1024 * 1024,
      readyCount: 9,
      doneCount: 12,
    },
  });
  const report = buildProductionPitrReadinessReport(
    readyInput({ state }),
  );

  assert.equal(report.status, "blocked");
  assert.equal(
    report.blockers.includes("wal_archive_latest_attempt_failed"),
    true,
  );
  assert.equal(report.blockers.includes("wal_archive_backlog"), true);
});

test("PITR readiness never serializes repository credentials", () => {
  const secret = "never-print-r2-secret-access-key";
  const report = buildProductionPitrReadinessReport(
    readyInput({
      env: {
        FAOLLA_PITR_ENABLED: "true",
        FAOLLA_PITR_OFFSITE_PROVIDER: "cloudflare_r2",
        AWS_ACCESS_KEY_ID: `${secret}-id`,
        AWS_SECRET_ACCESS_KEY: secret,
        WALG_S3_PREFIX: `s3://bucket/${secret}`,
      },
    }),
  );

  assert.equal(JSON.stringify(report).includes(secret), false);
});

test("PITR production inspection reads bounded non-secret state", () => {
  const calls = [];
  const runCommand = (command, args) => {
    calls.push({ command, args });
    if (command !== "docker") return { ok: false, stdout: "" };
    if (args[0] === "ps") {
      return {
        ok: true,
        stdout: `${JSON.stringify({
          Names: "supabase-db",
          Image: "supabase/postgres:15.8.1.085",
        })}\n`,
      };
    }
    if (args.includes("sh") && args.includes("-lc")) {
      return {
        ok: true,
        stdout: [
          "setting.wal_level=logical",
          "setting.archive_mode=on",
          "setting.archive_timeout_seconds=300",
          "setting.archive_command_configured=1",
          "setting.archive_library_configured=0",
          "archiver.archived_count=12",
          "archiver.failed_count=0",
          "archiver.last_archived_epoch=1785182100",
          "archiver.last_failed_epoch=",
          "wal.bytes=67108864",
          "wal.ready_count=0",
          "wal.done_count=4",
          "tool.wal_g=1",
          "tool.wal_g_config=1",
          "tool.wal_g_config_mode=600",
        ].join("\n"),
      };
    }
    if (args.includes("backup-list")) {
      return {
        ok: true,
        stdout: JSON.stringify([
          {
            backup_name: "base_000000010000000000000001",
            start_time: "2026-07-26T20:00:00.000Z",
          },
        ]),
      };
    }
    return { ok: false, stdout: "" };
  };

  const state = inspectProductionPitrState({
    env: {},
    runCommand,
    diskProbe: () => ({
      totalBytes: 100 * GIB,
      availableBytes: 50 * GIB,
      availablePercent: 50,
    }),
  });

  assert.equal(state.databaseProbeSucceeded, true);
  assert.equal(state.settings.archiveMode, "on");
  assert.equal(state.walG.available, true);
  assert.equal(state.repository.probeSucceeded, true);
  assert.equal(state.repository.backupCount, 1);
  assert.equal(
    calls.some((call) => call.args.includes("backup-list")),
    true,
  );
});

test("PITR workflow and package scripts keep enforcement explicit", () => {
  const workflow = readFileSync(
    new URL(
      "../.github/workflows/pitr-readiness.yml",
      import.meta.url,
    ),
    "utf8",
  );
  const packageJson = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  );

  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /enforce_ready:/);
  assert.match(workflow, /check-production-pitr-readiness\.mjs/);
  assert.match(workflow, /--fail-on-blocked/);
  assert.equal(
    packageJson.scripts["check:production-pitr-readiness"],
    "node scripts/check-production-pitr-readiness.mjs",
  );
  assert.match(
    packageJson.scripts["test:operations"],
    /check-production-pitr-readiness\.test\.mjs/,
  );
});
