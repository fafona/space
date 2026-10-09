// Real groups launcher/client and default handlers/SDK against an owned
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
import {prepareGroupsNativeFixture} from './merchant-attendance-groups-native.mjs';
import {runAttendanceCleanupSteps} from './fixtures/attendance-cleanup.mjs';

const require=createRequire(import.meta.url);
const {withAttendanceApplicationAuth}=require('./fixtures/attendance-application-auth.ts');
const {handleGroups}=require('../src/app/api/merchant-enterprise/attendance/groups/route-handler.ts');
const {handleAttendanceAdmin}=require('../src/app/api/merchant-enterprise/attendance/admin/route-handler.ts');
const {requireMerchantEnterpriseEntitlement}=require('../src/lib/merchantEnterpriseAuth.server.ts');
const {MERCHANT_AUTH_COOKIE}=require('../src/lib/merchantAuthSession.ts');
const origin='https://127.0.0.1:3131',staticOrigin='http://127.0.0.1:3131',canonical='https://www.faolla.com';
const prefix='/api/merchant-enterprise/attendance/',localFetch=globalThis.fetch;
const literal=value=>value===null?'null':"'"+String(value).replaceAll("'","''")+"'";
const json=value=>value===null?'null':literal(JSON.stringify(value))+'::jsonb';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
const bounded=async promise=>{let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('groups_browser_timeout')),20000);})]);}finally{clearTimeout(timer);}};

