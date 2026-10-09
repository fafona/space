import assert from 'node:assert/strict';
import test from 'node:test';
import {prepareAttendanceRecordsPagingData} from './fixtures/attendance-records-paging-data.mjs';

const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;

// This is a SQL-construction/guard probe, not a database or business-result
// simulator. Actual authorization, pagination and receipts belong to the runner.
function probe(options={}){
  const calls=[],commands=[],grants=new Map();
  const state={revision:0,seed:null,facts:null,isolation:{schema:'attendance_race_'+'a'.repeat(32),owner:'postgres',
    marker:'faolla-synthetic-concurrency:00000000-0000-4000-8000-000000000001'},...options};
  const exec=sql=>{
    calls.push(sql);
    if(sql.includes("'marker',obj_description"))return JSON.stringify(state.isolation);
    if(sql.includes('select count(*) from public.merchants'))return state.existing??'0';
    if(sql.includes("to_char((clock_timestamp() at time zone 'UTC')::date-1"))return state.date??'2026-10-01';
    if(sql.includes('insert into public.merchants')){
      state.seed=sql;
      const body=sql.match(/insert into public\.merchant_attendance_events\(([^)]+)\) values\s*([\s\S]+?);/);
      assert(body,'event seed must be an explicit bounded INSERT');
      const columns=body[1].split(',');
      const events=[...body[2].matchAll(/\(([^)]+)\)/g)].map(match=>{
        const values=[...match[1].matchAll(/'((?:[^']|'')*)'|\b(\d+)\b/g)].map(value=>value[1]===undefined?Number(value[2]):value[1].replaceAll("''","'"));
        assert.equal(values.length,columns.length);return Object.fromEntries(columns.map((column,index)=>[column,values[index]]));
      });
      state.facts={events,workers:[{id:id(201)}],locations:[{id:id(301)}],settings:[{merchant_id:'99990001',enabled:false}],
        employees:[{id:id(101)}],roles:[{id:id(30)}],merchants:[{id:'99990001'},{id:'99990002'}]};
      return '';
    }
    if(sql.includes('public.faolla_attendance_scopes_v1(')){
      if(state.scopeError)throw state.scopeError;
      assert.match(sql,new RegExp(`faolla_attendance_scopes_v1\\('99990001','${id(99)}','${id(101)}',`));
      const encoded=sql.match(/,'((?:[^']|'')*)'::jsonb,null\)\)/);
      const command=encoded?JSON.parse(encoded[1].replaceAll("''","'")):null;
      let receipt=null;
      if(command){
        assert.equal(command.expectedRevision,state.revision);commands.push(structuredClone(command));
        if(command.action==='put')grants.set(command.grantId,{id:command.grantId,...structuredClone(command.grant)});
        else {assert.equal(command.action,'remove');assert(grants.delete(command.grantId));}
        state.revision++;
        receipt={operationId:command.operationId,revision:state.revision,grantId:command.grantId,action:command.action};
      }
      return JSON.stringify({role:state.replyRole??'service_role',data:{scope:{siteId:'99990001',employeeId:id(101),revision:state.revision,grants:[...grants.values()]},receipt}});
    }
    if(sql.includes("'allowedIds'")){
      const all=[...state.facts.events].sort((a,b)=>b.occurred_at.localeCompare(a.occurred_at)||b.id.localeCompare(a.id));
      const allowed=event=>event.merchant_id==='99990001'&&(event.worker_id===id(201)&&event.location_id===id(301)||event.worker_id===id(228)&&event.location_id===id(302));
      const result={allowedIds:all.filter(allowed).map(event=>event.id),forbiddenIds:all.filter(event=>!allowed(event)).map(event=>event.id)};
      if(state.tamperOrder)result.allowedIds.reverse();
      return JSON.stringify(result);
    }
    if(sql.includes("'events',(select"))return JSON.stringify(state.facts);
    throw Error('Unexpected probe SQL: '+sql);
  };
  return {exec,calls,commands,state,grants};
}

