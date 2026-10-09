import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {serveAttendanceMerchantBootstrap}=require('./fixtures/attendance-merchant-shell-transport.ts');
const {databaseActors}=require('./fixtures/attendance-database-transport.ts');
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const check=read('scripts/merchant-attendance-database-browser-check.mjs');
const transport=read('scripts/fixtures/attendance-database-transport.ts');
const harness=read('scripts/attendance-self-browser-harness.mjs');

test('database browser acceptance reuses the identity-checked local cluster and owned disposable namespace',()=>{
  assert(check.includes("runAttendanceLabelsReuse(process.argv.slice(2).filter(arg=>!['--merchant-shell','--merchant-login'].includes(arg)),check)"));
  assert.match(check,/withAttendanceConcurrencySandbox\(native,/);
  assert.doesNotMatch(check,/initdb|create database|DATABASE_URL|dotenv|writeFile|mkdir|mkdtemp/);
  assert.match(check,/finally\{await browser\?\.close\(\)/);
  assert.match(check,/stdio:\['ignore','pipe','pipe'\]/);assert.match(check,/windowsHide:true/);
});
test('attendance requests use real handlers with only a synthetic platform entitlement catalog override',()=>{
  for(const kind of ['self','admin','history'])assert(check.includes(`/attendance/${kind}/route-handler.ts`));
  assert.match(check,/response=await handler\(request,\{entitlement\}\)/);
  assert.doesNotMatch(check,/authenticate\s*:|execute\s*:|allow\s*:/);
  assert(check.includes("response.headers.get('cache-control'),'private, no-store'"));
  assert(check.includes('realAuthService:false,realPostgrest:false,fullAdminClient,syntheticEnterpriseBootstrap:true'));
  assert(check.includes("const fullAdminClient=process.argv.includes('--merchant-shell')"));
});

test('full merchant shell imports the actual client and providers without replacing existing components',()=>{
  const entry=read('scripts/fixtures/attendance-merchant-shell-browser.tsx');
  assert(entry.includes('import AdminClient from "../../src/app/admin/AdminClient"'));
  assert(entry.includes('I18nProvider initialLocale="zh-CN"'));
  assert(entry.includes('<AdminClient forcedScope="site-99990001" startInLoadingState />'));
  assert.doesNotMatch(entry,/window\.fetch|localStorage|mock|AdminClient\s*=/);
  assert(harness.includes("withMerchantShell=process.argv.includes('--merchant-shell')"));
  assert(check.includes("name:'企业',exact:true"));
  assert(check.includes("name:'企业管理子菜单',exact:true"));
  assert(check.includes("name:'返回会话',exact:true"));
});

const bootstrapRequest=(endpoint,method='GET')=>new Request('https://www.faolla.com'+endpoint,{method});
const bootstrap=endpoint=>serveAttendanceMerchantBootstrap(bootstrapRequest(endpoint),databaseActors[0].id);
test('synthetic merchant bootstrap is scoped to the test owner and test site',async()=>{
  const session=await bootstrap('/api/auth/merchant-session').json();
  assert.deepEqual(session.merchantIds,['99990001']);assert.equal(session.user.id,databaseActors[0].id);
  assert.equal(session.accessToken,undefined);assert.equal(session.refreshToken,undefined);
  assert.throws(()=>serveAttendanceMerchantBootstrap(bootstrapRequest('/api/auth/merchant-session'),databaseActors[1].id));
  assert.throws(()=>bootstrap('/api/merchant-draft?siteId=10000000'));
  const profile=await bootstrap('/api/merchant-chat-business-card?siteId=99990001&merchantId=99990001').json();
  assert.equal(profile.profile.permissionConfig.allowEnterpriseManagement,true);
  assert.equal(profile.profile.permissionConfig.allowEmployeeAttendance,true);
});
test('bootstrap cannot replace attendance routes or grant successful business writes',async()=>{
  for(const route of ['self','admin','history'])assert.equal(bootstrap('/api/merchant-enterprise/attendance/'+route),null);
  assert.equal(bootstrap('/api/unlisted-business'),null);
  assert.throws(()=>serveAttendanceMerchantBootstrap(bootstrapRequest('/api/merchant-draft?siteId=99990001','POST'),databaseActors[0].id));
  const denied=serveAttendanceMerchantBootstrap(bootstrapRequest('/api/merchant-operation-logs','POST'),databaseActors[0].id);
  assert.equal(denied.status,403);assert.equal((await denied.json()).error,'synthetic_log_write_disabled');
  const source=read('scripts/fixtures/attendance-merchant-shell-transport.ts');
  assert.doesNotMatch(source,/fetch\(|writeFile|createClient|\.from\(|\.rpc\(/);
});
test('ancillary merchant badge reads are explicitly synthetic and do not use live business data',async()=>{
  for(const [endpoint,key] of [['/api/bookings','bookings'],['/api/orders','orders'],['/api/support-messages','messages'],['/api/merchant-peer-messages','contacts']]){
    assert.deepEqual((await bootstrap(endpoint+'?siteId=99990001').json())[key],[]);
    assert.throws(()=>serveAttendanceMerchantBootstrap(bootstrapRequest(endpoint+'?siteId=99990001','POST'),databaseActors[0].id));
  }
});
test('RPC transport permits only three tested functions and verifies the real executing database role',()=>{
  assert.deepEqual([...transport.matchAll(/name===\"(faolla_[^\"]+)\"/g)].map(m=>m[1]),['faolla_attendance_self_v1','faolla_attendance_admin_v1','faolla_attendance_self_history_v1']);
  assert(transport.includes('else throw Error("database_browser_unexpected_rpc")'));
  assert(transport.includes("set role service_role;select jsonb_build_object('role',current_user,'data',public."));
  assert(transport.includes('assert.equal(reply.role,"service_role")'));
  assert(transport.includes('assert.equal(args.p_site_id,"99990001")'));
});
test('database browser adapter has a hard-coded loopback origin and does not turn static harness into an API server',()=>{
  assert(check.includes("if(url.origin!==origin){external.push(url.origin+url.pathname);return route.abort();}"));
  assert(harness.includes("if(withDatabaseEntry)portalDefines['process.env.NEXT_PUBLIC_SUPABASE_URL']='\"https://127.0.0.1:3131\"'"));
  assert(harness.includes('request.method !== "GET"'));
  assert(harness.includes('request.headers.host !== "127.0.0.1:3131"'));
  assert(harness.includes('write: false'));
  assert(check.includes("if(headers.get('origin')===origin)headers.set('origin',canonical)"));
});

test('existing database browser path installs both current self-identity guards after the historical read RPC',()=>{
  const migrations=[...check.matchAll(/'(\d+_merchant_attendance_self_[a-z_]+\.sql)'/g)].map(match=>match[1]);
  assert.deepEqual(migrations,[
    '202609300068_merchant_attendance_self_history.sql',
    '202610020110_merchant_attendance_self_history_identity.sql',
    '202610020111_merchant_attendance_self_clock_identity.sql',
  ]);
  assert(check.indexOf(migrations[2])<check.indexOf('insert into public.merchants'));
  assert(check.includes("exec(readFileSync(path.join(root,'scripts/supabase-migrations',migration),'utf8'))"));
});

test('real role-denied first POST asserts private DOM removal, exact retained pending and no new facts or retry',()=>{
  const begin=check.indexOf('const factsBeforeDenial=eventRows()'),end=check.indexOf('// Reload uses a DB-backed synthetic capability response',begin);
  assert(begin>=0&&end>begin);const denial=check.slice(begin,end);
  assert(denial.indexOf("'收据编号：'+lastOwnFact.id")<denial.indexOf('update public.merchant_enterprise_roles'));
  assert(denial.includes("punch(a,'上班打卡',403)"));assert(denial.includes("denied.error,'attendance_access_denied'"));
  assert(denial.includes("getByText(/原操作编号仍会保留/).waitFor()"));
  assert(denial.includes("getByText('等待服务器同步，不显示推测记录。',{exact:true}).waitFor()"));
  assert(denial.includes("getByText(/^此次操作收据 · /).count(),0"));
  assert(denial.includes("getByRole('button',{name:'用原操作编号重试',exact:true}).isDisabled()"));
  assert(denial.includes('assert.deepEqual(JSON.parse(savedPending),{version:1,siteId:pendingSite,employeeId:id(101),workerId:workers[0].id,command:pendingCommand})'));
  assert(denial.includes('assert.deepEqual(eventRows(),factsBeforeDenial)'));
  assert(denial.includes("r.method==='POST').length,deniedPosts"));
});

test('view-only reload and expired Auth recheck use the original pending operation and cannot depend on the fresh-state button',()=>{
  const begin=check.indexOf('const viewOnlyRead='),end=check.indexOf('const configBaseline=',begin);
  assert(begin>=0&&end>begin);const recovery=check.slice(begin,end);
  assert(recovery.includes("url.searchParams.get('operationId')===deniedCommand.operationId&&r.request().method()==='GET'&&r.status()===200"));
  assert(recovery.includes('viewOnlyResult.receipt,null'));assert(recovery.includes('viewOnlyResult.state.lastEvent.id,lastOwnFact.id'));
  assert(recovery.includes("当前角色仅可查看本人考勤，不能提交打卡。"));
  assert.equal((recovery.match(/sessionStorage\.getItem\(key\),pendingKey\),savedPending/g)||[]).length,2);
  assert.equal((recovery.match(/name:'用原操作编号重试',exact:true\}\)\.isDisabled\(\)/g)||[]).length,2);
  assert.equal((recovery.match(/assert\.deepEqual\(eventRows\(\),factsBeforeDenial\)/g)||[]).length,2);
  assert(recovery.includes("name:'核对打卡结果',exact:true"));
  assert(recovery.includes("assert.equal(transport.calls.length,beforeAuth)"));
  assert.doesNotMatch(recovery,/name:'刷新状态'/);
  assert(check.includes("name:/^(刷新状态|核对打卡结果)$/"));
});
