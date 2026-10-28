// Pure new proof type. The old immutable readyAt is never renewed or edited.
// A new observation binds that EXACT state, current runtime, local HTTP and a
// genuinely new active-publication window. This grants no execution authority.
import {isDeepStrictEqual} from 'node:util';
import {ACTIVE_BOOKING_INCIDENT as P,assertActiveBookingWindow} from './release-toolchain-active-generation-contract.mjs';
import {canonicalJson,sha256,requireToolchain as need} from './release-toolchain-contracts.mjs';
import {rollingHash} from './online-release-rolling-policy.mjs';
export const ACTIVE_ROLLBACK_STATE_SHA256='12a7590d9de39d10179d0b60d3730c0451c5ad9e2b9a6d22044a77fe0861be3d';
export const ACTIVE_ROLLBACK_ORIGINAL_READINESS_SHA256='cbc46dcc66e29651ee04e4884c47c42161017f0e9db310911c2886b78c65a139';
export const ACTIVE_ROLLBACK_REVALIDATED_KIND='booking-atomic-rollback-revalidated';
const same=(a,b)=>need(isDeepStrictEqual(a,b),'evidence_invalid'),hash=/^[a-f0-9]{64}$/;
const keys=(value,list)=>{need(value!==null&&typeof value==='object'&&!Array.isArray(value),'evidence_invalid');same(Object.keys(value).sort(),[...list].sort());};
function time(value){const ms=Date.parse(value);need(typeof value==='string'&&Number.isFinite(ms)&&new Date(ms).toISOString()===value,'evidence_invalid');return ms;}
export function assertActiveBookingRollbackReadiness(readiness,rollback,evidence){
 keys(readiness,['schemaVersion','kind','candidate','target','stateText','buildEvidenceSha256','runtimeSha256','environmentFileSha256','compatibilitySha256','originalReadinessSha256','window','observedAt','processSha256','http']);
 need(evidence?.schemaVersion===2&&evidence.kind==='booking-active-generation-handoff'&&readiness.schemaVersion===2&&readiness.kind===ACTIVE_ROLLBACK_REVALIDATED_KIND&&readiness.candidate===P.candidate&&readiness.target===P.compatibleRollback&&rollback?.target===P.compatibleRollback,'evidence_invalid');
 const nowMs=time(evidence.completedAt),bounds=assertActiveBookingWindow(evidence.window,{nowMs});same(readiness.window,evidence.window);const observed=time(readiness.observedAt);need(observed>=bounds.startedAtMs&&observed<=nowMs&&observed<bounds.deadlineAtMs,'evidence_stale');
 need(typeof readiness.stateText==='string'&&sha256(readiness.stateText)===ACTIVE_ROLLBACK_STATE_SHA256&&readiness.originalReadinessSha256===ACTIVE_ROLLBACK_ORIGINAL_READINESS_SHA256,'evidence_invalid');
 const state=JSON.parse(readiness.stateText);keys(state,['target','name','directory','port','status','readyAt','storageMode','candidate']);
 const location=value=>Object.fromEntries(['target','name','directory','port'].map(k=>[k,value[k]]));same(location(state),location(rollback));
 same(location(state),{target:P.compatibleRollback,name:'merchant-space-online-'+P.compatibleRollback.slice(0,12),directory:'/www/wwwroot/merchant-space.web-releases/'+P.compatibleRollback.slice(0,12)+'-online',port:3110});
 need(state.status==='booking-rollback-ready'&&state.storageMode==='atomic-v2'&&state.candidate===P.candidate&&time(state.readyAt)===Date.parse('2026-10-27T19:50:48.981Z'),'evidence_invalid');
 need(['buildEvidenceSha256','runtimeSha256','environmentFileSha256','compatibilitySha256','processSha256'].every(key=>typeof readiness[key]==='string'&&hash.test(readiness[key]))&&readiness.compatibilitySha256===evidence.compatibilitySha256&&readiness.processSha256===sha256(canonicalJson(rollback.process)),'evidence_invalid');
 same(readiness.http,{origin:'http://127.0.0.1:3110',status:200,ok:true,buildId:P.compatibleRollback});same(rollingHash(readiness),evidence.rollbackReadinessSha256);return state;
}
