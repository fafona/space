//Pure arithmetic, contract/static and actual-wrapper mocks, NOT database proof.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {runInNewContext} from 'node:vm';
import {lifecycleId as id} from '../merchant-attendance-lifecycle-native-support.mjs';
import {qualifyAttendanceSandbox} from '../merchant-attendance-concurrency-sandbox.mjs';
import {partialLeaveIntervals,partialLeaveArchiveBytes,posthocPartialLeaveWriteTables,verifyPosthocPartialLeaveNative,preparePosthocPartialLeaveBrowser} from './attendance-plan-posthoc-partial-leave-native.mjs';

const source=readFileSync(new URL('./attendance-plan-posthoc-partial-leave-native.mjs',import.meta.url),'utf8');
const has=(...values)=>values.forEach(value=>assert(source.includes(value),value));
const ordered=(...values)=>{let position=-1;for(const value of values){position=source.indexOf(value,position+1);assert(position>=0,value);}};
const current=()=>({protocol:'plan-exception-source-v3',eligible:true,blockers:[],slot:{timeZone:'UTC',startAt:'2026-10-05T08:00:00.000Z',endAt:'2026-10-05T10:00:00.000Z'},
  candidate:{late:{state:'triggered',rawDeltaUs:'900000000'},early:{state:'not_triggered',minutes:10,rawDeltaUs:'300000000'},selected:{startAt:'2026-10-05T08:15:00.000000Z',endAt:'2026-10-05T09:55:00.000000Z'}}});
const artifact=()=>{const artifactText=JSON.stringify({label:'保存的旧归档',unchanged:true});return {artifactText,artifactBytes:Buffer.byteLength(artifactText,'utf8'),artifactSha256:createHash('sha256').update(artifactText,'utf8').digest('hex'),artifact:JSON.parse(artifactText)};};

