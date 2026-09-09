// Synthetic hashes only: never read a database or include business payloads.
import { DATABASE_RECOVERY_MIGRATIONS } from "../database-recovery-content-contract.mjs";

export function recoveryContentFixture({ migrated = false, schemaVersion = 2, receipts = false } = {}) {
  const fixture = {
    schemaVersion,
    relations: [
      { name: "public.pages", present: true, rowCount: "3", contentSha256: "2".repeat(64) },
      { name: "public.faolla_redemption_operations", present: false, rowCount: null, contentSha256: null },
      { name: "public.faolla_redemption_checkouts", present: false, rowCount: null, contentSha256: null },
      { name: "public.faolla_schema_migrations", present: true, rowCount: "43", contentSha256: "3".repeat(64) },
    ],
    migrationNames: {
      "202609080044": null,
      "202609080045": null,
      "202609080046": null,
      "202609080047": null,
    },
  };
  if (schemaVersion === 2) fixture.relations.push({
    name: "public.faolla_platform_snapshot_restore_receipts", present: receipts,
    rowCount: receipts ? "1" : null, contentSha256: receipts ? "9".repeat(64) : null,
  });
  if (migrated) {
    for (const index of [1, 2]) {
      Object.assign(fixture.relations[index], {
        present: true, rowCount: "1", contentSha256: String(index + 3).repeat(64),
      });
    }
    fixture.relations[3].rowCount = "47";
    fixture.migrationNames = { ...DATABASE_RECOVERY_MIGRATIONS };
  }
  return fixture;
}
