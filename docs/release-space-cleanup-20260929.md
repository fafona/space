# Production space cleanup — 2026-09-29

## Completed, without application publication or maintenance

- Approved scope: first batch of unreferenced legacy release directories.
- Reviewed tool: `ab6b2568d731396415605be4a28e80b4009467da`, PR 179.
- CI run `36497408129`: all 12 checks passed before merge and execution.
- Earlier supporting tools: PR 177 (archival cleanup), PR 178 (closed recovery evidence).
- Plan: `bcc0ce1a-bbbd-4d5b-ad7e-e0a39da587b9`.
- Approved plan SHA-256: `e625e51c0427c3907893963e98bd7cea9368cd8e1e37c041d0a3b66a93278dd9`.
- All 15 approved directories removed; each has an immutable removal receipt.
- Removal operation free-space change: 42,298,023,936 → 55,253,594,112 bytes.
- Final available space after redundant audit cleanup: 55,699,091,456 bytes (51.87 GiB).
- Compared with the pre-inspection baseline 43,449,364,480 bytes, net available increase was 11.41 GiB, including archive/tool overhead and concurrent ordinary disk activity.

The retained private audit occupies 447,262,720 bytes. It preserves source,
configuration, public files and all historical `.next/static` files; generated
runtime/dependencies were removed. These historical trees require a rebuild to
run again; they are not instant rollback targets.

The failed inspection `cb19c9ed-617b-4902-867a-015d9a553151` was removed only after
all 15 manifests and 2,854 blobs matched the successful audit byte-for-byte.
An independently pinned inventory, prepared receipt and completion receipt are
under `/var/lib/faolla-legacy-release-pruning`. The successful archive remains
under `/var/lib/faolla-legacy-release-audit/bcc0ce1a-bbbd-4d5b-ad7e-e0a39da587b9`.

Final full observation matched the original except for the 15 expected absent
directories. All PM2 registrations and PIDs were unchanged. Public version
checks for `www.faolla.com` and `launch.faolla.com` returned HTTP 200 and
`b1304d5d58841c2247b93229b90bb7adcfd64965`. Maintenance remained `ended`.
No business data, proxy, background worker or application process was changed.

## Not completed: automatic current-plus-one retention

The remaining release roots occupy 32,670,277,632 bytes (30.43 GiB), including
the current release, rollback, supporting processes and other retained versions.
This is not a declaration that all remaining bytes are disposable.

The follow-up implements the v2 policy, durable reader/writer,
publication/rollback integration and cache observer. Its operating procedure is
in `online-release-retention-v2.md`; this report records the earlier legacy
cleanup, not a claim that v2 is already active on the host. Enablement requires
the reviewed merged tool and host-side receipts. Complete old online-directory
cleanup remains a separate operation. Existing rolling-v1 retirement binds each
stop to the next actual publication; it must not be used as a standalone batch
cleanup loop.

One legacy directory remains excluded for unsafe ownership/permission layout;
the other remaining legacy directory supplies active base/worker/static code.
No permissions were relaxed to make either deletable. Historical recovery
records and supporting route/web directories were not removed.
