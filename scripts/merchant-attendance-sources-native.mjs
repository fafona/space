// Local synthetic source-reader acceptance. Importing this module starts nothing.
// Normal contextual facts use their original RPCs; only identities/raw punches
// are synthetic seed rows. This does not assess attendance or apply any rules.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {runAttendanceLabelsReuse} from './merchant-attendance-choice-labels-reuse-native.mjs';
import {withAttendanceConcurrencySandbox} from './merchant-attendance-concurrency-sandbox.mjs';
import {prepareGroupsNativeFixture,groupsNativePlan,groupsQueryInput,groupsNativeSave,groupsNativeAssign,groupsNativeCancel} from './merchant-attendance-groups-native.mjs';
import {leaveQueryInput,leaveNativeSubmit,leaveNativeAction} from './merchant-attendance-leave-native.mjs';
import {calendarQueryInput,calendarNativeCreate,calendarNativeCancel} from './merchant-attendance-calendar-native.mjs';
import {rulesQueryInput,rulesNativeSave,rulesNativePublish,rulesNativeWithdraw,rulesNativeFailure} from './merchant-attendance-rules-native.mjs';
import {lifecycleId as id,lifecycleJson as json} from './merchant-attendance-lifecycle-native-support.mjs';

const require=createRequire(import.meta.url),site='99990001',owner=id(99),employee=id(1),worker=id(201),location=id(301),group=id(7001);
const rpc='faolla_attendance_sources_v1',migrationName='202610040128_merchant_attendance_sources.sql';
const quote=value=>"'"+String(value).replaceAll("'","''")+"'";
// Exact dependency bodies, not another acceptance suite or a database copy.
export const sourcesNativeDependencies=Object.freeze([
  '202609300087_merchant_attendance_period_report.sql','202610010088_merchant_attendance_scoped_period_report.sql',
  '202610010090_merchant_attendance_period_export.sql','202610010091_merchant_attendance_revision_requests.sql',
  '202610010092_merchant_attendance_revision_review.sql','202610010093_merchant_attendance_versioned_reports.sql',
  '202610010094_merchant_attendance_revision_decision_core.sql','202610010095_merchant_attendance_revision_cycles.sql',
  '202610010096_merchant_attendance_current_correction_decisions.sql','202610010097_merchant_attendance_revision_history.sql',
  '202610010098_merchant_attendance_revision_application_access.sql','202610010099_merchant_attendance_schedule.sql',
  '202610010100_merchant_attendance_missing_requests.sql','202610010101_merchant_attendance_unified_report.sql',
  '202610010103_merchant_attendance_missing_revisions.sql','202610030121_merchant_attendance_leave_permission.sql',
  '202610030122_merchant_attendance_leave_requests.sql','202610030123_merchant_attendance_calendar.sql',
  '202610040127_merchant_attendance_rule_versions.sql',
]);
const labels=Object.freeze([
  'sources128 installs/reapplies without changing prior functions, ACLs or business facts',
  'sources actual SQL/parser distinguishes raw, latest approved correction/missing and ongoing unconfirmed work',
  'sources complete interval overlap retains overnight carry-in and cancelled group/schedule/leave/calendar history',
  'sources rule publication carry-in survives thirty newer drafts and excludes a withdrawn publication',
  'sources historical identity snapshots remain visible to current owner with an explicit binding-change warning',
  'sources current owner and same-merchant worker fences reject foreign/malformed/over-seven-day reads',
  'sources100 contextual candidates return complete and101 return limited without a partial list or calculated assessment',
  'sources service-only ACL and every successful/denied/rollback read preserve all-table fingerprints',
]);
let phase='entry';
export const sourcesQueryInput=(fromDate,throughDate=fromDate,patch={})=>({siteId:site,workerId:worker,fromDate,throughDate,...patch});
// Revision commands retain their original JSON. The existing093 effect guard
// requires byte-equivalent canonical six-digit proposal timestamps, unlike
// schedule/leave's millisecond command wire format.
export const sourcesNativeProposal=(date,start,end)=>{
  assert(/^20\d{2}-\d{2}-\d{2}$/.test(date));assert([start,end].every(time=>/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)));
  return {startAt:`${date}T${start}:00.000000Z`,endAt:`${date}T${end}:00.000000Z`,breaks:[]};
};
const expression=(query,actor=owner)=>`public.${rpc}(${json(query)},${actor===null?'null':quote(actor)})`;
const denied=(code,expr)=>`begin perform ${expr};raise exception 'sources_unexpected_acceptance';exception when sqlstate 'P0001' then if sqlerrm<>${quote(code)} then raise;end if;end;`;
export function sourcesNativeFailure(error){
  const safe=rulesNativeFailure(error),message=error instanceof Error?error.message:'';
  const code=message.match(/ERROR:\s+(?:[0-9A-Z]{5}:\s+)?(attendance_(?:sources_invalid|sources_too_large|worker_not_found|effect_version_invalid|report_too_large|report_reconciliation_required|report_overlap|report_invalid))(?=\r?\n|$)/)?.[1];
  return {...safe,error:'sources_native_failed',phase,...(code?{code,sqlMessage:code}:{})};
}
export function sourcesMigrationPlan(root,scope){
  assert(typeof root==='string'&&path.isAbsolute(root));assert(scope&&/^attendance_race_[a-f0-9]{32}$/.test(scope.schema)&&typeof scope.sql==='function');
  const source=readFileSync(path.join(root,'scripts/supabase-migrations',migrationName),'utf8');
  const body=source.replace(/^begin;\s*$/m,'').replace(/^commit;\s*$/m,''),statement=scope.sql(body);
  assert(!/\bpublic\./.test(statement));assert(!/search_path\s*(?:=|to)\s*(?:pg_catalog,\s*)?public\b/.test(statement));return {name:migrationName,source,body,statement};
}
export function sourcesNativePlan(owned,tables){
  const guard=groupsNativePlan(owned,tables).guard;
  const fingerprint=selected=>`(select md5(jsonb_object_agg(name,facts order by name)::text) from (${selected.map(t=>
    `select ${quote(t)} name,(select coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text),'[]'::jsonb) from public.${t} r) facts`).join(' union all ')}) source_tables)`;
  return {guard,fingerprint:fingerprint(tables),businessFingerprint:fingerprint(tables.filter(t=>t!=='faolla_schema_migrations')),labels:[...labels]};
}
// Strict bounded facts oracle; source totals are not payroll/absence conclusions.
export function assertSourcesSections(result){
  assert.equal(result.protocol,'sources-v1');
  for(const key of ['assignments','rules','schedule','leave','calendar']){
    const section=result[key];assert.equal(typeof section.limited,'boolean');assert(Array.isArray(section.items));
    assert(section.items.length<=100);if(section.limited)assert.deepEqual(section.items,[],`${key}_partial_list_forbidden`);
  }
  assert.equal(result.attendance.payrollReady,false);assert.equal(result.attendance.complete,true);
  assert(!Object.hasOwn(result,'assessment'));assert(!Object.hasOwn(result,'absence'));assert(!Object.hasOwn(result,'payroll'));
  assert(result.warnings.includes('candidate_rules_not_applied'));
  assert(result.warnings.includes('historical_context_not_pinned'));assert(result.warnings.includes('personal_exceptions_not_supported'));
}

