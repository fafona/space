import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import test from 'node:test';

const require=createRequire(import.meta.url);
const {createAttendanceAuditShellTransport,createAttendanceDatabaseTransport,databaseId:id,databaseActors:actors}=require('./fixtures/attendance-audit-shell-transport.ts');
const {parseMerchantBusinessCapabilitiesPayload,getMerchantEmployeeWorkspaceRoots}=require('../src/lib/merchantBusinessCapabilities.ts');
const peer='/api/merchant-peer-messages',capabilities='/api/merchant-business/capabilities';
const request=(path=peer,query='siteId=99990001',method='GET')=>new Request(`http://127.0.0.1:3131${path}${query?'?'+query:''}`,{method});

function fixture(){
  const statements=[];
  const current={authUserId:actors[2].id,employeeActive:true,roleActive:true,version:7,
    permissions:['enterprise.view','attendance.self.view','conversations.view'],countOverride:null,failure:null};
  const exec=sql=>{
    statements.push(sql);
    const normalized=sql.replace(/\s+/g,' ').trim();
    assert.doesNotMatch(normalized,/\b(?:insert|update|delete|truncate|drop|alter|create|grant|revoke)\b/i,'navigation fixture must remain read-only');
    if(current.failure)throw current.failure;
    if(/select count\(\*\) from public\.merchants\b/.test(normalized))return '0';
    assert(normalized.includes('public.merchant_enterprise_employees e'),'unexpected synthetic SQL');
    // Verify the generated predicates, not just the fake return value. These
    // unit checks do not execute PostgreSQL or replace its native ACL tests.
    for(const clause of ["e.merchant_id='99990001'",'r.id=e.role_id','r.merchant_id=e.merchant_id',"e.status='active'","r.status='active'"])
      assert(normalized.includes(clause),`missing current-identity predicate: ${clause}`);
    const actor=normalized.match(/e\.auth_user_id='([^']+)'/)?.[1];assert(actor);
    const employee=current.employeeActive&&current.roleActive&&actor===current.authUserId;
    if(/select count\(\*\) from public\.merchant_enterprise_employees\b/.test(normalized)){
      assert(normalized.includes("'enterprise.view'=any(r.permissions)"));
      assert(normalized.includes("'conversations.view'=any(r.permissions)"));
      if(current.countOverride!==null)return current.countOverride;
      return employee&&current.permissions.includes('enterprise.view')&&current.permissions.includes('conversations.view')?'1':'0';
    }
    assert(normalized.includes('jsonb_build_object'),'unexpected employee projection');
    return JSON.stringify(employee?{id:id(102),displayName:'合成员工',email:actors[2].email,roleId:id(31),roleName:'合成角色',version:current.version,permissions:current.permissions}:null);
  };
  const transport=createAttendanceAuditShellTransport(exec);
  return {transport,current,statements,exec};
}

test('navigation conversations are default-off and ordinary shell capabilities remain delegated unchanged',async()=>{
  const f=fixture();assert.equal(f.transport.state.navigationConversationsEnabled,false);
  await assert.rejects(f.transport.serveShell(request(),actors[2].id),/attendance_navigation_conversations_disabled/);
  assert.deepEqual(f.statements,[]);
  const baseline=createAttendanceDatabaseTransport(f.exec);
  const actual=await f.transport.serveShell(request(capabilities),actors[2].id);
  const expected=await baseline.serveShell(request(capabilities),actors[2].id);
  assert.deepEqual(await actual.json(),await expected.json());
  assert.equal(f.transport.state.moduleEnabled,true);assert.deepEqual(f.transport.calls,[]);
});

test('explicit opt-in splits only the granted conversation capability and serves an exact empty read-only root',async()=>{
  const f=fixture();f.transport.state.navigationConversationsEnabled=true;
  const response=await f.transport.serveShell(request(capabilities),actors[2].id),body=await response.json();
  assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'private, no-store');
  assert.deepEqual(body.permissions,['conversations.view']);
  assert.deepEqual(body.collaborationPermissions,['enterprise.view','attendance.self.view']);
  assert.equal(body.actor.principalKey,`employee:${id(102)}`);assert.equal(body.actor.authorizationVersion,'7:1');
  const parsed=parseMerchantBusinessCapabilitiesPayload(body);assert(parsed);
  assert.deepEqual(getMerchantEmployeeWorkspaceRoots(parsed.collaborationPermissions,parsed.permissions),['collaboration','conversations']);
  const count=f.statements.length,empty=await f.transport.serveShell(request(),actors[2].id);
  assert.equal(empty.status,200);assert.equal(empty.headers.get('cache-control'),'private, no-store');
  assert.deepEqual(await empty.json(),{ok:true,currentMerchantId:'99990001',contacts:[],threads:[],readState:{peerLastRead:{}}});
  assert.equal(f.statements.length,count+1);assert.deepEqual(f.transport.calls,[]);assert.deepEqual(f.transport.errors,[]);
});

