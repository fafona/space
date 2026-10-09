//240 Inert fixture: actual Node service -> real RPC, one owned transaction.
//Synthetic reference changes are savepoint-only. No punch or archive is forged.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {assertLifecycleSandbox,lifecycleId as id,lifecycleJson as json} from '../merchant-attendance-lifecycle-native-support.mjs';
import {quote} from './attendance-bound-clocks-native.mjs';
import {outageNativeFingerprintSql} from './attendance-outage-native.mjs';
import {periodContinuationSerialization,periodContinuationArchiveBytes} from './attendance-period-continuation-native.mjs';
const require=createRequire(import.meta.url),uid=n=>id(240600000+n);
export const operationalRulesFixtureTables=Object.freeze(['merchant_attendance_operational_rule_operations',
 'merchant_attendance_operational_rule_publications','merchant_attendance_operational_rule_streams']);
export function operationalRulesNativeDocument(location,employee,auth){
 return {allowedChannels:{mode:'value',value:['self','location','pin','onsite']},locationScope:{mode:'value',value:[location]},
  shiftSource:{mode:'value',value:'published_selection'},breakTypes:{mode:'value',value:{allowed:['paid','unpaid'],selection:'explicit'}},
  correctionWindow:{mode:'value',value:{days:7}},reviewRouting:{mode:'value',value:{correction:{delegateEmployeeId:employee,delegateAuthUserId:auth},
   missing:'owner',leave:'owner',work_arrangement:'owner'}},timesheetCycle:{mode:'value',value:{kind:'weekly',weekStartsOn:1}},
  reminders:{mode:'value',value:{open_session:{mode:'enabled',afterMinutes:480,repeatMinutes:120,maxOccurrences:2},
   pending_review:{mode:'disabled'},period_due:{mode:'disabled'}}}};
}
export const operationalRulesNativeQuery=(siteId,scope,mode='detail',patch={})=>({siteId,mode,scope,...patch});

