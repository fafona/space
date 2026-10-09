// Actual shell/SDK account switching; no synthetic business replies or injected pending commands.
// The caller owns the isolated handler/default-executor/SQL transport and cleanup.
import assert from 'node:assert/strict';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const keys=value=>Object.keys(value).sort();
const sentinel='qa-unrelated-leave-account-switch';
const instant=value=>{
  const match=/^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d{1,6}))?(Z|[+-]\d\d:\d\d)$/.exec(value);
  assert(match,'leave_switch_invalid_timestamp');
  const milliseconds=Date.parse(match[1]+match[3]);assert(Number.isFinite(milliseconds),'leave_switch_invalid_timestamp');
  return BigInt(milliseconds)*1000n+BigInt((match[2]??'').padEnd(6,'0'));
};

export function assertLeaveAccountSwitchPending(raw,expected){
  assert(typeof raw==='string'&&raw.length>0&&raw.length<=(expected.kind==='leave'?8192:2048),'leave_switch_pending_required');
  const value=JSON.parse(raw);assert(value&&typeof value==='object'&&!Array.isArray(value),'leave_switch_pending_object');
  assert.equal(value.siteId,expected.site);assert.equal(value.actorId,expected.actorId);assert.equal(value.employeeId,expected.employeeId);
  assert.notEqual(value.actorId,value.employeeId,'leave_switch_auth_is_not_employee');
  if(expected.kind==='leave'){
    assert.deepEqual(keys(value),['access','actorId','command','employeeId','siteId']);assert.equal(value.access,'self');
    const command=value.command;
    assert.deepEqual(keys(command),['action','endAt','expectedSettingsVersion','expectedWorkerId','operationId','reason','startAt','timeZone']);
    assert.equal(command.action,'submit');assert.match(command.operationId,uuid);assert.equal(command.expectedWorkerId,expected.workerId);
    assert.equal(command.expectedSettingsVersion,expected.settingsVersion);assert.equal(command.timeZone,expected.timeZone);
    assert.equal(command.startAt,expected.startAt);assert.equal(command.endAt,expected.endAt);assert.equal(command.reason,expected.reason);
    return command;
  }
  assert.equal(expected.kind,'notice');assert.deepEqual(keys(value),['actorId','employeeId','notificationId','siteId','workerId']);
  assert.equal(value.workerId,expected.workerId);assert.equal(value.notificationId,expected.notificationId);assert.match(value.notificationId,uuid);
  return value;
}

export function assertLeaveAccountSwitchIsolation({before,after,bodyText,requests,otherActorId,otherEmployeeId,otherWorkerId,forbidden,leavePath,noticePath}){
  // Raw strings deliberately stay raw: equivalent reserialization must not pass.
  assert.deepEqual(after,before,'leave_switch_pending_bytes_changed');
  assert.equal(typeof bodyText,'string');
  const nonempty=forbidden.filter(value=>typeof value==='string'&&value.length>0);
  assert(nonempty.length>=2,'leave_switch_isolation_witnesses_required');
  for(const value of nonempty)assert(!bodyText.includes(value),'leave_switch_foreign_dom');
  const reads=requests.filter(row=>[leavePath,noticePath].includes(row.path));
  assert(reads.length>0,'leave_switch_other_actor_reads_required');
  for(const row of reads){
    assert.equal(row.actorId,otherActorId,'leave_switch_old_actor_request_after_login');assert.equal(row.method,'GET','leave_switch_other_actor_write');
    assert.equal(row.status,200,'leave_switch_other_actor_read_failed');
    for(const key of ['operationId','requestId','notificationId'])assert(!nonempty.includes(row[key]),'leave_switch_foreign_query');
    if(row.path===noticePath){
      assert.equal(row.expectedEmployeeId,otherEmployeeId,'leave_switch_other_employee_query');
      assert(row.expectedWorkerId===null||row.expectedWorkerId===otherWorkerId,'leave_switch_other_worker_query');
    }
  }
}

