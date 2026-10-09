// Actual leave launcher/client + default handler/SDK + owned synthetic SQL.
// No production, real Auth service, Next server, phone, screenshots or recordings.
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
import {prepareLeaveNativeFixture} from './merchant-attendance-leave-native.mjs';
import {runAttendanceCleanupSteps} from './fixtures/attendance-cleanup.mjs';

const require=createRequire(import.meta.url);
const {withAttendanceApplicationAuth}=require('./fixtures/attendance-application-auth.ts');
const {handleLeave}=require('../src/app/api/merchant-enterprise/attendance/leave/route-handler.ts');
const {requireMerchantEnterpriseEntitlement}=require('../src/lib/merchantEnterpriseAuth.server.ts');
const {MERCHANT_AUTH_COOKIE}=require('../src/lib/merchantAuthSession.ts');
const origin='https://127.0.0.1:3131',staticOrigin='http://127.0.0.1:3131',canonical='https://www.faolla.com';
const endpoint='/api/merchant-enterprise/attendance/leave';
const literal=value=>"'"+String(value).replaceAll("'","''")+"'",json=value=>value===null?'null':literal(JSON.stringify(value))+'::jsonb';
const localFetch=globalThis.fetch;
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
const bounded=async promise=>{let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('leave_browser_timeout')),20000);})]);}finally{clearTimeout(timer);}};

