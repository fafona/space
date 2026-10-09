//241 static/pure only. Importing this file starts no database, server or browser.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,readdirSync} from 'node:fs';
import test from 'node:test';

const directory=new URL('./supabase-migrations/',import.meta.url);
const name='202610080192_merchant_attendance_operational_source.sql';
const sql=readFileSync(new URL(name,directory),'utf8').replaceAll('\r\n','\n');
const hash=value=>createHash('sha256').update(value).digest('hex');
const functions=[...sql.matchAll(/create or replace function public\.([a-z0-9_]+)\(([^\n]*)\)\nreturns ([^\n]+) as \$\$([\s\S]*?)\$\$;/g)];
const body=suffix=>{const row=functions.find(f=>f[1]==='faolla_attendance_operational_source_'+suffix);assert(row,suffix);return row[4];};
const getter=body('v1');
const tuple=body('tuple_v1');
const pre=sql.slice(sql.indexOf('do $source_preflight$'),sql.indexOf('$source_preflight$;'));
const post=sql.slice(sql.indexOf('do $source_postconditions$'),sql.indexOf('$source_postconditions$;'));
const includes=(source,...parts)=>parts.forEach(part=>assert(source.includes(part),part));
const pins=source=>[...source.matchAll(/\('(public\.[a-z0-9_]+\([^']*\))','([0-9a-f]{64})','([^']*)','([isv])','(sql|plpgsql)'\)/g)];

test('192 adds exactly five private functions outside the191count namespace and no consumers or schema tables',()=>{
 assert.equal(functions.length,5);
 assert(functions.every(f=>f[1].startsWith('faolla_attendance_operational_source_')));
 assert.doesNotMatch(sql,/create (?:table|index|trigger|extension)|alter table|grant execute|security definer|update public\.|delete from public\./i);
 const writes=[...sql.matchAll(/insert into public\.([a-z0-9_]+)/g)].map(m=>m[1]);
 assert.deepEqual(writes,['faolla_schema_migrations']);
 includes(sql,"set local lock_timeout='3s'","set local statement_timeout='10s'","values(202610080192,'merchant_attendance_operational_source')");
 assert(sql.trim().endsWith('commit;'));
});

test('installation refuses partial objects or changed metadata before replacement and never repairs an unexpectedACL',()=>{
 assert(sql.indexOf('$source_preflight$;')<sql.indexOf('create or replace function'));
 includes(pre,"version=202610080191","name='merchant_attendance_operational_rules'",'when installed then 5 else 0','if not installed then return');
 for(const block of [pre,post])includes(block,'info.proowner is distinct from expected_owner','or info.prosecdef',"array['search_path=pg_catalog']",
  'info.proretset or info.proisstrict or info.proleakproof','acl.grantor<>expected_owner or acl.grantee<>expected_owner',
  "has_function_privilege('service_role',f,'EXECUTE')","has_function_privilege('anon',f,'EXECUTE')","has_function_privilege('authenticated',f,'EXECUTE')");
 assert.equal((sql.match(/^revoke all on function /gm)||[]).length,5);
});

test('both own source manifests match reviewed bodies with namespace-only normalization',()=>{
 for(const fn of functions){
  for(const block of [pre,post])assert(pins(block).some(p=>p[1].startsWith('public.'+fn[1]+'(')&&p[2]===hash(fn[4])),fn[1]);
  const scoped=fn[4].replaceAll('public.','attendance_native_241.');
  assert.equal(hash(scoped.replaceAll('attendance_native_241.','public.')),hash(fn[4]));
 }
 includes(pre,"ns||'.','pub'||'lic.'");
 assert.doesNotMatch(sql,/--SOURCE_PREFLIGHT|--SOURCE_SECURITY/);
});

test('21 existing actual source dependencies are pinned rather than checking only freshly generated helpers',()=>{
 const dependencies=pins(pre).filter(p=>!p[1].includes('operational_source_'));
 assert.equal(dependencies.length,21);
 const sourceFiles=readdirSync(directory).filter(x=>x.endsWith('.sql')&&x!==name).sort().map(n=>readFileSync(new URL(n,directory),'utf8').replaceAll('\r\n','\n'));
 for(const p of dependencies){
  const functionName=p[1].slice('public.'.length,p[1].indexOf('('));let actual;
  const matcher=new RegExp('create(?: or replace)? function public\\.'+functionName+'\\([\\s\\S]*?\\)\\s*returns [\\s\\S]*? as \\$\\$([\\s\\S]*?)\\$\\$;','i');
  for(const text of sourceFiles){const m=text.match(matcher);if(m)actual=m[1];}
  assert(actual,functionName);assert.equal(hash(actual),p[2],functionName+' explicitly requires a coordinated migration when changed');
 }
});

