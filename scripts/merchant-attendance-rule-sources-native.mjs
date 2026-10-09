// Standalone rule-only native evidence. Import is inert. The caller explicitly
// owns a stopped synthetic PG namespace; never use an application database.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {runAttendanceLabelsReuse} from './merchant-attendance-choice-labels-reuse-native.mjs';
import {withAttendanceConcurrencySandbox} from './merchant-attendance-concurrency-sandbox.mjs';
import {prepareGroupsNativeFixture,groupsNativePlan,groupsQueryInput,groupsNativeSave,groupsNativeAssign,groupsNativeCancel} from './merchant-attendance-groups-native.mjs';
import {rulesMigrationPlan,rulesQueryInput,rulesNativeSave,rulesNativePublish,rulesNativeWithdraw,rulesNativeFailure} from './merchant-attendance-rules-native.mjs';
import {personalRulesMigrationPlan,personalRulesQueryInput,personalRulesNativeApprove,personalRulesNativeWithdraw} from './merchant-attendance-personal-rules-native.mjs';
import {assertLifecycleSandbox,lifecycleId as id,lifecycleJson as json} from './merchant-attendance-lifecycle-native-support.mjs';

const require=createRequire(import.meta.url),site='99990001',owner=id(99),worker=id(201),group=id(7001);
const rpc='faolla_attendance_rule_sources_v1',migrationName='202610040130_merchant_attendance_rule_sources.sql';
const checker='faolla_attendance_rule_sources_personal_checked_v1';
const newFunctionIdentities=[`public.${rpc}(jsonb,uuid)`,`public.${checker}(public.merchant_attendance_personal_rule_operations,jsonb)`];
const quote=value=>"'"+String(value).replaceAll("'","''")+"'";
const labels=Object.freeze([
  'rule sources130 installs/reapplies without changing old functions, ACLs, tables or business facts',
  'rule sources actual SQL/parser reads explicit personal-group-enterprise provenance, cancelled assignment and withdrawn original approval',
  'rule sources indexed carry-in survives26later drafts, includes inside-range publication and excludes withdrawn/outside publications',
  'rule sources current owner/worker/dual-identity fences and saved-zone DST/skipped-date endpoints fail closed without rewriting snapshots',
  'rule sources one exact settings-blocker PID keeps two reads unchanged in one transaction, then exposes the committed writer afterward',
  'rule sources100synthetic personal candidate pairs are complete and101 are limited-empty under unchanged statement timeout, all cap rows roll back',
  'rule sources private cache rechecks eight invalid synthetic composite variants without modifying stored source rows',
  'rule sources actual GET handler/service/SQL supports paused reads, rejects another owner, enforces private ACLs and never writes on read',
]);
let phase='entry';
export const ruleSourcesQueryInput=(fromDate,throughDate=fromDate,patch={})=>({siteId:site,workerId:worker,fromDate,throughDate,...patch});
const expression=(query,actor=owner)=>`public.${rpc}(${json(query)},'${actor}')`;
const personalExpression=command=>`public.faolla_attendance_personal_rules_v1(${json(personalRulesQueryInput())},'${owner}',${json(command)},true)`;
const denied=(code,expr)=>`begin perform ${expr};raise exception 'rule_sources_unexpected_acceptance';exception when sqlstate 'P0001' then if sqlerrm<>${quote(code)} then raise;end if;end;`;
export function ruleSourcesMigrationPlan(root,scope){
  assert(typeof root==='string'&&path.isAbsolute(root));assert(scope&&/^attendance_race_[a-f0-9]{32}$/.test(scope.schema)&&typeof scope.sql==='function');
  const source=readFileSync(path.join(root,'scripts/supabase-migrations',migrationName),'utf8');
  const body=source.replace(/^begin;\s*$/m,'').replace(/^commit;\s*$/m,''),statement=scope.sql(body);
  assert(!/\bpublic\./.test(statement));assert(!/search_path\s*(?:=|to)\s*(?:pg_catalog,\s*)?public\b/.test(statement));return {name:migrationName,source,body,statement};
}
export function ruleSourcesNativeFailure(error){
  const safe=rulesNativeFailure(error),message=error instanceof Error?error.message:'',code=message.match(/ERROR:\s+(?:[0-9A-Z]{5}:\s+)?([a-z_]+)(?=\r?\n|$)/)?.[1];
  const known=new Set(['attendance_rule_sources_invalid','attendance_rule_sources_too_large','attendance_worker_not_found','attendance_personal_rule_invalid',
    'attendance_personal_rule_identity_changed','merchant_attendance_rule_sources_prerequisite_required','merchant_attendance_rule_sources_installation_conflict']);
  return {...safe,error:'rule_sources_native_failed',phase,...(known.has(code)?{code,sqlMessage:code}:{})};
}

