// Opt-in local acceptance of actual AdminClient / employee selector / Portal.
// Auth, merchant bootstrap, outer enterprise HTTP and entitlement are synthetic;
// every attendance response uses the original handler/default executor/owned SQL.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {readFileSync} from 'node:fs';
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
const {databaseActors}=require('./fixtures/attendance-database-transport.ts');
const {createAttendanceLeaveShellTransport}=require('./fixtures/attendance-leave-shell-transport.ts');
const {serveAttendanceMerchantBootstrap}=require('./fixtures/attendance-merchant-shell-transport.ts');
const {MERCHANT_AUTH_COOKIE}=require('../src/lib/merchantAuthSession.ts');
const {resolveValidatedMerchantEnterpriseAuthContext,requireMerchantEnterpriseEntitlement}=require('../src/lib/merchantEnterpriseAuth.server.ts');
const {handleAttendanceAdmin}=require('../src/app/api/merchant-enterprise/attendance/admin/route-handler.ts');
const {handleAttendanceSelf}=require('../src/app/api/merchant-enterprise/attendance/self/route-handler.ts');
const {handleLeave}=require('../src/app/api/merchant-enterprise/attendance/leave/route-handler.ts');
const {handleLeaveNotifications}=require('../src/app/api/merchant-enterprise/attendance/leave-notifications/route-handler.ts');
const {parseLeaveBody}=require('../src/lib/merchantAttendanceLeave.ts');
const {parseNotificationBody}=require('../src/lib/merchantAttendanceLeaveNotifications.ts');
const origin='https://127.0.0.1:3131',staticOrigin='http://127.0.0.1:3131',canonical='https://www.faolla.com';
const site='99990001',prefix='/api/merchant-enterprise/attendance/',leavePath=prefix+'leave',noticePath=prefix+'leave-notifications';
const localFetch=globalThis.fetch;
const confirmations={
  submit:'确认提交这份请假申请给负责人审批？提交不会自动扣假、改排班、阻止打卡或计算工资。',
  approve:'确认批准这份请假申请？批准只保存请假决定，不自动扣假、改排班、阻止打卡或计算工资。',
  read:'确认把这条站内请假结果通知标记为已读？这只保存已读时间，不改变请假决定或其他考勤事实。',
  leave:'当前页面有未保存的内容。切换功能将放弃这些修改，是否继续？',
};
const bounded=async(promise,label)=>{let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(label)),20000);})]);}finally{clearTimeout(timer);}};

// Test-only delayed transport: the original handler/SQL must finish first.
// Multiple claimed replies may coexist so an old A incarnation can be released
// while the new A incarnation's independent recovery GET remains held.
export function createLeaveShellResponseHolds(){
  const gates=new Set();let closed=false;
  const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
  return {
    holdResponse(criteria){
      assert(!closed);assert.deepEqual(Object.keys(criteria).sort(),['actorId','method','path']);
      assert(databaseActors.slice(1).some(actor=>actor.id===criteria.actorId));
      assert([leavePath,noticePath].includes(criteria.path)&&['GET','POST'].includes(criteria.method));
      assert(![...gates].some(g=>!g.claimed&&Object.keys(criteria).every(key=>g.criteria[key]===criteria[key])),'leave_shell_duplicate_hold');
      const gate={criteria:{...criteria},claimed:false,ready:deferred(),release:deferred(),finished:deferred()};gates.add(gate);
      return {ready:()=>bounded(gate.ready.promise,'leave_shell_hold_not_reached'),release:async()=>{
        assert(gate.claimed,'leave_shell_release_before_sql');gate.release.resolve();await bounded(gate.finished.promise,'leave_shell_hold_not_finished');
      }};
    },
    async deliver(record,payload,deliver){
      const gate=[...gates].find(g=>!g.claimed&&Object.keys(g.criteria).every(key=>record[key]===g.criteria[key]));
      if(!gate)return false;
      assert.equal(record.status,200,'leave_shell_hold_requires_success');gate.claimed=true;record.held=true;
      gate.ready.resolve(structuredClone(payload));
      try{await gate.release.promise;await deliver();}finally{gates.delete(gate);gate.finished.resolve();}
      return true;
    },
    close(){closed=true;for(const gate of gates)gate.release.resolve();},
    pendingCount:()=>gates.size,
  };
}

