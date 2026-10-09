//223 test-only. Actual176/181 commits are confined to the caller-owned schema.
//The outer lifecycle removes that namespace and proves the persistent baseline;
//this helper deliberately does NOT describe all concurrency writes as rollback.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {assertLifecycleSandbox,lifecycleId as id,lifecycleJson as json,lifecycleRace} from '../merchant-attendance-lifecycle-native-support.mjs';
import {quote} from './attendance-bound-clocks-native.mjs';
import {outageNativeFingerprintSql,outageNativeTables} from './attendance-outage-native.mjs';

const require=createRequire(import.meta.url),relationTable='merchant_attendance_outage_relation_operations';
const startId=id(204710),endId=id(204711),freshPattern=/^00000000-0000-4000-8000-00022310[0-4][0-9]{3}$/;
export const outageRelationRaceWriteTables=Object.freeze([...outageNativeTables,relationTable]);
export const outageRelationRaceGroups=Object.freeze(['apply_apply','apply_revoke','revoke_apply','same_operation','holder_rollback']);
const utc6=value=>new Date(value).toISOString().replace(/Z$/,'000Z');

export function createOutageRelationRacePlan(input,group){
 assert(outageRelationRaceGroups.includes(group));
 for(const key of ['workerVersion','employeeVersion'])assert(Number.isSafeInteger(input[key])&&input[key]>0);
 assert(Number.isSafeInteger(input.generation)&&input.generation>=0);
 const times=['startAt','endAt','now','sealedStart','sealedEnd'].map(key=>Date.parse(input[key]));assert(times.every(Number.isFinite));
 const [a,b,now,sealedA,sealedB]=times;assert(a<b&&b<now&&b-a<=31*86400000&&sealedA<sealedB);
 assert(!(a<sealedB&&b>sealedA),'outage_relation_race_existing_sealed_frame_overlap');
 const fresh=n=>{assert(Number.isInteger(n)&&n>0&&n<1000);return id(223100000+outageRelationRaceGroups.indexOf(group)*1000+n);};
 const interval={startAt:utc6(a),endAt:utc6(b),timeZone:'UTC',startOffsetMinutes:0,endOffsetMinutes:0};
 const incident={action:'create_incident',operationId:fresh(1),incidentId:fresh(2),type:'network',channel:'web',locationId:input.location,
  interval,reason:'Synthetic223 pair concurrency; not merged facts or a clock result'};
 const declaration=n=>({action:'declare',operationId:fresh(n),declarationId:fresh(n+1),incidentId:incident.incidentId,
  workerId:input.worker,employeeId:input.employee,employeeAuthUserId:input.auth,expectedWorkerVersion:input.workerVersion,
  expectedEmployeeVersion:input.employeeVersion,expectedGeneration:input.generation,interval,
  statement:'Synthetic223 independent statement '+group+' '+n,originalOperationId:null,originalChannel:null,paperReference:null});
 const left=declaration(3),right=declaration(5),seed=group==='apply_revoke'||group==='revoke_apply';
 const q=(mode='detail',access='owner',reverse=false,value=null)=>({siteId:input.site,access,mode,declarationId:reverse?right.declarationId:left.declarationId,
  ...(mode==='list'?{}:{relatedDeclarationId:reverse?left.declarationId:right.declarationId}),
  ...(mode==='history'?{beforeRevision:value}:mode==='recover'?{operationId:value}:{})});
 return {group,fresh,incident,left,right,q,seed,operationIds:[1,3,5,...(seed?[10]:[]),11,...(group==='same_operation'?[]:[12])].map(fresh)};
}

