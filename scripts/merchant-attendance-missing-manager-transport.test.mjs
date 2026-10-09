// Pure actual-executor/transport probes. The opaque SQL marker is deliberately
// not a report, approval or CSV result; no database or browser is started here.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import test from 'node:test';

const require=createRequire(import.meta.url);
const {createAttendanceAuditShellTransport,databaseActors:actors,databaseId:id}=require('./fixtures/attendance-audit-shell-transport.ts');
const {executeUnifiedTimesheet}=require('../src/lib/merchantAttendanceUnifiedTimesheet.server.ts');
const {executeUnifiedExport}=require('../src/lib/merchantAttendanceUnifiedExport.server.ts');
const {MerchantAttendanceError}=require('../src/lib/merchantAttendanceTime.ts');

const site='99990001',manager=actors[1].id,worker=id(201),location=id(401),operation=id(9201);
const reportQuery={siteId:site,access:'manager',workerId:worker,locationId:location,fromDate:'2026-10-01',throughDate:'2026-10-02'};
const reportWire={access:'manager',workerId:worker,locationId:location,expectedWorkerId:null,fromDate:'2026-10-01',throughDate:'2026-10-02'};
const exportCommand={siteId:site,operationId:operation,query:{...reportWire,expectedTimeZone:'Europe/Madrid',expectedScopeRevision:5}};
const names={report:'faolla_attendance_unified_report_v1',export:'faolla_attendance_unified_export_v1'};
const opaque={opaqueSqlMarker:'not-a-report-or-file'};
const json=value=>"'"+JSON.stringify(value).replaceAll("'","''")+"'::jsonb";
const statement=(name,args)=>`set standard_conforming_strings=on;set role service_role;select jsonb_build_object('role',current_user,'data',public.${name}(${args}));`;
const attendanceError=code=>error=>error instanceof MerchantAttendanceError&&error.code===code;

function fixture(sqlError=null){
  const statements=[],requests=[];
  const transport=createAttendanceAuditShellTransport(sql=>{
    statements.push(sql);
    if(sqlError)throw new Error(`ERROR: ${sqlError}`);
    return JSON.stringify({role:'service_role',data:opaque});
  });
  const service={rpc:async(name,args)=>{
    requests.push({name,args:structuredClone(args)});
    return transport.rpc(name,args);
  }};
  return {transport,statements,requests,service};
}

function assertManagerCall(f,name,query,operationId=null){
  assert.equal(f.requests.length,1,'no owner or legacy fallback RPC');
  assert.deepEqual(f.requests[0],{name,args:{p_site_id:site,p_auth_user_id:manager,
    ...(operationId?{p_operation_id:operationId}:{}),p_query:query}});
  assert.equal(f.statements.length,1);
  assert.equal(f.statements[0],statement(name,`'${site}','${manager}',${operationId?`'${operationId}',`:''}${json(query)}`));
  assert.equal(f.transport.calls.length,1);
  const call=f.transport.calls[0];
  assert.equal(call.name,name);assert.equal(call.actor,manager);assert.equal(call.siteId,site);
  assert.equal(call.operationId,operationId);assert.equal(call.command,null);assert.deepEqual(call.query,query);
  assert.deepEqual(f.transport.errors,[]);
}

test('actual unified report executor preserves the manager actor and exact worker/location pair through strict SQL transport',async()=>{
  const f=fixture();f.transport.state.moduleEnabled=false;
  await assert.rejects(executeUnifiedTimesheet({query:reportQuery,authUserId:manager},f.service),attendanceError('attendance_unavailable'));
  assertManagerCall(f,names.report,reportWire);
  assert.equal(f.transport.state.moduleEnabled,false);
  // The opaque transport marker must fail result parsing, not become an empty
  // successful report or trigger an owner read that broadens visibility.
});

test('actual unified export executor keeps the original operation, manager scope revision and timezone even while admission is paused',async()=>{
  const f=fixture();f.transport.state.moduleEnabled=false;
  await assert.rejects(executeUnifiedExport({command:exportCommand,authUserId:manager},f.service),attendanceError('attendance_unavailable'));
  assertManagerCall(f,names.export,exportCommand.query,operation);
  assert.equal(f.transport.calls[0].query.expectedScopeRevision,5);
  assert.equal(f.transport.calls[0].query.expectedTimeZone,'Europe/Madrid');
  assert.equal(f.transport.state.moduleEnabled,false);
});

test('actual manager executors fail closed on SQL access/export/version denials without owner fallback or a fabricated result',async()=>{
  // Report reads have no expected-revision argument: only the export protocol
  // exposes that typed conflict. Unexpected read errors remain unavailable.
  for(const [code,expected] of [['attendance_access_denied','attendance_access_denied'],['attendance_version_conflict','attendance_unavailable']]){
    const f=fixture(code);
    await assert.rejects(executeUnifiedTimesheet({query:reportQuery,authUserId:manager},f.service),attendanceError(expected));
    assertManagerCall(f,names.report,reportWire);
  }
  for(const code of ['attendance_export_denied','attendance_access_denied','attendance_version_conflict']){
    const f=fixture(code);
    await assert.rejects(executeUnifiedExport({command:exportCommand,authUserId:manager},f.service),attendanceError(code));
    assertManagerCall(f,names.export,exportCommand.query,operation);
  }
});

test('manager executor probes cannot substitute a foreign tenant/actor or drop the location/revision fences before SQL',async()=>{
  const probes=[
    service=>executeUnifiedTimesheet({query:{...reportQuery,siteId:'99990002'},authUserId:manager},service),
    service=>executeUnifiedTimesheet({query:reportQuery,authUserId:id(999)},service),
    service=>executeUnifiedTimesheet({query:{...reportQuery,locationId:null},authUserId:manager},service),
    service=>executeUnifiedExport({command:{...exportCommand,siteId:'99990002'},authUserId:manager},service),
    service=>executeUnifiedExport({command:exportCommand,authUserId:id(999)},service),
    ...[null,0,'5'].map(expectedScopeRevision=>service=>executeUnifiedExport({
      command:{...exportCommand,query:{...exportCommand.query,expectedScopeRevision}},authUserId:manager,
    },service)),
    service=>executeUnifiedExport({command:{...exportCommand,query:{...exportCommand.query,locationId:null}},authUserId:manager},service),
    service=>executeUnifiedExport({command:{...exportCommand,query:{...exportCommand.query,expectedWorkerId:worker}},authUserId:manager},service),
  ];
  for(const probe of probes){
    const f=fixture();
    await assert.rejects(probe(f.service),/attendance_(?:invalid_request|audit_shell_invalid_(?:site|actor))/);
    assert.deepEqual(f.statements,[]);assert.deepEqual(f.transport.calls,[]);assert.deepEqual(f.transport.errors,[]);
    assert(f.requests.length<=1,'malformed request must not retry as owner');
    for(const request of f.requests)assert.equal(request.args.p_query.access,'manager');
  }
});
