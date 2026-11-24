import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
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
