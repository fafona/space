// Release-only observation around the UNCHANGED shared transport. It cannot
// send control or dump-write requests, retry, or authorize publication.
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {types} from 'node:util';
import {inspectPm2Registry,capturePm2DumpTarget,verifyPm2Dump,PM2_CONTROL_BRIDGE_SOURCE,PM2_DUMP_BRIDGE_SOURCE} from './production-maintenance-pm2-adapter.mjs';
import {captureTrustedPython,verifyTrustedPython} from './production-maintenance-trusted-python.mjs';
const FIELDS=['pid','parentPid','startTicks','processIdentity','uid','cwd','cwdIdentity','executable','executableIdentity','commandLineDigest'];
const OPERATIONS=['registry-read','dump-capture','dump-verify'],IOS=['start','process-read','python-capture','python-verify','registry-exchange','dump-exchange'];
const ERRORS=['none','process_identity_drift','invalid_proc_stat','proc_file_size_invalid','proc_records_invalid','maintenance_trusted_python_unverified','transport-exception'];
const SYSTEM_ERRORS=['EAGAIN','ENOMEM','ENOBUFS','ETIMEDOUT','EACCES','ENOENT'];
const need=v=>{if(!v)throw Error('release_pm2_readonly_diagnostic_invalid');};
function own(v,k){try{if(!v||typeof v!=='object'||types.isProxy(v))return;const d=Object.getOwnPropertyDescriptor(v,k);return d&&Object.hasOwn(d,'value')?d.value:undefined;}catch{}}
function childMeta(v){
 if(!v||typeof v!=='object'||types.isProxy(v))return null;
 const status=own(v,'status'),signal=own(v,'signal'),error=own(v,'error'),code=own(error,'code'),stderr=own(v,'stderr'),stdout=own(v,'stdout');
 return{status:Number.isSafeInteger(status)&&status>=-1&&status<=255?status:null,signal:signal==null?null:['SIGKILL','SIGTERM'].includes(signal)?signal:'other',error:!!error,errorCode:error?SYSTEM_ERRORS.includes(code)?code:'other':null,stderrEmpty:typeof stderr==='string'?stderr==='':null,stdoutBytes:typeof stdout==='string'?Buffer.byteLength(stdout):null};
}
function copy(v,depth=0){
 need(depth<=6);if(v===null||typeof v==='boolean'||Number.isSafeInteger(v))return v;if(typeof v==='string'){need(v.length<=256);return v;}
 need(v&&typeof v==='object'&&!types.isProxy(v));const d=Object.getOwnPropertyDescriptors(v);
 if(Array.isArray(v)){need(Object.getPrototypeOf(v)===Array.prototype&&v.length<=16&&Reflect.ownKeys(d).length===v.length+1);return Array.from({length:v.length},(_,i)=>{need(d[i]?.enumerable&&Object.hasOwn(d[i],'value'));return copy(d[i].value,depth+1);});}
 need([Object.prototype,null].includes(Object.getPrototypeOf(v))&&Reflect.ownKeys(d).length<=12);
 return Object.fromEntries(Reflect.ownKeys(d).map(k=>{need(typeof k==='string'&&d[k].enumerable&&Object.hasOwn(d[k],'value'));return[k,copy(d[k].value,depth+1)];}));
}
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
export function readReleasePm2FailureDiagnostic(error){try{
 const raw=own(error,'releasePm2FailureDiagnostic');if(!raw)return null;const d=copy(raw);
 need(exact(d,['version','kind','operation','lastIo','changedFields','ioFailure','child','automaticRetryAllowed'])&&d.version===1&&d.kind==='release-pm2-readonly-refusal'&&OPERATIONS.includes(d.operation)&&IOS.includes(d.lastIo)&&ERRORS.includes(d.ioFailure)&&d.automaticRetryAllowed===false);
 need(Array.isArray(d.changedFields)&&d.changedFields.length<=FIELDS.length&&new Set(d.changedFields).size===d.changedFields.length&&d.changedFields.every(k=>FIELDS.includes(k)));
 const c=d.child;if(c!==null)need(exact(c,['status','signal','error','errorCode','stderrEmpty','stdoutBytes'])&&(c.status===null||Number.isSafeInteger(c.status)&&c.status>=-1&&c.status<=255)&&[null,'SIGKILL','SIGTERM','other'].includes(c.signal)&&typeof c.error==='boolean'&&[null,'other',...SYSTEM_ERRORS].includes(c.errorCode)&&[null,true,false].includes(c.stderrEmpty)&&(c.stdoutBytes===null||Number.isSafeInteger(c.stdoutBytes)&&c.stdoutBytes>=0));return d;
}catch{return null;}}

