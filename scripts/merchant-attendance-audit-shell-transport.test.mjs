import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import test from 'node:test';

const require=createRequire(import.meta.url);
const {createAttendanceAuditShellTransport,databaseId:id,databaseActors:actors}=require('./fixtures/attendance-audit-shell-transport.ts');
const identity={p_site_id:'99990001',p_auth_user_id:actors[0].id};
const range={source:'config',fromAt:'2026-10-01T00:00:00.000000Z',toAt:'2026-10-02T00:00:00.000000Z'};
const queryArgs=query=>({...identity,p_query:query});
function fixture(){
  const statements=[];
  const transport=createAttendanceAuditShellTransport(sql=>{statements.push(sql);return JSON.stringify({role:'service_role',data:{syntheticSqlResult:true}});});
  return {transport,statements};
}

test('audit shell transport accepts actual audit list/detail and export signatures without fabricating their data',async()=>{
  const {transport,statements}=fixture();
  for(const [name,query] of [
    ['faolla_attendance_audit_v1',{...range,mode:'list',asOf:null,cursorAt:null,cursorId:null}],
    ['faolla_attendance_audit_v1',{mode:'detail',source:'scope',operationId:id(510)}],
    ['faolla_attendance_audit_export_v1',range],
  ]){
    assert.deepEqual(await transport.rpc(name,queryArgs(query)),{data:{syntheticSqlResult:true},error:null});
    assert.deepEqual(transport.calls.at(-1).query,query);
    assert(statements.at(-1).startsWith("set standard_conforming_strings=on;set role service_role;select jsonb_build_object('role',current_user,'data',public."+name+'('));
  }
  assert.equal(statements.length,3);
  assert.deepEqual(transport.errors,[]);
});

test('only known SQL function names, tenant and synthetic principals reach exec',async()=>{
  const {transport,statements}=fixture();
  for(const name of ['constructor','toString','__proto__','faolla_attendance_scope_v1','faolla_attendance_choice_labels_v1',"faolla_attendance_audit_v1);drop table merchants;--"])
    await assert.rejects(transport.rpc(name,queryArgs(range)),/unexpected_rpc/);
  for(const patch of [{p_site_id:'10000000'},{p_site_id:"99990001';select 1;--"},{p_auth_user_id:id(999)},{p_auth_user_id:null}])
    await assert.rejects(transport.rpc('faolla_attendance_audit_export_v1',{...queryArgs(range),...patch}),/invalid_site|invalid_actor/);
  assert.equal(statements.length,0);assert.equal(transport.calls.length,0);
});

test('unexpected or lossy RPC shapes cannot silently become a different SQL request',async()=>{
  const {transport,statements}=fixture();
  for(const args of [
    {...queryArgs(range),p_owner_id:actors[0].id},
    {p_site_id:identity.p_site_id,p_query:range},
    queryArgs({...range,limit:1000}),queryArgs(null),queryArgs([]),
    queryArgs({...range,fromAt:undefined}),queryArgs({...range,toAt:NaN}),
  ])await assert.rejects(transport.rpc('faolla_attendance_audit_export_v1',args));
  assert.equal(statements.length,0);assert.equal(transport.calls.length,0);
});

test('choice lookup and selected-label reads share actual choices RPC and safely quote data',async()=>{
  const {transport,statements}=fixture();
  const text="门店'\\; select 'not SQL'";
  await transport.rpc('faolla_attendance_choices_v1',queryArgs({kind:'workers',search:text,cursor:null}));
  assert(statements[0].includes(JSON.stringify({kind:'workers',search:text,cursor:null}).replaceAll("'","''")));
  assert.equal(transport.calls[0].query.search,text);
  const query={kind:'locations',ids:[id(301)]};
  await transport.rpc('faolla_attendance_choices_v1',queryArgs(query));
  query.ids.push(id(302));
  assert.deepEqual(transport.calls[1].query,{kind:'locations',ids:[id(301)]});
  await assert.rejects(transport.rpc('faolla_attendance_choices_v1',queryArgs({kind:'workers',ids:[],search:'',cursor:null})),/invalid_query/);
  assert.equal(statements.length,2);
});

