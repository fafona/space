import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createApplicationReleaseManifest as original,applicationReleaseRole} from './application-release-policy.mjs';
import {createApplicationReleaseManifest,assertApplicationReleaseManifest,RECORDED_APPLICATION_ARTIFACTS as records} from './application-release-compatibility.mjs';
import {APPLICATION_VERIFICATION_FILE as descriptor,verificationSchemaManifest} from './application-release-verification.mjs';
import {TEMPLATE_SCHEMA,templateGitBlob} from './application-release-template-contract.mjs';
const oid='a'.repeat(40),next='b'.repeat(40),base='c'.repeat(40),file=descriptor.file;
const row=(file,value=oid)=>({file,mode:'100644',oid:value});
function fixture(){return{baseline:base,purpose:'Classify one reviewed build verifier without changing the certified worker policy',
 focusedTests:['src/example.test.ts'],baselineRows:[row('src/example.ts'),row('src/example.test.ts'),row(file)],
 targetRows:[row('src/example.ts',next),row('src/example.test.ts',next),row(file,next)]};}

test('independent adapter binds only the exact verifier while original worker policy still rejects it',()=>{
 const input=fixture(),value=createApplicationReleaseManifest(input),proof=assertApplicationReleaseManifest(value,input);
 assert.equal(value.schemaVersion,4);assert.equal(value.verificationBaseSchemaVersion,1);
 assert.deepEqual(value.verificationFile,descriptor);assert.equal(proof.verificationFileVerified,true);
 assert.deepEqual(value.changes.find(r=>r.file===file),{file,role:'verification',before:['100644',oid],after:['100644',next]});
 assert.equal(proof.changedPaths,3);assert.deepEqual(proof.applicationPaths,['src/example.ts']);
 assert.throws(()=>applicationReleaseRole(file),/unclassified_path/);assert.throws(()=>original(input),/unclassified_path/);
 const structural={baseline:input.baseline,baselineRows:input.baselineRows,targetRows:input.targetRows};
 assert.deepEqual(assertApplicationReleaseManifest(value,structural),proof);
 for(const neighbor of ['scripts/check-auth-middleware-http.mjs','scripts/check-auth-middleware-build.js','scripts/check-auth-middleware-build.mjs.bak','scripts/check-auth-middleware-extra.mjs']){
  assert.throws(()=>applicationReleaseRole(neighbor),/unclassified_path/);
  assert.throws(()=>createApplicationReleaseManifest({...input,targetRows:[...input.targetRows,row(neighbor)]}),/unclassified_path/);
 }
});

test('no special change preserves previous manifest shape and unsupported source shapes fail closed',()=>{
 const input=fixture();input.targetRows.find(r=>r.file===file).oid=oid;
 assert.deepEqual(createApplicationReleaseManifest(input),original(input));
 const value=createApplicationReleaseManifest(fixture());
 assert.throws(()=>assertApplicationReleaseManifest(value,input),/unchanged_source/);
 for(const mutate of [
  x=>x.targetRows=x.targetRows.filter(r=>r.file!==file),x=>x.baselineRows=x.baselineRows.filter(r=>r.file!==file),
  x=>x.targetRows.find(r=>r.file===file).mode='100755',x=>x.baselineRows.find(r=>r.file===file).mode='100755',
  x=>x.targetRows.find(r=>r.file===file).mode='120000',x=>x.targetRows.find(r=>r.file===file).oid='invalid',
  x=>x.targetRows.push({...x.targetRows.find(r=>r.file===file)}),x=>x.baselineRows.push({...x.baselineRows.find(r=>r.file===file)}),
 ]){const changed=fixture();mutate(changed);assert.throws(()=>createApplicationReleaseManifest(changed));}
});

test('no change, metadata or capability can disappear through the verification projection',()=>{
 const input=fixture(),manifest=createApplicationReleaseManifest(input);
 for(const mutate of [
  v=>v.changes.pop(),v=>v.changes.find(r=>r.file===file).after[1]='d'.repeat(40),
  v=>v.changes.find(r=>r.file===file).before[0]='100755',v=>v.changes.find(r=>r.file===file).role='application',
  v=>v.changes.push({...v.changes[0]}),v=>v.extra=true,v=>v.mail='on',v=>v.database='changed',
  v=>v.dependencies='changed',v=>v.environment='new',v=>v.backgroundTasks='restart',v=>v.purpose='',
  v=>v.verificationFile.file='scripts/arbitrary.mjs',v=>v.verificationFile.execute=true,
  v=>v.verificationBaseSchemaVersion=3,v=>v.verificationBaseSchemaVersion=4,v=>v.schemaVersion=1,
  v=>delete v.verificationFile,v=>delete v.verificationBaseSchemaVersion,
  v=>v.focusedTests=[file],v=>v.focusedTests=[],v=>v.focusedTests=['src/missing.test.ts'],
 ]){const value=structuredClone(manifest);mutate(value);assert.throws(()=>assertApplicationReleaseManifest(value,input));}
 for(const path of ['scripts/supabase-migrations/other.sql','package-lock.json','.env.local','src/../secret.ts',
  'src/lib/merchantBookingDangerous.server.ts','scripts/arbitrary-runtime.mjs']){
  assert.throws(()=>createApplicationReleaseManifest({...input,targetRows:[...input.targetRows,row(path)]}));
 }
 for(const mutate of [x=>x.targetRows.find(r=>r.file===file).oid='d'.repeat(40),x=>x.baselineRows.find(r=>r.file===file).oid='d'.repeat(40)]){
  const changed=fixture();mutate(changed);assert.throws(()=>assertApplicationReleaseManifest(manifest,changed),/scope_changed/);
 }
 const noApp=fixture();noApp.targetRows.find(r=>r.file==='src/example.ts').oid=oid;
 assert.throws(()=>createApplicationReleaseManifest(noApp),/empty_application_or_verification/);
 const noTest=fixture();noTest.targetRows.find(r=>r.file==='src/example.test.ts').oid=oid;
 assert.throws(()=>createApplicationReleaseManifest(noTest),/empty_application_or_verification/);
});

