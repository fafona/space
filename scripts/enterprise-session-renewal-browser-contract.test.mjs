import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('renewal browser acceptance uses actual Manager and remains mandatory in the existing browser CI job', () => {
  const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(packageJson.scripts['test:enterprise-browser'],
    'node scripts/check-merchant-enterprise-browser.mjs && node --test --test-concurrency=1 scripts/enterprise-session-renewal-browser-acceptance.mjs scripts/redemption-pending-cart-browser-acceptance.mjs scripts/member-checkout-recovery-browser-acceptance.mjs scripts/order-list-alignment-browser-acceptance.mjs scripts/poll-rounds-browser-acceptance.mjs');
  const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  assert.match(workflow, /run: npm run test:enterprise-browser/);
  const source = readFileSync(new URL('./enterprise-session-renewal-browser-acceptance.mjs', import.meta.url), 'utf8');
  assert.match(source, /import Manager from '\.\/src\/components\/admin\/MerchantEnterpriseManager'/);
  assert.match(source, /\[1440, 390\]/);
  assert.match(source, /requests\.every\(r => r\.method === 'GET'\)/);
  assert.match(source, /url\.origin.*origin|new URL\(route\.request\(\)\.url\(\)\)\.origin !== origin/);
  for (const file of ['redemption-pending-cart-browser-acceptance.mjs', 'member-checkout-recovery-browser-acceptance.mjs', 'order-list-alignment-browser-acceptance.mjs', 'poll-rounds-browser-acceptance.mjs']) {
    const acceptance = readFileSync(new URL(`./${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(acceptance, /\b(?:test|it)\.skip\b|\bskip\s*:/);
    assert.match(acceptance, /unexpected/);
  }
});
