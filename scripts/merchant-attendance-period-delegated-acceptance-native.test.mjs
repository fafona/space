import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {runInNewContext} from 'node:vm';
import {assertLifecycleSandbox} from './merchant-attendance-lifecycle-native-support.mjs';

const moduleUrl=new URL('./merchant-attendance-period-delegated-acceptance-native.mjs',import.meta.url).href;
const source=readFileSync(new URL(moduleUrl),'utf8');
//Only imported boundaries are replaced; these are wrapper control-flow tests,
//not evidence of PostgreSQL locking, source validation or authenticated login.
const code=source.replace(/^import .*;\r?$/gm,'').replace(/^export /gm,'').replaceAll('import.meta.url','moduleUrl')+'\n;runPeriodDelegatedAcceptanceNative;';
const args=['--run-local','--directory',path.resolve('synthetic-existing-stopped-directory')];
const plain=v=>JSON.parse(JSON.stringify(v));
const artifact=text=>({artifactText:text,artifactBytes:Buffer.byteLength(text,'utf8'),artifactSha256:createHash('sha256').update(text).digest('hex')});
function harness({mixed=null,races=null}={}){
 const calls=[],state={facts:'baseline',definitions:'definitions',catalog:'catalog',old:artifact('原归档'),sealed:artifact('已封存归档')};
 const owned={schema:'attendance_race_'+'a'.repeat(32),oid:7,tableOid:8,owner:'postgres',marker:'faolla-synthetic-concurrency:00000000-0000-4000-8000-000000000001'};
 const ctx={d:{syntheticOnly:true,owned,fingerprint:()=>{calls.push('facts');return state.facts;},definitions:()=>{calls.push('definitions');return state.definitions;},tableCatalog:()=>{calls.push('catalog');return state.catalog;}},
  h:{syntheticOnly:true},scope:{sql:s=>s},native:{query:()=>{calls.push('ownership');return JSON.stringify(owned);},pass:message=>calls.push(message.includes('nonempty mixed')?'mixed-pass':'complete-pass')},
  archive:()=>{calls.push('archive');return state.old;},oldArchive:{...state.old},periodArchive:()=>{calls.push('sealed');return state.sealed;}};
 const parent=async(a,fn)=>{calls.push('parent');assert.deepEqual(plain(a),args);try{return {phase:233,extension:await fn(ctx)};}finally{calls.push('cleanup');}};
 const fn=runInNewContext(code,{assert,createHash,Buffer,path,fileURLToPath,moduleUrl,process:{argv:['node','not-this-entry']},console,
  assertLifecycleSandbox,runPeriodDelegatedClosureNative:parent,
  verifyPeriodDelegatedMixedNative:async c=>{calls.push('mixed');assert.equal(c,ctx);return mixed?mixed(state,ctx):{verified:true};},
  verifyPeriodDelegatedClosureRacesNative:async c=>{calls.push('races');assert.equal(c,ctx);return races?races(state,ctx):{verified:true};}}, {timeout:1000});
 return {fn,ctx,calls,state};
}

