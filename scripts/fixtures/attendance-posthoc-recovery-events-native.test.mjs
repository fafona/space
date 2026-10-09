import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createPosthocRecoveryEventsGuard,posthocRecoveryProtectedTables,posthocRecoveryOriginalFactsSql} from './attendance-posthoc-recovery-events-native.mjs';
import {attendanceRecoveryCoveragePlan} from './attendance-recovery-coverage-native.mjs';

function fixture(overrides={}){
 const state={hash:'original',fixedHash:'original',fresh:'true',count:'2',calls:[],...overrides};
 const owned={schema:'attendance_race_'+'1'.repeat(32),oid:100,tableOid:101,owner:'postgres',marker:'faolla-synthetic-concurrency:00000000-0000-4000-8000-000000000001'};
 const d={owned,syntheticOnly:true,fingerprint:()=>state.hash,exec:sql=>{
  state.calls.push(sql);
  if(sql.includes('reset role;'))return JSON.stringify(owned);
  if(sql.includes('not exists'))return state.fresh;
  if(sql===posthocRecoveryOriginalFactsSql())return state.fixedHash;
  if(sql.startsWith('select count(*)'))return state.count;
  throw Error('unexpected query');
 }};
 const h={syntheticOnly:true};
 const guard=createPosthocRecoveryEventsGuard({d,h,originalTables:[...posthocRecoveryProtectedTables],originalFacts:'original'});
 return {state,d,h,guard};
}
test('old callers still require the original full-table hash without any allowance',()=>{
 const {state,guard}=fixture();assert.equal(guard.verify(),0);assert.equal(state.calls.length,0);
 state.hash='added-row';assert.throws(()=>guard.verify());assert.equal(state.calls.length,0);
});
test('only an owned synthetic caller can register, once and before either fixed ID exists',()=>{
 for(const variant of ['merchant','events','facts','context','ownership']){
  const {state,d,guard}=fixture();
  if(['merchant','events'].includes(variant))state.fresh='false';
  if(variant==='facts')state.hash='changed';
  if(variant==='context')d.syntheticOnly=false;
  if(variant==='ownership')d.owned={...d.owned,oid:999};
  assert.throws(()=>guard.register(),undefined,variant);
 }
 const {guard}=fixture();guard.register();assert.throws(()=>guard.register(),/already_registered/);
});
test('registered verification requires all original facts unchanged and exactly both new events',()=>{
 const {state,guard}=fixture();guard.register();state.hash='includes-two-fixtures';assert.equal(guard.verify(),2);
 for(const failure of ['modified-row','deleted-row','extra-key-in-json','undeclared-row']){
  state.fixedHash=failure;assert.throws(()=>guard.verify(),/changed_original_or_added_undeclared_rows/);
 }
 state.fixedHash='original';for(const count of ['0','1','3']){state.count=count;assert.throws(()=>guard.verify(),/both_declared_events/);}
});
test('SQL keeps complete row values, ignores only the fixed two event-and-tenant pairs',()=>{
 const sql=posthocRecoveryOriginalFactsSql(),p=attendanceRecoveryCoveragePlan('2026-10-07');
 assert(sql.includes(`r.merchant_id='${p.site}' and r.id in ('${p.event}','00000000-0000-4000-8000-000226700011')`));
 assert.equal((sql.match(/ where /g)||[]).length,1);
 assert.equal((sql.match(/jsonb_agg\(to_jsonb\(r\) order by to_jsonb\(r\)::text\)/g)||[]).length,5);
 assert.doesNotMatch(sql,/<@|limit|to_jsonb\(r\)\s*-/i);
 for(const table of posthocRecoveryProtectedTables)assert(sql.includes(`from public.${table} r`));
});
test('207 exports capability only through full-leave context; only226 explicitly invokes it before preparation',()=>{
 const review=readFileSync(new URL('../merchant-attendance-plan-posthoc-review-native.mjs',import.meta.url),'utf8');
 const coverage=readFileSync(new URL('../merchant-attendance-recovery-coverage-native.mjs',import.meta.url),'utf8');
 assert(review.includes('registerRecoveryCoverageEvents:recoveryEvents.register'));
 assert(review.includes('const syntheticRecoveryEvents=recoveryEvents.verify()'));
 assert(coverage.indexOf('ctx.registerRecoveryCoverageEvents();')<coverage.indexOf('await prepareAttendanceRecoveryCoverage(ctx)'));
 const baseline=readFileSync(new URL('../merchant-attendance-recovery-native.mjs',import.meta.url),'utf8');
 assert(!baseline.includes('registerRecoveryCoverageEvents'));
});
