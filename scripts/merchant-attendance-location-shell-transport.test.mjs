import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import test from 'node:test';

const require=createRequire(import.meta.url);
const {createAttendanceAuditShellTransport,databaseId:id,databaseActors:actors}=require('./fixtures/attendance-audit-shell-transport.ts');
const identity={p_site_id:'99990001',p_auth_user_id:actors[0].id};
const names={policy:'faolla_attendance_location_policy_draft_v1',setup:'faolla_attendance_location_setup_v1',notice:'faolla_attendance_location_notice_v1'};
const values={purpose:"合成'用途",notice:'合成公开说明',contact:'合成管理员',alternative:'人工核查',retentionDays:90,latitude:37.3,longitude:-5.9,radiusMeters:100};
const query={access:'owner',locationId:id(301),expectedWorkerId:null,operationId:null};
const args={
  policy:{...identity,p_location_id:id(301),p_command:null,p_operation_id:null,p_allow_write:false},
  setup:{...identity,p_location_id:id(301),p_command:null,p_operation_id:null,p_allow_prepare:false},
  notice:{...identity,p_query:query,p_command:null,p_allow_publish:false},
};
const commands={
  policy:{operationId:id(801),expectedRevision:0,expectedSettingsVersion:2,expectedLocationVersion:1,values},
  setup:{action:'prepare',operationId:id(802),expectedSettingsVersion:2,expectedLocationVersion:1,expectedChannelVersion:1,draftRevision:1,reason:'合成应用围栏'},
  notice:{action:'publish',operationId:id(803),expectedRevision:0,draftRevision:2,expectedSettingsVersion:2,expectedLocationVersion:2,reason:'合成公开告知'},
};
function fixture(){
  const statements=[];
  const transport=createAttendanceAuditShellTransport(sql=>{statements.push(sql);return JSON.stringify({role:'service_role',data:{syntheticSqlResult:true}});});
  return {transport,statements};
}

test('owner location fixture preserves actual three RPC signatures, query identity and unquoted boolean gates',async()=>{
  const {transport,statements}=fixture();
  for(const key of Object.keys(names)){
    const request=key==='notice'?{...args[key],p_query:{...query,operationId:id(810)}}:{...args[key],p_operation_id:id(810)};
    assert.deepEqual(await transport.rpc(names[key],request),{data:{syntheticSqlResult:true},error:null});
    const call=transport.calls.at(-1);assert.equal(call.locationId,id(301));assert.equal(call.operationId,id(810));assert.equal(call.allowWrite,false);
    assert(statements.at(-1).startsWith("set standard_conforming_strings=on;set role service_role;select jsonb_build_object('role',current_user,'data',public."+names[key]+'('));
    assert(statements.at(-1).endsWith(',false));'));
  }
  assert.equal(statements.length,3);assert.deepEqual(transport.errors,[]);
});

test('draft, prepare, enable, pause, publish and withdraw keep detached exact commands and original UUIDs',async()=>{
  const {transport,statements}=fixture();
  const cases=[['policy',commands.policy],['setup',commands.setup],
    ['setup',{...commands.setup,action:'enable',operationId:id(804),draftRevision:null}],
    ['setup',{...commands.setup,action:'pause',operationId:id(805),draftRevision:null}],
    ['notice',commands.notice],['notice',{...commands.notice,action:'withdraw',operationId:id(806),draftRevision:null}]];
  for(const [key,command] of cases){
    await transport.rpc(names[key],{...args[key],p_command:command});
    assert.deepEqual(transport.calls.at(-1).command,command);assert.equal(transport.calls.at(-1).operationId,command.operationId);
  }
  assert(statements[0].includes("合成''用途"));
  values.radiusMeters=200;assert.equal(transport.calls[0].command.values.radiusMeters,100);values.radiusMeters=100;
  assert.equal(statements.length,6);
});

test('owner notice query cannot invent employee consent or accept malformed locations and query shapes',async()=>{
  const {transport,statements}=fixture();
  for(const p_query of [null,[],
    {...query,expectedWorkerId:id(201)},{...query,locationId:'not-a-location'},
    {...query,operationId:'not-an-operation'},{...query,extra:true}])
    await assert.rejects(transport.rpc(names.notice,{...args.notice,p_query}),/invalid_query/);
  await assert.rejects(transport.rpc(names.notice,{...args.notice,p_command:{action:'acknowledge',operationId:id(807),expectedRevision:1}}),/invalid_notice/);
  for(const key of ['policy','setup'])await assert.rejects(transport.rpc(names[key],{...args[key],p_location_id:"x';select 1"}),/invalid_location/);
  assert.equal(statements.length,0);assert.equal(transport.calls.length,0);
});

test('location write gates, shapes, mixed recovery reads and lossy payloads reject before SQL',async()=>{
  const {transport,statements}=fixture();
  for(const [key,gate] of [['policy','p_allow_write'],['setup','p_allow_prepare'],['notice','p_allow_publish']]){
    for(const value of [null,'true',0,1])await assert.rejects(transport.rpc(names[key],{...args[key],[gate]:value}),/invalid_write_gate/);
    for(const p_command of [{}, {...commands[key],operationId:'invalid'}, {...commands[key],actorId:actors[1].id}])
      await assert.rejects(transport.rpc(names[key],{...args[key],p_command}));
    const read=key==='notice'?{p_query:{...query,operationId:commands[key].operationId}}:{p_operation_id:commands[key].operationId};
    await assert.rejects(transport.rpc(names[key],{...args[key],p_command:commands[key],...read}),/mixed_write_read/);
  }
  for(const patch of [{action:'clock_in'},{action:'enable',draftRevision:1},{action:'prepare',draftRevision:null}])
    await assert.rejects(transport.rpc(names.setup,{...args.setup,p_command:{...commands.setup,...patch}}),/invalid_setup/);
  for(const patch of [{action:'acknowledge'},{action:'withdraw',draftRevision:1}])
    await assert.rejects(transport.rpc(names.notice,{...args.notice,p_command:{...commands.notice,...patch}}),/invalid_notice/);
  for(const extra of [{unknown:true},{latitude:NaN},{notice:undefined}])
    await assert.rejects(transport.rpc(names.policy,{...args.policy,p_command:{...commands.policy,values:{...values,...extra}}}));
  assert.equal(statements.length,0);assert.equal(transport.calls.length,0);
});

test('location settings opt-in rejects another entry or combined scenarios before bundling or serving',()=>{
  for(const [flags,error] of [
    [['--location-settings','--check-only'],'attendance_location_settings_require_merchant_shell'],
    [['--merchant-shell','--location-settings','--schedule','--check-only'],'attendance_location_settings_conflicting_entry_flags'],
    [['--merchant-shell','--location-settings','--controls','--check-only'],'attendance_location_settings_conflicting_entry_flags'],
  ]){
    const result=spawnSync(process.execPath,['scripts/attendance-self-browser-harness.mjs',...flags],
      {cwd:new URL('..',import.meta.url),encoding:'utf8',windowsHide:true,shell:false,timeout:10000,maxBuffer:32768});
    assert.equal(result.error,undefined);assert.equal(result.status,1);assert(result.stderr.includes(error));
    assert(!result.stdout.includes('inMemoryBundle'));assert(!result.stdout.includes('Attendance synthetic component QA'));
  }
});
