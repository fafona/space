import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import test from 'node:test';

const require=createRequire(import.meta.url);
const {createAttendanceAuditShellTransport,databaseId:id,databaseActors:actors}=require('./fixtures/attendance-audit-shell-transport.ts');
const names={context:'faolla_attendance_self_context_v1',notice:'faolla_attendance_location_notice_v1',clock:'faolla_attendance_location_clock_v2'};
const identity={p_site_id:'99990001',p_auth_user_id:actors[2].id};
const clockArgs={...identity,p_expected_worker_id:id(201),p_command:null,p_operation_id:null,p_assertion:null,p_allow_new_sessions:false,p_require_clock:false};
const noticeQuery={access:'self',locationId:id(301),expectedWorkerId:id(201),operationId:null};
const noticeArgs={...identity,p_query:noticeQuery,p_command:null,p_allow_publish:false};
const command={operationId:id(801),locationId:id(301),action:'clock_in',expectedSequence:0,settingsVersion:2,workerVersion:1,locationVersion:3,noticeRevision:1,safeFinish:false};
const assertion={policyFingerprint:'a'.repeat(32),algorithmVersion:1,reason:'inside',capturedAt:'2026-10-02T10:20:30.000Z',accuracyMeters:5,distanceMeters:1};
const ack={action:'acknowledge',operationId:id(802),expectedRevision:1};
const result={syntheticSqlResult:true};
const json=value=>"'"+JSON.stringify(value).replaceAll("'","''")+"'::jsonb";
function fixture(reply=()=>JSON.stringify({role:'service_role',data:result})){
  const statements=[];
  const transport=createAttendanceAuditShellTransport(sql=>{statements.push(sql);return reply(sql);});
  return {transport,statements};
}
async function rejectedWithoutSql(name,requests,pattern){
  const {transport,statements}=fixture();
  for(const request of requests)await assert.rejects(transport.rpc(name,request),pattern);
  assert.deepEqual(statements,[]);assert.deepEqual(transport.calls,[]);
}

test('self context and v2 read/recovery use exact real signatures and unquoted boolean gates',async()=>{
  const {transport,statements}=fixture();
  assert.deepEqual(await transport.rpc(names.context,identity),{data:result,error:null});
  assert.equal(statements[0],`set standard_conforming_strings=on;set role service_role;select jsonb_build_object('role',current_user,'data',public.${names.context}('99990001','${actors[2].id}'));`);
  assert.equal(transport.calls[0].command,null);assert.equal(transport.calls[0].operationId,null);
  for(const allow of [false,true])for(const requireClock of [false,true]){
    await transport.rpc(names.clock,{...clockArgs,p_operation_id:id(810),p_allow_new_sessions:allow,p_require_clock:requireClock});
    assert.equal(statements.at(-1),`set standard_conforming_strings=on;set role service_role;select jsonb_build_object('role',current_user,'data',public.${names.clock}('99990001','${actors[2].id}','${id(201)}',null,'${id(810)}',null,${allow},${requireClock}));`);
    const call=transport.calls.at(-1);assert.equal(call.operationId,id(810));assert.equal(call.expectedWorkerId,id(201));
    assert.equal(call.allowNewSessions,allow);assert.equal(call.requireClock,requireClock);assert.equal(call.assertion,null);
  }
  assert.deepEqual(transport.errors,[]);
});

test('v2 writes forward detached nine-field intent and minimized assertion, never raw position',async()=>{
  const {transport,statements}=fixture(),intent={...command},summary={...assertion};
  assert.deepEqual(await transport.rpc(names.clock,{...clockArgs,p_command:intent,p_assertion:summary,p_allow_new_sessions:true,p_require_clock:true}),{data:result,error:null});
  assert.equal(statements[0],`set standard_conforming_strings=on;set role service_role;select jsonb_build_object('role',current_user,'data',public.${names.clock}('99990001','${actors[2].id}','${id(201)}',${json(command)},null,${json(assertion)},true,true));`);
  assert.deepEqual(transport.calls[0].command,command);assert.deepEqual(transport.calls[0].assertion,assertion);
  assert.equal(transport.calls[0].operationId,command.operationId);assert.equal(transport.calls[0].locationId,command.locationId);
  intent.operationId=id(899);summary.reason='outside';assert.equal(transport.calls[0].command.operationId,command.operationId);assert.equal(transport.calls[0].assertion.reason,'inside');
  assert.doesNotMatch(statements[0],/latitude|longitude|"position"|"expectedWorkerId"/);
  for(const reason of ['outside','uncertain'])await transport.rpc(names.clock,{...clockArgs,p_command:command,p_assertion:{...assertion,reason}});
  for(const reason of ['denied','timeout','unavailable','unsupported','not_provided']){
    const minimized={...assertion,reason,capturedAt:null,accuracyMeters:null,distanceMeters:null};
    await transport.rpc(names.clock,{...clockArgs,p_command:command,p_assertion:minimized});
    assert.deepEqual(transport.calls.at(-1).assertion,minimized);
  }
});

