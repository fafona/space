import assert from "node:assert/strict";
import test from "node:test";

import {
  runProductionBackupRecoveryCheck,
  validatePlatformAdminBackupRows,
} from "./check-production-backup-recovery.mjs";

const NOW = new Date("2026-07-27T12:00:00.000Z");

function createSnapshot() {
  return {
    platformState: {
      version: 1,
      tenants: [],
      sites: [{ id: "site-1" }],
      planTemplates: [],
      industryCategories: [],
      roles: [],
      users: [{ id: "user-1" }],
      pageAssets: [],
      publishRecords: [],
      approvals: [],
      alerts: [],
      audits: [],
    },
    merchantSnapshot: {
      revision: "snapshot-1",
      snapshot: [{ merchantId: "10000000" }],
      defaultSortRule: "created_desc",
      merchantConfigHistoryBySiteId: {},
    },
    merchantConfigArchive: {
      audits: [],
      backups: [{ id: "config-1" }],
    },
    supportInbox: {
      threads: [{ id: "thread-1", messages: [] }],
    },
    merchantAccounts: [{ merchantId: "10000000" }],
  };
}

function createEntry(overrides = {}) {
  return {
    id: "backup-1",
    at: "2026-07-27T06:00:00.000Z",
    source: "auto",
    snapshot: createSnapshot(),
    ...overrides,
  };
}

function createRow(slug, entries = [createEntry()]) {
  return {
    slug,
    updated_at: "2026-07-27T06:00:00.000Z",
    blocks: [
      {
        id: "__platform_admin_data_backup__",
        type: "common",
        props: {
          isPlatformAdminDataBackup: true,
          version: 1,
          payload: { backups: entries },
        },
      },
    ],
  };
}

const PRIMARY = "__platform_admin_data_backup__";
const SECONDARY = "__platform_admin_data_backup_backup__";

test("backup recovery rehearsal validates both copies and both supported scopes", () => {
  const report = validatePlatformAdminBackupRows(
    [createRow(PRIMARY), createRow(SECONDARY)],
    { now: NOW },
  );

  assert.equal(report.status, "healthy");
  assert.equal(report.redundantCopies, 2);
  assert.equal(report.latestBackupAgeHours, 6);
  assert.deepEqual(report.restoreScopesValidated, [
    "user_manage",
    "support_messages",
  ]);
  assert.equal(report.snapshotCounts.sites, 1);
  assert.equal(report.fullBusinessDatabaseCovered, false);
  assert.equal(report.coverage, "platform_admin_only");
});

test("backup recovery rehearsal reports a missing redundant copy without rejecting a valid backup", () => {
  const report = validatePlatformAdminBackupRows([createRow(PRIMARY)], {
    now: NOW,
  });

  assert.equal(report.status, "degraded");
  assert.deepEqual(report.warnings, ["latest_backup_not_redundant"]);
  assert.equal(report.redundantCopies, 1);
});

test("backup recovery rehearsal fails a stale latest backup", () => {
  const staleEntry = createEntry({ at: "2026-07-20T00:00:00.000Z" });
  const report = validatePlatformAdminBackupRows(
    [createRow(PRIMARY, [staleEntry]), createRow(SECONDARY, [staleEntry])],
    { now: NOW, maximumAgeHours: 96 },
  );

  assert.equal(report.status, "critical");
  assert.equal(report.warnings.includes("latest_backup_too_old"), true);
});

test("backup recovery rehearsal rejects malformed snapshots", () => {
  const malformed = createEntry({
    snapshot: {
      platformState: { sites: [] },
      merchantConfigArchive: {},
      supportInbox: {},
      merchantAccounts: [],
    },
  });
  const report = validatePlatformAdminBackupRows(
    [createRow(PRIMARY, [malformed])],
    { now: NOW },
  );

  assert.equal(report.status, "critical");
  assert.equal(report.error, "no_valid_platform_admin_backup");
});

test("production backup recovery read failure is bounded and does not expose credentials", async () => {
  const report = await runProductionBackupRecoveryCheck({
    supabaseUrl: "https://project.supabase.co",
    serviceRoleKey: "secret-service-key",
    requestAttempts: 1,
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          code: "PGRST301",
          message: "secret-service-key must not be reported",
        }),
        {
          status: 401,
          headers: { "content-type": "application/json" },
        },
      ),
  });
  const serialized = JSON.stringify(report);

  assert.equal(report.status, "critical");
  assert.equal(report.error, "platform_admin_backup_read_failed");
  assert.equal(serialized.includes("secret-service-key"), false);
});