test('recorded and template schema proofs compose without enabling SQL or relaxing historical pins',()=>{
 const input=fixture();
 input.baselineRows.push(...records.filter(r=>r.before).map(r=>({file:r.file,mode:r.before[0],oid:r.before[1]})));
 input.targetRows.push(...records.map(r=>({file:r.file,mode:r.after[0],oid:r.after[1]})));
 const sql=readFileSync(new URL('./supabase-migrations/202611100214_website_template_library.sql',import.meta.url));
 input.targetRows.push(row(TEMPLATE_SCHEMA.file,templateGitBlob(sql)));
 const value=createApplicationReleaseManifest(input),proof=assertApplicationReleaseManifest(value,input);
 assert.equal(value.verificationBaseSchemaVersion,3);assert.equal(value.baseSchemaVersion,2);
 assert.equal(proof.templateSchemaVerified,true);assert.equal(proof.recordedSchemaVerified,true);
 assert.equal(proof.verificationFileVerified,true);assert.equal(value.templateSchema.databaseExecution,'forbidden');
 const projected=verificationSchemaManifest(value);
 assert.equal(projected.schemaVersion,3);assert.equal(projected.baseSchemaVersion,2);
 assert.deepEqual(projected.templateSchema,value.templateSchema);assert.deepEqual(projected.recordedSchema,value.recordedSchema);
 assert.deepEqual(projected.changes,value.changes.filter(r=>r.file!==file));
 assert.equal(projected.verificationFile,undefined);assert.equal(projected.verificationBaseSchemaVersion,undefined);
 assert.equal(value.schemaVersion,4,'database projection does not mutate the reviewed manifest');
 for(const mutate of [v=>v.templateSchema.databaseExecution='allow',v=>v.recordedSchema.databaseExecution='allow',
  v=>v.baseSchemaVersion=1,v=>v.templateSchema.sha256='0'.repeat(64)]){
  const bad=structuredClone(value);mutate(bad);assert.throws(()=>assertApplicationReleaseManifest(bad,input));
 }
 const changed=structuredClone(input);changed.targetRows.find(r=>r.file===TEMPLATE_SCHEMA.file).oid=next;
 assert.throws(()=>assertApplicationReleaseManifest(value,changed));
 // Once recorded artifacts are unchanged, the nested template base is v1.
 const future={...input,baselineRows:input.targetRows,targetRows:input.targetRows.map(r=>
  ['src/example.ts','src/example.test.ts',file].includes(r.file)?{...r,oid:'d'.repeat(40)}:r)};
 const successor=createApplicationReleaseManifest(future);
 assert.equal(successor.schemaVersion,4);assert.equal(successor.verificationBaseSchemaVersion,3);assert.equal(successor.baseSchemaVersion,1);
 assertApplicationReleaseManifest(successor,future);
});

test('database proof receives the original nested schema instead of silently ignoring the outer version',()=>{
 const input=fixture(),value=createApplicationReleaseManifest(input),projected=verificationSchemaManifest(value);
 assert.equal(projected.schemaVersion,1);assert.equal(verificationSchemaManifest(projected),projected);
 for(const mutate of [v=>v.verificationFile.role='application',v=>v.verificationBaseSchemaVersion=4,v=>v.schemaVersion=3,
  v=>delete v.verificationFile,v=>delete v.changes]){
  const bad=structuredClone(value);mutate(bad);assert.throws(()=>verificationSchemaManifest(bad));
 }
 const source=readFileSync(new URL('./application-release-compatibility.mjs',import.meta.url),'utf8');
 assert.match(source,/import \{assertRecordedSchemaDatabase as assertSchemaDatabase\} from '\.\/application-release-template-database\.mjs'/);
 assert.match(source,/return assertSchemaDatabase\(verificationSchemaManifest\(value\)\)/);
 for(const path of ['application-release-authority.mjs','online-traffic-release.mjs','application-release-audit.mjs'])
  assert.match(readFileSync(new URL('./'+path,import.meta.url),'utf8'),/assertRecordedSchemaDatabase\(/);
});

test('adapter only imports pure validation helpers, never a process, network or database executor',()=>{
 const source=readFileSync(new URL('./application-release-verification.mjs',import.meta.url),'utf8');
 assert.deepEqual([...source.matchAll(/from '([^']+)'/g)].map(r=>r[1]),['node:util','./application-release-policy.mjs']);
 assert.doesNotMatch(source,/\b(?:exec|spawn|fetch|writeFile|process\.env|process\.kill)\s*\(/);
});
