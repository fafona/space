import assert from 'node:assert/strict';
import test from 'node:test';
import { runOwnedCheckoutAcceptance } from './member-checkout-booking-intent-postgres-acceptance.mjs';

assert.equal(process.env.FAOLLA_CHECKOUT_NEXT_ACCEPTANCE, '1');
assert.equal(process.env.FAOLLA_CHECKOUT_HTTP_ACCEPTANCE, '1');
// Import also registers the UNCHANGED full SQL lifecycle, under its own limit.
test('owned Next cookie/session/default RPC path is checked separately from production auth', { timeout: 120000 }, t => runOwnedCheckoutAcceptance(t, { nextAcceptance: true }));
