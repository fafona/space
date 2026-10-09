// Inert import. Native execution needs the explicit existing owned local-PG
// wrapper; no production credentials, browser, duplicate cluster or old suite.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {runAttendanceLabelsReuse} from './merchant-attendance-choice-labels-reuse-native.mjs';
import {withAttendanceConcurrencySandbox} from './merchant-attendance-concurrency-sandbox.mjs';
import {prepareGroupsNativeFixture} from './merchant-attendance-groups-native.mjs';
import {rulesMigrationPlan,rulesNativeFailure} from './merchant-attendance-rules-native.mjs';
import {personalRulesMigrationPlan} from './merchant-attendance-personal-rules-native.mjs';
import {ruleSourcesMigrationPlan} from './merchant-attendance-rule-sources-native.mjs';
import {ruleCapturesMigrationPlan,ruleCapturesNativeTables,ruleCapturesQueryInput,ruleCapturesNativeCommand} from './merchant-attendance-rule-captures-native.mjs';
import {lifecycleId as id,lifecycleJson as json} from './merchant-attendance-lifecycle-native-support.mjs';

const require=createRequire(import.meta.url),siteId='99990001',ownerId=id(99),workerId=id(201);
const rpc='faolla_attendance_rule_capture_history_v1',signature=`public.${rpc}(jsonb,uuid)`;
const migrationName='202610040132_merchant_attendance_rule_capture_history.sql';
const quote=value=>"'"+String(value).replaceAll("'","''")+"'";
const expression=(query,actor=ownerId)=>`public.${rpc}(${json(query)},'${actor}')`;
const archiveExpression=(query,actor=ownerId)=>`public.faolla_attendance_rule_captures_v1(${json(query)},'${actor}',null,false)`;
const denied=(code,expr)=>`begin perform ${expr};raise exception 'capture_history_unexpected_acceptance';exception when sqlstate 'P0001' then if sqlerrm<>${quote(code)} then raise;end if;end;`;
const labels=Object.freeze([
  'history132 installs/reapplies exactly one service-only reader without new tables indexes or changed old definitions/facts',
  'history actual SQL and parser return25plus2 currentidentity metadata with exact same-microsecond UUID ties and no source bodies',
  'history metadata selected operation opens original131 bytes only by explicit operation GET; immutable bytes are untouched',
  'history currentowner worker and dualidentity filters prevent formerowner or reboundidentity discovery and reject stalecursor',
  'history timestamp cutoff excludes later metadata while forged anchors futurecutoffs and partialcursors are rejected',
  'history inactive matchingidentity still reads current display metadata without applying currenttimezone to saved observations',
  'history private service ACL and all read/rollback fingerprints preserve old and archive facts',
]);
let phase='entry';
export const ruleCaptureHistoryQueryInput=(patch={})=>({siteId,workerId,asOf:null,beforeAt:null,beforeId:null,expectedEmployeeId:null,expectedEmployeeAuthUserId:null,...patch});
export function ruleCaptureHistoryMigrationPlan(root,scope){
  assert(typeof root==='string'&&path.isAbsolute(root));assert(scope&&/^attendance_race_[a-f0-9]{32}$/.test(scope.schema)&&typeof scope.sql==='function');
  const source=readFileSync(path.join(root,'scripts/supabase-migrations',migrationName),'utf8');
  const body=source.replace(/^begin;\s*$/m,'').replace(/^commit;\s*$/m,''),statement=scope.sql(body);
  assert(!/\bpublic\./.test(statement));assert(!/search_path\s*(?:=|to)\s*(?:pg_catalog,\s*)?public\b/.test(statement));return {name:migrationName,source,body,statement};
}
export function ruleCaptureHistoryNativeFailure(error){
  const safe=rulesNativeFailure(error),text=error instanceof Error?error.message:'',code=text.match(/ERROR:\s+(?:[0-9A-Z]{5}:\s+)?([a-z_]+)(?=\r?\n|$)/)?.[1];
  const known=new Set(['attendance_rule_capture_history_invalid','attendance_rule_capture_history_too_large','attendance_rule_capture_identity_changed',
    'merchant_attendance_rule_capture_history_prerequisite_required','merchant_attendance_rule_capture_history_installation_conflict']);
  return {...safe,error:'rule_capture_history_native_failed',phase,...(known.has(code)?{code,sqlMessage:code}:{})};
}

