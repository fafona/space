import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import test from 'node:test';
const require=createRequire(import.meta.url);
const {withAttendanceApplicationAuth}=require('./fixtures/attendance-application-auth.ts');
const {createAttendanceMerchantIdentityReads}=require('./fixtures/attendance-merchant-login-transport.ts');
const {databaseActors:actors}=require('./fixtures/attendance-database-transport.ts');
const origin='https://attendance-auth.invalid';
const serviceHeaders={apikey:'attendance-synthetic-service',authorization:'Bearer attendance-synthetic-service'};
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const merchantRead=`/rest/v1/merchants?select=id&user_id=eq.${actors[0].id}&limit=20`;

test('login acceptance renders actual login page and invokes unchanged login/session/logout handlers',()=>{
  const check=read('scripts/merchant-attendance-database-browser-check.mjs');
  const entry=read('scripts/fixtures/attendance-merchant-shell-browser.tsx');
  assert(entry.includes('import LoginPage from "../../src/app/login/page"'));
  assert(entry.includes('SearchParamsContext.Provider value={new URLSearchParams(window.location.search)}'));
  for(const name of ['merchant-login','merchant-session','merchant-logout'])assert(check.includes(`/src/app/api/auth/${name}/route.ts`));
  assert(check.includes('if(owner&&!actualMerchantLogin)await context.addCookies'));
  assert(check.includes("response.headers.getSetCookie().filter"));
  assert(check.includes("cookies.join('\\n')"));
  assert(check.includes('actualMerchantLoginPageAndHandler:actualMerchantLogin'));
  assert(check.includes('realAuthService:false,realPostgrest:false'));
  assert.doesNotMatch(entry,/fetch\s*=|function LoginPage|mock/);
});

test('identity adapter maps bounded known owner/employee reads into only the disposable SQL relations',async()=>{
  const sql=[],adapter=createAttendanceMerchantIdentityReads(query=>{sql.push(query);return '[{"id":"99990001"}]';});
  assert.deepEqual(await adapter.read(new Request(origin+merchantRead)).json(),[{id:'99990001'}]);
  adapter.read(new Request(origin+`/rest/v1/merchant_enterprise_employees?select=id&auth_user_id=eq.${actors[1].id}&limit=1`));
  assert(sql[0].includes(`from public.merchants where user_id='${actors[0].id}' limit 20`));
  assert(sql[1].includes('from public.merchant_enterprise_employees'));
  const absent=adapter.read(new Request(origin+`/rest/v1/merchants?select=id&email=eq.${actors[0].email}&limit=20`));
  assert.equal(absent.status,400);assert.equal(sql.length,2);assert.deepEqual(adapter.errors,[]);
});

test('identity adapter refuses unbounded, foreign, injected, writable and unlisted queries before SQL',()=>{
  let calls=0;const adapter=createAttendanceMerchantIdentityReads(()=>{calls++;return '[]';});
  for(const [path,method] of [
    [merchantRead.replace('limit=20','limit=10000'),'GET'],
    [merchantRead.replace(actors[0].id,"unknown'%20OR%20true--"),'GET'],
    [merchantRead.replace('select=id','select=*'),'GET'],
    [merchantRead+'&or=(id.eq.99990001)','GET'],
    [merchantRead.replace('/merchants?','/secrets?'),'GET'],
    [merchantRead,'POST'],
  ])assert.throws(()=>adapter.read(new Request(origin+path,{method})));
  assert.equal(calls,0);assert.equal(adapter.errors.length,6);
});

test('existing Auth fixtures keep identity table/admin endpoints disabled unless explicitly opted in',async()=>{
  await withAttendanceApplicationAuth(actors,null,async()=>{
    const denied=await fetch(origin+'/auth/v1/token?grant_type=password',{method:'POST',headers:{apikey:'attendance-synthetic-anon','content-type':'application/json'},body:JSON.stringify({email:actors[0].email,password:'Wrong-synthetic-password!'})});
    assert.equal(denied.status,400);assert.deepEqual(await denied.json(),{code:'invalid_credentials',error_code:'invalid_credentials',message:'Invalid credentials'});
    await assert.rejects(fetch(origin+merchantRead,{headers:serviceHeaders}),/fixture_unexpected_endpoint/);
    await assert.rejects(fetch(origin+'/auth/v1/admin/users/'+actors[0].id,{method:'PUT',headers:serviceHeaders,body:'{}'}),/fixture_unexpected_endpoint/);
    await assert.rejects(fetch('https://production.example.test/auth/v1/user'),/fixture_external_request_forbidden/);
  });
});

test('opted-in identity reads require a synthetic service key and remain GET only',async()=>{
  let calls=0;const adapter={ownerId:actors[0].id,read:()=>{calls++;return Response.json([]);}};
  await withAttendanceApplicationAuth(actors,null,async()=>{
    await assert.rejects(fetch(origin+merchantRead));
    await assert.rejects(fetch(origin+merchantRead,{method:'POST',headers:serviceHeaders}));
    assert.deepEqual(await (await fetch(origin+merchantRead,{headers:serviceHeaders})).json(),[]);
    assert.equal(calls,1);
  },adapter);
});

test('login account metadata update affects only the selected synthetic owner in memory',async()=>{
  const adapter={ownerId:actors[0].id,read:()=>Response.json([])};
  const fields={account_type:'merchant',account_id:'99990001',merchant_id:'99990001'};
  const body=JSON.stringify({user_metadata:fields,app_metadata:fields});
  await withAttendanceApplicationAuth(actors,null,async auth=>{
    const url=origin+'/auth/v1/admin/users/';
    await assert.rejects(fetch(url+actors[1].id,{method:'PUT',headers:serviceHeaders,body}),/fixture_unexpected_endpoint/);
    await assert.rejects(fetch(url+actors[0].id,{method:'PUT',headers:serviceHeaders,body:'{"password":"not-allowed"}'}));
    assert.equal((await fetch(url+actors[0].id,{method:'PUT',headers:serviceHeaders,body})).status,200);
    const token=await auth.login(actors[0]);
    const user=await (await fetch(origin+'/auth/v1/user',{headers:{apikey:'attendance-synthetic-anon',authorization:'Bearer '+token}})).json();
    assert.equal(user.app_metadata.merchant_id,'99990001');
  },adapter);
  await withAttendanceApplicationAuth(actors,null,async auth=>{
    const token=await auth.login(actors[0]);
    const user=await (await fetch(origin+'/auth/v1/user',{headers:{apikey:'attendance-synthetic-anon',authorization:'Bearer '+token}})).json();
    assert.equal(user.app_metadata.merchant_id,undefined);
  });
});

test('Auth adapter restores fetch and configured environment even when login acceptance throws',async()=>{
  const originalFetch=globalThis.fetch,originalUrl=process.env.NEXT_PUBLIC_SUPABASE_URL;
  await assert.rejects(withAttendanceApplicationAuth(actors,null,async()=>{throw Error('synthetic-interruption');},{ownerId:actors[0].id,read:()=>Response.json([])}),/synthetic-interruption/);
  assert.equal(globalThis.fetch,originalFetch);assert.equal(process.env.NEXT_PUBLIC_SUPABASE_URL,originalUrl);
});
