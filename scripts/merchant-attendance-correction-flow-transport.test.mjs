// Pure transport contract tests: the opaque fake SQL marker below is not a
// correction business response. No database, browser, credentials or network.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
import test from 'node:test';

const require=createRequire(import.meta.url);
const {createAttendanceAuditShellTransport,databaseId:id,databaseActors:actors}=require('./fixtures/attendance-audit-shell-transport.ts');
const names={context:'faolla_attendance_self_context_v1',session:'faolla_attendance_self_session_v1',self:'faolla_attendance_correction_self_v3',review:'faolla_attendance_correction_owner_review_v3',decision:'faolla_attendance_correction_decide_v2'};
const revisionNames={self:'faolla_attendance_revision_self_v2',review:'faolla_attendance_revision_owner_review_v3',decision:'faolla_attendance_revision_decide_v2',history:'faolla_attendance_revision_history_v1'};
const reportNames={owner:'faolla_attendance_period_report_v2',scoped:'faolla_attendance_scoped_period_report_v2',context:'faolla_attendance_scoped_report_context_v1',export:'faolla_attendance_period_export_v2'};
const identity={p_site_id:'99990001',p_auth_user_id:actors[2].id},owner={...identity,p_auth_user_id:actors[0].id};
const worker=id(201),start=id(301),last=id(302),operation=id(801),requestId=id(802);
const at='2026-10-02T10:00:00.123456Z',end='2026-10-02T11:00:00.654321Z';
const proposal={startAt:at,endAt:end,breaks:[{startAt:'2026-10-02T10:10:00.000001Z',endAt:'2026-10-02T10:20:00.000002Z',paid:false}]};
const submit={action:'submit',operationId:operation,expectedRevision:0,reason:"合成说明 ' quote \\ slash",startEventId:start,expectedLastEventId:last,proposal,expectedPolicyRevision:1};
const withdraw={action:'withdraw',operationId:id(803),expectedRevision:1,reason:'明确撤回合成申请',requestId};
const prepare={mode:'prepare',expectedWorkerId:worker,startEventId:start};
const detail={mode:'detail',expectedWorkerId:worker,requestId:operation,operationId:null};
const list={mode:'list',expectedWorkerId:worker,cursorAt:null,cursorId:null};
const selfArgs=(query=detail,command=null,gate=false)=>({...identity,p_query:query,p_command:command,p_platform_enabled:gate});
const reviewList={mode:'list',fromAt:'2026-10-02T00:00:00.000000Z',toAt:'2026-10-03T00:00:00.000000Z',workerId:null,status:'all',asOf:null,cursorAt:null,cursorId:null};
const decision={action:'approve',operationId:id(804),requestId,expectedRevision:1,expectedEvidence:'a'.repeat(32),reason:'负责人明确核对并批准'};
const decisionArgs=(command=null,gate=false)=>({...owner,p_request_id:requestId,p_command:command,p_operation_id:null,p_allow_write:gate});
const rootRequestId=id(806),rootOperationId=id(807),effectiveOperationId=id(808);
const cyclePrepare={mode:'prepare',expectedWorkerId:worker,baseRequestId:rootRequestId,requestId:null,operationId:null};
const cycleDetail={...cyclePrepare,mode:'detail',requestId:operation};
const cycleSubmit={action:'submit',operationId:operation,expectedRevision:0,reason:submit.reason,expectedBaseOperationId:rootOperationId,
  expectedEffectiveOperationId:effectiveOperationId,expectedPolicyRevision:1,proposal};
const cycleArgs=(query=cycleDetail,command=null,gate=false)=>({...identity,p_query:query,p_command:command,p_platform_enabled:gate});
const revisionDecision={...decision,expectedBaseOperationId:effectiveOperationId};
const historyOwner={access:'owner',scope:'submission-period',status:'all',asOf:null,cursorAt:null,cursorId:null,
  fromAt:reviewList.fromAt,toAt:reviewList.toAt};
const historySelf={access:'self',scope:'root-history',status:'all',asOf:null,cursorAt:null,cursorId:null,expectedWorkerId:worker,rootRequestId};
const reportDates={fromDate:'2026-10-01',throughDate:'2026-10-31'},locationId=id(401);
const ownerReport={workerId:worker,...reportDates};
const selfReport={access:'self',...reportDates,workerId:null,locationId:null,expectedWorkerId:worker};
const managerReport={access:'manager',...reportDates,workerId:worker,locationId,expectedWorkerId:null};
const exportQuery={access:'owner',workerId:worker,locationId:null,expectedWorkerId:null,...reportDates,expectedTimeZone:'Europe/Madrid',expectedScopeRevision:null};
const exportArgs=(query=exportQuery,op=operation)=>({...owner,p_operation_id:op,p_query:query});
const result={opaqueSqlMarker:'not-a-business-result'};
const json=value=>"'"+JSON.stringify(value).replaceAll("'","''")+"'::jsonb";
const statement=(name,args)=>`set standard_conforming_strings=on;set role service_role;select jsonb_build_object('role',current_user,'data',public.${name}(${args}));`;
function fixture(reply=()=>JSON.stringify({role:'service_role',data:result})) {
  const statements=[],transport=createAttendanceAuditShellTransport(sql=>{statements.push(sql);return reply(sql);});
  return {transport,statements};
}
async function rejectedWithoutSql(name,inputs,pattern) {
  const f=fixture();for(const input of inputs)await assert.rejects(f.transport.rpc(name,input),pattern);
  assert.deepEqual(f.statements,[]);assert.deepEqual(f.transport.calls,[]);assert.deepEqual(f.transport.errors,[]);
}

test('current self context and original session use their exact read-only signatures',async()=>{
  const f=fixture();assert.deepEqual(await f.transport.rpc(names.context,identity),{data:result,error:null});
  assert.deepEqual(await f.transport.rpc(names.session,{...identity,p_start_event_id:start}),{data:result,error:null});
  assert.equal(f.statements[0],statement(names.context,`'99990001','${actors[2].id}'`));
  assert.equal(f.statements[1],statement(names.session,`'99990001','${actors[2].id}','${start}'`));
  assert.equal(f.transport.calls[1].startEventId,start);assert.deepEqual(f.transport.calls[1].query,{startEventId:start});assert.equal(f.transport.calls[1].command,null);
  await rejectedWithoutSql(names.session,[
    identity,{...identity,p_start_event_id:null},{...identity,p_start_event_id:'not-a-uuid'},
    {...identity,p_start_event_id:start,p_command:null},{...identity,p_start_event_id:start.toUpperCase().replace('4000','A000')},
  ],/invalid_rpc_arguments|invalid_start_event/);
});

