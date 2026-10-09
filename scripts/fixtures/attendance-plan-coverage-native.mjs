//164 preparation only; root owns PG and the exact synthetic namespace.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';
import {prepareShiftCheckNativeFixture} from './attendance-shift-check-native.mjs';
import {selfScheduleExpression} from './attendance-self-schedule-native.mjs';
import {boundClockRpcExpression,quote} from './attendance-bound-clocks-native.mjs';
import {lifecycleId as id,lifecycleJson as json} from '../merchant-attendance-lifecycle-native-support.mjs';

export const planCoverageMigration='202610050139_merchant_attendance_plan_coverage.sql';
export const planCoverageRpc='faolla_attendance_plan_coverage_v1';
export const planCoverageExpression=(query,actor)=>`public.${planCoverageRpc}(${json(query)},${quote(actor)})`;
const require=createRequire(import.meta.url);
export async function preparePlanCoverageNativeFixture(native,scope){
  const d=await prepareShiftCheckNativeFixture(native,scope);await d.finishOpen();
  const {exec,site,owner,worker,auth,plainLocation,geoWorker,geoEmployee,geoAuth}=d;
  const beforeOids=exec(`select array_agg(oid order by oid)::text from pg_proc where pronamespace=${d.owned.oid} and prokind='f';`);
  const oldDefinitions=()=>exec(`select md5(jsonb_agg(jsonb_build_array(oid,pg_get_functiondef(oid),proowner,proacl,proconfig,prosecdef) order by oid)::text) from pg_proc where oid=any(${quote(beforeOids)}::oid[]);`);
  const oldDefs=oldDefinitions(),business=d.inventory().filter(t=>t!=='faolla_schema_migrations'),facts=d.fingerprint(business);
  const indexes=()=>JSON.parse(exec(`select coalesce(jsonb_agg(jsonb_build_array(c.oid,c.relname,pg_get_indexdef(c.oid),i.indisvalid,i.indisready) order by c.oid),'[]') from pg_class c join pg_index i on i.indexrelid=c.oid where c.relnamespace=${d.owned.oid};`));
  const beforeIndexes=indexes();
  const install=()=>{exec('select 1;');native.query(scope.sql(readFileSync(path.join(native.root,'scripts/supabase-migrations',planCoverageMigration),'utf8')));};
  //139 contains a concurrent-index phase. Never wrap or strip its transactions.
  install();assert.equal(oldDefinitions(),oldDefs);assert.equal(d.fingerprint(business),facts);
  const afterIndexes=indexes(),addedIndexes=afterIndexes.filter(i=>!beforeIndexes.some(old=>old[0]===i[0]));
  assert.equal(addedIndexes.length,1);assert.equal(addedIndexes[0][1],'attendance_shift_schedule_slot_idx');assert.equal(addedIndexes[0][3],true);assert.equal(addedIndexes[0][4],true);
  assert.deepEqual(afterIndexes.filter(i=>beforeIndexes.some(old=>old[0]===i[0])),beforeIndexes);
  const installed=d.definitions(),installedFacts=d.fingerprint();install();assert.equal(d.definitions(),installed);assert.equal(d.fingerprint(),installedFacts);assert.deepEqual(indexes(),afterIndexes);
  let nextId=164000;const next=()=>id(++nextId),head=()=>Number(exec(`select max(revision) from public.merchant_attendance_schedule_commands where merchant_id='${site}';`));
  const scheduleQuery={siteId:site,access:'owner',workerId:worker,fromDate:d.day(1),throughDate:d.day(1),operationId:null};
  const publish=(hour,evidenced=true)=>{const command={action:'publish',operationId:next(),expectedRevision:head(),expectedSettingsVersion:1,reason:'Synthetic164 actual future publication',
    locationId:plainLocation,timeZone:'UTC',slots:[[`${d.day(1)}T${hour}:00:00.000Z`,`${d.day(1)}T${String(Number(hour)+1).padStart(2,'0')}:00:00.000Z`]]};
    const raw=JSON.parse(exec(`set local role service_role;select public.${evidenced?'faolla_attendance_schedule_evidenced_v1':'faolla_attendance_schedule_v1'}(${json(scheduleQuery)},'${owner}',${json(command)},true);`));
    return raw.entries.find(s=>s.revision===command.expectedRevision+1);};
  const zero=publish('10'),legacy=publish('12',false);
  // ONE explicitly synthetic historical plan, copied from a REAL136 template.
  // Its publication time remains now: this is NOT proof of past publication.
  // It belongs to the OTHER existing synthetic worker, whose earlier original
  // events end two days ago. Moving today's later main-worker session into
  // yesterday would correctly fail086 overlap_previous. Never bypass that check.
  // All FK/CHECK/insert guards remain enabled, and no existing row is updated.
  const historicalId=next(),historicalOperation=next(),historicalRevision=head()+1;
  exec(`do $historical$ declare c public.merchant_attendance_schedule_commands%rowtype;s public.merchant_attendance_schedule_slots%rowtype;
    e public.merchant_attendance_schedule_publication_evidence%rowtype;begin
    select * into strict c from public.merchant_attendance_schedule_commands where merchant_id='${site}' and revision=${zero.revision};
    select * into strict s from public.merchant_attendance_schedule_slots where merchant_id='${site}' and id='${zero.id}';
    select * into strict e from public.merchant_attendance_schedule_publication_evidence where merchant_id='${site}' and revision=${zero.revision};
    c.revision:=${historicalRevision};c.operation_id:='${historicalOperation}';c.recorded_at:=clock_timestamp();
    c.query:=jsonb_set(jsonb_set(c.query,'{fromDate}',to_jsonb('${d.day(-1)}'::text)),'{throughDate}',to_jsonb('${d.day(-1)}'::text));
    c.query:=jsonb_set(c.query,'{workerId}',to_jsonb('${geoWorker}'::text));
    c.command:=c.command||jsonb_build_object('operationId',c.operation_id,'expectedRevision',c.revision-1,'reason','Synthetic historical plan, not an actual past publication',
      'slots',jsonb_build_array(jsonb_build_array('${d.day(-1)}T12:00:00.000Z','${d.day(-1)}T14:00:00.000Z')));
    s.id:='${historicalId}';s.revision:=c.revision;s.worker_id:='${geoWorker}';s.employee_id:='${geoEmployee}';
    select display_name into strict s.worker_name from public.merchant_attendance_workers where merchant_id='${site}' and id='${geoWorker}';
    s.work_date:='${d.day(-1)}';s.start_at:='${d.day(-1)}T12:00:00.000Z';s.end_at:='${d.day(-1)}T14:00:00.000Z';
    e.revision:=c.revision;e.operation_id:=c.operation_id;e.published_at:=c.recorded_at;e.recorded_at:=clock_timestamp();
    e.worker_id:='${geoWorker}';e.employee_id:='${geoEmployee}';e.employee_auth_user_id:='${geoAuth}';
    select version into strict e.worker_version from public.merchant_attendance_workers where merchant_id='${site}' and id='${geoWorker}';
    e.slots:=jsonb_build_array(jsonb_build_object('id',s.id,'workDate','${d.day(-1)}','startAt','${d.day(-1)}T12:00:00.000Z','endAt','${d.day(-1)}T14:00:00.000Z'));
    insert into public.merchant_attendance_schedule_commands select(c).*;insert into public.merchant_attendance_schedule_slots select(s).*;
    insert into public.merchant_attendance_schedule_publication_evidence select(e).*;set constraints all immediate;end;$historical$;`);
  const historical=JSON.parse(exec(`select public.faolla_attendance_self_schedule_slot_v1(s)->'slot' from public.merchant_attendance_schedule_slots s where merchant_id='${site}' and id='${historicalId}';`));
  const slots={future:d.slot,zero,legacy,historical};
  const sequence=()=>Number(exec(`select max(sequence) from public.merchant_attendance_events where merchant_id='${site}' and worker_id='${worker}';`));
  const command=action=>({expectedWorkerId:worker,operationId:next(),locationId:plainLocation,action,expectedSequence:sequence()});
  const selected=slot=>({slotId:slot.id,revision:slot.revision});
  const {executeAttendanceSelfSchedule}=require('../../src/lib/merchantAttendanceSelfSchedule.server.ts');
  const {executeAttendanceSelf}=require('../../src/lib/merchantAttendanceSelf.server.ts');
  const calls=[];
  const service={rpc:async(name,args)=>{assert(['faolla_attendance_self_schedule_v1','faolla_attendance_self_v1','faolla_attendance_self_bound_v1'].includes(name));calls.push(name);
    return {data:JSON.parse(exec(`set local role service_role;select ${name==='faolla_attendance_self_schedule_v1'?selfScheduleExpression(args):boundClockRpcExpression(name,args)};`)),error:null};}};
  const start=slot=>executeAttendanceSelfSchedule({siteId:site,authUserId:auth,command:command('clock_in'),selection:selected(slot),operationId:null,allowWrite:true,bindRules:false},service);
  const finish=async()=>{const old=process.env.FAOLLA_ATTENDANCE_RULE_BINDINGS_ENABLED;try{delete process.env.FAOLLA_ATTENDANCE_RULE_BINDINGS_ENABLED;
    return await executeAttendanceSelf({siteId:site,authUserId:auth,command:command('clock_out'),operationId:null},service);
  }finally{if(old===undefined)delete process.env.FAOLLA_ATTENDANCE_RULE_BINDINGS_ENABLED;else process.env.FAOLLA_ATTENDANCE_RULE_BINDINGS_ENABLED=old;}};
  const second=await start(slots.future);await finish();assert.equal(second.association.status,'linked');
  const missingPublication=await start(slots.legacy);await finish();assert.equal(missingPublication.association.reason,'publication_missing');
  // Explicit SYNTHETIC historical events AND relations, not actual137 clocks.
  // Same table guards as137; no backfill, UPDATE, disabled constraint or trigger.
  // Both original spans lie outside12..14. Their chronological neighbours allow
  // real086 proposals12..12:30/13..13:30 and095 first14..15 (next original=15).
  const historicalFirst={id:next(),operationId:next()},historicalFirstOut={id:next(),operationId:next()};
  const historicalSecond={id:next(),operationId:next()},historicalSecondOut={id:next(),operationId:next()};
  exec(`do $history_events$ declare ev public.merchant_attendance_events%rowtype;r public.merchant_attendance_shift_schedule_relations%rowtype;
    context jsonb;tail bigint;begin
    select max(sequence) into strict tail from public.merchant_attendance_events where merchant_id='${site}' and worker_id='${geoWorker}';
    assert tail=2,'plan_fixture_historical_worker_tail_changed';
    assert exists(select 1 from public.merchant_enterprise_employees emp_check join public.merchant_enterprise_roles role_check on role_check.id=emp_check.role_id and role_check.merchant_id=emp_check.merchant_id
      where emp_check.merchant_id='${site}' and emp_check.id='${geoEmployee}' and emp_check.auth_user_id='${geoAuth}' and 'attendance.self.request'=any(role_check.permissions)),
      'plan_fixture_historical_request_permission_missing';
    insert into public.merchant_attendance_events(id,merchant_id,worker_id,location_id,operation_id,sequence,action,source,occurred_at,received_at,time_zone,actor_employee_id) values
      ('${historicalFirst.id}','${site}','${geoWorker}','${plainLocation}','${historicalFirst.operationId}',tail+1,'clock_in','web','${d.day(-1)}T10:00:00Z','${d.day(-1)}T10:00:00Z','UTC','${geoEmployee}'),
      ('${historicalFirstOut.id}','${site}','${geoWorker}','${plainLocation}','${historicalFirstOut.operationId}',tail+2,'clock_out','web','${d.day(-1)}T10:30:00Z','${d.day(-1)}T10:30:00Z','UTC','${geoEmployee}'),
      ('${historicalSecond.id}','${site}','${geoWorker}','${plainLocation}','${historicalSecond.operationId}',tail+3,'clock_in','web','${d.day(-1)}T15:00:00Z','${d.day(-1)}T15:00:00Z','UTC','${geoEmployee}'),
      ('${historicalSecondOut.id}','${site}','${geoWorker}','${plainLocation}','${historicalSecondOut.operationId}',tail+4,'clock_out','web','${d.day(-1)}T15:30:00Z','${d.day(-1)}T15:30:00Z','UTC','${geoEmployee}');
    select public.faolla_attendance_self_schedule_slot_v1(s) into strict context from public.merchant_attendance_schedule_slots s where merchant_id='${site}' and id='${historical.id}';
    for ev in select * from public.merchant_attendance_events where id in('${historicalFirst.id}','${historicalSecond.id}') order by sequence loop
      select * into strict r from public.merchant_attendance_shift_schedule_relations where merchant_id='${site}' and start_event_id='${second.clock.receipt.id}';
      r.start_event_id:=ev.id;r.worker_id:=ev.worker_id;r.operation_id:=ev.operation_id;r.sequence:=ev.sequence;r.location_id:=ev.location_id;
      r.occurred_at:=ev.occurred_at;r.event_time_zone:=ev.time_zone;r.employee_id:=ev.actor_employee_id;r.employee_auth_user_id:='${geoAuth}';
      r.worker_version:=(context->'publication'->>'workerVersion')::bigint;r.selection:=${json(selected(historical))};r.slot_id:='${historical.id}';r.slot_revision:=${historical.revision};
      r.slot_snapshot:=context->'slot';r.publication_snapshot:=context->'publication';r.cancellation_snapshot:=null;r.recorded_at:=clock_timestamp();
      insert into public.merchant_attendance_shift_schedule_relations select(r).*;
    end loop;set constraints all immediate;end;$history_events$;`);
  const proposal=(startAt,endAt)=>({startAt:`${d.day(-1)}T${startAt}:00.000000Z`,endAt:`${d.day(-1)}T${endAt}:00.000000Z`,breaks:[]});
  const approve=(session,last,span)=>{const request=next(),operation=next();exec(`set local role service_role;do $approve$ declare r jsonb;c jsonb;begin
    perform public.faolla_attendance_correction_self_v3('${site}','${geoAuth}',${json({mode:'detail',expectedWorkerId:geoWorker,requestId:request,operationId:null})},${json({action:'submit',operationId:request,expectedRevision:0,expectedPolicyRevision:1,reason:'Synthetic164 actual approval',startEventId:session.id,expectedLastEventId:last.id,proposal:span})},true);
    r:=public.faolla_attendance_correction_decide_v1('${site}','${owner}','${request}',null,null,true);
    if r->>'canApprove' is distinct from 'true' then raise exception 'plan_fixture_correction_not_approvable' using detail=coalesce((r->'blockers')::text,'missing_blockers');end if;
    c:=jsonb_build_object('action','approve','operationId','${operation}','requestId','${request}','expectedRevision',1,'expectedEvidence',r->>'evidenceToken','reason','Synthetic164 approved historical proposal');
    perform public.faolla_attendance_correction_decide_v1('${site}','${owner}','${request}',c,null,true);end;$approve$;`);return {request,operation};};
  const firstApproval=approve(historicalFirst,historicalFirstOut,proposal('12:00','12:30'));
  approve(historicalSecond,historicalSecondOut,proposal('13:00','13:30'));
  let revision=1;
  const reviseHistorical=(inside=false)=>{const request=next(),operation=next();exec(`do $revise$ declare p jsonb;r jsonb;c jsonb;begin
    p:=public.faolla_attendance_revision_self_v2('${site}','${geoAuth}',${json({mode:'prepare',expectedWorkerId:geoWorker,baseRequestId:firstApproval.request,requestId:null,operationId:null})},null,true);
    c:=jsonb_build_object('action','submit','operationId','${request}','expectedRevision',(p->>'revision')::bigint,'expectedBaseOperationId','${firstApproval.operation}',
      'expectedEffectiveOperationId',p->'current'->>'operationId','expectedPolicyRevision',1,'reason','Synthetic164 real follow-up','proposal',${json(inside?proposal('12:00','12:30'):proposal('14:00','15:00'))});
    perform public.faolla_attendance_revision_self_v2('${site}','${geoAuth}',${json({mode:'detail',expectedWorkerId:geoWorker,baseRequestId:firstApproval.request,requestId:request,operationId:null})},c,true);
    r:=public.faolla_attendance_revision_decide_v2('${site}','${owner}','${request}',null,null,true);
    c:=jsonb_build_object('action','approve','operationId','${operation}','requestId','${request}','expectedRevision',(r->'review'->>'submittedRevision')::bigint,
      'expectedEvidence',r->>'evidenceToken','expectedBaseOperationId',r->'current'->>'operationId','reason','Synthetic164 current approved revision');
    perform public.faolla_attendance_revision_decide_v2('${site}','${owner}','${request}',c,null,true);end;$revise$;`);return {revision:++revision,operationId:operation};};
  const ongoing=await start(slots.future);let isOpen=true;
  const finishCurrent=async()=>{assert(isOpen);await finish();isOpen=false;};
  const cancel=slot=>{const c={action:'cancel',operationId:next(),expectedRevision:head(),expectedSettingsVersion:1,reason:'Synthetic164 subsequent cancellation',slotId:slot.id};
    return JSON.parse(exec(`set local role service_role;select public.faolla_attendance_schedule_v1(${json({...scheduleQuery,fromDate:d.day(-1),throughDate:d.day(1)})},'${owner}',${json(c)},true);`));};
  const sourceQuery={siteId:site,workerId:worker,fromDate:d.day(-1),throughDate:d.day(1)};
  const {parseSourcesResult}=require('../../src/lib/merchantAttendanceSources.ts');
  const readSourceRaw=(q=sourceQuery,actor=owner)=>d.readSourceRaw(q,actor);
  const source={...parseSourcesResult(readSourceRaw(),sourceQuery,owner),moduleEnabled:true};
  const historicalSourceQuery={...sourceQuery,workerId:geoWorker};
  const historicalSource={...parseSourcesResult(readSourceRaw(historicalSourceQuery),historicalSourceQuery,owner),moduleEnabled:true};
  // Only this known fixture slot chooses the other worker. Raw query readers
  // forward every caller-supplied identity unchanged, including negative cases.
  const query=slot=>({siteId:site,workerId:slot.id===historical.id?geoWorker:worker,slotId:slot.id});
  let reads=0;
  const readRaw=(q=query(slots.future),actor=owner)=>{const before=d.fingerprint(),defs=d.definitions();try{reads++;return JSON.parse(exec(`set local role service_role;select ${planCoverageExpression(q,actor)};`));}
    finally{assert.equal(d.fingerprint(),before,'plan_coverage_read_changed_facts');assert.equal(d.definitions(),defs);}};
  assert.deepEqual(d.counts(),{events:23,bindings:3,sources:2,relations:6});
  return {...d,source,sourceQuery,historicalSource,historicalSourceQuery,readSourceRaw,query,readRaw,slots,selected,ongoing:ongoing.clock.receipt,second:second.clock.receipt,
    historicalFirst,historicalSecond,reviseHistorical,cancel,finishCurrent,isCurrentOpen:()=>isOpen,
    calls,reads:()=>reads,oldDefinitions,oldDefs,installedDefinitions:installed,indexes,installedIndexes:afterIndexes,install,
    syntheticHistoricalPlan:true,syntheticHistoricalEvents:4,syntheticHistoricalRelations:2,realPastPublication:false};
}
