//242 Pure/static/inert-cleanup checks, NOT PostgreSQL acceptance or real Auth.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {operationalPunchFixtureIds,operationalPunchPastSeed,operationalPunchRpcExpression,operationalPunchNativeFinishCommand,verifyOperationalPunchNative} from './attendance-operational-punch-native.mjs';
const source=readFileSync(new URL('./attendance-operational-punch-native.mjs',import.meta.url),'utf8');
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const query={mode:'prepare'},flags={p_allow_new_sessions:true,p_allow_operational_start:true,p_allow_schedule:true,p_bind_rules:false};
const common={p_site:'99990001',p_auth:id(1),p_query:query,p_command:null,...flags};

test('242 native safe finish shares actual UI adapter: saved location/versions, null notice, no GPS',()=>{
 const result={channel:'location',siteId:'99990001',operation:null,canFinish:true,clock:{workerId:id(1),locationId:id(2),state:{sequence:4,status:'working'},
  policy:{settingsVersion:20,workerVersion:21,locationVersion:22},noticeGate:{ready:true,revision:23},finish:{locationId:id(3),settingsVersion:5,workerVersion:6,locationVersion:7}}};
 const c=operationalPunchNativeFinishCommand('location',result,id(4),true);
 assert.deepEqual(c,{clock:{expectedWorkerId:id(1),locationId:id(3),operationId:id(4),action:'clock_out',expectedSequence:4,settingsVersion:5,workerVersion:6,locationVersion:7,noticeRevision:null,safeFinish:true},choice:{kind:'finish'}});
 assert.throws(()=>operationalPunchNativeFinishCommand('self',result,id(4),true));
});

