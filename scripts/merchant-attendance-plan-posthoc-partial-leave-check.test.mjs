import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {runInNewContext} from 'node:vm';
import test from 'node:test';
import {assertLifecycleSandbox} from './merchant-attendance-lifecycle-native-support.mjs';
const moduleUrl=new URL('./merchant-attendance-plan-posthoc-partial-leave-check.mjs',import.meta.url).href;
const source=readFileSync(new URL(moduleUrl),'utf8');
const code=source.replace(/^import .*;\r?$/gm,'').replace(/^export /gm,'').replaceAll('import.meta.url','moduleUrl')+'\n;runPosthocPartialLeaveCheck;';
const args=['--run-local','--directory',path.resolve('synthetic-existing-stopped-directory')];
const plain=v=>JSON.parse(JSON.stringify(v));
const artifact=text=>({id:'original-artifact',artifactText:text,artifactBytes:Buffer.byteLength(text),artifactSha256:createHash('sha256').update(text).digest('hex')});
function harness({nativeChange=null,browserChange=null,nativeReject=false,browserReject=false}={}){
 const calls=[],state={facts:'facts',immutable:'immutable',defs:'defs',catalog:'catalog',original:artifact('原归档正文'),artifacts:[artifact('原归档正文')]};
 const owned={schema:'attendance_race_'+'a'.repeat(32),oid:7,tableOid:8,owner:'postgres',marker:'faolla-synthetic-concurrency:00000000-0000-4000-8000-000000000001'};
 const d={syntheticOnly:true,owned,fingerprint:tables=>tables?state.immutable:state.facts,definitions:()=>state.defs,tableCatalog:()=>state.catalog,
  exec:sql=>{assert.match(sql,/from public\.merchant_attendance_period_artifacts/);return JSON.stringify(state.artifacts);}};
 const ctx={d,h:{syntheticOnly:true},scope:{sql:s=>s},native:{query:()=>JSON.stringify(owned),pass:()=>calls.push('pass')},archive:()=>state.original,oldArchive:{...state.original}};
 const fn=runInNewContext(code,{assert,createHash,Buffer,path,fileURLToPath,moduleUrl,process:{argv:['node','not-entry']},console,assertLifecycleSandbox,
  runPlanPosthocReviewNative:async(a,callback)=>{calls.push('parent');assert.deepEqual(plain(a),args);try{return await callback(ctx);}finally{calls.push('parent-cleanup-and-stop');}},
  verifyPosthocPartialLeaveNative:async c=>{assert.equal(c,ctx);calls.push('native');nativeChange?.(state);if(nativeReject)throw Error('native failure');return {rollbackRestored:true};},
  preparePosthocPartialLeaveBrowser:async c=>{assert.equal(c,ctx);calls.push('prepare-browser');return {ctx};},
  verifyPosthocPartialLeaveBrowser:async p=>{assert.equal(p.ctx,ctx);calls.push('browser');browserChange?.(state);if(browserReject)throw Error('browser failure');return {passed:true};},
 },{timeout:1000});return {fn,ctx,state,calls};
}
test('module evaluation is inert; native-only explicit run never starts browser',async()=>{
 const h=harness();assert.deepEqual(h.calls,[]);const result=await h.fn(args);assert.equal(result.phase,230);assert.equal(result.browser,null);
 assert.equal(result.browserUsesDisposableCommittedSchema,false);assert.deepEqual(h.calls,['parent','native','pass','parent-cleanup-and-stop']);
});
test('browser opt-in uses existing parent and separate honest committed-owned-schema lifecycle',async()=>{
 const h=harness({browserChange:s=>{s.facts='new synthetic facts';s.artifacts.push({...artifact('new permitted archive'),id:'new-artifact'});}});
 const r=await h.fn([...args,'--with-browser']);assert.equal(r.browserUsesDisposableCommittedSchema,true);assert.equal(r.nativeRollbackRestored,true);
 for(const k of ['newCluster','productionAccess','deployed'])assert.equal(r[k],false);
 assert.deepEqual(h.calls,['parent','native','prepare-browser','browser','pass','parent-cleanup-and-stop']);
});
test('missing/duplicate/unknown flags and relative or padded directory cannot reach lifecycle',async()=>{
 for(const invalid of [undefined,[],args.slice(0,2),[...args,'--unknown'],[...args,'--with-browser','--with-browser'],['--run-local','--directory','relative'],['--run-local','--directory',' '+args[2]]]){
  const h=harness();await assert.rejects(h.fn(invalid),/partial_leave_explicit_args_required/);assert.deepEqual(h.calls,[]);
 }
});
test('wrong synthetic scope or archive checksum fails before native; parent still cleans',async()=>{
 for(const change of [h=>h.ctx.h.syntheticOnly=false,h=>h.ctx.d.owned={...h.ctx.d.owned,oid:10},h=>h.state.original.artifactBytes++]){
  const h=harness();change(h);await assert.rejects(h.fn(args));assert(!h.calls.includes('native'));assert.equal(h.calls.at(-1),'parent-cleanup-and-stop');
 }
});
test('native rollback cannot alter any facts, definition, catalog or old archive',async()=>{
 for(const nativeChange of [s=>s.facts='x',s=>s.defs='x',s=>s.catalog='x',s=>s.original=artifact('changed')]){
  const h=harness({nativeChange});await assert.rejects(h.fn([...args,'--with-browser']));assert(!h.calls.includes('prepare-browser'));assert(!h.calls.includes('pass'));assert.equal(h.calls.at(-1),'parent-cleanup-and-stop');
 }
});
test('browser branch cannot alter original punches/rules, definitions or even one byte in an old artifact',async()=>{
 for(const browserChange of [s=>s.immutable='x',s=>s.defs='x',s=>s.catalog='x',s=>s.artifacts[0]=artifact('changed'),s=>s.artifacts=[]]){
  const h=harness({browserChange});await assert.rejects(h.fn([...args,'--with-browser']));assert(!h.calls.includes('pass'));assert.equal(h.calls.at(-1),'parent-cleanup-and-stop');
 }
});
test('native and browser failures are not converted into a pass and still reach parent cleanup',async()=>{
 for(const options of [{nativeReject:true},{browserReject:true}]){
  const h=harness(options);await assert.rejects(h.fn([...args,'--with-browser']),/failure/);assert(!h.calls.includes('pass'));assert.equal(h.calls.at(-1),'parent-cleanup-and-stop');
 }
});
test('wrapper never owns cluster creation, SQL migration, timing overrides or cleanup commands',()=>{
 for(const token of ['initdb','CREATE DATABASE','pg_dump','pg_ctl','spawn(','listen(','native.connect','drop schema','statement_timeout','lock_timeout'])assert(!source.includes(token),token);
 assert(source.includes("cleanupOwner:'existing207 parent'"));assert(source.includes('finally{'));assert(source.includes('path.resolve(process.argv[1])===fileURLToPath(import.meta.url)'));
});