test('v3 self prepare, list cursor and receipt lookup preserve worker scope and microseconds',async()=>{
  const f=fixture();
  for(const query of [prepare,list,{...list,cursorAt:at,cursorId:requestId},{...detail,operationId:id(805)}]){
    const input=selfArgs(query);assert.deepEqual(await f.transport.rpc(names.self,input),{data:result,error:null});
    assert.equal(f.statements.at(-1),statement(names.self,`'99990001','${actors[2].id}',${json(query)},null,false`));
    const call=f.transport.calls.at(-1);assert.deepEqual(call.query,query);assert.equal(call.expectedWorkerId,worker);assert.equal(call.platformEnabled,false);assert.equal(call.operationId,query.operationId??null);
  }
  assert.deepEqual(f.transport.errors,[]);
});

test('v3 submit and paused withdrawal forward exact detached commands without local authorization shortcuts',async()=>{
  const f=fixture(),input=selfArgs(structuredClone(detail),structuredClone(submit),true);
  assert.deepEqual(await f.transport.rpc(names.self,input),{data:result,error:null});
  assert.equal(f.statements[0],statement(names.self,`'99990001','${actors[2].id}',${json(detail)},${json(submit)},true`));
  assert.deepEqual(f.transport.calls[0].command,submit);assert.equal(f.transport.calls[0].operationId,operation);
  input.p_command.reason='changed';input.p_command.proposal.breaks[0].paid=true;input.p_query.expectedWorkerId=id(999);
  assert.deepEqual(f.transport.calls[0].command,submit);assert.deepEqual(f.transport.calls[0].query,detail);
  const withdrawalQuery={...detail,requestId};await f.transport.rpc(names.self,selfArgs(withdrawalQuery,withdraw,false));
  assert.equal(f.statements.at(-1),statement(names.self,`'99990001','${actors[2].id}',${json(withdrawalQuery)},${json(withdraw)},false`));
  // Compatibility input with no policy is structurally valid; actual SQL must
  // produce policy_required rather than a fixture-synthesized business error.
  const {expectedPolicyRevision:omitted,...legacySubmit}=submit;assert.equal(omitted,1);
  await f.transport.rpc(names.self,{...selfArgs(detail,legacySubmit,false),p_auth_user_id:actors[0].id});
  assert.equal(f.transport.calls.at(-1).actor,actors[0].id);assert.equal(f.transport.calls.at(-1).platformEnabled,false);assert.equal(f.statements.length,3);
});

test('self query rejects malformed modes, worker IDs, unpaired cursors and cross-shape fields before SQL',async()=>{
  await rejectedWithoutSql(names.self,[
    ...[null,{},[],{...prepare,mode:'owner'},{...prepare,expectedWorkerId:null},{...prepare,startEventId:'ABC'},
      {...prepare,operationId:null},{...detail,operationId:'null'},{...detail,requestId:undefined},{...list,cursorAt:at},
      {...list,cursorId:requestId},{...list,cursorAt:'2026-02-30T00:00:00.000000Z',cursorId:requestId},
      {...list,cursorAt:at,cursorId:requestId,asOf:null}].map(query=>selfArgs(query)),
    selfArgs(detail,null,'true'),selfArgs(detail,null,null),{...selfArgs(detail),p_command:undefined},
  ],/invalid_query|invalid_platform_gate|invalid_command/);
});

test('self writes reject mixed receipt reads, mismatched requests and bounded command fields',async()=>{
  await rejectedWithoutSql(names.self,[
    selfArgs(prepare,submit,true),selfArgs(list,submit,true),selfArgs({...detail,requestId},submit,true),selfArgs({...detail,operationId:operation},submit,true),
    selfArgs(detail,withdraw),
    ...[{action:'approve'},{extra:true},{reason:''},{reason:' untrimmed'},{reason:'line\nbreak'},{reason:'control\u0085'},
      {reason:'字'.repeat(501)},{operationId:123},{expectedRevision:-1},{expectedRevision:1.5},{expectedRevision:Number.MAX_SAFE_INTEGER-2},
      {expectedPolicyRevision:0},{expectedPolicyRevision:'1'},{expectedPolicyRevision:NaN},{expectedLastEventId:null}].map(patch=>selfArgs(detail,{...submit,...patch},true)),
    selfArgs({...detail,requestId},{...withdraw,expectedPolicyRevision:1}),
  ],/mixed_write_read|invalid_command/);
});

test('proposal allowlist validates order, exact break fields, duration, payment and 32-break bound',async()=>{
  const invalid=[null,{},[],{...proposal,extra:true},{...proposal,startAt:end},{...proposal,endAt:at},
    {...proposal,startAt:'2026-02-30T00:00:00.000000Z'},{...proposal,endAt:'2026-12-02T11:00:00.654321Z'},
    {...proposal,breaks:{}},{...proposal,breaks:Array(33).fill(proposal.breaks[0])},
    ...[{...proposal.breaks[0],paid:'false'},{...proposal.breaks[0],extra:true},{...proposal.breaks[0],startAt:'2026-10-02T09:59:59.999999Z'},
      {...proposal.breaks[0],endAt:'2026-10-02T11:00:00.654322Z'},
      {...proposal.breaks[0],endAt:proposal.breaks[0].startAt}].map(item=>({...proposal,breaks:[item]})),
    {...proposal,breaks:[proposal.breaks[0],proposal.breaks[0]]}];
  await rejectedWithoutSql(names.self,invalid.map(value=>selfArgs(detail,{...submit,proposal:value},true)),/invalid_command/);
  const f=fixture();await f.transport.rpc(names.self,selfArgs(detail,{...submit,proposal:{...proposal,breaks:[]}},true));
  await f.transport.rpc(names.self,selfArgs(detail,{...submit,proposal:{...proposal,breaks:[{startAt:at,endAt:end,paid:true}]},reason:'😀'.repeat(500)},true));
  assert.equal(f.statements.length,2);
});

test('owner review v3 supports exact list/detail, all statuses and cursor equal to asOf',async()=>{
  const f=fixture();
  const queries=[{mode:'detail',requestId},...['all','submitted','withdrawn'].map(status=>({...reviewList,status})),
    {...reviewList,workerId:worker,asOf:at,cursorAt:at,cursorId:requestId}];
  for(const query of queries){
    assert.deepEqual(await f.transport.rpc(names.review,{...owner,p_query:query}),{data:result,error:null});
    assert.equal(f.statements.at(-1),statement(names.review,`'99990001','${actors[0].id}',${json(query)}`));assert.deepEqual(f.transport.calls.at(-1).query,query);
  }
  // A known employee principal reaches the real owner's authorization checks.
  await f.transport.rpc(names.review,{...identity,p_query:{mode:'detail',requestId}});assert.equal(f.transport.calls.at(-1).actor,actors[2].id);
});

