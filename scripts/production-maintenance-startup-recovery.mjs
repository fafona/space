import { createHash } from "node:crypto";
import { isDeepStrictEqual as equal } from "node:util";
import { validateMaintenanceLeaseState } from "./production-maintenance-lease.mjs";
import { captureMaintenancePreflightValue as capture, assertMaintenancePreflightLaunchShape as launchShape,
  assertMaintenancePreflightJournalProgress as journalProgress } from "./production-maintenance-preflight-recovery.mjs";

// Explicit restoration authorization. This appends one new attempt and preserves
// the consumed T15 launch verbatim; it is not a retry under the old nonce.
export const MAINTENANCE_STARTUP_AUTHORIZATION = Object.freeze({ version: 1,
  operationId: "eb81284a-09c4-4514-8f16-38eaf6acc1e4", authorizedAt: Date.parse("2026-09-14T22:21:26Z"),
  activeAttempt: 4, maximumAdditionalAttempts: 1, maximumLeaseMilliseconds: 12 * 60 * 60 * 1000,
});
export const MAINTENANCE_STARTUP_PREDECESSOR = Object.freeze({ version: 13, revision: 51, phase: "failed-held", activeAttempt: 3,
  targetSha: "e83c91abbf8e0d327708bd0b04c3a33ed423ab91", stateBytes: 2457712,
  stateDigest: "7f62d8e4cbe861eaac415a67d0f5b7d012639b78290a46d059e3e64234f6f405",
  bootId: "e6531ec9-db4a-4216-b87a-7cc858197eaa", expectedOldSha: "cd943076ebda758b70bf2f2270a508c774b726d6",
});
const AUTH = MAINTENANCE_STARTUP_AUTHORIZATION, PIN = MAINTENANCE_STARTUP_PREDECESSOR;
export const MAINTENANCE_STARTUP_UNUSED = Object.freeze({targetSha:"dd592af21cefc76824fbaf58746a1edd72428626",
  stateDigest:"2624679ed3914d9f818b9e04268f209f1f8708416aa83135d89884bc98bde646",stateBytes:2634610,revision:52});
const UNUSED = MAINTENANCE_STARTUP_UNUSED;
const KEYS = ["version", "revision", "operationId", "targetSha", "expectedOldSha", "appDir", "appName", "appPort", "bootId", "createdAt", "phase", "runtime", "ingress", "database", "publicSupabaseUrl", "tokenHash", "candidate", "resumed", "launchDisk", "launchJournal", "finalDump", "recovery", "continuation", "buildRecovery", "deadlineExtension", "activeAttempt", "attemptRecovery", "secondAttemptRecovery", "budgetRecovery", "windowRenewal", "prelaunchRecovery", "preflightRecovery", "leaseRenewal", "leaseExtensions", "fenceRecovery"];
const LAUNCH = ["candidate", "resumed", "launchDisk", "launchJournal", "finalDump"];
const COMPACT = ["version", "revision", "phase", "targetSha", "activeAttempt", "ingress", ...LAUNCH];
const INSPECTION = ["version", "state", "operationId", "targetSha", "previousTargetSha", "expectedOldSha", "revision", "stateDigest", "stateBytes", "activeAttempt", "sourceDiffDigest", "migrationDigest", "stoppedBaseline", "stoppedBaselineDigest", "authorizationDigest"];
const EVIDENCE = [...INSPECTION, "toolsSha", "leaseRunId", "leaseRunAttempt", "mainCIrunId", "historyDigest", "historyCheckedAt"];
const BASELINE = ["version", "stateDigest", "candidateDigest", "launchDiskDigest", "launchJournalDigest", "runtimeDigest", "current", "bootId", "pm2RegistryDigest", "observedAt"];
const CONTEXT = ["operationId", "targetSha", "previousTargetSha", "expectedOldSha", "expectedRevision", "expectedDigest", "bootId", "now", "sourceDiffDigest", "migrationDigest", "stoppedBaseline"];
const PHASES = { held: ["held", "candidate", "failed-held", "failed-unknown"], candidate: ["candidate", "resuming", "failed-held", "failed-unknown"],
  resuming: ["resuming", "ended", "failed-held", "failed-unknown"], ended: ["ended", "failed-held", "failed-unknown"],
  "failed-held": ["failed-held", "failed-unknown"], "failed-unknown": ["failed-held", "failed-unknown"] };
