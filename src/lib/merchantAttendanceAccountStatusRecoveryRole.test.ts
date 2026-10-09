import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../../scripts/fixtures/attendance-account-status-recovery-role.mjs", import.meta.url), "utf8");

test("committed role fixture requires current synthetic manager and real enabled before-update touch", () => {
  for (const text of ["d?.syntheticOnly===true&&h?.syntheticOnly===true", "assertLifecycleSandbox", "assert.deepEqual(owned,d.owned)", "assert.equal(scope.schema,owned.schema)",
    "t.tgtype=19 and t.tgenabled='O'", "t.tgfoid='public.faolla_touch_versioned_row()'::regprocedure", "new.updated_at = now(); new.version = old.version + 1;", "and auth_user_id=${quote(d.auth)}"])
    assert(source.includes(text), text);
  assert.doesNotMatch(source, /disable trigger|enable trigger|session_replication_role|create (?:or replace )?function|drop |truncate |delete from|process\.argv|spawn\(/i);
});

test("only permissions are written and two genuine metadata advances are distinguished from byte restoration", () => {
  assert.match(source, /set permissions=array\(select jsonb_array_elements_text/);
  assert.doesNotMatch(source, /set (?:updated_at|version)\s*=|,\s*(?:updated_at|version)\s*=/);
  assert.match(source, /r\.version=\$\{expectedVersion\}/);
  assert.match(source, /changedRole\(restricted,original,\['enterprise.view'\],1,monotonic\(\)\)/);
  assert.match(source, /changedRole\(restored,original,original.permissions,2,monotonic\(\)\)/);
  assert.match(source, /select to_jsonb\(updated_at>=\$\{quote\(original.updated_at\)\}::timestamptz\)/);
  assert.match(source, /return \{value,restoredFacts,permissionRestored:true,roleVersionAdvances:2\}/);
});

test("callback failure still attempts protected restoration and aggregates primary/cleanup failures", () => {
  for (const text of ["inventory.filter(name=>name!==roleTable)", "assert.deepEqual(otherRoles(roles()),initialOthers", "d.fingerprint(protectedTables),protectedFacts",
    "d.definitions(),definitions", "d.tableCatalog(),catalog", "try{value=await callback();}catch(error){failures.push(error);}", "try{assert.equal(d.fingerprint(),restrictedFacts",
    "const restored=update(original.permissions,original.version+1)", "if(failures.length)throw new AggregateError"])
    assert(source.includes(text), text);
});