test('owner review query rejects widened scopes and invalid ranges without invoking SQL',async()=>{
  const invalid=[{mode:'detail',requestId,operationId:null},{mode:'detail',requestId:null},{...reviewList,workerId:'all'},
    {...reviewList,status:'approved'},{...reviewList,access:'owner'},{...reviewList,fromAt:reviewList.toAt},
    {...reviewList,fromAt:'1999-12-31T23:59:59.999999Z'},{...reviewList,toAt:'2101-01-01T00:00:00.000001Z'},
    {...reviewList,toAt:'2026-12-02T00:00:00.000000Z'},{...reviewList,asOf:'invalid'},
    {...reviewList,cursorId:requestId},{...reviewList,cursorAt:at},
    {...reviewList,cursorId:requestId,cursorAt:at},
    {...reviewList,asOf:at,cursorId:requestId,cursorAt:end},
    {...reviewList,asOf:end,cursorId:requestId,cursorAt:'2026-10-01T23:59:59.999999Z'}];
  await rejectedWithoutSql(names.review,invalid.map(p_query=>({...owner,p_query})),/invalid_query/);
});

test('current first-decision v2 read, receipt and writes preserve CAS evidence and boolean admission',async()=>{
  const f=fixture();
  for(const gate of [false,true]){
    await f.transport.rpc(names.decision,{...decisionArgs(null,gate),p_operation_id:operation});
    assert.equal(f.statements.at(-1),statement(names.decision,`'99990001','${actors[0].id}','${requestId}',null,'${operation}',${gate}`));
    assert.deepEqual(f.transport.calls.at(-1).query,{requestId,operationId:operation});assert.equal(f.transport.calls.at(-1).allowWrite,gate);
  }
  for(const action of ['approve','reject']){
    const command={...decision,action};await f.transport.rpc(names.decision,decisionArgs(command,true));
    assert.equal(f.statements.at(-1),statement(names.decision,`'99990001','${actors[0].id}','${requestId}',${json(command)},null,true`));
    assert.equal(f.transport.calls.at(-1).requestId,requestId);assert.equal(f.transport.calls.at(-1).operationId,decision.operationId);assert.deepEqual(f.transport.calls.at(-1).command,command);
  }
  const input=decisionArgs({...decision},false);await f.transport.rpc(names.decision,input);input.p_command.expectedEvidence='b'.repeat(32);
  assert.equal(f.transport.calls.at(-1).command.expectedEvidence,decision.expectedEvidence);assert.equal(f.transport.calls.at(-1).allowWrite,false);
  await f.transport.rpc(names.decision,{...decisionArgs(decision),p_auth_user_id:actors[1].id});assert.equal(f.transport.calls.at(-1).actor,actors[1].id);
});

test('decision transport rejects widened command, mixed receipt, forged action and unsafe CAS fields',async()=>{
  await rejectedWithoutSql(names.decision,[
    {...decisionArgs(),p_request_id:null},{...decisionArgs(),p_allow_write:'true'},
    {...decisionArgs(decision),p_operation_id:operation},decisionArgs({...decision,requestId:operation}),
    ...[{action:'reopen'},{extra:true},{reason:''},{reason:' x'},{reason:'x\u009f'},
      {expectedRevision:0},{expectedRevision:'1'},{expectedRevision:Number.MAX_SAFE_INTEGER},
      {expectedEvidence:'A'.repeat(32)},{expectedEvidence:'a'.repeat(31)},{expectedEvidence:null},{operationId:'UPPER'}]
      .map(patch=>decisionArgs({...decision,...patch})),
  ],/invalid_request_id|invalid_write_gate|mixed_write_read|invalid_decision/);
});

test('only current allowlisted names, exact arguments and synthetic identity reach service_role',async()=>{
  const f=fixture();
  for(const name of ['constructor','__proto__','faolla_attendance_correction_self_v1','faolla_attendance_correction_self_v2',
    'faolla_attendance_correction_owner_review_v1','faolla_attendance_correction_decide_v1','faolla_attendance_revision_decide_v1',
    'faolla_attendance_self_session_v1);delete from public.merchants;--'])await assert.rejects(f.transport.rpc(name,{}),/unexpected_rpc/);
  assert.deepEqual(f.statements,[]);
  const signatures=[[names.session,{...identity,p_start_event_id:start}],[names.self,selfArgs()],[names.review,{...owner,p_query:reviewList}],[names.decision,decisionArgs()]];
  for(const [name,args] of signatures){
    const missing={...args};delete missing.p_auth_user_id;
    await rejectedWithoutSql(name,[missing,{...args,p_site_id:'99990002'},{...args,p_auth_user_id:id(999)},
      {...args,p_auth_user_id:"x';select 1;--"},{...args,p_extra:null}],/invalid_rpc_arguments|invalid_site|invalid_actor/);
  }
});

test('lossy JSON values cannot alter the approved query or command between validation and SQL',async()=>{
  const f=fixture();
  const query=Object.defineProperty({...detail},'toJSON',{enumerable:false,value:()=>({...detail,expectedWorkerId:id(999)})});
  await assert.rejects(f.transport.rpc(names.self,selfArgs(query,submit)),/non_json_arguments/);
  const command=Object.defineProperty({...decision},'toJSON',{enumerable:false,value:()=>({...decision,reason:'silently replaced'})});
  await assert.rejects(f.transport.rpc(names.decision,decisionArgs(command)),/non_json_arguments/);
  await assert.rejects(f.transport.rpc(names.self,selfArgs(detail,{...submit,expectedRevision:Infinity})),/invalid_command/);
  assert.deepEqual(f.statements,[]);assert.deepEqual(f.transport.calls,[]);
});

test('recognized SQL denials remain errors, unexpected SQL failure and wrong execution role fail closed',async()=>{
  for(const code of ['attendance_access_denied','attendance_platform_paused','attendance_correction_policy_required','attendance_correction_evidence_changed','attendance_operation_conflict']){
    const f=fixture(()=>{throw Error(`ERROR: ${code}`);});assert.deepEqual(await f.transport.rpc(names.self,selfArgs(detail,submit)),{data:null,error:{message:code}});
    assert.equal(f.statements.length,1);assert.deepEqual(f.transport.errors,[]);
  }
  const broken=fixture(()=>{throw Error('synthetic connection unavailable');});await assert.rejects(broken.transport.rpc(names.decision,decisionArgs()),/synthetic connection unavailable/);assert.equal(broken.transport.errors.length,1);
  for(const reply of ['not json',JSON.stringify({role:'postgres',data:result}),JSON.stringify({role:'service_role',data:result,extra:true})]){
    const f=fixture(()=>reply);await assert.rejects(f.transport.rpc(names.review,{...owner,p_query:{mode:'detail',requestId}}));assert.equal(f.transport.errors.length,1);
  }
});