test('owned empty sandbox gets exact tenant, identity and 28-pair scope manifest through constructed owner/service-role RPC statements',()=>{
  const p=probe(),data=prepareAttendanceRecordsPagingData(p);
  assert.equal(data.site,'99990001');assert.equal(data.foreign,'99990002');assert.equal(data.managerAuth,id(1));
  assert.equal(data.owner,id(99));assert.equal(data.managerEmployee,id(101));assert.equal(data.managerRole,id(30));
  assert.deepEqual(data.workers,Array.from({length:28},(_,n)=>id(201+n)));
  assert.deepEqual(data.locations,[301,302,398].map(id));assert.deepEqual(data.grants,[401,402,403].map(id));
  assert.equal(data.scopeRevision,3);assert.equal(data.date,'2026-10-01');
  assert.deepEqual(p.commands.map(command=>command.expectedRevision),[0,1,2]);
  assert.deepEqual(p.commands.map(command=>command.grant.workerIds),[data.workers.slice(0,27),[id(228)],[id(201)]]);
  assert.deepEqual(p.commands.map(command=>command.grant.locationIds),[[id(301)],[id(302)],[id(301)]]);
  for(const command of p.commands){
    assert.deepEqual(Object.keys(command).sort(),['action','expectedRevision','grant','grantId','operationId']);
    assert.equal(command.action,'put');assert.equal(command.grant.validFrom,'2000-01-01T00:00:00.000Z');assert.equal(command.grant.validUntil,null);
  }
  assert.match(p.state.seed,/array\['enterprise\.view','attendance\.records\.view'\]/);
  assert.match(p.state.seed,/grant select on public\.merchants,public\.merchant_enterprise_roles,public\.merchant_enterprise_employees to service_role/);
  assert.doesNotMatch(p.calls.join('\n'),/insert into public\.merchant_attendance_scope(?:s|_grants|_workers|_locations)\b/);
  assert(Object.isFrozen(data)&&Object.isFrozen(data.workers)&&Object.isFrozen(data.actors));
});

test('fixture seeds 104 diagonal and 12 forbidden raw facts with real microseconds and UUID ties',()=>{
  const p=probe(),data=prepareAttendanceRecordsPagingData(p),events=p.state.facts.events;
  assert.equal(events.length,116);assert.equal(data.eventsBaseline.length,116);
  const count=(worker,location)=>events.filter(event=>event.worker_id===id(worker)&&event.location_id===id(location)).length;
  assert.equal(count(201,301),52);assert.equal(count(228,302),52);assert.equal(count(201,302),4);assert.equal(count(228,301),4);
  assert.equal(count(299,301),2);assert.equal(count(298,398),2);
  assert.equal(new Set(events.map(event=>event.merchant_id+'.'+event.worker_id+'.'+event.sequence)).size,116);
  assert.equal(new Set(events.map(event=>event.id)).size,116);assert.equal(new Set(events.map(event=>event.operation_id)).size,116);
  for(const event of events){assert.match(event.occurred_at,/^2026-10-01T12:00:00\.\d{6}Z$/);assert.equal(event.received_at,event.occurred_at);assert.equal(event.source,'web');}
  assert.notEqual(events[0].occurred_at,events[1].occurred_at);assert.equal(events[1].occurred_at,events[2].occurred_at);
  for(const [a,b] of [[54,53],[4,3]]){assert.equal(events[a].occurred_at,events[b].occurred_at);assert.notEqual(events[a].id,events[b].id);}
  assert.deepEqual(data.allowedIds,Array.from({length:104},(_,n)=>id(10104-n)));
  assert.deepEqual(data.forbiddenIds,Array.from({length:12},(_,n)=>id(10116-n)));
  assert.doesNotMatch(p.calls.join('\n'),/faolla_attendance_(?:self|location_clock|onsite_clock|pin_clock)_v\d/);
});

