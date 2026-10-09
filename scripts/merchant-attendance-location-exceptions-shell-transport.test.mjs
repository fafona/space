import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import test from 'node:test';

const require=createRequire(import.meta.url);
const {createAttendanceAuditShellTransport,databaseId:id,databaseActors:actors}=require('./fixtures/attendance-audit-shell-transport.ts');
const names={review:'faolla_attendance_location_reviews_v1',discussion:'faolla_attendance_location_discussion_v1'};
const identity={p_site_id:'99990001',p_auth_user_id:actors[0].id};
const range={fromAt:'2026-10-01T00:00:00.000000Z',toAt:'2026-10-03T00:00:00.000000Z',asOf:null,cursorAt:null,cursorId:null};
const reviewList={mode:'list',...range,workerId:null,locationId:null,status:'all'};
const reviewDetail={mode:'detail',eventId:id(701),operationId:null};
const discussionList={access:'self',mode:'list',expectedWorkerId:null,...range};
const discussionDetail={access:'self',mode:'detail',expectedWorkerId:id(201),eventId:id(701),operationId:null};
const reviewCommand={eventId:id(701),operationId:id(801),expectedRevision:0,outcome:'follow_up',note:'内部核查：需补充说明'};
const discussionCommand={eventId:id(701),operationId:id(802),expectedRevision:0,note:'员工可见的说明'};
const result={syntheticSqlResult:true};
const args=(p_query,p_command=null)=>({...identity,p_query,p_command});
const json=value=>value===null?'null':"'"+JSON.stringify(value).replaceAll("'","''")+"'::jsonb";
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

test('review and discussion forward exact actual four-argument SQL signatures and detached recovery logs',async()=>{
  const {transport,statements}=fixture();
  for(const [name,query] of [[names.review,reviewList],[names.review,{...reviewDetail,operationId:id(811)}],
    [names.discussion,discussionList],[names.discussion,{...discussionDetail,operationId:id(812)}],
    [names.discussion,{...discussionList,access:'owner'}],[names.discussion,{...discussionDetail,access:'owner',expectedWorkerId:null}]]){
    const input=args({...query});
    assert.deepEqual(await transport.rpc(name,input),{data:result,error:null});
    assert.equal(statements.at(-1),`set standard_conforming_strings=on;set role service_role;select jsonb_build_object('role',current_user,'data',public.${name}('99990001','${actors[0].id}',${json(query)},null));`);
    const call=transport.calls.at(-1);assert.deepEqual(call.query,query);assert.equal(call.command,null);
    assert.equal(call.operationId,query.operationId??null);assert.equal(Object.hasOwn(call,'allowWrite'),false);
    input.p_query.mode='modified';assert.equal(call.query.mode,query.mode);
  }
  assert.deepEqual(transport.errors,[]);
});

test('append-only review and public discussion commands preserve private/public shapes and safe quoted text',async()=>{
  const {transport,statements}=fixture();
  for(const [name,query,command] of [[names.review,reviewDetail,reviewCommand],[names.discussion,discussionDetail,discussionCommand]]){
    const note="说明 O'Brien \\ local; ');select secret;-- 😀",intent={...command,note};
    await transport.rpc(name,args(query,intent));
    assert.equal(statements.at(-1),`set standard_conforming_strings=on;set role service_role;select jsonb_build_object('role',current_user,'data',public.${name}('99990001','${actors[0].id}',${json(query)},${json(intent)}));`);
    const call=transport.calls.at(-1);assert.equal(call.operationId,intent.operationId);assert.deepEqual(call.command,intent);
    intent.note='mutated';assert.equal(call.command.note,note);
  }
  for(const outcome of ['noted','follow_up','reopen'])await transport.rpc(names.review,args(reviewDetail,{...reviewCommand,outcome}));
  await transport.rpc(names.discussion,args(discussionDetail,{...discussionCommand,note:'😀'.repeat(500),expectedRevision:Number.MAX_SAFE_INTEGER-2}));
  assert.equal(Object.hasOwn(transport.calls.at(-1).command,'outcome'),false);
});

