import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
const read = file => readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const manager = read('src/components/admin/MerchantEnterpriseManager.tsx');
test('overview emits admission only after validated actor and saved entitlement; no client rollout guess', () => {
  const overview = read('src/app/api/merchant-enterprise/overview/route-handler.ts');
  assert.match(overview,/const site = await requireMerchantEnterpriseEntitlement\(siteId\)/);
  assert.match(overview,/attendanceEnabled: attendanceModuleEnabled\(site\)\s*&& process\.env\.FAOLLA_ATTENDANCE_SELF_ENABLED === "1"\s*&& process\.env\.FAOLLA_ATTENDANCE_ADMIN_ENABLED === "1"/);
  assert(overview.indexOf('const actor = await resolveMerchantEnterpriseActor') < overview.indexOf('attendanceEnabled:'));
  assert.match(manager,/useState<AttendanceUiAdmission \| null>\(null\)/);
  assert.match(manager,/attendanceUiAdmissionCurrent\(attendanceAdmission, attendanceAdmissionScope\)/);
  assert.match(manager,/JSON\.stringify\(\[siteId, accessToken, actorAuthorizationFingerprint, currentAuthUserId\]\)/);
  assert.match(manager,/enabled: payload\.attendanceEnabled === true/);
  assert.doesNotMatch(manager,/NEXT_PUBLIC_FAOLLA_ATTENDANCE_ROLLOUT_SITE_IDS|FAOLLA_ATTENDANCE_ROLLOUT_SITE_IDS/);
});
test('all attendance navigation and overview launchers are behind authoritative admission and actor permission', () => {
  assert.match(manager,/!requestedView\.startsWith\("attendance"\) \|\| attendanceUiAvailable/);
  assert.equal((manager.match(/!item\.key\.startsWith\("attendance"\) \|\| attendanceUiAvailable/g) ?? []).length, 2);
  const start = manager.indexOf('{attendanceUiAvailable ? <>');
  const end = manager.indexOf('</> : null}', start);
  assert(start > 0 && end > start);
  for (const name of ['MerchantAttendanceScopePanel', 'MerchantAttendanceRecordsPanel', 'MerchantAttendanceAdminPanel',
    'MerchantAttendanceSelfPanel', 'MerchantAttendanceRemindersLauncher', 'MerchantAttendanceManagementDelegatedLauncher',
    'MerchantAttendancePeriodDelegationLauncher', 'MerchantAttendanceCorrectionDelegationLauncher',
    'MerchantAttendanceOperationalRulesRecoveryLink', 'MerchantAttendanceOperationalConsumerActivationRecoveryLink']) {
    assert(manager.slice(start, end).includes('<' + name), name);
  }
  assert.match(manager,/can\(actor, MERCHANT_ENTERPRISE_VIEW_PERMISSIONS\[requestedView\]\)/);
  assert.match(manager,/can\(actor, "attendance\.records\.view"\)/);
});
test('new account-status path and grants are not activated globally; old saved permissions and pending recovery remain', () => {
  assert.match(manager,/accountSuspensionRequested && attendanceUiAvailable/);
  assert.match(manager,/return accountSuspensionEnabled \|\| client\.hasLeaveRisk\(\) \? client : null/);
  assert.match(manager,/attendanceUiAvailable \|\| !permission\.key\.startsWith\("attendance\."\)/);
  assert.match(manager,/!permission\.key\.startsWith\("attendance\."\) \|\| grantable\.has\(permission\.key\) \|\| selected\.has\(permission\.key\)/);
  const store = read('src/lib/merchantEnterpriseStore.server.ts');
  assert.match(store,/FAOLLA_ATTENDANCE_ACCOUNT_SUSPENSION_ENABLED === "1"\s*&& attendanceRolloutSiteEnabled\(siteId\)/);
});
