# Merchant workspace loading — local changes, not deployed

## Scope

- Keep the existing loading screen while the initial desktop landing menu is unresolved. Do not hide explicit website/platform editors or re-enter this guard after a landing site has already been resolved.
- On a cold desktop entry, allow independent business panels to render after authenticated same-site identity and a matching merchant profile with permissions are available. A cached URL, public profile alone, missing profile, foreign site or failed authentication cannot enable this fast path.
- Keep existing draft/published hydration in the background. Booking rules depend on website blocks, so booking surfaces (desktop, dialog and mobile after resize) retain the loading screen until that hydration finishes. The existing hydration fallback and error paths are unchanged.
- Mount desktop/mobile Faolla iframes only on first activation. Retain the same iframe across subsequent menu switches. Keep the existing ref, URL and load handler.
- No auth/API authorization, database, permissions, saved content, deployment or maintenance configuration changes.

## Verification

- 53 targeted tests pass: entry guards, actual asynchronous profile callback (including cancellation/completion races), iframe static rendering/integration, auth recovery, booking rules, launch state, Faolla entry, publishing and draft restoration.
- TypeScript no-emit checking passed, including the final race-coverage tests.
- Targeted ESLint has zero errors. AdminClient retains five pre-existing internal-navigation warnings.
- Browser skill local fixture using the real DeferredFaollaFrame component: 0 iframe requests before activation; 1 after opening; still 1 after hide/reopen; load callback and ref work; no browser console errors. This is component-level synthetic acceptance, not an authenticated full-production journey or a measured production speed-up.
- New regression tests are in AdminClient.contract.test.ts, already included by test:logs / grouped CI.

## Outstanding

- Not committed/pushed/deployed in this turn. Production remains unchanged and online.
- Hosted CI and authenticated real-entry timing remain release-time checks. Do not claim a measured seconds/percentage improvement.
- Larger AdminClient splitting and idle preloading policy are separate follow-up work, not included in this bounded change.

## Continued release preparation

- Complete `npm run build` now passes on Windows using the same public dummy Supabase settings as CI. These are verification artifacts only; never deploy this dummy-config build.
- Initial compilation/typecheck succeeded, but the final bundle check exposed Windows webpack source-entry backslashes. The checker now recognizes only the exact Windows equivalent of AdminClientLoader on Windows, rejects ambiguous entries and retains unchanged Linux selection and 1250/760 KiB limits. No permissive fallback, budget increase or manifest rewrite.
- Measured entry: 898.2 KiB; largest chunk: 452.0 KiB. Both within existing budgets. This is an absolute measurement, not a before/after speed claim.
- Full-project ESLint quiet mode and strict encoding checks passed. Authentication middleware build inspection passed.
- Continued test groups passed: logs 26, auth 88, editor drafts 14, frontend trust 53, bundle compatibility 12 passed/1 Windows symlink skip, middleware-build regression 1. Linux-only HTTP acceptance was not run on Windows and was not bypassed.
- Existing mobile-shell check also passed. No GitHub push, CI dispatch, deployment or maintenance change performed.
