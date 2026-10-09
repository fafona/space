import assert from 'node:assert/strict';
import test from 'node:test';
import {checkAttendanceLocationReceiptIdentity,locationReceiptIdentityReadSql} from './merchant-attendance-location-receipt-identity-checks.mjs';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const rpc='faolla_attendance_location_clock_v2';
const args=()=>({p_site_id:'99990008',p_auth_user_id:id(1001002),p_expected_worker_id:id(1001003),p_command:null,
  p_operation_id:id(1001022),p_assertion:null,p_allow_new_sessions:false,p_require_clock:false});

// This probe stops after constructing seeds, before loading or calling the
// service. It does not fabricate SQL response data or prove business outcomes.
function constructionProbe(options={}){
  const stop=Error('construction_probe_only'),state={calls:[],seed:null,snapshot:null,passed:[],existing:'0',
    isolation:{schema:'attendance_race_'+'a'.repeat(32),oid:123,tableOid:456,owner:'postgres',
      marker:'faolla-synthetic-concurrency:00000000-0000-4000-8000-000000000001'},...options};
  const exec=statement=>{
    state.calls.push(statement);
    if(statement.includes("'marker',obj_description"))return JSON.stringify(state.isolation);
    if(statement.includes('select count(*) from public.merchants'))return state.existing;
    if(statement.includes('insert into public.merchants')){state.seed=statement;return '';}
    if(statement.includes('select md5(coalesce(jsonb_agg')){state.snapshot=statement;throw stop;}
    throw Error('unexpected construction SQL');
  };
  return {exec,pass:label=>state.passed.push(label),state,stop};
}

test('only the exact read-only location RPC and current synthetic actor/worker pair can be rendered',()=>{
  const sql=locationReceiptIdentityReadSql(rpc,args());
  assert.match(sql,/^set role service_role;select jsonb_build_object\('role',current_user,'data',public\.faolla_attendance_location_clock_v2\(/);
  assert(sql.includes(`'99990008','${id(1001002)}','${id(1001003)}',null,'${id(1001022)}',null,false,false`));
  const preflight=locationReceiptIdentityReadSql(rpc,{...args(),p_require_clock:true});assert.match(preflight,/,null,false,true\)\);$/);
  for(const name of ['faolla_attendance_location_clock_v1','faolla_attendance_self_v1',rpc+';select 1'])
    assert.throws(()=>locationReceiptIdentityReadSql(name,args()),/location_receipt_rpc_not_allowed/);
  for(const patch of [{p_site_id:'99990001'},{p_auth_user_id:id(1000099)},{p_auth_user_id:id(1001102)},
    {p_expected_worker_id:id(1001103)},{p_operation_id:null},{p_operation_id:id(999)},
    {p_command:{}},{p_assertion:{}},{p_allow_new_sessions:true},{p_allow_new_sessions:0},
    {p_require_clock:'false'},{p_require_clock:null},{unexpected:true}])
    assert.throws(()=>locationReceiptIdentityReadSql(rpc,{...args(),...patch}),/location_receipt_/);
  for(const key of Object.keys(args())){const a=args();delete a[key];assert.throws(()=>locationReceiptIdentityReadSql(rpc,a),/location_receipt_rpc_fields/);}
});

test('all six owned pairs remain disjoint; only the genuine-absence case queries a non-seeded operation',()=>{
  const workers=new Set(),auths=new Set();
  for(let n=0;n<6;n++){
    const base=1001000+n*100,a={...args(),p_auth_user_id:id(base+2),p_expected_worker_id:id(base+3),p_operation_id:id(base+(n===5?29:22))};
    assert.match(locationReceiptIdentityReadSql(rpc,a),/null,false,false/);workers.add(a.p_expected_worker_id);auths.add(a.p_auth_user_id);
    assert.throws(()=>locationReceiptIdentityReadSql(rpc,{...a,p_operation_id:id(base+(n===5?22:29))}),/location_receipt_original_operation_only/);
  }
  assert.equal(workers.size,6);assert.equal(auths.size,6);
});

test('legacy is the default; both comparison modes construct identical histories and fingerprint scope',async()=>{
  const defaultMode=constructionProbe(),legacy=constructionProbe(),guarded=constructionProbe();
  await assert.rejects(checkAttendanceLocationReceiptIdentity(defaultMode),error=>error===defaultMode.stop);
  await assert.rejects(checkAttendanceLocationReceiptIdentity({...legacy,mode:'legacy'}),error=>error===legacy.stop);
  await assert.rejects(checkAttendanceLocationReceiptIdentity({...guarded,mode:'guarded'}),error=>error===guarded.stop);
  assert.equal(defaultMode.state.seed,legacy.state.seed);assert.equal(legacy.state.seed,guarded.state.seed);
  assert.equal(defaultMode.state.snapshot,legacy.state.snapshot);assert.equal(legacy.state.snapshot,guarded.state.snapshot);
  assert.deepEqual(defaultMode.state.passed,[]);assert.deepEqual(legacy.state.passed,[]);assert.deepEqual(guarded.state.passed,[]);
});

