// Independent owner-approved candidate exceptions only. Import is inert; the
// caller owns the explicitly named stopped synthetic cluster and namespace.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {runAttendanceLabelsReuse} from './merchant-attendance-choice-labels-reuse-native.mjs';
import {withAttendanceConcurrencySandbox} from './merchant-attendance-concurrency-sandbox.mjs';
import {prepareGroupsNativeFixture,groupsNativePlan} from './merchant-attendance-groups-native.mjs';
import {rulesMigrationPlan,rulesNativeFailure} from './merchant-attendance-rules-native.mjs';
import {assertLifecycleSandbox,lifecycleId as id,lifecycleJson as json,lifecycleRace} from './merchant-attendance-lifecycle-native-support.mjs';

const site='99990001',foreign='99990002',owner=id(99),other=id(98),worker=id(201),secondWorker=id(202),unboundWorker=id(203),foreignWorker=id(204);
const rpc='faolla_attendance_personal_rules_v1',migrationName='202610040129_merchant_attendance_personal_rules.sql';
export const personalRulesNativeTables=Object.freeze(['merchant_attendance_personal_rule_streams','merchant_attendance_personal_rule_operations']);
const require=createRequire(import.meta.url),quote=value=>"'"+String(value).replaceAll("'","''")+"'";
const labels=Object.freeze([
  'personal129 installs/reapplies without changing old functions, ACLs or facts and seeds neither new table',
  'personal actual approval and future withdrawal retain original identity, interval, choices and immutable receipts',
  'personal UTC overlap rejects conflicts while adjacent inclusive civil dates and withdrawn replacement are accepted',
  'personal paused and inactive same-identity GET/POST recovery preserves receipts while fresh approvals are denied',
  'personal identity/Auth rebinding, current ownership, tenant, worker and operation fences prevent cross-person recovery',
  'personal exact commands, explicit zero/disabled/inherit, date existence, future-only start and31-date bound agree with TypeScript',
  'personal exactly26 revisions page25+1 without omitted, duplicate or rewritten receipts',
  'personal two real connections witness one exact blocking PID and one same-revision approval wins',
  'personal actual handler/service/parser performs a fresh approval and paused recovery with synthetic authentication only',
  'personal private ACLs and append-only ledger probes restore all facts and preserve every old table',
]);
let phase='entry';
export const personalRulesQueryInput=(patch={})=>({siteId:site,workerId:worker,operationId:null,beforeRevision:null,...patch});
export const personalRulesNativeChoices=()=>({lateGraceMinutes:{mode:'value',minutes:0},earlyGraceMinutes:{mode:'disabled'},openSpanWarningMinutes:{mode:'inherit'},completedBreakMinimumMinutes:{mode:'value',minutes:1}});
export const personalRulesNativeApprove=(n,expectedRevision,startsOn,endsOn=startsOn,patch={})=>({operationId:id(n),action:'approve',expectedRevision,
  reason:'Synthetic owner-approved candidate exception',expectedWorkerVersion:1,expectedSettingsVersion:1,employeeId:id(101),employeeAuthUserId:id(1),timeZone:'UTC',
  startsOn,endsOn,rules:personalRulesNativeChoices(),...patch});
export const personalRulesNativeWithdraw=(n,expectedRevision,approvedRevision,patch={})=>({operationId:id(n),action:'withdraw',expectedRevision,
  reason:'Synthetic future exception withdrawal',approvedRevision,...patch});
const expression=(query=personalRulesQueryInput(),command=null,allow=false,actor=owner)=>
  `public.${rpc}(${json(query)},'${actor}',${json(command)},${allow===null?'null':allow?'true':'false'})`;
