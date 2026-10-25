import {createHash} from 'node:crypto';
import {GOOGLE_TRANSITION_APPLICATION_FILES,GOOGLE_TRANSITION_TOOL_FILES,GOOGLE_TRANSITION_FOCUSED_TESTS,
 buildGoogleTransitionReleaseCandidate,GOOGLE_TRANSITION_RELEASE_LANE} from './google-oauth-transition-release-policy.mjs';
export const RECORDS_UI_RELEASE_LANE='attendance-records-google-presentation-code-only';
export const RECORDS_UI_RELEASE_BASELINE='dd85d9fb1d5f571b6951fdc4891066f0ba88ceef';
export const RECORDS_UI_APPLICATION_FILES=Object.freeze([...GOOGLE_TRANSITION_APPLICATION_FILES,
 'src/components/admin/MerchantEnterpriseManager.tsx','src/components/enterprise/MerchantAttendanceRecordsPanel.tsx','src/lib/merchantAttendanceRecordsUi.test.tsx']);
export const RECORDS_UI_TOOL_FILES=Object.freeze([...GOOGLE_TRANSITION_TOOL_FILES,
 'scripts/attendance-records-ui-release-policy.mjs','scripts/attendance-records-ui-release-policy.test.mjs',
 'scripts/check-attendance-records-ui-browser.mjs','scripts/google-transition-unbuilt-close-policy.mjs',
 'scripts/google-transition-unbuilt-close.mjs','scripts/google-transition-unbuilt-close.test.mjs',
 'scripts/prepare-online-release-tool.mjs','scripts/prepare-online-release-tool.test.mjs','scripts/online-unpublished-candidate.test.mjs',
 'docs/attendance-records-google-release-20261025.md']);
const allowed=new Set([...RECORDS_UI_APPLICATION_FILES,...RECORDS_UI_TOOL_FILES]);
const fail=reason=>{throw Error('records_ui_release_'+reason);};
const hash=value=>createHash('sha256').update(value).digest('hex');
export const hasRecordsUiReleaseAnchor=files=>Array.isArray(files)&&files.includes('src/lib/merchantAttendanceRecordsUi.test.tsx');
export function assertRecordsUiReleaseScope(files){
 if(!Array.isArray(files)||new Set(files).size!==files.length||!RECORDS_UI_APPLICATION_FILES.every(f=>files.includes(f))||files.some(f=>!allowed.has(f)))fail('scope_rejected');
}
export function assertRecordsUiReleaseClosure({baseline,files,readBlob}){
 if(baseline!==RECORDS_UI_RELEASE_BASELINE)fail('baseline_invalid');assertRecordsUiReleaseScope(files);
 if(!RECORDS_UI_TOOL_FILES.every(f=>files.includes(f)))fail('tool_closure_missing');
 for(const [f,digest] of Object.entries({
  'src/app/login/page.tsx':'6f69275b72785162375f709d2c7b49b09ca7cad3138cc5d6cf7c5d0f456355c2',
  'src/app/login/googleOAuthSignIn.test.ts':'99d641a76cc4334d3c003c7c07d735e242f0f9f160c2aa23874d938db29efad2',
  'src/app/login/googleOAuthTransition.test.ts':'1d978e854c8780e0ca10e967edb0d5dad312738fa34951d7ccbbe6f10ef6c599',
  'src/components/admin/MerchantEnterpriseManager.tsx':'282a63075363611b6e59d52e831b45836b653e77b749c511ffd41603845c50fe',
  'src/components/enterprise/MerchantAttendanceRecordsPanel.tsx':'1f1bf466402b6e16fe2ceab0ec5dc3b4b9781c46371aedcd35d33e3b76daaede',
  'src/lib/merchantAttendanceRecordsUi.test.tsx':'539dc84b00d32f3ecea6bd747d8dd1c1de2c12bd8fb8c375c679e9babae4b366',
  'scripts/fixtures/google-login-account-confirmation-page-20261023.txt':'236bf243bdd850ebae2d6932724a503f61f266ff689fe706b91a031a339a0d93',
 }))if(hash(readBlob(f))!==digest)fail('application_content_rejected');
 return hash(JSON.stringify([...files].sort().map(f=>[f,hash(readBlob(f))])));
}
export function buildRecordsUiReleaseCandidate(input,build){
 if(input?.lane!==RECORDS_UI_RELEASE_LANE||input.baseline!==RECORDS_UI_RELEASE_BASELINE)fail('build_scope_invalid');
 // Shared mechanics only. The separate exact six-file closure is verified by
 // the controller before this bounded builder. No old lane gains new scope.
 return buildGoogleTransitionReleaseCandidate({...input,lane:GOOGLE_TRANSITION_RELEASE_LANE},build);
}
export const RECORDS_UI_FOCUSED_TESTS=Object.freeze([...new Set([...GOOGLE_TRANSITION_FOCUSED_TESTS,
 'src/lib/merchantAttendanceRecordsUi.test.tsx','scripts/attendance-records-ui-release-policy.test.mjs',
 'scripts/google-transition-unbuilt-close.test.mjs','scripts/prepare-online-release-tool.test.mjs','scripts/online-unpublished-candidate.test.mjs',
 'scripts/online-traffic-retention-integration.test.mjs',
 'scripts/online-release-retention-writer.test.mjs','scripts/online-release-retention-policy.test.mjs'])]);