export async function prepareRuleSourcesNativeFixture(native,scope){
  phase='install';const foundation=await prepareGroupsNativeFixture(native,scope),{exec,owned}=foundation;
  exec(rulesMigrationPlan(native.root,scope).body);exec(personalRulesMigrationPlan(native.root,scope).body);
  const {parseRuleSourcesResult}=require('../src/lib/merchantAttendanceRuleSources.ts');
  const inventory=()=>JSON.parse(exec(`select jsonb_agg(relname order by relname) from pg_class where relnamespace=${owned.oid} and relkind in('r','p');`));
  const tables=inventory(),guard=groupsNativePlan(owned,tables).guard;
  const fpExpression=selected=>`(select md5(jsonb_build_object(${selected.map(table=>`${quote(table)},(select coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text),'[]'::jsonb) from public.${table} r)`).join(',')})::text))`;
  const fp=fpExpression(tables),businessFp=fpExpression(tables.filter(table=>table!=='faolla_schema_migrations'));
  const fingerprint=()=>{assert.deepEqual(inventory(),tables);return exec(`select ${fp};`);};
  const oldDefinition=()=>exec(`select md5(coalesce(jsonb_agg(jsonb_build_array(p.proname,pg_get_functiondef(p.oid),p.proowner,p.proacl,p.proconfig,p.prosecdef) order by p.proname,p.oid),'[]'::jsonb)::text)
    from pg_proc p where p.pronamespace=${owned.oid} and p.prokind='f' and ${newFunctionIdentities.map(name=>`p.oid is distinct from to_regprocedure(${quote(name)})`).join(' and ')};`);
  const prior=oldDefinition(),businessBefore=exec(`select ${businessFp};`),migration=ruleSourcesMigrationPlan(native.root,scope);
  exec(migration.body);assert.deepEqual(inventory(),tables,'rule_sources_added_tables');assert.equal(oldDefinition(),prior);assert.equal(exec(`select ${businessFp};`),businessBefore);
  const definition=()=>exec(`select jsonb_agg(jsonb_build_array(p.proname,pg_get_functiondef(p.oid),p.proowner,p.proacl,p.proconfig,p.prosecdef,p.provolatile) order by p.proname)
    from pg_proc p where p.pronamespace=${owned.oid} and p.oid in(${newFunctionIdentities.map(name=>`to_regprocedure(${quote(name)})`).join(',')});`);
  const installed=definition(),beforeReapply=fingerprint();exec(migration.body);assert.equal(definition(),installed);assert.equal(fingerprint(),beforeReapply);assert.equal(oldDefinition(),prior);
  assert.equal(JSON.parse(installed).length,2,'rule_sources_expected_two_new_functions');
  const today=exec("select (clock_timestamp() at time zone 'UTC')::date::text;"),day=n=>new Date(Date.parse(today+'T00:00:00.000Z')+n*86400000).toISOString().slice(0,10);
  const query=ruleSourcesQueryInput(day(3),day(4));let readCount=0;
  const parse=(raw,q=query,actor=owner)=>parseRuleSourcesResult(raw,q,actor);
  const readRaw=(q=query,actor=owner)=>{const before=fingerprint();try{readCount++;return JSON.parse(exec(`set local role service_role;select ${expression(q,actor)};`));}
    finally{assert.equal(fingerprint(),before,'rule_sources_read_changed_all_tables');}};
  const read=(q=query,actor=owner)=>parse(readRaw(q,actor),q,actor);
  const empty=read();assert.equal(empty.personal.revision,0);assert.deepEqual(empty.personal.items,[]);assert.deepEqual(empty.assignments.items,[]);
  assert.deepEqual(empty.rules.items,[{groupId:null,revision:0,publications:[]}]);
  const write=(name,q,command)=>JSON.parse(exec(`set local role service_role;select public.${name}(${json(q)},'${owner}',${json(command)},true);`));
  const ruleWrite=(command,gid=null)=>write('faolla_attendance_rules_v1',rulesQueryInput({groupId:gid}),command);
  const personalWrite=command=>write('faolla_attendance_personal_rules_v1',personalRulesQueryInput(),command);
  phase='minimal-real-rule-facts';foundation.call(groupsQueryInput(),groupsNativeSave(7001),true);
  const assign=n=>groupsNativeAssign(n,group,worker,{startsOn:day(2),endsOn:day(5)});
  foundation.call(groupsQueryInput({groupId:group,workerId:worker}),assign(7101),true);
  foundation.call(groupsQueryInput({groupId:group,workerId:worker,assignmentId:id(7101)}),groupsNativeCancel(7102,id(7101)),true);
  foundation.call(groupsQueryInput({groupId:group,workerId:worker}),assign(7103),true);
  const enterpriseRules={lateGraceMinutes:{mode:'value',minutes:12},earlyGraceMinutes:{mode:'value',minutes:3},openSpanWarningMinutes:{mode:'value',minutes:120},completedBreakMinimumMinutes:{mode:'disabled'}};
  const groupRules={lateGraceMinutes:{mode:'inherit'},earlyGraceMinutes:{mode:'disabled'},openSpanWarningMinutes:{mode:'inherit'},completedBreakMinimumMinutes:{mode:'value',minutes:1}};
  ruleWrite(rulesNativeSave(7501,0,{rules:enterpriseRules}));ruleWrite(rulesNativePublish(7502,1,day(2)));
  // Each old writer validates and returns its own bounded history. Keep26
  // setup calls in separate statements; do not accumulate them under one10s DO.
  for(let n=0;n<26;n++)ruleWrite(rulesNativeSave(7600+n,2+n,{rules:enterpriseRules}));
  ruleWrite(rulesNativePublish(7504,28,day(4)));ruleWrite(rulesNativeWithdraw(7505,29,29));
  ruleWrite(rulesNativeSave(7701,0,{expectedGroupRevision:1,rules:groupRules}),group);ruleWrite(rulesNativePublish(7702,1,day(2),{expectedGroupRevision:1}),group);
  ruleWrite(rulesNativeSave(7703,2,{expectedGroupRevision:1,rules:{...groupRules,lateGraceMinutes:{mode:'value',minutes:5},completedBreakMinimumMinutes:{mode:'value',minutes:2}}}),group);
  ruleWrite(rulesNativePublish(7704,3,day(4),{expectedGroupRevision:1}),group);
  const zero={lateGraceMinutes:{mode:'value',minutes:0},earlyGraceMinutes:{mode:'inherit'},openSpanWarningMinutes:{mode:'inherit'},completedBreakMinimumMinutes:{mode:'inherit'}};
  const first=personalRulesNativeApprove(8001,0,day(2),day(3),{rules:zero});const original=personalWrite(first).receipt;
  personalWrite(personalRulesNativeWithdraw(8002,1,1));personalWrite(personalRulesNativeApprove(8003,2,day(2),day(3),{rules:zero}));
  personalWrite(personalRulesNativeApprove(8004,3,day(4),day(4),{rules:{...zero,lateGraceMinutes:{mode:'inherit'},earlyGraceMinutes:{mode:'disabled'},openSpanWarningMinutes:{mode:'value',minutes:100}}}));
  personalWrite(personalRulesNativeApprove(8005,4,day(5),day(5),{rules:zero}));
  const checkedTransactionRead=(raw,before,after,q=query)=>{
    assert.equal(after,before,'rule_sources_transaction_read_changed_facts');readCount++;return parse(raw,q);
  };
  const readStep=async(connection,q=query)=>{
    const before=await connection.step(scope.sql(`reset role;select ${fp};`));
    const raw=JSON.parse(await connection.step(scope.sql(`set local role service_role;select ${expression(q)};reset role;`)));
    return checkedTransactionRead(raw,before,await connection.step(scope.sql(`select ${fp};`)),q);
  };
  const probe=async(setup,q=query)=>{const before=fingerprint(),connection=native.connect();try{
    await connection.step(scope.sql(`begin;reset role;${guard}${setup}`));return await readStep(connection,q);
  }finally{await connection.close();assert.equal(fingerprint(),before,'rule_sources_probe_not_restored');}};
  return {exec,owned,tables,guard,fp,query,day,read,readRaw,readStep,checkedTransactionRead,parse,probe,fingerprint,oldDefinition,oldDefinitionBaseline:prior,
    originalApproval:original,readCount:()=>readCount};
}