test('safe finish is locationless and normal null assertions still reach authoritative SQL denial',async()=>{
  const {transport,statements}=fixture();
  for(const action of ['break_end','clock_out']){
    const intent={...command,action,noticeRevision:null,safeFinish:true};
    await transport.rpc(names.clock,{...clockArgs,p_command:intent,p_require_clock:true});
    assert.deepEqual(transport.calls.at(-1).command,intent);assert.equal(transport.calls.at(-1).assertion,null);
    assert(statements.at(-1).endsWith(',null,false,true));'));
  }
  await transport.rpc(names.clock,{...clockArgs,p_command:command,p_require_clock:true});
  assert.equal(statements.length,3);assert.equal(transport.calls.at(-1).assertion,null);
  const invalid=[
    {...clockArgs,p_assertion:assertion},
    ...[{action:'clock_in'},{action:'break_start'},{noticeRevision:1}].map(patch=>({...clockArgs,p_command:{...command,action:'clock_out',safeFinish:true,noticeRevision:null,...patch}})),
    {...clockArgs,p_command:{...command,action:'clock_out',safeFinish:true,noticeRevision:null},p_assertion:assertion},
  ];
  await rejectedWithoutSql(names.clock,invalid,/read_assertion|invalid_safe_finish/);
});

test('self notice reads and ACK preserve actor authorization in SQL without enabling owner actions',async()=>{
  const {transport,statements}=fixture();
  await transport.rpc(names.notice,{...noticeArgs,p_query:{...noticeQuery,operationId:id(811)}});
  assert.equal(transport.calls.at(-1).operationId,id(811));assert.equal(transport.calls.at(-1).allowWrite,false);
  const input={...noticeArgs,p_query:{...noticeQuery},p_command:{...ack}};
  await transport.rpc(names.notice,input);
  assert.equal(statements.at(-1),`set standard_conforming_strings=on;set role service_role;select jsonb_build_object('role',current_user,'data',public.${names.notice}('99990001','${actors[2].id}',${json(noticeQuery)},${json(ack)},false));`);
  input.p_command.expectedRevision=9;input.p_query.locationId=id(999);
  assert.deepEqual(transport.calls.at(-1).command,ack);assert.deepEqual(transport.calls.at(-1).query,noticeQuery);
  // Owner access=self is structurally valid; the actual SQL, not the fixture,
  // decides whether that authenticated principal is also a current employee.
  await transport.rpc(names.notice,{...noticeArgs,p_auth_user_id:actors[0].id});
  assert.equal(transport.calls.at(-1).actor,actors[0].id);
  await rejectedWithoutSql(names.notice,[
    {...noticeArgs,p_query:{...noticeQuery,access:'owner',expectedWorkerId:null},p_command:ack},
    {...noticeArgs,p_command:{action:'publish',operationId:id(812),expectedRevision:0,draftRevision:1,expectedSettingsVersion:2,expectedLocationVersion:3,reason:'owner only'}},
    {...noticeArgs,p_command:{...ack,reason:'extra'}},
    ...[0,-1,1.5,'1',Number.MAX_SAFE_INTEGER].map(expectedRevision=>({...noticeArgs,p_command:{...ack,expectedRevision}})),
    {...noticeArgs,p_command:ack,p_query:{...noticeQuery,operationId:id(811)}},
  ],/invalid_notice|mixed_write_read/);
});

