import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {utcValidationNativeCases,utcValidationNativeEquivalenceSql,utcValidationNativeSha,installAndVerifyUtcValidationNative} from './merchant-attendance-utc-validation-fastpath-native.mjs';
import {utcValidationFastpathRecipe} from './merchant-attendance-utc-validation-fastpath-source.mjs';
test('210 native import is inert and inputs cover strict fallback boundaries',()=>{
 assert.equal(typeof installAndVerifyUtcValidationNative,'function');assert.match(utcValidationNativeSha,/^[a-f0-9]{64}$/);
 assert.equal(utcValidationNativeCases.length,25);assert.equal(new Set(utcValidationNativeCases).size,25);assert(Object.isFrozen(utcValidationNativeCases));
 for(const value of [null,'UTC','utc','UTC ','Europe/Madrid','America/New_York','Etc/UTC','NOT_A_TIME_ZONE'])assert(utcValidationNativeCases.includes(value));
 assert(utcValidationNativeCases.some(x=>typeof x==='string'&&x.length>100));
});
test('210 actual comparison uses independently retained original expression',()=>{
 const recipe=utcValidationFastpathRecipe(readFileSync(new URL('./supabase-migrations/202609290061_merchant_attendance_foundation.sql',import.meta.url),'utf8'));
 const sql=utcValidationNativeEquivalenceSql(recipe.expression);
 assert(sql.includes(recipe.expression));assert(sql.includes('public.faolla_attendance_valid_zone_v1(p_zone)'));assert(!sql.includes('case when p_zone collate'));
 assert.equal((sql.match(/::text\)/g)??[]).length,25);assert.throws(()=>utcValidationNativeEquivalenceSql('true'));
});
test('210 native exact prosrc is JSON transported without trimming body bytes',()=>{
 const text=readFileSync(new URL('./merchant-attendance-utc-validation-fastpath-native.mjs',import.meta.url),'utf8');
 assert(text.includes("JSON.parse(d.exec(`select to_jsonb(replace(prosrc"));
 assert.equal(JSON.parse(JSON.stringify('\n  select true;\n')),'\n  select true;\n');
});
