import assert from 'node:assert/strict';
import test from 'node:test';
import {prepareAttendanceSelfHistoryPagingData} from './fixtures/attendance-self-history-paging-data.mjs';

const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const decode=sql=>sql.replaceAll("''","'");
function insertRows(sql,table){
  const match=sql.match(new RegExp(`insert into public\\.${table}\\(([^)]+)\\)\\s+values\\s*([\\s\\S]+?);`));
  assert(match,'bounded explicit seed INSERT required');const columns=match[1].split(',');
  return [...match[2].matchAll(/\(([^)]+)\)/g)].map(row=>{
    const values=[...row[1].matchAll(/'((?:[^']|'')*)'|\b(null|true|false|\d+)\b/g)].map(value=>value[1]===undefined?JSON.parse(value[2]):decode(value[1]));
    assert.equal(columns.length,values.length);return Object.fromEntries(columns.map((column,index)=>[column,values[index]]));
  });
}

// Only probes statement construction/fixture guard behavior. It cannot prove
// PostgreSQL authorization, session reconstruction or browser-path success.
function probe(options={}){
  const calls=[],state={seed:null,facts:null,bindingStatements:[],
    isolation:{schema:'attendance_race_'+'a'.repeat(32),oid:123,tableOid:456,owner:'postgres',
      marker:'faolla-synthetic-concurrency:00000000-0000-4000-8000-000000000001'},...options};
  const exec=sql=>{
    calls.push(sql);
    if(sql.includes("'marker',obj_description"))return JSON.stringify(state.isolation);
    if(sql.includes('select count(*) from public.merchants'))return state.existing??'0';
    if(sql.includes("to_char((clock_timestamp() at time zone 'UTC')::date-1"))return state.date??'2026-10-01';
    if(sql.includes('insert into public.merchants')){
      state.seed=sql;
      state.facts={events:insertRows(sql,'merchant_attendance_events'),workers:insertRows(sql,'merchant_attendance_workers'),
        locations:insertRows(sql,'merchant_attendance_locations'),settings:insertRows(sql,'merchant_attendance_settings'),
        employees:insertRows(sql,'merchant_enterprise_employees'),roles:[{id:id(30),permissions:['enterprise.view','attendance.self.view']}],
        merchants:insertRows(sql,'merchants')};
      state.facts.workers.sort((a,b)=>a.id.localeCompare(b.id));
      return '';
    }
    if(sql.includes("'oldIds'")){
      const events=[...state.facts.events].sort((a,b)=>b.occurred_at.localeCompare(a.occurred_at)||b.id.localeCompare(a.id));
      const result={oldIds:events.filter(event=>event.worker_id===id(201)).map(event=>event.id),
        otherIds:events.filter(event=>event.worker_id===id(202)).map(event=>event.id),
        forbiddenIds:events.filter(event=>event.worker_id!==id(201)).map(event=>event.id)};
      if(state.tamperOrder)result.oldIds.reverse();return JSON.stringify(result);
    }
    if(sql.includes("'events',(select"))return JSON.stringify(state.facts);
    if(sql.includes('do $self_history_bindings$')){
      state.bindingStatements.push(sql);
      if(state.beforeWriteError)throw state.beforeWriteError;
      const expected=JSON.parse(decode(sql.match(/actual is distinct from '((?:[^']|'')*)'::jsonb/)[1]));
      const workers=state.facts.workers.filter(row=>row.merchant_id==='99990001'&&[id(201),id(202)].includes(row.id));
      assert.deepEqual(workers.map(row=>({id:row.id,employeeId:row.employee_id})),expected);
      const target=sql.match(/case id when '([^']+)'::uuid then '([^']+)'::uuid else '([^']+)'::uuid end/);
      assert.equal(target[1],id(201));assert.equal(workers.length,2);
      workers[0].employee_id=target[2];workers[1].employee_id=target[3];
      if(state.afterWriteError){const error=state.afterWriteError;state.afterWriteError=null;throw error;}
      return '';
    }
    throw Error('Unexpected construction probe SQL: '+sql);
  };
  return {exec,calls,state};
}

