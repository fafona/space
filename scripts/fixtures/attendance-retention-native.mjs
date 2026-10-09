//Caller-owned synthetic acceptance only. One connection, one final rollback.
//All metadata writes use182. A missing location sidecar may be explicitly
//seeded as denied/null evidence; this is NOT a positioning/authentication test.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {assertLifecycleSandbox,lifecycleId as id,lifecycleJson as json} from '../merchant-attendance-lifecycle-native-support.mjs';
import {quote} from './attendance-bound-clocks-native.mjs';
import {outageNativeFingerprintSql} from './attendance-outage-native.mjs';
const require=createRequire(import.meta.url);
export const retentionNativeTables=Object.freeze(['merchant_attendance_retention_policy_operations','merchant_attendance_preservation_operations']);
export function retentionNativeExpression(query,actor,command=null,allow=false){
 assert.equal(typeof allow,'boolean');
 return `public.faolla_attendance_retention_v1(${json(query)},${quote(actor)},${json(command)},${allow})`;
}

export async function verifyAttendanceRetentionNative(ctx){
 const {d,h,native,scope,periodId,periodArchive,archive,oldArchive}=ctx;
 assert(d?.syntheticOnly===true&&h?.syntheticOnly===true);assert.equal(typeof native.querySteps,'function');
 assert.deepEqual(assertLifecycleSandbox(d.exec),d.owned);assert.equal(scope.schema,d.owned.schema);
 const names=d.inventory();for(const name of retentionNativeTables)assert(names.includes(name));
 const baseline=d.fingerprint(names),definitions=d.definitions(),catalog=d.tableCatalog(),fixed=periodArchive();
 assert.equal(fixed.period.periodId,periodId);assert(fixed.period.sealed);
 const meta=JSON.parse(d.exec(`select jsonb_build_object('eventId',e.id,'workerId',e.worker_id,'occurredAt',to_char(e.occurred_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'locationExists',exists(select 1 from public.merchant_attendance_location_results l where l.event_id=e.id),
  'artifactId',(select a.artifact_id from public.merchant_attendance_period_artifacts a where a.merchant_id=${quote(d.site)} and a.period_id=${quote(periodId)} order by a.recorded_at desc,a.artifact_id desc limit 1))
  from public.merchant_attendance_events e where e.merchant_id=${quote(d.site)} and e.worker_id=${quote(h.workerId)}
  order by exists(select 1 from public.merchant_attendance_location_results l where l.event_id=e.id) desc,e.occurred_at desc,e.id desc limit 1;`));
 assert(meta?.eventId&&meta.artifactId);assert.equal(meta.workerId,h.workerId);
 const {parseRetentionQuery,parseRetentionCommand}=require('../../src/lib/merchantAttendanceRetention.ts');
 const {projectRetentionResult}=require('../../src/lib/merchantAttendanceRetention.server.ts');
 let serial=227600000;const next=()=>id(++serial),other=id(227699999),siteId=d.site;
 const policyQ={siteId,mode:'policies'},records=['events','location_results','period_artifact'].map(category=>({siteId,mode:'record',category,recordId:category==='period_artifact'?meta.artifactId:meta.eventId}));
 const start=meta.occurredAt.slice(0,10)+'T00:00:00.000000Z',end=new Date(Date.parse(start)+86400000).toISOString().replace(/\.([0-9]{3})Z$/,'.$1000Z');
 const previews=records.map(q=>q.category==='period_artifact'?{siteId,mode:'preview',category:q.category,workerId:meta.workerId,periodId}:
  {siteId,mode:'preview',category:q.category,workerId:meta.workerId,fromAt:start,toAt:end});
 const full=outageNativeFingerprintSql(names),old=outageNativeFingerprintSql(names.filter(n=>!retentionNativeTables.includes(n)));
 const prefix="reset role;set local time zone 'UTC';set local datestyle='ISO,YMD';set local extra_float_digits=3;"+d.guard;
 const steps=[],expected=new Map(),checks=new Map();let reads=0,rejections=0,submissions=0;
 const sourceKey=category=>'faolla.retention_native_'+category;
 const scopeRow=label=>`select jsonb_build_object('kind','scope','label',${quote(label)},'hash',${full});`;
 const dynamicCommand=(c,dynamic)=>dynamic?`jsonb_set(${json(c)},'{expectedSourceFingerprint}',current_setting(${quote(sourceKey(c.category))})::jsonb->'data'->'item'->'sourceFingerprint')`:json(c);
 const call=(label,q,c=null,{auth=d.owner,allow=c!==null,readOnly=c===null,dynamic=false,store=null,floatDigits=3}={})=>{
  parseRetentionQuery(q);if(c)parseRetentionCommand(c);assert(!expected.has(label));expected.set(label,{q,c,auth,dynamic});
  assert([0,3].includes(floatDigits));
  if(readOnly)reads++;else submissions++;
  const before=readOnly?full:old,commandSql=dynamicCommand(c,dynamic);
  return prefix+`set local extra_float_digits=${floatDigits};do $retention_call$ declare b text;v jsonb;c jsonb:=${commandSql};begin b:=${before};
   set local role service_role;assert current_user='service_role','retention_service_role_required';
   v:=public.faolla_attendance_retention_v1(${json(q)},${quote(auth)},c,${allow});reset role;
   assert ${before}=b,${quote('retention_changed_protected_facts:'+label)};
   ${store?`perform set_config(${quote(store)},v::text,true);`:''}
   perform set_config('faolla.retention_native_output',jsonb_build_object('kind','result','label',${quote(label)},'value',v,'command',c)::text,true);
  end;$retention_call$;select current_setting('faolla.retention_native_output')::jsonb;`;
 };
 const reject=(label,q,c,code,{auth=d.owner,allow=true,dynamic=false,expression=null}={})=>{
  rejections++;const exp=expression??`public.faolla_attendance_retention_v1(${json(q)},${quote(auth)},${dynamicCommand(c,dynamic)},${allow})`;
  return prefix+`do $retention_reject$ declare b text;e text;begin b:=${full};begin
   set local role service_role;perform ${exp};raise exception 'retention_expected_rejection_missing';
   exception when others then e:=sqlerrm;if e<>${quote(code)} then raise exception 'retention_probe_mismatch:% expected:% actual:%',${quote(label)},${quote(code)},e;end if;end;
   reset role;assert ${full}=b,${quote('retention_rejected_write:'+label)};end;$retention_reject$;
   select jsonb_build_object('kind','rejection','label',${quote(label)},'code',${quote(code)});`;
 };
 const policyCommand=(category,revision,days)=>({siteId,action:'set_policy',operationId:next(),category,expectedRevision:revision,retentionDays:days,reason:'Synthetic227 explicit retention policy, not a legal recommendation'});
 const preservation=(q,action,revision)=>({siteId,action,operationId:next(),category:q.category,recordId:q.recordId,expectedRevision:revision,expectedSourceFingerprint:'0'.repeat(64),reason:'Synthetic227 single-record preservation only'});
 const recover=c=>({siteId,mode:'recover',operationId:c.operationId});
 steps.push('begin;'+prefix+`do $retention_begin$ begin
  assert not exists(select 1 from public.merchant_attendance_retention_policy_operations),'retention_new_policy_ledger_required';
  assert not exists(select 1 from public.merchant_attendance_preservation_operations),'retention_new_preservation_ledger_required';
  assert exists(select 1 from public.merchant_attendance_period_closures where merchant_id=${quote(siteId)} and period_id=${quote(periodId)} and sealed),'retention_actual_sealed_required';
 end;$retention_begin$;`+scopeRow('before_all'));
 //One disclosed prerequisite, never an original event rewrite. Existing
 //sidecars are read unchanged; all inserted data vanishes in final ROLLBACK.
 if(!meta.locationExists)steps.push(prefix+`insert into public.merchant_attendance_location_results(event_id,settings_version,worker_version,location_version,algorithm_version,reason,needs_review,captured_at,accuracy_meters,distance_meters)
  select e.id,s.version,w.version,l.version,1,'denied',true,null,null,null from public.merchant_attendance_events e
   join public.merchant_attendance_settings s on s.merchant_id=e.merchant_id
   join public.merchant_attendance_workers w on w.merchant_id=e.merchant_id and w.id=e.worker_id
   join public.merchant_attendance_locations l on l.merchant_id=e.merchant_id and l.id=e.location_id
   where e.merchant_id=${quote(siteId)} and e.id=${quote(meta.eventId)} and not exists(select 1 from public.merchant_attendance_location_results x where x.event_id=e.id);
  select jsonb_build_object('kind','synthetic_location_prerequisite','count',(select count(*) from public.merchant_attendance_location_results where event_id=${quote(meta.eventId)}));`);
 steps.push(call('default_policies',policyQ));
 for(const q of records)steps.push(call('record_'+q.category,q,null,{store:sourceKey(q.category)}));
 for(const q of previews)steps.push(call('preview_'+q.category,q));
 steps.push(call('unknown_recover',{siteId,mode:'recover',operationId:next()}));
 const eventPolicy=policyCommand('events',0,1),locationPolicy=policyCommand('location_results',0,1),artifactPolicy=policyCommand('period_artifact',0,1);
 steps.push(reject('non_owner_read',policyQ,null,'attendance_access_denied',{auth:h.employeeAuthUserId}));
 steps.push(reject('fresh_flag_off',policyQ,eventPolicy,'attendance_retention_disabled',{allow:false}));
 for(const [label,c]of [['policy_events',eventPolicy],['policy_location_results',locationPolicy],['policy_period_artifact',artifactPolicy]])steps.push(call(label,policyQ,c));
 const holds=records.map(q=>preservation(q,'hold',0));
 for(let i=0;i<records.length;i++){
  const q=records[i],c=holds[i];steps.push(call('hold_'+q.category,q,c,{dynamic:true}));
  steps.push(call('held_'+q.category,q));
  steps.push(call('recover_'+q.category,recover(c)));
  steps.push(call('replay_'+q.category,q,c,{dynamic:true,readOnly:true,allow:false}));
 }
 steps.push(reject('same_operation_changed_body',policyQ,{...eventPolicy,reason:'Changed original intent'},'attendance_operation_conflict',{allow:false}));
 steps.push(reject('stale_policy_cas',policyQ,{...eventPolicy,operationId:next(),retentionDays:2},'attendance_retention_changed'));
 steps.push(reject('unchanged_policy',policyQ,policyCommand('events',1,1),'attendance_retention_unchanged'));
 steps.push(reject('wrong_source_fingerprint',records[0],preservation(records[0],'release',1),'attendance_retention_changed'));
 steps.push(reject('cross_kind_operation_conflict',records[0],{...holds[0],operationId:eventPolicy.operationId},'attendance_operation_conflict',{dynamic:true,allow:false}));
 steps.push(call('location_serialization_three',records[1]));
 //The helper fixes its floating conversion independently of caller settings.
 steps.push(call('location_serialization_zero',records[1],null,{floatDigits:0}));
 //Real 27-revision policy history, not seeded success rows or fake cursors.
 for(let revision=1;revision<27;revision++)steps.push(call('policy_history_'+(revision+1),policyQ,policyCommand('events',revision,revision%2?2:1)));
 const history={siteId,mode:'history',category:'events',recordId:null,beforeRevision:null};
 steps.push(call('history_first25',history));steps.push(call('history_last2',{...history,beforeRevision:3}));
 for(const q of records)steps.push(call('release_'+q.category,q,preservation(q,'release',1),{dynamic:true}));
 steps.push(call('released_record',records[0]));
 const holdAgain=preservation(records[0],'hold',2);steps.push(call('hold_again',records[0],holdAgain,{dynamic:true}));
 steps.push(prefix+scopeRow('before_identity')+'savepoint retention_identity;'+`update public.merchant_attendance_settings set enabled=false where merchant_id=${quote(siteId)};
  update public.merchant_attendance_workers set active=false where merchant_id=${quote(siteId)} and id=${quote(h.workerId)};
  update public.merchant_enterprise_employees set auth_user_id=${quote(other)} where merchant_id=${quote(siteId)} and id=${quote(h.employeeId)};
  update public.merchants set user_id=${quote(other)} where id=${quote(siteId)};`);
 steps.push(call('new_owner_historical_record',records[0],null,{auth:other}));
 steps.push(call('new_owner_history',{...history,recordId:records[0].recordId},null,{auth:other}));
 steps.push(reject('new_owner_cannot_claim_old_receipt',recover(holdAgain),null,'attendance_access_denied',{auth:other,allow:false}));
 steps.push(reject('old_owner_no_longer_authorized',recover(holdAgain),null,'attendance_access_denied',{allow:false}));
 steps.push(call('new_owner_release_while_paused',records[0],preservation(records[0],'release',3),{auth:other,dynamic:true}));
 steps.push(prefix+'rollback to savepoint retention_identity;release savepoint retention_identity;'+scopeRow('after_identity'));
 steps.push(call('old_owner_original_receipt',recover(holdAgain)));
 //The API cannot write old ledgers at all. This explicit owner-level attempt
 //tests the append-only trigger, separately from service ACL denial.
 steps.push(prefix+`do $retention_immutable$ declare b text;e text;begin b:=${full};begin
  update public.merchant_attendance_retention_policy_operations set recorded_at=recorded_at where merchant_id=${quote(siteId)} and operation_id=${quote(eventPolicy.operationId)};
  raise exception 'retention_immutable_failed';exception when others then e:=sqlerrm;if e<>'attendance_events_append_only' then raise;end if;end;
  assert ${full}=b,'retention_immutable_changed_facts';end;$retention_immutable$;select jsonb_build_object('kind','immutable','ok',true);`);
 steps.push(prefix+`select jsonb_build_object('kind','counts','policies',(select count(*) from public.merchant_attendance_retention_policy_operations),
  'preservations',(select count(*) from public.merchant_attendance_preservation_operations));set constraints all immediate;rollback;`);
 assert(steps.length<=100,'retention_bounded_steps');
 let rows;const failures=[];
 try{rows=(await native.querySteps(steps.map(s=>scope.sql(s)))).trim().split(/\r?\n/).filter(Boolean).map(s=>JSON.parse(s));}
 catch(error){failures.push(error);}
 finally{
  for(const [label,read,wanted]of [['allfacts',()=>d.fingerprint(names),baseline],['definitions',()=>d.definitions(),definitions],['catalog',()=>d.tableCatalog(),catalog],
   ['old_archive_text',()=>archive().artifactText,oldArchive.artifactText],['old_archive_sha',()=>archive().artifactSha256,oldArchive.artifactSha256],
   ['sealed_archive_text',()=>periodArchive().artifactText,fixed.artifactText],['sealed_archive_sha',()=>periodArchive().artifactSha256,fixed.artifactSha256]]){
   try{assert.equal(read(),wanted,'retention_rollback_'+label);}catch(error){failures.push(error);}
  }
 }
 if(failures.length)throw new AggregateError(failures,'retention_native_failed: '+failures.map(e=>e.message).join(' | '));
 for(const row of rows)if(row.kind==='result'){
  const wanted=expected.get(row.label);assert(wanted,row.label);let c=wanted.c;
  if(wanted.dynamic){c=parseRetentionCommand(row.command);assert.deepEqual({...c,expectedSourceFingerprint:'0'.repeat(64)},wanted.c);}
  else assert.deepEqual(row.command,c);
  checks.set(row.label,projectRetentionResult(row.value,wanted.q,wanted.auth,c));
 }
 assert.equal(checks.size,expected.size);
 assert(checks.get('default_policies').data.items.every(p=>p.revision===0&&p.retentionDays===null));assert.equal(checks.get('unknown_recover').receipt,null);
 for(const q of records){
  const label=q.category;assert.equal(checks.get('record_'+label).data.item.ageState,'unconfigured');
  assert.equal(checks.get('held_'+label).data.item.preservation.held,true);
  assert.deepEqual(checks.get('hold_'+label).receipt,checks.get('recover_'+label).receipt);assert.deepEqual(checks.get('hold_'+label).receipt,checks.get('replay_'+label).receipt);
  assert(checks.get('preview_'+label).data.items.some(item=>item.recordId===q.recordId));
 }
 const serialized=checks.get('location_serialization_zero').data.item,three=checks.get('location_serialization_three').data.item;
 assert.deepEqual(serialized.source,three.source);assert.equal(serialized.sourceFingerprint,three.sourceFingerprint);
 assert.deepEqual(checks.get('history_first25').data.items.map(i=>i.revision),Array.from({length:25},(_,i)=>27-i));assert.equal(checks.get('history_first25').data.nextBeforeRevision,3);
 assert.deepEqual(checks.get('history_last2').data.items.map(i=>i.revision),[2,1]);assert.equal(checks.get('history_last2').data.nextBeforeRevision,null);
 assert.equal(checks.get('released_record').data.item.preservation.held,false);
 assert.equal(checks.get('new_owner_historical_record').data.item.sourceFingerprint,checks.get('record_events').data.item.sourceFingerprint);
 assert.equal(checks.get('new_owner_release_while_paused').receipt.actorId,other);assert.deepEqual(checks.get('old_owner_original_receipt').receipt,checks.get('hold_again').receipt);
 assert.equal(rows.find(r=>r.label==='before_identity').hash,rows.find(r=>r.label==='after_identity').hash);
 assert.equal(rows.filter(r=>r.kind==='rejection').length,rejections);
 assert.deepEqual(rows.find(r=>r.kind==='counts'),{kind:'counts',policies:29,preservations:7});
 if(!meta.locationExists)assert.deepEqual(rows.find(r=>r.kind==='synthetic_location_prerequisite'),{kind:'synthetic_location_prerequisite',count:1});
 native.pass('227 three historical retention categories, metadata-only policy/hold/release and exact actor-bound receipts; history and handoff rollback preserve all facts/archives');
 return {actualMetadataSubmissions:submissions,readsAndReplays:reads,rejections,transactionSteps:steps.length,syntheticPrerequisites:meta.locationExists?0:1,
  syntheticOwnerHandoffAndWorkerRebind:true,actualPositioningCall:false,threeSourcesVerified:true,historyPages:[25,2],unknownOperationRemainsUnknown:true,
  exactFlagOffReceipts:true,noPropagationOrDeletion:true,allReadsAndRejectionsZeroWrites:true,rollbackRestored:true,oldFactsAndArchivesUnchanged:true,
  definitionsAndCatalogUnchanged:true,newCluster:false,browser:false,production:false};
}
