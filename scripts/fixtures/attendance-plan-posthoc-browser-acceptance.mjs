//208 runs only in a newly owned headless browser, never the user's browser.
//The app is real React parents and HTTP handlers backed by the owned SQL fixture;
//only Auth identity and the explicit QA fault/feature controls are synthetic.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {runPlanPosthocBrowserAcceptance} from './attendance-plan-posthoc-browser.mjs';
const exception='/api/merchant-enterprise/attendance/plan-exceptions';
const adoption='/api/merchant-enterprise/attendance/plan-posthoc';
const evaluation='/api/merchant-enterprise/attendance/plan-posthoc-evaluation';
const notifications='/api/merchant-enterprise/attendance/event-notifications';

export async function verifyPlanPosthocBrowserAcceptance(ctx){
  let assertions;
  const bridge=await runPlanPosthocBrowserAcceptance({...ctx,onBrowserReady:async port=>{
    let browser,context,page,stage='setup',accept=true,checks=0;
    const errors=[],external=[],responses=[],dialogAnswers=[];
    const own=()=>responses.filter(r=>[exception,adoption,evaluation,notifications].includes(r.path));
    const posts=()=>responses.filter(r=>r.method==='POST');
    const region=(access='owner')=>page.getByRole('region',{name:access==='owner'?'排班异常处理':'异常说明与处理结果',exact:true});
    const child=()=>page.getByRole('region',{name:'负责人事后核对采用',exact:true});
    const quiet=async()=>{await page.waitForLoadState('networkidle');};
    const control=async id=>{await page.getByTestId(id).click();await page.getByTestId('flags-on').waitFor({state:'visible'});
      await page.waitForFunction(()=>!document.querySelector('[data-testid="flags-on"]')?.disabled);};
    const clickResponse=async(locator,{path=exception,method='GET',mode=null}={})=>{
      const [r]=await Promise.all([page.waitForResponse(reply=>{
        const req=reply.request(),url=new URL(reply.url());if(url.pathname!==path||req.method()!==method)return false;
        return !mode||(method==='POST'?req.postDataJSON()?.query?.mode:url.searchParams.get('mode'))===mode;
      }),locator.click()]);
      const text=await r.text();assert.equal(r.status(),200,text);return JSON.parse(text);
    };
    const open=async(access='owner')=>{await page.getByRole('button',{name:access==='owner'?'排班异常处理／历史与恢复':'异常说明与处理结果',exact:true}).click();await region(access).waitFor();};
    const listDetail=async(access='owner')=>{
      await clickResponse(region(access).getByRole('button',{name:'读取异常处理记录',exact:true}),{mode:'list'});
      const data=await clickResponse(region(access).locator(`[data-plan-exception-slot="${ctx.h.slot.id}"]`).getByRole('button',{name:'查看说明与处理',exact:true}),{mode:'detail'});
      await region(access).locator('[data-plan-exception-detail]').waitFor();return data.data.detail;
    };
    const close=async(access='owner')=>{await region(access).getByRole('button',{name:'返回考勤',exact:true}).click();await region(access).waitFor({state:'detached'});};
    const narrow=async locator=>{
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false,'208_390_document_overflow');
      assert.equal(await locator.evaluate(el=>el.scrollWidth>el.clientWidth+2),false,'208_390_component_overflow');
    };
    try{
      browser=await chromium.launch({headless:true});context=await browser.newContext({serviceWorkers:'block',acceptDownloads:false,viewport:{width:390,height:900}});
      await context.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin!==port.url){external.push(url.origin);return route.abort();}return route.continue();});
      page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));page.on('popup',()=>errors.push('unexpected_popup'));
      page.on('dialog',dialog=>{dialogAnswers.push({stage,accepted:accept});void(accept?dialog.accept():dialog.dismiss()).catch(()=>{});});
      page.on('response',r=>{const url=new URL(r.url()),req=r.request();if(url.pathname.startsWith('/api/'))responses.push({path:url.pathname,method:req.method(),status:r.status(),mode:req.method()==='POST'?req.postDataJSON()?.query?.mode:url.searchParams.get('mode')});});
      stage='owner_default_off';await page.goto(port.url);await quiet();await page.getByRole('region',{name:'考勤配置管理',exact:true}).waitFor();assert.equal(own().length,0);
      await open();await quiet();assert.equal(own().length,0);let detail=await listDetail();assert.equal(detail.current.protocol,'plan-exception-source-v3');assert(detail.stale);
      assert.equal(await region().getByLabel('异常处理选择',{exact:true}).isDisabled(),true);assert.equal(await region().locator('option[value="not_applicable"]').count(),0);await narrow(region());checks++;

      stage='adoption_explicit_selection';await control('flags-on');await listDetail();await region().locator('[data-plan-posthoc-entry]').click();await child().waitFor();
      const beforeCandidate=own().length;await quiet();assert.equal(own().length,beforeCandidate);
      const preview=await clickResponse(child().getByRole('button',{name:'核对保存来源与请假（预览）',exact:true}),{path:evaluation});
      assert.equal(preview.ok,true);assert.equal(posts().length,0);await narrow(child());
      const candidates=await clickResponse(child().getByRole('button',{name:'读取本排班采用与当前候选',exact:true}),{path:adoption});assert(candidates.data.preview.eligible);
      for(const ref of ctx.selected){const key=ref.kind==='session'?`session:${ref.startEventId}`:`missing:${ref.rootRequestId}`;
        await child().getByLabel(`采用${ref.kind==='session'?'真实班次':'批准漏卡'} ${key}`,{exact:true}).check();}
      await child().getByLabel('事后采用或撤销理由',{exact:true}).fill('208本地验收：明确核对两个完整来源，不改原始打卡。');
      await child().getByLabel('确认已核对人员排班版本与采用范围',{exact:true}).check();
      accept=false;await child().getByRole('button',{name:'返回异常核查',exact:true}).click();await child().waitFor();assert.equal(await child().getByLabel('确认已核对人员排班版本与采用范围',{exact:true}).isChecked(),true);accept=true;
      assert.equal(posts().length,0);await narrow(child());
      await control('drop-post');const lostApply=page.waitForEvent('requestfailed',{predicate:r=>new URL(r.url()).pathname===adoption&&r.method()==='POST'});
      await child().getByRole('button',{name:'保存本次整组采用',exact:true}).click();await lostApply;await child().locator('[data-plan-posthoc-pending]').waitFor();
      const adoptionKey=`faolla:attendance:plan-posthoc:v1:${ctx.d.site}:${ctx.d.owner}:${ctx.h.workerId}:${ctx.h.slot.id}`;
      const adoptionRaw=await page.evaluate(key=>sessionStorage.getItem(key),adoptionKey);assert(adoptionRaw);const adoptionOp=JSON.parse(adoptionRaw).command.operationId;
      checks++;

      stage='flag_off_parent_known_target_recovery';await control('flags-off');await control('exception-off');await control('owner-parent');await quiet();
      const recoveryBefore=own().length;
      await page.getByRole('button',{name:'按已知人员／排班核对采用原号',exact:true}).click();await region().waitFor();
      await region().getByLabel('恢复采用的考勤人员编号',{exact:true}).fill(ctx.h.workerId);await region().getByLabel('恢复采用的排班编号',{exact:true}).fill(ctx.h.slot.id);
      await region().getByRole('button',{name:'打开该目标的采用原号核对',exact:true}).click();await child().locator('[data-plan-posthoc-pending]').waitFor();await quiet();assert.equal(own().length,recoveryBefore);
      assert.deepEqual(await child().getByRole('button').allTextContents(),['返回异常核查','只核对原编号']);
      const recovered=await clickResponse(child().getByRole('button',{name:'只核对原编号',exact:true}),{path:adoption,mode:'recover'});
      assert.equal(recovered.data.receipt.operationId,adoptionOp);assert.equal(recovered.canWrite,false);assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),adoptionKey),null);
      assert.equal(own().length,recoveryBefore+1);assert.deepEqual(await child().getByRole('button').allTextContents(),['返回异常核查']);await narrow(child());
      await child().getByRole('button',{name:'返回异常核查',exact:true}).click();await close();checks++;

      stage='formal_current_after_adoption';await control('exception-on');await control('flags-on');await open();detail=await listDetail();
      assert.equal(detail.current.protocol,'plan-exception-source-v3');assert(detail.current.eligible,JSON.stringify(detail.current.blockers));
      assert.equal(detail.current.source.evaluation.posthoc.current.operationId,adoptionOp);
      await region().getByLabel('异常处理选择',{exact:true}).selectOption('confirmed');await region().getByLabel('异常处理理由',{exact:true}).fill('208本地验收：基于新采用后重新读取的当前依据明确处理。');
      await control('drop-post');const lostDecision=page.waitForEvent('requestfailed',{predicate:r=>new URL(r.url()).pathname===exception&&r.method()==='POST'});
      await region().getByRole('button',{name:'确认保存异常处理',exact:true}).click();await lostDecision;await region().locator('[data-plan-exception-pending]').waitFor();
      const decisionKey=`faolla:attendance:plan-exceptions:v1:${ctx.d.site}:owner:${ctx.d.owner}`;
      const decisionRaw=await page.evaluate(key=>sessionStorage.getItem(key),decisionKey);assert(decisionRaw);const decisionOp=JSON.parse(decisionRaw).command.operationId;
      await control('flags-off');await region().locator('[data-plan-exception-pending]').waitFor();
      const restored=await clickResponse(region().getByRole('button',{name:'核对原异常编号',exact:true}),{mode:'recover'});
      assert.equal(restored.data.receipt.operationId,decisionOp);assert.equal(restored.data.receipt.item.evidence.policy,'owner-confirmed-plan-edges-posthoc-v3');
      assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),decisionKey),null);assert((await region().innerText()).includes('当前依据未重新核查'));await close();checks++;

      stage='self_saved_result_note_and_ack';await control('self-parent');await quiet();await open('self');const selfDetail=await listDetail('self');
      assert.equal(selfDetail.latestDecision.operationId,decisionOp);assert.equal(selfDetail.current,null);assert.equal(selfDetail.currentValidation,'not_checked');
      await region('self').getByLabel('异常本人说明',{exact:true}).fill('208本地验收：请负责人再核查这一决定。');
      assert.equal(await region('self').getByRole('button',{name:'明确已读处理结果',exact:true}).isDisabled(),true);
      const note=await clickResponse(region('self').getByRole('button',{name:'提交本人说明',exact:true}),{method:'POST',mode:'note'});assert.equal(note.data.receipt.command.decisionOperationId,decisionOp);
      const ack=await clickResponse(region('self').getByRole('button',{name:'明确已读处理结果',exact:true}),{method:'POST',mode:'ack'});assert.equal(ack.data.readReceipt.decisionOperationId,decisionOp);
      await narrow(region('self'));await close('self');checks++;

      stage='message_read_separate';await page.getByRole('button',{name:'考勤消息',exact:true}).click();const message=page.getByRole('region',{name:'考勤消息',exact:true});await message.waitFor();
      const listed=await clickResponse(message.getByRole('button',{name:'读取考勤消息',exact:true}),{path:notifications});
      const item=listed.items.find(x=>x.sourceOperationId===decisionOp);assert(item,'208_decision_message_missing');
      const shown=await clickResponse(message.locator(`[data-event-notification-id="${item.notificationId}"]`).getByRole('button',{name:'查看考勤消息详情',exact:true}),{path:notifications});assert.equal(shown.detail.readAt,null);
      await message.getByLabel('确认仅标读这条消息',{exact:true}).check();const marked=await clickResponse(message.getByRole('button',{name:'明确标记这条消息已读',exact:true}),{path:notifications,method:'POST'});assert(marked.detail.readAt);await narrow(message);
      await message.getByRole('button',{name:'关闭考勤消息',exact:true}).click();await message.waitFor({state:'detached'});checks++;

      stage='hidden_and_scope_late_responses';await open('self');await control('hold-get');
      const count=own().length;await region('self').getByRole('button',{name:'读取异常处理记录',exact:true}).click();
      await page.waitForFunction(async url=>(await(await fetch(url)).json()).heldResponses>0,port.statsUrl);
      await control('hide');await control('release-get');await quiet();assert.equal(await region('self').locator('[data-plan-exception-detail],[data-plan-exception-case]').count(),0);
      await control('show');await quiet();assert.equal(own().length,count); //Aborted held response never reaches the browser response event.
      await control('hold-get');await region('self').getByRole('button',{name:'读取异常处理记录',exact:true}).click();
      await page.waitForFunction(async url=>(await(await fetch(url)).json()).heldResponses>0,port.statsUrl);
      await control('owner-parent');await control('release-get');await quiet();assert.equal(await page.locator('[data-plan-exception-detail],[data-plan-exception-case]').count(),0);checks++;

      stage='later_note_requires_fresh_handling';await open();const latest=await listDetail();
      //A note changes the case revision, not the clock/source fingerprint.
      //These are distinct reasons to re-review; neither silently rewrites the
      //saved decision, and marking it read must not resolve the later note.
      assert.equal(latest.stale,false);assert(latest.revision>latest.latestDecision.revision);
      assert.equal(latest.history[0].kind,'note');assert.equal(latest.history[0].decisionOperationId,decisionOp);
      assert.equal(latest.latestDecision.operationId,decisionOp);await region().locator('[data-plan-exception-newer-note]').waitFor();
      const beforePeriod=ctx.all(),period=await ctx.period(ctx.pq());assert.equal(ctx.all(),beforePeriod);assert(period.preview.blockers.includes('unresolved_review'));
      await close();checks++;
      const probe=await page.evaluate(()=>({probe:window.__posthocProbe,session:sessionStorage.getItem('qa-posthoc-unrelated'),local:localStorage.getItem('qa-posthoc-unrelated')}));
      assert.equal(probe.session,'keep');assert.equal(probe.local,'keep');assert.deepEqual(probe.probe.csp,[]);assert.deepEqual(probe.probe.errors,[]);
      const allowed=new Set([adoptionKey,decisionKey,`faolla:attendance:plan-exceptions:v1:${ctx.d.site}:self:${ctx.h.employeeId}`,`faolla:attendance:event-notifications:v1:${ctx.d.site}:${ctx.h.employeeId}`]);
      assert(probe.probe.storage.every(x=>!x.local&&x.method!=='clear'&&allowed.has(x.key)&&x.bytes<=8192));
      assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
      const stats=port.stats();assert.equal(stats.bridgeRejections.length,0,JSON.stringify(stats.bridgeRejections));
      assert.equal(stats.posts,5,'208_only_five_explicit_business_posts');
      assert.equal(stats.requests.filter(x=>x.dropped).length,2,'208_two_partial_response_losses');
      assert(stats.requests.filter(x=>x.method==='GET').every(x=>x.getFactHashUnchanged),'208_reads_never_write');
      assertions={checks,actualAdminAndSelfParents:true,actualHandlerServiceSql:true,syntheticAuth:true,
        independentEvaluationReadOnly:true,adoptionLostResponseAndFlagOffExactRecovery:true,noFormalReadNeededForAdoptionRecovery:true,formalLostResponseGetOnlyRecovery:true,
        selfNoteRequiresFreshHandling:true,businessReadAndMessageReadSeparate:true,hiddenAndScopeLateRepliesCleared:true,
        width390:true,storageExactKeysOnly:true,externalRequests:0,realAuth:false,realMobile:false,headless:true,
        businessRequests:stats.requests.length,businessPosts:stats.requests.filter(x=>x.method==='POST').length,dialogs:dialogAnswers.length};
    }catch(error){const text=page?await page.locator('body').innerText().catch(()=>'<closed>'):null;
      throw Error('posthoc_browser_acceptance_failed:'+JSON.stringify({stage,error:String(error.message).slice(0,1400),requests:responses.slice(-6),stats:port.stats(),ui:text?.slice(-9000)}),{cause:error});
    }finally{
      port.requestFinish();await context?.close();await browser?.close();
    }
  }});
  assert(assertions);return {assertions,bridge};
}