export function assertLeaveAccountSwitchEvidence({facts,commits,writes,site,employeeId,workerId,authUserId,ownerId,leavePath,noticePath,submissionId,approvalId,marked}){
  assert(!marked||approvalId,'leave_switch_mark_requires_approval');
  const expected=approvalId?(marked?3:2):1;
  assert.equal(commits.length,expected,'leave_switch_commit_count');assert.equal(writes.length,expected,'leave_switch_write_count');
  assert.equal(facts.requests.length,1);assert.equal(facts.entries.length,approvalId?2:1);
  assert.equal(facts.notifications.length,approvalId?1:0);assert.equal(facts.reads.length,marked?1:0);
  const request=facts.requests[0];
  assert.equal(request.request_id,submissionId);assert.equal(request.merchant_id,site);assert.equal(request.actor_auth_user_id,authUserId);
  assert.equal(request.employee_id,employeeId);assert.equal(request.worker_id,workerId);
  for(const [index,commit] of commits.entries()){
    const expectedActor=index===1?ownerId:authUserId,expectedPath=index===2?noticePath:leavePath,action=['submit','approve','mark_read'][index];
    const record=writes[index];assert.equal(commit.actorId,expectedActor);assert.equal(record.actorId,expectedActor);
    assert.equal(record.actor,index===1?'owner':'employee');assert.equal(commit.path,expectedPath);assert.equal(record.path,expectedPath);
    assert.equal(record.status,200);assert.equal(record.method,'POST');assert.equal(record.action,action);
    assert.equal(commit.body.ok,true);assert.equal(commit.body.actorId,expectedActor);assert.equal(commit.body.siteId,site);
    assert.equal(commit.input.command.action,action);
    if(index<2){
      const operationId=index===0?submissionId:approvalId,entry=facts.entries[index],receipt=commit.body.receipt;
      assert.match(operationId,uuid);assert.equal(record.operationId,operationId);assert.equal(entry.operation_id,operationId);
      assert.equal(entry.request_id,submissionId);assert.equal(entry.merchant_id,site);assert.equal(entry.actor_auth_user_id,expectedActor);
      assert.equal(entry.action,action);assert.equal(entry.revision,index+1);
      assert.deepEqual(commit.input.command,entry.command);assert.deepEqual(receipt.command,entry.command);assert.deepEqual(receipt.item,entry.snapshot);
      assert.equal(receipt.requestId,submissionId);assert.equal(receipt.revision,index+1);
      assert.equal(receipt.item.requestId,submissionId);assert.equal(receipt.item.revision,index+1);assert.equal(receipt.item.status,index===0?'submitted':'approved');
      assert.equal(instant(receipt.item.submittedAt),instant(request.submitted_at));
      assert.equal(instant(receipt.item.startAt),instant(request.start_at));assert.equal(instant(receipt.item.endAt),instant(request.end_at));
      assert.equal(receipt.item.timeZone,request.time_zone);assert.equal(commit.input.query.access,index===0?'self':'owner');
      if(index===0){
        assert.equal(commit.body.employeeId,employeeId);assert.equal(commit.body.workerId,workerId);
        assert.equal(entry.command.expectedWorkerId,workerId);assert.equal(entry.command.reason,request.reason);
        assert.equal(instant(entry.recorded_at),instant(request.submitted_at));
      }else{
        assert.equal(entry.command.requestId,submissionId);assert.equal(entry.command.expectedRevision,1);
        assert.equal(commit.input.query.requestId,submissionId);assert.notEqual(approvalId,submissionId);
      }
    }else{
      assert.equal(record.notificationId,approvalId);assert.equal(commit.input.command.notificationId,approvalId);
      assert.equal(commit.input.query.expectedEmployeeId,employeeId);assert.equal(commit.input.query.expectedWorkerId,workerId);
      assert.equal(commit.input.query.notificationId,approvalId);assert.equal(commit.body.employeeId,employeeId);assert.equal(commit.body.workerId,workerId);
      assert.equal(commit.body.detail.notificationId,approvalId);assert.equal(commit.body.detail.requestId,submissionId);
      assert.equal(instant(commit.body.detail.readAt),instant(facts.reads[0].read_at));
    }
  }
  if(approvalId){
    const notification=facts.notifications[0];assert.equal(notification.request_id,submissionId);assert.equal(notification.action,'approve');assert.equal(notification.revision,2);
    assert.equal(instant(notification.decided_at),instant(facts.entries[1].recorded_at));
    for(const row of [notification,...facts.reads]){
      assert.equal(row.merchant_id,site);assert.equal(row.notification_id,approvalId);assert.equal(row.employee_id,employeeId);
      assert.equal(row.worker_id,workerId);assert.equal(row.recipient_auth_user_id,authUserId);
    }
  }
}

