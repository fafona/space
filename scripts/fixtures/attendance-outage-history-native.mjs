//219 inert caller-owned history probes. Every new row comes from176/177/178.
//Existing218 committed synthetic facts are retained; one querySteps transaction
//rolls back ONLY this helper's new history after owner/self paging and recovery.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {assertLifecycleSandbox,lifecycleId as id,lifecycleJson as json} from '../merchant-attendance-lifecycle-native-support.mjs';
import {quote} from './attendance-bound-clocks-native.mjs';
import {outageNativeFingerprintSql,outageNativeTables} from './attendance-outage-native.mjs';
import {outageLinksNativeTables} from './attendance-outage-links-native.mjs';
import {outageReviewsNativeTables} from './attendance-outage-reviews-native.mjs';
const require=createRequire(import.meta.url),fresh=n=>id(219100000+n),startId=id(204710),endId=id(204711);
const tables=[...outageNativeTables,...outageLinksNativeTables,...outageReviewsNativeTables];
const stamp=v=>new Date(v).toISOString().replace(/Z$/,'000Z');
export function createOutageHistoryNativePlan(input){
 for(const n of [input.workerVersion,input.employeeVersion])assert(Number.isSafeInteger(n)&&n>0);
 assert(Number.isSafeInteger(input.generation)&&input.generation>=0);
 const interval={startAt:stamp(input.startAt),endAt:stamp(input.endAt),timeZone:'UTC',startOffsetMinutes:0,endOffsetMinutes:0};
 assert(Date.parse(interval.startAt)<Date.parse(interval.endAt)&&Date.parse(interval.endAt)<Date.parse(input.now));
 assert(!(Date.parse(interval.startAt)<Date.parse(input.sealedEnd)&&Date.parse(interval.endAt)>Date.parse(input.sealedStart)),
  'outage_history_new_range_excludes_existing_seal');
 const incident={action:'create_incident',operationId:fresh(1),incidentId:fresh(2),type:'network',channel:'web',locationId:input.location,
  interval,reason:'Synthetic219 dedicated history incident, not work reconstruction'};
 const declaration={action:'declare',operationId:fresh(3),declarationId:fresh(4),incidentId:incident.incidentId,workerId:input.worker,
  employeeId:input.employee,employeeAuthUserId:input.auth,expectedWorkerVersion:input.workerVersion,expectedEmployeeVersion:input.employeeVersion,
  expectedGeneration:input.generation,interval,statement:'Synthetic219 independent statement for bounded history paging',
  originalOperationId:null,originalChannel:null,paperReference:null};
 const query=(mode='detail',access='owner',cursor=null)=>({siteId:input.site,access,mode,declarationId:declaration.declarationId,
  ...(mode==='history'?{beforeRevision:cursor}:mode==='recover'?{operationId:cursor}:{})});
 const operation=(kind,revision)=>{assert(['links','review'].includes(kind));assert(Number.isInteger(revision)&&revision>=1&&revision<=27);return fresh((kind==='links'?100:200)+revision);};
 const reference={kind:'session',startEventId:startId,lastEventId:endId,lastSequence:4,effectOperationId:null,effectRevision:null};
 return {incident,declaration,query,operation,reference,operationIds:[incident.operationId,declaration.operationId,
  ...Array.from({length:27},(_,i)=>operation('links',i+1)),...Array.from({length:27},(_,i)=>operation('review',i+1))]};
}

export function outageHistoryProtectedSql(names,site,op){
 assert(Array.isArray(names)&&names.length&&new Set(names).size===names.length);assert(/^\d{8}$/.test(site));
 assert(/^00000000-0000-4000-8000-000219100[0-9]{3}$/.test(op));
 return '(select md5(jsonb_object_agg(history_name,history_rows order by history_name)::text) from ('+names.map(name=>{
  assert(/^(?:merchants|faolla_schema_migrations|merchant_[a-z0-9_]+)$/.test(name)&&name.length<=63);
  const where=tables.includes(name)?` where not (history_row.merchant_id=${quote(site)} and history_row.operation_id=${quote(op)}::uuid)`:'';
  return `select ${quote(name)} history_name,(select coalesce(jsonb_agg(to_jsonb(history_row) order by to_jsonb(history_row)::text),'[]') from public.${name} history_row${where}) history_rows`;
 }).join(' union all ')+') outage_history_facts)';
}

