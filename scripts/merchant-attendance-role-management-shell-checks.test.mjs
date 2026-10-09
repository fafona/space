import test from 'node:test';
import assert from 'node:assert/strict';
import {assertAttendanceRoleManagementAudit} from './merchant-attendance-role-management-shell-checks.mjs';
const site='99990001',roleId='00000000-0000-4000-8000-000000000030';
const full=['enterprise.view','attendance.self.view','attendance.self.clock'],viewOnly=['enterprise.view','attendance.self.view'],states=[full,viewOnly,full,['enterprise.view'],full];
const rows=()=>Array.from({length:4},(_,i)=>({merchant_id:site,event_type:'role.updated',entity_type:'role',entity_id:roleId,actor_type:'owner',actor_id:null,target_label:'合成员工角色',
  created_at:`2026-10-03T10:00:0${i}Z`,before_data:{name:'合成员工角色',status:'active',permissions:states[i]},after_data:{name:'合成员工角色',status:'active',permissions:states[i+1]}}));
test('real audit evidence requires each exact permission transition and accepts arbitrary row order',()=>assert.doesNotThrow(()=>assertAttendanceRoleManagementAudit(rows().reverse(),{site,roleId})));
test('missing, duplicate or wrongly targeted audit cannot satisfy the lifecycle proof',()=>{
  for(const transform of [r=>r.slice(1),r=>[...r,r[0]],r=>{r[1].entity_id='other';return r;},r=>{r[2].merchant_id='99990002';return r;},r=>{r[3].event_type='employee.restored';return r;}])
    assert.throws(()=>assertAttendanceRoleManagementAudit(transform(rows()),{site,roleId}));
});
test('unexpected permission grant, name change or account-binding change is rejected',()=>{
  for(const patch of [{permissions:full},{name:'changed'},{auth_bound:true}]){const input=rows();input[0].after_data={...input[0].after_data,...patch};assert.throws(()=>assertAttendanceRoleManagementAudit(input,{site,roleId}));}
});
test('owner identity and sensitive fields must not leak into role audit proof',()=>{
  for(const patch of [{actor_id:roleId},{actor_type:'employee'},{target_label:'other'}]){const input=rows();Object.assign(input[0],patch);assert.throws(()=>assertAttendanceRoleManagementAudit(input,{site,roleId}));}
  for(const key of ['email','auth_user_id','password','token','invitation_token_hash']){const input=rows();input[0].before_data[key]='secret';input[0].after_data[key]='secret';assert.throws(()=>assertAttendanceRoleManagementAudit(input,{site,roleId}));}
});