// Diagnostics deliberately omit credentials, reasons and arbitrary body fields.
export function leaveShellBrowserRecord(pathname,method,status,payload,input,query={}){
  assert(pathname.startsWith('/api/'));
  const command=input?.command;
  const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)?value:null;
  const knownAction=pathname===leavePath?['submit','approve'].includes(command?.action)?command.action:null:command?.action==='mark_read'?'mark_read':null;
  return {path:pathname,method,status,
    error:typeof payload?.error==='string'&&/^[a-z_]{1,80}$/.test(payload.error)?payload.error:null,
    ...(pathname===leavePath?{action:knownAction,operationId:uuid(command?.operationId??query?.operationId),requestId:uuid(input?.query?.requestId??query?.requestId)}:{}),
    ...(pathname===noticePath?{action:knownAction,notificationId:uuid(command?.notificationId??query?.notificationId),
      expectedEmployeeId:uuid(input?.query?.expectedEmployeeId??query?.expectedEmployeeId),expectedWorkerId:uuid(input?.query?.expectedWorkerId??query?.expectedWorkerId)}:{}),
  };
}

export function assertLeaveShellFacts(facts,{employeeId,workerId,authUserId,ownerId,submissionId,approvalId,marked}){
  assert(!marked||approvalId,'leave_shell_read_requires_approval');
  assert.equal(facts.requests.length,1);assert.equal(facts.entries.length,approvalId?2:1);
  assert.equal(facts.notifications.length,approvalId?1:0);assert.equal(facts.reads.length,marked?1:0);
  const request=facts.requests[0];
  assert.equal(request.merchant_id,site);assert.equal(request.request_id,submissionId);
  assert.equal(request.employee_id,employeeId);assert.equal(request.worker_id,workerId);assert.equal(request.actor_auth_user_id,authUserId);
  const submitted=facts.entries[0];
  assert.equal(submitted.merchant_id,site);
  assert.equal(submitted.request_id,submissionId);assert.equal(submitted.operation_id,submissionId);
  assert.equal(submitted.revision,1);assert.equal(submitted.action,'submit');assert.equal(submitted.actor_auth_user_id,authUserId);
  if(approvalId){
    const approved=facts.entries[1];assert.equal(approved.merchant_id,site);assert.equal(approved.request_id,submissionId);assert.equal(approved.operation_id,approvalId);
    assert.equal(approved.revision,2);assert.equal(approved.action,'approve');assert.equal(approved.actor_auth_user_id,ownerId);
    const notice=facts.notifications[0];assert.equal(notice.notification_id,approvalId);assert.equal(notice.request_id,submissionId);
    assert.equal(notice.action,'approve');assert.equal(notice.revision,2);
    for(const row of [notice,...facts.reads]){
      assert.equal(row.merchant_id,site);assert.equal(row.worker_id,workerId);assert.equal(row.employee_id,employeeId);
      assert.equal(row.recipient_auth_user_id,authUserId);assert.equal(row.notification_id,approvalId);
    }
  }
  if(marked)assert(Number.isFinite(Date.parse(facts.reads[0].read_at)));
}

