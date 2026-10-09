//INERT local-only acceptance. The full quota is an explicitly injected
//projection, NOT 64 MiB of physical data. One inherited bounded connection,
//normal constraints and final ROLLBACK; no new cluster or production access.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {assertLifecycleSandbox,lifecycleId as id,lifecycleJson as json} from '../merchant-attendance-lifecycle-native-support.mjs';
import {quote} from './attendance-bound-clocks-native.mjs';
import {outageNativeFingerprintSql} from './attendance-outage-native.mjs';
import {periodContinuationArchiveBytes,periodContinuationSerialization} from './attendance-period-continuation-native.mjs';

const require=createRequire(import.meta.url),nextId=n=>id(231800000+n);
export const periodContinuationCapacityLimit=67108864;
export const periodContinuationCapacityMaxArtifact=262144;
export const periodContinuationCapacityWriteTables=Object.freeze([
 'merchant_attendance_period_closures','merchant_attendance_period_versions','merchant_attendance_period_entries',
 'merchant_attendance_period_artifacts','merchant_attendance_period_artifact_metadata','merchant_attendance_period_storage',
 'merchant_attendance_leave_entries']);
export function periodContinuationCapacityRemaining(bytes,shortBy=0){
 assert(Number.isInteger(bytes)&&bytes>0&&bytes<=periodContinuationCapacityMaxArtifact,'capacity_artifact_size_bound');
 assert(shortBy===0||shortBy===1,'capacity_shortage_exact');
 return periodContinuationCapacityLimit-bytes+shortBy;
}

