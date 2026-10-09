// Pure construction and boundary probes. SQL replies are opaque spies, not
// evidence of real scope authorization or a successful role/attendance write.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import test from 'node:test';
import {supervisorAccessSeedPlan,createSupervisorAccessOwnedExec,createSupervisorAccessTransport,
  createSupervisorAccessOracles,validateSupervisorAccessRpcInput} from './merchant-attendance-supervisor-access-fixture.mjs';

const require=createRequire(import.meta.url);
const {executeAttendanceRecords,executeAttendanceScopes,executeAttendanceChoices}=require('../src/lib/merchantAttendanceManagement.server.ts');
const {updateMerchantEnterpriseRole}=require('../src/lib/merchantEnterpriseStore.server.ts');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const plan=supervisorAccessSeedPlan('2026-10-02');
const owned={schema:'attendance_race_'+'a'.repeat(32),oid:123,tableOid:456,owner:'postgres',
  marker:'faolla-synthetic-concurrency:12345678-1234-1234-1234-123456789abc'};
const roleName='faolla_update_merchant_enterprise_role_v3',scopeName='faolla_attendance_scopes_v1';
const recordName='faolla_attendance_records_v1',choiceName='faolla_attendance_choices_v1';
const role={id:id(30),merchant_id:plan.site,name:plan.labels.role,description:'',access_scope:'all'};
const input=()=>({merchant_id:plan.site,role_id:id(30),expected_version:1,actor_type:'owner',actor_id:id(99),
  permissions:['enterprise.view','attendance.records.view'],name:role.name,description:'',access_scope:'all',allowed_board_ids:[]});
const scopeArgs=()=>({p_site_id:plan.site,p_auth_user_id:id(99),p_employee_id:id(101),p_command:null,p_operation_id:null});
const put=()=>({operationId:id(901),expectedRevision:0,action:'put',grantId:id(801),
  grant:{workerIds:[id(201)],locationIds:[id(301)],validFrom:'2026-10-01T00:00:00.000Z',validUntil:null}});
const recordQuery=()=>({access:'manager',fromAt:'2026-10-02T00:00:00.000000Z',toAt:'2026-10-03T00:00:00.000000Z',
  workerId:null,locationId:null,asOf:null,cursorAt:null,cursorId:null});
const recordArgs=()=>({p_site_id:plan.site,p_auth_user_id:id(1),p_query:recordQuery()});
const choiceArgs=()=>({p_site_id:plan.site,p_auth_user_id:id(99),p_query:{kind:'workers',search:'',cursor:null}});
const tables=['merchants','faolla_schema_migrations','merchant_enterprise_roles','merchant_enterprise_employees',
  'merchant_enterprise_role_boards','merchant_enterprise_audit_events','merchant_task_boards','merchant_task_columns','merchant_tasks',
  'merchant_attendance_settings','merchant_attendance_locations','merchant_attendance_workers','merchant_attendance_events',
  'merchant_attendance_scopes','merchant_attendance_scope_grants','merchant_attendance_scope_workers',
  'merchant_attendance_scope_locations','merchant_attendance_scope_operations'];

function fixture({reply=()=>JSON.stringify({role:'service_role',data:{opaque:true}}),readRows=[]}={}){
  const queries=[];let currentOwned=owned,currentCatalog=tables.map((name,index)=>({name,oid:1000+index}));
  const raw=source=>{
    queries.push(source);
    if(source.includes("'schema',n.nspname"))return JSON.stringify(currentOwned);
    if(source.includes("'name',relname,'oid',oid::bigint"))return JSON.stringify(currentCatalog);
    if(source.includes('jsonb_agg(to_jsonb(t) order by id)'))return JSON.stringify([role]);
    if(source.includes('select count(*) from public.merchant_enterprise_role_boards'))return '0';
    if(source.includes('select md5(jsonb_build_object'))return 'opaque-fingerprint';
    if(source.includes('jsonb_agg(to_jsonb(q))'))return JSON.stringify(readRows);
    if(source.includes("'grants',(select"))return JSON.stringify({roles:[role],scopes:[],grants:[],scopeOperations:[],audits:[]});
    return reply(source);
  };
  const exec=createSupervisorAccessOwnedExec(raw,owned),transport=createSupervisorAccessTransport(exec,owned);
  const business=()=>queries.filter(source=>source.includes("jsonb_build_object('role',current_user,'data',public."));
  return {raw,exec,transport,queries,business,setOwned:value=>{currentOwned=value;},setCatalog:value=>{currentCatalog=value;}};
}