test('grant removal rereads current revision and uses exact owner service-role remove, never a direct delete',()=>{
  const p=probe(),data=prepareAttendanceRecordsPagingData(p);
  for(const [index,grant] of [data.grants[2],data.grants[0],data.grants[1]].entries()){
    const before=p.calls.length,result=data.revoke(grant);
    assert.equal(p.calls.length,before+2);assert.match(p.calls[before],/,null,null\)\)/);
    assert.equal(result.receipt.grantId,grant);assert.equal(result.receipt.action,'remove');assert.equal(data.scopeRevision,index+4);
    const command=p.commands.at(-1);assert.equal(command.grant,null);assert.equal(command.expectedRevision,index+3);
    assert.match(command.operationId,/^[0-9a-f-]{36}$/);assert.match(p.calls.at(-1),/set role service_role;/);
  }
  assert.equal(p.grants.size,0);assert.equal(new Set(p.commands.map(command=>command.operationId)).size,6);
  assert.doesNotMatch(p.calls.join('\n'),/delete from|update public\.merchant_attendance_scopes/i);
  const count=p.calls.length;assert.throws(()=>data.revoke(id(499)),/records_paging_unknown_grant/);assert.equal(p.calls.length,count);
  assert.throws(()=>data.revoke(data.grants[0]),/records_paging_grant_already_removed/);assert.equal(p.calls.length,count+1);
});

test('public, wrong owner/marker, occupied tenants or invalid date fail before any INSERT',()=>{
  for(const patch of [{schema:'public'},{owner:'service_role'},{marker:'some-other-test'}]){
    const p=probe();Object.assign(p.state.isolation,patch);
    assert.throws(()=>prepareAttendanceRecordsPagingData(p),/records_paging_owned_sandbox_required/);
    assert.equal(p.calls.length,1);assert.equal(p.state.seed,null);
  }
  for(const options of [{existing:'1'},{date:'2026-02-30'},{date:"2026-10-01';drop schema public cascade;--"}]){
    const p=probe(options);assert.throws(()=>prepareAttendanceRecordsPagingData(p),/records_paging_(?:tenants_must_be_absent|invalid_database_date)/);
    assert.equal(p.state.seed,null);
  }
  assert.throws(()=>prepareAttendanceRecordsPagingData({exec:null}),/records_paging_exec_required/);
});

test('protected snapshots cover every fact/configuration/identity table but intentionally permit scope changes',()=>{
  const p=probe(),data=prepareAttendanceRecordsPagingData(p);
  data.assertFactsUnchanged();data.revoke(data.grants[2]);data.assertFactsUnchanged();
  for(const table of ['events','workers','locations','settings','employees','roles','merchants']){
    const before=structuredClone(p.state.facts[table]);p.state.facts[table].push({unexpected:'mutation'});
    assert.throws(()=>data.assertFactsUnchanged(),/records_paging_protected_facts_changed/);p.state.facts[table]=before;
  }
  const sql=p.calls.at(-1);assert.doesNotMatch(sql,/merchant_attendance_scope/);
  assert(Object.isFrozen(data.eventsBaseline)&&Object.isFrozen(data.eventsBaseline[0]));
  data.assertFactsUnchanged();
});

test('bad database ordering, wrong SQL role and SQL write errors cannot become successful fixture evidence',()=>{
  assert.throws(()=>prepareAttendanceRecordsPagingData(probe({tamperOrder:true})),/records_paging_allowed_order/);
  assert.throws(()=>prepareAttendanceRecordsPagingData(probe({replyRole:'postgres'})),/records_paging_scope_role/);
  const p=probe(),data=prepareAttendanceRecordsPagingData(p),failure=Error('ERROR: attendance_access_denied');
  p.state.scopeError=failure;const before=p.calls.length;
  assert.throws(()=>data.revoke(data.grants[0]),error=>error===failure);assert.equal(p.calls.length,before+1);assert.equal(data.scopeRevision,3);
});
