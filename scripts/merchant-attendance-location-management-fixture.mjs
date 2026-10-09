// Owned-sandbox preparation only: synthetic fence/configuration plus real
// policy/publication/acknowledgement RPCs. Never seeds or performs a punch.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';
import {assertLifecycleSandbox,lifecycleId as id,lifecycleJson as json} from './merchant-attendance-lifecycle-native-support.mjs';

const require=createRequire(import.meta.url);
const {ATTENDANCE_LOCATION_CLOCK_ERRORS}=require('../src/lib/merchantAttendanceLocationClock.ts');
const {ATTENDANCE_SELF_CONTEXT_ERRORS}=require('../src/lib/merchantAttendanceSelfContext.ts');
const migrationNames=[
  '202609300071_merchant_attendance_location_precheck.sql',
  '202609300072_merchant_attendance_location_clock.sql',
  '202609300073_merchant_attendance_location_policy_drafts.sql',
  '202609300076_merchant_attendance_location_notices.sql',
  '202609300077_merchant_attendance_location_clock_notice_guard.sql',
  '202609300079_merchant_attendance_self_context.sql',
  '202610020113_merchant_attendance_location_receipt_identity.sql',
];
const expected={site:'99990001',ownerId:id(99),employeeAuthId:id(1),workerId:id(201),placeId:id(301)};
const rpcName='faolla_attendance_location_clock_v2';
const contextRpcName='faolla_attendance_self_context_v1';
const rpcKeys=['p_site_id','p_auth_user_id','p_expected_worker_id','p_command','p_operation_id','p_assertion','p_allow_new_sessions','p_require_clock'];
const commandKeys=['operationId','locationId','action','expectedSequence','settingsVersion','workerVersion','locationVersion','noticeRevision','safeFinish'];
const assertionKeys=['policyFingerprint','algorithmVersion','reason','capturedAt','accuracyMeters','distanceMeters'];
const literal=value=>value===null?'null':typeof value==='boolean'?String(value):"'"+String(value).replaceAll("'","''")+"'";
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
const integer=(value,min,max=Number.MAX_SAFE_INTEGER)=>Number.isSafeInteger(value)&&value>=min&&value<=max;
function exact(value,keys,label){
  assert(value&&typeof value==='object'&&!Array.isArray(value)
    &&[Object.prototype,null].includes(Object.getPrototypeOf(value)),label);
  assert.deepEqual(Reflect.ownKeys(value).sort(),keys.slice().sort(),label);
}
function binding(options,withOwner=false){
  const keys=['site','employeeAuthId','workerId','placeId',...(withOwner?['ownerId']:[])];
  exact(options,keys,'location_management_binding_fields');
  for(const key of keys)assert.equal(options[key],expected[key],'location_management_synthetic_binding_required');
  return {...options};
}

export function locationManagementFixturePlan(root){
  assert.equal(typeof root,'string');assert(path.isAbsolute(root),'location_management_root_required');
  return migrationNames.map(name=>({name,source:readFileSync(path.join(root,'scripts/supabase-migrations',name),'utf8')}));
}

function validAssertion(value){
  exact(value,assertionKeys,'location_management_assertion_fields');
  assert(typeof value.policyFingerprint==='string'&&/^[0-9a-f]{32}$/.test(value.policyFingerprint)
    &&value.algorithmVersion===1,'location_management_assertion_policy');
  if(['inside','outside','uncertain'].includes(value.reason)){
    assert(typeof value.capturedAt==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.capturedAt)
      &&Number.isFinite(Date.parse(value.capturedAt))&&new Date(value.capturedAt).toISOString()===value.capturedAt
      &&value.capturedAt>='2000-01-01T00:00:00.000Z'&&value.capturedAt<'2101-01-01T00:00:00.000Z'
      &&typeof value.accuracyMeters==='number'&&Number.isFinite(value.accuracyMeters)
      &&value.accuracyMeters>=0&&value.accuracyMeters<=40100000&&integer(value.distanceMeters,0,20100000),
    'location_management_assertion_range');
  }else assert(['denied','timeout','unavailable','unsupported','not_provided'].includes(value.reason)
    &&value.capturedAt===null&&value.accuracyMeters===null&&value.distanceMeters===null,'location_management_assertion_failure');
}

