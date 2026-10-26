import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {encryptBookingRuleOriginals,decryptBookingRuleOriginals,validateBookingOriginalBackupDataset,
  runBookingRuleOriginalBackup} from './booking-handoff-rule-backup.mjs';

test('authenticated backup preserves exact original UTF-8 bytes rather than reserializing customer data',()=>{
  const original=Buffer.from('{"unicode":"原始规则","number":1234567890123456789012345,"spaces": [ 1, 2 ]}\n'),key=randomBytes(32);
  const first=encryptBookingRuleOriginals(original,key),second=encryptBookingRuleOriginals(original,key);
  assert.notDeepEqual(first,second);assert.deepEqual(decryptBookingRuleOriginals(first,key),original);
  assert.deepEqual(decryptBookingRuleOriginals(second,key),original);
  assert.equal(first.includes(Buffer.from('原始规则')),false);
  assert.throws(()=>decryptBookingRuleOriginals(first,randomBytes(32)));
  for(const index of [0,26,40,first.length-1]){const corrupt=Buffer.from(first);corrupt[index]^=1;assert.throws(()=>decryptBookingRuleOriginals(corrupt,key));}
});
test('empty, oversized and wrong-length inputs cannot produce an accepted archive',()=>{
  const key=randomBytes(32);
  for(const input of ['',null,Buffer.alloc(0),Buffer.alloc(8*1024**2+1)])assert.throws(()=>encryptBookingRuleOriginals(input,key));
  for(const badKey of ['',null,Buffer.alloc(16),Buffer.alloc(33)]){
    assert.throws(()=>encryptBookingRuleOriginals(Buffer.from('original'),badKey));
    assert.throws(()=>decryptBookingRuleOriginals(Buffer.from('invalid'),badKey));
  }
});
test('the production backup is not a generic export or a caller-approved dataset',()=>{
  for(const dataset of [null,{}, {systemIdentifier:'other'}, {systemIdentifier:'7612049595342295079',databaseOid:'5',serverVersionNum:'150008',databaseName:'postgres',currentUser:'supabase_admin',bookingRows:[]}])
    assert.throws(()=>validateBookingOriginalBackupDataset(dataset));
  assert.throws(()=>runBookingRuleOriginalBackup(),/invocation/);
  const source=readFileSync(new URL('./booking-handoff-rule-backup.mjs',import.meta.url),'utf8');
  assert.match(source,/begin isolation level repeatable read read only;/);
  assert.match(source,/validateBookingOriginalBackupDataset\(JSON\.parse\(restored/);
  assert.match(source,/need\(read\(\)===raw/);assert.match(source,/O_EXCL/);assert.match(source,/fs\.fsyncSync/);
  assert.doesNotMatch(source,/update public\.|insert into|delete from|truncate |disable trigger|session_replication_role|pm2|\bfetch\(|\brmSync\(|unlinkSync\(/i);
});
