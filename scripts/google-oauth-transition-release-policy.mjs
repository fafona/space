import {createHash} from 'node:crypto';
import http from 'node:http';
import {buildAttendanceOnlineCandidate,attendanceOnlineBuildPlan} from './attendance-online-build.mjs';
import {assertContactWechatBuildEnvironmentKeys} from './contact-wechat-online-build.mjs';
import {SCOPE_NAV_FOCUSED_TESTS} from './attendance-scope-navigation-release-policy.mjs';

// Independent, presentation-only authority approved 2026-10-25.
export const GOOGLE_TRANSITION_RELEASE_LANE='google-oauth-transition-code-only';
export const GOOGLE_TRANSITION_RELEASE_BASELINE='dd85d9fb1d5f571b6951fdc4891066f0ba88ceef';
export const GOOGLE_TRANSITION_APPLICATION_FILES=Object.freeze([
 'src/app/login/page.tsx','src/app/login/googleOAuthSignIn.test.ts','src/app/login/googleOAuthTransition.test.ts',
]);
export const GOOGLE_TRANSITION_TOOL_FILES=Object.freeze([
 'scripts/google-oauth-transition-release-policy.mjs','scripts/google-oauth-transition-release-policy.test.mjs',
 'scripts/online-traffic-release-policy.mjs','scripts/online-traffic-publication-policy.mjs',
 'scripts/online-traffic-release.mjs','scripts/online-traffic-release.test.mjs',
 'scripts/online-traffic-publication-policy.test.mjs','scripts/customer-code-release-policy.test.mjs',
 'scripts/online-traffic-retention-integration.test.mjs','scripts/google-login-release-policy.test.mjs',
 'scripts/attendance-scope-navigation-release-policy.test.mjs',
 'scripts/fixtures/google-login-account-confirmation-page-20261023.txt',
 'docs/google-oauth-transition-release-20261025.md',
]);
const allowed=new Set([...GOOGLE_TRANSITION_APPLICATION_FILES,...GOOGLE_TRANSITION_TOOL_FILES]);
const fail=reason=>{throw Error(`google_transition_release_${reason}`);};
const digest=value=>createHash('sha256').update(value).digest('hex');
export const hasGoogleTransitionReleaseAnchor=files=>Array.isArray(files)&&files.includes('src/app/login/googleOAuthTransition.test.ts');
export function assertGoogleTransitionReleaseScope(files){
 if(!Array.isArray(files)||!GOOGLE_TRANSITION_APPLICATION_FILES.every(file=>files.includes(file))||new Set(files).size!==files.length||files.some(file=>!allowed.has(file)))fail('scope_rejected');
}
export function assertGoogleTransitionReleaseClosure({baseline,files,readBlob}){
 if(baseline!==GOOGLE_TRANSITION_RELEASE_BASELINE)fail('baseline_invalid');
 assertGoogleTransitionReleaseScope(files);
 if(!GOOGLE_TRANSITION_TOOL_FILES.every(file=>files.includes(file)))fail('tool_closure_missing');
 for(const [file,expected] of Object.entries({
  'src/app/login/page.tsx':'6f69275b72785162375f709d2c7b49b09ca7cad3138cc5d6cf7c5d0f456355c2',
  'src/app/login/googleOAuthSignIn.test.ts':'99d641a76cc4334d3c003c7c07d735e242f0f9f160c2aa23874d938db29efad2',
  'src/app/login/googleOAuthTransition.test.ts':'1d978e854c8780e0ca10e967edb0d5dad312738fa34951d7ccbbe6f10ef6c599',
  'scripts/fixtures/google-login-account-confirmation-page-20261023.txt':'236bf243bdd850ebae2d6932724a503f61f266ff689fe706b91a031a339a0d93',
 }))if(digest(readBlob(file))!==expected)fail('application_content_rejected');
 return digest(JSON.stringify([...files].sort().map(file=>[file,digest(readBlob(file))])));
}
export function buildGoogleTransitionReleaseCandidate(input,build=buildAttendanceOnlineCandidate){
 if(input?.lane!==GOOGLE_TRANSITION_RELEASE_LANE||input.baseline!==GOOGLE_TRANSITION_RELEASE_BASELINE)fail('build_scope_invalid');
 attendanceOnlineBuildPlan(input);
 assertContactWechatBuildEnvironmentKeys(input.environment);
 return build({directory:input.directory,target:input.target,operation:input.operation});
}
export function assertGoogleTransitionFirstPaint(html){
 if(typeof html!=='string'||!/<main\b[^>]*\bclass="[^"]*\bfaolla-loading-progress-screen\b/.test(html)||/<input\b[^>]*\bname=["']merchant-login-(?:account|password)["']/i.test(html))fail('first_paint_invalid');
}
export const GOOGLE_TRANSITION_PROBE_LIMITS=Object.freeze({milliseconds:20000,bodyBytes:2*1024**2});
// One fixed, unauthenticated loopback GET. Never follows a redirect into live.
// Native HTTP preserves the launch Host and nginx's HTTPS-forwarding metadata.
export async function readGoogleTransitionCallbackHtml(port,{signal}={}){
 if(!Number.isInteger(port)||port<1||port>65535)fail('probe_port_invalid');
 return new Promise((resolve,reject)=>{
  let settled=false,timer,response;
  const finish=(error,value)=>{
   if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);
   if(error){response?.destroy();request.destroy();reject(error);}else resolve(value);
  };
  const abort=()=>finish(Error('google_transition_probe_aborted'));
  const request=http.request({hostname:'127.0.0.1',port,path:'/login?oauth=google&accountType=merchant',method:'GET',agent:false,
   headers:{Host:'launch.faolla.com',Connection:'close','X-Forwarded-Proto':'https'},maxHeaderSize:16384},incoming=>{
   response=incoming;let size=0;const chunks=[];
   if(incoming.statusCode!==200||!/^text\/html(?:;|$)/i.test(incoming.headers['content-type']??''))return finish(Error('google_transition_probe_response_invalid'));
   incoming.on('data',chunk=>{size+=chunk.length;if(size>GOOGLE_TRANSITION_PROBE_LIMITS.bodyBytes)finish(Error('google_transition_probe_body_limit'));else chunks.push(chunk);});
   incoming.on('error',()=>finish(Error('google_transition_probe_response_failed')));
   incoming.on('aborted',()=>finish(Error('google_transition_probe_response_failed')));
   incoming.on('end',()=>{if(!settled)finish(null,Buffer.concat(chunks).toString('utf8'));});
  });
  request.on('error',()=>finish(Error('google_transition_probe_request_failed')));
  timer=setTimeout(()=>finish(Error('google_transition_probe_timeout')),GOOGLE_TRANSITION_PROBE_LIMITS.milliseconds);
  signal?.addEventListener('abort',abort,{once:true});
  if(signal?.aborted)abort();else request.end();
 });
}
export const GOOGLE_TRANSITION_FOCUSED_TESTS=Object.freeze([...new Set([
 ...SCOPE_NAV_FOCUSED_TESTS,'src/app/login/googleOAuthTransition.test.ts',
 'scripts/google-oauth-transition-release-policy.test.mjs',
])]);