export async function prepareRuleCaptureHistoryNativeFixture(native,scope){
  phase='minimal-owned-foundation';const {exec,owned}=await prepareGroupsNativeFixture(native,scope);
  for(const plan of [rulesMigrationPlan,personalRulesMigrationPlan,ruleSourcesMigrationPlan,ruleCapturesMigrationPlan])exec(plan(native.root,scope).body);
  const inventory=()=>JSON.parse(exec(`select jsonb_agg(relname order by relname) from pg_class where relnamespace=${owned.oid} and relkind in('r','p');`));
  const tables=inventory(),hash=selected=>`(select md5(jsonb_build_object(${selected.map(table=>`${quote(table)},(select coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text),'[]'::jsonb) from public.${table} r)`).join(',')})::text))`;
  const factsWithoutRegistry=hash(tables.filter(table=>table!=='faolla_schema_migrations')),all=hash(tables);
  const protectedHash=hash(tables.filter(table=>!ruleCapturesNativeTables.includes(table)));
  const fingerprint=()=>exec(`select ${all};`),protectedFingerprint=()=>exec(`select ${protectedHash};`);
  const oldDefinitions=()=>exec(`select md5(coalesce(jsonb_agg(jsonb_build_array(p.proname,pg_get_functiondef(p.oid),p.proowner,p.proacl,p.proconfig) order by p.proname,p.oid),'[]'::jsonb)::text)
    from pg_proc p where p.pronamespace=${owned.oid} and p.prokind='f' and p.oid is distinct from to_regprocedure(${quote(signature)});`);
  const definitions=()=>exec(`select jsonb_build_object('functions',(select jsonb_agg(jsonb_build_array(p.proname,pg_get_functiondef(p.oid),p.proowner,p.proacl,p.proconfig) order by p.proname,p.oid)
      from pg_proc p where p.pronamespace=${owned.oid} and p.prokind='f'),
    'tables',(select jsonb_agg(jsonb_build_array(c.relname,c.relowner,c.relacl,c.relrowsecurity) order by c.relname) from pg_class c where c.relnamespace=${owned.oid} and c.relkind in('r','p')),
    'indexes',(select jsonb_agg(indexdef order by indexname) from pg_indexes where schemaname=${quote(scope.schema)}),
    'triggers',(select jsonb_agg(pg_get_triggerdef(t.oid) order by t.tgrelid,t.tgname) from pg_trigger t join pg_class c on c.oid=t.tgrelid where c.relnamespace=${owned.oid} and not t.tgisinternal));`);
  const oldDefinitionBefore=oldDefinitions(),beforeInstall=exec(`select ${factsWithoutRegistry};`);
  const migration=ruleCaptureHistoryMigrationPlan(native.root,scope);exec(migration.body);
  assert.deepEqual(inventory(),tables);assert.equal(oldDefinitions(),oldDefinitionBefore);assert.equal(exec(`select ${factsWithoutRegistry};`),beforeInstall);
  const definitionBefore=definitions(),empty=fingerprint();exec(migration.body);assert.equal(definitions(),definitionBefore);assert.equal(fingerprint(),empty);
  for(const table of ruleCapturesNativeTables)assert.equal(exec(`select count(*) from public.${table};`),'0');
  const protectedBefore=protectedFingerprint();
  const {parseRuleCaptureHistoryResult}=require('../src/lib/merchantAttendanceRuleCaptureHistory.ts');
  const {parseRuleCapturesResult}=require('../src/lib/merchantAttendanceRuleCaptures.ts');
  const today=exec("select (clock_timestamp() at time zone 'UTC')::date::text;"),day=n=>new Date(Date.parse(today+'T00:00:00.000Z')+n*86400000).toISOString().slice(0,10);
  const firstQuery=ruleCapturesQueryInput(9001),firstCommand=ruleCapturesNativeCommand(9001,day(0),day(1),{reason:'One real source observation 中文🙂 <script>not executed</script>'});
  phase='one-actual-source-capture';
  const first=JSON.parse(exec(`set local role service_role;select public.faolla_attendance_rule_captures_v1(${json(firstQuery)},'${ownerId}',${json(firstCommand)},true);`));
  const firstReceipt=parseRuleCapturesResult(first,firstQuery,firstCommand,ownerId).receipt;assert(firstReceipt);assert.equal(firstReceipt.sourceId,id(9001));
  phase='small-explicit-synthetic-metadata';
  // These26 rows are deliberately synthetic metadata, NOT26 new observations.
  // One genuine artifact is shared; CHECK/FK/immutable triggers stay enabled.
  exec(`insert into public.merchant_attendance_rule_capture_operations(merchant_id,operation_id,worker_id,actor_auth_user_id,employee_id,employee_auth_user_id,source_id,command,observed_at,recorded_at)
    select o.merchant_id,('00000000-0000-4000-8000-'||lpad((9100+n)::text,12,'0'))::uuid,o.worker_id,o.actor_auth_user_id,o.employee_id,o.employee_auth_user_id,o.source_id,
      o.command||jsonb_build_object('operationId',('00000000-0000-4000-8000-'||lpad((9100+n)::text,12,'0'))::uuid,'reason','Synthetic history row '||n||', not a new source observation'),o.observed_at,o.recorded_at
    from public.merchant_attendance_rule_capture_operations o cross join generate_series(1,26) n where o.merchant_id='${siteId}' and o.operation_id='${id(9001)}';set constraints all immediate;`);
  assert.equal(protectedFingerprint(),protectedBefore);assert.equal(oldDefinitions(),oldDefinitionBefore);assert.equal(definitions(),definitionBefore);
  let listReads=0,archiveReads=0;
  const parse=(raw,q=ruleCaptureHistoryQueryInput(),actor=ownerId)=>{const result=parseRuleCaptureHistoryResult(raw,q,actor);assert.deepEqual(result,raw,'history_SQL_parser_disagreed');listReads++;return result;};
  const query=(q=ruleCaptureHistoryQueryInput(),actor=ownerId)=>{const before=fingerprint();try{return parse(JSON.parse(exec(`set local role service_role;select ${expression(q,actor)};`)),q,actor);}
    finally{assert.equal(fingerprint(),before,'history_read_changed_facts');assert.equal(definitions(),definitionBefore,'history_read_changed_definitions');}};
  const archive=(q=firstQuery,actor=ownerId)=>{const before=fingerprint();try{const raw=JSON.parse(exec(`set local role service_role;select ${archiveExpression(q,actor)};`));archiveReads++;
    return parseRuleCapturesResult(raw,q,null,actor);}finally{assert.equal(fingerprint(),before,'history_explicit_archive_read_changed_facts');}};
  const counts=()=>JSON.parse(exec(`select jsonb_build_object('artifacts',(select count(*) from public.merchant_attendance_rule_capture_artifacts),
    'operations',(select count(*) from public.merchant_attendance_rule_capture_operations));`));
  assert.deepEqual(counts(),{artifacts:1,operations:27});
  return {siteId,ownerId,workerId,otherWorkerId:id(202),exec,owned,query,queryInput:ruleCaptureHistoryQueryInput,parse,archive,firstQuery,firstCommand,firstReceipt,day,
    fingerprint,protectedFingerprint,protectedBefore,definitions,definitionBefore,oldDefinitions,oldDefinitionBefore,counts,
    stats:()=>({listReads,archiveReads,actualSourceCaptures:1,syntheticMetadataOperations:26}),syntheticOnly:true};
}

