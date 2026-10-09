// INERT. Caller-owned synthetic schema only. Commits exactly two NEW periods;
// the parent still owns schema disposal and the unchanged public baseline.
// The temporary full-quota projection is disclosed, not 64 MiB of stored data.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {assertLifecycleSandbox,lifecycleId as id,lifecycleJson as json} from '../merchant-attendance-lifecycle-native-support.mjs';
import {quote} from './attendance-bound-clocks-native.mjs';
import {periodContinuationArchiveBytes,periodContinuationSerialization} from './attendance-period-continuation-native.mjs';

const require=createRequire(import.meta.url),rid=n=>id(232300000+n),rpcName='faolla_attendance_period_closure_v2';
export const continuationRacesLimit=67108864,continuationRacesBodyLimit=262144;
export const continuationRacesTables=Object.freeze(['merchant_attendance_period_closures','merchant_attendance_period_versions',
 'merchant_attendance_period_entries','merchant_attendance_period_artifacts','merchant_attendance_period_artifact_metadata','merchant_attendance_period_storage']);
export function continuationRacesPlan(){return {periods:[{date:'2010-01-03',periodId:rid(1),send:rid(11)},
 {date:'2010-01-04',periodId:rid(2),send:rid(12)}],confirm:rid(13),seal:rid(14),reopen:rid(15),losingReopen:rid(16)};}
