// Versioned data contracts. These validate evidence; they never grant deployment.
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';

export const TOOLCHAIN_SCHEMA=1;
export const BUILD_MEMORY_FLOOR=6*1024**3;
export const TOOLCHAIN_STAGES=Object.freeze(['source','bundle','environment','backup','compatibility','candidate','rehearsal','admission','switch','verify']);
export const TOOLCHAIN_CODES=Object.freeze(['invalid_contract','invalid_fingerprint','fingerprint_scheme_mismatch','fingerprint_mismatch','invalid_path',
 'invalid_bundle','bundle_missing_file','bundle_extra_file','bundle_bytes_changed','bundle_resource_missing','bundle_import_unsupported',
 'source_changed','scope_changed','database_identity_mismatch','backup_source_mismatch','backup_database_mismatch','evidence_stale','evidence_invalid',
 'build_memory_insufficient','isolation_memory_insufficient','disk_insufficient','build_binding_mismatch','unsupported_runtime','journal_invalid','journal_busy','attempt_unknown',
 'attempt_replay_forbidden','observation_mismatch','network_policy_changed','operation_unconfirmed','ingress_not_drained','ingress_clock_invalid','gate_not_confirmed','owned_resource_changed','cleanup_unconfirmed']);
export class ToolchainError extends Error{
 constructor(code){if(!TOOLCHAIN_CODES.includes(code))code='operation_unconfirmed';super('release_toolchain_'+code);this.name='ToolchainError';this.code=code;}
}
export const requireToolchain=(condition,code='invalid_contract')=>{if(!condition)throw new ToolchainError(code);};
const plain=v=>v!==null&&typeof v==='object'&&[Object.prototype,null].includes(Object.getPrototypeOf(v));
export function exactKeys(v,keys){requireToolchain(plain(v)&&isDeepStrictEqual(Object.keys(v).sort(),[...keys].sort()));}
export function canonicalJson(value){
 const seen=new Set();function visit(v,depth=0){requireToolchain(depth<=64);
  if(v===null||typeof v==='boolean'||typeof v==='string')return v;
  if(typeof v==='number'){requireToolchain(Number.isFinite(v));return v;}
  requireToolchain(typeof v==='object'&&!seen.has(v));seen.add(v);let result;
  if(Array.isArray(v)){requireToolchain(Object.keys(v).length===v.length);result=Array.from({length:v.length},(_,i)=>{
   const d=Object.getOwnPropertyDescriptor(v,String(i));requireToolchain(d&&Object.hasOwn(d,'value'));return visit(d.value,depth+1);});}
  else{requireToolchain(plain(v));result=Object.create(null);for(const key of Object.keys(v).sort()){
   requireToolchain(!['__proto__','constructor','prototype'].includes(key));const d=Object.getOwnPropertyDescriptor(v,key);
   requireToolchain(d&&Object.hasOwn(d,'value'));result[key]=visit(d.value,depth+1);
  }}seen.delete(v);return result;
 }return JSON.stringify(visit(value));
}
export const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
export const FINGERPRINT_DOMAINS=Object.freeze(['application-source','application-dependencies','application-migrations','application-build','tool-bundle','backup-archive','release-policy','evidence']);
export function fingerprint(domain,value,representation='bytes-v1'){
 requireToolchain(FINGERPRINT_DOMAINS.includes(domain)&&['bytes-v1','canonical-json-v1'].includes(representation),'invalid_fingerprint');
 const bytes=representation==='canonical-json-v1'?canonicalJson(value):value;
 requireToolchain(typeof bytes==='string'||Buffer.isBuffer(bytes),'invalid_fingerprint');
 return {schemaVersion:TOOLCHAIN_SCHEMA,algorithm:'sha256',domain,representation,value:sha256(bytes)};
}
export function assertFingerprint(v,domain){
 exactKeys(v,['schemaVersion','algorithm','domain','representation','value']);
 requireToolchain(v.schemaVersion===1&&v.algorithm==='sha256'&&FINGERPRINT_DOMAINS.includes(v.domain)&&(!domain||v.domain===domain)&&
 ['bytes-v1','canonical-json-v1'].includes(v.representation)&&/^[a-f0-9]{64}$/.test(v.value??''),'invalid_fingerprint');return v;
}
export function compareFingerprint(a,b,domain){
 assertFingerprint(a,domain);assertFingerprint(b,domain);
 requireToolchain(a.domain===b.domain&&a.representation===b.representation&&a.algorithm===b.algorithm,'fingerprint_scheme_mismatch');
 requireToolchain(a.value===b.value,'fingerprint_mismatch');return true;
}
export function safeRelativePath(v){
 requireToolchain(typeof v==='string'&&v.length>0&&v.length<=300&&/^[A-Za-z0-9_./-]+$/.test(v)&&!v.startsWith('/')&&
 !v.includes('//')&&v.split('/').every(p=>p!=='.'&&p!=='..'&&p!==''&&!p.endsWith('.')&&!/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p)),'invalid_path');return v;
}
const appFields={source:'application-source',dependencies:'application-dependencies',migrations:'application-migrations'};
export function assertApplication(v){
 exactKeys(v,['revision',...Object.keys(appFields)]);requireToolchain(/^[a-f0-9]{40}$/.test(v.revision??''));
 for(const [key,domain]of Object.entries(appFields))assertFingerprint(v[key],domain);return v;
}
export function compareApplication(a,b){assertApplication(a);assertApplication(b);requireToolchain(a.revision===b.revision,'source_changed');
 for(const [key,domain]of Object.entries(appFields))compareFingerprint(a[key],b[key],domain);return true;}
