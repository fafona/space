import test from 'node:test';
import assert from 'node:assert/strict';
import {assertDelegatedRoleAudit,assertDelegatedEmployeeAudit,delegatedAuditDelta} from './merchant-attendance-delegated-management-shell-checks.mjs';
const site='99990001',roleId='00000000-0000-4000-8000-000000000030',employeeId='00000000-0000-4000-8000-000000000101',actorId='00000000-0000-4000-8000-000000000102',board='00000000-0000-4000-8000-000000000401';
const before={id:roleId,name:'Synthetic role',description:'',permissions:['enterprise.view','attendance.self.view','attendance.self.clock'],status:'active',is_system:false,access_scope:'restricted',system_key:null};
const after={...before,permissions:['enterprise.view','attendance.self.view']};
const summary=({id,...value})=>{void id;return value;};
const roleOptions={site,before,after,beforeBoards:[board],afterBoards:[board],actorId};
const identity={merchant_id:site,entity_id:roleId,entity_type:'role',target_label:before.name,actor_type:'employee',actor_id:actorId};
const roleRows=()=>[
  {...identity,id:'1',event_type:'role.updated',before_data:summary(before),after_data:summary(after)},
  {...identity,id:'2',event_type:'role.board_scope_changed',before_data:{board_id:board},after_data:{}},
  {...identity,id:'3',event_type:'role.board_scope_changed',before_data:{},after_data:{board_id:board}},
];
test('restricted save requires role audit plus both unchanged-board delete and insert, independent of row order',()=>{
  const previous=[{id:'9',event_type:'earlier'}];assert.deepEqual(delegatedAuditDelta(previous,[...roleRows(),...previous]),roleRows());
  assert.throws(()=>delegatedAuditDelta(previous,[...roleRows(),{...previous[0],event_type:'rewritten'}]));
  assert.doesNotThrow(()=>assertDelegatedRoleAudit(roleRows().reverse(),roleOptions));
  const ownerRows=roleRows().filter(row=>row.id!=='2').map(row=>({...row,actor_type:'owner',actor_id:null}));
  ownerRows[0].before_data={...ownerRows[0].before_data,access_scope:'all'};
  assert.doesNotThrow(()=>assertDelegatedRoleAudit(ownerRows,{...roleOptions,before:{...before,access_scope:'all'},beforeBoards:[],actorId:null}));
});
test('audit oracle rejects missing, duplicate, replacement board and extra audit evidence',()=>{
  for(const mutate of [r=>r.slice(0,2),r=>[...r,r[0]],r=>{r[2].id=r[1].id;return r;},r=>{r[2].after_data.board_id='different';return r;},r=>{r[1].event_type='role.updated';return r;}])assert.throws(()=>assertDelegatedRoleAudit(mutate(roleRows()),roleOptions));
});
test('delegated audit is bound to exact tenant, actor, target, permissions and unchanged role metadata',()=>{
  for(const patch of [{merchant_id:'99990002'},{actor_id:employeeId},{actor_type:'owner'},{entity_id:actorId},{target_label:'wrong'}]){
    const rows=roleRows();Object.assign(rows[1],patch);assert.throws(()=>assertDelegatedRoleAudit(rows,roleOptions));
  }
  for(const patch of [{permissions:before.permissions},{name:'changed'},{access_scope:'all'},{status:'archived'}]){
    const rows=roleRows();Object.assign(rows[0].after_data,patch);assert.throws(()=>assertDelegatedRoleAudit(rows,roleOptions));
  }
});
test('role audit fails closed on private auth data even when injected on both sides',()=>{
  for(const key of ['email','auth_user_id','password','token','invitation_token_hash']){
    const rows=roleRows();rows[0].before_data[key]='private';rows[0].after_data[key]='private';assert.throws(()=>assertDelegatedRoleAudit(rows,roleOptions));
  }
});
const employeeBefore={id:employeeId,display_name:'Synthetic employee',role_id:roleId,status:'active',auth_user_id:'synthetic-auth-id',invitation_version:0,invitation_delivery_status:'none',invitation_sent_at:null,invitation_expires_at:null,invitation_revoked_at:null,accepted_at:'2026-10-03T00:00:00Z'},employeeAfter={...employeeBefore,status:'disabled'};
const employeeOptions={site,before:employeeBefore,after:employeeAfter,actorId};
const employeeData=value=>{const {auth_user_id,...rest}=summary(value);return {...rest,auth_bound:!!auth_user_id};};
const employeeRows=()=>[{id:'4',...identity,entity_id:employeeId,entity_type:'employee',target_label:employeeBefore.display_name,event_type:'employee.disabled',before_data:employeeData(employeeBefore),after_data:employeeData(employeeAfter)}];
test('actual delegated employee disable and restore audits retain role and identity',()=>{
  assert.doesNotThrow(()=>assertDelegatedEmployeeAudit(employeeRows(),employeeOptions));
  const restored=employeeRows();restored[0].event_type='employee.restored';[restored[0].before_data,restored[0].after_data]=[restored[0].after_data,restored[0].before_data];
  assert.doesNotThrow(()=>assertDelegatedEmployeeAudit(restored,{...employeeOptions,before:employeeAfter,after:employeeBefore}));
});
test('employee audit rejects wrong actor, unexpected role/binding changes and duplicate mutations',()=>{
  for(const patch of [{actor_id:null},{actor_type:'owner'},{entity_id:actorId},{event_type:'employee.updated'}]){
    const rows=employeeRows();Object.assign(rows[0],patch);assert.throws(()=>assertDelegatedEmployeeAudit(rows,employeeOptions));
  }
  const rows=employeeRows();rows[0].after_data.role_id=actorId;assert.throws(()=>assertDelegatedEmployeeAudit(rows,employeeOptions));
  assert.throws(()=>assertDelegatedEmployeeAudit([...employeeRows(),...employeeRows()],employeeOptions));
});
