// Real browser -> real attendance handler -> default executor/SDK -> service_role
// SQL in an owned disposable schema. Auth and enterprise bootstrap are synthetic;
// NOT a full Next / TLS / real Supabase Auth acceptance. --merchant-shell adds
// the actual full AdminClient (cookie-authenticated bootstrap remains synthetic).
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import {createRequire} from 'node:module';
import {chromium} from 'playwright';
import {runAttendanceLabelsReuse} from './merchant-attendance-choice-labels-reuse-native.mjs';
import {withAttendanceConcurrencySandbox} from './merchant-attendance-concurrency-sandbox.mjs';
const require=createRequire(import.meta.url);
const {withAttendanceApplicationAuth}=require('./fixtures/attendance-application-auth.ts');
const {createAttendanceDatabaseTransport,databaseId:id,databaseActors:actors}=require('./fixtures/attendance-database-transport.ts');
const {serveAttendanceMerchantBootstrap}=require('./fixtures/attendance-merchant-shell-transport.ts');
const {createAttendanceMerchantIdentityReads}=require('./fixtures/attendance-merchant-login-transport.ts');
const actualMerchantLogin=process.argv.includes('--merchant-login');
const fullAdminClient=process.argv.includes('--merchant-shell')||actualMerchantLogin;
const {POST:merchantLogin}=require('../src/app/api/auth/merchant-login/route.ts');
const {GET:merchantSession}=require('../src/app/api/auth/merchant-session/route.ts');
const {POST:merchantLogout}=require('../src/app/api/auth/merchant-logout/route.ts');
const {resolveValidatedMerchantEnterpriseAuthContext,requireMerchantEnterpriseEntitlement}=require('../src/lib/merchantEnterpriseAuth.server.ts');
const {MERCHANT_AUTH_COOKIE,MERCHANT_AUTH_REFRESH_COOKIE}=require('../src/lib/merchantAuthSession.ts');
const {handleAttendanceSelf}=require('../src/app/api/merchant-enterprise/attendance/self/route-handler.ts');
const {handleAttendanceAdmin}=require('../src/app/api/merchant-enterprise/attendance/admin/route-handler.ts');
const {handleAttendanceHistory}=require('../src/app/api/merchant-enterprise/attendance/history/route-handler.ts');
const origin='https://127.0.0.1:3131',staticOrigin='http://127.0.0.1:3131',canonical='https://www.faolla.com',localFetch=globalThis.fetch;

