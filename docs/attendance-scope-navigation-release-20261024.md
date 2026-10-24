# Pristine attendance-scope navigation: narrow no-maintenance release

Approved 2026-10-24. Live baseline `f97c7292a05a9233b0b7d5495e448d7c1c610d07`.
The root cause was using paused overview auto-refresh as evidence of an unsaved
edit. The scope child did not supply its own navigation guard.

Only the reviewed two UI components and their regression test may change.
Pristine entry, search, viewing a saved grant, opening a blank grant and reverting
edits do not prompt. Real changed grants and stored/in-flight/unknown operations
remain protected. Menu/module exits and native unload use actual draft/pending
state, including the lazy-load interval. Leaving neither writes nor clears nor
retries an operation. Existing authorization, data APIs, storage keys, receipt
recovery, other-view warnings and paused auto-refresh remain unchanged.

The independent lane pins every application byte, binds the complete tool
closure, and denies all database actions. It does not widen prior lanes. No SQL,
dependency, workflow, login or other unfinished application change is admitted.
Every required CI check must pass on the exact merged current-main SHA before
staging. Preserve ownership-checked source, dependencies, inherited feature/env
values, baseline PID, maintenance state, proxy snapshots and build evidence.

Use the unchanged private-network build: at least 6 GiB available RAM and 20 GiB
disk, 4 GiB hard memory, 3072 MiB Node heap, one CPU, 128 tasks, zero swap and a
20-minute timeout. Do not lower admission, enlarge budgets, stop pilots/Studio,
retry a failed candidate automatically or enter maintenance.

The user separately approved stopping only old web `6d77f3df` after existing
retention eligibility checks: not the active `f97c7292` or rollback `518d32cf`.
Keep its source, files, logs, PM2 registration, recovery proof and all data.
This is not authority to retire another process during this publication.

Candidate/public smoke retains contact/vCard/WeChat, attendance denial, hidden
harnesses, super-admin denial, merchant session denial, login and static assets.
It never creates production test accounts or records. Switch nginx gracefully
only after all gates pass, with owned rollback on failed public validation.
Post-publication retention may converge active/rollback metadata only. No
automatic process retirement, artifact deletion, worker change or data write.
