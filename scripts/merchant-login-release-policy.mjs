import {createHash} from 'node:crypto';
import {buildAttendanceOnlineCandidate,attendanceOnlineBuildPlan} from './attendance-online-build.mjs';
import {assertContactWechatBuildEnvironmentKeys} from './contact-wechat-online-build.mjs';
export {backupProtectedEnvironment as loginProtectedEnvironment,assertBackupEnvironment as assertLoginEnvironment,backupCandidateOverrides as loginCandidateOverrides,backupCandidateEnvironmentText as loginCandidateEnvironmentText} from './super-admin-backup-release-policy.mjs';

// Separately approved login repair. No older lane gains authentication scope.
export const LOGIN_RELEASE_LANE='merchant-login-recovery-code-only';
export const LOGIN_RELEASE_BASELINE='6d77f3dfb61d1b694cc807c17d14f334cfec62f0';
export const LOGIN_APPLICATION_FILES=Object.freeze([
 'src/app/admin/AdminClient.tsx','src/app/admin/AdminClient.contract.test.ts',
 'src/app/api/auth/merchant-session/route.ts','src/app/api/auth/merchant-session/route.test.ts',
 'src/lib/authSessionRecovery.ts','src/lib/authSessionRecovery.test.ts',
]);
export const LOGIN_TOOL_FILES=Object.freeze([
 'scripts/merchant-login-release-policy.mjs','scripts/merchant-login-release-policy.test.mjs',
 'scripts/merchant-login-release-probe.mjs','scripts/merchant-login-release-probe.test.mjs',
 'scripts/online-traffic-release-policy.mjs','scripts/online-traffic-publication-policy.mjs',
 'scripts/online-traffic-release.mjs','scripts/online-traffic-release.test.mjs',
 'scripts/online-traffic-publication-policy.test.mjs','scripts/customer-code-release-policy.test.mjs',
 'scripts/online-traffic-retention-integration.test.mjs','docs/merchant-login-release-20261018.md',
]);
const allowed=new Set([...LOGIN_APPLICATION_FILES,...LOGIN_TOOL_FILES]);
const fail=reason=>{throw Error(`merchant_login_release_${reason}`);};
export const hasLoginReleaseAnchor=files=>Array.isArray(files)&&files.includes('src/lib/authSessionRecovery.ts');
export function assertLoginReleaseScope(files){
 if(!Array.isArray(files)||!LOGIN_APPLICATION_FILES.every(file=>files.includes(file))||new Set(files).size!==files.length||files.some(file=>!allowed.has(file)))fail('scope_rejected');
}
export function assertLoginReleaseClosure({baseline,files,readBlob}){
 if(baseline!==LOGIN_RELEASE_BASELINE)fail('baseline_invalid');
 assertLoginReleaseScope(files);
 if(!LOGIN_TOOL_FILES.every(file=>files.includes(file)))fail('tool_closure_missing');
 return createHash('sha256').update(JSON.stringify([...files].sort().map(file=>[file,createHash('sha256').update(readBlob(file)).digest('hex')]))).digest('hex');
}
export function buildLoginReleaseCandidate(input,build=buildAttendanceOnlineCandidate){
 if(input?.lane!==LOGIN_RELEASE_LANE||input.baseline!==LOGIN_RELEASE_BASELINE)fail('build_scope_invalid');
 attendanceOnlineBuildPlan(input);
 assertContactWechatBuildEnvironmentKeys(input.environment);
 return build({directory:input.directory,target:input.target,operation:input.operation});
}
export const LOGIN_FOCUSED_TESTS=Object.freeze([
 'src/lib/authSessionRecovery.test.ts','src/lib/browserAuthStorage.test.ts',
 'src/app/api/auth/merchant-session/route.test.ts','src/app/admin/AdminClient.contract.test.ts',
 'src/lib/merchantAuthSession.test.ts','src/lib/canonicalPortalRequest.test.ts',
 'src/lib/frontendAuthBridge.test.ts','src/lib/accountSwitching.test.ts','src/lib/adminAutoReload.test.ts',
 'src/lib/serverMerchantSession.test.ts','src/lib/ordinaryAccountAuthorization.server.test.ts',
 'src/lib/faollaEntry.test.ts','src/lib/merchantBusinessCardWebsiteRoute.test.ts',
 'scripts/merchant-login-release-policy.test.mjs','scripts/merchant-login-release-probe.test.mjs',
 'scripts/attendance-online-build.test.mjs','scripts/online-traffic-publication-policy.test.mjs',
 'scripts/online-traffic-retention-integration.test.mjs',
]);
