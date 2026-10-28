// Source-only PRIVATE-worker transitions. No command, process lookup or signal.
import {isDeepStrictEqual} from 'node:util';
import {canonicalJson,sha256,requireToolchain as need} from './release-toolchain-contracts.mjs';
const NAME='merchant-space-booking-atomic-f274ad615550',script=revision=>'/var/lib/faolla-online-code/'+revision+'/scripts/booking-atomic-worker.mjs';
export function assertExecutionWorkerTransition(before,after,{priorRevision,revision}){
 need(/^[a-f0-9]{40}$/.test(priorRevision??'')&&/^[a-f0-9]{40}$/.test(revision??'')&&revision!==priorRevision,'source_changed');
 need(before?.name===NAME&&before.pmId===27&&Number.isSafeInteger(before.pid)&&before.pid>0&&Number.isSafeInteger(before.restartCount)&&before.restartCount>=1&&
  before.status==='online'&&before.cwd==='/www/wwwroot/merchant-space.web-releases/f274ad615550-online'&&before.executable===script(priorRevision)&&
  after?.pid>0&&after.pid!==before.pid&&after.restartCount===before.restartCount+1&&after.createdAt>before.createdAt&&after.executable===script(revision),'operation_unconfirmed');
 const fixed=p=>Object.fromEntries(Object.entries(p).filter(([key])=>!['pid','restartCount','createdAt','executable'].includes(key)));
 need(isDeepStrictEqual(fixed(before),fixed(after)),'observation_mismatch');return true;
}
export function assertExecutionWorkerReceipt(receipt,attempt,{revision,prior}){
 need(receipt?.schemaVersion===1&&receipt.kind==='release-toolchain-private-worker-replacement'&&receipt.toolRevision===revision&&receipt.priorRevision===prior.toolRevision&&
  receipt.gateNeverOpened===true&&receipt.mailEnabled===false&&Number.isFinite(Date.parse(receipt.completedAt))&&
  /^[a-f0-9]{64}$/.test(receipt.toolInventorySha256??'')&&receipt.toolInventorySha256===attempt?.toolInventorySha256&&
  receipt.identity?.name===NAME&&receipt.identity.pid===receipt.after?.pid&&receipt.attemptSha256===sha256(canonicalJson(attempt)+'\n'),'evidence_invalid');
 need(attempt?.kind==='release-toolchain-private-worker-attempt'&&attempt.toolRevision===revision&&attempt.priorRevision===prior.toolRevision&&
  canonicalJson(attempt.before)===canonicalJson(prior.after)&&canonicalJson(receipt.before)===canonicalJson(prior.after),'observation_mismatch');
 assertExecutionWorkerTransition(receipt.before,receipt.after,{priorRevision:prior.toolRevision,revision});return true;
}
