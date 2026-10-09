// Candidate rule-version ledger acceptance only; this does not apply rules to
// clock, schedule, exception, approval or payroll writers. No service starts on import.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {runAttendanceLabelsReuse} from './merchant-attendance-choice-labels-reuse-native.mjs';
import {withAttendanceConcurrencySandbox} from './merchant-attendance-concurrency-sandbox.mjs';
import {prepareGroupsNativeFixture,groupsNativePlan,groupsQueryInput,groupsNativeSave} from './merchant-attendance-groups-native.mjs';
import {assertLifecycleSandbox,lifecycleId as id,lifecycleJson as json,lifecycleRace} from './merchant-attendance-lifecycle-native-support.mjs';

const site='99990001',foreign='99990002',owner=id(99),other=id(98),groupId=id(7001),foreignGroupId=id(7002);
const rpc='faolla_attendance_rules_v1',migrationName='202610040127_merchant_attendance_rule_versions.sql';
export const rulesNativeTables=Object.freeze(['merchant_attendance_rule_streams','merchant_attendance_rule_operations']);
const quote=v=>"'"+String(v).replaceAll("'","''")+"'";
const require=createRequire(import.meta.url);
const labels=Object.freeze([
  'rules installs/reapplies127 with unchanged definitions/ACL/indexes and no seeded rule operations',
  'rules actual enterprise/group save, future publish and withdrawal retain original receipts and consume only the published draft',
  'rules exactly26 enterprise revisions page25+1 once each without changing facts',
  'rules paused and inactive/changed-context recovery returns the original actor receipt without replacement writes',
  'rules current-owner reauthorization, foreign groups and cross-stream operation fences prevent receipt confusion',
  'rules strict keys, bounded integer minutes, explicit inherit/disabled/zero and version CAS reject invalid commands',
  'rules future local-day and UTC boundaries come from the database clock, including alternate-zone midnight',
  'rules missing draft, repeated withdrawal and publication ordering errors do not alter the ledger',
  'rules two real connections witness the exact blocking PID; publish wins over a competing save at the same revision',
  'rules actual handler/service/parser read and paused operation recovery use synthetic auth only, with unauthenticated rejection before SQL',
  'rules private tables, service-only RPC and append-only operations preserve the original table fingerprint',
]);
let phase='entry';
export const rulesQueryInput=(patch={})=>({siteId:site,groupId:null,operationId:null,beforeRevision:null,...patch});
// Deliberately synthetic choices, not defaults or operative business thresholds.
export const rulesNativeChoices=()=>({lateGraceMinutes:{mode:'value',minutes:0},earlyGraceMinutes:{mode:'disabled'},openSpanWarningMinutes:{mode:'inherit'},completedBreakMinimumMinutes:{mode:'value',minutes:1}});
export const rulesNativeSave=(n,expectedRevision=0,patch={})=>({operationId:id(n),action:'save_draft',expectedRevision,reason:'Synthetic candidate draft',expectedSettingsVersion:1,expectedGroupRevision:null,timeZone:'UTC',rules:rulesNativeChoices(),...patch});
export const rulesNativePublish=(n,expectedRevision,effectiveOn,patch={})=>({operationId:id(n),action:'publish',expectedRevision,reason:'Synthetic future candidate publication',expectedSettingsVersion:1,expectedGroupRevision:null,timeZone:'UTC',effectiveOn,...patch});
export const rulesNativeWithdraw=(n,expectedRevision,publishedRevision,patch={})=>({operationId:id(n),action:'withdraw',expectedRevision,reason:'Synthetic future candidate withdrawal',publishedRevision,...patch});
const expression=(query=rulesQueryInput(),command=null,allow=false,actor=owner)=>`public.${rpc}(${json(query)},'${actor}',${json(command)},${allow===null?'null':allow?'true':'false'})`;
const groupExpression=(command,query=groupsQueryInput(),actor=owner)=>`public.faolla_attendance_groups_v1(${json(query)},'${actor}',${json(command)},true)`;
const denied=(code,expr)=>`begin perform ${expr};raise exception 'rules_unexpected_acceptance';exception when sqlstate 'P0001' then if sqlerrm<>${quote(code)} then raise;end if;end;`;

