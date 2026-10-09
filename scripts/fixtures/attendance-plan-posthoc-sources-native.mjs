//204 inert caller-owned acceptance support. The session is explicitly synthetic
//history; the missing submission/approval below use the actual old service/RPC.
//No clock, old row, trigger, constraint, function or schema is rewritten here.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {assertLifecycleSandbox,lifecycleId as id,lifecycleJson as json} from '../merchant-attendance-lifecycle-native-support.mjs';
import {quote} from './attendance-bound-clocks-native.mjs';

const require=createRequire(import.meta.url);
const ids=Object.freeze({start:id(204710),end:id(204711),clockIn:id(204712),clockOut:id(204713),policy:id(204714),request:id(204715),approval:id(204716)});
const fmt='YYYY-MM-DD"T"HH24:MI:SS.US"Z"';
const sessionTargets={merchant_attendance_events:['id',[ids.start,ids.end]],merchant_attendance_shift_rule_bindings:['start_event_id',[ids.start]]};
const missingTargets={merchant_attendance_correction_controls:['operation_id',[ids.policy]],merchant_attendance_missing_requests:['request_id',[ids.request]],merchant_attendance_missing_entries:['operation_id',[ids.request,ids.approval]]};

function ownedContext({d,h,native,scope}){
  assert(d?.syntheticOnly===true&&h?.syntheticOnly===true&&h.syntheticHistoricalRows===10,'posthoc_synthetic_history_required');
  assert.equal(typeof d.exec,'function');assert.equal(typeof d.guard,'string');assert.equal(typeof native?.query,'function');assert.equal(typeof scope?.sql,'function');
  assert.match(scope.schema,/^attendance_race_[a-f0-9]{32}$/);
  const owned=assertLifecycleSandbox(sql=>native.query(scope.sql(sql)));
  assert.deepEqual(owned,d.owned);assert.equal(owned.schema,scope.schema);
  assert.equal(h.workerId,d.otherWorker);assert.equal(h.employeeId,d.otherEmployee);assert.equal(h.employeeAuthUserId,d.otherAuth);
  assert.equal(h.slot.locationId,d.location);assert.equal(h.slot.timeZone,'UTC');assert.match(d.site,/^\d{8}$/);
  for(const value of [d.owner,h.workerId,h.employeeId,h.employeeAuthUserId,h.startEventId,h.lastEventId,d.location])assert.match(value,/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  assert.match(h.slot.endAt,/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.(?:\d{3}|\d{6})Z$/);
  const exec=sql=>d.exec("reset role;set local time zone 'UTC';set local datestyle='ISO, YMD';"+d.guard+sql);
  return {owned,exec,names:d.inventory(),definitions:d.definitions(),catalog:d.tableCatalog()};
}

function factsSql(names,targets={}){
  assert(names.length>0&&new Set(names).size===names.length);
  return '(select md5(jsonb_object_agg(name,rows order by name)::text) from ('+names.map(name=>{
    assert(/^(?:merchants|faolla_schema_migrations|merchant_[a-z0-9_]+)$/.test(name)&&name.length<=63);
    const target=targets[name],where=target?' where r.'+target[0]+' not in('+target[1].map(quote).join(',')+')':'';
    return 'select '+quote(name)+" name,(select coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text),'[]') from public."+name+' r'+where+') rows';
  }).join(' union all ')+') posthoc_original_rows)';
}
function tableChecks(targets,owned,names){
  return Object.entries(targets).map(([name,[key,values]])=>{
    assert(names.includes(name));
    return `assert exists(select 1 from pg_class c where c.oid='public.${name}'::regclass and c.relnamespace=${owned.oid} and c.relowner::regrole::text='postgres' and c.relrowsecurity),'posthoc_owned_table_required';
      assert not exists(select 1 from pg_constraint c where c.conrelid='public.${name}'::regclass and not c.convalidated),'posthoc_valid_constraints_required';
      assert not exists(select 1 from pg_trigger t where t.tgrelid='public.${name}'::regclass and t.tgenabled<>'O'),'posthoc_enabled_triggers_required';
      assert not exists(select 1 from public.${name} where ${key} in(${values.map(quote).join(',')})),'posthoc_fresh_ids_required';`;
  }).join('\n');
}
function sameDefinitions(d,state){assert.equal(d.definitions(),state.definitions,'posthoc_definitions_unchanged');assert.equal(d.tableCatalog(),state.catalog,'posthoc_catalog_unchanged');}
const counts=(exec,targets)=>JSON.parse(exec('select jsonb_build_object('+Object.keys(targets).map(name=>quote(name)+',(select count(*) from public.'+name+')').join(',')+');'));
const locks=(d,h)=>`perform 1 from public.merchants where id=${quote(d.site)} and user_id=${quote(d.owner)} for share;assert found,'posthoc_real_owner_required';
  perform 1 from public.merchant_attendance_settings where merchant_id=${quote(d.site)} and enabled and time_zone='UTC' for update;assert found,'posthoc_utc_settings_required';
  perform 1 from public.merchant_attendance_workers where merchant_id=${quote(d.site)} and id=${quote(h.workerId)} and employee_id=${quote(h.employeeId)} and default_location_id=${quote(d.location)} and active for update;assert found,'posthoc_current_worker_required';
  perform 1 from public.merchant_enterprise_employees where merchant_id=${quote(d.site)} and id=${quote(h.employeeId)} and auth_user_id=${quote(h.employeeAuthUserId)} and status='active' for share;assert found,'posthoc_current_auth_required';
  perform 1 from public.merchant_attendance_locations where merchant_id=${quote(d.site)} and id=${quote(d.location)} and active and time_zone='UTC' for share;assert found,'posthoc_current_location_required';`;

export async function seedPosthocNativeSources(ctx){
  const {d,h,native}=ctx,state=ownedContext(ctx),{owned,exec,names}=state;
  const preserved=factsSql(names,sessionTargets),before=exec('select '+preserved+';'),beforeCounts=counts(exec,sessionTargets);
  const session=JSON.parse(exec(`do $posthoc_session_seed$ declare a timestamptz;b timestamptz;proof jsonb;begin
    assert current_user='postgres','posthoc_owned_postgres_required';${tableChecks(sessionTargets,owned,names)}${locks(d,h)}
    assert (select count(*) from public.merchant_attendance_events where merchant_id=${quote(d.site)} and worker_id=${quote(h.workerId)})=2,'posthoc_exact_original_pair';
    assert exists(select 1 from public.merchant_attendance_events where merchant_id=${quote(d.site)} and worker_id=${quote(h.workerId)} and id=${quote(h.startEventId)} and sequence=1 and action='clock_in'),'posthoc_original_start';
    assert exists(select 1 from public.merchant_attendance_events where merchant_id=${quote(d.site)} and worker_id=${quote(h.workerId)} and id=${quote(h.lastEventId)} and sequence=2 and action='clock_out' and occurred_at=${quote(h.slot.endAt)}::timestamptz-interval '25 minutes'),'posthoc_original_closed_tail';
    a:=${quote(h.slot.endAt)}::timestamptz-interval '20 minutes';b:=${quote(h.slot.endAt)}::timestamptz-interval '15 minutes';
    assert a<b and b<clock_timestamp(),'posthoc_past_closed_interval';
    insert into public.merchant_attendance_events(id,merchant_id,worker_id,location_id,operation_id,sequence,action,source,break_paid,occurred_at,received_at,time_zone,actor_employee_id)
      values(${quote(ids.start)},${quote(d.site)},${quote(h.workerId)},${quote(d.location)},${quote(ids.clockIn)},3,'clock_in','web',null,a,a,'UTC',${quote(h.employeeId)}),
        (${quote(ids.end)},${quote(d.site)},${quote(h.workerId)},${quote(d.location)},${quote(ids.clockOut)},4,'clock_out','web',null,b,b,'UTC',${quote(h.employeeId)});
    insert into public.merchant_attendance_shift_rule_bindings(merchant_id,start_event_id,worker_id,operation_id,sequence,location_id,occurred_at,event_time_zone,
      channel,request_auth_user_id,employee_id,employee_auth_user_id,worker_version,settings_version,status,reason,source_id,algorithm_version,binding_policy,recorded_at)
      values(${quote(d.site)},${quote(ids.start)},${quote(h.workerId)},${quote(ids.clockIn)},3,${quote(d.location)},a,'UTC','self',${quote(h.employeeAuthUserId)},${quote(h.employeeId)},${quote(h.employeeAuthUserId)},
        (select version from public.merchant_attendance_workers where merchant_id=${quote(d.site)} and id=${quote(h.workerId)}),
        (select version from public.merchant_attendance_settings where merchant_id=${quote(d.site)}),'unverified','source_unavailable',null,'personal-group-enterprise-point-v1','clock-in-whole-shift-v1',a);
    proof:=public.faolla_attendance_period_session_v1(${quote(d.site)},${quote(h.workerId)},${quote(ids.start)},${quote(h.employeeId)},${quote(h.employeeAuthUserId)},clock_timestamp());
    assert proof->'item'->'events'->1->>'id'=${quote(ids.end)} and jsonb_array_length(proof->'item'->'events')=2 and proof->'item'->'effect'='null'::jsonb,'posthoc_actual148_closed_pair';
    assert proof->'ruleBinding'->>'status'='unverified' and proof->'ruleBinding'->>'reason'='source_unavailable' and proof->'relation'='null'::jsonb and proof->'adoption'='null'::jsonb and proof->'planRuleApproval'='null'::jsonb,'posthoc_no_fabricated_plan_proof';
    assert ${preserved}=${quote(before)},'posthoc_seed_preserves_original_rows';
  end;$posthoc_session_seed$;
  select public.faolla_attendance_period_session_v1(${quote(d.site)},${quote(h.workerId)},${quote(ids.start)},${quote(h.employeeId)},${quote(h.employeeAuthUserId)},clock_timestamp());`));
  assert.equal(exec('select '+preserved+';'),before);sameDefinitions(d,state);
  const afterCounts=counts(exec,sessionTargets);assert.equal(afterCounts.merchant_attendance_events,beforeCounts.merchant_attendance_events+2);assert.equal(afterCounts.merchant_attendance_shift_rule_bindings,beforeCounts.merchant_attendance_shift_rule_bindings+1);
  assert.deepEqual(session.item.events.map(e=>[e.id,e.sequence,e.action]),[[ids.start,3,'clock_in'],[ids.end,4,'clock_out']]);
  assert.equal(session.ruleBinding.employeeId,h.employeeId);assert.equal(session.ruleBinding.employeeAuthUserId,h.employeeAuthUserId);
  native.pass('204 three synthetic append-only history rows; actual148 identity proof; original rows, definitions and catalog unchanged');
  return {reference:{kind:'session',startEventId:ids.start,lastEventId:ids.end,lastSequence:4,effectOperationId:null,effectRevision:null},session,
    syntheticOnly:true,syntheticHistoricalRows:3,actualHistoricalClockRequests:false,actualSessionReader:true,existingRowsUnchanged:true,callerOwnsRuntimeAndCleanup:true};
}

export async function createPosthocMissingNative(ctx){
  const {d,h,native}=ctx,state=ownedContext(ctx),{owned,exec,names}=state;
  // Explicit fixture-only permission setup. Preserve every other role and row;
  // real version/touch triggers, if installed by the caller, remain enabled.
  const role=JSON.parse(exec(`select to_jsonb(r) from public.merchant_enterprise_roles r join public.merchant_enterprise_employees e on e.merchant_id=r.merchant_id and e.role_id=r.id where e.merchant_id=${quote(d.site)} and e.id=${quote(h.employeeId)};`));
  assert(role?.status==='active'&&Array.isArray(role.permissions)&&role.permissions.includes('attendance.self.view'));
  const withoutRole=factsSql(names,{merchant_enterprise_roles:['id',[role.id]]}),otherFacts=exec('select '+withoutRole+';');
  if(!role.permissions.includes('attendance.self.request')){
    exec(`do $posthoc_permission_setup$ begin ${locks(d,h)}
      update public.merchant_enterprise_roles set permissions=array_append(permissions,'attendance.self.request') where merchant_id=${quote(d.site)} and id=${quote(role.id)} and to_jsonb(merchant_enterprise_roles)=${json(role)};
      assert found,'posthoc_role_setup_compare_and_swap';end;$posthoc_permission_setup$;`);
    const configured=JSON.parse(exec(`select to_jsonb(r) from public.merchant_enterprise_roles r where merchant_id=${quote(d.site)} and id=${quote(role.id)};`));
    assert.deepEqual(configured.permissions,[...role.permissions,'attendance.self.request']);
    const stable=value=>Object.fromEntries(Object.entries(value).filter(([key])=>!['permissions','version','updated_at'].includes(key)));
    assert.deepEqual(stable(configured),stable(role));assert([role.version,role.version+1].includes(configured.version));assert(Date.parse(configured.updated_at)>=Date.parse(role.updated_at));
  }
  assert.equal(exec('select '+withoutRole+';'),otherFacts,'posthoc_only_explicit_fixture_role_setup');sameDefinitions(d,state);
  const preserved=factsSql(names,missingTargets),before=exec('select '+preserved+';'),beforeCounts=counts(exec,missingTargets);
  exec(`do $posthoc_missing_initial$ begin ${tableChecks(missingTargets,owned,names)}${locks(d,h)}
    assert exists(select 1 from public.merchant_attendance_events where merchant_id=${quote(d.site)} and worker_id=${quote(h.workerId)} and id=${quote(ids.end)} and sequence=4 and action='clock_out'),'posthoc_seed_must_precede_missing';
  end;$posthoc_missing_initial$;`);
  const {executeAttendanceMissing}=require('../../src/lib/merchantAttendanceMissing.server.ts');
  const service={rpc:async(name,args)=>{
    assert.equal(name,'faolla_attendance_missing_v1');assert.equal(args.p_allow_write,true);
    try{return {data:JSON.parse(exec(`set local role service_role;select public.faolla_attendance_missing_v1(${json(args.p_query)},${quote(args.p_auth_user_id)},${json(args.p_command)},true);`)),error:null};}
    catch(error){const code=String(error).match(/ERROR:\s+(attendance_[a-z_]+)/)?.[1];if(!code)throw error;return {data:null,error:{message:code}};}
  }};
  // List dates cover submission time, NOT the past proposal date. Obtain both
  // dates and proposal endpoints from PostgreSQL; never alter the test clock.
  const timing=JSON.parse(exec(`select jsonb_build_object('today',(clock_timestamp() at time zone 'UTC')::date,'startAt',to_char((${quote(h.slot.endAt)}::timestamptz-interval '10 minutes') at time zone 'UTC',${quote(fmt)}),'endAt',to_char((${quote(h.slot.endAt)}::timestamptz-interval '5 minutes') at time zone 'UTC',${quote(fmt)}));`));
  const query=(access='self',requestId=null)=>({siteId:d.site,access,fromDate:timing.today,throughDate:timing.today,requestId,operationId:null,beforeAt:null,beforeId:null});
  const call=(q,c=null)=>executeAttendanceMissing({query:q,command:c,authUserId:q.access==='owner'?d.owner:h.employeeAuthUserId,allowWrite:true},service);
  const read=async q=>{const facts=d.fingerprint(),result=await call(q);assert.equal(d.fingerprint(),facts,'posthoc_missing_read_zero_writes');return result;};
  let home=await read(query());assert(home.canRequest&&home.workerId===h.workerId&&home.employeeId===h.employeeId&&home.timeZone==='UTC');
  const policyRevision=Number(exec(`select coalesce(max(revision),0) from public.merchant_attendance_correction_controls where merchant_id=${quote(d.site)};`));
  const policy={action:'set_policy',operationId:ids.policy,expectedRevision:policyRevision,expectedSettingsVersion:home.settingsVersion,submissionWindowDays:365,reason:'Synthetic204 explicit missing submission window'};
  exec(`set local role service_role;select public.faolla_attendance_correction_controls_v2(${quote(d.site)},${quote(d.owner)},${json(policy)},null,null,true);`);
  home=await read(query());assert(home.policyRevision>0);
  const submit={action:'submit',operationId:ids.request,reason:'Synthetic204 actual employee missing request',expectedWorkerId:h.workerId,expectedSettingsVersion:home.settingsVersion,
    expectedPolicyRevision:home.policyRevision,locationId:d.location,timeZone:'UTC',proposal:{startAt:timing.startAt,endAt:timing.endAt,breaks:[]}};
  const submitted=await call(query(),submit);assert.equal(submitted.detail.status,'submitted');assert.deepEqual(submitted.receipt.command,submit);
  const review=await read(query('owner',ids.request));assert(review.detail.canApprove);assert.deepEqual(review.detail.issues,[]);
  const approve={action:'approve',operationId:ids.approval,requestId:ids.request,expectedRevision:1,evidenceToken:review.detail.evidenceToken,reason:'Synthetic204 actual owner missing approval'};
  const approved=await call(query('owner',ids.request),approve);assert.deepEqual(approved.receipt.command,approve);assert.equal(approved.detail.status,'approved');
  const self=await read(query('self',ids.request));assert.equal(self.detail.status,'approved');
  assert.equal(self.detail.lineage.rootRequestId,ids.request);assert.equal(self.detail.lineage.currentRequestId,ids.request);assert.equal(self.detail.lineage.currentApprovalOperationId,ids.approval);
  const proof=JSON.parse(exec(`select jsonb_build_object('current',exists(select 1 from public.merchant_attendance_missing_current_v1 r where r.merchant_id=${quote(d.site)} and r.request_id=${quote(ids.request)} and r.worker_id=${quote(h.workerId)} and r.employee_id=${quote(h.employeeId)} and r.actor_auth_user_id=${quote(h.employeeAuthUserId)}),
    'actors',(select jsonb_agg(jsonb_build_object('operationId',operation_id,'actorId',actor_auth_user_id) order by revision) from public.merchant_attendance_missing_entries where merchant_id=${quote(d.site)} and request_id=${quote(ids.request)}));`));
  assert.equal(proof.current,true);assert.deepEqual(proof.actors,[{operationId:ids.request,actorId:h.employeeAuthUserId},{operationId:ids.approval,actorId:d.owner}]);
  assert.equal(exec('select '+preserved+';'),before,'posthoc_missing_all_preexisting_business_rows_unchanged');sameDefinitions(d,state);
  const afterCounts=counts(exec,missingTargets);for(const [table,n] of [['merchant_attendance_correction_controls',1],['merchant_attendance_missing_requests',1],['merchant_attendance_missing_entries',2]])assert.equal(afterCounts[table],beforeCounts[table]+n,table);
  native.pass('204 real old missing service submit/owner approval, saved dual identity/current head, zero-write reads and exact new-row write set; only disclosed owned role permission setup');
  return {kind:'missing',rootRequestId:ids.request,requestId:ids.request,approvalOperationId:ids.approval};
}
