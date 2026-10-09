import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {outageRelationsBrowserAllowedRequest,outageRelationsBrowserHeaders,startOutageRelationsBrowserServer} from './merchant-attendance-outage-relations-browser-check.mjs';
const require=createRequire(import.meta.url);
const {createOutageRelationsBrowserModel,outageRelationsBrowserSeed:seed,outageRelationsBrowserDeclaration}=require('./fixtures/attendance-outage-relations-browser-model.ts');
const {OUTAGE_APIS,outageHttpQueryString,parseOutageHttpResponse}=require('../src/lib/merchantAttendanceOutageHttp.ts');
const {outageRelationsCommandFingerprint}=require('../src/lib/merchantAttendanceOutageRelations.server.ts');
const source=readFileSync(new URL('./merchant-attendance-outage-relations-browser-check.mjs',import.meta.url),'utf8');
const entry=readFileSync(new URL('./fixtures/attendance-outage-relations-browser.tsx',import.meta.url),'utf8');
const modelSource=readFileSync(new URL('./fixtures/attendance-outage-relations-browser-model.ts',import.meta.url),'utf8');
const origin='http://127.0.0.1:54321';
const q=(access='owner')=>({siteId:seed.siteId,access,declarationId:seed.declaration,relatedDeclarationId:seed.related,mode:'detail'});
const read=(model,query=q(),enabled=true,actor=query.access==='owner'?seed.owner:seed.auth)=>model.respond({url:origin+OUTAGE_APIS.relations+'?'+outageHttpQueryString('relations',query),method:'GET',actor,enabled});
const write=(model,command,query=q(),enabled=true)=>model.respond({url:origin+OUTAGE_APIS.relations,method:'POST',actor:seed.owner,enabled,body:JSON.stringify({query,command})});
function apply(model,kind='possible_duplicate'){
  const before=read(model).body.data;
  const command={action:'apply',kind,operationId:randomUUID(),expectedRevision:before.revision,expectedFingerprint:before.preview.fingerprint,reason:'明确合成关系；不合并、不替代结案。'};
  const response=write(model,command);assert.equal(response.status,200);parseOutageHttpResponse('relations',response.body,q(),seed.owner,command);
  return {command,response};
}

