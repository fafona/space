// Minimal160 preparation only. Root supplies the existing stopped-PG lifecycle;
// no socket, process, database, clock or production credential is opened here.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';
import {prepareGroupsNativeFixture} from '../merchant-attendance-groups-native.mjs';
import {boundClockFixtureMigrations,boundClockMigrationBody,boundClockRpcExpression,quote} from './attendance-bound-clocks-native.mjs';
import {lifecycleId as id,lifecycleJson as json} from '../merchant-attendance-lifecycle-native-support.mjs';

export const selfScheduleMigration='202610050137_merchant_attendance_self_schedule.sql';
export const selfScheduleRpc='faolla_attendance_self_schedule_v1';
export const selfScheduleIdentity=Object.freeze({site:'99990001',foreign:'99990002',owner:id(99),auth:id(1),employee:id(101),worker:id(201),
  otherAuth:id(2),otherEmployee:id(102),otherWorker:id(202),location:id(301),secondLocation:id(302),foreignWorker:id(204),foreignLocation:id(304)});
export function selfScheduleExpression(input){
  assert(input&&Object.getPrototypeOf(input)===Object.prototype);
  assert.deepEqual(Object.keys(input).sort(),['p_allow_write','p_auth_user_id','p_bind_rules','p_command','p_operation_id','p_selection','p_site_id']);
  assert.match(input.p_site_id,/^\d{8}$/);assert.match(input.p_auth_user_id,/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(typeof input.p_allow_write,'boolean');assert.equal(typeof input.p_bind_rules,'boolean');
  return `public.${selfScheduleRpc}(${quote(input.p_site_id)},${quote(input.p_auth_user_id)},${json(input.p_command)},${json(input.p_selection)},${quote(input.p_operation_id)},${input.p_allow_write},${input.p_bind_rules})`;
}
export function selfScheduleRequest(method,bodyOrQuery){
  assert(['GET','POST'].includes(method));
  const url='https://www.faolla.com/api/merchant-enterprise/attendance/self-schedule';
  return new Request(method==='GET'?`${url}?${new URLSearchParams(Object.entries(bodyOrQuery).filter(([,v])=>v!==null))}`:url,
    {method,headers:{host:'www.faolla.com',origin:'https://www.faolla.com','sec-fetch-site':'same-origin',...(method==='POST'?{'content-type':'application/json'}:{})},
      ...(method==='POST'?{body:JSON.stringify(bodyOrQuery)}:{})});
}

export async function prepareSelfScheduleNativeFixture(native,scope){
  const foundation=await prepareGroupsNativeFixture(native,scope),{exec,owned}=foundation,d=selfScheduleIdentity;
  // Install required OLD definitions only. Do not invoke the broad153 fixture:
  // no PIN KDF, terminal enrollment, QR secret, location notices or past rules.
  for(const name of [...boundClockFixtureMigrations,'202610010099_merchant_attendance_schedule.sql',
    '202610040133_merchant_attendance_shift_rule_bindings.sql','202610040134_merchant_attendance_bound_clocks.sql'])exec(boundClockMigrationBody(native.root,name));
  exec(`update public.merchant_attendance_settings set enabled=true,web_clock_enabled=true where merchant_id in('${d.site}','${d.foreign}');
    update public.merchant_enterprise_roles set permissions=array['enterprise.view','attendance.self.view','attendance.self.clock'] where merchant_id='${d.site}';
    insert into public.merchant_enterprise_roles(id,merchant_id,name,permissions) values('${id(40)}','${d.foreign}','Synthetic foreign role',array['enterprise.view','attendance.self.view','attendance.self.clock']);
    insert into public.merchant_enterprise_employees(id,merchant_id,auth_user_id,email,display_name,role_id,status) values
      ('${id(104)}','${d.foreign}','${id(4)}','self-schedule-foreign@example.invalid','Synthetic foreign employee','${id(40)}','active');
    insert into public.merchant_attendance_locations(id,merchant_id,name,time_zone,active) values
      ('${d.location}','${d.site}','选班合成地点 <img src=x>','UTC',true),('${d.secondLocation}','${d.site}','选班第二地点','UTC',true),('${d.foreignLocation}','${d.foreign}','Synthetic foreign location','UTC',true);
    update public.merchant_attendance_workers set default_location_id='${d.location}' where id in('${d.worker}','${d.otherWorker}');
    update public.merchant_attendance_workers set employee_id='${id(104)}',default_location_id='${d.foreignLocation}' where id='${d.foreignWorker}';
    insert into public.merchant_attendance_employment_periods(merchant_id,worker_id,starts_on) values
      ('${d.site}','${d.worker}','2000-01-01'),('${d.site}','${d.otherWorker}','2000-01-01'),('${d.foreign}','${d.foreignWorker}','2000-01-01');`);
  //136 intentionally has an online concurrent-index phase OUTSIDE BEGIN.
  exec('select 1;');native.query(scope.sql(readFileSync(path.join(native.root,'scripts/supabase-migrations/202610050136_merchant_attendance_schedule_publication_evidence.sql'),'utf8')));
  const inventory=()=>JSON.parse(exec(`select jsonb_agg(relname order by relname) from pg_class where relnamespace=${owned.oid} and relkind in('r','p');`));
  const fingerprint=(selected=inventory())=>{
    assert(selected.length>0&&selected.every(t=>/^(?:merchants|faolla_schema_migrations|merchant_[a-z0-9_]+)$/.test(t)));
    return exec(`select md5(jsonb_object_agg(name,rows order by name)::text) from (${selected.map(t=>`select ${quote(t)} name,(select coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text),'[]') from public.${t} r) rows`).join(' union all ')}) all_tables;`);
  };
  const oldOids=exec(`select array_agg(oid order by oid)::text from pg_proc where pronamespace=${owned.oid} and prokind='f';`);
  const definitions=(onlyOld=false)=>exec(`select md5(jsonb_agg(jsonb_build_array(p.oid,pg_get_functiondef(p.oid),p.proowner,p.proacl,p.proconfig,p.prosecdef) order by p.oid)::text) from pg_proc p where p.pronamespace=${owned.oid} and p.prokind='f' ${onlyOld?`and p.oid=any(${quote(oldOids)}::oid[])`:''};`);
  const tableCatalog=()=>exec(`select jsonb_agg(jsonb_build_array(c.oid,c.relname,c.relowner,c.relacl,c.relrowsecurity,
    (select jsonb_agg(pg_get_constraintdef(k.oid) order by k.conname) from pg_constraint k where k.conrelid=c.oid),
    (select jsonb_agg(pg_get_triggerdef(t.oid) order by t.tgname) from pg_trigger t where t.tgrelid=c.oid and not t.tgisinternal)) order by c.oid)
    from pg_class c where c.relnamespace=${owned.oid} and c.relkind in('r','p');`);
  const oldTables=inventory(),oldDefinitions=definitions(true),oldRows=fingerprint(oldTables.filter(t=>t!=='faolla_schema_migrations')),oldCatalog=JSON.parse(tableCatalog());
  exec(boundClockMigrationBody(native.root,selfScheduleMigration));
  assert.equal(definitions(true),oldDefinitions,'self_schedule_changed_old_functions');assert.equal(fingerprint(oldTables.filter(t=>t!=='faolla_schema_migrations')),oldRows);
  assert.deepEqual(JSON.parse(tableCatalog()).filter(r=>oldCatalog.some(old=>old[0]===r[0])),oldCatalog,'self_schedule_changed_old_table_catalog');
  const installedDefinitions=definitions(),installedCatalog=tableCatalog(),beforeReapply=fingerprint();exec(boundClockMigrationBody(native.root,selfScheduleMigration));
  assert.equal(definitions(),installedDefinitions);assert.equal(tableCatalog(),installedCatalog);assert.equal(fingerprint(),beforeReapply);
  const today=exec("select (clock_timestamp() at time zone 'UTC')::date::text;"),day=n=>new Date(Date.parse(today+'T00:00:00.000Z')+n*86400000).toISOString().slice(0,10);
  const scheduleQuery=(workerId=d.worker,siteId=d.site)=>({siteId,access:'owner',workerId,fromDate:day(1),throughDate:day(3),operationId:null});
  let operation=40000;
  const scheduleRevision=(siteId=d.site)=>Number(exec(`select coalesce(max(revision),0) from public.merchant_attendance_schedule_commands where merchant_id=${quote(siteId)};`));
  const publication=(slots,{workerId=d.worker,siteId=d.site,locationId=d.location,ownerId=d.owner,evidenced=true}={})=>{
    const query=scheduleQuery(workerId,siteId),command={operationId:id(++operation),expectedRevision:scheduleRevision(siteId),expectedSettingsVersion:1,reason:'Synthetic160 actual schedule publication',action:'publish',locationId,timeZone:'UTC',slots};
    const result=JSON.parse(exec(`set local role service_role;select public.${evidenced?'faolla_attendance_schedule_evidenced_v1':'faolla_attendance_schedule_v1'}(${json(query)},${quote(ownerId)},${json(command)},true);`));
    return {command,query,result,slots:result.entries.filter(s=>s.revision===command.expectedRevision+1)};
  };
  const main=publication([...Array.from({length:8},(_,n)=>[`${day(1)}T${String(n).padStart(2,'0')}:00:00.000Z`,`${day(1)}T${String(n).padStart(2,'0')}:30:00.000Z`]),
    [`${day(1)}T23:30:00.000Z`,`${day(2)}T00:30:00.000Z`]]);
  const legacy=publication([[`${day(1)}T08:00:00.000Z`,`${day(1)}T08:30:00.000Z`]],{evidenced:false});
  const other=publication([[`${day(1)}T09:00:00.000Z`,`${day(1)}T09:30:00.000Z`]],{workerId:d.otherWorker});
  const foreign=publication([[`${day(1)}T10:00:00.000Z`,`${day(1)}T10:30:00.000Z`]],{workerId:d.foreignWorker,siteId:d.foreign,locationId:d.foreignLocation,ownerId:id(98)});
  const selected=slot=>({slotId:slot.id,revision:slot.revision});
  const slots={main:main.slots[0],cancelBefore:main.slots[1],cancelAfter:main.slots[2],cancelRaceBefore:main.slots[3],cancelRaceAfter:main.slots[4],
    race:main.slots[5],browser:main.slots[6],alternate:main.slots[7],overnight:main.slots[8],legacy:legacy.slots[0],other:other.slots[0],foreign:foreign.slots[0]};
  const cancelCommand=slot=>({operationId:id(++operation),expectedRevision:scheduleRevision(),expectedSettingsVersion:1,reason:'Synthetic160 actual cancellation',action:'cancel',slotId:slot.id});
  const cancelExpression=c=>`public.faolla_attendance_schedule_v1(${json(scheduleQuery())},${quote(d.owner)},${json(c)},true)`;
  const cancel=slot=>{const command=cancelCommand(slot);return JSON.parse(exec(`set local role service_role;select ${cancelExpression(command)};`));};
  const sequence=()=>Number(exec(`select coalesce(max(sequence),0) from public.merchant_attendance_events where merchant_id='${d.site}' and worker_id='${d.worker}';`));
  const command=(action='clock_in',patch={})=>({expectedWorkerId:d.worker,operationId:id(++operation),locationId:d.location,action,expectedSequence:sequence(),...patch});
  const input=(c=null,selection=null,operationId=null,patch={})=>({p_site_id:d.site,p_auth_user_id:d.auth,p_command:c,p_selection:selection,p_operation_id:operationId,p_allow_write:true,p_bind_rules:false,...patch});
  const require=createRequire(import.meta.url),{executeAttendanceSelfSchedule}=require('../../src/lib/merchantAttendanceSelfSchedule.server.ts');
  const {parseSelfScheduleHttpResult}=require('../../src/lib/merchantAttendanceSelfSchedule.ts');
  const {handleAttendanceSelfSchedule}=require('../../src/app/api/merchant-enterprise/attendance/self-schedule/route-handler.ts');
  const {executeAttendanceSelf}=require('../../src/lib/merchantAttendanceSelf.server.ts');
  const {handleAttendanceSelf}=require('../../src/app/api/merchant-enterprise/attendance/self/route-handler.ts');
  const calls=[];
  const service={rpc:async(name,args)=>{
    assert([selfScheduleRpc,'faolla_attendance_self_v1','faolla_attendance_self_bound_v1'].includes(name));calls.push({name,command:args.p_command?.action??null,allow:args.p_allow_write??null,bind:args.p_bind_rules??null});
    try{return {data:JSON.parse(exec(`set local role service_role;select ${name===selfScheduleRpc?selfScheduleExpression(args):boundClockRpcExpression(name,args)};`)),error:null};}
    catch(error){const code=String(error).match(/ERROR:\s+(attendance_[a-z_]+)/)?.[1];if(!code)throw error;return {data:null,error:{message:code}};}
  }};
  const authContext=async()=>({user:{id:d.auth},authenticationMethods:['password']});
  const entitlement=async()=>({permissionConfig:{allowEnterpriseManagement:true,allowEmployeeAttendance:true}});
  const handle=(request,overrides={})=>handleAttendanceSelfSchedule(request,{authenticate:authContext,entitlement,allow:()=>true,execute:requestInput=>executeAttendanceSelfSchedule(requestInput,service),...overrides});
  const handleOld=(request,overrides={})=>handleAttendanceSelf(request,{enabled:()=>true,authenticate:authContext,entitlement,allow:()=>true,execute:requestInput=>executeAttendanceSelf(requestInput,service),...overrides});
  const request=async(c=null,selection=null,operationId=null,overrides={})=>{
    const response=await handle(selfScheduleRequest(c?'POST':'GET',c?{siteId:d.site,command:c,selection}:{siteId:d.site,operationId}),overrides);
    assert.equal(response.headers.get('cache-control'),'private, no-store');const body=await response.json();
    if(response.status===200)assert.deepEqual(parseSelfScheduleHttpResult(body,{siteId:d.site,command:c,operationId,...(c?{selection}:{})}),body);
    return {status:response.status,body};
  };
  const oldClock=async(action,patch={})=>executeAttendanceSelf({siteId:d.site,authUserId:d.auth,command:command(action,patch),operationId:null},service);
  const counts=()=>JSON.parse(exec(`select jsonb_build_object('events',(select count(*) from public.merchant_attendance_events),
    'relations',(select count(*) from public.merchant_attendance_shift_schedule_relations),
    'bindings',(select count(*) from public.merchant_attendance_shift_rule_bindings),'sources',(select count(*) from public.merchant_attendance_shift_rule_sources));`));
  return {...d,exec,owned,guard:foundation.plan.guard,sql:scope.sql,today,day,inventory,fingerprint,definitions,tableCatalog,oldDefinitions,installedDefinitions,installedCatalog,
    slots,selected,scheduleQuery,scheduleRevision,publication,cancelCommand,cancelExpression,cancel,sequence,command,input,service,calls,handle,handleOld,request,oldClock,counts,
    readRaw:(c=null,selection=null,op=null,patch={})=>JSON.parse(exec(`set local role service_role;select ${selfScheduleExpression(input(c,selection,op,patch))};`)),syntheticOnly:true,
    realAuthentication:false,actualOld111:true,actualBound134:true,syntheticPastRules:false};
}
