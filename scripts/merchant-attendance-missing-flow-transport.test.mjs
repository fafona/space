// Pure boundary tests: the opaque marker is not a missing/report business reply.
// No database, browser, network, credentials or generated artifacts.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
import test from 'node:test';

const require=createRequire(import.meta.url);
const {createAttendanceAuditShellTransport,databaseId:id,databaseActors:actors}=require('./fixtures/attendance-audit-shell-transport.ts');
const names={missing:'faolla_attendance_missing_v1',report:'faolla_attendance_unified_report_v1',export:'faolla_attendance_unified_export_v1'};
const site='99990001',employee=actors[2].id,owner=actors[0].id,worker=id(201),location=id(401),operation=id(901),requestId=id(902);
const dates={fromDate:'2026-10-01',throughDate:'2026-10-31'};
const query={siteId:site,access:'self',...dates,requestId:null,operationId:null,beforeAt:null,beforeId:null};
const proposal={startAt:'2026-10-01T08:00:00.123456Z',endAt:'2026-10-01T16:00:00.123456Z',
  breaks:[{startAt:'2026-10-01T12:00:00.000001Z',endAt:'2026-10-01T12:30:00.000002Z',paid:false}]};
const submit={operationId:operation,reason:"合成漏卡 ' quote \\ slash",action:'submit',expectedWorkerId:worker,
  expectedSettingsVersion:1,expectedPolicyRevision:2,locationId:location,timeZone:'UTC',proposal};
const revise={...submit,action:'revise',supersedesRequestId:requestId,expectedApprovalOperationId:id(903)};
const withdraw={operationId:id(904),reason:'撤回合成申请',action:'withdraw',requestId,expectedRevision:1};
const approve={...withdraw,action:'approve',evidenceToken:'a'.repeat(32)};
const detail={...query,requestId},ownerDetail={...detail,access:'owner'};
const missingArgs=(q=query,c=null,allow=false,actor=employee)=>({p_query:q,p_auth_user_id:actor,p_command:c,p_allow_write:allow});
const ownerQuery={access:'owner',workerId:worker,...dates};
const selfQuery={access:'self',workerId:null,locationId:null,expectedWorkerId:worker,...dates};
const managerQuery={access:'manager',workerId:worker,locationId:location,expectedWorkerId:null,...dates};
const reportArgs=(q=ownerQuery,actor=owner)=>({p_site_id:site,p_auth_user_id:actor,p_query:q});
const exportQuery={...ownerQuery,locationId:null,expectedWorkerId:null,expectedTimeZone:'Europe/Madrid',expectedScopeRevision:null};
const exportArgs=(q=exportQuery,op=operation,actor=owner)=>({...reportArgs(q,actor),p_operation_id:op});
const marker={opaqueSqlMarker:'not-a-business-result'};
const json=value=>"'"+JSON.stringify(value).replaceAll("'","''")+"'::jsonb";
const statement=(name,args)=>`set standard_conforming_strings=on;set role service_role;select jsonb_build_object('role',current_user,'data',public.${name}(${args}));`;
function fixture(reply=()=>JSON.stringify({role:'service_role',data:marker})) {
  const statements=[],transport=createAttendanceAuditShellTransport(sql=>{statements.push(sql);return reply(sql);});
  return {transport,statements};
}
async function rejectInputs(name,inputs,pattern) {
  const f=fixture();
  for(const [index,input] of inputs.entries())await assert.rejects(f.transport.rpc(name,input),pattern,`malformed input ${index}`);
  assert.deepEqual(f.statements,[]);assert.deepEqual(f.transport.calls,[]);assert.deepEqual(f.transport.errors,[]);
}

test('missing exact four-argument RPC preserves query tenant, canonical cursors and original receipt lookup',async()=>{
  const f=fixture();
  for(const q of [query,{...query,access:'owner'},{...detail,operationId:id(910)},
    {...query,operationId:operation},{...query,beforeAt:'2026-10-02T10:00:00.123456Z',beforeId:requestId}]){
    assert.deepEqual(await f.transport.rpc(names.missing,missingArgs(q)),{data:marker,error:null});
    assert.equal(f.statements.at(-1),statement(names.missing,`${json(q)},'${employee}',null,false`));
    assert.deepEqual(f.transport.calls.at(-1),{name:names.missing,actor:employee,siteId:site,employeeId:null,
      operationId:q.operationId,command:null,query:q,allowWrite:false});
  }
});

