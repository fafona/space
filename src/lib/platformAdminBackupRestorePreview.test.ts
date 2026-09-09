import assert from "node:assert/strict";
import test from "node:test";
import { normalizePlatformState } from "@/data/platformControlStore";
import { createPlatformAdminDataBackupEntry } from "./platformAdminDataBackup";
import { buildPlatformAdminBackupRestorePreview, matchesPlatformAdminBackupRestorePreviewToken,
  type PlatformAdminBackupRestoreCurrent } from "./platformAdminBackupRestorePreview.server";

function fixture() {
  return createPlatformAdminDataBackupEntry({ source: "manual", operator: "Synthetic", snapshot: {
    platformState: normalizePlatformState({}), merchantSnapshot: null,
    merchantConfigArchive: { backups: [], audits: [] }, supportInbox: { threads: [] }, merchantAccounts: [],
  } });
}
const current: PlatformAdminBackupRestoreCurrent = { scope: "support_messages", supportInbox: { threads: [{
  merchantId: "10000000", siteId: "synthetic", merchantName: "Synthetic", merchantEmail: "private@example.invalid",
  updatedAt: "2026-09-08T00:00:00.000Z", messages: [{ id: "message", sender: "merchant", text: "PRIVATE-MESSAGE",
    createdAt: "2026-09-08T00:00:00.000Z" }],
}] } };

test("empty support restore previews counts, requires consent and exposes no message content", () => {
  const preview = buildPlatformAdminBackupRestorePreview(fixture(), current);
  assert.equal(preview.requiresEmptyConfirmation, true);
  assert.deepEqual(preview.emptyKeys, ["support_threads", "support_messages"]);
  assert.deepEqual(preview.counts.map(({ current, target }) => [current, target]), [[1, 0], [1, 0]]);
  assert.match(preview.confirmationToken, /^v1\.[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(preview), /PRIVATE-MESSAGE|private@example/);
  assert.ok(preview.excluded.some((item) => item.includes("密码")));
});

test("token binds exact target content and current content even if counts are unchanged", () => {
  const target = fixture(); target.snapshot.supportInbox = structuredClone(current.supportInbox);
  const initial = buildPlatformAdminBackupRestorePreview(target, current);
  assert.equal(initial.requiresEmptyConfirmation, false);
  const changedCurrent = structuredClone(current);
  changedCurrent.supportInbox.threads[0].messages[0].text = "changed";
  const observed = buildPlatformAdminBackupRestorePreview(target, changedCurrent);
  assert.deepEqual(initial.counts, observed.counts);
  assert.notEqual(initial.confirmationToken, observed.confirmationToken);
  const changedTarget = structuredClone(target);
  changedTarget.snapshot.supportInbox.threads[0].messages[0].text = "changed target";
  assert.notEqual(initial.confirmationToken, buildPlatformAdminBackupRestorePreview(changedTarget, current).confirmationToken);
});

test("token binds backup identity, scope, configuration and browser payload", () => {
  const target = fixture(); const initial = buildPlatformAdminBackupRestorePreview(target, current);
  for (const mutate of [
    (copy: typeof target) => { copy.id += "-other"; },
    (copy: typeof target) => { copy.snapshot.platformState.homeLayout.heroTitle = "changed"; },
    (copy: typeof target) => { copy.summary = "new description"; },
  ]) {
    const copy = structuredClone(target); mutate(copy);
    assert.notEqual(initial.confirmationToken, buildPlatformAdminBackupRestorePreview(copy, current).confirmationToken);
  }
  const user = buildPlatformAdminBackupRestorePreview(target, {
    scope: "user_manage", merchantSnapshot: null, merchantConfigArchive: { backups: [], audits: [] },
  });
  assert.notEqual(user.confirmationToken, initial.confirmationToken);
  assert.ok(user.counts.filter((item) => item.source === "browser").every((item) => item.current === null));
  assert.match(user.warning, /不是数据库锁/);
});

test("JSON key order does not invalidate an unchanged preview", () => {
  const target = fixture();
  const reordered = Object.fromEntries(Object.entries(target).reverse()) as typeof target;
  assert.equal(buildPlatformAdminBackupRestorePreview(target, current).confirmationToken,
    buildPlatformAdminBackupRestorePreview(reordered, current).confirmationToken);
});

test("missing or malformed content tokens are never accepted", () => {
  const preview = buildPlatformAdminBackupRestorePreview(fixture(), current);
  for (const token of [null, undefined, true, 1, {}, "", "v1.x", preview.confirmationToken.toUpperCase(),
    ` ${preview.confirmationToken}`, `${preview.confirmationToken}\n`]) {
    assert.equal(matchesPlatformAdminBackupRestorePreviewToken(token, preview), false);
  }
  assert.equal(matchesPlatformAdminBackupRestorePreviewToken(preview.confirmationToken, preview), true);
});
