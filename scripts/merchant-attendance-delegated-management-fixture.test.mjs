// Construction/adapter tests only. Opaque fake SQL output is never an assertion
// that a delegated update or any attendance business operation succeeded.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import test from 'node:test';
import {delegatedManagementPlan,createAttendanceDelegatedManagementTransport,redactDelegatedManagementDiagnostics} from './merchant-attendance-delegated-management-fixture.mjs';
import {qualifyAttendanceSandbox} from './merchant-attendance-concurrency-sandbox.mjs';
import {lifecycleId as id} from './merchant-attendance-lifecycle-native-support.mjs';

const require=createRequire(import.meta.url);
const {updateMerchantEnterpriseRole,updateMerchantEnterpriseEmployee}=require('../src/lib/merchantEnterpriseStore.server.ts');
const plan=delegatedManagementPlan(),c=plan.consts;
const owned={schema:'attendance_race_'+'b'.repeat(32),oid:123,tableOid:456,owner:'postgres',
  marker:'faolla-synthetic-concurrency:12345678-1234-1234-1234-123456789abc'};
const names={role:'faolla_update_merchant_enterprise_role_v3',employee:'faolla_update_merchant_enterprise_employee_v1'};
const core={merchant_id:c.site,expected_version:2,actor_type:'employee',actor_id:c.delegateEmployeeId};
const roleInput={...core,role_id:c.roles.target,name:c.labels.targetRole,description:'',permissions:[...c.permissions.target],access_scope:'restricted',allowed_board_ids:[c.boards.a]};
const employeeInput={...core,employee_id:c.employeeId,status:'disabled',offboarding_mode:'unassign'};
const marker={opaqueDatabaseMarker:'not-a-business-result'};
function fixture(respond=()=>JSON.stringify({role:'service_role',data:marker})){
  const statements=[];
  const transport=createAttendanceDelegatedManagementTransport(statement=>{
    if(statement.startsWith('reset role;select jsonb_build_object'))return JSON.stringify(owned);
    statements.push(statement);return respond(statement);
  });
  return {...transport,statements};
}

test('plan has fixed distinct auth/employee identities, exact seven delegate permissions, and frozen fixture constants',()=>{
  assert.equal(c.site,'99990001');assert.equal(c.ownerAuthId,id(99));assert.equal(c.delegateAuthId,id(2));assert.equal(c.delegateEmployeeId,id(102));
  assert.notEqual(c.delegateAuthId,c.delegateEmployeeId);assert.deepEqual(c.roles,{target:id(30),delegate:id(31),system:id(32),outside:id(33)});
  assert.deepEqual(c.boards,{a:id(401),b:id(402)});
  assert.deepEqual(c.permissions.delegate,['enterprise.view','roles.view','roles.manage','employees.view','employees.manage','attendance.self.view','attendance.self.clock']);
  assert.equal(c.labels.delegateEmployee,'合成委托主管');assert.equal(c.labels.outsideEmployee,'合成范围外员工');
  assert(Object.isFrozen(c));assert(Object.isFrozen(c.roles));assert(Object.isFrozen(c.permissions.delegate));
  assert.throws(()=>c.permissions.delegate.push('orders.view'),TypeError);
  assert.deepEqual(delegatedManagementPlan(),plan);
});

test('identity seed is bounded to new synthetic identities before audit preparation, with null-auth employee invited rather than invalid active',()=>{
  const sql=plan.identitiesSql;
  assert.match(sql,/attendance_race_\[a-f0-9\]/);assert.match(sql,/faolla-synthetic-concurrency/);assert.match(sql,/nspowner::regrole::text='postgres'/);
  assert(sql.includes("where id='99990001' and user_id='"+c.ownerAuthId+"'"));
  assert.match(sql,/to_regclass\('public\.merchant_enterprise_audit_events'\) is not null/);
  assert.match(sql,/initial_identities_required/);
  assert.equal((sql.match(/insert into public\.merchant_enterprise_roles/g)??[]).length,1);
  assert.equal((sql.match(/insert into public\.merchant_enterprise_employees/g)??[]).length,1);
  assert.equal((sql.match(/update public\.merchant_enterprise_roles/g)??[]).length,2);
  assert(sql.includes("where merchant_id='99990001' and id='"+c.roles.delegate+"'"));
  assert(sql.includes("where merchant_id='99990001' and id='"+c.roles.system+"'"));
  assert(sql.includes("('"+c.outsideEmployeeId+"','99990001',null,'outside-delegated@example.test','合成范围外员工','"+c.roles.outside+"','invited',null)"));
  assert(sql.includes("'"+c.delegateAuthId+"','employee-b@example.test','合成委托主管','"+c.roles.delegate+"','active',now()"));
  assert.doesNotMatch(sql,/merchant_attendance_|delete from|on conflict|disable trigger|version\s*=|commit;/i);
});

