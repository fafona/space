// Actual leave decision + notification launchers, default handlers/SDK and
// owned synthetic SQL. No production, real Auth service, Next server or push.
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
import {prepareLeaveNotificationsNativeFixture} from './merchant-attendance-leave-notifications-native.mjs';
import {runAttendanceCleanupSteps} from './fixtures/attendance-cleanup.mjs';

const require=createRequire(import.meta.url);
const {withAttendanceApplicationAuth}=require('./fixtures/attendance-application-auth.ts');
const {handleLeave}=require('../src/app/api/merchant-enterprise/attendance/leave/route-handler.ts');
const {handleLeaveNotifications}=require('../src/app/api/merchant-enterprise/attendance/leave-notifications/route-handler.ts');
const {requireMerchantEnterpriseEntitlement}=require('../src/lib/merchantEnterpriseAuth.server.ts');
const {MERCHANT_AUTH_COOKIE}=require('../src/lib/merchantAuthSession.ts');
const origin='https://127.0.0.1:3131',staticOrigin='http://127.0.0.1:3131',canonical='https://www.faolla.com';
const prefix='/api/merchant-enterprise/attendance/',localFetch=globalThis.fetch;
const literal=value=>"'"+String(value).replaceAll("'","''")+"'",json=value=>value===null?'null':literal(JSON.stringify(value))+'::jsonb';
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
const bounded=async promise=>{let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('leave_notifications_browser_timeout')),20000);})]);}finally{clearTimeout(timer);}};

