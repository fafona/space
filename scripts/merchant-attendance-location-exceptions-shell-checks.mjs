// Opt-in continuation of the existing local merchant/employee shell acceptance.
// Four original events are prerequisites, never manufactured/edited here. Only
// explicitly confirmed real UI review/message writes append new business rows.
import assert from 'node:assert/strict';

export async function checkAttendanceLocationExceptionsShell({owner,newPage,admin,exec,transport,requests,pass,origin,site,actors,id,control}) {
  assert.equal(site,'99990001');
  const endpoints={review:'/api/merchant-enterprise/attendance/location-reviews',discussion:'/api/merchant-enterprise/attendance/location-discussion'};
  const workspace=page=>page.getByRole('region',{name:'考勤异常工作区',exact:true});
  const panel=(page,kind)=>page.getByRole('region',{name:kind==='review'?'定位异常核查':'定位异常说明与回复',exact:true});
  const rows=(table,order='event_id,revision')=>JSON.parse(exec(`select coalesce(jsonb_agg(to_jsonb(t) order by ${order}),'[]'::jsonb) from public.${table} t;`));
  const events=rows('merchant_attendance_events','sequence');assert.deepEqual(events.map(row=>row.action),['clock_in','break_start','break_end','clock_out']);
  const target=events[0],employeeId=target.actor_employee_id,workerId=target.worker_id,eventId=target.id;
  const employeeRecord=JSON.parse(exec(`select to_jsonb(t) from public.merchant_enterprise_employees t where merchant_id='${site}' and id='${employeeId}';`));assert.equal(employeeRecord.auth_user_id,actors[2].id);
  const role=JSON.parse(exec(`select to_jsonb(t) from public.merchant_enterprise_roles t where merchant_id='${site}' and id='${employeeRecord.role_id}';`));
  const ownerColumns=['user_id','auth_user_id','owner_user_id','owner_id','auth_id','created_by','created_by_user_id'];
  const ownerBindings=JSON.parse(exec(`select jsonb_build_object(${ownerColumns.map(key=>`'${key}',${key}`).join(',')}) from public.merchants where id='${site}';`));
  const dates=JSON.parse(exec(`select jsonb_build_object('start',to_char(min(occurred_at) at time zone 'UTC','YYYY-MM-DD'),'end',to_char(max(occurred_at) at time zone 'UTC','YYYY-MM-DD')) from public.merchant_attendance_events;`));
  const reviews=()=>rows('merchant_attendance_location_reviews'),messages=()=>rows('merchant_attendance_location_discussion');assert.deepEqual(reviews(),[]);assert.deepEqual(messages(),[]);
  const protectedTables=['merchant_attendance_events','merchant_attendance_location_results','merchant_attendance_location_clock_notices','merchant_attendance_location_notice_acknowledgements','merchant_attendance_location_policy_drafts','merchant_attendance_location_notices','merchant_attendance_location_setup_operations','merchant_attendance_settings','merchant_attendance_locations','merchant_attendance_workers','merchant_attendance_config_operations','merchant_attendance_scopes','merchant_attendance_scope_grants','merchant_attendance_scope_workers','merchant_attendance_scope_locations','merchant_attendance_scope_operations'];
  const facts=()=>exec(`select jsonb_build_object(${protectedTables.map(table=>`'${table}',(select md5(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text)::text,'[]')) from public.${table} t)`).join(',')});`);
  const baseline=facts(),wasEnabled=transport.state.moduleEnabled,firstRequest=requests.length;
  const preserved=()=>assert.equal(facts(),baseline,'exception_workflow_rewrote_original_attendance_or_configuration_facts');
  const immutable=(before,after)=>{for(const row of before)assert.deepEqual(after.find(current=>current.operation_id===row.operation_id),row,'original_review_or_public_message_rewritten');};
  const writes=kind=>requests.slice(firstRequest).filter(row=>row.method==='POST'&&(!kind?Object.values(endpoints).includes(row.path):row.path===endpoints[kind]));
  const key=(access,actor)=>`faolla:attendance:discussion:v1:${site}:${access}:${actor}`;
  const pending=(page,access)=>page.evaluate(key=>sessionStorage.getItem(key),key(access,access==='owner'?actors[0].id:employeeId));
  const reviewKey=`faolla:attendance:location-review:v1:${site}:${actors[0].id}`;
  const privateNotes=['合成内部备注甲：只供负责人核查，不得复制公开','合成内部备注乙：平台暂停仍可追加核查'];
  const publicOnly=value=>{const body=JSON.stringify(value);for(const note of privateNotes)assert(!body.includes(note),'internal_review_note_leaked_to_discussion');for(const item of value.history??[])assert.deepEqual(Object.keys(item).sort(),['author','note','recordedAt','revision']);};
  const visibleHistory=async(page,value)=>{
    assert.equal(value.mode,'detail');const items=panel(page,'discussion').locator('ol > li');
    for(const [index,entry] of value.history.entries()){
      const item=items.nth(index);await item.waitFor({state:'visible'});
      await item.getByText(entry.note,{exact:true}).waitFor({state:'visible'});
      await item.getByText(`${entry.author==='owner'?'负责人公开回复':'员工说明'} · 第 ${entry.revision} 条`,{exact:true}).waitFor({state:'visible'});
    }
    assert.equal(await items.count(),value.history.length,'rendered_public_history_count_mismatch');
  };
  const visibleReviewHistory=async value=>{
    const disclosure=panel(owner,'review').locator('details');
    if(!await disclosure.evaluate(element=>element.open))await disclosure.locator('summary').click();
    const items=disclosure.locator('ol > li'),outcomes={noted:'已核查（仅记录意见）',follow_up:'需补充说明',reopen:'重新打开'};
    for(const [index,entry] of value.history.entries()){
      const item=items.nth(index);await item.waitFor({state:'visible'});
      await item.getByText(entry.note,{exact:true}).waitFor({state:'visible'});
      await item.getByText(`v${entry.revision} · ${outcomes[entry.outcome]}`,{exact:true}).waitFor({state:'visible'});
    }
    assert.equal(await items.count(),value.history.length,'rendered_private_review_history_count_mismatch');
  };
  const done=(page,kind,{method='GET',status=200,mode='detail'}={})=>page.waitForResponse(response=>{const url=new URL(response.url());return url.pathname===endpoints[kind]&&response.request().method()===method&&response.status()===status&&(method==='POST'||url.searchParams.get('mode')===mode);});
  const result=async(response,kind)=>{const value=await (await response).json();assert.equal(value.ok,true);if(kind==='discussion')publicOnly(value);return value;};
  const list=async(page,kind)=>{
    const region=panel(page,kind);await region.getByLabel('开始日期',{exact:true}).fill(dates.start);await region.getByLabel(kind==='review'?'结束日期（含当天）':'结束日期',{exact:true}).fill(dates.end);await region.getByLabel(kind==='review'?'查询／显示时区':'查询时区',{exact:true}).fill('UTC');
    if(kind==='review')await region.getByRole('combobox',{name:/^核查状态/}).selectOption('all');
    const response=done(page,kind,{mode:'list'});await region.getByRole('button',{name:kind==='review'?'查询异常':'查询／刷新首批',exact:true}).click();const value=await result(response,kind);assert.equal(value.scanned,4);assert.equal(value.items.length,3);assert.equal(value.nextCursor,null);assert.deepEqual(value.items.map(item=>item.id??item.eventId).sort(),[events[0].id,events[2].id,events[3].id].sort());await region.locator('article').nth(2).waitFor();return value;
  };
  const select=async(page,kind,value)=>{
    const index=value.items.findIndex(item=>(item.id??item.eventId)===eventId);assert(index>=0);const response=done(page,kind);await panel(page,kind).locator('article').nth(index).getByRole('button').click();const detail=await result(response,kind);
    await panel(page,kind).getByRole('textbox',{name:kind==='review'?/^理由（必填/:page===owner?/^发给员工的回复/:/^补充说明/}).waitFor();if(kind==='discussion')await visibleHistory(page,detail);return detail;
  };
  const reload=async(page,kind)=>{const response=done(page,kind);await panel(page,kind).getByRole('button',{name:'重读详情／核对收据',exact:true}).click();const detail=await result(response,kind);await panel(page,kind).getByRole('status').filter({hasText:kind==='review'?'已读取当前核查详情':/只显示明确向员工公开|已确认保存/}).waitFor();if(kind==='discussion')await visibleHistory(page,detail);return detail;};
  const ownerStep=async(kind,{discard=false}={})=>{const response=done(owner,kind);await workspace(owner).getByRole('button',{name:kind==='review'?'内部核查（仅负责人）':'员工可见说明／回复',exact:true}).click();if(discard)await workspace(owner).getByRole('button',{name:'放弃未提交输入并继续',exact:true}).click();const value=await result(response,kind);await panel(owner,kind).getByRole('textbox',{name:kind==='review'?/^理由（必填/:/^发给员工的回复/}).waitFor();if(kind==='discussion')await visibleHistory(owner,value);return value;};
  const review=async(outcome,note)=>{
    const region=panel(owner,'review');await region.getByRole('combobox',{name:/^核查结论/}).selectOption(outcome);await region.getByRole('textbox',{name:/^理由（必填/}).fill(note);await region.getByRole('checkbox',{name:/^我确认仅追加核查意见/}).check();const response=done(owner,'review',{method:'POST'});await region.getByRole('button',{name:'保存核查意见',exact:true}).click();const value=await result(response,'review');await region.getByRole('status').filter({hasText:'已确认核查版本'}).waitFor();await visibleReviewHistory(value);const stored=reviews().find(row=>row.operation_id===value.receipt.operationId);assert(stored);assert.equal(stored.note,note);assert.equal(stored.outcome,outcome);assert.equal(stored.event_id,eventId);return value;
  };
  const fillMessage=async(page,note)=>{const region=panel(page,'discussion');await region.getByRole('textbox',{name:page===owner?/^发给员工的回复/:/^补充说明/}).fill(note);await region.getByRole('checkbox',{name:page===owner?/^我确认这段回复可以向该员工公开/:/^我确认将说明提交给企业负责人/}).check();};
  const message=async(page,note,status=200)=>{
    await fillMessage(page,note);const response=done(page,'discussion',{method:'POST',status});await panel(page,'discussion').getByRole('button',{name:page===owner?'提交公开回复':'提交说明',exact:true}).click();const value=await (await response).json();
    if(status===200){publicOnly(value);await panel(page,'discussion').getByRole('status').filter({hasText:'已确认保存'}).waitFor();await visibleHistory(page,value);const stored=messages().find(row=>row.operation_id===value.receipt.operationId);assert(stored);assert.equal(stored.note,note);assert.equal(stored.author,page===owner?'owner':'self');assert.equal(stored.actor_auth_user_id,page===owner?actors[0].id:actors[2].id);assert.equal(await pending(page,page===owner?'owner':'self'),null);}
    return value;
  };
  const quote=value=>value===null?'null':`'${String(value).replaceAll("'","''")}'`;
  let employee=null,roleChanged=false,statusChanged=false,ownerChanged=false;
  const restoreRole=()=>{exec(`update public.merchant_enterprise_roles set permissions=array[${role.permissions.map(quote).join(',')}],version=version+1 where merchant_id='${site}' and id='${role.id}';`);roleChanged=false;};
  try {
    transport.state.moduleEnabled=true;
    await owner.getByRole('region',{name:'地点定位工作区',exact:true}).getByRole('button',{name:'返回工作地点',exact:true}).click();await admin(owner).getByRole('button',{name:'定位异常核查／员工说明',exact:true}).click();await panel(owner,'review').getByRole('button',{name:'查询异常',exact:true}).waitFor();assert.equal(writes().length,0);
    const ownerList=await list(owner,'review');assert(ownerList.items.every(item=>item.reviewRevision===0&&item.reviewState==='pending'));const ownerEmpty=await select(owner,'review',ownerList);assert.deepEqual(ownerEmpty.history,[]);assert.equal(ownerEmpty.item.id,eventId);

    employee=await newPage({employee:true,mobile:true});await employee.addInitScript(()=>{const state={calls:0};Object.defineProperty(window,'__attendanceExceptionGps',{value:state,configurable:true});Object.defineProperty(navigator,'geolocation',{configurable:true,value:{getCurrentPosition(){state.calls++;throw Error('exception_workflow_must_not_request_gps');},watchPosition(){state.calls++;throw Error('exception_workflow_must_not_watch_gps');},clearWatch(){}}});});
    const enterEmployee=async()=>{
      await employee.locator('[data-employee-merchant-main="1"]').waitFor();const tabs=employee.getByRole('navigation',{name:'企业管理功能',exact:true});await tabs.waitFor();await tabs.getByRole('button',{name:'我的考勤',exact:true}).click();const own=employee.getByRole('region',{name:'我的考勤',exact:true});await own.getByRole('button',{name:'刷新状态',exact:true}).waitFor();await own.getByRole('button',{name:'我的定位异常／提交说明',exact:true}).click();await panel(employee,'discussion').getByRole('button',{name:'查询／刷新首批',exact:true}).waitFor();
    };
    await employee.goto(origin+'/enterprise');await employee.getByLabel('员工邮箱',{exact:true}).fill(actors[2].email);await employee.getByLabel('密码',{exact:true}).fill('Synthetic-attendance-only!');await employee.getByRole('button',{name:'登录并选择企业',exact:true}).click();await employee.locator('article').filter({hasText:`企业编号 ${site}`}).getByRole('button',{name:'进入工作台',exact:true}).click();await employee.waitForURL(url=>url.pathname==='/enterprise/'+site);await enterEmployee();
    const employeeList=await list(employee,'discussion');assert.equal(employeeList.workerId,workerId);assert.equal(employeeList.employeeId,employeeId);assert.equal(employeeList.canPost,true);const employeeEmpty=await select(employee,'discussion',employeeList);assert.deepEqual(employeeEmpty.history,[]);assert.equal(employeeEmpty.item.eventId,eventId);assert.equal(writes().length,0);preserved();
    pass('actual owner and390px SDK employee exception entries read the same three eligible exceptions from four original events, exclude the inside break-start, and create no review, message, GPS request or attendance mutation');

    await panel(owner,'review').getByRole('textbox',{name:/^理由（必填/}).fill('合成未提交内部文字');await panel(owner,'review').getByRole('button',{name:'查看员工说明／公开回复',exact:true}).click();await workspace(owner).getByRole('alert').filter({hasText:'尚未提交的文字会丢弃'}).waitFor();await workspace(owner).getByRole('button',{name:'保留输入',exact:true}).click();assert.equal(await panel(owner,'review').getByRole('textbox',{name:/^理由（必填/}).inputValue(),'合成未提交内部文字');assert.equal(writes().length,0);assert.equal(await owner.evaluate(key=>sessionStorage.getItem(key),reviewKey),null);
    await ownerStep('discussion',{discard:true});assert.equal(await panel(owner,'discussion').getByRole('textbox',{name:/^发给员工的回复/}).inputValue(),'');assert.equal(messages().length,0);await ownerStep('review');
    const privateReview=await review('follow_up',privateNotes[0]);assert.equal(privateReview.item.reviewState,'follow_up');assert.equal(privateReview.item.reviewRevision,1);assert.equal(messages().length,0);const originalReview=reviews();
    const stateOnly=await reload(employee,'discussion');assert.equal(stateOnly.item.reviewState,'follow_up');assert.deepEqual(stateOnly.history,[]);assert.equal((await employee.locator('body').innerText()).includes(privateNotes[0]),false);
    const publicDraft=await ownerStep('discussion');assert.deepEqual(publicDraft.history,[]);assert.equal(await panel(owner,'discussion').getByRole('textbox',{name:/^发给员工的回复/}).inputValue(),'');const reply=await message(owner,'合成公开回复甲：请说明当时无法定位的原因');assert.equal(reply.item.revision,1);assert.equal(reply.item.reviewState,'follow_up');
    const visibleReply=await reload(employee,'discussion');assert.equal(visibleReply.history[0].note,reply.receipt.note);assert.equal(visibleReply.history[0].author,'owner');assert.equal((await employee.locator('body').innerText()).includes(privateNotes[0]),false);assert.equal(messages().length,1);immutable(originalReview,reviews());preserved();
    pass('dirty internal text is retained on cancel and explicitly discarded on step change; private follow_up stores only an internal review, while a separately acknowledged public reply reaches the employee without copying or leaking the private note');

    const explanation=await message(employee,'合成员工说明甲：当时设备拒绝定位，已明确选择无定位登记');assert.equal(explanation.item.revision,2);assert.equal(explanation.item.lastAuthor,'self');assert.equal(explanation.item.reviewState,'follow_up');assert.equal(reviews().length,1);const ownerReads=await reload(owner,'discussion');assert.equal(ownerReads.history[0].author,'self');assert.equal(ownerReads.history[0].note,explanation.receipt.note);assert.equal(ownerReads.item.reviewState,'follow_up');assert.equal(messages().length,2);immutable(originalReview,reviews());preserved();
    pass('employee explicitly submits an actor-bound explanation and owner reads the same immutable public message; correspondence revision advances independently and never changes the private follow_up conclusion or original punches');

    const originalMessages=messages();await fillMessage(owner,'合成公开回复乙：已收到说明，请保留现场登记依据');control.lose=endpoints.discussion;await panel(owner,'discussion').getByRole('button',{name:'提交公开回复',exact:true}).click();await panel(owner,'discussion').getByRole('status').filter({hasText:'暂时无法确认结果或访问权限'}).waitFor();const lostRaw=await pending(owner,'owner');assert(lostRaw);const lost=JSON.parse(lostRaw);assert.equal(messages().length,3);assert.equal(messages().at(-1).operation_id,lost.command.operationId);assert.equal(writes('discussion').at(-1).fault,'after-sql');assert(await workspace(owner).getByRole('button',{name:'返回考勤',exact:true}).isDisabled());
    const stale=await message(employee,'合成过期说明：不得覆盖已追加的负责人回复',409);assert.equal(stale.error,'attendance_version_conflict');await panel(employee,'discussion').getByRole('status').filter({hasText:'暂时无法确认结果或访问权限'}).waitFor();assert.equal(await pending(employee,'self'),null);assert.equal(messages().length,3);assert.equal(writes('discussion').at(-1).body.expectedRevision,2);immutable(originalMessages,messages());
    const beforeRecovery=writes().length;await owner.reload();await owner.getByRole('button',{name:'企业管理',exact:true}).click();await owner.getByRole('button',{name:'考勤配置',exact:true}).click();const recoveredResponse=done(owner,'discussion');await admin(owner).getByRole('button',{name:'定位异常核查／员工说明',exact:true}).click();const recovered=await result(recoveredResponse,'discussion');await panel(owner,'discussion').getByRole('status').filter({hasText:'已确认保存'}).waitFor();await visibleHistory(owner,recovered);assert.equal(recovered.receipt.operationId,lost.command.operationId);assert.equal(recovered.item.revision,3);assert.equal(await pending(owner,'owner'),null);assert.equal(writes().length,beforeRecovery);
    assert(requests.some(row=>row.path===endpoints.discussion&&row.method==='GET'&&row.query.operationId===lost.command.operationId));assert.equal(messages().length,3);immutable(originalMessages,messages());preserved();
    pass('owner reply lost AFTER actual SQL commit keeps its original operation; stale employee revision rejects409 without a row, and full AdminClient refresh recovers the committed reply by original-ID GET without resubmission');

    transport.state.moduleEnabled=false;
    // A definitive stale-write refusal leaves unsent form dirtiness to the
    // workspace; explicit discard is required before re-reading that case.
    await workspace(employee).getByRole('button',{name:'放弃未提交输入／重新读取',exact:true}).click();const discardResponse=done(employee,'discussion');await workspace(employee).getByRole('button',{name:'放弃未提交输入并继续',exact:true}).click();const afterDiscard=await result(discardResponse,'discussion');assert.equal(afterDiscard.moduleEnabled,false);assert.equal(afterDiscard.item.revision,3);await panel(employee,'discussion').getByRole('textbox',{name:/^补充说明/}).waitFor();
    const beforePausedReviews=reviews(),pausedReview=await ownerStep('review');assert.equal(pausedReview.moduleEnabled,false);const finalReview=await review('noted',privateNotes[1]);assert.equal(finalReview.item.reviewRevision,2);assert.equal(finalReview.item.reviewState,'reviewed');immutable(beforePausedReviews,reviews());
    const beforePausedMessages=messages();await reload(employee,'discussion');const pausedMessage=await message(employee,'合成员工说明乙：平台暂停期间补充已有记录事实');assert.equal(pausedMessage.moduleEnabled,false);assert.equal(pausedMessage.item.revision,4);assert.equal(pausedMessage.item.reviewState,'reviewed');assert.equal(reviews().length,2);assert.equal(messages().length,4);immutable(beforePausedMessages,messages());
    const pausedOwner=await ownerStep('discussion');assert.equal(pausedOwner.moduleEnabled,false);assert.equal(pausedOwner.history[0].note,pausedMessage.receipt.note);assert.equal(pausedOwner.item.reviewState,'reviewed');preserved();
    pass('platform pause still permits explicitly confirmed communication and internal review of existing exceptions; both ledgers append independently, old entries remain byte-identical, and all attendance/location/ACK/config/scope facts stay frozen');

    const beforeRole={reviews:reviews(),messages:messages()},roleVersion=Number(exec(`select version from public.merchant_enterprise_roles where merchant_id='${site}' and id='${role.id}';`));roleChanged=true;exec(`update public.merchant_enterprise_roles set permissions=array['enterprise.view','attendance.self.view'],version=version+1 where merchant_id='${site}' and id='${role.id}';`);
    const capabilities=employee.waitForResponse(response=>new URL(response.url()).pathname==='/api/merchant-business/capabilities'&&response.status()===200);await employee.evaluate(()=>window.dispatchEvent(new Event('focus')));const capabilityValue=await (await capabilities).json();assert.equal(capabilityValue.actor.authorizationVersion,`${roleVersion+1}:1`);await workspace(employee).waitFor({state:'detached'});await enterEmployee();const viewOnlyList=await list(employee,'discussion');assert.equal(viewOnlyList.canPost,false);
    const selected=viewOnlyList.items.findIndex(item=>item.eventId===eventId),viewResponse=done(employee,'discussion');await panel(employee,'discussion').locator('article').nth(selected).getByRole('button',{name:'查看说明与回复',exact:true}).click();const viewOnly=await result(viewResponse,'discussion');assert.equal(viewOnly.canPost,false);assert.equal(viewOnly.item.revision,4);await panel(employee,'discussion').getByText('当前只有本人查看权限，不能提交说明。',{exact:true}).waitFor();await visibleHistory(employee,viewOnly);assert.equal(await panel(employee,'discussion').getByRole('textbox',{name:/^补充说明/}).count(),0);assert.equal(await panel(employee,'discussion').getByRole('button',{name:'提交说明',exact:true}).count(),0);assert.deepEqual({reviews:reviews(),messages:messages()},beforeRole);assert(await employee.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));preserved();
    pass('role-version refresh remounts the actual390px employee shell: self.view-only reads current public history with server canPost=false, no compose form or submit button, and no ledger or original-fact mutation');

    await ownerStep('review');const beforeRevocation={reviews:reviews(),messages:messages()},beforeRevocationWrites=writes().length;
    ownerChanged=true;exec(`update public.merchants set user_id='${id(98)}',auth_user_id=null,owner_user_id=null,owner_id=null,auth_id=null,created_by=null,created_by_user_id=null where id='${site}';`);
    const deniedOwner=done(owner,'review',{status:403});await panel(owner,'review').getByRole('button',{name:'重读详情／核对收据',exact:true}).click();assert.equal((await (await deniedOwner).json()).error,'attendance_access_denied');await panel(owner,'review').getByRole('status').filter({hasText:'当前负责人权限无效'}).waitFor();assert.equal(await panel(owner,'review').locator('[data-attendance-draft]').count(),0);assert.equal((await panel(owner,'review').innerText()).includes(privateNotes[1]),false);
    statusChanged=true;exec(`update public.merchant_enterprise_employees set status='disabled' where merchant_id='${site}' and id='${employeeId}';`);const deniedEmployee=done(employee,'discussion',{status:403});await panel(employee,'discussion').getByRole('button',{name:'重读详情／核对收据',exact:true}).click();assert.equal((await (await deniedEmployee).json()).error,'attendance_access_denied');await panel(employee,'discussion').getByRole('status').filter({hasText:'暂时无法确认结果或访问权限'}).waitFor();assert.equal(await panel(employee,'discussion').locator('li').count(),0);
    const deniedCapabilities=employee.waitForResponse(response=>new URL(response.url()).pathname==='/api/merchant-business/capabilities'&&response.status()===403);await employee.evaluate(()=>window.dispatchEvent(new Event('focus')));await deniedCapabilities;await employee.getByText('登录状态或角色权限已变化，请重新核验。',{exact:true}).waitFor();assert.equal(await workspace(employee).count(),0);assert.equal(writes().length,beforeRevocationWrites);assert.deepEqual({reviews:reviews(),messages:messages()},beforeRevocation);preserved();
    assert.equal(await employee.evaluate(()=>window.__attendanceExceptionGps.calls),0);assert.equal(await pending(employee,'self'),null);assert.equal(await pending(owner,'owner'),null);assert.equal(await owner.evaluate(key=>sessionStorage.getItem(key),reviewKey),null);
    const stored=await employee.evaluate(()=>[...Object.values(localStorage),...Object.values(sessionStorage)].join('\n'));for(const note of privateNotes)assert(!stored.includes(note));for(const event of events)assert(!stored.includes(event.id));
    assert.equal(reviews().length,2);assert.equal(messages().length,4);assert.equal(writes('review').length,2);assert.equal(writes('discussion').filter(row=>row.status===200).length,4);assert.equal(writes('discussion').filter(row=>row.status===409).length,1);
    pass('current owner-binding removal and employee revocation deny the next real private/public SQL reads and clear displayed details; capability403 then removes the employee workspace, with zero GPS, duplicate posts or modifications to original four-event evidence');
  } catch(error) {
    if(employee&&!employee.isClosed()){
      let timer;try {const body=await Promise.race([employee.locator('body').innerText({timeout:2000}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('exception_diagnostic_timeout')),3000);})]);console.error(JSON.stringify({exceptionEmployeeFailure:{body:body.replace(/https?:\/\/\S+/g,'[url]').replace(/\b[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/g,'[token]').replaceAll('Synthetic-attendance-only!','[password]').slice(-12000)}}));}catch {console.error('exception_employee_diagnostics_unavailable');}finally {clearTimeout(timer);}
    }
    throw error;
  } finally {
    control.lose=null;control.unsent=null;transport.state.moduleEnabled=wasEnabled;
    try {if(roleChanged)restoreRole();} finally {
      try {if(statusChanged)exec(`update public.merchant_enterprise_employees set status=${quote(employeeRecord.status)} where merchant_id='${site}' and id='${employeeId}';`);} finally {
        try {if(ownerChanged)exec(`update public.merchants set ${ownerColumns.map(column=>`${column}=${quote(ownerBindings[column])}`).join(',')} where id='${site}';`);} finally {if(employee)await employee.context().close();}
      }
    }
  }
}
