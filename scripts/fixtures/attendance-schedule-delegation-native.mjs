//198 local synthetic acceptance only. No configured production connection.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {assertLifecycleSandbox,lifecycleId as id,lifecycleJson as json,lifecycleRace} from '../merchant-attendance-lifecycle-native-support.mjs';
import {boundClockMigrationBody,quote} from './attendance-bound-clocks-native.mjs';
import {verifyScheduleDelegationBoundaries} from './attendance-schedule-delegation-boundaries-native.mjs';
import {verifyScheduleDelegationAdditionalRaces} from './attendance-schedule-delegation-races-native.mjs';
const require=createRequire(import.meta.url),rpc='faolla_attendance_schedule_delegation_v1';
const migrations=['202610060167_merchant_attendance_schedule_delegation.sql','202610060168_merchant_attendance_schedule_delegation_permissions.sql'];
export const scheduleDelegationExpression=(q,a,c=null,allow=true)=>`public.${rpc}(${json(q)},${quote(a)},${json(c)},${allow})`;
export function scheduleDelegationNativePlan(n,owner){
  assert(Number.isInteger(n)&&n>=0&&n<20);assert(/^[0-9a-f-]{36}$/.test(owner));
  const base=198000000+n*10;
  return {site:String(99990200+n),owner,employee:id(base+1),auth:id(base+2),worker:id(base+3),role:id(base+4),location:id(base+5),
    delegateEmployee:id(base+6),delegateAuth:id(base+7),delegateRole:id(base+8),otherLocation:id(base+9),name:`Synthetic198 subject ${n}`,workerNo:`SYNTHETIC198-${n}`};
}
export async function verifyScheduleDelegationNative(context,browserCheck=null){
  const {d,h,native,scope,enterprise}=context,{exec}=d;
  assert(d?.syntheticOnly===true&&h?.syntheticOnly===true&&enterprise?.syntheticOnly===true);
  assert.deepEqual(assertLifecycleSandbox(sql=>native.query(scope.sql(sql))),d.owned);
  // The inherited191/196 fixture never needed the separate owner overview120.
  // Install its actual original migration before the198 compatibility baseline.
  assert.equal(exec("select count(*) from public.faolla_schema_migrations where version=202610030120;"),'0');
  exec(boundClockMigrationBody(native.root,'202610030120_merchant_attendance_schedule_overview.sql'));
  const core=require('../../src/lib/merchantAttendanceScheduleDelegation.ts');
  let phase='install',counter=198100000,reads=0,writes=0,rejections=0;
  const next=()=>id(++counter),all=()=>d.fingerprint(d.inventory());
  const tables=d.inventory().filter(t=>t!=='faolla_schema_migrations'),before=d.fingerprint(tables);
  const oldOids=exec(`select array_agg(oid order by oid)::text from pg_proc where pronamespace=${d.owned.oid} and prokind='f';`);
  const definitions=()=>exec(`select md5(jsonb_agg(jsonb_build_array(oid,pg_get_functiondef(oid),proowner,proacl,proconfig,prosecdef) order by oid)::text)
    from pg_proc where oid=any(${quote(oldOids)}::oid[]) and proname not in('faolla_attendance_schedule_publication_guard_v1','faolla_attendance_self_schedule_slot_v1',
      'faolla_attendance_schedule_overview_v1','faolla_attendance_sources_schedule_v1','faolla_attendance_account_capture_v1','faolla_valid_merchant_enterprise_permissions_v1');`);
  const oldDefinitions=definitions(),install=()=>migrations.forEach(file=>exec(boundClockMigrationBody(native.root,file)));
  install();assert.equal(d.fingerprint(tables),before);assert.equal(definitions(),oldDefinitions);
  const firstFacts=all(),firstDefs=d.definitions(),firstCatalog=d.tableCatalog();install();
  assert.equal(all(),firstFacts);assert.equal(d.definitions(),firstDefs);assert.equal(d.tableCatalog(),firstCatalog);
  const acl=JSON.parse(exec(`select jsonb_build_object('service',has_function_privilege('service_role','public.${rpc}(jsonb,uuid,jsonb,boolean)','EXECUTE'),
    'anon',has_function_privilege('anon','public.${rpc}(jsonb,uuid,jsonb,boolean)','EXECUTE'),'authenticated',has_function_privilege('authenticated','public.${rpc}(jsonb,uuid,jsonb,boolean)','EXECUTE'),
    'private',has_table_privilege('service_role','public.merchant_attendance_schedule_delegations','SELECT'));`));
  assert.deepEqual(acl,{service:true,anon:false,authenticated:false,private:false});
  const call=expression=>JSON.parse(exec('set local role service_role;select '+expression+';'));
  const reject=(expression,code)=>{const state=all();assert.throws(()=>call(expression),new RegExp('ERROR:\\s+'+code+'(?:\\s|$)'));assert.equal(all(),state);rejections++;};
  const q=(p,access='owner',mode=access==='owner'?'list':'grants',extra={})=>({siteId:p.site,access,mode,catalog:null,grantId:null,afterId:null,fromDate:null,throughDate:null,operationId:null,...extra});
  const actor=(p,query)=>query.access==='owner'?p.owner:p.delegateAuth;
  const read=(p,query=q(p),allow=true)=>{const state=all(),result=core.parseScheduleDelegationResult(call(scheduleDelegationExpression(query,actor(p,query),null,allow)),query,{authUserId:actor(p,query)});assert.equal(all(),state);reads++;return result;};
  const write=async(p,query,command,allow=true)=>{const a=actor(p,query),result=core.parseScheduleDelegationResult(call(scheduleDelegationExpression(query,a,command,allow)),query,{authUserId:a},command);
    assert.equal(result.receipt.commandFingerprint,await core.scheduleDelegationFingerprint(query,command));writes++;return result;};
  const row=(table,p,where='')=>JSON.parse(exec(`select to_jsonb(sd_row) from public.${table} sd_row where merchant_id=${quote(p.site)} ${where};`));
  const settings=p=>row('merchant_attendance_settings',p),employee=(p,e=p.employee)=>row('merchant_enterprise_employees',p,`and id=${quote(e)}`);
  const worker=p=>row('merchant_attendance_workers',p,`and id=${quote(p.worker)}`);
  const admin=(p,kind,values)=>{const exists=exec(`select count(*) from public.merchant_attendance_settings where merchant_id=${quote(p.site)};`)!=='0';
    return call(`public.faolla_attendance_admin_v1(${quote(p.site)},${quote(p.owner)},${json({view:'workers',cursor:null,search:''})},${json({kind,operationId:next(),expectedVersion:exists?settings(p).version:0,values})},null)`);};
  const seed=n=>{const p=scheduleDelegationNativePlan(n,d.owner);
    exec(`do $sd_seed$ begin assert not exists(select 1 from public.merchants where id=${quote(p.site)}),'sd_synthetic_site_unused';
      assert not exists(select 1 from public.merchant_enterprise_employees where id in(${quote(p.employee)},${quote(p.delegateEmployee)}) or auth_user_id in(${quote(p.auth)},${quote(p.delegateAuth)})),'sd_synthetic_identity_unused';end;$sd_seed$;
      insert into public.merchants(id,user_id,name,email) values(${quote(p.site)},${quote(p.owner)},'Synthetic198 delegation','synthetic198@example.test');
      insert into public.merchant_enterprise_roles(id,merchant_id,name,permissions) values
        (${quote(p.role)},${quote(p.site)},'Synthetic198 worker',array['enterprise.view','attendance.self.view','attendance.self.clock']),
        (${quote(p.delegateRole)},${quote(p.site)},'Synthetic198 supervisor',array['enterprise.view','attendance.self.view','attendance.schedule.publish','attendance.schedule.cancel']);
      insert into public.merchant_enterprise_employees(id,merchant_id,auth_user_id,email,display_name,role_id,status,accepted_at,version) values
        (${quote(p.employee)},${quote(p.site)},${quote(p.auth)},${quote('synthetic198-worker-'+n+'@example.test')},${quote(p.name)},${quote(p.role)},'active',clock_timestamp(),1),
        (${quote(p.delegateEmployee)},${quote(p.site)},${quote(p.delegateAuth)},${quote('synthetic198-delegate-'+n+'@example.test')},'Synthetic198 supervisor',${quote(p.delegateRole)},'active',clock_timestamp(),1);`);
    admin(p,'settings',{timeZone:'UTC',enabled:true,webClockEnabled:true,webBreakPaid:false});
    for(const loc of [p.location,p.otherLocation])admin(p,'location',{id:loc,name:loc===p.location?'Synthetic198 authorized location':'Synthetic198 other location',timeZone:'UTC',active:true});
    admin(p,'worker',{id:p.worker,employeeId:p.employee,workerNo:p.workerNo,displayName:p.name,locationId:p.location,active:true,startsOn:'2000-01-01'});
    const base=Math.ceil(Date.now()/86400000)*86400000+86400000,iso=offset=>new Date(base+offset*60000).toISOString();
    p.fromDate=iso(0).slice(0,10);p.throughDate=p.fromDate;p.slots=[[iso(600),iso(660)]];
    p.grantInput={delegateEmployeeId:p.delegateEmployee,delegateAuthUserId:p.delegateAuth,workerId:p.worker,employeeId:p.employee,employeeAuthUserId:p.auth,locationId:p.location,
      actions:['publish','cancel'],includeExistingFuture:false,validFrom:new Date(Date.now()-60000).toISOString().replace('Z','000Z'),validUntil:iso(2880).replace('Z','000Z'),reason:'Synthetic198 explicit person and location'};
    return p;};
  const grant=async(p,changes={})=>{const command={action:'grant',operationId:next(),...p.grantInput,...changes},r=await write(p,q(p),command);p.grantId=r.receipt.grantId;return {query:q(p),command,receipt:r.receipt};};
  const sq=p=>q(p,'delegate','schedule',{grantId:p.grantId,fromDate:p.fromDate,throughDate:p.throughDate});
  const publish=(p,extra={})=>{const s=read(p,sq(p)).schedule;return {expectedGrantRevision:1,decision:{action:'publish',operationId:next(),expectedRevision:s.revision,expectedSettingsVersion:s.settingsVersion,
    reason:'Synthetic198 delegated publication',locationId:p.location,timeZone:s.timeZone,slots:p.slots,...extra}};};
  const cancel=(p,slotId)=>{const s=read(p,sq(p)).schedule;return {expectedGrantRevision:1,decision:{action:'cancel',operationId:next(),expectedRevision:s.revision,expectedSettingsVersion:s.settingsVersion,reason:'Synthetic198 delegated cancellation',slotId}};};
  const revoke=p=>({action:'revoke',operationId:next(),grantId:p.grantId,expectedRevision:1,reason:'Synthetic198 explicit revocation'});
  const oq=p=>({siteId:p.site,access:'owner',workerId:p.worker,fromDate:p.fromDate,throughDate:p.throughDate,operationId:null});
  const oldRead=p=>call(`public.faolla_attendance_schedule_evidenced_v1(${json(oq(p))},${quote(p.owner)},null,true)`);
  const oldPublish=(p,slots=p.slots)=>{const s=oldRead(p);return call(`public.faolla_attendance_schedule_evidenced_v1(${json(oq(p))},${quote(p.owner)},${json({action:'publish',operationId:next(),expectedRevision:s.revision,expectedSettingsVersion:settings(p).version,reason:'Synthetic198 original owner publication',locationId:p.location,timeZone:'UTC',slots})},true)`);};
  const oldCancel=(p,slotId)=>{const s=oldRead(p);return call(`public.faolla_attendance_schedule_evidenced_v1(${json(oq(p))},${quote(p.owner)},${json({action:'cancel',operationId:next(),expectedRevision:s.revision,expectedSettingsVersion:settings(p).version,reason:'Synthetic198 original owner cancellation',slotId})},true)`);};
  const status=(p,status,e=p.delegateEmployee,enabled=false)=>{const c={merchant_id:p.site,employee_id:e,expected_version:employee(p,e).version,actor_type:'owner',actor_id:p.owner,status,
    ...(status==='disabled'?{offboarding_mode:'unassign'}:{}),attendance_operation_id:next(),attendance_suspension_enabled:enabled};return call(`public.faolla_update_merchant_enterprise_employee_v1(${json(c)})`);};
  const views=p=>{const state=all(),rows=JSON.parse(exec(`select coalesce(jsonb_agg(jsonb_build_object('self',public.faolla_attendance_self_schedule_slot_v1(x),'source',public.faolla_attendance_sources_schedule_v1(x)) order by x.id),'[]') from public.merchant_attendance_schedule_slots x where merchant_id=${quote(p.site)};`));
    const overview=call(`public.faolla_attendance_schedule_overview_v1(${json({siteId:p.site,workerIds:[p.worker],fromDate:p.fromDate,throughDate:p.throughDate,revision:null,cursorDate:null,cursorStart:null,cursorId:null})},${quote(p.owner)})`);
    assert.equal(all(),state);return {rows,overview};};
  const ports={...context,core,next,all,call,reject,q,read,write,settings,employee,worker,admin,seed,grant,sq,publish,cancel,revoke,oq,oldRead,oldPublish,oldCancel,status,views};
  try{
    phase='grant-publish-and-history';const p=seed(0);await grant(p);const publication=publish(p),published=await write(p,sq(p),publication);
    assert.equal(published.receipt.actorId,p.delegateAuth);assert.equal(published.receipt.action,'publish');
    const stable=all();assert.deepEqual((await write(p,sq(p),publication,false)).receipt,published.receipt);assert.equal(all(),stable);
    assert.deepEqual(read(p,q(p,'delegate','recover',{operationId:publication.decision.operationId}),false).receipt,published.receipt);
    reject(scheduleDelegationExpression(sq(p),p.delegateAuth,{...publication,decision:{...publication.decision,reason:'Changed intent'}}),'attendance_operation_conflict');
    const schedule=read(p,sq(p)).schedule;assert.equal(schedule.entries.length,1);assert.equal(schedule.entries[0].publishedBy,p.delegateAuth);assert.equal(schedule.entries[0].canCancel,true);
    const original=oldRead(p);assert.equal(original.entries.length,1);const v=views(p);assert.equal(v.rows[0].self.publication.actorId,p.delegateAuth);assert(v.rows[0].self.slot.hasPublicationEvidence);
    const cancelled=await write(p,sq(p),cancel(p,schedule.entries[0].slotId));assert.equal(cancelled.receipt.action,'cancel');assert(views(p).rows[0].self.slot.cancelled);
    await write(p,q(p,'owner','detail',{grantId:p.grantId}),revoke(p),false);
    assert(views(p).rows[0].self.slot.cancelled);assert.deepEqual(read(p,q(p,'delegate','recover',{operationId:publication.decision.operationId}),false).receipt,published.receipt);
    reject(scheduleDelegationExpression(sq(p),p.delegateAuth,{...publication,decision:{...publication.decision,operationId:next()}}),'attendance_access_denied');
    assert.equal(read(p,q(p,'owner','detail',{grantId:p.grantId}),false).detail.status,'revoked');
    native.pass('198 actual grant, delegate publish/cancel, independent hashes, old owner/120/128/137 projections and historical receipt after revocation');
    phase='scope-and-existing-future';const b=seed(1),pre=oldPublish(b);await grant(b);
    assert.equal(read(b,sq(b)).schedule.entries.length,0);
    reject(scheduleDelegationExpression(sq(b),b.delegateAuth,cancel(b,pre.entries[0].id)),'attendance_access_denied');
    const bGrant=b.grantId;await grant(b,{includeExistingFuture:true});assert.equal(read(b,sq(b)).schedule.entries.length,1);
    await write(b,sq(b),cancel(b,pre.entries[0].id));assert(views(b).rows[0].self.slot.cancelled);
    reject(scheduleDelegationExpression(sq(b),b.auth,null,true),'attendance_access_denied');
    reject(scheduleDelegationExpression({...sq(b),siteId:p.site},b.delegateAuth,null,true),'attendance_access_denied');
    reject(scheduleDelegationExpression(sq(b),b.delegateAuth,publish(b,{locationId:b.otherLocation})),'attendance_schedule_location_changed');
    reject(scheduleDelegationExpression(sq(b),b.delegateAuth,publish(b,{timeZone:'Europe/Madrid'})),'attendance_schedule_location_changed');
    const outside=new Date(Date.parse(b.grantInput.validUntil.slice(0,23)+'Z')+3600000).toISOString();
    const end=new Date(Date.parse(outside)+3600000).toISOString(),outQuery={...sq(b),fromDate:outside.slice(0,10),throughDate:outside.slice(0,10)};
    reject(scheduleDelegationExpression(outQuery,b.delegateAuth,publish(b,{slots:[[outside,end]]})),'attendance_access_denied');
    assert(bGrant!==b.grantId);native.pass('198 default hides pregrant future shifts; explicit opt-in can cancel; cross-actor/merchant/location/timezone/range denied');
    phase='generation-and-owner-compatibility';const c=seed(2);await grant(c);const pc=publish(c);await write(c,sq(c),pc);const cs=read(c,sq(c)).schedule.entries[0];
    assert.equal(exec(`select count(*) from public.merchant_attendance_workers where merchant_id=${quote(c.site)} and employee_id=${quote(c.delegateEmployee)};`),'0');
    status(c,'disabled');status(c,'active');assert.equal(read(c,q(c,'delegate')).grants.length,0);
    reject(scheduleDelegationExpression(sq(c),c.delegateAuth,null,true),'attendance_access_denied');
    assert.equal(row('merchant_attendance_account_epochs',c,`and employee_id=${quote(c.delegateEmployee)}`).generation,1);
    assert.deepEqual(read(c,q(c,'delegate','recover',{operationId:pc.decision.operationId}),false).receipt.operationId,pc.decision.operationId);
    status(c,'disabled',c.employee,true);oldCancel(c,cs.slotId);assert(views(c).rows[0].self.slot.cancelled);
    native.pass('198 no-worker supervisor disabled with flag OFF still invalidates old grants; target pause preserves original owner cancellation and historical readers');
    phase='identity-and-permission-boundaries';const boundaries=await verifyScheduleDelegationBoundaries(ports);
    phase='atomicity-and-races';const races=await verifyScheduleDelegationRaces(ports);
    phase='additional-lifecycle-races';const additionalRaces=await verifyScheduleDelegationAdditionalRaces(ports);
    phase='service-and-browser';const integration=await prepareScheduleDelegationBrowser(ports);const browser=browserCheck?await browserCheck(ports):null;
    phase='reapply';const finalFacts=all(),finalDefs=d.definitions(),finalCatalog=d.tableCatalog();install();assert.equal(all(),finalFacts);assert.equal(d.definitions(),finalDefs);assert.equal(d.tableCatalog(),finalCatalog);assert.equal(definitions(),oldDefinitions);
    return {reads,writes,rejections,boundaries,races,additionalRaces,integration,browser,actualProtocolParsed:true,independentHashes:true,oldDefinitionsProtected:true,production:false,deployed:false};
  }catch(error){throw Error('schedule_delegation_phase='+phase+': '+String(error),{cause:error});}
}

