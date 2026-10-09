import test from 'node:test';
import assert from 'node:assert/strict';
import {assertPinManagementAudit,assertPinManagementAttempts} from './merchant-attendance-pin-management-shell-checks.mjs';
const scope={site:'99990001',employeeId:'employee',roleId:'role'},full=['enterprise.view','attendance.self.view','attendance.self.clock'],viewOnly=['enterprise.view','attendance.self.view'];
const audits=()=>[
  ...Array.from({length:4},(_,index)=>({merchant_id:scope.site,entity_type:'employee',entity_id:scope.employeeId,target_label:'合成员工甲',actor_type:'owner',actor_id:null,
    event_type:index%2?'employee.restored':'employee.disabled',created_at:`2026-10-03T10:00:0${index}Z`,before_data:{status:index%2?'disabled':'active'},after_data:{status:index%2?'active':'disabled'}})),
  ...Array.from({length:2},(_,index)=>({merchant_id:scope.site,entity_type:'role',entity_id:scope.roleId,target_label:'合成员工角色',actor_type:'owner',actor_id:null,
    event_type:'role.updated',created_at:`2026-10-03T10:00:0${index}Z`,before_data:{permissions:index?viewOnly:full},after_data:{permissions:index?full:viewOnly}})),
];
const counter=(credentialAttempts,attempts,window='2026-10-03T10:00:00Z')=>({credentialAttempts,credentialWindow:'2026-10-03T09:59:59Z',
  device:{attempts,window_at:window,lease_id:null,lease_expires:null,worker_id:null,employee_id:null,credential_revision:null}});
test('PIN management requires four employee and two exact role transitions, regardless of row order',()=>assert.doesNotThrow(()=>assertPinManagementAudit(audits().reverse(),scope)));
test('PIN management rejects extra audit, wrong target, wrong transition and secret attribution',()=>{
  for(const mutate of [rows=>rows.pop(),rows=>rows.push(rows[0]),rows=>rows[4].after_data.permissions=full,rows=>rows[4].entity_id='other',rows=>rows[4].actor_id='owner',rows=>{
    rows[4].before_data.email='secret';rows[4].after_data.email='secret';}]){
    const input=audits();mutate(input);assert.throws(()=>assertPinManagementAudit(input,scope));
  }
});
test('PIN attempts permit successful verification and pre-lease denial while device count always advances',()=>{
  assert.doesNotThrow(()=>assertPinManagementAttempts(null,counter(1,1),{credentialAttempts:1}));
  assert.doesNotThrow(()=>assertPinManagementAttempts(counter(2,2),counter(3,3),{credentialAttempts:3}));
  assert.doesNotThrow(()=>assertPinManagementAttempts(counter(3,3),counter(3,4),{credentialAttempts:3}));
  assert.doesNotThrow(()=>assertPinManagementAttempts(counter(9,12),counter(10,13),{credentialAttempts:10}));
});
test('one-minute device window may naturally roll while fifteen-minute credential count is retained',()=>{
  assert.doesNotThrow(()=>assertPinManagementAttempts(counter(8,10),counter(8,1,'2026-10-03T10:01:01Z'),{credentialAttempts:8}));
});
test('counter evidence rejects silent resets, extra attempts and impossible window movement',()=>{
  for(const next of [counter(0,6),counter(5,4),counter(5,1,'2026-10-03T09:59:00Z'),counter(5,1,'2026-10-03T10:00:59Z'),
    {...counter(5,6),credentialWindow:'2026-10-03T10:00:01Z'},counter(5,2,'2026-10-03T10:01:01Z')])
    assert.throws(()=>assertPinManagementAttempts(counter(5,5),next,{credentialAttempts:5}));
});
test('every verification outcome must leave its lease and bound secret-verification state consumed',()=>{
  for(const key of ['lease_id','lease_expires','worker_id','employee_id','credential_revision']){
    const next=counter(2,2);next.device[key]=key==='credential_revision'?1:'retained';
    assert.throws(()=>assertPinManagementAttempts(counter(1,1),next,{credentialAttempts:2}));
  }
});
