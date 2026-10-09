// Opt-in local synthetic acceptance: actual role/scope forms and supervisor
// records page -> default handlers/SDK -> service-role SQL. Not production,
// real Auth/Next/phone, push revocation, historical punch creation or load test.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import net from 'node:net';
import {chromium} from 'playwright';
import {runAttendanceLabelsReuse} from './merchant-attendance-choice-labels-reuse-native.mjs';
import {withAttendanceConcurrencySandbox} from './merchant-attendance-concurrency-sandbox.mjs';
import {prepareAttendanceSupervisorAccessFixture} from './merchant-attendance-supervisor-access-fixture.mjs';
import {runAttendanceCleanupSteps} from './fixtures/attendance-cleanup.mjs';
const require=createRequire(import.meta.url);
const {withAttendanceApplicationAuth}=require('./fixtures/attendance-application-auth.ts');
const {createEventChannelsShellTransport}=require('./fixtures/attendance-event-channels-shell-transport.ts');
const {serveAttendanceMerchantBootstrap}=require('./fixtures/attendance-merchant-shell-transport.ts');
const {MERCHANT_AUTH_COOKIE}=require('../src/lib/merchantAuthSession.ts');
const {resolveValidatedMerchantEnterpriseAuthUser,requireMerchantEnterpriseEntitlement}=require('../src/lib/merchantEnterpriseAuth.server.ts');
const {resolveMerchantBusinessActor}=require('../src/lib/merchantBusinessActor.server.ts');
const {handleMerchantBusinessCapabilitiesGet}=require('../src/app/api/merchant-business/capabilities/route-handler.ts');
const {GET:overview}=require('../src/app/api/merchant-enterprise/overview/route-handler.ts');
const {PATCH:updateRole}=require('../src/app/api/merchant-enterprise/roles/route-handler.ts');
const {handleAttendanceRecords}=require('../src/app/api/merchant-enterprise/attendance/records/route-handler.ts');
const {handleAttendanceScopes}=require('../src/app/api/merchant-enterprise/attendance/scopes/route-handler.ts');
const {handleAttendanceChoices}=require('../src/app/api/merchant-enterprise/attendance/choices/route-handler.ts');
const localFetch=globalThis.fetch,origin='https://127.0.0.1:3131',staticOrigin='http://127.0.0.1:3131',canonical='https://www.faolla.com';
const prefix='/api/merchant-enterprise/',rolePath=prefix+'roles',overviewPath=prefix+'overview';
const recordsPath=prefix+'attendance/records',scopesPath=prefix+'attendance/scopes',choicesPath=prefix+'attendance/choices';
const off=['enterprise.view'],on=[...off,'attendance.records.view'];
const sorted=value=>[...value].sort();
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
const bounded=async(promise,label)=>{let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(label)),20000);})]);}finally{clearTimeout(timer);}};

