// Import is inert. Root owns the existing stopped-PG lifecycle and the guarded
// synthetic namespace. This is three self-clock cycles, not a four-channel rerun.
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {runAttendanceLabelsReuse} from './merchant-attendance-choice-labels-reuse-native.mjs';
import {withAttendanceConcurrencySandbox} from './merchant-attendance-concurrency-sandbox.mjs';
import {prepareBoundClocksNativeFixture,boundClockMigrationBody,boundClockRpcExpression,quote} from './fixtures/attendance-bound-clocks-native.mjs';
import {groupsQueryInput,groupsNativeSave} from './merchant-attendance-groups-native.mjs';
import {lifecycleId as id,lifecycleJson as json} from './merchant-attendance-lifecycle-native-support.mjs';

const rpc='faolla_attendance_shift_rule_binding_v1';
export const shiftRuleBindingReaderMigration='202610040135_merchant_attendance_shift_rule_binding_reader.sql';
export const shiftRuleBindingReaderLabels=Object.freeze([
  'reader135 installs/reapplies without changing existing definitions ACL tables indexes triggers or business facts',
  'three actual self-clock cycles yield legacy missing verified and inactive-group unverified evidence with six events two bindings one source',
  'current owner reads original point bytes after group changes while foreign owner worker and non-clock anchors fail closed',
  'current and saved dual identities are fenced; transferred owner and matching inactive identities may read unchanged historical bytes',
  'byte corruption fails strict parsing or original CHECKs; valid rollback-only rows expose binding and source relational mismatches',
  'actual GET handler and service invoke reader135 with paused reads allowed and no SQL for disabled POST or failed authentication',
  'private helper and source-table ACLs plus every read and rollback preserve all fixture facts and definitions',
]);
const privateFunctions=[
  ['faolla_attendance_shift_rule_binding_object_v1','jsonb,text[]',"'{}'::jsonb,array[]::text[]"],
  ['faolla_attendance_shift_rule_binding_scalar_v1','jsonb,text',"'null'::jsonb,'uuid'"],
  ['faolla_attendance_shift_rule_binding_graph_v1','jsonb,timestamp with time zone',"'{}'::jsonb,clock_timestamp()"],
];
const flags=['FAOLLA_ATTENDANCE_RULE_BINDINGS_ENABLED','FAOLLA_ATTENDANCE_RULE_BINDINGS_SITE_IDS'];
let phase='entry';
export const shiftRuleBindingReaderExpression=(query,actor)=>`public.${rpc}(${json(query)},${quote(actor)})`;
export function shiftRuleBindingReaderNativeFailure(error){
  const code=(error instanceof Error?error.message:'').match(/(?:ERROR:\s+|^)(attendance_[a-z_]+|merchant_attendance_[a-z_]+)(?=\r?\n|$)/)?.[1];
  return {error:'shift_rule_binding_reader_native_failed',phase,code:code??'local_check_failed'};
}

// Caller must use an owned BEGIN/ROLLBACK. This copies a real saved row onto a
// real legacy start solely to exercise reader relations; it is NOT a backfill.
export function shiftRuleBindingReaderProbeSql(verifiedEventId,targetEventId,patch={}){
  const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  assert(uuid.test(verifiedEventId)&&uuid.test(targetEventId));
  assert(patch&&Object.getPrototypeOf(patch)===Object.prototype);
  assert(Object.keys(patch).every(k=>['operation_id','sequence','location_id','event_time_zone','employee_id','employee_auth_user_id','request_auth_user_id','worker_version','settings_version','source_id'].includes(k)));
  return `do $binding_probe$ declare b public.merchant_attendance_shift_rule_bindings%rowtype;e public.merchant_attendance_events%rowtype;
    begin select * into strict b from public.merchant_attendance_shift_rule_bindings where start_event_id='${verifiedEventId}';
      select * into strict e from public.merchant_attendance_events where id='${targetEventId}';
      assert e.action='clock_in' and e.worker_id=b.worker_id and e.merchant_id=b.merchant_id,'reader_probe_anchor_mismatch';
      b.start_event_id:=e.id;b.operation_id:=e.operation_id;b.sequence:=e.sequence;b.location_id:=e.location_id;
      b.occurred_at:=e.occurred_at;b.event_time_zone:=e.time_zone;b.recorded_at:=clock_timestamp();
      b:=jsonb_populate_record(b,${json(patch)});insert into public.merchant_attendance_shift_rule_bindings select(b).*;
      set constraints all immediate;
    end;$binding_probe$;`;
}

