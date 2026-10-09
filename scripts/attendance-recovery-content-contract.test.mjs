import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {ATTENDANCE_RECOVERY_PROFILE,ATTENDANCE_RECOVERY_RELATIONS,ATTENDANCE_RECOVERY_CATALOG_CATEGORIES,
  ATTENDANCE_RECOVERY_LIMITS,buildAttendanceRecoveryContentSql,buildAttendanceRecoveryReadOnlyPsqlArgs,
  validateAttendanceRecoveryContent,assertAttendanceRecoveryContentMatch,buildAttendanceRecoveryCatalogDiagnosticSql} from './attendance-recovery-content-contract.mjs';
import {DATABASE_RECOVERY_CONTENT_SCHEMA_VERSION,DATABASE_RECOVERY_RELATIONS,buildDatabaseRecoveryContentSql} from './database-recovery-content-contract.mjs';

const schema='attendance_race_0123456789abcdef0123456789abcdef';
const sql=()=>buildAttendanceRecoveryContentSql({schema});
function proof(){return {profile:ATTENDANCE_RECOVERY_PROFILE,schemaVersion:1,schema,schemaPresent:true,serverMajor:15,limited:false,unsupported:false,
  relations:ATTENDANCE_RECOVERY_RELATIONS.map(name=>({name,present:true,kind:'r',rowCount:'0',limited:false,contentSha256:'a'.repeat(64)})),
  catalog:Object.fromEntries(ATTENDANCE_RECOVERY_CATALOG_CATEGORIES.map(k=>[k,{count:k==='namespace'?'1':'0',limited:false,sha256:'b'.repeat(64)}]))};}
const rejected = change=>{const p=proof();change(p);assert.equal(validateAttendanceRecoveryContent(p).valid,false);};