export async function checkAttendanceRuleSourcesNative(native,scope){
  const data=await prepareRuleSourcesNativeFixture(native,scope),{exec,query,day}=data;
  const {resolveCandidateThreeLayerRules}=require('../src/lib/merchantAttendanceThreeLayerRules.ts');
  const {attendanceDayUtcRange}=require('../src/lib/merchantAttendanceTime.ts');
  phase='three-layer-evidence';const source=data.read();assert.equal(source.protocol,'rule-sources-v1');assert.equal(source.worker.employeeAuthUserId,id(1));
  assert.equal(source.assignments.items.length,2);assert.deepEqual(source.assignments.items.map(item=>item.detail.status).sort(),['assigned','cancelled']);
  assert.equal(source.personal.revision,5);assert.deepEqual(source.personal.items.map(pair=>pair.approval.revision),[1,3,4]);
  assert.deepEqual(source.personal.items[0].approval,data.originalApproval.item);assert.equal(source.personal.items[0].withdrawal.operationId,id(8002));
  assert.equal(source.personal.items[0].withdrawal.approvedRevision,1);assert.equal(source.personal.items[1].withdrawal,null);
  assert.equal(source.personal.items[1].approval.fromAt,day(2)+'T00:00:00.000Z');assert.equal(source.personal.items[1].approval.toAt,day(4)+'T00:00:00.000Z');
  assert.equal(source.rules.items.find(item=>item.groupId===null).revision,30);
  assert.deepEqual(source.rules.items.find(item=>item.groupId===null).publications.map(item=>item.operationId),[id(7502)]);
  assert.deepEqual(source.rules.items.find(item=>item.groupId===group).publications.map(item=>item.operationId),[id(7702),id(7704)]);
  const resolution=resolveCandidateThreeLayerRules(source);assert.equal(resolution.formalReady,false);assert.equal(resolution.applied,false);assert.equal(resolution.segments.length,2);
  const [left,right]=resolution.segments;assert([left,right].every(segment=>segment.status==='candidate'&&segment.assignmentId===id(7103)));
  assert.equal(left.personalApprovalRevision,3);assert.equal(left.fields.lateGraceMinutes.minutes,0);assert.equal(left.fields.lateGraceMinutes.source.operationId,id(8003));
  assert.equal(left.fields.earlyGraceMinutes.state,'disabled');assert.equal(left.fields.earlyGraceMinutes.source.operationId,id(7702));
  assert.equal(left.fields.openSpanWarningMinutes.minutes,120);assert.equal(left.fields.openSpanWarningMinutes.source.operationId,id(7502));
  assert.equal(left.fields.completedBreakMinimumMinutes.minutes,1);assert.equal(right.personalApprovalRevision,4);
  assert.equal(right.fields.lateGraceMinutes.minutes,5);assert.equal(right.fields.lateGraceMinutes.source.operationId,id(7704));
  assert.equal(right.fields.earlyGraceMinutes.state,'disabled');assert.equal(right.fields.earlyGraceMinutes.source.operationId,id(8004));
  assert.equal(right.fields.openSpanWarningMinutes.minutes,100);assert.equal(right.fields.completedBreakMinimumMinutes.minutes,2);

  phase='identity-and-date-fences';
  const reject=(q,actor,code)=>{const before=data.fingerprint();exec(`set local role service_role;do $deny$ begin ${denied(code,expression(q,actor))}end;$deny$;`);assert.equal(data.fingerprint(),before);};
  reject(query,id(98),'attendance_access_denied');reject({...query,siteId:'99990002'},owner,'attendance_access_denied');
  reject({...query,workerId:id(204)},owner,'attendance_worker_not_found');reject({...query,workerId:id(9999)},owner,'attendance_worker_not_found');
  for(const q of [null,{}, {...query,extra:true},{...query,workerId:null},{...query,throughDate:day(10)},{...query,fromDate:day(5)}])reject(q,owner,'attendance_invalid_request');
  const rollbackDenied=(setup,code,q=query)=>{const before=data.fingerprint();exec(`begin;reset role;${setup}set local role service_role;do $deny$ begin ${denied(code,expression(q))}end;$deny$;rollback;`);assert.equal(data.fingerprint(),before);};
  rollbackDenied(`update public.merchant_enterprise_employees set auth_user_id='${id(97)}' where merchant_id='${site}' and id='${id(101)}';`,'attendance_personal_rule_identity_changed',ruleSourcesQueryInput(day(20)));
  rollbackDenied(`update public.merchant_attendance_workers set employee_id=null,version=version+1 where merchant_id='${site}' and id='${worker}';`,'attendance_personal_rule_identity_changed');
  const unbound=data.read({...query,workerId:id(203)});assert.equal(unbound.worker.employeeId,null);assert.equal(unbound.personal.revision,0);assert.deepEqual(unbound.personal.items,[]);
  assert.equal(resolveCandidateThreeLayerRules(unbound).segments[0].status,'blocked');
  const inactive=await data.probe(`update public.merchant_attendance_workers set active=false,version=version+1 where merchant_id='${site}' and id='${worker}';
    update public.merchant_enterprise_employees set status='disabled' where merchant_id='${site}' and id='${id(101)}';`);
  assert.equal(inactive.worker.active,false);assert.equal(inactive.worker.employeeActive,false);assert.deepEqual(inactive.personal.items,source.personal.items);
  const shifted=await data.probe(`update public.merchant_attendance_settings set time_zone='Europe/Madrid',version=version+1 where merchant_id='${site}';`,ruleSourcesQueryInput('2027-03-28'));
  assert.equal(shifted.fromAt,attendanceDayUtcRange('2027-03-28','Europe/Madrid').startAt);assert.equal(shifted.toAt,attendanceDayUtcRange('2027-03-28','Europe/Madrid').endAt);
  rollbackDenied(`update public.merchant_attendance_settings set time_zone='Pacific/Apia',version=version+1 where merchant_id='${site}';`,'attendance_invalid_request',ruleSourcesQueryInput('2011-12-30'));

  phase='exact-settings-lock-snapshot';assert.deepEqual(assertLifecycleSandbox(sql=>native.query(scope.sql(sql))),data.owned);
  const holder=native.connect(),waiter=native.connect();let waiting,lockWitness=false;
  const raceCommand=personalRulesNativeWithdraw(8006,5,4);
  try{
    const holderPid=Number(await holder.step('select pg_backend_pid();'));assert(Number.isSafeInteger(holderPid)&&holderPid>0);assert.match(waiter.name,/^attendance_race_[a-f0-9]{32}$/);
    await holder.step(scope.sql(`begin;reset role;${data.guard}`));const first=await data.readStep(holder);
    waiting=waiter.step(scope.sql(`begin;reset role;${data.guard}set local role service_role;select ${personalExpression(raceCommand)};commit;`)).then(output=>({output,error:null}),error=>({output:null,error}));
    const until=Date.now()+2500;
    while(Date.now()<until){lockWitness=native.query(`select count(*) from pg_stat_activity where application_name='${waiter.name}' and wait_event_type='Lock' and ${holderPid}=any(pg_blocking_pids(pid));`)==='1';
      if(lockWitness)break;await new Promise(resolve=>setTimeout(resolve,15));}
    assert(lockWitness,'rule_sources_exact_blocker_not_witnessed');const second=await data.readStep(holder);
    assert.deepEqual({...first,readAt:null},{...second,readAt:null},'same_transaction_sources_moved_while_writer_waited');
    await holder.step('commit;');const finished=await waiting;assert.equal(finished.error,null);assert.equal(JSON.parse(finished.output).revision,6);
  }finally{await Promise.all([holder.close(),waiter.close()]);if(waiting)await waiting;}
  const afterRace=data.read();assert.equal(afterRace.personal.revision,6);assert.equal(afterRace.personal.items.find(pair=>pair.approval.revision===4).withdrawal.operationId,raceCommand.operationId);

  phase='private-cache-composite-negative-probes';const beforeCacheProbes=data.fingerprint();
  // Each probe changes only a PL/pgSQL composite, NEVER the stored row. A cache
  // warmed by the real approval4/withdrawal6 must not hide a later bad envelope,
  // snapshot, predecessor, identity, target or UTC boundary. This is explicitly
  // synthetic validator evidence, not eight attempts through the owner writer.
  const cacheMutations=[
    {base:'approval',change:"candidate.command:=candidate.command||jsonb_build_object('reason',' invalid leading space');",snapshot:true},
    {base:'approval',change:`candidate.command:=candidate.command||jsonb_build_object('operationId','${id(9901)}');`,snapshot:true},
    {base:'approval',change:"candidate.command:=candidate.command||jsonb_build_object('expectedRevision',2);",snapshot:true},
    {base:'approval',change:"candidate.snapshot:=candidate.snapshot||jsonb_build_object('reason','not the original command reason');",snapshot:false},
    {base:'approval',change:`candidate.employee_auth_user_id:='${id(97)}';candidate.command:=candidate.command||jsonb_build_object('employeeAuthUserId',candidate.employee_auth_user_id);`,snapshot:true},
    {base:'approval',change:"candidate.revision:=999;candidate.command:=candidate.command||jsonb_build_object('expectedRevision',998);",snapshot:true},
    {base:'withdrawal',change:"candidate.approved_revision:=2;candidate.command:=candidate.command||jsonb_build_object('approvedRevision',2);",snapshot:true},
    {base:'approval',change:"candidate.from_at:=candidate.from_at+interval '1 millisecond';",snapshot:true},
  ];
  assert.equal(cacheMutations.length,8);
  exec(`reset role;do $cache$ declare approval public.merchant_attendance_personal_rule_operations%rowtype;
    withdrawal public.merchant_attendance_personal_rule_operations%rowtype;candidate public.merchant_attendance_personal_rule_operations%rowtype;cache jsonb;
    begin select * into approval from public.merchant_attendance_personal_rule_operations where merchant_id='${site}' and worker_id='${worker}' and revision=4;
    select * into withdrawal from public.merchant_attendance_personal_rule_operations where merchant_id='${site}' and worker_id='${worker}' and revision=6;
    assert approval.operation_id='${id(8004)}' and withdrawal.operation_id='${id(8006)}','rule_sources_cache_templates_required';
    cache:=public.${checker}(approval,'{}'::jsonb);cache:=public.${checker}(withdrawal,cache);
    ${cacheMutations.map(({base,change,snapshot})=>`candidate:=${base};${change}${snapshot?'candidate.snapshot:=public.faolla_attendance_personal_rule_item_v1(candidate);':''}
      ${denied('attendance_personal_rule_invalid',`public.${checker}(candidate,cache)`)}`).join('\n')}
    end;$cache$;`);
  assert.equal(data.fingerprint(),beforeCacheProbes,'rule_sources_cache_probes_changed_facts');

  phase='personal100-101-candidate-cap';const beforeCap=data.fingerprint();let capSyntheticRows=0;const capReadElapsedMs=[];
  try{
    const steps=[];
    // ONLY this bounded stress fixture inserts synthetic rows directly. Its
    // templates are approval4/withdrawal6 just generated and read via real RPCs
    // in this owned namespace. It is NOT195 independently exercised writer calls.
    // Every existing check/FK/immutable trigger stays enabled; immediate FK checks
    // also prove each temporary head points at an already inserted operation.
    const clone=(first,count,withWithdrawals)=>{
      const statements=[];
      for(let n=first;n<first+count;n++){
        const revision=7+n*2,operationId=withWithdrawals?id(9000+n*2):id(9300);
        statements.push(`cap_approval.operation_id:='${operationId}';cap_approval.revision:=${revision};cap_approval.recorded_at:=clock_timestamp();
          cap_approval.command:=cap_approval.command||jsonb_build_object('operationId',cap_approval.operation_id,'expectedRevision',${revision-1},'reason','Synthetic cap projection row, not an owner RPC approval');
          cap_approval.snapshot:=public.faolla_attendance_personal_rule_item_v1(cap_approval);
          insert into public.merchant_attendance_personal_rule_operations select cap_approval.*;`);capSyntheticRows++;
        if(withWithdrawals){
          statements.push(`cap_withdrawal.operation_id:='${id(9001+n*2)}';cap_withdrawal.revision:=${revision+1};cap_withdrawal.approved_revision:=${revision};cap_withdrawal.recorded_at:=clock_timestamp();
            cap_withdrawal.command:=cap_withdrawal.command||jsonb_build_object('operationId',cap_withdrawal.operation_id,'expectedRevision',${revision},'approvedRevision',${revision},'reason','Synthetic cap projection withdrawal, not an owner RPC');
            cap_withdrawal.snapshot:=public.faolla_attendance_personal_rule_item_v1(cap_withdrawal);
            insert into public.merchant_attendance_personal_rule_operations select cap_withdrawal.*;
            update public.merchant_attendance_personal_rule_streams set revision=${revision+1},updated_at=cap_withdrawal.recorded_at where merchant_id='${site}' and worker_id='${worker}';`);capSyntheticRows++;
        }else statements.push(`update public.merchant_attendance_personal_rule_streams set revision=${revision},updated_at=cap_approval.recorded_at where merchant_id='${site}' and worker_id='${worker}';`);
      }
      return `reset role;do $cap$ declare cap_approval public.merchant_attendance_personal_rule_operations%rowtype;cap_withdrawal public.merchant_attendance_personal_rule_operations%rowtype;
        begin select * into cap_approval from public.merchant_attendance_personal_rule_operations where merchant_id='${site}' and worker_id='${worker}' and revision=4;
        select * into cap_withdrawal from public.merchant_attendance_personal_rule_operations where merchant_id='${site}' and worker_id='${worker}' and revision=6;
        assert cap_approval.operation_id='${id(8004)}' and cap_approval.action='approve' and cap_withdrawal.operation_id='${id(8006)}'
          and cap_withdrawal.action='withdraw' and cap_withdrawal.approved_revision=4,'rule_sources_synthetic_cap_template_required';
        assert (select revision from public.merchant_attendance_personal_rule_streams where merchant_id='${site}' and worker_id='${worker}')=${6+first*2},'rule_sources_synthetic_cap_head_changed';
        ${statements.join('\n')}end;$cap$;`;
    };
    // Three original approvals overlap the period.97 cloned pairs bring the
    // candidate set to100. Five pairs per step avoid a large constraint batch.
    // querySteps holds one owned BEGIN/ROLLBACK connection with unchanged10s
    // SQL/25s per-step limits, without the short race connection's25s lifetime.
    for(let n=0;n<97;n+=5)steps.push(`${n===0?`begin;reset role;${data.guard}set constraints all immediate;`:''}${clone(n,Math.min(5,97-n),true)}`);
    // Separate SQL statements around each real reader compare the exact state
    // AFTER setup, not setup writes against a pre-setup baseline. Only these
    // six SELECT output lines are returned by the setup transaction. MATERIALIZED
    // volatile stages bracket exactly one actual RPC per read; timing excludes
    // fixture setup and fingerprint work, without adding a table or timeout.
    const readWithFingerprint=`reset role;select ${data.fp};set local role service_role;
      with started as materialized(select clock_timestamp() as started_at),
      measured as materialized(select started.started_at,${expression(query)} as result from started)
      select jsonb_build_object('result',result,'elapsedMs',round(extract(epoch from clock_timestamp()-started_at)*1000,3)) from measured;
      reset role;select ${data.fp};`;
    steps[steps.length-1]+=readWithFingerprint;
    steps.push(clone(97,1,false)+readWithFingerprint);
    steps.push('rollback;');assert.equal(steps.length,22);assert.equal(capSyntheticRows,195);
    const output=await native.querySteps(steps.map(step=>scope.sql(step))),lines=output.trim().split(/\r?\n/);
    assert.equal(lines.length,6,'rule_sources_cap_output_shape');assert(lines.filter((_,n)=>n!==1&&n!==4).every(line=>/^[a-f0-9]{32}$/.test(line)));
    const timed=lines.filter((_,n)=>n===1||n===4).map(line=>JSON.parse(line));
    for(const item of timed){assert.deepEqual(Object.keys(item).sort(),['elapsedMs','result']);assert(Number.isFinite(item.elapsedMs)&&item.elapsedMs>0);capReadElapsedMs.push(item.elapsedMs);}
    const full=data.checkedTransactionRead(timed[0].result,lines[0],lines[2]);
    assert.equal(full.personal.limited,false);assert.equal(full.personal.items.length,100);assert.equal(full.personal.revision,200);
    assert.deepEqual(full.personal.items.slice(0,3).map(pair=>pair.approval.revision),[1,3,4]);assert(full.personal.items.slice(3).every(pair=>pair.withdrawal!==null));
    const limited=data.checkedTransactionRead(timed[1].result,lines[3],lines[5]);
    assert.equal(limited.personal.revision,201);assert.equal(limited.personal.limited,true);assert.deepEqual(limited.personal.items,[]);
    assert.equal(limited.assignments.limited,false);assert.equal(limited.rules.limited,false);assert.equal(resolveCandidateThreeLayerRules(limited).segments[0].status,'blocked');
  }finally{assert.equal(data.fingerprint(),beforeCap,'rule_sources_cap_setup_not_rolled_back');}

  phase='actual-handler-service-and-private-ACL';
  const {executeRuleSources}=require('../src/lib/merchantAttendanceRuleSources.server.ts');
  const {handleRuleSources}=require('../src/app/api/merchant-enterprise/attendance/rule-sources/route-handler.ts');
  const {parseRuleSourcesQuery,parseRuleSourcesResponse,ruleSourcesQueryString,RULE_SOURCES_ERRORS}=require('../src/lib/merchantAttendanceRuleSources.ts');
  const {resolveCanonicalPortalOrigin}=require('../src/lib/canonicalPortalRequest.ts');let calls=0,actor=owner;
  const service={rpc:async(name,args)=>{assert.equal(name,rpc);assert.deepEqual(Object.keys(args).sort(),['p_auth_user_id','p_query']);calls++;
    try{return {data:data.readRaw(parseRuleSourcesQuery(args.p_query),args.p_auth_user_id),error:null};}
    catch(error){const code=String(error).match(/ERROR:\s+(?:[0-9A-Z]{5}:\s+)?([a-z_]+)(?=\r?\n|$)/)?.[1];if(!Object.hasOwn(RULE_SOURCES_ERRORS,code??''))throw error;return {data:null,error:{message:code}};}}};
  const dependencies={enabled:()=>true,authenticate:async()=>({user:{id:actor},authenticationMethods:['password']}),allow:()=>true,
    entitlement:async()=>({permissionConfig:{allowEnterpriseManagement:true,allowEmployeeAttendance:false}}),execute:input=>executeRuleSources(input,service)};
  const request=()=>new Request(resolveCanonicalPortalOrigin()+'/api/merchant-enterprise/attendance/rule-sources?'+ruleSourcesQueryString(query));
  const routeBaseline=data.fingerprint(),response=await handleRuleSources(request(),dependencies);assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'private, no-store');
  const projected=parseRuleSourcesResponse(await response.json(),query,owner);assert.equal(projected.moduleEnabled,false);assert.equal(projected.personal.revision,6);
  actor=id(98);const rejected=await handleRuleSources(request(),dependencies);assert.equal(rejected.status,403);assert.deepEqual(await rejected.json(),{ok:false,error:'attendance_access_denied'});assert.equal(calls,2);
  for(const role of ['anon','authenticated'])exec(`set local role ${role};do $acl$ begin begin perform ${expression(query)};raise exception 'rule_sources_browser_execute_allowed';exception when insufficient_privilege then null;end;end;$acl$;`);
  for(const role of ['anon','authenticated','service_role'])exec(`set local role ${role};do $acl$ begin begin
    perform public.${checker}(null::public.merchant_attendance_personal_rule_operations,'{}'::jsonb);
    raise exception 'rule_sources_private_checker_execute_allowed';exception when insufficient_privilege then null;end;end;$acl$;`);
  assert.equal(data.fingerprint(),routeBaseline);assert.equal(data.oldDefinition(),data.oldDefinitionBaseline);
  assert.equal(exec(`select count(*) from public.merchant_attendance_personal_rule_operations;`),'6');
  for(const label of labels)native.pass(label);
  return {checks:labels.length,sourceReads:data.readCount(),handlerSqlCalls:calls,exactLockWitnesses:1,normalPersonalOperations:6,capSyntheticRows,
    cacheSyntheticRejections:cacheMutations.length,capReadElapsedMs:{complete100:capReadElapsedMs[0],limited101:capReadElapsedMs[1]},
    syntheticOnly:true,noBrowser:true,actualThreeLayerResolution:true,formalReady:false,allReadFingerprintsUnchanged:true,capRollbackRestored:true,callerOwnedNamespaceCleanup:true};
}

export async function runAttendanceRuleSourcesNative(args){return runAttendanceLabelsReuse(args,native=>withAttendanceConcurrencySandbox(native,async scope=>{
  const result=await checkAttendanceRuleSourcesNative(native,scope);console.log(JSON.stringify({ruleSourcesNative:result}));
}));}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  runAttendanceRuleSourcesNative(process.argv.slice(2)).catch(error=>{console.error(JSON.stringify(ruleSourcesNativeFailure(error)));process.exitCode=1;});
}