const fail = () => { throw new Error("maintenance_startup_recovery_unverified"); };
const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const exact = (value, keys) => value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every(k => Object.hasOwn(value, k));
const project = (value, keys) => Object.fromEntries(keys.map(k => [k, value[k]]));
const number = value => Number.isSafeInteger(value) && value >= 0;
const digest = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const sha = value => typeof value === "string" && /^[a-f0-9]{40}$/.test(value);
const run = value => typeof value === "string" && /^[1-9][0-9]{0,19}$/.test(value);
const freeze = value => { if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
function clock(time) { if (!exact(time, ["bootId", "now"]) || time.bootId !== PIN.bootId || !number(time.now) || time.now < AUTH.authorizedAt) fail(); }
let pinnedPredecessorValidated = false;
function predecessor(state) {
  if (!exact(state, KEYS) || Object.entries(PIN).some(([key,value]) => !["stateDigest","stateBytes"].includes(key) && state[key] !== value) ||
      state.operationId !== AUTH.operationId || hash(state) !== PIN.stateDigest || Buffer.byteLength(JSON.stringify(state)) !== PIN.stateBytes ||
      !state.candidate || !state.launchDisk || !state.launchJournal || state.resumed !== null || state.finalDump !== null ||
      state.launchJournal.slots["paused-web"]?.phase !== "confirmed" || state.launchJournal.slots["resumed-web"] !== null || state.launchJournal.slots.worker !== null) fail();
  // Byte-pinned historical authority is checked at its actual failure time.
  // No historical clock is passed to any filesystem, process or DB observation.
  if (!pinnedPredecessorValidated) {
    validateMaintenanceLeaseState(state, { bootId: PIN.bootId, now: Date.parse("2026-09-15T00:52:00Z") });
    pinnedPredecessorValidated = true;
  }
  return state;
}
function original(state) {
  const compact = state.startupRecovery?.predecessor;
  if (!exact(compact, COMPACT)) fail();
  return predecessor({ ...project(state, KEYS), ...compact });
}
export function validateMaintenanceStartupBaseline(raw) {
  const value = capture(raw);
  if (!exact(value, BASELINE) || value.version !== 4 || value.stateDigest !== PIN.stateDigest || value.bootId !== PIN.bootId ||
      !["candidateDigest", "launchDiskDigest", "launchJournalDigest", "runtimeDigest", "pm2RegistryDigest"].every(k => digest(value[k])) ||
      !number(value.observedAt) || value.observedAt < AUTH.authorizedAt || !exact(value.current, ["target","linkIdentity","runtimeIdentity"]) ||
      value.current.target !== "/www/wwwroot/merchant-space.releases/e83c91abbf8e-20260915004149" ||
      ![value.current.linkIdentity,value.current.runtimeIdentity].every(v => typeof v === "string" && /^\d+(?::\d+){7}$/.test(v))) fail();
  for (const [key,kind] of [["linkIdentity",0o120000n],["runtimeIdentity",0o040000n]]) {
    const fields=value.current[key].split(":").map(BigInt);
    if(fields[6]!==0n||fields[5]<1n||(fields[7]&0o170000n)!==kind||(key==="linkIdentity"?fields[5]!==1n:(fields[7]&0o022n)!==0n))fail();
  }
  return freeze(value);
}
function baseline(value, old, now) {
  validateMaintenanceStartupBaseline(value);
  if (value.observedAt > now || now - value.observedAt > 300000 || value.current.target !== old.candidate.disk.runtime ||
      value.current.runtimeIdentity !== old.candidate.disk.runtimeIdentity ||
      ["candidate","launchDisk","launchJournal","runtime"].some(k => value[k + "Digest"] !== hash(old[k]))) fail();
}
export function validateMaintenanceStartupInspection(raw) {
  const value = capture(raw);
  const pin=value.revision===52?UNUSED:PIN;
  if (!exact(value, INSPECTION) || value.version !== 1 || value.state !== "startup-recovery-inspected" || value.operationId !== AUTH.operationId ||
      !sha(value.targetSha) || [PIN.targetSha,PIN.expectedOldSha,...(value.revision===52?[UNUSED.targetSha]:[])].includes(value.targetSha) || value.previousTargetSha !== pin.targetSha ||
      value.expectedOldSha !== PIN.expectedOldSha || value.revision !== pin.revision || value.stateDigest !== pin.stateDigest ||
      value.stateBytes !== pin.stateBytes || value.activeAttempt !== 4 || ![value.sourceDiffDigest,value.migrationDigest,value.stoppedBaselineDigest].every(digest) ||
      value.authorizationDigest !== hash(AUTH) || value.stoppedBaselineDigest !== hash(value.stoppedBaseline)) fail();
  validateMaintenanceStartupBaseline(value.stoppedBaseline); return freeze(value);
}
export function validateMaintenanceStartupEvidence(raw) {
  const value = capture(raw); if (!exact(value,EVIDENCE)) fail(); validateMaintenanceStartupInspection(project(value,INSPECTION));
  if (value.toolsSha !== value.targetSha || !run(value.leaseRunId) || !run(value.mainCIrunId) || value.leaseRunAttempt !== 1 || value.leaseRunId === value.mainCIrunId ||
      !digest(value.historyDigest) || !number(value.historyCheckedAt) || value.historyCheckedAt < AUTH.authorizedAt) fail(); return freeze(value);
}
export function validateMaintenanceStartupPredecessor(raw, rawClock) {
  const state=capture(raw), time=capture(rawClock);clock(time);
  if(state.version===14){
    validateMaintenanceStartupState(state,time);
    if(state.revision!==52||state.targetSha!==UNUSED.targetSha||state.phase!=="held"||LAUNCH.some(k=>state[k]!==null)||
      state.startupRecovery.retarget||hash(state)!==UNUSED.stateDigest||Buffer.byteLength(JSON.stringify(state))!==UNUSED.stateBytes)fail();
  }else predecessor(state);
  return freeze(state);
}
export function createMaintenanceStartupInspection(raw, rawContext) {
  const context=capture(rawContext);if(!exact(context,CONTEXT))fail();
  const old=validateMaintenanceStartupPredecessor(raw,{bootId:context.bootId,now:context.now});
  const pin=old.version===14?UNUSED:PIN;
  if(context.operationId!==old.operationId||context.previousTargetSha!==pin.targetSha||context.expectedOldSha!==old.expectedOldSha||context.expectedRevision!==old.revision||context.expectedDigest!==pin.stateDigest)fail();
  baseline(context.stoppedBaseline,old.version===14?original(old):old,context.now);
  return validateMaintenanceStartupInspection({version:1,state:"startup-recovery-inspected",operationId:old.operationId,targetSha:context.targetSha,
    previousTargetSha:pin.targetSha,expectedOldSha:old.expectedOldSha,revision:old.revision,stateDigest:pin.stateDigest,stateBytes:pin.stateBytes,activeAttempt:4,
    sourceDiffDigest:context.sourceDiffDigest,migrationDigest:context.migrationDigest,stoppedBaseline:context.stoppedBaseline,
    stoppedBaselineDigest:hash(context.stoppedBaseline),authorizationDigest:hash(AUTH)});
}
function checkState(state) {
  if(!exact(state,[...KEYS,"startupRecovery"])||state.version!==14||state.activeAttempt!==4||!number(state.revision)||state.revision<52||!Object.hasOwn(PHASES,state.phase))fail();
  const audit=state.startupRecovery;
  if(!exact(audit,["version","predecessor","evidence","recoveredAt","expiresAt","stoppedBaseline","authorization",...(Object.hasOwn(audit,"retarget")?["retarget"]:[])])||audit.version!==1||!equal(audit.authorization,AUTH)||
     !number(audit.recoveredAt)||audit.recoveredAt<AUTH.authorizedAt||audit.expiresAt!==audit.recoveredAt+AUTH.maximumLeaseMilliseconds)fail();
  const old=original(state), item=validateMaintenanceStartupEvidence(audit.evidence);
  if(item.targetSha!==(audit.retarget?UNUSED.targetSha:state.targetSha)||item.revision!==51||item.historyCheckedAt>audit.recoveredAt||audit.recoveredAt-item.historyCheckedAt>300000||!equal(item.stoppedBaseline,audit.stoppedBaseline))fail();
  let lastTime=audit.recoveredAt;
  if(audit.retarget){
    const r=audit.retarget;
    if(!exact(r,["evidence","retargetedAt"])||!number(r.retargetedAt)||r.retargetedAt<audit.recoveredAt||r.retargetedAt>=audit.expiresAt||state.revision<53)fail();
    const receipt=validateMaintenanceStartupEvidence(r.evidence);
    if(receipt.revision!==52||receipt.targetSha!==state.targetSha||receipt.historyCheckedAt>r.retargetedAt||r.retargetedAt-receipt.historyCheckedAt>300000)fail();
    baseline(receipt.stoppedBaseline,old,r.retargetedAt);
    const previous={...state,revision:52,phase:"held",targetSha:UNUSED.targetSha,ingress:old.ingress,...Object.fromEntries(LAUNCH.map(k=>[k,null])),startupRecovery:{...audit}};
    delete previous.startupRecovery.retarget;
    if(hash(previous)!==UNUSED.stateDigest||Buffer.byteLength(JSON.stringify(previous))!==UNUSED.stateBytes)fail();
    if(state.revision===53&&(state.phase!=="held"||LAUNCH.some(k=>state[k]!==null)||!equal(state.ingress,old.ingress)))fail();
    lastTime=r.retargetedAt;
  }
  baseline(audit.stoppedBaseline,old,audit.recoveredAt);
  if(state.revision===52&&(state.phase!=="held"||LAUNCH.some(k=>state[k]!==null)||!equal(state.ingress,old.ingress)))fail();
  if((["candidate","resuming","ended"].includes(state.phase)&&state.candidate===null)||(state.phase==="ended"&&state.finalDump===null))fail();
  const historical=old.budgetRecovery.predecessor.state;
  const journals=[old.launchJournal,historical.launchJournal,historical.secondAttemptRecovery.predecessor.state.launchJournal,historical.attemptRecovery.predecessor.state.launchJournal];
  launchShape(state,journals.flatMap(j=>Object.values(j.slots).filter(Boolean).map(s=>s.nonce)));
  return {old,expiresAt:audit.expiresAt,lastTime};
}
export function validateMaintenanceStartupState(raw,rawClock){const state=capture(raw),time=capture(rawClock);clock(time);const checked=checkState(state);if(time.now<checked.lastTime||time.now>=checked.expiresAt)fail();return freeze(state);}
export function maintenanceStartupExpiresAt(raw){return checkState(capture(raw)).expiresAt;}
export function maintenanceStartupHistoricalState(raw,rawClock){const state=validateMaintenanceStartupState(raw,rawClock);return freeze(original(state));}
export function buildMaintenanceStartupRecoveredState(raw,rawEvidence,rawContext){
  const old=capture(raw),item=validateMaintenanceStartupEvidence(rawEvidence),context=capture(rawContext),inspection=createMaintenanceStartupInspection(old,context);
  if(!equal(inspection,project(item,INSPECTION))||item.historyCheckedAt>context.now||context.now-item.historyCheckedAt>300000)fail();
  if(old.version===14)return validateMaintenanceStartupState({...old,revision:53,targetSha:context.targetSha,
    startupRecovery:{...old.startupRecovery,retarget:{evidence:item,retargetedAt:context.now}}},{bootId:context.bootId,now:context.now});
  return validateMaintenanceStartupState({...old,version:14,revision:52,phase:"held",activeAttempt:4,targetSha:context.targetSha,...Object.fromEntries(LAUNCH.map(k=>[k,null])),
    startupRecovery:{version:1,predecessor:project(old,COMPACT),evidence:item,recoveredAt:context.now,expiresAt:context.now+AUTH.maximumLeaseMilliseconds,
      stoppedBaseline:context.stoppedBaseline,authorization:{...AUTH}}},{bootId:context.bootId,now:context.now});
}
export function assertMaintenanceStartupProgress(rawPrevious,rawNext){
  const previous=capture(rawPrevious),next=capture(rawNext);
  if(previous.version===14&&previous.revision===52&&next.version===14&&next.revision===53&&next.startupRecovery?.retarget){
    const r=next.startupRecovery.retarget,item=r.evidence;
    const expected=buildMaintenanceStartupRecoveredState(previous,item,{operationId:item.operationId,targetSha:item.targetSha,previousTargetSha:item.previousTargetSha,
      expectedOldSha:item.expectedOldSha,expectedRevision:item.revision,expectedDigest:item.stateDigest,bootId:previous.bootId,now:r.retargetedAt,
      sourceDiffDigest:item.sourceDiffDigest,migrationDigest:item.migrationDigest,stoppedBaseline:item.stoppedBaseline});if(!equal(expected,next))fail();return;
  }
  if(previous.version===13&&next.version===14){const audit=next.startupRecovery,item=audit?.evidence;if(!item)fail();
    const expected=buildMaintenanceStartupRecoveredState(previous,item,{operationId:item.operationId,targetSha:item.targetSha,previousTargetSha:item.previousTargetSha,
      expectedOldSha:item.expectedOldSha,expectedRevision:item.revision,expectedDigest:item.stateDigest,bootId:previous.bootId,now:audit.recoveredAt,
      sourceDiffDigest:item.sourceDiffDigest,migrationDigest:item.migrationDigest,stoppedBaseline:item.stoppedBaseline});if(!equal(expected,next))fail();return;}
  if(previous.version!==14||next.version!==14||next.revision!==previous.revision+1||!PHASES[previous.phase]?.includes(next.phase)||
    [...KEYS.filter(k=>!["revision","phase","ingress",...LAUNCH].includes(k)),"startupRecovery"].some(k=>!equal(previous[k],next[k]))||
    (previous.launchDisk!==null&&!equal(previous.launchDisk,next.launchDisk))||LAUNCH.some(k=>previous[k]!==null&&next[k]===null))fail();
  checkState(previous);checkState(next);journalProgress(previous,next);
}
