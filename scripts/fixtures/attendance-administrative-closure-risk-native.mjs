//195 finite risk acceptance. Only new rows in the caller-owned synthetic schema.
//Micro-commits are necessary for the single two-connection lock witness. The
//parent drops its owned namespace on success AND failure; no append-only deletes.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {assertLifecycleSandbox,lifecycleId as id,lifecycleJson as json,lifecycleRace} from '../merchant-attendance-lifecycle-native-support.mjs';
import {quote} from './attendance-bound-clocks-native.mjs';
import {outageNativeFingerprintSql} from './attendance-outage-native.mjs';
import {periodContinuationSerialization,periodContinuationArchiveBytes} from './attendance-period-continuation-native.mjs';
import {employmentLifecycleCommandFromDetail} from './attendance-employment-lifecycle-native.mjs';

const require=createRequire(import.meta.url),uid=n=>id(245700000+n);
export const administrativeClosureRiskSite='99990196';
export async function verifyAdministrativeClosureRiskNative(ctx){
 const {d,h,native,scope,archive,periodArchive}=ctx;assert(d?.syntheticOnly===true&&h?.syntheticOnly===true);
 assert.deepEqual(assertLifecycleSandbox(sql=>native.query(scope.sql(sql))),d.owned);assert.equal(scope.schema,d.owned.schema);
 const pure=require('../../src/lib/merchantAttendanceAdministrativeClosure.ts');
 const {parseEmploymentLifecycleResult}=require('../../src/lib/merchantAttendanceEmploymentLifecycle.ts');
 const siteId=administrativeClosureRiskSite,site=quote(siteId),owner=quote(d.owner),names=d.inventory();
 const definitions=d.definitions(),catalog=d.tableCatalog(),old155=periodContinuationArchiveBytes(await archive()),old207=periodContinuationArchiveBytes(await periodArchive());
 const eventScoped=JSON.parse(d.exec(`select coalesce(jsonb_agg(c.relname order by c.relname),'[]')::text from pg_class c where c.relnamespace=${d.owned.oid}
  and c.relkind in('r','p') and c.relname<>all(array['merchants','faolla_schema_migrations']) and not exists(select 1 from pg_attribute a where a.attrelid=c.oid and a.attname='merchant_id' and not a.attisdropped);`));
 assert.deepEqual(eventScoped,['merchant_attendance_location_results']);
 const all=outageNativeFingerprintSql(names);
 const outside=`(select md5(jsonb_object_agg(n,rows order by n)::text) from (${names.map(n=>{
  assert(/^(?:merchants|faolla_schema_migrations|merchant_[a-z0-9_]+)$/.test(n));
  const where=n==='merchants'?`x.id<>${site}`:n==='faolla_schema_migrations'?'true':n==='merchant_attendance_location_results'?
   `exists(select 1 from public.merchant_attendance_events original_event where original_event.id=x.event_id and original_event.merchant_id<>${site})`:`x.merchant_id<>${site}`;
  return `select ${quote(n)} n,(select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),'[]'::jsonb) from public.${n} x where ${where}) rows`;
 }).join(' union all ')}) original_tables)`;
 const prefix=periodContinuationSerialization+d.guard+"set local lock_timeout='3s';set local statement_timeout='10s';";
 //The external and persistent connections must serialize the SAME stored
 //timestamptz/float values identically. This changes no fact or business clock.
 const outsideBefore=d.exec(periodContinuationSerialization+`select ${outside};`);
 const connection=native.connect({lifetimeMs:90000}),deadline=Date.now()+90000;
 const a={worker:uid(5),employee:uid(6),auth:uid(7)},b={worker:uid(8),employee:uid(9),auth:uid(10)},role=uid(1),location=uid(2),swappedAuth=uid(11);
 let serial=100,steps=0,reads=0,writes=0,rejections=0,stage='begin',last=null;
 const next=()=>uid(++serial),groups=[];
 const step=async(label,body)=>{stage=label;assert(++steps<=64,'administrative_risk_max64_steps');assert(Date.now()<deadline,'administrative_risk_deadline');return connection.step(scope.sql(body));};
 const callSql=(expression,{write=false,replay=false,prepare=''}={})=>`do $ac195_risk_call$ declare before_hash text;prepared_command jsonb;v jsonb;failure text;state_value text;constraint_value text;begin
  before_hash:=${all};${prepare}begin set local role service_role;assert current_user='service_role';v:=${expression};set constraints all immediate;set constraints all deferred;
  exception when others then get stacked diagnostics failure=message_text,state_value=returned_sqlstate,constraint_value=constraint_name;end;reset role;
  if failure is not null or v ? 'error' or ${!write||replay} then assert ${all}=before_hash,'ac195_risk_rejected_read_replay_wrote';end if;
  assert ${outside}=${quote(outsideBefore)},'ac195_risk_originals_changed';
  perform set_config('faolla.ac195_risk_result',jsonb_build_object('value',v,'error',failure,'sqlstate',state_value,'constraint',constraint_value)::text,true);
 end;$ac195_risk_call$;select current_setting('faolla.ac195_risk_result')::jsonb;`;
 const call=async(label,expression,options)=>{
  last=JSON.parse(await step(label,`begin;${prefix}${callSql(expression,options)}commit;`));
  if(last.error||last.value?.error)rejections++;else if(options?.write)writes++;else reads++;return last;
 };
 const ok=async(label,expression,options)=>{const r=await call(label,expression,options);assert.equal(r.error,null,JSON.stringify(r));assert(!r.value?.error,JSON.stringify(r));return r.value;};
 const reject=async(label,expression,code,options)=>{const r=await call(label,expression,{...options,write:true});assert.equal(r.error??r.value?.error,code,JSON.stringify(r));return r;};
 const candidate=p=>({siteId,access:'owner',mode:'candidate',workerId:p.worker});
 const detail=(p,access='self')=>({siteId,access,mode:'detail',startEventId:p.startEventId});
 const recover=(access,operationId)=>({siteId,access,mode:'recover',operationId});
 const expr=(query,actor,command=null,allow=true)=>`public.faolla_attendance_administrative_closures_v1(${json(query)},${quote(actor)},${json(command)},${allow})`;
 const closure=async(query,actor=d.owner,command=null,options={})=>pure.parseAdministrativeClosureResult(await ok('closure_'+(command?.action??query.mode),expr(query,actor,command),{write:!!command,...options}),query,actor,command);
 const closeCommand=(p,r)=>({action:'close',operationId:next(),workerId:p.worker,startEventId:r.data.detail.frame.startEventId,expectedRevision:r.data.detail.summary?.revision??0,
  expectedSourceFingerprint:r.data.detail.context.sourceFingerprint,verifiedEndAt:r.readAt,reason:'Synthetic195 finite direct closure'});
 const status=(p,value)=>ok('status_'+value,'public.faolla_update_merchant_enterprise_employee_v1(prepared_command)',{write:true,prepare:`prepared_command:=jsonb_build_object('merchant_id',${site},'employee_id',${quote(p.employee)},
  'expected_version',(select version from public.merchant_enterprise_employees where merchant_id=${site} and id=${quote(p.employee)}),'actor_type','owner','actor_id',${owner},'status',${quote(value)},
  'attendance_operation_id',${quote(next())},'attendance_suspension_enabled',true)${value==='disabled'?`||'{"offboarding_mode":"unassign"}'::jsonb`:''};`});
 const admin=(kind,values)=>ok('admin_'+kind,`public.faolla_attendance_admin_v1(${site},${owner},'{"view":"workers","cursor":null,"search":""}'::jsonb,prepared_command,null)`,{write:true,
  prepare:`prepared_command:=jsonb_build_object('kind',${quote(kind)},'operationId',${quote(next())},'expectedVersion',coalesce((select version from public.merchant_attendance_settings where merchant_id=${site}),0),'values',${json(values)});`});
 const clock=(p,action)=>ok('clock_'+action,`public.faolla_attendance_self_v1(${site},${quote(p.auth)},prepared_command,null)`,{write:true,prepare:`prepared_command:=jsonb_build_object('operationId',${quote(next())},'expectedWorkerId',${quote(p.worker)},
  'locationId',${quote(location)},'action',${quote(action)},'expectedSequence',(select coalesce(max(sequence),0) from public.merchant_attendance_events where merchant_id=${site} and worker_id=${quote(p.worker)}));`});
 const eq=p=>({siteId,mode:'detail',workerId:p.worker,afterId:null,afterRevision:null,operationId:null});
 const employment=async(p,command=null)=>parseEmploymentLifecycleResult(await ok('employment_'+(command?.action??'detail'),`public.faolla_attendance_employment_lifecycle_v1(${json(eq(p))},${owner},${json(command)},true)`,{write:!!command}),eq(p),d.owner,command);
 // A probe may mutate only freshly-created identities and always rolls back. It
 // invokes the real RPC, not a fake denied/receipt DTO; the exact full baseline
 // and catalog are checked after rollback, even though ordinary calls committed.
 const probe=async(label,mutation,checks)=>{
  const before=d.fingerprint();
  await step(label,`begin;${prefix}${mutation}do $ac195_risk_probe$ declare v jsonb;failure text;begin
   ${checks.map(({expression,error=null,receipt})=>`failure:=null;v:=null;begin set local role service_role;v:=${expression};exception when others then get stacked diagnostics failure=message_text;end;reset role;
    assert failure is not distinct from ${quote(error)},'ac195_risk_probe_exact_error';${receipt===undefined?'':`assert v->'data'=jsonb_build_object('kind','receipt','receipt',${json(receipt)}),'ac195_risk_probe_minimum_receipt';`}`).join('\n')}
   assert ${outside}=${quote(outsideBefore)},'ac195_risk_probe_originals_changed';end;$ac195_risk_probe$;rollback;select 1;`);
  assert.equal(d.fingerprint(),before,'ac195_risk_probe_full_rollback');assert.equal(d.tableCatalog(),catalog);
 };
 try{
  await step('new_owned_micro_commit',`begin;${prefix}do $ac195_risk_unused$ begin assert current_user='postgres';
   assert not exists(select 1 from public.merchants where id=${site});assert not exists(select 1 from public.merchant_enterprise_employees where id in(${quote(a.employee)},${quote(b.employee)}) or auth_user_id in(${quote(a.auth)},${quote(b.auth)},${quote(swappedAuth)}));end;$ac195_risk_unused$;
   insert into public.merchants(id,user_id,name,email) values(${site},${owner},'Synthetic195 finite risks','synthetic195-risks@example.test');
   insert into public.merchant_enterprise_roles(id,merchant_id,name,permissions) values(${quote(role)},${site},'Synthetic195 finite self',array['enterprise.view','attendance.self.view','attendance.self.clock','attendance.self.request','attendance.self.export']);
   insert into public.merchant_enterprise_employees(id,merchant_id,auth_user_id,email,display_name,role_id,status,accepted_at,version) values
    (${quote(a.employee)},${site},${quote(a.auth)},'synthetic195-break@example.test','Synthetic195 direct break',${quote(role)},'active',clock_timestamp(),1),
    (${quote(b.employee)},${site},${quote(b.auth)},'synthetic195-race@example.test','Synthetic195 settings race',${quote(role)},'active',clock_timestamp(),1);commit;select 1;`);
  await admin('settings',{timeZone:'UTC',enabled:true,webClockEnabled:true,webBreakPaid:false});
  await admin('location',{id:location,name:'Synthetic195 risk place',timeZone:'UTC',active:true});
  await admin('worker',{id:a.worker,employeeId:a.employee,workerNo:'SYNTHETIC195-BREAK',displayName:'Synthetic195 direct break',locationId:location,active:true,startsOn:'2000-01-01'});
  await clock(a,'clock_in');await clock(a,'break_start');await status(a,'disabled');
  const ready=await closure(candidate(a));assert.equal(ready.data.detail.frame.tailAction,'break_start');assert(ready.data.detail.capabilities.canClose);
  const command=closeCommand(a,ready);a.startEventId=command.startEventId;
  await reject('verified_end_before_tail',expr(candidate(a),d.owner,{...command,operationId:next(),verifiedEndAt:'2000-01-01T00:00:00.000000Z'}),'attendance_invalid_request');
  await reject('verified_end_in_future',expr(candidate(a),d.owner,{...command,operationId:next(),verifiedEndAt:'2099-01-01T00:00:00.000000Z'}),'attendance_invalid_request');
  const atomicBefore=d.fingerprint(),fault={...command,operationId:next()},constraint='ac195_owned_late_insert_fault';
  const atomic=JSON.parse(await step('exact_late_23514_atomic_rollback',`begin;${prefix}alter table public.merchant_attendance_administrative_closure_entries add constraint ${constraint}
   check(merchant_id<>${site} or operation_id<>${quote(fault.operationId)}::uuid) not valid;${callSql(expr(candidate(a),d.owner,fault),{write:true})}rollback;`));
  assert.equal(atomic.sqlstate,'23514');assert.equal(atomic.constraint,constraint);assert.equal(d.fingerprint(),atomicBefore);assert.equal(d.tableCatalog(),catalog);
  const closed=await closure(candidate(a),d.owner,command);assert.equal(closed.data.receipt.action,'close');assert.equal(closed.data.receipt.revision,1);
  const replay=await closure(candidate(a),d.owner,command,{replay:true});assert.deepEqual(replay.data.receipt,closed.data.receipt);
  await reject('same_operation_different_command',expr(candidate(a),d.owner,{...command,reason:command.reason+' changed'}),'attendance_operation_conflict');
  groups.push('direct_break_close_exact_time_bounds_replay_conflict_and_late_23514_atomicity');
  const em=await employment(a);assert(em.detail.canClose);await employment(a,employmentLifecycleCommandFromDetail(em.detail,'close',next()));
  const afterEmployment=await closure(detail(a),a.auth);assert(afterEmployment.data.detail.capabilities.canDispute);
  const dispute={action:'self_dispute',operationId:next(),startEventId:a.startEventId,expectedRevision:1,expectedClosedOperationId:command.operationId,reason:'Synthetic195 actual dispute after employment end'};
  const disputed=await closure(detail(a),a.auth,dispute);
  const respond={action:'owner_respond',operationId:next(),startEventId:a.startEventId,expectedRevision:2,disputeOperationId:dispute.operationId,reason:'Synthetic195 response preserves unknown hours'};
  await closure(detail(a,'owner'),d.owner,respond);
  groups.push('unchanged_identity_self_read_dispute_after_employment_end_and_owner_response');
  const denied=expression=>({expression,error:'attendance_access_denied'});
  const selfRecovery=expression=>({expression,receipt:disputed.data.receipt});
  await probe('new_identity_auth_swap_rollback',`update public.merchant_enterprise_employees set auth_user_id=${quote(swappedAuth)} where merchant_id=${site} and id=${quote(a.employee)};`,[
   denied(expr(detail(a),a.auth)),denied(expr(detail(a),swappedAuth)),denied(expr(detail(a),a.auth,dispute)),
   selfRecovery(expr(recover('self',dispute.operationId),a.auth,null,false)),{expression:expr(recover('self',dispute.operationId),swappedAuth,null,false),receipt:null},
  ]);
  await probe('new_worker_binding_swap_rollback',`update public.merchant_attendance_workers set employee_id=${quote(b.employee)} where merchant_id=${site} and id=${quote(a.worker)};`,[
   denied(expr(detail(a),a.auth)),denied(expr(detail(a),b.auth)),denied(expr(detail(a),a.auth,dispute)),selfRecovery(expr(recover('self',dispute.operationId),a.auth,null,false)),
  ]);
  await probe('new_owner_loss_rollback',`update public.merchants set user_id=${quote(b.auth)} where id=${site};`,[
   denied(expr(detail(a,'owner'),d.owner)),denied(expr(candidate(a),d.owner,command)),
   {expression:expr(recover('owner',command.operationId),d.owner,null,false),receipt:closed.data.receipt},
  ]);
  await reject('cross_merchant_detail',expr({...detail(a),siteId:'99990001'},a.auth),'attendance_access_denied');
  const crossReceipt=await closure({...recover('self',dispute.operationId),siteId:'99990001'},a.auth,null);assert.equal(crossReceipt.data.receipt,null);
  groups.push('auth_binding_owner_and_cross_merchant_body_denial_original_actor_minimum_receipts');
  await admin('worker',{id:b.worker,employeeId:b.employee,workerNo:'SYNTHETIC195-RACE',displayName:'Synthetic195 settings race',locationId:location,active:true,startsOn:'2000-01-01'});
  await clock(b,'clock_in');await status(b,'disabled');await status(b,'active');
  const sid=JSON.parse(await step('race_current_pause',`begin;${prefix}select to_jsonb(suspension_id)::text from public.merchant_attendance_account_epochs where merchant_id=${site} and employee_id=${quote(b.employee)};commit;`));
  const sq={siteId,mode:'detail',afterId:null,suspensionId:sid,operationId:null};
  const pause=await ok('race_restore_detail',`public.faolla_attendance_account_suspensions_v1(${json(sq)},${owner},null,true)`);assert(pause.detail.canRestore);
  const raceReady=await closure(candidate(b));assert(raceReady.data.detail.capabilities.canClose);const raceClose=closeCommand(b,raceReady);
  const restore={action:'restore',operationId:next(),suspensionId:sid,expectedGeneration:pause.detail.suspension.generation,workerId:b.worker,
   expectedWorkerVersion:pause.detail.workerVersion,expectedEmployeeVersion:pause.detail.employeeVersion,employeeId:b.employee,employeeAuthUserId:b.auth,reason:'Synthetic195 one finite competing restore'};
  stage='one_exact_settings_lock_race';assert(++steps<=64&&Date.now()<deadline);
  const racePrefix=prefix+'set local role service_role;';
  const race=await lifecycleRace({connect:()=>native.connect({lifetimeMs:25000}),query:sql=>native.query(sql),sql:scope.sql},
   racePrefix+'select '+expr(candidate(b),d.owner,raceClose)+';',
   racePrefix+`select public.faolla_attendance_account_suspensions_v1(${json(sq)},${owner},${json(restore)},true);`);
  assert(race.witnessed&&race.right.error);assert.match(String(race.right.error),/attendance_account_suspension_changed/);
  assert.equal(JSON.parse(race.left).data.receipt.operationId,raceClose.operationId);
  const final=JSON.parse(await step('finite_final_preservation',`begin;${prefix}do $ac195_risk_final$ begin
   assert ${outside}=${quote(outsideBefore)},'ac195_risk_final_originals';
   assert (select not active from public.merchant_attendance_workers where merchant_id=${site} and id=${quote(b.worker)});
   assert (select paused from public.merchant_attendance_account_epochs where merchant_id=${site} and employee_id=${quote(b.employee)});
   assert not exists(select 1 from public.merchant_attendance_account_restores where merchant_id=${site} and operation_id=${quote(restore.operationId)});
   assert (select jsonb_agg(action order by sequence) from public.merchant_attendance_events where merchant_id=${site} and worker_id=${quote(a.worker)})='["clock_in","break_start"]'::jsonb;
   assert (select jsonb_agg(action order by sequence) from public.merchant_attendance_events where merchant_id=${site} and worker_id=${quote(b.worker)})='["clock_in"]'::jsonb;
   assert public.faolla_attendance_operating_head_v1(${site},${quote(b.worker)})->>'status'='off';
  end;$ac195_risk_final$;set constraints all immediate;
  select jsonb_build_object('rawRows',(select count(*) from public.merchant_attendance_events where merchant_id=${site}),'newRows',(select sum(n) from (${names.filter(n=>n!=='faolla_schema_migrations').map(n=>`select count(*) n from public.${n} x where ${n==='merchants'?`x.id=${site}`:n==='merchant_attendance_location_results'?`exists(select 1 from public.merchant_attendance_events ev where ev.id=x.event_id and ev.merchant_id=${site})`:`x.merchant_id=${site}`}`).join(' union all ')}) row_counts)) ;commit;`));
  assert.equal(final.rawRows,3);assert(final.newRows<=64,'administrative_risk_max64_new_rows');
  groups.push('one_witnessed_settings_close_then_restore_fresh_check_rejects_loser');
  return {phase:195,groups,steps,reads,writes,rejections,newMerchant:siteId,newRows:final.newRows,rawRows:3,
   directBreakTailClosed:true,exactLateFailureSqlstate:'23514',oneSettingsLockRaceWitnessed:true,identityProbesFullyRolledBack:true,
   oldFactsUnchanged:true,oldArchivesUnchanged:true,microCommitsForRealRace:true,cleanupOwnedByParent:true,realAuth:false,production:false};
 }catch(error){throw new Error('administrative_closure_risk_stage:'+stage+':'+String(error?.stack??error).slice(0,1800)+':'+JSON.stringify(last).slice(0,3000),{cause:error});}
 finally{
  try{await connection.step('rollback;');}catch(error){if(!String(error).includes('attendance_concurrency_closed'))throw error;}finally{await connection.close();}
  assert.equal(d.exec(periodContinuationSerialization+`select ${outside};`),outsideBefore,'ac195_risk_outside_finally');assert.equal(d.definitions(),definitions);assert.equal(d.tableCatalog(),catalog);
  assert.deepEqual(periodContinuationArchiveBytes(await archive()),old155);assert.deepEqual(periodContinuationArchiveBytes(await periodArchive()),old207);
 }
}
