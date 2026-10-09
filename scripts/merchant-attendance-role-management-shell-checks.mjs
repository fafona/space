// Synthetic local extension of the existing real owner/employee shell runner.
// Every permission change originates in the actual role editor, not SQL UPDATE.
import assert from 'node:assert/strict';

const full=['enterprise.view','attendance.self.view','attendance.self.clock'];
const viewOnly=['enterprise.view','attendance.self.view'];
const collaborationOnly=['enterprise.view'];
const sorted=value=>[...value].sort();

export function assertAttendanceRoleManagementAudit(rows,{site,roleId}){
  const sequence=[full,viewOnly,full,collaborationOnly,full];
  const history=[...rows].sort((a,b)=>a.created_at.localeCompare(b.created_at));
  assert.equal(history.length,4);
  for(const [index,row] of history.entries()){
    assert.equal(row.merchant_id,site);assert.equal(row.event_type,'role.updated');assert.equal(row.entity_type,'role');assert.equal(row.entity_id,roleId);
    assert.equal(row.actor_type,'owner');assert.equal(row.actor_id,null);assert.equal(row.target_label,'合成员工角色');
    assert.deepEqual(sorted(row.before_data.permissions),sorted(sequence[index]));assert.deepEqual(sorted(row.after_data.permissions),sorted(sequence[index+1]));
    assert.deepEqual({...row.after_data,permissions:row.before_data.permissions},row.before_data,'role_management_unexpected_audited_change');
    for(const data of [row.before_data,row.after_data])for(const key of ['email','auth_user_id','password','token','invitation_token_hash'])assert.equal(key in data,false);
  }
}

