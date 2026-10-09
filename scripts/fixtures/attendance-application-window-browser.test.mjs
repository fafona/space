import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createApplicationWindowBrowserModel,applicationWindowBrowserLimits} from './attendance-application-window-browser.mjs';
test('243 browser model uses real strictparser for allfourfamilies and exact original recover',async()=>{
 const model=await createApplicationWindowBrowserModel(),api='http://127.0.0.1/api/merchant-enterprise/attendance/application-window';
 const{applicationWindowQueryString}=await import('../../src/lib/merchantAttendanceApplicationWindow.ts');
 for(const family of ['correction','correction_revision','missing','missing_revision']){const f=model.fixtures[family];assert.equal((await model.respond(api+'?'+applicationWindowQueryString(f.query),'GET','')).status,200);
  await model.respond(api,'POST',JSON.stringify({query:f.query,command:f.command}));const q={siteId:f.query.siteId,family,mode:'recover',operationId:f.command.command.operationId};
  assert.equal(JSON.parse((await model.respond(api+'?'+applicationWindowQueryString(q),'GET','')).text).data.receipt.operationId,q.operationId);model.records.clear();}
 assert.equal(model.writes.length,4);assert.equal(model.old.writes(),0);
});
test('243 fixture is inert,bounded,owned-cleanup,memorybundle and explicitly synthetic',async()=>{
 const source=await readFile(new URL('./attendance-application-window-browser.mjs',import.meta.url),'utf8');
 assert.deepEqual(applicationWindowBrowserLimits,{ttlMs:180000,http:70,api:40,posts:3});
 for(const s of ['write:false',"server.listen(0,'127.0.0.1'",'serviceWorkers:\'block\'','acceptDownloads:false','actualSql:false','actualAuth:false',"process.argv[2]==='--run-local'",'runAttendanceCleanupSteps','assert(!browser?.isConnected()&&!server?.listening)'])assert(source.includes(s),s);
 assert(!/writeFile|screenshot\(|download\.saveAs|supabase|initdb/.test(source));
});
