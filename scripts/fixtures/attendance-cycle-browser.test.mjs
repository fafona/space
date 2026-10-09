// SOURCE/strict synthetic model tests only. No actual browser/Auth/SQL/authority.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {createCycleBrowserModel,cycleBrowserLimits} from './attendance-cycle-browser.mjs';
const require=createRequire(import.meta.url),p=require('../../src/lib/merchantAttendanceCycleIntent.ts'),r=require('../../src/lib/merchantAttendanceCycleIntentResult.ts');
const f=require('./attendance-cycle-intent-model.ts'),s=require('../../src/lib/merchantAttendanceCycleSend.ts'),sr=require('../../src/lib/merchantAttendanceCycleSendResult.ts');
const ip=require('../../src/components/enterprise/MerchantAttendanceCycleIntentPanel.tsx'),sp=require('../../src/components/enterprise/MerchantAttendanceCycleSendPanel.tsx');
const g=require('../../src/lib/merchantAttendancePeriodDelegation.ts'),gp=require('../../src/components/enterprise/MerchantAttendancePeriodDelegationPanel.tsx');
const base='http://127.0.0.1/api/merchant-enterprise/attendance/',api=base+'operational-cycle',send=api+'/send';
const get=async(m,q,actor=m.seed.owner,enabled=true)=>JSON.parse((await m.respond(api+'?'+p.cycleIntentQueryString(q),'GET','',actor,enabled)).text).data;
const scope=m=>({siteId:m.seed.siteId,access:'owner',workerId:m.seed.worker,grantId:null});
async function accept(m){
 const q={...scope(m),mode:'prepare',anchorDate:m.seed.anchor},prepared=await get(m,q);
 const pair=ip.cycleIntentPanelCommand(scope(m),prepared.data,'accept','Synthetic200 explicit model adoption',f.cycleId(2001));
 const reply=JSON.parse((await m.respond(api,'POST',JSON.stringify(pair),m.seed.owner)).text).data;
 await r.parseCycleIntentResult(reply,pair.query,m.seed.owner,pair.command);
 const recovered=await get(m,{...scope(m),mode:'recover',intentId:pair.command.intentId,operationId:pair.command.operationId});
 assert.equal(recovered.receipt.commandFingerprint,reply.receipt.commandFingerprint);
 const detail=await get(m,pair.query);return{pair,detail};
}
async function firstSend(m,detail,actor,delegateScope){
 const c=sp.cycleSendPanelContext(detail,actor,delegateScope),request=sp.cycleSendPanelPreviewRequest(c);
 const raw=JSON.parse((await m.respond(new URL(request.url,base).href,'GET','',actor)).text);
 const source=sp.parseCycleSendPanelSource(raw,c);assert(source.canSend);
 const pair=sp.cycleSendPanelCommand(c,source,'Synthetic200 explicit model send',f.cycleId(actor===m.seed.owner?2002:2004),f.cycleId(actor===m.seed.owner?2003:2005));
 const result=await m.respond(send,'POST',JSON.stringify(pair),actor),fingerprint=await s.cycleSendCommandFingerprint(pair.frame,pair.command,actor);
 return{pair,result,fingerprint,query:{...pair.frame,mode:'recover',operationId:pair.command.operationId,commandFingerprint:fingerprint}};
}

test('200 shared synthetic UI model retains both true legacy projections and a distinct delegated actor',async()=>{
 const m=await createCycleBrowserModel();assert.notEqual(m.seed.owner,m.seed.delegate);assert.equal(m.owner.source.canSend,true);assert.equal(m.delegate.source.canSend,true);
 assert.equal(m.owner.source.artifact.report.access,'owner');assert.equal(m.delegate.source.artifact.report.access,'delegate');
 assert.equal(m.owner.request.query.periodId,null);assert.equal(m.delegate.request.query.periodId,null);assert.equal(m.delegate.request.query.grantId,m.seed.grant);
 assert.equal(m.delegate.detail.actorId,m.seed.delegate);assert.equal(m.delegate.c.acceptedByActor,true);assert.equal(m.receipts.size,0);assert.equal(m.sends.size,0);
 await assert.rejects(m.respond(new URL(m.delegate.request.url,base).href,'GET','',m.seed.owner));
});

