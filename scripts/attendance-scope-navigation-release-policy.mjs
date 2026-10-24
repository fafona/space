import {createHash} from 'node:crypto';
import {buildAttendanceOnlineCandidate,attendanceOnlineBuildPlan} from './attendance-online-build.mjs';
import {assertContactWechatBuildEnvironmentKeys} from './contact-wechat-online-build.mjs';
import {GOOGLE_LOGIN_FOCUSED_TESTS} from './google-login-release-policy.mjs';

// Separately approved pristine-scope UI repair. No older lane gains scope.
export const SCOPE_NAV_RELEASE_LANE='attendance-scope-navigation-code-only';
export const SCOPE_NAV_RELEASE_BASELINE='f97c7292a05a9233b0b7d5495e448d7c1c610d07';
export const SCOPE_NAV_APPLICATION_FILES=Object.freeze([
 'src/components/admin/MerchantEnterpriseManager.tsx',
 'src/components/enterprise/MerchantAttendanceScopePanel.tsx',
 'src/lib/merchantAttendanceScopeNavigation.test.tsx',
]);
export const SCOPE_NAV_TOOL_FILES=Object.freeze([
 'scripts/attendance-scope-navigation-release-policy.mjs','scripts/attendance-scope-navigation-release-policy.test.mjs',
 'scripts/online-traffic-release-policy.mjs','scripts/online-traffic-publication-policy.mjs',
 'scripts/online-traffic-release.mjs','scripts/online-traffic-release.test.mjs',
 'scripts/online-traffic-publication-policy.test.mjs','scripts/customer-code-release-policy.test.mjs',
 'scripts/online-traffic-retention-integration.test.mjs','scripts/google-login-release-policy.test.mjs',
 'docs/attendance-scope-navigation-release-20261024.md',
]);
const allowed=new Set([...SCOPE_NAV_APPLICATION_FILES,...SCOPE_NAV_TOOL_FILES]);
const fail=reason=>{throw Error(`scope_navigation_release_${reason}`);};
const digest=value=>createHash('sha256').update(value).digest('hex');
export const hasScopeNavigationReleaseAnchor=files=>Array.isArray(files)&&files.includes('src/lib/merchantAttendanceScopeNavigation.test.tsx');
export function assertScopeNavigationReleaseScope(files){
 if(!Array.isArray(files)||!SCOPE_NAV_APPLICATION_FILES.every(file=>files.includes(file))||new Set(files).size!==files.length||files.some(file=>!allowed.has(file)))fail('scope_rejected');
}
export function assertScopeNavigationReleaseClosure({baseline,files,readBlob}){
 if(baseline!==SCOPE_NAV_RELEASE_BASELINE)fail('baseline_invalid');
 assertScopeNavigationReleaseScope(files);
 if(!SCOPE_NAV_TOOL_FILES.every(file=>files.includes(file)))fail('tool_closure_missing');
 // Entire application files are pinned to the reviewed three-file UI repair,
 // not just filenames. No data writer, permission, auth or API change fits.
 for(const [file,expected] of Object.entries({
  'src/components/admin/MerchantEnterpriseManager.tsx':'580d35bd16fe169617055cdb7b4f43baecac955e2dfd3e8f091b7201240b3324',
  'src/components/enterprise/MerchantAttendanceScopePanel.tsx':'18d150d46fb7c89f2742599fbac24eb873a0a63b494cd4476a47663648fb76ef',
  'src/lib/merchantAttendanceScopeNavigation.test.tsx':'b31f728f12b7dc8e01aa12a7d22e8fdb39a411bb95896d14105e460f0af97b33',
 }))if(digest(readBlob(file))!==expected)fail('application_content_rejected');
 return digest(JSON.stringify([...files].sort().map(file=>[file,digest(readBlob(file))])));
}
export function buildScopeNavigationReleaseCandidate(input,build=buildAttendanceOnlineCandidate){
 if(input?.lane!==SCOPE_NAV_RELEASE_LANE||input.baseline!==SCOPE_NAV_RELEASE_BASELINE)fail('build_scope_invalid');
 attendanceOnlineBuildPlan(input);
 assertContactWechatBuildEnvironmentKeys(input.environment);
 return build({directory:input.directory,target:input.target,operation:input.operation});
}
export const SCOPE_NAV_FOCUSED_TESTS=Object.freeze([...new Set([
 ...GOOGLE_LOGIN_FOCUSED_TESTS,'src/lib/merchantAttendanceScopeNavigation.test.tsx',
 'src/lib/merchantAttendanceManagementClient.test.ts','src/lib/merchantAttendanceScope.test.ts',
 'src/lib/merchantAttendanceManagement.test.ts','src/app/api/merchant-enterprise/attendance/scopes/route.test.ts',
 'src/lib/merchantAttendanceCorrectionDelegationUi.test.tsx',
 'scripts/merchant-attendance-ui-contract.test.mjs','scripts/merchant-attendance-rollout-ui-contract.test.mjs',
 'scripts/merchant-enterprise-ui-contract.test.mjs','scripts/attendance-scope-navigation-release-policy.test.mjs',
])]);