test('seed plan constructs four explicit synthetic worker/location facts, one view-only employee, no grants and an original bootstrap workspace',()=>{
  assert.deepEqual(plan.actors,[{id:id(99),email:'owner-entry@example.test'},{id:id(1),email:'employee-a@example.test'}]);
  assert.deepEqual(plan.workers,[id(201),id(202)]);assert.deepEqual(plan.locations,[id(301),id(302)]);
  assert.equal(plan.events.length,4);assert.equal(new Set(plan.events.map(event=>`${event.workerId}/${event.locationId}`)).size,4);
  assert.deepEqual(plan.allowedIds,[id(1001)]);assert.deepEqual(new Set([...plan.allowedIds,...plan.forbiddenIds]),new Set(plan.events.map(event=>event.id)));
  assert.deepEqual(plan.events.filter(event=>plan.allowedIds.includes(event.id)).map(event=>[event.workerId,event.locationId]),[[id(201),id(301)]]);
  assert(plan.events.every(event=>/^2026-10-02T12:0[0-3]:00\.000123Z$/.test(event.occurredAt)));
  for(const workerId of plan.workers)assert.deepEqual(plan.events.filter(event=>event.workerId===workerId).map(event=>event.sequence),[1,2]);
  assert.equal((plan.seedSql.match(/array\['enterprise.view'\]/g)??[]).length,3);
  assert.match(plan.seedSql,/'UTC',false,false/);assert.match(plan.seedSql,/'active',clock_timestamp\(\)/);
  assert.doesNotMatch(plan.seedSql,/attendance\.records\.view|insert into public\.merchant_attendance_scope|\bupdate\b|\bdelete\b|\bgrant\b/i);
  assert.doesNotMatch(plan.seedSql.match(/insert into public\.merchant_attendance_workers[^;]+/)[0],/employee_id/);
  assert.match(plan.workspaceSql,/merchant_task_boards/);assert.equal((plan.workspaceSql.match(/合成工作列/g)??[]).length,4);
  assert(plan.workspaceSql.includes("'default'"));for(const key of ['todo','in_progress','blocked','done'])assert(plan.workspaceSql.includes(`'${key}'`));
  for(const bad of ['2026-02-30','2026-10-02;drop schema public','not-a-date',null])assert.throws(()=>supervisorAccessSeedPlan(bad));
});

test('owned exec fences OID, owner and marker inside each transaction and retains READ ONLY boundaries',()=>{
  const h=fixture();h.exec('begin read only;set local role service_role;select 1;rollback;');
  const source=h.queries.at(-1);assert.match(source,/^begin read only;reset role;do \$owned\$/);
  assert.match(source,/c\.oid=456 and n\.oid=123/);assert(source.includes(owned.schema));assert(source.includes(owned.marker));
  assert.match(source,/n\.nspowner::regrole::text='postgres'/);assert.match(source,/select 1;rollback;$/);
  for(const changed of [{...owned,oid:999},{...owned,tableOid:999},{...owned,owner:'service_role'},{...owned,marker:owned.marker.replace(/a/g,'b')}]){
    h.setOwned(changed);const count=h.queries.length;
    assert.throws(()=>h.exec('select forbidden_side_effect();'));
    assert.equal(h.queries.length,count+1,'only the read-only ownership check may run');
  }
});

test('complete ten-field role payload is forwarded unchanged to service-role SQL, with no role result fabrication',async()=>{
  const h=fixture(),original=input();
  assert.deepEqual(await h.transport.rpc(roleName,{p_input:original}),{data:{opaque:true},error:null});
  const source=h.business()[0];assert.match(source,/set local role service_role/);
  const serialized=source.match(/faolla_update_merchant_enterprise_role_v3\('((?:''|[^'])*)'::jsonb\)/)?.[1];
  assert(serialized);assert.deepEqual(JSON.parse(serialized.replaceAll("''","'")),original);
  assert.equal(Object.keys(JSON.parse(serialized)).length,10);
  original.permissions.push('not-snapshotted');assert.equal(h.transport.calls[0].input.p_input.permissions.length,2);
  assert.deepEqual(h.transport.rpcNames,[roleName,scopeName,recordName,choiceName]);
  const bad=[{...input(),role_id:id(31)},{...input(),merchant_id:'99990002'},{...input(),actor_type:'employee'},
    {...input(),actor_id:id(1)},{...input(),name:'edited'},{...input(),description:'edited'},
    {...input(),access_scope:'restricted'},{...input(),allowed_board_ids:[id(401)]},{...input(),expected_version:'1'},
    {...input(),expected_version:0},{...input(),permissions:['enterprise.view','attendance.self.view']},
    {...input(),permissions:['enterprise.view','enterprise.view']},{...input(),permissions:[]},{...input(),status:'disabled'}];
  const missing=input();delete missing.description;bad.push(missing);
  for(const p_input of bad)await assert.rejects(h.transport.rpc(roleName,{p_input}),/^Error: supervisor_access_rpc_forbidden$/);
  assert.equal(h.business().length,1);
});

