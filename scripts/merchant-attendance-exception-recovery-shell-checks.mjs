// Continues the opt-in exception scenario, using only its real UI-created
// synthetic facts. No direct ledger writes, production access or app changes.
import assert from 'node:assert/strict';

async function bounded(work,label,ms=5000) {
  let timer;
  try {return await Promise.race([work,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(label)),ms);})]);}
  finally {clearTimeout(timer);}
}

export async function checkAttendanceExceptionRecoveryShell({owner,newPage,admin,exec,requests,pass,origin,site,actors,control,holdExceptionResponse}) {
  assert.equal(site,'99990001');
  const paths={review:'/api/merchant-enterprise/attendance/location-reviews',discussion:'/api/merchant-enterprise/attendance/location-discussion'};
  const region=(page,kind)=>page.getByRole('region',{name:kind==='review'?'定位异常核查':'定位异常说明与回复',exact:true});
  const workspace=page=>page.getByRole('region',{name:'考勤异常工作区',exact:true});
  const rows=table=>JSON.parse(exec(`select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from public.${table} t;`));
  const events=rows('merchant_attendance_events'),target=events.find(row=>row.sequence===1);assert.equal(events.length,4);assert(target);
  const employeeId=target.actor_employee_id,eventId=target.id;
  const employeeRecord=JSON.parse(exec(`select to_jsonb(t) from public.merchant_enterprise_employees t where merchant_id='${site}' and id='${employeeId}';`));assert.equal(employeeRecord.auth_user_id,actors[2].id);assert.equal(employeeRecord.status,'active');
  const reviewKey=`faolla:attendance:location-review:v1:${site}:${actors[0].id}`,discussionKey=`faolla:attendance:discussion:v1:${site}:self:${employeeId}`;
  const pending=(page,key)=>page.evaluate(key=>sessionStorage.getItem(key),key);
  const reviews=()=>rows('merchant_attendance_location_reviews'),messages=()=>rows('merchant_attendance_location_discussion');
  const originalReviews=reviews(),originalMessages=messages();assert.equal(originalReviews.length,2);assert.equal(originalMessages.length,4);
  const protectedTables=['merchant_attendance_events','merchant_attendance_location_results','merchant_attendance_location_clock_notices','merchant_attendance_location_notice_acknowledgements','merchant_attendance_location_policy_drafts','merchant_attendance_location_notices','merchant_attendance_location_setup_operations','merchant_attendance_settings','merchant_attendance_locations','merchant_attendance_workers','merchant_attendance_config_operations','merchant_attendance_scopes','merchant_attendance_scope_grants','merchant_attendance_scope_workers','merchant_attendance_scope_locations','merchant_attendance_scope_operations'];
  const facts=()=>exec(`select jsonb_build_object(${protectedTables.map(table=>`'${table}',(select md5(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text)::text,'[]')) from public.${table} t)`).join(',')});`),baseline=facts();
  const preserved=()=>{
    assert.equal(facts(),baseline,'recovery_changed_original_attendance_facts');
    for(const [before,after] of [[originalReviews,reviews()],[originalMessages,messages()]])for(const row of before)assert.deepEqual(after.find(value=>value.operation_id===row.operation_id),row,'recovery_rewrote_existing_entry');
  };
  const firstRequest=requests.length,writes=()=>requests.slice(firstRequest).filter(row=>row.method==='POST'&&Object.values(paths).includes(row.path));
  const done=(page,kind,{method='GET',status=200,mode='detail'}={})=>page.waitForResponse(response=>{const url=new URL(response.url());return url.pathname===paths[kind]&&response.request().method()===method&&response.status()===status&&(method==='POST'||url.searchParams.get('mode')===mode);});
  const result=async response=>{const value=await (await response).json();assert.equal(value.ok,true);return value;};
  const readListAndSelect=async(page,kind)=>{
    const panel=region(page,kind),day=target.occurred_at.slice(0,10);
    await panel.getByLabel('开始日期',{exact:true}).fill(day);await panel.getByLabel(kind==='review'?'结束日期（含当天）':'结束日期',{exact:true}).fill(day);await panel.getByLabel(kind==='review'?'查询／显示时区':'查询时区',{exact:true}).fill('UTC');
    if(kind==='review')await panel.getByRole('combobox',{name:/^核查状态/}).selectOption('all');
    const listReply=done(page,kind,{mode:'list'});await panel.getByRole('button',{name:kind==='review'?'查询异常':'查询／刷新首批',exact:true}).click();const list=await result(listReply),index=list.items.findIndex(item=>(item.id??item.eventId)===eventId);assert(index>=0);
    const detailReply=done(page,kind);await panel.locator('article').nth(index).getByRole('button').click();const detail=await result(detailReply);await panel.getByRole('textbox',{name:kind==='review'?/^理由（必填/:/^补充说明/}).waitFor();return detail;
  };
  const enterOwner=async()=>{await owner.getByRole('button',{name:'考勤配置',exact:true}).click();await admin(owner).getByRole('button',{name:'定位异常核查／员工说明',exact:true}).click();await region(owner,'review').waitFor();};
  const leaveOwner=async()=>{await owner.getByRole('button',{name:'主管考勤范围',exact:true}).click();await workspace(owner).waitFor({state:'detached'});};
  const settledBrowser=page=>bounded(page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))),'exception_recovery_browser_settle_timeout');
  const fillMessage=async(page,note)=>{await region(page,'discussion').getByRole('textbox',{name:/^补充说明/}).fill(note);await region(page,'discussion').getByRole('checkbox',{name:/^我确认将说明提交给企业负责人/}).check();};
  const privateNote='合成迟到内部核查：仅负责人可见且不可被旧回复清除待确认';
  let employee=null,statusChanged=false;
  try {
    await leaveOwner();await enterOwner();await readListAndSelect(owner,'review');
    await region(owner,'review').getByRole('textbox',{name:/^理由（必填/}).fill('合成外层离开前未提交草稿');
    control.acceptDialogs=false;const cancelDialog=owner.waitForEvent('dialog');await owner.getByRole('button',{name:'主管考勤范围',exact:true}).click();assert.match((await cancelDialog).message(),/尚未提交的文字/);
    assert.equal(await region(owner,'review').getByRole('textbox',{name:/^理由（必填/}).inputValue(),'合成外层离开前未提交草稿');assert.equal(writes().length,0);assert.equal(await pending(owner,reviewKey),null);
    control.acceptDialogs=true;await leaveOwner();assert.equal(writes().length,0);await enterOwner();await readListAndSelect(owner,'review');assert.equal(await region(owner,'review').getByRole('textbox',{name:/^理由（必填/}).inputValue(),'');preserved();
    pass('real outer enterprise navigation cancel keeps unsent private text; accepting the draft-specific confirmation discards only that draft, with zero POST or receipt creation');

    const reviewPanel=region(owner,'review');await reviewPanel.getByRole('combobox',{name:/^核查结论/}).selectOption('follow_up');await reviewPanel.getByRole('textbox',{name:/^理由（必填/}).fill(privateNote);await reviewPanel.getByRole('checkbox',{name:/^我确认仅追加核查意见/}).check();
    const held=holdExceptionResponse(owner,paths.review);await reviewPanel.getByRole('button',{name:'保存核查意见',exact:true}).click();const committed=await held.ready();assert.equal(committed.item.reviewRevision,3);assert.equal(committed.receipt.note,privateNote);const heldRaw=await pending(owner,reviewKey);assert(heldRaw);const heldIntent=JSON.parse(heldRaw);assert.equal(heldIntent.command.operationId,committed.receipt.operationId);assert.equal(reviews().length,3);assert.equal(writes().length,1);
    assert(await workspace(owner).getByRole('button',{name:'返回考勤',exact:true}).isDisabled());await leaveOwner();await held.release();await settledBrowser(owner);
    assert.equal(await workspace(owner).count(),0);assert.equal((await owner.locator('body').innerText()).includes(privateNote),false);assert.equal(await pending(owner,reviewKey),heldRaw,'late_success_removed_original_pending_after_unmount');
    const recoveredReply=done(owner,'review');await enterOwner();const recovered=await result(recoveredReply);await reviewPanel.getByRole('status').filter({hasText:'已确认核查版本'}).waitFor();assert.equal(recovered.receipt.operationId,heldIntent.command.operationId);assert.equal(await pending(owner,reviewKey),null);assert.equal(writes().length,1);
    const disclosure=reviewPanel.locator('details');await disclosure.locator('summary').click();await disclosure.getByText(privateNote,{exact:true}).waitFor();assert.equal(await disclosure.locator('ol > li').count(),3);preserved();
    pass('actual committed private review response is held until outer-navigation unmount, then released: no stale display or pending-byte deletion; re-entry reads original receipt once without a second POST');

    employee=await newPage({employee:true,mobile:true});await employee.addInitScript(()=>{const state={calls:0};Object.defineProperty(window,'__attendanceRecoveryGps',{value:state});Object.defineProperty(navigator,'geolocation',{configurable:true,value:{getCurrentPosition(){state.calls++;throw Error('recovery_must_not_request_gps');},watchPosition(){state.calls++;throw Error('recovery_must_not_watch_gps');},clearWatch(){}}});});
    const enterEmployee=async()=>{await employee.locator('[data-employee-merchant-main="1"]').waitFor();await employee.getByRole('navigation',{name:'企业管理功能',exact:true}).getByRole('button',{name:'我的考勤',exact:true}).click();const own=employee.getByRole('region',{name:'我的考勤',exact:true});await own.getByRole('button',{name:'刷新状态',exact:true}).waitFor();await own.getByRole('button',{name:'我的定位异常／提交说明',exact:true}).click();await region(employee,'discussion').waitFor();};
    await employee.goto(origin+'/enterprise');await employee.getByLabel('员工邮箱',{exact:true}).fill(actors[2].email);await employee.getByLabel('密码',{exact:true}).fill('Synthetic-attendance-only!');await employee.getByRole('button',{name:'登录并选择企业',exact:true}).click();await employee.locator('article').filter({hasText:`企业编号 ${site}`}).getByRole('button',{name:'进入工作台',exact:true}).click();await employee.waitForURL(url=>url.pathname==='/enterprise/'+site);await enterEmployee();const before=await readListAndSelect(employee,'discussion');assert.equal(before.item.revision,4);assert.equal(JSON.stringify(before).includes(privateNote),false);
    const publicNote='合成待确认说明：恢复权限后只核对原编号';await fillMessage(employee,publicNote);control.lose=paths.discussion;await region(employee,'discussion').getByRole('button',{name:'提交说明',exact:true}).click();await region(employee,'discussion').getByRole('status').filter({hasText:'暂时无法确认结果或访问权限'}).waitFor();const uncertainRaw=await pending(employee,discussionKey);assert(uncertainRaw);const uncertain=JSON.parse(uncertainRaw);assert.equal(messages().length,5);assert.equal(messages().find(row=>row.operation_id===uncertain.command.operationId)?.note,publicNote);
    statusChanged=true;exec(`update public.merchant_enterprise_employees set status='disabled' where merchant_id='${site}' and id='${employeeId}';`);
    const denied=done(employee,'discussion',{status:403});await region(employee,'discussion').getByRole('button',{name:'重读详情／核对收据',exact:true}).click();const deniedBody=await (await denied).json();assert.equal(deniedBody.error,'attendance_access_denied');assert.equal('history' in deniedBody,false);await region(employee,'discussion').getByRole('status').filter({hasText:'暂时无法确认结果或访问权限'}).waitFor();assert.equal(await region(employee,'discussion').locator('ol > li').count(),0);assert.equal(await pending(employee,discussionKey),uncertainRaw);
    const deniedCapabilities=employee.waitForResponse(response=>new URL(response.url()).pathname==='/api/merchant-business/capabilities'&&response.status()===403);await employee.evaluate(()=>window.dispatchEvent(new Event('focus')));await deniedCapabilities;await employee.getByText('登录状态或角色权限已变化，请重新核验。',{exact:true}).waitFor();assert.equal(await workspace(employee).count(),0);assert.equal((await employee.locator('body').innerText()).includes(publicNote),false);assert.equal(await pending(employee,discussionKey),uncertainRaw);assert.equal(writes().length,2);
    exec(`update public.merchant_enterprise_employees set status='active' where merchant_id='${site}' and id='${employeeId}';`);statusChanged=false;
    const restoredCapabilities=employee.waitForResponse(response=>new URL(response.url()).pathname==='/api/merchant-business/capabilities'&&response.status()===200);await employee.getByRole('button',{name:'重新核验权限',exact:true}).click();await restoredCapabilities;const employeeRecoveryReply=done(employee,'discussion');await enterEmployee();const employeeRecovered=await result(employeeRecoveryReply);await region(employee,'discussion').getByRole('status').filter({hasText:'已确认保存'}).waitFor();assert.equal(employeeRecovered.receipt.operationId,uncertain.command.operationId);assert.equal(employeeRecovered.item.revision,5);assert.equal(await pending(employee,discussionKey),null);await region(employee,'discussion').locator('ol > li').first().getByText(publicNote,{exact:true}).waitFor();assert.equal(writes().length,2);assert.equal(JSON.stringify(employeeRecovered).includes(privateNote),false);preserved();
    pass('employee committed-but-unconfirmed explanation survives actual receipt GET403 and capability-driven unmount unchanged; explicit permission recheck after restoration recovers original receipt by GET, with no duplicate message or private-note disclosure');

    const beforeRetryReviews=reviews(),beforeRetryMessages=messages();
    await fillMessage(employee,'合成提交前中断：只有明确原编号重试才补交');control.unsent=paths.discussion;await region(employee,'discussion').getByRole('button',{name:'提交说明',exact:true}).click();await region(employee,'discussion').getByRole('status').filter({hasText:'暂时无法确认结果或访问权限'}).waitFor();const unsentRaw=await pending(employee,discussionKey);assert(unsentRaw);const unsent=JSON.parse(unsentRaw);assert.equal(messages().length,5);const failed=writes().at(-1);assert.equal(failed.fault,'before-handler');assert.deepEqual(failed.body,{siteId:unsent.query.siteId,access:unsent.query.access,expectedWorkerId:unsent.query.expectedWorkerId,...unsent.command});
    const retryStart=requests.length,retryReply=done(employee,'discussion',{method:'POST'});await region(employee,'discussion').getByRole('button',{name:'使用原编号重试',exact:true}).click();const retried=await result(retryReply);await region(employee,'discussion').getByRole('status').filter({hasText:'已确认保存'}).waitFor();assert.equal(retried.receipt.operationId,unsent.command.operationId);assert.equal(retried.item.revision,6);assert.equal(await pending(employee,discussionKey),null);
    const retryRequests=requests.slice(retryStart).filter(row=>row.path===paths.discussion);assert.deepEqual(retryRequests.map(row=>row.method),['GET','POST']);assert.equal(retryRequests[0].query.operationId,unsent.command.operationId);assert.deepEqual(retryRequests[1].body,failed.body);assert.equal(messages().filter(row=>row.operation_id===unsent.command.operationId).length,1);await region(employee,'discussion').locator('ol > li').first().getByText(retried.receipt.note,{exact:true}).waitFor();assert.equal(await region(employee,'discussion').locator('ol > li').count(),6);
    assert.deepEqual(reviews(),beforeRetryReviews);for(const row of beforeRetryMessages)assert.deepEqual(messages().find(value=>value.operation_id===row.operation_id),row);
    const employeeBody=await employee.locator('body').innerText();for(const row of reviews()){assert(!employeeBody.includes(row.note));assert(!JSON.stringify(retried).includes(row.note));}
    assert.equal(reviews().length,3);assert.equal(messages().length,6);assert.equal(writes().length,4);assert.equal(await employee.evaluate(()=>window.__attendanceRecoveryGps.calls),0);assert(await employee.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.equal(await pending(owner,reviewKey),null);preserved();
    pass('pre-handler interruption creates no row and retains exact intent; only explicit original-ID retry performs GET then identical POST, appending one message while all prior evidence stays unchanged and GPS remains unused');
  } finally {
    control.acceptDialogs=true;control.lose=null;control.unsent=null;
    try {if(statusChanged)exec(`update public.merchant_enterprise_employees set status='active' where merchant_id='${site}' and id='${employeeId}';`);} finally {if(employee)await bounded(employee.context().close(),'exception_recovery_employee_close_timeout');}
  }
}
