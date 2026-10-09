// Pure/static tests only. No Chromium, listener or database is started here.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {assertCompactShiftRuleBrowserData,checkAttendanceShiftRuleViewBrowser} from './merchant-attendance-shift-rule-view-browser-check.mjs';
import {prepareShiftRuleViewNativeFixture} from './fixtures/attendance-shift-rule-view-native.mjs';

const runner=readFileSync(new URL('./merchant-attendance-shift-rule-view-browser-check.mjs',import.meta.url),'utf8');
const fixture=readFileSync(new URL('./fixtures/attendance-shift-rule-view-browser.tsx',import.meta.url),'utf8');
const native=readFileSync(new URL('./fixtures/attendance-shift-rule-view-native.mjs',import.meta.url),'utf8');

test('import exposes bounded explicit functions, never invokes an acceptance or runtime automatically',()=>{
  assert.equal(typeof checkAttendanceShiftRuleViewBrowser,'function');assert.equal(typeof prepareShiftRuleViewNativeFixture,'function');
  assert.doesNotMatch(runner,/process\.argv|await checkAttendanceShiftRuleViewBrowser\(/);
  assert.doesNotMatch(native,/checkAttendanceBoundClocksNative|checkAttendanceShiftRuleBindingReaderNative|prepareSourcesNativeFixture|\b(?:spawn|execSync|createServer|listen)\s*\(/);
  assert.match(native,/prepareBoundClocksNativeFixture\(native,scope\)/);
});

test('compact-response audit checks nested bodies and permits needed immutable provenance',()=>{
  assert.doesNotThrow(()=>assertCompactShiftRuleBrowserData({data:{status:'verified',binding:{requestAuthUserId:'uuid'},evidence:{sourceSha256:'abc',fields:{trace:[{source:{actorId:'uuid'}}]}}}}));
  for(const key of ['sourceText','sourceGraph','history'])assert.throws(()=>assertCompactShiftRuleBrowserData({data:{evidence:{nested:[{[key]:{}}]}}}),new RegExp(`compact_view_leaked_${key}`));
  assert.doesNotThrow(()=>assertCompactShiftRuleBrowserData(null));
});

test('native setup uses actual128 after dependencies and exactly three actual self cycles, not old suites',()=>{
  for(const marker of ['sourcesNativeDependencies','faolla_schema_migrations where version=','202610040128_merchant_attendance_sources.sql','202610040133_merchant_attendance_shift_rule_bindings.sql',
    '202610040134_merchant_attendance_bound_clocks.sql','202610040135_merchant_attendance_shift_rule_binding_reader.sql','executeAttendanceSelf','boundClockRpcExpression(name,args)',
    "clock('clock_in',0)","clock('clock_out',1)","clock('clock_in',2)","clock('clock_out',3)","clock('clock_in',4)","clock('clock_out',5)",
    'events:6,bindings:2,sources:1','parseSourcesResult(readRaw(),query,owner)','parseSourcesResult(readRaw(emptyQuery),emptyQuery,owner)'])assert(native.includes(marker),marker);
  assert.match(native,/finally\{for\(const \[key,value\] of previous\)/);
  assert.doesNotMatch(native,/disable\s+trigger|session_replication_role|update public\.merchant_attendance_events|boundClock(?:Quota|PersonalDensity)Seed/);
});

test('actual child and parent receive memory seeds using safe initScript arguments, not inline JSON markup',()=>{
  assert.match(fixture,/import ShiftRuleReview from "\.\.\/\.\.\/src\/components\/enterprise\/MerchantAttendanceShiftRuleReview"/);
  assert.match(fixture,/import SourcesPanel from "\.\.\/\.\.\/src\/components\/enterprise\/MerchantAttendanceSourcesPanel"/);
  assert.match(runner,/context\.addInitScript\(seed=>/);assert.match(runner,/source:data\.source,emptySource:data\.emptySource/);
  assert.doesNotMatch(fixture,/dangerouslySetInnerHTML|JSON\.parse|localStorage|sessionStorage|sourceText/);
  assert.match(fixture,/enabled=\{enabled \? true : seed\.flagOffRun \? undefined : false\}/);
});

test('two memory-only bundles test genuinely absent frontend flag as well as actual parent flag1',()=>{
  assert.match(runner,/bundle:true,write:false,metafile:true/);assert.match(runner,/const off=await build/);
  assert.match(runner,/process\.env\.NEXT_PUBLIC_FAOLLA_ATTENDANCE_SHIFT_RULE_BINDING_READ_ENABLED/);
  assert.match(runner,/browser_imported_server_validation/);assert.match(runner,/node:crypto/);
  assert.doesNotMatch(runner,/writeFile|mkdir|createWriteStream/);
});

test('transport uses only actual GET handlers and service SQL with compact parsing and every-read fingerprints',()=>{
  for(const marker of ['handleShiftRuleView','executeShiftRuleView','handleSources','executeSources',"faolla_attendance_shift_rule_binding_v1",'data.readRaw(args.p_query,args.p_auth_user_id)',
    "request.method(),'GET'",'request.postData(),null','parseShiftRuleViewResponse(parsed','<=32768','view_browser_read_changed_facts','data.fingerprint(),baseline','data.definitions(),definitions'])assert(runner.includes(marker),marker);
  assert.match(runner,/requests\.length<40/);assert.match(runner,/realAuth:false/);assert.match(runner,/sourceTextSentToBrowser:false/);
});

test('lifecycle fixture and checks include late source api owner visibility body selection and close without auto-reading',()=>{
  for(const key of ['source-change','worker-change','owner-change','api-change','hide','show','pagehide','pageshow','unmount','mount','arm-body','release-body','epoch']){
    assert(fixture.includes(`data-testid="${key}"`),key);assert(runner.includes(`'${key}'`),key);
  }
  for(const marker of ['gate.release.resolve()','late.release.resolve()','automatic_shift_rule_request',"data-shift-rule-status=\"missing\"",'关闭资料核查',"fill('')",'originalVsSelectedCorrectionBrowserTested:false'])assert(runner.includes(marker),marker);
});

test('390px screenshot is optional memory callback and escaped source names do not create images',()=>{
  assert.match(runner,/typeof options\.captureScreenshot==='function'/);assert.match(runner,/options\.captureScreenshot\(await page\.screenshot\(\{fullPage:true\}\)\)/);
  assert.match(runner,/scrollWidth<=innerWidth/);assert.match(runner,/scrollWidth<=element\.clientWidth\+1/);
  assert.match(native,/<img src=x onerror=alert\(1\)>/);assert.match(runner,/parent\.innerText\(\)\)\.includes\('Current group <img/);
  assert.match(runner,/page\.locator\('img'\)\.count\(\),0/);
});

test('cleanup closes browser, settles released interceptions and closes only its own loopback listener',()=>{
  assert.match(runner,/finally\{\s*closing=true;for\(const gate of gates\)gate\.release\.resolve\(\)/);
  assert.match(runner,/runAttendanceCleanupSteps/);assert.match(runner,/await browser\?\.close\(\)/);
  assert.match(runner,/bounded\(Promise\.allSettled\(\[\.\.\.pending\]\)\)/);assert.match(runner,/server\.closeAllConnections\(\)/);
  assert.match(runner,/server\.listen\(0,'127\.0\.0\.1'/);assert.match(runner,/newCluster:false/);
  assert.match(runner,/storageWrites:0,externalRequests:0/);assert.match(runner,/fullAdminE2E:false/);
});
