// Bounded SOURCE/model tests only: no browser, bundler, SQL or real Auth starts.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import {createManagementBrowserModel,managementBrowserPaths as p,managementBrowserLimits,managementRulesBrowserLimits,managementCredentialsBrowserLimits,managementRevisionsBrowserLimits} from './attendance-management-delegated-browser.mjs';
const require=createRequire(import.meta.url),m=require('../../src/lib/merchantAttendanceManagementDelegation.ts'),
 a=require('../../src/lib/merchantAttendanceDelegatedAudit.ts'),g=require('../../src/lib/merchantAttendanceDelegatedGroups.ts'),
 cfg=require('../../src/lib/merchantAttendanceDelegatedConfiguration.ts'),cfgUi=require('../../src/lib/merchantAttendanceDelegatedConfigurationUi.ts'),
 r=require('../../src/lib/merchantAttendanceDelegatedRules.ts'),rUi=require('../../src/lib/merchantAttendanceDelegatedRulesUi.ts'),
 cr=require('../../src/lib/merchantAttendanceDelegatedCredentials.ts'),crUi=require('../../src/lib/merchantAttendanceDelegatedCredentialsUi.ts'),
 rv=require('../../src/lib/merchantAttendanceDelegatedRevisions.ts'),rvUi=require('../../src/lib/merchantAttendanceDelegatedRevisionsUi.ts');
const origin='http://127.0.0.1',id=n=>`20400000-0000-4000-8000-${String(n).padStart(12,'0')}`,
 headers=actor=>({'x-synthetic-actor':actor}),body=(query,command)=>JSON.stringify({query,command});
