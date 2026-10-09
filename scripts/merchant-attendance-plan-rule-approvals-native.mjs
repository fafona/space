//166 inert acceptance; no configured production database, new cluster or copy.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {runAttendanceLabelsReuse} from './merchant-attendance-choice-labels-reuse-native.mjs';
import {withAttendanceConcurrencySandbox} from './merchant-attendance-concurrency-sandbox.mjs';
import {preparePlanRuleApprovalsNative,planRuleApprovalsExpression as expression,planRuleApprovalsRpc as rpc,planRuleApprovalsMigration} from './fixtures/attendance-plan-rule-approvals-native.mjs';
import {checkPlanRuleApprovalLimits} from './fixtures/attendance-plan-rule-approvals-limits.mjs';
import {boundClockMigrationBody,quote} from './fixtures/attendance-bound-clocks-native.mjs';
import {rulesNativeSave,rulesNativePublish,rulesNativeChoices} from './merchant-attendance-rules-native.mjs';
import {personalRulesQueryInput,personalRulesNativeApprove} from './merchant-attendance-personal-rules-native.mjs';
import {groupsQueryInput,groupsNativeSave,groupsNativeAssign} from './merchant-attendance-groups-native.mjs';
import {selfScheduleExpression} from './fixtures/attendance-self-schedule-native.mjs';
import {lifecycleId as id,lifecycleJson as json,lifecycleRace} from './merchant-attendance-lifecycle-native-support.mjs';