test('actual role and attendance executors retain actor, scope, dates, revision and read-recovery identifiers without owner fallback',async()=>{
  const h=fixture({reply:()=>{throw Error('ERROR: attendance_access_denied\nDETAIL: confidential');}});
  await assert.rejects(executeAttendanceRecords({siteId:plan.site,authUserId:id(1),...recordQuery()},h.transport),/attendance_access_denied/);
  await assert.rejects(executeAttendanceChoices({siteId:plan.site,authUserId:id(99),kind:'locations',search:'',cursor:null,ids:[id(301),id(302)]},h.transport),/attendance_access_denied/);
  await assert.rejects(executeAttendanceScopes({siteId:plan.site,authUserId:id(99),employeeId:id(101),operationId:null,command:put()},h.transport),/attendance_access_denied/);
  await assert.rejects(executeAttendanceScopes({siteId:plan.site,authUserId:id(99),employeeId:id(101),operationId:id(901),command:null},h.transport),/attendance_access_denied/);
  assert.deepEqual(h.transport.calls.map(call=>call.input),[recordArgs(),
    {p_site_id:plan.site,p_auth_user_id:id(99),p_query:{kind:'locations',ids:[id(301),id(302)]}},
    {...scopeArgs(),p_command:put()},{...scopeArgs(),p_operation_id:id(901)}]);
  assert(h.transport.calls.every(call=>call.error==='attendance_access_denied'));
  assert.equal(h.business().length,4);assert(!JSON.stringify(h.transport.errors).includes('confidential'));
  const roleProbe=fixture({reply:()=>{throw Error('ERROR: enterprise_version_conflict\nDETAIL: confidential');}});
  await assert.rejects(updateMerchantEnterpriseRole({rpc:roleProbe.transport.rpc},{siteId:plan.site,roleId:id(30),version:7,
    actorType:'owner',actorId:id(99),name:role.name,description:'',permissions:input().permissions,accessScope:'all',allowedBoardIds:[]}),/enterprise_version_conflict/);
  assert.deepEqual(roleProbe.transport.calls[0].input,{p_input:{...input(),expected_version:7}});
  assert.deepEqual(roleProbe.transport.errors,[]);
});

test('scope adapter allows structurally valid pair negatives through SQL but rejects mixed read/write, foreign IDs and malformed grant shapes',async()=>{
  const h=fixture();
  for(const [workerId,locationId] of [[id(201),id(301)],[id(201),id(302)],[id(202),id(301)],[id(202),id(302)]]){
    const args={...recordArgs(),p_query:{...recordQuery(),workerId,locationId}};
    assert.deepEqual(await h.transport.rpc(recordName,args),{data:{opaque:true},error:null});
  }
  await h.transport.rpc(scopeName,{...scopeArgs(),p_auth_user_id:id(1)});
  await h.transport.rpc(scopeName,{...scopeArgs(),p_command:{...put(),action:'remove',grant:null}});
  const bad=[{...scopeArgs(),p_employee_id:id(102)},{...scopeArgs(),p_command:put(),p_operation_id:id(901)},
    {...scopeArgs(),p_command:{...put(),expectedRevision:'0'}},{...scopeArgs(),p_command:{...put(),extra:true}},
    {...scopeArgs(),p_command:{...put(),grant:{...put().grant,workerIds:[id(999)]}}},
    {...scopeArgs(),p_command:{...put(),grant:{...put().grant,locationIds:[id(999)]}}},
    {...scopeArgs(),p_command:{...put(),grant:{...put().grant,workerIds:[id(201),id(201)]}}},
    {...scopeArgs(),p_command:{...put(),grant:{...put().grant,validUntil:'2026-01-01T00:00:00.000Z'}}},
    {...scopeArgs(),p_command:{...put(),action:'remove'}},{...scopeArgs(),p_operation_id:false},
    {...scopeArgs(),p_command:false},{...scopeArgs(),p_command:put(),extra:null}];
  for(const args of bad)await assert.rejects(h.transport.rpc(scopeName,args),/supervisor_access_rpc_forbidden/);
  assert.equal(h.business().length,6,'no negative shape reaches a SQL statement');
});