test('the existing three bounded partialBtrees are structurally checked without adding or rebuilding indexes',()=>{
 includes(pre,'attendance_group_assignments_overlap_idx','attendance_correction_policy_idx','attendance_operational_rule_effective_idx',
  'idx.indisvalid','idx.indisready','idx.indislive','idx.indexprs is not null','expected.columns','expected.options','expected.predicate',
  "(status <> ''cancelled''::text)","(action = ''set_policy''::text)","(withdrawn_revision IS NULL)");
 assert.doesNotMatch(sql,/create index|reindex|drop index/i);
});

test('source pins the real current identity with compatiblelocks and does not impersonateowner or authorize an action',()=>{
 includes(getter,'p_worker is null or p_employee is null or p_employee_auth is null','w.employee_id is distinct from e.id','e.auth_user_id is distinct from p_employee_auth');
 const positions=['from public.merchants','from public.merchant_attendance_settings','from public.merchant_attendance_workers','from public.merchant_enterprise_employees'].map(s=>getter.indexOf(s));
 assert(positions.every((v,i)=>v>=0&&(i===0||v>positions[i-1])));
 assert.equal((getter.match(/for share;/g)||[]).length,5);
 assert.doesNotMatch(getter,/for update|user_id=p_|owner_checked|set_config|current_setting|grant_id|permissions|account_epochs|\.paused|\.enabled/);
 includes(getter,"'employeeAuthUserId',p_employee_auth","'employeeId',chosen.employee_id");
});

test('group candidate selection uses a predecessor plus five civil days and a sixth sentinel,not expiry scans',()=>{
 includes(getter,'lo:=d-2;hi:=d+2','x.starts_on<lo order by x.starts_on desc limit 1',
  'x.starts_on>=lo and x.starts_on<=hi order by x.starts_on limit 6','if window_count>5','hit_count>1',
  'faolla_attendance_group_assignment_detail_v1(a)',"detail->'history'->-1->'command'->>'operationId'",
  "a.employee_id is distinct from p_employee","if not g.active then raise exception 'attendance_operational_source_group_inactive'");
 const query=getter.slice(getter.indexOf('with preceding as'),getter.indexOf('\n loop'));
 assert.doesNotMatch(query,/ends_on|original_ends_on|offset |time_zone|order by .*assignment_id/i);
 includes(getter,"to_char(a.starts_on,'YYYY-MM-DD'),a.time_zone","to_char(a.ends_on,'YYYY-MM-DD'),a.time_zone");
});