test('workspace seed follows existing employee preparation but precedes role audit; exactly two boards, four default columns and A/B mappings',()=>{
  const sql=plan.workspaceSql;
  assert.match(sql,/empty_workspace_required/);assert.match(sql,/exists\(select 1 from public\.merchant_task_assignees\)/);
  assert.match(sql,/exists\(select 1 from public\.merchant_enterprise_audit_events\)/);assert.match(sql,/tgname='merchant_enterprise_roles_audit'/);
  assert.match(sql,/access_scope<>'all'/);assert.match(sql,/set access_scope='restricted'/);
  assert(sql.includes("id in ('"+c.roles.target+"','"+c.roles.outside+"')"),'delegate initial all scope is not changed by seed');
  assert(sql.includes("('"+c.boards.a+"','99990001','合成默认看板','default',0)"));
  assert(sql.includes("('"+c.boards.b+"','99990001','合成范围外看板',null,1)"));
  for(let n=0;n<4;n++)assert(sql.includes(id(410+n)));
  assert(sql.includes("('99990001','"+c.roles.target+"','"+c.boards.a+"')"));
  assert(sql.includes("('99990001','"+c.roles.outside+"','"+c.boards.b+"')"));
  for(const source of [sql,plan.identitiesSql]){
    assert.doesNotMatch(source,/create (?:table|function|schema)|grant |revoke |insert into public\.merchant_tasks\b|insert into public\.merchant_task_assignees|merchant_attendance_|disable trigger|set_config|version\s*=|commit;/i);
    assert.doesNotMatch(qualifyAttendanceSandbox(source,owned.schema),/\bpublic\./);
  }
});

test('adapter requires owned namespace before use and exposes only the current two RPCs with service-role execution and exact OID rechecks',async()=>{
  for(const change of [{schema:'public'},{owner:'service_role'},{oid:0},{tableOid:0},{marker:'foreign'}])
    assert.throws(()=>createAttendanceDelegatedManagementTransport(()=>JSON.stringify({...owned,...change})),/lifecycle_owned_schema_required/);
  const f=fixture();assert.deepEqual(f.rpcNames,Object.values(names));assert(Object.isFrozen(f.rpcNames));assert.equal(f.service.rpc,f.rpc);
  assert.deepEqual(await f.rpc(names.role,{p_input:roleInput}),{data:marker,error:null});
  assert.deepEqual(await f.rpc(names.employee,{p_input:employeeInput}),{data:marker,error:null});
  assert.equal(f.calls.length,2);assert.equal(f.statements.length,2);
  for(const sql of f.statements){assert(sql.includes('c.oid=456 and n.oid=123'));assert(sql.includes(owned.marker));
    assert.match(sql,/begin;reset role;/);assert.match(sql,/set local role service_role;/);assert.match(sql,/'role',current_user,'data'/);assert(sql.endsWith('commit;'));}
  for(const name of ['constructor','faolla_update_merchant_enterprise_role_v2','faolla_update_merchant_enterprise_role_v1',
    'faolla_attendance_self_v1','faolla_attendance_scope_v1','faolla_update_merchant_enterprise_employee_v1;drop table x'])
    await assert.rejects(f.rpc(name,{p_input:roleInput}),/^Error: delegated_management_invalid_rpc_arguments$/);
  assert.equal(f.statements.length,2);
});

