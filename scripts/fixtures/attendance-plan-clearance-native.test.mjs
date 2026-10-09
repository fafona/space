// Static/isolated-code checks only: no PostgreSQL, browser, build or real auth.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const runnerUrl=new URL('../merchant-attendance-plan-clearance-native.mjs',import.meta.url);
const helperUrl=new URL('./attendance-plan-clearance-native.mjs',import.meta.url);
const runner=ts.createSourceFile('runner.mjs',readFileSync(runnerUrl,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const helper=ts.createSourceFile('helper.mjs',readFileSync(helperUrl,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
function nodes(root,predicate){const found=[];function visit(node){if(predicate(node))found.push(node);ts.forEachChild(node,visit);}visit(root);return found;}
function named(root,name){const found=nodes(root,n=>(ts.isFunctionDeclaration(n)||ts.isVariableDeclaration(n))&&n.name?.getText(root)===name);assert.equal(found.length,1,name);return found[0];}
const functionText=(root,name)=>named(root,name).getText(root).replace(/^export\s+/,'');
const initializer=(root,name)=>named(root,name).initializer.getText(root);
const plain=value=>JSON.parse(JSON.stringify(value));
const review='faolla_attendance_plan_exception_review_v1',eventReview='faolla_attendance_plan_exception_review_event_v1',clearance='faolla_attendance_plan_exception_clearance_v1';

// Execute the actual orchestration function with every external port replaced.
// This exercises its assertions/finally without opening files or a connection.
function runnerHarness(tamper=null){
  const calls=[],env={FAOLLA_ATTENDANCE_ONSITE_QR_SECRET:'preserve-original'},baseline={...env};
  const saved={artifactText:'immutable155',artifactSha256:'original-sha',artifactBytes:12};
  const scope={sql:sql=>'owned:'+sql};
  const exec=sql=>{calls.push(['exec',sql]);return sql.includes('faolla_attendance_period_closure_v1')?JSON.stringify(saved):'1';};
  const d={exec,site:'99990009',owner:'owner',owned:{schema:'owned_synthetic'}};
  const h={workerId:'worker',employeeId:'employee',employeeAuthUserId:'member-auth',slot:{workDate:'2026-10-05'}};
  const native={root:'/synthetic-only',query:sql=>{calls.push(['query',sql]);return '';},pass:message=>calls.push(['pass',message])};
  const original=name=>name.includes('160_')?'begin;select 160;commit;\nCREATE INDEX CONCURRENTLY synthetic_idx ON synthetic_table(id);\nbegin;select 161;commit;':'-- original '+name;
  const context={assert,path,process:{env},randomBytes:()=>Buffer.alloc(32,1),
    runAttendanceLabelsReuse:async(args,callback)=>{calls.push(['reuse',args]);return callback(native);},
    withAttendanceConcurrencySandbox:async(actual,callback)=>{assert.equal(actual,native);return callback(scope);},
    preparePlanAdoptionViewNative:async(actual,owned)=>{assert.equal(actual,native);assert.equal(owned,scope);return d;},
    seedPlanExceptionHistoryNative:async input=>{assert.equal(input.d,d);assert.equal(input.scope,scope);return h;},
    prepareAttendanceEmployeeManagement:async(actual,owned)=>{assert.equal(actual,native);assert.equal(owned,scope);},
    readFileSync:file=>{const name=path.basename(file);calls.push(['read',name]);return original(name);},
    boundClockMigrationBody:(_root,name)=>{calls.push(['body',name]);return 'set search_path=public; -- '+name;},
    quote:value=>JSON.stringify(value),json:value=>JSON.stringify(value),id:value=>String(value),
    require:name=>{assert.equal(name,'../src/lib/merchantAttendancePeriodClosure.server.ts');return {
      executePeriodClosures:async()=>({preview:{artifact:{sourceFingerprint:'fingerprint'}},artifact:{sourceFingerprint:'fingerprint'},period:{revision:1,currentVersion:1,sealed:true}})};},
    verifyPlanClearanceNative:async(input,browser)=>{assert.equal(input.d,d);assert.equal(input.h,h);assert.equal(input.native,native);assert.equal(input.scope,scope);assert.equal(browser,null);
      if(tamper)saved[tamper]='changed';return {verifiedByMock:true};},
  };
  for(const name of ['beforeIndex','afterIndex','beforeEnterprise','afterEnterprise'])context[name]=named(runner,name).initializer.elements.map(element=>element.text);
  vm.createContext(context);vm.runInContext(functionText(runner,'runPlanClearanceNative'),context);
  return {run:()=>context.runPlanClearanceNative(['--selected-stopped-local-cluster']),calls,env,baseline,original};
}

test('both modules import inertly and helper rejects non-synthetic input before any query',async()=>{
  const env={...process.env};
  const [entry,fixture]=await Promise.all([import(runnerUrl.href),import(helperUrl.href)]);
  assert.equal(typeof entry.runPlanClearanceNative,'function');assert.equal(typeof fixture.verifyPlanClearanceNative,'function');
  assert.deepEqual({...process.env},env);
  let calls=0;
  for(const [dSynthetic,hSynthetic] of [[false,true],[true,false]]){
    await assert.rejects(fixture.verifyPlanClearanceNative({d:{syntheticOnly:dSynthetic,exec:()=>{calls++;}},h:{syntheticOnly:hSynthetic},
      native:{query:()=>{calls++;}},scope:{sql:()=>{calls++;}}}),{name:'AssertionError'});
  }
  assert.equal(calls,0);
  const cli=runner.statements.filter(ts.isIfStatement);assert.equal(cli.length,1);
  assert.equal(cli[0].expression.getText(runner),'process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)');
  assert(!helper.statements.some(ts.isIfStatement));
  assert(!/\b(?:spawn|execFile|initdb|createdb)\s*\(|npm\s+run\s+build|disable\s+trigger|session_replication_role/i.test(runner.text+helper.text));
});

test('actual runner reuses owned ports, installs prerequisites and passes concurrent migration text unwrapped',async()=>{
  const h=runnerHarness(),result=await h.run();
  assert.equal(result.newCluster,false);assert.equal(result.production,false);assert.equal(result.deployed,false);
  assert.equal(result.old155ArchivePreserved,true);assert.equal(result.old155ArchiveBytes,12);
  assert.deepEqual(h.env,h.baseline);
  assert.deepEqual(h.calls.filter(c=>c[0]==='reuse'),[['reuse',['--selected-stopped-local-cluster']]]);
  const names=h.calls.filter(c=>c[0]==='read').map(c=>c[1]);
  for(const [prior,next] of [['125_','162_'],['120_','167_'],['155_','156_']]){
    const first=names.findIndex(n=>n.includes(prior)),second=names.findIndex(n=>n.includes(next));assert(first>=0&&second>first,prior+' before '+next);
  }
  const concurrent=names.find(n=>n.includes('160_'));
  assert(h.calls.some(c=>c[0]==='query'&&c[1]==='owned:'+h.original(concurrent)));
  assert(!h.calls.some(c=>c[0]==='body'&&c[1]===concurrent));
  assert(h.calls.some(c=>c[0]==='query'&&c[1].includes('151_')));
  assert(h.calls.some(c=>c[0]==='exec'&&c[1].startsWith('set search_path=owned_synthetic;')));
});

test('actual archive guards detect either saved byte text or SHA change and still restore temporary secrets',async()=>{
  for(const field of ['artifactText','artifactSha256']){
    const h=runnerHarness(field);await assert.rejects(h.run(),{name:'AssertionError'});assert.deepEqual(h.env,h.baseline);
    assert(!h.calls.some(c=>c[0]==='pass'&&c[1].includes('original155')));
  }
});

test('real correction/revision RPC path uses the current evidence and a genuinely distinct final proposal',()=>{
  const sql=[],prepared={revision:3,current:{operationId:'current-approved'}},view={canApprove:true,review:{submittedRevision:4},evidenceToken:'evidence',current:{operationId:'current-approved'}};
  let n=0;
  const context={assert,exec:statement=>{sql.push(statement);return JSON.stringify(statement.includes("\"mode\":\"prepare\"")?prepared:view);},
    quote:JSON.stringify,json:JSON.stringify,next:()=>String(++n),d:{site:'site',owner:'real-owner'},h:{workerId:'worker',employeeAuthUserId:'real-member'},rootRequest:'root-request',rootApproval:'root-approval',policyRevision:2};
  vm.createContext(context);vm.runInContext('globalThis.revise='+initializer(helper,'revise'),context);
  const proposed={startAt:'2026-10-05T09:00:00.000000Z',endAt:'2026-10-05T17:00:00.000000Z',breaks:[]};
  assert.deepEqual(plain(context.revise(proposed)),{request:'1',approval:'2'});
  assert.equal(sql.length,4);
  assert(sql[0].includes('faolla_attendance_revision_self_v2')&&sql[0].includes('real-member'));
  assert(sql[1].includes('"expectedEffectiveOperationId":"current-approved"'));
  assert(sql[2].includes('faolla_attendance_revision_decide_v2')&&sql[2].includes('real-owner'));
  assert(sql[3].includes('"expectedRevision":4')&&sql[3].includes('"expectedEvidence":"evidence"'));
  const changed={finalProposal:proposed,h:{slot:{endAt:proposed.endAt}},move:(value,minutes)=>new Date(Date.parse(value)+minutes*60000).toISOString(),revise:value=>value};
  vm.createContext(changed);const value=vm.runInContext(initializer(helper,'changedRevision'),changed);
  assert.equal(Date.parse(value.endAt),Date.parse(proposed.endAt)-60000);assert.equal(value.startAt,proposed.startAt);
  assert(helper.text.includes('public.faolla_attendance_correction_self_v3('));assert(helper.text.includes('public.faolla_attendance_correction_decide_v1('));
  assert(!/\b(?:update|delete\s+from)\s+public\.merchant_attendance_/i.test(helper.text));
  const protectedTables=nodes(helper,n=>ts.isCallExpression(n)&&n.expression.getText(helper)==='d.fingerprint'&&ts.isArrayLiteralExpression(n.arguments[0]));
  assert.equal(protectedTables.length,3);
  const expected=['merchant_attendance_events','merchant_attendance_shift_schedule_relations','merchant_attendance_shift_plan_adoptions','merchant_attendance_plan_rule_operations','merchant_attendance_plan_rule_artifacts'];
  for(const call of protectedTables)assert.deepEqual(call.arguments[0].elements.map(n=>n.text),expected);
});

test('three-entry paused replay checks actually reject changed receipts and side effects',()=>{
  const loop=nodes(helper,n=>ts.isForOfStatement(n)&&n.expression.getText(helper)==='[review,eventReview,clearance]');assert.equal(loop.length,1);
  const statements=loop[0].parent.statements,index=statements.indexOf(loop[0]);
  const code=statements.slice(index-1,index+2).map(n=>n.getText(helper)).join('\n');
  function run({badReceipt=false,changedFacts=false}={}){
    let reads=0;const calls=[],receipt={item:{outcome:'cleared',revision:2}};
    const context={assert,review,eventReview,clearance,cleared:{operationId:'same-operation'},saved:{receipt},
      all:()=>++reads===1||!changedFacts?'same-facts':'changed-facts',submit:(command,options)=>{calls.push([command,options]);return {receipt:badReceipt?{item:{outcome:'follow_up'}}:receipt};}};
    vm.runInNewContext(code,context);return plain(calls);
  }
  const calls=run();assert.deepEqual(calls.map(c=>c[1]),[review,eventReview,clearance].map(name=>({name,allow:false,enabled:false,capture:true})));
  assert(calls.every(c=>c[0].operationId==='same-operation'));
  assert.throws(()=>run({badReceipt:true}),{name:'AssertionError'});assert.throws(()=>run({changedFacts:true}),{name:'AssertionError'});
});

test('browser ports only narrow fresh clearance and retain real actor, GET-only admin/self and RPC allowlist guards',async()=>{
  const statements=[];
  const execute=(input,service)=>service.rpc(input.name,{...input.args,p_auth_user_id:input.authUserId});
  const handle=async(request,deps)=>deps.execute({...request.input,authUserId:(await deps.authenticate()).user.id});
  const modules={executePlanExceptions:execute,executeAttendanceAdmin:execute,executeAttendanceSelf:execute,executeEventNotifications:execute,
    handlePlanExceptions:handle,handleAttendanceAdmin:handle,handleAttendanceSelf:handle,handleEventNotifications:handle};
  const d={site:'site',owner:'owner-auth',owned:{schema:'owned'}},h={employeeId:'employee',workerId:'worker',employeeAuthUserId:'member-auth',slot:{id:'slot'}};
  const context={assert,review,eventReview,clearance,require:()=>modules,quote:JSON.stringify,json:JSON.stringify};
  vm.createContext(context);vm.runInContext(functionText(helper,'buildPorts'),context);
  const ports=context.buildPorts({d,h,call:sql=>{statements.push(sql);return {};},all:()=> 'unchanged'});
  assert.equal(ports.scope,d.owned);assert.equal(ports.syntheticAuth,true);
  const request=(name,args={})=>({method:'GET',input:{name,args}});
  await ports.handleException(request(clearance,{p_allow_clearance:true}),'owner',{clearanceEnabled:false});
  assert(statements.at(-1).includes('p_allow_clearance=>false'));assert(statements.at(-1).includes('p_auth_user_id=>"owner-auth"'));
  await ports.handleException(request(clearance,{p_allow_clearance:false}),'owner',{clearanceEnabled:true});
  assert(statements.at(-1).includes('p_allow_clearance=>false'));
  await ports.handleException(request(review),'self',{clearanceEnabled:false});
  assert(statements.at(-1).startsWith('public.'+review+'('));assert(!statements.at(-1).includes('p_allow_clearance'));assert(statements.at(-1).includes('member-auth'));
  await ports.handleSelf(request('faolla_attendance_self_bound_v1'));await ports.handleNotifications(request('faolla_attendance_event_notifications_v1'));
  assert.throws(()=>ports.handleAdmin({method:'POST'}),{name:'AssertionError'});assert.throws(()=>ports.handleSelf({method:'POST'}),{name:'AssertionError'});
  const before=statements.length;await assert.rejects(ports.handleException(request('arbitrary_rpc')),{name:'AssertionError'});
  await assert.rejects(ports.handleException(request(review,{'p_bad);drop':true})),{name:'AssertionError'});assert.equal(statements.length,before);
});

test('fault injection and exact-PID guards remain, with the independent boundary result awaited before browser',()=>{
  const start=helper.text.indexOf("phase='atomic-capture'"),end=helper.text.indexOf("phase='explicit-read-note'",start);assert(start>=0&&end>start);
  const section=helper.text.slice(start,end);
  for(const guard of ["errcode='23514'",'assert.equal(all(),beforeFailure)','finally{exec(',
    'assert.equal(d.definitions(),beforeFailureDefs)','assert.equal(d.tableCatalog(),beforeFailureCatalog)','assert(race.witnessed)',
    'assert.equal(captureRows(losing.operationId).length,0)'])assert(section.includes(guard),guard);
  assert(!section.includes('disable trigger'));assert(!section.includes('create or replace'));
  // Root connected this independently tested helper while these checks were
  // being written. Verify wiring, not successful execution of its SQL.
  const boundary=named(helper,'boundaries');assert(ts.isAwaitExpression(boundary.initializer));
  assert.equal(boundary.initializer.expression.expression.getText(helper),'verifyPlanClearanceBoundariesNative');
  assert(boundary.pos<named(helper,'ports').pos);
  assert.equal(nodes(helper,n=>ts.isImportDeclaration(n)&&n.moduleSpecifier.text.includes('boundaries-native')).length,1);
  const returned=nodes(helper,n=>ts.isReturnStatement(n)&&n.expression&&ts.isObjectLiteralExpression(n.expression)
    &&n.expression.properties.some(p=>p.name?.getText(helper)==='actualPeriodReseal'));
  assert.equal(returned.length,1);assert(returned[0].expression.properties.some(p=>ts.isShorthandPropertyAssignment(p)&&p.name.text==='boundaries'));
});
