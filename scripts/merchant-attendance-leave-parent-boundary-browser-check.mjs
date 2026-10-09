// Repair acceptance: actual AdminPanel/SelfPanel parent authorization denials
// must reset opened leave children and invalidate earlier in-flight replies.
// Non-authorization failures must not become a permanent cross-module gate.
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
const {handleAttendanceAdmin}=require('../src/app/api/merchant-enterprise/attendance/admin/route-handler.ts');
const {handleAttendanceSelf}=require('../src/app/api/merchant-enterprise/attendance/self/route-handler.ts');
const {handleLeave}=require('../src/app/api/merchant-enterprise/attendance/leave/route-handler.ts');
const {handleLeaveNotifications}=require('../src/app/api/merchant-enterprise/attendance/leave-notifications/route-handler.ts');
const {requireMerchantEnterpriseEntitlement}=require('../src/lib/merchantEnterpriseAuth.server.ts');
const {MERCHANT_AUTH_COOKIE}=require('../src/lib/merchantAuthSession.ts');

const origin='https://127.0.0.1:3131',staticOrigin='http://127.0.0.1:3131',canonical='https://www.faolla.com';
const prefix='/api/merchant-enterprise/attendance/',localFetch=globalThis.fetch;
const literal=value=>"'"+String(value).replaceAll("'","''")+"'";
const json=value=>value===null?'null':literal(JSON.stringify(value))+'::jsonb';
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
const bounded=async promise=>{let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{
  timer=setTimeout(()=>reject(Error('leave_parent_boundary_browser_timeout')),20000);
})]);}finally{clearTimeout(timer);}};

