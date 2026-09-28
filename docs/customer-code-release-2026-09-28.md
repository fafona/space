# Customer CPU/payload optimization: code-only online release

## Authorized scope

On 2026-09-28 the user approved a separate narrowly scoped no-maintenance release
lane after the existing allowlist rejection was explained. The agreed sequence
is to publish the already-validated application changes while leaving the new
database projection off. This does not authorize migration 060, data changes,
maintenance, broader allowlists, altered authentication or background workers.

The application checkpoints are `b4a7b77a`, `4e159588`, `b0818967`, `1ede92a3`,
`f547d48c`, `7eaeceeb` and `426dd705`, based on main `b8e35810`. Together they
introduce an actual-GET synthetic baseline, avoid discarded alias merges,
reuse request-local identity tokens, trim the opt-in manager list response,
skip unused safe membership history normalization, reuse stable normalized
order records, and carry the disabled optional database projection adapter.

Exactly eight application runtime files differ from the deployed `57dbac3a`:
the customer reducer, search helper, manager list DTO/component and customer
route, the membership and order stores, and the disabled projection adapter.
Full-history readers/writers, transaction amounts, ordering, duplicate handling,
existing GET defaults, POST/PATCH bodies and session authorization retain their
reviewed contracts. No existing business records are rewritten or deleted.

The separate `customer-code-performance` lane accepts only its explicit closure
(57 paths including tests, historical measurement evidence, inactive migration
source and the current release policy/controller/docs). It does not inherit
authority from old lanes. Default/off settings are enforced in the new candidate
and the database action is forbidden. The historical full deployment and
maintenance-dependent database workflows must not be substituted for this lane.

## Read-only production preflight

On 2026-09-28 at 08:48 UTC, pinned SSH using the already configured deployment
key observed:

- Active application `57dbac3ab07899fcca03a17d149c3c717b805d63`, online on port
  3104; recorded predecessor `0004c202f1c75bce4241c4185aeb16eb1724b177`.
- Maintenance phase `ended`; original web, contact-card and automation services
  still online. No process was stopped or restarted by this preflight.
- `/www` filesystem available space 42,950,737,920 bytes (about 40 GiB), above
  the unchanged 12 GiB release reserve. No files were removed.
- All candidate ports 3103-3110 occupied. Publication requires the already
  reviewed rolling slot inspection/retirement procedure; no port expansion or
  ad-hoc process stop is allowed.
- Projection settings absent from PM2, actual live process environment and
  `.env.local`. Analytics remained enabled, signing material present (never
  printed), fafona order-attention pilot `10000000`, retention disabled, and
  background jobs paused in the live web as previously configured.
- Production Node `v20.20.1`; remote main still `b8e35810`.

These observations expire when the processes/configuration/source change. The
controller repeats its ownership and identity checks at each required boundary;
this note is not an authorization token or a replacement for runtime checks.

## Verification and publication gates

The preceding application checkpoint passed 717 related tests, 34 CI workflow
and inventory tests, complete non-incremental TypeScript checking, lint, encoding
and migration inventory checks. Its isolated PG15 evidence belongs to the
disabled projection; its 92.79%-99.97% synthetic JSON savings are **not an effect
enabled by this code-only publication**. Earlier performance reports likewise
describe their individual checkpoints, not a measured current production SLO.

An additional read-only local acceptance compared 36 actual-GET combinations
against the original full membership/order paths, including rich histories,
truncated identity fields, repeated booking repair and complex money errors.
Full/manager responses, IO, effects and phase order matched; missing/wrong
sessions and invalid merchant IDs performed no source reads. The six frozen
baseline source hashes were also rechecked against `b8e35810`, not repinned.

Current lane validation must run the exact focused test inventory serially and
the existing retirement/rolling contracts, without starting the native database
acceptance entrypoint. Before production publication, require all jobs of the
exact candidate/main CI (not merely the two-job Quality aggregate), then the real
guarded production build and candidate smoke. Neither local tests nor a green
remote CI alone establishes a successful production release.

The actual switch uses the existing owned proxy/immutable asset mechanism and
public checks, including unauthenticated customer GET 401 for both response
views. If public acceptance fails, restore only verified owned prior proxy
bytes. Candidate settings never block the web rollback. Previous versions,
assets, credentials, worker identities and saved release/retention evidence stay
intact. No database administration, migration, backfill, new projection RPC,
projection enablement or cleanup is part of this release. Existing application
reads and the normal read-only public probes continue unchanged.

## Status

Local release implementation is complete. The exact 84-file stage command ran
938 tests: 937 passed, none failed, one Linux-only filesystem proof skipped on
Windows (still required on Linux CI/production). The four unchanged retirement
and rolling suites passed 229/229. Full non-incremental TypeScript checking,
strict encoding, migration inventory and diff checks passed. Scoped lint has no
errors and retains the pre-existing unused candidate-environment parameter
warning. Independent red-team review found no blocking issue. All 84 focused
files appear exactly once in mandatory CI discovery; the operational native
database runner is excluded.

Production has not yet been switched by this candidate. Exact remote CI,
protected candidate build and public acceptance remain required gates. Do not
infer publication from this preparation note.
