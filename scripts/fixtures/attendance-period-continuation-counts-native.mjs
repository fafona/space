//231 INERT synthetic capacity prefix + actual V2 service writes. No new worker,
//fake employee consent, successful mocked RPC, larger budget or timeout.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {assertLifecycleSandbox,lifecycleId as id,lifecycleJson as json} from '../merchant-attendance-lifecycle-native-support.mjs';
import {quote} from './attendance-bound-clocks-native.mjs';
import {outageNativeFingerprintSql} from './attendance-outage-native.mjs';
import {periodContinuationArchiveBytes,periodContinuationSerialization} from './attendance-period-continuation-native.mjs';

const require=createRequire(import.meta.url),day=n=>new Date(Date.UTC(2001,0,1+n)).toISOString().slice(0,10);
export const periodContinuationCountsTables=Object.freeze(['merchant_attendance_period_closures','merchant_attendance_period_artifacts',
 'merchant_attendance_period_versions','merchant_attendance_period_entries','merchant_attendance_period_storage','merchant_attendance_period_artifact_metadata']);
export const periodContinuationCountsBodyLimit=8388608;
export function periodContinuationCountsPlan(workerCount,siteCount){
 assert(Number.isInteger(workerCount)&&workerCount>=0&&workerCount<200,'counts_worker_precondition');
 assert(Number.isInteger(siteCount)&&siteCount>=workerCount&&siteCount<800,'counts_site_precondition');
 const first=200-workerCount,second=1000-siteCount-first-1,total=first+second;
 assert(second>=0&&total>=26&&total<=1000);
 return {first,second,total,workerBeforeActual:200,siteBeforeActual:1000,
  rows:Array.from({length:total},(_,i)=>({index:i+1,date:day(i),periodId:id(231900001+i),operationId:id(232000001+i)})),
  actual:[{date:'2010-01-01',periodId:id(232100001),operationId:id(232100011)},
   {date:'2010-01-02',periodId:id(232100002),operationId:id(232100012)}]};
}
//This transforms a *real, strictly projected empty UTC day*, not live facts.
//Only exact date/boundary scalar values move. Observed-at timestamps stay saved.
export function periodContinuationCountsArtifact(template,date){
 assert(/^20\d\d-\d\d-\d\d$/.test(date)&&new Date(date+'T00:00:00Z').toISOString().slice(0,10)===date);
 assert.equal(template.period.timeZone,'UTC');assert.equal(template.period.fromDate,template.period.throughDate);
 assert.equal(template.dayBoundaries.length,1);assert.equal(template.dayBoundaries[0].skipped,false);
 assert.deepEqual(template.report.base.rows,[]);assert.deepEqual(template.report.missing,[]);
 assert.deepEqual(template.source.report.base.items,[]);assert.deepEqual(template.source.report.missing,[]);
 const emptyArrays=v=>{if(Array.isArray(v)){assert.equal(v.length,0,'counts_nonempty_source_context');return;}
  if(v&&typeof v==='object')for(const value of Object.values(v))emptyArrays(value);};emptyArrays(template.source.context);
 const start=date+'T00:00:00.000000Z',end=new Date(Date.parse(date)+86400000).toISOString().replace('.000Z','.000000Z');
 assert.equal(template.period.startAt,template.period.fromDate+'T00:00:00.000000Z');
 assert.equal(template.period.endAt,new Date(Date.parse(template.period.fromDate)+86400000).toISOString().replace('.000Z','.000000Z'));
 const replacements=new Map([[template.period.fromDate,date],[template.period.startAt,start],[template.period.endAt,end]]);
 const clone=value=>typeof value==='string'?(replacements.get(value)??value):Array.isArray(value)?value.map(clone):
  value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([key,item])=>[key,clone(item)])):value;
 return clone(template);
}

