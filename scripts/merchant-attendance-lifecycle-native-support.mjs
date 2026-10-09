// Local test support only. Reuse the established owned namespace and bounded
// native connections; never connect to a configured application database.
import assert from 'node:assert/strict';

export const lifecycleId=n=>{
  assert(Number.isSafeInteger(n)&&n>0&&n<1e12,'lifecycle_synthetic_id_required');
  return `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
};
export const lifecycleJson=value=>value===null?'null':`'${JSON.stringify(value).replaceAll("'","''")}'::jsonb`;

export function assertLifecycleSandbox(exec){
  assert.equal(typeof exec,'function');
  const owned=JSON.parse(exec(`reset role;select jsonb_build_object('schema',n.nspname,'oid',n.oid::bigint,
    'tableOid',c.oid::bigint,'owner',n.nspowner::regrole::text,'marker',obj_description(n.oid,'pg_namespace'))
    from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.oid='public.merchants'::regclass;`));
  assert(owned&&/^attendance_race_[a-f0-9]{32}$/.test(owned.schema)&&owned.owner==='postgres'
    &&/^faolla-synthetic-concurrency:[a-f0-9-]{36}$/.test(owned.marker)
    &&Number.isSafeInteger(owned.oid)&&owned.oid>0&&Number.isSafeInteger(owned.tableOid)&&owned.tableOid>0,
  'lifecycle_owned_schema_required');
  return owned;
}

// Inputs are statements, not transactions. No delay is taken as lock evidence:
// the exact waiter must actually be blocked by this holder's backend PID.
export async function lifecycleRace({connect,query,sql},holderSql,waiterSql,{rollback=false}={}){
  const holder=connect();let waiter,waiting;
  try{
    waiter=connect();assert.match(waiter.name,/^attendance_race_[a-f0-9]{32}$/);
    const pid=Number(await holder.step('select pg_backend_pid();'));
    assert(Number.isSafeInteger(pid)&&pid>0,'lifecycle_backend_pid_required');
    const left=await holder.step(sql(`begin;${holderSql}`));
    waiting=waiter.step(sql(`begin;${waiterSql}commit;`)).then(output=>({output,error:null}),error=>({output:null,error}));
    let witnessed=false;
    const until=Date.now()+2500;
    while(Date.now()<until){
      witnessed=query(`select count(*) from pg_stat_activity where application_name='${waiter.name}'
        and wait_event_type='Lock' and ${pid}=any(pg_blocking_pids(pid));`)==='1';
      if(witnessed)break;
      await new Promise(resolve=>setTimeout(resolve,15));
    }
    assert(witnessed,'lifecycle_exact_blocker_not_witnessed');
    await holder.step(rollback?'rollback;':'commit;');
    return {left,right:await waiting,witnessed};
  }finally{
    await Promise.all([holder.close(),waiter?.close()]);
    if(waiting)await waiting;
  }
}
