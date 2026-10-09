import test from 'node:test';
import assert from 'node:assert/strict';
import {assertLocationManagementFacts,assertLocationManagementEmployeeAudit} from './merchant-attendance-location-management-shell-checks.mjs';
const scope={employeeId:'employee',workerId:'worker',placeId:'place'},empty={events:[],summaries:[],links:[]};
const facts=(count=4)=>({
  events:Array.from({length:count},(_,index)=>({id:`event${index}`,sequence:index+1,actor_employee_id:'employee',worker_id:'worker',location_id:'place',source:'web',payload:'immutable'})),
  summaries:Array.from({length:count},(_,index)=>({event_id:`event${index}`,reason:'not_provided',needs_review:true})),
  links:Array.from({length:count},(_,index)=>({event_id:`event${index}`,safe_finish:index>=2,notice_revision:index>=2?null:1})),
});
const audit=()=>['disabled','active'].map((status,index)=>({merchant_id:'99990001',event_type:index?'employee.restored':'employee.disabled',entity_type:'employee',entity_id:'employee',
  target_label:'合成员工甲',actor_type:'owner',actor_id:null,created_at:`2026-10-03T10:00:0${index}Z`,
  before_data:{status:index?'disabled':'active',display_name:'合成员工甲'},after_data:{status,display_name:'合成员工甲'}}));
test('location lifecycle evidence accepts append-only four actions and exact summary/notice links',()=>{
  assert.doesNotThrow(()=>assertLocationManagementFacts(facts(2),facts(),{...scope,count:4}));
});
test('location lifecycle rejects missing, duplicate or unlinked evidence rows',()=>{
  for(const change of [x=>x.summaries.pop(),x=>x.links.push(x.links[0]),x=>x.links[0].event_id='other']){
    const value=facts();change(value);assert.throws(()=>assertLocationManagementFacts(empty,value,{...scope,count:4}));
  }
});
test('location lifecycle rejects altered old evidence, sequence or account binding',()=>{
  for(const change of [x=>x.events[0].payload='changed',x=>x.summaries[0].needs_review=false,x=>x.links[0].notice_revision=2]){
    const value=facts();change(value);assert.throws(()=>assertLocationManagementFacts(facts(1),value,{...scope,count:4}));
  }
  for(const patch of [{actor_employee_id:'other'},{worker_id:'other'},{location_id:'other'},{source:'pin'},{sequence:4}]){
    const value=facts();Object.assign(value.events[0],patch);assert.throws(()=>assertLocationManagementFacts(empty,value,{...scope,count:4}));
  }
});
test('location evidence cannot label synthetic no-position facts as inside or drop review/notice boundary',()=>{
  for(const change of [x=>x.summaries[0].reason='inside',x=>x.summaries[0].needs_review=false,x=>x.links[2].safe_finish=false,x=>x.links[3].notice_revision=1]){
    const value=facts();change(value);assert.throws(()=>assertLocationManagementFacts(empty,value,{...scope,count:4}));
  }
});
test('employee lifecycle audit requires exact disable/restore with no other changed fields',()=>{
  assert.doesNotThrow(()=>assertLocationManagementEmployeeAudit(audit().reverse(),{site:'99990001',employeeId:'employee'}));
  for(const change of [x=>x.pop(),x=>x[0].after_data.status='active',x=>x[1].entity_id='other',x=>x[0].after_data.display_name='changed']){
    const value=audit();change(value);assert.throws(()=>assertLocationManagementEmployeeAudit(value,{site:'99990001',employeeId:'employee'}));
  }
});
test('employee lifecycle audit rejects auth data and non-owner attribution',()=>{
  for(const change of [x=>x[0].actor_type='employee',x=>x[0].actor_id='owner-id',x=>x[0].merchant_id='99990002',x=>{
    x[0].before_data.email='secret';x[0].after_data.email='secret';}]){
    const value=audit();change(value);assert.throws(()=>assertLocationManagementEmployeeAudit(value,{site:'99990001',employeeId:'employee'}));
  }
});
