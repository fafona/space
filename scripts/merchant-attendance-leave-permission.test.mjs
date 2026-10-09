import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {validateMigrationSource} from './check-supabase-migrations.mjs';
const root=new URL('./supabase-migrations/',import.meta.url);
const source=name=>readFileSync(new URL(name,root),'utf8').replaceAll('\r\n','\n');
const old=source('202610010090_merchant_attendance_period_export.sql');
const filename='202610030121_merchant_attendance_leave_permission.sql',sql=source(filename);
test('121 preserves090 validator exactly except independent self.leave dependency tuple',()=>{
  const fn=s=>s.match(/create or replace function[\s\S]*?\n\$\$;/)?.[0];
  assert(fn(sql));
  const line="      ('attendance.self.leave', array['enterprise.view', 'attendance.self.view']::text[]),\n";
  assert.equal(sql.split(line).length,2);
  assert.equal(fn(sql).replace(line,''),fn(old));
  assert.doesNotMatch(sql,/^\s*(?:update|delete|grant|revoke|alter|drop)\s/im);
  assert.equal((sql.match(/insert into/g)||[]).length,1);
  assert(sql.includes("values(202610030121,'merchant_attendance_leave_permission') on conflict(version) do nothing"));
});
test('121 passes unchanged migration checker without granting existing roles leave',()=>{
  assert.deepEqual(validateMigrationSource(filename,sql),[]);
  assert.doesNotMatch(sql,/merchant_enterprise_roles|merchant_enterprise_employees/);
});
