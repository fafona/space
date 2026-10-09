// Pure/static and failure-cleanup tests only; these are NOT SQL acceptance.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {operationalSourceNativeDocuments,operationalSourceNativeIds,operationalSourceOldRowsSql,verifyOperationalSourceNative} from './attendance-operational-source-native.mjs';
const require=createRequire(import.meta.url),source=readFileSync(new URL('./attendance-operational-source-native.mjs',import.meta.url),'utf8');
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const scopes=[{kind:'enterprise'},{kind:'group',groupId:operationalSourceNativeIds.groups[0]},
 {kind:'personal',workerId:id(10),employeeId:id(11),employeeAuthUserId:id(12)}];

test('241 inert fixture exports only caller-owned execution and bounded distinct identifiers',()=>{
 assert.equal(typeof verifyOperationalSourceNative,'function');
 const ids=[...operationalSourceNativeIds.groups,...operationalSourceNativeIds.assignments];
 assert.equal(new Set(ids).size,7);assert(ids.every(x=>/^00000000-0000-4000-8000-0002416[0-9]{5}$/.test(x)));
 assert.doesNotMatch(source,/spawn\(|listen\(|chromium|initdb|pg_ctl|disable trigger|session_replication_role|commit;/i);
});

test('241 documents use the actual eight-field parser and different priority witnesses',()=>{
 const {parseOperationalRules,resolveOperationalRules}=require('../../src/lib/merchantAttendanceOperationalRules.ts');
 const docs=operationalSourceNativeDocuments(id(1),id(2),id(3));
 for(const d of docs)assert.deepEqual(parseOperationalRules(d),d);
 const common={enterprise:docs[0],group:docs[1],personal:docs[2],baselineCorrectionWindowDays:5};
 const all=resolveOperationalRules(common);assert.deepEqual(all.fields.timesheetCycle.value,{kind:'manual'});
 assert.equal(all.fields.correctionWindow.constrainedDays,5);assert.deepEqual(all.fields.locationScope.value,[id(1)]);
 assert.deepEqual(resolveOperationalRules({...common,personal:null}).fields.timesheetCycle.value,{kind:'monthly'});
 assert.deepEqual(resolveOperationalRules({...common,group:null,personal:null}).fields.timesheetCycle.value,{kind:'weekly',weekStartsOn:1});
 assert.equal(all.applied,false);assert.equal(all.authorityChecked,false);assert.equal(all.candidateOnly,true);
});

test('241 cross-zone witness has nonoverlapping civil dates but truly overlapping UTC intervals',()=>{
 const {attendanceDayUtcRange}=require('../../src/lib/merchantAttendanceTime.ts');
 const west=attendanceDayUtcRange('2030-01-10','Pacific/Pago_Pago');
 const east=attendanceDayUtcRange('2030-01-11','Pacific/Kiritimati');
 const at=Date.parse('2030-01-11T00:00:00.000Z');
 for(const value of [west,east])assert(Date.parse(value.startAt)<=at&&at<Date.parse(value.endAt));
 assert.equal(west.endAt,'2030-01-11T11:00:00.000Z');assert.equal(east.startAt,'2030-01-10T10:00:00.000Z');
 assert(source.includes("await setZone('Pacific/Pago_Pago')"));assert(source.includes("await setZone('Pacific/Kiritimati')"));
 assert(source.includes("'two_saved_zones_ambiguous'"));assert(source.includes("'attendance_operational_source_ambiguous'"));
});

test('241 original-row guard excludes only new exact group IDs and three new ledger scopes',()=>{
 const names=['merchants','faolla_schema_migrations','merchant_attendance_workers','merchant_attendance_groups',
  'merchant_attendance_group_assignment_operations','merchant_attendance_operational_rule_streams','merchant_attendance_operational_rule_publications'];
 const sql=operationalSourceOldRowsSql(names,'99990001',scopes);
 assert(sql.includes('from public.merchants r)'));assert(!sql.includes('public.merchants r where'));
 assert(!sql.includes('public.merchant_attendance_workers r where'));
 assert(sql.includes("r.merchant_id='99990001' and (r.group_id in"));
 assert(sql.includes('r.assignment_id in'));assert(sql.includes('r.stream_key in'));
 for(const group of operationalSourceNativeIds.groups)assert(sql.includes(group));
 assert(sql.includes('is not distinct from r.scope'));
 assert.throws(()=>operationalSourceOldRowsSql(['unsafe;delete'], '99990001',scopes));
 const masked=operationalSourceOldRowsSql(['merchant_attendance_workers'],'99990001',scopes,
  {merchant_attendance_workers:{where:"r.merchant_id='99990001' and r.id='"+id(10)+"'",columns:['employee_id','version']}});
 assert(masked.includes("then to_jsonb(r)-array['employee_id','version'] else to_jsonb(r) end"));
});

test('241 normal writes use actual124 and191 services, private reads use actual getter with full zero-write hash',()=>{
 assert(source.includes('executeOperationalRuleLedger'));assert(source.includes('executeGroups'));
 assert(source.includes('faolla_attendance_operational_source_v1('));assert(source.includes("{role:'postgres'}"));
 assert(source.includes('parseOperationalRuleSource(r.value,expected)'));assert(source.includes('resolveOperationalRuleSource(r.value,expected)'));
 assert(source.includes('operational_source_RPC_changed_old_rows'));assert(source.includes('operational_source_read_or_reject_changed_facts'));
 assert(source.includes("'private_service_EXECUTE'"));assert(source.includes("assert.equal(acl.sqlstate,'42501')"));
 assert.doesNotMatch(source,/insert into public\.merchant_attendance_(?:events|operational_rule_operations|group_assignment_operations)/);
 assert(source.includes('declare b text;o text;rpc_value jsonb;'));
 assert.doesNotMatch(source,/declare b text;o text;r jsonb;/);
});

test('241 old nullable assignment uses real RPC and exact savepoint restoration, not altered saved evidence',()=>{
 assert(source.includes('employee_id=null,version=version+1'));assert(source.includes('legacy.detail.employeeId,null'));
 assert(source.includes("'legacy_assignment_not_fallback'"));assert(source.includes("restore('ops241_identity',oldIdentity)"));
 assert(source.includes("restore('ops241_zones',zones)"));
 assert.doesNotMatch(source,/update public\.merchant_attendance_group_(?:assignment_operations|assignments)/);
 assert(source.includes('settingsZoneUpdates:2,workerBindingUpdates:2'));assert(source.includes('actualAuthenticatedGetter:false'));
});

test('241 lifecycle keeps the explicit90s/120steps/10sSQL bounds and archive bytes after finally cleanup',()=>{
 assert(source.includes('native.connect({lifetimeMs:90000})'));assert(source.includes('assert(++steps<=120'));
 assert(source.includes("set local lock_timeout='3s';set local statement_timeout='10s'"));
 assert(source.includes("if(!rolledBack)await connection.step('rollback;')"));assert(source.includes('await connection.close()'));
 assert(source.includes('d.fingerprint(),baseline'));assert(source.includes('d.definitions(),definitions'));assert(source.includes('d.tableCatalog(),catalog'));
 assert(source.includes('periodContinuationArchiveBytes(await archive()),savedArchive'));
 assert(source.includes('periodContinuationArchiveBytes(await periodArchive()),savedPeriod'));
 assert(source.includes('lastStepFailure=String(error?.stack??error).slice(0,12000)'));
});

test('241 rejects a non-owned context before any runtime method',async()=>{
 let touched=false;await assert.rejects(verifyOperationalSourceNative({d:{syntheticOnly:false},h:{syntheticOnly:true},native:{connect(){touched=true;}}}),/owned_synthetic/);
 assert.equal(touched,false);
});

test('241 mocked first SQL failure still rolls back and closes before external fingerprints, without a DB',async()=>{
 const owned={schema:'attendance_race_'+'a'.repeat(32),oid:42,tableOid:43,owner:'postgres',marker:'faolla-synthetic-concurrency:00000000-0000-4000-8000-000000000001'};
 const body='{}',a={artifactText:body,artifactBytes:2,artifactSha256:createHash('sha256').update(body).digest('hex'),artifact:{}};
 const calls=[];let opened=false,closed=false,hashCalls=0;
 const d={syntheticOnly:true,owned,site:'99990001',owner:id(1),guard:'',inventory:()=>['merchants'],
  fingerprint:()=>{hashCalls++;if(opened)assert(closed,'external fingerprint must not run while transaction owns locks');return 'same';},definitions:()=> 'defs',tableCatalog:()=> 'catalog'};
 const native={query:()=>JSON.stringify(owned),connect:options=>{assert.deepEqual(options,{lifetimeMs:90000});opened=true;return {
  step:async sql=>{calls.push(sql);if(sql==='rollback;')return '';throw new Error('synthetic241_step_failure');},close:async()=>{closed=true;}};}};
 await assert.rejects(verifyOperationalSourceNative({d,h:{syntheticOnly:true,workerId:id(10),employeeId:id(11),employeeAuthUserId:id(12)},native,
  scope:{schema:owned.schema,sql:s=>s},archive:async()=>a,periodArchive:async()=>a}),/synthetic241_step_failure/);
 assert.equal(calls.length,2);assert(calls[0].startsWith('begin;'));assert.equal(calls[1],'rollback;');assert(closed);assert.equal(hashCalls,2);
});
