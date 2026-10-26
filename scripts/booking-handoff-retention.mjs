// Pure, one-time bridge. Historical receipts are neither edited nor re-signed.
// Host-side collection/ownership checks are mandatory; importing this file does
// not authorize a process restart, database activation or publication.
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {rollingHash} from './online-release-rolling-policy.mjs';
import {BOOKING_HANDOFF_APPLICATION as APPLICATION, BOOKING_HANDOFF_CANDIDATE as CANDIDATE,
  BOOKING_HANDOFF_BASELINE as BASELINE, assertBookingHandoffEvidence,
  assertBookingHandoffProcessSet, assertBookingAtomicCohort,
  assertBookingAtomicActivationTransition, assertBookingHandoffWindow} from './booking-handoff-policy.mjs';

export const BOOKING_RETENTION_KIND='booking-handoff';
const fail=code=>{throw Error('booking_handoff_retention_'+code);};
const need=(value,code)=>{if(!value)fail(code);};
const equal=(a,b,code)=>need(isDeepStrictEqual(a,b),code);
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const keys=(v,expected,code)=>{need(object(v),code);equal(Object.keys(v).sort(),[...expected].sort(),code);};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const hex=/^[a-f0-9]{64}(?![\s\S])/;
const location=a=>Object.fromEntries(['target','name','directory','port'].map(k=>[k,a[k]]));
const parse=text=>{need(typeof text==='string','state_text');try{return JSON.parse(text);}catch{fail('state_text');}};

export function assertBookingRollbackReadiness(readiness,rollback,evidence){
  keys(readiness,['schemaVersion','kind','candidate','target','stateText','buildEvidenceSha256','runtimeSha256',
    'environmentFileSha256','compatibilitySha256'],'readiness_shape');
  need(readiness.schemaVersion===1&&readiness.kind==='booking-atomic-rollback-ready'&&
    readiness.candidate===CANDIDATE&&readiness.target===APPLICATION&&rollback.target===APPLICATION&&
    ['buildEvidenceSha256','runtimeSha256','environmentFileSha256'].every(k=>hex.test(readiness[k]??''))&&
    readiness.compatibilitySha256===evidence.compatibilitySha256,'readiness_identity');
  const state=parse(readiness.stateText);
  keys(state,['target','name','directory','port','status','readyAt','storageMode','candidate'],'ready_state_shape');
  equal(location(state),location(rollback),'ready_state_identity');
  need(state.status==='booking-rollback-ready'&&state.storageMode==='atomic-v2'&&state.candidate===CANDIDATE,'ready_state_identity');
  const start=assertBookingHandoffWindow(evidence.window).startedAtMs,ready=Date.parse(state.readyAt);
  need(Number.isFinite(ready)&&new Date(ready).toISOString()===state.readyAt&&
    ready<=start&&start-ready<=86400000,'readiness_time');
  equal(rollingHash(readiness),evidence.rollbackReadinessSha256,'readiness_hash');
  return state;
}

/** Validates the complete predecessor process set rather than a caller-supplied
 * subset. The original stage keeps its original 52f baseline, while the newly
 * recorded runtime edge explicitly names the compatible 6c rollback. */