test('records and choice requests retain exact closed types and microsecond cursor semantics',async()=>{
  const h=fixture();
  const cursor={...recordQuery(),asOf:'2026-10-03T01:00:00.000000Z',cursorAt:'2026-10-02T12:00:00.000123Z',cursorId:id(1001)};
  await h.transport.rpc(recordName,{...recordArgs(),p_query:cursor});
  await h.transport.rpc(choiceName,{...choiceArgs(),p_query:{kind:'managers',search:'合成',cursor:null}});
  await h.transport.rpc(choiceName,{...choiceArgs(),p_query:{kind:'workers',ids:[id(201),id(202)]}});
  const badRecords=[{...recordQuery(),extra:null},{...recordQuery(),fromAt:false},
    {...recordQuery(),toAt:'2026-12-03T00:00:00.000000Z'},{...recordQuery(),fromAt:'2026-02-30T00:00:00.000000Z'},
    {...recordQuery(),workerId:id(999)},{...recordQuery(),locationId:id(999)},
    {...recordQuery(),cursorId:id(1001)},{...cursor,asOf:null},{...cursor,cursorAt:'2026-10-03T01:00:00.000000Z'},
    {...recordQuery(),access:'self'},{...recordQuery(),cursorAt:undefined}];
  for(const p_query of badRecords)await assert.rejects(h.transport.rpc(recordName,{...recordArgs(),p_query}),/supervisor_access_rpc_forbidden/);
  const badChoices=[{kind:'workers',search:'',cursor:null,ids:[id(201)]},{kind:'employees',search:'',cursor:null},
    {kind:'workers',ids:[]},{kind:'workers',ids:[id(201),id(201)]},{kind:'workers',ids:[id(999)]},
    {kind:'managers',ids:[id(201)]},{kind:'workers',ids:[id(202),id(201)]},
    {kind:'workers',search:' padded ',cursor:null},{kind:'workers',search:true,cursor:null},
    {kind:'workers',search:'',cursor:id(999)}];
  for(const p_query of badChoices)await assert.rejects(h.transport.rpc(choiceName,{...choiceArgs(),p_query}),/supervisor_access_rpc_forbidden/);
  for(const args of [{...recordArgs(),p_site_id:'99990002'},{...recordArgs(),p_auth_user_id:id(2)},
    {...recordArgs(),p_auth_user_id:null},{...recordArgs(),p_query:null},{...recordArgs(),p_allow_write:true}])
    await assert.rejects(h.transport.rpc(recordName,args),/supervisor_access_rpc_forbidden/);
  await assert.rejects(h.transport.rpc('faolla_attendance_admin_v1',{}),/supervisor_access_rpc_forbidden/);
  assert.equal(h.business().length,3);
});

test('typed business errors remain exact, while untrusted SQL failures, role mismatch and changed ownership are closed and redacted',async()=>{
  for(const message of ['ERROR: attendance_access_denied suffix\nprivate-value','ERROR: unexpected_secret\nprivate-value','private-value']){
    const h=fixture({reply:()=>{throw Error(message);}});
    await assert.rejects(h.transport.rpc(recordName,recordArgs()),/^Error: supervisor_access_rpc_failed$/);
    assert.deepEqual(h.transport.errors,['supervisor_access_rpc_failed']);assert(!JSON.stringify(h.transport.calls).includes('private-value'));
  }
  const wrongRole=fixture({reply:()=>JSON.stringify({role:'postgres',data:{opaque:true}})});
  await assert.rejects(wrongRole.transport.rpc(recordName,recordArgs()),/supervisor_access_rpc_failed/);
  const changed=fixture();changed.setOwned({...owned,oid:987});
  await assert.rejects(changed.transport.rpc(recordName,recordArgs()),/supervisor_access_rpc_failed/);
  assert.equal(changed.business().length,0);
  assert.throws(()=>validateSupervisorAccessRpcInput(roleName,{p_input:input()},{...role,access_scope:'restricted'}));
});

