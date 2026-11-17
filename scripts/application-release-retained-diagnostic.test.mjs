import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import http from 'node:http';
import {RETAINED_DIAGNOSTIC,RETAINED_DIAGNOSTIC_STEPS,executeRetainedDiagnostic,assertRetainedDiagnosticInvocation,assertRetainedObservationBinding,probeRetainedVersion} from './application-release-retained-diagnostic.mjs';
const revision='a'.repeat(40),entry='/var/lib/faolla-online-code/'+revision+'/scripts/application-release-retained-diagnostic.mjs';
function operations(failure,{verifyFailure=false}={}){
 const events=[],original=Error('original-private-value');let phase;
 const value=Object.fromEntries(RETAINED_DIAGNOSTIC_STEPS.map(step=>[step,async()=>{phase=step;events.push(step);if(step===failure&&!verifyFailure)throw original;return{observed:true};}]));
 value.verify=async()=>{events.push('verify');if(phase===failure&&verifyFailure)throw original;};return{value,events,original};
}
test('the inspector has one frozen retained candidate and accepts no release target or action arguments',()=>{
 assert.equal(RETAINED_DIAGNOSTIC.target,'a1f3b29cb345b7a804e8a1e5a062c74bcb7fbbf2');
 const context={argv:['/usr/bin/node',entry],platform:'linux',uid:0,executable:'/usr/bin/node',version:'v20.20.1',entry};
 assert.deepEqual(assertRetainedDiagnosticInvocation(context),{toolRevision:revision,directory:'/var/lib/faolla-online-code/'+revision});
 for(const patch of [{argv:[...context.argv,'activate']},{argv:['/usr/bin/node','-']},{platform:'win32'},{uid:1000},{version:'v22.0.0'},{executable:'/tmp/node'},{entry:entry.replace('.mjs','xmjs')},{entry:'/tmp/application-release-retained-diagnostic.mjs'}])assert.throws(()=>assertRetainedDiagnosticInvocation({...context,...patch}),/invocation/);
});
test('all independent observations and fresh verifications complete without issuing publication authority',async()=>{
 const f=operations(),records=[],value=await executeRetainedDiagnostic(f.value,{emit:row=>records.push(row)});
 assert.deepEqual(f.events,RETAINED_DIAGNOSTIC_STEPS.flatMap(step=>[step,'verify']));
 assert.equal(value.diagnosticCompleted,true);
 for(const flag of ['publicationAuthority','publicationCompleted','originalPublicationAuditAdmissible','businessDataWritten','processControlPerformed','routeChanged','existingBuildModified','mailEnabled'])assert.equal(value[flag],false,flag);
 assert.deepEqual(Object.keys(value.checks),RETAINED_DIAGNOSTIC_STEPS);
 assert.ok(records.every(row=>row.scope==='retained'&&row.publicationAuthority===false&&row.publicationCompleted===false));
});
test('state changes between first read and immutable file capture cannot bind a stale observation to newer bytes',()=>{
 const initial={state:{target:RETAINED_DIAGNOSTIC.target,status:'rolled-back'},active:{target:RETAINED_DIAGNOSTIC.baseline}};
 assertRetainedObservationBinding(initial,structuredClone(initial));
 for(const change of [value=>value.state.status='active',value=>value.active.target=RETAINED_DIAGNOSTIC.target,value=>value.state.extra='changed']){
  const current=structuredClone(initial);change(current);assert.throws(()=>assertRetainedObservationBinding(initial,current),/application_retained_diagnostic_(?:state|active)/);
 }
});
for(const phase of RETAINED_DIAGNOSTIC_STEPS)for(const verifyFailure of [false,true])test('an isolated '+phase+(verifyFailure?' witness':' check')+' refusal stops without a retry or hidden success',async()=>{
 const f=operations(phase,{verifyFailure}),records=[];
 await assert.rejects(executeRetainedDiagnostic(f.value,{emit:row=>records.push(row)}),error=>error===f.original);
 assert.equal(f.events.filter(event=>event===phase).length,1);
 assert.ok(RETAINED_DIAGNOSTIC_STEPS.slice(RETAINED_DIAGNOSTIC_STEPS.indexOf(phase)+1).every(step=>!f.events.includes(step)));
 const diagnostic=records.find(row=>row.event==='threw');assert.equal(diagnostic.phase,'retained-'+phase);assert.equal(diagnostic.code,'unclassified');
 assert.doesNotMatch(JSON.stringify(records),/original-private-value/);assert.ok(!records.some(row=>row.event==='returned'));
});
test('a missing operation or verifier is refused before the first observation',async()=>{
 for(const name of [...RETAINED_DIAGNOSTIC_STEPS,'verify']){const f=operations();delete f.value[name];await assert.rejects(executeRetainedDiagnostic(f.value),/invocation/);assert.deepEqual(f.events,[]);}
});
test('real fixed loopback version probe sends only an unauthenticated GET with the proper Host',async()=>{
 const requests=[],server=http.createServer((request,response)=>{requests.push({method:request.method,url:request.url,headers:request.headers});response.writeHead(200,{'content-type':'application/json'});response.end(JSON.stringify({ok:true,buildId:RETAINED_DIAGNOSTIC.target}));});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{assert.deepEqual(await probeRetainedVersion(server.address().port),{status:200,buildId:RETAINED_DIAGNOSTIC.target});assert.equal(requests.length,1);assert.equal(requests[0].method,'GET');assert.equal(requests[0].url,'/api/app-web-version');assert.equal(requests[0].headers.host,'www.faolla.com');assert.equal(requests[0].headers.cookie,undefined);assert.equal(requests[0].headers.authorization,undefined);
  for(const port of [0,-1,65536,1.2,'3109'])await assert.rejects(probeRetainedVersion(port),/version_scope/);
  assert.equal(requests.length,1);
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
test('redirects, wrong responses and oversized private probe bodies never become version evidence',async()=>{
 let mode='redirect';const server=http.createServer((request,response)=>{if(mode==='redirect'){response.writeHead(302,{location:'https://external.invalid'});response.end('{}');}else if(mode==='large'){response.writeHead(200);response.end('x'.repeat(4097));}else{response.writeHead(200);response.end('{"ok":true,"buildId":"not-a-revision"}');}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{await assert.rejects(probeRetainedVersion(server.address().port),/version_probe/);mode='large';await assert.rejects(probeRetainedVersion(server.address().port),/version_body_limit/);mode='wrong';await assert.rejects(probeRetainedVersion(server.address().port),/version_probe/);}
 finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
test('a real stalled response body is bounded by the original five-second read-only timeout',async()=>{
 const server=http.createServer((request,response)=>{response.writeHead(200);response.write('{');});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{await assert.rejects(probeRetainedVersion(server.address().port),/version_timeout/);}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
test('the actual entry is inert when imported, not a new server worker or an automatic command',()=>{
 const url=new URL('./application-release-retained-diagnostic.mjs',import.meta.url).href;
 const child=spawnSync(process.execPath,['--input-type=module','-e','await import('+JSON.stringify(url)+');','retained-import-fixture.mjs'],{encoding:'utf8',timeout:10000,windowsHide:true});
 assert.equal(child.status,0,child.stderr);assert.equal(child.stdout,'');assert.equal(child.stderr,'');
});
test('the production inspector has no control, filesystem write, database mutation, installer or caller override path',()=>{
 const source=readFileSync(new URL('./application-release-retained-diagnostic.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(source,/writeFile|mkdir|rename|unlink|rmSync|chmod|process\.kill|spawn(?:Sync)?\(|execFile|method:\s*['"](?:POST|PUT|PATCH|DELETE)|activateApplication|finishApplicationRelease|recoverApplicationPublication|createProductionDatabaseBackup/);
 assert.match(source,/state.status==='rolled-back'/);assert.match(source,/value.phase==='rolled-back'/);
 assert.match(source,/target:BASELINE,operationId:randomUUID\(\)/);assert.match(source,/deadlineAtMs:Date.now\(\)\+30000/);
 assert.match(source,/readNaturalWorkerCycle\(worker,Date.parse\(certificate.completedAt\),2\)/);
 assert.match(source,/assertUnchangedApplicationSource\(TARGET,application.rows,tool.rows\)/);
 assert.match(source,/assertRecordedSchemaDatabase\(manifest\)/);
 assert.match(source,/privateNetworkVerified===true/);
});
