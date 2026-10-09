//227 wrapper contracts only: no database, browser, build or native execution.
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import {readFileSync} from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
import test from 'node:test';

const read=name=>readFileSync(new URL('./'+name,import.meta.url),'utf8').replaceAll('\r\n','\n');
const source=read('merchant-attendance-retention-native.mjs');
const has=(value,...tokens)=>tokens.forEach(token=>assert(value.includes(token),token));
const order=(value,...tokens)=>{let previous=-1;for(const token of tokens){const position=value.indexOf(token,previous+1);assert(position>previous,token);previous=position;}};

test('import is inert even with all process launchers and network fetch forbidden',async()=>{
 const names=['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork'];
 const saved=new Map(names.map(name=>[name,childProcess[name]])),oldFetch=globalThis.fetch;let attempts=0;
 const forbidden=()=>{attempts++;throw Error('retention_test_forbids_runtime');};
 try{
  for(const name of names)childProcess[name]=forbidden;
  globalThis.fetch=forbidden;syncBuiltinESMExports();
  const importedRunner=await import(new URL('./merchant-attendance-retention-native.mjs?inert-contract-test',import.meta.url));
  assert.deepEqual(Object.keys(importedRunner),['runAttendanceRetentionNative']);assert.equal(typeof importedRunner.runAttendanceRetentionNative,'function');assert.equal(attempts,0);
 }finally{
  for(const [name,value]of saved)childProcess[name]=value;
  globalThis.fetch=oldFetch;syncBuiltinESMExports();
 }
 has(source,'if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))runAttendanceRetentionNative(process.argv.slice(2))',
  'process.exitCode=1');
});

