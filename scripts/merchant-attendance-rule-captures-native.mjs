// Independent source-capture backend acceptance. Import is inert. All source
// writers and captures run only in the caller-owned synthetic namespace.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {runAttendanceLabelsReuse} from './merchant-attendance-choice-labels-reuse-native.mjs';
import {withAttendanceConcurrencySandbox} from './merchant-attendance-concurrency-sandbox.mjs';
import {prepareGroupsNativeFixture,groupsNativePlan} from './merchant-attendance-groups-native.mjs';
import {rulesMigrationPlan,rulesNativeSave,rulesNativePublish,rulesQueryInput,rulesNativeFailure} from './merchant-attendance-rules-native.mjs';
import {personalRulesMigrationPlan,personalRulesNativeApprove,personalRulesNativeWithdraw,personalRulesQueryInput} from './merchant-attendance-personal-rules-native.mjs';
import {ruleSourcesMigrationPlan} from './merchant-attendance-rule-sources-native.mjs';
import {assertLifecycleSandbox,lifecycleId as id,lifecycleJson as json} from './merchant-attendance-lifecycle-native-support.mjs';

const require=createRequire(import.meta.url),site='99990001',owner=id(99),worker=id(201);
const rpc='faolla_attendance_rule_captures_v1',migrationName='202610040131_merchant_attendance_rule_captures.sql';
export const ruleCapturesNativeTables=Object.freeze(['merchant_attendance_rule_capture_artifacts','merchant_attendance_rule_capture_operations']);
const signatures=[`public.${rpc}(jsonb,uuid,jsonb,boolean)`,'public.faolla_attendance_rule_capture_command_v1(jsonb)',
  'public.faolla_attendance_rule_capture_source_v1(text,text,uuid,uuid,uuid,uuid,timestamp with time zone,text,text,integer)'];
const quote=value=>"'"+String(value).replaceAll("'","''")+"'";
const labels=Object.freeze([
  'captures131 installs/reapplies only new private tables/helpers and leaves old definitions and business facts unchanged',
  'captures actual SQL and archival parser preserve exactPG UTF8bytes SHA256 source identity and immutable original receipt',
  'captures distinct operation numbers deduplicate only equal semantic sources while retaining original bytes and fresh observation time',
  'captures real source withdrawal changes a new captured artifact but cannot rewrite an earlier capture; owned probe rolls back',
  'captures current owner worker and dual identity are rechecked; paused or inactive exact recovery keeps original source and dates',
  'captures exact advisory blockerPID makes concurrent same-number requests produce one operation and the same receipt',
  'captures actual handler/service/SQL supports newPOST pausedGET and originalPOST recovery without changing old facts',
  'captures1000operation quota blocks new numbers but not original recovery; synthetic quota rows roll back',
  'captures private ACLs and immutable tables reject direct access/rewrite; all read and rollback fingerprints remain unchanged',
]);
let phase='entry';
export const ruleCapturesQueryInput=(n=9001,patch={})=>({siteId:site,workerId:worker,operationId:id(n),...patch});
export const ruleCapturesNativeCommand=(n,fromDate,throughDate=fromDate,patch={})=>({operationId:id(n),fromDate,throughDate,
  reason:'Synthetic candidate evidence capture 中文🙂',employeeId:id(101),employeeAuthUserId:id(1),...patch});