test('invalid comparison mode fails before any database inspection, fixture write or client construction',async()=>{
  for(const mode of [null,'','auto','LEGACY',true,1,{},['guarded']]){
    const p=constructionProbe();
    await assert.rejects(checkAttendanceLocationReceiptIdentity({...p,mode}),/location_receipt_invalid_mode/);
    assert.deepEqual(p.state.calls,[]);assert.equal(p.state.seed,null);assert.equal(p.state.snapshot,null);assert.deepEqual(p.state.passed,[]);
  }
});

test('seed construction is ownership-fenced and explicitly inserts eighteen histories, six results and four valid safe-finish links',async()=>{
  const p=constructionProbe();await assert.rejects(checkAttendanceLocationReceiptIdentity(p),error=>error===p.stop);
  const seed=p.state.seed;assert(seed);assert.match(seed,/^reset role;begin;/);assert.match(seed,/commit;$/);
  assert.match(seed,/c\.oid=456 and n\.oid=123/);assert(seed.includes(p.state.isolation.schema)&&seed.includes(p.state.isolation.marker));
  assert.match(seed,/statement_timeout='10s'/);assert.match(seed,/values\('99990008','UTC',false,false,false\)/);
  assert.doesNotMatch(seed,/\b(?:update|delete from|truncate|alter table|create function|disable trigger|session_replication_role)\b/i);
  const section=table=>{
    const match=seed.match(new RegExp(`insert into public\\.${table}\\([^)]+\\) values\\s*([\\s\\S]+?);`));assert(match);return match[1];
  };
  const events=section('merchant_attendance_events');
  assert.equal([...events.matchAll(/'clock_in','web','UTC'/g)].length,12);
  assert.equal([...events.matchAll(/'clock_out','web','UTC'/g)].length,6);
  assert.equal([...events.matchAll(/clock_timestamp\(\),null\)/g)].length,2);
  assert.equal([...events.matchAll(new RegExp(`clock_timestamp\\(\\),'${id(1000098)}'\\)`,'g'))].length,2);
  const results=section('merchant_attendance_location_results');assert.equal([...results.matchAll(/,1,1,1,1,'not_provided',true\)/g)].length,6);
  const links=section('merchant_attendance_location_clock_notices');
  const commands=[...links.matchAll(/'((?:[^']|'')*)'::jsonb/g)].map(match=>JSON.parse(match[1].replaceAll("''","'")));
  assert.equal(commands.length,4);
  for(const command of commands){
    assert.deepEqual(Object.keys(command).sort(),['action','expectedSequence','locationId','locationVersion','noticeRevision','operationId','safeFinish','settingsVersion','workerVersion']);
    assert.equal(command.safeFinish,true);assert.equal(command.noticeRevision,null);assert.equal(command.action,'clock_out');assert.equal(command.expectedSequence,1);
  }
  assert(!links.includes(id(1001012))&&!links.includes(id(1001112)),'unknown older identity receives no fabricated notice-link identity');
  assert.deepEqual(p.state.passed,[],'construction is not native execution evidence');
});

test('fingerprints cover raw facts, location evidence, links and every seeded or related configuration table',async()=>{
  const p=constructionProbe();await assert.rejects(checkAttendanceLocationReceiptIdentity(p),error=>error===p.stop);
  const snapshot=p.state.snapshot;assert(snapshot);
  for(const table of ['merchants','merchant_attendance_settings','merchant_enterprise_roles','merchant_enterprise_employees','merchant_attendance_workers',
    'merchant_attendance_locations','merchant_attendance_employment_periods','merchant_attendance_events','merchant_attendance_location_results',
    'merchant_attendance_location_clock_notices','merchant_attendance_location_notices','merchant_attendance_location_notice_acknowledgements',
    'merchant_attendance_location_policy_drafts'])assert(snapshot.includes(`from public.${table} r`));
  assert.equal([...snapshot.matchAll(/md5\(coalesce\(jsonb_agg\(to_jsonb\(r\) order by to_jsonb\(r\)::text\)::text,'\[\]'\)\)/g)].length,13);
});

test('unowned schemas, invalid OIDs, absent caller and occupied synthetic tenant cannot reach fixture writes',async()=>{
  await assert.rejects(checkAttendanceLocationReceiptIdentity({}),/location_receipt_caller_required/);
  for(const patch of [{schema:'public'},{oid:0},{tableOid:'456'},{owner:'service_role'},{marker:'not-owned'}]){
    const p=constructionProbe();Object.assign(p.state.isolation,patch);
    await assert.rejects(checkAttendanceLocationReceiptIdentity(p),/location_receipt_owned_schema_required/);assert.equal(p.state.seed,null);
  }
  const p=constructionProbe({existing:'1'});await assert.rejects(checkAttendanceLocationReceiptIdentity(p),/location_receipt_tenant_exists/);
  assert.equal(p.state.seed,null);assert.equal(p.state.snapshot,null);
});