test('wrapper delegates to the existing caller-owned211 context and installs only182',()=>{
 has(source,"migration='202610070182_merchant_attendance_retention.sql'",'return runAttendanceOutageNative(args,async ctx=>',
  'd.syntheticOnly===true&&h.syntheticOnly===true','assert.deepEqual(assertLifecycleSandbox(d.exec),d.owned)',
  'const install=()=>d.exec(boundClockMigrationBody(native.root,migration))');
 assert.doesNotMatch(source,/initdb|create database|drop database|pg_dump|spawn\(|spawnSync\(|playwright|listen\(|writeFile|mkdir|process\.env\[/i);
 assert.equal((source.match(/boundClockMigrationBody\(/g)||[]).length,1);
 const outage=read('merchant-attendance-outage-native.mjs');
 order(outage,'const sealed=await full.seal();assert(sealed.period.sealed)',
  'result=await checkOutageAtSealedPeriod(full)','await after({...full,outageFoundation:result})');
});

test('additive install and reentry preserve every original table, old function body and ACL',()=>{
 has(source,"oldNames=d.inventory().filter(n=>n!=='faolla_schema_migrations')",'before=d.fingerprint(oldNames)',
  'p.oid,pg_get_functiondef(p.oid),p.proowner,p.proacl,p.proconfig,p.prosecdef',"p.oid=any(${quote(oids)}::oid[])");
 order(source,'definitionsBefore=oldFunctions()',
  'install();assert.equal(d.fingerprint(oldNames),before);assert.equal(oldFunctions(),definitionsBefore)',
  'const installed=d.fingerprint(),definitions=d.definitions(),catalog=d.tableCatalog();install()',
  'assert.equal(d.fingerprint(),installed);assert.equal(d.definitions(),definitions);assert.equal(d.tableCatalog(),catalog)',
  'const metadata=await verifyAttendanceRetentionNative(ctx)',
  'assert.equal(d.fingerprint(),installed);assert.equal(d.definitions(),definitions);assert.equal(d.tableCatalog(),catalog)');
 assert.doesNotMatch(source,/oldNames=.*retention_policy_operations|oldNames=.*preservation_operations/);
});

test('exactly five distinct two-writer cases retain actual PID witness and the intended flag/revision semantics',()=>{
 const kinds=source.match(/for\(const \[index,kind\]of (\[[^\n]+?\])\.entries\(\)\)/)?.[1];assert(kinds);
 assert.deepEqual([...kinds.matchAll(/'([^']+)'/g)].map(match=>match[1]),['cas','same_operation','operation_conflict','holder_rollback','cross_ledger_operation']);
 has(source,'const head=read(q).data.items.find(p=>p.category===category)','expectedRevision:head.revision',
  "if(kind==='same_operation')waiter=holder", "if(kind==='operation_conflict')waiter={...holder,reason:holder.reason+' changed'}",
  'assert.deepEqual(retentionWriteQuery(holder),q);assert.deepEqual(retentionWriteQuery(waiter),waitQuery)',
  'lifecycleRace({connect:()=>native.connect(),query:sql=>native.query(sql),sql:scope.sql}',
  "statement(q,holder),statement(waitQuery,waiter,kind!=='same_operation'),{rollback:kind==='holder_rollback'}",
  'assert(raced.witnessed)','assert.equal(held.receipt.revision,head.revision+1)');
 assert.doesNotMatch(source,/setTimeout|sleep\(|skip|TODO/);
});

test('cross-ledger duplicate operation uses a real event and verified current source, never a seeded hold',()=>{
 const branch=source.slice(source.indexOf("if(kind==='cross_ledger_operation'){"),source.indexOf('assert.deepEqual(retentionWriteQuery(holder)'));
 has(branch,'select id::text from public.merchant_attendance_events where merchant_id=',
  "waitQuery={siteId:d.site,mode:'record',category:'events',recordId:event}",
  'const record=read(waitQuery).data.item',"action:'hold',operationId:holder.operationId",
  'expectedRevision:record.preservation.revision','expectedSourceFingerprint:record.sourceFingerprint');
 assert.doesNotMatch(source,/insert into|update public|delete from|disable trigger/i);
});

test('race results parse real SQL replies, separate exact replay from holder rollback and pin rejection codes',()=>{
 has(source,'projectRetentionResult(JSON.parse(text.trim()),q,d.owner,c)',
  "if(['cas','operation_conflict','cross_ledger_operation'].includes(kind))",'assert(raced.right.error);assert.equal(raced.right.output,null)',
  "/ERROR:\\s+attendance_retention_changed(?:\\s|$)/", "/ERROR:\\s+attendance_operation_conflict(?:\\s|$)/",
  'assert.equal(raced.right.error,null);const value=project(waitQuery,waiter,raced.right.output)',
  "if(kind==='same_operation')assert.deepEqual(value.receipt,held.receipt)",
  'assert.equal(value.receipt.revision,head.revision+1)',
  "assert.equal(read({siteId:d.site,mode:'recover',operationId:holder.operationId}).receipt,null)");
 const loop=source.slice(source.indexOf('for(const [index,kind]'),source.indexOf("native.pass('227 five"));
 has(loop,'assert.equal(d.fingerprint(oldNames),before);assert.equal(oldFunctions(),definitionsBefore)',
  'archive().artifactText,oldArchive.artifactText','periodArchive().artifactText,saved.artifactText',
  'assert.equal(d.definitions(),definitions);assert.equal(d.tableCatalog(),catalog)',
  'archive().artifactSha256,oldArchive.artifactSha256','periodArchive().artifactSha256,saved.artifactSha256');
});

test('committed race rows remain only in owned namespace; cleanup and public baseline validation stay with outer lifecycle',()=>{
 has(source,'fixtureRolledBack:true,raceRowsOnlyInOwnedSchema:true,newCluster:false,productionAccess:false,browser:false,deployed:false');
 assert.doesNotMatch(source,/drop schema|baselineRestored:true|stopped:true|allTransactionsRolledBack:true/);
 const review=read('merchant-attendance-plan-posthoc-review-native.mjs'),base=read('merchant-attendance-plan-posthoc-native.mjs');
 has(review,'return runPlanPosthocNative(args,async ctx=>');
 has(base,'await runAttendanceLabelsReuse(args,native=>withAttendanceConcurrencySandbox(native,async scope=>',
  'result.extension=await extension(');
 const sandbox=read('merchant-attendance-concurrency-sandbox.mjs'),reuse=read('merchant-attendance-choice-labels-reuse-native.mjs');
 order(sandbox,'await check({schema, sql})','} finally {','assert.deepEqual(current, owned, "attendance_concurrency_cleanup_identity_mismatch")','drop schema ${schema} cascade;');
 order(reuse,'await check({','await connections.closeAll()',
  'assert.equal(snapshot(), before, "attendance_reuse_transaction_did_not_restore_state")',
  'assert.equal(namespaces(), beforeNamespaces, "attendance_reuse_namespace_not_restored")',
  'assert.equal(tableInventory(), beforeTables, "attendance_reuse_table_inventory_not_restored")',
  'if (checkFailure) throw checkFailure','baselineRestored:true',
  '} finally {','attendance_reuse_stop_directory_mismatch','attendance_reuse_stop_port_mismatch','stopped:true');
});