test('242 import is inert and owned IDs do not collide with template IDs',()=>{
 assert.equal(typeof verifyOperationalPunchNative,'function');
 assert.equal(new Set(Object.values(operationalPunchFixtureIds)).size,4);
 for(const value of Object.values(operationalPunchFixtureIds))assert.match(value,/^00000000-0000-4000-8000-0002426[0-9]{5}$/);
 assert.doesNotMatch(source,/\bspawn\s*\(|\blisten\s*\(|chromium|initdb|pg_ctl|disable trigger|session_replication_role|\bcommit;/i);
 assert(source.includes('realAuth:false,realGps:false,production:false'));
});

test('242 new four-channel adapter preserves exact positional193 ABI and flags',()=>{
 const self=operationalPunchRpcExpression('faolla_attendance_operational_punch_self_v1',common);
 assert.equal(self,`public.faolla_attendance_operational_punch_self_v1('99990001','${id(1)}','{"mode":"prepare"}'::jsonb,null,true,true,true,false)`);
 const location=operationalPunchRpcExpression('faolla_attendance_operational_punch_location_v1',{...common,p_expected_worker:id(2),p_assertion:null,p_require_clock:false});
 assert.equal(location,`public.faolla_attendance_operational_punch_location_v1('99990001','${id(1)}','${id(2)}','{"mode":"prepare"}'::jsonb,null,null,true,false,true,true,false)`);
 const onsite=operationalPunchRpcExpression('faolla_attendance_operational_punch_onsite_v1',{...common,p_claims:null});
 assert.equal(onsite,`public.faolla_attendance_operational_punch_onsite_v1('99990001','${id(1)}',null,'{"mode":"prepare"}'::jsonb,null,true,true,true,false)`);
 const pin=operationalPunchRpcExpression('faolla_attendance_operational_punch_pin_v1',{p_site:'99990001',p_terminal:id(3),p_secret_hash:'f'.repeat(64),p_no:'SYNTHETIC',p_lease:id(4),p_verified:true,p_query:query,p_command:null,...flags});
 assert.equal(pin,`public.faolla_attendance_operational_punch_pin_v1('99990001','${id(3)}','${'f'.repeat(64)}','SYNTHETIC','${id(4)}',true,'{"mode":"prepare"}'::jsonb,null,true,true,true,false)`);
 for(const a of [{...common,extra:true},{...common,p_bind_rules:null},{...common,p_site:'12345678'}])assert.throws(()=>operationalPunchRpcExpression('faolla_attendance_operational_punch_self_v1',a));
 assert.throws(()=>operationalPunchRpcExpression('unsafe_sql',{}));
});

test('242 activation and191 adapters preserve their distinct trusted flags',()=>{
 for(const [name,flag] of [['faolla_attendance_operational_punch_activation_v1','p_allow_activate'],['faolla_attendance_operational_rules_v1','p_allow_write']]){
  const a={p_query:{siteId:'99990001',mode:'current'},p_auth_user_id:id(1),p_command:null,[flag]:false};
  const sql=operationalPunchRpcExpression(name,a);assert(sql.startsWith(`public.${name}(`));assert(sql.endsWith(',null,false)'));
  assert.throws(()=>operationalPunchRpcExpression(name,{...a,[flag]:null}));
 }
 assert(source.includes('replay:replayOnly'));assert(source.includes('replayOnly=true;try{assert.deepEqual'));
});

test('242 only one disclosed enterprise past seed: real template, fresh IDs, exact hash/checks and four rows',()=>{
 const sql=operationalPunchPastSeed({head:{merchant_id:'99990001',stream_key:'enterprise'},operations:[{action:'save_draft'},{action:'publish'}]},'2026-10-08');
 assert(sql.includes('not exists(select 1 from public.merchant_attendance_operational_rule_streams)'));
 assert(sql.includes(operationalPunchFixtureIds.seedDraft));assert(sql.includes(operationalPunchFixtureIds.seedPublish));
 for(const fn of ['faolla_attendance_operational_rule_command_v1','faolla_attendance_operational_rule_item_v1','faolla_attendance_operational_rule_check_v1','faolla_attendance_rule_day_start_v1'])assert(sql.includes(fn));
 assert(sql.includes("'attendance-operational-rule-command-v1',seed_op.actor_auth_user_id::text"));
 assert(sql.includes("'attendance-operational-rule-publish-preview-v1'"));
 assert(sql.includes('seed_op.revision-1'));assert(sql.includes('set constraints all immediate'));
 assert.doesNotMatch(sql,/update public|delete from|disable trigger|session_replication_role/i);
 assert.doesNotMatch(source,/insert into public\.merchant_attendance_(?:events|operational_punch_sessions|operational_punch_operations)/);
 assert(source.includes('realTemplateDrafts:1,realTemplateFuturePublications:1,notHistoricalRpc:true'));
 assert.throws(()=>operationalPunchPastSeed({operations:[{action:'save_draft'}]},'2026-10-08'));
});

test('242 all original rows survive every RPC, with only approved exact setup/auth column masks',()=>{
 assert(source.includes('jsonb_object_agg(original_name,original_rows)'));
 assert(source.includes("current_setting('faolla.op242_originals')::jsonb"));
 assert(source.includes('prior(value) except select ${projection(n)}'));
 assert(source.includes("'op242_original_row_changed:${n}'"));
 assert(source.includes("to_jsonb(x)-array['latitude','longitude','radius_meters']"));
 assert(source.includes("to_jsonb(x)-'web_break_paid'"));
 assert(source.includes("authTables=['merchant_attendance_pin_credentials','merchant_attendance_pin_attempts']"));
 assert(source.includes("'op242_read_or_reject_changed_business'"));
 assert(source.includes("'op242_RPC_changed_unrelated_tables'"));
 assert(source.includes("assert found,'op242_exact_settings_restore'"));assert(source.includes("assert found,'op242_exact_location_setup'"));
 assert(source.includes("await restore('op242_geometry',geoSave)"));assert(source.includes("await restore('op242_pin',pinScope)"));
});

test('242 six groups use real services and prove managed two break types without a second rule seed',()=>{
 for(const name of ['executeOperationalPunch','executeOperationalPunchActivation','executeOperationalRuleLedger','executeAttendanceSelf','executeAttendanceLocationClock','executePinClock','executeAttendancePinSchedule','executeOnsiteClock'])assert(source.includes(name));
 assert.equal((source.match(/groups\.push\(/g)??[]).length,6);
 assert(source.includes("for(const kind of ['paid','unpaid'])"));assert(source.includes("begun.clock.receipt.breakPaid,kind==='paid'"));
 assert(source.includes('JSON.stringify(working.session),savedSession'));
 assert(source.includes('first.adoption.approval.operationId,d.mainApproval.operationId'));
 assert(source.includes("assert.equal(fresh.policy.origins[0].operationId,operationalPunchFixtureIds.seedPublish)"));
 assert(source.includes("unconfigured.policy.fields.breakTypes.state,'unconfigured'"));
 assert(source.includes("legacyGates.length,6"));assert(source.includes('new Set(starts.map(x=>x.channel)).size,4'));
});

test('242 PIN finish rejection consumes lease; unknown proof failure remains atomic; diagnostics omit secrets',()=>{
 assert(source.includes("'PIN_known_business_reject'"));
 assert(source.includes('lease_id is null and lease_expires is null and worker_id is null and employee_id is null and credential_revision is null'));
 assert(source.includes("add constraint synthetic242_proof_fault check(operation_id<>"));
 assert(source.includes("assert.equal(lastRpc.sqlstate,'23514')"));assert(source.includes("await restore('op242_fault',faultSave)"));
 assert(source.includes("'onsite_nonce_reuse'"));assert(source.includes("'attendance_qr_used'"));
 assert(source.includes('geoFinished.clock.receiptGate.safeFinish,true'));
 assert(source.includes("role:actualName==='faolla_attendance_location_clock_v1'?'postgres':'service_role'"));
 assert(source.includes("!['noticeRevision','safeFinish'].includes(key)"));
 assert(source.includes('lastRpc={error:r.error,sqlstate:r.sqlstate,context:r.context,'));
 assert.doesNotMatch(source,/lastRpc\s*=\s*r[;,]/);
});

test('242 recovery binds original complete choice/hash and stays read-only flagoff',()=>{
 assert(source.includes('assert.deepEqual(recovered.operation,first.operation)'));
 assert(source.includes('allowOperationalStart:false,moduleEnabled:false'));
 assert(source.includes('assert.equal(recovered.session,null)'));assert(source.includes('assert.equal(recovered.policy,null)'));
 assert(source.includes('await assert.rejects(parseOperationalPunchResult(recovered,{...expected,command:changedCommand}))'));
 assert(source.includes("operationalPunchCommandFingerprint(d.site,'self',d.auth"));
 assert(source.includes('first.operation.commandFingerprint'));
});

test('24290s lifetime/150 steps/10sSQL/3slocks; close before full fact/function/catalog/archive checks',()=>{
 assert(source.includes('native.connect({lifetimeMs:90000})'));assert(source.includes('assert(++steps<=150'));
 assert(source.includes("set local lock_timeout='3s';set local statement_timeout='10s'"));
 assert(source.includes("if(!rolledBack)await connection.step('rollback;')"));
 assert(source.indexOf('await connection.close()')<source.indexOf('assert.equal(d.fingerprint(),baseline)'));
 for(const text of ['d.definitions(),definitions','d.tableCatalog(),catalog','periodContinuationArchiveBytes(await archive()),oldArchive','periodContinuationArchiveBytes(await periodArchive()),oldPeriod'])assert(source.includes(text));
 assert(source.includes('lastStepFailure=String(error?.stack??error).slice(0,10000)'));
});

test('242 wrong synthetic ownership stops before opening a connection',async()=>{
 let connected=false;
 await assert.rejects(verifyOperationalPunchNative({d:{syntheticOnly:false},h:{syntheticOnly:true},native:{connect(){connected=true;}}}));
 assert.equal(connected,false);
});

test('242 mocked first SQL failure rolls back/closes then verifies complete baseline without a DB',async()=>{
 const owned={schema:'attendance_race_'+'a'.repeat(32),oid:42,tableOid:43,owner:'postgres',marker:'faolla-synthetic-concurrency:'+id(1)};
 const body='{}',a={artifactText:body,artifactBytes:2,artifactSha256:createHash('sha256').update(body).digest('hex'),artifact:{}};
 const calls=[];let opened=false,closed=false,hashCalls=0;
 const d={syntheticOnly:true,owned,site:'99990001',owner:id(1),worker:id(2),employee:id(3),auth:id(4),location:id(5),terminal:id(6),guard:'',inventory:()=>['merchants'],
  fingerprint:()=>{hashCalls++;if(opened)assert(closed,'external baseline read must not wait on owned locks');return 'same';},definitions:()=> 'defs',tableCatalog:()=> 'catalog'};
 const native={query:()=>JSON.stringify(owned),connect:options=>{assert.deepEqual(options,{lifetimeMs:90000});opened=true;return {
  step:async sql=>{calls.push(sql);if(sql==='rollback;')return '';throw Error('synthetic242_step_failure');},close:async()=>{closed=true;}};}};
 await assert.rejects(verifyOperationalPunchNative({d,h:{syntheticOnly:true},native,scope:{schema:owned.schema,sql:s=>s},archive:async()=>a,periodArchive:async()=>a}),/synthetic242_step_failure/);
 assert.equal(calls.length,2);assert(calls[0].startsWith('begin;'));assert.equal(calls[1],'rollback;');assert(closed);assert.equal(hashCalls,2);
});
