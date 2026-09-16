# Unlaunched deployment transport recovery (2026-09-16)

The operator authorized repair after deployment 35131822753 lost its SSH transport
with exit 255 during dependency installation. A network idle timeout is suspected,
not proven. No candidate launched and no database migration was attempted. The
existing operation remains failed-held; it must not be reset or overwritten.

The deployment transport now sends bounded SSH keepalives (30 seconds, 10 missed
responses). This does not retry remote deployment or weaken any release gate.

The incident-specific manual workflow pins operation, predecessor hash, revision,
boot, old release and failed run. It requires current-main CI (all ten jobs), signed
original backup/readiness bindings, authenticated workflow history, an exact
seven-file source delta and a fresh hosted-signed authority. Remote verification
checks the original closed ingress, stopped writers and quiet database, the exact
56-entry unchanged pre-operation migration catalog, and the deployment flock.

Only after all checks, the existing locked atomic CAS/storage and v2-to-v3 protocol
may produce a held state for the reviewed repair SHA. Original state and signed
authority are retained privately. The immutable recovery audit preserves the
predecessor digest, original deadline, token, ingress/runtime/database proofs.
The workflow cannot launch applications, open ingress, migrate data or erase the
failure. A replay or differing state fails closed. No automatic retry is allowed.

After recovery, use the ordinary new-target encrypted backup/restore rehearsal,
readiness, deployment, signed maintenance-end and public health checks. Never reuse
the old backup/readiness as authorization for a different target. A failure after
the CAS requires inspecting the actual revision before any further action.
