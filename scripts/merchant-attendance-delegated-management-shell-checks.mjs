// Local synthetic delegation acceptance through the actual owner and employee
// shells. Board scope is NOT attendance personnel/location authorization.
import assert from 'node:assert/strict';

const rolePath='/api/merchant-enterprise/roles',employeePath='/api/merchant-enterprise/employees',overviewPath='/api/merchant-enterprise/overview';
const sorted=items=>[...items].sort();
const roleSummary=row=>Object.fromEntries(['name','description','permissions','status','is_system','access_scope','system_key'].map(key=>[key,row[key]]));
const employeeSummary=row=>({...Object.fromEntries(['display_name','role_id','status','invitation_version','invitation_delivery_status','invitation_sent_at','invitation_expires_at','invitation_revoked_at','accepted_at'].map(key=>[key,row[key]])),auth_bound:!!row.auth_user_id});
const privateKeys=['email','auth_user_id','password','token','invitation_token_hash'];
export function delegatedAuditDelta(previous,current){
  assert.equal(new Set(current.map(row=>row.id)).size,current.length,'delegated_duplicate_audit');
  for(const row of previous)assert.deepEqual(current.find(item=>item.id===row.id),row,'delegated_old_audit_changed');
  const ids=new Set(previous.map(row=>row.id));return current.filter(row=>!ids.has(row.id));
}
function auditIdentity(row,{site,entityId,entityType,label,actorId}){
  assert.equal(row.merchant_id,site);assert.equal(row.entity_id,entityId);assert.equal(row.entity_type,entityType);assert.equal(row.target_label,label);
  assert.equal(row.actor_type,actorId?'employee':'owner');assert.equal(row.actor_id,actorId??null);
  for(const value of [row.before_data,row.after_data])for(const key of privateKeys)assert.equal(key in value,false,'delegated_audit_private_field');
}

export function assertDelegatedRoleAudit(rows,{site,before,after,beforeBoards,afterBoards,actorId=null}){
  assert.equal(rows.length,1+beforeBoards.length+afterBoards.length,'delegated_role_audit_count');
  assert.equal(new Set(rows.map(row=>row.id)).size,rows.length,'delegated_duplicate_audit');
  for(const row of rows)auditIdentity(row,{site,entityId:before.id,entityType:'role',label:before.name,actorId});
  const changes=rows.filter(row=>row.event_type==='role.updated');assert.equal(changes.length,1);
  assert.deepEqual(changes[0].before_data,roleSummary(before));assert.deepEqual(changes[0].after_data,roleSummary(after));
  const mappings=rows.filter(row=>row.event_type==='role.board_scope_changed');
  const signatures=mappings.map(row=>JSON.stringify([row.before_data,row.after_data]));
  assert.deepEqual(sorted(signatures),sorted([...beforeBoards.map(board=>JSON.stringify([{board_id:board},{}])),...afterBoards.map(board=>JSON.stringify([{}, {board_id:board}]))]));
}

export function assertDelegatedEmployeeAudit(rows,{site,before,after,actorId}){
  assert.equal(rows.length,1);const row=rows[0];
  auditIdentity(row,{site,entityId:before.id,entityType:'employee',label:before.display_name,actorId});
  assert.equal(row.event_type,after.status==='disabled'?'employee.disabled':'employee.restored');
  assert.deepEqual(row.before_data,employeeSummary(before));assert.deepEqual(row.after_data,employeeSummary(after));
}