//Each writer can append only its exact operation rows. Existing immutable rows
//are also protected independently, even if a malformed writer reused an ID.
export function periodContinuationCapacityCallHash(names,{site,periodId,rpc,operationId,action}){
 const filters={},siteSql=quote(site),pid=quote(periodId);
 if(operationId){
  const op=quote(operationId);
  if(rpc==='faolla_attendance_leave_v1')filters.merchant_attendance_leave_entries=`not(t.merchant_id=${siteSql} and t.operation_id=${op})`;
  else{
   filters.merchant_attendance_period_closures=`not(t.merchant_id=${siteSql} and t.period_id=${pid})`;
   filters.merchant_attendance_period_entries=`not(t.merchant_id=${siteSql} and t.operation_id=${op})`;
   if(action==='send'){
    filters.merchant_attendance_period_versions=`not(t.merchant_id=${siteSql} and t.period_id=${pid} and t.operation_id=${op})`;
    filters.merchant_attendance_period_artifacts=`not(t.merchant_id=${siteSql} and t.period_id=${pid} and t.artifact_id=${op})`;
    filters.merchant_attendance_period_artifact_metadata=`not(t.merchant_id=${siteSql} and t.artifact_id=${op})`;
    filters.merchant_attendance_period_storage=`t.merchant_id<>${siteSql}`;
   }
  }
 }
 assert(names.length>0&&new Set(names).size===names.length);
 return `(select md5(jsonb_object_agg(table_name,rows_value order by table_name)::text) from (${names.map(name=>{
  assert(/^(?:merchants|faolla_schema_migrations|merchant_[a-z0-9_]+)$/.test(name)&&name.length<=63);
  return `select ${quote(name)} table_name,(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]') from public.${name} t ${filters[name]?'where '+filters[name]:''}) rows_value`;
 }).join(' union all ')}) call_facts)`;
}

export async function verifyPeriodContinuationCapacityNative(ctx){
 const {d,h,native,scope,periodId,pq,periodArchive,archive,oldArchive}=ctx;
 assert(d?.syntheticOnly===true&&h?.syntheticOnly===true,'capacity_synthetic_owned_context_required');
 assert.equal(typeof native.connect,'function');assert.equal(typeof pq,'function');assert.equal(typeof d.guard,'string');
 const owned=assertLifecycleSandbox(sql=>native.query(scope.sql(sql)));assert.deepEqual(owned,d.owned);assert.equal(owned.schema,scope.schema);
 const names=d.inventory();for(const name of periodContinuationCapacityWriteTables)assert(names.includes(name),name);
 const facts=d.fingerprint(),definitions=d.definitions(),catalog=d.tableCatalog();
 const fixed=periodContinuationArchiveBytes(await periodArchive()),old155=periodContinuationArchiveBytes(await archive());
 assert.deepEqual(old155,periodContinuationArchiveBytes(oldArchive));
 const {executePeriodClosuresV2}=require('../../src/lib/merchantAttendancePeriodClosureV2.server.ts');
 const {parsePeriodClosureV2Query,parsePeriodClosureV2Command}=require('../../src/lib/merchantAttendancePeriodClosureV2.ts');
 const {executePeriodClosures}=require('../../src/lib/merchantAttendancePeriodClosure.server.ts');
 const {parseLeaveResult}=require('../../src/lib/merchantAttendanceLeave.ts');
 const q=(mode='detail',access='owner',patch={})=>parsePeriodClosureV2Query({...pq(mode,access,periodId),cursor:null,...patch});
 assert.equal(q().siteId,d.site);assert.equal(q().workerId,h.workerId);assert.equal(q().periodId,periodId);
 const site=quote(d.site),pid=quote(periodId),prefix=periodContinuationSerialization+d.guard;
 const fullHash=outageNativeFingerprintSql(names),otherHash=outageNativeFingerprintSql(names.filter(n=>!periodContinuationCapacityWriteTables.includes(n)));
 const noStorageHash=outageNativeFingerprintSql(names.filter(n=>n!=='merchant_attendance_period_storage'));
 const frameKeys="array['revision','current_version','state','sealed','confirmed_version','unresolved_dispute','updated_at']";
 const savedRows=`jsonb_build_object(${periodContinuationCapacityWriteTables.map(name=>`${quote(name)},(select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) from public.${name} r ${name==='merchant_attendance_period_closures'?`where not(r.merchant_id=${site} and r.period_id=${pid})`:name==='merchant_attendance_period_storage'?`where r.merchant_id<>${site}`:''})`).join(',')})`;
 const oldGuard=periodContinuationCapacityWriteTables.map(name=>`assert not exists(select previous_row.value from jsonb_array_elements(current_setting('faolla.capacity231_old')::jsonb->${quote(name)}) previous_row(value)
  except select to_jsonb(current_row) from public.${name} current_row),'capacity_old_row_changed:${name}';`).join('\n')+`
  assert (select to_jsonb(c)-${frameKeys} from public.merchant_attendance_period_closures c where merchant_id=${site} and period_id=${pid})=current_setting('faolla.capacity231_frame')::jsonb,'capacity_fixed_head_frame_changed';`;
 const failures=[],connection=native.connect();let stage='connect',steps=0,serial=0,reads=0,writes=0,replays=0,recoveryMisses=0,rejections=0,roleAssertions=0;
 let lastRpc=null,shortage=null,chargedBytes=null,rolledBack=false,result;
 const step=async(label,sql)=>{stage=label;assert(++steps<=100,'capacity_max100_steps');return connection.step(scope.sql((label==='begin'?'begin;':'')+prefix+sql));};
 const snapshot=async label=>JSON.parse(await step(label,`select jsonb_build_object('usedBytes',(select used_bytes from public.merchant_attendance_period_storage where merchant_id=${site}),
  'artifacts',(select count(*) from public.merchant_attendance_period_artifacts where merchant_id=${site}),
  'metadata',(select count(*) from public.merchant_attendance_period_artifact_metadata where merchant_id=${site}));`));
 const inject=async(value,label)=>{
  assert(Number.isInteger(value)&&value>=0&&value<=periodContinuationCapacityLimit);
  await step(label,`do $capacity_inject$ declare protected_before text;other_sites jsonb;begin
   protected_before:=${noStorageHash};select coalesce(jsonb_agg(to_jsonb(s) order by s.merchant_id),'[]') into other_sites from public.merchant_attendance_period_storage s where s.merchant_id<>${site};
   perform 1 from public.merchant_attendance_settings where merchant_id=${site} for update;
   update public.merchant_attendance_period_storage set used_bytes=${value} where merchant_id=${site};assert found,'capacity_projection_required';
   assert (select coalesce(jsonb_agg(to_jsonb(s) order by s.merchant_id),'[]') from public.merchant_attendance_period_storage s where s.merchant_id<>${site})=other_sites,'capacity_injection_other_site';
   assert ${noStorageHash}=protected_before,'capacity_injection_changed_facts';${oldGuard}
   end;$capacity_inject$;`);
 };
 //The service adapter executes actual SQL on the SAME connection. It catches a
 //business rejection in a subtransaction and proves that it wrote zero rows.
 const service={rpc:async(name,args)=>{
  assert(['faolla_attendance_period_closure_v1','faolla_attendance_period_closure_v2','faolla_attendance_period_closure_source_v1','faolla_attendance_leave_v1'].includes(name),'capacity_rpc_allowlist');
  assert.equal(args.p_query.siteId,d.site);assert([d.owner,h.employeeAuthUserId].includes(args.p_auth_user_id));
  if(name!=='faolla_attendance_leave_v1'){assert.equal(args.p_query.workerId,h.workerId);assert.equal(args.p_query.periodId,periodId);}
  const command=args.p_command??null,keys=name==='faolla_attendance_period_closure_source_v1'?['p_query','p_auth_user_id']:
   name==='faolla_attendance_leave_v1'?['p_query','p_auth_user_id','p_command','p_allow_write']:['p_query','p_auth_user_id','p_command','p_artifact','p_allow_write'];
  assert.deepEqual(Object.keys(args).sort(),[...keys].sort());assert.equal(scope.sql(json(args)),json(args),'capacity_argument_literal_schema_rewrite');
  if(shortage!==null&&command?.action==='send'){
   const bytes=Number(await step('measure_exact_candidate',`select octet_length(convert_to(${json(args.p_artifact)}::text,'UTF8'));`));
   const target=periodContinuationCapacityRemaining(bytes,shortage);chargedBytes=bytes;shortage=null;await inject(target,'inject_exact_remaining');
  }
  const encoded=key=>key==='p_auth_user_id'?quote(args[key]):key==='p_allow_write'?String(args[key]):json(args[key]);
  const expression=`public.${name}(${keys.map(encoded).join(',')})`,allowed=periodContinuationCapacityCallHash(names,{site:d.site,periodId,rpc:name,operationId:command?.operationId,action:command?.action});
  const output=JSON.parse(await step('rpc_'+(++serial)+'_'+name+'_'+(command?.action??args.p_query.mode??'source'),`do $capacity_rpc$ declare b text;p text;v jsonb;e text;sql_state text;stack_context text;begin
   b:=${fullHash};p:=${allowed};begin
    set local role service_role;assert current_user='service_role','capacity_actual_service_role_required';
    v:=${expression};set constraints all immediate;set constraints all deferred;
   exception when others then get stacked diagnostics e=message_text,sql_state=returned_sqlstate,stack_context=pg_exception_context;end;
   reset role;
   if e is not null or ${command===null?'true':'false'} or coalesce((v->>'replayed')::boolean,false) then assert ${fullHash}=b,'capacity_read_replay_rejection_changed_facts';
   else assert ${allowed}=p,'capacity_write_outside_exact_operation';end if;${oldGuard}
   perform set_config('faolla.capacity231_result',jsonb_build_object('value',v,'error',e,'sqlstate',sql_state,'context',stack_context)::text,true);
   end;$capacity_rpc$;select current_setting('faolla.capacity231_result')::jsonb;`));
  roleAssertions++;lastRpc={name,...output};
  if(output.error){if(output.error==='attendance_operation_not_found')recoveryMisses++;else rejections++;return {data:null,error:{message:output.error}};}
  if(command&&output.value?.replayed)replays++;else if(command)writes++;else reads++;
  return {data:output.value,error:null};
 }};
 const actor=access=>access==='owner'?d.owner:h.employeeAuthUserId;
 const run=(query,command=null,allow=true)=>executePeriodClosuresV2({query,command,authUserId:actor(query.access),moduleEnabled:allow},service);
 const legacy=(query,command=null,allow=true)=>{const old={...query};delete old.cursor;return executePeriodClosures({query:old,command,authUserId:actor(query.access),moduleEnabled:allow},service);};
 const command=(action,head,fingerprint=null)=>parsePeriodClosureV2Command(q('detail',action==='confirm'?'self':'owner'),{
  action,operationId:nextId(++serial),periodId,expectedRevision:head.period.revision,expectedVersion:head.period.currentVersion,
  expectedFingerprint:['send','confirm','seal'].includes(action)?fingerprint??head.artifact.sourceFingerprint:null,
  reason:'Synthetic231 quota boundary request, final rollback; no deletion or increased quota'});
 try{
  const profile=JSON.parse(await step('begin',`set local lock_timeout='3s';set local statement_timeout='10s';
   do $capacity_begin$ declare rows_value jsonb;begin
    assert exists(select 1 from public.merchant_attendance_period_closures where merchant_id=${site} and period_id=${pid} and worker_id=${quote(h.workerId)} and sealed),'capacity_sealed_context_required';
    assert not exists(select 1 from public.merchant_attendance_period_entries where operation_id between ${quote(nextId(0))} and ${quote(nextId(9999))})
     and not exists(select 1 from public.merchant_attendance_leave_entries where operation_id between ${quote(nextId(0))} and ${quote(nextId(9999))}),'capacity_ids_must_be_unused';
    rows_value:=${savedRows};assert octet_length(rows_value::text)<=8388608,'capacity_old_rows_bounded';
    perform set_config('faolla.capacity231_old',rows_value::text,true);perform set_config('faolla.capacity231_other',${otherHash},true);
    perform set_config('faolla.capacity231_frame',(select (to_jsonb(c)-${frameKeys})::text from public.merchant_attendance_period_closures c where merchant_id=${site} and period_id=${pid}),true);
   end;$capacity_begin$;
   select jsonb_build_object('leaveIds',(select coalesce(jsonb_agg(r.request_id),'[]') from public.merchant_attendance_leave_requests r
    where r.merchant_id=${site} and r.worker_id=${quote(h.workerId)} and r.employee_id=${quote(h.employeeId)} and r.actor_auth_user_id=${quote(h.employeeAuthUserId)}
     and r.start_at<c.end_at and r.end_at>c.start_at and exists(select 1 from public.merchant_attendance_leave_entries e where e.merchant_id=r.merchant_id and e.request_id=r.request_id and e.revision=2 and e.action='approve')
     and not exists(select 1 from public.merchant_attendance_leave_entries e where e.merchant_id=r.merchant_id and e.request_id=r.request_id and e.revision=3)))
   from public.merchant_attendance_period_closures c where c.merchant_id=${site} and c.period_id=${pid};`));
  assert.equal(profile.leaveIds.length,1,'capacity_single_real_approved_leave_required');
  const firstBudget=await snapshot('budget_initial');assert(firstBudget.usedBytes>0&&firstBudget.usedBytes<periodContinuationCapacityLimit);
  let head=await run(q());assert.equal(head.kind,'detail');assert.equal(head.period.sealed,true);assert.equal(head.sourceChanged,false);
  assert(head.period.revision<80&&head.period.currentVersion<15,'capacity_old_v1_safe_head_required');
  assert.deepEqual(periodContinuationArchiveBytes(lastRpc.value),fixed);const originalVersion=head.artifactVersion,originalFingerprint=head.artifact.sourceFingerprint;
  await inject(periodContinuationCapacityLimit,'inject_full_projection');
  head=await run(q(),command('reopen',head),false);assert.equal(head.period.state,'open');
  const preview=await run(q('preview'));assert.deepEqual(preview.preview.blockers,[]);
  const reuse=command('send',head,preview.preview.artifact.sourceFingerprint);head=await legacy(q(),reuse);
  const reuseReceipt=head.operation;assert.deepEqual(periodContinuationArchiveBytes(lastRpc.value),fixed);
  assert.deepEqual(await snapshot('budget_full_reuse'),{...firstBudget,usedBytes:periodContinuationCapacityLimit});
  const leaveQuery={siteId:d.site,access:'owner',requestId:profile.leaveIds[0],operationId:null,beforeAt:null,beforeId:null};
  const cancellation={operationId:nextId(++serial),action:'cancel',requestId:profile.leaveIds[0],expectedRevision:2,reason:'Synthetic231 real administrative cancellation changes source for quota acceptance; final rollback'};
  const leaveRaw=await service.rpc('faolla_attendance_leave_v1',{p_query:leaveQuery,p_auth_user_id:d.owner,p_command:cancellation,p_allow_write:true});
  assert.equal(leaveRaw.error,null);const leave=parseLeaveResult(leaveRaw.data,leaveQuery,cancellation,d.owner);assert.equal(leave.detail.status,'cancelled');
  const changed=await run(q('preview'));assert.notEqual(changed.preview.artifact.sourceFingerprint,originalFingerprint);
  assert(!changed.preview.blockers.includes('period_in_progress')&&!changed.preview.blockers.includes('unresolved_outage'));
  await assert.rejects(legacy(q(),command('send',head,changed.preview.artifact.sourceFingerprint)),e=>e.code==='attendance_period_limit');
  await assert.rejects(run(q(),command('send',head,changed.preview.artifact.sourceFingerprint)),e=>e.code==='attendance_period_storage_limit');
  assert.deepEqual(await snapshot('budget_after_full_rejections'),{...firstBudget,usedBytes:periodContinuationCapacityLimit});
  shortage=1;await assert.rejects(run(q(),command('send',head,changed.preview.artifact.sourceFingerprint)),e=>e.code==='attendance_period_storage_limit');
  assert.equal(shortage,null);assert(chargedBytes>0);
  shortage=0;const accepted=command('send',head,changed.preview.artifact.sourceFingerprint);head=await run(q(),accepted);
  assert.equal(shortage,null);assert.equal(head.operation.operationId,accepted.operationId);const acceptedReceipt=head.operation,newBytes=periodContinuationArchiveBytes(lastRpc.value);
  assert.equal(newBytes.artifactBytes,chargedBytes);assert(newBytes.artifactBytes<=periodContinuationCapacityMaxArtifact);
  const fullBudget=await snapshot('budget_exact_boundary');assert.deepEqual(fullBudget,{usedBytes:periodContinuationCapacityLimit,artifacts:firstBudget.artifacts+1,metadata:firstBudget.metadata+1});
  const recovered=await run(q('recover','owner',{operationId:accepted.operationId}),null,false);assert.deepEqual(recovered.operation,acceptedReceipt);
  const replay=await run(q(),accepted,false);assert.equal(replay.replayed,true);assert.deepEqual(replay.operation,acceptedReceipt);assert.deepEqual(periodContinuationArchiveBytes(lastRpc.value),newBytes);
  const oldRecovered=await legacy(q('recover','owner',{operationId:reuse.operationId}),null,false);assert.deepEqual(oldRecovered.operation,reuseReceipt);
  await run(q('export','owner',{version:originalVersion}),null,false);assert.deepEqual(periodContinuationArchiveBytes(lastRpc.value),fixed);
  assert.deepEqual(await snapshot('budget_after_saved_reads'),fullBudget);
  await step('final_guards',`do $capacity_final$ begin ${oldGuard}
   assert ${otherHash}=current_setting('faolla.capacity231_other'),'capacity_other_fact_guard';
   set constraints all immediate;end;$capacity_final$;`);
  await step('rollback','rollback;');rolledBack=true;
  result={phase:231,transactionSteps:steps,reads,writes,replays,recoveryMisses,rejections,roleAssertions,
   injectedQuotaProjection:true,physicallyFilledBudget:false,budgetLimitBytes:periodContinuationCapacityLimit,
   maxNewArtifactBytes:periodContinuationCapacityMaxArtifact,actualNewArtifacts:1,newArtifactBytes:chargedBytes,
   actualV1QuotaRejected:'attendance_period_limit',actualV2QuotaRejected:'attendance_period_storage_limit',oneByteOverflowRejected:true,
   exactBoundaryCharged:true,sameSourceReuseUncharged:true,pausedReopenAtFull:true,savedRecoveryReplayExportUncharged:true,
   listAndLifetimeCardinalityCoverage:false,originalImmutableRowsPreserved:true,old155ArchivePreserved:true,old207ArchivePreserved:true,
   rollbackRestored:true,actualPeriodServiceSql:true,actualLeaveRpcAndStrictProjection:true,syntheticAuth:true,realAuth:false,browser:false};
 }catch(error){failures.push(new Error('period_capacity:'+stage+':'+String(error?.message??error),{cause:error}));}
 finally{
  try{await connection.close();}catch(error){failures.push(error);}
  for(const[label,read,want]of[['facts',()=>d.fingerprint(),facts],['definitions',()=>d.definitions(),definitions],['catalog',()=>d.tableCatalog(),catalog],
   ['old155',async()=>periodContinuationArchiveBytes(await archive()),old155],['old207',async()=>periodContinuationArchiveBytes(await periodArchive()),fixed]]){
   try{assert.deepEqual(await read(),want,'capacity_rollback_'+label);}catch(error){failures.push(error);}
  }
 }
 if(failures.length)throw new AggregateError(failures,'period_capacity_native_failed:'+failures.slice(0,6).map(e=>String(e?.stack??e)+'\n'+String(e?.cause?.stack??'')).join('\n').slice(0,9000)
  +'\nlastRpcError:'+JSON.stringify(lastRpc?.error?{name:lastRpc.name,error:lastRpc.error,sqlstate:lastRpc.sqlstate,context:lastRpc.context?.slice(0,2000)}:null),{cause:failures[0]});
 assert(rolledBack);native.pass('231 quota: disclosed projection injection, real v1/v2 zero-write rejection, exact new artifact charge and no-charge recovery; complete rollback');return result;
}