export async function prepareSourcesNativeFixture(native,scope){
  const {parseSourcesResult}=require('../src/lib/merchantAttendanceSources.ts');
  phase='owned-minimal-dependencies';const base=await prepareGroupsNativeFixture(native,scope),{exec,owned}=base;
  for(const name of sourcesNativeDependencies){const source=readFileSync(path.join(native.root,'scripts/supabase-migrations',name),'utf8');exec(source.replace(/^begin;\s*$/m,'').replace(/^commit;\s*$/m,''));}
  const inventory=()=>JSON.parse(exec(`select jsonb_agg(relname order by relname) from pg_class where relnamespace=${owned.oid} and relkind in('r','p');`));
  const tables=inventory(),plan=sourcesNativePlan(owned,tables),fingerprint=()=>{assert.deepEqual(inventory(),tables,'sources_table_inventory_changed');return exec(`select ${plan.fingerprint};`);},businessFingerprint=()=>exec(`select ${plan.businessFingerprint};`);
  const oldDefinition=()=>exec(`select md5(coalesce(string_agg(pg_get_functiondef(p.oid)||p.proowner::text||coalesce(p.proacl::text,''),'' order by p.oid),''))
    from pg_proc p where p.pronamespace=${owned.oid} and p.prokind='f' and p.proname not like 'faolla_attendance_sources%';`);
  phase='install128';const migration=sourcesMigrationPlan(native.root,scope),old=oldDefinition(),oldFacts=businessFingerprint();exec(migration.body);
  assert.equal(oldDefinition(),old,'sources_install_changed_prior_definition_acl');assert.equal(businessFingerprint(),oldFacts,'sources_install_changed_business');
  const installation=()=>exec(`select jsonb_agg(jsonb_build_array(p.proname,pg_get_functiondef(p.oid),p.proowner,p.proacl,p.proconfig,p.prosecdef) order by p.proname)
    from pg_proc p where p.pronamespace=${owned.oid} and p.proname like 'faolla_attendance_sources%';`);
  const defined=installation(),beforeReapply=fingerprint();exec(migration.body);
  assert.equal(installation(),defined,'sources_reapply_changed_installation');assert.equal(fingerprint(),beforeReapply,'sources_reapply_changed_facts');assert.equal(oldDefinition(),old);
  const today=exec("select (clock_timestamp() at time zone 'UTC')::date::text;"),day=offset=>new Date(Date.parse(today+'T00:00:00Z')+offset*86400000).toISOString().slice(0,10);
  const at=(offset,time)=>`${day(offset)}T${time}:00.000Z`;
  phase='synthetic-identity-and-raw-punches';exec(`
    update public.merchant_enterprise_roles set permissions=array['enterprise.view','attendance.self.view','attendance.self.request','attendance.self.leave'] where merchant_id='${site}' and id='${id(30)}';
    insert into public.merchant_attendance_locations(id,merchant_id,name,time_zone,active) values('${location}','${site}','Synthetic source location','UTC',true);
    update public.merchant_attendance_workers set default_location_id='${location}' where merchant_id='${site}' and id='${worker}';
    insert into public.merchant_attendance_employment_periods(merchant_id,worker_id,starts_on) values('${site}','${worker}','2000-01-01');
    insert into public.merchant_attendance_events(id,merchant_id,worker_id,location_id,operation_id,sequence,action,source,occurred_at,time_zone,actor_employee_id) values
    ${[[8101,1,'clock_in','01:00'],[8102,2,'clock_out','02:00'],[8103,3,'clock_in','04:00'],[8104,4,'clock_out','05:00'],[8105,5,'clock_in','22:00']].map(([n,seq,action,time])=>
      `('${id(n)}','${site}','${worker}','${location}','${id(n)}',${seq},'${action}','web','${at(-1,time)}','UTC','${id(101)}')`).join(',')};`);
  const write=(name,query,command,actor=owner)=>JSON.parse(exec(`set local role service_role;select public.${name}(${json(query)},'${actor}',${json(command)},true);`));
  phase='actual-approved-evidence';const policy={action:'set_policy',operationId:id(390),expectedRevision:0,expectedSettingsVersion:1,reason:'Synthetic source policy',submissionWindowDays:30};
  exec(`set local role service_role;select public.faolla_attendance_correction_controls_v2('${site}','${owner}',${json(policy)},null,null,true);`);
  const proposal=(start,end)=>sourcesNativeProposal(day(-1),start,end);
  exec(`set local role service_role;do $approved$ declare p jsonb;r jsonb;c jsonb;begin
    perform public.faolla_attendance_correction_self_v3('${site}','${employee}',${json({mode:'detail',expectedWorkerId:worker,requestId:id(8110),operationId:null})},
      ${json({action:'submit',operationId:id(8110),expectedRevision:0,expectedPolicyRevision:1,reason:'Synthetic source correction',startEventId:id(8101),expectedLastEventId:id(8102),proposal:proposal('02:00','03:00')})},true);
    r:=public.faolla_attendance_correction_decide_v2('${site}','${owner}','${id(8110)}',null,null,true);assert r->>'canApprove'='true','sources_fixture_not_approvable';
    perform public.faolla_attendance_correction_decide_v2('${site}','${owner}','${id(8110)}',${json({action:'approve',operationId:id(8111),requestId:id(8110),expectedRevision:1,reason:'Synthetic source approval'})}||jsonb_build_object('expectedEvidence',r->'evidenceToken'),null,true);
    p:=public.faolla_attendance_revision_self_v2('${site}','${employee}',${json({mode:'prepare',expectedWorkerId:worker,baseRequestId:id(8110),requestId:null,operationId:null})},null,true);
    c:=${json({action:'submit',operationId:id(8112),expectedBaseOperationId:id(8111),expectedPolicyRevision:1,reason:'Synthetic latest source revision',proposal:proposal('02:00','03:30')})}
      ||jsonb_build_object('expectedRevision',(p->>'revision')::bigint,'expectedEffectiveOperationId',p->'current'->'operationId');
    perform public.faolla_attendance_revision_self_v2('${site}','${employee}',${json({mode:'detail',expectedWorkerId:worker,baseRequestId:id(8110),requestId:id(8112),operationId:null})},c,true);
    r:=public.faolla_attendance_revision_decide_v2('${site}','${owner}','${id(8112)}',null,null,true);
    c:=${json({action:'approve',operationId:id(8113),requestId:id(8112),reason:'Synthetic latest source approval'})}
      ||jsonb_build_object('expectedRevision',(r->'review'->>'submittedRevision')::bigint,'expectedEvidence',r->'evidenceToken','expectedBaseOperationId',r->'current'->'operationId');
    perform public.faolla_attendance_revision_decide_v2('${site}','${owner}','${id(8112)}',c,null,true);
    end;$approved$;`);
  const missingQuery={siteId:site,access:'self',fromDate:day(-2),throughDate:today,requestId:null,operationId:null,beforeAt:null,beforeId:null};
  const missing=(n,patch={})=>({action:'submit',operationId:id(n),reason:'Synthetic whole-missing source',expectedWorkerId:worker,expectedSettingsVersion:1,expectedPolicyRevision:1,locationId:location,timeZone:'UTC',proposal:proposal('09:00','12:00'),...patch});
  const approveMissing=n=>{const q={...missingQuery,access:'owner',requestId:id(n)},r=write('faolla_attendance_missing_v1',q,null);
    write('faolla_attendance_missing_v1',q,{action:'approve',operationId:id(n+1),requestId:id(n),expectedRevision:1,reason:'Synthetic missing approval',evidenceToken:r.detail.evidenceToken});};
  write('faolla_attendance_missing_v1',missingQuery,missing(8201),employee);approveMissing(8201);
  write('faolla_attendance_missing_v1',missingQuery,missing(8203,{action:'revise',supersedesRequestId:id(8201),expectedApprovalOperationId:id(8202),proposal:proposal('09:00','13:00')}),employee);approveMissing(8203);
  phase='actual-context-writers';base.call(groupsQueryInput(),groupsNativeSave(7001),true);
  const assign=n=>groupsNativeAssign(n,group,worker,{startsOn:day(-3),endsOn:day(5)});
  base.call(groupsQueryInput({groupId:group,workerId:worker}),assign(7101),true);
  base.call(groupsQueryInput({groupId:group,workerId:worker,assignmentId:id(7101)}),groupsNativeCancel(7102,id(7101)),true);
  base.call(groupsQueryInput({groupId:group,workerId:worker}),assign(7103),true);
  const scheduleQuery={siteId:site,access:'owner',workerId:worker,fromDate:day(2),throughDate:day(4),operationId:null};
  const schedule=write('faolla_attendance_schedule_v1',scheduleQuery,{operationId:id(7201),action:'publish',expectedRevision:0,expectedSettingsVersion:1,reason:'Synthetic carry-in schedule',locationId:location,timeZone:'UTC',
    slots:[[at(2,'22:00'),at(3,'06:00')],[at(3,'10:00'),at(3,'11:00')]]});
  const cancelledSlot=schedule.entries.find(e=>e.startAt===at(3,'10:00'));assert(cancelledSlot,'sources_cancel_slot_required');
  write('faolla_attendance_schedule_v1',scheduleQuery,{operationId:id(7202),action:'cancel',expectedRevision:1,expectedSettingsVersion:1,reason:'Synthetic cancelled schedule',slotId:cancelledSlot.id});
  const submitLeave=(n,start,end)=>write('faolla_attendance_leave_v1',leaveQueryInput(),leaveNativeSubmit(n,start,end),employee);
  const decideLeave=(n,action,request)=>write('faolla_attendance_leave_v1',leaveQueryInput('owner',{requestId:id(request)}),leaveNativeAction(n,action,id(request)));
  submitLeave(7301,at(2,'08:00'),at(5,'16:00'));decideLeave(7302,'approve',7301);decideLeave(7303,'cancel',7301);
  submitLeave(7304,at(3,'12:00'),at(3,'13:00'));decideLeave(7305,'approve',7304);
  write('faolla_attendance_calendar_v1',calendarQueryInput(),calendarNativeCreate(7401,day(2),day(5)));
  write('faolla_attendance_calendar_v1',calendarQueryInput({entryId:id(7401)}),calendarNativeCancel(7402,id(7401)));
  write('faolla_attendance_calendar_v1',calendarQueryInput({locationId:location}),calendarNativeCreate(7403,day(3),day(4),{locationId:location,expectedLocationVersion:1}));
  phase='actual-rule-carry-in';const ruleWrite=(command,groupId=null)=>write('faolla_attendance_rules_v1',rulesQueryInput({groupId}),command);
  ruleWrite(rulesNativeSave(7501));ruleWrite(rulesNativePublish(7502,1,day(2)));
  ruleWrite(rulesNativeSave(7503,2));ruleWrite(rulesNativePublish(7504,3,day(4)));ruleWrite(rulesNativeWithdraw(7505,4,4));
  for(let n=0;n<30;n++)ruleWrite(rulesNativeSave(7600+n,5+n));
  ruleWrite(rulesNativeSave(7701,0,{expectedGroupRevision:1}),group);ruleWrite(rulesNativePublish(7702,1,day(2),{expectedGroupRevision:1}),group);
  const queryInput=(patch={})=>sourcesQueryInput(day(-2),day(-1),patch),futureQuery=sourcesQueryInput(day(3),day(4));let readCount=0;
  const parse=(raw,query,actor=owner)=>{const result=parseSourcesResult(raw,query,actor);assertSourcesSections(result);return result;};
  const readRaw=(query=queryInput(),actor=owner)=>{const before=fingerprint();try{readCount++;return JSON.parse(exec(`set local role service_role;select ${expression(query,actor)};`));}
    finally{assert.equal(fingerprint(),before,'sources_read_changed_all_table_fingerprint');}};
  const read=(query=queryInput(),actor=owner)=>parse(readRaw(query,actor),query,actor);
  // The probe's mutations live only in a guarded rollback transaction. The
  // fingerprint is checked immediately around the actual reader inside it.
  const probeSequence=(setups,query=futureQuery,actor=owner)=>{
    assert(Array.isArray(setups)&&setups.length>=1&&setups.length<=2&&setups.every(setup=>typeof setup==='string'));
    const before=fingerprint(),raw=JSON.parse(exec(`begin;
      create temporary table sources_probe_result(ordinal integer,value jsonb) on commit drop;
      ${setups.map((setup,index)=>`${setup}
        do $probe$ declare before_read text;result jsonb;begin before_read:=${plan.fingerprint};set local role service_role;
          result:=${expression(query,actor)};reset role;assert ${plan.fingerprint}=before_read,'sources_probe_read_changed_facts';
          insert into sources_probe_result values(${index+1},result);end;$probe$;`).join('\n')}
      select jsonb_agg(value order by ordinal) from sources_probe_result;rollback;`));
    assert.equal(fingerprint(),before,'sources_probe_not_restored');assert.equal(raw.length,setups.length);readCount+=raw.length;return raw.map(value=>parse(value,query,actor));
  };
  const probe=(setup,query=futureQuery,actor=owner)=>probeSequence([setup],query,actor)[0];
  return {site,owner,employee,employeeId:id(101),worker,workerId:worker,location,group,day,today,at,queryInput,futureQuery,
    exec,sql:scope.sql,owned,plan,read,readRaw,parse,probe,probeSequence,fingerprint,protectedFingerprint:fingerprint,businessFingerprint,
    oldDefinition,oldDefinitionBaseline:old,installation,readCount:()=>readCount,syntheticOnly:true};
}