export async function checkAttendanceLeaveAccountSwitch(c){
  const {owner,phone,data,databaseActors,origin,site,prefix,leavePath,noticePath,requests,commits,transport,errors,external,
    facts,counts,safe,native,holdResponse,confirmClick,dialogStates,setPhase,assertLeaveShellFacts}=c;
  const members={a:{actorId:data.employeeAuth,employeeId:data.employeeId,workerId:data.workerId},
    b:{actorId:data.otherAuth,employeeId:id(102),workerId:id(202)}};
  const reason='第138批同页换号原申请只属于员工甲',decisionReason='第138批负责人明确批准原申请';
  const self=()=>phone.getByRole('region',{name:'我的考勤',exact:true});
  const leave=()=>self().getByRole('region',{name:'我的请假申请',exact:true});
  const notice=()=>self().getByRole('region',{name:'请假结果通知',exact:true});
  const detail=()=>notice().getByRole('article',{name:'请假结果通知详情',exact:true});
  const admin=()=>owner.getByRole('region',{name:'考勤配置管理',exact:true});
  const ownerLeave=()=>admin().getByRole('region',{name:'请假申请审批',exact:true});
  const nav=()=>phone.getByRole('navigation',{name:'企业管理功能',exact:true});
  const writes=()=>requests.filter(row=>row.path.startsWith(prefix)&&row.method==='POST');
  const leaveKey=member=>`faolla:attendance:leave:v1:${site}:self:${members[member].employeeId}`;
  const noticeKey=member=>`faolla:attendance:leave-notifications:v1:${site}:${members[member].employeeId}`;
  const slots=()=>phone.evaluate(storageKeys=>Object.fromEntries(Object.entries(storageKeys).map(([key,value])=>[key,sessionStorage.getItem(value)])),
    {leaveA:leaveKey('a'),leaveB:leaveKey('b'),noticeA:noticeKey('a'),noticeB:noticeKey('b')});
  const read=(page,path,query={})=>{
    const waiting=page.waitForResponse(reply=>{
      const url=new URL(reply.url());return url.origin===origin&&url.pathname===path&&reply.request().method()==='GET'
        &&Object.entries(query).every(([key,value])=>url.searchParams.get(key)===value);
    }).then(async reply=>{assert.equal(reply.status(),200,'leave_switch_read_status');return reply.json();});
    void waiting.catch(()=>{});return waiting;
  };
  const settle=()=>phone.evaluate(()=>new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>reject(Error('leave_switch_render_timeout')),5000);
    requestAnimationFrame(()=>requestAnimationFrame(()=>{clearTimeout(timeout);resolve();}));
  }));
  const gates=new Set();
  const hold=spec=>{const gate=holdResponse(spec);gates.add(gate);return gate;};
  const release=async gate=>{await gate.release();gates.delete(gate);await settle();};
  const reveal=async button=>{
    if(!await button.isVisible())await phone.getByRole('button',{name:'打开员工工作区导航',exact:true}).click();
    await button.waitFor({state:'visible'});
  };
  const enterSelf=async member=>{
    await nav().waitFor({state:'attached'});const done=read(phone,prefix+'self');
    const button=nav().getByRole('button',{name:'我的考勤',exact:true});await reveal(button);await button.click();
    const result=await done;assert.equal(result.workerId,members[member].workerId);
    await self().getByText((member==='a'?'合成请假员工甲':'合成请假员工乙')+' · 仅记录本人打卡',{exact:true}).waitFor();
    await self().getByRole('button',{name:'我的请假申请',exact:true}).waitFor();
    assert.equal(await leave().count(),0);assert.equal(await notice().count(),0);
  };
  let documentTimeOrigin,submissionId,approvalId,checkpoints=0;
  const sameDocument=async()=>{
    assert.equal(await phone.evaluate(()=>performance.timeOrigin),documentTimeOrigin,'leave_switch_document_reloaded');
    assert.equal(new URL(phone.url()).pathname,'/enterprise/'+site);
    assert.equal(await phone.evaluate(key=>sessionStorage.getItem(key),sentinel),'preserve','leave_switch_unrelated_storage_changed');
  };
  const logout=async()=>{
    const button=phone.getByRole('button',{name:'退出员工登录',exact:true});await reveal(button);
    const done=phone.waitForResponse(reply=>new URL(reply.url()).pathname==='/auth/v1/logout'&&reply.request().method()==='POST');void done.catch(()=>{});
    await button.click();await phone.getByLabel('员工邮箱',{exact:true}).waitFor();assert.equal((await done).status(),204);
    await phone.getByRole('button',{name:'登录企业工作台',exact:true}).waitFor();
    assert.equal(await self().count(),0);assert.equal(await leave().count(),0);assert.equal(await notice().count(),0);await sameDocument();
  };
  const login=async member=>{
    const actor=databaseActors.find(item=>item.id===members[member].actorId);assert(actor);
    await phone.getByLabel('员工邮箱',{exact:true}).fill(actor.email);await phone.getByLabel('密码',{exact:true}).fill('Synthetic-attendance-only!');
    await phone.getByRole('button',{name:'登录企业工作台',exact:true}).click();await nav().waitFor({state:'attached'});await sameDocument();
    const before=requests.filter(row=>[leavePath,noticePath].includes(row.path)).length;
    await enterSelf(member);assert.equal(requests.filter(row=>[leavePath,noticePath].includes(row.path)).length,before,'leave_switch_closed_launcher_read');
  };
  const assertIdentity=(result,member)=>{
    assert.equal(result.ok,true);assert.equal(result.siteId,site);assert.equal(result.actorId,members[member].actorId);
    assert.equal(result.employeeId,members[member].employeeId);assert.equal(result.workerId,members[member].workerId);
  };
  const openLeave=async(member,operationId=null)=>{
    const done=read(phone,leavePath,{operationId});await self().getByRole('button',{name:'我的请假申请',exact:true}).click();
    const result=await done;assertIdentity(result,member);return result;
  };
  const openNotice=async(member,notificationId=null)=>{
    const done=read(phone,noticePath,{notificationId});await self().getByRole('button',{name:'请假结果通知',exact:true}).click();
    const result=await done;assertIdentity(result,member);return result;
  };
  const emptyLeave=async()=>leave().getByText('本页没有请假申请，不代表没有排班、出勤或假期余额。',{exact:true}).waitFor();
  const emptyNotice=async()=>notice().getByText('本页没有请假结果通知；这不代表没有请假申请或更早处理历史。',{exact:true}).waitFor();
  const verify=marked=>{
    const current=facts();
    const proof={employeeId:data.employeeId,workerId:data.workerId,authUserId:data.employeeAuth,ownerId:data.owner,submissionId,approvalId,marked};
    assertLeaveShellFacts(current,proof);assertLeaveAccountSwitchEvidence({facts:current,commits,writes:writes(),site,leavePath,noticePath,...proof});safe();return current;
  };
  const isolated=async(before,begin)=>{
    assertLeaveAccountSwitchIsolation({before,after:await slots(),bodyText:await phone.locator('body').textContent(),
      requests:requests.slice(begin),otherActorId:members.b.actorId,otherEmployeeId:members.b.employeeId,otherWorkerId:members.b.workerId,
      forbidden:[reason,decisionReason,submissionId,approvalId,'合成请假员工甲',members.a.employeeId,members.a.workerId],leavePath,noticePath});
    assert.equal(await detail().count(),0);await sameDocument();safe();
  };
  const pass=message=>{checkpoints++;native.pass(message);};
  try{
    setPhase('leave-account-switch-entry');
    assert.deepEqual(counts(),{requests:0,entries:0,notifications:0,reads:0});assert.equal(writes().length,0);
    await owner.goto(origin+'/'+site);await owner.evaluate(key=>sessionStorage.setItem(key,'preserve'),sentinel);
    await owner.getByRole('button',{name:'企业管理',exact:true}).click();await owner.getByRole('button',{name:'考勤配置',exact:true}).click();
    await admin().getByRole('button',{name:'请假申请审批',exact:true}).waitFor();
    await phone.goto(origin+'/enterprise');await phone.evaluate(key=>sessionStorage.setItem(key,'preserve'),sentinel);
    const actor=databaseActors.find(item=>item.id===members.a.actorId);assert(actor);
    await phone.getByLabel('员工邮箱',{exact:true}).fill(actor.email);await phone.getByLabel('密码',{exact:true}).fill('Synthetic-attendance-only!');
    await phone.getByRole('button',{name:'登录并选择企业',exact:true}).click();
    await phone.locator('article').filter({hasText:`企业编号 ${site}`}).getByRole('button',{name:'进入工作台',exact:true}).click();
    await enterSelf('a');documentTimeOrigin=await phone.evaluate(()=>performance.timeOrigin);
    await sameDocument();assert.deepEqual(await slots(),{leaveA:null,leaveB:null,noticeA:null,noticeB:null});
    assert.equal(requests.filter(row=>[leavePath,noticePath].includes(row.path)).length,0);safe();
    pass('actual AdminClient and employee SDK selector/Portal reach attendance; closed leave/notification launchers perform zero business reads and scoped pending starts empty');

    setPhase('leave-account-switch-held-submit');
    const initial=await openLeave('a');assert.deepEqual(initial.items,[]);assert.equal(initial.receipt,null);await emptyLeave();
    await leave().getByLabel('请假开始时间',{exact:true}).fill(data.time.startAt.slice(0,16));
    await leave().getByLabel('请假结束时间',{exact:true}).fill(data.time.endAt.slice(0,16));
    await leave().getByRole('button',{name:'生成请假预览',exact:true}).click();await leave().getByRole('region',{name:'请假时段预览',exact:true}).waitFor();
    await leave().getByLabel(/^请假理由/).fill(reason);await leave().getByRole('checkbox',{name:/我已核对申请人、企业时区、两端 UTC 时差/}).check();
    const submitGate=hold({actorId:members.a.actorId,path:leavePath,method:'POST'});
    await confirmClick(phone,leave().getByRole('button',{name:'明确提交请假申请',exact:true}),'submit');const submitted=await submitGate.ready();
    const pendingSubmit=await slots(),command=assertLeaveAccountSwitchPending(pendingSubmit.leaveA,{kind:'leave',site,...members.a,
      settingsVersion:initial.settingsVersion,timeZone:initial.timeZone,...data.time,reason});
    submissionId=command.operationId;assert.deepEqual(commits[0].input.command,command);assert.deepEqual(commits[0].body,submitted);
    const submittedFacts=verify(false);assert.equal(await leave().getByRole('region',{name:'请假操作收据',exact:true}).count(),0);
    await logout();assert.deepEqual(await slots(),pendingSubmit);const firstB=requests.length;await login('b');
    const bLeave=await openLeave('b');assert.deepEqual(bLeave.items,[]);assert.equal(bLeave.receipt,null);assert.equal(bLeave.detail,null);await emptyLeave();
    const bNotice=await openNotice('b');assert.deepEqual(bNotice.items,[]);assert.equal(bNotice.detail,null);await emptyNotice();
    await isolated(pendingSubmit,firstB);await release(submitGate);await emptyLeave();await emptyNotice();await isolated(pendingSubmit,firstB);
    assert.deepEqual(facts(),submittedFacts);verify(false);
    pass('A explicit submission commits once before response hold; same-document SDK logout/login B reads only own empty leave/notices and late A POST cannot restore A content, query A operation or erase original pending bytes');

    setPhase('leave-account-switch-original-submit-get');
    await logout();await login('a');assert.deepEqual(await slots(),pendingSubmit);
    const recovered=await openLeave('a',submissionId);await leave().getByRole('region',{name:'请假操作收据',exact:true}).waitFor();
    assert.deepEqual(recovered.receipt,submitted.receipt);assert.deepEqual(await slots(),{leaveA:null,leaveB:null,noticeA:null,noticeB:null});
    assert.deepEqual(facts(),submittedFacts);verify(false);
    pass('returning A recovers the exact original request receipt through GET only, clears only A leave pending and preserves the immutable SQL submission without a second POST');

    setPhase('leave-account-switch-owner-approval');
    await admin().getByRole('button',{name:'请假申请审批',exact:true}).click();await ownerLeave().getByRole('button',{name:'查看申请详情',exact:true}).click();
    const ownerDetail=ownerLeave().getByRole('article',{name:'请假申请详情',exact:true});await ownerDetail.getByRole('heading',{name:/待审批/}).waitFor();
    assert((await ownerDetail.textContent()).includes(submissionId));assert((await ownerDetail.textContent()).includes(reason));
    await ownerLeave().getByLabel(/^决定理由/).fill(decisionReason);await ownerLeave().getByRole('checkbox',{name:/我已核对申请人、时段、时区、当前状态/}).check();
    const approvalReply=owner.waitForResponse(reply=>new URL(reply.url()).pathname===leavePath&&reply.request().method()==='POST');void approvalReply.catch(()=>{});
    await confirmClick(owner,ownerLeave().getByRole('button',{name:'明确批准请假申请',exact:true}),'approve');
    const approvalResponse=await approvalReply;assert.equal(approvalResponse.status(),200);const approved=await approvalResponse.json();approvalId=approved.receipt.command.operationId;
    await ownerDetail.getByRole('heading',{name:/已批准/}).waitFor();const approvedFacts=verify(false);
    assert.deepEqual(approvedFacts.requests,submittedFacts.requests);assert.deepEqual(approvedFacts.entries[0],submittedFacts.entries[0]);
    pass('actual owner opens A original detail and explicitly approves once through125, adding one decision and captured A-recipient notification while preserving the original request/entry');

    setPhase('leave-account-switch-late-notice-detail');
    const notificationList=await openNotice('a');assert.deepEqual(notificationList.items.map(item=>item.notificationId),[approvalId]);assert.equal(notificationList.items[0].readAt,null);
    const card=()=>notice().getByRole('article',{name:'请假结果通知 已批准',exact:true});await card().getByText('未读',{exact:true}).waitFor();
    const detailGate=hold({actorId:members.a.actorId,path:noticePath,method:'GET'});
    await card().getByRole('button',{name:'查看结果详情',exact:true}).click();const heldDetail=await detailGate.ready();
    assertIdentity(heldDetail,'a');assert.equal(heldDetail.detail.notificationId,approvalId);assert.equal(heldDetail.detail.requestId,submissionId);assert.equal(heldDetail.detail.readAt,null);
    await logout();const secondB=requests.length;await login('b');const bList=await openNotice('b');assert.deepEqual(bList.items,[]);assert.equal(bList.detail,null);await emptyNotice();
    const noPending={leaveA:null,leaveB:null,noticeA:null,noticeB:null};await isolated(noPending,secondB);
    await release(detailGate);await emptyNotice();await isolated(noPending,secondB);assert.deepEqual(facts(),approvedFacts);verify(false);
    pass('A notification detail GET is held after real SQL; B own empty notification page remains empty after release, with no A request/notification/reason leak and no automatic read marker');

    setPhase('leave-account-switch-held-mark-read');
    await logout();await login('a');await openNotice('a');await card().getByRole('button',{name:'查看结果详情',exact:true}).click();
    await detail().getByText(/当前仍为已批准 · 当前修订 2/).waitFor();assert.deepEqual(facts(),approvedFacts);verify(false);
    const markGate=hold({actorId:members.a.actorId,path:noticePath,method:'POST'});
    await confirmClick(phone,detail().getByRole('button',{name:'明确标记已读',exact:true}),'read');const marked=await markGate.ready();
    const pendingRead=await slots();assertLeaveAccountSwitchPending(pendingRead.noticeA,{kind:'notice',site,...members.a,notificationId:approvalId});
    assert.equal(pendingRead.leaveA,null);assert.equal(pendingRead.leaveB,null);assert.equal(pendingRead.noticeB,null);
    const markedFacts=verify(true);assert.deepEqual({...markedFacts,reads:approvedFacts.reads},approvedFacts);
    assert.equal(marked.detail.notificationId,approvalId);assert.equal(instant(marked.detail.readAt),instant(markedFacts.reads[0].read_at));
    pass('only A separate explicit confirmation sends the third business POST; successful held mark-read creates one exact original-recipient SQL marker while A notification pending stays unresolved');

    setPhase('leave-account-switch-late-mark-aba');
    await logout();assert.deepEqual(await slots(),pendingRead);const thirdB=requests.length;await login('b');
    const bLast=await openNotice('b');assert.deepEqual(bLast.items,[]);assert.equal(bLast.detail,null);await emptyNotice();await isolated(pendingRead,thirdB);
    assert.deepEqual(facts(),markedFacts);verify(true);
    await logout();await login('a');assert.deepEqual(await slots(),pendingRead);
    const beforeRecovery=requests.length,recoveryGate=hold({actorId:members.a.actorId,path:noticePath,method:'GET'});
    await self().getByRole('button',{name:'请假结果通知',exact:true}).click();const originalRead=await recoveryGate.ready();
    assertIdentity(originalRead,'a');assert.equal(originalRead.detail.notificationId,approvalId);assert.deepEqual(originalRead.detail,marked.detail);
    const recoveryQueries=requests.slice(beforeRecovery).filter(row=>row.actorId===members.a.actorId&&row.path===noticePath&&row.method==='GET'&&row.notificationId===approvalId);
    assert.equal(recoveryQueries.length,1);const recoveryQuery=recoveryQueries[0];
    assert.equal(recoveryQuery.expectedEmployeeId,members.a.employeeId);assert.equal(recoveryQuery.expectedWorkerId,members.a.workerId);
    assert.equal(recoveryQuery.method,'GET');assert.equal(recoveryQuery.path,noticePath);
    await release(markGate);assert.deepEqual(await slots(),pendingRead,'leave_switch_aba_old_post_cleared_new_pending');
    assert.equal(await detail().count(),0,'leave_switch_aba_old_post_filled_new_instance');assert.deepEqual(facts(),markedFacts);verify(true);await sameDocument();
    pass('B cannot inherit A unresolved read intent; returning A holds a fresh original-notification GET, and releasing the obsolete A POST across A→B→A cannot clear pending or populate the new instance');

    setPhase('leave-account-switch-original-read-get');
    await release(recoveryGate);await detail().getByRole('button',{name:'这条通知已读',exact:true}).waitFor();
    assert.deepEqual(await slots(),noPending);assert.deepEqual(facts(),markedFacts);verify(true);
    assert.deepEqual(writes().map(row=>[row.actorId,row.path,row.action]),[[members.a.actorId,leavePath,'submit'],[data.owner,leavePath,'approve'],[members.a.actorId,noticePath,'mark_read']]);
    assert.deepEqual(transport.calls.filter(row=>row.action).map(row=>[row.name,row.action]),[['faolla_attendance_leave_v1','submit'],['faolla_attendance_leave_notify_v1','approve'],['faolla_attendance_leave_notifications_v1','mark_read']]);
    assert.deepEqual(counts(),{requests:1,entries:2,notifications:1,reads:1});
    assert.equal(dialogStates.get(owner).accepted,1);assert.equal(dialogStates.get(phone).accepted,2);
    for(const page of [owner,phone]){
      assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),sentinel),'preserve');
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'leave_switch_horizontal_overflow');
    }
    await sameDocument();assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert.deepEqual(transport.errors,[]);safe();
    pass('only the fresh original-notification GET restores A exact read timestamp and clears pending; final SQL counts are1/2/1/1, all protected facts and unrelated storage are unchanged, and no fourth business POST occurs');
    return {checkpoints,actualAdminClient:true,actualEmployeeSelector:true,actualPortal:true,actualSdkLogoutLogin:true,
      sameDocumentAccountSwitch:true,lateSubmitIsolation:true,lateNotificationDetailIsolation:true,lateMarkReadAbaIsolation:true,
      originalSubmissionGetRecovery:true,originalReadGetRecovery:true,attendancePosts:3,counts:counts(),protectedFactsUnchanged:true,externalRequests:0};
  }finally{
    // Release local browser gates on failure too; caller closes contexts and waits routed work.
    await Promise.allSettled([...gates].map(gate=>gate.release()));
  }
}