export async function checkAttendanceGroupsBrowser(native,scope){
  const data=await prepareGroupsNativeFixture(native,scope),pickerLocationId=id(301);
  data.exec(`insert into public.merchant_attendance_locations(id,merchant_id,name,time_zone,active)
      values('${pickerLocationId}','${data.site}','合成归组地点','UTC',true);
    update public.merchant_attendance_workers set default_location_id='${pickerLocationId}'
      where merchant_id='${data.site}' and id in('${data.workerId}','${data.otherWorkerId}');
    insert into public.merchant_attendance_employment_periods(merchant_id,worker_id,starts_on) values
      ('${data.site}','${data.workerId}','2000-01-01'),('${data.site}','${data.otherWorkerId}','2000-01-01');`);
  assert.deepEqual(JSON.parse(data.exec(`select jsonb_build_object(
      'location',(select count(*)::integer from public.merchant_attendance_locations where merchant_id='${data.site}' and id='${pickerLocationId}' and active and time_zone='UTC'),
      'workers',(select count(*)::integer from public.merchant_attendance_workers where merchant_id='${data.site}' and id in('${data.workerId}','${data.otherWorkerId}') and employee_id is not null and default_location_id='${pickerLocationId}'),
      'periods',(select count(*)::integer from public.merchant_attendance_employment_periods where merchant_id='${data.site}' and worker_id in('${data.workerId}','${data.otherWorkerId}') and starts_on='2000-01-01' and ends_on is null));`)),
    {location:1,workers:2,periods:2},'groups_browser_picker_fixture_incomplete');
  const pickerPage=JSON.parse(data.exec(`set local role service_role;select public.faolla_attendance_admin_v1(
    '${data.site}','${data.owner}',${json({view:'workers',cursor:null,search:'合成归组员工甲'})},null,null);`));
  assert.deepEqual(pickerPage.items,[{id:data.workerId,employeeId:id(101),workerNo:'GROUP-A',displayName:'合成归组员工甲',locationId:pickerLocationId,active:true,startsOn:'2000-01-01'}],
    'groups_browser_old_admin_picker_did_not_return_complete_worker');
  const protectedBefore=data.protectedFingerprint();
  const counts=()=>JSON.parse(data.exec(`select jsonb_build_object(
    'groups',(select count(*)::integer from public.merchant_attendance_groups),
    'groupOperations',(select count(*)::integer from public.merchant_attendance_group_operations),
    'assignments',(select count(*)::integer from public.merchant_attendance_group_assignments),
    'assignmentOperations',(select count(*)::integer from public.merchant_attendance_group_assignment_operations));`));
  const actor={id:data.owner,email:'groups-owner@example.test'},requests=[],errors=[],pending=new Set(),gates=new Set();
  let closing=false,browser,hold=null,loseSuccessfulPost=false,moduleEnabled=true,phase='harness';
  const adminSource=readFileSync(path.join(native.root,'src/components/enterprise/MerchantAttendanceAdminPanel.tsx'),'utf8');
  const launcherSource=readFileSync(path.join(native.root,'src/components/enterprise/MerchantAttendanceGroupsLauncher.tsx'),'utf8');
  assert(adminSource.includes('<GroupsLauncher siteId={siteId} ownerId={ownerId}'));
  assert(launcherSource.includes('process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_GROUPS_ENABLED === "1"'));
  assert(launcherSource.includes('if (!enabled || !active) return null'));
  const probe=net.createServer();
  await new Promise((resolve,reject)=>{probe.once('error',reject);probe.listen(3131,'127.0.0.1',resolve);});
  await new Promise(resolve=>probe.close(resolve));
  const child=spawn(process.execPath,['scripts/attendance-self-browser-harness.mjs','--groups'],{cwd:native.root,windowsHide:true,stdio:['ignore','pipe','pipe']});
  child.stderr.on('data',()=>errors.push('harness_stderr'));
  const rpc=async(name,args)=>{
    let params;
    if(name==='faolla_attendance_groups_v1'){
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
      const context=await browser.newContext({viewport:{width:1280,height:1150},serviceWorkers:'block',acceptDownloads:false});
      await context.addCookies([{name:MERCHANT_AUTH_COOKIE,value:await auth.login(actor),url:origin,secure:true,httpOnly:true,sameSite:'Lax'}]);
      await context.addInitScript(()=>sessionStorage.setItem('qa-unrelated-groups','preserve'));
      await context.route('**/*',route=>{
        if(closing)return route.abort().catch(()=>{});
        const work=(async()=>{
          const request=route.request(),url=new URL(request.url());assert.equal(url.origin,origin);
          if(['/', '/harness.js','/harness.css'].includes(url.pathname)){
            assert.equal(request.method(),'GET');const response=await localFetch(staticOrigin+url.pathname);
            return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});
          }
          const key=url.pathname.slice(prefix.length),handlers={groups:handleGroups,admin:handleAttendanceAdmin};
          assert.equal(url.pathname,prefix+key);assert(Object.hasOwn(handlers,key));assert(['GET','POST'].includes(request.method()));
          if(key==='admin')assert.equal(request.method(),'GET');
          const headers=new Headers(await request.allHeaders());assert(headers.get('cookie')?.includes(MERCHANT_AUTH_COOKIE+'='));assert.equal(headers.get('x-merchant-access-token'),null);
          headers.set('host','www.faolla.com');headers.set('referer',canonical+'/');if(headers.has('origin'))headers.set('origin',canonical);
          const response=await handlers[key](new Request(canonical+url.pathname+url.search,{method:request.method(),headers,body:request.postData()??undefined}),{enabled:()=>true,entitlement});
          const body=await response.text(),parsed=JSON.parse(body);requests.push({key,method:request.method(),status:response.status,search:url.search});
          if(key==='groups'&&request.method()==='POST'&&response.status===200&&loseSuccessfulPost){loseSuccessfulPost=false;return route.abort('failed');}
          const gate=key==='groups'&&request.method()==='GET'?hold:null;
          if(gate){hold=null;gate.ready.resolve(parsed);await gate.release.promise;}
          try{await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body});}
          finally{if(gate){gate.finished.resolve();gates.delete(gate);}}
        })();pending.add(work);void work.finally(()=>pending.delete(work)).catch(()=>{});
        return work.catch(async()=>{if(!closing&&!route.request().failure())errors.push('route_failed');await route.abort().catch(()=>{});});
      });
      const page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',()=>errors.push('page_error'));page.on('dialog',dialog=>dialog.accept());
      const panel=()=>page.getByRole('region',{name:'考勤组与人员归组',exact:true});
      const groupsRequests=()=>requests.filter(item=>item.key==='groups').length;
      const groupsPosts=()=>requests.filter(item=>item.key==='groups'&&item.method==='POST').length;
      const groupCard=name=>panel().getByRole('article').filter({hasText:name});
      const chooseWorker=async()=>{
        await panel().getByLabel('归组人员搜索',{exact:true}).fill('合成归组员工甲');
        await panel().getByRole('button',{name:'搜索考勤人员',exact:true}).click();
        const worker=panel().getByRole('button',{name:'合成归组员工甲 · GROUP-A · 启用',exact:true});await worker.waitFor();await worker.click();
        await panel().getByText(/当前选中考勤档案：合成归组员工甲 · GROUP-A/).waitFor();
      };
      const createGroup=async(name,description,reason,lost=false)=>{
        await panel().getByRole('button',{name:'新建考勤组',exact:true}).click();
        await panel().getByLabel('考勤组名称',{exact:true}).fill(name);
        await panel().getByLabel('考勤组说明',{exact:true}).fill(description);
        await panel().getByRole('checkbox',{name:'允许向此组新增人员归组记录',exact:true}).check();
        await panel().getByLabel('考勤组保存原因',{exact:true}).fill(reason);
        loseSuccessfulPost=lost;await panel().getByRole('button',{name:'明确保存考勤组',exact:true}).click();
      };
      try{
        phase='empty-and-create-a-lost';
        await page.goto(origin+'/?'+new URLSearchParams({siteId:data.site,ownerId:data.owner}));assert.equal(groupsRequests(),0);
        await page.getByRole('button',{name:'考勤组与人员归组',exact:true}).click();await panel().waitFor();
        await panel().getByText('本页没有考勤组；不会自动创建默认组。',{exact:true}).waitFor();
        assert.equal(groupsRequests(),1);assert.deepEqual(counts(),{groups:0,groupOperations:0,assignments:0,assignmentOperations:0});assert.equal(await page.locator('form form').count(),0);
        await createGroup('合成考勤组 A','合成长时归组','负责人创建组 A',true);
        await panel().getByRole('button',{name:'用原编号明确重试',exact:true}).waitFor();
        assert.equal(groupsPosts(),1);assert.deepEqual(counts(),{groups:1,groupOperations:1,assignments:0,assignmentOperations:0});
        const storageKey=`faolla:attendance:groups:v1:${data.site}:${data.owner}`;
        const stored=JSON.parse(await page.evaluate(key=>sessionStorage.getItem(key),storageKey));
        assert.equal(stored.ownerId,data.owner);assert.equal(stored.command.action,'save_group');assert.equal(stored.command.name,'合成考勤组 A');
        assert.equal(data.protectedFingerprint(),protectedBefore);
        native.pass('actual default-off owner launcher reads an empty bounded group page; one lost200 creates group A once and preserves its exact pending command');

        phase='paused-receipt-and-group-b';moduleEnabled=false;
        await page.getByRole('button',{name:'卸载测试归组页',exact:true}).click();await panel().waitFor({state:'detached'});
        await page.getByRole('button',{name:'重挂测试归组页',exact:true}).click();
        await page.getByRole('button',{name:'考勤组与人员归组',exact:true}).click();await panel().waitFor();
        await panel().getByRole('region',{name:'考勤组操作收据',exact:true}).waitFor();
        assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),storageKey),null);assert.equal(groupsPosts(),1);
        assert.equal(await panel().getByRole('button',{name:'明确保存考勤组',exact:true}).isDisabled(),true);
        assert(requests.some(item=>item.key==='groups'&&item.method==='GET'&&item.search.includes(`operationId=${stored.command.operationId}`)));
        moduleEnabled=true;await panel().getByRole('button',{name:'返回考勤组列表',exact:true}).click();
        await createGroup('合成考勤组 B','合成后续归组','负责人创建组 B');
        await panel().getByRole('region',{name:'考勤组操作收据',exact:true}).getByText(/合成考勤组 B/).waitFor();
        assert.equal(groupsPosts(),2);assert.deepEqual(counts(),{groups:2,groupOperations:2,assignments:0,assignmentOperations:0});
        assert.equal(await page.evaluate(()=>sessionStorage.getItem('qa-unrelated-groups')),'preserve');assert.equal(data.protectedFingerprint(),protectedBefore);
        native.pass('paused remount recovers only group A original receipt without duplicate POST; after resume an independent confirmed group B is created');

        phase='assign-a-and-end';
        await panel().getByRole('button',{name:'返回考勤组列表',exact:true}).click();
        await groupCard('合成考勤组 A').getByRole('button',{name:'选择考勤组',exact:true}).click();
        const adminBefore=requests.filter(item=>item.key==='admin').length;assert.equal(adminBefore,0);await chooseWorker();
        await panel().getByLabel('归组开始日期',{exact:true}).fill('2026-11-01');
        await panel().getByLabel('人员归组原因',{exact:true}).fill('负责人明确归入组 A');
        await panel().getByRole('button',{name:'生成新增归组预览',exact:true}).click();await panel().getByRole('region',{name:'新增归组预览',exact:true}).waitFor();
        await panel().getByRole('checkbox',{name:/我已核对当前档案、目标组、企业日期、时区和原因/}).check();
        await panel().getByRole('button',{name:'明确新增人员归组',exact:true}).click();
        let detail=panel().getByRole('article',{name:'归组记录详情',exact:true});await detail.getByRole('heading',{name:/修订 1/}).waitFor();
        await panel().getByLabel('归组最后一日',{exact:true}).fill('2026-11-10');await panel().getByLabel('结束归组原因',{exact:true}).fill('负责人设置组 A 结束日期');
        await panel().getByRole('button',{name:'生成结束归组预览',exact:true}).click();await panel().getByRole('checkbox',{name:/我确认这是正常结束/}).check();
        await panel().getByRole('button',{name:'明确结束长期归组',exact:true}).click();
        detail=panel().getByRole('article',{name:'归组记录详情',exact:true});await detail.getByRole('heading',{name:'已设置结束日期 · 修订 2',exact:true}).waitFor();
        assert.equal(groupsPosts(),4);assert.deepEqual(counts(),{groups:2,groupOperations:2,assignments:1,assignmentOperations:2});assert.equal(data.protectedFingerprint(),protectedBefore);
        native.pass('actual current worker context creates one open-ended A assignment then sets its inclusive final date as revision2 without cancelling prior dates');

        phase='adjacent-b-and-cancel';
        await panel().getByRole('button',{name:'返回考勤组列表',exact:true}).click();
        await groupCard('合成考勤组 B').getByRole('button',{name:'选择考勤组',exact:true}).click();await chooseWorker();
        await panel().getByLabel('归组开始日期',{exact:true}).fill('2026-11-11');await panel().getByLabel('人员归组原因',{exact:true}).fill('负责人次日归入组 B');
        await panel().getByRole('button',{name:'生成新增归组预览',exact:true}).click();await panel().getByRole('checkbox',{name:/我已核对当前档案、目标组、企业日期、时区和原因/}).check();
        await panel().getByRole('button',{name:'明确新增人员归组',exact:true}).click();
        detail=panel().getByRole('article',{name:'归组记录详情',exact:true});await detail.getByRole('heading',{name:/修订 1/}).waitFor();
        await panel().getByLabel('整段撤销归组原因',{exact:true}).fill('负责人明确整段撤销组 B 误录');
        await panel().getByRole('button',{name:'生成整段撤销预览',exact:true}).click();await panel().getByRole('checkbox',{name:/我确认要整段撤销/}).check();
        await panel().getByRole('button',{name:'明确整段撤销归组',exact:true}).click();
        detail=panel().getByRole('article',{name:'归组记录详情',exact:true});await detail.getByRole('heading',{name:'整段已撤销 · 修订 2',exact:true}).waitFor();
        assert.equal(groupsPosts(),6);assert.deepEqual(counts(),{groups:2,groupOperations:2,assignments:2,assignmentOperations:4});assert.equal(data.protectedFingerprint(),protectedBefore);
        native.pass('the next-day B assignment is accepted after A ends; explicit cancel marks only B entirely void and retains both immutable operation histories');

        phase='cross-group-history-mobile';
        await panel().getByRole('button',{name:'返回考勤组列表',exact:true}).click();
        await groupCard('合成考勤组 A').getByRole('button',{name:'选择考勤组',exact:true}).click();await chooseWorker();
        await panel().getByRole('button',{name:'查看该档案全部归组',exact:true}).click();
        const list=panel().getByRole('region',{name:'归组记录列表',exact:true});await list.waitFor();
        await list.getByText('已设置结束日期',{exact:true}).waitFor();await list.getByText('整段已撤销',{exact:true}).waitFor();
        assert.equal(await panel().getByRole('form',{name:'新建考勤组',exact:true}).count(),0);
        assert.equal(await list.getByRole('article').count(),2);
        await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
        assert.equal(groupsPosts(),6);assert.equal(data.protectedFingerprint(),protectedBefore);
        native.pass('worker-only cross-group query shows preserved ended A and cancelled B with historical labels, no accidental new-group editor, and no390px overflow');

        phase='held-hide-unmount';
        const gate={ready:deferred(),release:deferred(),finished:deferred()};gates.add(gate);hold=gate;
        await panel().getByRole('button',{name:'重新读取考勤组',exact:true}).click();const held=await bounded(gate.ready.promise);assert.equal(held.ok,true);
        await page.getByRole('button',{name:'隐藏归组入口',exact:true}).click();await panel().waitFor({state:'detached'});
        gate.release.resolve();await bounded(gate.finished.promise);
        const beforeShow=groupsRequests();await page.getByRole('button',{name:'显示归组入口',exact:true}).click();
        await page.getByRole('button',{name:'考勤组与人员归组',exact:true}).waitFor();assert.equal(groupsRequests(),beforeShow);
        assert.equal(await page.getByText('合成考勤组 A',{exact:true}).count(),0);
        await page.getByRole('button',{name:'卸载测试归组页',exact:true}).click();await page.getByRole('button',{name:'重挂测试归组页',exact:true}).click();
        assert.equal(groupsRequests(),beforeShow);assert.deepEqual(errors,[]);assert.equal(data.protectedFingerprint(),protectedBefore);
        native.pass('a held actual SQL GET cannot repopulate hidden or unmounted groups UI; a fresh closed launcher performs no automatic late read');
        console.log(JSON.stringify({groupsBrowser:true,browserChecks:6,groupsPosts:groupsPosts(),counts:counts(),syntheticAuth:true,
          realAuthService:false,realNextServer:false,realPhone:false,productionAccess:false,screenshots:false,recordings:false}));
      }finally{
        closing=true;for(const gate of gates)gate.release.resolve();
        await runAttendanceCleanupSteps([{name:'groups-browser',run:()=>browser?.close()},{name:'groups-routes',run:()=>Promise.allSettled([...pending])}]);
      }
    });
  }catch(error){
    console.error(JSON.stringify({groupsBrowserFailed:true,phase,sourceLine:String(error?.stack??'').match(/groups-browser-check\.mjs:(\d+):/)?.[1]??null,errors,requestCount:requests.length}));
    throw Error('groups_browser_failed');
  }finally{
    closing=true;for(const gate of gates)gate.release.resolve();
    await runAttendanceCleanupSteps([{name:'browser',run:()=>browser?.close()},{name:'routes',run:()=>Promise.allSettled([...pending])},
      {name:'harness',timeoutMs:10000,run:async()=>{if(child.pid!==undefined&&child.exitCode===null&&child.signalCode===null){const stopped=once(child,'exit');child.kill();await stopped;}}}]);
  }
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  await runAttendanceLabelsReuse(process.argv.slice(2),native=>withAttendanceConcurrencySandbox(native,scope=>checkAttendanceGroupsBrowser(native,scope)))
    .catch(()=>{console.error('groups_browser_failed');process.exitCode=1;});
}
