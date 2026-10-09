import assert from 'node:assert/strict';
import test from 'node:test';
import {createPosthocAdministrativeEventsGuard} from './attendance-posthoc-administrative-events-native.mjs';
import {posthocRecoveryProtectedTables} from './attendance-posthoc-recovery-events-native.mjs';
import {lifecycleId as id} from '../merchant-attendance-lifecycle-native-support.mjs';

const originalFacts='a'.repeat(32),serialization={user:'postgres',timeZone:'Europe/Madrid',dateStyle:'ISO, DMY',floatDigits:'1'};
function fixture(){
 const owned={schema:'attendance_race_'+'1'.repeat(32),oid:100,tableOid:101,owner:'postgres',marker:'faolla-synthetic-concurrency:'+id(1)};
 const state={hash:originalFacts,filtered:originalFacts,fresh:true,serialization:{...serialization},count:3,calls:[],fingerprints:[],items:[
  {id:id(7701),siteId:'99990196',workerId:id(245700005),sequence:1,action:'clock_in',rowHash:'b'.repeat(32)},
  {id:id(7702),siteId:'99990196',workerId:id(245700005),sequence:2,action:'break_start',rowHash:'c'.repeat(32)},
  {id:id(7703),siteId:'99990196',workerId:id(245700008),sequence:1,action:'clock_in',rowHash:'d'.repeat(32)},
 ]};
 const d={owned,syntheticOnly:true,fingerprint:names=>{state.fingerprints.push(names);return state.hash;},exec:sql=>{
  state.calls.push(sql);if(sql.startsWith('reset role;'))return JSON.stringify(owned);
  if(sql.includes("'fresh'"))return JSON.stringify({fresh:state.fresh,serialization:state.serialization});
  if(sql.includes("'items'"))return JSON.stringify({count:state.count,items:state.items,serialization:state.serialization});
  if(sql.startsWith('select md5(jsonb_build_object('))return state.filtered;
  throw Error('unexpected mock SQL');
 }};
 const h={syntheticOnly:true},guard=createPosthocAdministrativeEventsGuard({d,h,originalTables:[...posthocRecoveryProtectedTables],originalFacts});
 return {state,d,h,guard};
}
test('fixed capability is inert, frozen, detached-safe, and requires arm then exactly one seal',()=>{
 const {state,guard}=fixture();assert.equal(state.calls.length,0);assert.equal(guard.isArmed(),false);assert(Object.isFrozen(guard));
 assert.throws(()=>guard.seal(),/once_armed/);assert.throws(()=>guard.verify(),/requires_sealed/);
 const {arm,seal,verify}=guard;arm();assert.equal(guard.isArmed(),true);assert.throws(arm,/already_armed/);
 assert.throws(verify,/requires_sealed/);seal();assert.throws(seal,/once_armed/);assert.equal(verify(),3);
});
test('arm requires the exact five-table original hash, owned synthetic context and unused fixed identities',()=>{
 for(const bad of ['facts','fresh','d','h','ownership']){
  const {state,d,h,guard}=fixture();if(bad==='facts')state.hash='e'.repeat(32);if(bad==='fresh')state.fresh=false;
  if(bad==='d')d.syntheticOnly=false;if(bad==='h')h.syntheticOnly=false;if(bad==='ownership')d.owned={...d.owned,oid:999};
  assert.throws(()=>guard.arm(),undefined,bad);assert.equal(guard.isArmed(),false);
 }
 const {state,guard}=fixture();guard.arm();assert.deepEqual(state.fingerprints,[posthocRecoveryProtectedTables]);
 const fresh=state.calls.find(sql=>sql.includes("'fresh'"));
 for(const value of ['99990196',id(245700005),id(245700008),id(245700006),id(245700009),id(245700007),id(245700010)])assert(fresh.includes(value));
});
test('seal rejects counts, duplicate IDs and any worker/action/sequence/site mismatch',()=>{
 const variants=[s=>s.count=4,s=>s.count=2,s=>s.items.pop(),s=>s.items[1].id=s.items[0].id,
  s=>s.items[0].workerId=id(999),s=>s.items[1].action='clock_out',s=>s.items[2].sequence=2,
  s=>s.items[0].siteId='99990201',s=>s.items[0].rowHash='invalid',s=>s.items[0].extra='unknown'];
 for(const mutate of variants){const {state,guard}=fixture();guard.arm();mutate(state);assert.throws(()=>guard.seal());assert.throws(()=>guard.verify(),/requires_sealed/);}
});
test('seal and final verification preserve every original row and reject all undeclared additions',()=>{
 for(const failure of ['old_rewrite','old_delete','extra_event','201_relation','201_adoption','plan_operation','plan_artifact']){
  const {state,guard}=fixture();guard.arm();state.filtered='e'.repeat(32);assert.throws(()=>guard.seal(),/original_or_undeclared_rows/,failure);
 }
 const {state,guard}=fixture();guard.arm();guard.seal();state.filtered='e'.repeat(32);assert.throws(()=>guard.verify(),/original_or_undeclared_rows/);
});
test('the complete sealed rows cannot later change or disappear, even if filtered originals still match',()=>{
 for(const mutate of [s=>s.items[0].rowHash='e'.repeat(32),s=>s.items[0].id=id(8888),s=>s.count=2,s=>s.count=4]){
  const {state,guard}=fixture();guard.arm();guard.seal();mutate(state);assert.throws(()=>guard.verify());
 }
});
test('scope serialization must remain identical to the old baseline, without a unilateral UTC conversion',()=>{
 for(const field of Object.keys(serialization)){
  const {state,guard}=fixture();guard.arm();state.serialization[field]='changed';assert.throws(()=>guard.seal());
  const current=fixture();current.guard.arm();current.guard.seal();current.state.serialization[field]='changed';assert.throws(()=>current.guard.verify());
 }
 const {state,guard}=fixture();guard.arm();guard.seal();guard.verify();assert(state.calls.every(sql=>!/set (?:local )?time zone/i.test(sql)));
});
test('filtered SQL excludes only three actual ID-and-site pairs; all five full row arrays stay protected',()=>{
 const {state,guard}=fixture();guard.arm();guard.seal();guard.verify();
 const queries=state.calls.filter(sql=>sql.startsWith('select md5(jsonb_build_object('));assert.equal(queries.length,2);assert.equal(queries[0],queries[1]);
 const sql=queries[0];assert.equal((sql.match(/ where /g)||[]).length,1);
 assert(sql.includes("where not (r.merchant_id='99990196' and r.id in ('"+state.items.map(r=>r.id).join("','")+"'))"));
 assert.equal((sql.match(/jsonb_agg\(to_jsonb\(r\) order by to_jsonb\(r\)::text\)/g)||[]).length,5);
 for(const table of posthocRecoveryProtectedTables)assert(sql.includes('from public.'+table+' r'));
 assert.doesNotMatch(sql,/<@|limit|to_jsonb\(r\)\s*-/i);
 const snapshot=state.calls.find(q=>q.includes("'items'"));assert(snapshot.includes('limit 3'));assert(snapshot.includes('md5(to_jsonb(e)::text)'));
});
