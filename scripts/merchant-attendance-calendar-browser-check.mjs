// Real calendar launcher/client and default handlers/SDK against an owned
// synthetic SQL namespace. No real Auth, Next proxy, phone or production.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import net from 'node:net';
import {chromium} from 'playwright';
import {runAttendanceLabelsReuse} from './merchant-attendance-choice-labels-reuse-native.mjs';
import {withAttendanceConcurrencySandbox} from './merchant-attendance-concurrency-sandbox.mjs';
import {prepareCalendarNativeFixture} from './merchant-attendance-calendar-native.mjs';
import {runAttendanceCleanupSteps} from './fixtures/attendance-cleanup.mjs';

const require=createRequire(import.meta.url);
const {withAttendanceApplicationAuth}=require('./fixtures/attendance-application-auth.ts');
const {handleCalendar}=require('../src/app/api/merchant-enterprise/attendance/calendar/route-handler.ts');
const {handleAttendanceAdmin}=require('../src/app/api/merchant-enterprise/attendance/admin/route-handler.ts');
const {requireMerchantEnterpriseEntitlement}=require('../src/lib/merchantEnterpriseAuth.server.ts');
const {MERCHANT_AUTH_COOKIE}=require('../src/lib/merchantAuthSession.ts');
const origin='https://127.0.0.1:3131',staticOrigin='http://127.0.0.1:3131',canonical='https://www.faolla.com';
const prefix='/api/merchant-enterprise/attendance/',localFetch=globalThis.fetch;
const literal=value=>value===null?'null':"'"+String(value).replaceAll("'","''")+"'";
const json=value=>value===null?'null':literal(JSON.stringify(value))+'::jsonb';
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
const bounded=async promise=>{let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('calendar_browser_timeout')),20000);})]);}finally{clearTimeout(timer);}};

