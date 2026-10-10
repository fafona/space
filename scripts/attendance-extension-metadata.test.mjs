import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {attendanceExtensionMetadataPins,attendanceExtensionMetadataSnapshotSql,validateAttendanceExtensionMetadata,attendanceExtensionMetadataSupplement} from './attendance-extension-metadata.mjs';
import {syntheticAttendanceExtensionMetadata,syntheticAttendanceGraphqlInitialAclMetadata,syntheticAttendanceExtensionDump,syntheticAttendanceExtensionGrants} from './test-helpers/attendance-extension-metadata.mjs';
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