export async function checkAttendanceLeaveNotificationsBrowser(native,scope){
  const flag='FAOLLA_ATTENDANCE_LEAVE_NOTIFICATIONS_ENABLED',savedFlag=process.env[flag];
  process.env[flag]='1';
  let closing=false,browser,child,hold=null,loseSuccessfulReadPost=false,moduleEnabled=true,phase='fixture';
  const requests=[],rpcCalls=[],errors=[],pending=new Set(),gates=new Set(),contexts=new Set();
  try{
    const data=await prepareLeaveNotificationsNativeFixture(native,scope);
    assert.notEqual(data.employeeAuth,data.employeeId,'employee record UUID must differ from Auth UUID');
    const protectedBefore=data.protectedFingerprint();
    const counts=()=>JSON.parse(data.exec(`select jsonb_build_object(
      'requests',(select count(*)::integer from public.merchant_attendance_leave_requests),
      'entries',(select count(*)::integer from public.merchant_attendance_leave_entries),
      'notifications',(select count(*)::integer from public.merchant_attendance_leave_notifications),
      'reads',(select count(*)::integer from public.merchant_attendance_leave_notification_reads));`));
    const submission=data.submit(7301,{reason:'合成结果通知申请'});
    const submitted=data.call(data.queryInput('self'),submission,true,data.employeeAuth);
    assert.equal(submitted.detail.status,'submitted');
    assert.deepEqual(counts(),{requests:1,entries:1,notifications:0,reads:0});
    const selfActor={id:data.employeeAuth,email:'leave-notice-employee@example.test'},ownerActor={id:data.owner,email:'leave-notice-owner@example.test'};
    const selfSource=readFileSync(path.join(native.root,'src/components/enterprise/MerchantAttendanceSelfPanel.tsx'),'utf8');
    const launcherSource=readFileSync(path.join(native.root,'src/components/enterprise/MerchantAttendanceLeaveNotificationsLauncher.tsx'),'utf8');
    const executorSource=readFileSync(path.join(native.root,'src/lib/merchantAttendanceLeave.server.ts'),'utf8');
    assert(selfSource.includes('<LeaveNotificationsLauncher siteId={siteId} employeeId={employeeId}'));
    assert(launcherSource.includes('process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_LEAVE_NOTIFICATIONS_ENABLED === "1"'));
    assert(launcherSource.includes('if (!enabled || !active) return null'));
    assert(executorSource.includes('faolla_attendance_leave_notify_v1'));
    const probe=net.createServer();await new Promise((resolve,reject)=>{probe.once('error',reject);probe.listen(3131,'127.0.0.1',resolve);});await new Promise(resolve=>probe.close(resolve));
    child=spawn(process.execPath,['scripts/attendance-self-browser-harness.mjs','--leave-notifications'],{cwd:native.root,windowsHide:true,stdio:['ignore','pipe','pipe']});
    child.stderr.on('data',()=>errors.push('harness_stderr'));
    const rpc=async(name,args)=>{
      assert(['faolla_attendance_leave_v1','faolla_attendance_leave_notify_v1','faolla_attendance_leave_notifications_v1'].includes(name));
      assert([data.employeeAuth,data.owner].includes(args.p_auth_user_id));assert.equal(args.p_query.siteId,data.site);
      assert.deepEqual(Object.keys(args).sort(),['p_allow_write','p_auth_user_id','p_command','p_query']);
      rpcCalls.push({name,actor:args.p_auth_user_id,action:args.p_command?.action??null});
      try{
        const reply=JSON.parse(data.exec(`set local role service_role;select jsonb_build_object('role',current_user,'data',
          public.${name}(${json(args.p_query)},${literal(args.p_auth_user_id)},${json(args.p_command)},${String(args.p_allow_write)}));`));
        assert.equal(reply.role,'service_role');return {data:reply.data,error:null};
      }catch(error){
        const code=String(error).match(/ERROR:\s+(attendance_[a-z_]+)/)?.[1];if(!code)throw error;
        return {data:null,error:{message:code}};
      }
    };
    await bounded(new Promise((resolve,reject)=>{let output='';child.stdout.on('data',chunk=>{output+=String(chunk);if(output.includes('Attendance synthetic component QA'))resolve();});
      child.once('error',()=>reject(Error('harness_failed')));child.once('exit',()=>reject(Error('harness_exited')));}));
    browser=await chromium.launch({headless:true});
    await withAttendanceApplicationAuth([selfActor,ownerActor],rpc,async auth=>{
      const entitlement=siteId=>requireMerchantEnterpriseEntitlement(siteId,async()=>[{id:data.site,permissionConfig:{allowEnterpriseManagement:true,allowEmployeeAttendance:moduleEnabled}}]);
      const createPage=async(actor,search)=>{
        const context=await browser.newContext({viewport:{width:1280,height:1050},serviceWorkers:'block',acceptDownloads:false});contexts.add(context);
        await context.addCookies([{name:MERCHANT_AUTH_COOKIE,value:await auth.login(actor),url:origin,secure:true,httpOnly:true,sameSite:'Lax'}]);
        await context.addInitScript(()=>sessionStorage.setItem('qa-unrelated-leave-notifications','preserve'));
        await context.route('**/*',route=>{
          if(closing)return route.abort().catch(()=>{});
          const work=(async()=>{
            const request=route.request(),url=new URL(request.url());assert.equal(url.origin,origin);
            if(['/', '/harness.js','/harness.css'].includes(url.pathname)){
              assert.equal(request.method(),'GET');const response=await localFetch(staticOrigin+url.pathname);
              return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});
            }
            const key=url.pathname.slice(prefix.length),handlers={leave:handleLeave,'leave-notifications':handleLeaveNotifications};
            assert.equal(url.pathname,prefix+key);assert(Object.hasOwn(handlers,key));assert(['GET','POST'].includes(request.method()));
            const headers=new Headers(await request.allHeaders());assert(headers.get('cookie')?.includes(MERCHANT_AUTH_COOKIE+'='));assert.equal(headers.get('x-merchant-access-token'),null);
            headers.set('host','www.faolla.com');headers.set('referer',canonical+'/');if(headers.has('origin'))headers.set('origin',canonical);
            const response=await handlers[key](new Request(canonical+url.pathname+url.search,{method:request.method(),headers,body:request.postData()??undefined}),{enabled:()=>true,entitlement});
            const body=await response.text(),parsed=JSON.parse(body);requests.push({key,actor:actor.id,method:request.method(),status:response.status,search:url.search});
            if(key==='leave-notifications'&&request.method()==='POST'&&response.status===200&&loseSuccessfulReadPost){loseSuccessfulReadPost=false;return route.abort('failed');}
            const gate=key==='leave-notifications'&&request.method()==='GET'?hold:null;
            if(gate){hold=null;gate.ready.resolve(parsed);await gate.release.promise;}
            try{await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body});}
            finally{if(gate){gate.finished.resolve();gates.delete(gate);}}
          })();pending.add(work);void work.finally(()=>pending.delete(work)).catch(()=>{});
          return work.catch(async()=>{if(!closing&&!route.request().failure())errors.push('route_failed');await route.abort().catch(()=>{});});
        });
        const page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',()=>errors.push('page_error'));page.on('dialog',dialog=>dialog.accept());
        await page.goto(origin+'/?'+new URLSearchParams(search));return {context,page};
      };
      const notificationRequests=(method=null)=>requests.filter(item=>item.key==='leave-notifications'&&(!method||item.method===method));
      try{
        phase='closed-zero-read-and-owner-decisions';
        const self=await createPage(selfActor,{siteId:data.site,access:'self',employeeId:data.employeeId});
        assert.equal(notificationRequests().length,0);await self.page.getByRole('button',{name:'请假结果通知',exact:true}).waitFor();
        const owner=await createPage(ownerActor,{siteId:data.site,access:'owner',actorId:data.owner});
        const ownerPanel=()=>owner.page.getByRole('region',{name:'请假申请审批',exact:true});
        const ownerDetail=()=>ownerPanel().getByRole('article',{name:'请假申请详情',exact:true});
        await owner.page.getByRole('button',{name:'请假申请审批',exact:true}).click();await ownerPanel().waitFor();
        await ownerPanel().getByRole('button',{name:'查看申请详情',exact:true}).click();await ownerDetail().waitFor();
        await ownerPanel().getByLabel(/^决定理由/).fill('负责人批准并生成站内结果通知');
        await ownerPanel().getByRole('checkbox',{name:/我已核对申请人、时段、时区、当前状态/}).check();
        await ownerPanel().getByRole('button',{name:'明确批准请假申请',exact:true}).click();await ownerDetail().getByRole('heading',{name:/已批准/}).waitFor();
        assert.deepEqual(counts(),{requests:1,entries:2,notifications:1,reads:0});
        await ownerPanel().getByLabel(/^决定理由/).fill('负责人取消批准并保留独立结果');
        await ownerPanel().getByRole('checkbox',{name:/我已核对申请人、时段、时区、当前状态/}).check();
        await ownerPanel().getByRole('button',{name:'明确取消已批准请假',exact:true}).click();await ownerDetail().getByRole('heading',{name:/已取消/}).waitFor();
        assert.deepEqual(counts(),{requests:1,entries:3,notifications:2,reads:0});
        assert.deepEqual(rpcCalls.filter(call=>call.name==='faolla_attendance_leave_notify_v1').map(call=>call.action),['approve','cancel']);
        assert.equal(data.protectedFingerprint(),protectedBefore);
        native.pass('closed notification launcher makes zero requests; actual owner Leave UI routes approve and cancel through the default flagged wrapper and creates two transactional notices');

        phase='employee-list-historical-detail';
        const panel=()=>self.page.getByRole('region',{name:'请假结果通知',exact:true});
        await self.page.getByRole('button',{name:'请假结果通知',exact:true}).click();await panel().waitFor();
        await panel().getByRole('status').filter({hasText:'已读取请假结果'}).waitFor();
        const list=panel().getByRole('region',{name:'请假结果通知列表',exact:true});await list.waitFor();
        const cards=list.getByRole('article');assert.equal(await cards.count(),2);await cards.nth(0).getByText(/已取消批准/).waitFor();
        const approved=list.getByRole('article',{name:'请假结果通知 已批准',exact:true});await approved.getByText('未读',{exact:true}).waitFor();
        await approved.getByRole('button',{name:'查看结果详情',exact:true}).click();
        let detail=panel().getByRole('article',{name:'请假结果通知详情',exact:true});await detail.getByText(/当前已取消批准 · 当前修订 3/).waitFor();
        assert.equal(await detail.getByRole('button',{name:'明确标记已读',exact:true}).isEnabled(),true);
        await detail.getByRole('button',{name:'返回通知列表',exact:true}).click();await list.waitFor();
        native.pass('employee record ID is distinct from Auth ID; bounded decision-time list retains approval and cancellation separately, and approval detail reports current cancelled state without auto-read');

        phase='lost-read-and-paused-recovery';
        const cancelled=list.getByRole('article',{name:'请假结果通知 已取消批准',exact:true});await cancelled.getByRole('button',{name:'查看结果详情',exact:true}).click();
        detail=panel().getByRole('article',{name:'请假结果通知详情',exact:true});await detail.waitFor();
        loseSuccessfulReadPost=true;await detail.getByRole('button',{name:'明确标记已读',exact:true}).click();
        await panel().getByRole('region',{name:'已读结果待确认',exact:true}).waitFor();
        assert.equal(notificationRequests('POST').length,1);assert.deepEqual(counts(),{requests:1,entries:3,notifications:2,reads:1});
        const storageKey=`faolla:attendance:leave-notifications:v1:${data.site}:${data.employeeId}`;
        const stored=JSON.parse(await self.page.evaluate(key=>sessionStorage.getItem(key),storageKey));
        assert.deepEqual(Object.keys(stored).sort(),['actorId','employeeId','notificationId','siteId','workerId']);
        assert.equal(stored.employeeId,data.employeeId);assert.equal(stored.actorId,data.employeeAuth);assert.equal(stored.workerId,data.workerId);
        moduleEnabled=false;await self.page.getByRole('button',{name:'卸载测试通知页',exact:true}).click();await panel().waitFor({state:'detached'});
        await self.page.getByRole('button',{name:'重挂测试通知页',exact:true}).click();await self.page.getByRole('button',{name:'请假结果通知',exact:true}).click();await panel().waitFor();
        detail=panel().getByRole('article',{name:'请假结果通知详情',exact:true});await detail.getByRole('button',{name:'这条通知已读',exact:true}).waitFor();
        assert.equal(await self.page.evaluate(key=>sessionStorage.getItem(key),storageKey),null);assert.equal(notificationRequests('POST').length,1);
        assert(notificationRequests('GET').some(item=>item.status===200&&item.search.includes(`notificationId=${stored.notificationId}`)));
        assert.equal(await self.page.evaluate(()=>sessionStorage.getItem('qa-unrelated-leave-notifications')),'preserve');
        await detail.getByRole('button',{name:'返回通知列表',exact:true}).click();await list.waitFor();
        await list.getByRole('article',{name:'请假结果通知 已批准',exact:true}).getByRole('button',{name:'查看结果详情',exact:true}).click();
        detail=panel().getByRole('article',{name:'请假结果通知详情',exact:true});const pausedMark=detail.getByRole('button',{name:'明确标记已读',exact:true});assert.equal(await pausedMark.isDisabled(),true);
        const beforeDisabled=notificationRequests('POST').length;await pausedMark.evaluate(button=>button.click());assert.equal(notificationRequests('POST').length,beforeDisabled);
        assert.equal(data.protectedFingerprint(),protectedBefore);
        native.pass('one lost successful mark-read stores the exact five-identity notice pin; paused remount recovers it by GET without a second POST, while a first mark on another notice stays disabled');

        phase='mobile-and-held-hidden-read';
        await self.page.setViewportSize({width:390,height:844});assert(await self.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
        await detail.getByRole('button',{name:'返回通知列表',exact:true}).click();await list.waitFor();moduleEnabled=true;
        const gate={ready:deferred(),release:deferred(),finished:deferred()};gates.add(gate);hold=gate;
        await panel().getByRole('button',{name:'重新查询通知首页',exact:true}).click();const held=await bounded(gate.ready.promise);assert.equal(held.ok,true);
        await self.page.getByRole('button',{name:'隐藏结果通知入口',exact:true}).click();await panel().waitFor({state:'detached'});
        gate.release.resolve();await bounded(gate.finished.promise);
        const readsBeforeShow=notificationRequests('GET').length;await self.page.getByRole('button',{name:'显示结果通知入口',exact:true}).click();
        await self.page.getByRole('button',{name:'请假结果通知',exact:true}).waitFor();assert.equal(notificationRequests('GET').length,readsBeforeShow);
        assert.equal(await self.page.getByRole('region',{name:'请假结果通知列表',exact:true}).count(),0);
        assert.deepEqual(errors,[]);assert.deepEqual(counts(),{requests:1,entries:3,notifications:2,reads:1});assert.equal(data.protectedFingerprint(),protectedBefore);
        native.pass('notification UI fits390px and a held SQL GET cannot repopulate hidden or unmounted content; showing the closed default-off-style launcher performs no automatic read');
        console.log(JSON.stringify({leaveNotificationsBrowser:true,browserChecks:4,leavePosts:requests.filter(item=>item.key==='leave'&&item.method==='POST').length,
          notificationGets:notificationRequests('GET').length,notificationPosts:notificationRequests('POST').length,counts:counts(),syntheticAuth:true,realAuthService:false,
          actualNotificationLauncher:true,actualOwnerLeaveLauncher:true,actualSelfPanelShell:false,staticSelfPanelIntegration:true,
          realNextServer:false,realEmail:false,realPush:false,productionAccess:false,screenshots:false,recordings:false}));
      }finally{
        closing=true;for(const gate of gates)gate.release.resolve();
        await runAttendanceCleanupSteps([...contexts].map((context,index)=>({name:`leave-notification-context-${index}`,run:()=>context.close()})).concat([{name:'notification-routes',run:()=>Promise.allSettled([...pending])}]));
      }
    });
  }catch(error){
    console.error(JSON.stringify({leaveNotificationsBrowserFailed:true,phase,sourceLine:String(error?.stack??'').match(/leave-notifications-browser-check\.mjs:(\d+):/)?.[1]??null,errors,requestCount:requests.length}));
    throw Error('leave_notifications_browser_failed');
  }finally{
    closing=true;for(const gate of gates)gate.release.resolve();
    await runAttendanceCleanupSteps([{name:'browser',run:()=>browser?.close()},{name:'routes',run:()=>Promise.allSettled([...pending])},
      {name:'harness',timeoutMs:10000,run:async()=>{if(child?.pid!==undefined&&child.exitCode===null&&child.signalCode===null){const stopped=once(child,'exit');child.kill();await stopped;}}}]);
    if(savedFlag===undefined)delete process.env[flag];else process.env[flag]=savedFlag;
  }
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  await runAttendanceLabelsReuse(process.argv.slice(2),native=>withAttendanceConcurrencySandbox(native,scope=>checkAttendanceLeaveNotificationsBrowser(native,scope)))
    .catch(()=>{console.error('leave_notifications_browser_failed');process.exitCode=1;});
}