test('actual overview reader is reused with fixed synthetic subjects and SQL-only readonly role/bootstrap queries',async()=>{
  const h=fixture({readRows:[{system_key:'employee'}]});
  const url=new URL('https://attendance-auth.invalid/rest/v1/merchant_enterprise_roles');
  for(const [key,value] of Object.entries({select:'system_key',merchant_id:'eq.99990001',system_key:'in.(administrator,supervisor,employee)'}))url.searchParams.set(key,value);
  const headers={apikey:'attendance-synthetic-service',authorization:'Bearer attendance-synthetic-service'};
  assert.deepEqual(await h.transport.read(new Request(url,{headers})).json(),[{system_key:'employee'}]);
  const source=h.queries.at(-1);assert.match(source,/^begin read only;reset role;do \$owned\$/);
  assert.match(source,/set local role service_role/);assert.match(source,/merchant_id='99990001'/);assert.match(source,/rollback;$/);
  url.searchParams.set('merchant_id','eq.99990002');
  assert.throws(()=>h.transport.read(new Request(url,{headers})),/^Error: employee_management_read_forbidden$/);
  assert.throws(()=>h.transport.read(new Request('https://external.invalid/rest/v1/merchant_enterprise_roles',{headers})),/employee_management_read_forbidden/);
  assert.throws(()=>h.transport.read(new Request(url,{method:'POST',headers})),/employee_management_read_forbidden/);
});

test('facts include actual scope pair mappings and the protected oracle covers all remaining tables with catalog identity checks',()=>{
  const h=fixture(),oracles=createSupervisorAccessOracles(h.exec,owned);
  assert.deepEqual(Object.keys(oracles.facts()).sort(),['audits','grants','roles','scopeOperations','scopes']);
  const factsSql=h.queries.at(-1);assert.match(factsSql,/merchant_attendance_scope_workers w/);assert.match(factsSql,/merchant_attendance_scope_locations l/);
  assert.match(factsSql,/w\.merchant_id=g\.merchant_id and w\.employee_id=g\.employee_id and w\.grant_id=g\.id/);
  assert.match(factsSql,/l\.merchant_id=g\.merchant_id and l\.employee_id=g\.employee_id and l\.grant_id=g\.id/);
  assert.equal(oracles.protectedFingerprint(),'opaque-fingerprint');
  for(const name of ['merchant_attendance_events','merchant_enterprise_employees','merchant_attendance_settings','merchant_attendance_workers',
    'merchant_attendance_locations','merchant_task_boards','merchant_task_columns','merchant_tasks','merchant_enterprise_role_boards','faolla_schema_migrations'])
    assert(oracles.protectedTables.includes(name));
  for(const name of ['merchant_enterprise_roles','merchant_enterprise_audit_events','merchant_attendance_scope_grants',
    'merchant_attendance_scope_workers','merchant_attendance_scope_locations','merchant_attendance_scope_operations'])assert(!oracles.protectedTables.includes(name));
  h.setCatalog(tables.map((name,index)=>({name,oid:index===0?9999:1000+index})));
  assert.throws(()=>oracles.protectedFingerprint(),/supervisor_access_table_catalog_changed/);
  const source=readFileSync(new URL('./merchant-attendance-supervisor-access-fixture.mjs',import.meta.url),'utf8');
  const prepare=source.slice(source.indexOf('export async function prepareAttendanceSupervisorAccessFixture'));
  assert(prepare.indexOf('exec(plan.seedSql)')<prepare.indexOf('await prepareAttendanceEmployeeManagement'));
  assert(prepare.indexOf('await prepareAttendanceEmployeeManagement')<prepare.indexOf('exec(plan.workspaceSql)'));
  assert(prepare.indexOf('exec(plan.workspaceSql)')<prepare.indexOf('await prepareAttendanceRoleManagement'));
  assert.match(prepare,/supervisor_access_fresh_namespace_required/);assert.match(prepare,/supervisor_access_empty_authorization_prestate_required/);
  assert.doesNotMatch(source,/disable trigger|session_replication_role|grant .* to service_role|child_process|create database|drop schema/i);
});