test('continuous revision prepare/detail and original receipt GET preserve the exact five-field query',async()=>{
  const f=fixture();
  for(const query of [cyclePrepare,cycleDetail,{...cycleDetail,operationId:id(809)}]){
    assert.deepEqual(await f.transport.rpc(revisionNames.self,cycleArgs(query)),{data:result,error:null});
    assert.equal(f.statements.at(-1),statement(revisionNames.self,`'99990001','${actors[2].id}',${json(query)},null,false`));
    const call=f.transport.calls.at(-1);assert.deepEqual(call.query,query);assert.equal(call.command,null);
    assert.equal(call.expectedWorkerId,worker);assert.equal(call.baseRequestId,rootRequestId);assert.equal(call.operationId,query.operationId);
    assert.equal(call.platformEnabled,false);
  }
  await rejectedWithoutSql(revisionNames.self,[
    ...[null,{},[],{...cyclePrepare,mode:'list'},{...cyclePrepare,requestId:operation},{...cyclePrepare,operationId:operation},
      {...cycleDetail,requestId:null},{...cycleDetail,baseRequestId:null},{...cycleDetail,expectedWorkerId:'all'},
      {...cycleDetail,operationId:'null'},{...cycleDetail,rootRequestId},{...cycleDetail,cursorId:null}].map(query=>cycleArgs(query)),
    cycleArgs(cycleDetail,null,null),cycleArgs(cycleDetail,null,'false'),{...cycleArgs(),p_command:undefined},
  ],/invalid_query|invalid_platform_gate|invalid_command/);
});

test('revision submit and withdrawal forward current source fences and leave authorization to SQL',async()=>{
  const f=fixture(),input=cycleArgs(structuredClone(cycleDetail),structuredClone(cycleSubmit),true);
  assert.deepEqual(await f.transport.rpc(revisionNames.self,input),{data:result,error:null});
  assert.equal(f.statements[0],statement(revisionNames.self,`'99990001','${actors[2].id}',${json(cycleDetail)},${json(cycleSubmit)},true`));
  input.p_command.expectedEffectiveOperationId=id(999);input.p_command.proposal.breaks[0].paid=true;input.p_query.baseRequestId=id(998);
  assert.deepEqual(f.transport.calls[0].command,cycleSubmit);assert.deepEqual(f.transport.calls[0].query,cycleDetail);
  const query={...cycleDetail,requestId},command={...withdraw};
  for(const actor of actors){
    await f.transport.rpc(revisionNames.self,{...cycleArgs(query,command,false),p_auth_user_id:actor.id});
    assert.equal(f.statements.at(-1),statement(revisionNames.self,`'99990001','${actor.id}',${json(query)},${json(command)},false`));
    assert.equal(f.transport.calls.at(-1).operationId,withdraw.operationId);assert.equal(f.transport.calls.at(-1).platformEnabled,false);
  }
  // Equal root/effective source is valid for the first cycle. A stale but typed
  // source, disabled module or wrong known principal must reach actual SQL.
  await f.transport.rpc(revisionNames.self,{...cycleArgs(cycleDetail,{...cycleSubmit,expectedEffectiveOperationId:rootOperationId},false),p_auth_user_id:actors[0].id});
  assert.equal(f.transport.calls.at(-1).actor,actors[0].id);assert.equal(f.transport.calls.at(-1).command.expectedEffectiveOperationId,rootOperationId);
});

test('revision commands reject missing current-source fence, mixed reads and malformed proposals before SQL',async()=>{
  const {expectedEffectiveOperationId:omitted,...legacy}=cycleSubmit;assert.equal(omitted,effectiveOperationId);
  await rejectedWithoutSql(revisionNames.self,[
    cycleArgs(cycleDetail,legacy,true),cycleArgs(cyclePrepare,cycleSubmit,true),cycleArgs({...cycleDetail,requestId},cycleSubmit,true),
    cycleArgs({...cycleDetail,operationId:operation},cycleSubmit,true),cycleArgs(cycleDetail,withdraw,false),
    ...[{action:'approve'},{extra:true},{reason:''},{reason:' x'},{reason:'x\u0085'},{reason:'😀'.repeat(501)},
      {expectedRevision:-1},{expectedRevision:1.5},{expectedRevision:Number.MAX_SAFE_INTEGER-2},{expectedRevision:NaN},
      {expectedPolicyRevision:0},{expectedPolicyRevision:'1'},{expectedPolicyRevision:Number.MAX_SAFE_INTEGER-1},
      {expectedBaseOperationId:null},{expectedEffectiveOperationId:undefined},{expectedEffectiveOperationId:'ALL'},
      {proposal:{...proposal,extra:true}},{proposal:{...proposal,breaks:[{...proposal.breaks[0],paid:0}]}},
      {proposal:{...proposal,startAt:end}},{proposal:{...proposal,breaks:Array(33).fill(proposal.breaks[0])}}]
      .map(patch=>cycleArgs(cycleDetail,{...cycleSubmit,...patch},true)),
    cycleArgs({...cycleDetail,requestId},{...withdraw,expectedBaseOperationId:rootOperationId}),
  ],/invalid_command|mixed_write_read/);
  const f=fixture();await f.transport.rpc(revisionNames.self,cycleArgs(cycleDetail,{...cycleSubmit,reason:'😀'.repeat(500),
    expectedRevision:Number.MAX_SAFE_INTEGER-3,expectedPolicyRevision:Number.MAX_SAFE_INTEGER-2,proposal:{...proposal,breaks:[]}},true));
  assert.equal(f.statements.length,1);
});

test('current revision owner review is an exact read-only request UUID for every known principal',async()=>{
  const f=fixture();
  for(const actor of actors){
    assert.deepEqual(await f.transport.rpc(revisionNames.review,{...owner,p_auth_user_id:actor.id,p_request_id:requestId}),{data:result,error:null});
    assert.equal(f.statements.at(-1),statement(revisionNames.review,`'99990001','${actor.id}','${requestId}'`));
    assert.deepEqual(f.transport.calls.at(-1).query,{requestId});assert.equal(f.transport.calls.at(-1).requestId,requestId);
    assert.equal(f.transport.calls.at(-1).command,null);assert.equal(f.transport.calls.at(-1).operationId,null);
  }
  await rejectedWithoutSql(revisionNames.review,[owner,{...owner,p_request_id:null},{...owner,p_request_id:'not-a-uuid'},
    {...owner,p_request_id:requestId,p_command:null},{...owner,p_request_id:requestId,p_operation_id:null}],/invalid_rpc_arguments|invalid_request_id/);
});

