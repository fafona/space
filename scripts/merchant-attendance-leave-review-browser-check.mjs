// Actual single leave workspace + readonly review discovery, default handlers/SDK
// and owned synthetic SQL. No production, real Auth service, Next server or media.
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
import {prepareLeaveReviewNativeFixture} from './merchant-attendance-leave-review-native.mjs';
import {runAttendanceCleanupSteps} from './fixtures/attendance-cleanup.mjs';

const require=createRequire(import.meta.url);
const {withAttendanceApplicationAuth}=require('./fixtures/attendance-application-auth.ts');
const {handleLeave}=require('../src/app/api/merchant-enterprise/attendance/leave/route-handler.ts');
const {handleLeaveReview}=require('../src/app/api/merchant-enterprise/attendance/leave-review/route-handler.ts');
const {requireMerchantEnterpriseEntitlement}=require('../src/lib/merchantEnterpriseAuth.server.ts');
const {MERCHANT_AUTH_COOKIE}=require('../src/lib/merchantAuthSession.ts');
const origin='https://127.0.0.1:3131',staticOrigin='http://127.0.0.1:3131',canonical='https://www.faolla.com';
const prefix='/api/merchant-enterprise/attendance/',localFetch=globalThis.fetch;
const literal=value=>"'"+String(value).replaceAll("'","''")+"'",json=value=>value===null?'null':literal(JSON.stringify(value))+'::jsonb';
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
const bounded=async promise=>{let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('leave_review_browser_timeout')),20000);})]);}finally{clearTimeout(timer);}};

