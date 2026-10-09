// Static/small combinatorial contracts only. SQL, exact capacity and normal
// owner/self canonical equivalence remain the root-owned native acceptance.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {validateMigrationSource} from './check-supabase-migrations.mjs';

const filename='202610050153_merchant_attendance_period_session_capacity.sql';
const read=name=>readFileSync(new URL(`./supabase-migrations/${name}`,import.meta.url),'utf8').replaceAll('\r\n','\n');
const source=read(filename),clean=source.replace(/--[^\n]*/g,'');
const oldReports=read('202610010093_merchant_attendance_versioned_reports.sql');
const oldSource=read('202610050152_merchant_attendance_period_missing_context.sql');
const names=['faolla_attendance_period_report_v2','faolla_attendance_scoped_period_report_v2','faolla_attendance_period_source_v1'];
function fn(text,name){
  const matches=[...text.matchAll(new RegExp('create (?:or replace )?function public\\.'+name+'\\(','g'))];
  assert.equal(matches.length,1,name);
  const start=matches[0].index,open=text.indexOf('$$',start),end=text.indexOf('$$;',open+2);
  assert(open>start&&end>open,name);return text.slice(start,end+3);
}
const bodies=names.map(name=>fn(source,name));
const originals=names.map((name,i)=>fn(i===2?oldSource:oldReports,name));
const has=(text,...parts)=>{for(const part of parts)assert(text.includes(part),part);};
const order=(text,...parts)=>{let at=-1;for(const part of parts){const next=text.indexOf(part,at+1);assert(next>at,part);at=next;}};
const replaceOnce=(text,from,to)=>{assert.equal(text.split(from).length,2,from);return text.replace(from,()=>to);};
const countLine="    candidate_count:=candidate_count+1;if candidate_count>100 then raise exception 'attendance_report_too_large';end if;\n";
const relevance="    if not raw_relevant and not effect_relevant then continue;end if;\n";
const sourceGuard="    if expected_report_count>=100 then raise exception 'attendance_period_source_too_large';end if;\n";
const oldSourceGuard="  if cardinality(candidate_ids)>100 then raise exception 'attendance_period_source_too_large';end if;\n";

test('153 installs exactly the three approved replacements and no new helper/table/index/writer',()=>{
  assert.deepEqual(validateMigrationSource(filename,source),[]);
  assert.deepEqual([...clean.matchAll(/create or replace function public\.(\w+)/g)].map(m=>m[1]),names);
  assert.equal((clean.match(/^begin;/gm)||[]).length,1);assert.equal((clean.match(/^commit;/gm)||[]).length,1);
  assert.deepEqual([...clean.matchAll(/insert into public\.(\w+)/g)].map(m=>m[1]),['faolla_schema_migrations']);
  assert.doesNotMatch(clean,/create\s+(?:table|index|trigger)|alter\s+table|update\s+public\.|delete\s+from|truncate|drop\s+(?:function|table|index)|reindex/i);
  assert.doesNotMatch(clean,/statement_timeout|pg_advisory|lock\s+table|session_replication_role|disable trigger/i);
  has(clean,"set local lock_timeout='3s'");
});

test('exact093/103/148-152 names and153 registry collision checks precede cutover',()=>{
  for(const [version,name] of [
    ['202610010093','merchant_attendance_versioned_reports'],['202610010103','merchant_attendance_missing_revisions'],
    ['202610050148','merchant_attendance_period_source'],['202610050149','merchant_attendance_period_closure'],
    ['202610050150','merchant_attendance_period_seal_guards'],['202610050151','merchant_attendance_period_source_ranges'],
    ['202610050152','merchant_attendance_period_missing_context'],
  ])has(clean,`(${version}::bigint,'${name}')`);
  order(clean,"to_regclass('public.faolla_schema_migrations')",
    "version=202610050153 and name<>'merchant_attendance_period_session_capacity'",
    '$period_session_capacity_prerequisites$;','create or replace function',
    '$period_session_capacity_postconditions$;',"values(202610050153,'merchant_attendance_period_session_capacity')",'commit;');
  has(clean,'m.version=dependency.version and m.name=dependency.name','on conflict(version) do nothing');
});