test('current revision decisions preserve seven-field CAS commands and six-argument receipt reads',async()=>{
  const f=fixture();
  for(const gate of [false,true]){
    await f.transport.rpc(revisionNames.decision,{...decisionArgs(null,gate),p_operation_id:operation});
    assert.equal(f.statements.at(-1),statement(revisionNames.decision,`'99990001','${actors[0].id}','${requestId}',null,'${operation}',${gate}`));
    assert.deepEqual(f.transport.calls.at(-1).query,{requestId,operationId:operation});assert.equal(f.transport.calls.at(-1).allowWrite,gate);
    for(const action of ['approve','reject']){
      const command={...revisionDecision,action};await f.transport.rpc(revisionNames.decision,decisionArgs(command,gate));
      assert.equal(f.statements.at(-1),statement(revisionNames.decision,`'99990001','${actors[0].id}','${requestId}',${json(command)},null,${gate}`));
      assert.deepEqual(f.transport.calls.at(-1).command,command);assert.equal(f.transport.calls.at(-1).operationId,command.operationId);
    }
  }
  const input=decisionArgs({...revisionDecision},true);await f.transport.rpc(revisionNames.decision,input);input.p_command.reason='changed';
  assert.deepEqual(f.transport.calls.at(-1).command,revisionDecision);
  await f.transport.rpc(revisionNames.decision,{...decisionArgs(revisionDecision,false),p_auth_user_id:actors[1].id});
  assert.equal(f.transport.calls.at(-1).actor,actors[1].id);assert.equal(f.transport.calls.at(-1).allowWrite,false);
  await rejectedWithoutSql(revisionNames.decision,[
    decisionArgs(decision,true),{...decisionArgs(),p_request_id:null},{...decisionArgs(),p_operation_id:'null'},
    {...decisionArgs(),p_allow_write:0},{...decisionArgs(),p_command:undefined},
    {...decisionArgs(revisionDecision),p_operation_id:operation},decisionArgs({...revisionDecision,requestId:operation}),
    ...[{action:'withdraw'},{extra:true},{expectedBaseOperationId:null},{expectedBaseOperationId:42},
      {expectedRevision:0},{expectedRevision:Infinity},{expectedEvidence:'A'.repeat(32)},{reason:'\n'}]
      .map(patch=>decisionArgs({...revisionDecision,...patch},true)),
  ],/invalid_request_id|invalid_operation|invalid_write_gate|invalid_decision|mixed_write_read/);
});

test('revision history keeps owner submission-period and self root-history scopes separate, with exact cursor precision',async()=>{
  const f=fixture();
  for(const query of [historyOwner,historySelf,
    ...['all','submitted','approved','rejected','withdrawn'].map(status=>({...historyOwner,status,asOf:at,cursorAt:at,cursorId:requestId})),
    {...historySelf,asOf:at,cursorAt:at,cursorId:requestId}]){
    assert.deepEqual(await f.transport.rpc(revisionNames.history,{...owner,p_query:query}),{data:result,error:null});
    assert.equal(f.statements.at(-1),statement(revisionNames.history,`'99990001','${actors[0].id}',${json(query)}`));
    assert.deepEqual(f.transport.calls.at(-1).query,query);assert.equal(f.transport.calls.at(-1).command,null);
  }
  const input={...identity,p_query:{...historyOwner}};await f.transport.rpc(revisionNames.history,input);input.p_query.status='changed';
  assert.deepEqual(f.transport.calls.at(-1).query,historyOwner);assert.equal(f.transport.calls.at(-1).actor,actors[2].id);
  assert.deepEqual(f.transport.errors,[]);
});

test('revision history rejects cross-scope keys, invalid dates, unsafe periods and unpaired cursors before SQL',async()=>{
  const invalid=[null,{},[],{...historySelf,access:'manager'},{...historySelf,scope:'submission-period'},
    {...historyOwner,scope:'root-history'},{...historySelf,expectedWorkerId:null},{...historySelf,rootRequestId:'all'},
    {...historySelf,fromAt:at},{...historyOwner,expectedWorkerId:null},{...historyOwner,workerId:worker},{...historyOwner,status:'pending'},
    {...historyOwner,asOf:at.slice(0,23)+'Z'},{...historyOwner,asOf:'2026-02-30T00:00:00.000000Z'},
    {...historyOwner,cursorAt:at},{...historyOwner,cursorId:requestId},{...historyOwner,cursorAt:at,cursorId:requestId},
    {...historyOwner,asOf:at,cursorAt:end,cursorId:requestId},{...historyOwner,asOf:end,cursorAt:'2026-10-01T23:59:59.999999Z',cursorId:requestId},
    {...historyOwner,asOf:'2026-10-03T00:00:00.000000Z',cursorAt:historyOwner.toAt,cursorId:requestId},
    {...historyOwner,fromAt:historyOwner.toAt},{...historyOwner,toAt:'2026-11-03T00:00:00.000000Z'},
    {...historyOwner,fromAt:'1999-12-31T00:00:00.000000Z',toAt:'2000-01-01T00:00:00.000000Z'},
    {...historyOwner,fromAt:'2100-12-31T00:00:00.000000Z',toAt:'2101-01-01T00:00:00.000001Z'},
    {...historySelf,asOf:at,cursorAt:end,cursorId:requestId}];
  await rejectedWithoutSql(revisionNames.history,invalid.map(p_query=>({...identity,p_query})),/invalid_query/);
  const f=fixture();await f.transport.rpc(revisionNames.history,{...owner,p_query:{...historyOwner,fromAt:'2100-12-01T00:00:00.000000Z',toAt:'2101-01-01T00:00:00.000000Z'}});
  assert.equal(f.statements.length,1); // Future asOf/business availability remain SQL checks.
});