export async function checkAttendanceLeaveReviewBrowser(native,scope){
  const notificationFlag='FAOLLA_ATTENDANCE_LEAVE_NOTIFICATIONS_ENABLED',savedNotificationFlag=process.env[notificationFlag];
  process.env[notificationFlag]='1';
  let closing=false,browser,child,hold=null,loseSuccessfulLeavePost=false,failNextReview=false,moduleEnabled=true,phase='fixture';
  const requests=[],rpcCalls=[],errors=[],pending=new Set(),gates=new Set(),contexts=new Set();
  try{
    const data=await prepareLeaveReviewNativeFixture(native,scope);
    assert.notEqual(data.employeeAuth,data.employeeId,'employee record UUID must differ from Auth UUID');
    assert.equal(data.expectedRows.length,6);assert.equal(data.closedIds.length,50);
    const protectedBefore=data.protectedFingerprint();
    const counts=()=>JSON.parse(data.exec(`select jsonb_build_object(
      'requests',(select count(*)::integer from public.merchant_attendance_leave_requests),
      'entries',(select count(*)::integer from public.merchant_attendance_leave_entries),
      'notifications',(select count(*)::integer from public.merchant_attendance_leave_notifications),
      'reads',(select count(*)::integer from public.merchant_attendance_leave_notification_reads));`));
    assert.deepEqual(counts(),{requests:57,entries:108,notifications:0,reads:0});
    const selfActor={id:data.employeeAuth,email:'leave-review-employee@example.test'},ownerActor={id:data.owner,email:'leave-review-owner@example.test'};
    const panelSource=readFileSync(path.join(native.root,'src/components/enterprise/MerchantAttendanceLeavePanel.tsx'),'utf8');
    const launcherSource=readFileSync(path.join(native.root,'src/components/enterprise/MerchantAttendanceLeaveLauncher.tsx'),'utf8');
    const executorSource=readFileSync(path.join(native.root,'src/lib/merchantAttendanceLeave.server.ts'),'utf8');
    assert.equal((panelSource.match(/new AttendanceLeaveClient\(/g)??[]).length,1,'single original writer client required');
    assert(panelSource.includes('process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_LEAVE_REVIEW_ENABLED === "1"'));
    assert(panelSource.includes('access === "owner" && (props.reviewEnabled'));
    assert(launcherSource.includes('process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_LEAVE_ENABLED === "1"'));
    assert(executorSource.includes('faolla_attendance_leave_notify_v1'));
    const probe=net.createServer();await new Promise((resolve,reject)=>{probe.once('error',reject);probe.listen(3131,'127.0.0.1',resolve);});await new Promise(resolve=>probe.close(resolve));
    child=spawn(process.execPath,['scripts/attendance-self-browser-harness.mjs','--leave-review'],{cwd:native.root,windowsHide:true,stdio:['ignore','pipe','pipe']});
    child.stderr.on('data',()=>errors.push('harness_stderr'));
    const rpc=async(name,args)=>{
      assert(['faolla_attendance_leave_v1','faolla_attendance_leave_notify_v1','faolla_attendance_leave_review_v1'].includes(name));
      assert([data.employeeAuth,data.owner].includes(args.p_auth_user_id));assert.equal(args.p_query.siteId,data.site);
      const review=name==='faolla_attendance_leave_review_v1';
      assert.deepEqual(Object.keys(args).sort(),review?['p_auth_user_id','p_query']:['p_allow_write','p_auth_user_id','p_command','p_query']);
      rpcCalls.push({name,actor:args.p_auth_user_id,action:args.p_command?.action??null});
      const expression=review
        ? `public.${name}(${json(args.p_query)},${literal(args.p_auth_user_id)})`
        : `public.${name}(${json(args.p_query)},${literal(args.p_auth_user_id)},${json(args.p_command)},${String(args.p_allow_write)})`;
      try{
        const reply=JSON.parse(data.exec(`set local role service_role;select jsonb_build_object('role',current_user,'data',${expression});`));
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
        await context.addInitScript(()=>sessionStorage.setItem('qa-unrelated-leave-review','preserve'));
        await context.route('**/*',route=>{
          if(closing)return route.abort().catch(()=>{});
          const work=(async()=>{
            const request=route.request(),url=new URL(request.url());assert.equal(url.origin,origin);
            if(['/','/harness.js','/harness.css'].includes(url.pathname)){
              assert.equal(request.method(),'GET');const response=await localFetch(staticOrigin+url.pathname);
              return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});
            }
            const key=url.pathname.slice(prefix.length),handlers={leave:handleLeave,'leave-review':handleLeaveReview};
            assert.equal(url.pathname,prefix+key);assert(Object.hasOwn(handlers,key));assert(['GET','POST'].includes(request.method()));
            if(key==='leave-review')assert.equal(request.method(),'GET');
            const headers=new Headers(await request.allHeaders());assert(headers.get('cookie')?.includes(MERCHANT_AUTH_COOKIE+'='));assert.equal(headers.get('x-merchant-access-token'),null);
            headers.set('host','www.faolla.com');headers.set('referer',canonical+'/');if(headers.has('origin'))headers.set('origin',canonical);
            const rejectReview=key==='leave-review'&&failNextReview;if(rejectReview)failNextReview=false;
            const response=await handlers[key](new Request(canonical+url.pathname+url.search,{method:request.method(),headers,body:request.postData()??undefined}),
              {enabled:()=>!rejectReview,entitlement});
            const body=await response.text(),parsed=JSON.parse(body);requests.push({key,actor:actor.id,method:request.method(),status:response.status,search:url.search});
            if(key==='leave'&&request.method()==='POST'&&response.status===200&&loseSuccessfulLeavePost){loseSuccessfulLeavePost=false;return route.abort('failed');}
            const gate=key==='leave-review'&&request.method()==='GET'?hold:null;
            if(gate){hold=null;gate.ready.resolve(parsed);await gate.release.promise;}
            try{await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body});}
            finally{if(gate){gate.finished.resolve();gates.delete(gate);}}
          })();pending.add(work);void work.finally(()=>pending.delete(work)).catch(()=>{});
          return work.catch(async()=>{if(!closing&&!route.request().failure())errors.push('route_failed');await route.abort().catch(()=>{});});
        });
        const page=await context.newPage(),dialog={dismissNext:false};page.setDefaultTimeout(12000);page.on('pageerror',()=>errors.push('page_error'));
        page.on('dialog',prompt=>{const dismiss=dialog.dismissNext;dialog.dismissNext=false;void (dismiss?prompt.dismiss():prompt.accept());});
        await page.goto(origin+'/?'+new URLSearchParams(search));return {context,page,dialog};
      };
      const reviewRequests=(method=null)=>requests.filter(item=>item.key==='leave-review'&&(!method||item.method===method));
      const leavePosts=()=>requests.filter(item=>item.key==='leave'&&item.method==='POST');
      const card=(list,requestId)=>list.getByRole('article').filter({hasText:requestId});
      try{
        phase='flagoff-and-employee-regression';
        const flagOff=await createPage(ownerActor,{siteId:data.site,access:'owner',actorId:data.owner,reviewOff:'1'}),readsBeforeFlagOff=reviewRequests().length;
        await flagOff.page.getByRole('button',{name:'请假申请审批',exact:true}).click();
        const flagOffPanel=flagOff.page.getByRole('region',{name:'请假申请审批',exact:true});await flagOffPanel.waitFor();
        await flagOffPanel.getByRole('status').filter({hasText:'已读取请假记录'}).waitFor();
        assert.equal(await flagOffPanel.getByRole('navigation',{name:'负责人请假视图',exact:true}).count(),0);assert.equal(reviewRequests().length,readsBeforeFlagOff);
        const self=await createPage(selfActor,{siteId:data.site,access:'self',employeeId:data.employeeId});
        await self.page.getByRole('button',{name:'我的请假申请',exact:true}).click();
        const selfPanel=self.page.getByRole('region',{name:'我的请假申请',exact:true});await selfPanel.waitFor();
        await selfPanel.getByRole('status').filter({hasText:'已读取请假记录'}).waitFor();
        assert.equal(await selfPanel.getByRole('navigation',{name:'负责人请假视图',exact:true}).count(),0);assert.equal(reviewRequests().length,0);
        native.pass('explicit review-off owner panel and employee workspace preserve the original list and never request the new owner-only endpoint');

        phase='owner-dirty-switch';
        const owner=await createPage(ownerActor,{siteId:data.site,access:'owner',actorId:data.owner});
        const panel=()=>owner.page.getByRole('region',{name:'请假申请审批',exact:true});
        const detail=()=>panel().getByRole('article',{name:'请假申请详情',exact:true});
        await owner.page.getByRole('button',{name:'请假申请审批',exact:true}).click();await panel().waitFor();
        await panel().getByRole('status').filter({hasText:'已读取请假记录'}).waitFor();
        const allList=panel().getByRole('region',{name:'请假申请记录',exact:true});await allList.waitFor();
        await card(allList,data.pendingIds[5]).getByRole('button',{name:'查看申请详情',exact:true}).click();await detail().waitFor();
        const reason=panel().getByLabel(/^决定理由/);await reason.fill('切换视图前保留的合成审批草稿');
        owner.dialog.dismissNext=true;await panel().getByRole('button',{name:'待审批',exact:true}).click();
        await detail().waitFor();assert.equal(await reason.inputValue(),'切换视图前保留的合成审批草稿');
        assert.equal(await panel().getByRole('button',{name:'全部申请',exact:true}).getAttribute('aria-pressed'),'true');
        await panel().getByRole('button',{name:'待审批',exact:true}).click();
        const reviewList=panel().getByRole('region',{name:'待审批请假申请',exact:true});await reviewList.waitFor();
        await reviewList.getByText('本批未发现待审批申请，仍可继续查询。',{exact:true}).waitFor();
        assert.equal(await reviewList.getByRole('article').count(),0);assert.equal(reviewRequests().length,1);
        native.pass('owner dirty decision draft survives a cancelled switch and an accepted switch explicitly clears it before one bounded first-page read');

        phase='empty-first-page-and-latest-terminal';
        await reviewList.getByRole('button',{name:'继续查找待审',exact:true}).click();await card(reviewList,data.pendingIds[0]).waitFor();
        assert.equal(await reviewList.getByRole('article').count(),6);
        for(let index=0;index<data.pendingIds.length;index++)assert((await reviewList.getByRole('article').nth(index).innerText()).includes(data.pendingIds[index]));
        const withdrawnId=data.pendingIds[0],withdrawal=data.action(8101,'withdraw',withdrawnId);
        const withdrawn=data.call(data.queryInput('self',{requestId:withdrawnId}),withdrawal,true,data.employeeAuth);assert.equal(withdrawn.detail.status,'withdrawn');
        await card(reviewList,withdrawnId).getByRole('button',{name:'查看申请详情',exact:true}).click();await detail().getByRole('heading',{name:/已撤回/}).waitFor();
        assert.equal(await detail().getByRole('button',{name:'明确批准请假申请',exact:true}).count(),0);
        assert.equal(await detail().getByRole('button',{name:'明确驳回请假申请',exact:true}).count(),0);
        await detail().getByRole('button',{name:'返回申请列表',exact:true}).click();await reviewList.getByText('本批未发现待审批申请，仍可继续查询。',{exact:true}).waitFor();
        await reviewList.getByRole('button',{name:'继续查找待审',exact:true}).click();await card(reviewList,data.pendingIds[1]).waitFor();
        assert.equal(await reviewList.getByRole('article').count(),5);
        native.pass('an empty scanned50 first page exposes only explicit continuation; the ordered second page has six future requests, and stale discovery opens original latest detail where a live withdrawal has no decision controls');

        phase='approve-and-lost-reject-recovery';
        const approvedId=data.pendingIds[1];await card(reviewList,approvedId).getByRole('button',{name:'查看申请详情',exact:true}).click();await detail().waitFor();
        await panel().getByLabel(/^决定理由/).fill('负责人通过单工作区批准合成未来请假');
        await panel().getByRole('checkbox',{name:/我已核对申请人、时段、时区、当前状态/}).check();
        await panel().getByRole('button',{name:'明确批准请假申请',exact:true}).click();await detail().getByRole('heading',{name:/已批准/}).waitFor();
        assert.deepEqual(counts(),{requests:57,entries:110,notifications:1,reads:0});
        await detail().getByRole('button',{name:'返回申请列表',exact:true}).click();await reviewList.getByText('本批未发现待审批申请，仍可继续查询。',{exact:true}).waitFor();
        await reviewList.getByRole('button',{name:'继续查找待审',exact:true}).click();
        const rejectedId=data.pendingIds[2];await card(reviewList,rejectedId).getByRole('button',{name:'查看申请详情',exact:true}).click();await detail().waitFor();
        await panel().getByLabel(/^决定理由/).fill('负责人驳回并模拟成功回复丢失');
        await panel().getByRole('checkbox',{name:/我已核对申请人、时段、时区、当前状态/}).check();
        loseSuccessfulLeavePost=true;await panel().getByRole('button',{name:'明确驳回请假申请',exact:true}).click();
        await panel().getByRole('button',{name:'用原编号明确重试',exact:true}).waitFor();
        assert.deepEqual(counts(),{requests:57,entries:111,notifications:2,reads:0});assert.equal(leavePosts().length,2);
        const storageKey=`faolla:attendance:leave:v1:${data.site}:owner:${data.owner}`;
        const stored=JSON.parse(await owner.page.evaluate(key=>sessionStorage.getItem(key),storageKey));
        assert.equal(stored.actorId,data.owner);assert.equal(stored.employeeId,null);assert.equal(stored.command.requestId,rejectedId);assert.equal(stored.command.action,'reject');
        assert.equal(await panel().getByRole('button',{name:'待审批',exact:true}).isDisabled(),true);
        assert.equal(await panel().getByRole('button',{name:'全部申请',exact:true}).isDisabled(),true);
        const readsBeforeRecovery=reviewRequests().length;moduleEnabled=false;
        await owner.page.getByRole('button',{name:'卸载测试请假页',exact:true}).click();await panel().waitFor({state:'detached'});
        await owner.page.getByRole('button',{name:'重挂测试请假页',exact:true}).click();await owner.page.getByRole('button',{name:'请假申请审批',exact:true}).click();await panel().waitFor();
        await panel().getByRole('region',{name:'请假操作收据',exact:true}).waitFor();await detail().getByRole('heading',{name:/已驳回/}).waitFor();
        assert.equal(await owner.page.evaluate(key=>sessionStorage.getItem(key),storageKey),null);assert.equal(reviewRequests().length,readsBeforeRecovery);assert.equal(leavePosts().length,2);
        assert.deepEqual(rpcCalls.filter(call=>call.name==='faolla_attendance_leave_notify_v1').map(call=>call.action),['approve','reject']);
        native.pass('actual original writer approves and loses one successful reject response through the133 capture wrapper; remount while paused resolves the exact owner pending receipt before any review read and never duplicates the write');

        phase='paused-readonly-mobile-and-review-failure';
        await panel().getByRole('button',{name:'待审批',exact:true}).click();await reviewList.getByText('本批未发现待审批申请，仍可继续查询。',{exact:true}).waitFor();
        await reviewList.getByRole('button',{name:'继续查找待审',exact:true}).click();
        await card(reviewList,data.pendingIds[3]).getByRole('button',{name:'查看申请详情',exact:true}).click();await detail().getByRole('heading',{name:/待审批/}).waitFor();
        const pausedApprove=detail().getByRole('button',{name:'明确批准请假申请',exact:true});
        const pausedReject=detail().getByRole('button',{name:'明确驳回请假申请',exact:true});assert.equal(await pausedApprove.isDisabled(),true);assert.equal(await pausedReject.isDisabled(),true);
        const postsBeforeDisabled=leavePosts().length;await pausedApprove.evaluate(node=>node.click());assert.equal(leavePosts().length,postsBeforeDisabled);
        await owner.page.setViewportSize({width:390,height:844});assert(await owner.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
        moduleEnabled=true;await panel().getByRole('button',{name:'全部申请',exact:true}).click();await allList.waitFor();
        failNextReview=true;await panel().getByRole('button',{name:'待审批',exact:true}).click();
        await panel().getByRole('status').filter({hasText:'待审读取或身份核验失败'}).waitFor();
        assert.equal(await panel().getByRole('region',{name:'请假申请记录',exact:true}).count(),0);assert.equal(await detail().count(),0);
        assert(requests.some(item=>item.key==='leave-review'&&item.status===404));
        native.pass('paused entitlement still permits bounded review and current detail while both decisions stay disabled at390px; a rejected review query removes every old list/detail display instead of leaving stale authorized data');

        phase='explicit-recovery-and-held-unmount';
        await panel().getByRole('button',{name:'重新查询待审批首页',exact:true}).click();await reviewList.getByText('本批未发现待审批申请，仍可继续查询。',{exact:true}).waitFor();
        const gate={ready:deferred(),release:deferred(),finished:deferred()};gates.add(gate);hold=gate;
        await panel().getByRole('button',{name:'重新查询待审批首页',exact:true}).click();const held=await bounded(gate.ready.promise);assert.equal(held.ok,true);
        await owner.page.getByRole('button',{name:'隐藏请假入口',exact:true}).click();await panel().waitFor({state:'detached'});
        gate.release.resolve();await bounded(gate.finished.promise);
        const readsBeforeShow=reviewRequests().length;await owner.page.getByRole('button',{name:'显示请假入口',exact:true}).click();
        await owner.page.getByRole('button',{name:'请假申请审批',exact:true}).waitFor();assert.equal(reviewRequests().length,readsBeforeShow);
        assert.equal(await owner.page.getByRole('region',{name:'请假申请审批',exact:true}).count(),0);
        assert.equal(await owner.page.evaluate(()=>sessionStorage.getItem('qa-unrelated-leave-review')),'preserve');
        assert.deepEqual(errors,[]);assert.deepEqual(counts(),{requests:57,entries:111,notifications:2,reads:0});assert.equal(data.protectedFingerprint(),protectedBefore);
        native.pass('an explicit read recovers the blocked view; a held review GET cannot repopulate hidden or unmounted UI, and reopening the closed launcher performs no automatic read');
        console.log(JSON.stringify({leaveReviewBrowser:true,browserChecks:6,leavePosts:leavePosts().length,reviewGets:reviewRequests('GET').length,
          counts:counts(),syntheticAuth:true,realAuthService:false,actualLeaveLauncher:true,actualSingleLeavePanel:true,actualDefaultHandlers:true,
          notificationCapture:true,realNextServer:false,productionAccess:false,screenshots:false,recordings:false}));
      }finally{
        closing=true;for(const gate of gates)gate.release.resolve();
        await runAttendanceCleanupSteps([...contexts].map((context,index)=>({name:`leave-review-context-${index}`,run:()=>context.close()})).concat([{name:'leave-review-routes',run:()=>Promise.allSettled([...pending])}]));
      }
    });
  }catch(error){
    console.error(JSON.stringify({leaveReviewBrowserFailed:true,phase,sourceLine:String(error?.stack??'').match(/leave-review-browser-check\.mjs:(\d+):/)?.[1]??null,errors,requestCount:requests.length}));
    throw Error('leave_review_browser_failed');
  }finally{
    closing=true;for(const gate of gates)gate.release.resolve();
    await runAttendanceCleanupSteps([{name:'browser',run:()=>browser?.close()},{name:'routes',run:()=>Promise.allSettled([...pending])},
      {name:'harness',timeoutMs:10000,run:async()=>{if(child?.pid!==undefined&&child.exitCode===null&&child.signalCode===null){const stopped=once(child,'exit');child.kill();await stopped;}}}]);
    if(savedNotificationFlag===undefined)delete process.env[notificationFlag];else process.env[notificationFlag]=savedNotificationFlag;
  }
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  await runAttendanceLabelsReuse(process.argv.slice(2),native=>withAttendanceConcurrencySandbox(native,scope=>checkAttendanceLeaveReviewBrowser(native,scope)))
    .catch(()=>{console.error('leave_review_browser_failed');process.exitCode=1;});
}
