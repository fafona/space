// Observation only. This module cannot authorize, retry, recover or publish.
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {types} from 'node:util';
import {TOOLCHAIN_CODES} from './release-toolchain-contracts.mjs';

export const APPLICATION_FINALIZATION_PHASES=Object.freeze({
 finish:Object.freeze(['finish-entry','finish-verify','finish-retention','finish-baseline','finish-worker-cycles','finish-precompletion-audit','finish-completion-record','finish-final-audit']),
 audit:Object.freeze(['audit-entry','audit-source','audit-history','audit-state','audit-build','audit-runtime','audit-manifest','audit-retention','audit-worker','audit-routing','audit-persistence','audit-public-probe','audit-worker-cycles','audit-history-final']),
 retained:Object.freeze(['retained-entry','retained-source','retained-state','retained-history','retained-build','retained-runtime','retained-manifest','retained-schema','retained-window','retained-worker','retained-persistence','retained-routing','retained-private-version','retained-public-version','retained-worker-cycles','retained-final-witness']),
});
const auditCodes=['invocation','source','not_active','metadata','candidate_source','build_proof','runtime','manifest','completion_missing','retained_window','worker_certificate','worker','worker_gate','worker_source','routing','active_changed','processes_changed','worker_replaced','worker_cycles_pending','completion_worker'];
const codes=new Set([
 ...auditCodes.map(value=>'application_release_audit_'+value),
 ...TOOLCHAIN_CODES.map(value=>'release_toolchain_'+value),
 'application_release_finish_phase','application_release_retention_incomplete','application_release_worker_missing','application_release_worker_changed','application_release_worker_cycles_unconfirmed',
 'booking_recovery_probe_origins','booking_recovery_probe_context','booking_recovery_probe_budget','booking_recovery_probe_deadline','booking_recovery_probe_body_limit','booking_recovery_probe_target_unconfirmed',
 'online_retention_writer_persisted_processes_changed','online_retention_writer_dump_process_set_changed','online_retention_writer_dump_process_changed',
 'application_history_observation_raw_proofs_changed','application_history_observation_changed_during_validation','application_history_observation_history_changed',
 'release_proc_directory_witness_unconfirmed',
 ...['invocation','busy','state','active','history','build','runtime','manifest','window','worker','worker_source','worker_gate','routing','private_version','version_probe','version_timeout','version_body_limit','version_scope','worker_cycles','file_changed','no_publication'].map(value=>'application_retained_diagnostic_'+value),
]);
const hash=value=>createHash('sha256').update(value).digest('hex');
function ownMessage(error){
 if(!error||!['object','function'].includes(typeof error)||types.isProxy(error))return '';
 try{const value=Object.getOwnPropertyDescriptor(error,'message');return value&&Object.hasOwn(value,'value')&&typeof value.value==='string'?value.value:'';}catch{return '';}
}
export function applicationFinalizationFailure(error){
 const message=ownMessage(error);
 return{code:codes.has(message)?message:'unclassified',exceptionMessageSha256:hash(message),detailsRedacted:true};
}
export async function observeApplicationFinalization(target,scope,work,{emit=value=>{if(value.event==='threw')console.error(JSON.stringify(value));},clock=()=>performance.now()}={}){
 if(!/^[a-f0-9]{40}$/.test(target??'')||!Object.hasOwn(APPLICATION_FINALIZATION_PHASES,scope)||typeof work!=='function'||typeof emit!=='function'||typeof clock!=='function')throw Error('application_finalization_diagnostic_context');
 let phase=scope+'-entry';const started=clock();
 const record=(event,extra={})=>{
  // A failing diagnostic sink must not replace an original error or replay work.
  try{const elapsed=clock()-started;emit({kind:'application-finalization-diagnostic',target,scope,phase,event,elapsedMs:Number.isFinite(elapsed)&&elapsed>=0?Math.round(elapsed):null,...extra,publicationAuthority:false,publicationCompleted:false});}catch{}
 };
 const mark=value=>{if(!APPLICATION_FINALIZATION_PHASES[scope].includes(value))throw Error('application_finalization_diagnostic_phase');phase=value;record('enter');};
 record('enter');
 try{const result=await work(mark);record('returned');return result;}
 catch(error){record('threw',applicationFinalizationFailure(error));throw error;}
}
