import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {attendanceOnlineBuildPlan,buildAttendanceOnlineCandidate} from './attendance-online-build.mjs';
import {assertContactWechatBuildEnvironmentKeys} from './contact-wechat-online-build.mjs';
import {loginProtectedEnvironment,loginCandidateOverrides} from './merchant-login-release-policy.mjs';

// Separately approved 2026-10-26. This first publication is compatible LEGACY
// runtime + inactive schema only. It cannot quiesce old workers, flip authority,
// enable mail or claim that atomic admission/delivery has been activated.
export const BOOKING_RELEASE_LANE='booking-runtime-compatibility-only';
export const BOOKING_RELEASE_BASELINE='52f602c0734284d81a19f4cdf9cdbf3766aa1834';
export const BOOKING_APPROVED_APPLICATION='6c5d5df31d06b43929e5ba5e6f3978dd51f1c6b0';
export const BOOKING_SCOPE_FILE='docs/booking-publication-scope-20261026.json';
export const BOOKING_SCOPE=JSON.parse(readFileSync(new URL('../'+BOOKING_SCOPE_FILE,import.meta.url),'utf8'));
export const BOOKING_APPLICATION_FILES=Object.freeze(Object.keys(BOOKING_SCOPE.pins));
export const BOOKING_TOOL_FILES=Object.freeze([
 BOOKING_SCOPE_FILE,'scripts/booking-publication-policy.mjs','scripts/booking-publication-policy.test.mjs',
 'scripts/booking-publication-database.mjs','scripts/booking-publication-database.test.mjs',
 'scripts/booking-publication-compatibility.mjs','scripts/booking-publication-compatibility.test.mjs',
 'scripts/online-traffic-release-policy.mjs','scripts/online-traffic-publication-policy.mjs',
 'scripts/online-traffic-release.mjs','scripts/online-traffic-release.test.mjs',
 'scripts/online-traffic-publication-policy.test.mjs','scripts/online-traffic-retention-integration.test.mjs',
 'scripts/customer-code-release-policy.test.mjs',
]);
const allowed=new Set([...BOOKING_APPLICATION_FILES,...BOOKING_TOOL_FILES]);
const hash=value=>createHash('sha256').update(value).digest('hex');
const fail=code=>{throw Error('booking_publication_'+code);};
if(BOOKING_SCOPE.schemaVersion!==1||BOOKING_SCOPE.baseline!==BOOKING_RELEASE_BASELINE||BOOKING_SCOPE.application!==BOOKING_APPROVED_APPLICATION||BOOKING_APPLICATION_FILES.length!==56
 ||BOOKING_APPLICATION_FILES.some(file=>!/^\.?[A-Za-z0-9_./[\]-]+$/.test(file)||!/^[a-f0-9]{64}$/.test(BOOKING_SCOPE.pins[file])))fail('manifest_invalid');
export const hasBookingReleaseAnchor=files=>Array.isArray(files)&&(files.includes('src/lib/merchantBookingAtomicRuntime.server.ts')||files.includes(BOOKING_SCOPE_FILE));
export function assertBookingReleaseScope(files){
 if(!Array.isArray(files)||new Set(files).size!==files.length||!BOOKING_APPLICATION_FILES.every(file=>files.includes(file))||files.some(file=>!allowed.has(file)))fail('scope_rejected');
}
export function assertBookingReleaseClosure({baseline,files,readBlob}){
 if(baseline!==BOOKING_RELEASE_BASELINE)fail('baseline_invalid');assertBookingReleaseScope(files);
 if(!BOOKING_TOOL_FILES.every(file=>files.includes(file)))fail('tool_closure_missing');
 for(const[file,digest]of Object.entries(BOOKING_SCOPE.pins))if(hash(readBlob(file))!==digest)fail('application_content_rejected');
 return hash(JSON.stringify([...files].sort().map(file=>[file,hash(readBlob(file))])));
}
const bookingKeys=new Set(['MERCHANT_BOOKING_STORAGE_MODE','MERCHANT_BOOKING_NOTIFICATION_WORKER_ENABLED']);
export function bookingProtectedEnvironment(env){return loginProtectedEnvironment(Object.fromEntries(Object.entries(env).filter(([key])=>!bookingKeys.has(key))));}
export function assertBookingCompatibilityEnvironment(env,{allowAbsent=false}={}){
 const mode=env.MERCHANT_BOOKING_STORAGE_MODE,worker=env.MERCHANT_BOOKING_NOTIFICATION_WORKER_ENABLED;
 if(!((allowAbsent&&mode===undefined)||mode==='legacy')||!((allowAbsent&&worker===undefined)||worker==='0'))fail('runtime_must_remain_inactive');
}
export function bookingCandidateOverrides(state,releasedAt){return {...loginCandidateOverrides(state,releasedAt),MERCHANT_BOOKING_STORAGE_MODE:'legacy',MERCHANT_BOOKING_NOTIFICATION_WORKER_ENABLED:'0'};}
export function buildBookingReleaseCandidate(input,build=buildAttendanceOnlineCandidate){
 if(input?.lane!==BOOKING_RELEASE_LANE||input.baseline!==BOOKING_RELEASE_BASELINE)fail('build_scope_invalid');
 attendanceOnlineBuildPlan(input);assertContactWechatBuildEnvironmentKeys(input.environment);assertBookingCompatibilityEnvironment(input.environment);
 return build({directory:input.directory,target:input.target,operation:input.operation});
}
export const BOOKING_FOCUSED_TESTS=Object.freeze([
 ...BOOKING_APPLICATION_FILES.filter(file=>/\.test\.(?:mjs|ts|tsx)$/.test(file)),
 'scripts/booking-publication-policy.test.mjs','scripts/booking-publication-database.test.mjs',
 'scripts/booking-publication-compatibility.test.mjs',
 'src/lib/merchantBusinessBookingPermissions.test.ts','src/lib/merchantBookings.test.ts','src/lib/merchantBookingRules.test.ts',
 'src/app/api/bookings/route.test.ts','src/app/api/bookings/calendar/route.test.ts','scripts/check-booking-persistence.test.mjs',
 'scripts/attendance-online-build.test.mjs','scripts/online-traffic-publication-policy.test.mjs',
 'scripts/customer-code-release-policy.test.mjs',
 'scripts/online-release-retention-policy.test.mjs','scripts/online-release-retention-writer.test.mjs',
].filter((value,index,all)=>all.indexOf(value)===index));
