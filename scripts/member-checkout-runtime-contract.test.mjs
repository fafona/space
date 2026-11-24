import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { runtimeContract, renderRuntimePrototype, runtimeFixture } from './member-checkout-runtime-contract.mjs';

test('reviewed runtime prototype exactly matches the pinned protocol and has no dynamic SQL dispatcher', async () => {
  const contract = await runtimeContract(), sql = renderRuntimePrototype(contract), code = sql.replace(/^--.*$/gm,'');
  assert.equal((await readFile(runtimeFixture,'utf8')).replace(/\r\n/g,'\n'),sql);
  assert.equal(contract.methods.length,46);
  assert.doesNotMatch(sql,/\bEXECUTE\s+(?:format|p_function|["'$])/i);
  assert.doesNotMatch(sql,/GRANT\s+faolla_checkout_executor\s+TO|GRANT.*TO\s+(?:PUBLIC|anon|authenticated|service_role)|UPDATE\s+faolla_checkout_design\./i);
  assert.match(sql,/REVOKE ALL ON FUNCTION public.faolla_checkout_runtime_v1\(text,jsonb\) FROM PUBLIC,anon,authenticated,service_role/);
  assert.match(sql,/SET search_path=pg_catalog,pg_temp/);
  assert.doesNotMatch(code,/CREATE\s+OR\s+REPLACE|\bPASSWORD\b\s*['"]|authenticator/i);
});

test('every dispatch has a fixed exact argument set and a schema-qualified typed call', async () => {
  const contract = await runtimeContract(), sql = renderRuntimePrototype(contract);
  for (const p of contract.methods) {
    assert.equal(sql.split(`WHEN '${p.name}' THEN`).length-1,2);
    assert.ok(sql.includes(`RETURN public.${p.name}(`));
    assert.ok(p.args.every(a=>sql.includes(`p_arguments->'${a}'`) || sql.includes(`p_arguments->>'${a}'`)));
  }
  assert.match(sql,/p_arguments \?& allowed/); assert.match(sql,/jsonb_object_keys\(p_arguments\)/);
});

test('server method metadata has exactly the 46 reviewed SQL bindings, no ordinary financial writer', async () => {
  const contract = await runtimeContract();
  const metadata = JSON.parse(await readFile('src/lib/merchantCheckoutRuntimeMethods.json','utf8'));
  assert.deepEqual(metadata,Object.fromEntries(contract.methods.map(p=>[p.name,p.args])));
  assert.equal(Object.hasOwn(metadata,'faolla_commit_order_membership_v1'),false);
  assert.equal(Object.hasOwn(metadata,'faolla_commit_redemption_v1'),false);
});

test('all new default RPC adapters use the dedicated server transport; ordinary read/write adapters stay separate', async () => {
  const files = ['BoundSubmit','CartCollection','CartHistory','CartHttp','ConfigurationStore','HistoryInventory','HistoryPending','HistoryRecovery','IntentHttp',
    'LegacyBoundary','LegacyReview','OnSiteCollection','OnSiteHttp','OriginalResource','OriginalService','Reporting','RetainedIntent','Submission','UnusedReference'];
  for (const file of [...files.map(v=>`src/lib/merchantCheckout${v}.server.ts`),'src/lib/merchantMemberCheckoutResult.server.ts','src/app/api/member-checkout/single/route-handler.ts']) {
    const text=await readFile(file,'utf8'); assert.match(text,/createServerMerchantCheckoutRuntimeClient\(\)/,file); assert.doesNotMatch(text,/createServerSupabaseServiceClient/,file);
  }
  const old = await readFile('src/lib/merchantBookingAtomicRuntime.server.ts','utf8');
  assert.match(old,/if \(name === "faolla_checkout_legacy_booking_commit_v1"\)[\s\S]*?runtime\.rpc\(name, args\)/);
  assert.match(old,/return await client\.rpc\(name, args\)/);
  for (const file of ['merchantCheckoutEntry','merchantCheckoutPreview','merchantCheckoutConfigurationOptions'])
    assert.match(await readFile(`src/lib/${file}.server.ts`,'utf8'),/createServerSupabaseServiceClient/);
});

test('no use-client import graph can reach the dedicated credential transport or its method metadata', async () => {
  const require = createRequire(import.meta.url), ts = require('typescript'), fs = require('node:fs');
  const root = path.resolve('src'), files=[];
  const walk=dir=>{for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,entry.name);if(entry.isDirectory())walk(p);else if(/\.(?:ts|tsx)$/.test(entry.name)&&!entry.name.includes('.test.'))files.push(p);}};walk(root);
  const options=ts.readConfigFile(path.resolve('tsconfig.json'),ts.sys.readFile);
  const config=ts.parseJsonConfigFileContent(options.config,ts.sys,process.cwd()).options;
  const forbidden = new Set(['merchantCheckoutRuntime.server.ts','merchantCheckoutRuntimeMethods.json']);
  const cache=new Map();
  const visit=(file,chain=[])=>{
    assert.equal(forbidden.has(path.basename(file)),false,chain.concat(file).join(' -> '));
    if(cache.has(file))return;cache.set(file,true);
    const text=fs.readFileSync(file,'utf8'),source=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true);
    for(const statement of source.statements){
      if(!ts.isImportDeclaration(statement)&&!ts.isExportDeclaration(statement))continue;
      if(statement.isTypeOnly||statement.importClause?.isTypeOnly)continue;
      const bindings=statement.importClause?.namedBindings;
      if(bindings&&ts.isNamedImports(bindings)&&bindings.elements.length&&bindings.elements.every(v=>v.isTypeOnly)&&!statement.importClause.name)continue;
      const name=statement.moduleSpecifier;if(!name||!ts.isStringLiteral(name))continue;
      const resolved=ts.resolveModuleName(name.text,file,config,ts.sys).resolvedModule?.resolvedFileName;
      if(resolved&&resolved.startsWith(root+path.sep)&&!resolved.endsWith('.d.ts'))visit(resolved,chain.concat(file));
    }
  };
  const clients=files.filter(file=>/^\s*["']use client["'];/.test(fs.readFileSync(file,'utf8')));assert.ok(clients.length>100);
  for(const file of clients)visit(file);
});
