// Independent, exact recorded-schema compatibility. The original v1 policy is
// unchanged and still rejects these files when invoked directly.
import {isDeepStrictEqual} from 'node:util';
import {applicationReleaseRole,applicationReleaseChanges,applicationReleaseHash,createApplicationReleaseManifest as createV1,
  assertApplicationReleaseManifest as assertV1} from './application-release-policy.mjs';
export * from './application-release-policy.mjs';
export {assertRecordedSchemaDatabase} from './application-release-recorded-schema.mjs';

export const RECORDED_APPLICATION_SCHEMA=Object.freeze({
 kind:'already-applied-booking-safeupdate-v1',version:'202611050213',
 revision:'ba27e903ba13f8e9f17be357da4412c1fe5792d6',
 migrationSha256:'92c413c5877bcf09b45c83085ef637a9377ef4dd10dd4e830a46f7e28f42a769',
 audit:'41985686554-1',functionBodyMd5:'09fa13e69856221d61b6eaa544927b2a',
 databaseExecution:'forbidden',
});
const blob=oid=>['100644',oid];
export const RECORDED_APPLICATION_ARTIFACTS=Object.freeze([
 {file:'scripts/booking-atomic-postgres-acceptance.mjs',role:'recorded-verification',before:blob('78ecb2093aa34339c872eddb6e4dd22306288d28'),after:blob('500f715e035ef885c495939df6d4d84967f00763')},
 {file:'scripts/booking-safeupdate-online-workflow.mjs',role:'recorded-migration-tool',before:null,after:blob('41ea33ab6bb73eb519ca62a5e682242058db546b')},
 {file:'scripts/booking-safeupdate-online.mjs',role:'recorded-migration-tool',before:null,after:blob('d11f04aa2d878a5deb26cb5f25a9143cc37b5c04')},
 {file:'scripts/supabase-migrations/202611050213_booking_atomic_safeupdate_singleton.sql',role:'already-applied-schema',before:null,after:blob('67873fc5b12b853e70a6b16bdabbd861f65d6561')},
 // This new module is a pure saved-geography lookup in the website GET route.
 // It neither imports nor changes any immutable booking worker entrypoint.
 {file:'src/lib/merchantBookingTimeZoneLocation.server.ts',role:'website-only-location-default',before:null,after:blob('841b9618a41aedfa984413b3407d76049ae25302')},
]);
const byFile=new Map(RECORDED_APPLICATION_ARTIFACTS.map(row=>[row.file,row]));
const need=(value,reason)=>{if(!value)throw Error('application_compatibility_'+reason);};
function rowsIndex(rows){
 need(Array.isArray(rows)&&rows.length>0,'inventory');const map=new Map();
 for(const row of rows){need(row&&/^[a-f0-9]{40}$/.test(row.oid)&&['100644','100755'].includes(row.mode)&&!map.has(row.file),'inventory');map.set(row.file,row);}
 return map;
}
function compatibilityChanges(baselineRows,targetRows){
 const before=rowsIndex(baselineRows),after=rowsIndex(targetRows);
 const changes=[...new Set([...before.keys(),...after.keys()])].sort().flatMap(file=>{
  if(file==='release/application-release.json')return[];
  const a=before.get(file),b=after.get(file),prior=a?[a.mode,a.oid]:null,next=b?[b.mode,b.oid]:null;
  if(isDeepStrictEqual(prior,next))return[];
  const record=byFile.get(file);
  if(record){need(isDeepStrictEqual(prior,record.before)&&isDeepStrictEqual(next,record.after),'artifact_changed');return[{file,role:record.role,before:prior,after:next}];}
  return[{file,role:applicationReleaseRole(file),before:prior,after:next}];
 });
 return changes;
}
const project=rows=>rows.filter(row=>!byFile.has(row.file));
function assertRecordedTargets(targetRows){
 const after=rowsIndex(targetRows);
 for(const record of RECORDED_APPLICATION_ARTIFACTS.filter(row=>row.role!=='website-only-location-default')){
  const row=after.get(record.file);need(row&&isDeepStrictEqual([row.mode,row.oid],record.after),'recorded_source_missing');
 }
}
export function createApplicationReleaseManifest(input){
 const changes=compatibilityChanges(input.baselineRows,input.targetRows);
 if(!changes.some(row=>byFile.has(row.file)))return createV1(input);
 const original=createV1({...input,baselineRows:project(input.baselineRows),targetRows:project(input.targetRows)});
 const manifest={...original,schemaVersion:2,changes,recordedSchema:{...RECORDED_APPLICATION_SCHEMA}};
 assertApplicationReleaseManifest(manifest,input);return manifest;
}
export function assertApplicationReleaseManifest(value,input){
 if(value?.schemaVersion!==2&&value?.recordedSchema===undefined)return assertV1(value,input);
 need(value?.schemaVersion===2&&isDeepStrictEqual(value.recordedSchema,RECORDED_APPLICATION_SCHEMA),'descriptor');
 const plain={...value};delete plain.recordedSchema;
 const projected={...input,baselineRows:project(input.baselineRows),targetRows:project(input.targetRows)};
 const proof=assertV1({...plain,schemaVersion:1,changes:applicationReleaseChanges(projected.baselineRows,projected.targetRows)},projected);
 const changes=compatibilityChanges(input.baselineRows,input.targetRows);
 need(changes.some(row=>byFile.has(row.file))&&isDeepStrictEqual(changes,value.changes),'scope_changed');
 assertRecordedTargets(input.targetRows);
 return{...proof,manifestSha256:applicationReleaseHash(value),changedPaths:changes.length,
  applicationPaths:changes.filter(row=>['application','website-only-location-default'].includes(row.role)).map(row=>row.file),
  recordedSchemaVerified:true};
}
