import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
const workflow=readFileSync(new URL('../.github/workflows/release-toolchain.yml',import.meta.url),'utf8');
test('dedicated safety job verifies a complete committed bundle before actual owned Nginx cases',()=>{
 for(const value of ['runs-on: ubuntu-24.04','node-version: 20','contents: read','timeout-minutes: 15','npm ci','node --test scripts/release-toolchain-*.test.mjs',
  'git rev-parse HEAD','release-toolchain-pack.mjs pack','verify-bundle','rehearse /usr/sbin/nginx 5','release-toolchain-interrupt-acceptance.mjs',
  'scripts/test-support/release-toolchain-*','if: always()','release-toolchain-ingress-evidence'])assert.ok(workflow.includes(value),value);
 assert.ok(workflow.indexOf('verify-bundle')<workflow.indexOf('rehearse /usr/sbin/nginx 5'));
});
test('CI fixture has no server credentials, production mutation, skipped tests or accepted failed commands',()=>{
 assert.doesNotMatch(workflow,/secrets\.|ssh |scp |pm2 |continue-on-error|\|\| true|--force|--skip|workflow_dispatch/);
 assert.match(workflow,/pull_request:/);assert.match(workflow,/\.github\/workflows\/release-toolchain\.yml/);
 assert.match(workflow,/branches: \[main, master\]/);
});
