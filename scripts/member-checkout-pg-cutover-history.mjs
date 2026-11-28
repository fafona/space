// Read-only checks on the owned production-build cutover proxy, never a
// database client, credential reader or standalone network entry point.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const routes = Object.freeze({
  pending: '/api/member-checkout/history/pending',
  recover: '/api/member-checkout/history/recover',
  retained: '/api/member-checkout/history/retained',
});
const scopeHeader = 'x-checkout-account-scope';
const hash = /^[a-f0-9]{64}$/;
const reference = (siteId, accountId, nonce) => createHash('sha256')
  .update(JSON.stringify(['checkout-history-v1', siteId, accountId, nonce.toLowerCase()])).digest('hex');

function assertOriginal(projected, original, siteId) {
  assert.equal(projected?.kind, 'single');
  assert.equal(projected.original?.method, 'points');
  const result = projected.original.result;
  assert.equal(result?.version, 1);
  assert.equal(result.siteId, siteId);
  for (const key of ['operationKey', 'resourceKind', 'resourceId', 'totalPoints', 'couponCount', 'closed']) {
    assert.equal(result[key], original[key], `history_original_${key}`);
  }
  assert.equal(result.closed, false);
  assert.ok(result.resource && result.resource.status !== 'cancelled');
}

/** The supplied call always goes through the isolated TLS proxy. Run before
 * cancellation and acknowledgement. The default phase has already closed DB
 * enrollment; the optional active phase must still have enrollment enabled.
 * signInOther must really sign in a distinct, verified personal account and
 * return its 8-digit account ID, not just supply a different account hint. */
export async function checkoutPgRetainedHistoryCases(check, {
  call, financial, f, body, scope, original, signInOther, restoreOriginalSignIn,
  phase = 'retained', candidateVersion = process.env.GITHUB_SHA,
}) {
  assert.ok(phase === 'active' || phase === 'retained');
  assert.match(candidateVersion ?? '', /^[a-f0-9]{40}$/);
  const siteId = financial.site, accountId = f.principal.accountId;
  assert.match(siteId, /^\d{8}$/);
  assert.match(accountId, /^\d{8}$/);
  assert.equal(scope[scopeHeader], accountId);
  assert.equal(body.siteId, siteId);
  assert.match(original.operationKey, hash);
  assert.equal(original.closed, false);
  const inputs = { pending: { siteId }, recover: { siteId, nonce: body.nonce }, retained: { siteId, after: null } };
  const read = async (kind, headers = scope) => {
    const result = await call(routes[kind], inputs[kind], headers, 'POST');
    assert.equal(result.version, candidateVersion, `${phase}_${kind}_must_use_candidate`);
    return result;
  };
  const expectEmptyInventory = result => {
    assert.equal(result.status, 200);
    assert.deepEqual(result.value, { ok: true, readOnly: true,
      inventory: { version: 1, siteId, after: null, items: [], nextCursor: null } });
  };
  const readOwn = async () => {
    const pending = await read('pending');
    assert.equal(pending.status, 200);
    assert.equal(pending.value.ok, true);
    assert.equal(pending.value.readOnly, true);
    assert.equal(pending.value.snapshot?.version, 1);
    assert.equal(pending.value.snapshot.siteId, siteId);
    const tracked = pending.value.snapshot.pending;
    assert.equal(tracked?.operationKey, original.operationKey);
    assert.ok(Number.isSafeInteger(tracked.generation) && tracked.generation >= 1);
    assert.match(tracked.reviewHash, hash);
    assert.equal(tracked.reviewRequired, false);
    assertOriginal(tracked.original, original, siteId);

    const found = await read('recover');
    assert.equal(found.status, 200);
    assert.deepEqual(found.value, { ok: true, readOnly: true, reference: reference(siteId, accountId, body.nonce), recovery: {
      version: 1, siteId, operationKey: original.operationKey, original: tracked.original, reviewRequired: false,
    } });

    // This fixture committed with enrollment enabled and has exactly one
    // tracked original. The inventory only contains UNTRACKED originals.
    // Returning its exact empty page proves the tracked original is not counted
    // twice; the nonempty pending and nonce recovery above prove it exists.
    expectEmptyInventory(await read('retained'));
    return tracked;
  };

  let tracked;
  await check(`${phase} PG candidate serves all three exact history POST routes with the same original and no financial writes`, async () => {
    const before = await financial.state();
    tracked = await readOwn();
    assert.deepEqual(await financial.state(), before);
  });
  await check(`${phase} PG candidate history protects the owner original across real personal sessions`, async () => {
    const before = await financial.state();
    try {
      const otherId = await signInOther();
      assert.match(otherId ?? '', /^\d{8}$/);
      assert.notEqual(otherId, accountId);
      for (const kind of Object.keys(routes)) {
        const forged = await read(kind);
        assert.equal(forged.status, 401);
        assert.deepEqual(forged.value, { error: 'checkout_unauthorized' });
      }

      const otherScope = { ...scope, [scopeHeader]: otherId }, pending = await read('pending', otherScope);
      if (phase === 'active') {
        assert.equal(pending.status, 200);
        assert.deepEqual(pending.value, { ok: true, readOnly: true, snapshot: { version: 1, siteId, pending: null } });
      } else {
        // A never-enrolled customer at a closed gate is unavailable, not
        // evidence that a submission failed or proof of an empty ledger.
        assert.equal(pending.status, 503);
        assert.deepEqual(pending.value, { error: 'checkout_intent_unavailable' });
      }
      const found = await read('recover', otherScope);
      assert.equal(found.status, 200);
      const key = found.value.recovery?.operationKey ?? '';
      assert.match(key, hash);
      assert.notEqual(key, original.operationKey);
      assert.deepEqual(found.value, { ok: true, readOnly: true, reference: reference(siteId, otherId, body.nonce), recovery: {
        version: 1, siteId, operationKey: key, original: null, reviewRequired: null,
      } });
      expectEmptyInventory(await read('retained', otherScope));
    } finally {
      await restoreOriginalSignIn();
    }
    assert.deepEqual(await readOwn(), tracked);
    assert.deepEqual(await financial.state(), before);
  });
}
