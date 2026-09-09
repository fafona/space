import type { Metadata } from "next";
import { notFound } from "next/navigation";
import BackupRestoreHarness from "./BackupRestoreHarness";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function BackupRestoreHarnessPage() {
  if (process.env.NODE_ENV !== "development" ||
    process.env.FAOLLA_BACKUP_RESTORE_HARNESS !== "enabled-for-local-browser-tests") notFound();
  return <BackupRestoreHarness />;
}