export async function checkAttendanceLeaveParentBoundaryBrowser(native,scope){
  const serverFlags=['FAOLLA_ATTENDANCE_LEAVE_ENABLED','FAOLLA_ATTENDANCE_LEAVE_NOTIFICATIONS_ENABLED'];
  const savedFlags=new Map(serverFlags.map(name=>[name,process.env[name]]));
  for(const name of serverFlags)process.env[name]='1';
  let closing=false,browser,child,data=null,baseline=null,ownerRevoked=false,employeeDisabled=false,workerInactive=false,settingsDisabled=false;
  let holdNotification=null,moduleEnabled=true,parentRpcFailure=null,phase='fixture';
  const requests=[],rpcCalls=[],errors=[],pending=new Set(),contexts=new Set(),gates=new Set();
  try{
    data=await prepareLeaveNotificationsNativeFixture(native,scope);
    assert.notEqual(data.employeeAuth,data.employeeId,'employee record UUID must differ from Auth UUID');
    // The shared sandbox foundation stops at the original063 function. Apply
    // the repository's current additive111 replacement inside this owned schema
    // so the parent denial is proved against the current self-read contract.
    const selfIdentityMigration=readFileSync(path.join(native.root,'scripts/supabase-migrations/202610020111_merchant_attendance_self_clock_identity.sql'),'utf8')
      .replace(/^begin;\s*$/m,'').replace(/^commit;\s*$/m,'');
    data.exec(selfIdentityMigration);
    assert(data.exec(`select pg_get_functiondef('public.faolla_attendance_self_v1(text,uuid,jsonb,uuid)'::regprocedure);`).includes('actor_employee_id'));
    data.exec(`update public.merchant_attendance_settings set enabled=true where merchant_id='${data.site}';`);
    const reason='第135批父授权边界合成请假理由';
    const submission=data.submit(8501,{reason}),submitted=data.call(data.queryInput('self'),submission,true,data.employeeAuth);
    const decision=data.action(8502,'approve',submitted.detail.requestId,{reason:'第135批合成负责人批准'});
    const approved=data.notify(data.queryInput('owner',{requestId:submitted.detail.requestId}),decision,true,data.owner);
    assert.equal(approved.detail.status,'approved');
    const counts=()=>JSON.parse(data.exec(`select jsonb_build_object(
      'requests',(select count(*)::integer from public.merchant_attendance_leave_requests),
      'entries',(select count(*)::integer from public.merchant_attendance_leave_entries),
      'notifications',(select count(*)::integer from public.merchant_attendance_leave_notifications),
      'reads',(select count(*)::integer from public.merchant_attendance_leave_notification_reads));`));
    assert.deepEqual(counts(),{requests:1,entries:2,notifications:1,reads:0});
    baseline={fingerprint:data.fingerprint(),protected:data.protectedFingerprint(),counts:counts()};

    const fixtureSource=readFileSync(path.join(native.root,'scripts/fixtures/attendance-leave-parent-boundary-browser.tsx'),'utf8');
    assert(fixtureSource.includes('MerchantAttendanceAdminPanel'));
    assert(fixtureSource.includes('MerchantAttendanceSelfPanel'));
    assert(!fixtureSource.includes('MerchantAttendanceLeaveLauncher'));
    const probe=net.createServer();
    await new Promise((resolve,reject)=>{probe.once('error',reject);probe.listen(3131,'127.0.0.1',resolve);});
    await new Promise(resolve=>probe.close(resolve));
    child=spawn(process.execPath,['scripts/attendance-self-browser-harness.mjs','--leave-parent-boundary'],{
      cwd:native.root,windowsHide:true,stdio:['ignore','pipe','pipe'],
    });
    child.stderr.on('data',()=>errors.push('harness_stderr'));

    const rpc=async(name,args)=>{
      assert(['faolla_attendance_admin_v1','faolla_attendance_self_v1','faolla_attendance_leave_v1','faolla_attendance_leave_notifications_v1'].includes(name));
      assert([data.owner,data.employeeAuth].includes(args.p_auth_user_id));
      let expression;
      if(name==='faolla_attendance_admin_v1'){
        assert.deepEqual(Object.keys(args).sort(),['p_auth_user_id','p_command','p_operation_id','p_query','p_site_id']);
        expression=`public.${name}(${literal(args.p_site_id)},${literal(args.p_auth_user_id)},${json(args.p_query)},${json(args.p_command)},${args.p_operation_id==null?'null':literal(args.p_operation_id)})`;
      }else if(name==='faolla_attendance_self_v1'){
        assert.deepEqual(Object.keys(args).sort(),['p_auth_user_id','p_command','p_operation_id','p_site_id']);
        expression=`public.${name}(${literal(args.p_site_id)},${literal(args.p_auth_user_id)},${json(args.p_command)},${args.p_operation_id==null?'null':literal(args.p_operation_id)})`;
      }else{
        assert.deepEqual(Object.keys(args).sort(),['p_allow_write','p_auth_user_id','p_command','p_query']);
        assert.equal(args.p_query.siteId,data.site);
        expression=`public.${name}(${json(args.p_query)},${literal(args.p_auth_user_id)},${json(args.p_command)},${String(args.p_allow_write)})`;
      }
      rpcCalls.push({name,actor:args.p_auth_user_id});
      if(parentRpcFailure===name){
        parentRpcFailure=null;
        return {data:null,error:{message:'attendance_unavailable'}};
      }
      try{
        const reply=JSON.parse(data.exec(`set local role service_role;select jsonb_build_object('data',${expression});`));
        return {data:reply.data,error:null};
      }catch(error){
        const code=String(error).match(/ERROR:\s+(attendance_[a-z_]+)/)?.[1];
        if(!code)throw error;
        return {data:null,error:{message:code}};
      }
    };

    await bounded(new Promise((resolve,reject)=>{let output='';
      child.stdout.on('data',chunk=>{output+=String(chunk);if(output.includes('Attendance synthetic component QA'))resolve();});
      child.once('error',()=>reject(Error('harness_failed')));
      child.once('exit',()=>reject(Error('harness_exited')));
    }));
    browser=await chromium.launch({headless:true});
    const ownerActor={id:data.owner,email:'leave-parent-owner@example.test'};
    const selfActor={id:data.employeeAuth,email:'leave-parent-employee@example.test'};
    await withAttendanceApplicationAuth([ownerActor,selfActor],rpc,async auth=>{
      const entitlement=siteId=>requireMerchantEnterpriseEntitlement(siteId,async()=>[{
        id:data.site,permissionConfig:{allowEnterpriseManagement:true,allowEmployeeAttendance:moduleEnabled},
      }]);
      const handlers={admin:handleAttendanceAdmin,self:handleAttendanceSelf,leave:handleLeave,'leave-notifications':handleLeaveNotifications};
      const createPage=async(actor,search)=>{
        const context=await browser.newContext({viewport:{width:1280,height:1050},serviceWorkers:'block',acceptDownloads:false});
        contexts.add(context);
        await context.addCookies([{name:MERCHANT_AUTH_COOKIE,value:await auth.login(actor),url:origin,secure:true,httpOnly:true,sameSite:'Lax'}]);
        await context.route('**/*',route=>{
          if(closing)return route.abort().catch(()=>{});
          const work=(async()=>{
            const request=route.request(),url=new URL(request.url());
            assert.equal(url.origin,origin);
            if(['/','/harness.js','/harness.css'].includes(url.pathname)){
              assert.equal(request.method(),'GET');
              const response=await localFetch(staticOrigin+url.pathname);
              return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});
            }
            const key=url.pathname.slice(prefix.length);
            assert.equal(url.pathname,prefix+key);assert(Object.hasOwn(handlers,key));assert.equal(request.method(),'GET');
            const headers=new Headers(await request.allHeaders());
            assert(headers.get('cookie')?.includes(MERCHANT_AUTH_COOKIE+'='));assert.equal(headers.get('x-merchant-access-token'),null);
            headers.set('host','www.faolla.com');headers.set('referer',canonical+'/');if(headers.has('origin'))headers.set('origin',canonical);
            const response=await handlers[key](new Request(canonical+url.pathname+url.search,{method:'GET',headers}),{enabled:()=>true,entitlement});
            const body=await response.text(),parsed=JSON.parse(body);
            const gate=key==='leave-notifications'&&holdNotification?holdNotification:null;
            if(gate)holdNotification=null;
            requests.push({key,actor:actor.id,method:request.method(),status:response.status,search:url.search,held:!!gate,
              error:typeof parsed.error==='string'?parsed.error:null,moduleEnabled:typeof parsed.moduleEnabled==='boolean'?parsed.moduleEnabled:null});
            if(gate){gate.ready.resolve(parsed);await gate.release.promise;}
            try{
              await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body});
              if(gate)gate.delivery='fulfilled';
            }catch(error){
              // A parent authorization epoch normally aborts this exact held
              // child fetch. Complete the gate without treating that expected
              // transport cancellation as a route failure; no other request is
              // allowed through this branch.
              if(!gate?.allowAbort)throw error;
              gate.delivery='aborted';
            }finally{if(gate){gate.finished.resolve();gates.delete(gate);}}
          })();
          pending.add(work);void work.finally(()=>pending.delete(work)).catch(()=>{});
          return work.catch(async()=>{if(!closing&&!route.request().failure())errors.push('route_failed');await route.abort().catch(()=>{});});
        });
        const page=await context.newPage();page.setDefaultTimeout(12000);
        page.on('pageerror',()=>errors.push('page_error'));page.on('dialog',dialog=>dialog.accept());
        await page.goto(origin+'/?'+new URLSearchParams(search));
        return {context,page};
      };

      try{
        phase='owner-parent-403-resets-child';
        const owner=await createPage(ownerActor,{siteId:data.site,access:'owner',actorId:data.owner});
        const admin=owner.page.getByRole('region',{name:'考勤配置管理',exact:true});
        await admin.getByRole('status').filter({hasText:'配置已读取。修改后需要点击保存。'}).waitFor();
        await admin.getByRole('button',{name:'请假申请审批',exact:true}).click();
        const ownerLeave=admin.getByRole('region',{name:'请假申请审批',exact:true});
        await ownerLeave.getByRole('status').filter({hasText:'已读取请假记录'}).waitFor();
        await ownerLeave.getByRole('button',{name:'查看申请详情',exact:true}).click();
        const ownerDetail=ownerLeave.getByRole('article',{name:'请假申请详情',exact:true});
        await ownerDetail.getByText(`申请理由：${reason}`,{exact:true}).waitFor();
        data.exec(`update public.merchants set user_id='${data.other}' where id='${data.site}';`);ownerRevoked=true;
        const adminHeader=admin.locator('header').filter({hasText:'员工考勤配置'});
        await adminHeader.getByRole('button',{name:'重新读取',exact:true}).click();
        await admin.getByRole('status').filter({hasText:'仅当前商户负责人可以管理考勤配置。'}).waitFor();
        await ownerLeave.waitFor({state:'detached'});
        assert.equal(await ownerDetail.count(),0);
        await admin.getByRole('button',{name:'请假申请审批',exact:true}).waitFor();
        assert(requests.some(item=>item.key==='admin'&&item.actor===data.owner&&item.status===403&&item.error==='attendance_access_denied'));
        data.exec(`update public.merchants set user_id='${data.owner}' where id='${data.site}';`);ownerRevoked=false;
        await adminHeader.getByRole('button',{name:'重新读取',exact:true}).click();
        await admin.getByRole('status').filter({hasText:'配置已读取。修改后需要点击保存。'}).waitFor();
        const ownerLeaveReads=requests.filter(item=>item.key==='leave'&&item.actor===data.owner).length;
        await admin.getByRole('button',{name:'请假申请审批',exact:true}).click();
        await ownerLeave.getByRole('status').filter({hasText:'已读取请假记录'}).waitFor();
        await ownerLeave.getByRole('button',{name:'查看申请详情',exact:true}).click();
        await ownerDetail.getByText(`申请理由：${reason}`,{exact:true}).waitFor();
        assert(requests.filter(item=>item.key==='leave'&&item.actor===data.owner&&item.status===200).length>ownerLeaveReads);

        phase='self-nonauthorization-failures-preserve-open-children';
        const self=await createPage(selfActor,{siteId:data.site,access:'self',employeeId:data.employeeId});
        const selfPanel=self.page.getByRole('region',{name:'我的考勤',exact:true});
        await selfPanel.getByRole('status').filter({hasText:'状态已与服务器同步。'}).waitFor();
        await selfPanel.getByRole('button',{name:'我的请假申请',exact:true}).click();
        const selfLeave=selfPanel.getByRole('region',{name:'我的请假申请',exact:true});
        await selfLeave.getByRole('status').filter({hasText:'已读取请假记录'}).waitFor();
        await selfLeave.getByRole('button',{name:'查看申请详情',exact:true}).click();
        const selfDetail=selfLeave.getByRole('article',{name:'请假申请详情',exact:true});
        await selfDetail.getByText(`申请理由：${reason}`,{exact:true}).waitFor();
        await selfPanel.getByRole('button',{name:'请假结果通知',exact:true}).click();
        const notifications=selfPanel.getByRole('region',{name:'请假结果通知',exact:true});
        await notifications.getByRole('status').filter({hasText:'已读取请假结果'}).waitFor();
        const approvedCard=notifications.getByRole('article',{name:'请假结果通知 已批准',exact:true});
        await approvedCard.getByRole('button',{name:'查看结果详情',exact:true}).click();
        const noticeDetail=notifications.getByRole('article',{name:'请假结果通知详情',exact:true});
        await noticeDetail.getByText(`通知编号：${decision.operationId}`,{exact:false}).waitFor();

        const selfHeader=selfPanel.locator('header').filter({hasText:'我的考勤'});
        moduleEnabled=false;
        await selfHeader.getByRole('button',{name:'刷新状态',exact:true}).click();
        await selfPanel.getByRole('status').filter({hasText:'状态已与服务器同步。'}).waitFor();
        const pausedRead=requests.filter(item=>item.key==='self'&&item.actor===data.employeeAuth).at(-1);
        assert.equal(pausedRead.status,200);assert.equal(pausedRead.moduleEnabled,false);
        await selfDetail.getByText(`申请理由：${reason}`,{exact:true}).waitFor();
        await noticeDetail.getByText(`通知编号：${decision.operationId}`,{exact:false}).waitFor();
        moduleEnabled=true;

        data.exec(`update public.merchant_attendance_settings set enabled=false where merchant_id='${data.site}';`);settingsDisabled=true;
        await selfHeader.getByRole('button',{name:'刷新状态',exact:true}).click();
        await selfPanel.getByRole('status').filter({hasText:'本企业尚未启用考勤'}).waitFor();
        const disabledRead=requests.filter(item=>item.key==='self'&&item.actor===data.employeeAuth).at(-1);
        assert.equal(disabledRead.status,403);assert.equal(disabledRead.error,'attendance_disabled');
        await selfDetail.getByText(`申请理由：${reason}`,{exact:true}).waitFor();
        await noticeDetail.getByText(`通知编号：${decision.operationId}`,{exact:false}).waitFor();
        data.exec(`update public.merchant_attendance_settings set enabled=true where merchant_id='${data.site}';`);settingsDisabled=false;
        await selfHeader.getByRole('button',{name:'刷新状态',exact:true}).click();
        await selfPanel.getByRole('status').filter({hasText:'状态已与服务器同步。'}).waitFor();

        parentRpcFailure='faolla_attendance_self_v1';
        await selfHeader.getByRole('button',{name:'刷新状态',exact:true}).click();
        await selfPanel.getByRole('status').filter({hasText:'暂时无法确认服务器结果'}).waitFor();
        const unavailableRead=requests.filter(item=>item.key==='self'&&item.actor===data.employeeAuth).at(-1);
        assert.equal(unavailableRead.status,503);assert.equal(unavailableRead.error,'attendance_unavailable');
        await selfDetail.getByText(`申请理由：${reason}`,{exact:true}).waitFor();
        await noticeDetail.getByText(`通知编号：${decision.operationId}`,{exact:false}).waitFor();
        await selfHeader.getByRole('button',{name:'刷新状态',exact:true}).click();
        await selfPanel.getByRole('status').filter({hasText:'状态已与服务器同步。'}).waitFor();

        phase='self-parent-403-resets-dirty-child-and-invalidates-late-read';
        await selfDetail.getByRole('button',{name:'返回申请列表',exact:true}).click();
        const leaveReason=selfLeave.getByLabel(/^请假理由/);
        await leaveReason.fill('父授权撤销前尚未提交的请假草稿');
        assert.equal(await leaveReason.inputValue(),'父授权撤销前尚未提交的请假草稿');
        const gate={ready:deferred(),release:deferred(),finished:deferred(),allowAbort:true,delivery:null};gates.add(gate);holdNotification=gate;
        await notifications.getByRole('button',{name:'重新读取通知',exact:true}).click();
        const held=await bounded(gate.ready.promise);assert.equal(held.ok,true);
        assert.equal(await noticeDetail.count(),0);
        data.exec(`update public.merchant_enterprise_employees set status='disabled' where merchant_id='${data.site}' and id='${data.employeeId}';`);employeeDisabled=true;
        await selfHeader.getByRole('button',{name:'刷新状态',exact:true}).click();
        await selfPanel.getByRole('status').filter({hasText:'当前账号没有可用的考勤权限或考勤档案'}).waitFor();
        await selfLeave.waitFor({state:'detached'});await notifications.waitFor({state:'detached'});
        assert.equal(await leaveReason.count(),0);
        await selfPanel.getByRole('button',{name:'我的请假申请',exact:true}).waitFor();
        await selfPanel.getByRole('button',{name:'请假结果通知',exact:true}).waitFor();
        assert(requests.some(item=>item.key==='self'&&item.actor===data.employeeAuth&&item.status===403&&item.error==='attendance_access_denied'));
        gate.release.resolve();await bounded(gate.finished.promise);
        assert(['fulfilled','aborted'].includes(gate.delivery));
        await self.page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
        assert.equal(await notifications.count(),0);assert.equal(await selfLeave.count(),0);
        assert.equal(await self.page.getByText(decision.operationId,{exact:false}).count(),0);
        assert(requests.some(item=>item.key==='leave-notifications'&&item.actor===data.employeeAuth&&item.status===200&&item.held));

        data.exec(`update public.merchant_enterprise_employees set status='active' where merchant_id='${data.site}' and id='${data.employeeId}';`);employeeDisabled=false;
        await selfHeader.getByRole('button',{name:'刷新状态',exact:true}).click();
        await selfPanel.getByRole('status').filter({hasText:'状态已与服务器同步。'}).waitFor();
        const selfLeaveReads=requests.filter(item=>item.key==='leave'&&item.actor===data.employeeAuth).length;
        await selfPanel.getByRole('button',{name:'我的请假申请',exact:true}).click();
        await selfLeave.getByRole('status').filter({hasText:'已读取请假记录'}).waitFor();
        assert.equal(await selfLeave.getByLabel(/^请假理由/).inputValue(),'');
        await selfLeave.getByRole('button',{name:'查看申请详情',exact:true}).click();
        await selfDetail.getByText(`申请理由：${reason}`,{exact:true}).waitFor();
        assert(requests.filter(item=>item.key==='leave'&&item.actor===data.employeeAuth&&item.status===200).length>selfLeaveReads);
        await selfPanel.getByRole('button',{name:'请假结果通知',exact:true}).click();
        await notifications.getByRole('status').filter({hasText:'已读取请假结果'}).waitFor();
        await notifications.getByRole('article',{name:'请假结果通知 已批准',exact:true}).getByRole('button',{name:'查看结果详情',exact:true}).click();
        await noticeDetail.getByText(`通知编号：${decision.operationId}`,{exact:false}).waitFor();

        phase='inactive-worker-resets-parent-but-leave-history-reopens';
        data.exec(`update public.merchant_attendance_workers set active=false where merchant_id='${data.site}' and id='${data.workerId}';`);workerInactive=true;
        await selfHeader.getByRole('button',{name:'刷新状态',exact:true}).click();
        await selfPanel.getByRole('status').filter({hasText:'当前账号没有可用的考勤权限或考勤档案'}).waitFor();
        await selfLeave.waitFor({state:'detached'});await notifications.waitFor({state:'detached'});
        const inactiveReads=requests.filter(item=>item.key==='leave'&&item.actor===data.employeeAuth).length;
        await selfPanel.getByRole('button',{name:'我的请假申请',exact:true}).click();
        await selfLeave.getByRole('status').filter({hasText:'已读取请假记录'}).waitFor();
        await selfLeave.getByRole('alert').filter({hasText:'当前身份没有请假申请权限'}).waitFor();
        await selfLeave.getByRole('button',{name:'查看申请详情',exact:true}).click();
        await selfDetail.getByText(`申请理由：${reason}`,{exact:true}).waitFor();
        assert(requests.filter(item=>item.key==='leave'&&item.actor===data.employeeAuth&&item.status===200).length>inactiveReads);
        data.exec(`update public.merchant_attendance_workers set active=true where merchant_id='${data.site}' and id='${data.workerId}';`);workerInactive=false;
        await selfHeader.getByRole('button',{name:'刷新状态',exact:true}).click();
        await selfPanel.getByRole('status').filter({hasText:'状态已与服务器同步。'}).waitFor();

        assert.equal(requests.some(item=>item.method==='POST'),false);
        assert.deepEqual(errors,[]);
        assert.deepEqual(counts(),baseline.counts);
        assert.equal(data.fingerprint(),baseline.fingerprint);
        assert.equal(data.protectedFingerprint(),baseline.protected);
        console.log(JSON.stringify({attendanceLeaveParentBoundaryRepair:true,repairAcceptancePassed:true,
          authorizationCleanupPassed:true,lateAuthorizedReplySuppressed:true,nonAuthorizationFailuresPreservedChildren:true,
          inactiveWorkerIndependentLeaveRead:true,requests:requests.length,rpcCalls:rpcCalls.length,counts:counts(),actualAdminPanel:true,actualSelfPanel:true,
          actualDefaultHandlers:true,syntheticAuth:true,realAuthService:false,realNextServer:false,productionAccess:false,screenshots:false,recordings:false}));
      }finally{
        for(const gate of gates)gate.release.resolve();
        await runAttendanceCleanupSteps([...contexts].map((context,index)=>({name:`leave-parent-boundary-context-${index}`,run:()=>context.close()}))
          .concat([{name:'leave-parent-boundary-routes',run:()=>Promise.allSettled([...pending])}]));
      }
    });
  }catch(error){
    console.error(JSON.stringify({attendanceLeaveParentBoundaryRepairFailed:true,phase,
      sourceLine:String(error?.stack??'').match(/leave-parent-boundary-browser-check\.mjs:(\d+):/)?.[1]??null,
      errors,requestCount:requests.length,authorizationCleanupPassed:false}));
    throw Error('leave_parent_boundary_browser_repair_failed');
  }finally{
    closing=true;for(const gate of gates)gate.release.resolve();
    if(data){
      try{
        if(ownerRevoked)data.exec(`update public.merchants set user_id='${data.owner}' where id='${data.site}';`);
        if(employeeDisabled)data.exec(`update public.merchant_enterprise_employees set status='active' where merchant_id='${data.site}' and id='${data.employeeId}';`);
        if(workerInactive)data.exec(`update public.merchant_attendance_workers set active=true where merchant_id='${data.site}' and id='${data.workerId}';`);
        if(settingsDisabled)data.exec(`update public.merchant_attendance_settings set enabled=true where merchant_id='${data.site}';`);
      }catch{errors.push('identity_restore_failed');}
    }
    await runAttendanceCleanupSteps([{name:'browser',run:()=>browser?.close()},{name:'routes',run:()=>Promise.allSettled([...pending])},
      {name:'harness',timeoutMs:10000,run:async()=>{if(child?.pid!==undefined&&child.exitCode===null&&child.signalCode===null){const stopped=once(child,'exit');child.kill();await stopped;}}}]);
    for(const [name,value] of savedFlags){if(value===undefined)delete process.env[name];else process.env[name]=value;}
  }
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  await runAttendanceLabelsReuse(process.argv.slice(2),native=>withAttendanceConcurrencySandbox(native,scope=>checkAttendanceLeaveParentBoundaryBrowser(native,scope)))
    .catch(()=>{console.error('leave_parent_boundary_browser_repair_failed');process.exitCode=1;});
}
