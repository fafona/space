// Opt-in LOCAL SYNTHETIC acceptance. Real employee-management UI -> handlers ->
// store -> audited SQL, and real employee attendance UI/handler/SQL. Auth, outer
// merchant bootstrap, platform entitlement and HTTP routing are explicit fixtures.
// This also verifies the business-rollout-off fallback without enabling it.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import {createRequire} from 'node:module';
import {randomBytes} from 'node:crypto';
import {chromium} from 'playwright';
import {runAttendanceLabelsReuse} from './merchant-attendance-choice-labels-reuse-native.mjs';
import {withAttendanceConcurrencySandbox} from './merchant-attendance-concurrency-sandbox.mjs';
import {prepareAttendanceEmployeeManagement} from './merchant-attendance-employee-management-fixture.mjs';
import {runAttendanceCleanupSteps} from './fixtures/attendance-cleanup.mjs';
const require=createRequire(import.meta.url);
const {withAttendanceApplicationAuth}=require('./fixtures/attendance-application-auth.ts');
const {createAttendanceDatabaseTransport,databaseId:id,databaseActors:actors}=require('./fixtures/attendance-database-transport.ts');
const {createAttendanceEmployeeManagementReadTransport}=require('./fixtures/attendance-employee-management-read-transport.ts');
const {serveAttendanceMerchantBootstrap}=require('./fixtures/attendance-merchant-shell-transport.ts');
const {resolveValidatedMerchantEnterpriseAuthContext,requireMerchantEnterpriseEntitlement}=require('../src/lib/merchantEnterpriseAuth.server.ts');
const {resolveMerchantBusinessActor}=require('../src/lib/merchantBusinessActor.server.ts');
const {handleMerchantBusinessCapabilitiesGet}=require('../src/app/api/merchant-business/capabilities/route-handler.ts');
const {GET:overview}=require('../src/app/api/merchant-enterprise/overview/route-handler.ts');
const {PATCH:employeePatch}=require('../src/app/api/merchant-enterprise/employees/route-handler.ts');
const locationMode=process.argv.includes('--location');
const pinMode=process.argv.includes('--pin');
const onsiteMode=process.argv.includes('--onsite');
const delegatedMode=process.argv.includes('--delegated');
const tabMode=process.argv.includes('--tabs');
const accountMode=process.argv.includes('--accounts')||tabMode;
assert(!tabMode||!process.argv.includes('--accounts'),'account_switch_conflicting_tab_mode');
const pinInfrastructure=pinMode?await import('./merchant-attendance-pin-management-fixture.mjs'):null;
const onsiteInfrastructure=onsiteMode?await import('./merchant-attendance-onsite-management-fixture.mjs'):null;
const delegatedInfrastructure=delegatedMode?await import('./merchant-attendance-delegated-management-fixture.mjs'):null;
const delegatedPlan=delegatedMode?delegatedInfrastructure.delegatedManagementPlan():null;
const accountInfrastructure=accountMode?await import('./merchant-attendance-account-switch-fixture.mjs'):null;
const diagnostic=value=>pinMode?(pinInfrastructure.redactPinManagementDiagnostics?.(value)??'pin_management_redacted_diagnostic')
  :onsiteMode?(onsiteInfrastructure.redactOnsiteManagementDiagnostics?.(value)??'onsite_management_redacted_diagnostic')
  :delegatedMode?(delegatedInfrastructure.redactDelegatedManagementDiagnostics?.(value)??'delegated_management_redacted_diagnostic')
  :accountMode?(accountInfrastructure.redactAccountSwitchDiagnostics?.(value)??'account_switch_redacted_diagnostic'):value;
assert([pinMode,locationMode,onsiteMode,delegatedMode,accountMode].filter(Boolean).length<=1,'employee_management_conflicting_channel_modes');
assert(!accountMode||!process.argv.includes('--roles'),'account_switch_conflicting_role_mode');
const roleMode=process.argv.includes('--roles')||locationMode||pinMode||onsiteMode||delegatedMode;
const rolePatch=roleMode?require('../src/app/api/merchant-enterprise/roles/route-handler.ts').PATCH:null;
const locationClock=locationMode?require('../src/app/api/merchant-enterprise/attendance/location-clock/route-handler.ts').handleAttendanceLocationClock:null;
const selfContext=locationMode?require('../src/app/api/merchant-enterprise/attendance/self-context/route-handler.ts').handleAttendanceSelfContext:null;
const pinHandlers=pinMode?{
  'admin':require('../src/app/api/merchant-enterprise/attendance/admin/route-handler.ts').handleAttendanceAdmin,
  'terminals':require('../src/app/api/merchant-enterprise/attendance/terminals/route-handler.ts').handleTerminalAdmin,
  'terminal-device':require('../src/app/api/merchant-enterprise/attendance/terminal-device/route-handler.ts').handleTerminalDevice,
  'pin-credentials':require('../src/app/api/merchant-enterprise/attendance/pin-credentials/route-handler.ts').handlePinAdmin,
  'terminal-clock':require('../src/app/api/merchant-enterprise/attendance/terminal-clock/route-handler.ts').handlePinClock,
}:{};
const onsiteHandlers=onsiteMode?{
  'admin':require('../src/app/api/merchant-enterprise/attendance/admin/route-handler.ts').handleAttendanceAdmin,
  'terminals':require('../src/app/api/merchant-enterprise/attendance/terminals/route-handler.ts').handleTerminalAdmin,
  'terminal-device':require('../src/app/api/merchant-enterprise/attendance/terminal-device/route-handler.ts').handleTerminalDevice,
  'onsite-code':require('../src/app/api/merchant-enterprise/attendance/onsite-code/route-handler.ts').handleOnsiteCode,
  'onsite-clock':require('../src/app/api/merchant-enterprise/attendance/onsite-clock/route-handler.ts').handleOnsiteClock,
}:{};
const terminalCookie=pinMode||onsiteMode?require('../src/lib/merchantAttendanceTerminal.ts').TERMINAL_COOKIE:null;
const delegatedHandlers=delegatedMode?{
  'admin':require('../src/app/api/merchant-enterprise/attendance/admin/route-handler.ts').handleAttendanceAdmin,
  'records':require('../src/app/api/merchant-enterprise/attendance/records/route-handler.ts').handleAttendanceRecords,
  'scopes':require('../src/app/api/merchant-enterprise/attendance/scopes/route-handler.ts').handleAttendanceScopes,
}:{};
const {handleAttendanceSelf}=require('../src/app/api/merchant-enterprise/attendance/self/route-handler.ts');
const accountHandlers=accountMode?{
  '/api/merchant-enterprise/attendance/self':handleAttendanceSelf,
  '/api/merchant-enterprise/attendance/history':require('../src/app/api/merchant-enterprise/attendance/history/route-handler.ts').handleAttendanceHistory,
  '/api/merchant-enterprise/attendance/session':require('../src/app/api/merchant-enterprise/attendance/session/route-handler.ts').handleAttendanceSession,
}:{};
const {MERCHANT_AUTH_COOKIE}=require('../src/lib/merchantAuthSession.ts');
const origin='https://127.0.0.1:3131',staticOrigin='http://127.0.0.1:3131',canonical='https://www.faolla.com';
const localFetch=globalThis.fetch,site='99990001',employeeId=id(101),workerId=id(201),placeId=id(301);
const pendingKey=`faolla:attendance:self:v1:${site}:${employeeId}`;
const literal=value=>"'"+String(value).replaceAll("'","''")+"'";
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
const bounded=async(promise,label,ms=20000)=>{let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(label)),ms);})]);}finally{clearTimeout(timer);}};

