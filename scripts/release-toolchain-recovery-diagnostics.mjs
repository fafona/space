import{stageFailureDiagnostic}from'./release-toolchain-diagnostics.mjs';
import{sha256,TOOLCHAIN_CODES}from'./release-toolchain-contracts.mjs';
const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/,hash=/^[a-f0-9]{64}$/;
export const RECOVERY_STEPS=Object.freeze(['startup','verify','parentGone','capture','databaseBarrier','legacyState','begin','disableBookingWorker','pauseLegacyOnce','route','unfence','publicProof','publicationMetadata','persistProcesses','complete']);
const need=(v,c)=>{if(!v)throw Error('recovery_diagnostic_'+c);};
function keys(v,list){need(v&&typeof v==='object'&&!Array.isArray(v)&&JSON.stringify(Object.keys(v).sort())===JSON.stringify([...list].sort()),'shape');}
export function recoveryFailureDiagnostic(error,{step,operationId,toolRevision,knownFiles,at=new Date().toISOString()}){
 need(RECOVERY_STEPS.includes(step)&&uuid.test(operationId)&&/^[a-f0-9]{40}$/.test(toolRevision),'context');
 return{kind:'booking-recovery-step-failure',operationId,step,at,diagnostic:stageFailureDiagnostic(error,{stage:'switch',toolRevision,knownFiles})};
}
export function assertRecoveryFailureDiagnostic(value,{operationId,toolRevision}){
 keys(value,['kind','operationId','step','at','diagnostic']);need(value.kind==='booking-recovery-step-failure'&&value.operationId===operationId&&RECOVERY_STEPS.includes(value.step)&&new Date(Date.parse(value.at)).toISOString()===value.at,'binding');
 const d=value.diagnostic;keys(d,['kind','toolRevision','stage','code','exceptionMessageSha256','frames','detailsRedacted']);need(d.kind==='release-toolchain-stage-failure-diagnostic'&&d.toolRevision===toolRevision&&d.stage==='switch'&&TOOLCHAIN_CODES.includes(d.code)&&hash.test(d.exceptionMessageSha256)&&d.detailsRedacted===true&&Array.isArray(d.frames)&&d.frames.length<=8,'content');
 for(const f of d.frames){keys(f,['file','line','column']);need(/^scripts\/[A-Za-z0-9_-]+\.mjs$/.test(f.file)&&Number.isSafeInteger(f.line)&&f.line>0&&f.line<10000000&&Number.isSafeInteger(f.column)&&f.column>0&&f.column<10000000,'frame');}return true;
}
export function recoveryChildExitEvidence(result,{operationId,toolRevision,at=new Date().toISOString()}){
 need(uuid.test(operationId)&&/^[a-f0-9]{40}$/.test(toolRevision),'context');
 const stdout=typeof result.stdout==='string'?result.stdout:'',stderr=typeof result.stderr==='string'?result.stderr:'',stdoutBytes=Buffer.byteLength(stdout),stderrBytes=Buffer.byteLength(stderr),outputExceededLimit=stdoutBytes>65536||stderrBytes>65536;
 // spawnSync may return the final pipe chunk beyond maxBuffer together with
 // ENOBUFS. Preserve its exit/hash evidence rather than failing the reporter.
 let childDiagnostic=null;for(const line of (outputExceededLimit?[]:stderr.trim().split('\n').filter(Boolean))){
  if(['booking_recovery_unconfirmed','booking_recovery_diagnostic_unconfirmed'].includes(line))continue;
  try{const d=JSON.parse(line);need(JSON.stringify(d)===line,'canonical');assertRecoveryFailureDiagnostic(d,{operationId,toolRevision});need(childDiagnostic===null,'duplicate');childDiagnostic=d;}catch{childDiagnostic=null;break;}
 }
 return{kind:'booking-watchdog-recovery-child-exit',operationId,toolRevision,at,status:Number.isSafeInteger(result.status)?result.status:null,signal:['SIGKILL','SIGTERM','SIGINT'].includes(result.signal)?result.signal:result.signal?'unclassified':null,errorCode:['ETIMEDOUT','ENOENT','EACCES','ENOBUFS'].includes(result.error?.code)?result.error.code:result.error?'unclassified':null,stdoutBytes,stderrBytes,outputExceededLimit,stdoutSha256:sha256(stdout),stderrSha256:sha256(stderr),childDiagnostic,outputEmpty:stdout===''&&stderr==='',publicationAuthority:false};
}
