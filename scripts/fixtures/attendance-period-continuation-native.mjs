//231 INERT caller-owned acceptance. Real service/RPC steps and a separately
//declared synthetic capacity prefix share ONE connection and final ROLLBACK.
//The prefix is not employee consent or actual historical business requests.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {assertLifecycleSandbox,lifecycleId as id,lifecycleJson as json} from '../merchant-attendance-lifecycle-native-support.mjs';
import {quote} from './attendance-bound-clocks-native.mjs';
import {outageNativeFingerprintSql} from './attendance-outage-native.mjs';

const require=createRequire(import.meta.url),actualId=n=>id(231600000+n),prefixId=n=>id(231700000+n);
export const periodContinuationNativeWriteTables=Object.freeze([
 'merchant_attendance_period_closures','merchant_attendance_period_versions','merchant_attendance_period_entries']);
export const periodContinuationSerialization="reset role;set local time zone 'UTC';set local datestyle='ISO, YMD';set local extra_float_digits=3;";
export function periodContinuationArchiveBytes(value){
 assert.equal(typeof value?.artifactText,'string');assert.equal(Buffer.byteLength(value.artifactText,'utf8'),value.artifactBytes);
 assert.equal(createHash('sha256').update(value.artifactText,'utf8').digest('hex'),value.artifactSha256);
 assert.deepEqual(JSON.parse(value.artifactText),value.artifact);
 return {artifactText:value.artifactText,artifactBytes:value.artifactBytes,artifactSha256:value.artifactSha256};
}
export function createPeriodContinuationPrefix(head,{periodId,ownerId,employeeAuthUserId,fingerprint}){
 assert.equal(head.state,'sealed');assert.equal(head.sealed,true);assert.equal(head.unresolvedDispute,false);
 assert(Number.isInteger(head.revision)&&head.revision>=1&&head.revision<99);
 assert(Number.isInteger(head.currentVersion)&&head.currentVersion>=1&&head.currentVersion<=20);
 assert.equal(head.confirmedVersion,head.currentVersion);assert.match(fingerprint,/^[a-f0-9]{64}$/);
 for(const value of [periodId,ownerId,employeeAuthUserId])assert.match(value,/^[a-f0-9-]{36}$/);
 assert(head.revision+(20-head.currentVersion)*4<=99,'continuation_prefix_insufficient_revision_room');
 let revision=head.revision,version=head.currentVersion;const rows=[];
 const append=action=>{
  const command={action,operationId:prefixId(rows.length+1),periodId,expectedRevision:revision,expectedVersion:version,
   expectedFingerprint:['send','confirm','seal'].includes(action)?fingerprint:null,
   reason:'Synthetic231 capacity prefix only; not actual historical employee confirmation'};
  revision++;if(action==='send')version++;
  rows.push({command,actorId:action==='confirm'?employeeAuthUserId:ownerId,revision,version});
 };
 while(version<20){append('reopen');append('send');append('confirm');append('seal');}
 while(revision<99)append('respond');
 assert(rows.length<=98);assert.equal(revision,99);assert.equal(version,20);
 return {rows,syntheticEntries:rows.length,syntheticVersionReferences:20-head.currentVersion,targetRevision:99,targetVersion:20};
}

