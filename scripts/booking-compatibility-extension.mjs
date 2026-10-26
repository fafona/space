// Independent adapter for ONE fresh booking metadata clone. The attendance
// supplement and its attendance-only ACL identity are deliberately unchanged.
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {attendanceExtensionMetadataSupplement,attendanceExtensionMetadataSnapshotExpression,
 attendanceGraphqlInitialSchemaAclSnapshotExpression,validateAttendanceGraphqlInitialSchemaAclSnapshot} from './attendance-extension-metadata.mjs';
export const BOOKING_COMPATIBILITY_CLONE='faolla_booking_compat_b274ad615550';
export const BOOKING_COMPATIBILITY_PILOT_SYSTEM='7694613959029145639';
const need=(v,c)=>{if(!v)throw Error('booking_compatibility_extension_'+c);};
const hash=x=>createHash('sha256').update(x).digest('hex');
const text=x=>`convert_from(decode('${Buffer.from(JSON.stringify(x)).toString('hex')}','hex'),'UTF8')::jsonb`;
const roles=['anon','authenticated','postgres','service_role'];
const functions=['graphql._internal_resolve(text,jsonb,text,jsonb)','graphql.comment_directive(text)','graphql.exception(text)',
 'graphql.get_schema_version()','graphql.increment_schema_version()','graphql.resolve(text,jsonb,text,jsonb)'];