// Exclude only these exact prospective rows, never an entire writable table.
// Every pre-existing row is included because the IDs must first be absent.
export function continuationRacesProtectedHash(names,site,plan=continuationRacesPlan()){
 assert(/^\d{8}$/.test(site));assert(names.length&&new Set(names).size===names.length);
 const s=quote(site),[a,b]=plan.periods,filters={
  merchant_attendance_period_closures:`not(t.merchant_id=${s} and t.period_id in(${quote(a.periodId)},${quote(b.periodId)}))`,
  merchant_attendance_period_versions:`not(t.merchant_id=${s} and t.version=1 and ((t.period_id=${quote(a.periodId)} and t.operation_id=${quote(a.send)}) or (t.period_id=${quote(b.periodId)} and t.operation_id=${quote(b.send)})))`,
  merchant_attendance_period_entries:`not(t.merchant_id=${s} and ((t.period_id=${quote(a.periodId)} and t.operation_id in(${[a.send,plan.confirm,plan.seal,plan.reopen].map(quote).join(',')})) or (t.period_id=${quote(b.periodId)} and t.operation_id=${quote(b.send)})))`,
  merchant_attendance_period_artifacts:`not(t.merchant_id=${s} and ((t.period_id=${quote(a.periodId)} and t.artifact_id=${quote(a.send)}) or (t.period_id=${quote(b.periodId)} and t.artifact_id=${quote(b.send)})))`,
  merchant_attendance_period_artifact_metadata:`not(t.merchant_id=${s} and t.artifact_id in(${quote(a.send)},${quote(b.send)}))`,
  merchant_attendance_period_storage:`t.merchant_id<>${s}`,
 };
 return `(select md5(jsonb_object_agg(table_name,rows_value order by table_name)::text) from (${names.map(name=>{
  assert(/^(?:merchants|faolla_schema_migrations|merchant_[a-z0-9_]+)$/.test(name)&&name.length<=63);
  return `select ${quote(name)} table_name,(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]') from public.${name} t ${filters[name]?'where '+filters[name]:''}) rows_value`;
 }).join(' union all ')}) protected_rows)`;
}
export function continuationRacesQuotaStart(baseline,holderBytes,waiterBytes){
 assert(Number.isSafeInteger(baseline)&&baseline>0);
 for(const bytes of [holderBytes,waiterBytes])assert(Number.isInteger(bytes)&&bytes>0&&bytes<=continuationRacesBodyLimit);
 assert(baseline+holderBytes+waiterBytes<continuationRacesLimit,'races_actual_body_headroom');
 return {injected:continuationRacesLimit-holderBytes,full:continuationRacesLimit,restored:baseline+holderBytes};
}
export function continuationRacesAssertFootprint(proof,{site,workerId,employeeId,employeeAuthUserId,baseline,receipts,archives,heads,projected=false,plan=continuationRacesPlan()}){
 const sends=plan.periods.filter(p=>receipts.has(p.send)),operations=[...receipts.keys()].sort();
 assert.deepEqual(proof.heads.map(x=>x.period.periodId).sort(),sends.map(x=>x.periodId).sort());
 assert.deepEqual(proof.entries.map(x=>x.operationId).sort(),operations);
 for(const entry of proof.entries)assert.deepEqual(entry,receipts.get(entry.operationId));
 assert.equal(proof.versions.length,sends.length);assert.equal(proof.artifacts.length,sends.length);assert.equal(proof.metadata.length,sends.length);
 let added=0;
 for(const p of sends){
  const receipt=receipts.get(p.send),saved=archives.get(p.send),head=proof.heads.find(x=>x.period.periodId===p.periodId);
  assert(saved);assert.deepEqual(head.period,heads.get(p.periodId));assert.equal(head.openedAt,receipt.recordedAt);
  assert.equal(head.updatedAt,receipts.get(head.operationId).recordedAt);
  assert.equal(head.period.workerId,workerId);assert.equal(head.period.employeeId,employeeId);assert.equal(head.period.employeeAuthUserId,employeeAuthUserId);
  assert.equal(head.period.fromDate,p.date);assert.equal(head.period.throughDate,p.date);assert.equal(head.period.currentVersion,1);
  assert.deepEqual(proof.versions.find(x=>x.periodId===p.periodId),{periodId:p.periodId,version:1,operationId:p.send,artifactId:p.send,recordedAt:receipt.recordedAt});
  const a=proof.artifacts.find(x=>x.artifactId===p.send);assert.equal(a.periodId,p.periodId);assert.equal(a.recordedAt,receipt.recordedAt);
  assert.deepEqual(periodContinuationArchiveBytes(a),periodContinuationArchiveBytes(saved));assert.equal(a.sourceFingerprint,saved.artifact.sourceFingerprint);
  assert(a.artifactBytes<=continuationRacesBodyLimit);added+=a.artifactBytes;
  assert.deepEqual(proof.metadata.find(x=>x.artifact_id===p.send),{merchant_id:site,artifact_id:p.send,worker_name:saved.artifact.worker.workerName,worker_no:saved.artifact.worker.workerNo});
 }
 assert.equal(proof.actualBytes,baseline+added);assert.equal(proof.usedBytes,projected?continuationRacesLimit:baseline+added);
 assert(proof.usedBytes<=continuationRacesLimit);return added;
}

export async function verifyPeriodContinuationRacesNative(ctx){
 const {d,h,native,scope,archive,oldArchive,periodArchive,period,pq,periodId}=ctx;
 assert(d?.syntheticOnly===true&&h?.syntheticOnly===true,'races_owned_synthetic_context_required');
 assert.equal(typeof native.connect,'function');assert.equal(typeof d.guard,'string');
 assert.deepEqual(assertLifecycleSandbox(sql=>native.query(scope.sql(sql))),d.owned);assert.equal(scope.schema,d.owned.schema);
 const names=d.inventory();for(const name of continuationRacesTables)assert(names.includes(name));
 const plan=continuationRacesPlan(),[a,b]=plan.periods,site=quote(d.site),worker=quote(h.workerId),ids=plan.periods.map(p=>quote(p.periodId)).join(',');
 const execRead=sql=>d.exec(periodContinuationSerialization+d.guard+sql);
 const definitions=d.definitions(),catalog=d.tableCatalog(),old155=periodContinuationArchiveBytes(archive()),old207=periodContinuationArchiveBytes(periodArchive());
 assert.deepEqual(old155,periodContinuationArchiveBytes(oldArchive));
 const protectedSql=continuationRacesProtectedHash(names,d.site,plan),protectedBefore=execRead('select '+protectedSql+';');
 const profile=JSON.parse(execRead(`select jsonb_build_object('used',(select used_bytes from public.merchant_attendance_period_storage where merchant_id=${site}),
  'actual',(select coalesce(sum(artifact_bytes),0) from public.merchant_attendance_period_artifacts where merchant_id=${site}),
  'collisions',(select count(*) from public.merchant_attendance_period_closures where period_id between ${quote(rid(0))} and ${quote(rid(99))})+
   (select count(*) from public.merchant_attendance_period_entries where operation_id between ${quote(rid(0))} and ${quote(rid(99))})+
   (select count(*) from public.merchant_attendance_period_versions where operation_id between ${quote(rid(0))} and ${quote(rid(99))})+
   (select count(*) from public.merchant_attendance_period_artifacts where artifact_id between ${quote(rid(0))} and ${quote(rid(99))})+
   (select count(*) from public.merchant_attendance_period_artifact_metadata where artifact_id between ${quote(rid(0))} and ${quote(rid(99))}),
  'overlap',(select count(*) from public.merchant_attendance_period_closures where merchant_id=${site} and worker_id=${worker}
   and start_at<'2010-01-05T00:00:00Z'::timestamptz and end_at>'2010-01-03T00:00:00Z'::timestamptz));`));
 assert.equal(profile.collisions,0);assert.equal(profile.overlap,0);assert.equal(profile.used,profile.actual);assert(profile.used>0&&profile.used<continuationRacesLimit);
 const baseline=profile.used,fmt="'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"'",dateSql=v=>`to_char(${v} at time zone 'UTC',${fmt})`;
 const proofSql=`jsonb_build_object('usedBytes',(select used_bytes from public.merchant_attendance_period_storage where merchant_id=${site}),
  'actualBytes',(select coalesce(sum(artifact_bytes),0) from public.merchant_attendance_period_artifacts where merchant_id=${site}),
  'heads',(select coalesce(jsonb_agg(jsonb_build_object('period',public.faolla_attendance_period_summary_v2(c),'openedAt',${dateSql('c.opened_at')},'updatedAt',${dateSql('c.updated_at')},
   'operationId',(select operation_id from public.merchant_attendance_period_entries where merchant_id=c.merchant_id and period_id=c.period_id and revision=c.revision)) order by c.period_id),'[]') from public.merchant_attendance_period_closures c where merchant_id=${site} and period_id in(${ids})),
  'entries',(select coalesce(jsonb_agg(public.faolla_attendance_period_entry_v2(e) order by e.operation_id),'[]') from public.merchant_attendance_period_entries e where merchant_id=${site} and period_id in(${ids})),
  'versions',(select coalesce(jsonb_agg(jsonb_build_object('periodId',period_id,'version',version,'operationId',operation_id,'artifactId',artifact_id,'recordedAt',${dateSql('recorded_at')}) order by period_id,version),'[]') from public.merchant_attendance_period_versions where merchant_id=${site} and period_id in(${ids})),
  'artifacts',(select coalesce(jsonb_agg(jsonb_build_object('periodId',period_id,'artifactId',artifact_id,'sourceFingerprint',source_fingerprint,'artifactText',artifact_text,'artifact',artifact_text::jsonb,
   'artifactBytes',artifact_bytes,'artifactSha256',artifact_sha256,'recordedAt',${dateSql('recorded_at')}) order by artifact_id),'[]') from public.merchant_attendance_period_artifacts where merchant_id=${site} and period_id in(${ids})),
  'metadata',(select coalesce(jsonb_agg(to_jsonb(m) order by artifact_id),'[]') from public.merchant_attendance_period_artifact_metadata m where merchant_id=${site} and artifact_id in(${[a.send,b.send].map(quote).join(',')})))`;
 const {executePeriodClosuresV2}=require('../../src/lib/merchantAttendancePeriodClosureV2.server.ts');
 const {parsePeriodClosureV2Query,parsePeriodClosureV2Command}=require('../../src/lib/merchantAttendancePeriodClosureV2.ts');
 const q=(p,mode='detail',access='owner',patch={})=>parsePeriodClosureV2Query({siteId:d.site,access,workerId:h.workerId,fromDate:p.date,throughDate:p.date,mode,
  periodId:mode==='preview'?null:p.periodId,operationId:null,version:null,cursor:null,...patch});
 const command=(p,action,operationId,head=null,fingerprint=null)=>parsePeriodClosureV2Command(q(p,'detail',action==='confirm'?'self':'owner'),{
  action,operationId,periodId:p.periodId,expectedRevision:head?.period.revision??0,expectedVersion:head?.period.currentVersion??0,
  expectedFingerprint:['send','confirm','seal'].includes(action)?fingerprint??head?.artifact?.sourceFingerprint:null,
  reason:'Synthetic231 explicit local concurrency request; only this new period, not payroll or real account consent'});
 const receipts=new Map(),archives=new Map(),heads=new Map(),sessions=new Set(),failures=[],races=[];
 let stage='preview',steps=0,rpcCalls=0,roleAssertions=0,projected=false,injectionBytes=null,lastRpc=null,completed=false,result;
 const prefix=periodContinuationSerialization+"set local lock_timeout='3s';set local statement_timeout='10s';"+d.guard;
 const oldGuard=`assert ${protectedSql}=${quote(protectedBefore)},'races_changed_old_or_unlisted_facts';`;
 const proof=()=>JSON.parse(execRead('select '+proofSql+';'));
 const verifyProof=()=>{const value=proof();continuationRacesAssertFootprint(value,{site:d.site,workerId:h.workerId,employeeId:h.employeeId,employeeAuthUserId:h.employeeAuthUserId,
  baseline,receipts,archives,heads,projected,plan});assert.equal(execRead('select '+protectedSql+';'),protectedBefore);return value;};
 const record=(session,value)=>{assert.equal(value.kind,'detail');assert(value.operation);assert(!value.replayed);receipts.set(value.operation.operationId,value.operation);heads.set(value.period.periodId,value.period);
  if(value.operation.action==='send'){periodContinuationArchiveBytes(session.last.value);archives.set(value.operation.operationId,session.last.value);}};
 const prepare=input=>{
  const connection=native.connect();let releaseGate,reachGate,cancelled=false;const gate=new Promise(resolve=>{releaseGate=resolve;}),reached=new Promise(resolve=>{reachGate=resolve;});
  const s={connection,input,last:null,closed:false,outcome:null,ready:null,release:()=>releaseGate(),cancel:()=>{cancelled=true;releaseGate();},
   step:sql=>{assert(++steps<=100,'races_max100_steps');return connection.step(scope.sql(sql));},
   async close(){if(!s.closed){s.cancel();await connection.close();s.closed=true;sessions.delete(s);}}};sessions.add(s);
  const service={rpc:async(name,args)=>{
   assert([rpcName,'faolla_attendance_period_closure_source_v1'].includes(name));assert.equal(args.p_query.siteId,d.site);assert.equal(args.p_query.workerId,h.workerId);
   assert([a.periodId,b.periodId,null].includes(args.p_query.periodId));assert.equal(args.p_auth_user_id,input.query.access==='self'?h.employeeAuthUserId:d.owner);
   const keys=name===rpcName?['p_query','p_auth_user_id','p_command','p_artifact','p_allow_write']:['p_query','p_auth_user_id'];assert.deepEqual(Object.keys(args).sort(),[...keys].sort());
   assert.equal(scope.sql(json(args)),json(args),'races_literal_schema_rewrite');
   const final=name===rpcName&&(input.command?args.p_command!==null:true);
   if(final){reachGate({args,name});await gate;if(cancelled)throw Error('races_cancelled_before_rpc');}
   const expression=`public.${name}(${keys.map(k=>k==='p_auth_user_id'?quote(args[k]):k==='p_allow_write'?String(args[k]):json(args[k])).join(',')})`;
   const inject=final&&injectionBytes!==null&&args.p_command?.operationId===a.send?`perform 1 from public.merchant_attendance_settings where merchant_id=${site} for update;
    assert (select used_bytes from public.merchant_attendance_period_storage where merchant_id=${site})=${baseline},'races_injection_baseline';
    assert (select sum(artifact_bytes) from public.merchant_attendance_period_artifacts where merchant_id=${site})=${baseline},'races_injection_actual_sum';
    assert octet_length(convert_to(${json(args.p_artifact)}::text,'UTF8'))=${injectionBytes},'races_holder_actual_bytes';
    update public.merchant_attendance_period_storage set used_bytes=${continuationRacesLimit-injectionBytes} where merchant_id=${site} and used_bytes=${baseline};assert found,'races_injection_cas';`:'';
   const noWrites=!args.p_command||args.p_command.operationId===plan.reopen&&receipts.has(plan.reopen);
   let returned;try{returned=await s.step(`begin;${prefix}do $period_race_rpc$ declare rpc_value jsonb;rpc_failure text;rpc_state text;rpc_context text;before_proof text;begin
    ${oldGuard}${inject}before_proof:=${noWrites?`md5((${proofSql})::text)`:'null'};begin
     set local role service_role;assert current_user='service_role','races_actual_service_role';rpc_value:=${expression};set constraints all immediate;set constraints all deferred;
    exception when others then get stacked diagnostics rpc_failure=message_text,rpc_state=returned_sqlstate,rpc_context=pg_exception_context;end;reset role;
    ${oldGuard}${noWrites?`assert md5((${proofSql})::text)=before_proof,'races_read_or_replay_changed_new_facts';`:''}
    if ${final?'true':'false'} then
     assert not exists(select 1 from public.merchant_attendance_period_artifacts where merchant_id=${site} and period_id in(${ids}) and artifact_bytes>${continuationRacesBodyLimit}),'races_new_body_bound';
     assert (select used_bytes from public.merchant_attendance_period_storage where merchant_id=${site})=${projected?String(continuationRacesLimit):`(select sum(artifact_bytes) from public.merchant_attendance_period_artifacts where merchant_id=${site})`},'races_quota_exact';
    end if;
    perform set_config('faolla.continuation_races_result',jsonb_build_object('value',rpc_value,'error',rpc_failure,'sqlstate',rpc_state,'context',rpc_context)::text,true);
    end;$period_race_rpc$;select current_setting('faolla.continuation_races_result')::jsonb;${final?'':'rollback;'}`);
   }catch(error){lastRpc=s.last={name,args,error:'races_rpc_transport_or_guard',context:String(error?.stack??error).slice(0,6000)};throw error;}
   const value=JSON.parse(returned);
   rpcCalls++;roleAssertions++;s.last={name,args,...value};lastRpc=s.last;
   return value.error?{data:null,error:{message:value.error}}:{data:value.value,error:null};
  }};
  s.outcome=executePeriodClosuresV2({...input,authUserId:input.query.access==='self'?h.employeeAuthUserId:d.owner},service).then(value=>({value,error:null}),error=>({value:null,error}));
  s.ready=()=>Promise.race([reached,s.outcome]).then(v=>{if(!v.args)throw v.error??Error('races_expected_final_rpc');return v;});return s;
 };
 const one=async(input,save=false)=>{const s=prepare(input);try{await s.ready();s.release();const o=await s.outcome;if(o.error)throw o.error;
  if(save)record(s,o.value);await s.step('commit;');return o.value;}finally{await s.close();}};
 const race=async(left,right,{expectedError=null,saveLeft=false,saveRight=false,label})=>{
  const holder=prepare(left),waiter=prepare(right);try{
   const [leftReady,rightReady]=await Promise.all([holder.ready(),waiter.ready()]);
   if(label==='quota_rejection'){
    const bytes=args=>Number(execRead(`select octet_length(convert_to(${json(args.p_artifact)}::text,'UTF8'));`));
    const limits=continuationRacesQuotaStart(baseline,bytes(leftReady.args),bytes(rightReady.args));injectionBytes=continuationRacesLimit-limits.injected;projected=true;
   }
   holder.release();const accepted=await holder.outcome;if(accepted.error)throw accepted.error;
   const pid=Number(await holder.step('select pg_backend_pid();'));assert(Number.isSafeInteger(pid)&&pid>0);assert.match(waiter.connection.name,/^attendance_race_[a-f0-9]{32}$/);
   waiter.release();let witnessed=false;const until=Date.now()+2500;
   while(Date.now()<until){witnessed=native.query(`select count(*) from pg_stat_activity where application_name=${quote(waiter.connection.name)} and wait_event_type='Lock' and ${pid}=any(pg_blocking_pids(pid));`)==='1';
    if(witnessed)break;await new Promise(resolve=>setTimeout(resolve,15));}
   assert(witnessed,'races_exact_writer_blocker_not_witnessed');await holder.step('commit;');if(saveLeft)record(holder,accepted.value);
   const rejected=await waiter.outcome;
   if(expectedError){assert.equal(rejected.error?.code,expectedError,String(rejected.error?.stack??'unexpected success'));assert.equal(rejected.value,null);await waiter.step('rollback;');}
   else{if(rejected.error)throw rejected.error;await waiter.step('commit;');if(saveRight)record(waiter,rejected.value);}
   races.push({label,exactBlockerPidWitnessed:true,waiterError:expectedError,holderReplayed:accepted.value.replayed});return {holder:accepted.value,waiter:rejected.value};
  }finally{await Promise.all([holder.close(),waiter.close()]);await Promise.all([holder.outcome,waiter.outcome]);}
 };
 try{
  const previews=[];for(const p of plan.periods){const v=await one({query:q(p,'preview'),moduleEnabled:true});assert.equal(v.kind,'preview');assert.deepEqual(v.preview.blockers,[]);
   assert.equal(v.preview.artifact.period.timeZone,'UTC');assert.deepEqual(v.preview.artifact.report.base.rows,[]);assert.deepEqual(v.preview.artifact.report.missing,[]);previews.push(v);}
  const sendA=command(a,'send',a.send,null,previews[0].preview.artifact.sourceFingerprint),sendB=command(b,'send',b.send,null,previews[1].preview.artifact.sourceFingerprint);
  stage='quota_writer_race';await race({query:q(a),command:sendA,moduleEnabled:true},{query:q(b),command:sendB,moduleEnabled:true},{label:'quota_rejection',expectedError:'attendance_period_storage_limit',saveLeft:true});
  // Only the holder committed. Prove the rejected waiter's entire footprint is
  // absent before touching the disclosed projection. Never blindly SUM-heal.
  const full=verifyProof();assert.equal(receipts.size,1);assert.equal(full.artifacts[0].artifactBytes,injectionBytes);
  stage='exact_projection_restore';const restore=native.connect();try{
   assert(++steps<=100);await restore.step(scope.sql(`begin;${prefix}do $races_restore$ begin
    perform 1 from public.merchant_attendance_settings where merchant_id=${site} for update;${oldGuard}
    assert ${proofSql}=${json(full)},'races_restore_exact_committed_footprint';
    assert (select sum(artifact_bytes) from public.merchant_attendance_period_artifacts where merchant_id=${site})=${baseline+injectionBytes},'races_restore_actual_sum';
    update public.merchant_attendance_period_storage set used_bytes=${baseline+injectionBytes} where merchant_id=${site} and used_bytes=${continuationRacesLimit};assert found,'races_restore_known_projection_cas';
    ${oldGuard}set constraints all immediate;end;$races_restore$;commit;`));
  }finally{await restore.close();}projected=false;injectionBytes=null;verifyProof();
  stage='known_rejected_original_retry';await one({query:q(b),command:sendB,moduleEnabled:true},true);const charged=verifyProof();
  assert.equal(receipts.size,2);assert.equal(charged.artifacts.length,2);
  stage='new_period_confirm_seal';let head=await one({query:q(a),moduleEnabled:false});
  head=await one({query:q(a,'detail','self'),command:command(a,'confirm',plan.confirm,head),moduleEnabled:true},true);
  head=await one({query:q(a),command:command(a,'seal',plan.seal,head),moduleEnabled:true},true);assert.equal(head.period.sealed,true);verifyProof();
  const winner=command(a,'reopen',plan.reopen,head),loser={...winner,operationId:plan.losingReopen};
  stage='same_cas_reopen';await race({query:q(a),command:winner,moduleEnabled:false},{query:q(a),command:loser,moduleEnabled:false},
   {label:'same_cas_reopen',expectedError:'attendance_version_conflict',saveLeft:true});verifyProof();
  stage='receipt_actor_after_wait';const beforeReplay=proof();await race({query:q(a),command:winner,moduleEnabled:false},
   {query:q(a,'recover','self',{operationId:winner.operationId}),moduleEnabled:false},{label:'receipt_actor_after_wait',expectedError:'attendance_access_denied'});
  assert.deepEqual(proof(),beforeReplay);const final=verifyProof();assert.equal(receipts.size,5);assert(!receipts.has(plan.losingReopen));
  assert.equal(heads.get(a.periodId).revision,4);assert.equal(heads.get(a.periodId).state,'open');assert.equal(heads.get(b.periodId).revision,1);
  for(const p of plan.periods){const before=proof(),saved=await one({query:q(p,'recover','owner',{operationId:p.send}),moduleEnabled:false});
   assert.deepEqual(saved.operation,receipts.get(p.send));assert.deepEqual(proof(),before);}
  completed=true;result={phase:231,groups:races,transactionSteps:steps,rpcCalls,roleAssertions,actualServiceSql:true,syntheticAuth:true,realAuth:false,
   injectedQuotaProjection:true,physicallyFilledBudget:false,quotaLimitBytes:continuationRacesLimit,quotaRejection:'attendance_period_storage_limit',
   exactProjectionRestored:true,knownRejectedOriginalNumberRetried:true,actualQuotaIncrement:final.usedBytes-baseline,newPeriodIds:plan.periods.map(p=>p.periodId),
   successfulOperationIds:[...receipts.keys()],newPeriods:2,newEntries:5,newVersions:2,newArtifacts:2,oldFactsUnchanged:true,old155ArchivePreserved:true,old207ArchivePreserved:true,
   oldFunctionsUnchanged:true,committedSyntheticRows:true,ownedSchemaCleanupRequired:true,newCluster:false,productionAccess:false,browser:false};
 }catch(error){failures.push(new Error('period_continuation_races:'+stage+':'+String(error?.stack??error),{cause:error}));}
 finally{
  for(const s of [...sessions]){s.cancel();try{await s.close();await s.outcome;}catch(error){failures.push(error);}}
  // A failed/unknown run never repairs quota or deletes business rows. Close
  // exact sessions, preserve diagnostics, and let the parent drop its schema.
  for(const[label,read,want]of [['old facts',()=>execRead('select '+protectedSql+';'),protectedBefore],['definitions',()=>d.definitions(),definitions],['catalog',()=>d.tableCatalog(),catalog],
   ['old155',()=>periodContinuationArchiveBytes(archive()),old155],['old207',()=>periodContinuationArchiveBytes(periodArchive()),old207]]){
   try{assert.deepEqual(await read(),want,'races_preserve_'+label);}catch(error){failures.push(error);}}
  try{const saved=await period(pq('detail','owner',periodId));assert.equal(saved.period.sealed,true);assert.equal(saved.sourceChanged,false);}catch(error){failures.push(error);}
 }
 if(failures.length)throw new AggregateError(failures,'period_continuation_races_failed:'+failures.slice(0,5).map(e=>String(e.stack)).join('\n').slice(0,9000)
  +'\nlastRpcError:'+JSON.stringify(lastRpc?.error?{name:lastRpc.name,error:lastRpc.error,sqlstate:lastRpc.sqlstate,context:lastRpc.context?.slice(0,2000)}:null),{cause:failures[0]});
 assert(completed);assert.equal(sessions.size,0);native.pass('231 exact-PID quota rejection/known projection restoration, original-number retry, CAS and actor races; two new periods only, parent-owned schema disposal');return result;
}