export async function checkAttendanceCalendarBrowser(native,scope){
  const data=await prepareCalendarNativeFixture(native,scope),protectedBefore=data.protectedFingerprint();
  const counts=()=>JSON.parse(data.exec(`select jsonb_build_object(
    'entries',(select count(*)::integer from public.merchant_attendance_calendar_entries),
    'operations',(select count(*)::integer from public.merchant_attendance_calendar_operations));`));
  const actor={id:data.owner,email:'calendar-owner@example.test'},requests=[],errors=[],pending=new Set(),gates=new Set();
  let closing=false,browser,hold=null,loseSuccessfulPost=false,moduleEnabled=true,phase='harness';
  const adminSource=readFileSync(path.join(native.root,'src/components/enterprise/MerchantAttendanceAdminPanel.tsx'),'utf8');
  const launcherSource=readFileSync(path.join(native.root,'src/components/enterprise/MerchantAttendanceCalendarLauncher.tsx'),'utf8');
  const panelSource=readFileSync(path.join(native.root,'src/components/enterprise/MerchantAttendanceCalendarPanel.tsx'),'utf8');
  assert(adminSource.includes('<CalendarLauncher siteId={siteId} ownerId={ownerId}'));
  assert(launcherSource.includes('process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_CALENDAR_ENABLED === "1"'));
  assert(launcherSource.includes('if (!enabled || !active) return null'));
  assert(!panelSource.includes('merchantBookings'));
  const probe=net.createServer();
  await new Promise((resolve,reject)=>{probe.once('error',reject);probe.listen(3131,'127.0.0.1',resolve);});
  await new Promise(resolve=>probe.close(resolve));
  const child=spawn(process.execPath,['scripts/attendance-self-browser-harness.mjs','--calendar'],{cwd:native.root,windowsHide:true,stdio:['ignore','pipe','pipe']});
  child.stderr.on('data',()=>errors.push('harness_stderr'));
  const rpc=async(name,args)=>{
    let params;
    if(name==='faolla_attendance_calendar_v1'){
      assert.equal(args.p_auth_user_id,data.owner);assert.equal(args.p_query.siteId,data.site);
      assert.deepEqual(Object.keys(args).sort(),['p_allow_write','p_auth_user_id','p_command','p_query']);
      params=[json(args.p_query),literal(args.p_auth_user_id),json(args.p_command),String(args.p_allow_write)];
    }else{
      assert.equal(name,'faolla_attendance_admin_v1');assert.equal(args.p_site_id,data.site);assert.equal(args.p_auth_user_id,data.owner);
      assert.equal(args.p_command,null);assert.equal(args.p_operation_id,null);
      params=[literal(args.p_site_id),literal(args.p_auth_user_id),json(args.p_query),'null','null'];
    }
    try{
      const response=JSON.parse(data.exec(`set local role service_role;select jsonb_build_object('role',current_user,'data',
        public.${name}(${params.join(',')}));`));
      assert.equal(response.role,'service_role');return {data:response.data,error:null};
    }catch(error){
      const code=String(error).match(/ERROR:\s+(attendance_[a-z_]+)/)?.[1];if(!code)throw error;
      return {data:null,error:{message:code}};
    }
  };
  try{
    await bounded(new Promise((resolve,reject)=>{let output='';child.stdout.on('data',chunk=>{output+=String(chunk);if(output.includes('Attendance synthetic component QA'))resolve();});
      child.once('error',()=>reject(Error('harness_failed')));child.once('exit',()=>reject(Error('harness_exited')));}));
    browser=await chromium.launch({headless:true});
    await withAttendanceApplicationAuth([actor],rpc,async auth=>{
      const entitlement=siteId=>requireMerchantEnterpriseEntitlement(siteId,async()=>[{id:data.site,permissionConfig:{allowEnterpriseManagement:true,allowEmployeeAttendance:moduleEnabled}}]);
      const context=await browser.newContext({viewport:{width:1280,height:1100},serviceWorkers:'block',acceptDownloads:false});
      await context.addCookies([{name:MERCHANT_AUTH_COOKIE,value:await auth.login(actor),url:origin,secure:true,httpOnly:true,sameSite:'Lax'}]);
      await context.addInitScript(()=>sessionStorage.setItem('qa-unrelated-calendar','preserve'));
      await context.route('**/*',route=>{
        if(closing)return route.abort().catch(()=>{});
        const work=(async()=>{
          const request=route.request(),url=new URL(request.url());assert.equal(url.origin,origin);
          if(['/', '/harness.js','/harness.css'].includes(url.pathname)){
            assert.equal(request.method(),'GET');const response=await localFetch(staticOrigin+url.pathname);
            return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});
          }
          const key=url.pathname.slice(prefix.length),handlers={calendar:handleCalendar,admin:handleAttendanceAdmin};
          assert.equal(url.pathname,prefix+key);assert(Object.hasOwn(handlers,key));assert(['GET','POST'].includes(request.method()));
          if(key==='admin')assert.equal(request.method(),'GET');
          const headers=new Headers(await request.allHeaders());assert(headers.get('cookie')?.includes(MERCHANT_AUTH_COOKIE+'='));assert.equal(headers.get('x-merchant-access-token'),null);
          headers.set('host','www.faolla.com');headers.set('referer',canonical+'/');if(headers.has('origin'))headers.set('origin',canonical);
          const response=await handlers[key](new Request(canonical+url.pathname+url.search,{method:request.method(),headers,body:request.postData()??undefined}),{enabled:()=>true,entitlement});
          const body=await response.text(),parsed=JSON.parse(body);requests.push({key,method:request.method(),status:response.status,search:url.search});
          if(key==='calendar'&&request.method()==='POST'&&response.status===200&&loseSuccessfulPost){loseSuccessfulPost=false;return route.abort('failed');}
          const gate=key==='calendar'&&request.method()==='GET'?hold:null;
          if(gate){hold=null;gate.ready.resolve(parsed);await gate.release.promise;}
          try{await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body});}
          finally{if(gate){gate.finished.resolve();gates.delete(gate);}}
        })();pending.add(work);void work.finally(()=>pending.delete(work)).catch(()=>{});
        return work.catch(async()=>{if(!closing&&!route.request().failure())errors.push('route_failed');await route.abort().catch(()=>{});});
      });
      const page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',()=>errors.push('page_error'));page.on('dialog',dialog=>dialog.accept());
      const panel=()=>page.getByRole('region',{name:'节假日／停业日（仅提示）',exact:true});
      const scopePanel=()=>panel().getByRole('region',{name:'日历范围',exact:true});
      const calendarRequests=()=>requests.filter(item=>item.key==='calendar').length;
      const calendarPosts=()=>requests.filter(item=>item.key==='calendar'&&item.method==='POST').length;
      const chooseLocation=async(name,label)=>{
        await panel().getByLabel('日历地点搜索',{exact:true}).fill(name);
        await panel().getByRole('button',{name:'搜索工作地点',exact:true}).click();
        const option=panel().getByRole('button',{name:label,exact:true});await option.waitFor();await option.click();
      };
      try{
        phase='enterprise-context-empty-list';
        await page.goto(origin+'/?'+new URLSearchParams({siteId:data.site,ownerId:data.owner}));
        assert.equal(calendarRequests(),0);
        await page.getByRole('button',{name:'节假日／停业日（仅提示）',exact:true}).click();await panel().waitFor();
        await panel().getByRole('heading',{name:'企业日历',exact:true}).waitFor();
        await scopePanel().getByText(/权威时区：UTC/).waitFor();
        assert.equal(calendarRequests(),1);assert.deepEqual(counts(),{entries:0,operations:0});assert.equal(await page.locator('form form').count(),0);
        await panel().getByLabel('日历开始日期',{exact:true}).fill(data.fromDate);
        await panel().getByLabel('日历结束日期',{exact:true}).fill(data.throughDate);
        await panel().getByRole('button',{name:'查询日历提示',exact:true}).click();
        await panel().getByText('本页没有匹配提示；不代表没有排班、预约或法定假日。',{exact:true}).waitFor();
        assert.equal(calendarPosts(),0);assert.equal(data.protectedFingerprint(),protectedBefore);
        native.pass('actual default-off launcher explicitly reads enterprise UTC context then an empty bounded date page without writes or nested forms');

        phase='location-create-lost-success';
        await chooseLocation('合成日历地点','合成日历地点 · Europe/Madrid · 启用');
        await panel().getByRole('heading',{name:'地点日历：合成日历地点',exact:true}).waitFor();
        await scopePanel().getByText(/权威时区：Europe\/Madrid/).waitFor();
        await panel().getByLabel('日历提示类型',{exact:true}).selectOption('closure');
        await panel().getByLabel('日历提示标题',{exact:true}).fill('合成地点停业提示');
        await panel().getByLabel('提示开始日期',{exact:true}).fill(data.fromDate);
        await panel().getByLabel('提示结束日期',{exact:true}).fill(data.throughDate);
        await panel().getByRole('button',{name:'生成日历提示预览',exact:true}).click();
        const preview=panel().getByRole('region',{name:'日历提示预览',exact:true});await preview.waitFor();
        await preview.getByText(new RegExp(`${data.fromDate}.*${data.throughDate}.*Europe/Madrid`)).waitFor();
        await panel().getByLabel('日历提示创建原因',{exact:true}).fill('负责人明确记录合成停业范围');
        await panel().getByRole('checkbox',{name:/我已核对范围、当地日期、时区、类型和原因/}).check();
        loseSuccessfulPost=true;await panel().getByRole('button',{name:'明确创建日历提示',exact:true}).click();
        await panel().getByRole('button',{name:'用原编号明确重试',exact:true}).waitFor();
        assert.equal(calendarPosts(),1);assert.deepEqual(counts(),{entries:1,operations:1});
        const storageKey=`faolla:attendance:calendar:v1:${data.site}:${data.owner}`;
        const stored=JSON.parse(await page.evaluate(key=>sessionStorage.getItem(key),storageKey));
        assert.equal(stored.ownerId,data.owner);assert.equal(stored.query.locationId,data.locationId);assert.equal(stored.command.action,'create');
        assert.equal(stored.command.timeZone,'Europe/Madrid');assert.equal(stored.command.expectedLocationVersion,1);
        assert.equal(data.protectedFingerprint(),protectedBefore);
        native.pass('explicit active-location context binds its authoritative Madrid zone/version; one confirmed create survives a lost200 as one pending original operation');

        phase='paused-original-receipt';moduleEnabled=false;
        await page.getByRole('button',{name:'卸载测试日历页',exact:true}).click();await panel().waitFor({state:'detached'});
        await page.getByRole('button',{name:'重挂测试日历页',exact:true}).click();
        await page.getByRole('button',{name:'节假日／停业日（仅提示）',exact:true}).click();await panel().waitFor();
        await panel().getByRole('region',{name:'日历操作收据',exact:true}).waitFor();
        assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),storageKey),null);assert.equal(calendarPosts(),1);
        const pausedCancel=panel().getByRole('button',{name:'明确取消日历提示',exact:true});assert.equal(await pausedCancel.isDisabled(),true);
        const beforeDisabled=calendarPosts();await pausedCancel.evaluate(button=>button.click());assert.equal(calendarPosts(),beforeDisabled);
        assert(requests.some(item=>item.key==='calendar'&&item.method==='GET'&&item.search.includes(`operationId=${stored.command.operationId}`)));
        assert.equal(await page.evaluate(()=>sessionStorage.getItem('qa-unrelated-calendar')),'preserve');assert.equal(data.protectedFingerprint(),protectedBefore);
        native.pass('lost create remount while paused resolves only its original receipt by GET, clears exact pending storage and cannot issue a second write');

        phase='enterprise-reset-location-cancel';moduleEnabled=true;
        await panel().getByRole('button',{name:'重新读取企业日历',exact:true}).click();
        await panel().getByRole('heading',{name:'企业日历',exact:true}).waitFor();
        await scopePanel().getByText(/权威时区：UTC/).waitFor();
        await chooseLocation('合成日历地点','合成日历地点 · Europe/Madrid · 启用');
        await panel().getByLabel('日历开始日期',{exact:true}).fill(data.fromDate);
        await panel().getByLabel('日历结束日期',{exact:true}).fill(data.throughDate);
        await panel().getByRole('button',{name:'查询日历提示',exact:true}).click();
        await panel().getByRole('button',{name:'查看日历提示详情',exact:true}).click();
        const detail=panel().getByRole('article',{name:'日历提示详情',exact:true});await detail.waitFor();
        await detail.getByText('创建原因：负责人明确记录合成停业范围',{exact:true}).waitFor();
        await panel().getByLabel('日历提示取消原因',{exact:true}).fill('负责人明确取消合成提示');
        await panel().getByRole('checkbox',{name:/我确认只取消这条提示并保留历史/}).check();
        await panel().getByRole('button',{name:'明确取消日历提示',exact:true}).click();
        await detail.getByText(/取消原因：负责人明确取消合成提示/).waitFor();
        assert.equal(calendarPosts(),2);assert.deepEqual(counts(),{entries:1,operations:2});assert.equal(data.protectedFingerprint(),protectedBefore);
        native.pass('fresh initialize resets to enterprise context; explicit location list/detail then revision-checked cancel preserves one historical record and old business facts');

        phase='inactive-and-mobile';
        await panel().getByRole('button',{name:'返回日期查询首页',exact:true}).click();
        await chooseLocation('合成停用地点','合成停用地点 · UTC · 停用（不再新增）');
        await panel().getByText('该地点当前不可新增提示；仍可查询历史，并以每条详情显示的当前能力为准。',{exact:true}).waitFor();
        const createButton=panel().getByRole('button',{name:'明确创建日历提示',exact:true});assert.equal(await createButton.isDisabled(),true);
        const beforeInactive=calendarPosts();await createButton.evaluate(button=>button.click());assert.equal(calendarPosts(),beforeInactive);
        await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
        assert.equal(data.protectedFingerprint(),protectedBefore);
        native.pass('inactive scope is visibly non-creating, cannot POST even through DOM click, and the actual owner panel has no horizontal overflow at390px');

        phase='held-hide-unmount';
        const gate={ready:deferred(),release:deferred(),finished:deferred()};gates.add(gate);hold=gate;
        await panel().getByRole('button',{name:'重新读取企业日历',exact:true}).click();const held=await bounded(gate.ready.promise);assert.equal(held.ok,true);
        await page.getByRole('button',{name:'隐藏日历入口',exact:true}).click();await panel().waitFor({state:'detached'});
        gate.release.resolve();await bounded(gate.finished.promise);
        const beforeShow=calendarRequests();await page.getByRole('button',{name:'显示日历入口',exact:true}).click();
        await page.getByRole('button',{name:'节假日／停业日（仅提示）',exact:true}).waitFor();assert.equal(calendarRequests(),beforeShow);
        assert.equal(await page.getByText('合成地点停业提示',{exact:true}).count(),0);
        await page.getByRole('button',{name:'卸载测试日历页',exact:true}).click();
        await page.getByRole('button',{name:'重挂测试日历页',exact:true}).click();assert.equal(calendarRequests(),beforeShow);
        assert.deepEqual(errors,[]);assert.equal(data.protectedFingerprint(),protectedBefore);
        native.pass('a held actual SQL GET cannot repopulate hidden or unmounted calendar UI; a fresh closed launcher performs no automatic late read');
        console.log(JSON.stringify({calendarBrowser:true,browserChecks:6,calendarPosts:calendarPosts(),counts:counts(),syntheticAuth:true,
          realAuthService:false,realNextServer:false,realPhone:false,productionAccess:false,screenshots:false,recordings:false}));
      }finally{
        closing=true;for(const gate of gates)gate.release.resolve();
        await runAttendanceCleanupSteps([{name:'calendar-browser',run:()=>browser?.close()},{name:'calendar-routes',run:()=>Promise.allSettled([...pending])}]);
      }
    });
  }catch(error){
    console.error(JSON.stringify({calendarBrowserFailed:true,phase,sourceLine:String(error?.stack??'').match(/calendar-browser-check\.mjs:(\d+):/)?.[1]??null,errors,requestCount:requests.length}));
    throw Error('calendar_browser_failed');
  }finally{
    closing=true;for(const gate of gates)gate.release.resolve();
    await runAttendanceCleanupSteps([{name:'browser',run:()=>browser?.close()},{name:'routes',run:()=>Promise.allSettled([...pending])},
      {name:'harness',timeoutMs:10000,run:async()=>{if(child.pid!==undefined&&child.exitCode===null&&child.signalCode===null){const stopped=once(child,'exit');child.kill();await stopped;}}}]);
  }
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  await runAttendanceLabelsReuse(process.argv.slice(2),native=>withAttendanceConcurrencySandbox(native,scope=>checkAttendanceCalendarBrowser(native,scope)))
    .catch(()=>{console.error('calendar_browser_failed');process.exitCode=1;});
}