test('revision RPCs reject inherited/legacy identifiers, extra arguments and non-synthetic actors or sites',async()=>{
  const f=fixture();
  for(const name of ['constructor','__proto__','faolla_attendance_revision_self_v1','faolla_attendance_revision_owner_review_v1',
    'faolla_attendance_revision_owner_review_v2','faolla_attendance_revision_decide_v1','faolla_attendance_revision_effect_at_v1',
    'faolla_attendance_revision_history_v1);delete from public.merchants;--'])await assert.rejects(f.transport.rpc(name,{}),/unexpected_rpc/);
  const signatures=[[revisionNames.self,cycleArgs()],[revisionNames.review,{...owner,p_request_id:requestId}],
    [revisionNames.decision,decisionArgs()],[revisionNames.history,{...identity,p_query:historySelf}]];
  for(const [name,args] of signatures){
    const missing={...args};delete missing.p_auth_user_id;
    const inherited=Object.assign(Object.create({p_auth_user_id:args.p_auth_user_id}),missing);
    await rejectedWithoutSql(name,[missing,inherited,{...args,p_extra:null},{...args,p_site_id:'99990002'},
      {...args,p_auth_user_id:id(999)},{...args,p_auth_user_id:"x';select 1;--"}],/invalid_rpc_arguments|invalid_site|invalid_actor/);
  }
  assert.deepEqual(f.statements,[]);assert.deepEqual(f.transport.calls,[]);
});

test('revision transport preserves real SQL denials and execution-role failures without fabricating outcomes',async()=>{
  for(const [name,input] of [[revisionNames.self,cycleArgs(cycleDetail,cycleSubmit,true)],
    [revisionNames.review,{...owner,p_request_id:requestId}],[revisionNames.decision,decisionArgs(revisionDecision,true)],
    [revisionNames.history,{...identity,p_query:historySelf}]]){
    for(const code of ['attendance_access_denied','attendance_platform_paused','attendance_revision_base_changed','attendance_correction_evidence_changed']){
      const f=fixture(()=>{throw Error(`ERROR: ${code}`);});
      assert.deepEqual(await f.transport.rpc(name,input),{data:null,error:{message:code}});assert.deepEqual(f.transport.errors,[]);assert.equal(f.statements.length,1);
    }
    const wrongRole=fixture(()=>JSON.stringify({role:'authenticated',data:result}));
    await assert.rejects(wrongRole.transport.rpc(name,input),/wrong_database_role/);assert.equal(wrongRole.transport.errors.length,1);
  }
  const f=fixture(),query=Object.defineProperty({...cycleDetail},'toJSON',{enumerable:false,value:()=>({...cycleDetail,baseRequestId:id(999)})});
  await assert.rejects(f.transport.rpc(revisionNames.self,cycleArgs(query,cycleSubmit)),/non_json_arguments/);
  assert.deepEqual(f.statements,[]);assert.deepEqual(f.transport.calls,[]);
});

test('versioned owner and scoped reports use exact current RPC queries without synthetic totals',async()=>{
  const f=fixture();
  for(const [name,query] of [[reportNames.owner,ownerReport],[reportNames.scoped,selfReport],[reportNames.scoped,{...selfReport,expectedWorkerId:null}],
    [reportNames.scoped,managerReport]]){
    const input={...identity,p_query:structuredClone(query)};
    assert.deepEqual(await f.transport.rpc(name,input),{data:result,error:null});
    assert.equal(f.statements.at(-1),statement(name,`'99990001','${actors[2].id}',${json(query)}`));
    assert.deepEqual(f.transport.calls.at(-1).query,query);assert.equal(f.transport.calls.at(-1).command,null);assert.equal(f.transport.calls.at(-1).operationId,null);
    input.p_query.fromDate='2000-01-01';assert.deepEqual(f.transport.calls.at(-1).query,query);
  }
  // A known owner calling self, or employee calling owner, reaches the actual
  // SQL actor/permission check; the transport must not invent that decision.
  await f.transport.rpc(reportNames.scoped,{...owner,p_query:selfReport});assert.equal(f.transport.calls.at(-1).actor,actors[0].id);
  assert.deepEqual(f.transport.errors,[]);
});

test('report date windows are exact calendar days within 2000–2100 and at most 31 inclusive days',async()=>{
  const patches=[{fromDate:null},{throughDate:undefined},{fromDate:'2026-1-01'},{fromDate:'2026-10-01T00:00:00Z'},
    {fromDate:'2026-02-30',throughDate:'2026-03-01'},{fromDate:'2100-02-29',throughDate:'2100-03-01'},
    {fromDate:'2026-10-02',throughDate:'2026-10-01'},{throughDate:'2026-11-01'},
    {fromDate:'1999-12-31',throughDate:'2000-01-01'},{fromDate:'2100-12-31',throughDate:'2101-01-01'}];
  for(const [name,query] of [[reportNames.owner,ownerReport],[reportNames.scoped,selfReport],[reportNames.export,exportQuery]])
    await rejectedWithoutSql(name,patches.map(patch=>name===reportNames.export?exportArgs({...query,...patch}):({...identity,p_query:{...query,...patch}})),/invalid_query/);
  const f=fixture();
  for(const dates of [{fromDate:'2000-02-29',throughDate:'2000-02-29'},{fromDate:'2000-01-01',throughDate:'2000-01-31'},
    {fromDate:'2100-12-01',throughDate:'2100-12-31'}])await f.transport.rpc(reportNames.owner,{...owner,p_query:{...ownerReport,...dates}});
  assert.equal(f.statements.length,3);
});

test('report queries cannot switch access axes, omit null pins or add snapshot/mutation fields',async()=>{
  await rejectedWithoutSql(reportNames.owner,[null,{},[],{...ownerReport,workerId:null},{...ownerReport,workerId:'all'},
    {...ownerReport,access:'owner'},{...ownerReport,asOf:at},{...ownerReport,operationId:operation}].map(p_query=>({...owner,p_query})),/invalid_query/);
  const {expectedWorkerId:omitted,...missingPin}=selfReport;assert.equal(omitted,worker);
  await rejectedWithoutSql(reportNames.scoped,[null,{},[],missingPin,{...selfReport,access:'owner'},
    {...selfReport,workerId:worker},{...selfReport,locationId},{...selfReport,expectedWorkerId:'all'},
    {...selfReport,scopeRevision:1},{...selfReport,extra:true},{...managerReport,workerId:null},
    {...managerReport,locationId:null},{...managerReport,expectedWorkerId:worker}].map(p_query=>({...identity,p_query})),/invalid_query/);
});