test('constructs the exact paused, view-only three-actor fixture without inventing an event auth column',()=>{
  const p=probe(),data=prepareAttendanceSelfHistoryPagingData(p);
  assert.equal(data.site,'99990001');assert.equal(data.foreign,'99990002');assert.equal(data.date,'2026-10-01');
  assert.deepEqual(data.actors.map(actor=>actor.id),[99,1,2].map(id));
  assert.deepEqual([data.owner,data.employeeAuth,data.otherAuth,data.employeeId,data.otherEmployeeId,data.role],[99,1,2,101,102,30].map(id));
  assert.deepEqual([data.worker,data.otherWorker,data.hiddenWorker,data.foreignWorker,data.location,data.foreignLocation],[201,202,299,298,301,398].map(id));
  assert.match(p.state.seed,/array\['enterprise\.view','attendance\.self\.view'\]/);
  assert(p.state.facts.settings.every(row=>row.enabled===false&&row.web_clock_enabled===false));
  assert(p.state.facts.workers.every(row=>row.active===true));assert(p.state.facts.locations.every(row=>row.active===true));
  assert.match(p.state.seed,/grant select on public\.merchants,public\.merchant_enterprise_roles,public\.merchant_enterprise_employees to service_role/);
  assert.doesNotMatch(p.state.seed,/actor_auth_user_id|attendance\.self\.clock|attendance\.self\.request/);
  assert(p.state.facts.events.filter(row=>row.worker_id===data.worker).every(row=>row.actor_employee_id===data.employeeId));
  assert(p.state.facts.events.filter(row=>row.worker_id===data.otherWorker).every(row=>row.actor_employee_id===data.otherEmployeeId));
  assert(p.state.facts.events.filter(row=>[data.hiddenWorker,data.foreignWorker].includes(row.worker_id)).every(row=>row.actor_employee_id===null));
  assert(Object.isFrozen(data)&&Object.isFrozen(data.actors)&&Object.isFrozen(data.rawBaseline[0]));
});

test('constructs 104 own and 12 excluded inputs, sorted IDs, and 26 positive four-action expected sessions',()=>{
  const p=probe(),data=prepareAttendanceSelfHistoryPagingData(p),events=p.state.facts.events;
  assert.equal(events.length,116);assert.equal(data.rawBaseline.length,116);assert.equal(data.sessions.length,26);
  assert.deepEqual(data.oldIds,Array.from({length:104},(_,n)=>id(10104-n)));
  assert.deepEqual(data.otherIds,[10108,10107,10106,10105].map(id));assert.equal(data.forbiddenIds.length,12);
  assert.equal(new Set(events.map(event=>event.id)).size,116);assert.equal(new Set(events.map(event=>event.operation_id)).size,116);
  assert.equal(new Set(events.map(event=>event.worker_id+'.'+event.sequence)).size,116);
  const micros=instant=>BigInt(Date.parse(instant.slice(0,23)+'Z'))*1000n+BigInt(instant.slice(23,26));
  for(const [index,session] of [...data.sessions,data.otherSession].entries()){
    assert.equal(session.startEventId,session.eventIds[0]);assert.deepEqual(session.eventIds,session.events.map(event=>event.id));
    assert.deepEqual(session.events.map(event=>event.action),['clock_in','break_start','break_end','clock_out']);
    const amounts=session.events.map(event=>micros(event.occurredAt));
    assert(amounts[0]<amounts[1]&&amounts[1]<amounts[2]&&amounts[2]<amounts[3]);
    assert.equal(Number(amounts[3]-amounts[0]),session.totals.elapsedUs);
    assert.equal(Number(amounts[2]-amounts[1]),session.totals.breakUs);
    assert.equal(session.totals.workedUs,session.totals.elapsedUs-session.totals.breakUs);
    assert.equal(session.totals.paidBreakUs,session.paid?session.totals.breakUs:0);
    assert.deepEqual(session.events.map(event=>event.breakPaid),[null,session.paid,null,null]);
    for(const event of session.events){
      assert.match(event.occurredAt,/^2026-10-01T\d\d:\d\d:\d\d\.000123Z$/);
      assert.deepEqual(Object.keys(event).sort(),['action','breakPaid','id','locationId','occurredAt','sequence','source','timeZone']);
    }
    if(index<25)assert.equal(session.endAt,data.sessions[index+1].startAt);
  }
  assert.equal(data.sessions.filter(session=>session.paid).length,13);
  const boundaryIds=data.oldIds.slice(99,101),boundary=boundaryIds.map(key=>events.find(event=>event.id===key));
  assert.equal(boundary[0].occurred_at,boundary[1].occurred_at);assert(boundary[0].id>boundary[1].id);
  assert.doesNotMatch(p.calls.join('\n'),/faolla_attendance_(?:self|location_clock|onsite_clock|pin_clock)_v\d/);
});