export function rulesNativeFailure(error){
  const text=error instanceof Error?error.message:'',sqlState=text.match(/ERROR:\s+([0-9A-Z]{5}):/)?.[1]??null;
  const message=text.match(/ERROR:\s+(?:[0-9A-Z]{5}:\s+)?([^\r\n]+)/)?.[1]??'',code=/^[a-z_]+$/.test(message)?message:null;
  const allowed=new Set(['attendance_invalid_request','attendance_access_denied','attendance_settings_required','attendance_platform_paused','attendance_version_conflict','attendance_operation_conflict',
    'attendance_rule_group_inactive','attendance_rule_draft_required','attendance_rule_future_required','attendance_rule_order_conflict','attendance_rule_already_withdrawn','attendance_rule_invalid','attendance_group_not_found','attendance_not_available',
    'merchant_attendance_rule_versions_prerequisite_required','merchant_attendance_rule_versions_installation_conflict']);
  // Closed message projection: never print arbitrary SQL, DETAIL, command text,
  // reason strings or identifiers from a database exception.
  const diagnostics=[
    [/^cannot truncate a table referenced in a foreign key constraint$/,'foreign_key_truncate_restriction','cannot truncate a table referenced in a foreign key constraint'],
    [/^(?:insert or update on table|update or delete on table) .+ violates foreign key constraint .+$/,'foreign_key_constraint','a rule-ledger foreign key constraint rejected the statement'],
    [/^permission denied for (?:table|relation|function|schema) .+$/,'permission_denied','permission denied for a protected database object'],
    [/^duplicate key value violates unique constraint .+$/,'unique_constraint','a unique database constraint rejected the statement'],
    [/^null value in column .+ violates not-null constraint$/,'not_null_constraint','a required database column was null'],
    [/^syntax error at or near .+$/,'sql_syntax_error','database statement syntax was rejected'],
  ];
  const diagnostic=diagnostics.find(([pattern])=>pattern.test(message));
  return {error:'rules_native_failed',phase,code:allowed.has(code)?code:diagnostic?.[1]??'local_check_failed',sqlState,
    sqlMessage:allowed.has(code)?code:diagnostic?.[2]??(message?'unrecognized SQL error (redacted)':null),
    sourceLine:Number(text.match(/PL\/pgSQL function [^\r\n]*? line ([1-9][0-9]{0,5})\b/)?.[1]??0)||null};
}
export function rulesMigrationPlan(root,scope){
  assert(typeof root==='string'&&path.isAbsolute(root));assert(scope&&/^attendance_race_[a-f0-9]{32}$/.test(scope.schema)&&typeof scope.sql==='function');
  const source=readFileSync(path.join(root,'scripts/supabase-migrations',migrationName),'utf8');
  const body=source.replace(/^begin;\s*$/m,'').replace(/^commit;\s*$/m,''),statement=scope.sql(body);
  assert(!/\bpublic\./.test(statement));assert(!/search_path\s*(?:=|to)\s*(?:pg_catalog,\s*)?public\b/.test(statement));return {name:migrationName,source,body,statement};
}
export function rulesNativePlan(owned,tables){
  // Reuse the existing exact namespace/table OID + owner + marker fence.
  const guard=groupsNativePlan(owned,tables).guard;for(const table of rulesNativeTables)assert(tables.includes(table));
  const fingerprint=selected=>`(select md5(jsonb_build_object(${selected.map(t=>`${quote(t)},(select coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text),'[]'::jsonb) from public.${t} r)`).join(',')})::text))`;
  return {guard,fingerprint:fingerprint(tables),protectedFingerprint:fingerprint(tables.filter(t=>!rulesNativeTables.includes(t))),labels:[...labels]};
}
export async function prepareRulesNativeFixture(native,scope){
  const {parseRulesResult}=require('../src/lib/merchantAttendanceRules.ts');
  phase='install';const groups=await prepareGroupsNativeFixture(native,scope),{exec,owned}=groups;
  const migration=rulesMigrationPlan(native.root,scope);exec(migration.body);
  const inventory=()=>JSON.parse(exec(`select jsonb_agg(relname order by relname) from pg_class where relnamespace=${owned.oid} and relkind in('r','p');`));
  const plan=rulesNativePlan(owned,inventory()),fingerprint=()=>exec(`select ${rulesNativePlan(owned,inventory()).fingerprint};`),protectedFingerprint=()=>exec(`select ${rulesNativePlan(owned,inventory()).protectedFingerprint};`);
  const installed=()=>exec(`select jsonb_build_object('functions',(select jsonb_agg(jsonb_build_array(p.proname,pg_get_functiondef(p.oid),p.proowner,p.proacl) order by p.proname)
    from pg_proc p where p.pronamespace=${owned.oid} and p.proname like 'faolla_attendance_rule%'),
    'tables',(select jsonb_agg(jsonb_build_array(c.relname,c.relowner,c.relacl,c.relrowsecurity) order by c.relname) from pg_class c where c.oid in(${rulesNativeTables.map(t=>`'public.${t}'::regclass`).join(',')})),
    'triggers',(select jsonb_agg(pg_get_triggerdef(t.oid) order by t.tgname) from pg_trigger t where t.tgrelid in(${rulesNativeTables.map(t=>`'public.${t}'::regclass`).join(',')}) and not t.tgisinternal),
    'indexes',(select jsonb_agg(indexdef order by indexname) from pg_indexes where schemaname=${quote(owned.schema)}));`);
  const facts=fingerprint(),definition=installed();exec(migration.body);assert.equal(installed(),definition,'rules_reapply_changed_definition_acl');assert.equal(fingerprint(),facts,'rules_reapply_changed_facts');
  for(const table of rulesNativeTables)assert.equal(exec(`select count(*) from public.${table};`),'0');
  phase='minimal-actual-group';groups.call(groupsQueryInput(),groupsNativeSave(7001),true);
  const call=(query=rulesQueryInput(),command=null,allow=false,actor=owner)=>{
    const raw=JSON.parse(exec(`set local role service_role;select ${expression(query,command,allow,actor)};`));
    const parsed=parseRulesResult(raw,query,command,actor);assert.deepEqual(parsed,raw,'rules_SQL_parser_projection_changed');return parsed;
  };
  const dates=JSON.parse(exec(`select jsonb_build_object('today',(clock_timestamp() at time zone 'UTC')::date::text,
    'future',((clock_timestamp() at time zone 'UTC')::date+7)::text,'later',((clock_timestamp() at time zone 'UTC')::date+14)::text,
    'madridDay',((clock_timestamp() at time zone 'Europe/Madrid')::date+7)::text,
    'madridAt',to_char((((clock_timestamp() at time zone 'Europe/Madrid')::date+7)::timestamp at time zone 'Europe/Madrid') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));`));
  return {site,foreign,owner,other,groupId,foreignGroupId,exec,owned,plan,call,dates,fingerprint,protectedFingerprint,read:(patch={},actor=owner)=>call(rulesQueryInput(patch),null,false,actor),syntheticOnly:true};
}

