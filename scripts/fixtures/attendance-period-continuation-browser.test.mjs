// Pure/static tests only; importing the fixture never launches a browser/server.
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createContinuationBrowserModel,continuationBrowserAllowedRequest,continuationBrowserEndpoint as endpoint,continuationBrowserLimits} from './attendance-period-continuation-browser.mjs';
const source=readFileSync(new URL('./attendance-period-continuation-browser.mjs',import.meta.url),'utf8'),entry=readFileSync(new URL('./attendance-period-continuation-browser-entry.tsx',import.meta.url),'utf8');
test('allowlist permits only bounded loopback GETs and never writes or external resources',()=>{
 const origin='http://127.0.0.1:12345';for(const route of ['/','/qa.js','/qa.css',endpoint+'?mode=list'])assert(continuationBrowserAllowedRequest(origin+route,'GET',origin));
 for(const [url,method]of [['https://www.faolla.com'+endpoint,'GET'],[origin+endpoint,'POST'],[origin+'/api/other','GET'],[origin+'/qa.js?x=1','GET'],['http://localhost:12345/','GET'],[origin+'/#fragment','GET']])assert.equal(continuationBrowserAllowedRequest(url,method,origin),false);
 assert.deepEqual(continuationBrowserLimits,{ttlMs:300000,http:80,posts:0});
});
test('synthetic model strictly validates 25+1 list,50+50+1 history,20+1 versions and original v1 receipt',()=>{
 const m=createContinuationBrowserModel(),url=q=>'http://127.0.0.1:12345'+endpoint+'?'+new URLSearchParams(Object.entries(q).filter(([,v])=>v!==null).map(([k,v])=>[k,k==='cursor'?JSON.stringify(v):String(v)]));
 const list={...m.query,mode:'list',periodId:null,fromDate:m.seed.fromDate,throughDate:m.seed.throughDate,cursor:null};
 let r=m.respond(url(list)).body.data;assert.equal(r.items.length,25);r=m.respond(url({...list,cursor:r.nextCursor})).body.data;assert.equal(r.items.length,1);assert.equal(r.nextCursor,null);
 for(const [mode,lengths]of [['history',[50,50,1]],['versions',[20,1]]]){let cursor=null;for(const length of lengths){r=m.respond(url({...m.query,mode,cursor})).body.data;assert.equal(r.items.length,length);cursor=r.nextCursor;}assert.equal(cursor,null);}
 const legacy=JSON.parse(m.pendingRaw);r=m.respond(url({...m.query,mode:'recover',operationId:legacy.command.operationId,cursor:null}),m.seed.owner,false).body;
 assert.equal(r.moduleEnabled,false);assert.deepEqual(r.data.operation.command,legacy.command);assert.equal(r.data.artifactVersion,1);assert.equal(m.respond(url({...m.query,cursor:null}),m.seed.other).status,403);
});
test('fixture is explicitly invoked, memory-only, cleanup-owned and honest about synthetic data',()=>{
 for(const token of ['export async function runPeriodContinuationBrowserAcceptance','write:false','headless:true','acceptDownloads:false',"serviceWorkers:'block'",'runAttendanceCleanupSteps','server.listen(0,\'127.0.0.1\'','mockedData:true','actualSql:false','actualAuth:false','stage=\'identity.delayed_receipt\'','stage=\'legacy.paused_recovery\'','stage=\'hidden.mobile\''])assert(source.includes(token),token);
 assert.doesNotMatch(source,/process\.argv|writeFile|screenshot\(|\.download\(|pg_ctl|createServerSupabase|runPeriodContinuationBrowserAcceptance\(\);/);
 assert.match(entry,/MerchantAttendancePeriodClosureLauncher/);assert.match(entry,/<StrictMode>/);assert.match(entry,/registerLeaveGuard=\{registerLeaveGuard\}/);assert.match(entry,/不代表数据库、真实授权或生产验收/);
});