test('inert independent profile leaves existing recovery v2 roster and SQL unchanged',()=>{
  assert.equal(DATABASE_RECOVERY_CONTENT_SCHEMA_VERSION,2);
  assert.deepEqual(DATABASE_RECOVERY_RELATIONS,['public.pages','public.faolla_redemption_operations','public.faolla_redemption_checkouts','public.faolla_schema_migrations','public.faolla_platform_snapshot_restore_receipts']);
  assert.doesNotMatch(buildDatabaseRecoveryContentSql(),/attendance/);
  const source=readFileSync(new URL('./attendance-recovery-content-contract.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(source,/^\s*import\b|\b(?:require|fetch|execFile|spawn|listen|createConnection)\s*\(/m);
});

test('fixed attendance roster matches every table created through migration181',()=>{
  const folder=new URL('./supabase-migrations/',import.meta.url),actual=new Set();
  for(const file of readdirSync(folder)){
    const number=file.match(/^\d{8}(\d{4})_/);if(!number||Number(number[1])>181)continue;
    const source=readFileSync(new URL(file,folder),'utf8');
    for(const match of source.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?public\.(merchant_attendance_[a-z0-9_]+)/gi))actual.add(match[1]);
  }
  assert.deepEqual(ATTENDANCE_RECOVERY_RELATIONS.filter(n=>n.startsWith('merchant_attendance_')),[...actual].sort());
  assert.equal(new Set(ATTENDANCE_RECOVERY_RELATIONS).size,ATTENDANCE_RECOVERY_RELATIONS.length);
  assert(Object.isFrozen(ATTENDANCE_RECOVERY_RELATIONS));
  for(const name of ['merchant_attendance_period_artifacts','merchant_attendance_account_epochs','merchant_attendance_pin_credentials',
    'merchant_attendance_missing_delegation_revocations','merchant_attendance_outage_relation_operations'])assert(ATTENDANCE_RECOVERY_RELATIONS.includes(name));
});

test('only explicit bounded schema identifiers enter generated SQL',()=>{
  for(const schema of ['',null,1,'a.b','a"b','a;b','a\nb','Public','a'.repeat(64),'pg_catalog','pg_temp_1','information_schema']){
    assert.throws(()=>buildAttendanceRecoveryContentSql({schema}),/attendance_recovery_schema_invalid/);
  }
  for(const options of [null,{},[],{schema,secret:'x'},{schema,relations:[]}])assert.throws(()=>buildAttendanceRecoveryContentSql(options),/attendance_recovery_schema_invalid/);
  assert(buildAttendanceRecoveryContentSql({schema:'public'}).includes("nspname='public'"));
});

test('missing and empty remain different, and incomplete mandatory foundation is rejected',()=>{
  const p=proof(),missing=p.relations.find(r=>r.name==='merchant_attendance_pin_clock_receipts');
  Object.assign(missing,{present:false,kind:null,rowCount:null,contentSha256:null});
  assert.equal(validateAttendanceRecoveryContent(p).valid,true);
  assert.throws(()=>assertAttendanceRecoveryContentMatch(p,proof()),/content_mismatch/);
  rejected(p=>Object.assign(p.relations.find(r=>r.name==='merchants'),{present:false,kind:null,rowCount:null,contentSha256:null}));
  rejected(p=>{p.schemaPresent=false;});
});

test('every fixed relation is required once; actual supporting tables are sorted and compared',()=>{
  for(const change of [p=>p.relations.pop(),p=>p.relations.reverse(),p=>p.relations.push(p.relations[0]),
    p=>{p.relations[0].name='untracked_replacement';},p=>{p.relations[0].rows=[];},p=>{p.secret='no';}])rejected(change);
  const extra=proof();extra.relations.push({name:'support_table',present:true,kind:'r',rowCount:'1',limited:false,contentSha256:'c'.repeat(64)});
  extra.relations.sort((a,b)=>a.name<b.name?-1:1);
  assert.equal(validateAttendanceRecoveryContent(extra).valid,true);
  assert.throws(()=>assertAttendanceRecoveryContentMatch(extra,proof()),/mismatch/);
});

test('strict counts, hashes, flags and unsupported objects cannot be silently truncated',()=>{
  for(const [key,value] of [['rowCount','01'],['rowCount',-1],['rowCount','100001'],['rowCount','1.0'],['rowCount',null],
    ['contentSha256','A'.repeat(64)],['contentSha256',null],['limited',true],['present',1],['kind','f']])rejected(p=>{p.relations[0][key]=value;});
  for(const key of ['limited','unsupported'])rejected(p=>{p[key]=true;});
  rejected(p=>{p.serverMajor=16;});rejected(p=>{p.schemaVersion=2;});
  rejected(p=>{p.relations[0].kind='S';});
  rejected(p=>Object.assign(p.relations[0],{present:false,kind:null,rowCount:'0',contentSha256:null}));
});

test('catalog count/digest/roster validation rejects missing or extra security categories',()=>{
  for(const change of [p=>{delete p.catalog.functions;},p=>{p.catalog.extra={};},p=>{p.catalog.namespace.count='0';},
    p=>{p.catalog.functions.count='20001';},p=>{p.catalog.functions.limited=true;},p=>{p.catalog.triggers.sha256=null;},
    p=>{p.catalog.relations.rawAcl='secret';}])rejected(change);
});

test('exact restored equality includes all row and security digests and schema identity',()=>{
  assert.deepEqual(assertAttendanceRecoveryContentMatch(proof(),proof()),proof());
  for(const name of ATTENDANCE_RECOVERY_RELATIONS){const p=proof();p.relations.find(r=>r.name===name).contentSha256='d'.repeat(64);assert.throws(()=>assertAttendanceRecoveryContentMatch(p,proof()),/mismatch/);}
  for(const name of ATTENDANCE_RECOVERY_CATALOG_CATEGORIES){const p=proof();p.catalog[name].sha256='e'.repeat(64);assert.throws(()=>assertAttendanceRecoveryContentMatch(p,proof()),/mismatch/);}
  const other=proof();other.schema='another_owned_namespace';assert.throws(()=>assertAttendanceRecoveryContentMatch(other,proof()),/mismatch/);
  assert.throws(()=>assertAttendanceRecoveryContentMatch(null,proof()),/content_invalid/);
});

test('profile comparison is detached and ignores input property insertion order',()=>{
  const p=proof(),reordered={...p,catalog:Object.fromEntries(Object.entries(p.catalog).reverse())};
  assert.deepEqual(assertAttendanceRecoveryContentMatch(reordered,p),p);
  const copy=validateAttendanceRecoveryContent(p).content;copy.relations[0].contentSha256='f'.repeat(64);
  assert.equal(p.relations[0].contentSha256,'a'.repeat(64));
});

test('SQL hashes bounded individual rows before sorted aggregation, including archive text',()=>{
  const s=sql();assert.match(s,/to_jsonb\(r\)::text value/);assert.match(s,/LIMIT 100001/);
  assert.match(s,/string_agg\(hash,'''' ORDER BY hash COLLATE "C"\)/);
  assert.match(s,/max\(bytes\),0\)<=8388608/);assert.match(s,/LIMIT 257/);assert.match(s,/LIMIT 20001/);
  assert.match(s,/UNION SELECT relname::text FROM classes/);
  assert.match(s,/WHEN c.relkind='S'/);assert.match(s,/last_value,is_called/);
  assert.doesNotMatch(s,/\b(?:INSERT|UPDATE|DELETE|CREATE|DROP|TRUNCATE|COPY|CALL)\b/);
  // Demonstrates byte-sensitive text hashing only; actual PostgreSQL hashes are
  // verified by the caller-owned native rehearsal, not simulated in this test.
  const hash=text=>createHash('sha256').update(JSON.stringify({artifact_text:text})).digest('hex');
  assert.notEqual(hash('{"n":1}'),hash('{ "n":1}'));assert.notEqual(hash('\u00e9'),hash('e\u0301'));
});

test('catalog normalizes roles/ACLs and stable definitions, never serializes object OIDs',()=>{
  const s=sql();assert.match(s,/aclexplode/);assert.match(s,/pg_get_userbyid\(a\.grantor\)/);assert.match(s,/a\.privilege_type COLLATE "C",a\.is_grantable/);
  for(const expression of ['pg_get_function_identity_arguments','pg_get_functiondef','pg_get_triggerdef','pg_get_constraintdef','pg_get_indexdef','relrowsecurity','relforcerowsecurity','polwithcheck','prosecdef','proleakproof','defaclacl'])assert(s.includes(expression));
  assert.match(s,/WHERE NOT t\.tgisinternal/);
  assert.doesNotMatch(s,/jsonb_build_array\((?:c|p|t|k)\.oid[,)]/);
  assert.doesNotMatch(s,/jsonb_build_object\('(?:oid|rows|body|definition|password|raw)'/);
});

test('read-only repeatable snapshot fixes serialization and refuses silent RLS filtering',()=>{
  const query=sql(),args=buildAttendanceRecoveryReadOnlyPsqlArgs(query);
  for(let n=0;n<args.length;n+=2)assert.equal(args[n],'--command');
  assert.equal(args[1],'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;');
  for(const setting of ["timezone='UTC'","datestyle='ISO,YMD'",'extra_float_digits=3','search_path=pg_catalog','row_security=off',"bytea_output='hex'","intervalstyle='postgres'","statement_timeout='60s'"])assert(args.includes('SET LOCAL '+setting+';'));
  assert.equal(args.at(-3),query);assert.equal(args.at(-1),'COMMIT;');
  for(const bad of ['',null,'DELETE FROM x;'])assert.throws(()=>buildAttendanceRecoveryReadOnlyPsqlArgs(bad),/query_invalid/);
  assert.equal(ATTENDANCE_RECOVERY_LIMITS.rows,100000);
});

test('optional diagnostics reuse exact hashed relation/constraint metadata without application rows',()=>{
  const profile=sql();
  for(const category of ['relations','constraints']){
    const diagnostic=buildAttendanceRecoveryCatalogDiagnosticSql({schema,category});
    const expression=diagnostic.match(/FROM \((SELECT pg_catalog\.jsonb_build_array[\s\S]+)\) catalog_entries LIMIT 5001/)[1];
    assert(profile.includes(expression),'diagnostic must reuse the unchanged catalog projection');
    assert.match(diagnostic,/count\(\*\)>5000/);assert.match(diagnostic,/CASE WHEN pg_catalog.count\(\*\)<=5000 THEN/);
    assert.match(diagnostic,/ORDER BY key::text COLLATE "C"/);
    assert.doesNotMatch(diagnostic,/to_jsonb\(r\)|query_to_xml|\b(?:INSERT|UPDATE|DELETE|CREATE|DROP|TRUNCATE|COPY|CALL)\b/);
  }
});

test('diagnostic category/schema are explicit allowlisted and cannot broaden to row contents',()=>{
  for(const options of [null,{},[],{schema,category:'functions'},{schema,category:'rows'},{schema:'a.b',category:'relations'},
    {schema,category:['relations']},{schema,category:'relations',limit:999999}]){
    assert.throws(()=>buildAttendanceRecoveryCatalogDiagnosticSql(options),/attendance_recovery_diagnostic_invalid/);
  }
});

test('effective relation ACL normalization is type-correct and retains all security tuple fields',()=>{
  const s=buildAttendanceRecoveryCatalogDiagnosticSql({schema,category:'relations'});
  assert.match(s,/c\.relkind IN\('r','p','v','m','f'\) THEN COALESCE\(c\.relacl,pg_catalog\.acldefault\('r'::"char",c\.relowner\)\) ELSE c\.relacl END/);
  assert.doesNotMatch(s,/acldefault\('s'/);
  for(const field of ['a.grantor','a.grantee','a.privilege_type','a.is_grantable'])assert(s.includes(field));
  assert.match(sql(),/CASE WHEN p\.proacl IS NULL THEN NULL/);
  assert.match(sql(),/CASE WHEN n\.nspacl IS NULL THEN NULL/);
  assert.doesNotMatch(s,/NULLIF\(c\.relacl/); // explicit empty ACL must not become owner defaults
  const original=proof(),tuples=[['postgres','postgres','SELECT',false]];
  const fingerprint=acl=>createHash('sha256').update(JSON.stringify(acl)).digest('hex');
  original.catalog.relations.sha256=fingerprint(tuples);
  for(const changed of [[['postgres','PUBLIC','SELECT',false]],[['postgres','postgres','UPDATE',false]],
    [['postgres','postgres','SELECT',true]],[['other_grantor','postgres','SELECT',false]],[]]){
    const restored=structuredClone(original);restored.catalog.relations.sha256=fingerprint(changed);
    assert.throws(()=>assertAttendanceRecoveryContentMatch(restored,original),/content_mismatch/);
  }
});

test('CHECK formatting delegates to PG precedence rules and never ignores changed AND/OR/NOT structure',()=>{
  const s=buildAttendanceRecoveryCatalogDiagnosticSql({schema,category:'constraints'});
  assert.match(s,/pg_get_constraintdef\(k\.oid,k\.contype='c'\)/);
  assert.doesNotMatch(s,/replace\(|regexp_replace|translate\(/);
  for(const field of ['k.conname','k.contype','k.condeferrable','k.condeferred','k.convalidated','k.connoinherit'])assert(s.includes(field));
  // These are supplied canonical metadata counterexamples, NOT a mocked SQL
  // parser or a claim that the PostgreSQL deparser has run in this pure test.
  const expressions=['CHECK (a AND (b OR c))','CHECK (a AND b OR c)','CHECK (a OR b OR c)',
    'CHECK (NOT (a AND b))','CHECK (NOT a AND b)','CHECK (amount > 1)','CHECK (amount >= 1)'];
  const proofs=expressions.map(expression=>{const p=proof();p.catalog.constraints.sha256=createHash('sha256').update(expression).digest('hex');return p;});
  for(let a=0;a<proofs.length;a++)for(let b=a+1;b<proofs.length;b++){
    assert.throws(()=>assertAttendanceRecoveryContentMatch(proofs[a],proofs[b]),/content_mismatch/);
  }
});