async function verifyScheduleDelegationRaces(p){
  const {d,native,scope,seed,grant,sq,publish,revoke,q,read,all,next}=p;
  const x=seed(3);await grant(x);const command=publish(x),expression=scheduleDelegationExpression(sq(x),x.delegateAuth,command);
  const constraint='attendance_schedule_fixture_fail_198';
  d.exec(`alter table public.merchant_attendance_schedule_delegation_operations add constraint ${constraint} check(operation_id<>${quote(command.decision.operationId)}::uuid) not valid;`);
  try{const baseline=all();d.exec(`set local role service_role;do $sd_late$ declare fault_constraint text;fault_state text;begin
    begin perform ${expression};raise exception 'sd_expected_authority_failure_missing';exception when check_violation then
      get stacked diagnostics fault_constraint=CONSTRAINT_NAME,fault_state=RETURNED_SQLSTATE;
      assert fault_state='23514' and fault_constraint=${quote(constraint)},'sd_exact_fault_required';end;end;$sd_late$;`);
    assert.equal(all(),baseline);assert.equal(read(x,q(x,'delegate','recover',{operationId:command.decision.operationId})).receipt,null);
  }finally{d.exec(`alter table public.merchant_attendance_schedule_delegation_operations drop constraint ${constraint};set constraints all immediate;`);}
  const prefix='set local role service_role;',db={connect:()=>native.connect(),query:sql=>native.query(sql),sql:scope.sql};
  const repeat=await lifecycleRace(db,prefix+'select '+expression+';',prefix+'select '+expression+';');
  assert(repeat.witnessed&&!repeat.right.error);assert.deepEqual(JSON.parse(repeat.left).receipt,JSON.parse(repeat.right.output).receipt);
  const revoked=seed(4);await grant(revoked);const pending=publish(revoked),rv=revoke(revoked),rq=q(revoked,'owner','detail',{grantId:revoked.grantId});
  const revocation=await lifecycleRace(db,prefix+'select '+scheduleDelegationExpression(rq,revoked.owner,rv,false)+';',prefix+'select '+scheduleDelegationExpression(sq(revoked),revoked.delegateAuth,pending)+';');
  assert(revocation.witnessed&&revocation.right.error);assert.match(String(revocation.right.error),/attendance_access_denied/);assert.equal(read(revoked,q(revoked,'delegate','recover',{operationId:pending.decision.operationId}),false).receipt,null);
  const overlap=seed(5);await grant(overlap);const one=publish(overlap),two={...one,decision:{...one.decision,operationId:next()}};
  const competing=await lifecycleRace(db,prefix+'select '+scheduleDelegationExpression(sq(overlap),overlap.delegateAuth,one)+';',prefix+'select '+scheduleDelegationExpression(sq(overlap),overlap.delegateAuth,two)+';');
  assert(competing.witnessed&&competing.right.error);assert.match(String(competing.right.error),/attendance_version_conflict/);
  p.reject(scheduleDelegationExpression(sq(overlap),overlap.delegateAuth,publish(overlap)),'attendance_schedule_overlap');
  native.pass('198 exact23514 authority insert rollback plus three actual PID-witnessed races: same intent, revoke versus publish, concurrent overlapping publications');
  return {exactLateFailure:true,realConcurrentWaits:3,sameIntentOneReceipt:true,revokeWinnerBlocksPublish:true,overlapWinnerOnly:true};
}

