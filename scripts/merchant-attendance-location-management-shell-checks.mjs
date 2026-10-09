// Local synthetic lifecycle acceptance: real owner editors and employee shell,
// real handlers/default executors and SQL. No coordinates, real Auth or device.
import assert from 'node:assert/strict';
import {assertAttendanceRoleManagementAudit} from './merchant-attendance-role-management-shell-checks.mjs';

const full=['enterprise.view','attendance.self.view','attendance.self.clock'];
const viewOnly=['enterprise.view','attendance.self.view'];
const sorted=value=>[...value].sort();

export function assertLocationManagementFacts(previous,current,{count,employeeId,workerId,placeId}){
  for(const key of ['events','summaries','links']){
    assert.equal(current[key].length,count);
    const id=key==='events'?'id':'event_id';
    assert.equal(new Set(current[key].map(row=>row[id])).size,count);
    for(const row of previous[key])assert.deepEqual(current[key].find(value=>value[id]===row[id]),row,'location_management_prior_fact_changed');
  }
  for(const [index,event] of current.events.entries()){
    assert.equal(event.sequence,index+1);assert.equal(event.actor_employee_id,employeeId);assert.equal(event.worker_id,workerId);assert.equal(event.location_id,placeId);
    assert.equal(event.source,'web');
    const summary=current.summaries.find(row=>row.event_id===event.id),link=current.links.find(row=>row.event_id===event.id);
    assert(summary);assert(link);assert.equal(summary.reason,'not_provided');assert.equal(summary.needs_review,true);
    assert.equal(link.safe_finish,index>=2);assert.equal(link.notice_revision,index>=2?null:1);
  }
}

export function assertLocationManagementEmployeeAudit(rows,{site,employeeId}){
  const history=[...rows].sort((a,b)=>a.created_at.localeCompare(b.created_at));assert.equal(history.length,2);
  for(const [index,row] of history.entries()){
    assert.equal(row.merchant_id,site);assert.equal(row.event_type,index?'employee.restored':'employee.disabled');
    assert.equal(row.entity_type,'employee');assert.equal(row.entity_id,employeeId);assert.equal(row.target_label,'合成员工甲');
    assert.equal(row.actor_type,'owner');assert.equal(row.actor_id,null);
    assert.equal(row.before_data.status,index?'disabled':'active');assert.equal(row.after_data.status,index?'active':'disabled');
    assert.deepEqual({...row.after_data,status:row.before_data.status},row.before_data);
    for(const data of [row.before_data,row.after_data])for(const key of ['email','auth_user_id','password','token','invitation_token_hash'])assert.equal(key in data,false);
  }
}

