import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PLATFORM_ADMIN_DATA_BACKUP_MAX_RECORDS } from "./platformAdminDataBackup";
import { PLATFORM_ADMIN_DATA_BACKUP_SCOPE as scope, withPlatformAdminDataBackupScope } from "./platformAdminDataBackupScope";

test("application snapshot scope explicitly excludes business data, identities and database disaster recovery", () => {
  assert.equal(scope.fullDatabaseBackup, false);
  assert.equal(scope.independentBackupCopy, false);
  assert.equal(scope.databasePointInTimeRestore, false);
  const exclusions = scope.excluded.join(" ");
  for (const term of ["积分", "余额", "库存", "优惠券", "订单", "预约", "密码", "员工", "对象存储",
    "faolla_redemption_operations", "faolla_redemption_checkouts"]) assert.ok(exclusions.includes(term), term);
  assert.ok(scope.included[0].includes("当前浏览器"));
  assert.ok(scope.restoreScopes.user_manage.warning.includes("分步执行"));
  assert.ok(scope.restoreScopes.support_messages.warning.includes("不会恢复商户与客户"));
});

test("schedule disclosure matches retention and visit-triggered interval, without promising midnight execution", () => {
  const implementation = readFileSync(new URL("./platformAdminDataBackup.ts", import.meta.url), "utf8");
  assert.ok(implementation.includes(`getDaysBetweenDateKeys(latestDateKey, currentMadridDateKey) >= ${scope.schedule.minimumIntervalDays}`));
  assert.equal(scope.schedule.maximumRecords, PLATFORM_ADMIN_DATA_BACKUP_MAX_RECORDS);
  assert.equal(scope.schedule.trigger, "authenticated_admin_session_catch_up");
  assert.equal(scope.schedule.timezone, "Europe/Madrid");
  assert.ok(scope.schedule.notice.includes("不是凌晨定时任务"));
});

test("scope metadata is additive and does not alter backup records or restore scope", () => {
  const input = { ok: true, scope: "user_manage", backups: [{ id: "one" }] };
  const output = withPlatformAdminDataBackupScope(input);
  assert.deepEqual(output, { ...input, backupScope: scope });
  assert.equal(output.backups, input.backups);
  assert.equal("backupScope" in input, false);
});

test("UI discloses shared scope in the overview and the explicit preview-confirm dialog", () => {
  const ui = readFileSync(new URL("../app/super-admin/SuperAdminClient.tsx", import.meta.url), "utf8");
  const dialog = readFileSync(new URL("../components/admin/PlatformAdminBackupRestoreDialog.tsx", import.meta.url), "utf8");
  const previewBuilder = readFileSync(new URL("./platformAdminBackupRestorePreview.server.ts", import.meta.url), "utf8");
  assert.match(ui, /PLATFORM_ADMIN_DATA_BACKUP_SCOPE\.included\.map/);
  assert.match(ui, /PLATFORM_ADMIN_DATA_BACKUP_SCOPE\.excluded\.map/);
  for (const restoreScope of ["user_manage", "support_messages"]) {
    assert.ok(ui.includes(`restoreDataBackupAction(backup.id, "${restoreScope}")`));
    assert.ok(ui.includes(`PLATFORM_ADMIN_DATA_BACKUP_SCOPE.restoreScopes.${restoreScope}.label`));
  }
  assert.match(ui, /<PlatformAdminBackupRestoreDialog\s+preview=\{dataBackupRestorePreview\}/);
  assert.match(ui, /onConfirm=\{\(\) => void confirmDataBackupRestoreAction\(\)\}/);
  assert.match(dialog, /PLATFORM_ADMIN_DATA_BACKUP_SCOPE\.restoreScopes\[preview\.scope\]\.label/);
  assert.match(dialog, /\{preview\.warning\}/);
  assert.match(dialog, /preview\.excluded\.map/);
  assert.match(previewBuilder, /PLATFORM_ADMIN_DATA_BACKUP_SCOPE\.restoreScopes\[current\.scope\]\.warning/);
  assert.match(previewBuilder, /excluded: \[\.\.\.PLATFORM_ADMIN_DATA_BACKUP_SCOPE\.excluded\]/);
  const previewStart = ui.indexOf("async function restoreDataBackupAction(");
  const confirmStart = ui.indexOf("async function confirmDataBackupRestoreAction()");
  assert.ok(previewStart >= 0 && confirmStart > previewStart);
  const previewAction = ui.slice(previewStart, confirmStart);
  assert.match(previewAction, /JSON\.stringify\(\{ backupId, scope, action: "preview" \}\)/);
  assert.doesNotMatch(previewAction, /requestPlatformAdminBackupRestoreOnce|action: "restore"/);
  assert.doesNotMatch(ui, /0 点执行/);
});

test("real preview and restore route retains same-origin and super-admin authorization before data access", () => {
  const route = readFileSync(new URL("../app/api/super-admin/data-backups/route.ts", import.meta.url), "utf8");
  assert.match(route, /authorize: isSuperAdminRequestAuthorized/);
  assert.match(route, /createClient: createServerSupabaseServiceClient/);
  assert.match(route, /export const PATCH = handlers\.PATCH/);
  const implementation = readFileSync(new URL("./platformAdminDataBackupRoute.ts", import.meta.url), "utf8");
  const patchStart = implementation.indexOf("async function PATCH(request: Request)");
  assert.ok(patchStart >= 0);
  const patch = implementation.slice(patchStart);
  const originGuard = patch.indexOf("if (!isTrustedSameOriginMutationRequest(request))");
  const authorizationGuard = patch.indexOf("if (!(await isSuperAdminRequestAuthorized(request)))");
  const createClient = patch.indexOf("const supabase = createSupabase()");
  const readBody = patch.indexOf("await request.json()");
  const readBackup = patch.indexOf("loadStoredPlatformAdminDataBackups(");
  assert.ok(originGuard >= 0 && authorizationGuard > originGuard);
  assert.ok(createClient > authorizationGuard && readBody > createClient && readBackup > readBody);
});