async function check(native){
  await withAttendanceConcurrencySandbox(native,async(scope)=>{
    const exec=source=>native.query(scope.sql(source));
    exec(readFileSync(path.join(native.root,'scripts/supabase-migrations/202610020111_merchant_attendance_self_clock_identity.sql'),'utf8'));
    exec(`begin;
      insert into public.merchants(id,user_id) values('${site}','${actors[0].id}');
      insert into public.merchant_enterprise_roles(id,merchant_id,name,system_key,permissions) values
        ('${id(30)}','${site}','合成员工角色','employee',array['enterprise.view','attendance.self.view','attendance.self.clock']),
        ('${id(31)}','${site}','合成主管角色','supervisor',array['enterprise.view']),
        ('${id(32)}','${site}','合成管理角色','administrator',array['enterprise.view']);
      insert into public.merchant_enterprise_employees(id,merchant_id,auth_user_id,email,display_name,role_id,status,accepted_at) values
        ('${employeeId}','${site}','${actors[1].id}','${actors[1].email}','合成员工甲','${id(30)}','active',now());
      insert into public.merchant_attendance_settings(merchant_id,time_zone,enabled,web_clock_enabled) values('${site}','Europe/Madrid',true,true);
      insert into public.merchant_attendance_locations(id,merchant_id,name,time_zone,active) values('${placeId}','${site}','合成地点','Europe/Madrid',true);
      insert into public.merchant_attendance_workers(id,merchant_id,employee_id,worker_no,display_name,default_location_id,active)
        values('${workerId}','${site}','${employeeId}','SYNTHETIC-103','合成员工甲','${placeId}',true);
      insert into public.merchant_attendance_employment_periods(merchant_id,worker_id,starts_on) values('${site}','${workerId}','2000-01-01');commit;`);
    if(delegatedMode)exec(`begin;${delegatedPlan.identitiesSql}commit;`);
    const accountPrepared=accountMode?await accountInfrastructure.prepareAttendanceAccountSwitch(native,scope):null;
    const prepared=await prepareAttendanceEmployeeManagement(native,scope);
    if(delegatedMode)exec(`begin;${delegatedPlan.workspaceSql}commit;`);
    const rolePrepared=roleMode?await (await import('./merchant-attendance-role-management-fixture.mjs')).prepareAttendanceRoleManagement(native,scope):null;
    const delegatedPrepared=delegatedMode?delegatedInfrastructure.createAttendanceDelegatedManagementTransport(exec):null;
    const delegatedAttendance=delegatedMode?require('./fixtures/attendance-audit-shell-transport.ts').createAttendanceAuditShellTransport(exec):null;
    const delegatedRecords=delegatedMode?require('./fixtures/attendance-event-channels-shell-transport.ts').createEventChannelsShellTransport(exec,actors):null;
    const accountReads=accountMode?require('./fixtures/attendance-event-channels-shell-transport.ts').createEventChannelsShellTransport(exec,actors):null;
    const locationPrepared=locationMode?await (await import('./merchant-attendance-location-management-fixture.mjs')).prepareAttendanceLocationManagement(native,scope,
      {site,ownerId:actors[0].id,employeeAuthId:actors[1].id,workerId,placeId}):null;
    const pinFixture=pinInfrastructure;
    const pinPrepared=pinMode?await pinFixture.prepareAttendancePinManagement(native,scope,
      {site,ownerId:actors[0].id,employeeAuthId:actors[1].id,workerId,placeId}):null;
    const onsitePrepared=onsiteMode?await onsiteInfrastructure.prepareAttendanceOnsiteManagement(native,scope,
      {site,ownerId:actors[0].id,employeeAuthId:actors[1].id,workerId,placeId}):null;
    // Pre-existing synthetic workspace, not a fabricated needsBootstrap reply.
    // No tasks or assignments are seeded; this scenario is lifecycle-only.
    if(!delegatedMode)exec(`begin;insert into public.merchant_task_boards(id,merchant_id,name,system_key) values('${id(401)}','${site}','合成默认看板','default');
      insert into public.merchant_task_columns(id,merchant_id,board_id,name,system_key,position,is_done) values
      ${['todo','in_progress','blocked','done'].map((key,n)=>`('${id(410+n)}','${site}','${id(401)}','合成工作列${n}','${key}',${n},${key==='done'})`).join(',')};commit;`);
    const transport=createAttendanceDatabaseTransport(exec);
    const reads=createAttendanceEmployeeManagementReadTransport(exec,{syntheticAuthUserIds:actors.map(a=>a.id)});
    const employee=()=>JSON.parse(exec(`select to_jsonb(e) from public.merchant_enterprise_employees e where id='${employeeId}';`));
    const rows=table=>JSON.parse(exec(`select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb) from public.${table} t;`));
    const events=()=>rows('merchant_attendance_events');
    const audits=()=>rows('merchant_enterprise_audit_events');
    const immutable=()=>exec(`select jsonb_build_object('worker',(select to_jsonb(w) from public.merchant_attendance_workers w where id='${workerId}'),
      'settings',(select to_jsonb(s) from public.merchant_attendance_settings s where merchant_id='${site}'),
      'role',(select to_jsonb(r) from public.merchant_enterprise_roles r where id='${id(30)}'));`);
    const original=employee(),untouched=immutable(),rpcCalls=[],roleRpcCalls=[];
    let delegateGate=null;
    const accountTokens=new Map();
    const employeeContexts=new Set(),pageIds=new Map();
    const rpc=async(name,args)=>{
      if(delegatedPrepared&&delegatedPrepared.rpcNames.includes(name)){
        if(delegateGate&&name===rolePrepared.rpc.name&&args.p_input?.actor_type==='employee'&&args.p_input?.actor_id===id(102)&&args.p_input?.role_id===id(30)){
          const current=delegateGate;delegateGate=null;current.ready.resolve();await current.release.promise;
          try{return await delegatedPrepared.rpc(name,args);}finally{current.finished.resolve();held.delete(current);}
        }
        return delegatedPrepared.rpc(name,args);
      }
      if(delegatedAttendance&&name==='faolla_attendance_scopes_v1')return delegatedAttendance.rpc(name,args);
      if(delegatedRecords&&name==='faolla_attendance_records_v1')return delegatedRecords.rpc(name,args);
      if(accountReads&&['faolla_attendance_self_history_v1','faolla_attendance_self_session_v1'].includes(name))return accountReads.rpc(name,args);
      if(locationPrepared&&['faolla_attendance_location_clock_v2','faolla_attendance_self_context_v1'].includes(name))return locationPrepared.rpc(name,args);
      if(pinPrepared&&pinPrepared.rpcNames.includes(name))return pinPrepared.rpc(name,args);
      if(onsitePrepared&&onsitePrepared.rpcNames.includes(name))return onsitePrepared.rpc(name,args);
      if(rolePrepared&&name===rolePrepared.rpc.name){
        assert.deepEqual(Object.keys(args),['p_input']);const input=args.p_input;
        assert.deepEqual(Object.keys(input).sort(),['actor_id','actor_type','role_id','expected_version','merchant_id','name','description','permissions','access_scope','allowed_board_ids'].sort());
        assert.equal(input.merchant_id,site);assert.equal(input.role_id,id(30));assert.equal(input.actor_type,'owner');assert.equal(input.actor_id,actors[0].id);
        assert.equal(input.name,'合成员工角色');assert.equal(input.description,'');assert.equal(input.access_scope,'all');assert.deepEqual(input.allowed_board_ids,[]);
        assert(Number.isSafeInteger(input.expected_version)&&input.expected_version>0);
        assert(Array.isArray(input.permissions)&&input.permissions.includes('enterprise.view'));
        assert(input.permissions.every(p=>['enterprise.view','attendance.self.view','attendance.self.clock'].includes(p)));
        roleRpcCalls.push(structuredClone(input));
        try{const result=JSON.parse(exec(`begin;set local role service_role;select jsonb_build_object('role',current_user,'data',public.${rolePrepared.rpc.name}(${literal(JSON.stringify(input))}::jsonb));commit;`));
          assert.equal(result.role,'service_role');return {data:result.data,error:null};
        }catch(error){const code=String(error).match(/ERROR:\s+([a-z_]+)/)?.[1];if(!code)throw error;return {data:null,error:{message:code}};}
      }
      if(name!==prepared.rpc.name)return transport.rpc(name,args);
      assert.deepEqual(Object.keys(args),['p_input']);const input=args.p_input;
      assert.deepEqual(Object.keys(input).sort(),['actor_id','actor_type','employee_id','expected_version','merchant_id','status',...(input.offboarding_mode?['offboarding_mode']:[])].sort());
      assert.equal(input.merchant_id,site);assert.equal(input.employee_id,employeeId);assert.equal(input.actor_type,'owner');assert.equal(input.actor_id,actors[0].id);
      assert(['active','disabled'].includes(input.status));assert(Number.isSafeInteger(input.expected_version)&&input.expected_version>0);
      if(input.offboarding_mode)assert.equal(input.offboarding_mode,'unassign');rpcCalls.push(structuredClone(input));
      try{const result=JSON.parse(exec(`begin;set local role service_role;select jsonb_build_object('role',current_user,'data',public.${prepared.rpc.name}(${literal(JSON.stringify(input))}::jsonb));commit;`));
        assert.equal(result.role,'service_role');return {data:result.data,error:null};
      }catch(error){const code=String(error).match(/ERROR:\s+([a-z_]+)/)?.[1];if(!code)throw error;return {data:null,error:{message:code}};}
    };
    const probe=net.createServer();await new Promise((resolve,reject)=>{probe.once('error',reject);probe.listen(3131,'127.0.0.1',resolve);});await new Promise(resolve=>probe.close(resolve));
    const child=spawn(process.execPath,['scripts/attendance-self-browser-harness.mjs','--merchant-shell',locationMode?'--employee-location':pinMode?'--pin-shell':onsiteMode?'--terminal-shell':'--database-entry'],{cwd:native.root,windowsHide:true,stdio:['ignore','pipe','pipe']});
    let browser,closing=false,lose=false,accountLose=null,hold=null;const errors=[],external=[],requests=[],pendingRoutes=new Set(),held=new Set();
    const snapshotFlag='FAOLLA_PLATFORM_SNAPSHOT_WRITE_MODE',savedSnapshotMode=process.env[snapshotFlag];
    const pepperKey='FAOLLA_ATTENDANCE_PIN_PEPPER',savedPepper=process.env[pepperKey];
    const onsiteSecretKey='FAOLLA_ATTENDANCE_ONSITE_QR_SECRET',savedOnsiteSecret=process.env[onsiteSecretKey];
    child.stderr.on('data',value=>errors.push(String(value)));
    try{
      process.env[snapshotFlag]='off';
      if(pinMode)process.env[pepperKey]=randomBytes(32).toString('base64url');
      if(onsiteMode)process.env[onsiteSecretKey]=randomBytes(32).toString('hex');
      await bounded(new Promise((resolve,reject)=>{let output='';child.stdout.on('data',value=>{output+=String(value);if(output.includes('Attendance synthetic component QA'))resolve();});child.once('error',reject);child.once('exit',code=>reject(Error('employee_management_harness_exit_'+code)));}),'employee_management_harness_timeout');
      browser=await chromium.launch({headless:true});
      await withAttendanceApplicationAuth(actors,rpc,async auth=>{
        try{
          const entitlement=id=>requireMerchantEnterpriseEntitlement(id,async()=>[{id:site,permissionConfig:{allowEnterpriseManagement:true,allowEmployeeAttendance:true}}]);
          const capabilities=request=>handleMerchantBusinessCapabilitiesGet(request,{
            resolveActor:(request,input)=>resolveMerchantBusinessActor(request,input,{rolloutConfig:{mode:'off',siteIds:[],valid:true},
              loadSite:async()=>({id:site,permissionConfig:{allowEnterpriseManagement:true,allowEmployeeAttendance:true}})}),
          });
          const newPage=async(owner,device=false,sharedContext=null)=>{
            if(sharedContext){
              assert(tabMode&&!owner&&!device&&employeeContexts.has(sharedContext),'cross_tab_owned_context_required');
              const page=await sharedContext.newPage();pageIds.set(page,'employee-'+pageIds.size);
              page.setDefaultTimeout(12000);page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());return page;
            }
            assert(!device||(pinMode||onsiteMode)&&!owner,'employee_management_device_mode_required');
            const context=await browser.newContext({viewport:owner?{width:1280,height:960}:{width:390,height:844},isMobile:!owner,hasTouch:!owner,serviceWorkers:'block'});
            if(tabMode&&!owner&&!device)employeeContexts.add(context);
            if(!device)await context.addInitScript(()=>localStorage.setItem('merchant-space:locale:v1','zh-CN'));
            if(locationMode&&!owner)await context.addInitScript(()=>{
              // This lifecycle test deliberately uses explicit no-position input.
              // Any accidental GPS call is observable and fails the acceptance.
              const counts={get:0,watch:0};Object.defineProperty(window,'__attendanceLifecycleGps',{value:counts});
              Object.defineProperty(navigator,'geolocation',{configurable:true,value:{
                getCurrentPosition(){counts.get++;throw Error('location_management_unexpected_gps');},
                watchPosition(){counts.watch++;throw Error('location_management_unexpected_gps');},clearWatch(){},
              }});
            });
            if(owner)await context.addCookies([{name:MERCHANT_AUTH_COOKIE,value:await auth.login(actors[0]),url:origin,secure:true,httpOnly:true,sameSite:'Lax'}]);
            await context.route('**/*',route=>{
              if(closing)return route.abort().catch(()=>{});
              const work=(async()=>{
                const r=route.request(),url=new URL(r.url());
                if(url.origin!==origin){external.push(url.origin+url.pathname);return route.abort();}
                if(device)assert(['/enterprise/attendance-terminal',...(pinMode?['/enterprise/attendance-terminal/clock','/api/merchant-enterprise/attendance/terminal-clock']:['/enterprise/attendance-terminal/onsite','/api/merchant-enterprise/attendance/onsite-code']),'/api/merchant-enterprise/attendance/terminal-device','/harness.js','/harness.css'].includes(url.pathname),'employee_management_device_route_forbidden');
                if(onsiteMode)assert(!url.search.includes('aq1.')&&!url.searchParams.has('token'),'employee_management_qr_in_http_url');
                if(url.pathname.startsWith('/auth/v1/')&&!owner&&!device){const response=await fetch(new Request('https://attendance-auth.invalid'+url.pathname+url.search,{method:r.method(),headers:await r.allHeaders(),body:r.postData()??undefined}));return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:await response.text()});}
                if(['/auth/v1/settings','/rest/v1/'].includes(url.pathname)){assert.equal(r.method(),'GET');return route.fulfill({status:200,contentType:'application/json',body:'{}'});}
                if(url.pathname==='/downloads/faolla-android-version.json'){assert.equal(r.method(),'GET');return route.fulfill({status:404,contentType:'application/json',body:'{}'});}
                if(!url.pathname.startsWith('/api/')){
                  assert.equal(r.method(),'GET');assert(['/99990001','/enterprise','/enterprise/99990001','/harness.js','/harness.css',...(pinMode?['/enterprise/attendance-terminal','/enterprise/attendance-terminal/clock']:[]),...(onsiteMode?['/enterprise/attendance-terminal','/enterprise/attendance-terminal/onsite','/enterprise/attendance-scan']:[])].includes(url.pathname),'employee_management_unexpected_static');
                  const response=await localFetch(staticOrigin+url.pathname);return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});
                }
                const headers=new Headers(await r.allHeaders());
                if(device){assert.equal(headers.get('x-merchant-access-token'),null);assert.equal(headers.get('authorization'),null);
                  const cookie=headers.get('cookie');assert(cookie===null||cookie.split(';').every(value=>value.trim().startsWith(terminalCookie+'=')),'employee_management_device_account_cookie');}
                else if(owner){assert.equal(headers.get('x-merchant-access-token'),null);assert(headers.get('cookie')?.includes(MERCHANT_AUTH_COOKIE+'='));}
                else{assert(headers.get('x-merchant-access-token'));assert.equal(headers.get('cookie'),null);}
                if(headers.get('origin')===origin)headers.set('origin',canonical);
                if(headers.get('referer')?.startsWith(origin+'/'))headers.set('referer',canonical+headers.get('referer').slice(origin.length));headers.set('host','www.faolla.com');
                const request=new Request(canonical+url.pathname+url.search,{method:r.method(),headers,body:r.postData()??undefined});
                let accountActor=null;
                if(accountMode&&!owner){
                  const token=headers.get('x-merchant-access-token');assert(token);
                  for(const [actor,tokens] of accountTokens)if(tokens.includes(token))accountActor=actor;
                }
                let response;
                if(url.pathname==='/api/merchant-enterprise/overview'){assert.equal(r.method(),'GET');response=await overview(request);}
                else if(url.pathname==='/api/merchant-enterprise/employees'){assert.equal(r.method(),'PATCH');response=await employeePatch(request);}
                else if(roleMode&&url.pathname==='/api/merchant-enterprise/roles'){assert.equal(r.method(),'PATCH');response=await rolePatch(request);}
                else if(url.pathname==='/api/merchant-enterprise/attendance/self')response=await handleAttendanceSelf(request,{entitlement});
                else if(accountMode&&accountHandlers[url.pathname])response=await accountHandlers[url.pathname](request,{entitlement});
                else if(locationMode&&url.pathname==='/api/merchant-enterprise/attendance/location-clock')response=await locationClock(request,{entitlement,enabled:()=>true});
                else if(locationMode&&url.pathname==='/api/merchant-enterprise/attendance/self-context')response=await selfContext(request,{entitlement,enabled:()=>true});
                else if(pinMode&&url.pathname.startsWith('/api/merchant-enterprise/attendance/')){
                  const handler=pinHandlers[url.pathname.slice('/api/merchant-enterprise/attendance/'.length)];assert.equal(typeof handler,'function','employee_management_pin_handler_required');
                  response=await handler(request,{entitlement,enabled:()=>true});
                }
                else if(onsiteMode&&url.pathname.startsWith('/api/merchant-enterprise/attendance/')){
                  const handler=onsiteHandlers[url.pathname.slice('/api/merchant-enterprise/attendance/'.length)];assert.equal(typeof handler,'function','employee_management_onsite_handler_required');
                  response=await handler(request,{entitlement,enabled:()=>true});
                }
                else if(delegatedMode&&url.pathname.startsWith('/api/merchant-enterprise/attendance/')){
                  const handler=delegatedHandlers[url.pathname.slice('/api/merchant-enterprise/attendance/'.length)];assert.equal(typeof handler,'function','employee_management_delegated_handler_required');
                  response=await handler(request,{entitlement,enabled:()=>true});
                }
                else if(url.pathname==='/api/merchant-business/capabilities'){assert.equal(r.method(),'GET');response=await capabilities(request);}
                else if(['/api/merchant-enterprise/current-operations','/api/merchant-enterprise/todos',...(roleMode?['/api/merchant-enterprise/workflow-permission-gaps']:[])].includes(url.pathname)){
                  assert.equal(r.method(),'GET');await resolveValidatedMerchantEnterpriseAuthContext(request);
                  response=Response.json({ok:false,error:'synthetic_unrelated_read_out_of_scope'},{status:503});
                }
                else{const identity=await resolveValidatedMerchantEnterpriseAuthContext(request);response=(owner?serveAttendanceMerchantBootstrap(request,identity.user.id):null)??await transport.serveShell(request,identity.user.id);}
                const body=await response.text(),rawBody=r.postData()?JSON.parse(r.postData()):null;
                if(accountMode&&!owner&&url.pathname==='/api/merchant-enterprise/overview'&&response.status===200){
                  // Capture only the SDK token on an actual authorized overview
                  // reply. Do not add another auth precheck or alter late 401s.
                  const actor=JSON.parse(body).actor;assert.equal(actor.type,'employee');
                  const member=Object.entries(accountPrepared.consts.employees).find(([,employee])=>employee===actor.id);assert(member);
                  accountActor=accountPrepared.consts.authUsers[member[0]];
                  const token=headers.get('x-merchant-access-token'),tokens=accountTokens.get(accountActor)??[];
                  assert(token);if(!tokens.includes(token))tokens.push(token);accountTokens.set(accountActor,tokens);
                }
                const record={path:url.pathname,method:r.method(),status:response.status,query:Object.fromEntries(url.searchParams),body:pinMode?pinFixture.sanitizePinManagementBody(url.pathname,rawBody):onsiteMode?onsiteInfrastructure.sanitizeOnsiteManagementBody(url.pathname,rawBody):rawBody,...(accountMode?{actorId:accountActor}:{}),...(tabMode?{tabId:pageIds.get(r.frame().page())}:{})};requests.push(record);
                if(accountLose&&accountActor===accountLose.actorId&&record.path==='/api/merchant-enterprise/attendance/self'&&record.method==='POST'&&record.status===200){accountLose=null;record.fault='after-sql';return route.abort('connectionreset');}
                if(lose&&record.path.endsWith('/attendance/self')&&record.method==='POST'&&record.status===200){lose=false;record.fault='after-sql';return route.abort('connectionreset');}
                if(hold&&record.path===(hold.path??'/api/merchant-enterprise/attendance/self')&&record.method===(hold.method??'POST')&&record.status===200
                  &&(!hold.actorId||hold.actorId===accountActor)&&(!hold.operationId||hold.operationId===(rawBody?.operationId??url.searchParams.get('operationId')))){
                  const current=hold;hold=null;record.fault='held-after-sql';current.ready.resolve(JSON.parse(body));await current.release.promise;
                  try{await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body});}
                  catch(error){if(!r.failure())throw error;}
                  finally{current.finished.resolve();held.delete(current);}return;
                }
                return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body});
              })();pendingRoutes.add(work);void work.finally(()=>pendingRoutes.delete(work)).catch(()=>{});
              return work.catch(async error=>{errors.push(error.stack??String(error));await route.abort().catch(()=>{});});
            });
            const page=await context.newPage();if(tabMode)pageIds.set(page,owner?'owner':'employee-'+pageIds.size);page.setDefaultTimeout(12000);page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());return page;
          };
          const owner=await newPage(true),phone=pinMode||onsiteMode||delegatedMode?null:await newPage(false);
          const self=()=>phone.getByRole('region',{name:'我的考勤',exact:true});
          const response=(page,endpoint,method,status=200)=>{const pending=page.waitForResponse(r=>new URL(r.url()).pathname===endpoint&&r.request().method()===method)
            .then(r=>{assert.equal(r.status(),status,`employee_management_status:${endpoint}:${method}`);return r;});void pending.catch(()=>{});return pending;};
          const employeeEndpoint='/api/merchant-enterprise/employees',selfEndpoint='/api/merchant-enterprise/attendance/self';
          await owner.goto(origin+'/'+site);await owner.getByRole('button',{name:'企业管理',exact:true}).click();
          await owner.getByRole('button',{name:'员工账号',exact:true}).click();
          const employeeCard=()=>owner.getByText('合成员工甲',{exact:true}).locator('xpath=../../..');
          await employeeCard().getByRole('button',{name:'停用',exact:true}).waitFor();
          if(delegatedMode){
            let delegateToken=null;
            const {checkAttendanceDelegatedManagementShell}=await import('./merchant-attendance-delegated-management-shell-checks.mjs');
            const proof=await checkAttendanceDelegatedManagementShell({owner,response,requests,exec,events,audits,employee,prepared:delegatedPrepared,plan:delegatedPlan,origin,actor:actors[2],pass:native.pass,
              newDelegatePage:async()=>{const page=await newPage(false);page.on('request',request=>{
                if(new URL(request.url()).pathname==='/api/merchant-enterprise/overview'){
                  const value=request.headers()['x-merchant-access-token'];if(value)delegateToken=value;
                }
              });return page;},
              delegateRequest:async(pathname,method,body)=>{
                assert(delegateToken,'delegated_management_actual_sdk_token_required');const url=new URL(pathname,canonical);
                assert.equal(url.origin,canonical);assert(['GET','PATCH'].includes(method));
                const handlers={'/api/merchant-enterprise/roles':rolePatch,'/api/merchant-enterprise/employees':employeePatch};
                const handler=handlers[url.pathname]??delegatedHandlers[url.pathname.replace('/api/merchant-enterprise/attendance/','')];assert.equal(typeof handler,'function');
                const request=new Request(url,{method,headers:{'x-merchant-access-token':delegateToken,'content-type':'application/json',origin:canonical},...(body===undefined?{}:{body:JSON.stringify(body)})});
                return handler(request,{entitlement,enabled:()=>true});
              },
              holdDelegateRoleRpc:()=>{assert.equal(delegateGate,null);const gate={ready:deferred(),release:deferred(),finished:deferred()};delegateGate=gate;held.add(gate);
                return {ready:()=>bounded(gate.ready.promise,'delegated_management_held_rpc_timeout'),release:async()=>{gate.release.resolve();await bounded(gate.finished.promise,'delegated_management_held_rpc_release_timeout');}};},
            });
            assert.deepEqual(external,[]);assert.deepEqual(errors,[]);assert.deepEqual(reads.errors,[]);assert.deepEqual(transport.errors,[]);assert.deepEqual(delegatedPrepared.errors,[]);assert.deepEqual(delegatedAttendance.errors,[]);assert.deepEqual(delegatedRecords.errors,[]);
            delegateToken=null;console.log(JSON.stringify({actualDelegatedManagementShell:true,...proof,realAuthService:false,realPhone:false,productionAccess:false,externalRequests:0}));return;
          }
          if(onsiteMode){
            const {checkAttendanceOnsiteManagementShell}=await import('./merchant-attendance-onsite-management-shell-checks.mjs');
            const proof=await checkAttendanceOnsiteManagementShell({owner,newDevicePage:()=>newPage(false,true),newEmployeePage:()=>newPage(false),response,requests,exec,events,audits,employee,roleRpcCalls,employeeRpcCalls:rpcCalls,onsitePrepared,
              site,employeeId,workerId,placeId,roleId:id(30),origin,actor:actors[1],pass:native.pass,
              holdResponse:(method='POST')=>{assert.equal(hold,null);const gate={path:'/api/merchant-enterprise/attendance/onsite-clock',method,ready:deferred(),release:deferred(),finished:deferred()};hold=gate;held.add(gate);
                return {ready:()=>bounded(gate.ready.promise,'onsite_management_held_sql_timeout'),release:async()=>{gate.release.resolve();await bounded(gate.finished.promise,'onsite_management_held_response_timeout');}};},
            });
            assert.deepEqual(external,[]);assert.deepEqual(errors,[]);assert.deepEqual(reads.errors,[]);assert.deepEqual(transport.errors,[]);assert.deepEqual(onsitePrepared.errors,[]);
            assert.equal(proof.events,4);assert.equal(proof.onsiteReceipts,4);assert.equal(proof.managementAudits,6);
            console.log(JSON.stringify({actualOnsiteManagementShell:true,...proof,realAuthService:false,realPhone:false,productionAccess:false,externalRequests:0}));
            return;
          }
          if(pinMode){
            const {checkAttendancePinManagementShell}=await import('./merchant-attendance-pin-management-shell-checks.mjs');
            await checkAttendancePinManagementShell({owner,newDevicePage:()=>newPage(false,true),response,requests,exec,events,audits,employee,roleRpcCalls,employeeRpcCalls:rpcCalls,pinPrepared,
              site,employeeId,workerId,placeId,roleId:id(30),origin,pass:native.pass,
              holdResponse:()=>{assert.equal(hold,null);const gate={path:'/api/merchant-enterprise/attendance/terminal-clock',method:'POST',ready:deferred(),release:deferred(),finished:deferred()};hold=gate;held.add(gate);
                return {ready:()=>bounded(gate.ready.promise,'pin_management_held_sql_timeout'),release:async()=>{gate.release.resolve();await bounded(gate.finished.promise,'pin_management_held_response_timeout');}};},
            });
            assert.deepEqual(external,[]);assert.deepEqual(errors,[]);assert.deepEqual(reads.errors,[]);assert.deepEqual(transport.errors,[]);assert.deepEqual(pinPrepared.errors,[]);
            return;
          }
          await phone.goto(origin+'/enterprise');await phone.getByLabel('员工邮箱',{exact:true}).fill(actors[1].email);await phone.getByLabel('密码',{exact:true}).fill('Synthetic-attendance-only!');await phone.getByRole('button',{name:'登录并选择企业',exact:true}).click();
          await phone.locator('article').filter({hasText:`企业编号 ${site}`}).getByRole('button',{name:'进入工作台',exact:true}).click();
          await phone.getByRole('navigation',{name:'企业管理功能',exact:true}).getByRole('button',{name:'我的考勤',exact:true}).click();await self().getByRole('button',{name:'上班打卡',exact:true}).waitFor();
          if(accountMode){
            if(tabMode){
              const {checkAttendanceCrossTabShell}=await import('./merchant-attendance-cross-tab-shell-checks.mjs');
              const proof=await checkAttendanceCrossTabShell({phone,newSiblingPage:()=>newPage(false,false,phone.context()),response,requests,exec,events,audits,
                prepared:accountPrepared,origin,actors,tabId:page=>pageIds.get(page),pass:native.pass});
              assert.deepEqual(external,[]);assert.deepEqual(errors,[]);assert.deepEqual(reads.errors,[]);assert.deepEqual(transport.errors,[]);assert.deepEqual(accountReads.errors,[]);
              assert.equal(rpcCalls.length,0);assert.equal(roleRpcCalls.length,0);
              console.log(JSON.stringify({actualCrossTabIsolation:true,...proof,realAuthService:false,realNextServer:false,realPhone:false,productionAccess:false,externalRequests:0}));return;
            }
            const {checkAttendanceAccountSwitchShell}=await import('./merchant-attendance-account-switch-shell-checks.mjs');
            const proof=await checkAttendanceAccountSwitchShell({phone,response,requests,exec,events,audits,prepared:accountPrepared,origin,actors,pass:native.pass,
              holdResponse:({actorId,path:heldPath,method,operationId})=>{
                assert.equal(hold,null);assert([actors[1].id,actors[2].id].includes(actorId));
                assert(heldPath==='/api/merchant-enterprise/attendance/self'&&method==='POST'||heldPath==='/api/merchant-enterprise/attendance/history'&&method==='GET');
                const gate={actorId,path:heldPath,method,operationId,ready:deferred(),release:deferred(),finished:deferred()};hold=gate;held.add(gate);
                return {ready:()=>bounded(gate.ready.promise,'account_switch_held_response_timeout'),release:async()=>{gate.release.resolve();await bounded(gate.finished.promise,'account_switch_release_timeout');}};
              },
              loseNextSelfResponse:({actorId})=>{assert.equal(accountLose,null);assert([actors[1].id,actors[2].id].includes(actorId));accountLose={actorId};},
              accountRequest:async({actorId,path:requestPath,method,body,tokenEpoch})=>{
                assert([actors[1].id,actors[2].id].includes(actorId));const tokens=accountTokens.get(actorId);assert(tokens?.length);
                const epoch=tokenEpoch??tokens.length-1;assert(Number.isSafeInteger(epoch)&&epoch>=0&&epoch<tokens.length);
                const url=new URL(requestPath,canonical);assert.equal(url.origin,canonical);const handler=accountHandlers[url.pathname];assert.equal(typeof handler,'function');
                assert(method==='GET'||method==='POST'&&url.pathname==='/api/merchant-enterprise/attendance/self');
                return handler(new Request(url,{method,headers:{'x-merchant-access-token':tokens[epoch],'content-type':'application/json',origin:canonical},...(body===undefined?{}:{body:JSON.stringify(body)})}),{entitlement});
              },
            });
            assert.deepEqual(external,[]);assert.deepEqual(errors,[]);assert.deepEqual(reads.errors,[]);assert.deepEqual(transport.errors,[]);assert.deepEqual(accountReads.errors,[]);
            assert.equal(accountLose,null);assert.equal(hold,null);assert.equal(rpcCalls.length,0);assert.equal(roleRpcCalls.length,0);
            console.log(JSON.stringify({actualAccountSwitchShell:true,...proof,realAuthService:false,realNextServer:false,realPhone:false,productionAccess:false,externalRequests:0}));return;
          }
          if(locationMode){
            const {checkAttendanceLocationManagementShell}=await import('./merchant-attendance-location-management-shell-checks.mjs');
            await checkAttendanceLocationManagementShell({owner,phone,self,response,requests,exec,events,audits,employee,roleRpcCalls,employeeRpcCalls:rpcCalls,
              site,employeeId,workerId,placeId,roleId:id(30),pass:native.pass,
              readLocation:async operationId=>locationClock(new Request(canonical+'/api/merchant-enterprise/attendance/location-clock?'+new URLSearchParams({siteId:site,expectedWorkerId:workerId,operationId}),
                {headers:{'x-merchant-access-token':await auth.login(actors[1])}}),{entitlement,enabled:()=>true}),
              holdResponse:(method='POST')=>{assert.equal(hold,null);const gate={path:'/api/merchant-enterprise/attendance/location-clock',method,ready:deferred(),release:deferred(),finished:deferred()};hold=gate;held.add(gate);
                return {ready:()=>bounded(gate.ready.promise,'location_management_held_sql_timeout'),release:async()=>{gate.release.resolve();await bounded(gate.finished.promise,'location_management_held_response_timeout');}};},
            });
            assert.deepEqual(external,[]);assert.deepEqual(errors,[]);assert.deepEqual(reads.errors,[]);assert.deepEqual(transport.errors,[]);
            return;
          }
          const firstResponse=response(phone,selfEndpoint,'POST');await self().getByRole('button',{name:'上班打卡',exact:true}).click();const first=await(await firstResponse).json();
          await self().getByText('收据编号：'+first.receipt.id,{exact:true}).waitFor();assert.equal(events().length,1);
          native.pass('actual owner employee list and 390px employee SDK shell load real snapshot; ordinary punch reaches default executor and service-role SQL');
          if(roleMode){
            const {checkAttendanceRoleManagementShell}=await import('./merchant-attendance-role-management-shell-checks.mjs');
            await checkAttendanceRoleManagementShell({owner,phone,self,response,requests,exec,events,audits,employee,roleRpcCalls,first,site,employeeId,workerId,roleId:id(30),pendingKey,
              pass:native.pass,readSelf:async operationId=>handleAttendanceSelf(new Request(canonical+'/api/merchant-enterprise/attendance/self?'+new URLSearchParams({siteId:site,operationId}),
                {headers:{'x-merchant-access-token':await auth.login(actors[1])}}),{entitlement}),
              employeeRoleAttempt:async body=>rolePatch(new Request(canonical+'/api/merchant-enterprise/roles',{method:'PATCH',
                headers:{'x-merchant-access-token':await auth.login(actors[1]),'content-type':'application/json',origin:canonical},body:JSON.stringify(body)})),
              holdSuccess:()=>{assert.equal(hold,null);const gate={ready:deferred(),release:deferred(),finished:deferred()};hold=gate;held.add(gate);
                return {ready:()=>bounded(gate.ready.promise,'role_management_held_sql_timeout'),release:async()=>{gate.release.resolve();await bounded(gate.finished.promise,'role_management_held_response_timeout');}};},
            });
            assert.deepEqual(external,[]);assert.deepEqual(errors,[]);assert.deepEqual(reads.errors,[]);assert.deepEqual(transport.errors,[]);assert.equal(rpcCalls.length,0);
            return;
          }
          // Commit a second fact, but lose its HTTP success. Original operation
          // must survive employee disable and later be recovered by GET only.
          lose=true;await self().getByRole('button',{name:'开始休息',exact:true}).click();await self().getByRole('button',{name:'核对打卡结果',exact:true}).waitFor();
          const savedPending=await phone.evaluate(key=>sessionStorage.getItem(key),pendingKey);assert(savedPending);const command=JSON.parse(savedPending).command;
          const committed=events();assert.equal(committed.length,2);assert(committed.some(row=>row.operation_id===command.operationId));
          assert.equal(requests.filter(r=>r.path===selfEndpoint&&r.method==='POST').length,2);
          await employeeCard().getByRole('button',{name:'停用',exact:true}).click();const dialog=owner.getByRole('dialog',{name:'安全停用员工',exact:true});
          const disabledResponse=response(owner,employeeEndpoint,'PATCH');await dialog.getByRole('button',{name:'停用并解除负责人',exact:true}).click();await disabledResponse;
          await employeeCard().getByRole('button',{name:'恢复',exact:true}).waitFor();
          assert.equal(employee().status,'disabled');assert.equal(employee().version,original.version+1);assert.equal(audits().length,1);assert.deepEqual(events(),committed);assert.equal(immutable(),untouched);
          native.pass('actual owner offboarding dialog PATCH executes 019 -> 017 -> 011 wrappers; real trigger increments version and audit records disable without altering attendance facts');
          const denied=await handleAttendanceSelf(new Request(canonical+'/api/merchant-enterprise/attendance/self?'+new URLSearchParams({siteId:site,operationId:command.operationId}),
            {headers:{'x-merchant-access-token':await auth.login(actors[1])}}),{entitlement});
          assert.equal(denied.status,403);assert.deepEqual(await denied.json(),{ok:false,error:'attendance_access_denied'});
          const capabilityResponse=response(phone,'/api/merchant-business/capabilities','GET',403),membershipResponse=response(phone,'/api/merchant-enterprise/overview','GET',403);
          await phone.evaluate(()=>window.dispatchEvent(new Event('focus')));assert.equal((await(await capabilityResponse).json()).error,'staff_business_access_disabled');
          await membershipResponse;await phone.getByRole('button',{name:'重新核验企业身份',exact:true}).waitFor();
          assert.equal(await self().count(),0);assert.equal(await phone.getByText(/^收据编号：/).count(),0);
          assert.equal(await phone.getByRole('button',{name:'用原操作编号重试',exact:true}).count(),0);
          assert.equal(await phone.evaluate(key=>sessionStorage.getItem(key),pendingKey),savedPending);
          native.pass('rollout-off focus remount performs real overview membership check, rejects disabled employee and removes old attendance DOM; pending intent survives and direct real self GET also rejects');
          assert.deepEqual(events(),committed);assert.equal(immutable(),untouched);
          const restoredResponse=response(owner,employeeEndpoint,'PATCH');await employeeCard().getByRole('button',{name:'恢复',exact:true}).click();await restoredResponse;
          await employeeCard().getByRole('button',{name:'停用',exact:true}).waitFor();assert.equal(employee().status,'active');assert.equal(employee().version,original.version+2);assert.equal(audits().length,2);
          const identityResponse=response(phone,'/api/merchant-enterprise/overview','GET');await phone.getByRole('button',{name:'重新核验企业身份',exact:true}).click();await identityResponse;
          const recoveredResponse=response(phone,selfEndpoint,'GET');await phone.getByRole('navigation',{name:'企业管理功能',exact:true}).getByRole('button',{name:'我的考勤',exact:true}).click();const recovered=await(await recoveredResponse).json();
          assert.equal(recovered.receipt.operationId,command.operationId);await self().getByText('收据编号：'+recovered.receipt.id,{exact:true}).waitFor();
          assert.equal(await phone.evaluate(key=>sessionStorage.getItem(key),pendingKey),null);assert.equal(requests.filter(r=>r.path===selfEndpoint&&r.method==='POST').length,2);
          assert.deepEqual(events(),committed);assert.equal(immutable(),untouched);assert.equal(rpcCalls.length,2);
          native.pass('actual owner restore increments version/audit; employee explicitly revalidates membership and recovers exact committed operation using GET, without another punch');
          // Unlike a lost reply, this successful SQL response is deliberately
          // delivered after the old component has been disposed by revocation.
          const gate={ready:deferred(),release:deferred(),finished:deferred()};hold=gate;held.add(gate);
          await self().getByRole('button',{name:'结束休息',exact:true}).click();const late=await bounded(gate.ready.promise,'employee_management_held_sql_timeout');
          const heldPending=await phone.evaluate(key=>sessionStorage.getItem(key),pendingKey);assert(heldPending);assert.equal(JSON.parse(heldPending).command.operationId,late.receipt.operationId);
          const withLate=events();assert.equal(withLate.length,3);
          await employeeCard().getByRole('button',{name:'停用',exact:true}).click();const secondDisable=response(owner,employeeEndpoint,'PATCH');
          await dialog.getByRole('button',{name:'停用并解除负责人',exact:true}).click();await secondDisable;await employeeCard().getByRole('button',{name:'恢复',exact:true}).waitFor();
          const secondDenied=response(phone,'/api/merchant-enterprise/overview','GET',403);await phone.evaluate(()=>window.dispatchEvent(new Event('focus')));await secondDenied;
          await phone.getByRole('button',{name:'重新核验企业身份',exact:true}).waitFor();assert.equal(await self().count(),0);
          gate.release.resolve();await bounded(gate.finished.promise,'employee_management_late_response_timeout');
          await phone.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
          assert.equal(await self().count(),0);assert.equal(await phone.getByText('收据编号：'+late.receipt.id,{exact:true}).count(),0);
          assert.equal(await phone.evaluate(key=>sessionStorage.getItem(key),pendingKey),heldPending);assert.deepEqual(events(),withLate);
          const secondRestore=response(owner,employeeEndpoint,'PATCH');await employeeCard().getByRole('button',{name:'恢复',exact:true}).click();await secondRestore;
          await employeeCard().getByRole('button',{name:'停用',exact:true}).waitFor();
          const secondIdentity=response(phone,'/api/merchant-enterprise/overview','GET');await phone.getByRole('button',{name:'重新核验企业身份',exact:true}).click();await secondIdentity;
          const secondRecovered=response(phone,selfEndpoint,'GET');await phone.getByRole('navigation',{name:'企业管理功能',exact:true}).getByRole('button',{name:'我的考勤',exact:true}).click();
          const receipt=await(await secondRecovered).json();assert.deepEqual(receipt.receipt,late.receipt);
          await self().getByText('收据编号：'+late.receipt.id,{exact:true}).waitFor();assert.equal(await phone.evaluate(key=>sessionStorage.getItem(key),pendingKey),null);
          assert.deepEqual(events(),withLate);assert.equal(immutable(),untouched);assert.equal(employee().version,original.version+4);assert.equal(rpcCalls.length,4);
          assert.equal(requests.filter(r=>r.path===selfEndpoint&&r.method==='POST').length,3);
          const history=audits().sort((a,b)=>a.created_at.localeCompare(b.created_at));assert.equal(history.length,4);
          for(const [index,row] of history.entries()){
            assert.equal(row.event_type,index%2?'employee.restored':'employee.disabled');assert.equal(row.entity_type,'employee');assert.equal(row.entity_id,employeeId);
            assert.equal(row.actor_type,'owner');assert.equal(row.actor_id,null);assert.equal(row.target_label,'合成员工甲');
            assert.equal(row.before_data.status,index%2?'disabled':'active');assert.equal(row.after_data.status,index%2?'active':'disabled');
            for(const data of [row.before_data,row.after_data])for(const key of ['email','auth_user_id','password','token','invitation_token_hash'])assert.equal(key in data,false);
          }
          native.pass('committed late success cannot revive revoked old DOM or clear its pending ID; same-member restore GET recovers exact receipt; four audited lifecycle changes contain no auth secrets');
          const stale=await owner.evaluate(async body=>{const reply=await fetch('/api/merchant-enterprise/employees',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify(body)});return {status:reply.status,body:await reply.json()};},{siteId:site,employeeId,version:original.version,status:'disabled',offboardingMode:'unassign'});
          assert.equal(stale.status,409);assert.equal(audits().length,4);assert.equal(rpcCalls.length,4);assert.equal(employee().version,original.version+4);assert.deepEqual(events(),withLate);
          assert.deepEqual(external,[]);assert.deepEqual(errors,[]);assert.deepEqual(reads.errors,[]);assert.deepEqual(transport.errors,[]);
          native.pass('stale owner PATCH rejected before mutation RPC; no duplicate audit or attendance event');
          console.log(JSON.stringify({actualEmployeeManagementUi:true,actualEmployeeHandlersAndStore:true,actualAuditedEmployeeSql:true,actualEmployeeAttendanceShell:true,
            rolloutOffMembershipRemountVerified:true,statusChanges:4,employeeAudits:4,attendanceEvents:3,punchPosts:3,recoveryMethod:'GET',lateResponseAfterDisposal:true,realAuthService:false,realNextServer:false,
            syntheticMerchantBootstrap:true,syntheticPlatformEntitlement:true,syntheticMembershipSelector:true,unrelatedTaskReadsExplicit503:true,productionAccess:false,externalRequests:0}));
        }finally{closing=true;for(const gate of held)gate.release.resolve();try{await bounded(Promise.allSettled([...pendingRoutes]),'employee_management_route_drain');}finally{accountTokens.clear();employeeContexts.clear();pageIds.clear();}}
      },undefined,reads.read);
    }catch(error){
      console.error('EMPLOYEE_MANAGEMENT_ERRORS',errors.slice(-4).map(diagnostic));console.error('EMPLOYEE_MANAGEMENT_REQUESTS',requests.slice(-10).map(({path,method,status})=>({path,method,status})));
      if(browser)for(const context of browser.contexts())for(const page of context.pages())console.error('EMPLOYEE_MANAGEMENT_DOM',diagnostic((await page.locator('body').innerText().catch(()=>'')).slice(-4000)));
      throw error;
    }finally{
      closing=true;
      for(const gate of held)gate.release.resolve();
      if(savedSnapshotMode===undefined)delete process.env[snapshotFlag];else process.env[snapshotFlag]=savedSnapshotMode;
      if(pinMode){if(savedPepper===undefined)delete process.env[pepperKey];else process.env[pepperKey]=savedPepper;}
      if(onsiteMode){if(savedOnsiteSecret===undefined)delete process.env[onsiteSecretKey];else process.env[onsiteSecretKey]=savedOnsiteSecret;}
      await runAttendanceCleanupSteps([{name:'browser',run:()=>browser?.close()},{name:'routes',run:()=>Promise.allSettled([...pendingRoutes])},
        {name:'harness',timeoutMs:10000,run:async()=>{if(child.pid!==undefined&&child.exitCode===null&&child.signalCode===null){const stopped=once(child,'exit');child.kill();await stopped;}}}]);
    }
  });
}
await runAttendanceLabelsReuse(process.argv.slice(2).filter(arg=>!['--roles','--location','--pin','--onsite','--delegated','--accounts','--tabs'].includes(arg)),check).catch(error=>{console.error(diagnostic(error?.stack??String(error)));process.exitCode=1;});