test('peer root rejects writes, extra or duplicate query fields, foreign tenants and unlisted actors before SQL',async()=>{
  const f=fixture();f.transport.state.navigationConversationsEnabled=true;
  for(const method of ['POST','PUT','PATCH','DELETE','HEAD'])
    await assert.rejects(f.transport.serveShell(request(peer,'siteId=99990001',method),actors[2].id),/conversation_write_forbidden/);
  for(const query of ['', 'siteId=99990001&search=person','siteId=99990001&peerId='+id(201),
    'siteId=99990001&siteId=99990001','siteId=99990001&operationId='+id(801)])
    await assert.rejects(f.transport.serveShell(request(peer,query),actors[2].id),/conversation_query_forbidden/);
  for(const query of ['siteId=99990002','siteId='+encodeURIComponent("99990001';select 1;--")])
    await assert.rejects(f.transport.serveShell(request(peer,query),actors[2].id));
  for(const actor of [id(999),"x';select 1;--",null])
    await assert.rejects(f.transport.serveShell(request(),actor),/navigation_unknown_actor/);
  assert.deepEqual(f.statements,[]);assert.deepEqual(f.transport.calls,[]);
  // In opt-in mode the capabilities wrapper also refuses an extended query;
  // the delegated base may already have performed its harmless identity reads.
  for(const query of ['siteId=99990001&extra=1','siteId=99990001&siteId=99990001'])
    await assert.rejects(f.transport.serveShell(request(capabilities,query),actors[2].id));
});

test('each request rechecks role permission and active employee or role, then permits only restored authorization',async()=>{
  const f=fixture();f.transport.state.navigationConversationsEnabled=true;
  assert.equal((await f.transport.serveShell(request(),actors[2].id)).status,200);
  for(const change of [
    {permissions:['enterprise.view','attendance.self.view']},
    {permissions:['conversations.view']},
    {employeeActive:false},
    {roleActive:false},
  ]){
    const original={...f.current};Object.assign(f.current,change);const before=f.statements.length;
    const denied=await f.transport.serveShell(request(),actors[2].id);
    assert.equal(denied.status,403);assert.deepEqual(await denied.json(),{ok:false,error:'merchant_employee_access_denied'});
    assert.equal(f.statements.length,before+1,'every peer read must consult current authorization');
    const cap=await f.transport.serveShell(request(capabilities),actors[2].id);
    if(f.current.employeeActive&&f.current.roleActive&&f.current.permissions.includes('enterprise.view')){
      assert.equal(cap.status,200);const body=await cap.json();assert.deepEqual(body.permissions,[]);
      assert(!getMerchantEmployeeWorkspaceRoots(body.collaborationPermissions,body.permissions).includes('conversations'));
    }else{assert.equal(cap.status,403);assert.deepEqual(await cap.json(),{ok:false,error:'merchant_employee_access_denied'});}
    Object.assign(f.current,original);
    assert.equal((await f.transport.serveShell(request(),actors[2].id)).status,200);
  }
  // A known synthetic principal is not sufficient, including the owner actor.
  for(const actor of [actors[0].id,actors[1].id])assert.equal((await f.transport.serveShell(request(),actor)).status,403);
  f.current.version++;
  const restored=await(await f.transport.serveShell(request(capabilities),actors[2].id)).json();
  assert.equal(restored.actor.authorizationVersion,'8:1');assert.deepEqual(restored.permissions,['conversations.view']);
  assert.deepEqual(f.transport.calls,[]);
});

test('non-single authorization results and SQL failures never become a successful synthetic conversation reply',async()=>{
  const f=fixture();f.transport.state.navigationConversationsEnabled=true;
  for(const result of ['0','2','','true','1\n']){
    f.current.countOverride=result;
    const response=await f.transport.serveShell(request(),actors[2].id);
    assert.equal(response.status,403);assert.deepEqual(await response.json(),{ok:false,error:'merchant_employee_access_denied'});
  }
  f.current.countOverride=null;f.current.failure=Error('synthetic identity lookup unavailable');
  await assert.rejects(f.transport.serveShell(request(),actors[2].id),/synthetic identity lookup unavailable/);
  await assert.rejects(f.transport.serveShell(request(capabilities),actors[2].id),/synthetic identity lookup unavailable/);
  f.current.failure=null;f.transport.state.navigationConversationsEnabled=false;
  const before=f.statements.length;
  await assert.rejects(f.transport.serveShell(request(),actors[2].id),/navigation_conversations_disabled/);
  assert.equal(f.statements.length,before);assert.deepEqual(f.transport.calls,[]);
});