test('missing accepts all current parsed actions without replacing SQL authority or paused-write decisions',async()=>{
  const f=fixture();
  for(const [q,c] of [[query,submit],[query,revise],[detail,withdraw],[ownerDetail,approve],[ownerDetail,{...approve,action:'reject'}]]){
    // Even owner+self and employee+owner combinations reach real SQL auth checks.
    for(const [actor,allow] of [[owner,false],[employee,true]]){
      assert.deepEqual(await f.transport.rpc(names.missing,missingArgs(q,c,allow,actor)),{data:marker,error:null});
      assert.equal(f.statements.at(-1),statement(names.missing,`${json(q)},'${actor}',${json(c)},${allow}`));
      const call=f.transport.calls.at(-1);assert.deepEqual(call.command,c);assert.equal(call.operationId,c.operationId);assert.equal(call.allowWrite,allow);
    }
  }
  assert.equal(f.statements.length,10);
});

test('missing rejects RPC extras, inherited keys, foreign tenants, nonallowlisted actors and nonboolean gates',async()=>{
  const inherited=Object.assign(Object.create({p_allow_write:false}),{p_query:query,p_auth_user_id:employee,p_command:null});
  await rejectInputs(names.missing,[
    {...missingArgs(),p_site_id:site},{...missingArgs(),extra:null},inherited,
    {...missingArgs(),p_auth_user_id:id(999)},{...missingArgs(),p_auth_user_id:null},
    ...['99990002',99990001,null,undefined].map(siteId=>missingArgs({...query,siteId})),
    ...[null,undefined,0,1,'false',{}].map(gate=>({...missingArgs(),p_allow_write:gate})),
  ],/invalid_rpc_arguments|invalid_site|invalid_actor|invalid_write_gate/);
});

test('missing queries reject extra fields, noncanonical types, invalid dates and mixed/unpaired cursors',async()=>{
  const {beforeId:omitted,...withoutCursor}=query;assert.equal(omitted,null);
  await rejectInputs(names.missing,[
    null,[],{},withoutCursor,{...query,authUserId:employee},{...query,access:'manager'},
    {...query,fromDate:'2026-02-30'},{...query,throughDate:'2026-11-01'},
    {...query,throughDate:'2026-09-30'},{...query,fromDate:'1999-12-31'},
    {...query,requestId:42},{...query,operationId:'null'},
    {...query,beforeId:requestId},{...query,beforeAt:'2026-10-02T10:00:00.123456Z'},
    {...query,beforeAt:'2026-10-02T10:00:00.123Z',beforeId:requestId},
    {...query,beforeAt:'2026-02-30T10:00:00.123456Z',beforeId:requestId},
    {...detail,beforeAt:'2026-10-02T10:00:00.123456Z',beforeId:requestId},
    {...query,operationId:operation,beforeAt:'2026-10-02T10:00:00.123456Z',beforeId:requestId},
  ].map(q=>missingArgs(q)),/invalid_site|invalid_query/);
});

test('missing commands reject extra fields, wrong access/target, read-operation mixes and malformed fences',async()=>{
  await rejectInputs(names.missing,[
    ...[undefined,{},[],{...submit,extra:true},{...submit,expectedWorkerId:null},{...submit,locationId:'wrong'},
      {...submit,expectedSettingsVersion:'1'},{...submit,expectedSettingsVersion:0},
      {...submit,expectedPolicyRevision:Number.MAX_SAFE_INTEGER},{...submit,timeZone:'+02:00'},
      {...submit,reason:''},{...submit,reason:' padded '},{...submit,reason:'x'.repeat(201)},
      {...submit,reason:'bad\u0085note'},{...revise,supersedesRequestId:operation},
      {...revise,expectedApprovalOperationId:operation}].map(c=>({...missingArgs(query,null,true),p_command:c})),
    missingArgs({...query,access:'owner'},submit,true),missingArgs(detail,submit,true),
    missingArgs({...query,operationId:id(910)},submit,true),
    missingArgs(query,withdraw,true),missingArgs(ownerDetail,withdraw,true),
    missingArgs(detail,approve,true),missingArgs(ownerDetail,{...approve,requestId:id(950)},true),
    missingArgs(ownerDetail,{...approve,expectedRevision:2},true),missingArgs(ownerDetail,{...approve,evidenceToken:'A'.repeat(32)},true),
    missingArgs(ownerDetail,{...approve,evidenceToken:'a'.repeat(31)},true),missingArgs(ownerDetail,{...approve,action:'unknown'},true),
  ],/invalid_command/);
});

