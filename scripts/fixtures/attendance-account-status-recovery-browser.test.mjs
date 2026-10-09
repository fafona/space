// Static fixture contracts only: never import/start the browser acceptance module.
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {runAttendanceCleanupSteps} from './attendance-cleanup.mjs';

const source=readFileSync(new URL('./attendance-account-status-recovery-browser.mjs',import.meta.url),'utf8');
const entry=readFileSync(new URL('./attendance-account-status-recovery-browser.tsx',import.meta.url),'utf8');
const ast=ts.createSourceFile('browser.mjs',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
function section(start,end){const a=source.indexOf(start),b=source.indexOf(end,a+start.length);assert(a>=0&&b>a,`Missing bounded section ${start}`);return source.slice(a,b);}
function ordered(text,...parts){let at=-1;for(const part of parts){const next=text.indexOf(part,at+1);assert(next>at,`Missing/out-of-order contract: ${part}`);at=next;}}

test('fixture starts only through the owned callback and bundles actual Manager/Selector/route without disk or external runtime',()=>{
  const exported=ast.statements.filter(ts.isFunctionDeclaration).filter(n=>n.modifiers?.some(m=>m.kind===ts.SyntaxKind.ExportKeyword));
  assert.deepEqual(exported.map(n=>n.name?.text),['runAccountStatusRecoveryBrowserAcceptance']);
  const top=ast.statements.filter(n=>!ts.isFunctionDeclaration(n)&&!ts.isImportDeclaration(n)).map(n=>n.getText(ast)).join('\n');
  assert.doesNotMatch(top,/\b(?:createServer|build|compile|launch|spawn|exec|listen)\s*\(/);
  assert.doesNotMatch(source,/writeFile|mkdir|process\.argv|waitForTimeout/);
  const preparation=section('export async function runAccountStatusRecoveryBrowserAcceptance','const server=createServer');
  ordered(preparation,'d?.syntheticOnly===true&&h?.syntheticOnly===true','scope?.schema===d.owned.schema','ports?.managerAuth===d.auth','ports.managerAuth!==d.owner','target_must_not_be_authenticated_manager');
  assert.match(source,/write:false,metafile:true/);assert.match(source,/assert\.equal\(url\.origin,origin,'account_status_recovery_external_request'\)/);
  assert.match(entry,/import Manager,.*MerchantEnterpriseManager/);assert.match(entry,/import EnterpriseSelectorClient.*EnterpriseSelectorClient/);assert.match(entry,/import RecoveryRoute.*attendance-recovery\/page/);
  assert.match(entry,/<Manager siteId=\{seed\.site\}[^]*accessToken=\{seed\.token\}/);
  assert.match(entry,/pathname === "\/qa-manager" \? <EmployeeManager\/> : pathname === "\/enterprise" \? <EnterpriseSelectorClient\/> : <RecoveryRoute\/>/);
});

test('exactly one actual employee PATCH must succeed before its transport is deliberately lost and its real controller pending is inspected',()=>{
  const original=section("else if(!recoveryOnly&&url.pathname===employees&&method==='PATCH')","else if(recoveryOnly&&url.pathname===endpoint");
  ordered(original,"dropPatch&&patches().length===0","submitted=JSON.parse(body)","submitted.employeeId,employeeId","submitted.status,'disabled'","submitted.offboardingMode,'unassign'","response=await ports.handleEmployee(realRequest)");
  assert.equal((source.match(/await ports\.handleEmployee\(realRequest\)/g)??[]).length,1);
  const lost=section("if(method==='PATCH'){","if(url.pathname===endpoint){");
  ordered(lost,'assert.equal(response.status,200,text)','assert.equal(json.employee.id,employeeId)',"assert.equal(json.employee.status,'disabled')",'record.responseLost=true',"return route.abort('failed')");
  const pending=section("stage='manager.original_patch_response_lost'",'recoveryOnly=true;');
  ordered(pending,"page.waitForEvent('requestfailed'",'await failed','assert.equal(patches().length,1);assert.equal(recoveries().length,0)',"sessionStorage.getItem(key)",'Buffer.byteLength(raw,\'utf8\')<=8192','assert.deepEqual(stored.command,sentCommand)','pending={key,raw,operationId:stored.command.operationId}');
  assert.match(pending,/Object\.keys\(stored\)\.sort\(\),\['actorId','command','commandFingerprint','siteId','version'\]/);
  assert.match(pending,/initialProbe\.writes\.every\(w=>!w\.local&&w\.method==='setItem'&&w\.key===key&&w\.bytes<=8192\)/);
});

test('same employee token reaches actual overview while the recovery adapter permits only the exact original GET and asserts read-only data',()=>{
  const routing=section("const request=route.request()",'const record={mode,path:url.pathname');
  ordered(routing,"request.headers()['x-merchant-access-token'],token","if(recoveryOnly)assert.equal(method,'GET'",'const before=method===\'GET\'?d.fingerprint():null',"assert.equal(auth,ports.managerAuth",'response=await ports.handleOverview(realRequest)','assert.equal(data.currentAuthUserId,ports.managerAuth)',"assert(data.snapshot.employees.every(e=>e.authUserId===''))");
  const recover=section("else if(recoveryOnly&&url.pathname===endpoint&&method==='GET'){",'}else throw Error(');
  ordered(recover,"assert(['correct','unavailable'].includes(mode))",'assert.equal(body,null)',"{siteId:site,mode:'recover-status',operationId:pending.operationId}",'response=await ports.handleSuspension(realRequest)');
  assert.match(source,/if\(method==='GET'\)readUnchanged\(before\)/);
  const readonly=section('const readUnchanged=','const quiet=');
  ordered(readonly,"assert.equal(d.fingerprint(),before,'account_status_recovery_get_wrote')",'assert.equal(d.fingerprint(),restrictedFacts)','assert.equal(d.definitions(),definitions)','readChecks++');
  const receipt=section('const r=json.statusReceipt,p=JSON.parse(pending.raw)','if(mode===\'unavailable\')');
  for(const comparison of ['r.actorId,ports.managerAuth','r.expectedVersion,submitted.version','r.version,submitted.version+1','r.commandFingerprint,p.commandFingerprint'])assert(receipt.includes(comparison));
});

test('permission removal encloses four bounded cases and restores permissions with exactly two real role version advances',()=>{
  const flow=section('recoveryOnly=true;','return {checks,requests:');
  ordered(flow,'const restoredRole=await withRestrictedRole(async()=>{','restrictedFacts=d.fingerprint()',"for(const mode of ['correct','wrong','failed','unavailable'])",'const denied=page.getByRole(\'button\',{name:\'无法进入\'',"assert.equal(await link.getAttribute('href'),recoveryPath)",'link.click()','assert.equal(current.context.pages().length,1)','assert.equal(new URL(page.url()).search,\'\')');
  ordered(flow,'restrictedFacts=null;','assert.equal(restoredRole.permissionRestored,true)','assert.equal(restoredRole.roleVersionAdvances,2)',"assert.equal(d.fingerprint(),restoredRole.restoredFacts,'role_restore_changed_after_validation')",'assert.equal(d.definitions(),definitions)','assert.deepEqual(d.inventory(),inventory)','assert.equal(patches().length,1);assert.equal(recoveries().length,2)',"assert.equal(requests.filter(r=>r.method==='POST').length,0)");
  assert.match(source,/typeof withRestrictedRole==='function'/);
  assert.doesNotMatch(source,/roleWithoutSelf|role_restore_changed_post_disable_facts|onlyOriginalDisableFactsRemain/);
  assert.match(source,/originalDisableAndTwoRealRoleVersionAdvances:true/);
  assert.match(source,/assert\(requests\.length<20,'account_status_recovery_request_budget'\)/);
  assert.match(source,/setDefaultTimeout\(12000\)/);assert.match(source,/width:390,height:900/);
  assert.match(source,/disabledManagerBrowserNotClaimed:true/);
  assert.match(source,/syntheticSdkAuth:true,syntheticMembershipInitialization:true/);
});

test('wrong Auth and failed verification never reveal pending; injected503 follows a real read and preserves pending bytes without clearing unrelated storage',()=>{
  const auth=section('const authSource=`','const linkSource=');
  ordered(auth,"if(token!==seed().token)throw Error", "seed().mode==='failed'?{data:{user:null},error:");
  assert.match(source,/const auth=mode==='wrong'\?d\.owner:ports\.managerAuth/);
  const cases=section("if(mode==='failed'){",'await quiet();assert.equal(recoveries().length,beforeReads+');
  assert.match(cases,/当前没有可核验的员工登录身份[^]*assert\.equal\(await region\.count\(\),0\)/);
  assert.match(cases,/if\(mode==='wrong'\)[^]*assert\.equal\(await region\.getByRole\('button',\{name:'读取这个原编号',exact:true\}\)\.count\(\),0\)/);
  assert.match(cases,/assert\(!\(await region\.innerText\(\)\)\.includes\(pending\.operationId\)\)/);
  const injected=section("if(mode==='unavailable'){",'return route.fulfill({status:response.status');
  ordered(injected,'record.actualStatus=response.status;record.status=503',"record.error='attendance_unavailable';record.injected=true",'route.fulfill({status:503');
  assert.match(source,/observed\.raw,mode==='correct'\?null:pending\.raw/);
  assert.match(source,/observed\.probe\.writes,mode==='correct'\?\[\{method:'removeItem',key,local:false,bytes:0\}\]:\[\]/);
  assert.match(source,/assert\.equal\(observed\.session,'keep'\);assert\.equal\(observed\.local,'keep'\)/);
  assert.match(source,/for\(const value of \[employeeId,employeeName,stored\.commandFingerprint,receipt\.suspensionId\]\)assert\(!text\.includes\(value\)/);
});

test('cleanup contract checks object steps, preserves primary failures and owns every resource even on failure',async()=>{
  const cleanupNode=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='cleanup');assert(cleanupNode);
  const cleanup=new Function('assert','runAttendanceCleanupSteps',`return (${cleanupNode.getText(ast)});`)(assert,runAttendanceCleanupSteps);
  await assert.rejects(cleanup([['bad',()=>{}]],null),/account_status_recovery_cleanup_shape/);
  const seen=[];await cleanup([{name:'first',run:()=>seen.push('first')},{name:'second',run:()=>seen.push('second')}],null);assert.deepEqual(seen,['first','second']);
  const primary=Error('primary');await assert.rejects(cleanup([{name:'broken',run:()=>{throw Error('cleanup');}}],primary),error=>error instanceof AggregateError&&error.cause===primary&&error.errors[0]===primary);
  const finalizer=source.slice(source.indexOf('}finally{closing=true;await cleanup(['));
  ordered(finalizer,"name:'account status recovery inflight'","name:'account status recovery contexts'","name:'account status recovery browser'","name:'account status recovery HTTP listener'","name:'account status recovery esbuild service'",'],failure)');
  assert.match(finalizer,/server\.closeAllConnections\?\.\(\)/);assert.match(finalizer,/run:\(\)=>stop\(\)/);
});