test('all original signatures and security metadata are checked before and after replacement',()=>{
  const pre=clean.slice(0,clean.indexOf('$period_session_capacity_prerequisites$;'));
  const post=clean.slice(clean.indexOf('do $period_session_capacity_postconditions$'));
  for(const section of [pre,post]){
    for(const signature of ['public.faolla_attendance_period_report_v2(text,uuid,jsonb)',
      'public.faolla_attendance_scoped_period_report_v2(text,uuid,jsonb)','public.faolla_attendance_period_source_v1(jsonb,uuid)'])has(section,signature);
    has(section,'function_id:=to_regprocedure(spec.signature)',"p.prokind='f'","p.prorettype='jsonb'::regtype",'not p.proretset',
      'p.proargnames=spec.arg_names','p.proargmodes is null','p.pronargdefaults=0','p.pronargs=cardinality(spec.arg_names)',
      "l.lanname='plpgsql'",'p.prosecdef',"p.provolatile='v'","p.proparallel='u'","p.proconfig=array['search_path=pg_catalog']::text[]");
  }
  has(pre,"'public.merchant_attendance_effect_current_v2'","'public.faolla_attendance_effect_evidence_v2(public.merchant_attendance_effect_current_v2,timestamp with time zone)'",
    "'public.faolla_attendance_unified_report_v1(text,uuid,jsonb)'",'if to_regprocedure(signature) is null');
});

test('owner v2 is byte-identical to093 after undoing only outer probe and temporal count movement',()=>{
  let reverted=bodies[0].replace(/^create or replace function /,'create function ');
  reverted=replaceOnce(reverted,'    order by ev.sequence limit 102\n','    order by ev.sequence limit 101\n');
  reverted=replaceOnce(reverted,relevance+countLine,relevance);
  reverted=replaceOnce(reverted,"  loop\n    if e.action<>'clock_in'","  loop\n"+countLine+"    if e.action<>'clock_in'");
  assert.equal(reverted,originals[0]);
});

test('scoped v2 is byte-identical to093 after the same two bounded changes',()=>{
  let reverted=bodies[1].replace(/^create or replace function /,'create function ');
  reverted=replaceOnce(reverted,'    order by ev.sequence limit 102\n','    order by ev.sequence limit 101\n');
  reverted=replaceOnce(reverted,relevance+countLine,relevance);
  reverted=replaceOnce(reverted,"  loop\n    if e.action<>'clock_in'","  loop\n"+countLine+"    if e.action<>'clock_in'");
  assert.equal(reverted,originals[1]);
});

test('period source is byte-identical to152 after undoing only outer probe and temporal guard movement',()=>{
  let reverted=replaceOnce(bodies[2],'all_candidates order by id limit 102);','all_candidates order by id limit 101);');
  reverted=replaceOnce(reverted,sourceGuard,'');
  const end='all_candidates order by id limit 101);\n';
  reverted=replaceOnce(reverted,end,end+oldSourceGuard);
  assert.equal(reverted,originals[2]);
});

test('inside101/moved101/preceding1 and unbounded-age left anchor remain unchanged',()=>{
  for(let i=0;i<2;i++){
    const candidates=bodies[i].slice(bodies[i].indexOf('    with inside as'),bodies[i].indexOf('  loop',bodies[i].indexOf('    with inside as')));
    has(candidates,'occurred_at<from_at order by occurred_at desc,sequence desc limit 1',
      "start_at>=from_at-interval '31 days'",'select id from inside union select id from preceding union select id from moved','order by ev.sequence limit 102');
    assert.equal((candidates.match(/limit 101/g)||[]).length,2);
    assert.equal((candidates.match(/limit 102/g)||[]).length,1);
  }
  const candidates=bodies[2].slice(bodies[2].indexOf('  candidate_ids:='),bodies[2].indexOf('  for ev in'));
  has(candidates,"x.start_at>=range_from-interval '744 hours'",'x.occurred_at<range_from order by x.occurred_at desc,x.sequence desc limit 1',
    'all_candidates order by id limit 102');
  assert.equal((candidates.match(/limit 101/g)||[]).length,2);
  assert.doesNotMatch(candidates,/cardinality\(candidate_ids\)>100/);
});

