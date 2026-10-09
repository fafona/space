// No real credentials, public internet, screenshots, stored exports or production data.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createRequire} from 'node:module';
import net from 'node:net';
import {chromium} from 'playwright';
import {runAttendanceLabelsReuse} from './merchant-attendance-choice-labels-reuse-native.mjs';
import {checkEventChannels} from './merchant-attendance-event-channels-native.mjs';
const require=createRequire(import.meta.url);
const handlers=Object.fromEntries([
  ['event-channels','handleEventChannels','merchantAttendanceEventChannels','executeEventChannels'],
  ['history','handleAttendanceHistory','merchantAttendanceHistory','executeAttendanceHistory'],
  ['corrections/context','handleCorrectionContext','merchantAttendanceSelfContext','executeAttendanceSelfContext'],
  ['corrections','handleAttendanceCorrection','merchantAttendanceCorrection','executeAttendanceCorrection'],
  ['correction-reviews','handleCorrectionReview','merchantAttendanceCorrectionReview','executeCorrectionReview'],
  ['unified-timesheet','handleUnifiedTimesheet','merchantAttendanceUnifiedTimesheet','executeUnifiedTimesheet'],
].map(([route,handler,module,executor])=>[route,[require(`../src/app/api/merchant-enterprise/attendance/${route}/route-handler.ts`)[handler],require(`../src/lib/${module}.server.ts`)[executor]]]));
async function browserCheck(env){
  const {root,exec,owner,p,service,pass,fromDate,throughDate}=env;
  const origin='https://attendance.synthetic.test',local='http://127.0.0.1:3131',canonical='https://www.faolla.com';
  const probe=net.createServer();await new Promise((resolve,reject)=>{probe.once('error',reject);probe.listen(3131,'127.0.0.1',resolve);});await new Promise(resolve=>probe.close(resolve));
  const child=spawn(process.execPath,['scripts/attendance-self-browser-harness.mjs','--event-channels'],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});
  let browser,page,auth=p.auth;const errors=[],external=[],requests=[];
  try{
    await new Promise((resolve,reject)=>{let out='';const timer=setTimeout(()=>reject(Error('event_channels_harness_timeout')),20000);child.stdout.on('data',v=>{out+=v;if(out.includes('Attendance synthetic component QA')){clearTimeout(timer);resolve();}});child.stderr.on('data',v=>errors.push(String(v)));child.once('exit',code=>{clearTimeout(timer);reject(Error('event_channels_harness_exit_'+code));});});
    browser=await chromium.launch({headless:true});const context=await browser.newContext({viewport:{width:1200,height:1000},serviceWorkers:'block'});
    await context.route('**/*',async route=>{
      const request=route.request(),url=new URL(request.url());if(url.origin!==origin){external.push(url.origin);return route.abort();}
      if(!url.pathname.startsWith('/api/')){assert(['/','/harness.js','/harness.css'].includes(url.pathname));return route.fulfill({response:await context.request.get(local+url.pathname)});}
      try{
        const key=url.pathname.replace('/api/merchant-enterprise/attendance/',''),pair=handlers[key];assert(pair);
        const headers=new Headers(await request.allHeaders());if(headers.get('origin')===origin)headers.set('origin',canonical);headers.set('host','www.faolla.com');if(headers.get('referer')?.startsWith(origin))headers.set('referer',canonical+'/');
        const req=new Request(canonical+url.pathname+url.search,{method:request.method(),headers,body:request.postData()??undefined});
        const deps={enabled:()=>true,allow:()=>true,accessEnabled:()=>true,authenticate:async()=>({user:{id:auth},accessToken:'synthetic',authenticationMethods:['password']}),entitlement:async()=>({permissionConfig:{allowEnterpriseManagement:true,allowEmployeeAttendance:true}})};
        assert(request.method()==='GET'||key==='event-channels','browser_test_is_read_only');
        const response=await pair[0](req,{...deps,execute:i=>pair[1](i,service)});requests.push({key,status:response.status});
        return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:await response.text()});
      }catch(e){errors.push(String(e));return route.abort();}
    });
    page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(String(e)));
    const go=async mode=>{auth=mode==='report'||mode==='review'?owner:p.auth;await page.goto(origin+'/?'+new URLSearchParams({mode,from:fromDate,through:throughDate}));};
    const count=()=>requests.filter(r=>r.key==='event-channels').length;
    const open=async(parent,expected)=>{
      const before=count();await parent.getByRole('button',{name:`核对详细打卡通路（${expected} 条）`,exact:true}).click();
      const panel=parent.getByRole('region',{name:'详细打卡通路',exact:true});await panel.getByRole('button',{name:`读取本批通路（${expected} 条）`,exact:true}).waitFor();assert.equal(count(),before);
      await panel.getByRole('button',{name:`读取本批通路（${expected} 条）`,exact:true}).click();await panel.getByRole('status').filter({hasText:'本批原始打卡通路已核对'}).waitFor();
      assert.equal(count(),before+1);assert.equal(await panel.locator('li').count(),expected);return panel;
    };
    const dates=async panel=>{await panel.getByLabel('开始日期',{exact:true}).fill(fromDate);await panel.getByLabel('结束日期（含当天）',{exact:true}).fill(throughDate);await panel.getByRole('button',{name:'查询本人记录',exact:true}).click();};
    await go('history');const history=page.getByRole('region',{name:'本人历史打卡',exact:true});await dates(history);
    await history.getByRole('button',{name:'核对详细打卡通路（8 条）',exact:true}).waitFor();assert.equal(count(),0);
    let panel=await open(history,8);assert.equal(await panel.locator('li').filter({hasText:'现场动态码 · 手机提交'}).count(),2);assert.equal(await panel.locator('li').filter({hasText:'网页通路（非现场动态码）'}).count(),3);assert.equal(await panel.locator('li').filter({hasText:'终端打卡'}).count(),3);
    pass('actual history component does not auto-query provenance; one explicit batch displays 2 QR, 3 other-web, 3 terminal events from real SQL');
    exec(`update public.merchant_enterprise_employees set status='disabled' where id='${p.employee}';`);
    try{await panel.getByRole('button',{name:'读取本批通路（8 条）',exact:true}).click();await panel.getByRole('status').filter({hasText:'当前权限不能查看本批'}).waitFor();assert.equal(await panel.locator('li').count(),0);}
    finally{exec(`update public.merchant_enterprise_employees set status='active' where id='${p.employee}';`);}
    await panel.getByRole('button',{name:'关闭通路核对',exact:true}).click();panel=await open(history,8);
    const posts=count();await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide')));await panel.getByRole('status').filter({hasText:'已清除通路详情'}).waitFor();assert.equal(await panel.locator('li').count(),0);assert.equal(count(),posts);
    pass('current member revocation clears visible details on denied refresh; close/reopen and pagehide discard evidence without automatic retry');
    await go('correction');await page.getByRole('button',{name:'选择原始班次',exact:true}).click();const picker=page.getByRole('region',{name:'本人历史打卡',exact:true});await dates(picker);
    await picker.getByRole('button',{name:'选择本班次申请补正',exact:true}).first().click();panel=await open(page,4);
    assert.equal(await panel.locator('li').filter({hasText:'现场动态码 · 手机提交'}).count(),2);assert.equal(await panel.locator('li').filter({hasText:'网页通路（非现场动态码）'}).count(),1);
    pass('actual self-correction original-session selection shares the same readonly QR/web/terminal attribution without submitting an application');
    await go('review');await page.getByRole('button',{name:'查询申请',exact:true}).click();await page.locator('article').filter({hasText:p.no}).getByRole('button',{name:'核对差异与冲突',exact:true}).click();panel=await open(page,4);assert.equal(await panel.locator('li').filter({hasText:'终端打卡'}).count(),2);
    pass('actual owner correction review checks submitted original basis through the independently authorized owner channel reader');
    await page.setViewportSize({width:390,height:844});await go('report');await page.getByRole('button',{name:'查询含整段漏卡工时',exact:true}).click();panel=await open(page,8);assert.equal(await panel.locator('li').filter({hasText:'现场动态码 · 手机提交'}).count(),2);
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.equal(await page.evaluate(()=>localStorage.length+sessionStorage.length),0);
    assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert.equal(requests.filter(r=>r.status===403).length,1);assert(requests.every(r=>[200,403].includes(r.status)));
    pass('390px actual unified report uses one bounded source batch, no overflow/storage/external requests and no business writes');
    console.log(JSON.stringify({eventChannelsBrowser:true,productionAccess:false,realAuth:false,realTls:false,persistentArtifacts:false,channelRequests:count()}));
  }catch(e){if(page)console.error(JSON.stringify({statuses:await page.getByRole('status').allTextContents(),requests,errors}));throw e;}
  finally{await browser?.close();if(child.exitCode===null){const ended=once(child,'exit');child.kill();await ended;}}
}
await runAttendanceLabelsReuse(process.argv.slice(2),native=>checkEventChannels(native,browserCheck));