export async function verifyPeriodContinuationNative(ctx){
 const {d,h,native,scope,periodId,pq,periodArchive,archive,oldArchive}=ctx;
 assert(d?.syntheticOnly===true&&h?.syntheticOnly===true,'continuation_synthetic_owned_context_required');
 assert.equal(typeof native.connect,'function');assert.equal(typeof pq,'function');assert.equal(typeof d.guard,'string');
 const owned=assertLifecycleSandbox(sql=>native.query(scope.sql(sql)));assert.deepEqual(owned,d.owned);assert.equal(owned.schema,scope.schema);
 const names=d.inventory();for(const name of [...periodContinuationNativeWriteTables,'merchant_attendance_period_storage','merchant_attendance_period_artifact_metadata'])assert(names.includes(name),name);
 const baseline=d.fingerprint(),definitions=d.definitions(),catalog=d.tableCatalog();
 const fixed=periodContinuationArchiveBytes(await periodArchive()),old155=periodContinuationArchiveBytes(await archive());
 assert.deepEqual(old155,periodContinuationArchiveBytes(oldArchive));
 const {executePeriodClosuresV2}=require('../../src/lib/merchantAttendancePeriodClosureV2.server.ts');
 const {parsePeriodClosureV2Query,parsePeriodClosureV2Command}=require('../../src/lib/merchantAttendancePeriodClosureV2.ts');
 const {executePeriodClosures}=require('../../src/lib/merchantAttendancePeriodClosure.server.ts');
 const {executeRetention}=require('../../src/lib/merchantAttendanceRetention.server.ts');
 const q=(mode='detail',access='owner',patch={})=>parsePeriodClosureV2Query({...pq(mode,access,periodId),cursor:null,...patch});
 assert.equal(q().siteId,d.site);assert.equal(q().workerId,h.workerId);assert.equal(q().periodId,periodId);
 const site=quote(d.site),pid=quote(periodId),prefix=periodContinuationSerialization+d.guard;
 const fullHash=outageNativeFingerprintSql(names),protectedHash=outageNativeFingerprintSql(names.filter(n=>!periodContinuationNativeWriteTables.includes(n)));
 const immutableHead="array['revision','current_version','state','sealed','confirmed_version','unresolved_dispute','updated_at']";
 const snapshot=()=>`jsonb_build_object(${periodContinuationNativeWriteTables.map(name=>`${quote(name)},(select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) from public.${name} r ${name==='merchant_attendance_period_closures'?`where not(r.merchant_id=${site} and r.period_id=${pid})`:''})`).join(',')})`;
 const oldGuard=()=>periodContinuationNativeWriteTables.map(name=>`assert not exists(select old_rows.value from jsonb_array_elements(current_setting('faolla.continuation231_old')::jsonb->${quote(name)}) old_rows(value)
  except select to_jsonb(current_row) from public.${name} current_row),'continuation_old_row_changed:${name}';`).join('\n')+`
  assert (select to_jsonb(existing_head_record)-${immutableHead} from public.merchant_attendance_period_closures existing_head_record
    where existing_head_record.merchant_id=${site} and existing_head_record.period_id=${pid})=current_setting('faolla.continuation231_frame')::jsonb,'continuation_fixed_head_frame_changed';`;
 let stage='connect',steps=0,serial=0,roleAssertions=0,serviceCalls=0,sourceProjections=0,reads=0,writes=0,replays=0,recoveryMisses=0,sqlRejections=0,rolledBack=false,result,lastRpc=null;
 const failures=[],connection=native.connect();
 const step=async(label,sql)=>{stage=label;assert(++steps<=100,'continuation_max100_steps');return connection.step(scope.sql((label==='begin'?'begin;':'')+prefix+sql));};
 const actor=access=>access==='owner'?d.owner:h.employeeAuthUserId;
 const budget=async label=>JSON.parse(await step(label,`select jsonb_build_object('usedBytes',(select used_bytes from public.merchant_attendance_period_storage where merchant_id=${site}),
  'artifacts',(select count(*) from public.merchant_attendance_period_artifacts where merchant_id=${site}),
  'artifactMetadata',(select count(*) from public.merchant_attendance_period_artifact_metadata where merchant_id=${site}));`));
 //This adapter is not mocked: every RPC goes through the exact live connection.
 //Expected RPC errors return to the real service without aborting its outer tx.
 const service={rpc:async(name,args)=>{
  assert(['faolla_attendance_period_closure_v2','faolla_attendance_period_closure_v1','faolla_attendance_period_closure_source_v1','faolla_attendance_retention_v1'].includes(name),'continuation_rpc_allowlist');
  assert.equal(args.p_query.siteId,d.site);assert([d.owner,h.employeeAuthUserId].includes(args.p_auth_user_id));
  if(name!=='faolla_attendance_retention_v1'){assert.equal(args.p_query.workerId,h.workerId);assert.equal(args.p_query.periodId,periodId);}
  const command=args.p_command??null,expectedKeys=name==='faolla_attendance_period_closure_source_v1'?['p_query','p_auth_user_id']:
   name==='faolla_attendance_retention_v1'?['p_query','p_auth_user_id','p_command','p_allow_write']:['p_query','p_auth_user_id','p_command','p_artifact','p_allow_write'];
  assert.deepEqual(Object.keys(args).sort(),[...expectedKeys].sort());
  const encode=k=>k==='p_auth_user_id'?quote(args[k]):k==='p_allow_write'?String(args[k]):json(args[k]);
  assert.equal(scope.sql(json(args)),json(args),'continuation_argument_literal_schema_rewrite');
  const expression=`public.${name}(${expectedKeys.map(encode).join(',')})`,label='rpc_'+(++serial)+'_'+name+'_'+(command?.action??args.p_query.mode??'source');
  const output=JSON.parse(await step(label,`do $continuation_rpc$ declare b text;p text;v jsonb;e text;sqlstate_value text;context_value text;begin
   b:=${fullHash};p:=${protectedHash};begin
    set local role service_role;assert current_user='service_role','continuation_actual_service_role_required';v:=${expression};set constraints all immediate;set constraints all deferred;
   exception when others then get stacked diagnostics e=message_text,sqlstate_value=returned_sqlstate,context_value=pg_exception_context;end;
   reset role;
   if e is not null or ${command===null?'true':'false'} or coalesce((v->>'replayed')::boolean,false) then assert ${fullHash}=b,'continuation_read_replay_rejection_changed_facts';
   else assert ${protectedHash}=p,'continuation_write_changed_other_facts';end if;
   ${oldGuard()}
   perform set_config('faolla.continuation231_result',jsonb_build_object('value',v,'error',e,'sqlstate',sqlstate_value,'context',context_value)::text,true);
  end;$continuation_rpc$;select current_setting('faolla.continuation231_result')::jsonb;`));
  roleAssertions++;lastRpc={name,query:args.p_query,command,...output};
  if(output.error){if(output.error==='attendance_operation_not_found')recoveryMisses++;else sqlRejections++;return {data:null,error:{message:output.error}};}
  if(name==='faolla_attendance_period_closure_source_v1'||name==='faolla_attendance_period_closure_v2'&&args.p_query.mode==='preview')sourceProjections++;
  if(command&&output.value?.replayed)replays++;else if(command)writes++;else reads++;
  return {data:output.value,error:null};
 }};
 const run=async(query,command=null,allow=true)=>{serviceCalls++;return executePeriodClosuresV2({query,command,authUserId:actor(query.access),moduleEnabled:allow},service);};
 const command=(action,head,fingerprint=null)=>parsePeriodClosureV2Command(q('detail',action==='confirm'||action==='dispute'?'self':'owner'),{
  action,operationId:actualId(++serial),periodId,expectedRevision:head.period.revision,expectedVersion:head.period.currentVersion,
  expectedFingerprint:['send','confirm','seal'].includes(action)?fingerprint??head.artifact.sourceFingerprint:null,
  reason:'Synthetic231 explicit real continuation request; fixed old archive remains unchanged'});
 try{
  const profile=JSON.parse(await step('begin',`set local lock_timeout='3s';set local statement_timeout='10s';
   do $continuation_begin$ declare old_rows jsonb;begin
    assert exists(select 1 from public.merchant_attendance_period_closures where merchant_id=${site} and period_id=${pid} and worker_id=${quote(h.workerId)} and sealed),'continuation_sealed_context_required';
    assert not exists(select 1 from public.merchant_attendance_period_entries where operation_id between ${quote(actualId(0))} and ${quote(actualId(9999))}
      or operation_id between ${quote(prefixId(0))} and ${quote(prefixId(9999))}),'continuation_ids_must_be_unused';
    old_rows:=${snapshot()};assert octet_length(old_rows::text)<=4194304,'continuation_old_rows_bounded';
    perform set_config('faolla.continuation231_old',old_rows::text,true);
    perform set_config('faolla.continuation231_frame',(select (to_jsonb(c)-${immutableHead})::text from public.merchant_attendance_period_closures c where merchant_id=${site} and period_id=${pid}),true);
   end;$continuation_begin$;
   select jsonb_build_object('artifactId',a.artifact_id,'originalCommand',e.command,'originalActor',e.actor_auth_user_id,'initialRevision',c.revision,'initialVersion',c.current_version)
   from public.merchant_attendance_period_closures c join public.merchant_attendance_period_versions v on v.merchant_id=c.merchant_id and v.period_id=c.period_id and v.version=c.current_version
   join public.merchant_attendance_period_artifacts a on a.merchant_id=v.merchant_id and a.artifact_id=v.artifact_id
   join public.merchant_attendance_period_entries e on e.merchant_id=a.merchant_id and e.operation_id=a.artifact_id
   where c.merchant_id=${site} and c.period_id=${pid};`));
  assert.equal(profile.originalActor,d.owner);assert.equal(profile.originalCommand.action,'send');
  const firstBudget=await budget('budget_initial');assert(Number.isInteger(firstBudget.usedBytes)&&firstBudget.usedBytes>0&&firstBudget.usedBytes<=67108864);
  let head=await run(q());assert.equal(head.kind,'detail');assert.equal(head.period.sealed,true);assert.equal(head.sourceChanged,false);
  assert.deepEqual(periodContinuationArchiveBytes(lastRpc.value),fixed);
  const originalQuery=q('recover','owner',{operationId:profile.originalCommand.operationId});
  const originalReceipt=await run(originalQuery,null,false),originalBytes=periodContinuationArchiveBytes(lastRpc.value);
  assert.deepEqual(originalReceipt.operation.command,profile.originalCommand);
  const retentionQuery={siteId:d.site,mode:'record',category:'period_artifact',recordId:profile.artifactId};
  const retainedBefore=await executeRetention({query:retentionQuery,authUserId:d.owner,allowWrite:false},service);assert.equal(retainedBefore.data.kind,'record');

  head=await run(q(),command('reopen',head));assert.equal(head.period.state,'open');
  let preview=await run(q('preview'));assert.equal(preview.kind,'preview');assert.deepEqual(preview.preview.blockers,[]);
  const firstSend=command('send',head,preview.preview.artifact.sourceFingerprint);
  head=await run(q(),firstSend);const firstReceipt=head.operation;
  assert.deepEqual(periodContinuationArchiveBytes(lastRpc.value),fixed);assert.equal(head.period.currentVersion,profile.initialVersion+1);
  head=await run(q('detail','self'),command('confirm',head));head=await run(q(),command('seal',head));assert.equal(head.period.sealed,true);
  assert.deepEqual(await budget('budget_after_real_cycle'),firstBudget,'continuation_same_source_reuse_charged_budget');

  const synthetic=createPeriodContinuationPrefix(head.period,{periodId,ownerId:d.owner,employeeAuthUserId:h.employeeAuthUserId,fingerprint:head.artifact.sourceFingerprint});
  //Explicit fixture-only INSERTs. All normal constraints/triggers stay enabled;
  //no original entry, version or artifact is rewritten and no new body is made.
  const seed=JSON.parse(await step('synthetic_capacity_prefix',`do $continuation_prefix$ declare c public.merchant_attendance_period_closures%rowtype;row_value jsonb;cmd jsonb;
   version_artifact uuid;new_at timestamptz;new_version integer;before_hash text;begin
   before_hash:=${protectedHash};perform set_config('faolla.continuation231_old',${snapshot()}::text,true);
   select * into c from public.merchant_attendance_period_closures where merchant_id=${site} and period_id=${pid} for update;
   select artifact_id into version_artifact from public.merchant_attendance_period_versions where merchant_id=${site} and period_id=${pid} and version=c.current_version;
   for row_value in select value from jsonb_array_elements(${json(synthetic.rows)}) loop
    cmd:=row_value->'command';assert cmd->'expectedRevision'=to_jsonb(c.revision) and cmd->'expectedVersion'=to_jsonb(c.current_version),'continuation_prefix_cas';
    assert public.faolla_attendance_period_closure_command_v2(cmd),'continuation_prefix_command';new_at:=clock_timestamp();assert new_at>=c.updated_at,'continuation_prefix_time';
    new_version:=(row_value->>'version')::integer;
    if cmd->>'action'='send' then
     assert c.state='open' and not c.sealed and new_version=c.current_version+1,'continuation_prefix_send_state';
     insert into public.merchant_attendance_period_versions(merchant_id,period_id,version,artifact_id,operation_id,recorded_at)
      values(${site},${pid},new_version,version_artifact,(cmd->>'operationId')::uuid,new_at);
     c.current_version:=new_version;c.confirmed_version:=null;c.state:='review';
    elsif cmd->>'action'='confirm' then assert c.state='review' and row_value->>'actorId'=${quote(h.employeeAuthUserId)},'continuation_prefix_confirm_state';c.confirmed_version:=c.current_version;c.state:='confirmed';
    elsif cmd->>'action'='seal' then assert c.state='confirmed' and c.confirmed_version=c.current_version,'continuation_prefix_seal_state';c.sealed:=true;c.state:='sealed';
    elsif cmd->>'action'='reopen' then assert c.sealed,'continuation_prefix_reopen_state';c.sealed:=false;c.state:='open';c.confirmed_version:=null;
    else assert cmd->>'action'='respond' and c.sealed,'continuation_prefix_filler_state';end if;
    insert into public.merchant_attendance_period_entries(merchant_id,period_id,operation_id,revision,version,actor_auth_user_id,action,command,recorded_at)
     values(${site},${pid},(cmd->>'operationId')::uuid,(row_value->>'revision')::integer,new_version,(row_value->>'actorId')::uuid,cmd->>'action',cmd,new_at);
    c.revision:=(row_value->>'revision')::integer;c.updated_at:=new_at;
   end loop;
   assert c.revision=99 and c.current_version=20 and c.sealed,'continuation_prefix_target';
   update public.merchant_attendance_period_closures set revision=c.revision,current_version=c.current_version,state=c.state,sealed=c.sealed,
    confirmed_version=c.confirmed_version,unresolved_dispute=c.unresolved_dispute,updated_at=c.updated_at where merchant_id=${site} and period_id=${pid};
   set constraints all immediate;set constraints all deferred;perform public.faolla_attendance_period_summary_v2(c);
   assert ${protectedHash}=before_hash,'continuation_prefix_other_facts_changed';${oldGuard()}
   perform set_config('faolla.continuation231_old',${snapshot()}::text,true);
   end;$continuation_prefix$;select jsonb_build_object('entries',(select count(*) from public.merchant_attendance_period_entries where merchant_id=${site} and period_id=${pid}),
    'versions',(select count(*) from public.merchant_attendance_period_versions where merchant_id=${site} and period_id=${pid}));`));
  assert.equal(seed.entries,99);assert.equal(seed.versions,20);
  head=await run(q());assert.equal(head.period.revision,99);assert.equal(head.period.currentVersion,20);
  head=await run(q(),command('reopen',head));assert.equal(head.period.revision,100);
  preview=await run(q('preview'));assert.deepEqual(preview.preview.blockers,[]);
  const crossingSend=command('send',head,preview.preview.artifact.sourceFingerprint);head=await run(q(),crossingSend);
  assert.equal(head.period.revision,101);assert.equal(head.period.currentVersion,21);assert.deepEqual(periodContinuationArchiveBytes(lastRpc.value),fixed);
  let cursor=null;const history=[],historyPageSizes=[];
  do{const page=await run(q('history','owner',{cursor}),null,false);assert.equal(page.kind,'history');historyPageSizes.push(page.items.length);history.push(...page.items);cursor=page.nextCursor;assert(historyPageSizes.length<=3);}while(cursor);
  assert.deepEqual(historyPageSizes,[50,50,1]);assert.deepEqual(history.map(x=>x.revision),Array.from({length:101},(_,i)=>101-i));assert.equal(new Set(history.map(x=>x.operationId)).size,101);
  const versionItems=[],versionPageSizes=[];cursor=null;
  do{const page=await run(q('versions','owner',{cursor}),null,false);assert.equal(page.kind,'versions');versionPageSizes.push(page.items.length);versionItems.push(...page.items);cursor=page.nextCursor;assert(versionPageSizes.length<=2);}while(cursor);
  assert.deepEqual(versionPageSizes,[20,1]);assert.deepEqual(versionItems.map(x=>x.version),Array.from({length:21},(_,i)=>21-i));
  assert(versionItems.every(x=>x.artifactId===profile.artifactId),'continuation_versions_must_reuse_original_artifact');
  const legacyQuery={...originalQuery};delete legacyQuery.cursor;
  await assert.rejects(executePeriodClosures({query:legacyQuery,authUserId:d.owner,moduleEnabled:false},service),e=>e.code==='attendance_period_protocol_required');
  const oldRecovered=await run(originalQuery,null,false);assert.deepEqual(oldRecovered.operation,originalReceipt.operation);assert.deepEqual(periodContinuationArchiveBytes(lastRpc.value),originalBytes);
  const firstRecovered=await run(q('recover','owner',{operationId:firstSend.operationId}),null,false);assert.deepEqual(firstRecovered.operation,firstReceipt);
  const replay=await run(q(),crossingSend,false);assert.equal(replay.replayed,true);assert.deepEqual(replay.operation.command,crossingSend);
  await assert.rejects(run(q(),{...crossingSend,reason:'Changed same operation body'},false),e=>e.code==='attendance_operation_conflict');
  const retainedAfter=await executeRetention({query:retentionQuery,authUserId:d.owner,allowWrite:false},service);
  assert.equal(retainedAfter.data.kind,'record');assert.equal(retainedAfter.data.item.sourceFingerprint,retainedBefore.data.item.sourceFingerprint);
  assert.deepEqual(retainedAfter.data.item.source,retainedBefore.data.item.source);
  assert.deepEqual(await budget('budget_after_capacity'),firstBudget,'continuation_capacity_or_replay_charged_budget');
  head=await run(q('detail','self'),command('confirm',head));head=await run(q(),command('seal',head));assert.equal(head.period.sealed,true);assert.equal(head.period.revision,103);
  const current=await run(q());assert.equal(current.sourceChanged,false);assert.equal(current.period.currentVersion,21);
  await run(q('export','owner',{version:originalReceipt.artifactVersion}),null,false);assert.deepEqual(periodContinuationArchiveBytes(lastRpc.value),originalBytes);
  await step('final_old_rows',`do $continuation_final$ begin ${oldGuard()} set constraints all immediate;end;$continuation_final$;`);
  await step('rollback','rollback;');rolledBack=true;
  result={phase:231,transactionSteps:steps,reads,writes,replays,recoveryMisses,sqlRejections,roleAssertions,serviceCalls,sourceProjections,
   actualReopenSendConfirmSealCycles:2,historyPageSizes,versionPageSizes,actualRevisionCrossed:101,actualVersionCrossed:21,
   syntheticCapacityPrefix:{entries:synthetic.syntheticEntries,versionReferences:synthetic.syntheticVersionReferences,actualHistoricalRequests:false},
   sameSourceBudgetUnchanged:true,budgetBytes:firstBudget.usedBytes,budgetLimitBytes:67108864,oldV1RequiresV2:true,oldOperationRecovered:true,
   sameOperationChangedBodyRejected:true,retentionCreationPointStable:true,originalImmutableRowsPreserved:true,fixedHeadFramePreserved:true,
   old155ArchivePreserved:true,old207ArchivePreserved:true,rollbackRestored:true,actualServiceSql:true,syntheticAuth:true,realAuth:false,browser:false};
 }catch(error){failures.push(new Error('period_continuation:'+stage+':'+String(error?.message??error),{cause:error}));}
 finally{
  try{await connection.close();}catch(error){failures.push(error);}
  for(const [label,read,want]of [['facts',()=>d.fingerprint(),baseline],['definitions',()=>d.definitions(),definitions],['catalog',()=>d.tableCatalog(),catalog],
   ['old155',async()=>periodContinuationArchiveBytes(await archive()),old155],['old207',async()=>periodContinuationArchiveBytes(await periodArchive()),fixed]]){
   try{assert.deepEqual(await read(),want,'continuation_rollback_'+label);}catch(error){failures.push(error);}
  }
 }
 if(failures.length){const diagnostics=failures.slice(0,6).map(e=>String(e?.stack??e)+'\n'+String(e?.cause?.stack??'')).join('\n').slice(0,10000);
  const lastError=lastRpc?.error?{name:lastRpc.name,error:lastRpc.error,sqlstate:lastRpc.sqlstate,context:lastRpc.context?.slice(0,3000)}:null;
  throw new AggregateError(failures,'period_continuation_native_failed:'+diagnostics+'\nlastRpcError:'+JSON.stringify(lastError),{cause:failures[0]});}
 assert(rolledBack);native.pass('231 real service continuation, declared synthetic capacity prefix, bounded pages, immutable receipts/archives/budget, complete rollback');return result;
}