const denied=(code,expr)=>`begin perform ${expr};raise exception 'personal_unexpected_acceptance';exception when sqlstate 'P0001' then if sqlerrm<>${quote(code)} then raise;end if;end;`;
export function personalRulesNativeFailure(error){
  const safe=rulesNativeFailure(error),text=error instanceof Error?error.message:'',code=text.match(/ERROR:\s+(?:[0-9A-Z]{5}:\s+)?([a-z_]+)(?=\r?\n|$)/)?.[1];
  const known=new Set(['attendance_worker_not_found','attendance_personal_rule_invalid','attendance_personal_rule_future_required','attendance_personal_rule_overlap',
    'attendance_personal_rule_already_withdrawn','attendance_personal_rule_worker_inactive','attendance_personal_rule_identity_changed',
    'merchant_attendance_personal_rules_prerequisite_required','merchant_attendance_personal_rules_installation_conflict']);
  return {...safe,error:'personal_rules_native_failed',phase,...(known.has(code)?{code,sqlMessage:code}:{})};
}
export function personalRulesMigrationPlan(root,scope){
  assert(typeof root==='string'&&path.isAbsolute(root));assert(scope&&/^attendance_race_[a-f0-9]{32}$/.test(scope.schema)&&typeof scope.sql==='function');
  const source=readFileSync(path.join(root,'scripts/supabase-migrations',migrationName),'utf8');
  const body=source.replace(/^begin;\s*$/m,'').replace(/^commit;\s*$/m,''),statement=scope.sql(body);
  assert(!/\bpublic\./.test(statement));assert(!/search_path\s*(?:=|to)\s*(?:pg_catalog,\s*)?public\b/.test(statement));return {name:migrationName,source,body,statement};
}
export function personalRulesNativePlan(owned,tables){
  const guard=groupsNativePlan(owned,tables).guard;
  for(const table of personalRulesNativeTables)assert(tables.includes(table));
  const fingerprint=selected=>`(select md5(jsonb_build_object(${selected.map(table=>`${quote(table)},(select coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text),'[]'::jsonb) from public.${table} r)`).join(',')})::text))`;
  return {guard,fingerprint:fingerprint(tables),protectedFingerprint:fingerprint(tables.filter(table=>!personalRulesNativeTables.includes(table))),labels:[...labels]};
}