test('scope read/put/remove signatures preserve exact receipt identities and detached command snapshots',async()=>{
  const {transport,statements}=fixture();
  const args={...identity,p_employee_id:id(101),p_command:null,p_operation_id:null};
  await transport.rpc('faolla_attendance_scopes_v1',args);
  const put={operationId:id(600),expectedRevision:0,action:'put',grantId:id(601),
    grant:{workerIds:[id(201)],locationIds:[id(301)],validFrom:range.fromAt,validUntil:null}};
  await transport.rpc('faolla_attendance_scopes_v1',{...args,p_command:put});
  put.grant.workerIds.push(id(202));
  assert.deepEqual(transport.calls[1].command.grant.workerIds,[id(201)]);
  assert.equal(transport.calls[1].operationId,id(600));assert.equal(transport.calls[1].employeeId,id(101));
  await transport.rpc('faolla_attendance_scopes_v1',{...args,p_command:{...put,operationId:id(602),expectedRevision:1,action:'remove',grant:null}});
  await transport.rpc('faolla_attendance_scopes_v1',{...args,p_operation_id:id(602)});
  assert.equal(transport.calls[3].operationId,id(602));
  for(const patch of [{p_employee_id:"x';select 1"},{p_operation_id:'invalid'},{p_command:{...put,extra:true}},
    {p_command:{...put,action:'remove'}},{p_command:{...put,grant:{...put.grant,extra:true}}}])
    await assert.rejects(transport.rpc('faolla_attendance_scopes_v1',{...args,...patch}),/invalid_/);
  assert.equal(statements.length,4);
});

test('original admin/self/history RPC behavior remains delegated and recorded',async()=>{
  const {transport,statements}=fixture();
  for(const [name,args] of [
    ['faolla_attendance_admin_v1',{...identity,p_query:{view:'settings',cursor:null,search:''},p_command:null,p_operation_id:null}],
    ['faolla_attendance_self_v1',{...identity,p_auth_user_id:actors[1].id,p_command:null,p_operation_id:null}],
    ['faolla_attendance_self_history_v1',queryArgs({fromAt:range.fromAt,toAt:range.toAt,expectedWorkerId:null,asOf:null,cursorAt:null,cursorId:null})],
  ])assert.deepEqual(await transport.rpc(name,args),{data:{syntheticSqlResult:true},error:null});
  assert.equal(statements.length,3);assert.equal(transport.calls.length,3);
  assert.equal(transport.calls[1].actor,actors[1].id);assert.equal(transport.state.moduleEnabled,true);
});

test('expected SQL permission errors are forwarded, not converted into successful synthetic replies',async()=>{
  const transport=createAttendanceAuditShellTransport(()=>{throw Error('ERROR: attendance_access_denied\nCONTEXT: isolated fixture');});
  assert.deepEqual(await transport.rpc('faolla_attendance_audit_export_v1',queryArgs(range)),{data:null,error:{message:'attendance_access_denied'}});
  assert.equal(transport.calls.length,1);assert.deepEqual(transport.errors,[]);
});

test('wrong database role, malformed reply and unclassified SQL failures fail loudly',async()=>{
  for(const reply of [JSON.stringify({role:'postgres',data:{}}),JSON.stringify({role:'service_role'}),'not-json']){
    const transport=createAttendanceAuditShellTransport(()=>reply);
    await assert.rejects(transport.rpc('faolla_attendance_audit_export_v1',queryArgs(range)));
    assert.equal(transport.errors.length,1);
  }
  const transport=createAttendanceAuditShellTransport(()=>{throw Error('ERROR: unexpected fixture schema');});
  await assert.rejects(transport.rpc('faolla_attendance_audit_export_v1',queryArgs(range)),/unexpected fixture schema/);
  assert.equal(transport.errors.length,1);
});