export function assertSupervisorAccessAudit({before,after,site,ownerId,roleId,employeeId,workerId,locationId}){
  const previous=before.roles.find(row=>row.id===roleId),current=after.roles.find(row=>row.id===roleId);assert(previous&&current);
  assert.equal(current.version,previous.version+3);assert.deepEqual(sorted(current.permissions),sorted(on));
  assert.deepEqual({...current,version:previous.version,permissions:previous.permissions,updated_at:previous.updated_at},previous);
  assert.deepEqual(after.roles.filter(row=>row.id!==roleId),before.roles.filter(row=>row.id!==roleId));
  for(const row of before.audits)assert.deepEqual(after.audits.find(next=>next.id===row.id),row);
  const audits=after.audits.filter(row=>!before.audits.some(old=>old.id===row.id)).sort((a,b)=>a.created_at.localeCompare(b.created_at));
  assert.equal(audits.length,3);
  for(const [index,row] of audits.entries()){
    assert.equal(row.merchant_id,site);assert.equal(row.entity_id,roleId);assert.equal(row.event_type,'role.updated');
    assert.equal(row.actor_type,'owner');assert.equal(row.actor_id,null);
    assert.deepEqual(sorted(row.before_data.permissions),sorted([off,on,off][index]));
    assert.deepEqual(sorted(row.after_data.permissions),sorted([on,off,on][index]));
    assert.deepEqual({...row.after_data,permissions:row.before_data.permissions},row.before_data);
  }
  assert.equal(before.scopes.length,0);assert.equal(before.grants.length,0);assert.equal(before.scopeOperations.length,0);
  assert.deepEqual(after.scopes,[{merchant_id:site,employee_id:employeeId,revision:3}]);assert.equal(after.grants.length,1);
  const operations=[...after.scopeOperations].sort((a,b)=>a.revision-b.revision);assert.equal(operations.length,3);
  for(const [index,row] of operations.entries()){
    assert.equal(row.merchant_id,site);assert.equal(row.employee_id,employeeId);assert.equal(row.actor_auth_user_id,ownerId);
    assert.equal(row.revision,index+1);assert.equal(row.command.expectedRevision,index);assert.equal(row.command.operationId,row.operation_id);
    assert.equal(row.command.action,['put','remove','put'][index]);
    assert.equal(row.before_value.revision,index);assert.equal(row.after_value.revision,index+1);
    assert.equal(row.before_value.grants.length,[0,1,0][index]);assert.equal(row.after_value.grants.length,[1,0,1][index]);
    if(index===1){assert.equal(row.command.grant,null);assert.equal(row.command.grantId,operations[0].command.grantId);}
    else{
      assert.deepEqual(row.command.grant.workerIds,[workerId]);assert.deepEqual(row.command.grant.locationIds,[locationId]);
      assert.equal(row.command.grant.validUntil,null);assert.equal(row.after_value.grants[0].id,row.command.grantId);
      assert.deepEqual(row.after_value.grants[0].workerIds,[workerId]);assert.deepEqual(row.after_value.grants[0].locationIds,[locationId]);
    }
    if(index>0)assert.deepEqual(row.before_value,operations[index-1].after_value);
  }
  assert.notEqual(operations[0].command.grantId,operations[2].command.grantId);
  assert.equal(after.grants[0].id,operations[2].command.grantId);
  assert.equal(after.grants[0].employee_id,employeeId);assert.equal(after.grants[0].merchant_id,site);
  assert.deepEqual(after.grants[0].workerIds,[workerId]);assert.deepEqual(after.grants[0].locationIds,[locationId]);
  assert.equal(after.grants[0].valid_until,null);
  assert.equal(Date.parse(after.grants[0].valid_from),Date.parse(operations[2].command.grant.validFrom));
}

export function supervisorAccessRecord(pathname,method,status,payload){
  return {path:pathname,method,status,error:typeof payload?.error==='string'&&/^[a-z_]{1,80}$/.test(payload.error)?payload.error:null};
}