test('structurally valid current/next scope violations, self/system targets and missing permission dependencies reach real SQL, never simulated authorization',async()=>{
  const f=fixture(()=>{throw Error('ERROR: permission_escalation_denied\nCONTEXT: synthetic SQL denial');});
  const roleCases=[{...roleInput,role_id:c.roles.delegate},{...roleInput,role_id:c.roles.system},{...roleInput,role_id:c.roles.outside},
    {...roleInput,access_scope:'all',allowed_board_ids:[]},{...roleInput,allowed_board_ids:[c.boards.b]},
    {...roleInput,allowed_board_ids:[c.boards.a,c.boards.b]},
    {...roleInput,permissions:['attendance.self.clock']},
    ...['attendance.self.request','attendance.records.view','tasks.view'].map(permission=>({...roleInput,permissions:[...c.permissions.target,permission]}))];
  for(const input of roleCases)assert.deepEqual(await f.rpc(names.role,{p_input:input}),{data:null,error:{message:'permission_escalation_denied'}});
  for(const employee_id of [c.employeeId,c.delegateEmployeeId,c.outsideEmployeeId])
    assert.deepEqual(await f.rpc(names.employee,{p_input:{...employeeInput,employee_id}}),{data:null,error:{message:'permission_escalation_denied'}});
  const ownerInput={...roleInput,role_id:c.roles.delegate,actor_type:'owner',actor_id:c.ownerAuthId};
  assert.deepEqual(await f.rpc(names.role,{p_input:ownerInput}),{data:null,error:{message:'permission_escalation_denied'}});
  assert.equal(f.calls.length,roleCases.length+4);assert.equal(f.statements.length,f.calls.length);assert.deepEqual(f.errors,[]);
});

test('unknown fields, actors, identifiers, booleans, versions, permissions, scope shapes and unsupported employee workflows stop before SQL',async()=>{
  const f=fixture(),invalid=[{...roleInput,merchant_id:'99990002'},{...roleInput,actor_type:'system'},
    {...roleInput,actor_id:c.delegateAuthId},{...roleInput,actor_id:c.employeeId},{...roleInput,actor_type:'owner',actor_id:c.delegateEmployeeId},
    {...roleInput,role_id:id(999)},{...roleInput,expected_version:'2'},{...roleInput,expected_version:false},{...roleInput,expected_version:0},
    {...roleInput,expected_version:Number.MAX_SAFE_INTEGER+1},{...roleInput,unexpected:true},Object.assign(Object.create({parent:true}),roleInput),
    {...roleInput,permissions:['orders.view']},{...roleInput,permissions:['enterprise.view','enterprise.view']},{...roleInput,permissions:null},
    {...roleInput,allowed_board_ids:[id(499)]},{...roleInput,allowed_board_ids:[c.boards.a,c.boards.a]},
    {...roleInput,access_scope:'all'},{...roleInput,status:'disabled'},{...roleInput,name:' x '},{...roleInput,description:'x'.repeat(1001)}];
  const missing={...roleInput};delete missing.allowed_board_ids;invalid.push(missing);
  for(const input of invalid)await assert.rejects(f.rpc(names.role,{p_input:input}),/^Error: delegated_management_invalid_rpc_arguments$/);
  for(const input of [{...employeeInput,employee_id:id(104)},{...employeeInput,role_id:c.roles.target},{...employeeInput,status:'invited'},
    {...employeeInput,offboarding_mode:'reassign'},{...employeeInput,status:'active'},{...employeeInput,replacement_employee_id:c.delegateEmployeeId}])
    await assert.rejects(f.rpc(names.employee,{p_input:input}),/^Error: delegated_management_invalid_rpc_arguments$/);
  await assert.rejects(f.rpc(names.role,{p_input:roleInput,actor_type:'owner'}),/^Error: delegated_management_invalid_rpc_arguments$/);
  await assert.rejects(f.rpc(names.role,{p_input:{...core,role_id:c.roles.target}}),/^Error: delegated_management_invalid_rpc_arguments$/);
  assert.equal(f.statements.length,0);assert.deepEqual(f.calls,[]);assert.deepEqual(f.errors,[]);
});