test('controls opt-in transport uses only current v2 executor signature and captures readonly recovery queries',async()=>{
  const {transport,statements}=fixture();
  const args={...identity,p_command:null,p_operation_id:id(701),p_before_revision:25,p_allow_write:false};
  assert.deepEqual(await transport.rpc('faolla_attendance_correction_controls_v2',args),{data:{syntheticSqlResult:true},error:null});
  assert.equal(transport.calls[0].operationId,id(701));
  assert.deepEqual(transport.calls[0].query,{operationId:id(701),beforeRevision:25});
  assert.equal(transport.calls[0].allowWrite,false);
  assert(statements[0].includes("public.faolla_attendance_correction_controls_v2("));
  assert(statements[0].includes("'25',false)"));
  await assert.rejects(transport.rpc('faolla_attendance_correction_controls_v1',args),/unexpected_rpc/);
  assert.equal(statements.length,1);
});

test('controls setting/lock/unlock commands retain original operation identity and values',async()=>{
  const {transport,statements}=fixture();
  const base={operationId:id(702),expectedRevision:0,expectedSettingsVersion:1,reason:"合成'理由"};
  const commands=[{...base,action:'set_policy',submissionWindowDays:7},
    {...base,operationId:id(703),expectedRevision:1,action:'lock_period',fromDate:'2026-03-28',throughDate:'2026-03-29'},
    {...base,operationId:id(704),expectedRevision:2,action:'unlock_period',periodId:id(703)}];
  for(const command of commands){
    await transport.rpc('faolla_attendance_correction_controls_v2',{...identity,p_command:command,p_operation_id:null,p_before_revision:null,p_allow_write:true});
    assert.deepEqual(transport.calls.at(-1).command,command);
    assert.equal(transport.calls.at(-1).operationId,command.operationId);
    assert.equal(transport.calls.at(-1).allowWrite,true);
  }
  commands[0].reason='later';assert.equal(transport.calls[0].command.reason,"合成'理由");
  assert(statements[0].includes("合成''理由"));assert.equal(statements.length,3);
});

test('controls adapter rejects permission coercion, malformed cursors, unknown fields and mixed write/read commands before SQL',async()=>{
  const {transport,statements}=fixture();
  const args={...identity,p_command:null,p_operation_id:null,p_before_revision:null,p_allow_write:true};
  const command={operationId:id(705),expectedRevision:0,expectedSettingsVersion:1,reason:'synthetic',action:'set_policy',submissionWindowDays:7};
  const invalid=[{p_allow_write:'true'},{p_allow_write:1},{p_allow_write:null},{p_before_revision:0},{p_before_revision:1.5},
    {p_before_revision:Number.MAX_SAFE_INTEGER+1},{p_before_revision:Number.MAX_SAFE_INTEGER},{p_before_revision:Number.MAX_SAFE_INTEGER-1},
    {p_before_revision:'25'},{p_command:{}},
    {p_command:{...command,actor:actors[1].id}},{p_command:{...command,action:'approve'}},
    {p_command:command,p_operation_id:id(705)},{p_command:command,p_before_revision:1},
    {p_command:{...command,submissionWindowDays:undefined}}];
  for(const patch of invalid)await assert.rejects(transport.rpc('faolla_attendance_correction_controls_v2',{...args,...patch}));
  assert.equal(statements.length,0);assert.equal(transport.calls.length,0);
});

test('controls browser opt-in refuses missing merchant shell or conflicting fixture flags before any build/server',()=>{
  for(const [flags,error] of [
    [['--controls','--check-only'],'attendance_controls_require_merchant_shell'],
    [['--merchant-shell','--controls','--schedule','--check-only'],'attendance_controls_conflicting_entry_flags'],
  ]){
    const result=spawnSync(process.execPath,['scripts/attendance-self-browser-harness.mjs',...flags],
      {cwd:new URL('..',import.meta.url),encoding:'utf8',windowsHide:true,shell:false,timeout:10000,maxBuffer:32768});
    assert.equal(result.error,undefined);assert.equal(result.status,1);assert(result.stderr.includes(error));
    assert(!result.stdout.includes('inMemoryBundle'));assert(!result.stdout.includes('Attendance synthetic component QA'));
  }
});
