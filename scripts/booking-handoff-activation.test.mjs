import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {guardedProductionBookingActivationSql,isolatedBookingActivationAcceptanceSql,BOOKING_ACTIVATION_BODY_SHA256} from './booking-handoff-activation.mjs';
const before={systemIdentifier:'7612049595342295079',databaseOid:'5',serverVersionNum:'150008',
  generation:'10000000-0000-4000-8000-000000000001',revision:'0',protocol:2,active:false,
  savedBookingRowsSha256:'a'.repeat(64),commands:0,mailJobs:0};
test('activation construction permits only the fixed inactive real database snapshot',()=>{
  const sql=guardedProductionBookingActivationSql(before);
  assert.match(sql,/current_database\(\)<>'postgres'/);assert.match(sql,/7612049595342295079/);
  for(const [key,value]of Object.entries({systemIdentifier:'1',databaseOid:'6',serverVersionNum:'170010',generation:'invalid',revision:'1',protocol:1,
    active:true,savedBookingRowsSha256:'bad',commands:1,mailJobs:1,extra:true}))assert.throws(()=>guardedProductionBookingActivationSql({...before,[key]:value}),undefined,key);
});
test('the transaction locks and rechecks every protected row, registry, queue, identity and generation before exactly one control-bit update',()=>{
  const sql=guardedProductionBookingActivationSql(before);
  assert.equal((sql.match(/update public\./g)??[]).length,1);assert.match(sql,/update public\.faolla_booking_atomic_control set active=true where singleton and not active and protocol=2 and revision=0/);
  for(const token of ["lock_timeout='2s'","statement_timeout='20s'",'in share row exclusive mode','v_before is distinct from',
    'v_updated<>1','v_after is distinct from jsonb_set',"'{active}','true'",'booking_activation_changed_saved_data','booking_activation_registry',
    'booking_activation_role','booking_activation_owner','booking_activation_private_tables','booking_activation_private_rpcs',
    'coalesce(string_agg(to_jsonb(m)::text',"'__merchant_booking_records__:v1:backup'"])
    assert.ok(sql.includes(token),token);
  assert.ok(sql.indexOf('v_before is distinct from')<sql.indexOf('update public.'));
  assert.doesNotMatch(sql,/update public\.pages|delete from|truncate |drop |set active=false|set revision|create function|create or replace|grant |RESEND|\bfetch\b/i);
});
test('isolated acceptance uses the identical transaction body and independently cannot activate the production cluster',()=>{
  const production=guardedProductionBookingActivationSql(before),fixture={...before,systemIdentifier:'7000000000000000001',databaseOid:'12345',serverVersionNum:'150008'};
  const isolated=isolatedBookingActivationAcceptanceSql({before:fixture,databaseName:'faolla_booking_activation_1234567890abcdef'});
  const body=sql=>sql.slice(sql.indexOf('lock table public.pages'));
  assert.equal(body(isolated),body(production));assert.equal(createHash('sha256').update(body(production)).digest('hex'),BOOKING_ACTIVATION_BODY_SHA256);
  assert.match(isolated,/or \(select system_identifier::text from pg_control_system\(\)\)='7612049595342295079'/);
  for(const databaseName of ['postgres','other',"faolla_booking_activation_1234567890abcdef';select 1;--",'faolla_booking_activation_1234567890abcdef\n'])
    assert.throws(()=>isolatedBookingActivationAcceptanceSql({before:fixture,databaseName}));
  assert.throws(()=>isolatedBookingActivationAcceptanceSql({before,databaseName:'faolla_booking_activation_1234567890abcdef'}));
  for(const [key,value]of Object.entries({systemIdentifier:"1';--",databaseOid:'0',serverVersionNum:'invalid',generation:'invalid',revision:'1',protocol:1,active:true,savedBookingRowsSha256:"a';--",commands:1,mailJobs:1,extra:true}))
    assert.throws(()=>isolatedBookingActivationAcceptanceSql({before:{...fixture,[key]:value},databaseName:'faolla_booking_activation_1234567890abcdef'}),undefined,key);
});
test('activation module has no executor, credential lookup, test-only production bypass, migration rewrite or hidden retry',()=>{
  const source=readFileSync(new URL('./booking-handoff-activation.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(source,/from ['"]node:(?:fs|child_process)|process\.env|\bfetch\(|spawnSync\(|writeFileSync\(|while\(|--skip|--force/);
});