test('employee RPC allowlist, argument keys, identities and gates reject before SQL',async()=>{
  const {transport,statements}=fixture();
  for(const name of ['constructor','__proto__','faolla_attendance_location_clock_v1','faolla_attendance_self_context_v1);select 1;--'])
    await assert.rejects(transport.rpc(name,identity),/unexpected_rpc/);
  for(const [name,args] of [[names.context,identity],[names.notice,noticeArgs],[names.clock,clockArgs]]){
    for(const patch of [{p_site_id:'99990002'},{p_auth_user_id:id(999)},{p_auth_user_id:null},{p_extra:true},{latitude:40}])
      await assert.rejects(transport.rpc(name,{...args,...patch}),/invalid_site|invalid_actor|invalid_rpc_arguments/);
    for(const key of Object.keys(args)){const missing={...args};delete missing[key];await assert.rejects(transport.rpc(name,missing),/invalid_rpc_arguments/);}
  }
  for(const key of ['p_allow_new_sessions','p_require_clock'])for(const value of [null,undefined,0,1,'false'])
    await assert.rejects(transport.rpc(names.clock,{...clockArgs,[key]:value}),/invalid_clock_gates/);
  for(const value of [null,undefined,'invalid',"x';select 1"])
    await assert.rejects(transport.rpc(names.clock,{...clockArgs,p_expected_worker_id:value}),/invalid_worker/);
  for(const p_query of [{...noticeQuery,expectedWorkerId:null},{...noticeQuery,expectedWorkerId:'bad'},{...noticeQuery,access:'manager'},{...noticeQuery,latitude:1}])
    await assert.rejects(transport.rpc(names.notice,{...noticeArgs,p_query}),/invalid_query/);
  assert.deepEqual(statements,[]);assert.deepEqual(transport.calls,[]);
});

test('clock intents reject raw client fields, mixed recovery and malformed scalar bounds',async()=>{
  const patches=[
    {operationId:'bad'},{locationId:'bad'},{action:'acknowledge'},{safeFinish:'false'},
    {expectedSequence:-1},{expectedSequence:0.5},{expectedSequence:Number.MAX_SAFE_INTEGER},
    {settingsVersion:0},{workerVersion:'1'},{locationVersion:Number.MAX_SAFE_INTEGER+1},
    {noticeRevision:null},{noticeRevision:0},{noticeRevision:Number.MAX_SAFE_INTEGER},
    {latitude:40},{position:{latitude:40,longitude:-3}},{positionFailure:'denied'},{expectedWorkerId:id(201)},
  ];
  await rejectedWithoutSql(names.clock,[
    ...patches.map(patch=>({...clockArgs,p_command:{...command,...patch}})),
    ...[undefined,[],{}].map(p_command=>({...clockArgs,p_command})),
    {...clockArgs,p_command:command,p_operation_id:id(810)},
  ],/invalid_clock_command|invalid_clock_notice|mixed_write_read/);
});

test('assertions accept only six minimized server fields and cannot smuggle coordinates or freshness claims',async()=>{
  const patches=[
    {latitude:40},{longitude:-3},{position:{latitude:40,longitude:-3}},{accuracy:5},
    {policyFingerprint:'A'.repeat(32)},{algorithmVersion:'1'},{reason:'stale'},{reason:'future'},
    {capturedAt:null},{capturedAt:'2026-02-30T10:20:30.000Z'},{capturedAt:'2026-10-02T10:20:30Z'},
    {accuracyMeters:NaN},{accuracyMeters:Infinity},{accuracyMeters:-1},{accuracyMeters:40100001},
    {distanceMeters:null},{distanceMeters:1.1},{distanceMeters:20100001},{reason:'denied'},
  ];
  const values=[...patches.map(patch=>({...assertion,...patch})),undefined,{},[],
    {policyFingerprint:'a'.repeat(32),algorithmVersion:1,reason:'denied',capturedAt:null,accuracyMeters:null},
  ];
  await rejectedWithoutSql(names.clock,values.map(p_assertion=>({...clockArgs,p_command:command,p_assertion})),/invalid_assertion/);
});

test('employee RPCs retain typed SQL errors and reject replies not proven service_role',async()=>{
  for(const [name,args] of [[names.context,identity],[names.notice,noticeArgs],[names.clock,clockArgs]]){
    const denied=fixture(()=>{throw Error('ERROR:  attendance_access_denied\nCONTEXT: synthetic SQL');});
    assert.deepEqual(await denied.transport.rpc(name,args),{data:null,error:{message:'attendance_access_denied'}});
    assert.deepEqual(denied.transport.errors,[]);assert.equal(denied.statements.length,1);
    for(const body of [{role:'authenticated',data:result},{role:'service_role',data:result,extra:true}]){
      const wrong=fixture(()=>JSON.stringify(body));await assert.rejects(wrong.transport.rpc(name,args),/wrong_database_role/);assert.equal(wrong.transport.errors.length,1);
    }
  }
  const broken=fixture(()=>{throw Error('synthetic transport unavailable');});
  await assert.rejects(broken.transport.rpc(names.clock,clockArgs),/synthetic transport unavailable/);assert.equal(broken.transport.errors.length,1);
});
