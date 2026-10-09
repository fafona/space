// Local-only acceptance of the ACTUAL AdminClient -> enterprise attendance
// configuration/scope/audit controls. Auth and outer bootstrap are synthetic;
// attendance handlers/default executors use service_role in an owned namespace.
// No real accounts, production access, Next server, screenshots or saved exports.
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
import {runAttendanceCleanupSteps,deleteAttendanceDownloadOnce} from './fixtures/attendance-cleanup.mjs';
const require=createRequire(import.meta.url);
const {withAttendanceApplicationAuth}=require('./fixtures/attendance-application-auth.ts');
const {createAttendanceAuditShellTransport,databaseId:id,databaseActors:actors}=require('./fixtures/attendance-audit-shell-transport.ts');
const {serveAttendanceMerchantBootstrap}=require('./fixtures/attendance-merchant-shell-transport.ts');
const {resolveValidatedMerchantEnterpriseAuthContext,requireMerchantEnterpriseEntitlement}=require('../src/lib/merchantEnterpriseAuth.server.ts');
const {MERCHANT_AUTH_COOKIE}=require('../src/lib/merchantAuthSession.ts');
const {TERMINAL_COOKIE}=require('../src/lib/merchantAttendanceTerminal.ts');
const {handleAttendanceAdmin}=require('../src/app/api/merchant-enterprise/attendance/admin/route-handler.ts');
const {handleAttendanceScopes}=require('../src/app/api/merchant-enterprise/attendance/scopes/route-handler.ts');
const {handleAttendanceChoices}=require('../src/app/api/merchant-enterprise/attendance/choices/route-handler.ts');
const {handleAttendanceAudit}=require('../src/app/api/merchant-enterprise/attendance/audit/route-handler.ts');
const {handleAttendanceAuditExport}=require('../src/app/api/merchant-enterprise/attendance/audit-export/route-handler.ts');
const controlsMode=process.argv.includes('--controls');
const terminalShellMode=process.argv.includes('--terminal-shell');
const pinShellMode=process.argv.includes('--pin-shell');
const missingFlowMode=process.argv.includes('--missing-flow');
const correctionFlowMode=process.argv.includes('--correction-flow')||missingFlowMode;
const locationSettingsMode=process.argv.includes('--location-settings');
const locationExceptionsMode=process.argv.includes('--location-exceptions');
const employeeLocationMode=process.argv.includes('--employee-location')||locationExceptionsMode;
const employeeShellMode=employeeLocationMode||correctionFlowMode||terminalShellMode||pinShellMode;
assert([controlsMode,correctionFlowMode,terminalShellMode,pinShellMode,locationSettingsMode,process.argv.includes('--employee-location'),locationExceptionsMode].filter(Boolean).length<=1,'attendance_shell_conflicting_scenarios');
const terminalHandlers=terminalShellMode?{
  terminals:require('../src/app/api/merchant-enterprise/attendance/terminals/route-handler.ts').handleTerminalAdmin,
  'terminal-device':require('../src/app/api/merchant-enterprise/attendance/terminal-device/route-handler.ts').handleTerminalDevice,
  'onsite-code':require('../src/app/api/merchant-enterprise/attendance/onsite-code/route-handler.ts').handleOnsiteCode,
  'onsite-clock':require('../src/app/api/merchant-enterprise/attendance/onsite-clock/route-handler.ts').handleOnsiteClock,
}:{};
const terminalPages=['/enterprise/attendance-terminal','/enterprise/attendance-terminal/onsite'];
const terminalDeviceApis=['/api/merchant-enterprise/attendance/terminal-device','/api/merchant-enterprise/attendance/onsite-code'];
const pinHandlers=pinShellMode?{
  terminals:require('../src/app/api/merchant-enterprise/attendance/terminals/route-handler.ts').handleTerminalAdmin,
  'terminal-device':require('../src/app/api/merchant-enterprise/attendance/terminal-device/route-handler.ts').handleTerminalDevice,
  'pin-credentials':require('../src/app/api/merchant-enterprise/attendance/pin-credentials/route-handler.ts').handlePinAdmin,
  'terminal-clock':require('../src/app/api/merchant-enterprise/attendance/terminal-clock/route-handler.ts').handlePinClock,
}:{};
const pinPages=['/enterprise/attendance-terminal','/enterprise/attendance-terminal/clock'];
const pinDeviceApis=['/api/merchant-enterprise/attendance/terminal-device','/api/merchant-enterprise/attendance/terminal-clock'];
const controlsHandler=controlsMode||correctionFlowMode?require('../src/app/api/merchant-enterprise/attendance/correction-controls/route-handler.ts').handleCorrectionControls:null;
const correctionHandlers=correctionFlowMode?{
  self:require('../src/app/api/merchant-enterprise/attendance/self/route-handler.ts').handleAttendanceSelf,
  history:require('../src/app/api/merchant-enterprise/attendance/history/route-handler.ts').handleAttendanceHistory,
  session:require('../src/app/api/merchant-enterprise/attendance/session/route-handler.ts').handleAttendanceSession,
  'corrections/context':require('../src/app/api/merchant-enterprise/attendance/corrections/context/route-handler.ts').handleCorrectionContext,
  corrections:require('../src/app/api/merchant-enterprise/attendance/corrections/route-handler.ts').handleAttendanceCorrection,
  'correction-reviews':require('../src/app/api/merchant-enterprise/attendance/correction-reviews/route-handler.ts').handleCorrectionReview,
  'correction-decisions':require('../src/app/api/merchant-enterprise/attendance/correction-decisions/route-handler.ts').handleCorrectionDecision,
  'revision-requests':require('../src/app/api/merchant-enterprise/attendance/revision-requests/route-handler.ts').handleAttendanceRevision,
  'revision-reviews':require('../src/app/api/merchant-enterprise/attendance/revision-reviews/route-handler.ts').handleAttendanceRevisionReview,
  'revision-decisions':require('../src/app/api/merchant-enterprise/attendance/revision-decisions/route-handler.ts').handleRevisionDecision,
  'revision-history':require('../src/app/api/merchant-enterprise/attendance/revision-history/route-handler.ts').handleRevisionHistory,
  timesheet:require('../src/app/api/merchant-enterprise/attendance/timesheet/route-handler.ts').handleAttendanceTimesheet,
  'scoped-timesheet':require('../src/app/api/merchant-enterprise/attendance/scoped-timesheet/route-handler.ts').handleAttendanceScopedTimesheet,
  'scoped-timesheet-context':require('../src/app/api/merchant-enterprise/attendance/scoped-timesheet-context/route-handler.ts').handleAttendanceScopedContext,
  'timesheet-export':require('../src/app/api/merchant-enterprise/attendance/timesheet-export/route-handler.ts').handleTimesheetExport,
  ...(missingFlowMode?{
    missing:require('../src/app/api/merchant-enterprise/attendance/missing/route-handler.ts').handleAttendanceMissing,
    'unified-timesheet':require('../src/app/api/merchant-enterprise/attendance/unified-timesheet/route-handler.ts').handleUnifiedTimesheet,
    'unified-export':require('../src/app/api/merchant-enterprise/attendance/unified-export/route-handler.ts').handleUnifiedExport,
  }:{}),
}:{};
const locationHandlers=locationSettingsMode||employeeLocationMode?{
  'location-policy':require('../src/app/api/merchant-enterprise/attendance/location-policy/route-handler.ts').handleAttendanceLocationPolicy,
  'location-setup':require('../src/app/api/merchant-enterprise/attendance/location-setup/route-handler.ts').handleLocationSetup,
  'location-notice':require('../src/app/api/merchant-enterprise/attendance/location-notice/route-handler.ts').handleAttendanceNotice,
  ...(employeeLocationMode?{
    'location-clock':require('../src/app/api/merchant-enterprise/attendance/location-clock/route-handler.ts').handleAttendanceLocationClock,
    'self-context':require('../src/app/api/merchant-enterprise/attendance/self-context/route-handler.ts').handleAttendanceSelfContext,
    self:require('../src/app/api/merchant-enterprise/attendance/self/route-handler.ts').handleAttendanceSelf,
    history:require('../src/app/api/merchant-enterprise/attendance/history/route-handler.ts').handleAttendanceHistory,
  }:{}),
  ...(locationExceptionsMode?{
    'location-reviews':require('../src/app/api/merchant-enterprise/attendance/location-reviews/route-handler.ts').handleAttendanceLocationReview,
    'location-discussion':require('../src/app/api/merchant-enterprise/attendance/location-discussion/route-handler.ts').handleAttendanceDiscussion,
  }:{}),
}:{};
const faultEndpoints=new Set([
  ...(controlsMode||correctionFlowMode?['/api/merchant-enterprise/attendance/correction-controls']:[]),
  ...Object.keys(correctionHandlers).map(name=>'/api/merchant-enterprise/attendance/'+name),
  ...Object.keys(locationHandlers).map(name=>'/api/merchant-enterprise/attendance/'+name),
  ...(terminalShellMode?['/api/merchant-enterprise/attendance/onsite-clock']:[]),
  ...(pinShellMode?['/api/merchant-enterprise/attendance/terminal-clock','/api/merchant-enterprise/attendance/pin-credentials']:[]),
]);
const {createAttendanceAuditExportLimiter}=require('../src/lib/merchantAttendanceAuditExport.server.ts');
const {parseAttendanceAuditExportResult,buildAttendanceAuditCsv}=require('../src/lib/merchantAttendanceAuditExport.ts');
const origin='https://127.0.0.1:3131',staticOrigin='http://127.0.0.1:3131',canonical='https://www.faolla.com';
const localFetch=globalThis.fetch,site='99990001';
const redactDiagnostics=value=>String(value)
  .replace(/aq1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,'[synthetic-qr-redacted]')
  .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,'[synthetic-token-redacted]')
  .replace(/(?<!\d)\d{8,12}(?!\d)/g,'[synthetic-numeric-value-redacted]')
  .replace(/[a-f0-9]{32,}/g,'[synthetic-hash-redacted]')
  .replace(/[A-Za-z0-9_-]{43,}/g,'[synthetic-opaque-value-redacted]');
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
async function bounded(promise,label,ms=15000){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(label)),ms);})]);}finally{clearTimeout(timer);}}
function canonicalStoredInstant(value){
  // SQL audit projection emits six fractional digits; scope receipt JSON can
  // preserve the browser's original three. Never round through Date/millis.
  assert.equal(typeof value,'string');const match=/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})\.(\d{3}|\d{6})Z$/.exec(value);assert(match,'audit_shell_invalid_stored_instant');
  return match[1]+'.'+match[2].padEnd(6,'0')+'Z';
}

