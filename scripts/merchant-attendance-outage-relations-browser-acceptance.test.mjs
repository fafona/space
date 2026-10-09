import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {outageRelationsAcceptanceArguments,outageRelationsAcceptanceRequestAllowed,outageRelationsAcceptanceGroups,outageRelationsAcceptanceLimits,outageRelationsDeliveryHeaders,assertOutageRelationsHistoryPages} from './merchant-attendance-outage-relations-browser-acceptance.mjs';
const file=fileURLToPath(new URL('./merchant-attendance-outage-relations-browser-acceptance.mjs',import.meta.url)),source=readFileSync(file,'utf8');
test('default CLI is inert even without tsx/server/browser module loading',()=>{
 const r=spawnSync(process.execPath,[file],{encoding:'utf8',timeout:10000});assert.equal(r.status,0,r.stderr);const report=JSON.parse(r.stdout);assert.equal(report.ran,false);assert.equal(report.database,false);assert.match(report.command,/node --import tsx .* --run-local$/);
});
test('explicit arguments cannot select remote hosts, screenshots or extra execution',()=>{
 assert.deepEqual(outageRelationsAcceptanceArguments([]),{run:false});assert.deepEqual(outageRelationsAcceptanceArguments(['--run-local']),{run:true});
 for(const args of [['--run-local','--run-local'],['--url=https://production.invalid'],['--screenshots'],['--run-local','--build'],[null]])assert.throws(()=>outageRelationsAcceptanceArguments(args));
});
test('network allowlist permits only bounded local assets and exact read/write APIs',()=>{
 const origin='http://127.0.0.1:45219',outages='/api/merchant-enterprise/attendance/outages',relations='/api/merchant-enterprise/attendance/outage-relations';
 for(const p of ['/','/qa.js','/qa.css','/favicon.ico',outages+'?mode=declaration',relations+'?mode=detail'])assert(outageRelationsAcceptanceRequestAllowed(origin+p,'GET',origin),p);
 assert(outageRelationsAcceptanceRequestAllowed(origin+relations,'POST',origin));
 for(const [url,method] of [['https://external.invalid/qa.js','GET'],[origin+'/qa.js?q=1','GET'],[origin+outages,'POST'],[origin+relations+'?mode=detail','POST'],[origin+'/api/merchant-enterprise/attendance/outage-reviews','GET'],[origin+'/favicon.ico?q=1','GET'],[origin+relations,'DELETE'],[origin+'/#hash','GET'],['http://u:p@127.0.0.1:45219/','GET']])assert(!outageRelationsAcceptanceRequestAllowed(url,method,origin),url);
 assert(!outageRelationsAcceptanceRequestAllowed('https://external.invalid/qa.js','GET','https://external.invalid'));
});
test('actual random POST is committed before truncation, durable bytes bind original GET only',()=>{
 assert(source.indexOf('const response=await route.fetch')<source.indexOf("if(method==='POST'&&truncatePost)"));
 for(const token of ['body.command.operationId','committed={body:structuredClone(body),receipt:structuredClone(wire.data.receipt)}','JSON.stringify(wire).slice(',
  "assert.deepEqual(durable.query,committed.body.query)","assert.deepEqual(durable.command,committed.body.command)",'await page.reload()',"badRecover=true",'assert.deepEqual(recovered.data.receipt,committed.receipt)',"['GET','recover',seed.declaration,seed.related,durable.command.operationId]"])assert(source.includes(token),token);
 assert(!source.includes('sessionStorage.setItem(key'));assert(!source.includes('crypto.randomUUID'));assert.equal(outageRelationsAcceptanceLimits.postLimit,4);
 assert(source.includes("assert.equal(requests.filter(r=>r.method==='POST').length,3)"));assert(source.includes('outageRelationsAcceptanceGroups.slice(0,8)'));
});
test('parent DOM gates, self absence, witnessed GET holds and dirty exit are explicit',()=>{
 for(const token of ["name:'故障登记与恢复工作区'","name:'故障登记与逐人声明'","name:'声明之间的明确关系'","name:'核对待确认声明关系'",
  "await draft('possible_duplicate'","await draft('complementary'","page.keyboard.press('Escape')",'hiddenGate.entered.promise','authGate.entered.promise',
  'window.__outageRelationsHarness.visibility(true)','await configure({other:true})',"assert.equal(await relations().getByLabel(label,{exact:true}).count(),0)",
  'mobilePanel.scrollWidth<=mobilePanel.clientWidth'])assert(source.includes(token),token);
 assert.equal(outageRelationsAcceptanceGroups.length,10);assert.equal(outageRelationsAcceptanceLimits.viewport.width,390);
});
test('resources are bounded and closed on failure without claiming omitted acceptance',()=>{
 for(const token of ['requestLimit:120','maxRedirects:0,timeout:12000','outageRelationsAcceptanceLimits.deadlineMs',"page.on('console'",'assert.deepEqual(external,[])','assert.deepEqual(errors,[])',
  "name:'relations browser context'","name:'relations browser'","name:'relations routes'","name:'relations server'","await bounded(server.closed,'outage_relations_server_closed_timeout')",'assert.equal(server.snapshot().listenerActive,false)',
  'real Auth or SQL transport','native tab visibility; visibilitychange is synthetic','actualAuthentication:false,database:false,production:false'])assert(source.includes(token),token);
 assert(!source.includes('.screenshot('));assert(!source.includes('pg_ctl'));assert(!source.includes('writeFile'));assert(!source.includes('waitForTimeout'));
});
test('modified delivery removes stale byte lengths/encodings without dropping safety headers',()=>{
 const before={'content-length':'999','transfer-encoding':'chunked','content-encoding':'gzip','content-type':'application/json','cache-control':'no-store'};
 assert.deepEqual(outageRelationsDeliveryHeaders(before),{'content-type':'application/json','cache-control':'no-store'});assert.equal(before['content-length'],'999');
});
test('224 safe revoke uses blocked preview only as warning and pins the actual fourth POST saved head',()=>{
 for(const token of ['server.controls.setIdentityChanged(true)','assert.equal(blocked.data.canWrite,true)',"assert.deepEqual(blocked.data.preview.blockers,['identity_changed'])",
  'assert.equal(blocked.data.preview.fingerprint,null)','assert.deepEqual(blocked.data.current,committed.receipt.entry)',"await draft('possible_duplicate','224",
  "name:'明确登记声明关系',exact:true}).isDisabled()","name:'明确撤销声明关系',exact:true}).isEnabled()",'assert.equal(safeBody.command.expectedRevision,3)',
  'assert.equal(safeBody.command.expectedFingerprint,committed.receipt.entry.fingerprint)','assert.equal(safeRevoked.data.receipt.entry.revision,4)',"assert(!Object.hasOwn(safeBody.command,'kind'))"] )assert(source.includes(token),token);
 assert(source.indexOf('const legacyCounts=')<source.indexOf('server.controls.setIdentityChanged(true)'));
});
test('27-item paging proof rejects duplicates, omissions, wrong order and wrong cursor boundary',()=>{
 const rows=Array.from({length:27},(_,i)=>({revision:i+1,operationId:`op-${i+1}`})),descending=rows.toReversed(),first=descending.slice(0,25),second=descending.slice(25);
 assert.deepEqual(assertOutageRelationsHistoryPages(first,second,rows),{total:27,firstPage:25,secondPage:2,beforeRevision:3});
 assert.throws(()=>assertOutageRelationsHistoryPages(first,[first.at(-1),second[1]],rows));
 assert.throws(()=>assertOutageRelationsHistoryPages(first,second.slice(0,1),rows));
 assert.throws(()=>assertOutageRelationsHistoryPages(first.toReversed(),second,rows));
 assert.throws(()=>assertOutageRelationsHistoryPages(first,second.toReversed(),rows));
 assert.throws(()=>assertOutageRelationsHistoryPages(first.slice(0,24),[first.at(-1),...second],rows));
});
test('history preparation is separately counted and both roles click actual DOM older control',()=>{
 for(const token of ['server.controls.prepareHistory(27)','assert.equal(setup.setupWrites,23)','assert.equal(requests.length,beforeSetupRequests)',
  'assert.deepEqual(afterSetup.model.rows.slice(0,4),beforeSetupSnapshot.model.rows)',"for(const access of ['owner','self'])",'await assertHistoryDom(first.data.history)',
  "name:'更早的声明关系历史'",'await click(older',"assert.deepEqual(pages.map(r=>r.beforeRevision),[null,'3'])",'assert.equal(await older.count(),0)',
  'assertOutageRelationsHistoryPages(first.data.history,second.data.history,afterSetup.model.rows)','layout.panel.scrollWidth<=layout.panel.clientWidth',
  'assert.deepEqual(checked.wire.data.receipt,expected)',"via:'Node-only model.respond, not HTTP or UI'",'oldReceiptTransportGetChecks:3',
  'assert.equal(snapshot.model.setupRequests,46)','assert.equal(snapshot.model.setupErrors,0)',
  'return {status:response.status,wire:await response.json()}'])assert(source.includes(token),token);
 assert(!source.includes('sessionStorage.setItem(key'));assert(!source.includes('more-than-25 history pagination in browser'));
});
