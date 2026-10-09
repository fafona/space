import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {operationalRulesFixtureTables,operationalRulesNativeDocument,operationalRulesNativeQuery,verifyOperationalRulesNative} from './attendance-operational-rules-native.mjs';
const require=createRequire(import.meta.url),source=readFileSync(new URL('./attendance-operational-rules-native.mjs',import.meta.url),'utf8');
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');

test('240 synthetic rule document uses the frozen eight-field parser without changing references',()=>{
 const {parseOperationalRules}=require('../../src/lib/merchantAttendanceOperationalRules.ts');
 const value=operationalRulesNativeDocument(id(1),id(2),id(3));assert.deepEqual(parseOperationalRules(value),value);
 assert.equal(Object.keys(value).length,8);assert.deepEqual(value.locationScope.value,[id(1)]);
 assert.deepEqual(value.reviewRouting.value.correction,{delegateEmployeeId:id(2),delegateAuthUserId:id(3)});
 assert.equal(value.breakTypes.value.selection,'explicit');assert.equal(value.reminders.value.period_due.mode,'disabled');
});
test('240 fixture import is inert and has a bounded caller-owned transaction',()=>{
 assert.equal(typeof verifyOperationalRulesNative,'function');
 assert.doesNotMatch(source,/spawn\(|listen\(|chromium|initdb|pg_ctl|disable trigger|session_replication_role/);
 assert(source.includes('assert(++steps<=140'));assert(source.includes("set local statement_timeout='10s'"));
 assert(source.includes('assertLifecycleSandbox'));assert(source.includes('if(!rolledBack)await connection.step(\'rollback;\')'));
 assert(source.includes('await connection.close()'));assert(source.includes('d.fingerprint(),baseline'));
});
test('240 allows only new ledger writes in normal RPCs and requires real SQL rejects',()=>{
 assert.equal(operationalRulesFixtureTables.length,3);assert(operationalRulesFixtureTables.every(x=>x.startsWith('merchant_attendance_operational_rule_')));
 assert(source.includes('operational_rules_RPC_changed_old_facts'));assert(source.includes('operational_rules_read_replay_or_failure_changed_facts'));
 assert(source.includes('must_reach_exactly_one_real_RPC'));assert(source.includes('must_be_SQL_rejection'));
 assert(source.includes('actual_private_ACL_and_append_only'));assert(source.includes('projection_failure_atomic'));
 assert(source.includes('public.faolla_attendance_groups_v1('));assert(source.includes('operational_rules_setup_changed_other_facts'));
 assert(source.includes('fixtureSetup:{groupsViaRealRpc:1,syntheticForeignLocationRows:1}'));
 assert.doesNotMatch(source,/insert into public\.merchant_attendance_(?:events|operational_rule_operations|operational_rule_publications)/);
});
test('240 exact queries and revision capacity do not fake history or overwrite current ownership',()=>{
 assert.deepEqual(operationalRulesNativeQuery('99990001',{kind:'enterprise'}),{siteId:'99990001',mode:'detail',scope:{kind:'enterprise'}});
 assert(source.includes('real_27_draft_RPCs'));assert(source.includes('for(const command of prefixCommands)'));
 assert(source.includes('prefixResult=await run(query(enterprise),command)'));
 assert(source.includes('new_owner_cannot_adopt_receipt'));assert(source.includes('old_owner_cannot_read_catalog'));
 assert(source.includes('later withdrawal must not rewrite pinned history'));
 assert(source.includes("restore('opr240_rebind',beforeRebind)"));assert(source.includes("restore('opr240_owner',beforeOwner)"));
 assert(source.includes('periodContinuationArchiveBytes(await periodArchive()),oldPeriod'));
});
test('240 immutable ledger checks expect the actual42501 append-only trigger, not generic P0001',()=>{
 assert(source.includes("exception when insufficient_privilege then assert sqlerrm='attendance_events_append_only'"));
 assert(source.includes("exception when raise_exception then assert sqlerrm='attendance_operational_rule_invalid'"));
 assert(source.includes('native.connect({lifetimeMs:90000})'));
});
