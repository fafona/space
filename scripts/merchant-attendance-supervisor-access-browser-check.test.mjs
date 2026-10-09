import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {assertSupervisorAccessAudit,supervisorAccessRecord} from './merchant-attendance-supervisor-access-browser-check.mjs';

const proof=()=>{
  const site='99990001',ownerId='owner',roleId='role',employeeId='manager',workerId='worker',locationId='location';
  const off=['enterprise.view'],on=[...off,'attendance.records.view'];
  const base={id:roleId,merchant_id:site,name:'合成角色',description:'',version:1,permissions:off,updated_at:'2026-10-01T00:00:00Z'};
  const other={...base,id:'other'};
  const before={roles:[base,other],audits:[],scopes:[],grants:[],scopeOperations:[]};
  const grant=id=>({id,workerIds:[workerId],locationIds:[locationId],validFrom:'2026-09-01T00:00:00.000Z',validUntil:null});
  const snapshots=[{revision:0,grants:[]},{revision:1,grants:[grant('first')]},{revision:2,grants:[]},{revision:3,grants:[grant('second')]}];
  const scopeOperations=[0,1,2].map(index=>({merchant_id:site,employee_id:employeeId,actor_auth_user_id:ownerId,revision:index+1,operation_id:'operation-'+index,
    command:{action:index===1?'remove':'put',grantId:index===2?'second':'first',operationId:'operation-'+index,expectedRevision:index,
      grant:index===1?null:{workerIds:[workerId],locationIds:[locationId],validFrom:'2026-09-01T00:00:00.000Z',validUntil:null}},
    before_value:structuredClone(snapshots[index]),after_value:structuredClone(snapshots[index+1])}));
  const audits=[0,1,2].map(index=>({id:'audit-'+index,merchant_id:site,entity_id:roleId,event_type:'role.updated',actor_type:'owner',actor_id:null,
    created_at:`2026-10-01T00:00:0${index+1}Z`,before_data:{name:base.name,permissions:[off,on,off][index]},after_data:{name:base.name,permissions:[on,off,on][index]}}));
  const after={roles:[{...base,version:4,permissions:on,updated_at:'2026-10-01T00:00:04Z'},structuredClone(other)],audits,
    scopes:[{merchant_id:site,employee_id:employeeId,revision:3}],scopeOperations,
    grants:[{id:'second',merchant_id:site,employee_id:employeeId,workerIds:[workerId],locationIds:[locationId],valid_from:'2026-09-01T00:00:00+00:00',valid_until:null}]};
  return {before,after,site,ownerId,roleId,employeeId,workerId,locationId};
};

test('supervisor audit proof accepts only the three role and three scope transitions without mutating evidence',()=>{
  const value=proof(),copy=structuredClone(value);assert.doesNotThrow(()=>assertSupervisorAccessAudit(value));assert.deepEqual(value,copy);
});

test('supervisor audit rejects unexpected role changes, audit actor, permissions or lost history',()=>{
  for(const change of [p=>p.after.roles[0].version++,p=>p.after.roles[0].name='changed',p=>p.after.roles[1].description='changed',
    p=>p.after.audits.pop(),p=>p.after.audits[0].merchant_id='foreign',p=>p.after.audits[0].entity_id='other',
    p=>p.after.audits[0].actor_type='employee',p=>p.after.audits[0].actor_id='employee',p=>p.after.audits[0].event_type='employee.updated',
    p=>p.after.audits[0].after_data.permissions=['enterprise.view'],p=>p.after.audits[0].after_data.name='changed',
    p=>p.before.audits.push({id:'old',event_type:'retained'})]){
    const value=proof();change(value);assert.throws(()=>assertSupervisorAccessAudit(value));
  }
});

test('supervisor audit rejects widened grant relations, revisions and changed operation identities',()=>{
  for(const change of [p=>p.before.scopes.push({}),p=>p.before.grants.push({}),p=>p.before.scopeOperations.push({}),
    p=>p.after.scopes[0].revision++,p=>p.after.grants.push({...p.after.grants[0]}),p=>p.after.scopeOperations.pop(),
    p=>p.after.scopeOperations[0].merchant_id='foreign',p=>p.after.scopeOperations[0].employee_id='foreign',
    p=>p.after.scopeOperations[0].actor_auth_user_id='foreign',p=>p.after.scopeOperations[0].command.operationId='other',
    p=>p.after.scopeOperations[0].command.expectedRevision++,p=>p.after.scopeOperations[1].command.grantId='other',
    p=>p.after.scopeOperations[1].command.grant={},p=>p.after.scopeOperations[2].before_value.revision++,
    p=>p.after.scopeOperations[0].command.grant.workerIds.push('other'),p=>p.after.scopeOperations[2].after_value.grants[0].locationIds.push('other'),
    p=>p.after.grants[0].employee_id='foreign',p=>p.after.grants[0].merchant_id='foreign',p=>p.after.grants[0].workerIds.push('other'),
    p=>p.after.grants[0].locationIds.push('other'),p=>p.after.grants[0].valid_until='2026-12-01',p=>p.after.grants[0].valid_from='2025-01-01']){
    const value=proof();change(value);assert.throws(()=>assertSupervisorAccessAudit(value));
  }
});

test('request evidence records only path, method, status and bounded error codes',()=>{
  assert.deepEqual(supervisorAccessRecord('/records','GET',403,{error:'attendance_access_denied',token:'private',items:[{id:'private'}]}),
    {path:'/records',method:'GET',status:403,error:'attendance_access_denied'});
  for(const error of ['Bearer secret','https://example.test/?token=private','x'.repeat(81),{token:'private'},null]){
    assert.equal(supervisorAccessRecord('/records','GET',503,{error}).error,null);
  }
});

test('browser runner retains actual forms, handlers and late-response fence without exposing production capability',()=>{
  const source=readFileSync(new URL('./merchant-attendance-supervisor-access-browser-check.mjs',import.meta.url),'utf8');
  assert.match(source,/await updateRole\(request\)/);assert.match(source,/await handleAttendanceScopes\(request,\{enabled:\(\)=>true,entitlement\}\)/);
  assert.match(source,/await handleAttendanceRecords\(request,\{enabled:\(\)=>true,entitlement\}\)/);
  assert.match(source,/await setPermission\(false\);await focus\(false\);await panel\(\)\.waitFor\(\{state:'detached'\}\)/);
  assert(source.indexOf("await panel().waitFor({state:'detached'})")<source.indexOf('gate.release.resolve()'));
  assert.match(source,/assert\.deepEqual\(late\.items\.map\(row=>row\.id\),data\.allowedIds\)/);
  assert.match(source,/if\(url\.origin!==origin\)/);assert.match(source,/realAuthService:false,realNextServer:false,realPhone:false,productionAccess:false/);
  assert.match(source,/newPunches:0,sourceEventsUnchanged:4/);assert.match(source,/syntheticActiveMembershipEntry:true/);
  assert.match(source,/path\.resolve\(process\.argv\[1\]\)===fileURLToPath\(import\.meta\.url\)/);
  assert.doesNotMatch(source,/\b(?:insert into|update|delete from)\s+public\./i);
});