export function assertBuiltArtifact(v,application){
 exactKeys(v,['application','artifact','verified']);requireToolchain(v.verified===true,'build_binding_mismatch');compareApplication(v.application,application);assertFingerprint(v.artifact,'application-build');return v;
}
export function toolOnlyRepairDecision(before,after){
 exactKeys(before,['application','build','tool']);exactKeys(after,['application','build','tool']);compareApplication(before.application,after.application);
 assertBuiltArtifact(before.build,before.application);assertBuiltArtifact(after.build,after.application);compareFingerprint(before.build.artifact,after.build.artifact,'application-build');
 for(const value of [before.tool,after.tool]){exactKeys(value,['revision','bundle']);requireToolchain(/^[a-f0-9]{40}$/.test(value.revision??''));assertFingerprint(value.bundle,'tool-bundle');}
 return {applicationUnchanged:true,applicationRebuildRequired:false,toolChanged:canonicalJson(before.tool)!==canonicalJson(after.tool),fullRevalidationRequired:true};
}
export function assertDatabase(v){
 exactKeys(v,['environment','containerId','image','dataSource','systemIdentifier','databaseOid','serverVersionNum']);
 requireToolchain(['production','isolated'].includes(v.environment)&&/^[a-f0-9]{64}$/.test(v.containerId??'')&&/^sha256:[a-f0-9]{64}$/.test(v.image??'')&&
 /^\/[A-Za-z0-9_/-]+$/.test(v.dataSource??'')&&!v.dataSource.split('/').includes('..')&&v.dataSource.split('/').filter(Boolean).length>=3&&
 /^[1-9][0-9]{0,19}$/.test(v.systemIdentifier??'')&&/^[1-9][0-9]{0,9}$/.test(v.databaseOid??'')&&/^[1-9][0-9]{5}$/.test(v.serverVersionNum??''),'database_identity_mismatch');return v;
}
export function compareDatabase(a,b){assertDatabase(a);assertDatabase(b);requireToolchain(isDeepStrictEqual(a,b),'database_identity_mismatch');return true;}
export function assertFreshEvidence(v,{nowMs,maxAgeMs}){
 requireToolchain(Number.isSafeInteger(nowMs)&&Number.isSafeInteger(maxAgeMs)&&maxAgeMs>0,'evidence_invalid');
 for(const key of ['createdAt','expiresAt'])requireToolchain(typeof v?.[key]==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v[key])&&Number.isFinite(Date.parse(v[key]))&&new Date(v[key]).toISOString()===v[key],'evidence_invalid');
 const created=Date.parse(v.createdAt),expires=Date.parse(v.expiresAt);
 requireToolchain(created<=nowMs&&nowMs<expires&&expires>created&&nowMs-created<=maxAgeMs,'evidence_stale');return true;
}
export function assertBackupBinding(v,{application,database,nowMs,maxAgeMs}){
 exactKeys(v,['kind','application','database','archive','verified','createdAt','expiresAt']);
 requireToolchain(v.kind==='verified-database-backup'&&v.verified===true,'evidence_invalid');
 try{compareApplication(v.application,application);}catch{throw new ToolchainError('backup_source_mismatch');}
 try{compareDatabase(v.database,database);}catch{throw new ToolchainError('backup_database_mismatch');}
 assertFingerprint(v.archive,'backup-archive');assertFreshEvidence(v,{nowMs,maxAgeMs});return true;
}
export function publicFailure(error,{stage}){
 requireToolchain(TOOLCHAIN_STAGES.includes(stage));let code='operation_unconfirmed';
 try{const d=Object.getOwnPropertyDescriptor(error,'code');if(error instanceof ToolchainError&&d&&Object.hasOwn(d,'value')&&TOOLCHAIN_CODES.includes(d.value))code=d.value;}catch{/* No arbitrary exception text, getters or proxy traps. */}
 return {schemaVersion:1,kind:'release-toolchain-failure',stage,code,detailsRedacted:true};
}