const require=createRequire(import.meta.url);
export const planRuleApprovalsNativeLabels=Object.freeze([
  '140 installs and reapplies without old fact definition or ACL changes',
  'actual future127 publication produces strict preview and independent fixed late early approval',
  'same operation paused recovery and deduplicated sources retain original receipts and old snapshots',
  'stale source head revision and operation payload conflicts never write',
  'known intra-plan rule and personal boundary switches block while unrelated reminder-only changes do not',
  'current owner and dual identity authorization protect empty collections and old receipts',
  'cancelled unpublished and actually associated plans refuse new approval without blocking real clock',
  'real lock witnesses coordinate approval rule changes cancellation identity and competing approval',
  'actual handler service SQL and private immutable archival ACL remain bounded',
]);
let phase='entry';
export async function checkPlanRuleApprovalsNative(native,scope,browserCheck=null){
  phase='prepare';const d=await preparePlanRuleApprovalsNative(native,scope),{exec,owner,worker,employee,site,slots}=d;
  const {parsePlanRuleApprovalsResult}=require('../src/lib/merchantAttendancePlanRuleApprovals.ts');
  const {executePlanRuleApprovals}=require('../src/lib/merchantAttendancePlanRuleApprovals.server.ts');
  const {handlePlanRuleApprovals}=require('../src/app/api/merchant-enterprise/attendance/plan-rule-approvals/route-handler.ts');
  const parse=(raw,q,actor=owner,c=null)=>parsePlanRuleApprovalsResult(raw,q,actor,c);
  const read=(q=d.query(),c=null,actor=owner,enabled=true)=>parse(d.raw(q,c,actor,enabled),q,actor,c);
  const untouched=async fn=>{const before=d.fingerprint(),defs=d.definitions();try{return await fn();}finally{assert.equal(d.fingerprint(),before);assert.equal(d.definitions(),defs);}};
  const denial=(q,c,code,actor=owner,enabled=true)=>`do $denied$ begin begin perform ${expression(q,actor,c,enabled)};raise assert_failure using message='plan_rule_unexpected_success';exception when others then if sqlerrm<>${quote(code)} then raise;end if;end;end;$denied$;`;
  const reject=(q,c,code,setup='',actor=owner,enabled=true)=>untouched(()=>exec(`begin;${setup}set local role service_role;${denial(q,c,code,actor,enabled)}reset role;rollback;`));
  const probe=(setup,q=d.query(),actor=owner,enabled=true)=>untouched(()=>parse(JSON.parse(exec(`begin;${setup}set local role service_role;select ${expression(q,actor,null,enabled)};reset role;rollback;`)),q,actor));
  native.pass(planRuleApprovalsNativeLabels[0]);
  phase='future-publication';
  const empty=await untouched(()=>read());assert.equal(empty.preview.eligible,true);assert.equal(empty.preview.source.fields.lateGraceMinutes.state,'unconfigured');
  assert.equal((await untouched(()=>read(d.query(slots.main,'read')))).approval,null);
  d.publishRules();const preview=read();assert.equal(preview.preview.eligible,true);
  assert.equal(preview.preview.source.fields.lateGraceMinutes.minutes,0);assert.equal(preview.preview.source.fields.earlyGraceMinutes.state,'disabled');
  const command=d.approvalCommand(preview,166101),query=d.query(slots.main,'approve',command.operationId);
  const approved=read(query,command);assert.equal(approved.revision,1);assert.deepEqual(approved.approval.source,preview.preview.source);
  assert.equal(approved.approval.sourceSha256,command.expectedFingerprint);native.pass(planRuleApprovalsNativeLabels[1]);
  phase='recovery-dedup';
  const recovered=await untouched(()=>read(d.query(slots.main,'recover',command.operationId),null,owner,false));assert.deepEqual(recovered.approval,approved.approval);
  assert.deepEqual((await untouched(()=>read(query,command,owner,false))).approval,approved.approval);
  const newer=d.approvalCommand(read(),166102),second=read(d.query(slots.main,'approve',newer.operationId),newer);
  assert.equal(second.revision,2);assert.equal(second.approval.sourceId,approved.approval.sourceId);
  assert.deepEqual(read(d.query(slots.main,'recover',command.operationId)).approval,approved.approval);
  assert.equal(read(d.query(slots.main,'read')).approval.operationId,newer.operationId);
  native.pass(planRuleApprovalsNativeLabels[2]);
  phase='CAS-conflicts';
  await reject(query,{...command,reason:'different command'},'attendance_operation_conflict');
  const stale=d.approvalCommand(read(),166103);
  const draft=rulesNativeSave(166110,2),draftSql=`set local role service_role;do $draft$ begin perform ${d.ruleExpression(draft)};end;$draft$;reset role;`;
  await reject(d.query(slots.main,'approve',stale.operationId),stale,'attendance_plan_rule_source_conflict',draftSql);
  await reject(d.query(slots.main,'approve',id(166104)),{...stale,operationId:id(166104),expectedRevision:0},'attendance_version_conflict');
  assert.deepEqual(read(d.query(slots.main,'read')).approval,second.approval);native.pass(planRuleApprovalsNativeLabels[3]);
  phase='known-boundaries';
  const atBoundary=rulesNativePublish(166111,3,d.day(2));
  const setupRules=choices=>`set local role service_role;do $switch$ begin perform ${d.ruleExpression({...draft,rules:choices})};perform ${d.ruleExpression(atBoundary)};end;$switch$;reset role;`;
  const changed=await probe(setupRules({...rulesNativeChoices(),lateGraceMinutes:{mode:'value',minutes:10}}),d.query(slots.overnight));
  assert.equal(changed.preview.eligible,false);assert(changed.preview.blockers.includes('source_switch'));
  const same=await probe(setupRules(rulesNativeChoices()),d.query(slots.overnight));assert(same.preview.blockers.includes('source_switch'));
  const reminder=await probe(setupRules({...rulesNativeChoices(),openSpanWarningMinutes:{mode:'value',minutes:60}}),d.query(slots.overnight));assert.equal(reminder.preview.eligible,true);
  const personal=personalRulesNativeApprove(166120,0,d.day(1),d.day(1));
  const personalSql=`set local role service_role;do $personal$ begin perform public.faolla_attendance_personal_rules_v1(${json(personalRulesQueryInput())},'${owner}',${json(personal)},true);end;$personal$;reset role;`;
  const expired=await probe(personalSql,d.query(slots.overnight));assert(expired.preview.blockers.includes('source_switch'));
  native.pass(planRuleApprovalsNativeLabels[4]);
  phase='authorization';
  await reject(d.query(),null,'attendance_access_denied','',id(98));
  await reject(d.query(),null,'attendance_plan_rule_identity_changed',`update public.merchant_enterprise_employees set auth_user_id='${id(97)}' where merchant_id='${site}' and id='${employee}';`);
  const paused=await probe(`update public.merchant_attendance_settings set enabled=false where merchant_id='${site}';`);
  assert.equal(paused.preview.eligible,false);assert(paused.preview.blockers.includes('module_paused'));
  const inactive=await probe(`update public.merchant_attendance_workers set active=false where merchant_id='${site}' and id='${worker}';`);
  assert(inactive.preview.blockers.includes('worker_inactive'));
  const newOwner=`update public.merchants set user_id='${id(98)}' where id='${site}';`;
  assert.equal((await probe(newOwner,d.query(slots.main,'read'),id(98))).approval.actorId,owner);
  await reject(d.query(slots.main,'recover',command.operationId),null,'attendance_access_denied',newOwner,id(98));
  native.pass(planRuleApprovalsNativeLabels[5]);
  phase='plan-state';
  assert(read(d.query(slots.legacy)).preview.blockers.includes('publication_missing'));
  const cancelSql=`set local role service_role;do $cancel$ begin perform ${d.cancelExpression(d.cancelCommand(slots.main))};end;$cancel$;reset role;`;
  assert((await probe(cancelSql)).preview.blockers.includes('cancelled'));
  assert.deepEqual((await probe(cancelSql,d.query(slots.main,'read'))).approval,second.approval);
  // Actual137 selected clock succeeds independently; subsequent policy approval is blocked.
  const selected=await d.request(d.command(),d.selected(slots.race),null,{baseEnabled:()=>true,featureEnabled:()=>true,bindRules:()=>false});assert.equal(selected.status,200);
  assert(read(d.query(slots.race)).preview.blockers.includes('associated'));
  await d.oldClock('clock_out');native.pass(planRuleApprovalsNativeLabels[6]);
  phase='concurrent-coordination';
  const holder=`reset role;${d.guard}set local role service_role;select ${expression(d.query(),owner)};`;
  const group=groupsNativeSave(166150),groupQuery=groupsQueryInput();
  exec(`set local role service_role;do $group$ begin perform public.faolla_attendance_groups_v1(${json(groupQuery)},'${owner}',${json(group)},true);end;$group$;`);
  const assignment=groupsNativeAssign(166151,group.groupId,worker,{startsOn:d.day(1),endsOn:d.day(2)});
  const changeCommands=[`select ${d.ruleExpression(draft)};`,`select ${d.cancelExpression(d.cancelCommand(slots.main))};`,
    `reset role;update public.merchant_enterprise_employees set auth_user_id='${id(97)}' where merchant_id='${site}' and id='${employee}';`,
    `select public.faolla_attendance_groups_v1(${json(groupsQueryInput({groupId:group.groupId,workerId:worker}))},'${owner}',${json(assignment)},true);`,
    `select ${selfScheduleExpression(d.input(d.command(),d.selected(slots.main)))};`];
  let races=0;
  for(const change of changeCommands)await untouched(async()=>{
    phase=`concurrent-coordination-${races+1}`;
    // A rejected fixture command cannot prove or disprove lock coordination.
    // Validate the exact waiter once in its own rolled-back owned transaction.
    exec(`begin;reset role;${d.guard}set local role service_role;${change}reset role;rollback;`);
    const result=await lifecycleRace({connect:native.connect,query:native.query,sql:scope.sql},holder,
      `reset role;${d.guard}savepoint probe;set local role service_role;${change}reset role;rollback to savepoint probe;`);
    assert(result.witnessed);assert.equal(result.right.error,null);races++;
  });
  const racePreview=read(d.query(slots.alternate)),raceCommand=d.approvalCommand(racePreview,166130),raceQuery=d.query(slots.alternate,'approve',raceCommand.operationId);
  const competing={...raceCommand,operationId:id(166131)},competingQuery=d.query(slots.alternate,'approve',competing.operationId);
  const simultaneous=await lifecycleRace({connect:native.connect,query:native.query,sql:scope.sql},
    `reset role;${d.guard}set local role service_role;select ${expression(raceQuery,owner,raceCommand)};`,
    `reset role;${d.guard}set local role service_role;${denial(competingQuery,competing,'attendance_version_conflict')}`);
  assert(simultaneous.witnessed);assert.equal(simultaneous.right.error,null);races++;
  native.pass(planRuleApprovalsNativeLabels[7]);
  phase='handler-and-ACL';let serviceCalls=0;
  const service={rpc:async(name,args)=>{assert.equal(name,rpc);serviceCalls++;try{return {data:d.raw(args.p_query,args.p_command,args.p_auth_user_id,args.p_module_enabled),error:null};}
    catch(error){const code=String(error).match(/ERROR:\s+(attendance_[a-z_]+)/)?.[1];if(!code)throw error;return {data:null,error:{message:code}};}}};
  const deps={enabled:()=>true,authenticate:async()=>({user:{id:owner},authenticationMethods:['password']}),allow:()=>true,
    entitlement:async()=>({permissionConfig:{allowEnterpriseManagement:true,allowEmployeeAttendance:true}}),execute:input=>executePlanRuleApprovals(input,service)};
  const q=d.query(slots.main,'read'),params=new URLSearchParams(Object.entries(q).filter(([,v])=>v!==null));
  const response=await handlePlanRuleApprovals(new Request(`https://www.faolla.com/api/merchant-enterprise/attendance/plan-rule-approvals?${params}`,{headers:{Origin:'https://www.faolla.com'}}),deps);
  assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'private, no-store');assert.equal(serviceCalls,1);
  assert.deepEqual((await response.json()).data.approval,second.approval);
  const newTables=d.inventory().filter(t=>!d.protectedTables.includes(t)&&t!=='faolla_schema_migrations');assert.equal(newTables.length,3);
  await untouched(()=>exec(`do $acl$ declare role_name text;table_name text;begin foreach role_name in array array['anon','authenticated','service_role'] loop
    assert has_function_privilege(role_name,'public.${rpc}(jsonb,uuid,jsonb,boolean)','EXECUTE')=(role_name='service_role');
    foreach table_name in array array[${newTables.map(quote).join(',')}] loop assert not has_table_privilege(role_name,'public.'||table_name,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER');end loop;
    end loop;end;$acl$;`));
  const beforeReapply=d.fingerprint();exec(boundClockMigrationBody(native.root,planRuleApprovalsMigration));assert.equal(d.fingerprint(),beforeReapply);
  assert.equal(d.oldDefinitions(),d.oldDefs);assert.equal(d.definitions(),d.installedDefinitions);native.pass(planRuleApprovalsNativeLabels[8]);
  phase='limits-and-immutable';const limits=await checkPlanRuleApprovalLimits({d,native,scope});
  const browser=browserCheck?await browserCheck(native,scope,d):null;
  return {checks:planRuleApprovalsNativeLabels.length+limits.checks,lockWitnesses:races,serviceCalls,limits,browser,actual127:true,actual129:true,actual136:true,actual137:true,
    realAuth:false,productionAccess:false,newCluster:false,fullBuild:false,oldDefinitionsUnchanged:true};
}
export async function runPlanRuleApprovalsNative(args,browserCheck=null){let result;await runAttendanceLabelsReuse(args,native=>withAttendanceConcurrencySandbox(native,async scope=>{
  result=await checkPlanRuleApprovalsNative(native,scope,browserCheck);}));return result;}
export const planRuleApprovalsNativeFailure=error=>({error:'plan_rule_native_failed',phase,code:String(error).match(/attendance_[a-z_]+/)?.[0]??'local_check_failed',
  assertion:error instanceof assert.AssertionError?error.message:null,sourceLine:Number(String(error).match(/line (\d+)/)?.[1]??0),
  assertionStack:error instanceof assert.AssertionError?String(error.stack).split('\n').slice(0,5):undefined});
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))runPlanRuleApprovalsNative(process.argv.slice(2)).then(result=>console.log(JSON.stringify(result))).catch(error=>{
  console.error(JSON.stringify(planRuleApprovalsNativeFailure(error)));process.exitCode=1;});