const canonical=entries=>{
 need(Array.isArray(entries)&&entries.every(a=>a&&Object.keys(a).sort().join(',')==='grantable,grantee,grantor,privilege'),'acl_shape');
 return entries.map(a=>[a.grantor,a.grantee,a.privilege,a.grantable]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b),'en'));
};
const expected=(grantees,privileges)=>grantees.flatMap(grantee=>privileges.map(privilege=>({grantor:'supabase_admin',grantee,privilege,grantable:false})));
export function bookingCompatibilityExtensionSupplement(dump,snapshot,schemaSnapshot){
 // Default shared wrapper/net handling only: NEVER select the old ACL options.
 const base=attendanceExtensionMetadataSupplement(dump,snapshot);
 validateAttendanceGraphqlInitialSchemaAclSnapshot(schemaSnapshot);
 const extension=snapshot.find(e=>e.name==='pg_graphql');
 need(extension?.version==='1.5.11'&&extension.schema==='graphql'&&extension.owner==='supabase_admin','extension');
 const seq=extension.members.filter(m=>m.catalog==='pg_class'&&m.identity==='graphql.seq_schema_version');
 need(seq.length===1&&seq[0].type==='sequence'&&seq[0].metadata?.kind==='S'&&seq[0].metadata.owner==='supabase_admin','sequence');
 const targets=[{signature:'graphql.seq_schema_version',catalog:'pg_class',kind:'sequence',object:seq[0],acl:seq[0].metadata.acl,
  full:expected([...roles,'supabase_admin'],['SELECT','UPDATE','USAGE']),privileges:['SELECT','UPDATE','USAGE']}];
 for(const signature of functions){
  const found=extension.routines.filter(r=>r.signature===signature);
  need(found.length===1&&found[0].kind==='f'&&found[0].owner==='supabase_admin'&&
   extension.members.filter(m=>m.catalog==='pg_proc'&&m.identity===found[0].memberIdentity).length===1,'function');
  targets.push({signature,catalog:'pg_proc',kind:'function',object:found[0],acl:found[0].acl,
   full:expected(['PUBLIC',...roles,'supabase_admin'],['EXECUTE']),privileges:['EXECUTE']});
 }
 for(const schema of schemaSnapshot)targets.push({signature:schema.name,catalog:'pg_namespace',kind:'schema',
  object:{name:schema.name,owner:schema.owner,acl:schema.acl},acl:schema.acl,full:schema.acl,privileges:['USAGE']});
 let sql=`\n-- Booking-only exact initial ACL adaptation; all nine targets checked BEFORE any GRANT.\nset local search_path=pg_catalog,public;\ndo $booking_extension_acl$\ndeclare actual_extensions jsonb;actual_schemas jsonb;actual_object jsonb;actual_acl jsonb;\nbegin\n if current_database()<>'${BOOKING_COMPATIBILITY_CLONE}' or current_user<>'supabase_admin' or session_user<>'supabase_admin' or current_setting('server_version_num')<>'150008' or (select system_identifier::text from pg_control_system())<>'${BOOKING_COMPATIBILITY_PILOT_SYSTEM}' then raise exception 'booking_extension_clone_identity';end if;\n actual_extensions:=${attendanceExtensionMetadataSnapshotExpression()};\n select jsonb_agg(jsonb_build_object('name',s->'name','owner',s->'owner','acl',s->'acl') order by s->>'name') into actual_schemas from jsonb_array_elements(${attendanceGraphqlInitialSchemaAclSnapshotExpression()}) s;\n if jsonb_array_length(actual_schemas)<>2 then raise exception 'booking_extension_schema_count';end if;\n`;
 const checks=[],grants=[],operations=[];
 for(const target of targets){
  need(isDeepStrictEqual(canonical(target.acl),canonical(target.full)),'expected_acl');
  const sequence=target.kind==='sequence',schema=target.kind==='schema';
  const actual=schema?`(select x from jsonb_array_elements(actual_schemas) x where x->>'name'='${target.signature}')`:
   `(select x from jsonb_array_elements(actual_extensions) e cross join lateral jsonb_array_elements(e->'${sequence?'members':'routines'}') x where e->>'name'='pg_graphql' and ${sequence?"x->>'catalog'='pg_class' and x->>'identity'":"x->>'signature'"}='${target.signature}')`;
  const baseAcl=target.acl.filter(a=>sequence?a.grantee==='supabase_admin'&&a.privilege==='USAGE':schema?a.grantee==='supabase_admin':a.grantee==='supabase_admin'||a.grantee==='PUBLIC');
  if(!schema){const lookup=`${sequence?'to_regclass':'to_regprocedure'}('${target.signature}')`;
   checks.push(` if (select count(*) from pg_depend d join pg_extension e on e.oid=d.refobjid where d.classid='${target.catalog}'::regclass and d.objid=${lookup} and d.objsubid=0 and d.refclassid='pg_extension'::regclass and d.refobjsubid=0 and d.deptype='e' and e.extname='pg_graphql' and e.extversion='1.5.11' and pg_get_userbyid(e.extowner)='supabase_admin')<>1 then raise exception 'booking_extension_member';end if;\n`);
  }
  checks.push(` actual_object:=${actual};\n if actual_object is null or ${sequence?"actual_object #- '{metadata,acl}'":"actual_object-'acl'"} is distinct from (${text(target.object)} ${sequence?"#- '{metadata,acl}'":"-'acl'"}) then raise exception 'booking_extension_nonacl_changed';end if;\n actual_acl:=actual_object${sequence?"#>'{metadata,acl}'":"->'acl'"};\n if actual_acl is distinct from ${text(baseAcl)} and actual_acl is distinct from ${text(target.acl)} then raise exception 'booking_extension_acl_prestate';end if;\n`);
  let grant=` if ${actual}${sequence?"#>'{metadata,acl}'":"->'acl'"}=${text(baseAcl)} then\n`;
  if(sequence)grant+=`  grant SELECT, UPDATE on sequence ${target.signature} to supabase_admin granted by supabase_admin;\n`;
  for(const role of roles)grant+=`  grant ${target.privileges.join(', ')} on ${target.kind} ${target.signature} to ${role}${schema&&role==='postgres'?' with grant option':''} granted by supabase_admin;\n`;
  grants.push(grant+' end if;\n');
  operations.push({catalog:target.catalog,signature:target.signature,operation:'booking-clone-restore-actual-initial-acl',expectedAcl:target.acl});
 }
 sql+=checks.join('')+grants.join('');
 const schemas=schemaSnapshot.map(s=>({name:s.name,owner:s.owner,acl:s.acl}));
 sql+=` select jsonb_agg(jsonb_build_object('name',s->'name','owner',s->'owner','acl',s->'acl') order by s->>'name') into actual_schemas from jsonb_array_elements(${attendanceGraphqlInitialSchemaAclSnapshotExpression()}) s;\n if actual_schemas is distinct from ${text(schemas)} then raise exception 'booking_extension_schema_poststate';end if;\nend;\n$booking_extension_acl$;\n`;
 const anchor='\n-- Compare every actual extension member and routine before metadata COMMIT.\n';
 const offset=base.supplementSql.indexOf(anchor);need(offset>0&&offset===base.supplementSql.lastIndexOf(anchor),'final_guard_anchor');
 const final=base.supplementSql.slice(offset);need(base.sql.endsWith(final),'final_guard_suffix');
 const insert=value=>value.slice(0,-final.length)+sql+final;
 const supplementSql=insert(base.supplementSql);
 return {...base,sql:insert(base.sql),supplementSql,supplementSha256:hash(supplementSql),schemaSnapshotSha256:hash(JSON.stringify(schemaSnapshot)),operations:[...base.operations,...operations]};
}