const read=async(model,path,q,queryString,actor=model.seed.delegate)=>model.respond(origin+path+'?'+queryString(q),'GET','',headers(actor));
test('202–205 runner is inert, finite, in-memory and cleanup-bound; imports do not launch it',async()=>{
 assert.deepEqual(managementBrowserLimits,{groups:7,api:60,http:100,posts:5,ttlMs:180000,mobileWidth:390});
 const source=await readFile(new URL('./attendance-management-delegated-browser.mjs',import.meta.url),'utf8');
 assert.equal((source.match(/await group\('/g)??[]).length,17);
 const legacy=source.slice(source.indexOf("if(suite==='legacy'){"),source.indexOf('await runRulesGroups();'));
 assert.equal((legacy.match(/await group\('/g)??[]).length,7);
 for(const exact of ['write:false','--run-local',"serviceWorkers:'block'",'acceptDownloads:false','API_cap','HTTP_cap','POST_cap',
  'owned context','owned browser','HTTP work','owned listener','esbuild','original_writer_POST_forbidden','syntheticAuth:true','actualSql:false'])assert(source.includes(exact),exact);
 assert.doesNotMatch(source,/writeFile|mkdir|saveAs|execSync|child_process|supabase\/supabase-js/);
 assert.match(source,/download\.cancel\(\)/);assert.match(source,/objectUrls\(\)/);
});
test('actual hosts and synthetic Auth remain distinct, no merchant inventory or fabricated existing choices',async()=>{
 const model=await createManagementBrowserModel(),e=model.seed.enterprise;
 const response=await model.respond(origin+p.overview+'?siteId='+e.siteId,'GET','',{'x-merchant-access-token':e.tokens.employee}),actual=JSON.parse(response.text);
 assert.equal(actual.currentAuthUserId,model.seed.delegate);assert.equal(actual.actor.id,model.seed.employeeId);assert.notEqual(actual.currentAuthUserId,actual.actor.id);
 assert.equal(actual.snapshot.employees.length,0);assert(actual.actor.permissions.includes('attendance.correction.review'));
 const entry=await readFile(new URL('./attendance-management-delegated-browser-entry.tsx',import.meta.url),'utf8');
 for(const exact of ['MerchantAttendanceAdminPanel','MerchantEnterpriseManager','MerchantAttendanceManagementDelegatedLauncher','<StrictMode>',
  'grantEnabled={config.grant} auditEnabled={config.audit} groupsEnabled={config.groups} configurationEnabled={config.configuration}','accessToken={seed.enterprise.tokens[config.identity]}'])assert(entry.includes(exact),exact);
 assert.doesNotMatch(entry,/localStorage|setInterval|window\.open|supabase\.auth|sessionStorage\.removeItem/);
});
test('actual group-action wrapped select label includes option text: prefix-labelled control, not exact empty-control text',async()=>{
 const React=require('react'),{renderToStaticMarkup}=require('react-dom/server'),Panel=require('../../src/components/enterprise/MerchantAttendanceManagementDelegatedPanel.tsx').default,
  model=await createManagementBrowserModel(),html=renderToStaticMarkup(React.createElement(Panel,{siteId:model.seed.siteId,actorId:model.seed.owner,ownerMode:true,
   grantEnabled:false,auditEnabled:true,groupsEnabled:false,isCurrentAuth:()=>true,onClose:()=>{},apiFetch:()=>assert.fail('SSR is local')})),
  label=html.match(/<label[^>]*>唯一组动作[\s\S]*?<\/label>/)?.[0];
 assert(label);const text=label.replace(/<[^>]+>/g,'');assert.notEqual(text,'唯一组动作');assert.match(text,/^唯一组动作/);assert.equal((label.match(/<option /g)??[]).length,4);
 const runner=await readFile(new URL('./attendance-management-delegated-browser.mjs',import.meta.url),'utf8');
 assert.equal((runner.match(/getByLabel\(\/\^唯一组动作\/\)/g)??[]).length,2);assert.doesNotMatch(runner,/getByLabel\('唯一组动作',\{exact:true\}\)/);
});
test('202 synthetic structured scoped grant uses actual parser and complete actor-command SHA then minimal original GET',async()=>{
 const model=await createManagementBrowserModel(),query={siteId:model.seed.siteId,mode:'write'},command={action:'grant',operationId:id(800),
  delegateEmployeeId:model.seed.employeeId,delegateAuthUserId:model.seed.delegate,delegatedAction:'audit_view',scope:{kind:'audit_company',sources:['config']},
  validFrom:'2026-10-08T10:00:00.000000Z',validUntil:'2026-10-09T10:00:00.000000Z',reason:'Synthetic structured grant'};
 const posted=await model.respond(origin+p.management,'POST',body(query,command),headers(model.seed.owner)),value=await m.parseManagementDelegationResult(JSON.parse(posted.text).data,query,model.seed.owner,command);
 assert.equal(value.receipt.commandFingerprint,await m.managementDelegationCommandFingerprint(model.seed.siteId,model.seed.owner,command));
 const q={siteId:query.siteId,mode:'recover',operationId:command.operationId},recovered=await read(model,p.management,q,m.managementDelegationQueryString,model.seed.owner);
 assert.deepEqual(Object.keys(JSON.parse(recovered.text).data).sort(),['protocol','siteId','actorId','readAt','kind','receipt'].sort());
 await assert.rejects(model.respond(origin+p.management,'POST',body(query,command),headers(model.seed.owner)),/duplicate_POST/);
 await assert.rejects(read(model,p.management,q,m.managementDelegationQueryString,model.seed.delegate));assert.equal(model.writes.length,1);
});
test('203 real scoped list/detail/export contracts and CSV helper work on clearly synthetic source, recovery has no body',async()=>{
 const model=await createManagementBrowserModel(),q={siteId:model.seed.siteId,grantId:model.seed.auditGrantId,mode:'list',source:'config',
  fromAt:'2026-10-08T00:00:00.000000Z',toAt:'2026-10-09T00:00:00.000000Z',asOf:null,cursorAt:null,cursorId:null};
 const listed=await read(model,p.audit,q,a.delegatedAuditQueryString),items=await a.parseDelegatedAuditResult(JSON.parse(listed.text).data,q,model.seed.delegate);
 assert.equal(items.items.length,1);assert.equal(items.nextCursor,null);
 const detail={siteId:q.siteId,grantId:q.grantId,mode:'detail',source:'config',sourceOperationId:items.items[0].operationId},r=await read(model,p.audit,detail,a.delegatedAuditQueryString);
 assert.equal(JSON.parse(r.text).data.row.after.displayName,'Synthetic browser worker');
 const exp={siteId:q.siteId,grantId:q.grantId,mode:'export',source:q.source,fromAt:q.fromAt,toAt:q.toAt},command={action:'export',operationId:id(801)},
  posted=await model.respond(origin+p.audit,'POST',body(exp,command),headers(model.seed.delegate)),value=await a.parseDelegatedAuditResult(JSON.parse(posted.text).data,exp,model.seed.delegate,command),
  csv=await a.buildDelegatedAuditCsv(value,exp,model.seed.delegate,command);
 assert.match(csv.csv,/Synthetic browser worker/);assert.equal(csv.receipt.count,1);assert.match(csv.filename,/\.csv$/);
 const recover={siteId:q.siteId,mode:'recover',operationId:command.operationId},minimal=JSON.parse((await read(model,p.audit,recover,a.delegatedAuditQueryString)).text).data;
 assert.equal(minimal.kind,'receipt');assert(!('payload'in minimal));assert(!('rows'in minimal));
});
test('204 explicit context/current CAS and one UI-compatible original receipt; unknown/wrongSHA cannot masquerade as complete match',async()=>{
 const model=await createManagementBrowserModel(),q={siteId:model.seed.siteId,grantId:model.seed.groupGrantId,mode:'context',operationId:null},
  response=await read(model,p.groups,q,g.delegatedGroupsQueryString),context=await g.parseDelegatedGroupsResult(JSON.parse(response.text).data,q,model.seed.delegate);
 assert.equal(context.context.group.revision,3);assert.equal(context.scope.groupId,model.seed.groupId);assert.equal(context.context.items.length,0);
 const command={action:'save_group',operationId:id(802),groupId:model.seed.groupId,expectedRevision:3,name:'Synthetic revised Kitchen',description:'',active:true,reason:'Synthetic explicit scoped update'},
  posted=await model.respond(origin+p.groups,'POST',body(q,command),headers(model.seed.delegate)),receipt=JSON.parse(posted.text).data.receipt,
  expected=await g.delegatedGroupsCommandFingerprint(q,model.seed.delegate,command);
 assert.equal(receipt.commandFingerprint,expected);assert.equal(receipt.referenceId,command.groupId);assert.equal(receipt.revision,4);
 const recover={...q,mode:'recover',operationId:command.operationId};model.recovery('null');assert.equal(JSON.parse((await read(model,p.groups,recover,g.delegatedGroupsQueryString)).text).data.receipt,null);
 model.recovery('wrong-sha');assert.notEqual(JSON.parse((await read(model,p.groups,recover,g.delegatedGroupsQueryString)).text).data.receipt.commandFingerprint,expected);
 model.recovery('valid');assert.equal(JSON.parse((await read(model,p.groups,recover,g.delegatedGroupsQueryString)).text).data.receipt.commandFingerprint,expected);
 await assert.rejects(read(model,p.groups,{...recover,grantId:id(900)},g.delegatedGroupsQueryString));assert.equal(model.writes.length,1);
});
test('205 scoped worker and location use REAL strict contexts/helper, context-only identity and GLOBAL CAS, then exact minimal GET',async()=>{
 const model=await createManagementBrowserModel();
 for(const [kind,grantId,expectedVersion,targetVersion]of[['worker',model.seed.workerConfigurationGrantId,10,3],['location',model.seed.locationConfigurationGrantId,14,4]]){
  const query={siteId:model.seed.siteId,grantId,mode:'context',operationId:null},response=await read(model,p.configuration,query,cfg.delegatedConfigurationQueryString),
   context=await cfg.parseDelegatedConfigurationResult(JSON.parse(response.text).data,query,model.seed.delegate);
  assert.equal(context.context.settingsVersion,expectedVersion);assert.equal(context.context.targetVersion,targetVersion);assert.notEqual(expectedVersion,targetVersion);
  const draft=kind==='worker'?{kind,workerNo:'S205-edited',displayName:'Synthetic205 edited worker',locationId:model.seed.configurationLocationId,startsOn:'2026-10-01',active:true,acknowledged:true}
   :{kind,name:'Synthetic205 edited location',timeZone:'UTC',active:true,acknowledged:true},
   command=await cfgUi.buildManagementConfigurationCommand(context,query,model.seed.delegate,draft,id(kind==='worker'?803:804));
  assert.equal(command.expectedVersion,expectedVersion);assert.equal(command.values.id,kind==='worker'?model.seed.configurationWorkerId:model.seed.configurationLocationId);
  if(kind==='worker'){assert.equal(command.values.employeeId,model.seed.configurationEmployeeId);assert.notEqual(command.values.employeeId,model.seed.employeeId);}
  await assert.rejects(model.respond(origin+p.configuration,'POST',body(query,{...command,expectedVersion:targetVersion}),headers(model.seed.delegate)));
  await assert.rejects(model.respond(origin+p.configuration,'POST',body(query,{...command,values:{...command.values,id:id(999)}}),headers(model.seed.delegate)));
  const posted=await model.respond(origin+p.configuration,'POST',body(query,command),headers(model.seed.delegate)),
   value=await cfg.parseDelegatedConfigurationResult(JSON.parse(posted.text).data,query,model.seed.delegate,command),expected=await cfg.delegatedConfigurationCommandFingerprint(query,model.seed.delegate,command);
  assert.equal(value.receipt.commandFingerprint,expected);assert.equal(value.receipt.revision,expectedVersion+1);assert.equal(value.receipt.referenceId,command.values.id);
  const recover={...query,mode:'recover',operationId:command.operationId};
  model.recovery('null');assert.equal(JSON.parse((await read(model,p.configuration,recover,cfg.delegatedConfigurationQueryString)).text).data.receipt,null);
  model.recovery('wrong-sha');const wrong=JSON.parse((await read(model,p.configuration,recover,cfg.delegatedConfigurationQueryString)).text).data;
  await assert.rejects(cfg.parseDelegatedConfigurationResult(wrong,recover,model.seed.delegate,command));
  model.recovery('valid');const result=JSON.parse((await read(model,p.configuration,recover,cfg.delegatedConfigurationQueryString)).text).data;
  assert.deepEqual(Object.keys(result).sort(),['protocol','siteId','actorId','readAt','kind','receipt'].sort());
  assert.equal((await cfg.parseDelegatedConfigurationResult(result,recover,model.seed.delegate,command)).receipt.commandFingerprint,expected);
  await assert.rejects(read(model,p.configuration,{...recover,grantId:id(999)},cfg.delegatedConfigurationQueryString));
  await assert.rejects(read(model,p.configuration,recover,cfg.delegatedConfigurationQueryString,model.seed.owner));
 }
 assert.equal(model.writes.length,2);assert.deepEqual(model.writes.map(w=>w.command.kind),['worker','location']);
});
test('205 browser SOURCE uses real host ENV and explicit false prop, scoped inputs, confirmed cancellation and TWO saves inside FIVE total POST',async()=>{
 const runner=await readFile(new URL('./attendance-management-delegated-browser.mjs',import.meta.url),'utf8'),entry=await readFile(new URL('./attendance-management-delegated-browser-entry.tsx',import.meta.url),'utf8');
 for(const exact of ["NEXT_PUBLIC_FAOLLA_ATTENDANCE_DELEGATED_CONFIGURATION_ENABLED:'1'",'configuration:false','configuration:true',
  '205_actual_admin_structured_grant_cancel_split_flags_manager_worker_save_shared_pending','205_actual_manager_fresh_location_context_global_CAS_user_save_original_GET',
  "getByLabel('唯一配置动作',{exact:true})","selectOption('location_save')",'confirmationCount,confirms+1',
  "readConfiguration(model.seed.workerConfigurationGrantId)","readConfiguration(model.seed.locationConfigurationGrantId)","hold(path,'POST'),paths.configuration",
  "['读取审计首页（GET）','读取此授权上下文（GET）','读取配置授权上下文（GET）']","pending.command.expectedVersion,10","pending.command.expectedVersion,14",
  "model.writes.filter(w=>w.domain==='configuration').map(w=>w.command.kind),['worker','location']",'configurationOwnerGrantConfirmedThenCanceled:true'])assert(runner.includes(exact),exact);
 assert.match(entry,/groupsEnabled=\{config\.groups\} configurationEnabled=\{config\.configuration\}/);
 assert.doesNotMatch(runner,/fill\([^)]*JSON\.stringify|setAttribute|innerHTML\s*=|saveAs/);
 const React=require('react'),{renderToStaticMarkup}=require('react-dom/server'),Panel=require('../../src/components/enterprise/MerchantAttendanceManagementDelegatedPanel.tsx').default,
  model=await createManagementBrowserModel(),html=renderToStaticMarkup(React.createElement(Panel,{siteId:model.seed.siteId,actorId:model.seed.owner,ownerMode:true,
   grantEnabled:true,configurationEnabled:true,isCurrentAuth:()=>true,onClose:()=>{},apiFetch:()=>assert.fail('SSR is local')})),
  label=html.match(/<label[^>]*>唯一配置动作[\s\S]*?<\/label>/)?.[0];
 assert(label);assert.match(label,/aria-label="唯一配置动作"/);assert.equal((label.match(/<option /g)??[]).length,2);
 assert.match(label,/value="worker_save"/);assert.match(label,/value="location_save"/);
});
test('bounded actual runner source covers both guard lanes, double epochs, separate flags and only exact original GET',async()=>{
 const source=await readFile(new URL('./attendance-management-delegated-browser.mjs',import.meta.url),'utf8');
 for(const exact of ['我的受托周期','受托首次补正审批',"navigate('todos')",'wrong-sha','仅 GET 核验原编号',"hold(path,'POST')",
  'requester:4,identity:\'other\'','requester:3,identity:\'employee\'','authValid(false)','authValid(true)','visibility(true)','pagehide()',
  '授予明确审计权限（一次提交）','生成审计 CSV（一次提交）','保存指定组（一次提交）','390px_dialog_overflow'])assert(source.includes(exact),exact);
 const model=await createManagementBrowserModel();await assert.rejects(model.respond(origin+'/api/unknown','GET','',headers(model.seed.owner)));
 await assert.rejects(model.respond(origin+p.groups,'GET','',headers(model.seed.employeeId)));assert.equal(model.writes.length,0);
});
test('206 extension is explicit, separate from original seven groups, strict caps, zero downloads and no bundle files',async()=>{
 assert.deepEqual(managementRulesBrowserLimits,{groups:4,api:32,http:42,posts:3,ttlMs:180000,mobileWidth:390});
 const runner=await readFile(new URL('./attendance-management-delegated-browser.mjs',import.meta.url),'utf8'),
  entry=await readFile(new URL('./attendance-management-delegated-browser-entry.tsx',import.meta.url),'utf8'),
  rules=runner.slice(runner.indexOf('const runRulesGroups='),runner.indexOf(' const runCredentialsGroups='));
 assert.equal((rules.match(/await group\('/g)??[]).length,4);
 for(const exact of ['--run-local-rules',"NEXT_PUBLIC_FAOLLA_ATTENDANCE_DELEGATED_RULES_ENABLED:'1'",'ownerRuleActionsInspected:8','ownerRuleGrantPosts:1',
  'nestedOriginalOperationId:true','knownSameLayerRouteChoicesOnly:true','previewBeforeConfirmation:true','actualSql:false','assert.equal(downloads,0)'])assert(runner.includes(exact),exact);
 assert.match(entry,/rulesEnabled=\{config\.rules\}/);assert.match(entry,/configuration:false,rules:false/);
 assert.doesNotMatch(runner,/writeFile|mkdir|saveAs|fill\([^)]*JSON\.stringify|setAttribute|innerHTML\s*=/);
 assert.match(rules,/for\(const value of actions\)/);assert.match(rules,/confirmationCount,confirms\+1/);
 assert.match(rules,/getByLabel\(\/\^规则明确动作\/\)/);assert.match(rules,/getByLabel\(\/\^路由目标\/\)/);
 assert.doesNotMatch(rules,/getByLabel\('规则明确动作',\{exact:true\}\)/);
});
test('206 base actual strict context/helper preserve complete unallowed baseline and nested operationId SHA recovery',async()=>{
 const model=await createManagementBrowserModel(),query=rUi.managementRulesContextQuery(model.seed.siteId,model.seed.baseRulesGrantId),
  rawContext=JSON.parse((await read(model,p.rules,query,r.delegatedRulesQueryString)).text).data,
  context=await r.parseDelegatedRulesResult(rawContext,query,model.seed.delegate),draft=rUi.managementRulesDraftFromContext(context);
 assert.equal(context.context.family,'base');assert.deepEqual(draft.rules.earlyGraceMinutes,{mode:'value',minutes:23});
 const command=await rUi.buildManagementRulesCommand(context,query,model.seed.delegate,{...draft,rules:{...draft.rules,lateGraceMinutes:{mode:'value',minutes:12}},reason:'Synthetic206 explicit baseline save',acknowledged:true},id(810));
 assert.equal(command.operationId,undefined);assert.equal(command.decision.operationId,id(810));assert.equal(command.decision.expectedRevision,4);assert.equal(command.decision.expectedSettingsVersion,9);
 const posted=await model.respond(origin+p.rules,'POST',body(query,command),headers(model.seed.delegate)),value=await r.parseDelegatedRulesResult(JSON.parse(posted.text).data,query,model.seed.delegate,command);
 assert.equal(value.receipt.referenceId,id(810));assert.equal(value.receipt.commandFingerprint,await r.delegatedRulesCommandFingerprint(query,model.seed.delegate,command));
 const recover={...query,mode:'recover',operationId:command.decision.operationId};
 for(const mode of ['null','wrong-sha','valid']){model.recovery(mode);const data=JSON.parse((await read(model,p.rules,recover,r.delegatedRulesQueryString)).text).data;
  assert.deepEqual(Object.keys(data).sort(),['protocol','siteId','actorId','readAt','kind','receipt'].sort());
  if(mode==='null')assert.equal((await r.parseDelegatedRulesResult(data,recover,model.seed.delegate,command)).receipt,null);
  else if(mode==='wrong-sha')await assert.rejects(r.parseDelegatedRulesResult(data,recover,model.seed.delegate,command));
  else assert.equal((await r.parseDelegatedRulesResult(data,recover,model.seed.delegate,command)).receipt.operationId,id(810));
 }
 await assert.rejects(rUi.buildManagementRulesCommand(context,query,model.seed.delegate,{...draft,rules:{...draft.rules,earlyGraceMinutes:{mode:'inherit'}},reason:'Illegal baseline reset',acknowledged:true},id(811)));
 await assert.rejects(read(model,p.rules,{...recover,grantId:id(999)},r.delegatedRulesQueryString));assert.equal(model.writes.length,1);
});

test('207 option is a separate three-group finite suite; original7/rules4 remain independently bounded',async()=>{
 assert.deepEqual(managementCredentialsBrowserLimits,{groups:3,api:45,http:60,posts:4,ttlMs:180000,mobileWidth:390});
 const runner=await readFile(new URL('./attendance-management-delegated-browser.mjs',import.meta.url),'utf8'),entry=await readFile(new URL('./attendance-management-delegated-browser-entry.tsx',import.meta.url),'utf8'),
  credentials=runner.slice(runner.indexOf(' const runCredentialsGroups='),runner.indexOf(' const runRevisionsGroups='));
 assert.equal((credentials.match(/await group\('/g)??[]).length,3);
 for(const exact of ['--run-local-credentials',"suite==='credentials'?[paths.terminals,paths.pin]",'ownerCredentialGrantPosts:0','ownerCredentialActionsInspected:4',
  'actualKdf:false','actualDevice:false','nonsecret_original_slot','timer_keeps_original','timeout:17000','wrongReceiptPreservesOriginal:true','lostReplyOnlyOriginalGet:true'])assert(runner.includes(exact),exact);
 assert.match(entry,/terminalsEnabled=\{config\.terminals\} pinEnabled=\{config\.pin\}/);assert.match(entry,/terminals:false,pin:false/);
 assert(!/\.screenshot\(|saveAs|download\(|createObjectURL|console\.|localStorage|deriveAttendancePin|scrypt|pinValue|pairSecret:/.test(credentials),'credentials_no_secret_export');
 assert.match(credentials,/HTMLInputElement\.prototype,'value'/);assert.match(credentials,/el\.value===''/);
 assert.match(runner,/suite==='credentials'\?\{NEXT_PUBLIC_FAOLLA_ATTENDANCE_DELEGATED_TERMINALS_ENABLED:'1'/);
});

test('208 explicit option is a separate three-group40API/3POST/50HTTP/90s suite with actual hosts and no secret/files',async()=>{
 assert.deepEqual(managementRevisionsBrowserLimits,{groups:3,api:40,http:50,posts:3,ttlMs:90000,mobileWidth:390});
 const runner=await readFile(new URL('./attendance-management-delegated-browser.mjs',import.meta.url),'utf8'),entry=await readFile(new URL('./attendance-management-delegated-browser-entry.tsx',import.meta.url),'utf8'),
  revisions=runner.slice(runner.indexOf(' const runRevisionsGroups='),runner.indexOf('\n try{\n  files='));
 assert.equal((revisions.match(/await group\('/g)??[]).length,3);
 for(const exact of ['--run-local-revisions',"suite==='revisions'?[paths.revisions]","NEXT_PUBLIC_FAOLLA_ATTENDANCE_DELEGATED_REVISIONS_ENABLED:'1'",'ownerRevisionGrantPosts:0',
  'originalSubmittedProposedReadonly:true','oldV2StrictParser:true','actualSql:false','grant_only_one_revision_action','flagoff_no_new_revision_write'])assert(runner.includes(exact),exact);
 assert.match(entry,/revisionsEnabled=\{config\.revisions\}/);assert.match(entry,/revisions:false/);
 assert(!/screenshot\(|writeFile|saveAs|download\(|createObjectURL|console\.|setAttribute|innerHTML|supabase\.auth|scrypt|deriveAttendancePin/.test(revisions));
 for(const exact of ["hold(path,'POST'),paths.revisions",'wrong-sha','visibility(true)','pagehide()','authValid(false)','authValid(true)',"identity:'other'",'readonlyReview(\'approve\')','readonlyReview(\'reject\')'])assert(revisions.includes(exact),exact);
 //Root's207 actual-label fixes are still present;208 must not revert them.
 assert.match(runner,/const places=form\.getByLabel\(\/\^PIN授权地点 ID/);assert.match(runner,/pairLabel=\/\^本次临时配对码/);
});

test('208 synthetic contexts reuse strict old later-cycle model and actual readonly three-way component; independent target identities',async()=>{
 const model=await createManagementBrowserModel(),contexts=[];
 for(const[which,target]of Object.entries(model.seed.revisions)){
  const query=rvUi.managementRevisionsContextQuery(model.seed.siteId,target.grantId,target.requestId),raw=JSON.parse((await read(model,p.revisions,query,rv.delegatedRevisionsQueryString)).text).data,
   context=await rv.parseDelegatedRevisionsResult(raw,query,model.seed.delegate);contexts.push(context);
  assert.equal(context.context.review.protocol,'revision-decision-v2');assert.equal(context.context.review.current.revision,2);assert.equal(context.context.review.review.submittedRevision,2);
  assert.equal(context.context.canApprove,which==='approve');assert.equal(context.context.canReject,which==='reject');assert.equal(context.scope.employeeId,target.employeeId);assert.equal(context.scope.employeeAuthUserId,target.employeeAuthUserId);
  const React=require('react'),{renderToStaticMarkup}=require('react-dom/server'),{DelegatedRevisionReview}=require('../../src/components/enterprise/MerchantAttendanceManagementDelegatedPanel.tsx'),
   html=renderToStaticMarkup(React.createElement(DelegatedRevisionReview,{context}));
  for(const label of ['原始打卡（保留不变）','提交时核定（修订 2）','本次员工声明（尚未生效）'])assert(html.includes('aria-label="'+label+'"'),label);
  assert.doesNotMatch(html,/<input|<select|<textarea/);assert.match(html,/不支持撤销决定/);
 }
 assert.notEqual(contexts[0].scope.workerId,contexts[1].scope.workerId);assert.notEqual(contexts[0].scope.employeeId,contexts[1].scope.employeeId);
 assert.notEqual(contexts[0].context.review.review.review.application.basis.events[0].id,contexts[1].context.review.review.review.application.basis.events[0].id);assert.equal(model.writes.length,0);
});

test('208 approve/reject exact UI builder makes one old7key command per grant; minimal fullSHA recover and actual effect/null ref',async()=>{
 const model=await createManagementBrowserModel();let operation=880;
 for(const[which,target]of Object.entries(model.seed.revisions)){
  const query=rvUi.managementRevisionsContextQuery(model.seed.siteId,target.grantId,target.requestId),raw=JSON.parse((await read(model,p.revisions,query,rv.delegatedRevisionsQueryString)).text).data,
   command=await rvUi.buildManagementRevisionsCommand(raw,query,model.seed.delegate,{reason:'Synthetic208 explicit '+which,acknowledged:true},id(operation++));
  assert.equal(Object.keys(command).length,7);assert.equal(command.action,which);assert.equal(command.expectedRevision,2);assert.equal(command.expectedEvidence,raw.context.review.evidenceToken);assert.equal(command.expectedBaseOperationId,raw.context.review.review.base.operationId);
  const posted=JSON.parse((await model.respond(origin+p.revisions,'POST',body(query,command),headers(model.seed.delegate))).text).data,
   value=await rv.parseDelegatedRevisionsResult(posted,query,model.seed.delegate,command);
  assert.equal(value.receipt.reference.requestId,target.requestId);assert.equal(value.receipt.reference.effectRevision,which==='approve'?3:null);
  const recovery={siteId:query.siteId,grantId:query.grantId,mode:'recover',operationId:command.operationId};
  for(const mode of ['null','wrong-sha','valid']){model.recovery(mode);const minimal=JSON.parse((await read(model,p.revisions,recovery,rv.delegatedRevisionsQueryString)).text).data;
   assert.deepEqual(Object.keys(minimal).sort(),['protocol','siteId','actorId','readAt','kind','receipt'].sort());assert.equal(Object.hasOwn(minimal,'context'),false);
   if(mode==='null')assert.equal((await rv.parseDelegatedRevisionsResult(minimal,recovery,model.seed.delegate,command)).receipt,null);
   else if(mode==='wrong-sha')await assert.rejects(rv.parseDelegatedRevisionsResult(minimal,recovery,model.seed.delegate,command));
   else assert.equal((await rv.parseDelegatedRevisionsResult(minimal,recovery,model.seed.delegate,command)).receipt.commandFingerprint,await rv.delegatedRevisionsCommandFingerprint(query,model.seed.delegate,command));
  }model.recovery('valid');
 }
 assert.deepEqual(model.writes.map(w=>w.command.action),['approve','reject']);assert.equal(model.writes.length,2);
});

test('208 exact grant/request/actor/location and original7key protocol reject cross-target or annul without writing',async()=>{
 const model=await createManagementBrowserModel(),target=model.seed.revisions.approve,query=rvUi.managementRevisionsContextQuery(model.seed.siteId,target.grantId,target.requestId),
  context=JSON.parse((await read(model,p.revisions,query,rv.delegatedRevisionsQueryString)).text).data,
  command=await rvUi.buildManagementRevisionsCommand(context,query,model.seed.delegate,{reason:'Synthetic208 exact only',acknowledged:true},id(882));
 for(const patch of [{action:'reject'},{action:'annul'},{expectedRevision:1},{expectedEvidence:'d'.repeat(32)},{expectedBaseOperationId:id(999)},{ownerId:model.seed.owner}])
  await assert.rejects(model.respond(origin+p.revisions,'POST',body(query,{...command,...patch}),headers(model.seed.delegate)));
 await assert.rejects(read(model,p.revisions,{...query,requestId:model.seed.revisions.reject.requestId},rv.delegatedRevisionsQueryString));
 await assert.rejects(read(model,p.revisions,query,rv.delegatedRevisionsQueryString,model.seed.owner));
 await assert.rejects(rvUi.buildManagementRevisionsCommand({...context,scope:{...context.scope,locationIds:[id(999)]}},query,model.seed.delegate,{reason:'No leaked place',acknowledged:true},id(883)));
 assert.equal(model.writes.length,0);await model.respond(origin+p.revisions,'POST',body(query,command),headers(model.seed.delegate));
 await assert.rejects(read(model,p.revisions,{siteId:query.siteId,grantId:model.seed.revisions.reject.grantId,mode:'recover',operationId:command.operationId},rv.delegatedRevisionsQueryString));
 await assert.rejects(read(model,p.revisions,{siteId:query.siteId,grantId:query.grantId,mode:'recover',operationId:command.operationId},rv.delegatedRevisionsQueryString,model.seed.other));assert.equal(model.writes.length,1);
});

test('207 synthetic terminal uses real ephemeral parser/hash/reference and retains only nonsecret command before minimal GET',async()=>{
 const model=await createManagementBrowserModel(),query=crUi.managementCredentialsQuery(model.seed.siteId,model.seed.terminalPrepareGrantId),
  context=JSON.parse((await read(model,p.terminals,query,cr.delegatedCredentialsQueryString)).text).data,
  transient=await crUi.buildManagementTerminalBody(context,query,model.seed.delegate,{label:'Synthetic test entrance',reason:'Explicit terminal prepare',acknowledged:true},id(850),'A'.repeat(43));
 assert('pairSecret' in transient);const posted=await model.respond(origin+p.terminals,'POST',JSON.stringify(transient),headers(model.seed.delegate)),
  value=await cr.parseDelegatedTerminalResult(JSON.parse(posted.text).data,query,model.seed.delegate,transient.command);
 assert.equal(value.receipt.reference.auditAction,'create');assert.equal(value.receipt.reference.terminalId,model.seed.credentialTerminalId);
 assert(!JSON.stringify({writes:model.writes,value,posted}).includes(transient.pairSecret),'no_pair_secret_retained');assert.equal(model.secretChecks.preparePosts,1);
 const recover={...query,mode:'recover',operationId:transient.command.operationId};
 for(const mode of ['null','wrong-sha','valid']){model.recovery(mode);const result=JSON.parse((await read(model,p.terminals,recover,cr.delegatedCredentialsQueryString)).text).data;
  assert.deepEqual(Object.keys(result).sort(),['protocol','siteId','actorId','readAt','kind','receipt'].sort());
  if(mode==='null')assert.equal((await cr.parseDelegatedTerminalResult(result,recover,model.seed.delegate,transient.command)).receipt,null);
  else if(mode==='wrong-sha')await assert.rejects(cr.parseDelegatedTerminalResult(result,recover,model.seed.delegate,transient.command));
  else assert.equal((await cr.parseDelegatedTerminalResult(result,recover,model.seed.delegate,transient.command)).receipt.operationId,id(850));
 }
 await assert.rejects(model.respond(origin+p.terminals,'POST',body(query,transient.command),headers(model.seed.delegate)));
 await assert.rejects(model.respond(origin+p.terminals,'POST',JSON.stringify({...transient,pairSecret:'E'.repeat(43)}),headers(model.seed.delegate)),/synthetic_pair_hash_mismatch/);
 assert.equal(model.writes.length,1);
});

test('207 member issue/revoke strict helpers bind fresh real revision and identity; PIN is transient with no KDF',async()=>{
 const model=await createManagementBrowserModel(),query=crUi.managementCredentialsQuery(model.seed.siteId,model.seed.memberPinIssueGrantId),
  context=JSON.parse((await read(model,p.pin,query,cr.delegatedCredentialsQueryString)).text).data,
  transient=await crUi.buildManagementPinBody(context,query,model.seed.delegate,{label:'',reason:'Explicit member issue',acknowledged:true},id(851),'8'.repeat(8)),
  posted=await model.respond(origin+p.pin,'POST',JSON.stringify(transient),headers(model.seed.delegate)),value=await cr.parseDelegatedPinResult(JSON.parse(posted.text).data,query,model.seed.delegate,transient.command);
 assert.equal(value.receipt.reference.revision,2);assert.equal(value.receipt.reference.employeeAuthUserId,model.seed.credentialAuthId);assert.equal(model.secretChecks.pinPosts,1);
 assert(!JSON.stringify({writes:model.writes,value,posted}).includes(transient.pin),'no_pin_retained');
 const revokeQuery=crUi.managementCredentialsQuery(model.seed.siteId,model.seed.memberPinRevokeGrantId),revokeContext=JSON.parse((await read(model,p.pin,revokeQuery,cr.delegatedCredentialsQueryString)).text).data,
  revoke=await crUi.buildManagementPinBody(revokeContext,revokeQuery,model.seed.delegate,{label:'',reason:'Explicit member revoke',acknowledged:true},id(852));
 assert.equal(revoke.command.expectedRevision,2);assert.equal(Object.hasOwn(revoke,'pin'),false);const revoked=await model.respond(origin+p.pin,'POST',JSON.stringify(revoke),headers(model.seed.delegate));
 assert.equal((await cr.parseDelegatedPinResult(JSON.parse(revoked.text).data,revokeQuery,model.seed.delegate,revoke.command)).receipt.reference.revision,3);
 const postimage=JSON.parse((await read(model,p.pin,query,cr.delegatedCredentialsQueryString)).text).data;assert.equal(postimage.context.status.revision,3);assert.equal(postimage.context.status.enabled,false);
 const independentQuery=crUi.managementCredentialsQuery(model.seed.siteId,model.seed.independentPinIssueGrantId),independent=JSON.parse((await read(model,p.pin,independentQuery,cr.delegatedCredentialsQueryString)).text).data,
  candidate=await crUi.buildManagementPinBody(independent,independentQuery,model.seed.delegate,{label:'',reason:'Read-only independent candidate',acknowledged:true},id(853),'7'.repeat(8));
 assert.equal(candidate.command.kind,'independent_pin');assert.equal(candidate.command.subjectId,model.seed.credentialSubjectId);
 assert.equal(Object.hasOwn(candidate.command,'employeeId'),false);assert.equal(Object.hasOwn(candidate.command,'employeeAuthUserId'),false);assert.equal(model.writes.length,2);
});

test('207 model rejects missing secrets, caller material, wrong actor/target and cross-domain recovery without broadening old writers',async()=>{
 const model=await createManagementBrowserModel(),query=crUi.managementCredentialsQuery(model.seed.siteId,model.seed.memberPinIssueGrantId),context=JSON.parse((await read(model,p.pin,query,cr.delegatedCredentialsQueryString)).text).data,
  transient=await crUi.buildManagementPinBody(context,query,model.seed.delegate,{label:'',reason:'Exact synthetic issue',acknowledged:true},id(854),'6'.repeat(8));
 for(const invalid of [{query,command:transient.command},{...transient,p_material:{verified:true}},{...transient,command:{...transient.command,employeeAuthUserId:model.seed.other}}])await assert.rejects(model.respond(origin+p.pin,'POST',JSON.stringify(invalid),headers(model.seed.delegate)));
 await assert.rejects(read(model,p.pin,query,cr.delegatedCredentialsQueryString,model.seed.employeeId));assert.equal(model.writes.length,0);
 await model.respond(origin+p.pin,'POST',JSON.stringify(transient),headers(model.seed.delegate));const recover={...query,mode:'recover',operationId:id(854)};
 await assert.rejects(read(model,p.terminals,recover,cr.delegatedCredentialsQueryString));await assert.rejects(read(model,p.pin,recover,cr.delegatedCredentialsQueryString,model.seed.other));
 assert.equal(model.writes.length,1);assert(!/"(?:pin|pairSecret|p_material|salt|verifier)":/.test(JSON.stringify(model.writes)),'durable_writes_secret_free');
});
test('206 known route choices use only strict saved same-layer pairs and actual SSR controls, no editable arbitrary route IDs',async()=>{
 const model=await createManagementBrowserModel(),query=rUi.managementRulesContextQuery(model.seed.siteId,model.seed.operationalDraftGrantId),
  context=await r.parseDelegatedRulesResult(JSON.parse((await read(model,p.rules,query,r.delegatedRulesQueryString)).text).data,query,model.seed.delegate),
  pairs=rUi.managementRulesKnownRoutes(context),baseline=rUi.managementRulesBaseline(context);
 assert.deepEqual(pairs,[{delegateEmployeeId:model.seed.knownRouteEmployeeId,delegateAuthUserId:model.seed.knownRouteAuthId}]);
 const invalid={...baseline,reviewRouting:{mode:'value',value:{...baseline.reviewRouting.value,leave:{delegateEmployeeId:id(980),delegateAuthUserId:id(981)}}}};
 assert.throws(()=>rUi.managementRulesChoicesForContext(context,invalid));
 const React=require('react'),{renderToStaticMarkup}=require('react-dom/server'),{DelegatedRuleChoices}=require('../../src/components/enterprise/MerchantAttendanceManagementDelegatedPanel.tsx'),
  html=renderToStaticMarkup(React.createElement(DelegatedRuleChoices,{context,value:baseline,onChange:()=>assert.fail('SSR no changes')})),pair=model.seed.knownRouteEmployeeId+'/'+model.seed.knownRouteAuthId;
 assert.equal((html.match(/<option value="owner"[^>]*>/g)??[]).length,4);assert.equal((html.match(new RegExp('<option value="'+pair+'"[^>]*>','g'))??[]).length,4);
 assert.doesNotMatch(html,/路由员工 ID|路由账户 Auth ID|<input[^>]*maxLength="36"/);assert.match(html,/补正窗口（未授权，原值保留）/);
});
test('206 actual 191 preview SHA is required before operational publish, then minimal original fullSHA GET',async()=>{
 const model=await createManagementBrowserModel(),query=rUi.managementRulesContextQuery(model.seed.siteId,model.seed.operationalPublishGrantId),
  context=await r.parseDelegatedRulesResult(JSON.parse((await read(model,p.rules,query,r.delegatedRulesQueryString)).text).data,query,model.seed.delegate),
  draft={...rUi.managementRulesDraftFromContext(context),effectiveOn:'2026-10-10',reason:'Synthetic206 verified saved preview',acknowledged:true};
 await assert.rejects(rUi.buildManagementRulesCommand(context,query,model.seed.delegate,draft,id(812)));
 const previewQuery=rUi.managementRulesPreviewQuery(context,draft.effectiveOn,''),
  preview=await r.parseDelegatedRulesResult(JSON.parse((await read(model,p.rules,previewQuery,r.delegatedRulesQueryString)).text).data,previewQuery,model.seed.delegate);
 assert.equal(preview.preview.applied,false);assert.equal(preview.preview.references.routes.length,1);assert.equal(preview.preview.sourceDraftRevision,3);
 const evidence={query:previewQuery,result:preview},command=await rUi.buildManagementRulesCommand(context,query,model.seed.delegate,draft,id(812),evidence);
 assert.equal(command.decision.previewFingerprint,preview.preview.previewFingerprint);
 await assert.rejects(rUi.buildManagementRulesCommand(context,query,model.seed.delegate,{...draft,effectiveOn:'2026-10-11'},id(813),evidence));
 const posted=await model.respond(origin+p.rules,'POST',body(query,command),headers(model.seed.delegate));assert.equal((await r.parseDelegatedRulesResult(JSON.parse(posted.text).data,query,model.seed.delegate,command)).receipt.revision,4);
 const recover={...query,mode:'recover',operationId:command.decision.operationId},data=JSON.parse((await read(model,p.rules,recover,r.delegatedRulesQueryString)).text).data;
 assert.equal((await r.parseDelegatedRulesResult(data,recover,model.seed.delegate,command)).receipt.commandFingerprint,await r.delegatedRulesCommandFingerprint(query,model.seed.delegate,command));assert.equal(model.writes.length,1);
});
test('206 owner grant actual helper produces the exact single structured rules scope accepted by model',async()=>{
 const model=await createManagementBrowserModel(),query={siteId:model.seed.siteId,mode:'write'},command=rUi.buildManagementRulesGrant({delegateEmployeeId:model.seed.employeeId,delegateAuthUserId:model.seed.delegate,
  delegatedAction:'operational_rule_draft',subject:{kind:'enterprise'},allowedRuleKeys:['timesheetCycle','reviewRouting'],locationIds:[],
  validFrom:'2026-10-08T10:00',validUntil:'2026-10-09T10:00',reason:'Synthetic206 explicit rule grant',acknowledged:true},id(814));
 const posted=await model.respond(origin+p.management,'POST',body(query,command),headers(model.seed.owner));assert.deepEqual(command.scope.allowedRuleKeys,['reviewRouting','timesheetCycle']);
 assert.equal((await m.parseManagementDelegationResult(JSON.parse(posted.text).data,query,model.seed.owner,command)).receipt.grantId,id(814));
 const React=require('react'),{renderToStaticMarkup}=require('react-dom/server'),Panel=require('../../src/components/enterprise/MerchantAttendanceManagementDelegatedPanel.tsx').default,
  html=renderToStaticMarkup(React.createElement(Panel,{siteId:model.seed.siteId,actorId:model.seed.owner,ownerMode:true,grantEnabled:true,rulesEnabled:true,isCurrentAuth:()=>true,onClose:()=>{},apiFetch:()=>assert.fail('SSR zero HTTP')})),
  label=html.match(/<label[^>]*>规则明确动作[\s\S]*?<\/label>/)?.[0];assert(label);assert.equal((label.match(/<option /g)??[]).length,8);assert.notEqual(label.replace(/<[^>]+>/g,''),'规则明确动作');assert.equal(model.writes.length,1);
});
test('206 delegate has no owner-only authorization list; pending selectors cover four actually rendered delegate domains',async()=>{
 const React=require('react'),{renderToStaticMarkup}=require('react-dom/server'),Panel=require('../../src/components/enterprise/MerchantAttendanceManagementDelegatedPanel.tsx').default,
  model=await createManagementBrowserModel(),props={siteId:model.seed.siteId,actorId:model.seed.delegate,ownerMode:false,isCurrentAuth:()=>true,onClose:()=>{},apiFetch:()=>assert.fail('SSR zero HTTP')},
  html=renderToStaticMarkup(React.createElement(Panel,props)),owner=renderToStaticMarkup(React.createElement(Panel,{...props,actorId:model.seed.owner,ownerMode:true}));
 assert.doesNotMatch(html,/读取授权（每页25条）/);assert.match(owner,/读取授权（每页25条）/);
 for(const name of ['读取审计首页（GET）','读取此授权上下文（GET）','读取配置授权上下文（GET）','读取规则授权上下文（GET）'])assert(html.includes(name),name);
 const source=await readFile(new URL('./attendance-management-delegated-browser.mjs',import.meta.url),'utf8');
 assert.match(source,/button\('读取授权（每页25条）'\)\.count\(\),0,'delegate_has_no_owner_authorization_list'/);
 assert.doesNotMatch(source,/\['读取授权（每页25条）','读取审计首页（GET）'/);
});
