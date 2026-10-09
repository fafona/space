//Pure/SOURCE-only tests. No PostgreSQL, fake SQL evaluator or runtime PASS claim.
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {delegatedRulesNativeSite,delegatedRulesNativeIds,delegatedRulesNativeGroupBudgets,delegatedRulesNativeRevokeCommand,delegatedRulesNativeChoiceDefaults,delegatedRulesNativeRpcExpression,delegatedRulesNativeFaultSql,delegatedRulesNativeGuardSql,delegatedRulesNativeCleanup,delegatedRulesNativeCallSql,delegatedRulesNativeTiming,verifyDelegatedRulesNative} from './attendance-delegated-rules-native.mjs';
const require=createRequire(import.meta.url),source=readFileSync(new URL('./attendance-delegated-rules-native.mjs',import.meta.url),'utf8'),p=delegatedRulesNativeIds;

test('206 finite eight groups sum90 actualRPCs including Node prereads, one90s rollback connection and bounded SQL',()=>{
 assert.equal(delegatedRulesNativeSite,'99990206');assert.equal(delegatedRulesNativeGroupBudgets.length,8);
 assert.equal(delegatedRulesNativeGroupBudgets.reduce((n,g)=>n+g.rpcs,0),90);assert(delegatedRulesNativeGroupBudgets.reduce((n,g)=>n+g.steps,0)+2<140);
 assert.equal(new Set(delegatedRulesNativeGroupBudgets.map(g=>g.name)).size,8);assert(Object.values(p).every(v=>/^[a-f0-9-]{36}$/.test(v)));
 for(const token of["native.connect({lifetimeMs:90000})",'++rpcs<=90','++steps<=140','pendingStep=dispatched','await connection.close()','rollbackRestored:true'])assert(source.includes(token),token);
 assert.doesNotMatch(source,/initdb|createdb|pg_ctl|browser\.launch|session_replication_role|disable trigger|setSystemTime|fakeTimers|process\.argv/);
});
test('206 invalid context refuses before any process/source/network access',async()=>{
 for(const value of[undefined,{}, {d:{syntheticOnly:false},h:{syntheticOnly:true}}])await assert.rejects(verifyDelegatedRulesNative(value));
});
test('206 actual RPC argument names are exact; no private authorization context or owner substitution',()=>{
 const q={siteId:delegatedRulesNativeSite,grantId:p.role,mode:'context',operationId:null},args={p_query:q,p_auth_user_id:p.delegateAuth,p_command:null,p_allow_write:false};
 assert.match(delegatedRulesNativeRpcExpression('faolla_attendance_delegated_rules_v1',args),/^public\.faolla_attendance_delegated_rules_v1\(/);
 for(const changed of[{...args,p_owner:p.employeeAuth},{...args,p_grant_id:p.role},{...args,p_allow_write:'true'},{...args,p_auth_user_id:'system'}])assert.throws(()=>delegatedRulesNativeRpcExpression('faolla_attendance_delegated_rules_v1',changed));
 assert.throws(()=>delegatedRulesNativeRpcExpression('faolla_attendance_delegated_rules_base_core_v1',args));
 assert.throws(()=>delegatedRulesNativeRpcExpression('faolla_attendance_management_delegations_v1',args));
 assert.match(delegatedRulesNativeRpcExpression('faolla_attendance_management_delegations_v1',{p_query:{siteId:delegatedRulesNativeSite,mode:'write'},p_auth_user_id:p.employeeAuth,p_command:null,p_allow_grant:true}),/management_delegations_v1/);
});
test('206 group6 actual revoke constructor includes the immutable grant revision required by the production body parser',()=>{
 const {parseManagementDelegationBody,parseManagementDelegationQuery}=require('../../src/lib/merchantAttendanceManagementDelegation.ts');
 const query={siteId:delegatedRulesNativeSite,mode:'write'},command=delegatedRulesNativeRevokeCommand(p.role,p.plainRole),body={query,command};
 assert.deepEqual(parseManagementDelegationQuery(query),query);assert.deepEqual(parseManagementDelegationBody(body),body);
 assert.equal(command.expectedRevision,1);assert.deepEqual(Object.keys(command).sort(),['action','operationId','grantId','expectedRevision','reason'].sort());
 const legacy={...command};delete legacy.expectedRevision;
 assert.throws(()=>parseManagementDelegationBody({query,command:legacy}),e=>e?.code==='attendance_invalid_request');
 assert.throws(()=>parseManagementDelegationBody({query,command:{...command,expectedRevision:2}}),e=>e?.code==='attendance_invalid_request');
 assert(source.includes("await foundation({siteId,mode:'write'},delegatedRulesNativeRevokeCommand(next(),grants.rule_publish))"));
});
test('206 fixture choice values and all8 command scalar shapes pass actual frozen production parsers',()=>{
 const {parseDelegatedRulesCommand,delegatedRulesAction}=require('../../src/lib/merchantAttendanceDelegatedRules.ts');
 const four=delegatedRulesNativeChoiceDefaults('base'),eight=delegatedRulesNativeChoiceDefaults('operational'),siteId=delegatedRulesNativeSite,scope={kind:'enterprise'},op=p.role;
 const common={operationId:op,expectedRevision:5,reason:'Synthetic206 actual scoped rule decision'},base={...four,lateGraceMinutes:{mode:'value',minutes:5}},operational={...eight,allowedChannels:{mode:'value',value:['self']}};
 const commands=[{family:'base',decision:{...common,action:'save_draft',expectedSettingsVersion:4,expectedGroupRevision:null,timeZone:'UTC',rules:base}},
  {family:'base',decision:{...common,action:'publish',expectedSettingsVersion:4,expectedGroupRevision:null,timeZone:'UTC',effectiveOn:'2090-01-02'}},
  {family:'base',decision:{...common,action:'withdraw',publishedRevision:4}},
  {family:'personal',decision:{...common,action:'approve',expectedWorkerVersion:1,expectedSettingsVersion:4,employeeId:p.employee,employeeAuthUserId:p.employeeAuth,timeZone:'UTC',startsOn:'2090-01-02',endsOn:'2090-01-02',rules:base}},
  {family:'personal',decision:{...common,action:'withdraw',approvedRevision:4}},
  {family:'operational',decision:{...common,siteId,scope,action:'save_draft',expectedContext:{settingsVersion:4,timeZone:'UTC',subject:null},rules:operational}},
  {family:'operational',decision:{...common,siteId,scope,action:'publish',sourceDraftRevision:4,effectiveOn:'2090-01-02',endsOn:null,previewFingerprint:'a'.repeat(64)}},
  {family:'operational',decision:{...common,siteId,scope,action:'withdraw',publishedRevision:4}}];
 assert.deepEqual(commands.map(c=>delegatedRulesAction(parseDelegatedRulesCommand(c))),['rule_draft','rule_publish','rule_withdraw','personal_rule_approve','personal_rule_withdraw','operational_rule_draft','operational_rule_publish','operational_rule_withdraw']);
 assert.deepEqual(delegatedRulesNativeChoiceDefaults('personal'),four);assert.throws(()=>delegatedRulesNativeChoiceDefaults('terminal'));
 assert(source.includes('personalContext.worker.version'));assert(!source.includes('personalContext.worker.workerVersion'));assert(!source.includes("value:['web']"));
 assert(!/actor_auth_user_id=\$\{quote\(p\.delegateAuth\)\}\)\)=/.test(source));assert(source.includes('g.employee_generation=0'));assert(!source.includes('g.target_generation'));
});
test('206 real Node services, explicit owner202 grants and8 actual actor business-sidecars, not synthetic histories',()=>{
 for(const token of['createDelegatedRulesService','executeManagementDelegation','executeAttendanceAdmin','executeRules','delegatedRulesCommandFingerprint','await send(\'rule_draft\'',
  "await send('rule_publish'","await send('rule_withdraw'","await send('personal_rule_approve'","await send('personal_rule_withdraw'","await send('operational_rule_draft'","await send('operational_rule_publish'","await send('operational_rule_withdraw'",
  'actual_eight_business_rows_same_actor_authority','faolla_attendance_delegated_rules_operation_v1(authority,false)','preview.preview.applied,false','authUserId:p.delegateAuth'])assert(source.includes(token),token);
 assert.doesNotMatch(source,/insert into public\.merchant_attendance_(?:rule_|personal_rule_|operational_rule_|workers|locations|employment_periods|management_delegations|events)/);
 assert(source.includes('seedRows:7'));assert(source.includes('realAuth:false'));assert(source.includes('production:false'));
});
test('206 new routing known-pair rejection is actual same-tenant active pair; partialkey/UUID/CAS/actor/defaultoff/validity all finite',()=>{
 for(const token of['delegateEmployeeId:p.other,delegateAuthUserId:p.otherAuth',"reviewRouting:{mode:'value',value:routing}",'attendance_delegated_rules_reference_denied','attendance_delegated_rules_key_denied',
  'locationScope:{mode:\'value\',value:[p.otherLocation]}','attendance_version_conflict','offNode.execute','validFrom:profile.until','saved.rule_publish.command,p.plainAuth',"family:'terminal'"])assert(source.includes(token),token);
 assert(source.includes("allowedRuleKeys:family==='operational'?['allowedChannels','locationScope','reviewRouting']"));
});
test('206 onlybase26 history, next page after actualrev27 retains originalanchor; originalGET receipts have no re-export',()=>{
 for(const token of['revision=4;revision<26','first.atRevision,26','first.items.length,25','first.nextCursor.beforeRevision,2','historyAnchor=first.nextCursor','retried.receipt.revision,27',
  'history(grants.rule_draft,historyAnchor)','last.atRevision,26','last.items[0].item.revision,1','last.nextCursor,null'])assert(source.includes(token),token);
 assert.equal((source.match(/mode:'history'/g)||[]).length,1);assert(source.includes('receiptOnlyRecovery:true'));
});
test('206 both employee epochs are actual lifecycle RPCs and restore does not revive originalgeneration0 grants',()=>{
 for(const token of["status(p.delegate,'disabled')","status(p.employee,'disabled')","status(p.delegate,'active')","status(p.employee,'active')",'faolla_update_merchant_enterprise_employee_v1(prepared_command)',
  'faolla_attendance_account_suspensions_v1','expectedGeneration:1','e.generation===1&&e.paused','g.delegate_generation=0 and g.employee_generation=0','faolla_attendance_management_current_v1(g,clock_timestamp()) is distinct from true',
  "restore('dr206_epochs',branch)"])assert(source.includes(token),token);
 assert.doesNotMatch(source,/update public\.merchant_attendance_account_epochs|insert into public\.merchant_attendance_account_epochs|update public\.merchant_enterprise_employees/);
});
test('206 late fault is unique owned AFTER23514, full rollback preserves all pre-existing rows/catalog/archives and permits original retry',()=>{
 const fault=delegatedRulesNativeFaultSql(p.role);for(const token of['synthetic206_owned_late_rules_fault_v1','after insert on public.merchant_attendance_management_delegation_operations',"errcode='23514'","constraint='synthetic206_owned_late_rules_fault'"])assert(fault.includes(token),token);
 assert.doesNotMatch(fault,/create or replace|alter table|disable trigger|delete from|truncate|update public\./);assert.throws(()=>delegatedRulesNativeFaultSql(p.role,'99990205'));
 for(const token of['dr206_old_row_changed:','dr206_external_scope_added:','dr206_unrelated_table_changed','dr206_read_reject_replay_wrote',"lastRpc.sqlstate,'23514'",'fault_catalog_exact_restored',
  "restore('dr206_fault',branch)",'dr206_full_rollback_facts','d.definitions(),definitions','d.tableCatalog(),catalog','periodContinuationArchiveBytes(await archive())','periodContinuationArchiveBytes(await periodArchive())','dr206_clock_source_side_effect',
  'future segment whose before state is inherit/default','Preview remains candidate-only'])assert(source.includes(token),token);
});
test('206 pending lifetime failure closes before all five protections and preserves primary stage/counts despite secondary errors',async()=>{
 const events=[],primary=new Error('delegated_rules_native_stage:actual_rule_history:steps=120:rpcs=88:original_business_error');let rejectPending;
 const pending=new Promise((_,reject)=>{rejectPending=reject;}),connection={close:async()=>{events.push('close');rejectPending(new Error('attendance_concurrency_lifetime'));},step:()=>assert.fail('cleanup must not dispatch rollback SQL')};
 const protections=['facts','definitions','catalog','archive155','archive207'].map(label=>[label,async()=>{events.push(label);if(label==='facts')throw new Error('secondary_facts_mismatch');}]);
 await delegatedRulesNativeCleanup(connection,pending,protections,primary);
 assert.deepEqual(events,['close','facts','definitions','catalog','archive155','archive207']);
 assert(primary.message.startsWith('delegated_rules_native_stage:actual_rule_history:steps=120:rpcs=88:original_business_error'));
 assert.match(primary.message,/cleanup_secondary:pending:attendance_concurrency_lifetime\|facts:secondary_facts_mismatch/);
 assert.match(primary.stack,/original_business_error/);assert.match(primary.stack,/secondary_facts_mismatch/);
 assert(source.includes('primaryError=failure(error);throw primaryError;'));assert(source.includes('],primaryError);'));
 assert(!source.includes("connection.step(scope.sql('rollback;'))"));
});
test('206 cleanup without primary refuses late transport/protection failure, while still attempting the complete protection set',async()=>{
 const events=[],pending=Promise.reject(new Error('late_SQL_failure'));
 const protections=['facts','definitions','catalog','archive155','archive207'].map(label=>[label,()=>{events.push(label);if(label==='catalog')throw new Error('catalog_mismatch');}]);
 await assert.rejects(delegatedRulesNativeCleanup({close:async()=>{events.push('close');}},pending,protections),error=>error instanceof AggregateError
  &&error.errors.length===2&&error.message.includes('pending:late_SQL_failure')&&error.message.includes('catalog:catalog_mismatch'));
 assert.deepEqual(events,['close','facts','definitions','catalog','archive155','archive207']);
});
test('206 settled normal cleanup closes once, executes no SQL and retains the explicit budgeted normal rollback',async()=>{
 const events=[],protections=['facts','definitions','catalog','archive155','archive207'].map(label=>[label,()=>{events.push(label);}]);
 await delegatedRulesNativeCleanup({close:async()=>{events.push('close');},step:()=>assert.fail('cleanup SQL forbidden')},null,protections);
 assert.deepEqual(events,['close','facts','definitions','catalog','archive155','archive207']);
 assert(source.includes("await step('rollback','rollback;')"));assert(source.includes('catch(error){throw failure(error);}'));
});
test('206 timing SQL retains every full hash/protection verbatim, original role and constraints, and the same one result SELECT',()=>{
 const all='(select full206_hash())',outside='(select outside206_hash())',prepare="prepared_command:='{}'::jsonb;",expression='public.actual206_rpc(prepared_command)',
  preserve="assert not exists(select original206_rows() except select current206_rows()),'dr206_old_row_changed:all';\n",
  external="assert not exists(select outside206_rows() except select original206_rows()),'dr206_external_scope_added:all';\n";
 for(const [write,replay]of[[true,false],[false,false],[true,true]]){
  const sql=delegatedRulesNativeCallSql({all,outside,prepare,role:'service_role',expression,preserve,external,write,replay});
  const ordered=[`old_hash:=${all};`,`outside_hash:=${outside};`,prepare,'set local role service_role;',"assert current_user='service_role';",`value:=${expression};`,
   'set constraints all immediate;set constraints all deferred;','exception when others then get stacked diagnostics failure=message_text,state_code=returned_sqlstate,context_text=pg_exception_context,constraint_text=constraint_name;',
   'end;reset role;',`if failure is not null or value ? 'error' or ${!write||replay} then assert ${all}=old_hash,'dr206_read_reject_replay_wrote';end if;`,
   `assert ${outside}=outside_hash,'dr206_unrelated_table_changed';`,preserve,external,"perform set_config('faolla.dr206_result',",'end;$dr206_call$;select current_setting(\'faolla.dr206_result\')::jsonb;'];
  let offset=0;for(const fragment of ordered){const found=sql.indexOf(fragment,offset);assert(found>=offset,fragment);offset=found+fragment.length;}
  assert.equal(sql.split(all).length-1,2);assert.equal(sql.split(outside).length-1,2);
  assert.equal(sql.split(preserve).length-1,1);assert.equal(sql.split(external).length-1,1);
  assert.equal((sql.match(/select current_setting\(/g)||[]).length,1);
  for(const field of['beforeHashMs','prepareMs','rpcMs','constraintsMs','postHashMs','preserveMs','externalMs','doBodyMs','failedPhase'])assert(sql.includes("'"+field+"'"),field);
  assert(sql.includes("when timing_phase='rpc' then timing_failed_at else null end"));
  assert(sql.includes("when timing_phase='constraints' then timing_failed_at else null end"));
  assert.doesNotMatch(sql,/pg_temp\.|create (?:function|table)|track_functions|compileMs/);
 }
 const noOutside=delegatedRulesNativeCallSql({all,outside:null,prepare:'',role:'service_role',expression,preserve,external,write:true,replay:false});
 assert(!noOutside.includes('outside_hash:='));assert(!noOutside.includes('dr206_unrelated_table_changed'));
 for(const token of['sqlBytes=Buffer.byteLength(scope.sql(prefix+sql),\'utf8\')','try{r=JSON.parse(await step(label,sql));}finally{timing.record(',"':timing='+JSON.stringify(timing.summary())",'timing:timing.snapshot()'])assert(source.includes(token),token);
});
test('206 compact timing data is bounded to90, excludes arguments/secrets, and summarizes completed calls without claiming compile time',()=>{
 const timing=delegatedRulesNativeTiming(137),components={beforeHashMs:1,prepareMs:2,rpcMs:3,constraintsMs:4,postHashMs:5,preserveMs:6,externalMs:7,doBodyMs:30,failedPhase:null,
  command:'DO_NOT_OUTPUT_COMMAND',pin:'DO_NOT_OUTPUT_PIN',sql:'DO_NOT_OUTPUT_SQL',pairSecret:'DO_NOT_OUTPUT_SECRET'};
 for(let n=0;n<90;n++)timing.record('actual_rule_context',12345,components,40+n);
 const snapshot=timing.snapshot();assert.equal(snapshot.records.length,90);assert.equal(snapshot.summary.recordCount,90);
 assert.equal(snapshot.summary.tableCount,137);assert.equal(snapshot.summary.assertionsPerRpc,274);assert.equal(snapshot.summary.sqlTimingsReturned,90);
 assert.equal(snapshot.summary.maxSqlBytes,12345);assert.equal(snapshot.summary.slowest.length,8);assert.equal(snapshot.summary.slowest[0].call,90);
 assert.equal(snapshot.records[0].outsideBodyMs,10);assert.equal(snapshot.summary.totalsMs.rpcMs,270);assert.equal(snapshot.summary.missingCounts.constraintsMs,0);
 const output=JSON.stringify(snapshot);assert.doesNotMatch(output,/DO_NOT_OUTPUT|pairSecret|compileMs|command|\"sql\"/);
 assert.throws(()=>timing.record('actual_rule_context',12345,components,40),/dr206_timing_max90/);
 snapshot.records[0].rpcMs=999;assert.equal(timing.snapshot().records[0].rpcMs,3);
});
test('206 failed/unfinished SQL has honest null clock fields, bounded summary and the completed timing available before stage failure decoration',()=>{
 const timing=delegatedRulesNativeTiming(2);timing.record('actual_rule_context',100,null,12);
 const incomplete={beforeHashMs:1,prepareMs:0,rpcMs:2,constraintsMs:null,postHashMs:1,preserveMs:1,externalMs:1,doBodyMs:8,failedPhase:'rpc'};
 timing.record('actual_rule_write',200,incomplete,10);
 let getterReads=0;const malformed={doBodyMs:20,beforeHashMs:-1,prepareMs:Infinity,rpcMs:NaN,constraintsMs:90001};
 Object.defineProperty(malformed,'externalMs',{get(){getterReads++;return 2;}});
 timing.record('invalid label with possible args',300,malformed,5);
 const {records,summary}=timing.snapshot();assert.equal(getterReads,0);
 for(const key of['beforeHashMs','prepareMs','rpcMs','constraintsMs','postHashMs','preserveMs','externalMs','doBodyMs','outsideBodyMs'])assert.equal(records[0][key],null,key);
 assert.equal(records[0].roundTripMs,12);assert.equal(records[1].constraintsMs,null);assert.equal(records[1].rpcMs,2);assert.equal(records[1].failedPhase,'rpc');
 assert.equal(records[2].label,'invalid_label');assert.equal(records[2].outsideBodyMs,null);assert.equal(records[2].externalMs,null);
 assert.equal(summary.recordCount,3);assert.equal(summary.slowest.length,3);assert.equal(summary.missingCounts.constraintsMs,3);
 assert.equal(summary.last.call,3);assert.equal(summary.totalsMs.roundTripMs,27);assert(JSON.stringify(summary).length<8000);
 assert(source.includes('primaryError=failure(error);throw primaryError;'));assert(source.includes('],primaryError);'));
 assert(source.indexOf('finally{timing.record(')<source.indexOf('lastRpc={error:r.error'));
});

test('206 reusable guards keep each original table ASSERT and GUC expression byte-for-byte without caching any rows or result',()=>{
 const names=['merchants','faolla_schema_migrations','merchant_attendance_rule_operations'],site="'99990206'";
 const preserve=names.map(n=>`assert not exists(select previous.value from jsonb_array_elements(current_setting('faolla.dr206_originals')::jsonb->'${n}') previous(value) except select to_jsonb(x) from public.${n} x),'dr206_old_row_changed:${n}';`).join('\n');
 const external=names.map(n=>`assert not exists(select to_jsonb(x) from public.${n} x where coalesce(to_jsonb(x)->>'merchant_id',case when '${n}'='merchants' then to_jsonb(x)->>'id' end,'')<>${site}
 except select previous.value from jsonb_array_elements(current_setting('faolla.dr206_originals')::jsonb->'${n}') previous(value)),'dr206_external_scope_added:${n}';`).join('\n');
 const sql=delegatedRulesNativeGuardSql(preserve,external);
 assert.equal(sql.match(/\$owned206_preserve\$begin\n([\s\S]*?)\nend;\$owned206_preserve\$/)?.[1],preserve);
 assert.equal(sql.match(/\$owned206_external\$begin\n([\s\S]*?)\nend;\$owned206_external\$/)?.[1],external);
 assert.equal((sql.match(/assert not exists\(/g)||[]).length,2*names.length);
 assert.equal(sql.split("current_setting('faolla.dr206_originals')").length-1,2*names.length);
 assert.doesNotMatch(sql,/security definer|\bstable\b|\bimmutable\b|\bdeclare\b|set_config|\bexecute\b|create (?:table|view)|insert|update|delete|truncate/i);
 const span=(a,b)=>source.slice(source.indexOf(a),source.indexOf(b,source.indexOf(a))).replaceAll('\r\n','\n');
 const sha=text=>createHash('sha256').update(text).digest('hex');
 assert.equal(sha(span(' const originals=',' const ruleTables=')),'8f9a8645b7ad1bc4d040876a471a4abe1f3f9275890c273ac51d52853e464f62');
 assert.equal(sha(span('export function delegatedRulesNativeCallSql(','//Closing this owned session')),'2b82924afeef097b59193e71275c56b66517c64e6fb9a3dae69571bf345afb76');
 assert.equal(sha(span('export async function delegatedRulesNativeCleanup(','export async function verifyDelegatedRulesNative(')),'41d555db256c50644613e9df044da75cb0080670e3243ed7088ac80ddd2009ec');
 for(const values of[['',external],[preserve,''],[null,external],[preserve+'$owned206_preserve$',external],[preserve,external+'$owned206_external$']])assert.throws(()=>delegatedRulesNativeGuardSql(...values));
});

test('206 guard code is only two private temp invoker volatile functions created in the original begin before all savepoints',()=>{
 const sql=delegatedRulesNativeGuardSql("assert true,'old';","assert true,'external';");
 for(const name of['synthetic206_owned_preserve_rows_v1','synthetic206_owned_external_rows_v1']){
  assert(sql.includes(`create function pg_temp.${name}() returns void language plpgsql volatile security invoker set search_path=pg_catalog`));
  assert(sql.includes(`revoke all on function pg_temp.${name}() from public,anon,authenticated,service_role;`));
  assert(source.includes(`assert to_regprocedure('pg_temp.${name}()') is null;`));
 }
 assert.equal((sql.match(/create function pg_temp\./g)||[]).length,2);assert.equal((sql.match(/revoke all on function pg_temp\./g)||[]).length,2);
 assert.doesNotMatch(sql,/create or replace|create function public\.|\bgrant\b|\bcommit\b|\brollback\b/);
 const begin=source.indexOf("await step('begin'"),create=source.indexOf('${delegatedRulesNativeGuardSql(preserve,external)}'),group0=source.indexOf('await group(0,async()=>{');
 assert(begin>=0&&create>begin&&group0>create);assert(source.slice(begin,create).includes("set_config('faolla.dr206_originals',${originals}::text,true)"));
 assert(source.slice(begin,create).includes("assert current_user='postgres'"));
 assert(source.indexOf("save('dr206_epochs')")>group0);assert(source.indexOf("save('dr206_fault')")>group0);
 const tail=source.slice(source.indexOf("await step('appendonly_originals_no_clock_source_effects'"));
 assert(tail.includes('${preserve}${external}'));assert(tail.includes("await step('rollback','rollback;')"));
 for(const token of['native.connect({lifetimeMs:90000})','++rpcs<=90','++steps<=140','pendingStep=dispatched',
  "['facts'","['definitions'","['catalog'","['archive155'","['archive207'"])assert(source.includes(token),token);
});

test('206 each actual RPC invokes both fresh full guards once after role reset with original hash and constraint ordering',()=>{
 const preserve='perform pg_temp.synthetic206_owned_preserve_rows_v1();',external='perform pg_temp.synthetic206_owned_external_rows_v1();';
 const sql=delegatedRulesNativeCallSql({all:'(select all_hash())',outside:'(select outside_hash())',prepare:'',role:'service_role',
  expression:'public.actual_rpc()',preserve,external,write:true,replay:false});
 assert.equal(sql.split(preserve).length-1,1);assert.equal(sql.split(external).length-1,1);
 const ordered=["set local role service_role;assert current_user='service_role';",'value:=public.actual_rpc();',
  'set constraints all immediate;set constraints all deferred;','end;reset role;',"'dr206_unrelated_table_changed';",preserve,'timing_preserve1:=clock_timestamp();',external,'timing_external1:=clock_timestamp();'];
 let offset=0;for(const text of ordered){const found=sql.indexOf(text,offset);assert(found>=offset,text);offset=found+text.length;}
 const caller=source.slice(source.indexOf(' const call=async('),source.indexOf(' const service='));
 assert(caller.includes("preserve:'"+preserve+"'"));assert(caller.includes("external:'"+external+"'"));
 assert.equal(caller.split('await step(label,sql)').length-1,1);assert(caller.includes('allowed===null?null:outageNativeFingerprintSql(names.filter(n=>!allowed.includes(n)))'));
 assert.doesNotMatch(caller,/delegatedRulesNativeGuardSql|set_config|create function|cache|skip|sample/);
});
