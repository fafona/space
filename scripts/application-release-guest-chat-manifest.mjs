// Exact outer descriptor. The original code-only, recorded-schema and worker rules stay unchanged.
import {isDeepStrictEqual} from 'node:util';
import {GUEST_SCHEMA,guestNeed as need,guestSqlBytes,guestBlob} from './application-release-guest-chat-contract.mjs';
import {applicationReleaseHash} from './application-release-policy.mjs';
const verification=new Set(['scripts/guest-chat-db-acceptance.mjs','scripts/guest-chat-db-acceptance.sql']);
const selected=row=>row.file===GUEST_SCHEMA.file||verification.has(row.file);
const project=input=>({...input,baselineRows:input.baselineRows.filter(r=>!selected(r)),targetRows:input.targetRows.filter(r=>!selected(r))});
function additions(input){
 const a=new Map(input.baselineRows.map(r=>[r.file,r])),b=new Map(input.targetRows.map(r=>[r.file,r]));
 const sql=b.get(GUEST_SCHEMA.file);need(sql?.mode==='100644'&&sql.oid===guestBlob(guestSqlBytes()),'source_blob');
 need(!a.has(GUEST_SCHEMA.file)||isDeepStrictEqual(a.get(GUEST_SCHEMA.file),sql),'historical_sql_changed');
 return [GUEST_SCHEMA.file,...verification].sort().flatMap(file=>{
  const before=a.get(file),after=b.get(file);need(after?.mode==='100644'&&/^[a-f0-9]{40}$/.test(after.oid),'verification_source');
  if(isDeepStrictEqual(before,after))return[];
  return[{file,role:file===GUEST_SCHEMA.file?'already-applied-guest-chat-schema':'verification',before:before?[before.mode,before.oid]:null,after:[after.mode,after.oid]}];
 });
}
export function guestBaseManifest(value){
 need(value?.schemaVersion===5&&[1,2,3,4].includes(value.guestBaseSchemaVersion)&&isDeepStrictEqual(value.guestSchema,GUEST_SCHEMA),'descriptor');
 const plain={...value,schemaVersion:value.guestBaseSchemaVersion,changes:value.changes.filter(r=>!selected(r))};delete plain.guestBaseSchemaVersion;delete plain.guestSchema;return plain;
}
export function createGuestManifest(input,createBase,assertBase){
 if(!input.targetRows.some(r=>r.file===GUEST_SCHEMA.file))return createBase(input);
 const base=createBase(project(input));
 const value={...base,schemaVersion:5,guestBaseSchemaVersion:base.schemaVersion,guestSchema:{...GUEST_SCHEMA},changes:[...base.changes,...additions(input)].sort((a,b)=>a.file.localeCompare(b.file,'en'))};
 // Match the original bytewise Git path ordering, not a locale's punctuation collation.
 value.changes.sort((a,b)=>a.file<b.file?-1:a.file>b.file?1:0);
 assertGuestManifest(value,input,createBase,assertBase);return value;
}
export function assertGuestManifest(value,input,createBase,assertBase){
 if(value?.schemaVersion!==5&&value?.guestSchema===undefined)return assertBase(value,input);
 const plain=guestBaseManifest(value),projected=project(input);
 const base=createBase({...projected,purpose:value.purpose,focusedTests:value.focusedTests});
 const changes=[...base.changes,...additions(input)].sort((a,b)=>a.file<b.file?-1:a.file>b.file?1:0);
 need(value.guestBaseSchemaVersion===base.schemaVersion&&isDeepStrictEqual(value.changes,changes),'scope_changed');
 const proof=assertBase(plain,projected);
 return{...proof,manifestSha256:applicationReleaseHash(value),changedPaths:value.changes.length,guestSchemaVerified:true};
}
