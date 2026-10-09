// Pure diagnostic/acceptance-oracle checks, not browser or database evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {assertCrossTabIdentityMismatch,assertCrossTabIsolatedRead,assertCrossTabRequestIsolation} from './merchant-attendance-cross-tab-shell-checks.mjs';

const input={storedAccount:['synthetic-auth-a'],pageAccount:'synthetic-auth-b',requestAccount:'synthetic-auth-b',
  worker:'synthetic-worker-b',expectedA:'synthetic-auth-a',expectedB:'synthetic-auth-b',workerB:'synthetic-worker-b'};
test('cross-tab diagnostic requires simultaneous stored A, page B, actual request B and worker B evidence',()=>{
  assert.deepEqual(assertCrossTabIdentityMismatch(input),{storageAndPageIdentityDiverged:true,foreignPrincipalUsedForRead:true});
  for(const patch of [{storedAccount:[]},{storedAccount:['synthetic-auth-b']},{storedAccount:['synthetic-auth-a','synthetic-auth-b']},
    {pageAccount:'synthetic-auth-a'},{requestAccount:'synthetic-auth-a'},{worker:'synthetic-worker-a'},
    {expectedB:'synthetic-auth-a'}])assert.throws(()=>assertCrossTabIdentityMismatch({...input,...patch}));
});
test('diagnostic does not manufacture auth events, modify storage, submit attendance or label the defect isolation success',()=>{
  const source=readFileSync(new URL('./merchant-attendance-cross-tab-shell-checks.mjs',import.meta.url),'utf8');
  const diagnostic=source.slice(source.indexOf('export async function diagnoseAttendanceCrossTabShell'),source.indexOf('export function assertCrossTabIsolatedRead'));
  assert.doesNotMatch(source,/new BroadcastChannel|\.postMessage\(|\.setItem\(|\.removeItem\(|\.clear\(|signInWithPassword|auth\.login\(/);
  assert.doesNotMatch(source,/getByRole\('button',\{name:'(?:上班打卡|下班打卡|开始休息|结束休息)'/);
  assert.match(diagnostic,/isolationPassed:false,defectReproduced:true/);assert.doesNotMatch(diagnostic,/isolationPassed:true/);
  assert.match(source,/sibling\.context\(\),phone\.context\(\)/);assert.match(source,/window\.opener===null/);
  assert.match(source,/performance\.timeOrigin/);assert.match(source,/assert\.deepEqual\(events\(\),\[\]\)/);
});

const ownRead=()=>({storedAccounts:['synthetic-auth-a'],visibleLabels:['合成员工甲 · 仅记录本人打卡'],requestAccount:'synthetic-auth-a',
  result:{ok:true,moduleEnabled:true,workerId:'synthetic-worker-a',locationId:'synthetic-place',receipt:null,replayed:false,state:{status:'off',sequence:0,lastEvent:null}},
  expectedAccount:'synthetic-auth-a',expectedWorker:'synthetic-worker-a',expectedLabel:'合成员工甲',site:'99990001',place:'synthetic-place'});
const tabAccounts={'page-a':'synthetic-auth-a','page-b':'synthetic-auth-b'};
const request=(page='page-a',path='/api/merchant-enterprise/attendance/self')=>({tabId:page,path,method:'GET',status:200,actorId:tabAccounts[page]});

test('isolated-read oracle independently requires saved identity, visible name, request actor and actual worker',()=>{
  assert.doesNotThrow(()=>assertCrossTabIsolatedRead(ownRead()));
  for(const patch of [{storedAccounts:[]},{storedAccounts:['synthetic-auth-b']},{storedAccounts:['synthetic-auth-a','synthetic-auth-b']},
    {visibleLabels:[]},{visibleLabels:['合成员工乙 · 仅记录本人打卡']},
    {visibleLabels:['合成员工甲 · 仅记录本人打卡','合成员工乙 · 仅记录本人打卡']},
    {requestAccount:'synthetic-auth-b'},{requestAccount:null},{site:'99990002'}])
    assert.throws(()=>assertCrossTabIsolatedRead({...ownRead(),...patch}));
  for(const patch of [{ok:false},{workerId:'synthetic-worker-b'},{locationId:'other-place'},{receipt:{id:'unexpected'}},{replayed:true},
    {state:{status:'working',sequence:1,lastEvent:{id:'unexpected'}}},{state:{status:'off',sequence:0,lastEvent:{id:'foreign'}}}]){
    const input=ownRead();Object.assign(input.result,patch);assert.throws(()=>assertCrossTabIsolatedRead(input));
  }
});

test('request-history oracle detects transient cross-tab principals even when later reads are correct',()=>{
  const rows=[request(),request('page-b'),request('page-a','/api/merchant-enterprise/overview'),request('page-b','/api/merchant-enterprise/overview')];
  assert.doesNotThrow(()=>assertCrossTabRequestIsolation(rows,tabAccounts));
  for(const path of ['/api/merchant-enterprise/overview','/api/merchant-enterprise/attendance/self'])for(const page of ['page-a','page-b']){
    const foreign={...request(page,path),actorId:tabAccounts[page==='page-a'?'page-b':'page-a']};
    assert.throws(()=>assertCrossTabRequestIsolation([foreign,...rows],tabAccounts));
    assert.throws(()=>assertCrossTabRequestIsolation([...rows,foreign,...rows],tabAccounts));
  }
});

test('request-history oracle rejects writes, failed authorization and missing principals without confusing owner traffic',()=>{
  assert.doesNotThrow(()=>assertCrossTabRequestIsolation([{...request(),tabId:'owner',actorId:'owner-auth'},request(),request('page-b')],tabAccounts));
  for(const patch of [{method:'POST'},{actorId:null},{actorId:undefined},{status:401},{status:403},{status:500}])
    assert.throws(()=>assertCrossTabRequestIsolation([{...request(),...patch}],tabAccounts));
  for(const patch of [{method:'POST'},{status:403},{actorId:null}])
    assert.throws(()=>assertCrossTabRequestIsolation([{...request('page-b','/api/merchant-enterprise/overview'),...patch}],tabAccounts));
  assert.throws(()=>assertCrossTabRequestIsolation([],{a:'same',b:'same'}));
  assert.throws(()=>assertCrossTabRequestIsolation([],{a:'only'}));
});

test('successful same-context acceptance keeps genuine SDK UI login/logout, two reloads and SQL zero-write oracles',()=>{
  const source=readFileSync(new URL('./merchant-attendance-cross-tab-shell-checks.mjs',import.meta.url),'utf8');
  const check=source.slice(source.indexOf('export async function checkAttendanceCrossTabShell'));
  assert.match(check,/sibling\.context\(\),phone\.context\(\)/);assert.match(check,/window\.opener===null/);
  assert.match(check,/name:'登录企业工作台'/);assert.match(check,/name:'退出员工登录'/);assert.match(check,/pathname==='\/auth\/v1\/logout'/);
  assert.match(check,/name:'验收 SDK 刷新会话'/);assert.match(check,/get\('grant_type'\)==='refresh_token'/);
  assert.match(check,/const renewed=await refreshedOverview;assert\.equal\(renewed\.actor\.type,'employee'\);assert\.equal\(renewed\.actor\.id,c\.employees\.b\)/);
  assert.doesNotMatch(check,/refreshed\)\.json\(|refreshed\)\.text\(/);
  assert.match(check,/await logout\(sibling\)/);assert.match(check,/await logout\(phone\)/);
  assert.match(check,/await reload\(phone,'a'\)/);assert.match(check,/await reload\(sibling,'b'\)/);
  assert.match(check,/const pair=async\(\)=>\{await read\(phone,'a'\);await read\(sibling,'b'\);await read\(phone,'a'\)/);
  assert.match(check,/assertCrossTabRequestIsolation\(requests,tabAccounts\)/);assert.match(check,/assert\.deepEqual\(events\(\),\[\]\)/);
  assert.match(check,/assert\.deepEqual\(audits\(\),\[\]\)/);assert.match(check,/cross_tab_configuration_changed/);
  assert.match(check,/isolationPassed:true,defectReproduced:false/);assert.match(check,/realAuthService:false,productionAccess:false/);
  assert.doesNotMatch(check,/\.close\(|\.addCookies\(|\.addInitScript\(|\.setItem\(|\.removeItem\(|new BroadcastChannel|\.postMessage\(|auth\.login\(|signInWithPassword|refreshSession|waitForTimeout|\b(?:insert into|update public|delete from)\b/i);
});