const expression=(query,command=null,enabled=false,actor=owner)=>`public.${rpc}(${json(query)},'${actor}',${json(command)},${enabled?'true':'false'})`;
const denied=(code,expr)=>`begin perform ${expr};raise exception 'rule_capture_unexpected_acceptance';exception when sqlstate 'P0001' then if sqlerrm<>${quote(code)} then raise;end if;end;`;
export function ruleCapturesMigrationPlan(root,scope){
  assert(typeof root==='string'&&path.isAbsolute(root));assert(scope&&/^attendance_race_[a-f0-9]{32}$/.test(scope.schema)&&typeof scope.sql==='function');
  const source=readFileSync(path.join(root,'scripts/supabase-migrations',migrationName),'utf8'),body=source.replace(/^begin;\s*$/m,'').replace(/^commit;\s*$/m,''),statement=scope.sql(body);
  assert(!/\bpublic\./.test(statement));assert(!/search_path\s*(?:=|to)\s*(?:pg_catalog,\s*)?public\b/.test(statement));return {name:migrationName,source,body,statement};
}
export function ruleCapturesNativeFailure(error){
  const safe=rulesNativeFailure(error),text=error instanceof Error?error.message:'',code=text.match(/ERROR:\s+(?:[0-9A-Z]{5}:\s+)?([a-z_]+)(?=\r?\n|$)/)?.[1];
  const known=new Set(['attendance_rule_capture_invalid','attendance_rule_capture_identity_changed','attendance_rule_capture_incomplete','attendance_rule_capture_limit',
    'attendance_rule_capture_worker_inactive','merchant_attendance_rule_captures_prerequisite_required','merchant_attendance_rule_captures_installation_conflict']);
  return {...safe,error:'rule_captures_native_failed',phase,...(known.has(code)?{code,sqlMessage:code}:{})};
}

