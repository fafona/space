# Parallel required CI checks — 2026-09-27

## Measured cause and scope

Successful main CI `36118202806` took 31m17s: Quality took 27m52s,
including 13m14s of serial maintenance contracts and 10m16s of ordinary
tests. The independent browser job then took 3m18s, including its own build.
Dependency installation took only 14s. The two test groups were already
an exact, nonoverlapping inventory; deleting tests is not an optimization.

This change only changes CI scheduling and its contracts. It does not change
application code, data, dependencies, deployment/backup workflows, production
processes, maintenance state or the historical retirement receipt. The deployed
web application remains `0004c202f1c75bce4241c4185aeb16eb1724b177`.

## Independent execution, unchanged checks

- `quality-core` runs the existing workflow/encoding/lint/ordinary test/migration
  checks, production build and authentication build/HTTP acceptance.
- `maintenance-contracts` runs the complete original Real Next, topology,
  serial maintenance/ACL and PM2 acceptance sequence, with the same Node,
  environment, commands, opt-ins, timeouts and isolated fixture protections.
  The four step bodies are pinned to the pre-change SHA-256 hashes in tests.
  Maintenance proofs keep concurrency **one**, on their own hosted runner.
- Browser and independent SQL jobs start without waiting for Quality. Each has
  its own checkout, build or disposable database; none consumes Quality output.
  There are no shared writable artifacts or production credentials.
- The original `quality` job and displayed **Quality** name remain as a short
  aggregate. It always evaluates both required partitions and succeeds only
  when both explicitly report `success`. Failed, cancelled, skipped, absent and
  malformed results fail. It does not fetch sources or run operational actions.

The exact inventory is now twelve mandatory jobs. Every discovered unit/contract
test remains in exactly one original partition. There is no new skip filter,
matrix fail-fast, cancellation policy, optional check or `continue-on-error`.
The real aggregate shell is exercised over its success/failure input matrix.

## Trust and release boundaries

Current ordinary publication, readiness and backup entrypoints still require
the entire exact-SHA **push/main CI** to finish successfully. A green Quality
aggregate alone does not authorize release. PR success is not reused as main
success; environment/source evidence reuse is a separate, unimplemented change.

Fixed historical incident repair/recovery verifiers and signed fixtures keep
their original exact ten-job identities and frozen source hashes. They are not
the current publication route, and must reject a new twelve-job run rather than
silently accepting a subset. No historic authority or expiry is extended.

GitHub's documented dependency behavior explains why the aggregate uses an
explicit `always()` condition and strict result checks:
https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-jobs
https://docs.github.com/en/actions/reference/workflows-and-actions/contexts

## Acceptance status

Local acceptance passed all 45 related tests, including the actual Bash
81-combination result matrix, exact test inventory, historical startup
authorization and PM2 connection tests. YAML parsing, scoped ESLint, strict
encoding and diff checks passed. Independent review compared the four moved
step bodies directly with `git show 0004c202` and verified the other nine jobs
have unchanged behavior apart from their dependency/comment changes.

Exact PR/main hosted CI and an observed duration comparison are still pending.
Parallel scheduling can reduce the critical path,
but runner queue time and machine performance can vary; no fixed release-time
guarantee or application runtime speedup follows from this CI-only change.

Database pagination and all-writer booking ownership remain separate work. This
change neither activates the unintegrated shadow candidates nor counts them as
complete.
