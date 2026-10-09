import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {assertSelfRequestsBrowserPage} from './merchant-attendance-self-requests-browser-check.mjs';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const query={siteId:'99990001',expectedEmployeeId:id(101),expectedWorkerId:id(201),kind:'all',status:'all',asOf:null,cursorAt:null,cursorKind:null,cursorId:null};
const make=()=>({ok:true,moduleEnabled:false,protocol:'self-requests-v1',readOnly:true,siteId:query.siteId,employeeId:id(101),workerId:id(201),
  asOf:'2026-10-03T12:00:00.000001Z',scanned:3,nextCursor:null,
  items:['missing','revision','correction'].map(kind=>({kind,requestId:id(1),rootRequestId:kind==='revision'?id(2):id(1),workerId:id(201),employeeId:id(101),workerName:'合成员工',workerNo:'QA',
    submittedAt:'2026-01-01T10:00:00.000001Z',proposedStartAt:'2026-01-01T08:00:00.000000Z',proposedEndAt:'2026-01-01T09:00:00.000000Z',status:'submitted',closedAt:null}))});
const options=body=>({query,expected:body.items.map(({kind,requestId,status})=>({kind,requestId,status}))});
test('browser oracle distinguishes cross-type same-time same-ID owned requests',()=>{
  const body=make();assert.equal(assertSelfRequestsBrowserPage(body,options(body)).items.length,3);
  assert.throws(()=>assertSelfRequestsBrowserPage(body,{...options(body),expected:options(body).expected.slice(1)}));
});
test('browser oracle rejects substituted identities, false pause, changed state or cutoff and unknown fields',()=>{
  for(const change of [b=>b.employeeId=id(102),b=>b.workerId=id(202),b=>b.moduleEnabled=true,b=>b.items[0].status='approved',b=>b.items.reverse(),b=>b.items[0].reason='private']){
    const body=make(),expected=options(body);change(body);assert.throws(()=>assertSelfRequestsBrowserPage(body,expected));
  }
  const body=make();assert.throws(()=>assertSelfRequestsBrowserPage(body,{...options(body),asOf:'2026-10-03T12:00:00.000002Z'}));
});
test('browser oracle accepts empty intermediate candidates without silently exhausting history',()=>{
  const body={...make(),items:[],scanned:50,nextCursor:{recordedAt:'2026-01-01T10:00:00.000001Z',kind:'correction',requestId:id(1)}};
  assert.equal(assertSelfRequestsBrowserPage(body,options(body)).scanned,50);body.scanned=49;assert.throws(()=>assertSelfRequestsBrowserPage(body,options(body)));
});
test('new in-memory browser entry is opt-in and leaves existing paths unchanged/default off',()=>{
  const harness=readFileSync(new URL('./attendance-self-browser-harness.mjs',import.meta.url),'utf8');
  assert.match(harness,/withSelfRequests=process\.argv\.includes\('--self-requests'\)/);assert.match(harness,/self_requests_conflicting_flags/);
  assert.match(harness,/SELF_REQUESTS_ENABLED'\]=withSelfRequests\?'"1"':'"0"'/);assert.match(harness,/write: false/);assert.match(harness,/serverStarted:false/);
  assert.match(harness,/server\.listen\(3131, "127\.0\.0\.1"/);
});
test('acceptance uses actual self entry and guarded default handler SQL without writes or external routes',()=>{
  const fixture=readFileSync(new URL('./fixtures/attendance-self-requests-browser.tsx',import.meta.url),'utf8');
  const source=readFileSync(new URL('./merchant-attendance-self-requests-browser-check.mjs',import.meta.url),'utf8');
  assert.match(fixture,/<MerchantAttendanceSelfPanel/);assert.match(fixture,/synthetic_readonly_endpoint_required/);
  for(const text of ['withAttendanceApplicationAuth','handleSelfRequests','handleCorrectionContext','set local role service_role',
    "assert.equal(request.method(),'GET')",'assert.equal(url.origin,origin)','pages<=10','empty-filter-page','held-unmount',
    'data.fingerprint(),baseline','runAttendanceCleanupSteps','windowsHide:true','realPhone:false','productionAccess:false'])assert(source.includes(text),text);
  assert.doesNotMatch(source,/screenshot\(|video:|trace\.start|storageState\(|page\.waitForTimeout/);
});
