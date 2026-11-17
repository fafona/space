# Backend startup retained-build continuation

This independently reviewed entry is fixed to application `4963116f54bcab64ae397e06ecf323838fe2e3be` and stable rollback `dadbced2d579b991a62f83edde6cc87bc964a280`. The ordinary publisher still rejects rolled-back candidates; the prior navigation continuation remains unchanged.

The application source, dependency and migration identities must remain identical to the original build. Admission requires the current-main tool source, the exact tool-only delta, successful complete PR/main CI, original build bytes and resource-limit proof, private runtime and configuration snapshots, immutable failure state, certificates 65/66, and the completed worker recovery receipt. Neither an alternate target nor caller-provided green evidence is accepted.

Before ingress, the dedicated held-lock entry preserves the original state and writes an exclusive intent for one compare-and-swap: `retentionRollbackHeadSha256` from certificate 65 to the already certified worker-only suffix 66. The committed state is then checked by the original publication validator. No generic guard is weakened and no projected state is supplied as actual state. A crash at this CAS boundary is resolved only by matching the exact original/result bytes and retained intent.

Only after the original source/runtime/dependency, private smoke, permissions, static collision, Nginx and public checks does traffic move. Existing completion, persisted manager configuration, two natural worker cycles and independent public audit remain mandatory. The recovered worker is not restarted or manually ticked; database schema is only read, never migrated. Mail stays disabled.

The systemd oneshot has no automatic retry and an independent recovery entry. It may recover only its own dead controller and original empty operation inode. Unknown ownership/state is refused. Verified completion or verified rollback is durably sealed before the original operation directory is archived. All original failures, sources, builds and backups remain. A verified rollback is not reported as publication.

The `start`, `run`, `recover`, and read-only `audit` commands are exact-invocation scoped to `/var/lib/faolla-online-code/<reviewed-main>/scripts/application-release-startup-continuation.mjs`. No command rebuilds the application, replays SQL, restarts workers, or enables email.
