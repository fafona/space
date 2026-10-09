import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {assertSelfRevisionHistoryBrowserPage} from './merchant-attendance-self-revision-history-browser-check.mjs';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const identity={siteId:'99990001',employeeId:id(101),workerId:id(201)};
const asOf='2026-10-03T12:00:00.000001Z';
const expected={...identity,requestIds:[id(302),id(301)],asOf};
const body=()=>({ok:true,protocol:'self-revision-history-v1',readOnly:true,moduleEnabled:false,...identity,asOf,scanned:2,nextCursor:null,
  items:[302,301].map((value,index)=>({requestId:id(value),rootRequestId:id(400+index),employeeId:identity.employeeId,workerId:identity.workerId,status:'submitted'}))});
const read=name=>readFileSync(new URL(name,import.meta.url),'utf8');
const source=read('./merchant-attendance-self-revision-history-browser-check.mjs');

test('page oracle requires the exact ordered own request IDs across distinct original roots and fixed microsecond cutoff',()=>{
  assert.doesNotThrow(()=>assertSelfRevisionHistoryBrowserPage(body(),expected));
  for(const patch of [{items:[...body().items].reverse()},{items:[body().items[0],body().items[0]]},
    {employeeId:id(102)},{workerId:id(202)},{siteId:'99990002'},{asOf:'2026-10-03T12:00:00.000002Z'},
    {items:[{...body().items[0],employeeId:id(102)},body().items[1]]},
    {items:[{...body().items[0],rootRequestId:id(302)},body().items[1]]}]){
    assert.throws(()=>assertSelfRevisionHistoryBrowserPage({...body(),...patch},expected));
  }
});

test('filtered empty candidate pages are not terminal and mismatched status, scan bound or mutable claims fail',()=>{
  const empty={...body(),items:[],scanned:50,nextCursor:{recordedAt:asOf,requestId:id(250)}};
  assert.doesNotThrow(()=>assertSelfRevisionHistoryBrowserPage(empty,{...expected,requestIds:[],status:'approved'}));
  assert.doesNotThrow(()=>assertSelfRevisionHistoryBrowserPage({...empty,scanned:0,nextCursor:null},{...expected,requestIds:[],status:'approved'}));
  for(const patch of [{readOnly:false},{moduleEnabled:true},{scanned:51},{scanned:1},{protocol:'other'}]){
    assert.throws(()=>assertSelfRevisionHistoryBrowserPage({...body(),...patch},expected));
  }
  assert.throws(()=>assertSelfRevisionHistoryBrowserPage(body(),{...expected,status:'approved'}));
  assert.throws(()=>assertSelfRevisionHistoryBrowserPage({...empty,scanned:49},{...expected,requestIds:[]}));
});

test('fixture uses actual SelfPanel and synthetic old clock denial, with independent context and list GET reaching real handlers and SQL',()=>{
  const fixture=read('./fixtures/attendance-self-revision-history-browser.tsx');
  assert.match(fixture,/import MerchantAttendanceSelfPanel/);assert.match(fixture,/<MerchantAttendanceSelfPanel/);
  assert.match(fixture,/canClock=\{false\}/);assert.match(fixture,/url\.origin !== window\.location\.origin/);
  assert.match(fixture,/Response\.json\(\{ ok: false, error: "attendance_access_denied" \}, \{ status: 403 \}\)/);
  assert.match(fixture,/\(init\?\.method \?\? "GET"\) !== "GET"/);
  for(const name of ['handleSelfRevisionHistory','handleCorrectionContext','faolla_attendance_self_revision_history_v1','faolla_attendance_self_context_v1'])assert(source.includes(name));
  assert.match(source,/assert\(\[rpcName,contextRpc\]\.includes\(name\)\)/);
  assert.match(source,/set local role service_role/);assert.match(source,/assert\.equal\(result\.role,'service_role'\)/);
  assert.match(source,/const handler=url\.pathname===endpoint\?handleSelfRevisionHistory:handleCorrectionContext/);
  assert.doesNotMatch(source,/execute:\s*|authenticate:\s*|allow:\s*|setTimeout\([^)]*,\s*(?:30000|60000)/);
});

test('real pending SQL response is held only for history, then unmount and manual recovery assertions preserve exact pages and all facts',()=>{
  assert.match(source,/const gate=url\.pathname===endpoint\?hold:null/);
  assert(source.indexOf('const body=await response.text()')<source.indexOf('await gate.release.promise'));
  assert.match(source,/卸载测试本人面板/);assert.match(source,/await panel\(\)\.waitFor\(\{state:'detached'\}\)/);
  assert.match(source,/assert\.equal\(await panel\(\)\.locator\('li'\)\.count\(\),0\)/);
  assert.match(source,/assert\(await row\.isVisible\(\)\)/);
  assert.match(source,/assert\.deepEqual\(\[\.\.\.first\.items,\.\.\.last\.items\]\.map\(item=>item\.requestId\),data\.expected\.all\)/);
  assert.match(source,/rpcCalls\.filter\(call=>call\.name===contextRpc\)\.length,5/);
  assert.match(source,/assert\.equal\(data\.fingerprint\(\),baseline\)/);
});

test('closed loopback routing and bounded teardown release gates before restoring auth and never claim full login or real-device acceptance',()=>{
  assert.match(source,/assert\.equal\(url\.origin,origin\);assert\.equal\(request\.method\(\),'GET'\)/);
  assert.match(source,/assert\(\[endpoint,contextEndpoint\]\.includes\(url\.pathname\)\)/);
  assert.match(source,/finally\{closing=true;for\(const gate of gates\)gate\.release\.resolve\(\);await runAttendanceCleanupSteps/);
  for(const guard of ['self-history-browser','self-history-routes','browser','routes','harness'])assert(source.includes(`name:'${guard}'`));
  assert.match(source,/child\.pid!==undefined&&child\.exitCode===null&&child\.signalCode===null/);
  assert.match(source,/syntheticExistingClockDenial:true,syntheticAuth:true/);
  assert.match(source,/realLoginForm:false,realAuthService:false,realNextServer:false,realPhone:false,productionAccess:false/);
  assert.doesNotMatch(source,/console\.(?:log|error)\([^\n]*(?:auth\.login|cookie|token|password|headers)/i);
});

test('new harness mode is opt-in, mutually exclusive, and does not enable the feature in old modes',()=>{
  const harness=read('./attendance-self-browser-harness.mjs');
  assert.match(harness,/withSelfRevisionHistory=process\.argv\.includes\('--self-revision-history'\)/);
  assert.match(harness,/if\(withSelfRevisionHistory&&process\.argv\.slice\(2\)\.some\(flag=>!\['--self-revision-history','--check-only'\]\.includes\(flag\)\)\)throw/);
  assert.match(harness,/NEXT_PUBLIC_FAOLLA_ATTENDANCE_SELF_REVISION_HISTORY_ENABLED'\]=withSelfRevisionHistory\?'"1"':'"0"'/);
});