export async function verifyOperationalRulesNative(ctx){
 const {d,h,native,scope,archive,periodArchive}=ctx;
 assert.equal(d.syntheticOnly,true);assert.equal(h.syntheticOnly,true);
 assert.deepEqual(assertLifecycleSandbox(sql=>native.query(scope.sql(sql))),d.owned);
 const {executeOperationalRuleLedger}=require('../../src/lib/merchantAttendanceOperationalRuleLedger.server.ts');
 const {parseOperationalRules}=require('../../src/lib/merchantAttendanceOperationalRules.ts');
 const names=d.inventory(),baseline=d.fingerprint(),definitions=d.definitions(),catalog=d.tableCatalog();
 const oldArchive=periodContinuationArchiveBytes(await archive()),oldPeriod=periodContinuationArchiveBytes(await periodArchive());
 const fullHash=outageNativeFingerprintSql(names),oldHash=outageNativeFingerprintSql(names.filter(n=>!operationalRulesFixtureTables.includes(n)));
 const setupProtectedHash=outageNativeFingerprintSql(names.filter(n=>!['merchant_attendance_groups','merchant_attendance_group_operations','merchant_attendance_locations'].includes(n)));
 const prefix=periodContinuationSerialization+d.guard,site=quote(d.site),connection=native.connect({lifetimeMs:90000});
 let steps=0,reads=0,writes=0,rejections=0,serial=0,stage='begin',rolledBack=false,lastRpc=null;
 const step=async(label,sql)=>{stage=label;assert(++steps<=140,'operational_rules_max140_steps');
  return connection.step(scope.sql((label==='begin'?'begin;':'')+prefix+sql));};
 const call=async(label,expression,command=null,replay=false)=>{
  const value=JSON.parse(await step(label,`do $opr240_call$ declare b text;old_rows text;r jsonb;e text;s text;c text;begin
   b:=${fullHash};old_rows:=${oldHash};begin set local role service_role;assert current_user='service_role';r:=${expression};
   set constraints all immediate;set constraints all deferred;
   exception when others then get stacked diagnostics e=message_text,s=returned_sqlstate,c=pg_exception_context;end;reset role;
   assert ${oldHash}=old_rows,'operational_rules_RPC_changed_old_facts';
   if e is not null or ${command===null||replay} then assert ${fullHash}=b,'operational_rules_read_replay_or_failure_changed_facts';end if;
   perform set_config('faolla.opr240_result',jsonb_build_object('value',r,'error',e,'sqlstate',s,'context',c)::text,true);
  end;$opr240_call$;select current_setting('faolla.opr240_result')::jsonb;`));
  lastRpc=value;if(value.error)rejections++;else if(command)writes++;else reads++;return value;
 };
 let replay=false;
 const service={rpc:async(name,args)=>{
  assert.equal(name,'faolla_attendance_operational_rules_v1');
  assert.deepEqual(Object.keys(args).sort(),['p_query','p_auth_user_id','p_command','p_allow_write'].sort());
  assert.equal(args.p_query.siteId,d.site);assert([d.owner,h.employeeAuthUserId].includes(args.p_auth_user_id));
  const r=await call('rpc_'+(args.p_command?.action??args.p_query.mode),`public.${name}(${json(args.p_query)},${quote(args.p_auth_user_id)},${json(args.p_command)},${args.p_allow_write})`,args.p_command,replay);
  return {data:r.value,error:r.error?{message:r.error}:null};
 }};
 const run=(query,command=null,allowWrite=true,authUserId=d.owner)=>executeOperationalRuleLedger({query,command,authUserId,allowWrite},service);
 const query=(sc,mode='detail',patch={})=>operationalRulesNativeQuery(d.site,sc,mode,patch);
 const detail=sc=>run(query(sc));
 const recover=(operationId,who=d.owner)=>run({siteId:d.site,mode:'recover',operationId},null,false,who);
 const make=(sc,revision,action,patch={})=>({siteId:d.site,scope:sc,action,operationId:uid(++serial),expectedRevision:revision,
  reason:'合成240 明确核准；不采用、不重算历史',...patch});
 const denied=async(label,q,c=null,allow=true,who=d.owner,expected=['attendance_access_denied'])=>{
  stage=label;const before=steps;let caught=null;try{await run(q,c,allow,who);}catch(e){caught=e;}
  assert(caught,label+':must_reject');assert.equal(steps,before+1,label+':must_reach_exactly_one_real_RPC');
  assert(lastRpc.error,label+':must_be_SQL_rejection');assert(expected.includes(caught.code),label+':'+JSON.stringify({code:caught.code,lastRpc}));
 };
 const savepoint=async name=>{assert(/^[a-z0-9_]+$/.test(name));return step('save_'+name,`savepoint ${name};select ${fullHash};`);};
 const restore=async(name,before)=>{assert.equal(await step('restore_'+name,`rollback to savepoint ${name};release savepoint ${name};select ${fullHash};`),before);};
 try{
  const groupQuery={siteId:d.site,view:'context',groupId:null,workerId:null,onDate:null,assignmentId:null,operationId:null,cursorId:null};
  const groupCommand={operationId:uid(9100),action:'save_group',groupId:uid(9100),expectedRevision:0,name:'Synthetic240 rule scope',description:'',active:true,reason:'Synthetic240 explicit fixture group'};
  const profile=JSON.parse(await step('begin',`set local lock_timeout='3s';set local statement_timeout='10s';
   do $opr240_empty$ begin ${operationalRulesFixtureTables.map(t=>`assert not exists(select 1 from public.${t} where merchant_id=${site}),'operational_rules_expected_empty_scope';`).join(' ')}end;$opr240_empty$;
   -- Disclosed fixture setup only: one real124 group RPC, and one foreign
   -- base location. No fake rules, worker binding, punch, or source archive.
   do $opr240_setup$ declare before_hash text;foreign_site text;r jsonb;begin
    before_hash:=${setupProtectedHash};
    select id into foreign_site from public.merchants where id<>${site} order by id limit 1;
    assert foreign_site is not null,'operational_rules_synthetic_foreign_site_required';
    assert not exists(select 1 from public.merchant_attendance_locations where id=${quote(uid(9101))});
    set local role service_role;
    r:=public.faolla_attendance_groups_v1(${json(groupQuery)},${quote(d.owner)},${json(groupCommand)},true);
    reset role;assert r->'receipt'->'command'=${json(groupCommand)};
    insert into public.merchant_attendance_locations(id,merchant_id,name,time_zone,active)
     values(${quote(uid(9101))},foreign_site,'Synthetic240 foreign location','UTC',true);
    set constraints all immediate;set constraints all deferred;
    assert ${setupProtectedHash}=before_hash,'operational_rules_setup_changed_other_facts';
   end;$opr240_setup$;
   select jsonb_build_object('employeeId',(select employee_id from public.merchant_attendance_workers where merchant_id=${site} and id=${quote(h.workerId)}),
    'groupId',(select group_id from public.merchant_attendance_groups where merchant_id=${site} and group_id=${quote(uid(9100))} and active),
    'locationId',(select id from public.merchant_attendance_locations where merchant_id=${site} and active order by id limit 1),
    'foreignLocationId',(select id from public.merchant_attendance_locations where merchant_id<>${site} and id=${quote(uid(9101))}),
    'tomorrow',(select to_char((clock_timestamp() at time zone time_zone)::date+1,'YYYY-MM-DD') from public.merchant_attendance_settings where merchant_id=${site}),
    'endDay',(select to_char((clock_timestamp() at time zone time_zone)::date+3,'YYYY-MM-DD') from public.merchant_attendance_settings where merchant_id=${site}));`));
  for(const k of ['employeeId','groupId','locationId','foreignLocationId','tomorrow','endDay'])assert(profile[k],'missing_existing_synthetic_'+k);
  const scopes=[{kind:'enterprise'},{kind:'group',groupId:profile.groupId},
   {kind:'personal',workerId:h.workerId,employeeId:profile.employeeId,employeeAuthUserId:h.employeeAuthUserId}];
  const rules=parseOperationalRules(operationalRulesNativeDocument(profile.locationId,profile.employeeId,h.employeeAuthUserId));
  const saved=[],published=[];
  for(const sc of scopes){
   const first=(await detail(sc)).data;assert.equal(first.kind,'detail');assert.equal(first.revision,0);assert(first.context);
   const command=make(sc,0,'save_draft',{expectedContext:first.context,rules}),r=await run(query(sc),command);
   assert.equal(r.data.kind,'receipt');assert.equal(r.receipt.revision,1);saved.push(command);
   replay=true;try{assert.deepEqual((await run(query(sc),command,false)).receipt,r.receipt);}finally{replay=false;}
   await denied('changed_body_same_id',query(sc),{...command,reason:'合成240不同正文'},true,d.owner,['attendance_operation_conflict']);
   const previewQuery=query(sc,'preview',{sourceDraftRevision:1,effectiveOn:profile.tomorrow,endsOn:sc.kind==='personal'?profile.endDay:null});
   const preview=(await run(previewQuery)).data;assert.equal(preview.kind,'preview');assert.equal(preview.applied,false);
   assert.equal(preview.references.locations.length,1);assert.equal(preview.references.routes.length,1);
   const publish=make(sc,1,'publish',{sourceDraftRevision:1,effectiveOn:preview.effectiveOn,endsOn:preview.endsOn,previewFingerprint:preview.previewFingerprint});
   const receipt=(await run(query(sc),publish)).receipt;assert.equal(receipt.revision,2);published.push(publish);
   const after=(await detail(sc)).data;assert.equal(after.currentPublication,null);assert.equal(after.nextPublication.operationId,publish.operationId);
   assert.equal(after.draft,null);assert.deepEqual(after.nextPublication.rules,rules);
   assert.equal(after.nextPublication.endsOn,sc.kind==='personal'?profile.endDay:null);
  }
  //Historical page capacity comes from 27 REAL RPCs, not direct fabricated rows.
  const enterprise=scopes[0],beforePrefix=(await detail(enterprise)).data;
  const prefixCommands=Array.from({length:27},(_,i)=>make(enterprise,2+i,'save_draft',{expectedContext:beforePrefix.context,rules}));
  // real_27_draft_RPCs: each actual API operation gets its own unchanged10s
  // statement bound. Aggregating27 POST-equivalents into one DO measured an
  // artificial batch timeout, not the application's single-request deadline.
  let prefixResult;
  for(const command of prefixCommands){
   prefixResult=await run(query(enterprise),command);
   assert.equal(prefixResult.receipt.revision,command.expectedRevision+1);
  }
  assert.equal(prefixResult.receipt.revision,29);
  const page1=(await run(query(enterprise,'history',{cursor:null}))).data;
  assert.equal(page1.items.length,25);assert.equal(page1.atRevision,29);assert(page1.nextCursor);
  assert.deepEqual(page1.items.map(x=>x.item.revision),Array.from({length:25},(_,i)=>29-i));
  const page2=(await run(query(enterprise,'history',{cursor:page1.nextCursor}))).data;
  assert.deepEqual(page2.items.map(x=>x.item.revision),[4,3,2,1]);assert.equal(page2.nextCursor,null);
  assert.equal((await detail(enterprise)).data.nextPublication.operationId,published[0].operationId);
  for(const kind of ['workers','routes']){
   const data=(await run({siteId:d.site,mode:'catalog',catalog:kind,afterId:null})).data;assert.equal(data.kind,'catalog');
   assert(data.items.some(x=>kind==='workers'?x.workerId===h.workerId&&x.employeeAuthUserId===h.employeeAuthUserId:
    x.employeeId===profile.employeeId&&x.employeeAuthUserId===h.employeeAuthUserId));
  }
  const oldScopes=(await run({siteId:d.site,mode:'catalog',catalog:'saved_personal',afterScope:null})).data;
  assert.deepEqual(oldScopes.items.map(x=>x.scope),[scopes[2]]);
  const head=(await detail(enterprise)).data;
  const forbidden=structuredClone(rules);forbidden.locationScope.value=[profile.foreignLocationId];
  await denied('foreign_location',query(enterprise),make(enterprise,head.revision,'save_draft',{expectedContext:head.context,rules:forbidden}),true,d.owner,
   ['attendance_operational_rule_not_found']);
  await denied('feature_off_fresh',query(enterprise),make(enterprise,head.revision,'save_draft',{expectedContext:head.context,rules}),false,d.owner,
   ['attendance_operational_rule_disabled']);
  await denied('nonowner_detail',query(enterprise),null,true,h.employeeAuthUserId);
  //Savepoint only: the live saved draft references the old route's exact Auth.
  const beforeRebind=await savepoint('opr240_rebind');
  await step('synthetic_reference_auth_rebind',`update public.merchant_enterprise_employees set auth_user_id=${quote(uid(5000))},version=version+1 where merchant_id=${site} and id=${quote(profile.employeeId)};select 1;`);
  await denied('draft_route_identity_changed',query(enterprise,'preview',{sourceDraftRevision:29,effectiveOn:profile.tomorrow,endsOn:null}),null,true,d.owner,
   ['attendance_operational_rule_changed']);
  const oldPersonal=(await detail(scopes[2])).data;assert.equal(oldPersonal.context,null);assert.equal(oldPersonal.canWithdraw,true);
  const revokeOld=make(scopes[2],oldPersonal.revision,'withdraw',{publishedRevision:2});
  assert.equal((await run(query(scopes[2]),revokeOld,false)).receipt.action,'withdraw');
  await restore('opr240_rebind',beforeRebind);
  const revoke=make(enterprise,29,'withdraw',{publishedRevision:2});
  const withdrawn=(await run(query(enterprise),revoke,false)).receipt;assert.equal(withdrawn.revision,30);
  assert.equal((await run(query(enterprise),null,false)).data.nextPublication,null);
  assert.deepEqual((await recover(revoke.operationId)).receipt,withdrawn);
  //The old-owner receipt remains minimal after ownership changes; all normal
  //reads and catalogs still require the actual current owner.
  const beforeOwner=await savepoint('opr240_owner');
  await step('synthetic_owner_change',`update public.merchants set user_id=${quote(h.employeeAuthUserId)} where id=${site};select 1;`);
  assert.deepEqual((await recover(revoke.operationId)).receipt,withdrawn);
  await denied('old_owner_cannot_read_rules',query(enterprise));
  await denied('old_owner_cannot_read_catalog',{siteId:d.site,mode:'catalog',catalog:'routes',afterId:null});
  await denied('new_owner_cannot_adopt_receipt',{siteId:d.site,mode:'recover',operationId:revoke.operationId},null,false,h.employeeAuthUserId);
  await restore('opr240_owner',beforeOwner);
  const oldSnapshot=(await run(query(enterprise,'history',{cursor:page1.nextCursor}))).data;
  assert.equal(oldSnapshot.items.find(x=>x.item.revision===2).withdrawnByRevision,null,'later withdrawal must not rewrite pinned history');
  const latest=(await run(query(enterprise,'history',{cursor:null}))).data;
  const latestTail=(await run(query(enterprise,'history',{cursor:latest.nextCursor}))).data;
  assert.equal(latestTail.items.find(x=>x.item.revision===2).withdrawnByRevision,30);
  //A projection failure must roll back the new fact and stream head together.
  const faultHead=(await detail(enterprise)).data;
  const faultPreview=(await run(query(enterprise,'preview',{sourceDraftRevision:29,effectiveOn:profile.tomorrow,endsOn:null}))).data;
  const faultCommand=make(enterprise,faultHead.revision,'publish',{sourceDraftRevision:29,effectiveOn:profile.tomorrow,endsOn:null,previewFingerprint:faultPreview.previewFingerprint});
  const beforeFault=await savepoint('opr240_fault');
  await step('install_owned_projection_fault',`create function public.opr240_projection_fault() returns trigger language plpgsql as $fault$ begin raise exception 'synthetic240_projection_fault';end;$fault$;
   create trigger opr240_projection_fault before insert on public.merchant_attendance_operational_rule_publications for each row execute function public.opr240_projection_fault();select 1;`);
  await denied('projection_failure_atomic',query(enterprise),faultCommand,true,d.owner,['attendance_operational_rule_invalid']);
  assert.equal(lastRpc.error,'synthetic240_projection_fault');
  await restore('opr240_fault',beforeFault);
  assert.equal((await recover(faultCommand.operationId)).receipt,null);
  //Do not infer SQL privileges or immutability from TypeScript tests.
  await step('actual_private_ACL_and_append_only',`do $opr240_acl$ declare n text;p regprocedure;rejected boolean;begin
   set local role service_role;
   foreach n in array array[${operationalRulesFixtureTables.map(quote).join(',')}] loop
    rejected:=false;begin execute format('select 1 from public.%I limit 1',n);exception when insufficient_privilege then rejected:=true;end;
    assert rejected,'operational_rules_service_direct_read_allowed';
   end loop;reset role;
   for p in select oid::regprocedure from pg_proc where pronamespace=${d.owned.oid} and starts_with(proname,'faolla_attendance_operational_rule_') loop
    assert not has_function_privilege('anon',p,'EXECUTE') and not has_function_privilege('authenticated',p,'EXECUTE');
    assert not has_function_privilege('service_role',p,'EXECUTE'),'operational_rules_private_helper_exposed';
   end loop;
   rejected:=false;begin update public.merchant_attendance_operational_rule_operations set command=command where merchant_id=${site};
    exception when insufficient_privilege then assert sqlerrm='attendance_events_append_only';rejected:=true;end;assert rejected,'operational_rules_operations_not_immutable';
   rejected:=false;begin delete from public.merchant_attendance_operational_rule_publications where merchant_id=${site};
    exception when raise_exception then assert sqlerrm='attendance_operational_rule_invalid';rejected:=true;end;assert rejected,'operational_rules_projection_delete_allowed';
  end;$opr240_acl$;select 1;`);
  const unknown=await recover(uid(9000));assert.equal(unknown.receipt,null);assert.deepEqual(unknown.data,{kind:'receipt'});
  await step('rollback','rollback;');rolledBack=true;
  return {steps,reads,writes,rejections,scopes:3,historyPages:2,actualCapacityDraftCalls:27,rollbackRestored:true,
   fixtureSetup:{groupsViaRealRpc:1,syntheticForeignLocationRows:1},
   oldFactsUnchanged:true,oldArchivesUnchanged:true,realAuth:false,ruleAdoption:false,production:false};
 }catch(error){throw new Error('operational_rules_native_stage:'+stage+':'+(error?.stack??error)+':'+JSON.stringify(lastRpc));}
 finally{
  try{if(!rolledBack)await connection.step('rollback;');}finally{await connection.close();}
  assert.equal(d.fingerprint(),baseline);assert.equal(d.definitions(),definitions);assert.equal(d.tableCatalog(),catalog);
  assert.deepEqual(periodContinuationArchiveBytes(await archive()),oldArchive);assert.deepEqual(periodContinuationArchiveBytes(await periodArchive()),oldPeriod);
 }
}