test('publication selection reads each exactscope predecessor then checks its savedend and actualledger',()=>{
 const layer=body('layer_v1');
 includes(layer,'h.scope is distinct from p_scope','faolla_attendance_operational_rule_check_v1(p_site,key_value,h.revision)',
  'x.withdrawn_revision is null and x.effective_at<=p_at','order by x.effective_at desc,x.published_revision desc limit 1',
  'faolla_attendance_operational_rule_check_v1(p_site,key_value,idx.published_revision)',
  'if idx.ends_at is not null and idx.ends_at<=p_at then return null',"o.action is distinct from 'publish'");
 const query=layer.slice(layer.indexOf('select * into idx'),layer.indexOf('if idx.operation_id'));
 assert.doesNotMatch(query,/ends_at|offset |not exists/i);
 assert.equal((getter.match(/operational_source_layer_v1\(/g)||[]).length,3);
 assert.doesNotMatch(layer,/for .*loop|limit 25|limit 100|worker_id=/);
});

test('baseline preserves independent policy and omission never means anunlimited window',()=>{
 includes(body('baseline_v1'),"x.action='set_policy' and x.recorded_at<=p_at order by x.recorded_at desc,x.revision desc limit 1",
  "array['action','operationId','expectedRevision','expectedSettingsVersion','reason','submissionWindowDays']",
  "array['submissionWindowDays','timeZone']","(c->>'expectedRevision')::bigint+1<>p.revision","(c->>'submissionWindowDays')::integer>365",
  "'timeZone',p.payload->'timeZone'",'if p.revision is null then return null');
 assert.doesNotMatch(body('baseline_v1'),/correction_periods|lock_period|unlock_period|for .* loop/);
});

test('all nine source fields use fixed scalararrays and all publication hashes andmonotone versions are checked',()=>{
 includes(tuple,"array['protocol','siteId','workerIdentity','at','settingsRef','groupAssignmentRef','layers','baselineCorrectionPolicyRef','sourceFingerprint']",
  "array['enterprise','group','personal']","jsonb_build_array('attendance-operational-rule-source-v1',p->>'siteId',it,p->>'at',st,gt,lt,bt)",
  "'attendance-operational-rule-values-v1',rt","'attendance-operational-rule-references-v1',p->>'siteId'",
  "(g->>'savedWorkerVersion')::bigint>(i->>'workerVersion')::bigint","(g->>'savedSettingsVersion')::bigint>(s->>'version')::bigint",
  "(l->'context'->'subject'->>'groupRevision')::bigint>(g->>'currentGroupRevision')::bigint",
  "(l->'context'->'subject'->>'employeeVersion')::bigint>(i->>'employeeVersion')::bigint");
 assert.doesNotMatch(tuple,/jsonb_each|jsonb_object_agg/);
});

test('scope/lifetime checks refuse foreignlayers and malformed groupdates,not silently inherit',()=>{
 includes(tuple,"scope_value:=jsonb_build_object('kind',field_name)","if l->'scope' is distinct from scope_value",'if from_value>at_value',
  "(field_name='personal') is distinct from (l->'endsAt'<>'null'::jsonb)","(g->>'revision'='1') is distinct from (g->>'operationId'=g->>'assignmentId')",
  'from_value is distinct from public.faolla_attendance_rule_day_start_v1',"g->>'revision'='2' and g->'endsOn'='null'::jsonb",
  "where x->'active' is distinct from 'true'::jsonb");
 includes(body('stamp_v1'),'char_length(p)<>27','not isfinite(t)',"YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"");
});

test('empty source hash matches the independent strictNode parser fixedvector',()=>{
 const values=['attendance-operational-rule-source-v1','99990001',
  ['24100000-0000-4000-8000-000000000001','24100000-0000-4000-8000-000000000002','24100000-0000-4000-8000-000000000003',7,6],
  '2026-10-08T12:00:00.123456Z',[9,'Europe/Madrid'],null,[null,null,null],null];
 const encode=v=>Array.isArray(v)?'['+v.map(encode).join(', ')+']':JSON.stringify(v);
 assert.equal(hash(encode(values)),'e5c73e4ca27493af5685225f80d72b639604a71c4a9e9f4280ef2060a53f4dc0');
});

test('sixcandidate proof contains every pointmatch under the pinned ±36hour boundary and civilnonoverlap invariant',()=>{
 const hours=24;const spans=[];
 for(let start=-300;start<30;start+=3)spans.push({start,end:start+1});
 for(let day=-4;day<=4;day++)for(const fraction of [0,0.5,0.999])for(const offset of [-36,0,36]){
  const at=day*hours+fraction*hours,lo=day-2,hi=day+2;
  const predecessor=spans.filter(s=>s.start<lo).at(-1);
  const candidates=[...(predecessor?[predecessor]:[]),...spans.filter(s=>s.start>=lo&&s.start<=hi)];
  assert(candidates.length<=6);
  const matched=spans.filter(s=>s.start*hours+offset<=at&&(s.end+1)*hours+offset>at);
  assert(matched.every(s=>candidates.includes(s)));
 }
});

test('runtime failures are not converted to empty success and the privateerror roster is exact',()=>{
 assert.doesNotMatch(getter,/when others|query_canceled|lock_not_available|return null/);
 includes(getter,'>262144',"raise exception 'attendance_operational_source_too_large'",'when raise_exception then','then raise;end if;');
 const errors=new Set([...functions.map(f=>f[4]).join('\n').matchAll(/raise exception '(attendance_[a-z_]+)'/g)].map(m=>m[1]));
 assert.deepEqual([...errors].sort(),['attendance_invalid_request','attendance_settings_required','attendance_operational_source_not_found',
  'attendance_operational_source_identity_changed','attendance_operational_source_ambiguous','attendance_operational_source_group_inactive',
  'attendance_operational_source_too_large','attendance_operational_source_invalid'].sort());
 assert.doesNotMatch(sql,/\bif\s+[^\n;]*(?:[><=]|is distinct from)\s*case\b/i);
});

test('invalid_request belongs only to failedinputvalidation,not a damaged saveddependency',()=>{
 includes(getter,'parameters_valid boolean:=false;',"then raise exception 'attendance_invalid_request';end if;\n parameters_valid:=true;",
  "if sqlerrm='attendance_invalid_request' and not parameters_valid then raise;end if;");
 const exceptions=getter.slice(getter.indexOf('exception when raise_exception then'));
 assert.doesNotMatch(exceptions,/sqlerrm in\([^)]*'attendance_invalid_request'/);
 assert(exceptions.indexOf("if sqlerrm='attendance_invalid_request'")<exceptions.indexOf("raise exception 'attendance_operational_source_invalid'"));
});