test('scoped report discovery preserves exact self and paired manager cursor shapes',async()=>{
  const f=fixture(),selfContext={access:'self',search:'',cursor:null,scopeRevision:null};
  const managerContext={access:'manager',search:"合成 ' quoted \\ query",cursor:worker+'.'+locationId,scopeRevision:2};
  for(const query of [selfContext,{...managerContext,cursor:null,scopeRevision:null},managerContext]){
    const input={...identity,p_query:structuredClone(query)};
    assert.deepEqual(await f.transport.rpc(reportNames.context,input),{data:result,error:null});
    assert.equal(f.statements.at(-1),statement(reportNames.context,`'99990001','${actors[2].id}',${json(query)}`));
    assert.deepEqual(f.transport.calls.at(-1).query,query);assert.equal(f.transport.calls.at(-1).command,null);
    input.p_query.search='changed';assert.deepEqual(f.transport.calls.at(-1).query,query);
  }
  await f.transport.rpc(reportNames.context,{...owner,p_query:selfContext});assert.equal(f.transport.calls.at(-1).actor,actors[0].id);
  const invalid=[null,{},[],{...selfContext,access:'owner'},{...selfContext,search:'worker'},{...selfContext,expectedWorkerId:worker},
    {...selfContext,cursor:worker+'.'+locationId,scopeRevision:1},{...selfContext,scopeRevision:1},
    ...[{search:' x'},{search:'x '},{search:'x\n'},{search:'字'.repeat(81)},{cursor:worker},{cursor:worker+'.not-a-uuid'},
      {cursor:worker+'.'+locationId+'.'+worker},{cursor:null},{scopeRevision:null},{scopeRevision:0},
      {scopeRevision:'1'},{scopeRevision:Number.MAX_SAFE_INTEGER}].map(patch=>({...managerContext,...patch}))];
  await rejectedWithoutSql(reportNames.context,invalid.map(p_query=>({...identity,p_query})),/invalid_query/);
  await f.transport.rpc(reportNames.context,{...identity,p_query:{...managerContext,search:'字'.repeat(80),scopeRevision:Number.MAX_SAFE_INTEGER-1}});
});

test('controlled v2 export forwards its metadata operation and all eight pinned query fields unchanged',async()=>{
  const f=fixture(),queries=[exportQuery,{...selfReport,expectedTimeZone:'UTC',expectedScopeRevision:null},
    {...managerReport,expectedTimeZone:'Atlantic/Canary',expectedScopeRevision:2}];
  for(const query of queries)for(const actor of actors){
    const input={...exportArgs(structuredClone(query)),p_auth_user_id:actor.id};
    assert.deepEqual(await f.transport.rpc(reportNames.export,input),{data:result,error:null});
    assert.equal(f.statements.at(-1),statement(reportNames.export,`'99990001','${actor.id}','${operation}',${json(query)}`));
    assert.equal(f.transport.calls.at(-1).operationId,operation);assert.equal(f.transport.calls.at(-1).command,null);
    assert.deepEqual(f.transport.calls.at(-1).query,query);input.p_query.expectedTimeZone='UTC';assert.deepEqual(f.transport.calls.at(-1).query,query);
  }
  // Retry is not synthesized into a second CSV; only the actual SQL response
  // can supply receipt/replayed/report semantics or deny current permission.
  await f.transport.rpc(reportNames.export,exportArgs());await f.transport.rpc(reportNames.export,exportArgs());
  assert.equal(f.statements.at(-1),f.statements.at(-2));assert.deepEqual(f.transport.errors,[]);
});

test('controlled export rejects missing IDs, widened scopes and unsafe time-zone or version pins before SQL',async()=>{
  const managerExport={...managerReport,expectedTimeZone:'Europe/Madrid',expectedScopeRevision:1};
  const selfExport={...selfReport,expectedTimeZone:'Europe/Madrid',expectedScopeRevision:null};
  const invalid=[null,{},[],{...exportQuery,access:'all'},{...exportQuery,workerId:null},{...exportQuery,locationId},
    {...exportQuery,expectedWorkerId:worker},{...exportQuery,expectedScopeRevision:1},{...exportQuery,asOf:at},
    {...exportQuery,sourceVersion:'raw-and-approved-v1'},{...selfExport,expectedWorkerId:null},{...selfExport,workerId:worker},
    {...selfExport,locationId},{...selfExport,expectedScopeRevision:1},{...managerExport,expectedWorkerId:worker},
    {...managerExport,locationId:null},{...managerExport,workerId:null},
    ...[null,0,1.5,'1',Number.MAX_SAFE_INTEGER,NaN].map(expectedScopeRevision=>({...managerExport,expectedScopeRevision})),
    ...[null,123,'',' UTC','UTC ','+02:00','GMT','Europe/Not_A_Zone','x'.repeat(101)].map(expectedTimeZone=>({...exportQuery,expectedTimeZone}))];
  await rejectedWithoutSql(reportNames.export,invalid.map(query=>exportArgs(query)),/invalid_query/);
  await rejectedWithoutSql(reportNames.export,[exportArgs(exportQuery,null),exportArgs(exportQuery,'not-a-uuid'),exportArgs(exportQuery,123)],/invalid_operation/);
  const f=fixture();await f.transport.rpc(reportNames.export,exportArgs({...managerExport,expectedScopeRevision:Number.MAX_SAFE_INTEGER-1}));
  assert.equal(f.statements.length,1);
});

test('only current report RPCs with own-property signatures and synthetic principals can execute',async()=>{
  const f=fixture();
  for(const name of ['constructor','__proto__','faolla_attendance_period_report_v1','faolla_attendance_scoped_period_report_v1',
    'faolla_attendance_period_export_v1','faolla_attendance_effect_current_v2','faolla_attendance_period_report_v2);delete from public.merchants;--'])
    await assert.rejects(f.transport.rpc(name,{}),/unexpected_rpc/);
  const signatures=[[reportNames.owner,{...owner,p_query:ownerReport}],[reportNames.scoped,{...identity,p_query:selfReport}],
    [reportNames.context,{...identity,p_query:{access:'self',search:'',cursor:null,scopeRevision:null}}],[reportNames.export,exportArgs()]];
  for(const [name,args] of signatures){
    const missing={...args};delete missing.p_auth_user_id;
    await rejectedWithoutSql(name,[missing,Object.assign(Object.create({p_auth_user_id:args.p_auth_user_id}),missing),
      {...args,p_site_id:'99990002'},{...args,p_auth_user_id:id(999)},{...args,p_auth_user_id:"x';select 1;--"},
      {...args,p_command:null},{...args,p_allow_write:true}],/invalid_rpc_arguments|invalid_site|invalid_actor/);
  }
  assert.deepEqual(f.statements,[]);assert.deepEqual(f.transport.calls,[]);
});

