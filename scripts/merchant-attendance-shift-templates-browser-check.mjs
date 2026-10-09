// Real schedule/editor/template components and default handlers/SDK against an
// owned synthetic SQL namespace. No real Auth, Next proxy, phone or production.
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
import {prepareShiftTemplatesNativeFixture} from './merchant-attendance-shift-templates-native.mjs';
import {runAttendanceCleanupSteps} from './fixtures/attendance-cleanup.mjs';
const require=createRequire(import.meta.url);
const {withAttendanceApplicationAuth}=require('./fixtures/attendance-application-auth.ts');
const {handleShiftTemplates}=require('../src/app/api/merchant-enterprise/attendance/shift-templates/route-handler.ts');
const {handleAttendanceSchedule}=require('../src/app/api/merchant-enterprise/attendance/schedule/route-handler.ts');
const {handleAttendanceAdmin}=require('../src/app/api/merchant-enterprise/attendance/admin/route-handler.ts');
const {requireMerchantEnterpriseEntitlement}=require('../src/lib/merchantEnterpriseAuth.server.ts');
const {MERCHANT_AUTH_COOKIE}=require('../src/lib/merchantAuthSession.ts');
const literal=v=>v===null?'null':"'"+String(v).replaceAll("'","''")+"'",json=v=>v===null?'null':literal(JSON.stringify(v))+'::jsonb';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const origin='https://127.0.0.1:3131',staticOrigin='http://127.0.0.1:3131',canonical='https://www.faolla.com',prefix='/api/merchant-enterprise/attendance/';
const localFetch=globalThis.fetch;
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
const bounded=async promise=>{let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('shift_templates_browser_timeout')),20000);})]);}finally{clearTimeout(timer);}};
export async function checkShiftTemplatesBrowser(native,scope){
  const data=await prepareShiftTemplatesNativeFixture(native,scope);
  data.exec(readFileSync(path.join(native.root,'scripts/supabase-migrations/202610010099_merchant_attendance_schedule.sql'),'utf8'));
  data.exec(`begin;
    insert into public.merchant_enterprise_roles(id,merchant_id,name,permissions) values('${id(30)}','${data.site}','Synthetic template role',array['enterprise.view','attendance.self.view']);
    insert into public.merchant_enterprise_employees(id,merchant_id,auth_user_id,email,display_name,role_id,status)
      values('${id(101)}','${data.site}','${id(1)}','template-worker@example.test','合成模板员工','${id(30)}','active');
    insert into public.merchant_attendance_locations(id,merchant_id,name,time_zone,active) values('${id(301)}','${data.site}','合成模板门店','UTC',true);
    insert into public.merchant_attendance_workers(id,merchant_id,employee_id,worker_no,display_name,active,default_location_id)
      values('${id(201)}','${data.site}','${id(101)}','QA-TEMPLATE','合成模板员工',true,'${id(301)}');
    insert into public.merchant_attendance_employment_periods(merchant_id,worker_id,starts_on) values('${data.site}','${id(201)}','2000-01-01');commit;`);
  const future=data.exec("select (clock_timestamp() at time zone 'UTC')::date+2;"),protectedBefore=data.protectedFingerprint();
  const counts=()=>JSON.parse(data.exec(`select jsonb_build_object('templates',(select count(*) from public.merchant_attendance_shift_templates),'operations',(select count(*) from public.merchant_attendance_shift_template_operations),
    'scheduleCommands',(select count(*) from public.merchant_attendance_schedule_commands),'slots',(select count(*) from public.merchant_attendance_schedule_slots),'events',(select count(*) from public.merchant_attendance_events));`));
  const actor={id:data.owner,email:'template-owner@example.test'},requests=[],errors=[],pending=new Set(),gates=new Set();let hold=null,lose=false,closing=false,browser,phase='harness',moduleEnabled=true;
  const probe=net.createServer();await new Promise((resolve,reject)=>{probe.once('error',reject);probe.listen(3131,'127.0.0.1',resolve);});await new Promise(resolve=>probe.close(resolve));
  const child=spawn(process.execPath,['scripts/attendance-self-browser-harness.mjs','--shift-templates'],{cwd:native.root,windowsHide:true,stdio:['ignore','pipe','pipe']});
  child.stderr.on('data',()=>errors.push('harness_stderr'));
  const rpc=async(name,args)=>{
    assert.equal(args.p_auth_user_id,data.owner);let params;
    if(name==='faolla_attendance_shift_templates_v1'||name==='faolla_attendance_schedule_v1'){
      assert.equal(args.p_query.siteId,data.site);assert.deepEqual(Object.keys(args).sort(),['p_allow_write','p_auth_user_id','p_command','p_query']);
      params=[json(args.p_query),literal(args.p_auth_user_id),json(args.p_command),String(args.p_allow_write)];
    }else{
      assert.equal(name,'faolla_attendance_admin_v1');assert.equal(args.p_site_id,data.site);assert.equal(args.p_command,null);assert.equal(args.p_operation_id,null);
      params=[literal(args.p_site_id),literal(args.p_auth_user_id),json(args.p_query),'null','null'];
    }
    try{const reply=JSON.parse(data.exec(`begin;set local role service_role;select jsonb_build_object('role',current_user,'data',public.${name}(${params.join(',')}));commit;`));
      assert.equal(reply.role,'service_role');return {data:reply.data,error:null};
    }catch(error){const code=String(error).match(/ERROR:\s+(attendance_[a-z_]+)/)?.[1];if(!code)throw error;return {data:null,error:{message:code}};}
  };
  try{
    await bounded(new Promise((resolve,reject)=>{let output='';child.stdout.on('data',chunk=>{output+=String(chunk);if(output.includes('Attendance synthetic component QA'))resolve();});child.once('error',()=>reject(Error('harness_failed')));child.once('exit',()=>reject(Error('harness_exited')));}));
    browser=await chromium.launch({headless:true});
    await withAttendanceApplicationAuth([actor],rpc,async auth=>{
      try{
        const entitlement=value=>requireMerchantEnterpriseEntitlement(value,async()=>[{id:data.site,permissionConfig:{allowEnterpriseManagement:true,allowEmployeeAttendance:moduleEnabled}}]);
        const context=await browser.newContext({viewport:{width:1280,height:1100},serviceWorkers:'block',acceptDownloads:false});
        await context.addCookies([{name:MERCHANT_AUTH_COOKIE,value:await auth.login(actor),url:origin,secure:true,httpOnly:true,sameSite:'Lax'}]);
        await context.addInitScript(()=>sessionStorage.setItem('qa-unrelated-pending','preserve'));
        await context.route('**/*',route=>{
          if(closing)return route.abort().catch(()=>{});
          const work=(async()=>{
            const request=route.request(),url=new URL(request.url());assert.equal(url.origin,origin);
            if(['/', '/harness.js','/harness.css'].includes(url.pathname)){
              assert.equal(request.method(),'GET');const r=await localFetch(staticOrigin+url.pathname);return route.fulfill({status:r.status,headers:Object.fromEntries(r.headers),body:Buffer.from(await r.arrayBuffer())});
            }
            const handlers={admin:handleAttendanceAdmin,schedule:handleAttendanceSchedule,'shift-templates':handleShiftTemplates},key=url.pathname.slice(prefix.length);
            assert.equal(url.pathname,prefix+key);assert(Object.hasOwn(handlers,key));assert(['GET','POST'].includes(request.method()));if(key==='admin')assert.equal(request.method(),'GET');
            const headers=new Headers(await request.allHeaders());assert(headers.get('cookie')?.includes(MERCHANT_AUTH_COOKIE+'='));assert.equal(headers.get('x-merchant-access-token'),null);
            headers.set('host','www.faolla.com');headers.set('referer',canonical+'/');if(headers.has('origin'))headers.set('origin',canonical);
            const response=await handlers[key](new Request(canonical+url.pathname+url.search,{method:request.method(),headers,body:request.postData()??undefined}),{enabled:()=>true,entitlement});
            const body=await response.text(),parsed=JSON.parse(body);requests.push({key,method:request.method(),status:response.status});
            if(key==='shift-templates'&&request.method()==='POST'&&response.status===200&&lose){lose=false;return route.abort('failed');}
            const gate=key==='shift-templates'&&request.method()==='GET'?hold:null;
            if(gate){hold=null;gate.ready.resolve(parsed);await gate.release.promise;}
            try{await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body});}finally{if(gate){gate.finished.resolve();gates.delete(gate);}}
          })();pending.add(work);void work.finally(()=>pending.delete(work)).catch(()=>{});
          return work.catch(async()=>{if(!closing&&!route.request().failure())errors.push('route_failed');await route.abort().catch(()=>{});});
        });
        const page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',()=>errors.push('page_error'));page.on('dialog',d=>d.accept());
        const schedule=()=>page.getByRole('region',{name:'员工排班工作区',exact:true}),library=()=>page.getByRole('region',{name:'班次模板库',exact:true});
        const templateRequests=()=>requests.filter(r=>r.key==='shift-templates').length;
        const templatePosts=()=>requests.filter(r=>r.key==='shift-templates'&&r.method==='POST').length;
        const readTemplates=async()=>{await library().getByRole('button',{name:'读取模板／查原收据',exact:true}).click();await library().getByRole('status').filter({hasText:/已读取模板|模板操作已确认/}).waitFor();};
        const loadSchedule=async()=>{
          await schedule().getByRole('status').filter({hasText:'已读取计划安排'}).waitFor();
          await schedule().getByLabel('开始日期',{exact:true}).fill(future);await schedule().getByLabel('结束日期（含）',{exact:true}).fill(future);
          await schedule().getByRole('button',{name:'查询安排',exact:true}).click();await schedule().getByRole('status').filter({hasText:'已读取计划安排'}).waitFor();
          await schedule().getByRole('button',{name:'搜索人员',exact:true}).click();await schedule().getByRole('button',{name:'合成模板员工 · QA-TEMPLATE',exact:true}).click();
          await schedule().getByRole('heading',{name:'新增安排 · UTC',exact:true}).waitFor();
        };
        phase='entry';await page.goto(origin+'/?'+new URLSearchParams({siteId:data.site,ownerId:data.owner}));await loadSchedule();
        await schedule().getByLabel('安排理由',{exact:true}).fill('模板明确发布验收');
        await schedule().getByRole('button',{name:'生成安排预览',exact:true}).click();await schedule().getByLabel(/已核对 1 段安排/).check();
        const beforeOpen=templateRequests();await schedule().getByRole('button',{name:'班次模板库',exact:true}).click();await library().waitFor();assert.equal(templateRequests(),beforeOpen);
        assert.equal(await page.locator('form form').count(),0);await readTemplates();assert.deepEqual(counts(),{templates:0,operations:0,scheduleCommands:0,slots:0,events:0});
        native.pass('actual schedule opens default-off template library without automatic reads or nested forms; explicit first read creates nothing');
        phase='create-lost-success';await library().getByLabel('模板名称',{exact:true}).fill('合成夜班');
        const enter=deferred();await page.exposeFunction('qaTemplateEnter',value=>enter.resolve(value));
        // Observe after React's delegated root listener, not a target microtask
        // that the browser may flush before propagation reaches the root.
        await library().getByLabel('模板名称',{exact:true}).evaluate(element=>window.addEventListener('keydown',event=>{if(event.target===element)window.qaTemplateEnter(event.defaultPrevented);},{once:true}));
        await library().getByLabel('模板名称',{exact:true}).press('Enter');
        assert.equal(await bounded(enter.promise),true);assert.equal(counts().scheduleCommands,0);assert.equal(templatePosts(),0);
        await library().getByLabel('第 1 段开始',{exact:true}).fill('');
        assert.equal(await schedule().getByRole('button',{name:'发布排班',exact:true}).evaluate(button=>button.form.checkValidity()),true);
        await library().getByLabel('第 1 段开始',{exact:true}).fill('22:00');await library().getByLabel('第 1 段结束',{exact:true}).fill('06:00');await library().getByLabel('第 1 段次日结束',{exact:true}).check();
        lose=true;await library().getByRole('button',{name:'保存模板',exact:true}).click();await library().getByRole('button',{name:'用原编号明确重试',exact:true}).waitFor();
        assert.equal(templatePosts(),1);assert.deepEqual(counts(),{templates:1,operations:1,scheduleCommands:0,slots:0,events:0});
        phase='paused-receipt';moduleEnabled=false;
        await page.getByRole('button',{name:'卸载测试排班',exact:true}).click();await library().waitFor({state:'detached'});
        await page.getByRole('button',{name:'重挂测试排班',exact:true}).click();await loadSchedule();
        assert.equal(await schedule().getByRole('button',{name:'发布排班',exact:true}).isDisabled(),true);
        await schedule().getByRole('button',{name:'班次模板库',exact:true}).click();await readTemplates();assert.equal(templatePosts(),1);
        assert.equal(await library().getByRole('button',{name:'保存模板',exact:true}).isDisabled(),true);
        assert.equal(await library().getByRole('button',{name:'带入排班草稿',exact:true}).isDisabled(),true);
        assert.equal(await page.evaluate(()=>Object.keys(sessionStorage).some(key=>key.startsWith('faolla:attendance:shift-templates:'))),false);
        assert.equal(data.protectedFingerprint(),protectedBefore);assert.equal(await page.evaluate(()=>sessionStorage.getItem('qa-unrelated-pending')),'preserve');
        native.pass('template Enter cannot implicitly publish and empty template fields do not invalidate the original form; actual save uses119 once');
        native.pass('after lost save and parent remount while paused, actual UI recovers original receipt byGET but cannot write or apply; no duplicate write or old changes');
        moduleEnabled=true;await page.getByRole('button',{name:'卸载测试排班',exact:true}).click();await library().waitFor({state:'detached'});
        await page.getByRole('button',{name:'重挂测试排班',exact:true}).click();await loadSchedule();
        await schedule().getByLabel('安排理由',{exact:true}).fill('模板明确发布验收');
        await schedule().getByRole('button',{name:'生成安排预览',exact:true}).click();await schedule().getByLabel(/已核对 1 段安排/).check();
        await schedule().getByRole('button',{name:'班次模板库',exact:true}).click();await readTemplates();
        phase='edit-and-apply';await library().getByRole('button',{name:'编辑模板',exact:true}).first().click();await library().getByLabel('模板名称',{exact:true}).fill('合成夜班新版');
        await library().getByRole('button',{name:'保存模板',exact:true}).click();await library().getByRole('status').filter({hasText:'模板操作已确认'}).waitFor();
        assert.equal(templatePosts(),2);assert.equal(counts().operations,2);assert.equal(data.protectedFingerprint(),protectedBefore);
        await library().getByRole('button',{name:'带入排班草稿',exact:true}).click();await library().waitFor({state:'detached'});
        assert.equal(await schedule().getByLabel('第 1 段开始',{exact:true}).inputValue(),'22:00');assert.equal(await schedule().getByLabel('第 1 段结束',{exact:true}).inputValue(),'06:00');
        assert.equal(await schedule().getByLabel('次日结束',{exact:true}).isChecked(),true);assert.equal(await schedule().getByLabel('按每周重复展开当前范围',{exact:true}).isChecked(),false);
        assert.equal(await schedule().getByLabel('安排理由',{exact:true}).inputValue(),'模板明确发布验收');assert.equal(await schedule().getByLabel('开始日期',{exact:true}).inputValue(),future);
        assert.equal(await schedule().getByRole('button',{name:'发布排班',exact:true}).isDisabled(),true);assert.equal(counts().scheduleCommands,0);
        native.pass('editing advances template version only; applying fills segments, clears previous preview/ack and preserves repeat, dates and reason with no schedule write');
        phase='publish';await schedule().getByRole('button',{name:'生成安排预览',exact:true}).click();await schedule().getByLabel(/已核对 1 段安排/).check();
        await schedule().getByRole('button',{name:'发布排班',exact:true}).click();await schedule().getByRole('status').filter({hasText:'排班操作已确认'}).waitFor();
        assert.deepEqual(counts(),{templates:1,operations:2,scheduleCommands:1,slots:1,events:0});
        const saved=JSON.parse(data.exec("select jsonb_build_object('start',to_char(start_at at time zone 'UTC','HH24:MI'),'end',to_char(end_at at time zone 'UTC','HH24:MI'),'minutes',extract(epoch from(end_at-start_at))/60,'employee',employee_id) from public.merchant_attendance_schedule_slots;"));
        assert.deepEqual(saved,{start:'22:00',end:'06:00',minutes:480,employee:id(101)});
        const afterPublish=data.protectedFingerprint();native.pass('only separate original preview, acknowledgement and publish create one8-hour next-day schedule through unchanged099; no punch generated');
        phase='archive-mobile';await page.setViewportSize({width:390,height:844});await schedule().getByRole('button',{name:'班次模板库',exact:true}).click();await readTemplates();
        await library().getByRole('button',{name:'编辑模板',exact:true}).first().click();
        await library().getByRole('button',{name:'归档模板',exact:true}).click();await library().getByRole('status').filter({hasText:'模板操作已确认'}).waitFor();
        await library().getByRole('button',{name:'查看已归档模板',exact:true}).click();await library().getByRole('status').filter({hasText:'已读取模板'}).waitFor();
        assert.equal(counts().operations,3);assert.equal(data.protectedFingerprint(),afterPublish);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
        native.pass('390px archived template remains visible but cannot change existing schedule; old business fingerprint stays fixed');
        phase='held-unmount';const gate={ready:deferred(),release:deferred(),finished:deferred()};gates.add(gate);hold=gate;
        await library().getByRole('button',{name:'读取模板／查原收据',exact:true}).click();const held=await bounded(gate.ready.promise);assert.equal(held.items.length,1);
        await page.getByRole('button',{name:'卸载测试排班',exact:true}).click();await library().waitFor({state:'detached'});gate.release.resolve();await bounded(gate.finished.promise);
        const beforeRemount=templateRequests();await page.getByRole('button',{name:'重挂测试排班',exact:true}).click();await loadSchedule();await schedule().getByRole('button',{name:'班次模板库',exact:true}).click();await library().waitFor();
        assert.equal(templateRequests(),beforeRemount);assert.equal(await library().getByText('合成夜班新版',{exact:true}).count(),0);
        assert.equal(data.protectedFingerprint(),afterPublish);assert.deepEqual(errors,[]);
        native.pass('held actual SQL200 cannot resurrect an unmounted template editor; remount stays unread and all test operations retain independent storage');
        console.log(JSON.stringify({shiftTemplatesBrowser:true,browserChecks:7,templatePosts:templatePosts(),counts:counts(),syntheticAuth:true,realAuthService:false,realNextServer:false,realPhone:false,productionAccess:false}));
      }finally{closing=true;for(const gate of gates)gate.release.resolve();await runAttendanceCleanupSteps([{name:'template-browser',run:()=>browser?.close()},{name:'template-routes',run:()=>Promise.allSettled([...pending])}]);}
    });
  }catch(error){console.error(JSON.stringify({shiftTemplatesBrowserFailed:true,phase,sourceLine:String(error?.stack??'').match(/shift-templates-browser-check\.mjs:(\d+):/)?.[1]??null,errors,requests}));throw Error('shift_templates_browser_failed');}
  finally{closing=true;for(const gate of gates)gate.release.resolve();await runAttendanceCleanupSteps([{name:'browser',run:()=>browser?.close()},{name:'routes',run:()=>Promise.allSettled([...pending])},
    {name:'harness',timeoutMs:10000,run:async()=>{if(child.pid!==undefined&&child.exitCode===null&&child.signalCode===null){const stopped=once(child,'exit');child.kill();await stopped;}}}]);}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  await runAttendanceLabelsReuse(process.argv.slice(2),native=>withAttendanceConcurrencySandbox(native,scope=>checkShiftTemplatesBrowser(native,scope)))
    .catch(()=>{console.error('shift_templates_browser_failed');process.exitCode=1;});
}