// Independent CSV reader: understands escaped quotes/commas/CRLF, not a split
// that could accidentally accept damaged historical JSON or a truncated row.
function csvRows(text){
  assert(text.startsWith('\ufeff'));const rows=[];let row=[],cell='',quoted=false;
  for(let n=1;n<text.length;n++){
    const c=text[n];
    if(c==='"'){if(quoted&&text[n+1]==='"'){cell+='"';n++;}else quoted=!quoted;}
    else if(c===','&&!quoted){row.push(cell);cell='';}
    else if(c==='\r'&&!quoted){assert.equal(text[++n],'\n');row.push(cell);rows.push(row);row=[];cell='';}
    else cell+=c;
  }
  assert.equal(quoted,false);assert.equal(cell,'');assert.deepEqual(row,[]);return rows;
}

async function check(native){
  const {root,query,pass}=native;
  await withAttendanceConcurrencySandbox(native,async({sql})=>{
    const exec=source=>query(sql(source));
    for(const name of ['202609300069_merchant_attendance_audit_read.sql','202609300080_merchant_attendance_audit_export.sql'])
      exec(readFileSync(path.join(root,'scripts/supabase-migrations',name),'utf8'));
    if(locationSettingsMode||employeeLocationMode)for(const name of [
      '202609300071_merchant_attendance_location_precheck.sql','202609300072_merchant_attendance_location_clock.sql',
      '202609300073_merchant_attendance_location_policy_drafts.sql','202609300076_merchant_attendance_location_notices.sql',
      '202609300077_merchant_attendance_location_clock_notice_guard.sql','202609300078_merchant_attendance_location_setup.sql',
    ])exec(readFileSync(path.join(root,'scripts/supabase-migrations',name),'utf8'));
    if(employeeLocationMode||correctionFlowMode)for(const name of ['202609300068_merchant_attendance_self_history.sql','202609300079_merchant_attendance_self_context.sql'])
      exec(readFileSync(path.join(root,'scripts/supabase-migrations',name),'utf8'));
    if(terminalShellMode)for(const name of ['202610010104_merchant_attendance_terminals.sql','202610010108_merchant_attendance_onsite_qr.sql'])
      exec(readFileSync(path.join(root,'scripts/supabase-migrations',name),'utf8'));
    if(pinShellMode)for(const name of ['202610010104_merchant_attendance_terminals.sql','202610010106_merchant_attendance_pin_credentials.sql','202610010107_merchant_attendance_pin_clock.sql'])
      exec(readFileSync(path.join(root,'scripts/supabase-migrations',name),'utf8'));
    if(correctionFlowMode)for(const name of [
      '202609300087_merchant_attendance_period_report.sql','202610010088_merchant_attendance_scoped_period_report.sql',
      '202610010089_merchant_attendance_scoped_report_context.sql',
      '202610010090_merchant_attendance_period_export.sql','202610010091_merchant_attendance_revision_requests.sql',
      '202610010092_merchant_attendance_revision_review.sql','202610010093_merchant_attendance_versioned_reports.sql',
      '202610010094_merchant_attendance_revision_decision_core.sql','202610010095_merchant_attendance_revision_cycles.sql',
      '202610010096_merchant_attendance_current_correction_decisions.sql','202610010097_merchant_attendance_revision_history.sql',
      '202610010098_merchant_attendance_revision_application_access.sql',
    ])exec(readFileSync(path.join(root,'scripts/supabase-migrations',name),'utf8'));
    if(locationExceptionsMode)for(const name of ['202609300074_merchant_attendance_location_reviews.sql','202609300075_merchant_attendance_location_discussion.sql'])
      exec(readFileSync(path.join(root,'scripts/supabase-migrations',name),'utf8'));
    if(missingFlowMode)for(const name of [
      '202610010099_merchant_attendance_schedule.sql','202610010100_merchant_attendance_missing_requests.sql',
      '202610010101_merchant_attendance_unified_report.sql','202610010102_merchant_attendance_unified_export.sql',
      '202610010103_merchant_attendance_missing_revisions.sql',
    ])exec(readFileSync(path.join(root,'scripts/supabase-migrations',name),'utf8'));
    // Pre-existing synthetic enterprise identities only. Attendance settings,
    // location, worker, grant and removal below are created by actual controls.
    exec(`begin;insert into public.merchants(id,user_id) values('${site}','${actors[0].id}');
      insert into public.merchant_enterprise_roles(id,merchant_id,name,permissions) values
      ('${id(30)}','${site}','合成主管角色',array['enterprise.view','attendance.records.view']),
      ('${id(31)}','${site}','合成员工角色',array['enterprise.view','attendance.self.view','attendance.self.clock']);
      insert into public.merchant_enterprise_employees(id,merchant_id,auth_user_id,email,display_name,role_id,status) values
      ('${id(101)}','${site}','${actors[1].id}','${actors[1].email}','合成主管甲','${id(30)}','active'),
      ('${id(102)}','${site}','${actors[2].id}','${actors[2].email}','合成员工乙','${id(31)}','active');commit;`);
    const transport=createAttendanceAuditShellTransport(exec);
    const configCount=()=>Number(exec('select count(*) from public.merchant_attendance_config_operations;'));
    const scopeCount=()=>Number(exec('select count(*) from public.merchant_attendance_scope_operations;'));
    const facts=()=>exec(`select jsonb_build_object(
      'events',(select md5(coalesce(jsonb_agg(to_jsonb(t) order by merchant_id,worker_id,sequence)::text,'[]')) from public.merchant_attendance_events t),
      'config',(select md5(coalesce(jsonb_agg(to_jsonb(t) order by merchant_id,operation_id)::text,'[]')) from public.merchant_attendance_config_operations t),
      'scope',(select md5(coalesce(jsonb_agg(to_jsonb(t) order by merchant_id,employee_id,operation_id)::text,'[]')) from public.merchant_attendance_scope_operations t));`);
    const probe=net.createServer();await new Promise((resolve,reject)=>{probe.once('error',reject);probe.listen(3131,'127.0.0.1',resolve);});await new Promise(resolve=>probe.close(resolve));
    const child=spawn(process.execPath,['scripts/attendance-self-browser-harness.mjs','--merchant-shell',...(pinShellMode?['--pin-shell']:[]),...(terminalShellMode?['--terminal-shell']:[]),...(controlsMode?['--controls']:[]),...(correctionFlowMode?['--correction-flow']:[]),...(missingFlowMode?['--missing-flow']:[]),...(locationSettingsMode?['--location-settings']:[]),...(employeeLocationMode?[locationExceptionsMode?'--location-exceptions':'--employee-location']:[])],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});
    let browser,gate=null,transportClosing=false;const errors=[],browserDiagnostics=[],external=[],requests=[],exports=[],downloads=[],pendingRoutes=new Set(),heldGates=new Set();
    const control={lose:null,unsent:null,acceptDialogs:true};
    const holdExceptionResponse=(page,endpoint,method='POST')=>{
      assert(locationExceptionsMode&&['/api/merchant-enterprise/attendance/location-reviews','/api/merchant-enterprise/attendance/location-discussion'].includes(endpoint),'attendance_shell_invalid_hold_target');
      assert(['GET','POST'].includes(method)&&gate===null,'attendance_shell_invalid_hold_state');
      const current={page,endpoint,method,ready:deferred(),release:deferred(),finished:deferred()};gate=current;heldGates.add(current);
      return {ready:()=>bounded(current.ready.promise,'exception_shell_held_sql_timeout'),release:async()=>{current.release.resolve();await bounded(current.finished.promise,'exception_shell_held_response_timeout');}};
    };
    const holdCorrectionResponse=(page,endpoint)=>{
      assert(correctionFlowMode&&['/api/merchant-enterprise/attendance/corrections','/api/merchant-enterprise/attendance/correction-decisions','/api/merchant-enterprise/attendance/timesheet-export',...(missingFlowMode?['/api/merchant-enterprise/attendance/unified-export']:[])].includes(endpoint),'attendance_correction_shell_invalid_hold_target');
      assert(gate===null,'attendance_correction_shell_invalid_hold_state');
      const current={page,endpoint,method:'POST',ready:deferred(),release:deferred(),finished:deferred()};gate=current;heldGates.add(current);
      return {ready:()=>bounded(current.ready.promise,'correction_shell_held_sql_timeout'),release:async()=>{current.release.resolve();await bounded(current.finished.promise,'correction_shell_held_response_timeout');}};
    };
    const holdLocationSettingsResponse=(page,endpoint)=>{
      assert(locationSettingsMode&&['/api/merchant-enterprise/attendance/location-policy','/api/merchant-enterprise/attendance/location-setup','/api/merchant-enterprise/attendance/location-notice'].includes(endpoint),'attendance_location_settings_invalid_hold_target');
      assert(gate===null,'attendance_location_settings_invalid_hold_state');
      const current={page,endpoint,method:'POST',ready:deferred(),release:deferred(),finished:deferred()};gate=current;heldGates.add(current);
      return {ready:()=>bounded(current.ready.promise,'location_settings_held_sql_timeout'),release:async()=>{current.release.resolve();await bounded(current.finished.promise,'location_settings_held_response_timeout');}};
    };
    const holdControlsResponse=(page,endpoint)=>{
      assert(controlsMode&&endpoint==='/api/merchant-enterprise/attendance/correction-controls','attendance_controls_invalid_hold_target');
      assert(gate===null,'attendance_controls_invalid_hold_state');
      const current={page,endpoint,method:'POST',ready:deferred(),release:deferred(),finished:deferred()};gate=current;heldGates.add(current);
      return {ready:()=>bounded(current.ready.promise,'controls_held_sql_timeout'),release:async()=>{current.release.resolve();await bounded(current.finished.promise,'controls_held_response_timeout');}};
    };
    const featureFlags=[...(terminalShellMode?['TERMINALS','ONSITE_QR']:[]),...(controlsMode||correctionFlowMode?['CORRECTION_CONTROLS']:[]),...(correctionFlowMode?['TIMESHEET','SCOPED_TIMESHEET','TIMESHEET_EXPORT','RECORDS']:[]),...(missingFlowMode?['MISSING','UNIFIED_REPORT','UNIFIED_EXPORT']:[]),...(locationSettingsMode||employeeLocationMode?['LOCATION_POLICY','LOCATION_SETUP','LOCATION_NOTICE']:[]),...(employeeLocationMode?['LOCATION_CLOCK']:[]),...(locationExceptionsMode?['LOCATION_REVIEW','LOCATION_DISCUSSION']:[])].map(name=>'FAOLLA_ATTENDANCE_'+name+'_ENABLED');
    if(pinShellMode)featureFlags.push(...['TERMINALS','PIN','PIN_CLOCK'].map(name=>'FAOLLA_ATTENDANCE_'+name+'_ENABLED'));
    const savedFlags=new Map(featureFlags.map(name=>[name,process.env[name]]));
    const onsiteSecretKey='FAOLLA_ATTENDANCE_ONSITE_QR_SECRET',savedOnsiteSecret=process.env[onsiteSecretKey];
    const pinPepperKey='FAOLLA_ATTENDANCE_PIN_PEPPER',savedPinPepper=process.env[pinPepperKey];
    // Each independent scenario retains the real six-per-minute limiter. This
    // acceptance does NOT test a shared production quota or quota timing.
    let exportLimiter=createAttendanceAuditExportLimiter();
    try{
      for(const name of featureFlags)process.env[name]='1';
      if(terminalShellMode)process.env[onsiteSecretKey]=randomBytes(32).toString('hex');
      if(pinShellMode)process.env[pinPepperKey]=randomBytes(32).toString('base64url');
      await bounded(new Promise((resolve,reject)=>{let output='';child.stdout.on('data',c=>{output+=String(c);if(output.includes('Attendance synthetic component QA'))resolve();});child.stderr.on('data',c=>errors.push(String(c)));child.once('error',reject);child.once('exit',code=>reject(Error('audit_shell_harness_exit_'+code)));}),'audit_shell_harness_timeout',20000);
      assert.equal((await localFetch(staticOrigin+'/api/merchant-enterprise/attendance/admin',{method:'POST'})).status,403);
      browser=await chromium.launch({headless:true});
      await withAttendanceApplicationAuth(actors,transport.rpc,async auth=>{
        try{
        const handlers={admin:handleAttendanceAdmin,scopes:handleAttendanceScopes,choices:handleAttendanceChoices,audit:handleAttendanceAudit,'audit-export':handleAttendanceAuditExport,...(controlsMode||correctionFlowMode?{'correction-controls':controlsHandler}:{}),...locationHandlers,...correctionHandlers,...terminalHandlers,...pinHandlers};
        const entitlement=siteId=>requireMerchantEnterpriseEntitlement(siteId,async()=>[{id:site,permissionConfig:{allowEnterpriseManagement:true,allowEmployeeAttendance:transport.state.moduleEnabled}}]);
        const newPage=async({mobile=false,actor=actors[0],employee=false,device=false}={})=>{
          assert(!employee||employeeShellMode,'attendance_shell_employee_mode_required');
          assert(!device||(terminalShellMode||pinShellMode)&&!employee,'attendance_shell_device_mode_required');
          const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1280,height:960},isMobile:mobile,hasTouch:mobile,acceptDownloads:true,serviceWorkers:'block'});
          if(!device)await context.addInitScript(()=>localStorage.setItem('merchant-space:locale:v1','zh-CN'));
          if(!employee&&!device)await context.addCookies([{name:MERCHANT_AUTH_COOKIE,value:await auth.login(actor),url:origin,secure:true,httpOnly:true,sameSite:'Lax'}]);
          await context.route('**/*',route=>{
            if(transportClosing)return route.abort().catch(()=>{});
            const work=(async()=>{
              const r=route.request(),url=new URL(r.url());
              if(url.origin!==origin){external.push(url.origin+url.pathname);return route.abort();}
              if(device)assert([...(terminalShellMode?[...terminalPages,...terminalDeviceApis]:[...pinPages,...pinDeviceApis]),'/harness.js','/harness.css'].includes(url.pathname),'attendance_shell_device_route_forbidden');
              if(terminalShellMode)assert(!url.search.includes('aq1.')&&!url.searchParams.has('token'),'attendance_shell_qr_in_http_url');
              if(employee&&url.pathname.startsWith('/auth/v1/')){
                // Installed SDK password/refresh/logout against the scoped
                // synthetic Auth protocol; never inject an employee token.
                const response=await fetch(new Request('https://attendance-auth.invalid'+url.pathname+url.search,{headers:await r.allHeaders(),method:r.method(),body:r.postData()??undefined}));
                return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:await response.text()});
              }
              if(['/auth/v1/settings','/rest/v1/'].includes(url.pathname)){assert.equal(r.method(),'GET');return route.fulfill({status:200,contentType:'application/json',body:'{}'});}
              if(url.pathname==='/downloads/faolla-android-version.json'){
                // Unrelated AdminClient app-version hint. Never read a real
                // release manifest; this exact GET receives a synthetic 404.
                assert.equal(r.method(),'GET');assert.deepEqual([...url.searchParams.keys()],['t']);assert.match(url.searchParams.get('t'),/^\d{13}$/);
                requests.push({path:url.pathname,method:r.method(),status:404,query:{},body:null});
                return route.fulfill({status:404,headers:{'content-type':'application/json','cache-control':'no-store'},body:JSON.stringify({ok:false,error:'synthetic_android_version_unavailable'})});
              }
              if(!url.pathname.startsWith('/api/')){
                assert.equal(r.method(),'GET');assert(['/99990001','/harness.js','/harness.css',...(employeeShellMode?['/enterprise','/enterprise/99990001']:[]),...(terminalShellMode?[...terminalPages,'/enterprise/attendance-scan']:[]),...(pinShellMode?pinPages:[])].includes(url.pathname),`audit_shell_unexpected_static_path:${url.pathname.slice(0,180)}`);
                const response=await localFetch(staticOrigin+url.pathname);return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});
              }
              const headers=new Headers(await r.allHeaders()),body=r.postData()??undefined;
              if(device){
                assert((terminalShellMode?terminalDeviceApis:pinDeviceApis).includes(url.pathname),'attendance_shell_device_api_forbidden');
                assert.equal(headers.get('x-merchant-access-token'),null);assert.equal(headers.get('authorization'),null);
                const cookie=headers.get('cookie');assert(cookie===null||cookie.split(';').every(part=>part.trim().startsWith(TERMINAL_COOKIE+'=')),'attendance_shell_device_has_account_cookie');
              }else if(employee){assert(headers.get('x-merchant-access-token'),'attendance_shell_employee_explicit_token_required');assert.equal(headers.get('cookie'),null);}
              else{assert.equal(headers.get('x-merchant-access-token'),null);assert(headers.get('cookie')?.includes(MERCHANT_AUTH_COOKIE+'='));}
              if(headers.get('origin')===origin)headers.set('origin',canonical);
              const referer=headers.get('referer');if(referer?.startsWith(origin+'/'))headers.set('referer',canonical+referer.slice(origin.length));headers.set('host','www.faolla.com');
              const request=new Request(canonical+url.pathname+url.search,{headers,method:r.method(),body});
              const parsedBody=body?JSON.parse(body):null;
              const safeBody=(terminalShellMode||pinShellMode)&&url.pathname.endsWith('/terminal-device')&&parsedBody?.action==='pair'?{action:'pair'}
                :terminalShellMode&&url.pathname.endsWith('/onsite-clock')&&parsedBody?{siteId:parsedBody.siteId,command:parsedBody.command}
                :(terminalShellMode||pinShellMode)&&url.pathname.endsWith('/terminals')&&parsedBody?.command?.action==='create'?{siteId:parsedBody.siteId,command:{action:'create',terminalId:parsedBody.command.terminalId,locationId:parsedBody.command.locationId,label:parsedBody.command.label}}
                :pinShellMode&&url.pathname.endsWith('/pin-credentials')&&parsedBody?{siteId:parsedBody.siteId,workerNo:parsedBody.workerNo,command:{action:parsedBody.command.action,operationId:parsedBody.command.operationId,expectedRevision:parsedBody.command.expectedRevision,workerId:parsedBody.command.workerId,employeeId:parsedBody.command.employeeId}}
                :pinShellMode&&url.pathname.endsWith('/terminal-clock')&&parsedBody?{workerNo:parsedBody.workerNo,command:parsedBody.command,operationId:parsedBody.operationId}:parsedBody;
              if(control.unsent===url.pathname&&r.method()==='POST'){
                assert(faultEndpoints.has(url.pathname),'attendance_shell_unexpected_fault_target');control.unsent=null;
                requests.push({path:url.pathname,method:r.method(),status:null,query:Object.fromEntries(url.searchParams),body:safeBody,fault:'before-handler'});
                return route.abort('connectionreset');
              }
              let response;
              if(url.pathname.startsWith('/api/merchant-enterprise/attendance/')){
                const name=url.pathname.slice('/api/merchant-enterprise/attendance/'.length),handler=handlers[name];assert(handler,'audit_shell_unexpected_attendance_route:'+name);
                response=await handler(request,{entitlement,...(name==='audit-export'?{allow:exportLimiter}:{})});
                assert.equal(response.headers.get('cache-control'),'private, no-store');
              }else{
                const identity=await resolveValidatedMerchantEnterpriseAuthContext(request);
                response=(!employee?serveAttendanceMerchantBootstrap(request,identity.user.id):null)??await transport.serveShell(request,identity.user.id);
              }
              const text=await response.text();
              const record={path:url.pathname,method:r.method(),status:response.status,query:Object.fromEntries(url.searchParams),body:safeBody};requests.push(record);
              if(control.lose===url.pathname&&r.method()==='POST'&&response.status===200){
                assert(faultEndpoints.has(url.pathname),'attendance_shell_unexpected_fault_target');control.lose=null;record.fault='after-sql';return route.abort('connectionreset');
              }
              if(url.pathname.endsWith('/audit-export')){
                const payload=JSON.parse(text);exports.push({page:route.request().frame().page(),...record,payload});
              }
              // Delay an exact page/endpoint/method only AFTER the actual
              // handler and SQL return. The browser may abort on unmount;
              // still attempt delivery and await settlement, never invent data.
              if(gate&&gate.page===r.frame().page()&&url.pathname===(gate.endpoint??'/api/merchant-enterprise/attendance/audit-export')&&r.method()===(gate.method??'GET')&&response.status===200){
                const current=gate;gate=null;record.fault='held-after-sql';current.ready.resolve(JSON.parse(text));await current.release.promise;
                try{await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:text});}
                finally{current.finished.resolve();heldGates.delete(current);}return;
              }
              await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:text});
            })();
            pendingRoutes.add(work);void work.finally(()=>pendingRoutes.delete(work)).catch(()=>{});
            return work.catch(async error=>{if(!route.request().failure()&&!route.request().frame().page().isClosed())errors.push(error.message);await route.abort().catch(()=>{});});
          });
          const page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>control.acceptDialogs?dialog.accept():dialog.dismiss());page.on('download',download=>downloads.push({page,download,deleted:false}));
          page.on('console',message=>{if(message.type()!=='error')return;
            if(browserDiagnostics.length<20)browserDiagnostics.push(redactDiagnostics(message.text()).slice(0,1800));
            for(const arg of message.args())void arg.evaluate(value=>value instanceof Error?value.stack:null).then(stack=>{if(stack&&browserDiagnostics.length<20)browserDiagnostics.push(redactDiagnostics(stack).slice(0,1800));}).catch(()=>{});
          });return page;
        };
        const admin=page=>page.getByRole('region',{name:'考勤配置管理',exact:true});
        const audit=page=>page.getByRole('region',{name:'考勤变更记录',exact:true});
        const scope=page=>page.getByRole('region',{name:'主管考勤范围',exact:true});
        const openOwner=async(page,mobile=false)=>{await page.goto(origin+'/'+site);await page.getByRole('button',{name:mobile?'企业':'企业管理',exact:true}).click();await page.getByRole('button',{name:'考勤配置',exact:true}).click();await admin(page).waitFor();};
        const post=async(page,endpoint,button)=>{const done=page.waitForResponse(r=>r.url().endsWith('/attendance/'+endpoint)&&r.request().method()==='POST'&&r.status()===200);await button.click();const response=await done;return response.json();};
        const openAudit=async(page,source='config')=>{if(!await audit(page).count())await admin(page).getByRole('button',{name:'查看考勤变更记录',exact:true}).click();await audit(page).getByRole('combobox',{name:/^记录类型/}).selectOption(source);};
        const readAudit=async(page,source)=>{await openAudit(page,source);const done=page.waitForResponse(r=>r.url().includes('/attendance/audit?')&&new URL(r.url()).searchParams.get('mode')==='list'&&r.status()===200);await audit(page).getByRole('button',{name:'查询变更记录',exact:true}).click();const response=await done;const result=await response.json();if(result.items.length)await audit(page).locator('article').nth(result.items.length-1).waitFor();return result;};
        const openScope=async page=>{await page.getByRole('button',{name:'主管考勤范围',exact:true}).click();await scope(page).getByRole('button',{name:/合成主管甲/}).click();await scope(page).getByRole('button',{name:'新增授权',exact:true}).waitFor();};
        const assertSqlRows=payload=>{
          const table=payload.source==='config'?'merchant_attendance_config_operations':'merchant_attendance_scope_operations';
          const rows=JSON.parse(exec(`select coalesce(jsonb_agg(to_jsonb(t) order by recorded_at desc,operation_id desc),'[]'::jsonb) from public.${table} t where merchant_id='${site}' and recorded_at>='${payload.fromAt}'::timestamptz and recorded_at<least('${payload.toAt}'::timestamptz,'${payload.asOf}'::timestamptz);`));
          assert.equal(payload.count,rows.length);assert.deepEqual(payload.rows.map(r=>r.item.operationId),rows.map(r=>r.operation_id));
          for(let n=0;n<rows.length;n++){
            const raw=rows[n],value=payload.rows[n];
            if(payload.source==='config'){
              const normalize=v=>{if(v===null)return null;if(raw.command.kind==='settings')return {timeZone:v.timeZone??v.time_zone,enabled:v.enabled,webClockEnabled:v.webClockEnabled??v.web_clock_enabled,webBreakPaid:v.webBreakPaid??v.web_break_paid};
                if(raw.command.kind==='location')return {id:v.id,name:v.name,timeZone:v.timeZone??v.time_zone,active:v.active};
                return {id:v.id,employeeId:v.employeeId??v.employee_id,workerNo:v.workerNo??v.worker_no,displayName:v.displayName??v.display_name,locationId:v.locationId??v.default_location_id,active:v.active,startsOn:v.startsOn??v.starts_on??null};};
              assert.deepEqual(value.before,normalize(raw.before_value));assert.deepEqual(value.after,normalize(raw.after_value));
            }else{
              const selected=v=>{const grant=v?.grants?.find(g=>g.id===raw.command.grantId);return grant?{...grant,validFrom:canonicalStoredInstant(grant.validFrom),validUntil:grant.validUntil===null?null:canonicalStoredInstant(grant.validUntil)}:null;};
              assert.deepEqual(value.before,selected(raw.before_value));assert.deepEqual(value.after,selected(raw.after_value));
            }
          }
        };
        const downloadCsv=async(page,source)=>{
          await openAudit(page,source);const first=exports.length,done=page.waitForEvent('download');
          await audit(page).getByRole('button',{name:'导出当前条件 CSV',exact:true}).click();const download=await done;
          const tracked=downloads.find(record=>record.download===download);assert(tracked,'audit_shell_download_record_required');
          try{
            const reply=exports.slice(first).find(r=>r.page===page&&r.status===200);assert(reply,'actual_export_response_required');
            const {payload}=reply;assert.equal(payload.source,source);assertSqlRows(payload);
            const parsed=parseAttendanceAuditExportResult(payload,{siteId:site,source,fromAt:payload.fromAt,toAt:payload.toAt}),expected=buildAttendanceAuditCsv(parsed);
            const stream=await download.createReadStream();assert(stream);const chunks=[];let bytes=0;
            for await(const chunk of stream){bytes+=chunk.length;assert(bytes<=2097152);chunks.push(chunk);}
            const file=Buffer.concat(chunks);assert.deepEqual([...file.subarray(0,3)],[239,187,191]);assert.equal(file.toString('utf8'),expected.csv);assert.equal(download.suggestedFilename(),expected.filename);
            const rows=csvRows(file.toString('utf8'));assert.equal(rows[0].length,17);assert.equal(rows.length,payload.count+1);
            for(const [n,row] of rows.slice(1).entries()){assert.equal(row.length,17);assert.equal(Number(row[6]),payload.count);assert.equal(row[7],payload.rows[n].item.operationId);assert.deepEqual(JSON.parse(row[15]),payload.rows[n].before);assert.deepEqual(JSON.parse(row[16]),payload.rows[n].after);}
            return payload;
          }finally{await bounded(deleteAttendanceDownloadOnce(tracked),'audit_shell_download_cleanup_timeout',5000);}
        };
        const owner=await newPage();await openOwner(owner);await admin(owner).getByRole('button',{name:'创建考勤配置',exact:true}).waitFor();assert.equal(configCount(),0);
        await post(owner,'admin',admin(owner).getByRole('button',{name:'创建考勤配置',exact:true}));assert.equal(configCount(),1);
        await admin(owner).getByRole('button',{name:'工作地点',exact:true}).click();await admin(owner).getByRole('button',{name:'新增地点',exact:true}).click();
        const oldPlace='合成,"门店"',newPlace='新址,"审计店"',workerName='合成,"审计人员"';
        await admin(owner).getByLabel('地点名称',{exact:true}).fill(oldPlace);await admin(owner).getByLabel('启用此地点',{exact:true}).check();await post(owner,'admin',admin(owner).getByRole('button',{name:'保存地点',exact:true}));
        await admin(owner).getByRole('button',{name:'考勤人员',exact:true}).click();await admin(owner).getByRole('button',{name:'新增考勤人员',exact:true}).click();await admin(owner).getByRole('button',{name:'选择已有员工',exact:true}).click();
        await admin(owner).getByText('合成员工乙',{exact:true}).locator('../..').getByRole('button',{name:'选择',exact:true}).click();
        await admin(owner).getByLabel('考勤显示名',{exact:true}).fill(workerName);await admin(owner).getByLabel('企业内工号',{exact:true}).fill('AUDIT-1');await admin(owner).getByLabel('在职起始日期',{exact:true}).fill('2000-01-01');
        await admin(owner).getByRole('button',{name:'选择工作地点',exact:true}).click();await admin(owner).getByText(oldPlace,{exact:true}).locator('../..').getByRole('button',{name:'选择',exact:true}).click();await admin(owner).getByLabel('启用此考勤人员',{exact:true}).check();await post(owner,'admin',admin(owner).getByRole('button',{name:'保存考勤人员',exact:true}));
        await admin(owner).getByRole('button',{name:'工作地点',exact:true}).click();await admin(owner).getByText(oldPlace,{exact:true}).locator('../..').getByRole('button',{name:'编辑',exact:true}).click();await admin(owner).getByLabel('地点名称',{exact:true}).fill(newPlace);await post(owner,'admin',admin(owner).getByRole('button',{name:'保存地点',exact:true}));
        assert.equal(configCount(),4);assert.equal(exec('select count(*) from public.merchant_attendance_events;'),'0');
        pass('actual AdminClient desktop enterprise navigation creates only explicitly confirmed synthetic settings/location/worker changes and an audited location rename; zero punches');

        await openScope(owner);await scope(owner).getByRole('button',{name:'新增授权',exact:true}).click();await scope(owner).getByRole('button',{name:new RegExp(workerName.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'))}).click();
        await scope(owner).getByRole('button',{name:'地点 0 / 50',exact:true}).click();await scope(owner).getByRole('button',{name:new RegExp(newPlace)}).click();
        await post(owner,'scopes',scope(owner).getByRole('button',{name:'保存此条授权',exact:true}));assert.equal(scopeCount(),1);
        await scope(owner).getByRole('button',{name:'查看／编辑',exact:true}).click();await scope(owner).getByRole('button',{name:'刷新已选名称',exact:true}).click();await scope(owner).getByText('名称为当前信息；保存仍按唯一编号核验。',{exact:true}).waitFor();await scope(owner).getByRole('button',{name:'取消编辑',exact:true}).click();
        assert.equal(scopeCount(),1);let baseline=facts();
        pass('actual scope controls select one manager/worker/location, save one grant, and reread selected names without another authorization write');

        await owner.getByRole('button',{name:'考勤配置',exact:true}).click();const list=await readAudit(owner,'config');assert.equal(list.items.length,4);
        const renamed=audit(owner).locator('article').filter({hasText:'工作地点 · 版本 4'});const detailDone=owner.waitForResponse(r=>r.url().includes('/attendance/audit?')&&new URL(r.url()).searchParams.get('mode')==='detail'&&r.status()===200);await renamed.getByRole('button',{name:'查看修改前后',exact:true}).click();await detailDone;await renamed.getByText(oldPlace,{exact:true}).waitFor();await renamed.getByText(newPlace,{exact:true}).waitFor();
        const config=await downloadCsv(owner,'config');assert(config.rows.some(row=>row.before?.name===oldPlace&&row.after?.name===newPlace));assert(config.rows.some(row=>row.after?.displayName===workerName));
        await readAudit(owner,'scope');const grants=await downloadCsv(owner,'scope');assert.equal(grants.count,1);assert.equal(grants.rows[0].item.kind,'grant_put');assert.equal(facts(),baseline);
        pass('actual browser config and scope CSV downloads match exact response bytes, SQL historical values, count/order, BOM/CRLF and quoted comma/JSON escaping; reads preserve every fact fingerprint');

        transport.state.moduleEnabled=false;exportLimiter=createAttendanceAuditExportLimiter();
        const phone=await newPage({mobile:true});await openOwner(phone,true);await admin(phone).getByText(/平台尚未开放或已暂停新考勤/).waitFor();await readAudit(phone,'config');const paused=await downloadCsv(phone,'config');assert.equal(paused.moduleEnabled,false);assert(await phone.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.equal(facts(),baseline);
        await openScope(owner);await scope(owner).getByText('平台暂停新授权；可查看和撤销已有范围。',{exact:true}).waitFor();assert(await scope(owner).getByRole('button',{name:'新增授权',exact:true}).isDisabled());
        await scope(owner).getByRole('button',{name:'撤销此条',exact:true}).click();await post(owner,'scopes',scope(owner).getByRole('button',{name:'确认撤销',exact:true}));assert.equal(scopeCount(),2);assert.equal(exec('select count(*) from public.merchant_attendance_scope_grants;'),'0');assert.equal(configCount(),4);baseline=facts();
        await readAudit(phone,'scope');const removed=await downloadCsv(phone,'scope');assert.equal(removed.count,2);assert.equal(removed.rows[0].item.kind,'grant_remove');assert(removed.rows[0].before);assert.equal(removed.rows[0].after,null);assert.equal(facts(),baseline);assert(await phone.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
        pass('390px real merchant shell reads/downloads audit while paused; desktop confirmed revoke remains available and mobile scope CSV records exact grant removal without changing configuration or punch facts');

        exportLimiter=createAttendanceAuditExportLimiter();await owner.getByRole('button',{name:'考勤配置',exact:true}).click();await openAudit(owner,'config');
        for(const scenario of ['filter','unmount','hidden']){
          await openAudit(owner,'config');const before=downloads.length,current={page:owner,ready:deferred(),release:deferred(),finished:deferred()};gate=current;heldGates.add(current);
          await audit(owner).getByRole('button',{name:'导出当前条件 CSV',exact:true}).click();await bounded(current.ready.promise,'audit_shell_held_sql_timeout');
          if(scenario==='filter')await audit(owner).getByRole('combobox',{name:/^记录类型/}).selectOption('scope');
          else if(scenario==='unmount')await admin(owner).getByRole('button',{name:'收起考勤变更记录',exact:true}).click();
          else await owner.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});document.dispatchEvent(new Event('visibilitychange'));});
          current.release.resolve();await bounded(current.finished.promise,'audit_shell_held_response_timeout');
          if(scenario==='hidden')await owner.evaluate(()=>{delete document.visibilityState;document.dispatchEvent(new Event('visibilitychange'));});
          // Flush browser tasks after the gated route has actually completed;
          // no sleep-based success and no synthetic export response.
          await owner.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));assert.equal(downloads.length,before);assert.equal(facts(),baseline);
        }
        pass('real SQL export responses held until filter change, audit unmount or synthetic visibilitychange cannot dispatch a stale download; each release is awaited');

        exportLimiter=createAttendanceAuditExportLimiter();const employee=await newPage({actor:actors[1]});await employee.goto(origin+'/harness.css');
        const employeeReply=await employee.evaluate(async query=>{const r=await fetch('/api/merchant-enterprise/attendance/audit-export?'+new URLSearchParams(query));return {status:r.status,body:await r.json()};},{siteId:site,source:'config',fromAt:config.fromAt,toAt:config.toAt});assert.equal(employeeReply.status,403);assert.equal(employeeReply.body.error,'attendance_access_denied');assert.equal('rows' in employeeReply.body,false);assert.equal(facts(),baseline);
        await readAudit(owner,'config');await readAudit(phone,'config');const oldDownloads=downloads.length;
        // This older owner contract accepts seven aliases. Clear ALL of them,
        // not just user_id, so this is a genuine current-binding revocation.
        exec(`update public.merchants set user_id='${id(98)}',auth_user_id=null,owner_user_id=null,owner_id=null,auth_id=null,created_by=null,created_by_user_id=null where id='${site}';`);
        try{
          for(const page of [owner,phone]){const denied=page.waitForResponse(r=>r.url().includes('/attendance/audit-export?')&&r.status()===403);await audit(page).getByRole('button',{name:'导出当前条件 CSV',exact:true}).click();await denied;await audit(page).getByText('当前身份或权限不能访问考勤，请重新登录或联系企业负责人。',{exact:true}).waitFor();assert.equal(await audit(page).locator('article').count(),0);}
          assert.equal(downloads.length,oldDownloads);assert.equal(facts(),baseline);
        }finally{exec(`update public.merchants set user_id='${actors[0].id}' where id='${site}';`);}
        pass('employee direct export is denied and both previously authorized desktop/mobile owners lose export plus old audit content after all owner bindings change; no new download or fact write');

        let controlsProof=null,locationProof=null,reportProof=null,missingManagerProof=null;
        if(controlsMode){
          const {checkAttendanceControlsShell}=await import('./merchant-attendance-controls-shell-checks.mjs');
          controlsProof=await checkAttendanceControlsShell({owner,phone,newPage,openOwner,admin,exec,transport,requests,pass,origin,site,actors,id,control,holdControlsResponse});
          assert.equal(controlsProof.configCountBefore,4);assert.equal(controlsProof.configCountAfter,6);assert.equal(controlsProof.configWritesAdded,2);
          assert.equal(new Set(controlsProof.configOperationIds).size,2);assert.equal(controlsProof.settingsVersionAfter,controlsProof.settingsVersionBefore+2);
          assert.equal(controlsProof.settingsValuesRestored,true);assert.equal(controlsProof.protectedFactsAfter,controlsProof.protectedFactsBefore);
          assert.equal(controlsProof.controlsCount,10);assert.equal(controlsProof.controlsPostCount,18);
          const navigationProof=controlsProof.navigationProof;assert.equal(navigationProof.controlsCountBefore,8);assert.equal(navigationProof.controlsCountAfter,10);
          assert.equal(navigationProof.controlsPostCountBefore,14);assert.equal(navigationProof.controlsPostCountAfter,17);
          assert.equal(new Set(navigationProof.operationIds).size,2);assert.equal(navigationProof.policyValuesRestored,true);assert.equal(navigationProof.periodsUnchanged,true);
        }
        if(correctionFlowMode){
          const {checkAttendanceCorrectionFlowShell}=await import('./merchant-attendance-correction-flow-shell-checks.mjs');
          reportProof=await checkAttendanceCorrectionFlowShell({owner,phone,newPage,openOwner,admin,exec,transport,requests,pass,origin,site,actors,id,control,holdCorrectionResponse,downloads,csvRows});
          assert.equal(reportProof.scopeCountBefore,2);assert.equal(reportProof.scopeCountAfter,4);assert.equal(reportProof.scopeWrites,2);
          assert.equal(reportProof.sourceReadReceipts,4);assert.equal(reportProof.actualDownloads,3);assert.equal(reportProof.businessFactsUnchanged,true);
        }
        if(missingFlowMode){
          const {checkAttendanceMissingFlowShell}=await import('./merchant-attendance-missing-flow-shell-checks.mjs');
          const proof=await checkAttendanceMissingFlowShell({owner,newPage,openOwner,admin,exec,transport,requests,pass,origin,site,actors,id,control,holdCorrectionResponse,downloads,csvRows});
          assert.equal(proof.requests,2);assert.equal(proof.entries,4);assert.equal(proof.downloads,3);assert.equal(proof.sourceReads,4);
          assert.equal(proof.originalFactsUnchanged,true);
          const {checkAttendanceMissingManagerShell}=await import('./merchant-attendance-missing-manager-shell-checks.mjs');
          missingManagerProof=await checkAttendanceMissingManagerShell({owner,newPage,openOwner,exec,transport,requests,pass,origin,site,actors,id,holdCorrectionResponse,downloads,csvRows});
          assert.equal(missingManagerProof.scopeCountBefore,4);assert.equal(missingManagerProof.scopeCountAfter,6);assert.equal(missingManagerProof.scopeWrites,2);
          assert.equal(missingManagerProof.sourceReadsAdded,2);assert.equal(missingManagerProof.downloadsAdded,1);assert.equal(missingManagerProof.businessFactsUnchanged,true);
        }
        if(terminalShellMode){
          const {checkAttendanceTerminalShell}=await import('./merchant-attendance-terminal-shell-checks.mjs');
          const proof=await checkAttendanceTerminalShell({owner,newPage,openOwner,admin,exec,transport,requests,pass,origin,site,actors,control});
          assert.equal(proof.events,2);assert.equal(proof.onsiteReceipts,2);assert.equal(proof.terminalAudit,3);
          assert.equal(proof.configCount,5);assert.equal(proof.revoked,true);assert.equal(proof.originalFactsUnchanged,true);
        }
        if(pinShellMode){
          const {checkAttendancePinShell}=await import('./merchant-attendance-pin-shell-checks.mjs');
          const proof=await checkAttendancePinShell({owner,newPage,openOwner,admin,exec,transport,requests,pass,origin,site,actors,control});
          assert.equal(proof.events,4);assert.equal(proof.pinReceipts,4);assert.equal(proof.pinAudit,3);assert.equal(proof.terminalAudit,3);
          assert.equal(proof.configCount,5);assert.equal(proof.revoked,true);assert.equal(proof.originalFactsUnchanged,true);
        }
        if(locationSettingsMode){
          const {checkAttendanceLocationShell}=await import('./merchant-attendance-location-shell-checks.mjs');
          locationProof=await checkAttendanceLocationShell({owner,phone,newPage,openOwner,admin,exec,transport,requests,pass,origin,site,actors,id,control,holdLocationSettingsResponse});
          assert.equal(locationProof.configCountBefore,5);assert.equal(locationProof.configCountAfter,6);assert.equal(locationProof.configWritesAdded,1);
          assert.equal(locationProof.locationCount,2);assert.equal(locationProof.otherLocationUnchanged,true);
          const versionProof=locationProof.versionProof;assert.equal(versionProof.configCountBefore,locationProof.configCountAfter);
          assert.equal(versionProof.configCountAfter,9);assert.equal(versionProof.configWritesAdded,3);assert.equal(new Set(versionProof.configOperationIds).size,3);
          assert.equal(versionProof.settingsVersionAfter,versionProof.settingsVersionBefore+3);assert.equal(versionProof.locationRowsUnchanged,true);
        }
        if(employeeLocationMode){
          const {checkAttendanceEmployeeLocationShell}=await import('./merchant-attendance-employee-location-shell-checks.mjs');
          await checkAttendanceEmployeeLocationShell({owner,phone,newPage,openOwner,admin,exec,transport,requests,pass,origin,site,actors,id,control});
        }
        if(locationExceptionsMode){
          const {checkAttendanceLocationExceptionsShell}=await import('./merchant-attendance-location-exceptions-shell-checks.mjs');
          await checkAttendanceLocationExceptionsShell({owner,phone,newPage,openOwner,admin,exec,transport,requests,pass,origin,site,actors,id,control});
          const {checkAttendanceExceptionRecoveryShell}=await import('./merchant-attendance-exception-recovery-shell-checks.mjs');
          await checkAttendanceExceptionRecoveryShell({owner,newPage,admin,exec,requests,pass,origin,site,actors,control,holdExceptionResponse});
          const {checkAttendanceExceptionNavigationShell}=await import('./merchant-attendance-exception-navigation-shell-checks.mjs');
          await checkAttendanceExceptionNavigationShell({owner,admin,newPage,exec,transport,requests,pass,origin,site,actors,control});
        }

        const attendanceEvents=Number(exec('select count(*) from public.merchant_attendance_events;'));
        if(!employeeShellMode){assert.equal(configCount(),locationProof?locationProof.versionProof.configCountAfter:controlsProof?controlsProof.configCountAfter:4);assert.equal(attendanceEvents,0);}
        if(correctionFlowMode){assert.equal(configCount(),5);assert.equal(attendanceEvents,4);}
        if(terminalShellMode){assert.equal(configCount(),5);assert.equal(attendanceEvents,2);}
        if(pinShellMode){assert.equal(configCount(),5);assert.equal(attendanceEvents,4);}
        assert.equal(scopeCount(),missingManagerProof?missingManagerProof.scopeCountAfter:reportProof?reportProof.scopeCountAfter:2);
        if(controlsProof){
          const previous=JSON.parse(baseline),current=JSON.parse(facts());
          assert.notEqual(current.config,previous.config);assert.deepEqual({...current,config:previous.config},previous);
        }else if(!locationSettingsMode&&!employeeShellMode)assert.equal(facts(),baseline);
        assert(requests.filter(r=>r.method==='POST'&&!r.path.startsWith('/api/merchant-enterprise/attendance/')).every(r=>
          r.path==='/api/merchant-operation-logs'&&r.status===403
          ||employeeShellMode&&r.path==='/api/merchant-enterprise/employees/accept'&&r.status===200
            &&JSON.stringify(r.body)===JSON.stringify({siteId:site})));
        assert(requests.filter(r=>r.method==='POST'&&r.path.startsWith('/api/merchant-enterprise/attendance/')).every(r=>
          ['/api/merchant-enterprise/attendance/admin','/api/merchant-enterprise/attendance/scopes'].includes(r.path)&&r.status===200
          ||terminalShellMode&&['/api/merchant-enterprise/attendance/terminals','/api/merchant-enterprise/attendance/terminal-device','/api/merchant-enterprise/attendance/onsite-code'].includes(r.path)&&[200,403].includes(r.status)
          ||pinShellMode&&['/api/merchant-enterprise/attendance/terminals','/api/merchant-enterprise/attendance/terminal-device'].includes(r.path)&&[200,403].includes(r.status)
          ||faultEndpoints.has(r.path)&&([200,403,409].includes(r.status)||r.status===null&&r.fault==='before-handler')));
        assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert.deepEqual(transport.errors,[]);
        console.log(JSON.stringify({actualAdminClient:true,actualAttendanceHandlers:true,defaultExecutors:true,realServiceRoleSql:true,realAuthService:false,realNextServer:false,syntheticEnterpriseBootstrap:true,syntheticOwnerCookie:true,syntheticAndroidVersion404:true,syntheticVisibilityTransition:true,isolatedRealLimiterPerScenario:true,quotaTimingTest:false,explicitTransportAdapter:true,actualDownloadsRead:true,...(controlsMode?{actualCorrectionControlsShell:true}:{}),...(locationSettingsMode?{actualLocationSettingsShell:true}:{}),...(employeeLocationMode?{actualEmployeeLocationShell:true,syntheticGeolocationOnly:true}:{}),...(locationExceptionsMode?{actualLocationExceptionsShell:true}:{}),savedExports:0,externalRequests:0,productionWrites:0,attendanceEvents}));
        }finally{
          // Stop new browser requests BEFORE the Auth fixture restores global
          // fetch/environment, then settle every already-started route while
          // its synthetic credentials/transport are still installed.
          transportClosing=true;gate?.release.resolve();gate=null;for(const current of heldGates)current.release.resolve();
          await bounded(Promise.allSettled([...pendingRoutes]),'audit_shell_auth_routes_cleanup_timeout');
        }
      });
    }catch(error){
      console.error('AUDIT_SHELL_TRANSPORT_ERRORS',[...new Set(errors)].slice(0,8).map(redactDiagnostics));
      console.error('AUDIT_SHELL_BROWSER_DIAGNOSTICS',[...new Set(browserDiagnostics)].slice(-8));
      console.error('AUDIT_SHELL_RECENT_REQUESTS',requests.slice(-12).map(({path,method,status})=>({path,method,status})));
      if(browser)for(const context of browser.contexts())for(const page of context.pages()){
        // Synthetic fixture only. Omit URL query/fragment, cookies and tokens.
        const current=new URL(page.url());
        console.error('AUDIT_SHELL_FAILURE',current.origin+current.pathname,redactDiagnostics(await bounded(page.locator('body').innerText().catch(()=>''),'audit_shell_failure_dom_timeout',3000).catch(()=>'')).slice(-2200));
      }
      throw error;
    }
    finally{
      for(const [name,value] of savedFlags){if(value===undefined)delete process.env[name];else process.env[name]=value;}
      if(terminalShellMode){if(savedOnsiteSecret===undefined)delete process.env[onsiteSecretKey];else process.env[onsiteSecretKey]=savedOnsiteSecret;}
      if(pinShellMode){if(savedPinPepper===undefined)delete process.env[pinPepperKey];else process.env[pinPepperKey]=savedPinPepper;}
      control.lose=null;control.unsent=null;control.acceptDialogs=true;
      gate?.release.resolve();gate=null;for(const current of heldGates)current.release.resolve();
      await runAttendanceCleanupSteps([
        ...downloads.filter(record=>!record.deleted).map((record,index)=>({name:`download-${index}`,timeoutMs:5000,run:()=>deleteAttendanceDownloadOnce(record)})),
        {name:'browser',run:()=>browser?.close()},
        {name:'routes',run:()=>Promise.allSettled([...pendingRoutes])},
        {name:'harness',timeoutMs:10000,run:async()=>{
          if(child.pid!==undefined&&child.exitCode===null&&child.signalCode===null){const stopped=once(child,'exit');child.kill();await stopped;}
        }},
      ]);
    }
  });
}
await runAttendanceLabelsReuse(process.argv.slice(2).filter(arg=>!['--controls','--correction-flow','--missing-flow','--terminal-shell','--pin-shell','--location-settings','--employee-location','--location-exceptions'].includes(arg)),check).catch(error=>{console.error(redactDiagnostics(error?.stack??String(error)));process.exitCode=1;});
