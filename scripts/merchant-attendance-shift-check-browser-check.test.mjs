// Static/inert checks only. Root separately runs the actual Chromium/SQL chain.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {checkAttendanceShiftCheckBrowser} from './merchant-attendance-shift-check-browser-check.mjs';
const source=readFileSync(new URL('./merchant-attendance-shift-check-browser-check.mjs',import.meta.url),'utf8');
const fixture=readFileSync(new URL('./fixtures/attendance-shift-check-browser.tsx',import.meta.url),'utf8');
test('browser import is inert and fixture stays in the same caller-owned namespace',()=>{
  assert.equal(typeof checkAttendanceShiftCheckBrowser,'function');assert.match(source,/assert.equal\(scope.sql,d.sql\)/);
  assert.doesNotMatch(source,/prepareBoundClocks|prepareShiftCheckNative|runAttendanceLabelsReuse|spawn\(|writeFile|mkdir/);
  assert.match(source,/checks,6/);assert.match(source,/fullAdminE2E:false/);
});
test('memory bundle and CSP keep source text and server crypto out of browser inputs',()=>{
  for(const marker of ['write:false','metafile:true',"platform:'browser'",'node:crypto','assertShiftCheckBrowserProjection(parsed)','parseShiftCheckResponse(parsed',
    'context.addInitScript(seed=>','connect-src \'self\'','request.method(),\'GET\'','request.postData(),null'])assert(source.includes(marker));
  assert.doesNotMatch(source,/JSON.stringify\(d.source\).*<\/script>/);assert.match(source,/Buffer.byteLength\(body,'utf8'\)<=1048576/);
});
test('actual SourcesPanel and child invoke both real services and SQL bridges',()=>{
  for(const marker of ['<SourcesPanel','<ShiftCheck','ownerId={owner}','apiFetch={apiFetch}'])assert(fixture.includes(marker));
  for(const marker of ['handleShiftCheck','executeShiftCheck(input,service)','handleSources','executeSources(input,service)','d.readSourceRaw(args.p_query,args.p_auth_user_id)',
    'd.readRaw(args.p_query,args.p_auth_user_id)','actual128Parent:true','actual138HandlerService:true'])assert(source.includes(marker));
  assert.match(source,/if\(!source&&response.ok\)/);assert.match(source,/detailReads\+\+/);
});
test('stale real parent correction and open end are superseded by real original writers, not mocked response edits',()=>{
  for(const marker of ['d.approveRevision(120)','await d.finishOpen()','baseline=d.fingerprint()','explicitFixtureWrites:{approvedRevisions:1,clockEvents:2}',
    "includes('核定修订 2')",'priorHash',"data-shift-check-open=\"not_applicable\"",'actualLater095Revision:true','actualLater111End:true'])assert(source.includes(marker));
  assert.doesNotMatch(source,/parsed\.data\s*=|parsed\.data\.effect\s*=/);
});
test('browser cases assert defaultoff, zero auto reads,390px bounds and readonly failures',()=>{
  for(const marker of ['NEXT_PUBLIC_FAOLLA_ATTENDANCE_SHIFT_CHECK_ENABLED','assert.equal(await panel(page).count(),0)',"selection(page).inputValue(),''",
    'scrollWidth<=innerWidth',"},390)","authMode=mode",'401:403','storageWrites:0','externalRequests:0'])assert(source.includes(marker));
  assert.match(source,/assert.equal\(d.fingerprint\(\),facts/);assert.match(source,/readFingerprintsUnchanged:true/);
});
test('transport and body gates are real responses and all lifetime boundaries clear details',()=>{
  for(const marker of ['gate.ready.resolve(parsed)','await gate.release.promise',"control(page,'hide')","control(page,'pagehide')","control(page,'unmount')",
    "['source-change','api-change','epoch']","control(page,'worker-change')","control(page,'owner-change')","getByLabel('核查开始日期').fill('')"] )assert(source.includes(marker));
  assert.match(fixture,/new Uint8Array\(await response.arrayBuffer\(\)\)/);assert.match(fixture,/await held.promise/);
  assert.match(fixture,/useLayoutEffect\(\(\)=>\(\)=>gate.current\?\.release\(\),\[\]\)/);
});
test('bounded finally closes Chromium pending interceptions and exact loopback server',()=>{
  for(const marker of ['finally{closing=true','gate.release.resolve()','runAttendanceCleanupSteps','await browser?.close()',
    'Promise.allSettled([...pending])','server.closeAllConnections()','server.close(error=>','options.captureScreenshot(await page.screenshot'])assert(source.includes(marker));
  assert.match(source,/server.listen\(0,'127.0.0.1'/);assert.match(source,/request.headers.host!==new URL\(origin\).host/);
});