// exec must already be namespace-qualified. Only the actual default location
// clock/context executor RPCs are accepted; coordinates/browser-only fields cannot
// cross this boundary. No fake policy, authorization or clock result is made.
export function createAttendanceLocationManagementRpc(exec,options){
  assert.equal(typeof exec,'function');const bound=binding(options);assertLifecycleSandbox(exec);
  return async(name,args)=>{
    assert([rpcName,contextRpcName].includes(name),'location_management_rpc_not_allowed');
    const fields=name===contextRpcName?['p_site_id','p_auth_user_id']:rpcKeys;
    exact(args,fields,'location_management_rpc_fields');
    assert.equal(args.p_site_id,bound.site,'location_management_rpc_site');
    assert.equal(args.p_auth_user_id,bound.employeeAuthId,'location_management_rpc_actor');
    if(name===rpcName){
    assert.equal(args.p_expected_worker_id,bound.workerId,'location_management_rpc_worker');
    assert(typeof args.p_allow_new_sessions==='boolean'&&typeof args.p_require_clock==='boolean','location_management_rpc_gates');
    assert(args.p_operation_id===null||uuid(args.p_operation_id),'location_management_rpc_operation');
    const command=args.p_command;
    if(command===null)assert.equal(args.p_assertion,null,'location_management_read_assertion');
    else{
      exact(command,commandKeys,'location_management_command_fields');
      assert(uuid(command.operationId)&&command.locationId===bound.placeId
        &&['clock_in','break_start','break_end','clock_out'].includes(command.action)
        &&integer(command.expectedSequence,0,Number.MAX_SAFE_INTEGER-1)
        &&['settingsVersion','workerVersion','locationVersion'].every(key=>integer(command[key],1))
        &&typeof command.safeFinish==='boolean','location_management_command_values');
      assert.equal(args.p_operation_id,null,'location_management_mixed_operation');
      assert.equal(args.p_require_clock,true,'location_management_write_requires_clock');
      if(command.safeFinish)assert(command.noticeRevision===null&&['break_end','clock_out'].includes(command.action)
        &&args.p_assertion===null,'location_management_safe_finish');
      else{
        assert(integer(command.noticeRevision,1,Number.MAX_SAFE_INTEGER-1),'location_management_notice_revision');
        // Missing/denied policy is deliberately forwarded as null by the real
        // executor, so SQL still decides the authoritative business rejection.
        if(args.p_assertion!==null)validAssertion(args.p_assertion);
      }
    }
    }
    const values=fields.map(key=>['p_command','p_assertion'].includes(key)?json(args[key]):literal(args[key]));
    try{
      const result=JSON.parse(await exec(`begin;set local role service_role;select jsonb_build_object('role',current_user,'data',
        public.${name}(${values.join(',')}));commit;`));
      assert.equal(result.role,'service_role','location_management_service_role_required');
      assert(Object.hasOwn(result,'data'),'location_management_sql_result_required');
      return {data:result.data,error:null};
    }catch(error){
      const code=String(error).match(/\bERROR:\s+(?:[0-9A-Z]{5}:\s+)?(attendance_[a-z_]+)(?:\s|$)/)?.[1];
      const errors=name===contextRpcName?ATTENDANCE_SELF_CONTEXT_ERRORS:ATTENDANCE_LOCATION_CLOCK_ERRORS;
      return {data:null,error:{message:code&&Object.hasOwn(errors,code)?code:'attendance_unavailable'}};
    }
  };
}