export async function checkAttendanceLeaveShellBrowser(native,scope,{accountSwitchCheck}={}){
  assert(accountSwitchCheck===undefined||typeof accountSwitchCheck==='function','leave_shell_invalid_scenario');
  const flags=['FAOLLA_ATTENDANCE_LEAVE_ENABLED','FAOLLA_ATTENDANCE_LEAVE_NOTIFICATIONS_ENABLED','FAOLLA_PLATFORM_SNAPSHOT_WRITE_MODE'];
  const saved=new Map(flags.map(key=>[key,process.env[key]]));
  process.env.FAOLLA_ATTENDANCE_LEAVE_ENABLED='1';process.env.FAOLLA_ATTENDANCE_LEAVE_NOTIFICATIONS_ENABLED='1';process.env.FAOLLA_PLATFORM_SNAPSHOT_WRITE_MODE='off';
  let child,browser,closing=false,dropSubmission=false,phase='fixture';
  const contexts=new Set(),pendingRoutes=new Set(),requests=[],errors=[],external=[],dialogStates=new Map(),commits=[],holds=createLeaveShellResponseHolds();
  try{
    const data=await prepareLeaveNotificationsNativeFixture(native,scope);
    assert.equal(data.owner,databaseActors[0].id);assert.equal(data.employeeAuth,databaseActors[1].id);assert.notEqual(data.employeeAuth,data.employeeId);
    // The generic local foundation predates111. Upgrade only the owned schema
    // and enable its synthetic settings before capturing the protected baseline.
    const currentSelf=readFileSync(path.join(native.root,'scripts/supabase-migrations/202610020111_merchant_attendance_self_clock_identity.sql'),'utf8')
      .replace(/^begin;\s*$/m,'').replace(/^commit;\s*$/m,'');
    data.exec(currentSelf);
    assert(data.exec("select pg_get_functiondef('public.faolla_attendance_self_v1(text,uuid,jsonb,uuid)'::regprocedure);").includes('actor_employee_id'));
    data.exec(`update public.merchant_attendance_settings set enabled=true where merchant_id='${site}';`);
    const protectedBefore=data.protectedFingerprint(),transport=createAttendanceLeaveShellTransport(data.exec);
    const tables={requests:'merchant_attendance_leave_requests',entries:'merchant_attendance_leave_entries',notifications:'merchant_attendance_leave_notifications',reads:'merchant_attendance_leave_notification_reads'};
    const facts=()=>Object.fromEntries(Object.entries(tables).map(([key,table])=>[key,JSON.parse(data.exec(`select coalesce(jsonb_agg(to_jsonb(r) order by ${key==='entries'?'r.revision':'to_jsonb(r)::text'}),'[]'::jsonb) from public.${table} r;`))]));
    const counts=()=>Object.fromEntries(Object.entries(facts()).map(([key,rows])=>[key,rows.length]));
    const safe=()=>assert.equal(data.protectedFingerprint(),protectedBefore,'leave_shell_protected_facts_changed');
    assert.deepEqual(counts(),{requests:0,entries:0,notifications:0,reads:0});
    const probe=net.createServer();await new Promise((resolve,reject)=>{probe.once('error',reject);probe.listen(3131,'127.0.0.1',resolve);});await new Promise(resolve=>probe.close(resolve));
    child=spawn(process.execPath,['scripts/attendance-self-browser-harness.mjs','--merchant-shell','--leave-shell'],{cwd:native.root,windowsHide:true,stdio:['ignore','pipe','pipe']});
    child.stderr.on('data',()=>errors.push('harness_stderr'));
    await bounded(new Promise((resolve,reject)=>{let output='';child.stdout.on('data',value=>{output+=String(value);if(output.includes('Attendance synthetic component QA'))resolve();});child.once('error',()=>reject(Error('harness_start_failed')));child.once('exit',()=>reject(Error('harness_exited')));}), 'leave_shell_harness_timeout');
    assert.equal((await localFetch(staticOrigin+leavePath,{method:'POST'})).status,403);
    browser=await chromium.launch({headless:true});
    await withAttendanceApplicationAuth(databaseActors,transport.rpc,async auth=>{
      const entitlement=value=>requireMerchantEnterpriseEntitlement(value,async()=>[{id:site,permissionConfig:{allowEnterpriseManagement:true,allowEmployeeAttendance:transport.state.moduleEnabled}}]);
      const handlers={admin:handleAttendanceAdmin,self:handleAttendanceSelf,leave:handleLeave,'leave-notifications':handleLeaveNotifications};
      const newPage=async owner=>{
        const context=await browser.newContext({viewport:owner?{width:1280,height:1050}:{width:390,height:844},isMobile:!owner,hasTouch:!owner,serviceWorkers:'block',acceptDownloads:false});contexts.add(context);
        await context.addInitScript(()=>localStorage.setItem('merchant-space:locale:v1','zh-CN'));
        if(owner)await context.addCookies([{name:MERCHANT_AUTH_COOKIE,value:await auth.login(databaseActors[0]),url:origin,secure:true,httpOnly:true,sameSite:'Lax'}]);
        await context.route('**/*',route=>{
          if(closing)return route.abort().catch(()=>{});
          const work=(async()=>{
            const r=route.request(),url=new URL(r.url());
            if(url.origin!==origin){external.push('external_request');return route.abort();}
            if(owner&&['/auth/v1/settings','/rest/v1/'].includes(url.pathname)){assert.equal(r.method(),'GET');return route.fulfill({status:200,contentType:'application/json',body:'{}'});}
            if(owner&&url.pathname==='/downloads/faolla-android-version.json'){assert.equal(r.method(),'GET');return route.fulfill({status:404,contentType:'application/json',body:'{}'});}
            if(url.pathname.startsWith('/auth/v1/')){
              assert.equal(owner,false,'leave_shell_owner_login_not_under_test');
              const response=await fetch(new Request('https://attendance-auth.invalid'+url.pathname+url.search,{method:r.method(),headers:await r.allHeaders(),body:r.postData()??undefined}));
              return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:await response.text()});
            }
            if(!url.pathname.startsWith('/api/')){
              assert.equal(r.method(),'GET');assert(['/99990001','/enterprise','/enterprise/99990001','/harness.js','/harness.css'].includes(url.pathname));
              const response=await localFetch(staticOrigin+url.pathname);assert.equal(response.status,200,'leave_shell_static_route_failed');return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});
            }
            const headers=new Headers(await r.allHeaders());
            if(owner){assert.equal(headers.get('x-merchant-access-token'),null);assert(headers.get('cookie')?.includes(MERCHANT_AUTH_COOKIE+'='));}
            else{assert(headers.get('x-merchant-access-token'));assert.equal(headers.get('cookie'),null);}
            if(headers.get('origin')===origin)headers.set('origin',canonical);
            if(headers.get('referer')?.startsWith(origin+'/'))headers.set('referer',canonical+headers.get('referer').slice(origin.length));headers.set('host','www.faolla.com');
            const input=r.postData()?JSON.parse(r.postData()):null,request=new Request(canonical+url.pathname+url.search,{method:r.method(),headers,body:r.postData()??undefined});
            const identity=await resolveValidatedMerchantEnterpriseAuthContext(request),actorId=identity.user.id;
            assert((owner?[data.owner]:accountSwitchCheck?[data.employeeAuth,data.otherAuth]:[data.employeeAuth]).includes(actorId),'leave_shell_unexpected_actor');
            let response;
            if(url.pathname.startsWith(prefix)){
              const key=url.pathname.slice(prefix.length);assert(Object.hasOwn(handlers,key),'leave_shell_unexpected_attendance_endpoint');
              assert(r.method()==='GET'||r.method()==='POST'&&['leave','leave-notifications'].includes(key),'leave_shell_parent_writes_forbidden');
              if(r.method()==='POST'){
                assert(owner||actorId===data.employeeAuth,'leave_shell_other_employee_write_forbidden');
                const parsed=key==='leave'?parseLeaveBody(input):parseNotificationBody(input);
                assert.equal(parsed.query.siteId,site);
                assert(key==='leave'?parsed.command.action===(owner?'approve':'submit'):!owner&&parsed.command.action==='mark_read','leave_shell_unexpected_action');
              }
              response=await handlers[key](request,{entitlement});
            }else{
              if(['/api/merchant-enterprise/current-operations','/api/merchant-enterprise/todos','/api/merchant-enterprise/workflow-permission-gaps'].includes(url.pathname)){
                assert.equal(r.method(),'GET');response=Response.json({ok:false,error:'synthetic_unrelated_read_out_of_scope'},{status:503});
              }else response=(owner?serveAttendanceMerchantBootstrap(request,identity.user.id):null)??await transport.serveShell(request,identity.user.id);
            }
            const body=await response.text(),payload=JSON.parse(body),record={...leaveShellBrowserRecord(url.pathname,r.method(),response.status,payload,input,Object.fromEntries(url.searchParams)),actor:owner?'owner':'employee',actorId};requests.push(record);
            if(url.pathname.startsWith(prefix)&&r.method()==='POST'&&response.status===200)commits.push({path:url.pathname,input:structuredClone(input),body:payload,actorId});
            if(dropSubmission&&url.pathname===leavePath&&r.method()==='POST'&&!owner&&response.status===200){dropSubmission=false;record.dropped=true;return route.abort('connectionreset');}
            if(accountSwitchCheck&&await holds.deliver(record,payload,async()=>{
              try{await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body});record.delivery='fulfilled';}
              catch(error){if(r.failure()?.errorText!=='net::ERR_ABORTED')throw error;record.delivery='browser_aborted';}
            }))return;
            return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body});
          })();pendingRoutes.add(work);void work.finally(()=>pendingRoutes.delete(work)).catch(()=>{});
          return work.catch(async error=>{if(!closing)errors.push({kind:'route_failed',sourceLine:String(error?.stack??'').match(/leave-shell-browser-check\.mjs:(\d+):/)?.[1]??null});await route.abort().catch(()=>{});});
        });
        const page=await context.newPage(),dialogState={expected:null,beforeUnload:false,accepted:0};dialogStates.set(page,dialogState);page.setDefaultTimeout(12000);
        page.on('pageerror',()=>errors.push('page_error'));
        page.on('dialog',async dialog=>{
          if(dialog.type()==='beforeunload'&&dialog.message()===''&&dialogState.beforeUnload&&new URL(page.url()).origin===origin){dialogState.beforeUnload=false;await dialog.accept();return;}
          if(dialog.type()==='confirm'&&dialogState.expected===dialog.message()){dialogState.expected=null;dialogState.accepted++;await dialog.accept();return;}
          errors.push('unexpected_dialog');await dialog.dismiss();
        });
        return page;
      };
      const owner=await newPage(true),phone=await newPage(false);
      const self=()=>phone.getByRole('region',{name:'我的考勤',exact:true}),selfLeave=()=>self().getByRole('region',{name:'我的请假申请',exact:true});
      const admin=()=>owner.getByRole('region',{name:'考勤配置管理',exact:true}),ownerLeave=()=>admin().getByRole('region',{name:'请假申请审批',exact:true});
      const notice=()=>self().getByRole('region',{name:'请假结果通知',exact:true}),nav=()=>phone.getByRole('navigation',{name:'企业管理功能',exact:true});
      const writes=()=>requests.filter(row=>row.path.startsWith(prefix)&&row.method==='POST');
      const leaveReads=()=>requests.filter(row=>row.path===leavePath&&row.actor==='employee'&&row.method==='GET');
      const notificationReads=()=>requests.filter(row=>row.path===noticePath&&row.method==='GET');
      const waitReply=(page,pathname,method,operationId)=>{
        const waiting=page.waitForResponse(reply=>{const url=new URL(reply.url());return url.pathname===pathname&&reply.request().method()===method&&(operationId===undefined||url.searchParams.get('operationId')===operationId);})
          .then(async reply=>{assert.equal(reply.status(),200);return reply.json();});void waiting.catch(()=>{});return waiting;
      };
      const confirmClick=async(page,button,kind)=>{const state=dialogStates.get(page);assert.equal(state.expected,null);state.expected=confirmations[kind];await button.click();assert.equal(state.expected,null,'leave_shell_expected_confirmation_missing');};
      const navigate=async label=>{const button=nav().getByRole('button',{name:label,exact:true});if(!await button.isVisible())await phone.getByRole('button',{name:'打开员工工作区导航',exact:true}).click();await button.click();};
      const enterSelf=async()=>{await nav().waitFor({state:'attached'});const done=waitReply(phone,prefix+'self','GET');await navigate('我的考勤');await done;await self().getByRole('button',{name:'我的请假申请',exact:true}).waitFor();};
      const pendingKey=`faolla:attendance:leave:v1:${site}:self:${data.employeeId}`;
      const pending=()=>phone.evaluate(key=>sessionStorage.getItem(key),pendingKey);
      let submissionId,approvalId;
      const verify=marked=>assertLeaveShellFacts(facts(),{employeeId:data.employeeId,workerId:data.workerId,authUserId:data.employeeAuth,ownerId:data.owner,submissionId,approvalId,marked});
      try{
        if(accountSwitchCheck){
          const result=await accountSwitchCheck({owner,phone,data,databaseActors,origin,site,prefix,leavePath,noticePath,requests,commits,transport,errors,external,
            facts,counts,safe,native,holdResponse:holds.holdResponse,confirmClick,dialogStates,setPhase:value=>{phase=value;},assertLeaveShellFacts});
          assert.equal(holds.pendingCount(),0);assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert.deepEqual(transport.errors,[]);safe();
          console.log(JSON.stringify({...result,leaveAccountSwitchBrowser:true,actualPortal:true,defaultAttendanceHandlers:true,realOwnedSql:true,
            protectedFactsUnchanged:true,syntheticAuth:true,syntheticEnterpriseShellTransport:true,realAuthService:false,realPostgrest:false,realNextServer:false,realPhone:false,productionAccess:false,externalRequests:0,
            heldReplies:requests.filter(row=>row.held).map(({path,method,delivery})=>({path,method,delivery}))}));return;
        }
        phase='actual-shell-entry';
        await owner.goto(origin+'/'+site);await owner.evaluate(()=>sessionStorage.setItem('qa-unrelated-leave-shell','preserve'));
        await owner.getByRole('button',{name:'企业管理',exact:true}).click();await owner.getByRole('button',{name:'考勤配置',exact:true}).click();
        await admin().getByRole('button',{name:'请假申请审批',exact:true}).waitFor();
        await phone.goto(origin+'/enterprise');await phone.evaluate(()=>sessionStorage.setItem('qa-unrelated-leave-shell','preserve'));
        await phone.getByLabel('员工邮箱',{exact:true}).fill(databaseActors[1].email);await phone.getByLabel('密码',{exact:true}).fill('Synthetic-attendance-only!');
        await phone.getByRole('button',{name:'登录并选择企业',exact:true}).click();await phone.locator('article').filter({hasText:`企业编号 ${site}`}).getByRole('button',{name:'进入工作台',exact:true}).click();await enterSelf();
        assert.equal(requests.filter(row=>[leavePath,noticePath].includes(row.path)).length,0);assert.equal(writes().length,0);safe();
        native.pass('actual owner AdminClient and employee SDK selector/Portal reach their parent attendance pages while closed leave/notification launchers perform zero business reads');

        phase='employee-submit-lost-reply';
        await self().getByRole('button',{name:'我的请假申请',exact:true}).click();await selfLeave().getByRole('status').filter({hasText:'已读取请假记录'}).waitFor();
        await selfLeave().getByText('本页没有请假申请，不代表没有排班、出勤或假期余额。',{exact:true}).waitFor();
        await selfLeave().getByLabel('请假开始时间',{exact:true}).fill(data.time.startAt.slice(0,16));await selfLeave().getByLabel('请假结束时间',{exact:true}).fill(data.time.endAt.slice(0,16));
        await selfLeave().getByRole('button',{name:'生成请假预览',exact:true}).click();await selfLeave().getByRole('region',{name:'请假时段预览',exact:true}).waitFor();
        await selfLeave().getByLabel(/^请假理由/).fill('第137批完整企业壳合成请假申请');await selfLeave().getByRole('checkbox',{name:/我已核对申请人、企业时区、两端 UTC 时差/}).check();
        dropSubmission=true;await confirmClick(phone,selfLeave().getByRole('button',{name:'明确提交请假申请',exact:true}),'submit');await selfLeave().getByRole('button',{name:'用原编号明确重试',exact:true}).waitFor();
        const originalPending=await pending();assert(originalPending);const stored=JSON.parse(originalPending);submissionId=stored.command.operationId;
        assert.equal(stored.employeeId,data.employeeId);assert.equal(stored.actorId,data.employeeAuth);assert.equal(stored.command.action,'submit');
        assert.equal(stored.command.startAt,data.time.startAt);assert.equal(stored.command.endAt,data.time.endAt);
        assert.equal(writes().length,1);assert.equal(writes()[0].dropped,true);assert.equal(await selfLeave().getByRole('region',{name:'请假操作收据',exact:true}).count(),0);verify(false);safe();
        const submittedFacts=facts(),submittedCommit=commits[0];assert.equal(submittedCommit.body.receipt.command.operationId,submissionId);
        native.pass('actual employee form explicitly submits one browser-generated operation to122; a lost successful reply leaves the original pending and one immutable request/entry');

        phase='real-reload-original-receipt';
        const beforeReads=leaveReads().length,timeOrigin=await phone.evaluate(()=>performance.timeOrigin);dialogStates.get(phone).beforeUnload=true;
        await phone.reload();dialogStates.get(phone).beforeUnload=false;await enterSelf();assert.notEqual(await phone.evaluate(()=>performance.timeOrigin),timeOrigin);
        assert.equal(await pending(),originalPending);assert.equal(leaveReads().length,beforeReads);assert.equal(writes().length,1);
        const recoveredReply=waitReply(phone,leavePath,'GET',submissionId);await self().getByRole('button',{name:'我的请假申请',exact:true}).click();const recovered=await recoveredReply;
        await selfLeave().getByRole('region',{name:'请假操作收据',exact:true}).waitFor();assert.deepEqual(recovered.receipt,submittedCommit.body.receipt);
        assert.equal(await pending(),null);assert.equal(writes().length,1);assert.deepEqual(facts(),submittedFacts);safe();
        native.pass('real employee document reload preserves SDK identity and exact pending bytes; explicitly reopening leave recovers the committed original receipt by GET with no repeat POST');

        phase='owner-original-approval';
        await admin().getByRole('button',{name:'请假申请审批',exact:true}).click();await ownerLeave().getByRole('button',{name:'查看申请详情',exact:true}).click();
        const ownerDetail=ownerLeave().getByRole('article',{name:'请假申请详情',exact:true});await ownerDetail.getByRole('heading',{name:/待审批/}).waitFor();
        await ownerLeave().getByLabel(/^决定理由/).fill('第137批完整企业壳负责人明确批准');await ownerLeave().getByRole('checkbox',{name:/我已核对申请人、时段、时区、当前状态/}).check();
        const approvalReply=waitReply(owner,leavePath,'POST');await confirmClick(owner,ownerLeave().getByRole('button',{name:'明确批准请假申请',exact:true}),'approve');const approved=await approvalReply;
        approvalId=approved.receipt.command.operationId;assert.notEqual(approvalId,submissionId);await ownerDetail.getByRole('heading',{name:/已批准/}).waitFor();
        verify(false);assert.deepEqual(facts().requests,submittedFacts.requests);assert.deepEqual(facts().entries[0],submittedFacts.entries[0]);assert.equal(writes().length,2);assert.equal(notificationReads().length,0);safe();
        native.pass('actual owner enterprise navigation opens original all-records leave detail; one explicit approval uses125 capture wrapper, preserving submission and adding exactly one decision/notice');

        phase='employee-explicit-notification';
        await self().getByRole('button',{name:'请假结果通知',exact:true}).click();await notice().getByRole('status').filter({hasText:'已读取请假结果'}).waitFor();
        const approvedCard=notice().getByRole('article',{name:'请假结果通知 已批准',exact:true});await approvedCard.getByText('未读',{exact:true}).waitFor();
        await approvedCard.getByRole('button',{name:'查看结果详情',exact:true}).click();const detail=notice().getByRole('article',{name:'请假结果通知详情',exact:true});await detail.getByText(/当前仍为已批准 · 当前修订 2/).waitFor();
        verify(false);assert.equal(writes().length,2);const beforeMark=facts(),markReply=waitReply(phone,noticePath,'POST');
        await confirmClick(phone,detail.getByRole('button',{name:'明确标记已读',exact:true}),'read');await markReply;await detail.getByRole('button',{name:'这条通知已读',exact:true}).waitFor();
        verify(true);assert.deepEqual({...facts(),reads:beforeMark.reads},beforeMark);assert.equal(writes().length,3);safe();
        native.pass('employee explicitly reads the captured approval without auto-read; only the separate confirmed mark-read POST appends one original-recipient read marker');

        phase='full-shell-navigation-reread';
        const finalFacts=facts(),finalPosts=writes().length;
        dialogStates.get(phone).expected=confirmations.leave;await navigate('待办中心');assert.equal(dialogStates.get(phone).expected,null,'leave_shell_navigation_confirmation_missing');await self().waitFor({state:'detached'});const readsAfterExit=notificationReads().length;
        await enterSelf();assert.equal(await notice().count(),0);assert.equal(notificationReads().length,readsAfterExit);
        await self().getByRole('button',{name:'请假结果通知',exact:true}).click();await notice().getByRole('article',{name:'请假结果通知 已批准',exact:true}).getByText('已读',{exact:true}).waitFor();
        assert.deepEqual(facts(),finalFacts);assert.equal(writes().length,finalPosts);
        for(const page of [owner,phone]){assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'leave_shell_horizontal_overflow');assert.equal(await page.evaluate(()=>sessionStorage.getItem('qa-unrelated-leave-shell')),'preserve');}
        assert.equal(dialogStates.get(owner).accepted,1);assert.equal(dialogStates.get(phone).accepted,3);
        assert.deepEqual(writes().map(row=>[row.actor,row.path,row.action]),[['employee',leavePath,'submit'],['owner',leavePath,'approve'],['employee',noticePath,'mark_read']]);
        assert.equal(writes()[0].operationId,submissionId);assert.equal(writes()[1].operationId,approvalId);assert.equal(writes()[2].notificationId,approvalId);
        assert.deepEqual(transport.calls.filter(row=>row.action).map(row=>[row.name,row.action]),[['faolla_attendance_leave_v1','submit'],['faolla_attendance_leave_notify_v1','approve'],['faolla_attendance_leave_notifications_v1','mark_read']]);
        assert.equal(await phone.evaluate(key=>sessionStorage.getItem(key),`faolla:attendance:leave-notifications:v1:${site}:${data.employeeId}`),null);
        assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert.deepEqual(transport.errors,[]);safe();
        native.pass('actual enterprise navigation away/back discards opened children; explicit notification reopen shows the same read marker, with no fourth attendance POST and no390px overflow');
        console.log(JSON.stringify({leaveShellBrowser:true,checkpoints:6,actualAdminClient:true,actualEmployeeSelector:true,actualPortal:true,actualParents:true,
          defaultAttendanceHandlers:true,defaultAttendanceExecutors:true,realOwnedSql:true,attendancePosts:3,counts:counts(),lostSubmissionRecoveredAfterRealReload:true,
          protectedFactsUnchanged:true,syntheticOwnerCookieAndBootstrap:true,syntheticEnterpriseShellTransport:true,syntheticAuth:true,
          realMerchantLoginPage:false,realOuterEnterpriseHandlers:false,realAuthService:false,realPostgrest:false,realNextServer:false,realPhone:false,productionAccess:false,externalRequests:0}));
      }catch(error){
        console.error(JSON.stringify({leaveShellUiCheckpoint:phase,employeePage:await phone.evaluate(()=>({
          path:location.pathname,ready:document.readyState,headings:[...document.querySelectorAll('h1,h2')].map(el=>el.textContent),
          inputTypes:[...document.querySelectorAll('input')].map(el=>el.type),buttons:[...document.querySelectorAll('button')].map(el=>el.textContent),
          hasRoot:!!document.querySelector('#qa-root'),
        })).catch(()=>null)}));
        throw error;
      }finally{
        closing=true;holds.close();
        await runAttendanceCleanupSteps([...contexts].map((context,index)=>({name:`leave-shell-context-${index}`,run:()=>context.close()}))
          .concat([{name:'leave-shell-routes',run:()=>Promise.allSettled([...pendingRoutes])}]));
      }
    });
  }catch(error){
    console.error(JSON.stringify({leaveShellBrowserFailed:true,phase,sourceLine:String(error?.stack??'').match(/leave-shell-browser-check\.mjs:(\d+):/)?.[1]??null,errors,
      requests:requests.map(({path,method,status,error:code,action})=>({path,method,status,error:code,...(action?{action}:{})}))}));
    throw Error('leave_shell_browser_failed');
  }finally{
    closing=true;holds.close();
    try{await runAttendanceCleanupSteps([{name:'leave-shell-browser',run:()=>browser?.close()},{name:'leave-shell-pending-routes',run:()=>Promise.allSettled([...pendingRoutes])},
      {name:'leave-shell-harness',timeoutMs:10000,run:async()=>{if(child?.pid!==undefined&&child.exitCode===null&&child.signalCode===null){const stopped=once(child,'exit');child.kill();await stopped;}}}]);}
    finally{for(const [key,value] of saved){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
  }
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  await runAttendanceLabelsReuse(process.argv.slice(2),native=>withAttendanceConcurrencySandbox(native,scope=>checkAttendanceLeaveShellBrowser(native,scope)))
    .catch(()=>{console.error('leave_shell_browser_failed');process.exitCode=1;});
}
