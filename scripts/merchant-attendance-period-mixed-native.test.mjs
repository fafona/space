import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {runInNewContext} from 'node:vm';
import {assertLifecycleSandbox} from './merchant-attendance-lifecycle-native-support.mjs';

const moduleUrl=new URL('./merchant-attendance-period-mixed-native.mjs',import.meta.url).href;
const source=readFileSync(new URL(moduleUrl),'utf8');
//Execute the actual wrapper control flow with only its imported database
//boundary replaced. These checks are not SQL/runtime acceptance evidence.
const code=source.replace(/^import .*;\r?$/gm,'').replace(/^export /gm,'').replaceAll('import.meta.url','moduleUrl')+'\n;runAttendancePeriodMixedNative;';
const args=['--run-local','--directory',path.resolve('synthetic-existing-stopped-directory')];
const plain=value=>JSON.parse(JSON.stringify(value));
const artifact=text=>({artifactText:text,artifactBytes:Buffer.byteLength(text,'utf8'),artifactSha256:createHash('sha256').update(text).digest('hex')});
function harness({verify=null,mutate=null,expectedArgs=args}={}){
 const calls=[],state={facts:'facts',definitions:'definitions',catalog:'catalog',original:artifact('旧155固定归档'),sealed:artifact('207实际封存归档'),sealedFlag:true,sourceChanged:false};
 const owned={schema:'attendance_race_'+'a'.repeat(32),oid:7,tableOid:8,owner:'postgres',marker:'faolla-synthetic-concurrency:00000000-0000-4000-8000-000000000001'};
 const d={owned,fingerprint:()=>{calls.push('facts');return state.facts;},definitions:()=>{calls.push('definitions');return state.definitions;},tableCatalog:()=>{calls.push('catalog');return state.catalog;}};
 const ctx={d,scope:{sql:sql=>{calls.push('scope');return sql;}},native:{query:()=>{calls.push('ownership');return JSON.stringify(owned);},pass:()=>calls.push('pass')},
  archive:()=>{calls.push('archive');return state.original;},oldArchive:{...state.original},periodArchive:()=>{calls.push('periodArchive');return state.sealed;},
  period:async q=>{calls.push('period');assert.deepEqual(q,{mode:'detail',access:'owner',periodId:'saved-period'});return {period:{periodId:'saved-period',sealed:state.sealedFlag,revision:4},sourceChanged:state.sourceChanged};},
  pq:(mode,access,periodId)=>({mode,access,periodId}),periodId:'saved-period',outagePeriodsFoundation:{phase:215,rollbackRestored:true}};
 const parent=async(received,callback)=>{calls.push('parent');assert.deepEqual(plain(received),expectedArgs);try{return {phase:215,extension:await callback(ctx)};}finally{calls.push('parent-cleanup-and-stop');}};
 const fn=runInNewContext(code,{assert,createHash,Buffer,path,fileURLToPath,moduleUrl,process:{argv:['node','not-this-entry'],exitCode:0},console,
  assertLifecycleSandbox,runAttendanceOutagePeriodsNative:parent,verifyAttendancePeriodMixedNative:async received=>{calls.push('fixture');assert.equal(received,ctx);if(mutate)mutate(state,ctx);return verify?verify(state,ctx):{checked:true};}}, {timeout:1000});
 return {fn,ctx,calls,state};
}