export async function prepareAttendanceLocationManagement(native,scope,options){
  assert.equal(typeof native.query,'function');assert.equal(typeof scope.sql,'function');
  const bound=binding(options,true),exec=statement=>native.query(scope.sql(statement)),owned=assertLifecycleSandbox(exec);
  assert.equal(scope.schema,owned.schema,'location_management_scope_mismatch');
  const plan=locationManagementFixturePlan(native.root);
  const ownedGuard=`do $owned$ begin
    if not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where c.oid='public.merchants'::regclass and c.oid=${owned.tableOid} and n.oid=${owned.oid}
        and n.nspname=${literal(owned.schema)} and n.nspowner::regrole::text='postgres'
        and obj_description(n.oid,'pg_namespace')=${literal(owned.marker)})
      then raise exception 'location_management_owned_schema_required';end if;
    if (select count(*) from public.merchants)<>1 or not exists(select 1 from public.merchants m
      where m.id='${bound.site}' and '${bound.ownerId}'::uuid=any(array[m.user_id,m.auth_user_id,m.owner_user_id,m.owner_id,m.auth_id,m.created_by,m.created_by_user_id]))
      or not exists(select 1 from public.merchant_attendance_workers w
        join public.merchant_enterprise_employees e on e.merchant_id=w.merchant_id and e.id=w.employee_id
        join public.merchant_attendance_locations l on l.merchant_id=w.merchant_id and l.id=w.default_location_id
        where w.merchant_id='${bound.site}' and w.id='${bound.workerId}' and w.active and e.status='active'
          and e.auth_user_id='${bound.employeeAuthId}' and l.id='${bound.placeId}' and l.active)
      then raise exception 'location_management_seed_binding_required';end if;
  end;$owned$;`;
  const snapshot=`reset role;select jsonb_build_object(
    'events',(select md5(coalesce(jsonb_agg(to_jsonb(t) order by id)::text,'[]')) from public.merchant_attendance_events t),
    'employees',(select md5(coalesce(jsonb_agg(to_jsonb(t) order by id)::text,'[]')) from public.merchant_enterprise_employees t),
    'roles',(select md5(coalesce(jsonb_agg(to_jsonb(t) order by id)::text,'[]')) from public.merchant_enterprise_roles t),
    'workers',(select md5(coalesce(jsonb_agg(to_jsonb(t) order by id)::text,'[]')) from public.merchant_attendance_workers t),
    'enterpriseAudits',(select md5(coalesce(jsonb_agg(to_jsonb(t) order by id)::text,'[]')) from public.merchant_enterprise_audit_events t));`;
  const before=exec(snapshot);
  const qualify=source=>{const result=scope.sql(source);assert(!/\bpublic\./.test(result),'location_management_qualifier_required');return result;};
  // Keep every migration byte except the explicit namespace qualification,
  // including its original transaction and ACL. Re-check ownership before each.
  const steps=plan.flatMap(item=>[qualify(`begin;reset role;${ownedGuard}commit;`),qualify(item.source)]);
  if(typeof native.querySteps==='function')await native.querySteps(steps);
  else for(const step of steps)native.query(step);
  const values={purpose:'Synthetic employee management location check',notice:'Synthetic local notice; no physical attendance evidence',
    contact:'Synthetic owner',alternative:'Manual verification',retentionDays:90,latitude:37.3,longitude:-5.9,radiusMeters:100};
  // These two bounded fixture updates happen before the runner's baseline.
  // They are not asserted as an owner configuration UI/SQL success scenario.
  exec(`begin;reset role;${ownedGuard}
    update public.merchant_attendance_settings set enabled=true,web_clock_enabled=true,location_clock_enabled=true,location_check_enabled=true where merchant_id='${bound.site}';
    update public.merchant_attendance_locations set latitude=37.3,longitude=-5.9,radius_meters=100 where merchant_id='${bound.site}' and id='${bound.placeId}';
    commit;`);
  const versions=JSON.parse(exec(`reset role;select jsonb_build_object('settingsVersion',s.version,'workerVersion',w.version,'locationVersion',l.version)
    from public.merchant_attendance_settings s join public.merchant_attendance_workers w on w.merchant_id=s.merchant_id
    join public.merchant_attendance_locations l on l.merchant_id=w.merchant_id and l.id=w.default_location_id
    where s.merchant_id='${bound.site}' and w.id='${bound.workerId}' and l.id='${bound.placeId}';`));
  exact(versions,['settingsVersion','workerVersion','locationVersion'],'location_management_versions');
  assert(Object.values(versions).every(value=>integer(value,1)),'location_management_versions');
  const draft={operationId:id(1050701),expectedRevision:0,expectedSettingsVersion:versions.settingsVersion,expectedLocationVersion:versions.locationVersion,values};
  const publish={action:'publish',operationId:id(1050702),expectedRevision:0,draftRevision:1,
    expectedSettingsVersion:versions.settingsVersion,expectedLocationVersion:versions.locationVersion,reason:'Synthetic local preparation'};
  const noticeQuery=access=>({access,locationId:bound.placeId,expectedWorkerId:access==='self'?bound.workerId:null,operationId:null});
  exec(`begin;reset role;${ownedGuard}set local role service_role;do $prepare$ begin
    perform public.faolla_attendance_location_policy_draft_v1('${bound.site}','${bound.ownerId}','${bound.placeId}',${json(draft)},null,true);
    perform public.faolla_attendance_location_notice_v1('${bound.site}','${bound.ownerId}',${json(noticeQuery('owner'))},${json(publish)},true);
    perform public.faolla_attendance_location_notice_v1('${bound.site}','${bound.employeeAuthId}',${json(noticeQuery('self'))},${json({action:'acknowledge',operationId:id(1050703),expectedRevision:1})},true);
    end;$prepare$;commit;`);
  assert.equal(exec(snapshot),before,'location_management_preparation_changed_protected_facts');
  const prepared=JSON.parse(exec(`reset role;select jsonb_build_object(
    'policyRevision',(select max(revision) from public.merchant_attendance_location_policy_drafts where merchant_id='${bound.site}' and location_id='${bound.placeId}'),
    'noticeRevision',(select max(revision) from public.merchant_attendance_location_notices where merchant_id='${bound.site}' and location_id='${bound.placeId}' and action='publish'),
    'acknowledgements',(select count(*) from public.merchant_attendance_location_notice_acknowledgements where merchant_id='${bound.site}' and worker_id='${bound.workerId}' and location_id='${bound.placeId}' and notice_revision=1),
    'locationResults',(select count(*) from public.merchant_attendance_location_results),
    'clockNotices',(select count(*) from public.merchant_attendance_location_clock_notices),
    'clockV2',has_function_privilege('service_role','public.${rpcName}(text,uuid,uuid,jsonb,uuid,jsonb,boolean,boolean)','EXECUTE'),
    'privateV1',has_function_privilege('service_role','public.faolla_attendance_location_clock_v1(text,uuid,uuid,jsonb,uuid,jsonb,boolean,boolean)','EXECUTE'));`));
  assert.deepEqual(prepared,{policyRevision:1,noticeRevision:1,acknowledgements:1,locationResults:0,clockNotices:0,clockV2:true,privateV1:false},'location_management_preparation_mismatch');
  const rpc=createAttendanceLocationManagementRpc(exec,{site:bound.site,employeeAuthId:bound.employeeAuthId,workerId:bound.workerId,placeId:bound.placeId});
  return {site:bound.site,workerId:bound.workerId,placeId:bound.placeId,...versions,policyRevision:1,noticeRevision:1,
    rpc,service:{rpc},sourceMigrations:plan.map(item=>item.name),syntheticOnly:true,seededAttendanceEvents:0};
}