async function prepareScheduleDelegationBrowser(p){
  const {q,seed,grant,call,core,native,all}=p,{executeScheduleDelegation}=require('../../src/lib/merchantAttendanceScheduleDelegation.server.ts');
  const {handleScheduleDelegation}=require('../../src/app/api/merchant-enterprise/attendance/schedule-delegation/route-handler.ts');
  const {executeAttendanceAdmin}=require('../../src/lib/merchantAttendanceAdmin.server.ts'),{handleAttendanceAdmin}=require('../../src/app/api/merchant-enterprise/attendance/admin/route-handler.ts');
  const {executeAttendanceSelf}=require('../../src/lib/merchantAttendanceSelf.server.ts'),{handleAttendanceSelf}=require('../../src/app/api/merchant-enterprise/attendance/self/route-handler.ts');
  const {resolveCanonicalPortalOrigin}=require('../../src/lib/canonicalPortalRequest.ts');
  const subjects=new Map(),calls=[];let n=10;
  const createBrowserSubject=async(options={})=>{const subject=seed(n++);subjects.set(subject.site,subject);if(options.grant)await grant(subject);return subject;};
  const service={rpc:async(name,args)=>{assert.equal(name,rpc);assert.deepEqual(Object.keys(args).sort(),['p_allow_write','p_auth_user_id','p_command','p_query']);calls.push({name,write:args.p_command!==null});
    try{return {data:call(scheduleDelegationExpression(args.p_query,args.p_auth_user_id,args.p_command,args.p_allow_write)),error:null};}
    catch(error){const code=String(error).match(/ERROR:\s+(attendance_[a-z_]+)/)?.[1];if(!code)throw error;return {data:null,error:{message:code}};}}};
  const entitlement=async()=>({permissionConfig:{allowEnterpriseManagement:true,allowEmployeeAttendance:true}});
  const handleSchedule=async(request,overrides={})=>{const value=request.method==='POST'?(await request.clone().json()).query:core.parseScheduleDelegationHttpQuery(request.url),subject=subjects.get(value.siteId);assert(subject);
    return handleScheduleDelegation(request,{authenticate:async()=>({user:{id:value.access==='owner'?subject.owner:subject.delegateAuth},authenticationMethods:['password']}),
      entitlement,allow:()=>true,enabled:()=>true,execute:input=>executeScheduleDelegation(input,service),...overrides});};
  const oldService={rpc:async(name,args)=>{assert(['faolla_attendance_admin_v1','faolla_attendance_self_v1'].includes(name));assert.equal(args.p_command,null);
    const exp=name==='faolla_attendance_admin_v1'?`public.${name}(${quote(args.p_site_id)},${quote(args.p_auth_user_id)},${json(args.p_query)},null,${quote(args.p_operation_id)})`
      :`public.${name}(${quote(args.p_site_id)},${quote(args.p_auth_user_id)},null,${quote(args.p_operation_id)})`;
    try{return {data:call(exp),error:null};}catch(error){const code=String(error).match(/ERROR:\s+(attendance_[a-z_]+)/)?.[1];if(!code)throw error;return {data:null,error:{message:code}};}}};
  const handleAdmin=request=>{assert.equal(request.method,'GET');return handleAttendanceAdmin(request,{authenticate:async()=>({user:{id:p.d.owner},authenticationMethods:['password']}),entitlement,allow:()=>true,execute:input=>executeAttendanceAdmin(input,oldService)});};
  const handleSelf=request=>{assert.equal(request.method,'GET');const subject=subjects.get(new URL(request.url).searchParams.get('siteId'));assert(subject);
    return handleAttendanceSelf(request,{authenticate:async()=>({user:{id:subject.delegateAuth},authenticationMethods:['password']}),entitlement,allow:()=>true,execute:input=>executeAttendanceSelf(input,oldService)});};
  const s=await createBrowserSubject(),origin=resolveCanonicalPortalOrigin(),headers={origin,'sec-fetch-site':'same-origin','content-type':'application/json'},url=origin+core.SCHEDULE_DELEGATION_API;
  const query=q(s),command={action:'grant',operationId:p.next(),...s.grantInput};const before=all();const list=await handleSchedule(new Request(url+'?'+core.scheduleDelegationQueryString(query),{headers}));assert.equal(list.status,200);assert.equal(all(),before);
  const saved=await handleSchedule(new Request(url,{method:'POST',headers,body:JSON.stringify({query,command})}));assert.equal(saved.status,200);const receipt=(await saved.json()).receipt;assert(receipt);
  const recover=q(s,'owner','recover',{operationId:command.operationId}),after=all();const replay=await handleSchedule(new Request(url+'?'+core.scheduleDelegationQueryString(recover),{headers}),
    {enabled:()=>false,entitlement:async()=>{throw Error('original recovery must not check current entitlement');}});
  assert.equal(replay.status,200);assert.deepEqual((await replay.json()).receipt,receipt);assert.equal(all(),after);assert.equal(calls.filter(c=>c.write).length,1);
  Object.assign(p,{owner:p.d.owner,origin,createBrowserSubject,fingerprint:all,handleSchedule,handleAdmin,handleSelf});
  native.pass('198 actual handler/service/RPC and strong synthetic Auth port: grant once then no-write flag-off original recovery');
  return {actualServiceAndHandler:true,realLogin:false,actualSqlCalls:calls.length,freshPosts:1,flagOffRecovery:true};
}
