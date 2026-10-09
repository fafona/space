import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const json = v => v === null ? "null" : `'${JSON.stringify(v).replaceAll("'","''")}'::jsonb`;

export async function checkAttendanceManagementNative({ root, query, sql, pass, connection }) {
  const oldRoles = query("select jsonb_agg(r order by id) from public.merchant_enterprise_roles r;");
  for (const name of ["202609290065_merchant_attendance_record_permission.sql", "202609290066_merchant_attendance_scopes_records.sql"])
    query(readFileSync(path.join(root,"scripts/supabase-migrations",name),"utf8"));
  assert.equal(query("select jsonb_agg(r order by id) from public.merchant_enterprise_roles r;"), oldRoles);
  assert.equal(query("select count(*) from public.merchant_attendance_scopes;"), "0");
  assert.equal(query("select public.faolla_valid_merchant_enterprise_permissions_v1(array['attendance.records.view']);"), "f");
  pass("scope migration adds no grants or roles and enforces record permission prerequisite");
  const site="99990004", owner=id(2000), auth=id(2001), employee=id(2002), role=id(2003), workerA=id(2010), workerB=id(2011), locA=id(2020), locB=id(2021);
  query(`insert into public.merchants(id,user_id) values('${site}','${owner}');
    insert into public.merchant_attendance_settings(merchant_id,time_zone) values('${site}','UTC');
    insert into public.merchant_enterprise_roles(id,merchant_id,name,permissions) values('${role}','${site}','Synthetic manager',array['enterprise.view','attendance.records.view']);
    insert into public.merchant_enterprise_employees(id,merchant_id,auth_user_id,email,display_name,role_id,status)
      values('${employee}','${site}','${auth}','manager@example.test','Manager','${role}','active');
    insert into public.merchant_attendance_locations(id,merchant_id,name,time_zone) values('${locA}','${site}','A','UTC'),('${locB}','${site}','B','UTC');
    insert into public.merchant_attendance_workers(id,merchant_id,worker_no,display_name,default_location_id) values
      ('${workerA}','${site}','A','Worker A','${locA}'),('${workerB}','${site}','B','Worker B','${locB}');
    insert into public.merchant_attendance_events(id,merchant_id,worker_id,location_id,operation_id,sequence,action,source,time_zone,occurred_at)
      select ('00000000-0000-4000-8000-'||lpad((3000+n)::text,12,'0'))::uuid,'${site}',
        case when n%2=0 then '${workerA}'::uuid else '${workerB}'::uuid end,
        case when n%4 in (0,1) then '${locA}'::uuid else '${locB}'::uuid end,
        ('00000000-0000-4000-8000-'||lpad((4000+n)::text,12,'0'))::uuid,n+1,'clock_in','web','UTC',
        '2026-09-01T12:00:00Z'::timestamptz + n * interval '1 microsecond' from generate_series(0,207) n;`);
  const grant = {workerIds:[workerA],locationIds:[locA],validFrom:"2000-01-01T00:00:00.000Z",validUntil:null};
  const call = (command=null, options={}) => `set role ${options.dbRole||"service_role"}; select public.faolla_attendance_scopes_v1('${options.site||site}',
    '${options.auth||owner}','${options.employee||employee}',${json(command)},${options.receipt ? `'${options.receipt}'::uuid` : "null"});`;
  const get = (command=null, options={}) => JSON.parse(query(call(command,options)));
  const recordQuery = {access:"manager",fromAt:"2026-09-01T00:00:00.000000Z",toAt:"2026-09-02T00:00:00.000000Z",workerId:null,locationId:null,asOf:null,cursorAt:null,cursorId:null};
  const recordsCall = (patch={}, options={}) => `set role ${options.dbRole||"service_role"}; select public.faolla_attendance_records_v1('${options.site||site}','${options.auth||auth}',${json({...recordQuery,...patch})});`;
  const records = (patch={},options={})=>JSON.parse(query(recordsCall(patch,options)));
  let op=5000;
  const command = (patch={})=>({operationId:id(++op),expectedRevision:get().scope.revision,action:"put",grantId:id(2100),grant,...patch});
  const snapshot=()=>query(`select jsonb_build_object('scopes',(select jsonb_agg(x) from public.merchant_attendance_scopes x),
    'grants',(select jsonb_agg(x) from public.merchant_attendance_scope_grants x),'workers',(select jsonb_agg(x) from public.merchant_attendance_scope_workers x),
    'locations',(select jsonb_agg(x) from public.merchant_attendance_scope_locations x),'audit',(select jsonb_agg(x) from public.merchant_attendance_scope_operations x),
    'events',(select jsonb_agg(x) from public.merchant_attendance_events x));`);
  function reject(label,statement,error){const before=snapshot(),r=sql(statement);assert.notEqual(r.status,0,label);assert.match(r.error,new RegExp(error),label);assert.equal(snapshot(),before,label);pass(label);}
  assert.equal(get().scope.revision,0);assert.deepEqual(get().scope.grants,[]);
  assert.equal(query("select count(*) from public.merchant_attendance_scopes;"),"0");pass("scope GET never creates an authorization row");
  for(const dbRole of ["anon","authenticated"]) {
    reject(`${dbRole} cannot invoke scope writes`,call(command(),{dbRole}),"42501");
    reject(`${dbRole} cannot invoke record reads`,recordsCall({}, {dbRole}),"42501");
  }
  reject("manager cannot grant own scope",call(command(),{auth}),"attendance_access_denied");
  reject("no scope does not mean all-company",recordsCall(),"attendance_access_denied");
  reject("forged owner access denied",recordsCall({access:"owner"}),"attendance_access_denied");
  reject("cross-tenant scope employee denied",call(command(),{employee:id(111)}),"attendance_employee_invalid");
  reject("cross-tenant worker assignment denied",call(command({grant:{...grant,workerIds:[id(21)]}})),"attendance_scope_target_invalid");
  reject("cross-tenant location assignment denied",call(command({grant:{...grant,locationIds:[id(11)]}})),"attendance_scope_target_invalid");
  for(const patch of [{grant:{...grant,workerIds:[workerA,workerA]}},{grant:{...grant,locationIds:["*"]}},
    {grant:{...grant,validUntil:grant.validFrom}},{grant:{...grant,validFrom:"2026-02-30T00:00:00.000Z"}},
    {grant:{...grant,workerIds:Array(201).fill(workerA)}},{grant:{...grant,boardAccess:"all"}}, {expectedRevision:0.1}, {actor:owner}])
    reject("malformed scope command rolls back",call(command(patch)),"attendance_invalid_request");
  const first=command(), saved=get(first);assert.equal(saved.scope.revision,1);assert.deepEqual(get(first),saved);
  assert.equal(query("select count(*) from public.merchant_attendance_scope_operations;"),"1");pass("scope exact replay returns one immutable audit receipt");
  reject("changed replay cannot widen scope",call({...first,grant:{...grant,locationIds:[locB]}}),"attendance_operation_conflict");
  reject("stale revision cannot overwrite scope",call(command({expectedRevision:0})),"attendance_version_conflict");
  get(command({grantId:id(2101),grant:{...grant,workerIds:[workerB],locationIds:[locB]}}));
  const a=records();assert.equal(a.items.length,50);assert.ok(a.nextCursor);
  const b=records({asOf:a.asOf,cursorAt:a.nextCursor.occurredAt,cursorId:a.nextCursor.id});
  const c=records({asOf:a.asOf,cursorAt:b.nextCursor.occurredAt,cursorId:b.nextCursor.id});
  const all=[...a.items,...b.items,...c.items];assert.equal(all.length,104);assert.equal(new Set(all.map(r=>r.id)).size,104);assert.equal(c.nextCursor,null);
  assert.ok(all.every(r=>(r.workerId===workerA&&r.locationId===locA)||(r.workerId===workerB&&r.locationId===locB)));
  assert.ok(all.every(r=>!('employeeId' in r)&&!('operationId' in r)&&!('authUserId' in r)&&!('latitude' in r)));
  assert.match(a.nextCursor.occurredAt,/\.\d{6}Z$/);pass("SQL scopes precede pagination, preserve grant pairs and retain microsecond cursors over three pages");
  assert.equal(records({workerId:workerA,locationId:locB}).items.length,0);
  assert.equal(records({workerId:id(21)}).items.length,0);pass("record filters cannot expand scope or reveal other tenant existence");
  query(`update public.merchant_attendance_workers set default_location_id='${locA}' where id='${workerB}';`);
  assert.ok(records({workerId:workerB}).items.every(r=>r.locationId===locB));pass("worker transfer does not change historical event visibility");
  assert.equal(records({access:"owner"},{auth:owner}).scopeRevision,null);assert.equal(records({access:"owner"},{auth:owner}).items.length,50);
  pass("current owner reads bounded own-tenant history without employee scope");
  reject("different merchant owner denied",recordsCall({access:"owner"},{auth:id(500)}),"attendance_access_denied");
  reject("scope metadata denies non-owner reads",call(null,{auth}),"attendance_access_denied");
  for(const patch of [{toAt:"2026-10-03T00:00:00.000Z"},{offset:50},{cursorId:id(3000)},
    {asOf:"2099-01-01T00:00:00.000Z"},{cursorAt:"2026-08-01T00:00:00.000Z",cursorId:id(3000),asOf:a.asOf}])
    reject("invalid bounded record query rejected",recordsCall(patch),"attendance_invalid_request");
  const expired=command({grant:{...grant,validUntil:"2000-01-02T00:00:00.000Z"}});get(expired);
  assert.equal(records({workerId:workerA}).items.length,0);pass("expired authorization yields no matching records");
  get(command({grant}));
  const remove=command({action:"remove",grant:null});get(remove);assert.deepEqual(get(remove).receipt,get(null,{receipt:remove.operationId}).receipt);
  assert.equal(records({workerId:workerA}).items.length,0);pass("revocation preserves receipt and does not erase raw events");
  get(command({grant}));
  for (const table of ["scopes","scope_grants","scope_workers","scope_locations","scope_operations"]) {
    reject(`authenticated cannot read ${table}`,`set role authenticated;select * from public.merchant_attendance_${table};`,"42501");
    assert.equal(query(`begin;grant select on public.merchant_attendance_${table} to authenticated;set role authenticated;select count(*) from public.merchant_attendance_${table};rollback;`),"0");
  }
  pass("all scope tables remain RLS closed after accidental SELECT grant");
  reject("service cannot mutate scopes directly","set role service_role;update public.merchant_attendance_scopes set revision=0;","42501");
  reject("scope audit cannot be rewritten","update public.merchant_attendance_scope_operations set command='{}';","42501");
  reject("scope audit cannot be truncated","truncate public.merchant_attendance_scope_operations;","42501");
  reject("private snapshot helper cannot bypass owner auth",`set role service_role;select public.faolla_attendance_scope_snapshot_v1('${site}','${employee}');`,"42501");
  const active=[];
  const start=(name,source,hold=false)=>{const c=connection(name,source,hold);active.push(c);return c;};
  async function locked(name){const until=Date.now()+4000;while(Date.now()<until){if(query(`select count(*) from pg_stat_activity where application_name='${name}' and wait_event_type='Lock';`)==="1")return;await new Promise(r=>setTimeout(r,20));}throw Error(`lock not witnessed: ${name}`);}
  try {
    const mutation=command({grant:{...grant,locationIds:[locA,locB]}});
    const x=start("attendance_scope_a",`begin;${call(mutation)}`,true);await x.ready;
    const y=start("attendance_scope_b",call(mutation));await locked("attendance_scope_b");x.finish("commit;");
    const results=await Promise.all([x.completed,y.completed]);for(const r of results)assert.equal(r.status,0,r.error);
    assert.equal(query(`select count(*) from public.merchant_attendance_scope_operations where operation_id='${mutation.operationId}';`),"1");
    pass("witnessed duplicate scope transactions commit one revision and audit");
    const revoke=command({action:"remove",grant:null});
    const r=start("attendance_scope_revoke",`begin;${call(revoke)}`,true);await r.ready;
    const read=start("attendance_scope_read",recordsCall({workerId:workerA}));await locked("attendance_scope_read");r.finish("commit;");
    assert.equal((await r.completed).status,0);const readResult=await read.completed;assert.equal(readResult.status,0,readResult.error);assert.equal(JSON.parse(readResult.output).items.length,0);
    pass("witnessed revocation blocks a pending page then returns no revoked worker records");
    get(command({grant}));
    const page=start("attendance_scope_page",`begin;${recordsCall()}`,true);await page.ready;
    const erase=start("attendance_scope_erase",call(command({action:"remove",grant:null})));await locked("attendance_scope_erase");page.finish("commit;");
    assert.equal((await page.completed).status,0);assert.equal((await erase.completed).status,0);
    assert.equal(records({workerId:workerA}).items.length,0);pass("already-authorized page completes before later revocation, following page rechecks scope");
    const roleChange=start("attendance_scope_role",`begin;update public.merchant_enterprise_roles set permissions=array['enterprise.view'] where id='${role}';`,true);await roleChange.ready;
    const stale=start("attendance_scope_stale",recordsCall({asOf:a.asOf,cursorAt:a.nextCursor.occurredAt,cursorId:a.nextCursor.id}));await locked("attendance_scope_stale");roleChange.finish("commit;");
    assert.equal((await roleChange.completed).status,0);const rejected=await stale.completed;assert.notEqual(rejected.status,0);assert.match(rejected.error,/attendance_access_denied/);
    pass("witnessed role withdrawal denies continuation even with old page cursor");
    reject("grant cannot reactivate a manager lacking role permission",call(command()),"attendance_scope_manager_invalid");
    get(command({grantId:id(2101),action:"remove",grant:null}));pass("owner can revoke residual scope after role withdrawal");
  } finally {for(const c of active)c.finish("rollback;");await Promise.all(active.map(c=>c.completed));}
}
