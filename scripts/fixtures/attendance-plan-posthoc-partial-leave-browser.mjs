//230 INERT. Reuse208 actual parents/handlers/services/SQL in the caller-owned
//temporary namespace. Preparation and UI writes commit there; they are NOT
//per-case rollback. The root-owned207 sandbox removes that exact namespace.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {runPlanPosthocBrowserAcceptance} from './attendance-plan-posthoc-browser.mjs';

const api='/api/merchant-enterprise/attendance/plan-exceptions';
export const partialLeaveBrowserGroups=Object.freeze(['approved_edges_are_current_not_a_decision',
 'explicit_cleared_actual_parent_post','self_saved_edges_not_current_recalculation',
 'real_period_seal_uses_cleared','cancelled_head_leave_changes_current_not_saved_result']);

//The inherited groups fixture already encloses d.exec in BEGIN/COMMIT and an
//exact OID/owner/marker guard. Add only a runtime role assertion, not a nested
//transaction or a JSON wrapper. DO produces no rows and preserves RPC output.
export function partialLeaveBrowserRoleSql(source){
 assert.equal(typeof source,'string');
 assert(source.startsWith('set local role service_role;select public.faolla_attendance_'),'partial_leave_browser_rpc_only');
 return source.replace('set local role service_role;',
  "set local role service_role;do $partial_leave_browser_role$ begin assert current_user='service_role','partial_leave_browser_role_required';end;$partial_leave_browser_role$;");
}
export function assertPartialLeaveBrowserPrepared(value){
 const detail=value?.detail,current=detail?.current;
 assert(detail?.latestDecision&&detail.latestDecision.outcome!=='cleared','partial_leave_browser_requires_old_decision');
 assert.equal(current?.protocol,'plan-exception-source-v3');assert.equal(current.state,'required');assert.equal(current.eligible,true);
 assert.deepEqual(current.blockers,[]);
 for(const edge of ['late','early']){assert.equal(current.candidate[edge].state,'not_triggered');assert.equal(current.candidate[edge].rawDeltaUs,'0');}
 assert.equal(current.leaveEdges.approvedCoverage.length,2);assert.equal(current.leaveEdges.remainingRequired.length,1);
 assert.deepEqual(current.leaveEdges.pending,[]);assert.deepEqual(current.leaveEdges.workLeaveOverlaps,[]);
 return current.fingerprint;
}
export function assertPartialLeaveBrowserTransition(before,value){
 const current=before?.detail?.current;
 assert.equal(current?.protocol,'plan-exception-source-v3');assert.equal(current.eligible,true);assert.deepEqual(current.blockers,[]);
 assert.equal(current.candidate.late.state,'triggered');assert(BigInt(current.candidate.late.rawDeltaUs)>0n);
 assert.equal(current.candidate.early.state,'not_triggered');assert.equal(current.candidate.early.minutes,10);
 assert.equal(current.candidate.early.rawDeltaUs,'300000000');
 const fingerprint=assertPartialLeaveBrowserPrepared(value);assert.notEqual(current.fingerprint,fingerprint);
 return fingerprint;
}
export async function verifyPosthocPartialLeaveBrowser(ctx){
 assert(ctx?.d?.syntheticOnly===true&&ctx?.h?.syntheticOnly===true,'partial_leave_browser_synthetic_only');
 for(const key of ['read','rq','all','archive','periodArchive','seal','cancel','assertPreserved'])assert.equal(typeof ctx[key],'function',key);
 const prepared=ctx.read(),preparedFingerprint=assertPartialLeaveBrowserTransition(ctx.beforeLeave,prepared);
 ctx.assertPreserved();
 const inheritedExec=ctx.d.exec;let roleCheckedRpcCalls=0,operationId,assertions;
 const bridgeCtx={...ctx,d:{...ctx.d,exec:source=>{const checked=partialLeaveBrowserRoleSql(source);roleCheckedRpcCalls++;return inheritedExec(checked);}}};
 const bridge=await runPlanPosthocBrowserAcceptance({...bridgeCtx,onBrowserReady:async port=>{
  let browser,context,page,stage='setup',accept=true,sealedArchive;
  const errors=[],external=[],posts=[],groups=[],dialogs=[];
  const region=(access='owner')=>page.getByRole('region',{name:access==='owner'?'排班异常处理':'异常说明与处理结果',exact:true});
  const quiet=()=>page.waitForLoadState('networkidle');
  const control=async id=>{await page.getByTestId(id).click();await page.waitForFunction(()=>!document.querySelector('[data-testid="flags-on"]')?.disabled);};
  const open=async(access='owner')=>{await page.getByRole('button',{name:access==='owner'?'排班异常处理／历史与恢复':'异常说明与处理结果',exact:true}).click();await region(access).waitFor();};
  const close=async(access='owner')=>{await region(access).getByRole('button',{name:'返回考勤',exact:true}).click();await region(access).waitFor({state:'detached'});};
  const clickReply=async(locator,{method='GET',mode=null}={})=>{
   const [response]=await Promise.all([page.waitForResponse(reply=>{const request=reply.request(),url=new URL(reply.url());
    return url.pathname===api&&request.method()===method&&(!mode||(method==='POST'?request.postDataJSON()?.query?.mode:url.searchParams.get('mode'))===mode);}),locator.click()]);
   const text=await response.text();assert.equal(response.status(),200,text);return JSON.parse(text);
  };
  const detail=async(access='owner')=>{
   await clickReply(region(access).getByRole('button',{name:'读取异常处理记录',exact:true}),{mode:'list'});
   const value=await clickReply(region(access).locator(`[data-plan-exception-slot="${ctx.h.slot.id}"]`).getByRole('button',{name:'查看说明与处理',exact:true}),{mode:'detail'});
   await region(access).locator('[data-plan-exception-detail]').waitFor();return value.data.detail;
  };
  const narrow=async()=>{assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),'partial_leave_document_overflow');};
  const sameArchive=()=>{const current=ctx.periodArchive();assert.equal(current.artifactText,sealedArchive.artifactText);assert.equal(current.artifactSha256,sealedArchive.artifactSha256);ctx.assertPreserved();};
  try{
   browser=await chromium.launch({headless:true});context=await browser.newContext({serviceWorkers:'block',acceptDownloads:false,viewport:{width:390,height:900}});
   await context.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin!==port.url){external.push(url.origin);return route.abort();}return route.continue();});
   page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));page.on('popup',()=>errors.push('unexpected_popup'));
   page.on('dialog',dialog=>{dialogs.push({stage,accept});void(accept?dialog.accept():dialog.dismiss()).catch(()=>{});});
   page.on('request',request=>{if(new URL(request.url()).pathname===api&&request.method()==='POST')posts.push(request.postDataJSON());});
   stage='current_edges';await page.goto(port.url);await quiet();await open();let current=await detail();
   assert.equal(current.current.fingerprint,preparedFingerprint);assert.equal(current.latestDecision.operationId,prepared.detail.latestDecision.operationId);
   assert.equal(await region().getByLabel('异常处理选择',{exact:true}).isDisabled(),true);assert.equal(posts.length,0);
   await control('flags-on');current=await detail();assertPartialLeaveBrowserPrepared({detail:current});
   await region().getByRole('region',{name:'本次事后依据与请假边缘',exact:true}).waitFor();
   for(const edge of ['late','early'])assert.equal(await region().locator(`[data-plan-exception-field="${edge}"]`).getAttribute('data-rule-state'),'not_triggered');
   assert.equal(await region().locator('option[value="cleared"]').evaluate(option=>option.disabled),false);
   assert.equal(await region().locator('option[value="not_applicable"]').evaluate(option=>option.disabled),true);
   await narrow();ctx.assertPreserved();groups.push(partialLeaveBrowserGroups[0]);

   stage='explicit_cleared';await region().getByLabel('异常处理选择',{exact:true}).selectOption('cleared');
   await region().getByLabel('异常处理理由',{exact:true}).fill('230本地验收：首尾获批请假后两项规则未触发，不改原打卡或工时。');
   accept=false;await region().getByRole('button',{name:'确认保存异常处理',exact:true}).click();await quiet();assert.equal(posts.length,0);accept=true;
   const saved=await clickReply(region().getByRole('button',{name:'确认保存异常处理',exact:true}),{method:'POST',mode:'decide'});
   operationId=saved.data.receipt.operationId;assert.equal(operationId,posts[0].command.operationId);assert.equal(posts.length,1);
   assert.equal(saved.data.receipt.item.outcome,'cleared');assert.equal(saved.data.receipt.command.expectedFingerprint,preparedFingerprint);
   assert.deepEqual(saved.data.receipt.item.evidence.evaluation.leaveEdges,current.current.leaveEdges);
   await region().locator('[data-plan-exception-cleared]').waitFor();
   assert.equal(await region().locator('[data-plan-exception-pending]').count(),0);
   const evidence=saved.data.receipt.item.evidence;ctx.assertPreserved();groups.push(partialLeaveBrowserGroups[1]);await close();

   stage='self_saved';await control('self-parent');await quiet();await open('self');const self=await detail('self');
   assert.equal(self.current,null);assert.equal(self.currentValidation,'not_checked');assert.equal(self.latestDecision.operationId,operationId);
   assert.equal(self.latestDecision.outcome,'cleared');assert.equal(self.latestDecision.readAt,null);assert.deepEqual(self.latestDecision.evidence,evidence);
   await region('self').getByRole('region',{name:'保存时的事后依据与请假边缘',exact:true}).waitFor();await region('self').locator('[data-plan-exception-cleared]').waitFor();
   assert.equal(await region('self').getByLabel('异常处理选择',{exact:true}).count(),0);await narrow();await close('self');groups.push(partialLeaveBrowserGroups[2]);

   stage='period_seal';const sealed=await ctx.seal();assert.equal(sealed.period.sealed,true);sealedArchive=ctx.periodArchive();sameArchive();
   await control('owner-parent');await quiet();await open();current=await detail();assert.equal(current.latestDecision.operationId,operationId);
   assert.equal(current.stale,false);assert.equal(current.current.fingerprint,preparedFingerprint);assert.equal(posts.length,1);groups.push(partialLeaveBrowserGroups[3]);

   stage='cancelled_head_leave';await ctx.cancel();current=await detail();assert.equal(current.stale,true);
   assert.equal(current.latestDecision.operationId,operationId);assert.equal(current.latestDecision.outcome,'cleared');assert.deepEqual(current.latestDecision.evidence,evidence);
   assert.notEqual(current.current.fingerprint,preparedFingerprint);assert.equal(current.current.candidate.late.state,'triggered');
   assert.equal(current.current.candidate.late.rawDeltaUs,ctx.beforeLeave.detail.current.candidate.late.rawDeltaUs);
   await region().getByText('历史决定与当前依据已不同',{exact:false}).waitFor();
   await region().locator('[data-plan-exception-cleared]').waitFor();sameArchive();assert.equal(posts.length,1);await narrow();
   await close();await control('self-parent');await quiet();await open('self');const historical=await detail('self');
   assert.equal(historical.current,null);assert.equal(historical.currentValidation,'not_checked');assert.equal(historical.latestDecision.operationId,operationId);
   assert.deepEqual(historical.latestDecision.evidence,evidence);await close('self');groups.push(partialLeaveBrowserGroups[4]);

   const probe=await page.evaluate(()=>window.__posthocProbe);assert.deepEqual(probe.errors,[]);assert.deepEqual(probe.csp,[]);
   const key=`faolla:attendance:plan-exceptions:v1:${ctx.d.site}:owner:${ctx.d.owner}`;
   assert(probe.storage.every(entry=>!entry.local&&entry.method!=='clear'&&entry.key===key&&entry.bytes<=8192));
   assert.equal(await page.evaluate(k=>sessionStorage.getItem(k),key),null);
   assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert.deepEqual(groups,partialLeaveBrowserGroups);
   const stats=port.stats();assert.deepEqual(stats.bridgeRejections,[]);assert.equal(stats.posts,1);assert.equal(stats.rejectedPosts,0);
   assert(stats.requests.every(entry=>entry.status===200));assert(stats.requests.filter(entry=>entry.method==='GET').every(entry=>entry.getFactHashUnchanged));
   assert(stats.apiRequests<=35,'partial_leave_browser_request_budget');sameArchive();
   assertions={phase:230,groups,actualAdminAndSelfParents:true,actualHandlerServiceSql:true,roleCheckedRpcCalls,
    browserGeneratedOperation:true,businessRequests:stats.apiRequests,businessPosts:stats.posts,actualClearedDecision:true,
    savedSelfEvidence:true,selfReadIsNotAcknowledgement:true,actualPeriodSealViaRpcAndStrictProjection:true,cancelInvalidatesCurrentOnly:true,
    tailWasAlreadyWithinGrace:true,headLateChangedToNotTriggered:true,headAndTailRawDeltaNowZero:true,
    originalEventsAndFixedRulesPreserved:true,old155And207ArtifactsPreserved:true,newSealedArchivePreserved:true,
    syntheticAuth:true,realAuth:false,realMobile:false,width390:true,headless:true,perCaseRollback:false,
    cleanupOwner:'root207 exact owned namespace and public baseline',dialogs:dialogs.length,screenshots:false};
  }catch(error){const body=page?await page.locator('body').innerText().catch(()=>'<closed>'):null;
   throw Error('posthoc_partial_leave_browser_failed:'+JSON.stringify({stage,error:String(error.message).slice(0,1200),stats:port.stats(),body:body?.slice(-7000)}),{cause:error});
  }finally{port.requestFinish();try{await context?.close();}finally{await browser?.close();}}
 }});
 assert(operationId&&assertions);ctx.assertPreserved();return {operationId,browserResult:{assertions,bridge}};
}
