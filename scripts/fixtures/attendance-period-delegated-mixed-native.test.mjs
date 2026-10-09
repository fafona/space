//Pure/static and orchestration mocks only. No SQL execution or Auth proof.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import test from 'node:test';
import {lifecycleId as id} from '../merchant-attendance-lifecycle-native-support.mjs';
import {delegatedMixedWriteTables,delegatedMixedArchiveBytes,delegatedMixedInterval,assertDelegatedMixedSourceProofs,assertDelegatedMixedReport,verifyPeriodDelegatedMixedNative} from './attendance-period-delegated-mixed-native.mjs';
const code=readFileSync(new URL('./attendance-period-delegated-mixed-native.mjs',import.meta.url),'utf8');
const has=(...values)=>values.forEach(value=>assert(code.includes(value),value));
const ordered=(...values)=>{let at=-1;for(const value of values){at=code.indexOf(value,at+1);assert(at>=0,value);}};
const event=(n,sequence,action,time)=>({id:id(n),sequence,action,occurredAt:`2026-10-06T${time}:00.000000Z`});
const identity={workerId:id(1),employeeId:id(2),employeeAuthUserId:id(3)};
const profile=()=>({period:{period_id:id(204900001),employee_id:identity.employeeId,employee_auth_user_id:identity.employeeAuthUserId,
 from_date:'2026-10-06',through_date:'2026-10-06',sealed:false,state:'open'},
 originalSession:{item:{effect:null,events:[event(174704,1,'clock_in','08:15'),event(174705,2,'clock_out','09:35')]},ruleBinding:null,
  relation:{startEventId:id(174704),operationId:id(174706),status:'linked',selection:{slotId:id(174701)},slot:{id:id(174701)}},
  adoption:{status:'adopted',approval:{operationId:id(174702)}},planRuleApproval:{operationId:id(174702),source:identity}},
 originalEventIdentities:[174704,174705].map((n,index)=>({eventId:id(n),operationId:id(174706+index),workerId:identity.workerId,actorEmployeeId:identity.employeeId,source:'web'})),
 session:{item:{effect:null,events:[event(204710,3,'clock_in','09:40'),event(204711,4,'clock_out','09:45')]},
  ruleBinding:{...identity,status:'unverified',reason:'source_unavailable',source:null},relation:null,adoption:null,planRuleApproval:null},
 slot:{id:id(174701),workDate:'2026-10-06',timeZone:'UTC',startAt:'2026-10-06T08:00:00.000Z',endAt:'2026-10-06T10:00:00.000Z'},
 missing:{requestId:id(204715),approvalOperationId:id(204716),startAt:'2026-10-06T09:50:00.000000Z',endAt:'2026-10-06T09:55:00.000000Z'}});
function artifact(){const p=profile();return{worker:identity,source:{context:{plans:{items:[{slot:p.slot,publication:identity}]}}},report:{access:'delegate',base:{...identity,
 rows:[p.originalSession,p.session].map(({item:{events}})=>{const span={startAt:events[0].occurredAt,endAt:events.at(-1).occurredAt,
  totals:{workedUs:(Date.parse(events.at(-1).occurredAt)-Date.parse(events[0].occurredAt))*1000}};
 return{startEventId:events[0].id,eventIds:events.map(e=>e.id),source:'original',correction:null,original:span,selected:span};})},
 missing:[{requestId:p.missing.requestId,operationId:p.missing.approvalOperationId,workerId:identity.workerId,employeeId:null,
  proposal:{startAt:p.missing.startAt,endAt:p.missing.endAt,breaks:[]}}],
 totals:{recordedSelected:{workedUs:5100000000},missingSelected:{workedUs:300000000},selected:{workedUs:5400000000},original:{workedUs:5100000000}}}};}
const saved=()=>{const artifactText=JSON.stringify({label:'原归档'});return{artifact:JSON.parse(artifactText),artifactText,
 artifactBytes:Buffer.byteLength(artifactText,'utf8'),artifactSha256:createHash('sha256').update(artifactText).digest('hex')};};