test('report and export SQL errors pass through without fabricated totals, receipts or role bypass',async()=>{
  for(const [name,input] of [[reportNames.owner,{...owner,p_query:ownerReport}],[reportNames.scoped,{...identity,p_query:selfReport}],
    [reportNames.context,{...identity,p_query:{access:'self',search:'',cursor:null,scopeRevision:null}}],[reportNames.export,exportArgs()]]){
    for(const code of ['attendance_access_denied','attendance_export_denied','attendance_worker_changed','attendance_report_zone_changed',
      'attendance_version_conflict','attendance_operation_conflict','attendance_report_too_large']){
      const f=fixture(()=>{throw Error(`ERROR: ${code}`);});
      assert.deepEqual(await f.transport.rpc(name,input),{data:null,error:{message:code}});assert.deepEqual(f.transport.errors,[]);assert.equal(f.statements.length,1);
    }
    const wrongRole=fixture(()=>JSON.stringify({role:'postgres',data:result}));
    await assert.rejects(wrongRole.transport.rpc(name,input),/wrong_database_role/);assert.equal(wrongRole.transport.errors.length,1);
  }
  const f=fixture(),query=Object.defineProperty({...exportQuery},'toJSON',{enumerable:false,value:()=>({...exportQuery,workerId:id(999)})});
  await assert.rejects(f.transport.rpc(reportNames.export,exportArgs(query)),/non_json_arguments/);
  assert.deepEqual(f.statements,[]);assert.deepEqual(f.transport.calls,[]);
});

test('correction-flow harness requires the merchant shell and rejects every other scenario before build or server',()=>{
  const cases=[
    [['--correction-flow','--check-only'],'attendance_correction_flow_requires_merchant_shell'],
    ...['--controls','--location-settings','--employee-location','--location-exceptions','--schedule','--correction','--unknown']
      .map(conflict=>[['--merchant-shell','--correction-flow',conflict,'--check-only'],'attendance_correction_flow_conflicting_entry_flags']),
  ];
  for(const [flags,error] of cases){
    const child=spawnSync(process.execPath,['scripts/attendance-self-browser-harness.mjs',...flags],
      {cwd:new URL('..',import.meta.url),encoding:'utf8',windowsHide:true,shell:false,timeout:10000,maxBuffer:32768});
    assert.equal(child.error,undefined);assert.equal(child.signal,null);assert.equal(child.status,1);assert(child.stderr.includes(error),child.stderr);
    assert(!child.stdout.includes('inMemoryBundle'));assert(!child.stdout.includes('Attendance synthetic component QA'));assert(!child.stdout.includes('serverStarted'));
  }
});

test('correction-flow runner rejects multiple modes before the explicit-directory gate or database work',()=>{
  // Deliberately supply NO --run-local or --directory. Even if the mode guard
  // regresses, the separate required-directory gate cannot reach a PG cluster.
  for(const conflict of ['--controls','--location-settings','--employee-location','--location-exceptions']){
    const child=spawnSync(process.execPath,['--import','tsx','scripts/merchant-attendance-audit-shell-browser-check.mjs','--correction-flow',conflict],
      {cwd:new URL('..',import.meta.url),encoding:'utf8',windowsHide:true,shell:false,timeout:10000,maxBuffer:32768});
    assert.equal(child.error,undefined);assert.equal(child.signal,null);assert.equal(child.status,1);assert(child.stderr.includes('attendance_shell_conflicting_scenarios'),child.stderr);
    assert(!child.stderr.includes('attendance_reuse_'));assert(!child.stdout.includes('PASS '));assert(!child.stdout.includes('baselineRestored'));
    assert(!child.stdout.includes('Attendance synthetic component QA'));assert(!child.stdout.includes('inMemoryBundle'));
  }
});

test('correction-flow changes only its eleven opt-in frontend defines and keeps other candidate defaults off',()=>{
  const source=readFileSync(new URL('./attendance-self-browser-harness.mjs',import.meta.url),'utf8');
  const start=source.indexOf('const demo ='),build=source.indexOf('const bundle = await build(');
  const defineStart=source.indexOf('define: {',build),defineEnd=source.indexOf(', logLevel:',defineStart);
  assert(start>=0&&build>start&&defineStart>build&&defineEnd>defineStart);
  // Evaluate ONLY the actual argument/define preparation, never imports,
  // esbuild, CSS compilation or listen(). This is not bundle/browser evidence.
  const prefix=source.slice(start,build),defines=source.slice(defineStart+'define: '.length,defineEnd);
  const readDefines=flags=>JSON.parse(JSON.stringify(runInNewContext(`${prefix}\n({withCorrectionFlow,entry,defines:(${defines})});`,
    {process:{argv:['node','synthetic-harness',...flags]}},{timeout:1000})));
  const baseline=readDefines(['--merchant-shell']),enabled=readDefines(['--merchant-shell','--correction-flow']);
  assert.equal(baseline.withCorrectionFlow,false);assert.equal(enabled.withCorrectionFlow,true);assert.equal(enabled.entry,baseline.entry);
  assert.equal(enabled.entry,'scripts/fixtures/attendance-merchant-shell-browser.tsx');
  const key=name=>'process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_'+name+'_ENABLED';
  const expected=['CORRECTIONS','CORRECTION_REVIEW','CORRECTION_CONTROLS','CORRECTION_DECISIONS','CURRENT_CORRECTION_DECISIONS',
    'REVISION_HISTORY','REVISION_DECISIONS','REVISION_CYCLES','TIMESHEET','SCOPED_TIMESHEET','TIMESHEET_EXPORT'].map(key).sort();
  const changed=[...new Set([...Object.keys(baseline.defines),...Object.keys(enabled.defines)])]
    .filter(name=>baseline.defines[name]!==enabled.defines[name]).sort();assert.deepEqual(changed,expected);
  for(const name of expected){assert.notEqual(baseline.defines[name],'"1"');assert.equal(enabled.defines[name],'"1"');}
  for(const name of ['LOCATION_WORKSPACE','EMPLOYEE_LOCATION_WORKSPACE','EXCEPTION_WORKSPACE','SCHEDULE','MISSING','TERMINALS','PIN','PIN_CLOCK','EVENT_CHANNELS','UNIFIED_REPORT','UNIFIED_EXPORT'])
    assert.equal(enabled.defines[key(name)],'"0"',name);
  const controls=readDefines(['--merchant-shell','--controls']);
  assert.equal(controls.withCorrectionFlow,false);assert.equal(controls.defines[key('CORRECTION_CONTROLS')],'"1"');
  for(const name of ['CORRECTIONS','CORRECTION_REVIEW','CORRECTION_DECISIONS','CURRENT_CORRECTION_DECISIONS',
    'REVISION_HISTORY','REVISION_DECISIONS','REVISION_CYCLES','TIMESHEET','SCOPED_TIMESHEET','TIMESHEET_EXPORT'])assert.notEqual(controls.defines[key(name)],'"1"');
});