test('import-style evaluation is inert and exposes only a callable explicit runner',()=>{
 const h=harness();assert.equal(typeof h.fn,'function');assert.deepEqual(h.calls,[]);
 const imports=[...source.matchAll(/^import .* from '([^']+)';$/gm)].map(match=>match[1]);
 assert(imports.includes('./merchant-attendance-outage-periods-native.mjs'));
 assert(imports.includes('./fixtures/attendance-period-mixed-native.mjs'));
 assert(source.includes('path.resolve(process.argv[1])===fileURLToPath(import.meta.url)'));
 assert(source.includes('process.exitCode=1'));
});
test('no default directory, browser switch, duplicated flag or relative target reaches parent lifecycle',async()=>{
 for(const invalid of [undefined,[],['--run-local'],['--directory',args[2]],['--run-local','--directory','relative'],[...args,'--with-browser'],['--run-local','--run-local',args[2]],['--directory','--run-local',args[2]]]){
  const h=harness();await assert.rejects(h.fn(invalid),/period_mixed_explicit_native_args_required/);assert.deepEqual(h.calls,[]);
 }
});
test('actual wrapper delegates one owned215 extension and preserves complete facts, catalogs, two byte/SHA archives and seal',async()=>{
 const h=harness(),result=plain(await h.fn(args));assert.equal(result.phase,215);assert.equal(result.extension.phase,228);
 assert.deepEqual(result.extension.mixed,{checked:true});assert.equal(result.extension.rollbackRestored,true);
 assert.equal(h.calls.filter(x=>x==='fixture').length,1);assert.equal(h.calls.filter(x=>x==='period').length,2);
 assert(h.calls.indexOf('ownership')<h.calls.indexOf('fixture'));assert(h.calls.lastIndexOf('facts')>h.calls.indexOf('fixture'));
 assert.equal(h.calls.at(-1),'parent-cleanup-and-stop');assert.equal(h.calls.filter(x=>x==='pass').length,1);
 for(const key of ['browser','newCluster','productionAccess','deployed'])assert.equal(result.extension[key],false);
});
test('reversed flags normalize to the exact parent argument order without modifying caller input',async()=>{
 const reversed=Object.freeze(['--directory',args[2],'--run-local']),h=harness({expectedArgs:args});
 const result=await h.fn(reversed);assert.equal(result.extension.phase,228);assert.equal(h.calls.at(-1),'parent-cleanup-and-stop');
 assert.deepEqual(reversed,['--directory',args[2],'--run-local']);
});
test('wrong prerequisite, foreign ownership or unsealed source fails before fixture but parent cleanup still runs',async()=>{
 for(const change of [h=>h.ctx.outagePeriodsFoundation.phase=214,h=>h.ctx.outagePeriodsFoundation.rollbackRestored=false,
  h=>h.ctx.d.owned={...h.ctx.d.owned,oid:99},h=>h.state.sealedFlag=false,h=>h.state.sourceChanged=true]){
  const h=harness();change(h);await assert.rejects(h.fn(args));assert(!h.calls.includes('fixture'));assert.equal(h.calls.at(-1),'parent-cleanup-and-stop');
 }
});
test('fixture rejection still performs all postguards and delegates cleanup, never records a pass',async()=>{
 const error=Error('synthetic fixture failure'),h=harness({verify:()=>{throw error;}});
 await assert.rejects(h.fn(args),candidate=>candidate===error);assert.equal(h.calls.filter(x=>x==='period').length,2);
 assert(h.calls.lastIndexOf('catalog')>h.calls.indexOf('fixture'));assert(h.calls.lastIndexOf('periodArchive')>h.calls.indexOf('fixture'));
 assert.equal(h.calls.at(-1),'parent-cleanup-and-stop');assert(!h.calls.includes('pass'));
});
test('each material postcondition independently rejects changed facts, definitions, catalog, archives or period',async()=>{
 const mutations=[s=>s.facts='changed',s=>s.definitions='changed',s=>s.catalog='changed',s=>s.original=artifact('altered old archive'),
  s=>s.sealed=artifact('altered sealed archive'),s=>s.sealedFlag=false,s=>s.sourceChanged=true];
 for(const mutate of mutations){const h=harness({mutate});await assert.rejects(h.fn(args));assert.equal(h.calls.at(-1),'parent-cleanup-and-stop');assert(!h.calls.includes('pass'));}
});
test('archive guards verify actual bytes and SHA, not merely equality of untrusted metadata',async()=>{
 for(const mutate of [h=>h.state.original.artifactBytes++,h=>h.state.sealed.artifactSha256='0'.repeat(64),h=>h.ctx.oldArchive.artifactText='different']){
  const h=harness();mutate(h);await assert.rejects(h.fn(args));assert(!h.calls.includes('fixture'));assert.equal(h.calls.at(-1),'parent-cleanup-and-stop');
 }
});
test('wrapper owns no connection/startup/install/cleanup and emits no business or synthetic success independently',()=>{
 for(const token of ['initdb','CREATE DATABASE','pg_dump','pg_ctl','spawn(','listen(','playwright','native.connect','d.exec(','boundClockMigrationBody','drop schema'])assert(!source.includes(token),token);
 assert(source.includes('finally{'));assert(source.indexOf("native.pass('228")>source.indexOf('period_mixed_final_read_wrote'));
 assert(source.includes('existing215 parent exclusively owns baseline restoration, synthetic schema cleanup and shutdown'));
 assert(!source.includes('.querySteps('));assert(!source.includes('.step('));
});
