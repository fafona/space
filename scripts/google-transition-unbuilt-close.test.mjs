import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {runInNewContext} from 'node:vm';
import {GOOGLE_UNBUILT_CLOSURE as fixed,GOOGLE_UNBUILT_FILE_PINS as pins,GOOGLE_UNBUILT_ABSENT_PATHS as absent} from './google-transition-unbuilt-close-policy.mjs';
import {executeGoogleUnbuiltClosure} from './google-transition-unbuilt-close.mjs';
const hash=x=>createHash('sha256').update(x).digest('hex'),read=f=>readFileSync(new URL('./'+f,import.meta.url),'utf8');
const plain=x=>JSON.parse(JSON.stringify(x));
const stable=x=>Array.isArray(x)?x.map(stable):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,stable(x[k])])):x;
function policyFixture(){
 const p={...fixed},maintenanceText='{"phase":"ended"}',proxyHashes=Object.fromEntries(fixed.proxyFiles.map(f=>[f,pins['before-'+f]]));
 const state={target:p.target,baseline:p.baseline,status:'preparing',lane:'google-oauth-transition-code-only',directory:p.directory,name:p.name,port:p.port,
  startedAt:'2026-10-25T10:00:00.000Z',processes:[],previousActive:{target:p.baseline},baseDirectory:'/baseline',maintenanceHash:hash(maintenanceText),markerHash:'a'.repeat(64),retentionHeadSha256:'b'.repeat(64),googleTransitionDependenciesSha256:'c'.repeat(64),configs:Object.fromEntries(p.proxyFiles.map(f=>[f,{oldHash:pins['before-'+f],newHash:pins['after-'+f]}]))};
 const stateText=JSON.stringify(state);p.stateSha256=hash(stateText);
 const evidence={schemaVersion:1,target:p.target,baseline:p.baseline,operation:p.operation,observedAt:'2026-10-25T10:01:00.000Z',stateSha256:p.stateSha256,sourceHead:p.target,sourceClean:true,absentPaths:[...absent],buildUnit:{name:'faolla-attendance-build-'+p.target+'.service',loadState:'not-found',journalEmpty:true},activeText:JSON.stringify(state.previousActive),processes:[],baseDirectory:'/baseline',maintenanceText,markerSha256:state.markerHash,proxyHashes,retentionHeadSha256:state.retentionHeadSha256,preservedFiles:{...pins},processReferencesAbsent:true,pm2DumpReferencesAbsent:true,portVacant:true,dependenciesSha256:state.googleTransitionDependenciesSha256,diagnosticTests:526,diagnosticPasses:526,diagnosticFailures:0,diagnosticSkipped:0,diagnosticCancelled:0,buildAttemptOccurred:false,databaseExecutionTracesAbsent:true};
 const s=read('google-transition-unbuilt-close-policy.mjs');
 const code=s.slice(s.indexOf('const hash=value=>')).replaceAll('export ','');
 // Supply the fixed incident port to the real policy functions; no production
 // API accepts a caller-selected incident, state pin, target or skip flag.
 const api=runInNewContext(code+'\n({createGoogleUnbuiltClosureReceipt,assertGoogleUnbuiltClosureReceipt})',{createHash,
  isDeepStrictEqual:(a,b)=>JSON.stringify(stable(a))===JSON.stringify(stable(b)),GOOGLE_UNBUILT_CLOSURE:p,GOOGLE_UNBUILT_ABSENT_PATHS:[...absent],GOOGLE_UNBUILT_FILE_PINS:{...pins}});
 const input={stateText,evidence,toolRevision:'d'.repeat(40),terminatedAt:'2026-10-25T10:01:01.000Z'};
 return {api,input,p};
}
test('production closure pins exactly the original resource-rejected attempt, preserved private bytes and absent build/DB traces',()=>{
 assert.equal(fixed.target,'8fabf8078a15115ad7765ae7dc60ae63adc74f98');assert.equal(fixed.stateSha256,'9722dc9f3c9afd44194aed46bc9910b4d85e9a7d3ba7d3c36925e2c8a63c7b84');
 assert.equal(Object.isFrozen(fixed),true);assert.equal(Object.isFrozen(pins),true);assert.equal(Object.keys(pins).length,9);
 assert.ok(absent.includes(fixed.directory+'/.next'));assert.ok(absent.some(x=>x.endsWith('attendance-build-proof.json')));
 const source=read('google-transition-unbuilt-close.mjs');assert.doesNotMatch(source,/\['(?:stop|start|restart|delete)'|unlinkSync|rmSync|renameSync|docker|psql|writeFileSync\([^f]/);
 for(const x of ['withOnlineRetentionLocks','inspectProcessReferences','bookingResumeDependencies','O_EXCL','O_NOFOLLOW','fs.fsyncSync','assertOnlineRetentionPublication','already_closed_no_retry'])assert.ok(source.includes(x),x);
});
test('real policy accepts a complete resource-failure proof and refuses drift in every historical/current fact',()=>{
 const f=policyFixture(),receipt=f.api.createGoogleUnbuiltClosureReceipt(f.input);
 f.api.assertGoogleUnbuiltClosureReceipt({stateText:f.input.stateText,receipt,preservedFiles:f.input.evidence.preservedFiles,absentPaths:[...absent]});
 for(const key of Object.keys(f.input.evidence)){
  const input=plain(f.input);input.evidence[key]=null;assert.throws(()=>f.api.createGoogleUnbuiltClosureReceipt(input),undefined,key);
 }
 for(const patch of [{stateText:f.input.stateText+'\n'},{toolRevision:'not-a-sha'},{terminatedAt:'2026-10-25T09:00:00.000Z'},{terminatedAt:'2026-10-25T10:07:00.000Z'}])assert.throws(()=>f.api.createGoogleUnbuiltClosureReceipt({...f.input,...patch}));
 for(const patch of [{kind:'forged'},{extra:'unreviewed'},{evidenceSha256:'f'.repeat(64)}])assert.throws(()=>f.api.assertGoogleUnbuiltClosureReceipt({stateText:f.input.stateText,receipt:{...receipt,...patch},preservedFiles:f.input.evidence.preservedFiles,absentPaths:[...absent]}));
});
test('actual closure executor observes twice, writes once, verifies after fsync and never mutates the original state',async()=>{
 const f=policyFixture(),events=[],observation={stateText:f.input.stateText,evidence:f.input.evidence};
 const ops={revision:f.input.toolRevision,now:()=>f.input.terminatedAt,observe:async()=>{events.push('observe');return plain(observation);},create:x=>f.api.createGoogleUnbuiltClosureReceipt(x),write:async receipt=>{events.push('write');assert.equal(receipt.originalStateText,observation.stateText);},assert:x=>{events.push('assert');f.api.assertGoogleUnbuiltClosureReceipt(x);}};
 const dry=await executeGoogleUnbuiltClosure(ops,{dryRun:true});assert.equal(dry.persistentEvidenceWrites,0);assert.deepEqual(events,['observe','observe']);events.length=0;
 assert.equal((await executeGoogleUnbuiltClosure(ops)).status,'ended-unpublished');assert.deepEqual(events,['observe','observe','write','observe','assert']);assert.equal(observation.stateText,f.input.stateText);
 let count=0;events.length=0;
 await assert.rejects(executeGoogleUnbuiltClosure({...ops,observe:async()=>{const value=plain(observation);if(++count===2)value.evidence.sourceClean=false;return value;}}),/observation_changed/);assert.deepEqual(events,[]);
 events.length=0;await assert.rejects(executeGoogleUnbuiltClosure({...ops,write:async()=>{throw Error('disk-full');}}),/disk-full/);assert.deepEqual(events,['observe','observe']);
});
