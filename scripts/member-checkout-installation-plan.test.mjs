import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {splitInstallationSql,installationBody,loadInstallationPlan} from './member-checkout-installation-plan.mjs';
test('outer transaction removal preserves opaque function bodies, escaped strings and nested comments',()=>{
 const body=String.raw`CREATE FUNCTION public.synthetic() RETURNS void LANGUAGE plpgsql AS $fn$BEGIN PERFORM 'COMMIT;'; END;$fn$;
 /* outer /* COMMIT; */ nested */ SELECT E'escaped\';still quoted', 'it''s; fine', "semi;colon";`;
 const sql='-- header\nBEGIN;\n'+body+'\nCOMMIT;-- footer';
 assert.equal(splitInstallationSql(sql).length,4);assert.equal(installationBody(sql).trim(),body.trim());
});
test('unknown or incomplete transaction boundaries and top-level escapes are refused',()=>{
 for(const sql of ['SELECT 1;','BEGIN;SELECT 1;','BEGIN;SELECT 1;ROLLBACK;','BEGIN;COMMIT;SELECT 1;COMMIT;',
  'BEGIN;SAVEPOINT x;COMMIT;','BEGIN;SET TRANSACTION READ WRITE;COMMIT;',"BEGIN;SELECT 'unterminated;COMMIT;",'BEGIN;DO $$unterminated;COMMIT;','BEGIN;/* missing close'])assert.throws(()=>installationBody(sql));
});
test('plan binds unchanged 32 proposals plus exact runtime, without registering a production migration',async()=>{
 const plan=await loadInstallationPlan();assert.equal(plan.steps.length,33);assert.equal(plan.originals.length,5);
 assert.equal(plan.expected.functions.length,80);assert.equal(plan.expected.tables.length,23);assert.equal(plan.expected.triggers.length,26);
 assert.match(plan.digest,/^[a-f0-9]{64}$/);assert.equal(plan.material.scope,'owned-ci-atomic-installation-only');
 for(const step of plan.steps)for(const part of splitInstallationSql(step.body))assert.doesNotMatch(part.command,/^(?:BEGIN|COMMIT|ROLLBACK)\b/i);
 const source=await readFile('scripts/member-checkout-installation-plan.mjs','utf8');
 assert.doesNotMatch(source,/process\.env|spawn|fetch\(|\.query\(|SUPABASE|PRIVATE_KEY|writeFile/);
});
test('mutating rehearsal is hosted-CI-only, fresh-connection-owned and absent from production transports',async()=>{
 const source=await readFile('scripts/member-checkout-installation-acceptance.mjs','utf8');
 assert.match(source,/const owned=assertIsolatedCi\(\)/);assert.match(source,/assertOwnedLifecycleTarget\(db\);await db\.connect\(\)/);
 assert.match(source,/const open=async\(\)=>\{\s+assertIsolatedCi\(\);const db=new Client\(\{host:'127\.0\.0\.1'/);
 assert.match(source,/scope:'owned-ci-atomic-installation-not-production'/);assert.match(source,/markerVersion='999999990001'/);
 assert.match(source,/ci_only_checkout_bundle_/);assert.match(source,/pg_try_advisory_xact_lock/);
 assert.match(source,/await db\.query\('ROLLBACK'\)\.catch/);assert.match(source,/finally\{await close\(db\);\}/);
 assert.match(source,/for\(const client of \[\.\.\.clients\]\)try\{await close\(client\);\}catch\{cleanupFailures\+\+;\}/);
 assert.match(source,/report\.passed=report\.passed&&report\.cleanupPassed&&report\.failure===null/);
 assert.match(source,/installation_unapproved_grantee/);assert.match(source,/pg_default_acl/);assert.match(source,/aclexplode\(v\.attacl\)/);
 assert.ok(source.indexOf("await writeFile(path.join(evidence,'report.json')")>source.indexOf('report.cleanupPassed=clients.size'));
 assert.doesNotMatch(source,/\.env\.local|SSH_|PRIVATE_KEY|SUPABASE_SERVICE_ROLE_KEY|DATABASE_URL|drop\s+(?:table|schema|role)|truncate\s+(?:table|public\.)/i);
 const workflow=await readFile('.github/workflows/member-checkout-real-auth.yml','utf8');
 assert.match(workflow,/installation:\s+name: Atomic Installation \(isolated PG 15\.8\)/);
 assert.match(workflow,/path: \$\{\{ runner\.temp \}\}\/faolla-install-evidence\/report\.json/);
 assert.doesNotMatch(workflow,/secrets\.|environment:|ssh |scp |workflow_dispatch:|production-deploy/);
});