export async function checkAttendanceRulesNative(native,scope){
  const data=await prepareRulesNativeFixture(native,scope),{exec,plan,call,dates}=data,q=rulesQueryInput;
  const protectedBefore=data.protectedFingerprint(),originals=new Map(),write=(command,group=null,allow=true,actor=owner)=>call(q({groupId:group}),command,allow,actor);
  const expr=(command,group=null,allow=true,actor=owner)=>expression(q({groupId:group}),command,allow,actor);
  const keep=(command,group=null)=>{const result=write(command,group);assert.deepEqual(result.receipt.command,command);assert.equal(result.receipt.operationId,command.operationId);
    assert.equal(result.receipt.revision,command.expectedRevision+1);assert.equal(result.receipt.item.actorId,owner);assert.equal(result.actorId,owner);assert.equal(result.siteId,site);originals.set(command.operationId,result.receipt);return result;};
  phase='actual-enterprise-and-group-lifecycle';const initial=data.read();assert.equal(initial.protocol,'rules-v1');assert.equal(initial.revision,0);assert.equal(initial.draft,null);assert.deepEqual(initial.items,[]);
  const enterpriseSave=rulesNativeSave(1001),enterprisePublish=rulesNativePublish(1002,1,dates.future),enterpriseWithdraw=rulesNativeWithdraw(1003,2,2);
  const saved=keep(enterpriseSave);assert.deepEqual(saved.draft.rules,enterpriseSave.rules);assert.equal(saved.draft.revision,1);
  const published=keep(enterprisePublish);assert.equal(published.draft,null);assert.deepEqual(published.receipt.item.rules,enterpriseSave.rules);
  assert.equal(Date.parse(published.receipt.item.effectiveAt),Date.parse(dates.future+'T00:00:00.000Z'));assert.equal(published.receipt.item.timeZone,'UTC');
  const withdrawn=keep(enterpriseWithdraw);assert.equal(withdrawn.receipt.item.publishedRevision,2);assert.equal(withdrawn.items.find(item=>item.revision===2).withdrawnByRevision,3);
  assert(!Object.hasOwn(originals.get(enterprisePublish.operationId).item,'withdrawnByRevision'));
  const groupSave=rulesNativeSave(2001,0,{expectedGroupRevision:1}),groupPublish=rulesNativePublish(2002,1,dates.future,{expectedGroupRevision:1});
  keep(groupSave,groupId);const groupPublished=keep(groupPublish,groupId);assert.equal(groupPublished.draft,null);assert.equal(groupPublished.group.groupId,groupId);
  const interim=data.fingerprint();
  const rollback=(setup,checks)=>exec(`begin;reset role;${setup}set local role service_role;do $checks$ declare a jsonb;b jsonb;begin ${checks} end;$checks$;rollback;`);
  phase='paused-inactive-original-receipt-and-withdrawal';
  const deactivate=groupsNativeSave(7101,{groupId,expectedRevision:1,active:false});
  rollback(`select ${groupExpression(deactivate,groupsQueryInput({groupId}))};update public.merchant_attendance_settings set time_zone='Europe/Madrid',version=version+1 where merchant_id='${site}';`,
    `a:=${expression(q({groupId,operationId:groupPublish.operationId}))};assert a->'receipt'=${json(originals.get(groupPublish.operationId))},'original group receipt changed';
     assert a->'group'->'active'='false'::jsonb and a->>'timeZone'='Europe/Madrid','current context must stay distinct';
     a:=${expr(groupPublish,groupId,false)};assert a->'receipt'=${json(originals.get(groupPublish.operationId))},'paused original replay changed';
     ${denied('attendance_rule_group_inactive',expr(rulesNativeSave(2101,2,{expectedGroupRevision:2,expectedSettingsVersion:2,timeZone:'Europe/Madrid'}),groupId))}
     a:=${expr(rulesNativeWithdraw(2102,2,2),groupId)};assert a->'receipt'->'item'->>'publishedRevision'='2','inactive context still allows explicit future withdrawal';`);
  assert.equal(data.fingerprint(),interim,'rules_context_probe_not_restored');
  const groupWithdraw=rulesNativeWithdraw(2003,2,2);keep(groupWithdraw,groupId);
  phase='exact25-plus1-pages';for(let revision=4;revision<=26;revision++)keep(rulesNativeSave(1000+revision,revision-1,revision===26?{rules:{
    lateGraceMinutes:{mode:'value',minutes:1440},earlyGraceMinutes:{mode:'value',minutes:0},openSpanWarningMinutes:{mode:'value',minutes:44640},completedBreakMinimumMinutes:{mode:'value',minutes:1440}}}:{}));
  const first=data.read(),second=data.read({beforeRevision:first.nextBeforeRevision});assert.equal(first.items.length,25);assert.equal(first.nextBeforeRevision,2);
  assert.equal(second.items.length,1);assert.equal(second.nextBeforeRevision,null);assert.deepEqual([...first.items,...second.items].map(item=>item.revision),Array.from({length:26},(_,n)=>26-n));
  assert.equal(new Set([...first.items,...second.items].map(item=>item.operationId)).size,26);
  const baseline=data.fingerprint();phase='read-replay-and-operation-fences';
  assert.equal(data.read({operationId:id(9999)}).receipt,null);
  for(const [command,group] of [[enterpriseSave,null],[enterprisePublish,null],[enterpriseWithdraw,null],[groupSave,groupId],[groupPublish,groupId],[groupWithdraw,groupId]]){
    assert.deepEqual(data.read({groupId:group,operationId:command.operationId}).receipt,originals.get(command.operationId));
    assert.deepEqual(write(command,group,false).receipt,originals.get(command.operationId));
  }
  assert.equal(data.fingerprint(),baseline,'rules_reads_replays_changed_facts');
  rollback('',denied('attendance_platform_paused',expr(rulesNativeSave(3001,26),null,false))+
    denied('attendance_operation_conflict',expr({...enterpriseSave,reason:'Different command'},null,false))+
    denied('attendance_version_conflict',expr(rulesNativeSave(3002,25)))+
    denied('attendance_version_conflict',expr(rulesNativeSave(3003,26,{expectedSettingsVersion:2})))+
    denied('attendance_version_conflict',expr(rulesNativeSave(3004,3,{expectedGroupRevision:2}),groupId))+
    denied('attendance_version_conflict',expr(rulesNativeSave(3005,26,{timeZone:'Europe/Madrid'})))+
    denied('attendance_access_denied',expression(q(),null,false,other))+
    denied('attendance_access_denied',expression(q({siteId:foreign}))));
  rollback(`update public.merchants set user_id='${other}' where id='${site}';`,
    denied('attendance_access_denied',expression(q({operationId:enterpriseSave.operationId})))+
    denied('attendance_access_denied',expression(q({operationId:enterpriseSave.operationId}),null,false,other))+
    `a:=${expression(q(),null,false,other)};assert a->>'actorId'='${other}' and a->'items'->0->>'actorId'='${owner}','current owner sees history with original actor provenance';`+
    denied('attendance_access_denied',expr(enterpriseSave,null,false,other)));
  rollback(`insert into public.merchants(id,user_id) values('99990003','${owner}');`,denied('attendance_settings_required',expression(q({siteId:'99990003'}))));
  rollback(`select ${groupExpression(groupsNativeSave(7002),groupsQueryInput({siteId:foreign}),other)};`,
    denied('attendance_group_not_found',expression(q({groupId:foreignGroupId})))+
    denied('attendance_group_not_found',expr(rulesNativeSave(3006,0,{expectedGroupRevision:1}),foreignGroupId))+
    denied('attendance_group_not_found',expression(q({groupId:id(9998)})))+
    denied('attendance_access_denied',expression(q({groupId,operationId:enterpriseSave.operationId})))+
    denied('attendance_access_denied',expr({...enterpriseSave,expectedGroupRevision:1},groupId,false))+
    denied('attendance_invalid_request',expression(q({operationId:enterpriseSave.operationId}),enterpriseSave,true))+
    denied('attendance_invalid_request',expression(q({beforeRevision:2}),enterpriseSave,true)));
  phase='strict-shapes-minutes-and-dates';
  const invalidQueries=[null,{}, {...q(),extra:true},{...q(),beforeRevision:0},{...q(),beforeRevision:1.5},{...q(),beforeRevision:2,operationId:id(1001)},{...q(),groupId:1}];
  const invalidCommands=[{...rulesNativeSave(3101,26),extra:true},rulesNativeSave(3101,26,{reason:' leading'}),rulesNativeSave(3101,26,{reason:'x\u0085'}),rulesNativeSave(3101,26,{reason:''}),
    rulesNativeSave(3101,26,{expectedRevision:1.5}),rulesNativeSave(3101,26,{expectedSettingsVersion:0}),rulesNativeSave(3101,26,{expectedGroupRevision:1}),rulesNativeSave(3101,26,{rules:{...rulesNativeChoices(),unexpected:{mode:'inherit'}}}),
    rulesNativeSave(3101,26,{rules:{...rulesNativeChoices(),lateGraceMinutes:{mode:'inherit',minutes:0}}}),rulesNativeSave(3101,26,{rules:{...rulesNativeChoices(),earlyGraceMinutes:{mode:'disabled',minutes:0}}}),
    ...[-1,1441,0.5,'0',null].map(minutes=>rulesNativeSave(3101,26,{rules:{...rulesNativeChoices(),lateGraceMinutes:{mode:'value',minutes}}})),
    ...[0,44641].map(minutes=>rulesNativeSave(3101,26,{rules:{...rulesNativeChoices(),openSpanWarningMinutes:{mode:'value',minutes}}})),
    rulesNativeSave(3101,26,{rules:{...rulesNativeChoices(),completedBreakMinimumMinutes:{mode:'value',minutes:0}}}),
    rulesNativePublish(3101,26,'2026-02-30'),rulesNativePublish(3101,26,'2101-01-01'),rulesNativePublish(3101,26,dates.future+'T00:00:00.000Z'),
    {...rulesNativeWithdraw(3101,26,2),timeZone:'UTC'}];
  rollback('',invalidQueries.map(query=>denied('attendance_invalid_request',expression(query))).join('\n')+
    invalidCommands.map(command=>denied('attendance_invalid_request',expr(command))).join('\n')+
    denied('attendance_invalid_request',expression(q(),null,null))+
    denied('attendance_rule_future_required',expr(rulesNativePublish(3201,26,dates.today)))+
    denied('attendance_rule_draft_required',expr(rulesNativePublish(3202,3,dates.future,{expectedGroupRevision:1}),groupId))+
    denied('attendance_rule_already_withdrawn',expr(rulesNativeWithdraw(3203,26,2))));
  phase='database-clock-alternate-zone-and-order';
  const madridSave=rulesNativeSave(3301,26,{expectedSettingsVersion:2,timeZone:'Europe/Madrid'}),madridPublish=rulesNativePublish(3302,27,dates.madridDay,{expectedSettingsVersion:2,timeZone:'Europe/Madrid'});
  rollback(`update public.merchant_attendance_settings set time_zone='Europe/Madrid',version=version+1 where merchant_id='${site}';`,
    `a:=${expr(madridSave)};a:=${expr(madridPublish)};assert a->'draft'='null'::jsonb and a->'receipt'->'item'->>'effectiveAt'=${quote(dates.madridAt)},'future local midnight UTC binding';`);
  rollback('',`a:=${expr(rulesNativePublish(3401,26,dates.later))};a:=${expr(rulesNativeSave(3402,27))};`+
    denied('attendance_rule_order_conflict',expr(rulesNativePublish(3403,28,dates.future)))+
    `a:=${expr(rulesNativeWithdraw(3404,28,27))};assert a->'draft'->>'revision'='28','withdrawal must retain unrelated current draft';`);
  assert.equal(data.fingerprint(),baseline,'rules_rollback_probes_changed_facts');assert.equal(data.protectedFingerprint(),protectedBefore,'rules_checks_changed_old_tables');
  phase='actual-publish-save-CAS-race';keep(rulesNativeSave(2004,3,{expectedGroupRevision:1}),groupId);
  assert.deepEqual(assertLifecycleSandbox(source=>native.query(scope.sql(source))),data.owned);
  const left=rulesNativePublish(2005,4,dates.later,{expectedGroupRevision:1}),right=rulesNativeSave(2006,4,{expectedGroupRevision:1});
  const race=await lifecycleRace({connect:native.connect,query:native.query,sql:scope.sql},
    `reset role;${plan.guard}set local role service_role;select ${expr(left,groupId)};`,`reset role;${plan.guard}set local role service_role;select ${expr(right,groupId)};`);
  assert.equal(race.witnessed,true);const winner=JSON.parse(race.left);assert.equal(winner.revision,5);assert.equal(winner.draft,null);assert.deepEqual(winner.receipt.command,left);
  assert(race.right.error,'competing same-revision save must fail');assert.equal(race.right.error.message.includes('attendance_version_conflict'),true,'waiter must observe committed revision');
  assert.equal(data.read({groupId,operationId:right.operationId}).receipt,null);assert.deepEqual(write(left,groupId,false).receipt,winner.receipt);
  phase='actual-handler-service-with-synthetic-auth';
  const {executeRules}=require('../src/lib/merchantAttendanceRules.server.ts');
  const {handleRules}=require('../src/app/api/merchant-enterprise/attendance/rules/route-handler.ts');
  const {parseRulesBody,parseRulesQuery,parseRulesResponse,rulesQueryString,RULES_ERRORS}=require('../src/lib/merchantAttendanceRules.ts');
  const {MerchantEnterpriseAccessError}=require('../src/lib/merchantEnterpriseAuth.server.ts');
  const {resolveCanonicalPortalOrigin}=require('../src/lib/canonicalPortalRequest.ts');
  let serviceCalls=0;
  const service={rpc:async(name,args)=>{
    assert.equal(name,rpc);assert.deepEqual(Object.keys(args).sort(),['p_allow_write','p_auth_user_id','p_command','p_query']);assert.equal(args.p_auth_user_id,owner);assert.equal(typeof args.p_allow_write,'boolean');
    const query=parseRulesQuery(args.p_query),command=args.p_command===null?null:parseRulesBody({query,command:args.p_command}).command;serviceCalls++;
    try{return {data:call(query,command,args.p_allow_write,args.p_auth_user_id),error:null};}
    catch(error){const code=String(error).match(/ERROR:\s+([a-z_]+)(?=\r?\n|$)/)?.[1];if(!Object.hasOwn(RULES_ERRORS,code??''))throw error;return {data:null,error:{message:code}};}
  }};
  const dependencies={enabled:()=>true,authenticate:async()=>({user:{id:owner},authenticationMethods:['password']}),allow:()=>true,
    entitlement:async()=>({permissionConfig:{allowEnterpriseManagement:true,allowEmployeeAttendance:false}}),execute:input=>executeRules(input,service)};
  const endpoint=resolveCanonicalPortalOrigin()+'/api/merchant-enterprise/attendance/rules';
  const request=(query,command=null)=>command===null?new Request(endpoint+'?'+rulesQueryString(query)):
    new Request(endpoint,{method:'POST',headers:{Origin:new URL(endpoint).origin,'Content-Type':'application/json'},body:JSON.stringify({query,command})});
  const routeBaseline=data.fingerprint();
  for(const [query,command] of [[q(),null],[q({operationId:enterprisePublish.operationId}),null],[q(),enterprisePublish]]){
    const response=await handleRules(request(query,command),dependencies);assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'private, no-store');
    const body=parseRulesResponse(await response.json(),query,command,owner);assert.equal(body.moduleEnabled,false);
    if(query.operationId||command)assert.deepEqual(body.receipt,originals.get(enterprisePublish.operationId));
  }
  assert.equal(serviceCalls,3);
  const unauthenticated=await handleRules(request(q()),{...dependencies,authenticate:async()=>{throw new MerchantEnterpriseAccessError('authentication_required',401);}});
  assert.equal(unauthenticated.status,401);assert.equal(serviceCalls,3,'unauthenticated handler must not reach SQL');
  const paused=await handleRules(request(q(),rulesNativeSave(3501,26)),dependencies);assert.equal(paused.status,403);assert.deepEqual(await paused.json(),{ok:false,error:'attendance_platform_paused'});assert.equal(serviceCalls,4);
  assert.equal(data.fingerprint(),routeBaseline,'rules_handler_recovery_changed_facts');
  phase='private-acl-and-append-only';const final=data.fingerprint();
  for(const role of ['anon','authenticated'])exec(`set local role ${role};do $acl$ begin begin perform ${expression()};raise exception 'rules_browser_execute_allowed';exception when insufficient_privilege then null;end;end;$acl$;`);
  for(const role of ['anon','authenticated','service_role'])exec(`set local role ${role};do $tables$ begin ${rulesNativeTables.map(table=>
    `assert not has_table_privilege(current_user,'public.${table}','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),'rules_private_privilege_allowed';begin perform 1 from public.${table};raise exception 'rules_private_read_allowed';exception when insufficient_privilege then null;end;`).join('\n')}end;$tables$;`);
  exec(`begin;reset role;do $immutable$ begin
    begin update public.merchant_attendance_rule_operations set recorded_at=recorded_at;raise exception 'rules_update_allowed';exception when insufficient_privilege then null;end;
    begin delete from public.merchant_attendance_rule_operations;raise exception 'rules_delete_allowed';exception when insufficient_privilege then null;end;
    begin truncate public.merchant_attendance_rule_operations cascade;raise exception 'rules_truncate_allowed';exception when insufficient_privilege then null;end;
    end;$immutable$;rollback;`);
  assert.equal(exec(`select count(*) from public.merchant_attendance_rule_streams where merchant_id='${site}';`),'2');
  assert.equal(exec(`select count(*) from public.merchant_attendance_rule_operations where merchant_id='${site}';`),'31');
  assert.equal(data.fingerprint(),final,'rules_acl_or_replay_changed_facts');assert.equal(data.protectedFingerprint(),protectedBefore,'rules_final_changed_old_tables');
  for(const label of labels)native.pass(label);return {checks:labels.length,streams:2,operations:31,enterpriseRevisions:26,groupRevisions:5,exactLockWitnesses:1,syntheticOnly:true,allRollbackProbesRestored:true,callerOwnedNamespaceCleanup:true};
}
export async function runAttendanceRulesNative(args){return runAttendanceLabelsReuse(args,native=>withAttendanceConcurrencySandbox(native,scope=>checkAttendanceRulesNative(native,scope)));}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  runAttendanceRulesNative(process.argv.slice(2)).catch(error=>{console.error(JSON.stringify(rulesNativeFailure(error)));process.exitCode=1;});
}