export async function checkAttendanceSourcesNative(native,scope,browserCheck=null){
  const data=await prepareSourcesNativeFixture(native,scope),{exec,day,at,read,probe,futureQuery}=data,baseline=data.fingerprint();
  phase='latest-recorded-evidence';const past=read();assert.equal(past.attendance.base.rows.length,3);assert.equal(past.attendance.base.openSessionCount,1);
  const corrected=past.attendance.base.rows.find(row=>row.startEventId===id(8101));assert.equal(corrected.source,'approved');assert.equal(corrected.correction.operationId,id(8113));
  assert.equal(corrected.original.totals.workedUs,3600000000);assert.equal(corrected.selected.totals.workedUs,5400000000);
  const ongoing=past.attendance.base.rows.find(row=>row.startEventId===id(8105));assert.equal(ongoing.original.endAt,null);assert.equal(ongoing.original.totals,null);assert.equal(ongoing.originalInPeriod.workedUs,0);
  assert.deepEqual(past.attendance.missing.map(row=>row.requestId),[id(8203)]);assert.equal(past.attendance.missing[0].operationId,id(8204));
  assert.equal(past.attendance.totals.original.workedUs,7200000000);assert.equal(past.attendance.totals.selected.workedUs,23400000000);
  phase='overlap-and-cancelled-context';const future=read(futureQuery);
  assert.equal(future.schedule.items.length,2);assert(future.schedule.items.some(row=>row.startAt===at(2,'22:00')&&row.endAt===at(3,'06:00')&&!row.cancelled));
  assert.equal(future.schedule.items.filter(row=>row.cancelled).length,1);
  assert.equal(future.assignments.items.length,2);assert.deepEqual(future.assignments.items.map(row=>row.detail.status).sort(),['assigned','cancelled']);
  assert.equal(future.leave.items.length,2);const containing=future.leave.items.find(row=>row.summary.requestId===id(7301));
  assert.equal(containing.summary.status,'cancelled');assert.equal(containing.summary.startAt,at(2,'08:00'));assert.equal(containing.summary.endAt,at(5,'16:00'));assert.equal(containing.operationId,id(7303));
  assert.equal(future.calendar.items.length,2);assert.equal(future.calendar.items.find(row=>row.entryId===id(7401)).status,'cancelled');
  phase='publication-carry-in';assert.equal(future.rules.items.length,2);const enterprise=future.rules.items.find(row=>row.groupId===null);
  assert.equal(enterprise.revision,35);assert.deepEqual(enterprise.publications.map(row=>row.operationId),[id(7502)]);
  assert.equal(future.rules.items.find(row=>row.groupId===group).publications[0].operationId,id(7702));
  // Existing093 includes an open span only when the current read time has
  // reached the requested interval. It never extrapolates today's open session
  // into a wholly future range; the earlier past read separately proves null
  // confirmed totals for that ongoing source.
  assert.equal(future.attendance.totals.selected.workedUs,0);assert.equal(future.attendance.base.openSessionCount,0);
  assert.deepEqual(future.attendance.base.rows,[]);assert(future.attendance.base.asOf<future.attendance.base.fromAt);
  assert.equal(future.attendance.base.periodInProgress,true,'zero completed-source sum is not evidence of absence');
  phase='current-versus-historical-identity';const rebound=probe(`update public.merchant_attendance_workers set employee_id=null,version=version+1 where merchant_id='${site}' and id='${worker}';`);
  assert.equal(rebound.worker.employeeId,null);assert(rebound.warnings.includes('identity_changed'));assert(rebound.leave.items.every(row=>row.employeeId===id(101)));
  assert(rebound.assignments.items.every(row=>row.detail.employeeId===id(101)));
  const paused=probe(`update public.merchant_attendance_workers set active=false,version=version+1 where merchant_id='${site}' and id='${worker}';
    update public.merchant_attendance_settings set enabled=false where merchant_id='${site}';`);assert.equal(paused.worker.active,false);assert.equal(paused.leave.items.length,2);
  phase='owner-worker-and-query-fences';const reject=(query,actor,code)=>{const before=data.fingerprint();exec(`set local role service_role;do $denied$ begin ${denied(code,expression(query,actor))} end;$denied$;`);assert.equal(data.fingerprint(),before,'sources_denied_read_changed_facts');};
  reject(futureQuery,employee,'attendance_access_denied');reject({...futureQuery,siteId:'99990002'},owner,'attendance_access_denied');
  reject({...futureQuery,workerId:id(204)},owner,'attendance_worker_not_found');reject({...futureQuery,workerId:id(999999)},owner,'attendance_worker_not_found');
  for(const query of [null,{}, {...futureQuery,asOf:at(0,'00:00')},{...futureQuery,throughDate:day(10)},{...futureQuery,fromDate:day(5)},{...futureQuery,workerId:null}])reject(query,owner,'attendance_invalid_request');
  assert.equal(read(sourcesQueryInput(day(-3),day(3))).throughDate,day(3),'exact seven inclusive local dates');
  phase='bounded-context-cap';const create=n=>`perform public.faolla_attendance_calendar_v1(${json(calendarQueryInput())},'${owner}',${json(calendarNativeCreate(n,day(3),day(4)))},true);`;
  // Seed98 once: existing2 +98 =100. One further original RPC produces101.
  // Both actual reader calls retain the established timeout and run inside one
  // ownership-guarded rollback transaction, with a fingerprint around EACH read.
  const creates=Array.from({length:98},(_,n)=>create(9000+n)).join('\n');
  const [complete,limited]=data.probeSequence([`do $seed$ begin ${creates} end;$seed$;`,`do $seed$ begin ${create(9098)} end;$seed$;`]);
  assert.equal(complete.calendar.limited,false);assert.equal(complete.calendar.items.length,100);
  assert.deepEqual(new Set(complete.calendar.items.map(row=>row.entryId)),new Set([id(7401),id(7403),...Array.from({length:98},(_,n)=>id(9000+n))]));
  assert(!complete.warnings.includes('calendar_truncated'));
  assert.equal(limited.calendar.limited,true);assert.deepEqual(limited.calendar.items,[]);assert(limited.warnings.includes('calendar_truncated'));
  assert.equal(limited.schedule.items.length,2);assert.equal(limited.leave.items.length,2);
  phase='private-acl-and-final-readonly';exec(`do $acl$ begin
    assert not has_function_privilege('anon','public.${rpc}(jsonb,uuid)','EXECUTE'),'sources_anon_execute';
    assert not has_function_privilege('authenticated','public.${rpc}(jsonb,uuid)','EXECUTE'),'sources_authenticated_execute';
    assert has_function_privilege('service_role','public.${rpc}(jsonb,uuid)','EXECUTE'),'sources_service_execute_required';
    assert (select prosecdef from pg_proc where oid='public.${rpc}(jsonb,uuid)'::regprocedure),'sources_definer_required';
    end;$acl$;`);
  assert.equal(data.fingerprint(),baseline,'sources_final_read_or_rollback_changed_all_tables');assert.equal(data.oldDefinition(),data.oldDefinitionBaseline,'sources_changed_old_readers');
  if(browserCheck){await browserCheck(data);assert.equal(data.fingerprint(),baseline,'sources_browser_changed_all_tables');}
  for(const label of labels)native.pass(label);return {checks:labels.length,sourceReads:data.readCount(),syntheticOnly:true,assessmentPerformed:false,allReadFingerprintsUnchanged:true,callerOwnedNamespaceCleanup:true};
}
export async function runAttendanceSourcesNative(args){return runAttendanceLabelsReuse(args,native=>withAttendanceConcurrencySandbox(native,scope=>checkAttendanceSourcesNative(native,scope)));}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  runAttendanceSourcesNative(process.argv.slice(2)).catch(error=>{console.error(JSON.stringify(sourcesNativeFailure(error)));process.exitCode=1;});
}
