// Inert193 boundary extension. ONE synthetic membership; all grants, status
//updates, restore and new inactive worker use real160/162/164/064 RPCs. All
//facts roll back in one caller-owned transaction. No fake success/worker rows.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {assertLifecycleSandbox,lifecycleId as id,lifecycleJson as json} from '../merchant-attendance-lifecycle-native-support.mjs';
import {quote} from './attendance-bound-clocks-native.mjs';
const require=createRequire(import.meta.url);
const fid=n=>id(193800000+n);
const parseLines=output=>output.trim().split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line));

function allFacts(names){
  assert(names.length&&new Set(names).size===names.length);
  return '(select md5(jsonb_object_agg(asb_name,asb_rows order by asb_name)::text) from ('+names.map(name=>{
    assert(/^(?:merchants|faolla_schema_migrations|merchant_[a-z0-9_]+)$/.test(name));
    return `select ${quote(name)} asb_name,(select coalesce(jsonb_agg(to_jsonb(asb_row) order by to_jsonb(asb_row)::text),'[]') from public.${name} asb_row) asb_rows`;
  }).join(' union all ')+') asb_tables)';
}
export function accountSuspensionBoundaryPlan({site,owner,targetWorker,targetEmployee,targetAuth,locationId,workerLocationId}){
  for(const value of [owner,targetWorker,targetEmployee,targetAuth,locationId,workerLocationId])assert(/^[0-9a-f-]{36}$/.test(value));assert(/^\d{8}$/.test(site));
  const delegateEmployee=fid(1),delegateAuth=fid(2),newWorker=fid(3);
  const validFrom=new Date(Date.now()-60000).toISOString().replace('Z','000Z'),validUntil=new Date(Date.now()+3600000).toISOString().replace('Z','000Z');
  const common={action:'grant',delegateEmployeeId:delegateEmployee,delegateAuthUserId:delegateAuth,workerId:targetWorker,employeeId:targetEmployee,employeeAuthUserId:targetAuth,
    validFrom,validUntil,reason:'Synthetic193 explicit pure-delegate scope'};
  const application={...common,operationId:fid(10),category:'leave',kinds:[],includePending:false};
  const missing={...common,operationId:fid(11),locationId};
  const attemptedApplication={...application,operationId:fid(12)},attemptedMissing={...missing,operationId:fid(13)};
  const freshApplication={...application,operationId:fid(14)};
  return {site,owner,targetWorker,targetEmployee,targetAuth,locationId,workerLocationId,delegateEmployee,delegateAuth,newWorker,application,missing,attemptedApplication,attemptedMissing,freshApplication,
    statusOperations:[fid(20),fid(21),fid(22),fid(23)],restoreOperation:fid(30),blockedRestoreOperation:fid(31),configOperation:fid(40)};
}

