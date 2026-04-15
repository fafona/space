import assert from "node:assert/strict";
import test from "node:test";
import {
  createPlatformAdminDataBackupEntry,
  getDaysBetweenDateKeys,
  isPlatformAdminAutoBackupDue,
  mergePlatformAdminDataBackupPayloads,
  normalizePlatformAdminDataBackupPayload,
  PLATFORM_ADMIN_DATA_BACKUP_MAX_RECORDS,
  type PlatformAdminDataBackupEntry,
} from "@/lib/platformAdminDataBackup";

function createEntry(id: string, at: string, source: "manual" | "auto", scheduleDateKey: string | null): PlatformAdminDataBackupEntry {
  const entry = createPlatformAdminDataBackupEntry({
    source,
    operator: "平台管理员",
    scheduleDateKey,
    snapshot: {
      platformState: {
        version: 1,
        tenants: [],
        sites: [],
        planTemplates: [],
        industryCategories: [],
        homeLayout: {
          heroTitle: "",
          heroSubtitle: "",
          featuredCategoryIds: [],
          merchantDefaultSortRule: "created_desc",
          sections: [],
        },
        roles: [],
        users: [],
        pageAssets: [],
        publishRecords: [],
        approvals: [],
        alerts: [],
        audits: [],
      },
      merchantSnapshot: null,
      merchantConfigArchive: { audits: [], backups: [] },
      supportInbox: { threads: [] },
      merchantAccounts: [],
    },
  });
  return {
    ...entry,
    id,
    at,
    scheduleDateKey,
  };
}

test("normalizePlatformAdminDataBackupPayload keeps latest 8 backups sorted by time desc", () => {
  const backups = Array.from({ length: 10 }, (_, index) =>
    createEntry(
      `backup-${index + 1}`,
      new Date(Date.UTC(2026, 3, index + 1, 12, 0, 0)).toISOString(),
      "manual",
      null,
    ),
  );

  const normalized = normalizePlatformAdminDataBackupPayload({ backups });
  assert.equal(normalized.backups.length, PLATFORM_ADMIN_DATA_BACKUP_MAX_RECORDS);
  assert.equal(normalized.backups[0]?.id, "backup-10");
  assert.equal(normalized.backups.at(-1)?.id, "backup-3");
});

test("mergePlatformAdminDataBackupPayloads deduplicates by id and keeps latest timestamp", () => {
  const older = createEntry("backup-1", "2026-04-12T00:00:00.000Z", "manual", null);
  const newer = createEntry("backup-1", "2026-04-13T00:00:00.000Z", "auto", "2026-04-13");
  const merged = mergePlatformAdminDataBackupPayloads({ backups: [older] }, { backups: [newer] });
  assert.equal(merged.backups.length, 1);
  assert.equal(merged.backups[0]?.source, "auto");
  assert.equal(merged.backups[0]?.scheduleDateKey, "2026-04-13");
});

test("isPlatformAdminAutoBackupDue follows 3-day Madrid date cycle", () => {
  assert.equal(
    isPlatformAdminAutoBackupDue({ backups: [createEntry("auto-1", "2026-04-12T10:00:00.000Z", "auto", "2026-04-12")] }, "2026-04-14"),
    false,
  );
  assert.equal(
    isPlatformAdminAutoBackupDue({ backups: [createEntry("auto-1", "2026-04-12T10:00:00.000Z", "auto", "2026-04-12")] }, "2026-04-15"),
    true,
  );
  assert.equal(getDaysBetweenDateKeys("2026-04-12", "2026-04-15"), 3);
});
