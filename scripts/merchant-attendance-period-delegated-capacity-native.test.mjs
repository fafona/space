import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {runInNewContext} from 'node:vm';
import {assertLifecycleSandbox} from './merchant-attendance-lifecycle-native-support.mjs';
import {periodContinuationArchiveBytes} from './fixtures/attendance-period-continuation-native.mjs';

const moduleUrl=new URL('./merchant-attendance-period-delegated-capacity-native.mjs',import.meta.url).href;
const source=readFileSync(new URL(moduleUrl),'utf8');
//Imported database boundary is replaced only for control-flow tests. These do
//not count as actual quota, SQL, auth or browser acceptance.
const code=source.replace(/^import .*;\r?$/gm,'').replace(/^export /gm,'').replaceAll('import.meta.url','moduleUrl')+'\n;runPeriodDelegatedCapacityNative;';
const args=['--run-local','--directory',path.resolve('synthetic-existing-stopped-directory')];
const plain=v=>JSON.parse(JSON.stringify(v));
const artifact=text=>({artifactText:text,artifact:JSON.parse(text),artifactBytes:Buffer.byteLength(text,'utf8'),artifactSha256:createHash('sha256').update(text).digest('hex')});
function harness(verify=null){
 const calls=[],state={facts:'facts',definitions:'definitions',catalog:'catalog',old:artifact('{"旧档":1}'),sealed:artifact('{"封存":2}')};
 const owned={schema:'attendance_race_'+'a'.repeat(32),oid:7,tableOid:8,owner:'postgres',marker:'faolla-synthetic-concurrency:00000000-0000-4000-8000-000000000001'};
 const ctx={d:{syntheticOnly:true,owned,fingerprint:()=>{calls.push('facts');return state.facts;},definitions:()=>{calls.push('definitions');return state.definitions;},tableCatalog:()=>{calls.push('catalog');return state.catalog;}},
  h:{syntheticOnly:true},scope:{sql:s=>s},native:{query:()=>{calls.push('ownership');return JSON.stringify(owned);},pass:()=>calls.push('pass')},
  archive:()=>{calls.push('archive');return state.old;},oldArchive:{...state.old},periodArchive:()=>{calls.push('sealed');return state.sealed;}};
 const fn=runInNewContext(code,{assert,path,fileURLToPath,moduleUrl,process:{argv:['node','not-this-entry']},console,assertLifecycleSandbox,periodContinuationArchiveBytes,
  runPeriodDelegatedClosureNative:async(a,callback)=>{calls.push('parent');assert.deepEqual(plain(a),args);try{return {phase:233,extension:await callback(ctx)};}finally{calls.push('cleanup');}},
  verifyPeriodDelegatedCapacityNative:async c=>{calls.push('fixture');assert.equal(c,ctx);return verify?verify(state,ctx):{rollbackRestored:true};}}, {timeout:1000});
 return{fn,ctx,calls,state};
}
test('import is inert and no implicit/malformed environment can reach parent',async()=>{
 const h=harness();assert.equal(typeof h.fn,'function');assert.deepEqual(h.calls,[]);
 for(const invalid of [undefined,[],['--run-local'],['--directory',args[2]],['--run-local','--directory','relative'],[...args,'--browser'],['--run-local','--run-local',args[2]]]){
  await assert.rejects(h.fn(invalid),/delegated_capacity_explicit_args_required/);assert.deepEqual(h.calls,[]);
 }
});
test('single owned rollback fixture runs before full guards and original parent cleanup',async()=>{
 const h=harness(),result=plain(await h.fn(args));assert.equal(result.extension.phase,235);assert.equal(result.extension.rollbackRestored,true);
 assert.equal(h.calls.filter(v=>v==='fixture').length,1);assert(h.calls.indexOf('ownership')<h.calls.indexOf('fixture'));
 assert(h.calls.lastIndexOf('facts')>h.calls.indexOf('fixture'));assert(h.calls.lastIndexOf('sealed')<h.calls.indexOf('pass'));assert.equal(h.calls.at(-1),'cleanup');
 for(const k of ['newCluster','browser','realAuth','productionAccess','deployed'])assert.equal(result.extension[k],false);
});
test('reversed explicit flags normalize without changing caller input',async()=>{
 const h=harness(),reversed=Object.freeze(['--directory',args[2],'--run-local']);await h.fn(reversed);assert.deepEqual(reversed,['--directory',args[2],'--run-local']);
});
test('both synthetic flags and exact ownership are mandatory before any fixture',async()=>{
 for(const mutate of [h=>h.ctx.d.syntheticOnly=false,h=>h.ctx.h.syntheticOnly=false,h=>h.ctx.d.owned={...h.ctx.d.owned,oid:9}]){
  const h=harness();mutate(h);await assert.rejects(h.fn(args));assert(!h.calls.includes('fixture'));assert.equal(h.calls.at(-1),'cleanup');
 }
});
test('fixture failure still executes postguards and cleanup without claiming success',async()=>{
 const error=Error('failure'),h=harness(()=>{throw error;});await assert.rejects(h.fn(args),e=>e===error);
 for(const key of ['facts','definitions','catalog','archive','sealed'])assert(h.calls.lastIndexOf(key)>h.calls.indexOf('fixture'));
 assert(!h.calls.includes('pass'));assert.equal(h.calls.at(-1),'cleanup');
});
test('each changed baseline, definition, catalog, archive or incomplete result is rejected',async()=>{
 for(const mutate of [s=>s.facts='changed',s=>s.definitions='changed',s=>s.catalog='changed',s=>s.old=artifact('{"更改":1}'),s=>s.sealed=artifact('{"更改":2}')]){
  const h=harness(s=>{mutate(s);return{rollbackRestored:true};});await assert.rejects(h.fn(args));assert(!h.calls.includes('pass'));assert.equal(h.calls.at(-1),'cleanup');
 }
 const h=harness(()=>({rollbackRestored:false}));await assert.rejects(h.fn(args),/delegated_capacity_fixture_incomplete/);assert(!h.calls.includes('pass'));
});
test('byte and SHA guards reject untrusted archive metadata before fixture',async()=>{
 for(const mutate of [h=>h.state.old.artifactBytes++,h=>h.state.sealed.artifactSha256='0'.repeat(64),h=>h.ctx.oldArchive.artifactText='{}']){
  const h=harness();mutate(h);await assert.rejects(h.fn(args));assert(!h.calls.includes('fixture'));assert.equal(h.calls.at(-1),'cleanup');
 }
});
test('wrapper adds no startup, migration, credentials, browser, committing or deletion branch',()=>{
 assert.doesNotMatch(source,/process\.env|initdb|pg_dump|CREATE DATABASE|spawn\(|listen\(|native\.connect|boundClockMigrationBody|drop schema|commit;/i);
 assert(source.includes('path.resolve(process.argv[1])===fileURLToPath(import.meta.url)'));assert(source.includes('process.exitCode=1'));
 assert(!source.includes('verifyPeriodDelegatedClosureRacesNative'));assert(!source.includes('verifyPeriodDelegatedMixedNative'));
});