test('known SQL denials are typed, opaque successful SQL output is passed unchanged, unknown failures never echo driver diagnostics',async()=>{
  for(const code of ['permission_denied','enterprise_version_conflict','role_board_access_in_use','invalid_permissions','employee_not_found','employee_open_tasks_require_resolution']){
    const f=fixture(()=>{throw Error('ERROR: '+code+'\nCONTEXT: Synthetic-attendance-only!');});
    assert.deepEqual(await f.rpc(names.role,{p_input:roleInput}),{data:null,error:{message:code}});assert.deepEqual(f.errors,[]);
  }
  for(const respond of [()=>{throw Error('ERROR: unknown_sensitive_diagnostic Synthetic-attendance-only!');},
    ()=>JSON.stringify({role:'postgres',data:marker}),()=>JSON.stringify({role:'service_role',data:marker,extra:true})]){
    const f=fixture(respond);assert.deepEqual(await f.rpc(names.employee,{p_input:employeeInput}),{data:null,error:{message:'enterprise_store_unavailable'}});
    assert.deepEqual(f.errors,['delegated_management_sql_failure']);assert(!JSON.stringify(f.errors).includes('Synthetic-attendance-only!'));
  }
  const f=fixture(),input=structuredClone(roleInput);await f.rpc(names.role,{p_input:input});input.permissions.pop();input.name='changed';
  assert.deepEqual(f.calls[0],{name:names.role,input:roleInput},'log is a detached safe input, not a fabricated result');
});

test('SQL uses fixed allowlisted identifiers and quoted JSON literals; supplied metadata cannot escape the SQL value',async()=>{
  const f=fixture(),name="Synthetic '); select pg_sleep(9); --";
  await f.rpc(names.role,{p_input:{...core,role_id:c.roles.target,name}});
  assert(f.statements[0].includes('public.'+names.role+'('));
  assert(f.statements[0].includes('"name":"Synthetic \'\'); select pg_sleep(9); --"'));
  assert(f.statements[0].includes("}'::jsonb));commit;"));assert.equal(f.calls[0].input.name,name);
});

test('actual default stores preserve trusted employee actor, expected versions and snake-case scope/offboarding protocol into real-SQL denial probes',async()=>{
  const f=fixture(()=>{throw Error('ERROR: permission_escalation_denied');});
  await assert.rejects(updateMerchantEnterpriseRole(f.service,{siteId:c.site,roleId:c.roles.target,version:2,
    name:c.labels.targetRole,description:'',permissions:c.permissions.target,accessScope:'restricted',allowedBoardIds:[c.boards.a],
    actorType:'employee',actorId:c.delegateEmployeeId}),/^Error: permission_escalation_denied$/);
  assert.deepEqual(f.calls[0],{name:names.role,input:roleInput});
  await assert.rejects(updateMerchantEnterpriseEmployee(f.service,{siteId:c.site,employeeId:c.employeeId,version:2,status:'disabled',offboardingMode:'unassign',
    actorType:'employee',actorId:c.delegateEmployeeId}),/^Error: permission_escalation_denied$/);
  assert.deepEqual(f.calls[1],{name:names.employee,input:employeeInput});assert.equal(f.statements.length,2);
  assert.equal(f.calls.every(call=>call.input.actor_id!==c.delegateAuthId),true,'employee actor is employee ID, never Auth UUID');
});

test('diagnostics remove the exact synthetic SDK password and JWT from fill errors while retaining useful failure text',()=>{
  const jwt='eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJzeW50aGV0aWMifQ.'+'Q'.repeat(43);
  const error=new Error('locator.fill: Timeout 12000ms exceeded');
  error.stack+='\nCall log: fill("Synthetic-attendance-only!")\nAuthorization Bearer '+jwt;
  const safe=redactDelegatedManagementDiagnostics(error);
  assert(!safe.includes('Synthetic-attendance-only!'));assert(!safe.includes(jwt));assert(!safe.includes('eyJ'));
  assert(safe.includes('locator.fill: Timeout 12000ms exceeded'));assert(safe.includes('[synthetic-password-redacted]'));assert(safe.includes('[jwt-redacted]'));
  assert.equal(redactDelegatedManagementDiagnostics(safe),safe);
  const source=readFileSync(new URL('./merchant-attendance-delegated-management-fixture.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(source,/child_process|spawn\(|DATABASE_URL|create schema|drop schema|readFileSync|setTimeout|disable trigger/i);
});
