import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {attendanceExtensionMetadataPins,attendanceExtensionMetadataSnapshotSql,validateAttendanceExtensionMetadata,attendanceExtensionMetadataSupplement,attendanceGraphqlInitialSchemaAclSnapshotExpression,attendanceGraphqlInitialSchemaAclSnapshotSql,validateAttendanceGraphqlInitialSchemaAclSnapshot} from './attendance-extension-metadata.mjs';
import {syntheticAttendanceExtensionMetadata,syntheticAttendanceGraphqlInitialAclMetadata,syntheticAttendanceGraphqlInitialSchemaAclMetadata,syntheticAttendanceExtensionDump,syntheticAttendanceExtensionGrants} from './test-helpers/attendance-extension-metadata.mjs';
const sha=value=>createHash('sha256').update(value).digest('hex');
const sequenceMetadata=sequence=>{
 const snapshot=syntheticAttendanceExtensionMetadata();
 snapshot.find(e=>e.name==='pg_net').members.find(m=>m.catalog==='pg_class').metadata.sequence=sequence;
 return snapshot;
};

test('read-only sampler covers every member address and complete routine semantics without rows or roles',()=>{
 const sql=attendanceExtensionMetadataSnapshotSql();
 assert(sql.startsWith('-- attendance_compatibility_extension_metadata\nbegin read only;'));
 for(const field of ['pg_depend','pg_identify_object','pg_event_trigger','pg_get_functiondef','pg_language','prosupport','probin','proargmodes','proallargtypes','proargdefaults','prorettype','procost','prorows','proparallel','proleakproof','proisstrict','proretset','prosecdef','proconfig','aclexplode','extconfig','extcondition','pg_sequence'])assert(sql.includes(field),field);
 assert(!/from\s+(?:auth\.users|vault\.secrets|net\.http_request_queue)|create\s+(?:role|database)|grant\s|alter\s|pg_authid|password|reltuples|relpages|last_value/i.test(sql));
});
test('actual three public definitions and eight exact extension/count pins are portable synthetic fixtures',()=>{
 const source=syntheticAttendanceExtensionMetadata(),validated=validateAttendanceExtensionMetadata(source);
 assert.equal(source.reduce((n,e)=>n+e.members.length,0),96);assert.equal(source.reduce((n,e)=>n+e.routines.length,0),80);
 assert.deepEqual(source.map(e=>[e.name,e.version,e.schema,e.members.length,e.routines.length]),attendanceExtensionMetadataPins);
 assert.equal(validated.wrapper.definitionSha256,'22e0e26950cfdf51038425ad17051de3fb19bc7afa72edefda05c2da3e0d8bb2');
 assert.deepEqual(validated.net.map(r=>[r.securityDefiner,r.config]),[[false,['search_path=net']],[false,['search_path=net']]]);
 assert.equal(validated.snapshotSha256,sha(JSON.stringify(source)));
});
test('independent supplement retains all dump bytes and restores owner/member before the first named ACL',()=>{
 const snapshot=syntheticAttendanceExtensionMetadata(),result=attendanceExtensionMetadataSupplement(syntheticAttendanceExtensionDump,snapshot);
 assert.equal(result.sourceSha256,sha(syntheticAttendanceExtensionDump));assert.equal(result.snapshotSha256,sha(JSON.stringify(snapshot)));assert.equal(result.supplementSha256,sha(result.supplementSql));
 const split=result.supplementSql.indexOf('\n-- Compare every actual extension member');
 assert(split>0);const insertion=result.supplementSql.slice(0,split),final=result.supplementSql.slice(split);
 assert.equal(result.sql.slice(0,result.insertBeforeFirstAcl)+result.sql.slice(result.insertBeforeFirstAcl+insertion.length,-final.length),syntheticAttendanceExtensionDump);
 assert(result.sql.indexOf('alter extension pg_graphql add function')<result.sql.indexOf('GRANT ALL ON FUNCTION graphql_public.graphql'));
 assert(result.sql.includes('alter function graphql_public.graphql(text,text,jsonb,jsonb) owner to supabase_admin;'));
 assert(result.sql.includes('attendance_extension_full_metadata_mismatch'));
 assert(result.sql.includes('set local search_path=pg_catalog,public;\ndo $attendance_extension_full_metadata$'));
 assert(!/create role|grant .* to postgres|reassign owned|drop |truncate |create database/i.test(result.supplementSql));
 assert.deepEqual(result.operations.map(x=>x.operation),['create-missing-member','actual-attributes-only','actual-attributes-only']);
});
test('named or types-only complete ACLs work; duplicate/missing/unknown roles and preexisting wrapper fail closed',()=>{
 const snapshot=syntheticAttendanceExtensionMetadata();
 const types=syntheticAttendanceExtensionDump.replaceAll('"operationName" text, query text, variables jsonb, extensions jsonb','text, text, jsonb, jsonb');
 assert(attendanceExtensionMetadataSupplement(types,snapshot));
 for(const dump of [
  syntheticAttendanceExtensionDump.replace('TO anon;','TO unknown_role;'),
  syntheticAttendanceExtensionDump.replace('TO anon;','TO postgres;'),
  syntheticAttendanceExtensionDump.replace('TO anon;','TO "a""non";'),
  syntheticAttendanceExtensionDump.replace('GRANT ALL ON FUNCTION','GRANT EXECUTE ON FUNCTION'),
  syntheticAttendanceExtensionDump.replace('CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;',''),
  syntheticAttendanceExtensionDump.replace('CREATE EXTENSION IF NOT EXISTS pg_graphql WITH SCHEMA graphql;','CREATE EXTENSION IF NOT EXISTS pg_graphql WITH SCHEMA public;'),
  syntheticAttendanceExtensionDump+'GRANT ALL ON FUNCTION graphql_public.graphql(text, text, jsonb, jsonb) TO anon;\n',
  'CREATE FUNCTION graphql_public.graphql(text,text,jsonb,jsonb) RETURNS jsonb AS $$ SELECT NULL; $$ LANGUAGE sql;\n'+syntheticAttendanceExtensionDump,
  'REVOKE ALL ON FUNCTION graphql_public.graphql(text, text, jsonb, jsonb) FROM PUBLIC;\n'+syntheticAttendanceExtensionDump,
  'ALTER FUNCTION graphql_public.graphql(text, text, jsonb, jsonb) OWNER TO supabase_admin;\n'+syntheticAttendanceExtensionDump
 ])assert.throws(()=>attendanceExtensionMetadataSupplement(dump,snapshot),/attendance_extension_metadata_dump_/);
});
test('comments, function bodies, strings and partial multi-statements cannot supply missing ACL anchors',()=>{
 const snapshot=syntheticAttendanceExtensionMetadata(),extensions=syntheticAttendanceExtensionDump.split('GRANT ALL')[0];
 for(const falseAnchor of [
  '-- '+syntheticAttendanceExtensionGrants.replaceAll('\n','\n-- '),
  '/* outer /* nested */ '+syntheticAttendanceExtensionGrants+' */;',
  'CREATE FUNCTION public.synthetic() RETURNS text AS $private$ '+syntheticAttendanceExtensionGrants+' $private$ LANGUAGE sql;',
  "SELECT '"+syntheticAttendanceExtensionGrants+"';",
  'SELECT "'+syntheticAttendanceExtensionGrants.replaceAll('"','""')+'";',
  syntheticAttendanceExtensionGrants.replace('TO anon;','TO anon SELECT 1;')
 ])assert.throws(()=>attendanceExtensionMetadataSupplement(extensions+falseAnchor,snapshot),/attendance_extension_metadata_dump_/);
 const misleading="CREATE FUNCTION public.synthetic() RETURNS text AS $private$ GRANT ALL ON FUNCTION graphql_public.graphql(text, text, jsonb, jsonb) TO anon; $private$ LANGUAGE sql;\n";
 assert(attendanceExtensionMetadataSupplement(misleading+syntheticAttendanceExtensionDump,snapshot));
});
test('actual attribute repair never executes network functions, rewrites their bodies or broadens privileges',()=>{
 const result=attendanceExtensionMetadataSupplement(syntheticAttendanceExtensionDump,syntheticAttendanceExtensionMetadata());
 for(const signature of ['net.http_get(text,jsonb,jsonb,integer)','net.http_post(text,jsonb,jsonb,jsonb,integer)']){
  assert(result.supplementSql.includes(`alter function ${signature} security invoker;`));
  assert(result.supplementSql.includes(`alter function ${signature} set search_path=net;`));
 }
 assert(!/security definer|create (?:or replace )?function net\.|select net\.http_|grant .*net\.|grant .*graphql_public/i.test(result.supplementSql));
 assert(!result.supplementSql.includes('and p.prosecdef=false'));
 assert(result.supplementSql.includes("p.proconfig is null or p.proconfig=array['search_path=net']"));
});
test('actual metadata pins deny altered members, owner, signature, source or historical definer attributes',()=>{
 const modifications=[s=>s.pop(),s=>s[0].members.pop(),s=>s[0].routines.pop(),s=>s[0].version='1.5.12',s=>s[0].owner='postgres',s=>s[0].members[0].catalog='pg_unknown',s=>s[0].routines[0].memberIdentity='other',
  s=>s[0].routines[0].definition+='SELECT 1;',s=>s[0].routines[0].securityDefiner=true,s=>s[0].routines[0].config=['search_path=public'],s=>s[0].routines[0].bodySha256='0'.repeat(64),
  s=>s[1].routines[0].securityDefiner=true,s=>s[1].routines[0].config=null,s=>s[1].routines[1].bodySha256='0'.repeat(64)];
 for(const modify of modifications){const snapshot=syntheticAttendanceExtensionMetadata();modify(snapshot);assert.throws(()=>validateAttendanceExtensionMetadata(snapshot),/^Error: attendance_extension_metadata_/);}
});
test('all five sequence int8 fields are exported as exact text, never JSON numbers',()=>{
 const sql=attendanceExtensionMetadataSnapshotSql();
 for(const field of ['seqstart','seqincrement','seqmax','seqmin','seqcache'])assert.match(sql,new RegExp(`\\bq\\.${field}\\s*::\\s*text\\b`),field);
 assert(sql.includes('q.seqtypid::regtype::text'));assert(sql.includes('q.seqcycle'));
});
test('sequence signed int64 extremes survive JSON roundtrip and final guard hex without changing raw dump',()=>{
 const sequence=['bigint','0','-9007199254740993','9223372036854775807','-9223372036854775808','9007199254740993',false];
 const snapshot=sequenceMetadata(sequence),roundtrip=JSON.parse(JSON.stringify(snapshot));
 assert.deepEqual(roundtrip,snapshot);validateAttendanceExtensionMetadata(roundtrip);
 const result=attendanceExtensionMetadataSupplement(syntheticAttendanceExtensionDump,roundtrip);
 const encoded=result.supplementSql.match(/convert_from\(decode\('([a-f0-9]+)','hex'\),'UTF8'\)::jsonb/);
 assert(encoded);const text=Buffer.from(encoded[1],'hex').toString('utf8'),expected=JSON.parse(text);
 assert.deepEqual(expected,snapshot);
 assert.deepEqual(expected.find(e=>e.name==='pg_net').members.find(m=>m.catalog==='pg_class').metadata.sequence,sequence);
 assert(text.includes('"9223372036854775807"'));assert(text.includes('"-9223372036854775808"'));assert(!text.includes('9223372036854776000'));
 const boundary=result.supplementSql.indexOf('\n-- Compare every actual extension member'),insertion=result.supplementSql.slice(0,boundary),final=result.supplementSql.slice(boundary);
 assert.equal(result.sql.slice(0,result.insertBeforeFirstAcl)+result.sql.slice(result.insertBeforeFirstAcl+insertion.length,-final.length),syntheticAttendanceExtensionDump);
 assert.equal(result.sourceSha256,sha(syntheticAttendanceExtensionDump));assert.equal(result.snapshotSha256,sha(JSON.stringify(snapshot)));
});
test('sequence metadata retains canonical signed text including zero and supported type/cycle shape',()=>{
 for(const [type,max,min] of [['smallint','32767','-32768'],['integer','2147483647','-2147483648'],['bigint','9223372036854775807','-9223372036854775808']]){
  validateAttendanceExtensionMetadata(sequenceMetadata([type,'0','1',max,min,'1',false]));
  validateAttendanceExtensionMetadata(sequenceMetadata([type,'-1','-1',max,min,'1',true]));
 }
 for(const value of ['0','1','-1','9007199254740991','9007199254740992','9007199254740993','-9007199254740993','9223372036854775807','-9223372036854775808']){
  const snapshot=sequenceMetadata(['bigint',value,'1','9223372036854775807','-9223372036854775808','1',false]);
  validateAttendanceExtensionMetadata(snapshot);assert.deepEqual(JSON.parse(JSON.stringify(snapshot)),snapshot);
 }
});
test('sequence metadata rejects rounded/safe numeric values, noncanonical and out-of-int64 text in every position',()=>{
 const valid=['bigint','0','1','9223372036854775807','-9223372036854775808','1',false];
 const invalid=['','+1','-0','00','01','-01',' 1','1 ','1\n','1.0','1e3','NaN','Infinity','9223372036854775808','-9223372036854775809',0,-1,Number('9223372036854775807'),null];
 for(let position=1;position<=5;position++)for(const value of invalid){const sequence=[...valid];sequence[position]=value;assert.throws(()=>validateAttendanceExtensionMetadata(sequenceMetadata(sequence)),/^Error: attendance_extension_metadata_/);}
 for(const sequence of [valid.slice(0,6),[...valid,'extra'],{...valid},['BIGINT',...valid.slice(1)],['text',...valid.slice(1)],[...valid.slice(0,6),'false'],[...valid.slice(0,6),0]])assert.throws(()=>validateAttendanceExtensionMetadata(sequenceMetadata(sequence)),/^Error: attendance_extension_metadata_/);
});
test('unsafe numeric integers elsewhere in the complete extension snapshot are rejected recursively',()=>{
 for(const inject of [
  s=>s[0].routines[0].cost=Number('9007199254740993'),
  s=>s[0].members[0].metadata={nested:[{value:Number('-9007199254740993')}]},
  s=>s[0].configuration=[{nested:{value:Number('9223372036854775807')}}]
 ]){const snapshot=sequenceMetadata(['bigint','0','1','9223372036854775807','-9223372036854775808','1',false]);inject(snapshot);assert.throws(()=>validateAttendanceExtensionMetadata(snapshot),/^Error: attendance_extension_metadata_/);}
});
test('default and explicit-false supplements preserve the previously sealed byte contract',()=>{
 const snapshot=syntheticAttendanceExtensionMetadata(),result=attendanceExtensionMetadataSupplement(syntheticAttendanceExtensionDump,snapshot);
 assert.deepEqual(attendanceExtensionMetadataSupplement(syntheticAttendanceExtensionDump,snapshot,{restoreGraphqlInitialAcl:false}),result);
 assert.equal(sha(result.sql),'7bb36ff4dca35704ef89a4f9b2049608fc5268f645c7c76bfd55d26a09e560cb');
 assert.equal(sha(result.supplementSql),'c1d4f7714efdae7e76eccb25798ccee143e73cc86d45ec3f90975432968d32fc');
 assert.equal(sha(JSON.stringify(result.operations)),'2853210ee2bdca914a95d32ffbd5b37d7358690b42705d406fc0d5c70c0f617d');
 assert(!result.sql.includes('attendance_extension_graphql_initial_acl'));
 for(const options of [null,true,[],{restoreGraphqlInitialAcl:'true'},{restoreGraphqlInitialAcl:1},{restoreGraphqlInitialAcl:true,skipGuard:true}])assert.throws(()=>attendanceExtensionMetadataSupplement(syntheticAttendanceExtensionDump,snapshot,options),/attendance_extension_metadata_options/);
 assert.deepEqual(attendanceExtensionMetadataSupplement(syntheticAttendanceExtensionDump,snapshot,Object.create({restoreGraphqlInitialAcl:true})),result);
 assert.throws(()=>attendanceExtensionMetadataSupplement(syntheticAttendanceExtensionDump,snapshot,{[Symbol('restoreGraphqlInitialAcl')]:true}),/attendance_extension_metadata_options/);
});
test('new explicit ACL supplement restores exactly seven identities after the dump and before unchanged full guard',()=>{
 const snapshot=syntheticAttendanceGraphqlInitialAclMetadata(),legacy=attendanceExtensionMetadataSupplement(syntheticAttendanceExtensionDump,snapshot);
 const result=attendanceExtensionMetadataSupplement(syntheticAttendanceExtensionDump,snapshot,{restoreGraphqlInitialAcl:true});
 const start=result.sql.indexOf('\n-- Seven actual pg_graphql initial ACLs'),end=result.sql.indexOf('\n-- Compare every actual extension member',start);
 assert(start>result.sql.indexOf('GRANT ALL ON FUNCTION graphql_public.graphql')&&end>start);
 const acl=result.sql.slice(start,end);assert.equal(result.sql.slice(0,start)+result.sql.slice(end),legacy.sql);
 const supplementalStart=result.supplementSql.indexOf('\n-- Seven actual pg_graphql initial ACLs'),supplementalEnd=result.supplementSql.indexOf('\n-- Compare every actual extension member',supplementalStart);
 assert.equal(result.supplementSql.slice(0,supplementalStart)+result.supplementSql.slice(supplementalEnd),legacy.supplementSql);
 assert.equal(result.sql.slice(end),legacy.sql.slice(legacy.sql.indexOf('\n-- Compare every actual extension member')));
 assert.equal(result.sourceSha256,sha(syntheticAttendanceExtensionDump));assert.equal(result.snapshotSha256,legacy.snapshotSha256);
 assert.deepEqual(result.operations.slice(0,3),legacy.operations);assert.equal(result.operations.length,10);
 assert.deepEqual(result.operations.slice(3).map(x=>x.signature),['graphql.seq_schema_version','graphql._internal_resolve(text,jsonb,text,jsonb)','graphql.comment_directive(text)','graphql.exception(text)','graphql.get_schema_version()','graphql.increment_schema_version()','graphql.resolve(text,jsonb,text,jsonb)']);
 assert.equal((acl.match(/grant SELECT, UPDATE, USAGE on sequence graphql\.seq_schema_version to /g)||[]).length,4);
 assert.equal((acl.match(/grant EXECUTE on function graphql\./g)||[]).length,24);
 const grants=acl.split('\n').filter(line=>/^\s+grant /.test(line));assert.equal(grants.length,29);
 const ownerGrant=grants.filter(line=>line.endsWith(' to supabase_admin granted by supabase_admin;'));
 assert.deepEqual(ownerGrant,['  grant SELECT, UPDATE on sequence graphql.seq_schema_version to supabase_admin granted by supabase_admin;']);
 for(const line of grants.filter(line=>!ownerGrant.includes(line)))assert.match(line,/ to (anon|authenticated|postgres|service_role) granted by supabase_admin;$/);
 assert(!/^\s*(?:revoke\b|set(?: local)? role\b|create\b|alter\b|drop\b|execute\b)/mi.test(acl));
 assert(!/with grant option|grant all|select graphql\./i.test(acl));
});
test('seven ACL targets require exact extension membership, complete non-ACL metadata and known missing-or-full prestate',()=>{
 const snapshot=syntheticAttendanceGraphqlInitialAclMetadata(),result=attendanceExtensionMetadataSupplement(syntheticAttendanceExtensionDump,snapshot,{restoreGraphqlInitialAcl:true});
 const start=result.supplementSql.indexOf('\n-- Seven actual pg_graphql initial ACLs'),end=result.supplementSql.indexOf('\n-- Compare every actual extension member',start),acl=result.supplementSql.slice(start,end);
 assert(acl.includes("current_database()<>'faolla_attendance_compat_a535a308e21f'"));assert(acl.includes("current_user<>'supabase_admin' or session_user<>'supabase_admin'"));
 assert(acl.includes("e.extversion='1.5.11'"));assert(acl.includes('set local search_path=pg_catalog,public;'));
 assert.equal((acl.match(/d\.objsubid=0/g)||[]).length,7);assert.equal((acl.match(/d\.refobjsubid=0/g)||[]).length,7);
 assert.equal((acl.match(/select x\.value into strict actual_object/g)||[]).length,7);
 assert.equal((acl.match(/attendance_extension_graphql_acl_nonacl_changed/g)||[]).length,7);
 assert.equal((acl.match(/attendance_extension_graphql_acl_prestate/g)||[]).length,7);
 assert.equal((acl.match(/if actual_acl=convert_from/g)||[]).length,7);
 for(const operation of result.operations.slice(3)){
  assert.equal(operation.extension,'pg_graphql');assert.equal(operation.version,'1.5.11');assert.equal(operation.grantor,'supabase_admin');assert.equal(operation.operation,'restore-actual-initial-acl');
  assert.deepEqual(operation.missingGrantees,['anon','authenticated','postgres','service_role']);assert(operation.expectedAcl.every(a=>a.grantor==='supabase_admin'&&a.grantable===false));
  if(operation.catalog==='pg_class')assert.deepEqual(operation.missingOwnerPrivileges,['SELECT','UPDATE']);else assert(!Object.hasOwn(operation,'missingOwnerPrivileges'));
 }
 const encoded=[...acl.matchAll(/convert_from\(decode\('([a-f0-9]+)','hex'\),'UTF8'\)::jsonb/g)].map(m=>JSON.parse(Buffer.from(m[1],'hex').toString('utf8')));
 const arrays=encoded.filter(Array.isArray);assert(arrays.some(a=>a.length===1&&a[0].grantee==='supabase_admin'&&a[0].grantor==='supabase_admin'&&a[0].privilege==='USAGE'&&a[0].grantable===false));
 assert(!arrays.some(a=>a.length===3&&a.every(x=>x.grantee==='supabase_admin')));
 assert(arrays.some(a=>a.length===2&&a.some(x=>x.grantee==='PUBLIC')&&a.some(x=>x.grantee==='supabase_admin')));
 assert(arrays.some(a=>a.length===15));assert(arrays.some(a=>a.length===6));
});
test('authorized initial ACL repair rejects any changed expected identity, grantor, role, option or partial ACL',()=>{
 const sequence=s=>s[0].members.find(m=>m.identity==='graphql.seq_schema_version'),routine=s=>s[0].routines.find(r=>r.signature==='graphql.get_schema_version()');
 const modifications=[
  s=>sequence(s).identity='graphql.other_sequence',s=>sequence(s).type='table',s=>sequence(s).metadata.kind='r',s=>sequence(s).metadata.owner='postgres',
  s=>sequence(s).metadata.acl.push({...sequence(s).metadata.acl[0]}),s=>sequence(s).metadata.acl[0].grantor='postgres',s=>sequence(s).metadata.acl[0].grantee='PUBLIC',s=>sequence(s).metadata.acl[0].grantable=true,s=>sequence(s).metadata.acl[0].privilege='EXECUTE',s=>sequence(s).metadata.acl.pop(),s=>sequence(s).metadata.acl[0].extra=true,
  s=>routine(s).signature='graphql.other()',s=>routine(s).kind='p',s=>routine(s).acl[0].grantor='postgres',s=>routine(s).acl[0].grantee='unknown',s=>routine(s).acl[0].grantable=true,s=>routine(s).acl[0].privilege='SELECT',s=>routine(s).acl.pop(),s=>routine(s).acl.push({...routine(s).acl[0]})
 ];
 for(const modify of modifications){const snapshot=syntheticAttendanceGraphqlInitialAclMetadata();modify(snapshot);assert.throws(()=>attendanceExtensionMetadataSupplement(syntheticAttendanceExtensionDump,snapshot,{restoreGraphqlInitialAcl:true}),/^Error: attendance_extension_(?:metadata|graphql_acl)_/);}
 assert.throws(()=>attendanceExtensionMetadataSupplement(syntheticAttendanceExtensionDump,syntheticAttendanceExtensionMetadata(),{restoreGraphqlInitialAcl:true}),/attendance_extension_graphql_acl_/);
});
test('separate schema sampler reads only the two actual namespace and initial ACLs without changing the old extension sampler',()=>{
 const sql=attendanceGraphqlInitialSchemaAclSnapshotSql();
 assert(sql.startsWith('-- attendance_compatibility_graphql_initial_schema_acl\nbegin read only;'));
 assert(sql.includes(attendanceGraphqlInitialSchemaAclSnapshotExpression()));
 assert(sql.includes("i.classoid='pg_namespace'::regclass and i.objoid=n.oid and i.objsubid=0"));
 assert(sql.includes("n.nspname in ('graphql','graphql_public')"));
 for(const field of ['nspowner','nspacl','pg_init_privs','initprivs','initialPrivilegeType','i.privtype','aclexplode','set local search_path=pg_catalog,public'])assert(sql.includes(field),field);
 assert(!/create\s|alter\s|grant\s|revoke\s|drop\s|auth\.users|pg_authid|pg_auth_members|last_value|password/i.test(sql));
 assert(!attendanceExtensionMetadataSnapshotSql().includes('pg_init_privs'));
 assert(!attendanceExtensionMetadataSnapshotSql().includes('initialPrivilegeType'));
});
test('schema restoration is an independent strict boolean and preserves every old default/false and seven-object output byte',()=>{
 for(const snapshot of [syntheticAttendanceExtensionMetadata(),syntheticAttendanceGraphqlInitialAclMetadata()]){
  const oldOptions=snapshot[0].members.some(m=>m.identity==='graphql.seq_schema_version')?{restoreGraphqlInitialAcl:true}:{};
  const result=attendanceExtensionMetadataSupplement(syntheticAttendanceExtensionDump,snapshot,oldOptions);
  assert.deepEqual(attendanceExtensionMetadataSupplement(syntheticAttendanceExtensionDump,snapshot,{...oldOptions,restoreGraphqlInitialSchemaAcl:false}),result);
  assert(!Object.hasOwn(result,'schemaSnapshotSha256'));
  assert(!result.sql.includes('attendance_extension_graphql_initial_schema_acl'));
  if(oldOptions.restoreGraphqlInitialAcl){
   assert.equal(sha(result.sql),'397e21eb1458175f870bd60df3c6ba3b3b45ab3ed8b8a0e1b54172a2020154d0');
   assert.equal(sha(result.supplementSql),'9bf0b2c20222a1d69cb5ae535088ef1559df722d6743d2e1c40b583709316a50');
   assert.equal(sha(JSON.stringify(result.operations)),'bf93e3b68971f275c061ca9c4110a2fc471aaea500b5dd80dff40bd5962db032');
  }
 }
 const snapshot=syntheticAttendanceExtensionMetadata(),schema=syntheticAttendanceGraphqlInitialSchemaAclMetadata();
 for(const options of [{restoreGraphqlInitialSchemaAcl:1},{restoreGraphqlInitialSchemaAcl:'true'},{restoreGraphqlInitialSchemaAcl:null},{restoreGraphqlInitialSchemaAcl:true,skipGuard:true},{[Symbol('restoreGraphqlInitialSchemaAcl')]:true}])assert.throws(()=>attendanceExtensionMetadataSupplement(syntheticAttendanceExtensionDump,snapshot,options,schema),/attendance_extension_metadata_options/);
 for(const options of [{},{restoreGraphqlInitialSchemaAcl:false},Object.create({restoreGraphqlInitialSchemaAcl:true})]){
  for(const hiddenInput of [schema,null,[],{}])assert.throws(()=>attendanceExtensionMetadataSupplement(syntheticAttendanceExtensionDump,snapshot,options,hiddenInput),/attendance_extension_metadata_options/);
 }
 assert.throws(()=>attendanceExtensionMetadataSupplement(syntheticAttendanceExtensionDump,snapshot,{restoreGraphqlInitialSchemaAcl:true}),/attendance_extension_graphql_schema_acl_snapshot/);
});
test('two schema source ACLs exactly preserve owner CREATE/USAGE and the sole postgres grant option',()=>{
 const snapshot=syntheticAttendanceGraphqlInitialSchemaAclMetadata(),validated=validateAttendanceGraphqlInitialSchemaAclSnapshot(snapshot);
 assert.deepEqual(validated.snapshot,snapshot);assert.equal(validated.snapshotSha256,sha(JSON.stringify(snapshot)));
 assert.deepEqual(snapshot.map(s=>s.name),['graphql','graphql_public']);
 for(const schema of snapshot){
  assert.equal(schema.owner,'supabase_admin');assert.equal(schema.initialPrivilegeType,'e');assert.deepEqual(schema.acl,schema.initialAcl);assert.equal(schema.acl.length,6);
  assert.deepEqual(schema.acl.filter(a=>a.grantee==='supabase_admin').map(a=>[a.privilege,a.grantable]),[['CREATE',false],['USAGE',false]]);
  assert.deepEqual(schema.acl.filter(a=>a.grantable),[{grantor:'supabase_admin',grantee:'postgres',privilege:'USAGE',grantable:true}]);
 }
});
test('new two-schema supplement emits exactly eight fixed grants and leaves raw dump/old seven/full guard bytes intact',()=>{
 const snapshot=syntheticAttendanceGraphqlInitialAclMetadata(),schema=syntheticAttendanceGraphqlInitialSchemaAclMetadata();
 const legacy=attendanceExtensionMetadataSupplement(syntheticAttendanceExtensionDump,snapshot,{restoreGraphqlInitialAcl:true});
 const result=attendanceExtensionMetadataSupplement(syntheticAttendanceExtensionDump,snapshot,{restoreGraphqlInitialAcl:true,restoreGraphqlInitialSchemaAcl:true},schema);
 const start=result.sql.indexOf('\n-- Two actual GraphQL initial schema ACLs'),end=result.sql.indexOf('\n-- Compare every actual extension member',start),sql=result.sql.slice(start,end);
 assert(start>result.sql.indexOf('$attendance_extension_graphql_initial_acl$;')&&end>start);
 assert.equal(result.sql.slice(0,start)+result.sql.slice(end),legacy.sql);
 const s=result.supplementSql.indexOf('\n-- Two actual GraphQL initial schema ACLs'),e=result.supplementSql.indexOf('\n-- Compare every actual extension member',s);
 assert.equal(result.supplementSql.slice(0,s)+result.supplementSql.slice(e),legacy.supplementSql);
 assert.equal(result.sourceSha256,legacy.sourceSha256);assert.equal(result.snapshotSha256,legacy.snapshotSha256);assert.equal(result.schemaSnapshotSha256,sha(JSON.stringify(schema)));
 assert.deepEqual(result.operations.slice(0,10),legacy.operations);assert.equal(result.operations.length,12);
 const grants=sql.split('\n').filter(line=>/^\s+grant /.test(line));
 assert.deepEqual(grants,['graphql','graphql_public'].flatMap(name=>[
  ...['anon','authenticated','service_role'].map(role=>`  grant USAGE on schema ${name} to ${role} granted by supabase_admin;`),
  `  grant USAGE on schema ${name} to postgres with grant option granted by supabase_admin;`
 ]));
 assert.equal(grants.length,8);assert.equal(grants.filter(line=>line.includes('with grant option')).length,2);
 assert(!/^\s*(?:revoke\b|set(?: local)? role\b|create\b|alter\b|drop\b|execute\b)/mi.test(sql));
 assert(!/grant all|grant CREATE|on (?:function|sequence|table)|pg_authid|pg_auth_members|update pg_/i.test(sql));
 for(const operation of result.operations.slice(10)){
  assert.equal(operation.catalog,'pg_namespace');assert.equal(operation.operation,'restore-actual-initial-schema-acl');assert.equal(operation.grantor,'supabase_admin');
  assert.deepEqual(operation.privileges,['USAGE']);assert.deepEqual(operation.grantOptionGrantees,['postgres']);assert.equal(operation.expectedAcl.length,6);
 }
 const independentlySelected=attendanceExtensionMetadataSupplement(syntheticAttendanceExtensionDump,syntheticAttendanceExtensionMetadata(),{restoreGraphqlInitialSchemaAcl:true},schema);
 assert.equal(independentlySelected.operations.length,5);assert(!independentlySelected.sql.includes('do $attendance_extension_graphql_initial_acl$'));
});
test('schema SQL checks BOTH complete prestates before any grant, then full exact poststate in the unique isolated clone',()=>{
 const schema=syntheticAttendanceGraphqlInitialSchemaAclMetadata(),result=attendanceExtensionMetadataSupplement(syntheticAttendanceExtensionDump,syntheticAttendanceExtensionMetadata(),{restoreGraphqlInitialSchemaAcl:true},schema);
 const start=result.supplementSql.indexOf('\n-- Two actual GraphQL initial schema ACLs'),end=result.supplementSql.indexOf('\n-- Compare every actual extension member',start),sql=result.supplementSql.slice(start,end);
 assert(sql.includes("current_database()<>'faolla_attendance_compat_a535a308e21f'"));assert(sql.includes("current_user<>'supabase_admin' or session_user<>'supabase_admin'"));
 assert(sql.includes("e.extname='pg_graphql' and e.extversion='1.5.11'"));assert(sql.includes("pg_get_userbyid(e.extowner)='supabase_admin'"));
 const firstGrant=sql.indexOf('  grant '),lastPrestate=sql.lastIndexOf("then raise exception 'attendance_extension_graphql_schema_acl_prestate';end if;");
 assert(firstGrant>lastPrestate);assert.equal((sql.match(/select x\.value into strict actual_object/g)||[]).length,2);
 assert.equal((sql.match(/attendance_extension_graphql_schema_acl_owner/g)||[]).length,2);
 assert.equal((sql.match(/actual_acl is distinct from/g)||[]).length,4);
 assert(sql.indexOf("raise exception 'attendance_extension_graphql_schema_acl_poststate'")>sql.lastIndexOf('  grant '));
 const encoded=[...sql.matchAll(/convert_from\(decode\('([a-f0-9]+)','hex'\),'UTF8'\)::jsonb/g)].map(m=>JSON.parse(Buffer.from(m[1],'hex').toString('utf8')));
 const base=schema[0].acl.filter(a=>a.grantee==='supabase_admin'),full=schema[0].acl;
 assert(encoded.filter(value=>JSON.stringify(value)===JSON.stringify(base)).length>=4);
 assert.equal(encoded.filter(value=>JSON.stringify(value)===JSON.stringify(full)).length,2);
 assert.deepEqual(encoded.at(-1),schema.map(s=>({name:s.name,owner:s.owner,acl:s.acl})));
 assert(!sql.includes('initialAcl'));assert(!sql.includes('pg_init_privs'));
});
test('schema source validation denies unknown identities, roles, grantors, permissions and every partial or widened ACL',()=>{
 const modifications=[
  s=>s.pop(),s=>s.push(structuredClone(s[0])),s=>s.reverse(),s=>s[0].name='public',s=>s[1].name='graphql',s=>s[0].owner='postgres',
  s=>s[0].initialPrivilegeType='i',s=>s[0].initialPrivilegeType=null,s=>delete s[0].initialAcl,s=>s[0].extra=true,s=>s[0][Symbol('hidden')]=true,
  s=>s[0].acl.pop(),s=>s[0].initialAcl.pop(),s=>s[0].acl.push({...s[0].acl[0]}),s=>s[0].acl[0].grantee='PUBLIC',s=>s[0].acl[0].grantee='unknown',
  s=>s[0].acl[0].grantor='postgres',s=>s[0].acl[0].privilege='CREATE',s=>s[0].acl[0].grantable=true,s=>s[0].acl.find(a=>a.grantee==='postgres').grantable=false,
  s=>s[0].acl.find(a=>a.grantee==='supabase_admin').grantable=true,s=>s[0].acl[0].extra=true,s=>s[0].acl[0][Symbol('hidden')]=true,
  s=>s[0].initialAcl[0].grantee='service_role',s=>s[0].initialAcl.find(a=>a.grantee==='postgres').grantable=false
 ];
 for(const invalid of [null,1,'abcd',[],{},['supabase_admin','anon','USAGE',false]])modifications.push(s=>s[0].acl[0]=invalid);
 for(const modify of modifications){const schema=syntheticAttendanceGraphqlInitialSchemaAclMetadata();modify(schema);
  assert.throws(()=>validateAttendanceGraphqlInitialSchemaAclSnapshot(schema),/^Error: attendance_extension_graphql_schema_acl_/);
  assert.throws(()=>attendanceExtensionMetadataSupplement(syntheticAttendanceExtensionDump,syntheticAttendanceExtensionMetadata(),{restoreGraphqlInitialSchemaAcl:true},schema),/^Error: attendance_extension_graphql_schema_acl_/);
 }
 for(const schema of [null,undefined,{},[]])assert.throws(()=>validateAttendanceGraphqlInitialSchemaAclSnapshot(schema),/attendance_extension_graphql_schema_acl_snapshot/);
});