test('strict allowlist accepts only exact 127.0.0.1 assets and two endpoint methods',()=>{
  for(const suffix of ['/','/qa.js','/qa.css','/favicon.ico',OUTAGE_APIS.outages+'?x=1',OUTAGE_APIS.relations+'?x=1'])assert(outageRelationsBrowserAllowedRequest(origin+suffix,'GET',origin));
  assert(outageRelationsBrowserAllowedRequest(origin+OUTAGE_APIS.relations,'POST',origin));
  for(const [url,method] of [[origin+OUTAGE_APIS.outages,'POST'],[origin+OUTAGE_APIS.links,'GET'],[origin+OUTAGE_APIS.reviews,'GET'],
    [origin+OUTAGE_APIS.relations+'?siteId=99990222','POST'],[origin+'/qa.js?x=1','GET'],[origin+'/qa.js#fragment','GET'],
    ['https://example.com/qa.js','GET'],['http://user@127.0.0.1:54321/qa.js','GET'],[origin+'/../private','GET'],[origin+'/qa.js','DELETE']])
    assert.equal(outageRelationsBrowserAllowedRequest(url,method,origin),false,url);
  for(const badOrigin of ['https://example.com','http://0.0.0.0:54321','http://localhost:54321','http://127.0.0.1','http://127.0.0.1:54321/'])
    assert.equal(outageRelationsBrowserAllowedRequest(badOrigin+'/qa.js','GET',badOrigin),false);
});
test('server headers are no-store and block external connection, framing and form submission',()=>{
  assert.equal(outageRelationsBrowserHeaders['Cache-Control'],'no-store');assert.equal(outageRelationsBrowserHeaders['X-Frame-Options'],'DENY');
  assert.equal(outageRelationsBrowserHeaders['X-Content-Type-Options'],'nosniff');
  for(const directive of ["default-src 'self'","connect-src 'self'","frame-ancestors 'none'","form-action 'none'"])assert(outageRelationsBrowserHeaders['Content-Security-Policy'].includes(directive));
  assert(source.includes("request.headers.host!==new URL(origin).host"));assert(source.includes("request.headers.origin!==origin"));
});
test('synthetic declarations are same identity and paper reference, never auto-related',()=>{
  const model=createOutageRelationsBrowserModel(),a=outageRelationsBrowserDeclaration(),b=outageRelationsBrowserDeclaration(true);
  assert.equal(a.paperReference,b.paperReference);assert.notEqual(a.id,b.id);assert.equal(a.employeeAuthUserId,b.employeeAuthUserId);
  for(const access of ['owner','self'])for(const declaration of [a,b]){
    const query={siteId:seed.siteId,access,mode:'declaration',declarationId:declaration.id},actor=access==='owner'?seed.owner:seed.auth;
    const response=model.respond({url:origin+OUTAGE_APIS.outages+'?'+outageHttpQueryString('outages',query),method:'GET',actor,enabled:false});
    assert.equal(response.status,200);parseOutageHttpResponse('outages',response.body,query,actor);assert.deepEqual(response.body.data.detail,declaration);
  }
  assert.equal(read(model).body.data.revision,0);assert.deepEqual(model.snapshot().rows,[]);
});
test('fresh real command IDs append once; exact replay and immutable GET recovery survive flag off',()=>{
  const model=createOutageRelationsBrowserModel(),{command,response}=apply(model);
  assert.equal(model.snapshot().successfulWrites,1);assert.equal(response.body.data.receipt.commandFingerprint,outageRelationsCommandFingerprint(q(),command));
  const replay=write(model,command,q(),false);assert.equal(replay.status,200);assert.deepEqual(replay.body.data.receipt,response.body.data.receipt);
  const recover={...q(),mode:'recover',operationId:command.operationId},recovered=read(model,recover,false);
  assert.equal(recovered.status,200);parseOutageHttpResponse('relations',recovered.body,recover,seed.owner);assert.deepEqual(recovered.body.data.receipt,response.body.data.receipt);
  assert.equal(model.snapshot().successfulWrites,1);assert.equal(recovered.body.canWrite,false);assert.equal(recovered.body.data.canWrite,false);
  assert.equal(write(model,{...command,operationId:randomUUID(),expectedRevision:1},q(),false).status,403);
});
test('pair history and revoke remain immutable; list retains revoked head and self has no mutation',()=>{
  const model=createOutageRelationsBrowserModel(),first=apply(model),current=read(model).body.data;
  const command={action:'revoke',operationId:randomUUID(),expectedRevision:current.revision,expectedFingerprint:current.current.fingerprint,reason:'只撤销提示，双方声明保留。'};
  const response=write(model,command);assert.equal(response.status,200);
  const history={...q(),mode:'history',beforeRevision:null},h=read(model,history);assert.equal(h.status,200);assert.deepEqual(h.body.data.history.map(e=>e.action),['revoke','apply']);
  const list={siteId:seed.siteId,access:'self',mode:'list',declarationId:seed.declaration},self=read(model,list);
  assert.equal(self.status,200);assert.equal(self.body.data.items[0].action,'revoke');assert.equal(self.body.data.canWrite,false);
  const denied=model.respond({url:origin+OUTAGE_APIS.relations,method:'POST',actor:seed.auth,enabled:true,body:JSON.stringify({query:q('self'),command})});
  assert.equal(denied.status,400);assert.equal(model.snapshot().successfulWrites,2);
  const original=read(model,{...q(),mode:'recover',operationId:first.command.operationId},false);assert.deepEqual(original.body.data.receipt,first.response.body.data.receipt);
});
test('reverse read direction shares pair but reversed original recovery and changed bodies conflict',()=>{
  const model=createOutageRelationsBrowserModel(),{command}=apply(model),reverse={...q(),declarationId:seed.related,relatedDeclarationId:seed.declaration};
  assert.deepEqual(read(model,reverse).body.data.current,read(model).body.data.current);
  assert.equal(read(model,{...reverse,mode:'recover',operationId:command.operationId}).body.error,'attendance_operation_conflict');
  assert.equal(write(model,{...command,reason:'另一意图'},q(),false).body.error,'attendance_operation_conflict');
  assert.equal(model.snapshot().successfulWrites,1);
});
test('actual public projector strips sourceText and malformed authority/scope never mutates ledger',()=>{
  const model=createOutageRelationsBrowserModel();assert.equal(JSON.stringify(read(model).body).includes('sourceText'),false);
  assert.equal(read(model,q(),true,seed.otherActor).status,403);
  const before=read(model).body.data,command={action:'apply',kind:'possible_duplicate',operationId:randomUUID(),expectedRevision:0,expectedFingerprint:before.preview.fingerprint,reason:'合成理由'};
  const unknowns=[JSON.stringify({query:q(),command,actorId:seed.owner}),JSON.stringify({query:q(),command}).replace('"kind":"possible_duplicate"','"kind":"possible_duplicate","kind":"possible_duplicate"')];
  for(const body of unknowns)assert.equal(model.respond({url:origin+OUTAGE_APIS.relations,method:'POST',actor:seed.owner,enabled:true,body}).status,400);
  assert.equal(write(model,{...command,expectedFingerprint:'f'.repeat(64)}).status,409);assert.equal(model.snapshot().successfulWrites,0);
});
test('explicit start limits validate without creating a listener or browser',async()=>{
  for(const opts of [{ttlMs:0},{ttlMs:1200001},{requestLimit:0},{requestLimit:1001}])await assert.rejects(startOutageRelationsBrowserServer(opts));
  assert.match(source,/server\.listen\(0,'127\.0\.0\.1'/);assert.match(source,/args\[0\]!=='--serve-local'/);assert.match(source,/write:false/);
  for(const forbidden of [/chromium/,/playwright/,/execFile/,/spawn\(/,/writeFile/,/initdb/,/pg_ctl/])assert.doesNotMatch(source,forbidden);
  assert(source.includes('server.closeAllConnections()'));assert(source.includes('clearTimeout(deadline)'));assert(source.includes('closedResolve()'));
});
test('lost-response fault is after real synthetic ledger respond; delay and all cleanup remain bounded',()=>{
  const committed=source.indexOf('const outcome=model.respond'),drop=source.indexOf('record.drop=true;const json=');assert(committed>=0&&drop>committed);
  assert(source.includes("'Content-Length':Buffer.byteLength(json,'utf8')"));assert(source.includes('response.flushHeaders();response.write(json.slice(0,8));setImmediate(()=>response.destroy())'));
  assert(source.includes("outcome.status===200"));assert(source.includes('},2000)'));assert(source.includes('},ttlMs)'));
  assert(source.includes('for(const [timer,resolve] of delays)'));assert(source.includes('if(++total>requestLimit)'));
  for(const validator of ['parseOutageHttpBody','parseOutageHttpQuery','parseOutageHttpResponse','projectOutageRelationsResult','outageRelationsCommandFingerprint'])assert(modelSource.includes(validator));
});
test('actual parent path starts flag-off, never preloads pending, exposes bounded controls only',()=>{
  assert(entry.includes('import OutageLauncher'));assert(entry.includes('<OutageLauncher'));assert(entry.includes('enabled={false} printEnabled={false} relationsEnabled={config.enabled}'));
  assert(entry.includes('enabled: false'));assert(entry.includes('window.__outageRelationsHarness'));assert(entry.includes('armDrop'));assert(entry.includes('armDelay'));
  assert(entry.includes('Object.defineProperty(document, "hidden"'));assert(entry.includes('transportEpoch.current++'));assert(entry.includes('epoch === transportEpoch.current'));
  assert.doesNotMatch(entry,/sessionStorage\.setItem|localStorage|Math\.random|registerLeaveGuard|检查离开风险/);
  assert(entry.includes('credentials: "omit"'));assert(entry.includes('u.origin !== location.origin'));
});

test('Node identity fixture changes only current eligibility, never immutable declarations or saved receipt',()=>{
  const model=createOutageRelationsBrowserModel(),first=apply(model),rows=model.snapshot().rows;
  const declaration=outageRelationsBrowserDeclaration(),stored=structuredClone(first.response.body.data.receipt);
  model.controls.setIdentityChanged(true);
  assert.deepEqual(model.snapshot().rows,rows);assert.equal(model.snapshot().successfulWrites,1);assert.equal(model.snapshot().setupWrites,0);
  const detail=read(model).body.data;
  assert.deepEqual(detail.preview,{evidence:null,fingerprint:null,eligible:false,blockers:['identity_changed']});
  assert.equal(detail.canWrite,true);assert.deepEqual(detail.current,stored.entry);
  const closed=read(model,q(),false).body.data;assert.equal(closed.canWrite,false);assert.deepEqual(closed.current,stored.entry);
  const recovered=read(model,{...q(),mode:'recover',operationId:first.command.operationId},false);
  assert.equal(recovered.status,200);assert.deepEqual(recovered.body.data.receipt,stored);
  assert.deepEqual(write(model,first.command,q(),false).body.data.receipt,stored);
  assert.deepEqual(outageRelationsBrowserDeclaration(),declaration);
  model.controls.setIdentityChanged(false);assert.equal(read(model).body.data.preview.eligible,true);assert.deepEqual(model.snapshot().rows,rows);
});
test('blocked current apply cannot create history; authorized safe revoke preserves the old fingerprint',()=>{
  const model=createOutageRelationsBrowserModel(),first=apply(model);model.controls.setIdentityChanged(true);
  const other={...first.command,operationId:randomUUID(),expectedRevision:1};
  assert.equal(write(model,other).body.error,'attendance_outage_relations_blocked');
  const revoke={action:'revoke',operationId:randomUUID(),expectedRevision:1,expectedFingerprint:first.command.expectedFingerprint,reason:'当前身份依据已变，仅撤销保存关系提示。'};
  assert.equal(write(model,revoke,q(),false).body.error,'attendance_outage_relations_disabled');assert.equal(model.snapshot().rows.length,1);
  const done=write(model,revoke);assert.equal(done.status,200);assert.equal(done.body.data.receipt.entry.evidence,null);
  assert.equal(done.body.data.receipt.entry.fingerprint,first.command.expectedFingerprint);
  const detail=read(model).body.data;assert.equal(detail.current.action,'revoke');assert.equal(detail.canWrite,false);assert.equal(detail.preview.eligible,false);
  assert.equal(model.snapshot().successfulWrites,2);assert.equal(model.snapshot().setupWrites,0);
});
test('27-row Node preparation runs strict commands with separate setup counters; actual pagination has no gap or repetition',()=>{
  const model=createOutageRelationsBrowserModel(),first=apply(model),receipts=[first.response.body.data.receipt];
  const revoke=()=>{const r=read(model).body.data,c={action:'revoke',operationId:randomUUID(),expectedRevision:r.revision,expectedFingerprint:r.current.fingerprint,reason:'明确撤销合成关系'};
    const done=write(model,c);assert.equal(done.status,200);receipts.push(done.body.data.receipt);};
  revoke();receipts.push(apply(model,'complementary').response.body.data.receipt);revoke();
  const before=model.snapshot(),prepared=model.controls.prepareHistory(27),after=model.snapshot();
  assert.deepEqual([prepared.fromRevision,prepared.throughRevision,prepared.setupWrites],[4,27,23]);
  for(const key of ['requests','gets','posts','successfulWrites','errors'])assert.equal(after[key],before[key],key);
  assert.deepEqual([after.setupWrites,after.setupGets,after.setupPosts,after.setupRequests,after.setupErrors],[23,23,23,46,0]);
  assert.deepEqual(after.rows.slice(0,4),before.rows);assert.equal(after.rows.length,27);assert.equal(new Set(after.rows.map(r=>r.operationId)).size,27);
  for(const access of ['owner','self']){
    const firstQuery={...q(access),mode:'history',beforeRevision:null},a=read(model,firstQuery).body.data;
    assert.equal(a.history.length,25);assert.equal(a.historyTruncated,true);assert.deepEqual(a.history.map(e=>e.revision),Array.from({length:25},(_,n)=>27-n));
    const b=read(model,{...firstQuery,beforeRevision:a.history.at(-1).revision}).body.data;
    assert.deepEqual(b.history.map(e=>e.revision),[2,1]);assert.equal(b.historyTruncated,false);
    assert.equal(new Set([...a.history,...b.history].map(e=>e.operationId)).size,27);
  }
  for(const receipt of receipts){const recovered=read(model,{...q(),mode:'recover',operationId:receipt.operationId},false);assert.deepEqual(recovered.body.data.receipt,receipt);}
  assert.deepEqual(model.controls.prepareHistory(27).setupWrites,0);assert.equal(model.snapshot().setupWrites,23);
});
test('invalid preparation cannot mutate and fixture controls have no browser or HTTP exposure',()=>{
  const model=createOutageRelationsBrowserModel();apply(model);const before=model.snapshot();
  for(const target of [-1,0,99,100,NaN,Infinity,1.5,'27',null])assert.throws(()=>model.controls.prepareHistory(target));
  for(const value of ['true',1,null,{}])assert.throws(()=>model.controls.setIdentityChanged(value));
  assert.deepEqual(model.snapshot(),before);
  model.controls.setIdentityChanged(true);const paused=model.snapshot();assert.throws(()=>model.controls.prepareHistory(27));assert.deepEqual(model.snapshot(),paused);
  for(const path of ['/controls','/prepareHistory','/setIdentityChanged',OUTAGE_APIS.relations+'/controls'])assert.equal(outageRelationsBrowserAllowedRequest(origin+path,'POST',origin),false);
  assert.doesNotMatch(entry,/setIdentityChanged|prepareHistory|controls=/);
  assert(source.includes('model.controls.prepareHistory(throughRevision)'));assert(source.includes('outage_relations_server_closed'));
  assert.equal(model.respond({url:origin+OUTAGE_APIS.relations+'?'+outageHttpQueryString('relations',q())+'&identityChanged=true',method:'GET',actor:seed.owner,enabled:true}).status,400);
  assert.equal(model.snapshot().identityChanged,true);assert.equal(model.snapshot().rows.length,1);
});
