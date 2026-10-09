// Pure/static contracts for the new acceptance. These tests do not start a
// database or claim that any native assertion ran; root owns that separate run.
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {boundClockFixtureMigrations,boundClockIdentity,boundClockRpcExpression,boundClockMigrationBody,boundClockPastSeed,boundClockQuotaSeed,boundClockPersonalDensitySeed,quote} from './fixtures/attendance-bound-clocks-native.mjs';
import {boundClockNativeLabels,boundClockNativeFailure,checkAttendanceBoundClocksNative,prepareBoundClocksNativeFixture} from './merchant-attendance-bound-clocks-native.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const source=readFileSync(new URL('./merchant-attendance-bound-clocks-native.mjs',import.meta.url),'utf8');
const fixture=readFileSync(new URL('./fixtures/attendance-bound-clocks-native.mjs',import.meta.url),'utf8');
const json=value=>`'${JSON.stringify(value)}'::jsonb`;

test('importing the fixture/check only exposes inert functions and eleven finite honest labels',()=>{
  assert.equal(typeof prepareBoundClocksNativeFixture,'function');assert.equal(typeof checkAttendanceBoundClocksNative,'function');
  assert(Object.isFrozen(boundClockNativeLabels));assert.equal(boundClockNativeLabels.length,11);assert.equal(new Set(boundClockNativeLabels).size,11);
  assert.match(source,/if\(process\.argv\[1\]&&path\.resolve\(process\.argv\[1\]\)===fileURLToPath\(import\.meta\.url\)\)/);
  assert.doesNotMatch(source,/\b(?:spawn|execFile|spawnSync|execSync|createServer|listen)\s*\(/);
});

test('fixture install allowlist includes the private130 validator dependency but no131/132 capture paths',()=>{
  assert(Object.isFrozen(boundClockFixtureMigrations));assert.equal(new Set(boundClockFixtureMigrations).size,boundClockFixtureMigrations.length);
  for(const name of boundClockFixtureMigrations){assert(existsSync(path.join(root,'scripts/supabase-migrations',name)));assert.doesNotMatch(boundClockMigrationBody(root,name),/^begin;\s*$|^commit;\s*$/m);}
  assert(boundClockFixtureMigrations.some(name=>/040130_/.test(name)));assert(!boundClockFixtureMigrations.some(name=>/040131_|040132_/.test(name)));
  assert.throws(()=>boundClockMigrationBody(root,'../bad.sql'));assert.throws(()=>boundClockMigrationBody('relative','202610040129_merchant_attendance_personal_rules.sql'));
});

test('SQL literal and RPC bridge preserve self command order and fail closed on an unknown function',()=>{
  assert.equal(quote(null),'null');assert.equal(quote("O'Hara"),"'O''Hara'");
  const args={p_site_id:'99990001',p_auth_user_id:'auth',p_command:{action:'clock_in'},p_operation_id:null};
  for(const name of ['faolla_attendance_self_v1','faolla_attendance_self_bound_v1'])assert.equal(boundClockRpcExpression(name,args),`public.${name}('99990001','auth',${json(args.p_command)},null)`);
  assert.throws(()=>boundClockRpcExpression('faolla_attendance_self_v1);drop table x;--',{}),/bound_clock_unexpected_rpc/);
});

test('location bridge carries exact assertion and admission/clock booleans for both old and bound RPC',()=>{
  const args={p_site_id:'site',p_auth_user_id:'auth',p_expected_worker_id:'worker',p_command:null,p_operation_id:'operation',p_assertion:{reason:'not_provided'},p_allow_new_sessions:true,p_require_clock:false};
  for(const name of ['faolla_attendance_location_clock_v2','faolla_attendance_location_clock_bound_v1'])assert.equal(boundClockRpcExpression(name,args),`public.${name}('site','auth','worker',null,'operation',${json(args.p_assertion)},true,false)`);
});

test('PIN bridge retains begin lease, verified finish and exact request without assigning an auth identity',()=>{
  const args={p_site:'site',p_terminal:'terminal',p_secret_hash:'hash',p_no:'workerNo',p_lease:'lease',p_verified:false,p_request:{command:null,operationId:'operation'},p_allow_new:true,p_allow:true};
  for(const name of ['faolla_attendance_pin_clock_v1','faolla_attendance_pin_clock_bound_v1'])assert.equal(boundClockRpcExpression(name,args),`public.${name}('site','terminal','hash','workerNo','lease',false,${json(args.p_request)},true)`);
  assert.equal(boundClockRpcExpression('faolla_attendance_pin_begin_v1',args),"public.faolla_attendance_pin_begin_v1('site','terminal','hash','workerNo','lease',true)");
});

test('onsite bridge keeps signed claims and original operation/admission parameter positions',()=>{
  const args={p_site:'site',p_auth:'auth',p_claims:{nonce:'nonce'},p_command:{action:'clock_in'},p_operation:null,p_allow_new:true};
  for(const name of ['faolla_attendance_onsite_clock_v1','faolla_attendance_onsite_clock_bound_v1'])assert.equal(boundClockRpcExpression(name,args),`public.${name}('site','auth',${json(args.p_claims)},${json(args.p_command)},null,true)`);
});

test('synthetic past seed uses actual future templates and appends checked snapshots without rewriting events or old ledger rows',()=>{
  const seed=boundClockPastSeed({streams:[],operations:[],personalStream:{},personalOperation:{}},'2026-10-04');
  assert.match(seed,/bound_clock_empty_rules_required/);assert.match(seed,/bound_clock_empty_personal_required/);
  for(const name of ['faolla_attendance_rule_item_v1','faolla_attendance_personal_rule_item_v1','faolla_attendance_rule_stream_checked_v1','faolla_attendance_personal_rule_receipt_v1'])assert(seed.includes(name));
  assert.doesNotMatch(seed,/\b(?:update|delete\s+from|truncate|alter|disable)\s+public\.|merchant_attendance_events|session_replication_role/i);
  assert.match(fixture,/faolla_attendance_rules_v1/);assert.match(fixture,/faolla_attendance_personal_rules_v1/);
  assert.match(fixture,/begin;\$\{foundation\.plan\.guard\}/);assert.match(fixture,/finally\{await connection\.close\(\);\}/);
  assert.match(fixture,/NOT a claim that wall time advanced/);
});

test('quota seed creates at most255 checked artifacts and never alters actual worker/event identity',()=>{
  const seed=boundClockQuotaSeed(boundClockIdentity.worker);
  assert.match(seed,/n between 1 and 255/);assert.match(seed,/for i in 1\.\.\(256-n\)/);assert.match(seed,/\{workerVersion\}/);
  assert.match(seed,/sha256\(convert_to\(body,'UTF8'\)\)/);assert.match(seed,/octet_length\(convert_to\(body,'UTF8'\)\)/);
  assert.doesNotMatch(seed,/\b(?:update|delete|truncate|alter|disable)\b|merchant_attendance_events|merchant_attendance_workers|session_replication_role/i);
  assert.throws(()=>boundClockQuotaSeed("bad';drop table x;--"));
  assert.match(source,/finally\{await quotaConnection\.close\(\);\}/);assert.match(source,/quota_rollback_changed_fixture/);
  assert.match(source,/reason:'source_quota',sourceId:null,workerArtifacts:256,events:23/);
});

test('dense personal fixture appends chronological withdraw-then-approve pairs with copied snapshots and bounded counts',()=>{
  const seed=boundClockPersonalDensitySeed({action:'withdraw',command:{action:'withdraw'}},96);
  assert.match(seed,/for i in 1\.\.96/);assert.match(seed,/withdrawn:=current_approval/);assert.match(seed,/withdrawn\.approved_revision:=current_approval\.revision/);
  assert(seed.indexOf('insert into public.merchant_attendance_personal_rule_operations select(withdrawn).*')<seed.indexOf('insert into public.merchant_attendance_personal_rule_operations select(next_approval).*'));
  assert.match(seed,/faolla_attendance_personal_rule_item_v1\(withdrawn\)/);assert.match(seed,/faolla_attendance_personal_rule_item_v1\(next_approval\)/);
  assert.match(seed,/perform public.faolla_attendance_personal_rule_stream_checked_v1\(head\)/);
  assert.doesNotMatch(seed,/\b(?:delete\s+from|truncate|alter|disable)\b|update public\.merchant_attendance_personal_rule_operations|session_replication_role/i);
  assert.throws(()=>boundClockPersonalDensitySeed({},96));assert.throws(()=>boundClockPersonalDensitySeed({action:'withdraw',command:{action:'withdraw'}},101));
  for(const marker of ['approvals:101,withdrawals:100','denseState.personalRevision,193','denseState.approvals,97','denseState.withdrawals,96',
    'for(let batch=0;batch<12;batch++)','finally{await densityConnection.close();}','density_rollback_changed_fixture','performanceSlaClaimed:false'])assert(source.includes(marker),marker);
});

test('all four checks call actual TypeScript services through the SQL bridge and include replay/PIN/nonce/safe-finish assertions',()=>{
  for(const method of ['executeAttendanceSelf','executeAttendanceLocationClock','executePinClock','executeOnsiteClock'])assert(source.includes(method));
  assert.match(source,/boundClockRpcExpression\(name,args\)/);assert.match(source,/JSON\.parse\(exec\(`/);
  for(const marker of ['attendance_pin_denied','lease_id is not null','attendance_qr_used',"geoCommand('clock_out',1,true)","assert.equal((await self(legacy)).replayed,true)","assert.deepEqual(counts(),{bindings:2,sources:1})"])assert(source.includes(marker),marker);
});

test('fingerprints surround each clock, compare old definitions/reapply, and verify exact persistent event/receipt counts',()=>{
  for(const marker of ['binding_install_changed_old_definitions','binding_reapply_changed_definition','clock_changed_rule_or_other_business_sources','clock_changed_function_definition',
    'assert.equal(events(),22)','assert.equal(counts().bindings,7)',"merchant_attendance_pin_clock_receipts;\"),'4'","merchant_attendance_onsite_receipts;\"),'2'"])assert(source.includes(marker),marker);
  assert.match(source,/for\(const role of \['anon','authenticated','service_role'\]\)/);
  assert.match(source,/assert\.equal\(fingerprint\(tables\),beforeAcl\)/);
});

test('pure rule/DST checks distinguish missing from zero and report no actual midnight wait or real authorization',()=>{
  for(const marker of ["['inherit','inherit','value']","['missing_approval','no_assignment','missing_publication']","springStart:'2026-03-28T23:00:00.000000Z'","fallEnd:'2026-10-25T23:00:00.000000Z'",
    '23*3600000','25*3600000','crossMidnightWaitTested:false','syntheticPastRules:true','wallClockChanged:false','realAuth:false','productionAccess:false','quotaProbeRolledBack:true'])assert(source.includes(marker),marker);
});

test('all process flags are restored and diagnostics never expose SQL text or synthetic credentials',()=>{
  assert.match(source,/finally\{for\(const \[key,value\] of previous\)/);assert.match(source,/if\(value===undefined\)delete process\.env\[key\];else process\.env\[key\]=value/);
  assert.match(source,/withAttendanceConcurrencySandbox\(native,async scope/);
  assert.deepEqual(boundClockNativeFailure(Error('password secret SQL select foo')),{error:'bound_clock_native_failed',phase:'entry',code:'local_check_failed'});
  assert.equal(boundClockNativeFailure(Error('ERROR: attendance_access_denied\nDETAIL secret')).code,'attendance_access_denied');
});
