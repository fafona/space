import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createRequire} from 'node:module';
import net from 'node:net';
import {chromium} from 'playwright';
import {runAttendanceLabelsReuse} from './merchant-attendance-choice-labels-reuse-native.mjs';
import {checkPinWorkflow,workflowCsvWorkedUs} from './merchant-attendance-pin-workflow-native.mjs';
const require=createRequire(import.meta.url);
const {TERMINAL_COOKIE}=require('../src/lib/merchantAttendanceTerminal.ts');
const {correctionTimeInput,correctionTimeControlValue}=require('../src/lib/merchantAttendanceCorrectionForm.ts');
const handlers=Object.fromEntries([
  ['terminal-device','handleTerminalDevice','merchantAttendanceTerminal','executeTerminalDevice'],
  ['terminal-clock','handlePinClock','merchantAttendancePinClock','executePinClock'],
  ['history','handleAttendanceHistory','merchantAttendanceHistory','executeAttendanceHistory'],
  ['corrections/context','handleCorrectionContext','merchantAttendanceSelfContext','executeAttendanceSelfContext'],
  ['corrections','handleAttendanceCorrection','merchantAttendanceCorrection','executeAttendanceCorrection'],
  ['correction-reviews','handleCorrectionReview','merchantAttendanceCorrectionReview','executeCorrectionReview'],
  ['correction-decisions','handleCorrectionDecision','merchantAttendanceCurrentCorrectionDecision','executeCurrentCorrectionDecision'],
  ['revision-requests','handleAttendanceRevision','merchantAttendanceRevisionCycle','executeRevisionCycle'],
  ['revision-decisions','handleRevisionDecision','merchantAttendanceRevisionDecision','executeRevisionDecision'],
  ['unified-timesheet','handleUnifiedTimesheet','merchantAttendanceUnifiedTimesheet','executeUnifiedTimesheet'],
  ['unified-export','handleUnifiedExport','merchantAttendanceUnifiedExport','executeUnifiedExport'],
].map(([route,handler,module,executor])=>[route,[require(`../src/app/api/merchant-enterprise/attendance/${route}/route-handler.ts`)[handler],require(`../src/lib/${module}.server.ts`)[executor]]]));
assert(Object.values(handlers).every(pair=>pair.every(fn=>typeof fn==='function')));
async function browserCheck(env){
  const {root,exec,site,owner,terminalId,secret,people,proposal,service,pass,fromDate,throughDate}=env,p=people[1];
  const origin='https://attendance.synthetic.test',local='http://127.0.0.1:3131',canonical='https://www.faolla.com';
  const probe=net.createServer();await new Promise((resolve,reject)=>{probe.once('error',reject);probe.listen(3131,'127.0.0.1',resolve);});await new Promise(resolve=>probe.close(resolve));
  const child=spawn(process.execPath,['scripts/attendance-self-browser-harness.mjs','--pin-workflow','--unified-export'],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});
  let browser,page,auth=p.auth,dropCorrection=true,dropApproval=true;const errors=[],external=[],requests=[];
  try{
    await new Promise((resolve,reject)=>{let out='';const timer=setTimeout(()=>reject(Error('pin_workflow_harness_timeout')),20000);child.stdout.on('data',v=>{out+=v;if(out.includes('Attendance synthetic component QA')){clearTimeout(timer);resolve();}});child.stderr.on('data',v=>errors.push(String(v)));child.once('exit',code=>{clearTimeout(timer);reject(Error('pin_workflow_harness_exit_'+code));});});
    browser=await chromium.launch({headless:true});const context=await browser.newContext({viewport:{width:1200,height:1000},serviceWorkers:'block'});
    await context.addCookies([{name:TERMINAL_COOKIE,value:`${site}.${terminalId}.${secret}`,url:origin,httpOnly:true,secure:true,sameSite:'Strict'}]);
    await context.route('**/*',async route=>{
      const r=route.request(),url=new URL(r.url());if(url.origin!==origin){external.push(url.origin);return route.abort();}
      if(!url.pathname.startsWith('/api/')){assert(['/','/harness.js','/harness.css'].includes(url.pathname));return route.fulfill({response:await context.request.get(local+url.pathname)});}
      try{
        const key=url.pathname.replace('/api/merchant-enterprise/attendance/',''),pair=handlers[key];assert(pair);
        const headers=new Headers(await r.allHeaders());if(headers.get('origin')===origin)headers.set('origin',canonical);headers.set('host','www.faolla.com');if(headers.get('referer')?.startsWith(origin))headers.set('referer',canonical+'/');
        const req=new Request(canonical+url.pathname+url.search,{method:r.method(),headers,body:r.postData()??undefined});
        const deps={enabled:()=>true,allow:()=>true,accessEnabled:()=>true,authenticate:async()=>({user:{id:auth},accessToken:'synthetic',authenticationMethods:['password']}),entitlement:async()=>({permissionConfig:{allowEnterpriseManagement:true,allowEmployeeAttendance:true}})};
        const response=await pair[0](req,{...deps,execute:i=>pair[1](i,service)}),body=r.postData()?JSON.parse(r.postData()):null;
        // Never retain/log PIN, Cookie, personal data or reason fields.
        requests.push({key,method:r.method(),status:response.status,operationId:body?.operationId??body?.command?.operationId??null});
        if(r.method()==='POST'&&response.status===200&&(key==='corrections'&&dropCorrection||key==='correction-decisions'&&dropApproval)){
          if(key==='corrections')dropCorrection=false;else dropApproval=false;return route.abort('connectionfailed');
        }
        return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:await response.text()});
      }catch(e){errors.push(String(e));return route.abort();}
    });
    page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(String(e)));page.on('dialog',d=>d.accept());
    const go=async(mode,params={})=>{auth=['review','revision-approval','report'].includes(mode)?owner:p.auth;await page.goto(origin+'/?'+new URLSearchParams({mode,...params}));};
    const posts=key=>requests.filter(r=>r.key===key&&r.method==='POST');
    await go('clock');await page.getByRole('status').filter({hasText:'终端已配对'}).waitFor();
    const actions=[['确认上班','上班'],['确认开始休息','开始休息'],['确认结束休息','结束休息'],['确认下班','下班']];
    for(const [button,label] of actions){
      await page.getByLabel('考勤工号',{exact:true}).fill(p.no);await page.getByLabel('员工 PIN',{exact:true}).fill(p.pin);await page.getByRole('button',{name:'验证并读取／核对原操作',exact:true}).click();
      await page.getByRole('button',{name:button,exact:true}).click();await page.getByRole('status').filter({hasText:'打卡已确认：'+label}).waitFor();
      await page.getByRole('button',{name:'清除资料／下一位',exact:true}).click();
    }
    assert.equal(posts('terminal-clock').length,8);assert.equal(await page.evaluate(()=>sessionStorage.length),0);
    const events=JSON.parse(exec(`select jsonb_agg(jsonb_build_object('id',id,'source',source,'actor',actor_employee_id,'sequence',sequence) order by sequence) from public.merchant_attendance_events where worker_id='${p.worker}';`));
    assert.equal(events.length,4);assert(events.every(e=>e.source==='kiosk'&&e.actor===p.employee));
    const rawBefore=env.raw(),receiptsBefore=env.receipts();
    pass('actual PIN page submits four explicit actions through real handlers, KDF and SQL; all four receipts become same-member kiosk facts without fixture inserts');
    await go('correction');await page.getByRole('heading',{name:'本人申请记录',exact:true}).waitFor();await page.getByRole('button',{name:'选择原始班次',exact:true}).click();
    const history=page.getByRole('region',{name:'本人历史打卡',exact:true});await history.getByLabel('开始日期',{exact:true}).fill(fromDate);await history.getByLabel('结束日期（含当天）',{exact:true}).fill(throughDate);
    await history.getByRole('button',{name:'查询本人记录',exact:true}).click();await history.getByRole('button',{name:'选择本班次申请补正',exact:true}).click();
    await page.getByText('查看完整原始动作（4 条）',{exact:true}).click();assert.equal(await page.locator('ol li').count(),4);assert(!((await page.locator('ol').innerText()).includes('网页打卡')));
    const localTime=v=>correctionTimeControlValue(correctionTimeInput(v,'Europe/Madrid').local).replace(/:00\.000$/,'');
    for(const [label,value] of [['申请上班时间',proposal.startAt],['申请下班时间',proposal.endAt],['休息 1 开始',proposal.breaks[0].startAt],['休息 1 结束',proposal.breaks[0].endAt]])await page.getByLabel(label,{exact:true}).fill(localTime(value));
    await page.getByLabel('申请理由（1～500 字，不含换行）',{exact:true}).fill('本地真实 PIN 班次补正');await page.getByRole('checkbox',{name:/我已核对全部时间/}).check();await page.getByRole('button',{name:'明确提交补正申请',exact:true}).click();
    await page.getByRole('button',{name:'明确用原编号重试',exact:true}).waitFor();assert.equal(posts('corrections').length,1);assert.equal(posts('corrections')[0].status,200);
    await page.reload();await page.getByRole('heading',{name:'已提交 · 未审批',exact:true}).waitFor();assert.equal(posts('corrections').length,1);
    const rid=posts('corrections')[0].operationId;assert(rid);assert.equal(exec(`select count(*) from public.merchant_attendance_correction_entries where request_id='${rid}';`),'1');
    pass('same newly punched session is selected from actual self history, submitted with a 15-minute break, and recovered after lost response by reads only');
    await go('review');await page.getByLabel('提交开始日期',{exact:true}).fill(fromDate);await page.getByLabel('提交结束日期（含）',{exact:true}).fill(throughDate);await page.getByRole('button',{name:'查询申请',exact:true}).click();
    await page.getByRole('article').filter({hasText:p.no}).getByRole('button',{name:'核对差异与冲突',exact:true}).click();await page.getByRole('button',{name:'进入本申请审批',exact:true}).click();
    const form=page.getByRole('form',{name:'确认补正决定'});await form.getByLabel('选择决定',{exact:true}).selectOption('approve');await form.getByRole('textbox',{name:/^决定理由/}).fill('本地链路审批核对');await form.getByRole('checkbox').check();await form.getByRole('button',{name:'确认批准',exact:true}).click();
    await page.getByRole('button',{name:'先查收据，再用原编号重试',exact:true}).waitFor();assert.equal(posts('correction-decisions').length,1);assert.equal(posts('correction-decisions')[0].status,200);
    await page.reload();await page.getByRole('button',{name:'审批操作／恢复待确认',exact:true}).click();await page.getByRole('heading',{name:/已批准 · 独立核定修订/}).waitFor();assert.equal(posts('correction-decisions').length,1);
    assert.equal((await env.report(p)).totals.selected.workedUs,45*60000000);
    pass('actual owner review -> explicit approval commits once; lost approval response recovers original receipt without a second approval and report shows 45 minutes');
    await go('correction');await page.getByRole('button',{name:'查看差异／撤回',exact:true}).click();await page.getByRole('button',{name:'查看当前核定／申请再次修订',exact:true}).click();
    const revision=page.getByRole('form',{name:'提交再次修订'}),revisionEnd=new Date(Date.parse(proposal.endAt)-5*60000).toISOString();
    await revision.getByLabel('修订下班时间',{exact:true}).fill(localTime(revisionEnd));await revision.getByLabel('修订理由（单行 1—500 字）',{exact:true}).fill('本地 PIN 连续修订');await revision.getByRole('checkbox',{name:/我已核对全部时间/}).check();await revision.getByRole('button',{name:'明确提交修订申请',exact:true}).click();
    await page.getByRole('heading',{name:'本次修订 · 待负责人审批',exact:true}).waitFor();assert.equal((await env.report(p)).totals.selected.workedUs,45*60000000);
    const revisionId=posts('revision-requests')[0].operationId;assert(revisionId);
    await go('revision-approval',{request:revisionId});const approve=page.getByRole('form',{name:'确认修订审批'});
    await approve.getByLabel('修订审批决定',{exact:true}).selectOption('approve');await approve.getByRole('textbox',{name:/^修订审批理由/}).fill('本地连续修订批准');await approve.getByRole('checkbox').check();await approve.getByRole('button',{name:'确认批准修订',exact:true}).click();
    await page.getByRole('region',{name:'当前有效核定',exact:true}).getByText(/修订 2/).waitFor();assert.equal((await env.report(p)).totals.selected.workedUs,40*60000000);
    pass('actual employee correction-detail entry opens revision form; pending leaves 45 minutes, explicit owner revision approval selects 40 minutes exactly once');
    await page.setViewportSize({width:390,height:844});await go('report',{from:fromDate,through:throughDate});await page.getByRole('button',{name:'查询含整段漏卡工时',exact:true}).click();
    const panel=page.getByRole('region',{name:'含整段漏卡工时工作区'});await panel.getByRole('status').filter({hasText:'已核对完整可见来源'}).waitFor();
    assert.equal(await panel.getByRole('row',{name:/^工作段/}).getByRole('cell').last().innerText(),'0 小时 40 分 0 秒');assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    const section=page.getByRole('region',{name:'含整段申报的受控导出'});await section.getByRole('checkbox').check();const waiting=page.waitForEvent('download');await section.getByRole('button').click();const download=await waiting;
    try{
      const stream=await download.createReadStream(),chunks=[];assert(stream);let size=0;for await(const chunk of stream){size+=chunk.length;assert(size<4*1024*1024);chunks.push(chunk);}const csv=Buffer.concat(chunks).toString('utf8');
      assert(csv.startsWith('\ufeff"记录类型",'));assert(csv.includes(revisionId));assert.equal(workflowCsvWorkedUs(csv),40*60000000);assert(!csv.includes(people[0].worker));assert.equal(posts('unified-export').length,1);
    }finally{await download.delete();}
    assert.equal(env.raw(),rawBefore);assert.equal(env.receipts(),receiptsBefore);assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert(requests.every(r=>r.status===200));
    const stored=await page.evaluate(()=>Object.values(sessionStorage).join('\n'));assert(!stored.includes(p.pin));assert(!stored.includes(secret));assert.equal(await page.evaluate(()=>localStorage.length),0);
    pass('390px report and actual downloaded CSV contain only final 40 minutes for this employee; download removed and all original facts/receipts unchanged');
    console.log(JSON.stringify({pinWorkflowBrowser:true,productionAccess:false,realAuth:false,realTls:false,clockActions:4,correctionPosts:1,approvalPosts:1,revisionPosts:1,revisionApprovalPosts:1,exports:1,persistentArtifacts:false}));
  }catch(e){if(page)console.error(JSON.stringify({statuses:await page.getByRole('status').allTextContents(),requests,errors}));throw e;}
  finally{await browser?.close();if(child.exitCode===null){const ended=once(child,'exit');child.kill();await ended;}}
}
await runAttendanceLabelsReuse(process.argv.slice(2),native=>checkPinWorkflow(native,browserCheck));