test('missing proposals keep microseconds and enforce 24-hour/eight-break/exact nested shape limits',async()=>{
  const f=fixture();
  const eight=Array.from({length:8},(_,n)=>({startAt:`2026-10-01T09:${String(n*2).padStart(2,'0')}:00.000001Z`,endAt:`2026-10-01T09:${String(n*2+1).padStart(2,'0')}:00.000002Z`,paid:n%2===0}));
  const boundary={...proposal,endAt:'2026-10-02T08:00:00.123456Z',breaks:eight};
  await f.transport.rpc(names.missing,missingArgs(query,{...submit,proposal:boundary},true));
  assert.deepEqual(f.transport.calls[0].command.proposal,boundary);
  await rejectInputs(names.missing,[
    {...boundary,endAt:'2026-10-02T08:00:00.123457Z'},
    {...proposal,startAt:'2026-10-01T08:00:00.123Z'},
    {...proposal,endAt:proposal.startAt},{...proposal,extra:null},
    {...proposal,breaks:[...eight,{startAt:'2026-10-01T10:00:00.000000Z',endAt:'2026-10-01T10:10:00.000000Z',paid:false}]},
    {...proposal,breaks:[{...proposal.breaks[0],paid:'false'}]},
    {...proposal,breaks:[{...proposal.breaks[0],secret:'extra'}]},
    {...proposal,breaks:[proposal.breaks[0],proposal.breaks[0]]},
  ].map(p=>missingArgs(query,{...submit,proposal:p},true)),/invalid_command/);
});

test('missing SQL literals and detached logs preserve quoted reasons without persisting object mutations',async()=>{
  const f=fixture(),q=structuredClone(query),c=structuredClone(submit);
  await f.transport.rpc(names.missing,missingArgs(q,c,true));
  assert.equal(f.statements[0],statement(names.missing,`${json(query)},'${employee}',${json(submit)},true`));
  q.siteId='99990002';c.reason='changed';c.proposal.breaks[0].paid=true;
  assert.deepEqual(f.transport.calls[0].query,query);assert.deepEqual(f.transport.calls[0].command,submit);
});

test('unified report exact owner/self/manager queries forward only current SQL source reads',async()=>{
  const f=fixture();
  for(const q of [ownerQuery,selfQuery,{...selfQuery,expectedWorkerId:null},managerQuery]){
    assert.deepEqual(await f.transport.rpc(names.report,reportArgs(q)),{data:marker,error:null});
    assert.equal(f.statements.at(-1),statement(names.report,`'${site}','${owner}',${json(q)}`));
    assert.deepEqual(f.transport.calls.at(-1).query,q);assert.equal(f.transport.calls.at(-1).command,null);
  }
  await rejectInputs(names.report,[
    {...ownerQuery,locationId:null},{...ownerQuery,workerId:null},{...ownerQuery,access:'self'},
    {...selfQuery,expectedWorkerId:'bad'},{...selfQuery,workerId:worker},{...selfQuery,locationId:location},
    {...managerQuery,locationId:null},{...managerQuery,expectedWorkerId:worker},
    {...ownerQuery,fromDate:'2026-02-30'},{...ownerQuery,throughDate:'2026-11-01'},
    {...ownerQuery,throughDate:'2026-09-30'},{...ownerQuery,authUserId:employee},
  ].map(q=>reportArgs(q)),/invalid_query/);
});