export function assertBookingRetentionHandoff({handoff,prior,previousSha256,active,rollback,processes,toolRevision,completedAt}){
  keys(handoff,['evidence','originalStageText','legacyBefore','legacyAfter','added','runtimeByName',
    'databaseBefore','databaseAfter','rollbackReadiness'],'proof_shape');
  const e=handoff.evidence;
  assertBookingHandoffEvidence(e);
  const bounds=assertBookingHandoffWindow(e.window),restartedAt=handoff.legacyAfter?.createdAt;
  need(Number.isSafeInteger(restartedAt)&&restartedAt>=bounds.startedAtMs&&restartedAt<=Date.parse(e.completedAt),'restart_outside_window');
  need(object(prior)&&prior.active.target===BASELINE&&e.priorRetentionHeadSha256===previousSha256&&
    e.toolRevision===toolRevision,'predecessor');
  equal(prior.processes.find(p=>p.name==='merchant-space'),handoff.legacyBefore,'legacy_predecessor');
  assertBookingHandoffProcessSet({before:prior.processes,after:processes,legacyBefore:handoff.legacyBefore,
    legacyAfter:handoff.legacyAfter,added:handoff.added});
  assertBookingAtomicCohort({active,rollback,runtimeByName:handoff.runtimeByName});
  equal(handoff.added.find(p=>p.name===active.name),active.process,'primary_process');
  equal(handoff.added.find(p=>p.name===rollback.name),rollback.process,'rollback_process');
  const worker=handoff.added.find(p=>![active.name,rollback.name].includes(p.name));
  need(worker.cwd===active.directory&&worker.port===null&&worker.interpreter==='/usr/bin/node'&&
    worker.executable==='/var/lib/faolla-online-code/'+toolRevision+'/scripts/booking-atomic-worker.mjs'&&
    worker.execMode==='fork_mode'&&worker.autorestart===true&&worker.watch===false&&
    [null,false,'0'].includes(worker.cronRestart)&&worker.shutdownWithMessage===false&&
    [undefined,''].includes(worker.manualSignalHandle)&&worker.backgroundPaused==='0'&&
    worker.automationEnabled==='0'&&worker.invitationEnabled==='0','worker_identity');
  equal(worker.args,[],'worker_arguments');equal(worker.nodeArgs,[],'worker_arguments');
  assertBookingAtomicActivationTransition(handoff.databaseBefore,handoff.databaseAfter);
  equal(rollingHash({before:handoff.databaseBefore,after:handoff.databaseAfter}),e.activationSha256,'activation_hash');
  assertBookingRollbackReadiness(handoff.rollbackReadiness,rollback,e);
  need(hash(handoff.originalStageText)===e.priorStageSha256,'stage_hash');
  const stage=parse(handoff.originalStageText);
  equal(handoff.originalStageText,JSON.stringify(stage,null,2),'stage_encoding');
  equal(location(stage),location(active),'stage_identity');
  need(stage.status==='database-ready'&&stage.lane==='booking-runtime-compatibility-only'&&
    stage.baseline===BASELINE&&stage.retentionHeadSha256===previousSha256,'stage_predecessor');
  equal([stage.oldName,stage.oldDirectory,stage.oldPort],
    [prior.active.name,prior.active.directory,prior.active.port],'stage_baseline');
  equal(stage.previousActive,location(prior.active),'stage_active');
  equal(stage.processes,prior.processes,'stage_processes');
  if(completedAt!==undefined){
    assertBookingHandoffWindow(e.window,{nowMs:Date.parse(completedAt)});
    need(Date.parse(completedAt)>=Date.parse(e.completedAt),'completion_predates_handoff');
  }
  return true;
}

/** After history replay has validated the one handoff, old saved snapshots may
 * map exactly this original legacy record to its certified successor. Nothing
 * else (not even a different PID for the same name) is normalized away. */
export function bookingHandoffReplacements(history){
  return history.entries.filter(c=>c.kind===BOOKING_RETENTION_KIND).map(c=>({
    before:c.bookingHandoff.legacyBefore,after:c.bookingHandoff.legacyAfter,
  }));
}
export function assertBookingReadyReleaseProof({anchor,state,stateText,history,handoff}){
  const origin=handoff??history.entries.find(c=>c.kind===BOOKING_RETENTION_KIND&&c.rollback.target===anchor.target)?.bookingHandoff;
  need(origin&&anchor.target===APPLICATION,'unbound_ready_state');
  const expected=assertBookingRollbackReadiness(origin.rollbackReadiness,anchor,origin.evidence);
  equal(stateText,origin.rollbackReadiness.stateText,'ready_state_bytes');
  equal(state,expected,'ready_state_changed');
  return true;
}

/** The standard tool installer may accept this ONE new terminal ready state
 * only after the complete handoff is committed and every retained artifact
 * still has the exact bytes the certificate bound. No pending candidate is
 * relabelled as published and no generic status exemption is introduced. */
export function assertBookingRollbackToolPreparation({stateText,history,artifacts}){
  const origin=history.entries.find(c=>c.kind===BOOKING_RETENTION_KIND);
  need(origin&&origin.active.target===CANDIDATE&&origin.rollback.target===APPLICATION,'tool_preparation_unbound');
  const ready=origin.bookingHandoff.rollbackReadiness;
  assertBookingReadyReleaseProof({anchor:origin.rollback,state:parse(stateText),stateText,history});
  keys(artifacts,['buildEvidence','runtime','environmentFile'],'tool_preparation_artifacts');
  for(const [key,pin]of [['buildEvidence','buildEvidenceSha256'],['runtime','runtimeSha256'],['environmentFile','environmentFileSha256']])
    need(hash(artifacts[key])===ready[pin],'tool_preparation_artifact_changed');
  return true;
}