export async function checkAttendanceRuleCaptureHistoryNative(native,scope){
  const data=await prepareRuleCaptureHistoryNativeFixture(native,scope),{exec,fingerprint,queryInput:q}=data;
  phase='actual-metadata-pagination';const baseline=fingerprint(),first=data.query();assert.equal(first.items.length,25);assert(first.nextCursor);
  const continuation=q(first.nextCursor),second=data.query(continuation);assert.equal(second.items.length,2);assert.equal(second.nextCursor,null);assert.equal(second.asOf,first.asOf);
  const items=[...first.items,...second.items],expected=Array.from({length:26},(_,n)=>id(9126-n)).concat(id(9001));
  assert.deepEqual(items.map(item=>item.operationId),expected);assert.equal(new Set(items.map(item=>item.recordedAt)).size,1);
  assert.equal(first.nextCursor.beforeId,first.items.at(-1).operationId);assert.equal(first.nextCursor.beforeAt,first.items.at(-1).recordedAt);
  for(const item of items){assert.equal(item.sourceId,id(9001));assert.equal(item.sourceSha256,data.firstReceipt.sourceSha256);assert.equal(item.sourceBytes,data.firstReceipt.sourceBytes);
    assert.equal(item.actorId,ownerId);assert.equal(item.command.employeeId,id(101));assert.equal(item.command.employeeAuthUserId,id(1));assert.equal(item.applied,false);assert.equal(item.historicalApplicationProven,false);
    assert(!Object.hasOwn(item,'sourceText'));assert.equal(Object.keys(item).length,11);}
  assert(Buffer.byteLength(JSON.stringify(first),'utf8')<65536);assert.equal(fingerprint(),baseline);
  phase='explicit-original-archive-read';const selected=first.items[0];
  const opened=data.archive(ruleCapturesQueryInput(9126)).receipt;assert.equal(opened.operationId,selected.operationId);assert.equal(opened.sourceText,data.firstReceipt.sourceText);
  assert.equal(opened.sourceSha256,selected.sourceSha256);assert.equal(opened.sourceReadAt,selected.sourceReadAt);assert.deepEqual(opened.command,selected.command);
  assert.deepEqual(data.archive().receipt,data.firstReceipt);

  const reject=(code,expr,setup='')=>{const before=fingerprint();exec(`begin;reset role;${setup}set local role service_role;do $deny$ begin ${denied(code,expr)}end;$deny$;rollback;`);assert.equal(fingerprint(),before,'history_denial_not_readonly');};
  const probe=(setup,query=q(),actor=ownerId)=>{const before=fingerprint();const raw=JSON.parse(exec(`begin;reset role;${setup}set local role service_role;select ${expression(query,actor)};reset role;set constraints all immediate;rollback;`));
    const parsed=data.parse(raw,query,actor);assert.equal(fingerprint(),before,'history_probe_not_restored');return parsed;};
  phase='owner-worker-currentidentity-isolation';
  reject('attendance_access_denied',expression(q(),id(98)));reject('attendance_access_denied',expression(q({siteId:'99990002'})));
  reject('attendance_worker_not_found',expression(q({workerId:id(204)})));assert.deepEqual(data.query(q({workerId:id(202)})).items,[]);
  reject('attendance_rule_capture_identity_changed',expression(q({workerId:id(203)})));
  const transferred=`update public.merchants set user_id='${id(98)}' where id='${siteId}';`;
  assert.deepEqual(probe(transferred,q(),id(98)).items,[]);reject('attendance_access_denied',expression(q()),transferred);
  reject('attendance_invalid_request',expression(continuation,id(98)),transferred);
  const rebound=`update public.merchant_enterprise_employees set auth_user_id='${id(97)}' where merchant_id='${siteId}' and id='${id(101)}';`;
  assert.deepEqual(probe(rebound).items,[]);reject('attendance_rule_capture_identity_changed',expression(continuation),rebound);
  reject('attendance_rule_capture_identity_changed',archiveExpression(data.firstQuery),rebound);
  reject('attendance_rule_capture_identity_changed',expression(q()),`update public.merchant_attendance_workers set employee_id=null,version=version+1 where merchant_id='${siteId}' and id='${workerId}';`);

  phase='cursor-shape-anchor-and-cutoff';
  for(const bad of [null,{},q({extra:1}),q({asOf:first.asOf}),q({...first.nextCursor,beforeId:id(9998)}),q({...first.nextCursor,expectedEmployeeId:id(102)})]){
    reject(bad?.expectedEmployeeId===id(102)?'attendance_rule_capture_identity_changed':'attendance_invalid_request',expression(bad));
  }
  reject('attendance_invalid_request',expression(q({...first.nextCursor,beforeAt:'2000-01-01T00:00:00.000000Z'})));
  reject('attendance_invalid_request',expression(q({...first.nextCursor,asOf:'9999-12-31T23:59:59.999999Z'})));
  reject('attendance_invalid_request',expression(q({...first.nextCursor,asOf:first.asOf.slice(0,-4)+'Z'})));
  const later=`insert into public.merchant_attendance_rule_capture_operations(merchant_id,operation_id,worker_id,actor_auth_user_id,employee_id,employee_auth_user_id,source_id,command,observed_at,recorded_at)
    select o.merchant_id,'${id(9200)}',o.worker_id,o.actor_auth_user_id,o.employee_id,o.employee_auth_user_id,o.source_id,
      o.command||jsonb_build_object('operationId','${id(9200)}','reason','Synthetic later metadata, not a fresh observation'),o.observed_at,clock_timestamp()
    from public.merchant_attendance_rule_capture_operations o where o.merchant_id='${siteId}' and o.operation_id='${id(9001)}';`;
  const cutoffProbe=JSON.parse(exec(`begin;reset role;${later}set constraints all immediate;set local role service_role;
    select jsonb_build_array(${expression(continuation)},${expression(q())});rollback;`));
  const continued=data.parse(cutoffProbe[0],continuation),fresh=data.parse(cutoffProbe[1],q());
  assert.deepEqual(continued.items,second.items);assert.equal(fresh.items[0].operationId,id(9200));assert.equal(fingerprint(),baseline);

  phase='inactive-matchingidentity-and-display';
  const inactive=`update public.merchant_attendance_workers set active=false,display_name='Changed current display',worker_no='CURRENT-NO',version=version+1 where merchant_id='${siteId}' and id='${workerId}';
    update public.merchant_enterprise_employees set status='disabled' where merchant_id='${siteId}' and id='${id(101)}';
    update public.merchant_attendance_settings set time_zone='Pacific/Apia',enabled=false,version=version+1 where merchant_id='${siteId}';`;
  const inactivePage=probe(inactive);assert.equal(inactivePage.workerActive,false);assert.equal(inactivePage.employeeActive,false);assert.equal(inactivePage.workerName,'Changed current display');
  assert.equal(inactivePage.workerNo,'CURRENT-NO');assert.deepEqual(inactivePage.items,first.items);
  assert.equal(data.firstReceipt.sourceReadAt,opened.sourceReadAt);

  phase='ACL-and-final-readonly-fingerprints';
  for(const role of ['anon','authenticated'])exec(`set local role ${role};do $acl$ begin begin perform ${expression(q())};raise exception 'history_unexpected_execute';exception when insufficient_privilege then null;end;end;$acl$;`);
  for(const role of ['anon','authenticated','service_role'])exec(`set local role ${role};do $private$ begin
    ${ruleCapturesNativeTables.map(table=>`assert not has_table_privilege(current_user,'public.${table}','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),'history_changed_archive_table_acl';
      begin perform 1 from public.${table};raise exception 'history_direct_table_read';exception when insufficient_privilege then null;end;`).join('\n')}
    end;$private$;`);
  assert.equal(fingerprint(),baseline);assert.equal(data.protectedFingerprint(),data.protectedBefore);assert.equal(data.definitions(),data.definitionBefore);
  assert.equal(data.oldDefinitions(),data.oldDefinitionBefore);assert.deepEqual(data.counts(),{artifacts:1,operations:27});
  for(const label of labels)native.pass(label);
  return {checks:labels.length,...data.stats(),metadataPageLengths:[25,2],artifacts:1,operations:27,laterMetadataRollbackRows:1,
    allReadAndRollbackFingerprintsUnchanged:true,oldFactsAndDefinitionsUnchanged:true,syntheticOnly:true,noBrowser:true,
    applied:false,historicalApplicationProven:false,callerOwnedNamespaceCleanup:true};
}

export async function runAttendanceRuleCaptureHistoryNative(args){return runAttendanceLabelsReuse(args,native=>withAttendanceConcurrencySandbox(native,async scope=>{
  const result=await checkAttendanceRuleCaptureHistoryNative(native,scope);console.log(JSON.stringify({ruleCaptureHistoryNative:result}));
}));}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  runAttendanceRuleCaptureHistoryNative(process.argv.slice(2)).catch(error=>{console.error(JSON.stringify(ruleCaptureHistoryNativeFailure(error)));process.exitCode=1;});
}