// Pure composition seam, not a host capability. Production callers below have
// no IO parameter and always use the fixed real functions and original guards.
export async function executeObservedReadOnlyPm2({operation,perform,io}){
 need(OPERATIONS.includes(operation)&&typeof perform==='function');let lastIo='start',previous=null,changedFields=[],ioFailure='none',child=null;
 const call=(name,fn,args)=>{lastIo=name;try{return fn(...args);}catch(error){const message=own(error,'message');ioFailure=ERRORS.includes(message)?message:'transport-exception';throw error;}};
 const overrides={
  readProcess:pid=>{const fact=call('process-read',io.readProcess,[pid]);const current=Object.fromEntries(FIELDS.map(k=>[k,own(fact,k)]));if(previous)changedFields=[...new Set([...changedFields,...FIELDS.filter(k=>current[k]!==previous[k])])];previous=current;return fact;},
  python:()=>call('python-capture',io.python,[]),verifyPython:proof=>call('python-verify',io.verifyPython,[proof]),
  invoke:(python,payload)=>{need(operation==='registry-read'&&payload?.request===null);const result=call('registry-exchange',io.invoke,[python,payload]);child=childMeta(result);return result;},
  invokeDump:(python,payload)=>{need(operation!=='registry-read'&&payload?.request?.action===operation.slice(5));const result=call('dump-exchange',io.invokeDump,[python,payload]);child=childMeta(result);return result;}
 };
 try{return await perform(overrides);}catch(error){
  const evidence=Object.freeze({version:1,kind:'release-pm2-readonly-refusal',operation,lastIo,changedFields,ioFailure,child,automaticRetryAllowed:false});
  try{Object.defineProperty(error,'releasePm2FailureDiagnostic',{value:evidence});}catch{/* Keep the SAME original error and no retry. */}throw error;
 }
}
async function actualIo(){
 need(process.platform==='linux'&&process.getuid?.()===0&&process.execPath==='/usr/bin/node'&&process.version==='v20.20.1'&&process.argv[1]&&process.argv[1]!=='-'&&/^file:\/\/\/var\/lib\/faolla-online-code\/[a-f0-9]{40}\/scripts\/release-toolchain-pm2-readonly-diagnostic\.mjs$/.test(import.meta.url));
 const{captureProcessFact}=await import('./check-production-runtime-supervision.mjs');
 const invoke=(python,payload,dump)=>{
  // These arguments and limits are identical to the shared read-only invokes.
  need(dump?['capture','verify'].includes(payload.request?.action):payload.request===null);
  return spawnSync(python.target.path,['-I','-S','-B','-c',dump?PM2_DUMP_BRIDGE_SOURCE:PM2_CONTROL_BRIDGE_SOURCE,fileURLToPath(new URL(dump?'./production-maintenance-pm2-dump.py':'./production-maintenance-pm2-control.py',import.meta.url))],{input:JSON.stringify(payload),encoding:'utf8',timeout:dump?20000:7000,killSignal:'SIGKILL',maxBuffer:524288,shell:false,windowsHide:true,cwd:'/',env:{PATH:'/usr/bin:/bin',LANG:'C',LC_ALL:'C'},stdio:['pipe','pipe','pipe']});
 };
 return{readProcess:captureProcessFact,python:captureTrustedPython,verifyPython:verifyTrustedPython,invoke:(p,v)=>invoke(p,v,false),invokeDump:(p,v)=>invoke(p,v,true)};
}
export async function inspectReleasePm2Registry(daemon,bootId){need(arguments.length===2);return executeObservedReadOnlyPm2({operation:'registry-read',io:await actualIo(),perform:overrides=>inspectPm2Registry(daemon,bootId,overrides)});}
export async function captureReleasePm2DumpTarget(daemon,bootId){need(arguments.length===2);return executeObservedReadOnlyPm2({operation:'dump-capture',io:await actualIo(),perform:overrides=>capturePm2DumpTarget(daemon,bootId,overrides)});}
export async function verifyReleasePm2Dump(daemon,bootId,registry,receipt){need(arguments.length===4);return executeObservedReadOnlyPm2({operation:'dump-verify',io:await actualIo(),perform:overrides=>verifyPm2Dump(daemon,bootId,registry,receipt,overrides)});}
