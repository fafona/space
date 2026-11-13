// Exact source-admission adapter only. It grants no execution or worker control.
// The immutable worker's original application-release-policy stays unchanged.
import {isDeepStrictEqual} from 'node:util';
import {applicationReleaseHash} from './application-release-policy.mjs';

export const APPLICATION_VERIFICATION_FILE=Object.freeze({
 kind:'auth-build-verifier-only-v1',file:'scripts/check-auth-middleware-build.mjs',role:'verification',
});
const need=(value,reason)=>{if(!value)throw Error('application_verification_'+reason);};
const project=rows=>rows.filter(row=>row.file!==APPLICATION_VERIFICATION_FILE.file);
const projected=input=>({...input,baselineRows:project(input.baselineRows),targetRows:project(input.targetRows)});
function artifact(rows){
 need(Array.isArray(rows)&&rows.length>0,'inventory');
 const seen=new Set();let found;
 for(const row of rows){
  need(row&&typeof row.file==='string'&&!seen.has(row.file)&&/^[a-f0-9]{40}$/.test(row.oid)&&
   ['100644','100755'].includes(row.mode),'inventory');
  seen.add(row.file);if(row.file===APPLICATION_VERIFICATION_FILE.file)found=row;
 }
 return found;
}
function verificationChange(input){
 const a=artifact(input.baselineRows),b=artifact(input.targetRows);
 if(isDeepStrictEqual(a,b))return null;
 // This authorization covers only modification of the existing regular file,
 // not new/deleted verifiers, executable mode changes or adjacent scripts.
 need(a?.mode==='100644'&&b?.mode==='100644'&&a.oid!==b.oid,'source_shape');
 return{file:APPLICATION_VERIFICATION_FILE.file,role:'verification',before:[a.mode,a.oid],after:[b.mode,b.oid]};
}
const changes=(base,change)=>[...base.changes,change].sort((a,b)=>a.file<b.file?-1:a.file>b.file?1:0);

export function createVerificationApplicationManifest(input,createBase,assertBase){
 const change=verificationChange(input);
 if(!change)return createBase(input);
 const base=createBase(projected(input));
 const value={...base,schemaVersion:4,verificationBaseSchemaVersion:base.schemaVersion,
  verificationFile:{...APPLICATION_VERIFICATION_FILE},changes:changes(base,change)};
 assertVerificationApplicationManifest(value,input,createBase,assertBase);return value;
}
export function assertVerificationApplicationManifest(value,input,createBase,assertBase){
 if(value?.schemaVersion!==4&&value?.verificationFile===undefined&&value?.verificationBaseSchemaVersion===undefined)return assertBase(value,input);
 need(value?.schemaVersion===4&&[1,2,3].includes(value.verificationBaseSchemaVersion)&&
  isDeepStrictEqual(value.verificationFile,APPLICATION_VERIFICATION_FILE),'descriptor');
 const change=verificationChange(input);need(change,'unchanged_source');
 const selected=projected(input);
 const base=createBase({...selected,purpose:value.purpose,focusedTests:value.focusedTests});
 need(value.verificationBaseSchemaVersion===base.schemaVersion&&isDeepStrictEqual(value.changes,changes(base,change)),'scope_changed');
 const plain={...value,schemaVersion:value.verificationBaseSchemaVersion,changes:base.changes};
 delete plain.verificationBaseSchemaVersion;delete plain.verificationFile;
 const proof=assertBase(plain,selected);
 return{...proof,manifestSha256:applicationReleaseHash(value),changedPaths:value.changes.length,verificationFileVerified:true};
}
