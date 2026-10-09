// Actual employee/owner shells and route executors, synthetic Auth only. This
// opt-in chain reuses the existing owned SQL namespace; never real accounts,
// GPS, production, stored exports, or a second database/browser harness.
import assert from 'node:assert/strict';
import {runAttendanceCleanupSteps} from './fixtures/attendance-cleanup.mjs';

export async function checkAttendanceCorrectionFlowShell({owner,phone,newPage,openOwner,admin,exec,transport,requests,pass,origin,site,actors,id,control,holdCorrectionResponse,downloads,csvRows}) {
  assert.equal(site,'99990001');
  const endpoint=name=>'/api/merchant-enterprise/attendance/'+name;
  const rows=(table,order)=>JSON.parse(exec(`select coalesce(jsonb_agg(to_jsonb(t) order by ${order}),'[]'::jsonb) from public.${table} t;`));
  const events=()=>rows('merchant_attendance_events','sequence');
  const entries=()=>rows('merchant_attendance_correction_entries','revision');
  const decisions=()=>rows('merchant_attendance_correction_decisions','recorded_at,operation_id');
  const effects=()=>rows('merchant_attendance_correction_effects','request_id');
  const versions=()=>rows('merchant_attendance_effect_versions','revision');
  const workers=rows('merchant_attendance_workers','id');assert.equal(workers.length,1);
  const worker=workers[0],employeeId=worker.employee_id;
  const role=JSON.parse(exec(`select to_jsonb(t) from public.merchant_enterprise_roles t where id='${id(31)}';`));
  const ownerFields=['user_id','auth_user_id','owner_user_id','owner_id','auth_id','created_by','created_by_user_id'];
  const ownerBinding=JSON.parse(exec(`select jsonb_build_object(${ownerFields.map(field=>`'${field}',${field}`).join(',')}) from public.merchants where id='${site}';`));
  assert.equal(ownerBinding.user_id,actors[0].id);for(const value of Object.values(ownerBinding))assert(value===null||/^[0-9a-f-]{36}$/.test(value));
  const restoreOwner=()=>exec(`update public.merchants set ${ownerFields.map(field=>`${field}=${ownerBinding[field]===null?'null':`'${ownerBinding[field]}'`}`).join(',')} where id='${site}';`);
  const stable=()=>({workers:rows('merchant_attendance_workers','id'),settings:rows('merchant_attendance_settings','merchant_id'),
    config:rows('merchant_attendance_config_operations','operation_id'),scopeOperations:rows('merchant_attendance_scope_operations','operation_id'),
    scopes:rows('merchant_attendance_scopes','employee_id'),grants:rows('merchant_attendance_scope_grants','id'),
    scopeWorkers:rows('merchant_attendance_scope_workers','worker_id'),scopeLocations:rows('merchant_attendance_scope_locations','location_id')});
  const own=page=>page.getByRole('region',{name:'我的考勤',exact:true});
  const correction=page=>page.getByRole('region',{name:'本人考勤补正申请',exact:true});
  const review=(page=owner)=>page.getByRole('region',{name:'负责人补正申请核对',exact:true});
  const decision=(page=owner)=>page.getByRole('region',{name:'负责人补正审批',exact:true});
  const controls=()=>owner.getByRole('region',{name:'补正规则与锁定配置',exact:true});
  const writes=name=>requests.filter(r=>r.path===endpoint(name)&&r.method==='POST');
  const read=(page,name,method='GET',status=200,query={})=>page.waitForResponse(r=>{
    const url=new URL(r.url());return url.pathname===endpoint(name)&&r.request().method()===method&&r.status()===status
      &&Object.entries(query).every(([key,value])=>url.searchParams.get(key)===value);
  });
  const response=async promise=>{const value=await (await promise).json();assert.equal(value.ok,true);return value;};
  const click=async(page,name,button,method='GET',query={})=>{const ready=read(page,name,method,200,query);await button.click();return response(ready);};
  const decisionKey=`faolla:attendance:correction-decision:v1:${site}:${actors[0].id}`;
  const selfKey=`faolla:attendance:correction:v1:${site}:${employeeId}`;
  const pending=(page,key)=>page.evaluate(key=>sessionStorage.getItem(key),key);
  const settle=async page=>{let timer;try{
    await Promise.race([page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('correction_flow_browser_settle_timeout')),5000);})]);
  }finally{clearTimeout(timer);}};
  const employeeEnter=async page=>{
    await page.goto(origin+'/enterprise');await page.getByLabel('员工邮箱',{exact:true}).fill(actors[2].email);
    await page.getByLabel('密码',{exact:true}).fill('Synthetic-attendance-only!');await page.getByRole('button',{name:'登录并选择企业',exact:true}).click();
    await page.locator('article').filter({hasText:`企业编号 ${site}`}).getByRole('button',{name:'进入工作台',exact:true}).click();
    await page.waitForURL(url=>url.pathname==='/enterprise/'+site);await page.locator('[data-employee-merchant-main="1"]').waitFor();
    await page.getByRole('navigation',{name:'企业管理功能',exact:true}).getByRole('button',{name:'我的考勤',exact:true}).click();
    await own(page).getByRole('button',{name:'上班打卡',exact:true}).waitFor();
  };
  const openReview=async(page=owner)=>{await admin(page).getByRole('button',{name:'补正申请核对（只读）',exact:true}).click();await review(page).waitFor();};
  const ownerTarget=async(requestId,page=owner)=>{
    if(await decision(page).count())await decision(page).getByRole('button',{name:'返回核对列表',exact:true}).click();
    if(!await review(page).count())await openReview(page);
    const list=await click(page,'correction-reviews',review(page).getByRole('button',{name:'查询申请',exact:true}),'GET',{mode:'list'});
    const index=list.items.findIndex(item=>item.requestId===requestId);assert(index>=0,'correction_flow_request_missing_from_owner_list');
    const detail=await click(page,'correction-reviews',review(page).locator('article').nth(index).getByRole('button',{name:'核对差异与冲突',exact:true}),'GET',{mode:'detail',requestId});
    assert.equal(detail.item.requestId,requestId);assert.equal(detail.approvalAvailable,false);
    const current=await click(page,'correction-decisions',review(page).getByRole('button',{name:'进入本申请审批',exact:true}),'GET',{requestId});
    assert.equal(current.review.item.requestId,requestId);assert.equal(current.decision,null);assert.equal(current.canApprove,true);assert.equal(current.canReject,true);
    await decision(page).getByRole('combobox',{name:'选择决定',exact:true}).waitFor();
    assert.equal(await decision(page).getByRole('combobox',{name:'选择决定',exact:true}).inputValue(),'');return current;
  };
  const decisionDraft=async(action,reason,page=owner)=>{
    await decision(page).getByRole('combobox',{name:'选择决定',exact:true}).selectOption(action);
    await decision(page).getByRole('textbox',{name:/^决定理由/}).fill(reason);
    await decision(page).getByRole('checkbox',{name:/^我已核对申请人/}).check();
  };
  const submit=async(page,reason,{unsent=false,lateReply=false}={})=>{
    await correction(page).getByRole('textbox',{name:/^申请理由/}).fill(reason);
    await correction(page).getByRole('checkbox',{name:/^我已核对全部时间与休息/}).check();
    let value;
    if(unsent){
      const before=writes('corrections').length,calls=transport.calls.filter(call=>call.name==='faolla_attendance_correction_self_v3'&&call.command!==null).length;
      control.unsent=endpoint('corrections');await correction(page).getByRole('button',{name:'明确提交补正申请',exact:true}).click();
      await correction(page).getByRole('status').filter({hasText:'暂时无法确认结果或访问权限'}).waitFor();
      const raw=await pending(page,selfKey);assert(raw);const lost=JSON.parse(raw);assert.equal(control.unsent,null);
      assert.equal(entries().length,0);assert.equal(writes('corrections').length,before+1);
      assert.equal(transport.calls.filter(call=>call.name==='faolla_attendance_correction_self_v3'&&call.command!==null).length,calls);
      const missing=read(page,'corrections','GET',404,{mode:'detail',requestId:lost.command.operationId,operationId:lost.command.operationId});
      await correction(page).getByRole('button',{name:'按原编号核对结果',exact:true}).click();
      assert.equal((await (await missing).json()).error,'attendance_correction_not_found');
      await correction(page).getByRole('status').filter({hasText:'暂未查到原申请'}).waitFor();
      assert.equal(await pending(page,selfKey),raw);assert.equal(entries().length,0);assert.equal(writes('corrections').length,before+1);
      const from=requests.length,retry=read(page,'corrections','POST');
      await correction(page).getByRole('button',{name:'明确用原编号重试',exact:true}).click();value=await response(retry);
      const retryRequests=requests.slice(from).filter(r=>r.path===endpoint('corrections'));
      assert.deepEqual(retryRequests.map(r=>[r.method,r.status]),[['GET',404],['POST',200]]);
      assert.equal(retryRequests[0].query.operationId,lost.command.operationId);
      assert.deepEqual(writes('corrections').slice(before).map(r=>r.body),[0,1].map(()=>({siteId:site,expectedWorkerId:worker.id,...lost.command})));
      assert.equal(writes('corrections')[before].fault,'before-handler');assert.equal(entries().length,1);
      pass('self application lost BEFORE handler leaves zero SQL writes and keeps exact pending bytes after404; only explicit retry performs original-ID GET then identical POST, creating one application');
    }else if(lateReply){
      const held=holdCorrectionResponse(page,endpoint('corrections')),before=writes('corrections').length;
      await correction(page).getByRole('button',{name:'明确提交补正申请',exact:true}).click();const committed=await held.ready();
      const raw=await pending(page,selfKey);assert(raw);const originalIntent=JSON.parse(raw);
      assert.equal(committed.receipt.operationId,originalIntent.command.operationId);assert.equal(entries().length,2);
      assert.equal(writes('corrections').length,before+1);assert.equal(writes('corrections').at(-1).fault,'held-after-sql');
      const nav=page.getByRole('navigation',{name:'企业管理功能',exact:true});
      await nav.getByRole('button',{name:'工作台',exact:true}).click();await correction(page).waitFor({state:'detached'});
      await held.release();await settle(page);
      assert.equal(await correction(page).count(),0);assert.equal((await page.locator('body').innerText()).includes(reason),false);
      assert.equal(await pending(page,selfKey),raw,'late_correction_success_cleared_unmounted_pending');
      await nav.getByRole('button',{name:'我的考勤',exact:true}).click();await own(page).getByRole('button',{name:'刷新状态',exact:true}).waitFor();
      value=await click(page,'corrections',own(page).getByRole('button',{name:'我的补正申请／核对结果',exact:true}),'GET',{mode:'detail',requestId:originalIntent.command.operationId,operationId:originalIntent.command.operationId});
      assert.equal(value.receipt.operationId,committed.receipt.operationId);assert.equal(writes('corrections').length,before+1);assert.equal(entries().length,2);
      pass('actual application POST200 held AFTER SQL is released only after outer employee workbench navigation unmounts it; no stale reason or pending deletion, and re-entry GET recovers original receipt without duplicate POST');
    }else value=await click(page,'corrections',correction(page).getByRole('button',{name:'明确提交补正申请',exact:true}),'POST');
    await correction(page).getByRole('status').filter({hasText:'原操作已确认'}).waitFor();
    assert.equal(value.item.decision,null);assert.equal(await pending(page,selfKey),null);return value;
  };
  const selfRefresh=async page=>click(page,'corrections',correction(page).getByRole('button',{name:'重新读取',exact:true}));
  const wasEnabled=transport.state.moduleEnabled;let employee=null,roleChanged=false,ownerChanged=false;
  try {
    transport.state.moduleEnabled=true;await openOwner(owner);
    await admin(owner).getByRole('button',{name:'考勤设置',exact:true}).click();
    await admin(owner).getByRole('checkbox',{name:/^启用企业考勤/}).check();await admin(owner).getByRole('checkbox',{name:/^允许普通网页打卡/}).check();
    await click(owner,'admin',admin(owner).getByRole('button',{name:'保存考勤设置',exact:true}),'POST');
    const empty=await click(owner,'correction-controls',admin(owner).getByRole('button',{name:'补正规则／锁定配置',exact:true}));assert.equal(empty.policy,null);
    await controls().getByRole('combobox',{name:/^配置操作/}).selectOption('set_policy');
    await controls().getByRole('spinbutton',{name:/^原始上班日期后可提交天数/}).fill('7');
    await controls().getByRole('textbox',{name:/^变更理由/}).fill('合成验收：明确七日补正申请期限');
    await controls().getByRole('checkbox',{name:/^已核对范围与理由/}).check();
    const policy=await click(owner,'correction-controls',controls().getByRole('button',{name:'确认设置申请期限',exact:true}),'POST');
    assert.equal(policy.policy.values.submissionWindowDays,7);assert.equal(policy.revision,1);
    await controls().getByRole('button',{name:'返回考勤管理',exact:true}).click();
    const stableFacts=stable();assert.equal(stableFacts.config.length,5);assert.equal(events().length,0);
    exec(`update public.merchant_enterprise_roles set permissions=array_append(permissions,'attendance.self.request'),version=version+1 where merchant_id='${site}' and id='${role.id}';`);roleChanged=true;
    employee=await newPage({employee:true,mobile:true});await employeeEnter(employee);
    assert.equal(events().length,0);assert.equal(entries().length,0);assert.equal(decisions().length,0);
    pass('actual owner explicitly enables ordinary web attendance and seven-day correction policy;390px employee SDK login only reads current identity, creating no punch, application or decision');

    for(const [action,label] of [['clock_in','上班打卡'],['break_start','开始休息'],['break_end','结束休息'],['clock_out','下班打卡']]){
      const value=await click(employee,'self',own(employee).getByRole('button',{name:label,exact:true}),'POST');
      assert.equal(value.receipt.action,action);await own(employee).getByRole('status').filter({hasText:'打卡已确认'}).waitFor();
    }
    const original=events();assert.deepEqual(original.map(row=>row.action),['clock_in','break_start','break_end','clock_out']);
    assert(original.every(row=>row.source==='web'&&row.worker_id===worker.id));
    await correctionEntry();
    await correction(employee).getByRole('button',{name:'选择原始班次',exact:true}).click();
    const history=employee.getByRole('region',{name:'本人历史打卡',exact:true});
    await click(employee,'history',history.getByRole('button',{name:'查询本人记录',exact:true}));
    const prepared=await click(employee,'corrections',history.getByRole('button',{name:'选择本班次申请补正',exact:true}));
    assert.equal(prepared.basis.events[0].id,original[0].id);assert.equal(prepared.basis.events.length,4);
    assert.equal(prepared.canRequest,true);await correction(employee).getByRole('button',{name:'明确提交补正申请',exact:true}).waitFor();
    assert(await correction(employee).getByRole('button',{name:'明确提交补正申请',exact:true}).isDisabled());assert.equal(entries().length,0);
    assert(await employee.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    pass('four explicit real SelfPanel actions create one closed web session; mobile history selects its actual clock-in and prepares original microsecond evidence with no implicit submit');

    const {checkAttendanceCorrectionTimeShell}=await import('./merchant-attendance-correction-time-shell-checks.mjs');
    await checkAttendanceCorrectionTimeShell({employee,prepared,requests,pass,reprepare:async()=>{
      const value=await click(employee,'corrections',correction(employee).getByRole('button',{name:'重新读取',exact:true}),'GET',{mode:'prepare',startEventId:original[0].id});
      await correction(employee).getByRole('button',{name:'明确提交补正申请',exact:true}).waitFor();return value;
    }});
    const {checkCorrectionSelfDraftLeave,checkCorrectionOwnerDraftLeave}=await import('./merchant-attendance-correction-navigation-shell-checks.mjs');
    await checkCorrectionSelfDraftLeave({employee,prepared,requests,pass,control});
    assert.equal(entries().length,0);assert.deepEqual(events(),original);assert.deepEqual(stable(),stableFacts);
    const first=await submit(employee,'合成验收：保留原班次全部时间供首次核对',{unsent:true});
    assert.equal(first.item.revision,1);assert.equal(entries().length,1);assert.equal(first.proposal.breaks.length,1);
    assert.equal(first.proposal.startAt,prepared.basis.events[0].occurredAt);assert.equal(first.proposal.endAt,prepared.basis.events[3].occurredAt);
    assert.equal(first.proposal.breaks[0].startAt,prepared.basis.events[1].occurredAt);assert.equal(first.proposal.breaks[0].endAt,prepared.basis.events[2].occurredAt);
    assert.equal(decisions().length,0);assert.equal(effects().length,0);assert.deepEqual(events(),original);assert.deepEqual(stable(),stableFacts);
    pass('real self_v3 submission preserves untouched original microseconds and break boundaries, appends one pending application/rule binding, and produces no automatic decision or effective hours');

    await checkCorrectionOwnerDraftLeave({owner,requestId:first.item.requestId,ownerTarget,admin,requests,pass,control});
    const oldEvidence=await ownerTarget(first.item.requestId);
    await openOwner(phone,true);const phoneControls=phone.getByRole('region',{name:'补正规则与锁定配置',exact:true});
    const priorPolicy=await click(phone,'correction-controls',admin(phone).getByRole('button',{name:'补正规则／锁定配置',exact:true}));assert.equal(priorPolicy.revision,1);
    await phoneControls.getByRole('combobox',{name:/^配置操作/}).selectOption('set_policy');
    await phoneControls.getByRole('spinbutton',{name:/^原始上班日期后可提交天数/}).fill('8');
    await phoneControls.getByRole('textbox',{name:/^变更理由/}).fill('合成验收：另一页面明确更新为八日申请期限');
    await phoneControls.getByRole('checkbox',{name:/^已核对范围与理由/}).check();
    const newPolicy=await click(phone,'correction-controls',phoneControls.getByRole('button',{name:'确认设置申请期限',exact:true}),'POST');assert.equal(newPolicy.revision,2);
    assert.equal(newPolicy.policy.values.submissionWindowDays,8);
    await decisionDraft('approve','合成验收：旧页面条件变化时不能批准');
    const conflict=read(owner,'correction-decisions','POST',409);
    await decision().getByRole('button',{name:'确认批准',exact:true}).click();
    assert.equal((await (await conflict).json()).error,'attendance_correction_evidence_changed');
    await decision().getByRole('status').filter({hasText:'核对条件已经变化'}).waitFor();
    assert.equal(await pending(owner,decisionKey),null);assert.equal(decisions().length,0);assert.equal(effects().length,0);
    assert.equal(writes('correction-decisions').at(-1).body.expectedEvidence,oldEvidence.evidenceToken);
    const fresh=await click(owner,'correction-decisions',decision().getByRole('button',{name:'重新核对／查原收据',exact:true}));
    assert.notEqual(fresh.evidenceToken,oldEvidence.evidenceToken);assert.equal(fresh.canApprove,true);assert.equal(fresh.canReject,true);
    assert.equal(fresh.review.application.rules.policy.revision,1);assert.equal(fresh.review.application.rules.policy.submissionWindowDays,7);
    await decision().getByRole('combobox',{name:'选择决定',exact:true}).waitFor();assert.equal(await decision().getByRole('combobox',{name:'选择决定',exact:true}).inputValue(),'');
    assert.equal(await decision().getByRole('textbox',{name:/^决定理由/}).inputValue(),'');assert.deepEqual(events(),original);
    pass('real second owner context updates current policy; stale approve receives SQL409 before any decision/effect, clears only explicitly rejected intent, and reread requires a fresh empty decision while retaining request-bound seven-day policy');
    await phoneControls.getByRole('button',{name:'返回考勤管理',exact:true}).click();
    const competitor=await ownerTarget(first.item.requestId,phone);assert.equal(competitor.evidenceToken,fresh.evidenceToken);
    await decisionDraft('approve','合成另一页面待批准：不得覆盖另一页面已完成的驳回',phone);
    await decisionDraft('reject','合成验收：请移除误申报的声明休息后重新核对');
    const heldDecision=holdCorrectionResponse(owner,endpoint('correction-decisions')),beforeHeld=writes('correction-decisions').length;
    await decision().getByRole('button',{name:'确认驳回',exact:true}).click();const committedRejection=await heldDecision.ready();
    const rejectionRaw=await pending(owner,decisionKey);assert(rejectionRaw);assert.equal(JSON.parse(rejectionRaw).command.operationId,committedRejection.receipt.operationId);
    assert.equal(decisions().length,1);assert.equal(effects().length,0);assert.equal(writes('correction-decisions').at(-1).fault,'held-after-sql');
    await owner.getByRole('button',{name:'主管考勤范围',exact:true}).click();await decision().waitFor({state:'detached'});
    await heldDecision.release();await settle(owner);assert.equal(await decision().count(),0);
    assert.equal((await owner.locator('body').innerText()).includes(committedRejection.decision.reason),false);
    assert.equal(await pending(owner,decisionKey),rejectionRaw,'late_decision_success_cleared_unmounted_pending');
    await owner.getByRole('button',{name:'考勤配置',exact:true}).click();await openReview();
    const rejected=await click(owner,'correction-decisions',review().getByRole('button',{name:'审批操作／恢复待确认',exact:true}),'GET',{requestId:first.item.requestId,operationId:committedRejection.receipt.operationId});
    await decision().getByRole('status').filter({hasText:'原审批已确认'}).waitFor();assert.equal(await pending(owner,decisionKey),null);
    assert.equal(rejected.receipt.operationId,committedRejection.receipt.operationId);assert.equal(writes('correction-decisions').length,beforeHeld+1);
    pass('actual reject POST200 held AFTER SQL is released after outer owner scope navigation unmount; old private result stays absent, pending bytes stay intact, and explicit re-entry recovers original receipt by GET only');
    const winner=decisions(),competingReply=read(phone,'correction-decisions','POST',409);
    await decision(phone).getByRole('button',{name:'确认批准',exact:true}).click();
    assert.equal((await (await competingReply).json()).error,'attendance_correction_decided');
    await decision(phone).getByRole('status').filter({hasText:'申请已有决定'}).waitFor();assert.equal(await pending(phone,decisionKey),null);
    assert.equal(writes('correction-decisions').at(-1).body.expectedEvidence,competitor.evidenceToken);
    const lostDecisionId=writes('correction-decisions').at(-1).body.operationId;assert.notEqual(lostDecisionId,rejected.decision.operationId);
    const finalCompetitor=await click(phone,'correction-decisions',decision(phone).getByRole('button',{name:'重新核对／查原收据',exact:true}));
    assert.equal(finalCompetitor.decision.operationId,rejected.decision.operationId);assert.equal(finalCompetitor.decision.action,'reject');
    assert.equal(finalCompetitor.receipt,null);assert.equal(finalCompetitor.decisionEffect,null);assert.equal(finalCompetitor.current,null);
    assert.equal(await decision(phone).getByRole('form',{name:'确认补正决定',exact:true}).count(),0);
    assert.deepEqual(decisions(),winner);assert.equal(effects().length,0);assert.deepEqual(events(),original);
    pass('two actual owner contexts prepare opposing decisions on identical evidence: committed rejection wins, later stale approve returns SQL409 decided, and loser rereads winner without claiming its own receipt or overwriting history');
    assert.equal(rejected.decision.action,'reject');assert.equal(rejected.decisionEffect,null);assert.equal(rejected.current,null);
    await decision().getByRole('region',{name:'补正审批决定',exact:true}).getByText('已驳回 · 原申请保留',{exact:true}).waitFor();
    const afterReject=decisions(),rejectPosts=writes('correction-decisions').length;
    ownerChanged=true;exec(`update public.merchants set user_id='${id(98)}',auth_user_id=null,owner_user_id=null,owner_id=null,auth_id=null,created_by=null,created_by_user_id=null where id='${site}';`);
    const visibleDenied=read(owner,'correction-decisions','GET',403,{requestId:first.item.requestId});
    await decision().getByRole('button',{name:'重新核对／查原收据',exact:true}).click();
    assert.equal((await (await visibleDenied).json()).error,'attendance_access_denied');
    await decision().getByRole('status').filter({hasText:'当前账号不是此企业的有效负责人'}).waitFor();
    assert.equal(await decision().getByRole('region',{name:'补正审批决定',exact:true}).count(),0);
    assert.equal(await decision().getByRole('region',{name:'审批结果与当前工时',exact:true}).count(),0);
    assert.equal(await decision().locator('table').count(),0);assert.equal(await pending(owner,decisionKey),null);
    assert.deepEqual(decisions(),afterReject);assert.equal(writes('correction-decisions').length,rejectPosts);
    restoreOwner();ownerChanged=false;
    const visibleRestored=await click(owner,'correction-decisions',decision().getByRole('button',{name:'重新核对／查原收据',exact:true}));
    assert.equal(visibleRestored.decision.operationId,rejected.decision.operationId);assert.equal(writes('correction-decisions').length,rejectPosts);
    pass('previously visible rejected decision loses current ownership: GET403 clears displayed private decision/comparison/worktime; restoring exact owner bindings rereads the same decision with no new POST');
    const ownRejected=await selfRefresh(employee);assert.equal(ownRejected.item.decision.operationId,rejected.decision.operationId);
    assert.equal(ownRejected.item.decision.reason,rejected.decision.reason);assert.equal(ownRejected.canRequest,false);
    await correction(employee).getByRole('region',{name:'补正审批决定',exact:true}).getByText('已驳回 · 原申请保留',{exact:true}).waitFor();
    assert.equal(await correction(employee).getByRole('button',{name:'明确撤回申请',exact:true}).count(),0);assert.equal(effects().length,0);
    const firstEntry=entries()[0],rejection=decisions()[0];assert.deepEqual(events(),original);
    pass('current owner reviews exact request/evidence, explicitly rejects with reason; employee rereads the same immutable decision, cannot withdraw it, and rejection creates no effective worktime');

    const again=await click(employee,'corrections',correction(employee).getByRole('button',{name:'按当前规则重新准备申请',exact:true}));
    assert.equal(again.canRequest,true);await correction(employee).getByRole('button',{name:'移除这段声明休息',exact:true}).click();
    const second=await submit(employee,'合成验收：只移除本次声明休息，保留原始打卡',{lateReply:true});
    assert.notEqual(second.item.requestId,first.item.requestId);assert.equal(second.item.revision,2);assert.equal(second.proposal.breaks.length,0);
    assert.equal(second.rules.policy.revision,2);assert.equal(second.rules.policy.submissionWindowDays,8);
    assert.equal(second.proposal.startAt,first.proposal.startAt);assert.equal(second.proposal.endAt,first.proposal.endAt);
    assert.deepEqual(entries()[0],firstEntry);assert.deepEqual(decisions(),[rejection]);assert.deepEqual(events(),original);
    assert.equal(rows('merchant_attendance_correction_rule_bindings','request_id').length,2);
    pass('rejected employee uses current-rules reprepare and explicitly removes only proposed break; new UUID/revision2 preserves prior request, rejection and all four original facts');

    await ownerTarget(second.item.requestId);await decisionDraft('approve','合成验收：批准已核对声明，不改原始打卡');
    const beforeApprove=writes('correction-decisions').length;control.lose=endpoint('correction-decisions');
    await decision().getByRole('button',{name:'确认批准',exact:true}).click();
    await decision().getByRole('status').filter({hasText:'未能确认审批结果'}).waitFor();
    const raw=await pending(owner,decisionKey);assert(raw);const lost=JSON.parse(raw);assert.equal(control.lose,null);
    assert.equal(decisions().length,2);assert.equal(effects().length,1);assert.equal(versions().length,0);
    assert.equal(decisions()[1].operation_id,lost.command.operationId);assert.equal(writes('correction-decisions').at(-1).fault,'after-sql');
    const committed={entries:entries(),decisions:decisions(),effects:effects()},beforeRevoked=writes('correction-decisions').length;
    ownerChanged=true;exec(`update public.merchants set user_id='${id(98)}',auth_user_id=null,owner_user_id=null,owner_id=null,auth_id=null,created_by=null,created_by_user_id=null where id='${site}';`);
    const denied=read(owner,'correction-decisions','GET',403,{requestId:second.item.requestId,operationId:lost.command.operationId});
    await decision().getByRole('button',{name:'重新核对／查原收据',exact:true}).click();
    const deniedBody=await (await denied).json();assert.equal(deniedBody.error,'attendance_access_denied');assert.equal('review' in deniedBody,false);
    await decision().getByRole('status').filter({hasText:'当前账号不是此企业的有效负责人'}).waitFor();
    assert.equal(await decision().getByRole('region',{name:'补正审批决定',exact:true}).count(),0);
    assert.equal(await decision().getByRole('region',{name:'审批结果与当前工时',exact:true}).count(),0);
    assert.equal(await decision().getByRole('form',{name:'确认补正决定',exact:true}).count(),0);
    assert.equal(await pending(owner,decisionKey),raw);assert.equal(writes('correction-decisions').length,beforeRevoked);
    assert.deepEqual({entries:entries(),decisions:decisions(),effects:effects()},committed);assert.deepEqual(events(),original);
    restoreOwner();ownerChanged=false;
    pass('pending committed approval loses ALL owner bindings: actual receipt GET403 keeps private review/effect/form absent, preserves exact original pending bytes, and creates no POST or altered facts before ownership restoration');
    transport.state.moduleEnabled=false;await owner.reload();await owner.getByRole('button',{name:'企业管理',exact:true}).click();
    await owner.getByRole('button',{name:'考勤配置',exact:true}).click();await openReview();
    const recovered=await click(owner,'correction-decisions',review().getByRole('button',{name:'审批操作／恢复待确认',exact:true}));
    assert.equal(recovered.moduleEnabled,false);assert.equal(recovered.receipt.operationId,lost.command.operationId);
    assert.equal(recovered.replayed,true);assert.equal(recovered.effectiveChanged,false);assert.equal(recovered.writeEnabled,false);
    assert.equal(recovered.decision.action,'approve');assert.equal(recovered.current.requestId,second.item.requestId);
    const effect=effects()[0];assert.equal(effect.request_id,second.item.requestId);assert.equal(effect.operation_id,lost.command.operationId);
    assert.equal(effect.worker_id,worker.id);assert.equal(effect.start_event_id,original[0].id);assert.equal(effect.revision,1);
    assert.deepEqual(effect.proposal,second.proposal);assert.equal(effect.break_us,0);assert.equal(effect.paid_break_us,0);
    const expectedWorked=Number(exec(`select (extract(epoch from(max(occurred_at)-min(occurred_at)))*1000000)::bigint from public.merchant_attendance_events where worker_id='${worker.id}';`));
    assert(expectedWorked>0);assert.equal(effect.worked_us,expectedWorked);assert.equal(effect.elapsed_us,expectedWorked);
    assert.equal(recovered.current.workedUs,expectedWorked);assert.equal(recovered.decisionEffect.workedUs,expectedWorked);
    assert.equal(recovered.current.breakUs,0);assert.equal(recovered.current.paidBreakUs,0);
    await decision().getByRole('status').filter({hasText:'原审批已确认'}).waitFor();assert.equal(await pending(owner,decisionKey),null);
    assert.equal(writes('correction-decisions').length,beforeApprove+1);assert.equal(decisions().length,2);assert.equal(effects().length,1);
    assert(requests.some(r=>r.path===endpoint('correction-decisions')&&r.method==='GET'&&r.query.operationId===lost.command.operationId));
    assert.deepEqual(events(),original);assert.deepEqual(stable(),stableFacts);
    pass('approve reply lost AFTER current decide_v2 SQL commit recovers original receipt after full owner reload even while paused; GET only, exactly one effect, no repeated approval or rewritten punch');

    const approved=await selfRefresh(employee);assert.equal(approved.moduleEnabled,false);assert.equal(approved.item.decision.action,'approve');
    assert.equal(approved.item.decision.operationId,lost.command.operationId);assert.equal(approved.canRequest,false);
    await correction(employee).getByRole('region',{name:'补正审批决定',exact:true}).getByText('已批准 · 独立核定修订',{exact:true}).waitFor();
    assert.equal(await correction(employee).getByRole('button',{name:'明确撤回申请',exact:true}).count(),0);
    const list=await click(employee,'corrections',correction(employee).getByRole('button',{name:'我的申请',exact:true}));
    assert.equal(list.items.length,2);assert.equal(list.items.find(item=>item.requestId===first.item.requestId).decision.action,'reject');
    assert.equal(list.items.find(item=>item.requestId===second.item.requestId).decision.action,'approve');
    assert.deepEqual(entries()[0],firstEntry);assert.deepEqual(decisions()[0],rejection);assert.deepEqual(events(),original);assert.deepEqual(stable(),stableFacts);
    assert.equal(entries().length,2);assert.equal(effects().length,1);assert.equal(versions().length,0);
    assert.equal(writes('self').length,4);assert.equal(writes('corrections').length,3);assert.equal(writes('correction-decisions').length,4);
    assert.deepEqual(writes('corrections').map(r=>r.status),[null,200,200]);assert.deepEqual(writes('correction-decisions').map(r=>r.status),[409,200,409,200]);
    for(const [index,application] of [first,second].entries()){
      const stored=entries()[index],sent=writes('corrections').filter(r=>r.status===200)[index].body;
      assert.equal(stored.request_id,application.item.requestId);assert.equal(stored.operation_id,application.item.requestId);
      assert.equal(sent.operationId,application.item.requestId);assert.deepEqual(sent.proposal,application.proposal);
      assert.equal(stored.worker_id,worker.id);assert.equal(stored.start_event_id,original[0].id);
    }
    const currentCalls=transport.calls.filter(call=>call.name==='faolla_attendance_correction_decide_v2');
    assert.equal(currentCalls.filter(call=>call.command!==null).length,4);
    assert(currentCalls.some(call=>call.operationId===lost.command.operationId&&call.command===null&&call.allowWrite===false));
    assert.equal(transport.calls.filter(call=>call.name==='faolla_attendance_correction_self_v3'&&call.command!==null).length,2);
    assert(await employee.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    pass('paused390px employee shell independently rereads approval and both historical outcomes; approved/rejected are distinct, original entries/events/config/scopes remain intact and no automatic resubmission occurs');
    console.log(JSON.stringify({actualCorrectionFlowShell:true,currentDecisionV2:true,originalEvents:4,correctionEntries:2,ruleBindings:2,decisions:2,effects:1,followupEffectVersions:0,approvalRecoveryGetOnly:true,syntheticAuthOnly:true,productionWrites:0}));

    const {checkAttendanceRevisionFlowShell}=await import('./merchant-attendance-revision-flow-shell-checks.mjs');
    const revisionProof=await checkAttendanceRevisionFlowShell({owner,employee,admin,transport,requests,pass,site,actors,employeeId,worker,control,
      rows,events,entries,decisions,effects,versions,stable,stableFacts,original,rootRequestId:second.item.requestId,rootEffect:effect});
    const {checkAttendanceReportFlowShell}=await import('./merchant-attendance-report-flow-shell-checks.mjs');
    const reportProof=await checkAttendanceReportFlowShell({owner,employee,newPage,admin,exec,transport,requests,pass,origin,site,actors,id,worker,
      rows,events,entries,decisions,effects,versions,stable,downloads,csvRows,revisionProof,holdCorrectionResponse});
    return reportProof;

    async function correctionEntry(){
      const ready=read(employee,'corrections');await own(employee).getByRole('button',{name:'我的补正申请／核对结果',exact:true}).click();
      const value=await response(ready);assert.equal(value.mode,'list');assert.equal(value.items.length,0);await correction(employee).waitFor();
    }
  }finally{
    control.lose=null;control.unsent=null;control.acceptDialogs=true;transport.state.moduleEnabled=wasEnabled;
    await runAttendanceCleanupSteps([
      ...(ownerChanged?[{name:'correction-flow-owner-binding',run:restoreOwner}]:[]),
      ...(roleChanged?[{name:'correction-flow-role',run:()=>exec(`update public.merchant_enterprise_roles set permissions=array[${role.permissions.map(p=>`'${p.replaceAll("'","''")}'`).join(',')}],version=version+1 where merchant_id='${site}' and id='${role.id}';`)}]:[]),
      ...(employee?[{name:'correction-flow-employee-context',timeoutMs:10000,run:()=>employee.context().close()}]:[]),
    ]);
  }
}