test('200 synthetic owner adopts, recovers original id, sends once; lost/wrong reply preserves and flagoff original GET remains valid',async()=>{
 const m=await createCycleBrowserModel(),{pair,detail}=await accept(m);assert.equal(detail.data.head.action,'accept');assert.equal(m.receipts.size,1);
 await assert.rejects(m.respond(api,'POST',JSON.stringify(pair),m.seed.owner),/unexpected_duplicate_POST/);
 const x=await firstSend(m,detail,m.seed.owner);assert.throws(()=>JSON.parse(x.result.text));assert.equal(m.sends.size,1);
 m.recovery('foreign');const bad=JSON.parse((await m.respond(send+'?'+s.cycleSendQueryString(x.query),'GET','',m.seed.owner,false)).text);
 await assert.rejects(sr.parseCycleSendResponse(bad,x.pair.frame,m.seed.owner,x.pair.command.operationId,x.fingerprint,x.pair.command));
 m.recovery('valid');const good=JSON.parse((await m.respond(send+'?'+s.cycleSendQueryString(x.query),'GET','',m.seed.owner,false)).text);
 const parsed=await sr.parseCycleSendResponse(good,x.pair.frame,m.seed.owner,x.pair.command.operationId,x.fingerprint,x.pair.command);
 assert.equal(parsed.moduleEnabled,false);assert.equal(parsed.data.data.periodOperation.version,1);assert.equal(parsed.data.receipt.revision,2);
 assert.equal(m.sends.size,1);await assert.rejects(m.respond(send,'POST',JSON.stringify(x.pair),m.seed.owner),/unexpected_duplicate_POST/);
 const latest=await get(m,pair.query,m.seed.owner,false);assert.equal(latest.data.head.action,'link');assert.equal(latest.data.head.sendOperationId,x.pair.command.operationId);
});

test('200 original185 list/detail selection yields all nine exact scope fields and true delegated preview/send/recovery',async()=>{
 const m=await createCycleBrowserModel(),query={siteId:m.seed.siteId,access:'delegate',mode:'list',catalog:null,grantId:null,afterId:null,operationId:null};
 const read=async q=>g.parsePeriodDelegationResponse(JSON.parse((await m.respond(base+'period-delegation?'+g.periodDelegationQueryString(q),'GET','',m.seed.delegate)).text),q,{authUserId:m.seed.delegate});
 const list=await read(query);assert.equal(list.grants.length,1);const q={...query,mode:'detail',grantId:list.grants[0].grantId},result=await read(q);
 const identity={siteId:m.seed.siteId,access:'delegate',actorId:m.seed.delegateEmployee,authUserId:m.seed.delegate};
 const selection=gp.periodDelegationPeriodSelection({phase:'ready',query:q,result,pending:null,message:'',choices:{delegate:null,worker:null}},identity,'2026-10-05','2026-10-11');
 const {fromDate,throughDate,...actualScope}=selection;assert.equal(fromDate,'2026-10-05');assert.equal(throughDate,'2026-10-11');assert.deepEqual(actualScope,m.delegateScope);assert.equal(Object.keys(actualScope).length,9);
 const detail=await get(m,{siteId:m.seed.siteId,access:'delegate',workerId:m.seed.worker,grantId:m.seed.grant,mode:'detail',intentId:m.seed.delegateIntent},m.seed.delegate);
 const x=await firstSend(m,detail,m.seed.delegate,actualScope),raw=JSON.parse(x.result.text);
 await sr.parseCycleSendResponse(raw,x.pair.frame,m.seed.delegate,x.pair.command.operationId,x.fingerprint,x.pair.command);
 const recovered=JSON.parse((await m.respond(send+'?'+s.cycleSendQueryString(x.query),'GET','',m.seed.delegate,false)).text);
 await sr.parseCycleSendResponse(recovered,x.pair.frame,m.seed.delegate,x.pair.command.operationId,x.fingerprint,x.pair.command);assert.equal(m.sends.size,1);
 assert.throws(()=>gp.periodDelegationPeriodSelection({phase:'ready',query:q,result,pending:null,message:'',choices:{delegate:null,worker:null}},{...identity,authUserId:m.seed.owner},fromDate,throughDate));
});

test('200 actual owner parent model permits original bounded read only and rejects unknown route/actor/POST',async()=>{
 const m=await createCycleBrowserModel();for(const view of ['settings','workers'])assert.equal((await m.respond(base+'admin?siteId='+m.seed.siteId+'&view='+view,'GET','',m.seed.owner)).status,200);
 await assert.rejects(m.respond(base+'admin?siteId='+m.seed.siteId,'POST','',m.seed.owner));
 await assert.rejects(m.respond(base+'admin?siteId='+m.seed.siteId,'GET','',m.seed.delegate));
 await assert.rejects(m.respond(base+'unknown','GET','',m.seed.owner));assert.equal(m.receipts.size,0);assert.equal(m.sends.size,0);
});

