# Booking worker application-path finalization

The website remains the immutable `f274ad615550c83717aa7af2ad32339608e6f8aa`
build, with its original gate and rollback. Mail remains disabled. No SQL,
application source, dependency or public routing change is included.

## Cause and evidence

After certificate 24, the worker can read the actual protocol-2 database with
the existing attested credential, but its first natural automation cycle is
unconfirmed. Import-only and synthetic-tick acceptance did not exercise the
actual application's nested `import()` of the notification module.

A local reproduction with empty synthetic records, no credentials and no
network fails with `ERR_MODULE_NOT_FOUND` for the extensionless TypeScript
notification import. The namespaced CJS-only loader cannot resolve that nested
ESM import. The fix registers both installed tsx hooks in the dedicated worker
process, using the normal shared module cache. No application logic is patched.

The actual application acceptance now runs empty and two-merchant automation
with an entirely synthetic HTTP transport, verifies two scoped state commits,
notification claims, shared atomic context, and idempotent subsequent cycles.
This also runs inside the real isolated PM2 worker before its report can satisfy
the strengthened release admission. No formal database or network is used.
Diagnostics emit only fixed phase/code pairs, never exception text or paths.

The isolated fixture uses the existing complete application/dependency copy,
with all source/configuration bytes matched first. Once closed-gate/no-dispatch
and exact four-process ownership have been proved, it stops only the fourth
owned Node fixture by its unchanged identity. Its esbuild children are pinned
by parent identity, cwd, binary and exact service argv, and must exit naturally
with that parent. Compiler PIDs are not signalled. The original node-only final
cleanup predicate remains unchanged; all three protected processes are checked
again. Compiler resources cannot be hidden by changing cwd.

## Audited continuation

The separate application profile pins certificate 24, PID 754409 / restart 13,
the failed controller, all eleven original evidence hashes, and the original
empty operation inode. It also preserves the certificate-23 failure evidence.
The old database profile and its admission rules remain unchanged.

Only a fresh reviewed source installation and a single source-only replacement
of PM2 27 are allowed. The existing peer transport, complete process/configuration
comparison, saved PM2 dump, public-domain checks and original archive primitive
remain mandatory. The controller must observe at least two naturally scheduled
completed cycles at least 60 seconds apart before it can seal closure, retain
the original operation inode, and release only its own empty replacement scope.

No direct retry of an old attempt, manual task dispatch, permission elevation,
business-data repair, or website republish is permitted by this profile.
