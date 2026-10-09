//222 real service-role RPCs in one owned, rollback-only synthetic transaction.
//No manufactured approval/clock rows and no configured production transport.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {assertLifecycleSandbox,lifecycleId as id,lifecycleJson as json} from '../merchant-attendance-lifecycle-native-support.mjs';
import {quote} from './attendance-bound-clocks-native.mjs';
import {outageNativeFingerprintSql} from './attendance-outage-native.mjs';
const require=createRequire(import.meta.url),fresh=n=>id(222000000+n),table='merchant_attendance_outage_relation_operations';

// Ignore only the exact intended append. Earlier rows in the same ledger stay
// inside every before/after hash, including earlier writes from this scenario.
export function outageRelationsProtectedSql(names,append=[]){
 let sql=outageNativeFingerprintSql(names);
 for(const {table:name,key,value} of append){
  assert(names.includes(name)&&['operation_id','declaration_id','incident_id'].includes(key));
  assert(/^[0-9a-f-]{36}$/.test(value));
  const token=`from public.${name} outage_row)`;
  assert(sql.includes(token),'relation_append_table_once');
  sql=sql.replace(token,`from public.${name} outage_row where outage_row.${key}<>${quote(value)}::uuid)`);
 }
 return sql;
}
export function createOutageRelationsNativePlan(input){
 const interval={startAt:new Date(input.startAt).toISOString().replace(/Z$/,'000Z'),endAt:new Date(input.endAt).toISOString().replace(/Z$/,'000Z'),
  timeZone:'UTC',startOffsetMinutes:0,endOffsetMinutes:0};
 assert(Date.parse(interval.startAt)<Date.parse(interval.endAt));
 const incident={action:'create_incident',operationId:fresh(1),incidentId:fresh(2),type:'network',channel:'web',locationId:input.location,
  interval,reason:'Synthetic222 reported outage; references do not settle statements'};
 const declaration=(n)=>({action:'declare',operationId:fresh(100+n),declarationId:fresh(200+n),incidentId:incident.incidentId,
  workerId:input.worker,employeeId:input.employee,employeeAuthUserId:input.auth,expectedWorkerVersion:input.workerVersion,
  expectedEmployeeVersion:input.employeeVersion,expectedGeneration:input.generation,interval,
  statement:'Synthetic222 distinct statement '+n,originalOperationId:null,originalChannel:null,paperReference:'SYNTHETIC222-SAME-PAPER'});
 const a=declaration(1),b=declaration(2),c=declaration(3);
 const q=(mode='detail',access='owner',reverse=false,value=null)=>({siteId:input.site,access,mode,declarationId:reverse?b.declarationId:a.declarationId,
  ...(mode==='list'?{}:{relatedDeclarationId:reverse?a.declarationId:b.declarationId}),
  ...(mode==='history'?{beforeRevision:value}:mode==='recover'?{operationId:value}:{})});
 return {fresh,interval,incident,declaration,a,b,c,q};
}

