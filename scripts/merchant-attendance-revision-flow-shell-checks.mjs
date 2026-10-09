// Continuation of the real enterprise-shell correction chain. Reuses its
// synthetic employee, owner, four punches and immutable initial approval.
// No modelled business responses, direct business writes or extra services.
import assert from 'node:assert/strict';
import {fillLocalMilliseconds} from './merchant-attendance-correction-time-shell-checks.mjs';

export async function checkAttendanceRevisionFlowShell({owner,employee,admin,transport,requests,pass,site,actors,employeeId,worker,control,
  rows,events,entries,decisions,effects,versions,stable,stableFacts,original,rootRequestId,rootEffect}) {
  const endpoint=name=>'/api/merchant-enterprise/attendance/'+name;
  const writes=name=>requests.filter(r=>r.path===endpoint(name)&&r.method==='POST');
  const read=(page,name,method='GET',query={})=>page.waitForResponse(r=>{
    const url=new URL(r.url());return url.pathname===endpoint(name)&&r.request().method()===method&&r.status()===200
      &&Object.entries(query).every(([key,value])=>url.searchParams.get(key)===value);
  });
  const response=async promise=>{const value=await (await promise).json();assert.equal(value.ok,true);return value;};
  const click=async(page,name,button,method='GET',query={})=>{const ready=read(page,name,method,query);await button.click();return response(ready);};
  const self=()=>employee.getByRole('region',{name:'本人连续修订',exact:true});
  const approval=()=>owner.getByRole('region',{name:'负责人连续修订审批',exact:true});
  const history=(page,access)=>page.getByRole('region',{name:access==='owner'?'负责人修订待办与历史':'本人班次修订历史',exact:true});
  const revisions=()=>rows('merchant_attendance_revision_requests','revision');
  const revisionDecisions=()=>rows('merchant_attendance_revision_decisions','recorded_at,operation_id');
  const initial={entries:entries(),decisions:decisions(),effects:effects()};
  const immutable=()=>{assert.deepEqual({entries:entries(),decisions:decisions(),effects:effects()},initial);assert.deepEqual(events(),original);assert.deepEqual(stable(),stableFacts);};
  const selfRefresh=()=>click(employee,'revision-requests',self().getByRole('button',{name:'重新读取／查原收据',exact:true}));
  const ownerList=()=>click(owner,'revision-history',approval().getByRole('button',{name:'修订待办／已处理记录',exact:true}),'GET',{access:'owner'});
  const ownerTarget=async(requestId,list)=>{
    assert(list.items.some(item=>item.requestId===requestId&&item.status==='submitted'));
    const value=await click(owner,'revision-decisions',history(owner,'owner').getByRole('listitem').filter({hasText:requestId}).getByRole('button',{name:'查看修订详情',exact:true}),'GET',{requestId});
    assert.equal(value.requestId,requestId);assert.equal(value.decision,null);assert.equal(value.canApprove,true);assert.equal(value.canReject,true);
    await approval().getByRole('form',{name:'确认修订审批',exact:true}).waitFor();
    assert.equal(await approval().getByRole('combobox',{name:'修订审批决定',exact:true}).inputValue(),'');return value;
  };
  const draftDecision=async(action,reason)=>{
    const form=approval().getByRole('form',{name:'确认修订审批',exact:true});
    await form.getByRole('combobox',{name:'修订审批决定',exact:true}).selectOption(action);
    await form.getByRole('textbox',{name:/^修订审批理由/}).fill(reason);
    await form.getByRole('checkbox',{name:/^我已核对员工/}).check();
  };
  const storedInstant=value=>{
    const m=/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);assert(m,'unexpected synthetic SQL timestamp: '+value);
    const fraction=(m[2]??'').padEnd(6,'0');
    return new Date(m[1]+'.'+fraction.slice(0,3)+m[3]).toISOString().slice(0,23)+fraction.slice(3)+'Z';
  };
  const submit=async(reason,source={proposal:rootEffect.proposal,operationId:rootEffect.operation_id,revision:1})=>{
    const form=self().getByRole('form',{name:'提交再次修订',exact:true});await form.waitFor();
    assert.equal(await form.getByRole('button',{name:/^增加休息/}).innerText(),'增加休息（0/32）');
    assert(await form.getByRole('button',{name:'明确提交修订申请',exact:true}).isDisabled());
    const count=writes('revision-requests').length;
    await form.getByRole('textbox',{name:/^修订理由/}).fill(reason);
    await form.getByRole('checkbox',{name:/^我已核对全部时间/}).check();
    assert(await form.getByRole('button',{name:'明确提交修订申请',exact:true}).isDisabled());
    assert.equal(writes('revision-requests').length,count);
    const local=await form.getByLabel('修订上班时间',{exact:true}).inputValue();
    const earlier=new Date(Date.parse(local+'Z')-1).toISOString().slice(0,-1);
    await fillLocalMilliseconds(form.getByLabel('修订上班时间',{exact:true}),earlier);
    assert.equal(await form.getByRole('checkbox',{name:/^我已核对全部时间/}).isChecked(),false);
    await form.getByRole('textbox',{name:/^修订理由/}).fill(reason);
    await form.getByRole('checkbox',{name:/^我已核对全部时间/}).check();
    const value=await click(employee,'revision-requests',form.getByRole('button',{name:'明确提交修订申请',exact:true}),'POST');
    assert.equal(value.item.status,'submitted');assert.equal(value.rootRequestId,rootRequestId);assert.equal(value.employeeId,employeeId);assert.equal(value.workerId,worker.id);
    assert.equal(value.item.basedOn.operationId,source.operationId);assert.equal(value.current.revision,source.revision);assert.equal(value.effectiveChanged,false);
    assert.equal(value.item.proposal.startAt,new Date(Date.parse(source.proposal.startAt)-1).toISOString().replace(/Z$/,'000Z'));
    assert.equal(value.item.proposal.endAt,source.proposal.endAt);assert.deepEqual(value.item.proposal.breaks,[]);
    const sent=writes('revision-requests').at(-1).body;
    assert.equal(sent.baseRequestId,rootRequestId);assert.equal(sent.expectedWorkerId,worker.id);
    assert.equal(sent.command.operationId,value.item.requestId);assert.equal(sent.command.expectedBaseOperationId,rootEffect.operation_id);
    assert.equal(sent.command.expectedEffectiveOperationId,source.operationId);assert.deepEqual(sent.command.proposal,value.item.proposal);
    await self().getByRole('heading',{name:'本次修订 · 待负责人审批',exact:true}).waitFor();immutable();return value;
  };

  assert.equal(transport.state.moduleEnabled,false);assert.equal(versions().length,0);assert.equal(revisions().length,0);
  const correction=employee.getByRole('region',{name:'本人考勤补正申请',exact:true});
  await click(employee,'corrections',correction.locator('article').filter({hasText:rootRequestId}).getByRole('button',{name:'查看差异／撤回',exact:true}));
  const paused=await click(employee,'revision-requests',correction.getByRole('button',{name:'查看当前核定／申请再次修订',exact:true}));
  assert.equal(paused.moduleEnabled,false);assert.equal(paused.current.requestId,rootRequestId);assert.equal(paused.current.revision,1);
  await self().getByText('当前状态、权限或申请规则不允许新建修订；没有创建申请。',{exact:true}).waitFor();
  assert.equal(await self().getByRole('form',{name:'提交再次修订',exact:true}).count(),0);
  transport.state.moduleEnabled=true;
  const prepared=await selfRefresh();assert.equal(prepared.canSubmit,true);assert.equal(prepared.current.breakUs,0);assert.equal(prepared.basis.events.length,4);
  await self().getByRole('form',{name:'提交再次修订',exact:true}).waitFor();assert.equal(writes('revision-requests').length,0);immutable();
  pass('real employee approved-root entry is read-only while paused; re-enabled prepare uses current initial approval, not raw break facts, and creates no revision by opening it');

  const first=await submit('合成连续修订：上班声明提前一毫秒，请负责人核对');
  assert.equal(revisions().length,1);assert.equal(revisionDecisions().length,0);assert.equal(versions().length,0);
  await owner.getByRole('region',{name:'负责人补正审批',exact:true}).getByRole('button',{name:'返回核对列表',exact:true}).click();
  await owner.getByRole('region',{name:'负责人补正申请核对',exact:true}).getByRole('button',{name:'返回考勤管理',exact:true}).click();
  const listed=await click(owner,'revision-history',admin(owner).getByRole('button',{name:'连续修订审批／恢复',exact:true}),'GET',{access:'owner'});
  const firstReview=await ownerTarget(first.item.requestId,listed);assert.equal(firstReview.review.base.operationId,rootEffect.operation_id);
  assert.deepEqual(firstReview.review.review.application.proposal,first.item.proposal);
  await draftDecision('reject','合成核对：先驳回，当前工时保持原核定');
  const rejected=await click(owner,'revision-decisions',approval().getByRole('button',{name:'确认驳回修订',exact:true}),'POST');
  assert.equal(rejected.decision.action,'reject');assert.equal(rejected.current.revision,1);assert.equal(rejected.effectiveChanged,false);
  const selfRejected=await selfRefresh();assert.equal(selfRejected.item.status,'rejected');assert.equal(selfRejected.item.decision.operationId,rejected.decision.operationId);
  assert.equal(selfRejected.item.decisionEffect,null);assert.equal(selfRejected.current.operationId,rootEffect.operation_id);
  await self().getByRole('heading',{name:'本次修订 · 已驳回',exact:true}).waitFor();assert.equal(versions().length,0);immutable();
  const firstRecord=revisions()[0],firstDecision=revisionDecisions()[0];
  pass('employee submits changed declaration through actual SQL; owner selects same pending revision from real history and explicitly rejects; both shells retain initial hours with no effect version');

  await click(employee,'revision-requests',self().getByRole('button',{name:'返回当前核定／准备新申请',exact:true}));
  const second=await submit('合成连续修订：重新核实后再次申请');assert.notEqual(second.item.requestId,first.item.requestId);
  assert.equal(second.item.submittedRevision,2);assert.deepEqual(revisions()[0],firstRecord);assert.deepEqual(revisionDecisions(),[firstDecision]);
  assert.equal(versions().length,0);const nextList=await ownerList();
  assert.equal(nextList.items.length,1);const secondReview=await ownerTarget(second.item.requestId,nextList);
  assert.equal(secondReview.review.submittedRevision,2);assert.equal(secondReview.current.revision,1);immutable();
  pass('rejected revision reprepare creates separate second request/UUID based on unchanged effective source; owner pending list excludes rejected request and preserves its full record');

  await draftDecision('approve','合成核对：批准本次一毫秒声明差异');control.lose=endpoint('revision-decisions');
  await approval().getByRole('button',{name:'确认批准修订',exact:true}).click();
  await approval().getByRole('status').filter({hasText:'未能确认审批结果'}).waitFor();
  const key=`faolla:attendance:revision-approval:v2:${site}:${actors[0].id}`;
  const raw=await owner.evaluate(key=>sessionStorage.getItem(key),key);assert(raw);const pending=JSON.parse(raw);
  assert.equal(control.lose,null);assert.equal(pending.command.requestId,second.item.requestId);assert.equal(pending.command.expectedBaseOperationId,rootEffect.operation_id);
  assert.equal(revisionDecisions().length,2);assert.equal(versions().length,1);assert.equal(writes('revision-decisions').at(-1).fault,'after-sql');
  const effect=versions()[0];assert.equal(effect.root_request_id,rootRequestId);assert.equal(effect.request_id,second.item.requestId);
  assert.equal(effect.operation_id,pending.command.operationId);assert.equal(effect.previous_operation_id,rootEffect.operation_id);
  assert.equal(effect.revision,2);assert.equal(effect.request_revision,2);assert.equal(effect.worked_us,rootEffect.worked_us+1000);
  assert.equal(effect.elapsed_us,rootEffect.elapsed_us+1000);assert.equal(effect.break_us,0);
  assert.equal(storedInstant(effect.start_at),second.item.proposal.startAt);assert.equal(storedInstant(effect.end_at),second.item.proposal.endAt);
  assert.deepEqual(revisions()[1].command.proposal,second.item.proposal);immutable();
  pass('revision approval commits exactly one new effect revision2 then response is lost; independent SQL proves +1000 microseconds, predecessor/root lineage and untouched original punches/initial approval');

  transport.state.moduleEnabled=false;const postCount=writes('revision-decisions').length;
  await approval().getByRole('button',{name:'返回考勤管理',exact:true}).click();
  const recovered=await click(owner,'revision-decisions',admin(owner).getByRole('button',{name:'连续修订审批／恢复',exact:true}),'GET',{operationId:pending.command.operationId});
  assert.equal(recovered.moduleEnabled,false);assert.equal(recovered.receipt.operationId,pending.command.operationId);
  assert.equal(recovered.replayed,true);assert.equal(recovered.effectiveChanged,false);assert.equal(recovered.current.revision,2);
  assert.equal(recovered.current.operationId,effect.operation_id);assert.equal(recovered.current.workedUs,effect.worked_us);
  await approval().getByRole('status').filter({hasText:'原审批已确认'}).waitFor();
  assert.equal(await owner.evaluate(key=>sessionStorage.getItem(key),key),null);assert.equal(writes('revision-decisions').length,postCount);
  assert.deepEqual(versions(),[effect]);assert.deepEqual(revisions()[0],firstRecord);assert.deepEqual(revisionDecisions()[0],firstDecision);immutable();
  pass('paused owner leaves and re-enters actual admin revision entry; exact stored approval receipt recovers by GET only without replay POST, extra effect or rewritten first rejection');

  const selfApproved=await selfRefresh();assert.equal(selfApproved.item.status,'approved');assert.equal(selfApproved.current.revision,2);
  assert.equal(selfApproved.item.basedOn.revision,1);assert.equal(selfApproved.item.decisionEffect.operationId,effect.operation_id);
  assert.equal(selfApproved.current.workedUs,effect.worked_us);assert.equal(selfApproved.item.decision.operationId,pending.command.operationId);
  await self().getByRole('heading',{name:'本次修订 · 已批准',exact:true}).waitFor();
  const selfHistory=await click(employee,'revision-history',self().getByRole('button',{name:'本班次修订历史',exact:true}),'GET',{access:'self'});
  assert.equal(selfHistory.rootRequestId,rootRequestId);assert.equal(selfHistory.workerId,worker.id);assert.equal(selfHistory.items.length,2);
  await ownerList();await history(owner,'owner').getByRole('combobox',{name:'申请状态',exact:true}).selectOption('all');
  const ownerHistory=await click(owner,'revision-history',history(owner,'owner').getByRole('button',{name:'查询修订列表',exact:true}),'GET',{access:'owner',status:'all'});
  const outcomes=result=>result.items.map(item=>({requestId:item.requestId,status:item.status,operation:item.decisionOperationId})).sort((a,b)=>a.requestId.localeCompare(b.requestId));
  assert.deepEqual(outcomes(selfHistory),outcomes(ownerHistory));assert.equal(selfHistory.items.find(item=>item.requestId===first.item.requestId).status,'rejected');
  assert.equal(selfHistory.items.find(item=>item.requestId===second.item.requestId).status,'approved');
  const historicalSelf=await click(employee,'revision-requests',history(employee,'self').getByRole('listitem').filter({hasText:first.item.requestId}).getByRole('button',{name:'查看修订详情',exact:true}),'GET',{requestId:first.item.requestId});
  const historicalOwner=await click(owner,'revision-decisions',history(owner,'owner').getByRole('listitem').filter({hasText:first.item.requestId}).getByRole('button',{name:'查看修订详情',exact:true}),'GET',{requestId:first.item.requestId});
  assert.equal(historicalSelf.item.status,'rejected');assert.equal(historicalSelf.item.basedOn.revision,1);assert.equal(historicalSelf.current.operationId,effect.operation_id);
  assert.equal(historicalOwner.decision.operationId,firstDecision.operation_id);assert.equal(historicalOwner.current.operationId,effect.operation_id);
  assert.equal(historicalOwner.review.base.revision,1);await self().getByRole('heading',{name:'本次修订 · 已驳回',exact:true}).waitFor();
  assert.match(await self().getByRole('region',{name:'当前有效核定',exact:true}).innerText(),/修订 2/);
  assert.match(await approval().getByRole('region',{name:'本次审批结果',exact:true}).innerText(),/已驳回/);
  assert.match(await approval().getByRole('region',{name:'当前有效核定',exact:true}).innerText(),/修订 2/);
  assert.equal(writes('revision-requests').length,2);assert.equal(writes('revision-decisions').length,2);assert.equal(writes('revision-history').length,0);
  assert.equal(transport.calls.filter(call=>call.name==='faolla_attendance_revision_self_v2'&&call.command!==null).length,2);
  assert.equal(transport.calls.filter(call=>call.name==='faolla_attendance_revision_decide_v2'&&call.command!==null).length,2);
  assert.equal(revisions().length,2);assert.equal(revisionDecisions().length,2);assert.deepEqual(versions(),[effect]);immutable();
  assert(await employee.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  pass('paused employee and owner independently reread matching two-item revision histories; old rejection retains submitted revision1 while both display current revision2, GET-only with 390px layout intact');
  transport.state.moduleEnabled=true;
  const latest=await click(employee,'revision-requests',self().getByRole('button',{name:'返回当前核定／准备新申请',exact:true}));
  assert.equal(latest.current.revision,2);assert.equal(latest.current.operationId,effect.operation_id);
  const third=await submit('合成连续修订：基于最新核定再次核实',latest.current);assert.equal(third.item.submittedRevision,3);
  assert.equal(third.item.basedOn.revision,2);assert.equal(third.current.operationId,effect.operation_id);
  assert.deepEqual(versions(),[effect]);await ownerTarget(third.item.requestId,await ownerList());
  await draftDecision('approve','合成核对：仅接续当前核定，不覆盖历史');
  const thirdApproved=await click(owner,'revision-decisions',approval().getByRole('button',{name:'确认批准修订',exact:true}),'POST');
  assert.equal(thirdApproved.current.revision,3);assert.equal(thirdApproved.effectiveChanged,true);
  const newest=versions()[1];assert.equal(newest.previous_operation_id,effect.operation_id);assert.equal(newest.root_request_id,rootRequestId);
  assert.equal(newest.request_id,third.item.requestId);assert.equal(newest.revision,3);assert.equal(newest.worked_us,rootEffect.worked_us+2000);
  assert.equal(storedInstant(newest.start_at),third.item.proposal.startAt);assert.equal(storedInstant(newest.end_at),third.item.proposal.endAt);
  assert.deepEqual(versions()[0],effect);assert.deepEqual(revisions()[0],firstRecord);assert.deepEqual(revisionDecisions()[0],firstDecision);immutable();
  pass('third request starts from effective revision2, keeps original root fence but advances effective-source fence; explicit owner approval appends revision3 with +1000 further microseconds, never rewriting revision2');

  transport.state.moduleEnabled=false;
  const newestSelf=await selfRefresh();assert.equal(newestSelf.item.basedOn.revision,2);assert.equal(newestSelf.item.decisionEffect.revision,3);
  assert.equal(newestSelf.current.operationId,newest.operation_id);assert.equal(newestSelf.current.workedUs,newest.worked_us);
  const allSelf=await click(employee,'revision-history',self().getByRole('button',{name:'本班次修订历史',exact:true}),'GET',{access:'self'});
  await ownerList();await history(owner,'owner').getByRole('combobox',{name:'申请状态',exact:true}).selectOption('all');
  const allOwner=await click(owner,'revision-history',history(owner,'owner').getByRole('button',{name:'查询修订列表',exact:true}),'GET',{access:'owner',status:'all'});
  assert.equal(allSelf.items.length,3);assert.deepEqual(outcomes(allSelf),outcomes(allOwner));
  for(const [page,access] of [[employee,'self'],[owner,'owner']])for(const [requestId,label] of [[first.item.requestId,'已驳回'],[second.item.requestId,'已批准'],[third.item.requestId,'已批准']]){
    const item=history(page,access).getByRole('listitem').filter({hasText:requestId});await item.waitFor();assert((await item.innerText()).includes(label));
  }
  const oldSelf=await click(employee,'revision-requests',history(employee,'self').getByRole('listitem').filter({hasText:second.item.requestId}).getByRole('button',{name:'查看修订详情',exact:true}),'GET',{requestId:second.item.requestId});
  const oldOwner=await click(owner,'revision-decisions',history(owner,'owner').getByRole('listitem').filter({hasText:second.item.requestId}).getByRole('button',{name:'查看修订详情',exact:true}),'GET',{requestId:second.item.requestId});
  assert.equal(oldSelf.item.basedOn.revision,1);assert.equal(oldSelf.item.decisionEffect.revision,2);assert.equal(oldSelf.current.revision,3);
  assert.equal(oldSelf.item.decisionEffect.operationId,effect.operation_id);assert.equal(oldSelf.current.operationId,newest.operation_id);
  assert.equal(oldOwner.review.base.revision,1);assert.equal(oldOwner.decision.operationId,effect.operation_id);assert.equal(oldOwner.current.operationId,newest.operation_id);
  await self().getByRole('heading',{name:'本次修订 · 已批准',exact:true}).waitFor();
  assert.match(await self().getByRole('region',{name:'本次批准结果 · 历史保留',exact:true}).innerText(),/修订 2/);
  assert.match(await self().getByRole('region',{name:'当前有效核定',exact:true}).innerText(),/修订 3/);
  assert.match(await approval().getByRole('region',{name:'本次审批结果',exact:true}).innerText(),/修订 2/);
  assert.match(await approval().getByRole('region',{name:'当前有效核定',exact:true}).innerText(),/修订 3/);
  assert.equal(writes('revision-requests').length,3);assert.equal(writes('revision-decisions').length,3);assert.equal(writes('revision-history').length,0);
  assert.equal(revisions().length,3);assert.equal(revisionDecisions().length,3);assert.deepEqual(versions(),[effect,newest]);immutable();
  assert(await employee.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  pass('both paused shells select older approved revision from matching three-item histories: visible submitted source1 and historic result2 stay distinct from current3; API worktime and immutable SQL agree');
  console.log(JSON.stringify({actualRevisionFlowShell:true,revisionRequests:3,revisionDecisions:3,effectVersions:2,currentRevision:3,
    originalEvents:4,initialEffects:1,approvalRecoveryGetOnly:true,historyAgreement:true,syntheticAuthOnly:true,productionWrites:0}));
  return {current:structuredClone(newest),previous:structuredClone(effect),rootRequestId,rootEffect:structuredClone(rootEffect)};
}