test('import is inert and rejects implicit or malformed environment selection before parent',async()=>{
 const h=harness();assert.equal(typeof h.fn,'function');assert.deepEqual(h.calls,[]);
 for(const invalid of [undefined,[],['--run-local'],['--directory',args[2]],[...args,'--browser'],['--run-local','--directory','relative'],['--run-local','--run-local',args[2]]]){
  await assert.rejects(h.fn(invalid),/delegated_acceptance_explicit_args_required/);assert.deepEqual(h.calls,[]);
 }
});
test('one owned parent runs mixed rollback before races, then guards archives and delegates cleanup',async()=>{
 const h=harness(),result=plain(await h.fn(args));assert.equal(result.extension.phase,234);
 assert.equal(h.calls.filter(x=>x==='mixed').length,1);assert.equal(h.calls.filter(x=>x==='races').length,1);
 assert(h.calls.indexOf('ownership')<h.calls.indexOf('mixed'));assert(h.calls.indexOf('races')>h.calls.lastIndexOf('facts'));
 assert(h.calls.lastIndexOf('sealed')>h.calls.indexOf('races'));assert.equal(h.calls.at(-1),'cleanup');
 for(const key of ['newCluster','browser','realAuth','productionAccess','deployed'])assert.equal(result.extension[key],false);
 assert.equal(result.extension.cleanupOwnedByParent,true);
});
test('reversed flags normalize without changing caller input',async()=>{
 const reversed=Object.freeze(['--directory',args[2],'--run-local']),h=harness();await h.fn(reversed);
 assert.deepEqual(reversed,['--directory',args[2],'--run-local']);assert.equal(h.calls.at(-1),'cleanup');
});
test('both synthetic-only and exact ownership guards reject before any fixture',async()=>{
 for(const mutate of [h=>h.ctx.d.syntheticOnly=false,h=>h.ctx.h.syntheticOnly=false,h=>h.ctx.d.owned={...h.ctx.d.owned,oid:9}]){
  const h=harness();mutate(h);await assert.rejects(h.fn(args));assert(!h.calls.includes('mixed'));assert.equal(h.calls.at(-1),'cleanup');
 }
});
test('mixed nonrollback blocks committing races and still preserves all postguards',async()=>{
 const h=harness({mixed:s=>{s.facts='leaked';return {};}});await assert.rejects(h.fn(args),/delegated_mixed_did_not_rollback/);
 assert(!h.calls.includes('races'));assert(h.calls.lastIndexOf('sealed')>h.calls.indexOf('mixed'));assert.equal(h.calls.at(-1),'cleanup');assert(!h.calls.includes('mixed-pass'));assert(!h.calls.includes('complete-pass'));
});
test('either fixture failure still checks archives/catalogs and reaches cleanup without claiming complete',async()=>{
 for(const name of ['mixed','races']){
  const error=Error('fixture failed'),h=harness({[name]:()=>{throw error;}});await assert.rejects(h.fn(args),e=>e===error);
  assert(h.calls.lastIndexOf('definitions')>h.calls.indexOf(name));assert(h.calls.lastIndexOf('sealed')>h.calls.indexOf(name));
  assert.equal(h.calls.at(-1),'cleanup');assert(!h.calls.includes('complete-pass'));assert.equal(h.calls.includes('mixed-pass'),name==='races');
 }
});
test('race may append exact owned facts, but definitions/catalog/old archives cannot change',async()=>{
 const good=harness({races:s=>{s.facts='owned-append';return {};}});await good.fn(args);assert(good.calls.includes('mixed-pass'));assert(good.calls.includes('complete-pass'));
 for(const mutate of [s=>s.definitions='changed',s=>s.catalog='changed',s=>s.old=artifact('替换旧归档'),s=>s.sealed=artifact('替换封存归档')]){
  const h=harness({races:s=>{mutate(s);return {};}});await assert.rejects(h.fn(args));assert(!h.calls.includes('complete-pass'));assert.equal(h.calls.at(-1),'cleanup');
 }
});
test('archive SHA/bytes are independently validated before any fixture',async()=>{
 for(const mutate of [h=>h.state.old.artifactBytes++,h=>h.state.sealed.artifactSha256='0'.repeat(64),h=>h.ctx.oldArchive.artifactText='different']){
  const h=harness();mutate(h);await assert.rejects(h.fn(args));assert(!h.calls.includes('mixed'));assert.equal(h.calls.at(-1),'cleanup');
 }
});
test('runner owns no new environment, migrations, HTTP, credentials or destructive cleanup',()=>{
 assert.doesNotMatch(source,/process\.env|initdb|pg_dump|CREATE DATABASE|spawn\(|listen\(|native\.connect|boundClockMigrationBody|drop schema/i);
 assert(source.includes('path.resolve(process.argv[1])===fileURLToPath(import.meta.url)'));assert(source.includes('process.exitCode=1'));
 const previous=readFileSync(new URL('./merchant-attendance-period-delegated-closure-native.mjs',import.meta.url),'utf8');
 assert(previous.includes("if(after!==null)assert.equal(typeof after,'function'"));
 assert(previous.indexOf('const extension=after===null?null:await after(ctx);')>previous.indexOf('finally{assert.equal(d.fingerprint(),installed)'));
});
