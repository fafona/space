# Local member-redemption recovery harness

Route: `/test-harness/member-redemption`.

The server page returns `notFound()` unless `FAOLLA_ENTERPRISE_E2E_HARNESS` is exactly `enabled-for-local-browser-tests`, matching the existing harness gate. It is dynamic and marked noindex. This is not a deployment instruction.

The page renders the real `MerchantMemberManager` with an in-memory `apiClient`. Only synthetic member records, settings, account balances and checkout receipts are used. Unknown requests return synthetic errors; there is no real-network fallback. Persistent caching is explicitly disabled. No browser local/session storage or real authentication credentials are used.

## Browser cases

- Pending original checkout and committed-but-unacknowledged checkout.
- First product checkout response lost after its one synthetic financial write.
- Retry response lost, GET failure and explicit GET recovery.
- Pinned quote changed, requiring cancel and acknowledgement.
- Cancellation wins before retry; commit wins before cancellation.
- Switching employee A/B while an old response is deliberately delayed.
- Withdrawing checkout permission without clearing the service's pending context.
- A committed receipt remains available after the synthetic member is deleted.
- Synthetic owner versus employee permissions.

Select a scenario, inspect the real component, and use **重挂载页面（保留服务原单）** to unmount/remount it without recreating the synthetic service. This is the local substitute for retaining server state across a browser reload; an actual full reload resets this deliberately non-persistent fixture. Repeating or recovering the same operation must not increase its financial-write count.

For a new lost-response case, select **首笔提交响应丢失**, open the synthetic member, choose the redemption action and the synthetic product, then submit. The service commits once and returns 503; subsequent recovery and remount must show the original result with write count 1.

The toolbar exposes active actor, scenario, write count, balance, stock, unacknowledged status, mount count and expandable request/context logs. Switching actors keeps each actor's synthetic service state independent. Switching scenarios resets only the active actor's fixture; it is not a business operation.

Owner-mode limitation: injecting an `apiClient` causes the existing component to choose its injected/employee-safe transport path. The owner case therefore uses a synthetic owner principal and all permissions used by this page; it does **not** claim to test the native owner's default fetch/persistent-cache branch. The harness does not modify production component props or intercept global fetch/storage to simulate that branch.

## Local checks

`npx tsx --test src/app/test-harness/member-redemption/syntheticService.test.ts`

The eight service tests cover the synthetic contracts above. They are not evidence that the React view passed browser acceptance; that is a separate check using this route. They also do not replace real PostgreSQL concurrency tests or production authorization validation.
