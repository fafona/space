import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {assertOwnerBacklogBrowserPage} from './merchant-attendance-owner-backlog-browser-check.mjs';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const query={siteId:'99990001',kind:'all',asOf:null,cursorAt:null,cursorKind:null,cursorId:null};
const make=()=>({ok:true,moduleEnabled:false,protocol:'owner-backlog-v1',readOnly:true,siteId:query.siteId,ownerId:id(5),
  asOf:'2026-10-01T12:00:00.000001Z',scanned:3,nextCursor:null,
  items:['correction','revision','missing'].map(kind=>({kind,requestId:id(1),workerId:id(2),workerName:'合成员工',workerNo:'QA',
    submittedAt:'2026-01-01T10:00:00.000001Z',proposedStartAt:'2026-01-01T08:00:00.000000Z',proposedEndAt:'2026-01-01T09:00:00.000000Z',status:'submitted'}))});
const options=body=>({query,ownerId:id(5),expected:body.items.map(({kind,requestId})=>({kind,requestId}))});
test('browser oracle distinguishes same ID/time across kinds and accepts old pending rows',()=>{
  const body=make();assert.equal(assertOwnerBacklogBrowserPage(body,options(body)).items.length,3);
  assert.throws(()=>assertOwnerBacklogBrowserPage(body,{...options(body),expected:options(body).expected.slice(1)}));
});
test('browser oracle rejects wrong owner, false pause, changed cutoff, closed rows or unordered identities',()=>{
  for(const change of [b=>b.ownerId=id(9),b=>b.moduleEnabled=true,b=>b.items[0].status='approved',b=>b.items.reverse(),b=>b.items[0].reason='private']){
    const body=make(),expected=options(body);change(body);assert.throws(()=>assertOwnerBacklogBrowserPage(body,expected));
  }
  const body=make();assert.throws(()=>assertOwnerBacklogBrowserPage(body,{...options(body),asOf:'2026-10-01T12:00:00.000002Z'}));
});
test('browser oracle allows an empty intermediate candidate page but rejects an invalid cursor',()=>{
  const body={...make(),items:[],scanned:50,nextCursor:{recordedAt:'2026-01-01T10:00:00.000001Z',kind:'correction',requestId:id(1)}};
  assert.equal(assertOwnerBacklogBrowserPage(body,options(body)).scanned,50);
  body.scanned=49;assert.throws(()=>assertOwnerBacklogBrowserPage(body,options(body)));
});
test('browser harness opt-in leaves other entry points disabled and only bundles in memory',()=>{
  const harness=readFileSync(new URL('./attendance-self-browser-harness.mjs',import.meta.url),'utf8');
  assert.match(harness,/withOwnerBacklog=process\.argv\.includes\('--owner-backlog'\)/);
  assert.match(harness,/owner_backlog_conflicting_flags/);
  assert.match(harness,/OWNER_BACKLOG_ENABLED'\]=withOwnerBacklog\?'"1"':'"0"'/);
  assert.match(harness,/write: false/);assert.match(harness,/serverStarted:false/);
  assert.match(harness,/server\.listen\(3131, "127\.0\.0\.1"/);
});
test('acceptance uses actual owner entry, default handlers/service role, closed routes, rollback fingerprints and owned cleanup',()=>{
  const fixture=readFileSync(new URL('./fixtures/attendance-owner-backlog-browser.tsx',import.meta.url),'utf8');
  const source=readFileSync(new URL('./merchant-attendance-owner-backlog-browser-check.mjs',import.meta.url),'utf8');
  assert.match(fixture,/<MerchantAttendanceAdminPanel/);assert.match(fixture,/synthetic_readonly_endpoint_required/);
  for(const text of ['withAttendanceApplicationAuth','handleOwnerBacklog','handleAttendanceAdmin','set local role service_role',
    'assert.equal(request.method(),\'GET\')','assert.equal(url.origin,origin)','pages<=10','parent-hidden','held-unmount',
    'data.fingerprint(),baseline','runAttendanceCleanupSteps','windowsHide:true','realPhone:false','productionAccess:false'])assert(source.includes(text),text);
  assert.doesNotMatch(source,/screenshot\(|video:|trace\.start|storageState\(|page\.waitForTimeout/);
});