export async function checkAttendanceLeaveBrowser(native,scope){
  const data=await prepareLeaveNativeFixture(native,scope);
  assert.notEqual(data.employeeAuth,data.employeeId,'fixture must distinguish auth from employee record identity');
  data.exec(`update public.merchant_attendance_settings set time_zone='Europe/Madrid' where merchant_id='${data.site}';`);
  const protectedBefore=data.protectedFingerprint();
  const counts=()=>JSON.parse(data.exec(`select jsonb_build_object(
    'requests',(select count(*)::integer from public.merchant_attendance_leave_requests),
    'entries',(select count(*)::integer from public.merchant_attendance_leave_entries));`));
  const selfActor={id:data.employeeAuth,email:'leave-employee@example.test'},ownerActor={id:data.owner,email:'leave-owner@example.test'};
  const requests=[],errors=[],pending=new Set(),gates=new Set(),contexts=new Set();
  let closing=false,browser,hold=null,loseSuccessfulPost=false,moduleEnabled=true,phase='harness';
  const selfSource=readFileSync(path.join(native.root,'src/components/enterprise/MerchantAttendanceSelfPanel.tsx'),'utf8');
  const adminSource=readFileSync(path.join(native.root,'src/components/enterprise/MerchantAttendanceAdminPanel.tsx'),'utf8');
  const launcherSource=readFileSync(path.join(native.root,'src/components/enterprise/MerchantAttendanceLeaveLauncher.tsx'),'utf8');
  assert(selfSource.includes('<LeaveLauncher siteId={siteId} employeeId={employeeId} access="self"'));
  assert(adminSource.includes('<LeaveLauncher siteId={siteId} actorId={ownerId} access="owner"'));
  assert(launcherSource.includes('process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_LEAVE_ENABLED === "1"'));
  assert(launcherSource.includes('if (!enabled || !active) return null'));
  const probe=net.createServer();
  await new Promise((resolve,reject)=>{probe.once('error',reject);probe.listen(3131,'127.0.0.1',resolve);});
  await new Promise(resolve=>probe.close(resolve));
  const child=spawn(process.execPath,['scripts/attendance-self-browser-harness.mjs','--leave'],{cwd:native.root,windowsHide:true,stdio:['ignore','pipe','pipe']});
  child.stderr.on('data',()=>errors.push('harness_stderr'));
  const rpc=async(name,args)=>{
    assert.equal(name,'faolla_attendance_leave_v1');
    assert([data.employeeAuth,data.owner].includes(args.p_auth_user_id));
    assert.equal(args.p_query.siteId,data.site);
    assert.deepEqual(Object.keys(args).sort(),['p_allow_write','p_auth_user_id','p_command','p_query']);
    try{
      const response=JSON.parse(data.exec(`set local role service_role;select jsonb_build_object('role',current_user,'data',
        public.faolla_attendance_leave_v1(${json(args.p_query)},${literal(args.p_auth_user_id)},${json(args.p_command)},${String(args.p_allow_write)}));`));
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
    await withAttendanceApplicationAuth([selfActor,ownerActor],rpc,async auth=>{
      const entitlement=siteId=>requireMerchantEnterpriseEntitlement(siteId,async()=>[{id:data.site,permissionConfig:{allowEnterpriseManagement:true,allowEmployeeAttendance:moduleEnabled}}]);
      const createPage=async(actor,search)=>{
        const context=await browser.newContext({viewport:{width:1280,height:1050},serviceWorkers:'block',acceptDownloads:false});contexts.add(context);
        await context.addCookies([{name:MERCHANT_AUTH_COOKIE,value:await auth.login(actor),url:origin,secure:true,httpOnly:true,sameSite:'Lax'}]);
        await context.addInitScript(()=>sessionStorage.setItem('qa-unrelated-leave','preserve'));
        await context.route('**/*',route=>{
          if(closing)return route.abort().catch(()=>{});
          const work=(async()=>{
            const request=route.request(),url=new URL(request.url());assert.equal(url.origin,origin);
            if(['/', '/harness.js','/harness.css'].includes(url.pathname)){
              assert.equal(request.method(),'GET');const response=await localFetch(staticOrigin+url.pathname);
              return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});
            }
            assert.equal(url.pathname,endpoint);assert(['GET','POST'].includes(request.method()));
            const headers=new Headers(await request.allHeaders());assert(headers.get('cookie')?.includes(MERCHANT_AUTH_COOKIE+'='));assert.equal(headers.get('x-merchant-access-token'),null);
            headers.set('host','www.faolla.com');headers.set('referer',canonical+'/');if(headers.has('origin'))headers.set('origin',canonical);
            const response=await handleLeave(new Request(canonical+url.pathname+url.search,{method:request.method(),headers,body:request.postData()??undefined}),{enabled:()=>true,entitlement});
            const body=await response.text(),parsed=JSON.parse(body);requests.push({actor:actor.id,method:request.method(),status:response.status,search:url.search});
            if(request.method()==='POST'&&response.status===200&&loseSuccessfulPost){loseSuccessfulPost=false;return route.abort('failed');}
            const gate=request.method()==='GET'?hold:null;if(gate){hold=null;gate.ready.resolve(parsed);await gate.release.promise;}
            try{await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body});}
            finally{if(gate){gate.finished.resolve();gates.delete(gate);}}
          })();pending.add(work);void work.finally(()=>pending.delete(work)).catch(()=>{});
          return work.catch(async()=>{if(!closing&&!route.request().failure())errors.push('route_failed');await route.abort().catch(()=>{});});
        });
        const page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',()=>errors.push('page_error'));page.on('dialog',dialog=>dialog.accept());
        await page.goto(origin+'/?'+new URLSearchParams(search));return {context,page};
      };
      try{
        const posts=actor=>requests.filter(item=>item.actor===actor&&item.method==='POST').length;
        phase='self-empty-and-dst';
        const self=await createPage(selfActor,{siteId:data.site,access:'self',employeeId:data.employeeId});
        const selfPanel=()=>self.page.getByRole('region',{name:'我的请假申请',exact:true});
        await self.page.getByRole('button',{name:'我的请假申请',exact:true}).click();await selfPanel().waitFor();
        await selfPanel().getByRole('status').filter({hasText:'已读取请假记录'}).waitFor();
        await selfPanel().getByText('本页没有请假申请，不代表没有排班、出勤或假期余额。',{exact:true}).waitFor();
        assert.equal(await self.page.locator('form form').count(),0);assert.deepEqual(counts(),{requests:0,entries:0});
        await selfPanel().getByLabel('请假开始时间',{exact:true}).fill('2026-10-25T02:15');
        await selfPanel().getByLabel('请假开始时间 UTC 时差',{exact:true}).selectOption('+02:00');
        await selfPanel().getByLabel('请假结束时间',{exact:true}).fill('2026-10-25T03:15');
        await selfPanel().getByRole('button',{name:'生成请假预览',exact:true}).click();
        const preview=selfPanel().getByRole('region',{name:'请假时段预览',exact:true});await preview.waitFor();
        await preview.getByText(/实际经过时长：2 小时/).waitFor();
        await selfPanel().getByLabel(/^请假理由/).fill('合成夏令时请假申请');
        await selfPanel().getByRole('checkbox',{name:/我已核对申请人、企业时区、两端 UTC 时差/}).check();
        loseSuccessfulPost=true;await selfPanel().getByRole('button',{name:'明确提交请假申请',exact:true}).click();
        await selfPanel().getByRole('button',{name:'用原编号明确重试',exact:true}).waitFor();
        assert.equal(posts(data.employeeAuth),1);assert.deepEqual(counts(),{requests:1,entries:1});
        const storageKey=`faolla:attendance:leave:v1:${data.site}:self:${data.employeeId}`;
        const stored=JSON.parse(await self.page.evaluate(key=>sessionStorage.getItem(key),storageKey));
        assert.equal(stored.employeeId,data.employeeId);assert.equal(stored.actorId,data.employeeAuth);assert.equal(stored.command.action,'submit');
        assert.equal(stored.command.startAt,'2026-10-25T00:15:00.000Z');assert.equal(stored.command.endAt,'2026-10-25T02:15:00.000Z');
        assert.equal(data.protectedFingerprint(),protectedBefore);
        native.pass('actual self launcher binds employee record separately from auth; empty read and explicit Madrid DST fold preview submit one minute-precision request');

        phase='paused-original-receipt';moduleEnabled=false;
        await self.page.getByRole('button',{name:'卸载测试请假页',exact:true}).click();await selfPanel().waitFor({state:'detached'});
        await self.page.getByRole('button',{name:'重挂测试请假页',exact:true}).click();
        await self.page.getByRole('button',{name:'我的请假申请',exact:true}).click();await selfPanel().waitFor();
        await selfPanel().getByRole('region',{name:'请假操作收据',exact:true}).waitFor();
        assert.equal(await self.page.evaluate(key=>sessionStorage.getItem(key),storageKey),null);assert.equal(posts(data.employeeAuth),1);
        const pausedButton=selfPanel().getByRole('button',{name:'明确撤回请假申请',exact:true});assert.equal(await pausedButton.isDisabled(),true);
        const beforeDisabled=posts(data.employeeAuth);await pausedButton.evaluate(button=>button.click());assert.equal(posts(data.employeeAuth),beforeDisabled);
        assert(requests.some(item=>item.actor===data.employeeAuth&&item.method==='GET'&&item.search.includes(`operationId=${stored.command.operationId}`)));
        assert.equal(await self.page.evaluate(()=>sessionStorage.getItem('qa-unrelated-leave')),'preserve');assert.equal(data.protectedFingerprint(),protectedBefore);
        native.pass('lost successful POST remains pending; remount while paused resolves only the original receipt by GET, clears exact pending and cannot create a second write');

        phase='owner-approve-cancel';moduleEnabled=true;
        const owner=await createPage(ownerActor,{siteId:data.site,access:'owner',actorId:data.owner});
        const ownerPanel=()=>owner.page.getByRole('region',{name:'请假申请审批',exact:true});
        const ownerDetail=()=>ownerPanel().getByRole('article',{name:'请假申请详情',exact:true});
        await owner.page.getByRole('button',{name:'请假申请审批',exact:true}).click();await ownerPanel().waitFor();
        await ownerPanel().getByRole('status').filter({hasText:'已读取请假记录'}).waitFor();
        await ownerPanel().getByRole('button',{name:'查看申请详情',exact:true}).click();await ownerDetail().waitFor();
        await ownerPanel().getByLabel(/^决定理由/).fill('负责人明确批准合成申请');
        await ownerPanel().getByRole('checkbox',{name:/我已核对申请人、时段、时区、当前状态/}).check();
        await ownerPanel().getByRole('button',{name:'明确批准请假申请',exact:true}).click();
        await ownerDetail().getByRole('heading',{name:/已批准/}).waitFor();
        await ownerPanel().getByLabel(/^决定理由/).fill('负责人明确取消原批准');
        await ownerPanel().getByRole('checkbox',{name:/我已核对申请人、时段、时区、当前状态/}).check();
        await ownerPanel().getByRole('button',{name:'明确取消已批准请假',exact:true}).click();
        await ownerDetail().getByRole('heading',{name:/已取消/}).waitFor();
        assert.equal(posts(data.owner),2);assert.deepEqual(counts(),{requests:1,entries:3});assert.equal(data.protectedFingerprint(),protectedBefore);
        native.pass('actual owner entry reads employee detail, explicitly approves then cancels through two revision-checked writes without changing prior attendance facts');

        phase='self-final-history-mobile';
        await selfPanel().getByRole('button',{name:'重新查询首页',exact:true}).click();
        await selfPanel().getByRole('status').filter({hasText:'已读取请假记录'}).waitFor();
        await selfPanel().getByRole('button',{name:'查看申请详情',exact:true}).click();
        const selfDetail=selfPanel().getByRole('article',{name:'请假申请详情',exact:true});await selfDetail.getByRole('heading',{name:/已取消/}).waitFor();
        for(const text of ['提交申请 · 版本 1','负责人批准 · 版本 2','负责人取消批准 · 版本 3'])await selfDetail.getByText(text,{exact:true}).waitFor();
        await self.page.setViewportSize({width:390,height:844});assert(await self.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
        assert.equal(posts(data.employeeAuth),1);assert.equal(data.protectedFingerprint(),protectedBefore);
        native.pass('self reread shows the terminal cancellation and complete immutable three-step history at390px with no duplicate submission or horizontal overflow');

        phase='held-hide-unmount';
        const gate={ready:deferred(),release:deferred(),finished:deferred()};gates.add(gate);hold=gate;
        await selfPanel().getByRole('button',{name:'重新查询首页',exact:true}).click();const held=await bounded(gate.ready.promise);assert.equal(held.ok,true);
        await self.page.getByRole('button',{name:'隐藏请假入口',exact:true}).click();await selfPanel().waitFor({state:'detached'});
        gate.release.resolve();await bounded(gate.finished.promise);
        const readsBeforeShow=requests.filter(item=>item.actor===data.employeeAuth&&item.method==='GET').length;
        await self.page.getByRole('button',{name:'显示请假入口',exact:true}).click();
        await self.page.getByRole('button',{name:'我的请假申请',exact:true}).waitFor();
        assert.equal(requests.filter(item=>item.actor===data.employeeAuth&&item.method==='GET').length,readsBeforeShow);
        assert.equal(await self.page.getByText('负责人明确取消原批准',{exact:true}).count(),0);
        await self.page.getByRole('button',{name:'卸载测试请假页',exact:true}).click();
        await self.page.getByRole('button',{name:'重挂测试请假页',exact:true}).click();
        assert.equal(requests.filter(item=>item.actor===data.employeeAuth&&item.method==='GET').length,readsBeforeShow);
        assert.deepEqual(errors,[]);assert.equal(data.protectedFingerprint(),protectedBefore);
        native.pass('a held actual SQL GET cannot repopulate hidden or unmounted leave UI; fresh launcher remains closed and performs no automatic late read');
        console.log(JSON.stringify({leaveBrowser:true,browserChecks:5,selfPosts:posts(data.employeeAuth),ownerPosts:posts(data.owner),counts:counts(),
          syntheticAuth:true,realAuthService:false,realNextServer:false,realPhone:false,productionAccess:false}));
      }finally{
        closing=true;for(const gate of gates)gate.release.resolve();
        await runAttendanceCleanupSteps([{name:'leave-browser',run:()=>browser?.close()},{name:'leave-routes',run:()=>Promise.allSettled([...pending])}]);
      }
    });
  }catch(error){
    console.error(JSON.stringify({leaveBrowserFailed:true,phase,sourceLine:String(error?.stack??'').match(/leave-browser-check\.mjs:(\d+):/)?.[1]??null,errors,requestCount:requests.length}));
    throw Error('leave_browser_failed');
  }finally{
    closing=true;for(const gate of gates)gate.release.resolve();
    await runAttendanceCleanupSteps([{name:'browser',run:()=>browser?.close()},{name:'routes',run:()=>Promise.allSettled([...pending])},
      {name:'harness',timeoutMs:10000,run:async()=>{if(child.pid!==undefined&&child.exitCode===null&&child.signalCode===null){const stopped=once(child,'exit');child.kill();await stopped;}}}]);
  }
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  await runAttendanceLabelsReuse(process.argv.slice(2),native=>withAttendanceConcurrencySandbox(native,scope=>checkAttendanceLeaveBrowser(native,scope)))
    .catch(()=>{console.error('leave_browser_failed');process.exitCode=1;});
}
