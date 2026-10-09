//209 ordinary project browser test: new isolated headless context only.
//The original207 fixture owns SQL setup, true period seal and all cleanup.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {runPlanPosthocBrowserAcceptance} from './attendance-plan-posthoc-browser.mjs';
const api='/api/merchant-enterprise/attendance/plan-exceptions';
const notifications='/api/merchant-enterprise/attendance/event-notifications';

export async function verifyPosthocFullLeaveBrowser(ctx){
  let operationId,assertions;
  const bridge=await runPlanPosthocBrowserAcceptance({...ctx,onBrowserReady:async port=>{
    let browser,context,page,stage='setup',accept=true,checks=0,sealedArchive;
    const errors=[],external=[],posts=[],answers=[];
    const region=(access='owner')=>page.getByRole('region',{name:access==='owner'?'排班异常处理':'异常说明与处理结果',exact:true});
    const control=async id=>{await page.getByTestId(id).click();await page.waitForFunction(()=>!document.querySelector('[data-testid="flags-on"]')?.disabled);};
    const quiet=()=>page.waitForLoadState('networkidle');
    const open=async(access='owner')=>{await page.getByRole('button',{name:access==='owner'?'排班异常处理／历史与恢复':'异常说明与处理结果',exact:true}).click();await region(access).waitFor();};
    const close=async(access='owner')=>{await region(access).getByRole('button',{name:'返回考勤',exact:true}).click();await region(access).waitFor({state:'detached'});};
    const clickReply=async(locator,{path=api,method='GET',mode=null,status=200}={})=>{
      const [r]=await Promise.all([page.waitForResponse(reply=>{
        const request=reply.request(),url=new URL(reply.url());
        return url.pathname===path&&request.method()===method&&(!mode||(method==='POST'?request.postDataJSON()?.query?.mode:url.searchParams.get('mode'))===mode);
      }),locator.click()]);
      const raw=await r.text();assert.equal(r.status(),status,raw);return JSON.parse(raw);
    };
    const detail=async(access='owner')=>{
      await clickReply(region(access).getByRole('button',{name:'读取异常处理记录',exact:true}),{mode:'list'});
      const response=await clickReply(region(access).locator(`[data-plan-exception-slot="${ctx.h.slot.id}"]`).getByRole('button',{name:'查看说明与处理',exact:true}),{mode:'detail'});
      await region(access).locator('[data-plan-exception-detail]').waitFor();return response.data.detail;
    };
    const narrow=async locator=>{
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false,'209_document_overflow');
      assert.equal(await locator.evaluate(el=>el.scrollWidth>el.clientWidth+2),false,'209_component_overflow');
    };
    const key=`faolla:attendance:plan-exceptions:v1:${ctx.d.site}:owner:${ctx.d.owner}`;
    const stored=()=>page.evaluate(k=>sessionStorage.getItem(k),key);
    const archiveUnchanged=()=>{const old=ctx.periodArchive();assert.equal(old.artifactText,sealedArchive.artifactText);assert.equal(old.artifactSha256,sealedArchive.artifactSha256);};
    try{
      browser=await chromium.launch({headless:true});context=await browser.newContext({serviceWorkers:'block',acceptDownloads:false,viewport:{width:390,height:900}});
      await context.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin!==port.url){external.push(url.origin);return route.abort();}return route.continue();});
      page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));page.on('popup',()=>errors.push('unexpected_popup'));
      page.on('dialog',dialog=>{answers.push({stage,accept});void(accept?dialog.accept():dialog.dismiss()).catch(()=>{});});
      page.on('request',r=>{if(new URL(r.url()).pathname===api&&r.method()==='POST')posts.push(r.postDataJSON());});
      stage='full_leave_actual_owner_options';await page.goto(port.url);await quiet();await open();let current=await detail();
      assert.equal(current.current.state,'not_applicable');assert.equal(current.current.eligible,true);
      assert.equal(await region().getByLabel('异常处理选择',{exact:true}).isDisabled(),true);
      await control('flags-on');current=await detail();assert.equal(current.current.protocol,'plan-exception-source-v3');
      assert.deepEqual(current.current.leaveEdges.work,[]);await region().locator('[data-plan-not-applicable-boundary]').waitFor();
      //Locator.isDisabled retargets label descendants to the associated select;
      //inspect the native option property to test each choice, not its parent.
      for(const outcome of ['confirmed','excused','cleared'])assert.equal(await region().locator(`option[value="${outcome}"]`).evaluate(option=>option.disabled),true,outcome);
      assert.equal(await region().locator('option[value="not_applicable"]').evaluate(option=>option.disabled),false);
      await region().getByLabel('异常处理选择',{exact:true}).selectOption('not_applicable');
      assert.equal(await region().getByRole('button',{name:'确认保存异常处理',exact:true}).isDisabled(),true);
      await region().getByLabel('异常处理理由',{exact:true}).fill('209本地验收：整段获批请假，不冒充正常出勤。');
      accept=false;await region().getByRole('button',{name:'确认保存异常处理',exact:true}).click();await quiet();assert.equal(posts.length,0);accept=true;
      await narrow(region());checks++;

      stage='lost_not_applicable_save_then_real_period_seal';await control('drop-post');
      const lost=page.waitForEvent('requestfailed',{predicate:r=>new URL(r.url()).pathname===api&&r.method()==='POST'});
      await region().getByRole('button',{name:'确认保存异常处理',exact:true}).click();await lost;await region().locator('[data-plan-exception-pending]').waitFor();
      const firstRaw=await stored();assert(firstRaw);operationId=JSON.parse(firstRaw).command.operationId;assert.equal(posts.length,1);
      //True period writes, not a forged sealed flag or browser-admin shortcut.
      //The callback does not create the decision: it recovers the actual UI op.
      const sealed=await ctx.seal();assert.equal(sealed.period.sealed,true);sealedArchive=ctx.periodArchive();
      assert.equal(await stored(),firstRaw);assert.equal(ctx.review().detail.stale,false);checks++;

      stage='sealed_flag_off_original_receipt';await control('flags-off');
      const recovered=await clickReply(region().getByRole('button',{name:'核对原异常编号',exact:true}),{mode:'recover'});
      assert.equal(recovered.data.receipt.operationId,operationId);assert.equal(recovered.data.receipt.item.outcome,'not_applicable');
      assert.equal(recovered.data.detail.current,null);assert.equal(recovered.data.detail.currentValidation,'not_checked');
      await region().locator('[data-plan-exception-not-applicable]').waitFor();assert.equal(await stored(),null);assert.equal(posts.length,1);archiveUnchanged();checks++;

      stage='sealed_fresh_post_exact_409';await control('flags-on');await detail();
      await region().getByLabel('异常处理选择',{exact:true}).selectOption('follow_up');
      await region().getByLabel('异常处理理由',{exact:true}).fill('209本地验收：已封存周期必须拒绝新处理。');
      const beforeDenied=ctx.all();
      const denied=await clickReply(region().getByRole('button',{name:'确认保存异常处理',exact:true}),{method:'POST',mode:'decide',status:409});
      assert.deepEqual(denied,{ok:false,error:'attendance_period_sealed'});assert.equal(ctx.all(),beforeDenied);
      await region().locator('[data-plan-exception-pending]').waitFor();
      await region().getByRole('alert').filter({hasText:'封存'}).waitFor();
      assert.equal(await region().locator('[data-plan-exception-detail]').count(),0);
      const failedRaw=await stored();assert(failedRaw);const failed=JSON.parse(failedRaw);assert.notEqual(failed.command.operationId,operationId);
      assert.equal(posts.length,2);archiveUnchanged();await narrow(region());checks++;

      stage='sealed_original_null_retry_and_explicit_retirement';
      const empty=await clickReply(region().getByRole('button',{name:'核对原异常编号',exact:true}),{mode:'recover'});
      assert.equal(empty.data.receipt,null);assert.equal(empty.data.detail.latestDecision.operationId,operationId);assert.equal(await stored(),failedRaw);
      assert.equal(posts.length,2);assert.equal(ctx.all(),beforeDenied);
      const retried=await clickReply(region().getByRole('button',{name:'原编号核对并重试',exact:true}),{method:'POST',mode:'decide',status:409});
      assert.deepEqual(retried,denied);assert.deepEqual(posts[2],posts[1]);assert.equal(await stored(),failedRaw);assert.equal(ctx.all(),beforeDenied);
      const retired=await clickReply(region().getByRole('button',{name:'结束本次尝试',exact:true}),{mode:'recover'});assert.equal(retired.data.receipt,null);
      await region().locator('[data-plan-exception-pending]').waitFor({state:'detached'});assert.equal(await stored(),null);
      assert.equal(posts.length,3);assert.equal(ctx.all(),beforeDenied);archiveUnchanged();await close();checks++;

      stage='self_saved_not_applicable_and_distinct_message';await control('self-parent');await quiet();await open('self');
      const self=await detail('self');assert.equal(self.latestDecision.operationId,operationId);assert.equal(self.latestDecision.outcome,'not_applicable');
      assert.equal(self.current,null);assert.equal(self.currentValidation,'not_checked');
      await region('self').locator('[data-plan-exception-not-applicable]').waitFor();
      assert.equal(await region('self').getByLabel('异常处理选择',{exact:true}).count(),0);await narrow(region('self'));await close('self');
      await page.getByRole('button',{name:'考勤消息',exact:true}).click();const message=page.getByRole('region',{name:'考勤消息',exact:true});await message.waitFor();
      const list=await clickReply(message.getByRole('button',{name:'读取考勤消息',exact:true}),{path:notifications});
      const item=list.items.find(x=>x.sourceOperationId===operationId);assert(item);
      const shown=await clickReply(message.locator(`[data-event-notification-id="${item.notificationId}"]`).getByRole('button',{name:'查看考勤消息详情',exact:true}),{path:notifications});
      assert.equal(shown.detail.type,'not_applicable');assert.equal(shown.detail.readAt,null);
      await message.getByLabel('确认仅标读这条消息',{exact:true}).check();const marked=await clickReply(message.getByRole('button',{name:'明确标记这条消息已读',exact:true}),{path:notifications,method:'POST'});assert(marked.detail.readAt);
      assert.equal(ctx.review(ctx.rq('detail','self')).detail.latestDecision.readAt,null,'209_message_read_is_not_business_ack');
      archiveUnchanged();await narrow(message);await message.getByRole('button',{name:'关闭考勤消息',exact:true}).click();checks++;

      stage='sealed_known_successful_original_read_only';await control('owner-parent');await quiet();await open();await detail();
      await region().getByText('按已知原编号核对（不是全文历史检索）',{exact:true}).click();
      await region().getByLabel('异常操作编号',{exact:true}).fill(operationId);
      const historical=await clickReply(region().getByRole('button',{name:'读取指定异常原号',exact:true}),{mode:'recover'});
      assert.equal(historical.data.receipt.operationId,operationId);assert.equal(historical.data.receipt.item.outcome,'not_applicable');
      assert.equal(historical.data.detail.current,null);assert.equal(posts.length,3);archiveUnchanged();await close();checks++;

      const probe=await page.evaluate(()=>({probe:window.__posthocProbe,session:sessionStorage.getItem('qa-posthoc-unrelated'),local:localStorage.getItem('qa-posthoc-unrelated')}));
      assert.equal(probe.session,'keep');assert.equal(probe.local,'keep');assert.deepEqual(probe.probe.errors,[]);assert.deepEqual(probe.probe.csp,[]);
      const allowed=new Set([key,`faolla:attendance:event-notifications:v1:${ctx.d.site}:${ctx.h.employeeId}`]);
      assert(probe.probe.storage.every(x=>!x.local&&x.method!=='clear'&&allowed.has(x.key)&&x.bytes<=8192));
      assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
      const stats=port.stats();assert.deepEqual(stats.bridgeRejections,[]);assert.equal(stats.posts,4);assert.equal(stats.rejectedPosts,2);
      assert.equal(stats.rejectedPostFactHashChecks,2);assert.equal(stats.requests.filter(x=>x.dropped).length,1);
      assert(stats.requests.filter(x=>x.method==='GET').every(x=>x.getFactHashUnchanged));
      assertions={phase:209,checks,actualAdminAndSelfParents:true,actualHandlerServiceSql:true,fullLeaveNotApplicable:true,
        actualPeriodSealViaService:true,sealedFreshPost409:true,sealedRetrySameOperation:true,rejectedWritesZeroFacts:true,
        originalReceiptSurvivesSealAndFlagOff:true,explicitGetOnlyRetirement:true,selfHistoricalNotCurrent:true,messageReadSeparate:true,
        old155ArchivePreserved:true,newSealedArchivePreserved:true,width390:true,syntheticAuth:true,realAuth:false,realMobile:false,
        headless:true,externalRequests:0,businessRequests:stats.apiRequests,businessPosts:stats.posts,rejectedPosts:stats.rejectedPosts,dialogs:answers.length};
    }catch(error){const body=page?await page.locator('body').innerText().catch(()=>'<closed>'):null;
      throw Error('posthoc_full_leave_browser_failed:'+JSON.stringify({stage,error:String(error.message).slice(0,1500),stats:port.stats(),body:body?.slice(-9000)}),{cause:error});
    }finally{port.requestFinish();await context?.close();await browser?.close();}
  }});
  assert(operationId&&assertions);return {operationId,browserResult:{assertions,bridge}};
}