export async function checkAttendanceDelegatedManagementShell({owner,newDelegatePage,response,requests,exec,events,audits,employee,prepared,plan,origin,actor,pass,holdDelegateRoleRpc,delegateRequest}){
  const {site,employeeId,delegateEmployeeId,outsideEmployeeId,delegateAuthId,roles,boards,permissions,labels}=plan.consts;
  assert.equal(site,'99990001');assert.equal(actor.id,delegateAuthId);assert.equal(events().length,0);assert.equal(audits().length,0);
  const rows=table=>JSON.parse(exec(`select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb) from public.${table} t;`));
  const role=id=>rows('merchant_enterprise_roles').find(row=>row.id===id);
  const staff=id=>rows('merchant_enterprise_employees').find(row=>row.id===id);
  const mappings=id=>JSON.parse(exec(`select coalesce(jsonb_agg(board_id order by board_id),'[]'::jsonb) from public.merchant_enterprise_role_boards where merchant_id='${site}' and role_id='${id}';`));
  const protectedFacts=()=>exec(`select md5(jsonb_build_object(
    'events',(select jsonb_agg(to_jsonb(t) order by id) from public.merchant_attendance_events t),
    'workers',(select jsonb_agg(to_jsonb(t) order by id) from public.merchant_attendance_workers t),
    'settings',(select jsonb_agg(to_jsonb(t) order by merchant_id) from public.merchant_attendance_settings t),
    'locations',(select jsonb_agg(to_jsonb(t) order by id) from public.merchant_attendance_locations t),
    'employment',(select jsonb_agg(to_jsonb(t) order by worker_id,starts_on) from public.merchant_attendance_employment_periods t),
    'scope',(select jsonb_agg(to_jsonb(t) order by employee_id) from public.merchant_attendance_scopes t),
    'grants',(select jsonb_agg(to_jsonb(t) order by id) from public.merchant_attendance_scope_grants t),
    'scopeWorkers',(select jsonb_agg(to_jsonb(t) order by employee_id,grant_id,worker_id) from public.merchant_attendance_scope_workers t),
    'scopeLocations',(select jsonb_agg(to_jsonb(t) order by employee_id,grant_id,location_id) from public.merchant_attendance_scope_locations t),
    'scopeOperations',(select jsonb_agg(to_jsonb(t) order by operation_id) from public.merchant_attendance_scope_operations t),
    'boards',(select jsonb_agg(to_jsonb(t) order by id) from public.merchant_task_boards t),
    'columns',(select jsonb_agg(to_jsonb(t) order by id) from public.merchant_task_columns t),
    'tasks',(select jsonb_agg(to_jsonb(t) order by id) from public.merchant_tasks t),
    'assignments',(select jsonb_agg(to_jsonb(t) order by task_id,employee_id) from public.merchant_task_assignees t),
    'otherRoles',(select jsonb_agg(to_jsonb(t) order by id) from public.merchant_enterprise_roles t where id not in ('${roles.target}','${roles.delegate}')),
    'otherEmployees',(select jsonb_agg(to_jsonb(t) order by id) from public.merchant_enterprise_employees t where id<>'${employeeId}'))::text);`);
  const baseline=protectedFacts(),originalTarget=role(roles.target),originalDelegate=role(roles.delegate),originalEmployee=employee();
  assert.equal(originalEmployee.id,employeeId);assert.equal(originalTarget.access_scope,'restricted');assert.deepEqual(mappings(roles.target),[boards.a]);assert.equal(originalDelegate.access_scope,'all');
  const safe=()=>{assert.equal(protectedFacts(),baseline,'delegated_protected_facts_changed');assert.deepEqual(events(),[]);};
  const state=()=>({roles:rows('merchant_enterprise_roles'),employees:rows('merchant_enterprise_employees'),maps:JSON.parse(exec('select coalesce(jsonb_agg(to_jsonb(t) order by role_id,board_id),\'[]\'::jsonb) from public.merchant_enterprise_role_boards t;')),audits:audits()});
  const body=(page,id)=>page.locator(`[id="role-editor-${id}-body"]`);
  const checkbox=(page,id,key)=>body(page,id).locator(`[id="role-${id}-${key}"]`);
  const openRole=async(page,id)=>{
    await page.getByRole('button',{name:'角色权限',exact:true}).click();const expand=page.locator(`button[aria-controls="role-editor-${id}-body"]`);
    await expand.waitFor();if(await expand.getAttribute('aria-expanded')!=='true')await expand.click();await body(page,id).waitFor();return body(page,id);
  };
  const permissionGroup=async(page,id,label)=>body(page,id).getByRole('navigation',{name:'权限主要板块',exact:true}).getByRole('button',{name:new RegExp('^'+label+'，')}).click();
  const saveRole=async(page,id,nextPermissions,nextScope,nextBoards,actorId=null)=>{
    const before=role(id),beforeBoards=mappings(id),beforeAudits=audits(),calls=prepared.calls.length;
    const saved=response(page,rolePath,'PATCH'),refreshed=response(page,overviewPath,'GET');
    await body(page,id).getByRole('button',{name:'保存角色',exact:true}).click();await saved;await refreshed;await page.getByText('角色已保存。',{exact:true}).waitFor();
    const after=role(id);assert.equal(after.version,before.version+1);assert.equal(after.access_scope,nextScope);assert.deepEqual(sorted(after.permissions),sorted(nextPermissions));assert.deepEqual(mappings(id),sorted(nextBoards));
    assert.deepEqual({...after,permissions:before.permissions,access_scope:before.access_scope,version:before.version,updated_at:before.updated_at},before);
    assert.equal(prepared.calls.length,calls+1);assertDelegatedRoleAudit(delegatedAuditDelta(beforeAudits,audits()),{site,before,after,beforeBoards,afterBoards:nextBoards,actorId});safe();
  };
  const patchRole=(id,patch={})=>{const current=role(id);return {siteId:site,roleId:id,version:current.version,name:current.name,description:current.description,permissions:current.permissions,accessScope:current.access_scope,allowedBoardIds:mappings(id),...patch};};
  const denied=async(path,method,value,status=403,error=null)=>{
    const before=state(),count=prepared.calls.length,result=await delegateRequest(path,method,value);
    assert.equal(result.status,status);const payload=await result.json();assert.equal(payload.ok,false);
    if(error)assert.equal(payload.error,error);else assert(['permission_escalation_denied','permission_denied','attendance_access_denied'].includes(payload.error));
    assert.equal(prepared.calls.length,count,'delegated_forbidden_request_reached_mutation_rpc');assert.deepEqual(state(),before);safe();return payload;
  };

  await openRole(owner,roles.delegate);await body(owner,roles.delegate).getByRole('radio',{name:/^指定看板/}).check();
  await body(owner,roles.delegate).getByRole('group',{name:'选择角色可以访问的看板',exact:true}).getByRole('checkbox',{name:labels.boardA,exact:true}).check();
  await saveRole(owner,roles.delegate,permissions.delegate,'restricted',[boards.a]);
  pass('actual owner changes delegated manager from all boards to restricted A; SQL version and role/mapping audit match, with no attendance or task writes');

  const delegate=await newDelegatePage();assert.equal((await delegate.context().cookies()).length,0);
  await delegate.goto(origin+'/enterprise');await delegate.getByLabel('员工邮箱',{exact:true}).fill(actor.email);await delegate.getByLabel('密码',{exact:true}).fill('Synthetic-attendance-only!');
  await delegate.getByRole('button',{name:'登录并选择企业',exact:true}).click();
  await delegate.locator('article').filter({hasText:`企业编号 ${site}`}).getByRole('button',{name:'进入工作台',exact:true}).click();
  await delegate.getByRole('navigation',{name:'企业管理功能',exact:true}).waitFor();
  await openRole(delegate,roles.target);
  assert(await body(delegate,roles.target).getByRole('radio',{name:/^全部看板/}).isDisabled());
  const options=body(delegate,roles.target).getByRole('group',{name:'选择角色可以访问的看板',exact:true});
  assert.equal(await options.getByRole('checkbox').count(),1);assert(await options.getByRole('checkbox',{name:labels.boardA,exact:true}).isChecked());assert.equal(await options.getByText(labels.boardB,{exact:true}).count(),0);
  assert(await delegate.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  pass('390px real SDK delegate shell offers only board A and disables all-board granting; no injected employee cookie or out-of-scope board option');

  await permissionGroup(delegate,roles.target,'员工考勤');await checkbox(delegate,roles.target,'attendance.self.clock').uncheck();assert(await checkbox(delegate,roles.target,'attendance.self.view').isChecked());
  await saveRole(delegate,roles.target,permissions.target.filter(p=>p!=='attendance.self.clock'),'restricted',[boards.a],delegateEmployeeId);
  await checkbox(delegate,roles.target,'attendance.self.clock').check();await saveRole(delegate,roles.target,permissions.target,'restricted',[boards.a],delegateEmployeeId);
  pass('delegate explicitly removes/restores target self.clock while retaining self.view; two actual v3 writes and mapping replacement audits preserve every attendance fact');

  for(const [id,message] of [[roles.delegate,'不能修改自己的角色。'],[roles.system,'员工不能修改系统角色。'],[roles.outside,'该角色的看板访问范围高于当前账号。']]){
    await openRole(delegate,id);await delegate.locator(`button[aria-controls="role-editor-${id}-body"]`).getByText(message,{exact:true}).waitFor();
    assert.equal(await body(delegate,id).getByRole('button',{name:'保存角色',exact:true}).count(),0);assert(await body(delegate,id).getByLabel('角色名称',{exact:true}).isDisabled());
  }
  pass('actual role editor keeps own, system and board-B roles read-only rather than delegating merely because roles.manage is present');

  for(const value of [patchRole(roles.target,{permissions:[...permissions.target,'tasks.view']}),patchRole(roles.target,{accessScope:'all',allowedBoardIds:[]}),patchRole(roles.target,{allowedBoardIds:[boards.b]}),patchRole(roles.delegate),patchRole(roles.system),patchRole(roles.outside)])await denied(rolePath,'PATCH',value);
  await denied(rolePath,'PATCH',patchRole(roles.target,{allowedBoardIds:[boards.a,boards.b]}),403,'permission_escalation_denied');
  await denied(rolePath,'PATCH',patchRole(roles.outside,{allowedBoardIds:[boards.a]}),403,'permission_escalation_denied');
  const invalidDependencies=await denied(rolePath,'PATCH',patchRole(roles.target,{permissions:['enterprise.view','attendance.self.clock']}),400,'invalid_permission_dependencies');
  assert.deepEqual(invalidDependencies.missingPermissions,['attendance.self.view']);
  for(const path of [
    `/api/merchant-enterprise/attendance/admin?siteId=${site}&view=settings`,
    `/api/merchant-enterprise/attendance/records?siteId=${site}&access=manager&fromAt=2026-10-01T00:00:00.000Z&toAt=2026-10-02T00:00:00.000Z`,
    `/api/merchant-enterprise/attendance/scopes?siteId=${site}&employeeId=${delegateEmployeeId}`,
  ])await denied(path,'GET');
  pass('eight direct role escalation/self/system requests and three attendance authority probes get real403; clock without view gets exact400 dependency error, all before mutation RPC with unchanged state; board delegation grants neither attendance records nor owner configuration/scope control');

  await delegate.getByRole('button',{name:'员工账号',exact:true}).click();
  const card=name=>delegate.getByText(name,{exact:true}).locator('xpath=../../..');
  await card(labels.targetEmployee).getByRole('button',{name:'停用',exact:true}).waitFor();
  for(const disabled of [true,false]){
    const before=employee(),beforeAudits=audits(),calls=prepared.calls.length;
    if(disabled)await card(labels.targetEmployee).getByRole('button',{name:'停用',exact:true}).click();
    const changed=response(delegate,employeePath,'PATCH');
    if(disabled)await delegate.getByRole('dialog',{name:'安全停用员工',exact:true}).getByRole('button',{name:'停用并解除负责人',exact:true}).click();else await card(labels.targetEmployee).getByRole('button',{name:'恢复',exact:true}).click();
    await changed;await card(labels.targetEmployee).getByRole('button',{name:disabled?'恢复':'停用',exact:true}).waitFor();
    const after=employee();assert.equal(after.status,disabled?'disabled':'active');assert.equal(after.version,before.version+1);
    assert.deepEqual({...after,status:before.status,version:before.version,updated_at:before.updated_at},before);assert.equal(prepared.calls.length,calls+1);
    assertDelegatedEmployeeAudit(delegatedAuditDelta(beforeAudits,audits()),{site,before,after,actorId:delegateEmployeeId});safe();
  }
  pass('delegate uses actual employee UI to disable/restore the in-scope attendance employee; audited actor is delegate and no attendance event, task or assignment is manufactured');

  for(const [id,label] of [[delegateEmployeeId,labels.delegateEmployee],[outsideEmployeeId,labels.outsideEmployee]]){
    assert.equal(await card(label).getByRole('button',{name:/^(停用|恢复|编辑姓名|管理邀请)$/}).count(),0);
    await denied(employeePath,'PATCH',{siteId:site,employeeId:id,version:staff(id).version,status:'disabled',offboardingMode:'unassign'});
  }
  pass('self and out-of-scope invited employee have no lifecycle controls; authenticated direct PATCH also denies without a mutation RPC or audit');

  await openRole(delegate,roles.target);await permissionGroup(delegate,roles.target,'员工考勤');await checkbox(delegate,roles.target,'attendance.self.clock').uncheck();
  const beforeTarget=role(roles.target),beforeCalls=prepared.calls.length,failed=response(delegate,rolePath,'PATCH',403),gate=holdDelegateRoleRpc();
  await body(delegate,roles.target).getByRole('button',{name:'保存角色',exact:true}).click();await gate.ready();
  await openRole(owner,roles.delegate);await permissionGroup(owner,roles.delegate,'角色权限');await checkbox(owner,roles.delegate,'roles.manage').uncheck();
  await saveRole(owner,roles.delegate,permissions.delegate.filter(p=>p!=='roles.manage'),'restricted',[boards.a]);
  const beforeRelease=state();await gate.release();assert.equal((await(await failed).json()).error,'permission_escalation_denied');
  assert.deepEqual(role(roles.target),beforeTarget);assert.deepEqual(state(),beforeRelease);assert.equal(prepared.calls.length,beforeCalls+2);safe();
  await delegate.getByText('不能授予高于当前账号的权限，也不能修改自己的管理角色。',{exact:true}).waitFor();
  const refreshed=response(delegate,overviewPath,'GET');await delegate.getByRole('button',{name:'刷新数据',exact:true}).click();const current=await(await refreshed).json();
  assert.equal(current.actor.id,delegateEmployeeId);assert.equal(current.actor.permissions.includes('roles.manage'),false);
  await body(delegate,roles.target).getByRole('button',{name:'保存角色',exact:true}).waitFor({state:'detached'});
  assert.equal(prepared.calls.length,beforeCalls+2);safe();
  pass('authorized handler request held before SQL loses delegated roles.manage; actual atomic SQL returns403 without target mutation, explicit refresh removes editing and no automatic retry occurs');

  await checkbox(owner,roles.delegate,'roles.manage').check();await saveRole(owner,roles.delegate,permissions.delegate,'restricted',[boards.a]);
  const restored=response(delegate,overviewPath,'GET');await delegate.getByRole('button',{name:'刷新数据',exact:true}).click();await restored;await openRole(delegate,roles.target);
  await body(delegate,roles.target).getByRole('button',{name:'保存角色',exact:true}).waitFor();
  assert.deepEqual(sorted(role(roles.target).permissions),sorted(originalTarget.permissions));assert.deepEqual(sorted(role(roles.delegate).permissions),sorted(originalDelegate.permissions));
  assert.equal(role(roles.target).version,originalTarget.version+2);assert.equal(role(roles.delegate).version,originalDelegate.version+3);assert.equal(employee().version,originalEmployee.version+2);assert.equal(employee().status,'active');
  assert.deepEqual(mappings(roles.target),[boards.a]);assert.deepEqual(mappings(roles.delegate),[boards.a]);
  assert.equal(audits().length,16);assert.equal(prepared.calls.length,8);assert.equal(prepared.calls.filter(row=>row.name.includes('_role_')).length,6);assert.equal(prepared.calls.filter(row=>row.name.includes('_employee_')).length,2);
  assert.equal(requests.filter(row=>row.path.startsWith('/api/merchant-enterprise/attendance/')&&row.method==='POST').length,0);safe();
  assert(await delegate.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  pass('owner restores delegation; five successful role changes plus two employee changes yield exact16 audits, one rejected SQL request, zero attendance writes and unchanged protected facts');
  return {roleChanges:5,employeeChanges:2,managementAudits:16,mutationRpcCalls:8,rejectedSqlCalls:1,attendanceEvents:0,attendanceScopeChanges:0,protectedFactsUnchanged:true,restrictedBoardId:boards.a};
}