//Exact table + merchant + new operation allow-list, not an entire table/range.
//All earlier rows in the permitted tables stay inside the hash as well.
export function outageRelationRaceProtectedSql(names,site,allowed={}){
 assert(Array.isArray(names)&&names.length&&new Set(names).size===names.length);assert(/^\d{8}$/.test(site));
 for(const [name,ids]of Object.entries(allowed)){
  assert(outageRelationRaceWriteTables.includes(name)&&names.includes(name));assert(Array.isArray(ids)&&new Set(ids).size===ids.length);
  for(const op of ids)assert(freshPattern.test(op),'outage_relation_race_exact223_operation');
 }
 return '(select md5(jsonb_object_agg(relation_name,relation_rows order by relation_name)::text) from ('+names.map(name=>{
  assert(/^(?:merchants|faolla_schema_migrations|merchant_[a-z0-9_]+)$/.test(name)&&name.length<=63);
  const ids=allowed[name]??[],where=ids.length?` where not (relation_row.merchant_id=${quote(site)} and relation_row.operation_id=any(array[${ids.map(op=>quote(op)+'::uuid').join(',')}]::uuid[]))`:'';
  return `select ${quote(name)} relation_name,(select coalesce(jsonb_agg(to_jsonb(relation_row) order by to_jsonb(relation_row)::text),'[]') from public.${name} relation_row${where}) relation_rows`;
 }).join(' union all ')+') outage_relation_protected_facts)';
}
export function outageRelationRaceAllowances(...writes){
 const allowed={};assert(writes.length>0);
 for(const {kind,c}of writes){
  assert(c&&freshPattern.test(c.operationId));let names;
  if(kind==='relations'){assert(['apply','revoke'].includes(c.action));names=[relationTable];}
  else{assert.equal(kind,'outage');assert(['create_incident','declare'].includes(c.action));names=['merchant_attendance_outage_operations',
   c.action==='create_incident'?'merchant_attendance_outage_incidents':'merchant_attendance_outage_declarations'];}
  for(const name of names){allowed[name]??=[];if(!allowed[name].includes(c.operationId))allowed[name].push(c.operationId);}
 }
 return allowed;
}

