# Customer request ownership — local candidate, 2026-09-25

## Root cause

`MerchantCustomerManager` previously assigned a shared sequence to every GET but
did not own that sequence by the merchant incarnation. A save/import started for
A could finish after switching to B, call its captured A loader, increment the
shared sequence and overwrite B's customer list, manual edit version and warnings.
The empty-site branch did not invalidate an existing read. Quiet post-mutation
loads did not set the refresh button busy and could overlap ordinary refreshes.

## Change

- Each committed site incarnation has a separate owner, including A → B → A.
- Layout setup/cleanup invalidates the previous owner before paint/passive cleanup.
- Same-generation pending GETs are shared; success/409 after a mutation forces a
  new GET and cannot join a pre-write request.
- Merchant change/unmount clears read timers and aborts obsolete fetches. Request
  identity still rejects late results even when transport/body ignores abort.
- Quiet refresh keeps the existing list visible but marks refresh busy.
- Already submitted PATCH/POST requests are not cancelled or rolled back. Their
  old UI callbacks cannot refresh, close a newer draft, toast or clear new busy
  state after their scope is lost.
- Customer rows/version/warnings and local edit/import drafts are reset on site
  changes. No saved source records or mutation body/version rules are changed.
- Lazy import/template preparation is also invalidated at the layout boundary;
  promises completing before passive cleanup must not download, toast or set
  state for a page that has already closed/switched.

## Verification and limits

The actual component is transpiled into the existing isolated hook/JSX harness;
tests drive real handlers with delayed GET headers/body, delayed PATCH/POST,
abort-ignoring transports, A → B → A, empty site, unmount and Strict-effect replay.
Layout and passive queues are separate so stale work is tested in the commit gap.
Existing full-directory search, totals, 50-row paging, lazy import and editing
tests remain. This is not a real-browser performance measurement.

Final verification: 58 focused component/contract/telemetry groups passed; the
combined booking/customer regression passed 438 groups, plus 51 shadow/persistence
contract checks. TypeScript, targeted ESLint, strict encoding and diff checks
passed. The database fixture cluster stayed stopped; no native DB test was rerun.

The server endpoint is unchanged: each admitted GET still aggregates four full
sources, and booking reads still run the existing automation. Browser abort is
NOT proof that backend work or a reminder was cancelled. There is no TTL cache,
cross-tenant cache, new polling, retry or server-side pagination in this change.

Status: local candidate only. No deployment, maintenance, production access or
business-data change was performed for this work.
