// One real legacy merchant mutation against the already-committed synthetic
// booking, through the retained CI proxy only. No production storage/traffic.
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { rollbackCommit } from './member-checkout-version-cutover-support.mjs';

const siteId = '10909992';

/** `createOwnerView` provisions an isolated browser context already signed in
 * as the disposable merchant owner, at the active retained proxy origin.
 * `getLegacyGuardCount` exposes ONLY the controlled gateway's counter for the
 * exact old booking commit RPC rejection, after observing its real response. */
export async function checkoutPgRetainedLegacyCase(check, {
  financial, original, rollbackVersion, createOwnerView, getLegacyGuardCount,
}) {
  assert.equal(financial.site === siteId && original.siteId === siteId, true, 'legacy_fixture_site_mismatch');
  assert.equal(rollbackVersion === rollbackCommit, true, 'legacy_fixture_commit_mismatch');
  assert.equal(original.resourceKind === 'booking' && original.closed === false
    && /^[A-Za-z0-9:_-]{1,160}$/.test(original.resourceId), true, 'legacy_fixture_booking_required');
  await check('pinned old merchant booking cancellation hits the legacy SQL guard without any ledger change', async () => {
    const { page, dispose } = await createOwnerView();
    try {
      const url = new URL(page.url());
      const local = url.protocol === 'https:' && url.hostname === 'portal.checkout-auth.test'
        && Number(url.port) > 1023 && !url.username && !url.password;
      assert.equal(local, true, 'legacy_fixture_proxy_required');
      const before = await financial.state(), count = await getLegacyGuardCount();
      assert.equal(Number.isSafeInteger(count) && count >= 0, true, 'legacy_fixture_guard_counter_invalid');
      const observed = await page.evaluate(async ({ origin, siteId, bookingId, rollbackVersion }) => {
        if (location.origin !== origin) return null;
        const session = await fetch('/api/auth/merchant-session?reauth=1', {
          redirect: 'error', cache: 'no-store', credentials: 'same-origin', signal: AbortSignal.timeout(10_000),
        });
        const actor = await session.json().catch(() => null);
        if (session.status !== 200 || session.headers.get('x-owned-source-version') !== rollbackVersion
          || actor?.accountType !== 'merchant' || actor.merchantId !== siteId) return { merchantSession: false };
        const reply = await fetch('/api/bookings', {
          method: 'PATCH', redirect: 'error', cache: 'no-store', credentials: 'same-origin',
          headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(20_000),
          body: JSON.stringify({ siteId, bookingId, status: 'cancelled' }),
        });
        // The original Next writer intentionally masks new SQL error codes.
        // Return fixed comparisons, not response bodies or response text.
        const body = await reply.json().catch(() => null);
        return { merchantSession: true, status: reply.status, pinned: reply.headers.get('x-owned-source-version') === rollbackVersion,
          private: reply.headers.get('cache-control') === 'private, no-store',
          masked: body?.error === 'booking_update_failed' && body.message === 'booking_atomic_storage_unconfirmed' };
      }, { origin: url.origin, siteId, bookingId: original.resourceId, rollbackVersion });
      assert.equal(isDeepStrictEqual(await financial.state(), before), true, 'legacy_fixture_state_changed');
      assert.deepEqual(observed, { merchantSession: true, status: 400, pinned: true, private: true, masked: true });
      assert.equal(await getLegacyGuardCount() === count + 1, true, 'legacy_fixture_exact_guard_not_observed');
    } finally {
      await dispose();
    }
  });
}