export async function checkAttendanceLocationManagementShell({owner,phone,self,response,requests,exec,events,audits,employee,roleRpcCalls,employeeRpcCalls,
  site,employeeId,workerId,placeId,roleId,pass,readLocation,holdResponse}){
  assert.equal(site,'99990001');assert.equal(events().length,0);assert.equal(audits().length,0);
  const endpoint='/api/merchant-enterprise/attendance/location-clock',roleEndpoint='/api/merchant-enterprise/roles',employeeEndpoint='/api/merchant-enterprise/employees';
  const key=`faolla:attendance:location-clock:v1:${site}:${employeeId}`,pending=()=>phone.evaluate(key=>sessionStorage.getItem(key),key);
  const panel=()=>phone.getByRole('region',{name:'定位打卡隔离原型',exact:true});
  const workspace=()=>phone.getByRole('region',{name:'我的定位考勤',exact:true});
  const nav=()=>phone.getByRole('navigation',{name:'企业管理功能',exact:true});
  const posts=()=>requests.filter(row=>row.path===endpoint&&row.method==='POST');
  const role=()=>JSON.parse(exec(`select to_jsonb(r) from public.merchant_enterprise_roles r where id='${roleId}' and merchant_id='${site}';`));
  const rows=(table,order)=>JSON.parse(exec(`select coalesce(jsonb_agg(to_jsonb(r) order by ${order}),'[]'::jsonb) from public.${table} r;`));
  const facts=()=>({events:rows('merchant_attendance_events','sequence'),summaries:rows('merchant_attendance_location_results','event_id'),links:rows('merchant_attendance_location_clock_notices','event_id')});
  const unchanged=()=>exec(`select jsonb_build_object(
    'workers',(select jsonb_agg(to_jsonb(t) order by id) from public.merchant_attendance_workers t),
    'places',(select jsonb_agg(to_jsonb(t) order by id) from public.merchant_attendance_locations t),
    'settings',(select jsonb_agg(to_jsonb(t) order by merchant_id) from public.merchant_attendance_settings t),
    'periods',(select jsonb_agg(to_jsonb(t) order by worker_id) from public.merchant_attendance_employment_periods t),
    'policies',(select jsonb_agg(to_jsonb(t) order by revision) from public.merchant_attendance_location_policy_drafts t),
    'notices',(select jsonb_agg(to_jsonb(t) order by revision) from public.merchant_attendance_location_notices t),
    'acks',(select jsonb_agg(to_jsonb(t) order by notice_revision) from public.merchant_attendance_location_notice_acknowledgements t),
    'otherRoles',(select jsonb_agg(to_jsonb(t) order by id) from public.merchant_enterprise_roles t where id<>'${roleId}'),
    'boards',(select jsonb_agg(to_jsonb(t) order by id) from public.merchant_task_boards t),
    'columns',(select jsonb_agg(to_jsonb(t) order by id) from public.merchant_task_columns t));`);
  const original=unchanged(),originalEmployee=employee(),originalRole=role();let previous=facts();
  const checkFacts=count=>{const current=facts();assertLocationManagementFacts(previous,current,{count,employeeId,workerId,placeId});previous=current;assert.equal(unchanged(),original);return current;};
  const checkReceipt=value=>{
    const all=facts(),event=all.events.find(row=>row.id===value.receipt.id);assert(event,'location_management_receipt_fact_missing');
    assert.equal(event.operation_id,value.receipt.operationId);assert.equal(event.action,value.receipt.action);assert.equal(event.sequence,value.receipt.sequence);
    const link=all.links.find(row=>row.event_id===event.id);assert.equal(link.command.operationId,value.receipt.operationId);
    assert.deepEqual(link.command,value.receiptGate.command);assert.equal(link.safe_finish,value.receiptGate.safeFinish);assert.equal(link.notice_revision,value.receiptGate.noticeRevision);
    const summary=all.summaries.find(row=>row.event_id===event.id);assert.equal(summary.reason,value.locationResult.reason);assert.equal(summary.needs_review,value.locationResult.needsReview);
  };
  const received=async promise=>{const value=await(await promise).json();assert(value.ok);checkReceipt(value);await panel().locator('dl').getByText(value.receipt.id,{exact:true}).waitFor();assert.equal(await pending(),null);return value;};
  const readPanel=async()=>{
    const read=response(phone,endpoint,'GET');await self().getByRole('button',{name:'定位打卡／地点告知',exact:true}).click();
    const value=await(await read).json();assert(value.ok);await panel().getByRole('button',{name:'重新读取／核对收据',exact:true}).waitFor();return value;
  };
  const enter=async()=>{await nav().getByRole('button',{name:'我的考勤',exact:true}).click();await self().getByRole('button',{name:'刷新状态',exact:true}).waitFor();return readPanel();};
  const focus=async(permissions,status=200)=>{
    const overview=response(phone,'/api/merchant-enterprise/overview','GET',status),caps=response(phone,'/api/merchant-business/capabilities','GET',403);
    await phone.evaluate(()=>window.dispatchEvent(new Event('focus')));await caps;const value=await(await overview).json();
    if(status===200){assert.deepEqual(sorted(value.actor.permissions),sorted(permissions));await nav().waitFor();}
    else await phone.getByRole('button',{name:'重新核验企业身份',exact:true}).waitFor();
    assert.equal(await workspace().count(),0);
  };
  const noPosition=async(action,retry=false)=>{
    if(!retry)await panel().getByRole('combobox',{name:'登记动作',exact:true}).selectOption(action);
    const details=panel().locator('details');if(!await details.evaluate(node=>node.open))await details.locator('summary').click();
    await details.getByRole('checkbox').check();
    await details.getByRole('button',{name:retry?'用原编号无定位重试':`无定位登记${action==='clock_in'?'上班':'开始休息'} · 待核查`,exact:true}).click();
  };
  const finish=async()=>{
    await panel().getByRole('checkbox',{name:/^确认现在/}).check();await panel().getByRole('button',{name:/^无定位(结束休息|下班) · 待核查$/}).click();
  };
  const roleBody=()=>owner.locator(`[id="role-editor-${roleId}-body"]`),checkbox=name=>roleBody().locator(`[id="role-${roleId}-${name}"]`);
  const openRole=async()=>{
    await owner.getByRole('button',{name:'角色权限',exact:true}).click();
    const expand=owner.locator(`button[aria-controls="role-editor-${roleId}-body"]`);if(await expand.getAttribute('aria-expanded')!=='true')await expand.click();
    await roleBody().getByRole('navigation',{name:'权限主要板块',exact:true}).getByRole('button',{name:/^员工考勤，/}).click();
  };
  const saveRole=async permissions=>{
    const before=role(),old=facts(),count=audits().length,saved=response(owner,roleEndpoint,'PATCH'),overview=response(owner,'/api/merchant-enterprise/overview','GET');
    await roleBody().getByRole('button',{name:'保存角色',exact:true}).click();await saved;await overview;await owner.getByText('角色已保存。',{exact:true}).waitFor();
    assert.equal(role().version,before.version+1);assert.deepEqual(sorted(role().permissions),sorted(permissions));
    assert.deepEqual({...role(),permissions:before.permissions,version:before.version,updated_at:before.updated_at},before);
    assert.deepEqual(facts(),old);assert.equal(audits().length,count+1);assert.equal(unchanged(),original);
  };
  const employeeCard=()=>owner.getByText('合成员工甲',{exact:true}).locator('xpath=../../..');
  const setEmployee=async disabled=>{
    const before=employee(),old=facts(),count=audits().length;await owner.getByRole('button',{name:'员工账号',exact:true}).click();
    if(disabled)await employeeCard().getByRole('button',{name:'停用',exact:true}).click();
    const changed=response(owner,employeeEndpoint,'PATCH');
    if(disabled)await owner.getByRole('dialog',{name:'安全停用员工',exact:true}).getByRole('button',{name:'停用并解除负责人',exact:true}).click();
    else await employeeCard().getByRole('button',{name:'恢复',exact:true}).click();
    await changed;await employeeCard().getByRole('button',{name:disabled?'恢复':'停用',exact:true}).waitFor();
    assert.equal(employee().status,disabled?'disabled':'active');assert.equal(employee().version,before.version+1);
    assert.deepEqual({...employee(),status:before.status,version:before.version,updated_at:before.updated_at},before);
    assert.equal(audits().length,count+1);assert.deepEqual(facts(),old);assert.equal(unchanged(),original);
  };
  const blockedReceipt=async(operationId)=>{const denied=await readLocation(operationId);assert.equal(denied.status,403);assert.deepEqual(await denied.json(),{ok:false,error:'attendance_access_denied'});};
  const releaseDisposed=async(gate,saved,receipt)=>{
    await gate.release();await phone.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    assert.equal(await workspace().count(),0);assert.equal(await phone.getByText(receipt.id,{exact:true}).count(),0);assert.equal(await pending(),saved);
  };

  const initial=await readPanel();assert.equal(initial.state.sequence,0);assert.equal(initial.noticeGate.ready,true);assert.equal(initial.channelEnabled,true);
  const firstResponse=response(phone,endpoint,'POST');await noPosition('clock_in');const first=await received(firstResponse);
  assert.equal(first.receipt.action,'clock_in');assert.equal(first.locationResult.reason,'not_provided');checkFacts(1);
  pass('actual390px employee workspace explicitly records a no-position start through real handler/default service/SQL; prepared policy/ACK is synthetic setup, no GPS is called');

  // Hold the authorized preflight READ, revoke with the actual editor, then let
  // the stale response reach the client. The subsequent real POST must refuse.
  await openRole();const preflight=holdResponse('GET');await noPosition('break_start');const stale=await preflight.ready();assert.equal(stale.channelEnabled,true);
  await checkbox('attendance.self.clock').uncheck();await saveRole(viewOnly);
  const rejected=response(phone,endpoint,'POST',403);await preflight.release();assert.equal((await(await rejected).json()).error,'attendance_access_denied');
  await panel().getByRole('status').filter({hasText:'当前身份或记录归属无法确认'}).waitFor();
  const deniedPending=await pending();assert(deniedPending);const deniedOperation=JSON.parse(deniedPending).intent.operationId;
  assert.equal(await panel().locator('dl').count(),0);assert(await panel().getByRole('button',{name:'原编号重试（先核对收据）',exact:true}).isDisabled());assert.equal(posts().length,2);checkFacts(1);
  pass('real role revocation between held authorized preflight and POST is rechecked by SQL:403 clears private result, retains original intent and writes no fact/summary/notice link');

  await focus(viewOnly);const viewing=await enter();assert.equal(viewing.state.sequence,1);assert.equal(viewing.channelEnabled,false);assert.equal(viewing.receipt,null);assert.equal(viewing.finish,null);
  assert.equal(await pending(),deniedPending);assert(await panel().getByRole('button',{name:'原编号重试（先核对收据）',exact:true}).isDisabled());
  await panel().locator('details > summary').click();
  assert(await panel().getByRole('button',{name:'用原编号无定位重试',exact:true}).isDisabled());assert.equal(posts().length,2);checkFacts(1);
  pass('self.view-only role can read current location state but cannot retry or safely finish; focus remount preserves pending ID and sends no location command');

  await checkbox('attendance.self.clock').check();await saveRole(full);await focus(full);const retryable=await enter();assert.equal(retryable.receipt,null);assert.equal(await pending(),deniedPending);assert.equal(posts().length,2);
  const retriedResponse=response(phone,endpoint,'POST');await noPosition('break_start',true);const retried=await received(retriedResponse);
  assert.equal(retried.receipt.operationId,deniedOperation);assert.equal(retried.receipt.action,'break_start');assert.equal(posts().length,3);checkFacts(2);
  pass('restored role reads only until explicit original-ID no-position retry; exactly one break-start fact and matching summary/link are added');

  const heldFinish=holdResponse();await finish();const late=await heldFinish.ready(),saved=await pending();assert(saved);assert.equal(JSON.parse(saved).intent.operationId,late.receipt.operationId);
  assert.equal(late.receipt.action,'break_end');assert.equal(late.receiptGate.safeFinish,true);checkReceipt(late);checkFacts(3);
  await setEmployee(true);await blockedReceipt(late.receipt.operationId);await focus(null,403);await releaseDisposed(heldFinish,saved,late.receipt);checkFacts(3);
  pass('actual employee disable denies original-location receipt reads and unmounts old workspace on identity refresh; committed late break-end cannot revive DOM or erase pending');
  await setEmployee(false);const identity=response(phone,'/api/merchant-enterprise/overview','GET');await phone.getByRole('button',{name:'重新核验企业身份',exact:true}).click();await identity;
  const recovered=await enter();assert.deepEqual(recovered.receipt,late.receipt);assert.deepEqual(recovered.locationResult,late.locationResult);assert.deepEqual(recovered.receiptGate,late.receiptGate);
  checkReceipt(recovered);
  await panel().locator('dl').getByText(late.receipt.id,{exact:true}).waitFor();assert.equal(await pending(),null);assert.equal(posts().length,4);checkFacts(3);
  pass('same-member restore recovers exact committed break-end receipt/summary/gate using GET only, without GPS, new operation or extra punch');

  await openRole();const heldOut=holdResponse();await finish();const out=await heldOut.ready(),outPending=await pending();assert(outPending);assert.equal(out.receipt.action,'clock_out');checkReceipt(out);checkFacts(4);
  await checkbox('attendance.self.view').uncheck();assert.equal(await checkbox('attendance.self.clock').isChecked(),false);await saveRole(['enterprise.view']);
  await blockedReceipt(out.receipt.operationId);await focus(['enterprise.view']);assert.equal(await nav().getByRole('button',{name:'我的考勤',exact:true}).count(),0);
  await releaseDisposed(heldOut,outPending,out.receipt);checkFacts(4);
  pass('revoking self.view removes dependent clock permission and attendance entry; late committed clock-out is ignored by disposed location workspace and original pending survives');
  await checkbox('attendance.self.clock').check();await saveRole(full);await focus(full);const final=await enter();
  assert.deepEqual(final.receipt,out.receipt);assert.deepEqual(final.locationResult,out.locationResult);assert.deepEqual(final.receiptGate,out.receiptGate);assert.equal(final.state.status,'off');
  checkReceipt(final);
  await panel().locator('dl').getByText(out.receipt.id,{exact:true}).waitFor();assert.equal(await pending(),null);assert.equal(posts().length,5);checkFacts(4);
  pass('restoring role recovers exact final clock-out by GET only; complete four-action shift has no duplicate event or rewritten earlier evidence');

  assert.deepEqual(facts().events.map(row=>row.action),['clock_in','break_start','break_end','clock_out']);
  assert.equal(roleRpcCalls.length,4);assert.equal(employeeRpcCalls.length,2);assert.equal(role().version,originalRole.version+4);assert.equal(employee().version,originalEmployee.version+2);
  assert.deepEqual({...employee(),version:originalEmployee.version,updated_at:originalEmployee.updated_at},originalEmployee);
  assert.deepEqual(sorted(role().permissions),sorted(originalRole.permissions));
  assert.deepEqual({...role(),permissions:originalRole.permissions,version:originalRole.version,updated_at:originalRole.updated_at},originalRole);
  const history=audits();assert.equal(history.length,6);
  assertAttendanceRoleManagementAudit(history.filter(row=>row.entity_type==='role'),{site,roleId});
  assertLocationManagementEmployeeAudit(history.filter(row=>row.entity_type==='employee'),{site,employeeId});
  assert.deepEqual(await phone.evaluate(()=>({...window.__attendanceLifecycleGps})),{get:0,watch:0});
  assert.equal(requests.filter(row=>row.path.endsWith('/attendance/self')&&row.method==='POST').length,0);
  const stored=await phone.evaluate(()=>[...Object.values(localStorage),...Object.values(sessionStorage)].join('\n'));
  for(const row of facts().events)assert(!stored.includes(row.id));for(const name of ['"latitude"','"longitude"'])assert(!stored.includes(name));
  assert(await phone.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  pass('six exact audited management changes preserve account binding/configuration and four old facts; storage has no receipt or coordinates, zero GPS and no ordinary punch POST');
  console.log(JSON.stringify({actualLocationManagementShell:true,roleChanges:4,employeeChanges:2,audits:6,locationPosts:5,acceptedFacts:4,
    heldPreflightThenRejected:true,lateCommittedResponsesAfterDisposal:2,recovery:'GET-only',explicitNoPosition:true,gpsCalls:0,
    realAuthService:false,realNextServer:false,realPhone:false,productionAccess:false}));
}