export async function verifyAttendanceOutageRelationsNative(ctx){
 const {d,h,native,scope,period,pq,periodId,periodArchive,archive,oldArchive}=ctx;
 assert(d?.syntheticOnly===true&&h?.syntheticOnly===true);assert.equal(typeof native.querySteps,'function');
 const owned=assertLifecycleSandbox(sql=>native.query(scope.sql(sql)));assert.deepEqual(owned,d.owned);
 assert((await period(pq('detail','owner',periodId))).period.sealed);
 const names=d.inventory(),baseline=d.fingerprint(),definitions=d.definitions(),catalog=d.tableCatalog(),sealed=periodArchive();
 assert(names.includes(table));
 const site=quote(d.site),worker=quote(h.workerId),employee=quote(h.employeeId),auth=quote(h.employeeAuthUserId);
 const profile=JSON.parse(d.exec(`select jsonb_build_object('workerVersion',w.version,'employeeVersion',e.version,'generation',coalesce(ep.generation,0))
  from public.merchant_attendance_workers w join public.merchant_enterprise_employees e on e.merchant_id=w.merchant_id and e.id=w.employee_id
  left join public.merchant_attendance_account_epochs ep on ep.merchant_id=e.merchant_id and ep.employee_id=e.id
  where w.merchant_id=${site} and w.id=${worker} and e.id=${employee} and e.auth_user_id=${auth} and w.active and e.status='active' and not coalesce(ep.paused,false);`));
 assert(profile);assert.equal(d.fingerprint(),baseline);
 const p=createOutageRelationsNativePlan({site:d.site,worker:h.workerId,employee:h.employeeId,auth:h.employeeAuthUserId,location:h.slot.locationId,
  startAt:h.slot.startAt,endAt:h.slot.endAt,...profile});
 const fullHash=outageNativeFingerprintSql(names),prefix="reset role;set local time zone 'UTC';set local datestyle='ISO, YMD';"+d.guard;
 const saved=label=>`(current_setting('faolla.outage222_${label}')::jsonb->'value')`;
 const savedCommand=label=>`(current_setting('faolla.outage222_${label}')::jsonb->'command')`;
 const rpc=(q,c,actor=d.owner,allow=true)=>`public.faolla_attendance_outage_relations_v1(${q},${quote(actor)},${c},${allow})`;
 const steps=[],meta=new Map();let reads=0,writes=0,rejections=0;
 const call=(label,{query=p.q(),command='null',kind='relations',actor=d.owner,allow=true,append=[],error=null,setup='',role='service_role'}={})=>{
  assert(/^[a-z_]+$/.test(label)&&!meta.has(label));meta.set(label,{error,kind});
  if(error)rejections++;else if(append.length)writes++;else reads++;
  const hash=outageRelationsProtectedSql(names,error?[]:append);
  const expression=kind==='relations'?rpc('rel_query','rel_command',actor,allow):`public.faolla_attendance_outage_v1(rel_query,${quote(actor)},rel_command,${allow})`;
  steps.push(prefix+`do $rel_call$ declare rel_before text;rel_after text;rel_query jsonb;rel_command jsonb;rel_value jsonb;rel_error text;begin
   rel_before:=${hash};rel_query:=${json(query)};rel_command:=${command};
   ${error?`begin ${setup} set local role ${role};perform ${expression};raise exception 'outage_relations_expected_rejection_missing';
    exception when others then rel_error:=sqlerrm;if ${error==='42501'?"sqlstate<>'42501'":`rel_error<>${quote(error)}`} then raise;end if;${error==='42501'?"rel_error:='42501';":''}end;`:`set local role ${role};rel_value:=${expression};`}
   set constraints all immediate;set constraints all deferred;reset role;rel_after:=${hash};
   assert rel_before=rel_after,'outage_relations_unintended_fact_change';
   perform set_config(${quote('faolla.outage222_'+label)},jsonb_build_object('label',${quote(label)},'kind',${quote(kind)},'query',rel_query,'command',rel_command,
    'actor',${quote(actor)},'value',rel_value,'error',rel_error,'before',rel_before,'after',rel_after)::text,true);
   end;$rel_call$;select current_setting(${quote('faolla.outage222_'+label)})::jsonb;`);
 };
 const incidentQ={siteId:d.site,access:'owner',mode:'incident',incidentId:p.incident.incidentId};
 const declarationQ=decl=>({siteId:d.site,access:'owner',mode:'declaration',declarationId:decl.declarationId});
 const incidentAppend=[{table:'merchant_attendance_outage_incidents',key:'incident_id',value:p.incident.incidentId},{table:'merchant_attendance_outage_operations',key:'operation_id',value:p.incident.operationId}];
 const declarationAppend=decl=>[{table:'merchant_attendance_outage_declarations',key:'declaration_id',value:decl.declarationId},{table:'merchant_attendance_outage_operations',key:'operation_id',value:decl.operationId}];
 const relationAppend=n=>[{table,key:'operation_id',value:fresh(n)}];
 const command=(n,action,from,relationKind='possible_duplicate')=>`jsonb_build_object('operationId',${quote(fresh(n))},'action',${quote(action)},
  'expectedRevision',${saved(from)}->'revision','expectedFingerprint',${saved(from)}->${action==='apply'?"'preview'":"'current'"}->'fingerprint',
  'reason',${quote('Synthetic222 explicit '+action+' '+n)}${action==='apply'?`,'kind',${quote(relationKind)}`:''})`;
 const savepoint=(label,setup)=>steps.push(prefix+`do $rel_savepoint$ begin perform set_config(${quote('faolla.outage222_before_'+label)},${fullHash},true);end;$rel_savepoint$;savepoint rel_${label};${setup}`);
 const restore=label=>steps.push(prefix+`rollback to savepoint rel_${label};release savepoint rel_${label};do $rel_restored$ begin
  assert ${fullHash}=current_setting(${quote('faolla.outage222_before_'+label)}),'outage_relations_savepoint_not_restored';end;$rel_restored$;`);
 const seal=`assert exists(select 1 from public.merchant_attendance_period_closures where merchant_id=${site} and period_id=${quote(periodId)} and sealed),'outage_relations_real_seal_required';`;
 steps.push('begin;'+prefix+`do $rel_start$ begin ${seal}
  assert not exists(select 1 from public.${table}),'outage_relations_empty_ledger_required';
  assert not exists(select 1 from public.merchant_attendance_outage_operations where merchant_id=${site}),'outage_relations_empty_outage_required';
  assert not exists(select 1 from pg_trigger t join pg_class c on c.oid=t.tgrelid where c.relnamespace=${owned.oid} and t.tgenabled<>'O'),'outage_relations_guards_enabled';
  assert has_function_privilege('service_role','public.faolla_attendance_outage_relations_v1(jsonb,uuid,jsonb,boolean)','EXECUTE');
  assert not has_function_privilege('authenticated','public.faolla_attendance_outage_relations_v1(jsonb,uuid,jsonb,boolean)','EXECUTE');
  assert not has_table_privilege('service_role','public.${table}','INSERT,UPDATE,DELETE,TRUNCATE');end;$rel_start$;`);
 call('incident',{kind:'outage',query:incidentQ,command:json(p.incident),append:incidentAppend});
 for(const [name,decl]of [['a',p.a],['b',p.b],['c',p.c]])call('declare_'+name,{kind:'outage',query:declarationQ(decl),command:json(decl),append:declarationAppend(decl)});
 call('empty_list',{query:p.q('list')});call('empty_detail');call('empty_self',{query:p.q('detail','self'),actor:h.employeeAuthUserId});
 call('gate_off',{query:p.q(),allow:false});
 call('unknown_target',{query:{...p.q(),relatedDeclarationId:fresh(900)},error:'attendance_outage_relations_not_found'});
 call('same_pair',{query:{...p.q(),relatedDeclarationId:p.a.declarationId},error:'attendance_invalid_request'});
 call('wrong_owner',{actor:h.employeeAuthUserId,error:'attendance_access_denied'});
 call('foreign_site',{query:{...p.q(),siteId:'99990002'},error:'attendance_access_denied'});
 call('anon_denied',{role:'anon',error:'42501'});call('authenticated_denied',{role:'authenticated',error:'42501'});
 call('new_gate_off',{command:command(10,'apply','empty_detail'),allow:false,error:'attendance_outage_relations_disabled'});
 call('bad_fingerprint',{command:`(${command(10,'apply','empty_detail')})||jsonb_build_object('expectedFingerprint',repeat('0',64))`,error:'attendance_outage_relations_changed'});
 call('self_write_denied',{query:p.q('detail','self'),actor:h.employeeAuthUserId,command:command(10,'apply','empty_detail'),error:'attendance_invalid_request'});
 call('non_string_reason',{command:`(${command(10,'apply','empty_detail')})||jsonb_build_object('reason',1)`,error:'attendance_invalid_request'});
 call('apply',{command:command(10,'apply','empty_detail'),append:relationAppend(10)});
 call('read_apply');call('reverse_read',{query:p.q('detail','owner',true)});
 call('list',{query:p.q('list')});call('reverse_list',{query:p.q('list','owner',true)});
 call('self_list',{query:p.q('list','self'),actor:h.employeeAuthUserId});
 call('unrelated_same_paper',{query:{siteId:d.site,access:'owner',mode:'list',declarationId:p.c.declarationId}});
 call('replay_off',{command:savedCommand('apply'),allow:false});
 call('recover_off',{query:p.q('recover','owner',false,fresh(10)),allow:false});
 call('reverse_same_operation',{query:p.q('detail','owner',true),command:savedCommand('apply'),error:'attendance_operation_conflict'});
 call('changed_operation',{command:`(${savedCommand('apply')})||jsonb_build_object('reason','Synthetic222 changed intent')`,error:'attendance_operation_conflict'});
 call('unknown_recovery',{query:p.q('recover','owner',false,fresh(999)),allow:false,error:'attendance_outage_relations_not_found'});
 call('self_recovery_denied',{query:p.q('recover','self',false,fresh(10)),actor:h.employeeAuthUserId,error:'attendance_invalid_request'});
 call('stale_revision',{command:command(11,'apply','empty_detail','complementary'),error:'attendance_outage_relations_changed'});
 call('complementary',{query:p.q('detail','owner',true),command:command(11,'apply','reverse_read','complementary'),append:relationAppend(11)});
 call('read_complementary');
 savepoint('settings',`update public.merchant_attendance_settings set enabled=false where merchant_id=${site};`);
 call('disabled_detail');
 call('disabled_apply',{command:command(12,'apply','disabled_detail'),error:'attendance_platform_paused'});
 call('disabled_revoke',{command:command(12,'revoke','disabled_detail'),append:relationAppend(12)});
 call('disabled_original_recover',{query:p.q('recover','owner',false,fresh(10)),allow:false});restore('settings');
 savepoint('identity',`update public.merchant_enterprise_employees set auth_user_id=${quote(fresh(998))} where merchant_id=${site} and id=${employee};`);
 call('rebound_detail');
 call('old_self_denied',{query:p.q('detail','self'),actor:h.employeeAuthUserId,error:'attendance_access_denied'});
 call('new_self_denied',{query:p.q('detail','self'),actor:fresh(998),error:'attendance_outage_relations_not_found'});
 call('rebound_recover',{query:p.q('recover','owner',false,fresh(10)),allow:false});
 call('rebound_apply',{command:command(13,'apply','read_complementary'),error:'attendance_outage_relations_blocked'});
 call('rebound_revoke',{command:command(13,'revoke','rebound_detail'),append:relationAppend(13)});
 const rebound=p.declaration(4);
 call('rebound_new_statement',{kind:'outage',query:declarationQ(rebound),append:declarationAppend(rebound),
  command:`(${json(rebound)})||jsonb_build_object('employeeAuthUserId',${quote(fresh(998))},'expectedEmployeeVersion',(select version from public.merchant_enterprise_employees where merchant_id=${site} and id=${employee}))`});
 call('mismatched_saved_identity',{query:{...p.q(),relatedDeclarationId:rebound.declarationId},error:'attendance_outage_relations_blocked'});
 restore('identity');
 const revokePermission=`update public.merchant_enterprise_roles set permissions=array_remove(permissions,'attendance.self.request') where merchant_id=${site}
  and id=(select role_id from public.merchant_enterprise_employees where merchant_id=${site} and id=${employee});`;
 call('self_permission_revoked',{query:p.q('list','self'),actor:h.employeeAuthUserId,setup:revokePermission,error:'attendance_access_denied'});
 call('revoke',{command:command(14,'revoke','read_complementary'),append:relationAppend(14)});
 call('revoked_detail');call('revoked_list',{query:p.q('list')});
 call('history',{query:p.q('history')});call('self_older_history',{query:p.q('history','self',true,3),actor:h.employeeAuthUserId});
 call('revoke_again',{command:command(15,'revoke','revoked_detail'),error:'attendance_outage_relations_changed'});
 call('old_receipt_unchanged',{query:p.q('recover','owner',false,fresh(10)),allow:false});
 call('revoke_exact_replay',{command:savedCommand('revoke'),allow:false});
 call('revoke_recover',{query:p.q('recover','owner',false,fresh(14)),allow:false});
 // Exercise the actual100-entry pair limit without omitting predecessors or
 // disabling guards. Final slot is a real revoke, not a fabricated row.
 savepoint('revision_capacity','');
 for(let first=4;first<=99;first+=20){
  const last=Math.min(99,first+19);
  steps.push(prefix+`do $rel_fill_revisions$ declare i integer;q jsonb:=${json(p.q())};r jsonb;c jsonb;begin
   for i in ${first}..${last} loop set local role service_role;r:=${rpc('q','null')};
    c:=jsonb_build_object('action','apply','operationId',('00000000-0000-4000-8000-'||lpad((222001000+i)::text,12,'0')),
     'expectedRevision',r->'revision','expectedFingerprint',r->'preview'->'fingerprint','kind','possible_duplicate','reason','Synthetic222 capacity replacement '||i);
    r:=${rpc('q','c')};assert (r->'receipt'->'entry'->>'revision')::integer=i;reset role;end loop;end;$rel_fill_revisions$;`);
 }
 call('capacity_last_apply');
 call('capacity_revoke',{command:command(1200,'revoke','capacity_last_apply'),append:relationAppend(1200)});
 call('capacity_terminal_detail');
 call('capacity_history',{query:p.q('history')});call('capacity_history_two',{query:p.q('history','owner',false,76)});
 call('capacity_history_three',{query:p.q('history','owner',false,51)});call('capacity_history_four',{query:p.q('history','owner',false,26)});
 call('capacity_original_recover',{query:p.q('recover','owner',false,fresh(10)),allow:false});restore('revision_capacity');
 // Exactly25 ever-associated pairs per endpoint, including revoked AB. The
 //26th must not be accepted even though the first pair is currently revoked.
 savepoint('pair_capacity','');
 for(let first=3;first<=27;first+=5){
  const last=Math.min(27,first+4),plans=Array.from({length:last-first+1},(_,i)=>p.declaration(first+i));
  steps.push(prefix+`do $rel_fill_pairs$ declare x jsonb;q jsonb;r jsonb;c jsonb;begin
   for x in select value from jsonb_array_elements(${json(plans)}) loop set local role service_role;
    if x->>'declarationId'<>${quote(p.c.declarationId)} then
     perform public.faolla_attendance_outage_v1(jsonb_build_object('siteId',${site},'access','owner','mode','declaration','declarationId',x->'declarationId'),${quote(d.owner)},x,true);end if;
    if x->>'declarationId'<>${quote(p.declaration(27).declarationId)} then
     q:=jsonb_build_object('siteId',${site},'access','owner','mode','detail','declarationId',${quote(p.a.declarationId)},'relatedDeclarationId',x->'declarationId');
     r:=${rpc('q','null')};assert r->'preview'->>'eligible'='true';
     c:=jsonb_build_object('action','apply','operationId',('00000000-0000-4000-8000-'||lpad((222010000+right(x->>'declarationId',3)::integer)::text,12,'0')),
      'expectedRevision',r->'revision','expectedFingerprint',r->'preview'->'fingerprint','kind','complementary','reason','Synthetic222 capacity explicit pair');
     perform ${rpc('q','c')};end if;reset role;
   end loop;end;$rel_fill_pairs$;`);
 }
 call('pair_capacity_list',{query:p.q('list')});
 const limitQuery={...p.q(),relatedDeclarationId:p.declaration(27).declarationId};
 call('pair_capacity_preview',{query:limitQuery});
 call('pair_capacity_denied',{query:limitQuery,command:command(1300,'apply','pair_capacity_preview'),error:'attendance_outage_relations_limit'});
 call('pair_capacity_reverse_denied',{query:{...limitQuery,declarationId:limitQuery.relatedDeclarationId,relatedDeclarationId:limitQuery.declarationId},
  command:command(1301,'apply','pair_capacity_preview'),error:'attendance_outage_relations_limit'});
 restore('pair_capacity');
 // Real soft bounds and immutable guards are checked within the same rollback.
 // Each new relation and its original receipt must not alter existing 177/178.
 steps.push(prefix+`do $rel_guards$ declare old_hash text;begin old_hash:=${fullHash};
  begin update public.${table} set revision=revision where merchant_id=${site};raise exception 'relation_update_not_denied';exception when others then if sqlerrm='relation_update_not_denied' then raise;end if;end;
  begin delete from public.${table} where merchant_id=${site};raise exception 'relation_delete_not_denied';exception when others then if sqlerrm='relation_delete_not_denied' then raise;end if;end;
  begin truncate public.${table};raise exception 'relation_truncate_not_denied';exception when others then if sqlerrm='relation_truncate_not_denied' then raise;end if;end;
  assert old_hash=${fullHash},'relation_immutable_guard_changed_facts';${seal}end;$rel_guards$;
  select jsonb_build_object('kind','counts','relations',(select count(*) from public.${table} where merchant_id=${site}),
   'declarations',(select count(*) from public.merchant_attendance_outage_declarations where merchant_id=${site}),
   'incidents',(select count(*) from public.merchant_attendance_outage_incidents where merchant_id=${site}),
   'operations',(select count(*) from public.merchant_attendance_outage_operations where merchant_id=${site}));rollback;`);
 assert(steps.length<=100);let rows;const failures=[];
 try{rows=(await native.querySteps(steps.map(sql=>scope.sql(sql)))).trim().split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line));}
 catch(error){failures.push(new Error('outage_relations_actual_sql_failed:'+String(error?.message??error),{cause:error}));}
 finally{
  for(const [label,read,want]of [['facts',()=>d.fingerprint(),baseline],['definitions',()=>d.definitions(),definitions],['catalog',()=>d.tableCatalog(),catalog],
   ['old_text',()=>archive().artifactText,oldArchive.artifactText],['old_sha',()=>archive().artifactSha256,oldArchive.artifactSha256],
   ['sealed_text',()=>periodArchive().artifactText,sealed.artifactText],['sealed_sha',()=>periodArchive().artifactSha256,sealed.artifactSha256]]){
   try{assert.equal(read(),want,'outage_relations_rollback_'+label);}catch(error){failures.push(error);}
  }
 }
 if(failures.length)throw new AggregateError(failures,'outage_relations_native_failed:'+failures.map(e=>e.message).join(' | '));
 const {projectOutageRelationsResult}=require('../../src/lib/merchantAttendanceOutageRelations.server.ts');
 const {projectOutageResult}=require('../../src/lib/merchantAttendanceOutage.server.ts');
 const parsed=new Map(),raw=new Map();
 for(const row of rows){if(!row.label)continue;assert(meta.has(row.label));assert.equal(row.before,row.after);assert.equal(row.error,meta.get(row.label).error);raw.set(row.label,row);
  if(row.error)continue;
  try{parsed.set(row.label,row.kind==='outage'?projectOutageResult(row.value,row.query,row.actor,row.command):projectOutageRelationsResult(row.value,row.query,row.actor,row.command));}
  catch(error){throw new Error('outage_relations_projection_failed:'+row.label+':'+String(error?.message??error),{cause:error});}
 }
 assert.equal(raw.size,meta.size);assert.equal(rows.filter(r=>r.error).length,rejections);
 assert.deepEqual(rows.find(r=>r.kind==='counts'),{kind:'counts',relations:3,declarations:3,incidents:1,operations:4});
 const original=parsed.get('apply').receipt,head=original.entry;
 for(const label of ['replay_off','recover_off','disabled_original_recover','rebound_recover','old_receipt_unchanged'])assert.deepEqual(parsed.get(label).receipt,original,label);
 assert.equal(parsed.get('empty_list').items.length,0);assert.equal(parsed.get('unrelated_same_paper').items.length,0);
 assert.equal(parsed.get('empty_detail').revision,0);assert(parsed.get('empty_detail').preview.eligible);assert.equal(parsed.get('gate_off').canWrite,false);
 for(const label of ['read_apply','reverse_read'])assert.deepEqual(parsed.get(label).current,head,label);
 for(const label of ['list','reverse_list','self_list'])assert.equal(parsed.get(label).items.length,1,label);
 assert.equal(parsed.get('complementary').receipt.entry.kind,'complementary');assert.equal(parsed.get('read_complementary').revision,2);
 assert.equal(parsed.get('disabled_detail').preview.eligible,false);assert(parsed.get('disabled_detail').canWrite);
 assert.equal(parsed.get('rebound_detail').preview.eligible,false);assert(parsed.get('rebound_detail').canWrite);
 assert.equal(parsed.get('disabled_revoke').receipt.entry.action,'revoke');assert.equal(parsed.get('rebound_revoke').receipt.entry.action,'revoke');
 assert.equal(parsed.get('revoked_detail').current.action,'revoke');assert.equal(parsed.get('revoked_list').items[0].action,'revoke');
 assert.deepEqual(parsed.get('history').history.map(e=>e.revision),[3,2,1]);assert.deepEqual(parsed.get('self_older_history').history.map(e=>e.revision),[2,1]);
 for(const label of ['revoke_exact_replay','revoke_recover'])assert.deepEqual(parsed.get(label).receipt,parsed.get('revoke').receipt);
 assert.equal(parsed.get('capacity_last_apply').revision,99);assert.equal(parsed.get('capacity_last_apply').preview.eligible,false);assert(parsed.get('capacity_last_apply').canWrite);
 assert.equal(parsed.get('capacity_revoke').receipt.entry.revision,100);assert.equal(parsed.get('capacity_terminal_detail').canWrite,false);
 const pages=['capacity_history','capacity_history_two','capacity_history_three','capacity_history_four'].map(label=>parsed.get(label));
 assert.deepEqual(pages.flatMap(r=>r.history.map(e=>e.revision)),Array.from({length:100},(_,i)=>100-i));
 assert.deepEqual(pages.map(r=>r.historyTruncated),[true,true,true,false]);assert.deepEqual(parsed.get('capacity_original_recover').receipt,original);
 assert.equal(parsed.get('pair_capacity_list').items.length,25);assert(parsed.get('pair_capacity_preview').preview.blockers.includes('pair_limit'));
 native.pass('222181 actual owner/self pair references, symmetric ledger, direction-pinned receipt, closed-gate recovery, no automatic duplicate or identity leakage');
 return {reads,submissions:writes,rejections,transactionSteps:steps.length,bulkCapacitySubmissions:144,relations:3,originalStatements:3,samePaperNotAutoLinked:true,
  capacityHistoryPages:4,pairCapacity:25,terminalRevision:100,
  exactAppendsOnly:true,settingsDisabledSafeRevoke:true,reboundSafeRevoke:true,oldReceiptUnchanged:true,rollbackRestored:true,
  oldFactsAndArchivesUnchanged:true,sourceReviewPeriodSemanticsUnchanged:true,browser:false,productionAccess:false,newCluster:false};
}
