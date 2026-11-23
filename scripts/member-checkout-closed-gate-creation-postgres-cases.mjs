// Only the owned TEMP entry point calls this. Actual old CAS and actual
// creator/HTTP; no production connection, real session, mail or dispatcher.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import orders from '../src/lib/merchantOrders.ts';

export async function closedGateOrderCases(t,{admin,a,b,seed,submit,ack,state,site,one,rows,records,newInput,ordinary,http,mutation}){
 const cas=(c,m,id=site)=>one(c,'select public.faolla_commit_order_membership_v1($1,$2) result',[id,m]);
 const baseline='pg_temp.faolla_checkout_creation_baselines';
 await t.test('closed-gate actual HTTP retains the safe refusal and does not notify or mirror',async()=>{
  const f=await seed();await submit(f);const before=await state(),x=await http(f,{intent:false});
  assert.equal(x.response.status,409);assert.equal((await x.response.json()).error,'checkout_original_pending');assert.equal(x.notifications,0);assert.deepEqual(x.stats(),{mirror:0,calls:1});assert.deepEqual(await state(),before);
 });
 await t.test('closed application and enrollment gates still protect a durable principal; explicit review permits the original ordinary success/replay',async()=>{
  const f=await seed();await submit(f);await admin.query('update faolla_checkout_design.intent_pilots set enabled=false where site_id=$1',[site]);
  try{const before=await state();await assert.rejects((await ordinary(f,{intent:false})).create(),/checkout_original_pending/);assert.deepEqual(await state(),before);
   for(const patch of [{customerAccountId:'',customerUserId:'',customerLoginEmail:''},{customerAccountId:'59999999',customerUserId:'other-synthetic'}])assert.equal((await(await ordinary(f,{intent:false,input:{...newInput(f),...patch}})).create()).status,'pending');
   await ack(f);const x=await ordinary(f,{intent:false}),created=await x.create(),stable=await state();assert.equal((await x.create()).id,created.id);assert.equal(x.stats().calls,1);assert.deepEqual(await state(),stable);
  }finally{await admin.query('update faolla_checkout_design.intent_pilots set enabled=true where site_id=$1',[site]);}
 });
 await t.test('old CAS cannot bypass orphan financial review or retain an old snapshot',async()=>{
  const f=await seed(),old=await one(admin,'select b.principal_key from faolla_checkout_design.bundle_results b where b.site_id=$1 and not exists(select 1 from faolla_checkout_design.intent_claims c where c.site_id=b.site_id and c.operation_key=b.operation_key) limit 1',[site]);assert.ok(old);
  const [,accountId,userId]=old.principal_key.split(':');f.principal={accountId,userId};const before=await state();await assert.rejects((await ordinary(f,{intent:false})).create(),/checkout_intent_review_required/);assert.deepEqual(await state(),before);
  const m=await mutation(f);await a.query('begin isolation level repeatable read');try{await assert.rejects(cas(a,m),/checkout_resource_locked/);}finally{await a.query('rollback');}assert.deepEqual(await state(),before);
 });
 await t.test('old CAS fails promptly on inverted checkout/enrollment locks and rolls back all partial history and resource writes',async()=>{
  for(const lock of ['checkout','enrollment']){const f=await seed(),m=await mutation(f),before=await state();await a.query('begin');
   try{if(lock==='checkout')await a.query("select pg_advisory_xact_lock(hashtextextended('faolla-customer-checkout:'||$1,0))",[site]);else await a.query('update faolla_checkout_design.intent_pilots set enabled=true where site_id=$1',[site]);
    await b.query('set statement_timeout=1500');await assert.rejects(cas(b,m),error=>{assert.equal(error.message,'checkout_resource_locked');assert.equal(error.code,'P0001');return true;});assert.deepEqual(await state(),before);
   }finally{await a.query('rollback');await b.query('set statement_timeout=15000');}
  }
 });
 await t.test('whole-store baseline permits existing pending IDs to cross 100-record chunks without treating them as new purchases',async()=>{
  const f=await seed(),native=(await ordinary(f,{intent:false})),created=await native.create();
  const existing=records(await rows()),guests=Array.from({length:102},()=>orders.createMerchantOrder({...newInput(f),customerAccountId:'',customerUserId:''},{id:`O-chunk-${randomUUID()}`,createdAt:new Date().toISOString()}));
  await cas(a,{orders:{expectedRows:await rows(),next:[...existing,...guests]}});await submit(f);
  const before=await state(),rs=await rows(),all=records(rs),moved=all.find(r=>r.id===created.id);assert.ok(moved);assert.ok(rs.length>=2);
  const next=[...all.filter(r=>r.id!==created.id),{...moved,note:'Ordinary existing record, not a second purchase'}];
  assert.ok(all.findIndex(r=>r.id===created.id)<100);assert.ok(next.findIndex(r=>r.id===created.id)>=100);
  await cas(a,{orders:{expectedRows:rs,next}});assert.deepEqual(records(await rows()).map(r=>r.id),next.map(r=>r.id));
  const after=await state();for(const key of Object.keys(before).filter(k=>k!=='public.pages'))assert.deepEqual(after[key],before[key],key);
  assert.equal((await one(a,'select to_regclass($1) relation',[baseline])).relation,null,'transaction-local metadata is gone after commit');
  const stable=await state();await assert.rejects((await ordinary(f,{intent:false})).create(),/checkout_original_pending/);assert.deepEqual(await state(),stable);
 });
 await t.test('baseline is not forgeable through a caller TEMP relation; its trusted cache is inaccessible and drops on rollback',async()=>{
  const f=await seed(),m=await mutation(f),before=await state();await a.query('begin');
  try{await a.query('set local role service_role');await a.query(`create temp table ${baseline}(site_id text primary key,ids jsonb not null) on commit drop`);await a.query('reset role');await assert.rejects(cas(a,m),/checkout_resource_locked/);}finally{await a.query('rollback');}
  assert.deepEqual(await state(),before);assert.equal((await one(a,'select to_regclass($1) relation',[baseline])).relation,null);
  await a.query('begin');try{await cas(a,m);assert.notEqual((await one(a,'select to_regclass($1) relation',[baseline])).relation,null);
   for(const role of ['anon','authenticated','service_role']){assert.equal((await one(a,'select has_table_privilege($1,$2,\'SELECT,INSERT,UPDATE,DELETE\') allowed',[role,baseline])).allowed,false);
    await a.query('savepoint denied');try{await a.query(`set local role ${role}`);await assert.rejects(a.query(`select * from ${baseline}`),/permission denied/);}finally{await a.query('rollback to savepoint denied');await a.query('release savepoint denied');}}
  }finally{await a.query('rollback');}assert.deepEqual(await state(),before);assert.equal((await one(a,'select to_regclass($1) relation',[baseline])).relation,null);
 });
 await t.test('a non-enrolled site remains an ordinary write, without new financial state or baseline',async()=>{
  const f=await seed(),id='10909993',before=await state(),rec=orders.createMerchantOrder({...newInput(f),siteId:id},{id:`O-other-site-${randomUUID()}`,createdAt:new Date().toISOString()});
  await cas(b,{orders:{expectedRows:[],next:[rec]}},id);const after=await state();for(const key of Object.keys(before).filter(k=>k!=='public.pages'))assert.deepEqual(after[key],before[key],key);
  assert.equal((await one(b,'select to_regclass($1) relation',[baseline])).relation,null);
 });
 await t.test('the new write guard is trigger-only with fixed schema, definer ownership and no API execution or ledger grants',async()=>{
  const signature='faolla_checkout_design.guard_closed_gate_creation()',definition=await one(admin,"select p.prosecdef,p.proconfig,r.rolsuper or r.rolbypassrls trusted from pg_proc p join pg_roles r on r.oid=p.proowner where p.oid=$1::regprocedure",[signature]);
  assert.equal(definition.prosecdef,true);assert.equal(definition.trusted,true);assert.deepEqual(definition.proconfig,['search_path=pg_catalog']);
  for(const role of ['anon','authenticated','service_role'])assert.equal((await one(admin,"select has_function_privilege($1,$2,'EXECUTE') allowed",[role,signature])).allowed,false);
 });
 await t.test('changing the trigger owner cannot let FORCE RLS hide the ledger and release a pending create',async()=>{
  const f=await seed();await submit(f);const m=await mutation(f),before=await state();
  // Synthetic non-API role: enough schema/type/read access to exercise FORCE
  // RLS rather than failing during function compilation on schema USAGE.
  await admin.query('create role checkout_guard_untrusted nologin;grant usage on schema faolla_checkout_design to checkout_guard_untrusted;grant select on faolla_checkout_design.intent_claims to checkout_guard_untrusted');
  await b.query('set role checkout_guard_untrusted');try{assert.equal((await one(b,'select count(*)::int n from faolla_checkout_design.intent_claims')).n,0);}finally{await b.query('reset role');}
  assert.ok((await one(admin,'select count(*)::int n from faolla_checkout_design.intent_claims')).n>0);
  await admin.query('alter function faolla_checkout_design.guard_closed_gate_creation() owner to checkout_guard_untrusted');
  try{await assert.rejects(cas(a,m),/checkout_resource_locked/);assert.deepEqual(await state(),before);}
  finally{await admin.query('alter function faolla_checkout_design.guard_closed_gate_creation() owner to legacy_intent_admin');}
 });
}
