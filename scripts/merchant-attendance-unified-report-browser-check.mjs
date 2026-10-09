// Actual old report entry -> actual new component/route/service -> isolated SQL.
// Authentication context and HTTP transport only are synthetic; no external access.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import net from 'node:net';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {chromium} from 'playwright';
import {runAttendanceLabelsReuse} from './merchant-attendance-choice-labels-reuse-native.mjs';
import {checkUnifiedReport} from './merchant-attendance-unified-report-native.mjs';
const require=createRequire(import.meta.url);
const {handleUnifiedTimesheet}=require('../src/app/api/merchant-enterprise/attendance/unified-timesheet/route-handler.ts');
const {executeUnifiedTimesheet}=require('../src/lib/merchantAttendanceUnifiedTimesheet.server.ts');
const {handleAttendanceTimesheet}=require('../src/app/api/merchant-enterprise/attendance/timesheet/route-handler.ts');
const {executeAttendanceTimesheet}=require('../src/lib/merchantAttendanceTimesheet.server.ts');
const {handleAttendanceScopedTimesheet}=require('../src/app/api/merchant-enterprise/attendance/scoped-timesheet/route-handler.ts');
const {executeAttendanceScopedTimesheet}=require('../src/lib/merchantAttendanceScopedTimesheet.server.ts');
const {handleAttendanceScopedContext}=require('../src/app/api/merchant-enterprise/attendance/scoped-timesheet-context/route-handler.ts');
const {executeScopedContext}=require('../src/lib/merchantAttendanceScopedTimesheetContext.server.ts');
const {handleAttendanceChoices}=require('../src/app/api/merchant-enterprise/attendance/choices/route-handler.ts');
const {executeAttendanceChoices}=require('../src/lib/merchantAttendanceManagement.server.ts');
const {handleAttendanceAdmin}=require('../src/app/api/merchant-enterprise/attendance/admin/route-handler.ts');
const {executeAttendanceAdmin}=require('../src/lib/merchantAttendanceAdmin.server.ts');
const {handleUnifiedExport}=require('../src/app/api/merchant-enterprise/attendance/unified-export/route-handler.ts');
const {executeUnifiedExport}=require('../src/lib/merchantAttendanceUnifiedExport.server.ts');
const literal=v=>v===null||v===undefined?'null':"'"+String(v).replaceAll("'","''")+"'",json=v=>v===null||v===undefined?'null':literal(JSON.stringify(v))+'::jsonb';
export async function browserCheck({root,exec,id,owner,employee,manager,pass},{exportEnabled=false,exportChecks=null}={}){
  const origin='http://127.0.0.1:3131',canonical='https://www.faolla.com',probe=net.createServer();
  await new Promise((resolve,reject)=>{probe.once('error',reject);probe.listen(3131,'127.0.0.1',resolve);});await new Promise(resolve=>probe.close(resolve));
  const child=spawn(process.execPath,['scripts/attendance-self-browser-harness.mjs','--unified',...(exportEnabled?['--unified-export']:[])],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});
  let browser;const errors=[],external=[],requests=[],controls={enabled:true};
  const service={rpc:async(name,args)=>{
    assert.equal(args.p_site_id,'99990001');assert([owner,employee,id(2),manager].includes(args.p_auth_user_id));
    assert(['faolla_attendance_unified_report_v1','faolla_attendance_period_report_v2','faolla_attendance_scoped_period_report_v2','faolla_attendance_scoped_report_context_v1','faolla_attendance_choices_v1','faolla_attendance_admin_v1',...(exportEnabled?['faolla_attendance_unified_export_v1']:[])].includes(name));
    const params=[literal(args.p_site_id),literal(args.p_auth_user_id),...(name==='faolla_attendance_unified_export_v1'?[literal(args.p_operation_id)]:[]),json(args.p_query)];if(name==='faolla_attendance_admin_v1'){assert.equal(args.p_command,null);params.push('null','null');}
    try{const r=JSON.parse(exec(`set role service_role;select jsonb_build_object('role',current_user,'data',public.${name}(${params.join(',')}));`));assert.equal(r.role,'service_role');return {data:r.data,error:null};}
    catch(e){const code=String(e).match(/ERROR:\s+(attendance_[a-z_]+)/)?.[1];if(!code)throw e;return {data:null,error:{message:code}};}
  }};
  try{
    await new Promise((resolve,reject)=>{let output='';const timer=setTimeout(()=>reject(Error('unified_harness_timeout')),20000);
      child.stdout.on('data',v=>{output+=v;if(output.includes('Attendance synthetic component QA')){clearTimeout(timer);resolve();}});child.stderr.on('data',v=>errors.push(String(v)));child.once('exit',code=>{clearTimeout(timer);reject(Error('harness_exit_'+code));});});
    browser=await chromium.launch({headless:true});const context=await browser.newContext({viewport:{width:1280,height:960},serviceWorkers:'block'});
    await context.route('**/*',async route=>{
      const request=route.request(),url=new URL(request.url());if(url.origin!==origin){external.push(url.origin);return route.abort();}
      if(!url.pathname.startsWith('/api/'))return request.method()==='GET'&&['/','/harness.js','/harness.css'].includes(url.pathname)?route.continue():route.abort();
      try{
        const exporting=exportEnabled&&url.pathname.endsWith('/unified-export');assert.equal(request.method(),exporting?'POST':'GET');const headers=new Headers(await request.allHeaders()),actor=headers.get('x-attendance-test-actor');assert(['owner','a','b','manager'].includes(actor));
        const authUserId=actor==='owner'?owner:actor==='manager'?manager:actor==='a'?employee:id(2);
        if(headers.get('origin')===origin)headers.set('origin',canonical);headers.set('host','www.faolla.com');if(headers.get('referer')?.startsWith(origin))headers.set('referer',canonical+'/');
        const r=new Request(canonical+url.pathname+url.search,{headers,method:request.method(),...(exporting?{body:request.postData()}: {})}),deps={enabled:()=>true,accessEnabled:()=>true,allow:()=>true,
          authenticate:async()=>({user:{id:authUserId},accessToken:'synthetic',authenticationMethods:['password']}),entitlement:async()=>({permissionConfig:{allowEnterpriseManagement:true,allowEmployeeAttendance:controls.enabled}})};
        const handlers={admin:[handleAttendanceAdmin,executeAttendanceAdmin],choices:[handleAttendanceChoices,executeAttendanceChoices],timesheet:[handleAttendanceTimesheet,executeAttendanceTimesheet],
          'scoped-timesheet-context':[handleAttendanceScopedContext,executeScopedContext],'scoped-timesheet':[handleAttendanceScopedTimesheet,executeAttendanceScopedTimesheet],'unified-timesheet':[handleUnifiedTimesheet,executeUnifiedTimesheet],...(exportEnabled?{'unified-export':[handleUnifiedExport,executeUnifiedExport]}:{})};
        const pair=handlers[url.pathname.split('/').at(-1)];assert(pair);const response=await pair[0](r,{...deps,execute:input=>pair[1](input,service)});
        requests.push({actor,path:url.pathname,status:response.status,method:request.method()});
        if(exporting&&controls.dropExportResponse){controls.dropExportResponse=false;return route.abort();}
        await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:await response.text()});
      }catch(e){errors.push(String(e));await route.abort();}
    });
    const page=await context.newPage();page.on('pageerror',e=>errors.push(String(e)));page.setDefaultTimeout(10000);
    const panel=()=>page.getByRole('region',{name:'含整段漏卡工时工作区'});
    const open=async actor=>{
      if(actor!=='initial')await page.getByRole('button',{name:actor==='owner'?'合成负责人':actor==='a'?'合成员工甲':actor==='b'?'合成员工乙':'合成主管',exact:true}).click();
      if(actor==='initial'||actor==='owner'){
        await page.getByRole('button',{name:/核对员工甲.*A01/}).click();await page.getByRole('button',{name:'查询工时',exact:true}).click();
      }else{
        if(actor==='manager')await page.getByRole('button',{name:/核对员工甲.*合成地点甲/}).click();
        await page.getByRole('button',{name:'查询可见工时',exact:true}).click();
      }
      await page.getByRole('button',{name:'含整段漏卡的工时核对',exact:true}).click();await panel().getByRole('button',{name:'查询含整段漏卡工时',exact:true}).click();
      await panel().getByRole('status').filter({hasText:'已核对完整可见来源'}).waitFor();
    };
    const total=()=>panel().getByRole('region',{name:'含整段申报工时合计'}).getByRole('row',{name:/^工作段/}).getByRole('cell').last();
    await page.goto(origin);await open('initial');assert.equal(await total().innerText(),'17 小时 0 分 0 秒');
    await panel().getByRole('heading',{name:'已批准整段申报 · 2 条',exact:true}).waitFor();await panel().getByText(/原报表及其导出仍为旧口径/).waitFor();
    assert.equal(await panel().getByRole('region',{name:'含整段申报的受控导出'}).count(),exportEnabled?1:0);pass('actual owner report entry opens combined report with 17h total, two separate missing sources and no misleading legacy export');
    await open('a');assert.equal(await total().innerText(),'17 小时 0 分 0 秒');await panel().getByText(/不是该员工完整个人月报/).waitFor();
    await open('b');assert.equal(await total().innerText(),'0 小时 0 分 0 秒');await panel().getByRole('heading',{name:'已批准整段申报 · 0 条',exact:true}).waitFor();
    pass('actual employee scoped report entry includes own approved declarations only; second employee receives no first employee totals or sources');
    await page.setViewportSize({width:390,height:844});await open('manager');assert.equal(await total().innerText(),'17 小时 0 分 0 秒');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+1),false);pass('actual authorized manager pair selector opens same combined report at 390px without horizontal page overflow');
    const before=requests.length;await panel().getByLabel('合并核对开始日期',{exact:true}).fill('2000-01-01');assert.equal(await panel().getByRole('article',{name:'含整段漏卡工时结果'}).count(),0);assert.equal(requests.length,before);
    await panel().getByRole('button',{name:'查询含整段漏卡工时',exact:true}).click();await panel().getByRole('status').filter({hasText:'无法读取可靠'}).waitFor();assert.equal(requests.length,before);
    pass('changing dates clears old totals immediately and invalid range does not send a request');
    await open('owner');controls.enabled=false;await panel().getByRole('button',{name:'查询含整段漏卡工时',exact:true}).click();await panel().getByText('平台暂停新考勤；本页按有效权限核对历史记录。').waitFor();assert.equal(await total().innerText(),'17 小时 0 分 0 秒');
    pass('platform pause leaves authorized read-only combined historical totals available');
    await open('manager');const previousPermissions=JSON.parse(exec(`select to_jsonb(permissions) from public.merchant_enterprise_roles where id='${id(31)}';`));exec(`update public.merchant_enterprise_roles set permissions=array['enterprise.view'] where id='${id(31)}';`);
    try{await panel().getByRole('button',{name:'查询含整段漏卡工时',exact:true}).click();await page.getByRole('status').filter({hasText:'已清除工时资料'}).waitFor();assert.equal(await panel().count(),0);assert.equal(await page.getByRole('article',{name:'可见工时查询结果'}).count(),0);}
    finally{exec(`update public.merchant_enterprise_roles set permissions=array[${previousPermissions.map(literal).join(',')}] where id='${id(31)}';`);}
    pass('revoking actual database manager permission rejects next actual route read and clears both combined and parent legacy protected results');
    if(exportChecks)await exportChecks({page,panel,open,total,requests,controls,exec,id,pass});
    assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert(requests.every(r=>r.status===200||r.status===403));
    console.log(JSON.stringify({unifiedBrowserPassed:true,realAuthService:false,productionAccess:false,businessWrites:0,metadataExportRequests:requests.filter(r=>r.method==='POST').length,persistentArtifacts:false}));
  }finally{await browser?.close();if(child.exitCode===null){const stopped=once(child,'exit');child.kill();await stopped;}}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))runAttendanceLabelsReuse(process.argv.slice(2),native=>checkUnifiedReport(native,browserCheck)).catch(e=>{console.error(e);process.exitCode=1;});
