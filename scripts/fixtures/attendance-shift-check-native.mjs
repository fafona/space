//162 preparation only. Import never starts a process, connection or service.
// The caller owns the stopped-PG wrapper and guarded synthetic namespace.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';
import {prepareBoundClocksNativeFixture,boundClockMigrationBody,boundClockRpcExpression,quote} from './attendance-bound-clocks-native.mjs';
import {selfScheduleExpression} from './attendance-self-schedule-native.mjs';
import {sourcesNativeDependencies,sourcesNativePlan} from '../merchant-attendance-sources-native.mjs';
import {groupsQueryInput,groupsNativeSave} from '../merchant-attendance-groups-native.mjs';
import {lifecycleId as id,lifecycleJson as json} from '../merchant-attendance-lifecycle-native-support.mjs';

export const shiftCheckMigration='202610050138_merchant_attendance_shift_check.sql';
export const shiftCheckRpc='faolla_attendance_shift_check_v1';
export const shiftCheckExpression=(query,actor)=>`public.${shiftCheckRpc}(${json(query)},${quote(actor)})`;
const require=createRequire(import.meta.url);
export async function prepareShiftCheckNativeFixture(native,scope){
  const d=await prepareBoundClocksNativeFixture(native,scope),{exec,owned,site,owner,worker,auth,plainLocation}=d;
  for(const name of sourcesNativeDependencies){
    const version=name.slice(0,12);assert(/^\d{12}$/.test(version));
    if(exec(`select count(*) from public.faolla_schema_migrations where version=${version};`)==='0')exec(boundClockMigrationBody(native.root,name));
  }
  for(const name of ['202610040128_merchant_attendance_sources.sql','202610040133_merchant_attendance_shift_rule_bindings.sql',
    '202610040134_merchant_attendance_bound_clocks.sql','202610040135_merchant_attendance_shift_rule_binding_reader.sql'])exec(boundClockMigrationBody(native.root,name));
  //136's concurrent-index phase must run outside an enclosing transaction.
  exec('select 1;');native.query(scope.sql(readFileSync(path.join(native.root,'scripts/supabase-migrations/202610050136_merchant_attendance_schedule_publication_evidence.sql'),'utf8')));
  exec(boundClockMigrationBody(native.root,'202610050137_merchant_attendance_self_schedule.sql'));
  const inventory=()=>JSON.parse(exec(`select jsonb_agg(relname order by relname) from pg_class where relnamespace=${owned.oid} and relkind in('r','p');`));
  const tables=inventory(),fingerprint=(selected=tables)=>exec(`select ${sourcesNativePlan(owned,selected).fingerprint};`);
  const oldOids=exec(`select array_agg(oid order by oid)::text from pg_proc where pronamespace=${owned.oid} and prokind='f';`);
  const definitions=(old=false)=>exec(`select md5(jsonb_agg(jsonb_build_array(oid,pg_get_functiondef(oid),proowner,proacl,proconfig,prosecdef) order by oid)::text) from pg_proc where pronamespace=${owned.oid} and prokind='f' ${old?`and oid=any(${quote(oldOids)}::oid[])`:''};`);
  const beforeDefs=definitions(true),beforeFacts=fingerprint(tables.filter(t=>t!=='faolla_schema_migrations'));
  exec(boundClockMigrationBody(native.root,shiftCheckMigration));
  assert.equal(definitions(true),beforeDefs);assert.deepEqual(inventory(),tables);assert.equal(fingerprint(tables.filter(t=>t!=='faolla_schema_migrations')),beforeFacts);
  const installed=definitions(),installedFacts=fingerprint();exec(boundClockMigrationBody(native.root,shiftCheckMigration));
  assert.equal(definitions(),installed);assert.equal(fingerprint(),installedFacts);
  let nextId=162000;
  const next=()=>id(++nextId),sequence=()=>Number(exec(`select coalesce(max(sequence),0) from public.merchant_attendance_events where merchant_id='${site}' and worker_id='${worker}';`));
  const command=action=>({expectedWorkerId:worker,operationId:next(),locationId:plainLocation,action,expectedSequence:sequence()});
  const {executeAttendanceSelf}=require('../../src/lib/merchantAttendanceSelf.server.ts');
  const {executeAttendanceSelfSchedule}=require('../../src/lib/merchantAttendanceSelfSchedule.server.ts');
  const clockCalls=[];
  const clockService={rpc:async(name,args)=>{assert(['faolla_attendance_self_v1','faolla_attendance_self_bound_v1','faolla_attendance_self_schedule_v1'].includes(name));clockCalls.push(name);
    return {data:JSON.parse(exec(`set local role service_role;select ${name==='faolla_attendance_self_schedule_v1'?selfScheduleExpression(args):boundClockRpcExpression(name,args)};`)),error:null};}};
  const flags=['FAOLLA_ATTENDANCE_RULE_BINDINGS_ENABLED','FAOLLA_ATTENDANCE_RULE_BINDINGS_SITE_IDS'];
  const oldClock=async(action,bound=true)=>{const previous=new Map(flags.map(key=>[key,process.env[key]]));try{
    process.env.FAOLLA_ATTENDANCE_RULE_BINDINGS_ENABLED=bound?'1':'0';process.env.FAOLLA_ATTENDANCE_RULE_BINDINGS_SITE_IDS=site;
    return await executeAttendanceSelf({siteId:site,authUserId:auth,operationId:null,command:command(action)},clockService);
  }finally{for(const[key,value]of previous){if(value===undefined)delete process.env[key];else process.env[key]=value;}}};
  const scheduleQuery={siteId:site,access:'owner',workerId:worker,fromDate:d.day(1),throughDate:d.day(1),operationId:null};
  const publication={action:'publish',operationId:next(),expectedRevision:0,expectedSettingsVersion:1,reason:'Synthetic162 explicit future plan',
    locationId:plainLocation,timeZone:'UTC',slots:[[`${d.day(1)}T08:00:00.000Z`,`${d.day(1)}T09:00:00.000Z`]]};
  const schedule=JSON.parse(exec(`set local role service_role;select public.faolla_attendance_schedule_evidenced_v1(${json(scheduleQuery)},'${owner}',${json(publication)},true);`));
  assert.equal(schedule.entries.length,1);const slot=schedule.entries[0],selection={slotId:slot.id,revision:slot.revision};
  const target=await executeAttendanceSelfSchedule({siteId:site,authUserId:auth,command:command('clock_in'),selection,operationId:null,allowWrite:true,bindRules:true},clockService);
  assert.equal(target.association.status,'linked');await oldClock('break_start');await oldClock('break_end');const targetEnd=await oldClock('clock_out');
  const missing=await oldClock('clock_in',false);await oldClock('clock_out',false);
  d.foundation.call(groupsQueryInput({groupId:d.group}),groupsNativeSave(162501,{groupId:d.group,expectedRevision:1,active:false,name:'Current inactive <img src=x onerror=alert(1)>'}),true);
  const unverified=await oldClock('clock_in');await oldClock('clock_out');
  d.foundation.call(groupsQueryInput({groupId:d.group}),groupsNativeSave(162502,{groupId:d.group,expectedRevision:2,active:true,name:'Current changed group <img src=x onerror=alert(1)>'}),true);
  const ongoing=await oldClock('clock_in');await oldClock('break_start');let open=true;
  const finishOpen=async()=>{assert(open);await oldClock('break_end');await oldClock('clock_out');open=false;};
  const anchors={verified:target.clock.receipt.id,missing:missing.receipt.id,unverified:unverified.receipt.id,ongoing:ongoing.receipt.id};
  const counts=()=>JSON.parse(exec(`select jsonb_build_object('events',(select count(*) from public.merchant_attendance_events),
    'bindings',(select count(*) from public.merchant_attendance_shift_rule_bindings),'sources',(select count(*) from public.merchant_attendance_shift_rule_sources),
    'relations',(select count(*) from public.merchant_attendance_shift_schedule_relations));`));
  assert.deepEqual(counts(),{events:10,bindings:3,sources:2,relations:1});

  // Original086 and follow-up095 actually decide these requests. Synthetic
  // proposal dates deliberately differ from the real original clock moments.
  exec(`update public.merchant_enterprise_roles set permissions=array['enterprise.view','attendance.self.view','attendance.self.clock','attendance.self.request'] where merchant_id='${site}';
    set local role service_role;select public.faolla_attendance_correction_controls_v2('${site}','${owner}',${json({action:'set_policy',operationId:next(),expectedRevision:0,expectedSettingsVersion:1,reason:'Synthetic162 correction window',submissionWindowDays:365})},null,null,true);`);
  const rootRequest=next(),rootApproval=next(),proposal=seconds=>({startAt:`${d.day(-1)}T08:00:00.000000Z`,endAt:`${d.day(-1)}T09:00:00.000000Z`,
    breaks:[{startAt:`${d.day(-1)}T08:10:00.000000Z`,endAt:`${d.day(-1)}T08:${String(10+Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}.000000Z`,paid:false}]});
  exec(`set local role service_role;do $approve$ declare r jsonb;c jsonb;begin
    perform public.faolla_attendance_correction_self_v3('${site}','${auth}',${json({mode:'detail',expectedWorkerId:worker,requestId:rootRequest,operationId:null})},${json({action:'submit',operationId:rootRequest,expectedRevision:0,expectedPolicyRevision:1,reason:'Synthetic162 actual initial submission',startEventId:anchors.verified,expectedLastEventId:targetEnd.receipt.id,proposal:proposal(30)})},true);
    r:=public.faolla_attendance_correction_decide_v1('${site}','${owner}','${rootRequest}',null,null,true);
    assert r->>'canApprove'='true','shift_check_fixture_original_not_approvable';
    c:=jsonb_build_object('action','approve','operationId','${rootApproval}','requestId','${rootRequest}','expectedRevision',1,'expectedEvidence',r->>'evidenceToken','reason','Synthetic162 original approval');
    perform public.faolla_attendance_correction_decide_v1('${site}','${owner}','${rootRequest}',c,null,true);end;$approve$;`);
  let effectRevision=1,effectOperation=rootApproval;
  const approveRevision=seconds=>{const request=next(),operation=next();
    //095 originals are private: fixture construction uses owned namespace
    // owner; the subject read itself always uses service_role + real138 auth.
    exec(`do $revise$ declare p jsonb;c jsonb;r jsonb;begin
      p:=public.faolla_attendance_revision_self_v2('${site}','${auth}',${json({mode:'prepare',expectedWorkerId:worker,baseRequestId:rootRequest,requestId:null,operationId:null})},null,true);
      c:=jsonb_build_object('action','submit','operationId','${request}','expectedRevision',(p->>'revision')::bigint,'expectedBaseOperationId','${rootApproval}',
        'expectedEffectiveOperationId',p->'current'->>'operationId','expectedPolicyRevision',1,'reason','Synthetic162 actual follow-up','proposal',${json(proposal(seconds))});
      perform public.faolla_attendance_revision_self_v2('${site}','${auth}',${json({mode:'detail',expectedWorkerId:worker,baseRequestId:rootRequest,requestId:request,operationId:null})},c,true);
      r:=public.faolla_attendance_revision_decide_v2('${site}','${owner}','${request}',null,null,true);
      c:=jsonb_build_object('action','approve','operationId','${operation}','requestId','${request}','expectedRevision',(r->'review'->>'submittedRevision')::bigint,
        'expectedEvidence',r->>'evidenceToken','expectedBaseOperationId',r->'current'->>'operationId','reason','Synthetic162 follow-up approval');
      perform public.faolla_attendance_revision_decide_v2('${site}','${owner}','${request}',c,null,true);end;$revise$;`);
    effectRevision++;effectOperation=operation;return {revision:effectRevision,operationId:operation};};

  // One honest synthetic past cross-night session for the other worker. This
  // is NOT an actual cross-midnight clock wait and has NO historical binding.
  const crossStart=id(162800),crossEnd=id(162801),crossQuery={siteId:site,workerId:d.geoWorker,fromDate:d.day(-3),throughDate:d.day(-3)};
  exec(`insert into public.merchant_attendance_events(id,merchant_id,worker_id,location_id,operation_id,sequence,action,source,occurred_at,time_zone,actor_employee_id) values
    ('${crossStart}','${site}','${d.geoWorker}','${d.geoLocation}','${id(162802)}',1,'clock_in','web','${d.day(-3)}T23:30:00.000123Z','Europe/Madrid','${d.geoEmployee}'),
    ('${crossEnd}','${site}','${d.geoWorker}','${d.geoLocation}','${id(162803)}',2,'clock_out','web','${d.day(-2)}T00:30:00.000456Z','Europe/Madrid','${d.geoEmployee}');`);
  const query={siteId:site,workerId:worker,fromDate:d.today,throughDate:d.today};
  const {parseSourcesResult}=require('../../src/lib/merchantAttendanceSources.ts');
  let sourceReads=0,detailReads=0;
  const unchanged=run=>{const before=fingerprint(),defs=definitions();try{return run();}finally{assert.equal(fingerprint(),before,'shift_check_read_changed_facts');assert.equal(definitions(),defs);}};
  const readSourceRaw=(q=query,actor=owner)=>unchanged(()=>{sourceReads++;return JSON.parse(exec(`set local role service_role;select public.faolla_attendance_sources_v1(${json(q)},'${actor}');`));});
  const readRaw=(q={siteId:site,workerId:worker,startEventId:anchors.verified},actor=owner)=>unchanged(()=>{detailReads++;return JSON.parse(exec(`set local role service_role;select ${shiftCheckExpression(q,actor)};`));});
  const source={...parseSourcesResult(readSourceRaw(),query,owner),moduleEnabled:true};
  assert.equal(source.attendance.base.rows.length,4);assert.equal(source.attendance.missing.length,0);
  const crossSource={...parseSourcesResult(readSourceRaw(crossQuery),crossQuery,owner),moduleEnabled:true};
  return {...d,sql:scope.sql,inventory,fingerprint,definitions,counts,anchors,slot,selection,query,source,crossQuery,crossSource,crossStart,crossEnd,
    readSourceRaw,readRaw,approveRevision,finishOpen,isOpen:()=>open,effect:()=>({revision:effectRevision,operationId:effectOperation}),
    clockCalls,sourceReads:()=>sourceReads,detailReads:()=>detailReads,syntheticCrossNight:true,actualOriginalApproval:true};
}