export async function verifyPeriodContinuationCountsNative(ctx){
 const {d,h,native,scope,archive,oldArchive,periodArchive}=ctx;
 assert(d?.syntheticOnly===true&&h?.syntheticOnly===true,'counts_owned_synthetic_context_required');
 assert.deepEqual(assertLifecycleSandbox(sql=>native.query(scope.sql(sql))),d.owned);assert.equal(scope.schema,d.owned.schema);
 const names=d.inventory();for(const name of periodContinuationCountsTables)assert(names.includes(name));
 const baseline=d.fingerprint(),defs=d.definitions(),catalog=d.tableCatalog(),old155=periodContinuationArchiveBytes(archive()),old207=periodContinuationArchiveBytes(periodArchive());
 assert.deepEqual(old155,periodContinuationArchiveBytes(oldArchive));
 const {executePeriodClosuresV2}=require('../../src/lib/merchantAttendancePeriodClosureV2.server.ts');
 const {parsePeriodClosureV2Query,parsePeriodClosureV2Command}=require('../../src/lib/merchantAttendancePeriodClosureV2.ts');
 const {parsePeriodClosureArtifact}=require('../../src/lib/merchantAttendancePeriodClosure.ts');
 const site=quote(d.site),worker=quote(h.workerId),full=outageNativeFingerprintSql(names),protectedHash=outageNativeFingerprintSql(names.filter(n=>!periodContinuationCountsTables.includes(n)));
 const snapshot=`jsonb_build_object(${periodContinuationCountsTables.map(name=>`${quote(name)},(select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) from public.${name} r ${name==='merchant_attendance_period_storage'?`where r.merchant_id<>${site}`:''})`).join(',')})`;
 const oldGuard=periodContinuationCountsTables.map(name=>`assert not exists(select old_row.value from jsonb_array_elements(current_setting('faolla.counts231_old')::jsonb->${quote(name)}) old_row(value)
   except select to_jsonb(current_row) from public.${name} current_row),'counts_old_row_changed:${name}';`).join('\n')+`
   assert (select used_bytes from public.merchant_attendance_period_storage where merchant_id=${site})=(select coalesce(sum(artifact_bytes),0) from public.merchant_attendance_period_artifacts where merchant_id=${site}),'counts_exact_quota_sum';`;
 const q=(mode,date,periodId=null,patch={})=>parsePeriodClosureV2Query({siteId:d.site,access:'owner',workerId:h.workerId,fromDate:date,throughDate:date,mode,periodId,operationId:null,version:null,cursor:null,...patch});
 let stage='connect',steps=0,rpcCalls=0,actualWrites=0,actualReads=0,roleAssertions=0,recoveryMisses=0,seedBatches=0,sourceProjections=0,lastError=null,rolledBack=false,result;
 const failures=[],connection=native.connect();
 const step=async(label,sql)=>{stage=label;assert(++steps<=100,'counts_max100_steps');
  const text=scope.sql((label==='begin'?'begin;':'')+periodContinuationSerialization+d.guard+sql);assert(text.length<1500000,'counts_original_step_payload_limit');return connection.step(text);};
 const service={rpc:async(name,args)=>{
  assert(['faolla_attendance_period_closure_v2','faolla_attendance_period_closure_source_v1'].includes(name));
  assert.equal(args.p_query.siteId,d.site);assert.equal(args.p_query.workerId,h.workerId);assert.equal(args.p_auth_user_id,d.owner);
  const keys=name.endsWith('_source_v1')?['p_query','p_auth_user_id']:['p_query','p_auth_user_id','p_command','p_artifact','p_allow_write'];
  assert.deepEqual(Object.keys(args).sort(),[...keys].sort());assert.equal(scope.sql(json(args)),json(args),'counts_argument_schema_rewrite');
  const c=args.p_command??null,expression=`public.${name}(${keys.map(k=>k==='p_auth_user_id'?quote(args[k]):k==='p_allow_write'?String(args[k]):json(args[k])).join(',')})`;
  const v=JSON.parse(await step('rpc_'+(++rpcCalls)+'_'+(c?.action??args.p_query.mode??'source'),`do $counts_rpc$ declare before_full text;before_other text;value jsonb;failure text;context_value text;begin
   before_full:=${full};before_other:=${protectedHash};
   ${args.p_artifact?`assert (select used_bytes from public.merchant_attendance_period_storage where merchant_id=${site})-current_setting('faolla.counts231_initial_bytes')::bigint
    +octet_length(convert_to(${json(args.p_artifact)}::text,'UTF8'))<=8388608,'counts_actual_insert_body_cap';`:''}
   begin set local role service_role;assert current_user='service_role','counts_actual_role';
    value:=${expression};set constraints all immediate;set constraints all deferred;
   exception when others then get stacked diagnostics failure=message_text,context_value=pg_exception_context;end;reset role;
   if failure is not null or ${c===null?'true':'false'} or coalesce((value->>'replayed')::boolean,false) then assert ${full}=before_full,'counts_read_replay_rejection_not_zero_write';
   else assert ${protectedHash}=before_other,'counts_write_changed_other_facts';end if;${oldGuard}
   perform set_config('faolla.counts231_result',jsonb_build_object('value',value,'error',failure,'context',context_value)::text,true);
  end;$counts_rpc$;select current_setting('faolla.counts231_result')::jsonb;`));
  roleAssertions++;
  if(v.error){lastError={name,error:v.error,context:v.context};if(v.error==='attendance_operation_not_found')recoveryMisses++;return {data:null,error:{message:v.error}};}
  if(c)actualWrites++;else actualReads++;
  if(name.endsWith('_source_v1')||args.p_query.mode==='preview')sourceProjections++;
  return {data:v.value,error:null};
 }};
 const run=(query,command=null,allow=true)=>executePeriodClosuresV2({query,command,authUserId:d.owner,moduleEnabled:allow},service);
 const counters=label=>step(label,`select jsonb_build_object('worker',(select count(*) from public.merchant_attendance_period_closures where merchant_id=${site} and worker_id=${worker}),
  'site',(select count(*) from public.merchant_attendance_period_closures where merchant_id=${site}),
  'bytes',(select used_bytes from public.merchant_attendance_period_storage where merchant_id=${site}));`).then(JSON.parse);
 try{
  const initial=JSON.parse(await step('begin',`set local lock_timeout='3s';set local statement_timeout='10s';
   do $counts_begin$ declare old_rows jsonb;begin
    assert not exists(select 1 from public.merchant_attendance_period_closures where merchant_id=${site} and worker_id=${worker}
     and start_at<'2010-01-03T00:00:00Z'::timestamptz and end_at>'2001-01-01T00:00:00Z'::timestamptz),'counts_historical_windows_must_be_unused';
    assert not exists(select 1 from public.merchant_attendance_period_closures where period_id between ${quote(id(231900000))} and ${quote(id(231901100))}
      or period_id in(${quote(id(232100001))},${quote(id(232100002))})),'counts_period_ids_used';
    assert not exists(select 1 from public.merchant_attendance_period_entries where operation_id between ${quote(id(232000000))} and ${quote(id(232001100))}
      or operation_id in(${quote(id(232100011))},${quote(id(232100012))})),'counts_operation_ids_used';
    old_rows:=${snapshot};assert octet_length(old_rows::text)<=4194304,'counts_original_snapshot_limit';
    perform set_config('faolla.counts231_old',old_rows::text,true);perform set_config('faolla.counts231_seed_bytes','0',true);
    perform set_config('faolla.counts231_initial_bytes',(select used_bytes::text from public.merchant_attendance_period_storage where merchant_id=${site}),true);${oldGuard}
   end;$counts_begin$;
   select jsonb_build_object('worker',(select count(*) from public.merchant_attendance_period_closures where merchant_id=${site} and worker_id=${worker}),
    'site',(select count(*) from public.merchant_attendance_period_closures where merchant_id=${site}),
    'bytes',(select used_bytes from public.merchant_attendance_period_storage where merchant_id=${site}));`));
  const plan=periodContinuationCountsPlan(initial.worker,initial.site);
  const empty=await run(q('preview',day(0)));assert.equal(empty.kind,'preview');assert.deepEqual(empty.preview.blockers,[]);
  const prepared=plan.rows.map(row=>{const artifact=periodContinuationCountsArtifact(empty.preview.artifact,row.date);parsePeriodClosureArtifact(artifact);return {...row,artifact};});
  assert(Buffer.byteLength(JSON.stringify(prepared),'utf8')<=periodContinuationCountsBodyLimit,'counts_compact_input_limit');
  //Small batches retain the existing1.5M character step guard and all normal
  //FK/immutable/quota triggers. SQL supplies its real canonical source hash.
  const seed=async rows=>{
   for(let offset=0;offset<rows.length;offset+=80){const batch=rows.slice(offset,offset+80);seedBatches++;
    const info=JSON.parse(await step('synthetic_prefix_'+seedBatches,`do $counts_seed$ declare row_value jsonb;body jsonb;cmd jsonb;source_hash text;text_value text;
     period_id_value uuid;operation_id_value uuid;now_at timestamptz;size_value integer;before_other text;total_bytes bigint;begin
     before_other:=${protectedHash};total_bytes:=current_setting('faolla.counts231_seed_bytes')::bigint;
     for row_value in select value from jsonb_array_elements(${json(batch)}) loop
      body:=row_value->'artifact';period_id_value:=(row_value->>'periodId')::uuid;operation_id_value:=(row_value->>'operationId')::uuid;
      assert body->'worker'->>'workerId'=${worker} and body->'worker'->>'employeeId'=${quote(h.employeeId)}
       and body->'worker'->>'employeeAuthUserId'=${quote(h.employeeAuthUserId)},'counts_prefix_saved_identity';
      source_hash:=encode(sha256(convert_to((body->'source')::text,'UTF8')),'hex');body:=jsonb_set(body,'{sourceFingerprint}',to_jsonb(source_hash));
      text_value:=body::text;size_value:=octet_length(convert_to(text_value,'UTF8'));total_bytes:=total_bytes+size_value;
      assert total_bytes<=8388608 and (select used_bytes from public.merchant_attendance_period_storage where merchant_id=${site})
       -current_setting('faolla.counts231_initial_bytes')::bigint+size_value<=8388608,'counts_added_bodies_8mib_cap';now_at:=clock_timestamp();
      cmd:=jsonb_build_object('action','send','operationId',operation_id_value,'periodId',period_id_value,'expectedRevision',0,'expectedVersion',0,
       'expectedFingerprint',source_hash,'reason','Synthetic231 complete capacity prefix, not an actual historical request');
      assert public.faolla_attendance_period_closure_command_v2(cmd) is true,'counts_prefix_valid_command';
      assert not exists(select 1 from public.merchant_attendance_period_closures c where c.merchant_id=${site} and c.worker_id=${worker}
       and c.start_at<(body->'period'->>'endAt')::timestamptz and c.end_at>(body->'period'->>'startAt')::timestamptz),'counts_prefix_nonoverlap';
      insert into public.merchant_attendance_period_closures(merchant_id,period_id,worker_id,employee_id,employee_auth_user_id,from_date,through_date,time_zone,start_at,end_at,
       revision,current_version,state,sealed,confirmed_version,unresolved_dispute,opened_at,updated_at)
       values(${site},period_id_value,${worker},${quote(h.employeeId)},${quote(h.employeeAuthUserId)},(body->'period'->>'fromDate')::date,
        (body->'period'->>'throughDate')::date,'UTC',(body->'period'->>'startAt')::timestamptz,(body->'period'->>'endAt')::timestamptz,1,1,'review',false,null,false,now_at,now_at);
      insert into public.merchant_attendance_period_artifacts(merchant_id,period_id,artifact_id,source_fingerprint,artifact_text,artifact_sha256,artifact_bytes,recorded_at)
       values(${site},period_id_value,operation_id_value,source_hash,text_value,encode(sha256(convert_to(text_value,'UTF8')),'hex'),size_value,now_at);
      insert into public.merchant_attendance_period_versions(merchant_id,period_id,version,artifact_id,operation_id,recorded_at)
       values(${site},period_id_value,1,operation_id_value,operation_id_value,now_at);
      insert into public.merchant_attendance_period_entries(merchant_id,period_id,operation_id,revision,version,actor_auth_user_id,action,command,recorded_at)
       values(${site},period_id_value,operation_id_value,1,1,${quote(d.owner)},'send',cmd,now_at);
      perform public.faolla_attendance_period_summary_v2(c) from public.merchant_attendance_period_closures c where c.merchant_id=${site} and c.period_id=period_id_value;
     end loop;
     set constraints all immediate;set constraints all deferred;${oldGuard}
     assert ${protectedHash}=before_other,'counts_prefix_other_facts_changed';perform set_config('faolla.counts231_seed_bytes',total_bytes::text,true);
    end;$counts_seed$;select jsonb_build_object('seedBytes',current_setting('faolla.counts231_seed_bytes')::bigint);`));
    assert(info.seedBytes<=periodContinuationCountsBodyLimit);
   }
  };
  const actualSend=async target=>{
   const preview=await run(q('preview',target.date));assert.deepEqual(preview.preview.blockers,[]);
   const query=q('detail',target.date,target.periodId),command=parsePeriodClosureV2Command(query,{action:'send',operationId:target.operationId,periodId:target.periodId,
    expectedRevision:0,expectedVersion:0,expectedFingerprint:preview.preview.artifact.sourceFingerprint,reason:'Synthetic231 actual new-period capacity crossing'});
   const saved=await run(query,command);assert.equal(saved.kind,'detail');assert.equal(saved.period.revision,1);assert.equal(saved.period.currentVersion,1);
   assert.equal(saved.operation.operationId,target.operationId);assert.equal(saved.period.fromDate,target.date);return {query,command,saved};
  };
  await seed(prepared.slice(0,plan.first));assert.equal((await counters('before_worker_crossing')).worker,200);
  const workerReceipt=await actualSend(plan.actual[0]);assert.equal((await counters('after_worker_crossing')).worker,201);
  await seed(prepared.slice(plan.first));assert.equal((await counters('before_site_crossing')).site,1000);
  const siteReceipt=await actualSend(plan.actual[1]),finalCounts=await counters('after_site_crossing');assert.equal(finalCounts.site,1001);
  assert(finalCounts.bytes-initial.bytes<=periodContinuationCountsBodyLimit,'counts_all_added_bodies_8mib_cap');
  const listQuery=q('list',day(0),null,{throughDate:day(25)}),first=await run(listQuery,null,false);
  assert.equal(first.kind,'list');assert.equal(first.items.length,25);assert(first.nextCursor);
  const second=await run({...listQuery,cursor:first.nextCursor},null,false);assert.equal(second.kind,'list');assert.equal(second.items.length,1);assert.equal(second.nextCursor,null);
  const listed=[...first.items,...second.items];assert.equal(new Set(listed.map(x=>x.periodId)).size,26);
  assert.deepEqual(listed.map(x=>x.periodId).sort(),prepared.slice(0,26).map(x=>x.periodId).sort());
  //Select a saved summary's own civil frame, not the26-day list search window.
  const chosen=listed[0],fixed=await run(q('export',chosen.fromDate,chosen.periodId,{version:1}),null,false);
  assert.equal(fixed.kind,'detail');assert.equal(fixed.artifact.period.fromDate,chosen.fromDate);
  for(const receipt of [workerReceipt,siteReceipt]){const recovered=await run({...receipt.query,mode:'recover',operationId:receipt.command.operationId},null,false);
   assert.deepEqual(recovered.operation,receipt.saved.operation);assert.deepEqual(recovered.artifact,receipt.saved.artifact);}
  const finalProof=JSON.parse(await step('final_proof',`do $counts_final$ begin ${oldGuard} set constraints all immediate;end;$counts_final$;
   select jsonb_build_object('seedBytes',current_setting('faolla.counts231_seed_bytes')::bigint,'prefixComplete',
    (select count(*) from public.merchant_attendance_period_closures c join public.merchant_attendance_period_entries e
      on e.merchant_id=c.merchant_id and e.period_id=c.period_id and e.revision=c.revision
     join public.merchant_attendance_period_versions v on v.merchant_id=c.merchant_id and v.period_id=c.period_id and v.version=c.current_version
     join public.merchant_attendance_period_artifacts a on a.merchant_id=v.merchant_id and a.artifact_id=v.artifact_id
     join public.merchant_attendance_period_artifact_metadata m on m.merchant_id=a.merchant_id and m.artifact_id=a.artifact_id
     where c.merchant_id=${site} and c.period_id between ${quote(plan.rows[0].periodId)} and ${quote(plan.rows.at(-1).periodId)}
      and c.revision=1 and c.current_version=1 and not c.sealed and c.confirmed_version is null and c.state='review' and not c.unresolved_dispute
      and e.operation_id=v.operation_id and v.operation_id=a.artifact_id and e.recorded_at=c.updated_at
      and a.source_fingerprint=encode(sha256(convert_to((a.artifact_text::jsonb->'source')::text,'UTF8')),'hex')));`));
  assert.equal(finalProof.prefixComplete,plan.total);assert(finalProof.seedBytes<=periodContinuationCountsBodyLimit);
  await step('rollback','rollback;');rolledBack=true;
  result={phase:231,transactionSteps:steps,rpcCalls,roleAssertions,actualWrites,actualReads,recoveryMisses,sourceProjections,
   workerCountCrossed:{before:200,after:201},companyCountCrossed:{before:1000,after:1001},listPageSizes:[25,1],
   prefix:{periods:plan.total,artifacts:plan.total,versions:plan.total,entries:plan.total,batches:seedBatches,bodyBytes:finalProof.seedBytes,actualHistoricalRequests:false},
   totalAddedArtifactBytes:finalCounts.bytes-initial.bytes,addedBodyLimitBytes:periodContinuationCountsBodyLimit,quotaEqualsArtifactSum:true,
   actualNewPeriodSends:2,originalRowsUnchanged:true,old155ArchivePreserved:true,old207ArchivePreserved:true,rollbackRestored:true,
   realAuth:false,syntheticAuth:true,actualServiceSql:true,newWorkers:0,browser:false};
 }catch(error){failures.push(new Error('period_continuation_counts:'+stage+':'+String(error?.message??error),{cause:error}));}
 finally{
  try{await connection.close();}catch(error){failures.push(error);}
  for(const [label,read,want]of [['facts',()=>d.fingerprint(),baseline],['definitions',()=>d.definitions(),defs],['catalog',()=>d.tableCatalog(),catalog],
   ['old155',()=>periodContinuationArchiveBytes(archive()),old155],['old207',()=>periodContinuationArchiveBytes(periodArchive()),old207]]){
   try{assert.deepEqual(read(),want,'counts_rollback_'+label);}catch(error){failures.push(error);}
  }
 }
 if(failures.length)throw new AggregateError(failures,'period_continuation_counts_failed:'+failures.map(e=>String(e.stack)+'\n'+String(e.cause?.stack??'')).join('\n').slice(0,10000)
  +'\nlastRpcError:'+JSON.stringify(lastError)?.slice(0,3000),{cause:failures[0]});
 assert(rolledBack);native.pass('231 real201/1001 new-period sends, declared complete compact prefix,25+1 list, unchanged original facts and rollback');return result;
}
