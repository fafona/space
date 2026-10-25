# Records and Google presentation release — explicit approval 2026-10-25

The user approved one new candidate containing only the read-only attendance
records navigation/date repair and the already approved Google callback loading
repair. Seven full application/test files are byte-pinned against live dd85d9fb,
including the separately approved test-only synchronization below.
No database, permissions, API, dependency, feature configuration or worker changes.
Existing lanes retain their scopes. The new lane shares the existing sealed
source/environment/process/rollback mechanics, fixed private HTTP smoke and
convergence-only retention. Full PR and exact merged-main CI remain mandatory.

After failed PR CI run 40198779402, the user explicitly approved only two test
repairs: synchronize the staged-tool static import count (13 to 14, retaining
the independent parser and exact closure equality), and wait explicitly for the
mocked recovery GET to start before testing pause suppression (not a zero-delay
timer). Retain all original assertions and the failed run/logs. Attendance
recovery implementation, business logic and every existing application pin are
unchanged. Include both test files in the narrow closure and focused suite;
rerun complete PR CI and exact merged-main CI, with no skipped checks.

Keep 6 GiB available RAM and 20 GiB disk admission, bounded private-network build
(4 GiB hard, 3072 MiB heap, 1 CPU, 128 tasks, zero swap, 20 minutes). Do not retry
a failed candidate automatically or overwrite it. Preserve active dd85d9fb and
stable rollback f97c7292, old files/assets and background workers.

First formally end the resource-rejected 8fabf807 attempt with a write-once
private termination sidecar. Keep original state bytes (9722dc9f…), source,
environment, dependencies, proxy snapshots and failed log unchanged. Prove no
build, PM2 registration, candidate port, database execution trace or traffic
switch. Two locked observations must agree. A strict reader recognizes only
this exact historical receipt, never arbitrary preparing states or skip flags.

After closure, the user separately approved stopping only old standby
518d32cdf8088b285ed174833ac2ed7fe8e38282 after the existing retention inspector
proves it is neither active nor rollback and all ownership/runtime checks pass.
Use the original retirement writer and append its certificate; retain files,
logs and stopped PM2 registration. No other stop or cleanup is authorized.
