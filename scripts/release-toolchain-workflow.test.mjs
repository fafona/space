import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
const workflow=readFileSync(new URL('../.github/workflows/release-toolchain.yml',import.meta.url),'utf8');
test('dedicated safety job verifies a complete committed bundle before actual owned Nginx cases',()=>{
 for(const value of ['runs-on: ubuntu-24.04','node-version: 20','contents: read','timeout-minutes: 25','npm ci','node --test scripts/release-toolchain-*.test.mjs',
  'git rev-parse HEAD','release-toolchain-pack.mjs pack','verify-bundle','rehearse /usr/sbin/nginx 5','release-toolchain-interrupt-acceptance.mjs',
  'scripts/test-support/release-toolchain-*','if: always()','release-toolchain-ingress-evidence'])assert.ok(workflow.includes(value),value);
 assert.ok(workflow.indexOf('verify-bundle')<workflow.indexOf('rehearse /usr/sbin/nginx 5'));
 for(const token of ['booking-ci-continuation-tool.test.mjs','booking-ready-*.test.mjs','booking-handoff-activation.test.mjs','booking-handoff-rule-repair.test.mjs','booking-publication-database.test.mjs'])assert.ok(workflow.includes(token),token);
 for(const value of ['Full New-Database Handoff And Recovery Rehearsal','release-toolchain-full-rehearsal.mjs','docker pull supabase/postgres@sha256:af083ef','--no-hardlinks','read-tree -mu HEAD'])assert.ok(workflow.includes(value),value);
});

test('required safety check includes actual pinned Next/PM2 and the unchanged shared production RPC framing, not only replacement processes',()=>{
 for(const text of ['node-version: 20.20.1','Real PM2 And Next Production Transition Equivalence','FAOLLA_RELEASE_PRODUCTION_EQ=1','release-toolchain-pm2-real-acceptance.mjs','/var/lib/faolla-eq-*/reports'])assert.ok(workflow.includes(text),text);
 const source=readFileSync(new URL('./release-toolchain-pm2-real-acceptance.mjs',import.meta.url),'utf8');
 for(const text of ['booking-handoff-pm2-pause.py','m._Session','m._ARGUMENT','m._control._check_target_process','real-next-build','pm2@6.0.14','actual-transition-proof','inspectPm2SigintTermination','assertManagedPauseEnvironmentTransition','staleAttemptRefusedWithoutSend','allOwnedProcessesStopped'])assert.ok(source.includes(text),text);
 assert.doesNotMatch(source,/kill.*\[.*--force|set active|UPDATE public|booking_.*_skip/);
 assert.ok(source.includes('!ANCHORS.some(f=>fs.existsSync(f))'));
 assert.match(source,/stage='real-next-build';run\([^\n]+120000,release\)/);
 assert.ok(source.includes('ci-only-synthetic-command-failure'));
 for(const text of ['ecosystem.config.cjs','common.isConfigFile(configFile)','started_real_next'])assert.ok(source.includes(text),text);
 for(const text of ['stable_initial_process','transition-observed.json','beforeRow.pm2_env.unstable_restarts===0'])assert.ok(source.includes(text),text);
 for(const text of ['privateAppProcesses().length===0','untracked_fixture_process','p.parentPid===daemon.pid'])assert.ok(source.includes(text),text);
 for(const text of ["headers:{Connection:'close'}",'await r.arrayBuffer()','fixture_requests_not_drained'])assert.ok(source.includes(text),text);
 for(const text of ['production-maintenance-pm2-dump.py','dump.capture_pm2_dump_target','dump.persist_pm2_dump','dump.verify_pm2_dump','fixed_dump.PM2DumpError: pm2_dump_target_changed','dump-persistence-verified.json','stablePm2RegistryRow(afterSave)','RuntimeError: stale_target'])assert.ok(source.includes(text),text);
 assert.ok(source.indexOf("seal('transition-observed.json'")<source.indexOf("stage='actual-transition-proof'"));
 assert.ok(workflow.includes('eq_roots=(/var/lib/faolla-eq-*)'));
 assert.ok(workflow.includes('sudo find "${eq_roots[@]}" -maxdepth 2'));
 assert.doesNotMatch(workflow,/roots=\([^\n]*faolla-eq-\*\/reports/);
});
test('CI fixture has no server credentials, production mutation, skipped tests or accepted failed commands',()=>{
 assert.doesNotMatch(workflow,/secrets\.|ssh |scp |pm2 |continue-on-error|\|\| true|--force|--skip|workflow_dispatch/);
 assert.match(workflow,/pull_request:/);assert.match(workflow,/\.github\/workflows\/release-toolchain\.yml/);
 assert.match(workflow,/branches: \[main, master\]/);
});
