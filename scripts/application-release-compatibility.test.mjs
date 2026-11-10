import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createApplicationReleaseManifest as oldCreate,assertApplicationReleaseManifest as oldAssert,applicationReleaseRole} from './application-release-policy.mjs';
import {RECORDED_APPLICATION_ARTIFACTS as records,createApplicationReleaseManifest,assertApplicationReleaseManifest} from './application-release-compatibility.mjs';
import {assertRecordedSchemaObservation,recordedSchemaReadOnlySql} from './application-release-recorded-schema.mjs';
const oid='a'.repeat(40),next='b'.repeat(40),base='c'.repeat(40);
const row=(file,value=oid)=>({file,mode:'100644',oid:value});
function fixture(){
 return {baseline:base,purpose:'Publish reviewed website repairs without replaying recorded SQL',focusedTests:['src/example.test.ts'],
  baselineRows:[row('src/example.ts'),row('src/example.test.ts'),...records.filter(r=>r.before).map(r=>({file:r.file,mode:r.before[0],oid:r.before[1]}))],
  targetRows:[row('src/example.ts',next),row('src/example.test.ts',next),...records.map(r=>({file:r.file,mode:r.after[0],oid:r.after[1]}))]};
}
test('independent compatibility binds every exact historical blob while original v1 continues rejecting it',()=>{
 const input=fixture(),value=createApplicationReleaseManifest(input),proof=assertApplicationReleaseManifest(value,input);
 assert.equal(value.schemaVersion,2);assert.equal(proof.recordedSchemaVerified,true);
 assert.equal(value.changes.filter(r=>r.role==='already-applied-schema').length,1);
 assert.ok(proof.applicationPaths.includes('src/lib/merchantBookingTimeZoneLocation.server.ts'));
 assert.throws(()=>oldCreate(input));assert.throws(()=>oldAssert(value,input));
 for(const r of records.slice(0,4))assert.throws(()=>applicationReleaseRole(r.file));
});
test('unknown SQL, missing historical source, edited blob/mode, removals and extra metadata remain forbidden',()=>{
 const input=fixture(),manifest=createApplicationReleaseManifest(input);
 for(const mutate of [
  x=>x.targetRows.push(row('scripts/supabase-migrations/202611110214_new.sql')),
  x=>x.targetRows.find(r=>r.file===records[0].file).oid=next,
  x=>x.targetRows.find(r=>r.file===records[1].file).mode='100755',
  x=>x.targetRows.splice(x.targetRows.findIndex(r=>r.file===records[3].file),1),
  x=>x.targetRows.push(row('src/lib/merchantBookingDangerous.server.ts')),
  x=>x.targetRows.push({...x.targetRows[0]}),
 ]){const changed=structuredClone(input);mutate(changed);assert.throws(()=>createApplicationReleaseManifest(changed));}
 for(const mutate of [v=>v.recordedSchema.databaseExecution='allow',v=>v.recordedSchema.version='214',v=>v.changes.pop(),v=>v.extra=true,v=>v.schemaVersion=1]){
  const value=structuredClone(manifest);mutate(value);assert.throws(()=>assertApplicationReleaseManifest(value,input));
 }
});
test('ordinary v1 behavior is unchanged when no exceptional artifact differs',()=>{
 const input={baseline:base,purpose:'An ordinary compatible website correction',focusedTests:['src/example.test.ts'],baselineRows:[row('src/example.ts'),row('src/example.test.ts')],targetRows:[row('src/example.ts',next),row('src/example.test.ts',next)]};
 assert.deepEqual(createApplicationReleaseManifest(input),oldCreate(input));
 const server={...input,targetRows:[...input.targetRows,row('src/lib/merchantBookingTimeZoneLocation.server.ts',records.at(-1).after[1])]};
 assert.throws(()=>oldCreate(server),/worker_runtime_change/);
});
function observation(){
 const fn={oid:111377,owner:'supabase_admin',acl:['original-private-acl'],config:['search_path=pg_catalog, public'],definer:true,bodyMd5:'09fa13e69856221d61b6eaa544927b2a'};
 const state={actor:'supabase_admin',database:'postgres',oid:'5',systemIdentifier:'7612049595342295079',serverVersionNum:'150008',function:fn,access:{anon:false,authenticated:false,service:true},
  control:{singleton:true,active:true,protocol:2,generation:'original-generation',revision:1},registry:Array.from({length:212},(_,i)=>({version:i===211?'202611050213':String(i),name:'fixture'}))};
 return{state,evidence:{before:{state:{function:{bodyMd5:'310b382802e94af2997b1b9751fab0bc'}}},
  applied:{target:'ba27e903ba13f8e9f17be357da4412c1fe5792d6',processesUnchanged:true,mailEnabled:false,transactionCheckedBookingRowsAndAcl:true,state:structuredClone(state)},
  result:{ok:true,status:'applied',executed:[{version:'202611050213',name:'booking_atomic_safeupdate_singleton',fileName:'202611050213_booking_atomic_safeupdate_singleton.sql'}]}}};
}
test('live read-only proof preserves legitimate booking revisions but rejects schema, function, ACL or identity drift',()=>{
 const {state,evidence}=observation();state.control.revision=42;
 assert.equal(assertRecordedSchemaObservation(state,evidence).databaseExecutionPerformed,false);
 for(const mutate of [v=>v.function.bodyMd5='0'.repeat(32),v=>v.function.owner='other',v=>v.function.acl=[],v=>v.access.anon=true,v=>v.registry.pop(),v=>v.control.generation='new',v=>v.control.active=false,v=>v.database='test',v=>v.systemIdentifier='wrong']){
  const value=structuredClone(state);mutate(value);assert.throws(()=>assertRecordedSchemaObservation(value,evidence));
 }
 const altered=structuredClone(evidence);altered.result.executed.push({version:'other'});assert.throws(()=>assertRecordedSchemaObservation(state,altered));
 assert.match(recordedSchemaReadOnlySql,/^begin read only;/);assert.doesNotMatch(recordedSchemaReadOnlySql,/\b(?:update|insert|delete|alter|create|drop|grant|revoke)\b/i);
});
test('recorded-schema checks are on admission, pre-switch verification and independent audit; no migrator executes',()=>{
 for(const file of ['application-release-authority.mjs','online-traffic-release.mjs','application-release-audit.mjs'])assert.match(readFileSync(new URL('./'+file,import.meta.url),'utf8'),/assertRecordedSchemaDatabase\(/);
 const source=readFileSync(new URL('./application-release-recorded-schema.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(source,/booking-safeupdate-online\.mjs|apply-production-database-migrations|execFile.*migration/);
 assert.match(source,/original_evidence_changed/);assert.match(source,/lock_timeout=2s/);assert.match(source,/statement_timeout=10s/);
});