export async function verifyAttendanceOutageRelationsRacesNative(ctx){
 const {d,h,native,scope,period,pq,periodId,archive,oldArchive,periodArchive,outageRelationsFoundation}=ctx;
 assert(d?.syntheticOnly===true&&h?.syntheticOnly===true);assert.equal(outageRelationsFoundation?.phase,222);
 assert.equal(outageRelationsFoundation.rollbackRestored,true);assert.equal(typeof native.connect,'function');
 const owned=assertLifecycleSandbox(sql=>native.query(scope.sql(sql)));assert.deepEqual(owned,d.owned);assert.equal(owned.schema,scope.schema);
 const prefix="reset role;set local time zone 'UTC';set local datestyle='ISO, YMD';"+d.guard,exec=sql=>d.exec(prefix+sql);
 const names=d.inventory(),defs=d.definitions(),catalog=d.tableCatalog(),savedArchive=periodArchive(),frame=JSON.parse(savedArchive.artifactText).period;
 for(const name of outageRelationRaceWriteTables)assert(names.includes(name));
 const allSql=outageNativeFingerprintSql(names),all=()=>exec('select '+allSql+';');let reads=0,submissions=0,rejections=0,replays=0,rolledBackSuccessfulCommands=0;
 const readPeriod=async()=>{const before=all(),value=await period(pq('detail','owner',periodId));assert.equal(all(),before);reads++;return value;};
 const periodBefore=await readPeriod();assert(periodBefore.period.sealed);assert.equal(periodBefore.sourceChanged,false);
 const beforeProfile=all(),profile=JSON.parse(exec(`select jsonb_build_object('workerVersion',w.version,'employeeVersion',e.version,'generation',coalesce(ep.generation,0),
  'now',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'session',public.faolla_attendance_period_session_v1(${quote(d.site)},w.id,${quote(startId)},e.id,e.auth_user_id,clock_timestamp()))
  from public.merchant_attendance_workers w join public.merchant_enterprise_employees e on e.merchant_id=w.merchant_id and e.id=w.employee_id
  left join public.merchant_attendance_account_epochs ep on ep.merchant_id=e.merchant_id and ep.employee_id=e.id
  where w.merchant_id=${quote(d.site)} and w.id=${quote(h.workerId)} and e.id=${quote(h.employeeId)} and e.auth_user_id=${quote(h.employeeAuthUserId)}
   and w.active and e.status='active' and not coalesce(ep.paused,false);`));
 assert.equal(all(),beforeProfile,'outage_relation_profile_zero_writes');reads++;assert(profile?.session);
 const events=profile.session.item.events;assert.deepEqual(events.map(e=>[e.id,e.sequence,e.action]),[[startId,3,'clock_in'],[endId,4,'clock_out']]);
 assert.equal(profile.session.ruleBinding.employeeId,h.employeeId);assert.equal(profile.session.ruleBinding.employeeAuthUserId,h.employeeAuthUserId);
 const input={...profile,site:d.site,worker:h.workerId,employee:h.employeeId,auth:h.employeeAuthUserId,location:h.slot.locationId,
  startAt:events[0].occurredAt,endAt:events[1].occurredAt,sealedStart:frame.startAt,sealedEnd:frame.endAt};
 const plans=outageRelationRaceGroups.map(group=>createOutageRelationRacePlan(input,group));
 const allIds=plans.flatMap(p=>p.operationIds);assert.equal(new Set(allIds).size,allIds.length);
 const spec=(kind,q,c=null,allow=true)=>({kind,q,c,allow,actor:q.access==='self'?h.employeeAuthUserId:d.owner});
 const plannedWrites=plans.flatMap(p=>[
  {kind:'outage',c:p.incident},{kind:'outage',c:p.left},{kind:'outage',c:p.right},
  ...p.operationIds.filter(op=>![p.incident.operationId,p.left.operationId,p.right.operationId].includes(op)).map(operationId=>({kind:'relations',c:{action:'apply',operationId}})),
 ]);
 const allowed=outageRelationRaceAllowances(...plannedWrites),protectedSql=outageRelationRaceProtectedSql(names,d.site,allowed),protectedBefore=exec('select '+protectedSql+';');
 exec(`do $relation_race_guard$ begin
  assert not exists(select 1 from pg_trigger t join pg_class c on c.oid=t.tgrelid where c.relnamespace=${owned.oid} and t.tgenabled<>'O'),'outage_relation_guards_enabled';
  ${outageRelationRaceWriteTables.map(name=>`assert exists(select 1 from pg_class c where c.oid='public.${name}'::regclass and c.relnamespace=${owned.oid} and c.relowner::regrole::text='postgres' and c.relrowsecurity),'outage_relation_owned_table';
   assert not exists(select 1 from pg_constraint c where c.conrelid='public.${name}'::regclass and not c.convalidated),'outage_relation_constraints_valid';
   assert not exists(select 1 from public.${name} where operation_id=any(array[${allIds.map(op=>quote(op)+'::uuid').join(',')}]::uuid[])),'outage_relation_fresh_operations';`).join('\n')}
  assert has_function_privilege('service_role','public.faolla_attendance_outage_relations_v1(jsonb,uuid,jsonb,boolean)','EXECUTE');
  assert not has_table_privilege('service_role','public.${relationTable}','INSERT,UPDATE,DELETE,TRUNCATE');end;$relation_race_guard$;`);
 const projectors={outage:require('../../src/lib/merchantAttendanceOutage.server.ts').projectOutageResult,
  relations:require('../../src/lib/merchantAttendanceOutageRelations.server.ts').projectOutageRelationsResult};
 const functions={outage:'faolla_attendance_outage_v1',relations:'faolla_attendance_outage_relations_v1'};
 const committed=new Map(),groups=[];
 const statement=(s,appends={},withHash=false)=>{
  const protectedFacts=outageRelationRaceProtectedSql(names,d.site,appends);
  return prefix+`do $relation_race_call$ declare relation_before text;relation_value jsonb;begin
   relation_before:=${protectedFacts};set local role service_role;
   relation_value:=public.${functions[s.kind]}(${json(s.q)},${quote(s.actor)},${json(s.c)},${s.allow});
   set constraints all immediate;set constraints all deferred;reset role;
   assert relation_before=${protectedFacts},'outage_relation_exact_append_only';
   perform set_config('faolla.outage223_relation_value',relation_value::text,true);end;$relation_race_call$;
   select current_setting('faolla.outage223_relation_value')::jsonb;${withHash?'select '+allSql+';':''}`;
 };
 const parse=(s,output)=>{try{return projectors[s.kind](JSON.parse(String(output).trim()),s.q,s.actor,s.c);}
  catch(error){throw new Error('outage_relation_race_projection:'+s.kind+':'+(s.c?.action??s.q.mode)+':'+String(error),{cause:error});}};
 const record=(s,value)=>{assert(s.c&&value.receipt&&!committed.has(s.c.operationId));committed.set(s.c.operationId,{...s,receipt:value.receipt});submissions++;return value;};
 const call=(s,replay=false)=>{const value=parse(s,exec(statement(s,s.c&&!replay?outageRelationRaceAllowances(s):{})));
  if(s.c&&!replay)record(s,value);else if(replay)replays++;else reads++;return value;};
 const command=(p,n,action,view,kind='possible_duplicate')=>({action,operationId:p.fresh(n),expectedRevision:view.revision,
  expectedFingerprint:action==='apply'?view.preview.fingerprint:view.current.fingerprint,
  ...(action==='apply'?{kind}:{}),reason:'Synthetic223 explicit '+action+' '+p.group+' '+n});
 const preserve=()=>{
  assert.equal(exec('select '+protectedSql+';'),protectedBefore,'outage_relation_old_or_unauthorized_facts_changed');
  assert.equal(d.definitions(),defs);assert.equal(d.tableCatalog(),catalog);
  assert.equal(archive().artifactText,oldArchive.artifactText);assert.equal(archive().artifactSha256,oldArchive.artifactSha256);
  assert.equal(periodArchive().artifactText,savedArchive.artifactText);assert.equal(periodArchive().artifactSha256,savedArchive.artifactSha256);
 };
 const assertNoRow=operationId=>assert.equal(exec(`select count(*) from public.${relationTable} where merchant_id=${quote(d.site)} and operation_id=${quote(operationId)};`),'0');
 try{
  for(const p of plans){
   call(spec('outage',{siteId:d.site,access:'owner',mode:'incident',incidentId:p.incident.incidentId},p.incident));
   for(const c of [p.left,p.right])call(spec('outage',{siteId:d.site,access:'owner',mode:'declaration',declarationId:c.declarationId},c));
   let view=call(spec('relations',p.q()));assert.equal(view.revision,0);assert(view.preview.eligible);assert(view.canWrite);
   if(p.seed){call(spec('relations',p.q(),command(p,10,'apply',view)));view=call(spec('relations',p.q()));assert.equal(view.revision,1);}
   const reverse=call(spec('relations',p.q('detail','owner',true)));assert.equal(reverse.revision,view.revision);
   assert.deepEqual(reverse.current,view.current);assert.deepEqual(reverse.preview,view.preview);assert(reverse.preview.eligible);
   const holderAction=p.group==='revoke_apply'?'revoke':'apply',waiterAction=p.group==='apply_revoke'?'revoke':'apply';
   const holder=spec('relations',p.q(),command(p,11,holderAction,view));
   //Same-operation replay keeps the ORIGINAL query direction and exact command;
   //all other waiters use the reverse direction of the same canonical pair.
   const same=p.group==='same_operation',rollback=p.group==='holder_rollback';
   const waiter=same?{...holder,allow:false}:spec('relations',p.q('detail','owner',true),command(p,12,waiterAction,reverse,'complementary'));
   assert.equal(holder.c.expectedRevision,waiter.c.expectedRevision);assert.equal(holder.c.expectedFingerprint,waiter.c.expectedFingerprint);
   const raced=await lifecycleRace({connect:()=>native.connect(),query:sql=>native.query(sql),sql:scope.sql},
    statement(holder,outageRelationRaceAllowances(holder),true),statement(waiter,outageRelationRaceAllowances(waiter)),{rollback});
   assert.equal(raced.witnessed,true,p.group);
   const lines=raced.left.trim().split(/\r?\n/),holderHash=lines.pop();assert.match(holderHash,/^[0-9a-f]{32}$/);assert.equal(lines.length,1);
   const holderValue=parse(holder,lines[0]);let winner;
   if(rollback){
    rolledBackSuccessfulCommands++;assert.equal(raced.right.error,null);assertNoRow(holder.c.operationId);
    winner=record(waiter,parse(waiter,raced.right.output));assert.equal(winner.receipt.entry.revision,1);
    const before=all(),recovery=spec('relations',p.q('recover','owner',false,holder.c.operationId),null,false);
    assert.throws(()=>exec(statement(recovery)),error=>/ERROR:\s+attendance_outage_relations_not_found(?:\s|$)/.test(String(error)));
    assert.equal(all(),before,'outage_relation_rolled_back_receipt_read_zero_writes');rejections++;
   }else{
    winner=record(holder,holderValue);
    if(same){
     assert.equal(raced.right.error,null);const replayed=parse(waiter,raced.right.output);assert.deepEqual(replayed.receipt,holderValue.receipt);
     assert.equal(all(),holderHash,'outage_relation_concurrent_replay_zero_writes');replays++;
    }else{
     assert(raced.right.error);assert.equal(raced.right.output,null);
     assert.match(String(raced.right.error),/ERROR:\s+attendance_outage_relations_changed(?:\s|$)/);
     assert.equal(all(),holderHash,'outage_relation_failed_waiter_zero_writes');assertNoRow(waiter.c.operationId);rejections++;
    }
   }
   const current=call(spec('relations',p.q())),other=call(spec('relations',p.q('detail','self',true)));
   assert.equal(current.revision,p.seed?2:1);assert.deepEqual(current.current,winner.receipt.entry);assert.deepEqual(other.current,current.current);
   const history=call(spec('relations',p.q('history'))),selfHistory=call(spec('relations',p.q('history','self',true)));
   assert.deepEqual(history.history,selfHistory.history);assert.deepEqual(history.history.map(e=>e.revision),p.seed?[2,1]:[1]);assert.equal(history.historyTruncated,false);
   const originals=[...committed.values()].filter(s=>s.kind==='relations'&&[p.left.declarationId,p.right.declarationId].includes(s.q.declarationId));
   for(const original of originals){
    const recover={...original.q,mode:'recover',operationId:original.c.operationId};
    assert.deepEqual(call(spec('relations',recover,null,false)).receipt,original.receipt);
    assert.deepEqual(call({...original,allow:false},true).receipt,original.receipt);
   }
   groups.push({group:p.group,exactPidWitnessed:true,holderAction,holderCommitted:!rollback,
    waiterAction,waiterCommitted:rollback||same,waiterNewEntry:rollback,waiterReplay:same,waiterError:!rollback&&!same?'attendance_outage_relations_changed':null,
    finalRevision:current.revision,finalAction:current.current.action,originalReceiptStable:true});preserve();
  }
  const periodAfter=await readPeriod();assert.deepEqual(periodAfter.period,periodBefore.period);assert.equal(periodAfter.sourceChanged,false);
  const counts=JSON.parse(exec('select jsonb_build_object('+outageRelationRaceWriteTables.map(name=>quote(name)+`,(select count(*) from public.${name} where merchant_id=${quote(d.site)} and operation_id=any(array[${allIds.map(op=>quote(op)+'::uuid').join(',')}]::uuid[]))`).join(',')+');'));
  assert.deepEqual(counts,{merchant_attendance_outage_incidents:5,merchant_attendance_outage_declarations:10,merchant_attendance_outage_operations:15,
   merchant_attendance_outage_relation_operations:7});
  assert.equal(committed.size,22);assert.equal(submissions,22);assert.equal(rejections,4);assert.equal(rolledBackSuccessfulCommands,1);assert.equal(replays,8);
  for(const op of allIds.filter(op=>!committed.has(op)))for(const name of outageRelationRaceWriteTables)
   assert.equal(exec(`select count(*) from public.${name} where merchant_id=${quote(d.site)} and operation_id=${quote(op)};`),'0');
  preserve();native.pass('223 five exact-PID181 canonical-pair CAS, directed exact replay and holder rollback races; original facts and archives unchanged');
  return {groups,exactPidRaces:5,reads,submissions,rejections,casRejections:3,rollbackReceiptNotFound:1,replays,rolledBackSuccessfulCommands,committedRows:counts,
   preexistingRowsUnchanged:true,allReadsAndReplaysZeroWrites:true,failedWaitersZeroWrites:true,rolledBackHolderAbsent:true,
   definitionsAndCatalogUnchanged:true,old155ArchivePreserved:true,actualSealedArchivePreserved:true,newClockRows:0,
   committedOnlyInCallerOwnedSchema:true,allTransactionsRolledBack:false,cleanupByOuterOwnedSchema:true,browser:false,productionAccess:false,newCluster:false};
 }finally{preserve();}
}