test('200 oldslot negative seeds are valid original v1/v2 pending commands rather than only damaged format tags',async()=>{
 const m=await createCycleBrowserModel(),old=require('../../src/lib/merchantAttendancePeriodClosureClient.ts'),v2=require('../../src/lib/merchantAttendancePeriodClosureV2Client.ts');
 let calls=0,writes=0;for(const raw of m.legacyRaws.slice(0,2)){
  const storage={getItem:key=>key===m.seed.ownerSlot?raw:null,setItem:()=>{writes++;},removeItem:()=>{writes++;}},options={siteId:m.seed.siteId,access:'owner',actorId:m.seed.owner,
   workerId:m.seed.worker,fromDate:'2026-10-05',throughDate:'2026-10-11',enabled:false,storage:()=>storage,apiFetch:async()=>{calls++;throw Error('no HTTP');}};
  const c=new v2.AttendancePeriodClosureV2Client(options);await c.initialize();assert(c.getSnapshot().pending);assert.equal(c.getSnapshot().pending.format,JSON.parse(raw).format);c.pause();
  if(JSON.parse(raw).format===1){const first=new old.AttendancePeriodClosureClient(options);await first.initialize();assert(first.getSnapshot().pending);first.pause();}
 }assert.equal(calls,0);assert.equal(writes,0);assert.equal(m.legacyRaws[2],'{');assert.equal(m.intents.get('owner:'+m.seed.ownerFixtureIntent).head.action,'accept');
});

test('200 browser source is inert/finite/memory-only with actual Admin and185 host, shared originals, four groups and owned cleanup',async()=>{
 assert.deepEqual(cycleBrowserLimits,{ttlMs:180000,http:45,api:30,posts:4,groups:4});
 const runner=await readFile(new URL('./attendance-cycle-browser.mjs',import.meta.url),'utf8'),entry=await readFile(new URL('./attendance-cycle-browser-entry.tsx',import.meta.url),'utf8');
 for(const token of ['attendance-cycle-send-ui-model.ts','attendance-cycle-send-model.ts','parsePeriodDelegationResponse','periodClosurePendingKey','periodDelegatedClosurePendingKey',
  'write:false',"server.listen(0,'127.0.0.1'",'serviceWorkers:\'block\'','acceptDownloads:false','actualAuth:false','actualSql:false','syntheticGrant:true','realAuthority:false',
  "process.argv[2]==='--run-local'",'runAttendanceCleanupSteps','assert(!browser?.isConnected()&&!server?.listening)','posts,3','width:390',
  "owner_actual_adopt_original_GET_lazy_send_unknown_flagoff","delegate_real185_nine_scope_selection_and_outer_guard",
  "old_v1_v2_corrupt_shared_slot_blocks_new_POST_and_preserves","hidden_Auth_requester_late_bodies_keep_original_mobile_close_no_HTTP",
  "model.recovery('foreign')","configure({enabled:false})",'for(const raw of model.legacyRaws)','fixture_slot_changed',"configure({requester:1})"])
  assert(runner.includes(token),token);
 for(const token of ['MerchantAttendanceAdminPanel','MerchantAttendancePeriodDelegationLauncher','registerLeaveGuard={register}','isCurrentAuth={current}',
  'access="delegate"','actorId={__CYCLE_SEED__.delegateEmployee}','config.requester','enabled.current','new ReadableStream','authValid: value','visibility: hidden','pagehide:','flushSync'])assert(entry.includes(token),token);
 assert(!/writeFile|screenshot\(|download\.saveAs|initdb|memberships/.test(runner));assert(!/attendance-cycle-send-ui-model|\.server|node:crypto/.test(entry));
 assert(!runner.includes('verifyDayReviewBrowser('));assert.equal((runner.match(/await group\('/g)??[]).length,4);
 assert(runner.indexOf('requests.push(record)')<runner.indexOf('const result=await model.respond(u.href'));
 assert(runner.includes("const done=requests.length;await button('我的受托周期').click()"));
});

test('200 hidden delegated recovery explicitly reselects fresh185 grant after stale foreground, preserving the same pending slot',async()=>{
 const runner=await readFile(new URL('./attendance-cycle-browser.mjs',import.meta.url),'utf8');
 const group=runner.slice(runner.indexOf("await group('hidden_Auth_requester_late_bodies_keep_original_mobile_close_no_HTTP'"));
 const restore=group.indexOf('window.__cycleHarness.authValid(true)'),back=group.indexOf("await button('返回授权列表').click()"),
  list=group.indexOf("await click('读取授权',foundation)",back),detail=group.indexOf("await click('核验详情',foundation)",list),
  select=group.indexOf("await button('打开受托周期工作区').click()",detail),recover=group.indexOf("await click('仅 GET 核验首次送审原号',sendApi)",select);
 assert(restore>=0&&restore<back&&back<list&&list<detail&&detail<select&&select<recover);
 const path=group.slice(back,recover);assert.equal((path.match(/await click\([^\n]*foundation/g)??[]).length,1);
 assert(path.includes("await click('读取授权',foundation);await click('核验详情',foundation)"));
 assert(path.includes('assert.equal(requests.length,count);assert.equal(await pending(model.seed.delegateSlot),raw)'));
 assert(path.includes('assert.equal(requests.length,reselected);assert.equal(await pending(model.seed.delegateSlot),raw)'));
 assert(!/removeItem|setItem|authValid|visibility\(/.test(path));
});