test('synthetic actor allowlist never substitutes for current SQL ownership or employee authorization',async()=>{
  const {transport,statements}=fixture(()=>{throw Error('ERROR:  attendance_access_denied\nCONTEXT: real RPC boundary');});
  for(const actor of actors)for(const [name,query,command] of [[names.review,reviewDetail,reviewCommand],
    [names.discussion,discussionDetail,discussionCommand],
    [names.discussion,{...discussionDetail,access:'owner',expectedWorkerId:null},discussionCommand]]){
    assert.deepEqual(await transport.rpc(name,{...args(query,command),p_auth_user_id:actor.id}),{data:null,error:{message:'attendance_access_denied'}});
    assert.equal(transport.calls.at(-1).actor,actor.id);
  }
  assert.equal(statements.length,actors.length*3);assert.deepEqual(transport.errors,[]);
});

test('exception RPC allowlist and four own-property signatures reject invented gates and tenant or actor injection',async()=>{
  const {transport,statements}=fixture();
  for(const name of ['constructor','__proto__','faolla_attendance_location_review_v1','faolla_attendance_location_discussion_v1);select 1;--'])
    await assert.rejects(transport.rpc(name,args(reviewDetail)),/unexpected_rpc/);
  for(const [name,query] of [[names.review,reviewDetail],[names.discussion,discussionDetail]]){
    const valid=args(query);
    for(const key of Object.keys(valid)){
      const missing={...valid};delete missing[key];await assert.rejects(transport.rpc(name,missing),/invalid_rpc_arguments/);
      const inherited=Object.assign(Object.create({[key]:valid[key]}),missing);await assert.rejects(transport.rpc(name,inherited),/invalid_rpc_arguments/);
    }
    for(const patch of [{p_allow_write:true},{p_operation_id:null},{actorId:actors[0].id},{p_site_id:'99990002'},{p_auth_user_id:id(999)}])
      await assert.rejects(transport.rpc(name,{...valid,...patch}),/invalid_rpc_arguments|invalid_site|invalid_actor/);
  }
  assert.deepEqual(statements,[]);assert.deepEqual(transport.calls,[]);
});

test('query shapes enforce access pins, exact keys and bound microsecond pagination without applying actor permissions',async()=>{
  const {transport,statements}=fixture();
  const cursor={asOf:'2026-10-02T12:00:00.000003Z',cursorAt:'2026-10-02T12:00:00.000002Z',cursorId:id(702)};
  for(const query of [{...reviewList,...cursor,workerId:id(201),locationId:id(301)},
    {...discussionList,...cursor,expectedWorkerId:id(201)},
    {...discussionList,...cursor,access:'owner',expectedWorkerId:null}]){
    await transport.rpc(Object.hasOwn(query,'access')?names.discussion:names.review,args(query));
    assert.deepEqual(transport.calls.at(-1).query,query);
  }
  // Full 31-day bounds are valid, but an additional single microsecond is not.
  await transport.rpc(names.review,args({...reviewList,fromAt:'2026-09-01T00:00:00.000001Z',toAt:'2026-10-02T00:00:00.000001Z'}));
  assert.equal(statements.length,4);
  const invalidRanges=[
    {fromAt:range.toAt},{toAt:range.fromAt},{fromAt:'2026-02-30T00:00:00.000000Z'},
    {fromAt:'2026-10-01T00:00:00Z'},{asOf:'bad'},
    {fromAt:'2026-09-01T00:00:00.000001Z',toAt:'2026-10-02T00:00:00.000002Z'},
    {cursorId:id(702)},{cursorAt:cursor.cursorAt},{...cursor,asOf:null},
    {...cursor,cursorAt:cursor.asOf},{...cursor,cursorAt:'2026-09-30T00:00:00.000000Z'},
    {...cursor,cursorAt:range.toAt},{...cursor,cursorId:'bad'},
  ];
  await rejectedWithoutSql(names.review,[
    ...invalidRanges.map(patch=>args({...reviewList,...patch})),
    ...[{status:'done'},{status:null},{workerId:'bad'},{locationId:'bad'},{access:'owner'}].map(patch=>args({...reviewList,...patch})),
    ...[{eventId:'bad'},{operationId:'bad'},{mode:'list'},{outcome:'noted'}].map(patch=>args({...reviewDetail,...patch})),
  ],/invalid_query/);
  await rejectedWithoutSql(names.discussion,[
    ...invalidRanges.map(patch=>args({...discussionList,...patch,expectedWorkerId:id(201)})),
    args({...discussionList,...cursor}),args({...discussionList,access:'owner',expectedWorkerId:id(201)}),
    args({...discussionDetail,expectedWorkerId:null}),args({...discussionDetail,access:'owner'}),
    args({...discussionDetail,access:'manager'}),args({...discussionDetail,expectedWorkerId:'bad'}),
    args({...discussionDetail,operationId:'bad'}),args({...discussionDetail,eventId:'bad'}),
    args({...discussionList,workerId:id(201)}),args({...discussionDetail,outcome:'noted'}),
  ],/invalid_query/);
  for(const [name,query] of [[names.review,reviewList],[names.review,reviewDetail],[names.discussion,discussionList],[names.discussion,discussionDetail]]){
    for(const key of Object.keys(query)){
      const missing={...query};delete missing[key];await rejectedWithoutSql(name,[args(missing),args(Object.assign(Object.create({[key]:query[key]}),missing))],/invalid_query/);
    }
  }
});

