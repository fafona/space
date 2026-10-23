import {createHash} from 'node:crypto';
import {buildAttendanceOnlineCandidate,attendanceOnlineBuildPlan} from './attendance-online-build.mjs';
import {assertContactWechatBuildEnvironmentKeys} from './contact-wechat-online-build.mjs';
import {LOGIN_FOCUSED_TESTS} from './merchant-login-release-policy.mjs';

// Separate, one-change authority approved 2026-10-23. No older lane is widened.
export const GOOGLE_LOGIN_RELEASE_LANE='google-login-account-confirmation-code-only';
export const GOOGLE_LOGIN_RELEASE_BASELINE='518d32cdf8088b285ed174833ac2ed7fe8e38282';
export const GOOGLE_LOGIN_REVIEWED_MAIN='5447e076c66eeda5ef61833f2d2e7ac511041eb2';
export const GOOGLE_LOGIN_APPLICATION_FILES=Object.freeze([
 'src/app/login/page.tsx','src/app/login/googleOAuthSignIn.test.ts','package.json',
]);
export const GOOGLE_LOGIN_INHERITED_TOOLS=Object.freeze([
 'scripts/attendance-staged-tool-repair.test.mjs',
 'scripts/merchant-login-unbuilt-repair-policy.mjs','scripts/merchant-login-unbuilt-repair-policy.test.mjs',
 'scripts/merchant-login-unbuilt-repair.mjs','scripts/merchant-login-unbuilt-repair.test.mjs',
 'scripts/online-unpublished-candidate.test.mjs',
 'scripts/prepare-online-release-tool.mjs','scripts/prepare-online-release-tool.test.mjs',
]);
export const GOOGLE_LOGIN_TOOL_FILES=Object.freeze([
 'scripts/google-login-release-policy.mjs','scripts/google-login-release-policy.test.mjs',
 'scripts/online-traffic-release-policy.mjs','scripts/online-traffic-publication-policy.mjs',
 'scripts/online-traffic-release.mjs','scripts/online-traffic-release.test.mjs',
 'scripts/online-traffic-publication-policy.test.mjs',
 'scripts/customer-code-release-policy.test.mjs','scripts/online-traffic-retention-integration.test.mjs',
 'docs/google-login-release-20261023.md',...GOOGLE_LOGIN_INHERITED_TOOLS,
]);
const allowed=new Set([...GOOGLE_LOGIN_APPLICATION_FILES,...GOOGLE_LOGIN_TOOL_FILES]);
const fail=reason=>{throw Error(`google_login_release_${reason}`);};
const digest=value=>createHash('sha256').update(value).digest('hex');
export const hasGoogleLoginReleaseAnchor=files=>Array.isArray(files)&&files.includes('src/app/login/googleOAuthSignIn.test.ts');
export function assertGoogleLoginReleaseScope(files){
 if(!Array.isArray(files)||!GOOGLE_LOGIN_APPLICATION_FILES.every(file=>files.includes(file))||new Set(files).size!==files.length||files.some(file=>!allowed.has(file)))fail('scope_rejected');
}
export function assertGoogleLoginReleaseClosure({baseline,files,readBlob}){
 if(baseline!==GOOGLE_LOGIN_RELEASE_BASELINE)fail('baseline_invalid');
 assertGoogleLoginReleaseScope(files);
 if(!GOOGLE_LOGIN_TOOL_FILES.every(file=>files.includes(file)))fail('tool_closure_missing');
 // Pin the entire application page and manifest, not just their filenames.
 // These hashes admit only select_account in every display mode, removal of
 // login_hint, and the two additional auth test paths. Dependencies stay fixed.
 for(const [file,expected] of Object.entries({
  'src/app/login/page.tsx':'236bf243bdd850ebae2d6932724a503f61f266ff689fe706b91a031a339a0d93',
  'package.json':'a1842616c525e2f063378920b92d9ea7374bb167e8ce63ded5291a6c003a4ae8',
 }))if(digest(readBlob(file))!==expected)fail('application_content_rejected');
 for(const file of GOOGLE_LOGIN_INHERITED_TOOLS)if(digest(readBlob(file))!==digest(readBlob(file,GOOGLE_LOGIN_REVIEWED_MAIN)))fail('inherited_tool_changed');
 return digest(JSON.stringify([...files].sort().map(file=>[file,digest(readBlob(file))])));
}
export function buildGoogleLoginReleaseCandidate(input,build=buildAttendanceOnlineCandidate){
 if(input?.lane!==GOOGLE_LOGIN_RELEASE_LANE||input.baseline!==GOOGLE_LOGIN_RELEASE_BASELINE)fail('build_scope_invalid');
 attendanceOnlineBuildPlan(input);
 assertContactWechatBuildEnvironmentKeys(input.environment);
 return build({directory:input.directory,target:input.target,operation:input.operation});
}
export const GOOGLE_LOGIN_FOCUSED_TESTS=Object.freeze([...new Set([
 ...LOGIN_FOCUSED_TESTS,'src/app/login/googleOAuthSignIn.test.ts','src/app/login/page.contract.test.ts',
 'src/lib/googleOAuthCallback.test.ts','scripts/google-login-release-policy.test.mjs',
])]);
