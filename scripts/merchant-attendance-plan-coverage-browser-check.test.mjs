// Static/inert only. Root separately runs the real Chromium + owned SQL chain.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {checkAttendancePlanCoverageBrowser} from './merchant-attendance-plan-coverage-browser-check.mjs';
const source=readFileSync(new URL('./merchant-attendance-plan-coverage-browser-check.mjs',import.meta.url),'utf8');
const fixture=readFileSync(new URL('./fixtures/attendance-plan-coverage-browser.tsx',import.meta.url),'utf8');

test('browser import is inert and only consumes the existing caller-owned namespace',()=>{
  assert.equal(typeof checkAttendancePlanCoverageBrowser,'function');assert.match(source,/assert.equal\(scope.sql,d.sql\)/);
  assert.doesNotMatch(source,/prepareBoundClocks|preparePlanCoverageNative|runAttendanceLabelsReuse|spawn\(|writeFile|mkdir/);
  assert.match(source,/checks,6/);assert.match(source,/fullAdminE2E:false/);
});
test('memory bundle and CSP prohibit archive bytes and Node server imports',()=>{
  for(const marker of ['write:false','metafile:true',"platform:'browser'",'node:crypto','assertShiftCheckBrowserProjection(parsed)','parsePlanCoverageResponse(parsed',
    'context.addInitScript(seed=>',"connect-src 'self'","request.method(),'GET'",'request.postData(),null'])assert(source.includes(marker),marker);
  assert.doesNotMatch(source,/JSON.stringify\(d.source\).*<\/script>/);assert.match(source,/Buffer.byteLength\(body,'utf8'\)<=1048576/);
});
test('actual parent and new component use real128 and139 handlers services and RPC bridges',()=>{
  for(const marker of ['<SourcesPanel','<PlanCoverage','ownerId={owner}','apiFetch={apiFetch}'])assert(fixture.includes(marker),marker);
  for(const marker of ['handlePlanCoverage','executePlanCoverage(input,service)','handleSources','executeSources(input,service)',
    'd.readSourceRaw(args.p_query,args.p_auth_user_id)','d.readRaw(args.p_query,args.p_auth_user_id)','actual128Parent:true','actual139HandlerService:true'])assert(source.includes(marker),marker);
  assert.match(source,/historicalSourceQuery.fromDate/);assert.match(source,/source:d.historicalSource,otherSource:d.source/);
  assert.doesNotMatch(source,/d\.anchors|d\.query\.fromDate|data-rule-status/);
});
test('stale parent accepts real095 replacement and actual111 end099 cancellation, not forged response geometry',()=>{
  for(const marker of ['d.reviseHistorical(true)','await d.finishCurrent()','d.cancel(d.slots.future)','baseline=d.fingerprint()',
    "prior.selected.coveredUs,'1800000000'","changed.selected.coveredUs,'3600000000'",'cancelled.slot.cancelled,true',
    'explicitFixtureWrites:{approvedRevisions:1,clockEvents:1,scheduleCancellations:1}','syntheticHistoricalPlan:true','syntheticHistoricalEvents:4','syntheticHistoricalRelations:2',
    'readParent(page,d.sourceQuery)','realPastPublication:false'])assert(source.includes(marker),marker);
  assert.doesNotMatch(source,/parsed\.data\s*=|parsed\.data\.sessions\s*=/);
});
test('defaultoff, explicit selection, empty unverified paused and390px claims have actual assertions',()=>{
  for(const marker of ['NEXT_PUBLIC_FAOLLA_ATTENDANCE_PLAN_COVERAGE_ENABLED','assert.equal(await panel(page).count(),0)',"selection(page).inputValue(),''",
    'scrollWidth<=innerWidth','},390)',"empty.sessions.length,0",'legacy.original.unverifiedIds.length,1','moduleEnabled=false',
    "authMode=mode",'401:403','storageWrites:0','externalRequests:0'])assert(source.includes(marker),marker);
  assert.match(source,/assert.equal\(d.fingerprint\(\),facts/);assert.match(source,/readFingerprintsUnchanged:true/);
});
test('real transport and body gates exercise all requested lifetime boundaries',()=>{
  for(const marker of ['gate.ready.resolve(parsed)','await gate.release.promise',"control(page,'hide')","control(page,'pagehide')","control(page,'unmount')",
    "['source-change','api-change','epoch']","control(page,'worker-change')","control(page,'owner-change')","getByLabel('核查开始日期').fill('')",
    "selection(page).inputValue(),d.slots.zero.id"] )assert(source.includes(marker),marker);
  assert.match(fixture,/new Uint8Array\(await response.arrayBuffer\(\)\)/);assert.match(fixture,/await held.promise/);
  assert.match(fixture,/useLayoutEffect\(\(\)=>\(\)=>gate.current\?\.release\(\),\[\]\)/);
});
test('bounded cleanup closes Chromium interceptions and exact loopback; optional screenshot stays viewport-sized',()=>{
  for(const marker of ['finally{closing=true','gate.release.resolve()','runAttendanceCleanupSteps','await browser?.close()',
    'Promise.allSettled([...pending])','server.closeAllConnections()','server.close(error=>','options.captureScreenshot(await page.screenshot({fullPage:false}))'])assert(source.includes(marker),marker);
  assert.match(source,/server.listen\(0,'127.0.0.1'/);assert.match(source,/request.headers.host!==new URL\(origin\).host/);
});