test('writes cannot mix receipts, switch events, target list queries or smuggle public review outcomes',async()=>{
  for(const [name,query,list,command] of [[names.review,reviewDetail,reviewList,reviewCommand],[names.discussion,discussionDetail,discussionList,discussionCommand]]){
    await rejectedWithoutSql(name,[
      args({...query,operationId:command.operationId},command),args({...query,eventId:id(703)},command),args(list,command),
    ],/mixed_write_read/);
    const malformed=[undefined,[],{},
      ...[{eventId:'bad'},{operationId:'bad'},{expectedRevision:-1},{expectedRevision:0.5},{expectedRevision:'0'},
        {expectedRevision:Number.MAX_SAFE_INTEGER-1},{expectedRevision:NaN},{actorId:actors[0].id},
        {note:''},{note:' '},{note:' padded '},{note:'line\nbreak'},{note:'control\u007f'},{note:'😀'.repeat(501)},
        {note:7}].map(patch=>({...command,...patch})),
    ];
    for(const key of Object.keys(command)){
      const missing={...command};delete missing[key];malformed.push(missing,Object.assign(Object.create({[key]:command[key]}),missing));
    }
    await rejectedWithoutSql(name,malformed.map(value=>({...args(query),p_command:value})),/invalid_command/);
  }
  await rejectedWithoutSql(names.review,[args(reviewDetail,{...reviewCommand,outcome:'approve'}),args(reviewDetail,{...reviewCommand,outcome:1})],/invalid_command/);
  await rejectedWithoutSql(names.discussion,[args(discussionDetail,{...discussionCommand,outcome:'noted'})],/invalid_command/);
});

test('exception adapters preserve typed SQL errors and reject unproven service_role replies',async()=>{
  for(const [name,query] of [[names.review,reviewDetail],[names.discussion,discussionDetail]]){
    for(const code of ['attendance_access_denied','attendance_review_not_found','attendance_operation_conflict','attendance_version_conflict','attendance_worker_changed']){
      const denied=fixture(()=>{throw Error(`ERROR:  ${code}\nCONTEXT: synthetic`);});
      assert.deepEqual(await denied.transport.rpc(name,args(query)),{data:null,error:{message:code}});
      assert.deepEqual(denied.transport.errors,[]);assert.equal(denied.statements.length,1);
    }
    for(const response of [{role:'authenticated',data:result},{role:'service_role',data:result,extra:true}]){
      const wrong=fixture(()=>JSON.stringify(response));await assert.rejects(wrong.transport.rpc(name,args(query)),/wrong_database_role/);
      assert.equal(wrong.transport.errors.length,1);
    }
  }
  const broken=fixture(()=>{throw Error('synthetic transport unavailable');});
  await assert.rejects(broken.transport.rpc(names.review,args(reviewDetail)),/synthetic transport unavailable/);
  assert.equal(broken.transport.errors.length,1);
});