export async function checkAttendanceSupervisorAccessBrowser(native){
  await withAttendanceConcurrencySandbox(native,async scope=>{
    const data=await prepareAttendanceSupervisorAccessFixture(native,scope),site=data.site;
    const shell=createEventChannelsShellTransport(data.exec,data.actors),initial=data.facts(),protectedBefore=data.protectedFingerprint();
    const safe=()=>assert.equal(data.protectedFingerprint(),protectedBefore);
    const probe=net.createServer();await new Promise((resolve,reject)=>{probe.once('error',reject);probe.listen(3131,'127.0.0.1',resolve);});await new Promise(resolve=>probe.close(resolve));
    const child=spawn(process.execPath,['scripts/attendance-self-browser-harness.mjs','--merchant-shell','--database-entry'],{cwd:native.root,windowsHide:true,stdio:['ignore','pipe','pipe']});
    let browser,closing=false,phase='harness',heldNext=null;
    const requests=[],errors=[],external=[],pendingRoutes=new Set(),gates=new Set();
    const savedMode=process.env.FAOLLA_PLATFORM_SNAPSHOT_WRITE_MODE;process.env.FAOLLA_PLATFORM_SNAPSHOT_WRITE_MODE='off';
    child.stderr.on('data',()=>errors.push({kind:'harness_stderr'}));
    try{
      await bounded(new Promise((resolve,reject)=>{let output='';child.stdout.on('data',value=>{output+=String(value);if(output.includes('Attendance synthetic component QA'))resolve();});child.once('error',()=>reject(Error('harness_start_failed')));child.once('exit',()=>reject(Error('harness_exited')));}), 'supervisor_harness_timeout');
      assert.equal((await localFetch(staticOrigin+scopesPath,{method:'POST'})).status,403);
      browser=await chromium.launch({headless:true});
      await withAttendanceApplicationAuth(data.actors,data.rpc,async auth=>{
        try{
          const entitlement=value=>requireMerchantEnterpriseEntitlement(value,async()=>[{id:site,permissionConfig:{allowEnterpriseManagement:true,allowEmployeeAttendance:true}}]);
          const newPage=async isOwner=>{
            const context=await browser.newContext({viewport:isOwner?{width:1280,height:960}:{width:390,height:844},isMobile:!isOwner,hasTouch:!isOwner,serviceWorkers:'block',acceptDownloads:false});
            await context.addInitScript(()=>localStorage.setItem('merchant-space:locale:v1','zh-CN'));
            if(isOwner)await context.addCookies([{name:MERCHANT_AUTH_COOKIE,value:await auth.login(data.owner),url:origin,secure:true,httpOnly:true,sameSite:'Lax'}]);
            await context.route('**/*',route=>{
              if(closing)return route.abort().catch(()=>{});
              const work=(async()=>{
                const r=route.request(),url=new URL(r.url());
                if(url.origin!==origin){external.push('external_request');return route.abort();}
                if(isOwner&&url.pathname==='/downloads/faolla-android-version.json'){assert.equal(r.method(),'GET');return route.fulfill({status:404,contentType:'application/json',body:'{}'});}
                if(isOwner&&['/auth/v1/settings','/rest/v1/'].includes(url.pathname)){assert.equal(r.method(),'GET');return route.fulfill({status:200,contentType:'application/json',body:'{}'});}
                if(!url.pathname.startsWith('/api/')&&!url.pathname.startsWith('/auth/v1/')){
                  assert.equal(r.method(),'GET');assert(['/'+site,'/enterprise','/enterprise/'+site,'/harness.js','/harness.css'].includes(url.pathname));
                  const response=await localFetch(staticOrigin+url.pathname);return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});
                }
                const headers=new Headers(await r.allHeaders()),raw=r.postData()??undefined;
                if(url.pathname.startsWith('/auth/v1/')){
                  assert(!isOwner);const response=await fetch(new Request('https://attendance-auth.invalid'+url.pathname+url.search,{method:r.method(),headers,body:raw}));
                  return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:await response.text()});
                }
                if(isOwner){assert.equal(headers.get('x-merchant-access-token'),null);assert(headers.get('cookie')?.includes(MERCHANT_AUTH_COOKIE+'='));}
                else{assert(headers.get('x-merchant-access-token'));assert.equal(headers.get('cookie'),null);}
                if(headers.get('origin')===origin)headers.set('origin',canonical);
                if(headers.get('referer')?.startsWith(origin+'/'))headers.set('referer',canonical+headers.get('referer').slice(origin.length));headers.set('host','www.faolla.com');
                const request=new Request(canonical+url.pathname+url.search,{method:r.method(),headers,body:raw});let response;
                if(url.pathname===overviewPath){assert.equal(r.method(),'GET');response=await overview(request);}
                else if(url.pathname===rolePath){assert(isOwner);assert.equal(r.method(),'PATCH');response=await updateRole(request);}
                else if(url.pathname===recordsPath){assert.equal(r.method(),'GET');response=await handleAttendanceRecords(request,{enabled:()=>true,entitlement});}
                else if(url.pathname===scopesPath){assert(isOwner);assert(['GET','POST'].includes(r.method()));response=await handleAttendanceScopes(request,{enabled:()=>true,entitlement});}
                else if(url.pathname===choicesPath){assert(isOwner);assert.equal(r.method(),'GET');response=await handleAttendanceChoices(request,{enabled:()=>true,entitlement});}
                else if(url.pathname==='/api/merchant-business/capabilities'){
                  assert.equal(r.method(),'GET');response=await handleMerchantBusinessCapabilitiesGet(request,{resolveActor:(value,options)=>resolveMerchantBusinessActor(value,options,{rolloutConfig:{mode:'off',siteIds:[],valid:true},loadSite:async()=>({id:site,permissionConfig:{allowEnterpriseManagement:true,allowEmployeeAttendance:true}})})});
                }else if([prefix+'current-operations',prefix+'todos',prefix+'workflow-permission-gaps'].includes(url.pathname)){
                  assert.equal(r.method(),'GET');await resolveValidatedMerchantEnterpriseAuthUser(request);response=Response.json({ok:false,error:'synthetic_unrelated_read_out_of_scope'},{status:503});
                }else if(!isOwner&&[prefix+'memberships',prefix+'employees/accept'].includes(url.pathname)){
                  const identity=await resolveValidatedMerchantEnterpriseAuthUser(request);response=await shell.serveShell(request,identity.id);
                }else{const identity=await resolveValidatedMerchantEnterpriseAuthUser(request);response=isOwner?serveAttendanceMerchantBootstrap(request,identity.id):null;assert(response,'supervisor_unexpected_endpoint');}
                const body=await response.text(),payload=JSON.parse(body);requests.push(supervisorAccessRecord(url.pathname,r.method(),response.status,payload));
                const held=!isOwner&&url.pathname===recordsPath&&response.status===200?heldNext:null;
                if(held){heldNext=null;held.ready.resolve(payload);await held.release.promise;}
                try{await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body});}
                finally{if(held){held.finished.resolve();gates.delete(held);}}
              })();pendingRoutes.add(work);void work.finally(()=>pendingRoutes.delete(work)).catch(()=>{});
              return work.catch(async error=>{if(!closing&&!route.request().failure())errors.push({kind:'route',sourceLine:String(error?.stack??'').match(/supervisor-access-browser-check\.mjs:(\d+):/)?.[1]??null});await route.abort().catch(()=>{});});
            });
            const page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',()=>errors.push({kind:'pageerror'}));page.on('dialog',dialog=>dialog.accept());return page;
          };
          const owner=await newPage(true),manager=await newPage(false);
          const nav=()=>manager.getByRole('navigation',{name:'企业管理功能',exact:true});
          const panel=()=>manager.getByRole('region',{name:'考勤明细',exact:true});
          const scopePanel=()=>owner.getByRole('region',{name:'主管考勤范围',exact:true});
          const response=(page,endpoint,method,status=200)=>{const promise=page.waitForResponse(r=>new URL(r.url()).pathname===endpoint&&r.request().method()===method).then(r=>{assert.equal(r.status(),status);return r.json();});void promise.catch(()=>{});return promise;};
          const countRecords=()=>requests.filter(row=>row.path===recordsPath).length;
          const role=()=>data.facts().roles.find(row=>row.id===data.roleId);
          const setPermission=async enabled=>{
            await owner.getByRole('button',{name:'角色权限',exact:true}).click();
            const toggle=owner.locator(`button[aria-controls="role-editor-${data.roleId}-body"]`);if(await toggle.getAttribute('aria-expanded')!=='true')await toggle.click();
            const editor=owner.locator(`[id="role-editor-${data.roleId}-body"]`);
            await editor.getByRole('navigation',{name:'权限主要板块',exact:true}).getByRole('button',{name:/^员工考勤，/}).click();
            await editor.locator(`[id="role-${data.roleId}-attendance.records.view"]`).setChecked(enabled);
            const before=role(),saved=response(owner,rolePath,'PATCH'),refreshed=response(owner,overviewPath,'GET');
            await editor.getByRole('button',{name:'保存角色',exact:true}).click();await saved;await refreshed;await owner.getByText('角色已保存。',{exact:true}).waitFor();
            assert.equal(role().version,before.version+1);assert.deepEqual(sorted(role().permissions),sorted(enabled?on:off));safe();
          };
          const focus=async enabled=>{
            const caps=response(manager,'/api/merchant-business/capabilities','GET',403),done=response(manager,overviewPath,'GET');
            await manager.evaluate(()=>window.dispatchEvent(new Event('focus')));assert.equal((await caps).error,'staff_business_access_disabled');
            const current=await done;assert.equal(current.actor.id,data.managerEmployee);assert.deepEqual(sorted(current.actor.permissions),sorted(enabled?on:off));await nav().waitFor();
          };
          const enter=async()=>{
            const count=countRecords();await nav().getByRole('button',{name:'考勤明细',exact:true}).click();await panel().getByRole('button',{name:'查询明细',exact:true}).waitFor();
            assert.equal(countRecords(),count);await panel().getByLabel('开始日期',{exact:true}).fill(data.date);await panel().getByLabel('结束日期（含当天）',{exact:true}).fill(data.date);
          };
          const query=async(status=200)=>{const done=response(manager,recordsPath,'GET',status);await panel().getByRole('button',{name:'查询明细',exact:true}).click();return done;};
          const verifyRows=async(result,ids)=>{
            assert.equal(result.ok,true);assert.equal(result.access,'manager');assert.equal(result.siteId,site);assert.deepEqual(result.items.map(row=>row.id),ids);
            await panel().getByRole('status').filter({hasText:ids.length?`本页 ${ids.length} 条原始打卡事实`:'当前条件及授权范围内没有记录。'}).waitFor();
            assert.equal(await panel().locator('article').count(),ids.length);
            const text=await panel().textContent();for(const id of ids)assert(text.includes(id));for(const id of data.forbiddenIds)assert(!text.includes(id));safe();
          };
          const openScope=async()=>{
            await owner.getByRole('button',{name:'主管考勤范围',exact:true}).click();
            const ready=response(owner,scopesPath,'GET');await scopePanel().getByRole('button',{name:new RegExp(data.labels.manager)}).click();
            const result=await ready;await scopePanel().getByRole('button',{name:'新增授权',exact:true}).waitFor();return result;
          };
          const putGrant=async()=>{
            await scopePanel().getByRole('button',{name:'新增授权',exact:true}).click();
            await scopePanel().getByRole('button',{name:new RegExp(data.labels.workerNos[0])}).click();
            await scopePanel().getByRole('button',{name:'地点 0 / 50',exact:true}).click();
            await scopePanel().getByRole('button',{name:new RegExp(data.labels.locationNames[0])}).click();
            const done=response(owner,scopesPath,'POST');await scopePanel().getByRole('button',{name:'保存此条授权',exact:true}).click();const result=await done;
            await scopePanel().getByRole('status').filter({hasText:'操作已确认'}).waitFor();safe();return result;
          };
          const directRead=async()=>{
            const token=await auth.login(data.manager),url=new URL(canonical+recordsPath);
            for(const [key,value] of Object.entries({siteId:site,access:'manager',fromAt:data.date+'T00:00:00.000Z',toAt:new Date(Date.parse(data.date+'T00:00:00.000Z')+86400000).toISOString()}))url.searchParams.set(key,value);
            const r=await handleAttendanceRecords(new Request(url,{headers:{'x-merchant-access-token':token}}),{enabled:()=>true,entitlement});return {status:r.status,body:await r.json()};
          };
          phase='initial-login';await owner.goto(origin+'/'+site);await owner.getByRole('button',{name:'企业管理',exact:true}).click();
          await manager.goto(origin+'/enterprise');await manager.getByLabel('员工邮箱',{exact:true}).fill(data.manager.email);await manager.getByLabel('密码',{exact:true}).fill('Synthetic-attendance-only!');
          await manager.getByRole('button',{name:'登录并选择企业',exact:true}).click();await manager.locator('article').filter({hasText:'企业编号 '+site}).getByRole('button',{name:'进入工作台',exact:true}).click();await nav().waitFor();
          assert.equal(await nav().getByRole('button',{name:'考勤明细',exact:true}).count(),0);assert.equal((await directRead()).status,403);assert.deepEqual(data.facts(),initial);safe();
          native.pass('actual supervisor SDK shell has no records entry without records.view; direct authenticated default record read is denied and no scope or fact is created');
          phase='grant-role-without-scope';await setPermission(true);await focus(true);await enter();const absent=await query(403);assert.equal(absent.error,'attendance_access_denied');
          assert.equal(await panel().locator('article').count(),0);const emptyScope=await openScope();assert.equal(emptyScope.scope.revision,0);assert.deepEqual(emptyScope.scope.grants,[]);assert.equal(data.facts().scopes.length,0);
          native.pass('real role editor grants records.view but no scope row still means403; owner scope GET reports revision0 without creating a scope or exposing company history');
          phase='grant-one-pair';const firstGrant=await putGrant();assert.equal(firstGrant.scope.revision,1);await verifyRows(await query(),data.allowedIds);
          native.pass('owner actual scope form grants one worker AND one location; explicit manager query shows only that pair, excluding the other three synthetic combinations');
          phase='held-records-role-revoked';
          const gate={ready:deferred(),release:deferred(),finished:deferred()};gates.add(gate);heldNext=gate;
          await panel().getByRole('button',{name:'查询明细',exact:true}).click();const late=await bounded(gate.ready.promise,'held_records_not_ready');assert.deepEqual(late.items.map(row=>row.id),data.allowedIds);
          await setPermission(false);await focus(false);await panel().waitFor({state:'detached'});assert.equal(await nav().getByRole('button',{name:'考勤明细',exact:true}).count(),0);
          assert.equal((await directRead()).status,403);gate.release.resolve();await bounded(gate.finished.promise,'held_records_release_failed');
          await manager.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));assert.equal(await panel().count(),0);
          for(const id of data.allowedIds)assert(!(await manager.locator('body').textContent()).includes(id));safe();
          native.pass('after real role revocation and current overview refresh unload the private page, an already-authorized SQL200 released late cannot restore records; current direct read remains403');
          phase='restore-role';await setPermission(true);await focus(true);await enter();assert.equal(await panel().locator('article').count(),0);await verifyRows(await query(),data.allowedIds);
          native.pass('restoring records.view restores navigation but does not auto-query or widen the retained scope; explicit query returns only the original authorized pair');
          phase='scope-revoke-restore';await openScope();await scopePanel().getByRole('button',{name:'撤销此条',exact:true}).click();const revoked=response(owner,scopesPath,'POST');await scopePanel().getByRole('button',{name:'确认撤销',exact:true}).click();
          const removed=await revoked;assert.equal(removed.scope.revision,2);assert.deepEqual(removed.scope.grants,[]);await scopePanel().getByRole('status').filter({hasText:'操作已确认'}).waitFor();
          const empty=await query();assert.equal(empty.scopeRevision,2);await verifyRows(empty,[]);assert.equal(data.facts().scopes.length,1);
          const restored=await putGrant();assert.equal(restored.scope.revision,3);assert.notEqual(restored.scope.grants[0].id,firstGrant.scope.grants[0].id);await verifyRows(await query(),data.allowedIds);
          native.pass('actual scope revoke leaves revision2 with empty grants and a200 empty manager result; new explicit grant uses a new ID and restores only the same pair at revision3');
          phase='final-proof';assertSupervisorAccessAudit({before:initial,after:data.facts(),site,ownerId:data.owner.id,roleId:data.roleId,employeeId:data.managerEmployee,workerId:data.workers[0],locationId:data.locations[0]});safe();
          for(const page of [owner,manager])assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
          assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert.deepEqual(data.errors,[]);assert.deepEqual(shell.errors,[]);
          assert.equal(requests.filter(row=>row.path===rolePath&&row.method==='PATCH').length,3);assert.equal(requests.filter(row=>row.path===scopesPath&&row.method==='POST').length,3);
          console.log(JSON.stringify({supervisorAccessBrowser:true,roleChanges:3,roleAudits:3,scopeOperations:3,newPunches:0,sourceEventsUnchanged:4,
            actualRoleAndScopeForms:true,actualSupervisorRecords:true,heldSql200Discarded:true,defaultHandlersAndExecutors:true,
            syntheticAuthAndBootstrap:true,syntheticActiveMembershipEntry:true,realAuthService:false,realNextServer:false,realPhone:false,productionAccess:false,externalRequests:0}));
        }finally{
          closing=true;for(const gate of gates)gate.release.resolve();
          await runAttendanceCleanupSteps([{name:'auth-owned-browser',run:()=>browser?.close()},{name:'auth-owned-routes',run:()=>Promise.allSettled([...pendingRoutes])}]);
        }
      },undefined,data.read);
    }catch(error){
      const sourceLine=String(error?.stack??'').match(/supervisor-access-browser-check\.mjs:(\d+):/)?.[1]??null;
      console.error(JSON.stringify({supervisorAccessBrowserFailed:true,phase,sourceLine,errors,requests}));throw Error('supervisor_access_browser_failed');
    }finally{
      closing=true;for(const gate of gates)gate.release.resolve();
      try{await runAttendanceCleanupSteps([{name:'browser',run:()=>browser?.close()},{name:'routes',run:()=>Promise.allSettled([...pendingRoutes])},
        {name:'harness',timeoutMs:10000,run:async()=>{if(child.pid!==undefined&&child.exitCode===null&&child.signalCode===null){const stopped=once(child,'exit');child.kill();await stopped;}}}]);}
      finally{if(savedMode===undefined)delete process.env.FAOLLA_PLATFORM_SNAPSHOT_WRITE_MODE;else process.env.FAOLLA_PLATFORM_SNAPSHOT_WRITE_MODE=savedMode;}
    }
  });
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  await runAttendanceLabelsReuse(process.argv.slice(2),checkAttendanceSupervisorAccessBrowser).catch(()=>{console.error('supervisor_access_local_check_failed');process.exitCode=1;});
}