test('binding helpers construct guarded, row-locked updates to only two employee_id columns and preserve all raw events',()=>{
  const p=probe(),data=prepareAttendanceSelfHistoryPagingData(p),raw=structuredClone(p.state.facts.events);
  const swapped=[{id:id(201),employeeId:id(102)},{id:id(202),employeeId:id(101)}];
  assert.deepEqual(data.swapBindings(),swapped);data.assertFactsUnchanged();
  assert.deepEqual(p.state.facts.events,raw);assert.deepEqual(data.restoreBindings(),data.bindingsBaseline);data.assertFactsUnchanged();
  assert.equal(p.state.bindingStatements.length,2);
  for(const sql of p.state.bindingStatements){
    assert.match(sql,/begin;set local lock_timeout='3s'/);assert.match(sql,/c\.oid=456 and n\.oid=123/);
    assert(sql.includes(p.state.isolation.schema)&&sql.includes(p.state.isolation.marker));assert.match(sql,/order by id for update/);
    assert.match(sql,/actual is distinct from .*::jsonb/);assert.equal([...sql.matchAll(/affected<>2/g)].length,2);
    const writes=[...sql.matchAll(/update public\.([^ ]+) set ([\s\S]+?)\s+where ([^;]+);/g)];assert.equal(writes.length,2);
    for(const write of writes){
      assert.equal(write[1],'merchant_attendance_workers');assert(write[2].startsWith('employee_id='));
      assert.equal(write[3],`merchant_id='99990001' and id in ('${id(201)}','${id(202)}')`);
      assert.doesNotMatch(write[2],/version|updated_at|actor_employee_id|auth_user_id/);
    }
    assert.doesNotMatch(sql,/delete from|truncate|drop|insert into/i);
  }
  data.restoreBindings();assert.equal(p.state.bindingStatements.length,2,'already-original restore must not write');
});

test('exact captured namespace/table identity must remain unchanged before binding mutations',()=>{
  for(const patch of [{oid:124},{tableOid:457},{schema:'attendance_race_'+'b'.repeat(32)},{owner:'service_role'},{marker:'faolla-synthetic-concurrency:00000000-0000-4000-8000-000000000002'}]){
    const p=probe(),data=prepareAttendanceSelfHistoryPagingData(p);Object.assign(p.state.isolation,patch);
    assert.throws(()=>data.swapBindings(),/self_history_paging_sandbox_identity_changed/);assert.equal(p.state.bindingStatements.length,0);
    assert.throws(()=>data.restoreBindings(),/self_history_paging_sandbox_identity_changed/);assert.equal(p.state.bindingStatements.length,0);
  }
});

test('protected baseline exempts only the two approved binding permutations, never another column or worker',()=>{
  const p=probe(),data=prepareAttendanceSelfHistoryPagingData(p);data.swapBindings();data.assertFactsUnchanged();data.restoreBindings();
  for(const table of ['events','workers','locations','settings','employees','roles','merchants']){
    const saved=structuredClone(p.state.facts[table]);p.state.facts[table][0].unexpectedMutation=true;
    assert.throws(()=>data.assertFactsUnchanged(),/self_history_paging_protected_facts_changed/);p.state.facts[table]=saved;
  }
  for(const value of [null,id(999)]){
    p.state.facts.workers[0].employee_id=value;
    assert.throws(()=>data.swapBindings(),/self_history_paging_unexpected_bindings/);
    p.state.facts.workers[0].employee_id=id(101);
  }
  const hidden=p.state.facts.workers.find(row=>row.id===data.hiddenWorker);hidden.employee_id=id(999);
  assert.throws(()=>data.restoreBindings(),/self_history_paging_protected_facts_changed/);hidden.employee_id=null;
  assert.equal(p.state.bindingStatements.length,2);data.assertFactsUnchanged();
});

test('unsafe or occupied sandbox and invalid database dates fail before seed writes; wrong order cannot become evidence',()=>{
  for(const patch of [{schema:'public'},{owner:'service_role'},{marker:'another-run'},{oid:0},{tableOid:'456'}]){
    const p=probe();Object.assign(p.state.isolation,patch);
    assert.throws(()=>prepareAttendanceSelfHistoryPagingData(p),/self_history_paging_owned_sandbox_required/);assert.equal(p.state.seed,null);
  }
  for(const options of [{existing:'1'},{date:'2026-02-30'},{date:'2026-99-01'},{date:"2026-10-01';drop schema public;--"}]){
    const p=probe(options);assert.throws(()=>prepareAttendanceSelfHistoryPagingData(p),/self_history_paging_(?:tenants_must_be_absent|invalid_database_date)/);assert.equal(p.state.seed,null);
  }
  assert.throws(()=>prepareAttendanceSelfHistoryPagingData(probe({tamperOrder:true})),/self_history_paging_old_order/);
});

test('SQL failures propagate without automatic writes; explicit restore handles either known post-commit binding state',()=>{
  const p=probe(),data=prepareAttendanceSelfHistoryPagingData(p),before=Error('synthetic pre-write failure');
  p.state.beforeWriteError=before;assert.throws(()=>data.swapBindings(),error=>error===before);assert.equal(p.state.bindingStatements.length,1);
  data.assertFactsUnchanged();p.state.beforeWriteError=null;
  const after=Error('synthetic response lost after commit');p.state.afterWriteError=after;
  assert.throws(()=>data.swapBindings(),error=>error===after);assert.equal(p.state.bindingStatements.length,2);
  data.assertFactsUnchanged();data.restoreBindings();assert.equal(p.state.bindingStatements.length,3);data.assertFactsUnchanged();
  assert.deepEqual(p.state.facts.workers.filter(row=>[id(201),id(202)].includes(row.id)).map(row=>({id:row.id,employeeId:row.employee_id})),data.bindingsBaseline);
});