test('import is inert and non-synthetic contexts stop before opening anything',async()=>{
 assert.equal(typeof verifyPeriodDelegatedMixedNative,'function');let opened=0;
 await assert.rejects(verifyPeriodDelegatedMixedNative({d:{syntheticOnly:false},h:{syntheticOnly:true},native:{connect:()=>opened++}}));assert.equal(opened,0);
 assert.doesNotMatch(code,/process\.env|process\.argv|pg_ctl|spawn\(|listen\(|chromium|createServer/);
});
test('only new2344 identifiers are minted; legacy facts are point-read not relabeled as new writes',()=>{
 has('uid=n=>id(234400000+n)','start:id(204710)','missing:id(204715)','slot:id(174701)','period:id(204900001)',"includeExisting:true");
 assert(!delegatedMixedWriteTables.includes('merchant_attendance_events'));assert(!delegatedMixedWriteTables.includes('merchant_attendance_missing_entries'));
 assert(!delegatedMixedWriteTables.includes('merchant_attendance_schedule_slots'));assert(Object.isFrozen(delegatedMixedWriteTables));
 assert.doesNotMatch(code,/(?:insert into|update|delete from) public\.merchant_attendance_/i);
 assert.doesNotMatch(code,/disable trigger|alter table|drop (?:schema|table)|truncate/i);
});
test('one-minute internal leave uses the exact five-minute raw session and distinct missing interval',()=>{
 const p=profile();assert.deepEqual(delegatedMixedInterval(p.session.item.events,p.missing),{timeZone:'UTC',startAt:'2026-10-06T09:45:00.000Z',endAt:'2026-10-06T09:46:00.000Z'});
 for(const alter of [x=>x.session.item.events[0].id=id(44),x=>x.session.item.events[1].sequence=5,
  x=>x.session.item.events[1].occurredAt='2026-10-06T09:45:00.001000Z',x=>x.missing.startAt='2026-10-06T09:44:00.000000Z']){
  const bad=profile();alter(bad);assert.throws(()=>delegatedMixedInterval(bad.session.item.events,bad.missing));
 }
});
test('report proof binds exactly two recorded sessions, one approved missing and one published plan to real identity/time',()=>{
 assert.doesNotThrow(()=>assertDelegatedMixedReport(artifact(),profile(),identity));
 const mutations=[a=>a.report.base.rows.pop(),a=>a.report.base.rows.reverse(),a=>a.report.base.rows[0].correction={},a=>a.report.missing.push(a.report.missing[0]),
  a=>a.report.missing[0].operationId=id(99),a=>a.report.missing[0].proposal.endAt='2026-10-06T09:56:00.000000Z',a=>a.report.missing[0].employeeId=identity.employeeId,
  a=>a.report.totals.selected.workedUs++,a=>a.worker.employeeAuthUserId=id(99),a=>a.source.context.plans.items[0].publication.employeeId=id(99),
  a=>a.source.context.plans.items.push(a.source.context.plans.items[0]),a=>a.report.access='owner'];
 for(const mutate of mutations){const a=structuredClone(artifact());mutate(a);assert.throws(()=>assertDelegatedMixedReport(a,profile(),identity));}
});
test('174 null rule binding uses its actual137/140 proof;204 rule binding cannot be invented for it',()=>{
 assert.doesNotThrow(()=>assertDelegatedMixedSourceProofs(profile(),identity));
 for(const mutate of [p=>p.originalSession.ruleBinding={...identity},p=>p.originalSession.relation=null,
  p=>p.originalSession.relation.operationId=id(204712),p=>p.originalSession.adoption.approval.operationId=id(99),
  p=>p.originalSession.planRuleApproval.source={...identity,employeeAuthUserId:id(99)},p=>p.originalEventIdentities[0].actorEmployeeId=id(99),
  p=>p.originalEventIdentities[1].workerId=id(99),p=>p.originalEventIdentities[0].source='kiosk',p=>p.originalEventIdentities.pop(),
  p=>p.session.ruleBinding=null,p=>p.session.ruleBinding.employeeAuthUserId=id(99),p=>p.session.relation={}]){
  const p=structuredClone(profile());mutate(p);assert.throws(()=>assertDelegatedMixedSourceProofs(p,identity));
 }
 has('assert.equal(original.ruleBinding,null)','original174IdentityProof:',"'actorEmployeeId',ev.actor_employee_id",'assertDelegatedMixedSourceProofs(profile,h)');
});
test('archive guards compare exact UTF8 body bytes and SHA, not JSON equivalence',()=>{
 const a=saved();assert.deepEqual(delegatedMixedArchiveBytes(a),{artifactText:a.artifactText,artifactBytes:a.artifactBytes,artifactSha256:a.artifactSha256});
 for(const patch of [{artifactBytes:a.artifactText.length},{artifactSha256:'0'.repeat(64)},{artifact:{changed:true}},{artifactText:a.artifactText+' '}])assert.throws(()=>delegatedMixedArchiveBytes({...a,...patch}));
});
test('all RPCs use real service role, immediate deferred constraints and zero-write failed/read statements',()=>{
 has("assert current_user='service_role'",'set constraints all immediate;set constraints all deferred',
  "if failure is not null or ${c===null} then assert ${fullHash}=all_before",'delegated_mixed_read_or_rejection_wrote',
  'delegated_mixed_write_outside_exact_scope','except select to_jsonb(original_row)','delegated_mixed_period_frame_changed','delegated_mixed_budget_not_exact');
 has('executePeriodDelegation','executePeriodDelegatedClosures','executePeriodClosuresV2','parseLeaveResult(value.data,query,command,who)');
});
test('exact operation-key allowances never exclude a whole existing table or immutable original frame',()=>{
 has('r.operation_id=${op}','r.grant_id=${op}','r.request_id=${op}','r.artifact_id=${op}',
  "to_jsonb(p)-array['revision','current_version','state','sealed','confirmed_version','unresolved_dispute','updated_at']",
  "merchant_attendance_period_storage:`r.merchant_id=${site}`");
 const start=code.indexOf('const allowance='),end=code.indexOf('const invoke=',start),text=code.slice(start,end);
 assert.doesNotMatch(text,/merchant_attendance_events|merchant_attendance_missing|merchant_attendance_schedule|merchant_enterprise_roles/);
});
test('real pending leave forces a new source and v2 archive, then actual employee confirms before approval invalidates it',()=>{
 ordered("const baseline=await run(q('preview'))","action:'submit'","const pending=await run(q('preview'))","const send=cmd('send'",
  "detail.artifact.protocol,'attendance-period-artifact-v2'","await original('self',cmd('confirm'","action:'approve'",
  "assert.equal(changed.sourceChanged,true)","error.code==='attendance_period_source_changed'",
  "run(q('recover',{operationId:send.operationId}),null,false)");
 has('assert.notEqual(pending.preview.artifact.sourceFingerprint,baseline.preview.artifact.sourceFingerprint)',
  'assert.notEqual(current.preview.artifact.sourceFingerprint,fp)','assert.deepEqual(current.preview.artifact.report.totals,pending.preview.artifact.report.totals)',
  'JSON.stringify((await original(\'owner\')).artifact),body','JSON.stringify((await original(\'self\')).artifact),body');
});
test('one existing bounded connection and UTC serialization; no second-connection fingerprints during active transaction',()=>{
 assert.equal(code.match(/native\.connect\(\)/g)?.length,1);
 has("assert(++steps<=100", "set local lock_timeout='3s';set local statement_timeout='10s'", 'const serialization="reset role;set local time zone',
  "set local extra_float_digits=3",'d.exec(prefix+','scope.sql((label===\'begin\'?\'begin;\':\'\')+prefix+sql)');
 const live=code.slice(code.indexOf('const connection=native.connect()'),code.indexOf('finally{'));
 assert.doesNotMatch(live,/d\.(fingerprint|exec|definitions|tableCatalog)\(/);assert.doesNotMatch(code,/setTimeout|pg_sleep|lifetime|statement_timeout='(?:[2-9]\d)s'/);
});

function failureHarness({drift=false,rollbackFails=false}={}){
 const events=[],a=saved(),owned={schema:'attendance_race_'+'a'.repeat(32)},state={facts:'before',active:false},p=profile();
 const d={syntheticOnly:true,owned,site:'99990001',owner:id(99),guard:'--owned\n',inventory:()=>delegatedMixedWriteTables,
  fingerprint:()=>{assert.equal(state.active,false,'no external hash in active transaction');return state.facts;},definitions:()=>'defs',tableCatalog:()=>'catalog',exec:sql=>{events.push('profile');assert.match(sql,/^reset role;set local time zone 'UTC'/);return JSON.stringify(p);}};
 const ctx={d,h:{syntheticOnly:true,...identity},periodId:id(207999),archive:()=>a,oldArchive:a,periodArchive:()=>a,scope:{schema:owned.schema,sql:s=>s},
  native:{query:()=>'',connect:()=>{events.push('connect');return{step:async sql=>{events.push(sql.startsWith('begin;')?'begin':'rollback');
   if(sql.startsWith('begin;')){state.active=true;if(drift)state.facts='changed';throw Error('synthetic first SQL failure');}
   state.active=false;if(rollbackFails)throw Error('synthetic rollback failure');return '';},close:async()=>{state.active=false;events.push('close');}};}}};
 const realmAssert=Object.assign((...args)=>assert(...args),assert,{deepEqual:(a,b,m)=>assert.deepEqual(JSON.parse(JSON.stringify(a)),JSON.parse(JSON.stringify(b)),m)});
 const executable=code.replace(/^import .*;\r?$/gm,'').replace(/^export /gm,'').replaceAll('import.meta.url','moduleUrl')+'\nverifyPeriodDelegatedMixedNative;';
 const fn=runInNewContext(executable,{assert:realmAssert,Buffer,JSON,Date,createHash,id,moduleUrl:'file:///synthetic/mixed.mjs',
  quote:v=>"'"+v+"'",json:JSON.stringify,assertLifecycleSandbox:()=>owned,outageNativeFingerprintSql:()=>"'facts'",createRequire:()=>()=>({})},{timeout:1000});
 return{events,run:()=>fn(ctx)};
}
test('failed first SQL always rolls back/closes and checks the unchanged complete baseline',async()=>{
 const h=failureHarness();await assert.rejects(h.run(),e=>{assert.match(e.message,/delegated_mixed:begin:Error: synthetic first SQL failure/);assert.equal(e.errors.length,1);return true;});
 assert.deepEqual(h.events,['profile','connect','begin','rollback','close']);
});
test('cleanup and immutable-baseline failures stay visible rather than overwriting the root cause',async()=>{
 const h=failureHarness({drift:true,rollbackFails:true});await assert.rejects(h.run(),e=>{assert.equal(e.errors.length,3);
  assert.match(e.message,/synthetic first SQL failure/);assert.match(e.message,/synthetic rollback failure/);assert.match(e.message,/delegated_mixed_rollback_facts/);return true;});
 assert.equal(h.events.at(-1),'close');
});
