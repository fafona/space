import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

// ONE explicitly authorized retry of the confirmed, stopped launch. The entire
// consumed launch and both older recovery audits remain immutable evidence.
export const STARTUP_REPAIR = Object.freeze({
  operationId:"78124069-9a5c-4eb5-aaaf-fe80ef1db2b1",
  previousTargetSha:"dd05aa7ba1289d186a7b29a09e3c570b72ce62c7",
  expectedOldSha:"a06a5921e2fad5797e58304b828dfcf16b7ec43b",
  stateDigest:"bc0bad0e702c17a544cbbffc8e16682b839abecf73b001d25971bc8dfdecce73",
  revision:17,createdAt:1789580413188,bootId:"e6531ec9-db4a-4216-b87a-7cc858197eaa",
  failedRunId:"35165126333",backupRunId:"35163641695",readinessRunId:"35165044304",
  appDir:"/www/wwwroot/merchant-space",appName:"merchant-space",appPort:3000,
  release:"/www/wwwroot/merchant-space.releases/dd05aa7ba128-20260917000706",
  stableRelease:"/www/wwwroot/merchant-space.releases/a06a5921e2fa-20260916054114",
});
const P=STARTUP_REPAIR,SHA=/^[a-f0-9]{40}$/,HASH=/^[a-f0-9]{64}$/,ID=/^[1-9][0-9]{0,15}$/;
const LAUNCH=["candidate","resumed","launchDisk","launchJournal","finalDump"];
const FIXED=["version","operationId","expectedOldSha","appDir","appName","appPort","bootId","createdAt","tokenHash","publicSupabaseUrl","runtime","database","recovery","daemonRepair"];
const AUDIT=["version","predecessor","targetSha","repairedAt","runId","mainCIrunId","sourceDigest","historyDigest","historyCheckedAt","migrationDigest"];
// Explicit completion of the partially applied signed operation, not a retry of
// its consumed authority. Historical time applies ONLY to archived validation;
// fresh host checks and the new absolute maintenance lease use the real clock.
export const STARTUP_COMPLETION = Object.freeze({
  failedRunId:"35174658032",sourceSha:"cf0515b58e8c7998e57e2725b83c5ae7ea8333e8",
  authorityDigest:"f2548f943f760b00177f47041d26ec783e9b6c412deec083e0faa4ec51d67583",
  historicalAt:Date.parse("2026-09-17T02:33:54.420Z"),
  authorizedAfter:Date.parse("2026-09-17T05:35:00Z"),
  expiresAt:Date.parse("2026-09-17T17:40:13.188Z"),
});
const fail=()=>{throw Error("maintenance_startup_repair_invalid");};
const hash=v=>createHash("sha256").update(JSON.stringify(v)).digest("hex");
const exact=(v,keys)=>v&&!Array.isArray(v)&&Object.keys(v).sort().join()===[...keys].sort().join();
const time=n=>Number.isSafeInteger(n)&&n>=0&&!Object.is(n,-0);
export function validateStartupRepairPredecessor(state,clock){
  if(hash(state)!==P.stateDigest||state.version!==3||state.phase!=="failed-held"||state.revision!==P.revision||
    state.operationId!==P.operationId||state.targetSha!==P.previousTargetSha||state.expectedOldSha!==P.expectedOldSha||
    state.bootId!==P.bootId||clock.bootId!==P.bootId||state.createdAt!==P.createdAt||
    !time(clock.now)||clock.now<P.createdAt||clock.now>=P.createdAt+43200000||
    state.candidate?.pauseExpected!=="1"||state.candidate.disk.runtime!==P.release||
    state.launchJournal?.slots["paused-web"]?.phase!=="confirmed"||state.resumed!==null||state.finalDump!==null||
    !state.daemonRepair||Object.hasOwn(state,"startupRepair"))fail();
  return state;
}
export function validateStartupCompletionPredecessor(state,clock){
  if(clock.bootId!==P.bootId||!time(clock.now)||clock.now<STARTUP_COMPLETION.authorizedAfter||clock.now>=STARTUP_COMPLETION.expiresAt)fail();
  return validateStartupRepairPredecessor(state,{bootId:clock.bootId,now:STARTUP_COMPLETION.historicalAt});
}
export function startupRepairHistoricalClock(state,clock){
  return state.startupRepair?.version===2 ? {bootId:clock.bootId,now:STARTUP_COMPLETION.historicalAt}:clock;
}
export function validateStartupRepairState(state,clock){
  const a=state.startupRepair,completion=a?.version===2;
  if(!exact(a,completion?[...AUDIT,"completion"]:AUDIT)||![1,2].includes(a.version))fail();
  if(completion){
    if(!isDeepStrictEqual(a.completion,STARTUP_COMPLETION)||a.repairedAt<STARTUP_COMPLETION.authorizedAfter||a.historyCheckedAt<STARTUP_COMPLETION.authorizedAfter||a.runId===STARTUP_COMPLETION.failedRunId)fail();
    validateStartupCompletionPredecessor(a.predecessor,clock);
  }else validateStartupRepairPredecessor(a.predecessor,clock);
  if(FIXED.some(k=>!isDeepStrictEqual(state[k],a.predecessor[k]))||!SHA.test(a.targetSha)||
    [P.previousTargetSha,P.expectedOldSha].includes(a.targetSha)||state.targetSha!==a.targetSha||
    !Number.isSafeInteger(state.revision)||state.revision<P.revision+1||
    !time(a.repairedAt)||!time(a.historyCheckedAt)||a.historyCheckedAt<P.createdAt||
    a.repairedAt<a.historyCheckedAt||a.repairedAt-a.historyCheckedAt>300000||a.repairedAt>clock.now||
    !ID.test(a.runId)||!ID.test(a.mainCIrunId)||a.runId===a.mainCIrunId||
    [P.failedRunId,P.backupRunId,P.readinessRunId].includes(a.runId)||
    ![a.sourceDigest,a.historyDigest,a.migrationDigest].every(v=>HASH.test(v))||
    (state.revision===P.revision+1&&(state.phase!=="held"||LAUNCH.some(k=>state[k]!==null)||!isDeepStrictEqual(state.ingress,a.predecessor.ingress))))fail();
  return state;
}
export function buildStartupRepairedState(previous,audit,clock){
  if(audit.version===2)validateStartupCompletionPredecessor(previous,clock);
  else validateStartupRepairPredecessor(previous,clock);
  if(!isDeepStrictEqual(audit.predecessor,previous)||audit.repairedAt!==clock.now)fail();
  const next={...previous,revision:previous.revision+1,targetSha:audit.targetSha,phase:"held",
    ...Object.fromEntries(LAUNCH.map(k=>[k,null])),startupRepair:audit};
  validateStartupRepairState(next,clock);return next;
}
export function assertStartupRepairProgress(previous,next){
  if(!Object.hasOwn(previous,"startupRepair")){
    const a=next.startupRepair;if(!a||!isDeepStrictEqual(next,buildStartupRepairedState(previous,a,{bootId:previous.bootId,now:a.repairedAt})))fail();return;
  }
  if(!isDeepStrictEqual(previous.startupRepair,next.startupRepair)||previous.targetSha!==next.targetSha||next.revision!==previous.revision+1)fail();
  const clock={bootId:previous.bootId,now:previous.startupRepair.repairedAt};
  validateStartupRepairState(previous,clock);validateStartupRepairState(next,clock);
}