test('both report caps remain after temporal relevance and before event allocation/visibility filtering',()=>{
  for(const body of bodies.slice(0,2))order(body,'raw_relevant:=','effect_relevant:=',relevance.trim(),countLine.trim(),'into events from');
  order(bodies[1],relevance.trim(),countLine.trim(),'select count(*),bool_and','if not coalesce(fully_visible,false) then continue',
    "if access='self' and eff.employee_id is distinct from viewer.id then continue");
  has(bodies[1],"(access='self' and actor_employee_id=viewer.id)","(access='manager' and location_id=target_location)",
    'if access_until is not null and clock_timestamp()>=access_until');
});

test('source counts the101st truly relevant candidate before private historical identity collection',()=>{
  order(bodies[2],'select * into endpoint','select * into eff',
    'and not(coalesce(eff.start_at<range_to and eff.end_at>range_from,false)) then continue;end if;',
    sourceGuard.trim(),'child:=public.faolla_attendance_period_session_v1(site,wid,ev.id,emp.id,emp.auth_user_id,observed)',
    'expected_report_count:=expected_report_count+1');
  has(bodies[2],"raise exception 'attendance_period_source_identity_changed'",
    "expected_report_count<>jsonb_array_length(base->'items')",'cardinality(session_ids)>100 or total_events>4000');
  const candidates=bodies[2].slice(bodies[2].indexOf('  candidate_ids:='),bodies[2].indexOf('  for ev in'));
  assert.doesNotMatch(candidates,/actor_employee_id|actor_auth_user_id|employee_auth_user_id/);
});

test('all other caps, canonical format, root100 and existingUTC interval semantics remain fixed',()=>{
  for(const body of bodies.slice(0,2))has(body,'order by sequence limit 2003','jsonb_array_length(events)>2002 or event_count>4000',
    "octet_length(result::text)>1048576","'sourceVersion','raw-and-approved-v2'","interval '31 days'");
  has(bodies[2],'total_events>4000',"cardinality(root_ids)>100",
    "octet_length(convert_to(source_text,'UTF8'))>1048576","octet_length(convert_to(result::text,'UTF8'))>4194304",
    'faolla_attendance_period_canonical_v1(result)',"'sourceVersion','attendance-period-source-v1'","interval '744 hours'");
  assert.equal(bodies[2].slice(bodies[2].indexOf('  -- Full original plan membership')),
    originals[2].slice(originals[2].indexOf('  -- Full original plan membership')));
  has(read('202610010103_merchant_attendance_missing_revisions.sql'),"row_count:=jsonb_array_length(base->'items')",
    "row_count:=row_count+1;if row_count>100 then raise exception 'attendance_report_too_large'");
});

test('probe102 cannot silently hide a101st relevant entry behind at most one irrelevant predecessor',()=>{
  const evaluate=rows=>{
    let count=0;
    for(const relevant of rows.slice(0,102)){if(!relevant)continue;if(++count>100)return 'too_large';}
    return count;
  };
  for(let relevant=0;relevant<=104;relevant++){
    const entries=Array(relevant).fill(true);
    assert.equal(evaluate(entries),relevant>100?'too_large':relevant);
    for(let at=0;at<=entries.length;at++){
      const rows=entries.slice();rows.splice(at,0,false);
      assert.equal(evaluate(rows),relevant>100?'too_large':relevant);
    }
  }
  // The bounded probe is NOT a larger public result budget or SQL execution proof.
  assert.equal(evaluate([false,...Array(101).fill(true)]),'too_large');
});

test('existing service-only grants are restored and widenedACLs fail closed, not silently repaired',()=>{
  assert.equal((clean.match(/grant execute on function/g)||[]).length,3);
  for(let i=0;i<names.length;i++)has(clean,
    `revoke all on function public.${names[i]}(${i===2?'jsonb,uuid':'text,uuid,jsonb'}) from public,anon,authenticated,service_role;`,
    `grant execute on function public.${names[i]}(${i===2?'jsonb,uuid':'text,uuid,jsonb'}) to service_role;`);
  for(const section of [clean.slice(0,clean.indexOf('create or replace function')),clean.slice(clean.indexOf('do $period_session_capacity_postconditions$'))])has(section,
    "array['anon','authenticated']","has_function_privilege('service_role',spec.signature,'EXECUTE')",
    "a.privilege_type='EXECUTE'","a.grantee not in(p.proowner,(select oid from pg_roles where rolname='service_role'))",
    "raise exception 'merchant_attendance_period_session_capacity_installation_conflict'");
});

