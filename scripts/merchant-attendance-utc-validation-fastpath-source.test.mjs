// SOURCE-only checks. PostgreSQL equivalence/timing/atomic drift acceptance is
// separate; these assertions do not pretend to execute SQL in JavaScript.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {validateMigrationSource} from './check-supabase-migrations.mjs';
import {utcValidationFastpathMigration,utcValidationFoundationMigration,utcValidationOriginalHash,
 utcValidationFastpathRecipe,utcValidationFastpathApply,utcValidationFastpathSql} from './merchant-attendance-utc-validation-fastpath-source.mjs';
const dir=new URL('./supabase-migrations/',import.meta.url);
const original=readFileSync(new URL(utcValidationFoundationMigration,dir),'utf8');
const sql=readFileSync(new URL(utcValidationFastpathMigration,dir),'utf8').replaceAll('\r\n','\n');
const r=utcValidationFastpathRecipe(original),sha=v=>createHash('sha256').update(v,'utf8').digest('hex');

test('210 freezes one exact061 old expression with only exactC UTC CASE and byte-identical ELSE',()=>{
 assert.equal(r.oldHash,utcValidationOriginalHash);assert.equal(sha(r.oldBody),utcValidationOriginalHash);
 assert.equal(r.newBody,r.prefix+r.expression+r.suffix);assert.equal(r.oldBody,'\n  select '+r.expression+';\n');
 assert.equal(r.newBody.slice(r.prefix.length,-r.suffix.length),r.expression);assert.equal(sha(r.newBody),r.newHash);
 assert.equal(utcValidationFastpathApply(r.oldBody,r),r.newBody);
 assert.match(r.newBody,/case when p_zone collate "C" = 'UTC' then true else /);
 assert.match(r.expression,/^p_zone is not null and char_length\(p_zone\) <= 100/);
 assert.match(r.expression,/p_zone = 'UTC' or p_zone ~ '\^\[A-Za-z_\+-\]\+/);
 assert.match(r.expression,/exists \(select 1 from pg_catalog\.pg_timezone_names where name = p_zone\)/);
 assert.equal((r.newBody.match(/case when /g)||[]).length,1);
});
test('210 source rejects missing duplicate body or metadata drift instead of deriving a new baseline',()=>{
 assert.throws(()=>utcValidationFastpathRecipe(original.replace("p_zone = 'UTC'","p_zone = 'utc'")),/utc210_exact_original_required/);
 assert.throws(()=>utcValidationFastpathRecipe(original.replace('language sql stable','language sql immutable')),/utc210_original_metadata_required/);
 assert.throws(()=>utcValidationFastpathRecipe(original+original),/utc210_unique_original_required/);
 assert.throws(()=>utcValidationFastpathRecipe(original.replace('faolla_attendance_valid_zone_v1','faolla_attendance_valid_zone_other_v1')),/utc210_unique_original_required/);
 assert.throws(()=>utcValidationFastpathApply(r.oldBody+' ',r),/utc210_exact_forward_source_required/);
 assert.throws(()=>utcValidationFastpathApply(r.oldBody,{...r,newBody:r.newBody.replace('then true','then false')}),/utc210_exact_forward_delta_required/);
});
test('210 frozen SQL is registered additive source; no public RPC grants or permanent helper/fact rewrites',()=>{
 assert.equal(utcValidationFastpathSql(original),sql);assert.deepEqual(validateMigrationSource(utcValidationFastpathMigration,sql),[]);
 assert.match(sql,/version=202610080208 and name='merchant_attendance_delegated_revisions'/);
 assert.doesNotMatch(sql,/202610090209/);
 assert.match(sql,/version=202610090210 and name<>'merchant_attendance_utc_validation_fastpath'/);
 assert.equal((sql.match(/insert into /g)||[]).length,1);
 assert.match(sql,/insert into public\.faolla_schema_migrations\(version,name\)/);
 assert.doesNotMatch(sql,/\bgrant\s|\brevoke\s|\bcreate\s+(?:temp\s+)?table\s|\bupdate\s|\bdelete\s|\btruncate\s|alter function|set_config|session_replication_role/i);
 assert.doesNotMatch(readFileSync(new URL('./merchant-attendance-utc-validation-fastpath-source.mjs',import.meta.url),'utf8'),/child_process|pg_ctl|createdb|initdb|listen\(/);
});
test('210 preflight requires exact private SQL stable invoker identity and all old metadata before any replacement',()=>{
 for(const text of ["meta.lanname is distinct from 'sql'","meta.provolatile<>'s'",'meta.prosecdef',"array['search_path=pg_catalog']",
  "meta.prorettype<>'boolean'::regtype","meta.proargtypes is distinct from '25'::oidvector","array['p_zone']",
  'meta.pronargdefaults<>0','meta.proargdefaults is not null','meta.proallargtypes is not null','meta.proargmodes is not null',
  'meta.proretset','meta.proisstrict','meta.proleakproof',"meta.prokind<>'f'","meta.proparallel<>'u'",'meta.prosupport<>0::oid',
  'meta.procost<>100','meta.prorows<>0','meta.protrftypes is not null','meta.prosqlbody is not null',
  'proc.pronamespace=meta.pronamespace and proc.proname=meta.proname','meta.proowner is distinct from expected_owner',
  "has_function_privilege('anon',f,'EXECUTE')","has_function_privilege('authenticated',f,'EXECUTE')","has_function_privilege('service_role',f,'EXECUTE')",
  'aclexplode(coalesce(meta.proacl,acldefault','acl.grantor<>expected_owner or acl.grantee<>expected_owner',"acl.privilege_type<>'EXECUTE' or acl.is_grantable"])
  assert(sql.includes(text),text);
 assert(sql.indexOf('merchant_attendance_utc_validation_permission_conflict')<sql.indexOf('execute replace(definition'));
});
test('210 old versus reentry hashes are not interchangeable; exact UTC catalog and old true precede forward',()=>{
 assert.match(sql,new RegExp("is distinct from \\(case when installed then '"+r.newHash+"' else '"+r.oldHash+"' end\\)"));
 assert.match(sql,/old_body is distinct from \(case when installed then \$utc210_new\$/);
 assert.match(sql,/pg_catalog\.pg_timezone_names where name collate "C"='UTC'\)<>1/);
 assert.match(sql,/public\.faolla_attendance_valid_zone_v1\('UTC'\) is distinct from true/);
 assert.match(sql,/if not installed then[\s\S]*execute replace\(definition,old_body,\$utc210_new\$/);
 assert(sql.indexOf('merchant_attendance_utc_validation_builtin_required')<sql.indexOf('execute replace(definition'));
 assert.doesNotMatch(sql,/oldHash| in\('[0-9a-f]{64}','[0-9a-f]{64}'\)/);
});
test('210 installer CASE comparisons are grouped so PLpgSQL IF does not consume inner THEN as its boundary',()=>{
 assert.equal((sql.match(/is distinct from \(case when installed then /g)||[]).length,2);
 assert.doesNotMatch(sql,/is distinct from case when installed then /);
 assert.match(sql,/else '[a-f0-9]{64}' end\)\n  or old_body/);
 assert(sql.includes('$utc210_old$ end)\n  then raise exception'));
 assert.equal(r.oldHash,utcValidationOriginalHash);
 assert.equal(r.newHash,'03b6beb68f9e439e7d1761f2970f8520d80c28491ec1ddc1891c496774eb1ac6');
});
test('210 replacement preserves original OID and entire pg_proc metadata except exact prosrc change',()=>{
 assert.match(sql,/proc\.oid,to_jsonb\(proc\)-'prosrc',pg_get_functiondef\(proc\.oid\) into original_oid,original_metadata,definition/);
 assert.match(sql,/to_regprocedure\('public\.faolla_attendance_valid_zone_v1\(text\)'\)::oid is distinct from original_oid/);
 assert.match(sql,/proc\.oid=original_oid and to_jsonb\(proc\)-'prosrc'=original_metadata/);
 assert.match(sql,/length\(definition\)-length\(replace\(definition,old_body,''\)\)\)\/length\(old_body\)<>1/);
 assert.match(sql,/merchant_attendance_utc_validation_forward_metadata_changed/);
 assert(sql.indexOf('merchant_attendance_utc_validation_forward_metadata_changed')<sql.indexOf('insert into public.faolla_schema_migrations'));
});