export async function verifyAttendanceOutageHistoryNative(ctx){
 const {d,h,native,scope,period,pq,periodId,archive,oldArchive,periodArchive}=ctx;
 assert(d?.syntheticOnly===true&&h?.syntheticOnly===true);assert.equal(typeof native.querySteps,'function');
 const owned=assertLifecycleSandbox(sql=>native.query(scope.sql(sql)));assert.deepEqual(owned,d.owned);assert.equal(owned.schema,scope.schema);
 const initialPeriod=await period(pq('detail','owner',periodId));assert.equal(initialPeriod.period.sealed,true);
 const baseline=d.fingerprint(),defs=d.definitions(),catalog=d.tableCatalog(),names=d.inventory(),savedArchive=periodArchive();
 for(const name of tables)assert(names.includes(name));
 const fullHash=outageNativeFingerprintSql(names),prefix="reset role;set local time zone 'UTC';set local datestyle='ISO, YMD';"+d.guard;
 const exec=sql=>d.exec(prefix+sql),fmt='YYYY-MM-DD"T"HH24:MI:SS.US"Z"';
 const profile=JSON.parse(exec(`select jsonb_build_object('workerVersion',w.version,'employeeVersion',e.version,'generation',coalesce(ep.generation,0),
  'now',to_char(clock_timestamp() at time zone 'UTC',${quote(fmt)}),
  'session',public.faolla_attendance_period_session_v1(${quote(d.site)},w.id,${quote(startId)},e.id,e.auth_user_id,clock_timestamp()))
  from public.merchant_attendance_workers w join public.merchant_enterprise_employees e on e.merchant_id=w.merchant_id and e.id=w.employee_id
  left join public.merchant_attendance_account_epochs ep on ep.merchant_id=e.merchant_id and ep.employee_id=e.id
  where w.merchant_id=${quote(d.site)} and w.id=${quote(h.workerId)} and e.id=${quote(h.employeeId)} and e.auth_user_id=${quote(h.employeeAuthUserId)}
   and w.active and e.status='active' and not coalesce(ep.paused,false);`));
 assert.equal(d.fingerprint(),baseline);assert(profile?.session);const events=profile.session.item.events;
 assert.deepEqual(events.map(x=>[x.id,x.sequence,x.action]),[[startId,3,'clock_in'],[endId,4,'clock_out']]);
 assert.equal(profile.session.item.effect,null);assert.equal(profile.session.ruleBinding.employeeId,h.employeeId);
 assert.equal(profile.session.ruleBinding.employeeAuthUserId,h.employeeAuthUserId);
 const frame=JSON.parse(savedArchive.artifactText).period;
 const p=createOutageHistoryNativePlan({site:d.site,worker:h.workerId,employee:h.employeeId,auth:h.employeeAuthUserId,location:h.slot.locationId,
  ...profile,startAt:events[0].occurredAt,endAt:events[1].occurredAt,sealedStart:frame.startAt,sealedEnd:frame.endAt});
 const steps=[],expected=new Map();let reads=0,submissions=0,rejections=0,replays=0;
 const saved=label=>`(current_setting(${quote('faolla.outage219_'+label)})::jsonb->'value')`;
 const savedCommand=label=>`(current_setting(${quote('faolla.outage219_'+label)})::jsonb->'command')`;
 const rpc={outage:'faolla_attendance_outage_v1',links:'faolla_attendance_outage_links_v1',review:'faolla_attendance_outage_review_v1'};
 const call=(label,{kind='review',query=json(p.query()),access='owner',command='null',op=null,allow=true,replay=false,error=null}={})=>{
  assert(/^[a-z][a-z0-9_]*$/.test(label)&&!expected.has(label));assert(Object.hasOwn(rpc,kind));
  assert(!op||p.operationIds.includes(op));const actor=access==='self'?h.employeeAuthUserId:d.owner;
  const write=op!==null&&!replay&&!error,hash=write?outageHistoryProtectedSql(names,d.site,op):fullHash;
  expected.set(label,{kind,error,write,replay});if(error)rejections++;else if(write)submissions++;else{reads++;if(replay)replays++;}
  const expression=`public.${rpc[kind]}(history_query,${quote(actor)},history_command,${allow})`;
  steps.push(prefix+`do $outage_history_call$ declare history_before text;history_after text;history_value jsonb;history_query jsonb;history_command jsonb;history_error text;begin
   history_before:=${hash};history_query:=${query};history_command:=${command};
   ${error?`begin set local role service_role;perform ${expression};raise exception 'outage_history_expected_rejection_missing';
    exception when others then history_error:=sqlerrm;if history_error<>${quote(error)} then raise;end if;end;`:`set local role service_role;history_value:=${expression};`}
   set constraints all immediate;set constraints all deferred;reset role;history_after:=${hash};
   assert history_before=history_after,'outage_history_read_rejection_or_preexisting_rows_changed';
   perform set_config(${quote('faolla.outage219_'+label)},jsonb_build_object('label',${quote(label)},'kind',${quote(kind)},'query',history_query,'command',history_command,
    'actor',${quote(actor)},'value',history_value,'error',history_error,'before',history_before,'after',history_after)::text,true);
   end;$outage_history_call$;select current_setting(${quote('faolla.outage219_'+label)})::jsonb;`);
 };
 //Only fresh219 identifiers are absent. Existing218 declarations, histories,
 //periods and all their records remain part of every full/protected hash.
 steps.push('begin;'+prefix+`do $outage_history_start$ begin
  assert not exists(select 1 from pg_trigger t join pg_class c on c.oid=t.tgrelid where c.relnamespace=${owned.oid} and t.tgenabled<>'O'),'outage_history_guards_enabled';
  ${tables.map(name=>`assert exists(select 1 from pg_class c where c.oid='public.${name}'::regclass and c.relnamespace=${owned.oid} and c.relowner::regrole::text='postgres' and c.relrowsecurity),'outage_history_owned_table';
   assert not exists(select 1 from pg_constraint c where c.conrelid='public.${name}'::regclass and not c.convalidated),'outage_history_valid_constraints';
   assert not exists(select 1 from public.${name} where operation_id=any(array[${p.operationIds.map(x=>quote(x)+'::uuid').join(',')}]::uuid[])),'outage_history_fresh_ids_required';`).join('\n')}
  end;$outage_history_start$;`);
 call('incident',{kind:'outage',query:json({siteId:d.site,access:'owner',mode:'incident',incidentId:p.incident.incidentId}),command:json(p.incident),op:p.incident.operationId});
 call('declaration',{kind:'outage',query:json({siteId:d.site,access:'owner',mode:'declaration',declarationId:p.declaration.declarationId}),command:json(p.declaration),op:p.declaration.operationId});
 call('links_preview',{kind:'links',query:json({...p.query(),mode:'preview',sources:[p.reference]})});
 const linkWrite=n=>call('links_write_'+n,{kind:'links',op:p.operation('links',n),command:`jsonb_build_object('action','apply','operationId',${quote(p.operation('links',n))},
  'expectedRevision',${n===1?saved('links_preview')+"->'revision'":saved('links_write_'+(n-1))+"->'receipt'->'entry'->'revision'"},
  'expectedFingerprint',${saved('links_preview')}->'preview'->'fingerprint','sources',${json([p.reference])},'reason','Synthetic219 explicit same-source history revision')`});
 const history=(kind,label,access,cursor=null)=>call(label,{kind,access,allow:false,query:json(p.query('history',access,cursor))});
 const page=(kind,label,access)=>call(label,{kind,access,allow:false,
  query:`${json(p.query('history',access))}||jsonb_build_object('beforeRevision',${saved(kind+'_at26_'+access)}->'history'->-1->'revision')`});
 const tail=(kind,label,access)=>call(label,{kind,access,allow:false,
  query:`${json(p.query('history',access))}||jsonb_build_object('beforeRevision',${saved(kind+'_tail_'+access)}->'history'->-1->'revision')`});
 const boundaries=kind=>{
  for(const access of ['owner','self'])page(kind,kind+'_tail_'+access,access);
  for(const access of ['owner','self'])tail(kind,kind+'_end_'+access,access);
  history(kind,kind+'_fresh','owner');history(kind,kind+'_old_anchor','owner',27);
  call(kind+'_cursor_zero',{kind,query:json(p.query('history','owner',0)),allow:false,error:'attendance_invalid_request'});
  call(kind+'_cursor_over_limit',{kind,query:json(p.query('history','owner',kind==='links'?102:1002)),allow:false,error:'attendance_invalid_request'});
 };
 for(let n=1;n<=25;n++)linkWrite(n);
 for(const access of ['owner','self'])history('links','links_at25_'+access,access);
 linkWrite(26);for(const access of ['owner','self'])history('links','links_at26_'+access,access);
 linkWrite(27);boundaries('links');
 call('links_original_recover',{kind:'links',query:json(p.query('recover','owner',p.operation('links',1))),allow:false});
 call('links_original_replay',{kind:'links',command:savedCommand('links_write_1'),op:p.operation('links',1),allow:false,replay:true});

 call('review_initial');
 const reviewWrite=n=>{
  const action=n%2?'propose':'confirm',access=action==='confirm'?'self':'owner',previous=n===1?saved('review_initial'):saved('review_write_'+(n-1));
  call('review_write_'+n,{kind:'review',access,query:json(p.query('detail',access)),op:p.operation('review',n),
   command:`jsonb_build_object('action',${quote(action)},'operationId',${quote(p.operation('review',n))},
    'expectedRevision',${previous}${n===1?"->'revision'":"->'receipt'->'entry'->'revision'"},
    'expectedResultVersion',${previous}${n===1?"->'resultVersion'":"->'receipt'->'entry'->'resultVersion'"},
    'expectedFingerprint',${action==='propose'?saved('review_initial')+"->'status'->'basisFingerprint'":previous+"->'receipt'->'proposal'->'resultFingerprint'"},
    'reason',${quote('Synthetic219 explicit '+action+' history step')})`});
 };
 for(let n=1;n<=25;n++)reviewWrite(n);
 for(const access of ['owner','self'])history('review','review_at25_'+access,access);
 reviewWrite(26);for(const access of ['owner','self'])history('review','review_at26_'+access,access);
 reviewWrite(27);boundaries('review');
 for(const [n,access]of [[1,'owner'],[2,'self']]){
  call('review_original_recover_'+access,{query:json(p.query('recover',access,p.operation('review',n))),access,allow:false});
  call('review_original_replay_'+access,{query:json(p.query('detail',access)),command:savedCommand('review_write_'+n),op:p.operation('review',n),access,allow:false,replay:true});
 }
 steps.push(prefix+`set constraints all immediate;select jsonb_build_object('kind','counts',${tables.map(name=>quote(name)+`,(select count(*) from public.${name} where operation_id=any(array[${p.operationIds.map(x=>quote(x)+'::uuid').join(',')}]::uuid[]))`).join(',')});rollback;`);
 assert.equal(steps.length,90);assert(steps.length<=100);let rows;const failures=[];
 try{rows=(await native.querySteps(steps.map(sql=>scope.sql(sql)))).trim().split(/\r?\n/).filter(Boolean).map(x=>JSON.parse(x));}
 catch(error){failures.push(new Error('outage_history_actual_sql_failed:'+String(error?.message??error),{cause:error}));}
 finally{
  for(const [label,read,want]of [['facts',()=>d.fingerprint(),baseline],['definitions',()=>d.definitions(),defs],['catalog',()=>d.tableCatalog(),catalog],
   ['old155_text',()=>archive().artifactText,oldArchive.artifactText],['old155_sha',()=>archive().artifactSha256,oldArchive.artifactSha256],
   ['sealed_text',()=>periodArchive().artifactText,savedArchive.artifactText],['sealed_sha',()=>periodArchive().artifactSha256,savedArchive.artifactSha256]]){
   try{assert.equal(read(),want,'outage_history_rollback_'+label);}catch(error){failures.push(error);}
  }
 }
 if(failures.length)throw new AggregateError(failures,'outage_history_native_failed:'+failures.map(e=>e.message).join(' | '));
 const {projectOutageResult}=require('../../src/lib/merchantAttendanceOutage.server.ts');
 const {projectOutageLinksResult}=require('../../src/lib/merchantAttendanceOutageLinks.server.ts');
 const {projectOutageReviewResult}=require('../../src/lib/merchantAttendanceOutageReview.server.ts');
 const projectors={outage:projectOutageResult,links:projectOutageLinksResult,review:projectOutageReviewResult},parsed=new Map(),raw=new Map();
 for(const row of rows){if(!row.label)continue;const spec=expected.get(row.label);assert(spec);assert.equal(row.before,row.after);assert.equal(row.error,spec.error);raw.set(row.label,row);
  if(row.error)continue;
  try{parsed.set(row.label,projectors[row.kind](row.value,row.query,row.actor,row.command));}
  catch(error){throw new Error('outage_history_projection:'+row.label+':'+String(error),{cause:error});}
 }
 assert.equal(raw.size,expected.size);assert.equal(rows.filter(x=>x.error).length,4);
 assert.deepEqual(rows.find(x=>x.kind==='counts'),{kind:'counts',merchant_attendance_outage_incidents:1,merchant_attendance_outage_declarations:1,
  merchant_attendance_outage_operations:2,merchant_attendance_outage_link_operations:27,merchant_attendance_outage_review_operations:27});
 for(const kind of ['links','review']){
  for(let n=1;n<=27;n++){
   const value=parsed.get(kind+'_write_'+n);assert.equal(value.receipt.entry.revision,n);assert.equal(value.receipt.operationId,p.operation(kind,n));
   if(kind==='review'){assert.equal(value.resultVersion,Math.ceil(n/2));assert.equal(value.receipt.entry.action,n%2?'propose':'confirm');
    assert.equal(value.receipt.entry.actorId,n%2?d.owner:h.employeeAuthUserId);}
  }
  for(const access of ['owner','self']){
   const first25=parsed.get(kind+'_at25_'+access),first26=parsed.get(kind+'_at26_'+access),last=parsed.get(kind+'_tail_'+access),end=parsed.get(kind+'_end_'+access);
   assert.equal(first25.history.length,25);assert.equal(first25.historyTruncated,false);assert.equal(first25.revision,25);
   assert.equal(first26.history.length,25);assert.equal(first26.historyTruncated,true);assert.equal(first26.revision,26);
   assert.deepEqual(first26.history.map(x=>x.revision),Array.from({length:25},(_,i)=>26-i));
   assert.equal(raw.get(kind+'_tail_'+access).query.beforeRevision,first26.history.at(-1).revision);
   assert.deepEqual(last.history.map(x=>x.revision),[1]);assert.equal(last.historyTruncated,false);assert.equal(last.revision,27);
   assert.equal(raw.get(kind+'_end_'+access).query.beforeRevision,1);assert.deepEqual(end.history,[]);assert.equal(end.historyTruncated,false);
   const chain=[...first26.history,...last.history];assert.deepEqual(chain.map(x=>x.revision),Array.from({length:26},(_,i)=>26-i));
   assert.equal(new Set(chain.map(x=>x.operationId)).size,26);
   assert.deepEqual(chain.map(x=>x.operationId),Array.from({length:26},(_,i)=>p.operation(kind,26-i)));
   for(const value of [first25,first26,last,end]){
    assert.equal(value.canWrite,false);assert.equal(value.current,null);assert.equal(value.receipt,null);
    if(kind==='review'){assert.equal(value.proposal,null);assert.equal(value.response,null);assert.equal(value.status,null);}
    else assert.equal(value.preview,null);
   }
  }
  for(const suffix of ['at25','at26','tail','end'])assert.deepEqual(parsed.get(kind+'_'+suffix+'_owner').history,parsed.get(kind+'_'+suffix+'_self').history);
  assert.deepEqual(parsed.get(kind+'_fresh').history.map(x=>x.revision),Array.from({length:25},(_,i)=>27-i));
  assert.deepEqual(parsed.get(kind+'_old_anchor').history,parsed.get(kind+'_at26_owner').history);
 }
 const firstLink=parsed.get('links_write_1').receipt;
 for(const label of ['links_original_recover','links_original_replay'])assert.deepEqual(parsed.get(label).receipt,firstLink);
 for(const [n,access]of [[1,'owner'],[2,'self']])for(const method of ['recover','replay'])
  assert.deepEqual(parsed.get('review_original_'+method+'_'+access).receipt,parsed.get('review_write_'+n).receipt);
 const finalPeriod=await period(pq('detail','owner',periodId));assert.deepEqual(finalPeriod.period,initialPeriod.period);assert.equal(finalPeriod.sourceChanged,initialPeriod.sourceChanged);
 assert.equal(d.fingerprint(),baseline);
 native.pass('219 actual177/178 25/26 history pages, unchanged old cursors across appended heads, owner/self parity and original receipts; full rollback retains218 facts');
 return {reads,submissions,rejections,replays,transactionSteps:steps.length,linkHistoryRows:27,reviewHistoryRows:27,
  actualSelfConfirmations:13,actualOwnerProposals:14,history25And26:true,appendedHeadPreservesOriginalCursor:true,ownerSelfPagesMatch:true,
  oldOperationReceiptsUnchanged:true,allReadsReplaysRejectionsZeroWrites:true,preexisting218FactsPreserved:true,rollbackRestored:true,
  definitionsAndCatalogUnchanged:true,old155ArchivePreserved:true,actualSealedArchivePreserved:true,
  syntheticHistoricalSession:true,actualHistoricalClockRequests:false,newClockRows:0,browser:false,productionAccess:false,newCluster:false};
}