test('unified export preserves exact eight-field scope, timezone, revision and immutable operation identity',async()=>{
  const f=fixture();
  const self={...exportQuery,access:'self',workerId:null,expectedWorkerId:worker};
  const manager={...exportQuery,access:'manager',locationId:location,expectedScopeRevision:4};
  for(const q of [exportQuery,self,manager]){
    assert.deepEqual(await f.transport.rpc(names.export,exportArgs(q)),{data:marker,error:null});
    assert.equal(f.statements.at(-1),statement(names.export,`'${site}','${owner}','${operation}',${json(q)}`));
    assert.equal(f.transport.calls.at(-1).operationId,operation);assert.deepEqual(f.transport.calls.at(-1).query,q);
  }
  await rejectInputs(names.export,[
    ...[null,undefined,'bad'].map(op=>({...exportArgs(),p_operation_id:op})),
    ...[{...exportQuery,workerId:null},{...exportQuery,expectedScopeRevision:1},{...exportQuery,locationId:location},
      {...self,expectedWorkerId:null},{...manager,locationId:null},{...manager,expectedScopeRevision:null},
      {...manager,expectedScopeRevision:'4'},{...manager,expectedScopeRevision:0},
      {...exportQuery,expectedTimeZone:'+02:00'},{...exportQuery,expectedTimeZone:'Unknown/Place'},
      {...exportQuery,fromDate:'2026-02-30'},{...exportQuery,throughDate:'2026-11-01'},
      {...exportQuery,command:null}].map(q=>exportArgs(q)),
  ],/invalid_operation|invalid_query/);
});

test('all new RPC names and own-property envelopes remain an explicit synthetic tenant/actor allowlist',async()=>{
  const f=fixture();
  for(const name of ['constructor','toString','faolla_attendance_unified_period_report_v1','faolla_attendance_unified_period_export_v1',names.report+';drop table x'])
    await assert.rejects(f.transport.rpc(name,reportArgs()),/unexpected_rpc/);
  assert.deepEqual(f.statements,[]);
  for(const [name,input] of [[names.report,reportArgs()],[names.export,exportArgs()]]){
    const {p_auth_user_id:actor,...noActor}=input;assert.equal(actor,owner);
    await rejectInputs(name,[{...input,p_site_id:'99990002'},{...input,p_site_id:99990001},
      {...input,p_auth_user_id:id(999)},{...input,p_auth_user_id:'owner'},noActor,
      {...input,p_allow_write:true},{...input,p_command:null},Object.assign(Object.create({p_auth_user_id:owner}),noActor),
    ],/invalid_site|invalid_actor|invalid_rpc_arguments/);
  }
});

test('all new RPCs return real structured SQL errors and enforce service_role result envelopes',async()=>{
  const cases=[[names.missing,missingArgs(query,submit,false)],[names.report,reportArgs()],[names.export,exportArgs()]];
  for(const [name,input] of cases){
    const denied=fixture(()=>{throw Error('ERROR: attendance_access_denied\nCONTEXT: protected SQL');});
    assert.deepEqual(await denied.transport.rpc(name,input),{data:null,error:{message:'attendance_access_denied'}});
    assert.equal(denied.statements.length,1);assert.deepEqual(denied.transport.errors,[]);
    for(const raw of [{role:'postgres',data:marker},{role:'service_role',data:marker,extra:true}]){
      const wrong=fixture(()=>JSON.stringify(raw));
      await assert.rejects(wrong.transport.rpc(name,input),/wrong_database_role/);assert.equal(wrong.transport.errors.length,1);
    }
  }
});

test('current default executors reach the three strict transports with no fabricated report or receipt',async()=>{
  const {executeAttendanceMissing}=require('../src/lib/merchantAttendanceMissing.server.ts');
  const {executeUnifiedTimesheet}=require('../src/lib/merchantAttendanceUnifiedTimesheet.server.ts');
  const {executeUnifiedExport}=require('../src/lib/merchantAttendanceUnifiedExport.server.ts');
  const f=fixture(()=>{throw Error('ERROR: attendance_access_denied');});
  const invoke=[
    ()=>executeAttendanceMissing({query,command:submit,authUserId:employee,allowWrite:true},f.transport),
    ()=>executeAttendanceMissing({query:{...query,operationId:operation},command:null,authUserId:employee,allowWrite:false},f.transport),
    ()=>executeUnifiedTimesheet({query:{siteId:site,...ownerQuery},authUserId:owner},f.transport),
    ()=>executeUnifiedTimesheet({query:{siteId:site,...selfQuery},authUserId:employee},f.transport),
    ()=>executeUnifiedExport({command:{siteId:site,operationId:operation,query:exportQuery},authUserId:owner},f.transport),
  ];
  for(const action of invoke)await assert.rejects(action,error=>error.code==='attendance_access_denied');
  assert.deepEqual(f.transport.calls.map(call=>call.name),[names.missing,names.missing,names.report,names.report,names.export]);
  assert.equal(f.statements.length,5);assert.deepEqual(f.transport.errors,[]);
});