test('inert exports require owned synthetic context before any runtime boundary',async()=>{
  assert.equal(typeof verifyPosthocPartialLeaveNative,'function');assert.equal(typeof preparePosthocPartialLeaveBrowser,'function');
  await assert.rejects(verifyPosthocPartialLeaveNative({}),/partial_leave_synthetic_context_required/);
  await assert.rejects(preparePosthocPartialLeaveBrowser({}),/partial_leave_synthetic_context_required/);
  assert.doesNotMatch(source,/process\.argv|process\.env|listen\(|spawn\(|initdb|CREATE DATABASE|pg_dump|playwright/i);
});
test('real selected endpoints define two non-overlapping half-open prefix/suffix requests',()=>{
  assert.deepEqual(partialLeaveIntervals(current()),[
    {timeZone:'UTC',startAt:'2026-10-05T08:00:00.000Z',endAt:'2026-10-05T08:15:00.000Z'},
    {timeZone:'UTC',startAt:'2026-10-05T09:55:00.000Z',endAt:'2026-10-05T10:00:00.000Z'},
  ]);
  for(const change of [v=>v.protocol='plan-exception-source-v1',v=>v.eligible=false,v=>v.blockers=['pending_correction'],v=>v.candidate.late.state='not_triggered',
    v=>v.candidate.early.state='triggered',v=>v.candidate.early.minutes=0,v=>v.candidate.early.rawDeltaUs='900000000',
    v=>v.candidate.selected.startAt=v.slot.startAt,v=>v.candidate.selected.endAt=v.slot.endAt,v=>v.slot.timeZone='Europe/Madrid',v=>v.candidate.selected.startAt='2026-10-05T08:15:00.000001Z']){
    const value=current();change(value);assert.throws(()=>partialLeaveIntervals(value));
  }
});
test('archive verification checks real UTF8 byte length, exact SHA and parsed saved body',()=>{
  const saved=artifact(),checked=partialLeaveArchiveBytes(saved);assert.equal(checked.artifactBytes,Buffer.byteLength(saved.artifactText,'utf8'));assert(checked.artifactBytes>saved.artifactText.length);
  for(const changed of [{...saved,artifactBytes:saved.artifactText.length},{...saved,artifactSha256:'0'.repeat(64)},{...saved,artifact:{changed:true}}])assert.throws(()=>partialLeaveArchiveBytes(changed));
});
test('only eleven necessary tables are writable and every other table remains fingerprint-protected',()=>{
  assert.equal(posthocPartialLeaveWriteTables.length,11);assert.equal(new Set(posthocPartialLeaveWriteTables).size,11);assert(Object.isFrozen(posthocPartialLeaveWriteTables));
  for(const table of ['merchant_attendance_events','merchant_attendance_shift_schedule_relations','merchant_attendance_shift_plan_adoptions','merchant_attendance_plan_rule_operations','merchant_attendance_plan_rule_artifacts','merchant_attendance_missing_requests','merchant_attendance_correction_effects'])assert(!posthocPartialLeaveWriteTables.includes(table));
  has('protectedHash(allowed)','c&&!error?oldRowsGuard(allowed)',"table==='merchant_attendance_period_closures'?",'partial_leave_revoke_must_have_no_existing_target_claim');
  assert.doesNotMatch(source,/(?:insert into|update|delete from) public\.merchant_/i);
  assert.doesNotMatch(source,/disable trigger|drop (?:schema|table|trigger|function)|alter table|truncate/i);
});
test('all reads and rejections compare whole facts, force actual service role and flush enabled constraints',()=>{
  has('const hash=c&&!error?protectedHash(allowed):fullHash',"assert current_user='service_role'",'set constraints all immediate;set constraints all deferred',
    "'partial_leave_expected_rejection_missing'",'before_hash=after_hash','except select to_jsonb(original_row)');
});
test('whole-row snapshots and both comparison paths share UTC serialization despite a Paris session default',()=>{
  const schema='attendance_race_'+'a'.repeat(32),owned={schema,oid:123,owner:'postgres',marker:'synthetic'},saved=artifact(),calls=[];
  const rows=Object.fromEntries(posthocPartialLeaveWriteTables.map(table=>[table,[]]));
  const row={merchant_id:'99990001',operation_id:id(230100001),recorded_at:'2026-10-05T10:00:00+02:00'};
  const d={syntheticOnly:true,owned,site:'99990001',guard:'--owned\n',inventory:()=>posthocPartialLeaveWriteTables,
    fingerprint:()=>'facts',definitions:()=>'defs',tableCatalog:()=>'catalog',exec:sql=>{
      calls.push(sql);assert.match(sql,/^reset role;set local time zone 'UTC';set local datestyle='ISO, YMD';--owned\nselect jsonb_build_object/);
      //Model only the known JSON serialization difference, not SQL execution.
      const utc=sql.includes("set local time zone 'UTC'");
      return JSON.stringify({...rows,merchant_attendance_plan_posthoc_operations:[{...row,recorded_at:utc?'2026-10-05T08:00:00+00:00':row.recorded_at}]});
    }};
  const ctx={d,h:{syntheticOnly:true,slot:{id:id(174701),timeZone:'UTC'}},native:{query:()=>'',connect:()=>{}},
    scope:{schema,sql:sql=>qualifyAttendanceSandbox(sql,schema)},archive:()=>saved,oldArchive:saved};
  const code=source.replace(/^import .*;\r?$/gm,'').replace(/^export /gm,'').replaceAll('import.meta.url','moduleUrl')+'\ncontext;';
  const check=runInNewContext(code,{assert,Buffer,JSON,createHash,id,createRequire:()=>()=>{},moduleUrl:'file:///synthetic/fixture.mjs',
    assertLifecycleSandbox:()=>owned,quote:value=>"'"+value+"'",json:value=>"'"+JSON.stringify(value).replaceAll("'","''")+"'::jsonb"},{timeout:1000});
  const state=check(ctx);assert.equal(calls.length,1);
  assert.equal(state.rows.merchant_attendance_plan_posthoc_operations[0].recorded_at,'2026-10-05T08:00:00+00:00');
  assert.equal(source.match(/prefix=rowSerializationPrefix\+d\.guard/g)?.length,2);
  has('d.exec(rowSerializationPrefix+d.guard+','except select to_jsonb(original_row)','assertPreserved=()=>',
    '(_label,sql)=>d.exec(prefix+sql)','op.guard();');
  row.note='public.must_not_be_rewritten';
  assert.throws(()=>check(ctx),/partial_leave_row_snapshot_schema_rewrite/);
});
test('prepare uses current171 references and real122 submit/approve, then independently checks both edge deltas',()=>{
  ordered('const available=await op.adopt()',"assert.equal(available.current.action,'revoke')","await op.adopt({action:'apply'",'partialLeaveIntervals(before.detail.current)',
    "action:'submit'","blockers.includes('leave_pending')","action:'approve'","candidate.late.state,'not_triggered'","candidate.early.rawDeltaUs,i===0?'300000000':'0'");
  has('assert.equal(prepared.detail.current.leaveEdges.fullCoverage,false)','assert.deepEqual(prepared.detail.current.leaveEdges.workLeaveOverlaps,[])',
    'assert.deepEqual(after.artifact.report.totals,baselineTotals)',"assert.notEqual(prepared.detail.latestDecision.outcome,'cleared')");
});
test('cleared and self saved proof precede real strict-projected resend/confirm/seal',()=>{
  ordered("const current=await op.read();assert.equal(current.detail.latestDecision.outcome,'cleared')",'receipt=(await op.read(op.rq(\'recover\'',
    "const self=await op.read(op.rq('detail','self'))","assert.equal(self.detail.currentValidation,'not_checked')",'assert.deepEqual(self.detail.latestDecision.evidence,receipt.item.evidence)',
    "op.pc('send',period,source.artifact.sourceFingerprint),source.artifact","op.pc('confirm',period)","op.pc('seal',period)",'sealedArchive=partialLeaveArchiveBytes(await periodArchive())');
  has('parsePeriodClosureQuery(q);if(c)parsePeriodClosureCommand(q,c)','projectPeriodClosureSource(value,q)','parsePlanExceptionResult(value,q,{authUserId:actor(q.access)},c)');
});
test('administrative cancellation after seal invalidates live source but not saved evidence/archive/receipt',()=>{
  ordered("assert(sealed&&!cancelled,'partial_cancel_after_seal_once')","action:'cancel'","assert.equal(changed.detail.stale,true)",
    "assert.equal(period.sourceChanged,true)",'assert.deepEqual(partialLeaveArchiveBytes(await periodArchive()),sealedArchive)',
    "assert.equal(self.detail.latestDecision.outcome,'cleared')",'assert.deepEqual((await op.read(op.rq(\'recover\'',"error:'attendance_period_sealed'",'await op.guard()');
  has("const command=op.make(changed,'follow_up')",'earlyWasWithinGrace:true',"earlyRawDeltaUsBefore:'300000000'");
});

//Execute the actual two exported orchestration functions with runtime/protocol
//boundaries replaced; SQL strings are never sent to a real database here.
function harness({fail=null,mutate=null}={}){
  const events=[],saved=artifact(),state={baseline:'facts',definitions:'defs',catalog:'catalog',old155:partialLeaveArchiveBytes(saved),archive:()=>saved,
    scope:{sql:value=>value},d:{fingerprint:()=>state.facts,definitions:()=>state.defs,tableCatalog:()=>state.cat,guard:'--owned\n',exec:()=>{events.push('exec');return '';}},
    facts:'facts',defs:'defs',cat:'catalog',native:{connect:()=>{events.push('connect');return {step:async sql=>{events.push(sql.startsWith('begin;')?'begin':sql.endsWith('rollback;')?'rollback':'step');return '';},close:async()=>events.push('close')};},pass:()=>events.push('pass')}};
  const prepared={prepared:{detail:{revision:5}},before:{saved:'actual before'},requestIds:[],baselineTotals:{}};
  const op={make:()=>({operationId:id(230100001)}),rq:()=>({}),review:async()=>events.push('decide'),guard:()=>events.push('guard'),summary:()=>({reads:7,submissions:6}),read:()=>({})};
  const code=source.replace(/^import .*;\r?$/gm,'').replace(/^export /gm,'').replaceAll('import.meta.url','moduleUrl')+`
    context=mockContext;operations=mockOperations;prepare=mockPrepare;completion=mockCompletion;
    ({verifyPosthocPartialLeaveNative,preparePosthocPartialLeaveBrowser});`;
  //Only strip VM prototypes for this orchestration mock. Real helper arithmetic
  //and archive tests above use the ordinary strict assertions unchanged.
  const realmAssert=Object.assign((...args)=>assert(...args),assert,{deepEqual:(a,b,message)=>assert.deepEqual(JSON.parse(JSON.stringify(a)),JSON.parse(JSON.stringify(b)),message)});
  const fn=runInNewContext(code,{assert:realmAssert,Buffer,createHash,id,createRequire:()=>()=>{},moduleUrl:'file:///synthetic/fixture.mjs',
    mockContext:()=>state,mockOperations:()=>{events.push('operations');return op;},mockPrepare:async()=>{events.push('prepare');if(fail==='prepare')throw Error('synthetic prepare');return prepared;},
    mockCompletion:()=>({seal:async()=>{events.push('seal');if(fail==='seal')throw Error('synthetic seal');},cancel:async()=>{events.push('cancel');if(mutate)mutate(state);if(fail==='cancel')throw Error('synthetic cancel');},status:()=>({sealed:true,cancelled:true}),periodArchive:()=>saved}),
  },{timeout:1000});
  return {events,state,fn};
}
test('actual native orchestration uses one connection, rolls back then closes and verifies baseline before pass',async()=>{
  const h=harness(),result=await h.fn.verifyPosthocPartialLeaveNative({selected:[]});
  assert.deepEqual(h.events,['connect','begin','operations','prepare','decide','seal','cancel','rollback','close','pass']);
  assert.equal(result.rollbackRestored,true);assert.equal(result.actualCleared,true);assert.equal(result.browser,false);
});
test('any failed prepare/seal/cancel still closes transaction and never reports pass',async()=>{
  for(const fail of ['prepare','seal','cancel']){const h=harness({fail});await assert.rejects(h.fn.verifyPosthocPartialLeaveNative({selected:[]}));
    assert(h.events.includes('close'));assert(!h.events.includes('pass'));assert(!h.events.includes('rollback'));}
});
test('postrollback fact/definition/catalog mutation fails despite a successful scenario',async()=>{
  for(const key of ['facts','defs','cat']){const h=harness({mutate:state=>{state[key]='changed';}});await assert.rejects(h.fn.verifyPosthocPartialLeaveNative({selected:[]}));assert(h.events.includes('close'));assert(!h.events.includes('pass'));}
});
test('aggregate stack exposes bounded original stage and cause without hiding cleanup failures',async()=>{
  const h=harness({fail:'cancel',mutate:state=>{state.facts='x'.repeat(20000);}});
  await assert.rejects(h.fn.verifyPosthocPartialLeaveNative({selected:[]}),error=>{
    assert.match(error.message,/partial_leave_native_failed:/);assert.match(error.message,/partial_leave_native:begin:synthetic cancel/);
    assert.match(error.message,/partial_rollback_facts/);assert.match(error.stack,/synthetic cancel/);
    assert(error.message.length<=12028);assert.equal(error.errors.length,2);assert.equal(error.cause,error.errors[0]);
    assert.equal(error.errors[0].cause.message,'synthetic cancel');return true;
  });
  assert(h.events.includes('close'));assert(!h.events.includes('pass'));
});
test('persistent browser preparation does not impersonate a cleared write or claim per-case rollback',async()=>{
  const h=harness(),prepared=await h.fn.preparePosthocPartialLeaveBrowser({selected:[],h:{syntheticOnly:true}});
  assert.deepEqual(h.events,['operations','prepare','guard']);assert.equal(typeof prepared.seal,'function');assert.equal(typeof prepared.cancel,'function');
  assert.deepEqual(prepared.beforeLeave,{saved:'actual before'});assert.equal(prepared.summary().perCaseRollback,false);assert.equal(prepared.summary().parentOwnsSchemaCleanup,true);
  has('beforeLeave:prepared.before','parent207 sandbox owns final schema/public-baseline cleanup',"assert(++steps<=100,'partial_leave_bounded100_steps')");
});