async function check(native){
  const {root,query,pass}=native;
  await withAttendanceConcurrencySandbox(native,async({sql})=>{
    const exec=source=>query(sql(source));
    for(const migration of [
      '202609300068_merchant_attendance_self_history.sql',
      '202610020110_merchant_attendance_self_history_identity.sql',
      '202610020111_merchant_attendance_self_clock_identity.sql',
    ])exec(readFileSync(path.join(root,'scripts/supabase-migrations',migration),'utf8'));
    // Seed only synthetic pre-existing enterprise identities. All attendance
    // configuration, worker enrollment and events below originate in real UI.
    exec(`begin;insert into public.merchants(id,user_id) values('99990001','${actors[0].id}');
      insert into public.merchant_enterprise_roles(id,merchant_id,name,permissions) values
      ('${id(30)}','99990001','合成甲角色',array['enterprise.view','attendance.self.view','attendance.self.clock']),
      ('${id(31)}','99990001','合成乙角色',array['enterprise.view','attendance.self.view','attendance.self.clock']);
      insert into public.merchant_enterprise_employees(id,merchant_id,auth_user_id,email,display_name,role_id,status) values
      ('${id(101)}','99990001','${actors[1].id}','${actors[1].email}','合成员工甲','${id(30)}','active'),
      ('${id(102)}','99990001','${actors[2].id}','${actors[2].email}','合成员工乙','${id(31)}','active');commit;`);
    const transport=createAttendanceDatabaseTransport(exec);
    const merchantIdentity=createAttendanceMerchantIdentityReads(exec);
    const eventRows=()=>JSON.parse(exec("select coalesce(jsonb_agg(to_jsonb(e) order by worker_id,sequence),'[]'::jsonb) from public.merchant_attendance_events e;"));
    const configCount=()=>Number(exec('select count(*) from public.merchant_attendance_config_operations;'));
    const probe=net.createServer();await new Promise((resolve,reject)=>{probe.once('error',reject);probe.listen(3131,'127.0.0.1',resolve);});await new Promise(resolve=>probe.close(resolve));
    const child=spawn(process.execPath,['scripts/attendance-self-browser-harness.mjs','--database-entry',...(fullAdminClient?['--merchant-shell']:[])],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});
    let browser;const errors=[],external=[],requests=[],dialogs=[],tokens=new Map();const control={lose:null,acceptDialogs:true};
    try{
      await new Promise((resolve,reject)=>{let output='';const timer=setTimeout(()=>reject(Error('database_browser_harness_timeout')),20000);child.stdout.on('data',c=>{output+=String(c);if(output.includes('Attendance synthetic component QA')){clearTimeout(timer);resolve();}});child.stderr.on('data',c=>errors.push(String(c)));child.once('exit',code=>{clearTimeout(timer);reject(Error('database_browser_harness_exit_'+code));});});
      assert.equal((await localFetch(staticOrigin+'/api/merchant-enterprise/attendance/self',{method:'POST'})).status,403);
      browser=await chromium.launch({headless:true});
      await withAttendanceApplicationAuth(actors,transport.rpc,async auth=>{
        const handlers={self:handleAttendanceSelf,admin:handleAttendanceAdmin,history:handleAttendanceHistory};
        const entitlement=siteId=>requireMerchantEnterpriseEntitlement(siteId,async()=>[{id:'99990001',permissionConfig:{allowEnterpriseManagement:true,allowEmployeeAttendance:transport.state.moduleEnabled}}]);
        const newPage=async({owner=false,mobile=false,refreshOnly=false}={})=>{
          const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1280,height:960},isMobile:mobile,hasTouch:mobile,serviceWorkers:'block'});
          if(fullAdminClient)await context.addInitScript(()=>localStorage.setItem('merchant-space:locale:v1','zh-CN'));
          if(owner&&!actualMerchantLogin)await context.addCookies([{name:MERCHANT_AUTH_COOKIE,value:await auth.login(actors[0]),url:origin,secure:true,httpOnly:true,sameSite:'Lax'}]);
          await context.route('**/*',async route=>{
            const r=route.request(),url=new URL(r.url());
            if(url.origin!==origin){external.push(url.origin+url.pathname);return route.abort();}
            if(fullAdminClient&&owner&&['/auth/v1/settings','/rest/v1/'].includes(url.pathname)){
              assert.equal(r.method(),'GET');return route.fulfill({status:200,contentType:'application/json',body:'{}'});
            }
            if(!url.pathname.startsWith('/api/')&&!url.pathname.startsWith('/auth/v1/')){
              if(r.method()!=='GET'||!['/owner','/99990001','/login','/enterprise','/enterprise/99990001','/harness.js','/harness.css'].includes(url.pathname))return route.abort();
              const response=await localFetch(staticOrigin+url.pathname);return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});
            }
            try{
              const headers=new Headers(await r.allHeaders()),body=r.postData()??undefined;
              let response;
              if(url.pathname.startsWith('/auth/v1/'))response=await fetch(new Request('https://attendance-auth.invalid'+url.pathname+url.search,{headers,method:r.method(),body}));
              else{
                if(owner){assert.equal(headers.get('x-merchant-access-token'),null);if(!actualMerchantLogin)assert(headers.get('cookie')?.includes(MERCHANT_AUTH_COOKIE+'='));}
                else{assert(headers.get('x-merchant-access-token'),'explicit_employee_token_required');assert.equal(headers.get('cookie'),null);}
                // Explicit transport adapter, not a reverse-proxy test. Only the
                // exact synthetic browser origin is mapped to the canonical one.
                if(headers.get('origin')===origin)headers.set('origin',canonical);
                const referer=headers.get('referer');if(referer?.startsWith(origin+'/'))headers.set('referer',canonical+referer.slice(origin.length));
                headers.set('host','www.faolla.com');
                const request=new Request(canonical+url.pathname+url.search,{headers,method:r.method(),body});
                const attendance=url.pathname.startsWith('/api/merchant-enterprise/attendance/');
                if(actualMerchantLogin&&owner&&url.pathname.startsWith('/api/auth/')){
                  if(url.pathname==='/api/auth/merchant-login'){assert.equal(r.method(),'POST');response=await merchantLogin(request);}
                  else if(url.pathname==='/api/auth/merchant-session'){assert.equal(r.method(),'GET');response=await merchantSession(request);}
                  else{assert.equal(url.pathname,'/api/auth/merchant-logout');assert.equal(r.method(),'POST');response=await merchantLogout(request);}
                  assert.equal(response.headers.get('cache-control'),'no-store');
                  if(url.pathname==='/api/auth/merchant-login'&&response.status===200){const payload=await response.clone().json();assert.equal(payload.merchantId,'99990001');assert.equal(payload.accessToken,undefined);assert.equal(payload.refreshToken,undefined);}
                  if(url.pathname==='/api/auth/merchant-session'&&response.status===200){const payload=await response.clone().json();assert.equal(payload.accessToken,undefined);assert.equal(payload.refreshToken,undefined);assert.equal(payload.authenticated,true);}
                }else if(attendance){
                  const handler=handlers[url.pathname.split('/').at(-1)];assert(handler,'unexpected_attendance_handler');
                  response=await handler(request,{entitlement});assert.equal(response.headers.get('cache-control'),'private, no-store');
                }else{
                  try{const identity=await resolveValidatedMerchantEnterpriseAuthContext(request);if(!owner)tokens.set(identity.user.id,headers.get('x-merchant-access-token'));response=(fullAdminClient&&owner?serveAttendanceMerchantBootstrap(request,identity.user.id):null)??await transport.serveShell(request,identity.user.id);}
                  catch(e){if(e.code==='unauthorized')response=Response.json({ok:false,error:'unauthorized'},{status:401});else throw e;}
                }
                requests.push({path:url.pathname,method:r.method(),status:response.status,body:url.pathname.startsWith('/api/auth/')?null:body?JSON.parse(body):null});
                if(control.lose===url.pathname&&r.method()==='POST'&&response.status===200){control.lose=null;return route.abort('connectionreset');}
              }
              const responseHeaders=Object.fromEntries(response.headers);
              // Fault injection: deliver only the real refresh cookie from the
              // login reply. No invented token/cookie is installed by the test.
              const cookies=response.headers.getSetCookie().filter(cookie=>!(refreshOnly&&actualMerchantLogin&&url.pathname==='/api/auth/merchant-login'&&response.status===200&&cookie.startsWith(MERCHANT_AUTH_COOKIE+'=')));
              if(cookies.length)responseHeaders['set-cookie']=cookies.join('\n');
              return route.fulfill({status:response.status,headers:responseHeaders,body:await response.text()});
            }catch(e){errors.push(url.pathname+': '+e.message);await route.abort();}
          });
          const p=await context.newPage();p.setDefaultTimeout(10000);p.on('pageerror',e=>errors.push(e.message));p.on('dialog',d=>{dialogs.push(d.message());return control.acceptDialogs?d.accept():d.dismiss();});return p;
        };
        const admin=p=>p.getByRole('region',{name:'考勤配置管理',exact:true}),self=p=>p.getByRole('region',{name:'我的考勤',exact:true});
        const waitAdmin=async(p,status=200)=>p.waitForResponse(r=>r.url().endsWith('/attendance/admin')&&r.request().method()==='POST'&&r.status()===status);
        const clickSave=async(p,name)=>{const done=waitAdmin(p);await admin(p).getByRole('button',{name,exact:true}).click();await done;await admin(p).getByRole('button',{name:'重新读取',exact:true}).waitFor();};
        const login=async(p,index)=>{await p.goto(origin+'/enterprise');await p.getByLabel('员工邮箱',{exact:true}).fill(actors[index].email);await p.getByLabel('密码',{exact:true}).fill('Synthetic-attendance-only!');await p.getByRole('button',{name:'登录并选择企业',exact:true}).click();await p.getByRole('button',{name:'进入工作台',exact:true}).click();};
        const enter=async p=>{await p.getByRole('button',{name:'我的考勤',exact:true}).click();await self(p).getByRole('button',{name:/^(刷新状态|核对打卡结果)$/}).waitFor();};
        const punch=async(p,label,status=200)=>{const done=p.waitForResponse(r=>r.url().endsWith('/attendance/self')&&r.request().method()==='POST'&&r.status()===status);await self(p).getByRole('button',{name:label,exact:true}).click();const response=await done;return response.json();};
        const enterOwner=async p=>{if(fullAdminClient){await p.getByRole('button',{name:'企业管理',exact:true}).click();await p.getByRole('button',{name:'考勤配置',exact:true}).click();}};
        const openOwner=async(p,negative=false)=>{
          if(!actualMerchantLogin){await p.goto(origin+(fullAdminClient?'/99990001':'/owner'));return;}
          assert.equal((await p.context().cookies(origin)).length,0);
          await p.goto(origin+'/login');await p.getByRole('button',{name:/商户入口/}).click();
          if(negative){
            const callsBefore=transport.calls.length;
            const anonymous=await p.evaluate(async()=>{const r=await fetch('/api/merchant-enterprise/attendance/admin?siteId=99990001');return r.status;});
            assert.equal(anonymous,401);assert.equal(transport.calls.length,callsBefore);
            pass('anonymous merchant login page cannot read attendance configuration and rejection occurs before any attendance RPC');
            for(const [actor,password,status] of [[actors[0],'Wrong-synthetic-password!',401],[actors[1],'Synthetic-attendance-only!',403]]){
              await p.locator('input[name="merchant-login-account"]').fill(actor.email);await p.locator('input[name="merchant-login-password"]').fill(password);
              const rejected=p.waitForResponse(r=>r.url().endsWith('/api/auth/merchant-login')&&r.status()===status);
              await p.getByRole('button',{name:'登录',exact:true}).click();await rejected;
              assert(!(await p.context().cookies(origin)).some(c=>[MERCHANT_AUTH_COOKIE,MERCHANT_AUTH_REFRESH_COOKIE].includes(c.name)));
              assert.equal(new URL(p.url()).pathname,'/login');assert.equal(transport.calls.length,callsBefore);
              if(status===403)await p.getByText(/此账号已关联员工身份/).waitFor();
              pass(status===401?'wrong password in actual merchant form gets 401 without auth cookies or attendance access':'employee credentials are denied by actual merchant login and current employee SQL relation, without owner cookies or identity conversion');
            }
          }
          await p.locator('input[name="merchant-login-account"]').fill(actors[0].email);
          await p.locator('input[name="merchant-login-password"]').fill('Synthetic-attendance-only!');
          const loggedIn=p.waitForResponse(r=>r.url().endsWith('/api/auth/merchant-login')&&r.status()===200);
          const sessionReady=p.waitForResponse(r=>r.url().includes('/api/auth/merchant-session')&&r.status()===200);
          await p.getByRole('button',{name:'登录',exact:true}).click();await loggedIn;
          await p.waitForURL(url=>url.pathname==='/99990001');await sessionReady;
          const cookies=await p.context().cookies(origin);
          for(const name of [MERCHANT_AUTH_COOKIE,MERCHANT_AUTH_REFRESH_COOKIE]){const cookie=cookies.find(c=>c.name===name);assert(cookie?.secure&&cookie.httpOnly);assert.equal(cookie.path,'/');assert.equal(cookie.domain,'127.0.0.1');}
          assert(!(await p.evaluate(()=>document.cookie)).includes(MERCHANT_AUTH_COOKIE));
          const stored=await p.evaluate(()=>[...Object.values(localStorage),...Object.values(sessionStorage)].join('\n'));
          for(const cookie of cookies.filter(c=>[MERCHANT_AUTH_COOKIE,MERCHANT_AUTH_REFRESH_COOKIE].includes(c.name)))assert(!stored.includes(cookie.value),'auth_token_leaked_to_browser_storage');
        };
        const owner=await newPage({owner:true});await openOwner(owner,actualMerchantLogin);await enterOwner(owner);await admin(owner).getByRole('button',{name:'创建考勤配置',exact:true}).waitFor();
        if(actualMerchantLogin)pass('actual merchant login page and unchanged login/session handlers establish host-only HttpOnly cookies without injecting browser authentication or exposing tokens in responses');
        assert.equal(configCount(),0);assert.equal(exec('select count(*) from public.merchant_attendance_settings;'),'0');
        await clickSave(owner,'创建考勤配置');assert.equal(configCount(),1);
        assert.equal(exec('select enabled or web_clock_enabled from public.merchant_attendance_settings;'),'f');
        pass('browser owner initialization reaches actual HTTP parser, default SDK executor and service_role SQL; GET creates no configuration, explicit init stays disabled');

        await admin(owner).getByRole('button',{name:'工作地点',exact:true}).click();await admin(owner).getByRole('button',{name:'新增地点',exact:true}).click();
        await admin(owner).getByLabel('地点名称',{exact:true}).fill('合成测试门店');await admin(owner).getByLabel('启用此地点',{exact:true}).check();await clickSave(owner,'保存地点');
        for(const [index,name] of [[1,'合成员工甲'],[2,'合成员工乙']]){
          await admin(owner).getByRole('button',{name:'考勤人员',exact:true}).click();await admin(owner).getByRole('button',{name:'新增考勤人员',exact:true}).click();
          await admin(owner).getByRole('button',{name:'选择已有员工',exact:true}).click();await admin(owner).getByText(name,{exact:true}).locator('../..').getByRole('button',{name:'选择',exact:true}).click();
          await admin(owner).getByLabel('企业内工号',{exact:true}).fill('DB-'+index);await admin(owner).getByLabel('在职起始日期',{exact:true}).fill('2000-01-01');
          await admin(owner).getByRole('button',{name:'选择工作地点',exact:true}).click();await admin(owner).getByText('合成测试门店',{exact:true}).locator('../..').getByRole('button',{name:'选择',exact:true}).click();
          await admin(owner).getByLabel('启用此考勤人员',{exact:true}).check();await clickSave(owner,'保存考勤人员');
        }
        const workers=JSON.parse(exec('select jsonb_agg(jsonb_build_object(\'id\',id,\'employeeId\',employee_id) order by employee_id) from public.merchant_attendance_workers;'));
        assert.equal(workers.length,2);assert.equal(workers[0].employeeId,id(101));assert.equal(workers[1].employeeId,id(102));assert.equal(configCount(),4);
        await admin(owner).getByRole('button',{name:'考勤设置',exact:true}).click();await admin(owner).getByLabel(/启用企业考勤/).check();await admin(owner).getByLabel(/允许普通网页打卡/).check();await clickSave(owner,'保存考勤设置');assert.equal(configCount(),5);
        pass('actual owner UI creates a location, chooses existing employees, enrolls two independent workers and explicitly enables web attendance in the same database');

        if(fullAdminClient){
          const dialogBaseline=dialogs.length,writeBaseline=configCount();
          control.acceptDialogs=false;
          await admin(owner).getByLabel(/休息计入计薪候选时长/).check();
          await owner.getByRole('button',{name:'角色权限',exact:true}).click();
          assert.equal(await admin(owner).count(),1);
          assert(await admin(owner).getByLabel(/休息计入计薪候选时长/).isChecked());
          assert.equal(dialogs.length,dialogBaseline+1);assert.match(dialogs.at(-1),/未保存/);
          control.acceptDialogs=true;
          await owner.getByRole('button',{name:'角色权限',exact:true}).click();
          await owner.getByRole('button',{name:'考勤配置',exact:true}).click();
          await admin(owner).getByRole('button',{name:'保存考勤设置',exact:true}).waitFor();
          assert.equal(await admin(owner).getByLabel(/休息计入计薪候选时长/).isChecked(),false);
          assert.equal(configCount(),writeBaseline);
          pass('actual enterprise submenu confirms dirty attendance settings, cancel preserves draft, accepted discard restores saved SQL values without POST');

          control.acceptDialogs=false;
          await admin(owner).getByLabel('企业考勤时区',{exact:true}).fill('UTC');
          await owner.getByRole('button',{name:'经营中心',exact:true}).click();
          assert.equal(await admin(owner).getByLabel('企业考勤时区',{exact:true}).inputValue(),'UTC');
          assert.equal(dialogs.length,dialogBaseline+3);
          control.acceptDialogs=true;await owner.getByRole('button',{name:'经营中心',exact:true}).click();
          assert.equal(await admin(owner).count(),0);await enterOwner(owner);
          await admin(owner).getByRole('button',{name:'保存考勤设置',exact:true}).waitFor();
          assert.equal(await admin(owner).getByLabel('企业考勤时区',{exact:true}).inputValue(),'Europe/Madrid');assert.equal(configCount(),writeBaseline);
          pass('full merchant business-section switch honors enterprise leave guard; cancel preserves attendance draft, explicit discard does not persist it');

          const phone=await newPage({owner:true,mobile:true,refreshOnly:actualMerchantLogin});
          const grantsBefore=auth.calls.filter(c=>c.path==='/auth/v1/token').length;await openOwner(phone);
          if(actualMerchantLogin){assert.equal(auth.calls.filter(c=>c.path==='/auth/v1/token').length,grantsBefore+2);pass('mobile merchant entry with only its real refresh cookie uses the actual session handler to rotate credentials and recover without exposing tokens');}
          await phone.getByRole('button',{name:'企业',exact:true}).click();await phone.getByRole('button',{name:'考勤配置',exact:true}).click();
          await admin(phone).getByRole('button',{name:'保存考勤设置',exact:true}).waitFor();
          assert(await phone.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
          const phoneDialogBaseline=dialogs.length;control.acceptDialogs=false;
          await admin(phone).getByLabel('企业考勤时区',{exact:true}).fill('UTC');await phone.getByRole('button',{name:'返回会话',exact:true}).click();
          assert.equal(await admin(phone).getByLabel('企业考勤时区',{exact:true}).inputValue(),'UTC');assert.equal(dialogs.length,phoneDialogBaseline+1);
          control.acceptDialogs=true;await phone.getByRole('button',{name:'返回会话',exact:true}).click();assert.equal(await admin(phone).count(),0);
          assert.equal(configCount(),writeBaseline);await phone.context().close();
          pass('actual mobile merchant shell opens owner attendance with no horizontal overflow; its back button also protects an unsaved draft without writing it');
        }

        const a=await newPage(),b=await newPage({mobile:true});await login(a,1);await enter(a);await login(b,2);await enter(b);
        assert(await b.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.equal(eventRows().length,0);
        const first=await punch(a,'上班打卡');assert.equal(first.state.sequence,1);assert.equal(first.workerId,workers[0].id);
        assert.equal(first.receipt.id,eventRows()[0].id);assert.equal(eventRows()[0].actor_employee_id,id(101));assert(Math.abs(Date.now()-Date.parse(first.receipt.occurredAt))<30000);
        await self(a).getByText('收据编号：'+first.receipt.id,{exact:true}).waitFor();
        for(const label of ['开始休息','结束休息','下班打卡'])await punch(a,label);
        assert.deepEqual(eventRows().map(e=>e.action),['clock_in','break_start','break_end','clock_out']);assert.equal(eventRows()[1].break_paid,false);
        pass('actual employee login/selector/workspace completes work-break-resume-finish through handlers and SQL; DOM receipt identifies the immutable server-time event');

        const history=a.getByRole('region',{name:'本人历史打卡',exact:true});await self(a).getByRole('button',{name:'查看本人历史打卡',exact:true}).click();
        const historyDone=a.waitForResponse(r=>r.url().includes('/attendance/history?')&&r.status()===200);await history.getByRole('button',{name:'查询本人记录',exact:true}).click();await historyDone;await history.locator('article').nth(3).waitFor();assert.equal(await history.locator('article').count(),4);
        pass('employee history queries the same committed events through its actual read handler and service-role RPC, not a separately synthesized history list');

        control.lose='/api/merchant-enterprise/attendance/admin';await admin(owner).getByLabel(/休息计入计薪候选时长/).check();await admin(owner).getByRole('button',{name:'保存考勤设置',exact:true}).click();await admin(owner).getByText('保存结果待确认',{exact:true}).waitFor();assert.equal(configCount(),6);
        const configOperation=transport.calls.filter(c=>c.name==='faolla_attendance_admin_v1'&&c.command).at(-1).operationId,configPosts=requests.filter(r=>r.path.endsWith('/attendance/admin')&&r.method==='POST').length;
        await owner.reload();await enterOwner(owner);await admin(owner).getByRole('button',{name:'保存考勤设置',exact:true}).waitFor();
        assert.equal(configCount(),6);assert.equal(requests.filter(r=>r.path.endsWith('/attendance/admin')&&r.method==='POST').length,configPosts);
        assert(transport.calls.some(c=>c.name==='faolla_attendance_admin_v1'&&!c.command&&c.operationId===configOperation));
        pass('owner configuration response lost after SQL commit recovers original operation by GET after reload, with one immutable configuration receipt and no repeat POST');

        control.lose='/api/merchant-enterprise/attendance/self';await self(a).getByRole('button',{name:'上班打卡',exact:true}).click();await self(a).getByText('打卡结果待确认',{exact:true}).waitFor();assert.equal(eventRows().length,5);
        const lost=eventRows().at(-1).operation_id,punchPosts=requests.filter(r=>r.path.endsWith('/attendance/self')&&r.method==='POST').length;
        await a.reload();await enter(a);await self(a).getByText('打卡已确认',{exact:true}).waitFor();assert.equal(eventRows().length,5);
        assert.equal(requests.filter(r=>r.path.endsWith('/attendance/self')&&r.method==='POST').length,punchPosts);
        assert(transport.calls.some(c=>c.name==='faolla_attendance_self_v1'&&!c.command&&c.operationId===lost));
        pass('employee response lost after real event commit survives reload and resolves the original operation through GET without another event or POST');

        transport.state.moduleEnabled=false;await self(a).getByRole('button',{name:'刷新状态',exact:true}).click();await self(a).getByText(/平台尚未开放或已暂停新考勤/).first().waitFor();
        assert(await self(a).getByRole('button',{name:'开始休息',exact:true}).isDisabled());assert(!(await self(a).getByRole('button',{name:'下班打卡',exact:true}).isDisabled()));
        await punch(a,'下班打卡');assert.equal(eventRows().length,6);await self(b).getByRole('button',{name:'刷新状态',exact:true}).click();await self(b).getByText(/平台尚未开放或已暂停新考勤/).first().waitFor();assert(await self(b).getByRole('button',{name:'上班打卡',exact:true}).isDisabled());
        transport.state.moduleEnabled=true;await self(a).getByRole('button',{name:'刷新状态',exact:true}).click();
        pass('platform pause preserves real receipt reads and allows explicit completion of an open session while both desktop and mobile refuse fresh attendance');

        const stale=await newPage();await login(stale,1);await enter(stale);await punch(a,'上班打卡');assert.equal(eventRows().length,7);
        const conflict=await punch(stale,'上班打卡',409);assert.equal(conflict.error,'attendance_sequence_conflict');assert.equal(eventRows().length,7);
        assert.equal(requests.filter(r=>r.path.endsWith('/attendance/self')&&r.method==='POST').at(-1).body.expectedSequence,6);
        await self(a).getByRole('button',{name:'刷新状态',exact:true}).click();await punch(a,'下班打卡');assert.equal(eventRows().length,8);await stale.context().close();
        pass('two separately logged-in browser contexts cannot turn a stale clock-in into a second event: real SQL returns sequence conflict and preserves the winning event');

        await self(b).getByRole('button',{name:'刷新状态',exact:true}).click();await punch(b,'上班打卡');assert.equal(eventRows().length,9);
        const privateReceipt=await b.evaluate(async({token,operationId})=>{const r=await fetch('/api/merchant-enterprise/attendance/self?siteId=99990001&operationId='+operationId,{headers:{'x-merchant-access-token':token}});return {status:r.status,body:await r.json()};},{token:tokens.get(actors[2].id),operationId:first.receipt.operationId});
        assert.equal(privateReceipt.status,200);assert.equal(privateReceipt.body.workerId,workers[1].id);assert.equal(privateReceipt.body.receipt,null);assert.equal(privateReceipt.body.state.sequence,1);
        await self(b).getByRole('button',{name:'查看本人历史打卡',exact:true}).click();const bHistory=b.getByRole('region',{name:'本人历史打卡',exact:true});
        const bRead=b.waitForResponse(r=>r.url().includes('/attendance/history?')&&r.status()===200);await bHistory.getByRole('button',{name:'查询本人记录',exact:true}).click();await bRead;await bHistory.locator('article').first().waitFor();
        assert.equal(await bHistory.locator('article').count(),1);assert.equal(await bHistory.getByText(/合成员工甲/).count(),0);assert(await b.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
        await punch(b,'下班打卡');assert.equal(eventRows().length,10);
        pass('mobile employee B sees only B history and cannot retrieve A receipt even with the exact operation id; both workers share one real database without sharing events');

        const factsBeforeDenial=eventRows(),lastOwnFact=factsBeforeDenial.filter(event=>event.worker_id===workers[0].id).at(-1);
        await self(a).getByText('收据编号：'+lastOwnFact.id,{exact:true}).waitFor();
        exec(`update public.merchant_enterprise_roles set permissions=array['enterprise.view','attendance.self.view'],version=version+1 where id='${id(30)}';`);
        const denied=await punch(a,'上班打卡',403);assert.equal(denied.error,'attendance_access_denied');assert.equal(eventRows().length,10);
        const deniedCommand=requests.filter(r=>r.path.endsWith('/attendance/self')&&r.method==='POST').at(-1).body;
        const pendingKey='faolla:attendance:self:v1:99990001:'+id(101),deniedPosts=requests.filter(r=>r.path.endsWith('/attendance/self')&&r.method==='POST').length;
        await self(a).getByText(/原操作编号仍会保留/).waitFor();
        await self(a).getByText('操作编号：'+deniedCommand.operationId,{exact:true}).waitFor();
        await self(a).getByText('等待服务器同步，不显示推测记录。',{exact:true}).waitFor();
        assert.equal(await self(a).getByText(/^此次操作收据 · /).count(),0);
        assert.equal(await self(a).getByText('收据编号：'+lastOwnFact.id,{exact:true}).count(),0);
        assert(await self(a).getByRole('button',{name:'用原操作编号重试',exact:true}).isDisabled());
        const savedPending=await a.evaluate(key=>sessionStorage.getItem(key),pendingKey);
        const {siteId:pendingSite,...pendingCommand}=deniedCommand;
        assert.deepEqual(JSON.parse(savedPending),{version:1,siteId:pendingSite,employeeId:id(101),workerId:workers[0].id,command:pendingCommand});
        assert.equal(requests.filter(r=>r.path.endsWith('/attendance/self')&&r.method==='POST').length,deniedPosts);
        assert.deepEqual(eventRows(),factsBeforeDenial);
        pass('revoking clock permission rejects the stale button at real SQL, clears last-event and receipt DOM, retains exact pending intent with retry disabled, and changes no raw event');

        // Reload uses a DB-backed synthetic capability response with the new
        // role version. The attendance reads themselves still use real handlers.
        const viewOnlyRead=a.waitForResponse(r=>{
          const url=new URL(r.url());return url.pathname.endsWith('/attendance/self')&&url.searchParams.get('operationId')===deniedCommand.operationId&&r.request().method()==='GET'&&r.status()===200;
        });
        await a.reload();await enter(a);const viewOnlyResult=await (await viewOnlyRead).json();
        assert.equal(viewOnlyResult.workerId,workers[0].id);assert.equal(viewOnlyResult.receipt,null);assert.equal(viewOnlyResult.state.lastEvent.id,lastOwnFact.id);
        await self(a).getByText('当前角色仅可查看本人考勤，不能提交打卡。',{exact:true}).waitFor();
        await self(a).getByText('操作编号：'+deniedCommand.operationId,{exact:true}).waitFor();
        await self(a).getByRole('button',{name:'上班打卡',exact:true}).waitFor();
        assert(await self(a).getByRole('button',{name:'上班打卡',exact:true}).isDisabled());
        assert(await self(a).getByRole('button',{name:'用原操作编号重试',exact:true}).isDisabled());
        assert.equal(await self(a).getByText(/^此次操作收据 · /).count(),0);
        assert.equal(await a.evaluate(key=>sessionStorage.getItem(key),pendingKey),savedPending);
        assert.equal(requests.filter(r=>r.path.endsWith('/attendance/self')&&r.method==='POST').length,deniedPosts);
        assert.deepEqual(eventRows(),factsBeforeDenial);
        await self(a).getByRole('button',{name:'查看本人历史打卡',exact:true}).click();
        const reread=a.waitForResponse(r=>r.url().includes('/attendance/history?')&&r.status()===200);await history.getByRole('button',{name:'查询本人记录',exact:true}).click();await reread;await history.locator('article').nth(7).waitFor();
        exec(`update public.merchant_enterprise_roles set permissions=array['enterprise.view'],version=version+1 where id='${id(30)}';`);
        const hidden=a.waitForResponse(r=>r.url().includes('/attendance/history?')&&r.status()===403);await history.getByRole('button',{name:'重新查询首页',exact:true}).click();await hidden;
        await history.getByText('当前身份或权限不能访问考勤，请重新登录或联系企业负责人。',{exact:true}).waitFor();assert.equal(await history.locator('article').count(),0);assert.equal(eventRows().length,10);
        pass('view-only reload checks the original pending operation by GET without resubmitting or enabling retry; subsequent history revocation clears rendered rows with no raw event changes');

        const beforeAuth=transport.calls.length;auth.revoke(tokens.get(actors[1].id));
        const expired=a.waitForResponse(r=>r.url().includes('/attendance/self?')&&r.request().method()==='GET'&&r.status()===401);await self(a).getByRole('button',{name:'核对打卡结果',exact:true}).click();await expired;
        await self(a).getByText(/登录已失效，请重新登录同一员工账号/).waitFor();
        await self(a).getByText('等待服务器同步，不显示推测记录。',{exact:true}).waitFor();
        assert.equal(await self(a).getByText(/^此次操作收据 · /).count(),0);
        assert(await self(a).getByRole('button',{name:'用原操作编号重试',exact:true}).isDisabled());
        assert.equal(await a.evaluate(key=>sessionStorage.getItem(key),pendingKey),savedPending);
        assert.equal(requests.filter(r=>r.path.endsWith('/attendance/self')&&r.method==='POST').length,deniedPosts);
        assert.deepEqual(eventRows(),factsBeforeDenial);
        assert.equal(transport.calls.length,beforeAuth);assert.equal(eventRows().length,10);
        pass('revoked synthetic Auth session is rejected by the unchanged application resolver before any attendance SQL call, without falling back to owner cookies');

        const configBaseline=configCount();exec(`update public.merchants set user_id='${id(98)}' where id='99990001';`);
        const ownerDenied=owner.waitForResponse(r=>r.url().includes('/attendance/admin?')&&r.status()===403);await admin(owner).getByRole('button',{name:'重新读取',exact:true}).click();await ownerDenied;
        await admin(owner).getByText('仅当前商户负责人可以管理考勤配置。',{exact:true}).waitFor();assert.equal(await admin(owner).getByRole('button',{name:'保存考勤设置',exact:true}).count(),0);assert.equal(configCount(),configBaseline);
        pass('changing current ownership in synthetic SQL denies old owner configuration reads and removes its form, without modifying any saved attendance rows');

        if(fullAdminClient){
          const overviewDenied=owner.waitForResponse(r=>r.url().includes('/overview?')&&r.status()===403);
          await owner.getByRole('button',{name:'刷新数据',exact:true}).click();await overviewDenied;
          const boundary=owner.getByRole('region',{name:'企业身份需重新核验',exact:true});await boundary.waitFor();
          assert.equal(await admin(owner).count(),0);assert.equal(await owner.getByRole('navigation',{name:'企业管理子菜单',exact:true}).getByRole('button').count(),0);
          exec(`update public.merchants set user_id='${actors[0].id}' where id='99990001';`);
          await owner.getByRole('button',{name:'重新核验企业身份',exact:true}).click();
          await admin(owner).getByRole('button',{name:'保存考勤设置',exact:true}).waitFor();assert.equal(configCount(),configBaseline);
          pass('authoritative enterprise denial clears actual AdminClient submenu and attendance panel; ownership recheck rebuilds navigation without configuration writes');
          const logWrites=requests.filter(r=>r.path==='/api/merchant-operation-logs'&&r.method==='POST');
          assert(logWrites.length>0);assert(logWrites.every(r=>r.status===403&&r.body.siteId==='99990001'));
          assert(requests.filter(r=>r.method==='POST'&&!r.path.startsWith('/api/merchant-enterprise/attendance/')).every(r=>['/api/merchant-operation-logs','/api/merchant-enterprise/employees/accept',...(actualMerchantLogin?['/api/auth/merchant-login','/api/auth/merchant-logout']:[])].includes(r.path)));
        }

        if(actualMerchantLogin){
          const callsBefore=transport.calls.length,eventsBefore=eventRows().length;
          const loggedOut=owner.waitForResponse(r=>r.url().endsWith('/api/auth/merchant-logout')&&r.status()===200);
          await owner.getByRole('button',{name:'退出登录',exact:true}).click();await owner.getByRole('button',{name:'确定',exact:true}).click();await loggedOut;
          await owner.waitForURL(url=>url.pathname==='/login');
          assert(!(await owner.context().cookies(origin)).some(c=>[MERCHANT_AUTH_COOKIE,MERCHANT_AUTH_REFRESH_COOKIE].includes(c.name)));
          const denied=await owner.evaluate(async()=>{const r=await fetch('/api/merchant-enterprise/attendance/admin?siteId=99990001');return r.status;});
          assert.equal(denied,401);assert.equal(transport.calls.length,callsBefore);assert.equal(eventRows().length,eventsBefore);assert.equal(configCount(),configBaseline);
          pass('actual merchant logout control and handler clear owner cookies; subsequent attendance request is rejected before SQL and existing records remain unchanged');
        }

        assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert.deepEqual(transport.errors,[]);
        assert.deepEqual(merchantIdentity.errors,[]);
        assert.deepEqual([...new Set(transport.calls.map(c=>c.name))].sort(),['faolla_attendance_admin_v1','faolla_attendance_self_history_v1','faolla_attendance_self_v1']);
        console.log(JSON.stringify({actualBrowser:true,actualAttendanceHandlers:true,defaultExecutors:true,realServiceRoleSql:true,realAuthService:false,realPostgrest:false,fullAdminClient,syntheticEnterpriseBootstrap:true,actualMerchantLoginPageAndHandler:actualMerchantLogin,actualMerchantSessionHandler:actualMerchantLogin,realNextServer:false,explicitTransportAdapter:true,externalRequests:0,productionWrites:0,artifactsWritten:0}));
      },actualMerchantLogin?merchantIdentity:undefined);
    }catch(e){console.error('DATABASE_BROWSER_TRANSPORT_ERRORS',[...new Set(errors)].slice(0,8));if(browser)for(const context of browser.contexts())for(const p of context.pages())console.error('DATABASE_BROWSER_FAILURE',p.url(),(await p.locator('body').innerText().catch(()=>'' )).slice(-1200));throw e;}
    finally{await browser?.close();if(child.exitCode===null){const stopped=once(child,'exit');child.kill();await stopped;}}
  });
}
await runAttendanceLabelsReuse(process.argv.slice(2).filter(arg=>!['--merchant-shell','--merchant-login'].includes(arg)),check).catch(e=>{console.error(e);process.exitCode=1;});