function harnessConfiguration(flags) {
  const source=readFileSync(new URL('./attendance-self-browser-harness.mjs',import.meta.url),'utf8');
  const start=source.indexOf('const demo ='),build=source.indexOf('const bundle = await build(');
  const defineStart=source.indexOf('define: {',build),defineEnd=source.indexOf(', logLevel:',defineStart);
  assert(start>=0&&build>start&&defineStart>build&&defineEnd>defineStart);
  // Execute only argument preparation and the define expression: no imports,
  // esbuild invocation, filesystem writes, CSS generation or server startup.
  const prefix=source.slice(start,build),defines=source.slice(defineStart+'define: '.length,defineEnd);
  return JSON.parse(JSON.stringify(runInNewContext(`${prefix}\n({withCorrectionFlow,withMissingFlow,entry,defines:(${defines})});`,
    {process:{argv:['node','synthetic-harness',...flags]}},{timeout:1000})));
}

test('missing-flow requires the actual correction shell and rejects conflicting leaf entries before building',()=>{
  for(const flags of [['--missing-flow'],['--merchant-shell','--missing-flow'],['--correction-flow','--missing-flow']])
    assert.throws(()=>harnessConfiguration(flags),/attendance_missing_flow_requires_correction_shell/);
  for(const conflict of ['--missing','--unified','--unified-export','--schedule','--portal','--self','--database-entry',
    '--controls','--location-settings','--employee-location','--location-exceptions','--pin','--event-channels','--unknown'])
    assert.throws(()=>harnessConfiguration(['--merchant-shell','--correction-flow','--missing-flow',conflict]),/attendance_correction_flow_conflicting_entry_flags/);
  assert.equal(harnessConfiguration(['--merchant-shell','--correction-flow','--missing-flow','--check-only']).withMissingFlow,true);
});

test('missing-flow retains the merchant-shell entry and adds exactly three frontend flags to existing correction-flow',()=>{
  const plain=harnessConfiguration(['--merchant-shell']),base=harnessConfiguration(['--merchant-shell','--correction-flow']);
  const enabled=harnessConfiguration(['--merchant-shell','--correction-flow','--missing-flow']);
  assert.equal(plain.withMissingFlow,false);assert.equal(base.withMissingFlow,false);assert.equal(enabled.withMissingFlow,true);
  assert.equal(enabled.withCorrectionFlow,true);assert.equal(enabled.entry,base.entry);
  assert.equal(enabled.entry,'scripts/fixtures/attendance-merchant-shell-browser.tsx');
  const key=name=>'process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_'+name+'_ENABLED';
  const expected=['MISSING','UNIFIED_REPORT','UNIFIED_EXPORT'].map(key).sort();
  const changed=[...new Set([...Object.keys(base.defines),...Object.keys(enabled.defines)])]
    .filter(name=>base.defines[name]!==enabled.defines[name]).sort();
  assert.deepEqual(changed,expected);
  for(const name of expected){assert.equal(plain.defines[name],'"0"');assert.equal(base.defines[name],'"0"');assert.equal(enabled.defines[name],'"1"');}
  for(const feature of ['CORRECTIONS','CORRECTION_REVIEW','CORRECTION_CONTROLS','CORRECTION_DECISIONS','CURRENT_CORRECTION_DECISIONS',
    'REVISION_HISTORY','REVISION_DECISIONS','REVISION_CYCLES','TIMESHEET','SCOPED_TIMESHEET','TIMESHEET_EXPORT'])
    assert.equal(enabled.defines[key(feature)],'"1"');
  for(const feature of ['SCHEDULE','TERMINALS','PIN','PIN_CLOCK','EVENT_CHANNELS','LOCATION_WORKSPACE','EMPLOYEE_LOCATION_WORKSPACE','EXCEPTION_WORKSPACE'])
    assert.equal(enabled.defines[key(feature)],'"0"');
});