export async function checkAttendanceShiftRuleBindingReaderNative(native,scope){
  phase='minimal-owned-fixture';
  const d=await prepareBoundClocksNativeFixture(native,scope),{exec,owned,site,owner,worker,employee,auth,plainLocation}=d;
  for(const name of ['202610040133_merchant_attendance_shift_rule_bindings.sql','202610040134_merchant_attendance_bound_clocks.sql'])exec(boundClockMigrationBody(native.root,name));
  const inventory=()=>JSON.parse(exec(`select jsonb_agg(relname order by relname) from pg_class where relnamespace=${owned.oid} and relkind in('r','p');`));
  const tables=inventory(),fingerprint=(selected=tables)=>exec(`select md5(jsonb_build_object(${selected.map(t=>`${quote(t)},(select coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text),'[]'::jsonb) from public.${t} r)`).join(',')})::text);`);
  const oldOids=exec(`select array_agg(oid order by oid)::text from pg_proc where pronamespace=${owned.oid} and prokind='f';`);
  const oldDefinitions=()=>exec(`select md5(jsonb_agg(jsonb_build_array(oid,pg_get_functiondef(oid),proowner,proacl,proconfig,prosecdef) order by oid)::text) from pg_proc where oid=any(${quote(oldOids)}::oid[]);`);
  const definitions=()=>exec(`select jsonb_build_object('functions',(select jsonb_agg(jsonb_build_array(p.oid,pg_get_functiondef(p.oid),p.proowner,p.proacl,p.proconfig,p.prosecdef) order by p.oid) from pg_proc p where p.pronamespace=${owned.oid} and p.prokind='f'),
    'tables',(select jsonb_agg(jsonb_build_array(c.relname,c.relowner,c.relacl,c.relrowsecurity) order by c.relname) from pg_class c where c.relnamespace=${owned.oid} and c.relkind in('r','p')),
    'indexes',(select jsonb_agg(indexdef order by indexname) from pg_indexes where schemaname=${quote(scope.schema)}),
    'triggers',(select jsonb_agg(pg_get_triggerdef(t.oid) order by t.tgrelid,t.tgname) from pg_trigger t join pg_class c on c.oid=t.tgrelid where c.relnamespace=${owned.oid} and not t.tgisinternal));`);
  const oldBefore=oldDefinitions(),beforeObjects=JSON.parse(definitions()),businessTables=tables.filter(t=>t!=='faolla_schema_migrations'),beforeInstall=fingerprint(businessTables);
  phase='install135';const migration=boundClockMigrationBody(native.root,shiftRuleBindingReaderMigration);exec(migration);
  assert.deepEqual(inventory(),tables);assert.equal(oldDefinitions(),oldBefore,'reader_install_changed_old_definitions');assert.equal(fingerprint(businessTables),beforeInstall);
  const afterObjects=JSON.parse(definitions());for(const key of ['tables','indexes','triggers'])assert.deepEqual(afterObjects[key],beforeObjects[key]);
  assert.equal(afterObjects.functions.length-beforeObjects.functions.length,4);
  const installed=definitions(),empty=fingerprint();exec(migration);assert.equal(definitions(),installed,'reader_reapply_changed_definition');assert.equal(fingerprint(),empty);
  native.pass(shiftRuleBindingReaderLabels[0]);
  const require=createRequire(import.meta.url),{executeAttendanceSelf}=require('../src/lib/merchantAttendanceSelf.server.ts');
  const {parseShiftRuleBindingResult,parseShiftRuleBindingResponse,parseShiftRulePoint}=require('../src/lib/merchantAttendanceShiftRuleBinding.ts');
  const {executeShiftRuleBinding}=require('../src/lib/merchantAttendanceShiftRuleBinding.server.ts');
  const {handleShiftRuleBinding}=require('../src/app/api/merchant-enterprise/attendance/shift-rule-binding/route-handler.ts');
  const {MerchantEnterpriseAccessError}=require('../src/lib/merchantEnterpriseAuth.server.ts');
  const counts=()=>JSON.parse(exec("select jsonb_build_object('events',(select count(*) from public.merchant_attendance_events),'bindings',(select count(*) from public.merchant_attendance_shift_rule_bindings),'sources',(select count(*) from public.merchant_attendance_shift_rule_sources));"));
  assert.deepEqual(counts(),{events:0,bindings:0,sources:0});
  const unchanged=async run=>{const before=fingerprint();try{return await run();}finally{assert.equal(fingerprint(),before,'reader_changed_fixture_facts');assert.equal(definitions(),installed,'reader_changed_definitions');}};
  let readCalls=0,clockCalls=0,handlerCalls=0;
  const readService={rpc:async(name,args)=>{
    assert.equal(name,rpc);assert.deepEqual(Object.keys(args).sort(),['p_auth_user_id','p_query']);readCalls++;
    try{return {data:JSON.parse(exec(`set local role service_role;select ${shiftRuleBindingReaderExpression(args.p_query,args.p_auth_user_id)};`)),error:null};}
    catch(error){const code=String(error).match(/ERROR:\s+(attendance_[a-z_]+)/)?.[1];if(!code)throw error;return {data:null,error:{message:code}};}
  }};
  const q=(startEventId,patch={})=>({siteId:site,workerId:worker,startEventId,...patch});
  const parse=(raw,query,actor=owner)=>{const result=parseShiftRuleBindingResult(raw,query,actor);assert.deepEqual(result,raw,'reader_SQL_parser_disagreed');return result;};
  const read=(query,actor=owner)=>unchanged(async()=>parse(await executeShiftRuleBinding({query,authUserId:actor},readService),query,actor));
  const clockTables=tables.filter(t=>!['merchant_attendance_events','merchant_attendance_shift_rule_sources','merchant_attendance_shift_rule_bindings'].includes(t));
  const clockService={rpc:async(name,args)=>{assert(['faolla_attendance_self_v1','faolla_attendance_self_bound_v1'].includes(name));clockCalls++;
    return {data:JSON.parse(exec(`set local role service_role;select ${boundClockRpcExpression(name,args)};`)),error:null};}};
  const clock=async(action,expectedSequence)=>{const before=fingerprint(clockTables);try{return await executeAttendanceSelf({siteId:site,authUserId:auth,operationId:null,
    command:{expectedWorkerId:worker,operationId:randomUUID(),locationId:plainLocation,action,expectedSequence}},clockService);}
    finally{assert.equal(fingerprint(clockTables),before,'reader_fixture_clock_changed_other_sources');assert.equal(definitions(),installed);}};
  const previous=new Map(flags.map(key=>[key,process.env[key]]));
  try{
    phase='three-real-self-cycles';process.env.FAOLLA_ATTENDANCE_RULE_BINDINGS_SITE_IDS=site;delete process.env.FAOLLA_ATTENDANCE_RULE_BINDINGS_ENABLED;
    const legacy=await clock('clock_in',0),legacyOut=await clock('clock_out',1);process.env.FAOLLA_ATTENDANCE_RULE_BINDINGS_ENABLED='1';
    const verified=await clock('clock_in',2);await clock('clock_out',3);
    const original=await read(q(verified.receipt.id));assert.equal(original.status,'verified');assert.equal(original.reason,null);
    const source=original.binding.source,point=parseShiftRulePoint(source,q(verified.receipt.id),original.binding,original.event);
    assert.equal(source.sourceBytes,Buffer.byteLength(source.sourceText,'utf8'));assert.equal(source.sourceSha256,createHash('sha256').update(source.sourceText,'utf8').digest('hex'));
    assert.equal(point.fields.lateGraceMinutes.minutes,0);assert.equal(point.fields.earlyGraceMinutes.state,'disabled');
    assert.equal(point.fields.lateGraceMinutes.source.layer,'personal');assert.equal(original.binding.requestAuthUserId,auth);
    // This is a real124 owner write, deliberately after the verified start.
    d.foundation.call(groupsQueryInput({groupId:d.group}),groupsNativeSave(7801,{groupId:d.group,expectedRevision:1,active:false,name:'Synthetic current inactive group'}),true);
    assert.deepEqual((await read(q(verified.receipt.id))).binding,original.binding,'current_group_replaced_saved_binding');
    const unverified=await clock('clock_in',4);assert.equal(unverified.state.status,'working');await clock('clock_out',5);
    const unresolved=await read(q(unverified.receipt.id)),missing=await read(q(legacy.receipt.id));
    assert.equal(unresolved.status,'unverified');assert.equal(unresolved.reason,'inactive_group');assert.equal(unresolved.binding.source,null);
    assert.equal(missing.status,'missing');assert.equal(missing.reason,'binding_missing');assert.equal(missing.binding,null);
    assert.deepEqual(counts(),{events:6,bindings:2,sources:1});native.pass(shiftRuleBindingReaderLabels[1]);
    const baseline=fingerprint();
    const denied=(code,expression)=>`begin perform ${expression};raise exception 'reader_unexpected_acceptance';exception when sqlstate 'P0001' then if sqlerrm<>${quote(code)} then raise;end if;end;`;
    const reject=async(code,query=q(verified.receipt.id),actor=owner,setup='')=>unchanged(async()=>{
      exec(`begin;reset role;${setup}set local role service_role;do $deny$ begin ${denied(code,shiftRuleBindingReaderExpression(query,actor))}end;$deny$;rollback;`);readCalls++;
    });
    const probe=async(setup,query=q(verified.receipt.id),actor=owner)=>unchanged(async()=>{
      const raw=JSON.parse(exec(`begin;reset role;${setup}set local role service_role;select ${shiftRuleBindingReaderExpression(query,actor)};reset role;set constraints all immediate;rollback;`));readCalls++;return parse(raw,query,actor);
    });
    phase='owner-anchor-isolation';
    await reject('attendance_access_denied',q(verified.receipt.id),id(98));await reject('attendance_access_denied',q(verified.receipt.id,{siteId:'99990002'}));
    await reject('attendance_worker_not_found',q(verified.receipt.id,{workerId:id(204)}));
    await reject('attendance_shift_rule_binding_not_found',q(verified.receipt.id,{workerId:d.geoWorker}));
    await reject('attendance_shift_rule_binding_not_found',q(legacyOut.receipt.id));await reject('attendance_shift_rule_binding_not_found',q(id(9998)));
    for(const bad of [null,{},q(verified.receipt.id,{extra:true}),q('bad-id')])await reject('attendance_invalid_request',bad);
    assert.deepEqual((await read(q(verified.receipt.id))).binding,original.binding);native.pass(shiftRuleBindingReaderLabels[2]);

    phase='identity-owner-transfer-inactive';
    const transfer=`update public.merchants set user_id='${id(98)}' where id='${site}';`;
    await reject('attendance_access_denied',q(verified.receipt.id),owner,transfer);
    const transferred=await probe(transfer,q(verified.receipt.id),id(98));assert.equal(transferred.actorId,id(98));assert.deepEqual(transferred.binding,original.binding);
    const rebound=`update public.merchant_enterprise_employees set auth_user_id='${id(97)}' where merchant_id='${site}' and id='${employee}';`;
    for(const anchor of [verified.receipt.id,unverified.receipt.id])await reject('attendance_shift_rule_binding_identity_changed',q(anchor),owner,rebound);
    await reject('attendance_shift_rule_binding_identity_changed',q(verified.receipt.id),owner,`update public.merchant_enterprise_employees set status='disabled',auth_user_id=null where merchant_id='${site}' and id='${employee}';`);
    await reject('attendance_shift_rule_binding_identity_changed',q(verified.receipt.id),owner,`update public.merchant_attendance_workers set employee_id=null,version=version+1 where merchant_id='${site}' and id='${worker}';`);
    await reject('attendance_shift_rule_binding_identity_changed',q(verified.receipt.id),owner,`update public.merchant_attendance_workers set employee_id=null where merchant_id='${site}' and id='${d.geoWorker}';update public.merchant_attendance_workers set employee_id='${d.geoEmployee}',version=version+1 where merchant_id='${site}' and id='${worker}';`);
    // A legacy event has no saved member Auth UUID. A changed current Auth can
    // still yield only missing evidence, never invented historical verification.
    assert.equal((await probe(rebound,q(legacy.receipt.id))).status,'missing');
    const inactive=`update public.merchant_attendance_workers set active=false,display_name='Current inactive display',version=version+1 where merchant_id='${site}' and id='${worker}';
      update public.merchant_enterprise_employees set status='disabled' where merchant_id='${site}' and id='${employee}';
      update public.merchant_attendance_settings set enabled=false,time_zone='Pacific/Apia',version=version+1 where merchant_id='${site}';`;
    const paused=await probe(inactive);assert.equal(paused.worker.active,false);assert.equal(paused.worker.employeeActive,false);
    assert.equal(paused.worker.workerName,'Current inactive display');assert.deepEqual(paused.binding,original.binding);assert.deepEqual(paused.event,original.event);
    native.pass(shiftRuleBindingReaderLabels[3]);

    phase='corruption-and-relational-owned-rollback';
    for(const mutate of [r=>{r.binding.source.sourceText+=' ';},r=>{r.binding.source.sourceSha256='0'.repeat(64);},r=>{r.binding.source.sourceBytes++;},
      r=>{r.event.employeeId=d.geoEmployee;},r=>{r.binding.workerVersion++;},r=>{r.event.startEventId=id(9501);}]){
      const bad=structuredClone(original);mutate(bad);assert.throws(()=>parseShiftRuleBindingResult(bad,q(verified.receipt.id),owner),/attendance_shift_rule_binding_invalid/);
    }
    // A CHECK-valid copied binding has a different event/source ID, which is
    // legal deduplication. Its following mutations must instead fail relations.
    const append=patch=>shiftRuleBindingReaderProbeSql(verified.receipt.id,legacy.receipt.id,patch);
    const copied=await probe(append({}),q(legacy.receipt.id));assert.equal(copied.status,'verified');assert.equal(copied.binding.source.sourceId,source.sourceId);
    assert.notEqual(copied.event.startEventId,copied.binding.source.sourceId);assert.equal(copied.binding.source.sourceText,source.sourceText);
    for(const patch of [{sequence:99},{operation_id:id(9502)},{location_id:d.geoLocation},{event_time_zone:'Europe/Madrid'},{request_auth_user_id:id(97)}])
      await reject('attendance_shift_rule_binding_invalid',q(legacy.receipt.id),owner,append(patch));
    await reject('attendance_shift_rule_binding_identity_changed',q(legacy.receipt.id),owner,append({employee_auth_user_id:id(97)}));
    await reject('attendance_shift_rule_binding_identity_changed',q(legacy.receipt.id),owner,append({employee_id:d.geoEmployee}));
    const changedSource=`do $source_probe$ declare s public.merchant_attendance_shift_rule_sources%rowtype;body text;
      begin select * into strict s from public.merchant_attendance_shift_rule_sources where source_id='${source.sourceId}';
        body:=jsonb_set(s.source_text::jsonb,'{workerVersion}','2'::jsonb)::text;s.source_id:='${id(9503)}';s.source_text:=body;
        s.source_bytes:=octet_length(convert_to(body,'UTF8'));s.source_sha256:=encode(sha256(convert_to(body,'UTF8')),'hex');
        insert into public.merchant_attendance_shift_rule_sources select(s).*;set constraints all immediate;
      end;$source_probe$;`;
    await reject('attendance_shift_rule_binding_invalid',q(legacy.receipt.id),owner,changedSource+append({source_id:id(9503)}));
    await unchanged(async()=>assert.throws(()=>exec(`begin;insert into public.merchant_attendance_shift_rule_sources(merchant_id,source_id,worker_id,source_text,source_sha256,source_bytes,created_at)
      select merchant_id,'${id(9504)}',worker_id,source_text,repeat('0',64),source_bytes,created_at from public.merchant_attendance_shift_rule_sources where source_id='${source.sourceId}';rollback;`),/violates check constraint/));
    assert.equal(fingerprint(),baseline);native.pass(shiftRuleBindingReaderLabels[4]);

    phase='actual-handler-service-rpc';
    const deps={enabled:()=>true,authenticate:async()=>({user:{id:owner},authenticationMethods:['password']}),allow:()=>true,
      entitlement:async()=>({permissionConfig:{allowEnterpriseManagement:true,allowEmployeeAttendance:false}}),
      execute:input=>executeShiftRuleBinding(input,readService)};
    const request=(query,method='GET')=>new Request(`https://www.faolla.com/api/merchant-enterprise/attendance/shift-rule-binding?${new URLSearchParams(query)}`,
      {method,headers:{host:'www.faolla.com',origin:'https://www.faolla.com','sec-fetch-site':'same-origin'}});
    for(const [anchor,status] of [[verified.receipt.id,'verified'],[legacy.receipt.id,'missing'],[unverified.receipt.id,'unverified']])await unchanged(async()=>{
      const response=await handleShiftRuleBinding(request(q(anchor)),deps);handlerCalls++;assert.equal(response.status,200);
      assert.equal(response.headers.get('cache-control'),'private, no-store');const result=parseShiftRuleBindingResponse(await response.json(),q(anchor),owner);
      assert.equal(result.moduleEnabled,false);assert.equal(result.status,status);if(status==='verified')assert.deepEqual(result.binding,original.binding);
    });
    const beforeDenied=readCalls;
    for(const [method,override,status] of [['POST',{},405],['GET',{enabled:()=>false},404],['GET',{authenticate:async()=>{throw new MerchantEnterpriseAccessError('unauthorized',401);}},401]])await unchanged(async()=>{
      const response=await handleShiftRuleBinding(request(q(verified.receipt.id),method),{...deps,...override});handlerCalls++;assert.equal(response.status,status);
    });
    assert.equal(readCalls,beforeDenied,'rejected_handler_called_SQL');native.pass(shiftRuleBindingReaderLabels[5]);

    phase='private-acl-final-fingerprints';
    await unchanged(async()=>{
      for(const role of ['anon','authenticated'])assert.throws(()=>exec(`set local role ${role};select ${shiftRuleBindingReaderExpression(q(verified.receipt.id),owner)};`),/permission denied/);
      for(const role of ['anon','authenticated','service_role']){
        for(const [name,types,args] of privateFunctions){
          assert.equal(exec(`select has_function_privilege('${role}','public.${name}(${types})','EXECUTE');`),'f');
          assert.throws(()=>exec(`set local role ${role};select public.${name}(${args});`),/permission denied/);
        }
        for(const table of ['merchant_attendance_shift_rule_bindings','merchant_attendance_shift_rule_sources']){
          assert.equal(exec(`select has_table_privilege('${role}','public.${table}','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER');`),'f');
          assert.throws(()=>exec(`set local role ${role};select * from public.${table};`),/permission denied/);
        }
      }
    });
    exec(migration);assert.equal(fingerprint(),baseline);assert.equal(oldDefinitions(),oldBefore);assert.equal(definitions(),installed);
    assert.deepEqual(counts(),{events:6,bindings:2,sources:1});assert.equal(clockCalls,6);
    assert.equal(exec("select count(*) from public.merchant_attendance_shift_rule_bindings b join public.merchant_attendance_events e on e.id=b.start_event_id where e.action<>'clock_in';"),'0');
    native.pass(shiftRuleBindingReaderLabels[6]);
    return {checks:shiftRuleBindingReaderLabels.length,labels:[...shiftRuleBindingReaderLabels],...counts(),actualSelfClockCalls:clockCalls,readCalls,handlerCalls,
      actualReaderSql:true,actualTypeScriptService:true,actualGetHandler:true,syntheticAuth:true,realAuth:false,syntheticPastRules:true,
      allReadAndRollbackFingerprintsUnchanged:true,oldDefinitionsAndAclUnchanged:true,businessWritesFromReads:0,
      otherClockChannelsRetested:false,wallClockChanged:false,noBrowser:true,noListDiscovery:true,productionAccess:false,newCluster:false,callerOwnedNamespaceCleanup:true};
  }finally{for(const [key,value] of previous){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
}

export async function runAttendanceShiftRuleBindingReaderNative(args){return runAttendanceLabelsReuse(args,native=>withAttendanceConcurrencySandbox(native,async scope=>{
  const result=await checkAttendanceShiftRuleBindingReaderNative(native,scope);console.log(JSON.stringify({shiftRuleBindingReaderNative:result}));
}));}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  runAttendanceShiftRuleBindingReaderNative(process.argv.slice(2)).catch(error=>{console.error(JSON.stringify(shiftRuleBindingReaderNativeFailure(error)));process.exitCode=1;});
}
