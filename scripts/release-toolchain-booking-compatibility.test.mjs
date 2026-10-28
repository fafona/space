import {test} from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {bookingHistoricalMetadataReadSql,bookingInstalledMetadataReadSql,bookingDefaultPrivilegesReadSql,isolatedBookingDefaultPrivilegesSql} from './release-toolchain-booking-compatibility.mjs';
test('formal compatibility uses only read-only projections; only the exact already-installed additive objects are projected out',()=>{
 const sql=bookingHistoricalMetadataReadSql();assert.match(sql,/begin read only/);assert.match(sql,/faolla_booking_atomic_pages_guard_v1/);assert.match(sql,/faolla_booking_atomic_pages_clear_guard_v1/);
 assert.match(sql,/not\(s\.nspname='public' and c\.relname in/);assert.match(sql,/not\(s\.nspname='public' and p\.proname in/);
 for(const name of ['schemas','relations','functions','constraints','triggers','policies','defaults','extensions'])assert.ok(sql.includes("'"+name+"'"));
 for(const query of [sql,bookingInstalledMetadataReadSql,bookingDefaultPrivilegesReadSql])assert.doesNotMatch(query,/\b(?:drop|alter|insert|update|delete|truncate|grant|revoke)\s+(?:table|function|schema|on|into|from|public\.)/i);
 // Missing schema defaults are NULL/no rows. PostgreSQL's ACL iterator rejects
 // a zero-dimensional '{}' ACL array with SQLSTATE 22023.
 assert.doesNotMatch(bookingDefaultPrivilegesReadSql,/'\{\}'::aclitem\[\]/);
 const migration=readFileSync(new URL('./supabase-migrations/202610250211_booking_atomic_preparation.sql',import.meta.url),'utf8');
 for(const [,name]of migration.matchAll(/create trigger (\w+)/g))assert.ok(sql.includes(name));
});
test('new fixture ACLs are derived from current read-only default privileges, never copied credentials or role powers',()=>{
 const acl=[{scope:'global',kind:'tables',acl:[{grantee:'supabase_admin',grantor:'supabase_admin',privilege:'SELECT',grantable:false}]},{scope:'global',kind:'functions',acl:[{grantee:'PUBLIC',grantor:'supabase_admin',privilege:'EXECUTE',grantable:false}]},{scope:'public',kind:'tables',acl:[]},{scope:'public',kind:'functions',acl:[]}];
 const sql=isolatedBookingDefaultPrivilegesSql(acl);assert.match(sql,/create role/);assert.match(sql,/nologin/);assert.match(sql,/alter default privileges for role supabase_admin/);assert.doesNotMatch(sql,/password|superuser|login;|drop /i);
 for(const value of [[],acl.slice(1),[...acl.slice(0,3),acl[0]],acl.map((v,i)=>i? v:{...v,acl:[{...v.acl[0],privilege:'SUPERUSER'}]}),acl.map((v,i)=>i?v:{...v,acl:[{...v.acl[0],grantor:'other'}]})])assert.throws(()=>isolatedBookingDefaultPrivilegesSql(value));
 const quoted=structuredClone(acl);quoted[0].acl[0].grantee='name"quoted';assert.match(isolatedBookingDefaultPrivilegesSql(quoted),/"name""quoted"/);
});