export async function checkAttendancePersonalRulesNative(native,scope){
  phase='install';const foundation=await prepareGroupsNativeFixture(native,scope),{exec,owned}=foundation;
  const {parsePersonalRulesResult,parsePersonalRulesQuery,parsePersonalRulesBody,parsePersonalRulesResponse,personalRulesQueryString,PERSONAL_RULES_ERRORS}=require('../src/lib/merchantAttendancePersonalRules.ts');
  const {attendanceDayUtcRange}=require('../src/lib/merchantAttendanceTime.ts');
  exec(rulesMigrationPlan(native.root,scope).body);
  const oldFunctions=()=>exec(`select md5(coalesce(jsonb_agg(jsonb_build_array(p.proname,pg_get_functiondef(p.oid),p.proowner,p.proacl) order by p.proname,p.oid),'[]'::jsonb)::text)
    from pg_proc p where p.pronamespace=${owned.oid} and p.proname not like 'faolla_attendance_personal_rule%';`);
  const functionsBefore=oldFunctions(),migration=personalRulesMigrationPlan(native.root,scope);
  // Only the registry insertion may differ during installation; all business
  // tables are compared separately below and the registry is protected thereafter.
  const inventory=()=>JSON.parse(exec(`select jsonb_agg(relname order by relname) from pg_class where relnamespace=${owned.oid} and relkind in('r','p');`));
  const oldTables=inventory().filter(table=>table!=='faolla_schema_migrations');
  const oldData=()=>exec(`select md5(jsonb_build_object(${oldTables.map(table=>`${quote(table)},(select coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text),'[]'::jsonb) from public.${table} r)`).join(',')})::text);`);
  const oldDataBefore=oldData();
  exec(migration.body);assert.equal(oldFunctions(),functionsBefore,'personal_install_changed_old_functions');assert.equal(oldData(),oldDataBefore,'personal_install_changed_old_facts');
  const tables=inventory(),plan=personalRulesNativePlan(owned,tables),fingerprint=()=>exec(`select ${plan.fingerprint};`),protectedFingerprint=()=>exec(`select ${plan.protectedFingerprint};`);
  const installed=()=>exec(`select jsonb_build_object('functions',(select jsonb_agg(jsonb_build_array(p.proname,pg_get_functiondef(p.oid),p.proowner,p.proacl) order by p.proname,p.oid)
    from pg_proc p where p.pronamespace=${owned.oid}),'tables',(select jsonb_agg(jsonb_build_array(c.relname,c.relowner,c.relacl,c.relrowsecurity) order by c.relname)
    from pg_class c where c.relnamespace=${owned.oid} and c.relkind in('r','p')),'triggers',(select jsonb_agg(pg_get_triggerdef(t.oid) order by t.tgrelid,t.tgname)
    from pg_trigger t join pg_class c on c.oid=t.tgrelid where c.relnamespace=${owned.oid} and not t.tgisinternal),
    'indexes',(select jsonb_agg(indexdef order by indexname) from pg_indexes where schemaname=${quote(owned.schema)}));`);
  const definition=installed(),empty=fingerprint();exec(migration.body);assert.equal(installed(),definition,'personal_reapply_changed_definition_acl');assert.equal(fingerprint(),empty,'personal_reapply_changed_facts');
  for(const table of personalRulesNativeTables)assert.equal(exec(`select count(*) from public.${table};`),'0');
  const protectedBefore=protectedFingerprint(),q=personalRulesQueryInput;
  let successfulCalls=0;
  const parse=(raw,query,command=null,actor=owner)=>{const parsed=parsePersonalRulesResult(raw,query,command,actor);assert.deepEqual(parsed,raw,'personal_SQL_parser_disagreed');return parsed;};
  const call=(query=q(),command=null,allow=false,actor=owner)=>{const parsed=parse(JSON.parse(exec(`set local role service_role;select ${expression(query,command,allow,actor)};`)),query,command,actor);successfulCalls++;return parsed;};
  const read=(patch={},actor=owner)=>call(q(patch),null,false,actor),write=(command,target=worker,allow=true,actor=owner)=>call(q({workerId:target}),command,allow,actor);
  const expr=(command,target=worker,allow=true,actor=owner)=>expression(q({workerId:target}),command,allow,actor);
  const rollback=(setup,checks)=>{const before=fingerprint();exec(`begin;reset role;${setup}set local role service_role;do $checks$ declare a jsonb;b jsonb;begin ${checks} end;$checks$;rollback;`);assert.equal(fingerprint(),before,'personal_rollback_probe_not_restored');};
  const probe=(setup,query=q(),command=null,allow=false,actor=owner)=>{const before=fingerprint();const raw=JSON.parse(exec(`begin;reset role;${setup}set local role service_role;select ${expression(query,command,allow,actor)};rollback;`));assert.equal(fingerprint(),before,'personal_projection_probe_not_restored');successfulCalls++;return parse(raw,query,command,actor);};
  const dates=JSON.parse(exec(`select jsonb_build_object('today',(clock_timestamp() at time zone 'UTC')::date::text,
    'madridFirst',make_date(extract(year from clock_timestamp())::integer+1,3,25)::text,'madridLast',make_date(extract(year from clock_timestamp())::integer+1,3,31)::text);`));
  const day=n=>new Date(Date.parse(dates.today+'T00:00:00.000Z')+n*86400000).toISOString().slice(0,10);
  const second={employeeId:id(102),employeeAuthUserId:id(2)},originals=new Map();
  const keep=(command,target=worker)=>{const result=write(command,target);assert.deepEqual(result.receipt.command,command);assert.equal(result.receipt.revision,command.expectedRevision+1);
    assert.equal(result.receipt.item.actorId,owner);assert.equal(result.worker.workerId,target);originals.set(command.operationId,result.receipt);return result;};

  phase='approve-withdraw-and-adjacency';const initial=read();assert.equal(initial.protocol,'personal-rules-v1');assert.equal(initial.revision,0);assert.deepEqual(initial.items,[]);assert.equal(initial.receipt,null);
  const approve=personalRulesNativeApprove(1001,0,day(7),day(8)),withdraw=personalRulesNativeWithdraw(1002,1,1);
  const approved=keep(approve);assert.equal(approved.receipt.item.employeeId,id(101));assert.equal(approved.receipt.item.employeeAuthUserId,id(1));assert.deepEqual(approved.receipt.item.rules,personalRulesNativeChoices());
  assert.equal(approved.receipt.item.fromAt,day(7)+'T00:00:00.000Z');assert.equal(approved.receipt.item.toAt,day(9)+'T00:00:00.000Z');
  const withdrawn=keep(withdraw);assert.equal(withdrawn.items.find(item=>item.revision===1).withdrawnByRevision,2);
  for(const key of ['employeeId','employeeAuthUserId','workerVersion','settingsVersion','timeZone','startsOn','endsOn','fromAt','toAt','rules'])assert.deepEqual(withdrawn.receipt.item[key],approved.receipt.item[key]);
  assert(!Object.hasOwn(approved.receipt.item,'withdrawnByRevision'));
  const replacement=personalRulesNativeApprove(1003,2,day(7),day(8)),adjacent=personalRulesNativeApprove(1004,3,day(9));keep(replacement);keep(adjacent);
  rollback('',denied('attendance_personal_rule_overlap',expr(personalRulesNativeApprove(1101,4,day(8),day(10))))+
    denied('attendance_personal_rule_already_withdrawn',expr(personalRulesNativeWithdraw(1102,4,1)))+
    denied('attendance_not_available',expr(personalRulesNativeWithdraw(1103,4,2))));

  phase='paused-inactive-original-recovery';const contextChange=`update public.merchant_attendance_workers set active=false,version=version+1 where merchant_id='${site}' and id='${worker}';
    update public.merchant_enterprise_employees set status='disabled' where merchant_id='${site}' and id='${id(101)}';
    update public.merchant_attendance_settings set time_zone='Europe/Madrid',version=version+1 where merchant_id='${site}';`;
  rollback(contextChange,`a:=${expression(q({operationId:approve.operationId}))};assert a->'receipt'=${json(originals.get(approve.operationId))},'original receipt changed';
    assert a->'worker'->'active'='false'::jsonb and a->>'timeZone'='Europe/Madrid','current context lost';a:=${expr(approve,worker,false)};
    assert a->'receipt'=${json(originals.get(approve.operationId))},'paused old command changed';`+
    denied('attendance_personal_rule_worker_inactive',expr(personalRulesNativeApprove(1201,4,day(20),day(20),{expectedWorkerVersion:2,expectedSettingsVersion:2,timeZone:'Europe/Madrid'})))+
    `a:=${expr(personalRulesNativeWithdraw(1202,4,3))};assert a->'receipt'->'item'->>'approvedRevision'='3','inactive subject future withdrawal failed';`);
  const noBinding=read({workerId:unboundWorker});assert.equal(noBinding.revision,0);assert.equal(noBinding.worker.employeeId,null);assert.equal(noBinding.worker.employeeAuthUserId,null);
  rollback('',denied('attendance_personal_rule_worker_inactive',expr(personalRulesNativeApprove(1203,0,day(20)),unboundWorker))+
    denied('attendance_platform_paused',expr(personalRulesNativeApprove(1204,4,day(20)),worker,false)));

  phase='identity-owner-and-operation-fences';
  for(const setup of [
    `update public.merchant_enterprise_employees set auth_user_id='${id(97)}' where merchant_id='${site}' and id='${id(101)}';`,
    `update public.merchant_attendance_workers set employee_id=null,version=version+1 where merchant_id='${site}' and id='${worker}';`,
  ])rollback(setup,denied('attendance_personal_rule_identity_changed',expression(q()))+
    denied('attendance_personal_rule_identity_changed',expression(q({operationId:approve.operationId})))+
    denied('attendance_personal_rule_identity_changed',expr(approve,worker,false))+
    denied('attendance_personal_rule_identity_changed',expr(personalRulesNativeWithdraw(1301,4,3))));
  rollback('',denied('attendance_access_denied',expression(q(),null,false,other))+
    denied('attendance_access_denied',expression(q({siteId:foreign})))+
    denied('attendance_worker_not_found',expression(q({workerId:foreignWorker})))+
    denied('attendance_worker_not_found',expression(q({workerId:id(9999)})))+
    denied('attendance_access_denied',expression(q({workerId:secondWorker,operationId:approve.operationId})))+
    denied('attendance_access_denied',expr({...approve,...second},secondWorker,false))+
    denied('attendance_operation_conflict',expr({...approve,reason:'Different original command'},worker,false))+
    denied('attendance_personal_rule_identity_changed',expr(personalRulesNativeApprove(1302,4,day(20),day(20),{employeeAuthUserId:id(2)}))));
  rollback(`update public.merchants set user_id='${other}' where id='${site}';`,
    denied('attendance_access_denied',expression(q({operationId:approve.operationId})))+
    denied('attendance_access_denied',expression(q({operationId:approve.operationId}),null,false,other))+
    denied('attendance_access_denied',expr(approve,worker,false,other))+
    `a:=${expression(q(),null,false,other)};assert a->>'actorId'='${other}' and a->'items'->0->>'actorId'='${owner}','history actor relabelled';`);

  phase='strict-shapes-values-and-future-dates';
  const badQueries=[null,{}, {...q(),extra:true},{...q(),workerId:null},{...q(),beforeRevision:0},{...q(),beforeRevision:1.5},{...q(),beforeRevision:2,operationId:approve.operationId}];
  const clean=personalRulesNativeApprove(1401,4,day(20));
  const badCommands=[{...clean,extra:true},{...clean,reason:' leading'},{...clean,reason:'x\u0085'},{...clean,expectedRevision:0.5},
    {...clean,rules:Object.fromEntries(Object.keys(clean.rules).map(key=>[key,{mode:'inherit'}]))},
    {...clean,rules:{...clean.rules,lateGraceMinutes:{mode:'inherit',minutes:0}}},
    {...clean,rules:{...clean.rules,earlyGraceMinutes:{mode:'disabled',minutes:0}}},
    ...[-1,1441,0.5,'0',null].map(minutes=>({...clean,rules:{...clean.rules,lateGraceMinutes:{mode:'value',minutes}}})),
    {...clean,rules:{...clean.rules,openSpanWarningMinutes:{mode:'value',minutes:0}}},
    {...clean,endsOn:day(52)},{...clean,startsOn:'2026-02-30'},{...clean,endsOn:'2101-01-01'},
    {...personalRulesNativeWithdraw(1402,4,3),timeZone:'UTC'}];
  // Separate bounded statements retain the original10s timeout; no giant test DO.
  for(const query of badQueries)rollback('',denied('attendance_invalid_request',expression(query)));
  for(const command of badCommands)rollback('',denied('attendance_invalid_request',expr(command)));
  rollback('',denied('attendance_invalid_request',expression(q(),null,null))+
    denied('attendance_invalid_request',expression(q({operationId:approve.operationId}),approve,true))+
    denied('attendance_invalid_request',expression(q({beforeRevision:2}),approve,true))+
    denied('attendance_version_conflict',expr({...clean,expectedRevision:3}))+
    denied('attendance_version_conflict',expr({...clean,expectedWorkerVersion:2}))+
    denied('attendance_version_conflict',expr({...clean,expectedSettingsVersion:2}))+
    denied('attendance_version_conflict',expr({...clean,timeZone:'Europe/Madrid'}))+
    denied('attendance_personal_rule_future_required',expr({...clean,startsOn:dates.today,endsOn:dates.today})));
  const maximum=personalRulesNativeApprove(1501,0,day(60),day(90),second);
  const maxResult=probe('',q({workerId:secondWorker}),maximum,true);assert.equal(maxResult.receipt.item.endsOn,day(90));
  const madrid=personalRulesNativeApprove(1502,0,dates.madridFirst,dates.madridLast,{...second,timeZone:'Europe/Madrid',expectedSettingsVersion:2});
  const shifted=probe(`update public.merchant_attendance_settings set time_zone='Europe/Madrid',version=version+1 where merchant_id='${site}';`,q({workerId:secondWorker}),madrid,true);
  assert.equal(shifted.receipt.item.fromAt,attendanceDayUtcRange(madrid.startsOn,madrid.timeZone).startAt);
  assert.equal(shifted.receipt.item.toAt,attendanceDayUtcRange(madrid.endsOn,madrid.timeZone).endAt);
  for(const patch of [{startsOn:'2011-12-30',endsOn:'2011-12-31'},{startsOn:'2011-12-29',endsOn:'2011-12-30'}])rollback(
    `update public.merchant_attendance_settings set time_zone='Pacific/Apia',version=version+1 where merchant_id='${site}';`,
    denied('attendance_invalid_request',expr(personalRulesNativeApprove(1503,0,patch.startsOn,patch.endsOn,{...second,timeZone:'Pacific/Apia',expectedSettingsVersion:2}),secondWorker)));
  const boundaries=JSON.parse(exec(`select jsonb_build_object('skippedNext',to_char(public.faolla_attendance_personal_rule_end_v1('2011-12-29','Pacific/Apia') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'lastSupported',to_char(public.faolla_attendance_personal_rule_end_v1('2100-12-31','UTC') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));`));
  assert.equal(boundaries.skippedNext,attendanceDayUtcRange('2011-12-29','Pacific/Apia').endAt);assert.equal(boundaries.lastSupported,'2101-01-01T00:00:00.000Z');

  phase='exact26-revision-pagination';
  // Eleven approve/withdraw pairs reuse a non-overlapping future interval. Each
  // real result passes the public TS parser; no operation/table is seeded.
  for(let revision=5;revision<=26;revision++)keep(revision%2?personalRulesNativeApprove(1000+revision,revision-1,day(40)):personalRulesNativeWithdraw(1000+revision,revision-1,revision-1));
  const beforeReads=fingerprint(),first=read(),secondPage=read({beforeRevision:first.nextBeforeRevision});
  assert.equal(first.items.length,25);assert.equal(first.nextBeforeRevision,2);assert.equal(secondPage.items.length,1);assert.equal(secondPage.nextBeforeRevision,null);
  assert.deepEqual([...first.items,...secondPage.items].map(item=>item.revision),Array.from({length:26},(_,n)=>26-n));
  assert.equal(new Set([...first.items,...secondPage.items].map(item=>item.operationId)).size,26);assert.equal(read({operationId:id(9998)}).receipt,null);
  for(const command of [approve,withdraw,replacement,adjacent]){assert.deepEqual(read({operationId:command.operationId}).receipt,originals.get(command.operationId));assert.deepEqual(write(command,worker,false).receipt,originals.get(command.operationId));}
  assert.equal(fingerprint(),beforeReads,'personal_read_replay_changed_facts');

  phase='exact-PID-approval-CAS-race';assert.deepEqual(assertLifecycleSandbox(source=>native.query(scope.sql(source))),owned);
  const left=personalRulesNativeApprove(5001,0,day(7),day(8),second),right=personalRulesNativeApprove(5002,0,day(10),day(10),second);
  const race=await lifecycleRace({connect:native.connect,query:native.query,sql:scope.sql},
    `reset role;${plan.guard}set local role service_role;select ${expr(left,secondWorker)};`,
    `reset role;${plan.guard}set local role service_role;select ${expr(right,secondWorker)};`);
  assert.equal(race.witnessed,true);const winner=parse(JSON.parse(race.left),q({workerId:secondWorker}),left);assert.equal(winner.revision,1);successfulCalls++;
  assert(race.right.error,'same-revision waiter must fail');assert(race.right.error.message.includes('attendance_version_conflict'),'waiter must see committed stream');
  assert.equal(read({workerId:secondWorker,operationId:right.operationId}).receipt,null);assert.deepEqual(write(left,secondWorker,false).receipt,winner.receipt);

  phase='actual-handler-service-approval-and-replay';
  const {executePersonalRules}=require('../src/lib/merchantAttendancePersonalRules.server.ts');
  const {handlePersonalRules}=require('../src/app/api/merchant-enterprise/attendance/personal-rules/route-handler.ts');
  const {MerchantEnterpriseAccessError}=require('../src/lib/merchantEnterpriseAuth.server.ts');
  const {resolveCanonicalPortalOrigin}=require('../src/lib/canonicalPortalRequest.ts');
  let serviceCalls=0,moduleEnabled=true;
  const service={rpc:async(name,args)=>{assert.equal(name,rpc);assert.deepEqual(Object.keys(args).sort(),['p_allow_write','p_auth_user_id','p_command','p_query']);
    assert.equal(args.p_auth_user_id,owner);assert.equal(typeof args.p_allow_write,'boolean');const query=parsePersonalRulesQuery(args.p_query);
    const command=args.p_command===null?null:parsePersonalRulesBody({query,command:args.p_command}).command;serviceCalls++;
    try{return {data:call(query,command,args.p_allow_write,args.p_auth_user_id),error:null};}
    catch(error){const code=String(error).match(/ERROR:\s+(?:[0-9A-Z]{5}:\s+)?([a-z_]+)(?=\r?\n|$)/)?.[1];if(!Object.hasOwn(PERSONAL_RULES_ERRORS,code??''))throw error;return {data:null,error:{message:code}};}
  }};
  const dependencies={enabled:()=>true,authenticate:async()=>({user:{id:owner},authenticationMethods:['password']}),allow:()=>true,
    entitlement:async()=>({permissionConfig:{allowEnterpriseManagement:true,allowEmployeeAttendance:moduleEnabled}}),execute:input=>executePersonalRules(input,service)};
  const endpoint=resolveCanonicalPortalOrigin()+'/api/merchant-enterprise/attendance/personal-rules';
  const request=(query,command=null)=>command===null?new Request(endpoint+'?'+personalRulesQueryString(query)):
    new Request(endpoint,{method:'POST',headers:{Origin:new URL(endpoint).origin,'Content-Type':'application/json'},body:JSON.stringify({query,command})});
  const via=async(query,command=null)=>{const response=await handlePersonalRules(request(query,command),dependencies);assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'private, no-store');
    const parsed=parsePersonalRulesResponse(await response.json(),query,command,owner);assert.equal(parsed.moduleEnabled,moduleEnabled);return parsed;};
  const routeQuery=q({workerId:secondWorker});await via(routeQuery);
  const routeCommand=personalRulesNativeApprove(6001,1,day(20),day(20),second),routeReceipt=(await via(routeQuery,routeCommand)).receipt;
  const routeBaseline=fingerprint();moduleEnabled=false;
  assert.deepEqual((await via({...routeQuery,operationId:routeCommand.operationId})).receipt,routeReceipt);assert.deepEqual((await via(routeQuery,routeCommand)).receipt,routeReceipt);
  const unauthenticated=await handlePersonalRules(request(routeQuery),{...dependencies,authenticate:async()=>{throw new MerchantEnterpriseAccessError('authentication_required',401);}});
  assert.equal(unauthenticated.status,401);assert.equal(serviceCalls,4,'unauthenticated request reached SQL');
  const paused=await handlePersonalRules(request(routeQuery,personalRulesNativeApprove(6002,2,day(22),day(22),second)),dependencies);
  assert.equal(paused.status,403);assert.deepEqual(await paused.json(),{ok:false,error:'attendance_platform_paused'});assert.equal(serviceCalls,5);assert.equal(fingerprint(),routeBaseline,'personal_route_recovery_changed_facts');

  phase='private-ACL-and-append-only';const final=fingerprint();
  for(const role of ['anon','authenticated'])exec(`set local role ${role};do $acl$ begin begin perform ${expression()};raise exception 'personal_browser_execute_allowed';exception when insufficient_privilege then null;end;end;$acl$;`);
  for(const role of ['anon','authenticated','service_role'])exec(`set local role ${role};do $private$ begin ${personalRulesNativeTables.map(table=>
    `assert not has_table_privilege(current_user,'public.${table}','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),'personal_private_privilege_allowed';begin perform 1 from public.${table};raise exception 'personal_private_read_allowed';exception when insufficient_privilege then null;end;`).join('\n')}
    assert not exists(select 1 from pg_proc p where p.pronamespace=${owned.oid} and p.proname like 'faolla_attendance_personal_rule%' and p.proname<>'${rpc}' and has_function_privilege(current_user,p.oid,'EXECUTE')),'personal_private_helper_allowed';end;$private$;`);
  exec(`begin;reset role;do $immutable$ begin
    begin update public.merchant_attendance_personal_rule_operations set recorded_at=recorded_at;raise exception 'personal_update_allowed';exception when insufficient_privilege then null;end;
    begin delete from public.merchant_attendance_personal_rule_operations;raise exception 'personal_delete_allowed';exception when insufficient_privilege then null;end;
    begin truncate public.merchant_attendance_personal_rule_operations cascade;raise exception 'personal_truncate_allowed';exception when insufficient_privilege then null;end;
    end;$immutable$;rollback;`);
  assert.equal(exec(`select count(*) from public.merchant_attendance_personal_rule_streams where merchant_id='${site}';`),'2');
  assert.equal(exec(`select count(*) from public.merchant_attendance_personal_rule_operations where merchant_id='${site}';`),'28');
  assert.equal(fingerprint(),final,'personal_ACL_probe_changed_facts');assert.equal(protectedFingerprint(),protectedBefore,'personal_modified_old_tables');assert.equal(oldFunctions(),functionsBefore,'personal_modified_old_functions');
  for(const label of labels)native.pass(label);
  return {checks:labels.length,streams:2,operations:28,firstWorkerRevisions:26,secondWorkerRevisions:2,successfulCalls,handlerSqlCalls:serviceCalls,exactLockWitnesses:1,
    syntheticOnly:true,noBrowser:true,postStartWithdrawalNativeWitness:false,allRollbackProbesRestored:true,callerOwnedNamespaceCleanup:true};
}

export async function runAttendancePersonalRulesNative(args){
  return runAttendanceLabelsReuse(args,native=>withAttendanceConcurrencySandbox(native,async scope=>{
    const result=await checkAttendancePersonalRulesNative(native,scope);console.log(JSON.stringify({personalRulesNative:result}));
  }));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  runAttendancePersonalRulesNative(process.argv.slice(2)).catch(error=>{console.error(JSON.stringify(personalRulesNativeFailure(error)));process.exitCode=1;});
}
