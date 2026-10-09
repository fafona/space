// Actual old clocks -> new wrappers -> private shift binder, in an explicitly
// owned synthetic namespace. Import is inert; root alone owns PG lifecycle.
import assert from 'node:assert/strict';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {performance} from 'node:perf_hooks';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {runAttendanceLabelsReuse} from './merchant-attendance-choice-labels-reuse-native.mjs';
import {withAttendanceConcurrencySandbox} from './merchant-attendance-concurrency-sandbox.mjs';
import {prepareBoundClocksNativeFixture,boundClockMigrationBody,boundClockRpcExpression,boundClockQuotaSeed,boundClockPersonalDensitySeed,quote} from './fixtures/attendance-bound-clocks-native.mjs';
import {groupsQueryInput,groupsNativeSave} from './merchant-attendance-groups-native.mjs';
import {personalRulesQueryInput,personalRulesNativeApprove} from './merchant-attendance-personal-rules-native.mjs';
import {lifecycleJson as json} from './merchant-attendance-lifecycle-native-support.mjs';

export {prepareBoundClocksNativeFixture};
export const boundClockNativeLabels=Object.freeze([
  'strict dispatcher disabled path calls the original RPC and never back-binds its event on replay',
  'actual self clock binds once, retains its snapshot through breaks/close/replay and deduplicates two new shifts',
  'actual PIN KDF and lease finish preserve wrong-PIN consumption, same receipt replay and one new start binding',
  'actual onsite signature and nonce checks bind one new start while duplicate nonce cannot create another event',
  'actual location preparation and old v1 subcall bind once; safe finish and a legacy start never back-bind',
  'current inactive group produces explicit unverified binding without rejecting the actual clock event',
  'later real personal/group writes leave original replay bytes unchanged while the next shift observes new source versions',
  'private append-only binding/source ACLs, old definitions and per-clock source/business fingerprints stay intact',
  'pure SQL field choices retain zero/disabled/inherit/missing distinctions and Madrid 23/25-hour half-open UTC day boundaries',
  'owned rollback quota fixture keeps a successful actual clock event explicitly unverified at 256 worker artifacts',
  'owned rollback dense personal history verifies100 total inspected sources and keeps clock success explicitly unverified above the candidate cap',
]);
const newMigrations=['202610040133_merchant_attendance_shift_rule_bindings.sql','202610040134_merchant_attendance_bound_clocks.sql'];
const flags=['FAOLLA_ATTENDANCE_RULE_BINDINGS_ENABLED','FAOLLA_ATTENDANCE_RULE_BINDINGS_SITE_IDS','FAOLLA_ATTENDANCE_PIN_PEPPER','FAOLLA_ATTENDANCE_ONSITE_QR_SECRET'];
let phase='entry';
export function boundClockNativeFailure(error){
  const message=error instanceof Error?error.message:'',code=message.match(/(?:ERROR:\s+|^)(attendance_[a-z_]+|merchant_attendance_[a-z_]+)(?=\r?\n|$)/)?.[1];
  return {error:'bound_clock_native_failed',phase,code:code??'local_check_failed'};
}
export async function checkAttendanceBoundClocksNative(native,scope){
  phase='minimal-owned-fixture';const d=await prepareBoundClocksNativeFixture(native,scope),{exec,owned,site,owner,worker,employee,auth,geoWorker,geoEmployee,geoAuth,plainLocation,geoLocation,terminal}=d;
  const functionOids=exec(`select array_agg(oid order by oid)::text from pg_proc where pronamespace=${owned.oid} and prokind='f';`);
  const oldDefinitions=()=>exec(`select md5(jsonb_agg(jsonb_build_array(oid,pg_get_functiondef(oid),proowner,proacl,proconfig,prosecdef) order by oid)::text) from pg_proc where oid=any(${quote(functionOids)}::oid[]);`);
  const oldBefore=oldDefinitions();phase='install133134';for(const name of newMigrations)exec(boundClockMigrationBody(native.root,name));
  assert.equal(oldDefinitions(),oldBefore,'binding_install_changed_old_definitions');
  const definitions=()=>exec(`select md5(jsonb_agg(jsonb_build_array(oid,pg_get_functiondef(oid),proowner,proacl,proconfig,prosecdef) order by oid)::text) from pg_proc where pronamespace=${owned.oid} and prokind='f';`);
  const installed=definitions();for(const name of newMigrations)exec(boundClockMigrationBody(native.root,name));assert.equal(definitions(),installed,'binding_reapply_changed_definition');
  const tables=JSON.parse(exec(`select jsonb_agg(relname order by relname) from pg_class where relnamespace=${owned.oid} and relkind in('r','p');`));
  const allowed=new Set(['merchant_attendance_events','merchant_attendance_location_results','merchant_attendance_location_clock_notices','merchant_attendance_pin_clock_receipts',
    'merchant_attendance_onsite_receipts','merchant_attendance_pin_attempts','merchant_attendance_pin_credentials','merchant_attendance_shift_rule_bindings','merchant_attendance_shift_rule_sources']);
  const businessTables=tables.filter(table=>!allowed.has(table));
  const fingerprint=selected=>exec(`select md5(jsonb_build_object(${selected.map(table=>`${quote(table)},(select coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text),'[]'::jsonb) from public.${table} r)`).join(',')})::text);`);
  const businessFingerprint=()=>fingerprint(businessTables),events=()=>Number(exec('select count(*) from public.merchant_attendance_events;'));
  const counts=()=>JSON.parse(exec("select jsonb_build_object('bindings',(select count(*) from public.merchant_attendance_shift_rule_bindings),'sources',(select count(*) from public.merchant_attendance_shift_rule_sources));"));
  assert.equal(events(),0);assert.deepEqual(counts(),{bindings:0,sources:0});
  const binding=event=>JSON.parse(exec(`select jsonb_build_object('binding',to_jsonb(b),'source',to_jsonb(s),'graph',s.source_text::jsonb)
    from public.merchant_attendance_shift_rule_bindings b left join public.merchant_attendance_shift_rule_sources s on s.merchant_id=b.merchant_id and s.source_id=b.source_id where b.start_event_id=${quote(event)};`));
  const absent=event=>assert.equal(exec(`select count(*) from public.merchant_attendance_shift_rule_bindings where start_event_id=${quote(event)};`),'0');
  const verified=(event,channel,requestAuth,employeeId)=>{
    const value=binding(event),b=value.binding,s=value.source;
    assert.equal(b.status,'verified');assert.equal(b.channel,channel);assert.equal(b.request_auth_user_id,requestAuth);assert.equal(b.employee_id,employeeId);
    assert.equal(b.employee_auth_user_id,employeeId===employee?auth:geoAuth);assert.equal(b.start_event_id,event);assert.equal(s.source_id,b.source_id);
    assert.equal(s.source_bytes,Buffer.byteLength(s.source_text,'utf8'));assert.equal(s.source_sha256,createHash('sha256').update(s.source_text,'utf8').digest('hex'));
    assert.equal(value.graph.protocol,'shift-rule-point-v1');assert.equal(value.graph.algorithmVersion,'personal-group-enterprise-point-v1');assert.equal(value.graph.bindingPolicy,'clock-in-whole-shift-v1');
    assert.equal(b.binding_policy,'clock-in-whole-shift-v1');assert.equal(value.graph.fields.lateGraceMinutes.state,'value');
    return value;
  };
  const require=createRequire(import.meta.url),{executeAttendanceSelf}=require('../src/lib/merchantAttendanceSelf.server.ts'),{executeAttendanceLocationClock}=require('../src/lib/merchantAttendanceLocationClock.server.ts');
  const {executePinAdmin}=require('../src/lib/merchantAttendancePin.server.ts'),{executePinClock}=require('../src/lib/merchantAttendancePinClock.server.ts');
  const {executeOnsiteIssue,executeOnsiteClock}=require('../src/lib/merchantAttendanceOnsiteQr.server.ts');
  const calls=[];
  const service={rpc:async(name,args)=>{
    calls.push(name);try{return {data:JSON.parse(exec(`set local role service_role;select ${boundClockRpcExpression(name,args)};`)),error:null};}
    catch(error){const code=String(error).match(/ERROR:\s+(attendance_[a-z_]+)/)?.[1];if(!code)throw error;return {data:null,error:{message:code}};}
  }};
  const unchanged=async run=>{const before=businessFingerprint();try{return await run();}finally{assert.equal(businessFingerprint(),before,'clock_changed_rule_or_other_business_sources');assert.equal(definitions(),installed,'clock_changed_function_definition');}};
  const basic=(action,seq,operationId=randomUUID())=>({expectedWorkerId:worker,operationId,locationId:plainLocation,action,expectedSequence:seq});
  const self=command=>unchanged(()=>executeAttendanceSelf({siteId:site,authUserId:auth,command,operationId:null},service));
  const pinCommand=(action,seq,operationId=randomUUID())=>({...basic(action,seq,operationId),expectedEmployeeId:employee});
  const pin=command=>unchanged(()=>executePinClock({siteId:site,terminalId:terminal,secret:d.secret,workerNo:'GROUP-A',pin:d.pin,allowNew:true,command,operationId:null},service));
  const resetPin=()=>exec(`update public.merchant_attendance_pin_credentials set attempts=0,window_at=clock_timestamp() where merchant_id='${site}';update public.merchant_attendance_pin_attempts set attempts=0,window_at=clock_timestamp() where merchant_id='${site}';`);
  const issue=()=>executeOnsiteIssue({siteId:site,terminalId:terminal,secret:d.secret},service);
  const qr=(command,token)=>unchanged(()=>executeOnsiteClock({siteId:site,authUserId:auth,command,token,operationId:null,allowNew:true},service));
  const geoCommand=(action,seq,safe=false)=>({expectedWorkerId:geoWorker,operationId:randomUUID(),locationId:geoLocation,action,expectedSequence:seq,settingsVersion:1,workerVersion:1,locationVersion:1,
    noticeRevision:safe?null:1,safeFinish:safe,position:null,positionFailure:'not_provided'});
  const geo=command=>unchanged(()=>executeAttendanceLocationClock({siteId:site,authUserId:geoAuth,expectedWorkerId:geoWorker,operationId:null,command,moduleEnabled:true},service));
  const previous=new Map(flags.map(key=>[key,process.env[key]])),denseClockElapsedMs={complete100:null,limited101Personal:null};
  try{
    process.env.FAOLLA_ATTENDANCE_PIN_PEPPER=randomBytes(32).toString('base64url');process.env.FAOLLA_ATTENDANCE_ONSITE_QR_SECRET=randomBytes(32).toString('hex');
    process.env.FAOLLA_ATTENDANCE_RULE_BINDINGS_SITE_IDS=site;delete process.env.FAOLLA_ATTENDANCE_RULE_BINDINGS_ENABLED;
    await executePinAdmin({siteId:site,authUserId:owner,workerNo:'GROUP-A',operationId:null,allowSet:true,command:{action:'set',operationId:randomUUID(),expectedRevision:0,workerId:worker,employeeId:employee,pin:d.pin,salt:randomBytes(16).toString('hex')}},service);
    phase='off-original-path';const legacy=basic('clock_in',0),old=await self(legacy);assert.equal(calls.at(-1),'faolla_attendance_self_v1');absent(old.receipt.id);
    await self(basic('clock_out',1));process.env.FAOLLA_ATTENDANCE_RULE_BINDINGS_ENABLED='1';
    assert.equal((await self(legacy)).replayed,true);absent(old.receipt.id);assert.equal(events(),2);native.pass(boundClockNativeLabels[0]);

    phase='self-binding-dedup';const command=basic('clock_in',2),first=await self(command);assert.equal(calls.at(-1),'faolla_attendance_self_bound_v1');
    const original=verified(first.receipt.id,'self',auth,employee);assert.equal(original.graph.fields.lateGraceMinutes.minutes,0);assert.equal(original.graph.fields.earlyGraceMinutes.state,'disabled');
    assert.equal((await self(command)).replayed,true);assert.deepEqual(binding(first.receipt.id),original);
    await self(basic('break_start',3));await self(basic('break_end',4));await self(basic('clock_out',5));assert.equal(counts().bindings,1);
    const second=await self(basic('clock_in',6)),secondBinding=verified(second.receipt.id,'self',auth,employee);assert.equal(secondBinding.source.source_id,original.source.source_id);
    await self(basic('clock_out',7));assert.deepEqual(binding(first.receipt.id),original);assert.deepEqual(counts(),{bindings:2,sources:1});native.pass(boundClockNativeLabels[1]);

    phase='pin';const pinStart=pinCommand('clock_in',8),p=await pin(pinStart);assert.equal(calls.at(-1),'faolla_attendance_pin_clock_bound_v1');verified(p.receipt.id,'pin',null,employee);
    assert.equal((await pin(pinStart)).replayed,true);const beforeWrong=events();
    await assert.rejects(unchanged(()=>executePinClock({siteId:site,terminalId:terminal,secret:d.secret,workerNo:'GROUP-A',pin:'11111111',allowNew:true,command:pinCommand('break_start',9),operationId:null},service)),/attendance_pin_denied/);
    assert.equal(events(),beforeWrong);assert.equal(exec(`select count(*) from public.merchant_attendance_pin_attempts where merchant_id='${site}' and lease_id is not null;`),'0');resetPin();
    await pin(pinCommand('break_start',9));await pin(pinCommand('break_end',10));await pin(pinCommand('clock_out',11));assert.equal(counts().bindings,3);resetPin();native.pass(boundClockNativeLabels[2]);

    phase='onsite';const issued=await issue(),qrStart=pinCommand('clock_in',12),q=await qr(qrStart,issued.token);assert.equal(calls.at(-1),'faolla_attendance_onsite_clock_bound_v1');verified(q.receipt.id,'onsite',auth,employee);
    assert.equal((await qr(qrStart,issued.token)).replayed,true);const beforeNonce=events();
    await assert.rejects(qr(pinCommand('break_start',13),issued.token),/attendance_qr_used/);assert.equal(events(),beforeNonce);
    await qr(pinCommand('clock_out',13),(await issue()).token);assert.equal(counts().bindings,4);native.pass(boundClockNativeLabels[3]);

    phase='location-safe-finish';delete process.env.FAOLLA_ATTENDANCE_RULE_BINDINGS_ENABLED;
    const oldGeo=await geo(geoCommand('clock_in',0));absent(oldGeo.receipt.id);process.env.FAOLLA_ATTENDANCE_RULE_BINDINGS_ENABLED='1';
    await geo(geoCommand('clock_out',1,true));absent(oldGeo.receipt.id);
    const geoStart=geoCommand('clock_in',2),g=await geo(geoStart);assert.equal(calls.at(-1),'faolla_attendance_location_clock_bound_v1');
    const geoBinding=verified(g.receipt.id,'location',geoAuth,geoEmployee);assert.equal(geoBinding.graph.fields.lateGraceMinutes.minutes,12);
    assert.equal((await geo(geoStart)).replayed,true);await geo(geoCommand('clock_out',3,true));assert.deepEqual(binding(g.receipt.id),geoBinding);assert.equal(counts().bindings,5);
    assert.equal(exec('select count(*) from public.merchant_attendance_location_results;'),'4');assert.equal(exec('select count(*) from public.merchant_attendance_location_clock_notices;'),'4');native.pass(boundClockNativeLabels[4]);

    phase='dense-personal-owned-rollback';const beforeDensity=fingerprint(tables),densityConnection=native.connect();
    try{
      await densityConnection.step(scope.sql(`begin;${d.foundation.plan.guard}`));
      // Keep synthetic CHECK/zone work in twelve small bounded steps; the actual
      // measured clock remains one unmodified RPC under its normal timeout.
      for(let batch=0;batch<12;batch++)await densityConnection.step(scope.sql(boundClockPersonalDensitySeed(d.templates.personalWithdrawal,8)));
      const densityService={rpc:async(name,args)=>{calls.push(name);return {data:JSON.parse(await densityConnection.step(scope.sql(`set local role service_role;select ${boundClockRpcExpression(name,args)};reset role;`))),error:null};}};
      const densityClock=async command=>executeAttendanceSelf({siteId:site,authUserId:auth,command,operationId:null},densityService);
      const inspect=async eventId=>JSON.parse(await densityConnection.step(scope.sql(`select jsonb_build_object('status',b.status,'reason',b.reason,'sourceId',b.source_id,
        'lateMinutes',s.source_text::jsonb->'fields'->'lateGraceMinutes'->'minutes','personalRevision',s.source_text::jsonb->'personal'->'revision',
        'approvals',(select count(*) from public.merchant_attendance_personal_rule_operations where action='approve'),
        'withdrawals',(select count(*) from public.merchant_attendance_personal_rule_operations where action='withdraw'))
        from public.merchant_attendance_shift_rule_bindings b left join public.merchant_attendance_shift_rule_sources s on s.merchant_id=b.merchant_id and s.source_id=b.source_id where b.start_event_id='${eventId}';`)));
      let started=performance.now();const dense=await densityClock(basic('clock_in',14));denseClockElapsedMs.complete100=Number((performance.now()-started).toFixed(3));
      assert.equal(dense.state.status,'working');const denseState=await inspect(dense.receipt.id);
      assert.equal(denseState.status,'verified');assert.equal(denseState.reason,null);assert.equal(denseState.sourceId,dense.receipt.id);
      assert.equal(denseState.lateMinutes,0);assert.equal(denseState.personalRevision,193);assert.equal(denseState.approvals,97);assert.equal(denseState.withdrawals,96);
      await densityClock(basic('clock_out',15));await densityConnection.step(scope.sql(boundClockPersonalDensitySeed(d.templates.personalWithdrawal,4)));
      started=performance.now();const capped=await densityClock(basic('clock_in',16));denseClockElapsedMs.limited101Personal=Number((performance.now()-started).toFixed(3));
      assert.equal(capped.state.status,'working');assert.deepEqual(await inspect(capped.receipt.id),{status:'unverified',reason:'source_cap',sourceId:null,lateMinutes:null,personalRevision:null,approvals:101,withdrawals:100});
    }finally{await densityConnection.close();}
    assert.equal(fingerprint(tables),beforeDensity,'density_rollback_changed_fixture');native.pass(boundClockNativeLabels[10]);

    phase='source-conflict';d.foundation.call(groupsQueryInput({groupId:d.group}),groupsNativeSave(7201,{groupId:d.group,expectedRevision:1,active:false,name:'Synthetic inactive group'}),true);
    const unresolved=await self(basic('clock_in',14)),failure=binding(unresolved.receipt.id);assert.equal(unresolved.state.status,'working');
    assert.equal(failure.binding.status,'unverified');assert.equal(failure.binding.reason,'inactive_group');assert.equal(failure.binding.source_id,null);assert.equal(failure.source,null);
    await self(basic('clock_out',15));assert.equal(counts().bindings,6);assert.deepEqual(binding(first.receipt.id),original);native.pass(boundClockNativeLabels[5]);

    phase='future-personal-current-group';const personal=personalRulesNativeApprove(8002,1,d.day(10),d.day(10),{rules:{lateGraceMinutes:{mode:'value',minutes:9},earlyGraceMinutes:{mode:'inherit'},openSpanWarningMinutes:{mode:'inherit'},completedBreakMinimumMinutes:{mode:'inherit'}}});
    exec(`set local role service_role;select public.faolla_attendance_personal_rules_v1(${json(personalRulesQueryInput())},'${owner}',${json(personal)},true);`);
    d.foundation.call(groupsQueryInput({groupId:d.group}),groupsNativeSave(7202,{groupId:d.group,expectedRevision:2,active:true,name:'Synthetic restored group'}),true);
    const beforeReplay=counts();assert.equal((await self(command)).replayed,true);assert.deepEqual(counts(),beforeReplay);assert.deepEqual(binding(first.receipt.id),original);
    const changed=await self(basic('clock_in',16)),changedBinding=verified(changed.receipt.id,'self',auth,employee);assert.notEqual(changedBinding.source.source_sha256,original.source.source_sha256);
    assert.equal(changedBinding.graph.fields.lateGraceMinutes.minutes,0,'future personal approval must not replace currently selected original');await self(basic('clock_out',17));
    assert.deepEqual(binding(first.receipt.id),original);native.pass(boundClockNativeLabels[6]);

    phase='pure-fields-utc-boundaries';const pureBefore=fingerprint(tables);
    const fields=point=>JSON.parse(exec(`select public.faolla_attendance_shift_rule_fields_v1(${json(point)});`));
    const resolved=fields(original.graph);assert.equal(resolved.lateGraceMinutes.minutes,0);assert.equal(resolved.lateGraceMinutes.source.layer,'personal');
    assert.equal(resolved.earlyGraceMinutes.state,'disabled');assert.equal(resolved.earlyGraceMinutes.minutes,null);assert.equal(resolved.earlyGraceMinutes.source.layer,'group');
    assert.equal(resolved.openSpanWarningMinutes.minutes,120);assert.equal(resolved.openSpanWarningMinutes.source.layer,'enterprise');
    assert.deepEqual(resolved.openSpanWarningMinutes.trace.map(t=>t.mode),['inherit','inherit','value']);
    const missing=fields({personal:{revision:0,approval:null},group:null,enterprise:{revision:0,publication:null}});
    for(const field of Object.values(missing)){assert.equal(field.state,'unconfigured');assert.equal(field.minutes,null);assert.equal(field.source,null);assert.deepEqual(field.trace.map(t=>t.mode),['missing_approval','no_assignment','missing_publication']);}
    const inherit=structuredClone(original.graph);inherit.personal.approval=null;inherit.enterprise.publication.rules.lateGraceMinutes={mode:'inherit'};
    assert.equal(fields(inherit).lateGraceMinutes.state,'unconfigured','latest inherit must not invent an earlier publication or implicit default');
    const disabled=structuredClone(original.graph);disabled.personal.approval.rules.completedBreakMinimumMinutes={mode:'disabled'};
    assert.equal(fields(disabled).completedBreakMinimumMinutes.state,'disabled');assert.equal(fields(disabled).completedBreakMinimumMinutes.source.layer,'personal');
    const boundaries=JSON.parse(exec(`select jsonb_build_object(
      'springStart',to_char(public.faolla_attendance_rule_day_start_v1('2026-03-29','Europe/Madrid') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'springEnd',to_char(public.faolla_attendance_personal_rule_end_v1('2026-03-29','Europe/Madrid') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'fallStart',to_char(public.faolla_attendance_rule_day_start_v1('2026-10-25','Europe/Madrid') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'fallEnd',to_char(public.faolla_attendance_personal_rule_end_v1('2026-10-25','Europe/Madrid') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));`));
    assert.deepEqual(boundaries,{springStart:'2026-03-28T23:00:00.000000Z',springEnd:'2026-03-29T22:00:00.000000Z',fallStart:'2026-10-24T22:00:00.000000Z',fallEnd:'2026-10-25T23:00:00.000000Z'});
    const inside=(at,start,end)=>at>=start&&at<end;
    assert(inside(boundaries.springStart,boundaries.springStart,boundaries.springEnd));assert(!inside(boundaries.springEnd,boundaries.springStart,boundaries.springEnd));
    assert.equal(Date.parse(boundaries.springEnd)-Date.parse(boundaries.springStart),23*3600000);assert.equal(Date.parse(boundaries.fallEnd)-Date.parse(boundaries.fallStart),25*3600000);
    assert.equal(fingerprint(tables),pureBefore);native.pass(boundClockNativeLabels[8]);

    phase='quota-owned-rollback';const beforeQuota=fingerprint(tables),quotaConnection=native.connect();
    try{
      await quotaConnection.step(scope.sql(`begin;${d.foundation.plan.guard}`));
      await quotaConnection.step(scope.sql(boundClockQuotaSeed(original.source.source_id)));
      // A real new current group revision requires a new artifact; unchanged
      // hashes would legitimately deduplicate even when the quota is full.
      await quotaConnection.step(scope.sql(`set local role service_role;select public.faolla_attendance_groups_v1(${json(groupsQueryInput({groupId:d.group}))},'${owner}',${json(groupsNativeSave(7203,{groupId:d.group,expectedRevision:3,active:true,name:'Synthetic rollback quota context'}))},true);reset role;`));
      const quotaService={rpc:async(name,args)=>{calls.push(name);return {data:JSON.parse(await quotaConnection.step(scope.sql(`set local role service_role;select ${boundClockRpcExpression(name,args)};reset role;`))),error:null};}};
      const quotaClock=await executeAttendanceSelf({siteId:site,authUserId:auth,command:basic('clock_in',18),operationId:null},quotaService);
      assert.equal(quotaClock.state.status,'working');assert.equal(calls.at(-1),'faolla_attendance_self_bound_v1');
      const quotaState=JSON.parse(await quotaConnection.step(scope.sql(`select jsonb_build_object('status',b.status,'reason',b.reason,'sourceId',b.source_id,
        'workerArtifacts',(select count(*) from public.merchant_attendance_shift_rule_sources where worker_id='${worker}'),
        'events',(select count(*) from public.merchant_attendance_events)) from public.merchant_attendance_shift_rule_bindings b where start_event_id='${quotaClock.receipt.id}';`)));
      assert.deepEqual(quotaState,{status:'unverified',reason:'source_quota',sourceId:null,workerArtifacts:256,events:23});
    }finally{await quotaConnection.close();}
    assert.equal(fingerprint(tables),beforeQuota,'quota_rollback_changed_fixture');native.pass(boundClockNativeLabels[9]);

    phase='private-immutable-final';const beforeAcl=fingerprint(tables);
    for(const role of ['anon','authenticated','service_role'])for(const table of ['merchant_attendance_shift_rule_bindings','merchant_attendance_shift_rule_sources'])
      assert.throws(()=>exec(`set local role ${role};select * from public.${table};`),/permission denied/);
    for(const role of ['anon','authenticated','service_role'])assert.throws(()=>exec(`set local role ${role};select public.faolla_attendance_bind_shift_rules_v1('${first.receipt.id}','self','${auth}');`),/permission denied/);
    for(const table of ['merchant_attendance_shift_rule_bindings','merchant_attendance_shift_rule_sources'])for(const statement of [`update public.${table} set merchant_id=merchant_id`,`delete from public.${table}`,`truncate public.${table}`])
      assert.throws(()=>exec(statement+';'),/append_only|permission denied|cannot truncate a table referenced in a foreign key constraint/);
    assert.equal(fingerprint(tables),beforeAcl);assert.equal(oldDefinitions(),oldBefore);assert.equal(definitions(),installed);
    assert.equal(events(),22);assert.equal(counts().bindings,7);assert.equal(exec("select count(*) from public.merchant_attendance_shift_rule_bindings b join public.merchant_attendance_events e on e.id=b.start_event_id where e.action<>'clock_in';"),'0');
    assert.equal(exec("select count(*) from public.merchant_attendance_pin_clock_receipts;"),'4');assert.equal(exec("select count(*) from public.merchant_attendance_onsite_receipts;"),'2');
    native.pass(boundClockNativeLabels[7]);
    return {passed:boundClockNativeLabels.length,labels:[...boundClockNativeLabels],eventCount:events(),...counts(),
      actualFourTypeScriptServices:true,actualFourLegacyClocksAndWrappers:true,syntheticPastRules:true,wallClockChanged:false,
      crossMidnightWaitTested:false,pureUtcDayBoundariesTested:true,quotaTested:true,quotaProbeRolledBack:true,densePersonalProbeRolledBack:true,denseClockElapsedMs,
      performanceSlaClaimed:false,productionAccess:false,realAuth:false,newCluster:false,oldDefinitionsUnchanged:true,
      sourceBusinessUnchangedByEachClock:true,callerOwnedNamespaceCleanup:true,rpcCalls:calls.length};
  }finally{for(const [key,value] of previous){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
}
export async function runAttendanceBoundClocksNative(args){return runAttendanceLabelsReuse(args,native=>withAttendanceConcurrencySandbox(native,async scope=>{
  const result=await checkAttendanceBoundClocksNative(native,scope);console.log(JSON.stringify({boundClocksNative:result}));
}));}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{await runAttendanceBoundClocksNative(process.argv.slice(2));}catch(error){console.error(JSON.stringify(boundClockNativeFailure(error)));process.exitCode=1;}
}