export async function checkAttendanceRoleManagementShell({owner,phone,self,response,requests,exec,events,audits,employee,roleRpcCalls,first,
  site,employeeId,roleId,pendingKey,pass,readSelf,employeeRoleAttempt,holdSuccess}){
  assert.equal(site,'99990001');assert.equal(events().length,1);assert.equal(audits().length,0);
  const roleEndpoint='/api/merchant-enterprise/roles',selfEndpoint='/api/merchant-enterprise/attendance/self';
  const role=()=>JSON.parse(exec(`select to_jsonb(r) from public.merchant_enterprise_roles r where merchant_id='${site}' and id='${roleId}';`));
  const initialRole=role(),initialEmployee=employee();assert.equal(initialEmployee.id,employeeId);
  const initialEvents=events();
  const preservesEvents=previous=>{const current=events();for(const row of previous)assert.deepEqual(current.find(item=>item.id===row.id),row,'role_management_original_event_changed');};
  const unaffected=()=>exec(`select jsonb_build_object(
    'employees',(select jsonb_agg(to_jsonb(t) order by id) from public.merchant_enterprise_employees t),
    'otherRoles',(select jsonb_agg(to_jsonb(t) order by id) from public.merchant_enterprise_roles t where id<>'${roleId}'),
    'workers',(select jsonb_agg(to_jsonb(t) order by id) from public.merchant_attendance_workers t),
    'settings',(select jsonb_agg(to_jsonb(t) order by merchant_id) from public.merchant_attendance_settings t),
    'places',(select jsonb_agg(to_jsonb(t) order by id) from public.merchant_attendance_locations t),
    'boards',(select jsonb_agg(to_jsonb(t) order by id) from public.merchant_task_boards t),
    'columns',(select jsonb_agg(to_jsonb(t) order by id) from public.merchant_task_columns t));`);
  const originalUnaffected=unaffected(),pending=()=>phone.evaluate(key=>sessionStorage.getItem(key),pendingKey);
  const posts=()=>requests.filter(r=>r.path===selfEndpoint&&r.method==='POST');
  const nav=()=>phone.getByRole('navigation',{name:'企业管理功能',exact:true});
  const roleBody=()=>owner.locator(`[id="role-editor-${roleId}-body"]`);
  const checkbox=key=>roleBody().locator(`[id="role-${roleId}-${key}"]`);
  await owner.getByRole('button',{name:'角色权限',exact:true}).click();
  await owner.locator(`button[aria-controls="role-editor-${roleId}-body"]`).click();
  await roleBody().getByRole('navigation',{name:'权限主要板块',exact:true}).getByRole('button',{name:/^员工考勤，/}).click();
  assert(await checkbox('attendance.self.clock').isChecked());assert(await checkbox('attendance.self.view').isChecked());
  const save=async permissions=>{
    const before=role(),facts=events(),count=audits().length;
    const saved=response(owner,roleEndpoint,'PATCH'),refreshed=response(owner,'/api/merchant-enterprise/overview','GET');
    await roleBody().getByRole('button',{name:'保存角色',exact:true}).click();await saved;await refreshed;
    await owner.getByText('角色已保存。',{exact:true}).waitFor();
    assert.equal(role().version,before.version+1);assert.deepEqual(sorted(role().permissions),sorted(permissions));
    assert.deepEqual({...role(),permissions:before.permissions,version:before.version,updated_at:before.updated_at},before);
    assert.equal(audits().length,count+1);assert.deepEqual(events(),facts);assert.equal(unaffected(),originalUnaffected);
  };
  const focus=async permissions=>{
    const caps=response(phone,'/api/merchant-business/capabilities','GET',403),overview=response(phone,'/api/merchant-enterprise/overview','GET');
    await phone.evaluate(()=>window.dispatchEvent(new Event('focus')));
    assert.equal((await(await caps).json()).error,'staff_business_access_disabled');const data=await(await overview).json();
    assert.equal(data.actor.id,employeeId);assert.deepEqual(sorted(data.actor.permissions),sorted(permissions));await nav().waitFor();
  };
  const enter=async()=>{const read=response(phone,selfEndpoint,'GET');await nav().getByRole('button',{name:'我的考勤',exact:true}).click();const value=await(await read).json();await self().getByRole('button',{name:/^(刷新状态|核对打卡结果)$/}).waitFor();return value;};

  // Revoke clock while the old UI still has its original successful receipt.
  await checkbox('attendance.self.clock').uncheck();assert(await checkbox('attendance.self.view').isChecked());await save(viewOnly);
  const rejected=response(phone,selfEndpoint,'POST',403);await self().getByRole('button',{name:'开始休息',exact:true}).click();
  assert.equal((await(await rejected).json()).error,'attendance_access_denied');
  await self().getByText('等待服务器同步，不显示推测记录。',{exact:true}).waitFor();assert.equal(await self().getByText(/^收据编号：/).count(),0);
  const deniedPending=await pending();assert(deniedPending);const deniedOperation=JSON.parse(deniedPending).command.operationId;
  assert.equal(events().length,1);assert.equal(events()[0].id,first.receipt.id);assert.equal(posts().length,2);
  assert(await self().getByRole('button',{name:'用原操作编号重试',exact:true}).isDisabled());
  pass('real role editor removes only self.clock through v3 audited SQL; stale employee punch is rejected, old private receipt clears, original intent remains and no fact is added');

  await focus(viewOnly);const readOnly=await enter();assert.equal(readOnly.receipt,null);assert.equal(readOnly.state.sequence,1);
  assert.equal(readOnly.state.lastEvent.id,first.receipt.id);await self().getByText('当前角色仅可查看本人考勤，不能提交打卡。',{exact:true}).waitFor();
  assert.equal(await pending(),deniedPending);assert(await self().getByRole('button',{name:'用原操作编号重试',exact:true}).isDisabled());
  assert(await self().getByRole('button',{name:'开始休息',exact:true}).isDisabled());assert.equal(posts().length,2);assert.equal(events().length,1);
  pass('role-version refresh preserves self.view access to own history/state while disabling every punch/retry, with no automatic POST or pending-ID replacement');

  await checkbox('attendance.self.clock').check();await save(full);await focus(full);const restored=await enter();
  assert.equal(restored.receipt,null);assert.equal(await pending(),deniedPending);assert.equal(posts().length,2);
  const retry=response(phone,selfEndpoint,'POST');await self().getByRole('button',{name:'用原操作编号重试',exact:true}).click();const retried=await(await retry).json();
  assert.equal(retried.receipt.operationId,deniedOperation);await self().getByText('收据编号：'+retried.receipt.id,{exact:true}).waitFor();
  assert.equal(await pending(),null);assert.equal(events().length,2);assert.equal(posts().length,3);
  preservesEvents(initialEvents);const beforeLate=events();
  pass('restoring clock does not silently execute the rejected intent; explicit same-ID retry creates exactly one new fact after current permission verification');

  // Lose visibility permission with a successfully committed response in flight.
  const gate=holdSuccess();await self().getByRole('button',{name:'结束休息',exact:true}).click();const late=await gate.ready();
  const latePending=await pending();assert(latePending);assert.equal(JSON.parse(latePending).command.operationId,late.receipt.operationId);const committed=events();assert.equal(committed.length,3);
  preservesEvents(beforeLate);
  await checkbox('attendance.self.view').uncheck();assert.equal(await checkbox('attendance.self.clock').isChecked(),false);await save(collaborationOnly);
  await focus(collaborationOnly);assert.equal(await nav().getByRole('button',{name:'我的考勤',exact:true}).count(),0);assert.equal(await self().count(),0);
  const deniedRead=await readSelf(late.receipt.operationId);assert.equal(deniedRead.status,403);assert.deepEqual(await deniedRead.json(),{ok:false,error:'attendance_access_denied'});
  await gate.release();await phone.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  assert.equal(await self().count(),0);assert.equal(await phone.getByText('收据编号：'+late.receipt.id,{exact:true}).count(),0);assert.equal(await pending(),latePending);
  assert.deepEqual(events(),committed);assert.equal(posts().length,4);
  pass('removing self.view also removes dependent self.clock; refreshed shell hides attendance, actual original-receipt GET rejects, and late committed success cannot revive DOM or erase pending');

  await checkbox('attendance.self.clock').check();assert(await checkbox('attendance.self.view').isChecked());await save(full);await focus(full);
  const recovered=await enter();assert.deepEqual(recovered.receipt,late.receipt);await self().getByText('收据编号：'+late.receipt.id,{exact:true}).waitFor();assert.equal(await pending(),null);
  assert.deepEqual(events(),committed);assert.equal(posts().length,4);assert.equal(role().version,initialRole.version+4);assert.equal(roleRpcCalls.length,4);
  assert.deepEqual(employee(),initialEmployee);assert.equal(unaffected(),originalUnaffected);assertAttendanceRoleManagementAudit(audits(),{site,roleId});
  pass('restoring view/clock recovers the committed receipt by GET only; four exact role.updated audits preserve employee binding, other roles, attendance configuration and old facts');

  const finalRole=role();
  const stale=await owner.evaluate(async body=>{const reply=await fetch('/api/merchant-enterprise/roles',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify(body)});return {status:reply.status,body:await reply.json()};},
    {siteId:site,roleId,version:initialRole.version,name:initialRole.name,description:initialRole.description,permissions:viewOnly,accessScope:'all',allowedBoardIds:[]});
  assert.equal(stale.status,409);assert.equal(roleRpcCalls.length,5);assert.equal(audits().length,4);assert.deepEqual(events(),committed);assert.equal(unaffected(),originalUnaffected);
  assert.deepEqual(role(),finalRole);assert.equal(role().version,initialRole.version+4);assert.deepEqual(sorted(role().permissions),sorted(full));
  pass('stale role editor reaches SQL CAS and returns409 without another audit, permission change or attendance write');
  const forbidden=await employeeRoleAttempt({siteId:site,roleId,version:role().version,name:initialRole.name,description:initialRole.description,permissions:viewOnly,accessScope:'all',allowedBoardIds:[]});
  assert.equal(forbidden.status,403);assert.deepEqual(await forbidden.json(),{ok:false,error:'permission_denied'});
  assert.equal(roleRpcCalls.length,5);assert.equal(audits().length,4);assert.deepEqual(events(),committed);assert.equal(unaffected(),originalUnaffected);
  assert.deepEqual(role(),finalRole);
  pass('employee with attendance access but no roles.manage cannot mutate their role through a direct authenticated PATCH; no mutation RPC is called');
  console.log(JSON.stringify({actualRoleEditor:true,actualRoleHandlerStore:true,realRoleV3Sql:true,realRoleAudit:true,roleChanges:4,roleAudits:4,roleRpcCalls:5,
    ordinaryPunchPosts:4,acceptedFacts:3,rejectedIntents:1,explicitSameIdRetry:true,lateResponseAfterViewRevocation:true,
    syntheticAuthAndEntitlement:true,unrelatedWorkflowPermissionReadExplicit503:true,realNextServer:false,realPhone:false,productionAccess:false}));
}
