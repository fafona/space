// Pure transport-double evidence, not PostgreSQL or actual producer acceptance.
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createPosthocReminderEventsGuard} from './attendance-posthoc-reminder-events-native.mjs';
import {posthocRecoveryProtectedTables} from './attendance-posthoc-recovery-events-native.mjs';
import {lifecycleId as id} from '../merchant-attendance-lifecycle-native-support.mjs';
import {reminderNativeCloseAndSealCommitted} from './attendance-reminders-native.mjs';
const originalFacts='a'.repeat(32),serialization={user:'postgres',timeZone:'Europe/Madrid',dateStyle:'ISO, DMY',floatDigits:'1'};
function fixture(){
 const owned={schema:'attendance_race_'+'1'.repeat(32),oid:100,tableOid:101,owner:'postgres',marker:'faolla-synthetic-concurrency:'+id(1)};
 const state={filtered:originalFacts,fresh:true,serialization:{...serialization},administrativeArmed:true,administrativeVerified:3,administrativeVerifies:0,calls:[],
  administrative:{count:3,items:[
   {id:id(7701),siteId:'99990196',workerId:id(245700005),sequence:1,action:'clock_in',rowHash:'b'.repeat(32)},
   {id:id(7702),siteId:'99990196',workerId:id(245700005),sequence:2,action:'break_start',rowHash:'c'.repeat(32)},
   {id:id(7703),siteId:'99990196',workerId:id(245700008),sequence:1,action:'clock_in',rowHash:'d'.repeat(32)},
  ]},reminders:{eventCount:0,relationCount:0,adoptionCount:0,events:[],relations:[],adoptions:[]}};
 const d={owned,syntheticOnly:true,exec:sql=>{
  state.calls.push(sql);if(sql.startsWith('reset role;'))return JSON.stringify(owned);
  if(sql.includes("'fresh'"))return JSON.stringify({fresh:state.fresh,serialization:state.serialization});
  if(sql.includes("'administrative'"))return JSON.stringify({serialization:state.serialization,administrative:state.administrative,reminders:state.reminders});
  if(sql.startsWith('select md5(jsonb_build_object('))return state.filtered;
  throw Error('unexpected mock SQL');
 }};
 const h={syntheticOnly:true},administrativeEvents={isArmed:()=>state.administrativeArmed,verify:()=>{state.administrativeVerifies++;return state.administrativeVerified;}};
 const guard=createPosthocReminderEventsGuard({d,h,originalTables:[...posthocRecoveryProtectedTables],originalFacts,administrativeEvents});
 const commit=()=>{
  const common={siteId:'99990201',workerId:id(201900020),employeeId:id(201900021),operationId:id(201901010)};
  const eventId=id(8801);state.reminders={eventCount:1,relationCount:1,adoptionCount:1,
   events:[{...common,id:eventId,locationId:id(201900003),sequence:1,action:'clock_in',source:'web',rowHash:'e'.repeat(32)}],
   relations:[{...common,eventId,authId:id(201900022),locationId:id(201900003),sequence:1,status:'unselected',selection:null,slotId:null,slotRevision:null,
    reason:null,slotSnapshot:null,publicationSnapshot:null,cancellationSnapshot:null,rowHash:'f'.repeat(32)}],
   adoptions:[{...common,eventId,authId:id(201900022),channel:'self',slotId:null,approvalId:null,status:'unselected',reason:null,approval:null,rowHash:'1'.repeat(32)}]};
 };
 return {state,d,h,guard,commit};
}
test('fixed201 capability is inert frozen and detached-safe; rollback permits zero but committed1+1+1 requires a seal',()=>{
 const {state,guard,commit}=fixture();assert.equal(state.calls.length,0);assert(Object.isFrozen(guard));assert.equal(guard.isArmed(),false);
 const {arm,seal,verify,summary}=guard;assert.throws(seal,/once_armed/);assert.throws(verify,/requires_armed/);
 arm();assert.equal(state.administrativeVerifies,1);assert.throws(arm,/already_armed/);
 assert.deepEqual(verify(),{administrativeEvents:3,reminderEvents:0,reminderRelations:0,reminderAdoptions:0});assert.equal(summary().sealed,false);
 commit();assert.throws(verify,/exact_one_or_zero/);seal();assert.throws(seal,/once_armed/);
 assert.deepEqual(verify(),{administrativeEvents:3,reminderEvents:1,reminderRelations:1,reminderAdoptions:1});assert.equal(summary().sealed,true);
 assert.equal(summary().protectionSqlDispatches,state.calls.length);const detached=summary();detached.dispatches.length=0;assert(summary().dispatches.length>0);
});
test('arm requires previously sealed195 verification and exact fresh201 identity and full five-table union baseline',()=>{
 for(const bad of ['d','h','ownership','administrative_not_armed','administrative_not_verified','fresh','original_facts','serialization']){
  const {state,d,h,guard}=fixture();if(bad==='d')d.syntheticOnly=false;if(bad==='h')h.syntheticOnly=false;
  if(bad==='ownership')d.owned={...d.owned,oid:999};if(bad==='administrative_not_armed')state.administrativeArmed=false;
  if(bad==='administrative_not_verified')state.administrativeVerified=2;if(bad==='fresh')state.fresh=false;if(bad==='original_facts')state.filtered='e'.repeat(32);
  if(bad==='serialization')state.serialization.user='service_role';assert.throws(()=>guard.arm(),undefined,bad);assert.equal(guard.isArmed(),false);
 }
 const {state,guard}=fixture();guard.arm();const fresh=state.calls.find(q=>q.includes("'fresh'"));
 for(const value of ['99990201',id(201900020),id(201900021),id(201900022),id(201901010)])assert(fresh.includes(value));
 assert.equal(state.administrativeVerifies,1);
});
test('195 frozen footprint is revalidated at seal and both parent verifications, not excluded by tenant',()=>{
 for(const mutate of [s=>s.administrative.count=4,s=>s.administrative.items[0].rowHash='7'.repeat(32),s=>s.administrative.items[0].id=id(7777),
  s=>s.administrative.items[1].action='clock_out',s=>s.administrative.items[0].workerId=id(1)]){
  const current=fixture();current.guard.arm();current.commit();mutate(current.state);assert.throws(()=>current.guard.seal());
  const sealed=fixture();sealed.guard.arm();sealed.commit();sealed.guard.seal();mutate(sealed.state);assert.throws(()=>sealed.guard.verify());
 }
});
test('seal accepts only one true193 self no-selection event and its exact1 relation plus1 empty-adoption identity',()=>{
 const mutations=[
  s=>s.reminders.eventCount=2,s=>s.reminders.relationCount=0,s=>s.reminders.adoptionCount=2,s=>s.reminders.relations=[],
  s=>s.reminders.events[0].workerId=id(1),s=>s.reminders.events[0].employeeId=id(1),s=>s.reminders.events[0].operationId=id(201901011),
  s=>s.reminders.events[0].sequence=2,s=>s.reminders.events[0].action='clock_out',s=>s.reminders.events[0].source='kiosk',s=>s.reminders.events[0].locationId=id(1),
  s=>s.reminders.relations[0].eventId=id(999),s=>s.reminders.adoptions[0].eventId=id(999),s=>s.reminders.relations[0].authId=id(1),
  s=>s.reminders.adoptions[0].authId=id(1),s=>s.reminders.relations[0].status='linked',s=>s.reminders.relations[0].selection={slotId:id(1),revision:1},
  s=>s.reminders.relations[0].slotId=id(1),s=>s.reminders.relations[0].publicationSnapshot={},s=>s.reminders.adoptions[0].channel='location',
  s=>s.reminders.adoptions[0].status='adopted',s=>s.reminders.adoptions[0].approvalId=id(1),s=>s.reminders.adoptions[0].approval={},
  s=>s.reminders.adoptions[0].rowHash='invalid',s=>s.reminders.events[0].extra='unknown',
 ];
 for(const mutate of mutations){const {state,guard,commit}=fixture();guard.arm();commit();mutate(state);assert.throws(()=>guard.seal());assert.equal(guard.summary().sealed,false);}
});
test('all six complete immutable row hashes remain frozen, including otherwise unprojected fields and generated IDs',()=>{
 for(const mutate of [
  s=>s.reminders.events[0].rowHash='2'.repeat(32),s=>s.reminders.relations[0].rowHash='2'.repeat(32),s=>s.reminders.adoptions[0].rowHash='2'.repeat(32),
  s=>{for(const rows of [s.reminders.events,s.reminders.relations,s.reminders.adoptions])rows[0][rows===s.reminders.events?'id':'eventId']=id(8888);},
 ]){const {state,guard,commit}=fixture();guard.arm();commit();guard.seal();mutate(state);assert.throws(()=>guard.verify(),/sealed_rows_changed/);}
});
test('original row changes, deletions, arbitrary201 additions and plan operations/artifacts are never authorized',()=>{
 for(const failure of ['old_rewrite','old_delete','extra_event','other_site_event','extra_relation','extra_adoption','plan_operation','plan_artifact']){
  const {state,guard,commit}=fixture();guard.arm();commit();state.filtered='2'.repeat(32);assert.throws(()=>guard.seal(),/original_or_undeclared_rows/,failure);
  const sealed=fixture();sealed.guard.arm();sealed.commit();sealed.guard.seal();sealed.state.filtered='2'.repeat(32);assert.throws(()=>sealed.guard.verify(),/original_or_undeclared_rows/,failure);
 }
 const rollback=fixture();rollback.guard.arm();rollback.state.filtered='2'.repeat(32);assert.throws(()=>rollback.guard.verify(),/original_or_undeclared_rows/);
});
test('serialization remains unchanged; new checks are bounded separate protection dispatches without business SQL writes',()=>{
 for(const field of Object.keys(serialization)){
  const {state,guard,commit}=fixture();guard.arm();commit();state.serialization[field]='changed';assert.throws(()=>guard.seal(),/serialization_changed|owner_role/);
 }
 const {state,guard,commit}=fixture();guard.arm();commit();guard.seal();guard.verify();
 assert(state.calls.every(q=>!/set (?:local )?time zone|\b(?:insert into|update public|delete from|create function|alter table)\b/i.test(q)));
 assert(guard.summary().protectionSqlDispatches<=64);assert.throws(()=>{for(let n=0;n<30;n++)guard.verify();},/max64_protection_dispatches/);
});
test('five-table filtered union excludes only three195 actualIDs and exact201 eventID/site in three designated tables',()=>{
 const {state,guard,commit}=fixture();guard.arm();commit();guard.seal();guard.verify();
 const queries=state.calls.filter(q=>q.startsWith('select md5(jsonb_build_object('));assert.equal(queries.length,3);
 assert.equal((queries[0].match(/ where /g)||[]).length,1);assert.equal((queries[1].match(/ where /g)||[]).length,3);assert.equal(queries[1],queries[2]);
 const sql=queries[1];assert.equal((sql.match(/jsonb_agg\(to_jsonb\(r\) order by to_jsonb\(r\)::text\)/g)||[]).length,5);
 assert(sql.includes("r.merchant_id='99990196' and r.id in ('"+state.administrative.items.map(r=>r.id).join("','")+"')"));
 assert(sql.includes("r.merchant_id='99990201' and r.id='"+id(8801)+"'"));
 assert.equal(sql.split("r.merchant_id='99990201' and r.start_event_id='"+id(8801)+"'").length-1,2);
 for(const table of ['merchant_attendance_plan_rule_operations','merchant_attendance_plan_rule_artifacts'])assert(sql.includes('from public.'+table+' r)'));
 assert.doesNotMatch(sql,/<@|limit|to_jsonb\(r\)\s*-|merchant_id\s*(?:<>|!=)/i);
 const snapshot=state.calls.find(q=>q.includes("'administrative'"));assert.equal(snapshot.split('md5(to_jsonb(').length-1,4);
});
test('201 arms exactly once before its producer and seals immediately after source COMMIT/close, before actual PID races',()=>{
 const source=readFileSync(new URL('./attendance-reminders-native.mjs',import.meta.url),'utf8');
 const arm=source.indexOf('parentEvents.arm();'),seed=source.indexOf("step('new_identity_seed'"),commit=source.indexOf("step('rollback_cases_commit_source_only'"),
  close=source.indexOf('await connection.close();connection=null;',commit),seal=source.indexOf('parentEvents.seal();parentFootprintSealed=true;',close),race=source.indexOf('await reminderNativePidRace(raceEnv',seal);
 assert(arm>=0&&seed>arm&&commit>seed&&close>commit&&seal>close&&race>seal);
 assert.equal(source.split('parentEvents.arm();').length-1,1);
 assert(source.includes('if(committed&&!parentFootprintSealed){parentEvents.seal();parentFootprintSealed=true;}'));
 assert(source.indexOf('committed=true;rolledBack=true;',commit)<source.indexOf('assert.equal(committedFacts,sourceState.facts',commit));
 for(const text of ['caps.sql','caps.rpc','caps.milliseconds','reminder201_all_cases_rollback_to_initial_source','outsideCheck(\'finally\')','reminder201_failed_rollback_all_facts_exact'])assert(source.includes(text));
 assert.equal(source.split('await reminderNativePidRace(raceEnv').length-1,2);
});
test('a successful microcommit is still sealed after close failure and simultaneous seal failure retains both causes',async()=>{
 for(const sealFails of [false,true]){
  const closeFailure=new Error('synthetic close failure'),calls=[];
  await assert.rejects(()=>reminderNativeCloseAndSealCommitted({close:async()=>{calls.push('close');throw closeFailure;},step:async()=>calls.push('unexpected_rollback')},null,true,
   async()=>{calls.push('seal');if(sealFails)throw Error('synthetic seal failure');}),error=>{
    assert.equal(error,closeFailure);if(sealFails)assert.match(error.message,/reminder201_cleanup_secondary:.*synthetic seal failure/s);return true;
   });assert.deepEqual(calls,['close','seal']);
 }
 const calls=[];const c={close:async()=>calls.push('close'),step:async()=>calls.push('rollback')};
 assert.equal(await reminderNativeCloseAndSealCommitted(c,null,false,async()=>calls.push('unexpected_seal')),null);assert.deepEqual(calls,['rollback','close']);
});