export async function checkAttendanceRuleCapturesNative(native,scope){
  phase='install';const foundation=await prepareGroupsNativeFixture(native,scope),{exec,owned}=foundation;
  for(const plan of [rulesMigrationPlan,personalRulesMigrationPlan,ruleSourcesMigrationPlan])exec(plan(native.root,scope).body);
  const {parseRuleCapturesResult,parseRuleCapturesQuery,parseRuleCapturesBody,RULE_CAPTURES_ERRORS}=require('../src/lib/merchantAttendanceRuleCaptures.ts');
  const inventory=()=>JSON.parse(exec(`select jsonb_agg(relname order by relname) from pg_class where relnamespace=${owned.oid} and relkind in('r','p');`));
  const oldTables=inventory(),hash=selected=>`(select md5(jsonb_build_object(${selected.map(table=>`${quote(table)},(select coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text),'[]'::jsonb) from public.${table} r)`).join(',')})::text))`;
  const priorFacts=hash(oldTables.filter(table=>table!=='faolla_schema_migrations')),beforeInstall=exec(`select ${priorFacts};`);
  const oldDefinitions=()=>exec(`select md5(coalesce(jsonb_agg(jsonb_build_array(p.proname,pg_get_functiondef(p.oid),p.proowner,p.proacl,p.proconfig) order by p.proname,p.oid),'[]'::jsonb)::text)
    from pg_proc p where p.pronamespace=${owned.oid} and p.prokind='f' and ${signatures.map(name=>`p.oid is distinct from to_regprocedure(${quote(name)})`).join(' and ')};`);
  const oldDefinition=oldDefinitions(),migration=ruleCapturesMigrationPlan(native.root,scope);exec(migration.body);
  assert.equal(exec(`select ${priorFacts};`),beforeInstall);assert.equal(oldDefinitions(),oldDefinition);
  assert.deepEqual(inventory(),[...oldTables,...ruleCapturesNativeTables].sort());
  const tables=inventory(),guard=groupsNativePlan(owned,tables).guard,fp=hash(tables),oldFp=hash(oldTables);
  const fingerprint=()=>exec(`select ${fp};`),protectedFingerprint=()=>exec(`select ${oldFp};`);
  const definition=()=>exec(`select jsonb_build_object('functions',(select jsonb_agg(jsonb_build_array(p.proname,pg_get_functiondef(p.oid),p.proowner,p.proacl,p.proconfig) order by p.proname,p.oid) from pg_proc p where p.pronamespace=${owned.oid} and p.prokind='f'),
    'tables',(select jsonb_agg(jsonb_build_array(c.relname,c.relowner,c.relacl,c.relrowsecurity) order by c.relname) from pg_class c where c.relnamespace=${owned.oid} and c.relkind in('r','p')),
    'triggers',(select jsonb_agg(pg_get_triggerdef(t.oid) order by t.tgrelid,t.tgname) from pg_trigger t join pg_class c on c.oid=t.tgrelid where c.relnamespace=${owned.oid} and not t.tgisinternal));`);
  const installed=definition(),empty=fingerprint();exec(migration.body);assert.equal(definition(),installed);assert.equal(fingerprint(),empty);assert.equal(oldDefinitions(),oldDefinition);
  for(const table of ruleCapturesNativeTables)assert.equal(exec(`select count(*) from public.${table};`),'0');

  phase='minimal-actual-source-setup';
  const today=exec("select (clock_timestamp() at time zone 'UTC')::date::text;"),day=n=>new Date(Date.parse(today+'T00:00:00.000Z')+n*86400000).toISOString().slice(0,10);
  const oldWrite=(name,query,command)=>exec(`set local role service_role;select public.${name}(${json(query)},'${owner}',${json(command)},true);`);
  oldWrite('faolla_attendance_rules_v1',rulesQueryInput(),rulesNativeSave(7501));
  oldWrite('faolla_attendance_rules_v1',rulesQueryInput(),rulesNativePublish(7502,1,day(2)));
  oldWrite('faolla_attendance_personal_rules_v1',personalRulesQueryInput(),personalRulesNativeApprove(8001,0,day(2)));
  const protectedBefore=protectedFingerprint();let successfulCalls=0;
  const q=(n=9001,patch={})=>ruleCapturesQueryInput(n,patch),c=(n,patch={})=>ruleCapturesNativeCommand(n,day(2),day(3),patch);
  const parse=(raw,query,command=null,actor=owner)=>{const parsed=parseRuleCapturesResult(raw,query,command,actor);assert.deepEqual(parsed,raw,'capture_SQL_archive_parser_disagreed');return parsed;};
  const call=(query=q(),command=null,enabled=false,actor=owner)=>{
    const result=parse(JSON.parse(exec(`set local role service_role;select ${expression(query,command,enabled,actor)};`)),query,command,actor);successfulCalls++;
    assert.equal(protectedFingerprint(),protectedBefore,'capture_changed_old_business_facts');return result;
  };
  const counts=()=>JSON.parse(exec(`select jsonb_build_object('artifacts',(select count(*) from public.merchant_attendance_rule_capture_artifacts),
    'operations',(select count(*) from public.merchant_attendance_rule_capture_operations));`));
  const probe=(setup,expr,query=q(),command=null,actor=owner)=>{const before=fingerprint();
    const result=parse(JSON.parse(exec(`begin;reset role;${setup}set local role service_role;select ${expr};reset role;set constraints all immediate;rollback;`)),query,command,actor);
    assert.equal(fingerprint(),before,'capture_probe_not_restored');return result;
  };
  const reject=(code,expr,setup='')=>{const before=fingerprint();exec(`begin;reset role;${setup}set local role service_role;do $deny$ begin ${denied(code,expr)}end;$deny$;rollback;`);assert.equal(fingerprint(),before,'capture_rejection_changed_facts');};

  phase='capture-exact-recovery-and-dedup';assert.equal(call(q()).receipt,null);
  const first=call(q(),c(9001),true).receipt;assert(first);assert.equal(first.sourceId,id(9001));assert.equal(first.observedAt,first.sourceReadAt);
  assert.equal(first.sourceBytes,Buffer.byteLength(first.sourceText,'utf8'));assert.equal(first.sourceSha256,createHash('sha256').update(first.sourceText,'utf8').digest('hex'));
  assert.equal(first.canonicalFormat,'pg-jsonb-text-utf8-v1');assert.equal(first.applied,false);assert.equal(first.historicalApplicationProven,false);
  const firstSource=JSON.parse(first.sourceText);assert.equal(firstSource.protocol,'rule-sources-v1');assert.equal(firstSource.worker.employeeAuthUserId,id(1));assert.equal(firstSource.personal.items[0].withdrawal,null);
  const beforeReplay=fingerprint();assert.deepEqual(call(q()).receipt,first);assert.deepEqual(call(q(),c(9001),false).receipt,first);assert.equal(fingerprint(),beforeReplay);
  const second=call(q(9002),c(9002,{reason:'Distinct operation, same observed facts'}),true).receipt;
  assert.equal(second.sourceId,first.sourceId);assert.equal(second.sourceText,first.sourceText);assert.equal(second.sourceSha256,first.sourceSha256);
  assert.equal(second.sourceReadAt,first.sourceReadAt);assert(second.observedAt>first.observedAt);assert(second.recordedAt>=second.observedAt);assert.deepEqual(counts(),{artifacts:1,operations:2});

  phase='source-change-preserves-old-receipt';
  const withdrawal=personalRulesNativeWithdraw(8002,1,1),captureAfter=c(9090);
  const changed=probe(`do $source$ begin perform public.faolla_attendance_personal_rules_v1(${json(personalRulesQueryInput())},'${owner}',${json(withdrawal)},true);end;$source$;`,
    expression(q(9090),captureAfter,true),q(9090),captureAfter).receipt;
  assert.equal(changed.sourceId,id(9090));assert.notEqual(changed.sourceSha256,first.sourceSha256);assert.equal(JSON.parse(changed.sourceText).personal.items[0].withdrawal.operationId,id(8002));
  assert.deepEqual(call(q()).receipt,first);assert.deepEqual(counts(),{artifacts:1,operations:2});

  phase='authorization-identity-pause-and-shape';
  reject('attendance_access_denied',expression(q(),null,false,id(98)));
  reject('attendance_access_denied',expression(q(9001,{siteId:'99990002'})));
  reject('attendance_access_denied',expression(q(9001,{workerId:id(202)})));
  reject('attendance_access_denied',expression(q(),null,false,id(98)),`update public.merchants set user_id='${id(98)}' where id='${site}';`);
  reject('attendance_worker_not_found',expression(q(9001,{workerId:id(204)})));
  assert.equal(call(q(9990,{workerId:id(203)})).receipt,null);
  reject('attendance_operation_conflict',expression(q(),c(9001,{reason:'Changed exact command'}),false));
  reject('attendance_platform_paused',expression(q(9010),c(9010),false));
  reject('attendance_rule_capture_identity_changed',expression(q(9010),c(9010,{employeeAuthUserId:id(97)}),true));
  const rebind=`update public.merchant_enterprise_employees set auth_user_id='${id(97)}' where merchant_id='${site}' and id='${id(101)}';`;
  reject('attendance_rule_capture_identity_changed',expression(q()),rebind);reject('attendance_rule_capture_identity_changed',expression(q(),c(9001),false),rebind);
  const inactive=`update public.merchant_attendance_workers set active=false,version=version+1 where merchant_id='${site}' and id='${worker}';
    update public.merchant_enterprise_employees set status='disabled' where merchant_id='${site}' and id='${id(101)}';
    update public.merchant_attendance_settings set time_zone='Pacific/Apia',version=version+1 where merchant_id='${site}';`;
  assert.deepEqual(probe(inactive,expression(q(),c(9001),false),q(),c(9001)).receipt,first);
  assert.deepEqual(probe(inactive,expression(q())).receipt,first);
  reject('attendance_rule_capture_worker_inactive',expression(q(9010),c(9010),true),inactive);
  for(const query of [null,{}, {...q(),operationId:null},{...q(),extra:1}])reject('attendance_invalid_request',expression(query));
  for(const command of [{...c(9010),extra:1},{...c(9010),reason:' '},{...c(9010),fromDate:'2026-02-30'},{...c(9010),throughDate:day(9)},c(9011)])reject('attendance_invalid_request',expression(q(9010),command,true));

  phase='same-number-advisory-lock-race';assert.deepEqual(assertLifecycleSandbox(sql=>native.query(scope.sql(sql))),owned);
  const holder=native.connect(),waiter=native.connect();let waiting,witness=false;
  try{
    const holderPid=Number(await holder.step('select pg_backend_pid();'));assert(Number.isSafeInteger(holderPid)&&holderPid>0);
    await holder.step(scope.sql(`begin;reset role;${guard}`));
    const left=parse(JSON.parse(await holder.step(scope.sql(`set local role service_role;select ${expression(q(9003),c(9003),true)};`))),q(9003),c(9003));
    waiting=waiter.step(scope.sql(`begin;reset role;${guard}set local role service_role;select ${expression(q(9003),c(9003),true)};commit;`)).then(output=>({output,error:null}),error=>({output:null,error}));
    const until=Date.now()+2500;
    while(Date.now()<until){witness=native.query(`select count(*) from pg_stat_activity where application_name='${waiter.name}' and wait_event_type='Lock' and wait_event='advisory' and ${holderPid}=any(pg_blocking_pids(pid));`)==='1';if(witness)break;await new Promise(resolve=>setTimeout(resolve,15));}
    assert(witness,'capture_exact_advisory_blocker_not_witnessed');await holder.step('commit;');const right=await waiting;assert.equal(right.error,null);
    assert.deepEqual(parse(JSON.parse(right.output),q(9003),c(9003)).receipt,left.receipt);assert.equal(left.receipt.sourceId,id(9001));
  }finally{await Promise.all([holder.close(),waiter.close()]);if(waiting)await waiting;}
  assert.deepEqual(counts(),{artifacts:1,operations:3});assert.equal(protectedFingerprint(),protectedBefore);

  phase='actual-handler-service-SQL';
  const {handleRuleCaptures}=require('../src/app/api/merchant-enterprise/attendance/rule-captures/route-handler.ts');
  const {executeRuleCaptures}=require('../src/lib/merchantAttendanceRuleCaptures.server.ts');
  const {resolveCanonicalPortalOrigin}=require('../src/lib/canonicalPortalRequest.ts');let handlerCalls=0,moduleEnabled=true,actor=owner;
  const service={rpc:async(name,args)=>{assert.equal(name,rpc);assert.deepEqual(Object.keys(args).sort(),['p_auth_user_id','p_command','p_module_enabled','p_query']);handlerCalls++;
    const query=parseRuleCapturesQuery(args.p_query),command=args.p_command===null?null:parseRuleCapturesBody({query,command:args.p_command}).command;
    try{return {data:call(query,command,args.p_module_enabled,args.p_auth_user_id),error:null};}
    catch(error){const code=String(error).match(/ERROR:\s+(?:[0-9A-Z]{5}:\s+)?([a-z_]+)(?=\r?\n|$)/)?.[1];if(!Object.hasOwn(RULE_CAPTURES_ERRORS,code??''))throw error;return {data:null,error:{message:code}};}}};
  const dependencies={enabled:()=>true,authenticate:async()=>({user:{id:actor},authenticationMethods:['password']}),allow:()=>true,
    entitlement:async()=>({permissionConfig:{allowEnterpriseManagement:true,allowEmployeeAttendance:moduleEnabled}}),execute:input=>executeRuleCaptures(input,service)};
  const request=(query,command=null)=>new Request(resolveCanonicalPortalOrigin()+'/api/merchant-enterprise/attendance/rule-captures'+(command?'':'?'+new URLSearchParams(query)),
    {method:command?'POST':'GET',headers:{Host:'www.faolla.com',Origin:resolveCanonicalPortalOrigin(),'Content-Type':'application/json'},...(command?{body:JSON.stringify({query,command})}:{})});
  const fresh=await handleRuleCaptures(request(q(9004),c(9004)),dependencies);assert.equal(fresh.status,200);assert.equal(fresh.headers.get('Cache-Control'),'private, no-store');
  const freshBody=await fresh.json();parse(freshBody.data,q(9004),c(9004));assert.equal(freshBody.data.receipt.sourceId,id(9001));
  moduleEnabled=false;const beforeHandlerRecovery=fingerprint();
  for(const command of [null,c(9004)]){const response=await handleRuleCaptures(request(q(9004),command),dependencies);assert.equal(response.status,200);
    const body=await response.json();assert.equal(body.moduleEnabled,false);assert.deepEqual(parse(body.data,q(9004),command).receipt,freshBody.data.receipt);}
  const paused=await handleRuleCaptures(request(q(9005),c(9005)),dependencies);assert.equal(paused.status,403);assert.deepEqual(await paused.json(),{ok:false,error:'attendance_platform_paused'});
  actor=id(98);const wrongOwner=await handleRuleCaptures(request(q()),dependencies);assert.equal(wrongOwner.status,403);assert.deepEqual(await wrongOwner.json(),{ok:false,error:'attendance_access_denied'});
  assert.equal(handlerCalls,5);assert.equal(fingerprint(),beforeHandlerRecovery);assert.deepEqual(counts(),{artifacts:1,operations:4});

  phase='synthetic-operation-quota';const beforeQuota=fingerprint(),quotaSyntheticOperations=996;
  // Explicit synthetic quota rows reuse one actual artifact. They are NOT996
  // new source observations and never call an old writer. Constraints remain on.
  exec(`begin;reset role;insert into public.merchant_attendance_rule_capture_operations(merchant_id,operation_id,worker_id,actor_auth_user_id,employee_id,employee_auth_user_id,source_id,command,observed_at,recorded_at)
    select o.merchant_id,('00000000-0000-4000-8000-'||lpad((10000+n)::text,12,'0'))::uuid,o.worker_id,o.actor_auth_user_id,o.employee_id,o.employee_auth_user_id,o.source_id,
      o.command||jsonb_build_object('operationId',('00000000-0000-4000-8000-'||lpad((10000+n)::text,12,'0'))::uuid,'reason','Synthetic quota row, not a source read'),o.observed_at,o.recorded_at
    from public.merchant_attendance_rule_capture_operations o cross join generate_series(1,${quotaSyntheticOperations}) n where o.merchant_id='${site}' and o.operation_id='${id(9001)}';
    set constraints all immediate;set local role service_role;do $quota$ declare original jsonb;begin
      ${denied('attendance_rule_capture_limit',expression(q(9500),c(9500),true))}
      original:=${expression(q(),c(9001),false)};assert original->'receipt'=${json(first)},'capture_quota_blocked_original_recovery';
      end;$quota$;rollback;`);
  assert.equal(fingerprint(),beforeQuota,'capture_quota_not_restored');

  phase='private-ACL-append-only-final-fingerprints';const beforeAcl=fingerprint();
  for(const role of ['anon','authenticated'])exec(`set local role ${role};do $acl$ begin begin perform ${expression(q())};raise exception 'capture_browser_execute_allowed';exception when insufficient_privilege then null;end;end;$acl$;`);
  for(const role of ['anon','authenticated','service_role'])exec(`set local role ${role};do $private$ begin
    ${ruleCapturesNativeTables.map(table=>`assert not has_table_privilege(current_user,'public.${table}','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),'capture_private_table_grant';
      begin perform 1 from public.${table};raise exception 'capture_private_table_read';exception when insufficient_privilege then null;end;`).join('\n')}
    ${signatures.slice(1).map(signature=>`assert not has_function_privilege(current_user,${quote(signature)},'EXECUTE'),'capture_private_helper_grant';`).join('\n')}
    end;$private$;`);
  exec(`begin;reset role;do $immutable$ begin
    ${ruleCapturesNativeTables.map(table=>`begin update public.${table} set worker_id=worker_id;raise exception 'capture_update_allowed';exception when insufficient_privilege then null;end;
      begin delete from public.${table};raise exception 'capture_delete_allowed';exception when insufficient_privilege then null;end;`).join('\n')}
    begin truncate public.merchant_attendance_rule_capture_artifacts,public.merchant_attendance_rule_capture_operations;raise exception 'capture_truncate_allowed';exception when insufficient_privilege then null;end;
    end;$immutable$;rollback;`);
  assert.equal(fingerprint(),beforeAcl);assert.equal(protectedFingerprint(),protectedBefore);assert.equal(oldDefinitions(),oldDefinition);
  assert.deepEqual(counts(),{artifacts:1,operations:4});for(const label of labels)native.pass(label);
  return {checks:labels.length,artifacts:1,operations:4,successfulCalls,handlerSqlCalls:handlerCalls,exactAdvisoryLockWitnesses:1,quotaSyntheticOperations,
    sourceChangeRollbackCaptures:1,allReadAndRollbackFingerprintsUnchanged:true,oldFactsAndDefinitionsUnchanged:true,syntheticOnly:true,noBrowser:true,
    applied:false,historicalApplicationProven:false,callerOwnedNamespaceCleanup:true};
}

export async function runAttendanceRuleCapturesNative(args){return runAttendanceLabelsReuse(args,native=>withAttendanceConcurrencySandbox(native,async scope=>{
  const result=await checkAttendanceRuleCapturesNative(native,scope);console.log(JSON.stringify({ruleCapturesNative:result}));
}));}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  runAttendanceRuleCapturesNative(process.argv.slice(2)).catch(error=>{console.error(JSON.stringify(ruleCapturesNativeFailure(error)));process.exitCode=1;});
}