export async function verifyAccountSuspensionBoundaries({d,h,native,scope}){
  assert(d?.syntheticOnly===true&&h?.syntheticOnly===true&&typeof native?.querySteps==='function');
  const owned=assertLifecycleSandbox(sql=>native.query(scope.sql(sql)));assert.deepEqual(owned,d.owned);assert.equal(scope.schema,owned.schema);
  const baseline=d.fingerprint(),defs=d.definitions(),catalog=d.tableCatalog(),names=d.inventory();
  const preparation=JSON.parse(d.exec(`select jsonb_build_object('locationId',w.default_location_id,'workerLocationId',
    (select l.id from public.merchant_attendance_locations l where l.merchant_id=w.merchant_id and l.active and l.radius_meters is null order by l.id limit 1))
    from public.merchant_attendance_workers w where w.merchant_id=${quote(d.site)} and w.id=${quote(h.workerId)};`));
  assert.equal(d.fingerprint(),baseline,'boundary_preparation_read_wrote');
  const p=accountSuspensionBoundaryPlan({site:d.site,owner:d.owner,targetWorker:h.workerId,targetEmployee:h.employeeId,targetAuth:h.employeeAuthUserId,...preparation});
  const prefix="reset role;set local time zone 'UTC';set local datestyle='ISO, YMD';"+d.guard;
  const facts=allFacts(names),site=quote(p.site),owner=quote(p.owner),employee=quote(p.delegateEmployee),auth=quote(p.delegateAuth);
  const checked='reset role;set constraints all immediate;set constraints all deferred;';
  const mark=(kind,label)=>`${prefix}select jsonb_build_object('kind',${quote(kind)},'label',${quote(label)},'hash',${facts});`;
  const suspensionQuery=(mode,operation=null)=>mode==='detail'
    ?`jsonb_build_object('siteId',${site},'mode','detail','afterId',null,'suspensionId',current_setting('qa_account_boundary.pause'),'operationId',null)`
    :json({siteId:p.site,mode,afterId:null,suspensionId:null,operationId:operation});
  const suspension=(q,c='null')=>`public.faolla_attendance_account_suspensions_v1(${q},${owner},${c},true)`;
  const ownerQuery=json({siteId:p.site,access:'owner',mode:'list',catalog:null,afterId:null,grantId:null,operationId:null});
  const grant=(kind,command)=>kind==='application'?`public.faolla_attendance_application_delegations_v1(${ownerQuery},${owner},${json(command)},true,false)`
    :`public.faolla_attendance_missing_delegations_v1(${ownerQuery},${owner},${json(command)},true)`;
  const call=(label,expression)=>`${prefix}set local role service_role;select jsonb_build_object('kind','write','label',${quote(label)},'value',${expression});${checked}`;
  const read=(label,expression,savePause=false)=>mark('before_read',label)+`set local role service_role;with asb_read as materialized(select ${expression} value)
    select jsonb_build_object('kind','read','label',${quote(label)},'value',value${savePause?",'pause',set_config('qa_account_boundary.pause',value->'statusReceipt'->>'suspensionId',true)":''}) from asb_read;`+mark('after_read',label);
  const reject=(label,expression,code)=>mark('before_reject',label)+`set local role service_role;do $asb_reject$ begin
    begin perform ${expression};raise exception 'asb_expected_rejection_missing';exception when raise_exception then if sqlerrm<>${quote(code)} then raise;end if;end;
    end;$asb_reject$;`+mark('after_reject',label);
  const status=(status,index,expectedVersion)=>call('status_'+index,`public.faolla_update_merchant_enterprise_employee_v1(${json({merchant_id:p.site,employee_id:p.delegateEmployee,
    expected_version:expectedVersion,actor_type:'owner',actor_id:p.owner,status,...(status==='disabled'?{offboarding_mode:'unassign'}:{}),attendance_operation_id:p.statusOperations[index],attendance_suspension_enabled:true})})`);
  const restore=(operationId,employeeVersion,generation)=>`jsonb_build_object('action','restore','operationId',${quote(operationId)},'suspensionId',current_setting('qa_account_boundary.pause'),
    'expectedGeneration',${generation},
    'workerId',null,'expectedWorkerVersion',null,'expectedEmployeeVersion',${employeeVersion},'employeeId',${employee},'employeeAuthUserId',${auth},'reason','Synthetic193 restore original no-worker identity')`;
  const usable=(label)=>`${prefix}select jsonb_build_object('kind','usable','label',${quote(label)},'application',
    (select public.faolla_attendance_application_delegation_usable_v1(g,clock_timestamp()) from public.merchant_attendance_application_delegations g where g.merchant_id=${site} and g.grant_id=${quote(p.application.operationId)}),
    'missing',(select public.faolla_attendance_missing_delegation_usable_v1(g,clock_timestamp()) from public.merchant_attendance_missing_delegations g where g.merchant_id=${site} and g.grant_id=${quote(p.missing.operationId)}),
    'workers',(select count(*) from public.merchant_attendance_workers where merchant_id=${site} and employee_id=${employee}));`;
  const adminQuery=json({view:'workers',cursor:null,search:''});
  const adminHome=`public.faolla_attendance_admin_v1(${site},${owner},${adminQuery},null,null)`;
  const config=`jsonb_build_object('kind','worker','operationId',${quote(p.configOperation)},'expectedVersion',current_setting('qa_account_boundary.config_version')::bigint,
    'values',${json({id:p.newWorker,employeeId:p.delegateEmployee,workerNo:'SYNTHETIC193-PURE-DELEGATE',displayName:'Synthetic193 newly linked inactive worker',locationId:p.workerLocationId,active:false,startsOn:'2000-01-01'})})`;
  const seed=`${prefix}do $asb_seed$ begin
    assert exists(select 1 from public.faolla_schema_migrations where version=202610060164),'asb164_required';
    assert not exists(select 1 from public.merchant_enterprise_employees where id=${employee} or auth_user_id=${auth}),'asb_identity_unused';
    assert exists(select 1 from public.merchant_enterprise_employees e join public.merchant_enterprise_roles r on r.merchant_id=e.merchant_id and r.id=e.role_id
      where e.merchant_id=${site} and e.id=${quote(d.employee)} and r.status='active' and r.permissions @> array['enterprise.view','attendance.self.view','attendance.missing.review','attendance.leave.review']::text[]),'asb_real_delegate_role_required';
    insert into public.merchant_enterprise_employees(id,merchant_id,auth_user_id,email,display_name,role_id,status,accepted_at,version)
      select ${employee},${site},${auth},'synthetic193-pure-delegate@example.test','Synthetic193 pure delegate',e.role_id,'active',clock_timestamp(),1
      from public.merchant_enterprise_employees e where e.merchant_id=${site} and e.id=${quote(d.employee)};
    assert found,'asb_synthetic_membership_created';
    assert not exists(select 1 from public.merchant_attendance_workers where merchant_id=${site} and employee_id=${employee}),'asb_no_worker_initially';
  end;$asb_seed$;${checked}`;
  const adminRead=mark('before_read','admin_home')+`set local role service_role;with asb_home as materialized(select ${adminHome} value)
    select jsonb_build_object('kind','read','label','admin_home','value',value,'version',set_config('qa_account_boundary.config_version',value->>'version',true)) from asb_home;`+mark('after_read','admin_home');
  const steps=['begin;'+seed,
    call('grant_application',grant('application',p.application))+call('grant_missing',grant('missing',p.missing))+usable('before_stop'),
    status('disabled',0,1)+read('first_status_receipt',suspension(suspensionQuery('recover-status',p.statusOperations[0])),true)+usable('after_stop'),
    status('active',1,2)+read('pure_delegate_detail',suspension(suspensionQuery('detail'))),
    reject('paused_application_grant',grant('application',p.attemptedApplication),'attendance_account_suspended')+reject('paused_missing_grant',grant('missing',p.attemptedMissing),'attendance_account_suspended'),
    call('restore_pure_delegate',suspension(suspensionQuery('detail'),restore(p.restoreOperation,3,1)))+usable('after_restore'),
    call('fresh_application_after_restore',grant('application',p.freshApplication))+status('disabled',2,3),
    read('second_status_receipt',suspension(suspensionQuery('recover-status',p.statusOperations[2])),true)+status('active',3,4),
    adminRead+call('actual064_new_inactive_worker',`public.faolla_attendance_admin_v1(${site},${owner},${adminQuery},${config},null)`),
    read('changed_binding_detail',suspension(suspensionQuery('detail')))+reject('restore_changed_binding',suspension(suspensionQuery('detail'),restore(p.blockedRestoreOperation,5,2)),'attendance_account_suspension_changed'),
    `${prefix}set constraints all immediate;select jsonb_build_object('kind','final','worker',
      (select jsonb_build_object('id',w.id,'active',w.active) from public.merchant_attendance_workers w where w.merchant_id=${site} and w.employee_id=${employee}),
      'freshGrantUsable',(select public.faolla_attendance_application_delegation_usable_v1(g,clock_timestamp()) from public.merchant_attendance_application_delegations g where g.merchant_id=${site} and g.grant_id=${quote(p.freshApplication.operationId)}));rollback;`];
  assert(steps.length<=12);let rows;const failures=[];
  try{rows=parseLines(await native.querySteps(steps.map(step=>scope.sql(step))));}catch(error){failures.push(error);}
  finally{for(const [label,run,expected] of [['boundary_all_facts_restored',()=>d.fingerprint(),baseline],['boundary_definitions',()=>d.definitions(),defs],['boundary_catalog',()=>d.tableCatalog(),catalog]]){
    try{assert.equal(run(),expected,label);}catch(error){failures.push(error);}}}
  if(failures.length)throw new AggregateError(failures,'account_suspension_boundaries_failed: '+failures.map(error=>error.message).join(' | '));
  const row=label=>rows.find(r=>r.label===label&&['read','write'].includes(r.kind))?.value;
  const {parseAccountSuspensionResult}=require('../../src/lib/merchantAttendanceAccountSuspension.ts');
  const parse=(label,pause)=>parseAccountSuspensionResult(row(label),{siteId:p.site,mode:'detail',afterId:null,suspensionId:pause,operationId:null},p.owner);
  const firstPause=row('first_status_receipt').statusReceipt.suspensionId,secondPause=row('second_status_receipt').statusReceipt.suspensionId;assert.notEqual(firstPause,secondPause);
  const pure=parse('pure_delegate_detail',firstPause).detail;assert.equal(pure.suspension.generation,1);assert.equal(pure.employeeVersion,3);assert.equal(pure.suspension.workerId,null);assert.equal(pure.workerVersion,null);assert(pure.canRestore);assert.deepEqual(pure.blockers,[]);
  assert.equal(row('restore_pure_delegate').receipt.workerId,null);assert.equal(row('restore_pure_delegate').receipt.workerActive,null);
  const changed=parse('changed_binding_detail',secondPause).detail;assert.equal(changed.suspension.generation,2);assert.equal(changed.employeeVersion,5);assert.equal(changed.suspension.workerId,null);assert.equal(changed.workerActive,false);assert(Number.isSafeInteger(changed.workerVersion));assert(!changed.canRestore);assert(changed.blockers.includes('binding_changed'));
  for(const label of ['before_stop','after_stop','after_restore']){const r=rows.find(x=>x.kind==='usable'&&x.label===label);assert.equal(r.workers,0);assert.equal(r.application,label==='before_stop');assert.equal(r.missing,label==='before_stop');}
  for(const before of rows.filter(r=>r.kind==='before_read'||r.kind==='before_reject')){const after=rows.find(r=>r.label===before.label&&r.kind===before.kind.replace('before','after'));assert(after);assert.equal(after.hash,before.hash,'boundary_read_or_rejection_wrote:'+before.label);}
  const final=rows.at(-1);assert.deepEqual(final.worker,{id:p.newWorker,active:false});assert.equal(final.freshGrantUsable,false);
  for(let index=0;index<4;index++)assert.equal(row('status_'+index).employee.version,index+2);
  native.pass('pure delegate: real160/162 grants, pause and same-identity restore create no worker; real064 later binding is visible and blocks restore');
  return {syntheticMemberships:1,syntheticWorkerRows:0,realGrantWrites:3,realEmployeeStatusWrites:4,realRestoreWrites:1,real064WorkerCreates:1,
    reads:5,rejections:3,pureDelegateNoWorker:true,oldGrantsPermanentlyInvalid:true,newBindingParsedAndBlocked:true,allReadsAndRejectionsZeroWrites:true,
    outerRollbackTransactions:1,rollbackRestored:true,definitionsUnchanged:true,catalogUnchanged:true};
}
